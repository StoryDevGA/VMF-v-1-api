import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.PERF_CACHE_ENABLED = 'true'
  process.env.USER_PERMISSIONS_CACHE_TTL_SEC = '300'
  process.env.TENANT_STATUS_CACHE_TTL_SEC = '60'
  process.env.CUSTOMER_TOPOLOGY_CACHE_TTL_SEC = '900'
  process.env.BACKGROUND_JOBS_ENABLED = 'true'
  process.env.BACKGROUND_JOB_CONCURRENCY = '2'
  process.env.MONGO_MIN_POOL_SIZE = '10'
  process.env.MONGO_MAX_POOL_SIZE = '100'
})

let env
let User
let Tenant
let performanceCacheService
let jobQueueService
let loadScopes
let requireTenantEnabled

const USER_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'

const makeReq = (overrides = {}) => ({
  requestId: 'req-perf-001',
  context: { userId: USER_ID },
  userId: USER_ID,
  params: {},
  scopes: {},
  ...overrides,
})

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(data) {
      res.body = data
      return res
    },
  }
  return res
}

beforeAll(async () => {
  env = (await import('../config/env.js')).default
  const models = await import('../models/index.js')
  User = models.User
  Tenant = models.Tenant
  performanceCacheService = (await import('../services/performanceCacheService.js')).default
  jobQueueService = (await import('../services/jobQueueService.js')).default
  loadScopes = (await import('../middleware/loadScopes.js')).default
  requireTenantEnabled = (await import('../middleware/tenantStatus.js')).default
})

beforeEach(async () => {
  await performanceCacheService.resetForTests()
  jobQueueService.resetForTests()
  User.findById = jest.fn()
  Tenant.findById = jest.fn()
})

afterEach(async () => {
  await jobQueueService.stop({ drain: false })
})

describe('Performance configuration', () => {
  test('loads optimized Mongo and cache settings from env', () => {
    expect(env.mongoMinPoolSize).toBe(10)
    expect(env.mongoMaxPoolSize).toBe(100)
    expect(env.userPermissionsCacheTtlSec).toBe(300)
    expect(env.tenantStatusCacheTtlSec).toBe(60)
    expect(env.customerTopologyCacheTtlSec).toBe(900)
    expect(env.backgroundJobConcurrency).toBe(2)
  })

  test('enforces minPoolSize <= maxPoolSize constraint', () => {
    expect(env.mongoMinPoolSize).toBeGreaterThanOrEqual(1)
    expect(env.mongoMaxPoolSize).toBeGreaterThanOrEqual(env.mongoMinPoolSize)
  })

  test('loads background job interval defaults', () => {
    expect(env.identityPlusReconciliationIntervalMs).toBeGreaterThanOrEqual(1000)
    expect(env.auditArchivalIntervalMs).toBeGreaterThanOrEqual(1000)
    expect(env.cacheWarmingIntervalMs).toBeGreaterThanOrEqual(1000)
  })
})

describe('performanceCacheService', () => {
  test('stores and invalidates user permissions cache entries', async () => {
    const snapshot = {
      user: { _id: USER_ID, isActive: true },
      memberships: [],
      tenantMemberships: [],
      vmfGrants: [],
      platformRoles: ['SUPER_ADMIN'],
      isPlatformUser: true,
      isActive: true,
    }

    await performanceCacheService.setUserPermissions(USER_ID, snapshot)
    const cached = await performanceCacheService.getUserPermissions(USER_ID)
    expect(cached).toEqual(snapshot)

    await performanceCacheService.invalidateUserPermissions(USER_ID)
    const afterInvalidate = await performanceCacheService.getUserPermissions(USER_ID)
    expect(afterInvalidate).toBeNull()
  })

  test('stores and invalidates tenant status cache entries', async () => {
    const tenantSnapshot = {
      _id: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: 'ENABLED',
      isDefault: false,
      name: 'Tenant One',
      website: 'https://tenant.one',
      tenantAdminUserIds: [],
    }

    await performanceCacheService.setTenantStatus(TENANT_ID, tenantSnapshot)
    expect(await performanceCacheService.getTenantStatus(TENANT_ID)).toEqual(tenantSnapshot)

    await performanceCacheService.invalidateTenantStatus(TENANT_ID)
    expect(await performanceCacheService.getTenantStatus(TENANT_ID)).toBeNull()
  })

  test('stores and invalidates customer topology cache entries', async () => {
    const customerSnapshot = {
      _id: CUSTOMER_ID,
      topology: 'MULTI_TENANT',
      vmfPolicy: 'PER_TENANT_MULTI',
      defaultTenantId: null,
      status: 'ACTIVE',
      isServiceProvider: false,
    }

    await performanceCacheService.setCustomerTopology(CUSTOMER_ID, customerSnapshot)
    expect(await performanceCacheService.getCustomerTopology(CUSTOMER_ID)).toEqual(customerSnapshot)

    await performanceCacheService.invalidateCustomerTopology(CUSTOMER_ID)
    expect(await performanceCacheService.getCustomerTopology(CUSTOMER_ID)).toBeNull()
  })

  test('invalidateAllUserPermissions clears all user entries', async () => {
    const snapshotA = { user: { _id: 'aaa' }, platformRoles: [], isActive: true }
    const snapshotB = { user: { _id: 'bbb' }, platformRoles: [], isActive: true }

    await performanceCacheService.setUserPermissions('aaa', snapshotA)
    await performanceCacheService.setUserPermissions('bbb', snapshotB)

    expect(await performanceCacheService.getUserPermissions('aaa')).toEqual(snapshotA)
    expect(await performanceCacheService.getUserPermissions('bbb')).toEqual(snapshotB)

    await performanceCacheService.invalidateAllUserPermissions()

    expect(await performanceCacheService.getUserPermissions('aaa')).toBeNull()
    expect(await performanceCacheService.getUserPermissions('bbb')).toBeNull()
  })

  test('isEnabled reflects the perfCacheEnabled config', () => {
    expect(typeof performanceCacheService.isEnabled()).toBe('boolean')
  })
})

