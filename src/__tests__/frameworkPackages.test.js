import mongoose from 'mongoose'
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
const FRAMEWORK_PACKAGE_ID = '607f1f77bcf86cd799439022'
const ACTIVE_FRAMEWORK_PACKAGE_ID = '607f1f77bcf86cd799439023'

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn(async () => {}),
})

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

const buildFrameworkPackageQueryChain = (rows) => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  }
  return chain
}

const buildRoleQueryChain = (rows) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  }
  return chain
}

const buildFrameworkRegistryLookupChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
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

const buildDefaultSectionRuntimePathRows = () => ([
  {
    pathKey: 'framework_state.sections.customer_problem',
    status: 'ACTIVE',
    frameworkKeys: ['VMF'],
    scope: 'FRAMEWORK_STATE',
    category: 'SECTION',
  },
])

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let FrameworkPackage
let RuntimeAgent
let RuntimeSkill
let ValidationRegistry
let WorkflowPolicy
let UIContract
let RuntimePathRegistry
let AuditLog
let mockRedisClient
let frameworkPackageController
let originalFrameworkPackageSave
let originalFrameworkPackagePopulate
let startSessionSpy

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  FrameworkPackage.findOne.mockReturnValue({ select })
  return select
}

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const makeFrameworkPackageDoc = (overrides = {}) => {
  const frameworkPackage = new FrameworkPackage({
    _id: FRAMEWORK_PACKAGE_ID,
    frameworkKey: 'VMF',
    frameworkName: 'Value Management Framework',
    version: '2.3.1',
    packageKey: 'vmf-2-3-1',
    packageName: 'VMF 2.3.1',
    packageScope: 'SYSTEM',
    packageType: 'STANDARD',
    description: 'Current VMF package',
    status: 'VALIDATED',
    isDefault: false,
    visibility: 'INTERNAL_ONLY',
    customerAccessMode: 'ALL_CUSTOMERS',
    assignedCustomerIds: [],
    sections: [
      {
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
        required: true,
        validationKeys: [],
        notes: '',
      },
    ],
    runtimeSettings: {
      enablePreviewMode: true,
      enableRuntimeValidation: true,
      requireValidationBeforePublish: true,
      allowManualValidationRun: true,
      allowPolicyRetry: true,
      retryPolicy: 'RETRY_ONCE',
      defaultTimeoutMs: 30000,
      maxPolicyExecutionsPerRun: 10,
    },
    validationConfig: [],
    workflowPolicyConfig: [],
    validationBindings: [],
    workflowBindings: [],
    uiContractKey: 'vmf-ui-contract-v1',
    stateModelKey: null,
    stateModelVersion: null,
    stateModelMode: 'INTERNAL',
    availableOutputKeys: ['board-summary'],
    defaultOutputStyles: ['executive-concise'],
    allowCustomerOutputDefinitions: false,
    artifactRetentionDays: 365,
    allowOutputRevisionHistory: true,
    compatibleWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
    defaultAgentIds: ['agent-validator'],
    requiredSkillIds: ['skill-snapshot'],
    capabilities: {
      supportsPreviewMode: true,
      supportsFullReport: true,
      requiresValidationBeforePublish: true,
    },
    validationRules: {
      requiredSections: ['customer_problem'],
      publishChecks: ['validation-pass'],
    },
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    activatedAt: null,
    activatedBy: null,
    ...overrides,
  })

  frameworkPackage.save = jest.fn(async function save() {
    return this
  })
  frameworkPackage.populate = jest.fn(async function populate() {
    return this
  })

  return frameworkPackage
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
  RuntimeAgent = models.RuntimeAgent
  RuntimeSkill = models.RuntimeSkill
  ValidationRegistry = models.ValidationRegistry
  WorkflowPolicy = models.WorkflowPolicy
  UIContract = models.UIContract
  RuntimePathRegistry = models.RuntimePathRegistry
  AuditLog = models.AuditLog
  frameworkPackageController = await import('../controllers/frameworkPackage.controller.js')

  startSessionSpy = jest.spyOn(mongoose, 'startSession')
  originalFrameworkPackageSave = FrameworkPackage.prototype.save
  originalFrameworkPackagePopulate = FrameworkPackage.prototype.populate
})

