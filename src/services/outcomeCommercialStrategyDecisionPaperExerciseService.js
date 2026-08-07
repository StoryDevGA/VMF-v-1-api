import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
  COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildCommercialStrategyDecisionPaperBenchmarkReadiness } from './outcomeCommercialStrategyDecisionPaperBenchmarkReadinessService.js'
import { buildCommercialStrategyDecisionPaperChainFixturePackage } from './outcomeCommercialStrategyDecisionPaperChainFixtureService.js'
import { buildCommercialStrategyDecisionPaperSourceAuthorityReport } from './outcomeCommercialStrategyDecisionPaperSourceAuthorityReportService.js'
import { buildCommercialStrategyDecisionPaperSourceIntakePlan } from './outcomeCommercialStrategyDecisionPaperSourceIntakeService.js'

const asArray = (value) => Array.isArray(value) ? value : []

const uniqueStagePlan = (readinessReport = {}) => {
  const byStage = new Map()
  for (const pack of asArray(readinessReport.requiredPacks)) {
    const stageKey = pack.stageKey || ''
    if (!stageKey) continue
    if (!byStage.has(stageKey)) {
      byStage.set(stageKey, {
        stageKey,
        kcpStage: pack.kcpStage || '',
        requiredPackKeys: [],
        selectedPackKeys: [],
        missingPackKeys: [],
      })
    }
    const stage = byStage.get(stageKey)
    stage.requiredPackKeys.push(pack.packKey)
    if (pack.selected) stage.selectedPackKeys.push(pack.packKey)
    if (asArray(pack.blockers).length) stage.missingPackKeys.push(pack.packKey)
  }
  return [...byStage.values()].map((stage, index) => ({
    order: index + 1,
    ...stage,
    requiredPackKeys: [...new Set(stage.requiredPackKeys)].sort(),
    selectedPackKeys: [...new Set(stage.selectedPackKeys)].sort(),
    missingPackKeys: [...new Set(stage.missingPackKeys)].sort(),
  }))
}

const exactBlockers = (readinessReport = {}) => ({
  missingPacks: asArray(readinessReport.missing).map((pack) => ({
    packKey: pack.packKey,
    sourceSeedPackKey: pack.sourceSeedPackKey || '',
    packType: pack.packType || '',
    name: pack.name || '',
    stageKey: pack.stageKey || '',
    requiredFor: pack.requiredFor || '',
  })),
  blockedStages: uniqueStagePlan(readinessReport).filter((stage) => stage.missingPackKeys.length),
  blockerCodes: asArray(readinessReport.blocked).map((blocker) => blocker.code).filter(Boolean),
  blockers: asArray(readinessReport.blocked),
})

export const buildCommercialStrategyDecisionPaperExercisePlan = ({
  readinessReport,
  sourceInventory = [],
  benchmarkReference = null,
} = {}) => {
  const readiness = readinessReport || {}
  const blocked = readiness.stopBeforeGeneration === true
    || readiness.status === COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED
  const benchmarkReadiness = buildCommercialStrategyDecisionPaperBenchmarkReadiness({ benchmarkReference })
  const sourceIntake = buildCommercialStrategyDecisionPaperSourceIntakePlan({ readinessReport: readiness, sourceInventory })
  const chainFixturePackage = buildCommercialStrategyDecisionPaperChainFixturePackage()

  const base = {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    benchmark: readiness.benchmark || COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
    goldenReasoningChainFixture: chainFixturePackage.fixture,
    goldenReasoningChainFixturePackage: chainFixturePackage,
    sourceIntake,
    sourceAuthorityReport: buildCommercialStrategyDecisionPaperSourceAuthorityReport({ sourceIntake }),
    benchmarkReadiness,
    readinessStatus: readiness.status || '',
    knowledgeCompositionPlan: readiness.knowledgeCompositionPlan || null,
    candidateGeneration: {
      planned: !blocked,
      invoked: false,
      candidateAvailable: false,
      blockedReason: blocked ? 'KNOWLEDGE_READINESS_BLOCKED' : '',
    },
    comparison: {
      planned: !blocked,
      invoked: false,
      result: null,
      resultStatus: 'NOT_RUN',
      blockedReason: blocked ? 'KNOWLEDGE_READINESS_BLOCKED' : '',
      benchmarkAvailable: benchmarkReadiness.benchmarkAvailable,
      benchmarkRequired: chainFixturePackage.fixture.benchmarkRequired,
      acceptanceDimensions: chainFixturePackage.fixture.acceptanceDimensions,
    },
    qaEvidence: {
      scope: 'READINESS_CHAIN_ONLY',
      extendedQaRequired: false,
      browserQaRequired: false,
    },
  }

  if (blocked) {
    return {
      ...base,
      status: COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED,
      stopBeforeGeneration: true,
      blocked: exactBlockers(readiness),
      plannedStages: uniqueStagePlan(readiness),
    }
  }

  return {
    ...base,
    status: COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.READY_FOR_GENERATION,
    stopBeforeGeneration: false,
    blocked: exactBlockers(readiness),
    plannedStages: uniqueStagePlan(readiness),
  }
}

export default {
  buildCommercialStrategyDecisionPaperExercisePlan,
}
