import mongoose from 'mongoose'
import {
  Customer,
  FrameworkPackage,
  RuntimeActivationSnapshot,
  RuntimeDeployment,
  RuntimeInstance,
  Role,
  Tenant,
} from '../models/index.js'
import { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import { RUNTIME_ACTIVATION_STATUSES } from '../models/RuntimeActivationSnapshot.js'
import { RUNTIME_DEPLOYMENT_STATUSES } from '../models/RuntimeDeployment.js'
import {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_MODES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import { resolveCustomerFeatureEntitlements } from './licenseEntitlementService.js'
import { isFrameworkPackageAvailableToCustomer } from './frameworkPackageAvailabilityService.js'
import customerGovernanceService from './customerGovernanceService.js'
import auditService from './auditService.js'
import { createRuntimeStateVersion } from './runtimeStateVersionService.js'
import {
  buildRuntimeStateNativeCreationFrameworkState,
  stageRuntimeStateNativeInitialization,
  validateRuntimeStateNativeCreationPaths,
} from './runtimeStateNativeInitializationService.js'

export const RUNTIME_INSTANCE_ERROR_REASONS = Object.freeze({
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_NOT_IN_CUSTOMER: 'TENANT_NOT_IN_CUSTOMER',
  TENANT_DISABLED: 'TENANT_DISABLED',
  FEATURE_NOT_ENABLED: 'FEATURE_NOT_ENABLED',
  FORBIDDEN: 'FORBIDDEN',
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  PACKAGE_FRAMEWORK_MISMATCH: 'PACKAGE_FRAMEWORK_MISMATCH',
  PACKAGE_NOT_ACTIVE: 'PACKAGE_NOT_ACTIVE',
  PACKAGE_NOT_AVAILABLE_TO_CUSTOMER: 'PACKAGE_NOT_AVAILABLE_TO_CUSTOMER',
  DEAL_ANALYSIS_ANCHOR_REQUIRED: 'DEAL_ANALYSIS_ANCHOR_REQUIRED',
  DEPENDENCY_LOCK_REQUIRED: 'DEPENDENCY_LOCK_REQUIRED',
  DEPENDENCY_LOCK_EVIDENCE_MISMATCH: 'DEPENDENCY_LOCK_EVIDENCE_MISMATCH',
  ACTIVATION_EVIDENCE_REQUIRED: 'ACTIVATION_EVIDENCE_REQUIRED',
  DEPLOYMENT_EVIDENCE_REQUIRED: 'DEPLOYMENT_EVIDENCE_REQUIRED',
  AUDIT_PERSISTENCE_FAILED: 'AUDIT_PERSISTENCE_FAILED',
  RUNTIME_INSTANCE_KEY_CONFLICT: 'RUNTIME_INSTANCE_KEY_CONFLICT',
  RUNTIME_INSTANCE_NOT_FOUND: 'RUNTIME_INSTANCE_NOT_FOUND',
  RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED: 'RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED',
  RUNTIME_MUTATION_FORBIDDEN_PATH: 'RUNTIME_MUTATION_FORBIDDEN_PATH',
  RUNTIME_MUTATION_INVALID_PATH: 'RUNTIME_MUTATION_INVALID_PATH',
  RUNTIME_INTELLIGENCE_GRAPH_INVALID: 'RUNTIME_INTELLIGENCE_GRAPH_INVALID',
  RUNTIME_MUTATION_NOT_EDITABLE: 'RUNTIME_MUTATION_NOT_EDITABLE',
  RUNTIME_MUTATION_STALE: 'RUNTIME_MUTATION_STALE',
  RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE: 'RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE',
  RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED: 'RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED',
  RUNTIME_ACTION_NOT_AVAILABLE: 'RUNTIME_ACTION_NOT_AVAILABLE',
  RUNTIME_ACTION_NOT_DECLARED: 'RUNTIME_ACTION_NOT_DECLARED',
  RUNTIME_ACTION_STALE: 'RUNTIME_ACTION_STALE',
  RUNTIME_ACTION_TARGET_MISMATCH: 'RUNTIME_ACTION_TARGET_MISMATCH',
  RUNTIME_ACTION_UNSUPPORTED: 'RUNTIME_ACTION_UNSUPPORTED',
  RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE: 'RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE',
  RUNTIME_REVISION_AUDIT_PERSISTENCE_FAILED: 'RUNTIME_REVISION_AUDIT_PERSISTENCE_FAILED',
  RUNTIME_REVISION_BRANCH_UNSUPPORTED: 'RUNTIME_REVISION_BRANCH_UNSUPPORTED',
  RUNTIME_REVISION_FORBIDDEN: 'RUNTIME_REVISION_FORBIDDEN',
  RUNTIME_REVISION_KEY_CONFLICT: 'RUNTIME_REVISION_KEY_CONFLICT',
  RUNTIME_REVISION_LOCK_SNAPSHOT_REQUIRED: 'RUNTIME_REVISION_LOCK_SNAPSHOT_REQUIRED',
  RUNTIME_REVISION_PUBLISH_SNAPSHOT_REQUIRED: 'RUNTIME_REVISION_PUBLISH_SNAPSHOT_REQUIRED',
  RUNTIME_REVISION_REPLAY_ANCHOR_REQUIRED: 'RUNTIME_REVISION_REPLAY_ANCHOR_REQUIRED',
  RUNTIME_REVISION_SOURCE_NOT_FOUND: 'RUNTIME_REVISION_SOURCE_NOT_FOUND',
  RUNTIME_REVISION_SOURCE_NOT_LOCKED: 'RUNTIME_REVISION_SOURCE_NOT_LOCKED',
  RUNTIME_REVISION_SOURCE_NOT_PUBLISHED: 'RUNTIME_REVISION_SOURCE_NOT_PUBLISHED',
  RUNTIME_REVISION_STALE: 'RUNTIME_REVISION_STALE',
  RUNTIME_REVISION_UNSUPPORTED_RUNTIME_TYPE: 'RUNTIME_REVISION_UNSUPPORTED_RUNTIME_TYPE',
  RUNTIME_STATE_VERSION_REQUIRED: 'RUNTIME_STATE_VERSION_REQUIRED',
  RUNTIME_STATE_V2_TRANSACTION_REQUIRED: 'RUNTIME_STATE_V2_TRANSACTION_REQUIRED',
  DOCUMENT_INGESTION_FAILED: 'DOCUMENT_INGESTION_FAILED',
  WEBSITE_ACQUISITION_FAILED: 'WEBSITE_ACQUISITION_FAILED',
})

const VMF_FRAMEWORK_KEY = 'VMF'

export const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

export const normalizeToken = (value) => String(value || '').trim().toUpperCase()

const normalizeRuntimeInstanceKey = (value) => String(value || '').trim().toLowerCase()

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const RUNTIME_INSTANCE_LIST_PROJECTION = [
  '_id',
  'runtimeInstanceKey',
  'customerId',
  'tenantId',
  'workspaceId',
  'runtimeType',
  'frameworkKey',
  'packageId',
  'packageKey',
  'packageVersion',
  'status',
  'executionStatus',
  'runtimeMode',
  'name',
  'description',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'createdAt',
  'updatedAt',
  'framework_state.lifecycle.stage',
  'framework_state.lifecycle.status',
  'framework_state.lifecycle.lockStatus',
  'framework_state.lifecycle.lockState',
  'framework_state.lifecycle.locked',
  'framework_state.validation.state',
  'framework_state.validation.status',
  'framework_state.validation.result',
  'framework_state.readiness.state',
  'framework_state.readiness.validationState',
  'framework_state.readiness.completionState',
  'framework_state.readiness.completionStatus',
  'framework_state.readiness.lockStatus',
  'framework_state.readiness.snapshotStatus',
  'framework_state.readiness.submittedForReview',
  'framework_state.lock.state',
  'framework_state.lock.status',
  'framework_state.lock.locked',
].join(' ')

// The renderer needs the governed runtime state used to build its customer-safe
// projection, but it does not need the full intelligence graph payload. Keep
// node/edge types for the renderer's summaries and leave graph elements out of
// the initial read. Detail and mutation paths intentionally continue to use the
// full runtime document.
export const RUNTIME_INSTANCE_RENDERER_PROJECTION = [
  '_id',
  'runtimeInstanceKey',
  'customerId',
  'tenantId',
  'workspaceId',
  'runtimeType',
  'frameworkKey',
  'packageId',
  'packageKey',
  'packageVersion',
  'deploymentId',
  'activationId',
  'dependencyLockId',
  'evidence.dependencySnapshotId',
  'evidence.dependencySnapshotHash',
  'status',
  'executionStatus',
  'runtimeMode',
  'name',
  'description',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'assignedTo',
  'anchors',
  'revision',
  'stateVersion',
  'framework_state.lifecycle',
  'framework_state.evidence_pack.state',
  'framework_state.evidence_pack.status',
  'framework_state.evidence_pack.inputs',
  'framework_state.evidence_pack.inputComplete',
  'framework_state.evidence_pack.input_complete',
  'framework_state.evidence_pack.evidenceReady',
  'framework_state.evidence_pack.evidence_ready',
  'framework_state.evidence_pack.needsRefresh',
  'framework_state.evidence_pack.needs_refresh',
  'framework_state.evidence_pack.accepted',
  'framework_state.evidence_pack.acquisitionProfile',
  'framework_state.evidence_pack.acquisition.profile',
  'framework_state.evidence_pack.acquisition.coverage',
  'framework_state.evidence_pack.acquisition.confidence',
  'framework_state.evidence_pack.acquisition.completedAt',
  'framework_state.evidence_pack.acquisition.effectiveness',
  'framework_state.evidence_pack.acquisitionEffectiveness',
  'framework_state.evidence_pack.evidence.coverage',
  'framework_state.evidence_pack.evidence.confidence',
  'framework_state.evidence_pack.lineage.builder.mode',
  'framework_state.evidence_pack.resetSummary',
  'framework_state.evidence_pack.acceptedAt',
  'framework_state.evidence_pack.acceptedBy',
  'framework_state.evidence_pack.refreshedAt',
  'framework_state.validation',
  'framework_state.readiness',
  'framework_state.publish',
  'framework_state.lock',
  'framework_state.policy',
  'framework_state.attachments',
  'framework_state.artifacts',
].join(' ')

const idsEqual = (left, right) => {
  const normalizedLeft = toIdString(left)
  const normalizedRight = toIdString(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export const createRuntimeInstanceError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const createRuntimeInstanceKeyConflictError = (runtimeInstanceKey) =>
  createRuntimeInstanceError({
    status: 409,
    code: 'CONFLICT',
    message: 'Runtime instance key already exists.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_KEY_CONFLICT,
    details: { runtimeInstanceKey },
  })

const buildRuntimeCapacityFilter = ({ customerId, tenantId, runtimeType }) => ({
  customerId,
  tenantId,
  runtimeType,
  status: RUNTIME_INSTANCE_STATUSES.ACTIVE,
})

const buildRuntimeCapacityMeta = ({ customer, tenantId, runtimeType, activeCount }) => {
  const { maxVmfsPerTenant } = customerGovernanceService.getGovernanceLimits(customer)

  return {
    runtimeType,
    maxRuntimeInstances: maxVmfsPerTenant,
    currentCount: activeCount,
    remainingCount: Math.max(maxVmfsPerTenant - activeCount, 0),
    isAtCapacity: activeCount >= maxVmfsPerTenant,
    countMode: 'ACTIVE_RUNTIME_INSTANCES',
    tenantId: toIdString(tenantId),
  }
}

const isRuntimeInstanceKeyDuplicateError = (err) =>
  err?.code === 11000
  && (
    err?.keyPattern?.runtimeInstanceKey
    || err?.keyValue?.runtimeInstanceKey
    || String(err?.message || '').includes('runtimeInstanceKey')
  )

const isRuntimeCapacitySlotDuplicateError = (err) =>
  err?.code === 11000
  && (
    err?.keyPattern?.runtimeCapacitySlot
    || err?.keyValue?.runtimeCapacitySlot
    || String(err?.message || '').includes('runtimeCapacitySlot')
  )

const createRuntimeCapacitySlotConflictError = ({ customer, tenantId }) => {
  const { maxVmfsPerTenant } = customerGovernanceService.getGovernanceLimits(customer)

  return createRuntimeInstanceError({
    status: 409,
    code: 'CONFLICT',
    message: 'VMF limit reached for this tenant.',
    reason: 'VMF_LIMIT_REACHED',
    details: {
      customerId: toIdString(customer?._id),
      tenantId: toIdString(tenantId),
      limitType: 'MAX_VMFS_PER_TENANT',
      limit: maxVmfsPerTenant,
      currentCount: maxVmfsPerTenant,
    },
  })
}

const selectRuntimeCapacitySlot = async ({ customer, customerId, tenantId, runtimeType }) => {
  const { maxVmfsPerTenant } = customerGovernanceService.getGovernanceLimits(customer)
  const filter = buildRuntimeCapacityFilter({
    customerId,
    tenantId,
    runtimeType,
  })
  const currentRuntimeCount = await RuntimeInstance.countDocuments(filter)

  customerGovernanceService.assertVmfCreationWithinLimit({
    customer,
    tenantId,
    currentVmfCount: currentRuntimeCount,
  })

  const usedRuntimeCapacitySlots = await RuntimeInstance.distinct('runtimeCapacitySlot', {
    ...filter,
    runtimeCapacitySlot: { $type: 'number' },
  })
  const usedSlotSet = new Set(
    usedRuntimeCapacitySlots
      .map((slot) => Number(slot))
      .filter((slot) => Number.isInteger(slot) && slot > 0),
  )

  for (let slot = 1; slot <= maxVmfsPerTenant; slot += 1) {
    if (!usedSlotSet.has(slot)) {
      return {
        currentRuntimeCount,
        runtimeCapacitySlot: slot,
      }
    }
  }

  throw createRuntimeCapacitySlotConflictError({ customer, tenantId })
}

const getResolvedPermissionsSnapshot = (scopes = {}) => ({
  platform: scopes?.resolvedPermissions?.platform || { roleKeys: [], permissions: [] },
  customers: Array.isArray(scopes?.resolvedPermissions?.customers)
    ? scopes.resolvedPermissions.customers
    : [],
  tenants: Array.isArray(scopes?.resolvedPermissions?.tenants)
    ? scopes.resolvedPermissions.tenants
    : [],
})

const hasBucketPermission = (bucket, permission) =>
  Array.isArray(bucket?.permissions) && bucket.permissions.includes(permission)

const getCustomerBucket = (scopes, customerId) =>
  getResolvedPermissionsSnapshot(scopes).customers.find(
    (bucket) => toIdString(bucket?.customerId) === String(customerId),
  ) || null

const getTenantBucket = (scopes, customerId, tenantId) =>
  getResolvedPermissionsSnapshot(scopes).tenants.find(
    (bucket) =>
      toIdString(bucket?.customerId) === String(customerId)
      && toIdString(bucket?.tenantId) === String(tenantId),
  ) || null

const getActorUserId = ({ actorUserId, scopes } = {}) =>
  toIdString(actorUserId || scopes?.user?._id || scopes?.user?.id)

const getBucketRoleKeys = (bucket) =>
  Array.isArray(bucket?.roleKeys)
    ? bucket.roleKeys
      .map((roleKey) => normalizeToken(roleKey))
      .filter(Boolean)
    : []

const getRolePermissions = (role) =>
  Array.isArray(role?.permissions)
    ? role.permissions.map((permission) => normalizeToken(permission)).filter(Boolean)
    : []

const loadPermissionGrantingRoles = async ({ roleKeys, permission }) => {
  const uniqueRoleKeys = [
    ...new Set(roleKeys.map((roleKey) => normalizeToken(roleKey)).filter(Boolean)),
  ]
  if (uniqueRoleKeys.length === 0) return []

  const roleRows = await Role.find({ key: { $in: uniqueRoleKeys } })
    .select('key scope permissions isActive')
    .lean()

  const roleByKey = new Map(
    (Array.isArray(roleRows) ? roleRows : []).map((role) => [normalizeToken(role?.key), role]),
  )

  return uniqueRoleKeys
    .map((roleKey) => roleByKey.get(roleKey))
    .filter((role) =>
      role
      && role.isActive !== false
      && getRolePermissions(role).includes(permission),
    )
}

const hasCustomerScopedTenantAdminAccessToTenant = ({
  scopes,
  actorUserId,
  customerId,
  tenantId,
  tenant,
}) => {
  const memberships = Array.isArray(scopes?.memberships) ? scopes.memberships : []
  const tenantMemberships = Array.isArray(scopes?.tenantMemberships) ? scopes.tenantMemberships : []

  const hasCustomerScopedTenantAdmin = memberships.some((membership) =>
    idsEqual(membership?.customerId, customerId)
    && Array.isArray(membership?.roles)
    && membership.roles.some((role) => normalizeToken(role) === 'TENANT_ADMIN'),
  )

  if (!hasCustomerScopedTenantAdmin) return false

  const hasTenantAdminMembership = tenantMemberships.some((membership) =>
    idsEqual(membership?.customerId, customerId)
    && idsEqual(membership?.tenantId, tenantId)
    && Array.isArray(membership?.roles)
    && membership.roles.some((role) => normalizeToken(role) === 'TENANT_ADMIN'),
  )

  if (hasTenantAdminMembership) return true

  const normalizedActorUserId = toIdString(actorUserId)
  if (!normalizedActorUserId || !Array.isArray(tenant?.tenantAdminUserIds)) return false

  return tenant.tenantAdminUserIds.some((tenantAdminUserId) =>
    idsEqual(tenantAdminUserId, normalizedActorUserId),
  )
}

const hasCustomerRuntimePermission = async ({
  scopes,
  actorUserId,
  customerId,
  tenantId,
  permission,
}) => {
  const customerBucket = getCustomerBucket(scopes, customerId)
  if (!hasBucketPermission(customerBucket, permission)) return false

  const roleKeys = getBucketRoleKeys(customerBucket)
  const permissionGrantingRoles = await loadPermissionGrantingRoles({ roleKeys, permission })

  if (permissionGrantingRoles.some((role) => normalizeToken(role.scope) === 'CUSTOMER')) {
    return true
  }

  const hasTenantScopedCustomerRole = permissionGrantingRoles.some((role) =>
    ['TENANT', 'VMF'].includes(normalizeToken(role.scope)),
  )
  const hasCustomerScopedTenantAdminRole = roleKeys.includes('TENANT_ADMIN')

  if (hasTenantScopedCustomerRole && hasCustomerScopedTenantAdminRole) {
    const tenant = await Tenant.findById(tenantId)

    if (
      tenant
      && idsEqual(tenant.customerId, customerId)
      && hasCustomerScopedTenantAdminAccessToTenant({
        scopes,
        actorUserId,
        customerId,
        tenantId,
        tenant,
      })
    ) {
      return true
    }
  }

  const customer = await Customer.findById(customerId)
  return customer?.topology === 'SINGLE_TENANT'
}

export const assertRuntimePermission = async ({ actorUserId, scopes, customerId, tenantId, permission }) => {
  const normalizedPermission = normalizeToken(permission)
  const resolved = getResolvedPermissionsSnapshot(scopes)

  if (resolved.platform.roleKeys.includes('SUPER_ADMIN')) return

  const tenantBucket = getTenantBucket(scopes, customerId, tenantId)
  if (hasBucketPermission(tenantBucket, normalizedPermission)) return

  const customerBucket = getCustomerBucket(scopes, customerId)
  if (await hasCustomerRuntimePermission({
    scopes,
    actorUserId: getActorUserId({ actorUserId, scopes }),
    customerId,
    tenantId,
    permission: normalizedPermission,
  })) return

  throw createRuntimeInstanceError({
    status: 403,
    code: 'FORBIDDEN',
    message: `Tenant permission '${normalizedPermission}' is required.`,
    reason: RUNTIME_INSTANCE_ERROR_REASONS.FORBIDDEN,
    details: { permission: normalizedPermission, customerId, tenantId },
  })
}

export const assertFeatureEntitlement = async ({ customerId, customer, feature }) => {
  const entitlementContext = await resolveCustomerFeatureEntitlements({
    customerId,
    customer,
  })

  if (!entitlementContext) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Customer not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.CUSTOMER_NOT_FOUND,
      details: { customerId },
    })
  }

  if (!entitlementContext.featureEntitlements.includes(feature)) {
    throw createRuntimeInstanceError({
      status: 403,
      code: 'LICENSE_FEATURE_NOT_ENABLED',
      message: 'Your current licence does not include this feature.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.FEATURE_NOT_ENABLED,
      details: {
        customerId,
        feature,
        licenseLevelId: entitlementContext.licenseLevelId || null,
        entitlementSource: entitlementContext.entitlementSource,
      },
    })
  }
}

export const assertCustomerTenantContext = async ({ customerId, tenantId }) => {
  const [customer, tenant] = await Promise.all([
    Customer.findById(customerId),
    Tenant.findById(tenantId),
  ])

  if (!customer) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Customer not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.CUSTOMER_NOT_FOUND,
      details: { customerId },
    })
  }

  if (!tenant) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Tenant not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.TENANT_NOT_FOUND,
      details: { tenantId },
    })
  }

  if (toIdString(tenant.customerId) !== String(customerId)) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Tenant not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.TENANT_NOT_IN_CUSTOMER,
      details: { customerId, tenantId },
    })
  }

  if (tenant.status !== 'ENABLED') {
    throw createRuntimeInstanceError({
      status: 403,
      code: 'TENANT_DISABLED',
      message: 'This tenant is currently disabled. Contact your administrator.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.TENANT_DISABLED,
      details: { customerId, tenantId, tenantStatus: tenant.status },
    })
  }

  return { customer, tenant }
}

