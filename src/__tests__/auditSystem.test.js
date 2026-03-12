/**
 * Audit System Tests
 *
 * Integration-style tests for Phase 4.2 endpoints:
 *
 *   GET    /api/v1/audit-logs                                — Query audit logs
 *   GET    /api/v1/audit-logs/stats                          — Aggregate statistics
 *   GET    /api/v1/audit-logs/request/:requestId             — Correlation lookup
 *   GET    /api/v1/audit-logs/resource/:resourceType/:resourceId — Resource trail
 *   POST   /api/v1/audit-logs/verify                         — HMAC integrity check
 *   GET    /api/v1/audit-logs/retention                      — Retention info
 *   POST   /api/v1/audit-logs/retention/cleanup              — Manual cleanup
 *
 *   Validators:
 *     - queryAuditLogs / resourceAuditLogs / verifyIntegrity / auditStats / requestId
 *
 *   Service layer:
 *     - auditService.log / logFromRequest / query / getByResource /
 *       getByRequestId / verifyIntegrity / getStats
 *     - auditRetentionService.getRetentionInfo / runCleanup
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
  process.env.AUDIT_SIGNATURE_SECRET = 'test-audit-hmac-secret-for-unit-tests'
})

/* ------------------------------------------------------------------ */
/*  IDs                                                               */
/* ------------------------------------------------------------------ */

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const REGULAR_USER_ID = '507f1f77bcf86cd799439013'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const VMF_ID = '807f1f77bcf86cd799439044'
const AUDIT_LOG_ID_1 = 'a07f1f77bcf86cd799439001'
const AUDIT_LOG_ID_2 = 'a07f1f77bcf86cd799439002'
const AUDIT_LOG_ID_3 = 'a07f1f77bcf86cd799439003'
const REQUEST_ID = 'req-abc-123-def-456'

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
    }
  },
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Audit log document factory                                        */
/* ------------------------------------------------------------------ */

const makeAuditLogDoc = (overrides = {}) => ({
  _id: AUDIT_LOG_ID_1,
  ts: new Date('2025-01-15T10:00:00Z'),
  actorUserId: SUPER_ADMIN_ID,
  action: 'CUSTOMER_CREATED',
  resourceType: 'Customer',
  resourceId: CUSTOMER_ID,
  scope: { customerId: CUSTOMER_ID },
  diff: { name: 'Acme Corp' },
  ip: '127.0.0.1',
  userAgent: 'test-agent',
  requestId: REQUEST_ID,
  signature: 'fake-hmac-sig',
  verifySignature: jest.fn(() => true),
  ...overrides,
})

const makeAuditLogList = () => [
  makeAuditLogDoc({ _id: AUDIT_LOG_ID_1, action: 'CUSTOMER_CREATED', resourceType: 'Customer' }),
  makeAuditLogDoc({ _id: AUDIT_LOG_ID_2, action: 'TENANT_CREATED', resourceType: 'Tenant', resourceId: TENANT_ID }),
  makeAuditLogDoc({ _id: AUDIT_LOG_ID_3, action: 'VMF_CREATED', resourceType: 'VMF', resourceId: VMF_ID }),
]

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService
let User, Customer, AuditLog

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
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
  Customer.findById = jest.fn()
  AuditLog.createLog = jest.fn(async () => ({}))
  AuditLog.find = jest.fn()
  AuditLog.findOne = jest.fn()
  AuditLog.countDocuments = jest.fn()
  AuditLog.aggregate = jest.fn()

  // loadScopes — resolve user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
    return Promise.resolve(null)
  })

  Customer.findById.mockResolvedValue({
    _id: CUSTOMER_ID,
    id: CUSTOMER_ID,
    topology: 'MULTI_TENANT',
    vmfPolicy: 'PER_TENANT_MULTI',
    defaultTenantId: null,
    status: 'ACTIVE',
    isServiceProvider: false,
    governance: {
      maxTenants: 1,
      maxVmfsPerTenant: 1,
      customerAdminUserId: null,
    },
  })
})

