import { createHash } from 'node:crypto'
import {
  buildOutcomeStudioRenderableAsset,
  computeOutcomeStudioRenderableSourceChecksum,
  OUTCOME_STUDIO_ASSET_RENDERING_CONTRACT_VERSION,
} from './outcomeStudioAssetRenderingService.js'
import {
  PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE,
  parseProfessionalDocumentCandidateInput,
  renderProfessionalDocumentCandidate,
} from './professionalDocumentCandidateRenderer.js'
import { assertSyntheticRenderDeliveryHeld } from './syntheticRenderArtifactContract.js'

export const OUTCOME_DOCX_RENDITION_INPUT_VERSION = 'outcome-docx-rendition-input.v1'
export const OUTCOME_DOCX_RENDITION_CAPABILITY = Object.freeze({
  key: 'outcome-docx-private-candidate', version: '0.1.0',
  status: 'ENGINEERING_CANDIDATE', format: 'DOCX',
  engine: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.engine,
  limits: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits,
  supportedBlocks: Object.freeze(['PARAGRAPH', 'LIST', 'TABLE', 'HEADING', 'QUOTATION', 'CALLOUT', 'INTAKE', 'SOURCE_NOTE']),
  visualAssets: false,
})

const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype)
const text = value => typeof value === 'string' && value.length > 0 && value === value.trim()
const hash = value => /^sha256:[a-f0-9]{64}$/.test(value || '')
const stageHash = value => /^[a-f0-9]{64}$/.test(value || '')
const sorted = value => Array.isArray(value) ? value.map(sorted) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
const fingerprint = value => `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`
const fail = reason => { throw Object.assign(new Error('The private DOCX candidate cannot be prepared.'), {
  code: 'OUTCOME_DOCX_RENDITION_INPUT_INVALID', reason, details: { reason, contentIncludedInError: false },
}) }
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key))
const same = (left, right) => fingerprint(left) === fingerprint(right)

const SOURCE_KEYS = ['kind', 'draftId', 'draftIterationId', 'tenantId', 'customerId', 'runtimeInstanceId',
  'runtimeRevisionId', 'runtimeRevisionNumber', 'evidenceMembershipHash', 'planId', 'planFingerprint',
  'workingDraft', 'arl', 'narrative', 'shaping']
const assertSourceReference = (source, model) => {
  if (!exact(source, SOURCE_KEYS) || source.kind !== 'DRAFT_ITERATION'
    || !['draftId', 'draftIterationId', 'tenantId', 'customerId', 'runtimeInstanceId', 'runtimeRevisionId', 'planId']
      .every(key => text(source[key]))
    || !(hash(source.evidenceMembershipHash) || stageHash(source.evidenceMembershipHash)) || !stageHash(source.planFingerprint)
    || !Number.isSafeInteger(source.runtimeRevisionNumber) || source.runtimeRevisionNumber < 1) fail('SOURCE_REFERENCE_INVALID')
  for (const role of ['workingDraft', 'arl', 'narrative', 'shaping']) {
    if (!exact(source[role], ['stageExecutionId', 'outputFingerprint'])
      || !text(source[role].stageExecutionId) || !stageHash(source[role].outputFingerprint)) fail('SOURCE_STAGE_REFERENCE_INVALID')
  }
  if (new Set(['workingDraft', 'arl', 'narrative', 'shaping'].map(role => source[role].stageExecutionId)).size !== 4) {
    fail('SOURCE_STAGE_REFERENCE_AMBIGUOUS')
  }
  if (source.draftId !== model.assetId || source.draftIterationId !== model.assetVersionId
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => source[key] !== model[key])
    || source.runtimeRevisionId !== model.runtimeRevision?.id
    || source.runtimeRevisionNumber !== model.runtimeRevision?.number) fail('SOURCE_MODEL_BINDING_MISMATCH')
}

