import { CORRECTED_DOCX_INPUT_VERSION, assertCommercialDocxExpressionCorrection } from './commercialDocxExpressionCorrection.js'
import { CORRECTED_MASTER_BINDING_VERSION, CORRECTED_MASTER_WRAPPER_VERSION, CORRECTED_MASTER_EXPRESSION_ORIGIN } from './outcomeMasterLinkedDocxContract.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { readCurrentDocxPagePreview } from './outcomeDocxPagePreviewPersistenceService.js'
import { MASTER_LINKED_CANDIDATE_VERSION, MASTER_LINKED_PREVIEW_VERSION, assertMasterReference } from './outcomeMasterLinkedDocxContract.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { validatePreviewPng, previewHash } from './docxPagePreviewRuntime.js'
import { MEANING_MASTER_FLAGS } from './outcomeMeaningSourceMasterContract.js'
import { APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION, assertApprovedCommercialExpression } from './commercialDocxApprovedExpression.js'
import { APPROVED_MASTER_BINDING_VERSION, APPROVED_MASTER_WRAPPER_VERSION, APPROVED_MASTER_EXPRESSION_ORIGIN,
  NARROW_MASTER_BINDING_VERSION, NARROW_MASTER_WRAPPER_VERSION, NARROW_MASTER_EXPRESSION_ORIGIN } from './outcomeMasterLinkedDocxContract.js'
import { APPROVED_DOCX_OPERATION_LIMITS } from './approvedDocxReadProfile.js'

