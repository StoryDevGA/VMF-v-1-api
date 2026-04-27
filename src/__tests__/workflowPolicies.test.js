import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'
import mongoose from 'mongoose'

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
  maxTimeMS: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildCountDocumentsChain = (count) => ({
  maxTimeMS: jest.fn().mockResolvedValue(count),
})

const buildRegistryLookupChain = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildRuntimePathLookupChain = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
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
let FrameworkPackage
let WorkflowPolicy
let RuntimeAgent
let RuntimeSkill
let RuntimePathRegistry
let ValidationRegistry
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

const buildPhaseOneWorkflowPolicyPayload = (overrides = {}) => ({
  key: 'vmf-publish',
  name: 'VMF Publish Policy',
  description: 'Controls the publish transition for active VMF framework packages.',
  status: 'ACTIVE',
  policyType: 'LIFECYCLE_GATE',
  priority: 10,
  frameworkKeys: ['VMF'],
  appliesTo: 'FRAMEWORK_LIFECYCLE',
  triggerEvent: 'ON_PUBLISH',
  triggerMode: 'PRE_ACTION',
  actorScope: 'ADMINISTRATOR',
  cooldownSeconds: 0,
  reevaluateOnRetry: false,
  governedAction: 'PUBLISH',
  decisionMode: 'ALLOW',
  passMessage: 'Publishing allowed.',
  failMessage: 'Publishing blocked.',
  severity: 'BLOCKING',
  orderedSteps: ['validate', 'lock', 'publish'],
  requiredAgentIds: ['agent-validator'],
  requiredSkillIds: ['skill-snapshot'],
  gatingRules: ['validation-pass', 'framework-package-active'],
  ...overrides,
})

