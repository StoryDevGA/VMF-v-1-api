import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { projectMeaningMasterSource, meaningMasterId, meaningMasterObjectId } from './outcomeMeaningSourceMasterContract.js'
import { CORRECTED_DOCX_INPUT_VERSION, assertCommercialDocxExpressionCorrection } from './commercialDocxExpressionCorrection.js'
import { APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION, approvedExpressionProfile,
  assertApprovedCommercialExpression } from './commercialDocxApprovedExpression.js'
// Frozen bridge input identity; checked against its owner by the focused tests.
const MEANING_MASTER_RENDITION_INPUT_VERSION = 'meaning-master-private-docx-input.v1'

export const MASTER_LINKED_CANDIDATE_VERSION = 'private-docx-candidate.v2'
export const MASTER_LINKED_PREVIEW_VERSION = 'private-docx-page-preview.v2'
export const MASTER_LINKED_BINDING_VERSION = 'master-linked-private-docx-binding.v1'
export const CORRECTED_MASTER_BINDING_VERSION = 'master-linked-private-docx-binding.v2'
export const CORRECTED_MASTER_WRAPPER_VERSION = 'meaning-master-private-docx-input.v2'
export const CORRECTED_MASTER_EXPRESSION_ORIGIN = 'VERSIONED_COMMERCIAL_CORRECTION_UNREVIEWED'
export const APPROVED_MASTER_BINDING_VERSION = 'master-linked-private-docx-binding.v3'
export const APPROVED_MASTER_WRAPPER_VERSION = 'meaning-master-private-docx-input.v3'
export const APPROVED_MASTER_EXPRESSION_ORIGIN = 'APPROVED_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED'
export const NARROW_MASTER_BINDING_VERSION = 'master-linked-private-docx-binding.v4'
export const NARROW_MASTER_WRAPPER_VERSION = 'meaning-master-private-docx-input.v4'
export const NARROW_MASTER_EXPRESSION_ORIGIN = 'NARROW_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED'
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const fail = reason => { throw Object.assign(new Error('The saved master-linked document binding is unavailable.'), {
  code: 'MASTER_LINKED_DOCX_BLOCKED', status: 409, details: { reason, contentIncludedInError: false },
}) }
export const assertMasterReference = ref => {
  if (!exact(ref, ['storageId', 'masterId', 'version', 'scope', 'bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint', 'auditId', 'auditSignatureVersion'])
    || !meaningMasterId(ref.masterId) || ref.version !== 1 || !meaningMasterObjectId(ref.storageId) || !meaningMasterObjectId(ref.auditId)
    || !exact(ref.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) || !Object.values(ref.scope).every(meaningMasterObjectId)
    || !['bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint'].every(key => hash(ref[key]))
    || !Number.isSafeInteger(ref.auditSignatureVersion) || ref.auditSignatureVersion < 1) fail('MASTER_REFERENCE_INVALID')
  return ref
}
export const masterLinkedRequestFingerprint = (ref, renderer) => membershipHash({
  contractVersion: MASTER_LINKED_CANDIDATE_VERSION, bridgeVersion: MEANING_MASTER_RENDITION_INPUT_VERSION,
  masterReference: assertMasterReference(ref), rendererFingerprint: membershipHash(renderer), format: 'DOCX',
})
export const correctedMasterLinkedRequestFingerprint = (ref, renderer, correctionReference) => membershipHash({
  contractVersion: MASTER_LINKED_CANDIDATE_VERSION, bridgeVersion: CORRECTED_MASTER_WRAPPER_VERSION,
  masterReference: assertMasterReference(ref), rendererFingerprint: membershipHash(renderer), correctionReference, format: 'DOCX',
})
export const approvedMasterLinkedRequestFingerprint = (ref, renderer, compatibilityReference) => membershipHash({
  contractVersion: MASTER_LINKED_CANDIDATE_VERSION,
  bridgeVersion: approvedExpressionProfile(compatibilityReference?.version).inputVersion === NARROW_DOCX_INPUT_VERSION
    ? NARROW_MASTER_WRAPPER_VERSION : APPROVED_MASTER_WRAPPER_VERSION,
  masterReference: assertMasterReference(ref), rendererFingerprint: membershipHash(renderer), compatibilityReference, format: 'DOCX',
})
export const masterBindingFromBridge = bridge => ({ contractVersion: bridge.input.contractVersion === NARROW_MASTER_WRAPPER_VERSION
  ? NARROW_MASTER_BINDING_VERSION : bridge.input.contractVersion === APPROVED_MASTER_WRAPPER_VERSION
    ? APPROVED_MASTER_BINDING_VERSION : bridge.input.contractVersion === CORRECTED_MASTER_WRAPPER_VERSION ? CORRECTED_MASTER_BINDING_VERSION : MASTER_LINKED_BINDING_VERSION,
  masterReference: JSON.parse(JSON.stringify(bridge.input.masterReference)),
  expressionOrigin: bridge.input.expressionOrigin, wrapperFingerprint: bridge.inputFingerprint,
  ...(bridge.input.contractVersion === CORRECTED_MASTER_WRAPPER_VERSION
    ? { correctionReference: JSON.parse(JSON.stringify(bridge.input.correctionReference)) } : {}),
  ...([APPROVED_MASTER_WRAPPER_VERSION, NARROW_MASTER_WRAPPER_VERSION].includes(bridge.input.contractVersion)
    ? { compatibilityReference: JSON.parse(JSON.stringify(bridge.input.compatibilityReference)) } : {}) })
