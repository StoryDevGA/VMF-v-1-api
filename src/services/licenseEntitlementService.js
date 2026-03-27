import { Customer, LicenseLevel } from '../models/index.js'
import performanceCacheService, {
  buildCustomerTopologySnapshot,
  buildLicenseLevelEntitlementSnapshot,
} from './performanceCacheService.js'

export const KNOWN_FEATURE_ENTITLEMENTS = Object.freeze(['VMF', 'DEALS', 'VIEWS'])

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

export const normalizeFeatureEntitlements = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeCustomerTopology = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()

  return normalized === 'SINGLE_TENANT' || normalized === 'MULTI_TENANT'
    ? normalized
    : null
}

const resolveCustomerContext = async ({ customerId, customer = null } = {}) => {
  const normalizedCustomerId = toIdString(customerId || customer?._id || customer?.id)
  if (!normalizedCustomerId) return null

  if (customer) {
    return {
      customerId: normalizedCustomerId,
      licenseLevelId: toIdString(customer.licenseLevelId),
      customerEntitlements: normalizeFeatureEntitlements(customer.entitlements),
      topology: normalizeCustomerTopology(customer.topology),
      defaultTenantId: toIdString(customer.defaultTenantId),
    }
  }

  const cachedCustomer = await performanceCacheService.getCustomerTopology(normalizedCustomerId)
  if (cachedCustomer) {
    return {
      customerId: normalizedCustomerId,
      licenseLevelId: toIdString(cachedCustomer.licenseLevelId),
      customerEntitlements: normalizeFeatureEntitlements(cachedCustomer.entitlements),
      topology: normalizeCustomerTopology(cachedCustomer.topology),
      defaultTenantId: toIdString(cachedCustomer.defaultTenantId),
    }
  }

  const customerDoc = await Customer.findById(normalizedCustomerId).select(
    '_id topology vmfPolicy defaultTenantId status isServiceProvider licenseLevelId entitlements governance',
  )

  if (!customerDoc) return null

  await performanceCacheService.setCustomerTopology(
    customerDoc._id,
    buildCustomerTopologySnapshot(customerDoc),
  )

  return {
    customerId: normalizedCustomerId,
    licenseLevelId: toIdString(customerDoc.licenseLevelId),
    customerEntitlements: normalizeFeatureEntitlements(customerDoc.entitlements),
    topology: normalizeCustomerTopology(customerDoc.topology),
    defaultTenantId: toIdString(customerDoc.defaultTenantId),
  }
}

const resolveLicenseLevelEntitlements = async (licenseLevelId) => {
  const normalizedLicenseLevelId = toIdString(licenseLevelId)
  if (!normalizedLicenseLevelId) {
    return {
      licenseLevelId: null,
      featureEntitlements: [],
      licenseLevelActive: null,
    }
  }

  const cachedLicense = await performanceCacheService.getLicenseLevelEntitlements(
    normalizedLicenseLevelId,
  )

  if (cachedLicense) {
    return {
      licenseLevelId: normalizedLicenseLevelId,
      featureEntitlements: normalizeFeatureEntitlements(cachedLicense.featureEntitlements),
      licenseLevelActive: Boolean(cachedLicense.isActive),
    }
  }

  const licenseLevel = await LicenseLevel.findById(normalizedLicenseLevelId).select(
    '_id isActive featureEntitlements',
  )

  if (!licenseLevel) {
    return {
      licenseLevelId: normalizedLicenseLevelId,
      featureEntitlements: [],
      licenseLevelActive: false,
    }
  }

  const snapshot = buildLicenseLevelEntitlementSnapshot(licenseLevel)
  await performanceCacheService.setLicenseLevelEntitlements(licenseLevel._id, snapshot)

  return {
    licenseLevelId: normalizedLicenseLevelId,
    featureEntitlements: normalizeFeatureEntitlements(snapshot.featureEntitlements),
    licenseLevelActive: Boolean(snapshot.isActive),
  }
}

export const resolveCustomerFeatureEntitlements = async ({ customerId, customer = null } = {}) => {
  const customerContext = await resolveCustomerContext({ customerId, customer })
  if (!customerContext) return null

  const licenseContext = await resolveLicenseLevelEntitlements(customerContext.licenseLevelId)

  const licenseEntitlements = normalizeFeatureEntitlements(licenseContext.featureEntitlements)
  if (licenseEntitlements.length > 0) {
    return {
      customerId: customerContext.customerId,
      licenseLevelId: licenseContext.licenseLevelId,
      featureEntitlements: licenseEntitlements,
      entitlementSource: 'LICENSE_LEVEL',
      licenseLevelActive: licenseContext.licenseLevelActive,
      topology: customerContext.topology,
      defaultTenantId: customerContext.defaultTenantId,
    }
  }

  if (customerContext.customerEntitlements.length > 0) {
    return {
      customerId: customerContext.customerId,
      licenseLevelId: licenseContext.licenseLevelId,
      featureEntitlements: customerContext.customerEntitlements,
      entitlementSource: 'CUSTOMER_OVERRIDE',
      licenseLevelActive: licenseContext.licenseLevelActive,
      topology: customerContext.topology,
      defaultTenantId: customerContext.defaultTenantId,
    }
  }

  return {
    customerId: customerContext.customerId,
    licenseLevelId: licenseContext.licenseLevelId,
    featureEntitlements: [...KNOWN_FEATURE_ENTITLEMENTS],
    entitlementSource: 'LEGACY_UNRESTRICTED',
    licenseLevelActive: licenseContext.licenseLevelActive,
    topology: customerContext.topology,
    defaultTenantId: customerContext.defaultTenantId,
  }
}

export const listUserCustomerFeatureScopes = async (user) => {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : []
  const tenantMemberships = Array.isArray(user?.tenantMemberships) ? user.tenantMemberships : []
  const customerIds = [...new Set([
    ...memberships
      .map((membership) => toIdString(membership?.customerId))
      .filter(Boolean),
    ...tenantMemberships
      .map((tm) => toIdString(tm?.customerId))
      .filter(Boolean),
  ])]

  if (customerIds.length === 0) return []

  const scopeResults = await Promise.all(
    customerIds.map((customerId) => resolveCustomerFeatureEntitlements({ customerId })),
  )

  return scopeResults
    .filter(Boolean)
    .map((scope) => ({
      customerId: scope.customerId,
      licenseLevelId: scope.licenseLevelId || null,
      featureEntitlements: scope.featureEntitlements,
      entitlementSource: scope.entitlementSource,
      ...(scope.topology ? { topology: scope.topology } : {}),
      ...(scope.defaultTenantId ? { defaultTenantId: scope.defaultTenantId } : {}),
    }))
}
