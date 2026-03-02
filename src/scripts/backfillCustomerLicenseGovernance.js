import { fileURLToPath } from 'url'
import env from '../config/env.js'
import { connectDb, disconnectDb } from '../config/db.js'
import { Customer, User } from '../models/index.js'
import { seedDefaultLicenseLevel } from '../seeds/licenseLevels.js'

const ACTIVE_CUSTOMER_STATUS = 'ACTIVE'
const CUSTOMER_ADMIN_ROLE = 'CUSTOMER_ADMIN'
const DEFAULT_MAX_TENANTS = 1
const DEFAULT_MAX_VMFS_PER_TENANT = 1

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.floor(parsed)
  if (normalized < 1) return fallback
  return normalized
}

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Set(argv)
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
  }
}

const buildActiveAdminMap = (rows) => {
  const map = new Map()
  for (const row of rows) {
    const customerId = toIdString(row.customerId)
    const userId = toIdString(row.userId)
    if (!customerId || !userId) continue
    if (!map.has(customerId)) map.set(customerId, new Set())
    map.get(customerId).add(userId)
  }
  return map
}

const shouldBackfillLimit = (value) => {
  const parsed = Number(value)
  return !Number.isFinite(parsed) || Math.floor(parsed) < 1
}

export const buildBackfillPlan = ({
  customers = [],
  activeAdminMap = new Map(),
  defaultLicenseLevelId,
} = {}) => {
  const defaultLicenseIdString = toIdString(defaultLicenseLevelId)
  if (!defaultLicenseIdString) {
    throw new Error('buildBackfillPlan requires defaultLicenseLevelId')
  }

  const summary = {
    totalCustomers: customers.length,
    pendingUpdates: 0,
    licenseLevelBackfilled: 0,
    governanceMaxTenantsBackfilled: 0,
    governanceMaxVmfsPerTenantBackfilled: 0,
    canonicalAdminBackfilled: 0,
    activeCustomersWithZeroAdmins: 0,
    activeCustomersWithMultipleAdmins: 0,
  }

  const remediation = []
  const operations = []

  for (const customer of customers) {
    const updateSet = {}
    const customerId = toIdString(customer?._id)

    if (!customer?.licenseLevelId) {
      updateSet.licenseLevelId = defaultLicenseLevelId
      summary.licenseLevelBackfilled += 1
    }

    if (shouldBackfillLimit(customer?.governance?.maxTenants)) {
      updateSet['governance.maxTenants'] = DEFAULT_MAX_TENANTS
      summary.governanceMaxTenantsBackfilled += 1
    }

    if (shouldBackfillLimit(customer?.governance?.maxVmfsPerTenant)) {
      updateSet['governance.maxVmfsPerTenant'] = DEFAULT_MAX_VMFS_PER_TENANT
      summary.governanceMaxVmfsPerTenantBackfilled += 1
    }

    if (customer?.status === ACTIVE_CUSTOMER_STATUS) {
      const activeAdminUserIds = [...(activeAdminMap.get(customerId) || [])]
      const canonicalAdminUserId = toIdString(customer?.governance?.customerAdminUserId)

      if (activeAdminUserIds.length === 0) {
        summary.activeCustomersWithZeroAdmins += 1
        remediation.push({
          customerId,
          customerName: customer?.name || null,
          reason: 'ZERO_ACTIVE_CUSTOMER_ADMINS',
          canonicalAdminUserId,
          activeAdminUserIds,
        })
      } else if (activeAdminUserIds.length > 1) {
        summary.activeCustomersWithMultipleAdmins += 1
        remediation.push({
          customerId,
          customerName: customer?.name || null,
          reason: 'MULTIPLE_ACTIVE_CUSTOMER_ADMINS',
          canonicalAdminUserId,
          activeAdminUserIds,
        })
      } else if (canonicalAdminUserId !== activeAdminUserIds[0]) {
        updateSet['governance.customerAdminUserId'] = activeAdminUserIds[0]
        summary.canonicalAdminBackfilled += 1
      }
    }

    if (Object.keys(updateSet).length > 0) {
      operations.push({
        updateOne: {
          filter: { _id: customer._id },
          update: { $set: updateSet },
        },
      })
      summary.pendingUpdates += 1
    }
  }

  return { summary, remediation, operations }
}

