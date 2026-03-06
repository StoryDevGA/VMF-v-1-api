/**
 * User Management Tests
 *
 * Integration-style tests for Phase 3.2 endpoints:
 *
 *   User Routes (Customer Admin — customer-scoped):
 *     - GET    /api/v1/customers/:customerId/users
 *     - POST   /api/v1/customers/:customerId/users
 *     - GET    /api/v1/customers/:customerId/users/:userId
 *
 *   User Routes (SUPER_ADMIN — user-scoped):
 *     - PATCH  /api/v1/users/:userId
 *     - POST   /api/v1/users/:userId/disable
 *     - DELETE /api/v1/users/:userId
 *     - POST   /api/v1/users/:userId/resend-invitation
 *
 *   Validators:
 *     - User create / update / resendInvitation
 *
 * All Mongoose model statics are monkey-patched; no real database required.
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

/* ------------------------------------------------------------------ */
/*  Environment setup (must run before any app imports)               */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.USER_MGMT_RATE_LIMIT = '10000'
  process.env.TENANT_RATE_LIMIT = '10000'
})

/* ------------------------------------------------------------------ */
/*  Ids                                                               */
/* ------------------------------------------------------------------ */

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const REGULAR_USER_ID = '507f1f77bcf86cd799439013'
const NEW_USER_ID = '507f1f77bcf86cd799439014'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const TENANT_ID_2 = '707f1f77bcf86cd799439044'

