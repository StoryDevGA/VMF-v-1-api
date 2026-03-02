import { Customer, User } from '../models/index.js'
import env from '../config/env.js'
import logger from '../config/logger.js'

const CUSTOMER_ADMIN_ROLE = 'CUSTOMER_ADMIN'
const ACTIVE_CUSTOMER_STATUS = 'ACTIVE'
const DEFAULT_MAX_TENANTS = 1
const DEFAULT_MAX_VMFS_PER_TENANT = 1

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const cloneDeep = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const createGovernanceError = ({ status, code, message, details }) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = details
  err.isGovernanceError = true
  return err
}

const isGovernanceError = (err) => Boolean(err?.isGovernanceError)

const isCustomerActive = (customer) => customer?.status === ACTIVE_CUSTOMER_STATUS

const getCanonicalAdminUserId = (customer) =>
  toIdString(customer?.governance?.customerAdminUserId)

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.floor(parsed)
  if (normalized < 1) return fallback
  return normalized
}

const getGovernanceLimits = (customer) => ({
  maxTenants: parsePositiveInteger(
    customer?.governance?.maxTenants,
    DEFAULT_MAX_TENANTS,
  ),
  maxVmfsPerTenant: parsePositiveInteger(
    customer?.governance?.maxVmfsPerTenant,
    DEFAULT_MAX_VMFS_PER_TENANT,
  ),
})

const parseNonNegativeInteger = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0) return 0
  return Math.floor(parsed)
}

const getCustomerMembership = (user, customerId) =>
  user.memberships.find(
    (membership) =>
      membership.customerId &&
      toIdString(membership.customerId) === toIdString(customerId),
  )

const ensureCustomerAdminRole = (user, customerId) => {
  let changed = false

  let membership = getCustomerMembership(user, customerId)
  if (!membership) {
    user.memberships.push({
      customerId,
      roles: [CUSTOMER_ADMIN_ROLE],
    })
    return true
  }

  if (!membership.roles.includes(CUSTOMER_ADMIN_ROLE)) {
    membership.roles.push(CUSTOMER_ADMIN_ROLE)
    changed = true
  }

  return changed
}

const removeCustomerAdminRole = (user, customerId) => {
  const membership = getCustomerMembership(user, customerId)
  if (!membership) return false

  if (!membership.roles.includes(CUSTOMER_ADMIN_ROLE)) {
    return false
  }

  membership.roles = membership.roles.filter((role) => role !== CUSTOMER_ADMIN_ROLE)
  if (membership.roles.length === 0) {
    user.memberships = user.memberships.filter(
      (entry) =>
        !(
          entry.customerId &&
          toIdString(entry.customerId) === toIdString(customerId)
        ),
    )
  }

  return true
}

const hasCustomerAdminRole = (user, customerId) => {
  const membership = getCustomerMembership(user, customerId)
  return Boolean(membership?.roles?.includes(CUSTOMER_ADMIN_ROLE))
}

const setCanonicalAdminUserId = (customer, userId) => {
  if (!customer.governance || typeof customer.governance !== 'object') {
    customer.governance = {}
  }
  customer.governance.customerAdminUserId = userId || null
}

const saveIfChanged = async (doc, changed) => {
  if (!changed) return
  await doc.save()
}

const findOneWithOptionalSelect = async (query, selectFields) => {
  if (query && typeof query.select === 'function') {
    return query.select(selectFields)
  }
  return query
}

const findConflictingActiveAdmin = async ({ customerId, excludeUserId }) => {
  const query = User.findOne({
    _id: { $ne: excludeUserId },
    isActive: true,
    memberships: {
      $elemMatch: {
        customerId,
        roles: CUSTOMER_ADMIN_ROLE,
      },
    },
  })

  return findOneWithOptionalSelect(query, '_id')
}

const applyCustomerAdminAssignment = async ({ customer, user }) => {
  if (!user?.isActive) {
    throw createGovernanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Cannot assign customer admin role to an inactive user.',
    })
  }

  const customerId = toIdString(customer?._id)
  const userId = toIdString(user?._id)
  const canonicalAdminUserId = getCanonicalAdminUserId(customer)

  if (
    env.governanceStrictAdminInvariantEnabled &&
    isCustomerActive(customer) &&
    canonicalAdminUserId &&
    canonicalAdminUserId !== userId
  ) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Customer already has an active canonical customer admin. Use replace admin endpoint.',
      details: {
        customerId,
        canonicalAdminUserId,
      },
    })
  }

  if (
    env.governanceStrictAdminInvariantEnabled &&
    isCustomerActive(customer) &&
    !canonicalAdminUserId
  ) {
    const conflictingAdmin = await findConflictingActiveAdmin({
      customerId: customer._id,
      excludeUserId: user._id,
    })
    if (conflictingAdmin) {
      throw createGovernanceError({
        status: 409,
        code: 'CONFLICT',
        message: 'Customer already has an active customer admin. Use replace admin endpoint.',
        details: {
          customerId,
          conflictingAdminUserId: toIdString(conflictingAdmin._id),
        },
      })
    }
  }

  const userChanged = ensureCustomerAdminRole(user, customerId)
  let customerChanged = false

  if (canonicalAdminUserId !== userId) {
    setCanonicalAdminUserId(customer, user._id)
    customerChanged = true
  }

  await saveIfChanged(user, userChanged)
  await saveIfChanged(customer, customerChanged)

  return {
    previousCanonicalAdminUserId: canonicalAdminUserId,
    canonicalAdminUserId: userId,
    userChanged,
    customerChanged,
  }
}

