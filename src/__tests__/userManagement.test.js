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
const TENANT_ADMIN_ID = '507f1f77bcf86cd799439015'
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

const makeTenantAdmin = (overrides = {}) => ({
  _id: TENANT_ADMIN_ID,
  id: TENANT_ADMIN_ID,
  email: 'tenant.admin@acme.com',
  name: 'Tenant Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
  tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
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

const makeFakeInvitation = (overrides = {}) => ({
  _id: '807f1f77bcf86cd799439099',
  id: '807f1f77bcf86cd799439099',
  recipientEmail: 'invitee@example.com',
  recipientName: 'Invitee User',
  status: 'sent',
  resendCount: 0,
  provisionedCustomerId: CUSTOMER_ID,
  provisionedUserId: NEW_USER_ID,
  assignCustomerAdminOnComplete: false,
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      recipientEmail: this.recipientEmail,
      recipientName: this.recipientName,
      status: this.status,
      provisionedCustomerId: this.provisionedCustomerId,
      provisionedUserId: this.provisionedUserId,
    }
  },
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService
let User, Customer, Tenant, Role, AuditLog, Invitation
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
  Role = models.Role
  AuditLog = models.AuditLog
  Invitation = models.Invitation
})

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

let superAdminToken, customerAdminToken, regularUserToken, tenantAdminToken

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

