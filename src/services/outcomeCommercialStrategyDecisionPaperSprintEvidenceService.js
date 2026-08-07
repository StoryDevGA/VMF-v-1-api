import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildCommercialStrategyDecisionPaperAcceptanceResult } from './outcomeCommercialStrategyDecisionPaperAcceptanceService.js'
import { buildCommercialStrategyDecisionPaperHelpReadiness } from './outcomeCommercialStrategyDecisionPaperHelpReadinessService.js'

const asArray = (value) => Array.isArray(value) ? value : []

const blockerSummary = (exercisePlan = {}) => ({
  missingPacks: asArray(exercisePlan.blocked?.missingPacks).map((pack) => pack.packKey),
  readinessBlockers: asArray(exercisePlan.blocked?.blockerCodes),
  benchmarkBlockers: asArray(exercisePlan.benchmarkReadiness?.blockers).map((blocker) => blocker.code),
})

const candidateStatus = (exercisePlan = {}, acceptanceResult = {}) => {
  if (exercisePlan.status === COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED) return 'BLOCKED'
  if (acceptanceResult.candidateReadiness?.candidateAvailable) return 'PRESENT'
  if (exercisePlan.candidateGeneration?.planned) return 'READY_TO_RUN'
  return 'NOT_RUN'
}

const comparisonStatus = (exercisePlan = {}, acceptanceResult = {}) => {
  if (exercisePlan.status === COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED) return 'BLOCKED'
  if (acceptanceResult.status === 'COMPARED') return 'PRESENT'
  if (!exercisePlan.comparison?.benchmarkAvailable) return 'BLOCKED'
  if (exercisePlan.comparison?.planned) return 'READY_TO_RUN'
  return 'NOT_RUN'
}

export const buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot = ({
  exercisePlan,
  candidateReference = null,
  comparisonResult = null,
  helpMetadata = [],
  selectedHelpRepositoryBinding = null,
} = {}) => {
  const plan = exercisePlan || {}
  const helpReadiness = buildCommercialStrategyDecisionPaperHelpReadiness({
    helpMetadata,
    selectedHelpRepositoryBinding,
  })
  const blocked = plan.status === COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED
  const acceptanceResult = buildCommercialStrategyDecisionPaperAcceptanceResult({
    exercisePlan: plan,
    candidateReference,
    comparisonResult,
  })
  const candidate = candidateStatus(plan, acceptanceResult)
  const comparison = comparisonStatus(plan, acceptanceResult)

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    sprintKey: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.sprintKey,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: blocked ? 'BLOCKED' : 'SCAFFOLD_READY',
    ss007Complete: false,
    completionClaim: 'NOT_COMPLETE',
    acceptanceChecklist: [
      {
        itemKey: 'golden_reasoning_chain_fixture',
        label: 'One commercial strategy decision-paper reasoning-chain fixture',
        status: plan.goldenReasoningChainFixture?.fixtureKey ? 'PRESENT' : 'MISSING',
        evidenceScope: 'STRUCTURAL_SCAFFOLD_ONLY',
      },
      {
        itemKey: 'generated_commercial_strategy_decision_paper_candidate',
        label: 'One generated commercial strategy and decision paper candidate',
        status: candidate,
        invoked: plan.candidateGeneration?.invoked === true,
        evidenceScope: 'NOT_GENERATED_IN_THIS_SLICE',
      },
      {
        itemKey: 'approved_benchmark_comparison',
        label: 'One comparison against the approved commercial strategy decision-paper benchmark',
        status: comparison,
        invoked: plan.comparison?.invoked === true,
        benchmarkAvailable: plan.comparison?.benchmarkAvailable === true,
        evidenceScope: 'NOT_COMPARED_IN_THIS_SLICE',
      },
      {
        itemKey: 'pass_partial_fail_result',
        label: 'Clear pass, partial pass or fail result',
        status: acceptanceResult.status,
        result: acceptanceResult.result,
        evidenceScope: acceptanceResult.status === 'COMPARED'
          ? 'COMPARISON_RESULT_EVIDENCE'
          : 'UNAVAILABLE_UNTIL_GENERATION_AND_COMPARISON_RUN',
      },
      {
        itemKey: 'qa_chain_evidence',
        label: 'QA evidence proves the chain',
        status: plan.qaEvidence?.scope === 'READINESS_CHAIN_ONLY' ? 'BOUNDED' : 'UNKNOWN',
        evidenceScope: plan.qaEvidence?.scope || '',
      },
      {
        itemKey: 'help_impact_publication_readiness',
        label: 'Help impact publication readiness',
        status: helpReadiness.publicationReady ? 'READY_NOT_PUBLISHED' : 'BLOCKED',
        published: false,
        evidenceScope: 'HELP_BINDING_READINESS_ONLY',
      },
    ],
    acceptanceResult,
    helpReadiness,
    blockers: blockerSummary(plan),
  }
}

export default {
  buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot,
}
