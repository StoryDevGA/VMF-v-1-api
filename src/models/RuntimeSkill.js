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

const keyPattern = /^[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const enumTokenPattern = /^[A-Z][A-Z0-9_]*$/
const stableIdPattern = /^skill-[a-z][a-z0-9-]*$/
const outputBindingPattern = /^[a-zA-Z][a-zA-Z0-9_]*$/

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

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeOutputBindingList = (values) =>
  normalizeStringList(values)
    .filter((value) => outputBindingPattern.test(value))

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

const stringListField = {
  type: [String],
  default: [],
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
    primaryOutputKey: {
      type: String,
      trim: true,
      maxlength: 120,
      validate: {
        validator(value) {
          if (!value) return true
          return outputBindingPattern.test(String(value))
        },
        message: 'Primary output key must start with a letter and only use letters, numbers, or underscores.',
      },
      default: '',
    },
    outputBindings: {
      ...stringListField,
      validate: {
        validator(values) {
          if (!Array.isArray(values)) return false
          return values.every((value) => outputBindingPattern.test(String(value)))
        },
        message: 'Output bindings must start with a letter and only use letters, numbers, or underscores.',
      },
    },
    allowedReadPaths: {
      ...stringListField,
    },
    allowedWritePaths: {
      ...stringListField,
    },
    forbiddenWritePaths: {
      ...stringListField,
    },
    executionConfig: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Execution config must be an object.',
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

  if (this.isNew || this.isModified('primaryOutputKey')) {
    this.primaryOutputKey = String(this.primaryOutputKey || '').trim()
  }

  if (this.isNew || this.isModified('outputBindings')) {
    this.outputBindings = normalizeOutputBindingList(this.outputBindings)
  }

  if (this.isNew || this.isModified('allowedReadPaths')) {
    this.allowedReadPaths = normalizeStringList(this.allowedReadPaths)
  }

  if (this.isNew || this.isModified('allowedWritePaths')) {
    this.allowedWritePaths = normalizeStringList(this.allowedWritePaths)
  }

  if (this.isNew || this.isModified('forbiddenWritePaths')) {
    this.forbiddenWritePaths = normalizeStringList(this.forbiddenWritePaths)
  }

  const hasPrimaryOutputKey = Boolean(String(this.primaryOutputKey || '').trim())
  const hasOutputBindings = Array.isArray(this.outputBindings) && this.outputBindings.length > 0

  if (hasPrimaryOutputKey && hasOutputBindings) {
    this.invalidate('primaryOutputKey', 'Provide either a primary output key or output bindings, not both.')
    this.invalidate('outputBindings', 'Provide either a primary output key or output bindings, not both.')
  }

  const allowedWriteSet = new Set(this.allowedWritePaths || [])
  const forbiddenOverlap = (this.forbiddenWritePaths || []).find((value) => allowedWriteSet.has(value))
  if (forbiddenOverlap) {
    this.invalidate('forbiddenWritePaths', 'Forbidden write paths must not overlap with allowed write paths.')
  }

  const executionConfig = this.executionConfig && typeof this.executionConfig === 'object' && !Array.isArray(this.executionConfig)
    ? this.executionConfig
    : {}
  const executionConfigHasKeys = Object.keys(executionConfig).length > 0

  if (this.executionMode === RUNTIME_SKILL_EXECUTION_MODES.SYSTEM && executionConfigHasKeys) {
    this.invalidate('executionConfig', 'Execution config is only supported for rule engine or agent-assisted skills.')
  }

  if ((this.isNew || !this.stableId) && this.key) {
    this.stableId = buildRuntimeSkillStableId(this.key)
  }

  next()
})

const RuntimeSkill = mongoose.model('RuntimeSkill', runtimeSkillSchema)

export default RuntimeSkill
