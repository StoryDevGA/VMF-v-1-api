import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'
import { buildValidationRegistryStableId } from '../models/ValidationRegistry.js'

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
const VALIDATION_STABLE_ID = buildValidationRegistryStableId('required-sections-check')
const VALIDATION_DOCUMENT_ID = '507f1f77bcf86cd799439013'
const ACTIVE_SKILL_ID = 'skill-vmf-required-sections-validator'
const ACTIVE_AGENT_ID = 'agent-vmf-submit-validator-agent'
const ACTIVE_VALIDATION_PATH = 'framework_state.validation.required_sections'
const ACTIVE_PASS_PATH = 'framework_state.validation.required_sections.is_valid'
const ACTIVE_DETAILS_PATH = 'framework_state.validation.required_sections.missing_sections'

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
    permissions: ['PLATFORM_MANAGE', 'AUDIT_VIEW_ALL'],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_VIEW'],
    isActive: true,
  },
])

const buildValidationQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildSelectLeanChain = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildAwaitableChain = (result, methods = []) => {
  const chain = {}
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain)
  }
  const promise = Promise.resolve(result)
  chain.then = promise.then.bind(promise)
  chain.catch = promise.catch.bind(promise)
  chain.finally = promise.finally.bind(promise)
  return chain
}

const makeValidationDocument = (overrides = {}) => ({
  _id: VALIDATION_DOCUMENT_ID,
  stableId: VALIDATION_STABLE_ID,
  key: 'required-sections-check',
  label: 'Required Sections Check',
  description: 'Checks whether all required framework sections exist.',
  status: 'ACTIVE',
  supportedFrameworkKeys: ['VMF'],
  category: 'COMPLETENESS',
  severity: 'BLOCKING',
  producerSkillId: ACTIVE_SKILL_ID,
  defaultAgentIds: ['agent-vmf-submit-validator-agent'],
  outputPath: ACTIVE_VALIDATION_PATH,
  resultType: 'OBJECT',
  passFieldPath: ACTIVE_PASS_PATH,
  detailsFieldPath: ACTIVE_DETAILS_PATH,
  policyUsable: true,
  packageUsable: true,
  requiresLatestRun: true,
  freshnessDefaultMinutes: 30,
  blockingDefault: true,
  warningOnlyDefault: false,
  createdBy: { _id: SUPER_ADMIN_ID, id: SUPER_ADMIN_ID, name: 'Super Administrator', email: 'admin@storylineos.com' },
  updatedBy: { _id: SUPER_ADMIN_ID, id: SUPER_ADMIN_ID, name: 'Super Administrator', email: 'admin@storylineos.com' },
  save: jest.fn(async function save() { return this }),
  populate: jest.fn(async function populate() { return this }),
  toJSON: function toJSON() {
    return {
      _id: this._id,
      stableId: this.stableId,
      key: this.key,
      label: this.label,
      description: this.description,
      status: this.status,
      supportedFrameworkKeys: [...this.supportedFrameworkKeys],
      category: this.category,
      severity: this.severity,
      producerSkillId: this.producerSkillId,
      defaultAgentIds: [...(this.defaultAgentIds || [])],
      outputPath: this.outputPath,
      resultType: this.resultType,
      passFieldPath: this.passFieldPath,
      detailsFieldPath: this.detailsFieldPath,
      policyUsable: this.policyUsable,
      packageUsable: this.packageUsable,
      requiresLatestRun: this.requiresLatestRun,
      freshnessDefaultMinutes: this.freshnessDefaultMinutes,
      blockingDefault: this.blockingDefault,
      warningOnlyDefault: this.warningOnlyDefault,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    }
  },
  ...overrides,
})

const buildCreatePayload = (overrides = {}) => ({
  key: 'required-sections-check',
  label: 'Required Sections Check',
  description: 'Checks whether all required framework sections exist.',
  status: 'ACTIVE',
  supportedFrameworkKeys: ['VMF'],
  category: 'COMPLETENESS',
  severity: 'BLOCKING',
  producerSkillId: ACTIVE_SKILL_ID,
  defaultAgentIds: ['agent-vmf-submit-validator-agent'],
  outputPath: ACTIVE_VALIDATION_PATH,
  resultType: 'OBJECT',
  passFieldPath: ACTIVE_PASS_PATH,
  detailsFieldPath: ACTIVE_DETAILS_PATH,
  policyUsable: true,
  packageUsable: true,
  requiresLatestRun: true,
  freshnessDefaultMinutes: 30,
  blockingDefault: true,
  warningOnlyDefault: false,
  ...overrides,
})

