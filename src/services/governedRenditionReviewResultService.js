import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Audit from '../models/AuditLog.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { buildCanonicalJson } from './governanceAudit/checksumService.js'
import { prepareDocxVisualReviewTransport } from './outcomeDocxVisualReviewContextService.js'
import { buildOpenAiDocxRenditionReviewRequest, snapshotOwnedDocxReviewResult } from './openAiDocxRenditionReviewProviderAdapter.js'
import { readGovernedRenditionReviewClaim, assertRenditionClaimIndex } from './governedRenditionReviewClaimService.js'
import { readGovernedRenditionReviewDispatch } from './governedRenditionReviewDispatchService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { assertRenditionClaimRecord, assertRenditionClaimAudit, RENDITION_RESULT_VERSION, RENDITION_RESULT_STATUS,
  RENDITION_REVIEW_OUTPUT, RENDITION_TRANSPORT } from './outcomeRenditionReviewClaimContract.js'
import { assertRenditionDispatchRecord, assertRenditionDispatchAudit, renditionReceiptId, RENDITION_RESPONSE_ACTION } from './outcomeRenditionReviewDispatchContract.js'
import { buildRenditionQualityStage, assertRenditionQualityStage, serializeRenditionQualityStage } from './outcomeRenditionQualityStageContract.js'
import { RENDITION_REVIEW_ARTIFACT_VERSION, RENDITION_RESULT_ACTION, RENDITION_ARTIFACT_ACTION, RENDITION_STAGE_ACTION,
  renditionResultKey, renditionResultError, assertRenditionResultRecord, assertRenditionReviewArtifact, renditionStageReference,
  renditionResultAuditDiff, renditionArtifactAuditDiff, renditionQualityStageAuditDiff, assertSignedRenditionResultAudit } from './outcomeRenditionReviewResultContract.js'

