import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const HTTPS_PATTERN = /^https:\/\//i
const READY_STATUSES = new Set(['GENERATED', 'READY', 'READY_FOR_COMPARISON'])
const PROHIBITED_CONTENT_FIELDS = [
  'content',
  'markdown',
  'documentText',
  'rawText',
  'bytes',
  'contentBase64',
]

const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()

export const buildCommercialStrategyDecisionPaperCandidateReadiness = ({
  candidateReference = null,
} = {}) => {
  const blockers = []
  if (!candidateReference || typeof candidateReference !== 'object' || Array.isArray(candidateReference)) {
    blockers.push({ code: 'CANDIDATE_REFERENCE_MISSING' })
  } else {
    const requestedOutputTypeKey = lower(candidateReference.requestedOutputTypeKey || candidateReference.outputTypeKey)
    const status = upper(candidateReference.status)
    const sha256 = lower(candidateReference.sha256 || candidateReference.contentSha256)
    const provenanceUri = text(candidateReference.provenanceUri)
    const assetId = text(candidateReference.assetId || candidateReference.outcomeAssetId || candidateReference.id)

    if (!assetId) blockers.push({ code: 'CANDIDATE_REFERENCE_ID_MISSING' })
    if (requestedOutputTypeKey !== COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY) {
      blockers.push({ code: 'CANDIDATE_OUTPUT_TYPE_MISMATCH' })
    }
    if (!READY_STATUSES.has(status)) blockers.push({ code: 'CANDIDATE_REFERENCE_NOT_READY' })
    if (!SHA256_PATTERN.test(sha256)) blockers.push({ code: 'CANDIDATE_REFERENCE_SHA256_INVALID' })
    if (!HTTPS_PATTERN.test(provenanceUri)) blockers.push({ code: 'CANDIDATE_REFERENCE_PROVENANCE_INVALID' })
    for (const field of PROHIBITED_CONTENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(candidateReference, field)) {
        blockers.push({ code: 'CANDIDATE_REFERENCE_CONTAINS_CONTENT_FIELD', field })
      }
    }
  }

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: blockers.length ? 'CANDIDATE_REFERENCE_BLOCKED' : 'CANDIDATE_REFERENCE_READY',
    candidateAvailable: blockers.length === 0,
    blockers,
  }
}

export default {
  buildCommercialStrategyDecisionPaperCandidateReadiness,
}
