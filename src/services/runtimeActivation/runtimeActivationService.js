import mongoose from 'mongoose'
import FrameworkPackage, { FRAMEWORK_PACKAGE_STATUSES } from '../../models/FrameworkPackage.js'
import RuntimeActivationSnapshot, {
  RUNTIME_ACTIVATION_STATUSES,
} from '../../models/RuntimeActivationSnapshot.js'
import RuntimeDeployment, {
  RUNTIME_DEPLOYMENT_STATUSES,
} from '../../models/RuntimeDeployment.js'

export const RUNTIME_ACTIVATION_TENANT_SCOPE = 'GLOBAL'
export const RUNTIME_ACTIVATION_DEPLOYMENT_MODE = 'PRODUCTION'

const CHECKPOINT_ALLOWED_STATUSES = new Set(['PASS', 'PASS_WITH_WARNINGS'])

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  return String(value)
}

const normalizeStatus = (value) => String(value || '').trim().toUpperCase()

const toNullableObjectId = (value) => {
  if (!value || !mongoose.isValidObjectId(value)) return null
  return new mongoose.Types.ObjectId(value)
}

const toValidDate = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const serializeDoc = (doc) => {
  if (!doc) return null
  const ret = typeof doc.toJSON === 'function'
    ? doc.toJSON()
    : typeof doc.toObject === 'function'
      ? doc.toObject()
      : { ...doc }
  if (ret._id) {
    ret.id = String(ret._id)
    delete ret._id
  }
  delete ret.__v
  return ret
}

const buildActivationId = ({ frameworkKey, version, activatedAt, packageId }) => {
  const suffix = toIdString(packageId).slice(-8) || new mongoose.Types.ObjectId().toString().slice(-8)
  const timestamp = activatedAt.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `activation-${String(frameworkKey || '').toLowerCase()}-${String(version || '').replace(/\./g, '-')}-${timestamp}-${suffix}`
}

const buildDeploymentId = ({ frameworkKey, tenantScope, deploymentMode, activationId }) =>
  `deployment-${String(frameworkKey || '').toLowerCase()}-${String(tenantScope || '').toLowerCase()}-${String(deploymentMode || '').toLowerCase()}-${String(activationId || '').slice(-24)}`

