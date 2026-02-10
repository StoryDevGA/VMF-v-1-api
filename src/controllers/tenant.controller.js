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

import { Customer, Tenant } from '../models/index.js'
import { createTenantWithDefaults } from '../services/provisioningService.js'
import auditService from '../services/auditService.js'
import logger from '../config/logger.js'

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
    const {
      status,
      q,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = { customerId }
    if (status) filter.status = status
    if (q) filter.name = { $regex: q, $options: 'i' }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit

    const [tenants, total] = await Promise.all([
      Tenant.find(filter)
        .sort({ isDefault: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tenant.countDocuments(filter),
    ])

    return res.status(200).json({
      data: tenants,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
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

    const actorUserId = req.context?.userId || req.userId
    const result = await createTenantWithDefaults(req.body, customer, actorUserId, req)

    const responseData = {
      tenant: result.tenant.toJSON(),
    }
    if (result.vmf) responseData.vmf = result.vmf.toJSON()

    return res.status(201).json({
      data: responseData,
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
/*  PATCH /api/v1/tenants/:tenantId                                   */
/* ------------------------------------------------------------------ */

/**
 * Update a tenant (name, website, tenantAdminUserIds).
 */
export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.tenantId)

    if (!tenant) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Tenant not found.',
          requestId: req.requestId,
        },
      })
    }

    const allowedFields = ['name', 'website', 'tenantAdminUserIds']
    const diff = {}

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        diff[field] = { from: tenant[field], to: req.body[field] }
        tenant[field] = req.body[field]
      }
    }

    await tenant.save()

    await auditService.logFromRequest(req, {
      action: 'TENANT_UPDATED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff,
    })

    return res.status(200).json({
      data: tenant.toJSON(),
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
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Tenant not found.',
          requestId: req.requestId,
        },
      })
    }

    if (tenant.status === 'ENABLED') {
      return res.status(200).json({
        data: tenant.toJSON(),
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

    await auditService.logFromRequest(req, {
      action: 'TENANT_ENABLED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff: { status: { from: previousStatus, to: 'ENABLED' } },
    })

    return res.status(200).json({
      data: tenant.toJSON(),
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
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Tenant not found.',
          requestId: req.requestId,
        },
      })
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
      return res.status(200).json({
        data: tenant.toJSON(),
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

    await auditService.logFromRequest(req, {
      action: 'TENANT_DISABLED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: tenant.customerId, tenantId: tenant._id },
      diff: { status: { from: previousStatus, to: 'DISABLED' } },
    })

    return res.status(200).json({
      data: tenant.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