let app
let request
let tokenService
let User
let Role
let ValidationRegistry
let FrameworkRegistry
let RuntimeSkill
let RuntimeAgent
let RuntimePathRegistry
let FrameworkPackage
let WorkflowPolicy
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
  ValidationRegistry = models.ValidationRegistry
  FrameworkRegistry = models.FrameworkRegistry
  RuntimeSkill = models.RuntimeSkill
  RuntimeAgent = models.RuntimeAgent
  RuntimePathRegistry = models.RuntimePathRegistry
  FrameworkPackage = models.FrameworkPackage
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

  ValidationRegistry.find = jest.fn()
  ValidationRegistry.countDocuments = jest.fn()
  ValidationRegistry.findByStableId = jest.fn()
  ValidationRegistry.prototype.save = jest.fn(async function save() {
    if (!this._id) this._id = VALIDATION_DOCUMENT_ID
    if (!this.stableId) this.stableId = buildValidationRegistryStableId(this.key)
    this.createdBy = { _id: SUPER_ADMIN_ID, id: SUPER_ADMIN_ID, name: 'Super Administrator', email: 'admin@storylineos.com' }
    this.updatedBy = { _id: SUPER_ADMIN_ID, id: SUPER_ADMIN_ID, name: 'Super Administrator', email: 'admin@storylineos.com' }
    return this
  })
  ValidationRegistry.prototype.populate = jest.fn(async function populate() {
    return this
  })

  FrameworkRegistry.find = jest.fn().mockReturnValue(
    buildSelectLeanChain([
      { frameworkKey: 'VMF', status: 'ACTIVE', name: 'Value Management Framework' },
    ]),
  )
  RuntimeSkill.findByStableId = jest.fn().mockReturnValue(
    buildSelectLeanChain({
      stableId: ACTIVE_SKILL_ID,
      key: 'vmf-required-sections-validator',
      name: 'VMF Required Sections Validator',
      status: 'ACTIVE',
      supportedFrameworkKeys: ['VMF'],
    }),
  )
  RuntimeAgent.find = jest.fn().mockReturnValue(
    buildSelectLeanChain([
      {
        stableId: ACTIVE_AGENT_ID,
        key: 'vmf-submit-validator-agent',
        name: 'VMF Submit Validator Agent',
        status: 'ACTIVE',
        supportedFrameworkKeys: ['VMF'],
      },
    ]),
  )
  RuntimePathRegistry.find = jest.fn().mockReturnValue(
    buildSelectLeanChain([
      {
        pathKey: ACTIVE_VALIDATION_PATH,
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
      },
      {
        pathKey: ACTIVE_PASS_PATH,
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
      },
      {
        pathKey: ACTIVE_DETAILS_PATH,
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        allowedOperations: ['READ', 'WRITE', 'BIND'],
        isProtected: false,
        scope: 'VALIDATION_RESULT',
      },
    ]),
  )
  FrameworkPackage.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))
  WorkflowPolicy.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))
  auditService.logFromRequest = jest.fn().mockResolvedValue({})

  ValidationRegistry.countDocuments.mockResolvedValue(0)
  ValidationRegistry.find.mockReturnValue(buildValidationQueryChain([]))
})

