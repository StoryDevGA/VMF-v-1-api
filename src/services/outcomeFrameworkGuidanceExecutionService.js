import mongoose from 'mongoose'

import {
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import {
  GovernedReasoningExecution,
  GovernedRuntimeArtifact,
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import {
  createGovernedReasoningExecution,
  resolveLiveTestConfiguration,
} from './governedReasoningRuntimeService.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
  resolveOutcomeAcceptedTruthSectionIdentity,
} from './outcomeKnowledgeCompositionPlanService.js'
import {
  assertOutcomeQualityStageTransactionSupport,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
} from './outcomeQualityStageExecutionService.js'
import { buildOutcomeFrameworkGuidanceProviderSafeContext } from './outcomeStudioProviderSafeContextService.js'
import {
  getRuntimeSectionAccepted,
  isRuntimeSectionObject,
} from './runtimeSectionModelService.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const SUCCESS_STATUS = OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
const RETRYABLE_STAGE_STATUSES = new Set([
  OUTCOME_QUALITY_STAGE_STATUSES.BLOCKED,
  OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
])
const PROVIDER_FAILURE_REASONS = new Set([
  'FRAMEWORK_GUIDANCE_PROVIDER_REQUEST_FAILED',
  'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID',
  'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INCOMPLETE',
  'FRAMEWORK_GUIDANCE_PROVIDER_REFUSED',
  'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_TOO_LARGE',
  'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_MISSING',
  'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
  'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT',
  'FRAMEWORK_GUIDANCE_PROVIDER_NETWORK_FAILED',
  'FRAMEWORK_GUIDANCE_PROVIDER_TRANSIENT_FAILURE',
  'FRAMEWORK_GUIDANCE_PROVIDER_REJECTED',
])
const RETRYABLE_PROVIDER_FAILURES = new Set([
  'FRAMEWORK_GUIDANCE_PROVIDER_REQUEST_FAILED',
  'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT',
  'FRAMEWORK_GUIDANCE_PROVIDER_NETWORK_FAILED',
  'FRAMEWORK_GUIDANCE_PROVIDER_TRANSIENT_FAILURE',
])
const OUTPUT_INVALID_FAILURE = 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID'
const REPAIRED_OUTPUT_PROVIDER_CONFIG_VERSIONS = new Set([
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
])

const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()
const toId = (value) => value?.toString ? value.toString() : text(value)
const toIso = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}
const toPlain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value

const appError = (status, code, message, details = {}) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = { reason: code, ...details }
  return error
}

const invalid = (details) => appError(
  422,
  'OUTCOME_FRAMEWORK_GUIDANCE_EXECUTION_INVALID',
  'Framework and guidance execution input is invalid.',
  details,
)
const bindingInvalid = (details) => appError(
  409,
  'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID',
  'Framework and guidance execution does not match the current Knowledge Composition Plan.',
  details,
)
const stageHistoryInvalid = (details) => appError(
  409,
  'OUTCOME_FRAMEWORK_GUIDANCE_STAGE_HISTORY_INVALID',
  'Framework and guidance stage history is not eligible for execution.',
  details,
)
const lineageInvalid = (details) => appError(
  409,
  'OUTCOME_FRAMEWORK_GUIDANCE_LINEAGE_INVALID',
  'Framework and guidance execution lineage is incomplete or inconsistent.',
  details,
)

const execQuery = async (query) => (typeof query?.lean === 'function' ? query.lean() : query)

const readSelectedPlan = ({ model, planRecordId, runtimeInstanceId }) => execQuery(
  model.findOne({ _id: planRecordId, runtimeInstanceId }),
)
const readLatestPlan = ({ model, runtimeInstanceId }) => {
  const query = model.findOne({ runtimeInstanceId })
  return execQuery(typeof query?.sort === 'function' ? query.sort({ planVersion: -1 }) : query)
}
const readRuntime = ({ model, runtimeInstanceId }) => execQuery(model.findOne({ _id: runtimeInstanceId }))
const readLatestStage = ({ model, runtimeInstanceId, planId }) => {
  const query = model.findOne({
    runtimeInstanceId,
    planId,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
  })
  return execQuery(typeof query?.sort === 'function' ? query.sort({ attemptNumber: -1 }) : query)
}

