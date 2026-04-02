/**
 * Customer & Tenant Management Tests
 *
 * Integration-style tests for Phase 3.1 endpoints:
 *
 *   Provisioning Service:
 *     - createCustomerWithDefaults (SINGLE_TENANT, MULTI_TENANT)
 *     - createTenantWithDefaults (with/without auto-VMF)
 *
 *   Customer Routes (SUPER_ADMIN):
 *     - GET    /api/v1/customers
 *     - POST   /api/v1/customers
 *     - GET    /api/v1/customers/:customerId
 *     - PATCH  /api/v1/customers/:customerId
 *     - PATCH  /api/v1/customers/:customerId/status
 *     - POST   /api/v1/customers/:customerId/admin-invitations
 *     - POST   /api/v1/customers/:customerId/admins
 *
 *   Tenant Routes:
 *     - GET    /api/v1/customers/:customerId/tenants
 *     - POST   /api/v1/customers/:customerId/tenants
 *     - PATCH  /api/v1/tenants/:tenantId
 *     - POST   /api/v1/tenants/:tenantId/enable
 *     - POST   /api/v1/tenants/:tenantId/disable
 *
 *   Validators:
 *     - Customer create / update / status / assignAdmin
 *     - Tenant create / update
 *
 * All Mongoose model statics are monkey-patched; no real database required.
 */

import mongoose from 'mongoose'
import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'

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
  process.env.TENANT_RATE_LIMIT = '10000'
  process.env.USER_MGMT_RATE_LIMIT = '10000'
})

/* ------------------------------------------------------------------ */
/*  Ids                                                               */
/* ------------------------------------------------------------------ */

const USER_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const TENANT_ADMIN_ID = '507f1f77bcf86cd799439013'
const TENANT_MEMBER_ID = '507f1f77bcf86cd799439014'
const USER_ID_2 = '507f1f77bcf86cd799439099'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const OTHER_CUSTOMER_ID = '607f1f77bcf86cd799439088'
const TENANT_ID = '707f1f77bcf86cd799439033'
const TENANT_ID_2 = '707f1f77bcf86cd799439044'
const VMF_ID = '807f1f77bcf86cd799439055'
const LICENSE_LEVEL_ID = '907f1f77bcf86cd799439066'
const INVITATION_ID = 'a07f1f77bcf86cd7994390aa'

/* ------------------------------------------------------------------ */
/*  Factories                                                         */
/* ------------------------------------------------------------------ */

