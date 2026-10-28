import { createHash } from 'node:crypto'

export const SOURCE_CAPTURE_VERSION = 'source-capture.v1'
export const EVIDENCE_SUPPORT_VERSION = 'evidence-support.v1'
export const SOURCE_CAPTURE_RECEIPT_VERSION = 'source-capture-receipt.v1'
const HASH = /^sha256:[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const RESTRICTIONS = ['EXTRACTED_TEXT_COORDINATES_ONLY', 'SOURCE_ASSERTION_NOT_INDEPENDENTLY_VERIFIED']
const captureKeys = ['contractVersion', 'sourceId', 'originalContentHash', 'captureTextHash', 'textLength',
  'coordinateSystem', 'captureScope', 'adapter', 'extractionMethod', 'capturedAt', 'captureReceipt']
const supportKeys = ['contractVersion', 'sourceId', 'originalContentHash', 'captureTextHash', 'coordinateSystem',
  'start', 'end', 'exactExcerpt', 'excerptHash', 'statementOrigin', 'epistemicType', 'supportStatus', 'restrictions']
export const sourceEvidenceHash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const fail = () => { throw Object.assign(new Error('Recorded source evidence metadata is invalid.'), {
  code: 'SOURCE_EVIDENCE_CONTRACT_INVALID', status: 409,
}) }
const validUnicode = value => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail()
    } else if (code >= 0xdc00 && code <= 0xdfff) fail()
  }
}
const data = (value, depth = 0) => {
  if (depth > 6) fail()
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') { validUnicode(value); return }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); return }
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) fail()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length
      || Object.getOwnPropertyNames(value).length !== value.length + 1 || value.length > 100) fail()
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index) || !Object.hasOwn(descriptors[index], 'value')
        || descriptors[index].enumerable !== true) fail()
      data(descriptors[index].value, depth + 1)
    }
    return
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(descriptors).length > 100) fail()
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')) fail()
    data(descriptor.value, depth + 1)
  }
}
const exact = (value, keys, maxBytes) => {
  data(value)
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) fail()
}
const text = (value, limit) => {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > limit
    || Array.from(value).some(character => {
      const code = character.charCodeAt(0)
      return code < 32 || (code >= 127 && code <= 159)
    })) fail()
}
const hash = value => { if (typeof value !== 'string' || !HASH.test(value)) fail() }
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail() }
const field = (row, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(row, key)
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail()
  return descriptor?.value
}

export const validateSourceCapture = (value, options = {}) => {
  const { sourceId, contentHash } = options
  exact(value, captureKeys, 4096)
  if (value.contractVersion !== SOURCE_CAPTURE_VERSION || value.coordinateSystem !== 'UTF16_CODE_UNIT'
    || value.captureScope !== 'NORMALIZED_EXTRACTED_TEXT_ONLY') fail()
  text(value.sourceId, 240); hash(value.originalContentHash); hash(value.captureTextHash)
  integer(value.textLength, 1, 80000); text(value.adapter, 160); text(value.extractionMethod, 120)
  if (typeof value.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
    || !Number.isFinite(Date.parse(value.capturedAt)) || new Date(value.capturedAt).toISOString() !== value.capturedAt) fail()
  exact(value.captureReceipt, ['contractVersion', 'operation', 'status', 'runId', 'attemptId', 'inputIndex'], 1024)
  const receipt = value.captureReceipt
  if (receipt.contractVersion !== SOURCE_CAPTURE_RECEIPT_VERSION
    || !['DOCUMENT_TEXT_CAPTURE', 'WEBSITE_DECODED_TEXT_CAPTURE', 'CONTROLLED_HTML_REPLAY_CAPTURE'].includes(receipt.operation)
    || receipt.operation === 'WEBSITE_DECODED_TEXT_CAPTURE'
      && (value.adapter !== 'website-html-fetch-v1' || value.extractionMethod !== 'DECODED_HTML_STRIPPED_TEXT')
    || receipt.status !== 'SUCCEEDED') fail()
  if (receipt.operation === 'CONTROLLED_HTML_REPLAY_CAPTURE') {
    if (value.adapter !== 'controlled-html-replay-v1' || value.extractionMethod !== 'DECODED_HTML_STRIPPED_TEXT'
      || !UUID.test(receipt.runId) || !UUID.test(receipt.attemptId) || receipt.inputIndex !== 0) fail()
  } else if (receipt.runId !== null || receipt.attemptId !== null) fail()
  integer(receipt.inputIndex, 0, 4)
  if (sourceId !== undefined && sourceId !== value.sourceId
    || Object.hasOwn(options, 'contentHash') && contentHash !== value.originalContentHash) fail()
  return JSON.parse(JSON.stringify(value))
}

