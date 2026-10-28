import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Receipt, { assertSyntheticTestDispositionReceipt, syntheticTestBasisHash as expectedHash } from '../models/RuntimeSyntheticTestDispositionReceipt.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import { SYNTHETIC_TEST_DISPOSITION_POLICY as policy, parseSyntheticTestAmendment } from '../constants/syntheticTestDispositionPolicy.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SUPPLEMENTAL_FINDING_POLICY as findingPolicy } from '../constants/supplementalFindingReviewPolicy.js'
import { productAuthorityBinding } from '../models/RuntimeProductAuthorityReceipt.js'
import { verifyRuntimeProductAuthority } from './runtimeProductAuthorityService.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { requirePublishedRecoveryEnvironment, loadPublishedRecoveryRuntime, inspectPublishedEvidenceBasis,
  withPublishedRecoveryTransaction, assertPublishedDispositionControl } from './publishedDispositionRecoveryService.js'
import { syntheticTestDispositionBodySchema } from '../validators/syntheticTestDisposition.validator.js'
import auditService from './auditService.js'

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const options = session => ({ session, maxTimeMS: 3000 })
const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId']
  .map(key => [key, new mongoose.Types.ObjectId(basisPolicy.scope[key])]))
const signed = audit => audit && AuditLog.hydrate(audit).verifySignature() === true
const assertRecorder = args => {
  requirePublishedRecoveryEnvironment()
  if (String(args.actorUserId) !== policy.recorderUserId || !args.scopes?.platformRoles?.includes('SUPER_ADMIN'))
    fail('SYNTHETIC_TEST_FORBIDDEN', 'The named authenticated technical recorder is required; Angus remains the disclosed human decision-maker.', 403)
}
const inspectBasis = async (runtime, session) => {
  const basis = await inspectPublishedEvidenceBasis(runtime, session)
  assertPublishedDispositionControl(runtime, null)
  const pack = runtime.framework_state?.evidence_pack
  const candidates = pack?.discoveryHealth?.contradictionCandidates
  if (Object.hasOwn(pack || {}, 'contradictionReviews') || candidates?.length !== 1
    || candidates[0]?.contradictionId !== findingPolicy.contradictionId || pack.contradictionReviewEpoch !== findingPolicy.reviewEpoch)
    fail('SYNTHETIC_TEST_STALE', 'The original finding population or history changed.')
  const pair = getDiscoveryContradictionReview(candidates[0], pack.evidenceObjects, null,
    basisPolicy.scope.runtimeInstanceId, pack.contradictionReviewEpoch)
  if (pair.evidencePairHash !== findingPolicy.evidencePairHash)
    fail('SYNTHETIC_TEST_STALE', 'The original evidence pair changed.')
  return membershipJson({ ...basis, candidate: candidates[0], evidence: pair.evidence,
    evidencePairHash: pair.evidencePairHash, reviewEpoch: findingPolicy.reviewEpoch })
}
const authorityFor = async session => {
  const authority = await verifyRuntimeProductAuthority(session)
  if (authority.bodyHash !== '97589f1e3e94244fdb82c1d59871ddf17072714d7dd430bbdd6d082690ecace9'
    || authority.body.recorder.userId !== policy.recorderUserId)
    fail('SYNTHETIC_TEST_AUTHORITY_INVALID', 'The exact native authority and recorder binding are required.')
  return productAuthorityBinding(authority)
}
const read = session => Receipt.findOne({ ...scope(), policyReference: policy.reference }).session(session).maxTimeMS(3000).lean()
const auditDiff = record => ({ action: 'NON_AUTHORITATIVE_TEST_DISPOSITION_RECORDED',
  receiptId: record.receiptId, bodyHash: record.bodyHash, policyReference: policy.reference,
  amendmentHash: policy.documentHash, disposition: record.body.input.disposition,
  evidencePairHash: findingPolicy.evidencePairHash, authority: record.body.authority })
