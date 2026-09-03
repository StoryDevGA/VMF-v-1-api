import { buildDiscoveryHealth } from '../services/discoveryIntelligenceService.js'
import {
  DISCOVERY_CONTRADICTION_REVIEW_CONTRACT,
  getDiscoveryContradictionReview,
  getUnresolvedDiscoveryContradictions,
  isBoundedContradictionReviewHistory,
} from '../services/discoveryContradictionReviewService.js'

const evidence = [
  { evidenceObjectId: 'a', sourceId: 'source-a', extractedFact: 'Draft digital mockup.', reviewStatus: 'ACCEPTED', validationStatus: 'UNVALIDATED', graphReadyMetadata: { domain: 'Services' } },
  { evidenceObjectId: 'b', sourceId: 'source-b', extractedFact: 'Does not establish implementation quality.', reviewStatus: 'ACCEPTED', validationStatus: 'VALIDATED', graphReadyMetadata: { domain: 'Services' } },
]
const candidate = buildDiscoveryHealth({ evidenceObjects: evidence }).contradictionCandidates[0]
const makeReview = (overrides = {}) => ({
  contractVersion: DISCOVERY_CONTRADICTION_REVIEW_CONTRACT,
  runtimeInstanceId: 'runtime-a', reviewId: 'decision-1', contradictionId: candidate.contradictionId,
  reviewEpoch: '',
  evidencePairHash: getDiscoveryContradictionReview(candidate, evidence).evidencePairHash,
  disposition: 'NOT_CONTRADICTORY', rationale: 'Classification and limitations are compatible.',
  reviewedBy: 'human-reviewer', reviewedAt: '2026-09-03T08:00:00.000Z', ...overrides,
})
const status = (reviews = [], objects = evidence, runtimeId = 'runtime-a') =>
  getDiscoveryContradictionReview(candidate, objects, reviews, runtimeId).reviewStatus

describe('human contradiction review', () => {
  test('requires an explicit current decision and preserves original records', () => {
    const original = structuredClone(evidence)
    expect(status()).toBe('UNREVIEWED')
    expect(status([makeReview()])).toBe('NOT_CONTRADICTORY')
    expect(evidence).toEqual(original)
  })
  test.each(['CONFIRMED', 'REOPENED', 'INVALID'])('latest %s blocks without falling back to a dismissal', (disposition) => {
    expect(status([makeReview(), makeReview({ disposition })])).not.toBe('NOT_CONTRADICTORY')
  })
  test.each([
    { reviewedBy: '' }, { reviewedAt: 'bad-date' }, { rationale: 'short' },
    { reviewId: '' }, { contractVersion: 'other' }, { evidencePairHash: 'wrong' },
  ])('malformed latest decision fails closed: %j', (change) => {
    expect(status([makeReview(), makeReview(change)])).toBe('STALE')
  })
  test('inherited review cannot authorize a different runtime revision', () => {
    expect(status([makeReview()], evidence, 'runtime-revision')).toBe('STALE')
  })
  test('reset/reacquisition with identical evidence requires a fresh explicit epoch decision', () => {
    const epoch = '55555555-5555-4555-8555-555555555555'
    const view = getDiscoveryContradictionReview(candidate, evidence, [makeReview()], 'runtime-a', epoch)
    expect(view.reviewStatus).toBe('STALE')
    const review = makeReview({ evidencePairHash: view.evidencePairHash, reviewEpoch: epoch })
    expect(getDiscoveryContradictionReview(candidate, evidence, [review], 'runtime-a', epoch).reviewStatus).toBe('NOT_CONTRADICTORY')
    expect(getDiscoveryContradictionReview(candidate, evidence, [{ ...review, reviewEpoch: undefined }], 'runtime-a', epoch).reviewStatus).toBe('STALE')
    expect(getDiscoveryContradictionReview(candidate, evidence, [review], 'runtime-a', 'malformed').reviewStatus).toBe('STALE')
  })
  test.each(['extractedFact', 'sourceId', 'lineageRef', 'reviewStatus', 'validationStatus'])('changed %s invalidates the pair binding', (field) => {
    const changed = structuredClone(evidence)
    changed[0][field] = 'changed'
    expect(status([makeReview()], changed)).toBe('STALE')
  })
  test('hashes full statements rather than the truncated candidate claim', () => {
    const changed = structuredClone(evidence)
    changed[0].extractedFact = 'A'.repeat(300) + ' original'
    const review = makeReview({ evidencePairHash: getDiscoveryContradictionReview(candidate, changed).evidencePairHash })
    changed[0].extractedFact = 'A'.repeat(300) + ' changed'
    expect(status([review], changed)).toBe('STALE')
  })
  test.each([[], [evidence[0]], [...evidence, evidence[0]], [evidence[0], { ...evidence[1], reviewStatus: 'REJECTED' }], null].map((objects) => ({ objects })))('missing/rejected/duplicate evidence fails closed', ({ objects }) => {
    expect(status([makeReview()], objects)).toBe('STALE')
  })
  test('malformed history and byte/row overflow fail closed without truncation', () => {
    expect(status([makeReview(), null])).toBe('STALE')
    expect(isBoundedContradictionReviewHistory(Array(1001).fill({}))).toBe(false)
    const oversized = Array(40).fill(makeReview({ rationale: '界'.repeat(2000) }))
    expect(isBoundedContradictionReviewHistory(oversized)).toBe(false)
    expect(status(oversized)).toBe('STALE')
  })
  test('readiness retains all candidates but counts only current unresolved decisions', () => {
    const health = buildDiscoveryHealth({ evidenceObjects: evidence, contradictionReviews: [makeReview()], runtimeInstanceId: 'runtime-a' })
    expect(health.contradictionCandidates).toHaveLength(1)
    expect(health.readiness.unresolvedContradictionCount).toBe(0)
    expect(health.readiness.blockerReasons).not.toContain('CONTRADICTIONS_REQUIRE_REVIEW')
    expect(buildDiscoveryHealth({ evidenceObjects: evidence }).readiness.blockerReasons).toContain('CONTRADICTIONS_REQUIRE_REVIEW')
  })
  test('composition derives decisions independently of client/projected status', () => {
    const pack = { evidenceObjects: evidence, discoveryHealth: { contradictionCandidates: [{ ...candidate, reviewStatus: 'NOT_CONTRADICTORY' }] } }
    expect(getUnresolvedDiscoveryContradictions(pack, 'runtime-a')).toHaveLength(1)
    expect(getUnresolvedDiscoveryContradictions({ ...pack, contradictionReviews: [makeReview()] }, 'runtime-a')).toHaveLength(0)
    expect(getUnresolvedDiscoveryContradictions({ ...pack, contradictionReviews: [makeReview()] }, 'child-runtime')).toHaveLength(1)
  })
})
