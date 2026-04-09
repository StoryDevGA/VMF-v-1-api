import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'

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
const RUNTIME_SKILL_DB_ID = '607f1f77bcf86cd799439041'
const RUNTIME_SKILL_STABLE_ID = 'skill-snapshot'

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

const buildRuntimeSkillQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

let app
let request
let tokenService
let User
let Role
let RuntimeSkill
let AuditLog
let originalRuntimeSkillSave
let originalRuntimeSkillPopulate

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  RuntimeSkill.findOne.mockReturnValue({ select })
  return select
}

const makeRuntimeSkillDoc = (overrides = {}) => {
  const runtimeSkill = new RuntimeSkill({
    _id: RUNTIME_SKILL_DB_ID,
    stableId: RUNTIME_SKILL_STABLE_ID,
    key: 'snapshot',
    name: 'Snapshot',
    description: 'Captures runtime state at workflow checkpoints.',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['VMF', 'RLD'],
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  runtimeSkill.save = jest.fn(async function save() {
    return this
  })
  runtimeSkill.populate = jest.fn(async function populate() {
    return this
  })

  return runtimeSkill
}

beforeAll(async () => {
  const mockRedisClient = {
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
  RuntimeSkill = models.RuntimeSkill
  AuditLog = models.AuditLog

  originalRuntimeSkillSave = RuntimeSkill.prototype.save
  originalRuntimeSkillPopulate = RuntimeSkill.prototype.populate
})

afterAll(() => {
  RuntimeSkill.prototype.save = originalRuntimeSkillSave
  RuntimeSkill.prototype.populate = originalRuntimeSkillPopulate
})

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

  RuntimeSkill.find = jest.fn()
  RuntimeSkill.countDocuments = jest.fn()
  RuntimeSkill.findOne = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  RuntimeSkill.prototype.save = jest.fn(async function save() {
    return this
  })
  RuntimeSkill.prototype.populate = jest.fn(async function populate() {
    return this
  })

  RuntimeSkill.countDocuments.mockResolvedValue(0)
  RuntimeSkill.find.mockReturnValue(buildRuntimeSkillQueryChain([]))
  RuntimeSkill.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })

  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Runtime Skill Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/skills returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/skills')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/skills returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('GET /api/v1/super-admin/runtime-control/skills returns paginated rows with framework filtering', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        stableId: 'skill-revenue-map',
        key: 'revenue-map',
        name: 'Revenue Map',
        description: 'Builds revenue lifecycle mapping outputs.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['RLD'],
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    RuntimeSkill.countDocuments.mockResolvedValue(1)
    RuntimeSkill.find.mockReturnValue(buildRuntimeSkillQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skills?page=1&pageSize=4&frameworkKey=RLD&status=ACTIVE&q=revenue')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeSkill.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        supportedFrameworkKeys: 'RLD',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'skill-revenue-map',
      key: 'revenue-map',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['RLD'],
    })
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      version: 'v1',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/skills returns 422 for invalid payloads', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'Snapshot',
        name: '',
        supportedFrameworkKeys: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.name).toBe('Skill name is required')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('At least one supported framework key is required.')
  })

  test('POST /api/v1/super-admin/runtime-control/skills returns 409 when the key already exists', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: RUNTIME_SKILL_DB_ID })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'snapshot',
        name: 'Snapshot',
        description: 'Duplicate snapshot skill.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'key',
      reason: 'RUNTIME_SKILL_KEY_CONFLICT',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/skills creates a runtime skill and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'Summary',
        name: 'Summary',
        description: 'Generates concise runtime summaries.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['vmf', 'RLD', 'VMF'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'skill-summary',
      key: 'summary',
      name: 'Summary',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_SKILL_CREATED',
        resourceType: 'RuntimeSkill',
      }),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/skills/:skillId returns the runtime skill detail payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeSkill = makeRuntimeSkillDoc()
    RuntimeSkill.findOne.mockResolvedValue(runtimeSkill)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/skills/${RUNTIME_SKILL_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'skill-snapshot',
      key: 'snapshot',
      name: 'Snapshot',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/skills/:skillId updates the runtime skill and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeSkill = makeRuntimeSkillDoc()

    RuntimeSkill.findOne
      .mockResolvedValueOnce(runtimeSkill)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/skills/${RUNTIME_SKILL_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Runtime Snapshot',
        status: 'INACTIVE',
        supportedFrameworkKeys: ['VMF'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'skill-snapshot',
      key: 'snapshot',
      name: 'Runtime Snapshot',
      status: 'INACTIVE',
      supportedFrameworkKeys: ['VMF'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_SKILL_UPDATED',
        resourceType: 'RuntimeSkill',
      }),
    )
  })
})