/* ================================================================== */
/*  1. AUTHENTICATION & AUTHORIZATION GUARDS                          */
/* ================================================================== */

describe('Authentication & Authorization Guards', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const res = await request.get('/api/v1/audit-logs')
    expect(res.status).toBe(401)
  })

  test('rejects CUSTOMER_ADMIN with 403', async () => {
    const token = await getCustomerAdminToken()
    const res = await request
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  test('rejects regular USER with 403', async () => {
    const token = await getRegularUserToken()
    const res = await request
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  test('rejects CUSTOMER_ADMIN from /stats', async () => {
    const token = await getCustomerAdminToken()
    const res = await request
      .get('/api/v1/audit-logs/stats')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  test('rejects CUSTOMER_ADMIN from /verify', async () => {
    const token = await getCustomerAdminToken()
    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [AUDIT_LOG_ID_1] })
    expect(res.status).toBe(403)
  })

  test('rejects CUSTOMER_ADMIN from /retention', async () => {
    const token = await getCustomerAdminToken()
    const res = await request
      .get('/api/v1/audit-logs/retention')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  test('rejects CUSTOMER_ADMIN from /retention/cleanup', async () => {
    const token = await getCustomerAdminToken()
    const res = await request
      .post('/api/v1/audit-logs/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

/* ================================================================== */
/*  2. VALIDATORS                                                     */
/* ================================================================== */

describe('Validators', () => {
  /* ---- queryAuditLogs ---- */

  describe('queryAuditLogs validator', () => {
    test('accepts empty query (defaults)', async () => {
      const token = await getSuperAdminToken()

      // Stub the query chain for AuditLog.find
      AuditLog.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      AuditLog.countDocuments.mockResolvedValue(0)

      const res = await request
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(res.body.meta).toBeDefined()
      expect(res.body.meta.page).toBe(1)
      expect(res.body.meta.pageSize).toBe(50)
    })

    test('accepts valid filter parameters', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      AuditLog.countDocuments.mockResolvedValue(0)

      const res = await request
        .get('/api/v1/audit-logs')
        .query({
          customerId: CUSTOMER_ID,
          action: 'CUSTOMER_CREATED',
          resourceType: 'Customer',
          page: 2,
          pageSize: 10,
        })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(res.body.meta.page).toBe(2)
      expect(res.body.meta.pageSize).toBe(10)
    })

    test('rejects invalid ObjectId in customerId', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs')
        .query({ customerId: 'not-valid' })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('rejects invalid action enum', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs')
        .query({ action: 'INVALID_ACTION' })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('rejects invalid resourceType enum', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs')
        .query({ resourceType: 'InvalidType' })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })

    test('rejects pageSize > 200', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs')
        .query({ pageSize: 500 })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })

    test('rejects page < 1', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs')
        .query({ page: 0 })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })

    test('accepts date filters', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      AuditLog.countDocuments.mockResolvedValue(0)

      const res = await request
        .get('/api/v1/audit-logs')
        .query({
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    })
  })

  /* ---- resourceAuditLogs ---- */

  describe('resourceAuditLogs validator', () => {
    test('rejects invalid resourceType in URL', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get(`/api/v1/audit-logs/resource/BadType/${CUSTOMER_ID}`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('rejects invalid resourceId in URL', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs/resource/Customer/not-an-id')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })

    test('accepts valid resource params', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      AuditLog.countDocuments.mockResolvedValue(0)

      const res = await request
        .get(`/api/v1/audit-logs/resource/Customer/${CUSTOMER_ID}`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    })
  })

  /* ---- verifyIntegrity ---- */

  describe('verifyIntegrity validator', () => {
    test('rejects empty body (no filter)', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/audit-logs/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({})
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('rejects invalid ObjectId in ids array', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/audit-logs/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ ids: ['not-valid'] })
      expect(res.status).toBe(422)
    })

    test('accepts valid ids array', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      })

      const res = await request
        .post('/api/v1/audit-logs/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ ids: [AUDIT_LOG_ID_1, AUDIT_LOG_ID_2] })
      expect(res.status).toBe(200)
    })

    test('accepts customerId as sole filter', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      })

      const res = await request
        .post('/api/v1/audit-logs/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId: CUSTOMER_ID })
      expect(res.status).toBe(200)
    })

    test('accepts date range as filter', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      })

      const res = await request
        .post('/api/v1/audit-logs/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ startDate: '2025-01-01', endDate: '2025-12-31' })
      expect(res.status).toBe(200)
    })
  })

  /* ---- auditStats ---- */

  describe('auditStats validator', () => {
    test('accepts empty query', async () => {
      const token = await getSuperAdminToken()

      AuditLog.aggregate.mockResolvedValue([{
        byAction: [],
        byResourceType: [],
        byActor: [],
        total: [{ count: 0 }],
      }])

      const res = await request
        .get('/api/v1/audit-logs/stats')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    })

    test('rejects invalid customerId', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs/stats')
        .query({ customerId: 'bad-id' })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })
  })

  /* ---- requestId ---- */

  describe('requestId validator', () => {
    test('rejects empty requestId', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .get('/api/v1/audit-logs/request/%20')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(422)
    })

    test('accepts valid requestId', async () => {
      const token = await getSuperAdminToken()

      AuditLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      })

      const res = await request
        .get(`/api/v1/audit-logs/request/${REQUEST_ID}`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    })
  })
})