const raw = value => value?.toObject ? value.toObject({ depopulate: true }) : value
const same = (a, b) => buildCanonicalJson(a) === buildCanonicalJson(b)
const fail = (reason, status) => { throw renditionResultError(reason, status) }
const read = (model, filter, session) => {
  let query = model.findOne(filter)
  if (session) query = query.session(session)
  return query.lean()
}
const context = async args => {
  const deps = args.deps || {}, transport = await (deps.prepareTransport || prepareDocxVisualReviewTransport)(args)
  const binding = buildOpenAiDocxRenditionReviewRequest(transport).binding
  const claim = await (deps.readClaim || readGovernedRenditionReviewClaim)(args)
  const dispatch = await (deps.readDispatch || readGovernedRenditionReviewDispatch)({ ...args, binding })
  const subject = transport.subject
  if (!claim?.claim || !dispatch?.reservation || !dispatch.receipts?.RESPONSE
    || String(args.actorUserId) !== subject.actorUserId || args.runtimeInstanceId !== subject.scope.runtimeInstanceId
    || args.candidateId !== subject.candidate.candidateId || !same(claim.claim.subject, subject)
    || dispatch.reservation.claimExecutionId !== claim.claim.executionId || dispatch.reservation.claimFingerprint !== claim.claimFingerprint
    || ['subjectFingerprint', 'requestIdentity', 'contextFingerprint'].some(field => dispatch.reservation[field] !== binding[field])) fail('SIGNED_DISPATCH_NOT_READY')
  const plan = await (deps.loadPlan || (filter => Plan.findOne(filter).lean()))({ ...subject.scope,
    _id: subject.source.plan.recordId, planId: subject.source.plan.planId, requestId: subject.source.plan.requestId })
  await (deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  const ctx = { deps, transport, subject, binding, claim, dispatch, plan,
    Execution: deps.Execution || Execution, Artifact: deps.Artifact || Artifact, Stage: deps.Stage || Stage, Audit: deps.Audit || Audit }
  if ([ctx.Artifact, ctx.Stage, ctx.Audit].some(model => model.db !== ctx.Execution.db)) fail('RESULT_DATABASE_OWNER_CHANGED')
  await assertRenditionClaimIndex(ctx.Execution)
  for (const [model, name, keys] of [[ctx.Artifact, 'runtimeArtifactId_1', { runtimeArtifactId: 1 }],
    [ctx.Stage, 'uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }],
    [ctx.Stage, 'uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 }]]) {
    const index = (await model.collection.indexes()).find(item => item.name === name)
    if (!index?.unique || index.sparse || index.partialFilterExpression || index.collation
      || !same(Object.entries(index.key), Object.entries(keys))) fail('RESULT_INDEX_NOT_READY', 503)
  }
  return ctx
}
const findResult = (ctx, session) => read(ctx.Execution, { ...ctx.subject.scope,
  idempotencyKey: renditionResultKey(ctx.subject.source.plan.planId) }, session)
const verifyAdmission = async (ctx, session) => {
  const claim = await read(ctx.Execution, { ...ctx.subject.scope, executionId: ctx.claim.claim.executionId }, session)
  const claimBody = assertRenditionClaimRecord(claim)
  const claimAudit = await read(ctx.Audit, { _id: claim.executionEvidence.renditionReview.auditId }, session)
  assertRenditionClaimAudit(claim, claimAudit, row => ctx.Audit.hydrate(row).verifySignature())
  if (!same(claimBody, ctx.claim.claim) || claim.executionEvidence.renditionReview.claimFingerprint !== ctx.claim.claimFingerprint) fail('RESULT_CLAIM_CHANGED')
  const reservation = await read(ctx.Execution, { ...ctx.subject.scope, executionId: ctx.dispatch.reservation.executionId }, session)
  const reservationBody = assertRenditionDispatchRecord(reservation)
  const reservationAudit = await read(ctx.Audit, { _id: reservation.executionEvidence.renditionReview.auditId }, session)
  assertRenditionDispatchAudit(reservation, reservationAudit, row => ctx.Audit.hydrate(row).verifySignature())
  if (!same(reservationBody, ctx.dispatch.reservation)
    || reservation.executionEvidence.renditionReview.reservationFingerprint !== ctx.dispatch.reservationFingerprint) fail('RESULT_RESERVATION_CHANGED')
  const response = await read(ctx.Audit, { _id: renditionReceiptId('RESPONSE', reservation.executionId) }, session)
  const expected = ctx.dispatch.receipts.RESPONSE
  if (!response || response.action !== RENDITION_RESPONSE_ACTION || response.resourceType !== 'GovernedReasoningExecution'
    || String(response.resourceId) !== String(reservation._id) || String(response.actorUserId) !== ctx.subject.actorUserId
    || Object.keys(ctx.subject.scope).some(field => String(response.scope?.[field]) !== ctx.subject.scope[field])
    || !same(response.diff, expected) || ctx.Audit.hydrate(response).verifySignature() !== true) fail('RESULT_RESPONSE_RECEIPT_CHANGED')
}
const verifyBundle = async (record, ctx, session) => {
  const body = assertRenditionResultRecord(record), input = body.input
  if (!same(input.subject, ctx.subject) || !same(input.binding, ctx.binding)
    || input.claim.executionId !== ctx.claim.claim.executionId || input.claim.fingerprint !== ctx.claim.claimFingerprint
    || input.reservation.executionId !== ctx.dispatch.reservation.executionId || input.reservation.fingerprint !== ctx.dispatch.reservationFingerprint
    || input.receipt.responseId !== ctx.dispatch.receipts.RESPONSE.responseId
    || input.receipt.postRequestId !== ctx.dispatch.receipts.RESPONSE.postRequestId) fail('RESULT_SUBJECT_CONFLICT')
  await verifyAdmission(ctx, session)
  const artifact = await read(ctx.Artifact, { ...ctx.subject.scope, runtimeArtifactId: body.artifact.runtimeArtifactId }, session)
  const artifactBody = assertRenditionReviewArtifact(artifact)
  const stage = await read(ctx.Stage, { ...ctx.subject.scope, stageExecutionId: body.stage.stageExecutionId }, session)
  assertRenditionQualityStage(stage)
  const refs = record.executionEvidence.renditionReview.audits
  if (!same(stage.renditionInputSnapshot, input) || !same(artifactBody.input, input)
    || !same(renditionStageReference(stage), body.stage) || !same(artifactBody.stage, body.stage)
    || artifact.lineageSummary.renditionReview.artifactFingerprint !== body.artifact.artifactFingerprint
    || !same(artifact.lineageSummary.renditionReview.audit, refs.artifact)
    || !same(artifact.generatedOutput, stage.outputSnapshot) || stage.outputSnapshot.overallStatus !== body.reviewStatus
    || new Date(stage.startedAt).toISOString() !== body.startedAt || new Date(stage.completedAt).toISOString() !== body.completedAt
    || artifactBody.startedAt !== body.startedAt || artifactBody.completedAt !== body.completedAt) fail('RESULT_JOIN_CHANGED')
  for (const [kind, action, resourceType, resource, diff] of [
    ['result', RENDITION_RESULT_ACTION, 'GovernedReasoningExecution', record, renditionResultAuditDiff(record)],
    ['artifact', RENDITION_ARTIFACT_ACTION, 'GovernedRuntimeArtifact', artifact, renditionArtifactAuditDiff(artifact)],
    ['stage', RENDITION_STAGE_ACTION, 'OutcomeQualityStageExecution', stage, renditionQualityStageAuditDiff(stage)]]) {
    const audit = await read(ctx.Audit, { _id: refs[kind].id }, session)
    assertSignedRenditionResultAudit({ audit, reference: refs[kind], action, resourceType, resourceId: resource._id,
      input, diff, verifySignature: row => ctx.Audit.hydrate(row).verifySignature() })
  }
  return { state: 'REVIEW_COMPLETED', executionId: record.executionId, runtimeArtifactId: artifact.runtimeArtifactId,
    resultFingerprint: record.executionEvidence.renditionReview.resultFingerprint, reviewStatus: body.reviewStatus,
    stage: serializeRenditionQualityStage(stage), completionConfirmed: true, approvalAvailable: false, deliveryAvailable: false }
}

export const readGovernedRenditionReviewResult = async args => {
  const ctx = await context(args), record = await findResult(ctx)
  return record ? verifyBundle(record, ctx) : { state: 'RESULT_NOT_RECORDED', completionConfirmed: false, approvalAvailable: false }
}
export const persistGovernedRenditionReviewResult = async args => {
  const owned = snapshotOwnedDocxReviewResult(args.providerResult), ctx = await context(args)
  if (['requestIdentity', 'contextFingerprint', 'subjectFingerprint'].some(field => owned.receipt[field] !== ctx.binding[field])
    || owned.receipt.responseId !== ctx.dispatch.receipts.RESPONSE.responseId
    || owned.receipt.postRequestId !== ctx.dispatch.receipts.RESPONSE.postRequestId) fail('ADAPTER_RESULT_CHANGED')
  const existing = await findResult(ctx)
  if (existing) {
    const verified = await verifyBundle(existing, ctx)
    if (!same(existing.executionEvidence.renditionReview.body.input.receipt, owned.receipt)
      || verified.stage.outputFingerprint !== membershipHash(owned.output)) fail('RESULT_REPLAY_CONFLICT')
    return { ...verified, idempotent: true }
  }
  const input = { contractVersion: 'outcome-rendition-stage-input.v1', subject: ctx.subject, runtime: ctx.claim.claim.runtime,
    planVersion: ctx.plan.planVersion, claim: { executionId: ctx.claim.claim.executionId, fingerprint: ctx.claim.claimFingerprint },
    reservation: { executionId: ctx.dispatch.reservation.executionId, fingerprint: ctx.dispatch.reservationFingerprint },
    result: { executionId: `grr_rendition_result_${randomUUID()}`, runtimeArtifactId: `artifact_rendition_review_${randomUUID()}` },
    binding: ctx.binding, receipt: owned.receipt }
  const stage = { _id: new mongoose.Types.ObjectId(), ...buildRenditionQualityStage({ input, output: owned.output, plan: ctx.plan,
    startedAt: owned.startedAt, completedAt: owned.completedAt }) }
  const artifactBody = { contractVersion: RENDITION_REVIEW_ARTIFACT_VERSION, input, stage: renditionStageReference(stage),
    startedAt: stage.startedAt, completedAt: stage.completedAt }
  const artifact = { _id: new mongoose.Types.ObjectId(), runtimeArtifactId: input.result.runtimeArtifactId, executionId: input.result.executionId,
    ...ctx.subject.scope, runtimeInstanceKey: input.runtime.runtimeInstanceKey, frameworkKey: input.runtime.frameworkKey,
    outputTypeKey: RENDITION_REVIEW_OUTPUT, requestedOutputTypeKey: 'docx-rendition-review-result', artifactType: 'DOCX_RENDITION_REVIEW',
    status: 'GENERATED', contractVersion: RENDITION_REVIEW_ARTIFACT_VERSION, generatedOutput: owned.output,
    lineageSummary: { renditionReview: { body: artifactBody, artifactFingerprint: membershipHash(artifactBody), audit: null } },
    safeJson: {}, markdown: '', certification: {}, warnings: [], limitations: [], generatedBy: ctx.subject.actorUserId, generatedAt: stage.completedAt }
  const body = { contractVersion: RENDITION_RESULT_VERSION, executionId: input.result.executionId, input, stage: renditionStageReference(stage),
    artifact: { runtimeArtifactId: artifact.runtimeArtifactId, artifactFingerprint: artifact.lineageSummary.renditionReview.artifactFingerprint },
    startedAt: stage.startedAt, completedAt: stage.completedAt, reviewStatus: owned.output.overallStatus, approvalAvailable: false, deliveryAvailable: false }
  const result = { _id: new mongoose.Types.ObjectId(), executionId: input.result.executionId, ...ctx.subject.scope, ...input.runtime,
    outputTypeKey: RENDITION_REVIEW_OUTPUT, requestedOutputTypeKey: 'docx-rendition-review-result',
    executionIntent: 'Record one completed private DOCX visual review without approving delivery.', idempotencyKey: renditionResultKey(ctx.subject.source.plan.planId),
    requestFingerprint: ctx.binding.subjectFingerprint, status: RENDITION_RESULT_STATUS, contractVersion: RENDITION_RESULT_VERSION, providerMode: 'LIVE_TEST',
    provider: { ...RENDITION_TRANSPORT, state: 'COMPLETED', receipt: owned.receipt },
    reasoningContext: { contentVisible: false, packContentLoaded: true, dispatchAvailable: false, approvalAvailable: false },
    executionEvidence: { renditionReview: { body, resultFingerprint: membershipHash(body), audits: {} } },
    artifactIds: [artifact.runtimeArtifactId], auditLogIds: [], failureReason: null, warnings: [], limitations: [],
    requestedBy: ctx.subject.actorUserId, requestedAt: stage.startedAt, completedAt: stage.completedAt }
  const session = await ctx.Execution.db.startSession()
  let winner, replay = false
  try {
    await session.withTransaction(async () => {
      const current = await findResult(ctx, session)
      if (current) {
        await verifyBundle(current, ctx, session)
        if (!same(current.executionEvidence.renditionReview.body.input.receipt, owned.receipt)
          || current.executionEvidence.renditionReview.body.stage.outputFingerprint !== membershipHash(owned.output)) fail('RESULT_REPLAY_CONFLICT')
        winner = current; replay = true; return
      }
      await verifyAdmission(ctx, session)
      for (const [kind, action, resourceType, resource, diff] of [
        ['result', RENDITION_RESULT_ACTION, 'GovernedReasoningExecution', result, renditionResultAuditDiff(result)],
        ['artifact', RENDITION_ARTIFACT_ACTION, 'GovernedRuntimeArtifact', artifact, renditionArtifactAuditDiff(artifact)],
        ['stage', RENDITION_STAGE_ACTION, 'OutcomeQualityStageExecution', stage, renditionQualityStageAuditDiff(stage)]]) {
        const audit = raw(await (ctx.deps.auditService || auditService).log({ actorUserId: args.actorUserId, action, resourceType,
          resourceId: resource._id, scope: ctx.subject.scope, requestId: args.auditRequest?.requestId, diff }, { session, throwOnError: true }))
        const reference = { id: String(audit?._id), signatureVersion: audit?.signatureVersion }
        assertSignedRenditionResultAudit({ audit, reference, action, resourceType, resourceId: resource._id,
          input, diff, verifySignature: row => ctx.Audit.hydrate(row).verifySignature() })
        result.executionEvidence.renditionReview.audits[kind] = reference
      }
      artifact.lineageSummary.renditionReview.audit = result.executionEvidence.renditionReview.audits.artifact
      result.auditLogIds = ['result', 'artifact', 'stage'].map(kind => result.executionEvidence.renditionReview.audits[kind].id)
      assertRenditionResultRecord(result); assertRenditionReviewArtifact(artifact)
      await ctx.Execution.create([result], { session }); await ctx.Artifact.create([artifact], { session }); await ctx.Stage.create([stage], { session })
      winner = await findResult(ctx, session); await verifyBundle(winner, ctx, session)
    })
  } catch (error) {
    if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) fail('COMPLETION_UNCONFIRMED', 503)
    if (error?.code !== 11000 || !error.message?.includes('runtimeInstanceId_1_idempotencyKey_1')
      || !same(Object.entries(error.keyPattern || {}), [['runtimeInstanceId', 1], ['idempotencyKey', 1]])) throw error
    winner = await findResult(ctx)
    if (!winner) throw error
    await verifyBundle(winner, ctx)
    if (!same(winner.executionEvidence.renditionReview.body.input.receipt, owned.receipt)
      || winner.executionEvidence.renditionReview.body.stage.outputFingerprint !== membershipHash(owned.output)) fail('RESULT_REPLAY_CONFLICT')
    replay = true
  } finally { await session.endSession() }
  try {
    const durable = await findResult(ctx)
    if (durable?.executionId !== winner?.executionId) fail('RESULT_DURABLE_READ_CHANGED')
    return { ...await verifyBundle(durable, ctx), idempotent: replay }
  } catch { fail('COMPLETION_UNCONFIRMED', 503) }
}
