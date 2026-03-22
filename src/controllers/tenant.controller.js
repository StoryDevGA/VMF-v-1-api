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
import { createTenantWithDefaults } from '../services/provisioningService.js'
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
    const scopedTenantIds = resolveTenantAdminScopedTenantIds(req)
    const actorUserId = toIdString(req.context?.userId || req.userId)

    if (tenantAdminOnly) {
      if (scopedTenantIds.length > 0) {
        filter._id = { $in: scopedTenantIds }
      } else if (actorUserId) {
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
        ...(tenantAdminOnly
          ? (scopedTenantIds.length > 0
            ? { _id: { $in: scopedTenantIds } }
            : actorUserId
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
    const result = await createTenantWithDefaults(req.body, customer, actorUserId, req)
    await performanceCacheService.setTenantStatus(
      result.tenant._id,
      buildTenantStatusSnapshot(result.tenant),
    )

    const tenantAdminUsersById = await loadTenantAdminUsersById([result.tenant])
    const responseData = {
      tenant: serializeTenantResponse({
        tenant: result.tenant,
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
      data: serializeTenantResponse({
        tenant,
        tenantAdminUsersById,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
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
