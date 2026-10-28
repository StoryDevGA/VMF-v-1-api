import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import Receipt, { assertPublishedDispositionReceipt } from '../models/RuntimePublishedDispositionReceipt.js'
import { PUBLISHED_DISPOSITION_POLICY as policy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { readVerifiedSupplementalFindingForCompletion, readVerifiedSupplementalFindingForHistory } from './supplementalFindingReviewService.js'
import { buildPublishedDispositionPopulation, publishedFindingLink, publishedDispositionExpectedBasisHash } from './publishedDispositionPopulationService.js'
import { buildPublishedEvidenceMembershipManifest, membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import auditService from './auditService.js'

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const options = session => ({ session, maxTimeMS: 3000 })
const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, new mongoose.Types.ObjectId(policy.scope[key])]))
const requireEnvironment = () => {
  if (!['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development'
    || !/^(test|ss044_[a-f0-9]{32})$/.test(mongoose.connection.name || ''))
    fail('PUBLISHED_RECOVERY_SCOPE', 'This policy is restricted to controlled Development/Test.', 403)
}
export const isPublishedDispositionRecoveryRuntime = runtime => String(runtime._id || runtime.id) === policy.scope.runtimeInstanceId
  && runtime.runtimeInstanceKey === policy.scope.runtimeInstanceKey
export const publishedRuntimeWitnessHash = runtime => {
  const material = membershipJson(runtime)
  delete material.updatedAt
  delete material.updatedBy
  return membershipHash(material)
}
const rawRuntime = async (args, session) => {
  requireEnvironment()
  const selected = await getRuntimeInstance({ runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes,
    projection: 'customerId tenantId runtimeInstanceKey', session, maxTimeMS: 3000 })
  if (String(selected.id || selected._id) !== policy.scope.runtimeInstanceId
    || String(selected.customerId) !== policy.scope.customerId || String(selected.tenantId) !== policy.scope.tenantId)
    fail('PUBLISHED_RECOVERY_SCOPE', 'This recovery policy does not apply to the selected runtime.', 403)
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
    customerId: selected.customerId, tenantId: selected.tenantId, permission: 'VMF_UPDATE', session })
  const runtime = await RuntimeInstance.collection.findOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId),
    customerId: new mongoose.Types.ObjectId(policy.scope.customerId), tenantId: new mongoose.Types.ObjectId(policy.scope.tenantId) }, options(session))
  if (!runtime || !isPublishedDispositionRecoveryRuntime(runtime)) fail('PUBLISHED_RECOVERY_SCOPE', 'The controlled runtime is unavailable.', 403)
  return runtime
}
const signed = audit => audit && AuditLog.hydrate(audit).verifySignature() === true
const originalAudits = async session => {
  const audits = await AuditLog.collection.find({ ...Object.fromEntries(Object.entries(scope()).map(([key, value]) => ['scope.' + key, value])), _id: { $in: policy.auditIds.map(id => new mongoose.Types.ObjectId(id)) } }, options(session))
    .sort({ _id: 1 }).limit(policy.auditIds.length + 1).batchSize(policy.auditIds.length + 1).toArray()
  // Audit scope is nested; never broaden the runtime/customer boundary.
  return audits
}
const auditReferences = rows => rows.map(row => ({ auditId: String(row._id), signature: row.signature, signatureVersion: row.signatureVersion }))
const qualifications = evidence => ({
  legacyMissingEvidenceSupportIds: evidence.filter(row => !row.evidenceSupport).map(row => row.evidenceObjectId).sort(),
  legacyLimitationsPreserved: true, sourceAuthenticityApproval: false, publicResearchAcquisition: false,
})
export const inspectPublishedEvidenceBasis = async (runtime, session) => {
  if (runtime.status !== 'ACTIVE' || runtime.runtimeType !== 'VALUE_NARRATIVE' || runtime.revision?.revisionNumber !== 1
    || runtime.framework_state?.lifecycle?.stage !== 'PUBLISHED' || runtime.framework_state?.lock?.locked === true
    || runtime.lockedAt || runtime.lockedEvidenceSnapshot || runtime.stateVersion !== policy.stateVersion
    || ['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(runtime.executionStatus)
    || publishedRuntimeWitnessHash(runtime) !== policy.runtimeWitnessHash)
    fail('PUBLISHED_RECOVERY_STALE', 'The approved published runtime basis changed.')
  const rows = {}
  for (const [kind, name, limit] of [['sources', 'runtime_evidence_sources', 8], ['evidence', 'runtime_evidence_objects', 47], ['sections', 'runtime_section_states', 6]]) {
    rows[kind] = await mongoose.connection.db.collection(name).find({ ...scope(), current: true, stateVersion: policy.stateVersion }, options(session)).limit(limit + 1).toArray()
    if (rows[kind].length !== limit) fail('PUBLISHED_RECOVERY_STALE', 'The approved membership count changed.')
  }
  if (rows.evidence.some(row => row.reviewStatus !== 'ACCEPTED')) fail('PUBLISHED_RECOVERY_STALE', 'An evidence disposition changed.')
  const manifest = buildPublishedEvidenceMembershipManifest({ runtime, ...rows })
  if (membershipHash(manifest) !== policy.manifestHash || membershipHash(qualifications(rows.evidence)) !== policy.qualificationsHash)
    fail('PUBLISHED_RECOVERY_STALE', 'The frozen membership or its qualifications changed.')
  const audits = await originalAudits(session)
  if (audits.length !== policy.auditIds.length || audits.some(row => !signed(row)))
    fail('PUBLISHED_RECOVERY_AUDIT_INVALID', 'An original signed audit cannot be verified.')
  const refs = auditReferences(audits)
  if (membershipHash(refs) !== policy.originalAuditHash) fail('PUBLISHED_RECOVERY_AUDIT_INVALID', 'The original audit bindings changed.')
  return { manifest, freezeHash: policy.manifestHash, runtimeWitnessHash: policy.runtimeWitnessHash,
    originalAudits: refs, qualifications: qualifications(rows.evidence) }
}
const inspectBasis = async (runtime, session) => {
  const basis = await inspectPublishedEvidenceBasis(runtime, session)
  const finding = await readVerifiedSupplementalFindingForCompletion({ runtime, session })
  const rows = {}
  for (const [kind, name] of [['sources', 'runtime_evidence_sources'], ['evidence', 'runtime_evidence_objects'], ['sections', 'runtime_section_states']]) {
    rows[kind] = await mongoose.connection.db.collection(name).find({ ...scope(), current: true, stateVersion: policy.stateVersion }, options(session))
      .limit(basis.manifest.counts[kind] + 1).toArray()
  }
  const population = buildPublishedDispositionPopulation({ runtime, ...rows, admissionAudits: await originalAudits(session), finding })
  const findingReview = publishedFindingLink(finding)
  return { ...basis, population, findingReview, predecessorControl: { updatedAt: findingReview.createdAt, updatedBy: findingReview.reviewerUserId } }
}
const link = record => ({ receiptId: record.receiptId, bodyHash: record.bodyHash,
  freezeHash: record.body.freezeHash, policyVersion: policy.policyVersion, approvalReference: policy.approval.approvalReference,
  ...(record.body.findingReview ? { findingReview: record.body.findingReview } : {}) })
const verifyRecord = async (record, session, findingReview) => {
  if (!record) fail('PUBLISHED_RECOVERY_REQUIRED', 'A persisted supplemental disposition receipt and freeze are required.')
  try { assertPublishedDispositionReceipt(record) } catch { fail('PUBLISHED_RECOVERY_INVALID', 'The supplemental receipt or freeze is invalid.') }
  if (!record.body.findingReview || membershipHash(record.body.findingReview) !== membershipHash(findingReview))
    fail('PUBLISHED_RECOVERY_INVALID', 'The independent finding receipt binding changed.')
  const audit = await AuditLog.collection.findOne({ _id: new mongoose.Types.ObjectId(record.auditId),
    resourceId: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId), 'scope.customerId': new mongoose.Types.ObjectId(policy.scope.customerId),
    'scope.tenantId': new mongoose.Types.ObjectId(policy.scope.tenantId) }, options(session))
  if (!signed(audit) || audit.signatureVersion !== record.auditSignatureVersion
    || audit.diff?.action !== 'PUBLISHED_DISPOSITION_SUPPLEMENT' || audit.diff?.receiptId !== record.receiptId
    || audit.diff?.bodyHash !== record.bodyHash || String(audit.actorUserId) !== record.body.reviewer.userId
    || membershipHash(audit.diff?.findingReview) !== membershipHash(findingReview)
    || audit.action !== auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED
    || audit.resourceType !== auditService.RESOURCE_TYPES.RuntimeInstance)
    fail('PUBLISHED_RECOVERY_AUDIT_INVALID', 'The supplemental receipt creation audit cannot be verified.')
  return record
}
const readRecord = session => Receipt.findOne({ ...scope(), policyVersion: policy.policyVersion }).session(session).maxTimeMS(3000).lean()
export const assertPublishedDispositionControl = (runtime, record) => {
  const expectedTime = record ? record.body?.committedUpdatedAt : policy.updatedAt
  const expectedActor = record ? record.body?.reviewer?.userId : policy.originalUpdatedBy
  const time = new Date(runtime?.updatedAt)
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== expectedTime
    || !Object.hasOwn(runtime, 'updatedBy') || String(runtime.updatedBy) !== expectedActor)
    fail('PUBLISHED_RECOVERY_STALE', 'An intervening runtime write invalidated recovery.')
}
const assertCompletionControl = (runtime, record, basis) => {
  if (record) return assertPublishedDispositionControl(runtime, record)
  if (new Date(runtime.updatedAt).toISOString() !== basis.predecessorControl.updatedAt
    || !Object.hasOwn(runtime, 'updatedBy') || String(runtime.updatedBy) !== basis.predecessorControl.updatedBy)
    fail('PUBLISHED_RECOVERY_STALE', 'The verified finding control changed.')
}
const assertRecordBasis = (record, basis) => {
  if (membershipHash(record.body.reviewPopulation) !== membershipHash(basis.population)
    || membershipHash(record.body.predecessorControl) !== membershipHash(basis.predecessorControl))
    fail('PUBLISHED_RECOVERY_INVALID', 'The saved supplemental population changed.')
}
const dto = record => ({ ...link(record), type: policy.contractVersion, createdAt: record.body.createdAt,
  reviewer: record.body.reviewer, rationale: record.body.rationale, counts: record.body.frozenMembership.counts,
  approval: policy.approval, qualifications: record.body.qualifications, auditId: String(record.auditId) })
