import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import { OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION } from './outcomeBoundaryReceiptService.js'

export const METHOD_DOCUMENT_CONTRACT = 'outcome-studio.method-document.v1'
export const MAX_METHOD_DOCUMENT_BYTES = 200000
export const MAX_METHOD_CONTEXT_BYTES = 192 * 1024
const CHUNK_CHARS = 8000
const BOUNDARIES = { ARL: 'GENERATION_CONTEXT', RL: 'POST_GENERATION_VALIDATION' }
const DOCUMENT_KEYS = ['contractVersion', 'role', 'boundary', 'source', 'chunks']
const SOURCE_KEYS = ['packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash', 'contentFormat']
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const hash = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const token = (value) => typeof value === 'string' && value.trim() && value.length <= 300
const reject = (field) => {
  throw Object.assign(new Error('The selected method document cannot be consumed safely.'), {
    status: 409, code: 'OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKED',
    reason: 'LIVE_COMPOSITION_METHOD_DOCUMENT_INVALID', details: { field },
  })
}
const assertText = (content) => {
  if (typeof content !== 'string' || !content.trim() || !content.isWellFormed()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)
    || Buffer.byteLength(content, 'utf8') > MAX_METHOD_DOCUMENT_BYTES
    || /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|redis):\/\/|\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [^-]*PRIVATE KEY-----|\bbearer\s+[A-Za-z0-9._~+\/-]{16,}|\b(?:api[_ -]?key|password|secret)\s*[:=]\s*["']?\S{8,}/i.test(content)) reject('methodDocument.content')
}

export const readOutcomeMethodDocument = (document) => document.chunks.map((chunk) => chunk.text).join('')

export const assertOutcomeMethodDocument = (document, { role, boundary } = {}) => {
  if (!exact(document, DOCUMENT_KEYS) || document.contractVersion !== METHOD_DOCUMENT_CONTRACT
    || !BOUNDARIES[document.role] || document.boundary !== BOUNDARIES[document.role]
    || (role && document.role !== role) || (boundary && document.boundary !== boundary)
    || !exact(document.source, SOURCE_KEYS) || !SOURCE_KEYS.every((key) => token(document.source[key]))
    || !['MARKDOWN', 'YAML', 'YML', 'JSON'].includes(document.source.contentFormat)
    || !Array.isArray(document.chunks) || !document.chunks.length || document.chunks.length > 64) reject('methodDocument.shape')
  let offset = 0
  document.chunks.forEach((chunk, index) => {
    if (!exact(chunk, ['index', 'start', 'end', 'text']) || chunk.index !== index
      || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end)
      || chunk.start !== offset || typeof chunk.text !== 'string' || !chunk.text.length
      || chunk.text.length > CHUNK_CHARS || !chunk.text.isWellFormed()
      || chunk.end !== chunk.start + chunk.text.length) reject('methodDocument.chunkCoverage')
    offset = chunk.end
  })
  const content = readOutcomeMethodDocument(document)
  assertText(content)
  if (hash(content) !== document.source.contentHash) reject('methodDocument.contentHash')
  return document
}

