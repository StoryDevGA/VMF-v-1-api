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
const RUNTIME_AGENT_DB_ID = '607f1f77bcf86cd799439031'
const RUNTIME_AGENT_STABLE_ID = 'agent-validator'

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

const buildFrameworkRegistryLookupChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildRuntimeAgentQueryChain = (rows) => ({
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
let FrameworkRegistry
let RuntimeAgent
let AuditLog
let originalRuntimeAgentSave
let originalRuntimeAgentPopulate

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  RuntimeAgent.findOne.mockReturnValue({ select })
  return select
}

const makeRuntimeAgentDoc = (overrides = {}) => {
  const runtimeAgent = new RuntimeAgent({
    _id: RUNTIME_AGENT_DB_ID,
    stableId: RUNTIME_AGENT_STABLE_ID,
    key: 'validator',
    name: 'Validator',
    description: 'Runs baseline validation rules for compatible frameworks.',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['VMF', 'RLD'],
    defaultSkillIds: ['skill-snapshot'],
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  runtimeAgent.save = jest.fn(async function save() {
    return this
  })
  runtimeAgent.populate = jest.fn(async function populate() {
    return this
  })

  return runtimeAgent
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
  FrameworkRegistry = models.FrameworkRegistry
  RuntimeAgent = models.RuntimeAgent
  AuditLog = models.AuditLog

  originalRuntimeAgentSave = RuntimeAgent.prototype.save
  originalRuntimeAgentPopulate = RuntimeAgent.prototype.populate
})

afterAll(() => {
  RuntimeAgent.prototype.save = originalRuntimeAgentSave
  RuntimeAgent.prototype.populate = originalRuntimeAgentPopulate
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

  RuntimeAgent.find = jest.fn()
  RuntimeAgent.countDocuments = jest.fn()
  RuntimeAgent.findOne = jest.fn()
  FrameworkRegistry.find = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  RuntimeAgent.prototype.save = jest.fn(async function save() {
    return this
  })
  RuntimeAgent.prototype.populate = jest.fn(async function populate() {
    return this
  })

  RuntimeAgent.countDocuments.mockResolvedValue(0)
  RuntimeAgent.find.mockReturnValue(buildRuntimeAgentQueryChain([]))
  RuntimeAgent.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  FrameworkRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
    {
      frameworkKey: 'VMF',
      name: 'Value Management Framework',
      supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
      status: 'ACTIVE',
    },
    {
      frameworkKey: 'RLD',
      name: 'Revenue Lifecycle Design',
      supportedWorkflowKeys: ['rld-baseline', 'rld-publish'],
      status: 'ACTIVE',
    },
  ]))

  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Runtime Agent Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/agents returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/agents')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/agents returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('GET /api/v1/super-admin/runtime-control/agents returns paginated rows with framework filtering', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        stableId: 'agent-readiness-check',
        key: 'readiness-check',
        name: 'Readiness Check',
        description: 'Evaluates RLD readiness milestones before activation.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['RLD'],
        defaultSkillIds: ['skill-snapshot'],
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    RuntimeAgent.countDocuments.mockResolvedValue(1)
    RuntimeAgent.find.mockReturnValue(buildRuntimeAgentQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/agents?page=1&pageSize=4&frameworkKey=RLD&status=ACTIVE&q=readiness')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeAgent.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        supportedFrameworkKeys: 'RLD',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'agent-readiness-check',
      key: 'readiness-check',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['RLD'],
      defaultSkillIds: ['skill-snapshot'],
    })
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      version: 'v1',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/agents returns 422 for invalid payloads', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'Planner',
        name: '',
        supportedFrameworkKeys: [],
        defaultSkillIds: ['Bad Skill Id'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.name).toBe('Agent name is required')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('At least one supported framework key is required.')
  })

  test('POST /api/v1/super-admin/runtime-control/agents returns 409 when the key already exists', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: RUNTIME_AGENT_DB_ID })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'validator',
        name: 'Validator',
        description: 'Duplicate validator agent.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
        defaultSkillIds: ['skill-snapshot'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'key',
      reason: 'RUNTIME_AGENT_KEY_CONFLICT',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/agents rejects unknown framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'planner',
        name: 'Planner',
        description: 'Plans a framework-specific workflow.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['QMF'],
        defaultSkillIds: ['skill-snapshot'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/agents creates a runtime agent and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'Planner',
        name: 'Planner',
        description: 'Coordinates planning transitions.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['vmf', 'RLD', 'VMF'],
        defaultSkillIds: ['skill-snapshot', 'skill-snapshot', 'skill-summary'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'agent-planner',
      key: 'planner',
      name: 'Planner',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
      defaultSkillIds: ['skill-snapshot', 'skill-summary'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_CREATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin created runtime agent Planner (planner)',
      }),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/agents/:agentId returns the runtime agent detail payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc()
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validator',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId updates the runtime agent and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc()

    RuntimeAgent.findOne
      .mockResolvedValueOnce(runtimeAgent)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Validation Guard',
        status: 'INACTIVE',
        supportedFrameworkKeys: ['VMF'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validation Guard',
      status: 'INACTIVE',
      supportedFrameworkKeys: ['VMF'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_UPDATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF'] },
        summary: 'Super Admin updated runtime agent Validation Guard (validator)',
      }),
    )
  })
})
