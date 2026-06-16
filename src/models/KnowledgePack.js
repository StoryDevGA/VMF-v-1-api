import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'

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

knowledgePackSchema.pre('validate', function normalizeKnowledgePack(next) {
  this.packType = normalizeToken(this.packType)
  this.packKey = normalizeText(this.packKey).toLowerCase()
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  this.label = normalizeText(this.label)
  this.description = normalizeText(this.description)
  this.latestVersionId = normalizeText(this.latestVersionId)
  this.latestSemanticVersion = normalizeText(this.latestSemanticVersion)
  this.tags = Array.isArray(this.tags)
    ? [...new Set(this.tags.map(normalizeText).filter(Boolean))]
    : []
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  next()
})

const KnowledgePack = mongoose.model('KnowledgePack', knowledgePackSchema)

export default KnowledgePack
