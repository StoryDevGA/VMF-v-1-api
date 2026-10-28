import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Recovery, { SNAPSHOT_RECOVERY_POLICY as p, assertSnapshotRecovery, snapshotRecoveryError } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { buildEvidenceMembershipBody, membershipHash, membershipJson, evidenceMaterialHash,
  evidenceSnapshotScope, evidenceSnapshotPackage } from './runtimeEvidenceSnapshotContract.js'
import { verifyRuntimeEvidenceSnapshotDocument } from './runtimeEvidenceSnapshotService.js'
import { requirePublishedRecoveryEnvironment, loadPublishedRecoveryRuntime, withPublishedRecoveryTransaction,
  publishedRuntimeWitnessHash } from './publishedDispositionRecoveryService.js'
import { snapshotRecoveryBodySchema } from '../validators/reviewCompletion.validator.js'

const need = (condition, reason, status) => { if (!condition) throw snapshotRecoveryError(reason, status) }
const oid = value => new mongoose.Types.ObjectId(value)
const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, oid(p[key])]))
const options = ({ session = null, readBudget } = {}) => ({ session, maxTimeMS: 2000, ...(readBudget ? readBudget() : {}) })
const rows = (name, filter, limit, context) => mongoose.connection.db.collection(name).find(filter, options(context)).sort({ _id: 1 }).limit(limit).toArray()
const one = (name, filter, context, projection) => mongoose.connection.db.collection(name).findOne(filter, {
  ...options(context), ...(projection ? { projection } : {}),
})
const passiveControlProjection = Object.freeze(Object.fromEntries([
  '_id', 'customerId', 'tenantId', 'runtimeInstanceKey', 'workspaceId', 'revision.revisionNumber', 'revision.rootRuntimeId',
  'revision.rootRuntimeInstanceKey', 'packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId',
  'status', 'stateVersion', 'lockedAt', 'lockedBy', 'updatedAt', 'updatedBy', 'lockedEvidenceSnapshot',
  'framework_state.lock.locked', 'framework_state.lock.snapshot.snapshotId', 'framework_state.lock.snapshot.snapshotHash',
  'framework_state.lock.snapshot.snapshotAt', 'framework_state.lock.snapshot.contractVersion', 'framework_state.lock.snapshot.actionKey',
].map(key => [key, 1])))
const signed = audit => audit && AuditLog.hydrate(audit).verifySignature() === true
const receiptFilter = () => ({ ...scope(), originalSnapshotStorageId: oid(p.snapshotStorageId) })
const readCorrection = async context => {
  const found = await rows(Recovery.collection.name, receiptFilter(), 2, context)
  need(found.length <= 1, 'CORRECTION_AMBIGUOUS')
  return found[0] || null
}
const checkRuntime = runtime => {
  need(runtime && ['customerId', 'tenantId'].every(key => String(runtime[key]) === p[key])
    && String(runtime._id || runtime.id) === p.runtimeInstanceId && runtime.runtimeInstanceKey === p.runtimeInstanceKey
    && runtime.revision?.revisionNumber === p.revisionNumber && runtime.stateVersion === p.stateVersion
    && runtime.status === 'LOCKED' && runtime.framework_state?.lock?.locked === true, 'RUNTIME_BINDING')
}
const prepareOriginalBasis = async ({ runtime, doc, pointer, session = null, readBudget, deps = {}, onVerified }) => {
  requirePublishedRecoveryEnvironment()
  checkRuntime(runtime)
  const context = { session, readBudget }
  need(!await one('runtime_synthetic_test_disposition_receipts', scope(), context), 'SYNTHETIC_PIPELINE_HELD')
  need(String(doc?._id) === p.snapshotStorageId && doc.snapshotId === p.snapshotId
    && doc.membershipHash === p.membershipHash && membershipHash(doc.body) === p.failedBodyHash
    && String(doc.lockAuditId) === p.lockAuditId && membershipHash(doc) === p.originalDocumentHash
    && membershipHash(pointer) === membershipHash(runtime.lockedEvidenceSnapshot), 'ORIGINAL_BINDING')
  const material = {}
  for (const [kind, collection, size] of [['sources', 'runtime_evidence_sources', 8], ['evidence', 'runtime_evidence_objects', 47], ['sections', 'runtime_section_states', 6]]) {
    const members = doc.body[kind]
    need(Array.isArray(members) && members.length === size && new Set(members.map(row => row.storageId)).size === size, 'MEMBERSHIP_BOUND')
    material[kind] = await rows(collection, { ...scope(), runtimeInstanceKey: p.runtimeInstanceKey, stateVersion: p.stateVersion,
      _id: { $in: members.map(member => oid(member.storageId)) } }, size + 1, context)
    need(material[kind].length === size, 'MEMBERSHIP_MISSING')
    for (const member of members) {
      const row = material[kind].find(item => String(item._id) === member.storageId)
      need(row && evidenceMaterialHash(row) === member.materialHash, 'MEMBERSHIP_CHANGED')
    }
  }
  const correctedBody = buildEvidenceMembershipBody({ runtime, lockTruthRecord: runtime.framework_state.lock.snapshot,
    ...Object.fromEntries(Object.entries(material).map(([key, values]) => [key, values.map(row => ({ ...row, current: true }))])),
    contextBindingSectionKeys: doc.body.sections.filter(row => row.contextBindings).map(row => row.sectionKey) })
  need(membershipHash(correctedBody) === p.membershipHash, 'CORRECTED_HASH')
  const minimized = membershipJson(correctedBody)
  const empty = minimized.sections.find(row => row.sectionKey === 'output_requirements')
  need(empty && Object.hasOwn(empty, 'references') && Object.keys(empty.references).length === 0, 'LOSS_PATH')
  delete empty.references
  need(membershipHash(minimized) === membershipHash(doc.body), 'LOSS_NOT_EXACT')
  const audit = await one('auditlogs', { _id: oid(p.lockAuditId) }, context)
  need(signed(audit) && audit.signatureVersion === doc.lockAuditSignatureVersion, 'LOCK_SIGNATURE')
  // This is the SAME all-member, pointer, scope, original LOCK and supplemental
  // authority/finding/completion verifier used by ordinary frozen reads.
  const verified = await verifyRuntimeEvidenceSnapshotDocument({ runtime, pointer, doc: { ...doc, body: correctedBody }, session, readBudget, deps })
  if (onVerified) onVerified(verified)
  const nativeReceipts = []
  for (const collection of ['runtime_product_authority_receipts', 'runtime_supplemental_finding_reviews', 'runtime_published_disposition_receipts']) {
    const records = await rows(collection, scope(), 2, context)
    need(records.length === 1, 'NATIVE_RECEIPT_MISSING')
    const record = records[0], receiptAudit = await one('auditlogs', { _id: record.auditId }, context)
    need(membershipHash(record.body) === record.bodyHash && signed(receiptAudit)
      && receiptAudit.signatureVersion === record.auditSignatureVersion, 'NATIVE_RECEIPT_INVALID')
    nativeReceipts.push({ collection, storageId: String(record._id), bodyHash: record.bodyHash,
      auditId: String(record.auditId), auditSignatureVersion: record.auditSignatureVersion })
  }
  return { original: { storageId: String(doc._id), snapshotId: doc.snapshotId, documentHash: membershipHash(doc),
    bodyHash: p.failedBodyHash, lockAuditId: String(doc.lockAuditId), lockAuditSignatureVersion: doc.lockAuditSignatureVersion },
  pointer: membershipJson(pointer), correctedBody, rootMaterialHash: p.rootMaterialHash, nativeReceipts }
}
// Recorder/inspector have the authoritative complete raw root. A serialized
// projection is never used to compute or relax this committed full witness.
const inspectBasis = async args => {
  need(publishedRuntimeWitnessHash(args.runtime) === p.rootMaterialHash, 'ROOT_MATERIAL_CHANGED')
  return prepareOriginalBasis(args)
}
const basisHash = basis => membershipHash(basis)
const inspectRuntime = async (args, session) => {
  need(String(args.actorUserId) === p.actorUserId, 'ACTOR_REQUIRED', 403)
  const runtime = await loadPublishedRecoveryRuntime(args, session)
  checkRuntime(runtime)
  const documents = await rows('runtime_evidence_snapshots', { ...scope(), _id: oid(p.snapshotStorageId), snapshotId: p.snapshotId }, 2, { session })
  need(documents.length === 1, 'SNAPSHOT_MISSING')
  const basis = await inspectBasis({ runtime, doc: documents[0], pointer: runtime.lockedEvidenceSnapshot, session })
  return { runtime, basis }
}
const verifyCorrection = async (record, basis, context) => {
  need(record, 'CORRECTION_REQUIRED')
  const body = assertSnapshotRecovery(record)
  need(record.policyVersion === p.version && String(record.originalSnapshotStorageId) === p.snapshotStorageId
    && membershipHash({ original: body.original, pointer: body.pointer, correctedBody: body.correctedBody,
      rootMaterialHash: body.rootMaterialHash, nativeReceipts: body.nativeReceipts }) === basisHash(basis), 'CORRECTION_BASIS_CHANGED')
  const audit = await one('auditlogs', { _id: record.auditId, action: 'RUNTIME_STATE_MUTATED', resourceType: 'RuntimeInstance',
    resourceId: oid(p.runtimeInstanceId), 'scope.customerId': oid(p.customerId), 'scope.tenantId': oid(p.tenantId),
    'scope.runtimeInstanceId': oid(p.runtimeInstanceId), 'scope.runtimeInstanceKey': p.runtimeInstanceKey }, context)
  need(signed(audit) && audit.signatureVersion === record.auditSignatureVersion && String(audit.actorUserId) === p.actorUserId
    && audit.diff?.action === 'EVIDENCE_SNAPSHOT_SERIALIZATION_CORRECTION' && audit.diff.receiptId === record.receiptId
    && audit.diff.bodyHash === record.bodyHash && audit.diff.originalDocumentHash === body.original.documentHash
    && audit.diff.membershipHash === p.membershipHash && membershipHash(audit.diff.control) === membershipHash({ predecessor: body.predecessor, committed: body.committed }), 'CORRECTION_AUDIT_INVALID')
  return body
}
const dto = record => record ? { receiptId: record.receiptId, bodyHash: record.bodyHash, createdAt: record.body.createdAt,
  originalSnapshotStorageId: p.snapshotStorageId, originalBodyHash: p.failedBodyHash, membershipHash: p.membershipHash,
  auditId: String(record.auditId), authorisesARL: false, authorisesLock: false } : null
