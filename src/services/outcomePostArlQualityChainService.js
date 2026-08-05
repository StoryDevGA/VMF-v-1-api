import mongoose from 'mongoose'

import {
  OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import {
  GovernedRuntimeArtifact,
  OutcomeKnowledgeCompositionPlan,
  OutcomeQualityStageExecution,
  RuntimeInstance,
} from '../models/index.js'
import { buildExpressionOnlyRevisionSection } from '../utils/outcomeRenderedExpressionRevision.js'
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
const REQUIRED_RL_DIMENSIONS = Object.freeze([
  'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
])
const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const toId = (value) => value?.toString ? value.toString() : text(value)
const toPlain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const execQuery = async (query) => (typeof query?.lean === 'function' ? query.lean() : query)
const fail = (message, details = {}) => Object.assign(new Error(message), {
  status: 409,
  code: 'OUTCOME_POST_ARL_QUALITY_CHAIN_INVALID',
  details: { reason: 'OUTCOME_POST_ARL_QUALITY_CHAIN_INVALID', ...details },
})

const splitNarrativeMessage = (value, maxLength = 4000) => {
  let remaining = text(value).replace(/\s+/g, ' ')
  const chunks = []
  while (remaining.length > maxLength) {
    const prefix = remaining.slice(0, maxLength + 1)
    const boundary = prefix.lastIndexOf(' ')
    const cutAt = boundary > Math.floor(maxLength * 0.75) ? boundary : maxLength
    chunks.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

const readLatest = ({ model, filter, sort }) => {
  const query = model.findOne(filter)
  return execQuery(typeof query?.sort === 'function' ? query.sort(sort) : query)
}

const readBoundState = async ({ actorUserId, expectedPlanFingerprint, planRecordId, runtimeInstanceId, scopes, deps }) => {
  if (!mongoose.isValidObjectId(actorUserId)
    || !mongoose.isValidObjectId(planRecordId)
    || !mongoose.isValidObjectId(runtimeInstanceId)
    || !SHA256_PATTERN.test(lower(expectedPlanFingerprint))) throw fail('Post-ARL governed identity is invalid.')
  const models = {
    OutcomeKnowledgeCompositionPlan: deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan,
    OutcomeQualityStageExecution: deps.OutcomeQualityStageExecution || OutcomeQualityStageExecution,
    RuntimeInstance: deps.RuntimeInstance || RuntimeInstance,
    GovernedRuntimeArtifact: deps.GovernedRuntimeArtifact || GovernedRuntimeArtifact,
  }
  const [selectedPlan, latestPlan, runtime] = await Promise.all([
    execQuery(models.OutcomeKnowledgeCompositionPlan.findOne({ _id: planRecordId, runtimeInstanceId })),
    readLatest({ model: models.OutcomeKnowledgeCompositionPlan, filter: { runtimeInstanceId }, sort: { planVersion: -1 } }),
    execQuery(models.RuntimeInstance.findOne({ _id: runtimeInstanceId })),
  ])
  let plan
  try {
    plan = assertOutcomeKnowledgeCompositionPlanIntegrity(selectedPlan)
    const latest = assertOutcomeKnowledgeCompositionPlanIntegrity(latestPlan)
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime(plan, runtime)
    if (toId(plan._id || plan.id) !== toId(latest._id || latest.id)
      || lower(plan.planFingerprint) !== lower(expectedPlanFingerprint)) throw new Error('stale')
  } catch {
    throw fail('The current Knowledge Composition Plan is unavailable or stale.')
  }
  await (deps.assertRuntimePermission || assertRuntimePermission)({
    actorUserId,
    scopes,
    customerId: toId(plan.customerId),
    tenantId: toId(plan.tenantId),
    permission: 'VMF_UPDATE',
  })
  return { models, plan, runtime }
}

const assertSource = ({ plan, runtimeInstanceId, source, stageKey }) => {
  const stage = toPlain(source)
  const order = OUTCOME_QUALITY_STAGE_SEQUENCE.indexOf(stageKey) + 1
  const expectedSourceKey = OUTCOME_QUALITY_STAGE_SEQUENCE[order - 2]
  if (!stage
    || stage.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || stage.stageKey !== expectedSourceKey
    || Number(stage.stageOrder) !== order - 1
    || toId(stage.runtimeInstanceId) !== toId(runtimeInstanceId)
    || text(stage.planId) !== text(plan.planId)
    || lower(stage.planFingerprint) !== lower(plan.planFingerprint)
    || !SHA256_PATTERN.test(lower(stage.attemptFingerprint))
    || !SHA256_PATTERN.test(lower(stage.outputFingerprint))
    || hashOutcomeQualityStageValue(stage.outputSnapshot) !== lower(stage.outputFingerprint)) {
    throw fail('The exact successful predecessor stage is unavailable.', { stageKey, expectedSourceKey })
  }
  return stage
}

export const buildOutcomeNarrativePlanOutput = ({ plan, arlStage, workingDraftStage }) => {
  const arl = toPlain(arlStage)
  const draft = toPlain(workingDraftStage)
  const meaningFingerprint = lower(arl?.outputSnapshot?.approvedMeaning?.meaningFingerprint)
  if (draft?.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || draft?.stageKey !== OUTCOME_QUALITY_STAGES.WORKING_DRAFT
    || Number(draft?.stageOrder) !== 2
    || text(draft?.planId) !== text(plan?.planId)
    || lower(draft?.planFingerprint) !== lower(plan?.planFingerprint)
    || hashOutcomeQualityStageValue(draft?.outputSnapshot) !== lower(draft?.outputFingerprint)
    || text(arl?.predecessorStageExecutionId) !== text(draft?.stageExecutionId)
    || lower(arl?.predecessorAttemptFingerprint) !== lower(draft?.attemptFingerprint)
    || !SHA256_PATTERN.test(meaningFingerprint)
    || text(arl?.outputSnapshot?.approvedMeaning?.workingDraftStageExecutionId) !== text(draft?.stageExecutionId)
    || lower(arl?.outputSnapshot?.approvedMeaning?.workingDraftOutputFingerprint) !== lower(draft?.outputFingerprint)) {
    throw fail('ARL approved meaning is not bound to the Working Draft.')
  }
  const sections = (draft.outputSnapshot?.sections || []).map((section, index) => {
    const keyMessages = [section.content, ...(section.claims || []).map((claim) => claim.statement)]
      .flatMap((message) => splitNarrativeMessage(message))
    if (keyMessages.length < 1 || keyMessages.length > 30) {
      throw fail('Working Draft content cannot be represented by the bounded Narrative Plan.', {
        sectionKey: lower(section.sectionKey),
      })
    }
    return {
      order: index + 1,
      sectionKey: lower(section.sectionKey),
      heading: text(section.title),
      purpose: `Present the approved ${text(section.title).toLowerCase()} meaning for executive decision use.`,
      keyMessages,
      truthReferences: [...section.truthReferences].map(lower),
      qualification: [...(section.assumptions || []), ...(section.gaps || [])].join(' '),
      diagramIntent: '',
    }
  })
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
    schemaVersion: OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
    arlStageExecutionId: arl.stageExecutionId,
    approvedMeaningFingerprint: meaningFingerprint,
    sections,
    truthReferences: [...arl.outputSnapshot.truthReferences].map(lower),
    contributingActivationIds: [...arl.outputSnapshot.contributingActivationIds],
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

export const buildOutcomeShapedCandidateOutput = ({ plan, narrativePlanStage, title }) => {
  const narrativePlan = toPlain(narrativePlanStage)
  if (!narrativePlan
    || narrativePlan.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || narrativePlan.stageKey !== OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN
    || Number(narrativePlan.stageOrder) !== 4
    || text(narrativePlan.planId) !== text(plan?.planId)
    || lower(narrativePlan.planFingerprint) !== lower(plan?.planFingerprint)
    || hashOutcomeQualityStageValue(narrativePlan.outputSnapshot) !== lower(narrativePlan.outputFingerprint)
    || !text(title)) throw fail('The exact Outcome Narrative Plan is unavailable for shaping.')
  const output = narrativePlan.outputSnapshot
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
    narrativePlanStageExecutionId: narrativePlan.stageExecutionId,
    narrativePlanOutputFingerprint: lower(narrativePlan.outputFingerprint),
    candidateType: 'EXECUTIVE_BRIEF',
    title: text(title),
    sections: output.sections.map((section, index) => ({
      order: index + 1,
      elementId: `executive_brief_${lower(section.sectionKey)}_${index + 1}`,
      sectionKey: lower(section.sectionKey),
      heading: text(section.heading),
      body: section.keyMessages.map(text).join('\n\n'),
      qualification: text(section.qualification),
      diagram: {
        present: Boolean(text(section.diagramIntent)),
        description: text(section.diagramIntent),
        accessibleText: text(section.diagramIntent),
      },
      truthReferences: [...section.truthReferences].map(lower),
    })),
    truthReferences: [...output.truthReferences].map(lower),
    contributingActivationIds: [...(plan.payload.stagePlan
      .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING)
      ?.assignedActivationIds || [])],
    visibleGaps: [...output.visibleGaps],
  }
}

export const buildOutcomeShapedCandidateRevisionOutput = ({
  failedRlStage,
  narrativePlanStage,
  plan,
  priorCandidateStage,
  rlArtifact,
  title,
}) => {
  const narrativePlan = toPlain(narrativePlanStage)
  const prior = toPlain(priorCandidateStage)
  const failedRl = toPlain(failedRlStage)
  const artifact = toPlain(rlArtifact)
  const artifactOutput = artifact?.generatedOutput
  const rlFindings = artifactOutput?.findings
  const findingDimensions = Array.isArray(rlFindings)
    ? rlFindings.map((finding) => text(finding?.dimension).toUpperCase())
    : []
  const directCandidateReview = failedRl?.predecessorStageExecutionId === prior?.stageExecutionId
    && lower(failedRl?.predecessorAttemptFingerprint) === lower(prior?.attemptFingerprint)
  const freshCandidateReview = Number(failedRl?.attemptNumber) > 1
    && failedRl?.inputSnapshot?.sourceStage?.stageExecutionId === prior?.stageExecutionId
    && lower(failedRl?.inputSnapshot?.sourceStage?.attemptFingerprint) === lower(prior?.attemptFingerprint)
    && lower(failedRl?.inputSnapshot?.sourceStage?.outputFingerprint) === lower(prior?.outputFingerprint)
  if (!narrativePlan
    || narrativePlan.stageKey !== OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN
    || narrativePlan.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || hashOutcomeQualityStageValue(narrativePlan.outputSnapshot) !== lower(narrativePlan.outputFingerprint)
    || prior?.stageKey !== OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
    || prior?.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || Number(prior?.attemptNumber) < 1
    || prior?.outputSnapshot?.narrativePlanStageExecutionId !== narrativePlan.stageExecutionId
    || lower(prior?.outputSnapshot?.narrativePlanOutputFingerprint) !== lower(narrativePlan.outputFingerprint)
    || failedRl?.stageKey !== OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    || failedRl?.status !== OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    || failedRl?.failure?.failureCode !== 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    || (!directCandidateReview && !freshCandidateReview)
    || !text(failedRl?.executionIdentity?.grrRuntimeArtifactId)
    || !text(failedRl?.executionIdentity?.grrExecutionId)
    || artifact?.runtimeArtifactId !== failedRl?.executionIdentity?.grrRuntimeArtifactId
    || artifact?.executionId !== failedRl?.executionIdentity?.grrExecutionId
    || text(artifact?.status).toUpperCase() !== 'GENERATED'
    || text(artifact?.outputTypeKey).toUpperCase() !== 'RENDERED_EXPRESSION_RL'
    || artifactOutput?.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
    || artifactOutput?.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION
    || text(artifactOutput?.overallStatus).toUpperCase() !== 'FAIL'
    || !Array.isArray(rlFindings)
    || rlFindings.length !== 7
    || new Set(findingDimensions).size !== REQUIRED_RL_DIMENSIONS.length
    || REQUIRED_RL_DIMENSIONS.some((dimension) => !findingDimensions.includes(dimension))
    || !rlFindings.some((finding) => finding?.requiredChange === true && text(finding?.status).toUpperCase() === 'FAIL')
    || !text(title)) throw fail('Expression-only remediation lineage is invalid.')
  const output = narrativePlan.outputSnapshot
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
    narrativePlanStageExecutionId: narrativePlan.stageExecutionId,
    narrativePlanOutputFingerprint: lower(narrativePlan.outputFingerprint),
    candidateType: 'EXECUTIVE_BRIEF',
    title: text(title),
    sections: output.sections.map((section, index) => {
      const expression = buildExpressionOnlyRevisionSection(section)
      return {
        order: index + 1,
        elementId: `executive_brief_${lower(section.sectionKey)}_${index + 1}`,
        sectionKey: lower(section.sectionKey),
        heading: expression.heading,
        body: expression.body,
        qualification: expression.qualification,
        diagram: expression.diagram,
        truthReferences: [...section.truthReferences].map(lower),
      }
    }),
    truthReferences: [...output.truthReferences].map(lower),
    contributingActivationIds: [...(plan.payload.stagePlan
      .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING)
      ?.assignedActivationIds || [])],
    visibleGaps: [...output.visibleGaps],
    candidateVersion: Number(prior.outputSnapshot?.candidateVersion || 1) + 1,
    revisionScope: 'EXPRESSION_ONLY',
    revisionOfStageExecutionId: prior.stageExecutionId,
    revisionOfOutputFingerprint: lower(prior.outputFingerprint),
    remediationSourceStageExecutionId: failedRl.stageExecutionId,
    remediationSourceAttemptFingerprint: lower(failedRl.attemptFingerprint),
    remediationFailureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE',
    rlFindingFingerprint: hashOutcomeQualityStageValue(rlFindings),
  }
}