const resolveFrameworkPackage = async ({ packageId, frameworkKey, customerId }) => {
  const frameworkPackage = await FrameworkPackage.findById(packageId)

  if (!frameworkPackage) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Framework package not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_NOT_FOUND,
      details: { packageId },
    })
  }

  if (normalizeToken(frameworkPackage.frameworkKey) !== normalizeToken(frameworkKey)) {
    throw createRuntimeInstanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Framework package does not match the requested framework.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_FRAMEWORK_MISMATCH,
      details: { packageId, frameworkKey },
    })
  }

  if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw createRuntimeInstanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Framework package must be ACTIVE before creating a runtime instance.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_NOT_ACTIVE,
      details: { packageId, packageStatus: frameworkPackage.status },
    })
  }

  if (!isFrameworkPackageAvailableToCustomer({ frameworkPackage, customerId, frameworkKey })) {
    throw createRuntimeInstanceError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Framework package is not available to this customer.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_NOT_AVAILABLE_TO_CUSTOMER,
      details: { packageId, customerId },
    })
  }

  return frameworkPackage
}

const resolveActivationEvidence = async ({ frameworkPackage }) => {
  const dependencyLock = frameworkPackage.dependencyLock || null
  const dependencyReferences = Array.isArray(dependencyLock?.references)
    ? dependencyLock.references
    : []
  const dependencySnapshotId = String(dependencyLock?.snapshotId || '').trim()
  const dependencySnapshotHash = String(dependencyLock?.snapshotHash || dependencyLock?.hash || '').trim()

  if (
    !dependencyLock
    || normalizeToken(dependencyLock.status) !== 'PASS'
    || dependencyReferences.length === 0
    || !dependencySnapshotId
  ) {
    throw createRuntimeInstanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'A certified dependency lock is required before creating a runtime instance.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.DEPENDENCY_LOCK_REQUIRED,
      details: {
        packageId: toIdString(frameworkPackage._id),
        dependencyLockStatus: dependencyLock?.status || null,
        dependencyReferenceCount: dependencyReferences.length,
      },
    })
  }

  const deployment = await RuntimeDeployment.findOne({
    packageId: frameworkPackage._id,
    frameworkKey: frameworkPackage.frameworkKey,
    status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
  }).lean()

  if (!deployment) {
    throw createRuntimeInstanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Active runtime deployment evidence is required before creating a runtime instance.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.DEPLOYMENT_EVIDENCE_REQUIRED,
      details: { packageId: toIdString(frameworkPackage._id) },
    })
  }

  const activationSnapshot = await RuntimeActivationSnapshot.findOne({
    activationId: deployment.activationId,
    packageId: frameworkPackage._id,
    activationStatus: RUNTIME_ACTIVATION_STATUSES.ACTIVE,
  }).lean()

  if (!activationSnapshot) {
    throw createRuntimeInstanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime activation snapshot evidence is required before creating a runtime instance.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.ACTIVATION_EVIDENCE_REQUIRED,
      details: {
        packageId: toIdString(frameworkPackage._id),
        activationId: deployment.activationId || null,
      },
    })
  }

  const activationDependencySnapshotId = String(activationSnapshot.dependencySnapshotId || '').trim()
  const activationDependencySnapshotHash = String(activationSnapshot.dependencySnapshotHash || '').trim()

  if (!activationDependencySnapshotId) {
    throw createRuntimeInstanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime activation snapshot evidence is required before creating a runtime instance.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.ACTIVATION_EVIDENCE_REQUIRED,
      details: {
        packageId: toIdString(frameworkPackage._id),
        activationId: activationSnapshot.activationId || deployment.activationId || null,
      },
    })
  }

  if (
    activationDependencySnapshotId !== dependencySnapshotId
    || (dependencySnapshotHash && activationDependencySnapshotHash !== dependencySnapshotHash)
  ) {
    throw createRuntimeInstanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Framework package dependency evidence does not match the active activation snapshot.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.DEPENDENCY_LOCK_EVIDENCE_MISMATCH,
      details: {
        packageId: toIdString(frameworkPackage._id),
        activationId: activationSnapshot.activationId || deployment.activationId || null,
        packageDependencySnapshotId: dependencySnapshotId,
        activationDependencySnapshotId,
      },
    })
  }

  return {
    activationId: activationSnapshot.activationId,
    deploymentId: deployment.deploymentId,
    dependencySnapshotId: activationDependencySnapshotId,
    dependencySnapshotHash: activationDependencySnapshotHash,
  }
}