afterAll(() => {
  FrameworkPackage.prototype.save = originalFrameworkPackageSave
  FrameworkPackage.prototype.populate = originalFrameworkPackagePopulate
  startSessionSpy?.mockRestore()
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

  FrameworkPackage.find = jest.fn()
  FrameworkPackage.countDocuments = jest.fn()
  FrameworkPackage.findOne = jest.fn()
  FrameworkPackage.findById = jest.fn()
  FrameworkPackage.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
  FrameworkRegistry.find = jest.fn()
  RuntimeAgent.find = jest.fn()
  RuntimeSkill.find = jest.fn()
  ValidationRegistry.find = jest.fn()
  WorkflowPolicy.find = jest.fn()
  UIContract.findOne = jest.fn()
  RuntimePathRegistry.find = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  FrameworkPackage.prototype.save = jest.fn(async function save() {
    return this
  })
  FrameworkPackage.prototype.populate = jest.fn(async function populate() {
    return this
  })
  FrameworkPackage.countDocuments.mockResolvedValue(0)
  FrameworkPackage.find.mockReturnValue(buildFrameworkPackageQueryChain([]))
  FrameworkPackage.findOne.mockReturnValue({
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
  ValidationRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([]))
  WorkflowPolicy.find.mockReturnValue(buildFrameworkRegistryLookupChain([]))
  RuntimePathRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain(buildDefaultSectionRuntimePathRows()))
  RuntimeAgent.find.mockReturnValue(buildFrameworkRegistryLookupChain([]))
  RuntimeSkill.find.mockReturnValue(buildFrameworkRegistryLookupChain([]))
  UIContract.findOne.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  })

  AuditLog.createLog = jest.fn(async () => ({}))
  AuditLog.find = jest.fn().mockReturnValue(buildFrameworkPackageQueryChain([]))
  AuditLog.countDocuments = jest.fn().mockResolvedValue(0)
  startSessionSpy.mockResolvedValue(buildSession())
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
})

describe('Framework Package Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/framework-packages returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/framework-packages')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

