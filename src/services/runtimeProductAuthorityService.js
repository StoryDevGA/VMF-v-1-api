import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Receipt, { assertRuntimeProductAuthorityReceipt, productAuthorityBinding } from '../models/RuntimeProductAuthorityReceipt.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import { RUNTIME_PRODUCT_AUTHORITY_POLICY as policy, parseApprovedProductAuthority } from '../constants/runtimeProductAuthorityPolicy.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { loadPublishedRecoveryRuntime, inspectPublishedEvidenceBasis, withPublishedRecoveryTransaction,
  requirePublishedRecoveryEnvironment, assertPublishedDispositionControl } from './publishedDispositionRecoveryService.js'
import { runtimeProductAuthorityBodySchema } from '../validators/reviewCompletion.validator.js'
import auditService from './auditService.js'

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const options = session => ({ session, maxTimeMS: 3000 })
const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId']
  .map(key => [key, new mongoose.Types.ObjectId(basisPolicy.scope[key])]))
const admin = args => args.scopes?.platformRoles?.includes('SUPER_ADMIN') === true
const assertReader = args => {
  if (!mongoose.isValidObjectId(args.actorUserId) || (!admin(args) && String(args.actorUserId) !== policy.reviewerUserId))
    fail('PRODUCT_AUTHORITY_FORBIDDEN', 'The scoped recorder or delegated reviewer is required.', 403)
}
const read = session => Receipt.findOne({ ...scope(), approvalReference: policy.approvalReference,
  approvalVersion: policy.version }).session(session).maxTimeMS(3000).lean()
const signed = row => row && AuditLog.hydrate(row).verifySignature() === true
const basisHash = basis => membershipHash({ documentHash: policy.documentHash, stateVersion: basisPolicy.stateVersion,
  freezeHash: basis.freezeHash, runtimeWitnessHash: basis.runtimeWitnessHash, originalAuditHash: basisPolicy.originalAuditHash,
  updatedAt: basisPolicy.updatedAt, updatedBy: basisPolicy.originalUpdatedBy })
const dto = record => ({ ...productAuthorityBinding(record), nativeRecordId: String(record._id),
  recordedAt: record.body.recordedAt, recorder: record.body.recorder, approvedAt: record.body.approvedAt,
  effectiveFrom: record.body.effectiveFrom, procedureReference: record.body.procedureReference,
  approver: record.body.approver, delegation: record.body.delegation, scope: record.body.scope,
  ledgerApproval: record.body.ledgerApproval, auditId: String(record.auditId), authorisesLock: false, authorisesARL: false })

