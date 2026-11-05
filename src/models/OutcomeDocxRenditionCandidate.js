import mongoose from 'mongoose'
import { assertPrivateDocxCandidateRecord, PRIVATE_DOCX_CANDIDATE_INDEX, PRIVATE_DOCX_CANDIDATE_ID_INDEX,
  privateDocxFailure } from '../services/outcomeDocxCandidateRecordContract.js'
import { validateProfessionalDocumentCandidatePackage } from '../services/professionalDocumentCandidateRenderer.js'
import { MASTER_LINKED_CANDIDATE_VERSION } from '../services/outcomeMasterLinkedDocxContract.js'

const schema = new mongoose.Schema({
  candidateId: { type: String, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestKey: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  bodyFingerprint: { type: String, required: true },
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  fileBytes: { type: Buffer, required: true, select: false },
  auditId: { type: mongoose.Schema.Types.ObjectId, required: true },
  auditSignatureVersion: { type: Number, required: true },
}, { collection: 'outcome_docx_rendition_candidates', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.index({ candidateId: 1 }, { unique: true, name: PRIVATE_DOCX_CANDIDATE_ID_INDEX })
schema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, name: PRIVATE_DOCX_CANDIDATE_INDEX })
schema.pre('validate', async function validateRecord() {
  const buffer = assertPrivateDocxCandidateRecord(this.toObject())
  await validateProfessionalDocumentCandidatePackage(buffer)
})
schema.pre('save', async function rejectExisting() {
  if (!this.isNew) throw privateDocxFailure('CANDIDATE_IMMUTABLE')
  if (this.body?.contractVersion === MASTER_LINKED_CANDIDATE_VERSION) {
    await validateProfessionalDocumentCandidatePackage(assertPrivateDocxCandidateRecord(this.toObject()))
  }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) {
  schema.pre(operation, function rejectMutation(next) { next(privateDocxFailure('CANDIDATE_IMMUTABLE')) })
}
schema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete(next) { next(privateDocxFailure('CANDIDATE_IMMUTABLE')) })
schema.pre('insertMany', function rejectBulkInsert(next) { next(privateDocxFailure('CANDIDATE_BULK_INSERT_UNSUPPORTED')) })
export default mongoose.model('OutcomeDocxRenditionCandidate', schema)
