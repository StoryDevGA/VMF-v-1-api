import { createHash } from 'node:crypto'

export const DISCOVERY_CONTRADICTION_REVIEW_CONTRACT = 'discovery-contradiction-review-v1'
export const DISCOVERY_CONTRADICTION_DISPOSITIONS = ['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED']
export const DISCOVERY_CONTRADICTION_HISTORY_MAX_BYTES = 128 * 1024
const text = (value) => typeof value === 'string' ? value.trim() : ''
const token = (value) => text(value).toUpperCase()

export const isBoundedContradictionReviewHistory = (reviews) => Array.isArray(reviews)
  && reviews.length <= 1000
  && Buffer.byteLength(JSON.stringify(reviews), 'utf8') <= DISCOVERY_CONTRADICTION_HISTORY_MAX_BYTES

// Use the same full statement/provenance projection for root writes and scoped V2 reads.
export const projectContradictionEvidence = (item) => ({
  evidenceObjectId: text(item.evidenceObjectId),
  sourceId: text(item.sourceId),
  sourceType: token(item.sourceType),
  lineageRef: text(item.lineageRef),
  extractedFact: text(item.extractedFact),
  reviewStatus: token(item.reviewStatus),
  validationStatus: token(item.validationStatus),
})

export const getDiscoveryContradictionReview = (candidate, evidenceObjects = [], reviews = [], runtimeId = '', reviewEpoch = '') => {
  const ids = candidate?.evidenceObjectIds
  const pair = Array.isArray(evidenceObjects) && Array.isArray(ids) && ids.length === 2 && new Set(ids).size === 2
    ? ids.map((id) => evidenceObjects.filter((item) => item?.evidenceObjectId === id))
    : []
  const evidence = pair.length === 2 && pair.every((matches) => matches.length === 1)
    ? pair.map(([item]) => projectContradictionEvidence(item))
    : []
  const validEpoch = typeof reviewEpoch === 'string' && (reviewEpoch === ''
    || /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(reviewEpoch))
  const usable = validEpoch && evidence.length === 2 && evidence.every((item) => item.sourceId
    && item.extractedFact && item.reviewStatus !== 'REJECTED')
  const evidencePairHash = usable
    ? `sha256:${createHash('sha256').update(JSON.stringify({
        contractVersion: DISCOVERY_CONTRADICTION_REVIEW_CONTRACT,
        reviewEpoch,
        contradictionId: candidate.contradictionId,
        domain: candidate.domain,
        severity: candidate.severity,
        basis: candidate.basis,
        evidence,
      })).digest('hex')}`
    : ''
  const validHistory = isBoundedContradictionReviewHistory(reviews)
    && reviews.every((review) => review && typeof review === 'object' && text(review.contradictionId))
  const latestReview = validHistory
    ? reviews.findLast((review) => review.contradictionId === candidate?.contradictionId) || null
    : null
  // Never fall back to an older dismissal after a malformed, stale or reopening decision.
  const current = latestReview && evidencePairHash && text(runtimeId)
    && latestReview.runtimeInstanceId === String(runtimeId)
    && latestReview.contractVersion === DISCOVERY_CONTRADICTION_REVIEW_CONTRACT
    && typeof reviewEpoch === 'string' && latestReview.reviewEpoch === reviewEpoch
    && latestReview.evidencePairHash === evidencePairHash
    && text(latestReview.reviewId) && text(latestReview.reviewedBy)
    && Number.isFinite(Date.parse(latestReview.reviewedAt))
    && text(latestReview.rationale).length >= 10 && text(latestReview.rationale).length <= 2000
    && DISCOVERY_CONTRADICTION_DISPOSITIONS.includes(latestReview.disposition)
  return {
    evidencePairHash,
    evidence,
    latestReview,
    reviewStatus: !validHistory || (latestReview && !current) || !usable
      ? 'STALE'
      : current ? latestReview.disposition : 'UNREVIEWED',
  }
}

export const getUnresolvedDiscoveryContradictions = (evidencePack = {}, runtimeId = '') => {
  const candidates = evidencePack.discoveryHealth?.contradictionCandidates || []
  return candidates.filter((candidate) => getDiscoveryContradictionReview(
    candidate, evidencePack.evidenceObjects, evidencePack.contradictionReviews, runtimeId, evidencePack.contradictionReviewEpoch,
  ).reviewStatus !== 'NOT_CONTRADICTORY')
}