/* ================================================================== */
/*  3. QUERY AUDIT LOGS — GET /api/v1/audit-logs                      */
/* ================================================================== */

describe('GET /api/v1/audit-logs — Query', () => {
  const stubQueryChain = (docs, count) => {
    AuditLog.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(docs),
            }),
          }),
        }),
      }),
    })
    AuditLog.countDocuments.mockResolvedValue(count)
  }

  test('returns paginated results with meta', async () => {
    const token = await getSuperAdminToken()
    const docs = makeAuditLogList()
    stubQueryChain(docs, 3)

    const res = await request
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(3)
    expect(res.body.meta.totalCount).toBe(3)
    expect(res.body.meta.totalPages).toBe(1)
    expect(res.body.meta.page).toBe(1)
    expect(res.body.meta.pageSize).toBe(50)
  })

  test('returns empty array when no logs match', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta.totalCount).toBe(0)
  })

  test('respects page and pageSize params', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 25)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ page: 3, pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.page).toBe(3)
    expect(res.body.meta.pageSize).toBe(5)
    expect(res.body.meta.totalPages).toBe(5)
  })

  test('filters by customerId', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ customerId: CUSTOMER_ID })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    // Verify the filter was applied to the find call
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs['scope.customerId']).toBe(CUSTOMER_ID)
  })

  test('filters by action', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ action: 'CUSTOMER_CREATED' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.action).toBe('CUSTOMER_CREATED')
  })

  test('filters by resourceType and resourceId', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ resourceType: 'Customer', resourceId: CUSTOMER_ID })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.resourceType).toBe('Customer')
    expect(findCallArgs.resourceId).toBe(CUSTOMER_ID)
  })

  test('filters by date range', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ startDate: '2025-01-01', endDate: '2025-06-30' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.ts).toBeDefined()
    expect(findCallArgs.ts.$gte).toBeInstanceOf(Date)
    expect(findCallArgs.ts.$lte).toBeInstanceOf(Date)
  })

  test('filters by actorUserId', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ actorUserId: SUPER_ADMIN_ID })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.actorUserId).toBe(SUPER_ADMIN_ID)
  })

  test('filters by requestId', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({ requestId: REQUEST_ID })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.requestId).toBe(REQUEST_ID)
  })
})

