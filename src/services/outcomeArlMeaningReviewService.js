import mongoose from 'mongoose'

import {
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
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
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
} from './outcomeQualityStageExecutionService.js'
import { assertRuntimePermission } from './runtimeInstanceService.js'

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

const assertCurrentPlan = ({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint }) => {
  let selected
  let latest
  try {
    selected = assertOutcomeKnowledgeCompositionPlanIntegrity(selectedPlan)
    latest = assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(selected, runtime)
  } catch {
    throw error('The current Knowledge Composition Plan is unavailable or stale.')
  }
  if (toId(selected.runtimeInstanceId) !== toId(runtimeInstanceId)
    || lower(selected.planFingerprint) !== lower(expectedPlanFingerprint)
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
  return source
}

export const buildOutcomeArlMeaningReviewOutput = ({ plan, sourceStageExecution }) => {
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
      finding: `${dimension.replaceAll('_', ' ')} is supported by the governed Working Draft and retained evidence boundaries.`,
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

export const approveOutcomeWorkingDraftMeaning = async ({
  actorUserId,
  expectedPlanFingerprint,
  planRecordId,
  runtimeInstanceId,
  scopes,
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
    execQuery(models.OutcomeKnowledgeCompositionPlan.findOne({ _id: planRecordId, runtimeInstanceId })),
    readLatest({ model: models.OutcomeKnowledgeCompositionPlan, filter: { runtimeInstanceId }, sort: { planVersion: -1 } }),
    execQuery(models.RuntimeInstance.findOne({ _id: runtimeInstanceId })),
  ])
  if (!selectedPlan || !latestPlan || !runtime) throw error('ARL source records are unavailable.')
  const plan = assertCurrentPlan({ selectedPlan, latestPlan, runtime, runtimeInstanceId, expectedPlanFingerprint })
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
      filter: { runtimeInstanceId, planId: plan.planId, stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId, planId: plan.planId, stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW },
      sort: { attemptNumber: -1 },
    }),
  ])
  const sourceStage = assertWorkingDraft({ sourceStage: sourceRecord, plan, runtimeInstanceId })
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
    deps: deps.stageDeps || {},
  })
  return { idempotent: result.idempotent, stage: result.execution }
}

export default {
  approveOutcomeWorkingDraftMeaning,
  buildOutcomeArlMeaningReviewOutput,
}