export const normalizeRuntimeActivationReadiness = ({
  frameworkPackage,
  checkpoint = null,
  activeDeployment = null,
} = {}) => {
  const packageStatus = normalizeStatus(frameworkPackage?.status)
  const checkpointStatus = normalizeStatus(checkpoint?.status || frameworkPackage?.lastCheckpointStatus)
  const runtimeVerdict = frameworkPackage?.runtimeVerdict || null
  const runtimeVerdictResult = normalizeStatus(runtimeVerdict?.result || runtimeVerdict?.decision)
  const runtimeVerdictDependencyLockState = normalizeStatus(runtimeVerdict?.dependencyLockState)
  const runtimeVerdictAuditPersisted = runtimeVerdict?.auditPersisted === true
  const runtimeVerdictLastValidatedAt = toValidDate(runtimeVerdict?.lastValidatedAt)
  const packageUpdatedAt = toValidDate(frameworkPackage?.updatedAt)
  const dependencyLock = frameworkPackage?.dependencyLock || null
  const dependencyLockStatus = normalizeStatus(dependencyLock?.status)
  const dependencyLockResolvedAt = toValidDate(dependencyLock?.resolvedAt || dependencyLock?.lockedAt)
  const dependencyLockReferences = Array.isArray(dependencyLock?.references)
    ? dependencyLock.references
    : []
  const runtimeVerdictStale =
    runtimeVerdictResult === 'ALLOW'
    && runtimeVerdictLastValidatedAt
    && (
      (packageUpdatedAt && packageUpdatedAt > runtimeVerdictLastValidatedAt)
      || (dependencyLockResolvedAt && dependencyLockResolvedAt > runtimeVerdictLastValidatedAt)
    )
  const runtimeVerdictCertified =
    runtimeVerdictResult === 'ALLOW'
    && runtimeVerdictAuditPersisted
    && runtimeVerdictDependencyLockState === 'LOCKED'
    && Boolean(runtimeVerdictLastValidatedAt)
    && !runtimeVerdictStale
  let runtimeVerdictReason = 'RUNTIME_VERDICT_MISSING'
  if (runtimeVerdictCertified) {
    runtimeVerdictReason = 'RUNTIME_VERDICT_ALLOW'
  } else if (runtimeVerdictResult && runtimeVerdictResult !== 'ALLOW') {
    runtimeVerdictReason = 'RUNTIME_VERDICT_BLOCKED'
  } else if (runtimeVerdictResult === 'ALLOW' && (!runtimeVerdictAuditPersisted || !runtimeVerdictLastValidatedAt)) {
    runtimeVerdictReason = 'RUNTIME_VERDICT_NOT_CERTIFIED'
  } else if (runtimeVerdictResult === 'ALLOW' && runtimeVerdictDependencyLockState !== 'LOCKED') {
    runtimeVerdictReason = 'RUNTIME_VERDICT_DEPENDENCY_LOCK_NOT_CERTIFIED'
  } else if (runtimeVerdictStale) {
    runtimeVerdictReason = 'RUNTIME_VERDICT_STALE'
  }

  const requirements = [
    {
      key: 'packageStatus',
      status: packageStatus === FRAMEWORK_PACKAGE_STATUSES.VALIDATED ? 'PASS' : 'FAIL',
      reason: packageStatus === FRAMEWORK_PACKAGE_STATUSES.VALIDATED
        ? 'FRAMEWORK_PACKAGE_VALIDATED'
        : 'FRAMEWORK_PACKAGE_ACTIVATION_REQUIRES_VALIDATED',
      message: packageStatus === FRAMEWORK_PACKAGE_STATUSES.VALIDATED
        ? 'Package is validated.'
        : 'Only validated framework packages can be activated.',
    },
    {
      key: 'checkpoint',
      status: CHECKPOINT_ALLOWED_STATUSES.has(checkpointStatus) ? 'PASS' : 'FAIL',
      reason: CHECKPOINT_ALLOWED_STATUSES.has(checkpointStatus)
        ? 'RUNTIME_CHECKPOINT_READY'
        : 'RUNTIME_CHECKPOINT_NOT_READY',
      message: CHECKPOINT_ALLOWED_STATUSES.has(checkpointStatus)
        ? 'Checkpoint evidence allows activation.'
        : 'Latest checkpoint must be PASS or PASS_WITH_WARNINGS before activation.',
    },
    {
      key: 'runtimeVerdict',
      status: runtimeVerdictCertified ? 'PASS' : 'FAIL',
      reason: runtimeVerdictReason,
      message: runtimeVerdictCertified
        ? 'Runtime Validation verdict allows activation.'
        : 'Latest certified Runtime Validation verdict must be ALLOW before activation.',
    },
    {
      key: 'dependencyLock',
      status: dependencyLockStatus === 'PASS' && dependencyLockReferences.length > 0 ? 'PASS' : 'FAIL',
      reason: dependencyLockStatus === 'PASS' && dependencyLockReferences.length > 0
        ? 'DEPENDENCY_LOCK_LOCKED'
        : 'DEPENDENCY_LOCK_NOT_LOCKED',
      message: dependencyLockStatus === 'PASS' && dependencyLockReferences.length > 0
        ? 'Dependency lock evidence is certified.'
        : 'A locked dependency snapshot is required before activation.',
    },
    {
      key: 'activeDeployment',
      status: activeDeployment ? 'WARN' : 'PASS',
      reason: activeDeployment ? 'RUNTIME_DEPLOYMENT_WILL_SUPERSEDE' : 'RUNTIME_DEPLOYMENT_NO_CONFLICT',
      message: activeDeployment
        ? 'Existing active deployment will be superseded.'
        : 'No active runtime deployment conflict exists.',
    },
  ]

  const blockingRequirements = requirements.filter((item) => item.status === 'FAIL')
  return {
    ready: blockingRequirements.length === 0,
    status: blockingRequirements.length === 0 ? 'READY' : 'BLOCKED',
    packageStatus,
    checkpointStatus: checkpointStatus || 'NOT_RUN',
    runtimeVerdict: runtimeVerdict
      ? {
          id: runtimeVerdict.validationId || runtimeVerdict.auditId || '',
          result: runtimeVerdictResult || '',
          status: runtimeVerdict.status || '',
          mode: runtimeVerdict.mode || '',
          lastValidatedAt: runtimeVerdict.lastValidatedAt || null,
          auditPersisted: runtimeVerdict.auditPersisted === true,
          dependencyLockState: runtimeVerdictDependencyLockState || '',
          stale: runtimeVerdictStale,
        }
      : null,
    dependencyLockState: dependencyLockStatus === 'PASS' && dependencyLockReferences.length > 0
      ? 'LOCKED'
      : 'NOT_LOCKED',
    dependencySnapshotId: dependencyLock?.snapshotId || '',
    dependencyReferenceCount: dependencyLockReferences.length,
    supersedesDeploymentId: activeDeployment?.deploymentId || null,
    requirements,
    blockingReasons: blockingRequirements.map((item) => item.reason),
  }
}

export const getActiveRuntimeDeployment = async ({
  frameworkKey,
  tenantScope = RUNTIME_ACTIVATION_TENANT_SCOPE,
  deploymentMode = RUNTIME_ACTIVATION_DEPLOYMENT_MODE,
  session = null,
} = {}) => {
  const query = RuntimeDeployment.findOne({
    frameworkKey,
    tenantScope,
    deploymentMode,
    status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
  })

  return session && typeof query.session === 'function'
    ? query.session(session)
    : query
}

