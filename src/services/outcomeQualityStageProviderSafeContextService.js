import {
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  OUTCOME_STUDIO_PROVIDER_SAFEGUARDS,
} from './outcomeStudioProviderSafeContextService.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'

const MAX_SOURCE_CANDIDATE_BYTES = 120000
const MAX_TRUTH_SUMMARY_LENGTH = 900
const REFERENCE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,178}[a-z0-9])?$/
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\s().-]*){10,15}(?!\w)/
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+\/-]+=*/i
const SECRET_PATTERN = /\b(?:api[_ -]?key|secret|token|password)\s*[:=]\s*\S+/i
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/
const CONNECTION_PATTERN = /\b(?:mongodb(?:\+srv)?|redis|postgres(?:ql)?):\/\/\S+/i
const URL_PATTERN = /https?:\/\/\S+/i
const HASH_PATTERN = /(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])/i
const OBJECT_ID_PATTERN = /(?<![a-f0-9])[a-f0-9]{24}(?![a-f0-9])/i
const UUID_PATTERN = /(?<![a-f0-9])[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![a-f0-9])/i
const INTERNAL_METADATA_PATTERN = /\b(?:knowledge\s+pack|activation\s+id|runtime\s+artifact|provider\s+context|system\s+prompt|composition\s+provenance|stage\s+execution\s+id)\b/i
const SOURCE_KEYS = Object.freeze([
  'stageKey', 'outputType', 'schemaVersion', 'title', 'sections',
  'decisionUsefulness', 'assumptions', 'visibleGaps',
])
const SECTION_KEYS = Object.freeze([
  'order', 'sectionKey', 'title', 'analysis', 'implications', 'recommendations',
  'qualification', 'truthReferences', 'assumptions', 'gaps',
])
const DECISION_KEYS = Object.freeze([
  'summary', 'priorities', 'materialRisks', 'recommendedNextStep',
])
const CONTEXT_KEYS = Object.freeze([
  'contractVersion', 'businessRequest', 'draftContext', 'truthSummaries',
  'guidance', 'safeguards', 'targetStage', 'sourceCandidate',
])

const applicationGuidance = Object.freeze({
  businessInstructions: Object.freeze([
    'Create one Working Draft from the supplied verified truth and complete framework-guidance meaning. Preserve qualifications, uncertainty, assumptions and visible gaps.',
  ]),
  reasoningGuidance: Object.freeze([
    'Translate the supplied analytical meaning into coherent decision-ready draft sections without adding facts or claiming approval.',
  ]),
  outputSchema: Object.freeze([
    'Return versioned Working Draft sections, evidence-bound claims, decision logic, assumptions and visible gaps using only supplied semantic reference keys.',
  ]),
  styleGuidance: Object.freeze([
    'Use concise executive business language. Do not expose internal governance identifiers or create an Outcome Narrative Plan, rendered asset or final disposition.',
  ]),
  validationCriteria: Object.freeze([
    'Every accepted truth reference and every supplied framework-guidance section must remain materially represented. Required gaps stay visible.',
  ]),
  prohibitedOutputBoundaries: Object.freeze([
    'Meaning remains unapproved at Working Draft. Do not claim ARL approval, rendered-expression review, publication or final completion.',
  ]),
})

const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
)
const hasExactKeys = (value, keys) => isPlainObject(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
const plain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const text = (value) => String(value ?? '').trim()

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

const unsafeString = (value) => hasMalformedUtf16(value)
  || CONTROL_PATTERN.test(value)
  || EMAIL_PATTERN.test(value)
  || PHONE_PATTERN.test(value)
  || BEARER_PATTERN.test(value)
  || SECRET_PATTERN.test(value)
  || OPENAI_KEY_PATTERN.test(value)
  || CONNECTION_PATTERN.test(value)
  || URL_PATTERN.test(value)
  || HASH_PATTERN.test(value)
  || OBJECT_ID_PATTERN.test(value)
  || UUID_PATTERN.test(value)
  || INTERNAL_METADATA_PATTERN.test(value)

const assertSafeValue = (value) => {
  if (typeof value === 'string') {
    if (unsafeString(value)) throw new TypeError('Quality-stage provider context is unsafe.')
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeValue)
    return
  }
  if (isPlainObject(value)) Object.values(value).forEach(assertSafeValue)
}

const stringArray = (value, { min = 0 } = {}) => Array.isArray(value)
  && value.length >= min
  && value.every((item) => typeof item === 'string' && item.trim())

const projectTruthSummaries = (truthSource) => {
  if (!hasExactKeys(truthSource, ['acceptedTruth'])
    || !Array.isArray(truthSource.acceptedTruth)
    || truthSource.acceptedTruth.length < 1
    || truthSource.acceptedTruth.length > 20) {
    throw new TypeError('Accepted truth source is invalid.')
  }
  return truthSource.acceptedTruth.map((item) => {
    if (!hasExactKeys(item, ['label', 'content'])
      || !REFERENCE_PATTERN.test(text(item.label))
      || typeof item.content !== 'string') throw new TypeError('Accepted truth source is invalid.')
    if (URL_PATTERN.test(item.content)) throw new TypeError('Accepted truth source is invalid.')
    const summary = item.content.replace(/\s+/g, ' ')
      .trim()
    if (!summary || summary.length > MAX_TRUTH_SUMMARY_LENGTH) {
      throw new TypeError('Accepted truth source is invalid.')
    }
    return { label: text(item.label), summary }
  })
}

