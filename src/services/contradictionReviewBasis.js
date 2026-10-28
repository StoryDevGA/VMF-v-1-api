import mongoose from 'mongoose'
import { isDeepStrictEqual } from 'node:util'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { projectContradictionEvidence, isBoundedContradictionReviewHistory } from './discoveryContradictionReviewService.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'

const fail = reason => { throw Object.assign(new Error('The original contradiction review basis cannot be verified.'), {
  code: 'CONTRADICTION_REVIEW_BASIS_INVALID', status: 409, details: { reason },
}) }
const need = (value, reason) => { if (!value) fail(reason) }
const scopeOf = control => ({ runtimeInstanceId: String(control.id || control._id || ''),
  runtimeInstanceKey: control.runtimeInstanceKey, customerId: String(control.customerId || ''),
  tenantId: String(control.tenantId || ''), stateVersion: requireCanonicalRuntimeStateVersion(control) })
const selectedIds = candidates => {
  need(Array.isArray(candidates) && candidates.length <= 8 && new Set(candidates.map(c => c?.contradictionId)).size === candidates.length
    && candidates.every(c => typeof c?.contradictionId === 'string' && c.contradictionId && Array.isArray(c.evidenceObjectIds)
      && c.evidenceObjectIds.length === 2 && new Set(c.evidenceObjectIds).size === 2
      && c.evidenceObjectIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 240)), 'CANDIDATE_BOUND')
  return [...new Set(candidates.flatMap(c => c.evidenceObjectIds))]
}
const optionalString = value => value === undefined || typeof value === 'string'

// Original v1 hash inputs are not the registry-enriched display projection.
// No root field may supply missing typed evidence or change a stored review.
export const reconcileContradictionReviewBasis = ({ control, candidates, reviews, reviewEpoch, evidenceRows, sourceRows, basis }) => {
  const scope = scopeOf(control), ids = selectedIds(candidates)
  need(basis?.version === 1 && Object.keys(scope).every(k => String(basis.scope?.[k] || '') === scope[k]), 'SCOPE_CHANGED')
  need(isDeepStrictEqual(basis.candidates, candidates) && isDeepStrictEqual(basis.reviews, reviews)
    && basis.reviewEpoch === reviewEpoch && (reviews === undefined || isBoundedContradictionReviewHistory(reviews)), 'REVIEW_WITNESS_CHANGED')
  if (control.updatedAt) need(new Date(basis.updatedAt).toISOString() === new Date(control.updatedAt).toISOString(), 'CONTROL_CHANGED')
  need(Buffer.byteLength(JSON.stringify(basis)) <= 512 * 1024, 'PROJECTION_BOUND')
  need(Array.isArray(evidenceRows) && evidenceRows.length === ids.length
    && new Set(evidenceRows.map(e => e.evidenceObjectId)).size === ids.length
    && Array.isArray(basis.evidence) && basis.evidence.length === ids.length
    && new Set(basis.evidence.map(e => e.evidenceObjectId)).size === ids.length, 'EVIDENCE_MEMBERSHIP_CHANGED')
  const sourceIds = [...new Set(evidenceRows.map(e => e.sourceId))]
  need(Array.isArray(basis.sources) && basis.sources.length === sourceIds.length && basis.sources.length <= 16
    && new Set(basis.sources.map(s => s.sourceId)).size === sourceIds.length, 'SOURCE_MEMBERSHIP_CHANGED')
  if (sourceRows !== undefined) {
    need(Array.isArray(sourceRows) && sourceRows.length === sourceIds.length
      && new Set(sourceRows.map(s => s.sourceId)).size === sourceIds.length, 'TYPED_SOURCE_MEMBERSHIP_CHANGED')
    for (const source of sourceRows) {
      const registered = basis.sources.find(s => s.sourceId === source.sourceId)
      need(registered && source.current === true && source.isCurrent !== false
        && (!source.stateStatus || source.stateStatus === 'CURRENT') && (!source.status || source.status === 'CURRENT')
        && String(source.runtimeInstanceId) === scope.runtimeInstanceId && source.runtimeInstanceKey === scope.runtimeInstanceKey
        && String(source.customerId) === scope.customerId && String(source.tenantId) === scope.tenantId
        && source.stateVersion === scope.stateVersion && source.sourceStateVersion === scope.stateVersion
        && typeof source.sourceType === 'string' && source.sourceType.trim().toUpperCase() === registered.sourceType?.trim().toUpperCase(),
      'TYPED_SOURCE_CHANGED')
    }
  }
  return ids.map(id => {
    const typed = evidenceRows.find(e => e.evidenceObjectId === id), original = basis.evidence.find(e => e.evidenceObjectId === id)
    need(typed && original && typed.current === true && typed.isCurrent !== false
      && (!typed.stateStatus || typed.stateStatus === 'CURRENT') && (!typed.status || typed.status === 'CURRENT')
      && String(typed.runtimeInstanceId) === scope.runtimeInstanceId && typed.runtimeInstanceKey === scope.runtimeInstanceKey
      && String(typed.customerId) === scope.customerId && String(typed.tenantId) === scope.tenantId
      && typed.stateVersion === scope.stateVersion && typed.sourceStateVersion === scope.stateVersion, 'TYPED_CURRENTNESS_CHANGED')
    for (const e of [typed, original]) need(typeof e.sourceId === 'string' && e.sourceId.length > 0
      && typeof e.extractedFact === 'string' && e.extractedFact.length > 0 && e.extractedFact.length <= 8000
      && ['PENDING', 'ACCEPTED', 'REJECTED'].includes(e.reviewStatus)
      && ['sourceType', 'lineageRef', 'validationStatus'].every(k => optionalString(e[k])), 'EVIDENCE_FIELDS_INVALID')
    const raw = projectContradictionEvidence(original), projected = projectContradictionEvidence(typed)
    const source = basis.sources.find(s => s.sourceId === raw.sourceId)
    need(source && typeof source.sourceType === 'string' && source.sourceType.trim().length > 0, 'SOURCE_REQUIRED')
    const registeredType = source.sourceType.trim().toUpperCase()
    need((!raw.sourceType || raw.sourceType === registeredType)
      && (projected.sourceType === raw.sourceType || !raw.sourceType && projected.sourceType === registeredType), 'SOURCE_TYPE_CONFLICT')
    need(isDeepStrictEqual({ ...projected, sourceType: raw.sourceType }, raw), 'EVIDENCE_CHANGED')
    return raw
  })
}

