import { createRequire } from 'node:module'
import { findOutcomeCustomerLanguageViolation } from './outcomeCustomerLanguageService.js'

const require = createRequire(import.meta.url)
const { SaxesParser } = require('saxes')

const WIDTH = 1800
const HEIGHT = 2546
const DISCLOSURE = 'Illustrative reference candidate | not approved'
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const FONT_FAMILY = 'Arial, Aptos, Segoe UI, sans-serif'
const REQUIRED_GROUPS = Object.freeze([
  'header',
  'recommendation',
  'current-state',
  'economics',
  'operating-model',
  'outcomes',
  'roadmap',
  'risks',
  'decision',
  'footer',
])
const GROUP_BACKGROUNDS = Object.freeze({
  header: '#F5F7F8',
  recommendation: '#173B5E',
  'current-state': '#FFFFFF',
  economics: '#FFFFFF',
  'operating-model': '#EAF1F5',
  outcomes: '#FFFFFF',
  roadmap: '#FFFFFF',
  risks: '#FFFFFF',
  decision: '#FFFFFF',
  footer: '#F5F7F8',
})
const PALETTE = new Set([
  'none', '#071C33', '#173B5E', '#286FA3', '#087F78', '#29A59A', '#C85A1A',
  '#FFFFFF', '#F5F7F8', '#EAF1F5', '#EEF5F8', '#FCE9DD', '#D7E0E7', '#526373',
])
const FONT_SIZES = new Set(['18', '24', '27', '31', '42', '49', '66', '74'])
const FONT_WEIGHTS = new Set(['400', '600', '700'])
const ALLOWED_ELEMENTS = new Set(['svg', 'title', 'desc', 'g', 'rect', 'line', 'circle', 'polyline', 'text', 'tspan'])
const ALLOWED_ATTRIBUTES = Object.freeze({
  svg: new Set(['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-labelledby']),
  title: new Set(['id']),
  desc: new Set(['id']),
  g: new Set(['id', 'role', 'aria-labelledby']),
  rect: new Set(['id', 'x', 'y', 'width', 'height', 'rx', 'fill', 'stroke', 'stroke-width', 'aria-hidden']),
  line: new Set(['id', 'x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'aria-hidden']),
  circle: new Set(['id', 'cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'aria-hidden']),
  polyline: new Set(['id', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'aria-hidden']),
  text: new Set(['id', 'x', 'y', 'fill', 'font-family', 'font-size', 'font-weight', 'text-anchor']),
  tspan: new Set(['id', 'x', 'dy', 'fill', 'font-size', 'font-weight']),
})
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const REFERENCE_PATTERN = /(?:%|url\s*\(|data\s*:|file\s*:|javascript\s*:|https?\s*:|\/\/|\\|[\x00-\x1f\x7f])/i
const TEXT_WORD_PATTERN = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu

export const PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-infographic-svg-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-007-v1.1-NOT-APPROVED',
  templateProfile: 'executive-decision-infographic-neutral.v0.1',
  engine: Object.freeze({
    key: 'INTERNAL_DETERMINISTIC_SVG_COMPILER_ENGINEERING_CANDIDATE',
    version: '0.1.0',
    xmlParser: 'saxes@6.0.0',
  }),
  limits: Object.freeze({
    maxSourceBytes: 32_768,
    maxSourceDepth: 4,
    maxSourceEntries: 180,
    minVisibleWords: 100,
    maxVisibleWords: 349,
    maxOutputBytes: 524_288,
    width: WIDTH,
    height: HEIGHT,
  }),
})

export const PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_INPUT_INVALID',
  INPUT_UNSAFE: 'PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_INPUT_UNSAFE',
  LIMIT_EXCEEDED: 'PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_VALIDATION_FAILED',
})

const createCandidateError = ({ code, reason }) => {
  const error = new Error('The professional infographic SVG engineering candidate could not complete this render.')
  error.name = 'ProfessionalInfographicSvgCandidateError'
  error.code = code
  error.reason = reason
  error.details = Object.freeze({ reason, contentIncludedInError: false })
  return error
}

const fail = (code, reason, details) => { throw createCandidateError({ code, reason, details }) }
const failInput = (reason, details) => fail(PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.INPUT_INVALID, reason, details)
const failUnsafe = (reason, details) => fail(PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.INPUT_UNSAFE, reason, details)
const failLimit = (reason, details) => fail(PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, reason, details)
const failValidation = (reason, details) => fail(PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, reason, details)

const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
)

const assertObject = (value, path) => {
  if (!isPlainObject(value)) failInput('INFOGRAPHIC_OBJECT_INVALID', { path })
}

const assertExactKeys = (value, allowed, path) => {
  assertObject(value, path)
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unsupported) failInput('INFOGRAPHIC_FIELD_UNSUPPORTED', { path: `${path}.${unsupported}` })
  const missing = allowed.find((key) => !Object.prototype.hasOwnProperty.call(value, key))
  if (missing) failInput('INFOGRAPHIC_FIELD_REQUIRED', { path: `${path}.${missing}` })
}

const inspectSourceShape = (value) => {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxSourceBytes) {
    failLimit('INFOGRAPHIC_SOURCE_LIMIT_EXCEEDED')
  }
  let entries = 0
  const visited = new WeakSet()
  const visit = (current, depth) => {
    entries += 1
    if (entries > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxSourceEntries
      || depth > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxSourceDepth) {
      failLimit('INFOGRAPHIC_SOURCE_LIMIT_EXCEEDED')
    }
    if (!current || typeof current !== 'object') return
    if (visited.has(current)) failInput('INFOGRAPHIC_OBJECT_INVALID')
    visited.add(current)
    if (Array.isArray(current)) current.forEach((entry) => visit(entry, depth + 1))
    else Object.values(current).forEach((entry) => visit(entry, depth + 1))
  }
  visit(value, 0)
}