export const getRuntimeActivationReadiness = async ({
  packageId,
  frameworkPackage = null,
  checkpoint = null,
} = {}) => {
  const packageRecord = frameworkPackage || await FrameworkPackage.findById(packageId)
  if (!packageRecord) return null

  const activeDeployment = await getActiveRuntimeDeployment({
    frameworkKey: packageRecord.frameworkKey,
  })

  return normalizeRuntimeActivationReadiness({
    frameworkPackage: packageRecord,
    checkpoint,
    activeDeployment,
  })
}

export const assertRuntimeActivationReadiness = (readiness) => {
  if (readiness?.ready) return
  const error = new Error('Runtime activation readiness requirements are not met.')
  error.code = 'RUNTIME_ACTIVATION_READINESS_BLOCKED'
  error.details = {
    reason: readiness?.blockingReasons?.[0] || 'RUNTIME_ACTIVATION_READINESS_BLOCKED',
    readiness,
  }
  throw error
}

export const registerRuntimeActivation = async ({
  frameworkPackage,
  actorUserId,
  activatedAt,
  checkpoint,
  readiness,
  session,
} = {}) => {
  const tenantScope = RUNTIME_ACTIVATION_TENANT_SCOPE
  const deploymentMode = RUNTIME_ACTIVATION_DEPLOYMENT_MODE
  const previousDeployment = await getActiveRuntimeDeployment({
    frameworkKey: frameworkPackage.frameworkKey,
    tenantScope,
    deploymentMode,
    session,
  })
  const activationId = buildActivationId({
    frameworkKey: frameworkPackage.frameworkKey,
    version: frameworkPackage.version,
    activatedAt,
    packageId: frameworkPackage._id,
  })
  const deploymentId = buildDeploymentId({
    frameworkKey: frameworkPackage.frameworkKey,
    tenantScope,
    deploymentMode,
    activationId,
  })

  if (previousDeployment) {
    await RuntimeDeployment.updateOne(
      { _id: previousDeployment._id },
      {
        $set: {
          status: RUNTIME_DEPLOYMENT_STATUSES.SUPERSEDED,
          supersededAt: activatedAt,
          supersededByDeploymentId: deploymentId,
        },
      },
      { session },
    )
    await RuntimeActivationSnapshot.updateOne(
      { activationId: previousDeployment.activationId },
      {
        $set: {
          activationStatus: RUNTIME_ACTIVATION_STATUSES.SUPERSEDED,
          supersededByActivationId: activationId,
        },
      },
      { session },
    )
  }

  const snapshotPayload = {
    activationId,
    deploymentId,
    packageId: frameworkPackage._id,
    packageKey: frameworkPackage.packageKey || '',
    frameworkKey: frameworkPackage.frameworkKey,
    frameworkVersion: frameworkPackage.version,
    packageStatusAtActivation: FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
    activationStatus: RUNTIME_ACTIVATION_STATUSES.ACTIVE,
    dependencySnapshotId: frameworkPackage.dependencyLock?.snapshotId || '',
    dependencySnapshotHash: frameworkPackage.dependencyLock?.snapshotHash || frameworkPackage.dependencyLock?.hash || '',
    checkpointId: checkpoint?.checkpointId || checkpoint?.id || '',
    checkpointStatus: checkpoint?.status || '',
    runtimeVerdictId: frameworkPackage.runtimeVerdict?.validationId || frameworkPackage.runtimeVerdict?.auditId || '',
    runtimeVerdictResult: frameworkPackage.runtimeVerdict?.result || frameworkPackage.runtimeVerdict?.decision || '',
    deploymentGraph: checkpoint?.dependencyGraph || null,
    tenantScope,
    deploymentMode,
    activatedAt,
    activatedBy: toNullableObjectId(actorUserId),
    supersedesActivationId: previousDeployment?.activationId || null,
  }
  const deploymentPayload = {
    deploymentId,
    activationId,
    packageId: frameworkPackage._id,
    packageKey: frameworkPackage.packageKey || '',
    frameworkKey: frameworkPackage.frameworkKey,
    frameworkVersion: frameworkPackage.version,
    status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
    tenantScope,
    deploymentMode,
    registeredAt: activatedAt,
    registeredBy: toNullableObjectId(actorUserId),
    isRollbackDeployment: false,
  }

  const snapshot = await RuntimeActivationSnapshot.create([snapshotPayload], { session })
  const deployment = await RuntimeDeployment.create([deploymentPayload], { session })

  return {
    readiness,
    activationSnapshot: serializeDoc(snapshot?.[0]),
    deployment: serializeDoc(deployment?.[0]),
    supersededDeployment: previousDeployment ? serializeDoc(previousDeployment) : null,
  }
}
