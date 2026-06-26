import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { buildKnowledgePackId } from './KnowledgePack.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeScopeKey = (value) => normalizeText(value).toUpperCase()
const normalizeKeySegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

export const buildKnowledgePackVersionId = ({
  packType,
  packKey,
  semanticVersion,
  scopeKey = 'GLOBAL',
} = {}) =>
  `kpv-${normalizeKeySegment(packType)}-${normalizeKeySegment(packKey)}-${normalizeKeySegment(semanticVersion)}-${normalizeKeySegment(scopeKey)}`

const knowledgePackVersionSchema = new mongoose.Schema(
  {
    versionId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 240,
    },
    packId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      index: true,
    },
    packCategory: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_CATEGORIES),
      default: () => resolveKnowledgePackCategory(),
    },
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
    semanticVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    schemaVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
      default: '1.0.0',
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_STATUSES),
      default: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
      index: true,
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
    contentHash: {
      type: String,
      trim: true,
      maxlength: 140,
      default: '',
      index: true,
    },
    contentFormat: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS),
      default: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
    },
    sourceFilename: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
      default: undefined,
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validationSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validatedAt: {
      type: Date,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    collection: 'knowledge_pack_versions',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.versionId
        delete ret._id
        delete ret.__v
        delete ret.content
        return ret
      },
    },
  },
)

knowledgePackVersionSchema.index(
  { packType: 1, packKey: 1, semanticVersion: 1, scopeKey: 1 },
  { unique: true },
)
knowledgePackVersionSchema.index({ packId: 1, status: 1, updatedAt: -1 })
knowledgePackVersionSchema.index({ scopeKey: 1, packType: 1, packKey: 1, status: 1 })

knowledgePackVersionSchema.pre('validate', function normalizeKnowledgePackVersion(next) {
  this.packType = normalizeToken(this.packType)
  this.packCategory = resolveKnowledgePackCategory({
    packCategory: this.packCategory,
    packType: this.packType,
  })
  this.packKey = normalizeText(this.packKey).toLowerCase()
  this.semanticVersion = normalizeText(this.semanticVersion)
  this.schemaVersion = normalizeText(this.schemaVersion || '1.0.0')
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  this.scopeType = normalizeToken(this.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.scopeKey = normalizeScopeKey(this.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.contentHash = normalizeText(this.contentHash)
  this.contentFormat = normalizeToken(this.contentFormat || OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML)
  this.sourceFilename = normalizeText(this.sourceFilename)
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  if (!this.versionId) this.versionId = buildKnowledgePackVersionId(this)
  next()
})

const KnowledgePackVersion = mongoose.model('KnowledgePackVersion', knowledgePackVersionSchema)

export default KnowledgePackVersion
