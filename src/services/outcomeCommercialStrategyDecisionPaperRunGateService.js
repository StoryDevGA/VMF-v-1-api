import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []

const missingPackKeys = (readinessPackage = {}) => (
  asArray(readinessPackage.readinessReport?.missing).map((pack) => pack.packKey).filter(Boolean)
)

const blockerCodes = (readinessPackage = {}) => [
  ...asArray(readinessPackage.readinessReport?.blocked).map((blocker) => blocker.code).filter(Boolean),
  ...asArray(readinessPackage.sprintEvidenceSnapshot?.acceptanceResult?.blockers).map((blocker) => blocker.code).filter(Boolean),
  ...asArray(readinessPackage.sprintEvidenceSnapshot?.helpReadiness?.blockers).map((blocker) => blocker.code).filter(Boolean),
]

export const buildCommercialStrategyDecisionPaperRunGate = ({
  readinessPackage = {},
} = {}) => {
  const packageStatus = readinessPackage.status || ''
  const acceptance = readinessPackage.sprintEvidenceSnapshot?.acceptanceResult || {}
  const exercisePlan = readinessPackage.exercisePlan || readinessPackage.sprintEvidenceSnapshot?.exercisePlan || {}
  const benchmarkReadiness = exercisePlan.benchmarkReadiness || {}
  const candidateReadiness = acceptance.candidateReadiness || {}
  const comparisonReadiness = acceptance.comparisonReadiness || {}
  const helpReadiness = readinessPackage.sprintEvidenceSnapshot?.helpReadiness || {}
  const missingPacks = missingPackKeys(readinessPackage)
  const blockers = blockerCodes(readinessPackage)

  const base = {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    packageStatus,
    mayGenerate: false,
    mayCompare: false,
    mayReportVerdict: false,
    extendedQaRequired: false,
    qaOutcomeOnly: false,
    missingPacks,
    blockers,
  }

  if (packageStatus === 'BLOCKED' || missingPacks.length) {
    return {
      ...base,
      status: 'STOP',
      nextAction: 'REPORT_MISSING_KNOWLEDGE_PACKS',
      reason: 'KNOWLEDGE_READINESS_BLOCKED',
    }
  }

  if (!benchmarkReadiness.benchmarkAvailable) {
    return {
      ...base,
      status: 'STOP',
      nextAction: 'REPORT_MISSING_BENCHMARK_REFERENCE',
      reason: 'BENCHMARK_READINESS_BLOCKED',
    }
  }

  if (!candidateReadiness.candidateAvailable) {
    return {
      ...base,
      status: 'READY_FOR_GENERATION',
      nextAction: 'GENERATE_CANDIDATE',
      mayGenerate: true,
      reason: 'KNOWLEDGE_AND_BENCHMARK_READINESS_AVAILABLE',
    }
  }

  if (!comparisonReadiness.comparisonAvailable) {
    return {
      ...base,
      status: 'READY_FOR_COMPARISON',
      nextAction: 'RUN_BENCHMARK_COMPARISON',
      mayCompare: true,
      reason: 'CANDIDATE_REFERENCE_READY',
    }
  }

  if (acceptance.status === 'COMPARED') {
    return {
      ...base,
      status: 'READY_FOR_VERDICT',
      nextAction: helpReadiness.publicationReady
        ? 'REPORT_PASS_PARTIAL_OR_FAIL'
        : 'REPORT_PASS_PARTIAL_OR_FAIL_WITH_HELP_BLOCKED',
      mayReportVerdict: true,
      qaOutcomeOnly: true,
      reason: 'CANDIDATE_AND_COMPARISON_EVIDENCE_READY',
    }
  }

  return {
    ...base,
    status: 'STOP',
    nextAction: 'REPORT_EXACT_BLOCKERS',
    reason: 'UNRESOLVED_EVIDENCE_STATE',
  }
}

export default {
  buildCommercialStrategyDecisionPaperRunGate,
}
