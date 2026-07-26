import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_PHASE,
  OUTCOME_STUDIO_SESSION_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'
import {
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  WORKSPACE_TYPES,
} from '../constants/workspaceGovernance.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const outcomeSessionSchema = new mongoose.Schema(
  {
    sessionId: {
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
    workspaceType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(WORKSPACE_TYPES),
      default: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    },
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
      enum: Object.values(OUTCOME_STUDIO_SESSION_STATUSES),
      default: OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE,
      index: true,
    },
    sourceOutputAssetId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
      index: true,
    },
    truthSignatureId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
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
    requestedOutputTypeKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: '',
    },
    requestedOutputTypeLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    sourceOutputSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    truthSignature: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    knowledgePackBinding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    contextBindings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    prompt: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    lastActivityAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    collection: 'outcome_sessions',
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

outcomeSessionSchema.index({ runtimeInstanceId: 1, createdAt: -1 })
outcomeSessionSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })
outcomeSessionSchema.index({ sourceOutputAssetId: 1, createdAt: -1 })
outcomeSessionSchema.index({ truthSignatureId: 1, createdAt: -1 })

outcomeSessionSchema.pre('validate', function normalizeOutcomeSession(next) {
  this.sessionId = String(this.sessionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.workspaceType = String(this.workspaceType || DEFAULT_OUTCOME_WORKSPACE_TYPE).trim().toUpperCase()
  this.contractVersion = String(this.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION).trim()
  this.phase = String(this.phase || OUTCOME_STUDIO_PHASE).trim()
  this.status = String(this.status || OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE).trim().toUpperCase()
  this.sourceOutputAssetId = String(this.sourceOutputAssetId || '').trim()
  this.truthSignatureId = String(this.truthSignatureId || '').trim()
  this.sourceOutputTypeKey = String(this.sourceOutputTypeKey || '').trim().toUpperCase()
  this.sourceOutputTypeLabel = String(this.sourceOutputTypeLabel || '').trim()
  this.requestedOutputTypeKey = String(this.requestedOutputTypeKey || '').trim().toLowerCase()
  this.requestedOutputTypeLabel = String(this.requestedOutputTypeLabel || '').trim()
  this.prompt = String(this.prompt || '').trim()
  next()
})

const OutcomeSession = mongoose.model('OutcomeSession', outcomeSessionSchema)

export default OutcomeSession
