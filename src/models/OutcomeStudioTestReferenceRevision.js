import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
  OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES,
  OUTCOME_STUDIO_TEST_REFERENCE_FORMAT,
  OUTCOME_STUDIO_TEST_REFERENCE_LIMITS,
  OUTCOME_STUDIO_TEST_REFERENCE_STATUSES,
} from '../constants/outcomeStudioTestReferences.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const actorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_NAME_LENGTH },
  email: { type: String, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_EMAIL_LENGTH },
}, { _id: false, strict: 'throw' })

const productApprovalSchema = new mongoose.Schema({
  approverName: { type: String, required: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_NAME_LENGTH },
  approverRole: { type: String, required: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_ACTOR_NAME_LENGTH },
  rationale: { type: String, required: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RATIONALE_LENGTH },
  recordedBy: { type: actorSchema, required: true },
  recordedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' })

const supersessionSchema = new mongoose.Schema({
  replacementReferenceKey: { type: String, required: true, match: uuidPattern },
  reason: { type: String, required: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RATIONALE_LENGTH },
  recordedBy: { type: actorSchema, required: true },
  recordedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' })

const schema = new mongoose.Schema({
  referenceKey: { type: String, required: true, immutable: true, match: uuidPattern },
  revision: { type: Number, required: true, immutable: true, min: 1 },
  previousRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutcomeStudioTestReferenceRevision', immutable: true, default: null },
  objectId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutcomeStudioTestReferenceObject', required: true, immutable: true },
  family: { type: String, required: true, immutable: true, enum: OUTCOME_STUDIO_REFERENCE_FAMILIES },
  title: { type: String, required: true, immutable: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_TITLE_LENGTH },
  purpose: { type: String, immutable: true, default: '', maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_PURPOSE_LENGTH },
  status: { type: String, required: true, immutable: true, enum: Object.values(OUTCOME_STUDIO_TEST_REFERENCE_STATUSES) },
  originalFileName: { type: String, required: true, immutable: true, maxlength: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_FILENAME_LENGTH },
  mimeType: { type: String, required: true, immutable: true, enum: [OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.MIME_TYPE] },
  extension: { type: String, required: true, immutable: true, enum: [OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION] },
  sha256: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  byteLength: { type: Number, required: true, immutable: true, min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RAW_BYTES },
  storageIdentity: { type: String, required: true, immutable: true, match: uuidPattern },
  productApproval: { type: productApprovalSchema, immutable: true, default: null },
  supersession: { type: supersessionSchema, immutable: true, default: null },
  createdBy: { type: actorSchema, required: true, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'outcome_studio_test_reference_revisions',
})

schema.index({ referenceKey: 1, revision: 1 }, { unique: true, name: 'uniq_outcome_studio_test_reference_revision' })

const immutableError = () => {
  const error = new Error('Outcome Studio TEST reference revisions are immutable.')
  error.code = OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.IMMUTABLE
  error.status = 409
  return error
}

schema.pre('validate', function validateLifecycle(next) {
  const hasApproval = Boolean(this.productApproval)
  const hasSupersession = Boolean(this.supersession)
  const valid = (
    (this.status === OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.DRAFT && !hasApproval && !hasSupersession)
    || (this.status === OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED && hasApproval && !hasSupersession)
    || (this.status === OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.SUPERSEDED && hasApproval && hasSupersession)
  )
  if (!valid) {
    const error = new Error('Outcome Studio TEST reference lifecycle metadata is invalid.')
    error.code = OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.TRANSITION_INVALID
    error.status = 409
    return next(error)
  }
  next()
})

schema.pre('save', function rejectExistingSave(next) {
  if (!this.isNew) return next(immutableError())
  next()
})

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function rejectMutation(next) { next(immutableError()) })
}

export default mongoose.model('OutcomeStudioTestReferenceRevision', schema)
