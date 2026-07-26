import { createRequire } from 'node:module'
import { posix as pathPosix } from 'node:path'
import JSZip from 'jszip'
import { findOutcomeCustomerLanguageViolation } from './outcomeCustomerLanguageService.js'

const require = createRequire(import.meta.url)
const PptxGenJS = require('pptxgenjs')
const { SaxesParser } = require('saxes')

export const PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-presentation-pptx-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-006-v1.1-NOT-APPROVED',
  templateProfile: 'executive-presentation-neutral.v0.1',
  engine: Object.freeze({
    key: 'PPTXGENJS_IN_PROCESS_ENGINEERING_CANDIDATE',
    version: 'pptxgenjs@4.0.1',
    loadingPosture: 'NODE18_COMMONJS_VIA_CREATE_REQUIRE',
  }),
  limits: Object.freeze({
    maxSourceBytes: 262_144,
    maxSlides: 24,
    maxTitleBytes: 256,
    maxShortTextBytes: 512,
    maxItemTextBytes: 1_024,
    maxSlideVisibleBytes: 2_000,
    maxNotesBytes: 4_096,
    minNotesWords: 40,
    maxNotesWords: 220,
    maxCharts: 8,
    maxChartCategories: 8,
    maxChartSeries: 3,
    maxChartPoints: 24,
    maxChartAbsoluteValue: 1_000_000_000,
    maxOutputBytes: 25_165_824,
    maxExpandedBytes: 50_331_648,
    maxPackageEntries: 350,
    maxEmbeddedWorkbooks: 8,
    maxEmbeddedWorkbookBytes: 2_097_152,
    maxCombinedWorkbookBytes: 10_485_760,
    maxWorkbookEntries: 80,
    maxWorkbookExpandedBytes: 8_388_608,
    renderTargetMs: 10_000,
  }),
})

export const PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_PRESENTATION_CANDIDATE_INPUT_INVALID',
  INPUT_UNSAFE: 'PROFESSIONAL_PRESENTATION_CANDIDATE_INPUT_UNSAFE',
  LIMIT_EXCEEDED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_VALIDATION_FAILED',
})

const FIXED_PACKAGE_DATE = new Date('2000-01-01T00:00:00.000Z')
const WIDE_SLIDE_CX = 12_192_000
const WIDE_SLIDE_CY = 6_858_000
const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5
const FONT_FACE = 'Arial'
const COLORS = Object.freeze({
  navy: '173B5E',
  darkNavy: '071C33',
  blue: '2C7DB9',
  teal: '2A927F',
  orange: 'E47735',
  red: 'C44D4D',
  ink: '24364A',
  muted: '66788A',
  border: 'D6DEE6',
  paleBlue: 'EAF3F9',
  paleTeal: 'E8F4F1',
  paleOrange: 'FBEEE7',
  paleGray: 'F3F6F8',
  background: 'F8FAFB',
  white: 'FFFFFF',
})

const LAYOUTS = Object.freeze([
  'COVER',
  'DECISION',
  'METRICS',
  'CHART',
  'PROCESS',
  'RISK',
  'SCORECARD',
  'CONDITIONS',
  'CLOSING',
])

const PPTX_FIXED_PACKAGE_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/',
  '_rels/.rels',
  'docProps/',
  'docProps/app.xml',
  'docProps/core.xml',
  'ppt/',
  'ppt/_rels/',
  'ppt/_rels/presentation.xml.rels',
  'ppt/charts/',
  'ppt/charts/_rels/',
  'ppt/embeddings/',
  'ppt/media/',
  'ppt/notesMasters/',
  'ppt/notesMasters/_rels/',
  'ppt/notesMasters/_rels/notesMaster1.xml.rels',
  'ppt/notesMasters/notesMaster1.xml',
  'ppt/notesSlides/',
  'ppt/notesSlides/_rels/',
  'ppt/presProps.xml',
  'ppt/presentation.xml',
  'ppt/slideLayouts/',
  'ppt/slideLayouts/_rels/',
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
  'ppt/slideLayouts/slideLayout1.xml',
  'ppt/slideMasters/',
  'ppt/slideMasters/_rels/',
  'ppt/slideMasters/_rels/slideMaster1.xml.rels',
  'ppt/slideMasters/slideMaster1.xml',
  'ppt/slides/',
  'ppt/slides/_rels/',
  'ppt/tableStyles.xml',
  'ppt/theme/',
  'ppt/theme/theme1.xml',
  'ppt/viewProps.xml',
])

const WORKBOOK_PACKAGE_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/',
  '_rels/.rels',
  'docProps/',
  'docProps/app.xml',
  'docProps/core.xml',
  'xl/',
  'xl/_rels/',
  'xl/_rels/workbook.xml.rels',
  'xl/sharedStrings.xml',
  'xl/styles.xml',
  'xl/tables/',
  'xl/tables/table1.xml',
  'xl/theme/',
  'xl/theme/theme1.xml',
  'xl/workbook.xml',
  'xl/worksheets/',
  'xl/worksheets/_rels/',
  'xl/worksheets/_rels/sheet1.xml.rels',
  'xl/worksheets/sheet1.xml',
])

const RELATIONSHIP_TYPES = Object.freeze({
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  package: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
})

const TONES = Object.freeze(['PRIMARY', 'POSITIVE', 'CAUTION', 'NEUTRAL'])

const toneColor = (tone) => ({
  PRIMARY: COLORS.blue,
  POSITIVE: COLORS.teal,
  CAUTION: COLORS.orange,
  NEUTRAL: COLORS.muted,
})[tone] || COLORS.muted

const normalizeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()
const utf8Length = (value) => Buffer.byteLength(String(value ?? ''), 'utf8')
const wordCount = (value) => normalizeText(value).split(/\s+/).filter(Boolean).length

const createCandidateError = ({ code, reason, details = {} }) => {
  const error = new Error('The professional presentation engineering candidate could not complete this render.')
  error.name = 'ProfessionalPresentationCandidateError'
  error.code = code
  error.reason = reason
  error.details = {
    reason,
    contentIncludedInError: false,
    ...details,
  }
  return error
}

const failInput = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES.INPUT_INVALID,
    reason,
    details,
  })
}

const failUnsafe = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES.INPUT_UNSAFE,
    reason,
    details,
  })
}

const failLimit = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
    reason,
    details,
  })
}

const failValidation = (reason, details = {}) => {
  throw createCandidateError({
    code: PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
    reason,
    details,
  })
}

const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
)

const assertPlainObject = (value, path) => {
  if (!isPlainObject(value)) failInput('PRESENTATION_OBJECT_INVALID', { path })
}

const assertExactKeys = (value, allowedKeys, requiredKeys, path) => {
  assertPlainObject(value, path)
  const allowed = new Set(allowedKeys)
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported) failInput('PRESENTATION_FIELD_UNSUPPORTED', { path: `${path}.${unsupported}` })
  const missing = requiredKeys.find((key) => !Object.prototype.hasOwnProperty.call(value, key))
  if (missing) failInput('PRESENTATION_FIELD_REQUIRED', { path: `${path}.${missing}` })
}

const decodeSecurityText = (value) => {
  let decoded = String(value ?? '').normalize('NFKC')
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const htmlDecoded = decoded
      .replace(/&#(\d+);?/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);?/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&colon;?/gi, ':')
      .replace(/&sol;?/gi, '/')
      .replace(/&bsol;?/gi, '\\')
    let percentDecoded = htmlDecoded
    try {
      percentDecoded = decodeURIComponent(htmlDecoded)
    } catch {
      percentDecoded = htmlDecoded.replace(/%([0-9a-f]{2})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    }
    if (percentDecoded === decoded) break
    decoded = percentDecoded
  }
  return decoded.toLowerCase().replace(/\s+/g, '')
}

const assertSafeString = (value, path) => {
  const source = String(value ?? '')
  const decoded = decodeSecurityText(source)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) {
    failUnsafe('CONTROL_CHARACTER_NOT_ALLOWED', { path })
  }
  if (/<\/?[a-z][^>]*>/i.test(source) || /<\/?[a-z][^>]*>/i.test(decoded)) {
    failUnsafe('RAW_HTML_NOT_ALLOWED', { path })
  }
  if (/(?:https?|ftp|file|data|javascript|vbscript|mailto|tel|sms|cid|blob|about):/.test(decoded)) {
    failUnsafe('URI_SCHEME_NOT_ALLOWED', { path })
  }
  if (/!?\[[^\]]*\]\([^)]+\)/.test(source)) failUnsafe('MARKDOWN_LINK_NOT_ALLOWED', { path })
  if (/\\\\/.test(source) || /^[a-z]:[\\/]/i.test(source.trim())) {
    failUnsafe('FILE_PATH_NOT_ALLOWED', { path })
  }
}