describe('Snapshot builders', () => {
  let buildUserPermissionsSnapshot, buildTenantStatusSnapshot, buildCustomerTopologySnapshot

  beforeAll(async () => {
    const mod = await import('../services/performanceCacheService.js')
    buildUserPermissionsSnapshot = mod.buildUserPermissionsSnapshot
    buildTenantStatusSnapshot = mod.buildTenantStatusSnapshot
    buildCustomerTopologySnapshot = mod.buildCustomerTopologySnapshot
  })

  test('buildUserPermissionsSnapshot extracts platform roles', () => {
    const user = {
      _id: USER_ID,
      email: 'super@test.com',
      name: 'Super',
      isActive: true,
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
      tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
      vmfGrants: [],
    }

    const snap = buildUserPermissionsSnapshot(user)
    expect(snap.platformRoles).toEqual(['SUPER_ADMIN'])
    expect(snap.isPlatformUser).toBe(true)
    expect(snap.isActive).toBe(true)
    expect(snap.memberships).toHaveLength(2)
    expect(snap.tenantMemberships).toHaveLength(1)
  })

  test('buildUserPermissionsSnapshot handles user with no memberships', () => {
    const user = { _id: 'x', email: 'x@test.com', name: 'X', isActive: false }
    const snap = buildUserPermissionsSnapshot(user)
    expect(snap.platformRoles).toEqual([])
    expect(snap.isPlatformUser).toBe(false)
    expect(snap.isActive).toBe(false)
    expect(snap.memberships).toEqual([])
  })

  test('buildTenantStatusSnapshot returns correct shape', () => {
    const tenant = {
      _id: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: 'ENABLED',
      isDefault: true,
      name: 'Default Tenant',
      website: 'https://example.com',
      tenantAdminUserIds: [USER_ID],
    }

    const snap = buildTenantStatusSnapshot(tenant)
    expect(snap._id).toBe(TENANT_ID)
    expect(snap.status).toBe('ENABLED')
    expect(snap.isDefault).toBe(true)
    expect(snap.tenantAdminUserIds).toEqual([USER_ID])
  })

  test('buildCustomerTopologySnapshot returns correct shape', () => {
    const customer = {
      _id: CUSTOMER_ID,
      topology: 'SINGLE_TENANT',
      vmfPolicy: 'PER_TENANT_SINGLE',
      defaultTenantId: TENANT_ID,
      status: 'ACTIVE',
      isServiceProvider: true,
    }

    const snap = buildCustomerTopologySnapshot(customer)
    expect(snap._id).toBe(CUSTOMER_ID)
    expect(snap.topology).toBe('SINGLE_TENANT')
    expect(snap.isServiceProvider).toBe(true)
    expect(snap.defaultTenantId).toBe(TENANT_ID)
  })
})