test('POST /api/v1/super-admin/runtime-control/framework-packages returns 422 for invalid payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'vmf',
        frameworkName: '',
        version: '2.3',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('frameworkName')
    expect(res.body.error.details).toHaveProperty('version')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects unknown framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'QMF',
        frameworkName: 'Quality Messaging Framework',
        version: '2.3.1',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.frameworkKey).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages creates a framework package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem' }],
        }),
      }),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
        packageKey: 'vmf-2-3-1',
        packageName: 'VMF 2.3.1',
        packageScope: 'SYSTEM',
        packageType: 'STANDARD',
        derivedFromPackageId: 'pkg-source-230',
        description: 'Current VMF package',
        status: 'VALIDATED',
        visibility: 'CUSTOMER_VISIBLE',
        customerAccessMode: 'ALL_CUSTOMERS',
        assignedCustomerIds: [],
        uiContractKey: 'vmf-ui-contract-v1',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: true,
            validationKeys: [],
            notes: '',
          },
        ],
        runtimeSettings: {
          enablePreviewMode: true,
          enableRuntimeValidation: true,
          requireValidationBeforePublish: true,
          allowManualValidationRun: true,
          allowPolicyRetry: true,
          retryPolicy: 'RETRY_ONCE',
          defaultTimeoutMs: 30000,
          maxPolicyExecutionsPerRun: 10,
        },
        availableOutputKeys: ['board-summary'],
        defaultOutputStyles: ['executive-concise'],
        allowCustomerOutputDefinitions: false,
        artifactRetentionDays: 365,
        allowOutputRevisionHistory: true,
        capabilities: {
          supportsPreviewMode: true,
          supportsFullReport: true,
          requiresValidationBeforePublish: true,
        },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.frameworkKey).toBe('VMF')
    expect(res.body.data.version).toBe('2.3.1')
    expect(res.body.data.packageKey).toBe('vmf-2-3-1')
    expect(res.body.data.derivedFromPackageId).toBe('pkg-source-230')
    expect(res.body.data.sections[0].sectionKey).toBe('customer_problem')
    expect(res.body.data.sections[0].runtimePath).toBe('framework_state.sections.customer_problem')
    expect(res.body.data.stateModelKey).toBeNull()
    expect(res.body.data.stateModelVersion).toBeNull()
    expect(res.body.data.stateModelMode).toBe('INTERNAL')
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.validationConfig).toBeUndefined()
    expect(res.body.data.workflowPolicyConfig).toBeUndefined()
    expect(res.body.data.compatibleWorkflowKeys).toBeUndefined()
    expect(res.body.data.defaultAgentIds).toBeUndefined()
    expect(res.body.data.requiredSkillIds).toBeUndefined()
    expect(res.body.data.validationRules).toBeUndefined()
    expect(res.body.data.availableOutputKeys).toContain('board-summary')
    expect(res.body.data.updatedBy.id).toBe(SUPER_ADMIN_ID)
    expect(FrameworkPackage.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_CREATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin created framework package VMF 2.3.1',
      diff: expect.objectContaining({
        derivedFromPackageId: 'pkg-source-230',
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_VALIDATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin validated framework package VMF 2.3.1',
      diff: expect.objectContaining({
        status: {
          from: null,
          to: 'VALIDATED',
        },
      }),
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages validates selected customer access', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.1',
        visibility: 'CUSTOMER_VISIBLE',
        customerAccessMode: 'SELECTED_CUSTOMERS',
        assignedCustomerIds: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toHaveProperty('assignedCustomerIds')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects internal-only selected customer access mode', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.3',
        visibility: 'INTERNAL_ONLY',
        customerAccessMode: 'SELECTED_CUSTOMERS',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.customerAccessMode).toBe(
      'Internal-only packages must use all-customers access mode.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects deprecated legacy runtime contract fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.4',
        validationConfig: [{ validationKey: 'required-sections-check' }],
        workflowPolicyConfig: [{ policyKey: 'vmf-publish' }],
        compatibleWorkflowKeys: ['vmf-baseline'],
        defaultAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        validationRules: {
          requiredSections: ['customer_problem'],
          publishChecks: ['validation-pass'],
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.validationConfig).toContain('validationBindings')
    expect(res.body.error.details.workflowPolicyConfig).toContain('workflowBindings')
    expect(res.body.error.details.compatibleWorkflowKeys).toContain('workflowBindings')
    expect(res.body.error.details.defaultAgentIds).toContain('workflow policies')
    expect(res.body.error.details.requiredSkillIds).toContain('workflow policies')
    expect(res.body.error.details.validationRules).toContain('validationBindings')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects empty deprecated legacy fields at validation boundary', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.45',
        validationConfig: [],
        workflowPolicyConfig: [],
        compatibleWorkflowKeys: [],
        defaultAgentIds: [],
        requiredSkillIds: [],
        validationRules: {
          requiredSections: [],
          publishChecks: [],
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.validationConfig).toContain('validationBindings')
    expect(res.body.error.details.workflowPolicyConfig).toContain('workflowBindings')
    expect(res.body.error.details.compatibleWorkflowKeys).toContain('workflowBindings')
    expect(res.body.error.details.defaultAgentIds).toContain('workflow policies')
    expect(res.body.error.details.requiredSkillIds).toContain('workflow policies')
    expect(res.body.error.details.validationRules).toContain('validationBindings')
  })

  test('controller deprecated-field guard rejects deprecated fields if route validation is bypassed', () => {
    const details = frameworkPackageController.validateDeprecatedFrameworkPackageFields({
      validationConfig: [],
      workflowPolicyConfig: [],
      compatibleWorkflowKeys: [],
    })

    expect(details.validationConfig).toContain('validationBindings')
    expect(details.workflowPolicyConfig).toContain('workflowBindings')
    expect(details.compatibleWorkflowKeys).toContain('workflowBindings')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages requires package key before validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.5',
        status: 'VALIDATED',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.packageKey).toBe('Package key is required before validation.')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages requires UI Contract before validating packages with sections', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.6',
        packageKey: 'vmf-2-4-6',
        status: 'VALIDATED',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: true,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.uiContractKey).toBe(
      'UI Contract is required before validation when sections are configured.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages validates governed registry links', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    ValidationRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        key: 'required-sections-check',
        status: 'ACTIVE',
        packageUsable: true,
        supportedFrameworkKeys: ['VMF'],
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        key: 'vmf-publish',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
      },
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.2',
        validationBindings: [
          {
            bindingKey: 'required-sections-on-submit',
            validationKey: 'required-sections-check',
            trigger: 'ON_SUBMIT',
            blocking: true,
            priority: 100,
            enabled: true,
          },
        ],
        workflowBindings: [
          {
            policyKey: 'vmf-publish',
            executionContext: 'ON_SUBMIT',
            priority: 100,
            enabled: true,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.validationBindings[0].validationKey).toBe('required-sections-check')
    expect(res.body.data.workflowBindings[0].policyKey).toBe('vmf-publish')
    expect(res.body.data.validationConfig).toBeUndefined()
    expect(res.body.data.workflowPolicyConfig).toBeUndefined()
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages creates Sprint 2 package bindings', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    ValidationRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        key: 'required-sections-check',
        status: 'ACTIVE',
        packageUsable: true,
        supportedFrameworkKeys: ['VMF'],
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        key: 'vmf-submit-gate',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
      },
    ]))
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem' }],
        }),
      }),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.5.0',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: true,
            validationKeys: ['required-sections-check'],
            notes: '',
          },
        ],
        executionModel: {
          mode: 'EVENT_DRIVEN',
          stateModel: 'LIFECYCLE_BASED',
          evaluationMode: 'POLICY_DRIVEN',
        },
        validationBindings: [
          {
            bindingKey: 'required-sections-on-submit',
            validationKey: 'required-sections-check',
            trigger: 'ON_SUBMIT',
            blocking: true,
            priority: 100,
            enabled: true,
          },
        ],
        workflowBindings: [
          {
            policyKey: 'vmf-submit-gate',
            executionContext: 'ON_SUBMIT',
            priority: 100,
            enabled: true,
          },
        ],
        uiContractKey: 'vmf-ui-contract-v1',
        stateModelKey: 'vmf-state-model-v2-5-0',
        stateModelVersion: '2.5.0',
        stateModelMode: 'EXTERNAL',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.executionModel.mode).toBe('EVENT_DRIVEN')
    expect(res.body.data.sections[0].runtimePath).toBe('framework_state.sections.customer_problem')
    expect(res.body.data.sections[0].validationKeys).toContain('required-sections-check')
    expect(res.body.data.validationBindings[0].trigger).toBe('ON_SUBMIT')
    expect(res.body.data.workflowBindings[0].executionContext).toBe('ON_SUBMIT')
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.stateModelKey).toBe('vmf-state-model-v2-5-0')
    expect(res.body.data.stateModelVersion).toBe('2.5.0')
    expect(res.body.data.stateModelMode).toBe('EXTERNAL')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects invalid section runtime paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    RuntimePathRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        pathKey: 'framework_state.sections.customer_problem',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        scope: 'FRAMEWORK_STATE',
        category: 'STATE',
      },
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.5.3',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: true,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.sections).toContain('FRAMEWORK_STATE/SECTION')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects package sections missing from selected UI Contract', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [],
        }),
      }),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.5.4',
        uiContractKey: 'vmf-ui-contract-v1',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: true,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.sections).toContain('missing presentation mappings')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects missing UI Contract references', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.5.2',
        uiContractKey: 'missing-ui-contract',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.uiContractKey).toBe(
      'UI Contract "missing-ui-contract" was not found.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects duplicate Sprint 2 bindings', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.5.1',
        validationBindings: [
          { bindingKey: 'required-sections-submit', validationKey: 'required-sections-check', trigger: 'ON_SUBMIT', priority: 100 },
          { bindingKey: 'required-sections-submit', validationKey: 'required-sections-check', trigger: 'ON_SUBMIT', priority: 200 },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details['validationBindings.1.bindingKey']).toBe(
      'Validation binding id must be unique within a package.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects oversized or deeply nested binding parameters', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const basePayload = {
      frameworkKey: 'VMF',
      frameworkName: 'Value Management Framework',
      version: '2.5.4',
    }
    const baseBinding = {
      bindingKey: 'required-sections-on-submit',
      validationKey: 'required-sections-check',
      trigger: 'ON_SUBMIT',
      priority: 100,
    }

    const oversizedRes = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...basePayload,
        validationBindings: [
          {
            ...baseBinding,
            parameters: { value: 'x'.repeat(4096) },
          },
        ],
      })

    expect(oversizedRes.status).toBe(422)
    expect(oversizedRes.body.error.details['validationBindings.0.parameters']).toBe(
      'Validation binding parameters must be 4096 characters or fewer.',
    )

    const deeplyNestedRes = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...basePayload,
        validationBindings: [
          {
            ...baseBinding,
            bindingKey: 'required-sections-on-save',
            parameters: {
              one: {
                two: {
                  three: {
                    four: {
                      five: {
                        six: true,
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      })

    expect(deeplyNestedRes.status).toBe(422)
    expect(deeplyNestedRes.body.error.details['validationBindings.0.parameters']).toBe(
      'Validation binding parameters cannot be nested more than 5 levels.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages returns 409 for duplicate framework/version', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: '607f1f77bcf86cd799439099' })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_VERSION_CONFLICT')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages returns paginated framework packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        _id: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
        description: 'Current VMF package',
        status: 'ACTIVE',
        isDefault: true,
        compatibleWorkflowKeys: ['vmf-baseline'],
        defaultAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        capabilities: {
          supportsPreviewMode: true,
          supportsFullReport: true,
          requiresValidationBeforePublish: true,
        },
        validationRules: {
          requiredSections: ['overview'],
          publishChecks: ['validation-pass'],
        },
        updatedAt: '2026-04-08T09:15:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    FrameworkPackage.countDocuments.mockResolvedValue(1)
    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/framework-packages?page=1&pageSize=20')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.data[0].updatedBy.name).toBe('Super Administrator')
    expect(res.body.data[0].compatibleWorkflowKeys).toBeUndefined()
    expect(res.body.data[0].defaultAgentIds).toBeUndefined()
    expect(res.body.data[0].requiredSkillIds).toBeUndefined()
    expect(res.body.data[0].validationRules).toBeUndefined()
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages searches validation binding keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        _id: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '0.5.33',
        packageKey: 'qa-validation-binding-0503-1333',
        packageName: 'QA Validation Binding',
        description: 'QA package with duplicate validation definitions',
        status: 'DRAFT',
        isDefault: false,
        validationBindings: [
          {
            bindingKey: 'required-sections-check-on-submit-2',
            validationKey: 'required-sections-check',
            trigger: 'ON_SUBMIT',
            priority: 225,
            blocking: true,
            enabled: true,
          },
        ],
        updatedAt: '2026-05-03T13:33:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    FrameworkPackage.countDocuments.mockResolvedValue(1)
    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/framework-packages?q=required-sections-check-on-submit-2')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkPackage.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { 'validationBindings.bindingKey': expect.any(RegExp) },
          { 'validationBindings.validationKey': expect.any(RegExp) },
        ]),
      }),
    )
    expect(res.body.data[0].validationBindings[0].bindingKey).toBe('required-sections-check-on-submit-2')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId returns 404 when not found', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId rejects direct activation through update', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'VALIDATED',
    }))
    mockFindOneSelect(null)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'ACTIVE',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_USE_ACTIVATE_ENDPOINT')
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId rejects merged access conflicts', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      visibility: 'INTERNAL_ONLY',
      customerAccessMode: 'ALL_CUSTOMERS',
      assignedCustomerIds: [],
    }))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerAccessMode: 'SELECTED_CUSTOMERS',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.customerAccessMode).toBe(
      'Internal-only packages must use all-customers access mode.',
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId rejects empty deprecated legacy fields before update diffing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        validationConfig: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.validationConfig).toContain('validationBindings')
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId updates a framework package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkPackage = makeFrameworkPackageDoc({ status: 'DRAFT' })
    FrameworkPackage.findById.mockResolvedValue(frameworkPackage)
    mockFindOneSelect(null)
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem' }],
        }),
      }),
    })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Updated framework package description',
        derivedFromPackageId: 'pkg-source-230',
        uiContractKey: 'vmf-ui-contract-v1',
        stateModelKey: 'vmf-state-model-v2-3-1',
        stateModelVersion: '2.3.1',
        stateModelMode: 'EXTERNAL',
      })

    expect(res.status).toBe(200)
    expect(frameworkPackage.save).toHaveBeenCalled()
    expect(res.body.data.description).toBe('Updated framework package description')
    expect(res.body.data.derivedFromPackageId).toBe('pkg-source-230')
    expect(res.body.data.stateModelKey).toBe('vmf-state-model-v2-3-1')
    expect(res.body.data.stateModelVersion).toBe('2.3.1')
    expect(res.body.data.stateModelMode).toBe('EXTERNAL')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_UPDATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin updated framework package VMF 2.3.1',
      diff: expect.objectContaining({
        derivedFromPackageId: {
          from: '',
          to: 'pkg-source-230',
        },
      }),
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages requires external state model key and version', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.6.0',
        stateModelMode: 'EXTERNAL',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.stateModelKey).toBe(
      'State Model key is required when State Model Mode is EXTERNAL.',
    )
    expect(res.body.error.details.stateModelVersion).toBe(
      'State Model version is required when State Model Mode is EXTERNAL.',
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId blocks structural edits after validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({ status: 'VALIDATED' }))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            required: false,
            validationKeys: [],
            notes: '',
          },
        ],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_VALIDATED_STRUCTURAL_LOCKED')
    expect(res.body.error.details.fields.sections).toContain('lock structural runtime fields')
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId blocks direct active package edits', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({ status: 'ACTIVE', isDefault: true }))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Should require clone',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_ACTIVE_EDIT_LOCKED')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId/dependencies resolves package dependencies', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      validationBindings: [
        {
          bindingKey: 'required-sections-on-submit',
          validationKey: 'required-sections-check',
          trigger: 'ON_SUBMIT',
          blocking: true,
          priority: 100,
          enabled: true,
        },
      ],
      workflowBindings: [
        {
          policyKey: 'vmf-submit-gate',
          executionContext: 'ON_SUBMIT',
          priority: 100,
          enabled: true,
        },
      ],
    }))
    ValidationRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'validation-required-sections-check',
        key: 'required-sections-check',
        label: 'Required Sections',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
        packageUsable: true,
        producerSkillId: 'skill-validator',
        defaultAgentIds: ['agent-reviewer'],
        outputPath: 'validation_results.required_sections',
      },
    ]))
    WorkflowPolicy.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'policy-vmf-submit-gate',
        key: 'vmf-submit-gate',
        name: 'VMF Submit Gate',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        primaryAgentId: 'agent-reviewer',
        requiredSkillIds: ['skill-validator'],
        conditions: [{ path: 'framework_state.sections.customer_problem' }],
      },
    ]))
    RuntimeAgent.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'agent-reviewer',
        key: 'reviewer',
        name: 'Reviewer Agent',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
        defaultSkillIds: ['skill-validator'],
      },
    ]))
    RuntimeSkill.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'skill-validator',
        key: 'validator',
        name: 'Validator Skill',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
        category: 'VALIDATION',
      },
    ]))
    RuntimePathRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'path-customer-problem',
        pathKey: 'framework_state.sections.customer_problem',
        label: 'Customer Problem',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        scope: 'FRAMEWORK_STATE',
        category: 'SECTION',
      },
      {
        stableId: 'path-required-sections',
        pathKey: 'validation_results.required_sections',
        label: 'Required Sections Result',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        scope: 'VALIDATION_RESULT',
        category: 'VALIDATION',
      },
    ]))
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          stableId: 'ui-contract-vmf-ui-contract-v1',
          uiContractKey: 'vmf-ui-contract-v1',
          name: 'VMF UI Contract',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sourcePackageVersion: '2.3.1',
          compatibilityMode: 'INHERITED_MINOR',
        }),
      }),
    })

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.summary.agents).toBe(1)
    expect(res.body.data.summary.skills).toBe(1)
    expect(res.body.data.summary.validations).toBe(1)
    expect(res.body.data.summary.workflowPolicies).toBe(1)
    expect(res.body.data.uiContract.key).toBe('vmf-ui-contract-v1')
    expect(res.body.data.agents[0].key).toBe('reviewer')
    expect(res.body.data.skills[0].key).toBe('validator')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId/integrity returns structured checks', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'VALIDATED',
      packageKey: '',
      compatibleWorkflowKeys: undefined,
      defaultAgentIds: undefined,
      requiredSkillIds: undefined,
      validationConfig: undefined,
      validationRules: undefined,
      workflowPolicyConfig: undefined,
    }))
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem', runtimePath: 'framework_state.sections.customer_problem' }],
        }),
      }),
    })

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/integrity`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('FAIL')
    expect(res.body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'packageKey.required',
          severity: 'FAIL',
          field: 'packageKey',
        }),
      ]),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId/integrity fails on unresolved dependencies', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'ACTIVE',
      isDefault: true,
      validationBindings: [
        {
          bindingKey: 'governance-completeness-on-submit',
          validationKey: 'governance-completeness',
          trigger: 'ON_SUBMIT',
          blocking: true,
          priority: 100,
          enabled: true,
        },
      ],
      compatibleWorkflowKeys: undefined,
      defaultAgentIds: undefined,
      requiredSkillIds: undefined,
      validationConfig: undefined,
      validationRules: undefined,
      workflowPolicyConfig: undefined,
    }))
    ValidationRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'validation-governance-completeness',
        key: 'governance-completeness',
        label: 'Governance Completeness',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
        packageUsable: true,
        defaultAgentIds: ['agent-vmf-governance-validator-agent'],
        passFieldPath: 'framework_state.validation.governance_completeness.is_valid',
        detailsFieldPath: 'framework_state.validation.governance_completeness.message',
      },
    ]))
    RuntimeAgent.find.mockReturnValue(buildFrameworkRegistryLookupChain([]))
    RuntimePathRegistry.find.mockReturnValue(buildFrameworkRegistryLookupChain([
      {
        stableId: 'path-customer-problem',
        pathKey: 'framework_state.sections.customer_problem',
        label: 'Customer Problem',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        scope: 'FRAMEWORK_STATE',
        category: 'SECTION',
      },
    ]))
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem', runtimePath: 'framework_state.sections.customer_problem' }],
        }),
      }),
    })

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/integrity`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('FAIL')
    expect(res.body.data.summary.fail).toBeGreaterThanOrEqual(2)
    expect(res.body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'dependencies.agents',
          severity: 'FAIL',
          message: expect.stringContaining('agent-vmf-governance-validator-agent'),
        }),
        expect.objectContaining({
          key: 'dependencies.runtimePaths',
          severity: 'FAIL',
          message: expect.stringContaining('framework_state.validation.governance_completeness.is_valid'),
        }),
      ]),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId/audit returns scoped audit events', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc())
    AuditLog.find.mockReturnValue(buildFrameworkPackageQueryChain([
      {
        _id: '707f1f77bcf86cd799439099',
        ts: '2026-05-01T10:00:00.000Z',
        actorUserId: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        action: 'FRAMEWORK_PACKAGE_UPDATED',
        resourceType: 'FrameworkPackage',
        resourceId: FRAMEWORK_PACKAGE_ID,
        diff: { description: { from: 'Old', to: 'New' } },
      },
    ]))
    AuditLog.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/audit`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].action).toBe('FRAMEWORK_PACKAGE_UPDATED')
    expect(res.body.meta.totalCount).toBe(1)
  })

  test('GET /api/v1/super-admin/runtime-control/framework-packages/:packageId/diff/:version returns honest scaffold', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc())

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/diff/2.3.0`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(501)
    expect(res.body.error.code).toBe('FRAMEWORK_PACKAGE_DIFF_NOT_AVAILABLE')
    expect(res.body.error.details.requestedVersion).toBe('2.3.0')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages/:packageId/activate rejects non-validated packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'DRAFT',
    }))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_ACTIVATION_REQUIRES_VALIDATED')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages/:packageId/activate enforces runtime package readiness', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'VALIDATED',
      uiContractKey: '',
    }))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.uiContractKey).toBe(
      'UI Contract is required before validation when sections are configured.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages/:packageId/activate activates a validated package and demotes the previous active package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkPackage = makeFrameworkPackageDoc({
      _id: FRAMEWORK_PACKAGE_ID,
      status: 'VALIDATED',
    })
    const activePackage = makeFrameworkPackageDoc({
      _id: ACTIVE_FRAMEWORK_PACKAGE_ID,
      version: '2.3.0',
      packageKey: '',
      status: 'ACTIVE',
      isDefault: true,
    })

    FrameworkPackage.findById.mockResolvedValue(frameworkPackage)
    FrameworkPackage.find.mockReturnValue({
      session: jest.fn().mockResolvedValue([activePackage]),
    })
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem' }],
        }),
      }),
    })

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(frameworkPackage.save).toHaveBeenCalled()
    expect(activePackage.save).not.toHaveBeenCalled()
    expect(FrameworkPackage.updateOne).toHaveBeenCalledWith(
      { _id: activePackage._id },
      {
        $set: expect.objectContaining({
          status: 'VALIDATED',
          isDefault: false,
          updatedBy: SUPER_ADMIN_ID,
        }),
      },
      expect.objectContaining({ runValidators: false }),
    )
    expect(frameworkPackage.status).toBe('ACTIVE')
    expect(frameworkPackage.isDefault).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_ACTIVATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin activated framework package VMF 2.3.1',
      diff: expect.objectContaining({
        previousActivePackageIds: [ACTIVE_FRAMEWORK_PACKAGE_ID],
      }),
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages/:packageId/activate records empty previous active ids for first activation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkPackage = makeFrameworkPackageDoc({
      _id: FRAMEWORK_PACKAGE_ID,
      status: 'VALIDATED',
    })

    FrameworkPackage.findById.mockResolvedValue(frameworkPackage)
    FrameworkPackage.find.mockReturnValue({
      session: jest.fn().mockResolvedValue([]),
    })
    UIContract.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uiContractKey: 'vmf-ui-contract-v1',
          status: 'ACTIVE',
          frameworkKeys: ['VMF'],
          sections: [{ sectionKey: 'customer_problem' }],
        }),
      }),
    })

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkPackage.updateOne).not.toHaveBeenCalled()
    expect(frameworkPackage.status).toBe('ACTIVE')
    expect(frameworkPackage.isDefault).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_ACTIVATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      diff: expect.objectContaining({
        previousActivePackageIds: [],
      }),
    }))
  })
})