const replaceCustomerAdmin = async ({ customer, newUser }) => {
  if (!newUser?.isActive) {
    throw createGovernanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Cannot assign customer admin role to an inactive user.',
    })
  }

  const customerId = toIdString(customer?._id)
  const newUserId = toIdString(newUser?._id)
  const oldUserId = getCanonicalAdminUserId(customer)

  if (!oldUserId) {
    throw createGovernanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Customer has no existing customer admin to replace.',
      details: { customerId },
    })
  }

  const oldAdmin = oldUserId === newUserId
    ? newUser
    : await User.findById(oldUserId)

  if (!oldAdmin) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Customer canonical admin reference is invalid. Remediate governance data before replacement.',
      details: { customerId, oldUserId },
    })
  }

  if (!hasCustomerAdminRole(oldAdmin, customerId)) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Customer canonical admin does not hold CUSTOMER_ADMIN role. Remediate governance data before replacement.',
      details: { customerId, oldUserId },
    })
  }

  if (oldUserId === newUserId) {
    const roleAdded = ensureCustomerAdminRole(newUser, customerId)
    await saveIfChanged(newUser, roleAdded)
    return {
      oldUserId,
      newUserId,
      changed: roleAdded,
      oldAdmin,
      newAdmin: newUser,
    }
  }

  const oldMembershipSnapshot = cloneDeep(oldAdmin.memberships)
  const newMembershipSnapshot = cloneDeep(newUser.memberships)
  const governanceSnapshot = cloneDeep(customer.governance)

  const newUserChanged = ensureCustomerAdminRole(newUser, customerId)
  const oldUserChanged = removeCustomerAdminRole(oldAdmin, customerId)
  setCanonicalAdminUserId(customer, newUser._id)

  let newUserSaved = false
  let customerSaved = false
  let oldUserSaved = false

  try {
    await saveIfChanged(newUser, newUserChanged)
    newUserSaved = newUserChanged

    await customer.save()
    customerSaved = true

    await saveIfChanged(oldAdmin, oldUserChanged)
    oldUserSaved = oldUserChanged
  } catch (err) {
    oldAdmin.memberships = oldMembershipSnapshot
    newUser.memberships = newMembershipSnapshot
    customer.governance = governanceSnapshot

    const rollbackWrites = []

    if (oldUserSaved) {
      rollbackWrites.push(
        Promise.resolve(oldAdmin.save()).catch((rollbackErr) => {
          logger.error({ err: rollbackErr, customerId, oldUserId }, 'failed to rollback old admin membership change')
        }),
      )
    }

    if (customerSaved) {
      rollbackWrites.push(
        Promise.resolve(customer.save()).catch((rollbackErr) => {
          logger.error({ err: rollbackErr, customerId }, 'failed to rollback customer canonical admin pointer')
        }),
      )
    }

    if (newUserSaved) {
      rollbackWrites.push(
        Promise.resolve(newUser.save()).catch((rollbackErr) => {
          logger.error({ err: rollbackErr, customerId, newUserId }, 'failed to rollback new admin membership change')
        }),
      )
    }

    if (rollbackWrites.length > 0) {
      await Promise.allSettled(rollbackWrites)
    }

    const replacementError = createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Customer admin replacement failed and was rolled back.',
      details: { customerId, oldUserId, newUserId },
    })
    replacementError.cause = err
    throw replacementError
  }

  return {
    oldUserId,
    newUserId,
    changed: true,
    oldAdmin,
    newAdmin: newUser,
  }
}

