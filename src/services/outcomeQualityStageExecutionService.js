import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

import {
  OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
  OUTCOME_KCP_STATUSES,
  OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_ERROR_CODES,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import {
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import { containsOutcomeWorkingDraftProhibitedStageClaim } from '../utils/outcomeWorkingDraftStageClaims.js'
import auditService from './auditService.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import { findOutcomeFrameworkGuidanceStageClaim } from '../utils/outcomeFrameworkGuidanceStageClaims.js'
import { buildExpressionOnlyRevisionSection } from '../utils/outcomeRenderedExpressionRevision.js'

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'Sharded'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const SUCCESS_OUTPUT_KEYS = Object.freeze([
  'outputType',
  'schemaVersion',
  'title',
  'sections',
  'decisionUsefulness',
  'assumptions',
  'visibleGaps',
])
const WORKING_DRAFT_OUTPUT_KEYS = Object.freeze([
  'outputType', 'schemaVersion', 'draftVersion', 'title', 'sections',
  'decisionLogic', 'compositionProvenance', 'revisionHistory', 'assumptions', 'visibleGaps',
])
const WORKING_DRAFT_SECTION_KEYS = Object.freeze([
  'order', 'sectionKey', 'title', 'content', 'claims', 'truthReferences',
  'contributingActivationIds', 'assumptions', 'gaps',
])
const WORKING_DRAFT_CLAIM_KEYS = Object.freeze(['claimKey', 'statement', 'truthReferences', 'evidence'])
const DECISION_LOGIC_KEYS = Object.freeze(['decisionKey', 'rationale', 'priority', 'truthReferences'])
const COMPOSITION_PROVENANCE_KEYS = Object.freeze([
  'frameworkGuidanceStageExecutionId', 'frameworkGuidanceOutputFingerprint', 'planFingerprint',
])
const REVISION_HISTORY_KEYS = Object.freeze([
  'version', 'summary', 'sourceStageExecutionId', 'sourceOutputFingerprint',
])
const ARL_OUTPUT_KEYS = Object.freeze([
  'outputType', 'schemaVersion', 'workingDraftStageExecutionId', 'workingDraftOutputFingerprint',
  'findings', 'approvedMeaning', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
])
const ARL_FINDING_KEYS = Object.freeze([
  'findingKey', 'dimension', 'severity', 'finding', 'requiredChange', 'disposition', 'changeApplied',
])
const APPROVED_MEANING_KEYS = Object.freeze([
  'state', 'version', 'workingDraftStageExecutionId', 'workingDraftOutputFingerprint',
  'meaningSummary', 'decisionLogic', 'meaningFingerprint', 'decisionLogicFingerprint',
])
const NARRATIVE_PLAN_OUTPUT_KEYS = Object.freeze([
  'outputType', 'schemaVersion', 'arlStageExecutionId', 'approvedMeaningFingerprint',
  'sections', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
])
const NARRATIVE_PLAN_SECTION_KEYS = Object.freeze([
  'order', 'sectionKey', 'heading', 'purpose', 'keyMessages', 'truthReferences',
  'qualification', 'diagramIntent',
])
const RENDERED_EXPRESSION_OUTPUT_KEYS = Object.freeze([
  'outputType', 'schemaVersion', 'narrativePlanStageExecutionId', 'narrativePlanOutputFingerprint',
  'candidateType', 'title', 'sections', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
])
const RENDERED_EXPRESSION_REVISION_OUTPUT_KEYS = Object.freeze([
  ...RENDERED_EXPRESSION_OUTPUT_KEYS,
  'candidateVersion', 'revisionScope', 'revisionOfStageExecutionId', 'revisionOfOutputFingerprint',
  'remediationSourceStageExecutionId', 'remediationSourceAttemptFingerprint',
  'remediationFailureCode', 'rlFindingFingerprint',
])
const RENDERED_EXPRESSION_SECTION_KEYS = Object.freeze([
  'order', 'elementId', 'sectionKey', 'heading', 'body', 'qualification', 'diagram', 'truthReferences',
])
const RENDERED_DIAGRAM_KEYS = Object.freeze(['present', 'description', 'accessibleText'])
const RL_OUTPUT_KEYS = Object.freeze([
  'outputType', 'schemaVersion', 'candidateStageExecutionId', 'candidateOutputFingerprint',
  'overallStatus', 'findings', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
])
const RL_FINDING_KEYS = Object.freeze(['dimension', 'status', 'finding', 'requiredChange'])
const RL_REQUIRED_DIMENSIONS = Object.freeze([
  'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
])
const SECTION_KEYS = Object.freeze([
  'order',
  'sectionKey',
  'title',
  'analysis',
  'implications',
  'recommendations',
  'qualification',
  'truthReferences',
  'contributingActivationIds',
  'assumptions',
  'gaps',
])
const DECISION_USEFULNESS_KEYS = Object.freeze([
  'summary',
  'priorities',
  'materialRisks',
  'recommendedNextStep',
])
const FAILURE_KEYS = Object.freeze(['failureCode', 'safeReason', 'retryable'])
const EXECUTION_IDENTITY_KEYS = Object.freeze([
  'executionMode',
  'providerKey',
  'providerConfigurationVersion',
  'model',
  'grrExecutionId',
  'grrRuntimeArtifactId',
  'runtimeVersion',
])
const FORBIDDEN_KEYS = new Set([
  'chainofthought',
  'credentials',
  'customercontent',
  'finaldisposition',
  'infographic',
  'outcomenarrativeplan',
  'packcontent',
  'presentation',
  'prompt',
  'promptassembly',
  'providercontext',
  'publication',
  'rawsource',
  'reasoningchain',
  'renderedexpression',
  'sourcecontent',
])
const STAGE_ORDERS = Object.freeze({
  [OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE]: 1,
  [OUTCOME_QUALITY_STAGES.WORKING_DRAFT]: 2,
  [OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW]: 3,
  [OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN]: 4,
  [OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING]: 5,
  [OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL]: 6,
})
const ARL_REQUIRED_DIMENSIONS = Object.freeze([
  'ANALYTICAL_STRENGTH',
  'COHERENCE',
  'PRIORITISATION',
  'EVIDENCE_USE',
  'DECISION_USEFULNESS',
])
const PROVIDER_REQUIRED_STAGES = new Set([
  OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
  OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
  OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
])
const toPlain = (value) => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const toId = (value) => value?.toString ? value.toString() : String(value || '')
const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()
const normalizeKeyName = (value) => lower(value).replace(/[^a-z0-9]/g, '')
const toIso = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

const canonicalize = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key !== '_id' && key !== '__v' && value[key] !== undefined) {
        result[key] = canonicalize(value[key])
      }
      return result
    }, {})
  }
  return value
}

export const hashOutcomeQualityStageValue = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex')

const appError = (status, code, message, details = {}) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = { reason: code, ...details }
  return error
}

const invalid = (message, details) => appError(422, OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID, message, details)
const kcpInvalid = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.KCP_INVALID, 'Outcome quality stage requires an intact persisted Knowledge Composition Plan.', details)
const kcpNotEligible = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.KCP_NOT_ELIGIBLE, 'Outcome quality stage Knowledge Composition Plan is not eligible.', details)
const stageNotSupported = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_NOT_SUPPORTED, 'Outcome quality stage is not supported by this execution contract.', details)
const stageBindingInvalid = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_BINDING_INVALID, 'Outcome quality stage binding does not match the Knowledge Composition Plan.', details)
const fingerprintMismatch = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.FINGERPRINT_MISMATCH, 'Outcome quality stage fingerprint does not match the approved candidate.', details)
const versionConflict = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.VERSION_CONFLICT, 'Outcome quality stage attempt conflicts with the current stage history.', details)
const predecessorInvalid = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID, 'Outcome quality stage retry predecessor is invalid.', details)
const retryNotAllowed = (details) => appError(409, OUTCOME_QUALITY_STAGE_ERROR_CODES.RETRY_NOT_ALLOWED, 'Outcome quality stage cannot retry after a successful attempt.', details)
const transactionRequired = () => appError(503, OUTCOME_QUALITY_STAGE_ERROR_CODES.TRANSACTION_REQUIRED, 'Outcome quality stage persistence requires MongoDB transaction support.')
const auditFailed = () => appError(503, OUTCOME_QUALITY_STAGE_ERROR_CODES.AUDIT_FAILED, 'Outcome quality stage audit persistence failed.')
const persistenceFailed = () => appError(503, OUTCOME_QUALITY_STAGE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome quality stage persistence failed.')

const hasExactKeys = (value, keys) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)),
)

const assertNoForbiddenKeys = (value, path = 'value') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKeyName(key))) throw invalid('Outcome quality stage payload contains a prohibited field.', { path: `${path}.${key}` })
    assertNoForbiddenKeys(nested, `${path}.${key}`)
  }
}

const boundedText = (value, { allowLineBreaks = false, field, min = 0, max }) => {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length < min
    || value.length > max
    || (allowLineBreaks ? MULTILINE_CONTROL_PATTERN : CONTROL_PATTERN).test(value)) {
    throw invalid('Outcome quality stage text field is invalid.', { field, min, max })
  }
  return value
}

const boundedStringArray = (value, { field, min = 0, max, itemMax }) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw invalid('Outcome quality stage array field is invalid.', { field, min, max })
  }
  return value.map((item, index) => boundedText(item, {
    field: `${field}[${index}]`,
    min: 1,
    max: itemMax,
  }))
}

const boundedArray = (value, { field, min = 0, max }) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw invalid('Outcome quality stage array field is invalid.', { field, min, max })
  }
  return value
}

const sameOrderedValues = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sameSet = (left, right) => sameOrderedValues([...new Set(left)].sort(), [...new Set(right)].sort())