const assertPackBindings = (receipts, model) => {
  if (!exact(receipts, ['outputType', 'outputSchema', 'audience', 'style', 'visualSystem'])) fail('PACK_SELECTION_INCOMPLETE')
  for (const [role, receipt] of Object.entries(receipts)) {
    if (!plain(receipt) || !['packKey', 'versionId', 'version'].every(key => text(receipt[key]))
      || !hash(receipt.contentHash) || !['ACTIVE', 'CURRENT', 'RESOLVED'].includes(receipt.status)) fail('PACK_RECEIPT_INVALID')
    if (['outputType', 'outputSchema', 'audience'].includes(role)
      && Object.keys(receipt).some(key => !['packKey', 'versionId', 'version', 'contentHash', 'status', 'label'].includes(key))) {
      fail('PACK_RECEIPT_FIELDS_UNSUPPORTED')
    }
  }
  if (receipts.outputType.packKey !== model.outputContract?.outputTypeKey
    || receipts.outputSchema.packKey !== model.outputContract?.outputSchemaKey
    || receipts.style.packKey !== model.outputContract?.styleKey
    || !text(model.outputContract?.audience)
    || ![receipts.audience.packKey, receipts.audience.label].includes(model.outputContract.audience)
    || !same(receipts.style, model.packReceipts?.style) || !same(receipts.visualSystem, model.packReceipts?.visualSystem)) {
    fail('PACK_MODEL_BINDING_MISMATCH')
  }
}

const assertCanonicalModel = model => {
  if (!plain(model) || model.modelVersion !== OUTCOME_STUDIO_ASSET_RENDERING_CONTRACT_VERSION
    || !hash(model.sourceContentChecksum) || !Array.isArray(model.sections) || !model.sections.length) fail('SOURCE_MODEL_INVALID')
  assertSyntheticRenderDeliveryHeld(model)
  if (computeOutcomeStudioRenderableSourceChecksum(model) !== model.sourceContentChecksum) fail('SOURCE_CHECKSUM_CHANGED')
  // Reuse the existing canonicalizer to detect fields its normalizers would drop.
  // This function accepts that canonical representation only, not arbitrary raw source records.
  const rebuilt = buildOutcomeStudioRenderableAsset({
    assetVersion: { ...model, outcomeAssetId: model.assetId, outcomeAssetVersionId: model.assetVersionId,
      status: model.assetVersionStatus, customerContent: { sections: model.sections } },
    outputContract: model.outputContract, runtimeRevision: model.runtimeRevision,
    stylePackReceipt: model.packReceipts?.style, visualSystemPackReceipt: model.packReceipts?.visualSystem,
  })
  if (!same(model.sections, rebuilt.sections) || !same(model.blocks, rebuilt.blocks)
    || model.markdown !== rebuilt.markdown || model.sourceContentChecksum !== rebuilt.sourceContentChecksum
    || !same(model.governanceMarkers, rebuilt.governanceMarkers)
    || !same(model.evidenceReferences, rebuilt.evidenceReferences)
    || !same(model.visualIntent, rebuilt.visualIntent)) fail('SOURCE_REPRESENTATIONS_DISAGREE')
  if (model.visualIntent?.components?.some(component => !['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT'].includes(component.type))) {
    fail('VISUAL_CAPABILITY_UNSUPPORTED')
  }
}

