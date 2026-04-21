import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'
import { buildSkillRoleRegistryStableId } from '../models/SkillRoleRegistry.js'

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
const ROLE_STABLE_ID = buildSkillRoleRegistryStableId('VALIDATOR')

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

const buildSkillRoleQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
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

const buildRuntimeSkillReferenceChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildRuntimeAgentReferenceChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

let app
let request
let tokenService
let User
let Role
let SkillRoleRegistry
let RuntimeSkill
let RuntimeAgent
let mockRedisClient
let skillRoleControllerTestables

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

  await jest.unstable_mockModule('../services/auditService.js', () => ({
    AUDIT_ACTIONS: {
      SKILL_ROLE_CREATED: 'SKILL_ROLE_CREATED',
      SKILL_ROLE_UPDATED: 'SKILL_ROLE_UPDATED',
    },
    RESOURCE_TYPES: {
      SkillRole: 'SkillRole',
    },
    default: {
      log: jest.fn().mockResolvedValue(null),
      logFromRequest: jest.fn().mockResolvedValue(null),
      AUDIT_ACTIONS: {
        SKILL_ROLE_CREATED: 'SKILL_ROLE_CREATED',
        SKILL_ROLE_UPDATED: 'SKILL_ROLE_UPDATED',
      },
      RESOURCE_TYPES: {
        SkillRole: 'SkillRole',
      },
    },
  }))

  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  SkillRoleRegistry = models.SkillRoleRegistry
  RuntimeSkill = models.RuntimeSkill
  RuntimeAgent = models.RuntimeAgent

  skillRoleControllerTestables = (await import('../controllers/skillRoleRegistry.controller.js')).__testables
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

  SkillRoleRegistry.find = jest.fn()
  SkillRoleRegistry.countDocuments = jest.fn()
  SkillRoleRegistry.findByStableId = jest.fn()
  SkillRoleRegistry.findOne = jest.fn()
  SkillRoleRegistry.create = jest.fn()
  SkillRoleRegistry.aggregate = jest.fn()
  SkillRoleRegistry.populate = jest.fn(async (items) => items)
  RuntimeSkill.find = jest.fn()
  RuntimeSkill.countDocuments = jest.fn()
  RuntimeSkill.aggregate = jest.fn()
  RuntimeAgent.find = jest.fn()

  SkillRoleRegistry.countDocuments.mockResolvedValue(0)
  SkillRoleRegistry.find.mockReturnValue(buildSkillRoleQueryChain([]))
  SkillRoleRegistry.findOne.mockResolvedValue(null)
  SkillRoleRegistry.aggregate.mockResolvedValue([])
  RuntimeSkill.find.mockReturnValue(buildRuntimeSkillReferenceChain([]))
  RuntimeSkill.countDocuments.mockResolvedValue(0)
  RuntimeSkill.aggregate.mockResolvedValue([])
  RuntimeAgent.find.mockReturnValue(buildRuntimeAgentReferenceChain([]))
})