const normalizeExecutionIdentity = (value, { succeeded, stageKey }) => {
  if (!hasExactKeys(value, EXECUTION_IDENTITY_KEYS)) throw invalid('Outcome quality stage execution identity is invalid.')
  const generatedStageSucceeded = succeeded && PROVIDER_REQUIRED_STAGES.has(stageKey)
  const result = {
    executionMode: boundedText(value.executionMode, { field: 'executionIdentity.executionMode', min: 1, max: 80 }).toUpperCase(),
    providerKey: boundedText(value.providerKey, {
      field: 'executionIdentity.providerKey',
      min: generatedStageSucceeded ? 1 : 0,
      max: 140,
    }).toLowerCase(),
    providerConfigurationVersion: boundedText(value.providerConfigurationVersion, {
      field: 'executionIdentity.providerConfigurationVersion',
      min: generatedStageSucceeded ? 1 : 0,
      max: 160,
    }),
    model: boundedText(value.model, {
      field: 'executionIdentity.model',
      min: generatedStageSucceeded ? 1 : 0,
      max: 160,
    }),
    grrExecutionId: boundedText(value.grrExecutionId, {
      field: 'executionIdentity.grrExecutionId',
      min: generatedStageSucceeded ? 1 : 0,
      max: 180,
    }),
    grrRuntimeArtifactId: boundedText(value.grrRuntimeArtifactId, {
      field: 'executionIdentity.grrRuntimeArtifactId',
      min: generatedStageSucceeded ? 1 : 0,
      max: 180,
    }),
    runtimeVersion: boundedText(value.runtimeVersion, { field: 'executionIdentity.runtimeVersion', min: 1, max: 80 }),
  }
  if (result.providerKey && !STABLE_KEY_PATTERN.test(result.providerKey)) {
    throw invalid('Outcome quality stage provider identity is invalid.')
  }
  if (Boolean(result.providerKey) !== Boolean(result.providerConfigurationVersion)
    || (result.providerConfigurationVersion
      && !(OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS[stageKey] || [])
        .includes(result.providerConfigurationVersion))) {
    throw invalid('Outcome quality stage provider configuration identity is invalid.')
  }
  return result
}

const buildQualityRunId = (plan) => `quality_run_${hashOutcomeQualityStageValue({
  tenantId: plan.tenantId,
  customerId: plan.customerId,
  runtimeInstanceId: plan.runtimeInstanceId,
  planId: plan.planId,
  planVersion: plan.planVersion,
  planFingerprint: plan.planFingerprint,
}).slice(0, 40)}`

const safeGapText = (gap, fallback) => {
  if (typeof gap === 'string') return text(gap)
  if (!gap || typeof gap !== 'object') return fallback
  return text(gap.message || gap.safeReason || gap.reason || gap.code || gap.packKey || fallback)
}

export const buildOutcomeQualityVisibleGaps = (plan) => {
  const resolution = plan.payload?.resolution || {}
  const governedContext = plan.payload?.governedContext || {}
  const entries = [
    ...(Array.isArray(plan.payload?.consumerIntent?.unresolvedGaps)
      ? plan.payload.consumerIntent.unresolvedGaps.map((gap) => safeGapText(gap, 'Unresolved consumer-intent gap.'))
      : []),
    ...(Array.isArray(resolution.missingDependencies)
      ? resolution.missingDependencies
        .filter((gap) => upper(gap?.requirement) === 'OPTIONAL')
        .map((gap) => safeGapText(gap, 'Optional knowledge dependency is unavailable.'))
      : []),
    ...(Array.isArray(resolution.warnings)
      ? resolution.warnings.map((gap) => safeGapText(gap, 'Knowledge resolution warning.'))
      : []),
    ...(Array.isArray(governedContext.warnings)
      ? governedContext.warnings.map((gap) => safeGapText(gap, 'Governed context warning.'))
      : []),
  ]
  return entries.filter(Boolean)
}

const normalizeSourceStageExecution = ({ value, plan, stageKey }) => {
  if (stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE) {
    if (value) throw predecessorInvalid({ field: 'sourceStageExecution' })
    return undefined
  }
  const expectedOrder = STAGE_ORDERS[stageKey] - 1
  const expectedStageKey = OUTCOME_QUALITY_STAGE_SEQUENCE[expectedOrder - 1]
  const expectedOutputType = {
    [OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE]: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
    [OUTCOME_QUALITY_STAGES.WORKING_DRAFT]: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
    [OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW]: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
    [OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN]: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
    [OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING]: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
  }[expectedStageKey]
  const expectedSchemaVersion = {
    [OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE]: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
    [OUTCOME_QUALITY_STAGES.WORKING_DRAFT]: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
    [OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW]: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
    [OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN]: OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
    [OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING]: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
  }[expectedStageKey]
  const source = toPlain(value)
  if (!source
    || source.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || source.stageKey !== expectedStageKey
    || Number(source.stageOrder) !== expectedOrder
    || toId(source.runtimeInstanceId) !== toId(plan.runtimeInstanceId)
    || text(source.planId) !== text(plan.planId)
    || lower(source.planFingerprint) !== lower(plan.planFingerprint)
    || !text(source.stageExecutionId)
    || !SHA256_PATTERN.test(lower(source.attemptFingerprint))
    || !SHA256_PATTERN.test(lower(source.outputFingerprint))
    || !source.outputSnapshot
    || upper(source.outputSnapshot.outputType) !== expectedOutputType
    || text(source.outputSnapshot.schemaVersion) !== expectedSchemaVersion) {
    throw predecessorInvalid({ field: 'sourceStageExecution', expectedStageKey })
  }
  const normalized = {
    stageExecutionId: text(source.stageExecutionId),
    stageKey: source.stageKey,
    stageOrder: Number(source.stageOrder),
    attemptNumber: Number(source.attemptNumber),
    attemptFingerprint: lower(source.attemptFingerprint),
    outputFingerprint: lower(source.outputFingerprint),
    outputType: upper(source.outputSnapshot.outputType),
    schemaVersion: text(source.outputSnapshot.schemaVersion),
    decisionLogicFingerprint: expectedStageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT
      ? hashOutcomeQualityStageValue(source.outputSnapshot.decisionLogic)
      : '',
  }
  return normalized
}

