import mongoose from 'mongoose'

export const RUNTIME_PATH_REGISTRY_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
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
  SECTION: 'SECTION',
  METADATA: 'METADATA',
  VALIDATION: 'VALIDATION',
  LIFECYCLE: 'LIFECYCLE',
  OUTPUT: 'OUTPUT',
  ARTIFACT: 'ARTIFACT',
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

export const RUNTIME_PATH_REGISTRY_UI_CONTROLS = Object.freeze({
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  NUMBER: 'NUMBER',
  CHECKBOX: 'CHECKBOX',
  SELECT: 'SELECT',
  JSON: 'JSON',
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

const normalizeOptionalText = (value, { maxLength } = {}) => {
  if (value === undefined || value === null) return undefined

  const normalized = normalizeName(value)
  if (!normalized) return undefined
  if (maxLength && normalized.length > maxLength) {
    return normalized.slice(0, maxLength)
  }
  return normalized
}

const normalizeAllowedValueLabels = (input) => {
  if (!input) return undefined

  const entries = input instanceof Map
    ? [...input.entries()]
    : Object.entries(input)

  const normalized = new Map()
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey || '').trim()
    const value = String(rawValue || '').trim()
    if (!key || !value) continue
    normalized.set(key, value)
  }

  if (normalized.size === 0) return undefined
  return normalized
}

