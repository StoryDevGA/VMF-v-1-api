import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import AuditLog from '../models/AuditLog.js'
import { createSectionHistoryReadContext } from './runtimeSectionHistoryContract.js'
import { PUBLISHED_DISPOSITION_POLICY } from '../constants/publishedDispositionRecoveryPolicy.js'
import { isSyntheticRevisionTestRuntime } from '../constants/syntheticRevisionTestPolicy.js'
import { assertEvidenceMembershipBody, buildEvidenceMembershipBody, evidenceMaterialHash, evidenceSnapshotScope,
  evidenceSnapshotPackage, membershipHash, membershipJson, membershipError, EVIDENCE_MEMBERSHIP_VERSION,
  EVIDENCE_MEMBER_LIMITS, EVIDENCE_MATERIAL_HASH_ALGORITHM } from './runtimeEvidenceSnapshotContract.js'

const families = { sources: ['runtime_evidence_sources', 'sourceId'], evidence: ['runtime_evidence_objects', 'evidenceObjectId'], sections: ['runtime_section_states', 'sectionKey'] }
const snapshotIdPattern = /^evidence_snapshot_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const requireValue = (condition, reason) => { if (!condition) throw membershipError(reason) }
const actorId = actor => String(actor && typeof actor === 'object' && !(actor instanceof mongoose.Types.ObjectId)
  ? actor.id || actor._id || '' : actor || '')
