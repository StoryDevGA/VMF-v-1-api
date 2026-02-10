/**
 * Customer Controller
 *
 * Handles customer management endpoints (SUPER_ADMIN):
 *   - GET    /api/v1/customers             List customers (paginated)
 *   - POST   /api/v1/customers             Create customer + provision defaults
 *   - GET    /api/v1/customers/:customerId Get single customer
 *   - PATCH  /api/v1/customers/:customerId Update customer
 *   - PATCH  /api/v1/customers/:customerId/status  Update customer status
 *   - POST   /api/v1/customers/:customerId/admins  Assign CUSTOMER_ADMIN
 */

import { Customer, User, AuditLog } from '../models/index.js'
import { createCustomerWithDefaults } from '../services/provisioningService.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  GET /api/v1/customers                                             */
/* ------------------------------------------------------------------ */

/**
 * List customers with optional filters and pagination.
 *
 * Query params: status, topology, q (name search), page, pageSize
 */
export const listCustomers = async (req, res, next) => {
  try {
    const {
      status,
      topology,
      q,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = {}
    if (status) filter.status = status
    if (topology) filter.topology = topology
    if (q) filter.name = { $regex: q, $options: 'i' }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit

    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ])

    return res.status(200).json({
      data: customers,
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
/*  POST /api/v1/customers                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a new customer with provisioned defaults.
 */
export const createCustomer = async (req, res, next) => {
  try {
    const actorUserId = req.context?.userId || req.userId
    const result = await createCustomerWithDefaults(req.body, actorUserId, req)

    const responseData = {
      customer: result.customer.toJSON(),
    }
    if (result.tenant) responseData.tenant = result.tenant.toJSON()
    if (result.vmf) responseData.vmf = result.vmf.toJSON()

    return res.status(201).json({
      data: responseData,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    // Mongoose validation errors → 422
    if (err.name === 'ValidationError' || err.message?.includes('policy')) {
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
/*  GET /api/v1/customers/:customerId                                 */
/* ------------------------------------------------------------------ */

/**
 * Get a single customer by ID.
 */
export const getCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.customerId)

    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: customer.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/customers/:customerId                               */
/* ------------------------------------------------------------------ */

/**
 * Update customer fields (name, billing, entitlements, etc.).
 * Topology and vmfPolicy cannot be changed after creation.
 */
export const updateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.customerId)

    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    const allowedFields = ['name', 'isServiceProvider', 'entitlements', 'billing', 'trial']
    const diff = {}

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        diff[field] = { from: customer[field], to: req.body[field] }
        customer[field] = req.body[field]
      }
    }

    await customer.save()

    const actorUserId = req.context?.userId || req.userId
    try {
      await AuditLog.createLog({
        actorUserId,
        action: 'CUSTOMER_UPDATED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff,
        ip: req.ip,
        userAgent: req.get?.('user-agent'),
        requestId: req.requestId,
      })
    } catch (auditErr) {
      logger.error({ err: auditErr }, 'customer update audit log failed')
    }

    return res.status(200).json({
      data: customer.toJSON(),
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
/*  PATCH /api/v1/customers/:customerId/status                        */
/* ------------------------------------------------------------------ */

/**
 * Update customer status (ACTIVE, DISABLED, ARCHIVED).
 */
export const updateCustomerStatus = async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.customerId)

    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    const previousStatus = customer.status
    customer.status = req.body.status
    await customer.save()

    const actorUserId = req.context?.userId || req.userId
    try {
      await AuditLog.createLog({
        actorUserId,
        action: 'CUSTOMER_STATUS_CHANGED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: { status: { from: previousStatus, to: req.body.status } },
        ip: req.ip,
        userAgent: req.get?.('user-agent'),
        requestId: req.requestId,
      })
    } catch (auditErr) {
      logger.error({ err: auditErr }, 'customer status audit log failed')
    }

    return res.status(200).json({
      data: customer.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/admins                         */
/* ------------------------------------------------------------------ */

/**
 * Assign CUSTOMER_ADMIN membership to a user for this customer.
 */
export const assignAdmin = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { userId } = req.body

    const customer = await Customer.findById(customerId)
    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    if (!user.isActive) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cannot assign admin role to a disabled user.',
          requestId: req.requestId,
        },
      })
    }

    // Check if user already has a membership for this customer
    const existing = user.memberships.find(
      (m) => m.customerId && m.customerId.toString() === customerId,
    )

    if (existing) {
      // Add CUSTOMER_ADMIN if not already present
      if (!existing.roles.includes('CUSTOMER_ADMIN')) {
        existing.roles.push('CUSTOMER_ADMIN')
        await user.save()
      }
    } else {
      // Create new membership
      user.memberships.push({
        customerId,
        roles: ['CUSTOMER_ADMIN'],
      })
      await user.save()
    }

    const actorUserId = req.context?.userId || req.userId
    try {
      await AuditLog.createLog({
        actorUserId,
        action: 'CUSTOMER_ADMIN_ASSIGNED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: { userId, role: 'CUSTOMER_ADMIN' },
        ip: req.ip,
        userAgent: req.get?.('user-agent'),
        requestId: req.requestId,
      })
    } catch (auditErr) {
      logger.error({ err: auditErr }, 'admin assignment audit log failed')
    }

    return res.status(200).json({
      data: { message: 'Admin role assigned successfully.', userId },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
