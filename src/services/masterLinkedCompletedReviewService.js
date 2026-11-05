import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Audit from '../models/AuditLog.js'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { snapshotOwnedMasterLinkedReviewResult } from './openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createGenuineMasterLinkedReviewAuthority, createNetworkQaMasterLinkedReviewAuthority, createApprovedGenuineMasterLinkedReviewAuthority,
  createApprovedNetworkQaMasterLinkedReviewAuthority, createNarrowGenuineMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { G1_MODES, G1_ACTIONS, g1QaReleaseProfile, g1ReceiptId, g1Reference, assertG1Record, assertG1Audit, assertG1Approval, assertG1QaRelease,
  isG1ApprovedRequest, g1RequestProfile } from './masterLinkedGenuineReviewContract.js'
import { assertRenditionClaimIndex } from './governedRenditionReviewClaimService.js'
import { assertMeaningMasterRecord, assertMeaningMasterAudit } from './outcomeMeaningSourceMasterContract.js'
import { MASTER_REVIEW_DATABASE } from './masterLinkedReviewOperatorAuthority.js'
import { NARROW_EXPRESSION_FIXED } from './commercialDocxApprovedExpression.js'
import { assertPrivateDocxCandidateRecord, assertPrivateDocxCandidateAudit } from './outcomeDocxCandidateRecordContract.js'
import { assertDocxPagePreviewRecord, assertDocxPagePreviewAudit } from './outcomeDocxPagePreviewRecordContract.js'
import { assertMasterLinkedCandidateBinding } from './outcomeMasterLinkedDocxContract.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { COMPLETED_REVIEW_OUTPUT, COMPLETED_REVIEW_STATUS, COMPLETED_ARTIFACT_TYPE,
  COMPLETED_REVIEW_ACTIONS, APPROVED_COMPLETED_REVIEW_VERSION, completedReviewProfile, completedReviewFailure, completedNeed as need,
  completedExact, completedSame as same, completedReviewKey, completedReviewFamily,
  assertCompletedReviewInput, buildCompletedReviewStage, completedStageReference, assertCompletedReviewResult, assertCompletedReviewArtifact,
  assertCompletedReviewStage, completedAuditDiff, assertCompletedReviewAudit } from './masterLinkedCompletedReviewContract.js'

