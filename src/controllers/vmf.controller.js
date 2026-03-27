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

import { Customer, Tenant, VMF, Deal, User, SystemVersioningPolicy } from '../models/index.js'
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

const resolveVmfVersionSnapshot = async () => {
  if (typeof SystemVersioningPolicy.findActive !== 'function') {
    return {
      frameworkVersion: null,
      versionPolicyId: null,
    }
  }

  try {
    const activePolicy = await SystemVersioningPolicy.findActive()
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
  } catch (err) {
    logger.warn({ err }, 'vmf.controller - failed to resolve active versioning policy')
    return {
      frameworkVersion: null,
      versionPolicyId: null,
    }
  }
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

    return res.status(200).json({
      data: vmfs,
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

    const { frameworkVersion, versionPolicyId } = await resolveVmfVersionSnapshot()

    const vmf = new VMF({
      customerId,
      tenantId,
      name: req.body.name,
      description: req.body.description || '',
      status: 'ACTIVE',
      lifecycleStatus: 'DRAFT',
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
        frameworkVersion: vmf.frameworkVersion,
        versionPolicyId: vmf.versionPolicyId,
      },
    })

    logger.info(
      { customerId, tenantId, vmfId: vmf._id },
      'vmf.controller — VMF created',
    )

    return res.status(201).json({
      data: vmf.toJSON(),
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

    return res.status(200).json({
      data: vmf.toJSON ? vmf.toJSON() : vmf,
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

    return res.status(200).json({
      data: vmf.toJSON(),
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