const normalizeText = (value, { path, minBytes = 1, maxBytes }) => {
  if (typeof value !== 'string') failInput('INFOGRAPHIC_TEXT_INVALID', { path })
  const normalized = value
    .normalize('NFKC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized || /[\x00-\x1f\x7f-\x9f]/u.test(normalized) || /[\uD800-\uDFFF]/u.test(normalized)) {
    failInput('INFOGRAPHIC_TEXT_INVALID', { path })
  }
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (bytes < minBytes || bytes > maxBytes) failLimit('INFOGRAPHIC_TEXT_LIMIT_EXCEEDED', { path })
  return normalized
}

const assertInteger = (value, min, max, path) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) failInput('INFOGRAPHIC_NUMBER_INVALID', { path })
  return value
}

const parseMetric = (value, path) => {
  assertExactKeys(value, ['label', 'value', 'detail'], path)
  return Object.freeze({
    label: normalizeText(value.label, { path: `${path}.label`, maxBytes: 100 }),
    value: normalizeText(value.value, { path: `${path}.value`, maxBytes: 80 }),
    detail: normalizeText(value.detail, { path: `${path}.detail`, maxBytes: 180 }),
  })
}

const parseFixedArray = (value, length, path, parser) => {
  if (!Array.isArray(value) || value.length !== length) failInput('INFOGRAPHIC_ARRAY_LENGTH_INVALID', { path, expectedLength: length })
  return Object.freeze(value.map((entry, index) => parser(entry, `${path}[${index}]`)))
}

const parseLabelDetail = (value, path) => {
  assertExactKeys(value, ['label', 'detail'], path)
  return Object.freeze({
    label: normalizeText(value.label, { path: `${path}.label`, maxBytes: 100 }),
    detail: normalizeText(value.detail, { path: `${path}.detail`, maxBytes: 180 }),
  })
}

const parseOutcome = (value, path) => {
  assertExactKeys(value, ['label', 'baseline', 'target'], path)
  return Object.freeze({
    label: normalizeText(value.label, { path: `${path}.label`, maxBytes: 120 }),
    baseline: normalizeText(value.baseline, { path: `${path}.baseline`, maxBytes: 80 }),
    target: normalizeText(value.target, { path: `${path}.target`, maxBytes: 100 }),
  })
}

const parsePhase = (value, path) => {
  assertExactKeys(value, ['period', 'label', 'detail'], path)
  return Object.freeze({
    period: normalizeText(value.period, { path: `${path}.period`, maxBytes: 80 }),
    label: normalizeText(value.label, { path: `${path}.label`, maxBytes: 100 }),
    detail: normalizeText(value.detail, { path: `${path}.detail`, maxBytes: 180 }),
  })
}

const parseRisk = (value, path) => {
  assertExactKeys(value, ['label', 'probability', 'impact', 'score'], path)
  const probability = assertInteger(value.probability, 1, 5, `${path}.probability`)
  const impact = assertInteger(value.impact, 1, 5, `${path}.impact`)
  const score = assertInteger(value.score, 1, 25, `${path}.score`)
  if (score !== probability * impact) failInput('INFOGRAPHIC_RISK_SCORE_MISMATCH', { path: `${path}.score` })
  return Object.freeze({
    label: normalizeText(value.label, { path: `${path}.label`, maxBytes: 140 }),
    probability,
    impact,
    score,
  })
}

const countWords = (value) => String(value ?? '').match(TEXT_WORD_PATTERN)?.length || 0

