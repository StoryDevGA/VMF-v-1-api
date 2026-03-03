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
const LICENSE_LEVEL_ID = '607f1f77bcf86cd799439022'

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

const makeFakeLicenseLevel = (overrides = {}) => ({
  _id: LICENSE_LEVEL_ID,
  id: LICENSE_LEVEL_ID,
  name: 'Standard',
  description: 'Standard tier',
  featureEntitlements: ['FEATURE_A'],
  isActive: true,
  createdBy: SUPER_ADMIN_ID,
  updatedBy: SUPER_ADMIN_ID,
  save: jest.fn(async function save() {
    return this
  }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      name: this.name,
      description: this.description,
      featureEntitlements: this.featureEntitlements,
      isActive: this.isActive,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    }
  },
  ...overrides,
})

let app
let request
let tokenService
let User
let LicenseLevel
let Customer
let AuditLog
let originalLicenseLevelSave

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  LicenseLevel.findOne.mockReturnValue({ select })
  return select
}

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  LicenseLevel = models.LicenseLevel
  Customer = models.Customer
  AuditLog = models.AuditLog

  originalLicenseLevelSave = LicenseLevel.prototype.save
})

afterAll(() => {
  LicenseLevel.prototype.save = originalLicenseLevelSave
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

  LicenseLevel.find = jest.fn()
  LicenseLevel.countDocuments = jest.fn()
  LicenseLevel.findOne = jest.fn()
  LicenseLevel.findById = jest.fn()
  LicenseLevel.prototype.save = jest.fn(async function save() {
    return this
  })
  Customer.aggregate = jest.fn().mockResolvedValue([])

  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Licence Level Routes', () => {
  test('GET /api/v1/super-admin/licence-levels returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/licence-levels')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/licence-levels returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeFakeUser({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/licence-levels')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('POST /api/v1/super-admin/licence-levels returns 422 when name is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/licence-levels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Tier without name',
        featureEntitlements: ['FEATURE_A'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('name')
  })

  test('POST /api/v1/super-admin/licence-levels creates a licence level', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/licence-levels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Enterprise',
        description: 'Top tier',
        featureEntitlements: ['FEATURE_A', 'FEATURE_B'],
        isActive: true,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Enterprise')
    expect(res.body.data.featureEntitlements).toEqual(['FEATURE_A', 'FEATURE_B'])
    expect(LicenseLevel.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/licence-levels returns 409 for duplicate name', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    mockFindOneSelect({ _id: '607f1f77bcf86cd799439088' })

    const res = await request
      .post('/api/v1/super-admin/licence-levels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Enterprise',
        description: 'Top tier',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('GET /api/v1/super-admin/licence-levels returns paginated licence levels', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const rows = [
      {
        _id: LICENSE_LEVEL_ID,
        name: 'Standard',
        description: 'Standard tier',
        featureEntitlements: ['FEATURE_A'],
        isActive: true,
      },
    ]

    LicenseLevel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    })
    LicenseLevel.countDocuments.mockResolvedValue(1)
    Customer.aggregate.mockResolvedValue([{ _id: LICENSE_LEVEL_ID, count: 1 }])

    const res = await request
      .get('/api/v1/super-admin/licence-levels?page=1&pageSize=20')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('GET /api/v1/super-admin/licence-levels/:licenseLevelId returns 404 when not found', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    LicenseLevel.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/super-admin/licence-levels/${LICENSE_LEVEL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/v1/super-admin/licence-levels/:licenseLevelId returns licence level', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    LicenseLevel.findById.mockResolvedValue(makeFakeLicenseLevel())

    const res = await request
      .get(`/api/v1/super-admin/licence-levels/${LICENSE_LEVEL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(LICENSE_LEVEL_ID)
  })

  test('PATCH /api/v1/super-admin/licence-levels/:licenseLevelId returns 404 when not found', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    LicenseLevel.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/super-admin/licence-levels/${LICENSE_LEVEL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Updated description' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/super-admin/licence-levels/:licenseLevelId updates licence level', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const licenseLevel = makeFakeLicenseLevel()
    LicenseLevel.findById.mockResolvedValue(licenseLevel)
    mockFindOneSelect(null)

    const res = await request
      .patch(`/api/v1/super-admin/licence-levels/${LICENSE_LEVEL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Updated tier description',
        featureEntitlements: ['FEATURE_A', 'FEATURE_C'],
      })

    expect(res.status).toBe(200)
    expect(licenseLevel.save).toHaveBeenCalled()
    expect(res.body.data.description).toBe('Updated tier description')
    expect(res.body.data.featureEntitlements).toEqual(['FEATURE_A', 'FEATURE_C'])
    expect(AuditLog.createLog).toHaveBeenCalled()
  })
})
