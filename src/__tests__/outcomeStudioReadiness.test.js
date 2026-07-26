import crypto from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
process.env.REDIS_URL = 'redis://localhost:6379'

const ADMIN_ID = '507f1f77bcf86cd799439011'
const USER_ID = '507f1f77bcf86cd799439012'
const makeUser = (id = ADMIN_ID, role = 'SUPER_ADMIN') => ({
  _id: id, id, email: `${role.toLowerCase()}@storylineos.com`, name: role,
  isActive: true, identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: role === 'SUPER_ADMIN' ? null : '607f1f77bcf86cd799439099', roles: [role] }],
  tenantMemberships: [], vmfGrants: [],
})

const provenanceUri = 'https://governance.storylineos.test/evidence/approval'
const referenceSha256 = 'a'.repeat(64)
const validPayload = () => ({
  expectedRevision: 0,
  references: ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'].map((family) => ({
    family, status: 'APPROVED', title: `${family} reference`, sha256: referenceSha256, provenanceUri,
  })),
  rubric: {
    status: 'APPROVED', threshold: 85, primaryReviewer: { name: 'Primary Reviewer', role: 'PRODUCT_REVIEWER' },
    provenanceUri,
  },
  providerPosture: { vendor: 'Approved vendor', model: 'Approved model', costBoundary: 'Bounded test spend', privacyPosture: 'No training or retention', dataRegion: 'UK', failurePosture: 'FAIL_CLOSED', environment: 'TEST' },
  decisions: [
    { decisionKey: 'PROVIDER_POSTURE', authorities: ['PRODUCT_OWNER', 'SECURITY', 'LEGAL', 'COMMERCIAL'].map((authority) => ({ authority, status: 'APPROVED', provenanceUri })) },
    { decisionKey: 'PROVIDER_SAFE_CONTEXT', authorities: ['ARCHITECTURE', 'SECURITY'].map((authority) => ({ authority, status: 'APPROVED', provenanceUri })) },
    { decisionKey: 'IMPLEMENTATION_TEST_ACKNOWLEDGEMENT', authorities: ['ENGINEERING', 'QA'].map((authority) => ({ authority, status: 'APPROVED', provenanceUri })) },
  ],
})

const partialPayload = () => ({
  expectedRevision: 0,
  references: ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'].map((family) => ({
    family, status: 'OPEN', title: '', sha256: '', provenanceUri: '',
  })),
  rubric: {
    status: 'OPEN', threshold: null, primaryReviewer: { name: '', role: '' }, provenanceUri: '',
  },
  providerPosture: {
    vendor: '', model: '', costBoundary: '', privacyPosture: '', dataRegion: '',
    failurePosture: 'FAIL_CLOSED', environment: 'TEST',
  },
  decisions: [
    { decisionKey: 'PROVIDER_POSTURE', authorities: ['PRODUCT_OWNER', 'SECURITY', 'LEGAL', 'COMMERCIAL'].map((authority) => ({ authority, status: 'OPEN', provenanceUri: '' })) },
    { decisionKey: 'PROVIDER_SAFE_CONTEXT', authorities: ['ARCHITECTURE', 'SECURITY'].map((authority) => ({ authority, status: 'OPEN', provenanceUri: '' })) },
    { decisionKey: 'IMPLEMENTATION_TEST_ACKNOWLEDGEMENT', authorities: ['ENGINEERING', 'QA'].map((authority) => ({ authority, status: 'OPEN', provenanceUri: '' })) },
  ],
})

let request
let tokenService
let models
let mongoose
let auditService
let validatePayload
let deriveReadiness
let serializeReadinessRevision
let authorizeLiveTest
let hashDevelopmentTestReadinessContent
let readinessConstants
let session
let originalReadyState
let originalGetClient
let originalStartSession

const roleChain = (rows) => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) })
const roles = [
  { key: 'SUPER_ADMIN', scope: 'PLATFORM', permissions: ['PLATFORM_MANAGE'], isActive: true },
  { key: 'USER', scope: 'VMF', permissions: ['VMF_VIEW'], isActive: true },
]

const currentQuery = (value) => ({ lean: jest.fn().mockResolvedValue(value) })
const sessionQuery = (value) => ({ session: jest.fn().mockResolvedValue(value) })

beforeAll(async () => {
  await jest.unstable_mockModule('../config/redis.js', () => ({
    connectRedis: jest.fn(), getRedis: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), setex: jest.fn(), del: jest.fn() })),
    isRedisConnected: jest.fn(() => true), disconnectRedis: jest.fn(),
  }))
  const supertest = (await import('supertest')).default
  const app = (await import('../app.js')).default
  request = supertest(app)
  tokenService = (await import('../services/tokenService.js')).default
  models = await import('../models/index.js')
  mongoose = (await import('mongoose')).default
  auditService = (await import('../services/auditService.js')).default
  validatePayload = (await import('../validators/outcomeStudioReadiness.validator.js')).validateOutcomeStudioReadinessPayload
  const readinessService = await import('../services/outcomeStudioReadinessService.js')
  deriveReadiness = readinessService.deriveReadiness
  serializeReadinessRevision = readinessService.serializeReadinessRevision
  authorizeLiveTest = readinessService.authorizeOutcomeStudioLiveTestExecution
  hashDevelopmentTestReadinessContent = readinessService.hashDevelopmentTestReadinessContent
  readinessConstants = await import('../constants/outcomeStudioReadiness.js')
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
  models.OutcomeStudioReadinessPointer.findOne = jest.fn().mockReturnValue(currentQuery(null))
  models.OutcomeStudioReadinessRevision.findById = jest.fn()
  models.OutcomeStudioReadinessRevision.find = jest.fn()
  models.OutcomeStudioReadinessRevision.countDocuments = jest.fn()
  models.OutcomeStudioReadinessRevision.updateOne = jest.fn()
  models.OutcomeStudioReadinessRevision.prototype.save = jest.fn(async function save() { return this })
  models.OutcomeStudioReadinessPointer.prototype.save = jest.fn(async function save() { return this })
  models.OutcomeStudioReadinessPointer.findOneAndUpdate = jest.fn()
  models.OutcomeStudioTestReferencePointer.findOne = jest.fn()
  models.OutcomeStudioTestReferenceRevision.findById = jest.fn()
  models.OutcomeStudioTestReferenceObject.findOne = jest.fn()
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