describe('Validation Registry API', () => {
  test('GET /api/v1/super-admin/runtime-control/validation-registry returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/validation-registry')
    expect(res.status).toBe(401)
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({ _id: NON_ADMIN_ID, id: NON_ADMIN_ID }))
    const res = await request
      .get('/api/v1/super-admin/runtime-control/validation-registry')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry returns paginated validations', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.countDocuments.mockResolvedValue(1)
    ValidationRegistry.find.mockReturnValue(
      buildValidationQueryChain([
        {
          stableId: VALIDATION_STABLE_ID,
          key: 'required-sections-check',
          label: 'Required Sections Check',
          description: 'Checks whether all required framework sections exist.',
          status: 'ACTIVE',
          supportedFrameworkKeys: ['VMF'],
          category: 'COMPLETENESS',
          severity: 'BLOCKING',
          producerSkillId: 'skill-vmf-required-sections-validator',
          outputPath: 'framework_state.validation.required_sections',
          passFieldPath: 'framework_state.validation.required_sections.is_valid',
          detailsFieldPath: 'framework_state.validation.required_sections.missing_sections',
          policyUsable: true,
          packageUsable: true,
          freshnessDefaultMinutes: 30,
          blockingDefault: true,
          warningOnlyDefault: false,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
      ]),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/validation-registry?page=1&pageSize=20&frameworkKey=VMF&status=ACTIVE')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data[0]?.key).toBe('required-sections-check')
    expect(res.body.meta?.page).toBe(1)
  })

  test('POST /api/v1/super-admin/runtime-control/validation-registry creates a validation entry', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/validation-registry')
      .set('Authorization', `Bearer ${token}`)
      .send(buildCreatePayload())

    expect(res.status).toBe(201)
    expect(res.body.data?.id).toBe(VALIDATION_STABLE_ID)
    expect(res.body.data?.key).toBe('required-sections-check')
    expect(auditService.logFromRequest).toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/validation-registry preserves extended seed-contract fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/validation-registry')
      .set('Authorization', `Bearer ${token}`)
      .send(buildCreatePayload({
        defaultAgentIds: ['agent-vmf-submit-validator-agent'],
        resultType: 'OBJECT',
        requiresLatestRun: true,
      }))

    expect(res.status).toBe(201)
    expect(res.body.data?.defaultAgentIds).toEqual(['agent-vmf-submit-validator-agent'])
    expect(res.body.data?.resultType).toBe('OBJECT')
    expect(res.body.data?.requiresLatestRun).toBe(true)
  })

  test('POST /api/v1/super-admin/runtime-control/validation-registry rejects unknown default agents', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeAgent.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/validation-registry')
      .set('Authorization', `Bearer ${token}`)
      .send(buildCreatePayload({
        defaultAgentIds: ['agent-missing-validator'],
      }))

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.defaultAgentIds).toContain('agent-missing-validator')
    expect(res.body.error?.details?.defaultAgentIds).toContain('was not found')
  })

  test('POST /api/v1/super-admin/runtime-control/validation-registry rejects inactive frameworks', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkRegistry.find = jest.fn().mockReturnValue(
      buildSelectLeanChain([
        { frameworkKey: 'VMF', status: 'INACTIVE', name: 'Value Management Framework' },
      ]),
    )

    const res = await request
      .post('/api/v1/super-admin/runtime-control/validation-registry')
      .set('Authorization', `Bearer ${token}`)
      .send(buildCreatePayload())

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.supportedFrameworkKeys).toContain('Inactive framework key')
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry/:validationId returns validation detail', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockReturnValue(
      buildAwaitableChain(makeValidationDocument(), ['populate']),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.id).toBe(VALIDATION_STABLE_ID)
    expect(res.body.data?.label).toBe('Required Sections Check')
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry/:validationId/dependencies returns dependency summary', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockReturnValue(
      buildAwaitableChain(makeValidationDocument(), ['select']),
    )
    WorkflowPolicy.find = jest.fn().mockReturnValue(
      buildSelectLeanChain([
        {
          stableId: 'workflow-policy-vmf-required-sections',
          key: 'vmf-required-sections-policy',
          name: 'VMF Required Sections Policy',
          status: 'ACTIVE',
        },
      ]),
    )
    FrameworkPackage.find = jest.fn().mockReturnValue(
      buildSelectLeanChain([
        {
          _id: '507f1f77bcf86cd799439022',
          frameworkKey: 'VMF',
          frameworkName: 'Value Management Framework',
          version: '1.0.0',
          status: 'ACTIVE',
        },
      ]),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.dependencies?.summary).toEqual({
      workflowPolicies: 1,
      frameworkPackages: 1,
    })
    expect(res.body.data?.runtimePaths).toHaveLength(3)
    expect(res.body.data?.defaultAgents).toEqual([
      expect.objectContaining({
        id: ACTIVE_AGENT_ID,
        status: 'ACTIVE',
        compatibleWithValidation: true,
      }),
    ])
  })

  test('PATCH /api/v1/super-admin/runtime-control/validation-registry/:validationId rejects key mutation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockResolvedValue(makeValidationDocument())

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'renamed-validation-key' })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.key).toContain('immutable')
  })

  test('PATCH /api/v1/super-admin/runtime-control/validation-registry/:validationId updates mutable fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const document = makeValidationDocument()
    ValidationRegistry.findByStableId.mockResolvedValue(document)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Required Sections Check Updated',
        description: 'Updated validation description.',
        freshnessDefaultMinutes: 45,
      })

    expect(res.status).toBe(200)
    expect(res.body.data?.label).toBe('Required Sections Check Updated')
    expect(res.body.data?.freshnessDefaultMinutes).toBe(45)
    expect(document.save).toHaveBeenCalled()
    expect(auditService.logFromRequest).toHaveBeenCalled()
  })

  test('PATCH /api/v1/super-admin/runtime-control/validation-registry/:validationId validates default agents when explicitly supplied', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const document = makeValidationDocument()
    ValidationRegistry.findByStableId.mockResolvedValue(document)
    RuntimeAgent.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        defaultAgentIds: ['agent-missing-validator'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.defaultAgentIds).toContain('agent-missing-validator')
    expect(document.save).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry/:validationId returns 404 for non-existent validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockReturnValue(
      buildAwaitableChain(null, ['populate']),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error?.message).toContain('not found')
  })

  test('GET /api/v1/super-admin/runtime-control/validation-registry/:validationId/dependencies returns 404 for non-existent validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockReturnValue(
      buildAwaitableChain(null, ['select']),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error?.message).toContain('not found')
  })

  test('PATCH /api/v1/super-admin/runtime-control/validation-registry/:validationId returns 404 for non-existent validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    ValidationRegistry.findByStableId.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/validation-registry/${VALIDATION_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Updated Label' })

    expect(res.status).toBe(404)
    expect(res.body.error?.message).toContain('not found')
  })
})
