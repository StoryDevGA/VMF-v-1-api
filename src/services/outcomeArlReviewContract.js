import { OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'

export const OUTCOME_ARL_REVIEW_DIMENSIONS = Object.freeze([
  'ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS',
])

const exactKeys = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const hasControlCharacters = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0)
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
})
const invalid = () => Object.assign(new Error('The ARL review result is invalid.'), {
  status: 502,
  code: 'OUTCOME_ARL_MEANING_REVIEW_PROVIDER_FAILED',
  details: { reason: 'ARL_MEANING_REVIEW_PROVIDER_OUTPUT_INVALID' },
})

export const outcomeArlReviewJsonSchema = () => ({
  type: 'object',
  additionalProperties: false,
  required: ['outputType', 'schemaVersion', 'overallStatus', 'findings'],
  properties: {
    outputType: { type: 'string', const: 'ARL_MEANING_REVIEW' },
    schemaVersion: { type: 'string', const: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION },
    overallStatus: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dimension', 'status', 'finding', 'requiredChange'],
        properties: {
          dimension: { type: 'string', enum: [...OUTCOME_ARL_REVIEW_DIMENSIONS] },
          status: { type: 'string', enum: ['PASS', 'FAIL'] },
          finding: { type: 'string', minLength: 1, maxLength: 4000 },
          requiredChange: { type: 'boolean' },
        },
      },
    },
  },
})

export const normalizeOutcomeArlProviderReview = (value) => {
  if (!exactKeys(value, ['outputType', 'schemaVersion', 'overallStatus', 'findings'])
    || value.outputType !== 'ARL_MEANING_REVIEW'
    || value.schemaVersion !== OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION
    || !['PASS', 'FAIL'].includes(value.overallStatus)
    || !Array.isArray(value.findings)
    || value.findings.length !== OUTCOME_ARL_REVIEW_DIMENSIONS.length) throw invalid()
  const findings = value.findings.map((item) => {
    if (!exactKeys(item, ['dimension', 'status', 'finding', 'requiredChange'])
      || !OUTCOME_ARL_REVIEW_DIMENSIONS.includes(item.dimension)
      || !['PASS', 'FAIL'].includes(item.status)
      || typeof item.finding !== 'string'
      || !item.finding.trim()
      || item.finding.length > 4000
      || hasControlCharacters(item.finding)
      || typeof item.requiredChange !== 'boolean'
      || (item.status === 'PASS') !== !item.requiredChange) throw invalid()
    return { ...item, finding: item.finding.trim() }
  })
  if (new Set(findings.map((item) => item.dimension)).size !== OUTCOME_ARL_REVIEW_DIMENSIONS.length) throw invalid()
  const overallStatus = findings.some((item) => item.requiredChange) ? 'FAIL' : 'PASS'
  if (value.overallStatus !== overallStatus) throw invalid()
  return {
    outputType: 'ARL_MEANING_REVIEW',
    schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
    overallStatus,
    findings,
  }
}