const validateUserRoleUpdate = ({ customer, user, nextRoles }) => {
  const customerId = toIdString(customer?._id)
  const userId = toIdString(user?._id)
  const canonicalAdminUserId = getCanonicalAdminUserId(customer)
  const isCanonicalAdmin = canonicalAdminUserId === userId
  const requestsCustomerAdminRole = Array.isArray(nextRoles) &&
    nextRoles.includes(CUSTOMER_ADMIN_ROLE)

  if (!env.governanceStrictAdminInvariantEnabled) {
    return {
      shouldSetCanonicalAdminUserId: Boolean(
        requestsCustomerAdminRole && !canonicalAdminUserId,
      ),
      shouldClearCanonicalAdminUserId: Boolean(
        !requestsCustomerAdminRole &&
        isCanonicalAdmin &&
        !isCustomerActive(customer),
      ),
    }
  }

  if (requestsCustomerAdminRole && !user?.isActive) {
    throw createGovernanceError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Cannot assign customer admin role to an inactive user.',
      details: { customerId, userId },
    })
  }

  if (
    isCustomerActive(customer) &&
    isCanonicalAdmin &&
    !requestsCustomerAdminRole
  ) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Cannot remove CUSTOMER_ADMIN role from the canonical active customer admin. Replace admin first.',
      details: { customerId, userId },
    })
  }

  if (
    isCustomerActive(customer) &&
    !isCanonicalAdmin &&
    requestsCustomerAdminRole &&
    canonicalAdminUserId
  ) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Cannot assign a second CUSTOMER_ADMIN while an active canonical admin exists. Use replace admin endpoint.',
      details: { customerId, userId, canonicalAdminUserId },
    })
  }

  return {
    shouldSetCanonicalAdminUserId: Boolean(
      requestsCustomerAdminRole && !canonicalAdminUserId,
    ),
    shouldClearCanonicalAdminUserId: Boolean(
      !requestsCustomerAdminRole &&
      isCanonicalAdmin &&
      !isCustomerActive(customer),
    ),
  }
}

const assertUserCanBeDisabledOrDeleted = async ({ user, operation }) => {
  if (!env.governanceStrictAdminInvariantEnabled) return null

  const query = Customer.findOne({
    status: ACTIVE_CUSTOMER_STATUS,
    'governance.customerAdminUserId': user._id,
  })

  const blockingCustomer = await findOneWithOptionalSelect(query, '_id name status governance.customerAdminUserId')
  if (!blockingCustomer) return null

  throw createGovernanceError({
    status: 409,
    code: 'CONFLICT',
    message: `Cannot ${operation} the canonical customer admin of an active customer. Replace admin first.`,
    details: {
      customerId: toIdString(blockingCustomer._id),
      canonicalAdminUserId: toIdString(blockingCustomer?.governance?.customerAdminUserId),
    },
  })
}

const assertTenantCreationWithinLimit = ({
  customer,
  currentTenantCount,
}) => {
  const { maxTenants } = getGovernanceLimits(customer)
  const normalizedCount = parseNonNegativeInteger(currentTenantCount)

  if (normalizedCount >= maxTenants) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'Tenant limit reached for this customer.',
      details: {
        reason: 'TENANT_LIMIT_REACHED',
        customerId: toIdString(customer?._id),
        limitType: 'MAX_TENANTS',
        limit: maxTenants,
        currentCount: normalizedCount,
      },
    })
  }

  return {
    limit: maxTenants,
    currentCount: normalizedCount,
    nextCount: normalizedCount + 1,
  }
}

const assertVmfCreationWithinLimit = ({
  customer,
  tenantId,
  currentVmfCount,
}) => {
  const { maxVmfsPerTenant } = getGovernanceLimits(customer)
  const normalizedCount = parseNonNegativeInteger(currentVmfCount)

  if (normalizedCount >= maxVmfsPerTenant) {
    throw createGovernanceError({
      status: 409,
      code: 'CONFLICT',
      message: 'VMF limit reached for this tenant.',
      details: {
        reason: 'VMF_LIMIT_REACHED',
        customerId: toIdString(customer?._id),
        tenantId: toIdString(tenantId),
        limitType: 'MAX_VMFS_PER_TENANT',
        limit: maxVmfsPerTenant,
        currentCount: normalizedCount,
      },
    })
  }

  return {
    limit: maxVmfsPerTenant,
    currentCount: normalizedCount,
    nextCount: normalizedCount + 1,
  }
}

const customerGovernanceService = {
  CUSTOMER_ADMIN_ROLE,
  DEFAULT_MAX_TENANTS,
  DEFAULT_MAX_VMFS_PER_TENANT,
  createGovernanceError,
  isGovernanceError,
  isCustomerActive,
  getGovernanceLimits,
  getCanonicalAdminUserId,
  hasCustomerAdminRole,
  ensureCustomerAdminRole,
  removeCustomerAdminRole,
  applyCustomerAdminAssignment,
  replaceCustomerAdmin,
  validateUserRoleUpdate,
  assertUserCanBeDisabledOrDeleted,
  assertTenantCreationWithinLimit,
  assertVmfCreationWithinLimit,
}

export default customerGovernanceService
