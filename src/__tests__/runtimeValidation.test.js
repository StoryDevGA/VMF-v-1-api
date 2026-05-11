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

const buildUserQueryChain = (value) => {
  const promise = Promise.resolve(value)
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

const buildLeanQuery = (value) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const buildAuditFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const makeRuntimePath = (overrides = {}) => ({
  pathKey: 'framework_state.sections.executive_summary',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  allowedOperations: ['READ', 'WRITE', 'BIND'],
  isProtected: false,
  ...overrides,
})

const makeSkillRole = (overrides = {}) => ({
  roleKey: 'VALIDATOR',
  status: 'ACTIVE',
  allowedOperations: ['READ', 'WRITE', 'EXECUTE'],
  allowedReadScopes: ['framework_state.sections.*'],
  allowedWriteScopes: ['framework_state.sections.*'],
  ...overrides,
})

const makeFrameworkPackage = (overrides = {}) => ({
  _id: '607f1f77bcf86cd799439022',
  packageKey: 'standard-package-2-3-1',
  frameworkKey: 'VMF',
  status: 'ACTIVE',
  dependencyLock: {
    status: 'PASS',
    lockedAt: '2026-05-08T10:00:00.000Z',
    references: [],
  },
  ...overrides,
})

let app
let request
let tokenService
let User
let Role
let FrameworkPackage
let RuntimePathRegistry
let RuntimeSkill
let SkillRoleRegistry
let RuntimeValidationAudit
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
  FrameworkPackage = models.FrameworkPackage
  RuntimePathRegistry = models.RuntimePathRegistry
  RuntimeSkill = models.RuntimeSkill
  SkillRoleRegistry = models.SkillRoleRegistry
  RuntimeValidationAudit = models.RuntimeValidationAudit
})

afterAll(() => {})

beforeEach(() => {
  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === SUPER_ADMIN_ID) {
      return buildUserQueryChain(makeFakeUser())
    }

    if (userId === NON_ADMIN_ID) {
      return buildUserQueryChain(makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }))
    }

    return buildUserQueryChain(null)
  })

  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  FrameworkPackage.findById = jest.fn().mockReturnValue(buildLeanQuery(makeFrameworkPackage()))
  FrameworkPackage.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeFrameworkPackage()))
  RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePath()))
  RuntimeSkill.findOne = jest.fn().mockReturnValue(buildLeanQuery(null))
  SkillRoleRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeSkillRole()))
  RuntimeValidationAudit.create = jest.fn().mockImplementation(async (payload) => payload)
  RuntimeValidationAudit.find = jest.fn().mockReturnValue(buildAuditFindChain([]))
  RuntimeValidationAudit.countDocuments = jest.fn().mockResolvedValue(0)
})

