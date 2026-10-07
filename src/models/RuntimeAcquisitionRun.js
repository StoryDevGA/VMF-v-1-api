import mongoose from 'mongoose'

export const ACQUISITION_RUN_VERSION = 'acquisition-run.v1'
export const ACQUISITION_PLANNER_VERSION = 'discovery-acquisition-planner.v1'
export const ACQUISITION_TERMINAL_STATES = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED']
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const text = maxlength => ({ type: String, required: true, maxlength, immutable: true })
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true, immutable: true })
const hash = { ...text(64), match: /^[a-f0-9]{64}$/ }
const inputSchema = new mongoose.Schema({
  kind: { ...text(12), enum: ['BRIEF', 'WEBSITE', 'DOCUMENT'] },
  inputIndex: { type: Number, required: true, min: 0, max: 9, immutable: true },
  contentHash: hash,
}, { _id: false, strict: 'throw' })
const outcomeSchema = new mongoose.Schema({
  kind: { type: String, required: true, enum: ['BRIEF', 'WEBSITE', 'DOCUMENT'] },
  inputIndex: { type: Number, required: true, min: 0, max: 9 },
  status: { type: String, required: true, enum: ['SUCCEEDED', 'FAILED', 'UNATTEMPTED'] },
  sourceId: { type: String, maxlength: 160, match: /^[A-Za-z0-9_-]+$/ },
  contentHash: { type: String, match: /^[a-f0-9]{64}$/ },
  evidenceObjectCount: { type: Number, min: 0, required: true },
  reason: { type: String, maxlength: 80 },
}, { _id: false, strict: 'throw' })
const schema = new mongoose.Schema({
  customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  rootRuntimeInstanceId: id('RuntimeInstance'), runtimeInstanceKey: text(160), rootRuntimeInstanceKey: text(160),
  runId: { ...text(36), match: uuid }, requestKey: { ...text(36), match: uuid },
  executionAttemptId: { ...text(36), match: uuid },
  requestFingerprint: hash, plannerFingerprint: hash,
  contractVersion: { ...text(80), enum: [ACQUISITION_RUN_VERSION] },
  plannerVersion: { ...text(80), enum: [ACQUISITION_PLANNER_VERSION] },
  actorUserId: id('User'), authority: { ...text(80), enum: ['VMF_UPDATE'] },
  actionKey: { ...text(80), enum: ['SAVE_DISCOVERY_INPUTS', 'BUILD_EVIDENCE_PACK', 'REFRESH_EVIDENCE_PACK'] },
  acquisitionProfile: { ...text(40), enum: ['STANDARD', 'ENHANCED'] },
  basisStateVersion: text(100), basisUpdatedAt: { type: Date, required: true, immutable: true },
  predecessorRunId: { type: String, maxlength: 36, match: uuid, immutable: true },
  inputs: { type: [inputSchema], required: true, immutable: true },
  status: { type: String, required: true, enum: ['QUEUED', 'RUNNING', ...ACQUISITION_TERMINAL_STATES] },
  active: { type: Boolean, required: true },
  createdAt: { type: Date, required: true, immutable: true }, startedAt: Date, completedAt: Date,
  outcomes: { type: [outcomeSchema], default: undefined },
  canonicalSaved: Boolean, outputStateVersion: { type: String, maxlength: 100 },
  reason: { type: String, maxlength: 80 },
  admissionAuditId: id('AuditLog'), admissionAuditSignatureVersion: { type: Number, required: true, immutable: true },
  startAuditId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }, startAuditSignatureVersion: Number,
  terminalAuditId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }, terminalAuditSignatureVersion: Number,
  saveAuditId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }, saveAuditSignatureVersion: Number,
  saveAuditSignature: { type: String, maxlength: 128 },
}, { collection: 'runtime_acquisition_runs', strict: 'throw', versionKey: false, autoCreate: false, autoIndex: false })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 },
  { unique: true, name: 'unique_scoped_acquisition_request' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'unique_active_acquisition_run' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, createdAt: -1, _id: -1 },
  { name: 'scoped_acquisition_history' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, runId: 1 },
  { unique: true, name: 'unique_scoped_acquisition_run' })
schema.pre('validate', function () {
  const terminal = ACQUISITION_TERMINAL_STATES.includes(this.status)
  const counts = new Map()
  for (const item of this.inputs || []) {
    const index = counts.get(item.kind) || 0
    if (item.inputIndex !== index || !Number.isSafeInteger(item.inputIndex)) this.invalidate('inputs', 'Input identities are not complete.')
    counts.set(item.kind, index + 1)
  }
  if (counts.get('BRIEF') !== 1 || (counts.get('WEBSITE') || 0) > 10 || (counts.get('DOCUMENT') || 0) > 5)
    this.invalidate('inputs', 'Acquisition inputs exceed the existing contract.')
  if (this.active === terminal || terminal !== Boolean(this.completedAt)) this.invalidate('status', 'Terminal and active state disagree.')
  if (this.status !== 'QUEUED' && (!this.startedAt || !this.startAuditId || !this.startAuditSignatureVersion))
    this.invalidate('startedAt', 'Started execution audit is required.')
  if (terminal) {
    if (!this.terminalAuditId || !this.terminalAuditSignatureVersion || typeof this.canonicalSaved !== 'boolean')
      this.invalidate('terminalAuditId', 'A recorded terminal outcome is required.')
    if (this.canonicalSaved && (!this.outputStateVersion || !this.saveAuditId || !this.saveAuditSignatureVersion || !this.saveAuditSignature))
      this.invalidate('saveAuditId', 'Saved outcome proof is required.')
    if (!this.canonicalSaved && (this.status !== 'FAILED' || this.outputStateVersion || this.saveAuditId))
      this.invalidate('canonicalSaved', 'An unsaved operation cannot claim success.')
    if (this.outcomes?.length !== this.inputs.length || this.outcomes?.some((item, index) => {
      const input = this.inputs[index]
      return input?.kind !== item.kind || input.inputIndex !== item.inputIndex
        || !Number.isSafeInteger(item.evidenceObjectCount)
        || item.status !== 'SUCCEEDED' && item.evidenceObjectCount !== 0
        || item.status === 'SUCCEEDED' && item.kind !== 'BRIEF' && (!item.sourceId || this.canonicalSaved && !item.contentHash)
    })) this.invalidate('outcomes', 'Actual input outcomes do not reconcile.')
    const allSucceeded = this.outcomes?.every(item => item.status === 'SUCCEEDED')
    const someSucceeded = this.outcomes?.some(item => item.status === 'SUCCEEDED')
    if (this.canonicalSaved && this.status !== (allSucceeded ? 'SUCCEEDED' : someSucceeded ? 'PARTIALLY_SUCCEEDED' : 'FAILED'))
      this.invalidate('status', 'Saved Run status does not match actual outcomes.')
  } else if (this.outcomes || this.canonicalSaved !== undefined || this.outputStateVersion || this.terminalAuditId) {
    this.invalidate('outcomes', 'An active Run has no terminal outcome.')
  }
  if (Buffer.byteLength(JSON.stringify(this.toObject())) > 512 * 1024) this.invalidate('inputs', 'Run receipt exceeds its bound.')
})
schema.pre('save', function () { if (!this.isNew) throw new Error('Acquisition Runs use guarded service transitions.') })
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Acquisition Runs use guarded service transitions.') })
}
export default mongoose.model('RuntimeAcquisitionRun', schema)
