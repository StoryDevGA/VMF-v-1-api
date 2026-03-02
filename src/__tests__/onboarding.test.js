import mongoose from 'mongoose'
import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.TENANT_RATE_LIMIT = '10000'
})

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const LICENSE_LEVEL_ID = '907f1f77bcf86cd799439066'

const makeSuperAdmin = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  ...overrides,
})

const buildOnboardingPayload = (overrides = {}) => ({
  customer: {
    companyName: 'Onboarded Corp',
    website: 'https://onboarded.example',
    serviceProvider: true,
    licenseLevelId: LICENSE_LEVEL_ID,
    billingCycle: 'MONTHLY',
    planCode: 'ENTERPRISE',
    maxTenants: 3,
    maxVmfsPerTenant: 2,
    topology: 'SINGLE_TENANT',
    vmfPolicy: 'SINGLE',
  },
  adminUser: {
    name: 'Jane Admin',
    email: 'jane.admin@onboarded.example',
  },
  ...overrides,
})

let app
let request
let tokenService
let User
let Customer
let Tenant
let VMF
let AuditLog
let LicenseLevel
let monitoringService

let superAdminToken
let persisted
let shouldFailUserSave
let session

let originalCustomerSave
let originalUserSave
let originalTenantSave
let originalVmfSave

const clonePersisted = () => JSON.parse(JSON.stringify(persisted))

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => {
    const snapshot = clonePersisted()
    try {
      await callback()
    } catch (err) {
      persisted.customers = snapshot.customers
      persisted.users = snapshot.users
      persisted.tenants = snapshot.tenants
      persisted.vmfs = snapshot.vmfs
      throw err
    }
  }),
  endSession: jest.fn(async () => {}),
})

const mockLicenseLevelLookup = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  LicenseLevel.findById.mockReturnValue({ select })
}

const mockCustomerFindOne = (value) => {
  const query = {
    session: jest.fn().mockResolvedValue(value),
  }
  Customer.findOne.mockReturnValue({
    select: jest.fn().mockReturnValue(query),
  })
}

const mockUserFindOne = (value) => {
  User.findOne.mockReturnValue({
    session: jest.fn().mockResolvedValue(value),
  })
}

const getSuperAdminToken = async () => {
  if (superAdminToken) return superAdminToken
  const tokens = await tokenService.generateTokens(makeSuperAdmin())
  superAdminToken = tokens.accessToken
  return superAdminToken
}

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  AuditLog = models.AuditLog
  LicenseLevel = models.LicenseLevel
  monitoringService = (await import('../services/monitoringService.js')).default
})

beforeEach(() => {
  monitoringService.resetForTests()
  persisted = { customers: [], users: [], tenants: [], vmfs: [] }
  shouldFailUserSave = false

  User.findById = jest.fn().mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    return Promise.resolve(null)
  })
  User.findOne = jest.fn()
  Customer.findOne = jest.fn()
  LicenseLevel.findById = jest.fn()
  AuditLog.createLog = jest.fn(async () => ({}))

  mockCustomerFindOne(null)
  mockUserFindOne(null)
  mockLicenseLevelLookup({ _id: LICENSE_LEVEL_ID })

  originalCustomerSave = Customer.prototype.save
  originalUserSave = User.prototype.save
  originalTenantSave = Tenant.prototype.save
  originalVmfSave = VMF.prototype.save

  Customer.prototype.save = jest.fn(async function () {
    persisted.customers.push({ id: this._id?.toString(), name: this.name })
    return this
  })
  User.prototype.save = jest.fn(async function () {
    if (shouldFailUserSave) {
      throw new Error('forced user save failure')
    }
    persisted.users.push({ id: this._id?.toString(), email: this.email })
    return this
  })
  Tenant.prototype.save = jest.fn(async function () {
    persisted.tenants.push({ id: this._id?.toString(), name: this.name })
    return this
  })
  VMF.prototype.save = jest.fn(async function () {
    persisted.vmfs.push({ id: this._id?.toString(), name: this.name })
    return this
  })

  session = buildSession()
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
})

afterEach(() => {
  Customer.prototype.save = originalCustomerSave
  User.prototype.save = originalUserSave
  Tenant.prototype.save = originalTenantSave
  VMF.prototype.save = originalVmfSave
  jest.restoreAllMocks()
})

describe('POST /api/v1/super-admin/customers/onboard', () => {
  test('creates customer + canonical admin + defaults successfully', async () => {
    const token = await getSuperAdminToken()

    const res = await request
      .post('/api/v1/super-admin/customers/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send(buildOnboardingPayload())

    expect(res.status).toBe(201)
    expect(res.body.data.customer).toBeDefined()
    expect(res.body.data.adminUser).toBeDefined()
    expect(res.body.data.tenant).toBeDefined()
    expect(res.body.data.vmf).toBeDefined()
    expect(res.body.data.usedExistingAdmin).toBe(false)
    expect(session.withTransaction).toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalled()
    expect(persisted.customers).toHaveLength(1)
    expect(persisted.users).toHaveLength(1)
    expect(persisted.tenants).toHaveLength(1)
    expect(persisted.vmfs).toHaveLength(1)
  })

  test('returns 422 when adminUser is missing and persists nothing', async () => {
    const token = await getSuperAdminToken()
    const payload = buildOnboardingPayload()
    delete payload.adminUser

    const res = await request
      .post('/api/v1/super-admin/customers/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mongoose.startSession).not.toHaveBeenCalled()
    expect(persisted.customers).toHaveLength(0)
    expect(persisted.users).toHaveLength(0)
    expect(persisted.tenants).toHaveLength(0)
    expect(persisted.vmfs).toHaveLength(0)
  })

  test('returns 409 for duplicate customer and persists nothing', async () => {
    const token = await getSuperAdminToken()
    mockCustomerFindOne({ _id: '607f1f77bcf86cd799439022' })

    const res = await request
      .post('/api/v1/super-admin/customers/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send(buildOnboardingPayload())

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(persisted.customers).toHaveLength(0)
    expect(persisted.users).toHaveLength(0)
    expect(persisted.tenants).toHaveLength(0)
    expect(persisted.vmfs).toHaveLength(0)
  })

  test('rolls back all writes on mid-transaction failure', async () => {
    const token = await getSuperAdminToken()
    shouldFailUserSave = true

    const res = await request
      .post('/api/v1/super-admin/customers/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send(buildOnboardingPayload({
        customer: {
          ...buildOnboardingPayload().customer,
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_MULTI',
        },
      }))

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(session.withTransaction).toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalled()
    expect(persisted.customers).toHaveLength(0)
    expect(persisted.users).toHaveLength(0)
    expect(persisted.tenants).toHaveLength(0)
    expect(persisted.vmfs).toHaveLength(0)

    const health = await monitoringService.getDetailedHealth()
    expect(health.metrics.onboardingTransactionFailures).toBeGreaterThanOrEqual(1)
  })
})
