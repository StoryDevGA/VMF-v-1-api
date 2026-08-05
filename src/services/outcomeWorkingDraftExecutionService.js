import mongoose from 'mongoose'

import {
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import {
  GovernedReasoningExecution,
  GovernedRuntimeArtifact,
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import { createGovernedReasoningExecution } from './governedReasoningRuntimeService.js'
import {
  assertOutcomeQualityStageProviderSafeContext,
  buildOutcomeQualityStageProviderSafeContext,
} from './outcomeQualityStageProviderSafeContextService.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import {
  assertOutcomeQualityStageTransactionSupport,
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
} from './outcomeQualityStageExecutionService.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const URL_PATTERN = /https?:\/\/\S+/gi
const MAX_PROVIDER_TRUTH_SUMMARY_LENGTH = 900
const SUCCESS_STATUS = OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
const PROVIDER_RETRYABLE_REASONS = new Set([
  'WORKING_DRAFT_PROVIDER_REQUEST_FAILED',
  'WORKING_DRAFT_PROVIDER_TIMEOUT',
  'WORKING_DRAFT_PROVIDER_NETWORK_FAILED',
  'WORKING_DRAFT_PROVIDER_TRANSIENT_FAILURE',
])
const PROVIDER_NON_RETRYABLE_REASONS = new Set([
  'WORKING_DRAFT_PROVIDER_REJECTED',
  'WORKING_DRAFT_PROVIDER_REFUSED',
  'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID',
  'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
  'WORKING_DRAFT_PROVIDER_OUTPUT_TOO_LARGE',
])
const PROVIDER_FAILURE_REASONS = new Set([
  ...PROVIDER_RETRYABLE_REASONS,
  ...PROVIDER_NON_RETRYABLE_REASONS,
])
const PROVIDER_OUTPUT_KEYS = Object.freeze([
  'outputType',
  'schemaVersion',
  'draftVersion',
  'title',
  'sections',
  'decisionLogic',
  'assumptions',
  'visibleGaps',
])
const PROVIDER_SECTION_KEYS = Object.freeze([
  'order',
  'sectionKey',
  'title',
  'content',
  'claims',
  'truthReferences',
  'assumptions',
  'gaps',
])
const PROVIDER_CLAIM_KEYS = Object.freeze(['claimKey', 'statement', 'truthReferences', 'evidence'])
const DECISION_LOGIC_KEYS = Object.freeze(['decisionKey', 'rationale', 'priority', 'truthReferences'])
const PROVIDER_INPUT_KEYS = Object.freeze(['customerPrompt', 'currentDraftMarkdown', 'request'])
const PROVIDER_INPUT_REQUEST_KEYS = Object.freeze([
  'intentType',
  'refinement',
  'outputTypeKey',
  'outputTypeLabel',
  'outputSchemaKey',
  'requiredSections',
  'styleKey',
  'styleLabel',
  'requestedOutputTypeKey',
  'requestedStyleKey',
  'workspaceType',
])

const text = (value) => String(value ?? '').trim()
const projectWorkingDraftTruthSource = (truthSource = {}) => ({
  acceptedTruth: (Array.isArray(truthSource.acceptedTruth) ? truthSource.acceptedTruth : [])
    .map((entry) => {
      const normalized = text(entry?.content)
        .replace(URL_PATTERN, '[source link omitted]')
        .replace(/\s+/g, ' ')
        .trim()
      const content = normalized.length <= MAX_PROVIDER_TRUTH_SUMMARY_LENGTH
        ? normalized
        : `${normalized.slice(0, MAX_PROVIDER_TRUTH_SUMMARY_LENGTH - 3).trimEnd()}...`
      return { label: text(entry?.label), content }
    }),
})
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()
const toId = (value) => value?.toString ? value.toString() : text(value)
const toPlain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const toIso = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

const appError = (status, code, message, details = {}) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = { reason: code, ...details }
  return error
}

