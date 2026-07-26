import mongoose from 'mongoose'
import { OUTCOME_STUDIO_READINESS_ENVIRONMENT, OUTCOME_STUDIO_READINESS_REGISTER_ID } from '../constants/outcomeStudioReadiness.js'

const schema = new mongoose.Schema({
  registerId: { type: String, required: true, default: OUTCOME_STUDIO_READINESS_REGISTER_ID },
  environment: { type: String, required: true, default: OUTCOME_STUDIO_READINESS_ENVIRONMENT },
  currentRevision: { type: Number, required: true, min: 1 },
  currentRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutcomeStudioReadinessRevision', required: true },
}, { timestamps: true })

schema.index({ registerId: 1, environment: 1 }, { unique: true, name: 'uniq_outcome_studio_readiness_pointer' })

export default mongoose.model('OutcomeStudioReadinessPointer', schema)
