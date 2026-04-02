/**
 * VMF & Deal Management Tests
 *
 * Integration-style tests for Phase 3.3 endpoints:
 *
 *   VMF Routes (Tenant-scoped — TENANT_ADMIN / CUSTOMER_ADMIN):
 *     - GET    /api/v1/customers/:customerId/tenants/:tenantId/vmfs
 *     - POST   /api/v1/customers/:customerId/tenants/:tenantId/vmfs
 *
 *   VMF Routes (VMF-scoped — requireVmfAccess):
 *     - GET    /api/v1/vmfs/:vmfId
 *     - PATCH  /api/v1/vmfs/:vmfId
 *     - DELETE /api/v1/vmfs/:vmfId
 *     - POST   /api/v1/vmfs/:vmfId/grants
 *     - DELETE /api/v1/vmfs/:vmfId/grants/:userId
 *
 *   Deal Routes (VMF-scoped):
 *     - GET    /api/v1/vmfs/:vmfId/deals
 *     - POST   /api/v1/vmfs/:vmfId/deals
 *
 *   Deal Routes (Deal-scoped — hybrid capability + VMF grant access):
 *     - GET    /api/v1/deals/:dealId
 *     - PATCH  /api/v1/deals/:dealId
 *     - DELETE /api/v1/deals/:dealId
 *
 *   Validators:
 *     - VMF create / update / grantAccess
 *     - Deal create / update
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
const TENANT_ADMIN_ID = '507f1f77bcf86cd799439013'
const REGULAR_USER_ID = '507f1f77bcf86cd799439014'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const VMF_ID = '807f1f77bcf86cd799439055'
const VMF_ID_2 = '807f1f77bcf86cd799439066'
const DEAL_ID = '907f1f77bcf86cd799439077'
const POLICY_ID = '917f1f77bcf86cd799439088'

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
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeTenantAdmin = (overrides = {}) => ({
  _id: TENANT_ADMIN_ID,
  id: TENANT_ADMIN_ID,
  email: 'tenantadmin@acme.com',
  name: 'Tenant Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
  ],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeCustomerScopedTenantAdmin = (overrides = {}) => ({
  ...makeTenantAdmin(),
  memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  ...overrides,
})

const makeRegularUser = (overrides = {}) => ({
  _id: REGULAR_USER_ID,
  id: REGULAR_USER_ID,
  email: 'user@acme.com',
  name: 'Regular User',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
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
  governance: {
    maxTenants: 10,
    maxVmfsPerTenant: 10,
    customerAdminUserId: null,
  },
  defaultTenantId: null,
  isServiceProvider: false,
  status: 'ACTIVE',
  entitlements: [],
  billing: { planCode: 'PRO', cycle: 'MONTHLY' },
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return { id: this._id, name: this.name, topology: this.topology, vmfPolicy: this.vmfPolicy }
  },
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
  tenantAdminUserIds: [TENANT_ADMIN_ID],
  toJSON: function () {
    return { id: this._id, customerId: this.customerId, name: this.name, status: this.status }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeFakeVmf = (overrides = {}) => ({
  _id: VMF_ID,
  id: VMF_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  name: 'VMF 1',
  description: 'Default VMF description',
  status: 'ACTIVE',
  lifecycleStatus: 'DRAFT',
  frameworkVersion: '2.2',
  versionPolicyId: POLICY_ID,
  deletedAt: null,
  purgeAfter: null,
  createdBy: SUPER_ADMIN_ID,
  toJSON: function () {
    return {
      id: this._id,
      customerId: this.customerId,
      tenantId: this.tenantId,
      name: this.name,
      description: this.description,
      status: this.status,
      lifecycleStatus: this.lifecycleStatus,
      frameworkVersion: this.frameworkVersion,
      versionPolicyId: this.versionPolicyId,
      deletedAt: this.deletedAt,
      purgeAfter: this.purgeAfter,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeActivePolicy = (overrides = {}) => ({
  _id: POLICY_ID,
  id: POLICY_ID,
  version: 5,
  rules: {
    frameworkVersion: '2.2',
  },
  isActive: true,
  ...overrides,
})

const makeRoleDefinition = (key, scope, permissions = []) => ({
  key,
  scope,
  permissions,
  isActive: true,
})

const makeFakeDeal = (overrides = {}) => ({
  _id: DEAL_ID,
  id: DEAL_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  vmfId: VMF_ID,
  title: 'Test Deal',
  stage: 'Discovery',
  data: { amount: 10000 },
  status: 'ACTIVE',
  createdBy: SUPER_ADMIN_ID,
  toJSON: function () {
    return {
      id: this._id,
      vmfId: this.vmfId,
      title: this.title,
      stage: this.stage,
      data: this.data,
      status: this.status,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService, performanceCacheService
let User, Customer, Tenant, VMF, Deal, AuditLog, SystemVersioningPolicy, Role

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  performanceCacheService = (await import('../services/performanceCacheService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  Deal = models.Deal
  AuditLog = models.AuditLog
  SystemVersioningPolicy = models.SystemVersioningPolicy
  Role = models.Role
})

const makeDefaultRoleDefinitions = () => ([
  makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
  makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
  makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
  makeRoleDefinition('USER', 'VMF', ['VMF_VIEW']),
])

const setRoleDefinitions = (definitions = makeDefaultRoleDefinitions()) => {
  Role.find = jest.fn().mockResolvedValue(definitions)
}

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

let superAdminToken, customerAdminToken, tenantAdminToken, regularUserToken

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

const getTenantAdminToken = async () => {
  if (tenantAdminToken) return tenantAdminToken
  const tokens = await tokenService.generateTokens(makeTenantAdmin())
  tenantAdminToken = tokens.accessToken
  return tenantAdminToken
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
  performanceCacheService.resetForTests()

  User.findById = jest.fn()
  User.findOne = jest.fn()
  User.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  Customer.findById = jest.fn()
  Customer.findById.mockResolvedValue(makeFakeCustomer())
  Tenant.findById = jest.fn()
  VMF.findById = jest.fn()
  VMF.findById.mockResolvedValue(makeFakeVmf())
  VMF.find = jest.fn()
  VMF.countDocuments = jest.fn()
  VMF.countByTenant = jest.fn()
  VMF.deleteOne = jest.fn(async () => ({ deletedCount: 1 }))
  SystemVersioningPolicy.findActive = jest.fn().mockResolvedValue(null)
  Deal.findById = jest.fn()
  Deal.find = jest.fn()
  Deal.countDocuments = jest.fn()
  Deal.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  AuditLog.createLog = jest.fn(async () => ({}))
  setRoleDefinitions()

  // Default: loadScopes finds the correct user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
    if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
    return Promise.resolve(null)
  })
})

/* ================================================================== */
/*  VMF VALIDATOR TESTS                                               */
/* ================================================================== */

