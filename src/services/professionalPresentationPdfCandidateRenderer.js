import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import './professionalPresentationPdfCandidatePromiseCompatibility.js'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import {
  parseProfessionalPresentationCandidateInput,
  PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE,
} from './professionalPresentationCandidateRenderer.js'

const DISCLOSURE = 'Illustrative reference candidate | not approved'
const FIXED_PDF_DATE = "D:20000101000000+00'00'"
const SAFE_PDF_PROPERTY_VALUE = 'StoryLineOS'
const EXPECTED_CHROMIUM_PDF_CREATOR = 'Mozilla/5.0 \\(Windows NT 10.0; Win64; x64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/148.0.0.0 Safari/537.36'
const EXPECTED_CHROMIUM_PDF_PRODUCER = 'Skia/PDF m148'
const FORBIDDEN_PDF_PROPERTY_TERMS = Object.freeze([
  'headlesschrome',
  'chrome/',
  'chromium',
  'skia/pdf',
  'mozilla/',
])
const PAGE_WIDTH = 960
const PAGE_HEIGHT = 540
const MAX_INSTALLATION_FILES = 500
const MAX_INSTALLATION_BYTES = 600 * 1024 * 1024

export const PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-presentation-pdf-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-006-v1.1-NOT-APPROVED',
  templateProfile: 'executive-presentation-neutral.v0.1',
  engine: Object.freeze({
    key: 'PLAYWRIGHT_CORE_CHROMIUM_IN_PROCESS_ENGINEERING_CANDIDATE',
    version: 'playwright-core@1.61.1',
    chromiumRevision: '1223',
    chromiumProductVersion: '148.0.7778.96',
    executableBytes: 4_011_008,
    executableSha256: '290fa7018fda22c52ada5eddb0113baf3ebc41fd0fde6085eddb19793606c635',
    installationFingerprint: '57f8172866f6ad4eff4c9592e0165b6f27c434b740c816ccf34d8597d53dcfdc',
    installationFileCount: 308,
    installationBytes: 432_272_872,
    launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
  }),
  limits: Object.freeze({
    ...PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits,
    maxPages: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlides,
    maxOutputBytes: 25_165_824,
    browserLaunchTimeoutMs: 10_000,
    workDeadlineMs: 15_000,
    cleanupDeadlineMs: 5_000,
    maxInstallationFiles: MAX_INSTALLATION_FILES,
    maxInstallationBytes: MAX_INSTALLATION_BYTES,
  }),
})

export const PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_INPUT_INVALID',
  RUNTIME_INVALID: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_RUNTIME_INVALID',
  LIMIT_EXCEEDED: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_VALIDATION_FAILED',
  TIMEOUT: 'PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_TIMEOUT',
})

const createCandidateError = ({ code, reason, details = {} }) => {
  const error = new Error('The professional presentation PDF engineering candidate could not complete this render.')
  error.name = 'ProfessionalPresentationPdfCandidateError'
  error.code = code
  error.reason = reason
  error.details = Object.freeze({ reason, contentIncludedInError: false, ...details })
  return error
}

const fail = (code, reason, details) => {
  throw createCandidateError({ code, reason, details })
}

const sanitizePresentationInputError = (error) => createCandidateError({
  code: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID,
  reason: /^[A-Z0-9_]+$/.test(String(error?.reason || ''))
    ? error.reason
    : 'PRESENTATION_INPUT_INVALID',
})

const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
)

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const toneClass = (tone) => `tone-${String(tone || 'NEUTRAL').toLowerCase()}`
const metricCard = (metric) => `<article class="metric ${toneClass(metric.tone)}" data-bounded>
  <span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.detail)}</small>
</article>`

const renderCover = (content) => `<div class="cover" data-bounded>
  <p class="eyebrow">${escapeHtml(content.eyebrow)}</p>
  <p class="cover-subtitle">${escapeHtml(content.subtitle)}</p>
  <p class="audience">Prepared for ${escapeHtml(content.audience)}</p>
</div>`

const renderDecision = (content) => `<div class="stack" data-bounded>
  <p class="lead">${escapeHtml(content.statement)}</p>
  <div class="metric-grid">${content.metrics.map(metricCard).join('')}</div>
  <aside class="qualifier">${escapeHtml(content.qualifier)}</aside>
</div>`

const renderMetrics = (content) => `<div class="stack" data-bounded>
  <div class="metric-grid">${content.steps.map(metricCard).join('')}</div>
  <div class="result">${metricCard(content.result)}</div>
  <div class="indicator-grid">${content.indicators.map(metricCard).join('')}</div>
</div>`

