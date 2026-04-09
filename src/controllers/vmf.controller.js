/**
 * VMF Controller
 *
 * Handles VMF management endpoints:
 *
 *   Tenant-scoped (requireTenantAccess):
 *     GET   /api/v1/customers/:customerId/tenants/:tenantId/vmfs       List VMFs
 *     POST  /api/v1/customers/:customerId/tenants/:tenantId/vmfs       Create VMF
 *
 *   VMF-scoped (requireVmfAccess):
 *     GET    /api/v1/vmfs/:vmfId                  Get single VMF
 *     PATCH  /api/v1/vmfs/:vmfId                  Update VMF
 *     DELETE /api/v1/vmfs/:vmfId                  Soft-delete VMF (30-day retention)
 *     POST   /api/v1/vmfs/:vmfId/grants           Grant user access to VMF
 *     DELETE /api/v1/vmfs/:vmfId/grants/:userId   Revoke user access
 */

import {
  Customer,
  Tenant,
  VMF,
  Deal,
  User,
  SystemVersioningPolicy,
  FrameworkPackage,
} from '../models/index.js'
import auditService from '../services/auditService.js'
import customerGovernanceService from '../services/customerGovernanceService.js'
import logger from '../config/logger.js'
import performanceCacheService from '../services/performanceCacheService.js'
import monitoringService from '../services/monitoringService.js'
import env from '../config/env.js'

const buildGovernanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || 'CONFLICT',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

const VMF_LIFECYCLE_TRANSITIONS = Object.freeze({
  DRAFT: ['DRAFT', 'CANONISED'],
  CANONISED: ['CANONISED', 'PUBLISHED'],
  PUBLISHED: ['PUBLISHED'],
})

const VMF_FRAMEWORK_KEY = 'VMF'

const VMF_RUNTIME_STATUSES = Object.freeze({
  COMPLETION_STATE: 'NOT_TRACKED',
  VALIDATION_STATUS_DEFAULT: 'NOT_RUN',
  VALIDATION_STATUS_NOT_REQUIRED: 'NOT_REQUIRED',
  LOCK_STATUS: 'UNLOCKED',
  SNAPSHOT_PACKAGE_BOUND: 'PACKAGE_BOUND',
  SNAPSHOT_PACKAGE_INFERRED_FROM_VERSION: 'PACKAGE_INFERRED_FROM_VERSION',
  SNAPSHOT_LEGACY_POLICY_ONLY: 'LEGACY_POLICY_ONLY',
  SNAPSHOT_UNBOUND: 'UNBOUND',
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (typeof value.id === 'string' && value.id.trim()) return value.id
    if (typeof value._id === 'string' && value._id.trim()) return value._id
    if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  }
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeVmfRecord = (vmf) => {
  const plain = typeof vmf?.toJSON === 'function'
    ? vmf.toJSON()
    : { ...vmf }

  if (!plain.id && plain._id) {
    plain.id = toIdString(plain._id)
  }

  if (plain.frameworkPackageId) {
    plain.frameworkPackageId = toIdString(plain.frameworkPackageId)
  }

  if (plain.versionPolicyId) {
    plain.versionPolicyId = toIdString(plain.versionPolicyId)
  }

  return plain
}

const serializeFrameworkPackageSummary = (frameworkPackage) => {
  if (!frameworkPackage) return null

  const plain = typeof frameworkPackage?.toJSON === 'function'
    ? frameworkPackage.toJSON()
    : { ...frameworkPackage }

  return {
    id: toIdString(plain.id || plain._id),
    frameworkKey: plain.frameworkKey,
    frameworkName: plain.frameworkName,
    version: plain.version,
    status: plain.status,
    isDefault: plain.isDefault,
    compatibleWorkflowKeys: plain.compatibleWorkflowKeys || [],
    defaultAgentIds: plain.defaultAgentIds || [],
    requiredSkillIds: plain.requiredSkillIds || [],
    capabilities: plain.capabilities || {},
    validationRules: plain.validationRules || {
      requiredSections: [],
      publishChecks: [],
    },
    updatedAt: plain.updatedAt || null,
  }
}

const resolveValidationStatus = (frameworkPackage) =>
  frameworkPackage?.capabilities?.requiresValidationBeforePublish === false
    ? VMF_RUNTIME_STATUSES.VALIDATION_STATUS_NOT_REQUIRED
    : VMF_RUNTIME_STATUSES.VALIDATION_STATUS_DEFAULT

const buildFrameworkPackageValidationError = (message) => ({
  status: 422,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed.',
    details: {
      frameworkPackageId: message,
    },
  },
})

