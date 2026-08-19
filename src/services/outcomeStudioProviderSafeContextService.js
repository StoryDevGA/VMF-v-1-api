import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import { createHash } from 'node:crypto'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_LAYERS,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
  resolveKnowledgePackReceiptType,
} from '../constants/knowledgeRuntime.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import logger from '../config/logger.js'
import {
  OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
  assertOutcomeStudioOutputContractResolution,
} from './outcomeStudioOutputContractResolutionService.js'

const SAFE_CONTEXT_LIMIT = 18000
const MAX_SELECTED_VERSIONS = 48
const MAX_PACK_CONTENT_LENGTH = 200000
const MAX_PACK_NON_EMPTY_LINES = 2500
const MAX_GUIDANCE_ENTRIES = 12

const PROVIDER_INPUT_KEYS = Object.freeze(['customerPrompt', 'currentDraftMarkdown', 'request'])
const REQUEST_KEYS = Object.freeze([
  'intentType',
  'refinement',
  'outputTypeKey',
  'outputTypeLabel',
  'outputSchemaKey',
  'requiredSections',
  'styleKey',
  'styleLabel',
  'requestedOutputTypeKey',
  'requestedStyleKey',
  'workspaceType',
])
const SAFE_REQUEST_KEYS = Object.freeze(['businessRequest', 'draftContext', 'effectiveRequest'])
const BUSINESS_REQUEST_KEYS = Object.freeze(['outputTypeKey', 'requestedOutputTypeKey', 'requestedStyleKey', 'workspaceType', 'instruction'])
const DRAFT_CONTEXT_KEYS = Object.freeze(['content'])
const EFFECTIVE_REQUEST_KEYS = Object.freeze(['executionIntent', 'draftContext'])
const TRUTH_SOURCE_KEYS = Object.freeze(['acceptedTruth'])
const TRUTH_ITEM_KEYS = Object.freeze(['label', 'content'])
const KNOWLEDGE_SELECTION_KEYS = Object.freeze(['versionId', 'knowledgeLayer', 'executionMode'])
const EXECUTION_BINDING_KEYS = Object.freeze(['versionId', 'contentHash'])
export const OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT = 'outcome-studio.provider-request-manifest.v1'
const COMPOSITION_PACKAGE_CONTRACT = 'outcome-studio.evidence-to-composition.v1'
const COMPOSITION_KEYS = Object.freeze([
  'contractVersion',
  'businessRequest',
  'businessFacts',
  'outputContract',
  'outputStructure',
  'styleGuidance',
  'methodGuidance',
  'governanceConstraints',
  'readiness',
  'safetyManifest',
])
const COMPOSITION_READINESS_KEYS = Object.freeze(['status', 'draftOnly', 'gapCount', 'notice'])
const COMPOSITION_FACT_KEYS = Object.freeze([
  'statement',
  'qualification',
  'claimPermission',
  'currentness',
  'sectionKeys',
  'sourceAttribution',
])
const COMPOSITION_SOURCE_ATTRIBUTION_KEYS = Object.freeze(['sourceType', 'sourceLabel'])
const COMPOSITION_OUTPUT_KEYS = Object.freeze([
  'outputTypeKey',
  'outputTypeVersion',
  'outputTypeStructure',
  'outputSchemaKey',
  'outputSchemaVersion',
  'styleKey',
  'styleVersion',
  'requiredSections',
  'optionalSections',
])
const COMPOSITION_METHOD_KEYS = Object.freeze(['role', 'boundary', 'version', 'guidance'])
const COMPOSITION_SAFETY_KEYS = Object.freeze([
  'manifestVersion',
  'providerKey',
  'model',
  'providerMode',
  'environment',
  'contentSafetyStatus',
  'secretAndPiiCheck',
  'rawEvidenceCheck',
  'internalTermCheck',
  'requiredEvidenceRefs',
  'businessFactCount',
  'omittedReferenceCount',
  'contradictionCount',
  'requiredSectionCount',
  'styleGuidanceCount',
  'methodGuidanceCount',
  'governanceConstraintCount',
  'readinessStatus',
  'readinessGapCount',
  'draftOnly',
])
const COMPOSITION_SAFE_CHECK_STATUS = 'PASSED'
const GENERATION_CONTEXT_CONSUMPTION_KEYS = Object.freeze([
  'versionId',
  'contentHash',
  'boundary',
  'role',
  'contributions',
])
const GENERATION_CONTEXT_CONTRIBUTION_KEYS = Object.freeze(['surface', 'itemFingerprints'])
const GENERATION_CONTEXT_ROLE_SURFACES = Object.freeze({
  ARL: 'METHOD_GUIDANCE',
  OUTPUT_SCHEMA: 'REQUIRED_SECTIONS',
  OUTPUT_TYPE: 'OUTPUT_STRUCTURE',
})
const GENERATION_CONTEXT_ROLES = Object.freeze(Object.keys(GENERATION_CONTEXT_ROLE_SURFACES).sort())
const ITEM_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/

export const OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT = 'outcome-studio.component-execution-evidence.v2'
export const OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NOT_SUPPLIED: 'NOT_SUPPLIED',
  SKIPPED: 'SKIPPED',
  NOT_RECORDED: 'NOT_RECORDED',
})

export const OUTCOME_STUDIO_PROVIDER_SAFEGUARDS = Object.freeze([
  'CUSTOMER_LANGUAGE_ONLY',
  'VERIFIED_BUSINESS_CONTEXT_ONLY',
  'NO_INTERNAL_RUNTIME_TERMINOLOGY',
  'NO_SECRETS_OR_PERSONAL_DATA',
  'FAIL_CLOSED_ON_UNSAFE_CONTEXT',
])

const UUID_PATTERN = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f])/
const OBJECT_ID_PATTERN = /(?<![A-Fa-f0-9])[A-Fa-f0-9]{24}(?![A-Fa-f0-9])/
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_PATTERN = /(?<!\w)\+?\d(?:[\s().-]{0,2}\d){9,14}(?!\w)/
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
const UK_NI_PATTERN = /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i
const US_SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/
const UK_POSTCODE_PATTERN = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i
const BEARER_AUTH_PATTERN = /\bbearer\s+[A-Za-z0-9._~+\/-]+=*/i
const BASIC_AUTH_CANDIDATE_PATTERN = /\bbasic\s+([A-Za-z0-9+/]+={0,2})(?=$|[\s,.;)])/gi
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[_ -]?key|secret|token|password)\s*[:=]\s*\S+/i
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/
const CONNECTION_STRING_PATTERN = /\b(?:mongodb(?:\+srv)?|redis|postgres(?:ql)?):\/\/\S+/i
const URL_PATTERN = /https?:\/\/\S+/i
const HASH_PATTERN = /\b(?:sha(?:-?256)?[:=]?\s*)?[a-f0-9]{64}\b/i
const INTERNAL_TERM_PATTERN = /\b(?:knowledge\s+pack|manifest|activation|dependency\s+graph|database\s+identifier|runtime\s+graph|provider\s+context|system\s+prompt|certified\s+truth)\b/i

const METADATA_HEADINGS = new Set([
  'document metadata', 'runtime identity', 'classification', 'source basis', 'version',
  'release', 'lifecycle', 'status', 'identifier', 'identifiers',
])

const GUIDANCE_KEYS = Object.freeze([
  'businessInstructions',
  'reasoningGuidance',
  'outputSchema',
  'styleGuidance',
  'validationCriteria',
  'prohibitedOutputBoundaries',
])
const SAFE_CANDIDATE_DISPOSITIONS = Object.freeze({
  PROJECTED: 'PROJECTED',
  CATEGORY_LIMITED: 'CATEGORY_LIMITED',
  NO_SAFE_GUIDANCE: 'NO_SAFE_GUIDANCE',
})
const EXECUTION_EVIDENCE_BOUNDARIES = new Set(Object.values(KNOWLEDGE_PACK_BOUNDARIES))
const EXECUTION_EVIDENCE_RECEIPT_TYPES = new Set(Object.values(KNOWLEDGE_PACK_RECEIPT_TYPES))
const ADMISSION_DISPOSITIONS = Object.freeze({
  ADMITTED: 'ADMITTED',
  CONTEXT_LIMIT: 'CONTEXT_LIMIT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NOT_ADMITTED: 'NOT_ADMITTED',
})
const FRAMEWORK_GUIDANCE_REFERENCE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,178}[a-z0-9])?$/
const FRAMEWORK_GUIDANCE_APPLICATION_GUIDANCE = Object.freeze({
  businessInstructions: Object.freeze([
    'Decision analysis. Assess only the verified business information supplied, distinguish observations from implications, and retain material qualifications and uncertainty.',
  ]),
  reasoningGuidance: Object.freeze([
    'Framework and guidance analysis. Explain decision relevance, material implications, practical recommendations, assumptions, gaps, priorities, risks, and the next analytical step without changing the verified facts.',
  ]),
  outputSchema: Object.freeze([
    'Analysis structure. Return a title, ordered analytical sections, decision usefulness, and assumptions. Each section must include analysis, implications, recommendations, qualification, source reference keys, guidance reference tokens, assumptions, and gaps.',
  ]),
  styleGuidance: Object.freeze([
    'Analytical style. Use concise, precise, neutral business language. Preserve uncertainty, avoid unsupported certainty, and do not present the analysis as an approved draft, final asset, publication, presentation, or infographic.',
  ]),
})

const SAFE_CONTEXT_DIAGNOSTIC_REASONS = Object.freeze({
  REQUEST_VALIDATION: 'SAFE_REQUEST_INVALID',
  TRUTH_PROJECTION: 'TRUTH_PROJECTION_REJECTED',
  KNOWLEDGE_SELECTION_VALIDATION: 'KNOWLEDGE_SELECTION_INVALID',
  SELECTED_VERSION_LOOKUP: 'SELECTED_VERSION_LOOKUP_FAILED',
  GUIDANCE_PROJECTION: 'GUIDANCE_PROJECTION_REJECTED',
  REQUIRED_GUIDANCE_ADMISSION: 'REQUIRED_GUIDANCE_MISSING',
  DIRECT_CONSUMPTION_VALIDATION: 'DIRECT_CONSUMPTION_VALIDATION_REJECTED',
  CONTEXT_VALIDATION: 'CONTEXT_VALIDATION_REJECTED',
})
const GUIDANCE_PROJECTION_REASONS = new Set([
  'PACK_CONTENT_TYPE_INVALID',
  'PACK_CONTENT_TOO_LARGE',
  'PACK_CONTENT_TOO_MANY_LINES',
  'PACK_CONTENT_MALFORMED',
  'PACK_CONTENT_CONTROL_CHARACTER',
  'PACK_CONTENT_PII_OR_CREDENTIAL',
])

