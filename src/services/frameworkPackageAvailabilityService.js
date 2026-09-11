import {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_VISIBILITY,
} from '../models/FrameworkPackage.js'
import RuntimeActivationSnapshot, {
  RUNTIME_ACTIVATION_STATUSES,
} from '../models/RuntimeActivationSnapshot.js'
import RuntimeDeployment, {
  RUNTIME_DEPLOYMENT_STATUSES,
} from '../models/RuntimeDeployment.js'
import { resolveCustomerFeatureEntitlements } from './licenseEntitlementService.js'

export const FRAMEWORK_PACKAGE_PRESENTATION_MODES = Object.freeze({
  FULL: 'FULL',
  PREVIEW: 'PREVIEW',
  HIDDEN: 'HIDDEN',
})

const RUNTIME_TYPE_ENTITLEMENT_FEATURES = Object.freeze({
  DEAL_ANALYSIS: 'DEALS',
  VALUE_NARRATIVE: 'VMF',
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (typeof value.id === 'string' && value.id.trim()) return value.id
    if (typeof value._id === 'string' && value._id.trim()) return value._id
    if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  }
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeToken = (value) => String(value || '').trim().toUpperCase()

const getFrameworkPackageId = (frameworkPackage) =>
  toIdString(frameworkPackage?._id || frameworkPackage?.id)

export const hasCertifiedDependencyLock = (frameworkPackage) => {
  const dependencyLock = frameworkPackage?.dependencyLock || null
  const references = Array.isArray(dependencyLock?.references) ? dependencyLock.references : []
  const snapshotId = String(dependencyLock?.snapshotId || '').trim()

  return Boolean(
    dependencyLock
    && normalizeToken(dependencyLock.status) === 'PASS'
    && references.length > 0
    && snapshotId,
  )
}

export const isFrameworkPackageAvailableToCustomer = ({
  frameworkPackage,
  customerId,
  frameworkKey,
} = {}) => {
  if (!frameworkPackage || !customerId || !frameworkKey) return false

  const normalizedFrameworkKey = normalizeToken(frameworkKey)
  const packageFrameworkKey = normalizeToken(frameworkPackage.frameworkKey)
  const packageStatus = normalizeToken(frameworkPackage.status)

  if (
    packageFrameworkKey === normalizedFrameworkKey
    && packageStatus === FRAMEWORK_PACKAGE_STATUSES.ACTIVE
    && frameworkPackage.isDefault === true
  ) {
    return true
  }

  const visibility = normalizeToken(frameworkPackage.visibility)
  const accessMode = normalizeToken(frameworkPackage.customerAccessMode)

  if (packageFrameworkKey !== normalizedFrameworkKey) return false
  if (packageStatus !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) return false
  if (visibility !== FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE) return false
  if (accessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS) return true
  if (accessMode !== FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS) return false

  const assignedCustomerIds = Array.isArray(frameworkPackage.assignedCustomerIds)
    ? frameworkPackage.assignedCustomerIds
    : []

  return assignedCustomerIds.some(
    (assignedCustomerId) => toIdString(assignedCustomerId) === String(customerId),
  )
}

export const buildAvailableFrameworkPackageFilter = ({ customerId, frameworkKey } = {}) => ({
  frameworkKey: normalizeToken(frameworkKey),
  status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
  $or: [
    { isDefault: true },
    {
      visibility: FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE,
      customerAccessMode: FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS,
    },
    {
      visibility: FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE,
      customerAccessMode: FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS,
      assignedCustomerIds: customerId,
    },
  ],
})

export const buildRuntimeCreationFrameworkPackageFilter = ({ customerId, frameworkKey } = {}) => ({
  ...buildAvailableFrameworkPackageFilter({ customerId, frameworkKey }),
  'dependencyLock.status': 'PASS',
  'dependencyLock.snapshotId': { $exists: true, $nin: [null, ''] },
  'dependencyLock.references.0': { $exists: true },
})

// Package families are intentionally resolved through the existing runtime
// capability entitlements. A new framework key therefore cannot silently
// become a new licence key. Value Narrative package families (including a
// future Website Analysis package) use the existing VMF capability; Deal
// Analysis uses the existing DEALS capability.
export const resolveFrameworkPackageEntitlementFeature = ({ runtimeType } = {}) =>
  RUNTIME_TYPE_ENTITLEMENT_FEATURES[normalizeToken(runtimeType)] || 'VMF'

export const resolveFrameworkPackageCustomerPresentation = async ({
  frameworkPackage,
  customerId,
  customer = null,
  runtimeType = 'VALUE_NARRATIVE',
} = {}) => {
  const entitlementContext = await resolveCustomerFeatureEntitlements({
    customerId,
    customer,
  })
  const frameworkKey = normalizeToken(frameworkPackage?.frameworkKey)
  const entitlementFeature = resolveFrameworkPackageEntitlementFeature({ runtimeType })
  const packageAccessible = isFrameworkPackageAvailableToCustomer({
    frameworkPackage,
    customerId,
    frameworkKey,
  })
  const featureEnabled = Boolean(
    entitlementContext?.featureEntitlements?.includes(entitlementFeature),
  )
  const supportsPreview = frameworkPackage?.capabilities?.supportsPreviewMode === true

  return {
    available: packageAccessible && featureEnabled,
    packageAccessible,
    featureEnabled,
    presentationMode: !packageAccessible
      ? FRAMEWORK_PACKAGE_PRESENTATION_MODES.HIDDEN
      : featureEnabled
        ? FRAMEWORK_PACKAGE_PRESENTATION_MODES.FULL
        : supportsPreview
          ? FRAMEWORK_PACKAGE_PRESENTATION_MODES.PREVIEW
          : FRAMEWORK_PACKAGE_PRESENTATION_MODES.HIDDEN,
    availabilityReason: !packageAccessible
      ? 'PACKAGE_NOT_AVAILABLE_TO_CUSTOMER'
      : !featureEnabled
        ? 'FEATURE_NOT_ENABLED'
        : null,
    entitlementFeature,
    licenseLevelId: entitlementContext?.licenseLevelId || null,
    entitlementSource: entitlementContext?.entitlementSource || null,
    licenseLevelActive: entitlementContext?.licenseLevelActive ?? null,
  }
}

export const serializeCustomerFrameworkPackage = ({
  frameworkPackage,
  presentation,
} = {}) => {
  if (!frameworkPackage) return null

  const id = getFrameworkPackageId(frameworkPackage)
  const uiContractKey = String(
    frameworkPackage?.uiContractBinding?.key || frameworkPackage?.uiContractKey || '',
  ).trim().toLowerCase() || null

  return {
    id,
    packageKey: frameworkPackage.packageKey || null,
    packageName: frameworkPackage.packageName || null,
    frameworkKey: normalizeToken(frameworkPackage.frameworkKey),
    frameworkName: frameworkPackage.frameworkName || null,
    version: frameworkPackage.version || null,
    status: normalizeToken(frameworkPackage.status),
    isDefault: frameworkPackage.isDefault === true,
    uiContractKey,
    sections: (Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : [])
      .map((section) => ({
        sectionKey: String(section?.sectionKey || '').trim(),
        runtimePath: String(section?.runtimePath || '').trim(),
        required: section?.required !== false,
      }))
      .filter((section) => section.sectionKey || section.runtimePath),
    capabilities: {
      supportsPreviewMode: frameworkPackage?.capabilities?.supportsPreviewMode === true,
      supportsFullReport: frameworkPackage?.capabilities?.supportsFullReport === true,
    },
    ...(presentation || {}),
  }
}

export const filterRuntimeCreationReadyFrameworkPackages = async ({
  frameworkPackages,
  frameworkKey,
} = {}) => {
  const packageRows = Array.isArray(frameworkPackages)
    ? frameworkPackages.filter(hasCertifiedDependencyLock)
    : []

  if (packageRows.length === 0) return []

  const normalizedFrameworkKey = normalizeToken(frameworkKey)
  const packageIds = packageRows
    .map(getFrameworkPackageId)
    .filter(Boolean)

  if (packageIds.length === 0) return []

  const deployments = await RuntimeDeployment.find({
    packageId: { $in: packageIds },
    frameworkKey: normalizedFrameworkKey,
    status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
  }).lean()

  const activeDeployments = Array.isArray(deployments)
    ? deployments.filter((deployment) => String(deployment?.activationId || '').trim())
    : []

  if (activeDeployments.length === 0) return []

  const activationIds = activeDeployments
    .map((deployment) => String(deployment.activationId || '').trim())
    .filter(Boolean)

  const activationSnapshots = await RuntimeActivationSnapshot.find({
    packageId: { $in: packageIds },
    activationId: { $in: activationIds },
    activationStatus: RUNTIME_ACTIVATION_STATUSES.ACTIVE,
  }).lean()

  const deploymentByPackageId = new Map(
    activeDeployments.map((deployment) => [toIdString(deployment.packageId), deployment]),
  )
  const snapshotByPackageAndActivation = new Map(
    (Array.isArray(activationSnapshots) ? activationSnapshots : []).map((snapshot) => [
      `${toIdString(snapshot.packageId)}::${String(snapshot.activationId || '').trim()}`,
      snapshot,
    ]),
  )

  return packageRows.filter((frameworkPackage) => {
    const packageId = getFrameworkPackageId(frameworkPackage)
    const deployment = deploymentByPackageId.get(packageId)
    if (!deployment) return false

    const activationId = String(deployment.activationId || '').trim()
    const activationSnapshot = snapshotByPackageAndActivation.get(`${packageId}::${activationId}`)
    if (!activationSnapshot) return false

    const dependencyLock = frameworkPackage.dependencyLock || {}
    const packageDependencySnapshotId = String(dependencyLock.snapshotId || '').trim()
    const packageDependencySnapshotHash = String(
      dependencyLock.snapshotHash || dependencyLock.hash || '',
    ).trim()
    const activationDependencySnapshotId = String(
      activationSnapshot.dependencySnapshotId || '',
    ).trim()
    const activationDependencySnapshotHash = String(
      activationSnapshot.dependencySnapshotHash || '',
    ).trim()

    return Boolean(
      activationDependencySnapshotId
      && activationDependencySnapshotId === packageDependencySnapshotId
      && (
        !packageDependencySnapshotHash
        || activationDependencySnapshotHash === packageDependencySnapshotHash
      ),
    )
  })
}