export const parseProfessionalInfographicCandidateInput = (input) => {
  try {
    inspectSourceShape(input)
    assertExactKeys(input, [
      'schemaVersion', 'deliverableFamily', 'template', 'metadata', 'recommendation',
      'currentState', 'economicCase', 'operatingModel', 'outcomes', 'roadmap', 'risks', 'decision',
    ], 'infographic')
    if (input.schemaVersion !== 'governed-deliverable.v1') failInput('INFOGRAPHIC_SCHEMA_UNSUPPORTED')
    if (input.deliverableFamily !== 'INFOGRAPHIC') failInput('INFOGRAPHIC_FAMILY_UNSUPPORTED')
    if (input.template !== 'EXECUTIVE_DECISION_INFOGRAPHIC') failInput('INFOGRAPHIC_TEMPLATE_UNSUPPORTED')

    assertExactKeys(input.metadata, ['title', 'subtitle', 'audience', 'status', 'versionNumber', 'disclosure', 'altText'], 'infographic.metadata')
    if (input.metadata.status !== 'DRAFT') failInput('INFOGRAPHIC_STATUS_UNSUPPORTED')
    if (input.metadata.disclosure !== DISCLOSURE) failInput('INFOGRAPHIC_DISCLOSURE_INVALID')
    const metadata = Object.freeze({
      title: normalizeText(input.metadata.title, { path: 'infographic.metadata.title', maxBytes: 180 }),
      subtitle: normalizeText(input.metadata.subtitle, { path: 'infographic.metadata.subtitle', maxBytes: 240 }),
      audience: normalizeText(input.metadata.audience, { path: 'infographic.metadata.audience', maxBytes: 160 }),
      status: input.metadata.status,
      versionNumber: assertInteger(input.metadata.versionNumber, 1, 9999, 'infographic.metadata.versionNumber'),
      disclosure: input.metadata.disclosure,
      altText: normalizeText(input.metadata.altText, { path: 'infographic.metadata.altText', minBytes: 80, maxBytes: 800 }),
    })

    assertExactKeys(input.recommendation, ['label', 'heading', 'statement'], 'infographic.recommendation')
    const recommendation = Object.freeze({
      label: normalizeText(input.recommendation.label, { path: 'infographic.recommendation.label', maxBytes: 80 }),
      heading: normalizeText(input.recommendation.heading, { path: 'infographic.recommendation.heading', maxBytes: 180 }),
      statement: normalizeText(input.recommendation.statement, { path: 'infographic.recommendation.statement', maxBytes: 320 }),
    })

    assertExactKeys(input.currentState, ['heading', 'primaryMetric', 'metrics'], 'infographic.currentState')
    const currentState = Object.freeze({
      heading: normalizeText(input.currentState.heading, { path: 'infographic.currentState.heading', maxBytes: 180 }),
      primaryMetric: parseMetric(input.currentState.primaryMetric, 'infographic.currentState.primaryMetric'),
      metrics: parseFixedArray(input.currentState.metrics, 4, 'infographic.currentState.metrics', parseMetric),
    })

    assertExactKeys(input.economicCase, ['heading', 'metrics', 'qualifier'], 'infographic.economicCase')
    const economicCase = Object.freeze({
      heading: normalizeText(input.economicCase.heading, { path: 'infographic.economicCase.heading', maxBytes: 180 }),
      metrics: parseFixedArray(input.economicCase.metrics, 3, 'infographic.economicCase.metrics', parseMetric),
      qualifier: normalizeText(input.economicCase.qualifier, { path: 'infographic.economicCase.qualifier', maxBytes: 320 }),
    })

    assertExactKeys(input.operatingModel, ['heading', 'steps'], 'infographic.operatingModel')
    const operatingModel = Object.freeze({
      heading: normalizeText(input.operatingModel.heading, { path: 'infographic.operatingModel.heading', maxBytes: 180 }),
      steps: parseFixedArray(input.operatingModel.steps, 4, 'infographic.operatingModel.steps', parseLabelDetail),
    })

    assertExactKeys(input.outcomes, ['heading', 'rows'], 'infographic.outcomes')
    const outcomes = Object.freeze({
      heading: normalizeText(input.outcomes.heading, { path: 'infographic.outcomes.heading', maxBytes: 180 }),
      rows: parseFixedArray(input.outcomes.rows, 5, 'infographic.outcomes.rows', parseOutcome),
    })

    assertExactKeys(input.roadmap, ['heading', 'phases'], 'infographic.roadmap')
    const roadmap = Object.freeze({
      heading: normalizeText(input.roadmap.heading, { path: 'infographic.roadmap.heading', maxBytes: 180 }),
      phases: parseFixedArray(input.roadmap.phases, 4, 'infographic.roadmap.phases', parsePhase),
    })

    assertExactKeys(input.risks, ['heading', 'items', 'response'], 'infographic.risks')
    const risks = Object.freeze({
      heading: normalizeText(input.risks.heading, { path: 'infographic.risks.heading', maxBytes: 180 }),
      items: parseFixedArray(input.risks.items, 3, 'infographic.risks.items', parseRisk),
      response: normalizeText(input.risks.response, { path: 'infographic.risks.response', maxBytes: 320 }),
    })

    assertExactKeys(input.decision, ['heading', 'statement', 'conditions'], 'infographic.decision')
    const decision = Object.freeze({
      heading: normalizeText(input.decision.heading, { path: 'infographic.decision.heading', maxBytes: 180 }),
      statement: normalizeText(input.decision.statement, { path: 'infographic.decision.statement', maxBytes: 420 }),
      conditions: parseFixedArray(input.decision.conditions, 5, 'infographic.decision.conditions', (entry, path) => normalizeText(entry, { path, maxBytes: 180 })),
    })

    const parsed = Object.freeze({
      schemaVersion: input.schemaVersion,
      deliverableFamily: input.deliverableFamily,
      template: input.template,
      metadata,
      recommendation,
      currentState,
      economicCase,
      operatingModel,
      outcomes,
      roadmap,
      risks,
      decision,
    })
    const violation = findOutcomeCustomerLanguageViolation(parsed, { path: 'infographic' })
    if (violation) failUnsafe('INFOGRAPHIC_CUSTOMER_LANGUAGE_UNSAFE', { termKey: violation.termKey || violation.code })
    const words = countWords([
      parsed.metadata.title,
      parsed.metadata.subtitle,
      parsed.metadata.audience,
      parsed.metadata.disclosure,
      ...collectText(parsed.recommendation),
      ...collectText(parsed.currentState),
      ...collectText(parsed.economicCase),
      ...collectText(parsed.operatingModel),
      ...collectText(parsed.outcomes),
      ...collectText(parsed.roadmap),
      ...collectText(parsed.risks),
      ...collectText(parsed.decision),
    ].join(' '))
    if (words < PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.minVisibleWords
      || words > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxVisibleWords) {
      failLimit('INFOGRAPHIC_WORD_LIMIT_EXCEEDED', { wordCount: words })
    }
    return parsed
  } catch (error) {
    if (error?.name === 'ProfessionalInfographicSvgCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.INPUT_INVALID,
      reason: 'INFOGRAPHIC_OBJECT_INVALID',
    })
  }
}

function collectText(value, output = []) {
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) value.forEach((entry) => collectText(entry, output))
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => collectText(entry, output))
  return output
}

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const splitLines = (value, maxCharacters, maxLines, reasonPath) => {
  const words = String(value).split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    if (word.length > maxCharacters) failLimit('INFOGRAPHIC_TEXT_LIMIT_EXCEEDED', { path: reasonPath })
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxCharacters) current = next
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (lines.length > maxLines) failLimit('INFOGRAPHIC_TEXT_LIMIT_EXCEEDED', { path: reasonPath })
  return lines
}

const createSvgBuilder = () => {
  const lines = [XML_DECLARATION]
  let textIndex = 0
  const push = (line) => lines.push(line)
  const text = ({ id, x, y, value, size = 24, weight = 400, fill = '#173B5E', anchor = 'start', maxCharacters = 60, maxLines = 1, lineHeight = Math.ceil(size * 1.25), path = id }) => {
    splitLines(value, maxCharacters, maxLines, path).forEach((line, index) => {
      const lineId = index === 0 ? id : `${id}-${index + 1}`
      textIndex += 1
      push(`    <text id="${lineId}" x="${x}" y="${y + (index * lineHeight)}" fill="${fill}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line)}</text>`)
    })
  }
  return { lines, push, text, getTextCount: () => textIndex }
}