const emptyCategoryCounts = () => Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, 0]))
const emptyDiscardCounts = () => ({
  categoryLimit: 0,
  discardableSection: 0,
  duplicateSection: 0,
  emptySection: 0,
  unclassifiedSection: 0,
})

const logSafeContextFailure = ({
  admittedCountsByCategory = emptyCategoryCounts(),
  discardedCountsByReason = emptyDiscardCounts(),
  foundCount = 0,
  missingCategories = [],
  observedCount = 0,
  reasonCode,
  selectedCount = 0,
  stage,
}) => {
  logger.warn({
    stage,
    reasonCode: GUIDANCE_PROJECTION_REASONS.has(reasonCode)
      ? reasonCode
      : SAFE_CONTEXT_DIAGNOSTIC_REASONS[stage],
    selectedCount,
    foundCount,
    discardedCountsByReason,
    admittedCountsByCategory,
    missingCategories,
    observedCount,
    configuredLimit: reasonCode === 'PACK_CONTENT_TOO_MANY_LINES'
      ? MAX_PACK_NON_EMPTY_LINES
      : 0,
  }, 'outcome studio provider safe context blocked')
}

const getInternalDiagnostic = ({ stage, reasonCode } = {}) => {
  const failureStage = Object.prototype.hasOwnProperty.call(SAFE_CONTEXT_DIAGNOSTIC_REASONS, stage)
    ? stage
    : undefined
  const diagnosticCode = GUIDANCE_PROJECTION_REASONS.has(reasonCode)
    ? reasonCode
    : SAFE_CONTEXT_DIAGNOSTIC_REASONS[failureStage]
  return {
    ...(failureStage ? { internalFailureStage: failureStage } : {}),
    ...(diagnosticCode ? { internalDiagnosticCode: diagnosticCode } : {}),
  }
}

const appError = ({ stage, reasonCode } = {}) => {
  const error = new Error('Provider-safe context could not be created.')
  error.status = 422
  error.code = 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED'
  error.details = {
    reason: 'PROVIDER_SAFE_CONTEXT_BLOCKED',
    safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  }
  const diagnostic = getInternalDiagnostic({ stage, reasonCode })
  Object.entries(diagnostic).forEach(([key, value]) => {
    Object.defineProperty(error, key, {
      configurable: false,
      enumerable: false,
      value,
      writable: false,
    })
  })
  return error
}

