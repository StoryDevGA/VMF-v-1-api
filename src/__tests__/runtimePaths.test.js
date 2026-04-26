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

const buildSelectLeanChain = (rows) => ({
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

const makeRuntimePathDocument = (overrides = {}) => {
  const pathKey = overrides.pathKey || 'vmf.validation.status'
  const stableId = overrides.stableId || buildRuntimePathRegistryStableId(pathKey)
  const doc = {
    _id: overrides._id || '607f1f77bcf86cd799439011',
    stableId,
    pathKey,
    label: overrides.label || 'VMF Validation Status',
    description: overrides.description || 'Validation status output for VMF runs.',
    status: overrides.status || 'ACTIVE',
    frameworkKeys: overrides.frameworkKeys || ['VMF'],
    scope: overrides.scope || 'VALIDATION_RESULT',
    allowedOperations: overrides.allowedOperations || ['READ', 'WRITE', 'BIND'],
    dataType: overrides.dataType || 'ENUM',
    category: overrides.category || 'VALIDATION',
    sourceType: overrides.sourceType || 'DERIVED',
    isProtected: overrides.isProtected ?? false,
    isSystem: overrides.isSystem ?? true,
    createdBy: overrides.createdBy || { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
    updatedBy: overrides.updatedBy || { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
    save: jest.fn(async function save() {
      return this
    }),
    populate: jest.fn(async function populate() {
      return this
    }),
    toJSON: function toJSON() {
      const {
        save,
        populate,
        toJSON,
        toObject,
        _id,
        ...plain
      } = this
      return {
        ...plain,
        id: this.stableId,
      }
    },
    toObject: function toObject() {
      return this.toJSON()
    },
    ...overrides,
  }

  return doc
}

let app
let request
let tokenService
let User
let Role
let RuntimePathRegistry
let RuntimeSkill
let FrameworkRegistry
let RuntimeAgent
let WorkflowPolicy
let ValidationRegistry
let auditService
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
  FrameworkRegistry = models.FrameworkRegistry
  RuntimeAgent = models.RuntimeAgent
  RuntimePathRegistry = models.RuntimePathRegistry
  RuntimeSkill = models.RuntimeSkill
  ValidationRegistry = models.ValidationRegistry
  WorkflowPolicy = models.WorkflowPolicy
  auditService = (await import('../services/auditService.js')).default
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
  RuntimePathRegistry.findOne = jest.fn()
  RuntimePathRegistry.countDocuments = jest.fn()
  RuntimePathRegistry.findByStableId = jest.fn()
  FrameworkRegistry.find = jest.fn()
  RuntimeAgent.find = jest.fn()
  RuntimeSkill.find = jest.fn()
  ValidationRegistry.find = jest.fn()
  WorkflowPolicy.find = jest.fn()
  auditService.log = jest.fn().mockResolvedValue({})
  auditService.logFromRequest = jest.fn().mockResolvedValue({})

  RuntimePathRegistry.prototype.save = jest.fn(async function save() {
    if (!this.stableId) {
      this.stableId = buildRuntimePathRegistryStableId(this.pathKey)
    }
    if (!this.status) this.status = 'DRAFT'
    if (this.isSystem === undefined) this.isSystem = true
    return this
  })
  RuntimePathRegistry.prototype.populate = jest.fn(async function populate() {
    return this
  })

  RuntimePathRegistry.countDocuments.mockResolvedValue(0)
  RuntimePathRegistry.find.mockReturnValue(buildRuntimePathQueryChain([]))
  RuntimePathRegistry.findOne.mockResolvedValue(null)
  FrameworkRegistry.find.mockReturnValue(
    buildSelectLeanChain([
      { frameworkKey: 'VMF', name: 'Value Management Framework', status: 'ACTIVE' },
    ]),
  )
  RuntimeAgent.find.mockReturnValue(buildSelectLeanChain([]))
  RuntimeSkill.find.mockReturnValue(buildRuntimeSkillFindChain([]))
  ValidationRegistry.find.mockReturnValue(buildSelectLeanChain([]))
  WorkflowPolicy.find.mockReturnValue(buildSelectLeanChain([]))
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

  test('POST /api/v1/super-admin/runtime-control/runtime-paths creates a draft custom runtime path', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-paths')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.outcome',
        label: 'VMF Validation Outcome',
        description: 'Outcome field for custom validation runs.',
        frameworkKeys: ['vmf'],
        scope: 'VALIDATION_RESULT',
        allowedOperations: ['READ', 'WRITE'],
        dataType: 'ENUM',
        category: 'VALIDATION',
        sourceType: 'DERIVED',
        allowedValues: ['PASS', 'FAIL'],
        uiControl: 'SELECT',
        isProtected: false,
        isSystem: false,
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.pathKey).toBe('vmf.validation.outcome')
    expect(res.body.data?.status).toBe('DRAFT')
    expect(res.body.data?.frameworkKeys).toEqual(['VMF'])
    expect(res.body.data?.isSystem).toBe(false)
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_CREATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimePathRegistry,
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-paths rejects inactive framework keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkRegistry.find.mockReturnValue(
      buildSelectLeanChain([
        { frameworkKey: 'VMF', name: 'Value Management Framework', status: 'INACTIVE' },
      ]),
    )

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-paths')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.outcome',
        label: 'VMF Validation Outcome',
        description: 'Outcome field for custom validation runs.',
        frameworkKeys: ['VMF'],
        scope: 'VALIDATION_RESULT',
        allowedOperations: ['READ'],
        dataType: 'STRING',
        category: 'VALIDATION',
        sourceType: 'DERIVED',
      })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.frameworkKeys).toContain('Inactive framework key "VMF"')
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-paths/:pathId returns 404 when missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(null))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-paths/path-does-not-exist')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-paths rejects duplicate path keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findOne.mockResolvedValue(makeRuntimePathDocument())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-paths')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.status',
        label: 'Duplicate Runtime Path',
        description: 'Attempts to reuse an existing runtime path key.',
        frameworkKeys: ['VMF'],
        scope: 'VALIDATION_RESULT',
        allowedOperations: ['READ'],
        dataType: 'STRING',
        category: 'VALIDATION',
        sourceType: 'DERIVED',
      })

    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('CONFLICT')
    expect(res.body.error?.details?.pathKey).toBe('Path key must be unique.')
    expect(RuntimePathRegistry.prototype.save).not.toHaveBeenCalled()
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

  test('PATCH /api/v1/super-admin/runtime-control/runtime-paths/:pathId rejects pathKey mutation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(makeRuntimePathDocument()))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.changed',
        label: 'Changed',
      })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.pathKey).toBe('Path key is immutable and cannot be changed after creation.')
  })

  test('PATCH /api/v1/super-admin/runtime-control/runtime-paths/:pathId returns 404 when missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(null))

    const res = await request
      .patch('/api/v1/super-admin/runtime-control/runtime-paths/path-does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Missing Runtime Path' })

    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/super-admin/runtime-control/runtime-paths/:pathId updates mutable fields and audits changes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimePath = makeRuntimePathDocument()
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(runtimePath))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'VMF Validation Outcome',
        frameworkKeys: ['vmf'],
        allowedOperations: ['READ'],
        helpText: 'Displayed in governed selectors.',
      })

    expect(res.status).toBe(200)
    expect(runtimePath.save).toHaveBeenCalledTimes(1)
    expect(res.body.data?.label).toBe('VMF Validation Outcome')
    expect(res.body.data?.frameworkKeys).toEqual(['VMF'])
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_UPDATED,
        diff: expect.objectContaining({
          label: { from: 'VMF Validation Status', to: 'VMF Validation Outcome' },
          allowedOperations: { from: ['READ', 'WRITE', 'BIND'], to: ['READ'] },
        }),
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-paths/:pathId/duplicate creates a custom draft copy', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const source = makeRuntimePathDocument()
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(source))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.status.copy',
        label: 'VMF Validation Status Copy',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.pathKey).toBe('vmf.validation.status.copy')
    expect(res.body.data?.status).toBe('DRAFT')
    expect(res.body.data?.isSystem).toBe(false)
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_DUPLICATED,
      }),
    )
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-paths/:pathId/duplicate rejects duplicate path keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(makeRuntimePathDocument()))
    RuntimePathRegistry.findOne.mockResolvedValue(makeRuntimePathDocument({
      pathKey: 'vmf.validation.status.copy',
    }))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        pathKey: 'vmf.validation.status.copy',
        label: 'VMF Validation Status Copy',
      })

    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('CONFLICT')
    expect(res.body.error?.details?.pathKey).toBe('Path key must be unique.')
    expect(RuntimePathRegistry.prototype.save).not.toHaveBeenCalled()
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

  test('POST /api/v1/super-admin/runtime-control/runtime-paths/:pathId/disable requires confirmation with active dependencies', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimePath = makeRuntimePathDocument({ status: 'ACTIVE' })
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(runtimePath))
    RuntimeSkill.find.mockReturnValue(
      buildRuntimeSkillFindChain([
        {
          stableId: 'skill-snapshot',
          key: 'snapshot',
          name: 'Snapshot',
          status: 'ACTIVE',
          allowedReadPaths: ['vmf.validation.status'],
          allowedWritePaths: [],
          forbiddenWritePaths: [],
        },
      ]),
    )

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('DEPENDENCY_CONFIRMATION_REQUIRED')
    expect(res.body.error?.details?.dependencies?.hasActiveDependencies).toBe(true)
    expect(runtimePath.save).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-paths/:pathId/disable saves after dependency confirmation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const runtimePath = makeRuntimePathDocument({ status: 'ACTIVE' })
    RuntimePathRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(runtimePath))
    RuntimeSkill.find.mockReturnValue(
      buildRuntimeSkillFindChain([
        {
          stableId: 'skill-snapshot',
          key: 'snapshot',
          name: 'Snapshot',
          status: 'ACTIVE',
          allowedReadPaths: ['vmf.validation.status'],
          allowedWritePaths: [],
          forbiddenWritePaths: [],
        },
      ]),
    )

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/runtime-paths/${RUNTIME_PATH_STABLE_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmDependencies: true })

    expect(res.status).toBe(200)
    expect(runtimePath.status).toBe('INACTIVE')
    expect(runtimePath.save).toHaveBeenCalledTimes(1)
    expect(res.body.dependencies?.hasActiveDependencies).toBe(true)
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_DISABLED,
      }),
    )
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
