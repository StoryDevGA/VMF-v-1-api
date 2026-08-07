import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildCommercialStrategyDecisionPaperEvidenceManifest } from './outcomeCommercialStrategyDecisionPaperEvidenceManifestService.js'
import { buildCommercialStrategyDecisionPaperExercisePlan } from './outcomeCommercialStrategyDecisionPaperExerciseService.js'
import { buildCommercialStrategyDecisionPaperPackageIntegrityReport } from './outcomeCommercialStrategyDecisionPaperPackageIntegrityService.js'
import { buildCommercialStrategyDecisionPaperProgressSummary } from './outcomeCommercialStrategyDecisionPaperProgressSummaryService.js'
import { buildCommercialStrategyDecisionPaperReadinessProjection } from './outcomeCommercialStrategyDecisionPaperProjectionService.js'
import { buildCommercialStrategyDecisionPaperReadinessReport } from './outcomeCommercialStrategyDecisionPaperReadinessService.js'
import { buildCommercialStrategyDecisionPaperRunGate } from './outcomeCommercialStrategyDecisionPaperRunGateService.js'
import { buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot } from './outcomeCommercialStrategyDecisionPaperSprintEvidenceService.js'

export const buildCommercialStrategyDecisionPaperReadinessPackage = ({
  kcpCandidate,
  candidate = kcpCandidate,
  binding = {},
  sourceInventory = [],
  benchmarkReference = null,
  candidateReference = null,
  comparisonResult = null,
  helpMetadata = [],
  selectedHelpRepositoryBinding = null,
} = {}) => {
  const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({
    kcpCandidate,
    candidate,
    binding,
  })
  const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
    readinessReport,
    sourceInventory,
    benchmarkReference,
  })
  const sprintEvidenceSnapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({
    exercisePlan,
    candidateReference,
    comparisonResult,
    helpMetadata,
    selectedHelpRepositoryBinding,
  })
  const runGate = buildCommercialStrategyDecisionPaperRunGate({
    readinessPackage: {
      status: sprintEvidenceSnapshot.status,
      readinessReport,
      exercisePlan,
      sprintEvidenceSnapshot,
    },
  })

  const readinessPackage = {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    status: sprintEvidenceSnapshot.status,
    readinessReport,
    exercisePlan,
    sprintEvidenceSnapshot,
    runGate,
  }

  const readinessProjection = buildCommercialStrategyDecisionPaperReadinessProjection({ readinessPackage })
  const evidenceManifest = buildCommercialStrategyDecisionPaperEvidenceManifest({ readinessProjection })
  const packageWithDerivedEvidence = {
    ...readinessPackage,
    readinessProjection,
    evidenceManifest,
    progressSummary: buildCommercialStrategyDecisionPaperProgressSummary({
      readinessPackage: {
        ...readinessPackage,
        readinessProjection,
        evidenceManifest,
      },
    }),
  }

  return {
    ...packageWithDerivedEvidence,
    packageIntegrity: buildCommercialStrategyDecisionPaperPackageIntegrityReport({
      readinessPackage: packageWithDerivedEvidence,
    }),
  }
}

export default {
  buildCommercialStrategyDecisionPaperReadinessPackage,
}
