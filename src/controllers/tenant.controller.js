/**
 * Tenant Controller
 *
 * Handles tenant management endpoints:
 *   - GET   /api/v1/customers/:customerId/tenants      List tenants
 *   - POST  /api/v1/customers/:customerId/tenants      Create tenant
 *   - PATCH /api/v1/tenants/:tenantId                   Update tenant
 *   - POST  /api/v1/tenants/:tenantId/enable            Enable tenant
 *   - POST  /api/v1/tenants/:tenantId/disable           Disable tenant
 */

import { Customer, Tenant, User } from '../models/index.js'
import auditService from '../services/auditService.js'
import customerGovernanceService from '../services/customerGovernanceService.js'
import logger from '../config/logger.js'
import monitoringService from '../services/monitoringService.js'
import performanceCacheService, {
  buildTenantStatusSnapshot,
} from '../services/performanceCacheService.js'
import {
  buildTenantVisibilityCatalogMeta,
  mapTenantVisibilityCatalogEntry,
} from '../services/tenantVisibilityContractService.js'
import {
  buildTenantAdminAssignmentErrorResponse,
  buildTenantCapacityMeta,
  validateTenantAdminAssignments,
} from '../services/tenantManagementContractService.js'
import {
  createTenantWithAdminRoleCoupling,
  isHttpResponseError,
  updateTenantWithAdminRoleCoupling,
} from '../services/tenantAdminRoleCouplingService.js'

const buildGovernanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || 'CONFLICT',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const buildTenantNotFoundResponse = (req) => ({
  error: {
    code: 'NOT_FOUND',
    message: 'Tenant not found.',
    requestId: req.requestId,
  },
})

const tenantMatchesCustomerScope = (req, tenant) => {
  const customerId = toIdString(req.params?.customerId)
  if (!customerId) return true
  return toIdString(tenant?.customerId) === customerId
}

const buildForbiddenResponse = (req, message, details) => ({
  error: {
    code: 'FORBIDDEN',
    message,
    ...(details ? { details } : {}),
    requestId: req.requestId,
  },
})

const isTenantAdminOnlyRequest = (req) => {
  const customerAccess = req.scopes?.customerAccess
  return Boolean(
    customerAccess?.isTenantAdmin
      && !customerAccess?.isCustomerAdmin
      && !customerAccess?.isSuperAdmin,
  )
}

const resolveTenantAdminScopedTenantIds = (req) =>
  Array.from(
    new Set(
      (req.scopes?.customerAccess?.tenantAdminTenantIds || [])
        .map((tenantId) => toIdString(tenantId))
        .filter(Boolean),
    ),
  )

const resolveAccessibleTenantIds = (req) =>
  Array.from(
    new Set(
      (req.scopes?.customerAccess?.accessibleTenantIds || [])
        .map((tenantId) => toIdString(tenantId))
        .filter(Boolean),
    ),
  )

const normalizeTenantAdminRef = (value) => {
  if (!value) return null

  if (typeof value === 'object') {
    const id = toIdString(value._id || value.id)
    if (!id) return null

    return {
      id,
      name: typeof value.name === 'string' ? value.name : null,
    }
  }

  const id = toIdString(value)
  if (!id) return null

  return { id, name: null }
}

const getTenantAdminRefs = (tenant) =>
  Array.isArray(tenant?.tenantAdminUserIds)
    ? tenant.tenantAdminUserIds
      .map((value) => normalizeTenantAdminRef(value))
      .filter(Boolean)
    : []

const collectTenantAdminIds = (tenants) => {
  const tenantList = Array.isArray(tenants) ? tenants : [tenants]

  return [...new Set(
    tenantList
      .flatMap((tenant) => getTenantAdminRefs(tenant).map((admin) => admin.id))
      .filter(Boolean),
  )]
}

const loadTenantAdminUsersById = async (tenants) => {
  const tenantAdminIds = collectTenantAdminIds(tenants)
  if (tenantAdminIds.length === 0) return new Map()

  const users = await User.find({ _id: { $in: tenantAdminIds } }).lean()
  return new Map((Array.isArray(users) ? users : []).map((user) => [toIdString(user?._id), user]))
}