const buildStageInputSnapshot = (plan, stage, sourceStageExecution) => {
  const selectedPacks = Array.isArray(plan.payload?.resolution?.selectedPacks)
    ? plan.payload.resolution.selectedPacks
    : []
  const assignedIds = [...stage.assignedActivationIds].map(text).sort()
  const assignedPacks = assignedIds.map((activationId) => {
    const pack = selectedPacks.find((candidate) => text(candidate.activationId) === activationId)
    if (!pack
      || !text(pack.versionId)
      || !CONTENT_HASH_PATTERN.test(lower(pack.contentHash))
      || !Array.isArray(pack.stageAssignments)
      || !pack.stageAssignments.includes(stage.stageKey)) {
      throw stageBindingInvalid({ activationId })
    }
    return {
      activationId,
      packId: text(pack.packId),
      versionId: text(pack.versionId),
      contentHash: lower(pack.contentHash),
      packType: upper(pack.packType),
      packKey: lower(pack.packKey),
      knowledgeLayer: upper(pack.knowledgeLayer),
      executionMode: upper(pack.executionMode),
      requirement: upper(pack.requirement),
      stageRole: stage.stageKey,
    }
  })
  if (stage.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE && assignedPacks.length < 1) {
    throw stageBindingInvalid({ field: 'assignedActivationIds' })
  }
  const markedIdentity = plan.payload.lockedTruth.acceptedTruthIdentityContractVersion
    === OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION
  const acceptedSections = plan.payload.lockedTruth.acceptedSections.map((section) => ({
    sectionKey: lower(section.sectionKey),
    ...(markedIdentity ? { stateSectionKey: lower(section.stateSectionKey) } : {}),
    runtimePath: text(section.runtimePath),
    truthHash: lower(section.truthHash),
  })).sort((left, right) => left.sectionKey.localeCompare(right.sectionKey))
  const consumerIntent = canonicalize(plan.payload.consumerIntent || {})
  const sourceStage = normalizeSourceStageExecution({
    value: sourceStageExecution,
    plan,
    stageKey: stage.stageKey,
  })
  return {
    plan: {
      recordId: toId(plan._id || plan.id),
      planId: text(plan.planId),
      planVersion: Number(plan.planVersion),
      planFingerprint: lower(plan.planFingerprint),
      resolutionFingerprint: lower(plan.resolutionFingerprint),
      contextFingerprint: lower(plan.contextFingerprint),
    },
    lockedTruth: {
      ...(markedIdentity ? {
        acceptedTruthIdentityContractVersion: OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
      } : {}),
      publishSnapshotId: text(plan.publishSnapshotId),
      publishSnapshotHash: lower(plan.payload.lockedTruth.publishSnapshotHash),
      lockSnapshotId: text(plan.lockSnapshotId),
      lockSnapshotHash: lower(plan.payload.lockedTruth.lockSnapshotHash),
      replayAnchorId: text(plan.replayAnchorId),
      replayAnchorHash: lower(plan.payload.lockedTruth.replayAnchorHash),
      dependencySnapshotId: text(plan.dependencySnapshotId),
      dependencySnapshotHash: lower(plan.payload.lockedTruth.dependencySnapshotHash),
      acceptedSectionCount: acceptedSections.length,
      acceptedSections,
    },
    consumerIntent,
    consumerIntentFingerprint: hashOutcomeQualityStageValue(consumerIntent),
    stage: {
      stageKey: stage.stageKey,
      stageOrder: Number(stage.order),
      assignedActivationCount: assignedPacks.length,
      assignedPacks,
    },
    ...(sourceStage ? { sourceStage } : {}),
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const normalizeFrameworkGuidanceOutput = (value, inputSnapshot) => {
  if (!hasExactKeys(value, SUCCESS_OUTPUT_KEYS)) throw invalid('Framework/guidance output shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  const outputType = upper(value.outputType)
  if (outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS
    || value.schemaVersion !== OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION) {
    throw invalid('Framework/guidance output type or schema version is invalid.')
  }
  const title = boundedText(value.title, { field: 'output.title', min: 1, max: 255 })
  const assumptions = boundedStringArray(value.assumptions, {
    field: 'output.assumptions', max: 20, itemMax: 2000,
  })
  const visibleGaps = boundedStringArray(value.visibleGaps, {
    field: 'output.visibleGaps', max: 50, itemMax: 2000,
  })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) {
    throw stageBindingInvalid({ field: 'visibleGaps' })
  }
  if (!hasExactKeys(value.decisionUsefulness, DECISION_USEFULNESS_KEYS)) {
    throw invalid('Framework/guidance decision-usefulness shape is invalid.')
  }
  const decisionUsefulness = {
    summary: boundedText(value.decisionUsefulness.summary, {
      field: 'output.decisionUsefulness.summary', min: 1, max: 4000,
    }),
    priorities: boundedStringArray(value.decisionUsefulness.priorities, {
      field: 'output.decisionUsefulness.priorities', min: 1, max: 20, itemMax: 2000,
    }),
    materialRisks: boundedStringArray(value.decisionUsefulness.materialRisks, {
      field: 'output.decisionUsefulness.materialRisks', max: 20, itemMax: 2000,
    }),
    recommendedNextStep: boundedText(value.decisionUsefulness.recommendedNextStep, {
      field: 'output.decisionUsefulness.recommendedNextStep', min: 1, max: 2000,
    }),
  }
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 20) {
    throw invalid('Framework/guidance sections are invalid.')
  }
  const allowedTruthReferences = inputSnapshot.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const allowedActivations = inputSnapshot.stage.assignedPacks.map((pack) => pack.activationId)
  const sections = value.sections.map((section, index) => {
    if (!hasExactKeys(section, SECTION_KEYS) || typeof section.order !== 'number' || section.order !== index + 1) {
      throw invalid('Framework/guidance section shape or order is invalid.', { index })
    }
    const sectionKey = lower(section.sectionKey)
    if (!STABLE_KEY_PATTERN.test(sectionKey)) throw invalid('Framework/guidance section key is invalid.', { index })
    const truthReferences = boundedStringArray(section.truthReferences, {
      field: `output.sections[${index}].truthReferences`, min: 1, max: 50, itemMax: 140,
    }).map(lower)
    const contributingActivationIds = boundedStringArray(section.contributingActivationIds, {
      field: `output.sections[${index}].contributingActivationIds`, min: 1, max: 50, itemMax: 180,
    })
    if (new Set(truthReferences).size !== truthReferences.length
      || truthReferences.some((reference) => !allowedTruthReferences.includes(reference))
      || new Set(contributingActivationIds).size !== contributingActivationIds.length
      || contributingActivationIds.some((activationId) => !allowedActivations.includes(activationId))) {
      throw stageBindingInvalid({ field: `sections[${index}].references` })
    }
    return {
      order: index + 1,
      sectionKey,
      title: boundedText(section.title, { field: `output.sections[${index}].title`, min: 1, max: 255 }),
      analysis: boundedText(section.analysis, { field: `output.sections[${index}].analysis`, min: 1, max: 12000 }),
      implications: boundedStringArray(section.implications, {
        field: `output.sections[${index}].implications`, min: 1, max: 20, itemMax: 2000,
      }),
      recommendations: boundedStringArray(section.recommendations, {
        field: `output.sections[${index}].recommendations`, max: 20, itemMax: 2000,
      }),
      qualification: boundedText(section.qualification, {
        field: `output.sections[${index}].qualification`, max: 2000,
      }),
      truthReferences,
      contributingActivationIds,
      assumptions: boundedStringArray(section.assumptions, {
        field: `output.sections[${index}].assumptions`, max: 20, itemMax: 2000,
      }),
      gaps: boundedStringArray(section.gaps, {
        field: `output.sections[${index}].gaps`, max: 20, itemMax: 2000,
      }),
    }
  })
  if (new Set(sections.map((section) => section.sectionKey)).size !== sections.length) {
    throw invalid('Framework/guidance section keys must be unique.')
  }
  if (!sameSet(sections.flatMap((section) => section.truthReferences), allowedTruthReferences)
    || !sameSet(sections.flatMap((section) => section.contributingActivationIds), allowedActivations)) {
    throw stageBindingInvalid({ field: 'coverage' })
  }
  const normalized = {
    outputType,
    schemaVersion: value.schemaVersion,
    title,
    sections,
    decisionUsefulness,
    assumptions,
    visibleGaps,
  }
  if (findOutcomeFrameworkGuidanceStageClaim(normalized)) {
    throw invalid('Framework/guidance output claims a later governed stage.')
  }
  return normalized
}

const normalizeWorkingDraftOutput = (value, inputSnapshot, sourceStageExecution) => {
  if (!hasExactKeys(value, WORKING_DRAFT_OUTPUT_KEYS)) throw invalid('Working Draft output shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  if (upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT
    || value.schemaVersion !== OUTCOME_WORKING_DRAFT_SCHEMA_VERSION
    || typeof value.draftVersion !== 'number'
    || !Number.isInteger(value.draftVersion)
    || value.draftVersion < 1) {
    throw invalid('Working Draft output identity is invalid.')
  }
  const source = toPlain(sourceStageExecution)
  const visibleGaps = boundedStringArray(value.visibleGaps, {
    field: 'output.visibleGaps', max: 50, itemMax: 2000,
  })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) {
    throw stageBindingInvalid({ field: 'visibleGaps' })
  }
  const allowedTruth = inputSnapshot.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const allowedActivations = [...new Set(source.outputSnapshot.sections
    .flatMap((section) => section.contributingActivationIds || []))]
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 20) {
    throw invalid('Working Draft sections are invalid.')
  }
  const sections = value.sections.map((section, index) => {
    if (!hasExactKeys(section, WORKING_DRAFT_SECTION_KEYS)
      || section.order !== index + 1
      || !Array.isArray(section.claims)
      || section.claims.length < 1
      || section.claims.length > 50) {
      throw invalid('Working Draft section shape is invalid.', { index })
    }
    const sectionKey = lower(section.sectionKey)
    if (!STABLE_KEY_PATTERN.test(sectionKey)) throw invalid('Working Draft section key is invalid.', { index })
    const truthReferences = boundedStringArray(section.truthReferences, {
      field: `output.sections[${index}].truthReferences`, min: 1, max: 50, itemMax: 140,
    }).map(lower)
    const contributingActivationIds = boundedStringArray(section.contributingActivationIds, {
      field: `output.sections[${index}].contributingActivationIds`, min: 1, max: 50, itemMax: 180,
    })
    if (new Set(truthReferences).size !== truthReferences.length
      || truthReferences.some((item) => !allowedTruth.includes(item))
      || new Set(contributingActivationIds).size !== contributingActivationIds.length
      || contributingActivationIds.some((item) => !allowedActivations.includes(item))) {
      throw stageBindingInvalid({ field: `sections[${index}].references` })
    }
    const claims = section.claims.map((claim, claimIndex) => {
      if (!hasExactKeys(claim, WORKING_DRAFT_CLAIM_KEYS)) {
        throw invalid('Working Draft claim shape is invalid.', { index, claimIndex })
      }
      const claimKey = lower(claim.claimKey)
      const claimTruth = boundedStringArray(claim.truthReferences, {
        field: `output.sections[${index}].claims[${claimIndex}].truthReferences`, min: 1, max: 20, itemMax: 140,
      }).map(lower)
      if (!STABLE_KEY_PATTERN.test(claimKey)
        || new Set(claimTruth).size !== claimTruth.length
        || claimTruth.some((item) => !truthReferences.includes(item))) {
        throw stageBindingInvalid({ field: `sections[${index}].claims[${claimIndex}]` })
      }
      return {
        claimKey,
        statement: boundedText(claim.statement, {
          field: `output.sections[${index}].claims[${claimIndex}].statement`, min: 1, max: 4000,
        }),
        truthReferences: claimTruth,
        evidence: boundedStringArray(claim.evidence, {
          field: `output.sections[${index}].claims[${claimIndex}].evidence`, min: 1, max: 20, itemMax: 2000,
        }),
      }
    })
    if (new Set(claims.map((claim) => claim.claimKey)).size !== claims.length
      || !sameSet(claims.flatMap((claim) => claim.truthReferences), truthReferences)) {
      throw stageBindingInvalid({ field: `sections[${index}].claimCoverage` })
    }
    return {
      order: index + 1,
      sectionKey,
      title: boundedText(section.title, { field: `output.sections[${index}].title`, min: 1, max: 255 }),
      content: boundedText(section.content, {
        allowLineBreaks: true,
        field: `output.sections[${index}].content`,
        min: 1,
        max: 16000,
      }),
      claims,
      truthReferences,
      contributingActivationIds,
      assumptions: boundedStringArray(section.assumptions, {
        field: `output.sections[${index}].assumptions`, max: 20, itemMax: 2000,
      }),
      gaps: boundedStringArray(section.gaps, {
        field: `output.sections[${index}].gaps`, max: 20, itemMax: 2000,
      }),
    }
  })
  if (new Set(sections.map((section) => section.sectionKey)).size !== sections.length
    || !sameSet(sections.flatMap((section) => section.truthReferences), allowedTruth)
    || !sameSet(sections.flatMap((section) => section.contributingActivationIds), allowedActivations)) {
    throw stageBindingInvalid({ field: 'coverage' })
  }
  if (!Array.isArray(value.decisionLogic) || value.decisionLogic.length < 1 || value.decisionLogic.length > 30) {
    throw invalid('Working Draft decision logic is invalid.')
  }
  const decisionLogic = value.decisionLogic.map((decision, index) => {
    if (!hasExactKeys(decision, DECISION_LOGIC_KEYS)) throw invalid('Working Draft decision logic shape is invalid.', { index })
    const decisionKey = lower(decision.decisionKey)
    const truthReferences = boundedStringArray(decision.truthReferences, {
      field: `output.decisionLogic[${index}].truthReferences`, min: 1, max: 20, itemMax: 140,
    }).map(lower)
    if (!STABLE_KEY_PATTERN.test(decisionKey) || truthReferences.some((item) => !allowedTruth.includes(item))) {
      throw stageBindingInvalid({ field: `decisionLogic[${index}]` })
    }
    return {
      decisionKey,
      rationale: boundedText(decision.rationale, { field: `output.decisionLogic[${index}].rationale`, min: 1, max: 4000 }),
      priority: boundedText(decision.priority, { field: `output.decisionLogic[${index}].priority`, min: 1, max: 100 }).toUpperCase(),
      truthReferences,
    }
  })
  if (new Set(decisionLogic.map((item) => item.decisionKey)).size !== decisionLogic.length) {
    throw invalid('Working Draft decision keys must be unique.')
  }
  if (!hasExactKeys(value.compositionProvenance, COMPOSITION_PROVENANCE_KEYS)) {
    throw invalid('Working Draft composition provenance is invalid.')
  }
  const compositionProvenance = {
    frameworkGuidanceStageExecutionId: boundedText(value.compositionProvenance.frameworkGuidanceStageExecutionId, { field: 'output.compositionProvenance.frameworkGuidanceStageExecutionId', min: 1, max: 180 }),
    frameworkGuidanceOutputFingerprint: lower(value.compositionProvenance.frameworkGuidanceOutputFingerprint),
    planFingerprint: lower(value.compositionProvenance.planFingerprint),
  }
  if (compositionProvenance.frameworkGuidanceStageExecutionId !== source.stageExecutionId
    || compositionProvenance.frameworkGuidanceOutputFingerprint !== lower(source.outputFingerprint)
    || compositionProvenance.planFingerprint !== inputSnapshot.plan.planFingerprint) {
    throw predecessorInvalid({ field: 'compositionProvenance' })
  }
  if (!Array.isArray(value.revisionHistory) || value.revisionHistory.length !== value.draftVersion) {
    throw invalid('Working Draft revision history is invalid.')
  }
  const revisionHistory = value.revisionHistory.map((revision, index) => {
    if (!hasExactKeys(revision, REVISION_HISTORY_KEYS) || revision.version !== index + 1) {
      throw invalid('Working Draft revision history shape is invalid.', { index })
    }
    const normalized = {
      version: index + 1,
      summary: boundedText(revision.summary, { field: `output.revisionHistory[${index}].summary`, min: 1, max: 2000 }),
      sourceStageExecutionId: boundedText(revision.sourceStageExecutionId, { field: `output.revisionHistory[${index}].sourceStageExecutionId`, min: 1, max: 180 }),
      sourceOutputFingerprint: lower(revision.sourceOutputFingerprint),
    }
    if (normalized.sourceStageExecutionId !== source.stageExecutionId
      || normalized.sourceOutputFingerprint !== lower(source.outputFingerprint)) {
      throw predecessorInvalid({ field: `revisionHistory[${index}]` })
    }
    return normalized
  })
  const normalized = {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
    schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
    draftVersion: value.draftVersion,
    title: boundedText(value.title, { field: 'output.title', min: 1, max: 255 }),
    sections,
    decisionLogic,
    compositionProvenance,
    revisionHistory,
    assumptions: boundedStringArray(value.assumptions, { field: 'output.assumptions', max: 20, itemMax: 2000 }),
    visibleGaps,
  }
  if (containsOutcomeWorkingDraftProhibitedStageClaim(normalized)) {
    throw invalid('Working Draft output claims ARL approval or a later governed stage.')
  }
  return normalized
}

