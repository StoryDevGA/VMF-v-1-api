import mongoose from 'mongoose'

export const RUNTIME_PATH_REGISTRY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

export const RUNTIME_PATH_REGISTRY_OPERATIONS = Object.freeze({
  READ: 'READ',
  WRITE: 'WRITE',
  BIND: 'BIND',
})

export const RUNTIME_PATH_REGISTRY_SCOPES = Object.freeze({
  FRAMEWORK_STATE: 'FRAMEWORK_STATE',
  RUNTIME_INPUT: 'RUNTIME_INPUT',
  RUNTIME_OUTPUT: 'RUNTIME_OUTPUT',
  SNAPSHOT: 'SNAPSHOT',
  VALIDATION_RESULT: 'VALIDATION_RESULT',
  SYSTEM_CONTEXT: 'SYSTEM_CONTEXT',
})

export const RUNTIME_PATH_REGISTRY_DATA_TYPES = Object.freeze({
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
  ENUM: 'ENUM',
  MIXED: 'MIXED',
})

export const RUNTIME_PATH_REGISTRY_CATEGORIES = Object.freeze({
  STATE: 'STATE',
  METADATA: 'METADATA',
  VALIDATION: 'VALIDATION',
  LIFECYCLE: 'LIFECYCLE',
  OUTPUT: 'OUTPUT',
  INPUT: 'INPUT',
  REFERENCE: 'REFERENCE',
  SYSTEM: 'SYSTEM',
})

export const RUNTIME_PATH_REGISTRY_SOURCE_TYPES = Object.freeze({
  RUNTIME_STATE: 'RUNTIME_STATE',
  SNAPSHOT: 'SNAPSHOT',
  REQUEST_PAYLOAD: 'REQUEST_PAYLOAD',
  DERIVED: 'DERIVED',
  SYSTEM_GENERATED: 'SYSTEM_GENERATED',
})

const stableIdPattern = /^path-[a-z0-9][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/

const normalizeTokenList = (values, { upper = false } = {}) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .map((value) => (upper ? value.toUpperCase() : value))
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeStableKeySegment = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const buildStableKeyHash = (value) => {
  const input = String(value || '')
  let hash = 5381

  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash * 33) ^ input.charCodeAt(index)) >>> 0
  }

  return hash.toString(36)
}

export const buildRuntimePathRegistryStableId = (pathKey) =>
  `path-${normalizeStableKeySegment(pathKey).slice(0, 160)}-${buildStableKeyHash(pathKey)}`

const runtimePathRegistrySchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildRuntimePathRegistryStableId(this.pathKey)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 180,
      match: [stableIdPattern, 'Runtime path id must use the stable path-<token> format'],
    },
    pathKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      validate: {
        validator(value) {
          return Boolean(value) && !/\s/.test(String(value))
        },
        message: 'Path key must not contain whitespace.',
      },
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_PATH_REGISTRY_STATUSES),
      default: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    },
    frameworkKeys: {
      type: [String],
      required: true,
      validate: [
        {
          validator(values) {
            return Array.isArray(values) && values.length > 0
          },
          message: 'At least one framework key is required.',
        },
        {
          validator(values) {
            return Array.isArray(values) && values.every((value) => frameworkKeyPattern.test(String(value)))
          },
          message: 'Framework keys must use uppercase letters, numbers, or underscores.',
        },
      ],
    },
    scope: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_PATH_REGISTRY_SCOPES),
    },
    allowedOperations: {
      type: [String],
      required: true,
      validate: [
        {
          validator(values) {
            return Array.isArray(values) && values.length > 0
          },
          message: 'At least one allowed operation is required.',
        },
      ],
      enum: Object.values(RUNTIME_PATH_REGISTRY_OPERATIONS),
    },
    dataType: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_PATH_REGISTRY_DATA_TYPES),
    },
    category: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_PATH_REGISTRY_CATEGORIES),
    },
    sourceType: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_PATH_REGISTRY_SOURCE_TYPES),
    },
    isProtected: {
      type: Boolean,
      default: false,
    },
    isSystem: {
      type: Boolean,
      default: true,
    },
    introducedInVersion: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    deprecatedInVersion: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    replacementPathKey: {
      type: String,
      trim: true,
      maxlength: 200,
      validate: {
        validator(value) {
          return value === undefined || value === null || !/\s/.test(String(value))
        },
        message: 'Replacement path key must not contain whitespace.',
      },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    displayOrder: {
      type: Number,
      min: 0,
      max: 100000,
    },
    exampleValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    compatibilityTags: {
      type: [String],
      default: [],
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

runtimePathRegistrySchema.index({ pathKey: 1 }, { unique: true, name: 'unique_runtime_path_registry_path_key' })
runtimePathRegistrySchema.index({ stableId: 1 }, { unique: true, name: 'unique_runtime_path_registry_stable_id' })
runtimePathRegistrySchema.index({ status: 1, updatedAt: -1 })
runtimePathRegistrySchema.index({ frameworkKeys: 1, updatedAt: -1 })
runtimePathRegistrySchema.index({ allowedOperations: 1, updatedAt: -1 })

runtimePathRegistrySchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

runtimePathRegistrySchema.pre('validate', function normalizeRuntimePathRegistry(next) {
  if (this.isNew || this.isModified('pathKey')) {
    this.pathKey = String(this.pathKey || '').trim()
  }

  if (this.isNew || this.isModified('label')) {
    this.label = normalizeName(this.label)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeName(this.description)
  }

  if (this.isNew || this.isModified('frameworkKeys')) {
    this.frameworkKeys = normalizeTokenList(this.frameworkKeys, { upper: true })
  }

  if (this.isNew || this.isModified('allowedOperations')) {
    this.allowedOperations = normalizeTokenList(this.allowedOperations, { upper: true })
  }

  if (this.isNew || this.isModified('compatibilityTags')) {
    this.compatibilityTags = normalizeTokenList(this.compatibilityTags)
  }

  if (this.isNew || !this.stableId) {
    this.stableId = buildRuntimePathRegistryStableId(this.pathKey)
  }

  next()
})

const RuntimePathRegistry = mongoose.model('RuntimePathRegistry', runtimePathRegistrySchema)

export default RuntimePathRegistry
