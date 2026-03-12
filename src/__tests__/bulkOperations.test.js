/**
 * Bulk Operations Tests
 *
 * Integration-style tests for Phase 4.1 endpoints:
 *
 *   POST  /api/v1/customers/:customerId/users/bulk          — Bulk create
 *   PATCH /api/v1/customers/:customerId/users/bulk          — Bulk update
 *   POST  /api/v1/customers/:customerId/users/bulk-disable  — Bulk disable
 *
 *   Validators:
 *     - bulkCreate / bulkUpdate / bulkDisable
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
})

/* ------------------------------------------------------------------ */
/*  Ids                                                               */
/* ------------------------------------------------------------------ */

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const REGULAR_USER_ID = '507f1f77bcf86cd799439013'
const USER_A_ID = '507f1f77bcf86cd799439014'
const USER_B_ID = '507f1f77bcf86cd799439015'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'

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
  identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_123' },
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
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeUserA = (overrides = {}) => ({
  _id: USER_A_ID,
  id: USER_A_ID,
  email: 'usera@acme.com',
  name: 'User A',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_a' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
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

const makeUserB = (overrides = {}) => ({
  _id: USER_B_ID,
  id: USER_B_ID,
  email: 'userb@acme.com',
  name: 'User B',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED', externalId: 'ext_b' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
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

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  status: 'ACTIVE',
  isServiceProvider: false,
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

let customerAdminToken, regularUserToken

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
  User.prototype.save = jest.fn(async function () {
    if (!this._id) {
      this._id = '507f1f77bcf86cd79943ff' + String(Math.floor(Math.random() * 100)).padStart(2, '0')
      this.id = this._id
    }
    return this
  })
  Customer.findById = jest.fn()
  Customer.findById.mockResolvedValue(makeFakeCustomer())
  Tenant.find = jest.fn()
  Tenant.countDocuments = jest.fn()
  AuditLog.createLog = jest.fn(async () => ({}))

  // Default: loadScopes resolves correct user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
    if (id === USER_A_ID) return Promise.resolve(makeUserA())
    if (id === USER_B_ID) return Promise.resolve(makeUserB())
    return Promise.resolve(null)
  })

  // Default: no existing users in DB
  User.find.mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),
  })

  // Default: no tenants found
  Tenant.find.mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),
  })
})

/* ================================================================== */
/*  BULK VALIDATOR TESTS                                              */
/* ================================================================== */

