import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
process.env.REDIS_URL = 'redis://localhost:6379'

const ADMIN_ID = '507f1f77bcf86cd799439011'
const USER_ID = '507f1f77bcf86cd799439012'
const OBJECT_ID = '607f1f77bcf86cd799439010'
const REVISION_ID = '607f1f77bcf86cd799439011'
const POINTER_ID = '607f1f77bcf86cd799439012'
const REFERENCE_KEY = '11111111-1111-4111-8111-111111111111'
const REPLACEMENT_KEY = '22222222-2222-4222-8222-222222222222'
const pdf = Buffer.from('%PDF-1.4\nTEST\n%%EOF', 'ascii')

const makeUser = (id = ADMIN_ID, role = 'SUPER_ADMIN') => ({
  _id: id,
  id,
  email: `${role.toLowerCase()}@storylineos.com`,
  name: role,
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: role === 'SUPER_ADMIN' ? null : '607f1f77bcf86cd799439099', roles: [role] }],
  tenantMemberships: [],
  vmfGrants: [],
})

const uploadPayload = (buffer = pdf) => ({
  family: 'PROFESSIONAL_DOCUMENT',
  title: 'Board paper reference',
  purpose: 'Internal Development/Test comparison example',
  originalFileName: 'board-paper-reference.pdf',
  mimeType: 'application/pdf',
  contentBase64: buffer.toString('base64'),
})

const approvalPayload = () => ({
  expectedRevision: 1,
  approverName: 'Product Owner',
  approverRole: 'PRODUCT_OWNER',
  rationale: 'Approved for controlled Development/Test reference comparison.',
})

const actor = { id: ADMIN_ID, name: 'SUPER_ADMIN', email: 'super_admin@storylineos.com' }
const currentRevision = (overrides = {}) => ({
  _id: REVISION_ID,
  referenceKey: REFERENCE_KEY,
  revision: 1,
  previousRevisionId: null,
  objectId: OBJECT_ID,
  family: 'PROFESSIONAL_DOCUMENT',
  title: 'Board paper reference',
  purpose: 'Internal Development/Test comparison example',
  status: 'DRAFT',
  originalFileName: 'board-paper-reference.pdf',
  mimeType: 'application/pdf',
  extension: '.pdf',
  sha256: '65922f4121be8a0e2b5bcf92a42e5234524068fad6b09c94a9602b65fef05049',
  byteLength: pdf.length,
  storageIdentity: '33333333-3333-4333-8333-333333333333',
  productApproval: null,
  supersession: null,
  createdBy: actor,
  createdAt: new Date('2026-07-21T10:00:00.000Z'),
  ...overrides,
})

const currentPointer = (overrides = {}) => ({
  _id: POINTER_ID,
  referenceKey: REFERENCE_KEY,
  family: 'PROFESSIONAL_DOCUMENT',
  currentRevision: 1,
  currentRevisionId: REVISION_ID,
  currentStatus: 'DRAFT',
  ...overrides,
})

const storedObject = (revision = currentRevision(), overrides = {}) => ({
  _id: OBJECT_ID,
  storageIdentity: revision.storageIdentity,
  bytes: pdf,
  sha256: revision.sha256,
  byteLength: pdf.length,
  mimeType: 'application/pdf',
  extension: '.pdf',
  ...overrides,
})

const resolvedQuery = (value) => {
  const query = {
    session: jest.fn(() => Promise.resolve(value)),
    select: jest.fn(() => query),
    lean: jest.fn(() => Promise.resolve(value)),
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return query
}

let request
let tokenService
let models
let mongoose
let auditService
let session
let originalReadyState
let originalGetClient
let originalStartSession

const roles = [
  { key: 'SUPER_ADMIN', scope: 'PLATFORM', permissions: ['PLATFORM_MANAGE'], isActive: true },
  { key: 'USER', scope: 'VMF', permissions: ['VMF_VIEW'], isActive: true },
]
const roleChain = (rows) => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) })

