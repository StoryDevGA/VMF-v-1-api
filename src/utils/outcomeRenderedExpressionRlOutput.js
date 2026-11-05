import { OUTCOME_QUALITY_STAGE_OUTPUT_TYPES, OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'
export const RENDERED_EXPRESSION_RL_DIMENSIONS = Object.freeze([
  'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
])
const REQUIRED_DIMENSIONS = RENDERED_EXPRESSION_RL_DIMENSIONS
const text = value => String(value ?? '').trim()
const upper = value => text(value).toUpperCase()
const exactKeys = (value, keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)))
export const normalizeRenderedExpressionRlOutput = (value, invalid = () => new TypeError('Rendered-expression RL output is invalid.')) => {
  if (!exactKeys(value, ['outputType', 'schemaVersion', 'overallStatus', 'findings'])
    || upper(value.outputType) !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
    || value.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION
    || !['PASS', 'FAIL'].includes(upper(value.overallStatus))
    || !Array.isArray(value.findings)
    || value.findings.length !== REQUIRED_DIMENSIONS.length) {
    throw invalid()
  }
  const findings = value.findings.map((finding) => {
    if (!exactKeys(finding, ['dimension', 'status', 'finding', 'requiredChange'])
      || !REQUIRED_DIMENSIONS.includes(upper(finding.dimension))
      || !['PASS', 'FAIL'].includes(upper(finding.status))
      || !text(finding.finding)
      || text(finding.finding).length > 4000
      || typeof finding.requiredChange !== 'boolean'
      || (upper(finding.status) === 'PASS') !== (finding.requiredChange === false)) {
      throw invalid()
    }
    return {
      dimension: upper(finding.dimension),
      status: upper(finding.status),
      finding: text(finding.finding),
      requiredChange: finding.requiredChange,
    }
  })
  if (new Set(findings.map((finding) => finding.dimension)).size !== REQUIRED_DIMENSIONS.length
    || REQUIRED_DIMENSIONS.some((dimension) => !findings.some((finding) => finding.dimension === dimension))) {
    throw invalid()
  }
  const failed = findings.some((finding) => finding.status === 'FAIL')
  if ((upper(value.overallStatus) === 'FAIL') !== failed) {
    throw invalid()
  }
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
    overallStatus: failed ? 'FAIL' : 'PASS',
    findings,
  }
}