const normalizeArlMeaningReviewOutput = (value, inputSnapshot, sourceStageExecution) => {
  if (!hasExactKeys(value, ARL_OUTPUT_KEYS)) throw invalid('ARL meaning-review output shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  const source = toPlain(sourceStageExecution)
  if (upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW
    || value.schemaVersion !== OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION
    || text(value.workingDraftStageExecutionId) !== text(source.stageExecutionId)
    || lower(value.workingDraftOutputFingerprint) !== lower(source.outputFingerprint)) {
    throw predecessorInvalid({ field: 'workingDraftIdentity' })
  }
  const visibleGaps = boundedStringArray(value.visibleGaps, { field: 'output.visibleGaps', max: 50, itemMax: 2000 })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) throw stageBindingInvalid({ field: 'visibleGaps' })
  const allowedTruth = inputSnapshot.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const truthReferences = boundedStringArray(value.truthReferences, {
    field: 'output.truthReferences', min: 1, max: 100, itemMax: 140,
  }).map(lower)
  const contributingActivationIds = boundedStringArray(value.contributingActivationIds, {
    field: 'output.contributingActivationIds', min: 1, max: 100, itemMax: 180,
  })
  const allowedActivations = inputSnapshot.stage.assignedPacks.map((pack) => pack.activationId)
  if (!sameSet(truthReferences, allowedTruth) || !sameSet(contributingActivationIds, allowedActivations)) {
    throw stageBindingInvalid({ field: 'arlCoverage' })
  }
  if (!Array.isArray(value.findings) || value.findings.length < 1 || value.findings.length > 100) {
    throw invalid('ARL findings are invalid.')
  }
  const findings = value.findings.map((finding, index) => {
    if (!hasExactKeys(finding, ARL_FINDING_KEYS) || typeof finding.requiredChange !== 'boolean' || typeof finding.changeApplied !== 'boolean') {
      throw invalid('ARL finding shape is invalid.', { index })
    }
    const result = {
      findingKey: lower(finding.findingKey),
      dimension: boundedText(finding.dimension, { field: `output.findings[${index}].dimension`, min: 1, max: 100 }).toUpperCase(),
      severity: boundedText(finding.severity, { field: `output.findings[${index}].severity`, min: 1, max: 40 }).toUpperCase(),
      finding: boundedText(finding.finding, { field: `output.findings[${index}].finding`, min: 1, max: 4000 }),
      requiredChange: finding.requiredChange,
      disposition: boundedText(finding.disposition, { field: `output.findings[${index}].disposition`, min: 1, max: 100 }).toUpperCase(),
      changeApplied: finding.changeApplied,
    }
    if (!STABLE_KEY_PATTERN.test(result.findingKey)
      || !ARL_REQUIRED_DIMENSIONS.includes(result.dimension)
      || result.severity === 'BLOCKING' && !result.requiredChange
      || (result.requiredChange && (result.disposition !== 'APPLIED' || !result.changeApplied))) {
      throw invalid('ARL cannot approve unresolved required changes.', { index })
    }
    return result
  })
  if (new Set(findings.map((item) => item.findingKey)).size !== findings.length
    || !sameSet(findings.map((item) => item.dimension), ARL_REQUIRED_DIMENSIONS)) {
    throw invalid('ARL findings must cover every required meaning-review dimension exactly.')
  }
  if (!hasExactKeys(value.approvedMeaning, APPROVED_MEANING_KEYS)) throw invalid('ARL approved-meaning shape is invalid.')
  const expectedDecisionLogicFingerprint = hashOutcomeQualityStageValue(source.outputSnapshot.decisionLogic)
  const expectedMeaningFingerprint = hashOutcomeQualityStageValue({
    workingDraftStageExecutionId: source.stageExecutionId,
    workingDraftOutputFingerprint: source.outputFingerprint,
    decisionLogicFingerprint: expectedDecisionLogicFingerprint,
  })
  const approvedMeaning = {
    state: upper(value.approvedMeaning.state),
    version: value.approvedMeaning.version,
    workingDraftStageExecutionId: text(value.approvedMeaning.workingDraftStageExecutionId),
    workingDraftOutputFingerprint: lower(value.approvedMeaning.workingDraftOutputFingerprint),
    meaningSummary: boundedText(value.approvedMeaning.meaningSummary, { field: 'output.approvedMeaning.meaningSummary', min: 1, max: 8000 }),
    decisionLogic: canonicalize(value.approvedMeaning.decisionLogic),
    meaningFingerprint: lower(value.approvedMeaning.meaningFingerprint),
    decisionLogicFingerprint: lower(value.approvedMeaning.decisionLogicFingerprint),
  }
  if (approvedMeaning.state !== 'APPROVED'
    || typeof approvedMeaning.version !== 'number'
    || !Number.isInteger(approvedMeaning.version)
    || approvedMeaning.version < 1
    || approvedMeaning.workingDraftStageExecutionId !== source.stageExecutionId
    || approvedMeaning.workingDraftOutputFingerprint !== lower(source.outputFingerprint)
    || approvedMeaning.meaningFingerprint !== expectedMeaningFingerprint
    || approvedMeaning.decisionLogicFingerprint !== expectedDecisionLogicFingerprint
    || JSON.stringify(approvedMeaning.decisionLogic) !== JSON.stringify(canonicalize(source.outputSnapshot.decisionLogic))) {
    throw invalid('ARL approved meaning does not match the reviewed Working Draft.')
  }
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
    schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
    workingDraftStageExecutionId: text(source.stageExecutionId),
    workingDraftOutputFingerprint: lower(source.outputFingerprint),
    findings,
    approvedMeaning,
    truthReferences,
    contributingActivationIds,
    visibleGaps,
  }
}

