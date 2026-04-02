/**
 * Performance Cache Service (Phase 5.3)
 *
 * Two-tier caching layer (in-memory Map + Redis) for hot authorization data:
 *   - User permissions   — 5-minute TTL (platform roles, memberships, grants, resolved permissions)
 *   - Tenant status      — 1-minute TTL (status, isDefault, admins)
 *   - Customer topology  — 15-minute TTL (topology, vmfPolicy, service provider flag)
 *   - License entitlements — 15-minute TTL (featureEntitlements by license level)
 *
 * Provides:
 *   - get / set / invalidate per namespace
 *   - `invalidateUserPermissionsForRoleKey()` — targeted wipe after role updates
 *   - `invalidateAllUserPermissions()` — bulk wipe (e.g. VMF delete)
 *   - `warmAuthorizationCaches()`      — pre-populate from DB on startup / interval
 *   - Snapshot builders exported for use by middleware and controllers
 *
 * Cache reads:
 *   - user-permissions namespace: Redis only when Redis is available, to keep
 *     permission invalidations consistent across horizontally-scaled instances.
 *   - all other namespaces: local Map → Redis → null (performance reads).
 * Cache writes: local Map + Redis.
 * All operations are no-op when `PERF_CACHE_ENABLED=false` (default in test).
 */

import env from '../config/env.js'
import logger from '../config/logger.js'
import { getRedis } from '../config/redis.js'
import { Customer, LicenseLevel, Tenant, User } from '../models/index.js'
import {
  createEmptyResolvedPermissions,
  resolveRolePermissions,
} from './rolePermissionResolutionService.js'

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                               */
/* ------------------------------------------------------------------ */

const CACHE_PREFIX = 'perf'
const LOCAL_CACHE = new Map()

const normalizeId = (id) => {
  if (id === null || id === undefined) return ''
  if (typeof id === 'string') return id
  if (typeof id.toString === 'function') return id.toString()
  return String(id)
}

const normalizeRoleKey = (roleKey) =>
  String(roleKey || '')
    .trim()
    .toUpperCase()

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildAssignedRoleQuery = (roleKey) => ({
  $or: [
    {
      'memberships.roles': {
        $regex: `^${escapeRegex(roleKey)}$`,
        $options: 'i',
      },
    },
    {
      'tenantMemberships.roles': {
        $regex: `^${escapeRegex(roleKey)}$`,
        $options: 'i',
      },
    },
  ],
})

const applyQueryMaxTimeMs = (query, timeoutMs) => {
  if (query && typeof query.maxTimeMS === 'function' && timeoutMs > 0) {
    return query.maxTimeMS(timeoutMs)
  }

  return query
}

const normalizeUserIds = (userIds = []) => [...new Set(
  (Array.isArray(userIds) ? userIds : [])
    .map((userId) => normalizeId(userId?._id ?? userId?.id ?? userId))
    .filter(Boolean),
)]

const buildKey = (namespace, id) => `${CACHE_PREFIX}:${namespace}:${normalizeId(id)}`
const now = () => Date.now()
const normalizeFeatureEntitlements = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const readLocalCache = (key) => {
  const entry = LOCAL_CACHE.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now()) {
    LOCAL_CACHE.delete(key)
    return null
  }
  return entry.value
}

const writeLocalCache = (key, value, ttlSeconds) => {
  LOCAL_CACHE.set(key, {
    value,
    expiresAt: now() + ttlSeconds * 1000,
  })
}

const deleteLocalCache = (key) => {
  LOCAL_CACHE.delete(key)
}

const deleteLocalCacheByPrefix = (prefix) => {
  for (const key of LOCAL_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      LOCAL_CACHE.delete(key)
    }
  }
}

const parseRedisValue = (rawValue) => {
  if (!rawValue) return null
  try {
    return JSON.parse(rawValue)
  } catch (err) {
    logger.warn({ err }, 'performance cache parse failed')
    return null
  }
}

const getFromRedis = async (key) => {
  const redis = getRedis()
  if (!redis) return null
  try {
    const rawValue = await redis.get(key)
    return parseRedisValue(rawValue)
  } catch (err) {
    logger.warn({ err, key }, 'performance cache redis get failed')
    return null
  }
}

