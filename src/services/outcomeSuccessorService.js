import mongoose from 'mongoose'
import { assertNormalOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { OutcomeAsset, OutcomeAssetVersion, OutcomeSession, OutcomeDraft, OutcomeDraftIteration,
  OutcomeKnowledgeCompositionPlan, RuntimeInstance } from '../models/index.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity, buildOutcomeKnowledgeCompositionPlanForRuntime } from './outcomeKnowledgeCompositionPlanService.js'
import { getRuntimeOutcomePlanningEvidence, RUNTIME_STATE_V2_CONTROL_PROJECTION } from './runtimeStateRepository.js'
import { OUTCOME_PLANNING_EVIDENCE_VERSIONS } from './outcomeFrameworkHandoffService.js'
import { projectRuntimeEvidenceToMeaningReadiness } from './outcomeRuntimeEvidenceToMeaningService.js'
import { assertOutcomeSuccessorSource, assertOutcomeSuccessorTarget, assertOutcomeSuccessorCarryForward,
  hashOutcomeSuccessorValue, outcomeSuccessorError } from './outcomeSuccessorContract.js'
import { sealOutcomeSuccessorConfirmation, openOutcomeSuccessorConfirmation, OUTCOME_SUCCESSOR_UUID } from './outcomeSuccessorConfirmation.js'
import { claimOutcomeSuccessorOperation, readOutcomeSuccessorOperationByKey,
  assertOutcomeSuccessorOperationBinding } from './outcomeSuccessorOperationService.js'
import OutcomeSuccessorOperation from '../models/OutcomeSuccessorOperation.js'

export const OUTCOME_SUCCESSOR_CONTROL_PROJECTION = `${RUNTIME_STATE_V2_CONTROL_PROJECTION} revision.rootRuntimeId revision.parentRuntimeId`
const id = (value) => String(value ?? '').trim()
const MAX_TARGETS = 20
const READ_TIMEOUT_MS = 2000
const readOne = async (model, filter, projection, { session = null } = {}) =>
  model.findOne(filter).select(projection).session(session).maxTimeMS(READ_TIMEOUT_MS).lean()
const authorize = async ({ actorUserId, runtimeInstanceId, scopes, deps, write = false }) => {
  if (!mongoose.isValidObjectId(actorUserId)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_UNAUTHORIZED', 401)
  const runtime = await (deps.readRuntimeControl || getRuntimeInstance)({ runtimeInstanceId, scopes,
    projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: READ_TIMEOUT_MS, session: deps.session || null })
  if (!runtime) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_NOT_FOUND', 404)
  await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId, scopes,
    customerId: runtime.customerId, tenantId: runtime.tenantId,
    permission: `${runtime.runtimeType === 'DEAL_ANALYSIS' ? 'DEAL' : 'VMF'}_${write ? 'UPDATE' : 'VIEW'}`,
    maxTimeMS: READ_TIMEOUT_MS, session: deps.session || null })
  assertNormalOutcomeRuntime(runtime)
  return runtime
}