const makeFakeUser = (overrides = {}) => ({
  _id: USER_ID,
  id: USER_ID,
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  comparePassword: jest.fn(async () => true),
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

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  website: null,
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  defaultTenantId: null,
  isServiceProvider: false,
  licenseLevelId: null,
  governance: {
    maxTenants: 1,
    maxVmfsPerTenant: 1,
    customerAdminUserId: null,
  },
  status: 'ACTIVE',
  entitlements: [],
  billing: { planCode: 'PRO', cycle: 'MONTHLY' },
  trial: { isTrial: false },
  createdBy: USER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  toJSON: function () {
    return {
      id: this._id,
      name: this.name,
      website: this.website,
      topology: this.topology,
      vmfPolicy: this.vmfPolicy,
      defaultTenantId: this.defaultTenantId,
      isServiceProvider: this.isServiceProvider,
      licenseLevelId: this.licenseLevelId,
      governance: this.governance,
      status: this.status,
      entitlements: this.entitlements,
      billing: this.billing,
      trial: this.trial,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeFakeTenant = (overrides = {}) => ({
  _id: TENANT_ID,
  id: TENANT_ID,
  customerId: CUSTOMER_ID,
  name: 'Tenant One',
  website: 'https://tenant1.example',
  status: 'ENABLED',
  isDefault: false,
  tenantAdminUserIds: [USER_ID],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  toJSON: function () {
    return {
      id: this._id,
      customerId: this.customerId,
      name: this.name,
      website: this.website,
      status: this.status,
      isDefault: this.isDefault,
      tenantAdminUserIds: this.tenantAdminUserIds,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeFakeInvitation = (overrides = {}) => ({
  _id: INVITATION_ID,
  id: INVITATION_ID,
  recipientEmail: 'new.admin@acme.example',
  recipientName: 'New Admin',
  company: { name: 'Acme Corp' },
  status: 'created',
  expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)),
  provisionedCustomerId: CUSTOMER_ID,
  provisionedUserId: USER_ID_2,
  assignCustomerAdminOnComplete: true,
  isExpired: jest.fn(() => false),
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      recipientEmail: this.recipientEmail,
      recipientName: this.recipientName,
      company: this.company,
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

let app, request, tokenService, validateTenantAdminAssignments, ensureTenantAdminCustomerRole
let User, Customer, Tenant, VMF, AuditLog, Invitation, LicenseLevel, Role
let startSessionSpy

const buildRoleQueryChain = (rows) => {
  const chain = {
    lean: jest.fn().mockResolvedValue(rows),
  }
  chain.select = jest.fn().mockReturnValue(chain)
  chain.sort = jest.fn().mockReturnValue(chain)
  chain.skip = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  return chain
}

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
    key: 'CUSTOMER_ADMIN',
    scope: 'CUSTOMER',
    permissions: [
      'CUSTOMER_VIEW',
      'USER_CREATE',
      'USER_UPDATE',
      'USER_DELETE',
      'USER_VIEW',
      'TENANT_CREATE',
      'TENANT_UPDATE',
      'TENANT_VIEW',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'AUDIT_VIEW_CUSTOMER',
    ],
    isActive: true,
  },
  {
    key: 'TENANT_ADMIN',
    scope: 'TENANT',
    permissions: [
      'TENANT_VIEW',
      'TENANT_UPDATE',
      'USER_VIEW_TENANT',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'DEAL_CREATE',
      'DEAL_UPDATE',
      'DEAL_DELETE',
      'DEAL_VIEW',
    ],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_CREATE', 'DEAL_UPDATE', 'DEAL_VIEW'],
    isActive: true,
  },
])

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn(async () => {}),
})

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  ;({ validateTenantAdminAssignments } = await import('../services/tenantManagementContractService.js'))
  ;({ ensureTenantAdminCustomerRole } = await import('../services/tenantAdminRoleCouplingService.js'))
  request = supertest(app)
  startSessionSpy = jest.spyOn(mongoose, 'startSession')

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  AuditLog = models.AuditLog
  Invitation = models.Invitation
  LicenseLevel = models.LicenseLevel
  Role = models.Role
})

afterAll(() => {
  startSessionSpy?.mockRestore()
})

/* ------------------------------------------------------------------ */
/*  Auth helper                                                       */
/* ------------------------------------------------------------------ */

let superAdminToken, customerAdminToken, tenantAdminToken

const getSuperAdminToken = async () => {
  if (superAdminToken) return superAdminToken
  const user = makeFakeUser()
  const tokens = await tokenService.generateTokens(user)
  superAdminToken = tokens.accessToken
  return superAdminToken
}

const getCustomerAdminToken = async () => {
  if (customerAdminToken) return customerAdminToken
  const user = makeFakeUser({
    _id: CUSTOMER_ADMIN_ID,
    id: CUSTOMER_ADMIN_ID,
    email: 'custadmin@acme.com',
    name: 'Customer Admin',
    memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
  })
  const tokens = await tokenService.generateTokens(user)
  customerAdminToken = tokens.accessToken
  return customerAdminToken
}

const getTenantAdminToken = async () => {
  if (tenantAdminToken) return tenantAdminToken
  const user = makeFakeUser({
    _id: TENANT_ADMIN_ID,
    id: TENANT_ADMIN_ID,
    email: 'tenantadmin@acme.com',
    name: 'Tenant Admin',
    memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
    tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
  })
  const tokens = await tokenService.generateTokens(user)
  tenantAdminToken = tokens.accessToken
  return tenantAdminToken
}

const getNonAdminToken = async () => {
  const user = makeFakeUser({
    _id: USER_ID_2,
    id: USER_ID_2,
    email: 'user@example.com',
    name: 'Regular User',
    memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  })
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const getTenantMemberToken = async () => {
  const user = makeFakeUser({
    _id: TENANT_MEMBER_ID,
    id: TENANT_MEMBER_ID,
    email: 'gus.g@acme.com',
    name: 'Gus G',
    memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
  })
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const mockLicenseLevelLookup = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  LicenseLevel.findById.mockReturnValue({ select })
  return select
}

/* ------------------------------------------------------------------ */
/*  Reset stubs before each test                                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  startSessionSpy.mockResolvedValue(buildSession())
  User.findById = jest.fn()
  User.findOne = jest.fn()
  User.findByEmail = jest.fn()
  Customer.findById = jest.fn()
  Customer.findOne = jest.fn()
  Customer.find = jest.fn()
  Customer.countDocuments = jest.fn()
  Tenant.findById = jest.fn()
  Tenant.find = jest.fn()
  Tenant.countDocuments = jest.fn()
  VMF.findById = jest.fn()
  VMF.countByTenant = jest.fn()
  Invitation.findOne = jest.fn().mockResolvedValue(null)
  Invitation.create = jest.fn()
  Invitation.generateToken = jest.fn(() => ({ raw: 'raw-token', hash: 'hash-token' }))
  LicenseLevel.findById = jest.fn()
  Role.find = jest.fn().mockImplementation(() => buildRoleQueryChain(buildDefaultRoleRows()))
  AuditLog.createLog = jest.fn(async () => ({}))

  Tenant.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  User.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  User.find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })

  User.findOne.mockResolvedValue(null)
  Customer.findOne.mockResolvedValue(null)

  // Default: loadScopes finds a SUPER_ADMIN user
  User.findById.mockImplementation((id) => {
    if (id === USER_ID || id === superAdminToken) {
      return Promise.resolve(makeFakeUser())
    }
    if (id === TENANT_ADMIN_ID || id === tenantAdminToken) {
      return Promise.resolve(
        makeFakeUser({
          _id: TENANT_ADMIN_ID,
          id: TENANT_ADMIN_ID,
          email: 'tenantadmin@acme.com',
          name: 'Tenant Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
          tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        }),
      )
    }
    if (id === TENANT_MEMBER_ID) {
      return Promise.resolve(
        makeFakeUser({
          _id: TENANT_MEMBER_ID,
          id: TENANT_MEMBER_ID,
          email: 'gus.g@acme.com',
          name: 'Gus G',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        }),
      )
    }
    if (id === USER_ID_2) {
      return Promise.resolve(
        makeFakeUser({
          _id: USER_ID_2,
          id: USER_ID_2,
          memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        }),
      )
    }
    return Promise.resolve(null)
  })
})

/* ================================================================== */
/*  CUSTOMER VALIDATOR TESTS                                          */
/* ================================================================== */

describe('Customer Validators', () => {
  describe('POST /api/v1/customers — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when topology is invalid', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'INVALID',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('topology')
    })

    test('returns 422 when topology/vmfPolicy mismatch', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'PER_TENANT_SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('vmfPolicy')
    })

    test('returns 422 when billing is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when trial.isTrial=true but no endsAt', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
          trial: { isTrial: true },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when governance.maxTenants is less than 1', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Governance Corp',
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_MULTI',
          billing: { planCode: 'FREE' },
          governance: { maxTenants: 0, maxVmfsPerTenant: 1 },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details['governance.maxTenants']).toBeDefined()
    })
  })

  describe('PATCH /api/v1/customers/:customerId — validation', () => {
    test('returns 422 when name is empty string', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /api/v1/customers/:customerId/status — validation', () => {
    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'BOGUS' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('status')
    })

    test('accepts INACTIVE as a valid status payload', async () => {
      const token = await getSuperAdminToken()
      const customer = makeFakeCustomer({ status: 'ACTIVE' })
      Customer.findById.mockResolvedValue(customer)

      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'INACTIVE' })

      expect(res.status).toBe(200)
      expect(customer.status).toBe('DISABLED')
    })
  })

  describe('POST /api/v1/customers/:customerId/admins — validation', () => {
    test('returns 422 when userId is not a valid ObjectId', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: 'not-an-objectid' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('userId')
    })

    test('returns 422 when neither userId nor recipientEmail is provided', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('userId')
      expect(res.body.error.details).toHaveProperty('recipientEmail')
    })

    test('returns 422 when recipientEmail is provided without recipientName', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recipientEmail: 'new.admin@acme.example' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('recipientName')
    })

    test('accepts recipientEmail without recipientName when userId is provided', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())
      User.findById.mockImplementation((id) => {
        if (id === USER_ID) return Promise.resolve(makeFakeUser())
        if (id === USER_ID_2) {
          return Promise.resolve(
            makeFakeUser({
              _id: USER_ID_2,
              id: USER_ID_2,
              email: 'new.admin@acme.example',
              name: 'New Admin',
              memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
            }),
          )
        }
        return Promise.resolve(null)
      })

      Invitation.findOne.mockResolvedValue(null)
      Invitation.create.mockResolvedValue(makeFakeInvitation())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: USER_ID_2, recipientEmail: 'new.admin@acme.example' })

      expect(res.status).toBe(200)
      expect(res.body.data.userId).toBe(USER_ID_2)
      expect(res.body.data.invitation.outcome).toBe('created')
    })
  })

  describe('POST /api/v1/customers/:customerId/admin-invitations — validation', () => {
    test('returns 422 when recipientEmail is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recipientName: 'New Admin' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('recipientEmail')
    })

    test('returns 422 when recipientName is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recipientEmail: 'new.admin@acme.example' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('recipientName')
    })
  })
})

/* ================================================================== */
/*  TENANT VALIDATOR TESTS                                            */
/* ================================================================== */

describe('Tenant Validators', () => {
  describe('POST /api/v1/customers/:customerId/tenants — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      // requireCustomerAccess needs Customer.findById
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          website: 'https://t.example',
          tenantAdminUserIds: [USER_ID],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when website is not a URL', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tenant 2',
          website: 'not-a-url',
          tenantAdminUserIds: [USER_ID],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('website')
    })

    test('returns 422 when tenantAdminUserIds is empty', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tenant 2',
          website: 'https://t.example',
          tenantAdminUserIds: [],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when more than one tenant admin is supplied', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tenant 2',
          website: 'https://t.example',
          tenantAdminUserIds: [USER_ID, USER_ID_2],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details?.tenantAdminUserIds).toBe('Only one tenant admin is allowed')
    })
  })
})

describe('validateTenantAdminAssignments', () => {
  test('returns a limit-exceeded validation payload when more than one tenant admin is supplied', async () => {
    const findUsers = jest.fn()

    const validation = await validateTenantAdminAssignments({
      customerId: CUSTOMER_ID,
      tenantAdminUserIds: [USER_ID, USER_ID_2],
      findUsers,
    })

    expect(validation).toEqual({
      reason: 'TENANT_ADMIN_LIMIT_EXCEEDED',
      message: 'Only one tenant admin is allowed.',
      invalidTenantAdminUserIds: [USER_ID, USER_ID_2],
      tooManyTenantAdminUserIds: [USER_ID, USER_ID_2],
      missingTenantAdminUserIds: [],
      inactiveTenantAdminUserIds: [],
      outOfCustomerTenantAdminUserIds: [],
    })
    expect(findUsers).not.toHaveBeenCalled()
  })
})

