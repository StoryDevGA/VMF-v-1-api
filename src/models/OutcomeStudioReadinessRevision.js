import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_DEVELOPMENT_TEST_GATES,
  OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS,
  OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  OUTCOME_STUDIO_READINESS_ENVIRONMENT,
  OUTCOME_STUDIO_READINESS_POLICY_VERSIONS,
  OUTCOME_STUDIO_READINESS_REGISTER_ID,
  OUTCOME_STUDIO_READINESS_STATUSES,
  OUTCOME_STUDIO_READINESS_VERDICTS,
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
  OUTCOME_STUDIO_TESTING_PURPOSE,
} from '../constants/outcomeStudioReadiness.js'

const actorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true, maxlength: 160 },
  email: { type: String, maxlength: 254 },
}, { _id: false, strict: 'throw' })

const productDecisionSchema = new mongoose.Schema({
  status: { type: String, required: true, enum: Object.values(OUTCOME_STUDIO_READINESS_STATUSES) },
  productApproverName: { type: String, default: '', maxlength: 160 },
  productApproverRole: { type: String, default: '', maxlength: 160 },
  rationale: { type: String, default: '', maxlength: 1000 },
  recordedBy: { type: actorSchema, default: null },
  recordedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' })

const referenceSchema = new mongoose.Schema({
  family: { type: String, required: true, enum: OUTCOME_STUDIO_REFERENCE_FAMILIES },
  status: { type: String, required: true, enum: Object.values(OUTCOME_STUDIO_READINESS_STATUSES) },
  title: { type: String, default: '', maxlength: 500 },
  sha256: { type: String, default: '', match: /^(?:[a-f0-9]{64})?$/ },
  provenanceUri: { type: String, default: '', maxlength: 500 },
  approvedBy: { type: actorSchema, default: null },
  approvedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' })

const testReferenceSchema = new mongoose.Schema({
  family: { type: String, required: true, enum: OUTCOME_STUDIO_REFERENCE_FAMILIES },
  referenceKey: { type: String, required: true, maxlength: 64 },
  referenceRevision: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, maxlength: 200 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  byteLength: { type: Number, required: true, min: 1 },
  mimeType: { type: String, required: true, maxlength: 100 },
}, { _id: false, strict: 'throw' })

const authoritySchema = new mongoose.Schema({
  authority: { type: String, required: true, maxlength: 80 },
  status: { type: String, required: true, enum: Object.values(OUTCOME_STUDIO_READINESS_STATUSES) },
  provenanceUri: { type: String, default: '', maxlength: 500 },
  actor: { type: actorSchema, required: true },
  decidedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' })

const decisionSchema = new mongoose.Schema({
  decisionKey: { type: String, required: true, maxlength: 100 },
  authorities: { type: [authoritySchema], required: true },
  note: { type: String, maxlength: 1000 },
}, { _id: false, strict: 'throw' })

const providerPostureSchema = new mongoose.Schema({
  vendor: { type: String, default: '', maxlength: 500 },
  model: { type: String, default: '', maxlength: 500 },
  costBoundary: { type: String, default: '', maxlength: 500 },
  privacyPosture: { type: String, default: '', maxlength: 500 },
  dataRegion: { type: String, default: '', maxlength: 160 },
  failurePosture: { type: String, required: true, enum: ['FAIL_CLOSED'] },
  environment: { type: String, required: true, enum: [OUTCOME_STUDIO_READINESS_ENVIRONMENT] },
}, { _id: false, strict: 'throw' })

const providerPolicySchema = new mongoose.Schema({
  providerKey: { type: String, required: true, maxlength: 140 },
  model: { type: String, required: true, maxlength: 160 },
  environment: { type: String, required: true, enum: [OUTCOME_STUDIO_READINESS_ENVIRONMENT] },
  safeContextPolicyKey: { type: String, required: true, enum: [OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY] },
  failurePosture: { type: String, required: true, enum: ['FAIL_CLOSED'] },
  decision: { type: productDecisionSchema, required: true },
}, { _id: false, strict: 'throw' })

const testingApprovalSchema = new mongoose.Schema({
  purpose: { type: String, required: true, enum: [OUTCOME_STUDIO_TESTING_PURPOSE] },
  decision: { type: productDecisionSchema, required: true },
}, { _id: false, strict: 'throw' })

const gateResultSchema = new mongoose.Schema({
  gate: { type: String, required: true, enum: OUTCOME_STUDIO_DEVELOPMENT_TEST_GATES },
  status: { type: String, required: true, enum: ['PASSED', 'BLOCKED'] },
  blockerCode: { type: String, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false, strict: 'throw' })

const allVerdicts = [
  ...Object.values(OUTCOME_STUDIO_READINESS_VERDICTS),
  ...Object.values(OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS),
]

const schema = new mongoose.Schema({
  registerId: { type: String, required: true, immutable: true, default: OUTCOME_STUDIO_READINESS_REGISTER_ID },
  environment: { type: String, required: true, immutable: true, default: OUTCOME_STUDIO_READINESS_ENVIRONMENT },
  policyVersion: { type: String, immutable: true, enum: Object.values(OUTCOME_STUDIO_READINESS_POLICY_VERSIONS) },
  revision: { type: Number, required: true, immutable: true, min: 1 },
  verdict: { type: String, required: true, immutable: true, enum: allVerdicts },
  blockers: { type: [mongoose.Schema.Types.Mixed], required: true, immutable: true, default: [] },
  gateResults: { type: [gateResultSchema], immutable: true, default: undefined },
  references: { type: [referenceSchema], immutable: true, default: undefined },
  testReferences: { type: [testReferenceSchema], immutable: true, default: undefined },
  rubric: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  providerPosture: { type: providerPostureSchema, immutable: true, default: undefined },
  providerPolicy: { type: providerPolicySchema, immutable: true, default: undefined },
  decisions: { type: [decisionSchema], immutable: true, default: undefined },
  testingApproval: { type: testingApprovalSchema, immutable: true, default: undefined },
  contentHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: { transform(_doc, ret) { ret.id = ret._id; delete ret._id; delete ret.__v; return ret } },
})

schema.index({ registerId: 1, environment: 1, revision: 1 }, { unique: true, name: 'uniq_outcome_studio_readiness_revision' })
schema.index({ registerId: 1, environment: 1, createdAt: -1 }, { name: 'outcome_studio_readiness_history' })

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

schema.pre('validate', function validatePolicyShape(next) {
  const developmentTest = this.policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST
  const legacy = this.policyVersion === undefined
    || this.policyVersion === null
    || this.policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY
  const invalid = (message) => {
    const error = new Error(message)
    error.code = 'OUTCOME_STUDIO_READINESS_POLICY_SHAPE_INVALID'
    error.status = 422
    return next(error)
  }
  if (!legacy && !developmentTest) return invalid('Outcome Studio readiness policy is unsupported.')
  if (developmentTest) {
    if (!Object.values(OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS).includes(this.verdict)) return invalid('Development/Test readiness verdict is invalid.')
    if (!Array.isArray(this.gateResults) || this.gateResults.length !== OUTCOME_STUDIO_DEVELOPMENT_TEST_GATES.length) return invalid('Development/Test gate results are incomplete.')
    if (!Array.isArray(this.testReferences) || this.testReferences.length > OUTCOME_STUDIO_REFERENCE_FAMILIES.length || !this.providerPolicy || !this.testingApproval || !this.rubric?.decision) return invalid('Development/Test readiness evidence is incomplete.')
    if (own(this.toObject(), 'references') || own(this.toObject(), 'providerPosture') || own(this.toObject(), 'decisions')) return invalid('Legacy readiness evidence is not allowed on Development/Test revisions.')
  } else {
    if (!Object.values(OUTCOME_STUDIO_READINESS_VERDICTS).includes(this.verdict)) return invalid('Legacy readiness verdict is invalid.')
    if (!Array.isArray(this.references) || !this.providerPosture || !Array.isArray(this.decisions) || !this.rubric?.status) return invalid('Legacy readiness evidence is incomplete.')
    if (own(this.toObject(), 'gateResults') || own(this.toObject(), 'testReferences') || own(this.toObject(), 'providerPolicy') || own(this.toObject(), 'testingApproval')) return invalid('Development/Test evidence is not allowed on legacy revisions.')
  }
  next()
})

const rejectMutation = function rejectMutation(next) {
  const error = new Error('Outcome Studio readiness revisions are immutable.')
  error.code = 'OUTCOME_STUDIO_READINESS_REVISION_IMMUTABLE'
  error.status = 409
  next(error)
}
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, rejectMutation)
}

export default mongoose.model('OutcomeStudioReadinessRevision', schema)