export const readContradictionReviewBasis = async ({ control, candidates, reviews, reviewEpoch, evidenceRows, sourceRows,
  session = null, readBudget, maxTimeMS = 2000 }) => {
  const ids = selectedIds(candidates)
  if (!ids.length) return null
  const scope = scopeOf(control)
  need(['runtimeInstanceId', 'customerId', 'tenantId'].every(k => mongoose.isValidObjectId(scope[k]))
    && typeof scope.runtimeInstanceKey === 'string' && scope.runtimeInstanceKey.length > 0, 'SCOPE_REQUIRED')
  const updatedAt = control.updatedAt ? new Date(control.updatedAt) : null
  need(session || updatedAt && Number.isFinite(updatedAt.getTime()), 'CURRENT_READ_REQUIRED')
  const filter = { _id: new mongoose.Types.ObjectId(scope.runtimeInstanceId), customerId: new mongoose.Types.ObjectId(scope.customerId),
    tenantId: new mongoose.Types.ObjectId(scope.tenantId), runtimeInstanceKey: scope.runtimeInstanceKey, stateVersion: scope.stateVersion,
    ...(updatedAt ? { updatedAt } : {}) }
  const sourceIds = [...new Set(evidenceRows.map(e => e.sourceId))]
  need(sourceIds.length <= 16 && evidenceRows.length === ids.length, 'TYPED_MEMBERSHIP_REQUIRED')
  const selected = (path, field, values) => ({ $slice: [{ $filter: { input: { $ifNull: [path, []] }, as: 'item',
    cond: { $in: ['$$item.' + field, values] } } }, 17] })
  const fields = keys => Object.fromEntries(keys.map(k => [k, '$$item.' + k]))
  const results = await RuntimeInstance.aggregate([
    { $match: filter }, { $limit: 2 }, { $project: { _id: 0, version: { $literal: 1 }, scope: { $literal: scope }, updatedAt: 1,
      candidates: { $slice: [{ $ifNull: ['$framework_state.evidence_pack.discoveryHealth.contradictionCandidates', []] }, 9] },
      reviews: { $cond: [{ $isArray: '$framework_state.evidence_pack.contradictionReviews' },
        { $slice: ['$framework_state.evidence_pack.contradictionReviews', 1001] }, '$framework_state.evidence_pack.contradictionReviews'] },
      reviewEpoch: '$framework_state.evidence_pack.contradictionReviewEpoch',
      evidence: { $map: { input: selected('$framework_state.evidence_pack.evidenceObjects', 'evidenceObjectId', ids), as: 'item',
        in: fields(['evidenceObjectId', 'sourceId', 'sourceType', 'lineageRef', 'extractedFact', 'reviewStatus', 'validationStatus']) } },
      sources: { $map: { input: selected('$framework_state.evidence_pack.sourceRegistry', 'sourceId', sourceIds), as: 'item',
        in: fields(['sourceId', 'sourceType']) } },
    } },
  ]).session(session).option(readBudget ? readBudget() : { maxTimeMS })
  need(results.length === 1, 'CURRENT_BASIS_MISSING')
  reconcileContradictionReviewBasis({ control, candidates, reviews, reviewEpoch, evidenceRows, sourceRows, basis: results[0] })
  return results[0]
}
