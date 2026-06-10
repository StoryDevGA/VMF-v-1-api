import mongoose from 'mongoose'
import {
  OUTPUT_LAB_ASSET_STATUSES,
  OUTPUT_LAB_OUTPUT_TYPE_KEYS,
} from '../constants/runtimeOutputLab.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const runtimeOutputAssetSchema = new mongoose.Schema(
  {
    outputAssetId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    outputRequestId: {
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
    packageKey: {
      type: String,
      trim: true,
      maxlength: 120,
      required: true,
    },
    packageVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },
    projectId: nullableString,
    outcomeId: nullableString,
    outputTypeKey: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTPUT_LAB_OUTPUT_TYPE_KEYS),
      index: true,
    },
    outputTypeLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      required: true,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTPUT_LAB_ASSET_STATUSES),
      default: OUTPUT_LAB_ASSET_STATUSES.GENERATED,
      index: true,
    },
    governedOutput: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sourceTruthSummary: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    lineageSummary: {
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
    expansionGuardrails: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    markdown: {
      type: String,
      default: '',
      maxlength: 120000,
    },
    safeJson: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sourceSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
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
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'runtime_output_assets',
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

runtimeOutputAssetSchema.index({ runtimeInstanceId: 1, createdAt: -1 })
runtimeOutputAssetSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })
runtimeOutputAssetSchema.index({ runtimeInstanceId: 1, outputTypeKey: 1, status: 1, createdAt: -1 })

runtimeOutputAssetSchema.pre('validate', function normalizeRuntimeOutputAsset(next) {
  this.outputAssetId = String(this.outputAssetId || '').trim()
  this.outputRequestId = String(this.outputRequestId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.status = String(this.status || OUTPUT_LAB_ASSET_STATUSES.GENERATED).trim().toUpperCase()
  this.outputTypeLabel = String(this.outputTypeLabel || '').trim()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.markdown = String(this.markdown || '')
  this.warnings = Array.isArray(this.warnings) ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean) : []
  this.limitations = Array.isArray(this.limitations) ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean) : []
  next()
})

const RuntimeOutputAsset = mongoose.model('RuntimeOutputAsset', runtimeOutputAssetSchema)

export default RuntimeOutputAsset
