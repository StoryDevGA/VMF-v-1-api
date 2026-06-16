import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import { buildKnowledgePackId } from './KnowledgePack.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const normalizeScopeKey = (value) => normalizeText(value).toUpperCase()
const normalizeKeySegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

export const buildKnowledgePackActivationId = ({
  packType,
  packKey,
  versionId,
  scopeKey = 'GLOBAL',
} = {}) =>
  `kpa-${normalizeKeySegment(packType)}-${normalizeKeySegment(packKey)}-${normalizeKeySegment(versionId)}-${normalizeKeySegment(scopeKey)}`

export const buildKnowledgePackActivationScopeKey = ({
  scopeType,
  frameworkKey,
  runtimeType,
  packageKey,
  packageVersion,
  environmentKey,
  customerId,
  tenantId,
  runtimeInstanceId,
} = {}) => {
  const normalizedScopeType = normalizeToken(scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK) {
    return `FRAMEWORK:${normalizeToken(frameworkKey)}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE) {
    return `RUNTIME_TYPE:${normalizeToken(runtimeType)}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE) {
    return `PACKAGE:${normalizeToken(frameworkKey) || '*'}:${normalizeLowerKey(packageKey)}:${normalizeText(packageVersion) || '*'}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT) {
    return `ENVIRONMENT:${normalizeToken(environmentKey)}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.CUSTOMER) {
    return `CUSTOMER:${normalizeText(customerId)}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.TENANT) {
    return `TENANT:${normalizeText(tenantId)}`
  }
  if (normalizedScopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_INSTANCE) {
    return `RUNTIME_INSTANCE:${normalizeText(runtimeInstanceId)}`
  }
  return OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
}

const knowledgePackActivationSchema = new mongoose.Schema(
  {
    activationId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 260,
    },
    packId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      index: true,
    },
    versionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
      index: true,
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
      trim: true,
      maxlength: 160,
      default: '',
    },
    semanticVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    schemaVersion: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '1.0.0',
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES),
      default: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
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
      index: true,
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
    packageVersion: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    environmentKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    contentHash: {
      type: String,
      trim: true,
      maxlength: 140,
      default: '',
      index: true,
    },
    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    activatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    replacedActivationId: {
      type: String,
      trim: true,
      maxlength: 260,
      default: '',
    },
    rolledBackAt: {
      type: Date,
      default: null,
    },
    rollbackReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
  },
  {
    collection: 'knowledge_pack_activations',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.activationId
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

knowledgePackActivationSchema.index(
  { packType: 1, packKey: 1, scopeKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    },
  },
)
knowledgePackActivationSchema.index({ status: 1, scopeKey: 1, packType: 1, packKey: 1 })
knowledgePackActivationSchema.index({ packId: 1, status: 1, activatedAt: -1 })

knowledgePackActivationSchema.pre('validate', function normalizeKnowledgePackActivation(next) {
  this.packType = normalizeToken(this.packType)
  this.packKey = normalizeLowerKey(this.packKey)
  this.label = normalizeText(this.label)
  this.semanticVersion = normalizeText(this.semanticVersion)
  this.schemaVersion = normalizeText(this.schemaVersion || '1.0.0')
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)
  this.scopeType = normalizeToken(this.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.frameworkKey = normalizeToken(this.frameworkKey)
  this.runtimeType = normalizeToken(this.runtimeType)
  this.packageKey = normalizeLowerKey(this.packageKey)
  this.packageVersion = normalizeText(this.packageVersion)
  this.environmentKey = normalizeToken(this.environmentKey)
  this.contentHash = normalizeText(this.contentHash)
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  if (!this.scopeKey) this.scopeKey = buildKnowledgePackActivationScopeKey(this)
  this.scopeKey = normalizeScopeKey(this.scopeKey)
  if (!this.activationId) this.activationId = buildKnowledgePackActivationId(this)
  next()
})

const KnowledgePackActivation = mongoose.model('KnowledgePackActivation', knowledgePackActivationSchema)

export default KnowledgePackActivation
