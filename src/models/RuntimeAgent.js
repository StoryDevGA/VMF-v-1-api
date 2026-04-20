import mongoose from 'mongoose'

export const RUNTIME_AGENT_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

const keyPattern = /^[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const enumTokenPattern = /^[A-Z][A-Z0-9_]*$/
const stableIdPattern = /^agent-[a-z][a-z0-9-]*$/

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

const normalizeTokenList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeEnumTokenList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizePathSelectionList = (values) => {
  const rawValues = Array.isArray(values)
    ? values
    : values === undefined || values === null || values === ''
      ? []
      : [values]

  const normalized = rawValues
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return [...new Set(normalized)]
}

export const buildRuntimeAgentStableId = (key) => `agent-${normalizeKey(key)}`

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

const tokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [keyPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const executionPlanStepSchema = new mongoose.Schema(
  {
    skillId: {
      ...tokenField,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    readsFrom: {
      type: [String],
      default: [],
    },
    writesTo: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
)

const normalizeExecutionPlan = (values) => {
  if (!Array.isArray(values)) return []

  return values.map((step) => ({
    skillId: normalizeKey(step?.skillId),
    description: normalizeDescription(step?.description),
    readsFrom: normalizePathSelectionList(step?.readsFrom),
    writesTo: normalizePathSelectionList(step?.writesTo),
  }))
}

const runtimeAgentSchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildRuntimeAgentStableId(this.key)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 140,
      match: [stableIdPattern, 'Runtime agent id must use the stable agent-<key> format'],
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      match: [keyPattern, 'Agent key must use lowercase letters, numbers, or hyphens'],
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
      enum: Object.values(RUNTIME_AGENT_STATUSES),
      default: RUNTIME_AGENT_STATUSES.DRAFT,
    },
    agentType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [enumTokenPattern, 'Agent type must use uppercase letters, numbers, or underscores'],
      default: 'EXECUTION',
    },
    supportedFrameworkKeys: [{
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    }],
    requiredSkillRoleKeys: [{
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      match: [enumTokenPattern, 'Required skill role key must use uppercase letters, numbers, or underscores'],
    }],
    defaultSkillIds: [tokenField],
    primarySkillIds: [tokenField],
    optionalSkillIds: [tokenField],
    executionPlan: {
      type: [executionPlanStepSchema],
      default: [],
    },
    promptConfig: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Prompt config must be an object.',
      },
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
    policies: {
      ...objectField,
      validate: {
        ...objectField.validate,
        message: 'Policies must be an object.',
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

runtimeAgentSchema.index({ key: 1 }, { unique: true, name: 'unique_runtime_agent_key' })
runtimeAgentSchema.index({ stableId: 1 }, { unique: true, name: 'unique_runtime_agent_stable_id' })
runtimeAgentSchema.index({ status: 1, updatedAt: -1 })
runtimeAgentSchema.index({ supportedFrameworkKeys: 1, updatedAt: -1 })
runtimeAgentSchema.index({ agentType: 1, updatedAt: -1 })

runtimeAgentSchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

runtimeAgentSchema.pre('validate', function normalizeRuntimeAgent(next) {
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

  if (this.isNew || this.isModified('requiredSkillRoleKeys')) {
    this.requiredSkillRoleKeys = normalizeEnumTokenList(this.requiredSkillRoleKeys)
  }

  if (this.isNew || this.isModified('defaultSkillIds')) {
    this.defaultSkillIds = normalizeTokenList(this.defaultSkillIds)
  }

  if (this.isNew || this.isModified('primarySkillIds')) {
    this.primarySkillIds = normalizeTokenList(this.primarySkillIds)
  }

  if (this.isNew || this.isModified('optionalSkillIds')) {
    this.optionalSkillIds = normalizeTokenList(this.optionalSkillIds)
  }

  if (this.isNew || this.isModified('executionPlan')) {
    this.executionPlan = normalizeExecutionPlan(this.executionPlan)
  }

  if ((this.isNew || !this.stableId) && this.key) {
    this.stableId = buildRuntimeAgentStableId(this.key)
  }

  next()
})

const RuntimeAgent = mongoose.model('RuntimeAgent', runtimeAgentSchema)

export default RuntimeAgent
