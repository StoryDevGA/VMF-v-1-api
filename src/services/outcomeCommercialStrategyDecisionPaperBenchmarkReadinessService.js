import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const text = (value) => String(value || '').trim()

const invalid = (code, details = {}) => ({ code, ...details })

export const buildCommercialStrategyDecisionPaperBenchmarkReadiness = ({
  benchmarkReference,
} = {}) => {
  const reference = benchmarkReference || null
  const blockers = []

  if (!reference) {
    blockers.push(invalid('BENCHMARK_REFERENCE_MISSING'))
  } else {
    if (text(reference.benchmarkKey) !== COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.benchmarkKey) {
      blockers.push(invalid('BENCHMARK_KEY_MISMATCH', { expected: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.benchmarkKey }))
    }
    if (text(reference.title) !== COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.title) {
      blockers.push(invalid('BENCHMARK_TITLE_MISMATCH', { expected: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.title }))
    }
    if (text(reference.sprintKey) !== COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.sprintKey) {
      blockers.push(invalid('BENCHMARK_SPRINT_MISMATCH', { expected: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK.sprintKey }))
    }
    if (text(reference.status).toUpperCase() !== 'APPROVED') {
      blockers.push(invalid('BENCHMARK_REFERENCE_NOT_APPROVED'))
    }
    if (text(reference.family).toUpperCase() !== 'PROFESSIONAL_DOCUMENT') {
      blockers.push(invalid('BENCHMARK_REFERENCE_FAMILY_INVALID', { expected: 'PROFESSIONAL_DOCUMENT' }))
    }
    if (!SHA256_PATTERN.test(text(reference.sha256))) {
      blockers.push(invalid('BENCHMARK_REFERENCE_SHA256_INVALID'))
    }
    if (!text(reference.provenanceUri).startsWith('https://')) {
      blockers.push(invalid('BENCHMARK_REFERENCE_PROVENANCE_INVALID'))
    }
  }

  return {
    status: blockers.length ? 'BENCHMARK_REFERENCE_BLOCKED' : 'BENCHMARK_REFERENCE_READY',
    benchmarkAvailable: blockers.length === 0,
    benchmark: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
    reference: reference ? {
      benchmarkKey: text(reference.benchmarkKey),
      title: text(reference.title),
      sprintKey: text(reference.sprintKey),
      family: text(reference.family),
      status: text(reference.status).toUpperCase(),
      sha256: text(reference.sha256).toLowerCase(),
      provenanceUri: text(reference.provenanceUri),
    } : null,
    blockers,
  }
}

export default {
  buildCommercialStrategyDecisionPaperBenchmarkReadiness,
}