const transaction = async operation => {
  requireEnvironment()
  const session = await mongoose.startSession()
  try {
    return await session.withTransaction(() => operation(session), {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 3000, timeoutMS: 20000,
    })
  } finally { await session.endSession() }
}
export { requireEnvironment as requirePublishedRecoveryEnvironment, rawRuntime as loadPublishedRecoveryRuntime,
  transaction as withPublishedRecoveryTransaction }
export const inspectPublishedDispositionRecovery = args => transaction(async session => {
  const runtime = await rawRuntime(args, session), basis = await inspectBasis(runtime, session)
  const record = await readRecord(session)
  if (record) { await verifyRecord(record, session, basis.findingReview); assertRecordBasis(record, basis) }
  assertCompletionControl(runtime, record, basis)
  return { policyVersion: policy.policyVersion, approval: policy.approval, scope: policy.scope,
    expectedBasisHash: publishedDispositionExpectedBasisHash(basis),
    expectedUpdatedAt: basis.predecessorControl.updatedAt, counts: basis.manifest.counts, qualifications: basis.qualifications,
    receipt: record ? dto(record) : null }
})
const assertIndexes = async session => {
  const indexes = await Receipt.collection.listIndexes(options(session)).toArray()
  for (const [name, last] of [['unique_published_disposition_policy', 'policyVersion'], ['unique_published_disposition_request', 'requestKey']]) {
    const index = indexes.find(item => item.name === name)
    if (!index?.unique || index.sparse || index.partialFilterExpression
      || JSON.stringify(index.key) !== JSON.stringify({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [last]: 1 }))
      fail('PUBLISHED_RECOVERY_INDEX_REQUIRED', 'Required recovery uniqueness is unavailable.', 503)
  }
}
export const recordPublishedDispositionRecovery = async args => {
  requireEnvironment()
  await assertIndexes(null)
  return transaction(async session => {
  const { payload } = args
  if (!payload || Object.keys(payload).some(key => !['requestKey', 'expectedBasisHash', 'expectedUpdatedAt', 'rationale', 'confirm'].includes(key))
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.requestKey || '')
    || !/^[a-f0-9]{64}$/.test(payload.expectedBasisHash || '') || typeof payload.expectedUpdatedAt !== 'string'
    || payload.confirm !== true || typeof payload.rationale !== 'string' || payload.rationale.trim().length < 10 || payload.rationale.length > 2000
    || !mongoose.isValidObjectId(args.actorUserId)) fail('PUBLISHED_RECOVERY_INVALID', 'Explicit confirmation and the exact approved basis are required.', 422)
  const runtime = await rawRuntime(args, session), basis = await inspectBasis(runtime, session)
  const expected = publishedDispositionExpectedBasisHash(basis)
  if (expected !== payload.expectedBasisHash || payload.expectedUpdatedAt !== basis.predecessorControl.updatedAt) fail('PUBLISHED_RECOVERY_STALE', 'The confirmed recovery basis changed.')
  const record = await readRecord(session)
  assertCompletionControl(runtime, record, basis)
  const payloadHash = membershipHash({ ...payload, actorUserId: String(args.actorUserId) })
  if (record) {
    await verifyRecord(record, session, basis.findingReview)
    assertRecordBasis(record, basis)
    if (record.requestKey !== payload.requestKey || record.payloadHash !== payloadHash)
      fail('PUBLISHED_RECOVERY_STALE', 'A different recovery request already committed.')
    return { receipt: dto(record), replay: true }
  }
  const createdAt = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1)).toISOString()
  const guarded = await RuntimeInstance.collection.updateOne({ _id: runtime._id, customerId: runtime.customerId,
    tenantId: runtime.tenantId, stateVersion: policy.stateVersion, updatedAt: runtime.updatedAt, updatedBy: runtime.updatedBy,
    'framework_state.lifecycle.stage': 'PUBLISHED', 'framework_state.lock.locked': { $ne: true } },
  { $set: { updatedAt: new Date(createdAt), updatedBy: new mongoose.Types.ObjectId(args.actorUserId) } }, options(session))
  if (guarded.modifiedCount !== 1) fail('PUBLISHED_RECOVERY_STALE', 'The runtime changed while recording recovery.')
  const receiptId = randomUUID()
  const body = membershipJson({ contractVersion: policy.contractVersion, policyVersion: policy.policyVersion,
    approvalReference: policy.approval.approvalReference, approvalTextHash: policy.approval.textHash, approvedBy: policy.approval.approvedBy,
    receiptId, requestKey: payload.requestKey, payloadHash, observedStateVersion: policy.stateVersion,
    originalUpdatedAt: policy.updatedAt, originalUpdatedBy: policy.originalUpdatedBy, committedUpdatedAt: createdAt, createdAt,
    reviewer: { userId: String(args.actorUserId), permission: 'VMF_UPDATE', authorityReference: policy.policyVersion },
    rationale: payload.rationale.trim(), runtimeWitnessHash: basis.runtimeWitnessHash,
    frozenMembership: basis.manifest, freezeHash: basis.freezeHash, reviewPopulation: basis.population,
    findingReview: basis.findingReview, predecessorControl: basis.predecessorControl,
    requestBasis: { expectedBasisHash: expected, expectedUpdatedAt: payload.expectedUpdatedAt, rationale: payload.rationale, confirm: true },
    originalAudits: basis.originalAudits, originalAuditHash: policy.originalAuditHash, qualifications: basis.qualifications })
  const bodyHash = membershipHash(body)
  const audit = await auditService.log({ actorUserId: args.actorUserId, action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance, resourceId: runtime._id,
    scope: { ...scope(), runtimeInstanceKey: runtime.runtimeInstanceKey }, requestId: args.auditRequest?.requestId,
    diff: { action: 'PUBLISHED_DISPOSITION_SUPPLEMENT', receiptId, bodyHash, freezeHash: basis.freezeHash,
      policyVersion: policy.policyVersion, approvalReference: policy.approval.approvalReference, findingReview: basis.findingReview } }, { session, throwOnError: true })
  if (!audit?._id || !signed(audit.toObject ? audit.toObject() : audit)) fail('PUBLISHED_RECOVERY_AUDIT_INVALID', 'The required signed audit failed.', 503)
  const [saved] = await Receipt.create([{ ...scope(), receiptId, requestKey: payload.requestKey, payloadHash,
    policyVersion: policy.policyVersion, body, bodyHash, auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
  await verifyRecord(saved.toObject(), session, basis.findingReview)
  return { receipt: dto(saved), replay: false }
  })
}
export const verifyPublishedDispositionForLock = async (runtime, session) => {
  if (!isPublishedDispositionRecoveryRuntime(runtime)) return null
  requireEnvironment()
  // E1 receipts are deliberately not completion/lock evidence. Even a malformed test record keeps execution held.
  if (await mongoose.connection.db.collection('runtime_synthetic_test_disposition_receipts')
    .findOne(scope(), options(session)))
    fail('SYNTHETIC_PIPELINE_HELD', 'Test-only receipt persistence does not release completion, lock or ARL.')
  const current = await RuntimeInstance.collection.findOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId),
    customerId: new mongoose.Types.ObjectId(policy.scope.customerId), tenantId: new mongoose.Types.ObjectId(policy.scope.tenantId) }, options(session))
  const basis = await inspectBasis(current, session)
  const record = await verifyRecord(await readRecord(session), session, basis.findingReview)
  assertRecordBasis(record, basis)
  assertPublishedDispositionControl(current, record)
  if (new Date(runtime.updatedAt).getTime() !== new Date(current.updatedAt).getTime()) fail('PUBLISHED_RECOVERY_STALE', 'The lock request is stale.')
  return link(record)
}
export const verifyPublishedDispositionLockLink = async ({ runtime, audit, session }) => {
  if (!isPublishedDispositionRecoveryRuntime(runtime)) return
  requireEnvironment()
  const finding = await readVerifiedSupplementalFindingForHistory({ runtime, session })
  const record = await verifyRecord(await readRecord(session), session, publishedFindingLink(finding))
  if (!signed(audit) || membershipHash(audit.diff?.publishedDispositionRecovery) !== membershipHash(link(record)))
    fail('PUBLISHED_RECOVERY_INVALID', 'The lock audit does not bind the persisted recovery freeze.')
  const audits = await originalAudits(session)
  if (audits.some(row => !signed(row)) || membershipHash(auditReferences(audits)) !== policy.originalAuditHash)
    fail('PUBLISHED_RECOVERY_AUDIT_INVALID', 'The original signed disposition history changed.')
  const rows = {}
  for (const [kind, name] of [['sources', 'runtime_evidence_sources'], ['evidence', 'runtime_evidence_objects'], ['sections', 'runtime_section_states']]) {
    const members = record.body.frozenMembership[kind]
    rows[kind] = (await mongoose.connection.db.collection(name).find({ ...scope(), stateVersion: policy.stateVersion,
      _id: { $in: members.map(member => new mongoose.Types.ObjectId(member.storageId)) } }, options(session))
      .limit(members.length + 1).toArray()).map(row => ({ ...row, current: true }))
    if (rows[kind].length !== members.length) fail('PUBLISHED_RECOVERY_INVALID', 'Frozen historical membership is missing.')
  }
  const rebuilt = buildPublishedEvidenceMembershipManifest({ runtime: { ...runtime, stateVersion: policy.stateVersion }, ...rows,
    contextBindingSectionKeys: record.body.frozenMembership.sections.filter(row => row.contextBindings).map(row => row.sectionKey) })
  if (membershipHash(rebuilt) !== record.body.freezeHash) fail('PUBLISHED_RECOVERY_INVALID', 'Frozen historical membership changed.')
  return { ...publishedFindingLink(finding), storageId: String(finding._id),
    candidate: membershipJson(finding.body.candidate), evidence: membershipJson(finding.body.evidence),
    reviewEpoch: finding.body.reviewEpoch, frozenMembershipHash: record.body.freezeHash,
    rationale: finding.body.rationale }
}
