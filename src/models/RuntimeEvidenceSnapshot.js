import mongoose from 'mongoose'
import { assertEvidenceMembershipBody, membershipHash, EVIDENCE_MEMBERSHIP_VERSION, membershipError } from '../services/runtimeEvidenceSnapshotContract.js'

const requiredText = max => ({ type: String, required: true, maxlength: max })
const requiredId = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
const schema = new mongoose.Schema({
  snapshotId: { ...requiredText(240), match: /^evidence_snapshot_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/ },
  contractVersion: { ...requiredText(80), enum: [EVIDENCE_MEMBERSHIP_VERSION] },
  customerId: requiredId('Customer'), tenantId: requiredId('Tenant'), runtimeInstanceId: requiredId('RuntimeInstance'),
  rootRuntimeInstanceId: requiredId('RuntimeInstance'), runtimeInstanceKey: requiredText(160), rootRuntimeInstanceKey: requiredText(160),
  revisionNumber: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, workspaceId: { type: String, maxlength: 160 },
  basisStateVersion: requiredText(100), lockSnapshotId: requiredText(240), lockSnapshotHash: { ...requiredText(64), match: /^[a-f0-9]{64}$/ },
  membershipHash: { ...requiredText(64), match: /^[a-f0-9]{64}$/ },
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  createdBy: requiredId('User'), createdAt: { type: Date, required: true },
  lockAuditId: requiredId('AuditLog'), lockAuditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
// Empty reference maps are part of the validated, checksum-bound body.
}, { collection: 'runtime_evidence_snapshots', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.path('body').validate(function validBody(value) {
  try {
    const body = assertEvidenceMembershipBody(value)
    return membershipHash(body) === this.membershipHash && this.createdAt?.toISOString() === body.lockTruthRecord.snapshotAt && body.basisStateVersion === this.basisStateVersion
      && body.lockTruthRecord.snapshotId === this.lockSnapshotId && body.lockTruthRecord.snapshotHash === this.lockSnapshotHash
      && Object.entries(body.scope).every(([key, item]) => String(this[key] ?? '') === String(item))
  } catch { return false }
}, 'Evidence membership body and document identity do not match.')
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, snapshotId: 1 }, { unique: true, name: 'unique_scoped_evidence_snapshot' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, lockSnapshotId: 1 }, { unique: true, name: 'unique_scoped_lock_evidence_snapshot' })
schema.pre('validate', function validateBody(next) {
  try {
    const body = assertEvidenceMembershipBody(this.body)
    if (membershipHash(body) !== this.membershipHash || body.basisStateVersion !== this.basisStateVersion
      || body.lockTruthRecord.snapshotId !== this.lockSnapshotId || body.lockTruthRecord.snapshotHash !== this.lockSnapshotHash
      || Object.entries(body.scope).some(([key, value]) => String(this[key] ?? '') !== String(value))) throw membershipError('DOCUMENT_BINDING_INVALID')
    next()
  } catch (error) { next(error) }
})
schema.pre('save', function immutableSave(next) {
  if (!this.isNew && this.isModified()) return next(membershipError('SNAPSHOT_IMMUTABLE'))
  // This also runs when validateBeforeSave:false is requested. Creation cannot
  // bypass the strict body/identity/hash contract through a storage option.
  next(this.validateSync())
})
schema.pre('insertMany', function validateInserts(next, documents) {
  try {
    for (const document of documents) {
      const error = new this(document).validateSync()
      if (error) throw error
    }
    next()
  } catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function rejectMutation(next) { next(membershipError('SNAPSHOT_IMMUTABLE')) })
}
schema.pre('bulkWrite', function immutableBulk(next, operations) {
  try {
    for (const operation of operations) {
      if (Object.keys(operation).length !== 1 || !operation.insertOne) throw membershipError('SNAPSHOT_IMMUTABLE')
      const error = new this(operation.insertOne.document).validateSync()
      if (error) throw error
    }
    next()
  } catch (error) { next(error) }
})
export const runtimeEvidenceSnapshotSchema = schema
export default mongoose.model('RuntimeEvidenceSnapshot', schema)
