/**
 * Auth Routes Tests
 *
 * Integration-style tests for the authentication endpoints.
 * Uses supertest against the Express app with mocked Mongoose models
 * so no real database or Redis connection is required.
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
  process.env.AUTH_RATE_LIMIT = '10000'
  process.env.AUTH_HOURLY_RATE_LIMIT = '10000'
})

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

let app
let request // supertest bound to app
let tokenService
let performanceCacheService

const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'

/**
 * Build a fake User document that behaves like a Mongoose model instance.
 */
const makeFakeUser = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  id: '507f1f77bcf86cd799439011',
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  passwordHash: '$2a$12$fakehash',
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  comparePassword: jest.fn(async (pw) => pw === 'CorrectPassword1!'),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
      vmfGrants: this.vmfGrants,
    }
  },
  ...overrides,
})

/**
 * Obtain a real accessToken by calling tokenService directly
 * (avoids consuming rate-limit quota with extra HTTP login requests).
 */
const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens
}

/* ------------------------------------------------------------------ */
/*  Dynamic imports (after env is configured)                         */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  performanceCacheService = (await import('../services/performanceCacheService.js')).default
  request = supertest(app)
})

/* ------------------------------------------------------------------ */
/*  Mock User model                                                   */
/* ------------------------------------------------------------------ */

// We cannot jest.mock() an ESM module at the top level in --experimental-vm-modules,
// so we monkey-patch the model's static methods before each test instead.

let User, Customer, LicenseLevel, Role
beforeAll(async () => {
  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  LicenseLevel = models.LicenseLevel
  Role = models.Role
})

beforeEach(() => {
  // Reset stubs
  User.findByEmail = jest.fn()
  User.findById = jest.fn()
  Customer.find = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    }),
  })
  Customer.findById = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  LicenseLevel.findById = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  Role.find = jest.fn().mockResolvedValue([
    {
      key: 'SUPER_ADMIN',
      scope: 'PLATFORM',
      permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      isActive: true,
    },
    {
      key: 'USER',
      scope: 'TENANT',
      permissions: ['VMF_VIEW'],
      isActive: true,
    },
  ])
  performanceCacheService.setUserPermissions = jest.fn(async () => {})
})

/* ================================================================== */
/*  Tests                                                             */
/* ================================================================== */

