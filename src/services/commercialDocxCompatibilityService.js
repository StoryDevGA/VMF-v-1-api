import Audit from '../models/AuditLog.js'
import User from '../models/User.js'
import Execution from '../models/GovernedReasoningExecution.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { buildUserPermissionsSnapshot } from './performanceCacheService.js'
import { readMeaningSourceMasterForRendition } from './outcomeMeaningSourceMasterService.js'
import { assertCompletedReviewResult } from './masterLinkedCompletedReviewContract.js'
import { authenticateMasterReviewNativeOperator, readMasterReviewNativeOperator, MASTER_REVIEW_DATABASE } from './masterLinkedReviewOperatorAuthority.js'
import { APPROVED_EXPRESSION_VERSION, NARROW_EXPRESSION_VERSION, APPROVED_EXPRESSION_FIXED as fixed, APPROVED_SECTION13_STATE,
  approvedExpressionProfile,
  buildApprovedQualificationMapping, approvedExpressionNeed as need, assertApprovedCompatibilityReference } from './commercialDocxApprovedExpression.js'

export const APPROVED_COMPATIBILITY_ACTION = 'OUTCOME_DOCX_EXPRESSION_COMPATIBILITY_RECORDED'
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const scope = (owner = fixed) => Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, owner[key]]))
const raw = value => value?.toObject ? value.toObject() : value
const signature = value => Audit.prototype.verifySignature.call(value)
const bodyOf = context => {
  const { profile } = context, fixed = profile.fixed
  return { version: profile.version, operation: 'CREATE_PRIVATE_CORRECTION_ONLY',
  scope: scope(fixed), appActorUserId: fixed.actorUserId, masterReference: clone(context.master.masterReference),
  sourceFingerprint: fixed.sourceFingerprint, selectedPacks: clone(context.sourceEnvelope.source.selectedPacks),
  predecessor: { candidateId: fixed.predecessorCandidateId, bodyFingerprint: fixed.predecessorBodyFingerprint,
    inputFingerprint: context.predecessor.inputFingerprint, outputChecksum: context.predecessor.artifact.outputChecksum,
    failedReviewExecutionId: fixed.failedReviewExecutionId, failedReviewResultFingerprint: fixed.failedReviewResultFingerprint },
  qualificationMapping: buildApprovedQualificationMapping(context.sourceEnvelope), literalSourcePreserved: true,
  customerCatalogueVerbatim: false, section13State: APPROVED_SECTION13_STATE,
  admission: 'CONTROLLED_PRIVATE_RENDER_ONLY', schemaContentComplete: false,
  unresolvedFacts: ['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'],
  sourceMeaningApprovalChanged: false, customerApproved: false, officialUse: false,
  reviewAvailable: false, dispatchAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
}
const decisionId = body => membershipHash({ version: body.version, body }).slice(0, 24)
const reference = audit => {
  const profile = approvedExpressionProfile(audit.diff.version), fixed = profile.fixed
  return { version: profile.version, auditId: String(audit._id),
  decisionFingerprint: membershipHash(audit.diff), sourceFingerprint: fixed.sourceFingerprint,
  mappingFingerprint: membershipHash(audit.diff.body.qualificationMapping), masterId: fixed.masterId,
  predecessorCandidateId: fixed.predecessorCandidateId, failedReviewExecutionId: fixed.failedReviewExecutionId,
  failedReviewResultFingerprint: fixed.failedReviewResultFingerprint, section13State: APPROVED_SECTION13_STATE }
}

// Internal operational read. No provider capability, input replacement or
// caller-supplied admission/meaning receipt is accepted.
const currentContext = async (version = APPROVED_EXPRESSION_VERSION) => {
  const profile = approvedExpressionProfile(version), fixed = profile.fixed, narrow = version === NARROW_EXPRESSION_VERSION
  need(Audit.db === User.db && Audit.db === Execution.db && Audit.db.name === MASTER_REVIEW_DATABASE, 'COMPATIBILITY_DATABASE_OWNER')
  const actor = await User.findById(fixed.actorUserId).maxTimeMS(3000).lean()
  need(actor?.isActive === true, 'COMPATIBILITY_ACTOR_INACTIVE')
  const permissions = await buildUserPermissionsSnapshot(actor)
  const scopes = { ...permissions, customer: { ...permissions.customer, _id: fixed.customerId },
    tenant: { ...permissions.tenant, _id: fixed.tenantId, customerId: fixed.customerId } }
  const { readPrivateDocxCandidate } = await import('./outcomeDocxCandidatePersistenceService.js')
  const old = await readPrivateDocxCandidate({ actorUserId: fixed.actorUserId, runtimeInstanceId: fixed.runtimeInstanceId,
    candidateId: fixed.predecessorCandidateId, scopes, includeBytes: true, includeInput: true })
  need(old.candidate?.bodyFingerprint === fixed.predecessorBodyFingerprint
    && old.candidateInput?.contractVersion === (narrow ? 'governed-private-docx-input.v3' : 'governed-private-docx-input.v2')
    && old.candidate.masterBinding?.contractVersion === (narrow ? 'master-linked-private-docx-binding.v3' : 'master-linked-private-docx-binding.v2'), 'COMPATIBILITY_PREDECESSOR_CHANGED')
  const sourceEnvelope = old.candidateInput.sourceEnvelope
  buildApprovedQualificationMapping(sourceEnvelope)
  const master = await readMeaningSourceMasterForRendition({ actorUserId: fixed.actorUserId, runtimeInstanceId: fixed.runtimeInstanceId,
    masterId: fixed.masterId, version: 1, scopes })
  need(master.sourceEnvelope.sourceFingerprint === fixed.sourceFingerprint
    && same(master.masterReference, old.candidate.masterBinding.masterReference), 'COMPATIBILITY_MASTER_CHANGED')
  const row = await Execution.findOne({ ...scope(fixed), executionId: fixed.failedReviewExecutionId }).maxTimeMS(3000).lean()
  const body = assertCompletedReviewResult(row), binding = body.input.subject.binding
  need(body.version === (narrow ? 'master-linked-docx-review-result.v6' : 'master-linked-docx-review-result.v5') && body.reviewStatus === 'FAIL'
    && body.input.mode === 'GENUINE_CONTROLLED_TEST' && body.input.sourceProof === 'STORED_SOURCE_RECORDS'
    && binding.candidateId === fixed.predecessorCandidateId && binding.candidateBodyFingerprint === fixed.predecessorBodyFingerprint
    && binding.inputFingerprint === old.candidate.inputFingerprint && binding.docxChecksum === old.candidate.artifact.outputChecksum
    && row.executionEvidence.masterLinkedCompletedReview.bodyFingerprint === fixed.failedReviewResultFingerprint,
  'COMPATIBILITY_GENUINE_FAILURE_CHANGED')
  const stores = await import('./masterLinkedCompletedReviewService.js')
  const store = narrow ? stores.createApprovedGenuineMasterLinkedCompletedReviewStore() : stores.createGenuineMasterLinkedCompletedReviewStore()
  const completed = await store.read({ actorUserId: fixed.actorUserId,
    scopes, grantExecutionId: body.input.grant.executionId })
  need(completed.completionConfirmed === true && completed.completionPersisted === true && completed.reviewStatus === 'FAIL'
    && completed.mode === 'GENUINE_CONTROLLED_TEST' && completed.sourceProof === 'STORED_SOURCE_RECORDS'
    && completed.genuineReviewUsed === true && completed.executionId === fixed.failedReviewExecutionId
    && ['approvalAvailable', 'finalisationAvailable', 'deliveryAvailable'].every(key => completed[key] === false)
    && completed.resultFingerprint === fixed.failedReviewResultFingerprint
    && completed.docxChecksum === old.candidate.artifact.outputChecksum, 'COMPATIBILITY_COMPLETION_UNVERIFIED')
  return { profile, actorUserId: fixed.actorUserId, scopes, master, sourceEnvelope, predecessor: old.candidate }
}
const check = (audit, context) => {
  const { profile } = context, fixed = profile.fixed
  need(audit && String(audit._id) === decisionId(bodyOf(context)) && audit.signatureVersion === 3
    && audit.action === APPROVED_COMPATIBILITY_ACTION && audit.resourceType === 'RuntimeInstance'
    && String(audit.resourceId) === fixed.runtimeInstanceId
    && Object.entries(scope(fixed)).every(([key, value]) => String(audit.scope?.[key]) === value)
    && audit.diff && Object.keys(audit.diff).sort().join(',') === 'approvalReference,body,recordedAt,recorderAuthority,version'
    && audit.diff.version === profile.version && same(audit.diff.body, bodyOf(context))
    && typeof audit.diff.approvalReference === 'string' && audit.diff.approvalReference.trim().length > 0 && audit.diff.approvalReference.length <= 500
    && typeof audit.diff.recordedAt === 'string' && Number.isFinite(Date.parse(audit.diff.recordedAt))
    && new Date(audit.diff.recordedAt).toISOString() === audit.diff.recordedAt
    && String(audit.actorUserId) === audit.diff.recorderAuthority?.operatorUserId
    && audit.diff.recorderAuthority?.realm === 'native-application-test.v1'
    && signature(audit), 'COMPATIBILITY_SIGNED_DECISION_INVALID')
  return assertApprovedCompatibilityReference(reference(audit))
}

// A recorded v2 decision is read through the same immutable record/audit
// validators, without recursively reopening every historical rendition.
// Issuance still performs currentContext(v2), including full admission once.
const currentNarrowReceiptContext = async (handoff = null) => {
  const profile = approvedExpressionProfile(NARROW_EXPRESSION_VERSION), fixed = profile.fixed
  need(Audit.db === User.db && Audit.db === Execution.db && Audit.db.name === MASTER_REVIEW_DATABASE, 'COMPATIBILITY_DATABASE_OWNER')
  const assertObservation = async () => {
    if (handoff === null) return
    const { assertPrivateDocxMasterObservation } = await import('./outcomeDocxCandidatePersistenceService.js')
    assertPrivateDocxMasterObservation(handoff.observation, { actorUserId: fixed.actorUserId,
      runtimeInstanceId: fixed.runtimeInstanceId, scopes: handoff.originalScopes, masterId: fixed.masterId, version: 1 })
  }
  const currentScopes = async () => {
    const actor = await User.findById(fixed.actorUserId).maxTimeMS(3000).lean()
    need(actor?.isActive === true, 'COMPATIBILITY_ACTOR_INACTIVE')
    const permissions = await buildUserPermissionsSnapshot(actor)
    return { ...permissions, customer: { ...permissions.customer, _id: fixed.customerId },
      tenant: { ...permissions.tenant, _id: fixed.tenantId, customerId: fixed.customerId } }
  }
  const authorize = async scopes => {
    const { getRuntimeInstance, assertRuntimePermission } = await import('./runtimeInstanceService.js')
    const runtime = await getRuntimeInstance({ runtimeInstanceId: fixed.runtimeInstanceId, scopes })
    need(String(runtime?._id) === fixed.runtimeInstanceId && String(runtime.customerId) === fixed.customerId
      && String(runtime.tenantId) === fixed.tenantId, 'COMPATIBILITY_READ_SCOPE_CHANGED')
    await assertRuntimePermission({ actorUserId: fixed.actorUserId, scopes, customerId: runtime.customerId, tenantId: runtime.tenantId,
      permission: String(runtime.runtimeType).toUpperCase() === 'DEAL_ANALYSIS' ? 'DEAL_UPDATE' : 'VMF_UPDATE' })
  }
  await assertObservation()
  const scopes = await currentScopes()
  await authorize(scopes)
  const stores = await import('./masterLinkedCompletedReviewService.js')
  const reader = stores.createApprovedGenuineMasterLinkedCompletedReviewStore()
  await assertObservation()
  const witness = clone(await (handoff === null
    ? reader.readNarrowHistoricalFailureWitness({ actorUserId: fixed.actorUserId, scopes })
    : reader.readNarrowHistoricalFailureWitness({ actorUserId: fixed.actorUserId, scopes: handoff.originalScopes }, handoff.observation)))
  await assertObservation()
  await authorize(await currentScopes())
  const { master, sourceEnvelope, predecessor, predecessorInput } = witness
  need(witness.state === 'HISTORICAL_GENUINE_FAIL_WITNESS' && witness.executionId === fixed.failedReviewExecutionId
    && witness.resultFingerprint === fixed.failedReviewResultFingerprint && witness.reviewStatus === 'FAIL'
    && witness.sourceProof === 'STORED_SOURCE_RECORDS'
    && ['dispatchAvailable', 'customerApproved', 'officialUse', 'approvalAvailable', 'finalisationAvailable', 'deliveryAvailable'].every(key => witness[key] === false),
  'COMPATIBILITY_COMPLETION_UNVERIFIED')
  need(predecessor?.candidateId === fixed.predecessorCandidateId && predecessor.bodyFingerprint === fixed.predecessorBodyFingerprint
    && predecessorInput?.contractVersion === 'governed-private-docx-input.v3'
    && predecessor.masterBinding?.contractVersion === 'master-linked-private-docx-binding.v3'
    && membershipHash(predecessorInput) === predecessor.inputFingerprint
    && sourceEnvelope?.sourceFingerprint === fixed.sourceFingerprint
    && same(sourceEnvelope, master?.sourceEnvelope) && same(sourceEnvelope, predecessorInput.sourceEnvelope)
    && same(master.masterReference, predecessor.masterBinding.masterReference), 'COMPATIBILITY_PREDECESSOR_CHANGED')
  buildApprovedQualificationMapping(sourceEnvelope)
  const { assertCurrentPrivateDocxCandidatePacks } = await import('./outcomeDocxCandidatePersistenceService.js')
  await assertCurrentPrivateDocxCandidatePacks(predecessorInput)

  // Preserve the direct C396 -> old v1 signed-decision edge. The old decision
  // still has its original policy, fingerprint and current native recorder.
  const oldReference = assertApprovedCompatibilityReference(predecessor.masterBinding.compatibilityReference)
  need(oldReference.version === APPROVED_EXPRESSION_VERSION, 'COMPATIBILITY_PREDECESSOR_CHANGED')
  const oldAudit = await Audit.findById(oldReference.auditId).maxTimeMS(3000).lean()
  need(oldAudit && oldAudit.signatureVersion === 3 && signature(oldAudit)
    && membershipHash(oldAudit.diff) === oldReference.decisionFingerprint, 'COMPATIBILITY_SIGNED_DECISION_INVALID')
  const historical = oldAudit.diff?.body?.predecessor
  need(historical && /^[a-f0-9]{64}$/.test(historical.inputFingerprint)
    && /^sha256:[a-f0-9]{64}$/.test(historical.outputChecksum), 'COMPATIBILITY_PREDECESSOR_CHANGED')
  const oldContext = { profile: approvedExpressionProfile(APPROVED_EXPRESSION_VERSION), master, sourceEnvelope,
    predecessor: { inputFingerprint: historical.inputFingerprint, artifact: { outputChecksum: historical.outputChecksum } } }
  need(same(check(oldAudit, oldContext), oldReference), 'COMPATIBILITY_FINGERPRINT_CHANGED')
  const native = await readMasterReviewNativeOperator(oldAudit.diff.recorderAuthority.operatorUserId)
  need(same(native, oldAudit.diff.recorderAuthority), 'COMPATIBILITY_RECORDER_NO_LONGER_CURRENT')
  await assertObservation()
  return { profile, actorUserId: fixed.actorUserId, scopes, master, sourceEnvelope, predecessor }
}

// The native operator records the explicitly approved Product instruction.
// This action cannot appoint that operator as a business execution approver.
const recordCompatibility = async (args, version) => {
  need(args && Object.keys(args).sort().join(',') === 'approvalReference,authorization,expectedMappingFingerprint,expectedSourceFingerprint', 'COMPATIBILITY_REQUEST')
  need(typeof args.approvalReference === 'string' && args.approvalReference.trim().length > 0
    && args.approvalReference.length <= 500, 'COMPATIBILITY_APPROVAL_REFERENCE')
  const before = await authenticateMasterReviewNativeOperator(args.authorization)
  const context = await currentContext(version), body = bodyOf(context), fixed = context.profile.fixed
  need(args.expectedSourceFingerprint === body.sourceFingerprint
    && args.expectedMappingFingerprint === membershipHash(body.qualificationMapping), 'COMPATIBILITY_EXPECTATION_CHANGED')
  const operator = await authenticateMasterReviewNativeOperator(args.authorization)
  need(same(before, operator), 'COMPATIBILITY_RECORDER_CHANGED')
  const session = await Audit.db.startSession(), id = decisionId(body)
  let saved, callbacks = 0
  const acceptExisting = prior => {
    check(prior, context)
    need(prior.diff.approvalReference === args.approvalReference && same(prior.diff.recorderAuthority, operator), 'COMPATIBILITY_DECISION_CONFLICT')
    return prior
  }
  try {
    await session.withTransaction(async () => {
      need(++callbacks <= 2, 'COMPATIBILITY_RETRY_LIMIT')
      const prior = await Audit.findById(id).session(session).lean()
      if (prior) {
        saved = acceptExisting(prior); return
      }
      saved = raw(await auditService.log({ _id: id, actorUserId: operator.operatorUserId, action: APPROVED_COMPATIBILITY_ACTION,
        resourceType: 'RuntimeInstance', resourceId: fixed.runtimeInstanceId, scope: scope(fixed), signatureVersion: 3,
        diff: { version, body, approvalReference: args.approvalReference,
          recorderAuthority: operator, recordedAt: new Date().toISOString() } }, { session, throwOnError: true }))
      check(saved, context)
    }, { timeoutMS: 20000, maxCommitTimeMS: 10000 })
  } catch (error) {
    const identityRace = error?.code === 11000 && error.message?.match(/\bindex:\s+(\S+)\s+dup key:/)?.[1] === '_id_'
      && same(error.keyPattern, { _id: 1 })
    if (!identityRace) throw error
    const winner = await Audit.findById(id).maxTimeMS(3000).lean()
    if (!winner) throw error
    saved = acceptExisting(winner)
  } finally { await session.endSession() }
  const current = await Audit.findById(id).maxTimeMS(3000).lean()
  const result = check(current, version === NARROW_EXPRESSION_VERSION ? await currentNarrowReceiptContext() : await currentContext(version))
  need(same(raw(current), raw(saved)), 'COMPATIBILITY_READBACK_CHANGED')
  return { compatibilityReference: result, customerApproved: false, reviewAvailable: false, finalisationAvailable: false }
}
export const recordApprovedCommercialCompatibility = args => recordCompatibility(args, APPROVED_EXPRESSION_VERSION)
export const recordNarrowCommercialCompatibility = args => recordCompatibility(args, NARROW_EXPRESSION_VERSION)
// Internal source-verified dry run; this neither records a decision nor grants
// operator, review or finalisation authority.
export const prepareNarrowCommercialCompatibility = async () => {
  const context = await currentContext(NARROW_EXPRESSION_VERSION), body = bodyOf(context)
  return { status: 'PREPARED_UNRECORDED', auditId: decisionId(body), body: clone(body),
    sourceEnvelope: clone(context.sourceEnvelope), expectedSourceFingerprint: body.sourceFingerprint,
    expectedMappingFingerprint: membershipHash(body.qualificationMapping), customerApproved: false, reviewAvailable: false, finalisationAvailable: false }
}
export const prepareNarrowCommercialCompatibilityWitness = async () => {
  const context = await currentNarrowReceiptContext(), body = bodyOf(context)
  return { status: 'PREPARED_UNRECORDED', auditId: decisionId(body), body: clone(body),
    sourceEnvelope: clone(context.sourceEnvelope), expectedSourceFingerprint: body.sourceFingerprint,
    expectedMappingFingerprint: membershipHash(body.qualificationMapping), customerApproved: false, reviewAvailable: false, finalisationAvailable: false }
}
export const readApprovedCommercialCompatibility = async (args, ...observations) => {
  need(args && Object.keys(args).sort().join(',') === 'actorUserId,auditId,expectedDecisionFingerprint,runtimeInstanceId,scopes', 'COMPATIBILITY_READ_REQUEST')
  need(args.actorUserId === fixed.actorUserId && args.runtimeInstanceId === fixed.runtimeInstanceId
    && typeof args.auditId === 'string' && /^[a-f0-9]{24}$/.test(args.auditId)
    && typeof args.expectedDecisionFingerprint === 'string' && /^[a-f0-9]{64}$/.test(args.expectedDecisionFingerprint)
    && String(args.scopes?.customer?._id) === fixed.customerId && String(args.scopes?.tenant?._id) === fixed.tenantId,
  'COMPATIBILITY_READ_SCOPE')
  const audit = await Audit.findById(args.auditId).maxTimeMS(3000).lean()
  need(audit && audit.signatureVersion === 3 && signature(audit), 'COMPATIBILITY_SIGNED_DECISION_INVALID')
  const profile = approvedExpressionProfile(audit.diff?.version)
  if (profile.version === NARROW_EXPRESSION_VERSION) need(observations.length <= 1, 'COMPATIBILITY_READ_REQUEST')
  const context = profile.version === NARROW_EXPRESSION_VERSION
    ? await currentNarrowReceiptContext(observations.length === 0 ? null : { observation: observations[0], originalScopes: args.scopes })
    : await currentContext(profile.version)
  const result = check(audit, context)
  need(result.decisionFingerprint === args.expectedDecisionFingerprint, 'COMPATIBILITY_FINGERPRINT_CHANGED')
  const native = await readMasterReviewNativeOperator(audit.diff.recorderAuthority.operatorUserId)
  need(same(native, audit.diff.recorderAuthority), 'COMPATIBILITY_RECORDER_NO_LONGER_CURRENT')
  return result
}
