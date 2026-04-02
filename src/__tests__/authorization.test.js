/**
 * Authorization Middleware Tests
 *
 * Unit-style tests for the Phase 2.2 authorization middleware:
 *   - loadScopes
 *   - authorize (requirePlatformRole, requirePlatformPermission,
 *                requireCustomerAccess, requireCustomerPermission,
 *                requireTenantAccess, requireTenantPermission,
 *                requireVmfAccess)
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
  governance: {
    maxTenants: 10,
    maxVmfsPerTenant: 10,
    customerAdminUserId: null,
  },
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

const makeFakeLicenseLevel = (overrides = {}) => ({
  _id: '907f1f77bcf86cd799439066',
  id: '907f1f77bcf86cd799439066',
  isActive: true,
  featureEntitlements: ['VMF', 'DEALS'],
  ...overrides,
})

const makeResolvedPermissions = (overrides = {}) => ({
  platform: {
    roleKeys: [],
    permissions: [],
    ...(overrides.platform || {}),
  },
  customers: overrides.customers ? [...overrides.customers] : [],
  tenants: overrides.tenants ? [...overrides.tenants] : [],
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

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getLabeledCounterValue = (metricsText, metricName, labels = []) => {
  const labelPattern = labels.length > 0
    ? labels.map((label) => `(?=.*${escapeRegex(label)})`).join('')
    : ''
  const regex = new RegExp(
    `${escapeRegex(metricName)}\\{${labelPattern}[^\\n]*\\}\\s+([0-9]+(?:\\.[0-9]+)?)`,
  )
  const match = metricsText.match(regex)
  return match ? Number.parseFloat(match[1]) : 0
}

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let User, Customer, Tenant, VMF, AuditLog, LicenseLevel, Role, monitoringService, env
let loadScopes
let requirePlatformRole
let requirePlatformPermission
let requireCustomerAccess
let requireCustomerPermission
let requireTenantAccess
let requireTenantPermission
let requireVmfAccess
let requireFeatureEntitlement
let topologyGuard
let requireTenantEnabled

beforeAll(async () => {
  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  AuditLog = models.AuditLog
  LicenseLevel = models.LicenseLevel
  Role = models.Role
  monitoringService = (await import('../services/monitoringService.js')).default
  env = (await import('../config/env.js')).default

  loadScopes = (await import('../middleware/loadScopes.js')).default
  requireFeatureEntitlement = (await import('../middleware/featureEntitlements.js')).default

  const authorize = await import('../middleware/authorize.js')
  requirePlatformRole = authorize.requirePlatformRole
  requirePlatformPermission = authorize.requirePlatformPermission
  requireCustomerAccess = authorize.requireCustomerAccess
  requireCustomerPermission = authorize.requireCustomerPermission
  requireTenantAccess = authorize.requireTenantAccess
  requireTenantPermission = authorize.requireTenantPermission
  requireVmfAccess = authorize.requireVmfAccess

  topologyGuard = (await import('../middleware/topologyGuard.js')).default
  requireTenantEnabled = (await import('../middleware/tenantStatus.js')).default
})

beforeEach(() => {
  // Reset model stubs
  User.findById = jest.fn()
  Customer.findById = jest.fn().mockResolvedValue(makeFakeCustomer())
  Tenant.findById = jest.fn()
  VMF.findById = jest.fn()
  VMF.countByTenant = jest.fn()
  LicenseLevel.findById = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(makeFakeLicenseLevel()),
  })
  Role.find = jest.fn().mockResolvedValue([
    {
      key: 'SUPER_ADMIN',
      scope: 'PLATFORM',
      permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      isActive: true,
    },
    {
      key: 'CUSTOMER_ADMIN',
      scope: 'CUSTOMER',
      permissions: ['CUSTOMER_VIEW', 'USER_VIEW'],
      isActive: true,
    },
    {
      key: 'TENANT_ADMIN',
      scope: 'TENANT',
      permissions: ['TENANT_VIEW', 'TENANT_UPDATE'],
      isActive: true,
    },
    {
      key: 'USER',
      scope: 'TENANT',
      permissions: ['VMF_VIEW'],
      isActive: true,
    },
  ])
  AuditLog.createLog = jest.fn(async () => ({}))
  monitoringService.resetForTests()
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
    expect(req.scopes.resolvedPermissions).toEqual({
      platform: {
        roleKeys: ['SUPER_ADMIN'],
        permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      },
      customers: [
        {
          customerId: CUSTOMER_ID,
          roleKeys: ['CUSTOMER_ADMIN'],
          permissions: ['CUSTOMER_VIEW', 'USER_VIEW'],
        },
      ],
      tenants: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
          roleKeys: ['TENANT_ADMIN'],
          permissions: ['TENANT_UPDATE', 'TENANT_VIEW'],
        },
      ],
    })
    expect(req.scopes.isPlatformUser).toBe(true)
    expect(req.scopes.memberships).toHaveLength(2)
    expect(req.scopes.tenantMemberships).toHaveLength(1)
    expect(req.scopes.vmfGrants).toHaveLength(1)
    expect(req.scopes.activeCustomerIds).toEqual([])
    expect(req.scopes.inactiveCustomerIds).toEqual([])
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
    expect(req.scopes.resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: CUSTOMER_ID,
          roleKeys: ['USER'],
          permissions: ['VMF_VIEW'],
        },
      ],
      tenants: [],
    })
    expect(req.scopes.isPlatformUser).toBe(false)
    expect(req.scopes.activeCustomerIds).toEqual([CUSTOMER_ID])
    expect(req.scopes.inactiveCustomerIds).toEqual([])
  })

  test('returns 403 when all customer memberships are inactive', async () => {
    User.findById.mockResolvedValue(
      makeFakeUser({
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
      }),
    )
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )

    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await loadScopes(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.inactiveCustomerIds).toEqual([CUSTOMER_ID])
    expect(res.body.error.requestId).toBe('req-test-001')
    expect(next).not.toHaveBeenCalled()

    const metrics = await monitoringService.getMetrics()
    expect(
      getLabeledCounterValue(
        metrics,
        `${env.metricsPrefix}governance_inactive_customer_blocks_total`,
        ['surface="load_scopes"'],
      ),
    ).toBeGreaterThanOrEqual(1)
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

describe('requirePlatformPermission', () => {
  test('returns 500 when scopes not loaded', () => {
    const req = makeReq()
    const res = makeRes()
    const next = jest.fn()

    requirePlatformPermission('SYSTEM_HEALTH_VIEW')(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 403 when user lacks the required platform permission', () => {
    const req = makeReq({
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          platform: {
            roleKeys: [],
            permissions: ['PLATFORM_MANAGE'],
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    requirePlatformPermission('SYSTEM_HEALTH_VIEW')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(next).not.toHaveBeenCalled()
  })

  test('calls next() when the resolved platform permission exists', () => {
    const req = makeReq({
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          platform: {
            roleKeys: [],
            permissions: ['SYSTEM_HEALTH_VIEW'],
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    requirePlatformPermission('SYSTEM_HEALTH_VIEW')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('uses active SUPER_ADMIN from resolvedPermissions as a bypass', () => {
    const req = makeReq({
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          platform: {
            roleKeys: ['SUPER_ADMIN'],
            permissions: [],
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    requirePlatformPermission('ROLE_MANAGE')(req, res, next)

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

  test('allows single-tenant customer members when explicitly enabled for the route', async () => {
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
      }),
    )

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

    await requireCustomerAccess({
      roles: ['CUSTOMER_ADMIN'],
      allowCustomerMembershipWhenSingleTenant: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess?.via).toBe('single_tenant_membership')
  })

  test('returns 403 when customer is inactive', async () => {
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )

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

    await requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.message).toBe('This customer is inactive. Contact your administrator.')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(res.body.error.requestId).toBe('req-test-001')
    expect(next).not.toHaveBeenCalled()

    const metrics = await monitoringService.getMetrics()
    expect(
      getLabeledCounterValue(
        metrics,
        `${env.metricsPrefix}governance_inactive_customer_blocks_total`,
        ['surface="require_customer_access"'],
      ),
    ).toBeGreaterThanOrEqual(1)
  })

  test('allows tenant member bypass when user has tenantMemberships for the customer', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
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

    await requireCustomerAccess({
      roles: ['CUSTOMER_ADMIN'],
      allowTenantMember: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess).toBeDefined()
    expect(req.scopes.customerAccess.via).toBe('tenant_member')
    expect(req.scopes.customerAccess.accessibleTenantIds).toEqual([TENANT_ID])
  })

  test('allows tenant member bypass even without customer membership when user has tenantMemberships', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerAccess({
      roles: ['CUSTOMER_ADMIN'],
      allowTenantMember: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess.via).toBe('tenant_member')
  })

  test('denies tenant member bypass when user has no tenantMemberships for the customer', async () => {
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

    await requireCustomerAccess({
      roles: ['CUSTOMER_ADMIN'],
      allowTenantMember: true,
    })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies tenant member bypass when allowTenantMember is not set', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
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

    await requireCustomerAccess({
      roles: ['CUSTOMER_ADMIN'],
    })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireCustomerPermission', () => {
  test('returns 403 when customerId param is missing', async () => {
    const req = makeReq({
      params: {},
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('CUSTOMER_VIEW')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants access when the customer bucket contains the required permission', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['CUSTOMER_ADMIN'],
              permissions: ['CUSTOMER_VIEW'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('CUSTOMER_VIEW')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess?.via).toBe('customer_permission')
    expect(req.scopes.customerAccess?.permission).toBe('CUSTOMER_VIEW')
  })

  test('classifies tenant-scope permissions resolved into the customer bucket as tenant access', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Role.find.mockResolvedValue([
      {
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: ['TENANT_VIEW', 'USER_VIEW_TENANT'],
        isActive: true,
      },
    ])

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['TENANT_ADMIN'],
              permissions: ['TENANT_VIEW', 'USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('TENANT_VIEW', {
      allowTenantPermission: true,
      allowCustomerScopedTenantPermission: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess).toEqual(expect.objectContaining({
      via: 'tenant_permission',
      isCustomerAdmin: false,
      isTenantAdmin: true,
      accessibleTenantIds: [TENANT_ID],
    }))
  })

  test('allows alternate tenant permission keys for customer-scoped tenant-admin exceptions', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Role.find.mockResolvedValue([
      {
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: ['USER_VIEW_TENANT'],
        isActive: true,
      },
    ])

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['TENANT_ADMIN'],
              permissions: ['USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('USER_UPDATE', {
      allowTenantPermission: true,
      tenantPermissions: ['USER_VIEW_TENANT'],
      allowCustomerScopedTenantPermission: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess).toEqual(expect.objectContaining({
      via: 'tenant_permission',
      isCustomerAdmin: false,
      isTenantAdmin: true,
      accessibleTenantIds: [TENANT_ID],
      permission: 'USER_UPDATE',
    }))
  })

  test('uses resolved SUPER_ADMIN as the only platform bypass source', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          platform: {
            roleKeys: ['SUPER_ADMIN'],
            permissions: [],
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('CUSTOMER_VIEW')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess?.isSuperAdmin).toBe(true)
    expect(req.scopes.customerAccess?.via).toBe('platform')
  })

  test('does not bypass from raw platformRoles when resolved SUPER_ADMIN is absent', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('CUSTOMER_VIEW')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('allows tenant-scoped permission fallback only when enabled', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('USER_VIEW_TENANT', { allowTenantPermission: true })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess?.via).toBe('tenant_permission')
    expect(req.scopes.customerAccess?.accessibleTenantIds).toEqual([TENANT_ID])
  })

  test('derives tenant-scoped customerAccess metadata from permitted tenant buckets only', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN', 'TENANT_ADMIN'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID_2, roles: ['TENANT_ADMIN'] },
        ],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('USER_VIEW_TENANT', { allowTenantPermission: true })(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerAccess).toEqual(expect.objectContaining({
      via: 'tenant_permission',
      isSuperAdmin: false,
      isCustomerAdmin: false,
      isTenantAdmin: true,
      tenantAdminTenantIds: [TENANT_ID],
      accessibleTenantIds: [TENANT_ID],
    }))
  })

  test('denies tenant-scoped permission fallback when not enabled', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('USER_VIEW_TENANT')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies tenant-scoped fallback when tenant-admin restriction is enabled for a non-admin actor', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['USER_VIEW_TENANT'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('USER_UPDATE', {
      allowTenantPermission: true,
      tenantPermissions: ['USER_VIEW_TENANT'],
      requireTenantAdminFallback: true,
    })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 403 when customer is inactive', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer({ status: 'DISABLED' }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['CUSTOMER_ADMIN'],
              permissions: ['CUSTOMER_VIEW'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCustomerPermission('CUSTOMER_VIEW')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(next).not.toHaveBeenCalled()
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

  test('grants TENANT_ADMIN role requirement for customer-scoped tenant admin when assigned to the tenant', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [USER_ID] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantAccess({ roles: ['TENANT_ADMIN'] })(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies TENANT_ADMIN role requirement for customer-scoped tenant admin when only linked as a user', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
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

  test('denies customer-scoped tenant admin outside associated tenant scope when no fallback ownership exists', async () => {
    Tenant.findById.mockResolvedValue(
      makeFakeTenant({
        _id: TENANT_ID_2,
        id: TENANT_ID_2,
        tenantAdminUserIds: [],
      }),
    )

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID_2 },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
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

  test('allows single-tenant customer members when explicitly enabled for the route', async () => {
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
      }),
    )
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

    await requireTenantAccess({ allowCustomerMembershipWhenSingleTenant: true })(req, res, next)

    expect(next).toHaveBeenCalled()
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

  test('returns 403 when parent customer is inactive', async () => {
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )
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

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireTenantPermission', () => {
  test('returns 403 when customerId or tenantId param is missing', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_VIEW')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('grants access when the tenant bucket contains the required permission', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['VMF_VIEW'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_VIEW')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.tenant).toBeDefined()
  })

  test('uses resolved SUPER_ADMIN as the only platform bypass source', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          platform: {
            roleKeys: ['SUPER_ADMIN'],
            permissions: [],
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', { allowCustomerPermission: true })(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('does not bypass from raw platformRoles when resolved SUPER_ADMIN is absent', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: ['SUPER_ADMIN'],
        memberships: [],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', { allowCustomerPermission: true })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('allows parent customer permission to satisfy tenant access only when explicitly enabled', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['CUSTOMER_ADMIN'],
              permissions: ['VMF_CREATE'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', { allowCustomerPermission: true })(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('filters customer permission fallback by allowed role scopes when configured', async () => {
    Role.find.mockResolvedValue([
      {
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: ['TENANT_VIEW', 'TENANT_UPDATE', 'VMF_CREATE'],
        isActive: true,
      },
    ])

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['TENANT_ADMIN'],
              permissions: ['VMF_CREATE'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', {
      allowCustomerPermission: true,
      allowCustomerPermissionScopes: ['CUSTOMER'],
    })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
    expect(Customer.findById).not.toHaveBeenCalled()
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('allows single-tenant customer fallback even when permission comes from a VMF-scoped customer role', async () => {
    Role.find.mockResolvedValue([
      {
        key: 'USER',
        scope: 'VMF',
        permissions: ['VMF_VIEW'],
        isActive: true,
      },
    ])
    Customer.findById.mockResolvedValue(makeFakeCustomer({
      topology: 'SINGLE_TENANT',
      defaultTenantId: TENANT_ID,
    }))
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['USER'],
              permissions: ['VMF_VIEW'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_VIEW', {
      allowCustomerPermission: true,
      allowCustomerPermissionScopes: ['CUSTOMER'],
      allowCustomerPermissionWhenSingleTenant: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('allows customer-scoped tenant permission for the administered tenant when enabled', async () => {
    Role.find.mockResolvedValue([
      {
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: ['TENANT_VIEW', 'TENANT_UPDATE', 'VMF_CREATE'],
        isActive: true,
      },
    ])
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [USER_ID] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['TENANT_ADMIN'],
              permissions: ['VMF_CREATE'],
            },
          ],
          tenants: [
            {
              customerId: CUSTOMER_ID,
              tenantId: TENANT_ID,
              roleKeys: ['USER'],
              permissions: ['VMF_VIEW'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', {
      allowCustomerPermission: true,
      allowCustomerPermissionScopes: ['CUSTOMER'],
      allowCustomerScopedTenantPermission: true,
    })(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies customer-scoped tenant fallback when raw memberships are stale but active resolved roles lack TENANT_ADMIN', async () => {
    Role.find.mockResolvedValue([
      {
        key: 'POWER_USER',
        scope: 'VMF',
        permissions: ['VMF_CREATE'],
        isActive: true,
      },
    ])
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [USER_ID] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'POWER_USER'] }],
        tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['POWER_USER'],
              permissions: ['VMF_CREATE'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', {
      allowCustomerPermission: true,
      allowCustomerPermissionScopes: ['CUSTOMER'],
      allowCustomerScopedTenantPermission: true,
    })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies parent customer permission fallback by default', async () => {
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['CUSTOMER_ADMIN'],
              permissions: ['VMF_CREATE'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns forbidden before resource lookups when caller lacks permission', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
    expect(Customer.findById).not.toHaveBeenCalled()
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('returns 403 when parent customer is inactive', async () => {
    Customer.findById.mockResolvedValue(makeFakeCustomer({ status: 'DISABLED' }))
    Tenant.findById.mockResolvedValue(makeFakeTenant())

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        resolvedPermissions: makeResolvedPermissions({
          customers: [
            {
              customerId: CUSTOMER_ID,
              roleKeys: ['CUSTOMER_ADMIN'],
              permissions: ['VMF_CREATE'],
            },
          ],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireTenantPermission('VMF_CREATE', { allowCustomerPermission: true })(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
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

  test('grants customer-scoped Tenant Admin access when assigned to the VMF tenant', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [USER_ID] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('WRITE')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('denies customer-scoped Tenant Admin access when only linked to the VMF tenant as a user', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('WRITE')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('denies customer-scoped Tenant Admin access outside associated tenant scope when no fallback ownership exists', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf({ tenantId: TENANT_ID_2 }))
    Tenant.findById.mockResolvedValue(
      makeFakeTenant({
        _id: TENANT_ID_2,
        id: TENANT_ID_2,
        tenantAdminUserIds: [],
      }),
    )

    const req = makeReq({
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID_2, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
        tenantMemberships: [
          { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
        ],
        vmfGrants: [],
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireVmfAccess('WRITE')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
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

  test('returns 403 when VMF customer is inactive', async () => {
    VMF.findById.mockResolvedValue(makeFakeVmf())
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ status: 'DISABLED' }),
    )

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

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.reason).toBe('CUSTOMER_INACTIVE')
    expect(res.body.error.details?.customerStatus).toBe('DISABLED')
    expect(next).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  requireFeatureEntitlement                                         */
