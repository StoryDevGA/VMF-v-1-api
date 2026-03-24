import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import {
  normalizeFeatureEntitlements,
  resolveCustomerFeatureEntitlements,
} from '../services/licenseEntitlementService.js'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const resolveScopedCustomerId = (req) =>
  toIdString(
    req.params?.customerId
    || req.scopes?.customer?._id
    || req.scopes?.customer?.id
    || req.scopes?.vmf?.customerId
    || req.scopes?.tenant?.customerId,
  )

const resolveScope = (req, customerId) => {
  const scope = {}
  if (customerId) scope.customerId = customerId

  const tenantId = toIdString(req.params?.tenantId || req.scopes?.tenant?._id || req.scopes?.vmf?.tenantId)
  if (tenantId) scope.tenantId = tenantId

  const vmfId = toIdString(req.params?.vmfId || req.scopes?.vmf?._id)
  if (vmfId) scope.vmfId = vmfId

  return scope
}

const buildFeatureDeniedResponse = (req, feature, details = {}) => ({
  error: {
    code: 'LICENSE_FEATURE_NOT_ENABLED',
    message: 'Your current licence does not include this feature.',
    details: {
      feature,
      ...details,
    },
    requestId: req.requestId,
  },
})

export const requireFeatureEntitlement = (featureKey, options = {}) => async (req, res, next) => {
  const normalizedFeatureKey = normalizeFeatureEntitlements([featureKey])[0]
  if (!normalizedFeatureKey) {
    return res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Feature entitlement middleware was configured without a valid feature key.',
        requestId: req.requestId,
      },
    })
  }

  if (!req.scopes) {
    return res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Authorization scopes not loaded.',
        requestId: req.requestId,
      },
    })
  }

  const allowPlatform = options.allowPlatform !== false
  const platformRoles = Array.isArray(req.scopes.platformRoles) ? req.scopes.platformRoles : []
  if (allowPlatform && platformRoles.includes('SUPER_ADMIN')) {
    return next()
  }

  const customerId = resolveScopedCustomerId(req)
  if (!customerId) {
    logger.warn(
      { requestId: req.requestId, feature: normalizedFeatureKey, path: req.originalUrl },
      'requireFeatureEntitlement - unable to resolve customer context',
    )
    return res.status(403).json(
      buildFeatureDeniedResponse(req, normalizedFeatureKey, { reason: 'CUSTOMER_CONTEXT_REQUIRED' }),
    )
  }

  const entitlementContext = await resolveCustomerFeatureEntitlements({
    customerId,
    customer: req.scopes?.customer || null,
  })

  if (!entitlementContext) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found.',
        requestId: req.requestId,
      },
    })
  }

  req.scopes.customerFeatureEntitlements = entitlementContext.featureEntitlements
  req.scopes.customerEntitlementSource = entitlementContext.entitlementSource
  req.scopes.customerLicenseLevelId = entitlementContext.licenseLevelId || null

  if (entitlementContext.featureEntitlements.includes(normalizedFeatureKey)) {
    return next()
  }

  await auditService.logFromRequest(req, {
    action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
    resourceType: auditService.RESOURCE_TYPES.Customer,
    resourceId: customerId,
    scope: resolveScope(req, customerId),
    diff: {
      reason: 'LICENSE_FEATURE_NOT_ENABLED',
      feature: normalizedFeatureKey,
      entitlementSource: entitlementContext.entitlementSource,
      licenseLevelId: entitlementContext.licenseLevelId || null,
      path: req.originalUrl,
      method: req.method,
    },
  })

  return res.status(403).json(
    buildFeatureDeniedResponse(req, normalizedFeatureKey, {
      customerId,
      licenseLevelId: entitlementContext.licenseLevelId || null,
      entitlementSource: entitlementContext.entitlementSource,
      reason: 'LICENSE_FEATURE_NOT_ENABLED',
    }),
  )
}

export default requireFeatureEntitlement

