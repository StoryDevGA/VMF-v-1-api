import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { DOCX_PAGE_LIMITS, previewHash, validatePreviewPng } from './docxPagePreviewRuntime.js'
import { privateDocxBytes } from './outcomeDocxCandidateRecordContract.js'
import { MASTER_LINKED_PREVIEW_VERSION } from './outcomeMasterLinkedDocxContract.js'

export const DOCX_PREVIEW_VERSION = 'private-docx-page-preview.v1'
export const DOCX_PREVIEW_ID_INDEX = 'docx_preview_id_unique'
export const DOCX_PREVIEW_IDENTITY_INDEX = 'docx_preview_candidate_runtime_unique'
export const DOCX_PREVIEW_BSON_LIMIT = 12 * 1024 ** 2
export const DOCX_PREVIEW_RESPONSE_LIMIT = 12 * 1024 ** 2
export const docxPreviewFailure = (reason, status = 409) => Object.assign(new Error('The private document page preview is unavailable.'), {
  status, code: 'DOCX_PREVIEW_BLOCKED', details: { reason, contentIncludedInError: false },
})
const fail = reason => { throw docxPreviewFailure(reason) }
const id = value => String(value || '')
const hash = value => /^[a-f0-9]{64}$/.test(value || '')
const checksum = value => /^sha256:[a-f0-9]{64}$/.test(value || '')
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))

export const assertDocxPagePreviewRecord = record => {
  const body = record?.body, conversion = body?.conversion, scope = body?.scope
  const linked = body?.contractVersion === MASTER_LINKED_PREVIEW_VERSION
  if (!exact(body, ['contractVersion', 'previewId', 'candidateId', 'scope', 'createdBy', 'createdAt', 'status', 'classification',
    'authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable',
    'sourceFingerprint', 'inputFingerprint', 'renderer', 'conversion', 'conversionFingerprint',
    ...(linked ? ['candidateBodyFingerprint', 'masterBindingFingerprint'] : [])])
    || ![DOCX_PREVIEW_VERSION, MASTER_LINKED_PREVIEW_VERSION].includes(body.contractVersion) || body.status !== 'PRIVATE_PREVIEW_ONLY'
    || (linked && (!hash(body.candidateBodyFingerprint) || !hash(body.masterBindingFingerprint)))
    || body.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].some(key => body[key] !== false)
    || !/^docx_preview_[a-f0-9-]{36}$/.test(body.previewId || '') || body.previewId !== record.previewId
    || !/^docx_candidate_[a-f0-9-]{36}$/.test(body.candidateId || '') || body.candidateId !== record.candidateId
    || !/^[a-f0-9]{24}$/.test(body.createdBy || '') || !Number.isFinite(Date.parse(body.createdAt))
    || !exact(scope, ['tenantId', 'customerId', 'runtimeInstanceId'])
    || Object.keys(scope).some(key => !/^[a-f0-9]{24}$/.test(scope[key]) || scope[key] !== id(record[key]))
    || !hash(body.sourceFingerprint) || !hash(body.inputFingerprint) || !body.renderer
    || !hash(record.bodyFingerprint) || membershipHash(body) !== record.bodyFingerprint
    || !record.auditId || !Number.isInteger(record.auditSignatureVersion)) fail('PREVIEW_RECEIPT_INVALID')
  if (!exact(conversion, ['contractVersion', 'status', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable',
    'docxChecksum', 'pdfChecksum', 'runtime', 'runtimeFingerprint', 'pages'])
    || conversion.contractVersion !== 'DOCX_PAGE_PREVIEW_V1' || conversion.status !== 'PRIVATE_PREVIEW_ONLY'
    || ['authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].some(key => conversion[key] !== false)
    || !checksum(record.docxChecksum) || conversion.docxChecksum !== record.docxChecksum || !checksum(conversion.pdfChecksum)
    || !hash(record.runtimeFingerprint) || record.runtimeFingerprint !== conversion.runtimeFingerprint
    || previewHash(JSON.stringify(conversion.runtime)) !== record.runtimeFingerprint
    || conversion.runtime?.contractVersion !== 'DOCX_PAGE_RUNTIME_V1' || conversion.runtime.dpi !== 150
    || conversion.runtime.platform !== 'win32' || conversion.runtime.standardFontPolicy !== 'PDFJS_BUNDLED_BASE14_V1'
    || !hash(body.conversionFingerprint) || previewHash(JSON.stringify(conversion)) !== body.conversionFingerprint
    || !Array.isArray(conversion.pages) || conversion.pages.length < 1 || conversion.pages.length > DOCX_PAGE_LIMITS.pages
    || !Array.isArray(record.pageBytes) || record.pageBytes.length !== conversion.pages.length) fail('PREVIEW_CONVERSION_INVALID')
  let totalBytes = 0, totalPixels = 0
  const buffers = record.pageBytes.map((value, index) => {
    let buffer, actual
    try { buffer = privateDocxBytes(value); actual = validatePreviewPng(buffer) } catch { fail('PREVIEW_PAGE_INVALID') }
    const expected = conversion.pages[index]
    if (!exact(expected, ['number', 'width', 'height', 'byteLength', 'sha256']) || expected.number !== index + 1
      || Object.keys(actual).some(key => expected[key] !== actual[key])) fail('PREVIEW_PAGE_CHANGED')
    totalBytes += buffer.length; totalPixels += actual.width * actual.height
    if (totalBytes > DOCX_PAGE_LIMITS.totalPng || totalPixels > DOCX_PAGE_LIMITS.pixels) fail('PREVIEW_OUTPUT_LIMIT')
    return buffer
  })
  if (mongoose.mongo.BSON.calculateObjectSize({ ...record, pageBytes: buffers }) > DOCX_PREVIEW_BSON_LIMIT) fail('PREVIEW_BSON_LIMIT')
  return buffers
}

export const docxPagePreviewAuditDiff = record => ({ previewId: record.previewId, candidateId: record.candidateId,
  docxChecksum: record.docxChecksum, runtimeFingerprint: record.runtimeFingerprint, bodyFingerprint: record.bodyFingerprint,
  sourceFingerprint: record.body.sourceFingerprint, inputFingerprint: record.body.inputFingerprint,
  conversionFingerprint: record.body.conversionFingerprint, pageHashes: record.body.conversion.pages.map(page => page.sha256),
  ...(record.body.contractVersion === MASTER_LINKED_PREVIEW_VERSION ? { candidateBodyFingerprint: record.body.candidateBodyFingerprint,
    masterBindingFingerprint: record.body.masterBindingFingerprint } : {}) })

export const assertDocxPagePreviewAudit = (record, audit, verifySignature) => {
  if (!audit || !['signature', 'signatureVersion', 'ts', 'actorUserId', 'resourceId', 'scope', 'diff'].every(key => Object.hasOwn(audit, key))
    || id(audit._id) !== id(record.auditId) || audit.signatureVersion !== record.auditSignatureVersion
    || audit.action !== 'OUTCOME_DOCX_PAGE_PREVIEW_CREATED' || audit.resourceType !== 'OutcomeDocxPagePreview'
    || id(audit.resourceId) !== id(record._id) || id(audit.actorUserId) !== record.body.createdBy
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => id(audit.scope[key]) !== record.body.scope[key])
    || membershipHash(audit.diff) !== membershipHash(docxPagePreviewAuditDiff(record)) || verifySignature(audit) !== true) fail('PREVIEW_SIGNED_AUDIT_INVALID')
}
