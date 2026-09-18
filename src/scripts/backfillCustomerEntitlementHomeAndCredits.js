import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import { Customer, LicenseLevel } from '../models/index.js'
import { LICENSE_HOME_EXPERIENCES, normalizeLicenseEntitlements, normalizeLicenseHomeExperience } from '../constants/licenseEntitlements.js'

const toIdString = (value) => (value && typeof value.toString === 'function' ? value.toString() : String(value ?? ''))

export const buildBackfillPlan = ({ licenseLevels = [], customers = [] } = {}) => {
  const licenseOperations = []
  const customerOperations = []

  for (const level of licenseLevels) {
    const explicitHome = normalizeLicenseHomeExperience(level.homeExperience)
    if (explicitHome) continue
    const entitlements = normalizeLicenseEntitlements(level.featureEntitlements)
    licenseOperations.push({
      updateOne: {
        filter: {
          _id: level._id,
          $or: [
            { homeExperience: { $exists: false } },
            { homeExperience: { $nin: ['SIGNAL', 'CORE'] } },
          ],
        },
        update: {
          $set: {
            homeExperience: entitlements.includes('VMF')
              ? LICENSE_HOME_EXPERIENCES.CORE
              : LICENSE_HOME_EXPERIENCES.SIGNAL,
          },
        },
      },
    })
  }

  for (const customer of customers) {
    const set = {}
    if (customer?.creditBalances?.websiteAnalysis === undefined) set['creditBalances.websiteAnalysis'] = 0
    if (customer?.creditBalances?.documentImprovement === undefined) set['creditBalances.documentImprovement'] = 0
    if (Object.keys(set).length === 0) continue
    customerOperations.push({
      updateOne: {
        filter: { _id: customer._id },
        update: { $set: set },
      },
    })
  }

  return {
    summary: {
      licenseLevelsPending: licenseOperations.length,
      customersPending: customerOperations.length,
      pendingOperations: licenseOperations.length + customerOperations.length,
    },
    licenseOperations,
    customerOperations,
  }
}

export const runBackfillCustomerEntitlementHomeAndCredits = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const { connect = connectDb, disconnect = disconnectDb } = dependencies
  await connect()
  try {
    const [licenseLevels, customers] = await Promise.all([
      LicenseLevel.find({}).select('_id featureEntitlements homeExperience').lean(),
      Customer.find({}).select('_id creditBalances').lean(),
    ])
    const plan = buildBackfillPlan({ licenseLevels, customers })
    let appliedOperations = 0
    if (apply) {
      if (plan.licenseOperations.length > 0) {
        const result = await LicenseLevel.bulkWrite(plan.licenseOperations, { ordered: false })
        appliedOperations += result.modifiedCount || 0
      }
      if (plan.customerOperations.length > 0) {
        const result = await Customer.bulkWrite(plan.customerOperations, { ordered: false })
        appliedOperations += result.modifiedCount || 0
      }
    }
    const result = { mode: apply ? 'apply' : 'dry-run', summary: plan.summary, appliedOperations }
    logger(json ? JSON.stringify(result, null, 2) : `[ss-031] mode=${result.mode} pending=${plan.summary.pendingOperations} applied=${appliedOperations}`)
    return result
  } finally {
    await disconnect()
  }
}

const isMain = process.argv[1] && toIdString(fileURLToPath(import.meta.url)) === toIdString(process.argv[1])
if (isMain) {
  const args = new Set(process.argv.slice(2))
  runBackfillCustomerEntitlementHomeAndCredits({ apply: args.has('--apply'), json: args.has('--json') })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