const projectFrameworkGuidanceCandidate = (sourceStageExecution) => {
  const source = plain(sourceStageExecution)
  const output = plain(source?.outputSnapshot)
  if (source?.stageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
    || source?.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || source?.outputFingerprint !== hashOutcomeQualityStageValue(output)
    || output?.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS
    || output?.schemaVersion !== OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION
    || !Array.isArray(output.sections)
    || output.sections.length < 1) throw new TypeError('Framework Guidance source is invalid.')
  const sections = output.sections.map((section, index) => {
    if (!section || section.order !== index + 1
      || !REFERENCE_PATTERN.test(text(section.sectionKey))
      || !stringArray(section.truthReferences, { min: 1 })) {
      throw new TypeError('Framework Guidance source section is invalid.')
    }
    return {
      order: section.order,
      sectionKey: text(section.sectionKey),
      title: text(section.title),
      analysis: text(section.analysis),
      implications: [...section.implications],
      recommendations: [...section.recommendations],
      qualification: text(section.qualification),
      truthReferences: [...section.truthReferences],
      assumptions: [...section.assumptions],
      gaps: [...section.gaps],
    }
  })
  return {
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    outputType: output.outputType,
    schemaVersion: output.schemaVersion,
    title: text(output.title),
    sections,
    decisionUsefulness: {
      summary: text(output.decisionUsefulness?.summary),
      priorities: [...(output.decisionUsefulness?.priorities || [])],
      materialRisks: [...(output.decisionUsefulness?.materialRisks || [])],
      recommendedNextStep: text(output.decisionUsefulness?.recommendedNextStep),
    },
    assumptions: [...output.assumptions],
    visibleGaps: [...output.visibleGaps],
  }
}

const assertSourceCandidate = (source) => {
  if (!hasExactKeys(source, SOURCE_KEYS)
    || source.stageKey !== OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
    || source.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS
    || source.schemaVersion !== OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION
    || !text(source.title)
    || !Array.isArray(source.sections)
    || source.sections.length < 1
    || !hasExactKeys(source.decisionUsefulness, DECISION_KEYS)
    || !text(source.decisionUsefulness.summary)
    || !stringArray(source.decisionUsefulness.priorities, { min: 1 })
    || !stringArray(source.decisionUsefulness.materialRisks)
    || !text(source.decisionUsefulness.recommendedNextStep)
    || !stringArray(source.assumptions)
    || !stringArray(source.visibleGaps)) throw new TypeError('Framework Guidance semantic candidate is invalid.')
  source.sections.forEach((section, index) => {
    if (!hasExactKeys(section, SECTION_KEYS)
      || section.order !== index + 1
      || !REFERENCE_PATTERN.test(section.sectionKey)
      || !text(section.title)
      || !text(section.analysis)
      || !stringArray(section.implications, { min: 1 })
      || !stringArray(section.recommendations)
      || typeof section.qualification !== 'string'
      || !stringArray(section.truthReferences, { min: 1 })
      || !stringArray(section.assumptions)
      || !stringArray(section.gaps)) throw new TypeError('Framework Guidance semantic section is invalid.')
  })
  const byteLength = Buffer.byteLength(JSON.stringify(source), 'utf8')
  if (byteLength < 1 || byteLength > MAX_SOURCE_CANDIDATE_BYTES) {
    throw new TypeError('Framework Guidance semantic candidate is too large.')
  }
  assertSafeValue(source)
  return source
}

export const assertOutcomeQualityStageProviderSafeContext = (value) => {
  if (!hasExactKeys(value, CONTEXT_KEYS)
    || value.contractVersion !== OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION
    || value.targetStage !== OUTCOME_QUALITY_STAGES.WORKING_DRAFT) {
    throw new TypeError('Quality-stage provider context is invalid.')
  }
  const baseContext = {
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: value.businessRequest,
    draftContext: value.draftContext,
    truthSummaries: value.truthSummaries,
    guidance: value.guidance,
    safeguards: value.safeguards,
  }
  assertOutcomeStudioProviderSafeContext(baseContext)
  assertSourceCandidate(value.sourceCandidate)
  return value
}

export const buildOutcomeQualityStageProviderSafeContext = ({
  knowledgeSelection,
  providerDescriptor,
  safeRequest,
  sourceStageExecution,
  targetStageKey,
  truthSource,
} = {}) => {
  if (providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || targetStageKey !== OUTCOME_QUALITY_STAGES.WORKING_DRAFT
    || !Array.isArray(knowledgeSelection)
    || knowledgeSelection.length !== 0) throw new TypeError('Working Draft provider binding is invalid.')
  assertOutcomeStudioProviderSafeRequest(safeRequest)
  const baseContext = assertOutcomeStudioProviderSafeContext({
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: { ...safeRequest.businessRequest },
    draftContext: { ...safeRequest.draftContext },
    truthSummaries: projectTruthSummaries(truthSource),
    guidance: Object.fromEntries(Object.entries(applicationGuidance).map(([key, entries]) => [key, [...entries]])),
    safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
  })
  return assertOutcomeQualityStageProviderSafeContext({
    ...baseContext,
    contractVersion: OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
    targetStage: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    sourceCandidate: projectFrameworkGuidanceCandidate(sourceStageExecution),
  })
}

export default {
  assertOutcomeQualityStageProviderSafeContext,
  buildOutcomeQualityStageProviderSafeContext,
}
