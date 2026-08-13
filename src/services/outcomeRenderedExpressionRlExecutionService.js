import mongoose from 'mongoose'

import {
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import {
  KNOWLEDGE_PACK_BOUNDARIES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import {
  GovernedReasoningExecution,
  GovernedRuntimeArtifact,
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import { createGovernedReasoningExecution } from './governedReasoningRuntimeService.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import { persistOutcomeRenderedExpressionRl } from './outcomePostArlQualityChainService.js'
import {
  assertOutcomeQualityStageTransactionSupport,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
} from './outcomeQualityStageExecutionService.js'
import {
  assertOutcomeRenderedExpressionRlProviderSafeContext,
  buildOutcomeRenderedExpressionRlProviderSafeContext,
} from './outcomeRenderedExpressionRlProviderSafeContextService.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SUCCESS = OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
const REQUIRED_DIMENSIONS = Object.freeze([
  'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
])
const RETRYABLE_PROVIDER_REASONS = new Set([
  'RENDERED_EXPRESSION_RL_PROVIDER_REQUEST_FAILED',
  'RENDERED_EXPRESSION_RL_PROVIDER_TIMEOUT',
  'RENDERED_EXPRESSION_RL_PROVIDER_NETWORK_FAILED',
  'RENDERED_EXPRESSION_RL_PROVIDER_TRANSIENT_FAILURE',
])
const PROVIDER_REASONS = new Set([
  ...RETRYABLE_PROVIDER_REASONS,
  'RENDERED_EXPRESSION_RL_PROVIDER_REJECTED',
  'RENDERED_EXPRESSION_RL_PROVIDER_REFUSED',
  'RENDERED_EXPRESSION_RL_PROVIDER_RESPONSE_INVALID',
  'RENDERED_EXPRESSION_RL_PROVIDER_OUTPUT_INVALID',
  'RENDERED_EXPRESSION_RL_PROVIDER_OUTPUT_TOO_LARGE',
])

const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()
const toId = (value) => value?.toString ? value.toString() : text(value)
const toIso = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}
const plain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const execQuery = async (query) => typeof query?.lean === 'function' ? query.lean() : query
const readLatest = async (model, filter, sort = { attemptNumber: -1 }) => {
  const query = model.findOne(filter)
  return execQuery(typeof query?.sort === 'function' ? query.sort(sort) : query)
}
const error = (code, message, field, status = 409) => Object.assign(new Error(message), {
  status,
  code,
  details: { reason: code, ...(field ? { field } : {}) },
})
const invalid = (field) => error('OUTCOME_RENDERED_EXPRESSION_RL_EXECUTION_INVALID', 'Rendered-expression RL execution input is invalid.', field, 422)
const bindingInvalid = (field) => error('OUTCOME_RENDERED_EXPRESSION_RL_BINDING_INVALID', 'Rendered-expression RL does not match the current plan.', field)
const historyInvalid = (field) => error('OUTCOME_RENDERED_EXPRESSION_RL_STAGE_HISTORY_INVALID', 'Rendered-expression RL stage history is not eligible.', field)
const lineageInvalid = (field) => error('OUTCOME_RENDERED_EXPRESSION_RL_LINEAGE_INVALID', 'Rendered-expression RL lineage is incomplete.', field)

const assertCurrentPlan = ({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint }) => {
  let selected
  let latest
  try {
    selected = assertOutcomeKnowledgeCompositionPlanIntegrity(selectedPlan)
    latest = assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(selected, runtime)
  } catch {
    throw bindingInvalid('planIntegrity')
  }
  if (toId(selected.runtimeInstanceId) !== toId(runtimeInstanceId)
    || lower(selected.planFingerprint) !== lower(expectedPlanFingerprint)
    || toId(selected._id || selected.id) !== toId(latest._id || latest.id)
    || lower(selected.planFingerprint) !== lower(latest.planFingerprint)) throw bindingInvalid('currentPlan')
  return selected
}

const assertSource = ({ source, plan, runtimeInstanceId }) => {
  const stage = plain(source)
  if (!stage
    || stage.status !== SUCCESS
    || stage.stageKey !== OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
    || Number(stage.stageOrder) !== 5
    || toId(stage.runtimeInstanceId) !== toId(runtimeInstanceId)
    || text(stage.planId) !== text(plan.planId)
    || lower(stage.planFingerprint) !== lower(plan.planFingerprint)
    || !SHA256_PATTERN.test(lower(stage.attemptFingerprint))
    || !SHA256_PATTERN.test(lower(stage.outputFingerprint))
    || hashOutcomeQualityStageValue(stage.outputSnapshot) !== lower(stage.outputFingerprint)
    || stage.outputSnapshot?.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION
    || stage.outputSnapshot?.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION) {
    throw historyInvalid('renderedExpressionSource')
  }
  return stage
}

const buildBinding = (plan) => {
  const stage = plan.payload.stagePlan.find((entry) => entry.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL)
  if (!stage || stage.order !== 6 || !Array.isArray(stage.assignedActivationIds) || stage.assignedActivationIds.length !== 1) {
    throw bindingInvalid('stagePlan')
  }
  const pack = plan.payload.resolution.selectedPacks.find((entry) => (
    text(entry.activationId) === text(stage.assignedActivationIds[0])
  ))
  if (!pack
    || !text(pack.versionId)
    || !Array.isArray(pack.stageAssignments)
    || !pack.stageAssignments.includes(OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL)) throw bindingInvalid('assignedPack')
  if (resolveKnowledgePackBoundary(pack) !== KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION) {
    throw bindingInvalid('assignedPackBoundary')
  }
  return { stage, pack }
}

export const buildOutcomeRenderedExpressionRlKnowledgeFacade = ({ plan, binding }) => {
  const pack = { ...binding.pack }
  const layer = upper(pack.knowledgeLayer)
  const postValidationPacks = [pack]
  return {
    manifest: {
      sourceType: 'KNOWLEDGE_COMPOSITION_PLAN',
      policyKey: text(plan.payload.resolution.policyKey),
      policyVersion: text(plan.payload.resolution.policyVersion),
      manifestId: text(plan.planId),
      manifestKey: 'rendered-expression-rl',
      manifestName: 'Rendered-expression RL',
      semanticVersion: String(plan.planVersion),
      status: 'ACTIVE',
    },
    binding: {
      status: 'READY',
      mode: 'KCP_RENDERED_EXPRESSION_RL_STAGE_BINDING',
      requiredPacks: [pack],
      optionalPacks: [],
      validationPacks: [pack],
      providerContextPacks: [],
      preValidationPacks: [],
      postValidationPacks,
      systemOnlyPacks: [],
      selectedByLayer: { [layer]: [pack] },
      dependencyGraph: plan.payload.resolution.dependencyGraph || {},
      resolution: {
        status: 'READY',
        activeCount: 1,
        resolvedCount: 1,
        requiredCount: 1,
        optionalCount: 0,
        validationCount: 1,
        blockedCount: 0,
        requestedContextCategories: [],
        policyVersion: text(plan.payload.resolution.policyVersion),
        request: {
          requestedOutputTypeKey: 'rendered-expression-rl',
          requestedStyleKey: 'executive-brief-review',
        },
      },
      lineage: {
        resolvedAt: toIso(plan.resolvedAt || plan.createdAt),
        activationIds: [text(pack.activationId)],
        versionIds: [text(pack.versionId)],
        contentHashes: [lower(pack.contentHash)],
      },
    },
  }
}

const buildProviderInput = () => ({
  customerPrompt: 'Review this Executive Brief rendered expression against the seven required RL dimensions.',
  currentDraftMarkdown: '',
  request: {
    intentType: 'RENDERED_EXPRESSION_RL',
    refinement: false,
    outputTypeKey: 'RENDERED_EXPRESSION_RL',
    outputTypeLabel: 'Rendered-expression RL review',
    outputSchemaKey: 'fs-003-rendered-expression-rl-v0-2',
    requiredSections: [...REQUIRED_DIMENSIONS],
    styleKey: 'executive-brief-review',
    styleLabel: 'Executive Brief expression review',
    requestedOutputTypeKey: 'rendered-expression-rl',
    requestedStyleKey: 'executive-brief-review',
    workspaceType: 'PLATFORM',
  },
})

const buildStageOutput = ({ generatedOutput, plan, source }) => {
  if (!generatedOutput
    || generatedOutput.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
    || generatedOutput.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION
    || upper(generatedOutput.overallStatus) !== 'PASS'
    || !Array.isArray(generatedOutput.findings)
    || generatedOutput.findings.length !== 7) throw invalid('providerOutput')
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
    candidateStageExecutionId: source.stageExecutionId,
    candidateOutputFingerprint: lower(source.outputFingerprint),
    overallStatus: 'PASS',
    findings: generatedOutput.findings.map((finding) => ({ ...finding })),
    truthReferences: [...source.outputSnapshot.truthReferences],
    contributingActivationIds: [...plan.payload.stagePlan
      .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL)
      .assignedActivationIds],
    visibleGaps: [...source.outputSnapshot.visibleGaps],
  }
}