const openGroup = (builder, id, { x, y, width, height, fill, labelId, label }) => {
  builder.push(`  <g id="${id}" role="group" aria-labelledby="${labelId}">`)
  builder.push(`    <rect id="${id}-background" x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${fill}" aria-hidden="true"/>`)
  builder.text({ id: labelId, x: x + 50, y: y + 60, value: label, size: 18, weight: 700, fill: id === 'recommendation' ? '#FFFFFF' : '#173B5E', maxCharacters: 48, path: `${id}.label` })
}

const closeGroup = (builder) => builder.push('  </g>')

const compileParsedInfographic = (data) => {
  const builder = createSvgBuilder()
  builder.push(`<svg xmlns="${SVG_NAMESPACE}" width="1800" height="2546" viewBox="0 0 1800 2546" role="img" aria-labelledby="svg-title svg-desc">`)
  builder.push(`  <title id="svg-title">${escapeXml(data.metadata.title)}</title>`)
  builder.push(`  <desc id="svg-desc">${escapeXml(data.metadata.altText)}</desc>`)

  openGroup(builder, 'header', { x: 0, y: 0, width: 1800, height: 330, fill: '#F5F7F8', labelId: 'header-label', label: 'EXECUTIVE DECISION CASE' })
  builder.text({ id: 'header-title', x: 80, y: 145, value: data.metadata.title, size: 74, weight: 700, maxCharacters: 25, maxLines: 2, lineHeight: 84, path: 'metadata.title' })
  builder.text({ id: 'header-subtitle', x: 80, y: 292, value: data.metadata.subtitle, size: 31, fill: '#526373', maxCharacters: 88, maxLines: 1, path: 'metadata.subtitle' })
  builder.text({ id: 'scenario-marker', x: 1690, y: 70, value: 'FICTIONAL SCENARIO', size: 18, weight: 700, anchor: 'end', maxCharacters: 22, path: 'scenario-marker' })
  builder.text({ id: 'header-audience', x: 1690, y: 112, value: data.metadata.audience, size: 24, weight: 600, anchor: 'end', maxCharacters: 44, path: 'metadata.audience' })
  closeGroup(builder)

  openGroup(builder, 'recommendation', { x: 80, y: 350, width: 1640, height: 230, fill: '#173B5E', labelId: 'recommendation-label', label: data.recommendation.label.toUpperCase() })
  builder.text({ id: 'recommendation-heading', x: 140, y: 490, value: data.recommendation.heading, size: 42, weight: 700, fill: '#FFFFFF', maxCharacters: 58, maxLines: 1, path: 'recommendation.heading' })
  builder.text({ id: 'recommendation-statement', x: 140, y: 540, value: data.recommendation.statement, size: 27, fill: '#FFFFFF', maxCharacters: 104, maxLines: 1, path: 'recommendation.statement' })
  closeGroup(builder)

  openGroup(builder, 'current-state', { x: 80, y: 610, width: 800, height: 500, fill: '#FFFFFF', labelId: 'current-state-label', label: 'CURRENT STATE' })
  builder.text({ id: 'current-heading', x: 130, y: 730, value: data.currentState.heading, size: 42, weight: 700, maxCharacters: 34, maxLines: 2, path: 'currentState.heading' })
  builder.text({ id: 'current-primary-value', x: 130, y: 820, value: data.currentState.primaryMetric.value, size: 66, weight: 700, maxCharacters: 18, path: 'currentState.primaryMetric.value' })
  builder.text({ id: 'current-primary-label', x: 130, y: 860, value: data.currentState.primaryMetric.label, size: 27, weight: 700, maxCharacters: 42, path: 'currentState.primaryMetric.label' })
  builder.text({ id: 'current-primary-detail', x: 130, y: 890, value: data.currentState.primaryMetric.detail, size: 24, fill: '#526373', maxCharacters: 48, path: 'currentState.primaryMetric.detail' })
  data.currentState.metrics.forEach((metric, index) => {
    const x = 130 + ((index % 2) * 350)
    const y = 930 + (Math.floor(index / 2) * 100)
    builder.text({ id: `current-metric-${index + 1}-value`, x, y, value: metric.value, size: 27, weight: 700, maxCharacters: 18, path: `currentState.metrics[${index}].value` })
    builder.text({ id: `current-metric-${index + 1}-label`, x, y: y + 29, value: metric.label, size: 24, weight: 700, maxCharacters: 34, path: `currentState.metrics[${index}].label` })
    builder.text({ id: `current-metric-${index + 1}-detail`, x, y: y + 58, value: metric.detail, size: 24, fill: '#526373', maxCharacters: 38, path: `currentState.metrics[${index}].detail` })
  })
  closeGroup(builder)

  openGroup(builder, 'economics', { x: 920, y: 610, width: 800, height: 500, fill: '#FFFFFF', labelId: 'economics-label', label: 'BASE ECONOMIC CASE' })
  builder.text({ id: 'economics-heading', x: 970, y: 730, value: data.economicCase.heading, size: 42, weight: 700, maxCharacters: 34, maxLines: 2, path: 'economicCase.heading' })
  data.economicCase.metrics.forEach((metric, index) => {
    const x = 970 + ((index % 2) * 350)
    const y = 840 + (Math.floor(index / 2) * 115)
    builder.text({ id: `economics-metric-${index + 1}-value`, x, y, value: metric.value, size: 49, weight: 700, maxCharacters: 18, path: `economicCase.metrics[${index}].value` })
    builder.text({ id: `economics-metric-${index + 1}-label`, x, y: y + 36, value: metric.label, size: 24, weight: 700, maxCharacters: 32, path: `economicCase.metrics[${index}].label` })
    builder.text({ id: `economics-metric-${index + 1}-detail`, x, y: y + 64, value: metric.detail, size: 24, fill: '#526373', maxCharacters: 38, path: `economicCase.metrics[${index}].detail` })
  })
  builder.text({ id: 'economics-qualifier', x: 970, y: 1065, value: data.economicCase.qualifier, size: 24, fill: '#526373', maxCharacters: 68, maxLines: 2, path: 'economicCase.qualifier' })
  closeGroup(builder)

  openGroup(builder, 'operating-model', { x: 80, y: 1140, width: 1640, height: 310, fill: '#EAF1F5', labelId: 'operating-model-label', label: 'FUTURE OPERATING MODEL' })
  builder.text({ id: 'operating-heading', x: 130, y: 1260, value: data.operatingModel.heading, size: 42, weight: 700, maxCharacters: 58, path: 'operatingModel.heading' })
  data.operatingModel.steps.forEach((step, index) => {
    const x = 130 + (index * 395)
    builder.push(`    <circle id="operating-step-${index + 1}-circle" cx="${x + 24}" cy="1332" r="24" fill="#FFFFFF" aria-hidden="true"/>`)
    builder.text({ id: `operating-step-${index + 1}-number`, x: x + 24, y: 1341, value: String(index + 1), size: 24, weight: 700, fill: '#173B5E', anchor: 'middle', maxCharacters: 2, path: `operatingModel.steps[${index}]` })
    builder.text({ id: `operating-step-${index + 1}-label`, x, y: 1392, value: step.label, size: 24, weight: 700, maxCharacters: 25, path: `operatingModel.steps[${index}].label` })
    builder.text({ id: `operating-step-${index + 1}-detail`, x, y: 1422, value: step.detail, size: 24, fill: '#526373', maxCharacters: 32, maxLines: 1, path: `operatingModel.steps[${index}].detail` })
  })
  closeGroup(builder)

  openGroup(builder, 'outcomes', { x: 80, y: 1480, width: 800, height: 430, fill: '#FFFFFF', labelId: 'outcomes-label', label: 'YEAR-ONE OUTCOMES' })
  builder.text({ id: 'outcomes-heading', x: 130, y: 1600, value: data.outcomes.heading, size: 42, weight: 700, maxCharacters: 34, path: 'outcomes.heading' })
  data.outcomes.rows.forEach((row, index) => {
    const y = 1660 + (index * 48)
    builder.text({ id: `outcome-${index + 1}-label`, x: 130, y, value: row.label, size: 24, weight: 700, maxCharacters: 28, path: `outcomes.rows[${index}].label` })
    builder.text({ id: `outcome-${index + 1}-baseline`, x: 500, y, value: row.baseline, size: 24, fill: '#526373', maxCharacters: 16, path: `outcomes.rows[${index}].baseline` })
    builder.text({ id: `outcome-${index + 1}-target`, x: 830, y, value: row.target, size: 24, weight: 700, anchor: 'end', maxCharacters: 20, path: `outcomes.rows[${index}].target` })
    builder.push(`    <line id="outcome-${index + 1}-rule" x1="130" y1="${y + 16}" x2="830" y2="${y + 16}" stroke="#D7E0E7" stroke-width="2" aria-hidden="true"/>`)
  })
  closeGroup(builder)

  openGroup(builder, 'roadmap', { x: 920, y: 1480, width: 800, height: 430, fill: '#FFFFFF', labelId: 'roadmap-label', label: 'DELIVERY ROADMAP' })
  builder.text({ id: 'roadmap-heading', x: 970, y: 1600, value: data.roadmap.heading, size: 42, weight: 700, maxCharacters: 34, path: 'roadmap.heading' })
  data.roadmap.phases.forEach((phase, index) => {
    const y = 1662 + (index * 58)
    builder.push(`    <circle id="roadmap-phase-${index + 1}-circle" cx="995" cy="${y - 8}" r="18" fill="#FFFFFF" aria-hidden="true"/>`)
    builder.text({ id: `roadmap-phase-${index + 1}-number`, x: 995, y: y, value: String(index + 1), size: 24, weight: 700, fill: '#173B5E', anchor: 'middle', maxCharacters: 2, path: `roadmap.phases[${index}]` })
    builder.text({ id: `roadmap-phase-${index + 1}-period`, x: 1030, y: y - 12, value: phase.period, size: 24, weight: 700, maxCharacters: 18, path: `roadmap.phases[${index}].period` })
    builder.text({ id: `roadmap-phase-${index + 1}-label`, x: 1230, y: y - 12, value: phase.label, size: 24, weight: 700, maxCharacters: 28, path: `roadmap.phases[${index}].label` })
    builder.text({ id: `roadmap-phase-${index + 1}-detail`, x: 1030, y: y + 18, value: phase.detail, size: 24, fill: '#526373', maxCharacters: 48, path: `roadmap.phases[${index}].detail` })
  })
  closeGroup(builder)

  openGroup(builder, 'risks', { x: 80, y: 1940, width: 800, height: 420, fill: '#FFFFFF', labelId: 'risks-label', label: 'RISKS AND CONDITIONS' })
  builder.text({ id: 'risks-heading', x: 130, y: 2060, value: data.risks.heading, size: 42, weight: 700, maxCharacters: 34, path: 'risks.heading' })
  data.risks.items.forEach((risk, index) => {
    const y = 2125 + (index * 56)
    builder.text({ id: `risk-${index + 1}-label`, x: 130, y, value: risk.label, size: 24, weight: 700, maxCharacters: 38, path: `risks.items[${index}].label` })
    builder.text({ id: `risk-${index + 1}-score`, x: 820, y, value: `Score ${risk.score}`, size: 18, weight: 700, anchor: 'end', maxCharacters: 10, path: `risks.items[${index}].score` })
  })
  builder.text({ id: 'risks-response', x: 130, y: 2300, value: data.risks.response, size: 24, fill: '#526373', maxCharacters: 58, maxLines: 2, path: 'risks.response' })
  closeGroup(builder)

  openGroup(builder, 'decision', { x: 920, y: 1940, width: 800, height: 420, fill: '#FFFFFF', labelId: 'decision-label', label: 'DECISION REQUIRED' })
  builder.text({ id: 'decision-heading', x: 970, y: 2060, value: data.decision.heading, size: 42, weight: 700, maxCharacters: 34, path: 'decision.heading' })
  builder.text({ id: 'decision-statement', x: 970, y: 2120, value: data.decision.statement, size: 24, weight: 700, maxCharacters: 66, maxLines: 2, path: 'decision.statement' })
  data.decision.conditions.forEach((condition, index) => {
    const y = 2205 + (index * 30)
    builder.text({ id: `decision-condition-${index + 1}`, x: 1000, y, value: `${index + 1}. ${condition}`, size: 24, fill: '#526373', maxCharacters: 54, path: `decision.conditions[${index}]` })
  })
  closeGroup(builder)

  openGroup(builder, 'footer', { x: 0, y: 2390, width: 1800, height: 156, fill: '#F5F7F8', labelId: 'footer-label', label: 'GOVERNANCE NOTE' })
  builder.text({ id: 'footer-disclosure', x: 80, y: 2508, value: data.metadata.disclosure, size: 18, weight: 600, fill: '#526373', maxCharacters: 70, path: 'metadata.disclosure' })
  builder.text({ id: 'footer-version', x: 1720, y: 2508, value: `Candidate v${data.metadata.versionNumber}`, size: 18, weight: 600, fill: '#526373', anchor: 'end', maxCharacters: 20, path: 'metadata.versionNumber' })
  closeGroup(builder)

  builder.push('</svg>')
  return { svg: `${builder.lines.join('\n')}\n`, textNodeCount: builder.getTextCount() }
}

