import mongoose from 'mongoose'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { createRuntimeStateLegacySourceRowSet } from './runtimeStateLegacyMapper.js'
import { createSectionHistoryReadContext, createSectionHistoryProjectors, getSectionHistoryRowKey } from './runtimeSectionHistoryContract.js'
import { normalizeRuntimeSectionObject } from './runtimeSectionModelService.js'
import { assertEvidenceDraftQualification } from './evidenceDraftQualification.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'
import Section from '../models/RuntimeStateSection.js'
import Source from '../models/RuntimeEvidenceSource.js'
import Evidence from '../models/RuntimeEvidenceObject.js'
import Audit from '../models/AuditLog.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'

export const syntheticRevisionFailure = (reason, status = 409) => {
  throw Object.assign(new Error('The R3 test-only prerequisite cannot be verified.'), { code: 'SYNTHETIC_REVISION_TEST_INVALID', status, details: { reason } })
}
export const requireSyntheticRevision = (condition, reason) => { if (!condition) syntheticRevisionFailure(reason) }
const need = requireSyntheticRevision
export const syntheticRevisionRows = async (collection, filter, session, cap) => {
  const rows = await mongoose.connection.db.collection(collection).find(filter, { session, maxTimeMS: 3000 })
    .sort({ _id: 1 }).limit(cap + 1).toArray()
  need(rows.length <= cap, 'READ_BOUND')
  return rows
}
const fields = row => {
  const value = membershipJson(row)
  for (const key of ['_id', '__v', 'createdAt', 'updatedAt', 'current']) delete value[key]
  return value
}
// A stable evidence hash is not permission to invent a new runtime state. Only
// signed native lifecycle transitions may carry this exact test population on.
export const verifySyntheticRevisionTransitions = async (runtime, session, deps = {}) => {
  if (runtime.stateVersion === p.initialStateVersion) return
  const read = deps.readRows || syntheticRevisionRows
  const allowed = ['RUN_VALIDATION', 'MARK_READY', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH', 'LOCK_RECORD']
  let version = runtime.stateVersion, timestamp = new Date(runtime.updatedAt).toISOString()
  const seen = new Set()
  for (let step = 0; step < 16 && version !== p.initialStateVersion; step++) {
    need(!seen.has(version), 'STATE_TRANSITION_CYCLE'); seen.add(version)
    const rows = await read('auditlogs', { resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId),
      action: 'RUNTIME_ACTION_EXECUTED', 'scope.runtimeInstanceId': new mongoose.Types.ObjectId(p.runtimeInstanceId),
      'diff.syntheticTestStateTransition.to': version }, session, 1)
    const a = rows[0], transition = a?.diff?.syntheticTestStateTransition
    need(rows.length === 1 && Audit.hydrate(a).verifySignature() && a.resourceType === 'RuntimeInstance'
      && ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].every(k => String(a.scope?.[k]) === p[k])
      && allowed.includes(a.diff?.actionKey) && a.diff.updatedAtAfter === timestamp
      && a.diff.runtimeStateSource?.sourceSetHash && transition?.to === version
      && /^rsv2:[a-f0-9-]{36}$/.test(transition.from)
      && Number.isFinite(Date.parse(a.diff.updatedAtBefore)), 'SIGNED_STATE_TRANSITION_REQUIRED')
    version = transition.from; timestamp = new Date(a.diff.updatedAtBefore).toISOString()
  }
  need(version === p.initialStateVersion && timestamp === p.initialUpdatedAt, 'STATE_TRANSITION_BOUND')
}
export const compileQualifiedRevisionMaterial = async (runtime, session, deps = {}) => {
  const read = deps.readRows || syntheticRevisionRows
  const scope = Object.fromEntries(['customerId', 'tenantId'].map(key => [key, new mongoose.Types.ObjectId(p[key])]))
  scope.runtimeInstanceId = new mongoose.Types.ObjectId(p.runtimeInstanceId)
  need(String(runtime._id || runtime.id) === p.runtimeInstanceId && runtime.runtimeInstanceKey === p.runtimeInstanceKey
    && ['customerId', 'tenantId'].every(key => String(runtime[key]) === p[key])
    && runtime.revision?.revisionNumber === 3 && runtime.revision.createdFromRevision === 2
    && String(runtime.revision.parentRuntimeId) === p.parentRuntimeId && String(runtime.revision.rootRuntimeId) === p.rootRuntimeId
    && runtime.runtimeType === 'VALUE_NARRATIVE' && runtime.frameworkKey === 'VMF'
    && runtime.packageVersion === '3.2.0', 'EXACT_SCOPE_REQUIRED')
  need(/^rsv2:[a-f0-9-]{36}$/.test(requireCanonicalRuntimeStateVersion(runtime)), 'STATE_INVALID')
  const pack = runtime.framework_state?.evidence_pack, sections = runtime.framework_state?.sections
  need(pack && sections && pack.evidenceObjects?.length === 47 && pack.sourceRegistry?.length === 8
    && Object.keys(sections).length === 6 && pack.evidenceObjects.filter(e => e.reviewStatus === 'ACCEPTED').length === 12
    && pack.evidenceObjects.filter(e => e.reviewStatus === 'REJECTED').length === 35, 'POPULATION_CHANGED')
  for (const e of pack.evidenceObjects) {
    const actor = e.reviewStatus === 'ACCEPTED' ? e.acceptedBy : e.rejectedBy
    const time = e.reviewStatus === 'ACCEPTED' ? e.acceptanceTimestamp : e.rejectionTimestamp
    need(mongoose.isValidObjectId(actor) && Number.isFinite(Date.parse(time)), 'DISPOSITION_PROVENANCE_REQUIRED')
    if (e.reviewStatus === 'ACCEPTED') {
      const keys = Object.entries(sections).filter(([, s]) => (s.accepted?.supportingEvidenceRefs || [])
        .some(ref => ref === e.evidenceObjectId || ref === e.sourceId)).map(([key]) => key).sort()
      need(Boolean(assertEvidenceDraftQualification({ evidence: e, source: pack.sourceRegistry.find(s => s.sourceId === e.sourceId),
        sourceSectionKeys: keys })), 'QUALIFICATION_REQUIRED')
    }
  }
  const rows = {}
  for (const [key, collection, count] of [['sections', 'runtime_section_states', 6], ['evidenceSources', 'runtime_evidence_sources', 8],
    ['evidenceObjects', 'runtime_evidence_objects', 47]]) {
    rows[key] = await read(collection, { ...scope, runtimeInstanceKey: p.runtimeInstanceKey, current: true, stateVersion: runtime.stateVersion }, session, count)
    need(rows[key].length === count && rows[key].every(row => row.current === true && row.stateVersion === runtime.stateVersion
      && row.sourceStateVersion === runtime.stateVersion && String(row.runtimeInstanceId) === p.runtimeInstanceId
      && ['customerId', 'tenantId'].every(k => String(row[k]) === p[k])), 'TYPED_MEMBERSHIP_INVALID')
  }
  const history = createSectionHistoryReadContext({ session,
    readRows: (filter, options) => read('runtime_section_states', filter, options.session, 1) })
  const resolved = await history.verify(rows.sections)
  const projectors = new Map(rows.sections.map(row => [row.sectionKey, createSectionHistoryProjectors({
    observedRow: { ...row, sectionDetail: normalizeRuntimeSectionObject({ value: row.sectionDetail, sectionKey: row.sectionKey,
      runtimePath: `framework_state.sections.${row.sectionKey}`, initializedAt: new Date(row.createdAt).toISOString() }) },
    resolvedRecords: resolved.get(getSectionHistoryRowKey(row)),
  })]))
  const mapped = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: mongoose.mongo.BSON.serialize(runtime).length,
    sections, evidencePack: pack, intelligenceGraph: runtime.framework_state.intelligence_graph },
  scope: { ...scope, runtimeInstanceKey: p.runtimeInstanceKey }, stateVersion: runtime.stateVersion,
  migrationReceiptId: String(rows.sections[0].migrationReceiptId), migrationTimestamp: new Date(rows.sections[0].createdAt).toISOString(),
  }, { sectionDetailProjector: (detail, { sectionKey }) => projectors.get(sectionKey).previous(detail) })
  for (const [key, identity, model] of [['sections', 'sectionKey', Section], ['evidenceSources', 'sourceId', Source], ['evidenceObjects', 'evidenceObjectId', Evidence]]) {
    need(new Set(rows[key].map(row => row[identity])).size === mapped.rows[key].length, 'DUPLICATE_MEMBER')
    for (const expected of mapped.rows[key]) {
      const actual = rows[key].find(row => row[identity] === expected[identity])
      need(actual && membershipHash(fields(model.hydrate(actual).toObject()))
        === membershipHash(fields(model.hydrate(expected).toObject())), 'TYPED_ROOT_MISMATCH')
    }
  }
  const candidates = pack.discoveryHealth?.contradictionCandidates
  need(candidates?.length === 1 && candidates[0].contradictionId === p.contradictionId, 'FINDING_CHANGED')
  const rootPair = getDiscoveryContradictionReview(candidates[0], pack.evidenceObjects, [], p.runtimeInstanceId, pack.contradictionReviewEpoch)
  const typedPair = getDiscoveryContradictionReview(candidates[0], rows.evidenceObjects, [], p.runtimeInstanceId, pack.contradictionReviewEpoch)
  need(rootPair.evidencePairHash === p.rootEvidencePairHash && typedPair.evidencePairHash, 'PAIR_CHANGED')
  // Root and typed pair hashes are intentionally distinct: legacy root types
  // remain blank; registered types were materialized only in the typed records.
  // Stable content hashes exclude lifecycle/state-rollover bookkeeping only.
  const manifest = membershipJson({ version: 1, scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId',
    'runtimeInstanceKey', 'revisionNumber', 'parentRuntimeId', 'rootRuntimeId'].map(key => [key, p[key]])),
  rootEvidencePairHash: rootPair.evidencePairHash, typedEvidencePairHash: typedPair.evidencePairHash,
  sources: pack.sourceRegistry.map(s => ({ id: s.sourceId, hash: membershipHash(s) })).sort((a, b) => a.id.localeCompare(b.id)),
  sections: Object.entries(sections).map(([key, s]) => ({ key, hash: membershipHash({ input: s.input,
    accepted: s.accepted, evidenceObjects: s.evidenceObjects, additionalEvidence: s.additionalEvidence, gsilContext: s.gsilContext }) })).sort((a, b) => a.key.localeCompare(b.key)),
  finding: candidates[0],
  population: pack.evidenceObjects.map(e => ({ id: e.evidenceObjectId, hash: membershipHash(e) })).sort((a, b) => a.id.localeCompare(b.id)),
  retainedHistoryHash: membershipHash(pack.contradictionReviews || []), reviewEpoch: pack.contradictionReviewEpoch,
  package: Object.fromEntries(['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'workspaceId']
    .map(key => [key, String(runtime[key] || '')])), revision: runtime.revision,
  })
  return { stateVersion: runtime.stateVersion, updatedAt: new Date(runtime.updatedAt).toISOString(),
    materialHash: membershipHash(manifest), manifest }
}

export const compileSyntheticRevisionBasis = async (runtime, session, deps = {}) => {
  const basis = await compileQualifiedRevisionMaterial(runtime, session, deps)
  need(basis.materialHash === p.initialMaterialHash, 'APPROVED_TEST_POPULATION_CHANGED')
  await verifySyntheticRevisionTransitions(runtime, session, deps)
  return basis
}