// Passive preflight: existing bounded evidence/KCP owners only. No Truth Quality execution or writes.
export const getOutcomeSuccessorPreflight = async ({ actorUserId, runtimeInstanceId, outcomeAssetId,
  outcomeAssetVersionId, targetRuntimeInstanceId, scopes, deps = {} } = {}) => {
  if (!mongoose.isValidObjectId(actorUserId)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_UNAUTHORIZED', 401)
  if (!id(outcomeAssetId) || !id(outcomeAssetVersionId)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_REQUIRED', 422)
  const sourceRuntime = await authorize({ actorUserId, runtimeInstanceId, scopes, deps })
  const scope = { customerId: sourceRuntime.customerId, tenantId: sourceRuntime.tenantId,
    runtimeInstanceId: sourceRuntime._id || sourceRuntime.id }
  const lookup = (model, filter, projection) => (deps.readOne || readOne)(model, filter, projection, { session: deps.session || null })
  const asset = await lookup(deps.OutcomeAsset || OutcomeAsset, { ...scope, outcomeAssetId },
    'outcomeAssetId customerId tenantId runtimeInstanceId status')
  const version = await lookup(deps.OutcomeAssetVersion || OutcomeAssetVersion,
    { ...scope, outcomeAssetId, outcomeAssetVersionId },
    '')
  if (!asset || !version) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_NOT_FOUND', 404)
  const session = await lookup(deps.OutcomeSession || OutcomeSession,
    { ...scope, sessionId: version.sessionId }, 'customerId tenantId runtimeInstanceId sessionId contextBindings.requestPlan')
  const request = session?.contextBindings?.requestPlan
  if (!request?.requestId || !request.planId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  const plan = await lookup(deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    { ...scope, requestId: request.requestId, planId: request.planId }, '')
  if (!plan) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  const approval = version.lineageSummary?.draftApproval
  const draft = await lookup(deps.OutcomeDraft || OutcomeDraft,
    { ...scope, sessionId: version.sessionId, draftId: approval?.draftId },
    'customerId tenantId runtimeInstanceId sessionId draftId status approvedIterationId approvedAssetVersionId')
  const iteration = await lookup(deps.OutcomeDraftIteration || OutcomeDraftIteration,
    { ...scope, sessionId: version.sessionId, draftId: approval?.draftId, draftIterationId: approval?.draftIterationId },
    'customerId tenantId runtimeInstanceId sessionId draftId draftIterationId iterationNumber status')
  const source = assertOutcomeSuccessorSource({ sourceRuntime, asset, version, session, plan, draft, iteration })
  const explicitTarget = id(targetRuntimeInstanceId)
  const targetRuntime = explicitTarget && explicitTarget !== source.source.runtimeInstanceId
    ? await authorize({ actorUserId, runtimeInstanceId: explicitTarget, scopes, deps }) : sourceRuntime
  const identities = assertOutcomeSuccessorTarget({ sourceRuntime, targetRuntime })
  const listFilter = { customerId: sourceRuntime.customerId, tenantId: sourceRuntime.tenantId,
    workspaceId: source.source.workspaceId || { $in: [null, ''] }, 'revision.rootRuntimeId': source.source.rootRuntimeId,
    'revision.revisionNumber': { $gt: source.source.revisionNumber } }
  const list = deps.listTargets
    ? await deps.listTargets({ filter: listFilter, projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION,
      limit: MAX_TARGETS + 1, maxTimeMS: READ_TIMEOUT_MS })
    : await (deps.RuntimeInstance || RuntimeInstance).find(listFilter).select(OUTCOME_SUCCESSOR_CONTROL_PROJECTION)
      .sort({ 'revision.revisionNumber': 1, _id: 1 }).limit(MAX_TARGETS + 1).session(deps.session || null).maxTimeMS(READ_TIMEOUT_MS).lean()
  if (!Array.isArray(list)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_TARGET_LIST_UNASSESSED')
  const targets = []
  for (const target of list.slice(0, MAX_TARGETS)) {
    // Independently authorize each visible candidate before exposing its metadata.
    const visible = await authorize({ actorUserId, runtimeInstanceId: id(target._id || target.id), scopes, deps })
    try { targets.push({ ...assertOutcomeSuccessorTarget({ sourceRuntime, targetRuntime: visible }).target, eligible: true }) }
    catch (error) {
      if (error.code !== 'OUTCOME_SUCCESSOR_BLOCKED') throw error
      targets.push({ runtimeInstanceId: id(visible._id || visible.id), revisionNumber: visible.revision?.revisionNumber,
        eligible: false, blocker: error.reason })
    }
  }
  const evidenceDeps = { ...deps, readKcpRuntimeEvidence: (args) =>
    (deps.readKcpRuntimeEvidence || getRuntimeOutcomePlanningEvidence)({ ...args,
      planningEvidenceVersion: OUTCOME_PLANNING_EVIDENCE_VERSIONS.V2 }) }
  const seed = source.intentFingerprint
  const requestId = deps.successorRequestId
    || `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`
  const candidate = await (deps.buildCandidate || buildOutcomeKnowledgeCompositionPlanForRuntime)({
    actorUserId, scopes, runtimeInstanceId: identities.target.runtimeInstanceId,
    expectedRuntimeUpdatedAt: targetRuntime.updatedAt, consumerIntent: source.intent, session: deps.session || null,
    requestScope: { customerId: targetRuntime.customerId, tenantId: targetRuntime.tenantId,
      runtimeInstanceId: targetRuntime._id || targetRuntime.id, requestId }, deps: evidenceDeps })
  assertOutcomeSuccessorCarryForward({ sourcePlan: plan, candidate })
  const readiness = (deps.projectReadiness || projectRuntimeEvidenceToMeaningReadiness)(candidate)
  if (!readiness || typeof readiness.canExecute !== 'boolean') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EVIDENCE_UNASSESSED')
  if (deps.capturePreflightContext) deps.capturePreflightContext({ sourceRuntime, targetRuntime, sourcePlan: plan, candidate, source })
  const fingerprint = hashOutcomeSuccessorValue({ sourceHash: source.sourceHash,
    sourceVersionWitnessHash: source.sourceVersionWitnessHash,
    intentFingerprint: source.intentFingerprint, contractFingerprint: source.contractFingerprint,
    target: identities.target, candidateFingerprint: candidate.planFingerprint })
  return { status: readiness.canExecute ? 'READY_FOR_CONFIRMATION' : 'BLOCKED',
    source: { ...source.source, outcomeAssetId: source.sourceAssetId, outcomeAssetVersionId: source.sourceAssetVersionId,
      versionNumber: source.sourceVersionNumber, sourceHash: source.sourceHash,
      sourceVersionWitnessHash: source.sourceVersionWitnessHash },
    target: identities.target, targetExplicitlySelected: Boolean(explicitTarget),
    targets, targetList: { limit: MAX_TARGETS, limitReached: list.length > MAX_TARGETS, maxTimeMS: READ_TIMEOUT_MS },
    carryForward: { originalRequest: source.intent.originalRequest, intentFingerprint: source.intentFingerprint,
      contractFingerprint: source.contractFingerprint },
    readiness, metadataFingerprint: fingerprint,
    confirmation: { required: true, executable: false, reason: 'SUCCESSOR_CONFIRMATION_NOT_IMPLEMENTED' } }
}

export const projectOutcomeSuccessorOperation = (operation, idempotent = false) => ({ operationId: operation.operationId,
  status: operation.status, requestId: operation.requestId, source: operation.binding.source,
  target: operation.binding.target,
  result: operation.status === 'SUCCEEDED' && operation.refs?.draftId && operation.refs?.draftIterationId
    ? { draftId: operation.refs.draftId, draftIterationId: operation.refs.draftIterationId } : null,
  blockerReason: operation.blockerReason || '', idempotent,
  request: { requestId: operation.requestId, planId: operation.refs?.planId || '',
    sessionId: operation.refs?.sessionId || '', messageId: operation.refs?.messageId || '' },
  execution: { canExecute: false, reason: operation.status === 'SUCCEEDED'
    ? 'SUCCESSOR_DRAFT_PERSISTED' : 'SUCCESSOR_COORDINATED_EXECUTION_REQUIRED' } })
const boundAuthorization = async ({ binding, actorUserId, scopes, deps, write }) => {
  if (id(actorUserId) !== binding.actorUserId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_SCOPE_MISMATCH', 403)
  const sourceRuntime = await authorize({ actorUserId, runtimeInstanceId: binding.source.runtimeInstanceId, scopes, deps, write })
  const targetRuntime = await authorize({ actorUserId, runtimeInstanceId: binding.target.runtimeInstanceId, scopes, deps, write })
  const identities = assertOutcomeSuccessorTarget({ sourceRuntime, targetRuntime })
  if (['customerId', 'tenantId', 'workspaceId'].some((field) => identities.source[field] !== binding.source[field])) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_SCOPE_MISMATCH', 403)
  }
}
export const confirmOutcomeSuccessor = async ({ actorUserId, runtimeInstanceId, outcomeAssetId, outcomeAssetVersionId,
  targetRuntimeInstanceId, idempotencyKey, scopes, deps = {} }) => {
  if (!OUTCOME_SUCCESSOR_UUID.test(idempotencyKey)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_IDEMPOTENCY_KEY_REQUIRED', 422)
  const sourceRuntime = await authorize({ actorUserId, runtimeInstanceId, scopes, deps, write: true })
  const selectedTargetId = id(targetRuntimeInstanceId) || id(sourceRuntime._id || sourceRuntime.id)
  await authorize({ actorUserId, runtimeInstanceId: selectedTargetId, scopes, deps, write: true })
  const lookupBinding = { source: { customerId: id(sourceRuntime.customerId), tenantId: id(sourceRuntime.tenantId),
    runtimeInstanceId: id(sourceRuntime._id || sourceRuntime.id) }, idempotencyKey }
  const previous = await (deps.readOperationByKey || readOutcomeSuccessorOperationByKey)(lookupBinding, deps)
  const requestSeed = hashOutcomeSuccessorValue({ actorUserId: id(actorUserId), ...lookupBinding })
  const requestId = previous?.requestId
    || `${requestSeed.slice(0, 8)}-${requestSeed.slice(8, 12)}-4${requestSeed.slice(13, 16)}-8${requestSeed.slice(17, 20)}-${requestSeed.slice(20, 32)}`
  const preflight = await (deps.getPreflight || getOutcomeSuccessorPreflight)({ actorUserId, runtimeInstanceId, outcomeAssetId,
    outcomeAssetVersionId, targetRuntimeInstanceId: selectedTargetId, scopes, deps: { ...deps, successorRequestId: requestId } })
  if (preflight.status !== 'READY_FOR_CONFIRMATION') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EVIDENCE_NOT_READY')
  const binding = { actorUserId: id(actorUserId), source: preflight.source, target: preflight.target,
    metadataFingerprint: preflight.metadataFingerprint, intentFingerprint: preflight.carryForward.intentFingerprint,
    contractFingerprint: preflight.carryForward.contractFingerprint, idempotencyKey, requestId }
  if (previous) assertOutcomeSuccessorOperationBinding(previous, binding)
  return { ...preflight, requestId, idempotencyKey, confirmation: { required: true, executable: false,
    reason: 'SUCCESSOR_EXECUTION_NOT_IMPLEMENTED', receipt: sealOutcomeSuccessorConfirmation(binding, deps) } }
}

export const createOutcomeSuccessorOperation = async ({ actorUserId, runtimeInstanceId, outcomeAssetId, outcomeAssetVersionId,
  targetRuntimeInstanceId, idempotencyKey, confirmationReceipt, confirm, scopes, auditRequest, deps = {} }) => {
  if (confirm !== true) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_REQUIRED', 422)
  const binding = openOutcomeSuccessorConfirmation(confirmationReceipt, deps, { allowExpired: true })
  if (id(runtimeInstanceId) !== binding.source.runtimeInstanceId || outcomeAssetId !== binding.source.outcomeAssetId
    || outcomeAssetVersionId !== binding.source.outcomeAssetVersionId || targetRuntimeInstanceId !== binding.target.runtimeInstanceId
    || idempotencyKey !== binding.idempotencyKey) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_BINDING_MISMATCH', 403)
  await boundAuthorization({ binding, actorUserId, scopes, deps, write: true })
  const previous = await (deps.readOperationByKey || readOutcomeSuccessorOperationByKey)(binding, deps)
  if (previous) { assertOutcomeSuccessorOperationBinding(previous, binding); return projectOutcomeSuccessorOperation(previous, true) }
  openOutcomeSuccessorConfirmation(confirmationReceipt, deps)
  const fresh = await (deps.getPreflight || getOutcomeSuccessorPreflight)({ actorUserId, runtimeInstanceId, outcomeAssetId,
    outcomeAssetVersionId, targetRuntimeInstanceId, scopes, deps: { ...deps, successorRequestId: binding.requestId } })
  if (fresh.status !== 'READY_FOR_CONFIRMATION' || fresh.metadataFingerprint !== binding.metadataFingerprint
    || hashOutcomeSuccessorValue(fresh.source) !== hashOutcomeSuccessorValue(binding.source)
    || hashOutcomeSuccessorValue(fresh.target) !== hashOutcomeSuccessorValue(binding.target)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_STALE')
  }
  const result = await (deps.claimOperation || claimOutcomeSuccessorOperation)({ binding, auditRequest, deps })
  return projectOutcomeSuccessorOperation(result.operation, result.idempotent)
}

export const getOutcomeSuccessorOperation = async ({ actorUserId, runtimeInstanceId, operationId, scopes, deps = {} }) => {
  const sourceRuntime = await authorize({ actorUserId, runtimeInstanceId, scopes, deps })
  const operation = await (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).findOne({ operationId,
    sourceRuntimeInstanceId: sourceRuntime._id || sourceRuntime.id,
    customerId: sourceRuntime.customerId, tenantId: sourceRuntime.tenantId }).maxTimeMS(READ_TIMEOUT_MS).lean()
  if (!operation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OPERATION_NOT_FOUND', 404)
  await authorize({ actorUserId, runtimeInstanceId: operation.targetRuntimeInstanceId, scopes, deps })
  if (operation.status === 'SUCCEEDED') {
    // Load the coordinator's persisted-owner reader after module initialization; return no raw owner content.
    const readOwnerState = deps.readOwnerState || (await import('./outcomeSuccessorExecutionService.js')).readOutcomeSuccessorOwnerState
    const owners = await readOwnerState({ operation, deps })
    if (!owners.draft || !owners.iteration || owners.draft.draftId !== operation.refs?.draftId
      || owners.iteration.draftIterationId !== operation.refs?.draftIterationId) {
      throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_INCOMPLETE')
    }
  }
  return projectOutcomeSuccessorOperation(operation)
}
