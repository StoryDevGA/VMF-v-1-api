import mongoose from 'mongoose'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

export const REVIEW_COMPLETION_VERSION = 'intelligence-review-completion.v1'
export const REVIEW_POPULATION_POLICY = 'revision-evidence-contradiction-decisions.v1'
const id = (ref) => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true, immutable: true })
const text = (maxlength) => ({ type: String, required: true, maxlength, immutable: true })
const hash = { ...text(64), match: /^[a-f0-9]{64}$/ }
const schema = new mongoose.Schema({
  customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  runtimeInstanceKey: text(160), rootRuntimeInstanceKey: text(160),
  receiptId: { ...text(36), match: /^[a-f0-9-]{36}$/ },
  requestKey: { ...text(36), match: /^[a-f0-9-]{36}$/ }, payloadHash: hash,
  contractVersion: { ...text(80), enum: [REVIEW_COMPLETION_VERSION] },
  populationPolicy: { ...text(80), enum: [REVIEW_POPULATION_POLICY] },
  populationHash: hash, observedStateVersion: text(100),
  manifest: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true,
    validate: (value) => Buffer.byteLength(JSON.stringify(value)) <= 512 * 1024 },
  actorUserId: id('User'), authority: { ...text(80), enum: ['VMF_UPDATE'] },
  rationale: { ...text(2000), minlength: 10 }, completedAt: { type: Date, required: true, immutable: true },
  auditId: id('AuditLog'), auditSignatureVersion: { type: Number, required: true, immutable: true },
}, { collection: 'runtime_review_completions', strict: 'throw', versionKey: false })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 },
  { unique: true, name: 'unique_scoped_review_completion_request' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, completedAt: -1, _id: -1 },
  { name: 'scoped_review_completion_history' })
schema.pre('validate', function () {
  if (this.populationHash !== snapshotHash(this.manifest)
    || this.manifest?.policy !== this.populationPolicy
    || !Array.isArray(this.manifest?.evidence) || !Array.isArray(this.manifest?.contradictions)) {
    this.invalidate('manifest', 'Review population manifest proof is invalid.')
  }
})
schema.pre('save', function () { if (!this.isNew) throw new Error('Review Completion receipts are immutable.') })
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Review Completion receipts are append-only.') })
}
export default mongoose.model('RuntimeReviewCompletion', schema)
