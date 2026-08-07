import { createHash } from 'node:crypto'

import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const MANIFEST_COMPONENTS = Object.freeze([
  ['knowledge_readiness', 'knowledgeReadiness'],
  ['source_authority', 'sourceAuthority'],
  ['benchmark', 'benchmark'],
  ['candidate', 'candidate'],
  ['comparison', 'comparison'],
  ['run_gate', 'runGate'],
  ['help', 'help'],
  ['qa_evidence', 'qaEvidence'],
])

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key])
      return result
    }, {})
  }
  return value
}

export const hashCommercialStrategyDecisionPaperEvidenceValue = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex')

const componentStatus = (componentKey, value = {}) => {
  if (componentKey === 'run_gate') return value.status || 'UNKNOWN'
  if (componentKey === 'qa_evidence') return value.scope ? 'BOUNDED' : 'UNKNOWN'
  if (value.status) return value.status
  return 'UNKNOWN'
}

const componentAvailable = (componentKey, value = {}) => {
  switch (componentKey) {
    case 'knowledge_readiness':
      return value.status === 'READY' && value.stopBeforeGeneration !== true
    case 'source_authority':
      return value.status === 'NO_SOURCE_AUTHORITY_GAPS'
    case 'benchmark':
      return value.benchmarkAvailable === true
    case 'candidate':
      return value.candidateAvailable === true
    case 'comparison':
      return value.comparisonAvailable === true
    case 'run_gate':
      return ['READY_FOR_GENERATION', 'READY_FOR_COMPARISON', 'READY_FOR_VERDICT'].includes(value.status)
    case 'help':
      return value.publicationReady === true
    case 'qa_evidence':
      return value.extendedQaRequired !== true && value.browserQaRequired !== true
    default:
      return false
  }
}

export const buildCommercialStrategyDecisionPaperEvidenceManifest = ({
  readinessProjection = {},
} = {}) => {
  const components = MANIFEST_COMPONENTS.map(([componentKey, projectionKey]) => {
    const value = readinessProjection[projectionKey] || {}
    return {
      componentKey,
      status: componentStatus(componentKey, value),
      available: componentAvailable(componentKey, value),
      fingerprint: hashCommercialStrategyDecisionPaperEvidenceValue(value),
    }
  })
  const manifestFingerprint = hashCommercialStrategyDecisionPaperEvidenceValue({
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    projectionFingerprint: hashCommercialStrategyDecisionPaperEvidenceValue(readinessProjection),
    components,
  })

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: readinessProjection.status || 'UNKNOWN',
    completionClaim: readinessProjection.completionClaim || 'NOT_COMPLETE',
    ss007Complete: readinessProjection.ss007Complete === true,
    manifestFingerprint,
    components,
  }
}

export default {
  buildCommercialStrategyDecisionPaperEvidenceManifest,
  hashCommercialStrategyDecisionPaperEvidenceValue,
}