/* ================================================================== */
/*  4. AUDIT STATS — GET /api/v1/audit-logs/stats                     */
/* ================================================================== */

describe('GET /api/v1/audit-logs/stats — Statistics', () => {
  test('returns aggregate statistics', async () => {
    const token = await getSuperAdminToken()

    AuditLog.aggregate.mockResolvedValue([{
      byAction: [
        { _id: 'CUSTOMER_CREATED', count: 10 },
        { _id: 'TENANT_CREATED', count: 5 },
      ],
      byResourceType: [
        { _id: 'Customer', count: 10 },
        { _id: 'Tenant', count: 5 },
      ],
      byActor: [
        { _id: SUPER_ADMIN_ID, count: 15 },
      ],
      total: [{ count: 15 }],
    }])

    const res = await request
      .get('/api/v1/audit-logs/stats')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(15)
    expect(res.body.data.byAction).toHaveLength(2)
    expect(res.body.data.byResourceType).toHaveLength(2)
    expect(res.body.data.topActors).toHaveLength(1)
  })

  test('returns zero stats when no logs exist', async () => {
    const token = await getSuperAdminToken()

    AuditLog.aggregate.mockResolvedValue([{
      byAction: [],
      byResourceType: [],
      byActor: [],
      total: [],
    }])

    const res = await request
      .get('/api/v1/audit-logs/stats')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(0)
    expect(res.body.data.byAction).toHaveLength(0)
  })

  test('filters stats by customerId', async () => {
    const token = await getSuperAdminToken()

    AuditLog.aggregate.mockResolvedValue([{
      byAction: [{ _id: 'CUSTOMER_CREATED', count: 3 }],
      byResourceType: [{ _id: 'Customer', count: 3 }],
      byActor: [{ _id: SUPER_ADMIN_ID, count: 3 }],
      total: [{ count: 3 }],
    }])

    const res = await request
      .get('/api/v1/audit-logs/stats')
      .query({ customerId: CUSTOMER_ID })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)

    // Verify customerId was included in the pipeline $match
    const pipeline = AuditLog.aggregate.mock.calls[0][0]
    expect(pipeline[0].$match['scope.customerId']).toBe(CUSTOMER_ID)
  })

  test('filters stats by date range', async () => {
    const token = await getSuperAdminToken()

    AuditLog.aggregate.mockResolvedValue([{
      byAction: [],
      byResourceType: [],
      byActor: [],
      total: [{ count: 0 }],
    }])

    const res = await request
      .get('/api/v1/audit-logs/stats')
      .query({ startDate: '2025-01-01', endDate: '2025-06-30' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const pipeline = AuditLog.aggregate.mock.calls[0][0]
    expect(pipeline[0].$match.ts).toBeDefined()
    expect(pipeline[0].$match.ts.$gte).toBeInstanceOf(Date)
    expect(pipeline[0].$match.ts.$lte).toBeInstanceOf(Date)
  })
})

/* ================================================================== */
/*  5. REQUEST ID LOOKUP — GET /api/v1/audit-logs/request/:requestId  */
/* ================================================================== */

describe('GET /api/v1/audit-logs/request/:requestId — Correlation', () => {
  test('returns all logs for a request ID', async () => {
    const token = await getSuperAdminToken()
    const docs = makeAuditLogList()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(docs),
      }),
    })

    const res = await request
      .get(`/api/v1/audit-logs/request/${REQUEST_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(3)
    expect(res.body.meta.totalCount).toBe(3)
  })

  test('returns empty when no logs match request ID', async () => {
    const token = await getSuperAdminToken()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    })

    const res = await request
      .get('/api/v1/audit-logs/request/nonexistent-request-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta.totalCount).toBe(0)
  })

  test('queries AuditLog with correct requestId filter', async () => {
    const token = await getSuperAdminToken()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    })

    await request
      .get(`/api/v1/audit-logs/request/${REQUEST_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(AuditLog.find).toHaveBeenCalledWith({ requestId: REQUEST_ID })
  })
})

