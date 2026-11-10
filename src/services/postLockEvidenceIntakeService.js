import mongoose from 'mongoose'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { EVIDENCE_SNAPSHOT_INTERNAL_READ } from './runtimeEvidenceSnapshotContract.js'
import { readVerifiedRuntimeEvidenceSnapshot } from './runtimeEvidenceSnapshotService.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { POST_LOCK_SUBMISSION_VERSION, POST_LOCK_ASSOCIATION_VERSION, parsePostLockSubmission,
  parsePostLockAssociation, postLockError, postLockSubmissionId, postLockRequestDigest,
  postLockSourceHash, postLockSnapshotPointer, validPostLockRow, assertPostLockRecordingBinding } from './postLockEvidenceIntakeContract.js'

const options = (session, readBudget) => ({ ...(session ? { session } : {}), maxTimeMS: 2000,
  ...(readBudget ? readBudget() : {}) })
const scopeFor = runtime => Object.fromEntries(['customerId', 'tenantId'].map(key => [key, new mongoose.Types.ObjectId(runtime[key])])
  .concat([['runtimeInstanceId', new mongoose.Types.ObjectId(runtime.id)]]))
const same = (left, right) => generateChecksum(left) === generateChecksum(right)
const requireValue = (condition, reason = 'POST_LOCK_RECEIPT_UNVERIFIED', status = 503) => {
  if (!condition) throw postLockError(reason, status)
}
const projection = 'status stateVersion runtimeStateVersion revision workspaceId packageId frameworkKey packageKey packageVersion dependencyLockId activationId deploymentId evidence lockedEvidenceSnapshot framework_state.lock lockedAt lockedBy runtimeInstanceKey customerId tenantId runtimeType'
const scopedRuntime = (args, session, readBudget) => getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId,
  projection, maxTimeMS: 2000, metadataMaxTimeMS: 2000, session,
  ...(readBudget ? { readBudget } : {}), internalEvidenceSnapshotToken: EVIDENCE_SNAPSHOT_INTERNAL_READ })
const lockedBasis = async (runtime, session, readBudget) => {
  const internal = runtime.__evidenceSnapshotControl
  requireValue(runtime.status === 'LOCKED' && internal?.runtime?.framework_state?.lock?.locked === true && internal.pointer,
    'POST_LOCK_BINDING_STALE', 409)
  const pointer = postLockSnapshotPointer(internal.pointer)
  let body
  await readVerifiedRuntimeEvidenceSnapshot({ runtime: internal.runtime, pointer, session,
    ...(readBudget ? { readBudget } : {}),
    deps: { onVerifiedMembership: verified => { body = verified.body } } })
  requireValue(body, 'POST_LOCK_BINDING_STALE', 409)
  return { body, pointer }
}
const bindingFor = (runtime, pointer, policyHash) => ({
  customerId: String(runtime.customerId), tenantId: String(runtime.tenantId), runtimeInstanceId: runtime.id,
  runtimeInstanceKey: runtime.runtimeInstanceKey, revisionNumber: runtime.revision?.revisionNumber,
  basisStateVersion: runtime.stateVersion, evidenceSnapshotId: pointer.snapshotId, membershipHash: pointer.membershipHash,
  lockSnapshotId: pointer.lockSnapshotId, lockSnapshotHash: pointer.lockSnapshotHash,
  packageId: String(runtime.packageId), packageVersion: runtime.packageVersion,
  dependencySnapshotId: runtime.dependencyLockId || runtime.evidence?.dependencySnapshotId,
  dependencySnapshotHash: runtime.evidence?.dependencySnapshotHash, policyHash,
})
export { scopedRuntime as readPostLockScopedRuntime, lockedBasis as readPostLockLockedBasis,
  bindingFor as buildPostLockRecordingBinding }
export const postLockStorageIndexMatches = (actual, key, expected) => Boolean(actual && same(actual.key, key)
  && Boolean(actual.unique) === Boolean(expected.unique)
  && same(actual.partialFilterExpression || null, expected.partialFilterExpression || null))
