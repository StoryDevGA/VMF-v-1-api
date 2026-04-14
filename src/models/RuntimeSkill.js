import mongoose from 'mongoose'

export const RUNTIME_SKILL_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DRAFT: 'DRAFT',
  DEPRECATED: 'DEPRECATED',
})

export const RUNTIME_SKILL_EXECUTION_MODES = Object.freeze({
  SYSTEM: 'SYSTEM',
  RULE_ENGINE: 'RULE_ENGINE',
  AGENT: 'AGENT',
})

export const SUPPORTED_RUNTIME_SKILL_FRAMEWORK_KEYS = Object.freeze([
  'VMF',
  'RLD',
])

const keyPattern = /^[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const enumTokenPattern = /^[A-Z][A-Z0-9_]*$/
const stableIdPattern = /^skill-[a-z][a-z0-9-]*$/

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeDescription = (value) =>
  String(value || '')
    .trim()

const normalizeFrameworkKeyList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeEnumToken = (value, fallback) => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()

  return normalized || fallback
}

export const buildRuntimeSkillStableId = (key) => `skill-${normalizeKey(key)}`

const objectField = {
  type: mongoose.Schema.Types.Mixed,
  default: {},
  validate: {
    validator(value) {
      return value && typeof value === 'object' && !Array.isArray(value)
    },
    message: 'Value must be an object.',
  },
}

const runtimeSkillSchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildRuntimeSkillStableId(this.key)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 140,
      match: [stableIdPattern, 'Runtime skill id must use the stable skill-<key> format'],
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      match: [keyPattern, 'Skill key must use lowercase letters, numbers, or hyphens'],
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_SKILL_STATUSES),
      default: RUNTIME_SKILL_STATUSES.ACTIVE,
    },
    supportedFrameworkKeys: [{
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    }],
    category: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [enumTokenPattern, 'Skill category must use uppercase letters, numbers, or underscores'],
      default: 'GENERAL',
    },
    type: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [enumTokenPattern, 'Skill type must use uppercase letters, numbers, or underscores'],
      default: 'DETERMINISTIC',
    },
    executionMode: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_SKILL_EXECUTION_MODES),
      default: RUNTIME_SKILL_EXECUTION_MODES.SYSTEM,
    },
    inputContract: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Input contract must be an object.',
      },
    },
    outputContract: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Output contract must be an object.',
      },
    },
    runtimeConfig: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Runtime config must be an object.',
      },
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

runtimeSkillSchema.index({ key: 1 }, { unique: true, name: 'unique_runtime_skill_key' })
runtimeSkillSchema.index({ stableId: 1 }, { unique: true, name: 'unique_runtime_skill_stable_id' })
runtimeSkillSchema.index({ status: 1, updatedAt: -1 })
runtimeSkillSchema.index({ supportedFrameworkKeys: 1, updatedAt: -1 })
runtimeSkillSchema.index({ category: 1, updatedAt: -1 })
runtimeSkillSchema.index({ executionMode: 1, updatedAt: -1 })

runtimeSkillSchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

runtimeSkillSchema.pre('validate', function normalizeRuntimeSkill(next) {
  if (this.isNew || this.isModified('key')) {
    this.key = normalizeKey(this.key)
  }

  if (this.isNew || this.isModified('name')) {
    this.name = normalizeName(this.name)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeDescription(this.description)
  }

  if (this.isNew || this.isModified('supportedFrameworkKeys')) {
    this.supportedFrameworkKeys = normalizeFrameworkKeyList(this.supportedFrameworkKeys)
  }

  if (this.isNew || this.isModified('category')) {
    this.category = normalizeEnumToken(this.category, 'GENERAL')
  }

  if (this.isNew || this.isModified('type')) {
    this.type = normalizeEnumToken(this.type, 'DETERMINISTIC')
  }

  if (this.isNew || this.isModified('executionMode')) {
    this.executionMode = normalizeEnumToken(
      this.executionMode,
      RUNTIME_SKILL_EXECUTION_MODES.SYSTEM,
    )
  }

  if ((this.isNew || !this.stableId) && this.key) {
    this.stableId = buildRuntimeSkillStableId(this.key)
  }

  next()
})

const RuntimeSkill = mongoose.model('RuntimeSkill', runtimeSkillSchema)

export default RuntimeSkill