const enrichAppError = (error, { stage, reasonCode } = {}) => {
  if (error?.code !== 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') return appError({ stage, reasonCode })
  const diagnostic = getInternalDiagnostic({
    stage,
    reasonCode: reasonCode || error.internalSafeContextReasonCode,
  })
  Object.entries(diagnostic).forEach(([key, value]) => {
    Object.defineProperty(error, key, {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    })
  })
  return error
}

const fail = () => { throw appError() }
const failGuidanceProjection = (reasonCode) => {
  const error = appError()
  Object.defineProperty(error, 'internalSafeContextReasonCode', {
    configurable: false,
    enumerable: false,
    value: reasonCode,
    writable: false,
  })
  throw error
}
const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
const hasExactKeys = (value, keys) => isPlainObject(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
const normalizedWhitespace = (value) => value.replace(/\s+/g, ' ').trim()
const normalizedIdentity = (value) => normalizedWhitespace(value.normalize('NFKC'))
const normalizedDraft = (value) => value.replace(/\r\n?/g, '\n').trim()

const hasMalformedUtf16 = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

const digitRuns = (value) => value.match(/(?<!\d)\d(?:[\s-]{0,2}\d){12,18}(?!\d)/g) || []
const passesLuhn = (value) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

const isCanonicalBasicAuthCredential = (candidate) => {
  try {
    const decoded = Buffer.from(candidate, 'base64')
    if (!decoded.length) return false
    const decodedText = decoded.toString('utf8')
    if (!Buffer.from(decodedText, 'utf8').equals(decoded)) return false
    const canonical = decoded.toString('base64')
    if (candidate !== canonical && candidate !== canonical.replace(/=+$/u, '')) return false
    return decodedText.includes(':')
  } catch {
    return false
  }
}

const containsBasicAuthCredential = (value) => [...value.matchAll(BASIC_AUTH_CANDIDATE_PATTERN)]
  .some((match) => isCanonicalBasicAuthCredential(match[1]))

const containsDirectPiiOrCredential = (value) => [
  EMAIL_PATTERN, PHONE_PATTERN, IPV4_PATTERN, UK_NI_PATTERN, US_SSN_PATTERN,
  UK_POSTCODE_PATTERN, BEARER_AUTH_PATTERN, PRIVATE_KEY_PATTERN, SECRET_ASSIGNMENT_PATTERN,
  OPENAI_KEY_PATTERN, CONNECTION_STRING_PATTERN,
].some((pattern) => pattern.test(value))
  || containsBasicAuthCredential(value)
  || digitRuns(value).some(passesLuhn)

const containsDirectIdentifier = (value) => OBJECT_ID_PATTERN.test(value) || UUID_PATTERN.test(value)
const withoutDirectIdentifiers = (value) => value
  .replace(new RegExp(UUID_PATTERN.source, 'gi'), ' ')
  .replace(new RegExp(OBJECT_ID_PATTERN.source, 'gi'), ' ')
const containsDiscardablePackContent = (value) => URL_PATTERN.test(value)
  || HASH_PATTERN.test(value)
  || INTERNAL_TERM_PATTERN.test(value)
  || containsDirectIdentifier(value)
const containsWholeContextViolation = (value) => hasMalformedUtf16(value)
  || CONTROL_PATTERN.test(value)
  || containsDirectPiiOrCredential(value)
  || URL_PATTERN.test(value)
  || HASH_PATTERN.test(value)
  || INTERNAL_TERM_PATTERN.test(value)
  || containsDirectIdentifier(value)

const assertSafeRawString = (value) => {
  if (typeof value !== 'string' || containsWholeContextViolation(value)) fail()
}

export const assertOutcomeStudioProviderSafeValue = (value) => {
  if (typeof value === 'string') {
    assertSafeRawString(value)
    return value
  }
  if (Array.isArray(value)) {
    value.forEach(assertOutcomeStudioProviderSafeValue)
    return value
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(assertOutcomeStudioProviderSafeValue)
  }
  return value
}

const boundText = (value, maximum, boundaryStart, normalizer = normalizedWhitespace) => {
  const text = normalizer(value)
  if (text.length <= maximum) return text
  const prefix = text.slice(0, maximum)
  let cutAt = -1
  for (let index = prefix.length - 1; index >= boundaryStart; index -= 1) {
    if (/[\t\n\f\r ]/.test(prefix[index])) {
      cutAt = index
      break
    }
  }
  return prefix.slice(0, cutAt >= boundaryStart ? cutAt : maximum).trim()
}

const safeToken = (value) => typeof value === 'string' && value.trim() && value.length <= 160
const safeOptionalString = (value) => typeof value === 'string' && value.length <= 160

const assertProviderDescriptor = (providerDescriptor) => {
  if (!isPlainObject(providerDescriptor) || providerDescriptor.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY) fail()
}

export const buildOutcomeStudioProviderSafeRequest = ({ providerDescriptor, providerInput } = {}) => {
  assertProviderDescriptor(providerDescriptor)
  if (!hasExactKeys(providerInput, PROVIDER_INPUT_KEYS) || !hasExactKeys(providerInput.request, REQUEST_KEYS)) fail()
  if (typeof providerInput.customerPrompt !== 'string' || typeof providerInput.currentDraftMarkdown !== 'string') fail()
  const request = providerInput.request
  if (typeof request.refinement !== 'boolean'
    || !safeToken(request.intentType)
    || !safeToken(request.outputTypeKey)
    || !safeToken(request.outputTypeLabel)
    || !safeToken(request.outputSchemaKey)
    || !safeOptionalString(request.styleKey)
    || !safeOptionalString(request.styleLabel)
    || !safeToken(request.requestedOutputTypeKey)
    || !safeOptionalString(request.requestedStyleKey)
    || !safeToken(request.workspaceType)
    || !Array.isArray(request.requiredSections)
    || request.requiredSections.length > 24
    || request.requiredSections.some((item) => typeof item !== 'string' || item.length > 160)) fail()

  const rawStrings = [
    providerInput.customerPrompt,
    providerInput.currentDraftMarkdown,
    request.intentType,
    request.outputTypeKey,
    request.outputTypeLabel,
    request.outputSchemaKey,
    ...request.requiredSections,
    request.styleKey,
    request.styleLabel,
    request.requestedOutputTypeKey,
    request.requestedStyleKey,
    request.workspaceType,
  ]
  rawStrings.forEach(assertSafeRawString)

  const valueOrUnspecified = (value) => normalizedWhitespace(value) || 'UNSPECIFIED'
  const instructionSource = [
    `Outcome: ${valueOrUnspecified(request.intentType)}.`,
    `Deliverable: ${valueOrUnspecified(request.outputTypeLabel)} (${valueOrUnspecified(request.outputTypeKey)}).`,
    `Structure: ${valueOrUnspecified(request.outputSchemaKey)}${request.requiredSections.length ? `; required sections: ${request.requiredSections.map(normalizedWhitespace).join(', ')}` : ''}.`,
    `Style: ${valueOrUnspecified(request.styleLabel)} (${valueOrUnspecified(request.styleKey)}).`,
    `Draft operation: ${request.refinement ? 'refinement.' : 'initial creation.'}`,
    `Customer request: ${providerInput.customerPrompt}`,
  ].join('\n')
  const instruction = boundText(instructionSource, 2000, 1800)
  const draftContext = { content: boundText(providerInput.currentDraftMarkdown, 2500, 2250, normalizedDraft) }
  if (!instruction) fail()
  const businessRequest = {
    outputTypeKey: normalizedWhitespace(request.outputTypeKey),
    requestedOutputTypeKey: normalizedWhitespace(request.requestedOutputTypeKey),
    requestedStyleKey: normalizedWhitespace(request.requestedStyleKey),
    workspaceType: normalizedWhitespace(request.workspaceType),
    instruction,
  }
  return {
    businessRequest,
    draftContext,
    effectiveRequest: { executionIntent: instruction, draftContext: { ...draftContext } },
  }
}

export const assertOutcomeStudioProviderSafeRequest = (safeRequest) => {
  if (!hasExactKeys(safeRequest, SAFE_REQUEST_KEYS)
    || !hasExactKeys(safeRequest.businessRequest, BUSINESS_REQUEST_KEYS)
    || !hasExactKeys(safeRequest.draftContext, DRAFT_CONTEXT_KEYS)
    || !hasExactKeys(safeRequest.effectiveRequest, EFFECTIVE_REQUEST_KEYS)
    || !hasExactKeys(safeRequest.effectiveRequest.draftContext, DRAFT_CONTEXT_KEYS)
    || !BUSINESS_REQUEST_KEYS.every((key) => typeof safeRequest.businessRequest[key] === 'string')
    || !safeToken(safeRequest.businessRequest.outputTypeKey)
    || !safeToken(safeRequest.businessRequest.requestedOutputTypeKey)
    || !safeOptionalString(safeRequest.businessRequest.requestedStyleKey)
    || !safeToken(safeRequest.businessRequest.workspaceType)
    || typeof safeRequest.businessRequest.instruction !== 'string'
    || !safeRequest.businessRequest.instruction.trim()
    || safeRequest.businessRequest.instruction.length > 2000
    || safeRequest.draftContext.content.length > 2500
    || safeRequest.effectiveRequest.executionIntent !== safeRequest.businessRequest.instruction
    || safeRequest.effectiveRequest.draftContext.content !== safeRequest.draftContext.content) fail()
  Object.values(safeRequest.businessRequest).forEach(assertSafeRawString)
  assertSafeRawString(safeRequest.draftContext.content)
  return safeRequest
}

const buildRedactedEvidenceHandle = (fact = {}) => {
  if (!isPlainObject(fact)
    || typeof fact.evidenceObjectId !== 'string'
    || !normalizedIdentity(fact.evidenceObjectId)
    || typeof fact.sourceId !== 'string'
    || !normalizedIdentity(fact.sourceId)
    || !isPlainObject(fact.provenance)
    || typeof fact.provenance.lineageRef !== 'string'
    || !normalizedIdentity(fact.provenance.lineageRef)) fail()
  return `ref_${createHash('sha256')
    .update(JSON.stringify({
      evidenceObjectId: normalizedIdentity(fact.evidenceObjectId),
      sourceId: normalizedIdentity(fact.sourceId),
      lineageRef: normalizedIdentity(fact.provenance.lineageRef),
    }), 'utf8')
    .digest('hex')
    .slice(0, 16)}`
}

const assertSafeBoundedArray = (values, { maxLength, itemMaximum = 600 } = {}) => {
  if (!Array.isArray(values) || values.length > maxLength) fail()
  values.forEach((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > itemMaximum) fail()
    assertSafeRawString(value)
  })
  return values
}

const buildSafeCompositionFact = (fact = {}) => {
  if (!isPlainObject(fact)
    || !hasExactKeys(fact, [
      'evidenceObjectId',
      'sourceId',
      'sectionKeys',
      'statement',
      'extractedFact',
      'reviewStatus',
      'validationStatus',
      'confidence',
      'materiality',
      'currentness',
      'provenance',
      'claimPermission',
      'qualification',
      'selectionReason',
      'factId',
    ])
    || !isPlainObject(fact.provenance)
    || !hasExactKeys(fact.provenance, ['lineageRef', 'sourceRegistryRef'])
    || typeof fact.evidenceObjectId !== 'string'
    || !fact.evidenceObjectId.trim()
    || typeof fact.sourceId !== 'string'
    || !fact.sourceId.trim()
    || typeof fact.factId !== 'string'
    || !fact.factId.trim()
    || typeof fact.statement !== 'string'
    || !fact.statement.trim()
    || typeof fact.currentness !== 'string'
    || !fact.currentness.trim()
    || typeof fact.claimPermission !== 'string'
    || !fact.claimPermission.trim()
    || !Array.isArray(fact.sectionKeys)
    || fact.sectionKeys.length === 0
    || fact.sectionKeys.length > 24
    || fact.sectionKeys.some((key) => !safeToken(key))
    || !Array.isArray(fact.qualification)
    || fact.qualification.length > 8
    || fact.qualification.some((item) => typeof item !== 'string' || item.length > 240)
    || typeof fact.provenance.lineageRef !== 'string'
    || !fact.provenance.lineageRef.trim()
    || typeof fact.provenance.sourceRegistryRef !== 'string'
    || !fact.provenance.sourceRegistryRef.trim()) fail()

  const statement = boundText(fact.statement, 1200, 80)
  const qualification = fact.qualification.map((item) => boundText(item, 240, 1)).filter(Boolean)
  if (!statement) fail()
  assertSafeRawString(statement)
  assertSafeBoundedArray(qualification, { maxLength: 8, itemMaximum: 240 })
  assertSafeRawString(fact.currentness)
  assertSafeRawString(fact.claimPermission)
  fact.sectionKeys.forEach((key) => assertSafeRawString(key))

  return {
    statement,
    qualification,
    claimPermission: normalizedWhitespace(fact.claimPermission),
    currentness: normalizedWhitespace(fact.currentness),
    sectionKeys: [...new Set(fact.sectionKeys.map(normalizedWhitespace))].sort(),
    sourceAttribution: {
      sourceType: 'GOVERNED_SOURCE',
      sourceLabel: 'Accepted business source',
    },
  }
}

const buildSafeCompositionOutput = (outputBinding = {}) => {
  if (!isPlainObject(outputBinding)
    || !safeToken(outputBinding.outputTypeKey)
    || !safeToken(outputBinding.outputTypeVersion)
    || !safeToken(outputBinding.outputTypeStructure?.[0])
    || !safeToken(outputBinding.outputSchemaKey)
    || !safeToken(outputBinding.outputSchemaVersion)
    || !safeToken(outputBinding.styleKey)
    || !safeToken(outputBinding.styleVersion)
    || !Array.isArray(outputBinding.outputTypeStructure)
    || outputBinding.outputTypeStructure.length !== 5
    || !Array.isArray(outputBinding.requiredSections)
    || outputBinding.requiredSections.length === 0
    || outputBinding.requiredSections.length > 24
    || new Set(outputBinding.requiredSections.map(normalizedWhitespace)).size !== outputBinding.requiredSections.length) fail()

  const projectSafeStructureText = (value) => normalizedWhitespace(value)
    .replace(/knowledge\s+packs?/gi, 'governed guidance')
    .replace(/certified\s+(?:runtime\s+)?truth/gi, 'verified business information')
    .replace(/activation/gi, 'selection')
    .replace(/manifest/gi, 'safety checklist')
  const outputTypeStructure = outputBinding.outputTypeStructure
    .map((item) => boundText(projectSafeStructureText(item), 240, 1))
  const requiredSections = outputBinding.requiredSections.map((item) => boundText(item, 160, 1))
  const optionalSections = Array.isArray(outputBinding.optionalSections)
    ? outputBinding.optionalSections.map((item) => boundText(item, 160, 1)).filter(Boolean)
    : []
  assertSafeBoundedArray(outputTypeStructure, { maxLength: 5, itemMaximum: 240 })
  assertSafeBoundedArray(requiredSections, { maxLength: 24, itemMaximum: 160 })
  assertSafeBoundedArray(optionalSections, { maxLength: 12, itemMaximum: 160 })
  return {
    outputTypeKey: normalizedWhitespace(outputBinding.outputTypeKey),
    outputTypeVersion: normalizedWhitespace(outputBinding.outputTypeVersion),
    outputTypeStructure,
    outputSchemaKey: normalizedWhitespace(outputBinding.outputSchemaKey),
    outputSchemaVersion: normalizedWhitespace(outputBinding.outputSchemaVersion),
    styleKey: normalizedWhitespace(outputBinding.styleKey),
    styleVersion: normalizedWhitespace(outputBinding.styleVersion),
    requiredSections,
    optionalSections,
  }
}

const buildSafeMethodGuidance = (methodGuidance = []) => {
  if (!Array.isArray(methodGuidance) || methodGuidance.length === 0 || methodGuidance.length > 12) fail()
  const roles = new Set()
  return methodGuidance.map((entry) => {
    if (!isPlainObject(entry) || !hasExactKeys(entry, COMPOSITION_METHOD_KEYS)
      || !safeToken(entry.role)
      || !safeToken(entry.boundary)
      || !safeToken(entry.version)
      || typeof entry.guidance !== 'string'
      || !entry.guidance.trim()
      || roles.has(normalizedWhitespace(entry.role).toUpperCase())) fail()
    roles.add(normalizedWhitespace(entry.role).toUpperCase())
    const safeEntry = {
      role: normalizedWhitespace(entry.role),
      boundary: normalizedWhitespace(entry.boundary),
      version: normalizedWhitespace(entry.version),
      guidance: boundText(entry.guidance, 600, 80),
    }
    Object.values(safeEntry).forEach(assertSafeRawString)
    return safeEntry
  })
}

const normalizeConsumptionItem = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')

const fingerprintConsumptionItem = (value, collisionMap) => {
  const normalized = normalizeConsumptionItem(value)
  if (!normalized) fail()
  const fingerprint = `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
  const previous = collisionMap.get(fingerprint)
  if (previous !== undefined && previous !== normalized) fail()
  collisionMap.set(fingerprint, normalized)
  return fingerprint
}

const canonicalizeGenerationContextConsumption = (entries) => {
  if (!Array.isArray(entries) || entries.length !== GENERATION_CONTEXT_ROLES.length) fail()
  const identities = new Set()
  const roles = new Set()
  const canonical = entries.map((entry) => {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, GENERATION_CONTEXT_CONSUMPTION_KEYS)
      || !safeToken(entry.versionId)
      || !ITEM_FINGERPRINT_PATTERN.test(entry.contentHash)
      || entry.boundary !== KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT
      || !GENERATION_CONTEXT_ROLES.includes(entry.role)
      || roles.has(entry.role)
      || !Array.isArray(entry.contributions)
      || entry.contributions.length !== 1) fail()
    const identity = `${entry.role}:${entry.versionId}`
    if (identities.has(identity)) fail()
    identities.add(identity)
    roles.add(entry.role)
    const contribution = entry.contributions[0]
    const expectedSurface = GENERATION_CONTEXT_ROLE_SURFACES[entry.role]
    if (!isPlainObject(contribution)
      || !hasExactKeys(contribution, GENERATION_CONTEXT_CONTRIBUTION_KEYS)
      || contribution.surface !== expectedSurface
      || !Array.isArray(contribution.itemFingerprints)
      || contribution.itemFingerprints.length === 0
      || contribution.itemFingerprints.some((value) => !ITEM_FINGERPRINT_PATTERN.test(value))) fail()
    const itemFingerprints = [...new Set(contribution.itemFingerprints)].sort()
    if (itemFingerprints.length !== contribution.itemFingerprints.length) fail()
    return {
      versionId: entry.versionId,
      contentHash: entry.contentHash,
      boundary: entry.boundary,
      role: entry.role,
      contributions: [{ surface: expectedSurface, itemFingerprints }],
    }
  }).sort((left, right) => (
    left.role.localeCompare(right.role)
      || left.versionId.localeCompare(right.versionId)
      || left.contentHash.localeCompare(right.contentHash)
      || left.contributions[0].surface.localeCompare(right.contributions[0].surface)
      || JSON.stringify(left.contributions[0].itemFingerprints)
        .localeCompare(JSON.stringify(right.contributions[0].itemFingerprints))
  ))
  if (roles.size !== GENERATION_CONTEXT_ROLES.length
    || GENERATION_CONTEXT_ROLES.some((role) => !roles.has(role))) fail()
  return canonical
}

const fingerprintGenerationContextConsumption = (consumption) => (
  `sha256:${createHash('sha256').update(JSON.stringify(consumption), 'utf8').digest('hex')}`
)

const buildDirectConsumptionBindings = ({
  executionBindings,
  generationContextConsumption,
  knowledgeSelection,
} = {}) => {
  if (!Array.isArray(knowledgeSelection)
    || !Array.isArray(executionBindings)
    || !Array.isArray(generationContextConsumption)) fail()
  const bindingByVersionId = new Map(executionBindings.map((binding) => [binding.versionId, binding]))
  const selectionByVersionId = new Map(knowledgeSelection.map((selection) => [selection.versionId, selection]))
  const roleForSelection = (selection) => {
    const layer = normalizedWhitespace(selection.knowledgeLayer).toUpperCase()
    const packType = normalizedWhitespace(selection.packType).toUpperCase()
    if (layer === 'OUTPUT_TYPE' && packType === 'OUTPUT_TYPE_DEFINITION') return 'OUTPUT_TYPE'
    if (layer === 'OUTPUT_SCHEMA' && packType === 'OUTPUT_SCHEMA') return 'OUTPUT_SCHEMA'
    if (layer === 'REASONING' && packType === 'ARL') return 'ARL'
    return ''
  }
  const directBindings = generationContextConsumption.map((consumption) => {
    const selection = selectionByVersionId.get(consumption.versionId)
    const role = selection ? roleForSelection(selection) : ''
    const binding = bindingByVersionId.get(consumption.versionId)
    if (!selection || !role || role !== consumption.role || !binding
      || binding.contentHash !== consumption.contentHash) fail()
    return {
      role,
      versionId: selection.versionId,
      contentHash: binding.contentHash,
    }
  })
  if (directBindings.length !== GENERATION_CONTEXT_ROLES.length
    || new Set(directBindings.map((binding) => binding.role)).size !== GENERATION_CONTEXT_ROLES.length) fail()
  return directBindings
}

const buildConsumptionFromProviderSurfaces = ({ directBindings, methodGuidance, outputStructure }) => {
  if (!Array.isArray(directBindings) || directBindings.length !== GENERATION_CONTEXT_ROLES.length) fail()
  const collisionMap = new Map()
  const surfaceItems = {
    ARL: methodGuidance
      .filter((entry) => normalizedWhitespace(entry?.role).toUpperCase() === 'ARL')
      .map((entry) => entry.guidance),
    OUTPUT_SCHEMA: outputStructure.requiredSections,
    OUTPUT_TYPE: outputStructure.outputTypeStructure,
  }
  const entries = directBindings.map((binding) => {
    if (!GENERATION_CONTEXT_ROLES.includes(binding.role)
      || !safeToken(binding.versionId)
      || !ITEM_FINGERPRINT_PATTERN.test(binding.contentHash)) fail()
    const itemFingerprints = [...new Set(
      (surfaceItems[binding.role] || []).map((item) => fingerprintConsumptionItem(item, collisionMap)),
    )].sort()
    if (itemFingerprints.length === 0) fail()
    return {
      versionId: binding.versionId,
      contentHash: binding.contentHash,
      boundary: KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT,
      role: binding.role,
      contributions: [{
        surface: GENERATION_CONTEXT_ROLE_SURFACES[binding.role],
        itemFingerprints,
      }],
    }
  })
  const consumption = canonicalizeGenerationContextConsumption(entries)
  return {
    generationContextConsumption: consumption,
    generationContextConsumptionFingerprint: fingerprintGenerationContextConsumption(consumption),
  }
}

export const buildOutcomeStudioGenerationContextConsumption = ({
  compositionPackage,
  directBindings,
  methodGuidance,
} = {}) => {
  if (!isPlainObject(compositionPackage)) fail()
  return buildConsumptionFromProviderSurfaces({
    directBindings,
    methodGuidance: buildSafeMethodGuidance(methodGuidance),
    outputStructure: buildSafeCompositionOutput(compositionPackage.outputBinding),
  })
}

export const assertOutcomeStudioGenerationContextConsumption = ({
  compositionPackage,
  executionBindings,
  generationContextConsumption,
  generationContextConsumptionFingerprint,
  knowledgeSelection,
  methodGuidance,
  providerComposition,
} = {}) => {
  if (compositionPackage !== undefined && !isPlainObject(compositionPackage)) fail()
  if (providerComposition !== undefined && !isPlainObject(providerComposition)) fail()
  const canonical = canonicalizeGenerationContextConsumption(generationContextConsumption)
  if (JSON.stringify(canonical) !== JSON.stringify(generationContextConsumption)
    || generationContextConsumptionFingerprint !== fingerprintGenerationContextConsumption(canonical)) fail()
  const directBindings = buildDirectConsumptionBindings({
    executionBindings,
    generationContextConsumption,
    knowledgeSelection,
  })
  const expected = providerComposition !== undefined
    ? buildConsumptionFromProviderSurfaces({
        directBindings,
        methodGuidance: buildSafeMethodGuidance(providerComposition.methodGuidance),
        outputStructure: buildSafeCompositionOutput(providerComposition.outputStructure),
      })
    : buildOutcomeStudioGenerationContextConsumption({
        compositionPackage,
        directBindings,
        methodGuidance,
      })
  if (expected.generationContextConsumptionFingerprint !== generationContextConsumptionFingerprint
    || JSON.stringify(expected.generationContextConsumption) !== JSON.stringify(canonical)) fail()
  return expected
}

const comparableOutputContractKey = (value) => normalizedIdentity(value)
  .toLowerCase()
  .replace(/[-_]+/g, '')

const safeOutputContractDescriptor = (key, label, version = '') => ({
  key: normalizedWhitespace(key),
  label: normalizedWhitespace(label || key),
  version: normalizedWhitespace(version),
})

const buildLegacyOutputContractResolution = ({ methodGuidance, outputStructure }) => ({
  contractVersion: OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
  status: 'RESOLVED',
  source: 'LEGACY_BOUND_SESSION',
  confidence: 'HIGH',
  inferenceReason: 'LEGACY_PROVIDER_MANIFEST_PROJECTION',
  outputIntent: safeOutputContractDescriptor(
    outputStructure.outputTypeKey,
    outputStructure.outputTypeKey,
    outputStructure.outputTypeVersion,
  ),
  audience: null,
  purpose: null,
  selectedOutputType: safeOutputContractDescriptor(
    outputStructure.outputTypeKey,
    outputStructure.outputTypeKey,
    outputStructure.outputTypeVersion,
  ),
  selectedOutputSchema: safeOutputContractDescriptor(
    outputStructure.outputSchemaKey,
    outputStructure.outputSchemaKey,
    outputStructure.outputSchemaVersion,
  ),
  selectedStyle: safeOutputContractDescriptor(
    outputStructure.styleKey,
    outputStructure.styleKey,
    outputStructure.styleVersion,
  ),
  knowledgePackRoles: [
    {
      role: 'OUTPUT_TYPE',
      classification: 'OUTPUT_TYPE',
      ...safeOutputContractDescriptor(
        outputStructure.outputTypeKey,
        outputStructure.outputTypeKey,
        outputStructure.outputTypeVersion,
      ),
    },
    {
      role: 'OUTPUT_SCHEMA',
      classification: 'OUTPUT_SCHEMA',
      ...safeOutputContractDescriptor(
        outputStructure.outputSchemaKey,
        outputStructure.outputSchemaKey,
        outputStructure.outputSchemaVersion,
      ),
    },
    {
      role: 'STYLE',
      classification: 'STYLE',
      ...safeOutputContractDescriptor(
        outputStructure.styleKey,
        outputStructure.styleKey,
        outputStructure.styleVersion,
      ),
    },
    ...methodGuidance.map((entry) => ({
      role: normalizedWhitespace(entry.role),
      classification: 'METHOD',
      key: normalizedWhitespace(entry.role).toLowerCase(),
      label: normalizedWhitespace(entry.role),
      version: normalizedWhitespace(entry.version),
    })),
  ],
  clarificationPath: { required: false, reason: '', question: '' },
})

const buildSafeOutputContractResolution = ({
  compositionPackage,
  methodGuidance,
  outputStructure,
} = {}) => {
  const supplied = compositionPackage.outputContractResolution
    || buildLegacyOutputContractResolution({ methodGuidance, outputStructure })
  const resolution = assertOutcomeStudioOutputContractResolution(supplied)
  if (resolution.status !== 'RESOLVED'
    || resolution.clarificationPath.required
    || comparableOutputContractKey(resolution.selectedOutputType.key)
      !== comparableOutputContractKey(outputStructure.outputTypeKey)
    || comparableOutputContractKey(resolution.selectedOutputSchema.key)
      !== comparableOutputContractKey(outputStructure.outputSchemaKey)
    || comparableOutputContractKey(resolution.selectedStyle.key)
      !== comparableOutputContractKey(outputStructure.styleKey)
    || normalizedWhitespace(resolution.selectedOutputType.version) !== outputStructure.outputTypeVersion
    || normalizedWhitespace(resolution.selectedOutputSchema.version) !== outputStructure.outputSchemaVersion
    || normalizedWhitespace(resolution.selectedStyle.version) !== outputStructure.styleVersion) fail()

  const roles = new Map(resolution.knowledgePackRoles.map((entry) => [normalizedWhitespace(entry.role).toUpperCase(), entry]))
  for (const requiredRole of ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'STYLE']) {
    if (!roles.has(requiredRole)) fail()
  }
  methodGuidance.forEach((entry) => {
    const role = roles.get(normalizedWhitespace(entry.role).toUpperCase())
    if (!role || normalizedWhitespace(role.version) !== normalizedWhitespace(entry.version)) fail()
  })
  const visitStrings = (value) => {
    if (typeof value === 'string') {
      assertSafeRawString(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visitStrings)
      return
    }
    if (isPlainObject(value)) Object.values(value).forEach(visitStrings)
  }
  visitStrings(resolution)
  return resolution
}

const buildSafeCompositionManifest = ({
  businessFacts,
  compositionPackage,
  governanceConstraints,
  methodGuidance,
  outputStructure,
  providerDescriptor,
  readiness,
  styleGuidance,
} = {}) => {
  const sourceFacts = compositionPackage?.businessFactLedger?.facts
  if (!Array.isArray(sourceFacts) || sourceFacts.length !== businessFacts.length) fail()
  const requiredEvidenceRefs = sourceFacts.map(buildRedactedEvidenceHandle)
  if (new Set(requiredEvidenceRefs).size !== requiredEvidenceRefs.length) fail()
  return {
    manifestVersion: OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT,
    providerKey: normalizedWhitespace(providerDescriptor.providerKey),
    model: normalizedWhitespace(providerDescriptor.model),
    providerMode: normalizedWhitespace(providerDescriptor.providerMode),
    environment: normalizedWhitespace(providerDescriptor.environment),
    contentSafetyStatus: COMPOSITION_SAFE_CHECK_STATUS,
    secretAndPiiCheck: COMPOSITION_SAFE_CHECK_STATUS,
    rawEvidenceCheck: COMPOSITION_SAFE_CHECK_STATUS,
    internalTermCheck: COMPOSITION_SAFE_CHECK_STATUS,
    requiredEvidenceRefs,
    businessFactCount: businessFacts.length,
    omittedReferenceCount: Array.isArray(compositionPackage.businessFactLedger.omitted)
      ? compositionPackage.businessFactLedger.omitted.length
      : 0,
    contradictionCount: Array.isArray(compositionPackage.businessFactLedger.contradictions)
      ? compositionPackage.businessFactLedger.contradictions.length
      : 0,
    requiredSectionCount: outputStructure.requiredSections.length,
    styleGuidanceCount: styleGuidance.length,
    methodGuidanceCount: methodGuidance.length,
    governanceConstraintCount: governanceConstraints.length,
    readinessStatus: readiness.status,
    readinessGapCount: readiness.gapCount,
    draftOnly: readiness.draftOnly,
  }
}

const buildSafeCompositionReadiness = (readiness = {}) => {
  const supplied = isPlainObject(readiness) ? readiness : {}
  const safeReadiness = {
    status: normalizedWhitespace(typeof supplied.status === 'string' ? supplied.status : 'READY'),
    draftOnly: supplied.draftOnly === true,
    gapCount: Number.isInteger(supplied.gapCount) ? supplied.gapCount : 0,
    notice: normalizedWhitespace(typeof supplied.notice === 'string' ? supplied.notice : ''),
  }
  if (!hasExactKeys(safeReadiness, COMPOSITION_READINESS_KEYS)
    || !['READY', 'READY_WITH_GAPS'].includes(safeReadiness.status)
    || safeReadiness.gapCount < 0
    || safeReadiness.gapCount > 24
    || safeReadiness.draftOnly !== (safeReadiness.status === 'READY_WITH_GAPS')
    || (safeReadiness.status === 'READY_WITH_GAPS' && !safeReadiness.notice)) fail()
  assertSafeRawString(safeReadiness.notice)
  return safeReadiness
}

export const buildOutcomeStudioProviderSafeComposition = ({
  compositionPackage,
  governanceConstraints = [],
  methodGuidance = [],
  providerDescriptor,
  safeRequest,
  styleGuidance = [],
} = {}) => {
  assertProviderDescriptor(providerDescriptor)
  assertOutcomeStudioProviderSafeRequest(safeRequest)
  if (!safeToken(providerDescriptor.providerKey)
    || !safeToken(providerDescriptor.model)
    || !safeToken(providerDescriptor.providerMode)
    || !safeToken(providerDescriptor.environment)) fail()
  if (!isPlainObject(compositionPackage)
    || compositionPackage.contractVersion !== COMPOSITION_PACKAGE_CONTRACT
    || compositionPackage.status !== 'READY'
    || !isPlainObject(compositionPackage.businessFactLedger)
    || !Array.isArray(compositionPackage.businessFactLedger.facts)
    || compositionPackage.businessFactLedger.facts.length === 0) fail()
  const businessFacts = compositionPackage.businessFactLedger.facts.map(buildSafeCompositionFact)
  const outputStructure = buildSafeCompositionOutput(compositionPackage.outputBinding)
  const readiness = buildSafeCompositionReadiness(compositionPackage.readiness)
  if (comparableOutputContractKey(outputStructure.outputTypeKey)
    !== comparableOutputContractKey(safeRequest.businessRequest.outputTypeKey)) fail()
  const safeStyleGuidance = assertSafeBoundedArray(styleGuidance, { maxLength: 12, itemMaximum: 600 })
  const safeMethodGuidance = buildSafeMethodGuidance(methodGuidance)
  const safeGovernanceConstraints = assertSafeBoundedArray(governanceConstraints, { maxLength: 16, itemMaximum: 600 })
  const outputContract = buildSafeOutputContractResolution({
    compositionPackage,
    methodGuidance: safeMethodGuidance,
    outputStructure,
  })
  const composition = {
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT,
    businessRequest: {
      ...safeRequest.businessRequest,
    },
    businessFacts,
    outputContract,
    outputStructure,
    styleGuidance: safeStyleGuidance.map((entry) => boundText(entry, 600, 80)),
    methodGuidance: safeMethodGuidance,
    governanceConstraints: safeGovernanceConstraints.map((entry) => boundText(entry, 600, 80)),
    readiness,
    safetyManifest: buildSafeCompositionManifest({
      businessFacts,
      compositionPackage,
      governanceConstraints: safeGovernanceConstraints,
      methodGuidance: safeMethodGuidance,
      outputStructure,
      providerDescriptor,
      readiness,
      styleGuidance: safeStyleGuidance,
    }),
  }
  return assertOutcomeStudioProviderSafeComposition(composition)
}

export const assertOutcomeStudioProviderSafeComposition = (composition) => {
  if (!hasExactKeys(composition, COMPOSITION_KEYS)
    || composition.contractVersion !== OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT
    || !Array.isArray(composition.businessFacts)
    || composition.businessFacts.length === 0
    || !composition.outputContract
    || !hasExactKeys(composition.outputStructure, COMPOSITION_OUTPUT_KEYS)
    || !Array.isArray(composition.styleGuidance)
    || !Array.isArray(composition.methodGuidance)
    || !Array.isArray(composition.governanceConstraints)
    || !hasExactKeys(composition.readiness, COMPOSITION_READINESS_KEYS)
    || !hasExactKeys(composition.safetyManifest, COMPOSITION_SAFETY_KEYS)) fail()
  assertOutcomeStudioProviderSafeRequest({
    businessRequest: composition.businessRequest,
    draftContext: { content: '' },
    effectiveRequest: {
      executionIntent: composition.businessRequest.instruction,
      draftContext: { content: '' },
    },
  })
  composition.businessFacts.forEach((fact) => {
    if (!hasExactKeys(fact, COMPOSITION_FACT_KEYS)
      || !hasExactKeys(fact.sourceAttribution, COMPOSITION_SOURCE_ATTRIBUTION_KEYS)
      || typeof fact.statement !== 'string'
      || !fact.statement.trim()
      || typeof fact.claimPermission !== 'string'
      || typeof fact.currentness !== 'string'
      || !Array.isArray(fact.qualification)
      || !Array.isArray(fact.sectionKeys)
      || fact.sectionKeys.length === 0) fail()
    assertSafeRawString(fact.statement)
    assertSafeRawString(fact.claimPermission)
    assertSafeRawString(fact.currentness)
    assertSafeBoundedArray(fact.qualification, { maxLength: 8, itemMaximum: 240 })
    assertSafeBoundedArray(fact.sectionKeys, { maxLength: 24, itemMaximum: 160 })
    Object.values(fact.sourceAttribution).forEach(assertSafeRawString)
  })
  buildSafeOutputContractResolution({
    compositionPackage: { outputContractResolution: composition.outputContract },
    methodGuidance: composition.methodGuidance,
    outputStructure: composition.outputStructure,
  })
  const outputStructure = composition.outputStructure
  assertSafeBoundedArray(outputStructure.outputTypeStructure, { maxLength: 5, itemMaximum: 240 })
  assertSafeBoundedArray(outputStructure.requiredSections, { maxLength: 24, itemMaximum: 160 })
  assertSafeBoundedArray(outputStructure.optionalSections, { maxLength: 12, itemMaximum: 160 })
  Object.entries(outputStructure)
    .filter(([, value]) => typeof value === 'string')
    .forEach(([, value]) => assertSafeRawString(value))
  assertSafeBoundedArray(composition.styleGuidance, { maxLength: 12, itemMaximum: 600 })
  buildSafeMethodGuidance(composition.methodGuidance)
  assertSafeBoundedArray(composition.governanceConstraints, { maxLength: 16, itemMaximum: 600 })
  buildSafeCompositionReadiness(composition.readiness)
  const safetyManifest = composition.safetyManifest
  if (safetyManifest.manifestVersion !== OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT
    || !safeToken(safetyManifest.providerKey)
    || !safeToken(safetyManifest.model)
    || !safeToken(safetyManifest.providerMode)
    || !safeToken(safetyManifest.environment)
    || !Object.entries(safetyManifest)
      .filter(([key]) => key.endsWith('Check') || key === 'contentSafetyStatus')
      .every(([, value]) => value === COMPOSITION_SAFE_CHECK_STATUS)
    || !Array.isArray(safetyManifest.requiredEvidenceRefs)
    || safetyManifest.requiredEvidenceRefs.length !== composition.businessFacts.length
    || safetyManifest.requiredEvidenceRefs.some((value) => !/^ref_[a-f0-9]{16}$/.test(value))
    || new Set(safetyManifest.requiredEvidenceRefs).size !== safetyManifest.requiredEvidenceRefs.length
    || safetyManifest.businessFactCount !== composition.businessFacts.length
    || !Number.isInteger(safetyManifest.omittedReferenceCount)
    || safetyManifest.omittedReferenceCount < 0
    || !Number.isInteger(safetyManifest.contradictionCount)
    || safetyManifest.contradictionCount < 0
    || safetyManifest.requiredSectionCount !== outputStructure.requiredSections.length
    || !Number.isInteger(safetyManifest.styleGuidanceCount)
    || safetyManifest.styleGuidanceCount !== composition.styleGuidance.length
    || !Number.isInteger(safetyManifest.methodGuidanceCount)
    || safetyManifest.methodGuidanceCount !== composition.methodGuidance.length
    || !Number.isInteger(safetyManifest.governanceConstraintCount)
    || safetyManifest.governanceConstraintCount !== composition.governanceConstraints.length
    || safetyManifest.readinessStatus !== composition.readiness.status
    || safetyManifest.readinessGapCount !== composition.readiness.gapCount
    || safetyManifest.draftOnly !== composition.readiness.draftOnly) fail()
  if (JSON.stringify(composition).length > SAFE_CONTEXT_LIMIT) fail()
  return composition
}

const projectTruthSummaries = (truthSource) => {
  if (!hasExactKeys(truthSource, TRUTH_SOURCE_KEYS) || !Array.isArray(truthSource.acceptedTruth)) fail()
  for (const item of truthSource.acceptedTruth) {
    if (!hasExactKeys(item, TRUTH_ITEM_KEYS) || typeof item.label !== 'string' || typeof item.content !== 'string') fail()
    assertSafeRawString(item.label)
    assertSafeRawString(item.content.replace(new RegExp(URL_PATTERN.source, 'gi'), ' '))
  }
  return truthSource.acceptedTruth.slice(0, 20).map((item) => {
    const customerSafeContent = item.content.replace(new RegExp(URL_PATTERN.source, 'gi'), ' ')
    return {
      label: boundText(item.label, 160, 144),
      summary: boundText(customerSafeContent, 900, 810),
    }
  }).filter((item) => item.label && item.summary)
}

const markdownHeading = (line) => line.match(/^#{1,4}\s+(.{1,120})$/)?.[1]?.trim() || ''
const plainHeading = (line, nextLine) => {
  if (!/^[A-Z][A-Za-z0-9 &'()\/, _-]{0,118}:?$/.test(line)
    || /[.?!;]$/.test(line)
    || line.trim().split(/\s+/).length > 12
    || !nextLine
    || markdownHeading(nextLine)
    || /^[A-Z][A-Za-z0-9 &'()\/, _-]{0,118}:?$/.test(nextLine)) return ''
  return line.replace(/:$/, '').trim()
}

const parseSections = (content, diagnosticState) => {
  const lines = content.split(/\r?\n/)
  const nonEmptyLineCount = lines.filter((line) => line.trim()).length
  diagnosticState.observedCount = Math.max(diagnosticState.observedCount, nonEmptyLineCount)
  if (nonEmptyLineCount > MAX_PACK_NON_EMPTY_LINES) {
    failGuidanceProjection('PACK_CONTENT_TOO_MANY_LINES')
  }
  const sections = []
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    const next = lines.slice(index + 1).find((candidate) => candidate.trim())?.trim() || ''
    const heading = markdownHeading(line) || plainHeading(line, next)
    if (heading) {
      if (current) sections.push(current)
      current = { heading, lines: [] }
    } else if (current) current.lines.push(line)
  }
  if (current) sections.push(current)
  return sections
}

const cleanGuidance = (section) => boundText(
  `${section.heading}. ${section.lines.join(' ')}`
    .replace(/(?:^|\s)[#>*_`~-]+(?=\s|$)/g, ' '),
  600,
  540,
)

