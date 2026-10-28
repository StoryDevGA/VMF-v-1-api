import mongoose from 'mongoose'
import { assertEvidenceMembershipBody, membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'

export const SNAPSHOT_RECOVERY_POLICY = Object.freeze({
  version: 'ss044-snapshot-serialization-recovery.v1',
  runtimeInstanceId: '6ace5ee09bd4472c6be0cb07', customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
  runtimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1', revisionNumber: 1,
  stateVersion: 'rsv2:4803690a-c762-4e48-8ec3-350049a2a7c4', actorUserId: '6a6c763dcace7a21bd41efa9',
  snapshotStorageId: '6ad267752b7668e0c1ae01af', snapshotId: 'evidence_snapshot_f8546faf-bdde-4453-8ae8-38c5bfa9c733',
  lockAuditId: '6ad267752b7668e0c1ae01ad', failedBodyHash: '18ace31abec36f3a5f6a69c166d6fac689b7e5bd8a792225c35eedb75338844e',
  membershipHash: '962aff92b12cc8ef745d5291f53b7131d136cf536a7d6db38056f5da9dd80c43',
  originalDocumentHash: 'df0900bd7d8e4bcd6494a27a8f0b32b3031732f0a6112652ede737e6669e60db',
  rootMaterialHash: '9d37411a3d4f26667cfda16fd56550bcd0718fb457372f18e0aeb288cf09159c',
})
const p = SNAPSHOT_RECOVERY_POLICY
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
export const snapshotRecoveryError = (reason, status = 409) => Object.assign(new Error('The snapshot serialization correction cannot be verified.'), {
  code: 'SNAPSHOT_RECOVERY_INVALID', status, details: { reason },
})
const need = (condition, reason) => { if (!condition) throw snapshotRecoveryError(reason) }
export const assertSnapshotRecovery = record => {
  const body = membershipJson(record.body)
  need(exact(body, ['policyVersion', 'receiptId', 'requestKey', 'payloadHash', 'actorUserId', 'createdAt', 'rationale', 'original',
    'pointer', 'rootMaterialHash', 'predecessor', 'committed', 'correctedBody', 'nativeReceipts', 'requestBasis']), 'BODY_SHAPE')
  need(body.policyVersion === p.version && uuid.test(body.receiptId) && uuid.test(body.requestKey)
    && body.actorUserId === p.actorUserId && body.receiptId === record.receiptId && body.requestKey === record.requestKey
    && body.payloadHash === record.payloadHash && membershipHash(body) === record.bodyHash
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(record[key]) === p[key]), 'DOCUMENT_BINDING')
  need(exact(body.original, ['storageId', 'snapshotId', 'documentHash', 'bodyHash', 'lockAuditId', 'lockAuditSignatureVersion'])
    && body.original.storageId === p.snapshotStorageId && body.original.snapshotId === p.snapshotId
    && body.original.documentHash === p.originalDocumentHash && body.original.bodyHash === p.failedBodyHash
    && body.original.lockAuditId === p.lockAuditId && Number.isSafeInteger(body.original.lockAuditSignatureVersion)
    && body.original.lockAuditSignatureVersion > 0, 'ORIGINAL_BINDING')
  const corrected = assertEvidenceMembershipBody(body.correctedBody)
  need(membershipHash(corrected) === p.membershipHash && corrected.basisStateVersion === p.stateVersion
    && ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey', 'revisionNumber'].every(key => corrected.scope[key] === p[key])
    && corrected.counts.sources === 8 && corrected.counts.evidence === 47 && corrected.counts.sections === 6, 'CORRECTED_BINDING')
  need(exact(body.pointer, ['contractVersion', 'snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash'])
    && body.pointer.snapshotId === p.snapshotId && body.pointer.membershipHash === p.membershipHash
    && body.pointer.basisStateVersion === p.stateVersion && body.pointer.contractVersion === corrected.contractVersion
    && body.pointer.lockSnapshotId === corrected.lockTruthRecord.snapshotId && body.pointer.lockSnapshotHash === corrected.lockTruthRecord.snapshotHash,
  'POINTER_BINDING')
  need(body.rootMaterialHash === p.rootMaterialHash && exact(body.predecessor, ['updatedAt', 'updatedBy']) && exact(body.committed, ['updatedAt', 'updatedBy'])
    && mongoose.isValidObjectId(body.predecessor.updatedBy) && body.committed.updatedBy === p.actorUserId
    && Number.isFinite(Date.parse(body.predecessor.updatedAt)) && body.createdAt === body.committed.updatedAt
    && Date.parse(body.createdAt) > Date.parse(body.predecessor.updatedAt), 'CONTROL_BINDING')
  need(Array.isArray(body.nativeReceipts) && body.nativeReceipts.length === 3 && new Set(body.nativeReceipts.map(row => row.collection)).size === 3,
    'RECEIPT_BINDING')
  for (const row of body.nativeReceipts) need(exact(row, ['collection', 'storageId', 'bodyHash', 'auditId', 'auditSignatureVersion'])
    && ['runtime_product_authority_receipts', 'runtime_supplemental_finding_reviews', 'runtime_published_disposition_receipts'].includes(row.collection)
    && mongoose.isValidObjectId(row.storageId) && mongoose.isValidObjectId(row.auditId) && hash.test(row.bodyHash)
    && Number.isSafeInteger(row.auditSignatureVersion) && row.auditSignatureVersion > 0, 'RECEIPT_BINDING')
  need(exact(body.requestBasis, ['expectedBasisHash', 'expectedUpdatedAt', 'rationale', 'confirm'])
    && body.requestBasis.expectedUpdatedAt === body.predecessor.updatedAt && body.requestBasis.rationale === body.rationale
    && body.requestBasis.confirm === true && typeof body.rationale === 'string' && body.rationale === body.rationale.trim()
    && body.rationale.length >= 10 && body.rationale.length <= 2000, 'REQUEST_BINDING')
  need(body.requestBasis.expectedBasisHash === membershipHash({ original: body.original, pointer: body.pointer,
    rootMaterialHash: body.rootMaterialHash, correctedBody: body.correctedBody, nativeReceipts: body.nativeReceipts }), 'BASIS_BINDING')
  need(body.payloadHash === membershipHash({ ...body.requestBasis, requestKey: body.requestKey, actorUserId: body.actorUserId }), 'PAYLOAD_BINDING')
  need(Buffer.byteLength(JSON.stringify(body)) <= 768 * 1024, 'BODY_BOUND')
  return body
}
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
const text = { type: String, required: true }
const schema = new mongoose.Schema({ customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  receiptId: { ...text, match: uuid }, requestKey: { ...text, match: uuid }, policyVersion: { ...text, enum: [p.version] },
  originalSnapshotStorageId: id('RuntimeEvidenceSnapshot'), payloadHash: { ...text, match: hash }, bodyHash: { ...text, match: hash },
  body: { type: mongoose.Schema.Types.Mixed, required: true }, auditId: id('AuditLog'),
  auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_evidence_snapshot_recoveries', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
const validate = record => {
  assertSnapshotRecovery(record)
  need(record.policyVersion === p.version && String(record.originalSnapshotStorageId) === p.snapshotStorageId, 'DOCUMENT_BINDING')
}
schema.pre('validate', function (next) { try { validate(this); next() } catch (error) { next(error) } })
schema.pre('save', function (next) {
  try { need(this.isNew, 'IMMUTABLE'); validate(this); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const record of records) { validate(record); const error = new this(record).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw snapshotRecoveryError('IMMUTABLE') })
}
schema.pre('bulkWrite', function (next, operations) {
  try { for (const operation of operations) {
    need(Object.keys(operation).length === 1 && operation.insertOne, 'IMMUTABLE')
    validate(operation.insertOne.document)
    const error = new this(operation.insertOne.document).validateSync(); if (error) throw error
  }; next() } catch (error) { next(error) }
})
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, originalSnapshotStorageId: 1 }, { unique: true, name: 'unique_scoped_snapshot_recovery' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, name: 'unique_scoped_snapshot_recovery_request' })
export default mongoose.model('RuntimeEvidenceSnapshotRecovery', schema)
