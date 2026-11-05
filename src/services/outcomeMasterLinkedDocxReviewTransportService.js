import { createHash } from 'node:crypto'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { readMeaningSourceMasterForRendition } from './outcomeMeaningSourceMasterService.js'
import { prepareMasterLinkedDocxReviewBinding, prepareApprovedMasterLinkedDocxReviewBinding, prepareNarrowMasterLinkedDocxReviewBinding, MASTER_LINKED_REVIEW_BINDING_VERSION,
  CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION, APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION, NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION, assertMasterLinkedReviewInput } from './outcomeMasterLinkedDocxReviewBindingService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { resolveKnowledgePackBoundary } from '../constants/knowledgeRuntime.js'
import { loadOutcomeMethodDocument, assertOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from './outcomeMethodDocumentService.js'
import { assertOutcomeStudioProviderSafeValue, assertOutcomeMethodDocumentPrivacy, assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'
import { DOCX_PAGE_LIMITS, validatePreviewPng, previewHash } from './docxPagePreviewRuntime.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { assertMasterReference } from './outcomeMasterLinkedDocxContract.js'
import { APPROVED_DOCX_OPERATION_LIMITS } from './approvedDocxReadProfile.js'
import { deriveMasterReviewSourceUse, masterReviewPreparationProfile, requireMasterReview as need,
  sameMasterReviewValue as same, masterReviewFalseFlags } from './outcomeMasterLinkedReviewSourceUseService.js'

export const MASTER_REVIEW_SUBJECT_VERSION = 'master-linked-docx-review-subject.v2'
export const CORRECTED_MASTER_REVIEW_SUBJECT_VERSION = 'master-linked-docx-review-subject.v3'
const layers = ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']
const copy = value => JSON.parse(JSON.stringify(value))
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const receipt = pack => Object.fromEntries(['packId', 'versionId', 'activationId', 'contentHash'].map(key => [key, pack?.[key]]))
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]))
const bindingKeys = ['contractVersion', 'candidateId', 'candidateBodyFingerprint', 'masterReference', 'masterBindingFingerprint',
  'sourceFingerprint', 'inputFingerprint', 'docxChecksum', 'renderer', 'previewId', 'conversionFingerprint', 'runtimeFingerprint', 'pages']
const witnessKeys = ['candidateId', 'bodyFingerprint', 'masterBinding', 'masterBindingFingerprint', 'sourceFingerprint', 'inputFingerprint', 'artifact', 'renderer']
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
// Same semantic allowlist used by the meaning-review projection. Internal
// contribution/activation metadata is omitted; semantic restrictions are not.
const meaning = output => ({ ...(Object.hasOwn(output, 'compositionVersion') ? { compositionVersion: output.compositionVersion } : {}),
  title: output.title, sections: output.sections.map(section => ({ ...pick(section,
    ['order', 'sectionKey', 'title', 'content', 'truthReferences', 'assumptions', 'gaps']),
  claims: section.claims.map(claim => ({ ...pick(claim, ['claimKey', 'statement', 'truthReferences', 'evidence']),
    ...(Object.hasOwn(claim, 'meaningClass') ? pick(claim, ['meaningClass', 'proofDependencies', 'validationStatus', 'proofDisposition',
      'whatCanBeSaidNow', 'blockedStrongerClaim', 'evidenceRequiredToSubstantiate']) : {}) })) })),
  decisionLogic: output.decisionLogic.map(decision => ({ ...pick(decision, ['decisionKey', 'rationale', 'priority', 'truthReferences']),
    ...(Object.hasOwn(decision, 'priorityBasis') ? pick(decision, ['priorityBasis', 'closureState', 'actionAuthorization']) : {}) })),
  assumptions: output.assumptions, visibleGaps: output.visibleGaps })
const expression = source => ({ status: 'UNREVIEWED_RETAINED_SHAPING', sections: source.content.shaping.sections.map(section =>
  pick(section, ['order', 'heading', 'body', 'qualification', 'diagram'])), visibleGaps: source.content.shaping.visibleGaps })
