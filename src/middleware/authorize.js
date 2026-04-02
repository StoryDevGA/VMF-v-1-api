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
 *   requirePlatformPermission(permission)
 *     – Ensures the user holds the specified platform permission in
 *       req.scopes.resolvedPermissions.platform, while preserving
 *       active SUPER_ADMIN bypass.
 *
 *   requireCustomerPermission(permission, { allowPlatform, allowTenantPermission })
 *     – Ensures the user holds the specified customer permission in
 *       req.scopes.resolvedPermissions.customers for req.params.customerId.
 *       Routes can optionally allow matching tenant-scoped permissions for
 *       the same customer when customer-scoped catalogue access is intended.
 *       During the migration window, routes can also opt into legacy
 *       single-tenant membership, tenant-member catalogue access, and
 *       tenant-scope permissions resolved into the customer bucket.
 *
 *   requireTenantPermission(permission, { allowPlatform, allowCustomerPermission })
 *     – Ensures the user holds the specified tenant permission in
 *       req.scopes.resolvedPermissions.tenants for req.params.tenantId,
 *       while allowing parent customer-scope permission only when
 *       a route explicitly opts into that broader fallback.

 *   requireDealAccess(capabilityPermission, vmfGrantPermission)
 *     – Ensures the caller has the required role-derived capability for
 *       the deal's parent tenant scope and the necessary object-level VMF
 *       grant on the deal's backing VMF, while preserving higher-scope
 *       admin bypass where permitted.
 *
 * All functions expect req.scopes to be populated by loadScopes.
 */

import { Customer, Deal, Tenant, VMF } from '../models/index.js'
import env from '../config/env.js'
import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import monitoringService from '../services/monitoringService.js'
import { loadRoleDefinitionsByKey } from '../services/roleAssignmentValidationService.js'
import { buildInactiveCustomerErrorResponse } from './customerStatus.js'
import performanceCacheService, {
  buildCustomerTopologySnapshot,
  buildTenantStatusSnapshot,
} from '../services/performanceCacheService.js'
import { createEmptyResolvedPermissions } from '../services/rolePermissionResolutionService.js'

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

const customerInactive = (res, req, customerStatus, surface = 'authorize') => {
  monitoringService.recordInactiveCustomerBlock({ surface })
  return res.status(403).json(buildInactiveCustomerErrorResponse({
    requestId: req.requestId,
    customerStatus,
  }))
}

const isCustomerInactive = (customer) =>
  env.governanceInactiveEnforcementEnabled &&
  customer?.status &&
  customer.status !== 'ACTIVE'

const normalizeAccessKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeAccessScopes = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeAccessKey)
      .filter(Boolean),
  )]

const normalizePermissionKeys = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [values])
      .map(normalizeAccessKey)
      .filter(Boolean),
  )]

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

const getResolvedPermissionsSnapshot = (scopes = {}) => {
  const resolvedPermissions = scopes?.resolvedPermissions

  if (
    resolvedPermissions
    && typeof resolvedPermissions === 'object'
    && resolvedPermissions.platform
    && Array.isArray(resolvedPermissions.platform.roleKeys)
    && Array.isArray(resolvedPermissions.platform.permissions)
    && Array.isArray(resolvedPermissions.customers)
    && Array.isArray(resolvedPermissions.tenants)
  ) {
    return resolvedPermissions
  }

  return createEmptyResolvedPermissions()
}

const hasResolvedBucketPermission = (bucket, permissionKey) =>
  Array.isArray(bucket?.permissions) && bucket.permissions.includes(permissionKey)

const hasAnyResolvedBucketPermission = (bucket, permissionKeys = []) =>
  normalizePermissionKeys(permissionKeys).some((permissionKey) =>
    hasResolvedBucketPermission(bucket, permissionKey),
  )

const hasResolvedPlatformRole = (scopes, roleKey) =>
  getResolvedPermissionsSnapshot(scopes).platform.roleKeys.includes(normalizeAccessKey(roleKey))

const getResolvedCustomerPermissionBucket = (scopes, customerId) =>
  getResolvedPermissionsSnapshot(scopes).customers.find((bucket) => idsEqual(bucket?.customerId, customerId)) || null

const listResolvedTenantPermissionBuckets = (scopes, customerId) =>
  getResolvedPermissionsSnapshot(scopes).tenants.filter((bucket) => idsEqual(bucket?.customerId, customerId))

const getResolvedTenantPermissionBucket = (scopes, customerId, tenantId) =>
  getResolvedPermissionsSnapshot(scopes).tenants.find(
    (bucket) => idsEqual(bucket?.customerId, customerId) && idsEqual(bucket?.tenantId, tenantId),
  ) || null

const resolveCustomerBucketPermissionSource = async ({
  customerBucket,
  requiredPermission,
  tenantPermissionKeys = [],
}) => {
  if (!customerBucket) {
    return {
      hasCustomerScopedPermission: false,
      hasTenantScopedPermission: false,
    }
  }

  const roleDefinitionsByKey = await loadRoleDefinitionsByKey(customerBucket?.roleKeys || [])
  let hasCustomerScopedPermission = false
  let hasTenantScopedPermission = false

  for (const roleKey of customerBucket?.roleKeys || []) {
    const roleDefinition = roleDefinitionsByKey.get(normalizeAccessKey(roleKey))

    if (
      !roleDefinition
      || roleDefinition.isActive === false
      || !Array.isArray(roleDefinition.permissions)
    ) {
      continue
    }

    const roleScope = normalizeAccessKey(roleDefinition.scope)
    const grantsRequiredPermission = roleDefinition.permissions.includes(requiredPermission)
    const grantsTenantPermission = hasAnyResolvedBucketPermission(
      { permissions: roleDefinition.permissions },
      tenantPermissionKeys,
    )

    if (grantsRequiredPermission && roleScope === 'CUSTOMER') {
      hasCustomerScopedPermission = true
    }

    if (
      (grantsRequiredPermission || grantsTenantPermission)
      && (roleScope === 'TENANT' || roleScope === 'VMF')
    ) {
      hasTenantScopedPermission = true
    }
  }

  return {
    hasCustomerScopedPermission,
    hasTenantScopedPermission,
  }
}