const KNOWLEDGE_LAYER_GUIDANCE_CATEGORY = Object.freeze({
  [KNOWLEDGE_PACK_LAYERS.FOUNDATION]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.DOMAIN]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.SOLUTION]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.ORGANISATION]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.RUNTIME]: 'reasoningGuidance',
  [KNOWLEDGE_PACK_LAYERS.SYSTEM]: 'reasoningGuidance',
  [KNOWLEDGE_PACK_LAYERS.REASONING]: 'reasoningGuidance',
  [KNOWLEDGE_PACK_LAYERS.FRAMEWORK]: 'reasoningGuidance',
  [KNOWLEDGE_PACK_LAYERS.AUDIENCE]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.INDUSTRY]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.OUTPUT_TYPE]: 'businessInstructions',
  [KNOWLEDGE_PACK_LAYERS.OUTPUT_SCHEMA]: 'outputSchema',
  [KNOWLEDGE_PACK_LAYERS.COMMUNICATION_PATTERN]: 'reasoningGuidance',
  [KNOWLEDGE_PACK_LAYERS.STYLE]: 'styleGuidance',
  [KNOWLEDGE_PACK_LAYERS.CHANNEL]: 'styleGuidance',
  [KNOWLEDGE_PACK_LAYERS.BRAND]: 'styleGuidance',
  [KNOWLEDGE_PACK_LAYERS.LANGUAGE]: 'styleGuidance',
  [KNOWLEDGE_PACK_LAYERS.VISUAL_SYSTEM]: 'styleGuidance',
  [KNOWLEDGE_PACK_LAYERS.VALIDATION]: 'validationCriteria',
})