const contextFor = (subject, source, document, methodDocument, selectedDocuments, candidateInput) => ({
  contractVersion: subject.transport.contextVersion,
  lineage: { subjectFingerprint: membershipHash(subject), bindingFingerprint: membershipHash(subject.binding),
    policyFingerprint: subject.policyFingerprint, sourceFingerprint: subject.binding.sourceFingerprint,
    inputFingerprint: subject.binding.inputFingerprint, docxChecksum: subject.binding.docxChecksum,
    conversionFingerprint: subject.binding.conversionFingerprint, pages: subject.binding.pages },
  candidate: document, reviewedMeaning: { status: 'MEANING_REVIEWED_ONLY', candidate: meaning(source.content.workingDraft),
    meaningSummary: source.content.approvedMeaning.meaningSummary },
  retainedExpression: expression(source), methodDocument, selectedDocuments,
  ...([APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION, NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION].includes(subject.binding.contractVersion) ? {
    expressionCompatibility: { status: 'PRIVATE_EXPRESSION_COMPATIBILITY_ONLY',
      ...copy(candidateInput.presentation.approvedQualificationMapping), schemaContentComplete: false,
      unresolvedFacts: ['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'],
      sourceMeaningApprovalChanged: false, customerApproved: false } } : {}) })