beforeAll(async () => {
  await jest.unstable_mockModule('../config/redis.js', () => ({
    connectRedis: jest.fn(),
    getRedis: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), setex: jest.fn(), del: jest.fn() })),
    isRedisConnected: jest.fn(() => true),
    disconnectRedis: jest.fn(),
  }))
  request = (await import('supertest')).default((await import('../app.js')).default)
  tokenService = (await import('../services/tokenService.js')).default
  models = await import('../models/index.js')
  mongoose = (await import('mongoose')).default
  auditService = (await import('../services/auditService.js')).default
  originalReadyState = mongoose.connection.readyState
  originalGetClient = mongoose.connection.getClient
  originalStartSession = mongoose.startSession
})

afterAll(() => {
  mongoose.connection.readyState = originalReadyState
  mongoose.connection.getClient = originalGetClient
  mongoose.startSession = originalStartSession
})

beforeEach(() => {
  models.User.findById = jest.fn((id) => Promise.resolve(id === ADMIN_ID ? makeUser() : id === USER_ID ? makeUser(USER_ID, 'USER') : null))
  models.Role.find = jest.fn().mockReturnValue(roleChain(roles))
  models.OutcomeStudioTestReferenceObject.prototype.save = jest.fn(async function save() { return this })
  models.OutcomeStudioTestReferenceRevision.prototype.save = jest.fn(async function save() { return this })
  models.OutcomeStudioTestReferencePointer.prototype.save = jest.fn(async function save() { return this })
  models.OutcomeStudioTestReferencePointer.findOne = jest.fn().mockReturnValue(resolvedQuery(null))
  models.OutcomeStudioTestReferencePointer.findOneAndUpdate = jest.fn()
  models.OutcomeStudioTestReferencePointer.find = jest.fn().mockReturnValue(resolvedQuery([]))
  models.OutcomeStudioTestReferencePointer.countDocuments = jest.fn().mockResolvedValue(0)
  models.OutcomeStudioTestReferencePointer.exists = jest.fn().mockResolvedValue(null)
  models.OutcomeStudioTestReferenceRevision.findById = jest.fn().mockReturnValue(resolvedQuery(null))
  models.OutcomeStudioTestReferenceRevision.find = jest.fn().mockReturnValue(resolvedQuery([]))
  models.OutcomeStudioTestReferenceRevision.countDocuments = jest.fn().mockResolvedValue(0)
  models.OutcomeStudioTestReferenceObject.findOne = jest.fn().mockReturnValue(resolvedQuery(null))
  auditService.logFromRequest = jest.fn().mockResolvedValue({})
  session = {
    committed: false,
    withTransaction: jest.fn(async function withTransaction(callback) { await callback(); this.committed = true }),
    endSession: jest.fn(),
  }
  mongoose.connection.readyState = 1
  mongoose.connection.getClient = jest.fn(() => ({ topology: { description: { type: 'ReplicaSetWithPrimary' } } }))
  mongoose.startSession = jest.fn().mockResolvedValue(session)
})

const tokenFor = async (user) => (await tokenService.generateTokens(user)).accessToken

