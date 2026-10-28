import { OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeDecisionLedCommercialExpressionProfile.js'
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
  OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT,
  assertOutcomeMethodDocumentPrivacy,
} from './outcomeStudioProviderSafeContextService.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { assertOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from './outcomeMethodDocumentService.js'
import { assertCommercialOutputContract } from '../utils/outcomeCommercialExpressionProfile.js'
import { COMMERCIAL_RL_CONTEXT_VERSION, assertCommercialReviewDocuments, commercialReviewDocumentReceipts, buildCommercialStyleValidationReceipt } from './commercialOutputReviewContract.js'
import { OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeGovernedCommercialExpressionProfile.js'
import { parseKnowledgePackFrontMatter } from './knowledgePackRelationshipContract.js'

const MAX_CANDIDATE_BYTES = 140000
const CONTEXT_KEYS = Object.freeze([
  'contractVersion', 'businessRequest', 'draftContext', 'guidance', 'safeguards',
  'targetStage', 'candidate', 'methodDocument',
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
    'Apply the complete selected canonical RL document to this expression review within the execution boundaries.',
  ]),
  outputSchema: Object.freeze([
    'Return exactly one finding for each required review dimension and an overall PASS only when no required expression change remains.',
  ]),
  styleGuidance: Object.freeze([
    'Use concise review findings. Do not expose internal identifiers, hidden reasoning or governance implementation language.',
  ]),
  validationCriteria: Object.freeze([
    'Review the exact supplied statements and visible gaps. A meaning change is outside RL and must not be proposed as an expression fix.',
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
    || !['EXECUTIVE_BRIEF', 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'].includes(output?.candidateType)
    || !safeText(output?.title, { max: 255 })
    || !Array.isArray(output?.sections)
    || output.sections.length < 1
    || output.sections.length > 20
    || !stringArray(output.visibleGaps)) throw new TypeError('Rendered-expression RL source candidate is invalid.')
  const candidate = {
    candidateType: output.candidateType,
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
        ...(output.candidateType === 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER' ? { sectionKey: section.sectionKey } : {}),
        heading: section.heading,
        body: section.body,
        qualification: section.qualification,
        diagram: { ...section.diagram },
      }
    }),
    visibleGaps: [...output.visibleGaps],
  }
  if (output.candidateType === 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER') {
    assertCommercialOutputContract(output.outputContract)
    if (!['outcome-commercial-expression.v1', 'outcome-commercial-expression.v2', OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION, OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION].includes(output.expressionProfileVersion)
      || output.diagramApplicability !== 'No diagrams are used in this document.'
      || output.sections.length !== 14 || output.sections.some((section, index) => section.sectionKey !== output.outputContract.sections[index]
        || section.diagram.present)) throw new TypeError('Commercial rendered-expression contract is invalid.')
    candidate.outputContract = output.outputContract
    candidate.diagramApplicability = output.diagramApplicability
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_CANDIDATE_BYTES) {
    throw new TypeError('Rendered-expression RL source candidate is too large.')
  }
  assertOutcomeStudioProviderSafeValue(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'outputContract')))
  return candidate
}

