import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import { KNOWLEDGE_PACK_EXECUTION_MODES, KNOWLEDGE_PACK_LAYERS } from '../constants/knowledgeRuntime.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import logger from '../config/logger.js'

const SAFE_CONTEXT_LIMIT = 18000
const MAX_SELECTED_VERSIONS = 24
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
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\s().-]*){10,15}(?!\w)/
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
const UK_NI_PATTERN = /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i
const US_SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/
const UK_POSTCODE_PATTERN = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i
const AUTH_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]+=*/i
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

const SAFE_CONTEXT_DIAGNOSTIC_REASONS = Object.freeze({
  REQUEST_VALIDATION: 'SAFE_REQUEST_INVALID',
  TRUTH_PROJECTION: 'TRUTH_PROJECTION_REJECTED',
  KNOWLEDGE_SELECTION_VALIDATION: 'KNOWLEDGE_SELECTION_INVALID',
  SELECTED_VERSION_LOOKUP: 'SELECTED_VERSION_LOOKUP_FAILED',
  GUIDANCE_PROJECTION: 'GUIDANCE_PROJECTION_REJECTED',
  REQUIRED_GUIDANCE_ADMISSION: 'REQUIRED_GUIDANCE_MISSING',
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

const appError = () => {
  const error = new Error('Provider-safe context could not be created.')
  error.status = 422
  error.code = 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED'
  error.details = {
    reason: 'PROVIDER_SAFE_CONTEXT_BLOCKED',
    safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  }
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

const digitRuns = (value) => value.match(/(?<!\d)(?:\d[\s-]*){13,19}(?!\d)/g) || []
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

const containsDirectPiiOrCredential = (value) => [
  EMAIL_PATTERN, PHONE_PATTERN, IPV4_PATTERN, UK_NI_PATTERN, US_SSN_PATTERN,
  UK_POSTCODE_PATTERN, AUTH_PATTERN, PRIVATE_KEY_PATTERN, SECRET_ASSIGNMENT_PATTERN,
  OPENAI_KEY_PATTERN, CONNECTION_STRING_PATTERN,
].some((pattern) => pattern.test(value)) || digitRuns(value).some(passesLuhn)

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

const categoryForSection = ({ heading, knowledgeLayer, executionMode }) => {
  const normalized = heading.toLowerCase().replace(/:$/, '').trim()
  if (METADATA_HEADINGS.has(normalized)) return null
  if (executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.PRE_VALIDATION || executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION) return 'validationCriteria'
  if (/prohibited|boundary|avoid|must[- ]?not/.test(normalized)) return 'prohibitedOutputBoundaries'
  if (/validation|criteria|requirement|truth|evidence/.test(normalized)) return 'validationCriteria'
  if (/style|voice|tone|format|typography|brand|chart|composition/.test(normalized)) return 'styleGuidance'
  if (/schema|structure|section|presentation/.test(normalized)) return 'outputSchema'
  if (knowledgeLayer === KNOWLEDGE_PACK_LAYERS.OUTPUT_TYPE) return 'businessInstructions'
  if (knowledgeLayer === KNOWLEDGE_PACK_LAYERS.OUTPUT_SCHEMA) return 'outputSchema'
  if ([KNOWLEDGE_PACK_LAYERS.STYLE, KNOWLEDGE_PACK_LAYERS.LANGUAGE, KNOWLEDGE_PACK_LAYERS.BRAND, KNOWLEDGE_PACK_LAYERS.VISUAL_SYSTEM].includes(knowledgeLayer)) return 'styleGuidance'
  if ([KNOWLEDGE_PACK_LAYERS.REASONING, KNOWLEDGE_PACK_LAYERS.FRAMEWORK, KNOWLEDGE_PACK_LAYERS.COMMUNICATION_PATTERN].includes(knowledgeLayer)) return 'reasoningGuidance'
  return null
}

const projectGuidanceCandidates = (versions, selectionById, diagnosticState) => {
  const guidance = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, []]))
  const seen = Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, new Set()]))
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
      if (guidance[category].length >= MAX_GUIDANCE_ENTRIES) {
        discardedCountsByReason.categoryLimit += 1
        continue
      }
      const entry = cleanGuidance(section)
      const identity = entry.toLowerCase()
      if (!entry) {
        discardedCountsByReason.emptySection += 1
        continue
      }
      if (seen[category].has(identity)) {
        discardedCountsByReason.duplicateSection += 1
        continue
      }
      seen[category].add(identity)
      guidance[category].push(entry)
    }
  }
  return { discardedCountsByReason, guidance }
}

const cloneGuidance = () => Object.fromEntries(GUIDANCE_KEYS.map((key) => [key, []]))
const fits = (context) => JSON.stringify(context).length <= SAFE_CONTEXT_LIMIT

const admitGuidance = (baseContext, candidates) => {
  const context = { ...baseContext, guidance: cloneGuidance() }
  if (!fits(context)) fail()
  const admitted = new Set()
  const admit = (category, index, required) => {
    const value = candidates[category]?.[index]
    if (!value) {
      if (required) fail()
      return false
    }
    const candidate = {
      ...context,
      guidance: { ...context.guidance, [category]: [...context.guidance[category], value] },
    }
    if (!fits(candidate)) {
      if (required) fail()
      return false
    }
    context.guidance = candidate.guidance
    admitted.add(`${category}:${index}`)
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

export const buildOutcomeStudioProviderSafeContext = async ({
  providerDescriptor,
  safeRequest,
  truthSource,
  knowledgeSelection,
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
      if (!hasExactKeys(selection, KNOWLEDGE_SELECTION_KEYS)
        || !safeToken(selection.versionId)
        || !Object.values(KNOWLEDGE_PACK_LAYERS).includes(selection.knowledgeLayer)
        || !Object.values(KNOWLEDGE_PACK_EXECUTION_MODES).includes(selection.executionMode)
        || selection.executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY
        || versionIds.has(selection.versionId)) fail()
      versionIds.add(selection.versionId)
    }
    stage = 'SELECTED_VERSION_LOOKUP'
    const versions = await loadSelectedVersions(knowledgeSelection)
    foundCount = versions.length
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
    const context = admitGuidance({
      contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
      businessRequest: { ...safeRequest.businessRequest },
      draftContext: { ...safeRequest.draftContext },
      truthSummaries,
      safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    }, candidates)
    admittedCountsByCategory = Object.fromEntries(
      GUIDANCE_KEYS.map((key) => [key, context.guidance[key].length]),
    )
    stage = 'CONTEXT_VALIDATION'
    return assertOutcomeStudioProviderSafeContext(context)
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
    if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') throw error
    throw appError()
  }
}

export const assertOutcomeStudioProviderSafeContext = (providerContext) => {
  if (!hasExactKeys(providerContext, ['contractVersion', 'businessRequest', 'draftContext', 'truthSummaries', 'guidance', 'safeguards'])
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
  if ((!providerContext.guidance.businessInstructions.length && !providerContext.guidance.reasoningGuidance.length)
    || !providerContext.guidance.outputSchema.length
    || !providerContext.guidance.styleGuidance.length
    || !providerContext.guidance.validationCriteria.length
    || !fits(providerContext)) fail()
  return providerContext
}

export default {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeStudioProviderSafeRequest,
  buildOutcomeStudioProviderSafeContext,
}