export const buildOutcomeMethodDocument = ({ role, selection, loaded } = {}) => {
  if (!BOUNDARIES[role] || !selection || !loaded?.available || selection.status !== 'ACTIVE'
    || loaded.status !== 'ACTIVE' || selection.packType !== role || !token(selection.activationId)
    || !token(selection.capabilityKey)) reject('methodDocument.selection')
  if ((selection.executionMode && !Object.values(KNOWLEDGE_PACK_EXECUTION_MODES).includes(selection.executionMode))
    || (selection.boundary && selection.boundary !== BOUNDARIES[role])
    || (selection.executionBoundary && selection.executionBoundary !== BOUNDARIES[role])
    || resolveKnowledgePackBoundary(selection) !== BOUNDARIES[role]
    || (selection.executionMode && resolveKnowledgePackBoundary({ packType: role, executionMode: selection.executionMode }) !== BOUNDARIES[role])) reject('methodDocument.boundary')
  for (const key of ['packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']) {
    if (!token(selection[key]) || selection[key] !== loaded[key]) reject(`methodDocument.${key}`)
  }
  if (selection.contentFormat && selection.contentFormat !== loaded.contentFormat) reject('methodDocument.contentFormat')
  const content = loaded.content
  assertText(content)
  if (hash(content) !== loaded.contentHash) reject('methodDocument.contentHash')
  if (loaded.contentFormat === 'MARKDOWN' && /^\uFEFF?---\r?\n/.test(content)) {
    const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!match) reject('methodDocument.frontmatter')
    let metadata
    try { metadata = parseYaml(match[1]) } catch { reject('methodDocument.frontmatter') }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || (metadata.packType && metadata.packType !== role)
      || (metadata.capabilityKey && metadata.capabilityKey !== selection.capabilityKey)
      || (metadata.knowledgeAssetId && metadata.knowledgeAssetId !== selection.knowledgeAssetId)
      || (metadata.executionMode && metadata.executionMode !== selection.executionMode)
      || (metadata.runtimeRole && ![role, 'GENERATION_REASONING'].includes(metadata.runtimeRole))
      || (metadata.sourceFormat && metadata.sourceFormat !== loaded.contentFormat)
      || ['scopeKey', 'scopeType', 'customerId', 'tenantId', 'runtimeInstanceId'].some((key) => metadata[key] != null && String(metadata[key]) !== String(selection[key] ?? ''))
      || (metadata.boundary && ![BOUNDARIES[role], 'FRAMEWORK_RUNTIME_REASONING'].includes(metadata.boundary))) reject('methodDocument.frontmatterIdentity')
  }
  const chunks = []
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + CHUNK_CHARS, content.length)
    if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1])) end -= 1
    chunks.push({ index: chunks.length, start, end, text: content.slice(start, end) })
    start = end
  }
  return assertOutcomeMethodDocument({
    contractVersion: METHOD_DOCUMENT_CONTRACT, role, boundary: BOUNDARIES[role],
    source: Object.fromEntries(SOURCE_KEYS.map((key) => [key, loaded[key]])), chunks,
  })
}

export const loadOutcomeMethodDocument = async ({ role, selection, loadPackContent } = {}) => {
  if (typeof loadPackContent !== 'function') reject('methodDocument.loader')
  const loaded = await loadPackContent({ packId: selection?.packId, versionId: selection?.versionId })
  return buildOutcomeMethodDocument({ role, selection, loaded })
}

export const projectOutcomeMethodDocumentReceipt = (document) => {
  assertOutcomeMethodDocument(document)
  const content = readOutcomeMethodDocument(document)
  return {
    contractVersion: METHOD_DOCUMENT_CONTRACT, role: document.role, boundary: document.boundary,
    ...document.source, characterCount: content.length, byteCount: Buffer.byteLength(content, 'utf8'),
    chunkCount: document.chunks.length,
  }
}

export const buildOutcomeMethodDocumentBoundaryReceipt = (documentReceipt, {
  evidenceReference = '',
} = {}) => {
  const receipt = documentReceipt?.source
    ? projectOutcomeMethodDocumentReceipt(documentReceipt)
    : documentReceipt
  const role = receipt?.role
  const boundary = BOUNDARIES[role]
  if (!receipt || role !== 'RL' || !boundary
    || receipt.boundary !== boundary
    || !token(receipt.packId)
    || !token(receipt.versionId)
    || !token(receipt.contentHash)
    || !Number.isSafeInteger(receipt.characterCount)
    || !Number.isSafeInteger(receipt.byteCount)
    || !Number.isSafeInteger(receipt.chunkCount)
    || receipt.chunkCount < 1) reject('methodDocument.receipt')
  return {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    packId: receipt.packId,
    versionId: receipt.versionId,
    contentHash: receipt.contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: `${role.toLowerCase()}-method-document.post-validation.v1`,
    validatorKey: 'outcome-method-document',
    result: 'PASS',
    evidenceReference: evidenceReference || `outcome:method-document:${role}:${receipt.versionId}`,
    status: 'PASSED',
    checks: [
      { key: 'BOUNDARY_DECLARED', status: 'PASSED', message: 'The method document declares the governed post-generation boundary.' },
      { key: 'VERSION_CONTENT_LOADED', status: 'PASSED', message: 'The complete canonical method document was loaded.' },
      { key: 'CONTENT_HASH_VERIFIED', status: 'PASSED', message: 'The complete method document content hash matches the selected version.' },
      { key: 'METHOD_DOCUMENT_CHUNK_COVERAGE_VERIFIED', status: 'PASSED', message: `All ${receipt.chunkCount} method document chunks cover ${receipt.characterCount} characters.` },
      { key: 'POST_VALIDATION_PASSED', status: 'PASSED', message: 'The method document passed its governed post-generation validation boundary.' },
      { key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED', message: 'The exact method document version receipt was recorded.' },
    ],
  }
}

export const assertOutcomeMethodContextBudget = (context) => {
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_METHOD_CONTEXT_BYTES) reject('methodDocument.contextBudget')
  return context
}
