import { createHash } from 'node:crypto'
import { readOutcomeDocxRenditionSource, OUTCOME_DOCX_RENDITION_SOURCE_VERSION } from './outcomeDocxRenditionSourceService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { assertCommercialOutputContract } from '../utils/outcomeCommercialExpressionProfile.js'
import { assertCommercialReviewDocuments, commercialReviewDocumentReceipts } from './commercialOutputReviewContract.js'
import { assertStyleOverlaySourceEligibility } from './styleOverlayPolicy.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { DOCX_QUALIFICATION_POLICY, buildDocxSourceQualificationPresentation,
  assertDocxSourceQualificationPresentation } from './docxSourceQualificationPresentation.js'
import { applyCommercialDocxExpressionCorrection } from './commercialDocxExpressionCorrection.js'
import { APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION, APPROVED_QUALIFICATION_POLICY, applyApprovedCommercialExpression,
  assertApprovedCommercialExpression } from './commercialDocxApprovedExpression.js'
import { parseProfessionalDocumentCandidateInput, renderProfessionalDocumentCandidate,
  PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE, PROFESSIONAL_DOCUMENT_LAYOUT_PROFILES,
  PROFESSIONAL_DOCUMENT_PRESENTATION_PROFILES } from './professionalDocumentCandidateRenderer.js'

export const GOVERNED_PRIVATE_DOCX_CAPABILITY = Object.freeze({
  key: 'governed-source-private-docx', version: '0.1.3', format: 'DOCX',
  qualificationPolicy: DOCX_QUALIFICATION_POLICY,
  layoutProfile: PROFESSIONAL_DOCUMENT_LAYOUT_PROFILES.ATTRIBUTED_QUOTATIONS,
  presentationProfile: PROFESSIONAL_DOCUMENT_PRESENTATION_PROFILES.CUSTOMER,
  engine: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.engine,
  supportedComponents: Object.freeze(['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT']),
  scope: 'PRIVATE_NON_AUTHORITATIVE_IN_MEMORY_ONLY',
})
export const APPROVED_PRIVATE_DOCX_CAPABILITY = Object.freeze({ ...GOVERNED_PRIVATE_DOCX_CAPABILITY,
  version: '0.1.4', qualificationPolicy: APPROVED_QUALIFICATION_POLICY })
const clone = value => JSON.parse(JSON.stringify(value))
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const fail = reason => { throw Object.assign(new Error('The private governed Word document cannot be prepared.'), {
  status: 409, code: 'GOVERNED_PRIVATE_DOCX_BLOCKED', details: { reason, contentIncludedInError: false },
}) }
const descriptorFields = ['packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']
const packLayers = ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM']
const singleLine = value => typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\r\n]/.test(value)
const nonempty = value => typeof value === 'string' && value.length > 0 && value === value.trim()
const metadataFor = title => ({ title, deliverableType: 'Document', versionNumber: 1, status: 'PRIVATE_UNREVIEWED' })
const parseSupported = (markdown, title) => {
  const result = parseProfessionalDocumentCandidateInput({ documentMetadata: metadataFor(title), markdown })
  const supported = { heading: 'HEADING', paragraph: 'PARAGRAPH', bullet: 'LIST', number: 'LIST', table: 'TABLE', quote: 'CALLOUT' }
  if (result.parsed.blocks.some(block => !supported[block.type])) fail('CONTENT_COMPONENT_UNSUPPORTED')
  return result
}