export const assertMasterLinkedCandidateBinding = body => {
  const binding = body?.masterBinding
  if ([APPROVED_MASTER_BINDING_VERSION, NARROW_MASTER_BINDING_VERSION].includes(binding?.contractVersion)) return assertApprovedMasterBinding(body)
  const corrected = binding?.contractVersion === CORRECTED_MASTER_BINDING_VERSION
  if (!exact(body, ['contractVersion', 'candidateId', 'scope', 'requestKey', 'requestFingerprint', 'createdBy', 'createdAt',
    'classification', 'status', 'authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval',
    'finalisationAvailable', 'deliveryAvailable', 'sourceFingerprint', 'inputFingerprint', 'input', 'artifact', 'packageValidation', 'masterBinding'])
    || body.contractVersion !== MASTER_LINKED_CANDIDATE_VERSION
    || !exact(binding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', ...(corrected ? ['correctionReference'] : [])])
    || binding.contractVersion !== (corrected ? CORRECTED_MASTER_BINDING_VERSION : MASTER_LINKED_BINDING_VERSION)
    || binding.expressionOrigin !== (corrected ? CORRECTED_MASTER_EXPRESSION_ORIGIN : 'RETAINED_SOURCE_SHAPING_UNREVIEWED')
    || body.input?.contractVersion !== (corrected ? CORRECTED_DOCX_INPUT_VERSION : 'governed-private-docx-input.v1')
    || !hash(binding.wrapperFingerprint)) fail('MASTER_BINDING_INVALID')
  const ref = assertMasterReference(binding.masterReference), input = body.input
  if (corrected) {
    assertCommercialDocxExpressionCorrection(input)
    if (!exact(binding.correctionReference, ['predecessor', 'predecessorBodyFingerprint'])
      || !hash(binding.correctionReference.predecessorBodyFingerprint)
      || membershipHash(binding.correctionReference.predecessor) !== membershipHash(input.expressionCorrection.predecessor)
      || body.candidateId === binding.correctionReference.predecessor.candidateId) fail('CORRECTION_REFERENCE_CHANGED')
  }
  const projection = projectMeaningMasterSource(input?.sourceEnvelope)
  if (Object.keys(ref.scope).some(key => ref.scope[key] !== body.scope?.[key] || ref.scope[key] !== projection.scope[key])
    || ref.sourceFingerprint !== body.sourceFingerprint || membershipHash(projection) !== ref.sourceProjectionFingerprint
    || body.inputFingerprint !== membershipHash(input)
    || body.requestFingerprint !== (corrected ? correctedMasterLinkedRequestFingerprint(ref, input.renderer, binding.correctionReference)
      : masterLinkedRequestFingerprint(ref, input.renderer))) fail('MASTER_BINDING_SOURCE_CHANGED')
  const wrapper = { contractVersion: corrected ? CORRECTED_MASTER_WRAPPER_VERSION : MEANING_MASTER_RENDITION_INPUT_VERSION, masterReference: ref,
    expressionOrigin: binding.expressionOrigin, renditionInput: input, renditionInputFingerprint: body.inputFingerprint,
    outputChecksum: body.artifact?.outputChecksum, ...(corrected ? { correctionReference: binding.correctionReference } : {}) }
  if (membershipHash(wrapper) !== binding.wrapperFingerprint) fail('MASTER_WRAPPER_CHANGED')
  return membershipHash(binding)
}

const assertApprovedMasterBinding = body => {
  const binding = body.masterBinding, input = body.input
  const narrow = binding.contractVersion === NARROW_MASTER_BINDING_VERSION
  if (!exact(body, ['contractVersion', 'candidateId', 'scope', 'requestKey', 'requestFingerprint', 'createdBy', 'createdAt',
    'classification', 'status', 'authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval',
    'finalisationAvailable', 'deliveryAvailable', 'sourceFingerprint', 'inputFingerprint', 'input', 'artifact', 'packageValidation', 'masterBinding'])
    || body.contractVersion !== MASTER_LINKED_CANDIDATE_VERSION
    || !exact(binding, ['contractVersion', 'masterReference', 'expressionOrigin', 'wrapperFingerprint', 'compatibilityReference'])
    || binding.expressionOrigin !== (narrow ? NARROW_MASTER_EXPRESSION_ORIGIN : APPROVED_MASTER_EXPRESSION_ORIGIN)
    || !hash(binding.wrapperFingerprint)) fail('APPROVED_MASTER_BINDING_INVALID')
  const ref = assertMasterReference(binding.masterReference), compatibility = assertApprovedCommercialExpression(input)
  const projection = projectMeaningMasterSource(input.sourceEnvelope)
  if (input.contractVersion !== (narrow ? NARROW_DOCX_INPUT_VERSION : APPROVED_DOCX_INPUT_VERSION)
    || approvedExpressionProfile(compatibility.version).inputVersion !== input.contractVersion
    || !exact(binding.compatibilityReference, Object.keys(compatibility))
    || membershipHash(compatibility) !== membershipHash(binding.compatibilityReference)
    || ref.masterId !== compatibility.masterId || ref.sourceFingerprint !== compatibility.sourceFingerprint
    || body.candidateId === compatibility.predecessorCandidateId
    || Object.keys(ref.scope).some(key => ref.scope[key] !== body.scope?.[key] || ref.scope[key] !== projection.scope[key])
    || ref.sourceFingerprint !== body.sourceFingerprint || membershipHash(projection) !== ref.sourceProjectionFingerprint
    || body.inputFingerprint !== membershipHash(input)
    || body.requestFingerprint !== approvedMasterLinkedRequestFingerprint(ref, input.renderer, compatibility)) fail('APPROVED_MASTER_SOURCE_CHANGED')
  const wrapper = { contractVersion: narrow ? NARROW_MASTER_WRAPPER_VERSION : APPROVED_MASTER_WRAPPER_VERSION, masterReference: ref,
    expressionOrigin: narrow ? NARROW_MASTER_EXPRESSION_ORIGIN : APPROVED_MASTER_EXPRESSION_ORIGIN,
    renditionInput: input, renditionInputFingerprint: body.inputFingerprint,
    outputChecksum: body.artifact?.outputChecksum, compatibilityReference: compatibility }
  if (membershipHash(wrapper) !== binding.wrapperFingerprint) fail('APPROVED_MASTER_WRAPPER_CHANGED')
  return membershipHash(binding)
}