describe('Outcome Studio TEST reference administration', () => {
  test('requires authentication before parsing the large upload body', async () => {
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').send('{not-json')
    expect(response.status).toBe(401)
  })

  test('requires SUPER_ADMIN authority', async () => {
    const token = await tokenFor(makeUser(USER_ID, 'USER'))
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload())
    expect(response.status).toBe(403)
  })

  test('rejects client-owned and unknown upload fields', async () => {
    const token = await tokenFor(makeUser())
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send({ ...uploadPayload(), sha256: 'a'.repeat(64) })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_VALIDATION_FAILED')
    expect(models.OutcomeStudioTestReferenceObject.prototype.save).not.toHaveBeenCalled()
  })

  test.each([
    [{ ...uploadPayload(), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'body.mimeType'],
    [{ ...uploadPayload(), originalFileName: '../reference.pdf' }, 'body.originalFileName'],
    [{ ...uploadPayload(), originalFileName: 'bad\ud800.pdf' }, 'body.originalFileName'],
    [{ ...uploadPayload(), contentBase64: Buffer.from('not a pdf').toString('base64') }, 'body.contentBase64'],
    [{ ...uploadPayload(), contentBase64: `${uploadPayload().contentBase64}\n` }, 'body.contentBase64'],
  ])('rejects unsupported or unsafe upload input', async (payload, field) => {
    const token = await tokenFor(makeUser())
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(payload)
    expect(response.status).toBe(422)
    expect(response.body.error.details.field).toBe(field)
  })

  test('accepts a route-scoped upload larger than the global 1 MB JSON limit', async () => {
    const token = await tokenFor(makeUser())
    const largePdf = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), Buffer.alloc(1_100_000, 65), Buffer.from('\n%%EOF', 'ascii')])
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload(largePdf))
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({ revision: 1, status: 'DRAFT', byteLength: largePdf.length, mimeType: 'application/pdf', extension: '.pdf' }))
  })

  test('stores a DRAFT with server-derived integrity and transaction-bound compact audit', async () => {
    const token = await tokenFor(makeUser())
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload())
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({ family: 'PROFESSIONAL_DOCUMENT', status: 'DRAFT', productApproval: null, supersession: null }))
    expect(response.body.data).not.toHaveProperty('_id')
    expect(response.body.data).not.toHaveProperty('bytes')
    expect(response.body.data).not.toHaveProperty('contentBase64')
    expect(models.OutcomeStudioTestReferenceObject.prototype.save).toHaveBeenCalledWith({ session })
    expect(models.OutcomeStudioTestReferenceRevision.prototype.save).toHaveBeenCalledWith({ session })
    expect(models.OutcomeStudioTestReferencePointer.prototype.save).toHaveBeenCalledWith({ session })
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'OUTCOME_STUDIO_TEST_REFERENCE_UPLOADED',
      resourceType: 'OutcomeStudioTestReferenceRevision',
      diff: { before: null, after: expect.objectContaining({ status: 'DRAFT', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) },
    }), { session, throwOnError: true })
    expect(JSON.stringify(auditService.logFromRequest.mock.calls[0][1])).not.toMatch(/contentBase64|bytes|storageIdentity|rationale|originalFileName/i)
    expect(session.committed).toBe(true)
  })

  test('fails closed when transaction topology is unavailable', async () => {
    const token = await tokenFor(makeUser())
    mongoose.connection.getClient = jest.fn(() => ({ topology: { description: { type: 'Single' } } }))
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload())
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_TRANSACTION_REQUIRED')
    expect(mongoose.startSession).not.toHaveBeenCalled()
  })

  test('maps audit failure to a stable error and leaves the transaction uncommitted', async () => {
    const token = await tokenFor(makeUser())
    auditService.logFromRequest.mockRejectedValueOnce(new Error('audit failed'))
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload())
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_AUDIT_FAILED')
    expect(session.committed).toBe(false)
    expect(session.endSession).toHaveBeenCalled()
  })

  test('maps object persistence failure to a stable error and leaves the transaction uncommitted', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioTestReferenceObject.prototype.save.mockRejectedValueOnce(new Error('storage unavailable'))
    const response = await request.post('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`).send(uploadPayload())
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_PERSISTENCE_FAILED')
    expect(session.committed).toBe(false)
    expect(auditService.logFromRequest).not.toHaveBeenCalled()
  })

  test('approves a current DRAFT with separate Product and recorder attribution', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision()
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(revision))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(storedObject(revision)))
    models.OutcomeStudioTestReferencePointer.findOneAndUpdate.mockResolvedValue({ currentRevision: 2 })
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/approve`).set('Authorization', `Bearer ${token}`).send(approvalPayload())
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({ revision: 2, status: 'APPROVED' }))
    expect(response.body.data.productApproval).toEqual(expect.objectContaining({
      approverName: 'Product Owner',
      approverRole: 'PRODUCT_OWNER',
      recordedBy: expect.objectContaining({ id: ADMIN_ID, name: 'SUPER_ADMIN' }),
      recordedAt: expect.any(String),
    }))
    expect(response.body.data.productApproval).not.toHaveProperty('decisionAt')
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'OUTCOME_STUDIO_TEST_REFERENCE_APPROVED' }), { session, throwOnError: true })
  })

  test('rejects client-supplied recorder time on approval', async () => {
    const token = await tokenFor(makeUser())
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/approve`).set('Authorization', `Bearer ${token}`).send({ ...approvalPayload(), recordedAt: '2026-07-21T10:00:00.000Z' })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_VALIDATION_FAILED')
    expect(models.OutcomeStudioTestReferencePointer.findOne).not.toHaveBeenCalled()
  })

  test('rejects stale approval without loading or advancing byte custody', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer({ currentRevision: 2 })))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(currentRevision({ revision: 2 })))
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/approve`).set('Authorization', `Bearer ${token}`).send(approvalPayload())
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_REVISION_CONFLICT')
    expect(models.OutcomeStudioTestReferenceObject.findOne).not.toHaveBeenCalled()
    expect(models.OutcomeStudioTestReferencePointer.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('fails approval closed when stored bytes are missing', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(currentRevision()))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(null))
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/approve`).set('Authorization', `Bearer ${token}`).send(approvalPayload())
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_OBJECT_MISSING')
    expect(session.committed).toBe(false)
  })

  test('downloads only integrity-verified bytes with secure attachment headers', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision({ originalFileName: 'Board paper 2026.pdf' })
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(revision))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(storedObject(revision)))
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/content`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/pdf/)
    expect(response.headers['content-disposition']).toContain('attachment;')
    expect(response.headers['content-disposition']).toContain('filename="Board_paper_2026.pdf"')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(Buffer.compare(response.body, pdf)).toBe(0)
  })

  test('downloads persisted Mongoose buffer bytes when toObject converts them to BSON Binary', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision()
    const stored = storedObject(revision)
    const mongooseDocument = {
      ...stored,
      toObject: () => ({ ...stored, bytes: { _bsontype: 'Binary', buffer: stored.bytes } }),
    }
    expect(Buffer.isBuffer(mongooseDocument.bytes)).toBe(true)
    expect(Buffer.isBuffer(mongooseDocument.toObject().bytes)).toBe(false)
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(revision))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(mongooseDocument))
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/content`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(Buffer.compare(response.body, pdf)).toBe(0)
  })

  test('constructs a total secure filename for malformed legacy Unicode', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision({ originalFileName: 'bad\ud800.pdf' })
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(revision))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(storedObject(revision)))
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/content`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('filename="bad_.pdf"')
  })

  test('rejects corrupt stored bytes without content headers', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision()
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(revision))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(storedObject(revision, { bytes: Buffer.from('%PDF-1.4\nCHANGED\n%%EOF') })))
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/content`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_OBJECT_CORRUPT')
    expect(response.headers['content-disposition']).toBeUndefined()
  })

  test('supersedes an approved reference only with an approved same-family replacement', async () => {
    const token = await tokenFor(makeUser())
    const approval = { ...approvalPayload(), recordedBy: actor, recordedAt: new Date('2026-07-21T11:00:00.000Z') }
    delete approval.expectedRevision
    const source = currentRevision({ status: 'APPROVED', productApproval: approval })
    const replacement = currentRevision({
      _id: '607f1f77bcf86cd799439099',
      referenceKey: REPLACEMENT_KEY,
      objectId: '607f1f77bcf86cd799439098',
      storageIdentity: '44444444-4444-4444-8444-444444444444',
      status: 'APPROVED',
      productApproval: approval,
    })
    models.OutcomeStudioTestReferencePointer.findOne
      .mockReturnValueOnce(resolvedQuery(currentPointer({ currentStatus: 'APPROVED' })))
      .mockReturnValueOnce(resolvedQuery(currentPointer({ _id: '607f1f77bcf86cd799439097', referenceKey: REPLACEMENT_KEY, currentRevisionId: replacement._id, currentStatus: 'APPROVED' })))
    models.OutcomeStudioTestReferenceRevision.findById
      .mockReturnValueOnce(resolvedQuery(source))
      .mockReturnValueOnce(resolvedQuery(replacement))
    models.OutcomeStudioTestReferenceObject.findOne.mockReturnValue(resolvedQuery(storedObject(replacement, { _id: replacement.objectId, storageIdentity: replacement.storageIdentity })))
    models.OutcomeStudioTestReferencePointer.findOneAndUpdate.mockResolvedValue({ currentRevision: 2 })
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/supersede`).set('Authorization', `Bearer ${token}`).send({ expectedRevision: 1, replacementReferenceKey: REPLACEMENT_KEY, reason: 'A stronger approved example is now current.' })
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({ revision: 2, status: 'SUPERSEDED' }))
    expect(response.body.data.supersession).toEqual(expect.objectContaining({ replacementReferenceKey: REPLACEMENT_KEY, recordedBy: expect.objectContaining({ id: ADMIN_ID }) }))
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'OUTCOME_STUDIO_TEST_REFERENCE_SUPERSEDED' }), { session, throwOnError: true })
  })

  test('rejects a supersession replacement from a different family', async () => {
    const token = await tokenFor(makeUser())
    const approval = { approverName: 'Product Owner', approverRole: 'PRODUCT_OWNER', rationale: 'Approved.', recordedBy: actor, recordedAt: new Date() }
    const source = currentRevision({ status: 'APPROVED', productApproval: approval })
    const replacement = currentRevision({ _id: '607f1f77bcf86cd799439099', referenceKey: REPLACEMENT_KEY, family: 'PRESENTATION', status: 'APPROVED', productApproval: approval })
    models.OutcomeStudioTestReferencePointer.findOne
      .mockReturnValueOnce(resolvedQuery(currentPointer({ currentStatus: 'APPROVED' })))
      .mockReturnValueOnce(resolvedQuery(currentPointer({ _id: '607f1f77bcf86cd799439097', referenceKey: REPLACEMENT_KEY, currentRevisionId: replacement._id, family: 'PRESENTATION', currentStatus: 'APPROVED' })))
    models.OutcomeStudioTestReferenceRevision.findById
      .mockReturnValueOnce(resolvedQuery(source))
      .mockReturnValueOnce(resolvedQuery(replacement))
    const response = await request.post(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/supersede`).set('Authorization', `Bearer ${token}`).send({ expectedRevision: 1, replacementReferenceKey: REPLACEMENT_KEY, reason: 'Replace current example.' })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_TRANSITION_INVALID')
    expect(models.OutcomeStudioTestReferencePointer.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('lists current metadata without exposing byte-custody documents', async () => {
    const token = await tokenFor(makeUser())
    const revision = currentRevision()
    models.OutcomeStudioTestReferencePointer.find.mockReturnValue(resolvedQuery([{ ...currentPointer(), updatedAt: new Date() }]))
    models.OutcomeStudioTestReferencePointer.countDocuments.mockResolvedValue(1)
    models.OutcomeStudioTestReferenceRevision.find.mockReturnValue(resolvedQuery([revision]))
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references?page=1&pageSize=25').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.meta).toEqual(expect.objectContaining({ page: 1, pageSize: 25, total: 1, totalPages: 1 }))
    expect(response.body.data[0]).toEqual(expect.objectContaining({ referenceKey: REFERENCE_KEY, revision: 1, status: 'DRAFT' }))
    expect(JSON.stringify(response.body.data)).not.toMatch(/contentBase64|bytes|objectId|previousRevisionId|__v|_id/i)
  })

  test('fails current read closed when pointer and revision identity disagree', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioTestReferencePointer.findOne.mockReturnValue(resolvedQuery(currentPointer()))
    models.OutcomeStudioTestReferenceRevision.findById.mockReturnValue(resolvedQuery(currentRevision({ referenceKey: REPLACEMENT_KEY })))
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_PERSISTENCE_FAILED')
  })

  test('fails current list closed when pointer and revision state disagree', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioTestReferencePointer.find.mockReturnValue(resolvedQuery([{ ...currentPointer(), currentStatus: 'APPROVED', updatedAt: new Date() }]))
    models.OutcomeStudioTestReferencePointer.countDocuments.mockResolvedValue(1)
    models.OutcomeStudioTestReferenceRevision.find.mockReturnValue(resolvedQuery([currentRevision()]))
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_PERSISTENCE_FAILED')
  })

  test('returns immutable revision history through the same bounded DTO', async () => {
    const token = await tokenFor(makeUser())
    const draft = currentRevision()
    const approved = currentRevision({
      _id: '607f1f77bcf86cd799439013',
      revision: 2,
      status: 'APPROVED',
      productApproval: { approverName: 'Product Owner', approverRole: 'PRODUCT_OWNER', rationale: 'Approved.', recordedBy: actor, recordedAt: new Date('2026-07-21T11:00:00.000Z') },
    })
    models.OutcomeStudioTestReferencePointer.exists.mockResolvedValue({ _id: POINTER_ID })
    models.OutcomeStudioTestReferenceRevision.find.mockReturnValue(resolvedQuery([approved, draft]))
    models.OutcomeStudioTestReferenceRevision.countDocuments.mockResolvedValue(2)
    const response = await request.get(`/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/${REFERENCE_KEY}/history?page=1&pageSize=10`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.map((item) => item.revision)).toEqual([2, 1])
    expect(response.body.data[0].productApproval).toEqual(expect.objectContaining({ approverName: 'Product Owner', recordedAt: '2026-07-21T11:00:00.000Z' }))
    expect(JSON.stringify(response.body.data)).not.toMatch(/objectId|previousRevisionId|bytes|contentBase64|__v|_id/i)
  })

  test('rejects unknown list filters and invalid reference keys', async () => {
    const token = await tokenFor(makeUser())
    const list = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references?status=DRAFT').set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(422)
    const detail = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references/not-a-key').set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(422)
    const unsafePage = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/references?page=9007199254740993').set('Authorization', `Bearer ${token}`)
    expect(unsafePage.status).toBe(422)
    expect(unsafePage.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_VALIDATION_FAILED')
  })

  test('declares only query-backed indexes and immutable byte/revision fields', () => {
    const objectIndexes = models.OutcomeStudioTestReferenceObject.schema.indexes().map(([fields]) => fields)
    const revisionIndexes = models.OutcomeStudioTestReferenceRevision.schema.indexes().map(([fields]) => fields)
    const pointerIndexes = models.OutcomeStudioTestReferencePointer.schema.indexes().map(([fields]) => fields)
    expect(objectIndexes).toContainEqual({ storageIdentity: 1 })
    expect(objectIndexes).not.toContainEqual({ sha256: 1 })
    expect(revisionIndexes).toContainEqual({ referenceKey: 1, revision: 1 })
    expect(pointerIndexes).toContainEqual({ updatedAt: -1, _id: -1 })
    expect(models.OutcomeStudioTestReferenceObject.schema.path('bytes').options.immutable).toBe(true)
    expect(models.OutcomeStudioTestReferenceRevision.schema.path('status').options.immutable).toBe(true)
  })
})
