import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright-core'
import './professionalPresentationPdfCandidatePromiseCompatibility.js'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import { renderProfessionalInfographicSvgCandidate } from './professionalInfographicSvgCandidateRenderer.js'

const require = createRequire(import.meta.url)
const { SaxesParser } = require('saxes')

const GENERIC_MESSAGE = 'The professional infographic PDF engineering candidate could not complete this render.'
const FIXED_PDF_DATE = "D:20000101000000+00'00'"
const SAFE_PDF_PROPERTY_VALUE = 'StoryLineOS'
const EXPECTED_CHROMIUM_PDF_CREATOR = 'Mozilla/5.0 \\(Windows NT 10.0; Win64; x64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/148.0.0.0 Safari/537.36'
const EXPECTED_CHROMIUM_PDF_PRODUCER = 'Skia/PDF m148'
const FORBIDDEN_PDF_NAMES = Object.freeze([
  'AA',
  'ACROFORM',
  'EMBEDDEDFILE',
  'ENCRYPT',
  'FILESPEC',
  'GOTOR',
  'IMPORTDATA',
  'JAVASCRIPT',
  'JS',
  'LAUNCH',
  'OPENACTION',
  'RENDITION',
  'RICHMEDIA',
  'SUBMITFORM',
  'URI',
  'XFA',
])
const EXPECTED_METADATA_KEYS = Object.freeze([
  'CreationDate',
  'Creator',
  'EncryptFilterName',
  'IsAcroFormPresent',
  'IsCollectionPresent',
  'IsLinearized',
  'IsSignaturesPresent',
  'IsXFAPresent',
  'Language',
  'ModDate',
  'PDFFormatVersion',
  'Producer',
  'Title',
].sort())

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export const PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE = deepFreeze({
  profileKey: 'outcome-professional-infographic-pdf-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-007-v1.1-NOT-APPROVED',
  templateProfile: 'executive-decision-infographic-neutral.v0.1',
  engine: {
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
    buildFingerprint: 'professional-infographic-pdf-candidate:playwright-core:chromium-1223:0.1.0',
  },
  limits: {
    maxOutputBytes: 25_165_824,
    maxPages: 1,
    maxInstallationFiles: 500,
    maxInstallationBytes: 629_145_600,
    browserLaunchTimeoutMs: 10_000,
    workDeadlineMs: 15_000,
    cleanupDeadlineMs: 5_000,
    pageWidthPoints: 594.96,
    pageHeightPoints: 841.92,
    geometryTolerancePoints: 0.10,
  },
})

export const PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_INPUT_INVALID',
  RUNTIME_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_RUNTIME_INVALID',
  LIMIT_EXCEEDED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_VALIDATION_FAILED',
  TIMEOUT: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_TIMEOUT',
})

export class ProfessionalInfographicPdfCandidateError extends Error {
  constructor(code, reason) {
    super(GENERIC_MESSAGE)
    this.name = 'ProfessionalInfographicPdfCandidateError'
    this.code = code
    this.reason = reason
    this.details = Object.freeze({ reason, contentIncludedInError: false })
    this.stack = `${this.name}: ${this.message}`
  }
}

const fail = (code, reason) => {
  throw new ProfessionalInfographicPdfCandidateError(code, reason)
}