const boundedString = (value, {
  path,
  maxBytes = PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxItemTextBytes,
  allowEmpty = false,
} = {}) => {
  if (typeof value !== 'string') failInput('PRESENTATION_STRING_INVALID', { path })
  const normalized = normalizeText(value)
  if (!allowEmpty && !normalized) failInput('PRESENTATION_STRING_REQUIRED', { path })
  if (utf8Length(normalized) > maxBytes) failLimit('PRESENTATION_STRING_LIMIT_EXCEEDED', { path, maxBytes })
  assertSafeString(normalized, path)
  return normalized
}

const boundedArray = (value, { path, min = 0, max }) => {
  if (!Array.isArray(value)) failInput('PRESENTATION_ARRAY_INVALID', { path })
  if (value.length < min || value.length > max) {
    failLimit('PRESENTATION_ARRAY_LIMIT_EXCEEDED', { path, min, max })
  }
  return value
}

const normalizeMetric = (value, path) => {
  assertExactKeys(value, ['label', 'value', 'detail', 'tone'], ['label', 'value', 'detail', 'tone'], path)
  const tone = boundedString(value.tone, { path: `${path}.tone`, maxBytes: 32 }).toUpperCase()
  if (!TONES.includes(tone)) failInput('PRESENTATION_TONE_UNSUPPORTED', { path: `${path}.tone` })
  return Object.freeze({
    label: boundedString(value.label, { path: `${path}.label`, maxBytes: 256 }),
    value: boundedString(value.value, { path: `${path}.value`, maxBytes: 256 }),
    detail: boundedString(value.detail, { path: `${path}.detail`, maxBytes: 512, allowEmpty: true }),
    tone,
  })
}

const normalizeStep = (value, path) => {
  assertExactKeys(value, ['label', 'detail', 'period'], ['label', 'detail', 'period'], path)
  return Object.freeze({
    label: boundedString(value.label, { path: `${path}.label`, maxBytes: 256 }),
    detail: boundedString(value.detail, { path: `${path}.detail`, maxBytes: 512 }),
    period: boundedString(value.period, { path: `${path}.period`, maxBytes: 128, allowEmpty: true }),
  })
}

const normalizeCondition = (value, path) => {
  assertExactKeys(value, ['label', 'detail'], ['label', 'detail'], path)
  return Object.freeze({
    label: boundedString(value.label, { path: `${path}.label`, maxBytes: 256 }),
    detail: boundedString(value.detail, { path: `${path}.detail`, maxBytes: 512, allowEmpty: true }),
  })
}

const normalizeChart = (content, path) => {
  assertExactKeys(
    content,
    ['chartType', 'categories', 'series', 'callouts', 'qualifier'],
    ['chartType', 'categories', 'series', 'callouts', 'qualifier'],
    path,
  )
  const chartType = boundedString(content.chartType, { path: `${path}.chartType`, maxBytes: 32 }).toUpperCase()
  if (!['BAR', 'COLUMN'].includes(chartType)) failInput('PRESENTATION_CHART_TYPE_UNSUPPORTED', { path: `${path}.chartType` })
  const categories = boundedArray(content.categories, {
    path: `${path}.categories`,
    min: 1,
    max: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxChartCategories,
  }).map((entry, index) => boundedString(entry, { path: `${path}.categories[${index}]`, maxBytes: 128 }))
  const series = boundedArray(content.series, {
    path: `${path}.series`,
    min: 1,
    max: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxChartSeries,
  }).map((entry, index) => {
    const seriesPath = `${path}.series[${index}]`
    assertExactKeys(entry, ['name', 'values'], ['name', 'values'], seriesPath)
    const values = boundedArray(entry.values, {
      path: `${seriesPath}.values`,
      min: categories.length,
      max: categories.length,
    }).map((number, pointIndex) => {
      if (!Number.isFinite(number) || Math.abs(number) > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxChartAbsoluteValue) {
        failLimit('PRESENTATION_CHART_VALUE_INVALID', { path: `${seriesPath}.values[${pointIndex}]` })
      }
      return number
    })
    return Object.freeze({
      name: boundedString(entry.name, { path: `${seriesPath}.name`, maxBytes: 128 }),
      values: Object.freeze(values),
    })
  })
  const pointCount = categories.length * series.length
  if (pointCount > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxChartPoints) {
    failLimit('PRESENTATION_CHART_POINT_LIMIT_EXCEEDED', {
      path,
      maxPoints: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxChartPoints,
    })
  }
  const callouts = boundedArray(content.callouts, { path: `${path}.callouts`, min: 0, max: 3 })
    .map((entry, index) => normalizeMetric(entry, `${path}.callouts[${index}]`))
  return Object.freeze({
    chartType,
    categories: Object.freeze(categories),
    series: Object.freeze(series),
    callouts: Object.freeze(callouts),
    qualifier: boundedString(content.qualifier, { path: `${path}.qualifier`, maxBytes: 512, allowEmpty: true }),
  })
}

const normalizeContent = (layout, content, path) => {
  assertPlainObject(content, path)
  if (layout === 'COVER') {
    assertExactKeys(content, ['eyebrow', 'subtitle', 'audience'], ['eyebrow', 'subtitle', 'audience'], path)
    return Object.freeze({
      eyebrow: boundedString(content.eyebrow, { path: `${path}.eyebrow`, maxBytes: 128 }),
      subtitle: boundedString(content.subtitle, { path: `${path}.subtitle`, maxBytes: 512 }),
      audience: boundedString(content.audience, { path: `${path}.audience`, maxBytes: 256 }),
    })
  }
  if (layout === 'DECISION') {
    assertExactKeys(content, ['statement', 'metrics', 'qualifier'], ['statement', 'metrics', 'qualifier'], path)
    return Object.freeze({
      statement: boundedString(content.statement, { path: `${path}.statement`, maxBytes: 512 }),
      metrics: Object.freeze(boundedArray(content.metrics, { path: `${path}.metrics`, min: 1, max: 4 })
        .map((entry, index) => normalizeMetric(entry, `${path}.metrics[${index}]`))),
      qualifier: boundedString(content.qualifier, { path: `${path}.qualifier`, maxBytes: 512 }),
    })
  }
  if (layout === 'METRICS') {
    assertExactKeys(content, ['steps', 'result', 'indicators'], ['steps', 'result', 'indicators'], path)
    return Object.freeze({
      steps: Object.freeze(boundedArray(content.steps, { path: `${path}.steps`, min: 2, max: 4 })
        .map((entry, index) => normalizeMetric(entry, `${path}.steps[${index}]`))),
      result: normalizeMetric(content.result, `${path}.result`),
      indicators: Object.freeze(boundedArray(content.indicators, { path: `${path}.indicators`, min: 0, max: 3 })
        .map((entry, index) => normalizeMetric(entry, `${path}.indicators[${index}]`))),
    })
  }
  if (layout === 'CHART') return normalizeChart(content, path)
  if (layout === 'PROCESS') {
    assertExactKeys(content, ['steps', 'outcome'], ['steps', 'outcome'], path)
    return Object.freeze({
      steps: Object.freeze(boundedArray(content.steps, { path: `${path}.steps`, min: 3, max: 6 })
        .map((entry, index) => normalizeStep(entry, `${path}.steps[${index}]`))),
      outcome: boundedString(content.outcome, { path: `${path}.outcome`, maxBytes: 512 }),
    })
  }
  if (layout === 'RISK') {
    assertExactKeys(content, ['risks', 'secondary'], ['risks', 'secondary'], path)
    const risks = boundedArray(content.risks, { path: `${path}.risks`, min: 1, max: 10 }).map((entry, index) => {
      const riskPath = `${path}.risks[${index}]`
      assertExactKeys(entry, ['label', 'probability', 'impact', 'score', 'owner'], ['label', 'probability', 'impact', 'score', 'owner'], riskPath)
      const { probability, impact, score } = entry
      if (![probability, impact, score].every(Number.isSafeInteger)
        || probability < 1 || probability > 5
        || impact < 1 || impact > 5
        || score !== probability * impact) {
        failInput('PRESENTATION_RISK_SCORE_INVALID', { path: riskPath })
      }
      return Object.freeze({
        label: boundedString(entry.label, { path: `${riskPath}.label`, maxBytes: 256 }),
        probability,
        impact,
        score,
        owner: boundedString(entry.owner, { path: `${riskPath}.owner`, maxBytes: 256 }),
      })
    })
    return Object.freeze({
      risks: Object.freeze(risks),
      secondary: boundedString(content.secondary, { path: `${path}.secondary`, maxBytes: 512, allowEmpty: true }),
    })
  }
  if (layout === 'SCORECARD') {
    assertExactKeys(content, ['rows'], ['rows'], path)
    const rows = boundedArray(content.rows, { path: `${path}.rows`, min: 2, max: 8 }).map((entry, index) => {
      const rowPath = `${path}.rows[${index}]`
      assertExactKeys(entry, ['measure', 'baseline', 'target', 'owner'], ['measure', 'baseline', 'target', 'owner'], rowPath)
      return Object.freeze({
        measure: boundedString(entry.measure, { path: `${rowPath}.measure`, maxBytes: 256 }),
        baseline: boundedString(entry.baseline, { path: `${rowPath}.baseline`, maxBytes: 128 }),
        target: boundedString(entry.target, { path: `${rowPath}.target`, maxBytes: 128 }),
        owner: boundedString(entry.owner, { path: `${rowPath}.owner`, maxBytes: 256 }),
      })
    })
    return Object.freeze({ rows: Object.freeze(rows) })
  }
  if (layout === 'CONDITIONS') {
    assertExactKeys(content, ['conditions', 'continueRule', 'pauseRule'], ['conditions', 'continueRule', 'pauseRule'], path)
    return Object.freeze({
      conditions: Object.freeze(boundedArray(content.conditions, { path: `${path}.conditions`, min: 2, max: 8 })
        .map((entry, index) => normalizeCondition(entry, `${path}.conditions[${index}]`))),
      continueRule: boundedString(content.continueRule, { path: `${path}.continueRule`, maxBytes: 512 }),
      pauseRule: boundedString(content.pauseRule, { path: `${path}.pauseRule`, maxBytes: 512 }),
    })
  }
  if (layout === 'CLOSING') {
    assertExactKeys(content, ['statement', 'subtitle', 'steps'], ['statement', 'subtitle', 'steps'], path)
    return Object.freeze({
      statement: boundedString(content.statement, { path: `${path}.statement`, maxBytes: 512 }),
      subtitle: boundedString(content.subtitle, { path: `${path}.subtitle`, maxBytes: 512 }),
      steps: Object.freeze(boundedArray(content.steps, { path: `${path}.steps`, min: 2, max: 6 })
        .map((entry, index) => normalizeCondition(entry, `${path}.steps[${index}]`))),
    })
  }
  failInput('PRESENTATION_LAYOUT_UNSUPPORTED', { path })
}

