import { getDiscoveryContradictionReview, DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN } from './discoveryContradictionReviewService.js'
import { projectStoredContradictionHistory } from './intelligenceContradictionHistory.js'

const text = (value, maximum = 240) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum
  && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const visibilityConflict = row => ['customerVisible', 'private', 'visibility', 'accessLevel'].some(field => row?.[field] !== undefined)
const optionalText = (value, maximum) => typeof value === 'string' && value === value.trim() && value.length <= maximum
  && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const detectionPolicy = { coverage: 'LIMITED_BY_PRODUCER_POLICY', maxStoredCandidates: 8, detectorVersion: null }
export const storedFindingEvidenceIds = stored => Array.isArray(stored?.candidates) && stored.candidates.length <= 8
  && stored.candidates.every(c => c && Array.isArray(c.evidenceObjectIds) && c.evidenceObjectIds.length === 2
    && new Set(c.evidenceObjectIds).size === 2 && c.evidenceObjectIds.every(id => text(id)))
  ? [...new Set(stored.candidates.flatMap(c => c.evidenceObjectIds))] : null

// Project persisted detections and canonical dispositions. This is not a detector
// or a complete four-type findings register; absent contracts never become zero.
export function projectStoredFindings({ stored, evidenceRows, control, selection }) {
  const unavailable = reason => ({ available: false, completeness: 'UNAVAILABLE', reason, ...selection,
    total: null, totalPages: null, records: [], populations: null, allTypesCompleteness: 'UNAVAILABLE', detectionPolicy })
  if (selection.type !== 'CONTRADICTION') return unavailable('CANONICAL_FINDING_TYPE_UNAVAILABLE')
  const candidates = stored?.candidates, ids = storedFindingEvidenceIds(stored)
  if (candidates === undefined) return unavailable('DETECTIONS_NOT_RECORDED')
  if (!ids || new Set(candidates.map(c => c.contradictionId)).size !== candidates.length
    || candidates.some(c => !text(c.contradictionId) || !text(c.domain) || !text(c.severity, 100) || !text(c.basis, 2000)))
    return unavailable('STORED_DETECTIONS_INVALID')
  if (candidates.some(visibilityConflict) || evidenceRows.some(visibilityConflict)) return unavailable('UNVERIFIED_VISIBILITY_CONTRACT')
  if (typeof stored.reviewEpoch !== 'string' || stored.reviewEpoch !== '' && !DISCOVERY_CONTRADICTION_REQUEST_KEY_PATTERN.test(stored.reviewEpoch))
    return unavailable('REVIEW_EPOCH_UNAVAILABLE')
  const history = projectStoredContradictionHistory(stored.reviews, control.id, { findingId: '__validation__', page: 1, pageSize: 1 })
  if (!history.available) return unavailable(history.reason)
  if (evidenceRows.length !== ids.length || new Set(evidenceRows.map(r => r.evidenceObjectId)).size !== ids.length
    || evidenceRows.some(r => !ids.includes(r.evidenceObjectId) || !text(r.sourceId)
      || String(r.runtimeInstanceId) !== control.id || r.runtimeInstanceKey !== control.runtimeInstanceKey
      || String(r.customerId) !== control.customerId || String(r.tenantId) !== control.tenantId
      || r.stateVersion !== control.stateVersion || r.sourceStateVersion !== control.stateVersion
      || !/^sha256:[a-f0-9]{64}$/.test(r.sourceHash || '') || !/^[a-f0-9]{24}$/.test(String(r.migrationReceiptId || ''))
      || !text(r.extractedFact, 8000) || !['PENDING', 'ACCEPTED', 'REJECTED'].includes(r.reviewStatus)
      || !optionalText(r.sourceType, 100) || !optionalText(r.lineageRef, 1000)
      || r.validationStatus !== undefined && !optionalText(r.validationStatus, 80)))
    return unavailable('EVIDENCE_BASIS_UNAVAILABLE')
  const records = []
  for (const candidate of candidates) {
    const review = getDiscoveryContradictionReview(candidate, evidenceRows, stored.reviews, control.id, stored.reviewEpoch)
    if (!review.evidencePairHash) return unavailable('EVIDENCE_PAIR_UNAVAILABLE')
    const recorded = projectStoredContradictionHistory(stored.reviews, control.id, { findingId: candidate.contradictionId, page: 1, pageSize: 1 })
    records.push({ findingId: candidate.contradictionId, type: 'CONTRADICTION', domain: candidate.domain,
      severity: candidate.severity, basis: candidate.basis, evidencePairHash: review.evidencePairHash,
      reviewStatus: review.reviewStatus, evidence: review.evidence, latestReview: recorded.records[0] ?? null,
      priority: { available: false, reason: 'GOVERNED_PRIORITY_NOT_RECORDED' }, consequences: 'UNAVAILABLE' })
  }
  const open = r => !['NOT_CONTRADICTORY', 'CONFIRMED'].includes(r.reviewStatus)
  const populations = { detected: records.length, open: records.filter(open).length, recorded: records.filter(r => r.latestReview).length,
    counting: 'OVERLAPPING_INSPECTION_POPULATIONS' }
  const search = selection.search.toLowerCase()
  const filtered = records.filter(r => (selection.population === 'DETECTED' || selection.population === 'OPEN' && open(r)
    || selection.population === 'RECORDED' && r.latestReview) && (!search || [r.findingId, r.domain, r.basis,
      ...r.evidence.flatMap(e => [e.evidenceObjectId, e.sourceId, e.extractedFact])].some(value => value.toLowerCase().includes(search))))
    .sort((a, b) => (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0) * (selection.sort === 'ID_DESC' ? -1 : 1))
  return { available: true, completeness: 'COMPLETE_STORED_DETECTIONS', reason: null, ...selection,
    total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / selection.pageSize)), populations,
    allTypesCompleteness: 'UNAVAILABLE', detectionPolicy,
    records: filtered.slice((selection.page - 1) * selection.pageSize, selection.page * selection.pageSize) }
}
