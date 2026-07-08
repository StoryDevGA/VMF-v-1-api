import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeDeployment, { RUNTIME_DEPLOYMENT_STATUSES } from '../models/RuntimeDeployment.js'
import RuntimeActivationSnapshot, {
  RUNTIME_ACTIVATION_STATUSES,
} from '../models/RuntimeActivationSnapshot.js'
import { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import { RUNTIME_CONTROL_VERSION_STATUSES } from '../utils/runtimeControlVersioning.js'

const DEFAULT_PACKAGE_KEY = 'standard-package-vmf-3-1-1-rkm'
const CONFIRM_REPAIR = '--confirm-repair-active-release-metadata'

const DEFAULT_MODELS = Object.freeze({
  FrameworkPackage,
  RuntimeDeployment,
  RuntimeActivationSnapshot,
})

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    confirmed: false,
    help: false,
    json: false,
    packageKey: DEFAULT_PACKAGE_KEY,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === CONFIRM_REPAIR) args.confirmed = true
    else if (arg === '--package-key') {
      args.packageKey = String(argv[index + 1] || '').trim()
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

const usage = () => `
Repair active Framework Package release metadata after a seed replacement drift.

Dry-run:
  npm run framework-packages:repair-release-metadata -- --package-key ${DEFAULT_PACKAGE_KEY} --json

Apply:
  npm run framework-packages:repair-release-metadata -- --apply ${CONFIRM_REPAIR} --package-key ${DEFAULT_PACKAGE_KEY} --json
`

const toPlainObject = (value) => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  return String(value)
}

const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const normalizeStatus = (value) => String(value || '').trim().toUpperCase()

const sessionQuery = (query, session) => {
  if (session && typeof query?.session === 'function') return query.session(session)
  return query
}

const findRepairInputs = async ({ packageKey, models, session = null }) => {
  const frameworkPackage = await sessionQuery(
    models.FrameworkPackage.findOne({ packageKey: normalizeKey(packageKey) }),
    session,
  )
  if (!frameworkPackage) return { frameworkPackage: null, deployment: null, activationSnapshot: null }

  const deployment = await sessionQuery(
    models.RuntimeDeployment.findOne({
      packageId: frameworkPackage._id,
      frameworkKey: frameworkPackage.frameworkKey,
      status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
    }),
    session,
  )

  const activationSnapshot = deployment?.activationId
    ? await sessionQuery(
      models.RuntimeActivationSnapshot.findOne({
        packageId: frameworkPackage._id,
        activationId: deployment.activationId,
        activationStatus: RUNTIME_ACTIVATION_STATUSES.ACTIVE,
      }),
      session,
    )
    : null

  return { frameworkPackage, deployment, activationSnapshot }
}