const verify = async (record, basis, authority, session) => {
  try { assertSyntheticTestDispositionReceipt(record) } catch {
    fail('SYNTHETIC_TEST_INVALID', 'The immutable test receipt cannot be verified.')
  }
  if (membershipHash(record.body.basis) !== membershipHash(basis)
    || membershipHash(record.body.authority) !== membershipHash(authority)
    || record.body.input.expectedBasisHash !== expectedHash(basis, authority))
    fail('SYNTHETIC_TEST_STALE', 'The test receipt no longer matches its exact native basis.')
  const audit = await AuditLog.collection.findOne({ _id: new mongoose.Types.ObjectId(record.auditId),
    resourceId: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId),
    ...Object.fromEntries(Object.entries(scope()).map(([key, value]) => ['scope.' + key, value])) }, options(session))
  if (!signed(audit) || audit.signatureVersion !== record.auditSignatureVersion
    || String(audit.actorUserId) !== policy.recorderUserId
    || audit.action !== auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED
    || audit.resourceType !== auditService.RESOURCE_TYPES.RuntimeInstance
    || membershipHash(audit.diff) !== membershipHash(auditDiff(record)))
    fail('SYNTHETIC_TEST_AUDIT_INVALID', 'The required signed test receipt audit cannot be verified.')
}
const holds = { authorisesCompletion: false, authorisesLock: false, authorisesARL: false,
  authorisesDownstream: false, pipelineExecution: 'HELD', officialVMFAcceptance: false }
const dto = record => ({ receiptType: policy.receiptType, mode: policy.mode,
  receiptId: record.receiptId, bodyHash: record.bodyHash, amendmentReference: policy.reference,
  amendmentHash: policy.documentHash, createdAt: record.body.createdAt, recorder: record.body.recorder,
  decisionMaker: record.body.decisionMaker, decisionSource: record.body.input.decisionSource,
  disposition: record.body.input.disposition, rationale: record.body.input.rationale,
  evidencePairHash: record.body.basis.evidencePairHash, authority: record.body.authority,
  qualifiesFindingOnly: record.body.input.disposition === 'NOT_CONTRADICTORY',
  auditId: String(record.auditId), ...holds })
