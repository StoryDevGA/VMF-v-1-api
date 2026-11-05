import mongoose from 'mongoose'
import { COMPLETED_REVIEW_STATUS, hasCompletedReviewIdentity, assertCompletedReviewResult, completedResultFilter, carriesCompletedReviewValue } from '../services/masterLinkedCompletedReviewContract.js'
import { G1_VERSION, G1_OUTPUT, G1_STATUSES, hasG1Identity, assertG1Record } from '../services/masterLinkedGenuineReviewContract.js'
import { MASTER_SIMULATION_VERSION, MASTER_SIMULATION_OUTPUT, MASTER_SIMULATION_STATUSES,
  hasMasterReviewSimulationIdentity, assertMasterReviewSimulationRecord } from '../services/masterLinkedReviewSimulationContract.js'
import { RENDITION_CLAIM_VERSION, RENDITION_CLAIM_STATUS, hasRenditionClaimIdentity,
  RENDITION_DISPATCH_VERSION, RENDITION_DISPATCH_STATUS, RENDITION_RESULT_VERSION, RENDITION_RESULT_STATUS, assertRenditionClaimRecord, renditionClaimError } from '../services/outcomeRenditionReviewClaimContract.js'
import { assertRenditionDispatchRecord } from '../services/outcomeRenditionReviewDispatchContract.js'
import { assertRenditionResultRecord } from '../services/outcomeRenditionReviewResultContract.js'
import {
  GRR_CONTRACT_VERSION,
  GRR_EXECUTION_STATUSES,
  GRR_PROVIDER_MODES,
} from '../constants/governedReasoningRuntime.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const governedReasoningExecutionSchema = new mongoose.Schema(
  {
    executionId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
      index: true,
    },
    runtimeInstanceKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
      default: '',
      index: true,
    },
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
      index: true,
    },
    workspaceType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: 'PLATFORM',
      index: true,
    },
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
      index: true,
    },
    packageKey: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    packageVersion: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    outputTypeKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 140,
      required: true,
      index: true,
    },
    requestedOutputTypeKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: '',
    },
    executionIntent: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
      index: true,
    },
    requestFingerprint: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: [...Object.values(GRR_EXECUTION_STATUSES), RENDITION_CLAIM_STATUS, RENDITION_DISPATCH_STATUS, RENDITION_RESULT_STATUS, ...Object.values(MASTER_SIMULATION_STATUSES), ...Object.values(G1_STATUSES), COMPLETED_REVIEW_STATUS],
      default: GRR_EXECUTION_STATUSES.COMPLETED,
      index: true,
    },
    contractVersion: {
      type: String,
      trim: true,
      default: GRR_CONTRACT_VERSION,
    },
    providerMode: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(GRR_PROVIDER_MODES),
      index: true,
    },
    provider: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    knowledgeManifest: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    knowledgeBinding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    reasoningContext: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    executionEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    certifiedTruth: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    runtimeStateWrites: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    artifactIds: {
      type: [String],
      default: [],
    },
    auditLogIds: {
      type: [String],
      default: [],
    },
    warnings: {
      type: [String],
      default: [],
    },
    limitations: {
      type: [String],
      default: [],
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failureReason: nullableString,
  },
  {
    collection: 'governed_reasoning_executions',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

governedReasoningExecutionSchema.index({ runtimeInstanceId: 1, createdAt: -1 })
governedReasoningExecutionSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })
governedReasoningExecutionSchema.index({ frameworkKey: 1, outputTypeKey: 1, createdAt: -1 })
governedReasoningExecutionSchema.index(
  { runtimeInstanceId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $gt: '' },
    },
  },
)