const buildRuntimeInstanceKey = ({ runtimeType, objectId = new mongoose.Types.ObjectId() }) =>
  `${String(runtimeType || RUNTIME_TYPES.VALUE_NARRATIVE).toLowerCase().replace(/_/g, '-')}-${objectId.toString().slice(-12)}`

const buildInitialFrameworkState = () => ({
  lifecycle: { stage: 'DRAFT' },
  sections: {},
  evidence_pack: {},
  validation: {},
  readiness: {},
  policy: {},
  attachments: {},
  artifacts: {},
})

export const getFeatureForRuntimeType = (runtimeType) =>
  normalizeToken(runtimeType) === RUNTIME_TYPES.DEAL_ANALYSIS ? 'DEALS' : VMF_FRAMEWORK_KEY

const logRuntimeInstanceCreated = async ({
  auditRequest,
  actorUserId,
  runtimeInstance,
  session = null,
}) => {
  const serializedRuntimeInstance = serializeRuntimeInstance(runtimeInstance)
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.RUNTIME_INSTANCE_CREATED,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: runtimeInstance._id,
    actorUserId,
    scope: {
      customerId: serializedRuntimeInstance.customerId,
      tenantId: serializedRuntimeInstance.tenantId,
      runtimeInstanceId: serializedRuntimeInstance.id,
    },
    diff: {
      runtimeInstanceKey: serializedRuntimeInstance.runtimeInstanceKey,
      runtimeType: serializedRuntimeInstance.runtimeType,
      frameworkKey: serializedRuntimeInstance.frameworkKey,
      packageId: serializedRuntimeInstance.packageId,
      packageKey: serializedRuntimeInstance.packageKey,
      packageVersion: serializedRuntimeInstance.packageVersion,
      dependencyLockId: serializedRuntimeInstance.dependencyLockId,
      activationId: serializedRuntimeInstance.activationId,
      deploymentId: serializedRuntimeInstance.deploymentId,
      status: serializedRuntimeInstance.status,
      executionStatus: serializedRuntimeInstance.executionStatus,
    },
  }

  try {
    const auditOptions = {
      throwOnError: true,
      ...(session ? { session } : {}),
    }

    if (auditRequest) {
      await auditService.logFromRequest(auditRequest, auditPayload, auditOptions)
      return
    }

    await auditService.log(auditPayload, auditOptions)
  } catch (err) {
    throw createRuntimeInstanceError({
      status: 500,
      code: 'RUNTIME_INSTANCE_AUDIT_FAILED',
      message: 'Runtime instance creation audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.AUDIT_PERSISTENCE_FAILED,
    })
  }
}

