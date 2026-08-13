import { createHash, randomUUID } from 'node:crypto'

import { parseDocument } from 'yaml'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  validateOutcomeBoundaryReceipt,
} from './outcomeBoundaryReceiptService.js'
import { validateOutcomeCustomerLanguage } from './outcomeCustomerLanguageService.js'

export const RENDERING_LAYER_EXECUTOR_CONTRACT_VERSION = 'outcome-studio.rendering-layer-executor.v1'
export const RENDERING_LAYER_EXECUTOR_KEY = 'rendering-layer'
export const RENDERING_LAYER_RECEIPT_KEY = 'rendering-layer.post-validation.v1'

const EXECUTOR_STATUSES = Object.freeze({ PASSED: 'PASSED', FAILED: 'FAILED', NOT_RECORDED: 'NOT_RECORDED' })
const EXECUTOR_RESULTS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' })
const REQUIRED_MUST_INCLUDE = Object.freeze([
  'evidence boundaries',
  'known limitations',
  'truth signature reference',
  'runtime revision reference',
  'lineage summary',
])
const REQUIRED_MUST_NOT = Object.freeze([
  'expose hidden_from_customer material',
  'quote raw source files',
  'reveal ARL or RL internal notes',
  'create new facts',
  'remove safety warnings',
])
const REQUIRED_CUSTOMER_SECTIONS = Object.freeze([
  'response_summary',
  'governed_answer',
  'evidence_boundaries',
  'limitations',
  'lineage_summary',
])
const REQUIRED_PROHIBITIONS = Object.freeze([
  'no_internal_reasoning',
  'hidden prompt assembly',
  'raw graph internals',
  'unsupported ROI',
  'unsupported customer proof',
])
const PROHIBITED_CUSTOMER_PATTERNS = Object.freeze([
  /\bhidden[_\s-]*from[_\s-]*customer\b/i,
  /\b(?:arl|rl)\s+internal\s+notes?\b/i,
  /\bhidden\s+prompt\s+assembly\b/i,
  /\braw\s+graph\s+internals?\b/i,
  /\binternal\s+(?:chain\s+of\s+)?reasoning\b/i,
  /\bunsupported\s+(?:roi|return\s+on\s+investment)\b/i,
  /\bunsupported\s+customer\s+proof\b/i,
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeRule = (value) => normalizeText(value).toLowerCase()
const isPlainObject = (value) => {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const uniqueNormalized = (values) => Array.isArray(values)
  ? [...new Set(values.map(normalizeRule).filter(Boolean))]
  : []
const containsAll = (actual, expected) => expected.every((value) => actual.includes(normalizeRule(value)))

const collectCustomerText = (customerContent = {}) => {
  if (typeof customerContent === 'string') return normalizeText(customerContent)
  if (!isPlainObject(customerContent)) return ''
  const sections = Array.isArray(customerContent.sections)
    ? customerContent.sections.flatMap((section) => [section?.label, section?.heading, section?.body])
    : []
  return [customerContent.title, customerContent.markdown, ...sections]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n')
}

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: RENDERING_LAYER_EXECUTOR_KEY,
})

const buildBlockedResult = ({ status = EXECUTOR_STATUSES.FAILED, checks = [], failures = [], executionId } = {}) => ({
  contractVersion: RENDERING_LAYER_EXECUTOR_CONTRACT_VERSION,
  executorKey: RENDERING_LAYER_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

export const parseRenderingLayerYaml = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, document: null, failures: ['PACK_CONTENT_NOT_AVAILABLE'] }
  }
  try {
    const parsed = parseDocument(packContent, {
      schema: 'core',
      customTags: [],
      uniqueKeys: true,
      maxAliasCount: 0,
      prettyErrors: false,
    })
    if (parsed.errors.length > 0) return { valid: false, document: null, failures: ['RENDERING_LAYER_YAML_INVALID'] }
    const document = parsed.toJS({ maxAliasCount: 0 })
    if (!isPlainObject(document)) return { valid: false, document: null, failures: ['RENDERING_LAYER_YAML_INVALID'] }

    const mustInclude = uniqueNormalized(document.rendering_rules?.must_include)
    const mustNot = uniqueNormalized(document.rendering_rules?.must_not)
    const sections = uniqueNormalized(document.customer_safe_output?.sections)
    const prohibited = uniqueNormalized(document.customer_safe_output?.prohibited)
    const formats = document.export_rules
    const rulesValid = containsAll(mustInclude, REQUIRED_MUST_INCLUDE)
      && containsAll(mustNot, REQUIRED_MUST_NOT)
      && containsAll(sections, REQUIRED_CUSTOMER_SECTIONS)
      && containsAll(prohibited, REQUIRED_PROHIBITIONS)
    const exportPolicyValid = isPlainObject(formats)
      && formats.MARKDOWN?.allowed === true
      && formats.MARKDOWN?.customer_content_only === true
      && formats.JSON?.allowed === true
      && formats.JSON?.customer_content_only === true
      && formats.DOCX?.allowed === false
      && normalizeToken(formats.DOCX?.blocker) === 'SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED'
      && formats.PDF?.allowed === false
      && normalizeToken(formats.PDF?.blocker) === 'SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED'
    const failures = [
      ...(rulesValid ? [] : ['RENDERING_LAYER_RULES_INVALID']),
      ...(exportPolicyValid ? [] : ['RENDERING_LAYER_EXPORT_POLICY_INVALID']),
    ]
    return { valid: failures.length === 0, document, failures, rulesValid, exportPolicyValid }
  } catch (_error) {
    return { valid: false, document: null, failures: ['RENDERING_LAYER_YAML_INVALID'] }
  }
}