// Pure private profile adapter. This validates a reader projection, not signatures
// or write eligibility. Only the server orchestrator below performs source reads.
export const buildGovernedPrivateDocxInput = ({ envelope, documents, audienceDocument, correctionPredecessor, approvedCompatibilityReference } = {}) => {
  const source = envelope?.source
  if (envelope?.contractVersion !== OUTCOME_DOCX_RENDITION_SOURCE_VERSION
    || envelope.sourceAdmission !== 'VERIFIED_READ_ONLY_CHAIN'
    || envelope.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || ['authoritative', 'normalOutputAvailable', 'authorisesApproval', 'renderingAvailable', 'finalisationAvailable', 'deliveryAvailable']
      .some(key => envelope[key] !== false)
    || !source || source.kind !== 'GOVERNED_STAGE_CHAIN'
    || source.scope?.classification !== envelope.classification || source.scope.authoritative !== false
    || !['customerId', 'tenantId', 'runtimeInstanceId'].every(key => nonempty(source.scope[key]))
    || membershipHash(source) !== envelope.sourceFingerprint) fail('SOURCE_ENVELOPE_INVALID')
  const shaping = source.content?.shaping
  const shapingRef = source.stageRefs?.filter(ref => ref.stageKey === 'OUTPUT_SHAPING')
  if (shapingRef?.length !== 1 || shapingRef[0].status !== 'SUCCEEDED'
    || shapingRef[0].outputFingerprint !== hashOutcomeQualityStageValue(shaping)) fail('SHAPING_BINDING_CHANGED')
  const contract = assertCommercialOutputContract(shaping.outputContract)
  if (shaping.candidateType !== 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER'
    || !singleLine(shaping.title) || !nonempty(shaping.expressionProfileVersion)
    || !Array.isArray(shaping.sections) || shaping.sections.length !== contract.sections.length) fail('PROFILE_SOURCE_INVALID')
  for (const [index, pack] of contract.packs.entries()) {
    const selected = source.selectedPacks?.[packLayers[index]]
    if (!selected || descriptorFields.some(key => selected[key] !== pack[key])) fail('SELECTED_PACK_CHANGED')
  }
  assertCommercialReviewDocuments(documents, contract)
  const title = source.selectedPacks.OUTPUT_TYPE.label
  if (!singleLine(title)) fail('RENDITION_TITLE_UNAVAILABLE')
  const titleBlocks = parseSupported(`## ${title}`, title).parsed.blocks
  if (titleBlocks.length !== 1 || titleBlocks[0].type !== 'heading' || titleBlocks[0].text !== title
    || ['*', '_', '`', '[', ']', '<', '>', '\\'].some(character => title.includes(character))) fail('RENDITION_TITLE_UNSUPPORTED')
  const audience = source.selectedPacks?.AUDIENCE
  if (!audience?.capabilityKey || !audienceDocument?.available || audienceDocument.status !== 'ACTIVE'
    || descriptorFields.some(key => audienceDocument[key] !== audience[key])
    || typeof audienceDocument.content !== 'string' || Buffer.byteLength(audienceDocument.content) > 200000
    || digest(audienceDocument.content) !== audience.contentHash) fail('AUDIENCE_SOURCE_CHANGED')
  const stylePack = contract.packs[2]
  const styleSource = documents[2]
  const outputAssetId = shaping.styleValidationReceipt?.outputAssetId
  if (typeof outputAssetId !== 'string' || !/^[A-Z][A-Z0-9-]+$/.test(outputAssetId)) fail('OUTPUT_ASSET_IDENTITY_MISSING')
  const styleEligibility = assertStyleOverlaySourceEligibility({ style: { ...stylePack, status: 'ACTIVE' },
    outputType: { ...contract.packs[0], knowledgeAssetId: outputAssetId }, schema: contract.packs[1], audienceKeys: [audience.capabilityKey], format: 'DOCX',
    loaded: { ...styleSource.source, available: true, status: 'ACTIVE', content: styleSource.content } })
  if (styleEligibility.constraints.requiredRendererCapabilities
    .some(component => !GOVERNED_PRIVATE_DOCX_CAPABILITY.supportedComponents.includes(component))) fail('STYLE_COMPONENT_UNSUPPORTED')
  const sections = shaping.sections.map((section, index) => {
    if (section.sectionKey !== contract.sections[index] || section.order !== index + 1 || !nonempty(section.elementId)
      || !singleLine(section.heading) || !nonempty(section.body) || !nonempty(section.qualification)
      || section.diagram?.present !== false || section.diagram.description !== '' || section.diagram.accessibleText !== ''
      || !Array.isArray(section.truthReferences)) fail('SECTION_SHAPE_UNSUPPORTED')
    const heading = parseSupported(`## ${section.heading}`, shaping.title).parsed.blocks
    if (heading.length !== 1 || heading[0].type !== 'heading' || heading[0].level !== 2
      || heading[0].text !== section.heading) fail('SECTION_HEADING_CHANGED')
    // Preserve each complete source field. Parsing is semantic validation only;
    // the original strings, including local notes and quotations, remain in input.
    parseSupported(section.body, shaping.title)
    parseSupported(section.qualification, shaping.title)
    return { key: section.sectionKey, heading: section.heading, bodyMarkdown: section.body,
      qualificationMarkdown: section.qualification,
      sourcePaths: { heading: `shaping.sections[${index}].heading`, body: `shaping.sections[${index}].body`,
        qualification: `shaping.sections[${index}].qualification` },
      truthReferences: clone(section.truthReferences) }
  })
  if (new Set(shaping.sections.map(section => section.elementId)).size !== sections.length) fail('SECTION_IDENTITY_AMBIGUOUS')
  const markdown = [`# ${title}`, ...sections.flatMap(section => [
    `## ${section.heading}`, section.bodyMarkdown, section.qualificationMarkdown,
  ])].join('\n\n')
  parseSupported(markdown, title)
  let input = clone({ contractVersion: 'governed-private-docx-input.v1',
    model: { modelVersion: 'private-document-content.v1', title, sections },
    documentMetadata: metadataFor(title), markdown,
    presentation: { titleRule: 'SELECTED_OUTPUT_TYPE_LABEL_V1', titleSourcePath: 'source.selectedPacks.OUTPUT_TYPE.label',
      originalSourceTitle: shaping.title },
    sourceEnvelope: envelope, selectedPacks: source.selectedPacks,
    profile: { key: contract.outputTypeKey, expressionProfileVersion: shaping.expressionProfileVersion },
    documentReceipts: [...commercialReviewDocumentReceipts(documents, contract),
      { ...audience, contentFormat: audienceDocument.contentFormat, byteCount: Buffer.byteLength(audienceDocument.content) }],
    styleEligibility, visualConformance: 'REQUIRES_RENDERED_EXPRESSION_REVIEW',
    renderer: GOVERNED_PRIVATE_DOCX_CAPABILITY })
  if (approvedCompatibilityReference !== undefined) {
    if (correctionPredecessor !== undefined) fail('CORRECTION_MODES_CONFLICT')
    input = applyApprovedCommercialExpression(input, approvedCompatibilityReference)
    assertApprovedCommercialExpression(input)
  } else {
    if (correctionPredecessor !== undefined) input = applyCommercialDocxExpressionCorrection(input, correctionPredecessor)
    input.presentation.qualificationCallouts = buildDocxSourceQualificationPresentation(input)
  }
  return input
}

