import { randomUUID } from 'node:crypto'
import { projectStoredContradictionHistory } from '../services/intelligenceContradictionHistory.js'
import { contradictionReviewRequestHash } from '../services/discoveryContradictionReviewService.js'
import { contradictionHistorySelectionSchema } from '../validators/contradictionHistory.validator.js'

const runtimeId = '64b000000000000000000001', findingId = 'contradiction_exact'
const selection = { findingId, page: 1, pageSize: 10 }
const row = change => ({ contractVersion: 'discovery-contradiction-review-v1', reviewId: randomUUID(),
  runtimeInstanceId: runtimeId, contradictionId: findingId, evidencePairHash: 'sha256:' + 'a'.repeat(64),
  disposition: 'NOT_CONTRADICTORY', rationale: 'Recorded explanation.', reviewEpoch: '',
  reviewedBy: runtimeId, reviewedAt: '2026-10-06T10:00:00.000Z', reviewedStateVersion: 'rsv2:opaque', ...change })
const keyed = () => {
  const review = row({ requestKey: randomUUID(), requestExpectedUpdatedAt: '2026-10-06T09:00:00.000Z' })
  review.requestPayloadHash = contradictionReviewRequestHash({ actorUserId: review.reviewedBy, runtimeInstanceId: runtimeId,
    contradictionId: findingId, expectedUpdatedAt: review.requestExpectedUpdatedAt, expectedEvidencePairHash: review.evidencePairHash,
    disposition: review.disposition, rationale: review.rationale, confirm: true })
  return review
}
test('distinguishes absent history from complete stored empty without current/audit claims', () => {
  expect(projectStoredContradictionHistory(undefined, runtimeId, selection)).toMatchObject({ available: false, total: null })
  expect(projectStoredContradictionHistory([], runtimeId, selection)).toMatchObject({ available: true, total: 0,
    completeness: 'COMPLETE_STORED_HISTORY', currentness: 'NOT_ASSESSED', auditReferences: 'UNAVAILABLE', recalculation: 'UNAVAILABLE' })
})
test('pages exact finding in reverse append order beyond first100 without timestamp inference', () => {
  const rows = Array.from({ length: 130 }, () => row())
  rows.splice(5, 0, row({ contradictionId: 'other' }))
  const value = projectStoredContradictionHistory(rows, runtimeId, { ...selection, page: 101, pageSize: 1 })
  expect(value.total).toBe(130); expect(value.totalPages).toBe(130)
  expect(value.records[0].reviewId).toBe(rows.filter(r => r.contradictionId === findingId)[29].reviewId)
  expect(projectStoredContradictionHistory(rows, runtimeId, { ...selection, page: 14 })).toMatchObject({ records: [], total: 130 })
  expect(contradictionHistorySelectionSchema.safeParse({ ...selection, page: 1000, pageSize: 1 }).success).toBe(true)
})
test.each([null, false, {}, [null], Array(1001).fill({}), [row({ rationale: 'x'.repeat(128 * 1024) })]])('rejects invalid or excessive history %#', reviews => {
  expect(projectStoredContradictionHistory(reviews, runtimeId, selection)).toMatchObject({ available: false, records: [], total: null })
})
test.each([{ reviewId: 'wrong' }, { runtimeInstanceId: 'other' }, { reviewedStateVersion: 3 }, { reviewedStateVersion: '' },
  { reviewedBy: 'actor' }, { reviewedAt: '2026-10-06' }, { disposition: 'DISMISSED' }, { evidencePairHash: '' },
  { rationale: 'short' }, { reviewEpoch: 'bad' }, { contractVersion: 'other' }])('fails closed on malformed stored record %j', change => {
  expect(projectStoredContradictionHistory([row(change)], runtimeId, selection).available).toBe(false)
})
test('duplicate identities invalidate the whole read and arbitrary fields are never serialized', () => {
  const review = row({ privateField: 'Secret not projected' })
  expect(projectStoredContradictionHistory([review, review], runtimeId, selection).available).toBe(false)
  const value = projectStoredContradictionHistory([review], runtimeId, selection)
  expect(value.records[0]).not.toHaveProperty('privateField'); expect(value.records[0].reviewEpoch).toBe('')
})
test('optional keyed history recomputes original proof, not just hash shape', () => {
  const review = keyed()
  expect(projectStoredContradictionHistory([review], runtimeId, selection).available).toBe(true)
  for (const change of [{ rationale: 'Different explanation.' }, { requestPayloadHash: 'b'.repeat(64) }, { requestKey: undefined },
    { requestExpectedUpdatedAt: '2026-10-06' }]) expect(projectStoredContradictionHistory([{ ...review, ...change }], runtimeId, selection).available).toBe(false)
})
test.each([{ page: 0 }, { page: 1001 }, { pageSize: 21 }, { page: 1.5 }, { findingId: ' ' }, { search: 'ignored' }])('rejects unsupported selection %j', change => {
  expect(contradictionHistorySelectionSchema.safeParse({ ...selection, ...change }).success).toBe(false)
})
test.each([true, false, ['1'], {}, '', ' 1', '1.0'])('rejects non-scalar or noncanonical page values %j', value => {
  for (const field of ['page', 'pageSize']) expect(contradictionHistorySelectionSchema.safeParse({ ...selection, [field]: value }).success).toBe(false)
})