/* ================================================================== */
/*  6. RESOURCE TRAIL — GET /…/resource/:resourceType/:resourceId     */
/* ================================================================== */

describe('GET /api/v1/audit-logs/resource/:resourceType/:resourceId — Trail', () => {
  const stubResourceChain = (docs, count) => {
    AuditLog.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(docs),
            }),
          }),
        }),
      }),
    })
    AuditLog.countDocuments.mockResolvedValue(count)
  }

  test('returns audit trail for a specific resource', async () => {
    const token = await getSuperAdminToken()
    const docs = [makeAuditLogDoc()]
    stubResourceChain(docs, 1)

    const res = await request
      .get(`/api/v1/audit-logs/resource/Customer/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.totalCount).toBe(1)
  })

  test('accepts VMF resource type', async () => {
    const token = await getSuperAdminToken()
    stubResourceChain([], 0)

    const res = await request
      .get(`/api/v1/audit-logs/resource/VMF/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('accepts Deal resource type', async () => {
    const token = await getSuperAdminToken()
    stubResourceChain([], 0)

    const res = await request
      .get(`/api/v1/audit-logs/resource/Deal/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('returns paginated results for resource trail', async () => {
    const token = await getSuperAdminToken()
    stubResourceChain([], 25)

    const res = await request
      .get(`/api/v1/audit-logs/resource/Customer/${CUSTOMER_ID}`)
      .query({ page: 2, pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.page).toBe(2)
    expect(res.body.meta.pageSize).toBe(5)
    expect(res.body.meta.totalPages).toBe(5)
  })
})

/* ================================================================== */
/*  7. INTEGRITY VERIFICATION — POST /api/v1/audit-logs/verify        */
/* ================================================================== */

describe('POST /api/v1/audit-logs/verify — Integrity', () => {
  test('verifies all signatures valid', async () => {
    const token = await getSuperAdminToken()
    const docs = makeAuditLogList()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(docs),
      }),
    })

    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [AUDIT_LOG_ID_1, AUDIT_LOG_ID_2, AUDIT_LOG_ID_3] })

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.valid).toBe(3)
    expect(res.body.data.invalid).toBe(0)
    expect(res.body.data.invalidIds).toHaveLength(0)
  })

  test('detects tampered signatures', async () => {
    const token = await getSuperAdminToken()
    const docs = [
      makeAuditLogDoc({ _id: AUDIT_LOG_ID_1, verifySignature: jest.fn(() => true) }),
      makeAuditLogDoc({ _id: AUDIT_LOG_ID_2, verifySignature: jest.fn(() => false) }),
      makeAuditLogDoc({ _id: AUDIT_LOG_ID_3, verifySignature: jest.fn(() => true) }),
    ]

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(docs),
      }),
    })

    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [AUDIT_LOG_ID_1, AUDIT_LOG_ID_2, AUDIT_LOG_ID_3] })

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.valid).toBe(2)
    expect(res.body.data.invalid).toBe(1)
    expect(res.body.data.invalidIds).toContain(AUDIT_LOG_ID_2)
  })

  test('verifies by customerId filter', async () => {
    const token = await getSuperAdminToken()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    })

    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: CUSTOMER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(0)

    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs['scope.customerId']).toBe(CUSTOMER_ID)
  })

  test('verifies by date range filter', async () => {
    const token = await getSuperAdminToken()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    })

    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2025-01-01', endDate: '2025-12-31' })

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.ts).toBeDefined()
    expect(findCallArgs.ts.$gte).toBeInstanceOf(Date)
    expect(findCallArgs.ts.$lte).toBeInstanceOf(Date)
  })

  test('handles empty result set gracefully', async () => {
    const token = await getSuperAdminToken()

    AuditLog.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    })

    const res = await request
      .post('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: CUSTOMER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      total: 0,
      valid: 0,
      invalid: 0,
      invalidIds: [],
    })
  })
})

/* ================================================================== */
/*  8. RETENTION INFO — GET /api/v1/audit-logs/retention               */
/* ================================================================== */

describe('GET /api/v1/audit-logs/retention — Info', () => {
  test('returns retention policy and storage stats', async () => {
    const token = await getSuperAdminToken()

    AuditLog.countDocuments.mockResolvedValueOnce(1000)  // totalCount
    AuditLog.countDocuments.mockResolvedValueOnce(0)     // archiveEligible
    AuditLog.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ ts: new Date('2024-01-01') }),
        }),
      }),
    })
    AuditLog.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ ts: new Date('2025-06-01') }),
        }),
      }),
    })

    const res = await request
      .get('/api/v1/audit-logs/retention')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.policy).toBeDefined()
    expect(res.body.data.policy.retentionPeriod).toBe('7 years')
    expect(res.body.data.policy.ttlIndexEnabled).toBe(true)
    expect(res.body.data.policy.ttlSeconds).toBe(220752000)
    expect(res.body.data.storage).toBeDefined()
    expect(res.body.data.storage.totalCount).toBe(1000)
    expect(res.body.data.storage.archiveEligibleCount).toBe(0)
    expect(res.body.data.storage.oldestEntry).toBeDefined()
    expect(res.body.data.storage.newestEntry).toBeDefined()
  })

  test('handles empty database', async () => {
    const token = await getSuperAdminToken()

    AuditLog.countDocuments.mockResolvedValue(0)
    AuditLog.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      }),
    })

    const res = await request
      .get('/api/v1/audit-logs/retention')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.storage.totalCount).toBe(0)
    expect(res.body.data.storage.oldestEntry).toBeNull()
    expect(res.body.data.storage.newestEntry).toBeNull()
  })
})

/* ================================================================== */
/*  9. RETENTION CLEANUP — POST /api/v1/audit-logs/retention/cleanup   */
/* ================================================================== */

describe('POST /api/v1/audit-logs/retention/cleanup — Cleanup', () => {
  test('runs cleanup and returns result', async () => {
    const token = await getSuperAdminToken()

    AuditLog.countDocuments.mockResolvedValue(0)
    AuditLog.collection = {
      deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
    }

    const res = await request
      .post('/api/v1/audit-logs/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.deletedCount).toBe(0)
  })

  test('cleanup audits itself via auditService', async () => {
    const token = await getSuperAdminToken()

    AuditLog.countDocuments.mockResolvedValue(5)
    AuditLog.collection = {
      deleteMany: jest.fn(async () => ({ deletedCount: 5 })),
    }

    const res = await request
      .post('/api/v1/audit-logs/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    // The cleanup endpoint creates an audit log of its own action
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('cleanup returns expired count and deleted count', async () => {
    const token = await getSuperAdminToken()

    AuditLog.countDocuments.mockResolvedValue(3)
    AuditLog.collection = {
      deleteMany: jest.fn(async () => ({ deletedCount: 3 })),
    }

    const res = await request
      .post('/api/v1/audit-logs/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.expiredCount).toBe(3)
    expect(res.body.data.deletedCount).toBe(3)
  })
})

/* ================================================================== */
/*  10. AUDIT SERVICE — logFromRequest (unit-style)                   */
/* ================================================================== */

describe('auditService.logFromRequest — Unit', () => {
  let auditService

  beforeAll(async () => {
    auditService = (await import('../services/auditService.js')).default
  })

  test('creates log with request context', async () => {
    const fakeReq = {
      context: { userId: SUPER_ADMIN_ID },
      ip: '10.0.0.1',
      get: jest.fn((h) => h === 'user-agent' ? 'Test/1.0' : undefined),
      requestId: 'req-unit-test',
    }

    await auditService.logFromRequest(fakeReq, {
      action: 'CUSTOMER_CREATED',
      resourceType: 'Customer',
      resourceId: CUSTOMER_ID,
      scope: { customerId: CUSTOMER_ID },
      diff: null,
    })

    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: SUPER_ADMIN_ID,
      action: 'CUSTOMER_CREATED',
      resourceType: 'Customer',
      resourceId: CUSTOMER_ID,
      ip: '10.0.0.1',
      userAgent: 'Test/1.0',
      requestId: 'req-unit-test',
    }))
  })

  test('falls back to req.userId when context is missing', async () => {
    const fakeReq = {
      userId: SUPER_ADMIN_ID,
      ip: '10.0.0.1',
      get: jest.fn(() => undefined),
      requestId: 'req-fallback',
    }

    await auditService.logFromRequest(fakeReq, {
      action: 'TENANT_CREATED',
      resourceType: 'Tenant',
      resourceId: TENANT_ID,
      scope: {},
    })

    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: SUPER_ADMIN_ID,
    }))
  })

  test('does not throw when AuditLog.createLog fails', async () => {
    AuditLog.createLog.mockRejectedValueOnce(new Error('DB down'))

    const fakeReq = {
      context: { userId: SUPER_ADMIN_ID },
      ip: '10.0.0.1',
      get: jest.fn(() => undefined),
      requestId: 'req-err',
    }

    // Should not throw
    const result = await auditService.logFromRequest(fakeReq, {
      action: 'CUSTOMER_CREATED',
      resourceType: 'Customer',
      resourceId: CUSTOMER_ID,
      scope: {},
    })

    expect(result).toBeNull()
  })

  test('allows override of actorUserId', async () => {
    const fakeReq = {
      context: { userId: SUPER_ADMIN_ID },
      ip: '10.0.0.1',
      get: jest.fn(() => undefined),
      requestId: 'req-override',
    }

    await auditService.logFromRequest(fakeReq, {
      actorUserId: REGULAR_USER_ID, // Override
      action: 'IDENTITY_PLUS_REGISTRATION_COMPLETE',
      resourceType: 'User',
      resourceId: REGULAR_USER_ID,
      scope: {},
    })

    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: REGULAR_USER_ID,
    }))
  })
})

/* ================================================================== */
/*  11. AUDIT ACTIONS & RESOURCE TYPES registries                     */
/* ================================================================== */

describe('AUDIT_ACTIONS & RESOURCE_TYPES constants', () => {
  let AUDIT_ACTIONS, RESOURCE_TYPES

  beforeAll(async () => {
    const mod = await import('../services/auditService.js')
    AUDIT_ACTIONS = mod.AUDIT_ACTIONS
    RESOURCE_TYPES = mod.RESOURCE_TYPES
  })

  test('AUDIT_ACTIONS contains required baseline actions', () => {
    expect(Object.keys(AUDIT_ACTIONS).length).toBeGreaterThanOrEqual(26)
    expect(AUDIT_ACTIONS.CUSTOMER_CREATED).toBe('CUSTOMER_CREATED')
    expect(AUDIT_ACTIONS.CUSTOMER_UPDATED).toBe('CUSTOMER_UPDATED')
    expect(AUDIT_ACTIONS.TENANT_CREATED).toBe('TENANT_CREATED')
    expect(AUDIT_ACTIONS.USER_CREATED).toBe('USER_CREATED')
    expect(AUDIT_ACTIONS.USER_ENABLED).toBe('USER_ENABLED')
    expect(AUDIT_ACTIONS.BULK_USERS_CREATED).toBe('BULK_USERS_CREATED')
    expect(AUDIT_ACTIONS.VMF_CREATED).toBe('VMF_CREATED')
    expect(AUDIT_ACTIONS.DEAL_CREATED).toBe('DEAL_CREATED')
    expect(AUDIT_ACTIONS.IDENTITY_PLUS_REGISTRATION_COMPLETE).toBe(
      'IDENTITY_PLUS_REGISTRATION_COMPLETE',
    )
  })

  test('AUDIT_ACTIONS is frozen', () => {
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true)
  })

  test('RESOURCE_TYPES contains required baseline resource types', () => {
    expect(Object.keys(RESOURCE_TYPES).length).toBeGreaterThanOrEqual(5)
    expect(RESOURCE_TYPES.Customer).toBe('Customer')
    expect(RESOURCE_TYPES.Tenant).toBe('Tenant')
    expect(RESOURCE_TYPES.User).toBe('User')
    expect(RESOURCE_TYPES.VMF).toBe('VMF')
    expect(RESOURCE_TYPES.Deal).toBe('Deal')
  })

  test('RESOURCE_TYPES is frozen', () => {
    expect(Object.isFrozen(RESOURCE_TYPES)).toBe(true)
  })

  test('all action keys match their values', () => {
    for (const [key, value] of Object.entries(AUDIT_ACTIONS)) {
      expect(key).toBe(value)
    }
  })
})

/* ================================================================== */
/*  12. COMBINED FILTERS (multi-filter)                               */
/* ================================================================== */

describe('Combined filter scenarios', () => {
  const stubQueryChain = (docs, count) => {
    AuditLog.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(docs),
            }),
          }),
        }),
      }),
    })
    AuditLog.countDocuments.mockResolvedValue(count)
  }

  test('applies customerId + action + date range together', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({
        customerId: CUSTOMER_ID,
        action: 'USER_CREATED',
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs['scope.customerId']).toBe(CUSTOMER_ID)
    expect(findCallArgs.action).toBe('USER_CREATED')
    expect(findCallArgs.ts.$gte).toBeInstanceOf(Date)
    expect(findCallArgs.ts.$lte).toBeInstanceOf(Date)
  })

  test('applies tenantId + resourceType together', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({
        tenantId: TENANT_ID,
        resourceType: 'VMF',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs['scope.tenantId']).toBe(TENANT_ID)
    expect(findCallArgs.resourceType).toBe('VMF')
  })

  test('applies actorUserId + action together', async () => {
    const token = await getSuperAdminToken()
    stubQueryChain([], 0)

    const res = await request
      .get('/api/v1/audit-logs')
      .query({
        actorUserId: SUPER_ADMIN_ID,
        action: 'DEAL_CREATED',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const findCallArgs = AuditLog.find.mock.calls[0][0]
    expect(findCallArgs.actorUserId).toBe(SUPER_ADMIN_ID)
    expect(findCallArgs.action).toBe('DEAL_CREATED')
  })
})

/* ================================================================== */
/*  13. ALL AUDIT ACTIONS accepted by validator                       */
/* ================================================================== */

describe('All published audit actions are accepted by query validator', () => {
  let allActions = []

  beforeAll(async () => {
    const mod = await import('../services/auditService.js')
    allActions = Object.values(mod.AUDIT_ACTIONS)
  })

  const stubQueryChain = () => {
    AuditLog.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    })
    AuditLog.countDocuments.mockResolvedValue(0)
  }

  test('accepts every published audit action', async () => {
    const token = await getSuperAdminToken()

    for (const action of allActions) {
      stubQueryChain()

      const res = await request
        .get('/api/v1/audit-logs')
        .query({ action })
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
    }
  })
})

/* ================================================================== */
/*  14. ALL RESOURCE TYPES accepted by validator                      */
/* ================================================================== */

describe('All 5 resource types accepted by resource validator', () => {
  const allResourceTypes = ['Customer', 'Tenant', 'User', 'VMF', 'Deal']

  const stubResourceChain = () => {
    AuditLog.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    })
    AuditLog.countDocuments.mockResolvedValue(0)
  }

  test.each(allResourceTypes)('accepts resourceType "%s"', async (resourceType) => {
    const token = await getSuperAdminToken()
    stubResourceChain()

    const res = await request
      .get(`/api/v1/audit-logs/resource/${resourceType}/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})
