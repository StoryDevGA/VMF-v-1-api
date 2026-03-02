/**
 * Performance Cache Service (Phase 5.3)
 *
 * Two-tier caching layer (in-memory Map + Redis) for hot authorization data:
 *   - User permissions   — 5-minute TTL (platform roles, memberships, grants)
 *   - Tenant status      — 1-minute TTL (status, isDefault, admins)
 *   - Customer topology  — 15-minute TTL (topology, vmfPolicy, service provider flag)
 *
 * Provides:
 *   - get / set / invalidate per namespace
 *   - `invalidateAllUserPermissions()` — bulk wipe (e.g. VMF delete)
 *   - `warmAuthorizationCaches()`      — pre-populate from DB on startup / interval
 *   - Snapshot builders exported for use by middleware and controllers
 *
 * Cache reads: local Map → Redis → null.  Cache writes: local Map + Redis.
 * All operations are no-op when `PERF_CACHE_ENABLED=false` (default in test).
 */

import env from '../config/env.js'
import logger from '../config/logger.js'
import { getRedis } from '../config/redis.js'
import { Customer, Tenant, User } from '../models/index.js'

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

const buildKey = (namespace, id) => `${CACHE_PREFIX}:${namespace}:${normalizeId(id)}`
const now = () => Date.now()

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
  if (!redis) return
  try {
    await redis.del(key)
  } catch (err) {
    logger.warn({ err, key }, 'performance cache redis delete failed')
  }
}

const deleteInRedisByPattern = async (pattern) => {
  const redis = getRedis()
  if (!redis) return

  try {
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } while (cursor !== '0')
  } catch (err) {
    logger.warn({ err, pattern }, 'performance cache redis pattern delete failed')
  }
}

/* ------------------------------------------------------------------ */
/*  Generic cache operations                                          */
/* ------------------------------------------------------------------ */

const getCachedValue = async (key) => {
  if (!env.perfCacheEnabled) return null

  const localValue = readLocalCache(key)
  if (localValue !== null) return localValue

  const redisValue = await getFromRedis(key)
  if (redisValue !== null) {
    writeLocalCache(key, redisValue, 5)
  }
  return redisValue
}

const setCachedValue = async (key, value, ttlSeconds) => {
  if (!env.perfCacheEnabled) return
  writeLocalCache(key, value, ttlSeconds)
  await setInRedis(key, value, ttlSeconds)
}

const invalidateCachedValue = async (key) => {
  deleteLocalCache(key)
  await deleteInRedis(key)
}

/* ------------------------------------------------------------------ */
/*  Snapshot builders                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a cacheable permissions snapshot from a User document.
 * @param {import('../models/User.js').default} user - Mongoose User document
 * @returns {{ user: object, memberships: Array, tenantMemberships: Array, vmfGrants: Array, platformRoles: string[], isPlatformUser: boolean, isActive: boolean }}
 */
export const buildUserPermissionsSnapshot = (user) => {
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
 * @returns {{ _id: string, topology: string, vmfPolicy: string, defaultTenantId: string|null, status: string, isServiceProvider: boolean, licenseLevelId: string|null, governance: { maxTenants: number, maxVmfsPerTenant: number, customerAdminUserId: string|null } }}
 */
export const buildCustomerTopologySnapshot = (customer) => ({
  _id: customer._id,
  id: customer.id || normalizeId(customer._id),
  topology: customer.topology,
  vmfPolicy: customer.vmfPolicy,
  defaultTenantId: customer.defaultTenantId,
  status: customer.status,
  isServiceProvider: Boolean(customer.isServiceProvider),
  licenseLevelId: customer.licenseLevelId || null,
  governance: {
    maxTenants: customer.governance?.maxTenants ?? 1,
    maxVmfsPerTenant: customer.governance?.maxVmfsPerTenant ?? 1,
    customerAdminUserId: customer.governance?.customerAdminUserId || null,
  },
})

/* ------------------------------------------------------------------ */
/*  Namespace-specific accessors                                      */
/* ------------------------------------------------------------------ */

const USER_PERMISSIONS_NAMESPACE = 'user-permissions'
const TENANT_STATUS_NAMESPACE = 'tenant-status'
const CUSTOMER_TOPOLOGY_NAMESPACE = 'customer-topology'

const getUserPermissions = async (userId) =>
  getCachedValue(buildKey(USER_PERMISSIONS_NAMESPACE, userId))

const setUserPermissions = async (userId, snapshot) =>
  setCachedValue(
    buildKey(USER_PERMISSIONS_NAMESPACE, userId),
    snapshot,
    env.userPermissionsCacheTtlSec,
  )

const invalidateUserPermissions = async (userId) =>
  invalidateCachedValue(buildKey(USER_PERMISSIONS_NAMESPACE, userId))

const invalidateAllUserPermissions = async () => {
  const localPrefix = `${CACHE_PREFIX}:${USER_PERMISSIONS_NAMESPACE}:`
  deleteLocalCacheByPrefix(localPrefix)
  await deleteInRedisByPattern(`${localPrefix}*`)
}

const getTenantStatus = async (tenantId) =>
  getCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId))

const setTenantStatus = async (tenantId, snapshot) =>
  setCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId), snapshot, env.tenantStatusCacheTtlSec)

const invalidateTenantStatus = async (tenantId) =>
  invalidateCachedValue(buildKey(TENANT_STATUS_NAMESPACE, tenantId))

const getCustomerTopology = async (customerId) =>
  getCachedValue(buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId))

const setCustomerTopology = async (customerId, snapshot) =>
  setCachedValue(
    buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId),
    snapshot,
    env.customerTopologyCacheTtlSec,
  )

const invalidateCustomerTopology = async (customerId) =>
  invalidateCachedValue(buildKey(CUSTOMER_TOPOLOGY_NAMESPACE, customerId))

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

  const [users, tenants, customers] = await Promise.all([
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
      .select('_id topology vmfPolicy defaultTenantId status isServiceProvider licenseLevelId governance')
      .lean(),
  ])

  await Promise.all([
    ...users.map((user) => setUserPermissions(user._id, buildUserPermissionsSnapshot(user))),
    ...tenants.map((tenant) => setTenantStatus(tenant._id, buildTenantStatusSnapshot(tenant))),
    ...customers.map((customer) =>
      setCustomerTopology(customer._id, buildCustomerTopologySnapshot(customer)),
    ),
  ])

  return {
    skipped: false,
    warmedUsers: users.length,
    warmedTenants: tenants.length,
    warmedCustomers: customers.length,
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
  invalidateUserPermissions,
  invalidateAllUserPermissions,
  getTenantStatus,
  setTenantStatus,
  invalidateTenantStatus,
  getCustomerTopology,
  setCustomerTopology,
  invalidateCustomerTopology,
  warmAuthorizationCaches,
  resetForTests,
}

export default performanceCacheService