export const verifyRuntimeProductAuthority = async (session, { required = true } = {}) => {
  const record = await read(session)
  if (!record) {
    if (required) fail('PRODUCT_AUTHORITY_REQUIRED', 'The approved native product-authority receipt must be recorded first.')
    return null
  }
  try { assertRuntimeProductAuthorityReceipt(record) }
  catch { fail('PRODUCT_AUTHORITY_INVALID', 'The persisted native authority cannot be verified.') }
  const audit = await AuditLog.collection.findOne({ _id: new mongoose.Types.ObjectId(record.auditId),
    resourceId: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId),
    ...Object.fromEntries(Object.entries(scope()).map(([key, value]) => ['scope.' + key, value])) }, options(session))
  if (!signed(audit) || audit.signatureVersion !== record.auditSignatureVersion
    || audit.diff?.action !== 'RUNTIME_PRODUCT_AUTHORITY_RECORDED' || audit.diff?.receiptId !== record.receiptId
    || audit.diff?.bodyHash !== record.bodyHash || audit.diff?.documentHash !== policy.documentHash
    || audit.diff?.approvalReference !== policy.approvalReference || audit.diff?.version !== policy.version
    || String(audit.actorUserId) !== record.body.recorder.userId)
    fail('PRODUCT_AUTHORITY_AUDIT_INVALID', 'The required signed authority audit cannot be verified.')
  return record
}
export const inspectRuntimeProductAuthority = args => withPublishedRecoveryTransaction(async session => {
  assertReader(args)
  const runtime = await loadPublishedRecoveryRuntime(args, session), basis = await inspectPublishedEvidenceBasis(runtime, session)
  const record = await verifyRuntimeProductAuthority(session, { required: false })
  // This pre-review endpoint never treats a later metadata write as unchanged authority.
  // A committed adjudication is read through the finding service's verified control chain.
  assertPublishedDispositionControl(runtime, null)
  return { origin: policy.contractVersion, expectedBasisHash: basisHash(basis), expectedUpdatedAt: basisPolicy.updatedAt,
    receipt: record ? dto(record) : null, authorisesLock: false, authorisesARL: false }
})
const assertIndexes = async () => {
  let indexes
  try { indexes = await Receipt.collection.listIndexes({ maxTimeMS: 3000 }).toArray() }
  catch { fail('PRODUCT_AUTHORITY_INDEX_REQUIRED', 'Native authority uniqueness is unavailable.', 503) }
  for (const [name, tail] of [['unique_runtime_product_authority_version', { approvalReference: 1, approvalVersion: 1 }],
    ['unique_runtime_product_authority_request', { requestKey: 1 }]]) {
    const index = indexes.find(item => item.name === name)
    if (!index?.unique || index.sparse || index.partialFilterExpression
      || JSON.stringify(index.key) !== JSON.stringify({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, ...tail }))
      fail('PRODUCT_AUTHORITY_INDEX_REQUIRED', 'Native authority uniqueness is unavailable.', 503)
  }
}
export const importRuntimeProductAuthority = async args => {
  requirePublishedRecoveryEnvironment()
  assertReader(args)
  if (!admin(args)) fail('PRODUCT_AUTHORITY_FORBIDDEN', 'An authenticated SUPER_ADMIN recorder is required.', 403)
  const parsed = runtimeProductAuthorityBodySchema.safeParse(args.payload)
  let source
  try { source = parsed.success && parseApprovedProductAuthority(parsed.data.approvalDocumentText) } catch { /* Fail closed below. */ }
  if (!source || parsed.data.expectedUpdatedAt !== basisPolicy.updatedAt)
    fail('PRODUCT_AUTHORITY_INVALID', 'The unchanged approved document and explicit current basis are required.', 422)
  const payload = parsed.data
  await assertIndexes()
  return withPublishedRecoveryTransaction(async session => {
    const runtime = await loadPublishedRecoveryRuntime(args, session), basis = await inspectPublishedEvidenceBasis(runtime, session)
    assertPublishedDispositionControl(runtime, null)
    if (payload.expectedBasisHash !== basisHash(basis)) fail('PRODUCT_AUTHORITY_STALE', 'The approved authority basis changed.')
    const record = await verifyRuntimeProductAuthority(session, { required: false })
    const payloadHash = membershipHash({ ...payload, actorUserId: String(args.actorUserId) })
    if (record) {
      if (record.requestKey !== payload.requestKey || record.payloadHash !== payloadHash)
        fail('PRODUCT_AUTHORITY_STALE', 'A different authority import already committed.')
      return { receipt: dto(record), replay: true }
    }
    // A no-op does not acquire a MongoDB write fence. Make a real metadata write,
    // then restore its exact original BSON Date within this same transaction.
    // The write lock survives restoration; no changed runtime is committed.
    const fenceAt = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1))
    const control = { _id: runtime._id, customerId: runtime.customerId,
      tenantId: runtime.tenantId, stateVersion: basisPolicy.stateVersion, updatedAt: runtime.updatedAt, updatedBy: runtime.updatedBy,
      'framework_state.lifecycle.stage': 'PUBLISHED', 'framework_state.lock.locked': { $ne: true } }
    const guarded = await RuntimeInstance.collection.updateOne(control, { $set: { updatedAt: fenceAt } }, options(session))
    if (guarded.modifiedCount !== 1) fail('PRODUCT_AUTHORITY_STALE', 'The runtime changed while recording authority.')
    const restored = await RuntimeInstance.collection.updateOne({ ...control, updatedAt: fenceAt },
      { $set: { updatedAt: runtime.updatedAt } }, options(session))
    if (restored.modifiedCount !== 1) fail('PRODUCT_AUTHORITY_STALE', 'The runtime write fence could not be restored.')
    const current = await RuntimeInstance.collection.findOne({ _id: runtime._id,
      customerId: runtime.customerId, tenantId: runtime.tenantId }, options(session))
    assertPublishedDispositionControl(current, null)
    if (basisHash(await inspectPublishedEvidenceBasis(current, session)) !== payload.expectedBasisHash)
      fail('PRODUCT_AUTHORITY_STALE', 'The authority basis changed at the write fence.')
    const receiptId = randomUUID(), recordedAt = new Date().toISOString()
    const body = membershipJson({ contractVersion: policy.contractVersion, receiptId, requestKey: payload.requestKey,
      payloadHash, approvalDocumentText: payload.approvalDocumentText, documentHash: policy.documentHash,
      approvalReference: source.approvalReference, version: source.version, procedureReference: source.procedureReference,
      approvedAt: source.approvalAtUtc, effectiveFrom: source.effectiveFromUtc, documentRecordedAt: source.recordedAtUtc,
      recordedAt, recorder: { userId: String(args.actorUserId), platformRole: 'SUPER_ADMIN' }, approver: source.approver,
      delegation: source.delegation, scope: source.scope, ledgerApproval: source.ledgerApproval,
      stateVersion: basisPolicy.stateVersion, evidencePairHash: source.basisToVerifyBeforeAnyFutureUse.evidencePairHash,
      freezeHash: basis.freezeHash, runtimeWitnessHash: basis.runtimeWitnessHash, originalAuditHash: basisPolicy.originalAuditHash,
      qualifications: basis.qualifications, authorisesLock: false, authorisesARL: false })
    const bodyHash = membershipHash(body)
    const audit = await auditService.log({ actorUserId: args.actorUserId, action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeInstance, resourceId: runtime._id,
      scope: { ...scope(), runtimeInstanceKey: runtime.runtimeInstanceKey }, requestId: args.auditRequest?.requestId,
      diff: { action: 'RUNTIME_PRODUCT_AUTHORITY_RECORDED', receiptId, bodyHash, documentHash: policy.documentHash,
        approvalReference: policy.approvalReference, version: policy.version } }, { session, throwOnError: true })
    if (!audit?._id || !signed(audit.toObject ? audit.toObject() : audit))
      fail('PRODUCT_AUTHORITY_AUDIT_INVALID', 'The required signed authority audit failed.', 503)
    const [saved] = await Receipt.create([{ ...scope(), receiptId, requestKey: payload.requestKey, payloadHash,
      approvalReference: policy.approvalReference, approvalVersion: policy.version, body, bodyHash,
      auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
    return { receipt: dto(saved), replay: false }
  })
}