/* ------------------------------------------------------------------ */
/*  Factories                                                         */
/* ------------------------------------------------------------------ */

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
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeCustomerAdmin = (overrides = {}) => ({
  _id: CUSTOMER_ADMIN_ID,
  id: CUSTOMER_ADMIN_ID,
  email: 'custadmin@acme.com',
  name: 'Customer Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeRegularUser = (overrides = {}) => ({
  _id: REGULAR_USER_ID,
  id: REGULAR_USER_ID,
  email: 'user@acme.com',
  name: 'Regular User',
  isActive: true,
  identityPlus: {
    trustStatus: 'UNTRUSTED',
    externalId: 'mock_ext_123',
    invitedAt: new Date('2026-01-15'),
  },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  status: 'ACTIVE',
  isServiceProvider: false,
  entitlements: [],
  billing: { planCode: 'PRO', cycle: 'MONTHLY' },
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return { id: this._id, name: this.name, topology: this.topology }
  },
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService
let User, Customer, Tenant, AuditLog
let identityPlusService

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  identityPlusService = (await import('../services/identityPlusService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  AuditLog = models.AuditLog
})

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

let superAdminToken, customerAdminToken, regularUserToken

const getSuperAdminToken = async () => {
  if (superAdminToken) return superAdminToken
  const tokens = await tokenService.generateTokens(makeSuperAdmin())
  superAdminToken = tokens.accessToken
  return superAdminToken
}

const getCustomerAdminToken = async () => {
  if (customerAdminToken) return customerAdminToken
  const tokens = await tokenService.generateTokens(makeCustomerAdmin())
  customerAdminToken = tokens.accessToken
  return customerAdminToken
}

const getRegularUserToken = async () => {
  if (regularUserToken) return regularUserToken
  const tokens = await tokenService.generateTokens(makeRegularUser())
  regularUserToken = tokens.accessToken
  return regularUserToken
}

/* ------------------------------------------------------------------ */
/*  Reset stubs before each test                                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  User.findById = jest.fn()
  User.findOne = jest.fn()
  User.find = jest.fn()
  User.countDocuments = jest.fn()
  User.deleteOne = jest.fn()
  Customer.findById = jest.fn()
  Customer.findOne = jest.fn()
  Tenant.countDocuments = jest.fn()
  Tenant.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  AuditLog.createLog = jest.fn(async () => ({}))
  Customer.findOne.mockResolvedValue(null)
  Customer.findById.mockImplementation((id) => {
    if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
    return Promise.resolve(null)
  })

  // Default: loadScopes resolves correct user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
    return Promise.resolve(null)
  })
})

/* ================================================================== */
/*  USER VALIDATOR TESTS                                              */
/* ================================================================== */

describe('User Validators', () => {
  describe('POST /api/v1/customers/:customerId/users — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getCustomerAdminToken()
      Customer.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(null)
        return Promise.resolve(null)
      })
      User.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
        return Promise.resolve(null)
      })

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'test@example.com', roles: ['USER'] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when email is invalid', async () => {
      const token = await getCustomerAdminToken()
      Customer.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
        return Promise.resolve(null)
      })
      User.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
        return Promise.resolve(null)
      })

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane User', email: 'not-an-email', roles: ['USER'] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('email')
    })

    test('returns 422 when roles is empty array', async () => {
      const token = await getCustomerAdminToken()
      Customer.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
        return Promise.resolve(null)
      })
      User.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
        return Promise.resolve(null)
      })

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane User', email: 'jane@example.com', roles: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('roles')
    })

    test('returns 422 when tenantVisibility contains invalid ObjectId', async () => {
      const token = await getCustomerAdminToken()
      Customer.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
        return Promise.resolve(null)
      })
      User.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
        return Promise.resolve(null)
      })

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Jane User',
          email: 'jane@example.com',
          roles: ['USER'],
          tenantVisibility: ['not-an-id'],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /api/v1/users/:userId — validation', () => {
    test('returns 422 when name is empty string', async () => {
      const token = await getSuperAdminToken()

      const res = await request
        .patch(`/api/v1/users/${REGULAR_USER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when roles is empty array', async () => {
      const token = await getSuperAdminToken()

      const res = await request
        .patch(`/api/v1/users/${REGULAR_USER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('GET /api/v1/customers/:customerId/users — validation', () => {
    test('returns 422 when status query is invalid', async () => {
      const token = await getCustomerAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())
      User.findById.mockImplementation((id) => {
        if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
        return Promise.resolve(null)
      })

      const res = await request
        .get(`/api/v1/customers/${CUSTOMER_ID}/users?status=paused`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('status')
    })
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('User authorization guards', () => {
  test('customer user routes return 401 without auth token', async () => {
    const res = await request.get(`/api/v1/customers/${CUSTOMER_ID}/users`)
    expect(res.status).toBe(401)
  })

  test('customer user routes return 403 for regular USER role', async () => {
    const token = await getRegularUserToken()

    // requireCustomerAccess needs Customer.findById
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('user-scoped routes return 401 without auth token', async () => {
    const res = await request.patch(`/api/v1/users/${REGULAR_USER_ID}`)
    expect(res.status).toBe(401)
  })

  test('user-scoped routes return 403 for non-SUPER_ADMIN', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' })

    expect(res.status).toBe(403)
  })
})

/* ================================================================== */
/*  LIST USERS                                                        */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/users', () => {
  test('returns paginated user list', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    const regularUserLean = { ...makeRegularUser() }
    delete regularUserLean.toJSON
    delete regularUserLean.save
    const users = [regularUserLean]
    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(users),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].customerRoles).toEqual(['USER'])
    expect(res.body.data[0].status).toBe('ACTIVE')
    expect(res.body.data[0].isCanonicalAdmin).toBe(false)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('supports search by query param q', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users?q=jane%2Bdemo`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(User.find).toHaveBeenCalledWith(expect.objectContaining({
      $or: [
        { name: { $regex: 'jane\\+demo', $options: 'i' } },
        { email: { $regex: 'jane\\+demo', $options: 'i' } },
      ],
    }))
  })

  test('supports status filter', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users?status=active`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(User.find).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }))
  })

  test('treats empty q as unset filter', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users?q=`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(User.find).toHaveBeenCalledWith({ 'memberships.customerId': CUSTOMER_ID })
    expect(res.body.meta.filters.q).toBe(null)
  })

  test('treats empty role as unset filter', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users?role=`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(User.find).toHaveBeenCalledWith({ 'memberships.customerId': CUSTOMER_ID })
    expect(res.body.meta.filters.role).toBe(null)
  })

  test('supports role filter and marks canonical admin rows', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        governance: { customerAdminUserId: REGULAR_USER_ID },
      }),
    )
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const canonicalUserLean = {
      ...makeRegularUser({
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN', 'USER'] }],
      }),
    }
    delete canonicalUserLean.toJSON
    delete canonicalUserLean.save
    const users = [canonicalUserLean]
    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(users),
          }),
        }),
      }),
    })
    User.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users?role=CUSTOMER_ADMIN&status=ACTIVE`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(User.find).toHaveBeenCalledWith(expect.objectContaining({
      memberships: { $elemMatch: { customerId: CUSTOMER_ID, roles: 'CUSTOMER_ADMIN' } },
      isActive: true,
    }))
    expect(res.body.data[0].customerRoles).toEqual(['CUSTOMER_ADMIN', 'USER'])
    expect(res.body.data[0].isCanonicalAdmin).toBe(true)
  })
})

/* ================================================================== */
/*  CREATE USER                                                       */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/users', () => {
  test('creates user and triggers invitation', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null) // no duplicate

    // Mock User constructor .save()
    const origSave = User.prototype.save
    User.prototype.save = jest.fn(async function () {
      this._id = NEW_USER_ID
      this.id = NEW_USER_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane User',
        email: 'jane@example.com',
        roles: ['USER'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.email).toBe('jane@example.com')
    expect(AuditLog.createLog).toHaveBeenCalled()

    User.prototype.save = origSave
  })

  test('returns 409 when email already exists', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(makeRegularUser()) // duplicate exists

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane User',
        email: 'user@acme.com',
        roles: ['USER'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('returns 422 when tenantVisibility IDs do not belong to customer', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)
    Tenant.countDocuments.mockResolvedValue(0) // no matching tenants

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane User',
        email: 'jane@example.com',
        roles: ['USER'],
        tenantVisibility: [TENANT_ID],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('creates user with tenant visibility when valid', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)
    Tenant.countDocuments.mockResolvedValue(1) // tenant found

    const origSave = User.prototype.save
    User.prototype.save = jest.fn(async function () {
      this._id = NEW_USER_ID
      this.id = NEW_USER_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane User',
        email: 'jane@example.com',
        roles: ['USER'],
        tenantVisibility: [TENANT_ID],
      })

    expect(res.status).toBe(201)

    User.prototype.save = origSave
  })

  test('returns 404 when customer does not exist', async () => {
    const token = await getCustomerAdminToken()
    // loadScopes finds customer admin but requireCustomerAccess needs Customer
    Customer.findById.mockResolvedValue(null)
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane User',
        email: 'jane@example.com',
        roles: ['USER'],
      })

    // requireCustomerAccess returns 403 when customer not found
    expect([403, 404]).toContain(res.status)
  })
})

/* ================================================================== */
/*  GET USER                                                          */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/users/:userId', () => {
  test('returns user that belongs to customer', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })

    const user = makeRegularUser()
    // Override findById to return the requested user for the /:userId param
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.email).toBe('user@acme.com')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null) // user not found
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/${NEW_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 404 when user belongs to a different customer', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })

    const differentCustomerUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(differentCustomerUser)
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  UPDATE USER                                                       */
/* ================================================================== */

describe('PATCH /api/v1/users/:userId', () => {
  test('updates user name', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' })

    expect(res.status).toBe(200)
    expect(user.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates user roles', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['CUSTOMER_ADMIN', 'USER'] })

    expect(res.status).toBe(200)
    expect(user.save).toHaveBeenCalled()
  })

  test('returns 409 when removing CUSTOMER_ADMIN from canonical active customer admin', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN', 'USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        governance: { customerAdminUserId: REGULAR_USER_ID },
        status: 'ACTIVE',
      }),
    )

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['USER'] })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('returns 409 when assigning second CUSTOMER_ADMIN while canonical admin exists', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        governance: { customerAdminUserId: CUSTOMER_ADMIN_ID },
        status: 'ACTIVE',
      }),
    )

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['CUSTOMER_ADMIN', 'USER'] })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('updates tenant visibility', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Tenant.countDocuments.mockResolvedValue(2) // both tenants valid

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantVisibility: [TENANT_ID, TENANT_ID_2] })

    expect(res.status).toBe(200)
    expect(user.save).toHaveBeenCalled()
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/users/${NEW_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' })

    expect(res.status).toBe(404)
  })

  test('returns 422 when tenant visibility IDs are invalid', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Tenant.countDocuments.mockResolvedValue(0) // no matching tenants

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantVisibility: [TENANT_ID] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

/* ================================================================== */
/*  DISABLE USER                                                      */
/* ================================================================== */

describe('POST /api/v1/users/:userId/disable', () => {
  test('disables an active user and revokes trust', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({ identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_1' } })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(user.isActive).toBe(false)
    expect(user.identityPlus.trustStatus).toBe('REVOKED')
    expect(user.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when user is already disabled', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({ isActive: false })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${NEW_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 409 when disabling canonical customer admin of active customer', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Customer.findOne.mockResolvedValue({
      _id: CUSTOMER_ID,
      governance: { customerAdminUserId: REGULAR_USER_ID },
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})

/* ================================================================== */
/*  DELETE USER                                                       */
/* ================================================================== */

describe('DELETE /api/v1/users/:userId', () => {
  test('deletes a disabled user', async () => {
    const token = await getSuperAdminToken()
    const disabledUser = makeRegularUser({
      isActive: false,
      identityPlus: { trustStatus: 'REVOKED' },
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(disabledUser)
      return Promise.resolve(null)
    })
    User.deleteOne.mockResolvedValue({ deletedCount: 1 })

    const res = await request
      .delete(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('deleted')
    expect(User.deleteOne).toHaveBeenCalled()
    expect(Tenant.updateMany).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when user is still active', async () => {
    const token = await getSuperAdminToken()
    const activeUser = makeRegularUser({ isActive: true })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(activeUser)
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toContain('disabled')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/users/${NEW_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 409 when deleting canonical customer admin of active customer', async () => {
    const token = await getSuperAdminToken()
    const disabledCanonicalUser = makeRegularUser({
      isActive: false,
      identityPlus: { trustStatus: 'REVOKED' },
      memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(disabledCanonicalUser)
      return Promise.resolve(null)
    })
    Customer.findOne.mockResolvedValue({
      _id: CUSTOMER_ID,
      governance: { customerAdminUserId: REGULAR_USER_ID },
    })

    const res = await request
      .delete(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})

/* ================================================================== */
/*  RESEND INVITATION                                                 */
/* ================================================================== */

describe('POST /api/v1/users/:userId/resend-invitation', () => {
  test('resends invitation for UNTRUSTED user', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('resent')
    expect(user.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when user is disabled', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({ isActive: false })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('disabled')
  })

  test('returns 422 when trust status is TRUSTED', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      identityPlus: { trustStatus: 'TRUSTED', trustedAt: new Date() },
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('UNTRUSTED')
  })

  test('returns 422 when trust status is REVOKED', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      identityPlus: { trustStatus: 'REVOKED' },
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${NEW_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  ROLE ASSIGNMENT VALIDATION                                        */
/* ================================================================== */

describe('Role assignment during user create', () => {
  test('accepts multiple roles in create', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)

    const origSave = User.prototype.save
    User.prototype.save = jest.fn(async function () {
      this._id = NEW_USER_ID
      this.id = NEW_USER_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Multi-role User',
        email: 'multi@example.com',
        roles: ['CUSTOMER_ADMIN', 'USER'],
      })

    expect(res.status).toBe(201)

    User.prototype.save = origSave
  })

  test('rejects CUSTOMER_ADMIN create when active canonical admin already exists', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) {
        return Promise.resolve(
          makeFakeCustomer({
            governance: { customerAdminUserId: CUSTOMER_ADMIN_ID },
            status: 'ACTIVE',
          }),
        )
      }
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Second Admin User',
        email: 'second-admin@example.com',
        roles: ['CUSTOMER_ADMIN', 'USER'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})