const persistStage = async ({
  actorUserId,
  expectedPlanFingerprint,
  executionIdentity,
  output,
  planRecordId,
  runtimeInstanceId,
  scopes,
  stageKey,
  startedAt,
  completedAt,
  deps = {},
}) => {
  const { models, plan, runtime } = await readBoundState({
    actorUserId, expectedPlanFingerprint, planRecordId, runtimeInstanceId, scopes, deps,
  })
  const order = OUTCOME_QUALITY_STAGE_SEQUENCE.indexOf(stageKey) + 1
  if (order < 4 || order > 6) throw fail('Only post-ARL stages 4 to 6 are supported.')
  const sourceKey = OUTCOME_QUALITY_STAGE_SEQUENCE[order - 2]
  const [sourceRecord, existing] = await Promise.all([
    readLatest({
      model: models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId, planId: plan.planId, stageKey: sourceKey },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId, planId: plan.planId, stageKey },
      sort: { attemptNumber: -1 },
    }),
  ])
  const sourceStage = assertSource({ plan, runtimeInstanceId, source: sourceRecord, stageKey })
  const freshRlReview = stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    && existing?.status === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    && existing?.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && sourceStage?.outputSnapshot?.revisionScope === 'EXPRESSION_ONLY'
    && sourceStage?.outputSnapshot?.remediationSourceStageExecutionId === existing.stageExecutionId
    && lower(sourceStage?.outputSnapshot?.remediationSourceAttemptFingerprint) === lower(existing.attemptFingerprint)
  if (existing) {
    if (!freshRlReview && (existing.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
      || existing.predecessorStageExecutionId !== sourceStage.stageExecutionId)) {
      throw fail('Existing post-ARL stage history is not reusable.', { stageKey })
    }
    if (!freshRlReview) return { idempotent: true, stage: serializeOutcomeQualityStageExecution(existing) }
  }
  const start = startedAt || new Date().toISOString()
  const completion = completedAt || new Date().toISOString()
  const identity = executionIdentity || {
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
    stageKey,
    expectedLatestAttemptNumber: freshRlReview ? Number(existing.attemptNumber) : 0,
    predecessorStageExecutionId: freshRlReview ? existing.stageExecutionId : sourceStage.stageExecutionId,
    predecessorAttemptFingerprint: freshRlReview ? existing.attemptFingerprint : sourceStage.attemptFingerprint,
    sourceStageExecution: sourceStage,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity: identity,
    startedAt: start,
    completedAt: completion,
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

export const createOutcomeNarrativePlan = async (args = {}) => {
  const bound = await readBoundState({ ...args, deps: args.deps || {} })
  const [arlStage, workingDraftStage] = await Promise.all([
    readLatest({
      model: bound.models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId: args.runtimeInstanceId, planId: bound.plan.planId, stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: bound.models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId: args.runtimeInstanceId, planId: bound.plan.planId, stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT },
      sort: { attemptNumber: -1 },
    }),
  ])
  const arl = assertSource({
    plan: bound.plan,
    runtimeInstanceId: args.runtimeInstanceId,
    source: arlStage,
    stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
  })
  const output = buildOutcomeNarrativePlanOutput({ plan: bound.plan, arlStage: arl, workingDraftStage })
  return persistStage({ ...args, output, stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN })
}