const setInRedis = async (key, value, ttlSeconds) => {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch (err) {
    logger.warn({ err, key }, 'performance cache redis set failed')
  }
}

const deleteInRedis = async (key) => {
  const redis = getRedis()
  if (!redis) {
    return {
      attempted: false,
      ok: true,
      skipped: true,
    }
  }

  try {
    await redis.del(key)

    return {
      attempted: true,
      ok: true,
      skipped: false,
    }
  } catch (err) {
    logger.error(
      {
        err,
        key,
        alert: true,
        alertCode: 'PERF_CACHE_DISTRIBUTED_INVALIDATION_FAILED',
        cacheOperation: 'delete',
      },
      'performance cache redis delete failed',
    )

    return {
      attempted: true,
      ok: false,
      skipped: false,
    }
  }
}

const deleteInRedisByPattern = async (pattern) => {
  const redis = getRedis()
  if (!redis) {
    return {
      attempted: false,
      ok: true,
      skipped: true,
      deletedKeyCount: 0,
    }
  }

  try {
    let deletedKeyCount = 0
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await redis.del(...keys)
        deletedKeyCount += keys.length
      }
    } while (cursor !== '0')

    return {
      attempted: true,
      ok: true,
      skipped: false,
      deletedKeyCount,
    }
  } catch (err) {
    logger.error(
      {
        err,
        pattern,
        alert: true,
        alertCode: 'PERF_CACHE_DISTRIBUTED_INVALIDATION_FAILED',
        cacheOperation: 'pattern_delete',
      },
      'performance cache redis pattern delete failed',
    )

    return {
      attempted: true,
      ok: false,
      skipped: false,
      deletedKeyCount: 0,
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Generic cache operations                                          */
/* ------------------------------------------------------------------ */

const getCachedValue = async (key, ttlSeconds, options = {}) => {
  if (!env.perfCacheEnabled) return null

  const skipLocalCache = Boolean(options.skipLocalCache)

  if (!skipLocalCache) {
    const localValue = readLocalCache(key)
    if (localValue !== null) return localValue
  }

  const redisValue = await getFromRedis(key)
  if (redisValue !== null && !skipLocalCache) {
    writeLocalCache(key, redisValue, ttlSeconds)
  }
  return redisValue
}

const setCachedValue = async (key, value, ttlSeconds, options = {}) => {
  if (!env.perfCacheEnabled) return

  const skipLocalCache = Boolean(options.skipLocalCache)

  if (!skipLocalCache) {
    writeLocalCache(key, value, ttlSeconds)
  }

  await setInRedis(key, value, ttlSeconds)
}

const invalidateCachedValue = async (key) => {
  deleteLocalCache(key)
  const redisDelete = await deleteInRedis(key)

  return {
    invalidated: true,
    redisDeleteFailed: Boolean(redisDelete.attempted && !redisDelete.ok),
  }
}

/* ------------------------------------------------------------------ */
/*  Snapshot builders                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a cacheable user authorization snapshot without resolved permissions.
 * This is kept for lightweight cache writers that do not need role resolution.
 * @param {import('../models/User.js').default} user - Mongoose User document
 * @returns {{ user: object, memberships: Array, tenantMemberships: Array, vmfGrants: Array, platformRoles: string[], isPlatformUser: boolean, isActive: boolean }}
 */
export const buildLegacyUserPermissionsSnapshot = (user) => {
  const memberships = Array.isArray(user.memberships) ? user.memberships : []
  const tenantMemberships = Array.isArray(user.tenantMemberships) ? user.tenantMemberships : []
  const vmfGrants = Array.isArray(user.vmfGrants) ? user.vmfGrants : []

  const platformRoles = memberships
    .filter((membership) => membership.customerId === null || membership.customerId === undefined)
    .flatMap((membership) => membership.roles || [])

  return {
    user: {
      _id: user._id,
      id: user.id || normalizeId(user._id),
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      memberships,
      tenantMemberships,
      vmfGrants,
    },
    memberships,
    tenantMemberships,
    vmfGrants,
    platformRoles,
    isPlatformUser: platformRoles.length > 0,
    isActive: Boolean(user.isActive),
  }
}

/**
 * Build a cacheable permissions snapshot from a User document.
 * @param {import('../models/User.js').default} user - Mongoose User document
 * @returns {Promise<{ user: object, memberships: Array, tenantMemberships: Array, vmfGrants: Array, platformRoles: string[], resolvedPermissions: object, isPlatformUser: boolean, isActive: boolean }>}
 */
export const buildUserPermissionsSnapshot = async (user) => {
  const baseSnapshot = buildLegacyUserPermissionsSnapshot(user)

  let resolvedPermissions = createEmptyResolvedPermissions()

  try {
    resolvedPermissions = await resolveRolePermissions({
      user,
      memberships: baseSnapshot.memberships,
      tenantMemberships: baseSnapshot.tenantMemberships,
    })
  } catch (err) {
    logger.error(
      {
        err,
        userId: normalizeId(user?._id || user?.id),
        email: user?.email || null,
      },
      'resolved permission snapshot build failed; falling back to empty permissions',
    )
  }

  return {
    ...baseSnapshot,
    resolvedPermissions,
  }
}

/**
 * Build a cacheable status snapshot from a Tenant document.
 * @param {import('../models/Tenant.js').default} tenant - Mongoose Tenant document
 * @returns {{ _id: string, customerId: string, status: string, isDefault: boolean, name: string, website: string, tenantAdminUserIds: string[] }}
 */
export const buildTenantStatusSnapshot = (tenant) => ({
  _id: tenant._id,
  id: tenant.id || normalizeId(tenant._id),
  customerId: tenant.customerId,
  status: tenant.status,
  isDefault: Boolean(tenant.isDefault),
  name: tenant.name,
  website: tenant.website,
  tenantAdminUserIds: Array.isArray(tenant.tenantAdminUserIds) ? tenant.tenantAdminUserIds : [],
})

/**
 * Build a cacheable topology snapshot from a Customer document.
 * @param {import('../models/Customer.js').default} customer - Mongoose Customer document
 * @returns {{ _id: string, name: string|null, topology: string, vmfPolicy: string, defaultTenantId: string|null, status: string, isServiceProvider: boolean, licenseLevelId: string|null, entitlements: string[], governance: { maxTenants: number, maxVmfsPerTenant: number, customerAdminUserId: string|null } }}
 */
export const buildCustomerTopologySnapshot = (customer) => ({
  _id: customer._id,
  id: customer.id || normalizeId(customer._id),
  name: customer.name || null,
  topology: customer.topology,
  vmfPolicy: customer.vmfPolicy,
  defaultTenantId: customer.defaultTenantId,
  status: customer.status,
  isServiceProvider: Boolean(customer.isServiceProvider),
  licenseLevelId: customer.licenseLevelId || null,
  entitlements: normalizeFeatureEntitlements(customer.entitlements),
  governance: {
    maxTenants: customer.governance?.maxTenants ?? 1,
    maxVmfsPerTenant: customer.governance?.maxVmfsPerTenant ?? 1,
    customerAdminUserId: customer.governance?.customerAdminUserId || null,
  },
})

/**
 * Build a cacheable entitlement snapshot from a LicenseLevel document.
 * @param {import('../models/LicenseLevel.js').default} licenseLevel - Mongoose LicenseLevel document
 * @returns {{ _id: string, isActive: boolean, featureEntitlements: string[] }}
 */
export const buildLicenseLevelEntitlementSnapshot = (licenseLevel) => ({
  _id: licenseLevel._id,
  id: licenseLevel.id || normalizeId(licenseLevel._id),
  isActive: Boolean(licenseLevel.isActive),
  featureEntitlements: normalizeFeatureEntitlements(licenseLevel.featureEntitlements),
})

/* ------------------------------------------------------------------ */
/*  Namespace-specific accessors                                      */
/* ------------------------------------------------------------------ */

const USER_PERMISSIONS_NAMESPACE = 'user-permissions'
const TENANT_STATUS_NAMESPACE = 'tenant-status'
const CUSTOMER_TOPOLOGY_NAMESPACE = 'customer-topology'
const LICENSE_LEVEL_ENTITLEMENTS_NAMESPACE = 'license-level-entitlements'

const getUserPermissions = async (userId) =>
  // Bypass the local tier for auth-permission data when Redis is available so that
  // role-invalidation from any horizontally-scaled instance takes effect immediately.
  getCachedValue(
    buildKey(USER_PERMISSIONS_NAMESPACE, userId),
    env.userPermissionsCacheTtlSec,
    { skipLocalCache: Boolean(getRedis()) },
  )

const setUserPermissions = async (userId, snapshot) =>
  setCachedValue(
    buildKey(USER_PERMISSIONS_NAMESPACE, userId),
    snapshot,
    env.userPermissionsCacheTtlSec,
    { skipLocalCache: Boolean(getRedis()) },
  )

const invalidateUserPermissions = async (userId) =>
  invalidateCachedValue(buildKey(USER_PERMISSIONS_NAMESPACE, userId))

const invalidateUserPermissionsByIds = async (userIds = []) => {
  const normalizedUserIds = normalizeUserIds(userIds)
  const batchSize = Math.max(1, env.userPermissionsInvalidationBatchSize)
  let invalidatedUserCount = 0
  let redisFailureCount = 0

  for (let index = 0; index < normalizedUserIds.length; index += batchSize) {
    const batch = normalizedUserIds.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map((userId) => invalidateUserPermissions(userId)))

    invalidatedUserCount += batchResults.filter((result) => result?.invalidated).length
    redisFailureCount += batchResults.filter((result) => result?.redisDeleteFailed).length
  }

  return {
    invalidatedUserCount,
    redisFailureCount,
  }
}

const planUserPermissionInvalidationForRoleKey = async (roleKey, options = {}) => {
  const normalizedRoleKey = normalizeRoleKey(roleKey)

  if (!normalizedRoleKey || !env.perfCacheEnabled) {
    return {
      roleKey: normalizedRoleKey,
      affectedUserIds: [],
      affectedUserCount: 0,
      skipped: true,
      globalInvalidation: false,
      globalInvalidationReason: null,
    }
  }

  const fanoutThreshold = Math.max(1, options.fanoutThreshold || env.userPermissionsRoleFanoutThreshold)
  const queryTimeoutMs = Math.max(1, options.queryTimeoutMs || env.userPermissionsRoleQueryTimeoutMs)
  const query = buildAssignedRoleQuery(normalizedRoleKey)

  try {
    let findQuery = User.find(query)

    if (findQuery && typeof findQuery.select === 'function') {
      findQuery = findQuery.select('_id')
    }

    findQuery = applyQueryMaxTimeMs(findQuery, queryTimeoutMs)

    if (findQuery && typeof findQuery.limit === 'function') {
      findQuery = findQuery.limit(fanoutThreshold + 1)
    }

    if (findQuery && typeof findQuery.lean === 'function') {
      findQuery = findQuery.lean()
    }

    const matchingUsers = await findQuery
    const affectedUserIds = normalizeUserIds(matchingUsers)

    if (affectedUserIds.length > fanoutThreshold) {
      let countQuery = User.countDocuments(query)
      countQuery = applyQueryMaxTimeMs(countQuery, queryTimeoutMs)
      const affectedUserCount = await countQuery

      return {
        roleKey: normalizedRoleKey,
        affectedUserIds: [],
        affectedUserCount,
        skipped: false,
        globalInvalidation: true,
        globalInvalidationReason: 'fanout_threshold_exceeded',
      }
    }

    return {
      roleKey: normalizedRoleKey,
      affectedUserIds,
      affectedUserCount: affectedUserIds.length,
      skipped: false,
      globalInvalidation: false,
      globalInvalidationReason: null,
    }
  } catch (err) {
    logger.error(
      {
        err,
        roleKey: normalizedRoleKey,
        fanoutThreshold,
        queryTimeoutMs,
      },
      'user-permission role fan-out query failed; falling back to global invalidation',
    )

    return {
      roleKey: normalizedRoleKey,
      affectedUserIds: [],
      affectedUserCount: 0,
      skipped: false,
      globalInvalidation: true,
      globalInvalidationReason: 'fanout_query_failed',
    }
  }
}

const getUserIdsForRoleKey = async (roleKey, options = {}) => {
  const invalidationPlan = await planUserPermissionInvalidationForRoleKey(roleKey, options)
  return invalidationPlan.affectedUserIds
}

const invalidateUserPermissionsForRoleKey = async (roleKey, options = {}) => {
  const normalizedRoleKey = normalizeRoleKey(roleKey)

  if (!normalizedRoleKey || !env.perfCacheEnabled) {
    return {
      roleKey: normalizedRoleKey,
      affectedUserCount: 0,
      invalidatedUserCount: 0,
      globalInvalidation: false,
      globalInvalidationReason: null,
      redisFailureCount: 0,
      skipped: true,
    }
  }

  const invalidationPlan = options.invalidationPlan || await planUserPermissionInvalidationForRoleKey(
    normalizedRoleKey,
    options,
  )

  if (invalidationPlan.globalInvalidation) {
    logger.warn(
      {
        roleKey: normalizedRoleKey,
        affectedUserCount: invalidationPlan.affectedUserCount,
        reason: invalidationPlan.globalInvalidationReason,
      },
      'user-permission role invalidation escalated to global invalidation',
    )

    const globalInvalidationSummary = await invalidateAllUserPermissions({
      reason: invalidationPlan.globalInvalidationReason,
      roleKey: normalizedRoleKey,
    })

    return {
      roleKey: normalizedRoleKey,
      affectedUserCount: invalidationPlan.affectedUserCount,
      invalidatedUserCount: null,
      globalInvalidation: true,
      globalInvalidationReason: invalidationPlan.globalInvalidationReason,
      redisFailureCount: globalInvalidationSummary.redisPatternDeleteFailed ? 1 : 0,
      skipped: false,
    }
  }

  const affectedUserIds = Array.isArray(options.affectedUserIds)
    ? normalizeUserIds(options.affectedUserIds)
    : invalidationPlan.affectedUserIds
  const affectedUserCount = options.affectedUserCount ?? invalidationPlan.affectedUserCount

  const { invalidatedUserCount, redisFailureCount } = await invalidateUserPermissionsByIds(
    affectedUserIds,
  )

  return {
    roleKey: normalizedRoleKey,
    affectedUserCount,
    invalidatedUserCount,
    globalInvalidation: false,
    globalInvalidationReason: null,
    redisFailureCount,
    skipped: false,
  }
}

// Best-effort global invalidation. Redis SCAN-based deletion is non-atomic,
// so keys written during the sweep can survive until their TTL expires.
// This path is reserved for explicit bulk invalidation and large role fan-out
// fallback, and callers should log when it is used.
const invalidateAllUserPermissions = async (_options = {}) => {
  const localPrefix = `${CACHE_PREFIX}:${USER_PERMISSIONS_NAMESPACE}:`
  deleteLocalCacheByPrefix(localPrefix)
  const redisDeleteSummary = await deleteInRedisByPattern(`${localPrefix}*`)

  return {
    skipped: false,
    redisPatternDeleteFailed: Boolean(redisDeleteSummary.attempted && !redisDeleteSummary.ok),
    deletedKeyCount: redisDeleteSummary.deletedKeyCount || 0,
  }
}

const getTenantStatus = async (tenantId) =>
  getCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId), env.tenantStatusCacheTtlSec)

