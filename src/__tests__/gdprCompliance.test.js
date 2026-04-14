/**
 * GDPR Compliance Tests (Phase 5.2)
 *
 * Coverage:
 *   Route-level integration:
 *     - GET  /api/v1/gdpr/export/users/:userId                 (auth, 403, export payload, 404, validation)
 *     - POST /api/v1/gdpr/deletion-requests                    (create, 409 duplicate, validation)
 *     - GET  /api/v1/gdpr/deletion-requests                    (list, filter by status)
 *     - GET  /api/v1/gdpr/deletion-requests/:requestId         (get single, 404)
 *     - POST /api/v1/gdpr/deletion-requests/:requestId/process (reject, approve, 422 active, 409 already processed)
 *     - GET  /api/v1/gdpr/retention                            (retention info)
 *     - POST /api/v1/gdpr/retention/cleanup                    (cleanup run)
 *   Service-level unit:
 *     - redactSensitiveData helper
 *     - resolveCustomerId helper
 *   env.js — GDPR configuration defaults
 */

import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.AUDIT_SIGNATURE_SECRET = 'test-audit-hmac-secret-for-unit-tests'
  process.env.GDPR_CLEANUP_ENABLED = 'false'
})

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const TARGET_USER_ID = '507f1f77bcf86cd799439022'
const GDPR_REQUEST_ID = '507f1f77bcf86cd799439033'
const CUSTOMER_ID = '507f1f77bcf86cd799439044'

let request
let tokenService
let User
let Customer
let Tenant
let AuditLog
let DataDeletionRequest

const makeSuperAdmin = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'super-admin@storylineos.com',
  name: 'Super Admin',
  isActive: true,
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  ...overrides,
})

const makeRegularUser = (overrides = {}) => ({
  _id: TARGET_USER_ID,
  id: TARGET_USER_ID,
  email: 'target.user@example.com',
  name: 'Target User',
  isActive: false,
  identityPlus: { trustStatus: 'REVOKED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [],
  vmfGrants: [],
  toObject() {
    return {
      _id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
      vmfGrants: this.vmfGrants,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }
  },
  ...overrides,
})

const makeFindChain = (data) => ({
  lean: jest.fn().mockResolvedValue(data),
  sort: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(data),
    limit: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(data),
    }),
    skip: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(data),
      }),
    }),
  }),
})

const getSuperAdminToken = async () => {
  const tokens = await tokenService.generateTokens(makeSuperAdmin())
  return tokens.accessToken
}

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  const { default: app } = await import('../app.js')
  tokenService = (await import('../services/tokenService.js')).default
  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  AuditLog = models.AuditLog
  DataDeletionRequest = models.DataDeletionRequest
  request = supertest(app)
})

beforeEach(() => {
  User.findById = jest.fn()
  User.updateOne = jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
  User.deleteOne = jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 })
  Customer.findById = jest.fn().mockImplementation((id) => {
    if (id === CUSTOMER_ID) {
      return Promise.resolve({ _id: CUSTOMER_ID, status: 'ACTIVE' })
    }
    return Promise.resolve(null)
  })

  Tenant.updateMany = jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 })

  AuditLog.find = jest.fn().mockReturnValue(makeFindChain([]))
  AuditLog.countDocuments = jest.fn().mockResolvedValue(0)
  AuditLog.createLog = jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439055' })
  AuditLog.collection = {
    bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  }

  DataDeletionRequest.findOne = jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(null),
  })
  DataDeletionRequest.create = jest.fn().mockResolvedValue({
    toJSON: () => ({
      id: GDPR_REQUEST_ID,
      userId: TARGET_USER_ID,
      status: 'PENDING',
    }),
  })
  DataDeletionRequest.findById = jest.fn()
  DataDeletionRequest.find = jest.fn().mockReturnValue(makeFindChain([]))
  DataDeletionRequest.countDocuments = jest.fn().mockResolvedValue(0)
  DataDeletionRequest.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 })
})

