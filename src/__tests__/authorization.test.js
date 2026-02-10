/**
 * Authorization Middleware Tests
 *
 * Unit-style tests for the Phase 2.2 authorization middleware:
 *   - loadScopes
 *   - authorize (requirePlatformRole, requireCustomerAccess,
 *                requireTenantAccess, requireVmfAccess)
 *   - topologyGuard
 *   - requireTenantEnabled (tenantStatus)
 *
 * All Mongoose model statics are monkey-patched before each test.
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

/* ------------------------------------------------------------------ */
/*  Environment setup                                                 */
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

const USER_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const TENANT_ID_2 = '707f1f77bcf86cd799439044'
const VMF_ID = '807f1f77bcf86cd799439055'

/* ------------------------------------------------------------------ */
/*  Factories                                                         */
/* ------------------------------------------------------------------ */

const makeFakeUser = (overrides = {}) => ({
  _id: USER_ID,
  id: USER_ID,
  email: 'user@example.com',
  name: 'Test User',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [],
  tenantMemberships: [],
  vmfGrants: [],
  ...overrides,
})

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  defaultTenantId: null,
  isServiceProvider: false,
  status: 'ACTIVE',
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
  ...overrides,
})

const makeFakeVmf = (overrides = {}) => ({
  _id: VMF_ID,
  id: VMF_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  name: 'VMF 1',
  status: 'ACTIVE',
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Mock helpers: req / res / next                                    */
/* ------------------------------------------------------------------ */

const makeReq = (overrides = {}) => ({
  requestId: 'req-test-001',
  context: { userId: USER_ID },
  userId: USER_ID,
  params: {},
  method: 'GET',
  baseUrl: '',
  path: '/',
  headers: {},
  scopes: undefined,
  ...overrides,
})

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(data) {
      res.body = data
      return res
    },
  }
  return res
}

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let User, Customer, Tenant, VMF
let loadScopes
let requirePlatformRole, requireCustomerAccess, requireTenantAccess, requireVmfAccess
let topologyGuard
let requireTenantEnabled

beforeAll(async () => {
  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF

  loadScopes = (await import('../middleware/loadScopes.js')).default

  const authorize = await import('../middleware/authorize.js')
  requirePlatformRole = authorize.requirePlatformRole
  requireCustomerAccess = authorize.requireCustomerAccess
  requireTenantAccess = authorize.requireTenantAccess
  requireVmfAccess = authorize.requireVmfAccess

  topologyGuard = (await import('../middleware/topologyGuard.js')).default
  requireTenantEnabled = (await import('../middleware/tenantStatus.js')).default
})

beforeEach(() => {
  // Reset model stubs
  User.findById = jest.fn()
  Customer.findById = jest.fn()
  Tenant.findById = jest.fn()
  VMF.findById = jest.fn()
  VMF.countByTenant = jest.fn()
})

/* ================================================================== */
/*  loadScopes                                                        */
/* ================================================================== */

describe('loadScopes', () => {
  test('returns 401 when userId is not set', async () => {
    const req = makeReq({ context: {}, userId: undefined })
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 401 when user not found in DB', async () => {
    User.findById.mockResolvedValue(null)
    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 401 when user is disabled', async () => {
    User.findById.mockResolvedValue(makeFakeUser({ isActive: false }))
    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_DISABLED')
    expect(next).not.toHaveBeenCalled()
  })

  test('populates req.scopes with user data', async () => {
    const user = makeFakeUser({
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
      tenantMemberships: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
      ],
      vmfGrants: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
      ],
    })
    User.findById.mockResolvedValue(user)

    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes).toBeDefined()
    expect(req.scopes.user).toBe(user)
    expect(req.scopes.platformRoles).toEqual(['SUPER_ADMIN'])
    expect(req.scopes.isPlatformUser).toBe(true)
    expect(req.scopes.memberships).toHaveLength(2)
    expect(req.scopes.tenantMemberships).toHaveLength(1)
    expect(req.scopes.vmfGrants).toHaveLength(1)
  })

  test('sets isPlatformUser to false for non-platform users', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.findById.mockResolvedValue(user)

    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.platformRoles).toEqual([])
    expect(req.scopes.isPlatformUser).toBe(false)
  })
})

