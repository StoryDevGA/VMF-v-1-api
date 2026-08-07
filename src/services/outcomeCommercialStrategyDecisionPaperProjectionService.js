import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []

const packKeyList = (items = []) => asArray(items).map((item) => item.packKey).filter(Boolean).sort()

const blockers = (items = []) => asArray(items).map((item) => ({
  code: item.code || '',
  packKey: item.packKey || '',
  dimensionKey: item.dimensionKey || '',
})).filter((item) => item.code)

export const buildCommercialStrategyDecisionPaperReadinessProjection = ({
  readinessPackage = {},
} = {}) => {
  const readiness = readinessPackage.readinessReport || {}
  const exercise = readinessPackage.exercisePlan || {}
  const snapshot = readinessPackage.sprintEvidenceSnapshot || {}
  const acceptance = snapshot.acceptanceResult || {}
  const help = snapshot.helpReadiness || {}
  const runGate = readinessPackage.runGate || {}

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: readinessPackage.status || '',
    completionClaim: snapshot.completionClaim || 'NOT_COMPLETE',
    ss007Complete: snapshot.ss007Complete === true,
    runGate: {
      status: runGate.status || '',
      nextAction: runGate.nextAction || '',
      mayGenerate: runGate.mayGenerate === true,
      mayCompare: runGate.mayCompare === true,
      mayReportVerdict: runGate.mayReportVerdict === true,
      extendedQaRequired: runGate.extendedQaRequired === true,
      qaOutcomeOnly: runGate.qaOutcomeOnly === true,
      reason: runGate.reason || '',
      missingPacks: asArray(runGate.missingPacks).filter(Boolean).sort(),
      blockers: asArray(runGate.blockers).filter(Boolean).sort(),
    },
    knowledgeReadiness: {
      status: readiness.status || '',
      stopBeforeGeneration: readiness.stopBeforeGeneration === true,
      requiredPackCount: asArray(readiness.requiredPacks).length,
      selectedRequiredPackCount: asArray(readiness.requiredPacks).filter((pack) => pack.selected).length,
      missingPackKeys: packKeyList(readiness.missing),
      blockers: blockers(readiness.blocked),
    },
    sourceIntake: {
      status: exercise.sourceIntake?.status || '',
      activationReady: exercise.sourceIntake?.activationReady === true,
      requiredPackKeys: packKeyList(exercise.sourceIntake?.intakeRequirements),
    },
    sourceAuthority: {
      status: exercise.sourceAuthorityReport?.status || '',
      activationReady: exercise.sourceAuthorityReport?.activationReady === true,
      requiredPackKeys: asArray(exercise.sourceAuthorityReport?.requiredPackKeys).filter(Boolean).sort(),
      missingSourceDocuments: asArray(exercise.sourceAuthorityReport?.missingSourceDocuments).filter(Boolean).sort(),
      presentSourceDocuments: asArray(exercise.sourceAuthorityReport?.presentSourceDocuments).filter(Boolean).sort(),
      missingSupportAssets: asArray(exercise.sourceAuthorityReport?.missingSupportAssets).filter(Boolean).sort(),
      presentSupportAssets: asArray(exercise.sourceAuthorityReport?.presentSupportAssets).filter(Boolean).sort(),
    },
    benchmark: {
      status: exercise.benchmarkReadiness?.status || '',
      benchmarkAvailable: exercise.benchmarkReadiness?.benchmarkAvailable === true,
      blockers: blockers(exercise.benchmarkReadiness?.blockers),
    },
    candidate: {
      status: acceptance.candidateReadiness?.status || '',
      candidateAvailable: acceptance.candidateReadiness?.candidateAvailable === true,
      blockers: blockers(acceptance.candidateReadiness?.blockers),
    },
    comparison: {
      status: acceptance.comparisonReadiness?.status || '',
      comparisonAvailable: acceptance.comparisonReadiness?.comparisonAvailable === true,
      blockers: blockers(acceptance.comparisonReadiness?.blockers),
      result: acceptance.result || null,
    },
    help: {
      status: help.status || '',
      publicationReady: help.publicationReady === true,
      published: help.published === true,
      missingPaths: asArray(help.missingPaths).filter(Boolean).sort(),
      blockers: blockers(help.blockers),
    },
    qaEvidence: {
      scope: exercise.qaEvidence?.scope || '',
      extendedQaRequired: exercise.qaEvidence?.extendedQaRequired === true,
      browserQaRequired: exercise.qaEvidence?.browserQaRequired === true,
    },
  }
}

export default {
  buildCommercialStrategyDecisionPaperReadinessProjection,
}