/* ================================================================== */

describe('requireFeatureEntitlement', () => {
  test('returns 500 when scopes are missing', async () => {
    const req = makeReq({ scopes: undefined })
    const res = makeRes()
    const next = jest.fn()

    await requireFeatureEntitlement('VMF')(req, res, next)

    expect(res.statusCode).toBe(500)
    expect(res.body.error.code).toBe('SERVER_ERROR')
    expect(next).not.toHaveBeenCalled()
  })

  test('bypasses entitlement checks for SUPER_ADMIN by default', async () => {
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

    await requireFeatureEntitlement('VMF')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('grants access when customer licence includes feature', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        customer: makeFakeCustomer({ licenseLevelId: '907f1f77bcf86cd799439066', entitlements: [] }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireFeatureEntitlement('VMF')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerFeatureEntitlements).toEqual(['VMF', 'DEALS'])
    expect(req.scopes.customerEntitlementSource).toBe('LICENSE_LEVEL')
  })

  test('returns 403 when customer licence does not include feature', async () => {
    LicenseLevel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(
        makeFakeLicenseLevel({ featureEntitlements: ['VMF'] }),
      ),
    })

    const req = makeReq({
      method: 'GET',
      originalUrl: '/api/v1/vmfs/807f1f77bcf86cd799439055/deals',
      params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        customer: makeFakeCustomer({ licenseLevelId: '907f1f77bcf86cd799439066', entitlements: [] }),
        vmf: makeFakeVmf(),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireFeatureEntitlement('DEALS')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('LICENSE_FEATURE_NOT_ENABLED')
    expect(res.body.error.details.feature).toBe('DEALS')
    expect(AuditLog.createLog).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  test('falls back to legacy unrestricted feature set when no entitlements are configured', async () => {
    const req = makeReq({
      params: { customerId: CUSTOMER_ID },
      scopes: {
        platformRoles: [],
        memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
        tenantMemberships: [],
        vmfGrants: [],
        customer: makeFakeCustomer({
          licenseLevelId: null,
          entitlements: [],
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await requireFeatureEntitlement('DEALS')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.scopes.customerFeatureEntitlements).toEqual(['VMF', 'DEALS', 'VIEWS'])
    expect(req.scopes.customerEntitlementSource).toBe('LEGACY_UNRESTRICTED')
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

  test('blocks VMF creation when governance maxVmfsPerTenant limit is reached', async () => {
    VMF.countByTenant.mockResolvedValue(1)

    const req = makeReq({
      method: 'POST',
      params: { tenantId: TENANT_ID },
      baseUrl: '/api/v1/tenants/456',
      path: '/vmfs',
      scopes: {
        customer: makeFakeCustomer({
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_MULTI',
          governance: {
            maxTenants: 10,
            maxVmfsPerTenant: 1,
            customerAdminUserId: null,
          },
        }),
      },
    })
    const res = makeRes()
    const next = jest.fn()

    await topologyGuard(req, res, next)

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.limitType).toBe('MAX_VMFS_PER_TENANT')
    expect(next).not.toHaveBeenCalled()
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
