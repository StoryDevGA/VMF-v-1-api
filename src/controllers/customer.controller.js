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
 *   - POST   /api/v1/customers/:customerId/admins/replace  Replace CUSTOMER_ADMIN
 */

import { Customer, LicenseLevel, Tenant, User } from '../models/index.js'
import { createCustomerWithDefaults } from '../services/provisioningService.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'
import customerGovernanceService from '../services/customerGovernanceService.js'
import monitoringService from '../services/monitoringService.js'
import logger from '../config/logger.js'

const DUPLICATE_CUSTOMER_NAME_MESSAGE = 'A customer with this name already exists.'

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeCustomerName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const buildCustomerNameRegex = (name) => {
  const normalized = normalizeCustomerName(name)
  const escapedTokens = normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => escapeRegex(token))

  return `^${escapedTokens.join('\\s+')}$`
}

const buildCustomerNameFilter = (name, excludeCustomerId = null) => {
  const normalizedName = normalizeCustomerName(name)
  const filter = {
    $or: [
      { nameNormalized: normalizedName },
      { name: { $regex: buildCustomerNameRegex(name), $options: 'i' } },
    ],
  }

  if (excludeCustomerId) {
    filter._id = { $ne: excludeCustomerId }
  }

  return filter
}

const findConflictingCustomerByName = (name, excludeCustomerId = null) => {
  if (!normalizeCustomerName(name)) {
    return Promise.resolve(null)
  }

  return Customer.findOne(buildCustomerNameFilter(String(name), excludeCustomerId))
}

const isCustomerNameDuplicateKeyError = (err) =>
  err?.code === 11000 && (err?.keyPattern?.name || err?.keyPattern?.nameNormalized)

const isCustomerNameDuplicateError = (err) =>
  err?.code === 'DUPLICATE_CUSTOMER_NAME' || isCustomerNameDuplicateKeyError(err)

const validateLicenseLevelExists = async (licenseLevelId) => {
  if (!licenseLevelId) return true
  const licenseLevel = await LicenseLevel.findById(licenseLevelId).select('_id')
  return Boolean(licenseLevel)
}

const buildGovernanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || (err.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED'),
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

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
    if (status) {
      filter.status = status === 'INACTIVE' ? 'DISABLED' : status
    }
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
    if (req.body.licenseLevelId !== undefined) {
      const licenseLevelExists = await validateLicenseLevelExists(req.body.licenseLevelId)
      if (!licenseLevelExists) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'licenseLevelId must reference an existing licence level.',
            requestId: req.requestId,
          },
        })
      }
    }

    const conflict = await findConflictingCustomerByName(req.body.name)
    if (conflict) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

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
    if (isCustomerNameDuplicateError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    // Mongoose validation errors -> 422
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

    if (req.body.name !== undefined) {
      const conflict = await findConflictingCustomerByName(req.body.name, customer._id)
      if (conflict) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
            requestId: req.requestId,
          },
        })
      }
    }

    if (req.body.licenseLevelId !== undefined) {
      const licenseLevelExists = await validateLicenseLevelExists(req.body.licenseLevelId)
      if (!licenseLevelExists) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'licenseLevelId must reference an existing licence level.',
            requestId: req.requestId,
          },
        })
      }
    }

    if (req.body.governance?.customerAdminUserId !== undefined) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'governance.customerAdminUserId is managed by admin assignment and replacement endpoints.',
          requestId: req.requestId,
        },
      })
    }

    const allowedFields = [
      'name',
      'website',
      'isServiceProvider',
      'licenseLevelId',
      'governance',
      'entitlements',
      'billing',
      'trial',
    ]
    const diff = {}

    for (const field of allowedFields) {
      if (req.body[field] === undefined) continue

      if (field === 'governance') {
        const currentGovernance = customer.governance?.toObject
          ? customer.governance.toObject()
          : (customer.governance || {})
        const nextGovernance = {
          ...currentGovernance,
          ...req.body.governance,
        }

        diff.governance = { from: currentGovernance, to: nextGovernance }
        customer.governance = nextGovernance
        continue
      }

      diff[field] = { from: customer[field], to: req.body[field] }
      customer[field] = req.body[field]
    }

    await customer.save()
    await performanceCacheService.invalidateCustomerTopology(customer._id)

    await auditService.logFromRequest(req, {
      action: 'CUSTOMER_UPDATED',
      resourceType: 'Customer',
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff,
    })

    if (diff.governance) {
      const previousGovernance = diff.governance.from || {}
      const nextGovernance = diff.governance.to || {}
      const limitsChanged = previousGovernance.maxTenants !== nextGovernance.maxTenants ||
        previousGovernance.maxVmfsPerTenant !== nextGovernance.maxVmfsPerTenant

      if (limitsChanged) {
        await auditService.logFromRequest(req, {
          action: 'CUSTOMER_LIMITS_CHANGED',
          resourceType: 'Customer',
          resourceId: customer._id,
          scope: { customerId: customer._id },
          diff: {
            from: {
              maxTenants: previousGovernance.maxTenants,
              maxVmfsPerTenant: previousGovernance.maxVmfsPerTenant,
            },
            to: {
              maxTenants: nextGovernance.maxTenants,
              maxVmfsPerTenant: nextGovernance.maxVmfsPerTenant,
            },
          },
        })
      }
    }

    if (diff.licenseLevelId) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_LICENSE_CHANGED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: {
          licenseLevelId: diff.licenseLevelId,
        },
      })
    }

    return res.status(200).json({
      data: customer.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isCustomerNameDuplicateError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
          requestId: req.requestId,
        },
      })
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

    const nextStatus = req.body.status === 'INACTIVE' ? 'DISABLED' : req.body.status
    const previousStatus = customer.status
    customer.status = nextStatus
    await customer.save()
    await performanceCacheService.invalidateCustomerTopology(customer._id)

    /* -------------------------------------------------------------- */
    /*  Cascade: disable tenants and deactivate users when INACTIVE   */
    /* -------------------------------------------------------------- */

    let cascadeSummary = null

    if (nextStatus === 'DISABLED' || nextStatus === 'ARCHIVED') {
      const tenantResult = await Tenant.updateMany(
        { customerId: customer._id, status: { $nin: ['DISABLED', 'ARCHIVED'] } },
        { status: 'DISABLED' },
      )

      const affectedUsers = await User.find(
        { 'memberships.customerId': customer._id, isActive: true },
        { _id: 1 },
      ).lean()

      const userResult = await User.updateMany(
        { 'memberships.customerId': customer._id, isActive: true },
        { isActive: false },
      )

      // Invalidate permission caches for all affected users
      await Promise.all(
        affectedUsers.map((u) => performanceCacheService.invalidateUserPermissions(u._id)),
      )

      monitoringService.recordInactiveCustomerBlock({ surface: 'customer_status_cascade' })

      cascadeSummary = {
        tenantsDisabled: tenantResult.modifiedCount,
        usersDeactivated: userResult.modifiedCount,
      }

      logger.info(
        { customerId: customer._id, ...cascadeSummary, requestId: req.requestId },
        'customer status cascade — tenants disabled and users deactivated',
      )
    }

    await auditService.logFromRequest(req, {
      action: 'CUSTOMER_STATUS_CHANGED',
      resourceType: 'Customer',
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        status: { from: previousStatus, to: nextStatus },
        ...(cascadeSummary && { cascade: cascadeSummary }),
      },
    })

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

    const assignment = await customerGovernanceService.applyCustomerAdminAssignment({
      customer,
      user,
    })

    await Promise.all([
      performanceCacheService.invalidateUserPermissions(user._id),
      performanceCacheService.invalidateCustomerTopology(customer._id),
    ])

    await auditService.logFromRequest(req, {
      action: 'CUSTOMER_ADMIN_ASSIGNED',
      resourceType: 'Customer',
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        userId,
        role: 'CUSTOMER_ADMIN',
        canonicalAdminUserId: assignment.canonicalAdminUserId,
        previousCanonicalAdminUserId: assignment.previousCanonicalAdminUserId,
      },
    })

    if (assignment.customerChanged) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_CANONICAL_SET',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: {
          from: assignment.previousCanonicalAdminUserId,
          to: assignment.canonicalAdminUserId,
          source: 'assign_admin',
        },
      })
    }

    return res.status(200).json({
      data: {
        message: 'Admin role assigned successfully.',
        userId,
        canonicalAdminUserId: assignment.canonicalAdminUserId,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'Customer',
        resourceId: req.params.customerId,
        scope: { customerId: req.params.customerId },
        diff: {
          endpoint: 'assign_admin',
          reason: err.message,
          details: err.details || null,
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/admins/replace                 */
/* ------------------------------------------------------------------ */

/**
 * Replace the current CUSTOMER_ADMIN membership for a customer.
 */
export const replaceAdmin = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { newUserId, reason } = req.body

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

    const newUser = await User.findById(newUserId)
    if (!newUser) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    if (!newUser.isActive) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cannot assign customer admin role to an inactive user.',
          requestId: req.requestId,
        },
      })
    }

    const replacement = await customerGovernanceService.replaceCustomerAdmin({
      customer,
      newUser,
    })

    await Promise.all([
      performanceCacheService.invalidateUserPermissions(replacement.oldUserId),
      performanceCacheService.invalidateUserPermissions(replacement.newUserId),
      performanceCacheService.invalidateCustomerTopology(customer._id),
    ])

    await auditService.logFromRequest(req, {
      action: 'CUSTOMER_ADMIN_REPLACED',
      resourceType: 'Customer',
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        oldUserId: replacement.oldUserId,
        newUserId: replacement.newUserId,
        previousCanonicalAdminUserId: replacement.oldUserId,
        canonicalAdminUserId: replacement.newUserId,
        reason,
      },
    })

    await auditService.logFromRequest(req, {
      action: 'CUSTOMER_ADMIN_CANONICAL_SET',
      resourceType: 'Customer',
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        from: replacement.oldUserId,
        to: replacement.newUserId,
        source: 'replace_admin',
        reason,
      },
    })

    return res.status(200).json({
      data: {
        message: 'Customer admin replaced successfully.',
        customerId: customer._id,
        oldUserId: replacement.oldUserId,
        newUserId: replacement.newUserId,
        canonicalAdminUserId: replacement.newUserId,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'Customer',
        resourceId: req.params.customerId,
        scope: { customerId: req.params.customerId },
        diff: {
          endpoint: 'replace_admin',
          reason: err.message,
          details: err.details || null,
          attemptedNewUserId: req.body?.newUserId || null,
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    next(err)
  }
}