export const compileGovernedPrivateDocxInput = async args => {
  const input = buildGovernedPrivateDocxInput(args)
  const rendered = await renderProfessionalDocumentCandidate({ documentMetadata: input.documentMetadata, markdown: input.markdown,
    layoutProfile: input.renderer.layoutProfile, presentationProfile: input.renderer.presentationProfile,
    qualificationCalloutIndices: [APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION].includes(input.contractVersion)
      ? [] : assertDocxSourceQualificationPresentation(input) })
  return { status: 'PRIVATE_UNREVIEWED', classification: SYNTHETIC_OUTCOME_CLASSIFICATION,
    officialUse: false, normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    currentness: 'REVERIFY_BEFORE_PERSISTENCE', input, inputFingerprint: membershipHash(input),
    artifact: { format: 'DOCX', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      outputChecksum: digest(rendered.buffer), byteLength: rendered.buffer.length },
    buffer: rendered.buffer, packageValidation: rendered.validation }
}

// Server-only orchestration; no endpoint or caller-supplied source admission.
export const prepareGovernedPrivateDocxCandidate = async ({ actorUserId, runtimeInstanceId, scopes, deps = {}, correctionPredecessor, approvedCompatibilityReference } = {}) => {
  const envelope = await (deps.readSource || readOutcomeDocxRenditionSource)({ actorUserId, runtimeInstanceId, scopes })
  if (envelope?.source?.scope?.runtimeInstanceId !== runtimeInstanceId) fail('REQUEST_SCOPE_CHANGED')
  const selected = envelope.source.selectedPacks
  const loaded = await Promise.all([...packLayers, 'AUDIENCE'].map(layer => {
    const pack = selected?.[layer]
    if (!pack) fail('SELECTED_PACK_MISSING')
    return (deps.loadPackContent || loadOutcomeKnowledgePackVersionContent)({ packId: pack.packId, versionId: pack.versionId })
  }))
  const contract = envelope.source.content.shaping.outputContract
  const documents = loaded.slice(0, 4).map((document, index) => {
    const pack = contract.packs[index]
    if (!document?.available || document.status !== 'ACTIVE'
      || descriptorFields.some(key => document[key] !== pack[key])) fail('SELECTED_DOCUMENT_UNAVAILABLE')
    return { source: { ...pack, contentFormat: document.contentFormat }, content: document.content }
  })
  return compileGovernedPrivateDocxInput({ envelope, documents, audienceDocument: loaded[4], correctionPredecessor, approvedCompatibilityReference })
}
