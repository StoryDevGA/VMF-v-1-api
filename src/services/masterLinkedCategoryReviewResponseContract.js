import { OUTCOME_QUALITY_STAGE_OUTPUT_TYPES, OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS, normalizeRenderedExpressionRlOutput } from '../utils/outcomeRenderedExpressionRlOutput.js'

export const MASTER_LINKED_CATEGORY_RESPONSE_VERSION = 'master-linked-docx-category-review-response.v1'
export const MASTER_LINKED_CATEGORY_RESPONSE_NAME = 'master_linked_docx_visual_rl_v3'
const dimensions = RENDERED_EXPRESSION_RL_DIMENSIONS
const invalid = reason => Object.assign(new TypeError('The named-category review response is invalid.'), {
  code: 'MASTER_LINKED_CATEGORY_REVIEW_OUTPUT_INVALID', details: { reason, approvalAvailable: false, finalisationAvailable: false },
})
const need = (value, reason) => { if (!value) throw invalid(reason) }
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const assessmentSchema = () => ({ type: 'object', additionalProperties: false,
  required: ['status', 'finding', 'requiredChange'], properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL'] }, finding: { type: 'string', minLength: 1, maxLength: 4000 },
    requiredChange: { type: 'boolean' },
  } })

// A separate wire contract. The historical array schema and saved results keep
// their existing versions; a missing category is never filled or inferred.
export const buildMasterLinkedCategoryReviewResponseSchema = () => ({
  type: 'object', additionalProperties: false, required: ['outputType', 'schemaVersion', 'overallStatus', 'findings'],
  properties: {
    outputType: { type: 'string', const: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL },
    schemaVersion: { type: 'string', const: MASTER_LINKED_CATEGORY_RESPONSE_VERSION },
    overallStatus: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: { type: 'object', additionalProperties: false, required: [...dimensions],
      properties: Object.fromEntries(dimensions.map(dimension => [dimension, assessmentSchema()])) },
  },
})

const parseUniqueJson = text => {
  need(typeof text === 'string' && text.trim().length > 0 && Buffer.byteLength(text, 'utf8') <= 60000, 'TEXT_BOUND')
  let value
  try { value = JSON.parse(text) } catch { throw invalid('JSON_SYNTAX') }
  // JSON.parse establishes syntax, but loses duplicate keys. Scan the same
  // bounded text before using its value; decode escapes when comparing keys.
  const containers = []
  for (let i = 0; i < text.length; i += 1) {
    const token = text[i]
    if (token === '{' || token === '[') {
      containers.push(token === '{' ? new Set() : null); need(containers.length <= 20, 'JSON_DEPTH')
    } else if (token === '}' || token === ']') containers.pop()
    else if (token === '"') {
      const start = i
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '\\') i += 1
        else if (text[i] === '"') break
      }
      let next = i + 1
      while (/\s/.test(text[next] || '') && next < text.length) next += 1
      if (text[next] === ':') {
        const keys = containers.at(-1), key = JSON.parse(text.slice(start, i + 1))
        need(keys instanceof Set && !keys.has(key), 'DUPLICATE_JSON_KEY'); keys.add(key)
      }
    }
  }
  return value
}

// Canonical findings data only. This does not create adapter ownership, a
// completed receipt, dispatch permission or an accepted persisted review.
export const normalizeMasterLinkedCategoryReviewResponse = text => {
  const value = parseUniqueJson(text)
  need(exact(value, ['outputType', 'schemaVersion', 'overallStatus', 'findings'])
    && value.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
    && value.schemaVersion === MASTER_LINKED_CATEGORY_RESPONSE_VERSION
    && ['PASS', 'FAIL'].includes(value.overallStatus), 'RESPONSE_SHAPE')
  need(exact(value.findings, dimensions), 'CATEGORIES')
  const findings = dimensions.map(dimension => {
    const assessment = value.findings[dimension]
    need(exact(assessment, ['status', 'finding', 'requiredChange']) && ['PASS', 'FAIL'].includes(assessment.status)
      && typeof assessment.finding === 'string' && assessment.finding.length <= 4000
      && typeof assessment.requiredChange === 'boolean', 'ASSESSMENT_SHAPE')
    return { dimension, ...assessment }
  })
  return normalizeRenderedExpressionRlOutput({ outputType: value.outputType,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION, overallStatus: value.overallStatus, findings },
  () => invalid('CANONICAL_RULES'))
}