const makeWorkflowPolicyDoc = (overrides = {}) => {
  const workflowPolicy = new WorkflowPolicy({
    _id: WORKFLOW_POLICY_DB_ID,
    stableId: WORKFLOW_POLICY_STABLE_ID,
    ...buildPhaseOneWorkflowPolicyPayload(),
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
  FrameworkPackage = models.FrameworkPackage
  WorkflowPolicy = models.WorkflowPolicy
  RuntimeAgent = models.RuntimeAgent
  RuntimeSkill = models.RuntimeSkill
  RuntimePathRegistry = models.RuntimePathRegistry
  ValidationRegistry = models.ValidationRegistry
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
  FrameworkPackage.find = jest.fn()
  RuntimeAgent.find = jest.fn()
  RuntimeSkill.find = jest.fn()
  RuntimePathRegistry.find = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  WorkflowPolicy.prototype.save = jest.fn(async function save() {
    return this
  })
  WorkflowPolicy.prototype.populate = jest.fn(async function populate() {
    return this
  })

  WorkflowPolicy.countDocuments.mockReturnValue(buildCountDocumentsChain(0))
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
  FrameworkPackage.find.mockReturnValue(buildRegistryLookupChain([]))
  RuntimeAgent.find.mockReturnValue(buildRegistryLookupChain([]))
  RuntimeSkill.find.mockReturnValue(buildRegistryLookupChain([]))
  RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([]))
  ValidationRegistry.find = jest.fn().mockReturnValue(buildRegistryLookupChain([
    {
      key: 'required-sections-check',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF', 'RLD'],
      policyUsable: true,
    },
  ]))

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

  test('GET /api/v1/super-admin/runtime-control/workflow-policies returns paginated rows with framework filtering', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        stableId: 'policy-rld-publish',
        key: 'rld-publish',
        name: 'RLD Publish Policy',
        description: 'Controls publish sequencing for RLD workflow packages and report output.',
        status: 'ACTIVE',
        policyType: 'ROUTING',
        priority: 25,
        frameworkKeys: ['RLD'],
        appliesTo: 'FRAMEWORK_LIFECYCLE',
        triggerEvent: 'ON_PUBLISH',
        triggerMode: 'PRE_ACTION',
        actorScope: 'SYSTEM',
        governedAction: 'PUBLISH',
        decisionMode: 'REQUIRE_AGENT_EVALUATION',
        severity: 'CRITICAL',
        orderedSteps: ['validate', 'synthesise', 'publish'],
        requiredAgentIds: ['agent-validator', 'agent-reporter'],
        requiredSkillIds: ['skill-snapshot', 'skill-report'],
        gatingRules: ['validation-pass', 'framework-package-active'],
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    WorkflowPolicy.countDocuments.mockReturnValue(buildCountDocumentsChain(1))
    WorkflowPolicy.find.mockReturnValue(buildWorkflowPolicyQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/workflow-policies?page=1&pageSize=4&frameworkKey=RLD&status=ACTIVE&type=ROUTING&q=publish')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(WorkflowPolicy.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        policyType: 'ROUTING',
        frameworkKeys: 'RLD',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'policy-rld-publish',
      key: 'rld-publish',
      status: 'ACTIVE',
      policyType: 'ROUTING',
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
      .send({
        key: 'Bad Key',
        name: '',
        status: 'ACTIVE',
        policyType: 'VALIDATION',
        priority: 0,
        frameworkKeys: [],
        appliesTo: 'FRAMEWORK_LIFECYCLE',
        triggerEvent: '',
        triggerMode: 'PRE_ACTION',
        actorScope: 'ANY',
        governedAction: '',
        decisionMode: 'ALLOW',
        severity: 'INFO',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.name).toBe('Workflow policy name is required')
    expect(res.body.error.details.frameworkKeys).toBe('At least one framework key is required.')
    expect(res.body.error.details.priority).toContain('expected number to be >=1')
    expect(res.body.error.details.triggerEvent).toContain('expected one of')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies returns 409 when the key already exists', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: WORKFLOW_POLICY_DB_ID })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        description: 'Duplicate publish policy.',
      }))

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
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'qmf-review',
        name: 'QMF Review Policy',
        description: 'Controls QMF review sequencing.',
        frameworkKeys: ['QMF'],
        triggerEvent: 'ON_SUBMIT',
        governedAction: 'SUBMIT_FOR_REVIEW',
      }))

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.frameworkKeys).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects condition paths outside framework_state', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'vmf.validationStatus',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
      },
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-condition-scope',
        name: 'VMF Condition Scope Policy',
        conditions: [{
          path: 'vmf.validationStatus',
          operator: '=',
          value: 'PASS',
          logic: 'AND',
        }],
      }))

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.conditions).toContain('framework_state.*')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies accepts readable framework_state validation-result condition paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'framework_state.validation.required_sections.is_valid',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
        dataType: 'BOOLEAN',
      },
    ]))
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-validation-result-condition',
        name: 'VMF Validation Result Condition Policy',
        conditions: [{
          path: 'framework_state.validation.required_sections.is_valid',
          operator: '=',
          value: true,
          logic: 'AND',
        }],
      }))

    expect(res.status).toBe(201)
    expect(res.body.data.conditions).toEqual([
      {
        path: 'framework_state.validation.required_sections.is_valid',
        operator: '=',
        value: true,
      },
    ])
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
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-review',
        name: 'VMF Review Policy',
        description: 'Checks review readiness.',
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-missing'],
        requiredSkillIds: ['skill-snapshot', 'skill-missing'],
        triggerEvent: 'ON_SUBMIT',
        governedAction: 'SUBMIT_FOR_REVIEW',
      }))

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
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-report',
        name: 'VMF Report Policy',
        description: 'Invalid VMF policy with an RLD-only skill.',
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-report'],
        triggerEvent: 'ON_SUBMIT',
        governedAction: 'SUBMIT_FOR_REVIEW',
      }))

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
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-out-of-order',
        name: 'VMF Out Of Order Policy',
        description: 'Invalid publish sequencing.',
        orderedSteps: ['publish', 'validate'],
      }))

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
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-review',
        name: 'VMF Review Policy',
        description: 'Coordinates VMF review and approval transitions.',
        frameworkKeys: ['vmf'],
        policyType: 'APPROVAL',
        priority: 15,
        appliesTo: 'FRAMEWORK_LIFECYCLE',
        triggerEvent: 'ON_SUBMIT',
        triggerMode: 'PRE_ACTION',
        actorScope: 'ADMINISTRATOR',
        cooldownSeconds: 90,
        reevaluateOnRetry: true,
        governedAction: 'SUBMIT_FOR_REVIEW',
        decisionMode: 'REQUIRE_APPROVAL',
        passMessage: 'Ready for review.',
        failMessage: 'Review blocked.',
        severity: 'CRITICAL',
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-summary'],
        requiredSkillIds: ['skill-snapshot', 'skill-review'],
        gatingRules: ['framework-package-active', 'framework-package-active'],
      }))

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-review',
      key: 'vmf-review',
      name: 'VMF Review Policy',
      status: 'ACTIVE',
      policyType: 'APPROVAL',
      priority: 15,
      frameworkKeys: ['VMF'],
      triggerEvent: 'ON_SUBMIT',
      governedAction: 'SUBMIT_FOR_REVIEW',
      decisionMode: 'REQUIRE_APPROVAL',
      severity: 'CRITICAL',
      orderedSteps: ['snapshot', 'review', 'approve'],
      requiredAgentIds: ['agent-validator', 'agent-summary'],
      requiredSkillIds: ['skill-snapshot', 'skill-review'],
      gatingRules: [],
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

  test('POST /api/v1/super-admin/runtime-control/workflow-policies strips fields not used by the effect type', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-block-only',
        name: 'VMF Block Only Policy',
        onFailEffects: [{
          type: 'BLOCK_ACTION',
          targetPath: 'framework_state.policy.last_result',
          value: 'Blocked by policy.',
        }],
      }))

    expect(res.status).toBe(201)
    expect(res.body.data.onFailEffects).toEqual([
      {
        type: 'BLOCK_ACTION',
        targetPath: '',
        value: '',
      },
    ])
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies accepts phase-2 conditions, routing, and validation fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'framework_state.lifecycle.stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
      },
    ]))
    RuntimeAgent.find.mockImplementation((filter) => {
      const ids = filter?.stableId?.$in ?? []
      if (ids.includes('agent-validator')) {
        return buildRegistryLookupChain([runtimeAgentRows.validator])
      }
      return buildRegistryLookupChain([])
    })
    RuntimeSkill.find.mockReturnValue(buildRegistryLookupChain([runtimeSkillRows.snapshot]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-routed-review',
        name: 'VMF Routed Review Policy',
        triggerEvent: 'ON_SUBMIT',
        governedAction: 'SUBMIT_FOR_REVIEW',
        decisionMode: 'REQUIRE_AGENT_EVALUATION',
        conditions: [{
          path: 'framework_state.lifecycle.stage',
          operator: '=',
          value: 'DRAFT',
          logic: 'AND',
        }],
        routingMode: 'FIXED_AGENT',
        primaryAgentId: 'agent-validator',
        fallbackAgentId: '',
        timeoutMs: 45000,
        retryOverride: 'retry-once',
        requireSuccess: true,
        requiredValidationKeys: ['required-sections-check'],
        validationBlockingOnFail: true,
        validationWarningOnly: false,
        validationFreshnessMinutes: 30,
        validationRequireLatestRun: true,
      }))

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-routed-review',
      routingMode: 'FIXED_AGENT',
      primaryAgentId: 'agent-validator',
      timeoutMs: 45000,
      requireSuccess: true,
      requiredValidationKeys: ['required-sections-check'],
      validationFreshnessMinutes: 30,
      conditions: [
        expect.objectContaining({
          path: 'framework_state.lifecycle.stage',
          operator: '=',
          value: 'DRAFT',
        }),
      ],
    })
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies accepts EXISTS conditions without a comparison value', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'framework_state.lifecycle.stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
      },
    ]))
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-status-exists',
        name: 'VMF Status Exists Policy',
        conditions: [{
          path: 'framework_state.lifecycle.stage',
          operator: 'exists',
          logic: 'AND',
        }],
      }))

    expect(res.status).toBe(201)
    expect(res.body.data.conditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        operator: 'exists',
        value: '',
      }),
    ])
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies accepts IN conditions with comma-delimited values', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'framework_state.lifecycle.stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
        dataType: 'STRING',
        allowedValues: ['DRAFT', 'APPROVED'],
      },
    ]))
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-status-in',
        name: 'VMF Status In Policy',
        conditions: [{
          path: 'framework_state.lifecycle.stage',
          operator: 'in',
          value: 'DRAFT, APPROVED',
          logic: 'AND',
        }],
      }))

    expect(res.status).toBe(201)
    expect(res.body.data.conditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        operator: 'in',
        value: ['DRAFT', 'APPROVED'],
      }),
    ])
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies accepts escalation and override controls', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-escalation-review',
        name: 'VMF Escalation Review Policy',
        overrideAllowed: true,
        overrideRoles: ['SUPER_ADMIN', 'FRAMEWORK_OWNER'],
        approvalRequired: true,
        escalateTo: 'GOVERNANCE_LEAD',
        escalationMessage: 'Escalate blocked publish approvals to governance.',
        slaMinutes: 60,
      }))

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-escalation-review',
      overrideAllowed: true,
      overrideRoles: ['SUPER_ADMIN', 'FRAMEWORK_OWNER'],
      approvalRequired: true,
      escalateTo: 'GOVERNANCE_LEAD',
      escalationMessage: 'Escalate blocked publish approvals to governance.',
      slaMinutes: 60,
    })
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects approval-required escalation without an owner', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-escalation-missing-owner',
        name: 'VMF Escalation Missing Owner',
        overrideAllowed: true,
        overrideRoles: ['SUPER_ADMIN'],
        approvalRequired: true,
        escalateTo: '',
        slaMinutes: 30,
      }))

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.escalateTo).toBe('Escalate To is required when approval is required.')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies rejects protected or non-writable effect paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        pathKey: 'vmf.metadata.owner',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
      },
    ]))
    mockRegistryLookups({
      agents: [runtimeAgentRows.validator],
      skills: [runtimeSkillRows.snapshot],
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPhaseOneWorkflowPolicyPayload({
        key: 'vmf-effect-blocked',
        name: 'VMF Effect Blocked Policy',
        onPassEffects: [{
          type: 'SET_VALUE',
          targetPath: 'vmf.metadata.owner',
          value: 'governance',
        }],
      }))

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.onPassEffects).toContain('does not allow WRITE')
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
      policyType: 'LIFECYCLE_GATE',
      priority: 10,
      frameworkKeys: ['VMF'],
      triggerEvent: 'ON_PUBLISH',
      governedAction: 'PUBLISH',
      orderedSteps: ['validate', 'lock', 'publish'],
    })
  })

  test('GET /api/v1/super-admin/runtime-control/workflow-policies/:policyId returns 404 when the workflow policy is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    WorkflowPolicy.findOne.mockResolvedValue(null)

    const res = await request
      .get('/api/v1/super-admin/runtime-control/workflow-policies/policy-missing')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/v1/super-admin/runtime-control/workflow-policies/:policyId/dependencies returns dependency summary payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    WorkflowPolicy.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: WORKFLOW_POLICY_DB_ID,
          stableId: WORKFLOW_POLICY_STABLE_ID,
          key: 'vmf-publish',
          name: 'VMF Publish Policy',
          status: 'ACTIVE',
          priority: 10,
          triggerEvent: 'ON_PUBLISH',
          governedAction: 'PUBLISH',
          frameworkKeys: ['VMF'],
          primaryAgentId: 'agent-summary',
          requiredValidationKeys: ['required-sections-check'],
          conditions: [{ path: 'framework_state.lifecycle.stage', operator: '=', value: 'DRAFT', logic: 'AND' }],
          onPassEffects: [{ type: 'SET_VALUE', targetPath: 'vmf.metadata.lastValidatedAt', value: 'REVIEW_READY' }],
          onFailEffects: [],
        }),
      }),
    })
    FrameworkPackage.find.mockReturnValue(buildRegistryLookupChain([
      {
        stableId: 'package-vmf-default',
        frameworkKey: 'VMF',
        frameworkName: 'Value Messaging Framework',
        version: '1.0.0',
        status: 'ACTIVE',
      },
    ]))
    RuntimeAgent.find.mockReturnValue(buildRegistryLookupChain([
      {
        stableId: 'agent-summary',
        key: 'summary',
        name: 'Summary',
        status: 'INACTIVE',
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildRegistryLookupChain([
      {
        stableId: 'policy-vmf-review',
        key: 'vmf-review',
        name: 'VMF Review Policy',
        status: 'ACTIVE',
      },
    ]))
    RuntimePathRegistry.find.mockReturnValue(buildRuntimePathLookupChain([
      {
        stableId: 'path-vmf-status',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'VMF Status',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
      },
      {
        stableId: 'path-vmf-lastvalidatedat',
        pathKey: 'vmf.metadata.lastValidatedAt',
        label: 'VMF Last Validated At',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
      },
    ]))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/workflow-policies/${WORKFLOW_POLICY_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      policyId: 'policy-vmf-publish',
      summary: expect.objectContaining({
        frameworkPackages: 1,
        agents: 1,
        frameworks: 1,
        validationOutputs: 1,
        runtimePaths: 2,
        priorityCollisions: 1,
      }),
    })
    expect(res.body.data.referencedBy.frameworkPackages).toEqual([
      expect.objectContaining({
        frameworkKey: 'VMF',
        version: '1.0.0',
        status: 'ACTIVE',
      }),
    ])
    expect(res.body.data.uses.agents).toEqual([
      expect.objectContaining({
        key: 'summary',
        status: 'INACTIVE',
      }),
    ])
    expect(res.body.data.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('non-active Agent'),
      expect.stringContaining('Priority collision'),
    ]))
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console returns a governed preview result', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-vmf-status',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'VMF Status',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ'],
        isProtected: true,
        scope: 'FRAMEWORK_STATE',
      },
      {
        stableId: 'path-vmf-lastvalidatedat',
        pathKey: 'vmf.metadata.lastValidatedAt',
        label: 'VMF Last Validated At',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-test-console',
          name: 'VMF Test Console Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.lifecycle.stage',
            operator: '=',
            value: 'DRAFT',
            logic: 'AND',
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
          onPassEffects: [{
            type: 'SET_VALUE',
            targetPath: 'vmf.metadata.lastValidatedAt',
            value: 'REVIEW_READY',
          }],
          onFailEffects: [{
            type: 'BLOCK_ACTION',
            targetPath: '',
            value: 'Review blocked.',
          }],
        }),
        frameworkState: {
          lifecycle: {
            stage: 'DRAFT',
          },
          vmf: {
            metadata: {
              lastValidatedAt: null,
            },
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      ok: true,
      outcome: 'PASS',
      triggerMatched: true,
      actorMatched: true,
      conditionsMatched: true,
      chosenAgent: expect.objectContaining({
        id: 'agent-validator',
        key: 'validator',
      }),
      stateEffectsPreview: {
        outcome: 'PASS',
        effects: [
          expect.objectContaining({
            type: 'SET_VALUE',
            targetPath: 'vmf.metadata.lastValidatedAt',
            value: 'REVIEW_READY',
          }),
        ],
      },
    })
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        matched: true,
      }),
    ])
    expect(res.body.data.executionTrace).toEqual(expect.arrayContaining([
      expect.stringContaining('Evaluating policy'),
      expect.stringContaining('Selected governed Agent'),
    ]))
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WORKFLOW_POLICY_TESTED',
        resourceType: 'WorkflowPolicy',
        summary: 'Super Admin tested workflow policy VMF Test Console Policy (vmf-test-console)',
      }),
    )
    const auditPayload = AuditLog.createLog.mock.calls.at(-1)?.[0]
    expect(mongoose.Types.ObjectId.isValid(auditPayload?.resourceId)).toBe(true)
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console does not write audit logs when draft validation fails', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-test-console-invalid-skill',
          requiredSkillIds: ['skill-missing'],
        }),
        frameworkState: {
          vmf: {
            status: 'DRAFT',
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.requiredSkillIds).toContain('Unknown runtime skill ids')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console accepts inner framework-state JSON for framework_state-prefixed condition paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-framework-state-lifecycle-stage',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'Framework Lifecycle Stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
        dataType: 'STRING',
        allowedValues: ['DRAFT', 'SUBMITTED', 'APPROVED'],
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-framework-state-console',
          name: 'VMF Framework State Console Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.lifecycle.stage',
            operator: '=',
            value: 'DRAFT',
            logic: 'AND',
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
        }),
        frameworkState: {
          lifecycle: {
            stage: 'DRAFT',
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.conditionsMatched).toBe(true)
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        actualValue: 'DRAFT',
        matched: true,
      }),
    ])
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console accepts wrapped framework_state JSON for framework_state-prefixed condition paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-framework-state-lifecycle-stage',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'Framework Lifecycle Stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
        dataType: 'STRING',
        allowedValues: ['DRAFT', 'SUBMITTED', 'APPROVED'],
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-framework-state-console-wrapped',
          name: 'VMF Framework State Console Wrapped Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.lifecycle.stage',
            operator: '=',
            value: 'DRAFT',
            logic: 'AND',
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
        }),
        frameworkState: {
          framework_state: {
            lifecycle: {
              stage: 'DRAFT',
            },
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.conditionsMatched).toBe(true)
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        actualValue: 'DRAFT',
        matched: true,
      }),
    ])
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console uses condition logic as connector to the next row', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-framework-state-lifecycle-stage',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'Framework Lifecycle Stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'BIND'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
        dataType: 'STRING',
        allowedValues: ['DRAFT', 'SUBMITTED', 'APPROVED'],
      },
      {
        stableId: 'path-framework-state-validation-required-sections-is-valid',
        pathKey: 'framework_state.validation.required_sections.is_valid',
        label: 'Required Sections Valid',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
        dataType: 'BOOLEAN',
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-framework-state-console-or-connector',
          name: 'VMF Framework State Console OR Connector Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.lifecycle.stage',
            operator: '=',
            value: 'APPROVED',
            logic: 'OR',
          }, {
            path: 'framework_state.validation.required_sections.is_valid',
            operator: '=',
            value: true,
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
        }),
        frameworkState: {
          lifecycle: {
            stage: 'DRAFT',
          },
          validation: {
            required_sections: {
              is_valid: true,
            },
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.conditionsMatched).toBe(true)
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        matched: false,
        logic: 'OR',
      }),
      expect.objectContaining({
        path: 'framework_state.validation.required_sections.is_valid',
        actualValue: true,
        matched: true,
      }),
    ])
    expect(res.body.data.matchedConditions[1]).not.toHaveProperty('logic')
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console does not fall back when wrapped framework_state is explicitly null', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-framework-state-lifecycle-stage',
        pathKey: 'framework_state.lifecycle.stage',
        label: 'Framework Lifecycle Stage',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
        dataType: 'STRING',
        allowedValues: ['DRAFT', 'SUBMITTED', 'APPROVED'],
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-framework-state-console-null',
          name: 'VMF Framework State Console Null Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.lifecycle.stage',
            operator: '=',
            value: 'DRAFT',
            logic: 'AND',
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
        }),
        frameworkState: {
          framework_state: null,
          lifecycle: {
            stage: 'DRAFT',
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.conditionsMatched).toBe(false)
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.lifecycle.stage',
        matched: false,
      }),
    ])
    expect(res.body.data.matchedConditions[0]?.actualValue).toBeUndefined()
  })

  test('POST /api/v1/super-admin/runtime-control/workflow-policies/test-console preserves array equality for framework_state paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.find.mockImplementation(() => buildRuntimePathLookupChain([
      {
        stableId: 'path-framework-state-validation-missing-sections',
        pathKey: 'framework_state.validation.required_sections.missing_sections',
        label: 'Missing Required Sections',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'FRAMEWORK_STATE',
        dataType: 'ARRAY',
      },
    ]))
    RuntimeAgent.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeAgentRows.validator,
    ]))
    RuntimeSkill.find.mockImplementation(() => buildRegistryLookupChain([
      runtimeSkillRows.snapshot,
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/workflow-policies/test-console')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draft: buildPhaseOneWorkflowPolicyPayload({
          key: 'vmf-framework-state-console-arrays',
          name: 'VMF Framework State Console Array Policy',
          triggerEvent: 'ON_SUBMIT',
          actorScope: 'USER',
          governedAction: 'SUBMIT_FOR_REVIEW',
          decisionMode: 'REQUIRE_AGENT_EVALUATION',
          conditions: [{
            path: 'framework_state.validation.required_sections.missing_sections',
            operator: '=',
            value: ['summary', 'goals'],
            logic: 'AND',
          }],
          routingMode: 'FIXED_AGENT',
          primaryAgentId: 'agent-validator',
          requiredAgentIds: ['agent-validator'],
        }),
        frameworkState: {
          validation: {
            required_sections: {
              missing_sections: ['summary', 'goals'],
            },
          },
        },
        triggerEvent: 'ON_SUBMIT',
        actorScope: 'USER',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.conditionsMatched).toBe(true)
    expect(res.body.data.matchedConditions).toEqual([
      expect.objectContaining({
        path: 'framework_state.validation.required_sections.missing_sections',
        actualValue: ['summary', 'goals'],
        matched: true,
      }),
    ])
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
      .send({
        name: 'VMF Approval Policy',
        policyType: 'APPROVAL',
        priority: 5,
        triggerEvent: 'ON_SUBMIT',
        governedAction: 'SUBMIT_FOR_REVIEW',
        decisionMode: 'REQUIRE_APPROVAL',
        severity: 'CRITICAL',
        orderedSteps: ['snapshot', 'review', 'approve'],
        requiredAgentIds: ['agent-validator', 'agent-summary'],
        requiredSkillIds: ['skill-snapshot', 'skill-review'],
        overrideAllowed: true,
        overrideRoles: ['SUPER_ADMIN', 'GOVERNANCE_LEAD'],
        approvalRequired: true,
        escalateTo: 'OPERATIONS_ADMIN',
        escalationMessage: 'Escalate blocked approval overrides to operations.',
        slaMinutes: 45,
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: 'policy-vmf-publish',
      key: 'vmf-publish',
      name: 'VMF Approval Policy',
      policyType: 'APPROVAL',
      priority: 5,
      triggerEvent: 'ON_SUBMIT',
      governedAction: 'SUBMIT_FOR_REVIEW',
      orderedSteps: ['snapshot', 'review', 'approve'],
      requiredAgentIds: ['agent-validator', 'agent-summary'],
      requiredSkillIds: ['skill-snapshot', 'skill-review'],
      gatingRules: ['validation-pass', 'framework-package-active'],
      overrideAllowed: true,
      overrideRoles: ['SUPER_ADMIN', 'GOVERNANCE_LEAD'],
      approvalRequired: true,
      escalateTo: 'OPERATIONS_ADMIN',
      escalationMessage: 'Escalate blocked approval overrides to operations.',
      slaMinutes: 45,
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

  test('PATCH /api/v1/super-admin/runtime-control/workflow-policies/:policyId returns 404 when the workflow policy is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    WorkflowPolicy.findOne.mockResolvedValue(null)

    const res = await request
      .patch('/api/v1/super-admin/runtime-control/workflow-policies/policy-missing')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Missing policy' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/super-admin/runtime-control/workflow-policies/:policyId rejects key changes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const workflowPolicy = makeWorkflowPolicyDoc()
    WorkflowPolicy.findOne.mockResolvedValue(workflowPolicy)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/workflow-policies/${WORKFLOW_POLICY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'vmf-renamed' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.key).toBe('Workflow policy key is immutable after creation.')
  })
})