const assertTransport = (transport, approved = false) => {
  const narrow = approved === 'NARROW'
  need(exact(transport, ['subject', 'context', 'contextFingerprint', 'master', 'witnesses', 'sourceEnvelope', 'candidateInput', 'document', 'pages']), 'TRANSPORT_SHAPE')
  const { subject, context, master, sourceEnvelope, candidateInput, document, pages } = transport
  const corrected = candidateInput?.contractVersion === 'governed-private-docx-input.v2'
  need(approved ? candidateInput?.contractVersion === (narrow ? 'governed-private-docx-input.v4' : 'governed-private-docx-input.v3')
    : candidateInput?.contractVersion !== 'governed-private-docx-input.v3', 'PREPARATION_INPUT_VERSION')
  const bindingVersion = narrow ? NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION : approved ? APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION
    : corrected ? CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION : MASTER_LINKED_REVIEW_BINDING_VERSION
  const profile = masterReviewPreparationProfile(bindingVersion)
  const keys = [...bindingKeys, ...(corrected ? ['correctionReference'] : []), ...(approved ? ['compatibilityReference'] : [])]
  need(exact(subject, ['contractVersion', 'actorUserId', 'binding', 'policy', 'policyFingerprint', 'method', 'packs', 'transport', ...Object.keys(masterReviewFalseFlags())])
    && subject.contractVersion === profile.subjectVersion && same(subject.transport, profile.transport)
    && Object.keys(masterReviewFalseFlags()).every(key => subject[key] === false), 'SUBJECT_SHAPE')
  const binding = subject.binding
  const witnesses = transport.witnesses, candidate = witnesses?.candidate, preview = witnesses?.preview
  need(exact(binding, keys) && binding.contractVersion === bindingVersion
    && exact(witnesses, ['candidate', 'masterReference', 'preview']) && exact(candidate, witnessKeys)
    && exact(preview, keys) && same(preview, binding), 'BINDING_SHAPE')
  assertMasterReference(witnesses.masterReference)
  need(same(binding.masterReference, witnesses.masterReference) && same(binding.masterReference, candidate.masterBinding?.masterReference)
    && candidate.masterBindingFingerprint === membershipHash(candidate.masterBinding)
    && same(binding, { ...preview, candidateId: candidate.candidateId, candidateBodyFingerprint: candidate.bodyFingerprint,
      masterReference: witnesses.masterReference, masterBindingFingerprint: candidate.masterBindingFingerprint,
      sourceFingerprint: candidate.sourceFingerprint, inputFingerprint: candidate.inputFingerprint,
      docxChecksum: candidate.artifact?.outputChecksum, renderer: candidate.renderer })
    && /^docx_candidate_[a-f0-9-]{36}$/.test(binding.candidateId) && /^docx_preview_[a-f0-9-]{36}$/.test(binding.previewId)
    && ['candidateBodyFingerprint', 'masterBindingFingerprint', 'sourceFingerprint', 'inputFingerprint', 'conversionFingerprint', 'runtimeFingerprint'].every(key => digest(binding[key]))
    && /^sha256:[a-f0-9]{64}$/.test(binding.docxChecksum), 'BINDING_WITNESS')
  const policy = deriveMasterReviewSourceUse({ actorUserId: subject.actorUserId, runtimeInstanceId: binding.masterReference.scope.runtimeInstanceId,
    master, sourceEnvelope, binding })
  need(same(policy, subject.policy) && membershipHash(policy) === subject.policyFingerprint, 'POLICY_BINDING')
  need(candidateInput?.contractVersion === (narrow ? 'governed-private-docx-input.v4' : approved ? 'governed-private-docx-input.v3' : corrected ? 'governed-private-docx-input.v2' : 'governed-private-docx-input.v1') && membershipHash(candidateInput) === binding.inputFingerprint
    && same(candidateInput.sourceEnvelope, sourceEnvelope) && same(candidateInput.renderer, binding.renderer)
    && exact(subject.packs, layers) && layers.every(layer => same(receipt(candidateInput.selectedPacks?.[layer]), subject.packs[layer])
      && same(subject.packs[layer], receipt(sourceEnvelope.source.selectedPacks?.[layer]))), 'INPUT_BINDING')
  assertMasterLinkedReviewInput(candidateInput, candidate.masterBinding, candidate.candidateId, candidate.artifact.outputChecksum, approved)
  if (corrected) need(same(binding.correctionReference, candidate.masterBinding.correctionReference), 'CORRECTION_BINDING')
  if (approved) need(same(binding.compatibilityReference, candidate.masterBinding.compatibilityReference), 'COMPATIBILITY_BINDING')
  need(exact(document, ['title', 'markdown', 'inputFingerprint']) && document.inputFingerprint === binding.inputFingerprint
    && document.title === candidateInput.model?.title && document.markdown === candidateInput.markdown
    && typeof document.title === 'string' && document.title.trim() && document.title.length <= 255
    && typeof document.markdown === 'string' && document.markdown.trim(), 'DOCUMENT_BINDING')
  need(exact(context, ['contractVersion', 'lineage', 'candidate', 'reviewedMeaning', 'retainedExpression', 'methodDocument', 'selectedDocuments',
    ...(approved ? ['expressionCompatibility'] : [])])
    && same(context, contextFor(subject, sourceEnvelope.source, document, context.methodDocument, context.selectedDocuments, candidateInput)), 'CONTEXT_BINDING')
  assertOutcomeStudioProviderSafeValue(document.title)
  assertOutcomeStudioProviderSafeValue(document.markdown)
  need(Buffer.byteLength(JSON.stringify(context.reviewedMeaning)) <= 140000, 'MEANING_BUDGET')
  assertOutcomeStudioProviderSafeValue(context.reviewedMeaning)
  assertOutcomeStudioProviderSafeValue(context.retainedExpression)
  // Receipt hashes and source paths are bound metadata, not semantic prose.
  if (approved) context.expressionCompatibility.mappings.forEach(item => assertOutcomeStudioProviderSafeValue({
    source: item.source, original: item.original, customerExpression: item.customerExpression }))
  assertOutcomeMethodDocument(context.methodDocument, { role: 'RL', boundary: 'POST_GENERATION_VALIDATION' })
  assertOutcomeMethodDocumentPrivacy(context.methodDocument)
  need(same(projectOutcomeMethodDocumentReceipt(context.methodDocument), subject.method), 'METHOD_BINDING')
  need(Array.isArray(context.selectedDocuments) && context.selectedDocuments.length === layers.length, 'PROFILE_DOCUMENTS')
  context.selectedDocuments.forEach((item, index) => {
    need(exact(item, ['layer', 'receipt', 'contentFormat', 'content']) && item.layer === layers[index]
      && same(item.receipt, subject.packs[item.layer]) && ['MARKDOWN', 'JSON', 'YAML', 'YML'].includes(item.contentFormat)
      && typeof item.content === 'string' && Buffer.byteLength(item.content) <= 200000
      && `sha256:${createHash('sha256').update(item.content).digest('hex')}` === item.receipt.contentHash, 'PROFILE_BINDING')
    assertOutcomeSelectedDocumentPrivacy(item.content)
  })
  need(Buffer.byteLength(JSON.stringify(context)) <= 512 * 1024 && membershipHash(context) === transport.contextFingerprint, 'CONTEXT_BUDGET_OR_FINGERPRINT')
  need(Array.isArray(pages) && Array.isArray(binding.pages) && pages.length > 0 && pages.length <= DOCX_PAGE_LIMITS.pages && pages.length === binding.pages.length, 'PAGE_POPULATION')
  let bytes = 0, pixels = 0
  pages.forEach((page, index) => {
    need(Buffer.isBuffer(page), 'PAGE_BYTES')
    const actual = validatePreviewPng(page), expected = binding.pages[index]
    need(exact(expected, ['number', ...Object.keys(actual)]) && expected.number === index + 1
      && Object.keys(actual).every(key => actual[key] === expected[key]), 'PAGE_BINDING')
    bytes += page.length; pixels += actual.width * actual.height
  })
  need(bytes <= DOCX_PAGE_LIMITS.totalPng && pixels <= DOCX_PAGE_LIMITS.pixels, 'PAGE_BUDGET')
  return transport
}

