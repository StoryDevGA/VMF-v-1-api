import mongoose from 'mongoose'
import { MEANING_MASTER_INDEXES, assertMeaningMasterRecord, meaningMasterFailure } from '../services/outcomeMeaningSourceMasterContract.js'

const schema = new mongoose.Schema({
  masterId: { type: String, required: true }, version: { type: Number, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestKey: { type: String, required: true }, requestFingerprint: { type: String, required: true },
  sourceFingerprint: { type: String, required: true }, permittedUse: { type: String, required: true },
  contractVersion: { type: String, required: true }, bodyFingerprint: { type: String, required: true },
  body: { type: mongoose.Schema.Types.Mixed, required: true }, auditId: { type: mongoose.Schema.Types.ObjectId, required: true },
  auditSignatureVersion: { type: Number, required: true },
}, { collection: 'outcome_meaning_source_masters', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
for (const [name, key] of Object.entries(MEANING_MASTER_INDEXES)) schema.index(key, { unique: true, name })
schema.pre('validate', function validateRecord() { assertMeaningMasterRecord(this.toObject()) })
schema.pre('save', function protectSave() {
  if (!this.isNew) throw meaningMasterFailure('MASTER_IMMUTABLE')
  assertMeaningMasterRecord(this.toObject())
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany',
  'findOneAndDelete', 'findOneAndRemove', 'bulkWrite', 'insertMany']) {
  schema.pre(operation, function rejectMutation() { throw meaningMasterFailure('MASTER_IMMUTABLE') })
}
schema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete() { throw meaningMasterFailure('MASTER_IMMUTABLE') })
export default mongoose.model('OutcomeMeaningSourceMaster', schema)
