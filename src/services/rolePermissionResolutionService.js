import logger from '../config/logger.js'
import { Role } from '../models/index.js'

const ROLE_SCOPES = new Set(['PLATFORM', 'CUSTOMER', 'TENANT', 'VMF'])
const RESOLUTION_SKIP_LOG_MESSAGE = 'resolved permission role skipped'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const sortStrings = (values) => [...values].sort((left, right) => left.localeCompare(right))

const normalizeKeys = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  )

const createBucket = (seed = {}) => ({
  ...seed,
  roleKeys: new Set(),
  permissions: new Set(),
})

const finalizeBucket = (bucket) => ({
  ...Object.fromEntries(
    Object.entries(bucket).filter(([key]) => key !== 'roleKeys' && key !== 'permissions'),
  ),
  roleKeys: sortStrings([...bucket.roleKeys]),
  permissions: sortStrings([...bucket.permissions]),
})

export const createEmptyResolvedPermissions = () => ({
  platform: {
    roleKeys: [],
    permissions: [],
  },
  customers: [],
  tenants: [],
})

const logResolutionSkip = ({
  log,
  actorUserId,
  customerId = null,
  tenantId = null,
  roleKey,
  roleScope = null,
  source,
  reason,
}) => {
  if (!log || typeof log.warn !== 'function') return

  log.warn(
    {
      actorUserId,
      customerId,
      tenantId,
      roleKey,
      roleScope,
      source,
      reason,
    },
    RESOLUTION_SKIP_LOG_MESSAGE,
  )
}

const getRoleDocumentsByKey = async ({ roleKeys, roleModel }) => {
  if (roleKeys.length === 0) return new Map()

  let query = roleModel.find({
    key: { $in: roleKeys },
  })

  if (query && typeof query.select === 'function') {
    query = query.select('key scope permissions isActive')
  }

  if (query && typeof query.lean === 'function') {
    query = query.lean()
  }

  const roleDocuments = await query

  return new Map(
    (Array.isArray(roleDocuments) ? roleDocuments : [])
      .map((roleDocument) => {
        const roleKey = String(roleDocument?.key || '').trim().toUpperCase()
        if (!roleKey) return null

        return [
          roleKey,
          {
            key: roleKey,
            scope: String(roleDocument?.scope || '').trim().toUpperCase(),
            permissions: normalizeKeys(roleDocument?.permissions),
            isActive: roleDocument?.isActive !== false,
          },
        ]
      })
      .filter(Boolean),
  )
}

const addRolePermissionsToBucket = (bucket, roleKey, permissions) => {
  bucket.roleKeys.add(roleKey)
  permissions.forEach((permission) => {
    bucket.permissions.add(permission)
  })
}

const getOrCreateCustomerBucket = (customerBuckets, customerId) => {
  if (!customerBuckets.has(customerId)) {
    customerBuckets.set(customerId, createBucket({ customerId }))
  }

  return customerBuckets.get(customerId)
}

const getOrCreateTenantBucket = (tenantBuckets, customerId, tenantId) => {
  const bucketKey = `${customerId}::${tenantId}`

  if (!tenantBuckets.has(bucketKey)) {
    tenantBuckets.set(bucketKey, createBucket({ customerId, tenantId }))
  }

  return tenantBuckets.get(bucketKey)
}

