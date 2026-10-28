import { OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeGovernedCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeDecisionLedCommercialExpressionProfile.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
} from './outcomeKnowledgeCompositionPlanService.js'
import {
  assertOutcomeQualityStageRetryLineage,
  buildOutcomeQualityStageExecutionCandidate,
  hashOutcomeQualityStageValue,
} from './outcomeQualityStageExecutionService.js'

const sequence = OUTCOME_QUALITY_STAGE_SEQUENCE.slice(0, 6)
const text = (value) => String(value ?? '').trim()
const invalid = (stageKey = '') => Object.assign(new Error('The accepted governed quality chain is not current or complete.'), {
  status: 409,
  code: 'CONFLICT',
  details: { blockerReason: 'OUTCOME_QUALITY_CHAIN_LINEAGE_INVALID', stageKey },
})

// Resolve content at the asynchronous owner boundary; the validator below stays
// pure and still recomputes the existing exact pack/version/hash style receipt.
export const loadOutcomeGovernedQualityChainStyleSource = async ({ plan, stages, session = null,
  loadPackContent = loadOutcomeKnowledgePackVersionContent } = {}) => {
  if (!stages?.some(stage => stage.status === 'SUCCEEDED' && stage.stageKey === 'OUTPUT_SHAPING'
    && [OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION, OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION]
      .includes(stage.outputSnapshot?.expressionProfileVersion))) return undefined
  const styles = plan?.payload?.resolution?.selectedPacks?.filter(pack => pack.packType === 'STYLE') || []
  if (styles.length !== 1) throw invalid('OUTPUT_SHAPING')
  return loadPackContent({ packId: styles[0].packId, versionId: styles[0].versionId, ...(session ? { session } : {}) })
}

// Recorded accepted IDs, rather than row count or arbitrary successful history,
// identify the six semantic stages. Historical failures remain immutable.
export const validateOutcomeGovernedQualityChain = ({
  plan,
  requestBinding,
  stages,
  recordedStages = stages,
  runtime,
  styleSource,
} = {}) => {
  if (!Array.isArray(recordedStages) || recordedStages.length !== sequence.length) {
    throw Object.assign(invalid(), { details: { blockerReason: 'OUTCOME_QUALITY_CHAIN_INCOMPLETE' } })
  }
  try {
    assertOutcomeKnowledgeCompositionPlanIntegrity(plan)
    if (runtime) assertOutcomeKnowledgeCompositionPlanMatchesRuntime(plan, runtime)
    if (plan.requestId !== requestBinding?.requestId || !Array.isArray(stages)) throw invalid()
    const history = new Map()
    for (const stage of stages) {
      const id = text(stage.stageExecutionId)
      if (!id || history.has(id)
        || ['tenantId', 'customerId', 'runtimeInstanceId'].some((key) => text(stage[key]) !== text(plan[key]))
        || ['requestId', 'draftId', 'draftIterationId'].some((key) => text(stage[key]) !== text(requestBinding[key]))
        || stage.planId !== plan.planId || stage.planFingerprint !== plan.planFingerprint) throw invalid(stage.stageKey)
      history.set(id, stage)
    }
    const accepted = recordedStages.map((entry, index) => {
      const stage = history.get(text(entry.stageExecutionId))
      if (!stage || stage.stageKey !== sequence[index] || stage.stageOrder !== index + 1
        || stage.status !== 'SUCCEEDED' || entry.stageKey !== stage.stageKey
        || entry.attemptFingerprint !== stage.attemptFingerprint || entry.outputFingerprint !== stage.outputFingerprint
        || ['stageOrder', 'status', 'predecessorStageExecutionId', 'predecessorAttemptFingerprint'].some((key) =>
          entry[key] !== stage[key])
        || ['grrExecutionId', 'grrRuntimeArtifactId'].some((key) => Object.hasOwn(entry, key)
          && text(entry[key]) !== text(stage.executionIdentity?.[key]))
        || stages.some((other) => other.stageKey === stage.stageKey && other.stageExecutionId !== stage.stageExecutionId
          && Number(other.attemptNumber) >= Number(stage.attemptNumber))) throw invalid(sequence[index])
      return stage
    })
    const validated = new Set()
    const visiting = new Set()
    const validateRecord = (stage) => {
      if (!stage) throw invalid()
      if (validated.has(stage.stageExecutionId)) return
      if (visiting.has(stage.stageExecutionId)) throw invalid(stage.stageKey)
      visiting.add(stage.stageExecutionId)
      const sourceId = text(stage.inputSnapshot?.sourceStage?.stageExecutionId)
      const source = sourceId ? history.get(sourceId) : null
      if (sourceId) validateRecord(source)
      const prior = Number(stage.attemptNumber) > 1 ? history.get(stage.predecessorStageExecutionId) : null
      if (prior) validateRecord(prior)
      if (Number(stage.attemptNumber) > 1 && (!prior || prior.stageKey !== stage.stageKey
        || Number(prior.attemptNumber) !== Number(stage.attemptNumber) - 1)) throw invalid(stage.stageKey)
      const remediationId = text(stage.outputSnapshot?.remediationSourceStageExecutionId)
      const remediation = remediationId ? history.get(remediationId) : null
      if (remediationId) validateRecord(remediation)
      const candidate = buildOutcomeQualityStageExecutionCandidate({
        plan,
        runtimeInstanceId: plan.runtimeInstanceId,
        expectedPlanFingerprint: plan.planFingerprint,
        stageKey: stage.stageKey,
        expectedLatestAttemptNumber: Number(stage.attemptNumber) - 1,
        predecessorStageExecutionId: stage.predecessorStageExecutionId,
        predecessorAttemptFingerprint: stage.predecessorAttemptFingerprint,
        sourceStageExecution: source,
        status: stage.status,
        ...(stage.status === 'SUCCEEDED' ? { output: stage.outputSnapshot } : { failure: stage.failure }),
        executionIdentity: stage.executionIdentity,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        requestBinding,
        styleSource,
      })
      if (candidate.inputFingerprint !== stage.inputFingerprint
        || hashOutcomeQualityStageValue(stage.inputSnapshot) !== stage.inputFingerprint
        || candidate.outputFingerprint !== (stage.outputFingerprint || '')
        || (stage.status === 'SUCCEEDED' && hashOutcomeQualityStageValue(stage.outputSnapshot) !== stage.outputFingerprint)
        || candidate.attemptFingerprint !== stage.attemptFingerprint
        || candidate.qualityRunId !== stage.qualityRunId
        || ['planVersion', 'resolutionFingerprint', 'contextFingerprint'].some((key) => candidate[key] !== stage[key])) throw invalid(stage.stageKey)
      assertOutcomeQualityStageRetryLineage({ candidate, latest: prior, source, remediation })
      visiting.delete(stage.stageExecutionId)
      validated.add(stage.stageExecutionId)
    }
    accepted.forEach((stage, index) => {
      if (index > 0 && (stage.inputSnapshot?.sourceStage?.stageExecutionId !== accepted[index - 1].stageExecutionId
        || stage.inputSnapshot?.sourceStage?.attemptFingerprint !== accepted[index - 1].attemptFingerprint
        || stage.inputSnapshot?.sourceStage?.outputFingerprint !== accepted[index - 1].outputFingerprint)) throw invalid(stage.stageKey)
      validateRecord(stage)
    })
    return accepted
  } catch (error) {
    if (error?.details?.blockerReason) throw error
    throw invalid(error?.details?.stageKey)
  }
}
