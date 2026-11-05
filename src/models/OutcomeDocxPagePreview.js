import mongoose from 'mongoose'
import { assertDocxPagePreviewRecord, DOCX_PREVIEW_ID_INDEX, DOCX_PREVIEW_IDENTITY_INDEX, docxPreviewFailure } from '../services/outcomeDocxPagePreviewRecordContract.js'
import { MASTER_LINKED_PREVIEW_VERSION } from '../services/outcomeMasterLinkedDocxContract.js'

const schema = new mongoose.Schema({
  previewId: { type: String, required: true }, candidateId: { type: String, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true }, customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  docxChecksum: { type: String, required: true }, runtimeFingerprint: { type: String, required: true },
  bodyFingerprint: { type: String, required: true }, body: { type: mongoose.Schema.Types.Mixed, required: true },
  pageBytes: { type: [Buffer], required: true, default: undefined, select: false },
  auditId: { type: mongoose.Schema.Types.ObjectId, required: true }, auditSignatureVersion: { type: Number, required: true },
}, { collection: 'outcome_docx_page_previews', strict: 'throw', versionKey: false, autoCreate: false, autoIndex: false })
schema.index({ previewId: 1 }, { unique: true, name: DOCX_PREVIEW_ID_INDEX })
schema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, candidateId: 1, docxChecksum: 1, runtimeFingerprint: 1 },
  { unique: true, name: DOCX_PREVIEW_IDENTITY_INDEX })
schema.pre('validate', function validatePreview() { assertDocxPagePreviewRecord(this.toObject()) })
schema.pre('save', function rejectExisting(next) {
  if (!this.isNew) return next(docxPreviewFailure('PREVIEW_IMMUTABLE'))
  try { if (this.body?.contractVersion === MASTER_LINKED_PREVIEW_VERSION) assertDocxPagePreviewRecord(this.toObject()); next() } catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) {
  schema.pre(operation, function rejectMutation(next) { next(docxPreviewFailure('PREVIEW_IMMUTABLE')) })
}
schema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete(next) { next(docxPreviewFailure('PREVIEW_IMMUTABLE')) })
schema.pre('insertMany', function rejectBulkInsert(next) { next(docxPreviewFailure('PREVIEW_BULK_INSERT_UNSUPPORTED')) })
export default mongoose.model('OutcomeDocxPagePreview', schema)
