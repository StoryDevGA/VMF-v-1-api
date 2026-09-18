export const LICENSE_HOME_EXPERIENCES = Object.freeze({
  SIGNAL: 'SIGNAL',
  CORE: 'CORE',
})

export const LICENSE_ENTITLEMENT_CATALOGUE = Object.freeze({
  VMF: Object.freeze({ key: 'VMF', label: 'VMF', home: LICENSE_HOME_EXPERIENCES.CORE, legacy: true }),
  DEALS: Object.freeze({ key: 'DEALS', label: 'Deals', legacy: true }),
  VIEWS: Object.freeze({ key: 'VIEWS', label: 'Views', legacy: true }),
  WEBSITE: Object.freeze({ key: 'WEBSITE', label: 'Website Analysis', home: LICENSE_HOME_EXPERIENCES.SIGNAL }),
  DOCUMENTS: Object.freeze({ key: 'DOCUMENTS', label: 'Document Improvement' }),
})

export const KNOWN_LICENSE_ENTITLEMENTS = Object.freeze(Object.keys(LICENSE_ENTITLEMENT_CATALOGUE))

export const isKnownLicenseEntitlement = (value) =>
  KNOWN_LICENSE_ENTITLEMENTS.includes(String(value ?? '').trim().toUpperCase())

export const normalizeLicenseHomeExperience = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase()
  return Object.values(LICENSE_HOME_EXPERIENCES).includes(normalized) ? normalized : null
}

export const normalizeLicenseEntitlements = (values) => (
  Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))]
    : []
)

export const isLicenseEntitlementCompatible = ({ homeExperience, featureEntitlements } = {}) => {
  const normalizedHome = normalizeLicenseHomeExperience(homeExperience)
  const entitlements = normalizeLicenseEntitlements(featureEntitlements)
  if (!normalizedHome) return true
  return !(normalizedHome === LICENSE_HOME_EXPERIENCES.CORE && entitlements.includes('WEBSITE'))
}