const getTenantAdminToken = async () => {
  if (tenantAdminToken) return tenantAdminToken
  const tokens = await tokenService.generateTokens(makeTenantAdmin())
  tenantAdminToken = tokens.accessToken
  return tenantAdminToken
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
  Tenant.find = jest.fn()
  Tenant.countDocuments = jest.fn()
  Tenant.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  Role.find = jest.fn()
  AuditLog.createLog = jest.fn(async () => ({}))
  Invitation.findOne = jest.fn(() => ({
    select: jest.fn(() => ({
      sort: jest.fn().mockResolvedValue(null),
    })),
  }))
  Invitation.create = jest.fn(async (payload) => makeFakeInvitation(payload))
  Invitation.generateToken = jest.fn(() => ({ raw: 'raw-token', hash: 'hash-token' }))
  Customer.findOne.mockResolvedValue(null)
  Customer.findById.mockImplementation((id) => {
    if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
    return Promise.resolve(null)
  })

  // Default: loadScopes resolves correct user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
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
      expect(Object.keys(res.body.error.details).sort()).toEqual(['name'])
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
      expect(Object.keys(res.body.error.details).sort()).toEqual(['email'])
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
      expect(Object.keys(res.body.error.details).sort()).toEqual(['roles'])
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

    test('returns 422 with assign-mode field key existingUserId when existingUserId is invalid', async () => {
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
          existingUserId: 'not-an-id',
          roles: ['USER'],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['existingUserId'])
    })

    test('returns 422 with assign-mode field key roles when roles are missing', async () => {
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
          existingUserId: REGULAR_USER_ID,
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['roles'])
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
      expect(res.body.error.details).toHaveProperty('name')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['name'])
    })

    test('returns 422 when email is invalid', async () => {
      const token = await getSuperAdminToken()

      const res = await request
        .patch(`/api/v1/users/${REGULAR_USER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'not-an-email' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('email')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['email'])
    })

    test('returns 422 when roles is empty array', async () => {
      const token = await getSuperAdminToken()

      const res = await request
        .patch(`/api/v1/users/${REGULAR_USER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('roles')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['roles'])
    })

    test('returns 422 with field keys name and roles when both are invalid', async () => {
      const token = await getSuperAdminToken()

      const res = await request
        .patch(`/api/v1/users/${REGULAR_USER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '', roles: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(Object.keys(res.body.error.details).sort()).toEqual(['name', 'roles'])
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

  test('customer user routes return stable inactive-customer payload when membership is inactive', async () => {
    const token = await getCustomerAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.inactiveCustomerIds).toEqual([CUSTOMER_ID])
    expect(res.body.error.requestId).toBeDefined()
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
    expect(res.body.data[0].tenantVisibility).toEqual([TENANT_ID])
    expect(res.body.data[0].status).toBe('ACTIVE')
    expect(res.body.data[0].isCanonicalAdmin).toBe(false)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('allows tenant admin to list customer users via customer-scoped route', async () => {
    const token = await getTenantAdminToken()

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })

    const regularUserLean = { ...makeRegularUser() }
    delete regularUserLean.toJSON
    delete regularUserLean.save
    User.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([regularUserLean]),
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
    expect(res.body.data[0].id).toBe(REGULAR_USER_ID)
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
    expect(res.body.data.outcome).toBe('invited_new')
    expect(res.body.data.invitationDispatched).toBe(true)
    expect(res.body.data.invitationOutcome).toBe('sent')
    expect(AuditLog.createLog).toHaveBeenCalled()

    User.prototype.save = origSave
  })

  test('seeds the shared manual-test password for targeted created users when enabled', async () => {
    const token = await getCustomerAdminToken()
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    const previousPassword = env.manualTestPasswordBootstrapPassword
    env.fakeAuthAllowed = true
    env.manualTestPasswordBootstrapPassword = 'Vmf!Test123'

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)

    const sendInvitationSpy = jest
      .spyOn(identityPlusService, 'sendInvitation')
      .mockResolvedValueOnce({ invitedAt: new Date('2026-03-12T09:00:00.000Z') })

    const originalSave = User.prototype.save
    const savedUsers = []
    User.prototype.save = jest.fn(async function () {
      this._id = this._id || NEW_USER_ID
      this.id = this.id || NEW_USER_ID
      savedUsers.push(this)
      return this
    })

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Any QA User',
          email: 'qa.user+1@example.test',
          roles: ['USER'],
        })

      expect(res.status).toBe(201)
      expect(savedUsers[0]).toBeDefined()
      expect(savedUsers[0].passwordHash).toBeDefined()
      await expect(savedUsers[0].comparePassword('Vmf!Test123')).resolves.toBe(true)
    } finally {
      User.prototype.save = originalSave
      env.fakeAuthAllowed = previousFakeAuthAllowed
      env.manualTestPasswordBootstrapPassword = previousPassword
      sendInvitationSpy.mockRestore()
    }
  })

  test('returns fake-auth authLink for customer-admin user invitations without customer-admin escalation flag', async () => {
    const token = await getCustomerAdminToken()
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)

    Invitation.findOne.mockReturnValue({
      select: jest.fn(() => ({
        sort: jest.fn().mockResolvedValue(null),
      })),
    })

    const fakeInvitation = makeFakeInvitation({
      _id: '807f1f77bcf86cd7994390aa',
      provisionedUserId: NEW_USER_ID,
    })
    Invitation.create.mockResolvedValue(fakeInvitation)
    Invitation.generateToken.mockReturnValue({
      raw: 'raw-customer-user-token',
      hash: 'hash-customer-user-token',
    })

    const sendInvitationSpy = jest
      .spyOn(identityPlusService, 'sendInvitation')
      .mockResolvedValueOnce({ externalId: 'mock_ext_fake_auth', invitedAt: new Date() })

    const originalSave = User.prototype.save
    User.prototype.save = jest.fn(async function () {
      this._id = this._id || NEW_USER_ID
      this.id = this.id || NEW_USER_ID
      return this
    })

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fake Auth User',
          email: 'fake.auth.user@example.com',
          roles: ['USER'],
        })

      expect(res.status).toBe(201)
      expect(res.body.data.authLink).toContain('/api/v1/super-admin/invitations/auth/raw-customer-user-token')
      expect(res.body.data.invitationId).toBe(fakeInvitation._id)
      expect(Invitation.create).toHaveBeenCalled()
      expect(Invitation.create.mock.calls[0][0].assignCustomerAdminOnComplete).toBe(false)
      expect(Invitation.create.mock.calls[0][0].status).toBe('sent')
    } finally {
      User.prototype.save = originalSave
      env.fakeAuthAllowed = previousFakeAuthAllowed
      sendInvitationSpy.mockRestore()
    }
  })

  test('returns invited_new with send_failed when invitation dispatch fails', async () => {
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
    const sendInvitationSpy = jest
      .spyOn(identityPlusService, 'sendInvitation')
      .mockRejectedValueOnce(new Error('identity plus unavailable'))

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
    expect(res.body.data.outcome).toBe('invited_new')
    expect(res.body.data.invitationDispatched).toBe(false)
    expect(res.body.data.invitationOutcome).toBe('send_failed')

    User.prototype.save = origSave
    sendInvitationSpy.mockRestore()
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
    expect(res.body.error.code).toBe('USER_ALREADY_EXISTS')
    expect(res.body.error.details?.reason).toBe('already-in-customer')
  })

  test('returns 409 USER_ALREADY_EXISTS with other-customer reason for duplicate email in another customer', async () => {
    const token = await getCustomerAdminToken()
    const externalCustomerUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(externalCustomerUser)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'External User',
        email: 'external@acme.com',
        roles: ['USER'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('USER_ALREADY_EXISTS')
    expect(res.body.error.details?.reason).toBe('other-customer')
    expect(res.body.error.details?.targetCustomerId).toBe(CUSTOMER_ID)
  })

  test('assigns roles to existing user without dispatching invitation', async () => {
    const token = await getCustomerAdminToken()
    const existingUser = makeRegularUser({
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    const sendInvitationSpy = jest.spyOn(identityPlusService, 'sendInvitation')

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(existingUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        existingUserId: REGULAR_USER_ID,
        roles: ['TENANT_ADMIN'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.outcome).toBe('assigned_existing')
    expect(res.body.data.invitationDispatched).toBe(false)
    expect(res.body.data.invitationOutcome).toBe('none')
    expect(sendInvitationSpy).not.toHaveBeenCalled()
    expect(existingUser.memberships[0].roles).toEqual(['TENANT_ADMIN'])

    sendInvitationSpy.mockRestore()
  })

  test('returns 409 when selected existing user belongs to another customer', async () => {
    const token = await getCustomerAdminToken()
    const externalCustomerUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(externalCustomerUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        existingUserId: REGULAR_USER_ID,
        roles: ['USER'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('USER_CUSTOMER_CONFLICT')
    expect(res.body.error.details?.reason).toBe('other-customer')
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
    expect(res.body.error.details?.reason).toBe('TENANT_VISIBILITY_INVALID_TENANT_IDS')
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
    expect(res.body.data.tenantVisibility).toEqual([TENANT_ID])

    User.prototype.save = origSave
  })

  test('returns 422 when tenant visibility is sent for a single-tenant customer', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) {
        return Promise.resolve(
          makeFakeCustomer({
            topology: 'SINGLE_TENANT',
            vmfPolicy: 'SINGLE',
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
        name: 'Jane User',
        email: 'jane@example.com',
        roles: ['USER'],
        tenantVisibility: [TENANT_ID],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('TENANT_VISIBILITY_NOT_ALLOWED')
    expect(res.body.error.details?.tenantVisibility).toMatch(/not allowed in this mode/i)
    expect(res.body.error.details?.tenantVisibilityMode).toBe('DISALLOWED')
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
    expect(res.body.data.status).toBe('ACTIVE')
    expect(res.body.data.customerRoles).toEqual(['USER'])
    expect(res.body.data.tenantVisibility).toEqual([TENANT_ID])
    expect(res.body.data.isCanonicalAdmin).toBe(false)
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

describe('PATCH /api/v1/customers/:customerId/users/:userId', () => {
  test('updates a user for a customer admin without requiring SUPER_ADMIN', async () => {
    const token = await getCustomerAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' })

    expect(res.status).toBe(200)
    expect(user.save).toHaveBeenCalled()
    expect(res.body.data.name).toBe('Updated Name')
    expect(res.body.data.customerRoles).toEqual(['USER'])
    expect(res.body.data.tenantVisibility).toEqual([TENANT_ID])
  })

  test('returns 404 when the target user is outside the customer scope', async () => {
    const token = await getCustomerAdminToken()
    const differentCustomerUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(differentCustomerUser)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' })

    expect(res.status).toBe(404)
    expect(differentCustomerUser.save).not.toHaveBeenCalled()
  })

  test('allows tenant admin to update tenant visibility within managed scope', async () => {
    const token = await getTenantAdminToken()
    const user = makeRegularUser({
      tenantMemberships: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID_2, roles: ['USER'] },
      ],
    })

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Tenant.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: TENANT_ID }]),
      }),
    })
    Tenant.countDocuments.mockResolvedValue(2)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantVisibility: [TENANT_ID] })

    expect(res.status).toBe(200)
    expect(user.save).toHaveBeenCalled()
    expect(res.body.data.tenantVisibility).toEqual(expect.arrayContaining([TENANT_ID, TENANT_ID_2]))
    expect(Tenant.find).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantAdminUserIds: TENANT_ADMIN_ID,
    })
  })

  test('returns 403 when tenant admin attempts non-tenant-visibility fields', async () => {
    const token = await getTenantAdminToken()
    const user = makeRegularUser()

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Not Allowed' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.details?.reason).toBe('TENANT_ADMIN_UPDATE_SCOPE_RESTRICTED')
  })

  test('returns 422 when tenant admin submits out-of-scope tenant visibility', async () => {
    const token = await getTenantAdminToken()
    const user = makeRegularUser()

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Tenant.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: TENANT_ID }]),
      }),
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantVisibility: [TENANT_ID_2] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('TENANT_VISIBILITY_INVALID_TENANT_IDS')
    expect(res.body.error.details?.invalidTenantIds).toEqual([TENANT_ID_2])
  })
})

describe('PATCH /api/v1/users/:userId', () => {
  test('returns 403 when target user belongs to an inactive customer', async () => {
    const token = await getSuperAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked Update' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(res.body.error.requestId).toBeDefined()
  })

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
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_ROLE_UPDATED',
      requestId: res.body.meta.requestId,
      resourceType: 'User',
      resourceId: REGULAR_USER_ID,
    }))
  })

  test('updates user email, normalizes it, and resets identity trust state', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      email: 'old-email@acme.com',
      identityPlus: {
        trustStatus: 'TRUSTED',
        externalId: 'ext_old_123',
        invitedAt: new Date('2026-01-15'),
        trustedAt: new Date('2026-02-20'),
      },
    })
    const revokeTrustSpy = jest.spyOn(identityPlusService, 'revokeTrust')

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'Updated.Email@Acme.com ' })

    expect(res.status).toBe(200)
    expect(user.email).toBe('updated.email@acme.com')
    expect(user.identityPlus.trustStatus).toBe('UNTRUSTED')
    expect(user.identityPlus.externalId).toBeNull()
    expect(user.identityPlus.invitedAt).toBeNull()
    expect(user.identityPlus.trustedAt).toBeNull()
    expect(res.body.data.email).toBe('updated.email@acme.com')
    expect(res.body.data.trustStatus).toBe('UNTRUSTED')
    expect(revokeTrustSpy).toHaveBeenCalledWith({
      email: 'old-email@acme.com',
      externalId: 'ext_old_123',
    })

    revokeTrustSpy.mockRestore()
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
    expect(res.body.error.details?.reason).toBe('CANONICAL_ADMIN_ROLE_REMOVAL_BLOCKED')
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
    expect(res.body.error.details?.reason).toBe('SECOND_CUSTOMER_ADMIN_BLOCKED')
    expect(res.body.error.details?.canonicalAdminUserId).toBe(CUSTOMER_ADMIN_ID)
  })

  test('returns 409 USER_ALREADY_EXISTS when updating email to an existing user in another customer', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()
    const existingUser = makeRegularUser({
      _id: NEW_USER_ID,
      id: NEW_USER_ID,
      email: 'duplicate@example.com',
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(existingUser)

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'duplicate@example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('USER_ALREADY_EXISTS')
    expect(res.body.error.details?.reason).toBe('other-customer')
    expect(res.body.error.details?.targetCustomerId).toBe(CUSTOMER_ID)
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
    expect(res.body.data.tenantVisibility).toEqual([TENANT_ID, TENANT_ID_2])
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
    expect(res.body.error.details?.reason).toBe('TENANT_VISIBILITY_INVALID_TENANT_IDS')
  })

  test('returns 422 when tenant visibility is updated for a single-tenant customer', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
      }),
    )

    const res = await request
      .patch(`/api/v1/users/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantVisibility: [TENANT_ID] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('TENANT_VISIBILITY_NOT_ALLOWED')
    expect(res.body.error.details?.tenantVisibilityMode).toBe('DISALLOWED')
  })
})

