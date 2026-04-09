import mongoose from 'mongoose'

export const WORKFLOW_POLICY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
})

export const SUPPORTED_WORKFLOW_POLICY_FRAMEWORK_KEYS = Object.freeze([
  'VMF',
  'RLD',
])

export const WORKFLOW_POLICY_ALLOWED_STEPS_BY_FRAMEWORK = Object.freeze({
  VMF: Object.freeze([
    'snapshot',
    'summarise',
    'validate',
    'review',
    'approve',
    'lock',
    'publish',
  ]),
  RLD: Object.freeze([
    'snapshot',
    'summarise',
    'validate',
    'map',
    'review',
    'approve',
    'synthesise',
    'publish',
  ]),
})

export const WORKFLOW_POLICY_STEP_ORDER_CONSTRAINTS_BY_FRAMEWORK = Object.freeze({
  VMF: Object.freeze([
    Object.freeze(['snapshot', 'summarise']),
    Object.freeze(['snapshot', 'validate']),
    Object.freeze(['snapshot', 'review']),
    Object.freeze(['review', 'approve']),
    Object.freeze(['validate', 'lock']),
    Object.freeze(['validate', 'publish']),
    Object.freeze(['approve', 'publish']),
    Object.freeze(['lock', 'publish']),
  ]),
  RLD: Object.freeze([
    Object.freeze(['snapshot', 'summarise']),
    Object.freeze(['snapshot', 'validate']),
    Object.freeze(['snapshot', 'map']),
    Object.freeze(['map', 'summarise']),
    Object.freeze(['map', 'review']),
    Object.freeze(['review', 'approve']),
    Object.freeze(['validate', 'synthesise']),
    Object.freeze(['validate', 'publish']),
    Object.freeze(['synthesise', 'publish']),
    Object.freeze(['approve', 'publish']),
  ]),
})

const keyPattern = /^[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const stableIdPattern = /^policy-[a-z][a-z0-9-]*$/

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

export const buildWorkflowPolicyStableId = (key) => `policy-${normalizeKey(key)}`

const tokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [keyPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const workflowPolicySchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildWorkflowPolicyStableId(this.key)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 140,
      match: [stableIdPattern, 'Workflow policy id must use the stable policy-<key> format'],
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      match: [keyPattern, 'Workflow policy key must use lowercase letters, numbers, or hyphens'],
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
      enum: Object.values(WORKFLOW_POLICY_STATUSES),
      default: WORKFLOW_POLICY_STATUSES.ACTIVE,
    },
    frameworkKeys: [{
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    }],
    orderedSteps: [tokenField],
    requiredAgentIds: [tokenField],
    requiredSkillIds: [tokenField],
    gatingRules: [tokenField],
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

workflowPolicySchema.index({ key: 1 }, { unique: true, name: 'unique_workflow_policy_key' })
workflowPolicySchema.index({ stableId: 1 }, { unique: true, name: 'unique_workflow_policy_stable_id' })
workflowPolicySchema.index({ status: 1, updatedAt: -1 })
workflowPolicySchema.index({ frameworkKeys: 1, updatedAt: -1 })

workflowPolicySchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

workflowPolicySchema.pre('validate', function normalizeWorkflowPolicy(next) {
  if (this.isNew || this.isModified('key')) {
    this.key = normalizeKey(this.key)
  }

  if (this.isNew || this.isModified('name')) {
    this.name = normalizeName(this.name)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeDescription(this.description)
  }

  if (this.isNew || this.isModified('frameworkKeys')) {
    this.frameworkKeys = normalizeFrameworkKeyList(this.frameworkKeys)
  }

  if (this.isNew || this.isModified('orderedSteps')) {
    this.orderedSteps = normalizeTokenList(this.orderedSteps)
  }

  if (this.isNew || this.isModified('requiredAgentIds')) {
    this.requiredAgentIds = normalizeTokenList(this.requiredAgentIds)
  }

  if (this.isNew || this.isModified('requiredSkillIds')) {
    this.requiredSkillIds = normalizeTokenList(this.requiredSkillIds)
  }

  if (this.isNew || this.isModified('gatingRules')) {
    this.gatingRules = normalizeTokenList(this.gatingRules)
  }

  if ((this.isNew || !this.stableId) && this.key) {
    this.stableId = buildWorkflowPolicyStableId(this.key)
  }

  next()
})

const WorkflowPolicy = mongoose.model('WorkflowPolicy', workflowPolicySchema)

export default WorkflowPolicy
