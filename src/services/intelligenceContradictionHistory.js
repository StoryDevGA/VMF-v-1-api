import { DISCOVERY_CONTRADICTION_DISPOSITIONS, DISCOVERY_CONTRADICTION_REVIEW_CONTRACT,
  DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN, contradictionReviewRequestHash,
  isBoundedContradictionReviewHistory } from './discoveryContradictionReviewService.js'

const text = (value, maximum = 240) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= maximum
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value
const actor = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const fields = ['contractVersion', 'reviewId', 'runtimeInstanceId', 'contradictionId', 'evidencePairHash',
  'disposition', 'rationale', 'reviewEpoch', 'reviewedBy', 'reviewedAt', 'reviewedStateVersion']
const requestFields = ['requestKey', 'requestPayloadHash', 'requestExpectedUpdatedAt']

// Existing append-only decision records, never a current disposition or a full
// finding/audit/recalculation register. No evidence or graph payload is required.
export function projectStoredContradictionHistory(reviews, runtimeId, selection) {
  const unavailable = reason => ({ available: false, completeness: 'UNAVAILABLE', reason,
    findingId: selection.findingId, records: [], total: null, page: selection.page,
    pageSize: selection.pageSize, totalPages: null, basis: 'RECORDED_DECISIONS', currentness: 'NOT_ASSESSED',
    auditReferences: 'UNAVAILABLE', recalculation: 'UNAVAILABLE' })
  if (reviews === undefined) return unavailable('HISTORY_NOT_RECORDED')
  if (!isBoundedContradictionReviewHistory(reviews)) return unavailable('HISTORY_INVALID_OR_OVER_LIMIT')
  const reviewIds = new Set()
  for (const review of reviews) {
    if (!review || typeof review !== 'object' || Array.isArray(review)
      || review.contractVersion !== DISCOVERY_CONTRADICTION_REVIEW_CONTRACT
      || typeof review.reviewId !== 'string' || !DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN.test(review.reviewId)
      || reviewIds.has(review.reviewId) || review.runtimeInstanceId !== runtimeId
      || !text(review.contradictionId) || !/^sha256:[a-f0-9]{64}$/.test(review.evidencePairHash || '')
      || !DISCOVERY_CONTRADICTION_DISPOSITIONS.includes(review.disposition)
      || typeof review.rationale !== 'string' || review.rationale !== review.rationale.trim()
      || review.rationale.length < 10 || review.rationale.length > 2000
      || !actor(review.reviewedBy) || !time(review.reviewedAt) || !text(review.reviewedStateVersion)
      || typeof review.reviewEpoch !== 'string' || review.reviewEpoch !== ''
        && !DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN.test(review.reviewEpoch)) return unavailable('HISTORY_RECORD_INVALID')
    reviewIds.add(review.reviewId)
    const present = requestFields.filter(field => review[field] !== undefined)
    if (present.length && (present.length !== requestFields.length
      || !DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN.test(review.requestKey)
      || !time(review.requestExpectedUpdatedAt)
      || contradictionReviewRequestHash({ actorUserId: review.reviewedBy, runtimeInstanceId: runtimeId,
        contradictionId: review.contradictionId, expectedUpdatedAt: review.requestExpectedUpdatedAt,
        expectedEvidencePairHash: review.evidencePairHash, disposition: review.disposition,
        rationale: review.rationale, confirm: true }) !== review.requestPayloadHash)) return unavailable('HISTORY_REQUEST_PROOF_INVALID')
  }
  const selected = reviews.filter(review => review.contradictionId === selection.findingId).toReversed()
  return { available: true, completeness: 'COMPLETE_STORED_HISTORY', reason: null,
    findingId: selection.findingId, total: selected.length, page: selection.page, pageSize: selection.pageSize,
    totalPages: Math.max(1, Math.ceil(selected.length / selection.pageSize)), basis: 'RECORDED_DECISIONS',
    currentness: 'NOT_ASSESSED', auditReferences: 'UNAVAILABLE', recalculation: 'UNAVAILABLE',
    records: selected.slice((selection.page - 1) * selection.pageSize, selection.page * selection.pageSize)
      .map(review => Object.fromEntries([...fields, ...requestFields].filter(field => review[field] !== undefined)
        .map(field => [field, review[field]]))) }
}