const missingKnowledgeLayerMappings = Object.values(KNOWLEDGE_PACK_LAYERS)
  .filter((layer) => !KNOWLEDGE_LAYER_GUIDANCE_CATEGORY[layer])
if (missingKnowledgeLayerMappings.length > 0) {
  throw new Error(
    `Knowledge Pack provider projection mapping missing: ${missingKnowledgeLayerMappings.join(', ')}`,
  )
}

const categoryForSection = ({ heading, knowledgeLayer, executionMode }) => {
  const normalized = heading.toLowerCase().replace(/:$/, '').trim()
  if (METADATA_HEADINGS.has(normalized)) return null
  if (executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.PRE_VALIDATION || executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION) return 'validationCriteria'
  if (/prohibited|boundary|avoid|must[- ]?not/.test(normalized)) return 'prohibitedOutputBoundaries'
  if (/validation|criteria|requirement|truth|evidence/.test(normalized)) return 'validationCriteria'
  if (/style|voice|tone|format|typography|brand|chart|composition/.test(normalized)) return 'styleGuidance'
  if (/schema|structure|section|presentation/.test(normalized)) return 'outputSchema'
  if (KNOWLEDGE_LAYER_GUIDANCE_CATEGORY[knowledgeLayer]) {
    return KNOWLEDGE_LAYER_GUIDANCE_CATEGORY[knowledgeLayer]
  }
  return null
}