const saveRuntimeInstance = async ({
  runtimeInstance,
  session = null,
  capacityConflictContext = null,
}) => {
  try {
    if (session) {
      await runtimeInstance.save({ session })
      return
    }

    await runtimeInstance.save()
  } catch (err) {
    if (isRuntimeInstanceKeyDuplicateError(err)) {
      throw createRuntimeInstanceKeyConflictError(runtimeInstance.runtimeInstanceKey)
    }

    if (capacityConflictContext && isRuntimeCapacitySlotDuplicateError(err)) {
      throw createRuntimeCapacitySlotConflictError(capacityConflictContext)
    }

    throw err
  }
}

const persistRuntimeInstanceWithAudit = async ({
  actorUserId,
  auditRequest,
  runtimeInstance,
  frameworkPackage,
  capacityConflictContext = null,
}) => {
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let serializedRuntimeInstance = null

    try {
      await session.withTransaction(async () => {
        await saveRuntimeInstance({ runtimeInstance, session, capacityConflictContext })
        await stageRuntimeStateNativeInitialization({
          actorUserId,
          runtimeInstance,
          frameworkPackage,
          session,
        })
        await logRuntimeInstanceCreated({
          auditRequest,
          actorUserId,
          runtimeInstance,
          session,
        })
        serializedRuntimeInstance = serializeRuntimeInstance(runtimeInstance)
      })
    } finally {
      await session.endSession()
    }

    return serializedRuntimeInstance
  }

  if (process.env.NODE_ENV !== 'test') {
    throw createRuntimeInstanceError({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Runtime instance creation requires an active database transaction.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_V2_TRANSACTION_REQUIRED,
    })
  }

  await saveRuntimeInstance({ runtimeInstance, capacityConflictContext })

  try {
    await logRuntimeInstanceCreated({ auditRequest, actorUserId, runtimeInstance })
  } catch (err) {
    try {
      await RuntimeInstance.deleteOne({ _id: runtimeInstance._id })
    } catch {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
      }
    }

    throw err
  }

  return serializeRuntimeInstance(runtimeInstance)
}

