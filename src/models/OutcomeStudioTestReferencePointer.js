import mongoose from 'mongoose'
import { OUTCOME_STUDIO_REFERENCE_FAMILIES, OUTCOME_STUDIO_TEST_REFERENCE_STATUSES } from '../constants/outcomeStudioTestReferences.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const schema = new mongoose.Schema({
  referenceKey: { type: String, required: true, immutable: true, match: uuidPattern },
  family: { type: String, required: true, immutable: true, enum: OUTCOME_STUDIO_REFERENCE_FAMILIES },
  currentRevision: { type: Number, required: true, min: 1 },
  currentRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutcomeStudioTestReferenceRevision', required: true },
  currentStatus: { type: String, required: true, enum: Object.values(OUTCOME_STUDIO_TEST_REFERENCE_STATUSES) },
}, {
  timestamps: true,
  collection: 'outcome_studio_test_reference_pointers',
})

schema.index({ referenceKey: 1 }, { unique: true, name: 'uniq_outcome_studio_test_reference_pointer' })
schema.index({ updatedAt: -1, _id: -1 }, { name: 'outcome_studio_test_reference_current_list' })
schema.index(
  { family: 1, currentStatus: 1, updatedAt: -1, _id: -1 },
  { name: 'outcome_studio_test_reference_family_approved_current' },
)

export default mongoose.model('OutcomeStudioTestReferencePointer', schema)