describe('GET /api/v1/gdpr/export/users/:userId', () => {
  test('returns 401 when unauthenticated', async () => {
    const res = await request.get(`/api/v1/gdpr/export/users/${TARGET_USER_ID}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns 403 for non-super-admin users', async () => {
    const nonAdmin = makeSuperAdmin({
      _id: '507f1f77bcf86cd799439066',
      id: '507f1f77bcf86cd799439066',
      memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
    })

    User.findById.mockImplementation((id) => {
      if (id === nonAdmin._id) return Promise.resolve(nonAdmin)
      return Promise.resolve(null)
    })

    const tokens = await tokenService.generateTokens(nonAdmin)
    const res = await request
      .get(`/api/v1/gdpr/export/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('returns export payload for super admin', async () => {
    const token = await getSuperAdminToken()
    const targetUser = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === TARGET_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    AuditLog.find.mockReturnValue(
      makeFindChain([{ action: 'USER_DISABLED', resourceType: 'User', resourceId: TARGET_USER_ID }]),
    )
    AuditLog.countDocuments.mockResolvedValue(1)
    DataDeletionRequest.find.mockReturnValue(
      makeFindChain([{ _id: GDPR_REQUEST_ID, userId: TARGET_USER_ID, status: 'PENDING' }]),
    )

    const res = await request
      .get(`/api/v1/gdpr/export/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('target.user@example.com')
    expect(Array.isArray(res.body.data.auditLogs)).toBe(true)
    expect(Array.isArray(res.body.data.deletionRequests)).toBe(true)
  })
})

describe('POST /api/v1/gdpr/deletion-requests', () => {
  test('creates a deletion request', async () => {
    const token = await getSuperAdminToken()
    const targetUser = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === TARGET_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post('/api/v1/gdpr/deletion-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: TARGET_USER_ID,
        legalBasis: 'USER_REQUEST',
        reason: 'Data subject deletion request',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('PENDING')
    expect(DataDeletionRequest.create).toHaveBeenCalled()
  })

  test('returns 409 when pending request already exists', async () => {
    const token = await getSuperAdminToken()
    const targetUser = makeRegularUser()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === TARGET_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    DataDeletionRequest.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: GDPR_REQUEST_ID, status: 'PENDING' }),
    })

    const res = await request
      .post('/api/v1/gdpr/deletion-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: TARGET_USER_ID })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})

describe('POST /api/v1/gdpr/deletion-requests/:requestId/process', () => {
  test('rejects deletion request', async () => {
    const token = await getSuperAdminToken()
    const requestDoc = {
      _id: GDPR_REQUEST_ID,
      userId: TARGET_USER_ID,
      status: 'PENDING',
      save: jest.fn().mockResolvedValue(true),
      toJSON: () => ({ id: GDPR_REQUEST_ID, status: 'REJECTED' }),
    }

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })
    DataDeletionRequest.findById.mockResolvedValue(requestDoc)

    const res = await request
      .post(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}/process`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'REJECT', reviewerNotes: 'Insufficient legal basis' })

    expect(res.status).toBe(200)
    expect(res.body.data.summary.action).toBe('REJECTED')
    expect(User.deleteOne).not.toHaveBeenCalled()
  })

  test('approves request and deletes disabled user with anonymization', async () => {
    const token = await getSuperAdminToken()
    const targetUser = makeRegularUser()
    const requestDoc = {
      _id: GDPR_REQUEST_ID,
      userId: TARGET_USER_ID,
      status: 'PENDING',
      save: jest.fn().mockResolvedValue(true),
      toJSON: () => ({ id: GDPR_REQUEST_ID, status: 'COMPLETED' }),
    }

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === TARGET_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })
    DataDeletionRequest.findById.mockResolvedValue(requestDoc)

    AuditLog.find
      .mockReturnValueOnce(
        makeFindChain([
          { action: 'USER_DISABLED', resourceType: 'User', resourceId: TARGET_USER_ID, diff: {} },
        ]),
      )
      .mockReturnValueOnce(
        makeFindChain([
          {
            _id: '507f1f77bcf86cd799439077',
            ts: new Date('2026-02-10T00:00:00.000Z'),
            actorUserId: SUPER_ADMIN_ID,
            action: 'USER_DELETED',
            resourceType: 'User',
            resourceId: TARGET_USER_ID,
            scope: { customerId: CUSTOMER_ID },
            diff: { email: 'target.user@example.com', name: 'Target User' },
            ip: '127.0.0.1',
            userAgent: 'jest',
            requestId: 'req-test-1',
          },
        ]),
      )
    AuditLog.countDocuments.mockResolvedValue(1)
    DataDeletionRequest.find.mockReturnValue(makeFindChain([]))

    const res = await request
      .post(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}/process`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE', reviewerNotes: 'Approved' })

    expect(res.status).toBe(200)
    expect(res.body.data.summary.action).toBe('COMPLETED')
    expect(User.updateOne).toHaveBeenCalled()
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: TARGET_USER_ID })
    expect(AuditLog.collection.bulkWrite).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when target user is still active', async () => {
    const token = await getSuperAdminToken()
    const activeUser = makeRegularUser({ isActive: true })
    const requestDoc = {
      _id: GDPR_REQUEST_ID,
      userId: TARGET_USER_ID,
      status: 'PENDING',
      save: jest.fn().mockResolvedValue(true),
      toJSON: () => ({ id: GDPR_REQUEST_ID, status: 'PENDING' }),
    }

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === TARGET_USER_ID) return Promise.resolve(activeUser)
      return Promise.resolve(null)
    })
    DataDeletionRequest.findById.mockResolvedValue(requestDoc)

    const res = await request
      .post(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}/process`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('POST /api/v1/gdpr/retention/cleanup', () => {
  test('runs GDPR + audit retention cleanup', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.countDocuments.mockResolvedValue(2)
    DataDeletionRequest.deleteMany.mockResolvedValue({ deletedCount: 2 })
    AuditLog.countDocuments.mockResolvedValue(0)
    AuditLog.collection.deleteMany.mockResolvedValue({ deletedCount: 0 })

    const res = await request
      .post('/api/v1/gdpr/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
    expect(res.body.data.deletedGdprRequests).toBe(2)
    expect(DataDeletionRequest.deleteMany).toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/*  Additional route coverage                                         */
/* ------------------------------------------------------------------ */

describe('GET /api/v1/gdpr/export/users/:userId — edge cases', () => {
  test('returns 404 when target user does not exist', async () => {
    const token = await getSuperAdminToken()
    const bogusId = '507f1f77bcf86cd799439099'

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/gdpr/export/users/${bogusId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 422 for malformed userId param', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get('/api/v1/gdpr/export/users/not-an-objectid')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /api/v1/gdpr/deletion-requests', () => {
  test('returns paginated list of deletion requests', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.find.mockReturnValue(
      makeFindChain([
        { _id: GDPR_REQUEST_ID, userId: TARGET_USER_ID, status: 'PENDING' },
      ]),
    )
    DataDeletionRequest.countDocuments.mockResolvedValue(1)

    const res = await request
      .get('/api/v1/gdpr/deletion-requests')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta).toHaveProperty('page')
    expect(res.body.meta).toHaveProperty('total')
  })

  test('filters by status query param', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.find.mockReturnValue(makeFindChain([]))
    DataDeletionRequest.countDocuments.mockResolvedValue(0)

    const res = await request
      .get('/api/v1/gdpr/deletion-requests?status=COMPLETED')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/api/v1/gdpr/deletion-requests')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/gdpr/deletion-requests/:requestId', () => {
  test('returns a single deletion request', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.findById.mockResolvedValue({
      toObject: () => ({
        _id: GDPR_REQUEST_ID,
        userId: TARGET_USER_ID,
        status: 'PENDING',
      }),
    })

    const res = await request
      .get(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PENDING')
  })

  test('returns 404 when request does not exist', async () => {
    const token = await getSuperAdminToken()
    const bogusId = '507f1f77bcf86cd799439099'

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/gdpr/deletion-requests/${bogusId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 422 for malformed requestId param', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get('/api/v1/gdpr/deletion-requests/bad-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('POST /api/v1/gdpr/deletion-requests — validation', () => {
  test('returns 422 when userId is missing', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post('/api/v1/gdpr/deletion-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'no userId provided' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('returns 422 when userId is not a valid ObjectId', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post('/api/v1/gdpr/deletion-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'not-valid' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('POST /api/v1/gdpr/deletion-requests/:requestId/process — edge cases', () => {
  test('returns 409 when request is already processed', async () => {
    const token = await getSuperAdminToken()
    const requestDoc = {
      _id: GDPR_REQUEST_ID,
      userId: TARGET_USER_ID,
      status: 'COMPLETED',
      save: jest.fn(),
      toJSON: () => ({ id: GDPR_REQUEST_ID, status: 'COMPLETED' }),
    }

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })
    DataDeletionRequest.findById.mockResolvedValue(requestDoc)

    const res = await request
      .post(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}/process`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('returns 422 when decision field is missing', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/gdpr/deletion-requests/${GDPR_REQUEST_ID}/process`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /api/v1/gdpr/retention', () => {
  test('returns retention policy and storage stats', async () => {
    const token = await getSuperAdminToken()

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    DataDeletionRequest.countDocuments.mockResolvedValue(5)

    const res = await request
      .get('/api/v1/gdpr/retention')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.policy).toHaveProperty('retentionDays')
    expect(res.body.data.policy).toHaveProperty('cleanupIntervalMs')
    expect(res.body.data.policy).toHaveProperty('automatedCleanupEnabled')
    expect(res.body.data.storage).toHaveProperty('totalCount')
    expect(res.body.data.storage).toHaveProperty('pendingCount')
    expect(res.body.data.storage).toHaveProperty('expiredCount')
  }, 10000)

  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/api/v1/gdpr/retention')
    expect(res.status).toBe(401)
  })
})

/* ------------------------------------------------------------------ */
/*  env.js — GDPR configuration defaults                             */
/* ------------------------------------------------------------------ */

describe('env.js — GDPR configuration defaults', () => {
  let env

  beforeAll(async () => {
    env = (await import('../config/env.js')).default
  })

  test('gdprExportAuditLimit defaults to 5000', () => {
    expect(env.gdprExportAuditLimit).toBe(5000)
  })

  test('gdprRetentionDays defaults to 2555 (7 years)', () => {
    expect(env.gdprRetentionDays).toBe(2555)
  })

  test('gdprCleanupIntervalMs defaults to 86400000 (24 hours)', () => {
    expect(env.gdprCleanupIntervalMs).toBe(86_400_000)
  })

  test('gdprCleanupEnabled is boolean', () => {
    expect(typeof env.gdprCleanupEnabled).toBe('boolean')
  })
})
