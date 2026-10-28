import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { assertNormalOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { OutcomeKnowledgeCompositionPlan, OutcomeSession, OutcomeMessage, OutcomeDraft, OutcomeDraftIteration,
  OutcomeQualityStageExecution, OutcomeSuccessorOperation } from '../models/index.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { getOutcomeSuccessorPreflight, OUTCOME_SUCCESSOR_CONTROL_PROJECTION } from './outcomeSuccessorService.js'
import { createOutcomeKnowledgeCompositionPlan } from './outcomeKnowledgeCompositionPlanService.js'
import { validateOutcomeGovernedQualityChain } from './outcomeGovernedQualityChainValidationService.js'
import { getRuntimeOutcomePlanningEvidence } from './runtimeStateRepository.js'
import { OUTCOME_PLANNING_EVIDENCE_VERSIONS } from './outcomeFrameworkHandoffService.js'
import { createRuntimeOutcomeSession, generateRuntimeOutcomeResponse,
  assertGovernedDraftMatchesShapedOutput } from './outcomeStudioService.js'
import { hashOutcomeSuccessorValue, outcomeSuccessorError } from './outcomeSuccessorContract.js'
import { projectOutcomeSuccessorLineage, writeOutcomeSuccessorCompletionAudit } from './outcomeSuccessorOperationService.js'

const id = (value) => String(value ?? '').trim()
const scopedQuery = (operation) => ({ customerId: operation.customerId, tenantId: operation.tenantId,
  runtimeInstanceId: operation.targetRuntimeInstanceId })
const findOne = (model, filter, session = null) => model.findOne(filter).session(session).maxTimeMS(2000).lean()
const authorizeOperation = async ({ operation, actorUserId, scopes, deps }) => {
  if (!mongoose.isValidObjectId(actorUserId)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_UNAUTHORIZED', 401)
  for (const runtimeInstanceId of [operation.sourceRuntimeInstanceId, operation.targetRuntimeInstanceId]) {
    const runtime = await (deps.readRuntimeControl || getRuntimeInstance)({ runtimeInstanceId, scopes,
      projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
    if (!runtime || id(runtime.customerId) !== id(operation.customerId) || id(runtime.tenantId) !== id(operation.tenantId)) {
      throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_MISMATCH', 403)
    }
    await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId, scopes,
      customerId: runtime.customerId, tenantId: runtime.tenantId,
      permission: runtime.runtimeType === 'DEAL_ANALYSIS' ? 'DEAL_UPDATE' : 'VMF_UPDATE', maxTimeMS: 2000 })
    assertNormalOutcomeRuntime(runtime)
  }
}

export const verifyOutcomeSuccessorOperationCurrentness = async ({ operation, actorUserId, scopes, session, deps = {} }) => {
  let context
  const preflight = await (deps.getPreflight || getOutcomeSuccessorPreflight)({ actorUserId,
    runtimeInstanceId: id(operation.sourceRuntimeInstanceId), outcomeAssetId: operation.sourceAssetId,
    outcomeAssetVersionId: operation.sourceAssetVersionId, targetRuntimeInstanceId: id(operation.targetRuntimeInstanceId), scopes,
    deps: { ...deps, session, successorRequestId: operation.requestId, listTargets: async () => [],
      capturePreflightContext: (value) => { context = value } } })
  if (preflight.status !== 'READY_FOR_CONFIRMATION' || preflight.metadataFingerprint !== operation.binding.metadataFingerprint
    || hashOutcomeSuccessorValue(preflight.source) !== hashOutcomeSuccessorValue(operation.binding.source)
    || hashOutcomeSuccessorValue(preflight.target) !== hashOutcomeSuccessorValue(operation.binding.target) || !context) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_STALE')
  }
  return context
}

export const readOutcomeSuccessorOwnerState = async ({ operation, session = null, deps = {} }) => {
  const scope = scopedQuery(operation)
  const plan = await findOne(deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    { ...scope, requestId: operation.requestId, ...(operation.refs?.planId ? { planId: operation.refs.planId } : {}) }, session)
  if (!plan) return { plan: null }
  const ownerSession = await findOne(deps.OutcomeSession || OutcomeSession, { ...scope,
    'contextBindings.requestPlan.requestId': operation.requestId, 'contextBindings.requestPlan.planId': plan.planId }, session)
  if (!ownerSession) return { plan, ownerSession: null }
  const message = await findOne(deps.OutcomeMessage || OutcomeMessage, { ...scope, sessionId: ownerSession.sessionId,
    role: 'USER', 'contextBindings.requestPlan.requestId': operation.requestId,
    'contextBindings.requestPlan.planId': plan.planId }, session)
  const draft = await findOne(deps.OutcomeDraft || OutcomeDraft, { ...scope, sessionId: ownerSession.sessionId,
    'lineageSummary.governedQualityChain.requestId': operation.requestId,
    'lineageSummary.governedQualityChain.planId': plan.planId }, session)
  if (!draft) return { plan, ownerSession, message, draft: null }
  const iteration = await findOne(deps.OutcomeDraftIteration || OutcomeDraftIteration,
    { ...scope, sessionId: ownerSession.sessionId, draftId: draft.draftId, draftIterationId: draft.currentIterationId }, session)
  if (!iteration) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
  const chain = iteration.lineageSummary?.governedQualityChain
  const stageIds = chain?.stages?.map((stage) => stage.stageExecutionId)
  if (!stageIds?.length) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
  const stages = await (deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution).find({ ...scope,
    requestId: operation.requestId, planId: plan.planId }).session(session).maxTimeMS(2000).lean()
  const accepted = (deps.validateQualityChain || validateOutcomeGovernedQualityChain)({ plan,
    requestBinding: { requestId: operation.requestId, draftId: draft.draftId, draftIterationId: iteration.draftIterationId },
    stages, recordedStages: chain.stages })
  assertGovernedDraftMatchesShapedOutput({ draft, iteration,
    shapedStage: accepted.find((stage) => stage.stageKey === 'OUTPUT_SHAPING') })
  const expected = projectOutcomeSuccessorLineage(operation)
  if (!message || draft.phase !== 'GOVERNED_QUALITY_CHAIN' || iteration.phase !== 'GOVERNED_QUALITY_CHAIN'
    || hashOutcomeSuccessorValue(draft.lineageSummary?.successor) !== hashOutcomeSuccessorValue(expected)
    || hashOutcomeSuccessorValue(iteration.lineageSummary?.successor) !== hashOutcomeSuccessorValue(expected)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  }
  return { plan, ownerSession, message, draft, iteration }
}
const readOwnerState = readOutcomeSuccessorOwnerState

const updateClaimed = async ({ operation, claimId, status, refs, blockerReason = '', session = null, deps }) => {
  const update = await (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).updateOne({ _id: operation._id,
    payloadFingerprint: operation.payloadFingerprint, claimId, status: { $nin: ['SUCCEEDED'] } },
  { $set: { status, refs, blockerReason } }, { session })
  if (update.matchedCount !== 1) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED')
  operation.status = status; operation.refs = refs
}

const readRecordedFailure = async ({ operation, deps }) => {
  if (!operation.refs?.planId) return null
  return (deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution).findOne({ ...scopedQuery(operation),
    requestId: operation.requestId, planId: operation.refs.planId, status: 'FAILED' })
    .sort({ stageOrder: -1, attemptNumber: -1 }).maxTimeMS(2000).lean()
}

// No lease takeover: unresolved GENERATING/RECOVERY_REQUIRED is read back, never replayed automatically.
export const executeOutcomeSuccessorOperation = async ({ actorUserId, operationId, runtimeInstanceId, scopes,
  auditRequest, deps = {} }) => {
  const model = deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation
  const operation = await findOne(model, { operationId, sourceRuntimeInstanceId: runtimeInstanceId })
  if (!operation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OPERATION_NOT_FOUND', 404)
  await authorizeOperation({ operation, actorUserId, scopes, deps })
  const readOwners = deps.readOwnerState || readOwnerState
  if (operation.status === 'SUCCEEDED') return { operation, owners: await readOwners({ operation, deps }), idempotent: true }
  if (operation.claimId) return { operation, executionPending: true, idempotent: true }
  const claimId = randomUUID()
  const db = deps.mongoose || mongoose
  const claimSession = await db.startSession()
  let context
  try {
    await claimSession.withTransaction(async () => {
      context = await verifyOutcomeSuccessorOperationCurrentness({ operation, actorUserId, scopes, session: claimSession, deps })
      const claimed = await model.updateOne({ _id: operation._id, payloadFingerprint: operation.payloadFingerprint,
        status: { $in: ['PREPARING', 'READY_TO_GENERATE'] }, claimId: '' }, { $set: { claimId } }, { session: claimSession })
      if (claimed.modifiedCount !== 1) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EXECUTION_ALREADY_CLAIMED')
    })
  } catch (error) {
    if (error.reason !== 'OUTCOME_SUCCESSOR_EXECUTION_ALREADY_CLAIMED') throw error
    return { operation: await findOne(model, { _id: operation._id }), executionPending: true, idempotent: true }
  } finally { await claimSession.endSession() }
  operation.claimId = claimId
  try {
    let owners = await readOwners({ operation, deps })
    if (!owners.plan) {
      await (deps.createPlan || createOutcomeKnowledgeCompositionPlan)({ actorUserId, scopes,
        runtimeInstanceId: id(operation.targetRuntimeInstanceId), expectedRuntimeUpdatedAt: context.targetRuntime.updatedAt,
        consumerIntent: context.sourcePlan.payload.consumerIntent, expectedPlanFingerprint: context.candidate.planFingerprint,
        requestScope: { ...scopedQuery(operation), requestId: operation.requestId }, deps: { ...deps,
          readKcpRuntimeEvidence: (args) => (deps.readKcpRuntimeEvidence || getRuntimeOutcomePlanningEvidence)({ ...args,
            planningEvidenceVersion: OUTCOME_PLANNING_EVIDENCE_VERSIONS.V2 }) } })
      owners = await readOwners({ operation, deps })
    }
    if (!owners.plan || owners.plan.planFingerprint !== context.candidate.planFingerprint) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_PLAN_LINEAGE_INVALID')
    await updateClaimed({ operation, claimId, status: 'PREPARING', refs: { ...operation.refs, planId: owners.plan.planId,
      planFingerprint: owners.plan.planFingerprint }, deps })
    if (!owners.ownerSession) {
      await (deps.createSession || createRuntimeOutcomeSession)({ actorUserId, auditRequest,
        runtimeInstanceId: id(operation.targetRuntimeInstanceId), scopes,
        payload: { requestId: operation.requestId, planId: owners.plan.planId }, successorOperation: { operationId, claimId } })
      owners = await readOwners({ operation, deps })
    }
    if (!owners.ownerSession || !owners.message) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SESSION_LINEAGE_INVALID')
    await updateClaimed({ operation, claimId, status: 'GENERATING', refs: { ...operation.refs,
      sessionId: owners.ownerSession.sessionId, messageId: owners.message.messageId }, deps })
    await verifyOutcomeSuccessorOperationCurrentness({ operation, actorUserId, scopes, session: null, deps })
    if (!owners.draft) {
      if (owners.message.responseStatus !== 'PENDING_RESPONSE') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_AMBIGUOUS_GENERATION')
      await (deps.generateResponse || generateRuntimeOutcomeResponse)({ actorUserId, auditRequest,
        runtimeInstanceId: id(operation.targetRuntimeInstanceId), scopes, sessionId: owners.ownerSession.sessionId,
        messageId: owners.message.messageId, executionMode: 'LIVE_TEST', ...(deps.generationOptions || {}),
        successorOperation: { operationId, claimId } })
    }
    owners = await readOwners({ operation, deps })
    if (!owners.draft || !owners.iteration) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
    const completionSession = await db.startSession()
    try {
      await completionSession.withTransaction(async () => {
        await verifyOutcomeSuccessorOperationCurrentness({ operation, actorUserId, scopes, session: completionSession, deps })
        const fresh = await readOwners({ operation, session: completionSession, deps })
        if (!fresh.draft || !fresh.iteration) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
        await updateClaimed({ operation, claimId, status: 'SUCCEEDED', refs: { ...operation.refs,
          draftId: fresh.draft.draftId, draftIterationId: fresh.iteration.draftIterationId }, session: completionSession, deps })
        if (!await (deps.writeCompletionAudit || writeOutcomeSuccessorCompletionAudit)({ operation, actorUserId,
          auditRequest, session: completionSession })) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_COMPLETION_AUDIT_REQUIRED')
      })
    } finally { await completionSession.endSession() }
    return { operation, owners, idempotent: false }
  } catch (error) {
    const persisted = await findOne(model, { _id: operation._id })
    if (persisted?.status === 'SUCCEEDED') {
      return { operation: persisted, owners: await readOwners({ operation: persisted, deps }), idempotent: true }
    }
    const failure = await (deps.readRecordedFailure || readRecordedFailure)({ operation, deps })
    const reason = failure?.failure?.failureCode || error.reason || error.details?.blockerReason
      || error.details?.reason || 'OUTCOME_SUCCESSOR_EXECUTION_UNCERTAIN'
    await updateClaimed({ operation, claimId, status: failure || reason === 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED'
      ? 'BLOCKED' : 'RECOVERY_REQUIRED', refs: operation.refs, blockerReason: reason, deps })
    throw error
  }
}

// Reconcile committed owners after a lost response without invoking any provider or taking over an executor.
export const reconcileOutcomeSuccessorOperation = async ({ actorUserId, operationId, runtimeInstanceId, scopes,
  auditRequest, deps = {} }) => {
  const model = deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation
  const operation = await findOne(model, { operationId, sourceRuntimeInstanceId: runtimeInstanceId })
  if (!operation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OPERATION_NOT_FOUND', 404)
  await authorizeOperation({ operation, actorUserId, scopes, deps })
  const owners = await (deps.readOwnerState || readOwnerState)({ operation, deps })
  if (operation.status === 'SUCCEEDED') return { operation, owners, idempotent: true }
  if (!owners.draft || !owners.iteration) return { operation, owners,
    recoveryRequired: true, executionPending: Boolean(operation.claimId), idempotent: true }
  const db = deps.mongoose || mongoose
  const session = await db.startSession()
  try {
    await session.withTransaction(async () => {
      await verifyOutcomeSuccessorOperationCurrentness({ operation, actorUserId, scopes, session, deps })
      const fresh = await (deps.readOwnerState || readOwnerState)({ operation, session, deps })
      if (!fresh.draft || !fresh.iteration) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
      await updateClaimed({ operation, claimId: operation.claimId, status: 'SUCCEEDED', refs: { ...operation.refs,
        planId: fresh.plan.planId, sessionId: fresh.ownerSession.sessionId, messageId: fresh.message.messageId,
        draftId: fresh.draft.draftId, draftIterationId: fresh.iteration.draftIterationId }, session, deps })
      if (!await (deps.writeCompletionAudit || writeOutcomeSuccessorCompletionAudit)({ operation, actorUserId, auditRequest, session })) {
        throw outcomeSuccessorError('OUTCOME_SUCCESSOR_COMPLETION_AUDIT_REQUIRED')
      }
    })
  } finally { await session.endSession() }
  return { operation, owners, idempotent: true }
}