const assertCurrentPlan = ({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint }) => {
  let selected
  let latest
  try {
    selected = assertOutcomeKnowledgeCompositionPlanIntegrity(selectedPlan)
    latest = assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(selected, runtime)
  } catch (error) {
    throw bindingInvalid({ causeCode: error?.code || '' })
  }
  if (toId(selected.runtimeInstanceId) !== toId(runtimeInstanceId)
    || lower(selected.planFingerprint) !== lower(expectedPlanFingerprint)
    || toId(selected._id || selected.id) !== toId(latest._id || latest.id)
    || text(selected.planId) !== text(latest.planId)
    || Number(selected.planVersion) !== Number(latest.planVersion)
    || lower(selected.planFingerprint) !== lower(latest.planFingerprint)
    || lower(selected.resolutionFingerprint) !== lower(latest.resolutionFingerprint)
    || lower(selected.contextFingerprint) !== lower(latest.contextFingerprint)) {
    throw bindingInvalid({ field: 'currentPlan' })
  }
  return selected
}

const valueAtPath = (source, path) => text(path).split('.').filter(Boolean).reduce(
  (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
  source,
)

const acceptedContent = (value) => {
  if (typeof value === 'string') return text(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of ['content', 'summary', 'value']) {
    if (typeof value[key] === 'string' && text(value[key])) return text(value[key])
  }
  return ''
}

const resolveAcceptedTruthBinding = ({ plan, runtime, section }) => {
  let identity
  try {
    identity = resolveOutcomeAcceptedTruthSectionIdentity({
      lockedTruth: plan.payload?.lockedTruth,
      section,
    })
  } catch (error) {
    throw bindingInvalid({ field: 'acceptedTruthIdentity', causeCode: error?.code || '' })
  }
  const sectionRootPath = `framework_state.sections.${identity.stateSectionKey}`
  const sectionRoot = valueAtPath(runtime, sectionRootPath)
  if (!isRuntimeSectionObject(sectionRoot)) {
    throw bindingInvalid({ field: 'acceptedTruthRoot', sectionKey: identity.sectionKey })
  }
  const accepted = getRuntimeSectionAccepted(sectionRoot)
  if (!accepted || typeof accepted !== 'object' || Array.isArray(accepted)) {
    throw bindingInvalid({ field: 'acceptedTruthContent', sectionKey: identity.sectionKey })
  }
  if (lower(accepted.sectionKey) !== identity.sectionKey) {
    throw bindingInvalid({ field: 'acceptedTruthSectionKey', sectionKey: identity.sectionKey })
  }
  if (text(accepted.runtimePath) !== identity.runtimePath) {
    throw bindingInvalid({ field: 'acceptedTruthRuntimePath', sectionKey: identity.sectionKey })
  }
  const content = acceptedContent(accepted)
  if (!content) throw bindingInvalid({ field: 'acceptedTruthContent', sectionKey: identity.sectionKey })
  return { sectionKey: identity.sectionKey, content }
}

const buildKcpBinding = ({ plan, runtime }) => {
  const stage = plan.payload?.stagePlan?.find((entry) => (
    upper(entry?.stageKey) === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
  ))
  if (!stage || Number(stage.order) !== 1 || !Array.isArray(stage.assignedActivationIds) || stage.assignedActivationIds.length === 0) {
    throw bindingInvalid({ field: 'stagePlan' })
  }
  const activationIds = stage.assignedActivationIds.map(text)
  if (new Set(activationIds).size !== activationIds.length) throw bindingInvalid({ field: 'assignedActivationIds' })
  const selectedPacks = Array.isArray(plan.payload?.resolution?.selectedPacks)
    ? plan.payload.resolution.selectedPacks
    : []
  const packs = activationIds.map((activationId) => {
    const pack = selectedPacks.find((entry) => text(entry?.activationId) === activationId)
    if (!pack
      || !text(pack.versionId)
      || !CONTENT_HASH_PATTERN.test(lower(pack.contentHash))
      || upper(pack.knowledgeLayer) !== 'VALIDATION'
      || upper(pack.executionMode) !== 'POST_VALIDATION'
      || !Array.isArray(pack.stageAssignments)
      || !pack.stageAssignments.map(upper).includes(OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE)) {
      throw bindingInvalid({ field: 'assignedPack', activationId })
    }
    return {
      activationId,
      versionId: text(pack.versionId),
      contentHash: lower(pack.contentHash),
      packType: upper(pack.packType),
      packKey: lower(pack.packKey),
      semanticVersion: text(pack.semanticVersion),
      label: text(pack.label),
      purposeCategory: upper(pack.purposeCategory),
      knowledgeLayer: upper(pack.knowledgeLayer),
      executionMode: upper(pack.executionMode),
      capabilityKey: lower(pack.capabilityKey),
      workspaceCompatibility: Array.isArray(pack.workspaceCompatibility)
        ? pack.workspaceCompatibility.map(upper)
        : [],
      dependencyReferences: Array.isArray(pack.dependencyReferences)
        ? pack.dependencyReferences
        : [],
      scopeType: upper(pack.scopeType),
      scopeKey: text(pack.scopeKey),
    }
  })
  if (new Set(packs.map(({ versionId }) => versionId)).size !== packs.length) {
    throw bindingInvalid({ field: 'assignedVersionIds' })
  }
  const acceptedSections = Array.isArray(plan.payload?.lockedTruth?.acceptedSections)
    ? plan.payload.lockedTruth.acceptedSections
    : []
  const truthBindings = acceptedSections.map((section) => (
    resolveAcceptedTruthBinding({ plan, runtime, section })
  ))
  if (truthBindings.length === 0
    || new Set(truthBindings.map(({ sectionKey }) => sectionKey)).size !== truthBindings.length) {
    throw bindingInvalid({ field: 'acceptedTruthSections' })
  }
  return {
    stage,
    packs,
    truthBindings,
    truthReferenceKeys: truthBindings.map(({ sectionKey }) => sectionKey),
    activationReferenceIds: packs.map(({ activationId }) => activationId),
  }
}

const buildKnowledgeBindingFacade = ({ plan, binding }) => {
  const packs = binding.packs.map((pack) => ({ ...pack }))
  return {
    manifest: {
      sourceType: 'KNOWLEDGE_COMPOSITION_PLAN',
      policyKey: text(plan.payload?.resolution?.policyKey),
      policyVersion: text(plan.payload?.resolution?.policyVersion),
      manifestId: text(plan.planId),
      manifestKey: 'framework-guidance',
      manifestName: 'Framework guidance',
      semanticVersion: String(plan.planVersion),
      status: 'ACTIVE',
    },
    binding: {
      status: 'READY',
      mode: 'KCP_STAGE_BINDING',
      requiredPacks: packs,
      optionalPacks: [],
      validationPacks: packs,
      providerContextPacks: [],
      preValidationPacks: [],
      postValidationPacks: packs,
      systemOnlyPacks: [],
      selectedByLayer: { VALIDATION: packs },
      dependencyGraph: plan.payload?.resolution?.dependencyGraph || {},
      resolution: {
        status: 'READY',
        activeCount: packs.length,
        resolvedCount: packs.length,
        requiredCount: packs.length,
        optionalCount: 0,
        validationCount: packs.length,
        blockedCount: 0,
        requestedContextCategories: [],
        policyVersion: text(plan.payload?.resolution?.policyVersion),
        request: {
          requestedOutputTypeKey: 'framework-guidance-analysis',
          requestedStyleKey: 'decision-analysis',
        },
      },
      lineage: {
        resolvedAt: toIso(plan.resolvedAt || plan.createdAt),
        activationIds: binding.activationReferenceIds,
        versionIds: packs.map(({ versionId }) => versionId),
        contentHashes: packs.map(({ contentHash }) => contentHash),
      },
    },
  }
}

const buildServerOwnedProviderInput = (plan) => {
  const intent = plan.payload?.consumerIntent || {}
  const customerPrompt = [
    `Outcome: ${text(intent.outcome)}`,
    `Decision purpose: ${text(intent.decisionPurpose)}`,
    `Consumer: ${text(intent.consumer)}`,
    `Audience: ${(intent.audience || []).map(text).filter(Boolean).join(', ')}`,
    `Requirements: ${(intent.requirements || []).map(text).filter(Boolean).join('; ') || 'None specified'}`,
  ].join('\n')
  return {
    customerPrompt,
    currentDraftMarkdown: '',
    request: {
      intentType: 'FRAMEWORK_GUIDANCE_ANALYSIS',
      refinement: false,
      outputTypeKey: 'FRAMEWORK_GUIDANCE_ANALYSIS',
      outputTypeLabel: 'Framework and guidance analysis',
      outputSchemaKey: 'framework-guidance-analysis-v1',
      requiredSections: ['analysis', 'implications', 'recommendations', 'qualification', 'assumptions', 'gaps'],
      styleKey: 'decision-analysis',
      styleLabel: 'Decision analysis',
      requestedOutputTypeKey: 'framework-guidance-analysis',
      requestedStyleKey: 'decision-analysis',
      workspaceType: 'PLATFORM',
    },
  }
}

const buildPreflightCandidate = ({ plan, runtimeInstanceId, expectedPlanFingerprint, latest, runtimeVersion }) => buildOutcomeQualityStageExecutionCandidate({
  plan,
  runtimeInstanceId,
  expectedPlanFingerprint,
  stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
  expectedLatestAttemptNumber: Number(latest?.attemptNumber || 0),
  predecessorStageExecutionId: latest?.stageExecutionId || '',
  predecessorAttemptFingerprint: latest?.attemptFingerprint || '',
  status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
  failure: {
    failureCode: 'FRAMEWORK_GUIDANCE_PREFLIGHT_ONLY',
    safeReason: 'Framework and guidance execution preflight.',
    retryable: true,
  },
  executionIdentity: {
    executionMode: 'LIVE_TEST',
    providerKey: '',
    providerConfigurationVersion: '',
    model: '',
    grrExecutionId: '',
    grrRuntimeArtifactId: '',
    runtimeVersion,
  },
  startedAt: runtimeVersion,
  completedAt: runtimeVersion,
})

const assertRetryHistory = (
  latest,
  planFingerprint,
  providerConfigurationVersion,
  providerDescriptor,
) => {
  if (!latest) return
  if (lower(latest.planFingerprint) !== lower(planFingerprint)) throw stageHistoryInvalid({ field: 'planFingerprint' })
  if (latest.status === SUCCESS_STATUS) return
  const predecessorProviderConfigurationVersion = text(
    latest.executionIdentity?.providerConfigurationVersion,
  ) || (latest.failure?.failureCode === OUTPUT_INVALID_FAILURE
    ? OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1
    : '')
  const exactProviderIdentity = lower(latest.executionIdentity?.providerKey)
      === lower(providerDescriptor.providerKey)
    && text(latest.executionIdentity?.model) === text(providerDescriptor.model)
  const recoverableOutputInvalidFailure = latest.status === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    && latest.failure?.failureCode === OUTPUT_INVALID_FAILURE
    && latest.failure?.retryable === false
    && text(latest.stageExecutionId)
    && SHA256_PATTERN.test(lower(latest.attemptFingerprint))
    && exactProviderIdentity
  const legacyProviderContractRecovery = recoverableOutputInvalidFailure
    && predecessorProviderConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1
    && REPAIRED_OUTPUT_PROVIDER_CONFIG_VERSIONS.has(providerConfigurationVersion)
    && predecessorProviderConfigurationVersion !== providerConfigurationVersion
  const safeOutputDiagnosticsRecovery = recoverableOutputInvalidFailure
    && predecessorProviderConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND
    && providerConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS
  const semanticClaimCalibrationRecovery = recoverableOutputInvalidFailure
    && predecessorProviderConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS
    && providerConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION
  const arlBoundaryDiagnosticsRecovery = recoverableOutputInvalidFailure
    && predecessorProviderConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION
    && providerConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS
  const providerContractRecovery = legacyProviderContractRecovery
    || safeOutputDiagnosticsRecovery
    || semanticClaimCalibrationRecovery
    || arlBoundaryDiagnosticsRecovery
  if (!RETRYABLE_STAGE_STATUSES.has(latest.status)
    || (latest.failure?.retryable !== true && !providerContractRecovery)
    || !text(latest.stageExecutionId)
    || !SHA256_PATTERN.test(lower(latest.attemptFingerprint))) {
    throw stageHistoryInvalid({ field: 'retryPredecessor' })
  }
}

const assertExistingSuccessLineage = async ({ latest, runtimeInstanceId, models, providerDescriptor }) => {
  const identity = latest.executionIdentity || {}
  if (!text(identity.grrExecutionId)
    || !text(identity.grrRuntimeArtifactId)
    || lower(identity.providerKey) !== lower(providerDescriptor.providerKey)
    || text(identity.model) !== text(providerDescriptor.model)) throw lineageInvalid({ field: 'executionIdentity' })
  const [execution, artifact] = await Promise.all([
    execQuery(models.GovernedReasoningExecution.findOne({
      executionId: identity.grrExecutionId,
      runtimeInstanceId,
    })),
    execQuery(models.GovernedRuntimeArtifact.findOne({
      runtimeArtifactId: identity.grrRuntimeArtifactId,
      executionId: identity.grrExecutionId,
      runtimeInstanceId,
    })),
  ])
  if (!execution
    || !artifact
    || upper(execution.status) !== 'COMPLETED'
    || upper(artifact.status) !== 'GENERATED'
    || lower(execution.provider?.providerKey) !== lower(providerDescriptor.providerKey)
    || text(execution.provider?.model) !== text(providerDescriptor.model)
    || hashOutcomeQualityStageValue(artifact.generatedOutput) !== lower(latest.outputFingerprint)) {
    throw lineageInvalid({ field: 'persistedGrrLineage' })
  }
  return {
    idempotent: true,
    grr: {
      executionId: identity.grrExecutionId,
      runtimeArtifactId: identity.grrRuntimeArtifactId,
    },
    stage: serializeOutcomeQualityStageExecution(latest),
  }
}

const providerFailure = (error) => error?.code === 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED'
  && PROVIDER_FAILURE_REASONS.has(error?.details?.reason)

const persistProviderFailure = async ({
  error,
  plan,
  runtimeInstanceId,
  expectedPlanFingerprint,
  latest,
  providerDescriptor,
  providerConfigurationVersion,
  runtimeVersion,
  startedAt,
  actorUserId,
  createStage,
  stageDeps,
}) => {
  const completedAt = new Date().toISOString()
  const failureReason = error.details.reason
  const args = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: Number(latest?.attemptNumber || 0),
    predecessorStageExecutionId: latest?.stageExecutionId || '',
    predecessorAttemptFingerprint: latest?.attemptFingerprint || '',
    status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
    failure: {
      failureCode: failureReason,
      safeReason: 'The governed framework and guidance provider did not complete this attempt.',
      retryable: RETRYABLE_PROVIDER_FAILURES.has(failureReason),
    },
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(providerDescriptor.providerKey),
      providerConfigurationVersion,
      model: text(providerDescriptor.model),
      grrExecutionId: '',
      grrRuntimeArtifactId: '',
      runtimeVersion,
    },
    startedAt,
    completedAt,
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(args)
  const result = await createStage({
    planRecordId: toId(plan._id || plan.id),
    runtimeInstanceId,
    expectedPlanFingerprint,
    ...args,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId,
    deps: stageDeps,
  })
  return { idempotent: result.idempotent, grr: null, stage: result.execution }
}