describe('ensureTenantAdminCustomerRole', () => {
  test('adds TENANT_ADMIN to the existing customer membership when missing', () => {
    const user = makeFakeUser({
      _id: USER_ID,
      id: USER_ID,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    const result = ensureTenantAdminCustomerRole({ user, customerId: CUSTOMER_ID })

    expect(result).toEqual({
      changed: true,
      previousRoles: ['USER'],
      nextRoles: ['USER', 'TENANT_ADMIN'],
    })
    expect(user.memberships[0].roles).toEqual(['USER', 'TENANT_ADMIN'])
  })

  test('is a no-op when TENANT_ADMIN is already present', () => {
    const user = makeFakeUser({
      _id: USER_ID,
      id: USER_ID,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER', 'TENANT_ADMIN'] }],
    })

    const result = ensureTenantAdminCustomerRole({ user, customerId: CUSTOMER_ID })

    expect(result).toEqual({
      changed: false,
      previousRoles: ['USER', 'TENANT_ADMIN'],
      nextRoles: ['USER', 'TENANT_ADMIN'],
    })
    expect(user.memberships[0].roles).toEqual(['USER', 'TENANT_ADMIN'])
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('Authorization guards', () => {
  test('customer routes return 401 without auth token', async () => {
    const res = await request.get('/api/v1/customers')
    expect(res.status).toBe(401)
  })

  test('customer routes return 403 for non-SUPER_ADMIN', async () => {
    const token = await getNonAdminToken()
    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('customer admin-invitation route returns 401 without auth token', async () => {
    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
      .send({
        recipientEmail: 'new.admin@acme.example',
        recipientName: 'New Admin',
      })
    expect(res.status).toBe(401)
  })

  test('customer admin-invitation route returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getNonAdminToken()
    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: 'new.admin@acme.example',
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(403)
  })

  test('tenant CRUD routes return 401 without auth token', async () => {
    const res = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
    expect(res.status).toBe(401)
  })

  test('tenant admin routes return 401 without auth token', async () => {
    const res = await request.patch(`/api/v1/tenants/${TENANT_ID}`)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/super-admin/invitations (legacy create)', () => {
  test('returns 401 without auth token', async () => {
    const res = await request
      .post('/api/v1/super-admin/invitations')
      .send({})

    expect(res.status).toBe(401)
  })

  test('returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getNonAdminToken()
    const res = await request
      .post('/api/v1/super-admin/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(403)
  })

  test('returns 410 deprecation response for SUPER_ADMIN', async () => {
    const token = await getSuperAdminToken()
    const res = await request
      .post('/api/v1/super-admin/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('LEGACY_INVITATION_CREATE_DEPRECATED')
    expect(res.body.error.details?.replacementEndpoint).toBe(
      '/api/v1/customers/:customerId/admin-invitations',
    )
    expect(res.body.error.requestId).toBeDefined()
    expect(Invitation.create).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  CUSTOMER CRUD                                                     */
/* ================================================================== */

describe('GET /api/v1/customers', () => {
  test('returns paginated customer list', async () => {
    const token = await getSuperAdminToken()
    const customers = [makeFakeCustomer()]

    Customer.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(customers),
          }),
        }),
      }),
    })
    Customer.countDocuments.mockResolvedValue(1)

    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('supports status filter', async () => {
    const token = await getSuperAdminToken()

    Customer.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    Customer.countDocuments.mockResolvedValue(0)

    const res = await request
      .get('/api/v1/customers?status=DISABLED')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Customer.find).toHaveBeenCalled()
  })
})

describe('POST /api/v1/customers', () => {
  test('returns 409 when customer name already exists (case-insensitive)', async () => {
    const token = await getSuperAdminToken()
    Customer.findOne.mockResolvedValue(makeFakeCustomer({ name: 'Acme Corp' }))

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '  ACME CORP  ',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toContain('already exists')
    expect(Customer.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ nameNormalized: 'acme corp' }),
        ]),
      }),
    )
  })

  test('creates a multi-tenant customer successfully', async () => {
    const token = await getSuperAdminToken()

    // The provisioningService calls `new Customer()` then `.save()`.
    // We need to mock the Customer constructor. Since we can't easily mock
    // Mongoose constructors, we'll mock .save() on the prototype.
    const savedCustomer = makeFakeCustomer()
    const origPrototypeSave = Customer.prototype.save
    Customer.prototype.save = jest.fn(async function () {
      Object.assign(this, savedCustomer)
      this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
      return this
    })

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Corp',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer).toBeDefined()
    expect(res.body.data.customer.name).toBe('Acme Corp')
    // Multi-tenant: no auto-tenant
    expect(res.body.data.tenant).toBeUndefined()

    Customer.prototype.save = origPrototypeSave
  })

  test('creates a customer with optional website', async () => {
    const token = await getSuperAdminToken()

    const savedCustomer = makeFakeCustomer({
      name: 'Acme Corp',
      website: 'https://acme.example',
    })
    const origPrototypeSave = Customer.prototype.save
    Customer.prototype.save = jest.fn(async function () {
      Object.assign(this, savedCustomer)
      this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
      return this
    })

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Corp',
        website: 'https://acme.example',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer.website).toBe('https://acme.example')

    Customer.prototype.save = origPrototypeSave
  })

  test('creates a single-tenant customer with default tenant + VMF', async () => {
    const token = await getSuperAdminToken()

    const savedCustomer = makeFakeCustomer({
      topology: 'SINGLE_TENANT',
      vmfPolicy: 'SINGLE',
      defaultTenantId: TENANT_ID,
    })
    const savedTenant = makeFakeTenant({ isDefault: true })
    const savedVmf = {
      _id: VMF_ID,
      name: 'VMF 1',
      status: 'ACTIVE',
      toJSON: function () {
        return { id: this._id, name: this.name, status: this.status }
      },
    }

    // Track save calls by model type
    let saveCallIndex = 0
    const saveMocks = [
      // 1st save: Tenant (default)
      async function () {
        Object.assign(this, savedTenant)
        this.toJSON = savedTenant.toJSON.bind(savedTenant)
        return this
      },
      // 2nd save: Customer
      async function () {
        Object.assign(this, savedCustomer)
        this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
        return this
      },
      // 3rd save: VMF
      async function () {
        Object.assign(this, savedVmf)
        this.toJSON = savedVmf.toJSON.bind(savedVmf)
        return this
      },
    ]

    const origCustomerSave = Customer.prototype.save
    const origTenantSave = Tenant.prototype.save
    const origVmfSave = VMF.prototype.save

    Customer.prototype.save = jest.fn(async function () {
      const fn = saveMocks[saveCallIndex++]
      if (fn) await fn.call(this)
      return this
    })
    Tenant.prototype.save = Customer.prototype.save
    VMF.prototype.save = Customer.prototype.save

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Solo Corp',
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
        billing: { planCode: 'FREE' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer).toBeDefined()
    expect(res.body.data.tenant).toBeDefined()
    expect(res.body.data.vmf).toBeDefined()

    Customer.prototype.save = origCustomerSave
    Tenant.prototype.save = origTenantSave
    VMF.prototype.save = origVmfSave
  })

  test('returns 422 when licenseLevelId does not exist', async () => {
    const token = await getSuperAdminToken()
    mockLicenseLevelLookup(null)

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Corp',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
        licenseLevelId: LICENSE_LEVEL_ID,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toContain('licenseLevelId')
  })

  test('creates customer with governance and licenseLevelId', async () => {
    const token = await getSuperAdminToken()
    mockLicenseLevelLookup({ _id: LICENSE_LEVEL_ID })

    const savedCustomer = makeFakeCustomer({
      licenseLevelId: LICENSE_LEVEL_ID,
      governance: {
        maxTenants: 5,
        maxVmfsPerTenant: 3,
        customerAdminUserId: USER_ID_2,
      },
    })
    const origPrototypeSave = Customer.prototype.save
    Customer.prototype.save = jest.fn(async function () {
      Object.assign(this, savedCustomer)
      this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
      return this
    })

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Governed Corp',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
        licenseLevelId: LICENSE_LEVEL_ID,
        governance: {
          maxTenants: 5,
          maxVmfsPerTenant: 3,
          customerAdminUserId: USER_ID_2,
        },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer.licenseLevelId).toBe(LICENSE_LEVEL_ID)
    expect(res.body.data.customer.governance).toEqual({
      maxTenants: 5,
      maxVmfsPerTenant: 3,
      customerAdminUserId: USER_ID_2,
    })

    Customer.prototype.save = origPrototypeSave
  })
})