const projectGuidanceCandidates = (versions, selectionById, diagnosticState) => {
  const candidatesByCategory = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, []]))
  const seen = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, new Set()]))
  const indexByIdentity = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, new Map()]))
  const safeCandidateEntryCountsByVersionId = new Map(
    versions.map((version) => [version.versionId, 0]),
  )
  const originsByCandidate = new Map()
  const discardedCountsByReason = emptyDiscardCounts()
  for (const version of versions) {
    const selection = selectionById.get(version.versionId)
    const content = version.content
    if (typeof content !== 'string') failGuidanceProjection('PACK_CONTENT_TYPE_INVALID')
    if (content.length > MAX_PACK_CONTENT_LENGTH) failGuidanceProjection('PACK_CONTENT_TOO_LARGE')
    if (hasMalformedUtf16(content)) failGuidanceProjection('PACK_CONTENT_MALFORMED')
    if (CONTROL_PATTERN.test(content)) failGuidanceProjection('PACK_CONTENT_CONTROL_CHARACTER')
    if (containsDirectPiiOrCredential(withoutDirectIdentifiers(content))) {
      failGuidanceProjection('PACK_CONTENT_PII_OR_CREDENTIAL')
    }
    for (const section of parseSections(content, diagnosticState)) {
      const completeSection = `${section.heading}\n${section.lines.join('\n')}`
      if (containsDiscardablePackContent(completeSection)) {
        discardedCountsByReason.discardableSection += 1
        continue
      }
      const category = categoryForSection({ heading: section.heading, ...selection })
      if (!category) {
        discardedCountsByReason.unclassifiedSection += 1
        continue
      }
      const entry = cleanGuidance(section)
      const identity = entry.toLowerCase()
      if (!entry) {
        discardedCountsByReason.emptySection += 1
        continue
      }
      if (seen[category].has(identity)) {
        const candidateIndex = indexByIdentity[category].get(identity)
        const candidate = candidatesByCategory[category][candidateIndex]
        if (candidate && !candidate.origins.has(version.versionId)) {
          candidate.origins.add(version.versionId)
          safeCandidateEntryCountsByVersionId.set(
            version.versionId,
            (safeCandidateEntryCountsByVersionId.get(version.versionId) || 0) + 1,
          )
        }
        discardedCountsByReason.duplicateSection += 1
        continue
      }
      seen[category].add(identity)
      indexByIdentity[category].set(identity, candidatesByCategory[category].length)
      candidatesByCategory[category].push({
        entry,
        origins: new Set([version.versionId]),
      })
      safeCandidateEntryCountsByVersionId.set(
        version.versionId,
        (safeCandidateEntryCountsByVersionId.get(version.versionId) || 0) + 1,
      )
    }
  }
  const guidance = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, []]))
  const versionOrder = versions.map((version) => version.versionId)
  for (const category of GUIDANCE_KEYS) {
    const candidates = candidatesByCategory[category]
    const selectedIndexes = []
    const selected = new Set()
    const selectCandidate = (candidateIndex) => {
      if (candidateIndex < 0 || selected.has(candidateIndex) || selectedIndexes.length >= MAX_GUIDANCE_ENTRIES) return
      selected.add(candidateIndex)
      selectedIndexes.push(candidateIndex)
    }
    for (const versionId of versionOrder) {
      selectCandidate(candidates.findIndex((candidate, candidateIndex) => (
        !selected.has(candidateIndex) && candidate.origins.has(versionId)
      )))
    }
    for (let index = 0; index < candidates.length && selectedIndexes.length < MAX_GUIDANCE_ENTRIES; index += 1) {
      selectCandidate(index)
    }
    discardedCountsByReason.categoryLimit += Math.max(0, candidates.length - selectedIndexes.length)
    for (const candidateIndex of selectedIndexes) {
      const targetIndex = guidance[category].length
      guidance[category].push(candidates[candidateIndex].entry)
      originsByCandidate.set(`${category}:${targetIndex}`, candidates[candidateIndex].origins)
    }
  }
  return {
    discardedCountsByReason,
    guidance,
    originsByCandidate,
    safeCandidateEntryCountsByVersionId,
  }
}

const cloneGuidance = () => Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, []]))
const fits = (context) => JSON.stringify(context).length <= SAFE_CONTEXT_LIMIT

const admitGuidance = (baseContext, candidates, evidenceState = null) => {
  const context = { ...baseContext, guidance: cloneGuidance() }
  if (!fits(context)) fail()
  const admitted = new Set()
  const admit = (category, index, required) => {
    const value = candidates[category]?.[index]
    if (!value) {
      if (required) fail()
      evidenceState?.rejectedCandidateKeys?.add(`${category}:${index}`)
      return false
    }
    const candidate = {
      ...context,
      guidance: { ...context.guidance, [category]: [...context.guidance[category], value] },
    }
    if (!fits(candidate)) {
      if (required) fail()
      evidenceState?.rejectedCandidateKeys?.add(`${category}:${index}`)
      return false
    }
    context.guidance = candidate.guidance
    admitted.add(`${category}:${index}`)
    evidenceState?.admittedCandidateKeys?.add(`${category}:${index}`)
    return true
  }

  if (candidates.prohibitedOutputBoundaries.length) admit('prohibitedOutputBoundaries', 0, true)
  admit('validationCriteria', 0, true)
  admit('outputSchema', 0, true)
  admit('styleGuidance', 0, true)
  const primary = candidates.businessInstructions.length ? 'businessInstructions' : 'reasoningGuidance'
  const secondary = primary === 'businessInstructions' ? 'reasoningGuidance' : 'businessInstructions'
  admit(primary, 0, true)
  if (candidates[secondary].length) admit(secondary, 0, true)

  const order = ['prohibitedOutputBoundaries', 'validationCriteria', 'outputSchema', 'styleGuidance', 'businessInstructions', 'reasoningGuidance']
  for (let index = 0; index < MAX_GUIDANCE_ENTRIES; index += 1) {
    for (const category of order) {
      if (!admitted.has(`${category}:${index}`)) admit(category, index, false)
    }
  }
  return context
}