export const inspectSyntheticTestDisposition = args => withPublishedRecoveryTransaction(async session => {
  assertRecorder(args)
  const runtime = await loadPublishedRecoveryRuntime(args, session)
  const basis = await inspectBasis(runtime, session), authority = await authorityFor(session), record = await read(session)
  if (record) await verify(record, basis, authority, session)
  return { receiptType: policy.receiptType, amendmentReference: policy.reference, amendmentHash: policy.documentHash,
    scope: basisPolicy.scope, expectedUpdatedAt: basisPolicy.updatedAt, expectedBasisHash: expectedHash(basis, authority),
    candidate: basis.candidate, evidence: basis.evidence, counts: basis.manifest.counts,
    qualifications: basis.qualifications, receipt: record ? dto(record) : null, ...holds }
})
const assertIndexes = async () => {
  let indexes
  try { indexes = await Receipt.collection.listIndexes({ maxTimeMS: 3000 }).toArray() }
  catch { fail('SYNTHETIC_TEST_INDEX_REQUIRED', 'Required test receipt uniqueness is unavailable.', 503) }
  for (const [name, last] of [['unique_synthetic_test_policy', 'policyReference'], ['unique_synthetic_test_request', 'requestKey']]) {
    const index = indexes.find(row => row.name === name)
    if (!index?.unique || index.sparse || index.partialFilterExpression
      || JSON.stringify(index.key) !== JSON.stringify({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [last]: 1 }))
      fail('SYNTHETIC_TEST_INDEX_REQUIRED', 'Required test receipt uniqueness is unavailable.', 503)
  }
}
export const recordSyntheticTestDisposition = async args => {
  assertRecorder(args)
  const parsed = syntheticTestDispositionBodySchema.safeParse(args.payload)
  let amendment
  try { amendment = parsed.success && parseSyntheticTestAmendment(parsed.data.amendmentDocumentText) } catch { /* Fail closed. */ }
  if (!amendment || parsed.data.expectedUpdatedAt !== basisPolicy.updatedAt
    || Date.parse(parsed.data.decisionSource.decidedAt) < Date.parse(policy.approvedAt)
    || Date.parse(parsed.data.decisionSource.decidedAt) > Date.now())
    fail('SYNTHETIC_TEST_INVALID', 'The unchanged amendment and an explicit current, disclosed decision source are required.', 422)
  const payload = parsed.data
  await assertIndexes()
  return withPublishedRecoveryTransaction(async session => {
    const runtime = await loadPublishedRecoveryRuntime(args, session), basis = await inspectBasis(runtime, session)
    const authority = await authorityFor(session)
    if (payload.expectedBasisHash !== expectedHash(basis, authority))
      fail('SYNTHETIC_TEST_STALE', 'The confirmed test basis changed.')
    const record = await read(session), payloadHash = membershipHash({ ...payload, actorUserId: String(args.actorUserId) })
    if (record) {
      await verify(record, basis, authority, session)
      if (record.requestKey !== payload.requestKey || record.payloadHash !== payloadHash)
        fail('SYNTHETIC_TEST_STALE', 'A different test disposition already committed.')
      return { receipt: dto(record), replay: true }
    }
    // Real write-and-restore fence: acquire the runtime lock without committing any runtime metadata change.
    const fenceAt = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1))
    const control = { _id: runtime._id, customerId: runtime.customerId, tenantId: runtime.tenantId, stateVersion: basisPolicy.stateVersion,
      updatedAt: runtime.updatedAt, updatedBy: runtime.updatedBy,
      'framework_state.lifecycle.stage': 'PUBLISHED', 'framework_state.lock.locked': { $ne: true } }
    if ((await RuntimeInstance.collection.updateOne(control, { $set: { updatedAt: fenceAt } }, options(session))).modifiedCount !== 1)
      fail('SYNTHETIC_TEST_STALE', 'The runtime changed while recording the test receipt.')
    if ((await RuntimeInstance.collection.updateOne({ ...control, updatedAt: fenceAt },
      { $set: { updatedAt: runtime.updatedAt } }, options(session))).modifiedCount !== 1)
      fail('SYNTHETIC_TEST_STALE', 'The test receipt write fence could not be restored.')
    const current = await RuntimeInstance.collection.findOne({ _id: runtime._id,
      customerId: runtime.customerId, tenantId: runtime.tenantId }, options(session))
    if (expectedHash(await inspectBasis(current, session), await authorityFor(session)) !== payload.expectedBasisHash)
      fail('SYNTHETIC_TEST_STALE', 'The native basis changed at the receipt write fence.')
    const receiptId = randomUUID(), createdAt = new Date().toISOString()
    const body = membershipJson({ receiptType: policy.receiptType, mode: policy.mode,
      amendmentReference: policy.reference, amendmentHash: policy.documentHash, receiptId, input: payload,
      payloadHash, createdAt, recorder: { userId: String(args.actorUserId), platformRole: 'SUPER_ADMIN', permission: 'VMF_UPDATE' },
      decisionMaker: { name: 'Angus Gregory', role: 'Product Owner, StorylineOS', independent: false,
        dualRoleDisclosed: true, nativeUserId: null }, authority, basis })
    const data = { ...scope(), receiptId, requestKey: payload.requestKey, policyReference: policy.reference,
      payloadHash, body, bodyHash: membershipHash(body) }
    const audit = await auditService.log({ actorUserId: args.actorUserId, action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeInstance, resourceId: runtime._id,
      scope: { ...scope(), runtimeInstanceKey: runtime.runtimeInstanceKey },
      requestId: args.auditRequest?.requestId, diff: auditDiff(data) }, { session, throwOnError: true })
    if (!audit?._id || !signed(audit.toObject ? audit.toObject() : audit))
      fail('SYNTHETIC_TEST_AUDIT_INVALID', 'The required signed test receipt audit failed.', 503)
    const [saved] = await Receipt.create([{ ...data, auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
    await verify(saved.toObject(), basis, authority, session)
    return { receipt: dto(saved), replay: false }
  })
}