const setTenantStatus = async (tenantId, snapshot) =>
  setCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId), snapshot, env.tenantStatusCacheTtlSec)

const invalidateTenantStatus = async (tenantId) =>
  invalidateCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId))

const getCustomerTopology = async (customerId) =>
  getCachedValue(
    buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId),
    env.customerTopologyCacheTtlSec,
  )

const setCustomerTopology = async (customerId, snapshot) =>
  setCachedValue(
    buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId),
    snapshot,
    env.customerTopologyCacheTtlSec,
  )

const invalidateCustomerTopology = async (customerId) =>
  invalidateCachedValue(buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId))

const getLicenseLevelEntitlements = async (licenseLevelId) =>
  getCachedValue(
    buildKey(LICENSE_LEVEL_ENTITLEMENTS_NAMESPACE, licenseLevelId),
    env.customerTopologyCacheTtlSec,
  )

const setLicenseLevelEntitlements = async (licenseLevelId, snapshot) =>
  setCachedValue(
    buildKey(LICENSE_LEVEL_ENTITLEMENTS_NAMESPACE, licenseLevelId),
    snapshot,
    env.customerTopologyCacheTtlSec,
  )

const invalidateLicenseLevelEntitlements = async (licenseLevelId) =>
  invalidateCachedValue(buildKey(LICENSE_LEVEL_ENTITLEMENTS_NAMESPACE, licenseLevelId))

