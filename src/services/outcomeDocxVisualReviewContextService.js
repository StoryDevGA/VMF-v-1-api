import { createHash } from 'node:crypto'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { prepareRenditionReviewAdmission } from './outcomeRenditionReviewAdmissionService.js'
import { readOutcomeDocxRenditionSource } from './outcomeDocxRenditionSourceService.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { readCurrentDocxPagePreview } from './outcomeDocxPagePreviewPersistenceService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { loadOutcomeMethodDocument, assertOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from './outcomeMethodDocumentService.js'
import { assertOutcomeStudioProviderSafeValue, assertOutcomeMethodDocumentPrivacy, assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { DOCX_PAGE_LIMITS, validatePreviewPng, previewHash } from './docxPagePreviewRuntime.js'
import { assertRenditionReviewSubject, RENDITION_TRANSPORT } from './outcomeRenditionReviewClaimContract.js'

export const DOCX_VISUAL_CONTEXT_VERSION = RENDITION_TRANSPORT.contextVersion
export const DOCX_VISUAL_TEXT_LIMIT = 512 * 1024
export const docxVisualReviewError = reason => Object.assign(new Error('The exact document visual review input is unavailable.'), {
  code: 'DOCX_VISUAL_REVIEW_BLOCKED', status: 409, details: { reason, dispatchAvailable: false },
})
const need = (value, reason) => { if (!value) throw docxVisualReviewError(reason) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const same = (left, right) => membershipHash(left) === membershipHash(right)
const layers = ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']
const sourceExpression = source => ({ sections: source.content.shaping.sections.map(section => ({ order: section.order,
  heading: section.heading, body: section.body, qualification: section.qualification, diagram: section.diagram })),
visibleGaps: source.content.shaping.visibleGaps })
const packReceipt = pack => Object.fromEntries(['packId', 'versionId', 'activationId', 'contentHash'].map(key => [key, pack[key]]))

export const assertDocxVisualReviewTransport = transport => {
  need(exact(transport, ['subject', 'context', 'contextFingerprint', 'sourceEnvelope', 'candidateInput', 'document', 'pages']), 'TRANSPORT_SHAPE')
  const { subject, context, sourceEnvelope, candidateInput, document, pages } = transport
  assertRenditionReviewSubject(subject)
  need(candidateInput?.contractVersion === 'governed-private-docx-input.v1'
    && membershipHash(candidateInput) === subject.candidate.inputFingerprint
    && candidateInput.sourceEnvelope?.sourceFingerprint === subject.source.sourceFingerprint
    && membershipHash(candidateInput.sourceEnvelope.source) === subject.source.sourceFingerprint
    && membershipHash(candidateInput.renderer) === subject.candidate.renderer.fingerprint
    && layers.every(layer => same(packReceipt(candidateInput.selectedPacks?.[layer] || {}), subject.candidate.packs[layer])), 'STORED_INPUT_BINDING')
  need(sourceEnvelope?.sourceAdmission === 'VERIFIED_READ_ONLY_CHAIN' && sourceEnvelope.classification === subject.classification
    && sourceEnvelope.sourceFingerprint === subject.source.sourceFingerprint && membershipHash(sourceEnvelope.source) === subject.source.sourceFingerprint
    && sourceEnvelope.source.content?.approvedMeaning?.state === 'APPROVED', 'SOURCE_BINDING')
  need(exact(document, ['title', 'markdown', 'inputFingerprint']) && document.inputFingerprint === subject.candidate.inputFingerprint
    && typeof document.title === 'string' && document.title.trim().length > 0 && document.title.length <= 255
    && typeof document.markdown === 'string' && document.markdown.trim().length > 0
    && document.title === candidateInput.model?.title && document.markdown === candidateInput.markdown, 'DOCUMENT_BINDING')
  need(exact(context, ['contractVersion', 'lineage', 'candidate', 'sourceExpression', 'methodDocument', 'selectedDocuments'])
    && context.contractVersion === DOCX_VISUAL_CONTEXT_VERSION && same(context.candidate, document)
    && exact(context.lineage, ['subjectFingerprint', 'sourceFingerprint', 'inputFingerprint', 'docxChecksum', 'previewId', 'conversionFingerprint', 'pages'])
    && same(context.lineage, { subjectFingerprint: membershipHash(subject), sourceFingerprint: subject.source.sourceFingerprint,
      inputFingerprint: subject.candidate.inputFingerprint, docxChecksum: subject.candidate.docxChecksum,
      previewId: subject.preview.previewId, conversionFingerprint: subject.preview.conversionFingerprint, pages: subject.preview.pages })
    && same(context.sourceExpression, sourceExpression(sourceEnvelope.source)), 'CONTEXT_BINDING')
  assertOutcomeStudioProviderSafeValue(context.candidate.title)
  assertOutcomeStudioProviderSafeValue(context.candidate.markdown)
  assertOutcomeStudioProviderSafeValue(context.sourceExpression)
  assertOutcomeMethodDocument(context.methodDocument, { role: 'RL', boundary: 'POST_GENERATION_VALIDATION' })
  assertOutcomeMethodDocumentPrivacy(context.methodDocument)
  need(same(projectOutcomeMethodDocumentReceipt(context.methodDocument), subject.method), 'METHOD_BINDING')
  need(Array.isArray(context.selectedDocuments) && context.selectedDocuments.length === layers.length, 'PROFILE_DOCUMENTS')
  context.selectedDocuments.forEach((item, index) => {
    const layer = layers[index]
    need(exact(item, ['layer', 'receipt', 'contentFormat', 'content']) && item.layer === layer
      && same(item.receipt, subject.candidate.packs[layer]) && ['MARKDOWN', 'JSON', 'YAML', 'YML'].includes(item.contentFormat)
      && typeof item.content === 'string' && Buffer.byteLength(item.content) <= 200000
      && `sha256:${createHash('sha256').update(item.content).digest('hex')}` === item.receipt.contentHash, 'PROFILE_DOCUMENT_BINDING')
    assertOutcomeSelectedDocumentPrivacy(item.content)
  })
  need(Buffer.byteLength(JSON.stringify(context)) <= DOCX_VISUAL_TEXT_LIMIT && membershipHash(context) === transport.contextFingerprint, 'CONTEXT_FINGERPRINT_OR_BUDGET')
  need(Array.isArray(pages) && pages.length === subject.preview.pages.length, 'PAGE_POPULATION')
  let total = 0, pixels = 0
  pages.forEach((buffer, index) => {
    need(Buffer.isBuffer(buffer), 'PAGE_BYTES')
    const actual = validatePreviewPng(buffer), expected = subject.preview.pages[index]
    need(Object.keys(actual).every(key => actual[key] === expected[key]) && expected.number === index + 1, 'PAGE_BINDING')
    total += buffer.length; pixels += actual.width * actual.height
  })
  need(total <= DOCX_PAGE_LIMITS.totalPng && pixels <= DOCX_PAGE_LIMITS.pixels, 'PAGE_BUDGET')
  return transport
}

// Re-read through existing authenticated owners. Full source remains server-side;
// the provider receives only exact customer expression, method and profile text.
export const prepareDocxVisualReviewTransport = async args => {
  const deps = args.deps || {}, input = { actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId,
    candidateId: args.candidateId, scopes: args.scopes }
  const admission = await (deps.prepareAdmission || prepareRenditionReviewAdmission)(args), subject = admission.subject
  assertRenditionReviewSubject(subject)
  need(subject.actorUserId === String(args.actorUserId) && subject.scope.runtimeInstanceId === args.runtimeInstanceId
    && subject.candidate.candidateId === args.candidateId, 'ADMISSION_OWNER_CHANGED')
  const sourceEnvelope = await (deps.readSource || readOutcomeDocxRenditionSource)(input)
  const verified = await (deps.readCandidate || readPrivateDocxCandidate)({ ...input, includeBytes: true, includeInput: true })
  const saved = await (deps.readPreview || readCurrentDocxPagePreview)({ ...input, includePages: true })
  need(verified?.candidate?.candidateId === subject.candidate.candidateId && saved?.preview?.previewId === subject.preview.previewId
    && sourceEnvelope.sourceFingerprint === subject.source.sourceFingerprint && verified.candidate.inputFingerprint === subject.candidate.inputFingerprint
    && verified.candidate.artifact.outputChecksum === subject.candidate.docxChecksum && Buffer.isBuffer(verified.buffer)
    && `sha256:${previewHash(verified.buffer)}` === subject.candidate.docxChecksum && same(verified.scope, subject.scope)
    && saved.preview.conversionFingerprint === subject.preview.conversionFingerprint && same(saved.preview.conversion.pages, subject.preview.pages), 'CURRENT_RENDITION_CHANGED')
  const plan = await (deps.loadPlan || (filter => Plan.findOne(filter).lean()))({ ...subject.scope, _id: subject.source.plan.recordId, planId: subject.source.plan.planId })
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  need(plan && ['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(key => plan[key] === subject.source.plan[key])
    && Object.keys(subject.scope).every(key => String(plan[key]) === subject.scope[key]), 'CURRENT_PLAN_CHANGED')
  const methods = plan.payload.resolution.selectedPacks.filter(pack => pack.packId === subject.method.packId && pack.versionId === subject.method.versionId
    && pack.stageAssignments?.includes('RENDERED_EXPRESSION_RL'))
  need(methods.length === 1, 'CURRENT_METHOD_CHANGED')
  const loader = deps.loadPackContent || loadOutcomeKnowledgePackVersionContent
  const methodDocument = await loadOutcomeMethodDocument({ role: 'RL', selection: { ...methods[0], status: methods[0].status || methods[0].lifecycleStatus }, loadPackContent: loader })
  const selectedDocuments = []
  for (const layer of layers) {
    const receipt = verified.candidate.selectedPacks[layer]
    need(receipt && same(packReceipt(receipt), subject.candidate.packs[layer]), 'CURRENT_PROFILE_CHANGED')
    const loaded = await loader({ packId: receipt.packId, versionId: receipt.versionId })
    need(loaded?.available && loaded.status === 'ACTIVE' && loaded.packId === receipt.packId && loaded.versionId === receipt.versionId
      && loaded.contentHash === receipt.contentHash, 'CURRENT_PROFILE_CHANGED')
    selectedDocuments.push({ layer, receipt: packReceipt(receipt), contentFormat: loaded.contentFormat, content: loaded.content })
  }
  const document = verified.document
  const context = { contractVersion: DOCX_VISUAL_CONTEXT_VERSION, lineage: { subjectFingerprint: membershipHash(subject),
    sourceFingerprint: subject.source.sourceFingerprint, inputFingerprint: subject.candidate.inputFingerprint,
    docxChecksum: subject.candidate.docxChecksum, previewId: subject.preview.previewId,
    conversionFingerprint: subject.preview.conversionFingerprint, pages: subject.preview.pages },
  candidate: document, sourceExpression: sourceExpression(sourceEnvelope.source), methodDocument, selectedDocuments }
  return assertDocxVisualReviewTransport({ subject, context, contextFingerprint: membershipHash(context), sourceEnvelope,
    candidateInput: verified.candidateInput, document, pages: saved.pages })
}