export const resolveRolePermissions = async ({
  user = null,
  memberships = user?.memberships,
  tenantMemberships = user?.tenantMemberships,
  roleModel = Role,
  log = logger,
} = {}) => {
  const normalizedMemberships = Array.isArray(memberships) ? memberships : []
  const normalizedTenantMemberships = Array.isArray(tenantMemberships) ? tenantMemberships : []
  const actorUserId = toIdString(user?._id || user?.id)

  const roleKeys = sortStrings(
    [
      ...normalizedMemberships.flatMap((membership) => normalizeKeys(membership?.roles)),
      ...normalizedTenantMemberships.flatMap((membership) => normalizeKeys(membership?.roles)),
    ],
  )

  const uniqueRoleKeys = [...new Set(roleKeys)]
  const roleDocumentsByKey = await getRoleDocumentsByKey({ roleKeys: uniqueRoleKeys, roleModel })

  const platformBucket = createBucket()
  const customerBuckets = new Map()
  const tenantBuckets = new Map()

  for (const membership of normalizedMemberships) {
    const customerId = toIdString(membership?.customerId)
    const membershipRoleKeys = normalizeKeys(membership?.roles)
    const source = customerId ? 'customer_membership' : 'platform_membership'

    for (const roleKey of membershipRoleKeys) {
      const roleDocument = roleDocumentsByKey.get(roleKey)

      if (!roleDocument) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          roleKey,
          source,
          reason: 'missing_role',
        })
        continue
      }

      if (!roleDocument.isActive) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'inactive_role',
        })
        continue
      }

      if (!ROLE_SCOPES.has(roleDocument.scope)) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'unsupported_scope',
        })
        continue
      }

      if (!customerId) {
        if (roleDocument.scope !== 'PLATFORM') {
          logResolutionSkip({
            log,
            actorUserId,
            roleKey,
            roleScope: roleDocument.scope,
            source,
            reason: 'platform_membership_scope_mismatch',
          })
          continue
        }

        addRolePermissionsToBucket(platformBucket, roleKey, roleDocument.permissions)
        continue
      }

      if (roleDocument.scope === 'PLATFORM') {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'customer_membership_scope_mismatch',
        })
        continue
      }

      // Legacy TENANT and VMF role assignments in memberships[] still resolve
      // into the customer bucket until the stored assignment cleanup is done.
      addRolePermissionsToBucket(
        getOrCreateCustomerBucket(customerBuckets, customerId),
        roleKey,
        roleDocument.permissions,
      )
    }
  }

  for (const tenantMembership of normalizedTenantMemberships) {
    const customerId = toIdString(tenantMembership?.customerId)
    const tenantId = toIdString(tenantMembership?.tenantId)
    const membershipRoleKeys = normalizeKeys(tenantMembership?.roles)
    const source = 'tenant_membership'

    if (!customerId || !tenantId) {
      membershipRoleKeys.forEach((roleKey) => {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          tenantId,
          roleKey,
          source,
          reason: 'invalid_tenant_membership',
        })
      })
      continue
    }

    for (const roleKey of membershipRoleKeys) {
      const roleDocument = roleDocumentsByKey.get(roleKey)

      if (!roleDocument) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          tenantId,
          roleKey,
          source,
          reason: 'missing_role',
        })
        continue
      }

      if (!roleDocument.isActive) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          tenantId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'inactive_role',
        })
        continue
      }

      if (!ROLE_SCOPES.has(roleDocument.scope)) {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          tenantId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'unsupported_scope',
        })
        continue
      }

      if (roleDocument.scope !== 'TENANT' && roleDocument.scope !== 'VMF') {
        logResolutionSkip({
          log,
          actorUserId,
          customerId,
          tenantId,
          roleKey,
          roleScope: roleDocument.scope,
          source,
          reason: 'tenant_membership_scope_mismatch',
        })
        continue
      }

      addRolePermissionsToBucket(
        getOrCreateTenantBucket(tenantBuckets, customerId, tenantId),
        roleKey,
        roleDocument.permissions,
      )
    }
  }

  return {
    platform: finalizeBucket(platformBucket),
    customers: sortStrings([...customerBuckets.keys()]).map((customerId) =>
      finalizeBucket(customerBuckets.get(customerId)),
    ),
    tenants: [...tenantBuckets.values()]
      .sort((left, right) => {
        const customerOrder = left.customerId.localeCompare(right.customerId)
        if (customerOrder !== 0) return customerOrder
        return left.tenantId.localeCompare(right.tenantId)
      })
      .map((bucket) => finalizeBucket(bucket)),
  }
}

const rolePermissionResolutionService = {
  createEmptyResolvedPermissions,
  resolveRolePermissions,
}

export default rolePermissionResolutionService