const clone = v => JSON.parse(JSON.stringify(v)), raw = v => v?.toObject ? v.toObject({ depopulate: true }) : v
const held = { approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
const remaining = ctx => { const ms = ctx.deadline - Date.now(); need(ms > 0, 'COMPLETION_DEADLINE'); return ms }
const read = (ctx, model, filter, session, privateFields) => {
  remaining(ctx); let query = model.findOne(filter)
  if (privateFields) query = query.select(privateFields)
  if (session) query = query.session(session)
  else query = query.setOptions({ timeoutMS: Math.min(3000, remaining(ctx)) })
  return query.lean()
}
const sourceRef = row => ({ storageId: String(row._id), bodyFingerprint: row.bodyFingerprint, auditId: String(row.auditId), auditSignatureVersion: row.auditSignatureVersion })
const planRef = row => ({ recordId: String(row._id), ...Object.fromEntries(['planId', 'planVersion', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, row[k]])) })
const createStore = (mode, dependencies, approved = false) => {
  const narrow = approved === 'NARROW'
  need(!narrow || mode === G1_MODES.GENUINE, 'NARROW_COMPLETION_MODE')
  const deps = { Execution, Artifact, Stage, Audit, Master, Candidate, Preview, Plan, auditService,
    assertPlanIntegrity: assertOutcomeKnowledgeCompositionPlanIntegrity, ...dependencies }
  const authority = narrow ? createNarrowGenuineMasterLinkedReviewAuthority() : approved && mode === G1_MODES.QA ? createApprovedNetworkQaMasterLinkedReviewAuthority()
    : approved ? createApprovedGenuineMasterLinkedReviewAuthority()
    : mode === G1_MODES.QA ? createNetworkQaMasterLinkedReviewAuthority() : createGenuineMasterLinkedReviewAuthority()
  const readAuthority = deps.readAuthority || authority.read
  const verifySignature = row => deps.Audit.prototype.verifySignature.call(row)
  const sourceProof = deps.readSourceRecords ? 'SIGNED_IN_MEMORY_TEST_FIXTURE' : 'STORED_SOURCE_RECORDS'
  const sourceRows = async (ctx, session) => {
    if (deps.readSourceRecords) return deps.readSourceRecords({ scope: clone(ctx.scope), subject: clone(ctx.subject), session })
    const b = ctx.subject.binding
    const master = await read(ctx, deps.Master, { ...ctx.scope, _id: b.masterReference.storageId }, session)
    const candidate = await read(ctx, deps.Candidate, { ...ctx.scope, candidateId: b.candidateId }, session, '+fileBytes')
    const preview = await read(ctx, deps.Preview, { ...ctx.scope, previewId: b.previewId }, session, '+pageBytes')
    need(master && candidate && preview, 'SOURCE_RECORD_MISSING')
    const plan = await read(ctx, deps.Plan, { ...ctx.scope, _id: master.body.sourceSnapshot.plan.recordId, planId: ctx.planId }, session)
    const audits = {}
    for (const [kind, row] of Object.entries({ master, candidate, preview })) audits[kind] = await read(ctx, deps.Audit, { _id: row.auditId }, session)
    return { master, candidate, preview, plan, audits }
  }
  const verifySources = async (ctx, session, includeRows = false) => {
    const records = await sourceRows(ctx, session), { master, candidate, preview, plan, audits } = records
    need(master && candidate && preview && plan && audits, 'SOURCE_RECORD_MISSING')
    assertMeaningMasterRecord(master); assertMeaningMasterAudit(master, audits.master, verifySignature)
    assertPrivateDocxCandidateRecord(candidate); assertPrivateDocxCandidateAudit(candidate, audits.candidate, verifySignature)
    assertDocxPagePreviewRecord(preview); assertDocxPagePreviewAudit(preview, audits.preview, verifySignature)
    const b = ctx.subject.binding, masterReference = { ...sourceRef(master), masterId: master.masterId, version: master.version,
      scope: master.body.scope, sourceFingerprint: master.sourceFingerprint, sourceProjectionFingerprint: master.body.sourceProjectionFingerprint }
    need(same(masterReference, b.masterReference) && candidate.candidateId === b.candidateId && candidate.bodyFingerprint === b.candidateBodyFingerprint
      && candidate.body.inputFingerprint === b.inputFingerprint && candidate.body.sourceFingerprint === b.sourceFingerprint
      && candidate.body.artifact.outputChecksum === b.docxChecksum && assertMasterLinkedCandidateBinding(candidate.body) === b.masterBindingFingerprint
      && same(candidate.body.masterBinding.masterReference, b.masterReference) && same(candidate.body.input.renderer, b.renderer)
      && preview.previewId === b.previewId && preview.candidateId === b.candidateId && preview.body.candidateBodyFingerprint === b.candidateBodyFingerprint
      && preview.body.masterBindingFingerprint === b.masterBindingFingerprint && preview.body.conversionFingerprint === b.conversionFingerprint
      && preview.runtimeFingerprint === b.runtimeFingerprint && preview.docxChecksum === b.docxChecksum && preview.body.inputFingerprint === b.inputFingerprint
      && preview.body.sourceFingerprint === b.sourceFingerprint && same(preview.body.renderer, b.renderer) && same(preview.body.conversion.pages, b.pages), 'SOURCE_BINDING_CHANGED')
    if (b.contractVersion === 'master-linked-docx-review-binding.v2') need(same(candidate.body.masterBinding.correctionReference, b.correctionReference), 'CORRECTION_REFERENCE_CHANGED')
    // Current compatibility admission is owned by the approved G1 transport.
    // Here rejoin its exact reference from the signed immutable candidate.
    if (['master-linked-docx-review-binding.v3', 'master-linked-docx-review-binding.v4'].includes(b.contractVersion)) need(same(candidate.body.masterBinding.compatibilityReference, b.compatibilityReference), 'COMPATIBILITY_REFERENCE_CHANGED')
    const selected = master.body.sourceSnapshot.plan, descriptor = planRef(plan)
    need(Object.entries(ctx.scope).every(([k, v]) => String(plan[k]) === v) && descriptor.planId === ctx.planId
      && Object.entries(selected).every(([k, v]) => descriptor[k] === v), 'SOURCE_PLAN_CHANGED')
    await deps.assertPlanIntegrity(plan)
    const observed = { sourceRecords: Object.fromEntries(Object.entries({ master, candidate, preview }).map(([k, v]) => [k, sourceRef(v)])), plan: descriptor }
    if (ctx.sources) need(same(observed, ctx.sources), 'SOURCE_REFERENCES_CHANGED')
    remaining(ctx); return includeRows ? { observed, records } : observed
  }
  const verifyG1 = async (ctx, session) => {
    const rows = {}
    for (const [kind, phase] of [['grant', 'GRANT'], ['reservation', 'RESERVATION'], ['start', 'START_OR_REVOKE']]) {
      const row = await read(ctx, deps.Execution, { ...ctx.scope, executionId: ctx.refs[kind].executionId }, session), b = assertG1Record(row)
      need(b.phase === phase && b.mode === mode && b.onceRoot === ctx.root && b.actorUserId === ctx.actorUserId && b.planId === ctx.planId
        && b.qaCase === ctx.qaCase && same(b.subject, ctx.subject) && same(b.request, ctx.binding) && same(b.runtime, ctx.runtime)
        && same(g1Reference(row), ctx.refs[kind]), 'G1_PHASE_CHANGED')
      assertG1Audit(row, await read(ctx, deps.Audit, { _id: row.executionEvidence.masterDocxDispatch.auditId }, session), verifySignature)
      rows[kind] = row
    }
    const g = rows.grant.executionEvidence.masterDocxDispatch.body, r = rows.reservation.executionEvidence.masterDocxDispatch.body,
      s = rows.start.executionEvidence.masterDocxDispatch.body
    need(s.decision === 'START_ALLOWED' && same(r.grant, ctx.refs.grant) && same(s.grant, ctx.refs.grant) && same(s.reservation, ctx.refs.reservation)
      && ['expiresAt', 'grantCreatedAt', 'approval'].every(k => same(g[k], r[k]) && same(g[k], s[k])), 'G1_PHASE_JOIN')
    if (mode === G1_MODES.GENUINE) {
      const approval = await read(ctx, deps.Audit, { _id: g.approval.auditId }, session)
      const release = assertG1Approval(approval, ctx.subject, ctx.binding, verifySignature, Date.now(), false)
      need(membershipHash(approval.diff) === g.approval.diffFingerprint, 'G1_APPROVAL_CHANGED')
      if (['master-linked-docx-review-subject.v3', 'master-linked-docx-review-subject.v4', 'master-linked-docx-review-subject.v5'].includes(ctx.subject.contractVersion)) need(g.grantCreatedAt === release.issuedAt
        && g.expiresAt === release.expiresAt, 'CORRECTED_GENUINE_RELEASE_TIME_CHANGED')
    } else if (['master-linked-docx-review-subject.v3', 'master-linked-docx-review-subject.v4'].includes(ctx.subject.contractVersion)) {
      need(g.approval?.kind === g1QaReleaseProfile(ctx.subject, ctx.binding).kind, 'CORRECTED_QA_RELEASE_REQUIRED')
      const release = await read(ctx, deps.Audit, { _id: g.approval.auditId }, session)
      const diff = assertG1QaRelease(release, ctx.subject, ctx.binding, verifySignature, Date.now(), ctx.qaCase, false)
      need(membershipHash(diff) === g.approval.diffFingerprint && g.grantCreatedAt === diff.issuedAt && g.expiresAt === diff.expiresAt, 'CORRECTED_QA_RELEASE_CHANGED')
    }
    const response = await read(ctx, deps.Audit, { _id: new mongoose.Types.ObjectId(g1ReceiptId(rows.reservation.executionId, 'RESPONSE')) }, session)
    const expected = { version: 'master-linked-docx-dispatch.v2', mode, kind: 'RESPONSE', onceRoot: ctx.root, reservation: ctx.refs.reservation,
      request: ctx.binding, payload: ctx.responseIdentity }
    need(response && String(response._id) === g1ReceiptId(rows.reservation.executionId, 'RESPONSE') && response.signatureVersion === 3
      && response.action === G1_ACTIONS.RESPONSE && response.resourceType === 'GovernedReasoningExecution' && String(response.resourceId) === String(rows.reservation._id)
      && String(response.actorUserId) === ctx.actorUserId && Object.entries(ctx.scope).every(([k, v]) => String(response.scope?.[k]) === v)
      && same(response.diff, expected) && verifySignature(response) === true, 'G1_RESPONSE_CHANGED')
    remaining(ctx)
    return { auditId: String(response._id), signatureVersion: 3, diffFingerprint: membershipHash(response.diff), identity: clone(response.diff.payload) }
  }
  const indexes = async ctx => {
    need([deps.Artifact, deps.Stage, deps.Audit].every(m => m.db === deps.Execution.db), 'COMPLETION_DATABASE_OWNER')
    remaining(ctx)
    await assertRenditionClaimIndex(deps.Execution)
    remaining(ctx)
    for (const [model, name, keys] of [[deps.Execution, 'executionId_1', { executionId: 1 }], [deps.Artifact, 'runtimeArtifactId_1', { runtimeArtifactId: 1 }],
      [deps.Stage, 'uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }],
      [deps.Stage, 'uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 }], [deps.Audit, '_id_', { _id: 1 }]]) {
      remaining(ctx)
      const index = (await model.collection.indexes()).find(i => i.name === name)
      need(index && (name === '_id_' || index.unique === true) && !index.sparse && !index.partialFilterExpression && !index.collation
        && same(Object.entries(index.key), Object.entries(keys)), 'COMPLETION_INDEX_UNAVAILABLE')
      remaining(ctx)
    }
  }
  const context = async (args, owned = null) => {
    if (owned) need(owned.receipt.mode === mode && owned.genuineProviderEligible === (mode === G1_MODES.GENUINE), 'COMPLETION_MODE_MISMATCH')
    const request = clone({ actorUserId: args.actorUserId, scopes: args.scopes, grantExecutionId: owned ? owned.receipt.grant?.executionId : args.grantExecutionId })
    const ctx = { deadline: Date.now() + 90000, actorUserId: request.actorUserId, owned }
    need(typeof request.actorUserId === 'string' && /^[a-f0-9]{24}$/.test(request.actorUserId) && typeof request.grantExecutionId === 'string', 'COMPLETION_ACTOR_REFERENCE')
    const state = await readAuthority(request); remaining(ctx)
    need(state?.mode === mode && state.submissionState === 'KNOWN_RESPONSE' && state.records?.GRANT && state.records.RESERVATION && state.records.START_OR_REVOKE
      && state.receipts?.RESPONSE, 'COMPLETED_RESPONSE_NOT_READY')
    const grant = state.records.GRANT.body
    need(approved === g1RequestProfile(grant.request), 'COMPLETION_PROFILE_MISMATCH')
    need(grant.actorUserId === request.actorUserId && grant.executionId === request.grantExecutionId, 'COMPLETION_ACTOR_CHANGED')
    Object.assign(ctx, { mode, subject: clone(grant.subject), scope: clone(grant.scope), binding: clone(grant.request), root: grant.onceRoot,
      runtime: clone(grant.runtime), planId: grant.planId, qaCase: grant.qaCase,
      refs: Object.fromEntries([['grant', 'GRANT'], ['reservation', 'RESERVATION'], ['start', 'START_OR_REVOKE']].map(([k, phase]) => [k,
        { executionId: state.records[phase].body.executionId, bodyFingerprint: state.records[phase].bodyFingerprint }])),
      responseIdentity: clone(state.receipts.RESPONSE.payload) })
    ctx.profile = completedReviewProfile(ctx.subject, mode, ctx.binding)
    if (['master-linked-docx-review-subject.v3', 'master-linked-docx-review-subject.v4', 'master-linked-docx-review-subject.v5'].includes(ctx.subject.contractVersion)) need(sourceProof === 'STORED_SOURCE_RECORDS', 'CORRECTED_COMPLETION_SOURCE')
    if (owned) need(owned.receipt.mode === mode && owned.genuineProviderEligible === (mode === G1_MODES.GENUINE)
      && Object.entries(ctx.binding).every(([k, v]) => owned.receipt[k] === v) && ['grant', 'reservation', 'start'].every(k => same(owned.receipt[k], ctx.refs[k]))
      && owned.receipt.responseId === ctx.responseIdentity.responseId && owned.receipt.postRequestId === ctx.responseIdentity.postRequestId, 'OWNED_G1_BINDING_CHANGED')
    await indexes(ctx); ctx.response = await verifyG1(ctx); ctx.sources = await verifySources(ctx)
    return ctx
  }
  const find = (ctx, session) => read(ctx, deps.Execution, { ...ctx.scope, idempotencyKey: completedReviewKey(ctx.root) }, session)
  const inputFor = ctx => {
    const family = completedReviewFamily(ctx.root)
    return { version: ctx.profile.version, mode, sourceProof, scope: ctx.scope, actorUserId: ctx.actorUserId,
    onceRoot: ctx.root, qaCase: ctx.qaCase, plan: ctx.sources.plan, runtime: ctx.runtime, subject: ctx.subject, binding: ctx.binding,
      ...ctx.refs, response: ctx.response, sourceRecords: ctx.sources.sourceRecords, result: family.result, audits: family.audits,
      receipt: ctx.owned.receipt, startedAt: ctx.owned.startedAt, completedAt: ctx.owned.completedAt }
  }
  const verifyBundle = async (ctx, result, session) => {
    const b = assertCompletedReviewResult(result), input = b.input
    need(input.mode === mode && input.sourceProof === sourceProof && input.actorUserId === ctx.actorUserId && input.onceRoot === ctx.root
      && same(input.subject, ctx.subject) && same(input.binding, ctx.binding) && same(input.runtime, ctx.runtime)
      && same(input.plan, ctx.sources.plan) && same(input.sourceRecords, ctx.sources.sourceRecords) && same(input.response, ctx.response)
      && ['grant', 'reservation', 'start'].every(k => same(input[k], ctx.refs[k])), 'BUNDLE_SUBJECT_CONFLICT')
    if (ctx.owned) {
      need(same(input.receipt, ctx.owned.receipt) && input.startedAt === ctx.owned.startedAt && input.completedAt === ctx.owned.completedAt, 'BUNDLE_RECEIPT_CONFLICT')
    }
    need(same(await verifyG1(ctx, session), input.response), 'BUNDLE_RESPONSE_CONFLICT'); await verifySources(ctx, session)
    const artifact = await read(ctx, deps.Artifact, { ...ctx.scope, runtimeArtifactId: input.result.runtimeArtifactId }, session), ab = assertCompletedReviewArtifact(artifact)
    const stage = await read(ctx, deps.Stage, { ...ctx.scope, stageExecutionId: input.result.stageExecutionId }, session); assertCompletedReviewStage(stage)
    need(same(ab.input, input) && same(stage.renditionInputSnapshot, input) && same(b.stage, completedStageReference(stage))
      && same(ab.stage, b.stage) && artifact.lineageSummary.masterLinkedCompletedReview.bodyFingerprint === b.artifact.bodyFingerprint
      && same(artifact.generatedOutput, stage.outputSnapshot) && stage.outputSnapshot.overallStatus === b.reviewStatus
      && (!ctx.owned || same(artifact.generatedOutput, ctx.owned.output)), 'BUNDLE_JOIN_CHANGED')
    for (const [kind, row] of Object.entries({ result, artifact, stage })) assertCompletedReviewAudit(kind, row,
      await read(ctx, deps.Audit, { _id: input.audits[kind].id }, session), input, verifySignature)
    remaining(ctx)
    return { state: 'COMPLETED_REVIEW_STORED', mode, sourceProof, executionId: result.executionId, runtimeArtifactId: artifact.runtimeArtifactId,
      stageExecutionId: stage.stageExecutionId, resultFingerprint: result.executionEvidence.masterLinkedCompletedReview.bodyFingerprint,
      reviewStatus: b.reviewStatus, findings: clone(artifact.generatedOutput), responseId: input.response.identity.responseId,
      docxChecksum: input.subject.binding.docxChecksum, completionConfirmed: true, completionPersisted: true,
      genuineReviewUsed: mode === G1_MODES.GENUINE, readiness: 'HELD_NO_FINALISATION_AUTHORITY', ...held }
  }
  const makeBundle = ctx => {
    const family = completedReviewFamily(ctx.root), input = inputFor(ctx); assertCompletedReviewInput(input)
    const stage = { _id: new mongoose.Types.ObjectId(family.rowIds.stage), ...buildCompletedReviewStage(input, ctx.owned.output) }
    const artifactBody = { version: ctx.profile.artifactVersion, input, stage: completedStageReference(stage), outputFingerprint: stage.outputFingerprint }
    const artifact = { _id: new mongoose.Types.ObjectId(family.rowIds.artifact), ...ctx.scope, runtimeArtifactId: input.result.runtimeArtifactId,
      executionId: input.result.executionId, runtimeInstanceKey: input.runtime.runtimeInstanceKey, frameworkKey: input.runtime.frameworkKey,
      outputTypeKey: COMPLETED_REVIEW_OUTPUT, requestedOutputTypeKey: 'master-linked-docx-review-result', artifactType: COMPLETED_ARTIFACT_TYPE,
      status: 'GENERATED', contractVersion: ctx.profile.artifactVersion, generatedOutput: ctx.owned.output,
      lineageSummary: { masterLinkedCompletedReview: { body: artifactBody, bodyFingerprint: membershipHash(artifactBody), audit: input.audits.artifact } },
      safeJson: {}, markdown: '', certification: {}, warnings: [], limitations: [], generatedBy: ctx.actorUserId, generatedAt: input.completedAt }
    const resultBody = { version: ctx.profile.version, input, reviewStatus: ctx.owned.output.overallStatus, stage: completedStageReference(stage),
      artifact: { runtimeArtifactId: artifact.runtimeArtifactId, bodyFingerprint: membershipHash(artifactBody) }, ...held }
    const result = { _id: new mongoose.Types.ObjectId(family.rowIds.result), ...ctx.scope, ...ctx.runtime, executionId: input.result.executionId,
      workspaceType: 'PLATFORM', outputTypeKey: COMPLETED_REVIEW_OUTPUT, requestedOutputTypeKey: 'master-linked-docx-review-result',
      executionIntent: 'Record exact completed master-linked review findings without approval.', idempotencyKey: completedReviewKey(ctx.root), requestFingerprint: ctx.binding.requestIdentity,
      status: COMPLETED_REVIEW_STATUS, contractVersion: ctx.profile.version, providerMode: mode === G1_MODES.QA ? 'DETERMINISTIC_TEST' : 'LIVE_TEST',
      provider: { mode, provenance: mode === G1_MODES.QA ? 'NETWORK_QA' : 'GEN', state: 'COMPLETED', receipt: input.receipt },
      reasoningContext: { ...held }, executionEvidence: { masterLinkedCompletedReview: { body: resultBody, bodyFingerprint: membershipHash(resultBody) } },
      artifactIds: [artifact.runtimeArtifactId], auditLogIds: ['result', 'artifact', 'stage'].map(k => input.audits[k].id),
      knowledgeManifest: {}, knowledgeBinding: {}, certifiedTruth: {}, runtimeStateWrites: {}, warnings: [], limitations: [],
      requestedBy: ctx.actorUserId, requestedAt: input.startedAt, completedAt: input.completedAt, failureReason: null }
    assertCompletedReviewResult(result); assertCompletedReviewArtifact(artifact); assertCompletedReviewStage(stage)
    return { input, result, artifact, stage }
  }
  const readStored = async args => {
    const ctx = await context(args), result = await find(ctx)
    if (!result) { remaining(ctx); return { state: 'COMPLETED_REVIEW_NOT_RECORDED', completionConfirmed: false, ...held } }
    return verifyBundle(ctx, result)
  }
  // This fixed historical witness grants no new review or approval authority.
  // It validates immutable leaves directly; ordinary reads keep their current
  // authority/source orchestration and never enter this separately named path.
  const readNarrowHistoricalFailureWitness = async (...values) => {
    need(approved === true && mode === G1_MODES.GENUINE && values.length >= 1 && values.length <= 2
      && completedExact(values[0], ['actorUserId', 'scopes']), 'NARROW_WITNESS_REQUEST')
    const args = values[0], fixed = NARROW_EXPRESSION_FIXED
    const scope = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, fixed[key]]))
    need(args.actorUserId === fixed.actorUserId && args.scopes
      && String(args.scopes.customer?._id) === fixed.customerId && String(args.scopes.tenant?._id) === fixed.tenantId
      && String(args.scopes.tenant?.customerId) === fixed.customerId, 'NARROW_WITNESS_SCOPE')
    need(sourceProof === 'STORED_SOURCE_RECORDS' && deps.Execution.db.name === MASTER_REVIEW_DATABASE
      && [deps.Master, deps.Candidate, deps.Preview, deps.Plan].every(model => model.db === deps.Execution.db), 'NARROW_WITNESS_DATABASE_OWNER')
    const masterArgs = { actorUserId: args.actorUserId, scopes: args.scopes, runtimeInstanceId: fixed.runtimeInstanceId,
      masterId: fixed.masterId, version: 1 }
    const marked = values.length === 2
    let master, assertObservation
    if (marked) {
      const { assertPrivateDocxMasterObservation } = await import('./outcomeDocxCandidatePersistenceService.js')
      assertObservation = () => assertPrivateDocxMasterObservation(values[1], masterArgs)
      master = assertObservation()
    } else {
      // The default master owner keeps its own source/overall budgets. Only
      // the immutable leaf work below belongs to the 90-second findings budget.
      const { readMeaningSourceMasterForRendition } = await import('./outcomeMeaningSourceMasterService.js')
      master = await readMeaningSourceMasterForRendition(masterArgs)
    }
    const { getRuntimeInstance, assertRuntimePermission } = await import('./runtimeInstanceService.js')
    const checkRuntime = async () => {
      const runtime = await getRuntimeInstance({ runtimeInstanceId: fixed.runtimeInstanceId, scopes: args.scopes })
      need(String(runtime?._id) === fixed.runtimeInstanceId && String(runtime.customerId) === fixed.customerId
        && String(runtime.tenantId) === fixed.tenantId, 'NARROW_WITNESS_RUNTIME_CHANGED')
      await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
        customerId: runtime.customerId, tenantId: runtime.tenantId,
        permission: String(runtime.runtimeType).toUpperCase() === 'DEAL_ANALYSIS' ? 'DEAL_UPDATE' : 'VMF_UPDATE' })
    }
    await checkRuntime()
    const ctx = { deadline: Date.now() + 90000, actorUserId: args.actorUserId, scope, owned: null }
    await indexes(ctx)
    const result = await read(ctx, deps.Execution, { ...scope, executionId: fixed.failedReviewExecutionId })
    need(result, 'NARROW_WITNESS_RESULT_MISSING')
    need(result.executionId === fixed.failedReviewExecutionId
      && result.executionEvidence?.masterLinkedCompletedReview?.bodyFingerprint === fixed.failedReviewResultFingerprint,
    'NARROW_WITNESS_RESULT_CHANGED')
    const body = assertCompletedReviewResult(result), input = body.input, binding = input.subject.binding
    need(body.version === APPROVED_COMPLETED_REVIEW_VERSION && body.reviewStatus === 'FAIL'
      && input.mode === G1_MODES.GENUINE && input.sourceProof === 'STORED_SOURCE_RECORDS' && input.qaCase === ''
      && input.actorUserId === fixed.actorUserId && same(input.scope, scope) && isG1ApprovedRequest(input.binding)
      && binding.candidateId === fixed.predecessorCandidateId && binding.candidateBodyFingerprint === fixed.predecessorBodyFingerprint
      && binding.masterReference.masterId === fixed.masterId && binding.sourceFingerprint === fixed.sourceFingerprint,
    'NARROW_WITNESS_FIXED_FAILURE')
    Object.assign(ctx, { mode, subject: clone(input.subject), binding: clone(input.binding), root: input.onceRoot,
      runtime: clone(input.runtime), planId: input.plan.planId, qaCase: input.qaCase,
      refs: Object.fromEntries(['grant', 'reservation', 'start'].map(key => [key, clone(input[key])])),
      responseIdentity: clone(input.response.identity), profile: completedReviewProfile(input.subject, mode, input.binding) })
    need(same(master.masterReference, binding.masterReference)
      && master.sourceEnvelope?.sourceFingerprint === fixed.sourceFingerprint
      && membershipHash(master.sourceEnvelope.source) === fixed.sourceFingerprint, 'NARROW_WITNESS_CURRENT_MASTER_CHANGED')
    ctx.response = await verifyG1(ctx)
    const source = await verifySources(ctx, null, true)
    ctx.sources = source.observed
    const completed = await verifyBundle(ctx, result)
    need(completed.reviewStatus === 'FAIL' && completed.resultFingerprint === fixed.failedReviewResultFingerprint,
      'NARROW_WITNESS_FIXED_FAILURE')
    const candidate = source.records.candidate
    need(same(master.sourceEnvelope.source.selectedPacks, candidate.body.input.selectedPacks), 'NARROW_WITNESS_PACKS_CHANGED')
    remaining(ctx)
    await checkRuntime()
    if (marked) need(assertObservation() === master, 'NARROW_WITNESS_CURRENT_MASTER_CHANGED')
    return { state: 'HISTORICAL_GENUINE_FAIL_WITNESS', master: clone(master), sourceEnvelope: clone(master.sourceEnvelope),
      predecessor: { candidateId: candidate.candidateId, bodyFingerprint: candidate.bodyFingerprint,
        inputFingerprint: candidate.body.inputFingerprint, artifact: clone(candidate.body.artifact), masterBinding: clone(candidate.body.masterBinding) },
      predecessorInput: clone(candidate.body.input), executionId: completed.executionId, resultFingerprint: completed.resultFingerprint,
      reviewStatus: 'FAIL', sourceProof: 'STORED_SOURCE_RECORDS', dispatchAvailable: false, customerApproved: false, officialUse: false, ...held }
  }
  const duplicateMatches = (error, bundle, ctx) => {
    if (error?.code !== 11000) return false
    const indexName = typeof error.message === 'string' ? error.message.match(/\bindex:\s+([^\s]+)\s+dup key:/)?.[1] : undefined
    const candidates = [
      ['executionId_1', { executionId: 1 }, { executionId: bundle.result.executionId }],
      ['runtimeInstanceId_1_idempotencyKey_1', { runtimeInstanceId: 1, idempotencyKey: 1 }, { runtimeInstanceId: ctx.scope.runtimeInstanceId, idempotencyKey: bundle.result.idempotencyKey }],
      ['runtimeArtifactId_1', { runtimeArtifactId: 1 }, { runtimeArtifactId: bundle.artifact.runtimeArtifactId }],
      ['uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }, { stageExecutionId: bundle.stage.stageExecutionId }],
      ['uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 },
        { runtimeInstanceId: ctx.scope.runtimeInstanceId, planId: ctx.planId, stageKey: bundle.stage.stageKey, attemptNumber: 1 }],
      ...[...Object.values(completedReviewFamily(ctx.root).rowIds), ...Object.values(bundle.input.audits).map(r => r.id)].map(id => ['_id_', { _id: 1 }, { _id: id }]),
    ]
    return candidates.some(([name, pattern, values]) => indexName === name && same(Object.entries(error.keyPattern || {}), Object.entries(pattern))
      && Object.keys(error.keyValue || {}).length === Object.keys(values).length && Object.entries(values).every(([k, v]) => {
        const actual = error.keyValue[k]
        return typeof v === 'number' ? actual === v : (typeof actual === 'string' || actual instanceof mongoose.Types.ObjectId) && String(actual) === v
      }))
  }
  return Object.freeze({ ...(approved === true && mode === G1_MODES.GENUINE ? { readNarrowHistoricalFailureWitness } : {}), assertIndexes: async (...args) => {
    need(args.length === 0, 'COMPLETION_INDEX_OVERRIDES_FORBIDDEN')
    const ctx = { deadline: Date.now() + 90000 }; let timer
    try {
      await Promise.race([indexes(ctx), new Promise((_, reject) => {
        timer = setTimeout(() => reject(completedReviewFailure('COMPLETION_INDEX_TIMEOUT', 503)), remaining(ctx))
      })])
      remaining(ctx)
      return { storageIndexesVerified: true, ...held }
    } finally { clearTimeout(timer) }
  }, read: readStored, reconcile: readStored, persist: async args => {
    const owned = snapshotOwnedMasterLinkedReviewResult(args.providerResult), ctx = await context(args, owned)
    const existing = await find(ctx)
    if (existing) return { ...await verifyBundle(ctx, existing), idempotent: true }
    const bundle = makeBundle(ctx), session = await deps.Execution.db.startSession()
    let winner, replay = false, attempts = 0, attemptLimitError, reconcileAfterClose = false
    try {
      await session.withTransaction(async () => {
        if (++attempts > 2) {
          attemptLimitError = completedReviewFailure('COMPLETION_TRANSACTION_ATTEMPTS')
          throw attemptLimitError
        }
        remaining(ctx)
        const saved = await find(ctx, session)
        if (saved) { await verifyBundle(ctx, saved, session); winner = saved; replay = true; return }
        await verifyG1(ctx, session); await verifySources(ctx, session)
        for (const kind of ['result', 'artifact', 'stage']) {
          const row = bundle[kind], ref = bundle.input.audits[kind]
          const audit = raw(await deps.auditService.log({ _id: new mongoose.Types.ObjectId(ref.id), actorUserId: ctx.actorUserId,
            action: COMPLETED_REVIEW_ACTIONS[kind], resourceType: { result: 'GovernedReasoningExecution', artifact: 'GovernedRuntimeArtifact', stage: 'OutcomeQualityStageExecution' }[kind],
            resourceId: row._id, scope: ctx.scope, diff: completedAuditDiff(kind, row, bundle.input) }, { session, throwOnError: true }))
          assertCompletedReviewAudit(kind, row, audit, bundle.input, verifySignature); remaining(ctx)
        }
        await deps.Execution.create([bundle.result], { session }); await deps.Artifact.create([bundle.artifact], { session }); await deps.Stage.create([bundle.stage], { session })
        winner = await find(ctx, session); await verifyBundle(ctx, winner, session); remaining(ctx)
      }, { timeoutMS: Math.min(50000, remaining(ctx)) })
    } catch (error) {
      if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) throw completedReviewFailure('COMPLETION_UNCONFIRMED', 503)
      if (attemptLimitError && error === attemptLimitError) reconcileAfterClose = true
      else if (duplicateMatches(error, bundle, ctx)) {
        const saved = await find(ctx)
        need(saved, 'COMPLETION_SLOT_CONFLICT'); await verifyBundle(ctx, saved); winner = saved; replay = true
      } else throw error
    } finally { await session.endSession() }
    if (reconcileAfterClose) {
      try {
        const saved = await find(ctx)
        if (!saved) throw attemptLimitError
        return { ...await verifyBundle(ctx, saved), idempotent: true }
      } catch (error) {
        if (error === attemptLimitError || error?.code === 'MASTER_LINKED_COMPLETED_REVIEW_HELD') throw error
        throw completedReviewFailure('COMPLETION_UNCONFIRMED', 503)
      }
    }
    try {
      const durable = await find(ctx)
      need(durable?.executionId === winner?.executionId, 'COMPLETION_DURABLE_READ_CHANGED')
      return { ...await verifyBundle(ctx, durable), idempotent: replay }
    } catch { throw completedReviewFailure('COMPLETION_UNCONFIRMED', 503) }
  } })
}
export const createGenuineMasterLinkedCompletedReviewStore = (...args) => { need(args.length === 0, 'GENUINE_STORE_OVERRIDES_FORBIDDEN'); return createStore(G1_MODES.GENUINE, {}) }
export const createApprovedGenuineMasterLinkedCompletedReviewStore = (...args) => { need(args.length === 0, 'GENUINE_STORE_OVERRIDES_FORBIDDEN'); return createStore(G1_MODES.GENUINE, {}, true) }
export const createApprovedNetworkQaMasterLinkedCompletedReviewStore = (...args) => { need(args.length === 0, 'APPROVED_QA_STORE_OVERRIDES_FORBIDDEN'); return createStore(G1_MODES.QA, {}, true) }
export const createNarrowGenuineMasterLinkedCompletedReviewStore = (...args) => { need(args.length === 0, 'GENUINE_STORE_OVERRIDES_FORBIDDEN'); return createStore(G1_MODES.GENUINE, {}, 'NARROW') }
export const createNetworkQaMasterLinkedCompletedReviewStore = (dependencies = {}) => createStore(G1_MODES.QA, { ...dependencies })