describe('Skill Role Registry API', () => {
  test('GET /api/v1/super-admin/runtime-control/skill-roles returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/skill-roles')
    expect(res.status).toBe(401)
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({ _id: NON_ADMIN_ID, id: NON_ADMIN_ID }))
    const res = await request
      .get('/api/v1/super-admin/runtime-control/skill-roles')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles returns paginated skill roles', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    SkillRoleRegistry.countDocuments.mockResolvedValue(1)
    RuntimeSkill.aggregate.mockResolvedValue([
      { _id: 'VALIDATOR', usageCount: 2 },
    ])
    SkillRoleRegistry.find.mockReturnValue(
      buildSkillRoleQueryChain([
        {
          stableId: ROLE_STABLE_ID,
          roleKey: 'VALIDATOR',
          label: 'Validator',
          description: 'Evaluates correctness.',
          status: 'ACTIVE',
          isSystem: true,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
      ]),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skill-roles?page=1&pageSize=20&q=valid')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.length).toBe(1)
    expect(res.body.data?.[0]?.roleKey).toBe('VALIDATOR')
    expect(res.body.data?.[0]?.usageCount).toBe(2)
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles accepts pageSize=1000 for Agent Editor fetches', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    SkillRoleRegistry.countDocuments.mockResolvedValue(1)
    RuntimeSkill.aggregate.mockResolvedValue([
      { _id: 'VALIDATOR', usageCount: 2 },
    ])
    SkillRoleRegistry.find.mockReturnValue(
      buildSkillRoleQueryChain([
        {
          stableId: ROLE_STABLE_ID,
          roleKey: 'VALIDATOR',
          label: 'Validator',
          description: 'Evaluates correctness.',
          status: 'ACTIVE',
          isSystem: true,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
      ]),
    )

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skill-roles?page=1&pageSize=1000&q=')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta?.pageSize).toBe(1000)
    expect(res.body.data?.[0]?.roleKey).toBe('VALIDATOR')
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles supports usageCount sorting', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    SkillRoleRegistry.countDocuments.mockResolvedValue(2)

    SkillRoleRegistry.aggregate
      .mockResolvedValueOnce([
        {
          stableId: buildSkillRoleRegistryStableId('VALIDATOR'),
          roleKey: 'VALIDATOR',
          label: 'Validator',
          description: 'Evaluates correctness.',
          status: 'ACTIVE',
          isSystem: false,
          usageCount: 4,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
        {
          stableId: buildSkillRoleRegistryStableId('REVIEWER'),
          roleKey: 'REVIEWER',
          label: 'Reviewer',
          description: 'Reviews outputs.',
          status: 'ACTIVE',
          isSystem: false,
          usageCount: 1,
          createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
          updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        },
      ])

    const res = await request
      .get('/api/v1/super-admin/runtime-control/skill-roles?sortBy=usageCount&sortOrder=desc')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.map((item) => item.roleKey)).toEqual(['VALIDATOR', 'REVIEWER'])
    expect(res.body.data?.map((item) => item.usageCount)).toEqual([4, 1])
  })

  test('POST /api/v1/super-admin/runtime-control/skill-roles creates a role', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const created = {
      _id: '507f1f77bcf86cd799439099',
      stableId: buildSkillRoleRegistryStableId('TEST_HELPER'),
      roleKey: 'TEST_HELPER',
      label: 'Test helper',
      description: 'Helper role for tests.',
      status: 'ACTIVE',
      isSystem: false,
      createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      populate: jest.fn().mockResolvedValue(undefined),
      toJSON: function toJSON() {
        return {
          id: this.stableId,
          roleKey: this.roleKey,
          label: this.label,
          description: this.description,
          status: this.status,
          isSystem: this.isSystem,
          createdBy: this.createdBy,
          updatedBy: this.updatedBy,
        }
      },
    }

    SkillRoleRegistry.create.mockResolvedValue(created)

    const res = await request
      .post('/api/v1/super-admin/runtime-control/skill-roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        roleKey: 'TEST_HELPER',
        label: 'Test helper',
        description: 'Helper role for tests.',
        status: 'ACTIVE',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.roleKey).toBe('TEST_HELPER')
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles/:roleId returns a role', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimeSkill.countDocuments.mockResolvedValue(3)

    SkillRoleRegistry.findByStableId.mockReturnValue(
      buildFindByStableIdQuery({
        stableId: ROLE_STABLE_ID,
        roleKey: 'VALIDATOR',
        label: 'Validator',
        description: 'Evaluates correctness.',
        status: 'ACTIVE',
        isSystem: true,
        createdBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
        updatedBy: { id: SUPER_ADMIN_ID, name: 'Super Administrator' },
      }),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/skill-roles/${ROLE_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.roleKey).toBe('VALIDATOR')
    expect(res.body.data?.usageCount).toBe(3)
  })

  test('GET /api/v1/super-admin/runtime-control/skill-roles/:roleId/dependencies returns referencing skills', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    SkillRoleRegistry.findByStableId.mockReturnValue(
      buildFindByStableIdQuery({
        stableId: ROLE_STABLE_ID,
        roleKey: 'VALIDATOR',
      }),
    )
    RuntimeSkill.find.mockReturnValue(
      buildRuntimeSkillReferenceChain([
        { stableId: 'skill-snapshot' },
        { stableId: 'skill-check-required-vmf-sections' },
      ]),
    )
    RuntimeAgent.find.mockReturnValue(
      buildRuntimeAgentReferenceChain([
        { stableId: 'agent-validator' },
      ]),
    )

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/skill-roles/${ROLE_STABLE_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data?.dependencies?.skillIds).toEqual([
      'skill-snapshot',
      'skill-check-required-vmf-sections',
    ])
    expect(res.body.data?.dependencies?.agentIds).toEqual(['agent-validator'])
    expect(res.body.data?.dependencies?.summary).toEqual({ skills: 2, agents: 1 })
  })

  test('PATCH /api/v1/super-admin/runtime-control/skill-roles/:roleId rejects isSystem changes at validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const existing = {
      _id: '507f1f77bcf86cd799439099',
      stableId: ROLE_STABLE_ID,
      roleKey: 'VALIDATOR',
      label: 'Validator',
      description: 'Evaluates correctness.',
      status: 'ACTIVE',
      isSystem: true,
      updatedBy: SUPER_ADMIN_ID,
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue(undefined),
      toJSON: function toJSON() {
        return {
          id: this.stableId,
          roleKey: this.roleKey,
          label: this.label,
          description: this.description,
          status: this.status,
          isSystem: this.isSystem,
        }
      },
    }

    SkillRoleRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(existing))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/skill-roles/${ROLE_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isSystem: false })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.isSystem).toMatch(/managed by the platform/i)
  })

  test('PATCH /api/v1/super-admin/runtime-control/skill-roles/:roleId rejects roleKey change', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const existing = {
      _id: '507f1f77bcf86cd799439099',
      stableId: ROLE_STABLE_ID,
      roleKey: 'VALIDATOR',
      label: 'Validator',
      description: 'Evaluates correctness.',
      status: 'ACTIVE',
      isSystem: true,
      updatedBy: SUPER_ADMIN_ID,
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue(undefined),
      toJSON: function toJSON() {
        return {
          id: this.stableId,
          roleKey: this.roleKey,
          label: this.label,
          description: this.description,
          status: this.status,
          isSystem: this.isSystem,
        }
      },
    }

    SkillRoleRegistry.findByStableId.mockReturnValue(buildFindByStableIdQuery(existing))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/skill-roles/${ROLE_STABLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleKey: 'CHANGED' })

    expect(res.status).toBe(422)
    expect(res.body.error?.details?.roleKey).toMatch(/immutable/i)
  })

  test('Controller search clauses include exact status match', () => {
    const clauses = skillRoleControllerTestables.buildSearchClauses('ACTIVE')
    expect(clauses.some((clause) => clause.status === 'ACTIVE')).toBe(true)
  })

  test('Controller sort helper defaults to updatedAt descending', () => {
    expect(skillRoleControllerTestables.buildSkillRoleSort({})).toEqual({
      status: 1,
      updatedAt: -1,
      roleKey: 1,
    })
  })
})
