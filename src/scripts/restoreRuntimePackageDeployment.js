import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage, {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_VISIBILITY,
} from '../models/FrameworkPackage.js'
import RuntimeDeployment, {
  RUNTIME_DEPLOYMENT_STATUSES,
} from '../models/RuntimeDeployment.js'
import RuntimeActivationSnapshot, {
  RUNTIME_ACTIVATION_STATUSES,
} from '../models/RuntimeActivationSnapshot.js'

const DEFAULT_TENANT_SCOPE = 'GLOBAL'
const DEFAULT_DEPLOYMENT_MODE = 'PRODUCTION'

const DEFAULT_MODELS = Object.freeze({
  FrameworkPackage,
  RuntimeDeployment,
  RuntimeActivationSnapshot,
})

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    customerVisible: false,
    deploymentMode: DEFAULT_DEPLOYMENT_MODE,
    help: false,
    json: false,
    packageKey: '',
    tenantScope: DEFAULT_TENANT_SCOPE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--customer-visible') args.customerVisible = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--package-key') {
      args.packageKey = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--tenant-scope') {
      args.tenantScope = String(argv[index + 1] || '').trim().toUpperCase()
      index += 1
    } else if (arg === '--deployment-mode') {
      args.deploymentMode = String(argv[index + 1] || '').trim().toUpperCase()
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`)
    }
  }

  if (!args.help && !args.packageKey) {
    throw new Error('--package-key is required. Run with --help for usage.')
  }

  return args
}

const stringifyId = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const queryOne = async (query) => {
  const selected = typeof query?.select === 'function'
    ? query.select('_id frameworkKey version packageKey status visibility customerAccessMode assignedCustomerIds isDefault')
    : query
  const leanQuery = typeof selected?.lean === 'function' ? selected.lean() : selected
  return leanQuery
}

const queryOneSortedLean = async (query, sort) => {
  const sorted = typeof query?.sort === 'function' ? query.sort(sort) : query
  const leanQuery = typeof sorted?.lean === 'function' ? sorted.lean() : sorted
  return leanQuery
}

const buildPackageUpdate = ({ packageRecord, customerVisible }) => {
  if (!customerVisible) return null

  const nextVisibility = FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE
  const nextAccessMode = FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS
  const assignedCustomerIds = Array.isArray(packageRecord.assignedCustomerIds)
    ? packageRecord.assignedCustomerIds
    : []
  const needsUpdate = packageRecord.visibility !== nextVisibility
    || packageRecord.customerAccessMode !== nextAccessMode
    || assignedCustomerIds.length > 0

  if (!needsUpdate) return null

  return {
    visibility: nextVisibility,
    customerAccessMode: nextAccessMode,
    assignedCustomerIds: [],
  }
}

export const buildRuntimePackageDeploymentRestorePlan = async ({
  packageKey,
  tenantScope = DEFAULT_TENANT_SCOPE,
  deploymentMode = DEFAULT_DEPLOYMENT_MODE,
  customerVisible = false,
  dependencies = {},
} = {}) => {
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }
  const normalizedPackageKey = String(packageKey || '').trim()
  if (!normalizedPackageKey) {
    throw new Error('packageKey is required.')
  }

  const packageRecord = await queryOne(
    models.FrameworkPackage.findOne({ packageKey: normalizedPackageKey }),
  )
  if (!packageRecord) {
    throw new Error(`Framework package not found: ${normalizedPackageKey}`)
  }
  if (packageRecord.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw new Error(
      `Framework package ${normalizedPackageKey} must be ACTIVE before restoring deployment evidence. Current status: ${packageRecord.status}`,
    )
  }

  const deployment = await queryOneSortedLean(
    models.RuntimeDeployment.findOne({
      frameworkKey: packageRecord.frameworkKey,
      packageId: packageRecord._id,
      tenantScope,
      deploymentMode,
    }),
    { registeredAt: -1, createdAt: -1 },
  )
  if (!deployment) {
    throw new Error(`Runtime deployment not found for package: ${normalizedPackageKey}`)
  }

  const snapshot = await queryOneSortedLean(
    models.RuntimeActivationSnapshot.findOne({
      activationId: deployment.activationId,
      packageId: packageRecord._id,
    }),
    { activatedAt: -1, createdAt: -1 },
  )
  if (!snapshot) {
    throw new Error(`Runtime activation snapshot not found for deployment: ${deployment.deploymentId}`)
  }

  const packageUpdate = buildPackageUpdate({ packageRecord, customerVisible })
  const deploymentNeedsRestore = Boolean(
    deployment.status !== RUNTIME_DEPLOYMENT_STATUSES.ACTIVE
    || deployment.supersededAt
    || deployment.supersededByDeploymentId,
  )
  const snapshotNeedsRestore = Boolean(
    snapshot.activationStatus !== RUNTIME_ACTIVATION_STATUSES.ACTIVE
    || snapshot.supersededByActivationId,
  )

  return {
    ok: true,
    package: {
      id: stringifyId(packageRecord._id),
      packageKey: packageRecord.packageKey,
      frameworkKey: packageRecord.frameworkKey,
      version: packageRecord.version,
      status: packageRecord.status,
      isDefault: packageRecord.isDefault === true,
      visibility: packageRecord.visibility,
      customerAccessMode: packageRecord.customerAccessMode,
    },
    deployment: {
      id: stringifyId(deployment._id),
      deploymentId: deployment.deploymentId,
      activationId: deployment.activationId,
      status: deployment.status,
      tenantScope: deployment.tenantScope,
      deploymentMode: deployment.deploymentMode,
    },
    snapshot: {
      id: stringifyId(snapshot._id),
      activationId: snapshot.activationId,
      activationStatus: snapshot.activationStatus,
    },
    actions: {
      packageAccessUpdate: packageUpdate,
      restoreDeployment: deploymentNeedsRestore,
      restoreActivationSnapshot: snapshotNeedsRestore,
    },
  }
}

const applyRestorePlan = async ({ plan, models, session }) => {
  if (plan.actions.packageAccessUpdate) {
    await models.FrameworkPackage.updateOne(
      { _id: plan.package.id },
      { $set: plan.actions.packageAccessUpdate },
      { session },
    )
  }

  if (plan.actions.restoreDeployment) {
    await models.RuntimeDeployment.updateOne(
      { _id: plan.deployment.id },
      {
        $set: {
          status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
          supersededAt: null,
          supersededByDeploymentId: null,
        },
      },
      { session },
    )
  }

  if (plan.actions.restoreActivationSnapshot) {
    await models.RuntimeActivationSnapshot.updateOne(
      { _id: plan.snapshot.id },
      {
        $set: {
          activationStatus: RUNTIME_ACTIVATION_STATUSES.ACTIVE,
          supersededByActivationId: null,
        },
      },
      { session },
    )
  }
}

const hasPlannedAction = (plan) =>
  Boolean(plan.actions.packageAccessUpdate)
  || plan.actions.restoreDeployment
  || plan.actions.restoreActivationSnapshot

export const restoreRuntimePackageDeployment = async ({
  apply = false,
  customerVisible = false,
  deploymentMode = DEFAULT_DEPLOYMENT_MODE,
  json = false,
  logger = console.log,
  packageKey,
  tenantScope = DEFAULT_TENANT_SCOPE,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }

  await connect()

  try {
    const plan = await buildRuntimePackageDeploymentRestorePlan({
      packageKey,
      tenantScope,
      deploymentMode,
      customerVisible,
      dependencies: { models },
    })
    const summary = {
      ...plan,
      mode: apply ? 'apply' : 'dry-run',
      applied: false,
    }

    if (apply && hasPlannedAction(plan)) {
      const session = await startSession()
      try {
        await session.withTransaction(async () => {
          await applyRestorePlan({ plan, models, session })
        })
      } finally {
        await session.endSession()
      }
      summary.applied = true
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : `${apply ? 'Applied' : 'Dry run'} runtime package deployment restore for ${summary.package.packageKey}: applied=${summary.applied}.`,
    )
    return summary
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

const printHelp = () => {
  console.log(`
restoreRuntimePackageDeployment.js

Usage:
  node src/scripts/restoreRuntimePackageDeployment.js --package-key <key> [--apply] [--customer-visible] [--json]

Options:
  --package-key <key>      Required FrameworkPackage packageKey to restore.
  --customer-visible       Also set package visibility to CUSTOMER_VISIBLE and ALL_CUSTOMERS.
  --tenant-scope <scope>   Defaults to GLOBAL.
  --deployment-mode <mode> Defaults to PRODUCTION.
  --apply                  Apply the planned restore. Omit for dry-run.
  --json                   Print machine-readable JSON.
  --help                   Show this help.

Safety:
  This command only targets one ACTIVE package key. It does not create missing
  activation evidence and it does not alter any other package version.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  restoreRuntimePackageDeployment(args)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