export const validateEvidenceSupport = (value, { sourceId, sourceCapture } = {}) => {
  exact(value, supportKeys, 8192)
  if (value.contractVersion !== EVIDENCE_SUPPORT_VERSION || value.coordinateSystem !== 'UTF16_CODE_UNIT'
    || value.statementOrigin !== 'DETERMINISTIC_EXTRACTOR_NORMALIZATION' || value.epistemicType !== 'SOURCE_ASSERTION'
    || value.supportStatus !== 'EXACT_CAPTURE_SPAN_VERIFIED'
    || JSON.stringify(value.restrictions) !== JSON.stringify(RESTRICTIONS)) fail()
  text(value.sourceId, 240); hash(value.originalContentHash); hash(value.captureTextHash); hash(value.excerptHash)
  integer(value.start, 0, 79999); integer(value.end, value.start + 1, 80000)
  if (typeof value.exactExcerpt !== 'string' || !value.exactExcerpt.trim()
    || value.exactExcerpt.length !== value.end - value.start
    || Buffer.byteLength(value.exactExcerpt, 'utf8') > 4096 || sourceEvidenceHash(value.exactExcerpt) !== value.excerptHash) fail()
  if (sourceId !== undefined && sourceId !== value.sourceId) fail()
  if (sourceCapture !== undefined) {
    const capture = validateSourceCapture(sourceCapture, { sourceId: value.sourceId })
    if (capture.originalContentHash !== value.originalContentHash || capture.captureTextHash !== value.captureTextHash
      || value.end > capture.textLength) fail()
  }
  return JSON.parse(JSON.stringify(value))
}

export const buildSourceCapture = ({ sourceId, originalContentHash, captureText, adapter, extractionMethod,
  capturedAt, inputIndex, runId = null, attemptId = null, operation = 'DOCUMENT_TEXT_CAPTURE' }) => validateSourceCapture({ contractVersion: SOURCE_CAPTURE_VERSION, sourceId,
  originalContentHash, captureTextHash: sourceEvidenceHash(captureText), textLength: captureText.length,
  coordinateSystem: 'UTF16_CODE_UNIT', captureScope: 'NORMALIZED_EXTRACTED_TEXT_ONLY', adapter,
  extractionMethod, capturedAt, captureReceipt: { contractVersion: SOURCE_CAPTURE_RECEIPT_VERSION,
    operation, status: 'SUCCEEDED', runId, attemptId, inputIndex } })

// Ambiguous or transformed segments cannot acquire an invented original location.
export const buildEvidenceSupport = ({ captureText, exactSegment, sourceCapture }) => {
  const capture = validateSourceCapture(sourceCapture)
  if (sourceEvidenceHash(captureText) !== capture.captureTextHash || captureText.length !== capture.textLength) fail()
  if (typeof exactSegment !== 'string' || !exactSegment.trim()) return undefined
  const start = captureText.indexOf(exactSegment)
  if (start < 0 || captureText.indexOf(exactSegment, start + 1) !== -1) return undefined
  const value = { contractVersion: EVIDENCE_SUPPORT_VERSION, sourceId: capture.sourceId,
    originalContentHash: capture.originalContentHash, captureTextHash: capture.captureTextHash,
    coordinateSystem: 'UTF16_CODE_UNIT', start, end: start + exactSegment.length, exactExcerpt: exactSegment,
    excerptHash: sourceEvidenceHash(exactSegment), statementOrigin: 'DETERMINISTIC_EXTRACTOR_NORMALIZATION',
    epistemicType: 'SOURCE_ASSERTION', supportStatus: 'EXACT_CAPTURE_SPAN_VERIFIED', restrictions: [...RESTRICTIONS] }
  if (captureText.slice(value.start, value.end) !== value.exactExcerpt) fail()
  return validateEvidenceSupport(value, { sourceCapture: capture })
}

/** Only actual owner rows establish a pair; missing envelopes remain absent. */
export const assertSourceEvidenceMetadataPairs = ({ sources = [], evidenceObjects = [] } = {}) => {
  if (!sources.some(row => field(row, 'sourceCapture') !== undefined)
    && !evidenceObjects.some(row => field(row, 'evidenceSupport') !== undefined)) return
  const captures = new Map()
  const ids = new Set()
  for (const source of sources) {
    const sourceId = field(source, 'sourceId')
    if (!sourceId || ids.has(sourceId)) fail()
    ids.add(sourceId)
    const capture = field(source, 'sourceCapture')
    if (capture !== undefined) {
      const contentHash = field(source, 'contentHash')
      hash(contentHash)
      captures.set(sourceId, validateSourceCapture(capture, { sourceId, contentHash }))
    }
  }
  for (const row of evidenceObjects) {
    const support = field(row, 'evidenceSupport')
    if (support === undefined) continue
    const sourceId = field(row, 'sourceId')
    if (!captures.has(sourceId)) fail()
    validateEvidenceSupport(support, { sourceId, sourceCapture: captures.get(sourceId) })
  }
}