const buildCustomerAccessMetadata = ({
  customerId,
  via,
  isSuperAdmin = false,
  isCustomerAdmin = false,
  isTenantAdmin = false,
  tenantAdminTenantIds = [],
  accessibleTenantIds = [],
  permission = null,
}) => ({
  customerId: customerId?.toString?.() || String(customerId),
  via,
  ...(permission ? { permission } : {}),
  isSuperAdmin,
  isCustomerAdmin: isSuperAdmin ? true : isCustomerAdmin,
  isTenantAdmin: isSuperAdmin ? true : isTenantAdmin,
  tenantAdminTenantIds: isSuperAdmin
    ? []
    : [...new Set((tenantAdminTenantIds || []).map((tenantId) => tenantId?.toString?.() || String(tenantId)))],
  accessibleTenantIds: isSuperAdmin
    ? []
    : [...new Set((accessibleTenantIds || []).map((tenantId) => tenantId?.toString?.() || String(tenantId)))],
})

const logAuthorizationDenied = ({
  req,
  requiredRole,
  requiredPermission,
  scope = {},
  surface,
  reason,
}) => {
  logger.warn(
    {
      userId: req.userId,
      requiredRole,
      requiredPermission,
      scope,
      requestId: req.requestId,
      surface,
      reason,
    },
    `${surface} — access denied`,
  )

  if (req.userId && env.nodeEnv !== 'test') {
    void auditService.log({
      actorUserId: req.userId,
      action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
      resourceType: auditService.RESOURCE_TYPES.User,
      resourceId: req.userId,
      scope,
      diff: {
        requiredRole,
        requiredPermission,
        path: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
        method: req.method,
        surface,
        reason,
      },
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
      requestId: req.requestId,
    })
  }
}

const resolveCustomerRoleContext = ({ memberships = [], tenantMemberships = [], customerId }) => {
  const membership = memberships.find((candidate) => idsEqual(candidate?.customerId, customerId)) || null
  const membershipRoles = Array.isArray(membership?.roles) ? membership.roles : []
  const customerTenantMemberships = Array.isArray(tenantMemberships)
    ? tenantMemberships.filter(
      (tenantMembership) => idsEqual(tenantMembership?.customerId, customerId),
    )
    : []
  const tenantAdminMemberships = customerTenantMemberships.filter(
    (tenantMembership) => (tenantMembership?.roles || []).includes('TENANT_ADMIN'),
  )

  const hasCustomerAdmin = membershipRoles.includes('CUSTOMER_ADMIN')
  const hasCustomerScopedTenantAdmin = membershipRoles.includes('TENANT_ADMIN')
  const hasTenantMembershipTenantAdmin = tenantAdminMemberships.length > 0

  return {
    membership,
    membershipRoles,
    hasCustomerAdmin,
    hasCustomerScopedTenantAdmin,
    hasTenantMembershipTenantAdmin,
    isTenantAdmin: hasCustomerScopedTenantAdmin || hasTenantMembershipTenantAdmin,
    tenantAdminTenantIds: tenantAdminMemberships
      .map((tenantMembership) => tenantMembership?.tenantId)
      .filter(Boolean)
      .map((tenantId) => tenantId.toString()),
    accessibleTenantIds: [...new Set(
      customerTenantMemberships
        .map((tenantMembership) => tenantMembership?.tenantId)
        .filter(Boolean)
        .map((tenantId) => tenantId.toString()),
    )],
  }
}

const hasCustomerScopedTenantAdminAccessToTenant = ({
  memberships = [],
  tenantMemberships = [],
  customerId,
  tenantId,
  customer = null,
  tenant = null,
  actorUserId = null,
}) => {
  if (!customerId || !tenantId) return false

  const roleContext = resolveCustomerRoleContext({
    memberships,
    tenantMemberships,
    customerId,
  })

  if (!roleContext.hasCustomerScopedTenantAdmin) return false

  const normalizedTenantId = tenantId.toString()

  if (roleContext.tenantAdminTenantIds.includes(normalizedTenantId)) {
    return true
  }

  if (actorUserId && Array.isArray(tenant?.tenantAdminUserIds)) {
    return tenant.tenantAdminUserIds.some((tenantAdminUserId) => idsEqual(tenantAdminUserId, actorUserId))
  }

  return false
}

const loadCustomerContext = async (customerId) => {
  const cachedCustomer = await performanceCacheService.getCustomerTopology(customerId)
  if (cachedCustomer && cachedCustomer.name) return cachedCustomer

  const customer = await Customer.findById(customerId)
  if (!customer) return cachedCustomer || null

  await performanceCacheService.setCustomerTopology(
    customer._id,
    buildCustomerTopologySnapshot(customer),
  )

  return buildCustomerTopologySnapshot(customer)
}