export const MASTER_LINKED_REVIEW_BINDING_VERSION = 'master-linked-docx-review-binding.v1'
export const CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION = 'master-linked-docx-review-binding.v2'
export const APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION = 'master-linked-docx-review-binding.v3'
export const NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION = 'master-linked-docx-review-binding.v4'
const fail = reason => { throw Object.assign(new Error('The master-linked review binding is unavailable.'), {
  code: 'MASTER_LINKED_REVIEW_BINDING_BLOCKED', status: 409, details: { reason, dispatchAvailable: false },
}) }
const same = (a, b) => membershipHash(a) === membershipHash(b)
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
// Pure reconstruction. Persisted receipt authentication belongs to the default reader.
export const assertMasterLinkedReviewInput = (input, binding, candidateId, docxChecksum, allowApproved = false) => {
  const narrow = allowApproved === 'NARROW'
  if (input?.contractVersion === APPROVED_DOCX_INPUT_VERSION || input?.contractVersion === NARROW_DOCX_INPUT_VERSION) {
    if (![true, 'NARROW'].includes(allowApproved) || input.contractVersion !== (narrow ? NARROW_DOCX_INPUT_VERSION : APPROVED_DOCX_INPUT_VERSION)
      || !exact(binding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', 'compatibilityReference'])
      || binding.contractVersion !== (narrow ? NARROW_MASTER_BINDING_VERSION : APPROVED_MASTER_BINDING_VERSION)
      || binding.expressionOrigin !== (narrow ? NARROW_MASTER_EXPRESSION_ORIGIN : APPROVED_MASTER_EXPRESSION_ORIGIN)) fail('REVIEW_INPUT_VERSION_PAIR')
    const compatibility = assertApprovedCommercialExpression(input)
    if (!same(binding.compatibilityReference, compatibility) || candidateId === compatibility.predecessorCandidateId
      || binding.masterReference?.masterId !== compatibility.masterId || binding.masterReference?.sourceFingerprint !== compatibility.sourceFingerprint) fail('REVIEW_COMPATIBILITY_CHANGED')
    const wrapper = { contractVersion: narrow ? NARROW_MASTER_WRAPPER_VERSION : APPROVED_MASTER_WRAPPER_VERSION, masterReference: binding.masterReference,
      expressionOrigin: binding.expressionOrigin, renditionInput: input, renditionInputFingerprint: membershipHash(input),
      outputChecksum: docxChecksum, compatibilityReference: compatibility }
    if (membershipHash(wrapper) !== binding.wrapperFingerprint) fail('REVIEW_COMPATIBILITY_WRAPPER_CHANGED')
    return false
  }
  const corrected = input?.contractVersion === CORRECTED_DOCX_INPUT_VERSION
  if (!['governed-private-docx-input.v1', CORRECTED_DOCX_INPUT_VERSION].includes(input?.contractVersion)
    || !exact(binding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', ...(corrected ? ['correctionReference'] : [])])
    || binding.contractVersion !== (corrected ? CORRECTED_MASTER_BINDING_VERSION : 'master-linked-private-docx-binding.v1')
    || binding.expressionOrigin !== (corrected ? CORRECTED_MASTER_EXPRESSION_ORIGIN : 'RETAINED_SOURCE_SHAPING_UNREVIEWED')) fail('REVIEW_INPUT_VERSION_PAIR')
  if (corrected) {
    assertCommercialDocxExpressionCorrection(input)
    const correction = binding.correctionReference, predecessor = correction?.predecessor
    if (!exact(correction, ['predecessor', 'predecessorBodyFingerprint'])
      || typeof correction.predecessorBodyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(correction.predecessorBodyFingerprint)
      || !same(predecessor, input.expressionCorrection.predecessor) || predecessor.candidateId === candidateId
      || predecessor.inputFingerprint === membershipHash(input) || predecessor.outputChecksum === docxChecksum
      || input.renderer?.version !== '0.1.3') fail('REVIEW_CORRECTION_CHANGED')
    const wrapper = { contractVersion: CORRECTED_MASTER_WRAPPER_VERSION, masterReference: binding.masterReference,
      expressionOrigin: binding.expressionOrigin, renditionInput: input, renditionInputFingerprint: membershipHash(input),
      outputChecksum: docxChecksum, correctionReference: correction }
    if (membershipHash(wrapper) !== binding.wrapperFingerprint) fail('REVIEW_CORRECTION_WRAPPER_CHANGED')
  }
  return corrected
}
// Read-only identity binding, deliberately NOT a claim/dispatch/provider context.
const prepareBinding = async (args, approved = false) => {
  const narrow = approved === 'NARROW'
  const deadline = Date.now() + (approved ? APPROVED_DOCX_OPERATION_LIMITS.APPROVED_REVIEW_PREPARATION.deadlineMs : 480000)
  const check = () => { if (Date.now() > deadline) fail('REVIEW_BINDING_DEADLINE') }
  const request = { actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId, candidateId: args.candidateId, scopes: args.scopes }
  const reader = args.deps?.readCandidate || readPrivateDocxCandidate
  const observed = await reader({ ...request, includeBytes: true, includeInput: true }); check()
  const candidate = JSON.parse(JSON.stringify(observed?.candidate || {})), bytes = Buffer.from(observed?.buffer || [])
  const input = JSON.parse(JSON.stringify(observed?.candidateInput || {}))
  if (approved && input?.contractVersion !== (narrow ? NARROW_DOCX_INPUT_VERSION : APPROVED_DOCX_INPUT_VERSION)) fail('REVIEW_INPUT_VERSION_PAIR')
  const corrected = assertMasterLinkedReviewInput(input, candidate.masterBinding, candidate.candidateId, candidate.artifact?.outputChecksum, approved)
  if (candidate.contractVersion !== MASTER_LINKED_CANDIDATE_VERSION || candidate.candidateId !== args.candidateId
    || !same(observed.scope, candidate.masterBinding?.masterReference?.scope)
    || observed.scope?.runtimeInstanceId !== args.runtimeInstanceId || MEANING_MASTER_FLAGS.some(key => candidate[key] !== false)
    || candidate.masterBindingFingerprint !== membershipHash(candidate.masterBinding)
    || candidate.inputFingerprint !== membershipHash(input) || candidate.artifact?.outputChecksum !== `sha256:${previewHash(bytes)}`
    || candidate.artifact.byteLength !== bytes.length) fail('REVIEW_CANDIDATE_CHANGED')
  assertMasterReference(candidate.masterBinding.masterReference)
  const previewReader = args.deps?.readPreview || (value => readCurrentDocxPagePreview({ ...value,
    // Same authenticated observation reused within this bounded read. The final
    // candidate read below independently checks source/master currentness again.
    deps: { readCandidate: async () => ({ ...observed, candidate, buffer: Buffer.from(bytes), candidateInput: input }) } }))
  const saved = await previewReader({ ...request, includePages: true }); check()
  const preview = saved?.preview
  if (preview?.contractVersion !== MASTER_LINKED_PREVIEW_VERSION || preview.candidateId !== candidate.candidateId
    || preview.masterBindingFingerprint !== candidate.masterBindingFingerprint || preview.candidateBodyFingerprint !== candidate.bodyFingerprint
    || !same(preview.scope, observed.scope) || preview.sourceFingerprint !== candidate.sourceFingerprint
    || preview.inputFingerprint !== candidate.inputFingerprint || !same(preview.renderer, candidate.renderer)
    || preview.conversion?.docxChecksum !== candidate.artifact.outputChecksum || MEANING_MASTER_FLAGS.some(key => preview[key] !== false)
    || !Array.isArray(saved.pages) || !Array.isArray(preview.conversion?.pages)
    || saved.pages.length !== preview.conversion.pages.length) fail('REVIEW_PREVIEW_CHANGED')
  const pages = saved.pages.map((value, index) => {
    if (!Buffer.isBuffer(value)) fail('REVIEW_PAGE_CHANGED')
    const actual = validatePreviewPng(value), expected = preview.conversion.pages[index]
    if (expected.number !== index + 1 || Object.keys(actual).some(key => actual[key] !== expected[key])) fail('REVIEW_PAGE_CHANGED')
    return Buffer.from(value)
  })
  const binding = JSON.parse(JSON.stringify({ contractVersion: narrow ? NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION : approved ? APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION
    : corrected ? CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION : MASTER_LINKED_REVIEW_BINDING_VERSION,
    candidateId: candidate.candidateId, candidateBodyFingerprint: candidate.bodyFingerprint,
    masterReference: candidate.masterBinding.masterReference, masterBindingFingerprint: candidate.masterBindingFingerprint,
    sourceFingerprint: candidate.sourceFingerprint, inputFingerprint: candidate.inputFingerprint,
    docxChecksum: candidate.artifact.outputChecksum, renderer: candidate.renderer,
    previewId: preview.previewId, conversionFingerprint: preview.conversionFingerprint,
    runtimeFingerprint: preview.conversion.runtimeFingerprint, pages: preview.conversion.pages,
    ...(corrected ? { correctionReference: candidate.masterBinding.correctionReference } : {}),
    ...(approved ? { compatibilityReference: candidate.masterBinding.compatibilityReference } : {}) }))
  const current = await reader({ ...request, includeBytes: true, includeInput: true }); check()
  assertMasterLinkedReviewInput(current.candidateInput, current.candidate?.masterBinding, current.candidate?.candidateId, current.candidate?.artifact?.outputChecksum, approved)
  if (current.candidate?.bodyFingerprint !== candidate.bodyFingerprint || current.candidate.masterBindingFingerprint !== candidate.masterBindingFingerprint
    || !Buffer.isBuffer(current.buffer) || !current.buffer.equals(bytes)
    || !same(current.candidateInput, input)) fail('REVIEW_BINDING_STALE')
  return { binding, bindingFingerprint: membershipHash(binding), document: { title: input.model.title, markdown: input.markdown,
    inputFingerprint: candidate.inputFingerprint }, pages, dispatchAvailable: false,
    ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])) }
}
export const prepareMasterLinkedDocxReviewBinding = args => prepareBinding(args)
export const prepareApprovedMasterLinkedDocxReviewBinding = args => prepareBinding(args, true)
export const prepareNarrowMasterLinkedDocxReviewBinding = args => prepareBinding(args, 'NARROW')