describe('POST /api/v1/auth/login', () => {
  test('returns 422 when email is missing', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ password: 'SomePassword1!' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('email')
  })

  test('returns 422 when password is missing', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('password')
  })

  test('returns 401 for unknown email', async () => {
    User.findByEmail.mockResolvedValue(null)

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'SomePassword1!' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  test('returns 401 for wrong password', async () => {
    const user = makeFakeUser()
    user.comparePassword = jest.fn(async () => false)
    User.findByEmail.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'WrongPassword!' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  test('returns 401 for disabled account', async () => {
    const user = makeFakeUser({ isActive: false })
    User.findByEmail.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_DISABLED')
  })

  test('returns 403 when all customer memberships are inactive', async () => {
    const customerUser = makeFakeUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439022', roles: ['USER'] }],
    })
    User.findByEmail.mockResolvedValue(customerUser)

    Customer.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: '607f1f77bcf86cd799439022', status: 'DISABLED' },
        ]),
      }),
    })

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('AUTH_CUSTOMER_INACTIVE')
  })

  test('returns 200 with tokens on success', async () => {
    const user = makeFakeUser()
    User.findByEmail.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeDefined()
    expect(res.body.data.refreshToken).toBeDefined()
    expect(res.body.data.tokenType).toBe('Bearer')
    expect(res.body.data.user.email).toBe('admin@storylineos.com')
    expect(res.body.data.customerScopes).toEqual([])
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: ['SUPER_ADMIN'],
        permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      },
      customers: [],
      tenants: [],
    })
    expect(performanceCacheService.setUserPermissions).toHaveBeenCalledWith(
      user._id,
      expect.objectContaining({
        resolvedPermissions: {
          platform: {
            roleKeys: ['SUPER_ADMIN'],
            permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
          },
          customers: [],
          tenants: [],
        },
      }),
    )
    expect(res.body.meta.requestId).toBeDefined()
  })

  test('returns 200 with empty resolvedPermissions when role resolution fails', async () => {
    const user = makeFakeUser()
    User.findByEmail.mockResolvedValue(user)
    Role.find.mockRejectedValue(new Error('role lookup failed'))

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [],
      tenants: [],
    })
    expect(performanceCacheService.setUserPermissions).toHaveBeenCalledWith(
      user._id,
      expect.objectContaining({
        resolvedPermissions: {
          platform: {
            roleKeys: [],
            permissions: [],
          },
          customers: [],
          tenants: [],
        },
      }),
    )
  })

  test('returns customerScopes with featureEntitlements when customer memberships exist', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439022', roles: ['USER'] }],
    })
    User.findByEmail.mockResolvedValue(user)
    Customer.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: '607f1f77bcf86cd799439022', status: 'ACTIVE' },
        ]),
      }),
    })

    Customer.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: '607f1f77bcf86cd799439022',
        licenseLevelId: '607f1f77bcf86cd799439033',
        entitlements: [],
      }),
    })
    LicenseLevel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: '607f1f77bcf86cd799439033',
        isActive: true,
        featureEntitlements: ['vmf', 'deals'],
      }),
    })

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.customerScopes).toEqual([
      {
        customerId: '607f1f77bcf86cd799439022',
        licenseLevelId: '607f1f77bcf86cd799439033',
        featureEntitlements: ['VMF', 'DEALS'],
        entitlementSource: 'LICENSE_LEVEL',
      },
    ])
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: '607f1f77bcf86cd799439022',
          roleKeys: ['USER'],
          permissions: ['VMF_VIEW'],
        },
      ],
      tenants: [],
    })
  })

  test('returns tenant-scoped resolvedPermissions when tenant memberships exist', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
      tenantMemberships: [{ customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] }],
    })
    User.findByEmail.mockResolvedValue(user)
    Customer.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: CUSTOMER_ID, status: 'ACTIVE' },
        ]),
      }),
    })
    Customer.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: CUSTOMER_ID,
        topology: 'MULTI_TENANT',
        defaultTenantId: null,
        licenseLevelId: null,
        entitlements: [],
      }),
    })

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.resolvedPermissions).toEqual({
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
      tenants: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
          roleKeys: ['USER'],
          permissions: ['VMF_VIEW'],
        },
      ],
    })
  })

  test('returns single-tenant defaultTenantId in customerScopes when available', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439022', roles: ['USER'] }],
    })
    User.findByEmail.mockResolvedValue(user)
    Customer.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: '607f1f77bcf86cd799439022', status: 'ACTIVE' },
        ]),
      }),
    })

    Customer.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: '607f1f77bcf86cd799439022',
        topology: 'SINGLE_TENANT',
        defaultTenantId: '707f1f77bcf86cd799439044',
        licenseLevelId: null,
        entitlements: [],
      }),
    })

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.customerScopes).toEqual([
      {
        customerId: '607f1f77bcf86cd799439022',
        licenseLevelId: null,
        featureEntitlements: ['VMF', 'DEALS', 'VIEWS'],
        entitlementSource: 'LEGACY_UNRESTRICTED',
        topology: 'SINGLE_TENANT',
        defaultTenantId: '707f1f77bcf86cd799439044',
      },
    ])
  })
})

/* ------------------------------------------------------------------ */

describe('POST /api/v1/auth/super-admin/login', () => {
  test('returns 403 when user lacks SUPER_ADMIN role', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: null, roles: ['USER'] }],
    })
    User.findByEmail.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/super-admin/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('AUTHZ_ROLE_REQUIRED')
  })

  test('returns 200 for a valid SUPER_ADMIN', async () => {
    const user = makeFakeUser()
    User.findByEmail.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/super-admin/login')
      .send({ email: 'admin@storylineos.com', password: 'CorrectPassword1!' })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeDefined()
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: ['SUPER_ADMIN'],
        permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      },
      customers: [],
      tenants: [],
    })
  })
})

