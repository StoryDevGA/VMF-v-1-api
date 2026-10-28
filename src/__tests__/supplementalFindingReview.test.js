import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import Review, { assertSupplementalFindingReview } from '../models/RuntimeSupplementalFindingReview.js'
import { supplementalFindingBodySchema, reviewCompletionBodySchema, validateSupplementalFindingBody } from '../validators/reviewCompletion.validator.js'
import { DISCOVERY_CONTRADICTION_DISPOSITIONS, getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'
import { SUPPLEMENTAL_FINDING_POLICY as policy } from '../constants/supplementalFindingReviewPolicy.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

const request = () => ({ requestKey: randomUUID(), expectedBasisHash: 'a'.repeat(64),
  expectedUpdatedAt: basisPolicy.updatedAt, disposition: 'CONFIRMED',
  rationale: 'Engineering validator test only; no operational adjudication.', confirm: true })
describe('supplemental finding explicit request contract', () => {
  test.each(DISCOVERY_CONTRADICTION_DISPOSITIONS)('requires explicit native disposition %s without translating it', disposition => {
    expect(supplementalFindingBodySchema.parse({ ...request(), disposition }).disposition).toBe(disposition)
  })
  test.each(['disposition', 'rationale', 'confirm', 'requestKey', 'expectedUpdatedAt', 'expectedBasisHash'])('rejects missing %s', field => {
    const input = request(); delete input[field]
    expect(supplementalFindingBodySchema.safeParse(input).success).toBe(false)
  })
  test.each(['APPROVED', 'RESOLVED', 'not_contradictory', '', null])('rejects invented disposition %s', disposition => {
    expect(supplementalFindingBodySchema.safeParse({ ...request(), disposition }).success).toBe(false)
  })
  test.each([{ confirm: false }, { rationale: 'short' }, { rationale: 'x'.repeat(2001) },
    { expectedBasisHash: 'invalid' }, { expectedUpdatedAt: 'yesterday' }, { requestKey: 'not-uuid' },
    { reviewedBy: '6a6c763dcace7a21bd41efa9' }, { policyVersion: 'override' }, { skipPopulation: true }])('rejects malformed or caller-owned authority %j', override => {
    expect(supplementalFindingBodySchema.safeParse({ ...request(), ...override }).success).toBe(false)
  })
  test('remains a separate contract from Review Completion', () => {
    expect(reviewCompletionBodySchema.safeParse(request()).success).toBe(false)
    expect(policy.contractVersion).not.toBe('review-completion.v1')
    expect(policy.approval.approvedBy).toBe('Gary')
    expect(policy).not.toHaveProperty('disposition')
  })
})
describe('native finding semantics remain fail closed', () => {
  const candidate = { contradictionId: policy.contradictionId, domain: 'Stakeholders', severity: 'MEDIUM',
    basis: 'Test pair only', evidenceObjectIds: ['first', 'second'] }
  const evidence = ['first', 'second'].map((evidenceObjectId, index) => ({ evidenceObjectId,
    sourceId: 'source-' + index, extractedFact: 'Engineering passage ' + index, reviewStatus: 'ACCEPTED' }))
  const runtime = basisPolicy.scope.runtimeInstanceId
  const pair = getDiscoveryContradictionReview(candidate, evidence, null, runtime, policy.reviewEpoch)
  test('computing a pair with absent history does not create a valid review', () => {
    expect(pair.evidencePairHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(pair.reviewStatus).toBe('STALE')
    expect(pair.latestReview).toBeNull()
  })
  test.each(DISCOVERY_CONTRADICTION_DISPOSITIONS)('native review preserves %s as supplied', disposition => {
    const result = getDiscoveryContradictionReview(candidate, evidence, [{ contradictionId: policy.contradictionId,
      contractVersion: 'discovery-contradiction-review-v1', runtimeInstanceId: runtime, reviewEpoch: policy.reviewEpoch,
      evidencePairHash: pair.evidencePairHash, reviewId: randomUUID(), reviewedBy: 'engineering-test-reviewer',
      reviewedAt: new Date().toISOString(), rationale: 'Explicit engineering fixture decision only.', disposition }], runtime, policy.reviewEpoch)
    expect(result.reviewStatus).toBe(disposition)
    expect(result.reviewStatus === 'NOT_CONTRADICTORY').toBe(disposition === 'NOT_CONTRADICTORY')
  })
})
describe('immutable supplemental receipt model', () => {
  test('preserves required empty reference objects and their signed hashes during serialization', () => {
    const body = { frozenMembership: { sections: [{ sectionKey: 'empty-context', references: {}, resolvedEvidenceIds: [] }] } }
    const record = new Review({ body }), serialized = record.toObject()
    expect(Review.schema.options.minimize).toBe(false)
    expect(serialized.body.frozenMembership.sections[0]).toHaveProperty('references', {})
    expect(membershipHash(serialized.body)).toBe(membershipHash(body))
  })
  test('does not manufacture defaults or accept an incomplete record', () => {
    expect(new Review().body).toBeUndefined()
    expect(() => assertSupplementalFindingReview({ body: {} })).toThrow()
  })
  test('owns exactly the policy and request uniqueness queries and never auto-provisions', () => {
    expect(Review.schema.options.autoCreate).toBe(false)
    expect(Review.schema.options.autoIndex).toBe(false)
    expect(Review.schema.indexes().filter(([, options]) => options.unique).map(([fields, options]) => ({ fields, name: options.name })))
      .toEqual([
        { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, policyVersion: 1 }, name: 'unique_supplemental_finding_policy' },
        { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, name: 'unique_supplemental_finding_request' },
      ])
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects model %s before database access', async method => {
    await expect(Review[method]({}, {})).rejects.toThrow('immutable')
  })
  test('rejects a mutation batch before database access', async () => {
    await expect(Review.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow('immutable')
  })
})

describe('mounted supplemental controllers with an explicit simulated authentication seam', () => {
  const inspect = jest.fn(), record = jest.fn()
  let app
  beforeAll(async () => {
    jest.unstable_mockModule('../services/supplementalFindingReviewService.js', () => ({
      inspectSupplementalFindingReview: inspect, recordSupplementalFindingReview: record,
    }))
    jest.unstable_mockModule('../services/runtimeProductAuthorityService.js', () => ({
      inspectRuntimeProductAuthority: jest.fn(), importRuntimeProductAuthority: jest.fn(),
    }))
    jest.unstable_mockModule('../services/publishedDispositionRecoveryService.js', () => ({
      inspectPublishedDispositionRecovery: jest.fn(), recordPublishedDispositionRecovery: jest.fn(),
    }))
    jest.unstable_mockModule('../services/reviewCompletionService.js', () => ({ getReviewCompletion: jest.fn(), completeReview: jest.fn() }))
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({
      buildRuntimeStateRequestScopes: ({ scopes }) => scopes,
    }))
    const handlers = await import('../controllers/reviewCompletion.controller.js')
    app = express(); app.use(express.json())
    app.use((req, _res, next) => { req.context = { userId: basisPolicy.originalUpdatedBy }; req.scopes = { controlledTest: true }; req.requestId = 'mounted-test'; next() })
    app.get('/:runtimeInstanceId/supplemental-finding-review', handlers.readSupplementalFindingReview)
    app.post('/:runtimeInstanceId/supplemental-finding-review', validateSupplementalFindingBody, handlers.recordSupplementalFinding)
    app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED_TEST_DEPENDENCY_FAILURE' } }))
  })
  beforeEach(() => { inspect.mockReset(); record.mockReset() })
  const path = '/' + basisPolicy.scope.runtimeInstanceId + '/supplemental-finding-review'
  test('passes the authenticated actor and preserves the explicit disposition', async () => {
    record.mockResolvedValue({ receipt: { disposition: 'CONFIRMED', authorisesLock: false }, replay: false })
    const input = request(), result = await supertest(app).post(path).send(input)
    expect(result.status).toBe(200)
    expect(record.mock.calls[0][0]).toMatchObject({ actorUserId: basisPolicy.originalUpdatedBy,
      runtimeInstanceId: basisPolicy.scope.runtimeInstanceId, payload: input })
    expect(result.body.data.receipt).toMatchObject({ disposition: 'CONFIRMED', authorisesLock: false })
  })
  test('strict validation rejects a caller-supplied reviewer before the producer', async () => {
    const result = await supertest(app).post(path).send({ ...request(), reviewedBy: 'pretend-reviewer' })
    expect(result.status).toBe(422); expect(record).not.toHaveBeenCalled()
  })
  test.each(['get', 'post'])('forwards a rejected %s dependency without an empty success', async method => {
    const operation = method === 'get' ? inspect : record
    operation.mockRejectedValue(Object.assign(new Error('Required authority unavailable'), { status: 503, code: 'REVIEW_AUTHORITY_UNAVAILABLE' }))
    const result = await supertest(app)[method](path).send(method === 'post' ? request() : undefined)
    expect(result.status).toBe(503)
    expect(result.body.error.code).toBe('REVIEW_AUTHORITY_UNAVAILABLE')
    expect(result.body).not.toHaveProperty('data')
  })
})