const renderChart = (content) => {
  const values = content.series.flatMap((series) => series.values)
  const maximum = Math.max(1, ...values.map((value) => Math.abs(value)))
  const rows = content.categories.map((category, categoryIndex) => `<div class="chart-row">
    <span>${escapeHtml(category)}</span>
    <div class="chart-series">${content.series.map((series, seriesIndex) => {
      const value = series.values[categoryIndex]
      const width = Math.max(2, Math.round((Math.abs(value) / maximum) * 100))
      return `<div class="bar-row"><i class="bar series-${seriesIndex} ${value < 0 ? 'negative' : ''}" style="width:${width}%"></i><b>${escapeHtml(value)}</b><small>${escapeHtml(series.name)}</small></div>`
    }).join('')}</div>
  </div>`).join('')
  return `<div class="chart-layout" data-bounded><div class="chart">${rows}</div>
    <aside><div class="callouts">${content.callouts.map(metricCard).join('')}</div><p class="qualifier">${escapeHtml(content.qualifier)}</p></aside>
  </div>`
}

const renderProcess = (content) => `<div class="stack" data-bounded>
  <ol class="process">${content.steps.map((step, index) => `<li><b>${index + 1}</b><div><small>${escapeHtml(step.period)}</small><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.detail)}</span></div></li>`).join('')}</ol>
  <p class="outcome">${escapeHtml(content.outcome)}</p>
</div>`

const renderRisk = (content) => `<div class="stack" data-bounded>
  <table><thead><tr><th>Risk</th><th>Probability</th><th>Impact</th><th>Score</th><th>Owner and control</th></tr></thead>
  <tbody>${content.risks.map((risk) => `<tr><td>${escapeHtml(risk.label)}</td><td>${risk.probability}</td><td>${risk.impact}</td><td><b class="score score-${risk.score >= 12 ? 'high' : 'medium'}">${risk.score}</b></td><td>${escapeHtml(risk.owner)}</td></tr>`).join('')}</tbody></table>
  <p class="qualifier">${escapeHtml(content.secondary)}</p>
</div>`

const renderScorecard = (content) => `<div data-bounded><table><thead><tr><th>Measure</th><th>Baseline</th><th>Target</th><th>Owner</th></tr></thead>
  <tbody>${content.rows.map((row) => `<tr><td>${escapeHtml(row.measure)}</td><td>${escapeHtml(row.baseline)}</td><td><strong>${escapeHtml(row.target)}</strong></td><td>${escapeHtml(row.owner)}</td></tr>`).join('')}</tbody></table></div>`

const renderConditions = (content) => `<div class="stack" data-bounded>
  <ol class="conditions">${content.conditions.map((condition) => `<li><strong>${escapeHtml(condition.label)}</strong><span>${escapeHtml(condition.detail)}</span></li>`).join('')}</ol>
  <div class="rules"><p><b>Continue</b>${escapeHtml(content.continueRule)}</p><p><b>Pause</b>${escapeHtml(content.pauseRule)}</p></div>
</div>`

const renderClosing = (content) => `<div class="closing" data-bounded>
  <p class="lead">${escapeHtml(content.statement)}</p><p>${escapeHtml(content.subtitle)}</p>
  <ol class="closing-steps">${content.steps.map((step) => `<li><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.detail)}</span></li>`).join('')}</ol>
</div>`

const renderSlideContent = (slide) => ({
  COVER: renderCover,
  DECISION: renderDecision,
  METRICS: renderMetrics,
  CHART: renderChart,
  PROCESS: renderProcess,
  RISK: renderRisk,
  SCORECARD: renderScorecard,
  CONDITIONS: renderConditions,
  CLOSING: renderClosing,
})[slide.layout](slide.content)