const assertLockAudit = ({ audit, body, pointer, actorUserId, auditId, signatureVersion }) => {
  requireValue(audit && String(audit.id || audit._id) === String(auditId)
    && mongoose.isValidObjectId(auditId) && Number.isSafeInteger(signatureVersion) && signatureVersion > 0
    && audit.signatureVersion === signatureVersion && actorId(audit.actorUserId) === actorId(actorUserId)
    && mongoose.isValidObjectId(actorId(actorUserId)) && audit.action === 'RUNTIME_ACTION_EXECUTED'
    && audit.resourceType === 'RuntimeInstance' && String(audit.resourceId) === body.scope.runtimeInstanceId
    && ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].every(key => String(audit.scope?.[key]) === body.scope[key])
    && audit.diff?.actionKey === 'LOCK_RECORD' && audit.diff?.actionedAt === body.lockTruthRecord.snapshotAt
    && membershipHash(audit.diff?.evidenceMembershipSnapshot) === membershipHash({ ...pointer, counts: body.counts }), 'AUDIT_LINK_INVALID')
}
const collection = name => mongoose.connection.db.collection(name)
const queryOptions = ({ session, readBudget } = {}) => ({ ...(session ? { session } : {}), maxTimeMS: 2000, ...(readBudget ? readBudget() : {}) })
const scoped = scope => ({ customerId: new mongoose.Types.ObjectId(scope.customerId), tenantId: new mongoose.Types.ObjectId(scope.tenantId), runtimeInstanceId: new mongoose.Types.ObjectId(scope.runtimeInstanceId), runtimeInstanceKey: scope.runtimeInstanceKey })
const readRows = async (kind, filter, options, deps) => {
  const rows = await (deps.readRows ? deps.readRows(kind, filter, options) : collection(families[kind][0]).find(filter, queryOptions(options))
    .sort({ [families[kind][1]]: 1, _id: 1 }).limit(EVIDENCE_MEMBER_LIMITS[kind] + 1).toArray())
  requireValue(Array.isArray(rows) && rows.length <= EVIDENCE_MEMBER_LIMITS[kind], 'MEMBER_BOUND')
  return rows
}
const verifySectionHistory = async (rows, { session, readBudget }, deps) => {
  try {
    return await createSectionHistoryReadContext({
      session, readBudget,
      readRows: (filter, options) => deps.readSectionHistoryRows
        ? deps.readSectionHistoryRows(filter, options)
        : collection('runtime_section_states').find(filter, queryOptions(options)).limit(2).toArray(),
    }).verify(rows)
  } catch (error) {
    if (error.code === 'RUNTIME_SECTION_HISTORY_INVALID') throw membershipError(error.details?.reason || 'SECTION_HISTORY_INVALID')
    throw error
  }
}
export const prepareRuntimeEvidenceSnapshot = async ({ runtime, session, snapshotId = `evidence_snapshot_${randomUUID()}`, deps = {} }) => {
  requireValue(session?.inTransaction?.() === true, 'TRANSACTION_REQUIRED')
  requireValue(snapshotIdPattern.test(snapshotId), 'SNAPSHOT_ID_INVALID')
  requireValue(runtime.status === 'LOCKED' && runtime.framework_state?.lock?.locked === true, 'LOCK_INVALID')
  const scope = evidenceSnapshotScope(runtime)
  const rows = {}
  for (const kind of Object.keys(families)) rows[kind] = await readRows(kind, { ...scoped(scope), current: true, stateVersion: runtime.stateVersion }, { session }, deps)
  await verifySectionHistory(rows.sections, { session }, deps)
  const body = buildEvidenceMembershipBody({ runtime, lockTruthRecord: runtime.framework_state.lock.snapshot, ...rows })
  const pointer = { contractVersion: EVIDENCE_MEMBERSHIP_VERSION, snapshotId, membershipHash: membershipHash(body),
    basisStateVersion: body.basisStateVersion, lockSnapshotId: body.lockTruthRecord.snapshotId, lockSnapshotHash: body.lockTruthRecord.snapshotHash }
  return { body, pointer }
}
export const persistRuntimeEvidenceSnapshot = async ({ prepared, actorUserId, audit, session, deps = {} }) => {
  requireValue(session?.inTransaction?.() === true, 'TRANSACTION_REQUIRED')
  requireValue(mongoose.isValidObjectId(audit?.id) && Number.isSafeInteger(audit?.signatureVersion) && audit.signatureVersion > 0, 'AUDIT_LINK_INVALID')
  const body = assertEvidenceMembershipBody(prepared.body)
  requireValue(membershipHash(body) === prepared.pointer.membershipHash, 'BODY_HASH_INVALID')
  assertLockAudit({ audit, body, pointer: prepared.pointer, actorUserId, auditId: audit.id, signatureVersion: audit.signatureVersion })
  // Fresh document for each transaction callback; an aborted document is never reused.
  const document = { ...body.scope, ...prepared.pointer, body, createdBy: actorUserId,
    createdAt: body.lockTruthRecord.snapshotAt, lockAuditId: audit.id, lockAuditSignatureVersion: audit.signatureVersion }
  const result = await (deps.model || RuntimeEvidenceSnapshot).create([document], { session })
  requireValue(result?.length === 1, 'SNAPSHOT_WRITE_INVALID')
  return result[0]
}
export const readVerifiedRuntimeEvidenceSnapshot = async ({ runtime, pointer, session = null, readBudget, deps = {} }) => {
  requireValue(snapshotIdPattern.test(pointer?.snapshotId), 'SNAPSHOT_ID_INVALID')
  const scope = evidenceSnapshotScope(runtime)
  const filter = { ...scoped(scope), snapshotId: pointer?.snapshotId }
  const documents = await (deps.readSnapshots ? deps.readSnapshots(filter, { session, readBudget })
    : collection('runtime_evidence_snapshots').find(filter, queryOptions({ session, readBudget })).limit(2).toArray())
  requireValue(documents?.length === 1, 'SNAPSHOT_MISSING_OR_AMBIGUOUS')
  const doc = documents[0]
  if (String(doc._id) === '6ad267752b7668e0c1ae01af' && scope.runtimeInstanceId === PUBLISHED_DISPOSITION_POLICY.scope.runtimeInstanceId) {
    const { resolveRuntimeEvidenceSnapshotCorrection } = await import('./runtimeEvidenceSnapshotRecoveryService.js')
    try { return await resolveRuntimeEvidenceSnapshotCorrection({ runtime, pointer, doc, session, readBudget, deps }) }
    catch (error) {
      if (error.code !== 'SNAPSHOT_RECOVERY_INVALID') throw error
      throw membershipError(error.details?.reason || 'CORRECTION_INVALID')
    }
  }
  return verifyRuntimeEvidenceSnapshotDocument({ runtime, pointer, doc, session, readBudget, deps })
}
// Preserve the public inventory DTO consumed by the existing strict client.
// The dedicated recovery read owns correction provenance; internal readers keep it.
export const projectPublicEvidenceSnapshotInventory = inventory => {
  const result = { ...inventory }
  delete result.serializationCorrection
  return result
}
// Shared strict verifier: recovery supplies the original document metadata with
// a separately attested body, never recurses through the public lookup reader.
export const verifyRuntimeEvidenceSnapshotDocument = async ({ runtime, pointer, doc, session = null, readBudget, deps = {} }) => {
  requireValue(snapshotIdPattern.test(pointer?.snapshotId), 'SNAPSHOT_ID_INVALID')
  const scope = evidenceSnapshotScope(runtime), body = assertEvidenceMembershipBody(doc.body)
  requireValue(membershipHash(body.scope) === membershipHash(scope) && membershipHash(body.package) === membershipHash(evidenceSnapshotPackage(runtime))
    && body.basisStateVersion === runtime.stateVersion && membershipHash(body) === doc.membershipHash
    && body.lockTruthRecord.snapshotAt === new Date(runtime.lockedAt).toISOString()
    && membershipHash(body.lockTruthRecord) === membershipHash(membershipJson(runtime.framework_state?.lock?.snapshot)), 'SNAPSHOT_BINDING_INVALID')
  requireValue(membershipHash(pointer) === membershipHash({ contractVersion: doc.contractVersion, snapshotId: doc.snapshotId,
    membershipHash: doc.membershipHash, basisStateVersion: doc.basisStateVersion, lockSnapshotId: doc.lockSnapshotId, lockSnapshotHash: doc.lockSnapshotHash }), 'POINTER_BINDING_INVALID')
  requireValue(Object.entries(scope).every(([key, value]) => String(doc[key] ?? '') === String(value)) && doc.contractVersion === EVIDENCE_MEMBERSHIP_VERSION
    && doc.basisStateVersion === body.basisStateVersion && doc.lockSnapshotId === body.lockTruthRecord.snapshotId && doc.lockSnapshotHash === body.lockTruthRecord.snapshotHash, 'DOCUMENT_BINDING_INVALID')
  requireValue(Number.isFinite(new Date(doc.createdAt).getTime()) && new Date(doc.createdAt).toISOString() === body.lockTruthRecord.snapshotAt
    && actorId(doc.createdBy) === actorId(runtime.lockedBy) && mongoose.isValidObjectId(actorId(doc.createdBy)), 'DOCUMENT_BINDING_INVALID')
  const observed = {}
  for (const kind of Object.keys(families)) {
    observed[kind] = body[kind].length ? await readRows(kind, { ...scoped(scope), stateVersion: body.basisStateVersion,
      _id: { $in: body[kind].map(member => new mongoose.Types.ObjectId(member.storageId)) } }, { session, readBudget }, deps) : []
    requireValue(observed[kind].length === body[kind].length, 'MEMBER_MISSING')
    for (const member of body[kind]) {
      const row = observed[kind].find(item => String(item._id) === member.storageId)
      requireValue(row && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(row[key]) === scope[key])
        && row.runtimeInstanceKey === scope.runtimeInstanceKey && row.stateVersion === body.basisStateVersion
        && row.sourceStateVersion === body.basisStateVersion && evidenceMaterialHash(row) === member.materialHash, 'MEMBER_MATERIAL_CHANGED')
    }
  }
  await verifySectionHistory(observed.sections, { session, readBudget }, deps)
  // Rebuild all members/references with historical rows. Housekeeping currency
  // is deliberately independent of the immutable material projection.
  const rebuilt = buildEvidenceMembershipBody({ runtime, lockTruthRecord: body.lockTruthRecord,
    contextBindingSectionKeys: body.sections.filter(row => Object.hasOwn(row, 'contextBindings')).map(row => row.sectionKey),
    ...Object.fromEntries(Object.entries(observed).map(([kind, rows]) => [kind, rows.map(row => ({ ...row, current: true }))])) })
  requireValue(membershipHash(rebuilt) === membershipHash(body), 'MEMBERSHIP_CHANGED')
  const audit = await (deps.readAudit ? deps.readAudit(doc.lockAuditId, { session, readBudget })
    : collection('auditlogs').findOne({ _id: doc.lockAuditId, resourceId: new mongoose.Types.ObjectId(scope.runtimeInstanceId),
      action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
      'scope.customerId': new mongoose.Types.ObjectId(scope.customerId), 'scope.tenantId': new mongoose.Types.ObjectId(scope.tenantId),
      'scope.runtimeInstanceId': new mongoose.Types.ObjectId(scope.runtimeInstanceId), 'scope.runtimeInstanceKey': scope.runtimeInstanceKey }, queryOptions({ session, readBudget })))
  assertLockAudit({ audit, body, pointer, actorUserId: doc.createdBy, auditId: doc.lockAuditId, signatureVersion: doc.lockAuditSignatureVersion })
  requireValue(AuditLog.hydrate(audit).verifySignature(), 'AUDIT_SIGNATURE_INVALID')
  let publishedFinding
  if (body.scope.runtimeInstanceId === PUBLISHED_DISPOSITION_POLICY.scope.runtimeInstanceId) {
    const { verifyPublishedDispositionLockLink } = await import('./publishedDispositionRecoveryService.js')
    publishedFinding = await verifyPublishedDispositionLockLink({ runtime, audit, session })
  }
  let recordedReviewCompletion
  if (isSyntheticRevisionTestRuntime(runtime)) {
    const link = await (await import('./syntheticRevisionTestService.js')).verifySyntheticRevisionLockLink({ runtime, audit, session })
    if (link) recordedReviewCompletion = { link, lockAuditId: String(audit._id || audit.id),
      lockAuditSignatureVersion: audit.signatureVersion, lockAuditHash: membershipHash(audit) }
  }
  if (deps.onVerifiedMembership) await deps.onVerifiedMembership({ body, observed, publishedFinding,
    ...(recordedReviewCompletion ? { recordedReviewCompletion } : {}) })
  return { available: true, completeness: 'VERIFIED', reason: null, contractVersion: EVIDENCE_MEMBERSHIP_VERSION,
    snapshotId: doc.snapshotId, membershipHash: doc.membershipHash, basisStateVersion: doc.basisStateVersion,
    lockSnapshotId: doc.lockSnapshotId, lockSnapshotHash: doc.lockSnapshotHash, revisionNumber: scope.revisionNumber,
    counts: { ...body.counts }, verification: { basis: 'EXACT_PERSISTED_MEMBERSHIP', materialHashAlgorithm: EVIDENCE_MATERIAL_HASH_ALGORITHM, auditLinkVerified: true } }
}
