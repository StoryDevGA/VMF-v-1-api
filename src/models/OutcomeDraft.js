import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_DRAFT_STATUSES,
  OUTCOME_STUDIO_PHASE,
} from '../constants/runtimeOutcomeStudio.js'
import {
  DEFAULT_OUTCOME_ASSET_TYPE,
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  WORKSPACE_ASSET_TYPES,
  WORKSPACE_TYPES,
} from '../constants/workspaceGovernance.js'
import { assertOutcomeDraftPayloadSafe } from './outcomeDraftSafety.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const normalizeNullableString = (value) => {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

const outcomeDraftSchema = new mongoose.Schema(
  {
    draftId: {
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
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
    },
    runtimeInstanceKey: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
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
    assetType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(WORKSPACE_ASSET_TYPES),
      default: DEFAULT_OUTCOME_ASSET_TYPE,
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
      enum: Object.values(OUTCOME_STUDIO_DRAFT_STATUSES),
      default: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
    },
    outputTypeKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 140,
    },
    outputTypeCapabilityKey: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 140,
      default: '',
    },
    outputTypeLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 255,
      default: '',
    },
    sourceOutputAssetId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    truthSignatureId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    truthSignature: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    knowledgePackBinding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    currentIterationId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    currentIterationNumber: {
      type: Number,
      min: 0,
      default: 0,
    },
    approvedIterationId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    approvedAssetVersionId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    contextBindings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    lineageSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validationSummary: {
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    discardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    discardedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'outcome_drafts',
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

outcomeDraftSchema.index({ runtimeInstanceId: 1, sessionId: 1, status: 1, updatedAt: -1 })
outcomeDraftSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, updatedAt: -1 })
outcomeDraftSchema.index({ runtimeInstanceId: 1, draftId: 1 })
outcomeDraftSchema.index({ runtimeInstanceId: 1, currentIterationId: 1 })

outcomeDraftSchema.pre('validate', function normalizeOutcomeDraft(next) {
  try {
    assertOutcomeDraftPayloadSafe(this.truthSignature, { fieldName: 'truthSignature' })
    assertOutcomeDraftPayloadSafe(this.knowledgePackBinding, { fieldName: 'knowledgePackBinding' })
    assertOutcomeDraftPayloadSafe(this.contextBindings, { fieldName: 'contextBindings' })
    assertOutcomeDraftPayloadSafe(this.lineageSummary, { fieldName: 'lineageSummary' })
    assertOutcomeDraftPayloadSafe(this.validationSummary, { fieldName: 'validationSummary' })
  } catch (err) {
    next(err)
    return
  }

  this.draftId = String(this.draftId || '').trim()
  this.sessionId = String(this.sessionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.projectId = normalizeNullableString(this.projectId)
  this.outcomeId = normalizeNullableString(this.outcomeId)
  this.workspaceType = String(this.workspaceType || DEFAULT_OUTCOME_WORKSPACE_TYPE).trim().toUpperCase()
  this.assetType = String(this.assetType || DEFAULT_OUTCOME_ASSET_TYPE).trim().toUpperCase()
  this.contractVersion = String(this.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION).trim()
  this.phase = String(this.phase || OUTCOME_STUDIO_PHASE).trim()
  this.status = String(this.status || OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE).trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.outputTypeCapabilityKey = String(this.outputTypeCapabilityKey || '').trim().toLowerCase()
  this.outputTypeLabel = String(this.outputTypeLabel || '').trim()
  this.title = String(this.title || '').trim()
  this.sourceOutputAssetId = String(this.sourceOutputAssetId || '').trim()
  this.truthSignatureId = String(this.truthSignatureId || '').trim()
  this.currentIterationId = String(this.currentIterationId || '').trim()
  this.currentIterationNumber = Number.isFinite(Number(this.currentIterationNumber))
    ? Number(this.currentIterationNumber)
    : 0
  this.approvedIterationId = String(this.approvedIterationId || '').trim()
  this.approvedAssetVersionId = String(this.approvedAssetVersionId || '').trim()
  this.warnings = Array.isArray(this.warnings)
    ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.limitations = Array.isArray(this.limitations)
    ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  next()
})

const OutcomeDraft = mongoose.model('OutcomeDraft', outcomeDraftSchema)

export default OutcomeDraft