const visibleByteCount = (slide) => {
  const visit = (value) => {
    if (typeof value === 'string') return utf8Length(value)
    if (Array.isArray(value)) return value.reduce((total, entry) => total + visit(entry), 0)
    if (isPlainObject(value)) return Object.values(value).reduce((total, entry) => total + visit(entry), 0)
    return 0
  }
  return utf8Length(slide.title) + visit(slide.content)
}

export const parseProfessionalPresentationCandidateInput = (input = {}) => {
  let serialized
  try {
    serialized = JSON.stringify(input)
  } catch {
    failInput('PRESENTATION_SERIALIZATION_INVALID')
  }
  if (!serialized || utf8Length(serialized) > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSourceBytes) {
    failLimit('PRESENTATION_SOURCE_LIMIT_EXCEEDED', {
      maxSourceBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSourceBytes,
    })
  }
  assertExactKeys(input, ['schemaVersion', 'deliverableFamily', 'metadata', 'slides'], ['schemaVersion', 'deliverableFamily', 'metadata', 'slides'], 'presentation')
  if (input.schemaVersion !== 'governed-deliverable.v1') failInput('PRESENTATION_SCHEMA_VERSION_UNSUPPORTED')
  if (input.deliverableFamily !== 'PRESENTATION') failInput('PRESENTATION_FAMILY_UNSUPPORTED')

  assertExactKeys(
    input.metadata,
    ['title', 'subtitle', 'audience', 'status', 'versionNumber', 'disclosure'],
    ['title', 'audience', 'status', 'versionNumber', 'disclosure'],
    'presentation.metadata',
  )
  const status = boundedString(input.metadata.status, { path: 'presentation.metadata.status', maxBytes: 32 }).toUpperCase()
  if (!['DRAFT', 'APPROVED'].includes(status)) failInput('PRESENTATION_STATUS_UNSUPPORTED')
  if (!Number.isSafeInteger(input.metadata.versionNumber)
    || input.metadata.versionNumber < 1
    || input.metadata.versionNumber > 9_999) {
    failInput('PRESENTATION_VERSION_INVALID')
  }
  const metadata = Object.freeze({
    title: boundedString(input.metadata.title, { path: 'presentation.metadata.title', maxBytes: 256 }),
    subtitle: Object.prototype.hasOwnProperty.call(input.metadata, 'subtitle')
      ? boundedString(input.metadata.subtitle, { path: 'presentation.metadata.subtitle', maxBytes: 512, allowEmpty: true })
      : '',
    audience: boundedString(input.metadata.audience, { path: 'presentation.metadata.audience', maxBytes: 256 }),
    status,
    versionNumber: input.metadata.versionNumber,
    disclosure: boundedString(input.metadata.disclosure, { path: 'presentation.metadata.disclosure', maxBytes: 512 }),
  })

  let chartCount = 0
  const slides = boundedArray(input.slides, {
    path: 'presentation.slides',
    min: 1,
    max: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlides,
  }).map((entry, index) => {
    const path = `presentation.slides[${index}]`
    assertExactKeys(entry, ['layout', 'title', 'notes', 'content'], ['layout', 'title', 'notes', 'content'], path)
    const layout = boundedString(entry.layout, { path: `${path}.layout`, maxBytes: 32 }).toUpperCase()
    if (!LAYOUTS.includes(layout)) failInput('PRESENTATION_LAYOUT_UNSUPPORTED', { path: `${path}.layout` })
    const notes = boundedString(entry.notes, {
      path: `${path}.notes`,
      maxBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxNotesBytes,
    })
    const notesWords = wordCount(notes)
    if (notesWords < PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.minNotesWords
      || notesWords > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxNotesWords) {
      failLimit('PRESENTATION_NOTES_WORD_LIMIT_EXCEEDED', {
        path: `${path}.notes`,
        minWords: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.minNotesWords,
        maxWords: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxNotesWords,
      })
    }
    const slide = Object.freeze({
      layout,
      title: boundedString(entry.title, { path: `${path}.title`, maxBytes: 256 }),
      notes,
      content: normalizeContent(layout, entry.content, `${path}.content`),
    })
    if (visibleByteCount(slide) > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlideVisibleBytes) {
      failLimit('PRESENTATION_SLIDE_VISIBLE_CONTENT_LIMIT_EXCEEDED', {
        path,
        maxBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlideVisibleBytes,
      })
    }
    if (layout === 'CHART') chartCount += 1
    return slide
  })

  if (chartCount > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxCharts) {
    failLimit('PRESENTATION_CHART_LIMIT_EXCEEDED', {
      maxCharts: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxCharts,
    })
  }

  const normalized = Object.freeze({
    schemaVersion: 'governed-deliverable.v1',
    deliverableFamily: 'PRESENTATION',
    metadata,
    slides: Object.freeze(slides),
  })
  const languageViolation = findOutcomeCustomerLanguageViolation(normalized, {
    path: 'presentation',
    maxDepth: 12,
    maxEntries: 2_000,
    maxStringLength: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxNotesBytes,
    maxTotalCharacters: 200_000,
  })
  if (languageViolation) {
    failUnsafe('CUSTOMER_LANGUAGE_CONTRACT_FAILED', {
      path: languageViolation.path,
      termKey: languageViolation.termKey || '',
    })
  }
  return Object.freeze({ presentation: normalized, chartCount })
}

const addText = (slide, text, options = {}) => slide.addText(text, {
  fontFace: FONT_FACE,
  color: COLORS.ink,
  margin: 0,
  breakLine: false,
  fit: 'shrink',
  valign: 'mid',
  ...options,
})

const addCommonFrame = (slide, { title, disclosure, slideNumber }) => {
  addText(slide, title, {
    x: 0.58,
    y: 0.26,
    w: 12.15,
    h: 0.62,
    fontSize: 23,
    bold: true,
    color: COLORS.navy,
  })
  slide.addShape('line', {
    x: 0.58,
    y: 1.02,
    w: 12.15,
    h: 0,
    line: { color: COLORS.border, width: 1 },
  })
  addText(slide, disclosure, {
    x: 0.58,
    y: 7.19,
    w: 10.8,
    h: 0.14,
    fontSize: 6.5,
    color: COLORS.muted,
  })
  addText(slide, String(slideNumber), {
    x: 12.15,
    y: 7.18,
    w: 0.5,
    h: 0.15,
    fontSize: 7,
    align: 'right',
    color: COLORS.muted,
  })
}

const addMetricCard = (slide, metric, { x, y, w, h, dark = false }) => {
  const accent = toneColor(metric.tone)
  slide.addShape('rect', {
    x,
    y,
    w,
    h,
    line: { color: dark ? COLORS.navy : COLORS.border, width: 0.8 },
    fill: { color: dark ? COLORS.navy : COLORS.white },
    radius: 0.04,
  })
  slide.addShape('line', {
    x: x + 0.16,
    y: y + 0.17,
    w: 0,
    h: Math.max(0.22, h - 0.34),
    line: { color: accent, width: 3 },
  })
  addText(slide, metric.label.toUpperCase(), {
    x: x + 0.34,
    y: y + 0.12,
    w: w - 0.48,
    h: 0.18,
    fontSize: 7.5,
    bold: true,
    color: dark ? COLORS.paleBlue : COLORS.muted,
  })
  addText(slide, metric.value, {
    x: x + 0.34,
    y: y + 0.34,
    w: w - 0.48,
    h: Math.max(0.3, h * 0.35),
    fontSize: h >= 1.2 ? 20 : 16,
    bold: true,
    color: dark ? COLORS.white : COLORS.navy,
  })
  if (metric.detail) {
    addText(slide, metric.detail, {
      x: x + 0.34,
      y: y + h - 0.38,
      w: w - 0.48,
      h: 0.25,
      fontSize: 7,
      color: dark ? COLORS.paleBlue : COLORS.muted,
      valign: 'top',
    })
  }
}