describe('GET /api/v1/customers/:customerId', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns customer on success', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(CUSTOMER_ID)
    expect(res.body.data.name).toBe('Acme Corp')
  })
})

describe('PATCH /api/v1/customers/:customerId', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })

    expect(res.status).toBe(404)
  })

  test('updates customer name', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Corp' })

    expect(res.status).toBe(200)
    expect(customer.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates customer website', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ website: 'https://updated-company.example' })

    expect(res.status).toBe(200)
    expect(customer.website).toBe('https://updated-company.example')
    expect(customer.save).toHaveBeenCalled()
  })

  test('returns 409 when renaming to an existing customer name (case-insensitive)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({ _id: CUSTOMER_ID, id: CUSTOMER_ID, name: 'Current Corp' })
    Customer.findById.mockResolvedValue(customer)
    Customer.findOne.mockResolvedValue(
      makeFakeCustomer({ _id: '607f1f77bcf86cd799439088', id: '607f1f77bcf86cd799439088', name: 'Acme Corp' }),
    )

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  ACME corp  ' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toContain('already exists')
    expect(customer.save).not.toHaveBeenCalled()
    expect(Customer.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $ne: CUSTOMER_ID },
        $or: expect.arrayContaining([
          expect.objectContaining({ nameNormalized: 'acme corp' }),
        ]),
      }),
    )
  })

  test('updates governance and licenseLevelId', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)
    mockLicenseLevelLookup({ _id: LICENSE_LEVEL_ID })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        licenseLevelId: LICENSE_LEVEL_ID,
        governance: {
          maxTenants: 7,
          maxVmfsPerTenant: 4,
        },
      })

    expect(res.status).toBe(200)
    expect(customer.licenseLevelId).toBe(LICENSE_LEVEL_ID)
    expect(customer.governance).toEqual({
      maxTenants: 7,
      maxVmfsPerTenant: 4,
      customerAdminUserId: null,
    })
    expect(customer.save).toHaveBeenCalled()
  })

  test('returns 422 when patching governance.customerAdminUserId directly', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        governance: {
          customerAdminUserId: USER_ID_2,
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('partially updates governance while preserving unspecified fields', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({
      governance: {
        maxTenants: 5,
        maxVmfsPerTenant: 3,
        customerAdminUserId: USER_ID,
      },
    })
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        governance: {
          maxTenants: 8,
        },
      })

    expect(res.status).toBe(200)
    expect(customer.governance).toEqual({
      maxTenants: 8,
      maxVmfsPerTenant: 3,
      customerAdminUserId: USER_ID,
    })
  })

  test('returns 422 when updating licenseLevelId to a non-existent record', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)
    mockLicenseLevelLookup(null)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ licenseLevelId: LICENSE_LEVEL_ID })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('PATCH /api/v1/customers/:customerId/status', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(404)
  })

  test('updates customer status to DISABLED', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(200)
    expect(customer.status).toBe('DISABLED')
    expect(customer.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('maps INACTIVE to DISABLED', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' })

    expect(res.status).toBe(200)
    expect(customer.status).toBe('DISABLED')
  })

  test('updates customer status to ARCHIVED', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })

    expect(res.status).toBe(200)
    expect(customer.status).toBe('ARCHIVED')
  })
})

describe('POST /api/v1/customers/:customerId/admins', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    // Override findById to only return SUPER_ADMIN for loadScopes,
    // then null for the target user
    let callCount = 0
    User.findById.mockImplementation((id) => {
      callCount++
      // First call = loadScopes (SUPER_ADMIN), subsequent = target user lookup
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(404)
  })

  test('returns 422 when user is disabled', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(makeFakeUser({ _id: USER_ID_2, isActive: false }))
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('returns 409 when another canonical admin already exists', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        governance: {
          maxTenants: 1,
          maxVmfsPerTenant: 1,
          customerAdminUserId: USER_ID,
        },
      }),
    )

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      if (id === USER_ID_2) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details?.reason).toBe('CANONICAL_ADMIN_EXISTS')
    expect(res.body.error.message).toContain('replace')
  })

  test('assigns CUSTOMER_ADMIN to user with no existing membership', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [],
    })
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(targetUser)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('Admin role assigned')
    expect(targetUser.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('adds CUSTOMER_ADMIN role to existing membership', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(targetUser)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(200)
    expect(targetUser.memberships[0].roles).toContain('CUSTOMER_ADMIN')
  })

  test('assigns admin via recipientEmail and returns invitation creation outcome', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      email: 'new.admin@acme.example',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    User.findOne.mockImplementation((query) => {
      if (query?.email) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const createdInvitation = makeFakeInvitation({
      recipientEmail: targetUser.email,
      recipientName: 'New Admin',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: USER_ID_2,
    })
    Invitation.findOne.mockResolvedValue(null)
    Invitation.create.mockResolvedValue(createdInvitation)
    Invitation.generateToken.mockReturnValue({ raw: 'raw-token', hash: 'hash-token' })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: targetUser.email,
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.userId).toBe(USER_ID_2)
    expect(res.body.data.invitation).toBeDefined()
    expect(res.body.data.invitation.outcome).toBe('created')
    expect(res.body.data.invitation.visibility).toBe('immediate')
    expect(Invitation.create).toHaveBeenCalled()
  })

  test('seeds the shared manual-test password when assigning a customer admin by any email in fake-auth UAT mode', async () => {
    const token = await getSuperAdminToken()
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    const previousPassword = env.manualTestPasswordBootstrapPassword
    env.fakeAuthAllowed = true
    env.manualTestPasswordBootstrapPassword = 'Vmf!Test123'

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findOne.mockImplementation((query) => {
      if (query?.email) return Promise.resolve(null)
      return Promise.resolve(null)
    })

    const createdInvitation = makeFakeInvitation({
      recipientEmail: 'custom.admin@demo.example',
      recipientName: 'Custom Admin',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: USER_ID_2,
    })
    Invitation.findOne.mockResolvedValue(null)
    Invitation.create.mockResolvedValue(createdInvitation)
    Invitation.generateToken.mockReturnValue({ raw: 'raw-token', hash: 'hash-token' })

    const originalSave = User.prototype.save
    const savedUsers = []
    User.prototype.save = jest.fn(async function () {
      this._id = this._id || USER_ID_2
      this.id = this.id || USER_ID_2
      savedUsers.push(this)
      return this
    })

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          recipientEmail: 'custom.admin@demo.example',
          recipientName: 'Custom Admin',
        })

      expect(res.status).toBe(200)
      expect(savedUsers[0]).toBeDefined()
      await expect(savedUsers[0].comparePassword('Vmf!Test123')).resolves.toBe(true)
    } finally {
      User.prototype.save = originalSave
      env.fakeAuthAllowed = previousFakeAuthAllowed
      env.manualTestPasswordBootstrapPassword = previousPassword
    }
  })

  test('links existing active invitation during recipientEmail assign flow', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      email: 'new.admin@acme.example',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    User.findOne.mockImplementation((query) => {
      if (query?.email) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const existingInvitation = makeFakeInvitation({
      _id: 'b07f1f77bcf86cd7994390bb',
      id: 'b07f1f77bcf86cd7994390bb',
      status: 'sent',
      provisionedCustomerId: null,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findOne.mockResolvedValue(existingInvitation)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: targetUser.email,
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.invitation).toBeDefined()
    expect(res.body.data.invitation.outcome).toBe('linked_existing')
    expect(res.body.data.invitation.invitationId).toBe('b07f1f77bcf86cd7994390bb')
    expect(existingInvitation.save).toHaveBeenCalled()
    expect(Invitation.create).not.toHaveBeenCalled()
  })

  test('returns 409 when active invitation is linked to another customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      email: 'new.admin@acme.example',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.findOne.mockImplementation((query) => {
      if (query?.email) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const conflictingInvitation = makeFakeInvitation({
      _id: 'c07f1f77bcf86cd7994390cc',
      id: 'c07f1f77bcf86cd7994390cc',
      status: 'sent',
      provisionedCustomerId: OTHER_CUSTOMER_ID,
      provisionedUserId: USER_ID_2,
      isExpired: jest.fn(() => false),
    })
    Invitation.findOne.mockResolvedValue(conflictingInvitation)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: targetUser.email,
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVITATION_ALREADY_ACTIVE')
    expect(targetUser.save).not.toHaveBeenCalled()
    expect(Invitation.create).not.toHaveBeenCalled()
  })

  test('returns 422 when provided recipientEmail does not match selected user', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      if (id === USER_ID_2) {
        return Promise.resolve(
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            email: 'selected.user@acme.example',
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        )
      }
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: USER_ID_2,
        recipientEmail: 'different.user@acme.example',
        recipientName: 'Different User',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toContain('recipientEmail must match')
  })

  test('recovers from duplicate email race when assigning via recipientEmail', async () => {
    const token = await getSuperAdminToken()

    let customerLoadCount = 0
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) {
        customerLoadCount += 1
        return Promise.resolve(makeFakeCustomer())
      }
      return Promise.resolve(null)
    })

    const raceEmail = 'race.admin@acme.example'
    const recoveredUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      email: raceEmail,
      name: 'Race Admin',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })

    let userLookupCount = 0
    User.findOne.mockImplementation((query) => {
      if (query?.email === raceEmail) {
        userLookupCount += 1
        return Promise.resolve(userLookupCount === 1 ? null : recoveredUser)
      }
      return Promise.resolve(null)
    })

    const duplicateErr = Object.assign(new Error('duplicate email'), {
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: raceEmail },
    })

    const originalUserPrototypeSave = User.prototype.save
    let userPrototypeSaveCalls = 0
    User.prototype.save = jest.fn(async function () {
      if (this.email === raceEmail && userPrototypeSaveCalls === 0) {
        userPrototypeSaveCalls += 1
        throw duplicateErr
      }
      userPrototypeSaveCalls += 1
      return this
    })

    try {
      Invitation.findOne.mockResolvedValue(null)
      Invitation.create.mockResolvedValue(
        makeFakeInvitation({
          recipientEmail: raceEmail,
          recipientName: 'Race Admin',
          provisionedUserId: USER_ID_2,
        }),
      )

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          recipientEmail: raceEmail,
          recipientName: 'Race Admin',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.userId).toBe(USER_ID_2)
      expect(res.body.data.userCreatedForAssignment).toBeUndefined()
      expect(userLookupCount).toBe(2)
      expect(customerLoadCount).toBeGreaterThanOrEqual(2)
    } finally {
      User.prototype.save = originalUserPrototypeSave
    }
  })
})

