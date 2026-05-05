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

const buildRuntimeSkillLookupChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildRuntimePathLookupChain = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildWorkflowPolicyLookupChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildFrameworkPackageLookupChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let RuntimeAgent
let RuntimeSkill
let RuntimePathRegistry
let SkillRoleRegistry
let WorkflowPolicy
let FrameworkPackage
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
    requiredSkillRoleKeys: ['VALIDATOR'],
    defaultSkillIds: ['skill-snapshot'],
    executionPlan: [{
      skillId: 'skill-snapshot',
      description: '',
      readsFrom: ['vmf.sections.icp'],
      writesTo: ['runtime.validationResult'],
    }],
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
  RuntimeSkill = models.RuntimeSkill
  RuntimePathRegistry = models.RuntimePathRegistry
  SkillRoleRegistry = models.SkillRoleRegistry
  WorkflowPolicy = models.WorkflowPolicy
  FrameworkPackage = models.FrameworkPackage
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
  RuntimeAgent.findByStableId = jest.fn()
  RuntimeAgent.updateOne = jest.fn()
  RuntimeSkill.find = jest.fn()
  RuntimePathRegistry.find = jest.fn()
  SkillRoleRegistry.find = jest.fn()
  WorkflowPolicy.find = jest.fn()
  FrameworkPackage.find = jest.fn()
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
  RuntimeAgent.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })
  RuntimeAgent.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  RuntimeAgent.findByStableId.mockImplementation((stableId) =>
    RuntimeAgent.findOne({ stableId: String(stableId || '').trim().toLowerCase() }))
  RuntimeSkill.find.mockReturnValue(buildRuntimeSkillLookupChain([
    {
      stableId: 'skill-snapshot',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    },
    {
      stableId: 'skill-summary',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    },
  ]))
  RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
    {
      pathKey: 'vmf.sections.icp',
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      allowedOperations: ['READ', 'BIND'],
      isProtected: false,
    },
    {
      pathKey: 'runtime.validationResult',
      status: 'ACTIVE',
      frameworkKeys: ['VMF', 'RLD'],
      allowedOperations: ['READ', 'WRITE', 'BIND'],
      isProtected: false,
    },
    {
      pathKey: 'artifacts.summary',
      status: 'ACTIVE',
      frameworkKeys: ['VMF', 'RLD'],
      allowedOperations: ['READ', 'WRITE', 'BIND'],
      isProtected: false,
    },
    {
      pathKey: 'vmf.id',
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      allowedOperations: ['READ'],
      isProtected: true,
    },
  ]))
  SkillRoleRegistry.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([
      { roleKey: 'VALIDATOR', status: 'ACTIVE' },
      { roleKey: 'RENDERER', status: 'ACTIVE' },
    ]),
  })
  WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyLookupChain([]))
  FrameworkPackage.find.mockReturnValue(buildFrameworkPackageLookupChain([]))
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
    {
      frameworkKey: 'CMF',
      name: 'Customer Messaging Framework',
      supportedWorkflowKeys: ['cmf-baseline'],
      status: 'INACTIVE',
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

  test('POST /api/v1/super-admin/runtime-control/agents returns 422 when contracts are not JSON objects', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'contract-check',
        name: 'Contract Check',
        supportedFrameworkKeys: ['VMF'],
        inputContract: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(String(res.body.error.details.inputContract || '')).toMatch(/expected|object|record/i)
  })

  test('POST /api/v1/super-admin/runtime-control/agents returns 422 when an execution step writes to an unknown runtime path', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'planner',
        name: 'Planner',
        supportedFrameworkKeys: ['VMF'],
        defaultSkillIds: ['skill-snapshot'],
        executionPlan: [{
          skillId: 'skill-snapshot',
          description: '',
          writesTo: ['runtime.unknownTarget'],
        }],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.executionPlan).toBe(
      'Step 1 writes to unknown runtime path "runtime.unknownTarget".',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents returns 422 when required skill roles are unknown', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'planner',
        name: 'Planner',
        supportedFrameworkKeys: ['VMF'],
        requiredSkillRoleKeys: ['UNKNOWN_ROLE'],
        defaultSkillIds: ['skill-snapshot'],
        executionPlan: [{ skillId: 'skill-snapshot', description: '' }],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.requiredSkillRoleKeys).toBe(
      'Required skill role "UNKNOWN_ROLE" was not found.',
    )
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
        executionPlan: [{ skillId: 'skill-snapshot', description: '' }],
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
        executionPlan: [{ skillId: 'skill-snapshot', description: '' }],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/agents rejects inactive framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'cmf-planner',
        name: 'CMF Planner',
        description: 'Plans CMF workflows.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['CMF'],
        defaultSkillIds: ['skill-snapshot'],
        executionPlan: [{ skillId: 'skill-snapshot', description: '' }],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Inactive framework key "CMF".')
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
        agentType: 'validation',
        supportedFrameworkKeys: ['vmf', 'RLD', 'VMF'],
        requiredSkillRoleKeys: ['validator', 'RENDERER'],
        defaultSkillIds: ['skill-snapshot', 'skill-snapshot', 'skill-summary'],
        primarySkillIds: ['skill-summary'],
        optionalSkillIds: ['skill-snapshot'],
        executionPlan: [
          {
            skillId: 'skill-snapshot',
            description: 'Capture state.',
            readsFrom: ['vmf.sections.icp'],
            writesTo: ['runtime.validationResult'],
          },
          {
            skillId: 'skill-summary',
            description: '',
            readsFrom: ['runtime.validationResult'],
            writesTo: ['artifacts.summary'],
          },
        ],
        promptConfig: { base_system_prompt: 'You are governed.' },
        inputContract: { required_inputs: ['frameworkPackage'] },
        outputContract: { required_fields: ['execution_trace'] },
        policies: { max_token_budget: 30000, timeout_seconds: 60 },
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'agent-planner',
      key: 'planner',
      name: 'Planner',
      status: 'ACTIVE',
      agentType: 'VALIDATION',
      supportedFrameworkKeys: ['VMF', 'RLD'],
      requiredSkillRoleKeys: ['VALIDATOR', 'RENDERER'],
      defaultSkillIds: ['skill-snapshot', 'skill-summary'],
      primarySkillIds: ['skill-summary'],
      optionalSkillIds: ['skill-snapshot'],
      executionPlan: [
        {
          skillId: 'skill-snapshot',
          description: 'Capture state.',
          readsFrom: ['vmf.sections.icp'],
          writesTo: ['runtime.validationResult'],
        },
        {
          skillId: 'skill-summary',
          description: '',
          readsFrom: ['runtime.validationResult'],
          writesTo: ['artifacts.summary'],
        },
      ],
      promptConfig: { base_system_prompt: 'You are governed.' },
      inputContract: { required_inputs: ['frameworkPackage'] },
      outputContract: { required_fields: ['execution_trace'] },
      policies: { max_token_budget: 30000, timeout_seconds: 60 },
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
      .get(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID.toUpperCase()}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeAgent.findOne).toHaveBeenCalledWith({ stableId: RUNTIME_AGENT_STABLE_ID })
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validator',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
    })
  })

  test('GET /api/v1/super-admin/runtime-control/agents/:agentId returns read-only detail for locked agents', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      isLocked: true,
      lockedByPackageKeys: ['vmf-qa-package'],
    })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      isLocked: true,
      lockedByPackageKeys: ['vmf-qa-package'],
    })
  })

  test('GET /api/v1/super-admin/runtime-control/agents/:agentId returns 404 when the agent is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeAgent.findOne.mockResolvedValue(null)

    const res = await request
      .get('/api/v1/super-admin/runtime-control/agents/agent-missing')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/v1/super-admin/runtime-control/agents/:agentId/dependencies returns referencing policies and packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    RuntimeAgent.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          stableId: RUNTIME_AGENT_STABLE_ID,
          key: 'validator',
          name: 'Validator',
          status: 'ACTIVE',
          supportedFrameworkKeys: ['VMF'],
        }),
      }),
    })

    WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyLookupChain([
      { stableId: 'policy-vmf-review', key: 'vmf-review', name: 'VMF Review Policy', status: 'ACTIVE' },
    ]))
    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageLookupChain([
      {
        _id: '607f1f77bcf86cd799439099',
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
        status: 'ACTIVE',
      },
    ]))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      agentId: RUNTIME_AGENT_STABLE_ID,
      summary: {
        workflowPolicies: 1,
        frameworkPackages: 1,
        activeWorkflowPolicies: 1,
        activeFrameworkPackages: 1,
      },
    })
    expect(res.body.data.workflowPolicies).toEqual([
      expect.objectContaining({ id: 'policy-vmf-review', key: 'vmf-review', status: 'ACTIVE' }),
    ])
    expect(res.body.data.frameworkPackages).toEqual([
      expect.objectContaining({ frameworkKey: 'VMF', version: '2.3.1', status: 'ACTIVE' }),
    ])
    expect(res.body.data.warnings.length).toBeGreaterThan(0)
    expect(res.body.data.blocks.length).toBeGreaterThan(0)
  })

  test('GET /api/v1/super-admin/runtime-control/agents/:agentId/dependencies returns 404 when the agent is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    RuntimeAgent.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    })

    const res = await request
      .get('/api/v1/super-admin/runtime-control/agents/agent-missing/dependencies')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('POST /api/v1/super-admin/runtime-control/agents rejects server-managed version metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'planner',
        name: 'Planner',
        supportedFrameworkKeys: ['VMF'],
        defaultSkillIds: ['skill-snapshot'],
        executionPlan: [{ skillId: 'skill-snapshot', description: '' }],
        isLocked: false,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.isLocked).toBe(
      'Runtime Agent version and lock metadata is managed by the server.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents rejects duplicate execution step keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'planner',
        name: 'Planner',
        supportedFrameworkKeys: ['VMF'],
        defaultSkillIds: ['skill-snapshot', 'skill-summary'],
        executionPlan: [
          { stepKey: 'run-check', order: 1, skillId: 'skill-snapshot', description: '' },
          { stepKey: 'run-check', order: 2, skillId: 'skill-summary', description: '' },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details['executionPlan.1.stepKey']).toBe(
      'Execution plan step keys must be unique.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/clone creates an editable draft successor', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      componentVersion: 3,
      versionStatus: 'ACTIVE',
      lineageId: RUNTIME_AGENT_STABLE_ID,
      isLocked: true,
      lockedByPackageKeys: ['vmf-qa-package'],
    })

    RuntimeAgent.findByStableId.mockResolvedValue(runtimeAgent)
    mockFindOneSelect(null)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'validator-clone',
        name: 'Validator Clone',
        description: 'Editable successor.',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator-clone',
      key: 'validator-clone',
      name: 'Validator Clone',
      status: 'DRAFT',
      componentVersion: 4,
      versionStatus: 'DRAFT',
      lineageId: RUNTIME_AGENT_STABLE_ID,
      isLocked: false,
      lockedByPackageKeys: [],
      clonedFromStableId: RUNTIME_AGENT_STABLE_ID,
      supersedesStableId: RUNTIME_AGENT_STABLE_ID,
    })
    expect(RuntimeAgent.updateOne).toHaveBeenCalledWith(
      { stableId: RUNTIME_AGENT_STABLE_ID },
      { $set: { supersededByStableId: 'agent-validator-clone', updatedBy: SUPER_ADMIN_ID } },
      { runValidators: false },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_CLONED',
        resourceType: 'RuntimeAgent',
        diff: expect.objectContaining({
          clonedFromStableId: RUNTIME_AGENT_STABLE_ID,
          supersedesStableId: RUNTIME_AGENT_STABLE_ID,
          componentVersion: 4,
          versionStatus: 'DRAFT',
        }),
      }),
    )
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
        status: 'DRAFT',
        supportedFrameworkKeys: ['VMF'],
        requiredSkillRoleKeys: ['VALIDATOR'],
        primarySkillIds: ['skill-summary'],
        executionPlan: [{
          skillId: 'skill-snapshot',
          description: '',
          readsFrom: ['vmf.sections.icp'],
          writesTo: ['runtime.validationResult'],
        }],
        promptConfig: { role_prompt: 'Validate.' },
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validation Guard',
      status: 'DRAFT',
      supportedFrameworkKeys: ['VMF'],
      requiredSkillRoleKeys: ['VALIDATOR'],
      primarySkillIds: ['skill-summary'],
      executionPlan: [{
        skillId: 'skill-snapshot',
        description: '',
        readsFrom: ['vmf.sections.icp'],
        writesTo: ['runtime.validationResult'],
      }],
      promptConfig: { role_prompt: 'Validate.' },
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

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId rejects direct edits to locked agents', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      isLocked: true,
      lockedByPackageKeys: ['vmf-qa-package'],
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Locked Edit Attempt' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'isLocked',
      reason: 'RUNTIME_AGENT_LOCKED',
      lockedByPackageKeys: ['vmf-qa-package'],
    })
    expect(runtimeAgent.save).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId allows updating when execution plan contains legacy scalar writesTo targets', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'DRAFT',
    })

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
        executionPlan: [{
          skillId: 'skill-snapshot',
          description: '',
          readsFrom: ['vmf.sections.icp'],
          writesTo: 'runtime',
        }],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validation Guard',
      status: 'DRAFT',
      executionPlan: [{
        skillId: 'skill-snapshot',
        readsFrom: ['vmf.sections.icp'],
        writesTo: ['runtime'],
      }],
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId allows saving when a required skill role is non-active but unchanged', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'DRAFT',
      requiredSkillRoleKeys: ['VALIDATOR'],
    })

    RuntimeAgent.findOne
      .mockResolvedValueOnce(runtimeAgent)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    SkillRoleRegistry.find.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { roleKey: 'VALIDATOR', status: 'DEPRECATED' },
      ]),
    })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Validation Guard',
        description: 'Updated description while role is deprecated.',
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      key: 'validator',
      name: 'Validation Guard',
      status: 'DRAFT',
      requiredSkillRoleKeys: ['VALIDATOR'],
      description: 'Updated description while role is deprecated.',
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId rejects adding non-active required skill roles', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'DRAFT',
      requiredSkillRoleKeys: ['VALIDATOR'],
    })

    RuntimeAgent.findOne
      .mockResolvedValueOnce(runtimeAgent)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    SkillRoleRegistry.find.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { roleKey: 'VALIDATOR', status: 'ACTIVE' },
        { roleKey: 'RENDERER', status: 'DEPRECATED' },
      ]),
    })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        requiredSkillRoleKeys: ['VALIDATOR', 'RENDERER'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.requiredSkillRoleKeys).toBe(
      'Required skill role "RENDERER" must be ACTIVE.',
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId returns 409 when attempting lifecycle status changes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'DRAFT',
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'status',
      reason: 'RUNTIME_AGENT_LIFECYCLE_ACTION_REQUIRED',
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId returns 409 when attempting to set status to DRAFT with active dependencies', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'ACTIVE',
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)
    WorkflowPolicy.find.mockReturnValueOnce(buildWorkflowPolicyLookupChain([
      {
        stableId: 'policy-active',
        key: 'active-policy',
        name: 'Active Policy',
        status: 'ACTIVE',
      },
    ]))
    FrameworkPackage.find.mockReturnValueOnce(buildFrameworkPackageLookupChain([]))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DRAFT' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'status',
      reason: 'RUNTIME_AGENT_DEPENDENCIES_ACTIVE',
      activeWorkflowPolicies: 1,
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/agents/:agentId returns 404 when the agent is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeAgent.findOne.mockResolvedValue(null)

    const res = await request
      .patch('/api/v1/super-admin/runtime-control/agents/agent-missing')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/validate returns 422 when validation fails', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      supportedFrameworkKeys: ['QMF'],
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Unknown framework key "QMF".')
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_VALIDATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['QMF'] },
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/validate returns 200 when the agent is valid', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc()
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      valid: true,
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_VALIDATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin validated runtime agent Validator (validator)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/test returns 422 when a framework key is not supported', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      supportedFrameworkKeys: ['VMF'],
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/test`)
      .set('Authorization', `Bearer ${token}`)
      .send({ frameworkKey: 'RLD' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.frameworkKey).toBe('Agent does not support framework key "RLD".')
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_TESTED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF'] },
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/test returns 200 with a prompt hash and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      supportedFrameworkKeys: ['VMF', 'RLD'],
      promptConfig: {
        baseSystemPrompt: 'You are a governed agent.',
        rolePrompt: 'Validate.',
      },
    })

    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/test`)
      .set('Authorization', `Bearer ${token}`)
      .send({ frameworkKey: 'VMF', input: { foo: 'bar' } })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(
      expect.objectContaining({
        ok: true,
        promptHash: expect.any(String),
        compiledPromptPreview: expect.stringContaining('Base System Prompt'),
      }),
    )
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_TESTED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin tested runtime agent Validator (validator)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/activate activates the agent and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({ status: 'INACTIVE' })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      status: 'ACTIVE',
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_ACTIVATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin activated runtime agent Validator (validator)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/activate returns 422 when the agent fails validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({
      status: 'INACTIVE',
      supportedFrameworkKeys: ['CMF'],
    })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toBe('Agent must pass validation before activation.')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Inactive framework key "CMF".')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/disable disables the agent and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({ status: 'ACTIVE' })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      status: 'INACTIVE',
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_DISABLED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin disabled runtime agent Validator (validator)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/disable returns 409 when active dependencies exist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({ status: 'ACTIVE' })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyLookupChain([
      { stableId: 'policy-vmf-review', key: 'vmf-review', name: 'VMF Review Policy', status: 'ACTIVE' },
    ]))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.field).toBe('status')
    expect(res.body.error.details.reason).toBe('RUNTIME_AGENT_DEPENDENCIES_ACTIVE')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/deprecate deprecates the agent and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({ status: 'ACTIVE' })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/deprecate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'agent-validator',
      status: 'DEPRECATED',
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_AGENT_DEPRECATED',
        resourceType: 'RuntimeAgent',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin deprecated runtime agent Validator (validator)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/agents/:agentId/deprecate returns 409 when active dependencies exist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeAgent = makeRuntimeAgentDoc({ status: 'ACTIVE' })
    RuntimeAgent.findOne.mockResolvedValue(runtimeAgent)

    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageLookupChain([
      {
        _id: '607f1f77bcf86cd799439099',
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
        status: 'ACTIVE',
      },
    ]))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/agents/${RUNTIME_AGENT_STABLE_ID}/deprecate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.field).toBe('status')
    expect(res.body.error.details.reason).toBe('RUNTIME_AGENT_DEPENDENCIES_ACTIVE')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })
})
