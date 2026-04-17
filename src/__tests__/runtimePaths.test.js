import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'
import { buildRuntimePathRegistryStableId } from '../models/RuntimePathRegistry.js'
import { __testables as runtimePathControllerTestables } from '../controllers/runtimePaths.controller.js'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const NON_ADMIN_ID = '507f1f77bcf86cd799439012'
const RUNTIME_PATH_STABLE_ID = buildRuntimePathRegistryStableId('vmf.validation.status')

const makeFakeUser = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function save() {
    return this
  }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const buildRoleQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: [
      'PLATFORM_MANAGE',
      'SYSTEM_HEALTH_VIEW',
      'CUSTOMER_CREATE',
      'CUSTOMER_UPDATE',
      'CUSTOMER_VIEW',
      'ROLE_MANAGE',
      'AUDIT_VIEW_ALL',
    ],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_VIEW'],
    isActive: true,
  },
])

const buildRuntimePathQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildRuntimeSkillFindChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildFindByStableIdQuery = (resolvedValue) => {
  const query = {
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  }

  query.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected)

  return query
}

let app
let request
let tokenService
let User
let Role
let RuntimePathRegistry
let RuntimeSkill
let mockRedisClient

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

beforeAll(async () => {
  mockRedisClient = {
    set: jest.fn(),
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  }

  await jest.unstable_mockModule('../config/redis.js', () => ({
    connectRedis: jest.fn(),
    getRedis: jest.fn(() => mockRedisClient),
    isRedisConnected: jest.fn(() => true),
    disconnectRedis: jest.fn(),
  }))

  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  RuntimePathRegistry = models.RuntimePathRegistry
  RuntimeSkill = models.RuntimeSkill
})

afterAll(() => {})

beforeEach(() => {
  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === SUPER_ADMIN_ID) {
      return Promise.resolve(makeFakeUser())
    }

    if (userId === NON_ADMIN_ID) {
      return Promise.resolve(
        makeFakeUser({
          _id: NON_ADMIN_ID,
          id: NON_ADMIN_ID,
          email: 'user@storylineos.com',
          memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
        }),
      )
    }

    return Promise.resolve(null)
  })

  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  RuntimePathRegistry.find = jest.fn()
  RuntimePathRegistry.countDocuments = jest.fn()
  RuntimePathRegistry.findByStableId = jest.fn()
  RuntimeSkill.find = jest.fn()

  RuntimePathRegistry.countDocuments.mockResolvedValue(0)
  RuntimePathRegistry.find.mockReturnValue(buildRuntimePathQueryChain([]))
})

describe('Runtime Path Registry API', () => {
  test('GET /api/v1/super-admin/runtime-control/runtime-paths returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/runtime-paths')
    expect(res.status).toBe(401)
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({ _id: NON_ADMIN_ID, id: NON_ADMIN_ID }))
    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-paths')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths returns paginated runtime paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.countDocuments.mockResolvedValue(1)
    RuntimePathRegistry.find.mockReturnValue(
      buildRuntimePathQueryChain([
        {
          stableId: RUNTIME_PATH_STABLE_ID,
          pathKey: 'vmf.validation.status',
          label: 'VMF Validation Status',
          description: 'Validation status output for VMF runs.',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          scope: 'VALIDATION_RESULT',
          allowedOperations: ['READ', 'WRITE', 'BIND'],
          dataType: 'ENUM',
          category: 'VALIDATION',
          sourceType: 'DERIVED',
          isProtected: false,
          isSystem: true,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
      ]),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-paths?page=1&pageSize=20&frameworkKey=VMF&operation=READ')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data[0]?.pathKey).toBe('vmf.validation.status')
    expect(res.body.meta?.page).toBe(1)
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths supports isProtected filter', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.countDocuments.mockResolvedValue(0)

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-paths?page=1&pageSize=20&isProtected=true')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimePathRegistry.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ isProtected: true }))
    expect(RuntimePathRegistry.find).toHaveBeenCalledWith(expect.objectContaining({ isProtected: true }))
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths/:pathId returns 404 when missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(null))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-paths/path-does-not-exist')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths/:pathId returns runtime path details', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery({
      stableId: RUNTIME_PATH_STABLE_ID,
      pathKey: 'vmf.validation.status',
      label: 'VMF Validation Status',
      description: 'Validation status output for VMF runs.',
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      scope: 'VALIDATION_RESULT',
      allowedOperations: ['READ', 'WRITE', 'BIND'],
      dataType: 'ENUM',
      category: 'VALIDATION',
      sourceType: 'DERIVED',
      isProtected: false,
      isSystem: true,
      createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
    }))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.pathKey).toBe('vmf.validation.status')
    expect(res.body.data?.label).toBe('VMF Validation Status')
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths/:pathId/dependencies returns skill dependencies', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery({
      stableId: RUNTIME_PATH_STABLE_ID,
      pathKey: 'vmf.validation.status',
    }))

    RuntimeSkill.find.mockReturnValue(
      buildRuntimeSkillFindChain([
        { stableId: 'skill-snapshot', key: 'snapshot', name: 'Snapshot', status: 'ACTIVE' },
      ]),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.dependencies?.skillIds).toEqual(['skill-snapshot'])
  })

  test('buildListFilter uses compact regex search plus exact enum matches for query tokens', () => {
    const filter = runtimePathControllerTestables.buildListFilter({ q: 'validation_result' })

    expect(filter.$or).toEqual(expect.arrayContaining([
      { scope: 'VALIDATION_RESULT' },
    ]))
    expect(filter.$or).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ frameworkKeys: expect.anything() }),
    ]))
  })
})
