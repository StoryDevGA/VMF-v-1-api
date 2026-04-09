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
const WORKFLOW_POLICY_DB_ID = '607f1f77bcf86cd799439051'
const WORKFLOW_POLICY_STABLE_ID = 'policy-vmf-publish'
const STEP_UP_TOKEN = 'step-up-token'

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

const buildWorkflowPolicyQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildRegistryLookupChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let WorkflowPolicy
let RuntimeAgent
let RuntimeSkill
let AuditLog
let mockRedisClient
let originalWorkflowPolicySave
let originalWorkflowPolicyPopulate

const runtimeAgentRows = Object.freeze({
  validator: Object.freeze({
    stableId: 'agent-validator',
    key: 'validator',
    name: 'Validator',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['VMF', 'RLD'],
  }),
  summary: Object.freeze({
    stableId: 'agent-summary',
    key: 'summary',
    name: 'Summary',
    status: 'INACTIVE',
    supportedFrameworkKeys: ['VMF'],
  }),
  reporter: Object.freeze({
    stableId: 'agent-reporter',
    key: 'reporter',
    name: 'Reporter',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['RLD'],
  }),
})

const runtimeSkillRows = Object.freeze({
  snapshot: Object.freeze({
    stableId: 'skill-snapshot',
    key: 'snapshot',
    name: 'Snapshot',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['VMF', 'RLD'],
  }),
  review: Object.freeze({
    stableId: 'skill-review',
    key: 'review',
    name: 'Review',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['VMF'],
  }),
  report: Object.freeze({
    stableId: 'skill-report',
    key: 'report',
    name: 'Report',
    status: 'ACTIVE',
    supportedFrameworkKeys: ['RLD'],
  }),
})

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  WorkflowPolicy.findOne.mockReturnValue({ select })
  return select
}

const mockRegistryLookups = ({ agents = [], skills = [] }) => {
  RuntimeAgent.find.mockReturnValueOnce(buildRegistryLookupChain(agents))
  RuntimeSkill.find.mockReturnValueOnce(buildRegistryLookupChain(skills))
}