const indexesReady = async session => {
  const indexes = await Recovery.collection.listIndexes({ session, maxTimeMS: 2000 }).toArray()
  for (const [name, last] of [['unique_scoped_snapshot_recovery', 'originalSnapshotStorageId'], ['unique_scoped_snapshot_recovery_request', 'requestKey']]) {
    need(indexes.some(index => index.name === name && index.unique === true && !index.sparse && !index.partialFilterExpression
      && membershipHash(index.key) === membershipHash({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [last]: 1 })), 'INDEX_NOT_READY', 503)
  }
}
export const inspectRuntimeEvidenceSnapshotRecovery = args => withPublishedRecoveryTransaction(async session => {
  const { runtime, basis } = await inspectRuntime(args, session), record = await readCorrection({ session })
  if (record) {
    const body = await verifyCorrection(record, basis, { session })
    need(matchControl(runtime, body.committed), 'STALE_CONTROL')
  }
  return { expectedBasisHash: basisHash(basis), expectedUpdatedAt: new Date(runtime.updatedAt).toISOString(),
    originalBodyHash: p.failedBodyHash, membershipHash: p.membershipHash, receipt: dto(record), authorisesARL: false }
})
const matchControl = (runtime, control) => new Date(runtime.updatedAt).toISOString() === control.updatedAt && String(runtime.updatedBy) === control.updatedBy
export const recordRuntimeEvidenceSnapshotRecovery = async args => {
  const parsed = snapshotRecoveryBodySchema.safeParse(args.payload)
  need(parsed.success, 'REQUEST_INVALID', 422)
  const payload = parsed.data, payloadHash = membershipHash({ ...payload, actorUserId: String(args.actorUserId) })
  requirePublishedRecoveryEnvironment()
  need(String(args.actorUserId) === p.actorUserId, 'ACTOR_REQUIRED', 403)
  // MongoDB catalog inspection is not permitted inside a transaction.
  await indexesReady(null)
  const attempt = async () => withPublishedRecoveryTransaction(async session => {
    const { runtime, basis } = await inspectRuntime(args, session)
    const record = await readCorrection({ session })
    if (record) {
      const body = await verifyCorrection(record, basis, { session })
      need(record.requestKey === payload.requestKey && record.payloadHash === payloadHash
        && payload.expectedUpdatedAt === body.predecessor.updatedAt && matchControl(runtime, body.committed), 'REPLAY_CONFLICT')
      return { receipt: dto(record), replay: true }
    }
    need(payload.expectedBasisHash === basisHash(basis) && payload.expectedUpdatedAt === new Date(runtime.updatedAt).toISOString(), 'STALE_BASIS')
    const createdAt = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1)).toISOString()
    const predecessor = { updatedAt: new Date(runtime.updatedAt).toISOString(), updatedBy: String(runtime.updatedBy) }
    const committed = { updatedAt: createdAt, updatedBy: p.actorUserId }
    const guarded = await RuntimeInstance.collection.updateOne({ _id: oid(p.runtimeInstanceId), customerId: oid(p.customerId), tenantId: oid(p.tenantId), stateVersion: p.stateVersion,
      updatedAt: runtime.updatedAt, updatedBy: runtime.updatedBy, status: 'LOCKED', 'framework_state.lock.locked': true,
      lockedEvidenceSnapshot: runtime.lockedEvidenceSnapshot }, { $set: { updatedAt: new Date(createdAt), updatedBy: oid(p.actorUserId) } }, options({ session }))
    need(guarded.modifiedCount === 1, 'STALE_CONTROL')
    const receiptId = randomUUID(), body = membershipJson({ policyVersion: p.version, receiptId, requestKey: payload.requestKey,
      payloadHash, actorUserId: p.actorUserId, createdAt, rationale: payload.rationale, ...basis, predecessor, committed,
      requestBasis: { expectedBasisHash: payload.expectedBasisHash, expectedUpdatedAt: payload.expectedUpdatedAt, rationale: payload.rationale, confirm: true } })
    const bodyHash = membershipHash(body)
    const audit = await auditService.log({ actorUserId: p.actorUserId, action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeInstance, resourceId: runtime._id, scope: { ...scope(), runtimeInstanceKey: p.runtimeInstanceKey },
      requestId: args.auditRequest?.requestId, diff: { action: 'EVIDENCE_SNAPSHOT_SERIALIZATION_CORRECTION', receiptId, bodyHash,
        originalDocumentHash: basis.original.documentHash, membershipHash: p.membershipHash, control: { predecessor, committed } } }, { session, throwOnError: true })
    need(audit?._id && signed(audit.toObject ? audit.toObject() : audit), 'AUDIT_WRITE_FAILED', 503)
    const [saved] = await Recovery.create([{ ...scope(), policyVersion: p.version, originalSnapshotStorageId: oid(p.snapshotStorageId),
      receiptId, requestKey: payload.requestKey, payloadHash, bodyHash, body, auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
    await verifyCorrection(saved.toObject(), basis, { session })
    return { receipt: dto(saved), replay: false }
  })
  try { return await attempt() } catch (error) {
    if (error.code !== 11000) throw error
    // Known duplicate only: read an exact committed winner, never redispatch.
    return withPublishedRecoveryTransaction(async session => {
      const { runtime, basis } = await inspectRuntime(args, session), record = await readCorrection({ session })
      const body = await verifyCorrection(record, basis, { session })
      need(record.requestKey === payload.requestKey && record.payloadHash === payloadHash && matchControl(runtime, body.committed), 'REPLAY_CONFLICT')
      return { receipt: dto(record), replay: true }
    })
  }
}
export const resolveRuntimeEvidenceSnapshotCorrection = async ({ runtime, pointer, doc, session = null, readBudget, deps = {} }) => {
  requirePublishedRecoveryEnvironment()
  checkRuntime(runtime)
  const context = { session, readBudget }
  // The authorized native caller deliberately supplies serialized CONTROL,
  // not the complete legacy root or its private snapshot pointer. Re-read only
  // bounded raw control in the same session/budget; do not fetch legacy truth.
  const fresh = await one('runtime_instances', { _id: oid(p.runtimeInstanceId), customerId: oid(p.customerId), tenantId: oid(p.tenantId) },
    context, passiveControlProjection)
  checkRuntime(fresh)
  need(Buffer.byteLength(JSON.stringify(membershipJson(fresh))) <= 16384, 'CONTROL_BOUND')
  need(membershipHash(evidenceSnapshotScope(runtime)) === membershipHash(evidenceSnapshotScope(fresh))
    && membershipHash(evidenceSnapshotPackage(runtime)) === membershipHash(evidenceSnapshotPackage(fresh))
    && runtime.framework_state?.lock?.snapshot && fresh.framework_state?.lock?.snapshot
    && membershipHash(runtime.framework_state.lock.snapshot) === membershipHash(fresh.framework_state.lock.snapshot)
    && String(runtime.lockedBy) === String(fresh.lockedBy)
    && Number.isFinite(new Date(runtime.lockedAt).getTime()) && new Date(runtime.lockedAt).toISOString() === new Date(fresh.lockedAt).toISOString()
    && Number.isFinite(new Date(runtime.updatedAt).getTime()) && new Date(runtime.updatedAt).toISOString() === new Date(fresh.updatedAt).toISOString()
    && membershipHash(pointer) === membershipHash(fresh.lockedEvidenceSnapshot), 'PASSIVE_CONTROL_CHANGED')
  let result, membershipProof
  const basis = await prepareOriginalBasis({ runtime: fresh, pointer, doc, session, readBudget,
    deps: { ...deps, onVerifiedMembership: value => { membershipProof = value } }, onVerified: value => { result = value } })
  const record = await readCorrection(context)
  const body = await verifyCorrection(record, basis, context)
  need(matchControl(fresh, body.committed), 'STALE_CONTROL')
  if (deps.onVerifiedMembership) await deps.onVerifiedMembership(membershipProof)
  return { ...result, serializationCorrection: dto(record) }
}
