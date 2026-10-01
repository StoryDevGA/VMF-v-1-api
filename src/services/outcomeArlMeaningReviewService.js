import { assertRuntimeEvidenceToMeaningReady, runtimeEvidenceStageDependencies,
  readRuntimeEvidenceToMeaningProviderProjection } from './outcomeRuntimeEvidenceToMeaningService.js'
import { assertEvidenceToMeaningBoundedProviderOutput } from './outcomeEvidenceToMeaningProviderService.js'
import mongoose from 'mongoose'

import {
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import {
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertLegacyOutcomeKnowledgeCompositionPlan,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
  assertOutcomeQualityStageTransactionSupport,
} from './outcomeQualityStageExecutionService.js'
import { assertRuntimePermission } from './runtimeInstanceService.js'
import { normalizeOutcomeArlProviderReview } from './outcomeArlReviewContract.js'
import { createGovernedReasoningExecution } from './governedReasoningRuntimeService.js'
import { loadOutcomeMethodDocument } from './outcomeMethodDocumentService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { resolveKnowledgePackBoundary } from '../constants/knowledgeRuntime.js'
import {
  assertOutcomeArlMeaningReviewProviderSafeContext,
  buildOutcomeArlMeaningReviewProviderSafeContext,
} from './outcomeArlMeaningReviewProviderSafeContextService.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const REQUIRED_DIMENSIONS = Object.freeze([
  'ANALYTICAL_STRENGTH',
  'COHERENCE',
  'PRIORITISATION',
  'EVIDENCE_USE',
  'DECISION_USEFULNESS',
])

const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const toId = (value) => value?.toString ? value.toString() : text(value)
const toPlain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const execQuery = async (query) => (typeof query?.lean === 'function' ? query.lean() : query)

const error = (message, details = {}) => Object.assign(new Error(message), {
  status: 409,
  code: 'OUTCOME_ARL_MEANING_REVIEW_INVALID',
  details: { reason: 'OUTCOME_ARL_MEANING_REVIEW_INVALID', ...details },
})

const readLatest = ({ model, filter, sort }) => {
  const query = model.findOne(filter)
  return execQuery(typeof query?.sort === 'function' ? query.sort(sort) : query)
}

const planScope = (requestBinding) => requestBinding
  ? { requestId: requestBinding.requestId }
  : { requestId: { $exists: false } }

const stageScope = (requestBinding) => requestBinding
  ? {
      requestId: requestBinding.requestId,
      draftId: requestBinding.draftId,
      draftIterationId: requestBinding.draftIterationId,
    }
  : { requestId: { $exists: false } }

const assertCurrentPlan = ({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint, requestBinding }) => {
  let selected
  let latest
  try {
    selected = requestBinding
      ? assertOutcomeKnowledgeCompositionPlanIntegrity(selectedPlan)
      : assertLegacyOutcomeKnowledgeCompositionPlan(selectedPlan)
    latest = requestBinding
      ? assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
      : assertLegacyOutcomeKnowledgeCompositionPlan(latestPlan)
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(selected, runtime)
  } catch {
    throw error('The current Knowledge Composition Plan is unavailable or stale.')
  }
  if (toId(selected.runtimeInstanceId) !== toId(runtimeInstanceId)
    || lower(selected.planFingerprint) !== lower(expectedPlanFingerprint)
    || (requestBinding && text(selected.requestId) !== requestBinding.requestId)
    || toId(selected._id || selected.id) !== toId(latest._id || latest.id)
    || text(selected.planId) !== text(latest.planId)
    || Number(selected.planVersion) !== Number(latest.planVersion)
    || lower(selected.planFingerprint) !== lower(latest.planFingerprint)) {
    throw error('The selected Knowledge Composition Plan is not current.')
  }
  return selected
}

