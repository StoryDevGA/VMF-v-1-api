import mongoose from 'mongoose'
import {
  GRR_ARTIFACT_STATUSES,
  GRR_CONTRACT_VERSION,
} from '../constants/governedReasoningRuntime.js'

const governedRuntimeArtifactSchema = new mongoose.Schema(
  {
    runtimeArtifactId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    executionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      index: true,
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
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
      index: true,
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
    artifactType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: 'GOVERNED_REASONING_OUTPUT',
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(GRR_ARTIFACT_STATUSES),
      default: GRR_ARTIFACT_STATUSES.GENERATED,
      index: true,
    },
    contractVersion: {
      type: String,
      trim: true,
      default: GRR_CONTRACT_VERSION,
    },
    generatedOutput: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    safeJson: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    markdown: {
      type: String,
      default: '',
      maxlength: 120000,
    },
    lineageSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    certification: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    warnings: {
      type: [String],
      default: [],
    },
    limitations: {
      type: [String],
      default: [],
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    collection: 'governed_runtime_artifacts',
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

governedRuntimeArtifactSchema.index({ runtimeInstanceId: 1, createdAt: -1 })
governedRuntimeArtifactSchema.index({ executionId: 1, runtimeArtifactId: 1 })
governedRuntimeArtifactSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })

governedRuntimeArtifactSchema.pre('validate', function normalizeGovernedRuntimeArtifact(next) {
  this.runtimeArtifactId = String(this.runtimeArtifactId || '').trim()
  this.executionId = String(this.executionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.requestedOutputTypeKey = String(this.requestedOutputTypeKey || '').trim().toLowerCase()
  this.artifactType = String(this.artifactType || 'GOVERNED_REASONING_OUTPUT').trim().toUpperCase()
  this.status = String(this.status || GRR_ARTIFACT_STATUSES.GENERATED).trim().toUpperCase()
  this.markdown = String(this.markdown || '')
  this.warnings = Array.isArray(this.warnings)
    ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.limitations = Array.isArray(this.limitations)
    ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  next()
})

const GovernedRuntimeArtifact = mongoose.model('GovernedRuntimeArtifact', governedRuntimeArtifactSchema)

export default GovernedRuntimeArtifact