describe('Runtime Validation API', () => {
  test('uses the canonical runtime validation audit collection name', () => {
    expect(RuntimeValidationAudit.collection.name).toBe('runtime_validation_audit')
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-validation/validate returns 401 without auth token', async () => {
    const res = await request.post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
    expect(res.status).toBe(401)
  })

  test('POST /api/v1/super-admin/runtime-control/runtime-validation/validate returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({ _id: NON_ADMIN_ID, id: NON_ADMIN_ID }))
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
      })

    expect(res.status).toBe(403)
  })

  test('allows a legal runtime state mutation and writes an audit row', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
        beforeState: { executive_summary: 'Old' },
        afterState: { executive_summary: 'New' },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PASS')
    expect(res.body.data.result).toBe('ALLOW')
    expect(res.body.data.operation).toBe('WRITE')
    expect(RuntimeValidationAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'STATE_WRITE',
      status: 'PASS',
      result: 'ALLOW',
      mode: 'STRICT',
      runtimePath: 'framework_state.sections.executive_summary',
      actorId: SUPER_ADMIN_ID,
    }))
  })

  test('derives audit actor from the authenticated user and does not allow public audit suppression', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
        actorId: 'spoofed-user-id',
        persistAudit: false,
      })

    expect(res.status).toBe(200)
    expect(RuntimeValidationAudit.create).toHaveBeenCalledTimes(1)
    expect(RuntimeValidationAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: SUPER_ADMIN_ID,
      status: 'PASS',
      result: 'ALLOW',
    }))
  })

  test('blocks a runtime write outside the skill role write scope', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    SkillRoleRegistry.findOne.mockReturnValue(buildLeanQuery(makeSkillRole({
      allowedWriteScopes: ['framework_state.validation.*'],
    })))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('RUNTIME_VALIDATION_FAILED')
    expect(res.body.error.validation.status).toBe('FAIL')
    expect(res.body.error.validation.result).toBe('BLOCK')
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-SCOPE-001',
          source: 'runtime-skill-role-boundary-validator',
        }),
      ]),
    )
    expect(RuntimeValidationAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAIL',
      result: 'BLOCK',
      validationCode: 'RVL-SCOPE-001',
    }))
  })

  test('forbidden write scopes override allowed write scopes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    SkillRoleRegistry.findOne.mockReturnValue(buildLeanQuery(makeSkillRole({
      allowedWriteScopes: ['framework_state.sections.*'],
      forbiddenWriteScopes: ['framework_state.sections.executive_summary'],
    })))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-SCOPE-001',
          message: expect.stringContaining('explicitly forbidden'),
        }),
      ]),
    )
  })

  test('blocks a state mutation when the runtime path is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(null))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.unknown',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-PATH-002',
          message: 'Runtime path "framework_state.sections.unknown" is not registered.',
        }),
      ]),
    )
  })

  test('validates runtime outputs against a JSON schema contract', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const validRes = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'OUTPUT_VALIDATION',
        frameworkKey: 'VMF',
        outputContract: {
          type: 'object',
          required: ['is_valid'],
          properties: {
            is_valid: { type: 'boolean' },
          },
        },
        payload: { is_valid: true },
      })

    expect(validRes.status).toBe(200)
    expect(validRes.body.data.status).toBe('PASS')
    expect(validRes.body.data.result).toBe('ALLOW')

    const invalidRes = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'OUTPUT_VALIDATION',
        frameworkKey: 'VMF',
        outputContract: {
          type: 'object',
          required: ['is_valid'],
          properties: {
            is_valid: { type: 'boolean' },
          },
        },
        payload: {},
      })

    expect(invalidRes.status).toBe(422)
    expect(invalidRes.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RVL-OUTPUT-003' }),
      ]),
    )

    const extraFieldRes = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'OUTPUT_VALIDATION',
        frameworkKey: 'VMF',
        outputContract: {
          type: 'object',
          required: ['is_valid'],
          additionalProperties: false,
          properties: {
            is_valid: { type: 'boolean' },
          },
        },
        payload: { is_valid: true, unexpected: true },
      })

    expect(extraFieldRes.status).toBe(422)
    expect(extraFieldRes.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RVL-OUTPUT-003' }),
      ]),
    )
  })

  test('does not run mutation validation for output validation context paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findOne.mockReturnValue(buildLeanQuery(null))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'OUTPUT_VALIDATION',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.context_only',
        outputContract: {
          type: 'object',
          required: ['is_valid'],
          properties: {
            is_valid: { type: 'boolean' },
          },
        },
        payload: { is_valid: true },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PASS')
    expect(RuntimePathRegistry.findOne).not.toHaveBeenCalled()
  })

  test('blocks malformed output contract schemas with RVL-OUTPUT-003', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'OUTPUT_VALIDATION',
        frameworkKey: 'VMF',
        outputContract: {
          type: 'object',
          properties: {
            is_valid: { type: 42 },
          },
        },
        payload: { is_valid: true },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-OUTPUT-003',
          path: 'outputContract',
        }),
      ]),
    )
  })

  test('blocks illegal lifecycle transitions using the transition matrix', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'LIFECYCLE_TRANSITION',
        frameworkKey: 'VMF',
        lifecycleStage: 'DRAFT',
        targetLifecycleStage: 'ACTIVE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-LIFECYCLE-004',
          message: 'Lifecycle transition DRAFT -> ACTIVE is not allowed.',
        }),
      ]),
    )
  })

  test('rejects invalid validation modes before execution', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        mode: 'BYPASS',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(RuntimeValidationAudit.create).not.toHaveBeenCalled()
  })

  test('tags audit rows when the requested package cannot be resolved', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildLeanQuery(null))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'missing-package',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-DEPENDENCY-008',
          path: 'packageId',
        }),
      ]),
    )
    expect(RuntimeValidationAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      packageId: 'missing-package',
      packageResolved: false,
      status: 'FAIL',
      result: 'BLOCK',
    }))
  })

  test('blocks framework key mismatches against the resolved package', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildLeanQuery(makeFrameworkPackage({ frameworkKey: 'RLD' })))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RVL-DEPENDENCY-008',
          path: 'frameworkKey',
        }),
      ]),
    )
  })

  test('returns the validation verdict when audit persistence fails', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeValidationAudit.create.mockRejectedValueOnce(new Error('audit write failed'))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/runtime-validation/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: 'STATE_WRITE',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        runtimePath: 'framework_state.sections.executive_summary',
        skillRoleKey: 'VALIDATOR',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PASS')
    expect(res.body.data.result).toBe('ALLOW')
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-validation/history/:packageId returns runtime validation audits', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeValidationAudit.countDocuments.mockResolvedValue(1)
    RuntimeValidationAudit.find.mockReturnValue(buildAuditFindChain([
      {
        _id: '607f1f77bcf86cd799439044',
        validationCode: 'RVL-SCOPE-001',
        severity: 'BLOCKING',
        operationType: 'STATE_WRITE',
        runtimePath: 'framework_state.sections.executive_summary',
        actorId: SUPER_ADMIN_ID,
        actorType: 'USER',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        workspaceId: 'workspace-1',
        result: 'BLOCK',
        status: 'FAIL',
        mode: 'STRICT',
        message: 'Runtime validation blocked this operation.',
        issues: [],
        summary: { totalChecks: 1, passed: 0, warnings: 0, failed: 1 },
        createdAt: '2026-05-08T12:00:00.000Z',
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    ]))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-validation/history/standard-package-2-3-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      id: '607f1f77bcf86cd799439044',
      validationCode: 'RVL-SCOPE-001',
      result: 'BLOCK',
      status: 'FAIL',
    }))
    expect(res.body.meta.total).toBe(1)
  })

  test('GET /api/v1/super-admin/runtime-control/runtime-validation/audit/:workspaceId filters audit rows by workspace', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeValidationAudit.countDocuments.mockResolvedValue(1)
    RuntimeValidationAudit.find.mockReturnValue(buildAuditFindChain([
      {
        _id: '607f1f77bcf86cd799439055',
        validationCode: 'RVL-EXECUTION-009',
        severity: 'INFO',
        operationType: 'STATE_WRITE',
        runtimePath: 'framework_state.sections.executive_summary',
        actorId: SUPER_ADMIN_ID,
        actorType: 'USER',
        packageId: 'standard-package-2-3-1',
        frameworkKey: 'VMF',
        workspaceId: 'workspace-1',
        result: 'ALLOW',
        status: 'PASS',
        mode: 'STRICT',
        message: 'Runtime validation passed.',
        issues: [],
        summary: { totalChecks: 1, passed: 1, warnings: 0, failed: 0 },
        createdAt: '2026-05-08T12:05:00.000Z',
        updatedAt: '2026-05-08T12:05:00.000Z',
      },
    ]))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/runtime-validation/audit/workspace-1?frameworkKey=vmf&status=PASS')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeValidationAudit.find).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      frameworkKey: 'VMF',
      status: 'PASS',
    })
    expect(RuntimeValidationAudit.countDocuments).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      frameworkKey: 'VMF',
      status: 'PASS',
    })
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      validationCode: 'RVL-EXECUTION-009',
      operationType: 'STATE_WRITE',
      workspaceId: 'workspace-1',
      status: 'PASS',
      result: 'ALLOW',
    }))
  })
})