const assertExecutionBindings = ({ executionBindings, knowledgeSelection, versions }) => {
  if (!Array.isArray(executionBindings)
    || executionBindings.length !== knowledgeSelection.length
    || executionBindings.length !== versions.length) fail()
  const bindingByVersionId = new Map()
  for (const binding of executionBindings) {
    if (!hasExactKeys(binding, EXECUTION_BINDING_KEYS)
      || !safeToken(binding.versionId)
      || !/^sha256:[a-f0-9]{64}$/.test(binding.contentHash)
      || bindingByVersionId.has(binding.versionId)) fail()
    bindingByVersionId.set(binding.versionId, binding)
  }
  for (const selection of knowledgeSelection) {
    const binding = bindingByVersionId.get(selection.versionId)
    const version = versions.find((candidate) => candidate.versionId === selection.versionId)
    if (!binding || !version || version.contentHash !== binding.contentHash) fail()
  }
  return bindingByVersionId
}

const buildExecutionEvidenceReceipt = ({
  executionBindings,
  knowledgeSelection,
  originsByCandidate,
  admittedCandidateKeys,
  rejectedCandidateKeys,
  safeCandidateEntryCountsByVersionId,
  generationContextConsumption = [],
} = {}) => {
  const status = OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES
  const directByVersionId = new Map(generationContextConsumption.map((entry) => [entry.versionId, entry]))
  return {
    contractVersion: OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT,
    providerContextContractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    packs: knowledgeSelection.map((selection) => {
      const projectedCandidateKeys = Array.from(originsByCandidate.entries())
        .filter(([, origins]) => origins.has(selection.versionId))
        .map(([key]) => key)
      const admittedKeys = projectedCandidateKeys.filter((key) => admittedCandidateKeys.has(key))
      const directContribution = directByVersionId.get(selection.versionId)
      const directItemCount = directContribution?.contributions.reduce(
        (count, contribution) => count + contribution.itemFingerprints.length,
        0,
      ) || 0
      const categories = Array.from(new Set([
        ...admittedKeys.map((key) => key.split(':')[0]),
        ...(directContribution?.contributions.map((contribution) => contribution.surface) || []),
      ]))
      const sharedContribution = admittedKeys.some((key) => originsByCandidate.get(key)?.size > 1)
      const projected = projectedCandidateKeys.length > 0 || directItemCount > 0
      const supplied = admittedKeys.length > 0 || directItemCount > 0
      const safeCandidateEntryCount = Math.max(
        0,
        Number(safeCandidateEntryCountsByVersionId?.get(selection.versionId) || 0),
      )
      const projectionDisposition = projected
        ? SAFE_CANDIDATE_DISPOSITIONS.PROJECTED
        : safeCandidateEntryCount > 0
          ? SAFE_CANDIDATE_DISPOSITIONS.CATEGORY_LIMITED
          : SAFE_CANDIDATE_DISPOSITIONS.NO_SAFE_GUIDANCE
      const admissionDisposition = supplied
        ? ADMISSION_DISPOSITIONS.ADMITTED
        : projectedCandidateKeys.some((key) => rejectedCandidateKeys?.has(key))
          ? ADMISSION_DISPOSITIONS.CONTEXT_LIMIT
          : ADMISSION_DISPOSITIONS.NOT_APPLICABLE
      const checks = [
        ['RESOLUTION_VERIFIED', status.PASSED, 'Selected activation/version content hash verified.'],
        ['VERSION_CONTENT_LOADED', status.PASSED, 'Exact selected version content loaded.'],
        ['SAFE_GUIDANCE_PROJECTED', projected ? status.PASSED : status.NOT_SUPPLIED,
          projected ? `${projectedCandidateKeys.length + directItemCount} exact safe entries projected.` : 'No safe guidance entry was projected from this version.'],
        ['PROVIDER_CONTEXT_SUPPLIED', supplied ? status.PASSED : status.NOT_SUPPLIED,
          supplied
            ? `${admittedKeys.length + directItemCount} exact entries supplied${sharedContribution ? ' with shared/deduplicated attribution' : ''}.`
            : 'No guidance entry from this version was admitted to provider context.'],
        ['PROVIDER_COMPLETED', status.NOT_RECORDED, 'Provider completion is recorded only after the adapter returns.'],
      ].map(([key, checkStatus, message]) => ({ key, status: checkStatus, message }))
      const overallStatus = checks.every((check) => check.status === status.PASSED)
        ? status.PASSED
        : checks.some((check) => check.status === status.FAILED)
          ? status.FAILED
          : checks.some((check) => check.status === status.NOT_SUPPLIED)
            ? status.NOT_SUPPLIED
            : status.NOT_RECORDED
      return {
        versionId: selection.versionId,
        contentHash: executionBindings.find((binding) => binding.versionId === selection.versionId)?.contentHash || '',
        knowledgeLayer: selection.knowledgeLayer,
        executionMode: selection.executionMode,
        packType: selection.packType || '',
        boundary: resolveKnowledgePackBoundary(selection),
        receiptType: resolveKnowledgePackReceiptType(selection),
        projectedEntryCount: projectedCandidateKeys.length + directItemCount,
        safeCandidateEntryCount,
        suppliedEntryCount: admittedKeys.length + directItemCount,
        suppliedCategories: categories,
        sharedContribution,
        projectionDisposition,
        admissionDisposition,
        status: overallStatus,
        checks,
      }
    }),
  }
}

const loadSelectedVersions = async (knowledgeSelection) => {
  const versionIds = knowledgeSelection.map((selection) => selection.versionId)
  let query = KnowledgePackVersion.find({ versionId: { $in: versionIds } }).select('+content')
  if (typeof query?.lean === 'function') query = query.lean()
  const versions = await query
  if (!Array.isArray(versions)
    || versions.length !== versionIds.length
    || new Set(versions.map((version) => version.versionId)).size !== versionIds.length
    || versionIds.some((versionId) => !versions.some((version) => version.versionId === versionId))) fail()
  const byId = new Map(versions.map((version) => [version.versionId, version]))
  return versionIds.map((versionId) => byId.get(versionId))
}

const assertFrameworkGuidanceReferences = (values, { field, maxLength }) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) fail()
  const seen = new Set()
  for (const value of values) {
    if (typeof value !== 'string'
      || value !== value.trim()
      || value.length > maxLength
      || !FRAMEWORK_GUIDANCE_REFERENCE_PATTERN.test(value)
      || seen.has(value)) fail()
    assertSafeRawString(value)
    seen.add(value)
  }
  return values
}

const assertFrameworkGuidancePackBindings = ({ expectedPackBindings, knowledgeSelection }) => {
  if (!Array.isArray(expectedPackBindings)
    || expectedPackBindings.length === 0
    || expectedPackBindings.length > MAX_SELECTED_VERSIONS
    || !Array.isArray(knowledgeSelection)
    || expectedPackBindings.length !== knowledgeSelection.length) fail()
  const versionIds = new Set()
  for (const binding of expectedPackBindings) {
    if (!isPlainObject(binding)
      || !hasExactKeys(binding, ['versionId', 'contentHash', 'knowledgeLayer', 'executionMode'])
      || !safeToken(binding.versionId)
      || typeof binding.contentHash !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(binding.contentHash)
      || !Object.values(KNOWLEDGE_PACK_LAYERS).includes(binding.knowledgeLayer)
      || !Object.values(KNOWLEDGE_PACK_EXECUTION_MODES).includes(binding.executionMode)
      || binding.executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY
      || versionIds.has(binding.versionId)) fail()
    versionIds.add(binding.versionId)
  }
  if (JSON.stringify(expectedPackBindings.map(({ versionId, knowledgeLayer, executionMode }) => ({
    versionId,
    knowledgeLayer,
    executionMode,
  }))) !== JSON.stringify(knowledgeSelection)) fail()
  return expectedPackBindings
}

const assertFrameworkGuidanceTruthBindings = ({ expectedTruthBindings, truthSource }) => {
  if (!Array.isArray(expectedTruthBindings)
    || expectedTruthBindings.length === 0
    || expectedTruthBindings.length > 20
    || !hasExactKeys(truthSource, TRUTH_SOURCE_KEYS)
    || !Array.isArray(truthSource.acceptedTruth)
    || expectedTruthBindings.length !== truthSource.acceptedTruth.length) fail()
  const seen = new Set()
  for (const binding of expectedTruthBindings) {
    if (!isPlainObject(binding)
      || !hasExactKeys(binding, ['sectionKey', 'content'])
      || typeof binding.content !== 'string'
      || !binding.content.trim()
      || seen.has(binding.sectionKey)) fail()
    assertFrameworkGuidanceReferences([binding.sectionKey], { field: 'sectionKey', maxLength: 140 })
    assertSafeRawString(binding.content.replace(new RegExp(URL_PATTERN.source, 'gi'), ' '))
    seen.add(binding.sectionKey)
  }
  const expectedContents = expectedTruthBindings.map((binding) => binding.content).sort()
  const suppliedContents = truthSource.acceptedTruth.map((item) => item?.content).sort()
  if (JSON.stringify(expectedContents) !== JSON.stringify(suppliedContents)) fail()
  return {
    acceptedTruth: expectedTruthBindings.map(({ sectionKey, content }) => ({ label: sectionKey, content })),
  }
}

