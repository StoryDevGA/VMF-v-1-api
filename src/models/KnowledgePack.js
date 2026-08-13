import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_AUTHORING_MODES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
} from '../constants/knowledgeRuntime.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { containsForbiddenProviderContextKey } from '../utils/knowledgePackSafety.js'
import {
  knowledgePackCapabilityKeyField,
  knowledgePackBoundaryField,
  knowledgePackKnowledgeAssetIdField,
  knowledgePackLayerField,
  knowledgePackWorkspaceCompatibilityField,
  normalizeKnowledgePackGovernanceFields,
} from './knowledgePackGovernanceSchemas.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKeySegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

export const buildKnowledgePackId = ({ packType, packKey } = {}) =>
  `kp-${normalizeKeySegment(packType)}-${normalizeKeySegment(packKey)}`

const knowledgePackSchema = new mongoose.Schema(
  {
    packId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
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
      index: true,
    },
    knowledgeLayer: knowledgePackLayerField,
    capabilityKey: knowledgePackCapabilityKeyField,
    knowledgeAssetId: knowledgePackKnowledgeAssetIdField,
    workspaceCompatibility: knowledgePackWorkspaceCompatibilityField,
    packType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES),
      index: true,
    },
    packKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_STATUSES),
      default: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
      index: true,
    },
    latestVersionId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },
    latestSemanticVersion: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sourceAuthority: {
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
    visibility: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_VISIBILITY_SCOPES),
      default: KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    authoringMode: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_AUTHORING_MODES),
      default: KNOWLEDGE_PACK_AUTHORING_MODES.CREATE_BLANK,
    },
    reviewStatus: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_REVIEW_STATUSES),
      default: KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
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
    collection: 'knowledge_packs',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.packId
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

knowledgePackSchema.index({ packType: 1, packKey: 1 }, { unique: true })
knowledgePackSchema.index({ status: 1, packType: 1, packKey: 1 })
knowledgePackSchema.index({ updatedAt: -1, packType: 1 })
knowledgePackSchema.index({ purposeCategory: 1, status: 1, updatedAt: -1 })
knowledgePackSchema.index({ visibility: 1, customerId: 1, tenantId: 1, status: 1 })
knowledgePackSchema.index(
  { knowledgeAssetId: 1 },
  {
    unique: true,
    partialFilterExpression: { knowledgeAssetId: { $type: 'string' } },
    name: 'uniq_governed_knowledge_asset_id',
  },
)

knowledgePackSchema.pre('validate', function normalizeKnowledgePack(next) {
  this.packType = normalizeToken(this.packType)
  this.packCategory = resolveKnowledgePackCategory({
    packCategory: this.packCategory,
    packType: this.packType,
  })
  this.purposeCategory = normalizeToken(this.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM)
  normalizeKnowledgePackGovernanceFields(this)
  this.packKey = normalizeText(this.packKey).toLowerCase()
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  this.label = normalizeText(this.label)
  this.description = normalizeText(this.description)
  this.latestVersionId = normalizeText(this.latestVersionId)
  this.latestSemanticVersion = normalizeText(this.latestSemanticVersion)
  this.sourceAuthority = normalizeText(this.sourceAuthority)
  this.executionMode = normalizeToken(this.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT)
  this.visibility = normalizeToken(this.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM)
  this.authoringMode = normalizeToken(this.authoringMode || KNOWLEDGE_PACK_AUTHORING_MODES.CREATE_BLANK)
  this.reviewStatus = normalizeToken(this.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT)
  this.tags = Array.isArray(this.tags)
    ? [...new Set(this.tags.map(normalizeText).filter(Boolean))]
    : []
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER && !this.customerId) {
    this.invalidate('customerId', 'Customer-scoped Knowledge Packs require customerId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT && !this.tenantId) {
    this.invalidate('tenantId', 'Tenant-scoped Knowledge Packs require tenantId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM) {
    this.customerId = null
    this.tenantId = null
  }
  if (
    [KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER, KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT]
      .includes(this.visibility)
    && containsForbiddenProviderContextKey(this.sourceMetadata)
  ) {
    this.invalidate(
      'sourceMetadata',
      'Customer or tenant provider-context Knowledge Packs must not store runtime truth or raw evidence metadata.',
    )
  }
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  next()
})

const KnowledgePack = mongoose.model('KnowledgePack', knowledgePackSchema)

export default KnowledgePack