const normalizeFrameworkState = (frameworkState = {}) => ({
  lifecycle: frameworkState.lifecycle || { stage: 'DRAFT' },
  sections: frameworkState.sections || {},
  evidence_pack: frameworkState.evidence_pack || frameworkState.evidencePack || {},
  validation: frameworkState.validation || {},
  readiness: frameworkState.readiness || {},
  publish: frameworkState.publish || {},
  lock: frameworkState.lock || {},
  policy: frameworkState.policy || {},
  attachments: frameworkState.attachments || {},
  artifacts: frameworkState.artifacts || {},
  intelligence_graph: frameworkState.intelligence_graph || frameworkState.intelligenceGraph || {},
})

export const serializeRuntimeInstance = (runtimeInstance) => {
  if (!runtimeInstance) return null
  const plain = typeof runtimeInstance.toJSON === 'function'
    ? runtimeInstance.toJSON()
    : typeof runtimeInstance.toObject === 'function'
      ? runtimeInstance.toObject()
      : { ...runtimeInstance }
  delete plain.runtimeCapacitySlot

  const id = toIdString(plain.id || plain._id)

  return {
    ...plain,
    id,
    customerId: toIdString(plain.customerId),
    tenantId: toIdString(plain.tenantId),
    packageId: toIdString(plain.packageId),
    createdBy: toIdString(plain.createdBy),
    updatedBy: plain.updatedBy ? toIdString(plain.updatedBy) : null,
    lockedBy: plain.lockedBy ? toIdString(plain.lockedBy) : null,
    revision: plain.revision
      ? {
          ...plain.revision,
          parentRuntimeId: plain.revision.parentRuntimeId ? toIdString(plain.revision.parentRuntimeId) : null,
          rootRuntimeId: plain.revision.rootRuntimeId ? toIdString(plain.revision.rootRuntimeId) : null,
          createdBy: plain.revision.createdBy ? toIdString(plain.revision.createdBy) : null,
        }
      : { revisionNumber: 1 },
    assignedTo: Array.isArray(plain.assignedTo) ? plain.assignedTo.map(toIdString).filter(Boolean) : [],
    anchors: Array.isArray(plain.anchors)
      ? plain.anchors.map((anchor) => ({
          ...anchor,
          runtimeInstanceId: toIdString(anchor.runtimeInstanceId),
        }))
      : [],
    framework_state: normalizeFrameworkState(plain.framework_state),
  }
}