const invalid = (details = {}) => appError(
  422,
  'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID',
  'Working Draft execution input is invalid.',
  details,
)
const bindingInvalid = (details = {}) => appError(
  409,
  'OUTCOME_WORKING_DRAFT_BINDING_INVALID',
  'Working Draft execution does not match the current Knowledge Composition Plan.',
  details,
)
const stageHistoryInvalid = (details = {}) => appError(
  409,
  'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID',
  'Working Draft source-stage history is not eligible.',
  details,
)
const lineageInvalid = (details = {}) => appError(
  409,
  'OUTCOME_WORKING_DRAFT_LINEAGE_INVALID',
  'Working Draft governed reasoning lineage is incomplete or inconsistent.',
  details,
)

const hasExactPlainKeys = (value, keys) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)),
)

const boundedText = (value, { allowLineBreaks = false, field, min = 0, max }) => {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length < min
    || value.length > max
    || (allowLineBreaks ? MULTILINE_CONTROL_PATTERN : CONTROL_PATTERN).test(value)) {
    throw invalid({ field, min, max })
  }
  return value
}

const boundedArray = (value, { field, min = 0, max }) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw invalid({ field, min, max })
  }
  return value
}

const boundedStringArray = (value, { field, min = 0, max, itemMax }) => (
  boundedArray(value, { field, min, max }).map((item, index) => boundedText(item, {
    field: `${field}[${index}]`,
    min: 1,
    max: itemMax,
  }))
)