export const createOutcomeShapedCandidate = async (args = {}) => {
  const bound = await readBoundState({ ...args, deps: args.deps || {} })
  const narrativePlanStage = await readLatest({
    model: bound.models.OutcomeQualityStageExecution,
    filter: {
      runtimeInstanceId: args.runtimeInstanceId,
      planId: bound.plan.planId,
      stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    },
    sort: { attemptNumber: -1 },
  })
  const output = buildOutcomeShapedCandidateOutput({
    plan: bound.plan,
    narrativePlanStage,
    title: args.title,
  })
  return persistStage({ ...args, output, stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING })
}

export const createOutcomeShapedCandidateRevision = async (args = {}) => {
  const bound = await readBoundState({ ...args, deps: args.deps || {} })
  const [narrativePlanStage, priorCandidateStage, failedRlStage] = await Promise.all([
    readLatest({
      model: bound.models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId: args.runtimeInstanceId, planId: bound.plan.planId, stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: bound.models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId: args.runtimeInstanceId, planId: bound.plan.planId, stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING },
      sort: { attemptNumber: -1 },
    }),
    readLatest({
      model: bound.models.OutcomeQualityStageExecution,
      filter: { runtimeInstanceId: args.runtimeInstanceId, planId: bound.plan.planId, stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL },
      sort: { attemptNumber: -1 },
    }),
  ])
  const artifactId = text(failedRlStage?.executionIdentity?.grrRuntimeArtifactId)
  const executionId = text(failedRlStage?.executionIdentity?.grrExecutionId)
  const artifact = artifactId && executionId
    ? await execQuery(bound.models.GovernedRuntimeArtifact.findOne({
        runtimeInstanceId: args.runtimeInstanceId,
        runtimeArtifactId: artifactId,
        executionId,
      }))
    : null
  const output = buildOutcomeShapedCandidateRevisionOutput({
    failedRlStage,
    narrativePlanStage,
    plan: bound.plan,
    priorCandidateStage,
    rlArtifact: artifact,
    title: args.title,
  })
  const completedAt = new Date().toISOString()
  const executionIdentity = {
    executionMode: 'INTERNAL_GOVERNED',
    providerKey: '',
    providerConfigurationVersion: '',
    model: '',
    grrExecutionId: '',
    grrRuntimeArtifactId: '',
    runtimeVersion: new Date(bound.runtime.updatedAt).toISOString(),
  }
  const candidateArgs = {
    plan: bound.plan,
    runtimeInstanceId: args.runtimeInstanceId,
    expectedPlanFingerprint: args.expectedPlanFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    expectedLatestAttemptNumber: Number(priorCandidateStage.attemptNumber),
    predecessorStageExecutionId: priorCandidateStage.stageExecutionId,
    predecessorAttemptFingerprint: priorCandidateStage.attemptFingerprint,
    sourceStageExecution: narrativePlanStage,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity,
    startedAt: completedAt,
    completedAt,
  }
  const candidate = buildOutcomeQualityStageExecutionCandidate(candidateArgs)
  const createStage = args.deps?.createOutcomeQualityStageExecution || createOutcomeQualityStageExecution
  const result = await createStage({
    planRecordId: toId(bound.plan._id || bound.plan.id),
    ...candidateArgs,
    expectedAttemptFingerprint: candidate.attemptFingerprint,
    actorUserId: args.actorUserId,
    remediationSourceStageExecutionId: failedRlStage.stageExecutionId,
    deps: args.deps?.stageDeps || {},
  })
  return { idempotent: result.idempotent, stage: result.execution }
}

export const persistOutcomeRenderedExpressionRl = (args = {}) => persistStage({
  ...args,
  stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
})

export default {
  buildOutcomeNarrativePlanOutput,
  buildOutcomeShapedCandidateRevisionOutput,
  buildOutcomeShapedCandidateOutput,
  createOutcomeShapedCandidate,
  createOutcomeShapedCandidateRevision,
  createOutcomeNarrativePlan,
  persistOutcomeRenderedExpressionRl,
}