const getRuntimeInstanceListState = (runtimeInstance) => {
  const frameworkState = runtimeInstance?.framework_state || runtimeInstance?.frameworkState || {}
  const lifecycle = frameworkState.lifecycle || {}
  const validation = frameworkState.validation || {}
  const readiness = frameworkState.readiness || {}
  const lock = frameworkState.lock || {}
  const firstToken = (...values) => values.map(normalizeToken).find(Boolean) || null

  return {
    frameworkLifecycleStage: firstToken(
      typeof lifecycle === 'string' ? lifecycle : lifecycle.stage,
      lifecycle.status,
    ),
    validationStatus: firstToken(
      runtimeInstance?.validationStatus,
      runtimeInstance?.runtimeValidationStatus,
      readiness.validationState,
      validation.state,
      validation.status,
      validation.result,
    ),
    readinessState: firstToken(
      runtimeInstance?.readinessState,
      runtimeInstance?.runtimeReadinessState,
      readiness.state,
    ),
    lockStatus: firstToken(
      runtimeInstance?.lockStatus,
      runtimeInstance?.runtimeLockStatus,
      runtimeInstance?.lockState,
      readiness.lockStatus,
      lock.state,
      lock.status,
      lifecycle.lockStatus,
      lifecycle.lockState,
      runtimeInstance?.status === RUNTIME_INSTANCE_STATUSES.LOCKED || runtimeInstance?.lockedAt
        ? RUNTIME_INSTANCE_STATUSES.LOCKED
        : null,
    ),
    completionState: firstToken(
      runtimeInstance?.completionState,
      readiness.completionState,
      readiness.completionStatus,
    ),
    snapshotStatus: firstToken(
      runtimeInstance?.snapshotStatus,
      readiness.snapshotStatus,
    ),
    submittedForReview: readiness.submittedForReview === true,
  }
}

