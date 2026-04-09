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
const FRAMEWORK_REGISTRY_DB_ID = '607f1f77bcf86cd799439061'
const FRAMEWORK_REGISTRY_STABLE_ID = 'framework-vmf'
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

const buildFrameworkRegistryQueryChain = (rows) => ({
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
let FrameworkPackage
let RuntimeAgent
let RuntimeSkill
let WorkflowPolicy
let AuditLog
let mockRedisClient
let originalFrameworkRegistrySave
let originalFrameworkRegistryPopulate

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const makeFrameworkRegistryDoc = (overrides = {}) => {
  const frameworkRegistry = new FrameworkRegistry({
    _id: FRAMEWORK_REGISTRY_DB_ID,
    stableId: FRAMEWORK_REGISTRY_STABLE_ID,
    frameworkKey: 'VMF',
    name: 'Value Messaging Framework',
    type: 'structured',
    structureType: 'section_based',
    supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
    defaultBehaviorProfile: {
      mode: 'publish-first',
      approvalRequired: true,
    },
    status: 'ACTIVE',
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  frameworkRegistry.save = jest.fn(async function save() {
    return this
  })
  frameworkRegistry.populate = jest.fn(async function populate() {
    return this
  })

  return frameworkRegistry
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
  WorkflowPolicy = models.WorkflowPolicy
  AuditLog = models.AuditLog

  originalFrameworkRegistrySave = FrameworkRegistry.prototype.save
  originalFrameworkRegistryPopulate = FrameworkRegistry.prototype.populate
})

afterAll(() => {
  FrameworkRegistry.prototype.save = originalFrameworkRegistrySave
  FrameworkRegistry.prototype.populate = originalFrameworkRegistryPopulate
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

  FrameworkRegistry.find = jest.fn()
  FrameworkRegistry.countDocuments = jest.fn()
  FrameworkRegistry.findOne = jest.fn()
  FrameworkPackage.countDocuments = jest.fn()
  RuntimeAgent.countDocuments = jest.fn()
  RuntimeSkill.countDocuments = jest.fn()
  WorkflowPolicy.countDocuments = jest.fn()
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))

  FrameworkRegistry.prototype.save = jest.fn(async function save() {
    return this
  })
  FrameworkRegistry.prototype.populate = jest.fn(async function populate() {
    return this
  })

  FrameworkRegistry.countDocuments.mockResolvedValue(0)
  FrameworkRegistry.find.mockReturnValue(buildFrameworkRegistryQueryChain([]))
  FrameworkRegistry.findOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  FrameworkPackage.countDocuments.mockResolvedValue(0)
  RuntimeAgent.countDocuments.mockResolvedValue(0)
  RuntimeSkill.countDocuments.mockResolvedValue(0)
  WorkflowPolicy.countDocuments.mockResolvedValue(0)

  AuditLog.createLog = jest.fn(async () => ({}))
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
})

describe('Framework Registry Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/framework-registry returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/framework-registry')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/framework-registry returns paginated rows with filters', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rows = [
      {
        stableId: 'framework-vmf',
        frameworkKey: 'VMF',
        name: 'Value Messaging Framework',
        type: 'structured',
        structureType: 'section_based',
        supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
        defaultBehaviorProfile: { mode: 'publish-first' },
        status: 'ACTIVE',
        updatedAt: '2026-04-09T09:00:00.000Z',
        updatedBy: { _id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      },
    ]

    FrameworkRegistry.countDocuments.mockResolvedValue(1)
    FrameworkRegistry.find.mockReturnValue(buildFrameworkRegistryQueryChain(rows))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/framework-registry?page=1&pageSize=4&status=ACTIVE&type=structured&structureType=section_based&q=messaging')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkRegistry.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        type: 'structured',
        structureType: 'section_based',
      }),
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: 'framework-vmf',
      frameworkKey: 'VMF',
      type: 'structured',
      structureType: 'section_based',
      status: 'ACTIVE',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/framework-registry returns 403 when step-up token is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-registry')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frameworkKey: 'VMF',
        name: 'Value Messaging Framework',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-registry returns 422 for invalid payloads', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-registry')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'vmf',
        name: '',
        type: 'unknown',
        defaultBehaviorProfile: [],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.name).toBe('Framework name is required')
  })

  test('POST /api/v1/super-admin/runtime-control/framework-registry returns 409 when the framework key already exists', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkRegistry.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: FRAMEWORK_REGISTRY_DB_ID }),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-registry')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'VMF',
        name: 'Value Messaging Framework',
        type: 'structured',
        structureType: 'section_based',
        supportedWorkflowKeys: ['vmf-baseline'],
        defaultBehaviorProfile: { mode: 'publish-first' },
        status: 'ACTIVE',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'frameworkKey',
      reason: 'FRAMEWORK_REGISTRY_KEY_CONFLICT',
    })
  })

  test('POST /api/v1/super-admin/runtime-control/framework-registry creates a registry entry and writes an audit log', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkRegistry.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    })

    const res = await request
      .post('/api/v1/super-admin/runtime-control/framework-registry')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'QMF',
        name: 'Quality Messaging Framework',
        type: 'hybrid',
        structureType: 'template_based',
        supportedWorkflowKeys: ['qmf-review', 'qmf-release'],
        defaultBehaviorProfile: { mode: 'template-led', approvalRequired: true },
        status: 'DRAFT',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: 'framework-qmf',
      frameworkKey: 'QMF',
      name: 'Quality Messaging Framework',
      type: 'hybrid',
      structureType: 'template_based',
      status: 'DRAFT',
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FRAMEWORK_REGISTRY_CREATED',
        resourceType: 'FrameworkRegistry',
        scope: { frameworkKey: 'QMF' },
      }),
    )
  })

  test('GET /api/v1/super-admin/runtime-control/framework-registry/:registryId returns a registry entry', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkRegistry.findOne = jest.fn().mockImplementation((query) => {
      if (query?.stableId === FRAMEWORK_REGISTRY_STABLE_ID) {
        return Promise.resolve(makeFrameworkRegistryDoc())
      }
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/framework-registry/${FRAMEWORK_REGISTRY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: FRAMEWORK_REGISTRY_STABLE_ID,
      frameworkKey: 'VMF',
      name: 'Value Messaging Framework',
    })
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-registry/:registryId updates a registry entry', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkRegistryDoc = makeFrameworkRegistryDoc()
    FrameworkRegistry.findOne = jest.fn().mockImplementation((query) => {
      if (query?.stableId === FRAMEWORK_REGISTRY_STABLE_ID) {
        return Promise.resolve(frameworkRegistryDoc)
      }

      return {
        select: jest.fn().mockResolvedValue(null),
      }
    })

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-registry/${FRAMEWORK_REGISTRY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        name: 'Value Messaging Framework 2',
        supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish', 'vmf-review'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: FRAMEWORK_REGISTRY_STABLE_ID,
      name: 'Value Messaging Framework 2',
      supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish', 'vmf-review'],
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FRAMEWORK_REGISTRY_UPDATED',
        resourceType: 'FrameworkRegistry',
        scope: { frameworkKey: 'VMF' },
      }),
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/framework-registry/:registryId returns 409 when changing a framework key that is already in use', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const frameworkRegistryDoc = makeFrameworkRegistryDoc()
    FrameworkRegistry.findOne = jest.fn().mockImplementation((query) => {
      if (query?.stableId === FRAMEWORK_REGISTRY_STABLE_ID) {
        return Promise.resolve(frameworkRegistryDoc)
      }

      return {
        select: jest.fn().mockResolvedValue(null),
      }
    })
    FrameworkPackage.countDocuments.mockResolvedValue(1)
    RuntimeAgent.countDocuments.mockResolvedValue(0)
    RuntimeSkill.countDocuments.mockResolvedValue(0)
    WorkflowPolicy.countDocuments.mockResolvedValue(1)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/framework-registry/${FRAMEWORK_REGISTRY_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', STEP_UP_TOKEN)
      .send({
        frameworkKey: 'QMF',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toMatchObject({
      field: 'frameworkKey',
      reason: 'FRAMEWORK_REGISTRY_KEY_IN_USE',
      dependencyCounts: {
        frameworkPackages: 1,
        runtimeAgents: 0,
        runtimeSkills: 0,
        workflowPolicies: 1,
      },
    })
  })
})