const STYLE = `
  @page { size: ${PAGE_WIDTH}pt ${PAGE_HEIGHT}pt; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #24364a; font-family: Arial, Helvetica, sans-serif; }
  .slide { width: ${PAGE_WIDTH}pt; height: ${PAGE_HEIGHT}pt; padding: 34pt 42pt 26pt; overflow: hidden; position: relative; break-after: page; background: #f8fafb; }
  .slide:last-child { break-after: auto; }
  .slide.cover-slide { background: #071c33; color: #fff; }
  h1 { margin: 0 0 20pt; max-width: 820pt; color: #173b5e; font-size: 24pt; line-height: 1.12; }
  .cover-slide h1 { margin-top: 92pt; color: #fff; font-size: 33pt; max-width: 760pt; }
  p { margin: 0; line-height: 1.35; }
  .slide-body { height: 414pt; overflow: hidden; }
  .cover-slide .slide-body { height: 230pt; }
  .footer { position: absolute; left: 42pt; right: 42pt; bottom: 11pt; display: flex; justify-content: space-between; color: #66788a; font-size: 7.5pt; }
  .cover-slide .footer { color: #cbd6e0; }
  .stack { display: grid; gap: 15pt; }
  .lead { font-size: 19pt; color: #173b5e; font-weight: 700; max-width: 760pt; }
  .cover { display: grid; gap: 16pt; max-width: 720pt; }
  .eyebrow { color: #65c8b3; font-size: 10pt; font-weight: 700; text-transform: uppercase; }
  .cover-subtitle { font-size: 17pt; line-height: 1.35; color: #d8e5ef; }
  .audience { margin-top: 20pt; color: #a9c2d5; font-size: 11pt; }
  .metric-grid, .indicator-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10pt; }
  .indicator-grid { grid-template-columns: repeat(3, 1fr); }
  .metric { min-height: 82pt; padding: 11pt; border: 1pt solid #d6dee6; background: #fff; border-top: 4pt solid #66788a; display: flex; flex-direction: column; gap: 4pt; }
  .metric span { font-size: 8pt; color: #66788a; text-transform: uppercase; font-weight: 700; }
  .metric strong { font-size: 18pt; color: #173b5e; }
  .metric small { font-size: 8pt; color: #66788a; line-height: 1.25; }
  .tone-primary { border-top-color: #2c7db9; } .tone-positive { border-top-color: #2a927f; } .tone-caution { border-top-color: #e47735; }
  .result { max-width: 300pt; } .result .metric { background: #173b5e; } .result .metric strong, .result .metric span, .result .metric small { color: #fff; }
  .qualifier, .outcome { padding: 10pt 12pt; border-left: 4pt solid #2c7db9; background: #eaf3f9; font-size: 9pt; line-height: 1.3; }
  .chart-layout { display: grid; grid-template-columns: 2.2fr 1fr; gap: 20pt; height: 385pt; }
  .chart { display: grid; align-content: center; gap: 13pt; padding: 8pt 0; }
  .chart-row { display: grid; grid-template-columns: 105pt 1fr; gap: 10pt; align-items: center; font-size: 8.5pt; font-weight: 700; }
  .chart-series { display: grid; gap: 4pt; }
  .bar-row { display: grid; grid-template-columns: minmax(20pt, 1fr) 40pt 80pt; align-items: center; gap: 6pt; height: 17pt; }
  .bar { display: block; height: 12pt; background: #2c7db9; } .series-1 { background: #2a927f; } .series-2 { background: #e47735; } .bar.negative { background: #c44d4d; }
  .bar-row b { font-size: 8pt; } .bar-row small { font-size: 6.5pt; color: #66788a; }
  .callouts { display: grid; gap: 8pt; } .callouts .metric { min-height: 70pt; } .callouts .metric strong { font-size: 14pt; }
  .process { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 9pt; }
  .process li { min-height: 170pt; padding: 12pt; background: #fff; border-top: 4pt solid #2c7db9; }
  .process li > b { display: grid; place-items: center; width: 24pt; height: 24pt; border-radius: 50%; background: #173b5e; color: #fff; }
  .process li div { display: flex; flex-direction: column; gap: 8pt; margin-top: 15pt; }
  .process small { color: #2c7db9; font-size: 7pt; font-weight: 700; } .process strong { font-size: 11pt; } .process span { font-size: 8pt; line-height: 1.35; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 8.5pt; }
  th { padding: 9pt; text-align: left; background: #173b5e; color: #fff; font-size: 7.5pt; text-transform: uppercase; }
  td { padding: 8pt 9pt; border-bottom: 1pt solid #d6dee6; line-height: 1.3; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f3f6f8; }
  .score { display: inline-block; min-width: 24pt; padding: 3pt; text-align: center; color: #fff; background: #e47735; } .score-high { background: #c44d4d; }
  .conditions { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
  .conditions li { min-height: 70pt; padding: 11pt; border-left: 4pt solid #2a927f; background: #fff; display: flex; flex-direction: column; gap: 5pt; }
  .conditions strong { font-size: 10pt; } .conditions span { font-size: 8pt; line-height: 1.3; }
  .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; } .rules p { padding: 10pt; background: #eaf3f9; font-size: 9pt; }
  .rules b { display: block; color: #173b5e; text-transform: uppercase; font-size: 7pt; margin-bottom: 4pt; }
  .closing { display: grid; gap: 18pt; max-width: 820pt; }
  .closing > p:nth-child(2) { color: #66788a; font-size: 12pt; }
  .closing-steps { list-style: none; padding: 0; margin: 14pt 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10pt; }
  .closing-steps li { min-height: 95pt; padding: 12pt; background: #fff; border-top: 4pt solid #2a927f; display: flex; flex-direction: column; gap: 8pt; }
  .closing-steps strong { color: #173b5e; font-size: 11pt; } .closing-steps span { font-size: 8pt; line-height: 1.3; }
`