describe('Bulk Validators', () => {
  describe('POST /…/users/bulk — validation', () => {
    test('returns 422 when users array is missing', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when users array is empty', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({ users: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when user entry is missing name', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          users: [{ email: 'a@test.com', roles: ['USER'] }],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when user entry has invalid email', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          users: [{ name: 'Test', email: 'bad-email', roles: ['USER'] }],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /…/users/bulk — validation', () => {
    test('returns 422 when users array is missing', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when user entry has no update fields', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          users: [{ userId: REGULAR_USER_ID }],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('POST /…/users/bulk-disable — validation', () => {
    test('returns 422 when userIds array is missing', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when userIds is empty', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when userIds contains invalid ObjectId', async () => {
      const token = await getCustomerAdminToken()

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: ['not-an-id'] })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('Bulk authorization guards', () => {
  test('bulk create returns 401 without token', async () => {
    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
    expect(res.status).toBe(401)
  })

  test('bulk create returns 403 for regular USER role', async () => {
    const token = await getRegularUserToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ users: [{ name: 'A', email: 'a@b.com', roles: ['USER'] }] })

    expect(res.status).toBe(403)
  })

  test('bulk-disable returns 401 without token', async () => {
    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
    expect(res.status).toBe(401)
  })
})

/* ================================================================== */
/*  BULK CREATE USERS                                                 */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/users/bulk', () => {
  test('creates multiple users successfully (200)', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'Alice', email: 'alice@new.com', roles: ['USER'] },
          { name: 'Bob', email: 'bob@new.com', roles: ['USER'] },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.summary.total).toBe(2)
    expect(res.body.data.summary.succeeded).toBe(2)
    expect(res.body.data.summary.failed).toBe(0)
    expect(res.body.data.results).toHaveLength(2)
    expect(res.body.data.results[0].status).toBe('created')
    expect(res.body.data.results[1].status).toBe('created')
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('reports duplicate email from DB as per-item failure', async () => {
    const token = await getCustomerAdminToken()

    // One email already exists in DB
    User.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ email: 'existing@acme.com' }]),
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'Existing', email: 'existing@acme.com', roles: ['USER'] },
          { name: 'New User', email: 'new@acme.com', roles: ['USER'] },
        ],
        sendInvitations: false,
      })

    // 207 Multi-Status — partial success
    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[0].status).toBe('failed')
    expect(res.body.data.results[0].error).toContain('already exists')
    expect(res.body.data.results[1].status).toBe('created')
  })

  test('reports intra-batch duplicate emails', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'First', email: 'dupe@acme.com', roles: ['USER'] },
          { name: 'Second', email: 'dupe@acme.com', roles: ['USER'] },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    // First one succeeds, second fails as duplicate
    expect(res.body.data.results[0].status).toBe('created')
    expect(res.body.data.results[1].status).toBe('failed')
    expect(res.body.data.results[1].error).toContain('Duplicate')
  })

  test('reports invalid tenant visibility as per-item failure', async () => {
    const token = await getCustomerAdminToken()
    const INVALID_TENANT_ID = '707f1f77bcf86cd799439099'

    // Tenant.find returns no matching tenants
    Tenant.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'Good', email: 'good@acme.com', roles: ['USER'] },
          { name: 'Bad', email: 'bad@acme.com', roles: ['USER'], tenantVisibility: [INVALID_TENANT_ID] },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[1].error).toContain('invalid or do not belong')
    expect(res.body.data.results[1].errorCode).toBe('VALIDATION_FAILED')
    expect(res.body.data.results[1].errorDetails?.reason).toBe('TENANT_VISIBILITY_INVALID_TENANT_IDS')
    expect(res.body.data.results[1].errorDetails?.invalidTenantIds).toEqual([INVALID_TENANT_ID])
  })

  test('rejects tenant visibility entries for single-tenant customers during bulk create', async () => {
    const token = await getCustomerAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE' }),
    )

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          {
            name: 'Blocked',
            email: 'blocked@acme.com',
            roles: ['USER'],
            tenantVisibility: [TENANT_ID],
          },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(422)
    expect(res.body.data.summary.succeeded).toBe(0)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[0].errorCode).toBe('VALIDATION_FAILED')
    expect(res.body.data.results[0].errorDetails?.reason).toBe('TENANT_VISIBILITY_NOT_ALLOWED')
    expect(res.body.data.results[0].errorDetails?.tenantVisibilityMode).toBe('DISALLOWED')
  })

  test('returns 422 when all users fail', async () => {
    const token = await getCustomerAdminToken()

    // All emails already exist
    User.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { email: 'a@existing.com' },
        { email: 'b@existing.com' },
      ]),
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'A', email: 'a@existing.com', roles: ['USER'] },
          { name: 'B', email: 'b@existing.com', roles: ['USER'] },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(422)
    expect(res.body.data.summary.succeeded).toBe(0)
    expect(res.body.data.summary.failed).toBe(2)
  })

  test('sends invitations when sendInvitations is true', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'Invited', email: 'invited@acme.com', roles: ['USER'] },
        ],
        sendInvitations: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].invitationSent).toBe(true)
  })

  test('creates users without invitations', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { name: 'NoInvite', email: 'noinvite@acme.com', roles: ['USER'] },
        ],
        sendInvitations: false,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].invitationSent).toBe(false)
  })

  test('returns 404 when customer does not exist', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockResolvedValue(null)

    // loadScopes still finds the admin user
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [{ name: 'A', email: 'a@b.com', roles: ['USER'] }],
      })

    // requireCustomerAccess returns 404 when customer not found
    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  BULK UPDATE USERS                                                 */
/* ================================================================== */