const renderCover = (slide, presentation, sourceSlide, slideNumber) => {
  slide.background = { color: COLORS.darkNavy }
  const { metadata } = presentation
  const { content } = sourceSlide
  addText(slide, content.eyebrow.toUpperCase(), {
    x: 0.78,
    y: 0.58,
    w: 5.8,
    h: 0.22,
    fontSize: 8,
    bold: true,
    color: '61C7C0',
  })
  addText(slide, sourceSlide.title, {
    x: 0.78,
    y: 1.35,
    w: 6.25,
    h: 2.25,
    fontSize: 34,
    bold: true,
    color: COLORS.white,
    valign: 'top',
  })
  addText(slide, content.subtitle, {
    x: 0.78,
    y: 3.83,
    w: 5.9,
    h: 0.7,
    fontSize: 15,
    color: 'C9D8E6',
    valign: 'top',
  })
  addText(slide, content.audience, {
    x: 0.78,
    y: 4.75,
    w: 5.4,
    h: 0.35,
    fontSize: 10,
    color: 'AFC4D6',
  })

  const columns = [7.6, 8.55, 9.5, 10.45, 11.4]
  columns.forEach((x, index) => {
    const height = 2.2 + index * 0.42
    slide.addShape('rect', {
      x,
      y: 5.85 - height,
      w: 0.64,
      h: height,
      line: { color: index === 3 ? COLORS.orange : COLORS.blue, transparency: 55 },
      fill: { color: index === 3 ? COLORS.orange : COLORS.blue, transparency: 75 },
      rotate: 36,
    })
  })
  slide.addShape('line', {
    x: 7.0,
    y: 5.58,
    w: 5.5,
    h: -3.55,
    line: { color: COLORS.teal, transparency: 25, width: 1.5 },
  })
  slide.addShape('ellipse', {
    x: 10.25,
    y: 3.31,
    w: 0.18,
    h: 0.18,
    line: { color: COLORS.orange, transparency: 0 },
    fill: { color: COLORS.orange, transparency: 0 },
  })
  addText(slide, `${metadata.status} | Version ${metadata.versionNumber} | Engineering candidate`, {
    x: 0.78,
    y: 6.86,
    w: 8.8,
    h: 0.16,
    fontSize: 6.5,
    color: '7892A8',
  })
  addText(slide, String(slideNumber), {
    x: 12.15,
    y: 6.86,
    w: 0.45,
    h: 0.16,
    fontSize: 7,
    color: '7892A8',
    align: 'right',
  })
}

const renderDecision = (slide, sourceSlide) => {
  const { content } = sourceSlide
  slide.addShape('rect', {
    x: 0.62,
    y: 1.3,
    w: 8.2,
    h: 1.45,
    line: { color: COLORS.navy, transparency: 100 },
    fill: { color: COLORS.navy },
  })
  addText(slide, 'DECISION', {
    x: 0.9,
    y: 1.55,
    w: 1.4,
    h: 0.18,
    fontSize: 7.5,
    bold: true,
    color: '8FD4CD',
  })
  addText(slide, content.statement, {
    x: 0.9,
    y: 1.84,
    w: 7.55,
    h: 0.62,
    fontSize: 17,
    bold: true,
    color: COLORS.white,
    valign: 'top',
  })
  const cardH = Math.min(1.15, 4.25 / content.metrics.length)
  content.metrics.forEach((metric, index) => addMetricCard(slide, metric, {
    x: 9.18,
    y: 1.3 + index * (cardH + 0.18),
    w: 3.48,
    h: cardH,
  }))
  slide.addShape('rect', {
    x: 0.62,
    y: 3.18,
    w: 8.2,
    h: 1.13,
    line: { color: 'F1D6C6', width: 0.8 },
    fill: { color: COLORS.paleOrange },
  })
  addText(slide, 'PRINCIPAL EXPOSURE', {
    x: 0.92,
    y: 3.46,
    w: 1.9,
    h: 0.18,
    fontSize: 8,
    bold: true,
    color: COLORS.orange,
  })
  addText(slide, content.qualifier, {
    x: 0.92,
    y: 3.73,
    w: 7.45,
    h: 0.35,
    fontSize: 10,
    color: COLORS.ink,
  })
}

const renderMetrics = (slide, sourceSlide) => {
  const { content } = sourceSlide
  const stepWidth = 1.65
  const startX = 0.72
  content.steps.forEach((metric, index) => {
    const x = startX + index * 2.17
    addMetricCard(slide, metric, { x, y: 1.45, w: stepWidth, h: 1.15 })
    if (index < content.steps.length - 1) {
      slide.addShape('line', {
        x: x + stepWidth,
        y: 2.0,
        w: 0.48,
        h: 0,
        line: { color: COLORS.blue, width: 1.4, beginArrowType: 'none', endArrowType: 'triangle' },
      })
    }
  })
  addMetricCard(slide, content.result, { x: 9.35, y: 1.38, w: 3.25, h: 1.34, dark: true })
  content.indicators.forEach((metric, index) => addMetricCard(slide, metric, {
    x: 0.72 + index * 4.03,
    y: 3.35,
    w: 3.7,
    h: 1.25,
  }))
}

const renderChart = (slide, pptx, sourceSlide) => {
  const { content } = sourceSlide
  const type = content.chartType === 'BAR' ? pptx.ChartType.bar : pptx.ChartType.bar
  const data = content.series.map((series) => ({
    name: series.name,
    labels: [...content.categories],
    values: [...series.values],
  }))
  slide.addChart(type, data, {
    x: 0.7,
    y: 1.28,
    w: 8.15,
    h: 4.95,
    catAxisLabelFontFace: FONT_FACE,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: COLORS.muted,
    catAxisLineShow: false,
    valAxisLabelFontFace: FONT_FACE,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: COLORS.muted,
    valAxisLineShow: false,
    valGridLine: { color: 'DDE4EA', width: 1 },
    chartColors: [COLORS.blue, COLORS.teal, COLORS.orange],
    showLegend: content.series.length > 1,
    legendFontFace: FONT_FACE,
    legendFontSize: 9,
    legendPos: 'b',
    showTitle: false,
    barDir: content.chartType === 'BAR' ? 'bar' : 'col',
    showValue: true,
    showCatName: false,
    showSerName: false,
    dataLabelColor: COLORS.ink,
    dataLabelPosition: content.chartType === 'BAR' ? 'outEnd' : 'outEnd',
    dataLabelFormatCode: '0;[Red](0)',
    showBorder: false,
    showValueAsLabel: true,
  })
  content.callouts.forEach((metric, index) => addMetricCard(slide, metric, {
    x: 9.25,
    y: 1.34 + index * 1.45,
    w: 3.35,
    h: 1.2,
  }))
  if (content.qualifier) {
    slide.addShape('rect', {
      x: 9.25,
      y: 5.66,
      w: 3.35,
      h: 0.68,
      line: { color: 'F2D6C6', width: 0.8 },
      fill: { color: COLORS.paleOrange },
    })
    addText(slide, content.qualifier, {
      x: 9.48,
      y: 5.82,
      w: 2.9,
      h: 0.32,
      fontSize: 8.5,
      bold: true,
      color: COLORS.orange,
      valign: 'top',
    })
  }
}

const renderProcess = (slide, sourceSlide) => {
  const { content } = sourceSlide
  const count = content.steps.length
  const gap = 0.18
  const width = (12.05 - gap * (count - 1)) / count
  content.steps.forEach((step, index) => {
    const x = 0.64 + index * (width + gap)
    const accent = [COLORS.blue, COLORS.teal, COLORS.orange][index % 3]
    slide.addShape('rect', {
      x,
      y: 1.48,
      w: width,
      h: 3.35,
      line: { color: accent, width: 1 },
      fill: { color: COLORS.white },
    })
    addText(slide, String(index + 1).padStart(2, '0'), {
      x: x + 0.2,
      y: 1.72,
      w: 0.55,
      h: 0.2,
      fontSize: 8,
      bold: true,
      color: accent,
    })
    addText(slide, step.period.toUpperCase(), {
      x: x + 0.2,
      y: 2.05,
      w: width - 0.4,
      h: 0.27,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
    })
    addText(slide, step.label, {
      x: x + 0.2,
      y: 2.45,
      w: width - 0.4,
      h: 0.72,
      fontSize: 14,
      bold: true,
      color: COLORS.navy,
      valign: 'top',
    })
    addText(slide, step.detail, {
      x: x + 0.2,
      y: 3.35,
      w: width - 0.4,
      h: 0.92,
      fontSize: 9,
      color: COLORS.muted,
      valign: 'top',
    })
  })
  slide.addShape('rect', {
    x: 0.64,
    y: 5.25,
    w: 12.05,
    h: 0.88,
    line: { color: 'E9D6C8', width: 0.8 },
    fill: { color: COLORS.paleOrange },
  })
  addText(slide, content.outcome, {
    x: 0.95,
    y: 5.49,
    w: 11.4,
    h: 0.35,
    fontSize: 11,
    bold: true,
    color: COLORS.orange,
    align: 'center',
  })
}