export const serializeRuntimeInstanceSummary = (runtimeInstance) => {
  if (!runtimeInstance) return null

  const plain = typeof runtimeInstance.toJSON === 'function'
    ? runtimeInstance.toJSON()
    : typeof runtimeInstance.toObject === 'function'
      ? runtimeInstance.toObject()
      : { ...runtimeInstance }
  const id = toIdString(plain.id || plain._id)

  return {
    id,
    runtimeInstanceKey: plain.runtimeInstanceKey || '',
    customerId: toIdString(plain.customerId),
    tenantId: toIdString(plain.tenantId),
    workspaceId: plain.workspaceId || '',
    runtimeType: plain.runtimeType || '',
    frameworkKey: plain.frameworkKey || '',
    packageId: toIdString(plain.packageId),
    packageKey: plain.packageKey || '',
    packageVersion: plain.packageVersion || '',
    status: plain.status || '',
    executionStatus: plain.executionStatus || '',
    runtimeMode: plain.runtimeMode || '',
    name: plain.name || '',
    description: plain.description || '',
    lockedAt: plain.lockedAt || null,
    lockedBy: plain.lockedBy ? toIdString(plain.lockedBy) : null,
    lockedReason: plain.lockedReason || '',
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    ...getRuntimeInstanceListState(plain),
  }
}

export const createRuntimeInstance = async ({
  actorUserId,
  auditRequest,
  scopes,
  payload,
} = {}) => {
  const customerId = payload.customerId
  const tenantId = payload.tenantId
  const frameworkKey = normalizeToken(payload.frameworkKey || VMF_FRAMEWORK_KEY)
  const runtimeType = normalizeToken(payload.runtimeType || RUNTIME_TYPES.VALUE_NARRATIVE)
  const runtimeInstanceKey = payload.runtimeInstanceKey
    ? normalizeRuntimeInstanceKey(payload.runtimeInstanceKey)
    : null

  if (runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS) {
    throw createRuntimeInstanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Deal Analysis runtime instances require a locked VMF runtime anchor before creation.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.DEAL_ANALYSIS_ANCHOR_REQUIRED,
      details: { runtimeType },
    })
  }

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId,
    tenantId,
    permission: runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE ? 'VMF_CREATE' : 'DEAL_CREATE',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({ customerId, customer, feature: frameworkKey })

  const runtimeCapacityReservation = runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE
    ? await selectRuntimeCapacitySlot({
        customer,
        customerId,
        tenantId,
        runtimeType,
      })
    : null

  if (runtimeInstanceKey) {
    const existingRuntimeInstance = await RuntimeInstance.findOne({ runtimeInstanceKey })
      .select('_id')
      .lean()

    if (existingRuntimeInstance) {
      throw createRuntimeInstanceKeyConflictError(runtimeInstanceKey)
    }
  }

  const frameworkPackage = await resolveFrameworkPackage({
    packageId: payload.frameworkPackageId,
    frameworkKey,
    customerId,
  })
  const evidence = await resolveActivationEvidence({ frameworkPackage })
  const objectId = new mongoose.Types.ObjectId()
  const stateVersion = createRuntimeStateVersion()
  const initialState = buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage, stateVersion })
  await validateRuntimeStateNativeCreationPaths(frameworkPackage)

  const runtimeInstance = new RuntimeInstance({
    _id: objectId,
    runtimeInstanceKey: runtimeInstanceKey || buildRuntimeInstanceKey({ runtimeType, objectId }),
    customerId,
    tenantId,
    workspaceId: payload.workspaceId || '',
    runtimeType,
    frameworkKey,
    packageId: frameworkPackage._id,
    packageKey: frameworkPackage.packageKey,
    packageVersion: frameworkPackage.version,
    dependencyLockId: evidence.dependencySnapshotId,
    activationId: evidence.activationId,
    deploymentId: evidence.deploymentId,
    evidence,
    stateVersion,
    status: RUNTIME_INSTANCE_STATUSES.ACTIVE,
    executionStatus: RUNTIME_EXECUTION_STATUSES.IDLE,
    runtimeMode: RUNTIME_MODES.INTERACTIVE,
    runtimeCapacitySlot: runtimeCapacityReservation?.runtimeCapacitySlot ?? null,
    name: payload.name,
    description: payload.description || '',
    framework_state: { ...buildInitialFrameworkState(), ...initialState },
    assignedTo: [],
    anchors: [],
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  return persistRuntimeInstanceWithAudit({
    actorUserId,
    auditRequest,
    runtimeInstance,
    frameworkPackage,
    capacityConflictContext: runtimeCapacityReservation
      ? { customer, tenantId }
      : null,
  })
}

export const listRuntimeInstances = async ({
  scopes,
  query,
} = {}) => {
  const customerId = query.customerId
  const tenantId = query.tenantId
  const runtimeType = normalizeToken(query.runtimeType)
  const status = query.status ? normalizeToken(query.status) : null
  const searchQuery = String(query.q || '').trim()
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const skip = (page - 1) * pageSize

  await assertRuntimePermission({
    scopes,
    customerId,
    tenantId,
    permission: runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS ? 'DEAL_VIEW' : 'VMF_VIEW',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeType),
  })

  const filter = { customerId, tenantId }
  filter.runtimeType = runtimeType
  if (status) filter.status = status
  if (searchQuery) {
    const searchPattern = new RegExp(escapeRegExp(searchQuery), 'i')
    filter.$or = [
      { name: searchPattern },
      { description: searchPattern },
      { runtimeInstanceKey: searchPattern },
      { packageKey: searchPattern },
      { packageVersion: searchPattern },
      { frameworkKey: searchPattern },
    ]
  }

  const [rows, total, activeRuntimeCount] = await Promise.all([
    // Project before sorting so large legacy state does not enter the sort buffer.
    // Aggregation does not perform Mongoose's normal query ObjectId casting.
    RuntimeInstance.aggregate([
      { $match: {
        ...filter,
        customerId: new mongoose.Types.ObjectId(customerId),
        tenantId: new mongoose.Types.ObjectId(tenantId),
      } },
      { $project: Object.fromEntries(RUNTIME_INSTANCE_LIST_PROJECTION.split(' ').map((field) => [field, 1])) },
      { $sort: { updatedAt: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: pageSize },
    ]),
    RuntimeInstance.countDocuments(filter),
    runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE
      ? RuntimeInstance.countDocuments(buildRuntimeCapacityFilter({
          customerId,
          tenantId,
          runtimeType,
        }))
      : Promise.resolve(null),
  ])

  return {
    data: rows.map(serializeRuntimeInstanceSummary),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      ...(runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE
        ? {
            runtimeCapacity: buildRuntimeCapacityMeta({
              customer,
              tenantId,
              runtimeType,
              activeCount: activeRuntimeCount,
            }),
          }
        : {}),
    },
  }
}