const developmentDecision = (status = 'APPROVED') => ({
  status,
  productApproverName: status === 'OPEN' ? '' : 'Product Owner',
  productApproverRole: status === 'OPEN' ? '' : 'PRODUCT_OWNER',
  rationale: status === 'OPEN' ? '' : 'Approved for bounded Development/Test provider use.',
})

const developmentPayload = (status = 'APPROVED') => ({
  expectedRevision: 0,
  rubric: {
    rubricKey: 'consultancy-quality-v1',
    rubricVersion: '1.0.0',
    threshold: 85,
    decision: developmentDecision(status),
  },
  providerPolicy: {
    providerKey: 'approved-provider',
    model: 'approved-model',
    decision: developmentDecision(status),
  },
  testingApproval: { decision: developmentDecision(status) },
})

const mockApprovedDevelopmentReferences = () => {
  const bytes = Buffer.from('%PDF-1.4\nApproved reference\n%%EOF', 'utf8')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const families = ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC']
  const records = new Map(families.map((family, index) => {
    const suffix = String(index + 1).padStart(2, '0')
    const revisionId = `607f1f77bcf86cd7994390${suffix}`
    const objectId = `707f1f77bcf86cd7994390${suffix}`
    const referenceKey = `11111111-1111-4111-8111-1111111111${suffix}`
    return [family, {
      pointer: { family, currentStatus: 'APPROVED', referenceKey, currentRevision: 2, currentRevisionId: revisionId },
      revision: {
        _id: revisionId,
        objectId,
        family,
        status: 'APPROVED',
        referenceKey,
        revision: 2,
        title: `${family} approved reference`,
        sha256,
        byteLength: bytes.length,
        mimeType: 'application/pdf',
        extension: '.pdf',
        storageIdentity: `storage-${suffix}`,
      },
      object: { _id: objectId, storageIdentity: `storage-${suffix}`, sha256, byteLength: bytes.length, mimeType: 'application/pdf', extension: '.pdf', bytes },
    }]
  }))
  models.OutcomeStudioTestReferencePointer.findOne.mockImplementation(({ family }) => ({
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockResolvedValue(records.get(family)?.pointer || null),
    then: (resolve) => resolve(records.get(family)?.pointer || null),
  }))
  models.OutcomeStudioTestReferenceRevision.findById.mockImplementation((id) => ({
    session: jest.fn().mockResolvedValue([...records.values()].find((record) => record.revision._id === String(id))?.revision || null),
    then: (resolve) => resolve([...records.values()].find((record) => record.revision._id === String(id))?.revision || null),
  }))
  models.OutcomeStudioTestReferenceObject.findOne.mockImplementation(({ _id }) => ({
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockResolvedValue([...records.values()].find((record) => record.object._id === String(_id))?.object || null),
    then: (resolve) => resolve([...records.values()].find((record) => record.object._id === String(_id))?.object || null),
  }))
  return records
}