const renderRisk = (slide, sourceSlide) => {
  const { content } = sourceSlide
  const x = 0.72
  const y = 1.5
  const size = 3.55
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const severity = row + column
      const fill = severity >= 7 ? 'F6D8CF' : severity >= 4 ? 'F7E8D7' : 'E2F2ED'
      slide.addShape('rect', {
        x: x + column * (size / 5),
        y: y + (4 - row) * (size / 5),
        w: size / 5,
        h: size / 5,
        line: { color: COLORS.white, width: 0.6 },
        fill: { color: fill },
      })
    }
  }
  content.risks.slice(0, 5).forEach((risk, index) => {
    const markerX = x + (risk.impact - 0.5) * (size / 5) - 0.13
    const markerY = y + (5 - risk.probability + 0.5) * (size / 5) - 0.13
    const color = risk.score >= 15 ? COLORS.red : risk.score >= 10 ? COLORS.orange : COLORS.blue
    slide.addShape('ellipse', {
      x: markerX,
      y: markerY,
      w: 0.26,
      h: 0.26,
      line: { color, width: 0.8 },
      fill: { color },
    })
    addText(slide, String(index + 1), {
      x: markerX,
      y: markerY + 0.01,
      w: 0.26,
      h: 0.2,
      fontSize: 6.5,
      bold: true,
      color: COLORS.white,
      align: 'center',
    })
  })
  addText(slide, 'PROBABILITY INCREASES', {
    x: 0.72,
    y: 1.2,
    w: 2.2,
    h: 0.18,
    fontSize: 7,
    bold: true,
    color: COLORS.muted,
  })
  addText(slide, 'IMPACT INCREASES', {
    x: 1.7,
    y: 5.2,
    w: 1.8,
    h: 0.18,
    fontSize: 7,
    bold: true,
    color: COLORS.muted,
    align: 'center',
  })
  content.risks.slice(0, 5).forEach((risk, index) => {
    const rowY = 1.43 + index * 0.85
    const color = risk.score >= 15 ? COLORS.red : risk.score >= 10 ? COLORS.orange : COLORS.blue
    addText(slide, String(index + 1), {
      x: 5.05,
      y: rowY,
      w: 0.35,
      h: 0.24,
      fontSize: 9,
      bold: true,
      color,
      align: 'center',
    })
    addText(slide, String(risk.score), {
      x: 5.45,
      y: rowY,
      w: 0.45,
      h: 0.25,
      fontSize: 14,
      bold: true,
      color,
    })
    addText(slide, risk.label, {
      x: 6.05,
      y: rowY - 0.02,
      w: 3.9,
      h: 0.28,
      fontSize: 10.5,
      bold: true,
      color: COLORS.navy,
    })
    addText(slide, risk.owner, {
      x: 6.05,
      y: rowY + 0.3,
      w: 5.8,
      h: 0.22,
      fontSize: 7.5,
      color: COLORS.muted,
    })
  })
  if (content.secondary) {
    addText(slide, content.secondary, {
      x: 5.05,
      y: 6.02,
      w: 7.3,
      h: 0.24,
      fontSize: 7.5,
      color: COLORS.muted,
    })
  }
}

const renderScorecard = (slide, sourceSlide) => {
  const { rows } = sourceSlide.content
  const x = 0.68
  const y = 1.38
  const widths = [4.7, 1.6, 1.8, 3.45]
  const headers = ['MEASURE', 'BASELINE', 'YEAR 1 TARGET', 'EVIDENCE OWNER']
  const rowHeight = Math.min(0.82, 4.8 / rows.length)
  const headerRow = headers.map((text, index) => ({
    text,
    options: {
      bold: true,
      color: COLORS.muted,
      fill: { color: COLORS.background },
      fontFace: FONT_FACE,
      fontSize: 7.5,
      align: index > 0 && index < 3 ? 'center' : 'left',
      valign: 'ctr',
      margin: [0.06, 0.1, 0.06, 0.1],
    },
  }))
  const dataRows = rows.map((row) => ([
    {
      text: row.measure,
      options: { bold: true, color: COLORS.navy, fontSize: 10.5, valign: 'ctr' },
    },
    {
      text: row.baseline,
      options: { color: COLORS.muted, fontSize: 9.5, align: 'center', valign: 'ctr' },
    },
    {
      text: row.target,
      options: { bold: true, color: COLORS.teal, fontSize: 9.5, align: 'center', valign: 'ctr' },
    },
    {
      text: row.owner,
      options: { color: COLORS.muted, fontSize: 8.5, valign: 'ctr' },
    },
  ]))
  slide.addTable([headerRow, ...dataRows], {
    x,
    y,
    w: 11.55,
    h: 0.42 + rows.length * rowHeight,
    colW: widths,
    rowH: [0.42, ...rows.map(() => rowHeight)],
    autoPage: false,
    border: { type: 'solid', color: COLORS.border, pt: 0.7 },
    fill: { color: COLORS.background },
    color: COLORS.ink,
    fontFace: FONT_FACE,
    margin: [0.08, 0.1, 0.08, 0.1],
    valign: 'ctr',
  })
}

const renderConditions = (slide, sourceSlide) => {
  const { content } = sourceSlide
  const rowHeight = Math.min(0.78, 4.45 / content.conditions.length)
  content.conditions.forEach((condition, index) => {
    const rowY = 1.36 + index * rowHeight
    slide.addShape('ellipse', {
      x: 0.72,
      y: rowY + 0.1,
      w: 0.28,
      h: 0.28,
      line: { color: index === 2 ? COLORS.orange : COLORS.blue, width: 0.8 },
      fill: { color: index === 2 ? COLORS.orange : COLORS.blue },
    })
    addText(slide, String(index + 1), {
      x: 0.72,
      y: rowY + 0.12,
      w: 0.28,
      h: 0.18,
      fontSize: 6.5,
      bold: true,
      color: COLORS.white,
      align: 'center',
    })
    addText(slide, condition.label, {
      x: 1.18,
      y: rowY,
      w: 5.85,
      h: 0.28,
      fontSize: 10.2,
      bold: true,
      color: COLORS.navy,
    })
    if (condition.detail) {
      addText(slide, condition.detail, {
        x: 1.18,
        y: rowY + 0.29,
        w: 5.85,
        h: 0.2,
        fontSize: 7.5,
        color: COLORS.muted,
      })
    }
  })
  slide.addShape('rect', {
    x: 7.7,
    y: 1.6,
    w: 4.55,
    h: 1.55,
    line: { color: 'D2E7E2', width: 0.8 },
    fill: { color: COLORS.paleTeal },
  })
  addText(slide, 'CONTINUE', { x: 8.02, y: 1.9, w: 1.3, h: 0.2, fontSize: 8, bold: true, color: COLORS.teal })
  addText(slide, content.continueRule, { x: 8.02, y: 2.24, w: 3.9, h: 0.55, fontSize: 14, bold: true, color: COLORS.navy, valign: 'top' })
  slide.addShape('rect', {
    x: 7.7,
    y: 3.5,
    w: 4.55,
    h: 1.55,
    line: { color: 'F0D7CB', width: 0.8 },
    fill: { color: COLORS.paleOrange },
  })
  addText(slide, 'PAUSE OR REDUCE SCOPE', { x: 8.02, y: 3.8, w: 2.4, h: 0.2, fontSize: 8, bold: true, color: COLORS.orange })
  addText(slide, content.pauseRule, { x: 8.02, y: 4.14, w: 3.9, h: 0.55, fontSize: 14, bold: true, color: COLORS.navy, valign: 'top' })
}

