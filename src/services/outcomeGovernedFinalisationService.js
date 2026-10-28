import {
  OutcomeAsset, OutcomeAssetVersion, OutcomeDraft, OutcomeDraftIteration,
  OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution, OutcomeRenderOutput, OutcomeSession, RuntimeInstance,
} from '../models/index.js'
import { validateOutcomeGovernedQualityChain, loadOutcomeGovernedQualityChainStyleSource } from './outcomeGovernedQualityChainValidationService.js'
import { assertCommercialOutputContract, OUTCOME_COMMERCIAL_CANDIDATE_TYPE, OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeReadableCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeGovernedCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeDecisionLedCommercialExpressionProfile.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { prepareOutcomeStudioAssetRender } from './outcomeStudioAssetRenderingService.js'

const text = (value) => String(value ?? '').trim()
export const governedFinalisationConflict = (blockerReason) => Object.assign(new Error('This governed draft cannot be finalised with its current evidence.'), {
  status: 409, code: 'CONFLICT', details: { reason: 'OUTCOME_DRAFT_APPROVAL_BLOCKED', blockerReason, approvalAvailable: false },
})
const read = async (query, dbSession) => (dbSession ? query.session(dbSession) : query).lean()
const scopeOf = (record) => ({ tenantId: record.tenantId, customerId: record.customerId,
  runtimeInstanceId: record.runtimeInstanceId || record._id || record.id })
export const governedApprovalSourceFingerprint = ({ session, draft, iteration }) => hashOutcomeQualityStageValue({
  session: { status: session.status, requestPlan: session.contextBindings?.requestPlan || session.requestPlan, truthSignature: session.truthSignature },
  draft: { status: draft.status, currentIterationId: draft.currentIterationId, currentIterationNumber: draft.currentIterationNumber,
    lineageSummary: draft.lineageSummary, knowledgePackBinding: draft.knowledgePackBinding, outputTypeKey: draft.outputTypeKey,
    outputTypeCapabilityKey: draft.outputTypeCapabilityKey, title: draft.title, truthSignature: draft.truthSignature },
  iteration: { status: iteration.status, customerContent: iteration.customerContent, lineageSummary: iteration.lineageSummary,
    validationSummary: iteration.validationSummary, outputTypeKey: iteration.outputTypeKey, title: iteration.title,
    warnings: iteration.warnings, limitations: iteration.limitations },
})

export const readGovernedApprovalState = async ({ scope, sessionId, draftId, dbSession = null }) => {
  // Mongo transaction reads are sequential; no parallel transaction operations.
  const runtime = await read(RuntimeInstance.findOne({ _id: scope.runtimeInstanceId, tenantId: scope.tenantId, customerId: scope.customerId }), dbSession)
  const session = await read(OutcomeSession.findOne({ ...scope, sessionId }), dbSession)
  const draft = await read(OutcomeDraft.findOne({ ...scope, sessionId, draftId }), dbSession)
  if (!runtime || !session || !draft) throw governedFinalisationConflict('OUTCOME_GOVERNED_APPROVAL_SOURCE_MISSING')
  const iteration = await read(OutcomeDraftIteration.findOne({ ...scope, sessionId, draftId, draftIterationId: draft.currentIterationId }), dbSession)
  const chain = iteration?.lineageSummary?.governedQualityChain || draft.lineageSummary?.governedQualityChain
  if (!iteration || !chain || chain.draftId !== draftId || chain.draftIterationId !== iteration.draftIterationId) {
    throw governedFinalisationConflict('OUTCOME_GOVERNED_QUALITY_CHAIN_NOT_CURRENT')
  }
  const plan = await read(OutcomeKnowledgeCompositionPlan.findOne({ ...scope, requestId: chain.requestId }).sort({ planVersion: -1 }), dbSession)
  const requestPlan = session.contextBindings?.requestPlan || session.requestPlan
  if (!plan || plan.planId !== chain.planId || plan.planFingerprint !== chain.planFingerprint
    || session.status !== 'ACTIVE' || requestPlan?.requestId !== chain.requestId
    || requestPlan?.planId !== chain.planId || requestPlan?.planFingerprint !== chain.planFingerprint) {
    throw governedFinalisationConflict('OUTCOME_GOVERNED_QUALITY_CHAIN_NOT_CURRENT')
  }
  const history = await read(OutcomeQualityStageExecution.find({ ...scope, requestId: chain.requestId, planId: chain.planId,
    draftId, draftIterationId: iteration.draftIterationId }).sort({ stageOrder: 1, attemptNumber: 1 }), dbSession)
  const stages = validateOutcomeGovernedQualityChain({ plan, runtime, stages: history, recordedStages: chain.stages,
    styleSource: await loadOutcomeGovernedQualityChainStyleSource({ plan, stages: history, session: dbSession }),
    requestBinding: { requestId: chain.requestId, draftId, draftIterationId: iteration.draftIterationId } })
  return { runtime, session, draft, iteration, plan, stages, fingerprint: governedApprovalSourceFingerprint({ session, draft, iteration }) }
}

export const prepareGovernedOutcomeApprovalRender = async ({ state, assetVersion, loadPackReceipt, prepareRender = prepareOutcomeStudioAssetRender }) => {
  const { plan, runtime, stages } = state
  const context = plan.payload.governedContext
  const selectedTypeKey = text(context.outputType?.key).toLowerCase()
  const shaped = stages[4].outputSnapshot
  const commercial = [OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION, OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION,
    OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION, OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION]
    .includes(shaped.expressionProfileVersion)
  if (commercial) {
    try { assertCommercialOutputContract(shaped.outputContract, { plan }) }
    catch { throw governedFinalisationConflict('OUTCOME_RENDERED_CANDIDATE_CONTRACT_MISMATCH') }
  }
  if (!selectedTypeKey || text(plan.requestedOutputTypeKey).toLowerCase() !== selectedTypeKey
    || (!commercial && shaped.outputContract !== undefined)
    || shaped.candidateType !== (commercial ? OUTCOME_COMMERCIAL_CANDIDATE_TYPE : 'EXECUTIVE_BRIEF')
    || [state.draft, state.iteration, assetVersion].some((record) => text(record.outputTypeCapabilityKey).toLowerCase() !== selectedTypeKey)
    || !text(context.outputSchema?.key)) throw governedFinalisationConflict('OUTCOME_RENDERED_CANDIDATE_CONTRACT_MISMATCH')
  const selected = plan.payload.resolution.selectedPacks
  const pick = (layer) => {
    const matches = selected.filter((pack) => pack.knowledgeLayer === layer)
    if (matches.length !== 1) throw governedFinalisationConflict('RENDERING_PACK_SELECTION_INCOMPLETE')
    return matches[0]
  }
  const style = pick('STYLE'), visual = pick('VISUAL_SYSTEM')
  const outputType = pick('OUTPUT_TYPE'), outputSchema = pick('OUTPUT_SCHEMA')
  if (text(outputType.capabilityKey).toLowerCase() !== selectedTypeKey
    || text(outputSchema.capabilityKey).toLowerCase() !== text(context.outputSchema.key).toLowerCase()) {
    throw governedFinalisationConflict('OUTCOME_RENDERED_CANDIDATE_CONTRACT_MISMATCH')
  }
  const stylePackReceipt = await loadPackReceipt({ pack: style, role: 'STYLE' })
  const visualSystemPackReceipt = await loadPackReceipt({ pack: visual, role: 'VISUAL_SYSTEM' })
  for (const [selectedPack, receipt] of [[style, stylePackReceipt], [visual, visualSystemPackReceipt]]) {
    if (['packKey', 'versionId', 'contentHash'].some((key) => text(selectedPack[key]) !== text(receipt[key]))) {
      throw governedFinalisationConflict('RENDERING_PACK_RECEIPT_MISMATCH')
    }
  }
  // A revision is a RuntimeInstance document, not a lock/publish snapshot or
  // a legacy framework_state display alias.
  const runtimeRevision = { id: text(runtime._id || runtime.id), number: Number(runtime.revision?.revisionNumber) }
  if (!runtimeRevision.id || runtimeRevision.id !== text(plan.runtimeInstanceId)
    || !Number.isSafeInteger(runtimeRevision.number) || runtimeRevision.number < 1
    || (runtimeRevision.number > 1 && (!runtime.revision.rootRuntimeId || !runtime.revision.parentRuntimeId
      || text(runtime.revision.rootRuntimeId) === runtimeRevision.id || text(runtime.revision.parentRuntimeId) === runtimeRevision.id))
    || (runtimeRevision.number === 1 && (runtime.revision.parentRuntimeId
      || (runtime.revision.rootRuntimeId && text(runtime.revision.rootRuntimeId) !== runtimeRevision.id)))) {
    throw governedFinalisationConflict('RUNTIME_REVISION_NOT_BOUND_TO_ASSET_VERSION')
  }
  const aliases = runtime.framework_state?.revision || {}
  if ([aliases.revisionId, runtime.framework_state?.revisionId, runtime.currentRevisionId, runtime.revision?.revisionId]
    .some((value) => text(value) && text(value) !== runtimeRevision.id)
    || [aliases.revisionNumber, runtime.framework_state?.revisionNumber, runtime.currentRevisionNumber]
      .some((value) => value !== undefined && value !== null && Number(value) !== runtimeRevision.number)) {
    throw governedFinalisationConflict('RUNTIME_REVISION_ALIAS_CONFLICT')
  }
  const evidenceReferences = plan.payload.lockedTruth.acceptedSections.map((section) => ({
    sourceId: plan.payload.lockedTruth.lockSnapshotId, locator: section.runtimePath, status: 'ACCEPTED',
  }))
  const governanceMarkers = {
    evidenceBoundary: `Accepted evidence from runtime revision ${runtimeRevision.id}.`,
    claimRestrictions: ['Do not create facts or upgrade certainty beyond the approved meaning and its accepted evidence.'],
    warnings: assetVersion.warnings || [], limitations: assetVersion.limitations || [],
  }
  return prepareRender({ assetVersion, runtimeRevision,
    outputContract: { outputTypeKey: context.outputType.key, outputSchemaKey: context.outputSchema.key,
      styleKey: context.style?.key || style.packKey, audience: plan.payload.consumerIntent.audience.join(', ') },
    stylePackReceipt, visualSystemPackReceipt, evidenceReferences, governanceMarkers,
    visualIntent: { layoutPattern: 'DOCUMENT', components: [] }, format: 'MARKDOWN' })
}

export const readCommittedGovernedApproval = async ({ scope, sessionId, draftId, expectedChain, dbSession = null }) => {
  const draft = await read(OutcomeDraft.findOne({ ...scope, sessionId, draftId }), dbSession)
  if (!draft || draft.status !== 'APPROVED') return null
  const iteration = await read(OutcomeDraftIteration.findOne({ ...scope, sessionId, draftId,
    draftIterationId: draft.approvedIterationId }), dbSession)
  const version = await read(OutcomeAssetVersion.findOne({ ...scope, sessionId, outcomeAssetVersionId: draft.approvedAssetVersionId }), dbSession)
  const asset = version ? await read(OutcomeAsset.findOne({ ...scope, sessionId, outcomeAssetId: version.outcomeAssetId }), dbSession) : null
  const renderOutput = version ? await read(OutcomeRenderOutput.findOne({ ...scope, outcomeAssetId: version.outcomeAssetId,
    outcomeAssetVersionId: version.outcomeAssetVersionId,
    renderOutputId: version.lineageSummary?.governedRender?.renderOutputId, format: 'MARKDOWN', status: 'READY' }), dbSession) : null
  const actualChain = iteration?.lineageSummary?.governedQualityChain
  if (!iteration || iteration.status !== 'APPROVED' || draft.currentIterationId !== draft.approvedIterationId
    || !asset || !version || !renderOutput || asset.currentVersionId !== version.outcomeAssetVersionId
    || version.lineageSummary?.draftApproval?.draftId !== draftId
    || version.lineageSummary?.draftApproval?.draftIterationId !== iteration.draftIterationId
    || hashOutcomeQualityStageValue(actualChain) !== hashOutcomeQualityStageValue(expectedChain || draft.lineageSummary?.governedQualityChain)
    || hashOutcomeQualityStageValue(version.lineageSummary?.governedQualityChain) !== hashOutcomeQualityStageValue(actualChain)
    || renderOutput.renderReceipt?.source?.assetVersionId !== version.outcomeAssetVersionId
    || renderOutput.renderReceipt?.source?.sourceContentChecksum !== renderOutput.sourceContentChecksum
    || version.lineageSummary?.governedRender?.sourceContentChecksum !== renderOutput.sourceContentChecksum
    || version.lineageSummary?.governedRender?.outputChecksum !== renderOutput.artifact?.outputChecksum
    || version.lineageSummary?.governedRender?.iterationContentFingerprint !== hashOutcomeQualityStageValue(iteration.customerContent)
    || version.lineageSummary?.governedRender?.assetContentFingerprint !== hashOutcomeQualityStageValue(version.customerContent)
    || renderOutput.renderReceipt?.validation?.status !== 'PASS') throw governedFinalisationConflict('OUTCOME_GOVERNED_APPROVAL_WINNER_INCOMPLETE')
  return { draft, iteration, asset, version, renderOutput }
}

export const governedApprovalScope = scopeOf