const buildTenantAdminSummary = (tenant, tenantAdminUsersById = new Map()) => {
  const [tenantAdmin] = getTenantAdminRefs(tenant)
  if (!tenantAdmin) return null

  const user = tenantAdminUsersById.get(tenantAdmin.id)

  return {
    id: tenantAdmin.id,
    name: user?.name || tenantAdmin.name || null,
  }
}

const resolveCustomerMembership = (user, customerId) =>
  (user?.memberships || []).find(
    (membership) => toIdString(membership?.customerId) === toIdString(customerId),
  ) || null

const buildTenantAdminUserResponse = ({
  tenant,
  customerId,
  tenantAdminUsersById = new Map(),
}) => {
  const [tenantAdmin] = getTenantAdminRefs(tenant)
  if (!tenantAdmin) return null

  const user = tenantAdminUsersById.get(tenantAdmin.id)
  if (!user) {
    return {
      id: tenantAdmin.id,
      name: tenantAdmin.name || null,
      email: null,
      status: null,
      trustStatus: null,
      customerRoles: [],
    }
  }

  const membership = resolveCustomerMembership(user, customerId)

  return {
    id: toIdString(user?._id || user?.id),
    name: user?.name || tenantAdmin.name || null,
    email: user?.email || null,
    status: user?.isActive === false ? 'INACTIVE' : 'ACTIVE',
    trustStatus: user?.identityPlus?.trustStatus || 'UNTRUSTED',
    customerRoles: Array.isArray(membership?.roles) ? membership.roles : [],
  }
}

const buildTenantResponseBase = (tenant) => {
  const baseTenant = tenant && typeof tenant.toJSON === 'function'
    ? tenant.toJSON()
    : { ...(tenant || {}) }

  return {
    ...baseTenant,
    id: toIdString(baseTenant?._id || baseTenant?.id || tenant?._id || tenant?.id),
  }
}

const serializeTenantResponse = ({
  tenant,
  tenantAdminUsersById,
  includeSelectionState = false,
}) => {
  const baseTenant = includeSelectionState
    ? mapTenantVisibilityCatalogEntry(tenant)
    : buildTenantResponseBase(tenant)

  return {
    ...baseTenant,
    tenantAdmin: buildTenantAdminSummary(tenant, tenantAdminUsersById),
  }
}