const resolveSystemActorUserId = async () => {
  if (env.systemActorUserId) {
    return env.systemActorUserId
  }

  const superAdmin = await User.findOne({
    memberships: { $elemMatch: { customerId: null, roles: 'SUPER_ADMIN' } },
  }).select('_id')

  if (!superAdmin?._id) {
    throw new Error('Unable to resolve system actor user. Set SYSTEM_ACTOR_USER_ID or seed SUPER_ADMIN.')
  }

  return superAdmin._id
}

const loadCustomersForBackfill = async () =>
  Customer.find({})
    .select('_id name status licenseLevelId governance')
    .lean()

const loadActiveAdminMembershipRows = async () =>
  User.aggregate([
    { $match: { isActive: true } },
    { $unwind: '$memberships' },
    {
      $match: {
        'memberships.customerId': { $ne: null },
        'memberships.roles': CUSTOMER_ADMIN_ROLE,
      },
    },
    {
      $project: {
        userId: '$_id',
        customerId: '$memberships.customerId',
      },
    },
  ])

const printBackfillSummary = (summary, remediation, apply, logger) => {
  logger(`[backfill] mode=${apply ? 'apply' : 'dry-run'}`)
  logger(`[backfill] total customers: ${summary.totalCustomers}`)
  logger(`[backfill] pending updates: ${summary.pendingUpdates}`)
  logger(`[backfill] licenseLevelId backfills: ${summary.licenseLevelBackfilled}`)
  logger(`[backfill] governance.maxTenants backfills: ${summary.governanceMaxTenantsBackfilled}`)
  logger(
    `[backfill] governance.maxVmfsPerTenant backfills: ${summary.governanceMaxVmfsPerTenantBackfilled}`,
  )
  logger(`[backfill] governance.customerAdminUserId backfills: ${summary.canonicalAdminBackfilled}`)
  logger(`[backfill] active customers with zero admins: ${summary.activeCustomersWithZeroAdmins}`)
  logger(
    `[backfill] active customers with multiple admins: ${summary.activeCustomersWithMultipleAdmins}`,
  )
  logger(`[backfill] remediation rows: ${remediation.length}`)
}

export const runBackfillCustomerLicenseGovernance = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const {
    connect = connectDb,
    disconnect = disconnectDb,
  } = dependencies

  await connect()

  try {
    const actorUserId = await resolveSystemActorUserId()
    const defaultLicenseLevel = await seedDefaultLicenseLevel({ actorUserId })

    const [customers, activeAdminMembershipRows] = await Promise.all([
      loadCustomersForBackfill(),
      loadActiveAdminMembershipRows(),
    ])

    const activeAdminMap = buildActiveAdminMap(activeAdminMembershipRows)
    const plan = buildBackfillPlan({
      customers,
      activeAdminMap,
      defaultLicenseLevelId: defaultLicenseLevel._id,
    })

    let appliedOperations = 0
    if (apply && plan.operations.length > 0) {
      await Customer.bulkWrite(plan.operations, { ordered: false })
      appliedOperations = plan.operations.length
    }

    const result = {
      mode: apply ? 'apply' : 'dry-run',
      defaultLicenseLevelId: toIdString(defaultLicenseLevel._id),
      summary: plan.summary,
      appliedOperations,
      remediation: plan.remediation,
    }

    if (json) {
      logger(JSON.stringify(result, null, 2))
    } else {
      printBackfillSummary(plan.summary, plan.remediation, apply, logger)
      if (plan.remediation.length > 0) {
        logger('[backfill] remediation detail:')
        for (const row of plan.remediation) {
          logger(
            `  - customerId=${row.customerId} reason=${row.reason} canonical=${row.canonicalAdminUserId || 'null'} activeAdmins=${row.activeAdminUserIds.join(',') || 'none'}`,
          )
        }
      }
      if (apply) {
        logger(`[backfill] applied operations: ${appliedOperations}`)
      } else {
        logger('[backfill] no writes were performed (dry-run). Re-run with --apply to persist.')
      }
    }

    return result
  } finally {
    try {
      await disconnect()
    } catch {
      // ignore disconnect failures in scripts
    }
  }
}

const runFromCli = async () => {
  const { apply, json } = parseArgs()

  try {
    await runBackfillCustomerLicenseGovernance({ apply, json })
    process.exit(0)
  } catch (err) {
    console.error('[backfill] failed:', err.message)
    process.exit(1)
  }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  runFromCli()
}