/* ------------------------------------------------------------------ */

describe('POST /api/v1/auth/refresh', () => {
  test('returns 422 when refreshToken is missing', async () => {
    const res = await request
      .post('/api/v1/auth/refresh')
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('refreshToken')
  })

  test('returns 401 for an invalid refresh token', async () => {
    const res = await request
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'totally-invalid-token' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_REFRESH_FAILED')
  })

  test('returns 200 with new tokens for a valid refresh token', async () => {
    const user = makeFakeUser()
    const tokens = await getAccessTokenForUser(user)

    // Stub findById for the refresh flow (tokenService.refreshAccessToken calls it)
    User.findById.mockResolvedValue(user)

    const res = await request
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeDefined()
    expect(res.body.data.refreshToken).toBeDefined()
  })
})

/* ------------------------------------------------------------------ */

describe('POST /api/v1/auth/logout', () => {
  test('returns 401 without Authorization header', async () => {
    const res = await request.post('/api/v1/auth/logout')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns 200 when logged in', async () => {
    const user = makeFakeUser()
    const tokens = await getAccessTokenForUser(user)

    const res = await request
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/logged out/i)
  })
})

/* ------------------------------------------------------------------ */

describe('GET /api/v1/auth/me', () => {
  test('returns 401 without Authorization header', async () => {
    const res = await request.get('/api/v1/auth/me')

    expect(res.status).toBe(401)
  })

  test('returns 200 with user profile when authenticated', async () => {
    const user = makeFakeUser()
    const tokens = await getAccessTokenForUser(user)

    // Stub findById for /me
    User.findById.mockResolvedValue(user)

    const res = await request
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('admin@storylineos.com')
    expect(res.body.data.user.memberships).toBeDefined()
    expect(res.body.data.customerScopes).toEqual([])
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: ['SUPER_ADMIN'],
        permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      },
      customers: [],
      tenants: [],
    })
    expect(performanceCacheService.setUserPermissions).toHaveBeenCalledWith(
      user._id,
      expect.objectContaining({
        resolvedPermissions: {
          platform: {
            roleKeys: ['SUPER_ADMIN'],
            permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
          },
          customers: [],
          tenants: [],
        },
      }),
    )
    // passwordHash must never be returned
    expect(res.body.data.user.passwordHash).toBeUndefined()
  })

  test('returns customer-scoped resolvedPermissions when authenticated user has customer memberships', async () => {
    const user = makeFakeUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439022', roles: ['USER'] }],
    })
    const tokens = await getAccessTokenForUser(user)

    User.findById.mockResolvedValue(user)
    Customer.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: '607f1f77bcf86cd799439022',
        topology: 'MULTI_TENANT',
        defaultTenantId: null,
        licenseLevelId: null,
        entitlements: [],
      }),
    })

    const res = await request
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: '607f1f77bcf86cd799439022',
          roleKeys: ['USER'],
          permissions: ['VMF_VIEW'],
        },
      ],
      tenants: [],
    })
    expect(res.body.data.customerScopes).toEqual([
      {
        customerId: '607f1f77bcf86cd799439022',
        licenseLevelId: null,
        featureEntitlements: ['VMF', 'DEALS', 'VIEWS'],
        entitlementSource: 'LEGACY_UNRESTRICTED',
        topology: 'MULTI_TENANT',
      },
    ])
    expect(performanceCacheService.setUserPermissions).toHaveBeenCalledWith(
      user._id,
      expect.objectContaining({
        resolvedPermissions: {
          platform: {
            roleKeys: [],
            permissions: [],
          },
          customers: [
            {
              customerId: '607f1f77bcf86cd799439022',
              roleKeys: ['USER'],
              permissions: ['VMF_VIEW'],
            },
          ],
          tenants: [],
        },
      }),
    )
  })

  test('returns 401 when user no longer exists', async () => {
    const user = makeFakeUser()
    const tokens = await getAccessTokenForUser(user)

    // User was deleted after login
    User.findById.mockResolvedValue(null)

    const res = await request
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID')
  })
})
