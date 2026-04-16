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

const buildFrameworkRegistryLookupChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildReferenceLookupChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

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
let FrameworkRegistry
let RuntimeSkill
let RuntimeAgent
let WorkflowPolicy
let AuditLog
let mockRedisClient
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
    category: 'SNAPSHOT',
    type: 'DETERMINISTIC',
    executionMode: 'SYSTEM',
    inputContract: { schema: {} },
    outputContract: { schema: {} },
    runtimeConfig: { timeoutMs: 5000, retryPolicy: 'NONE' },
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
  FrameworkRegistry = models.FrameworkRegistry
  RuntimeSkill = models.RuntimeSkill
  RuntimeAgent = models.RuntimeAgent
  WorkflowPolicy = models.WorkflowPolicy
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
  RuntimeAgent.find = jest.fn()
  WorkflowPolicy.find = jest.fn()
  FrameworkRegistry.find = jest.fn()
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
  RuntimeAgent.find.mockReturnValue(buildReferenceLookupChain([]))
  WorkflowPolicy.find.mockReturnValue(buildReferenceLookupChain([]))
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
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
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
        category: 'MAPPING',
        type: 'DETERMINISTIC',
        executionMode: 'SYSTEM',
        inputContract: { schema: {} },
        outputContract: { schema: {} },
        runtimeConfig: { timeoutMs: 5000 },
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    RuntimeSkill.countDocuments.mockResolvedValue(1)
    RuntimeSkill.find.mockReturnValue(buildRuntimeSkillQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skills?page=1&pageSize=4&frameworkKey=RLD&status=ACTIVE&category=MAPPING&executionMode=SYSTEM&q=revenue')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeSkill.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        supportedFrameworkKeys: 'RLD',
        category: 'MAPPING',
        executionMode: 'SYSTEM',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'skill-revenue-map',
      key: 'revenue-map',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['RLD'],
      category: 'MAPPING',
      executionMode: 'SYSTEM',
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

  test('POST /api/v1/super-admin/runtime-control/skills returns 422 when both primaryOutputKey and outputBindings are provided', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'check-required-vmf-sections',
        name: 'Check Required VMF Sections',
        supportedFrameworkKeys: ['VMF'],
        primaryOutputKey: 'validationResult',
        outputBindings: ['validationResult', 'missingSections'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.primaryOutputKey).toBe('Provide either a primary output key or output bindings, not both.')
    expect(res.body.error.details.outputBindings).toBe('Provide either a primary output key or output bindings, not both.')
  })

  test('POST /api/v1/super-admin/runtime-control/skills returns 422 when SYSTEM skills include executionConfig', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'snapshot',
        name: 'Snapshot',
        supportedFrameworkKeys: ['VMF'],
        executionMode: 'SYSTEM',
        executionConfig: { mode: 'unsafe' },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.executionConfig).toBe('Execution config is only supported for rule engine or agent-assisted skills.')
  })

  test('POST /api/v1/super-admin/runtime-control/skills returns 422 when forbiddenWritePaths overlaps allowedWritePaths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'mutate-snapshot',
        name: 'Mutate Snapshot',
        supportedFrameworkKeys: ['VMF'],
        allowedWritePaths: ['vmf.snapshotId'],
        forbiddenWritePaths: ['vmf.snapshotId'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.forbiddenWritePaths).toBe('Forbidden write paths must not overlap with allowed write paths.')
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

  test('POST /api/v1/super-admin/runtime-control/skills rejects unknown framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'review-pack',
        name: 'Review Pack',
        description: 'Assembles review artifacts.',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['QMF'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.supportedFrameworkKeys).toBe('Unknown framework key "QMF".')
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
      category: 'GENERAL',
      type: 'DETERMINISTIC',
      executionMode: 'SYSTEM',
      inputContract: {},
      outputContract: {},
      runtimeConfig: {},
      referenceAssets: [],
      dependencySummary: {
        agentIds: [],
        workflowPolicyIds: [],
      },
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_SKILL_CREATED',
        resourceType: 'RuntimeSkill',
        scope: { frameworkKeys: ['VMF', 'RLD'] },
        summary: 'Super Admin created runtime skill Summary (summary)',
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/skills accepts referenceAssets metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'check-required-vmf-sections',
        name: 'Check Required VMF Sections',
        supportedFrameworkKeys: ['VMF'],
        referenceAssets: [
          {
            assetId: 'asset-vmf-validation-guidance',
            name: 'VMF Validation Guidance',
            assetType: 'PDF',
            mimeType: 'application/pdf',
            purpose: 'RUNTIME_REFERENCE',
            usageMode: 'OPTIONAL',
            status: 'ACTIVE',
            description: 'Reference guide for required VMF sections and validation expectations.',
            storageKey: 'runtime-control/skills/check-required-vmf-sections/validation-guide.pdf',
            isRuntimeAccessible: true,
            isAdminOnly: false,
            isTestOnly: false,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.referenceAssets).toHaveLength(1)
    expect(res.body.data.referenceAssets[0]).toMatchObject({
      assetId: 'asset-vmf-validation-guidance',
      name: 'VMF Validation Guidance',
      assetType: 'PDF',
      mimeType: 'application/pdf',
      purpose: 'RUNTIME_REFERENCE',
      usageMode: 'OPTIONAL',
      status: 'ACTIVE',
      storageKey: 'runtime-control/skills/check-required-vmf-sections/validation-guide.pdf',
      isRuntimeAccessible: true,
      isAdminOnly: false,
      isTestOnly: false,
    })
  })

  test('GET /api/v1/super-admin/runtime-control/skills/:skillId returns the runtime skill detail payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeSkill = makeRuntimeSkillDoc()
    RuntimeSkill.findOne.mockResolvedValue(runtimeSkill)
    RuntimeAgent.find.mockReturnValue(buildReferenceLookupChain([
      {
        stableId: 'agent-validator',
        key: 'validator',
        name: 'Validator',
        status: 'ACTIVE',
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildReferenceLookupChain([
      {
        stableId: 'policy-vmf-publish',
        key: 'vmf-publish',
        name: 'VMF Publish',
        status: 'ACTIVE',
      },
    ]))

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
      category: 'SNAPSHOT',
      type: 'DETERMINISTIC',
      executionMode: 'SYSTEM',
      dependencySummary: {
        agentIds: ['agent-validator'],
        workflowPolicyIds: ['policy-vmf-publish'],
      },
    })
  })

  test('GET /api/v1/super-admin/runtime-control/skills/:skillId returns 404 when the skill does not exist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeSkill.findOne.mockResolvedValue(null)

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skills/skill-missing')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/v1/super-admin/runtime-control/skills/:skillId/dependencies returns dependency visibility for the skill', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeSkill.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          stableId: RUNTIME_SKILL_STABLE_ID,
          key: 'snapshot',
          name: 'Snapshot',
        }),
      }),
    })
    RuntimeAgent.find.mockReturnValue(buildReferenceLookupChain([
      {
        stableId: 'agent-validator',
        key: 'validator',
        name: 'Validator',
        status: 'ACTIVE',
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildReferenceLookupChain([
      {
        stableId: 'policy-vmf-publish',
        key: 'vmf-publish',
        name: 'VMF Publish',
        status: 'ACTIVE',
      },
    ]))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/skills/${RUNTIME_SKILL_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'skill-snapshot',
      key: 'snapshot',
      name: 'Snapshot',
      agentIds: ['agent-validator'],
      workflowPolicyIds: ['policy-vmf-publish'],
      agents: [
        {
          id: 'agent-validator',
          key: 'validator',
          name: 'Validator',
          status: 'ACTIVE',
        },
      ],
      workflowPolicies: [
        {
          id: 'policy-vmf-publish',
          key: 'vmf-publish',
          name: 'VMF Publish',
          status: 'ACTIVE',
        },
      ],
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
        category: 'GOVERNANCE',
        type: 'HYBRID',
        executionMode: 'RULE_ENGINE',
        inputContract: {
          schema: {
            vmfId: 'string',
          },
        },
        outputContract: {
          schema: {
            snapshotId: 'string',
          },
        },
        runtimeConfig: {
          timeoutMs: 2500,
          retryPolicy: 'NONE',
        },
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'skill-snapshot',
      key: 'snapshot',
      name: 'Runtime Snapshot',
      status: 'INACTIVE',
      supportedFrameworkKeys: ['VMF'],
      category: 'GOVERNANCE',
      type: 'HYBRID',
      executionMode: 'RULE_ENGINE',
      inputContract: {
        schema: {
          vmfId: 'string',
        },
      },
      outputContract: {
        schema: {
          snapshotId: 'string',
        },
      },
      runtimeConfig: {
        timeoutMs: 2500,
        retryPolicy: 'NONE',
      },
      dependencySummary: {
        agentIds: [],
        workflowPolicyIds: [],
      },
    })
    expect(AuditLog.createLog).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RUNTIME_SKILL_UPDATED',
        resourceType: 'RuntimeSkill',
        scope: { frameworkKeys: ['VMF'] },
        summary: 'Super Admin updated runtime skill Runtime Snapshot (snapshot)',
      }),
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/skills/:skillId returns 404 when the skill does not exist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeSkill.findOne.mockResolvedValue(null)

    const res = await request
      .patch('/api/v1/super-admin/runtime-control/skills/skill-missing')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Missing' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('POST /api/v1/super-admin/runtime-control/skills creates a skill with DRAFT status', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'draft-skill',
        name: 'Draft Skill',
        description: 'A skill created in draft status.',
        status: 'DRAFT',
        supportedFrameworkKeys: ['VMF'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'skill-draft-skill',
      key: 'draft-skill',
      name: 'Draft Skill',
      status: 'DRAFT',
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/skills/:skillId updates status to DEPRECATED', async () => {
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
        status: 'DEPRECATED',
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'skill-snapshot',
      status: 'DEPRECATED',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/skills creates a skill with reference assets', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const referenceAssets = [
      {
        assetId: 'asset-abc123def',
        name: 'Help Document',
        assetType: 'PDF',
        mimeType: 'application/pdf',
        purpose: 'AUTHORING_HELP',
        usageMode: 'OPTIONAL',
        status: 'ACTIVE',
        description: 'User guide for skill authoring',
        storageKey: 's3://bucket/help.pdf',
      },
    ]

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'documented-skill',
        name: 'Documented Skill',
        supportedFrameworkKeys: ['VMF'],
        referenceAssets,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.referenceAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: 'asset-abc123def',
          name: 'Help Document',
          purpose: 'AUTHORING_HELP',
        }),
      ]),
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/skills/:skillId updates reference assets', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeSkill = makeRuntimeSkillDoc()

    RuntimeSkill.findOne
      .mockResolvedValueOnce(runtimeSkill)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    const newReferenceAssets = [
      {
        assetId: 'asset-xyz789',
        name: 'API Documentation',
        assetType: 'JSON',
        mimeType: 'application/json',
        purpose: 'RUNTIME_REFERENCE',
        usageMode: 'REQUIRED',
        status: 'ACTIVE',
        storageKey: 's3://bucket/api.json',
      },
    ]

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/skills/${RUNTIME_SKILL_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        referenceAssets: newReferenceAssets,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.referenceAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: 'asset-xyz789',
          name: 'API Documentation',
          purpose: 'RUNTIME_REFERENCE',
        }),
      ]),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/skills rejects reference assets with missing required fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'invalid-asset-skill',
        name: 'Invalid Asset Skill',
        supportedFrameworkKeys: ['VMF'],
        referenceAssets: [
          {
            assetId: 'asset-test',
            // missing name
            purpose: 'AUTHORING_HELP',
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/reference asset/i)
  })

  test('PATCH /api/v1/super-admin/runtime-control/skills/:skillId rejects key changes (immutable)', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimeSkill = makeRuntimeSkillDoc()

    RuntimeSkill.findOne.mockResolvedValueOnce(runtimeSkill)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/skills/${RUNTIME_SKILL_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'different-key',
        name: 'Snapshot Updated',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.key).toMatch(/immutable/i)
  })

})