const requireIndexes = async () => {
  requireValue(mongoose.connection.readyState === 1, 'POST_LOCK_STORAGE_UNAVAILABLE')
  for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
    let indexes
    try { indexes = await model.collection.listIndexes({ maxTimeMS: 2000 }).toArray() }
    catch { throw postLockError('POST_LOCK_INDEX_REQUIRED', 503) }
    for (const [key, expected] of model.schema.indexes()) {
      const actual = indexes.find(index => index.name === expected.name)
      requireValue(postLockStorageIndexMatches(actual, key, expected), 'POST_LOCK_INDEX_REQUIRED')
    }
  }
}
export const parsePostLockOriginalPair = ({ evidence, source, submissionId }) => {
  requireValue(validPostLockRow(evidence, 'evidence') && validPostLockRow(source, 'source'))
  const ea = parsePostLockAssociation(evidence.postLockAssociation, 'evidence')
  const sa = parsePostLockAssociation(source.postLockAssociation, 'source')
  const { evidence: material, reason, ...common } = ea
  const { source: sourceMaterial, ...sourceCommon } = sa
  requireValue(same(common, sourceCommon) && common.submissionId === submissionId)
  const submission = parsePostLockSubmission({ contractVersion: POST_LOCK_SUBMISSION_VERSION,
    requestKey: common.requestKey, binding: common.binding, source: sourceMaterial, evidence: material, reason })
  requireValue(common.requestDigest === postLockRequestDigest(submission, common.submittedBy)
    && evidence.sourceType === source.sourceType && evidence.contentHash === source.contentHash
    && evidence.lineageRef === source.lineageRef)
  return { common, sourceMaterial, material, reason, evidence, source }
}
export const assertPostLockOriginalPairBinding = ({ pair, runtime, pointer }) => {
  requireValue(same(pair.common.binding, bindingFor(runtime, pointer, pair.common.binding.policyHash)), 'POST_LOCK_BINDING_STALE', 409)
}
export const verifyPostLockOriginalReceipt = ({ pair, audit, submissionId, expectedDigest }) => {
  const { common, sourceMaterial, material, reason, source, evidence } = pair
  requireValue(audit?.verifySignature() && same(audit.diff, { contractVersion: POST_LOCK_ASSOCIATION_VERSION,
    submissionId, requestDigest: common.requestDigest, binding: common.binding, submittedBy: common.submittedBy,
    submittedAt: common.submittedAt, sourceRowId: String(source._id), evidenceRowId: String(evidence._id) }))
  if (expectedDigest !== undefined && expectedDigest !== common.requestDigest) throw postLockError('POST_LOCK_IDEMPOTENCY_CONFLICT')
  return { contractVersion: POST_LOCK_SUBMISSION_VERSION, submissionId, status: 'PENDING_REVIEW',
    requestDigest: common.requestDigest,
    outsideFrozenMembership: true, binding: common.binding, source: sourceMaterial, evidence: material, reason,
    submittedBy: common.submittedBy, submittedAt: common.submittedAt,
    receipt: { id: common.receiptId, signatureVersion: audit.signatureVersion, verified: true } }
}
const verifiedPair = async ({ runtime, submissionId, session, expectedDigest, readBudget }) => {
  const scope = scopeFor(runtime)
  const evidenceRows = await RuntimeEvidenceObject.collection.find({ ...scope,
    evidenceObjectId: `post-lock:${submissionId}` }, options(session, readBudget)).limit(2).toArray()
  const sourceRows = await RuntimeEvidenceSource.collection.find({ ...scope,
    sourceId: `post-lock-source:${submissionId}` }, options(session, readBudget)).limit(2).toArray()
  if (!evidenceRows.length && !sourceRows.length) return null
  requireValue(evidenceRows.length === 1 && sourceRows.length === 1)
  const pair = parsePostLockOriginalPair({ evidence: evidenceRows[0], source: sourceRows[0], submissionId })
  const { common } = pair
  // Snapshot reads are independent of policy enablement: a revoked policy must
  // not erase a previously committed receipt from an authorised viewer.
  const { pointer } = await lockedBasis(runtime, session, readBudget)
  assertPostLockOriginalPairBinding({ pair, runtime, pointer })
  const audit = await AuditLog.findOne({ _id: common.receiptId, action: 'POST_LOCK_EVIDENCE_SUBMITTED',
    resourceType: 'RuntimeInstance', resourceId: scope.runtimeInstanceId, actorUserId: common.submittedBy,
    'scope.customerId': scope.customerId, 'scope.tenantId': scope.tenantId,
    'scope.runtimeInstanceId': scope.runtimeInstanceId, 'scope.runtimeInstanceKey': runtime.runtimeInstanceKey }).setOptions(options(session, readBudget))
  return verifyPostLockOriginalReceipt({ pair, audit, submissionId, expectedDigest })
}
export const readVerifiedPostLockLockedContext = async (args, session, { readBudget } = {}) => {
  requireValue(session?.inTransaction?.() === true, 'POST_LOCK_STORAGE_UNAVAILABLE')
  const runtime = await scopedRuntime(args, session, readBudget)
  const { body, pointer } = await lockedBasis(runtime, session, readBudget)
  return { runtime, scope: scopeFor(runtime), body, pointer }
}
export const withPostLockEvidenceTransaction = async (work, { timeoutMS = 6000 } = {}) => {
  requireValue(mongoose.connection.readyState === 1, 'POST_LOCK_STORAGE_UNAVAILABLE')
  requireValue(Number.isInteger(timeoutMS) && timeoutMS > 0 && timeoutMS <= 6000, 'POST_LOCK_STORAGE_UNAVAILABLE')
  const session = await mongoose.startSession()
  try {
    return await session.withTransaction(() => work(session), { timeoutMS, maxCommitTimeMS: Math.min(2000, timeoutMS),
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } })
  } finally { await session.endSession() }
}

