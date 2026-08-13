import mongoose from 'mongoose'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  WORKSPACE_TYPES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_MANIFEST_STATUSES,
  KNOWLEDGE_PACK_MANIFEST_TYPES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import { knowledgePackBoundaryField } from './knowledgePackGovernanceSchemas.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const normalizeScopeKey = (value) => normalizeToken(value || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
const normalizeKeySegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

export const buildKnowledgePackManifestId = ({
  manifestKey,
  semanticVersion,
  scopeKey = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
} = {}) =>
  `kpm-${normalizeKeySegment(manifestKey)}-${normalizeKeySegment(semanticVersion)}-${normalizeKeySegment(scopeKey)}`

const knowledgePackManifestPackSchema = new mongoose.Schema(
  {
    packCategory: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_CATEGORIES),
      default: () => resolveKnowledgePackCategory(),
    },
    purposeCategory: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES),
      default: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM,
    },
    packType: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 80,
    },
    packKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    executionMode: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_EXECUTION_MODES),
      default: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    },
    boundary: knowledgePackBoundaryField,
    required: {
      type: Boolean,
      default: true,
    },
    dependencyKeys: {
      type: [String],
      default: [],
    },
    sourceAuthority: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { _id: false },
)

knowledgePackManifestPackSchema.pre('validate', function normalizeManifestPack(next) {
  this.packType = normalizeToken(this.packType)
  this.packCategory = resolveKnowledgePackCategory({
    packCategory: this.packCategory,
    packType: this.packType,
  })
  this.purposeCategory = normalizeToken(this.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM)
  this.packKey = normalizeLowerKey(this.packKey)
  this.label = normalizeText(this.label)
  this.executionMode = normalizeToken(this.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT)
  this.boundary = normalizeToken(this.boundary) || undefined
  this.dependencyKeys = Array.isArray(this.dependencyKeys)
    ? [...new Set(this.dependencyKeys.map(normalizeLowerKey).filter(Boolean))]
    : []
  this.sourceAuthority = normalizeText(this.sourceAuthority)
  next()
})

const knowledgePackManifestSchema = new mongoose.Schema(
  {
    manifestId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 220,
    },
    manifestKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      index: true,
    },
    manifestName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    manifestType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_MANIFEST_TYPES),
      default: KNOWLEDGE_PACK_MANIFEST_TYPES.FRAMEWORK_RUNTIME,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: '',
    },
    semanticVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_MANIFEST_STATUSES),
      default: KNOWLEDGE_PACK_MANIFEST_STATUSES.DRAFT,
      index: true,
    },
    workspaceType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(WORKSPACE_TYPES),
      default: WORKSPACE_TYPES.OUTCOME,
    },
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    packageKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: '',
    },
    outputKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: '',
    },
    scopeType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES),
      default: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
    },
    scopeKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 260,
      default: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
      index: true,
    },
    mandatoryPacks: {
      type: [knowledgePackManifestPackSchema],
      default: [],
    },
    optionalPacks: {
      type: [knowledgePackManifestPackSchema],
      default: [],
    },
    validationPacks: {
      type: [knowledgePackManifestPackSchema],
      default: [],
    },
    blockedPacks: {
      type: [knowledgePackManifestPackSchema],
      default: [],
    },
    resolutionPolicy: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validationPolicy: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    isSystem: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    collection: 'knowledge_pack_manifests',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.manifestId
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

knowledgePackManifestSchema.index(
  { manifestKey: 1, semanticVersion: 1, scopeKey: 1 },
  { unique: true },
)
knowledgePackManifestSchema.index({ status: 1, workspaceType: 1, manifestKey: 1 })
knowledgePackManifestSchema.index({ scopeType: 1, scopeKey: 1, status: 1 })
knowledgePackManifestSchema.index({
  frameworkKey: 1,
  runtimeType: 1,
  packageKey: 1,
  outputKey: 1,
  status: 1,
})

knowledgePackManifestSchema.pre('validate', function normalizeKnowledgePackManifest(next) {
  this.manifestKey = normalizeLowerKey(this.manifestKey)
  this.manifestName = normalizeText(this.manifestName)
  this.manifestType = normalizeToken(this.manifestType || KNOWLEDGE_PACK_MANIFEST_TYPES.FRAMEWORK_RUNTIME)
  this.description = normalizeText(this.description)
  this.semanticVersion = normalizeText(this.semanticVersion)
  this.status = normalizeToken(this.status || KNOWLEDGE_PACK_MANIFEST_STATUSES.DRAFT)
  this.workspaceType = normalizeToken(this.workspaceType || WORKSPACE_TYPES.OUTCOME)
  this.frameworkKey = normalizeToken(this.frameworkKey)
  this.runtimeType = normalizeToken(this.runtimeType)
  this.packageKey = normalizeLowerKey(this.packageKey)
  this.outputKey = normalizeLowerKey(this.outputKey)
  this.scopeType = normalizeToken(this.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.scopeKey = normalizeScopeKey(this.scopeKey)
  if (!this.manifestId) {
    this.manifestId = buildKnowledgePackManifestId(this)
  }
  next()
})

const KnowledgePackManifest = mongoose.model('KnowledgePackManifest', knowledgePackManifestSchema)

export default KnowledgePackManifest