const normalizeNarrativePlanOutput = (value, inputSnapshot, sourceStageExecution) => {
  if (!hasExactKeys(value, NARRATIVE_PLAN_OUTPUT_KEYS)) throw invalid('Outcome Narrative Plan shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  const source = toPlain(sourceStageExecution)
  const meaningFingerprint = lower(source?.outputSnapshot?.approvedMeaning?.meaningFingerprint)
  if (upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN
    || value.schemaVersion !== OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION
    || text(value.arlStageExecutionId) !== text(source?.stageExecutionId)
    || lower(value.approvedMeaningFingerprint) !== meaningFingerprint
    || !SHA256_PATTERN.test(meaningFingerprint)) throw predecessorInvalid({ field: 'arlMeaningIdentity' })
  const allowedTruth = inputSnapshot.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const sections = boundedArray(value.sections, { field: 'output.sections', min: 1, max: 20 })
    .map((section, index) => {
      if (!hasExactKeys(section, NARRATIVE_PLAN_SECTION_KEYS)
        || section.order !== index + 1
        || !STABLE_KEY_PATTERN.test(lower(section.sectionKey))) throw invalid('Narrative Plan section is invalid.', { index })
      const truthReferences = boundedStringArray(section.truthReferences, {
        field: `output.sections[${index}].truthReferences`, min: 1, max: 50, itemMax: 140,
      }).map(lower)
      if (truthReferences.some((reference) => !allowedTruth.includes(reference))) {
        throw stageBindingInvalid({ field: `output.sections[${index}].truthReferences` })
      }
      return {
        order: section.order,
        sectionKey: lower(section.sectionKey),
        heading: boundedText(section.heading, { field: `output.sections[${index}].heading`, min: 1, max: 255 }),
        purpose: boundedText(section.purpose, { field: `output.sections[${index}].purpose`, min: 1, max: 2000 }),
        keyMessages: boundedStringArray(section.keyMessages, {
          field: `output.sections[${index}].keyMessages`, min: 1, max: 30, itemMax: 4000,
        }),
        truthReferences,
        qualification: boundedText(section.qualification, { field: `output.sections[${index}].qualification`, max: 2000 }),
        diagramIntent: boundedText(section.diagramIntent, { field: `output.sections[${index}].diagramIntent`, max: 1000 }),
      }
    })
  const truthReferences = boundedStringArray(value.truthReferences, {
    field: 'output.truthReferences', min: 1, max: 100, itemMax: 140,
  }).map(lower)
  const contributingActivationIds = boundedStringArray(value.contributingActivationIds, {
    field: 'output.contributingActivationIds', min: 1, max: 100, itemMax: 180,
  })
  if (!sameSet(truthReferences, allowedTruth)
    || !sameSet(sections.flatMap((section) => section.truthReferences), allowedTruth)
    || !sameSet(contributingActivationIds, source.outputSnapshot.contributingActivationIds || [])) {
    throw stageBindingInvalid({ field: 'narrativePlanCoverage' })
  }
  const visibleGaps = boundedStringArray(value.visibleGaps, { field: 'output.visibleGaps', max: 50, itemMax: 2000 })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) throw stageBindingInvalid({ field: 'visibleGaps' })
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
    schemaVersion: OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
    arlStageExecutionId: source.stageExecutionId,
    approvedMeaningFingerprint: meaningFingerprint,
    sections,
    truthReferences,
    contributingActivationIds,
    visibleGaps,
  }
}

const normalizeRenderedExpressionOutput = (value, inputSnapshot, sourceStageExecution) => {
  const revision = hasExactKeys(value, RENDERED_EXPRESSION_REVISION_OUTPUT_KEYS)
  if (!revision && !hasExactKeys(value, RENDERED_EXPRESSION_OUTPUT_KEYS)) throw invalid('Rendered-expression candidate shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  const source = toPlain(sourceStageExecution)
  if (upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION
    || value.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION
    || text(value.narrativePlanStageExecutionId) !== text(source?.stageExecutionId)
    || lower(value.narrativePlanOutputFingerprint) !== lower(source?.outputFingerprint)
    || upper(value.candidateType) !== 'EXECUTIVE_BRIEF') throw predecessorInvalid({ field: 'narrativePlanIdentity' })
  const planSections = source.outputSnapshot.sections || []
  const sections = boundedArray(value.sections, { field: 'output.sections', min: 1, max: 20 })
    .map((section, index) => {
      const planned = planSections[index]
      if (!hasExactKeys(section, RENDERED_EXPRESSION_SECTION_KEYS)
        || !planned
        || section.order !== index + 1
        || lower(section.sectionKey) !== lower(planned.sectionKey)
        || !STABLE_KEY_PATTERN.test(lower(section.elementId))
        || !hasExactKeys(section.diagram, RENDERED_DIAGRAM_KEYS)
        || typeof section.diagram.present !== 'boolean') throw invalid('Rendered-expression section is invalid.', { index })
      const expectedExpression = revision
        ? buildExpressionOnlyRevisionSection(planned)
        : {
            heading: text(planned.heading),
            body: planned.keyMessages.map(text).join('\n\n'),
            qualification: text(planned.qualification),
            diagram: {
              present: Boolean(text(planned.diagramIntent)),
              description: text(planned.diagramIntent),
              accessibleText: text(planned.diagramIntent),
            },
          }
      if (text(section.heading) !== expectedExpression.heading
        || text(section.body) !== expectedExpression.body
        || text(section.qualification) !== expectedExpression.qualification) {
        throw stageBindingInvalid({ field: `output.sections[${index}].approvedMeaning` })
      }
      const truthReferences = boundedStringArray(section.truthReferences, {
        field: `output.sections[${index}].truthReferences`, min: 1, max: 50, itemMax: 140,
      }).map(lower)
      if (!sameSet(truthReferences, planned.truthReferences)) throw stageBindingInvalid({ field: `output.sections[${index}].truthReferences` })
      if (section.diagram.present !== expectedExpression.diagram.present
        || text(section.diagram.description) !== expectedExpression.diagram.description
        || text(section.diagram.accessibleText) !== expectedExpression.diagram.accessibleText) {
        throw stageBindingInvalid({ field: `output.sections[${index}].diagram` })
      }
      return {
        order: section.order,
        elementId: lower(section.elementId),
        sectionKey: lower(section.sectionKey),
        heading: boundedText(section.heading, { field: `output.sections[${index}].heading`, min: 1, max: 255 }),
        body: boundedText(section.body, { allowLineBreaks: true, field: `output.sections[${index}].body`, min: 1, max: 24000 }),
        qualification: boundedText(section.qualification, { allowLineBreaks: true, field: `output.sections[${index}].qualification`, max: 2000 }),
        diagram: {
          present: section.diagram.present,
          description: boundedText(section.diagram.description, { field: `output.sections[${index}].diagram.description`, max: 2000 }),
          accessibleText: boundedText(section.diagram.accessibleText, { field: `output.sections[${index}].diagram.accessibleText`, max: 2000 }),
        },
        truthReferences,
      }
    })
  const truthReferences = boundedStringArray(value.truthReferences, { field: 'output.truthReferences', min: 1, max: 100, itemMax: 140 }).map(lower)
  const contributingActivationIds = boundedStringArray(value.contributingActivationIds, {
    field: 'output.contributingActivationIds', min: 1, max: 100, itemMax: 180,
  })
  const assigned = inputSnapshot.stage.assignedPacks.map((pack) => pack.activationId)
  if (!sameSet(truthReferences, source.outputSnapshot.truthReferences)
    || !sameSet(contributingActivationIds, assigned)) throw stageBindingInvalid({ field: 'renderedExpressionCoverage' })
  const visibleGaps = boundedStringArray(value.visibleGaps, { field: 'output.visibleGaps', max: 50, itemMax: 2000 })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) throw stageBindingInvalid({ field: 'visibleGaps' })
  const revisionMetadata = revision ? {
    candidateVersion: value.candidateVersion,
    revisionScope: upper(value.revisionScope),
    revisionOfStageExecutionId: text(value.revisionOfStageExecutionId),
    revisionOfOutputFingerprint: lower(value.revisionOfOutputFingerprint),
    remediationSourceStageExecutionId: text(value.remediationSourceStageExecutionId),
    remediationSourceAttemptFingerprint: lower(value.remediationSourceAttemptFingerprint),
    remediationFailureCode: upper(value.remediationFailureCode),
    rlFindingFingerprint: lower(value.rlFindingFingerprint),
  } : {}
  if (revision && (!Number.isInteger(revisionMetadata.candidateVersion)
    || revisionMetadata.candidateVersion < 2
    || revisionMetadata.revisionScope !== 'EXPRESSION_ONLY'
    || !revisionMetadata.revisionOfStageExecutionId
    || !SHA256_PATTERN.test(revisionMetadata.revisionOfOutputFingerprint)
    || !revisionMetadata.remediationSourceStageExecutionId
    || !SHA256_PATTERN.test(revisionMetadata.remediationSourceAttemptFingerprint)
    || revisionMetadata.remediationFailureCode !== 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    || !SHA256_PATTERN.test(revisionMetadata.rlFindingFingerprint))) {
    throw invalid('Rendered-expression revision lineage is invalid.')
  }
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
    narrativePlanStageExecutionId: source.stageExecutionId,
    narrativePlanOutputFingerprint: lower(source.outputFingerprint),
    candidateType: 'EXECUTIVE_BRIEF',
    title: boundedText(value.title, { field: 'output.title', min: 1, max: 255 }),
    sections,
    truthReferences,
    contributingActivationIds,
    visibleGaps,
    ...revisionMetadata,
  }
}