const sameSet = (left, right) => (
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
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
const readLatestStage = ({ model, runtimeInstanceId, planId, stageKey }) => {
  const query = model.findOne({ runtimeInstanceId, planId, stageKey })
  return execQuery(typeof query?.sort === 'function' ? query.sort({ attemptNumber: -1 }) : query)
}
const readGrrExecution = ({ model, runtimeInstanceId, executionId }) => execQuery(
  model.findOne({ runtimeInstanceId, executionId }),
)
const readGrrArtifact = ({ model, runtimeInstanceId, executionId, runtimeArtifactId }) => execQuery(
  model.findOne({ runtimeInstanceId, executionId, runtimeArtifactId }),
)

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

const assertSourceFrameworkGuidance = ({ source, plan, runtimeInstanceId }) => {
  const stage = toPlain(source)
  if (!stage
    || stage.status !== SUCCESS_STATUS
    || stage.stageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
    || Number(stage.stageOrder) !== 1
    || toId(stage.runtimeInstanceId) !== toId(runtimeInstanceId)
    || text(stage.planId) !== text(plan.planId)
    || lower(stage.planFingerprint) !== lower(plan.planFingerprint)
    || !text(stage.stageExecutionId)
    || !SHA256_PATTERN.test(lower(stage.attemptFingerprint))
    || !SHA256_PATTERN.test(lower(stage.outputFingerprint))
    || !stage.outputSnapshot
    || upper(stage.outputSnapshot.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS
    || text(stage.outputSnapshot.schemaVersion) !== OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION
    || hashOutcomeQualityStageValue(stage.outputSnapshot) !== lower(stage.outputFingerprint)) {
    throw stageHistoryInvalid({ field: 'frameworkGuidanceSource' })
  }
  return stage
}

const assertLatestWorkingDraftRetryState = ({ latest, plan, sourceStage, runtimeInstanceId }) => {
  if (!latest) return
  const source = latest.inputSnapshot?.sourceStage
  if (latest.stageKey !== OUTCOME_QUALITY_STAGES.WORKING_DRAFT
    || toId(latest.runtimeInstanceId) !== toId(runtimeInstanceId)
    || text(latest.planId) !== text(plan.planId)
    || lower(latest.planFingerprint) !== lower(plan.planFingerprint)
    || !source
    || text(source.stageExecutionId) !== text(sourceStage.stageExecutionId)
    || Number(source.attemptNumber) !== Number(sourceStage.attemptNumber)
    || lower(source.attemptFingerprint) !== lower(sourceStage.attemptFingerprint)
    || lower(source.outputFingerprint) !== lower(sourceStage.outputFingerprint)) {
    throw stageHistoryInvalid({ field: 'workingDraftRetrySourceLineage' })
  }
  if (latest.status === SUCCESS_STATUS) return
  if (latest.failure?.retryable !== true) {
    throw stageHistoryInvalid({ field: 'workingDraftRetryPredecessor' })
  }
  if (!text(latest.stageExecutionId) || !SHA256_PATTERN.test(lower(latest.attemptFingerprint))) {
    throw stageHistoryInvalid({ field: 'workingDraftRetryIdentity' })
  }
}

const buildProviderInput = ({ plan }) => {
  const intent = plan.payload?.consumerIntent || {}
  const customerPrompt = [
    `Outcome: ${text(intent.outcome)}`,
    `Decision purpose: ${text(intent.decisionPurpose)}`,
    `Consumer: ${text(intent.consumer)}`,
    `Audience: ${(intent.audience || []).map(text).filter(Boolean).join(', ')}`,
    `Requirements: ${(intent.requirements || []).map(text).filter(Boolean).join('; ') || 'None specified'}`,
    'Generate the governed Working Draft only. Do not approve meaning or create a narrative plan.',
  ].join('\n')
  return {
    customerPrompt,
    currentDraftMarkdown: '',
    request: {
      intentType: 'WORKING_DRAFT',
      refinement: false,
      outputTypeKey: 'WORKING_DRAFT',
      outputTypeLabel: 'Working Draft',
      outputSchemaKey: 'fs-003-working-draft-v0-2',
      requiredSections: ['sections', 'claims', 'decisionLogic', 'assumptions', 'visibleGaps'],
      styleKey: 'governed-working-draft',
      styleLabel: 'Governed Working Draft',
      requestedOutputTypeKey: lower(plan.requestedOutputTypeKey || plan.payload?.consumerIntent?.requestedOutputTypeKey || 'working-draft'),
      requestedStyleKey: 'governed-working-draft',
      workspaceType: 'PLATFORM',
    },
  }
}

const assertProviderInputSelectorShape = (providerInput) => {
  const request = providerInput?.request
  if (!hasExactPlainKeys(providerInput, PROVIDER_INPUT_KEYS)
    || !hasExactPlainKeys(request, PROVIDER_INPUT_REQUEST_KEYS)) {
    throw invalid({ field: 'providerInput' })
  }
}

const buildKnowledgeFacade = ({ plan }) => ({
  manifest: {
    sourceType: 'KNOWLEDGE_COMPOSITION_PLAN',
    policyKey: text(plan.payload?.resolution?.policyKey),
    policyVersion: text(plan.payload?.resolution?.policyVersion),
    manifestId: text(plan.planId),
    manifestKey: 'working-draft',
    manifestName: 'Working Draft',
    semanticVersion: String(plan.planVersion),
    status: 'ACTIVE',
  },
  binding: {
    status: 'READY',
    mode: 'KCP_WORKING_DRAFT_STAGE_BINDING',
    requiredPacks: [],
    optionalPacks: [],
    validationPacks: [],
    providerContextPacks: [],
    preValidationPacks: [],
    postValidationPacks: [],
    selectedByLayer: {},
    dependencyGraph: plan.payload?.resolution?.dependencyGraph || {},
    resolution: {
      status: 'READY',
      activeCount: 0,
      resolvedCount: 0,
      requiredCount: 0,
      optionalCount: 0,
      validationCount: 0,
      blockedCount: 0,
      requestedContextCategories: [],
      policyVersion: text(plan.payload?.resolution?.policyVersion),
      request: {
        requestedOutputTypeKey: 'working-draft',
        requestedStyleKey: 'governed-working-draft',
      },
    },
    lineage: {
      resolvedAt: toIso(plan.resolvedAt || plan.createdAt),
      activationIds: [],
      versionIds: [],
      contentHashes: [],
    },
  },
})

const normalizeProviderOutput = ({ value, plan }) => {
  if (!hasExactPlainKeys(value, PROVIDER_OUTPUT_KEYS)
    || upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT
    || value.schemaVersion !== OUTCOME_WORKING_DRAFT_SCHEMA_VERSION
    || typeof value.draftVersion !== 'number'
    || !Number.isInteger(value.draftVersion)
    || value.draftVersion < 1) throw invalid({ field: 'providerOutput.identity' })
  const allowedTruth = plan.payload.lockedTruth.acceptedSections.map((section) => lower(section.sectionKey))
  const visibleGaps = boundedStringArray(value.visibleGaps, { field: 'providerOutput.visibleGaps', max: 50, itemMax: 2000 })
  if (JSON.stringify(visibleGaps) !== JSON.stringify(buildOutcomeQualityVisibleGaps(plan))) {
    throw bindingInvalid({ field: 'providerOutput.visibleGaps' })
  }
  const sections = boundedArray(value.sections, { field: 'providerOutput.sections', min: 1, max: 20 })
    .map((section, index) => {
      if (!hasExactPlainKeys(section, PROVIDER_SECTION_KEYS)
        || section.order !== index + 1
        || !STABLE_KEY_PATTERN.test(lower(section.sectionKey))) throw invalid({ field: `providerOutput.sections[${index}]` })
      const truthReferences = boundedStringArray(section.truthReferences, {
        field: `providerOutput.sections[${index}].truthReferences`, min: 1, max: 50, itemMax: 140,
      }).map(lower)
      if (new Set(truthReferences).size !== truthReferences.length
        || truthReferences.some((item) => !allowedTruth.includes(item))) {
        throw bindingInvalid({ field: `providerOutput.sections[${index}].truthReferences` })
      }
      const claims = boundedArray(section.claims, {
        field: `providerOutput.sections[${index}].claims`, min: 1, max: 50,
      }).map((claim, claimIndex) => {
        if (!hasExactPlainKeys(claim, PROVIDER_CLAIM_KEYS)
          || !STABLE_KEY_PATTERN.test(lower(claim.claimKey))) {
          throw invalid({ field: `providerOutput.sections[${index}].claims[${claimIndex}]` })
        }
        const claimTruth = boundedStringArray(claim.truthReferences, {
          field: `providerOutput.sections[${index}].claims[${claimIndex}].truthReferences`,
          min: 1,
          max: 20,
          itemMax: 140,
        }).map(lower)
        if (new Set(claimTruth).size !== claimTruth.length
          || claimTruth.some((item) => !truthReferences.includes(item))) {
          throw bindingInvalid({ field: `providerOutput.sections[${index}].claims[${claimIndex}].truthReferences` })
        }
        return {
          claimKey: lower(claim.claimKey),
          statement: boundedText(claim.statement, {
            field: `providerOutput.sections[${index}].claims[${claimIndex}].statement`, min: 1, max: 4000,
          }),
          truthReferences: claimTruth,
          evidence: boundedStringArray(claim.evidence, {
            field: `providerOutput.sections[${index}].claims[${claimIndex}].evidence`, min: 1, max: 20, itemMax: 2000,
          }),
        }
      })
      return {
        order: index + 1,
        sectionKey: lower(section.sectionKey),
        title: boundedText(section.title, { field: `providerOutput.sections[${index}].title`, min: 1, max: 255 }),
        content: boundedText(section.content, {
          allowLineBreaks: true,
          field: `providerOutput.sections[${index}].content`,
          min: 1,
          max: 16000,
        }),
        claims,
        truthReferences,
        assumptions: boundedStringArray(section.assumptions, {
          field: `providerOutput.sections[${index}].assumptions`, max: 20, itemMax: 2000,
        }),
        gaps: boundedStringArray(section.gaps, {
          field: `providerOutput.sections[${index}].gaps`, max: 20, itemMax: 2000,
        }),
      }
    })
  if (!sameSet(sections.flatMap((section) => section.truthReferences), allowedTruth)) {
    throw bindingInvalid({ field: 'providerOutput.truthCoverage' })
  }
  const decisionLogic = boundedArray(value.decisionLogic, {
    field: 'providerOutput.decisionLogic', min: 1, max: 30,
  }).map((decision, index) => {
    if (!hasExactPlainKeys(decision, DECISION_LOGIC_KEYS)
      || !STABLE_KEY_PATTERN.test(lower(decision.decisionKey))) {
      throw invalid({ field: `providerOutput.decisionLogic[${index}]` })
    }
    const truthReferences = boundedStringArray(decision.truthReferences, {
      field: `providerOutput.decisionLogic[${index}].truthReferences`, min: 1, max: 20, itemMax: 140,
    }).map(lower)
    if (truthReferences.some((item) => !allowedTruth.includes(item))) {
      throw bindingInvalid({ field: `providerOutput.decisionLogic[${index}].truthReferences` })
    }
    return {
      decisionKey: lower(decision.decisionKey),
      rationale: boundedText(decision.rationale, { field: `providerOutput.decisionLogic[${index}].rationale`, min: 1, max: 4000 }),
      priority: upper(decision.priority),
      truthReferences,
    }
  })
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
    schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
    draftVersion: value.draftVersion,
    title: boundedText(value.title, { field: 'providerOutput.title', min: 1, max: 255 }),
    sections,
    decisionLogic,
    assumptions: boundedStringArray(value.assumptions, { field: 'providerOutput.assumptions', max: 20, itemMax: 2000 }),
    visibleGaps,
  }
}

export const buildWorkingDraftStageOutputFromProviderOutput = ({ providerOutput, plan, sourceStage }) => {
  const normalized = normalizeProviderOutput({ value: providerOutput, plan })
  const sourceSections = sourceStage.outputSnapshot.sections || []
  const sourceActivationIds = [...new Set(sourceSections.flatMap((section) => section.contributingActivationIds || []))]
  const activationsForTruth = (truthReferences) => {
    const matched = sourceSections
      .filter((section) => (section.truthReferences || []).some((truth) => truthReferences.includes(lower(truth))))
      .flatMap((section) => section.contributingActivationIds || [])
    return [...new Set(matched.length > 0 ? matched : sourceActivationIds)].sort()
  }
  return {
    ...normalized,
    sections: normalized.sections.map((section) => ({
      ...section,
      contributingActivationIds: activationsForTruth(section.truthReferences),
    })),
    compositionProvenance: {
      frameworkGuidanceStageExecutionId: sourceStage.stageExecutionId,
      frameworkGuidanceOutputFingerprint: lower(sourceStage.outputFingerprint),
      planFingerprint: lower(plan.planFingerprint),
    },
    revisionHistory: [{
      version: normalized.draftVersion,
      summary: 'Initial governed Working Draft from successful Framework Guidance.',
      sourceStageExecutionId: sourceStage.stageExecutionId,
      sourceOutputFingerprint: lower(sourceStage.outputFingerprint),
    }],
  }
}

const buildBindingFingerprint = ({ plan, sourceStage, expectedLatestAttemptNumber }) => hashOutcomeQualityStageValue({
  targetStage: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
  targetAttemptNumber: Number(expectedLatestAttemptNumber) + 1,
  planId: plan.planId,
  planVersion: plan.planVersion,
  planFingerprint: plan.planFingerprint,
  contextFingerprint: plan.contextFingerprint,
  safeContextVersion: OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  sourceStageExecutionId: sourceStage.stageExecutionId,
  sourceAttemptFingerprint: sourceStage.attemptFingerprint,
  sourceOutputFingerprint: sourceStage.outputFingerprint,
})

const providerFailure = (error) => error?.code === 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED'
  && PROVIDER_FAILURE_REASONS.has(error?.details?.reason)

const persistProviderFailure = async ({
  actorUserId,
  createStage,
  error,
  expectedLatestAttemptNumber,
  expectedPlanFingerprint,
  plan,
  providerDescriptor,
  runtimeInstanceId,
  runtimeVersion,
  sourceStage,
  stageDeps,
  startedAt,
}) => {
  const reason = error.details.reason
  const args = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    expectedLatestAttemptNumber,
    predecessorStageExecutionId: expectedLatestAttemptNumber > 0
      ? text(stageDeps.latestWorkingDraft?.stageExecutionId)
      : sourceStage.stageExecutionId,
    predecessorAttemptFingerprint: expectedLatestAttemptNumber > 0
      ? lower(stageDeps.latestWorkingDraft?.attemptFingerprint)
      : lower(sourceStage.attemptFingerprint),
    status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
    failure: {
      failureCode: reason,
      safeReason: 'The governed Working Draft provider did not complete this attempt.',
      retryable: PROVIDER_RETRYABLE_REASONS.has(reason),
    },
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(providerDescriptor.providerKey),
      providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
      model: text(providerDescriptor.model),
      grrExecutionId: '',
      grrRuntimeArtifactId: '',
      runtimeVersion,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate({
    ...args,
    sourceStageExecution: sourceStage,
  })
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

const assertProviderIdentity = ({ provider, providerDescriptor }) => {
  if (lower(provider?.providerKey) !== lower(providerDescriptor.providerKey)
    || text(provider?.model) !== text(providerDescriptor.model)
    || upper(provider?.providerMode) !== 'LIVE_TEST'
    || provider?.liveProvider !== true) throw lineageInvalid({ field: 'provider' })
}

const assertExistingSuccessLineage = async ({ latest, models, providerDescriptor, runtimeInstanceId, sourceStage, plan }) => {
  const identity = latest.executionIdentity || {}
  if (!text(identity.grrExecutionId)
    || !text(identity.grrRuntimeArtifactId)
    || lower(identity.providerKey) !== lower(providerDescriptor.providerKey)
    || identity.providerConfigurationVersion !== OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION
    || text(identity.model) !== text(providerDescriptor.model)) throw lineageInvalid({ field: 'executionIdentity' })
  const [execution, artifact] = await Promise.all([
    readGrrExecution({
      model: models.GovernedReasoningExecution,
      runtimeInstanceId,
      executionId: identity.grrExecutionId,
    }),
    readGrrArtifact({
      model: models.GovernedRuntimeArtifact,
      runtimeInstanceId,
      executionId: identity.grrExecutionId,
      runtimeArtifactId: identity.grrRuntimeArtifactId,
    }),
  ])
  if (!execution
    || !artifact
    || upper(execution.status) !== 'COMPLETED'
    || upper(artifact.status) !== 'GENERATED') throw lineageInvalid({ field: 'persistedGrrLineage' })
  assertProviderIdentity({ provider: execution.provider, providerDescriptor })
  const rehydratedOutput = buildWorkingDraftStageOutputFromProviderOutput({
    providerOutput: artifact.generatedOutput,
    plan,
    sourceStage,
  })
  if (hashOutcomeQualityStageValue(rehydratedOutput) !== lower(latest.outputFingerprint)) {
    throw lineageInvalid({ field: 'artifactOutputFingerprint' })
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

export const executeOutcomeWorkingDraft = async ({
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
    || text(providerAdapter.configurationVersion) !== OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION
    || lower(providerDescriptor?.providerKey) !== 'openai'
    || !text(providerDescriptor?.model)
    || providerDescriptor?.providerMode !== 'LIVE_TEST'
    || providerDescriptor?.environment !== 'TEST'
    || providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || providerDescriptor?.failurePosture !== 'FAIL_CLOSED') throw invalid({ field: 'identity' })
  if (!Object.values(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS)
    .includes(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION)) throw invalid({ field: 'providerConfigurationVersion' })

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
  const [frameworkGuidanceSource, latestWorkingDraft] = await Promise.all([
    readLatestStage({
      model: models.OutcomeQualityStageExecution,
      runtimeInstanceId,
      planId: plan.planId,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    }),
    readLatestStage({
      model: models.OutcomeQualityStageExecution,
      runtimeInstanceId,
      planId: plan.planId,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    }),
  ])
  const sourceStage = assertSourceFrameworkGuidance({ source: frameworkGuidanceSource, plan, runtimeInstanceId })
  assertLatestWorkingDraftRetryState({
    latest: latestWorkingDraft,
    plan,
    sourceStage,
    runtimeInstanceId,
  })
  if (latestWorkingDraft?.status === SUCCESS_STATUS) {
    return assertExistingSuccessLineage({
      latest: latestWorkingDraft,
      models,
      providerDescriptor,
      runtimeInstanceId,
      sourceStage,
      plan,
    })
  }

  const expectedLatestAttemptNumber = Number(latestWorkingDraft?.attemptNumber || 0)
  const runtimeVersion = toIso(runtime.updatedAt)
  if (!runtimeVersion) throw bindingInvalid({ field: 'runtimeVersion' })
  const bindingFingerprint = buildBindingFingerprint({ plan, sourceStage, expectedLatestAttemptNumber })
  const providerInput = buildProviderInput({ plan })
  assertProviderInputSelectorShape(providerInput)
  const knowledgeFacade = buildKnowledgeFacade({ plan })
  const idempotencyKey = [
    'WORKING_DRAFT',
    plan.planId,
    `v${plan.planVersion}`,
    bindingFingerprint.slice(0, 24),
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
        outputTypeKey: 'WORKING_DRAFT',
        requestedOutputTypeKey: providerInput.request.requestedOutputTypeKey,
        requestedStyleKey: 'governed-working-draft',
        executionIntent: 'Generate a governed Working Draft from the successful Framework Guidance source.',
        idempotencyKey,
        workspaceType: 'PLATFORM',
        manifestId: idempotencyKey,
      },
      deps: {
        executionMode: 'LIVE_TEST',
        providerAdapter,
        providerDescriptor,
        providerInput,
        resolveKnowledgeBinding: async () => knowledgeFacade,
        buildProviderSafeContext: async (contextArgs) => buildOutcomeQualityStageProviderSafeContext({
          ...contextArgs,
          sourceStageExecution: sourceStage,
          targetStageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
          truthSource: projectWorkingDraftTruthSource(contextArgs.truthSource),
        }),
        assertProviderSafeContext: assertOutcomeQualityStageProviderSafeContext,
        providerContextContractVersion: OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
        providerContextBindingFingerprint: bindingFingerprint,
      },
      runtimeInstanceId,
      scopes,
    })
  } catch (error) {
    if (!providerFailure(error)) throw error
    return persistProviderFailure({
      actorUserId,
      createStage,
      error,
      expectedLatestAttemptNumber,
      expectedPlanFingerprint,
      plan,
      providerDescriptor,
      runtimeInstanceId,
      runtimeVersion,
      sourceStage,
      stageDeps: { ...(deps.stageDeps || {}), latestWorkingDraft },
      startedAt,
    })
  }

  const artifact = grrExecution?.artifact
  const grrExecutionId = text(grrExecution?.executionId)
  const grrRuntimeArtifactId = text(artifact?.runtimeArtifactId)
  const generatedOutput = artifact?.generatedOutput
  const requestedAt = toIso(grrExecution?.requestedAt)
  const completedAt = toIso(grrExecution?.completedAt)
  if (!grrExecutionId || !grrRuntimeArtifactId || !generatedOutput || !requestedAt || !completedAt) {
    throw lineageInvalid({ field: 'grrResult' })
  }
  assertProviderIdentity({ provider: grrExecution.provider, providerDescriptor })
  const stageOutput = buildWorkingDraftStageOutputFromProviderOutput({
    providerOutput: generatedOutput,
    plan,
    sourceStage,
  })
  const stageArgs = {
    plan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    expectedLatestAttemptNumber,
    predecessorStageExecutionId: expectedLatestAttemptNumber > 0
      ? latestWorkingDraft.stageExecutionId
      : sourceStage.stageExecutionId,
    predecessorAttemptFingerprint: expectedLatestAttemptNumber > 0
      ? latestWorkingDraft.attemptFingerprint
      : sourceStage.attemptFingerprint,
    sourceStageExecution: sourceStage,
    status: SUCCESS_STATUS,
    output: stageOutput,
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey: lower(providerDescriptor.providerKey),
      providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
      model: text(providerDescriptor.model),
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

export default executeOutcomeWorkingDraft