/* ================================================================== */
/*  requirePlatformRole                                               */
/* ================================================================== */

describe('requirePlatformRole', () => {
  test('returns 500 when scopes not loaded', () => {
    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    requirePlatformRole('SUPER_ADMIN')(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 403 when user lacks the required platform role', () => {
    const req = makeReq({
      scopes: {
        platformRoles: ['USER'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    requirePlatformRole('SUPER_ADMIN')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(next).not.toHaveBeenCalled()
  })

  test('calls next() when user has the required platform role', () => {
    const req = makeReq({
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    requirePlatformRole('SUPER_ADMIN')(req, res, next)

    expect(next).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  requireCustomerAccess                                             */
/* ================================================================== */

describe('requireCustomerAccess', () => {
  test('returns 403 when customerId param is missing', async () => {
    const req = makeReq({
      params: {},
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess()(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants Super Admin access and loads customer', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess()(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customer).toBeDefined()
    expect(req.scopes.customer.name).toBe('Acme Corp')
  })

  test('returns 404 when Super Admin targets nonexistent customer', async () => {
    Customer.findById.mockResolvedValue(null)

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess()(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(next).not.toHaveBeenCalled()
  })

  test('denies Super Admin bypass when allowPlatform is false', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess({ allowPlatform: false })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants access to user with customer membership', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess()(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies access when user has no membership for that customer', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: '999f1f77bcf86cd799439099', roles: ['USER'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess()(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies access when user lacks the required customer role', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants access when user has one of the required roles', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess({ roles: ['CUSTOMER_ADMIN', 'USER'] })(req, res, next)

    expect(next).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  requireTenantAccess                                               */
/* ================================================================== */

describe('requireTenantAccess', () => {
  test('returns 403 when customerId or tenantId param is missing', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 404 when tenant does not belong to customer', async () => {
    Tenant.findById.mockResolvedValue(
      makeFakeTenant({ customerId: '999f1f77bcf86cd799439099' }),
    )

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(next).not.toHaveBeenCalled()
  })

  test('grants Super Admin access', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.tenant).toBeDefined()
  })

  test('grants Customer Admin access', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies Customer Admin when allowCustomerAdmin is false', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess({ allowCustomerAdmin: false })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants access for user with matching tenant membership', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies access when user has no tenant membership', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess()(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies access when user lacks required tenant role', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess({ roles: ['TENANT_ADMIN'] })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  requireVmfAccess                                                  */
/* ================================================================== */

describe('requireVmfAccess', () => {
  test('returns 403 when vmfId param is missing', async () => {
    const req = makeReq({
      params: {},
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 404 when VMF does not exist', async () => {
    VMF.findById.mockResolvedValue(null)

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 404 when VMF hierarchy does not match route params', async () => {
    VMF.findById.mockResolvedValue(
      makeFakeVmf({ tenantId: TENANT_ID_2 }),
    )

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants Super Admin access', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.vmf).toBeDefined()
  })

  test('grants Customer Admin access', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('grants Tenant Admin access', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('grants access when user holds the correct VMF permission', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [
          {
            customerId: CUSTOMER_ID,
            tenantId: TENANT_ID,
            vmfId: VMF_ID,
            permissions: ['READ', 'WRITE'],
          },
        ],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies access when user lacks the specific VMF permission', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [
          {
            customerId: CUSTOMER_ID,
            tenantId: TENANT_ID,
            vmfId: VMF_ID,
            permissions: ['READ'],
          },
        ],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('WRITE')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies access when user has no VMF grant at all', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies Tenant Admin when allowTenantAdmin is false', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('READ', { allowTenantAdmin: false })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  topologyGuard                                                     */
/* ================================================================== */

describe('topologyGuard', () => {
  test('returns 500 when customer context is missing', async () => {
    const req = makeReq({ scopes: {} })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(next).not.toHaveBeenCalled()
  })

  test('allows multi-tenant customer requests', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: { customer: makeFakeCustomer({ topology: 'MULTI_TENANT' }) },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('allows single-tenant request to default tenant', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {
        customer: makeFakeCustomer({
          topology: 'SINGLE_TENANT',
          defaultTenantId: { toString: () => TENANT_ID },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('blocks single-tenant request to non-default tenant', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID_2 },
      scopes: {
        customer: makeFakeCustomer({
          topology: 'SINGLE_TENANT',
          defaultTenantId: { toString: () => TENANT_ID },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(next).not.toHaveBeenCalled()
  })

  test('blocks VMF creation when SINGLE policy and VMF exists', async () => {
    VMF.countByTenant.mockResolvedValue(1)

    const req = makeReq({
      method: 'POST',
      params: { tenantId: TENANT_ID },
      baseUrl: '/api/v1/customers/123/tenants/456',
      path: '/vmfs',
      scopes: {
        customer: makeFakeCustomer({
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          defaultTenantId: { toString: () => TENANT_ID },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(next).not.toHaveBeenCalled()
  })

  test('blocks VMF creation when PER_TENANT_SINGLE policy and VMF exists', async () => {
    VMF.countByTenant.mockResolvedValue(1)

    const req = makeReq({
      method: 'POST',
      params: { tenantId: TENANT_ID },
      baseUrl: '/api/v1/tenants/456',
      path: '/vmfs/',
      scopes: {
        customer: makeFakeCustomer({
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_SINGLE',
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(next).not.toHaveBeenCalled()
  })

  test('allows VMF creation when PER_TENANT_MULTI policy', async () => {
    VMF.countByTenant.mockResolvedValue(3)

    const req = makeReq({
      method: 'POST',
      params: { tenantId: TENANT_ID },
      baseUrl: '/api/v1/tenants/456',
      path: '/vmfs',
      scopes: {
        customer: makeFakeCustomer({
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_MULTI',
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('blocks cross-tenant VMF access', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {
        customer: makeFakeCustomer({ topology: 'MULTI_TENANT' }),
        vmf: makeFakeVmf({ tenantId: TENANT_ID_2 }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(next).not.toHaveBeenCalled()
  })

  test('allows same-tenant VMF access', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {
        customer: makeFakeCustomer({ topology: 'MULTI_TENANT' }),
        vmf: makeFakeVmf({ tenantId: TENANT_ID }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(next).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  requireTenantEnabled                                              */
/* ================================================================== */

describe('requireTenantEnabled', () => {
  test('returns 404 when tenant is not found', async () => {
    Tenant.findById.mockResolvedValue(null)

    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {},
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  test('calls next() when tenant is ENABLED', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: { tenant: makeFakeTenant({ status: 'ENABLED' }) },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('returns 403 TENANT_DISABLED when tenant is DISABLED', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: { tenant: makeFakeTenant({ status: 'DISABLED' }) },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 403 TENANT_DISABLED when tenant is ARCHIVED', async () => {
    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: { tenant: makeFakeTenant({ status: 'ARCHIVED' }) },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
    expect(next).not.toHaveBeenCalled()
  })

  test('loads tenant from params when not on req.scopes', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ENABLED' }))

    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {},
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(Tenant.findById).toHaveBeenCalledWith(TENANT_ID)
    expect(next).toHaveBeenCalled()
    expect(req.scopes.tenant).toBeDefined()
  })

  test('loads tenant from params and rejects when DISABLED', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'DISABLED' }))

    const req = makeReq({
      params: { tenantId: TENANT_ID },
      scopes: {},
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantEnabled(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
    expect(next).not.toHaveBeenCalled()
  })
})