export const submitPostLockEvidence = async args => {
  const submission = parsePostLockSubmission(args.payload)
  if (!submission.source.licensing.retentionPermitted) throw postLockError('POST_LOCK_RETENTION_BLOCKED', 422)
  requireValue(/^[a-f0-9]{24}$/.test(String(args.actorUserId || '')), 'POST_LOCK_SUBMISSION_INVALID', 422)
  const submissionId = postLockSubmissionId(submission), digest = postLockRequestDigest(submission, String(args.actorUserId))
  // MongoDB index metadata is read outside withTransaction, never treated as a
  // transactional lock against concurrent administrative index changes.
  const initial = assertNoControlledReplayIsolation(await scopedRuntime(args))
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: initial.customerId,
    tenantId: initial.tenantId, permission: 'VMF_UPDATE', maxTimeMS: 2000 })
  await requireIndexes()
  try {
    return await withPostLockEvidenceTransaction(async session => {
      const runtime = assertNoControlledReplayIsolation(await scopedRuntime(args, session))
      await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
        tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000 })
      const existing = await verifiedPair({ runtime, submissionId, expectedDigest: digest, session })
      if (existing) return { ...existing, replayed: true }
      const { body, pointer } = await lockedBasis(runtime, session)
      const pack = await FrameworkPackage.findOne({ _id: runtime.packageId }).setOptions(options(session)).lean()
      const policyHash = assertPostLockRecordingBinding({ frameworkPackage: pack, runtime })
      requireValue(same(submission.binding, bindingFor(runtime, pointer, policyHash)), 'POST_LOCK_BINDING_STALE', 409)
      requireValue(submission.evidence.sectionKeys.every(key => body.sections.some(section => section.sectionKey === key)),
        'POST_LOCK_BINDING_STALE', 409)
      const submittedAt = new Date().toISOString(), sourceRowId = new mongoose.Types.ObjectId(), evidenceRowId = new mongoose.Types.ObjectId()
      const scope = scopeFor(runtime)
      const audit = await auditService.log({ action: auditService.AUDIT_ACTIONS.POST_LOCK_EVIDENCE_SUBMITTED,
        actorUserId: args.actorUserId, resourceType: 'RuntimeInstance', resourceId: scope.runtimeInstanceId,
        requestId: args.auditRequest?.requestId, scope: { ...scope, runtimeInstanceKey: runtime.runtimeInstanceKey },
        diff: { contractVersion: POST_LOCK_ASSOCIATION_VERSION, submissionId, requestDigest: digest, binding: submission.binding,
          submittedBy: String(args.actorUserId), submittedAt, sourceRowId: String(sourceRowId), evidenceRowId: String(evidenceRowId) },
      }, { session, throwOnError: true })
      requireValue(audit?._id && audit.verifySignature())
      const association = { contractVersion: POST_LOCK_ASSOCIATION_VERSION, submissionId, requestKey: submission.requestKey,
        requestDigest: digest, binding: submission.binding, submittedBy: String(args.actorUserId), submittedAt,
        receiptId: String(audit._id), status: 'PENDING_REVIEW' }
      const common = { ...scope, runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion,
        sourceStateVersion: runtime.stateVersion, sourceHash: postLockSourceHash(digest), current: false,
        sourceId: `post-lock-source:${submissionId}`, sourceType: submission.source.sourceType,
        contentHash: submission.source.contentHash, lineageRef: submission.source.provenance.receiptRef, reviewStatus: 'PENDING_REVIEW' }
      await RuntimeEvidenceSource.create([{ ...common, _id: sourceRowId, title: submission.source.title,
        sourceRef: submission.source.locator.url || '', acquisitionStatus: 'POST_LOCK_PENDING',
        postLockAssociation: { ...association, source: submission.source } }], { session })
      await RuntimeEvidenceObject.create([{ ...common, _id: evidenceRowId, evidenceObjectId: `post-lock:${submissionId}`,
        title: submission.evidence.title, extractedFact: submission.evidence.statement, acceptanceState: 'POST_LOCK_PENDING',
        postLockAssociation: { ...association, evidence: submission.evidence, reason: submission.reason } }], { session })
      return { ...await verifiedPair({ runtime, submissionId, session, expectedDigest: digest }), replayed: false }
    })
  } catch (error) {
    if (error.code === 11000) {
      // Only after the failed transaction has ended: verify the actual winner;
      // neither a duplicate key nor one surviving row is a success receipt.
      return await withPostLockEvidenceTransaction(async session => {
        const runtime = assertNoControlledReplayIsolation(await scopedRuntime(args, session))
        const result = await verifiedPair({ runtime, submissionId, session, expectedDigest: digest })
        requireValue(result)
        return { ...result, replayed: true }
      })
    }
    if (error.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      const uncertain = postLockError('POST_LOCK_SUBMISSION_UNCONFIRMED', 503)
      uncertain.details.submissionId = submissionId
      throw uncertain
    }
    throw error
  }
}

export const readVerifiedPostLockEvidenceContext = async (args, session, { readBudget } = {}) => {
  requireValue(session?.inTransaction?.() === true, 'POST_LOCK_STORAGE_UNAVAILABLE')
  const runtime = await scopedRuntime(args, session, readBudget)
  const submission = await verifiedPair({ runtime, submissionId: args.submissionId, session,
    ...(readBudget ? { readBudget } : {}) })
  requireValue(submission, 'POST_LOCK_SUBMISSION_NOT_FOUND', 404)
  return { runtime, submission }
}

export const readPostLockEvidence = async args => {
  requireValue(/^[a-f0-9]{64}$/.test(args.submissionId || ''), 'POST_LOCK_SUBMISSION_INVALID', 422)
  return withPostLockEvidenceTransaction(async session => (await readVerifiedPostLockEvidenceContext(args, session)).submission)
}