const renderClosing = (slide, sourceSlide, disclosure, slideNumber) => {
  const { content } = sourceSlide
  slide.background = { color: COLORS.navy }
  addText(slide, 'DECISION REQUESTED', { x: 0.72, y: 0.52, w: 2.3, h: 0.22, fontSize: 8, bold: true, color: '8FD4CD' })
  addText(slide, content.statement, { x: 0.72, y: 1.55, w: 7.6, h: 1.35, fontSize: 34, bold: true, color: COLORS.white, valign: 'top' })
  addText(slide, content.subtitle, { x: 0.72, y: 3.08, w: 7.6, h: 0.45, fontSize: 15, color: 'C9D8E6' })
  slide.addShape('line', { x: 0.72, y: 4.35, w: 11.8, h: 0, line: { color: '4B6E8B', width: 1 } })
  const width = 11.8 / content.steps.length
  content.steps.forEach((step, index) => {
    const x = 0.72 + index * width
    addText(slide, String(index + 1).padStart(2, '0'), { x, y: 4.72, w: 0.5, h: 0.2, fontSize: 7.5, bold: true, color: '8FD4CD' })
    addText(slide, step.label, { x, y: 5.12, w: width - 0.25, h: 0.45, fontSize: 10.5, bold: true, color: COLORS.white, valign: 'top' })
    if (step.detail) addText(slide, step.detail, { x, y: 5.7, w: width - 0.25, h: 0.38, fontSize: 7.5, color: 'AFC4D6', valign: 'top' })
  })
  addText(slide, disclosure, { x: 0.72, y: 6.87, w: 10.7, h: 0.16, fontSize: 6.5, color: '7892A8' })
  addText(slide, String(slideNumber), { x: 12.15, y: 6.87, w: 0.45, h: 0.16, fontSize: 7, color: '7892A8', align: 'right' })
}

const renderPresentationBuffer = async ({ presentation }) => {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'StorylineOS Engineering Candidate'
  pptx.company = 'StorylineOS'
  pptx.subject = 'Professional presentation engineering candidate'
  pptx.title = presentation.metadata.title
  pptx.lang = 'en-GB'
  pptx.rtlMode = false
  pptx.theme = {
    headFontFace: FONT_FACE,
    bodyFontFace: FONT_FACE,
    lang: 'en-GB',
  }

  presentation.slides.forEach((sourceSlide, index) => {
    const slide = pptx.addSlide()
    slide.background = { color: COLORS.background }
    slide.color = COLORS.ink
    const slideNumber = index + 1
    if (sourceSlide.layout === 'COVER') {
      renderCover(slide, presentation, sourceSlide, slideNumber)
    } else if (sourceSlide.layout === 'CLOSING') {
      renderClosing(slide, sourceSlide, presentation.metadata.disclosure, slideNumber)
    } else {
      addCommonFrame(slide, {
        title: sourceSlide.title,
        disclosure: presentation.metadata.disclosure,
        slideNumber,
      })
      if (sourceSlide.layout === 'DECISION') renderDecision(slide, sourceSlide)
      if (sourceSlide.layout === 'METRICS') renderMetrics(slide, sourceSlide)
      if (sourceSlide.layout === 'CHART') renderChart(slide, pptx, sourceSlide)
      if (sourceSlide.layout === 'PROCESS') renderProcess(slide, sourceSlide)
      if (sourceSlide.layout === 'RISK') renderRisk(slide, sourceSlide)
      if (sourceSlide.layout === 'SCORECARD') renderScorecard(slide, sourceSlide)
      if (sourceSlide.layout === 'CONDITIONS') renderConditions(slide, sourceSlide)
    }
    slide.addNotes(sourceSlide.notes)
  })

  const result = await pptx.write({ outputType: 'nodebuffer', compression: true })
  return Buffer.from(result)
}

const findEndOfCentralDirectory = (buffer) => {
  const signature = 0x06054b50
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset
  }
  return -1
}

const inspectCentralDirectory = (buffer, {
  prefix,
  maxEntries,
  maxExpandedBytes,
}) => {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) failValidation(`${prefix}_END_RECORD_MISSING`)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (entryCount > maxEntries) failValidation(`${prefix}_ENTRY_LIMIT_EXCEEDED`, { maxEntries })
  const names = []
  let totalExpandedBytes = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      failValidation(`${prefix}_CENTRAL_DIRECTORY_INVALID`)
    }
    const expandedBytes = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    if (offset + 46 + nameLength + extraLength + commentLength > buffer.length) {
      failValidation(`${prefix}_CENTRAL_DIRECTORY_INVALID`)
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    names.push(name)
    totalExpandedBytes += expandedBytes
    offset += 46 + nameLength + extraLength + commentLength
  }
  const decodedNames = names.map((name) => decodeSecurityText(name))
  const uniqueNames = decodedNames.map((name) => name.toLowerCase())
  if (new Set(uniqueNames).size !== uniqueNames.length) failValidation(`${prefix}_DUPLICATE_ENTRY`)
  if (totalExpandedBytes > maxExpandedBytes) {
    failValidation(`${prefix}_EXPANSION_LIMIT_EXCEEDED`, { maxExpandedBytes })
  }
  names.forEach((name, index) => {
    const decodedName = decodedNames[index]
    if (!name || decodedName.includes('\\') || decodedName.startsWith('/') || decodedName.split('/').includes('..')) {
      failValidation(`${prefix}_ENTRY_PATH_UNSAFE`)
    }
  })
  return { names, totalExpandedBytes }
}

const assertXmlWellFormed = (xml, prefix) => {
  const source = String(xml || '')
  if (/<!doctype|<!entity/i.test(source)) failValidation(`${prefix}_XML_DTD_NOT_ALLOWED`)

  let depth = 0
  let rootCount = 0
  let parserError = null
  const parser = new SaxesParser({ xmlns: true })
  parser.on('error', (error) => {
    parserError = error
  })
  parser.on('opentag', () => {
    if (depth === 0) rootCount += 1
    depth += 1
  })
  parser.on('closetag', () => {
    depth -= 1
  })

  try {
    parser.write(source).close()
  } catch {
    failValidation(`${prefix}_XML_MALFORMED`)
  }
  if (parserError || rootCount !== 1 || depth !== 0) failValidation(`${prefix}_XML_MALFORMED`)
}

const relationshipOwnerPath = (relationshipPath) => {
  if (relationshipPath === '_rels/.rels') return ''
  return relationshipPath.replace('/_rels/', '/').replace(/\.rels$/i, '')
}

const parseRelationships = (xml) => [...String(xml || '').matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)]
  .map((match) => Object.fromEntries(
    [...match[1].matchAll(/([A-Za-z][\w:.-]*)\s*=\s*["']([^"']*)["']/g)]
      .map((attribute) => [attribute[1], attribute[2]]),
  ))

const assertExactEntrySet = ({ names, expectedNames, prefix }) => {
  const actual = [...new Set(names)].sort()
  const expected = [...new Set(expectedNames)].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    failValidation(`${prefix}_ENTRY_SET_INVALID`, {
      actualEntryCount: actual.length,
      expectedEntryCount: expected.length,
    })
  }
}

const assertContiguousIds = ({ ids, prefix }) => {
  const sorted = [...ids].sort((left, right) => left - right)
  if (sorted.some((id, index) => id !== index + 1)) failValidation(`${prefix}_IDS_INVALID`)
  return sorted
}

const expectedPresentationEntries = ({ slideCount, chartIds }) => {
  const expected = [...PPTX_FIXED_PACKAGE_ENTRIES]
  for (let index = 1; index <= slideCount; index += 1) {
    expected.push(
      `ppt/slides/slide${index}.xml`,
      `ppt/slides/_rels/slide${index}.xml.rels`,
      `ppt/notesSlides/notesSlide${index}.xml`,
      `ppt/notesSlides/_rels/notesSlide${index}.xml.rels`,
    )
  }
  chartIds.forEach((chartId) => {
    expected.push(
      `ppt/charts/chart${chartId}.xml`,
      `ppt/charts/_rels/chart${chartId}.xml.rels`,
      `ppt/embeddings/Microsoft_Excel_Worksheet${chartId}.xlsx`,
    )
  })
  return expected
}

const assertInternalRelationships = ({ xml, relationshipPath, names, prefix }) => {
  if (/TargetMode\s*=\s*["']External["']/i.test(xml)) failValidation(`${prefix}_EXTERNAL_RELATIONSHIP_NOT_ALLOWED`)
  const nameSet = new Set(names.map((name) => name.toLowerCase()))
  const owner = relationshipOwnerPath(relationshipPath)
  const baseDirectory = owner ? pathPosix.dirname(owner) : ''
  const targets = [...String(xml || '').matchAll(/Target\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])
  targets.forEach((target) => {
    const decoded = decodeSecurityText(target)
    if (/(?:https?|ftp|file|data|javascript|vbscript|mailto|tel|sms|cid|blob|about):/.test(decoded)
      || decoded.startsWith('//')
      || /^[a-z]:[\\/]/.test(decoded)
      || decoded.includes('\\')) {
      failValidation(`${prefix}_RELATIONSHIP_TARGET_UNSAFE`)
    }
    const resolved = (target.startsWith('/')
      ? pathPosix.normalize(target.slice(1))
      : pathPosix.normalize(pathPosix.join(baseDirectory, target)))
      .replace(/^\.\//, '')
    if (!resolved || resolved === '..' || resolved.startsWith('../') || !nameSet.has(resolved.toLowerCase())) {
      failValidation(`${prefix}_RELATIONSHIP_TARGET_INVALID`)
    }
  })
}

const normalizeCoreProperties = (xml) => String(xml || '')
  .replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/g, '<dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>')
  .replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/g, '<dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified>')
  .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/g, '<cp:lastModifiedBy>StorylineOS Engineering Candidate</cp:lastModifiedBy>')

