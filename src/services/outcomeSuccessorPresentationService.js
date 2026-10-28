import { OutcomeAsset, OutcomeAssetVersion, OutcomeSession, OutcomeDraft, OutcomeDraftIteration,
  OutcomeKnowledgeCompositionPlan, OutcomeSuccessorOperation, OutcomeMessage, OutcomeQualityStageExecution } from '../models/index.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { assertNormalOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { getRuntimeOutcomeDraftPreview } from './outcomeStudioService.js'
import { getOutcomeSuccessorPreflight, getOutcomeSuccessorOperation, OUTCOME_SUCCESSOR_CONTROL_PROJECTION } from './outcomeSuccessorService.js'
import { assertOutcomeSuccessorSource, assertOutcomeSuccessorTarget, hashOutcomeSuccessorValue, outcomeSuccessorError } from './outcomeSuccessorContract.js'
import { isOutcomeCustomerLanguageSafe } from './outcomeCustomerLanguageService.js'
import { validateOutcomeGovernedQualityChain, loadOutcomeGovernedQualityChainStyleSource } from './outcomeGovernedQualityChainValidationService.js'
import { projectOutcomeSuccessorLineage } from './outcomeSuccessorOperationService.js'
import { readRuntimeEvidenceToMeaningContract } from './outcomeRuntimeEvidenceToMeaningService.js'

const id = (value) => String(value ?? '').trim()
const readOne = (model, filter) => model.findOne(filter).maxTimeMS(2000).lean()
const notices = (record, content) => {
  if (record === undefined) return content
  if (content === undefined) return record
  if (!Array.isArray(record) || !Array.isArray(content)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
  return [...record, ...content]
}
const descriptor = (value = {}) => ({ key: id(value.key), label: id(value.label || value.name || value.key),
  ...(value.version ? { version: id(value.version) } : {}) })
const publicIdentity = (value = {}) => Object.fromEntries(['runtimeInstanceId', 'runtimeInstanceKey', 'revisionNumber',
  'frameworkKey', 'packageKey', 'packageVersion', 'outcomeAssetId', 'outcomeAssetVersionId', 'versionNumber',
  'sourceHash', 'sourceVersionWitnessHash', 'stateVersion', 'dependencySnapshotId', 'dependencySnapshotHash']
  .filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
const evidenceSnapshotFields = ['publishSnapshotId', 'publishSnapshotHash', 'lockSnapshotId', 'lockSnapshotHash',
  'replayAnchorId', 'replayAnchorHash']
// These are recorded accepted-truth identities, never package configuration or inferred hashes.
const evidenceSnapshot = (evidence = {}) => {
  const recorded = Object.fromEntries(evidenceSnapshotFields
    .filter((field) => typeof evidence?.[field] === 'string' && evidence[field].trim())
    .map((field) => [field, evidence[field]]))
  const missingFields = evidenceSnapshotFields.filter((field) => recorded[field] === undefined)
  return { status: missingFields.length ? 'UNAVAILABLE' : 'AVAILABLE', ...recorded,
    ...(missingFields.length ? { reason: 'ACCEPTED_EVIDENCE_SNAPSHOT_NOT_RECORDED', missingFields } : {}) }
}
const candidateEvidenceSnapshot = (candidate) => {
  const projected = evidenceSnapshot(candidate?.payload?.lockedTruth)
  if (!candidate?.payload?.evidenceToMeaning) return { ...projected,
    inventoryReceipt: { status: 'UNAVAILABLE', reason: 'EVIDENCE_INVENTORY_RECEIPT_NOT_RECORDED' } }
  const snapshot = readRuntimeEvidenceToMeaningContract(candidate).inputs.sourceSnapshot
  const receipt = snapshot?.inventoryReceipt
  if (!receipt) return { ...projected,
    inventoryReceipt: { status: 'UNAVAILABLE', reason: 'EVIDENCE_INVENTORY_RECEIPT_NOT_RECORDED' } }
  const fields = Object.fromEntries(['version', 'completeness', 'overallHash']
    .filter((field) => typeof receipt[field] === 'string' && receipt[field])
    .map((field) => [field, receipt[field]]))
  for (const [field, value] of [['totalEvidenceCount', receipt.collections?.evidence?.totalCount],
    ['totalSourceCount', receipt.collections?.sources?.totalCount]]) {
    if (Number.isInteger(value) && value >= 0) fields[field] = value
  }
  return { ...projected, ...(typeof snapshot.snapshotVersion === 'string' ? { snapshotVersion: snapshot.snapshotVersion } : {}),
    inventoryReceipt: { status: receipt.completeness === 'COMPLETE' && fields.overallHash ? 'AVAILABLE' : 'UNAVAILABLE',
      ...fields, ...(receipt.completeness === 'COMPLETE' && fields.overallHash ? {} : { reason: 'EVIDENCE_INVENTORY_INCOMPLETE' }) } }
}

export const projectOutcomeSuccessorContent = (content, title = '') => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
  const text = (value) => {
    if (value === undefined) return ''
    if (typeof value !== 'string') throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
    return value.trim()
  }
  const list = (value) => {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
    return value.map(text)
  }
  if (content.sections !== undefined && !Array.isArray(content.sections)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
  const projected = { title: text(title), markdown: text(content.markdown),
    sections: (content.sections || []).map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
      return { key: text(section.key), label: text(section.label || section.heading), body: text(section.body || section.markdown) }
    }), warnings: list(content.warnings), limitations: list(content.limitations) }
  if ((!projected.markdown && !projected.sections.some((section) => section.body)) || !isOutcomeCustomerLanguageSafe(projected)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE')
  }
  return projected
}

