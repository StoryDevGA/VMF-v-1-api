import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildOutcomeKnowledgeCompositionPlanForRuntime } from './outcomeKnowledgeCompositionPlanService.js'
import { buildCommercialStrategyDecisionPaperReadinessPackage } from './outcomeCommercialStrategyDecisionPaperPackageService.js'

export const buildCommercialStrategyDecisionPaperRuntimeReadinessPackage = async ({
  actorUserId,
  auditRequest = null,
  scopes,
  runtimeInstanceId,
  expectedRuntimeUpdatedAt,
  consumerIntent = {},
  sourceInventory = [],
  benchmarkReference = null,
  candidateReference = null,
  comparisonResult = null,
  helpMetadata = [],
  selectedHelpRepositoryBinding = null,
  deps = {},
} = {}) => {
  const buildKcpCandidate = deps.buildKcpCandidate || buildOutcomeKnowledgeCompositionPlanForRuntime
  const kcpCandidate = await buildKcpCandidate({
    actorUserId,
    auditRequest,
    scopes,
    runtimeInstanceId,
    expectedRuntimeUpdatedAt,
    consumerIntent: {
      ...consumerIntent,
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    },
    deps,
  })

  return buildCommercialStrategyDecisionPaperReadinessPackage({
    kcpCandidate,
    sourceInventory,
    benchmarkReference,
    candidateReference,
    comparisonResult,
    helpMetadata,
    selectedHelpRepositoryBinding,
  })
}

export default {
  buildCommercialStrategyDecisionPaperRuntimeReadinessPackage,
}
