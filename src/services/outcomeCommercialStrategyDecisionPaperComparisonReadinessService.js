import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const HTTPS_PATTERN = /^https:\/\//i
const ACCEPTANCE_DIMENSION_STATUSES = new Set(['PASS', 'PARTIAL', 'FAIL'])
const PROHIBITED_CONTENT_FIELDS = [
  'content',
  'markdown',
  'documentText',
  'rawText',
  'benchmarkText',
  'candidateText',
  'bytes',
  'contentBase64',
]

const asArray = (value) => Array.isArray(value) ? value : []
const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()

const requiredDimensionKeys = (expectedDimensions = []) => (
  expectedDimensions.length
    ? expectedDimensions
    : COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions
).map(lower)

export const buildCommercialStrategyDecisionPaperComparisonReadiness = ({
  comparisonResult = null,
  expectedDimensions = [],
} = {}) => {
  const blockers = []
  const requiredDimensions = requiredDimensionKeys(expectedDimensions)
  if (!comparisonResult || typeof comparisonResult !== 'object' || Array.isArray(comparisonResult)) {
    blockers.push({ code: 'COMPARISON_RESULT_MISSING' })
  } else {
    const requestedOutputTypeKey = lower(comparisonResult.requestedOutputTypeKey || comparisonResult.outputTypeKey)
    const resultId = text(comparisonResult.resultId || comparisonResult.comparisonId || comparisonResult.id)
    const sha256 = lower(comparisonResult.sha256 || comparisonResult.resultSha256)
    const provenanceUri = text(comparisonResult.provenanceUri)
    const invoked = comparisonResult.invoked === true
    const dimensionResults = asArray(comparisonResult.dimensionResults)
    const observedDimensions = new Set()

    if (!invoked) blockers.push({ code: 'COMPARISON_NOT_INVOKED' })
    if (!resultId) blockers.push({ code: 'COMPARISON_RESULT_ID_MISSING' })
    if (requestedOutputTypeKey !== COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY) {
      blockers.push({ code: 'COMPARISON_OUTPUT_TYPE_MISMATCH' })
    }
    if (!SHA256_PATTERN.test(sha256)) blockers.push({ code: 'COMPARISON_RESULT_SHA256_INVALID' })
    if (!HTTPS_PATTERN.test(provenanceUri)) blockers.push({ code: 'COMPARISON_RESULT_PROVENANCE_INVALID' })
    for (const field of PROHIBITED_CONTENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(comparisonResult, field)) {
        blockers.push({ code: 'COMPARISON_RESULT_CONTAINS_CONTENT_FIELD', field })
      }
    }
    if (!dimensionResults.length) blockers.push({ code: 'COMPARISON_DIMENSIONS_MISSING' })
    for (const item of dimensionResults) {
      const dimensionKey = lower(item?.dimensionKey)
      const status = upper(item?.status)
      if (!dimensionKey) {
        blockers.push({ code: 'COMPARISON_DIMENSION_KEY_MISSING' })
        continue
      }
      if (!requiredDimensions.includes(dimensionKey)) {
        blockers.push({ code: 'COMPARISON_DIMENSION_UNKNOWN', dimensionKey })
      }
      if (observedDimensions.has(dimensionKey)) {
        blockers.push({ code: 'COMPARISON_DIMENSION_DUPLICATE', dimensionKey })
      }
      observedDimensions.add(dimensionKey)
      if (!ACCEPTANCE_DIMENSION_STATUSES.has(status)) {
        blockers.push({ code: 'COMPARISON_DIMENSION_STATUS_INVALID', dimensionKey })
      }
    }
  }

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: blockers.length ? 'COMPARISON_RESULT_BLOCKED' : 'COMPARISON_RESULT_READY',
    comparisonAvailable: blockers.length === 0,
    requiredDimensions,
    blockers,
  }
}

export default {
  buildCommercialStrategyDecisionPaperComparisonReadiness,
}
