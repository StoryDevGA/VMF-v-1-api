import {
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  assertOutcomeStudioProviderSafeValue,
  OUTCOME_STUDIO_PROVIDER_SAFEGUARDS,
} from './outcomeStudioProviderSafeContextService.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'

const MAX_CANDIDATE_BYTES = 140000
const CONTEXT_KEYS = Object.freeze([
  'contractVersion', 'businessRequest', 'draftContext', 'guidance', 'safeguards',
  'targetStage', 'candidate',
])
const CANDIDATE_KEYS = Object.freeze(['candidateType', 'title', 'sections', 'visibleGaps'])
const SECTION_KEYS = Object.freeze(['order', 'heading', 'body', 'qualification', 'diagram'])
const DIAGRAM_KEYS = Object.freeze(['present', 'description', 'accessibleText'])
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

const text = (value) => String(value ?? '').trim()
const plain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const exactKeys = (value, keys) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
)
const safeText = (value, { allowEmpty = false, max }) => (
  typeof value === 'string'
  && value === value.trim()
  && (allowEmpty || value.length > 0)
  && value.length <= max
  && !CONTROL_PATTERN.test(value)
)
const stringArray = (value) => Array.isArray(value)
  && value.length <= 50
  && value.every((item) => safeText(item, { max: 2000 }))

const guidance = Object.freeze({
  businessInstructions: Object.freeze([
    'Review the supplied Executive Brief candidate as rendered expression only. Do not rewrite it or change meaning.',
  ]),
  reasoningGuidance: Object.freeze([
    'Evaluate statements, headings, diagrams, hierarchy, qualification, accessibility and brand expression against the supplied candidate and request context.',
    'For diagrams, present false with empty description and accessible text is an intentional absence and is compliant without a reader-facing absence notice; when present is true, assess both description and accessible text.',
    'Required changes are limited to explicit contract breaches: unsupported or contradictory statements; missing or misleading headings; inaccessible present diagrams; missing or misplaced hierarchy labels; hidden or contradictory qualifications; objective structural accessibility barriers; promotional, inappropriate or exposed internal implementation language.',
    'Evidence limitations may appear under Evidence, section unknowns may repeat global visible gaps, and optional preferences about brevity, repetition, sentence density, skimmability or word choice are polish rather than required changes.',
    'QA-suffixed fictitious names and a precise test-placeholder disclosure are permitted when supplied by the candidate; generic QA process commentary is not exempt from brand review.',
  ]),
  outputSchema: Object.freeze([
    'Return exactly one finding for each required review dimension and an overall PASS only when no required expression change remains.',
  ]),
  styleGuidance: Object.freeze([
    'Use concise review findings. Do not expose internal identifiers, hidden reasoning or governance implementation language.',
  ]),
  validationCriteria: Object.freeze([
    'Review the exact supplied statements and visible gaps. A meaning change is outside RL and must not be proposed as an expression fix.',
    'Do not fail diagrams or accessibility merely because an intentionally absent diagram has empty diagram text.',
    'Set requiredChange true only for an explicit contract breach. Optional polish may be mentioned only in a PASS finding with requiredChange false and must not make overallStatus FAIL.',
    'Do not introduce a new acceptance criterion during review.',
  ]),
  prohibitedOutputBoundaries: Object.freeze([
    'Do not rewrite candidate content, approve meaning, publish, create a presentation or infographic, or claim final disposition.',
  ]),
})

