import mongoose from 'mongoose'

export const FRAMEWORK_REGISTRY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  DRAFT: 'DRAFT',
  DEPRECATED: 'DEPRECATED',
})

export const FRAMEWORK_REGISTRY_TYPES = Object.freeze({
  STRUCTURED: 'structured',
  HYBRID: 'hybrid',
  COMPOSABLE: 'composable',
})

export const FRAMEWORK_REGISTRY_STRUCTURE_TYPES = Object.freeze({
  SECTION_BASED: 'section_based',
  FLOW_BASED: 'flow_based',
  TEMPLATE_BASED: 'template_based',
  POLICY_BASED: 'policy_based',
})

const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const stableIdPattern = /^framework-[a-z0-9][a-z0-9-]*$/
const workflowKeyPattern = /^[a-z][a-z0-9-]*$/

const normalizeFrameworkKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeStableKeySegment = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeWorkflowKeyList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

export const buildFrameworkRegistryStableId = (frameworkKey) =>
  `framework-${normalizeStableKeySegment(frameworkKey)}`

const workflowKeyField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [workflowKeyPattern, 'Workflow key must use lowercase letters, numbers, or hyphens'],
}

const frameworkRegistrySchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildFrameworkRegistryStableId(this.frameworkKey)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 140,
      match: [stableIdPattern, 'Framework registry id must use the stable framework-<key> format'],
    },
    frameworkKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(FRAMEWORK_REGISTRY_TYPES),
      default: FRAMEWORK_REGISTRY_TYPES.STRUCTURED,
    },
    structureType: {
      type: String,
      required: true,
      enum: Object.values(FRAMEWORK_REGISTRY_STRUCTURE_TYPES),
      default: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.SECTION_BASED,
    },
    supportedWorkflowKeys: [workflowKeyField],
    defaultBehaviorProfile: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      validate: {
        validator(value) {
          return value && typeof value === 'object' && !Array.isArray(value)
        },
        message: 'Default behavior profile must be an object.',
      },
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(FRAMEWORK_REGISTRY_STATUSES),
      default: FRAMEWORK_REGISTRY_STATUSES.ACTIVE,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.stableId
        delete ret.stableId
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

frameworkRegistrySchema.index({ frameworkKey: 1 }, { unique: true, name: 'unique_framework_registry_key' })
frameworkRegistrySchema.index({ stableId: 1 }, { unique: true, name: 'unique_framework_registry_stable_id' })
frameworkRegistrySchema.index({ status: 1, updatedAt: -1 })
frameworkRegistrySchema.index({ type: 1, updatedAt: -1 })
frameworkRegistrySchema.index({ structureType: 1, updatedAt: -1 })

frameworkRegistrySchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

frameworkRegistrySchema.pre('validate', function normalizeFrameworkRegistry(next) {
  if (this.isNew || this.isModified('frameworkKey')) {
    this.frameworkKey = normalizeFrameworkKey(this.frameworkKey)
  }

  if (this.isNew || this.isModified('name')) {
    this.name = normalizeName(this.name)
  }

  if (this.isNew || this.isModified('supportedWorkflowKeys')) {
    this.supportedWorkflowKeys = normalizeWorkflowKeyList(this.supportedWorkflowKeys)
  }

  if (this.isNew || !this.stableId) {
    this.stableId = buildFrameworkRegistryStableId(this.frameworkKey)
  }

  next()
})

const FrameworkRegistry = mongoose.model('FrameworkRegistry', frameworkRegistrySchema)

export default FrameworkRegistry