const compileProfessionalPresentationPdfCandidateHtml = (presentation) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(presentation.metadata.title)}</title><style>${STYLE}</style></head>
<body>${presentation.slides.map((slide, index) => `<section class="slide ${slide.layout === 'COVER' ? 'cover-slide' : ''}" data-slide-index="${index}" data-bounded>
  <h1>${escapeHtml(slide.title)}</h1><main class="slide-body" data-bounded>${renderSlideContent(slide)}</main>
  <footer class="footer"><span>${escapeHtml(DISCLOSURE)}</span><span>${index + 1} / ${presentation.slides.length}</span></footer>
</section>`).join('')}</body></html>`

const sha256File = async (filePath) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

const fingerprintChromiumInstallation = async (executablePath, {
  lstatImpl = lstat,
  readdirImpl = readdir,
  sha256FileImpl = sha256File,
  maxFiles = MAX_INSTALLATION_FILES,
  maxBytes = MAX_INSTALLATION_BYTES,
} = {}) => {
  const installationRoot = path.dirname(executablePath)
  const rootStat = await lstatImpl(installationRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_INSTALLATION_INVALID')
  const rows = []
  let totalBytes = 0
  const walk = async (directory) => {
    const entries = await readdirImpl(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const stat = await lstatImpl(absolutePath)
      if (stat.isSymbolicLink()) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_INSTALLATION_SYMLINK_NOT_ALLOWED')
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile()) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_INSTALLATION_ENTRY_INVALID')
      const relativePath = path.relative(installationRoot, absolutePath).split(path.sep).join('/')
      if (relativePath === 'debug.log') continue
      totalBytes += stat.size
      if (rows.length >= maxFiles || totalBytes > maxBytes) {
        fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_INSTALLATION_LIMIT_EXCEEDED')
      }
      rows.push({ relativePath, byteLength: stat.size, fileSha256: await sha256FileImpl(absolutePath) })
    }
  }
  await walk(installationRoot)
  rows.sort((left, right) => Buffer.compare(
    Buffer.from(left.relativePath, 'utf8'),
    Buffer.from(right.relativePath, 'utf8'),
  ))
  const manifest = rows
    .map(({ relativePath, byteLength, fileSha256 }) => `${relativePath}|${byteLength}|${fileSha256}`)
    .join('\n')
  return Object.freeze({
    fingerprint: createHash('sha256').update(Buffer.from(manifest, 'utf8')).digest('hex').toLowerCase(),
    fileCount: rows.length,
    totalBytes,
  })
}

const assertExactRuntimeKeys = (runtime) => {
  if (!isPlainObject(runtime)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_REQUIRED')
  const expectedKeys = ['executablePath', 'revision', 'productVersion', 'executableSha256', 'installationFingerprint']
  const keys = Object.keys(runtime).sort()
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_FIELDS_INVALID')
  }
}

const validateBrowserRuntime = async (runtime, fingerprintInstallation, {
  lstatImpl = lstat,
  sha256FileImpl = sha256File,
} = {}) => {
  assertExactRuntimeKeys(runtime)
  if (typeof runtime.executablePath !== 'string' || !path.isAbsolute(runtime.executablePath) || path.basename(runtime.executablePath).toLowerCase() !== 'chrome.exe') {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_EXECUTABLE_INVALID')
  }
  const expected = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine
  if (runtime.revision !== expected.chromiumRevision
    || runtime.productVersion !== expected.chromiumProductVersion
    || runtime.executableSha256 !== expected.executableSha256
    || runtime.installationFingerprint !== expected.installationFingerprint) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_IDENTITY_DECLARATION_MISMATCH')
  }
  const executableStat = await lstatImpl(runtime.executablePath)
  if (executableStat.isSymbolicLink() || !executableStat.isFile()) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_EXECUTABLE_INVALID')
  if (executableStat.size !== expected.executableBytes) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_EXECUTABLE_SIZE_MISMATCH')
  const executableSha256 = await sha256FileImpl(runtime.executablePath)
  if (executableSha256 !== expected.executableSha256) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_EXECUTABLE_FINGERPRINT_MISMATCH')
  const installation = await fingerprintInstallation(runtime.executablePath)
  if (installation.fingerprint !== expected.installationFingerprint
    || installation.fileCount !== expected.installationFileCount
    || installation.totalBytes !== expected.installationBytes) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_INSTALLATION_FINGERPRINT_MISMATCH')
  }
  return installation
}

const FORBIDDEN_PDF_NAMES = new Set([
  'AA', 'ACROFORM', 'EMBEDDEDFILE', 'ENCRYPT', 'FILESPEC', 'GOTOR', 'IMPORTDATA', 'JAVASCRIPT', 'JS',
  'LAUNCH', 'OPENACTION', 'RICHMEDIA', 'SUBMITFORM', 'URI', 'XFA',
])
const decodePdfName = (value) => String(value ?? '')
  .replace(/#([0-9a-f]{2})/gi, (_match, encoded) => String.fromCharCode(Number.parseInt(encoded, 16)))
  .toUpperCase()

const inspectPdfNames = (buffer) => {
  const source = buffer.toString('latin1').replace(/%[^\r\n]*/g, ' ')
  const pattern = /\/([^\x00\x09\x0a\x0c\x0d ()<>\[\]{}/%]+)/g
  let count = 0
  let match
  while ((match = pattern.exec(source)) !== null) {
    count += 1
    const name = decodePdfName(match[1])
    if (FORBIDDEN_PDF_NAMES.has(name)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED', { forbiddenName: name })
  }
  return count
}

const hasEntries = (value) => Boolean(value && typeof value === 'object' && Object.keys(value).length)
const inspectOutline = (items = []) => items.forEach((item) => {
  if (item?.url || item?.unsafeUrl) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_EXTERNAL_OUTLINE_NOT_ALLOWED')
  inspectOutline(item?.items || [])
})

const loadPdf = (buffer) => pdfjs.getDocument({
  data: new Uint8Array(Buffer.from(buffer)),
  disableFontFace: true,
  disableWorker: true,
  enableXfa: false,
  isEvalSupported: false,
  stopAtErrors: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  verbosity: pdfjs.VerbosityLevel.ERRORS,
}).promise

const findPdfLiteralProperties = (source, propertyName) => {
  const matches = []
  const pattern = new RegExp(`/${propertyName}\\s*\\(`, 'g')
  let match
  while ((match = pattern.exec(source)) !== null) {
    const payloadStart = pattern.lastIndex
    let depth = 1
    let escaped = false
    let cursor = payloadStart
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LITERAL_INVALID')
    matches.push({ payloadStart, payloadEnd: cursor, payload: source.slice(payloadStart, cursor) })
    pattern.lastIndex = cursor + 1
  }
  return matches
}

const normalizeChromiumPdfMetadataInternal = (buffer) => {
  if (!Buffer.isBuffer(buffer)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_OUTPUT_INVALID')
  const source = buffer.toString('latin1')
  const definitions = [
    { name: 'CreationDate', value: FIXED_PDF_DATE, validateBeforeLength: true, validate: (payload) => /^D:\d{14}[+-]\d{2}'\d{2}'$/.test(payload) },
    { name: 'ModDate', value: FIXED_PDF_DATE, validateBeforeLength: true, validate: (payload) => /^D:\d{14}[+-]\d{2}'\d{2}'$/.test(payload) },
    { name: 'Creator', value: SAFE_PDF_PROPERTY_VALUE, validate: (payload) => payload === EXPECTED_CHROMIUM_PDF_CREATOR },
    { name: 'Producer', value: SAFE_PDF_PROPERTY_VALUE, validate: (payload) => payload === EXPECTED_CHROMIUM_PDF_PRODUCER },
  ]
  const replacements = definitions.map((definition) => {
    const matches = findPdfLiteralProperties(source, definition.name)
    if (matches.length !== 1) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_SHAPE_INVALID', {
        propertyKey: definition.name.toUpperCase(),
        propertyCount: matches.length,
      })
    }
    const [literal] = matches
    if (definition.validateBeforeLength && !definition.validate(literal.payload)) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LITERAL_INVALID', {
        propertyKey: definition.name.toUpperCase(),
      })
    }
    if (Buffer.byteLength(literal.payload, 'latin1') < Buffer.byteLength(definition.value, 'ascii')) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LENGTH_INVALID', {
        propertyKey: definition.name.toUpperCase(),
      })
    }
    if (!definition.validateBeforeLength && !definition.validate(literal.payload)) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LITERAL_INVALID', {
        propertyKey: definition.name.toUpperCase(),
      })
    }
    return {
      ...literal,
      replacement: definition.value.padEnd(Buffer.byteLength(literal.payload, 'latin1'), ' '),
    }
  }).sort((left, right) => right.payloadStart - left.payloadStart)

  let normalized = source
  replacements.forEach(({ payloadStart, payloadEnd, payload, replacement }) => {
    if (Buffer.byteLength(payload, 'latin1') !== Buffer.byteLength(replacement, 'latin1')) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LENGTH_INVALID')
    }
    normalized = `${normalized.slice(0, payloadStart)}${replacement}${normalized.slice(payloadEnd)}`
  })
  if (Buffer.byteLength(normalized, 'latin1') !== buffer.length) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_LENGTH_INVALID')
  }
  const normalizedPropertyValues = ['Creator', 'Producer']
    .flatMap((propertyName) => findPdfLiteralProperties(normalized, propertyName).map(({ payload }) => payload))
    .join(' ')
    .toLowerCase()
  const diagnosticTerm = FORBIDDEN_PDF_PROPERTY_TERMS.find((term) => normalizedPropertyValues.includes(term))
  if (diagnosticTerm) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_DIAGNOSTIC_NOT_ALLOWED', {
      diagnosticTermKey: diagnosticTerm.replace(/[^a-z]/g, '_').toUpperCase(),
    })
  }
  return Object.freeze({
    buffer: Buffer.from(normalized, 'latin1'),
    replacementCount: replacements.length,
    dateReplacementCount: 2,
    identityReplacementCount: 2,
  })
}

export const normalizeChromiumPdfMetadata = (buffer) => {
  try {
    return normalizeChromiumPdfMetadataInternal(buffer)
  } catch (error) {
    if (error?.name === 'ProfessionalPresentationPdfCandidateError') throw error
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_NORMALIZATION_FAILED')
  }
}

const validateProfessionalPresentationPdfCandidateInternal = async (buffer, {
  expectedPageCount,
  loadPdfDocument = loadPdf,
} = {}) => {
  const limits = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.limits
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_OUTPUT_INVALID')
  if (buffer.length > limits.maxOutputBytes) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PDF_OUTPUT_LIMIT_EXCEEDED', { maxOutputBytes: limits.maxOutputBytes })
  if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount < 1 || expectedPageCount > limits.maxPages) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_EXPECTED_PAGE_COUNT_INVALID')
  }
  const raw = buffer.toString('latin1')
  if (!raw.startsWith('%PDF-')) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_HEADER_INVALID')
  if (!/\n%%EOF\s*$/.test(raw)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_EOF_INVALID')
  if (!/\nstartxref\s+\d+\s+%%EOF\s*$/.test(raw)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_STARTXREF_MISSING')
  if (!/(?:\nxref\s|\/Type\s*\/XRef\b)/.test(raw)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_XREF_MISSING')
  if (!/(?:\ntrailer\s*<<|\/Type\s*\/XRef\b)/.test(raw)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_TRAILER_MISSING')
  const parsedNameCount = inspectPdfNames(buffer)
  let document
  try {
    document = await loadPdfDocument(buffer)
    if (document.numPages !== expectedPageCount) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_COUNT_MISMATCH', { expectedPageCount, actualPageCount: document.numPages })
    const [attachments, jsActions, fields, calculations, openAction, hasJs, outline, markInfo, metadata] = await Promise.all([
      document.getAttachments(), document.getJSActions(), document.getFieldObjects(), document.getCalculationOrderIds(),
      document.getOpenAction(), document.hasJSActions(), document.getOutline(), document.getMarkInfo(), document.getMetadata(),
    ])
    if (hasEntries(attachments)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ATTACHMENTS_NOT_ALLOWED')
    if (hasEntries(jsActions) || hasJs) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_JAVASCRIPT_NOT_ALLOWED')
    if (hasEntries(fields) || (Array.isArray(calculations) && calculations.length)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_FORM_NOT_ALLOWED')
    if (openAction) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_OPEN_ACTION_NOT_ALLOWED')
    if (document.isPureXfa || document.allXfaHtml) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_XFA_NOT_ALLOWED')
    if (!markInfo?.Marked) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_MARKED_DOCUMENT_REQUIRED')
    const metadataInfo = metadata?.info || {}
    const metadataText = Object.values(metadataInfo).map((value) => String(value ?? '')).join(' ').toLowerCase()
    if (FORBIDDEN_PDF_PROPERTY_TERMS.some((term) => metadataText.includes(term))) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_DIAGNOSTIC_NOT_ALLOWED')
    }
    if (String(metadataInfo.Creator || '').trim() !== SAFE_PDF_PROPERTY_VALUE
      || String(metadataInfo.Producer || '').trim() !== SAFE_PDF_PROPERTY_VALUE
      || String(metadataInfo.CreationDate || '').trim() !== FIXED_PDF_DATE
      || String(metadataInfo.ModDate || '').trim() !== FIXED_PDF_DATE) {
      fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_VALUES_INVALID')
    }
    inspectOutline(outline || [])
    let structureTreePageCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const [actions, xfa, annotations, textContent, structureTree] = await Promise.all([
        page.getJSActions(), page.getXfa(), page.getAnnotations({ intent: 'display' }), page.getTextContent(), page.getStructTree(),
      ])
      if (hasEntries(actions)) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_ACTION_NOT_ALLOWED', { pageNumber })
      if (xfa) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_XFA_NOT_ALLOWED', { pageNumber })
      if (annotations?.length) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ANNOTATION_NOT_ALLOWED', { pageNumber })
      const pageText = textContent.items.map((item) => String(item?.str || '')).join(' ').replace(/\s+/g, ' ').trim()
      if (!pageText) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_BLANK_PAGE_NOT_ALLOWED', { pageNumber })
      if (!pageText.toLowerCase().includes(DISCLOSURE.toLowerCase())) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_DISCLOSURE_MISSING', { pageNumber })
      const [x1, y1, x2, y2] = page.view
      const width = Math.abs(x2 - x1)
      const height = Math.abs(y2 - y1)
      if (Math.abs(width - PAGE_WIDTH) > 0.1 || Math.abs(height - PAGE_HEIGHT) > 0.1) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_GEOMETRY_INVALID', { pageNumber, width, height })
      if (!structureTree?.children?.length) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_STRUCTURE_TREE_REQUIRED', { pageNumber })
      structureTreePageCount += 1
    }
    return Object.freeze({
      status: 'PASSED',
      pageCount: document.numPages,
      structureTreePageCount,
      parsedNameCount,
      annotationCount: 0,
      activeContentDetected: false,
      contentIncludedInValidation: false,
    })
  } catch (error) {
    if (error?.name === 'ProfessionalPresentationPdfCandidateError') throw error
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PARSE_FAILED')
  } finally {
    if (document) await document.destroy()
  }
}

export const validateProfessionalPresentationPdfCandidate = async (buffer, options = {}) => {
  if (!isPlainObject(options) || Object.keys(options).some((key) => key !== 'expectedPageCount')) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_VALIDATION_OPTIONS_INVALID')
  }
  try {
    return await validateProfessionalPresentationPdfCandidateInternal(buffer, options)
  } catch (error) {
    if (error?.name === 'ProfessionalPresentationPdfCandidateError') throw error
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PARSE_FAILED')
  }
}

const boundedClose = async (resource, closeMethod = 'close') => {
  try { await resource?.[closeMethod]?.() } catch { /* cleanup is best effort and source-free */ }
}

const renderWithDependencies = async (input, browserRuntime, dependencies = {}) => {
  if (!isPlainObject(dependencies)) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'CANDIDATE_DEPENDENCIES_INVALID')
  }
  const {
    chromiumApi = chromium,
    fingerprintInstallation = fingerprintChromiumInstallation,
    validateRuntime = validateBrowserRuntime,
    validatePdf = validateProfessionalPresentationPdfCandidate,
    workDeadlineMs = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.limits.workDeadlineMs,
    cleanupDeadlineMs = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.limits.cleanupDeadlineMs,
  } = dependencies
  let parsedInput
  try {
    parsedInput = parseProfessionalPresentationCandidateInput(input)
  } catch (error) {
    throw sanitizePresentationInputError(error)
  }
  const { presentation, chartCount } = parsedInput
  const html = compileProfessionalPresentationPdfCandidateHtml(presentation)
  let browser
  let context
  let page
  let timedOut = false
  let attemptedRequestCount = 0
  const startedAt = Date.now()
  const cleanup = async () => {
    await boundedClose(page)
    await boundedClose(context)
    await boundedClose(browser)
  }
  const ensureWithinDeadline = () => {
    if (timedOut) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.TIMEOUT, 'PDF_CANDIDATE_RENDER_TIMEOUT')
  }
  const timeoutError = createCandidateError({
    code: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.TIMEOUT,
    reason: 'PDF_CANDIDATE_RENDER_TIMEOUT',
  })
  let timeoutHandle
  const timeout = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      reject(timeoutError)
    }, workDeadlineMs)
  })
  const operation = (async () => {
    try {
      const installation = await validateRuntime(browserRuntime, fingerprintInstallation)
      ensureWithinDeadline()
      browser = await chromiumApi.launch({
      executablePath: browserRuntime.executablePath,
      headless: true,
      chromiumSandbox: true,
      timeout: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.limits.browserLaunchTimeoutMs,
    })
      ensureWithinDeadline()
      const launchedProductVersion = String(browser.version() || '').replace(/^HeadlessChrome\//, '').replace(/^Chrome\//, '')
      if (launchedProductVersion !== PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion) {
        fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_LAUNCHED_VERSION_MISMATCH')
      }
      context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
      offline: true,
    })
      ensureWithinDeadline()
      await context.route('**/*', async (route) => {
        attemptedRequestCount += 1
        await route.abort('blockedbyclient')
      })
      page = await context.newPage()
      ensureWithinDeadline()
      await page.setContent(html, { waitUntil: 'load' })
      const overflow = await page.locator('[data-bounded]').evaluateAll((elements) => elements
      .map((element, index) => ({
        index,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
      .filter((entry) => entry.scrollWidth > entry.clientWidth + 1 || entry.scrollHeight > entry.clientHeight + 1))
      const slideCount = await page.locator('[data-slide-index]').count()
      ensureWithinDeadline()
      if (attemptedRequestCount) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'BROWSER_REQUEST_NOT_ALLOWED', { attemptedRequestCount })
      if (slideCount !== presentation.slides.length) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'DOM_SLIDE_COUNT_MISMATCH')
      if (overflow.length) fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'DOM_OVERFLOW_DETECTED', { overflowCount: overflow.length })
      const rawBuffer = await page.pdf({
      width: '13.333333in',
      height: '7.5in',
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: false,
    })
      ensureWithinDeadline()
      const normalized = normalizeChromiumPdfMetadata(Buffer.from(rawBuffer))
      const validation = await validatePdf(normalized.buffer, { expectedPageCount: presentation.slides.length })
      ensureWithinDeadline()
      return Object.freeze({
        buffer: normalized.buffer,
        profile: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE,
        metrics: Object.freeze({
          outputBytes: normalized.buffer.length,
          pageCount: validation.pageCount,
          chartCount,
          renderTimeMs: Date.now() - startedAt,
          attemptedRequestCount,
          metadataReplacementCount: normalized.replacementCount,
          metadataDateReplacementCount: normalized.dateReplacementCount,
          metadataIdentityReplacementCount: normalized.identityReplacementCount,
          browserRevision: browserRuntime.revision,
          browserProductVersion: launchedProductVersion,
          browserInstallationFingerprint: installation.fingerprint,
          launchPolicyKey: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.launchPolicyKey,
          contentIncludedInMetrics: false,
        }),
        validation,
      })
    } finally {
      await cleanup()
    }
  })()
  try {
    return await Promise.race([operation, timeout])
  } catch (error) {
    let cleanupTimeoutHandle
    const cleanupTimeout = new Promise((resolve) => {
      cleanupTimeoutHandle = setTimeout(resolve, cleanupDeadlineMs)
    })
    await Promise.race([cleanup(), cleanupTimeout])
    clearTimeout(cleanupTimeoutHandle)
    operation.catch(() => undefined)
    if (error?.name === 'ProfessionalPresentationPdfCandidateError') throw error
    throw createCandidateError({
      code: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      reason: timedOut ? 'PDF_CANDIDATE_RENDER_TIMEOUT' : 'PDF_CANDIDATE_RENDER_FAILED',
    })
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export const renderProfessionalPresentationPdfCandidate = async (input = {}, options = {}) => {
  if (!isPlainObject(options)
    || Object.keys(options).some((key) => key !== 'browserRuntime')
    || !Object.prototype.hasOwnProperty.call(options, 'browserRuntime')) {
    fail(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_OPTIONS_INVALID')
  }
  return renderWithDependencies(input, options.browserRuntime)
}

export const __testables = Object.freeze({
  DISCLOSURE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SAFE_PDF_PROPERTY_VALUE,
  STYLE,
  compileProfessionalPresentationPdfCandidateHtml,
  escapeHtml,
  fingerprintChromiumInstallation,
  findPdfLiteralProperties,
  inspectPdfNames,
  normalizeChromiumPdfMetadataInternal,
  renderWithDependencies,
  validateProfessionalPresentationPdfCandidateInternal,
  validateBrowserRuntime,
})