const renderBlockMarkdown = block => {
  if (!OUTCOME_DOCX_RENDITION_CAPABILITY.supportedBlocks.includes(block.type)) fail('BLOCK_SEMANTICS_UNSUPPORTED')
  if (block.label && !['CALLOUT', 'INTAKE', 'SOURCE_NOTE'].includes(block.type)) fail('BLOCK_LABEL_UNSUPPORTED')
  if (block.type === 'LIST') {
    if (block.text.includes('\n')) fail('MULTILINE_LIST_UNSUPPORTED')
    return `- ${block.text}`
  }
  if (block.type === 'HEADING') {
    if (block.text.includes('\n')) fail('MULTILINE_HEADING_UNSUPPORTED')
    return `### ${block.text}`
  }
  if (block.type === 'QUOTATION') return block.text.split('\n').map(line => `> ${line}`).join('\n')
  if (['CALLOUT', 'INTAKE', 'SOURCE_NOTE'].includes(block.type)) {
    if (!text(block.label) || /[\n*`]/.test(block.label)) fail('BLOCK_LABEL_REQUIRED')
    return `**${block.label}**\n\n${block.text}`
  }
  return block.text
}

const assertVisualPermissions = model => {
  const permitted = model.packReceipts.visualSystem.allowedComponents
  const componentForBlock = { PARAGRAPH: 'PARAGRAPH', LIST: 'LIST', TABLE: 'TABLE', HEADING: 'HEADING',
    QUOTATION: 'CALLOUT', CALLOUT: 'CALLOUT', INTAKE: 'PARAGRAPH', SOURCE_NOTE: 'PARAGRAPH' }
  // Title/section headings and supplied source restrictions are also rendered.
  const requested = ['HEADING', 'PARAGRAPH', ...model.visualIntent.components.map(component => component.type),
    ...model.blocks.map(block => componentForBlock[block.type]).filter(Boolean)]
  if (!Array.isArray(permitted) || requested.some(component => !permitted.includes(component))) fail('VISUAL_COMPONENT_NOT_PERMITTED')
}

const assertBlockSemantics = (block, documentMetadata) => {
  const rendered = renderBlockMarkdown(block)
  const parsed = parseProfessionalDocumentCandidateInput({ documentMetadata, markdown: rendered }).parsed.blocks
  const type = { PARAGRAPH: 'paragraph', LIST: 'bullet', HEADING: 'heading', QUOTATION: 'quote', TABLE: 'table' }[block.type]
  if (type) {
    if (parsed.length !== 1 || parsed[0].type !== type) fail(block.type === 'TABLE' ? 'TABLE_SEMANTICS_UNSUPPORTED' : 'BLOCK_CONTENT_SEMANTICS_UNSUPPORTED')
  } else {
    // A note's label and body are paragraphs. Do not let its body turn into a
    // heading, quotation or list simply because it contains Markdown syntax.
    if (parsed.length !== 2 || parsed.some(part => part.type !== 'paragraph')) fail('BLOCK_CONTENT_SEMANTICS_UNSUPPORTED')
  }
  return rendered
}

// Maintained SS-055 compilation boundary for outcomeStudioService's future
// admitted-source adapter. References are metadata: this function performs NO
// signature/admission, persistence, preview, provider review or delivery.
export const prepareOutcomeDocxRenditionCandidate = async ({ model, sourceReference, packReceipts, format = 'DOCX' } = {}) => {
  if (format !== 'DOCX') fail('FORMAT_UNSUPPORTED')
  assertCanonicalModel(model)
  assertSourceReference(sourceReference, model)
  assertPackBindings(packReceipts, model)
  assertVisualPermissions(model)
  const documentMetadata = { title: model.title, deliverableType: 'Document', versionNumber: model.versionNumber, status: 'DRAFT' }
  for (const value of [model.title, ...model.sections.map(section => section.label)]) {
    if (value.includes('\n')) fail('MULTILINE_TITLE_OR_SECTION_UNSUPPORTED')
  }
  const restrictions = [model.governanceMarkers.evidenceBoundary, ...model.governanceMarkers.claimRestrictions,
    ...model.governanceMarkers.warnings, ...model.governanceMarkers.limitations]
  const markdown = [
    `# ${model.title}`,
    ...model.sections.flatMap(section => [`## ${section.label}`, ...section.blocks.map(block => assertBlockSemantics(block, documentMetadata))]),
    // These are supplied source qualifications, never invented rendering rules.
    ...restrictions.map(value => assertBlockSemantics({ type: 'PARAGRAPH', text: value }, documentMetadata)),
  ].join('\n\n')
  const input = JSON.parse(JSON.stringify({
    contractVersion: OUTCOME_DOCX_RENDITION_INPUT_VERSION,
    sourceReference, model, packReceipts, renderer: OUTCOME_DOCX_RENDITION_CAPABILITY, markdown,
  }))
  const rendered = await renderProfessionalDocumentCandidate({ documentMetadata, markdown })
  return {
    status: 'PRIVATE_UNREVIEWED', sourceAdmission: 'NOT_VERIFIED',
    exportAvailable: false, finalisationAvailable: false,
    input, inputFingerprint: fingerprint(input), sourceContentChecksum: input.model.sourceContentChecksum,
    renderer: OUTCOME_DOCX_RENDITION_CAPABILITY,
    artifact: {
      format: 'DOCX', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteLength: rendered.buffer.length,
      outputChecksum: `sha256:${createHash('sha256').update(rendered.buffer).digest('hex')}`,
    },
    buffer: rendered.buffer, packageValidation: rendered.validation,
  }
}