const assertWorkingDraft = ({ sourceStage, plan, runtimeInstanceId }) => {
  const source = toPlain(sourceStage)
  if (!source
    || source.stageKey !== OUTCOME_QUALITY_STAGES.WORKING_DRAFT
    || source.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || Number(source.stageOrder) !== 2
    || toId(source.runtimeInstanceId) !== toId(runtimeInstanceId)
    || text(source.planId) !== text(plan.planId)
    || lower(source.planFingerprint) !== lower(plan.planFingerprint)
    || !SHA256_PATTERN.test(lower(source.attemptFingerprint))
    || !SHA256_PATTERN.test(lower(source.outputFingerprint))
    || hashOutcomeQualityStageValue(source.outputSnapshot) !== lower(source.outputFingerprint)) {
    throw error('ARL requires the exact successful Working Draft predecessor.')
  }
  if (plan.payload.evidenceToMeaning) {
    const projection = readRuntimeEvidenceToMeaningProviderProjection(plan)
    if (projection) assertEvidenceToMeaningBoundedProviderOutput({ projection, output: source.outputSnapshot })
  }
  return source
}

export const buildOutcomeArlMeaningReviewOutput = ({ plan, sourceStageExecution, providerReview }) => {
  if (plan.requestId && !providerReview) throw error('ARL requires an actual provider review.')
  const review = providerReview ? normalizeOutcomeArlProviderReview(providerReview) : null
  if (review && review.overallStatus !== 'PASS') {
    throw error('ARL requires changes to the Working Draft.', { reason: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' })
  }
  const source = assertWorkingDraft({
    sourceStage: sourceStageExecution,
    plan,
    runtimeInstanceId: plan.runtimeInstanceId,
  })
  const truthReferences = (plan.payload?.lockedTruth?.acceptedSections || [])
    .map((section) => lower(section.sectionKey))
  const stage = (plan.payload?.stagePlan || [])
    .find((entry) => entry.stageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW)
  const contributingActivationIds = [...new Set(stage?.assignedActivationIds || [])].sort()
  if (truthReferences.length < 1 || contributingActivationIds.length < 1) {
    throw error('ARL truth or Knowledge Pack assignment is incomplete.')
  }
  const decisionLogicFingerprint = hashOutcomeQualityStageValue(source.outputSnapshot.decisionLogic)
  const meaningFingerprint = hashOutcomeQualityStageValue({
    workingDraftStageExecutionId: source.stageExecutionId,
    workingDraftOutputFingerprint: source.outputFingerprint,
    decisionLogicFingerprint,
  })
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
    schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
    workingDraftStageExecutionId: source.stageExecutionId,
    workingDraftOutputFingerprint: lower(source.outputFingerprint),
    findings: REQUIRED_DIMENSIONS.map((dimension) => ({
      findingKey: `${dimension.toLowerCase()}_confirmed`,
      dimension,
      severity: 'LOW',
      finding: review
        ? review.findings.find((finding) => finding.dimension === dimension).finding
        : `${dimension.replaceAll('_', ' ')} is supported by the governed Working Draft and retained evidence boundaries.`,
      requiredChange: false,
      disposition: 'ACCEPTED_NO_CHANGE',
      changeApplied: false,
    })),
    approvedMeaning: {
      state: 'APPROVED',
      version: Number(source.outputSnapshot.draftVersion || 1),
      workingDraftStageExecutionId: source.stageExecutionId,
      workingDraftOutputFingerprint: lower(source.outputFingerprint),
      meaningSummary: 'The governed Working Draft meaning and decision logic satisfy the required ARL dimensions and are approved for narrative planning.',
      decisionLogic: source.outputSnapshot.decisionLogic,
      meaningFingerprint,
      decisionLogicFingerprint,
    },
    truthReferences,
    contributingActivationIds,
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const buildRequestBindingFingerprint = ({ plan, sourceStage, methodDocument }) => hashOutcomeQualityStageValue({
  targetStage: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
  targetAttemptNumber: 1,
  planId: plan.planId,
  planVersion: plan.planVersion,
  planFingerprint: plan.planFingerprint,
  sourceStageExecutionId: sourceStage.stageExecutionId,
  sourceAttemptFingerprint: sourceStage.attemptFingerprint,
  sourceOutputFingerprint: sourceStage.outputFingerprint,
  methodSource: methodDocument.source,
  providerConfigurationVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION,
  providerContextVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
})

const executeRequestArl = async ({
  actorUserId,
  auditRequest,
  expectedPlanFingerprint,
  plan,
  planRecordId,
  providerAdapter,
  providerDescriptor,
  requestBinding,
  runtime,
  runtimeInstanceId,
  scopes,
  sourceStage,
  existingArl,
  deps,
}) => {
  const configVersion = OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION
  if (typeof providerAdapter !== 'function'
    || providerAdapter.configurationVersion !== configVersion
    || lower(providerDescriptor?.providerKey) !== 'openai'
    || text(providerDescriptor?.model) !== 'gpt-5.2'
    || providerDescriptor?.providerMode !== 'LIVE_TEST'
    || providerDescriptor?.environment !== 'TEST'
    || providerDescriptor?.failurePosture !== 'FAIL_CLOSED'
    || providerDescriptor?.safeContextPolicyKey !== 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1') {
    throw error('ARL review provider is not configured.', { reason: 'STAGE_PROVIDER_NOT_CONFIGURED' })
  }
  ;(deps.assertOutcomeQualityStageTransactionSupport || assertOutcomeQualityStageTransactionSupport)(deps.mongoose || mongoose)
  if (sourceStage.requestId !== requestBinding.requestId
    || sourceStage.draftId !== requestBinding.draftId
    || sourceStage.draftIterationId !== requestBinding.draftIterationId) {
    throw error('ARL draft binding is invalid.')
  }
  const assignment = plan.payload.stagePlan.find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW)
  const assigned = assignment?.assignedActivationIds || []
  const matches = plan.payload.resolution.selectedPacks.filter((pack) => assigned.includes(pack.activationId))
  const selected = matches[0]
  if (assignment?.order !== 3 || assigned.length !== 1 || matches.length !== 1
    || selected?.packType !== 'ARL'
    || !selected.stageAssignments?.includes(OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW)
    || resolveKnowledgePackBoundary(selected) !== 'GENERATION_CONTEXT'
    || !['ACTIVE'].includes(selected.lifecycleStatus || selected.status)) {
    throw error('ARL method binding is invalid.')
  }
  const pack = { ...selected, status: 'ACTIVE', boundary: 'GENERATION_CONTEXT' }
  const methodDocument = await loadOutcomeMethodDocument({
    role: 'ARL',
    selection: pack,
    loadPackContent: deps.loadPackContent || loadOutcomeKnowledgePackVersionContent,
  })
  if (existingArl) {
    if (existingArl.planFingerprint !== plan.planFingerprint
      || existingArl.predecessorStageExecutionId !== sourceStage.stageExecutionId
      || existingArl.predecessorAttemptFingerprint !== sourceStage.attemptFingerprint
      || existingArl.requestId !== requestBinding.requestId
      || existingArl.draftId !== requestBinding.draftId
      || existingArl.draftIterationId !== requestBinding.draftIterationId
      || existingArl.executionIdentity?.providerConfigurationVersion !== configVersion) {
      throw error('ARL history is not reusable.')
    }
    return { idempotent: true, stage: serializeOutcomeQualityStageExecution(existingArl) }
  }
  const bindingFingerprint = buildRequestBindingFingerprint({ plan, sourceStage, methodDocument })
  const providerInput = {
    customerPrompt: text(plan.payload.consumerIntent.originalRequest),
    currentDraftMarkdown: '',
    request: {
      intentType: 'ARL_MEANING_REVIEW',
      refinement: false,
      outputTypeKey: 'ARL_MEANING_REVIEW',
      outputTypeLabel: 'ARL Meaning Review',
      outputSchemaKey: 'fs-003-arl-meaning-review-v0-2',
      requiredSections: [...REQUIRED_DIMENSIONS],
      styleKey: 'meaning-review',
      styleLabel: 'Meaning review',
      requestedOutputTypeKey: 'arl-meaning-review',
      requestedStyleKey: 'meaning-review',
      workspaceType: 'PLATFORM',
    },
  }
  const knowledgeFacade = {
    manifest: {
      sourceType: 'KNOWLEDGE_COMPOSITION_PLAN',
      policyKey: plan.payload.resolution.policyKey,
      policyVersion: plan.payload.resolution.policyVersion,
      manifestId: plan.planId,
      manifestKey: 'arl-meaning-review',
      manifestName: 'ARL Meaning Review',
      semanticVersion: String(plan.planVersion),
      status: 'ACTIVE',
    },
    binding: {
      status: 'READY',
      mode: 'KCP_ARL_MEANING_REVIEW_STAGE_BINDING',
      requiredPacks: [pack],
      optionalPacks: [],
      validationPacks: [],
      providerContextPacks: [pack],
      preValidationPacks: [],
      postValidationPacks: [],
      systemOnlyPacks: [],
      selectedByLayer: { [pack.knowledgeLayer]: [pack] },
      dependencyGraph: plan.payload.resolution.dependencyGraph || {},
      resolution: {
        status: 'READY',
        activeCount: 1,
        resolvedCount: 1,
        requiredCount: 1,
        optionalCount: 0,
        validationCount: 0,
        blockedCount: 0,
        requestedContextCategories: [],
        policyVersion: plan.payload.resolution.policyVersion,
        request: { requestedOutputTypeKey: 'arl-meaning-review', requestedStyleKey: 'meaning-review' },
      },
      lineage: {
        resolvedAt: new Date(plan.resolvedAt || plan.createdAt).toISOString(),
        activationIds: [pack.activationId],
        versionIds: [pack.versionId],
        contentHashes: [pack.contentHash],
      },
    },
  }
  const startedAt = new Date().toISOString()
  let grr
  let failure
  try {
    grr = await (deps.createGovernedReasoningExecution || createGovernedReasoningExecution)({
      actorUserId,
      auditRequest,
      runtimeInstanceId,
      scopes,
      payload: {
        outputTypeKey: 'ARL_MEANING_REVIEW',
        requestedOutputTypeKey: 'arl-meaning-review',
        requestedStyleKey: 'meaning-review',
        executionIntent: 'Review the immutable Working Draft meaning without applying changes.',
        idempotencyKey: `ARL_MEANING_REVIEW:${plan.planId}:v${plan.planVersion}:${bindingFingerprint.slice(0, 24)}`,
        workspaceType: 'PLATFORM',
        manifestId: plan.planId,
      },
      deps: {
        executionMode: 'LIVE_TEST',
        providerAdapter,
        providerDescriptor,
        providerInput,
        resolveKnowledgeBinding: async () => knowledgeFacade,
        buildProviderSafeContext: async (contextArgs) => buildOutcomeArlMeaningReviewProviderSafeContext({
          ...contextArgs,
          methodDocument,
          methodSelection: pack,
          sourceStageExecution: sourceStage,
          evidenceToMeaning: readRuntimeEvidenceToMeaningProviderProjection(plan),
          targetStageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
        }),
        assertProviderSafeContext: assertOutcomeArlMeaningReviewProviderSafeContext,
        providerContextContractVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
        providerContextBindingFingerprint: bindingFingerprint,
      },
    })
  } catch (cause) {
    if (cause?.code !== 'OUTCOME_ARL_MEANING_REVIEW_PROVIDER_FAILED') throw cause
    failure = {
      failureCode: cause.details?.reason || 'ARL_MEANING_REVIEW_PROVIDER_REQUEST_FAILED',
      safeReason: 'ARL meaning review could not be completed.',
      retryable: /_(TIMEOUT|NETWORK_FAILED|TRANSIENT_FAILURE|REQUEST_FAILED)$/.test(cause.details?.reason || ''),
    }
  }
  let output
  if (grr) {
    const review = normalizeOutcomeArlProviderReview(grr.artifact?.generatedOutput)
    if (review.overallStatus === 'FAIL') {
      failure = {
        failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE',
        safeReason: 'ARL meaning review requires changes to the Working Draft.',
        retryable: false,
      }
    } else {
      output = buildOutcomeArlMeaningReviewOutput({ plan, sourceStageExecution: sourceStage, providerReview: review })
    }
  }
  const args = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: sourceStage.stageExecutionId,
    predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
    sourceStageExecution: sourceStage,
    status: failure ? OUTCOME_QUALITY_STAGE_STATUSES.FAILED : OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    ...(failure ? { failure } : { output }),
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(providerDescriptor.providerKey),
      providerConfigurationVersion: configVersion,
      model: text(providerDescriptor.model),
      grrExecutionId: text(grr?.executionId),
      grrRuntimeArtifactId: text(grr?.artifact?.runtimeArtifactId),
      runtimeVersion: new Date(runtime.updatedAt).toISOString(),
    },
    startedAt,
    completedAt: new Date().toISOString(),
    requestBinding,
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(args)
  const result = await (deps.createOutcomeQualityStageExecution || createOutcomeQualityStageExecution)({
    planRecordId,
    runtimeInstanceId,
    expectedPlanFingerprint,
    ...args,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId,
    requestBinding,
    deps: runtimeEvidenceStageDependencies(deps),
    scopes,
  })
  return { idempotent: result.idempotent, stage: result.execution }
}

export const approveOutcomeWorkingDraftMeaning = async ({
  actorUserId,
  auditRequest,
  expectedPlanFingerprint,
  planRecordId,
  runtimeInstanceId,
  scopes,
  requestBinding,
  providerAdapter,
  providerDescriptor,
  deps = {},
} = {}) => {
  if (!mongoose.isValidObjectId(actorUserId)
    || !mongoose.isValidObjectId(planRecordId)
    || !mongoose.isValidObjectId(runtimeInstanceId)
    || !SHA256_PATTERN.test(lower(expectedPlanFingerprint))) {
    throw error('ARL governed identity is invalid.')
  }
  const models = {
    OutcomeKnowledgeCompositionPlan: deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    OutcomeQualityStageExecution: deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution,
    RuntimeInstance: deps.RuntimeInstance || RuntimeInstance,
  }
  const [selectedPlan, latestPlan, runtime] = await Promise.all([
    execQuery(models.OutcomeKnowledgeCompositionPlan.findOne({ _id: planRecordId, runtimeInstanceId, ...planScope(requestBinding) })),
    readLatest({ model: models.OutcomeKnowledgeCompositionPlan, filter: { runtimeInstanceId, ...planScope(requestBinding) }, sort: { planVersion: -1 } }),
    execQuery(models.RuntimeInstance.findOne({ _id: runtimeInstanceId })),
  ])
  if (!selectedPlan || !latestPlan || !runtime) throw error('ARL source records are unavailable.')
  const plan = assertCurrentPlan({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint, requestBinding })
  await assertRuntimeEvidenceToMeaningReady({ plan, scopes, deps })
  await (deps.assertRuntimePermission || assertRuntimePermission)({
    actorUserId,
    scopes,
    customerId: toId(plan.customerId),
    tenantId: toId(plan.tenantId),
    permission: 'VMF_UPDATE',
  })
  const [sourceRecord, existingArl] = await Promise.all([
    readLatest({
      model: models.OutcomeQualityStageExecution,
      filter: {
        runtimeInstanceId,
        planId: plan.planId,
        ...stageScope(requestBinding),
        stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: models.OutcomeQualityStageExecution,
      filter: {
        runtimeInstanceId,
        planId: plan.planId,
        ...stageScope(requestBinding),
        stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      },
      sort: { attemptNumber: -1 },
    }),
  ])
  const sourceStage = assertWorkingDraft({ sourceStage: sourceRecord, plan, runtimeInstanceId })
  if (requestBinding) {
    return executeRequestArl({
      actorUserId,
      auditRequest,
      expectedPlanFingerprint,
      plan,
      planRecordId,
      providerAdapter,
      providerDescriptor,
      requestBinding,
      runtime,
      runtimeInstanceId,
      scopes,
      sourceStage,
      existingArl,
      deps,
    })
  }
  if (existingArl) {
    if (existingArl.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
      || existingArl.predecessorStageExecutionId !== sourceStage.stageExecutionId) {
      throw error('Existing ARL stage history is not reusable.')
    }
    return { idempotent: true, stage: serializeOutcomeQualityStageExecution(existingArl) }
  }
  const output = buildOutcomeArlMeaningReviewOutput({ plan, sourceStageExecution: sourceStage })
  const startedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  const executionIdentity = {
    executionMode: 'INTERNAL_GOVERNED',
    providerKey: '',
    providerConfigurationVersion: '',
    model: '',
    grrExecutionId: '',
    grrRuntimeArtifactId: '',
    runtimeVersion: new Date(runtime.updatedAt).toISOString(),
  }
  const args = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: sourceStage.stageExecutionId,
    predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
    sourceStageExecution: sourceStage,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity,
    startedAt,
    completedAt,
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(args)
  const createStage = deps.createOutcomeQualityStageExecution || createOutcomeQualityStageExecution
  const result = await createStage({
    planRecordId: toId(plan._id || plan.id),
    runtimeInstanceId,
    expectedPlanFingerprint,
    ...args,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId,
    deps: runtimeEvidenceStageDependencies(deps),
    scopes,
  })
  return { idempotent: result.idempotent, stage: result.execution }
}

export default {
  approveOutcomeWorkingDraftMeaning,
  buildOutcomeArlMeaningReviewOutput,
}