export const projectOutcomeSuccessorOperation = (value) => {
  const operation = value.operation || value
  const binding = operation.binding || operation
  const refs = operation.refs || {}
  const operationId = operation.operationId
  const source = publicIdentity(binding.source)
  const target = publicIdentity(binding.target)
  const sourceRuntime = source.runtimeInstanceId
  const base = `/api/v1/runtime-instances/${encodeURIComponent(sourceRuntime)}/outcome-studio/successor-operations/${encodeURIComponent(operationId)}`
  const result = operation.status === 'SUCCEEDED'
    ? operation.result || (refs.draftId && refs.draftIterationId ? { draftId: refs.draftId, draftIterationId: refs.draftIterationId } : null) : null
  return { contractVersion: 'outcome-studio.successor-api.v1', operationId, status: operation.status, source, target,
    request: { requestId: operation.requestId, ...(refs.planId ? { planId: refs.planId } : {}),
      ...(refs.sessionId ? { sessionId: refs.sessionId } : {}), ...(refs.messageId ? { messageId: refs.messageId } : {}) },
    result: result ? { draftId: result.draftId, draftIterationId: result.draftIterationId } : null,
    blocker: operation.blockerReason ? { code: operation.blockerReason === 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE'
      ? 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE' : 'OUTCOME_SUCCESSOR_BLOCKED',
    action: operation.blockerReason === 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE' ? 'CREATE_NEW_ASSET' : 'CHECK_SAVED_RESULT' } : null,
    retry: { allowed: false, action: 'READBACK' }, idempotent: Boolean(value.idempotent),
    recovery: { canCheckSavedWork: operation.status === 'RECOVERY_REQUIRED' },
    links: { readback: base, compare: result ? `${base}/compare` : null,
      reconcile: operation.status === 'RECOVERY_REQUIRED' ? `${base}/reconcile` : null,
      targetWorkspace: `/app/runtime/${encodeURIComponent(target.runtimeInstanceId)}/workbench` } }
}

export const getOutcomeSuccessorPreflightPresentation = async (args) => {
  const preview = await (args.deps?.getSourcePreview || getOutcomeSelectedVersionPreview)(args)
  let context
  const preflight = await getOutcomeSuccessorPreflight({ ...args, deps: { ...args.deps,
    capturePreflightContext: (value) => { context = value } } })
  if (args.captureCanonicalPreflight) args.captureCanonicalPreflight(preflight)
  if (!context?.sourcePlan) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  const governed = context.sourcePlan.payload.governedContext
  const contractDescriptor = (value, type) => ({ ...descriptor(value), version: id(context.sourcePlan.payload.resolution.selectedPacks
    .find((pack) => pack.packType === type)?.semanticVersion) })
  return { status: preflight.status, readiness: preflight.readiness, targetExplicitlySelected: preflight.targetExplicitlySelected,
    targetList: { limit: preflight.targetList.limit, limitReached: preflight.targetList.limitReached },
    contractVersion: 'outcome-studio.successor-api.v1',
    source: { ...publicIdentity(preflight.source), title: preview.title, historical: true, previewAvailable: true,
      evidenceSnapshot: evidenceSnapshot(preview.governance?.recordedTruth) },
    target: { ...publicIdentity(preflight.target), evidenceSnapshot: candidateEvidenceSnapshot(context.candidate) },
    targets: preflight.targets.map((target) => ({ ...publicIdentity(target),
      eligible: target.eligible, ...(target.blocker ? { blocker: { action: 'CREATE_NEW_ASSET' } } : {}) })),
    carryForward: { ...preflight.carryForward, outputType: contractDescriptor(governed.outputType, 'OUTPUT_TYPE_DEFINITION'),
      outputSchema: contractDescriptor(governed.outputSchema, 'OUTPUT_SCHEMA'), style: contractDescriptor(governed.style, 'STYLE') },
    confirmation: { required: true, executable: false, receipt: null } }
}

export const getOutcomeSuccessorOperationByKey = async ({ actorUserId, runtimeInstanceId, outcomeAssetId,
  outcomeAssetVersionId, targetRuntimeInstanceId, idempotencyKey, scopes, deps = {} }) => {
  const sourcePreview = await (deps.getSourcePreview || getOutcomeSelectedVersionPreview)({ actorUserId, runtimeInstanceId,
    outcomeAssetId, outcomeAssetVersionId, scopes, deps })
  const readRuntime = deps.readRuntimeControl || getRuntimeInstance
  const sourceRuntime = await readRuntime({ runtimeInstanceId, scopes, projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
  const targetRuntime = await readRuntime({ runtimeInstanceId: targetRuntimeInstanceId, scopes,
    projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
  if (!sourceRuntime || !targetRuntime) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_NOT_FOUND', 404)
  assertNormalOutcomeRuntime(sourceRuntime)
  await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId, scopes,
    customerId: targetRuntime.customerId, tenantId: targetRuntime.tenantId,
    permission: targetRuntime.runtimeType === 'DEAL_ANALYSIS' ? 'DEAL_VIEW' : 'VMF_VIEW', maxTimeMS: 2000 })
  assertNormalOutcomeRuntime(targetRuntime)
  assertOutcomeSuccessorTarget({ sourceRuntime, targetRuntime })
  const operation = await (deps.readOne || readOne)(OutcomeSuccessorOperation, { customerId: sourceRuntime.customerId,
    tenantId: sourceRuntime.tenantId, sourceRuntimeInstanceId: sourceRuntime._id || sourceRuntime.id, idempotencyKey })
  if (!operation) return { contractVersion: 'outcome-studio.successor-api.v1', status: 'NOT_RECORDED', operationId: null, result: null }
  if (operation.sourceAssetId !== outcomeAssetId || operation.sourceAssetVersionId !== outcomeAssetVersionId
    || id(operation.targetRuntimeInstanceId) !== targetRuntimeInstanceId
    || operation.binding?.source?.outcomeAssetId !== outcomeAssetId
    || operation.binding?.source?.outcomeAssetVersionId !== outcomeAssetVersionId
    || operation.binding?.target?.runtimeInstanceId !== targetRuntimeInstanceId
    || operation.binding?.source?.sourceHash !== sourcePreview.governance.sourceHash
    || operation.binding?.source?.sourceVersionWitnessHash !== sourcePreview.governance.sourceVersionWitnessHash) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_IDEMPOTENCY_CONFLICT')
  return getOutcomeSuccessorOperationPresentation({ actorUserId, runtimeInstanceId, operationId: operation.operationId,
    scopes, deps, idempotent: true })
}

export const getOutcomeSelectedVersionPreview = async ({ actorUserId, runtimeInstanceId, outcomeAssetId,
  outcomeAssetVersionId, scopes, deps = {} }) => {
  const runtime = await (deps.readRuntimeControl || getRuntimeInstance)({ runtimeInstanceId, scopes,
    projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
  if (!runtime) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_NOT_FOUND', 404)
  await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId, scopes, customerId: runtime.customerId,
    tenantId: runtime.tenantId, permission: runtime.runtimeType === 'DEAL_ANALYSIS' ? 'DEAL_VIEW' : 'VMF_VIEW', maxTimeMS: 2000 })
  assertNormalOutcomeRuntime(runtime)
  const scope = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id || runtime.id }
  const lookup = (model, filter) => (deps.readOne || readOne)(model, filter)
  const asset = await lookup(OutcomeAsset, { ...scope, outcomeAssetId })
  const version = await lookup(OutcomeAssetVersion, { ...scope, outcomeAssetId, outcomeAssetVersionId })
  if (!asset || !version) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_NOT_FOUND', 404)
  const approval = version.lineageSummary?.draftApproval
  const session = await lookup(OutcomeSession, { ...scope, sessionId: version.sessionId })
  const request = session?.contextBindings?.requestPlan
  if (!request?.requestId || !request.planId || !approval?.draftId || !approval.draftIterationId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE')
  const plan = await lookup(OutcomeKnowledgeCompositionPlan, { ...scope, requestId: request.requestId, planId: request.planId })
  const draft = await lookup(OutcomeDraft, { ...scope, sessionId: version.sessionId, draftId: approval.draftId })
  const iteration = await lookup(OutcomeDraftIteration, { ...scope, sessionId: version.sessionId,
    draftId: approval.draftId, draftIterationId: approval.draftIterationId })
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  const source = assertOutcomeSuccessorSource({ sourceRuntime: runtime, asset, version, session, plan, draft, iteration })
  return { kind: 'APPROVED_ASSET_VERSION', identity: { ...publicIdentity(source.source), outcomeAssetId,
    outcomeAssetVersionId, versionNumber: version.versionNumber }, historical: true, previewAvailable: true,
    ...projectOutcomeSuccessorContent({ ...version.customerContent,
      warnings: notices(version.warnings, version.customerContent?.warnings),
      limitations: notices(version.limitations, version.customerContent?.limitations) }, version.title),
    governance: { ...publicIdentity(source.source), sourceHash: source.sourceHash,
      sourceVersionWitnessHash: source.sourceVersionWitnessHash,
      evidenceSnapshot: evidenceSnapshot(version.truthSignature?.evidence),
      recordedTruth: Object.fromEntries(['publishSnapshotId', 'publishSnapshotHash', 'lockSnapshotId', 'lockSnapshotHash',
        'replayAnchorId', 'replayAnchorHash', 'runtimeRevision'].filter((field) => typeof version.truthSignature?.evidence?.[field] === 'string')
        .map((field) => [field, version.truthSignature.evidence[field]])),
      outputType: descriptor(source.outputContract.outputType), outputSchema: descriptor(source.outputContract.outputSchema),
      style: descriptor(source.outputContract.style) } }
}

export const getOutcomeSuccessorCompare = async (args) => {
  const { actorUserId, runtimeInstanceId, operationId, scopes, deps = {} } = args
  const authorized = await (deps.getOperation || getOutcomeSuccessorOperation)(args)
  const runtime = await (deps.readRuntimeControl || getRuntimeInstance)({ runtimeInstanceId, scopes,
    projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
  if (!runtime) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_NOT_FOUND', 404)
  assertNormalOutcomeRuntime(runtime)
  const operation = await (deps.readOne || readOne)(OutcomeSuccessorOperation, { operationId,
    sourceRuntimeInstanceId: runtime._id || runtime.id, customerId: runtime.customerId, tenantId: runtime.tenantId })
  if (!operation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OPERATION_NOT_FOUND', 404)
  if (id(operation.targetRuntimeInstanceId) !== authorized.target.runtimeInstanceId
    || operation.sourceAssetId !== authorized.source.outcomeAssetId
    || operation.sourceAssetVersionId !== authorized.source.outcomeAssetVersionId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_MISMATCH', 403)
  const source = await (deps.getSourcePreview || getOutcomeSelectedVersionPreview)({ actorUserId, runtimeInstanceId,
    outcomeAssetId: operation.sourceAssetId, outcomeAssetVersionId: operation.sourceAssetVersionId, scopes, deps })
  if (source.governance.sourceHash !== operation.binding.source.sourceHash
    || source.governance.sourceVersionWitnessHash !== operation.binding.source.sourceVersionWitnessHash) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_CHANGED')
  const governance = { source: source.governance, target: publicIdentity(operation.binding.target), changes: [] }
  for (const field of ['runtimeInstanceId', 'revisionNumber', 'stateVersion', 'dependencySnapshotId', 'dependencySnapshotHash']) {
    if (hashOutcomeSuccessorValue(governance.source[field]) !== hashOutcomeSuccessorValue(governance.target[field])) {
      governance.changes.push({ field, from: governance.source[field] ?? null, to: governance.target[field] ?? null })
    }
  }
  const { governance: sourceGovernance, ...from } = source
  void sourceGovernance
  if (operation.status !== 'SUCCEEDED' || !operation.refs?.draftId || !operation.refs?.draftIterationId) return { compareAvailable: false, from, to: null, governance }
  const scope = { customerId: operation.customerId, tenantId: operation.tenantId, runtimeInstanceId: operation.targetRuntimeInstanceId }
  const lookup = (model, filter) => (deps.readOne || readOne)(model, filter)
  const session = await lookup(OutcomeSession, { ...scope, sessionId: operation.refs.sessionId })
  const draft = await lookup(OutcomeDraft, { ...scope, sessionId: operation.refs.sessionId, draftId: operation.refs.draftId })
  const iteration = await lookup(OutcomeDraftIteration, { ...scope, sessionId: operation.refs.sessionId,
    draftId: operation.refs.draftId, draftIterationId: operation.refs.draftIterationId })
  if (!session || !draft || !iteration || draft.currentIterationId !== operation.refs.draftIterationId
    || session.contextBindings?.requestPlan?.requestId !== operation.requestId
    || session.contextBindings?.requestPlan?.planId !== operation.refs.planId
    || [draft, iteration].some((record) => record.phase !== 'GOVERNED_QUALITY_CHAIN'
      || record.lineageSummary?.governedQualityChain?.requestId !== operation.requestId
      || record.lineageSummary?.governedQualityChain?.planId !== operation.refs.planId
      || hashOutcomeSuccessorValue(record.lineageSummary?.successor) !== hashOutcomeSuccessorValue(projectOutcomeSuccessorLineage(operation)))) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  const plan = await lookup(OutcomeKnowledgeCompositionPlan, { ...scope, requestId: operation.requestId, planId: operation.refs.planId })
  const message = await lookup(OutcomeMessage, { ...scope, sessionId: operation.refs.sessionId, messageId: operation.refs.messageId,
    role: 'USER', 'contextBindings.requestPlan.requestId': operation.requestId, 'contextBindings.requestPlan.planId': operation.refs.planId })
  if (!plan || !message) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  const stages = await (deps.readStages || ((filter) => OutcomeQualityStageExecution.find(filter).maxTimeMS(2000).lean()))({
    ...scope, requestId: operation.requestId, planId: operation.refs.planId })
  ;(deps.validateQualityChain || validateOutcomeGovernedQualityChain)({ plan,
    styleSource: await loadOutcomeGovernedQualityChainStyleSource({ plan, stages, loadPackContent: deps.loadPackContent }),
    requestBinding: { requestId: operation.requestId, draftId: draft.draftId, draftIterationId: iteration.draftIterationId },
    stages, recordedStages: iteration.lineageSummary.governedQualityChain.stages })
  const preview = await (deps.getDraftPreview || getRuntimeOutcomeDraftPreview)({ actorUserId, scopes,
    runtimeInstanceId: id(operation.targetRuntimeInstanceId), sessionId: operation.refs.sessionId, draftId: operation.refs.draftId })
  if (preview.draftIterationId !== operation.refs.draftIterationId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  return { compareAvailable: true, from, to: { kind: 'GOVERNED_WORKING_DRAFT', identity: {
    runtimeInstanceId: id(operation.targetRuntimeInstanceId), draftId: preview.draftId, draftIterationId: preview.draftIterationId },
    ...projectOutcomeSuccessorContent({ ...iteration.customerContent,
      warnings: notices(iteration.warnings, iteration.customerContent?.warnings),
      limitations: notices(iteration.limitations, iteration.customerContent?.limitations), markdown: preview.markdown,
      sections: preview.sections }, preview.title) }, governance }
}

export const getOutcomeSuccessorOperationPresentation = async (args) => {
  const { runtimeInstanceId, operationId, scopes, deps = {} } = args
  const authorized = await (deps.getOperation || getOutcomeSuccessorOperation)(args)
  const runtime = await (deps.readRuntimeControl || getRuntimeInstance)({ runtimeInstanceId, scopes,
    projection: OUTCOME_SUCCESSOR_CONTROL_PROJECTION, maxTimeMS: 2000 })
  if (!runtime) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RUNTIME_NOT_FOUND', 404)
  assertNormalOutcomeRuntime(runtime)
  const operation = await (deps.readOne || readOne)(OutcomeSuccessorOperation, { operationId,
    sourceRuntimeInstanceId: runtime._id || runtime.id, customerId: runtime.customerId, tenantId: runtime.tenantId })
  if (!operation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_OPERATION_NOT_FOUND', 404)
  if (id(operation.targetRuntimeInstanceId) !== authorized.target.runtimeInstanceId
    || operation.sourceAssetId !== authorized.source.outcomeAssetId
    || operation.sourceAssetVersionId !== authorized.source.outcomeAssetVersionId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SCOPE_MISMATCH', 403)
  return projectOutcomeSuccessorOperation({ operation, idempotent: Boolean(args.idempotent) })
}
