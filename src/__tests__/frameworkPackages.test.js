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
const STEP_UP_TOKEN = 'step-up-token'

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

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let FrameworkPackage
let ValidationRegistry
let WorkflowPolicy
let AuditLog
let mockRedisClient
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
      { sectionKey: 'overview', label: 'Overview', required: true, displayOrder: 10 },
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
      requiredSections: ['overview', 'value-drivers'],
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
  ValidationRegistry = models.ValidationRegistry
  WorkflowPolicy = models.WorkflowPolicy
  AuditLog = models.AuditLog

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
  FrameworkRegistry.find = jest.fn()
  ValidationRegistry.find = jest.fn()
  WorkflowPolicy.find = jest.fn()
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

  AuditLog.createLog = jest.fn(async () => ({}))
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

  test('POST /api/v1/super-admin/runtime-control/framework-packages returns 403 when step-up token is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACCESS_DENIED',
      resourceType: 'User',
      requestId: res.body.error.requestId,
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages returns 403 when step-up token is invalid', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const originalGet = mockRedisClient.get
    mockRedisClient.get = jest.fn().mockResolvedValue(null)

    try {
      const res = await request
        .post('/api/v1/super-admin/runtime-control/framework-packages')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Step-Up-Token', STEP_UP_TOKEN)
        .send({
          frameworkKey: 'VMF',
          frameworkName: 'Value Management Framework',
          version: '2.3.1',
        })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('STEP_UP_INVALID')
      expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ACCESS_DENIED',
        resourceType: 'User',
      }))
    } finally {
      mockRedisClient.get = originalGet
    }
  })

test('POST /api/v1/super-admin/runtime-control/framework-packages returns 422 for invalid payload', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
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
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'QMF',
        frameworkName: 'Quality Messaging Framework',
        version: '2.3.1',
        compatibleWorkflowKeys: ['qmf-release'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.frameworkKey).toBe('Unknown framework key "QMF".')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages creates a framework package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.3.1',
        packageKey: 'vmf-2-3-1',
        packageName: 'VMF 2.3.1',
        packageScope: 'SYSTEM',
        packageType: 'STANDARD',
        description: 'Current VMF package',
        status: 'VALIDATED',
        visibility: 'CUSTOMER_VISIBLE',
        customerAccessMode: 'ALL_CUSTOMERS',
        assignedCustomerIds: [],
        sections: [
          { sectionKey: 'overview', label: 'Overview', required: true, displayOrder: 10 },
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
        compatibleWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
        defaultAgentIds: ['agent-validator'],
        requiredSkillIds: ['skill-snapshot'],
        capabilities: {
          supportsPreviewMode: true,
          supportsFullReport: true,
          requiresValidationBeforePublish: true,
        },
        validationRules: {
          requiredSections: ['overview', 'value-drivers'],
          publishChecks: ['validation-pass'],
        },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.frameworkKey).toBe('VMF')
    expect(res.body.data.version).toBe('2.3.1')
    expect(res.body.data.packageKey).toBe('vmf-2-3-1')
    expect(res.body.data.sections[0].sectionKey).toBe('overview')
    expect(res.body.data.availableOutputKeys).toContain('board-summary')
    expect(res.body.data.updatedBy.id).toBe(SUPER_ADMIN_ID)
    expect(FrameworkPackage.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_CREATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin created framework package VMF 2.3.1',
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages validates selected customer access', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
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
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
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

  test('POST /api/v1/super-admin/runtime-control/framework-packages rejects conflicting validation overrides', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const blockingWarningRes = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.4',
        validationConfig: [
          {
            validationKey: 'required-sections-check',
            blockingOverride: true,
            warningOnlyOverride: true,
          },
        ],
      })

    expect(blockingWarningRes.status).toBe(422)
    expect(blockingWarningRes.body.error.details['validationConfig.0.warningOnlyOverride']).toBe(
      'Validation cannot be both blocking and warning-only.',
    )

    const latestFreshnessRes = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.5',
        validationConfig: [
          {
            validationKey: 'required-sections-check',
            requiresLatestRunOverride: true,
            freshnessOverrideMinutes: 60,
          },
        ],
      })

    expect(latestFreshnessRes.status).toBe(422)
    expect(latestFreshnessRes.body.error.details['validationConfig.0.freshnessOverrideMinutes']).toBe(
      'Freshness override must be empty when latest-run override is required.',
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
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'VMF',
        frameworkName: 'Value Management Framework',
        version: '2.4.2',
        validationConfig: [{ validationKey: 'required-sections-check', enabled: true }],
        workflowPolicyConfig: [{ policyKey: 'vmf-publish', enabled: true, executionOrder: 10 }],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.validationConfig[0].validationKey).toBe('required-sections-check')
    expect(res.body.data.workflowPolicyConfig[0].policyKey).toBe('vmf-publish')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages returns 409 for duplicate framework/version', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: '607f1f77bcf86cd799439099' })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-packages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
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
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
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
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        customerAccessMode: 'SELECTED_CUSTOMERS',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.customerAccessMode).toBe(
      'Internal-only packages must use all-customers access mode.',
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-packages/:packageId updates a framework package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkPackage = makeFrameworkPackageDoc()
    FrameworkPackage.findById.mockResolvedValue(frameworkPackage)
    mockFindOneSelect(null)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        description: 'Updated framework package description',
        compatibleWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
      })

    expect(res.status).toBe(200)
    expect(frameworkPackage.save).toHaveBeenCalled()
    expect(res.body.data.description).toBe('Updated framework package description')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_UPDATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin updated framework package VMF 2.3.1',
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/framework-packages/:packageId/activate rejects non-validated packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackageDoc({
      status: 'DRAFT',
    }))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('FRAMEWORK_PACKAGE_ACTIVATION_REQUIRES_VALIDATED')
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
      status: 'ACTIVE',
      isDefault: true,
    })

    FrameworkPackage.findById.mockResolvedValue(frameworkPackage)
    FrameworkPackage.find.mockReturnValue({
      session: jest.fn().mockResolvedValue([activePackage]),
    })

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/framework-packages/${FRAMEWORK_PACKAGE_ID}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)

    expect(res.status).toBe(200)
    expect(frameworkPackage.save).toHaveBeenCalled()
    expect(activePackage.save).toHaveBeenCalled()
    expect(frameworkPackage.status).toBe('ACTIVE')
    expect(frameworkPackage.isDefault).toBe(true)
    expect(activePackage.isDefault).toBe(false)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAMEWORK_PACKAGE_ACTIVATED',
      resourceType: 'FrameworkPackage',
      scope: { frameworkKey: 'VMF' },
      summary: 'Super Admin activated framework package VMF 2.3.1',
    }))
  })
})