export const assertOutcomeRenderedExpressionRlProviderSafeContext = (value) => {
  const commercial = value?.candidate?.candidateType === 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'
  assertOutcomeMethodDocument(value?.methodDocument, { role: 'RL', boundary: 'POST_GENERATION_VALIDATION' })
  assertOutcomeMethodDocumentPrivacy(value.methodDocument)
  if (!exactKeys(value, commercial ? [...CONTEXT_KEYS, 'outputContractDocuments'] : CONTEXT_KEYS)
    || value.contractVersion !== (commercial ? COMMERCIAL_RL_CONTEXT_VERSION : OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION)
    || value.targetStage !== OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    || !exactKeys(value.candidate, commercial ? [...CANDIDATE_KEYS, 'outputContract', 'diagramApplicability'] : CANDIDATE_KEYS)
    || !['EXECUTIVE_BRIEF', 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'].includes(value.candidate.candidateType)
    || !safeText(value.candidate.title, { max: 255 })
    || !Array.isArray(value.candidate.sections)
    || value.candidate.sections.length < 1
    || !stringArray(value.candidate.visibleGaps)) throw new TypeError('Rendered-expression RL provider context is invalid.')
  if (commercial) {
    assertCommercialReviewDocuments(value.outputContractDocuments, value.candidate.outputContract)
    if (value.candidate.sections.length !== 14
      || value.candidate.diagramApplicability !== 'No diagrams are used in this document.'
      || value.candidate.sections.some((section) => section.diagram.present)) throw new TypeError('Commercial review candidate is invalid.')
  }
  value.candidate.sections.forEach((section, index) => {
    if (!exactKeys(section, commercial ? [...SECTION_KEYS, 'sectionKey'] : SECTION_KEYS)
      || section.order !== index + 1
      || (commercial && (section.sectionKey !== value.candidate.outputContract.sections[index]
        || section.diagram?.present !== false || section.diagram.description !== '' || section.diagram.accessibleText !== ''))
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
  assertOutcomeStudioProviderSafeValue(Object.fromEntries(Object.entries(value.candidate).filter(([key]) => key !== 'outputContract')))
  return value
}

export const buildOutcomeRenderedExpressionRlProviderSafeContext = ({
  methodDocument,
  captureExecutionEvidence,
  knowledgeSelection,
  providerDescriptor,
  safeRequest,
  sourceStageExecution,
  targetStageKey,
  outputContractDocuments,
} = {}) => {
  if (providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || targetStageKey !== OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL
    || !Array.isArray(knowledgeSelection)
    || knowledgeSelection.length !== 1) throw new TypeError('Rendered-expression RL provider binding is invalid.')
  assertOutcomeStudioProviderSafeRequest(safeRequest)
  assertOutcomeMethodDocument(methodDocument, { role: 'RL', boundary: 'POST_GENERATION_VALIDATION' })
  if (knowledgeSelection[0]?.versionId !== methodDocument.source.versionId) {
    throw new TypeError('Rendered-expression RL document binding is invalid.')
  }
  const commercial = sourceStageExecution?.outputSnapshot?.candidateType === 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'
  const governedOverlay = [OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION, OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION].includes(sourceStageExecution?.outputSnapshot?.expressionProfileVersion)
  let styleValidationReceipt
  if (governedOverlay) {
    const output = sourceStageExecution.outputSnapshot
    assertCommercialReviewDocuments(outputContractDocuments, output.outputContract)
    const document = outputContractDocuments.find(item => item.source.packType === 'STYLE')
    styleValidationReceipt = buildCommercialStyleValidationReceipt({ contract: output.outputContract,
      outputAssetId: parseKnowledgePackFrontMatter(outputContractDocuments.find(item => item.source.packType === 'OUTPUT_TYPE_DEFINITION').content).knowledgeAssetId,
      title: output.title, sections: output.sections,
      audienceKeys: output.styleValidationReceipt?.audienceKeys || [],
      styleSource: { ...document.source, content: document.content, available: true, status: 'ACTIVE' } })
    if (hashOutcomeQualityStageValue(styleValidationReceipt) !== hashOutcomeQualityStageValue(output.styleValidationReceipt)) {
      throw new TypeError('Commercial style validation receipt does not match the reviewed candidate.')
    }
  }
  const selectedGuidance = Object.fromEntries(Object.entries(guidance).map(([key, values]) => [key, [...values]]))
  if (commercial) {
    selectedGuidance.businessInstructions = ['Review the selected Commercial Strategy and Decision Paper as rendered expression only. Do not rewrite it or change meaning.']
    selectedGuidance.reasoningGuidance.push('Apply the supplied selected output contract documents for schema, style and visual requirements. These are requirements, not evidence or candidate assertions. Executive Brief is a separate output and supplies no criteria for this candidate.')
    if (governedOverlay) selectedGuidance.reasoningGuidance.push(
      'Only candidate.title, candidate.sections and candidate.diagramApplicability are the paper. Requirement documents and review metadata are assessment criteria, not paper headings or assertions. Cite paper text when reporting a paper defect.',
      'Output and Schema govern meaning and required sections. Style is an independent presentation overlay, compatible by default unless explicitly excluded or missing a required renderer capability. A missing positive pairing is not a defect. Evaluate attribution, qualification visibility, audience, accessibility and visual requirements normally; compatibility is not an RL pass.',
      'Source quotations, labelled user-provided intake and source-note callouts have different presentation roles. A source note applies only to the named source quotations. Intake does not inherit document qualifications. Shared source notes may cover a clearly identified quotation group; preserve all material limitations and explanation continuity.',
    )
  }
  const base = assertOutcomeStudioProviderSafeContext({
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: { ...safeRequest.businessRequest },
    draftContext: { ...safeRequest.draftContext },
    truthSummaries: [],
    guidance: selectedGuidance,
    safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
  })
  const context = assertOutcomeRenderedExpressionRlProviderSafeContext({
    contractVersion: commercial ? COMMERCIAL_RL_CONTEXT_VERSION : OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
    businessRequest: base.businessRequest,
    draftContext: base.draftContext,
    guidance: base.guidance,
    safeguards: base.safeguards,
    targetStage: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    candidate: projectCandidate(sourceStageExecution),
    methodDocument,
    ...(commercial ? { outputContractDocuments } : {}),
  })
  if (typeof captureExecutionEvidence === 'function') captureExecutionEvidence({
    contractVersion: OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT,
    providerContextContractVersion: commercial ? COMMERCIAL_RL_CONTEXT_VERSION : OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_SAFE_CONTEXT_VERSION,
    methodDocumentReceipts: [projectOutcomeMethodDocumentReceipt(methodDocument)],
    ...(commercial ? { selectedOutputContractReceipts: commercialReviewDocumentReceipts(outputContractDocuments, context.candidate.outputContract) } : {}),
    ...(styleValidationReceipt ? { styleValidationReceipt } : {}),
    packs: [{
      ...projectOutcomeMethodDocumentReceipt(methodDocument),
      packType: 'RL',
      knowledgeLayer: knowledgeSelection[0].knowledgeLayer,
      executionMode: knowledgeSelection[0].executionMode,
      suppliedEntryCount: methodDocument.chunks.length,
      status: 'NOT_RECORDED',
      checks: [{ key: 'PROVIDER_COMPLETED', status: 'NOT_RECORDED', message: 'Awaiting provider completion.' }],
    }],
  })
  return context
}

export default {
  assertOutcomeRenderedExpressionRlProviderSafeContext,
  buildOutcomeRenderedExpressionRlProviderSafeContext,
}
