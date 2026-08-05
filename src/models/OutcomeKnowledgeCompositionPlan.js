import mongoose from 'mongoose'

import {
  OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
  OUTCOME_KCP_ERROR_CODES,
  OUTCOME_KCP_OPERATIONS,
  OUTCOME_KCP_STATUSES,
} from '../constants/outcomeGovernedQuality.js'

const sha256Pattern = /^[a-f0-9]{64}$/

const schema = new mongoose.Schema({
  planId: { type: String, required: true, immutable: true, trim: true, maxlength: 180 },
  planVersion: { type: Number, required: true, immutable: true, min: 1 },
  contractVersion: {
    type: String,
    required: true,
    immutable: true,
    enum: [OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION],
    default: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
  },
  operation: {
    type: String,
    required: true,
    immutable: true,
    enum: Object.values(OUTCOME_KCP_OPERATIONS),
  },
  status: {
    type: String,
    required: true,
    immutable: true,
    enum: [OUTCOME_KCP_STATUSES.READY, OUTCOME_KCP_STATUSES.READY_WITH_GAPS],
  },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, immutable: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuntimeInstance', required: true, immutable: true },
  runtimeInstanceKey: { type: String, required: true, immutable: true, trim: true, lowercase: true, maxlength: 160 },
  runtimeType: { type: String, required: true, immutable: true, trim: true, uppercase: true, maxlength: 80 },
  frameworkKey: { type: String, required: true, immutable: true, trim: true, uppercase: true, maxlength: 80 },
  packageKey: { type: String, required: true, immutable: true, trim: true, maxlength: 120 },
  packageVersion: { type: String, required: true, immutable: true, trim: true, maxlength: 50 },
  requestedOutputTypeKey: { type: String, required: true, immutable: true, trim: true, lowercase: true, maxlength: 140 },
  sourcePlanId: { type: String, immutable: true, trim: true, maxlength: 180, default: '' },
  sourcePlanFingerprint: { type: String, immutable: true, match: /^(?:[a-f0-9]{64})?$/, default: '' },
  reResolutionReason: { type: String, immutable: true, trim: true, maxlength: 500, default: '' },
  publishSnapshotId: { type: String, required: true, immutable: true, trim: true, maxlength: 220 },
  lockSnapshotId: { type: String, required: true, immutable: true, trim: true, maxlength: 220 },
  replayAnchorId: { type: String, required: true, immutable: true, trim: true, maxlength: 220 },
  dependencySnapshotId: { type: String, required: true, immutable: true, trim: true, maxlength: 220 },
  planFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  resolutionFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  contextFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  selectedPackCount: { type: Number, required: true, immutable: true, min: 1 },
  consideredPackCount: { type: Number, required: true, immutable: true, min: 1 },
  gapCount: { type: Number, required: true, immutable: true, min: 0 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, {
  collection: 'outcome_knowledge_composition_plans',
  strict: 'throw',
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform(_doc, ret) {
      ret.id = String(ret._id)
      delete ret._id
      delete ret.__v
      return ret
    },
  },
})

schema.index({ planId: 1 }, { unique: true, name: 'uniq_outcome_kcp_plan_id' })
schema.index(
  { runtimeInstanceId: 1, planVersion: 1 },
  { unique: true, name: 'uniq_outcome_kcp_runtime_version' },
)
schema.index(
  { tenantId: 1, customerId: 1, runtimeInstanceId: 1, createdAt: -1 },
  { name: 'outcome_kcp_runtime_history' },
)

const immutableError = () => {
  const error = new Error('Outcome Knowledge Composition Plans are immutable.')
  error.code = OUTCOME_KCP_ERROR_CODES.IMMUTABLE
  error.status = 409
  return error
}

schema.pre('validate', function validateShape(next) {
  if (!this.isNew) return next(immutableError())
  if (!this.payload || typeof this.payload !== 'object' || Array.isArray(this.payload)) {
    const error = new Error('Outcome Knowledge Composition Plan payload is required.')
    error.code = OUTCOME_KCP_ERROR_CODES.INPUT_INVALID
    error.status = 422
    return next(error)
  }
  this.planId = String(this.planId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.requestedOutputTypeKey = String(this.requestedOutputTypeKey || '').trim().toLowerCase()
  this.sourcePlanId = String(this.sourcePlanId || '').trim()
  this.sourcePlanFingerprint = String(this.sourcePlanFingerprint || '').trim().toLowerCase()
  this.reResolutionReason = String(this.reResolutionReason || '').trim()
  this.planFingerprint = String(this.planFingerprint || '').trim().toLowerCase()
  this.resolutionFingerprint = String(this.resolutionFingerprint || '').trim().toLowerCase()
  this.contextFingerprint = String(this.contextFingerprint || '').trim().toLowerCase()
  next()
})

schema.pre('save', function rejectExistingSave(next) {
  if (!this.isNew) return next(immutableError())
  next()
})

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
]) {
  schema.pre(operation, function rejectMutation(next) { next(immutableError()) })
}

schema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete(next) {
  next(immutableError())
})

export default mongoose.model('OutcomeKnowledgeCompositionPlan', schema)
