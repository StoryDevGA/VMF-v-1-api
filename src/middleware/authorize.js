/**
 * Authorization Middleware
 *
 * Provides four factory functions that return Express middleware:
 *
 *   requirePlatformRole(role)
 *     – Ensures the user holds the specified platform-level role
 *       (e.g. 'SUPER_ADMIN'). Platform roles live in memberships
 *       where customerId is null.
 *
 *   requireCustomerAccess({ roles, allowPlatform })
 *     – Ensures the user has a membership for req.params.customerId
 *       with one of the specified roles. Super Admins are granted
 *       implicit access when allowPlatform is true (default).
 *
 *   requireTenantAccess({ roles, allowPlatform, allowCustomerAdmin })
 *     – Ensures the user has a tenantMembership for the tenant
 *       identified by req.params.tenantId under the customer
 *       identified by req.params.customerId. Customer Admins and
 *       Super Admins receive implicit access when options permit.
 *
 *   requireVmfAccess(permission, { allowPlatform, allowCustomerAdmin, allowTenantAdmin })
 *     – Ensures the user holds the specified permission on the VMF
 *       identified by req.params.vmfId. Higher-level roles receive
 *       implicit access when options permit.
 *
 * All functions expect req.scopes to be populated by loadScopes.
 */

import { Customer, Tenant, VMF } from '../models/index.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Compare two ObjectId-like values as strings.
 */
const idsEqual = (a, b) => {
  if (!a || !b) return false
  return a.toString() === b.toString()
}

/**
 * Return a 403 FORBIDDEN response with consistent shape.
 */
const forbidden = (res, req, detail) =>
  res.status(403).json({
    error: {
      code: 'FORBIDDEN',
      message: detail || 'You do not have permission to perform this action.',
      requestId: req.requestId,
    },
  })

/**
 * Verify that req.scopes has been populated.
 */
const ensureScopes = (req, res) => {
  if (!req.scopes) {
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Authorization scopes not loaded.',
        requestId: req.requestId,
      },
    })
    return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/*  requirePlatformRole                                               */
/* ------------------------------------------------------------------ */

/**
 * Factory: requirePlatformRole(role)
 *
 * @param {string} role  – The platform role key (e.g. 'SUPER_ADMIN')
 */
export const requirePlatformRole = (role) => (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const { platformRoles } = req.scopes

  if (platformRoles.includes(role)) {
    return next()
  }

  logger.warn(
    { userId: req.userId, requiredRole: role, requestId: req.requestId },
    'requirePlatformRole — access denied',
  )
  return forbidden(res, req, `Platform role '${role}' is required.`)
}

/* ------------------------------------------------------------------ */
/*  requireCustomerAccess                                             */
/* ------------------------------------------------------------------ */

/**
 * Factory: requireCustomerAccess(options?)
 *
 * @param {object}   [options]
 * @param {string[]} [options.roles]          – Required customer-level roles
 *                                              (empty = any membership)
 * @param {boolean}  [options.allowPlatform]  – Allow Super Admins (default true)
 */
export const requireCustomerAccess = (options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const { roles = [], allowPlatform = true } = options
  const { memberships, platformRoles } = req.scopes
  const customerId = req.params.customerId

  if (!customerId) {
    return forbidden(res, req, 'Customer identifier is required.')
  }

  // Super Admin bypass
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    // Validate that the customer exists
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
    req.scopes.customer = customer
    return next()
  }

  // Find user's membership for this customer
  const membership = memberships.find((m) => idsEqual(m.customerId, customerId))

  if (!membership) {
    logger.warn(
      { userId: req.userId, customerId, requestId: req.requestId },
      'requireCustomerAccess — no membership',
    )
    return forbidden(res, req, 'You do not have access to this customer.')
  }

  // If specific roles are required, check them
  if (roles.length > 0) {
    const hasRole = roles.some((r) => membership.roles.includes(r))
    if (!hasRole) {
      logger.warn(
        { userId: req.userId, customerId, requiredRoles: roles, requestId: req.requestId },
        'requireCustomerAccess — missing required role',
      )
      return forbidden(res, req, 'You do not have the required role for this customer.')
    }
  }

  // Attach customer document for downstream use
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
  req.scopes.customer = customer

  next()
}

/* ------------------------------------------------------------------ */
/*  requireTenantAccess                                               */
/* ------------------------------------------------------------------ */

/**
 * Factory: requireTenantAccess(options?)
 *
 * @param {object}   [options]
 * @param {string[]} [options.roles]              – Required tenant-level roles
 * @param {boolean}  [options.allowPlatform]      – Allow Super Admins (default true)
 * @param {boolean}  [options.allowCustomerAdmin] – Allow Customer Admins (default true)
 */