const loadTenantContext = async (tenantId) => {
  const cachedTenant = await performanceCacheService.getTenantStatus(tenantId)
  if (cachedTenant) return cachedTenant

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return null

  await performanceCacheService.setTenantStatus(tenant._id, buildTenantStatusSnapshot(tenant))

  return tenant
}

const resolveTenantCustomerPermissionFallback = async ({
  req,
  customerId,
  tenantId,
  requiredPermission,
  customerBucket,
  allowCustomerPermission = false,
  allowCustomerPermissionScopes = [],
  allowCustomerPermissionWhenSingleTenant = false,
  allowCustomerScopedTenantPermission = false,
}) => {
  if (!allowCustomerPermission || !hasResolvedBucketPermission(customerBucket, requiredPermission)) {
    return {
      allowed: false,
      customer: null,
      tenant: null,
      reason: 'missing_customer_permission',
    }
  }

  const normalizedAllowedScopes = normalizeAccessScopes(allowCustomerPermissionScopes)
  const requiresScopedEvaluation =
    normalizedAllowedScopes.length > 0
    || allowCustomerPermissionWhenSingleTenant
    || allowCustomerScopedTenantPermission

  if (!requiresScopedEvaluation) {
    return {
      allowed: true,
      customer: null,
      tenant: null,
      reason: null,
    }
  }

  const roleDefinitionsByKey = await loadRoleDefinitionsByKey(customerBucket?.roleKeys || [])
  const permissionGrantingRoles = (customerBucket?.roleKeys || [])
    .map((roleKey) => roleDefinitionsByKey.get(normalizeAccessKey(roleKey)))
    .filter((roleDefinition) =>
      roleDefinition
      && roleDefinition.isActive !== false
      && Array.isArray(roleDefinition.permissions)
      && roleDefinition.permissions.includes(requiredPermission),
    )

  if (permissionGrantingRoles.some((roleDefinition) =>
    normalizedAllowedScopes.includes(normalizeAccessKey(roleDefinition.scope)),
  )) {
    return {
      allowed: true,
      customer: null,
      tenant: null,
      reason: null,
    }
  }

  let customer = null
  let tenant = null

  if (allowCustomerScopedTenantPermission) {
    const hasTenantScopedCustomerRole = permissionGrantingRoles.some((roleDefinition) => {
      const roleScope = normalizeAccessKey(roleDefinition.scope)
      return roleScope === 'TENANT' || roleScope === 'VMF'
    })
    const hasActiveCustomerScopedTenantAdminRole = (customerBucket?.roleKeys || [])
      .some((roleKey) => normalizeAccessKey(roleKey) === 'TENANT_ADMIN')

    if (hasTenantScopedCustomerRole && hasActiveCustomerScopedTenantAdminRole) {
      customer = await loadCustomerContext(customerId)
      tenant = await loadTenantContext(tenantId)

      if (
        customer
        && tenant
        && idsEqual(tenant.customerId, customerId)
        && hasCustomerScopedTenantAdminAccessToTenant({
          memberships: req.scopes.memberships,
          tenantMemberships: req.scopes.tenantMemberships,
          customerId,
          tenantId,
          customer,
          tenant,
          actorUserId: req.userId,
        })
      ) {
        return {
          allowed: true,
          customer,
          tenant,
          reason: null,
        }
      }
    }
  }

  if (allowCustomerPermissionWhenSingleTenant) {
    customer = customer || await loadCustomerContext(customerId)

    if (customer?.topology === 'SINGLE_TENANT') {
      return {
        allowed: true,
        customer,
        tenant,
        reason: null,
      }
    }
  }

  return {
    allowed: false,
    customer,
    tenant,
    reason: 'customer_permission_scope_not_allowed',
  }
}

const DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS = Object.freeze({
  allowCustomerPermission: true,
  allowCustomerPermissionScopes: ['CUSTOMER'],
  allowCustomerPermissionWhenSingleTenant: true,
  allowCustomerScopedTenantPermission: true,
})

const resolveHybridTenantCapabilityAccess = async ({
  req,
  customerId,
  tenantId,
  requiredPermission,
  allowPlatform = true,
  allowCustomerPermission = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermission,
  allowCustomerPermissionScopes = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionScopes,
  allowCustomerPermissionWhenSingleTenant =
    DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionWhenSingleTenant,
  allowCustomerScopedTenantPermission =
    DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerScopedTenantPermission,
}) => {
  if (!requiredPermission) {
    return {
      allowed: true,
      hasSuperAdminBypass: false,
      reason: null,
    }
  }

  const normalizedRequiredPermission = normalizeAccessKey(requiredPermission)
  const resolvedPermissions = getResolvedPermissionsSnapshot(req.scopes)
  const hasSuperAdminBypass =
    allowPlatform && resolvedPermissions.platform.roleKeys.includes('SUPER_ADMIN')
  const customerBucket = allowCustomerPermission
    ? getResolvedCustomerPermissionBucket(req.scopes, customerId)
    : null
  const tenantBucket = getResolvedTenantPermissionBucket(req.scopes, customerId, tenantId)
  const hasTenantPermission = hasResolvedBucketPermission(tenantBucket, normalizedRequiredPermission)

  const customerPermissionFallback =
    !hasSuperAdminBypass && !hasTenantPermission
      ? await resolveTenantCustomerPermissionFallback({
          req,
          customerId,
          tenantId,
          requiredPermission: normalizedRequiredPermission,
          customerBucket,
          allowCustomerPermission,
          allowCustomerPermissionScopes,
          allowCustomerPermissionWhenSingleTenant,
          allowCustomerScopedTenantPermission,
        })
      : {
          allowed: false,
          customer: null,
          tenant: null,
          reason: null,
        }

  return {
    allowed: hasSuperAdminBypass || hasTenantPermission || customerPermissionFallback.allowed,
    hasSuperAdminBypass,
    reason: customerPermissionFallback.reason || (allowCustomerPermission
      ? 'missing_customer_or_tenant_permission'
      : 'missing_tenant_permission'),
  }
}