export const compileProfessionalInfographicSvgCandidate = (input) => {
  try {
    const parsed = parseProfessionalInfographicCandidateInput(input)
    return compileParsedInfographic(parsed).svg
  } catch (error) {
    if (error?.name === 'ProfessionalInfographicSvgCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'SVG_RENDER_FAILED',
    })
  }
}

const parseSvg = (svg) => {
  const sourceWithoutDeclaration = svg.slice(XML_DECLARATION.length)
  if (!svg.startsWith(`${XML_DECLARATION}\n`)
    || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--/i.test(svg)
    || sourceWithoutDeclaration.includes('<?')) failValidation('SVG_XML_FORBIDDEN')
  const root = { name: '#document', attrs: {}, children: [], text: '', parent: null }
  const stack = [root]
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (node) => {
    const current = {
      name: node.local,
      uri: node.uri,
      prefix: node.prefix,
      attrs: Object.fromEntries(Object.values(node.attributes).map((attribute) => [attribute.name, {
        local: attribute.local,
        prefix: attribute.prefix,
        uri: attribute.uri,
        value: attribute.value,
      }])),
      children: [],
      text: '',
      parent: stack.at(-1),
    }
    stack.at(-1).children.push(current)
    stack.push(current)
  })
  parser.on('text', (text) => { stack.at(-1).text += text })
  parser.on('closetag', () => { stack.pop() })
  parser.on('error', () => { throw new Error('SVG_XML_INVALID') })
  try {
    parser.write(svg).close()
  } catch {
    failValidation('SVG_XML_INVALID')
  }
  if (stack.length !== 1 || root.children.length !== 1) failValidation('SVG_XML_INVALID')
  return root.children[0]
}