const validateRuntimePathValueMetadata = (doc) => {
  if (!doc) return

  const dataType = String(doc.dataType || '').trim().toUpperCase()
  const uiControl = doc.uiControl ? String(doc.uiControl || '').trim().toUpperCase() : ''
  const allowedValues = Array.isArray(doc.allowedValues) ? doc.allowedValues : []

  const hasAllowedValues = allowedValues.length > 0
  const hasAllowedLabels = doc.allowedValueLabels && (
    (doc.allowedValueLabels instanceof Map && doc.allowedValueLabels.size > 0)
    || (typeof doc.allowedValueLabels === 'object' && Object.keys(doc.allowedValueLabels).length > 0)
  )

  const hasNumericConstraints = Number.isFinite(doc.minValue) || Number.isFinite(doc.maxValue)
  const hasLengthConstraints = Number.isFinite(doc.minLength) || Number.isFinite(doc.maxLength)
  const hasRegex = Boolean(String(doc.regexPattern || '').trim())

  const stringLike = dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.MIXED

  const jsonLike = dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.OBJECT
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ARRAY
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.MIXED

  if (hasAllowedValues && !(dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING)) {
    doc.invalidate('allowedValues', 'allowedValues is only supported for ENUM or STRING runtime paths.')
  }

  if (hasAllowedLabels && !hasAllowedValues) {
    doc.invalidate('allowedValueLabels', 'allowedValueLabels requires allowedValues.')
  }

  if (uiControl) {
    if (!Object.values(RUNTIME_PATH_REGISTRY_UI_CONTROLS).includes(uiControl)) {
      doc.invalidate('uiControl', 'uiControl is not a supported runtime-path control type.')
    } else {
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.SELECT && !hasAllowedValues) {
        doc.invalidate('uiControl', 'uiControl=SELECT requires allowedValues.')
      }
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN) {
        doc.invalidate('uiControl', 'uiControl=CHECKBOX is only supported for BOOLEAN runtime paths.')
      }
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.NUMBER && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
        doc.invalidate('uiControl', 'uiControl=NUMBER is only supported for NUMBER runtime paths.')
      }
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.JSON && !jsonLike) {
        doc.invalidate('uiControl', 'uiControl=JSON is only supported for OBJECT, ARRAY, or MIXED runtime paths.')
      }
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXTAREA && !stringLike) {
        doc.invalidate('uiControl', 'uiControl=TEXTAREA is only supported for STRING, ENUM, or MIXED runtime paths.')
      }
      if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXT && !stringLike) {
        doc.invalidate('uiControl', 'uiControl=TEXT is only supported for STRING, ENUM, or MIXED runtime paths.')
      }
    }
  }

  if (hasNumericConstraints && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
    doc.invalidate('minValue', 'Numeric constraints are only supported for NUMBER runtime paths.')
  }

  if (hasLengthConstraints && !(dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM)) {
    doc.invalidate('minLength', 'Length constraints are only supported for STRING or ENUM runtime paths.')
  }

  if (hasRegex && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING) {
    doc.invalidate('regexPattern', 'regexPattern is only supported for STRING runtime paths.')
  }

  if (Number.isFinite(doc.minValue) && Number.isFinite(doc.maxValue) && doc.minValue > doc.maxValue) {
    doc.invalidate('minValue', 'minValue must be less than or equal to maxValue.')
  }

  if (Number.isFinite(doc.minLength) && Number.isFinite(doc.maxLength) && doc.minLength > doc.maxLength) {
    doc.invalidate('minLength', 'minLength must be less than or equal to maxLength.')
  }

  if (hasRegex) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(String(doc.regexPattern))
    } catch {
      doc.invalidate('regexPattern', 'regexPattern must be a valid regular expression.')
    }
  }

  if (hasAllowedValues) {
    const firstInvalidAllowedValue = allowedValues.find((allowedValue) => {
      if (Number.isFinite(doc.minLength) && allowedValue.length < doc.minLength) return true
      if (Number.isFinite(doc.maxLength) && allowedValue.length > doc.maxLength) return true

      if (hasRegex) {
        try {
          const regex = new RegExp(String(doc.regexPattern))
          return !regex.test(allowedValue)
        } catch {
          return false
        }
      }

      return false
    })

    if (firstInvalidAllowedValue) {
      doc.invalidate(
        'allowedValues',
        'allowedValues must satisfy any configured minLength, maxLength, and regexPattern constraints.',
      )
    }
  }

  const defaultValue = doc.defaultValue
  if (defaultValue !== undefined) {
    if (defaultValue === null && doc.isNullable === false) {
      doc.invalidate('defaultValue', 'defaultValue cannot be null when isNullable is false.')
    }

    if (defaultValue !== null) {
      if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN && typeof defaultValue !== 'boolean') {
        doc.invalidate('defaultValue', 'defaultValue must be a boolean for BOOLEAN runtime paths.')
      }

      if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
        if (typeof defaultValue !== 'number' || Number.isNaN(defaultValue)) {
          doc.invalidate('defaultValue', 'defaultValue must be a number for NUMBER runtime paths.')
        } else {
          if (Number.isFinite(doc.minValue) && defaultValue < doc.minValue) {
            doc.invalidate('defaultValue', 'defaultValue must be greater than or equal to minValue.')
          }
          if (Number.isFinite(doc.maxValue) && defaultValue > doc.maxValue) {
            doc.invalidate('defaultValue', 'defaultValue must be less than or equal to maxValue.')
          }
        }
      }

      if (stringLike) {
        const stringValue = typeof defaultValue === 'string' ? defaultValue : null
        if (stringValue === null) {
          doc.invalidate('defaultValue', 'defaultValue must be a string for string-like runtime paths.')
        } else {
          if (hasAllowedValues && !allowedValues.includes(stringValue)) {
            doc.invalidate('defaultValue', 'defaultValue must be one of allowedValues.')
          }
          if (Number.isFinite(doc.minLength) && stringValue.length < doc.minLength) {
            doc.invalidate('defaultValue', 'defaultValue must be at least minLength characters.')
          }
          if (Number.isFinite(doc.maxLength) && stringValue.length > doc.maxLength) {
            doc.invalidate('defaultValue', 'defaultValue must be at most maxLength characters.')
          }
          if (hasRegex) {
            try {
              const regex = new RegExp(String(doc.regexPattern))
              if (!regex.test(stringValue)) {
                doc.invalidate('defaultValue', 'defaultValue must match regexPattern.')
              }
            } catch {
              // ignore; regexPattern error already surfaced above
            }
          }
        }
      }
    }
  }

  if (hasAllowedLabels && hasAllowedValues) {
    const allowedSet = new Set(allowedValues)
    const labelKeys = doc.allowedValueLabels instanceof Map
      ? [...doc.allowedValueLabels.keys()]
      : Object.keys(doc.allowedValueLabels || {})

    const invalidKeys = labelKeys.filter((key) => !allowedSet.has(key))
    if (invalidKeys.length > 0) {
      doc.invalidate('allowedValueLabels', 'allowedValueLabels keys must be included in allowedValues.')
    }
  }
}

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
      immutable: true,
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
      default: RUNTIME_PATH_REGISTRY_STATUSES.DRAFT,
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
    allowedValues: {
      type: [String],
      default: undefined,
    },
    allowedValueLabels: {
      type: Map,
      of: String,
      default: undefined,
    },
    uiControl: {
      type: String,
      enum: Object.values(RUNTIME_PATH_REGISTRY_UI_CONTROLS),
    },
    placeholderText: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    helpText: {
      type: String,
      trim: true,
      maxlength: 600,
    },
    defaultValue: {
      type: mongoose.Schema.Types.Mixed,
    },
    minValue: {
      type: Number,
    },
    maxValue: {
      type: Number,
    },
    minLength: {
      type: Number,
      min: 0,
      max: 100000,
    },
    maxLength: {
      type: Number,
      min: 0,
      max: 100000,
    },
    regexPattern: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    isNullable: {
      type: Boolean,
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
runtimePathRegistrySchema.index(
  { pathKey: 'text', label: 'text', description: 'text' },
  {
    name: 'runtime_path_registry_text_search',
    weights: { pathKey: 10, label: 5, description: 1 },
  },
)

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

  if (this.isNew || this.isModified('allowedValues')) {
    this.allowedValues = Array.isArray(this.allowedValues)
      ? normalizeTokenList(this.allowedValues)
      : undefined
  }

  if (this.isNew || this.isModified('allowedValueLabels')) {
    this.allowedValueLabels = normalizeAllowedValueLabels(this.allowedValueLabels)
  }

  if (this.isNew || this.isModified('uiControl')) {
    this.uiControl = this.uiControl ? String(this.uiControl || '').trim().toUpperCase() : undefined
  }

  if (this.isNew || this.isModified('placeholderText')) {
    this.placeholderText = normalizeOptionalText(this.placeholderText, { maxLength: 200 })
  }

  if (this.isNew || this.isModified('helpText')) {
    this.helpText = normalizeOptionalText(this.helpText, { maxLength: 600 })
  }

  if (this.isNew || this.isModified('regexPattern')) {
    const normalizedRegex = normalizeOptionalText(this.regexPattern, { maxLength: 500 })
    this.regexPattern = normalizedRegex ? String(normalizedRegex).trim() : undefined
  }

  if (this.isNew || !this.stableId) {
    this.stableId = buildRuntimePathRegistryStableId(this.pathKey)
  }

  validateRuntimePathValueMetadata(this)

  next()
})

const RuntimePathRegistry = mongoose.model('RuntimePathRegistry', runtimePathRegistrySchema)

export default RuntimePathRegistry