describe('Middleware cache usage', () => {
  test('loadScopes uses cached user permissions after first lookup', async () => {
    const user = {
      _id: USER_ID,
      email: 'admin@example.com',
      name: 'Admin',
      isActive: true,
      memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
      tenantMemberships: [],
      vmfGrants: [],
    }

    User.findById.mockResolvedValue(user)

    const req1 = makeReq({ scopes: undefined })
    const res1 = makeRes()
    const next1 = jest.fn()
    await loadScopes(req1, res1, next1)
    expect(next1).toHaveBeenCalled()
    expect(User.findById).toHaveBeenCalledTimes(1)

    User.findById.mockImplementation(() => {
      throw new Error('loadScopes should use cache on second call')
    })

    const req2 = makeReq({ scopes: undefined })
    const res2 = makeRes()
    const next2 = jest.fn()
    await loadScopes(req2, res2, next2)
    expect(next2).toHaveBeenCalled()
    expect(req2.scopes.platformRoles).toEqual(['SUPER_ADMIN'])
  })

  test('requireTenantEnabled uses cached tenant status after first lookup', async () => {
    Tenant.findById.mockResolvedValue({
      _id: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: 'ENABLED',
      isDefault: false,
      name: 'Tenant One',
      website: 'https://tenant.one',
      tenantAdminUserIds: [],
    })

    const req1 = makeReq({ params: { tenantId: TENANT_ID }, scopes: {} })
    const res1 = makeRes()
    const next1 = jest.fn()
    await requireTenantEnabled(req1, res1, next1)
    expect(next1).toHaveBeenCalled()
    expect(Tenant.findById).toHaveBeenCalledTimes(1)

    Tenant.findById.mockImplementation(() => {
      throw new Error('tenant lookup should hit cache on second call')
    })

    const req2 = makeReq({ params: { tenantId: TENANT_ID }, scopes: {} })
    const res2 = makeRes()
    const next2 = jest.fn()
    await requireTenantEnabled(req2, res2, next2)
    expect(next2).toHaveBeenCalled()
  })

  test('loadScopes returns 401 for disabled user in cache', async () => {
    const snapshot = {
      user: { _id: USER_ID, isActive: false },
      memberships: [],
      tenantMemberships: [],
      vmfGrants: [],
      platformRoles: [],
      isPlatformUser: false,
      isActive: false,
    }

    await performanceCacheService.setUserPermissions(USER_ID, snapshot)

    const req = makeReq({ scopes: undefined })
    const res = makeRes()
    const next = jest.fn()
    await loadScopes(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_DISABLED')
  })

  test('loadScopes returns 401 when user not found in DB', async () => {
    User.findById.mockResolvedValue(null)

    const req = makeReq({ scopes: undefined })
    const res = makeRes()
    const next = jest.fn()
    await loadScopes(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('requireTenantEnabled rejects DISABLED tenant', async () => {
    Tenant.findById.mockResolvedValue({
      _id: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: 'DISABLED',
      isDefault: false,
      name: 'Disabled Tenant',
      website: null,
      tenantAdminUserIds: [],
    })

    const req = makeReq({ params: { tenantId: TENANT_ID }, scopes: {} })
    const res = makeRes()
    const next = jest.fn()
    await requireTenantEnabled(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
  })
})

describe('jobQueueService', () => {
  test('processes background jobs', async () => {
    const executed = []
    jobQueueService.start({ concurrency: 2 })

    await Promise.all([
      jobQueueService.enqueue('job-a', async () => {
        executed.push('job-a')
      }),
      jobQueueService.enqueue('job-b', async () => {
        executed.push('job-b')
      }),
    ])

    expect(executed).toHaveLength(2)
    expect(executed).toEqual(expect.arrayContaining(['job-a', 'job-b']))
  })

  test('getState returns queue status', () => {
    const state = jobQueueService.getState()
    expect(state).toHaveProperty('isRunning')
    expect(state).toHaveProperty('workerConcurrency')
    expect(state).toHaveProperty('activeWorkers')
    expect(state).toHaveProperty('queuedJobs')
    expect(typeof state.isRunning).toBe('boolean')
  })

  test('rejects when handler throws', async () => {
    jobQueueService.start({ concurrency: 1 })

    await expect(
      jobQueueService.enqueue('fail-job', async () => {
        throw new Error('deliberate failure')
      }),
    ).rejects.toThrow('deliberate failure')
  })

  test('resetForTests clears state', () => {
    jobQueueService.start({ concurrency: 2 })
    jobQueueService.resetForTests()
    const state = jobQueueService.getState()
    expect(state.isRunning).toBe(false)
    expect(state.queuedJobs).toBe(0)
  })

  test('stop without drain clears pending jobs', async () => {
    jobQueueService.start({ concurrency: 1 })
    await jobQueueService.stop({ drain: false })
    const state = jobQueueService.getState()
    expect(state.isRunning).toBe(false)
  })
})

describe('backgroundJobService', () => {
  let startBackgroundJobs, stopBackgroundJobs, runBackgroundJobNow

  beforeAll(async () => {
    const mod = await import('../services/backgroundJobService.js')
    startBackgroundJobs = mod.startBackgroundJobs
    stopBackgroundJobs = mod.stopBackgroundJobs
    runBackgroundJobNow = mod.runBackgroundJobNow
  })

  test('runBackgroundJobNow rejects unknown job name', async () => {
    await expect(runBackgroundJobNow('nonexistent-job')).rejects.toThrow(
      'Unknown background job: nonexistent-job',
    )
  })
})