/* ------------------------------------------------------------------ */
/*  Cache warming                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pre-populate all three cache tiers from the database.
 * @param {{ userLimit?: number, tenantLimit?: number, customerLimit?: number }} options
 * @returns {Promise<{ skipped: boolean, warmedUsers?: number, warmedTenants?: number, warmedCustomers?: number }>}
 */
const warmAuthorizationCaches = async (options = {}) => {
  if (!env.perfCacheEnabled) {
    return { skipped: true, reason: 'PERF_CACHE_ENABLED=false' }
  }

  const userLimit = Math.max(1, options.userLimit || env.cacheWarmUserLimit)
  const tenantLimit = Math.max(1, options.tenantLimit || env.cacheWarmTenantLimit)
  const customerLimit = Math.max(1, options.customerLimit || env.cacheWarmCustomerLimit)

  const [users, tenants, customers, licenseLevels] = await Promise.all([
    User.find({ isActive: true })
      .sort({ updatedAt: -1 })
      .limit(userLimit)
      .select('_id email name isActive memberships tenantMemberships vmfGrants')
      .lean(),
    Tenant.find({})
      .sort({ updatedAt: -1 })
      .limit(tenantLimit)
      .select('_id customerId status isDefault name website tenantAdminUserIds')
      .lean(),
    Customer.find({})
      .sort({ updatedAt: -1 })
      .limit(customerLimit)
      .select('_id topology vmfPolicy defaultTenantId status isServiceProvider licenseLevelId entitlements governance')
      .lean(),
    LicenseLevel.find({ isActive: true })
      .sort({ updatedAt: -1 })
      .limit(customerLimit)
      .select('_id isActive featureEntitlements')
      .lean(),
  ])

  await Promise.all([
    ...users.map(async (user) => setUserPermissions(user._id, await buildUserPermissionsSnapshot(user))),
    ...tenants.map((tenant) => setTenantStatus(tenant._id, buildTenantStatusSnapshot(tenant))),
    ...customers.map((customer) =>
      setCustomerTopology(customer._id, buildCustomerTopologySnapshot(customer)),
    ),
    ...licenseLevels.map((licenseLevel) =>
      setLicenseLevelEntitlements(
        licenseLevel._id,
        buildLicenseLevelEntitlementSnapshot(licenseLevel),
      )),
  ])

  return {
    skipped: false,
    warmedUsers: users.length,
    warmedTenants: tenants.length,
    warmedCustomers: customers.length,
    warmedLicenseLevels: licenseLevels.length,
  }
}

/* ------------------------------------------------------------------ */
/*  Test helpers & export                                             */
/* ------------------------------------------------------------------ */

const resetForTests = async () => {
  LOCAL_CACHE.clear()
}

const performanceCacheService = {
  isEnabled: () => env.perfCacheEnabled,
  getUserPermissions,
  setUserPermissions,
  planUserPermissionInvalidationForRoleKey,
  getUserIdsForRoleKey,
  invalidateUserPermissions,
  invalidateUserPermissionsForRoleKey,
  invalidateAllUserPermissions,
  getTenantStatus,
  setTenantStatus,
  invalidateTenantStatus,
  getCustomerTopology,
  setCustomerTopology,
  invalidateCustomerTopology,
  getLicenseLevelEntitlements,
  setLicenseLevelEntitlements,
  invalidateLicenseLevelEntitlements,
  warmAuthorizationCaches,
  resetForTests,
}

export default performanceCacheService
