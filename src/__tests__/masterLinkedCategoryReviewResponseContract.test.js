import Ajv from 'ajv'
import { buildMasterLinkedCategoryReviewResponseSchema, normalizeMasterLinkedCategoryReviewResponse,
  MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS, normalizeRenderedExpressionRlOutput } from '../utils/outcomeRenderedExpressionRlOutput.js'
import { OUTCOME_QUALITY_STAGE_OUTPUT_TYPES } from '../constants/outcomeGovernedQuality.js'

const dimensions = RENDERED_EXPRESSION_RL_DIMENSIONS
const wire = (status = 'PASS') => ({ outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
  schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION, overallStatus: status,
  findings: Object.fromEntries(dimensions.map(d => [d, { status: d === 'STATEMENTS' ? status : 'PASS',
    finding: 'Synthetic contract assessment only.', requiredChange: d === 'STATEMENTS' && status === 'FAIL' }])) })
const decode = value => normalizeMasterLinkedCategoryReviewResponse(JSON.stringify(value))
const invalid = reason => expect.objectContaining({ code: 'MASTER_LINKED_CATEGORY_REVIEW_OUTPUT_INVALID',
  details: expect.objectContaining(reason ? { reason } : { approvalAvailable: false, finalisationAvailable: false }) })

test.each(['PASS', 'FAIL'])('complete %s wire response maps to unchanged canonical findings', status => {
  const input = wire(status), validate = new Ajv().compile(buildMasterLinkedCategoryReviewResponseSchema())
  expect(validate(input)).toBe(true)
  const result = decode(input)
  expect(result).toEqual(normalizeRenderedExpressionRlOutput(result))
  expect(result.overallStatus).toBe(status); expect(result.findings.map(f => f.dimension)).toEqual(dimensions)
  expect(result.schemaVersion).not.toBe(input.schemaVersion)
  expect(result.receipt).toBeUndefined(); expect(result.completionPersisted).toBeUndefined()
})

test('schema requires exactly the seven named properties and returns independent objects', () => {
  const schema = buildMasterLinkedCategoryReviewResponseSchema(), other = buildMasterLinkedCategoryReviewResponseSchema()
  expect(schema.properties.findings.required).toEqual(dimensions)
  expect(Object.keys(schema.properties.findings.properties)).toEqual(dimensions)
  expect(schema.properties.findings.additionalProperties).toBe(false)
  schema.properties.findings.properties.STATEMENTS.properties.status.enum.push('OTHER')
  expect(other.properties.findings.properties.STATEMENTS.properties.status.enum).toEqual(['PASS', 'FAIL'])
  expect(schema.properties.findings.properties.HEADINGS.properties.status.enum).toEqual(['PASS', 'FAIL'])
})

test.each(dimensions)('missing category %s is rejected by both schema and decoder', dimension => {
  const value = wire(); delete value.findings[dimension]
  expect(new Ajv().compile(buildMasterLinkedCategoryReviewResponseSchema())(value)).toBe(false)
  expect(() => decode(value)).toThrow(invalid('CATEGORIES'))
})

test.each(['extra root', 'extra category', 'extra assessment', 'array findings', 'null findings', 'old version',
  'wrong output', 'lower status', 'wrong finding type', 'wrong boolean', 'long finding', 'overall mismatch',
  'change mismatch', 'whitespace finding'])('rejects %s without inventing an assessment', kind => {
  const value = wire()
  if (kind === 'extra root') value.extra = true
  if (kind === 'extra category') value.findings.EXTRA = value.findings.STATEMENTS
  if (kind === 'extra assessment') value.findings.STATEMENTS.dimension = 'STATEMENTS'
  if (kind === 'array findings') value.findings = Object.entries(value.findings).map(([dimension, f]) => ({ dimension, ...f }))
  if (kind === 'null findings') value.findings = null
  if (kind === 'old version') value.schemaVersion = 'fs-003-rendered-expression-rl.v0.2'
  if (kind === 'wrong output') value.outputType = 'OTHER'
  if (kind === 'lower status') value.findings.STATEMENTS.status = 'pass'
  if (kind === 'wrong finding type') value.findings.STATEMENTS.finding = 123
  if (kind === 'wrong boolean') value.findings.STATEMENTS.requiredChange = 'false'
  if (kind === 'long finding') value.findings.STATEMENTS.finding = 'a'.repeat(4001)
  if (kind === 'overall mismatch') value.overallStatus = 'FAIL'
  if (kind === 'change mismatch') value.findings.STATEMENTS.requiredChange = true
  if (kind === 'whitespace finding') value.findings.STATEMENTS.finding = '   '
  expect(() => decode(value)).toThrow(invalid())
})

test.each(['root', 'category', 'escaped category', 'assessment'])('raw duplicate %s keys cannot be overwritten by JSON.parse', kind => {
  const text = JSON.stringify(wire())
  let duplicate
  if (kind === 'root') duplicate = text.replace('{', '{"overallStatus":"FAIL",')
  if (kind === 'category') duplicate = text.replace('"findings":{', '"findings":{"STATEMENTS":{},')
  if (kind === 'escaped category') duplicate = text.replace('"findings":{', '"findings":{"\\u0053TATEMENTS":{},')
  if (kind === 'assessment') duplicate = text.replace('"STATEMENTS":{', '"STATEMENTS":{"status":"FAIL",')
  expect(() => JSON.parse(duplicate)).not.toThrow()
  expect(() => normalizeMasterLinkedCategoryReviewResponse(duplicate)).toThrow(invalid('DUPLICATE_JSON_KEY'))
})

test('quoted punctuation, escapes and reordered category fields preserve text and canonical order', () => {
  const value = wire(); value.findings = Object.fromEntries(Object.entries(value.findings).reverse())
  value.findings.STATEMENTS.finding = 'Quoted "key": {value} [array] and \\ escaped path. Two issues retained.'
  const result = decode(value)
  expect(result.findings.map(f => f.dimension)).toEqual(dimensions)
  expect(result.findings[0].finding).toBe(value.findings.STATEMENTS.finding)
})

test.each([null, {}, '', '  ', '{', 'null', '[]', '1', '"text"'])('rejects non-response input %j', value => {
  expect(() => normalizeMasterLinkedCategoryReviewResponse(value)).toThrow(invalid())
})

test('UTF-8 byte and nesting bounds are enforced without raw content in errors', () => {
  expect(() => normalizeMasterLinkedCategoryReviewResponse('"' + 'é'.repeat(30000) + '"')).toThrow(invalid('TEXT_BOUND'))
  expect(() => normalizeMasterLinkedCategoryReviewResponse('['.repeat(21) + '0' + ']'.repeat(21))).toThrow(invalid('JSON_DEPTH'))
  try { normalizeMasterLinkedCategoryReviewResponse('{secret-invalid-json') } catch (error) {
    expect(error.message).not.toContain('secret'); expect(error.details.reason).toBe('JSON_SYNTAX')
  }
})