export const executeOutcomeFrameworkGuidance = async ({
  actorUserId,
  auditRequest,
  expectedPlanFingerprint,
  planRecordId,
  providerAdapterFactory,
  providerDescriptor,
  runtimeInstanceId,
  scopes,
  deps = {},
} = {}) => {
  if (!mongoose.isValidObjectId(actorUserId)
    || !mongoose.isValidObjectId(planRecordId)
    || !mongoose.isValidObjectId(runtimeInstanceId)
    || !SHA256_PATTERN.test(lower(expectedPlanFingerprint))
    || typeof providerAdapterFactory !== 'function') throw invalid({ field: 'identity' })
  resolveLiveTestConfiguration({
    executionMode: 'LIVE_TEST',
    providerAdapter: async () => {},
    providerDescriptor,
  })
  const models = {
    OutcomeKnowledgeCompositionPlan: deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    OutcomeQualityStageExecution: deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution,
    RuntimeInstance: deps.RuntimeInstance || RuntimeInstance,
    GovernedReasoningExecution: deps.GovernedReasoningExecution || GovernedReasoningExecution,
    GovernedRuntimeArtifact: deps.GovernedRuntimeArtifact || GovernedRuntimeArtifact,
  }
  const mongooseClient = deps.mongoose || mongoose
  const assertStageTopology = deps.assertOutcomeQualityStageTransactionSupport
    || assertOutcomeQualityStageTransactionSupport
  assertStageTopology(mongooseClient)
  const [selectedPlan, latestPlan, runtime] = await Promise.all([
    readSelectedPlan({ model: models.OutcomeKnowledgeCompositionPlan, planRecordId, runtimeInstanceId }),
    readLatestPlan({ model: models.OutcomeKnowledgeCompositionPlan, runtimeInstanceId }),
    readRuntime({ model: models.RuntimeInstance, runtimeInstanceId }),
  ])
  if (!selectedPlan || !latestPlan || !runtime) throw bindingInvalid({ field: 'recordOrRuntime' })
  const plan = assertCurrentPlan({
    selectedPlan,
    latestPlan,
    runtime,
    runtimeInstanceId,
    expectedPlanFingerprint,
  })
  const latest = toPlain(await readLatestStage({
    model: models.OutcomeQualityStageExecution,
    runtimeInstanceId,
    planId: plan.planId,
  }))
  if (latest && lower(latest.planFingerprint) !== lower(plan.planFingerprint)) {
    throw stageHistoryInvalid({ field: 'planFingerprint' })
  }
  if (latest?.status === SUCCESS_STATUS) {
    return assertExistingSuccessLineage({ latest, runtimeInstanceId, models, providerDescriptor })
  }
  const runtimeVersion = toIso(runtime.updatedAt)
  if (!runtimeVersion) throw bindingInvalid({ field: 'runtimeVersion' })
  const binding = buildKcpBinding({ plan, runtime })
  const preflightCandidate = buildPreflightCandidate({
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    latest,
    runtimeVersion,
  })
  const outputContract = {
    truthReferenceKeys: binding.truthReferenceKeys,
    activationReferenceIds: binding.activationReferenceIds,
    visibleGaps: preflightCandidate.inputSnapshot.visibleGaps,
  }
  const providerAdapter = providerAdapterFactory({ providerDescriptor, outputContract })
  if (typeof providerAdapter !== 'function') throw invalid({ field: 'providerAdapterFactory' })
  const providerConfigurationVersion = text(providerAdapter.configurationVersion)
  if (!Object.values(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS)
    .includes(providerConfigurationVersion)) throw invalid({ field: 'providerConfigurationVersion' })
  assertRetryHistory(
    latest,
    plan.planFingerprint,
    providerConfigurationVersion,
    providerDescriptor,
  )
  const knowledgeFacade = buildKnowledgeBindingFacade({ plan, binding })
  const expectedKnowledgeSelection = binding.packs.map(({ versionId, knowledgeLayer, executionMode }) => ({
    versionId,
    knowledgeLayer,
    executionMode,
  }))
  const expectedPackBindings = binding.packs.map(({ versionId, contentHash, knowledgeLayer, executionMode }) => ({
    versionId,
    contentHash,
    knowledgeLayer,
    executionMode,
  }))
  const providerInput = buildServerOwnedProviderInput(plan)
  const idempotencyKey = [
    'FRAMEWORK_GUIDANCE',
    plan.planId,
    `v${plan.planVersion}`,
    lower(plan.planFingerprint).slice(0, 16),
  ].join(':')
  const createGrr = deps.createGovernedReasoningExecution || createGovernedReasoningExecution
  const createStage = deps.createOutcomeQualityStageExecution || createOutcomeQualityStageExecution
  const startedAt = new Date().toISOString()
  let grrExecution
  try {
    grrExecution = await createGrr({
      actorUserId,
      auditRequest,
      payload: {
        outputTypeKey: 'FRAMEWORK_GUIDANCE_ANALYSIS',
        requestedOutputTypeKey: 'framework-guidance-analysis',
        requestedStyleKey: 'decision-analysis',
        executionIntent: providerInput.customerPrompt,
        idempotencyKey,
        workspaceType: 'PLATFORM',
      },
      deps: {
        executionMode: 'LIVE_TEST',
        providerAdapter,
        providerDescriptor,
        providerInput,
        resolveKnowledgeBinding: async () => knowledgeFacade,
        buildProviderSafeContext: async ({
          providerDescriptor: currentProviderDescriptor,
          safeRequest,
          truthSource,
          knowledgeSelection,
        }) => {
          if (JSON.stringify(knowledgeSelection) !== JSON.stringify(expectedKnowledgeSelection)) {
            throw bindingInvalid({ field: 'grrKnowledgeSelection' })
          }
          return buildOutcomeFrameworkGuidanceProviderSafeContext({
            providerDescriptor: currentProviderDescriptor,
            safeRequest,
            truthSource,
            knowledgeSelection,
            expectedTruthBindings: binding.truthBindings,
            expectedPackBindings,
            truthReferenceKeys: binding.truthReferenceKeys,
            activationReferenceIds: binding.activationReferenceIds,
          })
        },
      },
      runtimeInstanceId,
      scopes,
    })
  } catch (error) {
    if (!providerFailure(error)) throw error
    return persistProviderFailure({
      error,
      plan,
      runtimeInstanceId,
      expectedPlanFingerprint,
      latest,
      providerDescriptor,
      providerConfigurationVersion,
      runtimeVersion,
      startedAt,
      actorUserId,
      createStage,
      stageDeps: deps.stageDeps || {},
    })
  }
  const artifact = grrExecution?.artifact
  const grrExecutionId = text(grrExecution?.executionId)
  const grrRuntimeArtifactId = text(artifact?.runtimeArtifactId)
  const provider = grrExecution?.provider || {}
  const generatedOutput = artifact?.generatedOutput
  const requestedAt = toIso(grrExecution?.requestedAt)
  const completedAt = toIso(grrExecution?.completedAt)
  if (!grrExecutionId
    || !grrRuntimeArtifactId
    || !generatedOutput
    || !requestedAt
    || !completedAt
    || lower(provider.providerKey) !== lower(providerDescriptor.providerKey)
    || text(provider.model) !== text(providerDescriptor.model)
    || upper(provider.providerMode) !== 'LIVE_TEST'
    || provider.liveProvider !== true) throw lineageInvalid({ field: 'grrResult' })
  const stageArgs = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: Number(latest?.attemptNumber || 0),
    predecessorStageExecutionId: latest?.stageExecutionId || '',
    predecessorAttemptFingerprint: latest?.attemptFingerprint || '',
    status: SUCCESS_STATUS,
    output: generatedOutput,
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(provider.providerKey),
      providerConfigurationVersion,
      model: text(provider.model),
      grrExecutionId,
      grrRuntimeArtifactId,
      runtimeVersion,
    },
    startedAt: requestedAt,
    completedAt,
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(stageArgs)
  const stageResult = await createStage({
    planRecordId: toId(plan._id || plan.id),
    runtimeInstanceId,
    expectedPlanFingerprint,
    ...stageArgs,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId,
    deps: deps.stageDeps || {},
  })
  return {
    idempotent: stageResult.idempotent,
    grr: { executionId: grrExecutionId, runtimeArtifactId: grrRuntimeArtifactId },
    stage: stageResult.execution,
  }
}

export default executeOutcomeFrameworkGuidance