const resolveFrameworkVersionFromPolicy = (policy) => {
  if (!policy) return null

  const rules = policy.rules || {}
  const candidate =
    rules.frameworkVersion
    || rules.vmfFrameworkVersion
    || rules.defaultFrameworkVersion
    || rules.version

  if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
    return String(candidate).trim()
  }

  if (policy.version !== undefined && policy.version !== null) {
    return String(policy.version)
  }

  return null
}

const resolveActiveVersioningPolicy = async () => {
  if (typeof SystemVersioningPolicy.findActive !== 'function') {
    return null
  }

  try {
    return await SystemVersioningPolicy.findActive()
  } catch (err) {
    logger.warn({ err }, 'vmf.controller - failed to resolve active versioning policy')
    return null
  }
}

const resolveVmfVersionSnapshot = async () => {
  const activePolicy = await resolveActiveVersioningPolicy()
  if (!activePolicy) {
    return {
      frameworkVersion: null,
      versionPolicyId: null,
    }
  }

  return {
    frameworkVersion: resolveFrameworkVersionFromPolicy(activePolicy),
    versionPolicyId: activePolicy._id,
  }
}

const resolveActiveFrameworkPackage = async () => {
  if (typeof FrameworkPackage.findActiveByFrameworkKey !== 'function') {
    return null
  }

  try {
    return await FrameworkPackage.findActiveByFrameworkKey(VMF_FRAMEWORK_KEY)
  } catch (err) {
    logger.warn({ err }, 'vmf.controller - failed to resolve active framework package')
    return null
  }
}

const resolveAlignedVersionPolicyId = async (frameworkVersion) => {
  if (!frameworkVersion) return null

  const activePolicy = await resolveActiveVersioningPolicy()
  if (!activePolicy) return null

  const policyFrameworkVersion = resolveFrameworkVersionFromPolicy(activePolicy)
  return policyFrameworkVersion === frameworkVersion
    ? activePolicy._id
    : null
}

const resolveVmfCreateBinding = async ({ frameworkPackageId = null } = {}) => {
  if (frameworkPackageId) {
    const frameworkPackage = await FrameworkPackage.findById(frameworkPackageId)

    if (!frameworkPackage) {
      throw buildFrameworkPackageValidationError('Framework package was not found.')
    }

    if (frameworkPackage.frameworkKey !== VMF_FRAMEWORK_KEY) {
      throw buildFrameworkPackageValidationError('Framework package must target the VMF framework.')
    }

    if (frameworkPackage.status !== 'ACTIVE') {
      throw buildFrameworkPackageValidationError('Framework package must be active before it can be assigned.')
    }

    return {
      frameworkPackage,
      frameworkPackageId: frameworkPackage._id,
      frameworkVersion: frameworkPackage.version,
      versionPolicyId: await resolveAlignedVersionPolicyId(frameworkPackage.version),
      snapshotStatus: VMF_RUNTIME_STATUSES.SNAPSHOT_PACKAGE_BOUND,
    }
  }

  const activeFrameworkPackage = await resolveActiveFrameworkPackage()
  if (activeFrameworkPackage) {
    return {
      frameworkPackage: activeFrameworkPackage,
      frameworkPackageId: activeFrameworkPackage._id,
      frameworkVersion: activeFrameworkPackage.version,
      versionPolicyId: await resolveAlignedVersionPolicyId(activeFrameworkPackage.version),
      snapshotStatus: VMF_RUNTIME_STATUSES.SNAPSHOT_PACKAGE_BOUND,
    }
  }

  const legacySnapshot = await resolveVmfVersionSnapshot()
  return {
    frameworkPackage: null,
    frameworkPackageId: null,
    frameworkVersion: legacySnapshot.frameworkVersion,
    versionPolicyId: legacySnapshot.versionPolicyId,
    snapshotStatus: legacySnapshot.versionPolicyId
      ? VMF_RUNTIME_STATUSES.SNAPSHOT_LEGACY_POLICY_ONLY
      : VMF_RUNTIME_STATUSES.SNAPSHOT_UNBOUND,
  }
}

