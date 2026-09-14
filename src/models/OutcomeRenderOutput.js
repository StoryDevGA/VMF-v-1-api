import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_RENDER_FORMATS,
  OUTCOME_STUDIO_RENDER_OUTPUT_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'

const outcomeRenderOutputSchema = new mongoose.Schema(
  {
    renderOutputId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    outcomeAssetId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      maxlength: 180,
    },
    outcomeAssetVersionId: {
      type: String,
      required: true,
      trim: true,
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
    runtimeRevisionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    format: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_RENDER_FORMATS),
      index: true,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_RENDER_OUTPUT_STATUSES),
      index: true,
    },
    sourceContentChecksum: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    outputContract: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    renderer: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    stylePackReceipt: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    visualSystemPackReceipt: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    visualResolution: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    artifact: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    renderReceipt: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    collection: 'outcome_render_outputs',
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

// These are the two real read paths: group outputs under a version and scope that
// grouping to the owning customer/runtime. No content or receipt field is indexed.
outcomeRenderOutputSchema.index({ outcomeAssetVersionId: 1, status: 1, createdAt: -1 })
outcomeRenderOutputSchema.index({
  tenantId: 1,
  customerId: 1,
  runtimeInstanceId: 1,
  outcomeAssetId: 1,
  outcomeAssetVersionId: 1,
  createdAt: -1,
})

outcomeRenderOutputSchema.pre('validate', function normalizeOutcomeRenderOutput(next) {
  this.renderOutputId = String(this.renderOutputId || '').trim()
  this.outcomeAssetId = String(this.outcomeAssetId || '').trim()
  this.outcomeAssetVersionId = String(this.outcomeAssetVersionId || '').trim()
  this.runtimeRevisionId = String(this.runtimeRevisionId || '').trim()
  this.versionNumber = Number.isFinite(Number(this.versionNumber)) ? Number(this.versionNumber) : 0
  this.format = String(this.format || '').trim().toUpperCase()
  this.status = String(this.status || '').trim().toUpperCase()
  this.sourceContentChecksum = String(this.sourceContentChecksum || '').trim()
  next()
})

const OutcomeRenderOutput = mongoose.model('OutcomeRenderOutput', outcomeRenderOutputSchema)

export default OutcomeRenderOutput