// Server-only read composition. No route, write owner, provider adapter or key.
const prepareTransport = async (args, approved = false) => {
  const prepareReviewBinding = approved === 'NARROW' ? prepareNarrowMasterLinkedDocxReviewBinding
    : approved ? prepareApprovedMasterLinkedDocxReviewBinding : prepareMasterLinkedDocxReviewBinding
  const deps = args.deps || {}, deadline = Date.now() + (approved
    ? APPROVED_DOCX_OPERATION_LIMITS.APPROVED_REVIEW_PREPARATION.deadlineMs : 600000)
  const check = () => need(Date.now() <= deadline, 'PREPARATION_DEADLINE')
  const request = pick(args, ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes'])
  const reader = deps.readCandidate || readPrivateDocxCandidate
  const observed = await reader({ ...request, includeBytes: true, includeInput: true }); check()
  const initial = { ...copy({ candidate: observed.candidate, candidateInput: observed.candidateInput, scope: observed.scope }), buffer: Buffer.from(observed.buffer) }
  let reads = 0
  // The approved transport owns a fresh initial and final default observation.
  // Its nested binding composes that initial observation; the independent final
  // read below still validates the actual source, bytes, input and master.
  const prepared = await prepareReviewBinding({ ...request, deps: {
    readCandidate: value => approved || ++reads === 1 ? initial : reader(value), ...(deps.readPreview ? { readPreview: deps.readPreview } : {}) } }); check()
  const ref = prepared.binding.masterReference
  const masterRead = deps.readMaster || (value => readMeaningSourceMasterForRendition({ ...value,
    deps: { readSource: async () => copy(initial.candidateInput.sourceEnvelope) } }))
  const verifiedMaster = await masterRead({ ...request, masterId: ref.masterId, version: ref.version }); check()
  need(same(verifiedMaster.masterReference, ref) && same(verifiedMaster.sourceEnvelope, initial.candidateInput.sourceEnvelope), 'CURRENT_MASTER_CHANGED')
  const master = copy(verifiedMaster.master), sourceEnvelope = copy(verifiedMaster.sourceEnvelope), planRef = sourceEnvelope.source.plan
  const plan = await (deps.loadPlan || (filter => Plan.findOne(filter).lean()))({ ...ref.scope, _id: planRef.recordId,
    planId: planRef.planId, requestId: planRef.requestId }); check()
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  need(plan && String(plan._id) === planRef.recordId && ['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(key => plan[key] === planRef[key])
    && Object.keys(ref.scope).every(key => String(plan[key]) === ref.scope[key]), 'CURRENT_PLAN_CHANGED')
  const assignments = plan.payload.stagePlan.filter(stage => stage.stageKey === 'RENDERED_EXPRESSION_RL')
  need(assignments.length === 1 && assignments[0].order === 6 && assignments[0].assignedActivationIds?.length === 1, 'METHOD_ASSIGNMENT')
  const selected = plan.payload.resolution.selectedPacks.filter(pack => pack.activationId === assignments[0].assignedActivationIds[0])
  const pack = selected[0]
  need(selected.length === 1 && pack.packType === 'RL' && pack.stageAssignments?.includes('RENDERED_EXPRESSION_RL')
    && (pack.status || pack.lifecycleStatus) === 'ACTIVE' && resolveKnowledgePackBoundary(pack) === 'POST_GENERATION_VALIDATION', 'METHOD_ASSIGNMENT')
  const loader = deps.loadPackContent || loadOutcomeKnowledgePackVersionContent
  const methodDocument = copy(await loadOutcomeMethodDocument({ role: 'RL', selection: { ...pack, status: 'ACTIVE' }, loadPackContent: loader })); check()
  const packs = {}, selectedDocuments = []
  for (const layer of layers) {
    packs[layer] = receipt(initial.candidateInput.selectedPacks[layer])
    const loaded = await loader({ packId: packs[layer].packId, versionId: packs[layer].versionId }); check()
    need(loaded?.available && loaded.status === 'ACTIVE' && loaded.packId === packs[layer].packId
      && loaded.versionId === packs[layer].versionId && loaded.contentHash === packs[layer].contentHash, 'CURRENT_PROFILE_CHANGED')
    selectedDocuments.push(copy({ layer, receipt: packs[layer], contentFormat: loaded.contentFormat, content: loaded.content }))
  }
  const binding = copy(prepared.binding), policy = deriveMasterReviewSourceUse({ ...request, master, sourceEnvelope, binding })
  const profile = masterReviewPreparationProfile(binding.contractVersion)
  const subject = { contractVersion: profile.subjectVersion, actorUserId: String(args.actorUserId), binding, policy,
    policyFingerprint: membershipHash(policy), method: projectOutcomeMethodDocumentReceipt(methodDocument), packs,
    transport: { ...profile.transport }, ...masterReviewFalseFlags() }
  const document = copy(prepared.document), context = contextFor(subject, sourceEnvelope.source, document, methodDocument, selectedDocuments, initial.candidateInput)
  const witnesses = { candidate: copy(pick(initial.candidate, witnessKeys)), masterReference: copy(verifiedMaster.masterReference), preview: copy(prepared.binding) }
  const transport = assertTransport({ subject, context, contextFingerprint: membershipHash(context), master, witnesses, sourceEnvelope,
    candidateInput: copy(initial.candidateInput), document, pages: prepared.pages.map(page => Buffer.from(page)) }, approved)
  const current = await reader({ ...request, includeBytes: true, includeInput: true }); check()
  need(current.candidate?.bodyFingerprint === binding.candidateBodyFingerprint
    && current.candidate.masterBindingFingerprint === binding.masterBindingFingerprint && same(current.candidateInput, initial.candidateInput)
    && Buffer.isBuffer(current.buffer) && current.buffer.equals(initial.buffer)
    && `sha256:${previewHash(current.buffer)}` === binding.docxChecksum, 'PREPARATION_STALE')
  return assertTransport(transport, approved)
}
export const assertMasterLinkedDocxReviewTransport = transport => assertTransport(transport)
export const assertApprovedMasterLinkedDocxReviewTransport = transport => assertTransport(transport, true)
export const assertNarrowMasterLinkedDocxReviewTransport = transport => assertTransport(transport, 'NARROW')
export const prepareMasterLinkedDocxReviewTransport = args => prepareTransport(args)
export const prepareApprovedMasterLinkedDocxReviewTransport = args => prepareTransport(args, true)
export const prepareNarrowMasterLinkedDocxReviewTransport = args => prepareTransport(args, 'NARROW')