const isTenantInActorScope = ({ req, tenant }) => {
  if (!isTenantAdminOnlyRequest(req)) return true

  const scopedTenantIds = resolveTenantAdminScopedTenantIds(req)
  const tenantId = toIdString(tenant?._id || tenant?.id)
  if (!tenantId) return false

  if (scopedTenantIds.length > 0) {
    return scopedTenantIds.includes(tenantId)
  }

  const actorUserId = toIdString(req.context?.userId || req.userId)
  if (!actorUserId) return false

  return getTenantAdminRefs(tenant).some((tenantAdmin) => tenantAdmin.id === actorUserId)
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/customers/:customerId/tenants                         */
/* ------------------------------------------------------------------ */

/**
 * List tenants for a customer.  Includes all statuses.
 *
 * Query params: status, q (name search), page, pageSize
 */
export const listTenants = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const customer = req.scopes?.customer || await Customer.findById(customerId)
    const {
      status,
      q,
      page = 1,
      pageSize = 20,
    } = req.query

    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    const filter = { customerId }
    const tenantAdminOnly = isTenantAdminOnlyRequest(req)
    const tenantMemberOnly = req.scopes?.customerAccess?.via === 'tenant_member'
    const scopedTenantIds = resolveTenantAdminScopedTenantIds(req)
    const accessibleTenantIds = resolveAccessibleTenantIds(req)
    const actorUserId = toIdString(req.context?.userId || req.userId)

    if (tenantAdminOnly || tenantMemberOnly) {
      if (scopedTenantIds.length > 0) {
        filter._id = { $in: scopedTenantIds }
      } else if (accessibleTenantIds.length > 0) {
        filter._id = { $in: accessibleTenantIds }
      } else if (tenantAdminOnly && actorUserId) {
        filter.tenantAdminUserIds = actorUserId
      } else {
        filter._id = { $in: [] }
      }
    }

    if (status) filter.status = status
    if (q) filter.name = { $regex: q, $options: 'i' }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit

    const [tenants, total, currentTenantCount] = await Promise.all([
      Tenant.find(filter)
        .sort({ isDefault: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tenant.countDocuments(filter),
      Tenant.countDocuments({
        customerId,
        status: { $ne: 'ARCHIVED' },
        ...(tenantAdminOnly || tenantMemberOnly
          ? (scopedTenantIds.length > 0
            ? { _id: { $in: scopedTenantIds } }
            : accessibleTenantIds.length > 0
              ? { _id: { $in: accessibleTenantIds } }
              : tenantAdminOnly && actorUserId
                ? { tenantAdminUserIds: actorUserId }
                : { _id: { $in: [] } })
          : {}),
      }),
    ])
    const tenantAdminUsersById = await loadTenantAdminUsersById(tenants)
    const tenantRows = tenants.map((tenant) => serializeTenantResponse({
      tenant,
      tenantAdminUsersById,
      includeSelectionState: true,
    }))

    return res.status(200).json({
      data: tenantRows,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
        customerName: customer?.name || null,
        tenantCapacity: buildTenantCapacityMeta({
          customer,
          currentTenantCount,
        }),
        tenantVisibility: buildTenantVisibilityCatalogMeta({ customer }),
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/tenants                        */
/* ------------------------------------------------------------------ */

/**
 * Create a tenant (multi-tenant / service-provider customers only).
 * Auto-creates VMF 1 if vmfPolicy requires it.
 */
export const createTenant = async (req, res, next) => {
  try {
    const { customerId } = req.params

    // The customer is already attached by requireCustomerAccess
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

    // Only multi-tenant or service-provider customers can create tenants
    if (customer.topology === 'SINGLE_TENANT') {
      return res.status(422).json({
        error: {
          code: 'TOPOLOGY_CONSTRAINT',
          message: 'Single-tenant customers cannot create additional tenants.',
          requestId: req.requestId,
        },
      })
    }

    const currentTenantCount = await Tenant.countDocuments({
      customerId: customer._id,
      status: { $ne: 'ARCHIVED' },
    })

    customerGovernanceService.assertTenantCreationWithinLimit({
      customer,
      currentTenantCount,
    })

    const tenantAdminAssignmentValidation = await validateTenantAdminAssignments({
      customerId: customer._id,
      tenantAdminUserIds: req.body.tenantAdminUserIds,
    })
    if (tenantAdminAssignmentValidation) {
      return res.status(422).json(
        buildTenantAdminAssignmentErrorResponse({
          req,
          customerId: customer._id,
          validation: tenantAdminAssignmentValidation,
        }),
      )
    }

    const actorUserId = req.context?.userId || req.userId
    const result = await createTenantWithAdminRoleCoupling({
      customerId,
      payload: req.body,
      actorUserId,
      req,
    })
    const createdTenantAdminUserId = toIdString(
      result.tenantAdminUser?._id || result.tenantAdminUser?.id,
    )
    await performanceCacheService.setTenantStatus(
      result.tenant._id,
      buildTenantStatusSnapshot(result.tenant),
    )
    if (result.tenantAdminRoleChange?.changed && createdTenantAdminUserId) {
      await performanceCacheService.invalidateUserPermissions(createdTenantAdminUserId)
    }

    await auditService.logFromRequest(req, {
      action: 'TENANT_CREATED',
      resourceType: 'Tenant',
      resourceId: result.tenant._id,
      scope: { customerId: result.customer._id, tenantId: result.tenant._id },
      diff: null,
    })
    if (result.vmf) {
      await auditService.logFromRequest(req, {
        action: 'VMF_CREATED',
        resourceType: 'VMF',
        resourceId: result.vmf._id,
        scope: { customerId: result.customer._id, tenantId: result.tenant._id, vmfId: result.vmf._id },
        diff: null,
      })
    }
    if (result.tenantAdminRoleChange?.changed && createdTenantAdminUserId) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.USER_ROLE_UPDATED,
        resourceType: 'User',
        resourceId: createdTenantAdminUserId,
        scope: { customerId: result.customer._id, tenantId: result.tenant._id },
        display: { targetLabel: auditService.formatUserAuditLabel(result.tenantAdminUser) },
        diff: {
          customerRoles: {
            from: result.tenantAdminRoleChange.previousRoles,
            to: result.tenantAdminRoleChange.nextRoles,
          },
          source: 'tenant_admin_assignment_coupling',
        },
      })
    }

    const tenantAdminUsersById = result.tenantAdminUser
      ? new Map([[
          toIdString(result.tenantAdminUser._id || result.tenantAdminUser.id),
          result.tenantAdminUser,
        ]])
      : await loadTenantAdminUsersById([result.tenant])
    const responseData = {
      tenant: serializeTenantResponse({
        tenant: result.tenant,
        tenantAdminUsersById,
      }),
      tenantAdminUser: buildTenantAdminUserResponse({
        tenant: result.tenant,
        customerId: result.customer._id,
        tenantAdminUsersById,
      }),
    }
    if (result.vmf) responseData.vmf = result.vmf.toJSON()

    return res.status(201).json({
      data: responseData,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      monitoringService.recordLimitRejection({
        limitType: err?.details?.limitType || 'unknown',
        surface: 'tenant_controller',
      })

      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.TENANT_LIMIT_REJECTED,
        resourceType: 'Customer',
        resourceId: req.params.customerId,
        scope: { customerId: req.params.customerId },
        diff: {
          endpoint: 'create_tenant',
          reason: err.message,
          details: err.details || null,
        },
      })

      return res
        .status(err.status || 409)
        .json(buildGovernanceErrorResponse(req, err))
    }
    if (isHttpResponseError(err)) {
      return res.status(err.status || 422).json(err.response)
    }

    if (err.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/tenants/:tenantId                                   */
/* ------------------------------------------------------------------ */

/**
 * Update a tenant (name, website, tenantAdminUserIds).
 */
export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.tenantId)

    if (!tenant) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!tenantMatchesCustomerScope(req, tenant)) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!isTenantInActorScope({ req, tenant })) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (isTenantAdminOnlyRequest(req) && req.body.tenantAdminUserIds !== undefined) {
      return res.status(403).json(
        buildForbiddenResponse(
          req,
          'Tenant admins cannot reassign tenant admin ownership.',
          { reason: 'TENANT_ADMIN_ASSIGNMENT_FORBIDDEN' },
        ),
      )
    }

    const allowedFields = ['name', 'website', 'tenantAdminUserIds']
    const diff = {}

    if (req.body.tenantAdminUserIds !== undefined) {
      const tenantAdminAssignmentValidation = await validateTenantAdminAssignments({
        customerId: tenant.customerId,
        tenantAdminUserIds: req.body.tenantAdminUserIds,
      })
      if (tenantAdminAssignmentValidation) {
        return res.status(422).json(
          buildTenantAdminAssignmentErrorResponse({
            req,
            customerId: tenant.customerId,
            validation: tenantAdminAssignmentValidation,
          }),
        )
      }
    }

    if (req.body.tenantAdminUserIds !== undefined) {
      const mutation = await updateTenantWithAdminRoleCoupling({
        tenantId: req.params.tenantId,
        updates: req.body,
        req,
      })
      const updatedTenantAdminUserId = toIdString(
        mutation.tenantAdminUser?._id || mutation.tenantAdminUser?.id,
      )

      await performanceCacheService.invalidateTenantStatus(mutation.tenant._id)
      if (mutation.tenantAdminRoleChange?.changed && updatedTenantAdminUserId) {
        await performanceCacheService.invalidateUserPermissions(updatedTenantAdminUserId)
      }

      await auditService.logFromRequest(req, {
        action: 'TENANT_UPDATED',
        resourceType: 'Tenant',
        resourceId: mutation.tenant._id,
        scope: { customerId: mutation.tenant.customerId, tenantId: mutation.tenant._id },
        diff: mutation.diff,
      })
      if (mutation.tenantAdminRoleChange?.changed && updatedTenantAdminUserId) {
        await auditService.logFromRequest(req, {
          action: auditService.AUDIT_ACTIONS.USER_ROLE_UPDATED,
          resourceType: 'User',
          resourceId: updatedTenantAdminUserId,
          scope: { customerId: mutation.tenant.customerId, tenantId: mutation.tenant._id },
          display: { targetLabel: auditService.formatUserAuditLabel(mutation.tenantAdminUser) },
          diff: {
            customerRoles: {
              from: mutation.tenantAdminRoleChange.previousRoles,
              to: mutation.tenantAdminRoleChange.nextRoles,
            },
            source: 'tenant_admin_assignment_coupling',
          },
        })
      }

      const tenantAdminUsersById = mutation.tenantAdminUser
        ? new Map([[
            toIdString(mutation.tenantAdminUser._id || mutation.tenantAdminUser.id),
            mutation.tenantAdminUser,
          ]])
        : await loadTenantAdminUsersById([mutation.tenant])

      return res.status(200).json({
        data: {
          ...serializeTenantResponse({
            tenant: mutation.tenant,
            tenantAdminUsersById,
          }),
          tenantAdminUser: buildTenantAdminUserResponse({
            tenant: mutation.tenant,
            customerId: mutation.tenant.customerId,
            tenantAdminUsersById,
          }),
        },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        diff[field] = { from: tenant[field], to: req.body[field] }
        tenant[field] = req.body[field]
      }
    }

    await tenant.save()
    await performanceCacheService.invalidateTenantStatus(tenant._id)

    await auditService.logFromRequest(req, {
      action: 'TENANT_UPDATED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff,
    })

    const tenantAdminUsersById = await loadTenantAdminUsersById([tenant])

    return res.status(200).json({
      data: {
        ...serializeTenantResponse({
          tenant,
          tenantAdminUsersById,
        }),
        tenantAdminUser: buildTenantAdminUserResponse({
          tenant,
          customerId: tenant.customerId,
          tenantAdminUsersById,
        }),
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isHttpResponseError(err)) {
      return res.status(err.status || 422).json(err.response)
    }
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/tenants/:tenantId/enable                             */
/* ------------------------------------------------------------------ */

/**
 * Enable a tenant.  Immediate effect — subsequent API calls scoped
 * to this tenant will succeed again.
 */
export const enableTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.tenantId)

    if (!tenant) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!tenantMatchesCustomerScope(req, tenant)) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!isTenantInActorScope({ req, tenant })) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (tenant.status === 'ENABLED') {
      const tenantAdminUsersById = await loadTenantAdminUsersById([tenant])

      return res.status(200).json({
        data: serializeTenantResponse({
          tenant,
          tenantAdminUsersById,
        }),
        meta: { requestId: req.requestId, version: 'v1', message: 'Tenant is already enabled.' },
      })
    }

    if (tenant.status === 'ARCHIVED') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Archived tenants cannot be re-enabled.',
          requestId: req.requestId,
        },
      })
    }

    const previousStatus = tenant.status
    tenant.status = 'ENABLED'
    await tenant.save()
    await performanceCacheService.invalidateTenantStatus(tenant._id)

    await auditService.logFromRequest(req, {
      action: 'TENANT_ENABLED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff: { status: { from: previousStatus, to: 'ENABLED' } },
    })

    const tenantAdminUsersById = await loadTenantAdminUsersById([tenant])

    return res.status(200).json({
      data: serializeTenantResponse({
        tenant,
        tenantAdminUsersById,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/tenants/:tenantId/disable                            */
/* ------------------------------------------------------------------ */

/**
 * Disable a tenant.  Immediate effect — subsequent API calls scoped
 * to this tenant will be rejected with 403.
 */
export const disableTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.tenantId)

    if (!tenant) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!tenantMatchesCustomerScope(req, tenant)) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    if (!isTenantInActorScope({ req, tenant })) {
      return res.status(404).json(buildTenantNotFoundResponse(req))
    }

    // Prevent disabling default tenants
    if (tenant.isDefault) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Default tenants cannot be disabled.',
          requestId: req.requestId,
        },
      })
    }

    if (tenant.status === 'DISABLED') {
      const tenantAdminUsersById = await loadTenantAdminUsersById([tenant])

      return res.status(200).json({
        data: serializeTenantResponse({
          tenant,
          tenantAdminUsersById,
        }),
        meta: { requestId: req.requestId, version: 'v1', message: 'Tenant is already disabled.' },
      })
    }

    if (tenant.status === 'ARCHIVED') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Archived tenants cannot be disabled.',
          requestId: req.requestId,
        },
      })
    }

    const previousStatus = tenant.status
    tenant.status = 'DISABLED'
    await tenant.save()
    await performanceCacheService.invalidateTenantStatus(tenant._id)

    await auditService.logFromRequest(req, {
      action: 'TENANT_DISABLED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff: { status: { from: previousStatus, to: 'DISABLED' } },
    })

    const tenantAdminUsersById = await loadTenantAdminUsersById([tenant])

    return res.status(200).json({
      data: serializeTenantResponse({
        tenant,
        tenantAdminUsersById,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
