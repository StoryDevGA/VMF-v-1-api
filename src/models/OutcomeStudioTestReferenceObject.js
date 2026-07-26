import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES,
  OUTCOME_STUDIO_TEST_REFERENCE_FORMAT,
  OUTCOME_STUDIO_TEST_REFERENCE_LIMITS,
} from '../constants/outcomeStudioTestReferences.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const schema = new mongoose.Schema({
  storageIdentity: { type: String, required: true, immutable: true, match: uuidPattern },
  bytes: {
    type: Buffer,
    required: true,
    immutable: true,
    select: false,
    validate: {
      validator: (value) => Buffer.isBuffer(value) && value.length >= 1 && value.length <= OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RAW_BYTES,
      message: 'Outcome Studio TEST reference bytes exceed the storage limit.',
    },
  },
  sha256: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  byteLength: { type: Number, required: true, immutable: true, min: 1, max: OUTCOME_STUDIO_TEST_REFERENCE_LIMITS.MAX_RAW_BYTES },
  mimeType: { type: String, required: true, immutable: true, enum: [OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.MIME_TYPE] },
  extension: { type: String, required: true, immutable: true, enum: [OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'outcome_studio_test_reference_objects',
})

schema.index({ storageIdentity: 1 }, { unique: true, name: 'uniq_outcome_studio_test_reference_object_identity' })

const immutableError = () => {
  const error = new Error('Outcome Studio TEST reference objects are immutable.')
  error.code = OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.IMMUTABLE
  error.status = 409
  return error
}

schema.pre('save', function rejectExistingSave(next) {
  if (!this.isNew) return next(immutableError())
  next()
})

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function rejectMutation(next) { next(immutableError()) })
}

export default mongoose.model('OutcomeStudioTestReferenceObject', schema)
