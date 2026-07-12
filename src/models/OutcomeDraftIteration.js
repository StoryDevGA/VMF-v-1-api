import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES,
  OUTCOME_STUDIO_DRAFT_ITERATION_TYPES,
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

const outcomeDraftIterationSchema = new mongoose.Schema(
  {
    draftIterationId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    draftId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    previousIterationId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    iterationNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
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
    iterationType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_DRAFT_ITERATION_TYPES),
      default: OUTCOME_STUDIO_DRAFT_ITERATION_TYPES.INITIAL,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES),
      default: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
    },
    outputTypeKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 80,
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
    sourceMessageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    responseMessageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    truthSignatureId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    grrExecutionId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    grrRuntimeArtifactId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    customerContent: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validationSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
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
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    collection: 'outcome_draft_iterations',
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

outcomeDraftIterationSchema.index({ draftId: 1, iterationNumber: 1 }, { unique: true })
outcomeDraftIterationSchema.index({ runtimeInstanceId: 1, sessionId: 1, draftId: 1, iterationNumber: -1 })
outcomeDraftIterationSchema.index({ runtimeInstanceId: 1, draftId: 1, status: 1, createdAt: -1 })
outcomeDraftIterationSchema.index({
  tenantId: 1,
  customerId: 1,
  runtimeInstanceId: 1,
  draftId: 1,
  status: 1,
  createdAt: -1,
})

outcomeDraftIterationSchema.pre('validate', function normalizeOutcomeDraftIteration(next) {
  try {
    assertOutcomeDraftPayloadSafe(this.customerContent, { fieldName: 'customerContent' })
    assertOutcomeDraftPayloadSafe(this.validationSummary, { fieldName: 'validationSummary' })
    assertOutcomeDraftPayloadSafe(this.lineageSummary, { fieldName: 'lineageSummary' })
  } catch (err) {
    next(err)
    return
  }

  this.draftIterationId = String(this.draftIterationId || '').trim()
  this.draftId = String(this.draftId || '').trim()
  this.previousIterationId = String(this.previousIterationId || '').trim()
  this.iterationNumber = Number.isFinite(Number(this.iterationNumber)) ? Number(this.iterationNumber) : 1
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
  this.iterationType = String(this.iterationType || OUTCOME_STUDIO_DRAFT_ITERATION_TYPES.INITIAL).trim().toUpperCase()
  this.status = String(this.status || OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT).trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.outputTypeLabel = String(this.outputTypeLabel || '').trim()
  this.title = String(this.title || '').trim()
  this.sourceMessageId = String(this.sourceMessageId || '').trim()
  this.responseMessageId = String(this.responseMessageId || '').trim()
  this.truthSignatureId = String(this.truthSignatureId || '').trim()
  this.grrExecutionId = String(this.grrExecutionId || '').trim()
  this.grrRuntimeArtifactId = String(this.grrRuntimeArtifactId || '').trim()
  this.warnings = Array.isArray(this.warnings)
    ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.limitations = Array.isArray(this.limitations)
    ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  next()
})

const OutcomeDraftIteration = mongoose.model('OutcomeDraftIteration', outcomeDraftIterationSchema)

export default OutcomeDraftIteration