describe('PATCH /api/v1/customers/:customerId/users/bulk', () => {
  test('updates multiple users successfully (200)', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { userId: USER_A_ID, roles: ['CUSTOMER_ADMIN'] },
          { userId: USER_B_ID, roles: ['USER', 'CUSTOMER_ADMIN'] },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.summary.total).toBe(2)
    expect(res.body.data.summary.succeeded).toBe(2)
    expect(res.body.data.summary.failed).toBe(0)
    expect(res.body.data.results[0].status).toBe('updated')
    expect(res.body.data.results[1].status).toBe('updated')
  })

  test('reports user not found as per-item failure', async () => {
    const token = await getCustomerAdminToken()
    const NONEXISTENT = '507f1f77bcf86cd799439099'

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { userId: USER_A_ID, roles: ['CUSTOMER_ADMIN'] },
          { userId: NONEXISTENT, roles: ['USER'] },
        ],
      })

    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[1].error).toContain('not found')
  })

  test('reports user from different customer as per-item failure', async () => {
    const token = await getCustomerAdminToken()

    const foreignUser = makeUserA({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === USER_A_ID) return Promise.resolve(foreignUser)
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [{ userId: USER_A_ID, roles: ['CUSTOMER_ADMIN'] }],
      })

    expect(res.status).toBe(422)
    expect(res.body.data.results[0].error).toContain('does not belong')
  })

  test('updates tenant visibility successfully', async () => {
    const token = await getCustomerAdminToken()

    // Tenant.find returns valid tenant
    Tenant.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: TENANT_ID }]),
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { userId: USER_A_ID, tenantVisibility: [TENANT_ID] },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].status).toBe('updated')
  })

  test('reports invalid tenant IDs as per-item failure', async () => {
    const token = await getCustomerAdminToken()
    const INVALID_TENANT_ID = '707f1f77bcf86cd799439099'

    Tenant.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { userId: USER_A_ID, tenantVisibility: [INVALID_TENANT_ID] },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.data.results[0].error).toContain('invalid or do not belong')
    expect(res.body.data.results[0].errorCode).toBe('VALIDATION_FAILED')
    expect(res.body.data.results[0].errorDetails?.reason).toBe('TENANT_VISIBILITY_INVALID_TENANT_IDS')
    expect(res.body.data.results[0].errorDetails?.invalidTenantIds).toEqual([INVALID_TENANT_ID])
  })

  test('rejects tenant visibility entries for single-tenant customers during bulk update', async () => {
    const token = await getCustomerAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE' }),
    )

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/users/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        users: [
          { userId: USER_A_ID, tenantVisibility: [TENANT_ID] },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.data.summary.succeeded).toBe(0)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[0].errorCode).toBe('VALIDATION_FAILED')
    expect(res.body.data.results[0].errorDetails?.reason).toBe('TENANT_VISIBILITY_NOT_ALLOWED')
    expect(res.body.data.results[0].errorDetails?.tenantVisibilityMode).toBe('DISALLOWED')
  })
})

/* ================================================================== */
/*  BULK DISABLE USERS                                                */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/users/bulk-disable', () => {
  test('disables multiple users successfully (200)', async () => {
    const token = await getCustomerAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [USER_A_ID, USER_B_ID] })

    expect(res.status).toBe(200)
    expect(res.body.data.summary.total).toBe(2)
    expect(res.body.data.summary.succeeded).toBe(2)
    expect(res.body.data.summary.failed).toBe(0)
    expect(res.body.data.results[0].status).toBe('disabled')
    expect(res.body.data.results[1].status).toBe('disabled')
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('reports user not found as per-item failure', async () => {
    const token = await getCustomerAdminToken()
    const NONEXISTENT = '507f1f77bcf86cd799439099'

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [USER_A_ID, NONEXISTENT] })

    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[1].error).toContain('not found')
  })

  test('reports user from different customer as per-item failure', async () => {
    const token = await getCustomerAdminToken()

    const foreignUser = makeUserA({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === USER_A_ID) return Promise.resolve(foreignUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [USER_A_ID] })

    expect(res.status).toBe(422)
    expect(res.body.data.results[0].error).toContain('does not belong')
  })

  test('reports already disabled users as per-item failure', async () => {
    const token = await getCustomerAdminToken()

    const disabledUser = makeUserA({ isActive: false })
    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === USER_A_ID) return Promise.resolve(disabledUser)
      if (id === USER_B_ID) return Promise.resolve(makeUserB())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [USER_A_ID, USER_B_ID] })

    expect(res.status).toBe(207)
    expect(res.body.data.summary.succeeded).toBe(1)
    expect(res.body.data.summary.failed).toBe(1)
    expect(res.body.data.results[0].error).toContain('already disabled')
    expect(res.body.data.results[1].status).toBe('disabled')
  })

  test('returns 422 when all users fail', async () => {
    const token = await getCustomerAdminToken()
    const NONEXISTENT_1 = '507f1f77bcf86cd799439098'
    const NONEXISTENT_2 = '507f1f77bcf86cd799439099'

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [NONEXISTENT_1, NONEXISTENT_2] })

    expect(res.status).toBe(422)
    expect(res.body.data.summary.succeeded).toBe(0)
    expect(res.body.data.summary.failed).toBe(2)
  })

  test('returns 404 when customer does not exist', async () => {
    const token = await getCustomerAdminToken()
    Customer.findById.mockResolvedValue(null)

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/users/bulk-disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userIds: [USER_A_ID] })

    expect(res.status).toBe(404)
  })
})