const normalizeRenderedExpressionRlOutput = (value, inputSnapshot, sourceStageExecution) => {
  if (!hasExactKeys(value, RL_OUTPUT_KEYS)) throw invalid('Rendered-expression RL shape is invalid.')
  assertNoForbiddenKeys(value, 'output')
  const source = toPlain(sourceStageExecution)
  if (upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
    || value.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION
    || text(value.candidateStageExecutionId) !== text(source?.stageExecutionId)
    || lower(value.candidateOutputFingerprint) !== lower(source?.outputFingerprint)
    || upper(value.overallStatus) !== 'PASS') throw predecessorInvalid({ field: 'renderedCandidateIdentity' })
  const findings = boundedArray(value.findings, { field: 'output.findings', min: 7, max: 7 })
    .map((finding, index) => {
      if (!hasExactKeys(finding, RL_FINDING_KEYS) || typeof finding.requiredChange !== 'boolean') {
        throw invalid('RL finding is invalid.', { index })
      }
      const normalized = {
        dimension: upper(finding.dimension),
        status: upper(finding.status),
        finding: boundedText(finding.finding, { field: `output.findings[${index}].finding`, min: 1, max: 4000 }),
        requiredChange: finding.requiredChange,
      }
      if (!RL_REQUIRED_DIMENSIONS.includes(normalized.dimension)
        || normalized.status !== 'PASS'
        || normalized.requiredChange) throw invalid('RL cannot pass an unresolved expression issue.', { index })
      return normalized
    })
  if (!sameSet(findings.map((finding) => finding.dimension), RL_REQUIRED_DIMENSIONS)) {
    throw invalid('RL findings must cover all rendered-expression dimensions exactly.')
  }
  const truthReferences = boundedStringArray(value.truthReferences, { field: 'output.truthReferences', min: 1, max: 100, itemMax: 140 }).map(lower)
  const contributingActivationIds = boundedStringArray(value.contributingActivationIds, {
    field: 'output.contributingActivationIds', min: 1, max: 100, itemMax: 180,
  })
  const assigned = inputSnapshot.stage.assignedPacks.map((pack) => pack.activationId)
  if (!sameSet(truthReferences, source.outputSnapshot.truthReferences)
    || !sameSet(contributingActivationIds, assigned)) throw stageBindingInvalid({ field: 'renderedExpressionRlCoverage' })
  const visibleGaps = boundedStringArray(value.visibleGaps, { field: 'output.visibleGaps', max: 50, itemMax: 2000 })
  if (!sameOrderedValues(visibleGaps, inputSnapshot.visibleGaps)) throw stageBindingInvalid({ field: 'visibleGaps' })
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
    candidateStageExecutionId: source.stageExecutionId,
    candidateOutputFingerprint: lower(source.outputFingerprint),
    overallStatus: 'PASS',
    findings,
    truthReferences,
    contributingActivationIds,
    visibleGaps,
  }
}

const normalizeFailure = (value) => {
  if (!hasExactKeys(value, FAILURE_KEYS)) throw invalid('Outcome quality stage failure shape is invalid.')
  if (typeof value.retryable !== 'boolean') throw invalid('Outcome quality stage retryable flag is invalid.')
  const failureCode = upper(value.failureCode)
  if (!STABLE_KEY_PATTERN.test(lower(failureCode))) throw invalid('Outcome quality stage failure code is invalid.')
  return {
    failureCode,
    safeReason: boundedText(value.safeReason, { field: 'failure.safeReason', min: 1, max: 500 }),
    retryable: value.retryable,
  }
}

const validatePlan = (value, { runtimeInstanceId, expectedPlanFingerprint }) => {
  let plan
  try {
    plan = assertOutcomeKnowledgeCompositionPlanIntegrity(value)
  } catch (error) {
    throw kcpInvalid({ causeCode: error?.code || '' })
  }
  if (toId(plan.runtimeInstanceId) !== toId(runtimeInstanceId)
    || lower(plan.planFingerprint) !== lower(expectedPlanFingerprint)) {
    throw kcpInvalid({ field: 'scopeOrFingerprint' })
  }
  if (![OUTCOME_KCP_STATUSES.READY, OUTCOME_KCP_STATUSES.READY_WITH_GAPS].includes(plan.status)) {
    throw kcpNotEligible({ status: plan.status })
  }
  return plan
}

export const buildOutcomeQualityStageExecutionCandidate = ({
  plan,
  runtimeInstanceId,
  expectedPlanFingerprint,
  stageKey,
  expectedLatestAttemptNumber = 0,
  predecessorStageExecutionId = '',
  predecessorAttemptFingerprint = '',
  sourceStageExecution,
  status,
  output,
  failure,
  executionIdentity,
  startedAt,
  completedAt,
} = {}) => {
  const validatedPlan = validatePlan(plan, { runtimeInstanceId, expectedPlanFingerprint })
  const normalizedStageKey = upper(stageKey)
  if (!Object.prototype.hasOwnProperty.call(STAGE_ORDERS, normalizedStageKey)) {
    throw stageNotSupported({ stageKey: normalizedStageKey })
  }
  const stage = validatedPlan.payload.stagePlan.find((item) => item.stageKey === normalizedStageKey)
  if (!stage || Number(stage.order) !== STAGE_ORDERS[normalizedStageKey]) {
    throw stageBindingInvalid({ stageKey: normalizedStageKey })
  }
  const latestAttemptNumber = expectedLatestAttemptNumber
  if (typeof latestAttemptNumber !== 'number' || !Number.isInteger(latestAttemptNumber) || latestAttemptNumber < 0) {
    throw invalid('Outcome quality stage expected latest attempt number is invalid.')
  }
  const predecessorId = text(predecessorStageExecutionId)
  const predecessorFingerprint = lower(predecessorAttemptFingerprint)
  const sourceStage = normalizeSourceStageExecution({
    value: sourceStageExecution,
    plan: validatedPlan,
    stageKey: normalizedStageKey,
  })
  const firstAttemptPredecessorRequired = normalizedStageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
  if ((latestAttemptNumber === 0 && !firstAttemptPredecessorRequired && (predecessorId || predecessorFingerprint))
    || (latestAttemptNumber === 0 && firstAttemptPredecessorRequired
      && (predecessorId !== sourceStage?.stageExecutionId
        || predecessorFingerprint !== sourceStage?.attemptFingerprint))
    || (latestAttemptNumber > 0 && (!predecessorId || !SHA256_PATTERN.test(predecessorFingerprint)))) {
    throw predecessorInvalid({ expectedLatestAttemptNumber: latestAttemptNumber })
  }
  const normalizedStatus = upper(status)
  if (!Object.values(OUTCOME_QUALITY_STAGE_STATUSES).includes(normalizedStatus)) {
    throw invalid('Outcome quality stage status is invalid.')
  }
  const succeeded = normalizedStatus === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
  if ((succeeded && (failure !== undefined || output === undefined))
    || (!succeeded && (output !== undefined || failure === undefined))) {
    throw invalid('Outcome quality stage success and failure shapes are mutually exclusive.')
  }
  const startIso = toIso(startedAt)
  const completionIso = toIso(completedAt)
  const startMs = Date.parse(startIso)
  const completionMs = Date.parse(completionIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(completionMs) || completionMs < startMs) {
    throw invalid('Outcome quality stage timing is invalid.')
  }
  const durationMs = completionMs - startMs
  if (!Number.isFinite(durationMs) || durationMs > 86_400_000) {
    throw invalid('Outcome quality stage duration is invalid.')
  }
  const inputSnapshot = buildStageInputSnapshot(validatedPlan, stage, sourceStageExecution)
  assertNoForbiddenKeys(inputSnapshot, 'input')
  const inputFingerprint = hashOutcomeQualityStageValue(inputSnapshot)
  let normalizedOutput
  if (succeeded) {
    if (normalizedStageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE) {
      normalizedOutput = normalizeFrameworkGuidanceOutput(output, inputSnapshot)
    } else if (normalizedStageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT) {
      normalizedOutput = normalizeWorkingDraftOutput(output, inputSnapshot, sourceStageExecution)
    } else if (normalizedStageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW) {
      normalizedOutput = normalizeArlMeaningReviewOutput(output, inputSnapshot, sourceStageExecution)
    } else if (normalizedStageKey === OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN) {
      normalizedOutput = normalizeNarrativePlanOutput(output, inputSnapshot, sourceStageExecution)
    } else if (normalizedStageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING) {
      normalizedOutput = normalizeRenderedExpressionOutput(output, inputSnapshot, sourceStageExecution)
    } else {
      normalizedOutput = normalizeRenderedExpressionRlOutput(output, inputSnapshot, sourceStageExecution)
    }
  }
  const normalizedFailure = succeeded ? undefined : normalizeFailure(failure)
  const normalizedExecutionIdentity = normalizeExecutionIdentity(executionIdentity, {
    succeeded,
    stageKey: normalizedStageKey,
  })
  const outputFingerprint = succeeded ? hashOutcomeQualityStageValue(normalizedOutput) : ''
  const attemptNumber = latestAttemptNumber + 1
  const qualityRunId = buildQualityRunId(validatedPlan)
  const attemptFingerprint = hashOutcomeQualityStageValue({
    qualityRunId,
    planId: validatedPlan.planId,
    planVersion: validatedPlan.planVersion,
    planFingerprint: validatedPlan.planFingerprint,
    stageKey: normalizedStageKey,
    stageOrder: Number(stage.order),
    attemptNumber,
    predecessorStageExecutionId: predecessorId,
    predecessorAttemptFingerprint: predecessorFingerprint,
    status: normalizedStatus,
    inputFingerprint,
    outputFingerprint,
    output: normalizedOutput,
    failure: normalizedFailure,
    executionIdentity: normalizedExecutionIdentity,
  })
  const truthReferences = !succeeded
    ? []
    : [
      OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
      OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ].includes(normalizedStageKey)
      ? [...new Set(normalizedOutput.truthReferences)]
      : [...new Set(normalizedOutput.sections.flatMap((section) => section.truthReferences))]
  const contributingActivations = !succeeded
    ? []
    : [
      OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
      OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ].includes(normalizedStageKey)
      ? [...new Set(normalizedOutput.contributingActivationIds)]
      : [...new Set(normalizedOutput.sections.flatMap((section) => section.contributingActivationIds))]
  return {
    qualityRunId,
    contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
    tenantId: validatedPlan.tenantId,
    customerId: validatedPlan.customerId,
    runtimeInstanceId: validatedPlan.runtimeInstanceId,
    runtimeInstanceKey: validatedPlan.runtimeInstanceKey,
    knowledgeCompositionPlanRecordId: toId(validatedPlan._id || validatedPlan.id),
    planId: validatedPlan.planId,
    planVersion: Number(validatedPlan.planVersion),
    planFingerprint: lower(validatedPlan.planFingerprint),
    resolutionFingerprint: lower(validatedPlan.resolutionFingerprint),
    contextFingerprint: lower(validatedPlan.contextFingerprint),
    stageKey: normalizedStageKey,
    stageOrder: Number(stage.order),
    attemptNumber,
    predecessorStageExecutionId: predecessorId,
    predecessorAttemptFingerprint: predecessorFingerprint,
    status: normalizedStatus,
    inputFingerprint,
    outputFingerprint,
    attemptFingerprint,
    inputSnapshot,
    ...(succeeded ? { outputSnapshot: normalizedOutput } : { failure: normalizedFailure }),
    executionIdentity: normalizedExecutionIdentity,
    assignedActivationCount: inputSnapshot.stage.assignedActivationCount,
    contributingActivationCount: contributingActivations.length,
    truthReferenceCount: truthReferences.length,
    startedAt: startIso,
    completedAt: completionIso,
    durationMs,
  }
}