const ensureVmfResourceAccess = async ({
  req,
  res,
  vmfId,
  customerId = null,
  tenantId = null,
  requireVmfGrant = true,
  grantPermission = null,
  requiredPermission = null,
  allowPlatform = true,
  allowCustomerAdmin = true,
  allowTenantAdmin = true,
  allowInactiveCustomer = false,
  allowCustomerPermission = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermission,
  allowCustomerPermissionScopes = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionScopes,
  allowCustomerPermissionWhenSingleTenant =
    DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionWhenSingleTenant,
  allowCustomerScopedTenantPermission =
    DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerScopedTenantPermission,
  surface = 'requireVmfAccess',
}) => {
  if (!vmfId) {
    forbidden(res, req, 'VMF identifier is required.')
    return false
  }

  const { memberships, tenantMemberships, vmfGrants, platformRoles } = req.scopes

  const vmf = await VMF.findById(vmfId)
  if (!vmf) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'VMF not found.',
        requestId: req.requestId,
      },
    })
    return false
  }

  const effectiveCustomerId = customerId || vmf.customerId.toString()
  const effectiveTenantId = tenantId || vmf.tenantId.toString()

  if (!idsEqual(vmf.customerId, effectiveCustomerId) || !idsEqual(vmf.tenantId, effectiveTenantId)) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'VMF not found.',
        requestId: req.requestId,
      },
    })
    return false
  }

  req.scopes.vmf = vmf

  const customer = await loadCustomerContext(effectiveCustomerId)
  if (!customer) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found.',
        requestId: req.requestId,
      },
    })
    return false
  }

  if (vmf.deletedAt) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'VMF not found.',
        requestId: req.requestId,
      },
    })
    return false
  }
  req.scopes.customer = customer

  const tenant = await loadTenantContext(effectiveTenantId)
  if (tenant) {
    req.scopes.tenant = tenant
  }

  if (isCustomerInactive(customer) && !allowInactiveCustomer) {
    logger.warn(
      {
        userId: req.userId,
        customerId: effectiveCustomerId,
        tenantId: effectiveTenantId,
        vmfId,
        customerStatus: customer.status,
        requestId: req.requestId,
      },
      `${surface} - customer inactive`,
    )
    customerInactive(res, req, customer.status, surface.toLowerCase())
    return false
  }

  // Admin role bypasses run before capability check — admins implicitly have full
  // access within their scope and are not subject to per-operation capability gates.
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    return true
  }

  if (allowCustomerAdmin) {
    const customerMembership = memberships.find((m) =>
      idsEqual(m.customerId, effectiveCustomerId),
    )
    if (customerMembership && customerMembership.roles.includes('CUSTOMER_ADMIN')) {
      return true
    }
  }

  if (allowTenantAdmin) {
    const tenantMembership = tenantMemberships.find(
      (tm) =>
        idsEqual(tm.customerId, effectiveCustomerId) &&
        idsEqual(tm.tenantId, effectiveTenantId),
    )
    if (tenantMembership && tenantMembership.roles.includes('TENANT_ADMIN')) {
      return true
    }

    if (hasCustomerScopedTenantAdminAccessToTenant({
      memberships,
      tenantMemberships,
      customerId: effectiveCustomerId,
      tenantId: effectiveTenantId,
      customer,
      tenant,
      actorUserId: req.userId,
    })) {
      return true
    }
  }

  // For non-admin users, enforce scoped capability permission first.
  const capabilityAccess = await resolveHybridTenantCapabilityAccess({
    req,
    customerId: effectiveCustomerId,
    tenantId: effectiveTenantId,
    requiredPermission,
    allowPlatform,
    allowCustomerPermission,
    allowCustomerPermissionScopes,
    allowCustomerPermissionWhenSingleTenant,
    allowCustomerScopedTenantPermission,
  })

  if (!capabilityAccess.allowed) {
    logAuthorizationDenied({
      req,
      requiredPermission: normalizeAccessKey(requiredPermission),
      scope: { customerId: effectiveCustomerId, tenantId: effectiveTenantId, vmfId },
      surface,
      reason: capabilityAccess.reason,
    })
    forbidden(res, req, `Tenant permission '${normalizeAccessKey(requiredPermission)}' is required.`)
    return false
  }

  if (!requireVmfGrant) {
    return true
  }

  const grant = vmfGrants.find((g) =>
    idsEqual(g.customerId, effectiveCustomerId) &&
    idsEqual(g.tenantId, effectiveTenantId) &&
    idsEqual(g.vmfId, vmfId),
  )

  if (!grant) {
    logger.warn(
      { userId: req.userId, vmfId, requestId: req.requestId },
      `${surface} — no VMF grant`,
    )
    forbidden(res, req, 'You do not have access to this VMF.')
    return false
  }

  if (grantPermission && !grant.permissions.includes(grantPermission)) {
    logger.warn(
      { userId: req.userId, vmfId, requiredPermission: grantPermission, requestId: req.requestId },
      `${surface} — missing grant permission`,
    )
    forbidden(res, req, `You do not have '${grantPermission}' permission on this VMF.`)
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
  if (req.userId && env.nodeEnv !== 'test') {
    const scope = {}
    if (req.params?.customerId) scope.customerId = req.params.customerId
    if (req.params?.tenantId) scope.tenantId = req.params.tenantId
    if (req.params?.vmfId) scope.vmfId = req.params.vmfId

    void auditService.log({
      actorUserId: req.userId,
      action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
      resourceType: auditService.RESOURCE_TYPES.User,
      resourceId: req.userId,
      scope,
      diff: {
        requiredRole: role,
        path: req.originalUrl,
        method: req.method,
      },
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
      requestId: req.requestId,
    })
  }

  return forbidden(res, req, `Platform role '${role}' is required.`)
}

