import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_ASSET_VERSION_STATUSES,
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_PHASE,
} from '../constants/runtimeOutcomeStudio.js'
import {
  DEFAULT_OUTCOME_ASSET_TYPE,
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  WORKSPACE_ASSET_TYPES,
  WORKSPACE_TYPES,
} from '../constants/workspaceGovernance.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const normalizeNullableString = (value) => {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

const immutableVersionError = () => Object.assign(
  new Error('Persisted Outcome asset version content and lineage are immutable.'),
  { code: 'OUTCOME_ASSET_VERSION_IMMUTABLE', status: 409 },
)
const lifecyclePaths = new Set(['status', 'updatedAt', '__v'])
const assertDocumentVersionImmutable = (document) => {
  if (!document.isNew && document.modifiedPaths().some((path) => !lifecyclePaths.has(path))) {
    throw immutableVersionError()
  }
  if (!document.isNew && !Object.values(OUTCOME_STUDIO_ASSET_VERSION_STATUSES).includes(String(document.status || '').trim().toUpperCase())) {
    throw immutableVersionError()
  }
}
const plainObject = (value) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
const exactLegacyTruthFilter = (filter) => {
  const keys = ['runtimeInstanceId', 'sessionId', 'status', 'publishedAt', 'lineageSummary.draftApproval']
  return plainObject(filter) && Object.keys(filter).length === keys.length
    && keys.every((key) => Object.hasOwn(filter, key))
    && /^(?:[a-f0-9]{24})$/i.test(String(filter.runtimeInstanceId || ''))
    && typeof filter.sessionId === 'string' && Boolean(filter.sessionId.trim())
    && filter.status === OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT
    && filter.publishedAt === null
    && plainObject(filter['lineageSummary.draftApproval'])
    && Object.keys(filter['lineageSummary.draftApproval']).length === 1
    && filter['lineageSummary.draftApproval'].$exists === false
}
const legacyTruthPaths = new Set([
  'truthSignature', 'lineageSummary.truthSignatureStatus', 'lineageSummary.truthSignatureCurrentness', 'updatedAt',
])
const assertVersionUpdate = ({ operation, filter, update, options = {} }) => {
  if (options.upsert || !plainObject(update) || Object.keys(update).some((key) => !['$set', '$setOnInsert'].includes(key))
    || !plainObject(update.$set) || !Object.keys(update.$set).length
    || (update.$setOnInsert && (!plainObject(update.$setOnInsert)
      || Object.keys(update.$setOnInsert).some((path) => path !== 'createdAt')))) throw immutableVersionError()
  const paths = Object.keys(update.$set)
  if (Object.hasOwn(update.$set, 'status') && !Object.values(OUTCOME_STUDIO_ASSET_VERSION_STATUSES).includes(update.$set.status)) {
    throw immutableVersionError()
  }
  if (paths.every((path) => path === 'status' || path === 'updatedAt')) return
  if (operation === 'updateMany' && exactLegacyTruthFilter(filter)
    && paths.every((path) => legacyTruthPaths.has(path))) return
  throw immutableVersionError()
}

const outcomeAssetVersionSchema = new mongoose.Schema(
  {
    outcomeAssetVersionId: {
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
    parentVersionId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
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
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_ASSET_VERSION_STATUSES),
      default: OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT,
      index: true,
    },
    outputTypeKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 140,
      index: true,
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
      index: true,
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
    postValidation: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    contextBindings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    // Rendering profile is governed presentation intent only. It never stores
    // raw Knowledge Pack content or a second copy of customer content.
    renderingProfile: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    lineageSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    customerContent: {
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
      index: true,
    },
  },
  {
    collection: 'outcome_asset_versions',
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

outcomeAssetVersionSchema.index({ runtimeInstanceId: 1, outcomeAssetId: 1, versionNumber: -1 })
outcomeAssetVersionSchema.index({ runtimeInstanceId: 1, outcomeAssetId: 1, outcomeAssetVersionId: 1 })
outcomeAssetVersionSchema.index({
  tenantId: 1,
  customerId: 1,
  runtimeInstanceId: 1,
  outcomeAssetId: 1,
  status: 1,
  createdAt: -1,
})

outcomeAssetVersionSchema.pre('validate', function normalizeOutcomeAssetVersion(next) {
  try { assertDocumentVersionImmutable(this) } catch (error) { return next(error) }
  if (!this.isNew) {
    this.status = String(this.status || '').trim().toUpperCase()
    return next()
  }
  this.outcomeAssetVersionId = String(this.outcomeAssetVersionId || '').trim()
  this.outcomeAssetId = String(this.outcomeAssetId || '').trim()
  this.parentVersionId = String(this.parentVersionId || '').trim()
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
  this.versionNumber = Number.isFinite(Number(this.versionNumber)) ? Number(this.versionNumber) : 1
  this.status = String(this.status || OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT).trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.outputTypeCapabilityKey = String(this.outputTypeCapabilityKey || '').trim().toLowerCase()
  this.outputTypeLabel = String(this.outputTypeLabel || '').trim()
  this.title = String(this.title || '').trim()
  this.sourceOutputAssetId = String(this.sourceOutputAssetId || '').trim()
  this.warnings = Array.isArray(this.warnings)
    ? this.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  this.limitations = Array.isArray(this.limitations)
    ? this.limitations.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  next()
})

outcomeAssetVersionSchema.pre('save', function guardPersistedVersion(next) {
  try { assertDocumentVersionImmutable(this); next() } catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  outcomeAssetVersionSchema.pre(operation, function guardVersionUpdate(next) {
    try {
      assertVersionUpdate({ operation, filter: this.getFilter(), update: this.getUpdate(), options: this.getOptions() })
      next()
    } catch (error) { next(error) }
  })
}
for (const operation of ['replaceOne', 'findOneAndReplace']) {
  outcomeAssetVersionSchema.pre(operation, function rejectVersionReplacement(next) { next(immutableVersionError()) })
}
outcomeAssetVersionSchema.pre('bulkWrite', function guardVersionBulkWrite(next, operations) {
  try {
    for (const operation of operations) {
      const [type] = Object.keys(operation)
      if (['insertOne', 'deleteOne', 'deleteMany'].includes(type) && Object.keys(operation).length === 1) continue
      if (!['updateOne', 'updateMany'].includes(type) || Object.keys(operation).length !== 1) throw immutableVersionError()
      const { filter, update, ...options } = operation[type]
      assertVersionUpdate({ operation: type, filter, update, options })
    }
    next()
  } catch (error) { next(error) }
})

const OutcomeAssetVersion = mongoose.model('OutcomeAssetVersion', outcomeAssetVersionSchema)

export default OutcomeAssetVersion