export const buildOutcomeStudioProviderSafeContext = async ({
  providerDescriptor,
  safeRequest,
  truthSource,
  knowledgeSelection,
  executionBindings,
  captureExecutionEvidence,
  compositionPackage,
  methodGuidance = [],
  governanceConstraints = [],
  generationContextConsumption,
  generationContextConsumptionFingerprint,
} = {}) => {
  let stage = 'REQUEST_VALIDATION'
  let selectedCount = 0
  let foundCount = 0
  let discardedCountsByReason = emptyDiscardCounts()
  let admittedCountsByCategory = emptyCategoryCounts()
  let missingCategories = []
  const diagnosticState = { observedCount: 0 }
  try {
    assertProviderDescriptor(providerDescriptor)
    assertOutcomeStudioProviderSafeRequest(safeRequest)
    stage = 'TRUTH_PROJECTION'
    const truthSummaries = projectTruthSummaries(truthSource)
    stage = 'KNOWLEDGE_SELECTION_VALIDATION'
    if (!Array.isArray(knowledgeSelection) || knowledgeSelection.length === 0 || knowledgeSelection.length > MAX_SELECTED_VERSIONS) fail()
    selectedCount = knowledgeSelection.length
    const versionIds = new Set()
    for (const selection of knowledgeSelection) {
      const selectionHasBaseKeys = hasExactKeys(selection, KNOWLEDGE_SELECTION_KEYS)
      const selectionHasOptionalPackType = hasExactKeys(selection, [...KNOWLEDGE_SELECTION_KEYS, 'packType'])
      if ((!selectionHasBaseKeys && !selectionHasOptionalPackType)
        || !safeToken(selection.versionId)
        || !Object.values(KNOWLEDGE_PACK_LAYERS).includes(selection.knowledgeLayer)
        || !Object.values(KNOWLEDGE_PACK_EXECUTION_MODES).includes(selection.executionMode)
        || resolveKnowledgePackBoundary(selection) !== KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT
        || versionIds.has(selection.versionId)) fail()
      versionIds.add(selection.versionId)
    }
    stage = 'SELECTED_VERSION_LOOKUP'
    const versions = await loadSelectedVersions(knowledgeSelection)
    foundCount = versions.length
    if (executionBindings !== undefined || typeof captureExecutionEvidence === 'function') {
      assertExecutionBindings({ executionBindings, knowledgeSelection, versions })
    }
    const selectionById = new Map(knowledgeSelection.map((selection) => [selection.versionId, selection]))
    stage = 'GUIDANCE_PROJECTION'
    const projection = projectGuidanceCandidates(versions, selectionById, diagnosticState)
    const candidates = projection.guidance
    discardedCountsByReason = projection.discardedCountsByReason
    admittedCountsByCategory = Object.fromEntries(
      GUIDANCE_KEYS.map((key) => [key, candidates[key].length]),
    )
    missingCategories = [
      ...(!candidates.businessInstructions.length && !candidates.reasoningGuidance.length
        ? ['businessInstructionsOrReasoningGuidance']
        : []),
      ...['validationCriteria', 'outputSchema', 'styleGuidance']
        .filter((key) => !candidates[key].length),
    ]
    stage = 'REQUIRED_GUIDANCE_ADMISSION'
    if (missingCategories.length) fail()
    const evidenceState = {
      admittedCandidateKeys: new Set(),
      rejectedCandidateKeys: new Set(),
    }
    const context = admitGuidance({
      contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
      businessRequest: { ...safeRequest.businessRequest },
      draftContext: { ...safeRequest.draftContext },
      truthSummaries,
      safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    }, candidates, evidenceState)
    admittedCountsByCategory = Object.fromEntries(
      GUIDANCE_KEYS.map((key) => [key, context.guidance[key].length]),
    )
    stage = 'CONTEXT_VALIDATION'
    const providerComposition = compositionPackage === undefined
      ? null
      : buildOutcomeStudioProviderSafeComposition({
          compositionPackage,
          governanceConstraints,
          methodGuidance,
          providerDescriptor,
          safeRequest,
          styleGuidance: context.guidance.styleGuidance,
        })
    let validatedConsumption = { generationContextConsumption: [] }
    if (providerComposition) {
      stage = 'DIRECT_CONSUMPTION_VALIDATION'
      validatedConsumption = assertOutcomeStudioGenerationContextConsumption({
        executionBindings,
        generationContextConsumption,
        generationContextConsumptionFingerprint,
        knowledgeSelection,
        methodGuidance,
        providerComposition,
      })
    }
    const contextWithComposition = providerComposition
      ? { ...context, composition: providerComposition }
      : context
    const validatedContext = assertOutcomeStudioProviderSafeContext(contextWithComposition)
    if (typeof captureExecutionEvidence === 'function') {
      const receipt = buildExecutionEvidenceReceipt({
        executionBindings,
        knowledgeSelection,
        originsByCandidate: projection.originsByCandidate,
        admittedCandidateKeys: evidenceState.admittedCandidateKeys,
        rejectedCandidateKeys: evidenceState.rejectedCandidateKeys,
        safeCandidateEntryCountsByVersionId: projection.safeCandidateEntryCountsByVersionId,
        generationContextConsumption: validatedConsumption.generationContextConsumption,
      })
      if (providerComposition) receipt.providerRequestManifest = providerComposition
      captureExecutionEvidence(receipt)
    }
    return validatedContext
  } catch (error) {
    logSafeContextFailure({
      admittedCountsByCategory,
      discardedCountsByReason,
      foundCount,
      missingCategories,
      observedCount: diagnosticState.observedCount,
      reasonCode: error?.internalSafeContextReasonCode,
      selectedCount,
      stage,
    })
    if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') {
      throw enrichAppError(error, { stage, reasonCode: error.internalSafeContextReasonCode })
    }
    throw appError({ stage })
  }
}

export const buildOutcomeFrameworkGuidanceProviderSafeContext = async ({
  providerDescriptor,
  safeRequest,
  truthSource,
  knowledgeSelection,
  expectedTruthBindings,
  expectedPackBindings,
  truthReferenceKeys,
  activationReferenceIds,
} = {}) => {
  let stage = 'REQUEST_VALIDATION'
  let selectedCount = 0
  let foundCount = 0
  let discardedCountsByReason = emptyDiscardCounts()
  let admittedCountsByCategory = emptyCategoryCounts()
  const diagnosticState = { observedCount: 0 }
  try {
    assertProviderDescriptor(providerDescriptor)
    assertOutcomeStudioProviderSafeRequest(safeRequest)
    assertFrameworkGuidanceReferences(truthReferenceKeys, { field: 'truthReferenceKeys', maxLength: 140 })
    assertFrameworkGuidanceReferences(activationReferenceIds, { field: 'activationReferenceIds', maxLength: 180 })
    stage = 'TRUTH_PROJECTION'
    const boundTruthSource = assertFrameworkGuidanceTruthBindings({ expectedTruthBindings, truthSource })
    if (JSON.stringify(truthReferenceKeys) !== JSON.stringify(expectedTruthBindings.map(({ sectionKey }) => sectionKey))) fail()
    const truthSummaries = projectTruthSummaries(boundTruthSource)
    stage = 'KNOWLEDGE_SELECTION_VALIDATION'
    selectedCount = Array.isArray(knowledgeSelection) ? knowledgeSelection.length : 0
    const packBindings = assertFrameworkGuidancePackBindings({ expectedPackBindings, knowledgeSelection })
    stage = 'SELECTED_VERSION_LOOKUP'
    const versions = await loadSelectedVersions(knowledgeSelection)
    foundCount = versions.length
    if (versions.some((version, index) => version.contentHash !== packBindings[index].contentHash)) fail()
    stage = 'GUIDANCE_PROJECTION'
    const selectionById = new Map(knowledgeSelection.map((selection) => [selection.versionId, selection]))
    const projection = projectGuidanceCandidates(versions, selectionById, diagnosticState)
    discardedCountsByReason = projection.discardedCountsByReason
    const candidates = Object.fromEntries(GUIDANCE_KEYS.map((key) => [
      key,
      [
        ...(FRAMEWORK_GUIDANCE_APPLICATION_GUIDANCE[key] || []),
        ...(projection.guidance[key] || []),
      ],
    ]))
    admittedCountsByCategory = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, candidates[key].length]))
    stage = 'REQUIRED_GUIDANCE_ADMISSION'
    if (!candidates.validationCriteria.length) fail()
    const context = admitGuidance({
      contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
      businessRequest: { ...safeRequest.businessRequest },
      draftContext: { ...safeRequest.draftContext },
      truthSummaries,
      safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    }, candidates)
    admittedCountsByCategory = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, context.guidance[key].length]))
    stage = 'CONTEXT_VALIDATION'
    return assertOutcomeStudioProviderSafeContext(context)
  } catch (error) {
    logSafeContextFailure({
      admittedCountsByCategory,
      discardedCountsByReason,
      foundCount,
      missingCategories: [],
      observedCount: diagnosticState.observedCount,
      reasonCode: error?.internalSafeContextReasonCode,
      selectedCount,
      stage,
    })
    if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') {
      throw enrichAppError(error, { stage, reasonCode: error.internalSafeContextReasonCode })
    }
    throw appError({ stage })
  }
}

export const assertOutcomeStudioProviderSafeContext = (providerContext) => {
  const baseKeys = ['contractVersion', 'businessRequest', 'draftContext', 'truthSummaries', 'guidance', 'safeguards']
  const hasComposition = hasExactKeys(providerContext, [...baseKeys, 'composition'])
  if ((!hasExactKeys(providerContext, baseKeys) && !hasComposition)
    || providerContext.contractVersion !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || !hasExactKeys(providerContext.guidance, GUIDANCE_KEYS)
    || !Array.isArray(providerContext.truthSummaries)
    || providerContext.truthSummaries.length > 20
    || !Array.isArray(providerContext.safeguards)
    || JSON.stringify(providerContext.safeguards) !== JSON.stringify(OUTCOME_STUDIO_PROVIDER_SAFEGUARDS)) fail()

  assertOutcomeStudioProviderSafeRequest({
    businessRequest: providerContext.businessRequest,
    draftContext: providerContext.draftContext,
    effectiveRequest: {
      executionIntent: providerContext.businessRequest?.instruction,
      draftContext: providerContext.draftContext,
    },
  })

  for (const item of providerContext.truthSummaries) {
    if (!hasExactKeys(item, ['label', 'summary'])
      || !safeToken(item.label)
      || typeof item.summary !== 'string'
      || !item.summary.trim()
      || item.summary.length > 900) fail()
    assertSafeRawString(item.label)
    assertSafeRawString(item.summary)
  }
  for (const key of GUIDANCE_KEYS) {
    const entries = providerContext.guidance[key]
    if (!Array.isArray(entries) || entries.length > MAX_GUIDANCE_ENTRIES) fail()
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.trim() || entry.length > 600) fail()
      assertSafeRawString(entry)
    }
  }
  if (hasComposition) assertOutcomeStudioProviderSafeComposition(providerContext.composition)
  if ((!providerContext.guidance.businessInstructions.length && !providerContext.guidance.reasoningGuidance.length)
    || !providerContext.guidance.outputSchema.length
    || !providerContext.guidance.styleGuidance.length
    || !providerContext.guidance.validationCriteria.length
    || !fits(providerContext)) {
    fail()
  }
  return providerContext
}

export default {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeComposition,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeFrameworkGuidanceProviderSafeContext,
  buildOutcomeStudioProviderSafeComposition,
  buildOutcomeStudioProviderSafeRequest,
  buildOutcomeStudioProviderSafeContext,
  buildOutcomeStudioGenerationContextConsumption,
  assertOutcomeStudioGenerationContextConsumption,
}