describe('POST /api/v1/customers/:customerId/admin-invitations', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: 'new.admin@acme.example',
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('creates customer-scoped invitation without assigning customer admin role', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({
      governance: {
        maxTenants: 1,
        maxVmfsPerTenant: 1,
        customerAdminUserId: USER_ID,
      },
    })
    Customer.findById.mockResolvedValue(customer)
    Invitation.findOne.mockResolvedValue(null)

    const createdInvitation = makeFakeInvitation({
      recipientEmail: 'new.admin@acme.example',
      recipientName: 'New Admin',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: null,
    })
    Invitation.create.mockResolvedValue(createdInvitation)
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          recipientEmail: 'new.admin@acme.example',
          recipientName: 'New Admin',
        })

      expect(res.status).toBe(201)
      expect(res.body.authLink).toContain('/api/v1/super-admin/invitations/auth/')
      expect(res.body.data.invitation).toBeDefined()
      expect(res.body.data.invitation.outcome).toBe('created')
      expect(res.body.data.invitation.visibility).toBe('immediate')
      expect(customer.save).not.toHaveBeenCalled()

      const createPayload = Invitation.create.mock.calls[0][0]
      expect(createPayload.provisionedCustomerId).toBe(CUSTOMER_ID)
      expect(createPayload.provisionedUserId).toBeUndefined()
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
    }
  })

  test('links existing active invitation to customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const existingInvitation = makeFakeInvitation({
      _id: 'd07f1f77bcf86cd7994390dd',
      id: 'd07f1f77bcf86cd7994390dd',
      status: 'sent',
      provisionedCustomerId: null,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findOne.mockResolvedValue(existingInvitation)
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          recipientEmail: 'new.admin@acme.example',
          recipientName: 'New Admin',
        })

      expect(res.status).toBe(200)
      expect(res.body.authLink).toContain('/api/v1/super-admin/invitations/auth/')
      expect(res.body.data.invitation.outcome).toBe('linked_existing')
      expect(res.body.data.invitation.invitationId).toBe('d07f1f77bcf86cd7994390dd')
      expect(existingInvitation.provisionedCustomerId).toBe(CUSTOMER_ID)
      expect(existingInvitation.status).toBe('sent')
      expect(existingInvitation.save).toHaveBeenCalled()
      expect(Invitation.create).not.toHaveBeenCalled()
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
    }
  })

  test('returns 202 when invitation is created but email dispatch fails', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Invitation.findOne.mockResolvedValue(null)

    const createdInvitation = makeFakeInvitation({
      recipientEmail: 'new.admin@acme.example',
      recipientName: 'New Admin',
      status: 'created',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: null,
    })
    Invitation.create.mockResolvedValue(createdInvitation)

    const emailService = (await import('../services/emailService.js')).default
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true
    const sendSpy = jest
      .spyOn(emailService, 'sendInvitationEmail')
      .mockRejectedValueOnce(new Error('smtp down'))

    try {
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          recipientEmail: 'new.admin@acme.example',
          recipientName: 'New Admin',
        })

      expect(res.status).toBe(202)
      expect(res.body.authLink).toContain('/api/v1/super-admin/invitations/auth/')
      expect(res.body.data.invitation.outcome).toBe('send_failed')
      expect(res.body.data.invitation.status).toBe('send_failed')
      expect(createdInvitation.status).toBe('send_failed')
      expect(createdInvitation.save).toHaveBeenCalled()
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
      sendSpy.mockRestore()
    }
  })

  test('returns 409 when active invitation is linked to another customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const conflictingInvitation = makeFakeInvitation({
      _id: 'e07f1f77bcf86cd7994390ee',
      id: 'e07f1f77bcf86cd7994390ee',
      status: 'sent',
      provisionedCustomerId: OTHER_CUSTOMER_ID,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findOne.mockResolvedValue(conflictingInvitation)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: 'new.admin@acme.example',
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVITATION_ALREADY_ACTIVE')
    expect(res.body.error.details.reason).toBe('other-customer')
    expect(Invitation.create).not.toHaveBeenCalled()
  })

  test('returns 409 when existing invitation is linked to a user but no customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const conflictingInvitation = makeFakeInvitation({
      _id: 'f07f1f77bcf86cd7994390ff',
      id: 'f07f1f77bcf86cd7994390ff',
      status: 'sent',
      provisionedCustomerId: null,
      provisionedUserId: USER_ID_2,
      isExpired: jest.fn(() => false),
    })
    Invitation.findOne.mockResolvedValue(conflictingInvitation)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admin-invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientEmail: 'new.admin@acme.example',
        recipientName: 'New Admin',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVITATION_ALREADY_ACTIVE')
    expect(res.body.error.details.reason).toBe('different-user')
    expect(res.body.error.message).toContain('another user')
    expect(Invitation.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/customers/:customerId/admins/replace', () => {
  test('returns 403 when step-up token is missing', async () => {
    const token = await getSuperAdminToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        newUserId: USER_ID_2,
        reason: 'Ownership transfer requested by platform operations.',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED')
    expect(res.body.error.requestId).toBeDefined()
  })
})

