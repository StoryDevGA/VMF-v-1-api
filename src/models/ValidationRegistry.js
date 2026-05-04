import mongoose from 'mongoose'
import { RUNTIME_PATH_REGISTRY_DATA_TYPES } from './RuntimePathRegistry.js'
import {
  applyRuntimeControlVersioning,
  RUNTIME_CONTROL_COMPATIBILITY_MODES,
  RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS,
} from '../utils/runtimeControlVersioning.js'

export const VALIDATION_REGISTRY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

export const VALIDATION_REGISTRY_CATEGORIES = Object.freeze({
  COMPLETENESS: 'COMPLETENESS',
  SCHEMA: 'SCHEMA',
  CONSISTENCY: 'CONSISTENCY',
  GOVERNANCE: 'GOVERNANCE',
  QUALITY: 'QUALITY',
  DUPLICATION: 'DUPLICATION',
  LIFECYCLE: 'LIFECYCLE',
  CUSTOM: 'CUSTOM',
})

export const VALIDATION_REGISTRY_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  BLOCKING: 'BLOCKING',
})

export const VALIDATION_REGISTRY_RESULT_TYPES = Object.freeze({
  ...RUNTIME_PATH_REGISTRY_DATA_TYPES,
})

export const VALIDATION_REGISTRY_EXECUTION_MODES = Object.freeze({
  SYNC: 'SYNC',
  ASYNC: 'ASYNC',
  QUEUED: 'QUEUED',
})

const stableIdPattern = /^validation-[a-z][a-z0-9-]*$/
const keyPattern = /^[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const stableSkillIdPattern = /^skill-[a-z][a-z0-9-]*$/
const stableAgentIdPattern = /^agent-[a-z][a-z0-9-]*$/

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

export const buildValidationRegistryStableId = (key) => {
  const normalized = String(key || '').trim().toLowerCase()
  return `validation-${normalized}`
}

const normalizeTokenList = (values, { upper = false } = {}) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .map((value) => (upper ? value.toUpperCase() : value))
    .filter(Boolean)

  return [...new Set(normalized)]
}

const validationRegistrySchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildValidationRegistryStableId(this.key)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 180,
      match: [stableIdPattern, 'Validation id must use the stable validation-<key> format'],
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      immutable: true,
      validate: {
        validator(value) {
          return keyPattern.test(String(value || '').trim().toLowerCase())
        },
        message: 'Key must use lowercase letters, numbers, or hyphens.',
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
      enum: Object.values(VALIDATION_REGISTRY_STATUSES),
      default: VALIDATION_REGISTRY_STATUSES.ACTIVE,
    },
    supportedFrameworkKeys: {
      type: [String],
      required: true,
      validate: [
        {
          validator(values) {
            return Array.isArray(values) && values.length > 0
          },
          message: 'At least one supported framework key is required.',
        },
        {
          validator(values) {
            return Array.isArray(values) && values.every((value) => frameworkKeyPattern.test(String(value || '').trim().toUpperCase()))
          },
          message: 'Supported framework keys must use uppercase letters, numbers, or underscores.',
        },
      ],
    },
    category: {
      type: String,
      required: true,
      enum: Object.values(VALIDATION_REGISTRY_CATEGORIES),
    },
    severity: {
      type: String,
      required: true,
      enum: Object.values(VALIDATION_REGISTRY_SEVERITIES),
    },
    producerSkillId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
      validate: {
        validator(value) {
          return stableSkillIdPattern.test(String(value || '').trim().toLowerCase())
        },
        message: 'Producer skill id must use the stable skill-<key> format.',
      },
    },
    defaultAgentIds: {
      type: [String],
      default: [],
      validate: {
        validator(values) {
          return Array.isArray(values) && values.every((value) => stableAgentIdPattern.test(String(value || '').trim().toLowerCase()))
        },
        message: 'Default agent ids must use the stable agent-<key> format.',
      },
    },
    outputPath: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      validate: {
        validator(value) {
          return Boolean(value) && !/\s/.test(String(value))
        },
        message: 'Output path must not contain whitespace.',
      },
    },
    resultType: {
      type: String,
      enum: Object.values(VALIDATION_REGISTRY_RESULT_TYPES),
      default: undefined,
    },
    passFieldPath: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
      validate: {
        validator(value) {
          return value === undefined || value === null || !/\s/.test(String(value))
        },
        message: 'Pass field path must not contain whitespace.',
      },
    },
    detailsFieldPath: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
      validate: {
        validator(value) {
          return value === undefined || value === null || !/\s/.test(String(value))
        },
        message: 'Details field path must not contain whitespace.',
      },
    },
    policyUsable: {
      type: Boolean,
      default: true,
    },
    packageUsable: {
      type: Boolean,
      default: true,
    },
    requiresLatestRun: {
      type: Boolean,
      default: false,
    },
    freshnessDefaultMinutes: {
      type: Number,
      min: 0,
      max: 10080,
      default: 30,
    },
    blockingDefault: {
      type: Boolean,
      default: true,
    },
    warningOnlyDefault: {
      type: Boolean,
      default: false,
    },
    allowManualRun: {
      type: Boolean,
      default: true,
    },
    executionMode: {
      type: String,
      enum: Object.values(VALIDATION_REGISTRY_EXECUTION_MODES),
      default: VALIDATION_REGISTRY_EXECUTION_MODES.SYNC,
    },
    version: {
      type: Number,
      min: 1,
      max: 100000,
      default: 1,
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
    collection: 'validationregistries',
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

validationRegistrySchema.index({ stableId: 1 }, { unique: true, name: 'unique_validation_registry_stable_id' })
validationRegistrySchema.index({ key: 1 }, { unique: true, name: 'unique_validation_registry_key' })
validationRegistrySchema.index({ status: 1, updatedAt: -1 })
validationRegistrySchema.index({ supportedFrameworkKeys: 1, status: 1, updatedAt: -1 })

validationRegistrySchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

validationRegistrySchema.pre('validate', function normalizeValidationRegistry(next) {
  if (this.isNew || this.isModified('key')) {
    this.key = String(this.key || '').trim().toLowerCase()
  }

  if (this.isNew || this.isModified('label')) {
    this.label = normalizeText(this.label)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeText(this.description)
  }

  if (this.isNew || this.isModified('producerSkillId')) {
    this.producerSkillId = String(this.producerSkillId || '').trim().toLowerCase()
  }

  if (this.isNew || this.isModified('defaultAgentIds')) {
    this.defaultAgentIds = normalizeTokenList(this.defaultAgentIds).map((value) => value.toLowerCase())
  }

  if (this.isNew || this.isModified('supportedFrameworkKeys')) {
    this.supportedFrameworkKeys = normalizeTokenList(this.supportedFrameworkKeys, { upper: true })
  }

  if (this.isNew || this.isModified('outputPath')) {
    this.outputPath = String(this.outputPath || '').trim()
  }

  if (this.isNew || this.isModified('resultType')) {
    const normalizedResultType = String(this.resultType || '').trim().toUpperCase()
    this.resultType = normalizedResultType || undefined
  }

  if (this.isNew || this.isModified('passFieldPath')) {
    this.passFieldPath = String(this.passFieldPath || '').trim()
  }

  if (this.isNew || this.isModified('detailsFieldPath')) {
    this.detailsFieldPath = String(this.detailsFieldPath || '').trim()
  }

  if (this.isNew || this.isModified('executionMode')) {
    const normalizedExecutionMode = String(this.executionMode || '').trim().toUpperCase()
    this.executionMode = normalizedExecutionMode || VALIDATION_REGISTRY_EXECUTION_MODES.SYNC
  }

  if (this.isNew || !this.stableId) {
    this.stableId = buildValidationRegistryStableId(this.key)
  }

  next()
})

applyRuntimeControlVersioning(validationRegistrySchema, {
  lockImpactingFields: RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS.ValidationRegistry,
  compatibilityModeDefault: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
})

const ValidationRegistry = mongoose.model('ValidationRegistry', validationRegistrySchema)

export default ValidationRegistry
