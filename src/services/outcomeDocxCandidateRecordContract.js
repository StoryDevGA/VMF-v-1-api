import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE } from './professionalDocumentCandidateRenderer.js'
import { assertDocxSourceQualificationPresentation } from './docxSourceQualificationPresentation.js'
import { MASTER_LINKED_CANDIDATE_VERSION, CORRECTED_MASTER_BINDING_VERSION, APPROVED_MASTER_BINDING_VERSION,
  NARROW_MASTER_BINDING_VERSION, assertMasterLinkedCandidateBinding } from './outcomeMasterLinkedDocxContract.js'
import { CORRECTED_DOCX_INPUT_VERSION } from './commercialDocxExpressionCorrection.js'
import { APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION, NARROW_EXPRESSION_RENDERER,
  assertApprovedCommercialExpression } from './commercialDocxApprovedExpression.js'

export const PRIVATE_DOCX_CANDIDATE_VERSION = 'private-docx-candidate.v1'
export const PRIVATE_DOCX_CANDIDATE_INDEX = 'private_docx_scope_request_unique'
export const PRIVATE_DOCX_CANDIDATE_ID_INDEX = 'private_docx_candidate_unique'
export const PRIVATE_DOCX_CANDIDATE_MAX_BSON = 12 * 1024 * 1024
export const privateDocxFailure = (reason, status = 409) => Object.assign(new Error('The private Word-document candidate is unavailable.'), {
  status, code: 'PRIVATE_DOCX_CANDIDATE_BLOCKED', details: { reason, contentIncludedInError: false },
})
export const privateDocxBytes = value => {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value?._bsontype === 'Binary' && typeof value.value === 'function') return Buffer.from(value.value(true))
  throw privateDocxFailure('STORED_BYTES_INVALID')
}
export const privateDocxByteHash = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`
const id = value => String(value || '')
const fail = reason => { throw privateDocxFailure(reason) }
const hash = value => /^[a-f0-9]{64}$/.test(value || '')

const supportedRendererPresentation = input => {
  if ([APPROVED_DOCX_INPUT_VERSION, NARROW_DOCX_INPUT_VERSION].includes(input.contractVersion)) {
    try { assertApprovedCommercialExpression(input) } catch { return false }
  } else {
  if (input.renderer?.version === '0.1.1') return input.renderer.presentationProfile === undefined
  if (!['0.1.2', '0.1.3'].includes(input.renderer?.version) || input.renderer.presentationProfile !== 'CUSTOMER_DOCUMENT_V1') return false
  if (input.renderer.version === '0.1.3') {
    try { assertDocxSourceQualificationPresentation(input) } catch { return false }
  }
  }
  const source = input.sourceEnvelope?.source
  const title = source?.selectedPacks?.OUTPUT_TYPE?.label
  return typeof title === 'string' && title.length > 0
    && input.model?.title === title && input.documentMetadata?.title === title
    && input.presentation?.titleRule === 'SELECTED_OUTPUT_TYPE_LABEL_V1'
    && input.presentation.titleSourcePath === 'source.selectedPacks.OUTPUT_TYPE.label'
    && input.presentation.originalSourceTitle === source?.content?.shaping?.title
}

export const assertPrivateDocxCandidateRecord = record => {
  const body = record?.body, input = body?.input, source = input?.sourceEnvelope?.source
  const linked = body?.contractVersion === MASTER_LINKED_CANDIDATE_VERSION
  const corrected = linked && body.masterBinding?.contractVersion === CORRECTED_MASTER_BINDING_VERSION
  const narrow = linked && body.masterBinding?.contractVersion === NARROW_MASTER_BINDING_VERSION
  const approved = linked && (body.masterBinding?.contractVersion === APPROVED_MASTER_BINDING_VERSION || narrow)
  if (!body || ![PRIVATE_DOCX_CANDIDATE_VERSION, MASTER_LINKED_CANDIDATE_VERSION].includes(body.contractVersion) || body.status !== 'PRIVATE_UNREVIEWED'
    || (!linked && Object.hasOwn(body, 'masterBinding'))
    || body.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable']
      .some(key => body[key] !== false)
    || !hash(record.bodyFingerprint) || membershipHash(body) !== record.bodyFingerprint
    || !/^docx_candidate_[a-f0-9-]{36}$/.test(body.candidateId || '')
    || body.candidateId !== record.candidateId || body.requestKey !== record.requestKey
    || body.requestFingerprint !== record.requestFingerprint
    || !hash(body.requestFingerprint) || (!linked && membershipHash({ expectedSourceFingerprint: body.sourceFingerprint, format: 'DOCX' }) !== body.requestFingerprint)
    || !/^[a-f0-9]{24}$/.test(body.createdBy || '') || !Number.isFinite(Date.parse(body.createdAt))
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => id(record[key]) !== body.scope?.[key]
      || body.scope[key] !== source?.scope?.[key])
    || !input || input.contractVersion !== (narrow ? NARROW_DOCX_INPUT_VERSION : approved ? APPROVED_DOCX_INPUT_VERSION
      : corrected ? CORRECTED_DOCX_INPUT_VERSION : 'governed-private-docx-input.v1')
    || (corrected && input.renderer?.version !== '0.1.3')
    || !hash(body.inputFingerprint) || membershipHash(input) !== body.inputFingerprint
    || !hash(body.sourceFingerprint) || body.sourceFingerprint !== input.sourceEnvelope.sourceFingerprint
    || membershipHash(source) !== body.sourceFingerprint || input.sourceEnvelope.sourceAdmission !== 'VERIFIED_READ_ONLY_CHAIN'
    || source.kind !== 'GOVERNED_STAGE_CHAIN' || source.scope?.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || source.scope.authoritative !== false
    || ['authoritative', 'normalOutputAvailable', 'authorisesApproval', 'renderingAvailable', 'finalisationAvailable', 'deliveryAvailable']
      .some(key => input.sourceEnvelope[key] !== false)
    || input.renderer?.key !== 'governed-source-private-docx' || !supportedRendererPresentation(input)
    || input.renderer.layoutProfile !== (narrow ? NARROW_EXPRESSION_RENDERER.layoutProfile : 'KEEP_LABEL_WITH_QUOTE_V1')
    || body.packageValidation?.status !== 'PASS'
    || !record.auditId || !Number.isInteger(record.auditSignatureVersion)) fail('STORED_RECEIPT_INVALID')
  const buffer = privateDocxBytes(record.fileBytes)
  if (!buffer.length || buffer.length > PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxOutputBytes
    || body.artifact?.format !== 'DOCX' || body.artifact.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || body.artifact.byteLength !== buffer.length || body.artifact.outputChecksum !== privateDocxByteHash(buffer)) fail('STORED_FILE_CHANGED')
  if (mongoose.mongo.BSON.calculateObjectSize({ ...record, fileBytes: buffer }) > PRIVATE_DOCX_CANDIDATE_MAX_BSON) fail('STORED_BSON_LIMIT')
  if (linked) assertMasterLinkedCandidateBinding(body)
  return buffer
}

export const privateDocxAuditDiff = record => ({ candidateId: record.candidateId, requestKey: record.requestKey,
  requestFingerprint: record.requestFingerprint, bodyFingerprint: record.bodyFingerprint,
  inputFingerprint: record.body.inputFingerprint, sourceFingerprint: record.body.sourceFingerprint,
  outputChecksum: record.body.artifact.outputChecksum, byteLength: record.body.artifact.byteLength,
  ...(record.body.contractVersion === MASTER_LINKED_CANDIDATE_VERSION ? {
    masterBindingFingerprint: assertMasterLinkedCandidateBinding(record.body),
    wrapperFingerprint: record.body.masterBinding.wrapperFingerprint } : {}) })

export const assertPrivateDocxCandidateAudit = (record, audit, verifySignature) => {
  if (!audit || !['signature', 'signatureVersion', 'ts', 'actorUserId', 'resourceId', 'scope', 'diff'].every(key => Object.hasOwn(audit, key))
    || id(audit._id) !== id(record.auditId) || audit.signatureVersion !== record.auditSignatureVersion
    || audit.action !== 'OUTCOME_DOCX_CANDIDATE_CREATED' || audit.resourceType !== 'OutcomeDocxRenditionCandidate'
    || id(audit.resourceId) !== id(record._id) || id(audit.actorUserId) !== record.body.createdBy
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => id(audit.scope[key]) !== record.body.scope[key])
    || membershipHash(audit.diff) !== membershipHash(privateDocxAuditDiff(record))
    || verifySignature(audit) !== true) fail('REQUIRED_SIGNED_AUDIT_INVALID')
}
