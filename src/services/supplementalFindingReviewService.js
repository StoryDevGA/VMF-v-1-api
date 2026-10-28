import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Review, { assertSupplementalFindingReview } from '../models/RuntimeSupplementalFindingReview.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SUPPLEMENTAL_FINDING_POLICY as policy } from '../constants/supplementalFindingReviewPolicy.js'
import { RUNTIME_PRODUCT_AUTHORITY_POLICY as authorityPolicy } from '../constants/runtimeProductAuthorityPolicy.js'
import { productAuthorityBinding } from '../models/RuntimeProductAuthorityReceipt.js'
import { verifyRuntimeProductAuthority } from './runtimeProductAuthorityService.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { requirePublishedRecoveryEnvironment, loadPublishedRecoveryRuntime, inspectPublishedEvidenceBasis,
  withPublishedRecoveryTransaction, assertPublishedDispositionControl } from './publishedDispositionRecoveryService.js'
import { supplementalFindingBodySchema } from '../validators/reviewCompletion.validator.js'
import auditService from './auditService.js'

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const options = session => ({ session, maxTimeMS: 3000 })
const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId']
  .map(key => [key, new mongoose.Types.ObjectId(basisPolicy.scope[key])]))
const signed = audit => audit && AuditLog.hydrate(audit).verifySignature() === true
const readRecord = session => Review.findOne({ ...scope(), policyVersion: policy.policyVersion }).session(session).maxTimeMS(3000).lean()
const inspect = async (runtime, session) => {
  const basis = await inspectPublishedEvidenceBasis(runtime, session)
  const pack = runtime.framework_state?.evidence_pack
  const candidates = pack?.discoveryHealth?.contradictionCandidates
  if (Object.hasOwn(pack || {}, 'contradictionReviews') || !Array.isArray(candidates) || candidates.length !== 1
    || candidates[0]?.contradictionId !== policy.contradictionId || pack.contradictionReviewEpoch !== policy.reviewEpoch)
    fail('SUPPLEMENTAL_FINDING_STALE', 'The original finding population or history changed.')
  // A null history computes only the native evidence pair; it never invents a decision history.
  const pair = getDiscoveryContradictionReview(candidates[0], pack.evidenceObjects, null,
    basisPolicy.scope.runtimeInstanceId, pack.contradictionReviewEpoch)
  if (pair.evidencePairHash !== policy.evidencePairHash)
    fail('SUPPLEMENTAL_FINDING_STALE', 'The finding passages or source references changed.')
  return { ...basis, candidate: membershipJson(candidates[0]), evidence: pair.evidence,
    reviewEpoch: policy.reviewEpoch, evidencePairHash: pair.evidencePairHash }
}
const basisHash = (basis, authority) => membershipHash({ policyVersion: policy.policyVersion, authority,
  freezeHash: basis.freezeHash,
  runtimeWitnessHash: basis.runtimeWitnessHash, candidate: basis.candidate, evidence: basis.evidence,
  reviewEpoch: basis.reviewEpoch, evidencePairHash: basis.evidencePairHash, originalAuditHash: basisPolicy.originalAuditHash,
  originalUpdatedAt: basisPolicy.updatedAt, originalUpdatedBy: basisPolicy.originalUpdatedBy })
const verify = async (record, session) => {
  try { assertSupplementalFindingReview(record) }
  catch { fail('SUPPLEMENTAL_FINDING_INVALID', 'The supplemental finding review is invalid.') }
  const authority = await verifyRuntimeProductAuthority(session)
  if (membershipHash(record.body.authority) !== membershipHash(productAuthorityBinding(authority))
    || Date.parse(record.body.createdAt) < Date.parse(authority.body.recordedAt))
    fail('SUPPLEMENTAL_FINDING_AUTHORITY_INVALID', 'The native delegation binding cannot be verified.')
  const audit = await AuditLog.collection.findOne({ _id: new mongoose.Types.ObjectId(record.auditId),
    resourceId: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId),
    'scope.customerId': new mongoose.Types.ObjectId(basisPolicy.scope.customerId),
    'scope.tenantId': new mongoose.Types.ObjectId(basisPolicy.scope.tenantId),
    'scope.runtimeInstanceId': new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) }, options(session))
  if (!signed(audit) || audit.signatureVersion !== record.auditSignatureVersion
    || audit.diff?.action !== 'SUPPLEMENTAL_PUBLISHED_FINDING_REVIEW' || audit.diff?.receiptId !== record.receiptId
    || audit.diff?.bodyHash !== record.bodyHash || audit.diff?.evidencePairHash !== policy.evidencePairHash
    || membershipHash(audit.diff?.authority) !== membershipHash(record.body.authority)
    || audit.diff?.policyVersion !== policy.policyVersion || String(audit.actorUserId) !== record.body.reviewer.userId)
    fail('SUPPLEMENTAL_FINDING_AUDIT_INVALID', 'The signed finding review audit cannot be verified.')
  return record
}
const dto = record => ({ origin: policy.contractVersion, receiptId: record.receiptId, bodyHash: record.bodyHash,
  createdAt: record.body.createdAt, reviewer: record.body.reviewer, disposition: record.body.disposition,
  rationale: record.body.rationale, evidencePairHash: record.body.evidencePairHash, auditId: String(record.auditId),
  approval: policy.approval, authorisesLock: false, authorisesARL: false,
  authority: record.body.authority,
  findingResolved: record.body.disposition === 'NOT_CONTRADICTORY' })
