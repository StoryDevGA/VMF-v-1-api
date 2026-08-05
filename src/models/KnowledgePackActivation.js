import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
} from '../constants/knowledgeRuntime.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { buildKnowledgePackId } from './KnowledgePack.js'
import {
  knowledgePackCapabilityKeyField,
  knowledgePackDependencyReferenceSchema,
  knowledgePackKnowledgeAssetIdField,
  knowledgePackLayerField,
  knowledgePackWorkspaceCompatibilityField,
  normalizeKnowledgePackGovernanceFields,
} from './knowledgePackGovernanceSchemas.js'

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
    dependencyReferences: {
      type: [knowledgePackDependencyReferenceSchema],
      default: [],
    },
    relationshipContractVersion: {
      type: String,
      required: true,
      uppercase: true,
      enum: [KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION],
      default: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    },
    relationshipChecksum: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      default: '',
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
    executionMode: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_EXECUTION_MODES),
      default: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    },
    visibility: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_VISIBILITY_SCOPES),
      default: KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM,
      index: true,
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
knowledgePackActivationSchema.index(
  { status: 1, scopeKey: 1, knowledgeLayer: 1, capabilityKey: 1 },
  {
    name: 'uniq_active_knowledge_capability_scope',
    unique: true,
    partialFilterExpression: {
      status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
      knowledgeLayer: { $type: 'string' },
      capabilityKey: { $type: 'string' },
    },
  },
)
knowledgePackActivationSchema.index({ status: 1, scopeKey: 1, packType: 1, packKey: 1 })
knowledgePackActivationSchema.index({ packId: 1, status: 1, activatedAt: -1 })
knowledgePackActivationSchema.index({ purposeCategory: 1, status: 1, activatedAt: -1 })
knowledgePackActivationSchema.index({ visibility: 1, customerId: 1, tenantId: 1, status: 1 })
knowledgePackActivationSchema.index({ status: 1, scopeKey: 1, packType: 1, knowledgeAssetId: 1 })

knowledgePackActivationSchema.pre('validate', function normalizeKnowledgePackActivation(next) {
  this.packType = normalizeToken(this.packType)
  this.packCategory = resolveKnowledgePackCategory({
    packCategory: this.packCategory,
    packType: this.packType,
  })
  this.purposeCategory = normalizeToken(this.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM)
  normalizeKnowledgePackGovernanceFields(this, { includeDependencies: true })
  this.packKey = normalizeLowerKey(this.packKey)
  this.label = normalizeText(this.label)
  this.semanticVersion = normalizeText(this.semanticVersion)
  this.schemaVersion = normalizeText(this.schemaVersion || '1.0.0')
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)
  if (this.status === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE) {
    if (!this.knowledgeLayer) {
      this.invalidate('knowledgeLayer', 'Active Knowledge Pack activations require knowledgeLayer.')
    }
    if (!this.capabilityKey) {
      this.invalidate('capabilityKey', 'Active Knowledge Pack activations require capabilityKey.')
    }
    if (!Array.isArray(this.workspaceCompatibility) || this.workspaceCompatibility.length === 0) {
      this.invalidate(
        'workspaceCompatibility',
        'Active Knowledge Pack activations require non-empty workspaceCompatibility.',
      )
    }
  }
  this.scopeType = normalizeToken(this.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.frameworkKey = normalizeToken(this.frameworkKey)
  this.runtimeType = normalizeToken(this.runtimeType)
  this.packageKey = normalizeLowerKey(this.packageKey)
  this.packageVersion = normalizeText(this.packageVersion)
  this.environmentKey = normalizeToken(this.environmentKey)
  this.executionMode = normalizeToken(this.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT)
  this.visibility = normalizeToken(this.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM)
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER && !this.customerId) {
    this.invalidate('customerId', 'Customer-scoped Knowledge Pack activations require customerId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT && !this.tenantId) {
    this.invalidate('tenantId', 'Tenant-scoped Knowledge Pack activations require tenantId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM) {
    this.customerId = null
    this.tenantId = null
  }
  this.contentHash = normalizeText(this.contentHash)
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  if (!this.scopeKey) this.scopeKey = buildKnowledgePackActivationScopeKey(this)
  this.scopeKey = normalizeScopeKey(this.scopeKey)
  if (!this.activationId) this.activationId = buildKnowledgePackActivationId(this)
  next()
})

const KnowledgePackActivation = mongoose.model('KnowledgePackActivation', knowledgePackActivationSchema)

export default KnowledgePackActivation