const makeWorkflowPolicyDoc = (overrides = {}) => {
  const workflowPolicy = new WorkflowPolicy({
    _id: WORKFLOW_POLICY_DB_ID,
    stableId: WORKFLOW_POLICY_STABLE_ID,
    key: 'vmf-publish',
    name: 'VMF Publish Policy',
    description: 'Controls the publish transition for active VMF framework packages.',
    status: 'ACTIVE',
    frameworkKeys: ['VMF'],
    orderedSteps: ['validate', 'lock', 'publish'],
    requiredAgentIds: ['agent-validator'],
    requiredSkillIds: ['skill-snapshot'],
    gatingRules: ['validation-pass', 'framework-package-active'],
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  workflowPolicy.save = jest.fn(async function save() {
    return this
  })
  workflowPolicy.populate = jest.fn(async function populate() {
    return this
  })

  return workflowPolicy
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
  WorkflowPolicy = models.WorkflowPolicy
  RuntimeAgent = models.RuntimeAgent
  RuntimeSkill = models.RuntimeSkill
  AuditLog = models.AuditLog

  originalWorkflowPolicySave = WorkflowPolicy.prototype.save
  originalWorkflowPolicyPopulate = WorkflowPolicy.prototype.populate
})

afterAll(() => {
  WorkflowPolicy.prototype.save = originalWorkflowPolicySave
  WorkflowPolicy.prototype.populate = originalWorkflowPolicyPopulate
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

  WorkflowPolicy.find = jest.fn()
  WorkflowPolicy.countDocuments = jest.fn()
  WorkflowPolicy.findOne = jest.fn()
  FrameworkRegistry.find = jest.fn()
  RuntimeAgent.find = jest.fn()
  RuntimeSkill.find = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  WorkflowPolicy.prototype.save = jest.fn(async function save() {
    return this
  })
  WorkflowPolicy.prototype.populate = jest.fn(async function populate() {
    return this
  })

  WorkflowPolicy.countDocuments.mockResolvedValue(0)
  WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyQueryChain([]))
  WorkflowPolicy.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  FrameworkRegistry.find.mockReturnValue(buildRegistryLookupChain([
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
  RuntimeAgent.find.mockReturnValue(buildRegistryLookupChain([]))
  RuntimeSkill.find.mockReturnValue(buildRegistryLookupChain([]))

  AuditLog.createLog = jest.fn(async () => ({}))
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
})

describe('Workflow Policy Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/workflow-policies returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/workflow-policies')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/workflow-policies returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies returns 403 when step-up token is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'vmf-review',
        name: 'VMF Review Policy',
        frameworkKeys: ['VMF'],
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACCESS_DENIED',
      resourceType: 'User',
      requestId: res.body.error.requestId,
    }))
  })

  test('GET /api/v1/super-admin/runtime-control/workflow-policies returns paginated rows with framework filtering', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        stableId: 'policy-rld-publish',
        key: 'rld-publish',
        name: 'RLD Publish Policy',
        description: 'Controls publish sequencing for RLD workflow packages and report output.',
        status: 'ACTIVE',
        frameworkKeys: ['RLD'],
        orderedSteps: ['validate', 'synthesise', 'publish'],
        requiredAgentIds: ['agent-validator', 'agent-reporter'],
        requiredSkillIds: ['skill-snapshot', 'skill-report'],
        gatingRules: ['validation-pass', 'framework-package-active'],
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    WorkflowPolicy.countDocuments.mockResolvedValue(1)
    WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/workflow-policies?page=1&pageSize=4&frameworkKey=RLD&status=ACTIVE&q=publish')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(WorkflowPolicy.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        frameworkKeys: 'RLD',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'policy-rld-publish',
      key: 'rld-publish',
      status: 'ACTIVE',
      frameworkKeys: ['RLD'],
      orderedSteps: ['validate', 'synthesise', 'publish'],
    })
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      version: 'v1',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies returns 422 for invalid payloads', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'Bad Key',
        name: '',
        frameworkKeys: [],
        orderedSteps: [],
        requiredAgentIds: [],
        requiredSkillIds: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.name).toBe('Workflow policy name is required')
    expect(res.body.error.details.frameworkKeys).toBe('At least one framework key is required.')
    expect(res.body.error.details.orderedSteps).toBe('At least one ordered step is required.')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies returns 409 when the key already exists', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: WORKFLOW_POLICY_DB_ID })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'vmf-publish',
        name: 'VMF Publish Policy',
        description: 'Duplicate publish policy.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        orderedSteps: ['validate', 'lock', 'publish'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        gatingRules: ['framework-package-active'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'key',
      reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects unknown framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'qmf-review',
        name: 'QMF Review Policy',
        description: 'Controls QMF review sequencing.',
        status: 'ACTIVE',
        frameworkKeys: ['QMF'],
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        gatingRules: ['framework-package-active'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.frameworkKeys).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects missing agent and skill references', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'vmf-review',
        name: 'VMF Review Policy',
        description: 'Checks review readiness.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-missing'],
        requiredSkillIds: ['skill-snapshot', 'skill-missing'],
        gatingRules: ['framework-package-active'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.requiredAgentIds).toContain('agent-missing')
    expect(res.body.error.details.requiredSkillIds).toContain('skill-missing')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects incompatible framework references', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.report],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'vmf-report',
        name: 'VMF Report Policy',
        description: 'Invalid VMF policy with an RLD-only skill.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-report'],
        gatingRules: ['framework-package-active'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.requiredSkillIds).toContain('does not support framework key "VMF"')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects illegal step ordering for the framework', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'vmf-out-of-order',
        name: 'VMF Out Of Order Policy',
        description: 'Invalid publish sequencing.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        orderedSteps: ['publish', 'validate'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        gatingRules: ['validation-pass'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.orderedSteps).toContain('"validate"')
    expect(res.body.error.details.orderedSteps).toContain('"publish"')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies creates a workflow policy and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator, runtimeAgentRows.summary],
      skills: [runtimeSkillRows.snapshot, runtimeSkillRows.review],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        key: 'vmf-review',
        name: 'VMF Review Policy',
        description: 'Coordinates VMF review and approval transitions.',
        status: 'ACTIVE',
        frameworkKeys: ['vmf'],
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-summary'],
        requiredSkillIds: ['skill-snapshot', 'skill-review'],
        gatingRules: ['framework-package-active', 'framework-package-active'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-review',
      key: 'vmf-review',
      name: 'VMF Review Policy',
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      orderedSteps: ['snapshot', 'review', 'approve'],
      requiredAgentIds: ['agent-validator', 'agent-summary'],
      requiredSkillIds: ['skill-snapshot', 'skill-review'],
      gatingRules: ['framework-package-active'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WORKFLOW_POLICY_CREATED',
        resourceType: 'WorkflowPolicy',
        scope: { frameworkKeys: ['VMF'] },
        summary: 'Super Admin created workflow policy VMF Review Policy (vmf-review)',
      }),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/workflow-policies/:policyId returns the workflow policy detail payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const workflowPolicy = makeWorkflowPolicyDoc()
    WorkflowPolicy.findOne.mockResolvedValue(workflowPolicy)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/workflow-policies/${WORKFLOW_POLICY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-publish',
      key: 'vmf-publish',
      name: 'VMF Publish Policy',
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      orderedSteps: ['validate', 'lock', 'publish'],
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/workflow-policies/:policyId updates the workflow policy and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const workflowPolicy = makeWorkflowPolicyDoc()

    WorkflowPolicy.findOne
      .mockResolvedValueOnce(workflowPolicy)
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue(null),
      })

    mockRegistryLookups({
      agents: [runtimeAgentRows.validator, runtimeAgentRows.summary],
      skills: [runtimeSkillRows.snapshot, runtimeSkillRows.review],
    })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/workflow-policies/${WORKFLOW_POLICY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        name: 'VMF Approval Policy',
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-summary'],
        requiredSkillIds: ['skill-snapshot', 'skill-review'],
        gatingRules: ['framework-package-active'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-publish',
      key: 'vmf-publish',
      name: 'VMF Approval Policy',
      orderedSteps: ['snapshot', 'review', 'approve'],
      requiredAgentIds: ['agent-validator', 'agent-summary'],
      requiredSkillIds: ['skill-snapshot', 'skill-review'],
      gatingRules: ['framework-package-active'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WORKFLOW_POLICY_UPDATED',
        resourceType: 'WorkflowPolicy',
        scope: { frameworkKeys: ['VMF'] },
        summary: 'Super Admin updated workflow policy VMF Approval Policy (vmf-publish)',
      }),
    )
  })
})
