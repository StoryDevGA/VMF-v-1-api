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
const UI_CONTRACT_ID = '607f1f77bcf86cd799439061'

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
])

const buildSelectLeanChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildFrameworkPackageQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let FrameworkPackage
let RuntimePathRegistry
let UIContract
let AuditLog
let mockRedisClient
let originalUIContractSave
let originalUIContractPopulate

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const makeUIContractDoc = (overrides = {}) => {
  const uiContract = new UIContract({
    _id: UI_CONTRACT_ID,
    uiContractKey: 'vmf-ui-contract-v1',
    name: 'VMF UI Contract',
    description: 'Presentation contract for VMF.',
    status: 'ACTIVE',
    frameworkKeys: ['VMF'],
    introducedInVersion: '2.3.1',
    compatibilityMode: 'INHERITED_MINOR',
    sections: [],
    lifecycleStages: [],
    actions: [],
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  uiContract.save = jest.fn(async function save() {
    return this
  })
  uiContract.populate = jest.fn(async function populate() {
    return this
  })

  return uiContract
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
  RuntimePathRegistry = models.RuntimePathRegistry
  UIContract = models.UIContract
  AuditLog = models.AuditLog

  originalUIContractSave = UIContract.prototype.save
  originalUIContractPopulate = UIContract.prototype.populate
})

afterAll(() => {
  UIContract.prototype.save = originalUIContractSave
  UIContract.prototype.populate = originalUIContractPopulate
})

beforeEach(() => {
  User.findById = jest.fn().mockResolvedValue(makeFakeUser())
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  FrameworkRegistry.find = jest.fn().mockReturnValue(buildSelectLeanChain([
    { frameworkKey: 'VMF', status: 'ACTIVE' },
  ]))
  FrameworkPackage.find = jest.fn().mockReturnValue(buildFrameworkPackageQueryChain([]))
  RuntimePathRegistry.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))
  UIContract.findOne = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  UIContract.findById = jest.fn().mockResolvedValue(null)
  UIContract.findByStableId = jest.fn().mockResolvedValue(null)
  UIContract.prototype.save = jest.fn(async function save() {
    return this
  })
  UIContract.prototype.populate = jest.fn(async function populate() {
    return this
  })
  AuditLog.createLog = jest.fn(async () => ({}))
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
})

describe('UI Contract Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/ui-contracts returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/ui-contracts')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts creates a UI Contract', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        description: 'Presentation contract for VMF.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        introducedInVersion: '2.3.1',
        sections: [
          {
            sectionKey: 'customer-problem',
            label: 'Customer Problem',
            helpText: 'Describe the core customer problem.',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.sections[0].label).toBe('Customer Problem')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UI_CONTRACT_CREATED',
      resourceType: 'UIContract',
    }))
  })

  test('GET /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId/dependencies returns referencing packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.findById.mockResolvedValue(makeUIContractDoc())
    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageQueryChain([
      {
        _id: '607f1f77bcf86cd799439071',
        frameworkKey: 'VMF',
        version: '2.3.1',
        packageName: 'VMF 2.3.1',
        status: 'ACTIVE',
      },
    ]))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.dependencies.summary.frameworkPackages).toBe(1)
    expect(res.body.data.dependencies.hasActiveDependencies).toBe(true)
  })
})