const attrValue = (node, name) => node.attrs[name]?.value
const allNodes = (root) => {
  const result = []
  const visit = (node) => {
    result.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  return result
}

const parseFinite = (value) => {
  if (!/^-?(?:\d+|\d+\.\d+)$/.test(String(value ?? ''))) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const validateBound = (value, min, max) => {
  const parsed = parseFinite(value)
  if (parsed === null || parsed < min || parsed > max) failValidation('SVG_GEOMETRY_INVALID')
  return parsed
}

const validateGeometry = (node) => {
  if (node.name === 'rect') {
    const x = validateBound(attrValue(node, 'x'), 0, WIDTH)
    const y = validateBound(attrValue(node, 'y'), 0, HEIGHT)
    const width = validateBound(attrValue(node, 'width'), 0.01, WIDTH)
    const height = validateBound(attrValue(node, 'height'), 0.01, HEIGHT)
    if (x + width > WIDTH || y + height > HEIGHT) failValidation('SVG_GEOMETRY_INVALID')
    if (attrValue(node, 'rx') !== undefined) validateBound(attrValue(node, 'rx'), 0, 20)
  }
  if (node.name === 'line') {
    validateBound(attrValue(node, 'x1'), 0, WIDTH)
    validateBound(attrValue(node, 'x2'), 0, WIDTH)
    validateBound(attrValue(node, 'y1'), 0, HEIGHT)
    validateBound(attrValue(node, 'y2'), 0, HEIGHT)
  }
  if (node.name === 'circle') {
    const cx = validateBound(attrValue(node, 'cx'), 0, WIDTH)
    const cy = validateBound(attrValue(node, 'cy'), 0, HEIGHT)
    const r = validateBound(attrValue(node, 'r'), 0.01, Math.min(WIDTH, HEIGHT))
    if (cx - r < 0 || cx + r > WIDTH || cy - r < 0 || cy + r > HEIGHT) failValidation('SVG_GEOMETRY_INVALID')
  }
  if (node.name === 'polyline') {
    const points = String(attrValue(node, 'points') || '').trim().split(/\s+/)
    if (points.length < 2) failValidation('SVG_GEOMETRY_INVALID')
    points.forEach((point) => {
      const pair = point.split(',')
      if (pair.length !== 2) failValidation('SVG_GEOMETRY_INVALID')
      validateBound(pair[0], 0, WIDTH)
      validateBound(pair[1], 0, HEIGHT)
    })
  }
  if (node.name === 'text') {
    validateBound(attrValue(node, 'x'), 0, WIDTH)
    validateBound(attrValue(node, 'y'), 0, HEIGHT)
  }
  if (node.name === 'tspan') {
    validateBound(attrValue(node, 'x'), 0, WIDTH)
    validateBound(attrValue(node, 'dy'), 0, HEIGHT)
  }
  if (attrValue(node, 'stroke-width') !== undefined) validateBound(attrValue(node, 'stroke-width'), 1, 8)
}

const hexToRgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
const luminance = (hex) => {
  const channels = hexToRgb(hex).map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}
const contrastRatio = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

const findAncestorGroup = (node) => {
  let current = node.parent
  while (current && current.name !== 'g') current = current.parent
  return current
}

const validateSvgInternal = (value) => {
  const buffer = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value, 'utf8') : null
  if (!buffer || buffer.length === 0) failValidation('SVG_OUTPUT_INVALID')
  if (buffer.length > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxOutputBytes) failLimit('SVG_OUTPUT_LIMIT_EXCEEDED')
  const svg = buffer.toString('utf8')
  if (Buffer.from(svg, 'utf8').length !== buffer.length || svg.includes('\uFFFD')) failValidation('SVG_OUTPUT_INVALID')
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(svg)) failValidation('SVG_REFERENCE_NOT_ALLOWED')
  const root = parseSvg(svg)
  const nodes = allNodes(root)

  for (const node of nodes) {
    if (!ALLOWED_ELEMENTS.has(node.name)) failValidation('SVG_ELEMENT_NOT_ALLOWED', { element: String(node.name).toUpperCase() })
    if (node.uri !== SVG_NAMESPACE || node.prefix) failValidation('SVG_NAMESPACE_NOT_ALLOWED')
    for (const attribute of Object.values(node.attrs)) {
      const attributeName = attribute.local
      if (attribute.prefix || (attribute.uri && attribute.uri !== 'http://www.w3.org/2000/xmlns/')) {
        failValidation('SVG_NAMESPACE_NOT_ALLOWED')
      }
      if (!ALLOWED_ATTRIBUTES[node.name].has(attributeName)) {
        if (attributeName === 'aria-hidden' && ['text', 'tspan', 'g', 'title', 'desc'].includes(node.name)) {
          failValidation('SVG_ACCESSIBILITY_TEXT_HIDDEN')
        }
        failValidation('SVG_ATTRIBUTE_NOT_ALLOWED', { attribute: String(attributeName).toUpperCase() })
      }
      const isRequiredRootNamespace = node === root
        && attributeName === 'xmlns'
        && attribute.value === SVG_NAMESPACE
      if (!isRequiredRootNamespace && REFERENCE_PATTERN.test(attribute.value)) {
        failValidation('SVG_REFERENCE_NOT_ALLOWED')
      }
    }
    if (attrValue(node, 'aria-hidden') !== undefined && attrValue(node, 'aria-hidden') !== 'true') failValidation('SVG_ATTRIBUTE_NOT_ALLOWED')
    if (node.name === 'text' && !new Set(['start', 'middle', 'end']).has(attrValue(node, 'text-anchor'))) {
      failValidation('SVG_ATTRIBUTE_NOT_ALLOWED')
    }
    if (node.name === 'polyline') {
      for (const attributeName of ['stroke-linecap', 'stroke-linejoin']) {
        const attributeValue = attrValue(node, attributeName)
        if (attributeValue !== undefined && attributeValue !== 'round') failValidation('SVG_ATTRIBUTE_NOT_ALLOWED')
      }
    }
    validateGeometry(node)
    for (const name of ['fill', 'stroke']) {
      const valueForPalette = attrValue(node, name)
      if (valueForPalette !== undefined && !PALETTE.has(valueForPalette)) failValidation('SVG_PALETTE_INVALID')
    }
  }

  if (root.name !== 'svg'
    || attrValue(root, 'xmlns') !== SVG_NAMESPACE
    || attrValue(root, 'width') !== String(WIDTH)
    || attrValue(root, 'height') !== String(HEIGHT)
    || attrValue(root, 'viewBox') !== `0 0 ${WIDTH} ${HEIGHT}`
    || attrValue(root, 'role') !== 'img') failValidation('SVG_ROOT_INVALID')

  const titleNodes = nodes.filter((node) => node.name === 'title')
  const descriptionNodes = nodes.filter((node) => node.name === 'desc')
  if (titleNodes.length !== 1 || descriptionNodes.length !== 1
    || titleNodes[0].parent !== root || descriptionNodes[0].parent !== root
    || root.children[0] !== titleNodes[0] || root.children[1] !== descriptionNodes[0]
    || attrValue(root, 'aria-labelledby') !== 'svg-title svg-desc'
    || attrValue(titleNodes[0], 'id') !== 'svg-title'
    || attrValue(descriptionNodes[0], 'id') !== 'svg-desc'
    || !titleNodes[0].text.trim() || !descriptionNodes[0].text.trim()) failValidation('SVG_ACCESSIBILITY_INVALID')

  const textNodes = nodes.filter((node) => node.name === 'text' || node.name === 'tspan')
  if (!textNodes.length || textNodes.some((node) => !node.text.trim())) failValidation('SVG_TEXT_INVALID')

  const idMap = new Map()
  nodes.forEach((node) => {
    const id = attrValue(node, 'id')
    if (id === undefined) return
    if (!ID_PATTERN.test(id)) failValidation('SVG_ID_INVALID')
    if (idMap.has(id)) failValidation('SVG_ID_DUPLICATE')
    idMap.set(id, node)
  })
  nodes.forEach((node) => {
    const labelledBy = attrValue(node, 'aria-labelledby')
    if (!labelledBy) return
    const targets = labelledBy.split(/\s+/)
    if (new Set(targets).size !== targets.length || targets.some((target) => !idMap.has(target))) failValidation('SVG_ARIA_REFERENCE_INVALID')
  })

  const groups = nodes.filter((node) => node.name === 'g')
  const directGroups = root.children.slice(2)
  if (groups.length !== REQUIRED_GROUPS.length
    || directGroups.length !== REQUIRED_GROUPS.length
    || directGroups.some((group, index) => group !== groups[index] || group.name !== 'g' || attrValue(group, 'id') !== REQUIRED_GROUPS[index])) {
    failValidation('SVG_GROUP_INVENTORY_INVALID')
  }
  groups.forEach((group) => {
    const id = attrValue(group, 'id')
    const labelId = `${id}-label`
    const descendants = allNodes(group)
    if (attrValue(group, 'role') !== 'group'
      || attrValue(group, 'aria-labelledby') !== labelId
      || !descendants.some((node) => node.name === 'text' && attrValue(node, 'id') === labelId && node.text.trim())
      || !descendants.some((node) => node.name === 'rect' && attrValue(node, 'id') === `${id}-background` && attrValue(node, 'fill') === GROUP_BACKGROUNDS[id])) {
      failValidation('SVG_GROUP_INVENTORY_INVALID')
    }
  })

  textNodes.forEach((node) => {
    if (attrValue(node, 'aria-hidden') !== undefined) failValidation('SVG_ACCESSIBILITY_TEXT_HIDDEN')
    const size = attrValue(node, 'font-size')
    const weight = attrValue(node, 'font-weight')
    const family = node.name === 'text' ? attrValue(node, 'font-family') : undefined
    if (node.name === 'text' && family !== FONT_FAMILY) failValidation('SVG_FONT_INVALID')
    if (!FONT_SIZES.has(size) || !FONT_WEIGHTS.has(weight)) failValidation('SVG_FONT_INVALID')
    if (size === '18' && !/(?:-label$|risk-\d+-score$|scenario-marker$|footer-(?:label|disclosure|version)$)/.test(attrValue(node, 'id') || '')) {
      failValidation('SVG_FONT_SIZE_INVALID')
    }
    const group = findAncestorGroup(node)
    const background = group ? GROUP_BACKGROUNDS[attrValue(group, 'id')] : null
    const fill = attrValue(node, 'fill')
    if (!background || !fill || !PALETTE.has(fill)) failValidation('SVG_CONTRAST_INVALID')
    const ratio = contrastRatio(fill, background)
    const large = Number(size) >= 31 || (Number(size) >= 24 && weight === '700')
    if (ratio < (large ? 3 : 4.5)) failValidation('SVG_CONTRAST_INVALID')
  })

  const visibleText = textNodes.map((node) => node.text).join(' ').normalize('NFKC').replace(/\s+/g, ' ').trim()
  const visibleWords = countWords(visibleText)
  if (visibleWords < PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.minVisibleWords
    || visibleWords > PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.limits.maxVisibleWords) failLimit('SVG_WORD_LIMIT_EXCEEDED', { wordCount: visibleWords })
  if (visibleText.split(DISCLOSURE).length !== 2) failValidation('SVG_DISCLOSURE_MISSING')
  const violation = findOutcomeCustomerLanguageViolation({
    title: root.children[0].text,
    description: root.children[1].text,
    visibleText,
  }, { path: 'svg' })
  if (violation) failUnsafe('SVG_CUSTOMER_LANGUAGE_UNSAFE', { termKey: violation.termKey || violation.code })

  return Object.freeze({
    status: 'PASSED',
    width: WIDTH,
    height: HEIGHT,
    elementCount: nodes.length,
    textNodeCount: textNodes.length,
    groupCount: groups.length,
    visibleWordCount: visibleWords,
    titlePresent: true,
    descriptionPresent: true,
    disclosurePresent: true,
    minimumContrastRatio: Number(Math.min(...textNodes.map((node) => {
      const group = findAncestorGroup(node)
      return contrastRatio(attrValue(node, 'fill'), GROUP_BACKGROUNDS[attrValue(group, 'id')])
    })).toFixed(4)),
    contentIncludedInValidation: false,
  })
}