const projectCandidate = (sourceStageExecution) => {
  const source = plain(sourceStageExecution)
  const output = plain(source?.outputSnapshot)
  if (!source
    || source.status !== OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
    || source.stageKey !== OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING
    || Number(source.stageOrder) !== 5
    || source.outputFingerprint !== hashOutcomeQualityStageValue(output)
    || output?.outputType !== OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION
    || output?.schemaVersion !== OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION
    || output?.candidateType !== 'EXECUTIVE_BRIEF'
    || !safeText(output?.title, { max: 255 })
    || !Array.isArray(output?.sections)
    || output.sections.length < 1
    || output.sections.length > 20
    || !stringArray(output.visibleGaps)) throw new TypeError('Rendered-expression RL source candidate is invalid.')
  const candidate = {
    candidateType: 'EXECUTIVE_BRIEF',
    title: output.title,
    sections: output.sections.map((section, index) => {
      if (section?.order !== index + 1
        || !safeText(section.heading, { max: 255 })
        || !safeText(section.body, { max: 24000 })
        || !safeText(section.qualification, { allowEmpty: true, max: 2000 })
        || !exactKeys(section.diagram, DIAGRAM_KEYS)
        || typeof section.diagram.present !== 'boolean'
        || !safeText(section.diagram.description, { allowEmpty: true, max: 2000 })
        || !safeText(section.diagram.accessibleText, { allowEmpty: true, max: 2000 })) {
        throw new TypeError('Rendered-expression RL source section is invalid.')
      }
      return {
        order: section.order,
        heading: section.heading,
        body: section.body,
        qualification: section.qualification,
        diagram: { ...section.diagram },
      }
    }),
    visibleGaps: [...output.visibleGaps],
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_CANDIDATE_BYTES) {
    throw new TypeError('Rendered-expression RL source candidate is too large.')
  }
  assertOutcomeStudioProviderSafeValue(candidate)
  return candidate
}

export const assertOutcomeRenderedExpressionRlProviderSafeContext = (value) => {
  if (!exactKeys(value, CONTEXT_KEYS)
    || value.contractVersion !== OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION
    || value.targetStage !== OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    || !exactKeys(value.candidate, CANDIDATE_KEYS)
    || value.candidate.candidateType !== 'EXECUTIVE_BRIEF'
    || !safeText(value.candidate.title, { max: 255 })
    || !Array.isArray(value.candidate.sections)
    || value.candidate.sections.length < 1
    || !stringArray(value.candidate.visibleGaps)) throw new TypeError('Rendered-expression RL provider context is invalid.')
  value.candidate.sections.forEach((section, index) => {
    if (!exactKeys(section, SECTION_KEYS)
      || section.order !== index + 1
      || !safeText(section.heading, { max: 255 })
      || !safeText(section.body, { max: 24000 })
      || !safeText(section.qualification, { allowEmpty: true, max: 2000 })
      || !exactKeys(section.diagram, DIAGRAM_KEYS)) throw new TypeError('Rendered-expression RL provider section is invalid.')
  })
  assertOutcomeStudioProviderSafeContext({
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: value.businessRequest,
    draftContext: value.draftContext,
    truthSummaries: [],
    guidance: value.guidance,
    safeguards: value.safeguards,
  })
  assertOutcomeStudioProviderSafeValue(value.candidate)
  return value
}

export const buildOutcomeRenderedExpressionRlProviderSafeContext = ({
  knowledgeSelection,
  providerDescriptor,
  safeRequest,
  sourceStageExecution,
  targetStageKey,
} = {}) => {
  if (providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || targetStageKey !== OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    || !Array.isArray(knowledgeSelection)
    || knowledgeSelection.length !== 1) throw new TypeError('Rendered-expression RL provider binding is invalid.')
  assertOutcomeStudioProviderSafeRequest(safeRequest)
  const base = assertOutcomeStudioProviderSafeContext({
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: { ...safeRequest.businessRequest },
    draftContext: { ...safeRequest.draftContext },
    truthSummaries: [],
    guidance: Object.fromEntries(Object.entries(guidance).map(([key, values]) => [key, [...values]])),
    safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
  })
  return assertOutcomeRenderedExpressionRlProviderSafeContext({
    contractVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
    businessRequest: base.businessRequest,
    draftContext: base.draftContext,
    guidance: base.guidance,
    safeguards: base.safeguards,
    targetStage: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    candidate: projectCandidate(sourceStageExecution),
  })
}

export default {
  assertOutcomeRenderedExpressionRlProviderSafeContext,
  buildOutcomeRenderedExpressionRlProviderSafeContext,
}