describe('VMF Validators', () => {
  describe('POST /…/vmfs — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      // requireTenantAccess needs Tenant.findById
      Tenant.findById.mockResolvedValue(makeFakeTenant())
      VMF.countByTenant.mockResolvedValue(0)

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when name is empty string', async () => {
      const token = await getSuperAdminToken()
      Tenant.findById.mockResolvedValue(makeFakeTenant())
      VMF.countByTenant.mockResolvedValue(0)

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /api/v1/vmfs/:vmfId — validation', () => {
    test('returns 422 when body is empty', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'BOGUS' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when lifecycleStatus is invalid', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lifecycleStatus: 'READY' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('POST /api/v1/vmfs/:vmfId/grants — validation', () => {
    test('returns 422 when userId is missing', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/grants`)
        .set('Authorization', `Bearer ${token}`)
        .send({ permissions: ['READ'] })

      expect(res.status).toBe(422)
      expect(res.body.error.details).toHaveProperty('userId')
    })

    test('returns 422 when permissions is empty array', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/grants`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: REGULAR_USER_ID, permissions: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.details).toHaveProperty('permissions')
    })
  })
})

/* ================================================================== */
/*  DEAL VALIDATOR TESTS                                              */
/* ================================================================== */

describe('Deal Validators', () => {
  describe('POST /api/v1/vmfs/:vmfId/deals — validation', () => {
    test('returns 422 when title is missing', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/deals`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('title')
    })
  })

  describe('PATCH /api/v1/deals/:dealId — validation', () => {
    test('returns 422 when body is empty', async () => {
      const token = await getSuperAdminToken()
      Deal.findById.mockResolvedValue(makeFakeDeal())

      const res = await request
        .patch(`/api/v1/deals/${DEAL_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      Deal.findById.mockResolvedValue(makeFakeDeal())

      const res = await request
        .patch(`/api/v1/deals/${DEAL_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELETED' })

      expect(res.status).toBe(422)
    })
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('VMF/Deal authorization guards', () => {
  test('tenant-scoped VMF routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
    expect(res.status).toBe(401)
  })

  test('VMF-scoped routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/vmfs/${VMF_ID}`)
    expect(res.status).toBe(401)
  })

  test('deal-scoped routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/deals/${DEAL_ID}`)
    expect(res.status).toBe(401)
  })

  test('deal-scoped routes return 403 for callers without hybrid deal access', async () => {
    // Regular user has no DEAL_VIEW capability and no VMF grant — should be denied.
    const token = await getRegularUserToken()
    Deal.findById.mockResolvedValue(makeFakeDeal())

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

/* ================================================================== */
/*  LIST VMFs                                                         */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/tenants/:tenantId/vmfs', () => {
  test('returns paginated VMF list for Super Admin', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0) // topologyGuard + vmfCapacity

    const vmfs = [makeFakeVmf()]
    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(vmfs),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.vmfCapacity).toEqual({
      maxVmfs: 10,
      currentCount: 0,
      remainingCount: 10,
      isAtCapacity: false,
      countMode: 'ACTIVE',
    })
  })

  test('returns VMF list for Tenant Admin', async () => {
    const token = await getTenantAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta.vmfCapacity?.maxVmfs).toBe(10)
  })

  test('returns VMF list for a regular user with tenant access', async () => {
    const token = await getRegularUserToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('returns VMF list for a customer-scoped tenant admin on a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('returns 403 for a regular user when VMF_VIEW is not granted by their resolved tenant roles', async () => {
    const token = await getRegularUserToken()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', []),
    ])

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_VIEW' is required.")
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('returns VMF list for a single-tenant customer user without tenant membership', async () => {
    const tokens = await tokenService.generateTokens(
      makeRegularUser({ tenantMemberships: [] }),
    )

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({ tenantMemberships: [] }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
        defaultTenantId: TENANT_ID,
      }),
    )
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('supports search by q param', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs?q=test`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(VMF.find).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  CREATE VMF                                                        */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/tenants/:tenantId/vmfs', () => {
  test('creates VMF successfully', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0) // topologyGuard allows
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New VMF',
        description: 'Lifecycle-ready VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.name).toBe('New VMF')
    expect(res.body.data.description).toBe('Lifecycle-ready VMF')
    expect(res.body.data.lifecycleStatus).toBe('DRAFT')
    expect(res.body.data.frameworkVersion).toBe('2.2')
    expect(res.body.data.versionPolicyId).toBe(POLICY_ID)
    expect(AuditLog.createLog).toHaveBeenCalled()

    VMF.prototype.save = origSave
  })

  test('returns 403 for a regular user without VMF_CREATE permission', async () => {
    const token = await getRegularUserToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked VMF' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_CREATE' is required.")
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('allows a regular tenant member to create a VMF when VMF_CREATE is granted to their role', async () => {
    const token = await getRegularUserToken()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_CREATE']),
    ])
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Permission Driven VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.name).toBe('Permission Driven VMF')

    VMF.prototype.save = origSave
  })

  test('re-evaluates VMF_CREATE after auth cache reset when a role gains the permission', async () => {
    const token = await getRegularUserToken()

    const deniedResponse = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Still Blocked VMF' })

    expect(deniedResponse.status).toBe(403)

    performanceCacheService.resetForTests()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_CREATE']),
    ])
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const allowedResponse = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Permission Refresh VMF' })

    expect(allowedResponse.status).toBe(201)
    expect(allowedResponse.body.data?.name).toBe('Permission Refresh VMF')

    VMF.prototype.save = origSave
  })

  test('returns 403 for disabled tenant', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New VMF' })

    // requireTenantEnabled returns 403 for disabled tenants
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
  })

  test('returns 409 when policy forbids (PER_TENANT_SINGLE, already has 1)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({ vmfPolicy: 'PER_TENANT_SINGLE' })
    Customer.findById.mockResolvedValue(customer)
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(1) // already has a VMF

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second VMF' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('returns 409 when governance maxVmfsPerTenant limit is reached (boundary plus one)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({
      vmfPolicy: 'PER_TENANT_MULTI',
      governance: {
        maxTenants: 10,
        maxVmfsPerTenant: 1,
        customerAdminUserId: null,
      },
    })
    Customer.findById.mockResolvedValue(customer)
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(1)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second VMF' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.limitType).toBe('MAX_VMFS_PER_TENANT')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VMF_LIMIT_REJECTED',
    }))
  })

  test('allows customer-scoped tenant admin to create a VMF for a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        name: 'Scoped Tenant Admin VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.name).toBe('Scoped Tenant Admin VMF')

    VMF.prototype.save = origSave
  })

  test('denies customer-scoped tenant admin VMF creation when they are only linked to the tenant as a user', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        name: 'Blocked Scoped Tenant Admin VMF',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_CREATE' is required.")
  })
})

/* ================================================================== */
/*  GET VMF                                                           */
/* ================================================================== */

describe('GET /api/v1/vmfs/:vmfId', () => {
  test('returns VMF for Super Admin', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('VMF 1')
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 404 when VMF is soft-deleted', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        status: 'ARCHIVED',
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    )

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  UPDATE VMF                                                        */
/* ================================================================== */

describe('PATCH /api/v1/vmfs/:vmfId', () => {
  test('updates VMF name', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated VMF' })

    expect(res.status).toBe(200)
    expect(vmf.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates VMF status to DISABLED', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(200)
    expect(vmf.status).toBe('DISABLED')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('updates VMF lifecycle status from DRAFT to CANONISED', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ lifecycleStatus: 'DRAFT' })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycleStatus: 'CANONISED' })

    expect(res.status).toBe(200)
    expect(vmf.lifecycleStatus).toBe('CANONISED')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('returns 422 for invalid lifecycle regression transition', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ lifecycleStatus: 'PUBLISHED' })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycleStatus: 'DRAFT' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('INVALID_LIFECYCLE_TRANSITION')
    expect(vmf.save).not.toHaveBeenCalled()
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' })

    expect(res.status).toBe(404)
  })

  test('allows customer-scoped tenant admin to update a VMF for a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ name: 'Updated By Scoped Tenant Admin' })

    expect(res.status).toBe(200)
    expect(vmf.name).toBe('Updated By Scoped Tenant Admin')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('allows regular user with scoped VMF_UPDATE to update a VMF without a VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_UPDATE']),
    ])

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser({ vmfGrants: [] }))
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Scoped Update Without Grant' })

    expect(res.status).toBe(200)
    expect(vmf.name).toBe('Scoped Update Without Grant')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('denies customer-scoped tenant admin VMF update when they are only linked to the tenant as a user', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ name: 'Blocked Update By Scoped Tenant Admin' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_UPDATE' is required.")
    expect(vmf.save).not.toHaveBeenCalled()
  })

  test('denies regular user with WRITE grant when VMF_UPDATE is not granted by role permissions', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked Update' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'VMF_UPDATE' is required.")
    expect(vmf.save).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  DELETE VMF                                                        */
/* ================================================================== */

describe('DELETE /api/v1/vmfs/:vmfId', () => {
  test('soft-deletes a disabled VMF with no active deals', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ status: 'DISABLED' })
    VMF.findById.mockResolvedValue(vmf)
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('deleted')
    expect(vmf.save).toHaveBeenCalled()
    expect(vmf.deletedAt).toBeDefined()
    expect(vmf.purgeAfter).toBeDefined()
    expect(User.updateMany).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when VMF is active', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'ACTIVE' }))

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Disable or archive')
  })

  test('returns 422 when VMF has active deals', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'DISABLED' }))
    Deal.countDocuments.mockResolvedValue(3)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('active deal')
  })

  test('returns 404 when VMF is already soft-deleted', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        status: 'ARCHIVED',
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
        purgeAfter: new Date('2026-03-31T00:00:00.000Z'),
      }),
    )

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('allows regular user with scoped VMF_UPDATE to delete a VMF without a VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf({ status: 'DISABLED' })
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_UPDATE']),
    ])

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser({ vmfGrants: [] }))
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(vmf.save).toHaveBeenCalled()
    expect(User.updateMany).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  GRANT ACCESS                                                      */
/* ================================================================== */

describe('POST /api/v1/vmfs/:vmfId/grants', () => {
  test('grants user access to a VMF', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const targetUser = makeRegularUser()
    // Override findById to handle both auth user and target user
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ', 'WRITE'] })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('Access granted')
    expect(targetUser.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 404 when target user does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null) // target user not found
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ'] })

    expect(res.status).toBe(404)
  })

  test('returns 422 when user does not belong to VMF customer', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const foreignUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(foreignUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ'] })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('does not belong')
  })

  test('replaces permissions if grant already exists', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const userWithGrant = makeRegularUser({
      vmfGrants: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
      ],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userWithGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ', 'WRITE'] })

    expect(res.status).toBe(200)
    expect(userWithGrant.save).toHaveBeenCalled()
  })

  test('denies regular user with VMF WRITE grant when VMF_UPDATE capability is missing', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()
    const targetUser = makeRegularUser({ _id: '507f1f77bcf86cd799439099', id: '507f1f77bcf86cd799439099' })

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === '507f1f77bcf86cd799439099') return Promise.resolve(targetUser)
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: '507f1f77bcf86cd799439099', permissions: ['READ'] })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'VMF_UPDATE' is required.")
  })
})

/* ================================================================== */
/*  REVOKE ACCESS                                                     */
/* ================================================================== */

describe('DELETE /api/v1/vmfs/:vmfId/grants/:userId', () => {
  test('revokes user access to a VMF', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const userWithGrant = makeRegularUser({
      vmfGrants: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
      ],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userWithGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('revoked')
    expect(userWithGrant.save).toHaveBeenCalled()
  })

  test('returns 404 when user has no grant for VMF', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const userNoGrant = makeRegularUser({ vmfGrants: [] })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userNoGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.message).toContain('does not have a grant')
  })

  test('returns 404 when target user does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  LIST DEALS                                                        */
/* ================================================================== */

describe('GET /api/v1/vmfs/:vmfId/deals', () => {
  test('returns paginated deal list', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const deals = [makeFakeDeal()]
    Deal.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(deals),
          }),
        }),
      }),
    })
    Deal.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
  })

  test('supports search by q param', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    Deal.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals?q=discovery`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('returns 403 for a regular user with VMF grant when DEAL_VIEW capability is missing', async () => {
    const token = await getRegularUserToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'DEAL_VIEW' is required.")
  })
})

/* ================================================================== */
/*  CREATE DEAL                                                       */
/* ================================================================== */

describe('POST /api/v1/vmfs/:vmfId/deals', () => {
  test('creates deal successfully', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const origSave = Deal.prototype.save
    Deal.prototype.save = jest.fn(async function () {
      this._id = DEAL_ID
      this.id = DEAL_ID
      return this
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal', stage: 'Discovery' })

    expect(res.status).toBe(201)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.title).toBe('New Deal')
    expect(AuditLog.createLog).toHaveBeenCalled()

    Deal.prototype.save = origSave
  })

  test('creates deal with data object', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const origSave = Deal.prototype.save
    Deal.prototype.save = jest.fn(async function () {
      this._id = DEAL_ID
      this.id = DEAL_ID
      return this
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Deal With Data', data: { amount: 50000, currency: 'USD' } })

    expect(res.status).toBe(201)

    Deal.prototype.save = origSave
  })

  test('returns 422 when VMF is not active', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal' })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('inactive')
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal' })

    expect(res.status).toBe(404)
  })

  test('returns 403 for a regular user with VMF WRITE grant when DEAL_CREATE capability is missing', async () => {
    const token = await getRegularUserToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Blocked Deal' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'DEAL_CREATE' is required.")
  })
})

/* ================================================================== */
/*  GET DEAL                                                          */
/* ================================================================== */

describe('GET /api/v1/deals/:dealId', () => {
  test('returns deal for Super Admin', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(makeFakeDeal())

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Test Deal')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns deal for a regular user with DEAL_VIEW capability and VMF READ grant', async () => {
    const token = await getRegularUserToken()
    const roleDefinitions = makeDefaultRoleDefinitions().map((roleDefinition) =>
      roleDefinition.key === 'USER'
        ? makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'DEAL_VIEW'])
        : roleDefinition,
    )

    setRoleDefinitions(roleDefinitions)
    Deal.findById.mockResolvedValue(makeFakeDeal())
    VMF.findById.mockResolvedValue(makeFakeVmf())
    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Test Deal')
  })
})