/* ------------------------------------------------------------------ */
/*  requirePlatformPermission                                         */
/* ------------------------------------------------------------------ */

/**
 * Factory: requirePlatformPermission(permission)
 *
 * @param {string} permission – The platform permission key
 */
export const requirePlatformPermission = (permission) => (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const requiredPermission = normalizeAccessKey(permission)
  const resolvedPermissions = getResolvedPermissionsSnapshot(req.scopes)
  const hasSuperAdminBypass = resolvedPermissions.platform.roleKeys.includes('SUPER_ADMIN')

  if (
    hasSuperAdminBypass
    || resolvedPermissions.platform.permissions.includes(requiredPermission)
  ) {
    return next()
  }

  logAuthorizationDenied({
    req,
    requiredPermission,
    surface: 'requirePlatformPermission',
    reason: 'missing_platform_permission',
  })

  return forbidden(res, req, `Platform permission '${requiredPermission}' is required.`)
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
 * @param {boolean}  [options.allowCustomerMembershipWhenSingleTenant]
 *   Allow any customer membership when the resolved customer topology is
 *   `SINGLE_TENANT`. Intended for read-only customer-scoped routes that
 *   need the default single-tenant context.
 * @param {boolean}  [options.allowTenantMember]
 *   Allow any user who has at least one tenantMembership for the customer
 *   (i.e. accessibleTenantIds.length > 0). Intended for read-only
 *   customer-scoped routes where tenant members need catalogue access.
 */
export const requireCustomerAccess = (options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    roles = [],
    allowPlatform = true,
    allowTenantAdmin = false,
    allowTenantMember = false,
    allowCustomerMembershipWhenSingleTenant = false,
    allowInactiveCustomer = false,
  } = options
  const { memberships, tenantMemberships, platformRoles } = req.scopes
  const customerId = req.params.customerId

  if (!customerId) {
    return forbidden(res, req, 'Customer identifier is required.')
  }

  // Super Admin bypass
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    // Validate that the customer exists
    const customer = await loadCustomerContext(customerId)
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
    req.scopes.customerAccess = {
      customerId: customer._id?.toString?.() || customerId.toString(),
      via: 'platform',
      isSuperAdmin: true,
      isCustomerAdmin: true,
      isTenantAdmin: true,
      tenantAdminTenantIds: [],
      accessibleTenantIds: [],
    }

    if (isCustomerInactive(customer) && !allowInactiveCustomer) {
      logger.warn(
        {
          userId: req.userId,
          customerId,
          customerStatus: customer.status,
          requestId: req.requestId,
        },
        'requireCustomerAccess - customer inactive',
      )
      return customerInactive(res, req, customer.status, 'require_customer_access')
    }

    return next()
  }

  // Find user's membership for this customer
  const roleContext = resolveCustomerRoleContext({
    memberships,
    tenantMemberships,
    customerId,
  })
  const hasTenantAdminBypass = allowTenantAdmin && roleContext.isTenantAdmin
  const hasTenantMemberBypass = allowTenantMember && roleContext.accessibleTenantIds.length > 0

  if (!roleContext.membership && !hasTenantAdminBypass && !hasTenantMemberBypass) {
    logger.warn(
      { userId: req.userId, customerId, requestId: req.requestId },
      'requireCustomerAccess — no membership',
    )
    return forbidden(res, req, 'You do not have access to this customer.')
  }

  const customer = await loadCustomerContext(customerId)
  if (!customer) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found.',
        requestId: req.requestId,
      },
    })
  }
  const hasSingleTenantCustomerMembershipBypass = Boolean(
    allowCustomerMembershipWhenSingleTenant
      && customer?.topology === 'SINGLE_TENANT'
      && roleContext.membership
      && roleContext.membershipRoles.length > 0,
  )

  // If specific roles are required, check them
  if (roles.length > 0) {
    const hasRole = roles.some((role) => roleContext.membershipRoles.includes(role))
    if (!hasRole && !hasTenantAdminBypass && !hasSingleTenantCustomerMembershipBypass && !hasTenantMemberBypass) {
      logger.warn(
        { userId: req.userId, customerId, requiredRoles: roles, requestId: req.requestId },
        'requireCustomerAccess — missing required role',
      )
      return forbidden(res, req, 'You do not have the required role for this customer.')
    }

    if (!hasRole && hasTenantAdminBypass) {
      logger.warn(
        { userId: req.userId, customerId, requiredRoles: roles, requestId: req.requestId },
        'requireCustomerAccess - tenant-admin bypass used',
      )
    }
  }

  req.scopes.customer = customer
  req.scopes.customerAccess = {
    customerId: customer._id?.toString?.() || customerId.toString(),
    via: roleContext.hasCustomerAdmin
      ? 'customer_admin'
      : hasSingleTenantCustomerMembershipBypass
        ? 'single_tenant_membership'
        : hasTenantMemberBypass && !hasTenantAdminBypass
          ? 'tenant_member'
          : 'tenant_admin',
    isSuperAdmin: false,
    isCustomerAdmin: roleContext.hasCustomerAdmin,
    isTenantAdmin: roleContext.isTenantAdmin,
    tenantAdminTenantIds: roleContext.tenantAdminTenantIds,
    accessibleTenantIds: roleContext.accessibleTenantIds,
  }

  if (isCustomerInactive(customer) && !allowInactiveCustomer) {
    logger.warn(
      {
        userId: req.userId,
        customerId,
        customerStatus: customer.status,
        requestId: req.requestId,
      },
      'requireCustomerAccess - customer inactive',
    )
    return customerInactive(res, req, customer.status, 'require_customer_access')
  }

  next()
}

