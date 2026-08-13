import mongoose from 'mongoose'
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
      enum: Object.values(GRR_EXECUTION_STATUSES),
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
  next()
})

const GovernedReasoningExecution = mongoose.model('GovernedReasoningExecution', governedReasoningExecutionSchema)

export default GovernedReasoningExecution