governedReasoningExecutionSchema.pre('validate', function normalizeGovernedReasoningExecution(next) {
  this.executionId = String(this.executionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.workspaceType = String(this.workspaceType || 'PLATFORM').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.requestedOutputTypeKey = String(this.requestedOutputTypeKey || '').trim().toLowerCase()
  this.executionIntent = String(this.executionIntent || '').trim()
  this.idempotencyKey = String(this.idempotencyKey || '').trim()
  this.requestFingerprint = String(this.requestFingerprint || '').trim() || null
  this.status = String(this.status || GRR_EXECUTION_STATUSES.COMPLETED).trim().toUpperCase()
  this.providerMode = String(this.providerMode || '').trim().toUpperCase()
  this.artifactIds = Array.isArray(this.artifactIds)
    ? this.artifactIds.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.auditLogIds = Array.isArray(this.auditLogIds)
    ? this.auditLogIds.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.warnings = Array.isArray(this.warnings)
    ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.limitations = Array.isArray(this.limitations)
    ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  try {
    if (hasCompletedReviewIdentity(this.toObject())) assertCompletedReviewResult(this.toObject())
    else if (hasG1Identity(this.toObject())) assertG1Record(this.toObject())
    else if (hasMasterReviewSimulationIdentity(this.toObject())) assertMasterReviewSimulationRecord(this.toObject())
    else if (hasRenditionClaimIdentity(this.toObject())) {
      if (this.contractVersion === RENDITION_RESULT_VERSION) assertRenditionResultRecord(this.toObject())
      else if (this.contractVersion === RENDITION_DISPATCH_VERSION) assertRenditionDispatchRecord(this.toObject())
      else assertRenditionClaimRecord(this.toObject())
    }
  }
  catch (error) { return next(error) }
  next()
})

governedReasoningExecutionSchema.pre('save', async function protectClaimSave() {
  // Creation through save({validateBeforeSave:false}) cannot bypass the new
  // simulation discriminator contract either.
  if (this.isNew && hasMasterReviewSimulationIdentity(this.toObject())) assertMasterReviewSimulationRecord(this.toObject())
  if (this.isNew && hasG1Identity(this.toObject())) assertG1Record(this.toObject())
  if (this.isNew && hasCompletedReviewIdentity(this.toObject())) assertCompletedReviewResult(this.toObject())
  if (!this.isNew) {
    let query = this.constructor.exists({ $and: [{ _id: this._id }, claimFilter] })
    if (this.$session()) query = query.session(this.$session())
    if (hasCompletedReviewIdentity(this.toObject()) || hasG1Identity(this.toObject()) || hasRenditionClaimIdentity(this.toObject()) || hasMasterReviewSimulationIdentity(this.toObject()) || await query) throw renditionClaimError('CLAIM_IMMUTABLE')
  }
})
// Test the stored discriminator as well as the proposed update. Removing it must
// never make an existing claim mutable through an ordinary GRR update path.
const reservedUpdate = value => carriesCompletedReviewValue(value) || value && typeof value === 'object' && (hasG1Identity(value) || hasRenditionClaimIdentity(value) || hasMasterReviewSimulationIdentity(value)
  || Object.entries(value).some(([key, entry]) => key.startsWith('executionEvidence.masterDocxDispatch') || key.startsWith('executionEvidence.renditionReview') || key.startsWith('executionEvidence.masterLinkedReview')
    || reservedUpdate(entry)))
const reservedPath = path => typeof path === 'string' && ['contractVersion', 'outputTypeKey', 'status', 'idempotencyKey', 'executionEvidence']
  .some(key => path === key || path.startsWith(`${key}.`))
const unsafeUpdate = update => reservedUpdate(update) || (Array.isArray(update)
  ? update.some(stage => Object.entries(stage).some(([operator, fields]) => !['$set', '$addFields', '$unset', '$project'].includes(operator)
    || (operator !== '$unset' && Object.keys(fields || {}).some(reservedPath))))
  : Object.values(update?.$rename || {}).some(reservedPath))
const claimFilter = { $or: [...completedResultFilter.$or, { contractVersion: { $in: [RENDITION_CLAIM_VERSION, RENDITION_DISPATCH_VERSION, RENDITION_RESULT_VERSION, MASTER_SIMULATION_VERSION, G1_VERSION] } },
  { status: { $in: [RENDITION_CLAIM_STATUS, RENDITION_DISPATCH_STATUS, RENDITION_RESULT_STATUS, ...Object.values(MASTER_SIMULATION_STATUSES), ...Object.values(G1_STATUSES)] } },
  { outputTypeKey: G1_OUTPUT }, { idempotencyKey: /^SS055_(NARROW_GENUINE|APPROVED_GENUINE|APPROVED_NETWORK_QA|CATEGORY_GENUINE|CATEGORY_NETWORK_QA|CORRECTED_GENUINE|CORRECTED_NETWORK_QA|NETWORK_QA|SINGLE_GENUINE)_DOCX:/ }, { 'executionEvidence.masterDocxDispatch': { $exists: true } },
  { outputTypeKey: MASTER_SIMULATION_OUTPUT }, { idempotencyKey: /^MASTER_REVIEW_SIMULATED:/ }, { 'executionEvidence.masterLinkedReview': { $exists: true } },
  { outputTypeKey: 'RENDITION_RENDERED_EXPRESSION_RL' }, { idempotencyKey: /^DOCX_RENDITION_REVIEW(?::|_DISPATCH:|_RESULT:)/ },
  { 'executionEvidence.renditionReview': { $exists: true } }] }
const withoutClaims = filter => ({ $and: [filter, { $nor: [claimFilter] }] })
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  governedReasoningExecutionSchema.pre(operation, async function protectClaimQuery() {
    if (unsafeUpdate(this.getUpdate?.())) throw renditionClaimError('CLAIM_IMMUTABLE')
    const filter = this.getFilter()
    if (this.getOptions().upsert && carriesCompletedReviewValue(filter)) throw renditionClaimError('CLAIM_IMMUTABLE')
    let query = this.model.exists({ $and: [filter, claimFilter] })
    if (this.getOptions().session) query = query.session(this.getOptions().session)
    if (await query) throw renditionClaimError('CLAIM_IMMUTABLE')
    // The read above provides an explicit error for existing claims. This
    // predicate is the atomic protection against a claim committed after it.
    this.setQuery(withoutClaims(filter))
  })
}
governedReasoningExecutionSchema.pre('deleteOne', { document: true, query: false }, async function protectClaimDelete() {
  let query = this.constructor.exists({ $and: [{ _id: this._id }, claimFilter] })
  if (this.$session()) query = query.session(this.$session())
  if (hasCompletedReviewIdentity(this.toObject()) || hasG1Identity(this.toObject()) || hasRenditionClaimIdentity(this.toObject()) || hasMasterReviewSimulationIdentity(this.toObject()) || await query) throw renditionClaimError('CLAIM_IMMUTABLE')
})
governedReasoningExecutionSchema.pre('insertMany', function protectClaimInsertMany(next, records) {
  next(records.some(row => hasCompletedReviewIdentity(row) || hasG1Identity(row) || hasRenditionClaimIdentity(row) || hasMasterReviewSimulationIdentity(row)) ? renditionClaimError('CLAIM_BULK_INSERT_UNSUPPORTED') : undefined)
})
governedReasoningExecutionSchema.pre('bulkWrite', async function protectClaimBulk(next, operations, options) {
  try {
    for (const operation of operations) {
      const action = Object.values(operation)[0]
      if (unsafeUpdate(action?.document) || unsafeUpdate(action?.update) || unsafeUpdate(action?.replacement)) throw renditionClaimError('CLAIM_IMMUTABLE')
      if (action?.filter) {
        if (action.upsert && carriesCompletedReviewValue(action.filter)) throw renditionClaimError('CLAIM_IMMUTABLE')
        let query = this.exists({ $and: [action.filter, claimFilter] })
        if (options?.session) query = query.session(options.session)
        if (await query) throw renditionClaimError('CLAIM_IMMUTABLE')
        action.filter = withoutClaims(action.filter)
      }
    }
    next()
  } catch (error) { next(error) }
})

const GovernedReasoningExecution = mongoose.model('GovernedReasoningExecution', governedReasoningExecutionSchema)

export default GovernedReasoningExecution