export const buildOutcomeRenderedExpressionRlFailureLineage = ({ latestRl, source } = {}) => {
  if (!latestRl) return {
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source?.stageExecutionId,
    predecessorAttemptFingerprint: source?.attemptFingerprint,
  }
  if (latestRl.status !== OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    || latestRl.failure?.failureCode !== 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    || source?.outputSnapshot?.revisionScope !== 'EXPRESSION_ONLY'
    || source?.outputSnapshot?.remediationSourceStageExecutionId !== latestRl.stageExecutionId
    || lower(source?.outputSnapshot?.remediationSourceAttemptFingerprint) !== lower(latestRl.attemptFingerprint)) {
    throw historyInvalid('failureLineage')
  }
  return {
    expectedLatestAttemptNumber: Number(latestRl.attemptNumber),
    predecessorStageExecutionId: latestRl.stageExecutionId,
    predecessorAttemptFingerprint: latestRl.attemptFingerprint,
  }
}

const persistFailure = async ({
  actorUserId, createStage, expectedPlanFingerprint, failureCode, grrExecutionId = '',
  grrRuntimeArtifactId = '', latestRl, plan, providerDescriptor, retryable, runtimeInstanceId,
  runtimeVersion, source, stageDeps, startedAt,
}) => {
  const failureLineage = buildOutcomeRenderedExpressionRlFailureLineage({ latestRl, source })
  const args = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ...failureLineage,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
    failure: {
      failureCode,
      safeReason: 'Rendered-expression RL did not pass the exact Executive Brief candidate.',
      retryable,
    },
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(providerDescriptor.providerKey),
      providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
      model: text(providerDescriptor.model),
      grrExecutionId,
      grrRuntimeArtifactId,
      runtimeVersion,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(args)
  return createStage({
    planRecordId: toId(plan._id || plan.id),
    runtimeInstanceId,
    expectedPlanFingerprint,
    ...args,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId,
    deps: stageDeps,
  })
}