describe('Outcome Studio readiness administration', () => {
  test('returns 401 without authentication', async () => {
    expect((await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness')).status).toBe(401)
  })

  test('returns 403 without SUPER_ADMIN authority', async () => {
    const token = await tokenFor(makeUser(USER_ID, 'USER'))
    expect((await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`)).status).toBe(403)
  })

  test('returns revision zero blocked when no current pointer exists', async () => {
    const token = await tokenFor(makeUser())
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(expect.objectContaining({
      revision: 0,
      policyVersion: 'LEGACY_SLICE_5A_V1',
      environment: 'TEST',
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      references: expect.arrayContaining([expect.objectContaining({ family: 'PROFESSIONAL_DOCUMENT', status: 'OPEN', sha256: '' })]),
      rubric: expect.objectContaining({ status: 'OPEN', threshold: null }),
      providerPosture: expect.objectContaining({ costBoundary: '', environment: 'TEST', failurePosture: 'FAIL_CLOSED' }),
      decisions: expect.arrayContaining([expect.objectContaining({ decisionKey: 'PROVIDER_POSTURE' })]),
    }))
    expect(response.body.data.providerPosture).not.toHaveProperty('costPosture')
  })

  test('fails closed when the current pointer references a missing revision', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(currentQuery({ currentRevision: 4, currentRevisionId: '607f1f77bcf86cd799439011' }))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(currentQuery(null))
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(expect.objectContaining({
      revision: 0,
      policyVersion: 'LEGACY_SLICE_5A_V1',
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: [{ code: 'CURRENT_READINESS_REVISION_MISSING', pointerRevision: 4 }],
    }))
  })

  test('projects a persisted unversioned current revision as legacy without rewriting the stored row', async () => {
    const token = await tokenFor(makeUser())
    const stored = {
      revision: 1,
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: [{ code: 'RUBRIC_NOT_APPROVED' }],
    }
    const original = structuredClone(stored)
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(currentQuery({ currentRevision: 1, currentRevisionId: '607f1f77bcf86cd799439011' }))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(currentQuery(stored))

    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ ...stored, policyVersion: 'LEGACY_SLICE_5A_V1' })
    expect(stored).toEqual(original)
  })

  test('saves an honest partial OPEN revision and derives BLOCKED', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(partialPayload())
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({
      revision: 1,
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      references: expect.arrayContaining([expect.objectContaining({ family: 'PROFESSIONAL_DOCUMENT', status: 'OPEN', title: '', sha256: '', provenanceUri: '' })]),
      rubric: expect.objectContaining({ status: 'OPEN', threshold: null, primaryReviewer: { name: '', role: '' }, provenanceUri: '' }),
      providerPosture: expect.objectContaining({ vendor: '', model: '', dataRegion: '', failurePosture: 'FAIL_CLOSED', environment: 'TEST' }),
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'REFERENCE_FAMILY_NOT_APPROVED' }),
        expect.objectContaining({ code: 'RUBRIC_NOT_APPROVED' }),
        expect.objectContaining({ code: 'RUBRIC_THRESHOLD_MISSING' }),
        expect.objectContaining({ code: 'PRIMARY_REVIEWER_MISSING' }),
        expect.objectContaining({ code: 'PROVIDER_POSTURE_INCOMPLETE' }),
        expect.objectContaining({ code: 'REQUIRED_AUTHORITY_NOT_APPROVED' }),
      ]),
    }))
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      diff: expect.objectContaining({ after: expect.objectContaining({ verdict: 'SLICE_5_APPLICATION_BLOCKED' }) }),
    }), { session, throwOnError: true })
    expect(session.committed).toBe(true)
  })

  test.each([
    ['approved reference missing title', (body) => { body.references[0].title = '' }],
    ['approved reference missing hash', (body) => { body.references[0].sha256 = '' }],
    ['approved reference missing provenance', (body) => { body.references[0].provenanceUri = '' }],
    ['approved rubric missing threshold', (body) => { body.rubric.threshold = null }],
    ['approved rubric missing reviewer', (body) => { body.rubric.primaryReviewer.name = '' }],
    ['approved rubric missing provenance', (body) => { body.rubric.provenanceUri = '' }],
    ['approved authority missing provenance', (body) => { body.decisions[0].authorities[0].provenanceUri = '' }],
  ])('rejects %s with stable 422', (_label, mutate) => {
    const body = validPayload()
    mutate(body)
    expect(() => validatePayload(body)).toThrow(expect.objectContaining({
      code: 'OUTCOME_STUDIO_READINESS_VALIDATION_FAILED',
      status: 422,
    }))
  })

  test.each([
    ['unknown nested field', (body) => { body.rubric.primaryReviewer.extra = true }],
    ['secret-like field', (body) => { body.providerPosture.credentials = 'not-allowed' }],
    ['client verdict', (body) => { body.verdict = 'SLICE_5_APPLICATION_READY' }],
    ['client policy version', (body) => { body.policyVersion = 'OES_004_DEVELOPMENT_TEST_READINESS_V1' }],
    ['unrestricted URL', (body) => { body.providerPosture.vendor = 'https://vendor.test' }],
    ['base64 bytes', (body) => { body.providerPosture.model = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=' }],
    ['client decision actor', (body) => { body.decisions[0].authorities[0].decidedBy = 'Impersonated actor' }],
    ['client decision timestamp', (body) => { body.decisions[0].authorities[0].decidedAt = '2026-07-17T10:00:00.000Z' }],
    ['client reference approver', (body) => { body.references[0].approvedBy = 'Impersonated approver' }],
    ['client reference timestamp', (body) => { body.references[0].approvedAt = '2026-07-17T10:00:00.000Z' }],
    ['client blockers', (body) => { body.blockers = [] }],
    ['client timestamp', (body) => { body.createdAt = '2026-07-17T10:00:00.000Z' }],
    ['invalid reference hash', (body) => { body.references[0].sha256 = 'ABC123' }],
    ['environment drift', (body) => { body.providerPosture.environment = 'PRODUCTION' }],
    ['non-fail-closed posture', (body) => { body.providerPosture.failurePosture = 'BEST_EFFORT' }],
    ['legacy PENDING status', (body) => { body.references[0].status = 'PENDING' }],
    ['mandatory NOT_APPLICABLE status', (body) => { body.decisions[0].authorities[0].status = 'NOT_APPLICABLE' }],
    ['legacy costPosture field', (body) => { body.providerPosture.costPosture = 'Legacy spend posture' }],
  ])('rejects %s recursively with stable 422', async (_label, mutate) => {
    const body = validPayload(); mutate(body)
    expect(() => validatePayload(body)).toThrow(expect.objectContaining({ code: 'OUTCOME_STUDIO_READINESS_VALIDATION_FAILED', status: 422 }))
  })

  test('derives READY only for the complete approved register', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    expect(deriveReadiness(content)).toEqual({ verdict: 'SLICE_5_APPLICATION_READY', blockers: [] })
  })

  test('keeps legacy and prospective policy verdict constants separate from the model enum', () => {
    expect(readinessConstants.OUTCOME_STUDIO_READINESS_POLICY_VERSIONS).toEqual({
      LEGACY: 'LEGACY_SLICE_5A_V1',
      DEVELOPMENT_TEST: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
    })
    expect(readinessConstants.OUTCOME_STUDIO_READINESS_VERDICTS).toEqual({
      READY: 'SLICE_5_APPLICATION_READY',
      BLOCKED: 'SLICE_5_APPLICATION_BLOCKED',
    })
    expect(readinessConstants.OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS).toEqual({
      READY: 'READY_FOR_TESTING',
      BLOCKED: 'BLOCKED_FOR_TESTING',
    })
    expect(models.OutcomeStudioReadinessRevision.schema.path('verdict').enumValues).toEqual([
      'SLICE_5_APPLICATION_READY',
      'SLICE_5_APPLICATION_BLOCKED',
      'READY_FOR_TESTING',
      'BLOCKED_FOR_TESTING',
    ])
    expect(models.OutcomeStudioReadinessRevision.schema.path('policyVersion').enumValues).toEqual([
      'LEGACY_SLICE_5A_V1',
      'OES_004_DEVELOPMENT_TEST_READINESS_V1',
    ])
    expect(models.OutcomeStudioReadinessRevision.schema.path('policyVersion').defaultValue).toBeUndefined()
  })

  test.each([
    ['missing', {}],
    ['null', { policyVersion: null }],
    ['whitespace', { policyVersion: '   ' }],
  ])('projects %s policy identity as legacy without mutating the source', (_label, policy) => {
    const source = {
      revision: 1,
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: [{ code: 'RUBRIC_NOT_APPROVED' }],
      ...policy,
    }
    const original = structuredClone(source)
    expect(serializeReadinessRevision(source)).toEqual({
      ...source,
      policyVersion: 'LEGACY_SLICE_5A_V1',
    })
    expect(source).toEqual(original)
  })

  test('preserves the recognized Development/Test policy and prospective verdict in a future read DTO', () => {
    const source = {
      revision: 2,
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      verdict: 'BLOCKED_FOR_TESTING',
      blockers: [{ code: 'PRODUCT_TESTING_APPROVAL_REQUIRED' }],
    }
    expect(serializeReadinessRevision(source)).toEqual(expect.objectContaining(source))
  })

  test('creates a READY Development/Test revision from exactly four governed gates', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    mockApprovedDevelopmentReferences()

    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      revision: 1,
      environment: 'TEST',
      verdict: 'READY_FOR_TESTING',
      blockers: [],
      gateResults: [
        { gate: 'QUALITY_RUBRIC', status: 'PASSED', blockerCode: null, details: null },
        { gate: 'TEST_REFERENCE_EXAMPLES', status: 'PASSED', blockerCode: null, details: null },
        { gate: 'SAFE_PROVIDER_POLICY', status: 'PASSED', blockerCode: null, details: null },
        { gate: 'PRODUCT_TESTING_APPROVAL', status: 'PASSED', blockerCode: null, details: null },
      ],
      providerPolicy: expect.objectContaining({
        providerKey: 'approved-provider',
        model: 'approved-model',
        environment: 'TEST',
        safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
        failurePosture: 'FAIL_CLOSED',
      }),
      testingApproval: expect.objectContaining({ purpose: 'CONTROLLED_TEST_ENGINEERING_VALIDATION' }),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(response.body.data.testReferences).toHaveLength(3)
    expect(response.body.data).not.toHaveProperty('references')
    expect(response.body.data.testReferences[0]).not.toHaveProperty('sha256')
    expect(models.OutcomeStudioReadinessRevision.prototype.save).toHaveBeenCalledWith({ session })
    expect(models.OutcomeStudioReadinessPointer.prototype.save).toHaveBeenCalledWith({ session })
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      diff: {
        componentId: 'outcome-studio-readiness-administration',
        before: {
          policyVersion: null,
          revision: 0,
          verdict: 'SLICE_5_APPLICATION_BLOCKED',
          blockerCodes: ['READINESS_REVISION_MISSING'],
          evidence: null,
        },
        after: expect.objectContaining({
          policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
          revision: 1,
          verdict: 'READY_FOR_TESTING',
          blockerCodes: [],
          evidence: { developmentTest: expect.any(Object) },
        }),
      },
    }), { session, throwOnError: true })
    expect(session.committed).toBe(true)
  })

  test.each([
    ['session creation failure', () => { mongoose.startSession = jest.fn().mockRejectedValue(new Error('sessions unavailable')) }],
    ['missing transaction method', () => { mongoose.startSession = jest.fn().mockResolvedValue({ endSession: jest.fn() }) }],
    ['missing session close method', () => { mongoose.startSession = jest.fn().mockResolvedValue({ withTransaction: jest.fn() }) }],
  ])('maps %s to the exact transaction-required failure without writes', async (_label, arrange) => {
    const token = await tokenFor(makeUser())
    arrange()
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_TRANSACTION_REQUIRED')
    expect(models.OutcomeStudioReadinessRevision.prototype.save).not.toHaveBeenCalled()
    expect(auditService.logFromRequest).not.toHaveBeenCalled()
  })

  test('rejects Development/Test writes when the connected topology cannot provide transactions', async () => {
    const token = await tokenFor(makeUser())
    mongoose.connection.getClient = jest.fn(() => ({ topology: { description: { type: 'Standalone' } } }))
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_TRANSACTION_REQUIRED')
    expect(mongoose.startSession).not.toHaveBeenCalled()
  })

  test('maps an operational TEST-reference resolver failure without persisting a blocked revision', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    models.OutcomeStudioTestReferencePointer.findOne.mockImplementation(() => { throw new Error('reference store unavailable') })
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_TEST_REFERENCE_RESOLUTION_FAILED')
    expect(models.OutcomeStudioReadinessRevision.prototype.save).not.toHaveBeenCalled()
    expect(auditService.logFromRequest).not.toHaveBeenCalled()
    expect(session.committed).toBe(false)
  })

  test('persists an honest blocked revision for a corrupt selected TEST reference', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    const records = mockApprovedDevelopmentReferences()
    records.get('PROFESSIONAL_DOCUMENT').pointer.currentRevision = 99
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())
    expect(response.status).toBe(201)
    expect(response.body.data.verdict).toBe('BLOCKED_FOR_TESTING')
    expect(response.body.data.blockers).toEqual([expect.objectContaining({
      code: 'TEST_REFERENCE_EXAMPLES_BLOCKED',
      details: { missingOrInvalidFamilies: ['PROFESSIONAL_DOCUMENT'] },
    })])
    expect(models.OutcomeStudioReadinessRevision.prototype.save).toHaveBeenCalledWith({ session })
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session, throwOnError: true })
    expect(session.committed).toBe(true)
  })

  test('fails a Development/Test mutation closed when its governed audit cannot persist', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    mockApprovedDevelopmentReferences()
    auditService.logFromRequest.mockRejectedValueOnce(new Error('audit write failed'))
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_AUDIT_FAILED')
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session, throwOnError: true })
    expect(session.committed).toBe(false)
    expect(session.endSession).toHaveBeenCalled()
  })

  test('hashes only canonical Development/Test evidence including complete decision recorder attribution', () => {
    const recordedDecision = {
      ...developmentDecision(),
      recordedBy: {
        id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        name: 'Product Recorder',
        email: 'product.recorder@example.test',
      },
      recordedAt: new Date('2026-07-21T10:30:00.000Z'),
    }
    const content = {
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      environment: 'TEST',
      rubric: { ...developmentPayload().rubric, decision: recordedDecision },
      testReferences: [{ family: 'PROFESSIONAL_DOCUMENT', referenceKey: '11111111-1111-4111-8111-111111111111', referenceRevision: 1 }],
      providerPolicy: { ...developmentPayload().providerPolicy, decision: recordedDecision },
      testingApproval: { decision: recordedDecision },
    }
    const reordered = {
      testingApproval: content.testingApproval,
      providerPolicy: content.providerPolicy,
      testReferences: content.testReferences,
      rubric: content.rubric,
      environment: content.environment,
      policyVersion: content.policyVersion,
    }
    expect(hashDevelopmentTestReadinessContent(reordered)).toBe(hashDevelopmentTestReadinessContent(content))
    expect(hashDevelopmentTestReadinessContent({
      ...content,
      testReferences: [{ ...content.testReferences[0], referenceRevision: 2 }],
    })).not.toBe(hashDevelopmentTestReadinessContent(content))
    for (const mutate of [
      (decision) => { decision.recordedBy.id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012') },
      (decision) => { decision.recordedBy.name = 'Different Recorder' },
      (decision) => { decision.recordedBy.email = 'different.recorder@example.test' },
      (decision) => { decision.recordedAt = new Date('2026-07-21T10:31:00.000Z') },
    ]) {
      const changed = structuredClone(content)
      changed.rubric.decision.recordedBy.id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011')
      changed.rubric.decision.recordedAt = new Date('2026-07-21T10:30:00.000Z')
      mutate(changed.rubric.decision)
      expect(hashDevelopmentTestReadinessContent(changed)).not.toBe(hashDevelopmentTestReadinessContent(content))
    }
    expect(hashDevelopmentTestReadinessContent({
      ...content,
      _id: new mongoose.Types.ObjectId('607f1f77bcf86cd799439011'),
      revision: 9,
      verdict: 'BLOCKED_FOR_TESTING',
      blockers: [{ code: 'SHOULD_NOT_BE_HASHED' }],
      gateResults: [{ gate: 'SHOULD_NOT_BE_HASHED' }],
      contentHash: 'f'.repeat(64),
      createdBy: new mongoose.Types.ObjectId('707f1f77bcf86cd799439011'),
      createdAt: new Date('2026-07-21T11:00:00.000Z'),
    })).toBe(hashDevelopmentTestReadinessContent(content))
  })

  test('retains the exact approved-family query index required by deterministic reference resolution', () => {
    const indexes = models.OutcomeStudioTestReferencePointer.schema.indexes()
    expect(indexes).toContainEqual([
      { family: 1, currentStatus: 1, updatedAt: -1, _id: -1 },
      { name: 'outcome_studio_test_reference_family_approved_current', background: true },
    ])
  })

  test('persists an honest BLOCKED Development/Test revision when reference families are missing', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    models.OutcomeStudioTestReferencePointer.findOne.mockImplementation(() => ({
      sort: jest.fn().mockReturnThis(),
      session: jest.fn().mockResolvedValue(null),
    }))

    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(developmentPayload())

    expect(response.status).toBe(201)
    expect(response.body.data.verdict).toBe('BLOCKED_FOR_TESTING')
    expect(response.body.data.gateResults).toEqual([
      { gate: 'QUALITY_RUBRIC', status: 'PASSED', blockerCode: null, details: null },
      {
        gate: 'TEST_REFERENCE_EXAMPLES',
        status: 'BLOCKED',
        blockerCode: 'TEST_REFERENCE_EXAMPLES_BLOCKED',
        details: { missingOrInvalidFamilies: ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'] },
      },
      { gate: 'SAFE_PROVIDER_POLICY', status: 'PASSED', blockerCode: null, details: null },
      { gate: 'PRODUCT_TESTING_APPROVAL', status: 'PASSED', blockerCode: null, details: null },
    ])
    expect(response.body.data.blockers).toEqual([{
      code: 'TEST_REFERENCE_EXAMPLES_BLOCKED',
      gate: 'TEST_REFERENCE_EXAMPLES',
      details: { missingOrInvalidFamilies: ['PROFESSIONAL_DOCUMENT', 'PRESENTATION', 'INFOGRAPHIC'] },
    }])
    expect(session.committed).toBe(true)
  })

  test('rejects server-owned Development/Test readiness fields before persistence', async () => {
    const token = await tokenFor(makeUser())
    const body = developmentPayload()
    body.providerPolicy.environment = 'TEST'
    const response = await request
      .put('/api/v1/super-admin/runtime-control/outcome-studio-readiness/development-test')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
    expect(response.status).toBe(422)
    expect(response.body.error).toEqual(expect.objectContaining({
      code: 'OUTCOME_STUDIO_READINESS_VALIDATION_FAILED',
      details: { path: 'body.providerPolicy.environment' },
    }))
    expect(models.OutcomeStudioReadinessRevision.prototype.save).not.toHaveBeenCalled()
    expect(auditService.logFromRequest).not.toHaveBeenCalled()
  })

  test('blocks the legacy mutation route after the shared pointer transitions to Development/Test policy', async () => {
    const token = await tokenFor(makeUser())
    const previous = { _id: '607f1f77bcf86cd799439088', policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1', revision: 1, verdict: 'BLOCKED_FOR_TESTING' }
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery({ _id: '607f1f77bcf86cd799439011', currentRevision: 1, currentRevisionId: previous._id }))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(sessionQuery(previous))
    const body = validPayload()
    body.expectedRevision = 1
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_POLICY_TRANSITION_INVALID')
    expect(models.OutcomeStudioReadinessRevision.prototype.save).not.toHaveBeenCalled()
    expect(auditService.logFromRequest).not.toHaveBeenCalled()
  })

  test('authorizes only the current provider authority with unchanged authoritative reference snapshots', async () => {
    const records = mockApprovedDevelopmentReferences()
    const providerDescriptor = {
      providerKey: 'approved-provider',
      model: 'approved-model',
      providerMode: 'LIVE_TEST',
      environment: 'TEST',
      safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
      failurePosture: 'FAIL_CLOSED',
    }
    const revision = {
      _id: '607f1f77bcf86cd799439088',
      registerId: 'oes-004-r2-slice-5-application-readiness-test',
      environment: 'TEST',
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      revision: 4,
      verdict: 'READY_FOR_TESTING',
      blockers: [],
      providerPolicy: providerDescriptor,
      testReferences: [...records.values()].map(({ revision: reference }) => ({
        family: reference.family,
        referenceKey: reference.referenceKey,
        referenceRevision: reference.revision,
        sha256: reference.sha256,
        byteLength: reference.byteLength,
        mimeType: reference.mimeType,
      })),
    }
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(currentQuery({ currentRevision: 4, currentRevisionId: revision._id }))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(currentQuery(revision))

    await expect(authorizeLiveTest({ providerDescriptor, stage: 'PRE_ADAPTER' })).resolves.toEqual({
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      revision: 4,
      verdict: 'READY_FOR_TESTING',
      providerAuthority: providerDescriptor,
      referenceSnapshots: revision.testReferences,
    })

    revision.testReferences[0] = { ...revision.testReferences[0], referenceRevision: 1 }
    await expect(authorizeLiveTest({ providerDescriptor, stage: 'PRE_ADAPTER' })).rejects.toMatchObject({
      status: 409,
      code: 'GRR_LIVE_TEST_READINESS_BLOCKED',
      details: expect.objectContaining({ reason: 'DEVELOPMENT_TEST_READINESS_BLOCKED' }),
    })
  })

  test('blocks authorization when the current pointer and targeted revision identity disagree', async () => {
    const providerDescriptor = {
      providerKey: 'approved-provider',
      model: 'approved-model',
      providerMode: 'LIVE_TEST',
      environment: 'TEST',
      safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
      failurePosture: 'FAIL_CLOSED',
    }
    const revision = {
      _id: '607f1f77bcf86cd799439088',
      registerId: 'oes-004-r2-slice-5-application-readiness-test',
      environment: 'TEST',
      policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1',
      revision: 4,
      verdict: 'READY_FOR_TESTING',
      blockers: [],
      providerPolicy: providerDescriptor,
      testReferences: [],
    }
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(currentQuery({ currentRevision: 5, currentRevisionId: revision._id }))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(currentQuery(revision))

    await expect(authorizeLiveTest({ providerDescriptor, stage: 'PRE_ADAPTER' })).rejects.toMatchObject({
      status: 409,
      code: 'GRR_LIVE_TEST_READINESS_BLOCKED',
      details: expect.objectContaining({ reason: 'DEVELOPMENT_TEST_READINESS_BLOCKED' }),
    })
    expect(models.OutcomeStudioTestReferencePointer.findOne).not.toHaveBeenCalled()
  })

  test('fails closed for an unsupported explicit stored policy identity', () => {
    expect(() => serializeReadinessRevision({ revision: 2, policyVersion: 'UNKNOWN_POLICY' })).toThrow(expect.objectContaining({
      code: 'OUTCOME_STUDIO_READINESS_POLICY_UNSUPPORTED',
      status: 500,
    }))
  })

  test('derivation requires provider costBoundary', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    content.providerPosture.costBoundary = ''
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_POSTURE_INCOMPLETE' })]),
    }))
  })

  test.each([
    ['missing title', (content) => { content.references[0].title = '' }],
    ['malformed hash', (content) => { content.references[0].sha256 = 'ABC123' }],
    ['non-HTTPS provenance', (content) => { content.references[0].provenanceUri = 'http://governance.storylineos.test/reference' }],
    ['unparseable provenance', (content) => { content.references[0].provenanceUri = 'https://' }],
  ])('derivation blocks approved reference with %s', (_label, mutate) => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    mutate(content)
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'REFERENCE_EVIDENCE_INCOMPLETE',
        family: 'PROFESSIONAL_DOCUMENT',
      })]),
    }))
  })

  test('derivation blocks a valid approved reference followed by a malformed duplicate', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    content.references.push({
      ...content.references[0],
      sha256: 'malformed-duplicate-hash',
      provenanceUri: 'http://governance.storylineos.test/duplicate-reference',
    })
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'REFERENCE_FAMILY_DUPLICATE', family: 'PROFESSIONAL_DOCUMENT' }),
        expect.objectContaining({ code: 'REFERENCE_EVIDENCE_INCOMPLETE', family: 'PROFESSIONAL_DOCUMENT' }),
      ]),
    }))
  })

  test.each([
    ['out-of-range threshold', (content) => { content.rubric.threshold = 101 }, 'RUBRIC_THRESHOLD_MISSING'],
    ['missing reviewer name', (content) => { content.rubric.primaryReviewer.name = ' ' }, 'PRIMARY_REVIEWER_MISSING'],
    ['non-HTTPS provenance', (content) => { content.rubric.provenanceUri = 'http://governance.storylineos.test/rubric' }, 'RUBRIC_PROVENANCE_INVALID'],
    ['unparseable provenance', (content) => { content.rubric.provenanceUri = 'https://' }, 'RUBRIC_PROVENANCE_INVALID'],
  ])('derivation blocks approved rubric with %s', (_label, mutate, code) => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    mutate(content)
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([expect.objectContaining({ code })]),
    }))
  })

  test.each(['', 'http://governance.storylineos.test/authority', 'https://'])('derivation blocks approved authority with invalid provenance %s', (provenance) => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    content.decisions[0].authorities[0].provenanceUri = provenance
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'AUTHORITY_PROVENANCE_INVALID',
        decisionKey: 'PROVIDER_POSTURE',
        authority: 'PRODUCT_OWNER',
      })]),
    }))
  })

  test('derivation blocks a valid approved authority followed by a malformed duplicate', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    content.decisions[0].authorities.push({
      ...content.decisions[0].authorities[0],
      provenanceUri: 'http://governance.storylineos.test/duplicate-authority',
    })
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'AUTHORITY_ENTRY_DUPLICATE', decisionKey: 'PROVIDER_POSTURE', authority: 'PRODUCT_OWNER' }),
        expect.objectContaining({ code: 'AUTHORITY_PROVENANCE_INVALID', decisionKey: 'PROVIDER_POSTURE', authority: 'PRODUCT_OWNER' }),
      ]),
    }))
  })

  test('derivation blocks a valid decision followed by a duplicate with malformed approved authority evidence', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    const duplicateDecision = JSON.parse(JSON.stringify(content.decisions[0]))
    duplicateDecision.authorities.find((item) => item.authority === 'PRODUCT_OWNER').provenanceUri = 'http://governance.storylineos.test/hidden-malformed-authority'
    content.decisions.push(duplicateDecision)
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'DECISION_KEY_DUPLICATE', decisionKey: 'PROVIDER_POSTURE' }),
        expect.objectContaining({ code: 'AUTHORITY_ENTRY_DUPLICATE', decisionKey: 'PROVIDER_POSTURE', authority: 'PRODUCT_OWNER' }),
        expect.objectContaining({ code: 'AUTHORITY_PROVENANCE_INVALID', decisionKey: 'PROVIDER_POSTURE', authority: 'PRODUCT_OWNER' }),
      ]),
    }))
  })

  test('derivation safely blocks missing legacy arrays and objects without throwing', () => {
    expect(() => deriveReadiness()).not.toThrow()
    expect(deriveReadiness({ references: null, rubric: null, providerPosture: null, decisions: [{ decisionKey: 'PROVIDER_POSTURE', authorities: null }] })).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'REFERENCE_FAMILY_NOT_APPROVED' }),
        expect.objectContaining({ code: 'RUBRIC_NOT_APPROVED' }),
        expect.objectContaining({ code: 'PROVIDER_POSTURE_INCOMPLETE' }),
        expect.objectContaining({ code: 'REQUIRED_AUTHORITY_NOT_APPROVED' }),
      ]),
    }))
  })

  test('blocks when any required authority is independently missing approval', () => {
    const { expectedRevision: _expectedRevision, ...content } = validPayload()
    content.decisions[0].authorities.find((item) => item.authority === 'LEGAL').status = 'OPEN'
    expect(deriveReadiness(content)).toEqual(expect.objectContaining({
      verdict: 'SLICE_5_APPLICATION_BLOCKED',
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'REQUIRED_AUTHORITY_NOT_APPROVED', authority: 'LEGAL' })]),
    }))
  })

  test('returns 409 for stale expectedRevision without creating a revision', async () => {
    const token = await tokenFor(makeUser())
    const pointer = { _id: '607f1f77bcf86cd799439011', currentRevision: 2 }
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(pointer))
    const body = validPayload(); body.expectedRevision = 1
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_REVISION_CONFLICT')
    expect(models.OutcomeStudioReadinessRevision.prototype.save).not.toHaveBeenCalled()
  })

  test.each([
    Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    Object.assign(new Error('WriteConflict'), { code: 112, codeName: 'WriteConflict' }),
  ])('maps persistence races to stable 409', async (raceError) => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    models.OutcomeStudioReadinessRevision.prototype.save.mockRejectedValueOnce(raceError)
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(validPayload())
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('OUTCOME_STUDIO_READINESS_REVISION_CONFLICT')
    expect(session.committed).toBe(false)
  })

  test('accepts the exact client-shaped costBoundary request and projects no costPosture', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(validPayload())
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual(expect.objectContaining({ revision: 1, policyVersion: 'LEGACY_SLICE_5A_V1', verdict: 'SLICE_5_APPLICATION_READY', blockers: [] }))
    expect(response.body.data.providerPosture).toEqual(expect.objectContaining({ costBoundary: 'Bounded test spend' }))
    expect(response.body.data.providerPosture).not.toHaveProperty('costPosture')
    expect(response.body.data.references[0]).toEqual(expect.objectContaining({
      sha256: referenceSha256,
      approvedBy: expect.objectContaining({ id: ADMIN_ID, name: 'SUPER_ADMIN' }),
      approvedAt: expect.any(String),
    }))
    expect(response.body.data.rubric).toEqual(expect.objectContaining({
      approvedBy: expect.objectContaining({ id: ADMIN_ID, name: 'SUPER_ADMIN' }),
      approvedAt: expect.any(String),
    }))
    expect(response.body.data.decisions[0].authorities[0]).toEqual(expect.objectContaining({
      actor: expect.objectContaining({ id: ADMIN_ID, name: 'SUPER_ADMIN' }),
      decidedAt: expect.any(String),
    }))
    expect(models.OutcomeStudioReadinessPointer.prototype.save).toHaveBeenCalledWith({ session })
    expect(auditService.logFromRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'OUTCOME_STUDIO_READINESS_REVISION_CREATED', resourceType: 'OutcomeStudioReadinessRevision',
      resourceId: expect.anything(),
      diff: expect.objectContaining({
        before: expect.objectContaining({ revision: 0, blockerCodes: ['READINESS_REVISION_MISSING'] }),
        after: expect.objectContaining({
          policyVersion: 'LEGACY_SLICE_5A_V1',
          verdict: 'SLICE_5_APPLICATION_READY',
          blockerCodes: [],
          evidence: { legacy: expect.objectContaining({
            references: expect.arrayContaining([expect.objectContaining({ family: 'PROFESSIONAL_DOCUMENT', status: 'APPROVED', sha256: referenceSha256 })]),
            rubric: expect.objectContaining({ status: 'APPROVED', threshold: 85, primaryReviewer: { name: 'Primary Reviewer', role: 'PRODUCT_REVIEWER' } }),
            providerPosture: expect.objectContaining({ vendor: 'Approved vendor', model: 'Approved model', costBoundary: 'Bounded test spend', dataRegion: 'UK', failurePosture: 'FAIL_CLOSED' }),
            decisions: expect.arrayContaining([expect.objectContaining({ decisionKey: 'PROVIDER_POSTURE', authorities: expect.arrayContaining([expect.objectContaining({ authority: 'LEGAL', status: 'APPROVED' })]) })]),
          }) },
        }),
      }),
    }), { session, throwOnError: true })
    const auditAfter = auditService.logFromRequest.mock.calls[0][1].diff.after
    expect(auditAfter.evidence.legacy.providerPosture).not.toHaveProperty('costPosture')
    expect(JSON.stringify(auditAfter)).not.toMatch(/provenance|note|approvedBy|decidedAt|actor/i)
    expect(session.committed).toBe(true)
  })

  test('preserves unchanged approval identity, stamps changed decisions, and audits the prior compact state', async () => {
    const token = await tokenFor(makeUser())
    const priorActor = { id: '507f1f77bcf86cd799439099', name: 'Prior Administrator' }
    const priorDate = new Date('2026-07-16T10:00:00.000Z')
    const priorPayload = validPayload()
    const previous = {
      _id: '607f1f77bcf86cd799439088',
      revision: 1,
      references: priorPayload.references.map((item) => ({ ...item, approvedBy: priorActor, approvedAt: priorDate })),
      rubric: { ...priorPayload.rubric, approvedBy: priorActor, approvedAt: priorDate },
      providerPosture: priorPayload.providerPosture,
      decisions: priorPayload.decisions.map((decision) => ({ ...decision, authorities: decision.authorities.map((item) => ({ ...item, actor: priorActor, decidedAt: priorDate })) })),
      verdict: 'SLICE_5_APPLICATION_READY',
      blockers: [],
    }
    const pointer = { _id: '607f1f77bcf86cd799439011', currentRevision: 1, currentRevisionId: previous._id }
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(pointer))
    models.OutcomeStudioReadinessRevision.findById.mockReturnValue(sessionQuery(previous))
    models.OutcomeStudioReadinessPointer.findOneAndUpdate.mockResolvedValue({ ...pointer, currentRevision: 2 })
    const body = validPayload()
    body.expectedRevision = 1
    body.decisions[0].authorities.find((item) => item.authority === 'LEGAL').status = 'REJECTED'

    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(body)
    expect(response.status).toBe(201)
    expect(response.body.data.references[0].approvedBy).toEqual(expect.objectContaining({ id: priorActor.id, name: priorActor.name }))
    const legal = response.body.data.decisions[0].authorities.find((item) => item.authority === 'LEGAL')
    expect(legal).toEqual(expect.objectContaining({ status: 'REJECTED', actor: expect.objectContaining({ id: ADMIN_ID, name: 'SUPER_ADMIN' }) }))
    const unchangedCommercial = response.body.data.decisions[0].authorities.find((item) => item.authority === 'COMMERCIAL')
    expect(unchangedCommercial.actor).toEqual(expect.objectContaining({ id: priorActor.id, name: priorActor.name }))
    expect(auditService.logFromRequest.mock.calls[0][1].diff.before).toEqual(expect.objectContaining({
      revision: 1,
      verdict: 'SLICE_5_APPLICATION_READY',
      blockerCodes: [],
      evidence: { legacy: expect.objectContaining({
        references: expect.arrayContaining([expect.objectContaining({ family: 'PROFESSIONAL_DOCUMENT', sha256: referenceSha256 })]),
      }) },
    }))
  })

  test('audit failure fails closed and does not commit the transaction', async () => {
    const token = await tokenFor(makeUser())
    models.OutcomeStudioReadinessPointer.findOne.mockReturnValue(sessionQuery(null))
    auditService.logFromRequest.mockRejectedValueOnce(new Error('audit write failed'))
    const response = await request.put('/api/v1/super-admin/runtime-control/outcome-studio-readiness').set('Authorization', `Bearer ${token}`).send(validPayload())
    expect(response.status).toBe(503)
    expect(session.committed).toBe(false)
    expect(session.endSession).toHaveBeenCalled()
  })

  test('returns immutable revision history without rewriting rows', async () => {
    const token = await tokenFor(makeUser())
    const rows = [{ revision: 2, verdict: 'SLICE_5_APPLICATION_READY' }, { revision: 1, verdict: 'SLICE_5_APPLICATION_BLOCKED' }]
    const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) }
    models.OutcomeStudioReadinessRevision.find.mockReturnValue(chain)
    models.OutcomeStudioReadinessRevision.countDocuments.mockResolvedValue(2)
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/history').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([
      { ...rows[0], policyVersion: 'LEGACY_SLICE_5A_V1' },
      { ...rows[1], policyVersion: 'LEGACY_SLICE_5A_V1' },
    ])
    expect(rows).toEqual([{ revision: 2, verdict: 'SLICE_5_APPLICATION_READY' }, { revision: 1, verdict: 'SLICE_5_APPLICATION_BLOCKED' }])
    expect(models.OutcomeStudioReadinessRevision.updateOne).not.toHaveBeenCalled()
  })

  test('projects mixed legacy and Development/Test history without reordering or rewriting rows', async () => {
    const token = await tokenFor(makeUser())
    const rows = [
      { revision: 2, policyVersion: 'OES_004_DEVELOPMENT_TEST_READINESS_V1', verdict: 'BLOCKED_FOR_TESTING' },
      { revision: 1, verdict: 'SLICE_5_APPLICATION_BLOCKED' },
    ]
    const original = structuredClone(rows)
    const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) }
    models.OutcomeStudioReadinessRevision.find.mockReturnValue(chain)
    models.OutcomeStudioReadinessRevision.countDocuments.mockResolvedValue(2)
    const response = await request.get('/api/v1/super-admin/runtime-control/outcome-studio-readiness/history').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(2)
    expect(response.body.data[0]).toEqual(expect.objectContaining(rows[0]))
    expect(response.body.data[1]).toEqual({ ...rows[1], policyVersion: 'LEGACY_SLICE_5A_V1' })
    expect(rows).toEqual(original)
  })
})