const currentTopologyType = (mongooseClient) => {
  try {
    return mongooseClient.connection.getClient()?.topology?.description?.type || ''
  } catch {
    return ''
  }
}

export const assertOutcomeQualityStageTransactionSupport = (mongooseClient = mongoose) => {
  if (mongooseClient.connection.readyState !== 1
    || !TRANSACTION_TOPOLOGIES.has(currentTopologyType(mongooseClient))) throw transactionRequired()
}

const readPlan = async ({ model, planRecordId, runtimeInstanceId, session = null }) => {
  let query = model.findOne({ _id: planRecordId, runtimeInstanceId })
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

const readLatestPlan = async ({ model, runtimeInstanceId, session = null }) => {
  let query = model.findOne({ runtimeInstanceId }).sort({ planVersion: -1 })
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

const readRuntime = async ({ model, runtimeInstanceId, session = null }) => {
  let query = model.findOne({ _id: runtimeInstanceId })
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

const assertCurrentKcpAndRuntime = ({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint }) => {
  const selected = validatePlan(selectedPlan, { runtimeInstanceId, expectedPlanFingerprint })
  let latest
  try {
    latest = assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
  } catch (error) {
    throw kcpInvalid({ field: 'latestPlan', causeCode: error?.code || '' })
  }
  if (toId(latest._id || latest.id) !== toId(selected._id || selected.id)
    || text(latest.planId) !== text(selected.planId)
    || Number(latest.planVersion) !== Number(selected.planVersion)
    || lower(latest.planFingerprint) !== lower(selected.planFingerprint)
    || lower(latest.resolutionFingerprint) !== lower(selected.resolutionFingerprint)
    || lower(latest.contextFingerprint) !== lower(selected.contextFingerprint)) {
    throw kcpInvalid({ field: 'supersededPlan' })
  }
  try {
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(selected, runtime)
  } catch (error) {
    throw kcpInvalid({ field: 'runtimeFreshness', causeCode: error?.code || '' })
  }
  return selected
}

const readLatestStageAttempt = async ({ model, runtimeInstanceId, planId, stageKey, session }) => {
  let query = model.findOne({ runtimeInstanceId, planId, stageKey }).sort({ attemptNumber: -1 })
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

const readStageAttemptByExecutionId = async ({ model, runtimeInstanceId, planId, stageExecutionId, session = null }) => {
  let query = model.findOne({ runtimeInstanceId, planId, stageExecutionId })
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

const readSourceStageAttempt = async ({ model, runtimeInstanceId, planId, stageKey, session = null }) => {
  const stageOrder = STAGE_ORDERS[upper(stageKey)]
  if (!stageOrder || stageOrder === 1) return null
  return readLatestStageAttempt({
    model,
    runtimeInstanceId,
    planId,
    stageKey: OUTCOME_QUALITY_STAGE_SEQUENCE[stageOrder - 2],
    session,
  })
}

export const serializeOutcomeQualityStageExecution = (value) => {
  const execution = toPlain(value)
  if (!execution) return null
  return canonicalize({
    id: toId(execution._id || execution.id),
    stageExecutionId: execution.stageExecutionId,
    qualityRunId: execution.qualityRunId,
    contractVersion: execution.contractVersion,
    tenantId: toId(execution.tenantId),
    customerId: toId(execution.customerId),
    runtimeInstanceId: toId(execution.runtimeInstanceId),
    runtimeInstanceKey: execution.runtimeInstanceKey,
    knowledgeCompositionPlanRecordId: toId(execution.knowledgeCompositionPlanRecordId),
    planId: execution.planId,
    planVersion: execution.planVersion,
    planFingerprint: execution.planFingerprint,
    resolutionFingerprint: execution.resolutionFingerprint,
    contextFingerprint: execution.contextFingerprint,
    stageKey: execution.stageKey,
    stageOrder: execution.stageOrder,
    attemptNumber: execution.attemptNumber,
    predecessorStageExecutionId: execution.predecessorStageExecutionId || '',
    predecessorAttemptFingerprint: execution.predecessorAttemptFingerprint || '',
    status: execution.status,
    inputFingerprint: execution.inputFingerprint,
    outputFingerprint: execution.outputFingerprint || '',
    attemptFingerprint: execution.attemptFingerprint,
    inputSnapshot: execution.inputSnapshot,
    ...(execution.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
      ? { outputSnapshot: execution.outputSnapshot }
      : { failure: execution.failure }),
    executionIdentity: execution.executionIdentity,
    assignedActivationCount: execution.assignedActivationCount,
    contributingActivationCount: execution.contributingActivationCount,
    truthReferenceCount: execution.truthReferenceCount,
    startedAt: toIso(execution.startedAt),
    completedAt: toIso(execution.completedAt),
    durationMs: execution.durationMs,
    createdBy: toId(execution.createdBy),
    createdAt: toIso(execution.createdAt),
  })
}

const auditStageExecution = async ({ audit, session, execution, actorUserId }) => {
  try {
    const result = await audit.log({
      actorUserId,
      action: audit.AUDIT_ACTIONS.OUTCOME_QUALITY_STAGE_RECORDED,
      resourceType: audit.RESOURCE_TYPES.OutcomeQualityStageExecution,
      resourceId: execution._id,
      scope: {
        tenantId: execution.tenantId,
        customerId: execution.customerId,
        runtimeInstanceId: execution.runtimeInstanceId,
        runtimeInstanceKey: execution.runtimeInstanceKey,
      },
      diff: {
        stageExecutionId: execution.stageExecutionId,
        qualityRunId: execution.qualityRunId,
        planId: execution.planId,
        planVersion: execution.planVersion,
        planFingerprint: execution.planFingerprint,
        stageKey: execution.stageKey,
        stageOrder: execution.stageOrder,
        attemptNumber: execution.attemptNumber,
        status: execution.status,
        predecessorStageExecutionId: execution.predecessorStageExecutionId || '',
        inputFingerprint: execution.inputFingerprint,
        outputFingerprint: execution.outputFingerprint || '',
        assignedActivationCount: execution.assignedActivationCount,
        contributingActivationCount: execution.contributingActivationCount,
        truthReferenceCount: execution.truthReferenceCount,
        durationMs: execution.durationMs,
        providerConfigurationVersion: execution.executionIdentity?.providerConfigurationVersion || '',
        failureCode: execution.failure?.failureCode || '',
        retryable: execution.failure?.retryable === true,
      },
    }, { session, throwOnError: true })
    if (!result) throw new Error('Outcome quality stage audit returned no record.')
  } catch {
    throw auditFailed()
  }
}

const isWriteConflict = (error) => error?.code === 11000
  || error?.code === 112
  || error?.codeName === 'WriteConflict'
  || /E11000|WriteConflict|write conflict/i.test(error?.message || '')

const REPAIRED_OUTPUT_PROVIDER_CONFIG_VERSIONS = new Set([
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
])

const isProviderOutputContractRecovery = ({ latest, candidate }) => {
  if (latest?.stageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
    || candidate?.stageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE) return false
  const latestConfigurationVersion = text(latest?.executionIdentity?.providerConfigurationVersion)
    || (latest?.failure?.failureCode === 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID'
      ? OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1
      : '')
  const candidateConfigurationVersion = text(candidate?.executionIdentity?.providerConfigurationVersion)
  const recoverableOutputInvalidFailure = latest?.status === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    && latest?.failure?.failureCode === 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID'
    && latest?.failure?.retryable === false
    && text(latest?.stageExecutionId)
    && SHA256_PATTERN.test(lower(latest?.attemptFingerprint))
    && lower(latest?.executionIdentity?.providerKey) === lower(candidate?.executionIdentity?.providerKey)
    && text(latest?.executionIdentity?.model) === text(candidate?.executionIdentity?.model)
  const legacyOutputContractRecovery = recoverableOutputInvalidFailure
    && latestConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1
    && REPAIRED_OUTPUT_PROVIDER_CONFIG_VERSIONS.has(candidateConfigurationVersion)
    && latestConfigurationVersion !== candidateConfigurationVersion
  const safeOutputDiagnosticsRecovery = recoverableOutputInvalidFailure
    && latestConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND
    && candidateConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS
  const semanticClaimCalibrationRecovery = recoverableOutputInvalidFailure
    && latestConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS
    && candidateConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION
  const arlBoundaryDiagnosticsRecovery = recoverableOutputInvalidFailure
    && latestConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION
    && candidateConfigurationVersion
      === OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS
  return legacyOutputContractRecovery
    || safeOutputDiagnosticsRecovery
    || semanticClaimCalibrationRecovery
    || arlBoundaryDiagnosticsRecovery
}

const isExpressionOnlyShapingRevision = ({ candidate, latest, remediation }) => (
  candidate.stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
  && latest?.stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
  && latest?.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
  && candidate.attemptNumber === Number(latest.attemptNumber) + 1
  && candidate.predecessorStageExecutionId === latest.stageExecutionId
  && candidate.predecessorAttemptFingerprint === latest.attemptFingerprint
  && candidate.outputSnapshot?.revisionScope === 'EXPRESSION_ONLY'
  && candidate.outputSnapshot?.revisionOfStageExecutionId === latest.stageExecutionId
  && candidate.outputSnapshot?.revisionOfOutputFingerprint === latest.outputFingerprint
  && remediation?.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
  && remediation?.status === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
  && remediation?.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
  && ((remediation?.predecessorStageExecutionId === latest.stageExecutionId
      && remediation?.predecessorAttemptFingerprint === latest.attemptFingerprint)
    || (Number(remediation?.attemptNumber) > 1
      && remediation?.inputSnapshot?.sourceStage?.stageExecutionId === latest.stageExecutionId
      && remediation?.inputSnapshot?.sourceStage?.attemptFingerprint === latest.attemptFingerprint
      && remediation?.inputSnapshot?.sourceStage?.outputFingerprint === latest.outputFingerprint))
  && candidate.outputSnapshot?.remediationSourceStageExecutionId === remediation.stageExecutionId
  && candidate.outputSnapshot?.remediationSourceAttemptFingerprint === remediation.attemptFingerprint
  && candidate.inputSnapshot?.sourceStage?.stageExecutionId === latest.inputSnapshot?.sourceStage?.stageExecutionId
  && candidate.inputSnapshot?.sourceStage?.outputFingerprint === latest.inputSnapshot?.sourceStage?.outputFingerprint
)

const isFreshRlReviewAfterExpressionRevision = ({ candidate, latest, source }) => (
  candidate.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
  && latest?.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
  && latest?.status === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
  && latest?.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
  && candidate.predecessorStageExecutionId === latest.stageExecutionId
  && candidate.predecessorAttemptFingerprint === latest.attemptFingerprint
  && source?.stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
  && source?.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
  && source?.outputSnapshot?.revisionScope === 'EXPRESSION_ONLY'
  && source?.outputSnapshot?.remediationSourceStageExecutionId === latest.stageExecutionId
  && source?.outputSnapshot?.remediationSourceAttemptFingerprint === latest.attemptFingerprint
  && source?.outputFingerprint !== latest.inputSnapshot?.sourceStage?.outputFingerprint
)

export const createOutcomeQualityStageExecution = async ({
  planRecordId,
  runtimeInstanceId,
  expectedPlanFingerprint,
  stageKey,
  expectedLatestAttemptNumber = 0,
  predecessorStageExecutionId = '',
  predecessorAttemptFingerprint = '',
  status,
  output,
  failure,
  executionIdentity,
  startedAt,
  completedAt,
  expectedAttemptFingerprint,
  actorUserId,
  remediationSourceStageExecutionId = '',
  deps = {},
} = {}) => {
  if (!mongoose.isValidObjectId(planRecordId)
    || !mongoose.isValidObjectId(runtimeInstanceId)
    || !mongoose.isValidObjectId(actorUserId)
    || !SHA256_PATTERN.test(lower(expectedPlanFingerprint))
    || !SHA256_PATTERN.test(lower(expectedAttemptFingerprint))) {
    throw invalid('Outcome quality stage governed identity is invalid.')
  }
  const planModel = deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan
  const stageModel = deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution
  const runtimeModel = deps.RuntimeInstance || RuntimeInstance
  const mongooseClient = deps.mongoose || mongoose
  const audit = deps.auditService || auditService
  const assertTransactionSupport = deps.assertTransactionSupport || assertOutcomeQualityStageTransactionSupport
  let initialPlan
  let initialLatestPlan
  let initialRuntime
  let initialSourceStage
  try {
    [initialPlan, initialLatestPlan, initialRuntime] = await Promise.all([
      readPlan({ model: planModel, planRecordId, runtimeInstanceId }),
      readLatestPlan({ model: planModel, runtimeInstanceId }),
      readRuntime({ model: runtimeModel, runtimeInstanceId }),
    ])
  } catch {
    throw persistenceFailed()
  }
  if (!initialPlan || !initialLatestPlan || !initialRuntime) throw kcpInvalid({ field: 'recordOrFreshnessEvidence' })
  const initialCurrentPlan = assertCurrentKcpAndRuntime({
    selectedPlan: initialPlan,
    latestPlan: initialLatestPlan,
    runtime: initialRuntime,
    runtimeInstanceId,
    expectedPlanFingerprint,
  })
  try {
    initialSourceStage = toPlain(await readSourceStageAttempt({
      model: stageModel,
      runtimeInstanceId,
      planId: initialCurrentPlan.planId,
      stageKey,
    }))
  } catch {
    throw persistenceFailed()
  }
  const initialCandidate = buildOutcomeQualityStageExecutionCandidate({
    plan: initialCurrentPlan,
    runtimeInstanceId,
    expectedPlanFingerprint,
    stageKey,
    expectedLatestAttemptNumber,
    predecessorStageExecutionId,
    predecessorAttemptFingerprint,
    sourceStageExecution: initialSourceStage,
    status,
    output,
    failure,
    executionIdentity,
    startedAt,
    completedAt,
  })
  if (initialCandidate.attemptFingerprint !== lower(expectedAttemptFingerprint)) {
    throw fingerprintMismatch({ expectedAttemptFingerprint, actualAttemptFingerprint: initialCandidate.attemptFingerprint })
  }
  assertTransactionSupport(mongooseClient)

  let session
  let created = null
  let idempotentExecution = null
  try {
    session = await mongooseClient.startSession()
    if (!session || typeof session.withTransaction !== 'function' || typeof session.endSession !== 'function') {
      throw transactionRequired()
    }
    await session.withTransaction(async () => {
      const [persistedPlan, latestPlan, lockedRuntime] = await Promise.all([
        readPlan({ model: planModel, planRecordId, runtimeInstanceId, session }),
        readLatestPlan({ model: planModel, runtimeInstanceId, session }),
        readRuntime({ model: runtimeModel, runtimeInstanceId, session }),
      ])
      if (!persistedPlan || !latestPlan || !lockedRuntime) throw kcpInvalid({ field: 'recordOrFreshnessEvidence' })
      const currentPlan = assertCurrentKcpAndRuntime({
        selectedPlan: persistedPlan,
        latestPlan,
        runtime: lockedRuntime,
        runtimeInstanceId,
        expectedPlanFingerprint,
      })
      const transactionSourceStage = toPlain(await readSourceStageAttempt({
        model: stageModel,
        runtimeInstanceId,
        planId: currentPlan.planId,
        stageKey,
        session,
      }))
      const candidate = buildOutcomeQualityStageExecutionCandidate({
        plan: currentPlan,
        runtimeInstanceId,
        expectedPlanFingerprint,
        stageKey,
        expectedLatestAttemptNumber,
        predecessorStageExecutionId,
        predecessorAttemptFingerprint,
        sourceStageExecution: transactionSourceStage,
        status,
        output,
        failure,
        executionIdentity,
        startedAt,
        completedAt,
      })
      if (candidate.attemptFingerprint !== initialCandidate.attemptFingerprint
        || candidate.attemptFingerprint !== lower(expectedAttemptFingerprint)) {
        throw fingerprintMismatch({ field: 'transactionCandidate' })
      }

      const latest = toPlain(await readLatestStageAttempt({
        model: stageModel,
        runtimeInstanceId,
        planId: candidate.planId,
        stageKey: candidate.stageKey,
        session,
      }))
      const remediationStage = remediationSourceStageExecutionId
        ? toPlain(await readStageAttemptByExecutionId({
            model: stageModel,
            runtimeInstanceId,
            planId: currentPlan.planId,
            stageExecutionId: remediationSourceStageExecutionId,
            session,
          }))
        : null
      if (latest
        && latest.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
        && latest.attemptNumber === candidate.attemptNumber
        && latest.attemptFingerprint === candidate.attemptFingerprint) {
        idempotentExecution = latest
        return
      }
      const actualLatestAttemptNumber = Number(latest?.attemptNumber || 0)
      if (actualLatestAttemptNumber !== expectedLatestAttemptNumber) {
        throw versionConflict({ expectedLatestAttemptNumber, actualLatestAttemptNumber })
      }
      if (actualLatestAttemptNumber === 0) {
        const sourceStage = candidate.inputSnapshot.sourceStage
        const firstStage = candidate.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
        if ((firstStage && (candidate.predecessorStageExecutionId || candidate.predecessorAttemptFingerprint))
          || (!firstStage && (!sourceStage
            || candidate.predecessorStageExecutionId !== sourceStage.stageExecutionId
            || candidate.predecessorAttemptFingerprint !== sourceStage.attemptFingerprint))) {
          throw predecessorInvalid({ expectedLatestAttemptNumber: 0 })
        }
      } else {
        const expressionRevision = isExpressionOnlyShapingRevision({
          candidate,
          latest,
          remediation: remediationStage,
        })
        const freshRlReview = isFreshRlReviewAfterExpressionRevision({
          candidate,
          latest,
          source: transactionSourceStage,
        })
        if (latest.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED && !expressionRevision) {
          throw retryNotAllowed({ stageExecutionId: latest.stageExecutionId })
        }
        if ((!expressionRevision && !freshRlReview
            && !latest.failure?.retryable
            && !isProviderOutputContractRecovery({ latest, candidate }))
          || (!expressionRevision && !freshRlReview
            && latest.stageExecutionId !== candidate.predecessorStageExecutionId)
          || latest.attemptFingerprint !== candidate.predecessorAttemptFingerprint
          || latest.qualityRunId !== candidate.qualityRunId
          || (!expressionRevision && !freshRlReview && latest.inputFingerprint !== candidate.inputFingerprint)
          || latest.planFingerprint !== candidate.planFingerprint) {
          throw predecessorInvalid({ stageExecutionId: latest.stageExecutionId })
        }
      }
      created = new stageModel({
        stageExecutionId: `outcome_quality_stage_${randomUUID()}`,
        ...candidate,
        createdBy: actorUserId,
      })
      await created.save({ session })
      await auditStageExecution({ audit, session, execution: created, actorUserId })
    })
  } catch (error) {
    if (Object.values(OUTCOME_QUALITY_STAGE_ERROR_CODES).includes(error?.code)) throw error
    if (isWriteConflict(error)) throw versionConflict({ conflict: true })
    throw persistenceFailed()
  } finally {
    if (session && typeof session.endSession === 'function') await session.endSession()
  }
  const execution = idempotentExecution || created
  if (!execution) throw persistenceFailed()
  return { idempotent: Boolean(idempotentExecution), execution: serializeOutcomeQualityStageExecution(execution) }
}