// Internal completion/LOCK consumer: preserve the caller's transaction and leave
// metadata currency to its finding -> completion control chain.
const readVerifiedFindingRecord = async ({ runtime, session }) => {
  if (String(runtime?._id || runtime?.id) !== basisPolicy.scope.runtimeInstanceId
    || String(runtime.customerId) !== basisPolicy.scope.customerId || String(runtime.tenantId) !== basisPolicy.scope.tenantId
    || runtime.runtimeInstanceKey !== basisPolicy.scope.runtimeInstanceKey || runtime.revision?.revisionNumber !== 1)
    fail('SUPPLEMENTAL_FINDING_STALE', 'The finding scope changed.')
  const record = await readRecord(session)
  if (!record) fail('SUPPLEMENTAL_FINDING_REQUIRED', 'A persisted independent finding review is required.')
  await verify(record, session)
  if (record.body.disposition !== 'NOT_CONTRADICTORY')
    fail('SUPPLEMENTAL_FINDING_UNRESOLVED', 'This finding remains a readiness blocker.')
  return record
}
export const readVerifiedSupplementalFindingForCompletion = async ({ runtime, session }) => {
  if (session?.inTransaction?.() !== true) fail('SUPPLEMENTAL_FINDING_TRANSACTION_REQUIRED', 'A transaction is required.')
  const record = await readVerifiedFindingRecord({ runtime, session })
  const basis = await inspect(runtime, session)
  if (membershipHash(basis.manifest) !== record.body.freezeHash
    || membershipHash(basis.candidate) !== membershipHash(record.body.candidate)
    || membershipHash(basis.evidence) !== membershipHash(record.body.evidence))
    fail('SUPPLEMENTAL_FINDING_STALE', 'The finding basis changed.')
  return record
}
// Passive historical readers may have no session. Their owner verifies the
// original frozen rows separately, without pretending locked metadata is prelock.
export const readVerifiedSupplementalFindingForHistory = readVerifiedFindingRecord
export const inspectSupplementalFindingReview = args => withPublishedRecoveryTransaction(async session => {
  const runtime = await loadPublishedRecoveryRuntime(args, session), basis = await inspect(runtime, session)
  const authority = await verifyRuntimeProductAuthority(session, { required: false })
  const authorityBinding = authority ? productAuthorityBinding(authority) : null
  const record = await readRecord(session)
  if (record) await verify(record, session)
  assertPublishedDispositionControl(runtime, record)
  return { origin: policy.contractVersion, approval: policy.approval, scope: basisPolicy.scope,
    stateVersion: basisPolicy.stateVersion, expectedUpdatedAt: basisPolicy.updatedAt,
    expectedBasisHash: basisHash(basis, authorityBinding), authority: authorityBinding,
    candidate: basis.candidate, evidence: basis.evidence,
    reviewEpoch: basis.reviewEpoch, evidencePairHash: basis.evidencePairHash, counts: basis.manifest.counts,
    qualifications: basis.qualifications, originalReviewHistory: 'ABSENT',
    receipt: record ? dto(record) : null, authorisesLock: false, authorisesARL: false }
})
const assertIndexes = async () => {
  let indexes
  try { indexes = await Review.collection.listIndexes({ maxTimeMS: 3000 }).toArray() }
  catch { fail('SUPPLEMENTAL_FINDING_INDEX_REQUIRED', 'Required finding review uniqueness is unavailable.', 503) }
  for (const [name, last] of [['unique_supplemental_finding_policy', 'policyVersion'], ['unique_supplemental_finding_request', 'requestKey']]) {
    const index = indexes.find(item => item.name === name)
    if (!index?.unique || index.sparse || index.partialFilterExpression
      || JSON.stringify(index.key) !== JSON.stringify({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [last]: 1 }))
      fail('SUPPLEMENTAL_FINDING_INDEX_REQUIRED', 'Required finding review uniqueness is unavailable.', 503)
  }
}
export const recordSupplementalFindingReview = async args => {
  requirePublishedRecoveryEnvironment()
  if (String(args.actorUserId) !== authorityPolicy.reviewerUserId)
    fail('SUPPLEMENTAL_FINDING_DELEGATION_REQUIRED', 'Only the named delegated reviewer may adjudicate this finding.', 403)
  const parsed = supplementalFindingBodySchema.safeParse(args.payload)
  if (!parsed.success || !mongoose.isValidObjectId(args.actorUserId)
    || parsed.data.expectedUpdatedAt !== basisPolicy.updatedAt)
    fail('SUPPLEMENTAL_FINDING_INVALID', 'An explicit disposition, rationale and exact approved basis are required.', 422)
  const payload = parsed.data
  await assertIndexes()
  return withPublishedRecoveryTransaction(async session => {
    const runtime = await loadPublishedRecoveryRuntime(args, session), basis = await inspect(runtime, session)
    const authority = await verifyRuntimeProductAuthority(session)
    const authorityBinding = productAuthorityBinding(authority)
    if (payload.expectedBasisHash !== basisHash(basis, authorityBinding)) fail('SUPPLEMENTAL_FINDING_STALE', 'The confirmed finding basis changed.')
    const record = await readRecord(session)
    assertPublishedDispositionControl(runtime, record)
    const payloadHash = membershipHash({ ...payload, actorUserId: String(args.actorUserId) })
    if (record) {
      await verify(record, session)
      if (record.requestKey !== payload.requestKey || record.payloadHash !== payloadHash)
        fail('SUPPLEMENTAL_FINDING_STALE', 'A different finding review request already committed.')
      return { receipt: dto(record), replay: true }
    }
    const createdAt = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1)).toISOString()
    const guarded = await RuntimeInstance.collection.updateOne({ _id: runtime._id, customerId: runtime.customerId,
      tenantId: runtime.tenantId, stateVersion: basisPolicy.stateVersion, updatedAt: runtime.updatedAt, updatedBy: runtime.updatedBy,
      'framework_state.lifecycle.stage': 'PUBLISHED', 'framework_state.lock.locked': { $ne: true } },
    { $set: { updatedAt: new Date(createdAt), updatedBy: new mongoose.Types.ObjectId(args.actorUserId) } }, options(session))
    if (guarded.modifiedCount !== 1) fail('SUPPLEMENTAL_FINDING_STALE', 'The runtime changed while recording the review.')
    const receiptId = randomUUID()
    const body = membershipJson({ contractVersion: policy.contractVersion, policyVersion: policy.policyVersion,
      approval: policy.approval, authority: authorityBinding, receiptId, requestKey: payload.requestKey, payloadHash, stateVersion: basisPolicy.stateVersion,
      originalUpdatedAt: basisPolicy.updatedAt, originalUpdatedBy: basisPolicy.originalUpdatedBy,
      createdAt, committedUpdatedAt: createdAt, reviewer: { userId: String(args.actorUserId), permission: 'VMF_UPDATE',
        authorityReference: authority.approvalReference }, rationale: payload.rationale, disposition: payload.disposition,
      candidate: basis.candidate, evidence: basis.evidence, reviewEpoch: basis.reviewEpoch, evidencePairHash: basis.evidencePairHash,
      originalReviewHistory: 'ABSENT', runtimeWitnessHash: basis.runtimeWitnessHash,
      frozenMembership: basis.manifest, freezeHash: basis.freezeHash,
      originalAudits: basis.originalAudits, originalAuditHash: basisPolicy.originalAuditHash, qualifications: basis.qualifications })
    const bodyHash = membershipHash(body)
    const audit = await auditService.log({ actorUserId: args.actorUserId, action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeInstance, resourceId: runtime._id,
      scope: { ...scope(), runtimeInstanceKey: runtime.runtimeInstanceKey }, requestId: args.auditRequest?.requestId,
      diff: { action: 'SUPPLEMENTAL_PUBLISHED_FINDING_REVIEW', receiptId, bodyHash, evidencePairHash: basis.evidencePairHash,
        disposition: payload.disposition, policyVersion: policy.policyVersion, authority: authorityBinding,
        approvalReference: policy.approval.approvalReference } },
    { session, throwOnError: true })
    if (!audit?._id || !signed(audit.toObject ? audit.toObject() : audit))
      fail('SUPPLEMENTAL_FINDING_AUDIT_INVALID', 'The required signed finding review audit failed.', 503)
    const [saved] = await Review.create([{ ...scope(), receiptId, requestKey: payload.requestKey, payloadHash,
      policyVersion: policy.policyVersion, body, bodyHash, auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
    return { receipt: dto(saved), replay: false }
  })
}