/* ------------------------------------------------------------------ */
/*  requireCustomerPermission                                         */
/* ------------------------------------------------------------------ */

/**
 * Factory: requireCustomerPermission(permission, options?)
 *
 * @param {string} permission – Required customer-level permission
 * @param {object} [options]
 * @param {boolean} [options.allowPlatform]        – Allow active SUPER_ADMIN bypass (default true)
 * @param {boolean} [options.allowTenantPermission] – Allow tenant-scoped permission buckets for the same customer (default false)
 * @param {string|string[]} [options.tenantPermission] – Optional alternate tenant permission key(s) for customer-scoped fallback
 * @param {string[]} [options.tenantPermissions] – Optional alternate tenant permission key set for customer-scoped fallback
 * @param {boolean} [options.allowCustomerScopedTenantPermission] – Treat tenant/VMF role permissions resolved into the customer bucket as tenant-scoped fallback (default false)
 * @param {boolean} [options.requireTenantAdminFallback] – Restrict tenant-scoped fallback to tenant-admin actors only (default false)
 * @param {boolean} [options.allowCustomerMembershipWhenSingleTenant] – Preserve single-tenant customer membership catalogue access (default false)
 * @param {boolean} [options.allowTenantMember] – Preserve tenant-member catalogue access (default false)
 * @param {boolean} [options.allowInactiveCustomer] – Allow disabled customers through this guard (default false)
 */
export const requireCustomerPermission = (permission, options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    allowPlatform = true,
    allowTenantPermission = false,
    tenantPermission,
    tenantPermissions = [],
    allowCustomerScopedTenantPermission = false,
    requireTenantAdminFallback = false,
    allowCustomerMembershipWhenSingleTenant = false,
    allowTenantMember = false,
    allowInactiveCustomer = false,
  } = options
  const requiredPermission = normalizeAccessKey(permission)
  const customerId = req.params.customerId

  if (!customerId) {
    return forbidden(res, req, 'Customer identifier is required.')
  }

  const resolvedPermissions = getResolvedPermissionsSnapshot(req.scopes)
  const hasSuperAdminBypass = allowPlatform && resolvedPermissions.platform.roleKeys.includes('SUPER_ADMIN')
  const customerBucket = getResolvedCustomerPermissionBucket(req.scopes, customerId)
  const roleContext = resolveCustomerRoleContext({
    memberships: req.scopes.memberships,
    tenantMemberships: req.scopes.tenantMemberships,
    customerId,
  })
  const normalizedTenantPermissionKeys = allowTenantPermission
    ? normalizePermissionKeys(
      tenantPermissions.length > 0
        ? tenantPermissions
        : tenantPermission
          ? [tenantPermission]
          : [requiredPermission],
    )
    : []
  const tenantBuckets = allowTenantPermission
    ? listResolvedTenantPermissionBuckets(req.scopes, customerId)
    : []
  const customerPermissionSource = await resolveCustomerBucketPermissionSource({
    customerBucket,
    requiredPermission,
    tenantPermissionKeys: normalizedTenantPermissionKeys,
  })
  const hasCustomerPermission = customerPermissionSource.hasCustomerScopedPermission
  const tenantPermissionFallbackAllowed = !requireTenantAdminFallback || roleContext.isTenantAdmin
  const permittedTenantIds = tenantBuckets
    .filter((bucket) => hasAnyResolvedBucketPermission(bucket, normalizedTenantPermissionKeys))
    .map((bucket) => bucket?.tenantId)
    .filter(Boolean)
  const hasTenantScopedPermission = permittedTenantIds.length > 0 && tenantPermissionFallbackAllowed
  const hasCustomerBucketTenantPermission = Boolean(
    allowCustomerScopedTenantPermission
      && customerPermissionSource.hasTenantScopedPermission
      && tenantPermissionFallbackAllowed
      && (roleContext.isTenantAdmin || permittedTenantIds.length > 0),
  )

  let customer = null
  let hasSingleTenantCustomerMembershipBypass = false
  if (
    !hasSuperAdminBypass
    && !hasCustomerPermission
    && !hasTenantScopedPermission
    && !hasCustomerBucketTenantPermission
    && allowCustomerMembershipWhenSingleTenant
    && roleContext.membership
    && roleContext.membershipRoles.length > 0
  ) {
    customer = await loadCustomerContext(customerId)
    hasSingleTenantCustomerMembershipBypass = customer?.topology === 'SINGLE_TENANT'
  }

  const hasTenantMemberBypass = Boolean(
    allowTenantMember && roleContext.accessibleTenantIds.length > 0,
  )
  const tenantAdminTenantIds = hasCustomerBucketTenantPermission
    ? [...new Set([...roleContext.tenantAdminTenantIds, ...permittedTenantIds])]
    : permittedTenantIds
  const accessibleTenantIds = hasCustomerBucketTenantPermission
    ? [...new Set([...roleContext.accessibleTenantIds, ...permittedTenantIds])]
    : permittedTenantIds

  if (
    !hasSuperAdminBypass
    && !hasCustomerPermission
    && !hasTenantScopedPermission
    && !hasCustomerBucketTenantPermission
    && !hasSingleTenantCustomerMembershipBypass
    && !hasTenantMemberBypass
  ) {
    logAuthorizationDenied({
      req,
      requiredPermission,
      scope: { customerId },
      surface: 'requireCustomerPermission',
      reason:
        allowTenantPermission
        || allowCustomerScopedTenantPermission
        || allowCustomerMembershipWhenSingleTenant
        || allowTenantMember
          ? 'missing_customer_or_tenant_permission'
          : 'missing_customer_permission',
    })

    return forbidden(res, req, `Customer permission '${requiredPermission}' is required.`)
  }

  customer = customer || await loadCustomerContext(customerId)
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
  req.scopes.customerAccess = buildCustomerAccessMetadata({
    customerId: customer._id?.toString?.() || customerId.toString(),
    via: hasSuperAdminBypass
      ? 'platform'
      : hasCustomerPermission
        ? 'customer_permission'
        : hasSingleTenantCustomerMembershipBypass
          ? 'single_tenant_membership'
          : hasTenantMemberBypass
            ? 'tenant_member'
            : 'tenant_permission',
    isSuperAdmin: hasSuperAdminBypass,
    isCustomerAdmin: hasCustomerPermission,
    isTenantAdmin: !hasCustomerPermission && (hasTenantScopedPermission || hasCustomerBucketTenantPermission),
    tenantAdminTenantIds: !hasCustomerPermission && (hasTenantScopedPermission || hasCustomerBucketTenantPermission)
      ? tenantAdminTenantIds
      : [],
    accessibleTenantIds: !hasCustomerPermission && (hasTenantScopedPermission || hasCustomerBucketTenantPermission)
      ? accessibleTenantIds
      : hasTenantMemberBypass
        ? roleContext.accessibleTenantIds
        : [],
    permission: requiredPermission,
  })

  if (isCustomerInactive(customer) && !allowInactiveCustomer) {
    logger.warn(
      {
        userId: req.userId,
        customerId,
        customerStatus: customer.status,
        requestId: req.requestId,
        permission: requiredPermission,
      },
      'requireCustomerPermission - customer inactive',
    )
    return customerInactive(res, req, customer.status, 'require_customer_permission')
  }

  return next()
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
 * @param {boolean}  [options.allowCustomerMembershipWhenSingleTenant]
 *   Allow any customer membership when the resolved customer topology is
 *   `SINGLE_TENANT`. Intended for read-only tenant-scoped routes.
 */