/* ================================================================== */
/*  UPDATE DEAL                                                       */
/* ================================================================== */

describe('PATCH /api/v1/deals/:dealId', () => {
  test('updates deal title', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Deal' })

    expect(res.status).toBe(200)
    expect(deal.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates deal stage and data', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'Negotiation', data: { amount: 25000 } })

    expect(res.status).toBe(200)
    expect(deal.stage).toBe('Negotiation')
    expect(deal.save).toHaveBeenCalled()
  })

  test('archives deal via status update', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })

    expect(res.status).toBe(200)
    expect(deal.status).toBe('ARCHIVED')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' })

    expect(res.status).toBe(404)
  })

  test('updates deal for a regular user with DEAL_UPDATE capability and VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const roleDefinitions = makeDefaultRoleDefinitions().map((roleDefinition) =>
      roleDefinition.key === 'USER'
        ? makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'DEAL_UPDATE'])
        : roleDefinition,
    )
    const deal = makeFakeDeal()

    setRoleDefinitions(roleDefinitions)
    Deal.findById.mockResolvedValue(deal)
    VMF.findById.mockResolvedValue(makeFakeVmf())
    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated By Hybrid Access' })

    expect(res.status).toBe(200)
    expect(deal.title).toBe('Updated By Hybrid Access')
    expect(deal.save).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  ARCHIVE (DELETE) DEAL                                             */
/* ================================================================== */

describe('DELETE /api/v1/deals/:dealId', () => {
  test('archives an active deal', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('archived')
    expect(deal.status).toBe('ARCHIVED')
    expect(deal.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when deal is already archived', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(makeFakeDeal({ status: 'ARCHIVED' }))

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('already archived')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