const decorateVmfRecord = ({
  vmf,
  frameworkPackage = null,
  activeFrameworkPackage = null,
  snapshotStatus = VMF_RUNTIME_STATUSES.SNAPSHOT_UNBOUND,
}) => {
  const plain = normalizeVmfRecord(vmf)
  const serializedFrameworkPackage = serializeFrameworkPackageSummary(frameworkPackage)
  const resolvedFrameworkPackageId =
    serializedFrameworkPackage?.id
    || plain.frameworkPackageId
    || null
  const activeFrameworkPackageId = toIdString(activeFrameworkPackage?._id || activeFrameworkPackage?.id)

  return {
    ...plain,
    frameworkVersion: plain.frameworkVersion || serializedFrameworkPackage?.version || null,
    frameworkPackageId: resolvedFrameworkPackageId,
    frameworkPackage: serializedFrameworkPackage,
    completionState: VMF_RUNTIME_STATUSES.COMPLETION_STATE,
    validationStatus: resolveValidationStatus(frameworkPackage),
    lockStatus: VMF_RUNTIME_STATUSES.LOCK_STATUS,
    snapshotStatus,
    migrationAvailable: Boolean(
      activeFrameworkPackageId
      && (!resolvedFrameworkPackageId || resolvedFrameworkPackageId !== activeFrameworkPackageId),
    ),
  }
}

const enrichVmfsWithRuntimeMetadata = async (vmfs = []) => {
  if (!Array.isArray(vmfs) || vmfs.length === 0) {
    return []
  }

  const normalizedVmfs = vmfs.map(normalizeVmfRecord)
  const directPackageIds = [...new Set(
    normalizedVmfs
      .map((vmf) => vmf.frameworkPackageId)
      .filter(Boolean),
  )]
  const frameworkVersions = [...new Set(
    normalizedVmfs
      .map((vmf) => vmf.frameworkVersion)
      .filter(Boolean),
  )]

  const [frameworkPackages, activeFrameworkPackage] = await Promise.all([
    (directPackageIds.length > 0 || frameworkVersions.length > 0)
      ? FrameworkPackage.find({
        $or: [
          ...(directPackageIds.length > 0 ? [{ _id: { $in: directPackageIds } }] : []),
          ...(frameworkVersions.length > 0
            ? [{ frameworkKey: VMF_FRAMEWORK_KEY, version: { $in: frameworkVersions } }]
            : []),
        ],
      })
      : [],
    resolveActiveFrameworkPackage(),
  ])

  const frameworkPackagesById = new Map()
  const frameworkPackagesByVersion = new Map()

  for (const frameworkPackage of frameworkPackages || []) {
    const packageId = toIdString(frameworkPackage?._id || frameworkPackage?.id)
    if (packageId) {
      frameworkPackagesById.set(packageId, frameworkPackage)
    }

    if (frameworkPackage?.frameworkKey === VMF_FRAMEWORK_KEY && frameworkPackage?.version) {
      frameworkPackagesByVersion.set(frameworkPackage.version, frameworkPackage)
    }
  }

  return normalizedVmfs.map((vmf) => {
    const directFrameworkPackage = vmf.frameworkPackageId
      ? frameworkPackagesById.get(vmf.frameworkPackageId)
      : null
    const resolvedFrameworkPackage = directFrameworkPackage || frameworkPackagesByVersion.get(vmf.frameworkVersion) || null

    let snapshotStatus = VMF_RUNTIME_STATUSES.SNAPSHOT_UNBOUND
    if (directFrameworkPackage) {
      snapshotStatus = VMF_RUNTIME_STATUSES.SNAPSHOT_PACKAGE_BOUND
    } else if (resolvedFrameworkPackage) {
      snapshotStatus = VMF_RUNTIME_STATUSES.SNAPSHOT_PACKAGE_INFERRED_FROM_VERSION
    } else if (vmf.versionPolicyId) {
      snapshotStatus = VMF_RUNTIME_STATUSES.SNAPSHOT_LEGACY_POLICY_ONLY
    }

    return decorateVmfRecord({
      vmf,
      frameworkPackage: resolvedFrameworkPackage,
      activeFrameworkPackage,
      snapshotStatus,
    })
  })
}

