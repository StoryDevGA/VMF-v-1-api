import { test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { projectStoredFindings } from '../services/intelligenceFindingRead.js'
import { findingSelectionSchema } from '../validators/intelligenceFinding.validator.js'
import { getDiscoveryContradictionReview, contradictionReviewRequestHash } from '../services/discoveryContradictionReviewService.js'

const control = { id: '64b000000000000000000001', runtimeInstanceKey: 'revision', customerId: '64b000000000000000000002',
  tenantId: '64b000000000000000000003', stateVersion: 'rsv2:current' }
const fixture = () => {
  const stored = { candidates: Array.from({ length: 3 }, (_, i) => ({ contradictionId: `finding-${i}`, domain: `Domain${i}`,
    severity: 'LOW', basis: 'Existing deterministic detector', evidenceObjectIds: [`positive-${i}`, `negative-${i}`] })), reviews: [], reviewEpoch: '' }
  const evidenceRows = stored.candidates.flatMap((candidate, i) => candidate.evidenceObjectIds.map(id => ({ ...control,
    runtimeInstanceId: control.id, evidenceObjectId: id, sourceId: `source-${i}`, sourceType: 'DOCUMENT',
    lineageRef: `lineage-${id}`, extractedFact: id === 'negative-2' ? 'Offpage exact provenance needle' : `Statement ${id}`,
    reviewStatus: 'ACCEPTED', validationStatus: 'VERIFIED', sourceStateVersion: control.stateVersion,
    sourceHash: 'sha256:' + 'a'.repeat(64), migrationReceiptId: '64b000000000000000000004' })))
  return { control, stored, evidenceRows }
}
const read = (args = {}, selection = {}) => projectStoredFindings({ ...fixture(), ...args,
  selection: findingSelectionSchema.parse({ population: 'DETECTED', ...selection }) })
const record = (f, index, disposition = 'NOT_CONTRADICTORY') => {
  const candidate = f.stored.candidates[index], pair = getDiscoveryContradictionReview(candidate, f.evidenceRows, [], control.id, '')
  return { contractVersion: 'discovery-contradiction-review-v1', reviewId: randomUUID(), runtimeInstanceId: control.id,
    contradictionId: candidate.contradictionId, evidencePairHash: pair.evidencePairHash, disposition,
    rationale: 'Human recorded evidence basis.', reviewEpoch: '', reviewedBy: control.customerId,
    reviewedAt: '2026-10-06T10:00:00.000Z', reviewedStateVersion: 'rsv2:original' }
}
test('searches all stored detections and exact native evidence before independent paging', () => {
  expect(read({}, { pageSize: 1, page: 2 })).toMatchObject({ total: 3, totalPages: 3, records: [{ findingId: 'finding-1' }],
    completeness: 'COMPLETE_STORED_DETECTIONS', allTypesCompleteness: 'UNAVAILABLE', detectionPolicy: { maxStoredCandidates: 8 } })
  expect(read({}, { pageSize: 1, search: 'PROVENANCE NEEDLE' })).toMatchObject({ total: 1, records: [{ findingId: 'finding-2' }] })
  expect(read({}, { search: 'source-2' }).total).toBe(1)
  expect(read({}, { sort: 'ID_DESC', pageSize: 1 }).records[0].findingId).toBe('finding-2')
  expect(read({}, { search: '.*' }).total).toBe(0)
})
test('current decisions, confirmed findings, reopened and stale history retain distinct overlapping populations', () => {
  const f = fixture(); f.stored.reviews = [record(f, 0), record(f, 1, 'CONFIRMED'), record(f, 2, 'REOPENED')]
  expect(read(f, { population: 'OPEN' })).toMatchObject({ total: 1, records: [{ findingId: 'finding-2', reviewStatus: 'REOPENED' }],
    populations: { detected: 3, open: 1, recorded: 3 } })
  expect(read(f, { population: 'RECORDED' }).records[1]).toMatchObject({ reviewStatus: 'CONFIRMED', consequences: 'UNAVAILABLE' })
  f.stored.reviews[0].evidencePairHash = 'sha256:' + 'b'.repeat(64)
  expect(read(f, { population: 'OPEN' }).records[0].reviewStatus).toBe('STALE')
})
test('absent contracts differ from genuine complete stored empty detections', () => {
  expect(read({ stored: {} })).toMatchObject({ available: false, total: null, reason: 'DETECTIONS_NOT_RECORDED' })
  expect(read({ stored: { candidates: [], reviews: [], reviewEpoch: '' }, evidenceRows: [] })).toMatchObject({ available: true, total: 0 })
  const f = fixture(); delete f.stored.reviews; expect(read(f).reason).toBe('HISTORY_NOT_RECORDED')
  f.stored.reviews = []; delete f.stored.reviewEpoch; expect(read(f).reason).toBe('REVIEW_EPOCH_UNAVAILABLE')
})
test.each(['MISSING_COVERAGE', 'WEAK_CONFIDENCE', 'DUPLICATE_SOURCE'])('absent canonical %s is unavailable, never zero', type => {
  expect(read({}, { type })).toMatchObject({ available: false, reason: 'CANONICAL_FINDING_TYPE_UNAVAILABLE', records: [], total: null })
})
test.each(['customerVisible', 'private', 'visibility', 'accessLevel'])('undeclared %s on native evidence or stored candidate cannot expose statements', field => {
  for (const location of ['evidence', 'candidate']) { const f = fixture(); (location === 'evidence' ? f.evidenceRows[0] : f.stored.candidates[0])[field] = false
    expect(read(f)).toMatchObject({ available: false, reason: 'UNVERIFIED_VISIBILITY_CONTRACT', records: [], total: null }) }
})
test.each(['sourceId', 'sourceHash', 'migrationReceiptId', 'runtimeInstanceId', 'stateVersion', 'sourceStateVersion', 'reviewStatus', 'extractedFact'])('invalid exact evidence %s cannot become a complete detection read', field => {
  const f = fixture(); f.evidenceRows[0][field] = ''; expect(read(f).available).toBe(false)
})
test('duplicate, missing and rejected evidence pairs fail without silently excluding detections', () => {
  const f = fixture(); f.evidenceRows[0].reviewStatus = 'REJECTED'; expect(read(f).reason).toBe('EVIDENCE_PAIR_UNAVAILABLE')
  expect(read({ evidenceRows: fixture().evidenceRows.slice(1) }).available).toBe(false)
  const duplicated = fixture().evidenceRows; duplicated[0] = duplicated[1]; expect(read({ evidenceRows: duplicated }).available).toBe(false)
})
test.each([['sourceType', []], ['lineageRef', 5], ['validationStatus', {}], ['sourceType', 'x'.repeat(101)],
  ['lineageRef', 'x'.repeat(1001)], ['validationStatus', 'x'.repeat(81)], ['lineageRef', 'a\nb']])('malformed canonical pair field %s fails closed', (field, value) => {
  const f = fixture(); f.evidenceRows[0][field] = value; expect(read(f)).toMatchObject({ available: false, records: [], total: null })
})
test('declared empty source/lineage defaults and absent optional validation status remain canonical', () => {
  const f = fixture(); f.evidenceRows[0].sourceType = ''; f.evidenceRows[0].lineageRef = ''; delete f.evidenceRows[0].validationStatus
  expect(read(f).available).toBe(true)
})
test('full canonical history validation includes unrelated rows and original retry fingerprint', () => {
  const f = fixture(), review = record(f, 0); f.stored.reviews = [review]
  review.requestKey = randomUUID(); review.requestExpectedUpdatedAt = '2026-10-06T09:00:00.000Z'
  review.requestPayloadHash = contradictionReviewRequestHash({ actorUserId: review.reviewedBy, runtimeInstanceId: control.id,
    contradictionId: review.contradictionId, expectedUpdatedAt: review.requestExpectedUpdatedAt,
    expectedEvidencePairHash: review.evidencePairHash, disposition: review.disposition, rationale: review.rationale, confirm: true })
  expect(read(f).available).toBe(true); review.requestPayloadHash = '0'.repeat(64); expect(read(f).reason).toBe('HISTORY_REQUEST_PROOF_INVALID')
  f.stored.reviews = [{ ...record(f, 1), reviewedBy: 'invalid' }]; expect(read(f).reason).toBe('HISTORY_RECORD_INVALID')
})
test('producer and history caps remain fail closed with no partial totals', () => {
  const f = fixture(); f.stored.candidates = Array(9).fill(f.stored.candidates[0]); expect(read(f).available).toBe(false)
  const g = fixture(); g.stored.reviews = Array(1001).fill(record(g, 0)); expect(read(g).available).toBe(false)
})
test.each([{ search: [] }, { search: true }, { search: 'x'.repeat(241) }, { search: 'a\nb' }, { population: 'all' }, { type: 'ALL' },
  { sort: 'PRIORITY' }, { page: true }, { page: ['1'] }, { page: '01' }, { page: 1001 }, { pageSize: 21 }, { unknown: 'field' }])('strict finding scalar query rejects %j', query => {
  expect(findingSelectionSchema.safeParse(query).success).toBe(false)
})
