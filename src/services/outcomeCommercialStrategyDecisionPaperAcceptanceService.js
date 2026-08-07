import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildCommercialStrategyDecisionPaperCandidateReadiness } from './outcomeCommercialStrategyDecisionPaperCandidateReadinessService.js'
import { buildCommercialStrategyDecisionPaperComparisonReadiness } from './outcomeCommercialStrategyDecisionPaperComparisonReadinessService.js'

const asArray = (value) => Array.isArray(value) ? value : []
const upper = (value) => String(value || '').trim().toUpperCase()
const lower = (value) => String(value || '').trim().toLowerCase()

const ACCEPTANCE_DIMENSION_STATUSES = new Set(['PASS', 'PARTIAL', 'FAIL'])

const requiredDimensions = (exercisePlan = {}) => {
  const dimensions = asArray(exercisePlan.comparison?.acceptanceDimensions)
  return dimensions.length ? dimensions : COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions
}

const normalizeDimensionResults = (comparisonResult = {}) => {
  const byDimension = new Map()
  for (const item of asArray(comparisonResult.dimensionResults)) {
    const dimensionKey = lower(item.dimensionKey)
    const status = upper(item.status)
    if (!dimensionKey || !ACCEPTANCE_DIMENSION_STATUSES.has(status)) continue
    byDimension.set(dimensionKey, {
      dimensionKey,
      status,
      evidenceReference: String(item.evidenceReference || '').trim(),
      notes: String(item.notes || '').trim(),
    })
  }
  return byDimension
}

export const buildCommercialStrategyDecisionPaperAcceptanceResult = ({
  exercisePlan,
  candidateReference = null,
  comparisonResult = null,
} = {}) => {
  const plan = exercisePlan || {}
  const dimensions = requiredDimensions(plan)
  const candidateReadiness = buildCommercialStrategyDecisionPaperCandidateReadiness({ candidateReference })
  const candidateAvailable = plan.candidateGeneration?.candidateAvailable === true
    || candidateReadiness.candidateAvailable === true
  const comparisonReadiness = buildCommercialStrategyDecisionPaperComparisonReadiness({
    comparisonResult,
    expectedDimensions: dimensions,
  })
  const comparisonInvoked = plan.comparison?.invoked === true
    || comparisonReadiness.comparisonAvailable === true
  const benchmarkAvailable = plan.comparison?.benchmarkAvailable === true

  const base = {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    generated: candidateAvailable,
    compared: comparisonInvoked,
    benchmarkAvailable,
    candidateReadiness,
    comparisonReadiness,
    result: null,
    dimensionResults: [],
    blockers: [],
  }

  if (plan.status === COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED) {
    return {
      ...base,
      status: 'BLOCKED',
      blockers: [
        { code: 'READINESS_BLOCKED' },
        ...asArray(plan.blocked?.blockers),
      ],
    }
  }

  if (!candidateAvailable) {
    return {
      ...base,
      status: 'NOT_RUN',
      blockers: candidateReference
        ? candidateReadiness.blockers
        : [{ code: 'CANDIDATE_NOT_GENERATED' }],
    }
  }

  if (!benchmarkAvailable) {
    return {
      ...base,
      status: 'BLOCKED',
      blockers: [{ code: 'BENCHMARK_NOT_AVAILABLE' }],
    }
  }

  if (!comparisonInvoked || !comparisonResult) {
    return {
      ...base,
      status: 'NOT_RUN',
      blockers: comparisonResult
        ? comparisonReadiness.blockers
        : [{ code: 'COMPARISON_NOT_RUN' }],
    }
  }

  if (!comparisonReadiness.comparisonAvailable) {
    return {
      ...base,
      status: 'BLOCKED',
      blockers: comparisonReadiness.blockers,
    }
  }

  const suppliedResults = normalizeDimensionResults(comparisonResult)
  const dimensionResults = dimensions.map((dimensionKey) => {
    const normalizedKey = lower(dimensionKey)
    return suppliedResults.get(normalizedKey) || {
      dimensionKey: normalizedKey,
      status: 'PARTIAL',
      evidenceReference: '',
      notes: 'Required comparison dimension was not evidenced.',
    }
  })

  const result = dimensionResults.some((item) => item.status === 'FAIL')
    ? 'FAIL'
    : dimensionResults.some((item) => item.status === 'PARTIAL')
      ? 'PARTIAL_PASS'
      : 'PASS'

  return {
    ...base,
    status: 'COMPARED',
    result,
    dimensionResults,
    blockers: result === 'PASS'
      ? []
      : dimensionResults
        .filter((item) => item.status !== 'PASS')
        .map((item) => ({ code: `DIMENSION_${item.status}`, dimensionKey: item.dimensionKey })),
  }
}

export default {
  buildCommercialStrategyDecisionPaperAcceptanceResult,
}