/* ================================================================== */
/*  ENABLE USER                                                       */
/* ================================================================== */

describe('POST /api/v1/users/:userId/enable', () => {
  test('reactivates a disabled user and resets revoked trust to UNTRUSTED', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      isActive: false,
      identityPlus: { trustStatus: 'REVOKED', externalId: 'ext_1' },
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(user.isActive).toBe(true)
    expect(user.identityPlus.trustStatus).toBe('UNTRUSTED')
    expect(user.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_ENABLED',
      requestId: res.body.meta.requestId,
      resourceType: 'User',
      resourceId: REGULAR_USER_ID,
    }))
  })

  test('returns 422 when user is already active', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({ isActive: true })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('USER_ALREADY_ACTIVE')
    expect(res.body.error.details?.status).toBe('ACTIVE')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/users/${NEW_USER_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('allows resend invitation after reactivation resets revoked trust', async () => {
    const token = await getSuperAdminToken()
    const user = makeRegularUser({
      isActive: false,
      identityPlus: { trustStatus: 'REVOKED', externalId: 'ext_old_1' },
    })

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const enableRes = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(enableRes.status).toBe(200)
    expect(user.identityPlus.trustStatus).toBe('UNTRUSTED')

    const resendRes = await request
      .post(`/api/v1/users/${REGULAR_USER_ID}/resend-invitation`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(resendRes.status).toBe(200)
    expect(resendRes.body.data.message).toContain('resent')
  })
})

/* ================================================================== */
/*  DISABLE USER                                                      */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/users/:userId/disable', () => {
  test('disables an in-scope user for a customer admin', async () => {
    const token = await getCustomerAdminToken()
    const user = makeRegularUser({
      identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_1' },
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(user.isActive).toBe(false)
    expect(user.identityPlus.trustStatus).toBe('REVOKED')
    expect(res.body.data.status).toBe('INACTIVE')
    expect(res.body.data.trustStatus).toBe('REVOKED')
  })

  test('returns 404 when the target user is outside the customer scope', async () => {
    const token = await getCustomerAdminToken()
    const differentCustomerUser = makeRegularUser({
      identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_1' },
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(differentCustomerUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(differentCustomerUser.save).not.toHaveBeenCalled()
  })
})

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
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_DISABLED',
      requestId: res.body.meta.requestId,
      resourceType: 'User',
      resourceId: REGULAR_USER_ID,
    }))
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
    expect(res.body.error.details?.reason).toBe('USER_ALREADY_DISABLED')
    expect(res.body.error.details?.status).toBe('INACTIVE')
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
    expect(res.body.error.details?.reason).toBe('CANONICAL_ADMIN_PROTECTED')
    expect(res.body.error.details?.operation).toBe('disable')
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
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_DELETED',
      requestId: res.body.meta.requestId,
      resourceType: 'User',
      resourceId: REGULAR_USER_ID,
    }))
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
    expect(res.body.error.details?.reason).toBe('USER_DELETE_REQUIRES_DISABLED')
    expect(res.body.error.details?.status).toBe('ACTIVE')
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
    expect(res.body.error.details?.reason).toBe('CANONICAL_ADMIN_PROTECTED')
    expect(res.body.error.details?.operation).toBe('delete')
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

  test('returns fake-auth authLink on customer-scoped resend when fake auth is enabled', async () => {
    const token = await getCustomerAdminToken()
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    const user = makeRegularUser({
      _id: REGULAR_USER_ID,
      identityPlus: { trustStatus: 'UNTRUSTED', externalId: null },
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(user)
      return Promise.resolve(null)
    })

    Invitation.findOne.mockReturnValue({
      select: jest.fn(() => ({
        sort: jest.fn().mockResolvedValue(
          makeFakeInvitation({
            _id: '807f1f77bcf86cd7994390ab',
            status: 'accessed',
            resendCount: 1,
            provisionedUserId: REGULAR_USER_ID,
            save: jest.fn(async function () { return this }),
          }),
        ),
      })),
    })
    Invitation.generateToken.mockReturnValue({
      raw: 'raw-resend-token',
      hash: 'hash-resend-token',
    })

    const sendInvitationSpy = jest
      .spyOn(identityPlusService, 'sendInvitation')
      .mockResolvedValueOnce({ externalId: 'mock_ext_resend', invitedAt: new Date() })

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/${REGULAR_USER_ID}/resend-invitation`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.data.authLink).toContain('/api/v1/super-admin/invitations/auth/raw-resend-token')
      expect(res.body.data.invitationId).toBe('807f1f77bcf86cd7994390ab')
      expect(res.body.data.message).toContain('resent')
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
      sendInvitationSpy.mockRestore()
    }
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
    expect(res.body.error.details?.reason).toBe('INVITATION_RESEND_REQUIRES_ACTIVE_USER')
    expect(res.body.error.details?.status).toBe('INACTIVE')
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
    expect(res.body.error.details?.reason).toBe('INVITATION_RESEND_REQUIRES_UNTRUSTED')
    expect(res.body.error.details?.trustStatus).toBe('TRUSTED')
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
    expect(res.body.error.details?.reason).toBe('INVITATION_RESEND_REQUIRES_UNTRUSTED')
    expect(res.body.error.details?.trustStatus).toBe('REVOKED')
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
    expect(res.body.error.details?.reason).toBe('CANONICAL_ADMIN_EXISTS')
  })
})

describe('Assignable role catalogue', () => {
  const buildRoleFindChain = (rows) => ({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(rows),
    }),
  })

  test('returns active non-reserved roles for a customer admin', async () => {
    const token = await getCustomerAdminToken()
    Role.find.mockReturnValue(buildRoleFindChain([
      { key: 'TENANT_ADMIN', name: 'Tenant Administrator', isActive: true, isSystem: true },
      { key: 'USER', name: 'Standard User', isActive: true, isSystem: true },
      { key: 'VMF_CREATOR', name: 'VMF Creator', isActive: true, isSystem: false },
    ]))

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/assignable-roles`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Role.find).toHaveBeenCalledWith({
      isActive: true,
      key: { $nin: ['CUSTOMER_ADMIN', 'SUPER_ADMIN'] },
    })
    expect(res.body.data).toEqual([
      { key: 'TENANT_ADMIN', name: 'Tenant Administrator', isActive: true, isSystem: true },
      { key: 'USER', name: 'Standard User', isActive: true, isSystem: true },
      { key: 'VMF_CREATOR', name: 'VMF Creator', isActive: true, isSystem: false },
    ])
    expect(res.body.meta.customerId).toBe(CUSTOMER_ID)
    expect(res.body.meta.total).toBe(3)
  })

  test('allows a super admin to read the customer-scoped assignable role catalogue', async () => {
    const token = await getSuperAdminToken()
    Role.find.mockReturnValue(buildRoleFindChain([
      { key: 'USER', name: 'Standard User', isActive: true, isSystem: true },
    ]))

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/assignable-roles`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { key: 'USER', name: 'Standard User', isActive: true, isSystem: true },
    ])
  })

  test('rejects a non-admin user from reading the assignable role catalogue', async () => {
    const token = await getRegularUserToken()

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/assignable-roles`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(Role.find).not.toHaveBeenCalled()
  })

  test('rejects a customer admin from another customer', async () => {
    const otherCustomerAdminId = '507f1f77bcf86cd799439016'
    const otherCustomerId = '607f1f77bcf86cd799439023'
    const otherCustomerAdmin = makeCustomerAdmin({
      _id: otherCustomerAdminId,
      id: otherCustomerAdminId,
      email: 'other.admin@acme.com',
      memberships: [{ customerId: otherCustomerId, roles: ['CUSTOMER_ADMIN'] }],
    })
    const tokens = await tokenService.generateTokens(otherCustomerAdmin)

    User.findById.mockImplementation((id) => {
      if (id === otherCustomerAdminId) return Promise.resolve(otherCustomerAdmin)
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/users/assignable-roles`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(Role.find).not.toHaveBeenCalled()
  })
})