const normalizeZipPackage = async (buffer, mimeType) => {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  const core = archive.file('docProps/core.xml')
  if (core) archive.file('docProps/core.xml', normalizeCoreProperties(await core.async('string')), { date: FIXED_PACKAGE_DATE })
  Object.values(archive.files).forEach((file) => { file.date = FIXED_PACKAGE_DATE })
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    mimeType,
  })
}

const validateGeneratedChartWorkbook = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    failValidation('PPTX_CHART_WORKBOOK_SIGNATURE_INVALID')
  }
  if (buffer.length > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxEmbeddedWorkbookBytes) {
    failValidation('PPTX_CHART_WORKBOOK_SIZE_LIMIT_EXCEEDED', {
      maxBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxEmbeddedWorkbookBytes,
    })
  }
  const { names } = inspectCentralDirectory(buffer, {
    prefix: 'PPTX_CHART_WORKBOOK',
    maxEntries: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxWorkbookEntries,
    maxExpandedBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxWorkbookExpandedBytes,
  })
  const required = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']
  required.forEach((entry) => {
    if (!names.includes(entry)) failValidation('PPTX_CHART_WORKBOOK_CORE_ENTRY_MISSING', { entryType: entry.replace(/[^a-z]/gi, '_') })
  })
  names.forEach((name) => {
    if (/\.(?:exe|dll|com|bat|cmd|ps1|js|vbs|jar|msi|scr|bin|zip|7z|rar|tar|gz|bz2|xz)$/i.test(name)
      || /(?:vbaProject|macros?|embeddings|oleObject|activeX|externalLinks?|connections|queryTables|dataModel|customXml|comments?)/i.test(name)) {
      failValidation('PPTX_CHART_WORKBOOK_CONTENT_NOT_ALLOWED')
    }
  })
  assertExactEntrySet({
    names,
    expectedNames: WORKBOOK_PACKAGE_ENTRIES,
    prefix: 'PPTX_CHART_WORKBOOK',
  })
  let archive
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  } catch {
    failValidation('PPTX_CHART_WORKBOOK_ARCHIVE_INVALID')
  }
  const contentTypes = await archive.file('[Content_Types].xml').async('string')
  if (/(?:macroenabled|vbaproject|externalLink|activeX|oleObject)/i.test(contentTypes)) {
    failValidation('PPTX_CHART_WORKBOOK_CONTENT_NOT_ALLOWED')
  }
  for (const name of names) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
    let xml
    try {
      xml = await archive.file(name).async('string')
    } catch {
      failValidation('PPTX_CHART_WORKBOOK_ENTRY_READ_FAILED')
    }
    assertXmlWellFormed(xml, 'PPTX_CHART_WORKBOOK')
    if (name.endsWith('.rels')) {
      assertInternalRelationships({ xml, relationshipPath: name, names, prefix: 'PPTX_CHART_WORKBOOK' })
    }
  }
  return Object.freeze({ entryCount: names.length })
}