export const executeOutcomeRenderedExpressionRl = async ({
  actorUserId,
  auditRequest,
  expectedPlanFingerprint,
  planRecordId,
  providerAdapter,
  providerDescriptor,
  runtimeInstanceId,
  scopes,
  deps = {},
} = {}) => {
  if (!mongoose.isValidObjectId(actorUserId)
    || !mongoose.isValidObjectId(planRecordId)
    || !mongoose.isValidObjectId(runtimeInstanceId)
    || !SHA256_PATTERN.test(lower(expectedPlanFingerprint))
    || typeof providerAdapter !== 'function'
    || text(providerAdapter.configurationVersion) !== OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION
    || lower(providerDescriptor?.providerKey) !== 'openai'
    || !text(providerDescriptor?.model)
    || providerDescriptor?.providerMode !== 'LIVE_TEST'
    || providerDescriptor?.environment !== 'TEST'
    || providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || providerDescriptor?.failurePosture !== 'FAIL_CLOSED') throw invalid('identity')
  const models = {
    OutcomeKnowledgeCompositionPlan: deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    OutcomeQualityStageExecution: deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution,
    RuntimeInstance: deps.RuntimeInstance || RuntimeInstance,
    GovernedReasoningExecution: deps.GovernedReasoningExecution || GovernedReasoningExecution,
    GovernedRuntimeArtifact: deps.GovernedRuntimeArtifact || GovernedRuntimeArtifact,
  }
  ;(deps.assertOutcomeQualityStageTransactionSupport || assertOutcomeQualityStageTransactionSupport)(deps.mongoose || mongoose)
  const [selectedPlan, latestPlan, runtime] = await Promise.all([
    execQuery(models.OutcomeKnowledgeCompositionPlan.findOne({ _id: planRecordId, runtimeInstanceId })),
    readLatest(models.OutcomeKnowledgeCompositionPlan, { runtimeInstanceId }, { planVersion: -1 }),
    execQuery(models.RuntimeInstance.findOne({ _id: runtimeInstanceId })),
  ])
  const plan = assertCurrentPlan({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint })
  const [sourceRecord, latestRl] = await Promise.all([
    readLatest(models.OutcomeQualityStageExecution, {
      runtimeInstanceId, planId: plan.planId, stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    }),
    readLatest(models.OutcomeQualityStageExecution, {
      runtimeInstanceId, planId: plan.planId, stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    }),
  ])
  const source = assertSource({ source: sourceRecord, plan, runtimeInstanceId })
  if (latestRl) {
    if (latestRl.status === SUCCESS) {
      if (latestRl.predecessorStageExecutionId !== source.stageExecutionId
        || lower(latestRl.predecessorAttemptFingerprint) !== lower(source.attemptFingerprint)) throw historyInvalid('existingAttempt')
      return { idempotent: true, grr: {
        executionId: text(latestRl.executionIdentity?.grrExecutionId),
        runtimeArtifactId: text(latestRl.executionIdentity?.grrRuntimeArtifactId),
      }, stage: serializeOutcomeQualityStageExecution(latestRl) }
    }
    if (latestRl.failure?.failureCode !== 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
      || source.outputSnapshot?.revisionScope !== 'EXPRESSION_ONLY'
      || source.outputSnapshot?.remediationSourceStageExecutionId !== latestRl.stageExecutionId
      || lower(source.outputSnapshot?.remediationSourceAttemptFingerprint) !== lower(latestRl.attemptFingerprint)) {
      throw historyInvalid('existingAttempt')
    }
  }
  const binding = buildBinding(plan)
  const runtimeVersion = toIso(runtime.updatedAt)
  if (!runtimeVersion) throw bindingInvalid('runtimeVersion')
  const bindingFingerprint = hashOutcomeQualityStageValue({
    targetStage: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    planFingerprint: plan.planFingerprint,
    sourceStageExecutionId: source.stageExecutionId,
    sourceAttemptFingerprint: source.attemptFingerprint,
    sourceOutputFingerprint: source.outputFingerprint,
    providerContextVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
  })
  const createGrr = deps.createGovernedReasoningExecution || createGovernedReasoningExecution
  const createStage = deps.createOutcomeQualityStageExecution || createOutcomeQualityStageExecution
  const startedAt = new Date().toISOString()
  let grr
  try {
    grr = await createGrr({
      actorUserId,
      auditRequest,
      payload: {
        outputTypeKey: 'RENDERED_EXPRESSION_RL',
        requestedOutputTypeKey: 'rendered-expression-rl',
        requestedStyleKey: 'executive-brief-review',
        executionIntent: 'Review the exact Executive Brief rendered expression without changing meaning.',
        idempotencyKey: `RENDERED_EXPRESSION_RL:${plan.planId}:v${plan.planVersion}:${bindingFingerprint.slice(0, 24)}`,
        workspaceType: 'PLATFORM',
        manifestId: plan.planId,
      },
      deps: {
        executionMode: 'LIVE_TEST',
        providerAdapter,
        providerDescriptor,
        providerInput: buildProviderInput(),
        resolveKnowledgeBinding: async () => buildOutcomeRenderedExpressionRlKnowledgeFacade({ plan, binding }),
        buildProviderSafeContext: async ({ boundarySelection, ...args }) => buildOutcomeRenderedExpressionRlProviderSafeContext({
          ...args,
          knowledgeSelection: boundarySelection,
          sourceStageExecution: source,
          targetStageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
        }),
        assertProviderSafeContext: assertOutcomeRenderedExpressionRlProviderSafeContext,
        providerContextContractVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
        providerContextBindingFingerprint: bindingFingerprint,
      },
      runtimeInstanceId,
      scopes,
    })
  } catch (providerError) {
    const reason = providerError?.details?.reason
    if (providerError?.code !== 'OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_FAILED' || !PROVIDER_REASONS.has(reason)) throw providerError
    const failure = await persistFailure({
      actorUserId, createStage, expectedPlanFingerprint, failureCode: reason, plan,
      latestRl, providerDescriptor, retryable: RETRYABLE_PROVIDER_REASONS.has(reason), runtimeInstanceId,
      runtimeVersion, source, stageDeps: deps.stageDeps || {}, startedAt,
    })
    return { idempotent: failure.idempotent, grr: null, stage: failure.execution }
  }
  const grrExecutionId = text(grr?.executionId)
  const grrRuntimeArtifactId = text(grr?.artifact?.runtimeArtifactId)
  const generatedOutput = grr?.artifact?.generatedOutput
  if (!grrExecutionId
    || !grrRuntimeArtifactId
    || !generatedOutput
    || lower(grr?.provider?.providerKey) !== lower(providerDescriptor.providerKey)
    || text(grr?.provider?.model) !== text(providerDescriptor.model)
    || grr?.provider?.providerMode !== 'LIVE_TEST'
    || grr?.provider?.liveProvider !== true) throw lineageInvalid('grrResult')
  if (upper(generatedOutput.overallStatus) !== 'PASS') {
    const failure = await persistFailure({
      actorUserId, createStage, expectedPlanFingerprint,
      failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', grrExecutionId, grrRuntimeArtifactId,
      latestRl, plan, providerDescriptor, retryable: false, runtimeInstanceId, runtimeVersion, source,
      stageDeps: deps.stageDeps || {}, startedAt,
    })
    return { idempotent: failure.idempotent, grr: { executionId: grrExecutionId, runtimeArtifactId: grrRuntimeArtifactId }, stage: failure.execution }
  }
  const output = buildStageOutput({ generatedOutput, plan, source })
  const result = await (deps.persistOutcomeRenderedExpressionRl || persistOutcomeRenderedExpressionRl)({
    actorUserId,
    expectedPlanFingerprint,
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: 'openai',
      providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
      model: text(providerDescriptor.model),
      grrExecutionId,
      grrRuntimeArtifactId,
      runtimeVersion,
    },
    output,
    planRecordId,
    runtimeInstanceId,
    scopes,
    startedAt: toIso(grr.requestedAt),
    completedAt: toIso(grr.completedAt),
    deps: deps.postArlDeps || {},
  })
  return { idempotent: result.idempotent, grr: { executionId: grrExecutionId, runtimeArtifactId: grrRuntimeArtifactId }, stage: result.stage }
}

export default { executeOutcomeRenderedExpressionRl }