const buildRuntimeInstanceLookupFilter = ({
  runtimeInstanceId,
  customerId,
  tenantId,
} = {}) => {
  const identityFilter = {
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  }
  const normalizedCustomerId = toIdString(customerId)
  const normalizedTenantId = toIdString(tenantId)
  if (!normalizedCustomerId || !normalizedTenantId) return identityFilter
  return {
    $and: [
      identityFilter,
      { customerId: normalizedCustomerId },
      { tenantId: normalizedTenantId },
    ],
  }
}

const getPresentScopeValues = (values = []) => values
  .filter((value) => value !== undefined && value !== null)
  .map(toIdString)

const getBoundedRuntimeScope = (scopes = {}) => {
  const customerIds = getPresentScopeValues([
    scopes.customer?._id,
    scopes.customer?.id,
  ])
  const tenantIds = getPresentScopeValues([
    scopes.tenant?._id,
    scopes.tenant?.id,
  ])
  const tenantCustomerIds = getPresentScopeValues([
    scopes.tenant?.customerId,
    scopes.tenant?.customer?._id,
    scopes.tenant?.customer?.id,
  ])
  return {
    customerId: customerIds[0] || '',
    tenantId: tenantIds[0] || '',
    customerIds,
    tenantIds,
    tenantCustomerIds,
  }
}

export const getRuntimeInstance = async ({
  scopes,
  runtimeInstanceId,
  customerId: scopedCustomerId,
  tenantId: scopedTenantId,
  projection = '',
  maxTimeMS,
} = {}) => {
  let effectiveCustomerId = scopedCustomerId
  let effectiveTenantId = scopedTenantId
  if (maxTimeMS !== undefined) {
    const boundedScope = getBoundedRuntimeScope(scopes)
    if (!mongoose.isValidObjectId(boundedScope.customerId)
      || !mongoose.isValidObjectId(boundedScope.tenantId)
      || boundedScope.customerIds.some((value) => value !== boundedScope.customerId)
      || boundedScope.tenantIds.some((value) => value !== boundedScope.tenantId)
      || boundedScope.tenantCustomerIds.some((value) => value !== boundedScope.customerId)
      || (scopedCustomerId && toIdString(scopedCustomerId) !== boundedScope.customerId)
      || (scopedTenantId && toIdString(scopedTenantId) !== boundedScope.tenantId)) {
      throw createRuntimeInstanceError({
        status: 403,
        code: 'BOUNDED_SCOPE_REQUIRED',
        message: 'A selected customer and tenant scope is required for bounded runtime reads.',
        reason: 'RUNTIME_INSTANCE_BOUNDED_SCOPE_REQUIRED',
      })
    }
    effectiveCustomerId = boundedScope.customerId
    effectiveTenantId = boundedScope.tenantId
  }
  const query = RuntimeInstance.findOne(buildRuntimeInstanceLookupFilter({
    runtimeInstanceId,
    customerId: effectiveCustomerId,
    tenantId: effectiveTenantId,
  }))
  if (projection && typeof query?.select === 'function') query.select(projection)
  if (maxTimeMS !== undefined) {
    const normalizedMaxTimeMS = Number(maxTimeMS)
    if (!Number.isInteger(normalizedMaxTimeMS) || normalizedMaxTimeMS <= 0
      || typeof query?.maxTimeMS !== 'function') {
      throw createRuntimeInstanceError({
        status: 503,
        code: 'BOUNDED_READ_UNAVAILABLE',
        message: 'Runtime instance bounded-read support is unavailable.',
        reason: 'RUNTIME_INSTANCE_BOUNDED_READ_UNAVAILABLE',
      })
    }
    query.maxTimeMS(normalizedMaxTimeMS)
  }
  const runtimeInstance = await query.lean()

  if (!runtimeInstance) {
    throw createRuntimeInstanceError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: 'RUNTIME_INSTANCE_NOT_FOUND',
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)

  await assertRuntimePermission({
    scopes,
    customerId,
    tenantId,
    permission: runtimeInstance.runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS ? 'DEAL_VIEW' : 'VMF_VIEW',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeInstance.runtimeType),
  })

  return serializeRuntimeInstance(runtimeInstance)
}

const runtimeInstanceService = {
  createRuntimeInstance,
  getRuntimeInstance,
  listRuntimeInstances,
  serializeRuntimeInstance,
}

export default runtimeInstanceService
