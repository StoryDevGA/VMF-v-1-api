import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_BINDING_STATUSES,
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_PHASE,
} from '../constants/runtimeOutcomeStudio.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const truthSignatureSchema = new mongoose.Schema(
  {
    truthSignatureId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    sessionId: {
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
    runtimeInstanceKey: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
      index: true,
    },
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
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
    contractVersion: {
      type: String,
      trim: true,
      maxlength: 80,
      default: OUTCOME_STUDIO_CONTRACT_VERSION,
    },
    phase: {
      type: String,
      trim: true,
      maxlength: 80,
      default: OUTCOME_STUDIO_PHASE,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_BINDING_STATUSES),
      default: OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED,
      index: true,
    },
    mode: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    persistence: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'SESSION_BOUND',
      index: true,
    },
    currentness: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: 'CURRENT',
      index: true,
    },
    sourceOutputAssetId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      index: true,
    },
    sourceOutputTypeKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
    },
    sourceOutputTypeLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    sourceOutputSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    missingEvidence: {
      type: [
        {
          key: {
            type: String,
            trim: true,
            default: '',
          },
          label: {
            type: String,
            trim: true,
            default: '',
          },
        },
      ],
      default: [],
    },
    certification: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    graph: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    boundBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    boundAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'truth_signatures',
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

truthSignatureSchema.index({ runtimeInstanceId: 1, sessionId: 1, createdAt: -1 })
truthSignatureSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })
truthSignatureSchema.index({ sourceOutputAssetId: 1, boundAt: -1 })

truthSignatureSchema.pre('validate', function normalizeTruthSignature(next) {
  this.truthSignatureId = String(this.truthSignatureId || '').trim()
  this.sessionId = String(this.sessionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.contractVersion = String(this.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION).trim()
  this.phase = String(this.phase || OUTCOME_STUDIO_PHASE).trim()
  this.status = String(this.status || OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED).trim().toUpperCase()
  this.mode = String(this.mode || '').trim()
  this.persistence = String(this.persistence || 'SESSION_BOUND').trim()
  this.currentness = String(this.currentness || 'CURRENT').trim().toUpperCase()
  this.sourceOutputAssetId = String(this.sourceOutputAssetId || '').trim()
  this.sourceOutputTypeKey = String(this.sourceOutputTypeKey || '').trim().toUpperCase()
  this.sourceOutputTypeLabel = String(this.sourceOutputTypeLabel || '').trim()
  this.missingEvidence = Array.isArray(this.missingEvidence)
    ? this.missingEvidence
      .map((item) => ({
        key: String(item?.key || '').trim(),
        label: String(item?.label || '').trim(),
      }))
      .filter((item) => item.key || item.label)
    : []
  next()
})

const TruthSignature = mongoose.model('TruthSignature', truthSignatureSchema)

export default TruthSignature
