import mongoose from 'mongoose'

const requiredText = { type: String, required: true, trim: true }
const scopeId = { type: mongoose.Schema.Types.ObjectId, required: true }
const schema = new mongoose.Schema({
  operationId: requiredText,
  contractVersion: { type: String, default: 'outcome-successor.operation.v1', immutable: true },
  actorUserId: scopeId, customerId: scopeId, tenantId: scopeId,
  sourceRuntimeInstanceId: scopeId, targetRuntimeInstanceId: scopeId,
  sourceAssetId: requiredText, sourceAssetVersionId: requiredText,
  idempotencyKey: requiredText, requestId: requiredText,
  payloadFingerprint: requiredText,
  binding: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PREPARING', 'READY_TO_GENERATE', 'GENERATING', 'BLOCKED', 'RECOVERY_REQUIRED', 'SUCCEEDED'], default: 'PREPARING', required: true },
  claimId: { type: String, default: '', trim: true },
  refs: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  blockerReason: { type: String, default: '', trim: true },
}, { collection: 'outcome_successor_operations', timestamps: true, strict: 'throw' })
schema.index({ operationId: 1 }, { unique: true, name: 'uniq_outcome_successor_operation' })
schema.index({ customerId: 1, tenantId: 1, sourceRuntimeInstanceId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_outcome_successor_idempotency' })
schema.index({ customerId: 1, tenantId: 1, sourceRuntimeInstanceId: 1,
  sourceAssetId: 1, sourceAssetVersionId: 1, createdAt: -1 })
schema.index({ customerId: 1, tenantId: 1, targetRuntimeInstanceId: 1, requestId: 1 },
  { unique: true, name: 'uniq_outcome_successor_target_request' })

export default mongoose.model('OutcomeSuccessorOperation', schema)
