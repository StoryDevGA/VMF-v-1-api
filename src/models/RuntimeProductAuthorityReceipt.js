import mongoose from 'mongoose'
import { RUNTIME_PRODUCT_AUTHORITY_POLICY as policy, parseApprovedProductAuthority } from '../constants/runtimeProductAuthorityPolicy.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'

const text = max => ({ type: String, required: true, maxlength: max })
const hash = { ...text(64), match: /^[a-f0-9]{64}$/ }
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
export const productAuthorityBinding = record => ({ receiptId: record.receiptId, bodyHash: record.bodyHash,
  approvalReference: record.approvalReference, version: record.approvalVersion, documentHash: policy.documentHash })
export const assertRuntimeProductAuthorityReceipt = record => {
  const body = membershipJson(record.body)
  const source = parseApprovedProductAuthority(body.approvalDocumentText)
  const keys = ['contractVersion', 'receiptId', 'requestKey', 'payloadHash', 'approvalDocumentText', 'documentHash',
    'approvalReference', 'version', 'procedureReference', 'approvedAt', 'effectiveFrom', 'documentRecordedAt',
    'recordedAt', 'recorder', 'approver', 'delegation', 'scope', 'ledgerApproval', 'stateVersion', 'evidencePairHash',
    'freezeHash', 'runtimeWitnessHash', 'originalAuditHash', 'qualifications', 'authorisesLock', 'authorisesARL']
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')
    || record.approvalReference !== policy.approvalReference || record.approvalVersion !== policy.version
    || body.approvalReference !== source.approvalReference || body.version !== source.version
    || body.contractVersion !== policy.contractVersion || body.documentHash !== policy.documentHash
    || body.procedureReference !== source.procedureReference || body.approvedAt !== source.approvalAtUtc
    || body.effectiveFrom !== source.effectiveFromUtc || body.documentRecordedAt !== source.recordedAtUtc
    || ['approver', 'delegation', 'scope', 'ledgerApproval'].some(key => membershipHash(body[key]) !== membershipHash(source[key]))
    || body.delegation.reviewerUserId !== policy.reviewerUserId
    || body.stateVersion !== basisPolicy.stateVersion || body.evidencePairHash !== source.basisToVerifyBeforeAnyFutureUse.evidencePairHash
    || body.freezeHash !== basisPolicy.manifestHash || body.runtimeWitnessHash !== basisPolicy.runtimeWitnessHash
    || body.originalAuditHash !== basisPolicy.originalAuditHash || membershipHash(body.qualifications) !== basisPolicy.qualificationsHash
    || !mongoose.isValidObjectId(body.recorder?.userId) || body.recorder?.platformRole !== 'SUPER_ADMIN'
    || Object.keys(body.recorder).sort().join(',') !== 'platformRole,userId'
    || !Number.isFinite(Date.parse(body.recordedAt)) || Date.parse(body.recordedAt) < Date.parse(source.recordedAtUtc)
    || Date.parse(body.recordedAt) < Date.parse(body.effectiveFrom)
    || body.authorisesLock !== false || body.authorisesARL !== false
    || body.receiptId !== record.receiptId || body.requestKey !== record.requestKey || body.payloadHash !== record.payloadHash
    || membershipHash(body) !== record.bodyHash
    || ['customerId', 'tenantId', 'runtimeInstanceId'].some(key => String(record[key]) !== basisPolicy.scope[key]))
    throw new Error('Native product authority binding is invalid.')
  return body
}

const schema = new mongoose.Schema({
  customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  receiptId: { ...text(36), match: /^[a-f0-9-]{36}$/ }, requestKey: { ...text(36), match: /^[a-f0-9-]{36}$/ },
  approvalReference: { ...text(120), enum: [policy.approvalReference] }, approvalVersion: { type: Number, required: true, enum: [policy.version] },
  payloadHash: hash, bodyHash: hash, body: { type: mongoose.Schema.Types.Mixed, required: true },
  auditId: id('AuditLog'), auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_product_authority_receipts', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) {
  try { assertRuntimeProductAuthorityReceipt(this); next() } catch (error) { next(error) }
})
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Product authority receipts are immutable.'))
  try { assertRuntimeProductAuthorityReceipt(this); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const record of records) { assertRuntimeProductAuthorityReceipt(record); const error = new this(record).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Product authority receipts are immutable.') })
}
schema.pre('bulkWrite', function (next, operations) {
  try {
    for (const operation of operations) {
      if (Object.keys(operation).length !== 1 || !operation.insertOne) throw new Error('Product authority receipts are immutable.')
      assertRuntimeProductAuthorityReceipt(operation.insertOne.document)
      const error = new this(operation.insertOne.document).validateSync(); if (error) throw error
    }
    next()
  } catch (error) { next(error) }
})
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, approvalReference: 1, approvalVersion: 1 },
  { unique: true, name: 'unique_runtime_product_authority_version' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 },
  { unique: true, name: 'unique_runtime_product_authority_request' })
export default mongoose.model('RuntimeProductAuthorityReceipt', schema)