export const executeRenderingLayerPack = ({
  pack = {},
  packContent = '',
  customerContent = {},
  evidenceBoundaries = [],
  limitations = [],
  lineageSummary = {},
  truthSignatureReference = '',
  truthSignature = {},
  runtimeRevisionReference = '',
  outputFormat = 'MARKDOWN',
  asset = {},
  version = {},
  executionId = `rendering_layer_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeRule(pack.packKey || pack.key)
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const boundary = resolveKnowledgePackBoundary(pack)
  const identityPass = packKey === RENDERING_LAYER_EXECUTOR_KEY
    && Boolean(versionId && contentHash && assetId && assetVersionId)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
  checks.push(buildCheck({ key: 'PACK_IDENTITY_BOUND', pass: identityPass, message: identityPass ? 'Exact rendering-layer pack, asset, version, and post-validation boundary are bound.' : 'Exact rendering-layer pack, asset, version, and post-validation boundary are required.' }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({ key: 'VERSION_CONTENT_LOADED', pass: contentLoaded, message: contentLoaded ? 'Raw server-side Knowledge Pack version content was loaded.' : 'Raw Knowledge Pack version content was not available.' }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(contentHash) && sha256(packContent) === contentHash
  checks.push(buildCheck({ key: 'PACK_CONTENT_HASH_VERIFIED', pass: hashPass, message: hashPass ? 'Registry-loaded pack content matches the bound content hash.' : 'Registry-loaded pack content does not match the bound content hash.' }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseRenderingLayerYaml(packContent)
  checks.push(buildCheck({ key: 'RENDERING_RULES_LOADED', pass: parsed.rulesValid === true, message: parsed.rulesValid ? 'All source-defined rendering and customer-safe output rules were loaded.' : 'The persisted YAML does not contain the complete rendering rule contract.' }))
  checks.push(buildCheck({ key: 'EXPORT_POLICY_PRESERVED', pass: parsed.exportPolicyValid === true, message: parsed.exportPolicyValid ? 'MARKDOWN and JSON remain customer-content-only; DOCX and PDF remain blocked.' : 'The persisted YAML export policy is incomplete or unsafe.' }))
  failures.push(...parsed.failures)
  if (failures.length > 0) return buildBlockedResult({ status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const customerText = collectCustomerText(customerContent)
  const customerContentPass = Boolean(customerText)
  checks.push(buildCheck({ key: 'CUSTOMER_CONTENT_AVAILABLE', pass: customerContentPass, message: customerContentPass ? 'Customer content is available for rendering validation.' : 'Customer content is required for rendering validation.' }))
  if (!customerContentPass) failures.push('CUSTOMER_CONTENT_NOT_AVAILABLE')

  const customerLanguage = validateOutcomeCustomerLanguage(customerContent)
  const prohibitedMatches = PROHIBITED_CUSTOMER_PATTERNS.filter((pattern) => pattern.test(customerText))
  const customerSafe = customerLanguage.safe && prohibitedMatches.length === 0
  checks.push(buildCheck({ key: 'CUSTOMER_SAFE_OUTPUT', pass: customerSafe, message: customerSafe ? 'Customer content contains no internal rendering or governance leakage.' : 'Customer content contains prohibited internal rendering or governance language.' }))
  if (!customerSafe) failures.push('CUSTOMER_OUTPUT_NOT_SAFE')

  const evidenceBoundariesPass = Array.isArray(evidenceBoundaries) && evidenceBoundaries.some((value) => normalizeText(value))
  checks.push(buildCheck({ key: 'EVIDENCE_BOUNDARIES_PRESENT', pass: evidenceBoundariesPass, message: evidenceBoundariesPass ? 'Evidence boundaries are retained outside customer content.' : 'Evidence boundaries are required.' }))
  if (!evidenceBoundariesPass) failures.push('EVIDENCE_BOUNDARIES_MISSING')

  const limitationsPass = Array.isArray(limitations) && limitations.some((value) => normalizeText(value))
  checks.push(buildCheck({ key: 'KNOWN_LIMITATIONS_PRESENT', pass: limitationsPass, message: limitationsPass ? 'Known limitations are retained outside customer content.' : 'Known limitations are required.' }))
  if (!limitationsPass) failures.push('KNOWN_LIMITATIONS_MISSING')

  const lineagePass = isPlainObject(lineageSummary)
    && Boolean(normalizeText(lineageSummary.sourceOutputAssetId))
    && Boolean(normalizeText(lineageSummary.generatedAt))
    && Boolean(normalizeText(lineageSummary.grrExecutionId))
    && Boolean(normalizeText(lineageSummary.grrRuntimeArtifactId))
  checks.push(buildCheck({ key: 'LINEAGE_SUMMARY_PRESENT', pass: lineagePass, message: lineagePass ? 'Source, generation, and governed execution lineage are retained outside customer content.' : 'Complete source and governed execution lineage is required.' }))
  if (!lineagePass) failures.push('LINEAGE_SUMMARY_MISSING')

  const truthReferencePass = Boolean(normalizeText(truthSignatureReference))
    && normalizeToken(truthSignature?.status) === 'PROJECTED'
    && normalizeToken(truthSignature?.currentness) === 'CURRENT'
  checks.push(buildCheck({ key: 'TRUTH_SIGNATURE_REFERENCE_CURRENT', pass: truthReferencePass, message: truthReferencePass ? 'The current projected truth signature is referenced outside customer content.' : 'A current projected truth signature reference is required.' }))
  if (!truthReferencePass) failures.push('TRUTH_SIGNATURE_REFERENCE_INVALID')

  const revisionReference = normalizeText(runtimeRevisionReference)
  const numericRevisionCandidate = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+|Infinity|NaN)$/i.test(revisionReference)
  const revisionNumber = Number(revisionReference)
  const revisionPass = Boolean(revisionReference)
    && (!numericRevisionCandidate
      || (/^\d+$/.test(revisionReference) && Number.isSafeInteger(revisionNumber) && revisionNumber > 0))
  checks.push(buildCheck({ key: 'RUNTIME_REVISION_REFERENCE_PRESENT', pass: revisionPass, message: revisionPass ? 'The exact runtime revision is referenced outside customer content.' : 'A runtime revision id or positive revision number is required.' }))
  if (!revisionPass) failures.push('RUNTIME_REVISION_REFERENCE_MISSING')

  const format = normalizeToken(outputFormat)
  const formatPolicy = parsed.document?.export_rules?.[format]
  const formatPass = ['MARKDOWN', 'JSON'].includes(format)
    && formatPolicy?.allowed === true
    && formatPolicy?.customer_content_only === true
  checks.push(buildCheck({ key: 'REQUESTED_FORMAT_ALLOWED', pass: formatPass, message: formatPass ? `${format} is allowed and customer-content-only.` : 'The requested output format is not allowed by the loaded rendering policy.' }))
  if (!formatPass) failures.push('REQUESTED_FORMAT_NOT_ALLOWED')

  if (failures.length > 0) return buildBlockedResult({ checks, failures, executionId })

  const receiptChecks = [
    ...checks,
    buildCheck({ key: 'POST_VALIDATION_PASSED', pass: true, message: 'Rendering-layer post-validation passed for the exact asset version.' }),
    buildCheck({ key: 'BOUNDARY_RECEIPT_RECORDED', pass: true, message: 'Exact rendering-layer boundary receipt was recorded.' }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: RENDERING_LAYER_RECEIPT_KEY,
    validatorKey: RENDERING_LAYER_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${RENDERING_LAYER_EXECUTOR_KEY}:${executionId}`,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const receiptValidation = validateOutcomeBoundaryReceipt({
    expectedPack: {
      ...pack,
      versionId,
      contentHash,
      boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
      receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    },
    receipt,
  })
  if (!receiptValidation.valid) {
    return buildBlockedResult({
      checks: [...receiptChecks, buildCheck({ key: 'BOUNDARY_RECEIPT_CONTRACT_VALID', pass: false, message: `Generated receipt failed strict contract validation: ${receiptValidation.failures.join(', ')}.` })],
      failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'],
      executionId,
    })
  }

  return {
    contractVersion: RENDERING_LAYER_EXECUTOR_CONTRACT_VERSION,
    executorKey: RENDERING_LAYER_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
  }
}