export const validateProfessionalInfographicSvgCandidate = (value) => {
  try {
    return validateSvgInternal(value)
  } catch (error) {
    if (error?.name === 'ProfessionalInfographicSvgCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'SVG_XML_INVALID',
    })
  }
}

export const renderProfessionalInfographicSvgCandidate = (input) => {
  try {
    const parsed = parseProfessionalInfographicCandidateInput(input)
    const compiled = compileParsedInfographic(parsed)
    const buffer = Buffer.from(compiled.svg, 'utf8')
    const validation = validateSvgInternal(buffer)
    return Object.freeze({
      buffer,
      profile: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE,
      validation,
      metrics: Object.freeze({
        outputBytes: buffer.length,
        width: WIDTH,
        height: HEIGHT,
        textNodeCount: compiled.textNodeCount,
        visibleWordCount: validation.visibleWordCount,
        contentIncludedInMetrics: false,
      }),
    })
  } catch (error) {
    if (error?.name === 'ProfessionalInfographicSvgCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'SVG_RENDER_FAILED',
    })
  }
}

export const __testables = Object.freeze({
  ALLOWED_ATTRIBUTES,
  DISCLOSURE,
  GROUP_BACKGROUNDS,
  PALETTE,
  REQUIRED_GROUPS,
  XML_DECLARATION,
  compileParsedInfographic,
  contrastRatio,
  countWords,
  escapeXml,
  parseSvg,
  validateSvgInternal,
})
