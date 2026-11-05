import mongoose from 'mongoose'
import { hasTestRenditionProbeIdentity, assertTestRenditionProbeArtifact, testRenditionProbeFilter, carriesTestRenditionProbeValue } from '../services/masterLinkedTestRenditionContract.js'
import { hasCompletedArtifactIdentity, assertCompletedReviewArtifact, completedArtifactFilter, carriesCompletedReviewValue } from '../services/masterLinkedCompletedReviewContract.js'
import { assertRenditionReviewArtifact, hasRenditionReviewArtifactIdentity, reservedRenditionArtifactFilter, renditionResultError } from '../services/outcomeRenditionReviewResultContract.js'
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
    testRenditionFileBytes: {
      type: Buffer,
      select: false,
      default: undefined,
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
        delete ret.testRenditionFileBytes
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
  try {
    if (hasTestRenditionProbeIdentity(this.toObject())) assertTestRenditionProbeArtifact(this.toObject())
    else if (hasCompletedArtifactIdentity(this.toObject())) assertCompletedReviewArtifact(this.toObject())
    else if (hasRenditionReviewArtifactIdentity(this.toObject())) assertRenditionReviewArtifact(this.toObject())
  }
  catch (error) { return next(error) }
  next()
})

const immutable = () => renditionResultError('REVIEW_ARTIFACT_IMMUTABLE')
const protectedReviewFilter = { $or: [reservedRenditionArtifactFilter, completedArtifactFilter, testRenditionProbeFilter] }
const withoutReview = filter => ({ $and: [filter, { $nor: [protectedReviewFilter] }] })
const reservedPath = value => typeof value === 'string' && ['contractVersion', 'artifactType', 'outputTypeKey', 'runtimeArtifactId', 'lineageSummary', 'testRenditionFileBytes']
  .some(field => value === field || value.startsWith(`${field}.`))
const reservedUpdate = value => carriesTestRenditionProbeValue(value) || carriesCompletedReviewValue(value) || (typeof value === 'string'
  ? value.trim() === 'outcome-rendition-review-artifact.v1' || ['DOCX_RENDITION_REVIEW', 'RENDITION_RENDERED_EXPRESSION_RL'].includes(value.trim().toUpperCase())
    || value.trim().startsWith('artifact_rendition_review_')
  : value && typeof value === 'object' && (hasRenditionReviewArtifactIdentity(value)
    || Object.entries(value).some(([field, child]) => field.startsWith('lineageSummary.renditionReview') || reservedUpdate(child))))
const unsafe = update => reservedUpdate(update) || (Array.isArray(update)
  ? update.some(stage => Object.entries(stage).some(([operator, fields]) => !['$set', '$addFields', '$unset', '$project'].includes(operator)
    || (operator !== '$unset' && Object.keys(fields || {}).some(reservedPath))))
  : Object.values(update?.$rename || {}).some(reservedPath))
governedRuntimeArtifactSchema.pre('save', async function protectReviewSave() {
  if (this.isNew && hasTestRenditionProbeIdentity(this.toObject())) assertTestRenditionProbeArtifact(this.toObject())
  if (this.isNew && hasCompletedArtifactIdentity(this.toObject())) assertCompletedReviewArtifact(this.toObject())
  if (this.isNew) return
  let query = this.constructor.exists({ $and: [{ _id: this._id }, protectedReviewFilter] })
  if (this.$session()) query = query.session(this.$session())
  if (hasTestRenditionProbeIdentity(this.toObject()) || hasCompletedArtifactIdentity(this.toObject()) || hasRenditionReviewArtifactIdentity(this.toObject()) || await query) throw immutable()
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  governedRuntimeArtifactSchema.pre(operation, async function protectReviewMutation() {
    if (unsafe(this.getUpdate?.())) throw immutable()
    const filter = this.getFilter()
    if (this.getOptions().upsert && reservedUpdate(filter)) throw immutable()
    let query = this.model.exists({ $and: [filter, protectedReviewFilter] })
    if (this.getOptions().session) query = query.session(this.getOptions().session)
    if (await query) throw immutable()
    this.setQuery(withoutReview(filter))
  })
}
governedRuntimeArtifactSchema.pre('deleteOne', { document: true, query: false }, async function protectReviewDelete() {
  let query = this.constructor.exists({ $and: [{ _id: this._id }, protectedReviewFilter] })
  if (this.$session()) query = query.session(this.$session())
  if (hasTestRenditionProbeIdentity(this.toObject()) || hasCompletedArtifactIdentity(this.toObject()) || hasRenditionReviewArtifactIdentity(this.toObject()) || await query) throw immutable()
})
governedRuntimeArtifactSchema.pre('insertMany', function protectReviewInsert(next, records) {
  next(records.some(reservedUpdate) ? immutable() : undefined)
})
governedRuntimeArtifactSchema.pre('bulkWrite', async function protectReviewBulk(next, operations, options) {
  try {
    for (const operation of operations) {
      const entry = Object.values(operation)[0]
      if (unsafe(entry?.document) || unsafe(entry?.update) || unsafe(entry?.replacement)) throw immutable()
      if (entry?.filter) {
        if (entry.upsert && reservedUpdate(entry.filter)) throw immutable()
        let query = this.exists({ $and: [entry.filter, protectedReviewFilter] })
        if (options?.session) query = query.session(options.session)
        if (await query) throw immutable()
        entry.filter = withoutReview(entry.filter)
      }
    }
    next()
  } catch (error) { next(error) }
})

const GovernedRuntimeArtifact = mongoose.model('GovernedRuntimeArtifact', governedRuntimeArtifactSchema)

export default GovernedRuntimeArtifact