export const requireTenantAccess = (options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    roles = [],
    allowPlatform = true,
    allowCustomerAdmin = true,
    allowCustomerMembershipWhenSingleTenant = false,
    allowInactiveCustomer = false,
  } = options
  const { memberships, tenantMemberships, platformRoles } = req.scopes
  const customerId = req.params.customerId
  const tenantId = req.params.tenantId

  if (!customerId || !tenantId) {
    return forbidden(res, req, 'Customer and tenant identifiers are required.')
  }

  // Load customer for downstream middleware (e.g. topologyGuard)
  const customer = await loadCustomerContext(customerId)
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

  if (isCustomerInactive(customer) && !allowInactiveCustomer) {
    logger.warn(
      {
        userId: req.userId,
        customerId,
        tenantId,
        customerStatus: customer.status,
        requestId: req.requestId,
      },
      'requireTenantAccess - customer inactive',
    )
    return customerInactive(res, req, customer.status, 'require_tenant_access')
  }

  // Load tenant and validate it belongs to the customer
  const tenant = await loadTenantContext(tenantId)
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

  const customerMembership = memberships.find((m) => idsEqual(m.customerId, customerId)) || null

  // Customer Admin bypass
  if (allowCustomerAdmin) {
    if (customerMembership && customerMembership.roles.includes('CUSTOMER_ADMIN')) {
      return next()
    }
  }

  if (
    roles.includes('TENANT_ADMIN')
    && hasCustomerScopedTenantAdminAccessToTenant({
      memberships,
      tenantMemberships,
      customerId,
      tenantId,
      customer,
      tenant,
      actorUserId: req.userId,
    })
  ) {
    return next()
  }

  if (
    allowCustomerMembershipWhenSingleTenant
    && customer?.topology === 'SINGLE_TENANT'
    && customerMembership
    && Array.isArray(customerMembership.roles)
    && customerMembership.roles.length > 0
  ) {
    return next()
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
/*  requireTenantPermission                                           */
/* ------------------------------------------------------------------ */

/**
 * Factory: requireTenantPermission(permission, options?)
 *
 * @param {string} permission – Required tenant-level permission
 * @param {object} [options]
 * @param {boolean} [options.allowPlatform]         – Allow active SUPER_ADMIN bypass (default true)
 * @param {boolean} [options.allowCustomerPermission] – Allow the parent customer bucket to satisfy the permission (default false)
 * @param {string[]} [options.allowCustomerPermissionScopes] – Restrict customer-bucket fallback to these role scopes when provided
 * @param {boolean} [options.allowCustomerPermissionWhenSingleTenant] – Allow customer-bucket fallback for single-tenant customers
 * @param {boolean} [options.allowCustomerScopedTenantPermission] – Allow legacy customer-membership TENANT/VMF roles when the actor is the administered tenant admin
 * @param {boolean} [options.allowInactiveCustomer] – Allow disabled customers through this guard (default false)
 */
export const requireTenantPermission = (permission, options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    allowPlatform = true,
    allowCustomerPermission = false,
    allowCustomerPermissionScopes = [],
    allowCustomerPermissionWhenSingleTenant = false,
    allowCustomerScopedTenantPermission = false,
    allowInactiveCustomer = false,
  } = options
  const requiredPermission = normalizeAccessKey(permission)
  const customerId = req.params.customerId
  const tenantId = req.params.tenantId

  if (!customerId || !tenantId) {
    return forbidden(res, req, 'Customer and tenant identifiers are required.')
  }

  const resolvedPermissions = getResolvedPermissionsSnapshot(req.scopes)
  const hasSuperAdminBypass = allowPlatform && resolvedPermissions.platform.roleKeys.includes('SUPER_ADMIN')
  const customerBucket = allowCustomerPermission
    ? getResolvedCustomerPermissionBucket(req.scopes, customerId)
    : null
  const tenantBucket = getResolvedTenantPermissionBucket(req.scopes, customerId, tenantId)
  const hasCustomerPermission = allowCustomerPermission
    && hasResolvedBucketPermission(customerBucket, requiredPermission)
  const hasTenantPermission = hasResolvedBucketPermission(tenantBucket, requiredPermission)

  const customerPermissionFallback =
    !hasSuperAdminBypass && !hasTenantPermission
      ? await resolveTenantCustomerPermissionFallback({
          req,
          customerId,
          tenantId,
          requiredPermission,
          customerBucket,
          allowCustomerPermission,
          allowCustomerPermissionScopes,
          allowCustomerPermissionWhenSingleTenant,
          allowCustomerScopedTenantPermission,
        })
      : {
          allowed: false,
          customer: null,
          tenant: null,
          reason: null,
        }

  if (!hasSuperAdminBypass && !hasTenantPermission && !customerPermissionFallback.allowed) {
    logAuthorizationDenied({
      req,
      requiredPermission,
      scope: { customerId, tenantId },
      surface: 'requireTenantPermission',
      reason: customerPermissionFallback.reason || (allowCustomerPermission
        ? 'missing_customer_or_tenant_permission'
        : 'missing_tenant_permission'),
    })

    return forbidden(res, req, `Tenant permission '${requiredPermission}' is required.`)
  }

  const customer = customerPermissionFallback.customer || await loadCustomerContext(customerId)
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

  if (isCustomerInactive(customer) && !allowInactiveCustomer) {
    logger.warn(
      {
        userId: req.userId,
        customerId,
        tenantId,
        customerStatus: customer.status,
        requestId: req.requestId,
        permission: requiredPermission,
      },
      'requireTenantPermission - customer inactive',
    )
    return customerInactive(res, req, customer.status, 'require_tenant_permission')
  }

  const tenant = customerPermissionFallback.tenant || await loadTenantContext(tenantId)
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

  return next()
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
 * @param {boolean}  [options.requireVmfGrant]     – Require a VMF object grant for non-admin users (default true)
 */
export const requireVmfAccess = (permission, options = {}) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const {
    allowPlatform = true,
    allowCustomerAdmin = true,
    allowTenantAdmin = true,
    allowInactiveCustomer = false,
    requiredPermission = null,
    allowCustomerPermission = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermission,
    allowCustomerPermissionScopes = DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionScopes,
    allowCustomerPermissionWhenSingleTenant =
      DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerPermissionWhenSingleTenant,
    allowCustomerScopedTenantPermission =
      DEFAULT_HYBRID_TENANT_PERMISSION_OPTIONS.allowCustomerScopedTenantPermission,
    requireVmfGrant = true,
  } = options
  const vmfId = req.params.vmfId

  const hasAccess = await ensureVmfResourceAccess({
    req,
    res,
    vmfId,
    customerId: req.params.customerId,
    tenantId: req.params.tenantId,
    requireVmfGrant,
    grantPermission: permission,
    requiredPermission,
    allowPlatform,
    allowCustomerAdmin,
    allowTenantAdmin,
    allowInactiveCustomer,
    allowCustomerPermission,
    allowCustomerPermissionScopes,
    allowCustomerPermissionWhenSingleTenant,
    allowCustomerScopedTenantPermission,
    surface: 'requireVmfAccess',
  })

  if (!hasAccess) return

  next()
}

export const requireDealAccess = (
  capabilityPermission,
  vmfGrantPermission,
  options = {},
) => async (req, res, next) => {
  if (!ensureScopes(req, res)) return

  const dealId = req.params.dealId
  if (!dealId) {
    return forbidden(res, req, 'Deal identifier is required.')
  }

  const deal = await Deal.findById(dealId)
  if (!deal) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Deal not found.',
        requestId: req.requestId,
      },
    })
  }

  req.scopes.deal = deal

  const hasAccess = await ensureVmfResourceAccess({
    req,
    res,
    vmfId: deal.vmfId,
    customerId: deal.customerId,
    tenantId: deal.tenantId,
    grantPermission: vmfGrantPermission,
    requiredPermission: capabilityPermission,
    ...options,
    surface: 'requireDealAccess',
  })

  if (!hasAccess) return

  next()
}