const isCandidateError = (error) => error?.name === 'ProfessionalInfographicPdfCandidateError'
const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
)
const sha256 = (value) => createHash('sha256').update(value).digest('hex').toLowerCase()
const normalizeText = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const extractModeledSvgText = (value) => {
  const source = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')
  const texts = []
  const titles = []
  let textDepth = 0
  let titleDepth = 0
  let textValue = ''
  let titleValue = ''
  try {
    const parser = new SaxesParser({ xmlns: true })
    parser.on('opentag', (node) => {
      if (node.local === 'text') {
        if (textDepth !== 0) fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
        textDepth = 1
        textValue = ''
      } else if (textDepth > 0) {
        textDepth += 1
      }
      if (node.local === 'title') {
        titleDepth = 1
        titleValue = ''
      } else if (titleDepth > 0) {
        titleDepth += 1
      }
    })
    parser.on('text', (text) => {
      if (textDepth > 0) textValue += text
      if (titleDepth > 0) titleValue += text
    })
    parser.on('closetag', (node) => {
      if (textDepth > 0) {
        textDepth -= 1
        if (textDepth === 0) {
          const normalized = normalizeText(textValue)
          if (!normalized) fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
          texts.push(normalized)
        }
      }
      if (titleDepth > 0) {
        titleDepth -= 1
        if (titleDepth === 0) titles.push(normalizeText(titleValue))
      }
      void node
    })
    parser.write(source).close()
  } catch (error) {
    if (isCandidateError(error)) throw error
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  if (titles.length !== 1 || !titles[0] || !texts.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  const joinedText = normalizeText(texts.join(' '))
  return deepFreeze({
    title: titles[0],
    texts,
    joinedText,
    nodeCount: texts.length,
    characters: joinedText.length,
  })
}

const compileHtml = (svg, title) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
html, body { width: 210mm; height: 297mm; margin: 0; padding: 0; overflow: hidden; background: #fff; }
[data-pdf-page] { width: 210mm; height: 297mm; overflow: hidden; background: #fff; display: flex; align-items: center; justify-content: center; }
svg { display: block; width: 100%; height: 100%; object-fit: contain; }
</style></head><body><main data-pdf-page data-bounded>${svg}</main></body></html>`

const sha256File = async (filePath) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

const fingerprintChromiumInstallation = async (executablePath, {
  lstatImpl = lstat,
  readdirImpl = readdir,
  sha256FileImpl = sha256File,
  maxFiles = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.maxInstallationFiles,
  maxBytes = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.maxInstallationBytes,
} = {}) => {
  const installationRoot = path.dirname(executablePath)
  let rootStat
  try {
    rootStat = await lstatImpl(installationRoot)
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
  }
  const rows = []
  let totalBytes = 0
  const walk = async (directory) => {
    let entries
    try {
      entries = await readdirImpl(directory, { withFileTypes: true })
    } catch {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      let stat
      try {
        stat = await lstatImpl(absolutePath)
      } catch {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
      }
      if (stat.isSymbolicLink()) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
      }
      if (stat.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!stat.isFile()) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
      }
      const relativePath = path.relative(installationRoot, absolutePath).split(path.sep).join('/')
      if (relativePath === 'debug.log') continue
      totalBytes += stat.size
      if (rows.length + 1 > maxFiles || totalBytes > maxBytes) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'BROWSER_INSTALLATION_LIMIT_EXCEEDED')
      }
      let fileSha256
      try {
        fileSha256 = await sha256FileImpl(absolutePath)
      } catch {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
      }
      rows.push({ relativePath, byteLength: stat.size, fileSha256: String(fileSha256).toLowerCase() })
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
    fingerprint: sha256(Buffer.from(manifest, 'utf8')),
    fileCount: rows.length,
    totalBytes,
  })
}

const readServerBrowserRuntime = () => {
  const executablePath = String(process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH || '').trim()
  if (!executablePath
    || !path.isAbsolute(executablePath)
    || path.basename(executablePath).toLowerCase() !== 'chrome.exe') {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_MISSING')
  }
  const engine = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine
  return Object.freeze({
    executablePath: path.resolve(executablePath),
    revision: engine.chromiumRevision,
    productVersion: engine.chromiumProductVersion,
    executableSha256: engine.executableSha256,
    installationFingerprint: engine.installationFingerprint,
  })
}

const validateBrowserRuntime = async (runtime, fingerprintInstallation = fingerprintChromiumInstallation, {
  lstatImpl = lstat,
  sha256FileImpl = sha256File,
} = {}) => {
  if (!isPlainObject(runtime)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_MISSING')
  }
  const expectedKeys = ['executablePath', 'executableSha256', 'installationFingerprint', 'productVersion', 'revision'].sort()
  const keys = Object.keys(runtime).sort()
  const engine = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || typeof runtime.executablePath !== 'string'
    || !path.isAbsolute(runtime.executablePath)
    || path.basename(runtime.executablePath).toLowerCase() !== 'chrome.exe'
    || runtime.revision !== engine.chromiumRevision
    || runtime.productVersion !== engine.chromiumProductVersion
    || runtime.executableSha256 !== engine.executableSha256
    || runtime.installationFingerprint !== engine.installationFingerprint) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
  }
  try {
    const executableStat = await lstatImpl(runtime.executablePath)
    if (executableStat.isSymbolicLink()
      || !executableStat.isFile()
      || executableStat.size !== engine.executableBytes
      || await sha256FileImpl(runtime.executablePath) !== engine.executableSha256) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
    }
    const installation = await fingerprintInstallation(runtime.executablePath)
    if (installation.fingerprint !== engine.installationFingerprint
      || installation.fileCount !== engine.installationFileCount
      || installation.totalBytes !== engine.installationBytes) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
    }
    return installation
  } catch (error) {
    if (isCandidateError(error)) throw error
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_IDENTITY_MISMATCH')
  }
}

const decodePdfName = (value) => String(value ?? '')
  .replace(/#([0-9a-f]{2})/gi, (_match, encoded) => String.fromCharCode(Number.parseInt(encoded, 16)))
  .toUpperCase()

const collectPdfNames = (buffer) => {
  const source = buffer.toString('latin1').replace(/%[^\r\n]*/g, ' ')
  const names = []
  const pattern = /\/([^\x00\x09\x0a\x0c\x0d ()<>\[\]{}/%]+)/g
  let match
  while ((match = pattern.exec(source)) !== null) names.push(decodePdfName(match[1]))
  return names
}

const inspectPdfNames = (buffer) => {
  const names = collectPdfNames(buffer)
  const forbidden = names.find((name) => FORBIDDEN_PDF_NAMES.includes(name))
  if (forbidden) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ACTIVE_NAME_NOT_ALLOWED')
  }
  return names.length
}

const findPdfLiteralProperties = (source, propertyName) => {
  const matches = []
  const pattern = new RegExp(`/${propertyName}\\s*\\(`, 'g')
  let match
  while ((match = pattern.exec(source)) !== null) {
    const payloadStart = pattern.lastIndex
    let cursor = payloadStart
    let depth = 1
    let escaped = false
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '(') {
        depth += 1
      } else if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_SOURCE_INVALID')
    }
    matches.push({ payloadStart, payloadEnd: cursor, payload: source.slice(payloadStart, cursor) })
    pattern.lastIndex = cursor + 1
  }
  return matches
}

const normalizeChromiumPdfMetadataInternal = (buffer) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_SOURCE_INVALID')
  }
  const source = buffer.toString('latin1')
  const definitions = [
    { name: 'CreationDate', replacement: FIXED_PDF_DATE, validate: (value) => /^D:\d{14}[+-]\d{2}'\d{2}'$/.test(value) },
    { name: 'ModDate', replacement: FIXED_PDF_DATE, validate: (value) => /^D:\d{14}[+-]\d{2}'\d{2}'$/.test(value) },
    { name: 'Creator', replacement: SAFE_PDF_PROPERTY_VALUE, validate: (value) => value === EXPECTED_CHROMIUM_PDF_CREATOR },
    { name: 'Producer', replacement: SAFE_PDF_PROPERTY_VALUE, validate: (value) => value === EXPECTED_CHROMIUM_PDF_PRODUCER },
  ]
  const replacements = definitions.map((definition) => {
    const matches = findPdfLiteralProperties(source, definition.name)
    if (matches.length !== 1 || !definition.validate(matches[0]?.payload)) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_SOURCE_INVALID')
    }
    const literal = matches[0]
    if (Buffer.byteLength(literal.payload, 'latin1') < Buffer.byteLength(definition.replacement, 'ascii')) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_SOURCE_INVALID')
    }
    return {
      ...literal,
      replacement: definition.replacement.padEnd(Buffer.byteLength(literal.payload, 'latin1'), ' '),
    }
  }).sort((left, right) => right.payloadStart - left.payloadStart)
  let normalized = source
  replacements.forEach(({ payloadStart, payloadEnd, payload, replacement }) => {
    if (Buffer.byteLength(payload, 'latin1') !== Buffer.byteLength(replacement, 'latin1')) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_NORMALIZATION_FAILED')
    }
    normalized = `${normalized.slice(0, payloadStart)}${replacement}${normalized.slice(payloadEnd)}`
  })
  if (Buffer.byteLength(normalized, 'latin1') !== buffer.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_NORMALIZATION_FAILED')
  }
  return Object.freeze({
    buffer: Buffer.from(normalized, 'latin1'),
    replacementCount: replacements.length,
  })
}

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

const hasEntries = (value) => Boolean(value && typeof value === 'object' && Object.keys(value).length)
const hasOutlineEntries = (value) => Array.isArray(value) && value.length > 0

const validatePdfInternal = async (buffer, {
  expectedTitle,
  expectedText,
  modeledTextNodeCount,
  modeledTextCharacters,
  loadPdfDocument = loadPdf,
} = {}) => {
  const limits = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_HEADER_INVALID')
  }
  if (buffer.length > limits.maxOutputBytes) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PDF_OUTPUT_LIMIT_EXCEEDED')
  }
  const raw = buffer.toString('latin1')
  if (!raw.startsWith('%PDF-')) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_HEADER_INVALID')
  }
  if (!/%%EOF\s*$/.test(raw)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_EOF_INVALID')
  }
  if (!/(?:\nxref\s|\/Type\s*\/XRef\b)/.test(raw)
    || !/(?:\ntrailer\s*<<|\/Type\s*\/XRef\b)/.test(raw)
    || !/\nstartxref\s+\d+\s+%%EOF\s*$/.test(raw)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_CROSS_REFERENCE_INVALID')
  }
  const names = collectPdfNames(buffer)
  if (names.includes('ENCRYPT')) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ENCRYPTION_NOT_ALLOWED')
  }
  if (names.includes('EMBEDDEDFILE') || names.includes('FILESPEC')) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ATTACHMENTS_NOT_ALLOWED')
  }
  let document
  let primaryError
  let validation
  try {
    document = await loadPdfDocument(buffer)
    if (document.numPages !== 1) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_COUNT_MISMATCH')
    }
    const attachments = await document.getAttachments()
    if (hasEntries(attachments)) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ATTACHMENTS_NOT_ALLOWED')
    }
    const documentJs = await document.getJSActions()
    if (hasEntries(documentJs) || await document.hasJSActions()) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_JAVASCRIPT_NOT_ALLOWED')
    }
    const fields = await document.getFieldObjects()
    if (hasEntries(fields)) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_FORM_NOT_ALLOWED')
    }
    const calculations = await document.getCalculationOrderIds()
    if (Array.isArray(calculations) && calculations.length) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_FORM_NOT_ALLOWED')
    }
    const openAction = await document.getOpenAction()
    if (openAction) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ACTION_NOT_ALLOWED')
    }
    if (document.isPureXfa || document.allXfaHtml) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_FORM_NOT_ALLOWED')
    }
    const markInfo = await document.getMarkInfo()
    if (!markInfo?.Marked) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_MARKED_DOCUMENT_REQUIRED')
    }
    const metadata = await document.getMetadata()
    const metadataInfo = metadata?.info || {}
    const metadataKeys = Object.keys(metadataInfo).sort()
    if (metadataKeys.length !== EXPECTED_METADATA_KEYS.length
      || metadataKeys.some((key, index) => key !== EXPECTED_METADATA_KEYS[index])) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_VALUES_INVALID')
    }
    if (metadataInfo.PDFFormatVersion !== '1.4'
      || metadataInfo.Language !== 'en'
      || metadataInfo.EncryptFilterName !== null
      || metadataInfo.IsLinearized !== false
      || metadataInfo.IsAcroFormPresent !== false
      || metadataInfo.IsXFAPresent !== false
      || metadataInfo.IsCollectionPresent !== false
      || metadataInfo.IsSignaturesPresent !== false
      || String(metadataInfo.CreationDate).trim() !== FIXED_PDF_DATE
      || String(metadataInfo.ModDate).trim() !== FIXED_PDF_DATE
      || String(metadataInfo.Creator).trim() !== SAFE_PDF_PROPERTY_VALUE
      || String(metadataInfo.Producer).trim() !== SAFE_PDF_PROPERTY_VALUE
      || normalizeText(metadataInfo.Title) !== expectedTitle) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_VALUES_INVALID')
    }
    if (hasOutlineEntries(await document.getOutline())) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_OUTLINE_NOT_ALLOWED')
    }

    const page = await document.getPage(1)
    if (hasEntries(await page.getJSActions())) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ACTION_NOT_ALLOWED')
    }
    if (await page.getXfa()) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_FORM_NOT_ALLOWED')
    }
    const annotations = await page.getAnnotations({ intent: 'display' })
    if (annotations?.length) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_ANNOTATION_NOT_ALLOWED')
    }
    const textContent = await page.getTextContent()
    const extractedText = normalizeText(textContent.items
      .map((item) => normalizeText(item?.str))
      .filter(Boolean)
      .join(' '))
    if (!extractedText) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_BLANK_PAGE_NOT_ALLOWED')
    }
    if (extractedText !== expectedText) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_MODELED_TEXT_MISMATCH')
    }
    const [x1, y1, x2, y2] = page.view
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (Math.abs(width - limits.pageWidthPoints) > limits.geometryTolerancePoints
      || Math.abs(height - limits.pageHeightPoints) > limits.geometryTolerancePoints) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_PAGE_GEOMETRY_INVALID')
    }
    const structureTree = await page.getStructTree()
    if (!structureTree?.children?.length) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_STRUCTURE_TREE_REQUIRED')
    }
    inspectPdfNames(buffer)
    validation = deepFreeze({
      status: 'PASSED',
      pageCount: 1,
      widthPoints: limits.pageWidthPoints,
      heightPoints: limits.pageHeightPoints,
      structureTreePageCount: 1,
      modeledTextNodeCount,
      modeledTextCharacters,
      annotationCount: 0,
      activeContentDetected: false,
      metadataKeyCount: EXPECTED_METADATA_KEYS.length,
      contentIncludedInValidation: false,
    })
  } catch (error) {
    primaryError = isCandidateError(error)
      ? error
      : new ProfessionalInfographicPdfCandidateError(
        PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
        'PDF_PARSE_FAILED',
      )
  } finally {
    if (document) {
      try {
        await document.destroy()
      } catch {
        if (!primaryError) {
          primaryError = new ProfessionalInfographicPdfCandidateError(
            PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
            'PDF_PARSE_FAILED',
          )
        }
      }
    }
  }
  if (primaryError) throw primaryError
  return validation
}

const closeResources = async (page, context, browser) => {
  let firstError
  for (const resource of [page, context, browser]) {
    try {
      await resource?.close?.()
    } catch (error) {
      firstError ||= error
    }
  }
  return firstError
}

const renderWithDependencies = async (input, dependencies = {}) => {
  if (!isPlainObject(dependencies)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'PDF_CANDIDATE_RENDER_FAILED')
  }
  const {
    chromiumApi = chromium,
    renderSvg = renderProfessionalInfographicSvgCandidate,
    readRuntime = readServerBrowserRuntime,
    fingerprintInstallation = fingerprintChromiumInstallation,
    validateRuntime = validateBrowserRuntime,
    normalizePdf = normalizeChromiumPdfMetadataInternal,
    validatePdf = validatePdfInternal,
    workDeadlineMs = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.workDeadlineMs,
    cleanupDeadlineMs = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.cleanupDeadlineMs,
  } = dependencies

  let source
  try {
    source = renderSvg(input)
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  if (!source || !Buffer.isBuffer(source.buffer)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  let modeled
  try {
    modeled = extractModeledSvgText(source.buffer)
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  const html = compileHtml(source.buffer.toString('utf8'), modeled.title)
  const sourceSvgChecksum = sha256(source.buffer)
  let runtime
  try {
    runtime = readRuntime()
  } catch (error) {
    if (isCandidateError(error)) throw error
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_RUNTIME_MISSING')
  }

  let browser
  let context
  let page
  let timedOut = false
  let attemptedRequestCount = 0
  const timeoutError = new ProfessionalInfographicPdfCandidateError(
    PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.TIMEOUT,
    'PDF_CANDIDATE_RENDER_TIMEOUT',
  )
  let timeoutHandle
  const timeout = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      reject(timeoutError)
    }, workDeadlineMs)
  })
  const operation = (async () => {
    let primaryError
    let result
    try {
      const installation = await validateRuntime(runtime, fingerprintInstallation)
      browser = await chromiumApi.launch({
        executablePath: runtime.executablePath,
        headless: true,
        chromiumSandbox: true,
        timeout: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.browserLaunchTimeoutMs,
      })
      const launchedProductVersion = String(browser.version() || '')
        .replace(/^HeadlessChrome\//, '')
        .replace(/^Chrome\//, '')
      if (launchedProductVersion !== PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID, 'BROWSER_LAUNCHED_VERSION_MISMATCH')
      }
      context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
        acceptDownloads: false,
        permissions: [],
        offline: true,
      })
      await context.route('**/*', async (route) => {
        attemptedRequestCount += 1
        await route.abort('blockedbyclient')
      })
      page = await context.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      if (attemptedRequestCount) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'BROWSER_REQUEST_NOT_ALLOWED')
      }
      const pageCount = await page.locator('[data-pdf-page]').count()
      if (pageCount !== 1) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'DOM_PAGE_COUNT_MISMATCH')
      }
      const overflow = await page.locator('[data-bounded]').evaluateAll((elements) => elements
        .map((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }))
        .filter((entry) => entry.scrollWidth > entry.clientWidth + 1
          || entry.scrollHeight > entry.clientHeight + 1))
      if (overflow.length) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'DOM_OVERFLOW_DETECTED')
      }
      let rawBuffer
      try {
        rawBuffer = Buffer.from(await page.pdf({
          width: '210mm',
          height: '297mm',
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          printBackground: true,
          preferCSSPageSize: true,
          tagged: true,
          outline: false,
        }))
      } catch {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'PDF_CANDIDATE_RENDER_FAILED')
      }
      if (rawBuffer.length > PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes) {
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PDF_OUTPUT_LIMIT_EXCEEDED')
      }
      let normalized
      try {
        normalized = normalizePdf(rawBuffer)
      } catch (error) {
        if (isCandidateError(error)) throw error
        fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PDF_METADATA_NORMALIZATION_FAILED')
      }
      const validation = await validatePdf(normalized.buffer, {
        expectedTitle: modeled.title,
        expectedText: modeled.joinedText,
        modeledTextNodeCount: modeled.nodeCount,
        modeledTextCharacters: modeled.characters,
      })
      const ownedBuffer = Buffer.from(normalized.buffer)
      const metrics = deepFreeze({
        outputBytes: ownedBuffer.length,
        pageCount: 1,
        modeledTextNodeCount: modeled.nodeCount,
        modeledTextCharacters: modeled.characters,
        attemptedRequestCount: 0,
        metadataReplacementCount: normalized.replacementCount,
        browserRevision: runtime.revision,
        browserProductVersion: launchedProductVersion,
        browserInstallationFingerprint: installation.fingerprint,
        launchPolicyKey: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.launchPolicyKey,
        contentIncludedInMetrics: false,
      })
      result = Object.freeze({
        format: 'PDF',
        mimeType: 'application/pdf',
        extension: 'pdf',
        buffer: ownedBuffer,
        checksum: sha256(ownedBuffer),
        pageCount: 1,
        profile: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE,
        sourceSvgChecksum,
        metrics,
        validation,
      })
    } catch (error) {
      primaryError = isCandidateError(error)
        ? error
        : new ProfessionalInfographicPdfCandidateError(
          PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
          'PDF_CANDIDATE_RENDER_FAILED',
        )
    }
    const cleanupError = await closeResources(page, context, browser)
    if (primaryError) throw primaryError
    if (cleanupError) {
      fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'PDF_CANDIDATE_CLEANUP_FAILED')
    }
    return result
  })()

  try {
    return await Promise.race([operation, timeout])
  } catch (error) {
    if (timedOut) {
      let cleanupTimeoutHandle
      const cleanupTimeout = new Promise((resolve) => {
        cleanupTimeoutHandle = setTimeout(resolve, cleanupDeadlineMs)
      })
      await Promise.race([closeResources(page, context, browser), cleanupTimeout])
      clearTimeout(cleanupTimeoutHandle)
      operation.catch(() => undefined)
      throw timeoutError
    }
    if (isCandidateError(error)) throw error
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'PDF_CANDIDATE_RENDER_FAILED')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export async function renderProfessionalInfographicPdfCandidate(input = {}) {
  if (arguments.length !== 1) {
    fail(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'CANDIDATE_ARGUMENTS_INVALID')
  }
  return renderWithDependencies(input)
}

export const __testables = Object.freeze({
  GENERIC_MESSAGE,
  FIXED_PDF_DATE,
  SAFE_PDF_PROPERTY_VALUE,
  EXPECTED_CHROMIUM_PDF_CREATOR,
  EXPECTED_CHROMIUM_PDF_PRODUCER,
  FORBIDDEN_PDF_NAMES,
  compileHtml,
  extractModeledSvgText,
  fingerprintChromiumInstallation,
  inspectPdfNames,
  normalizeChromiumPdfMetadataInternal,
  renderWithDependencies,
  validateBrowserRuntime,
  validatePdfInternal,
  readServerBrowserRuntime,
})