export const requireTenantAccess = (options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const { roles = [], allowPlatform = true, allowCustomerAdmin = true } = options
  const { memberships, tenantMemberships, platformRoles } = req.scopes
  const customerId = req.params.customerId
  const tenantId = req.params.tenantId

  if (!customerId || !tenantId) {
    return forbidden(res, req, 'Customer and tenant identifiers are required.')
  }

  // Load customer for downstream middleware (e.g. topologyGuard)
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
  req.scopes.customer = customer

  // Load tenant and validate it belongs to the customer
  const tenant = await Tenant.findById(tenantId)
  if (!tenant || !idsEqual(tenant.customerId, customerId)) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Tenant not found.',
        requestId: req.requestId,
      },
    })
  }
  req.scopes.tenant = tenant

  // Super Admin bypass
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    return next()
  }

  // Customer Admin bypass
  if (allowCustomerAdmin) {
    const customerMembership = memberships.find((m) => idsEqual(m.customerId, customerId))
    if (customerMembership && customerMembership.roles.includes('CUSTOMER_ADMIN')) {
      return next()
    }
  }

  // Tenant-level membership check
  const tenantMembership = tenantMemberships.find(
    (tm) => idsEqual(tm.customerId, customerId) && idsEqual(tm.tenantId, tenantId),
  )

  if (!tenantMembership) {
    logger.warn(
      { userId: req.userId, customerId, tenantId, requestId: req.requestId },
      'requireTenantAccess — no tenant membership',
    )
    return forbidden(res, req, 'You do not have access to this tenant.')
  }

  // If specific roles are required, check them
  if (roles.length > 0) {
    const hasRole = roles.some((r) => tenantMembership.roles.includes(r))
    if (!hasRole) {
      logger.warn(
        { userId: req.userId, tenantId, requiredRoles: roles, requestId: req.requestId },
        'requireTenantAccess — missing required role',
      )
      return forbidden(res, req, 'You do not have the required role for this tenant.')
    }
  }

  next()
}

/* ------------------------------------------------------------------ */
/*  requireVmfAccess                                                  */
/* ------------------------------------------------------------------ */

/**
 * Factory: requireVmfAccess(permission?, options?)
 *
 * @param {string}   [permission]                  – Required VMF permission (e.g. 'READ', 'WRITE')
 * @param {object}   [options]
 * @param {boolean}  [options.allowPlatform]       – Allow Super Admins (default true)
 * @param {boolean}  [options.allowCustomerAdmin]  – Allow Customer Admins (default true)
 * @param {boolean}  [options.allowTenantAdmin]    – Allow Tenant Admins (default true)
 */
export const requireVmfAccess = (permission, options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    allowPlatform = true,
    allowCustomerAdmin = true,
    allowTenantAdmin = true,
  } = options
  const { memberships, tenantMemberships, vmfGrants, platformRoles } = req.scopes
  const customerId = req.params.customerId
  const tenantId = req.params.tenantId
  const vmfId = req.params.vmfId

  if (!vmfId) {
    return forbidden(res, req, 'VMF identifier is required.')
  }

  // Load the VMF and validate hierarchy
  const vmf = await VMF.findById(vmfId)
  if (!vmf) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'VMF not found.',
        requestId: req.requestId,
      },
    })
  }

  // Verify hierarchy consistency when params are provided
  const effectiveCustomerId = customerId || vmf.customerId.toString()
  const effectiveTenantId = tenantId || vmf.tenantId.toString()

  if (!idsEqual(vmf.customerId, effectiveCustomerId) || !idsEqual(vmf.tenantId, effectiveTenantId)) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'VMF not found.',
        requestId: req.requestId,
      },
    })
  }

  req.scopes.vmf = vmf

  // Super Admin bypass
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    return next()
  }

  // Customer Admin bypass
  if (allowCustomerAdmin) {
    const customerMembership = memberships.find((m) =>
      idsEqual(m.customerId, effectiveCustomerId),
    )
    if (customerMembership && customerMembership.roles.includes('CUSTOMER_ADMIN')) {
      return next()
    }
  }

  // Tenant Admin bypass
  if (allowTenantAdmin) {
    const tenantMembership = tenantMemberships.find(
      (tm) =>
        idsEqual(tm.customerId, effectiveCustomerId) &&
        idsEqual(tm.tenantId, effectiveTenantId),
    )
    if (tenantMembership && tenantMembership.roles.includes('TENANT_ADMIN')) {
      return next()
    }
  }

  // VMF grant check
  const grant = vmfGrants.find((g) =>
    idsEqual(g.customerId, effectiveCustomerId) &&
    idsEqual(g.tenantId, effectiveTenantId) &&
    idsEqual(g.vmfId, vmfId),
  )

  if (!grant) {
    logger.warn(
      { userId: req.userId, vmfId, requestId: req.requestId },
      'requireVmfAccess — no VMF grant',
    )
    return forbidden(res, req, 'You do not have access to this VMF.')
  }

  // If a specific permission is required, check it
  if (permission && !grant.permissions.includes(permission)) {
    logger.warn(
      { userId: req.userId, vmfId, requiredPermission: permission, requestId: req.requestId },
      'requireVmfAccess — missing permission',
    )
    return forbidden(res, req, `You do not have '${permission}' permission on this VMF.`)
  }

  next()
}