describe('POST /api/v1/fake-auth/invitations/:invitationId/complete', () => {
  test('auto-provisions and links a missing invitation user when customer context exists', async () => {
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    const invitation = makeFakeInvitation({
      status: 'accessed',
      recipientEmail: 'Missing.Admin@acme.example',
      recipientName: 'Missing Admin',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(invitation),
    })
    User.findOne.mockResolvedValue(null)

    const originalUserPrototypeSave = User.prototype.save
    User.prototype.save = jest.fn(async function () {
      return this
    })

    try {
      const res = await request
        .post(`/api/v1/fake-auth/invitations/${INVITATION_ID}/complete`)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.data.action).toBe('trusted')
      expect(String(invitation.provisionedUserId)).toBe(String(res.body.data.userId))
      expect(invitation.status).toBe('authenticated')
      expect(invitation.save).toHaveBeenCalled()
      expect(User.findOne).toHaveBeenCalledWith({ email: 'missing.admin@acme.example' })

      const provisionedUser = User.prototype.save.mock.instances[0]
      expect(provisionedUser.email).toBe('missing.admin@acme.example')
      expect(provisionedUser.memberships[0].roles).toContain('CUSTOMER_ADMIN')
      expect(String(provisionedUser.memberships[0].customerId)).toBe(CUSTOMER_ID)
    } finally {
      User.prototype.save = originalUserPrototypeSave
      env.fakeAuthAllowed = previousFakeAuthAllowed
    }
  })

  test('applies the shared manual-test password during fake-auth completion for any invited email', async () => {
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    const previousPassword = env.manualTestPasswordBootstrapPassword
    env.fakeAuthAllowed = true
    env.manualTestPasswordBootstrapPassword = 'Vmf!Test123'

    const invitation = makeFakeInvitation({
      status: 'accessed',
      recipientEmail: 'Who.Ever@demo.example',
      recipientName: 'Who Ever',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(invitation),
    })
    User.findOne.mockResolvedValue(null)

    const originalSave = User.prototype.save
    const savedUsers = []
    User.prototype.save = jest.fn(async function () {
      this._id = this._id || USER_ID_2
      this.id = this.id || USER_ID_2
      savedUsers.push(this)
      return this
    })

    try {
      const res = await request
        .post(`/api/v1/fake-auth/invitations/${INVITATION_ID}/complete`)
        .send({})

      expect(res.status).toBe(200)
      expect(savedUsers[0]).toBeDefined()
      expect(savedUsers[0].identityPlus.trustStatus).toBe('TRUSTED')
      await expect(savedUsers[0].comparePassword('Vmf!Test123')).resolves.toBe(true)
    } finally {
      User.prototype.save = originalSave
      env.fakeAuthAllowed = previousFakeAuthAllowed
      env.manualTestPasswordBootstrapPassword = previousPassword
    }
  })

  test('does not grant CUSTOMER_ADMIN when invitation completion is marked as non-admin', async () => {
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    const invitation = makeFakeInvitation({
      status: 'accessed',
      recipientEmail: 'member.user@acme.example',
      recipientName: 'Member User',
      provisionedCustomerId: CUSTOMER_ID,
      provisionedUserId: USER_ID,
      assignCustomerAdminOnComplete: false,
      isExpired: jest.fn(() => false),
    })

    const existingUser = makeFakeUser({
      _id: USER_ID,
      id: USER_ID_2,
      email: 'member.user@acme.example',
      identityPlus: {
        trustStatus: 'UNTRUSTED',
        externalId: null,
        invitedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
      setPassword: jest.fn(async function () { return this }),
    })

    Invitation.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(invitation),
    })
    User.findById = jest.fn().mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(existingUser)
      return Promise.resolve(null)
    })
    User.findOne.mockResolvedValue(existingUser)

    try {
      const res = await request
        .post(`/api/v1/fake-auth/invitations/${INVITATION_ID}/complete`)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.data.action).toBe('trusted')
      expect(existingUser.memberships[0].roles).toEqual(['USER'])
      expect(existingUser.memberships[0].roles).not.toContain('CUSTOMER_ADMIN')
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
    }
  })

  test('returns USER_NOT_FOUND when invitation has no customer link and no existing user', async () => {
    const env = (await import('../config/env.js')).default
    const previousFakeAuthAllowed = env.fakeAuthAllowed
    env.fakeAuthAllowed = true

    const invitation = makeFakeInvitation({
      status: 'accessed',
      recipientEmail: 'orphan@acme.example',
      provisionedCustomerId: null,
      provisionedUserId: null,
      isExpired: jest.fn(() => false),
    })
    Invitation.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(invitation),
    })
    User.findOne.mockResolvedValue(null)

    try {
      const res = await request
        .post(`/api/v1/fake-auth/invitations/${INVITATION_ID}/complete`)
        .send({})

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('USER_NOT_FOUND')
      expect(invitation.save).not.toHaveBeenCalled()
    } finally {
      env.fakeAuthAllowed = previousFakeAuthAllowed
    }
  })
})