const normalizePresentationPackage = async (buffer) => {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  const chartNumbers = Object.keys(archive.files)
    .map((name) => name.match(/^ppt\/charts\/chart(\d+)\.xml$/i))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right)
  const chartNumberMap = new Map(chartNumbers.map((number, index) => [number, index + 1]))

  if ([...chartNumberMap].some(([source, target]) => source !== target)) {
    const sourceEntries = Object.keys(archive.files)
    const replacements = []
    for (const name of sourceEntries) {
      if (archive.files[name].dir) continue
      const file = archive.file(name)
      const isXml = name.endsWith('.xml') || name.endsWith('.rels')
      let content = await file.async(isXml ? 'string' : 'nodebuffer')
      if (isXml) {
        for (const [source, target] of chartNumberMap) {
          content = content
            .replaceAll(`chart${source}.xml`, `__STORYLINEOS_CHART_${target}__.xml`)
            .replaceAll(
              `Microsoft_Excel_Worksheet${source}.xlsx`,
              `__STORYLINEOS_WORKBOOK_${target}__.xlsx`,
            )
        }
        content = content
          .replace(/__STORYLINEOS_CHART_(\d+)__\.xml/g, 'chart$1.xml')
          .replace(/__STORYLINEOS_WORKBOOK_(\d+)__\.xlsx/g, 'Microsoft_Excel_Worksheet$1.xlsx')
      }
      const normalizedName = name
        .replace(/chart(\d+)\.xml/gi, (match, number) => {
          const target = chartNumberMap.get(Number(number))
          return target ? `chart${target}.xml` : match
        })
        .replace(/Microsoft_Excel_Worksheet(\d+)\.xlsx/gi, (match, number) => {
          const target = chartNumberMap.get(Number(number))
          return target ? `Microsoft_Excel_Worksheet${target}.xlsx` : match
        })
      replacements.push({ sourceName: name, normalizedName, content, isXml })
    }
    replacements.forEach(({ sourceName }) => archive.remove(sourceName))
    replacements.forEach(({ normalizedName, content, isXml }) => {
      archive.file(normalizedName, content, { date: FIXED_PACKAGE_DATE, binary: !isXml })
    })
  }

  const workbookNames = Object.keys(archive.files).filter((name) => /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(name))
  for (const name of workbookNames) {
    const workbook = await archive.file(name).async('nodebuffer')
    const normalizedWorkbook = await normalizeZipPackage(
      workbook,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    archive.file(name, normalizedWorkbook, { date: FIXED_PACKAGE_DATE, binary: true })
  }
  const core = archive.file('docProps/core.xml')
  if (core) archive.file('docProps/core.xml', normalizeCoreProperties(await core.async('string')), { date: FIXED_PACKAGE_DATE })
  Object.values(archive.files).forEach((file) => { file.date = FIXED_PACKAGE_DATE })
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

const extractTextNodes = (xml) => [...String(xml || '').matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)]
  .map((match) => match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  .join(' ')
  .trim()

export const validateProfessionalPresentationCandidatePackage = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    failValidation('PPTX_ZIP_SIGNATURE_INVALID')
  }
  if (buffer.length > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxOutputBytes) {
    failValidation('PPTX_OUTPUT_LIMIT_EXCEEDED', {
      maxOutputBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxOutputBytes,
    })
  }
  const { names } = inspectCentralDirectory(buffer, {
    prefix: 'PPTX',
    maxEntries: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxPackageEntries,
    maxExpandedBytes: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxExpandedBytes,
  })
  const required = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']
  required.forEach((entry) => {
    if (!names.includes(entry)) failValidation('PPTX_CORE_ENTRY_MISSING', { entryType: entry.replace(/[^a-z]/gi, '_') })
  })
  names.forEach((name) => {
    const isAllowedWorkbook = /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(name)
    const isAllowedWorkbookDirectory = /^ppt\/embeddings\/$/i.test(name)
    if (/\.(?:exe|dll|com|bat|cmd|ps1|js|vbs|jar|msi|scr|bin|zip|7z|rar|tar|gz|bz2|xz)$/i.test(name)) {
      failValidation('PPTX_EXECUTABLE_OR_ARCHIVE_ENTRY_NOT_ALLOWED')
    }
    if ((/(?:vbaProject|macros?|oleObject|activeX|externalLinks?|customXml|comments?|people|threadedComments)/i.test(name))
      || (/\/embeddings\//i.test(name) && !isAllowedWorkbook && !isAllowedWorkbookDirectory)) {
      failValidation('PPTX_EMBEDDED_OR_ACTIVE_CONTENT_NOT_ALLOWED')
    }
  })

  let archive
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  } catch {
    failValidation('PPTX_ARCHIVE_INVALID')
  }
  const contentTypes = await archive.file('[Content_Types].xml').async('string')
  if (/(?:macroenabled|vbaproject|activeX|oleObject|externalLink)/i.test(contentTypes)) {
    failValidation('PPTX_ACTIVE_CONTENT_TYPE_NOT_ALLOWED')
  }

  const slideNames = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]))
  const notesNames = names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]))
  if (slideNames.length < 1 || slideNames.length > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlides) {
    failValidation('PPTX_SLIDE_COUNT_INVALID')
  }
  if (notesNames.length !== slideNames.length) failValidation('PPTX_NOTES_COUNT_MISMATCH')
  const slideIds = assertContiguousIds({
    ids: slideNames.map((name) => Number(name.match(/slide(\d+)\.xml$/i)[1])),
    prefix: 'PPTX_SLIDE',
  })
  const notesIds = assertContiguousIds({
    ids: notesNames.map((name) => Number(name.match(/notesSlide(\d+)\.xml$/i)[1])),
    prefix: 'PPTX_NOTES',
  })
  if (slideIds.some((slideId, index) => notesIds[index] !== slideId)) {
    failValidation('PPTX_NOTES_TOPOLOGY_INVALID')
  }

  for (const name of names) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
    let xml
    try {
      xml = await archive.file(name).async('string')
    } catch {
      failValidation('PPTX_ENTRY_READ_FAILED')
    }
    assertXmlWellFormed(xml, 'PPTX')
    if (name.endsWith('.rels')) assertInternalRelationships({ xml, relationshipPath: name, names, prefix: 'PPTX' })
  }

  const chartReferenceCounts = new Map()
  for (const slideId of slideIds) {
    const slideFile = archive.file(`ppt/slides/slide${slideId}.xml`)
    const relationshipsFile = archive.file(`ppt/slides/_rels/slide${slideId}.xml.rels`)
    const notesRelationshipsFile = archive.file(`ppt/notesSlides/_rels/notesSlide${slideId}.xml.rels`)
    if (!slideFile || !relationshipsFile || !notesRelationshipsFile) failValidation('PPTX_NOTES_TOPOLOGY_INVALID')
    const slideXml = await slideFile.async('string')
    const relationshipsXml = await relationshipsFile.async('string')
    const relationships = parseRelationships(relationshipsXml)
    const notesRelationships = relationships.filter((relationship) => relationship.Type === RELATIONSHIP_TYPES.notesSlide)
    if (notesRelationships.length !== 1
      || notesRelationships[0].Target !== `../notesSlides/notesSlide${slideId}.xml`
      || notesRelationships[0].TargetMode === 'External') {
      failValidation('PPTX_NOTES_TOPOLOGY_INVALID')
    }

    const chartObjectRelationshipIds = [...slideXml.matchAll(/<c:chart\b[^>]*\br:id=["']([^"']+)["']/gi)]
      .map((match) => match[1])
    const chartRelationships = relationships.filter((relationship) => relationship.Type === RELATIONSHIP_TYPES.chart)
    const chartRelationshipIds = chartRelationships.map((relationship) => relationship.Id)
    if (chartObjectRelationshipIds.length !== chartRelationships.length
      || chartObjectRelationshipIds.some((id, index) => chartRelationshipIds[index] !== id)
      || new Set(chartRelationshipIds).size !== chartRelationshipIds.length) {
      failValidation('PPTX_CHART_REFERENCE_TOPOLOGY_INVALID')
    }
    chartRelationships.forEach((relationship) => {
      const target = relationship.Target?.match(/^\/ppt\/charts\/chart(\d+)\.xml$/i)
      if (!target || relationship.TargetMode === 'External') {
        failValidation('PPTX_CHART_REFERENCE_TOPOLOGY_INVALID')
      }
      const chartId = Number(target[1])
      chartReferenceCounts.set(chartId, (chartReferenceCounts.get(chartId) || 0) + 1)
    })

    const notesRelationshipsXml = await notesRelationshipsFile.async('string')
    const notesPageRelationships = parseRelationships(notesRelationshipsXml)
    const slideRelationships = notesPageRelationships.filter((relationship) => relationship.Type === RELATIONSHIP_TYPES.slide)
    const notesMasterRelationships = notesPageRelationships.filter((relationship) => relationship.Type === RELATIONSHIP_TYPES.notesMaster)
    if (slideRelationships.length !== 1
      || slideRelationships[0].Target !== `../slides/slide${slideId}.xml`
      || slideRelationships[0].TargetMode === 'External'
      || notesMasterRelationships.length !== 1
      || notesMasterRelationships[0].Target !== '../notesMasters/notesMaster1.xml'
      || notesMasterRelationships[0].TargetMode === 'External') {
      failValidation('PPTX_NOTES_TOPOLOGY_INVALID')
    }
  }

  const chartIds = assertContiguousIds({ ids: [...chartReferenceCounts.keys()], prefix: 'PPTX_CHART' })
  if (chartIds.length > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxCharts
    || [...chartReferenceCounts.values()].some((count) => count !== 1)) {
    failValidation('PPTX_CHART_REFERENCE_TOPOLOGY_INVALID')
  }
  assertExactEntrySet({
    names,
    expectedNames: expectedPresentationEntries({ slideCount: slideIds.length, chartIds }),
    prefix: 'PPTX',
  })

  for (const chartId of chartIds) {
    const relationshipsXml = await archive.file(`ppt/charts/_rels/chart${chartId}.xml.rels`).async('string')
    const relationships = parseRelationships(relationshipsXml)
    if (relationships.length !== 1
      || relationships[0].Type !== RELATIONSHIP_TYPES.package
      || relationships[0].Target !== `../embeddings/Microsoft_Excel_Worksheet${chartId}.xlsx`
      || relationships[0].TargetMode === 'External') {
      failValidation('PPTX_CHART_WORKBOOK_TOPOLOGY_INVALID')
    }
  }

  const presentationXml = await archive.file('ppt/presentation.xml').async('string')
  const slideSize = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i)
  if (!slideSize || Number(slideSize[1]) !== WIDE_SLIDE_CX || Number(slideSize[2]) !== WIDE_SLIDE_CY) {
    failValidation('PPTX_SLIDE_GEOMETRY_INVALID')
  }
  for (const name of slideNames) {
    const text = extractTextNodes(await archive.file(name).async('string'))
    if (!text) failValidation('PPTX_SLIDE_TEXT_MISSING')
  }
  for (const name of notesNames) {
    const text = extractTextNodes(await archive.file(name).async('string'))
    const count = wordCount(text)
    if (count < PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.minNotesWords
      || count > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxNotesWords + 20) {
      failValidation('PPTX_NOTES_CONTENT_INVALID')
    }
  }

  const chartNames = chartIds.map((chartId) => `ppt/charts/chart${chartId}.xml`)
  const workbookNames = chartIds.map((chartId) => `ppt/embeddings/Microsoft_Excel_Worksheet${chartId}.xlsx`)
  if (workbookNames.length > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxEmbeddedWorkbooks) {
    failValidation('PPTX_CHART_WORKBOOK_COUNT_INVALID', {
      maxCharts: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxCharts,
    })
  }
  let combinedWorkbookBytes = 0
  for (const name of workbookNames) {
    const workbook = await archive.file(name).async('nodebuffer')
    combinedWorkbookBytes += workbook.length
    await validateGeneratedChartWorkbook(workbook)
  }
  if (combinedWorkbookBytes > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxCombinedWorkbookBytes) {
    failValidation('PPTX_CHART_WORKBOOK_COMBINED_LIMIT_EXCEEDED')
  }

  return Object.freeze({
    status: 'PASS',
    checks: Object.freeze([
      'PPTX_ZIP_SIGNATURE_VALID',
      'PPTX_CORE_ENTRIES_PRESENT',
      'PPTX_ENTRY_PATHS_SAFE',
      'PPTX_ENTRY_SET_EXACT',
      'PPTX_ACTIVE_CONTENT_ABSENT',
      'PPTX_XML_WELL_FORMED',
      'PPTX_RELATIONSHIPS_INTERNAL_ONLY',
      'PPTX_SLIDE_NOTES_TOPOLOGY_VALID',
      'PPTX_CHART_WORKBOOK_TOPOLOGY_VALID',
      'PPTX_SLIDE_GEOMETRY_VALID',
      'PPTX_SLIDES_AND_NOTES_PRESENT',
      'PPTX_GENERATED_CHART_WORKBOOKS_VALID',
      'PPTX_PACKAGE_LIMITS_VALID',
    ]),
    entryCount: names.length,
    slideCount: slideNames.length,
    notesCount: notesNames.length,
    chartCount: chartNames.length,
    generatedWorkbookCount: workbookNames.length,
    contentIncludedInValidation: false,
  })
}

export const renderProfessionalPresentationCandidate = async (input = {}) => {
  const parsed = parseProfessionalPresentationCandidateInput(input)
  const startedAt = Date.now()
  let buffer
  try {
    buffer = await renderPresentationBuffer(parsed)
    buffer = await normalizePresentationPackage(buffer)
  } catch (error) {
    if (error?.name === 'ProfessionalPresentationCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: 'PPTX_RENDER_FAILED',
    })
  }
  const renderTimeMs = Date.now() - startedAt
  if (renderTimeMs > PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.renderTargetMs) {
    failLimit('PPTX_RENDER_TARGET_EXCEEDED', {
      renderTargetMs: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.renderTargetMs,
    })
  }
  const validation = await validateProfessionalPresentationCandidatePackage(buffer)
  return Object.freeze({
    profile: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE,
    buffer,
    validation,
    metrics: Object.freeze({
      slideCount: validation.slideCount,
      notesCount: validation.notesCount,
      chartCount: validation.chartCount,
      generatedWorkbookCount: validation.generatedWorkbookCount,
      entryCount: validation.entryCount,
      renderTimeMs,
      outputBytes: buffer.length,
      contentIncludedInMetrics: false,
    }),
  })
}

export const __testables = Object.freeze({
  decodeSecurityText,
  extractTextNodes,
  inspectCentralDirectory,
  normalizePresentationPackage,
  validateGeneratedChartWorkbook,
  visibleByteCount,
})
