import mongoose from 'mongoose'
import {
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_AUTHORING_MODES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
} from '../constants/knowledgeRuntime.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { buildKnowledgePackId } from './KnowledgePack.js'
import { containsForbiddenProviderContextKey } from '../utils/knowledgePackSafety.js'
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
    sourceAuthority: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    sourceFilename: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    sourceDocuments: {
      type: [{
        sourceDocumentId: {
          type: String,
          trim: true,
          maxlength: 180,
          default: '',
        },
        filename: {
          type: String,
          trim: true,
          maxlength: 220,
          default: '',
        },
        contentType: {
          type: String,
          trim: true,
          maxlength: 120,
          default: '',
        },
        fileExtension: {
          type: String,
          trim: true,
          lowercase: true,
          maxlength: 24,
          default: '',
        },
        sourceHash: {
          type: String,
          trim: true,
          maxlength: 140,
          default: '',
        },
        sourceType: {
          type: String,
          trim: true,
          uppercase: true,
          maxlength: 80,
          default: 'SOURCE_DOCUMENT',
        },
      }],
      default: [],
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
      default: KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT,
    },
    reviewStatus: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_REVIEW_STATUSES),
      default: KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
      index: true,
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
knowledgePackVersionSchema.index({ 'sourceDocuments.sourceHash': 1, scopeKey: 1 })
knowledgePackVersionSchema.index({ purposeCategory: 1, status: 1, updatedAt: -1 })
knowledgePackVersionSchema.index({ visibility: 1, customerId: 1, tenantId: 1, status: 1 })
knowledgePackVersionSchema.index({ knowledgeAssetId: 1, semanticVersion: 1, scopeKey: 1 })

knowledgePackVersionSchema.pre('validate', function normalizeKnowledgePackVersion(next) {
  this.packType = normalizeToken(this.packType)
  this.packCategory = resolveKnowledgePackCategory({
    packCategory: this.packCategory,
    packType: this.packType,
  })
  this.purposeCategory = normalizeToken(this.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM)
  normalizeKnowledgePackGovernanceFields(this, { includeDependencies: true })
  this.packKey = normalizeText(this.packKey).toLowerCase()
  this.semanticVersion = normalizeText(this.semanticVersion)
  this.schemaVersion = normalizeText(this.schemaVersion || '1.0.0')
  this.status = normalizeToken(this.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  this.scopeType = normalizeToken(this.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.scopeKey = normalizeScopeKey(this.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  this.contentHash = normalizeText(this.contentHash)
  this.contentFormat = normalizeToken(this.contentFormat || OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML)
  this.sourceAuthority = normalizeText(this.sourceAuthority)
  this.sourceFilename = normalizeText(this.sourceFilename)
  this.sourceDocuments = Array.isArray(this.sourceDocuments)
    ? this.sourceDocuments.map((sourceDocument) => ({
      sourceDocumentId: normalizeText(sourceDocument.sourceDocumentId),
      filename: normalizeText(sourceDocument.filename),
      contentType: normalizeText(sourceDocument.contentType),
      fileExtension: normalizeText(sourceDocument.fileExtension).toLowerCase(),
      sourceHash: normalizeText(sourceDocument.sourceHash),
      sourceType: normalizeToken(sourceDocument.sourceType || 'SOURCE_DOCUMENT'),
    })).filter((sourceDocument) => sourceDocument.filename || sourceDocument.sourceDocumentId)
    : []
  this.executionMode = normalizeToken(this.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT)
  this.visibility = normalizeToken(this.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM)
  this.authoringMode = normalizeToken(this.authoringMode || KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT)
  this.reviewStatus = normalizeToken(this.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT)
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER && !this.customerId) {
    this.invalidate('customerId', 'Customer-scoped Knowledge Pack versions require customerId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT && !this.tenantId) {
    this.invalidate('tenantId', 'Tenant-scoped Knowledge Pack versions require tenantId.')
  }
  if (this.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM) {
    this.customerId = null
    this.tenantId = null
  }
  if (
    [KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER, KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT]
      .includes(this.visibility)
    && (
      containsForbiddenProviderContextKey(this.sourceMetadata)
      || containsForbiddenProviderContextKey(this.content)
    )
  ) {
    this.invalidate(
      'sourceMetadata',
      'Customer or tenant provider-context Knowledge Pack versions must not store runtime truth or raw evidence metadata.',
    )
  }
  if (!this.packId) this.packId = buildKnowledgePackId(this)
  if (!this.versionId) this.versionId = buildKnowledgePackVersionId(this)
  next()
})

const KnowledgePackVersion = mongoose.model('KnowledgePackVersion', knowledgePackVersionSchema)

export default KnowledgePackVersion