const isLifecycleTransitionAllowed = (from, to) =>
  (VMF_LIFECYCLE_TRANSITIONS[from] || []).includes(to)

const buildVmfDeletionWindow = () => {
  const deletedAt = new Date()
  const retentionDays = Math.max(1, Number(env.vmfSoftDeleteRetentionDays || 30))
  const purgeAfter = new Date(deletedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000)
  return { deletedAt, purgeAfter, retentionDays }
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/customers/:customerId/tenants/:tenantId/vmfs          */
/* ------------------------------------------------------------------ */

/**
 * List VMFs for a tenant.
 *
 * Query params: status, q (name search), page, pageSize
 */
export const listVmfs = async (req, res, next) => {
  try {
    const { customerId, tenantId } = req.params
    const {
      status,
      lifecycleStatus,
      q,
      includeDeleted,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = { customerId, tenantId }
    if (status) filter.status = status
    if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus

    const includeDeletedRows = includeDeleted === true || includeDeleted === 'true'
    if (!includeDeletedRows) {
      filter.deletedAt = null
    }

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit
    const customer = req.scopes?.customer || await Customer.findById(customerId)
    const { maxVmfsPerTenant } = customerGovernanceService.getGovernanceLimits(customer)

    const [vmfs, total, activeCount] = await Promise.all([
      VMF.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VMF.countDocuments(filter),
      VMF.countByTenant(tenantId, 'ACTIVE'),
    ])

    const decoratedVmfs = await enrichVmfsWithRuntimeMetadata(vmfs)

    return res.status(200).json({
      data: decoratedVmfs,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
        vmfCapacity: {
          maxVmfs: maxVmfsPerTenant,
          currentCount: activeCount,
          remainingCount: Math.max(maxVmfsPerTenant - activeCount, 0),
          isAtCapacity: activeCount >= maxVmfsPerTenant,
          countMode: 'ACTIVE',
        },
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/tenants/:tenantId/vmfs         */
/* ------------------------------------------------------------------ */

/**
 * Create a VMF under a tenant.
 * Respects customer vmfPolicy via topologyGuard (run before this handler).
 */
export const createVmf = async (req, res, next) => {
  try {
    const { customerId, tenantId } = req.params
    const actorUserId = req.context?.userId || req.userId

    // Verify tenant belongs to customer and is enabled
    const tenant = req.scopes?.tenant || await Tenant.findById(tenantId)
    if (!tenant || tenant.customerId.toString() !== customerId) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Tenant not found.',
          requestId: req.requestId,
        },
      })
    }

    if (tenant.status !== 'ENABLED') {
      return res.status(403).json({
        error: {
          code: 'TENANT_DISABLED',
          message: 'Cannot create VMFs in a disabled tenant.',
          requestId: req.requestId,
        },
      })
    }

    const customer = req.scopes?.customer || await Customer.findById(customerId)
    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    const currentVmfCount = await VMF.countByTenant(tenantId, 'ACTIVE')
    customerGovernanceService.assertVmfCreationWithinLimit({
      customer,
      tenantId,
      currentVmfCount,
    })

    const {
      frameworkPackage,
      frameworkPackageId,
      frameworkVersion,
      versionPolicyId,
      snapshotStatus,
    } = await resolveVmfCreateBinding({
      frameworkPackageId: req.body.frameworkPackageId,
    })

    const vmf = new VMF({
      customerId,
      tenantId,
      name: req.body.name,
      description: req.body.description || '',
      status: 'ACTIVE',
      lifecycleStatus: 'DRAFT',
      frameworkPackageId,
      frameworkVersion,
      versionPolicyId,
      createdBy: actorUserId,
    })

    await vmf.save()

    await auditService.logFromRequest(req, {
      action: 'VMF_CREATED',
      resourceType: 'VMF',
      resourceId: vmf._id,
      scope: { customerId, tenantId, vmfId: vmf._id },
      diff: {
        name: req.body.name,
        description: vmf.description,
        lifecycleStatus: vmf.lifecycleStatus,
        frameworkPackageId: vmf.frameworkPackageId,
        frameworkVersion: vmf.frameworkVersion,
        versionPolicyId: vmf.versionPolicyId,
        snapshotStatus,
      },
    })

    logger.info(
      { customerId, tenantId, vmfId: vmf._id },
      'vmf.controller — VMF created',
    )

    return res.status(201).json({
      data: decorateVmfRecord({
        vmf,
        frameworkPackage,
        activeFrameworkPackage: frameworkPackage,
        snapshotStatus,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      monitoringService.recordLimitRejection({
        limitType: err?.details?.limitType || 'unknown',
        surface: 'vmf_controller',
      })

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.VMF_LIMIT_REJECTED,
        resourceType: 'Tenant',
        resourceId: req.params.tenantId,
        scope: { customerId: req.params.customerId, tenantId: req.params.tenantId },
        diff: {
          endpoint: 'create_vmf',
          reason: err.message,
          details: err.details || null,
        },
      })

      return res
        .status(err.status || 409)
        .json(buildGovernanceErrorResponse(req, err))
    }

    // Mongoose pre-save hook policy violations
    if (err.message?.includes('policy allows only')) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    if (err?.status && err?.error) {
      return res.status(err.status).json({
        error: {
          ...err.error,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/vmfs/:vmfId                                           */
/* ------------------------------------------------------------------ */

/**
 * Get a single VMF.  requireVmfAccess already loaded req.scopes.vmf.
 */
export const getVmf = async (req, res, next) => {
  try {
    const vmf = req.scopes?.vmf || await VMF.findById(req.params.vmfId)

    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    if (vmf.deletedAt) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    const [decoratedVmf] = await enrichVmfsWithRuntimeMetadata([vmf])

    return res.status(200).json({
      data: decoratedVmf,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/vmfs/:vmfId                                         */
/* ------------------------------------------------------------------ */

/**
 * Update VMF (name and/or status).
 */
export const updateVmf = async (req, res, next) => {
  try {
    const vmf = req.scopes?.vmf || await VMF.findById(req.params.vmfId)

    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    if (vmf.deletedAt) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    const diff = {}

    if (req.body.name !== undefined) {
      diff.name = { from: vmf.name, to: req.body.name }
      vmf.name = req.body.name
    }

    if (req.body.description !== undefined) {
      diff.description = { from: vmf.description || '', to: req.body.description }
      vmf.description = req.body.description
    }

    if (req.body.status !== undefined) {
      diff.status = { from: vmf.status, to: req.body.status }
      vmf.status = req.body.status
    }

    if (req.body.lifecycleStatus !== undefined) {
      const currentLifecycle = vmf.lifecycleStatus || 'DRAFT'
      const nextLifecycle = req.body.lifecycleStatus

      if (!isLifecycleTransitionAllowed(currentLifecycle, nextLifecycle)) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: `Invalid lifecycle transition from '${currentLifecycle}' to '${nextLifecycle}'.`,
            details: {
              reason: 'INVALID_LIFECYCLE_TRANSITION',
              from: currentLifecycle,
              to: nextLifecycle,
            },
            requestId: req.requestId,
          },
        })
      }

      diff.lifecycleStatus = { from: currentLifecycle, to: nextLifecycle }
      vmf.lifecycleStatus = nextLifecycle
    }

    await vmf.save()

    await auditService.logFromRequest(req, {
      action: 'VMF_UPDATED',
      resourceType: 'VMF',
      resourceId: vmf._id,
      scope: { customerId: vmf.customerId, tenantId: vmf.tenantId, vmfId: vmf._id },
      diff,
    })

    const [decoratedVmf] = await enrichVmfsWithRuntimeMetadata([vmf])

    return res.status(200).json({
      data: decoratedVmf,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/v1/vmfs/:vmfId                                        */
/* ------------------------------------------------------------------ */

/**
 * Soft-delete a VMF.
 *
 * Pre-conditions:
 *   - VMF must be DISABLED or ARCHIVED (cannot delete active VMFs)
 *   - VMF must have no active deals
 *   - VMF is retained for a fixed retention window before purge
 */
export const deleteVmf = async (req, res, next) => {
  try {
    const vmf = req.scopes?.vmf || await VMF.findById(req.params.vmfId)

    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    if (vmf.deletedAt) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'VMF is already scheduled for deletion.',
          details: {
            reason: 'VMF_ALREADY_SOFT_DELETED',
            deletedAt: vmf.deletedAt,
            purgeAfter: vmf.purgeAfter,
          },
          requestId: req.requestId,
        },
      })
    }

    if (vmf.status === 'ACTIVE') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cannot delete an active VMF. Disable or archive it first.',
          requestId: req.requestId,
        },
      })
    }

    // Check for active deals
    const activeDeals = await Deal.countDocuments({ vmfId: vmf._id, status: 'ACTIVE' })
    if (activeDeals > 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Cannot delete VMF with ${activeDeals} active deal(s). Archive them first.`,
          requestId: req.requestId,
        },
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const { deletedAt, purgeAfter, retentionDays } = buildVmfDeletionWindow()

    // Archive all deals for this VMF.
    await Deal.updateMany(
      { vmfId: vmf._id },
      { $set: { status: 'ARCHIVED' } },
    )

    // Remove vmfGrants referencing this VMF from all users
    await User.updateMany(
      { 'vmfGrants.vmfId': vmf._id },
      { $pull: { vmfGrants: { vmfId: vmf._id } } },
    )
    await performanceCacheService.invalidateAllUserPermissions()

    vmf.status = 'ARCHIVED'
    vmf.deletedAt = deletedAt
    vmf.purgeAfter = purgeAfter
    vmf.deletedBy = actorUserId || null
    await vmf.save()

    await auditService.logFromRequest(req, {
      action: 'VMF_DELETED',
      resourceType: 'VMF',
      resourceId: vmf._id,
      scope: { customerId: vmf.customerId, tenantId: vmf.tenantId, vmfId: vmf._id },
      diff: {
        name: vmf.name,
        deletedAt,
        purgeAfter,
        retentionDays,
        mode: 'SOFT_DELETE',
      },
    })

    logger.info(
      {
        vmfId: vmf._id,
        customerId: vmf.customerId,
        tenantId: vmf.tenantId,
        purgeAfter,
      },
      'vmf.controller — VMF soft-deleted and scheduled for purge',
    )

    return res.status(200).json({
      data: {
        message: `VMF '${vmf.name}' has been deleted and scheduled for purge.`,
        deletedAt,
        purgeAfter,
        retentionDays,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/vmfs/:vmfId/grants                                   */
/* ------------------------------------------------------------------ */

/**
 * Grant a user access to a VMF with specified permissions.
 *
 * Body: { userId, permissions: ['READ', 'WRITE', ...] }
 *
 * If the user already has a grant for this VMF, permissions are replaced.
 */
export const grantAccess = async (req, res, next) => {
  try {
    const vmf = req.scopes?.vmf || await VMF.findById(req.params.vmfId)

    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    const { userId, permissions } = req.body
    const targetUser = await User.findById(userId)

    if (!targetUser) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    // Verify user has a membership for the VMF's customer
    const hasMembership = targetUser.memberships.some(
      (m) => m.customerId?.toString() === vmf.customerId.toString(),
    )
    if (!hasMembership) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'User does not belong to this VMF\'s customer.',
          requestId: req.requestId,
        },
      })
    }

    // Upsert the grant
    const existingIdx = targetUser.vmfGrants.findIndex(
      (g) => g.vmfId?.toString() === vmf._id.toString(),
    )

    const grantData = {
      customerId: vmf.customerId,
      tenantId: vmf.tenantId,
      vmfId: vmf._id,
      permissions,
    }

    if (existingIdx >= 0) {
      targetUser.vmfGrants[existingIdx] = grantData
    } else {
      targetUser.vmfGrants.push(grantData)
    }

    await targetUser.save()
    await performanceCacheService.invalidateUserPermissions(targetUser._id)

    await auditService.logFromRequest(req, {
      action: 'VMF_GRANT_CREATED',
      resourceType: 'User',
      resourceId: targetUser._id,
      scope: { customerId: vmf.customerId, tenantId: vmf.tenantId, vmfId: vmf._id },
      display: {
        targetLabel: auditService.formatUserAuditLabel(targetUser),
        scopeLabel: auditService.formatEntityAuditLabel(vmf, { fallbackType: 'VMF', labelKeys: ['name'] }),
        permissionLabels: permissions,
      },
      diff: { userId, permissions },
    })

    return res.status(200).json({
      data: {
        message: `Access granted to user '${targetUser.name}' on VMF '${vmf.name}'.`,
        grant: grantData,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/v1/vmfs/:vmfId/grants/:userId                         */
/* ------------------------------------------------------------------ */

/**
 * Revoke a user's access to a VMF.
 */
export const revokeAccess = async (req, res, next) => {
  try {
    const vmf = req.scopes?.vmf || await VMF.findById(req.params.vmfId)

    if (!vmf) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'VMF not found.',
          requestId: req.requestId,
        },
      })
    }

    const { userId } = req.params
    const targetUser = await User.findById(userId)

    if (!targetUser) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    const grantIdx = targetUser.vmfGrants.findIndex(
      (g) => g.vmfId?.toString() === vmf._id.toString(),
    )

    if (grantIdx < 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User does not have a grant for this VMF.',
          requestId: req.requestId,
        },
      })
    }

    targetUser.vmfGrants.splice(grantIdx, 1)
    await targetUser.save()
    await performanceCacheService.invalidateUserPermissions(targetUser._id)

    await auditService.logFromRequest(req, {
      action: 'VMF_GRANT_REVOKED',
      resourceType: 'User',
      resourceId: targetUser._id,
      scope: { customerId: vmf.customerId, tenantId: vmf.tenantId, vmfId: vmf._id },
      display: {
        targetLabel: auditService.formatUserAuditLabel(targetUser),
        scopeLabel: auditService.formatEntityAuditLabel(vmf, { fallbackType: 'VMF', labelKeys: ['name'] }),
      },
      diff: { userId },
    })

    return res.status(200).json({
      data: { message: `Access revoked for user '${targetUser.name}' on VMF '${vmf.name}'.` },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