const buildReleaseMetadataRepairPlan = ({
  frameworkPackage,
  deployment,
  activationSnapshot,
}) => {
  const packageRow = toPlainObject(frameworkPackage)
  const deploymentRow = toPlainObject(deployment)
  const activationRow = toPlainObject(activationSnapshot)

  if (!packageRow) throw new Error('Framework Package not found.')
  if (normalizeStatus(packageRow.status) !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw new Error(`Framework Package must be ACTIVE; current status is ${packageRow.status || 'UNKNOWN'}.`)
  }
  if (packageRow.isLocked !== true) {
    throw new Error('Framework Package must be locked before release metadata can be repaired.')
  }
  if (!deploymentRow || normalizeStatus(deploymentRow.status) !== RUNTIME_DEPLOYMENT_STATUSES.ACTIVE) {
    throw new Error('Active runtime deployment not found for Framework Package.')
  }
  if (!activationRow || normalizeStatus(activationRow.activationStatus) !== RUNTIME_ACTIVATION_STATUSES.ACTIVE) {
    throw new Error('Active runtime activation snapshot not found for Framework Package deployment.')
  }
  if (String(deploymentRow.activationId || '').trim() !== String(activationRow.activationId || '').trim()) {
    throw new Error('Active runtime deployment and activation snapshot do not reference the same activation id.')
  }

  const dependencySnapshotId = String(activationRow.dependencySnapshotId || '').trim()
  const dependencySnapshotHash = String(activationRow.dependencySnapshotHash || '').trim()
  if (!dependencySnapshotId || !dependencySnapshotHash) {
    throw new Error('Active runtime activation snapshot is missing dependency snapshot evidence.')
  }

  const currentDependencyLock = packageRow.dependencyLock && typeof packageRow.dependencyLock === 'object'
    ? packageRow.dependencyLock
    : {}
  const currentUiContractBinding = packageRow.uiContractBinding && typeof packageRow.uiContractBinding === 'object'
    ? packageRow.uiContractBinding
    : {}
  const resolvedAt = currentDependencyLock.resolvedAt
    || packageRow.lockedAt
    || activationRow.activatedAt
    || new Date()
  const resolvedBy = currentDependencyLock.resolvedBy
    || packageRow.lockedBy
    || packageRow.activatedBy
    || null

  const repairedFields = {
    versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
    dependencyLock: {
      ...currentDependencyLock,
      snapshotId: dependencySnapshotId,
      snapshotHash: dependencySnapshotHash,
      status: 'PASS',
      resolvedAt,
      resolvedBy,
      packageKey: packageRow.packageKey,
      packageVersion: packageRow.version,
      references: Array.isArray(currentDependencyLock.references)
        ? currentDependencyLock.references
        : [],
    },
    uiContractBinding: {
      ...currentUiContractBinding,
      key: normalizeKey(packageRow.uiContractKey || currentUiContractBinding.key),
      version: currentUiContractBinding.version || packageRow.version,
      status: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
      compatibilityMode: normalizeStatus(currentUiContractBinding.compatibilityMode || 'INHERITED_MINOR'),
      resolvedAt: currentUiContractBinding.resolvedAt || packageRow.activatedAt || activationRow.activatedAt || new Date(),
    },
  }

  return {
    packageKey: packageRow.packageKey,
    version: packageRow.version,
    packageId: toIdString(packageRow._id || packageRow.id),
    deploymentId: deploymentRow.deploymentId || '',
    activationId: activationRow.activationId || '',
    before: {
      status: packageRow.status,
      versionStatus: packageRow.versionStatus || '',
      dependencyLock: {
        snapshotId: currentDependencyLock.snapshotId || '',
        snapshotHash: currentDependencyLock.snapshotHash || currentDependencyLock.hash || '',
        status: currentDependencyLock.status || '',
        packageKey: currentDependencyLock.packageKey || '',
        packageVersion: currentDependencyLock.packageVersion || '',
        references: Array.isArray(currentDependencyLock.references) ? currentDependencyLock.references.length : 0,
      },
      uiContractBinding: {
        key: currentUiContractBinding.key || '',
        version: currentUiContractBinding.version || '',
        status: currentUiContractBinding.status || '',
      },
    },
    after: {
      versionStatus: repairedFields.versionStatus,
      dependencyLock: {
        snapshotId: repairedFields.dependencyLock.snapshotId,
        snapshotHash: repairedFields.dependencyLock.snapshotHash,
        status: repairedFields.dependencyLock.status,
        packageKey: repairedFields.dependencyLock.packageKey,
        packageVersion: repairedFields.dependencyLock.packageVersion,
        references: repairedFields.dependencyLock.references.length,
      },
      uiContractBinding: {
        key: repairedFields.uiContractBinding.key,
        version: repairedFields.uiContractBinding.version,
        status: repairedFields.uiContractBinding.status,
      },
    },
    update: repairedFields,
  }
}

const repairActiveFrameworkPackageReleaseMetadata = async ({
  apply = false,
  confirmed = false,
  json = false,
  logger = console.log,
  packageKey = DEFAULT_PACKAGE_KEY,
  dependencies = {},
} = {}) => {
  if (!packageKey) throw new Error('--package-key is required.')
  if (apply && !confirmed) throw new Error(`Apply mode requires ${CONFIRM_REPAIR}.`)

  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }

  await connect()
  try {
    const inputs = await findRepairInputs({ packageKey, models })
    const plan = buildReleaseMetadataRepairPlan(inputs)
    const result = {
      ...plan,
      update: undefined,
      mode: apply ? 'apply' : 'dry-run',
      applied: false,
    }

    if (apply) {
      const session = await startSession()
      try {
        await session.withTransaction(async () => {
          const freshInputs = await findRepairInputs({ packageKey, models, session })
          const freshPlan = buildReleaseMetadataRepairPlan(freshInputs)
          freshInputs.frameworkPackage.set(freshPlan.update)
          await freshInputs.frameworkPackage.save({ session })
          result.before = freshPlan.before
          result.after = freshPlan.after
          result.activationId = freshPlan.activationId
          result.deploymentId = freshPlan.deploymentId
        })
      } finally {
        await session.endSession()
      }
      result.applied = true
    }

    logger(json ? JSON.stringify(result, null, 2) : `${apply ? 'Applied' : 'Dry run'} release metadata repair for ${result.packageKey}: applied=${result.applied}.`)
    return result
  } finally {
    await disconnect()
  }
}

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  let args
  try {
    args = parseArgs()
    if (args.help) {
      console.log(usage())
      process.exit(0)
    }
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(1)
  }

  repairActiveFrameworkPackageReleaseMetadata(args)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}

export {
  buildReleaseMetadataRepairPlan,
  parseArgs,
  repairActiveFrameworkPackageReleaseMetadata,
}