/* ================================================================== */
/*  TENANT CRUD                                                       */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/tenants', () => {
  test('returns paginated tenant list with tenant capacity metadata', async () => {
    const token = await getSuperAdminToken()

    // requireCustomerAccess loads customer
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const tenants = [makeFakeTenant()]
    User.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        makeFakeUser({
          _id: USER_ID,
          id: USER_ID,
          name: 'Mary Poppins',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        }),
      ]),
    })
    Tenant.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(tenants),
          }),
        }),
      }),
    })
    Tenant.countDocuments
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants?status=ENABLED`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe(TENANT_ID)
    expect(res.body.data[0].isSelectable).toBe(true)
    expect(res.body.data[0].selectionState).toBe('SELECTABLE')
    expect(res.body.data[0].tenantAdmin).toEqual({
      id: USER_ID,
      name: 'Mary Poppins',
    })
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.tenantCapacity).toEqual({
      maxTenants: 1,
      currentCount: 3,
      remainingCount: 0,
      isAtCapacity: true,
      countMode: 'NON_ARCHIVED',
    })
    expect(res.body.meta.tenantVisibility?.allowed).toBe(true)
    expect(res.body.meta.tenantVisibility?.mode).toBe('OPTIONAL')
  })

  test('denies single-tenant customer members when TENANT_VIEW is absent', async () => {
    const token = await getNonAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
        defaultTenantId: TENANT_ID,
        governance: {
          maxTenants: 1,
          maxVmfsPerTenant: 1,
          customerAdminUserId: null,
        },
      }),
    )

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Customer permission 'TENANT_VIEW' is required.")
    expect(Tenant.find).not.toHaveBeenCalled()
  })

  test('returns only administered tenants for tenant-admin scoped access', async () => {
    const token = await getTenantAdminToken()

    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const tenants = [makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] })]
    Tenant.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(tenants),
          }),
        }),
      }),
    })
    Tenant.countDocuments
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(Tenant.find).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      _id: { $in: [TENANT_ID] },
    }))
    expect(Tenant.countDocuments).toHaveBeenNthCalledWith(1, expect.objectContaining({
      customerId: CUSTOMER_ID,
      _id: { $in: [TENANT_ID] },
    }))
    expect(Tenant.countDocuments).toHaveBeenNthCalledWith(2, expect.objectContaining({
      customerId: CUSTOMER_ID,
      status: { $ne: 'ARCHIVED' },
      _id: { $in: [TENANT_ID] },
    }))
  })

  test('returns stable inactive-customer payload when customer is inactive', async () => {
    const token = await getSuperAdminToken()

    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(res.body.error.requestId).toBeDefined()
  })

  test('denies standard USER tenant members when TENANT_VIEW is absent', async () => {
    const token = await getTenantMemberToken()

    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Customer permission 'TENANT_VIEW' is required.")
    expect(Tenant.find).not.toHaveBeenCalled()
  })

  test('denies standard USER with no tenantMemberships in a multi-tenant customer', async () => {
    const token = await getNonAdminToken()

    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('POST /api/v1/customers/:customerId/tenants', () => {
  test('returns 422 for single-tenant customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE' }),
    )

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Extra Tenant',
        website: 'https://extra.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TOPOLOGY_CONSTRAINT')
  })

  test('creates tenant for multi-tenant customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.countDocuments.mockResolvedValue(0)
    const assignedAdmin = makeFakeUser({
      _id: USER_ID,
      id: USER_ID,
      email: 'assigned.admin@acme.com',
      name: 'Assigned Admin',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.find
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID,
            id: USER_ID,
            name: 'Assigned Admin',
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID,
            id: USER_ID,
            name: 'Assigned Admin',
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
    User.findOne.mockResolvedValue(assignedAdmin)

    const savedTenant = makeFakeTenant({ name: 'New Tenant', tenantAdminUserIds: [USER_ID] })
    const savedVmf = {
      _id: VMF_ID,
      name: 'VMF 1',
      status: 'ACTIVE',
      toJSON: function () {
        return { id: this._id, name: this.name, status: this.status }
      },
    }

    const origTenantSave = Tenant.prototype.save
    const origVmfSave = VMF.prototype.save

    Tenant.prototype.save = jest.fn(async function () {
      Object.assign(this, savedTenant)
      this.toJSON = savedTenant.toJSON.bind(savedTenant)
      return this
    })

    VMF.prototype.save = jest.fn(async function () {
      Object.assign(this, savedVmf)
      this.toJSON = savedVmf.toJSON.bind(savedVmf)
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Tenant',
        website: 'https://newtenant.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.tenant).toBeDefined()
    expect(res.body.data.tenant.tenantAdmin).toEqual({
      id: USER_ID,
      name: 'Assigned Admin',
    })
    expect(res.body.data.tenantAdminUser).toEqual(expect.objectContaining({
      id: USER_ID,
      name: 'Assigned Admin',
      customerRoles: ['USER', 'TENANT_ADMIN'],
    }))
    expect(assignedAdmin.save).toHaveBeenCalled()
    // PER_TENANT_MULTI → auto-create VMF
    expect(res.body.data.vmf).toBeDefined()
    expect(AuditLog.createLog.mock.calls).toEqual(expect.arrayContaining([
      [expect.objectContaining({
        action: 'TENANT_CREATED',
        requestId: res.body.meta.requestId,
        resourceType: 'Tenant',
      })],
      [expect.objectContaining({
        action: 'VMF_CREATED',
        requestId: res.body.meta.requestId,
        resourceType: 'VMF',
      })],
      [expect.objectContaining({
        action: 'USER_ROLE_UPDATED',
        requestId: res.body.meta.requestId,
        resourceType: 'User',
      })],
    ]))

    Tenant.prototype.save = origTenantSave
    VMF.prototype.save = origVmfSave
  })

  test('returns 500 without creating a tenant when tenant-admin role coupling fails', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.countDocuments.mockResolvedValue(0)
    User.find
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })

    const failingTenantAdmin = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
      save: jest.fn(async () => {
        throw new Error('role save failed')
      }),
    })
    User.findOne.mockResolvedValue(failingTenantAdmin)

    const origTenantSave = Tenant.prototype.save
    Tenant.prototype.save = jest.fn(async function () { return this })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Broken Tenant',
        website: 'https://broken.example',
        tenantAdminUserIds: [USER_ID_2],
      })

    expect(res.status).toBe(500)
    expect(Tenant.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'TENANT_CREATED',
    }))

    Tenant.prototype.save = origTenantSave
  })

  test('returns 409 when governance.maxTenants limit is reached (boundary plus one)', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        governance: {
          maxTenants: 1,
          maxVmfsPerTenant: 5,
          customerAdminUserId: null,
        },
      }),
    )
    Tenant.countDocuments.mockResolvedValue(1)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Second Tenant',
        website: 'https://second.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toContain('Tenant limit reached')
    expect(res.body.error.details.reason).toBe('TENANT_LIMIT_REACHED')
    expect(res.body.error.details.limitType).toBe('MAX_TENANTS')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'TENANT_LIMIT_REJECTED',
    }))
  })

  test('applies updated tenant limit immediately after customer governance update', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({
      governance: {
        maxTenants: 2,
        maxVmfsPerTenant: 2,
        customerAdminUserId: null,
      },
    })

    Customer.findById.mockImplementation(async () => customer)
    Tenant.countDocuments.mockResolvedValue(1)

    const updateRes = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        governance: { maxTenants: 1 },
      })

    expect(updateRes.status).toBe(200)
    expect(updateRes.body.data.governance.maxTenants).toBe(1)

    const createRes = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Blocked Tenant',
        website: 'https://blocked.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(createRes.status).toBe(409)
    expect(createRes.body.error.code).toBe('CONFLICT')
    expect(createRes.body.error.details.limit).toBe(1)
  })

  test('returns stable validation details when tenant admin assignments are invalid', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer({
      governance: {
        maxTenants: 5,
        maxVmfsPerTenant: 1,
        customerAdminUserId: null,
      },
    }))
    Tenant.countDocuments.mockResolvedValue(0)
    User.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        makeFakeUser({
          _id: USER_ID,
          id: USER_ID,
          memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          isActive: false,
        }),
      ]),
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Tenant With Bad Admins',
        website: 'https://bad-admins.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('TENANT_ADMIN_ASSIGNMENTS_INVALID')
    expect(res.body.error.details?.invalidTenantAdminUserIds).toEqual([USER_ID])
    expect(res.body.error.details?.inactiveTenantAdminUserIds).toEqual([USER_ID])
  })
})

describe('PATCH /api/v1/customers/:customerId/tenants/:tenantId', () => {
  test('updates a tenant for a customer admin without requiring SUPER_ADMIN', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant()
    User.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        makeFakeUser({
          _id: USER_ID,
          id: USER_ID,
          name: 'Mary Poppins',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
        }),
      ]),
    })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Tenant' })

    expect(res.status).toBe(200)
    expect(tenant.save).toHaveBeenCalled()
    expect(res.body.data.name).toBe('Updated Tenant')
    expect(res.body.data.tenantAdmin).toEqual({
      id: USER_ID,
      name: 'Mary Poppins',
    })
  })

  test('reassigns tenant admin and automatically grants TENANT_ADMIN', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant({ tenantAdminUserIds: [USER_ID] })
    const assignedAdmin = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      email: 'mary.poppins@acme.com',
      name: 'Mary Poppins',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.find
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            name: 'Mary Poppins',
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            name: 'Mary Poppins',
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
    User.findOne.mockResolvedValue(assignedAdmin)

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantAdminUserIds: [USER_ID_2] })

    expect(res.status).toBe(200)
    expect(tenant.save).toHaveBeenCalled()
    expect(assignedAdmin.save).toHaveBeenCalled()
    expect(res.body.data.tenantAdmin).toEqual({
      id: USER_ID_2,
      name: 'Mary Poppins',
    })
    expect(res.body.data.tenantAdminUser).toEqual(expect.objectContaining({
      id: USER_ID_2,
      name: 'Mary Poppins',
      customerRoles: ['USER', 'TENANT_ADMIN'],
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_ROLE_UPDATED',
      requestId: res.body.meta.requestId,
      resourceType: 'User',
    }))
  })

  test('returns 500 without saving tenant changes when tenant-admin role coupling fails', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant({ tenantAdminUserIds: [USER_ID] })
    User.find
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          makeFakeUser({
            _id: USER_ID_2,
            id: USER_ID_2,
            memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
          }),
        ]),
      })

    const failingTenantAdmin = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
      save: jest.fn(async () => {
        throw new Error('role save failed')
      }),
    })
    User.findOne.mockResolvedValue(failingTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantAdminUserIds: [USER_ID_2] })

    expect(res.status).toBe(500)
    expect(tenant.save).not.toHaveBeenCalled()
  })

  test('returns 404 when the tenant is outside the customer scope', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant({ customerId: OTHER_CUSTOMER_ID })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Tenant' })

    expect(res.status).toBe(404)
    expect(tenant.save).not.toHaveBeenCalled()
  })

  test('allows tenant admin to update an in-scope tenant', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] })

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tenant Admin Updated Tenant' })

    expect(res.status).toBe(200)
    expect(tenant.save).toHaveBeenCalled()
    expect(res.body.data.name).toBe('Tenant Admin Updated Tenant')
  })

  test('returns 404 when tenant admin targets an out-of-scope tenant', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({ tenantAdminUserIds: [USER_ID] })

    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked Tenant Admin Update' })

    expect(res.status).toBe(404)
    expect(tenant.save).not.toHaveBeenCalled()
  })

  test('returns 422 when more than one tenant admin is supplied', async () => {
    const token = await getCustomerAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantAdminUserIds: [USER_ID, USER_ID_2] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.tenantAdminUserIds).toBe('Only one tenant admin is allowed')
  })

  test('returns 403 when tenant admin attempts tenant-admin reassignment', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] })

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantAdminUserIds: [USER_ID] })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.details?.reason).toBe('TENANT_ADMIN_ASSIGNMENT_FORBIDDEN')
  })
})

describe('PATCH /api/v1/tenants/:tenantId', () => {
  test('returns 403 when tenant belongs to an inactive customer', async () => {
    const token = await getSuperAdminToken()

    Tenant.findById.mockResolvedValue(makeFakeTenant())
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked Tenant Update' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(res.body.error.requestId).toBeDefined()
  })

  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('updates tenant name', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant()
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Tenant' })

    expect(res.status).toBe(200)
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'TENANT_UPDATED',
      requestId: res.body.meta.requestId,
      resourceType: 'Tenant',
      resourceId: TENANT_ID,
    }))
  })

  test('updates tenant website', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant()
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ website: 'https://updated.example' })

    expect(res.status).toBe(200)
    expect(tenant.website).toBe('https://updated.example')
  })

  test('returns stable validation details when updated tenant admins are invalid', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    User.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        makeFakeUser({
          _id: USER_ID,
          id: USER_ID,
          memberships: [{ customerId: OTHER_CUSTOMER_ID, roles: ['USER'] }],
        }),
      ]),
    })

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantAdminUserIds: [USER_ID] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details?.reason).toBe('TENANT_ADMIN_ASSIGNMENTS_INVALID')
    expect(res.body.error.details?.invalidTenantAdminUserIds).toEqual([USER_ID])
    expect(res.body.error.details?.outOfCustomerTenantAdminUserIds).toEqual([USER_ID])
  })
})

describe('POST /api/v1/tenants/:tenantId/enable', () => {
  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 200 when tenant is already enabled', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ENABLED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.message).toContain('already enabled')
  })

  test('returns 422 when tenant is archived', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ARCHIVED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Archived')
  })

  test('enables a disabled tenant', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant({ status: 'DISABLED' })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('ENABLED')
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'TENANT_ENABLED',
      requestId: res.body.meta.requestId,
      resourceType: 'Tenant',
      resourceId: TENANT_ID,
    }))
  })
})

describe('POST /api/v1/customers/:customerId/tenants/:tenantId/enable', () => {
  test('enables an in-scope tenant for a tenant admin', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({
      status: 'DISABLED',
      tenantAdminUserIds: [TENANT_ADMIN_ID],
    })

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('ENABLED')
    expect(tenant.save).toHaveBeenCalled()
  })

  test('returns 404 when tenant admin enables an out-of-scope tenant', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({
      status: 'DISABLED',
      tenantAdminUserIds: [USER_ID],
    })

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(tenant.save).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/customers/:customerId/tenants/:tenantId/disable', () => {
  test('disables an in-scope tenant for a customer admin', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant({ status: 'ENABLED' })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('DISABLED')
    expect(tenant.save).toHaveBeenCalled()
  })

  test('returns 404 when the tenant is outside the customer scope', async () => {
    const token = await getCustomerAdminToken()
    const tenant = makeFakeTenant({ customerId: OTHER_CUSTOMER_ID, status: 'ENABLED' })

    User.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ADMIN_ID) {
        return Promise.resolve(makeFakeUser({
          _id: CUSTOMER_ADMIN_ID,
          id: CUSTOMER_ADMIN_ID,
          email: 'custadmin@acme.com',
          name: 'Customer Admin',
          memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        }))
      }
      return Promise.resolve(null)
    })
    Customer.findById.mockImplementation((id) => {
      if (id === CUSTOMER_ID) return Promise.resolve(makeFakeCustomer())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(tenant.save).not.toHaveBeenCalled()
  })

  test('disables an in-scope tenant for a tenant admin', async () => {
    const token = await getTenantAdminToken()
    const tenant = makeFakeTenant({ status: 'ENABLED', tenantAdminUserIds: [TENANT_ADMIN_ID] })

    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('DISABLED')
    expect(tenant.save).toHaveBeenCalled()
  })
})

describe('POST /api/v1/tenants/:tenantId/disable', () => {
  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 422 when trying to disable default tenant', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ isDefault: true }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Default tenants')
  })

  test('returns 200 when tenant is already disabled', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.message).toContain('already disabled')
  })

  test('returns 422 when tenant is archived', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ARCHIVED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Archived')
  })

  test('disables an enabled tenant', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant({ status: 'ENABLED' })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('DISABLED')
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'TENANT_DISABLED',
      requestId: res.body.meta.requestId,
      resourceType: 'Tenant',
      resourceId: TENANT_ID,
    }))
  })
})

/* ================================================================== */
/*  PROVISIONING SERVICE — UNIT TESTS                                 */
/* ================================================================== */

describe('Provisioning Service', () => {
  let createCustomerWithDefaults, createTenantWithDefaults

  beforeAll(async () => {
    const svc = await import('../services/provisioningService.js')
    createCustomerWithDefaults = svc.createCustomerWithDefaults
    createTenantWithDefaults = svc.createTenantWithDefaults
  })

  describe('createCustomerWithDefaults', () => {
    test('multi-tenant creates customer only (no tenant/VMF)', async () => {
      const origSave = Customer.prototype.save
      Customer.prototype.save = jest.fn(async function () { return this })

      const result = await createCustomerWithDefaults(
        {
          name: 'Multi Corp',
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_SINGLE',
          billing: { planCode: 'PRO' },
        },
        USER_ID,
      )

      expect(result.customer).toBeDefined()
      expect(result.tenant).toBeNull()
      expect(result.vmf).toBeNull()

      Customer.prototype.save = origSave
    })

    test('single-tenant creates customer + default tenant + VMF 1', async () => {
      const origCSave = Customer.prototype.save
      const origTSave = Tenant.prototype.save
      const origVSave = VMF.prototype.save

      Customer.prototype.save = jest.fn(async function () { return this })
      Tenant.prototype.save = jest.fn(async function () { return this })
      VMF.prototype.save = jest.fn(async function () { return this })

      const result = await createCustomerWithDefaults(
        {
          name: 'Single Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        },
        USER_ID,
      )

      expect(result.customer).toBeDefined()
      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeDefined()

      Customer.prototype.save = origCSave
      Tenant.prototype.save = origTSave
      VMF.prototype.save = origVSave
    })
  })

  describe('createTenantWithDefaults', () => {
    test('creates tenant with auto VMF for PER_TENANT_SINGLE policy', async () => {
      const origTSave = Tenant.prototype.save
      const origVSave = VMF.prototype.save

      Tenant.prototype.save = jest.fn(async function () { return this })
      VMF.prototype.save = jest.fn(async function () { return this })

      const customer = makeFakeCustomer({ vmfPolicy: 'PER_TENANT_SINGLE' })
      const result = await createTenantWithDefaults(
        {
          name: 'New Tenant',
          website: 'https://nt.example',
          tenantAdminUserIds: [USER_ID],
        },
        customer,
        USER_ID,
      )

      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeDefined()

      Tenant.prototype.save = origTSave
      VMF.prototype.save = origVSave
    })

    test('creates tenant without VMF for non-PER_TENANT policy', async () => {
      const origTSave = Tenant.prototype.save

      Tenant.prototype.save = jest.fn(async function () { return this })

      // Use a topology that doesn't auto-create VMFs
      const customer = makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
      })
      const result = await createTenantWithDefaults(
        {
          name: 'New Tenant',
          website: 'https://nt.example',
          tenantAdminUserIds: [USER_ID],
        },
        customer,
        USER_ID,
      )

      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeNull()

      Tenant.prototype.save = origTSave
    })
  })
})
