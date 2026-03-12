import { User } from '../models/index.js'
import customerGovernanceService from './customerGovernanceService.js'

const NON_ARCHIVED_COUNT_MODE = 'NON_ARCHIVED'

export const TENANT_MANAGEMENT_REASONS = Object.freeze({
  LIMIT_REACHED: 'TENANT_LIMIT_REACHED',
  INVALID_TENANT_ADMIN_ASSIGNMENTS: 'TENANT_ADMIN_ASSIGNMENTS_INVALID',
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const parseNonNegativeInteger = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0) return 0
  return Math.floor(parsed)
}

const hasCustomerMembership = (user, customerId) =>
  Array.isArray(user?.memberships) &&
  user.memberships.some(
    (membership) => toIdString(membership?.customerId) === toIdString(customerId),
  )

const uniqueTenantAdminIds = (tenantAdminUserIds = []) => {
  const normalizedIds = tenantAdminUserIds
    .map((userId) => toIdString(userId))
    .filter(Boolean)

  return [...new Set(normalizedIds)]
}

export const buildTenantCapacityMeta = ({
  customer,
  currentTenantCount,
}) => {
  const { maxTenants } = customerGovernanceService.getGovernanceLimits(customer)
  const normalizedCount = parseNonNegativeInteger(currentTenantCount)

  return {
    maxTenants,
    currentCount: normalizedCount,
    remainingCount: Math.max(maxTenants - normalizedCount, 0),
    isAtCapacity: normalizedCount >= maxTenants,
    countMode: NON_ARCHIVED_COUNT_MODE,
  }
}

export const buildTenantAdminAssignmentErrorPayload = ({
  customerId,
  validation,
  requestId,
}) => {
  const message = 'One or more tenant admin assignments are invalid.'

  return {
    code: 'VALIDATION_FAILED',
    message,
    details: {
      tenantAdminUserIds: message,
      reason: TENANT_MANAGEMENT_REASONS.INVALID_TENANT_ADMIN_ASSIGNMENTS,
      customerId: toIdString(customerId),
      invalidTenantAdminUserIds: validation.invalidTenantAdminUserIds,
      ...(validation.missingTenantAdminUserIds.length > 0
        ? { missingTenantAdminUserIds: validation.missingTenantAdminUserIds }
        : {}),
      ...(validation.inactiveTenantAdminUserIds.length > 0
        ? { inactiveTenantAdminUserIds: validation.inactiveTenantAdminUserIds }
        : {}),
      ...(validation.outOfCustomerTenantAdminUserIds.length > 0
        ? { outOfCustomerTenantAdminUserIds: validation.outOfCustomerTenantAdminUserIds }
        : {}),
    },
    ...(requestId ? { requestId } : {}),
  }
}

export const buildTenantAdminAssignmentErrorResponse = ({
  req,
  customerId,
  validation,
}) => ({
  error: buildTenantAdminAssignmentErrorPayload({
    customerId,
    validation,
    requestId: req.requestId,
  }),
})

export const validateTenantAdminAssignments = async ({
  customerId,
  tenantAdminUserIds,
  findUsers = (filter) => User.find(filter).lean(),
}) => {
  if (tenantAdminUserIds === undefined) return null
  if (!Array.isArray(tenantAdminUserIds) || tenantAdminUserIds.length === 0) return null

  const uniqueIds = uniqueTenantAdminIds(tenantAdminUserIds)
  if (uniqueIds.length === 0) return null

  const users = await findUsers({ _id: { $in: uniqueIds } })
  const usersById = new Map(
    (Array.isArray(users) ? users : []).map((user) => [toIdString(user?._id), user]),
  )

  const missingTenantAdminUserIds = []
  const inactiveTenantAdminUserIds = []
  const outOfCustomerTenantAdminUserIds = []

  for (const userId of uniqueIds) {
    const user = usersById.get(userId)

    if (!user) {
      missingTenantAdminUserIds.push(userId)
      continue
    }

    if (user.isActive === false) {
      inactiveTenantAdminUserIds.push(userId)
    }

    if (!hasCustomerMembership(user, customerId)) {
      outOfCustomerTenantAdminUserIds.push(userId)
    }
  }

  const invalidTenantAdminUserIds = uniqueIds.filter(
    (userId) =>
      missingTenantAdminUserIds.includes(userId) ||
      inactiveTenantAdminUserIds.includes(userId) ||
      outOfCustomerTenantAdminUserIds.includes(userId),
  )

  if (invalidTenantAdminUserIds.length === 0) {
    return null
  }

  return {
    invalidTenantAdminUserIds,
    missingTenantAdminUserIds,
    inactiveTenantAdminUserIds,
    outOfCustomerTenantAdminUserIds,
  }
}
