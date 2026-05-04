import mongoose from 'mongoose'
import {
  applyRuntimeControlVersioning,
  RUNTIME_CONTROL_COMPATIBILITY_MODES,
  RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS,
} from '../utils/runtimeControlVersioning.js'

export const WORKFLOW_POLICY_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

export const WORKFLOW_POLICY_TYPES = Object.freeze({
  VALIDATION: 'VALIDATION',
  LIFECYCLE_GATE: 'LIFECYCLE_GATE',
  ROUTING: 'ROUTING',
  AUTOMATION: 'AUTOMATION',
  APPROVAL: 'APPROVAL',
  ESCALATION: 'ESCALATION',
  NOTIFICATION: 'NOTIFICATION',
  COMPOSITE: 'COMPOSITE',
})

export const WORKFLOW_POLICY_APPLIES_TO = Object.freeze({
  FRAMEWORK_LIFECYCLE: 'FRAMEWORK_LIFECYCLE',
  WORKSPACE_ACTION: 'WORKSPACE_ACTION',
  SYSTEM_EVENT: 'SYSTEM_EVENT',
  AGENT_OUTCOME: 'AGENT_OUTCOME',
  SCHEDULED_CHECK: 'SCHEDULED_CHECK',
  MANUAL_INVOCATION: 'MANUAL_INVOCATION',
})

export const WORKFLOW_POLICY_TRIGGER_EVENTS = Object.freeze({
  ON_SAVE_DRAFT: 'ON_SAVE_DRAFT',
  ON_SUBMIT: 'ON_SUBMIT',
  ON_APPROVE: 'ON_APPROVE',
  ON_PUBLISH: 'ON_PUBLISH',
  ON_STAGE_CHANGE: 'ON_STAGE_CHANGE',
  ON_PACKAGE_BUILD: 'ON_PACKAGE_BUILD',
  ON_AGENT_COMPLETE: 'ON_AGENT_COMPLETE',
  ON_SCHEDULED_SCAN: 'ON_SCHEDULED_SCAN',
  MANUAL_RUN: 'MANUAL_RUN',
})

export const WORKFLOW_POLICY_TRIGGER_MODES = Object.freeze({
  PRE_ACTION: 'PRE_ACTION',
  POST_ACTION: 'POST_ACTION',
  CONTINUOUS: 'CONTINUOUS',
  SINGLE_FIRE: 'SINGLE_FIRE',
  RECURRING: 'RECURRING',
})

export const WORKFLOW_POLICY_ACTOR_SCOPES = Object.freeze({
  ANY: 'ANY',
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  AGENT: 'AGENT',
  ADMINISTRATOR: 'ADMINISTRATOR',
})

export const WORKFLOW_POLICY_GOVERNED_ACTIONS = Object.freeze({
  SAVE_DRAFT: 'SAVE_DRAFT',
  SUBMIT_FOR_REVIEW: 'SUBMIT_FOR_REVIEW',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  PUBLISH: 'PUBLISH',
  GENERATE_ARTEFACT: 'GENERATE_ARTEFACT',
  RUN_ANALYSIS: 'RUN_ANALYSIS',
  LOCK_RECORD: 'LOCK_RECORD',
  UNLOCK_RECORD: 'UNLOCK_RECORD',
  ARCHIVE: 'ARCHIVE',
})

export const WORKFLOW_POLICY_DECISION_MODES = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  WARN_ONLY: 'WARN_ONLY',
  REQUIRE_AGENT_EVALUATION: 'REQUIRE_AGENT_EVALUATION',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  CONDITIONAL: 'CONDITIONAL',
})

export const WORKFLOW_POLICY_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  BLOCKING: 'BLOCKING',
})

export const WORKFLOW_POLICY_CONDITION_OPERATORS = Object.freeze({
  EQUALS: '=',
  NOT_EQUALS: '!=',
  CONTAINS: 'contains',
  EXISTS: 'exists',
  NOT_EXISTS: 'not exists',
  GREATER_THAN: '>',
  LESS_THAN: '<',
  GREATER_THAN_OR_EQUAL: '>=',
  LESS_THAN_OR_EQUAL: '<=',
  IN: 'in',
  NOT_IN: 'not in',
})

export const WORKFLOW_POLICY_CONDITION_LOGIC = Object.freeze({
  AND: 'AND',
  OR: 'OR',
})

export const WORKFLOW_POLICY_ROUTING_MODES = Object.freeze({
  FIXED_AGENT: 'FIXED_AGENT',
  FIRST_COMPATIBLE_ACTIVE_AGENT: 'FIRST_COMPATIBLE_ACTIVE_AGENT',
  BY_FRAMEWORK: 'BY_FRAMEWORK',
  BY_PRIORITY: 'BY_PRIORITY',
  MANUAL_SELECTION: 'MANUAL_SELECTION',
})

export const WORKFLOW_POLICY_EFFECT_TYPES = Object.freeze({
  SET_VALUE: 'SET_VALUE',
  APPEND_AUDIT_ENTRY: 'APPEND_AUDIT_ENTRY',
  INCREMENT_COUNTER: 'INCREMENT_COUNTER',
  CLEAR_FIELD: 'CLEAR_FIELD',
  TRIGGER_POLICY_GROUP: 'TRIGGER_POLICY_GROUP',
  QUEUE_NOTIFICATION: 'QUEUE_NOTIFICATION',
  BLOCK_ACTION: 'BLOCK_ACTION',
})

export const WORKFLOW_POLICY_OVERRIDE_ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  FRAMEWORK_OWNER: 'FRAMEWORK_OWNER',
  GOVERNANCE_LEAD: 'GOVERNANCE_LEAD',
  OPERATIONS_ADMIN: 'OPERATIONS_ADMIN',
})

export const WORKFLOW_POLICY_ESCALATION_ROLE_KEYS = Object.freeze({
  CUSTOMER_ADMIN: 'CUSTOMER_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  FRAMEWORK_OWNER: 'FRAMEWORK_OWNER',
})

export const WORKFLOW_POLICY_DEFAULTS = Object.freeze({
  status: WORKFLOW_POLICY_STATUSES.DRAFT,
  policyType: WORKFLOW_POLICY_TYPES.VALIDATION,
  priority: 100,
  appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_LIFECYCLE,
  triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.PRE_ACTION,
  actorScope: WORKFLOW_POLICY_ACTOR_SCOPES.ANY,
  cooldownSeconds: 0,
  reevaluateOnRetry: false,
  decisionMode: WORKFLOW_POLICY_DECISION_MODES.ALLOW,
  severity: WORKFLOW_POLICY_SEVERITIES.INFO,
  conditions: [],
  routingMode: '',
  primaryAgentId: '',
  fallbackAgentId: '',
  timeoutMs: 0,
  retryOverride: '',
  requireSuccess: false,
  requiredValidationKeys: [],
  validationBlockingOnFail: true,
  validationWarningOnly: false,
  validationFreshnessMinutes: 30,
  validationRequireLatestRun: true,
  onPassEffects: [],
  onFailEffects: [],
  overrideAllowed: false,
  overrideRoles: [],
  approvalRequired: false,
  escalationRoleKey: '',
  escalateTo: '',
  escalationMessage: '',
  slaMinutes: 0,
  triggerEvent: '',
  governedAction: '',
  passMessage: '',
  failMessage: '',
  version: 1,
  lastActivatedAt: null,
})

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

const normalizeEnumValue = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeTextValue = (value) =>
  String(value || '')
    .trim()

const normalizeEnumValueList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const conditionOperatorValues = Object.values(WORKFLOW_POLICY_CONDITION_OPERATORS)
const conditionLogicValues = Object.values(WORKFLOW_POLICY_CONDITION_LOGIC)

const normalizeConditionValue = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }

  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value

  const normalized = String(value ?? '').trim()
  return normalized
}

const normalizeConditions = (values) => {
  if (!Array.isArray(values)) return []

  return values
    .map((condition) => ({
      path: String(condition?.path || '').trim(),
      operator: String(condition?.operator || '').trim(),
      value: normalizeConditionValue(condition?.value),
      logic: String(condition?.logic || WORKFLOW_POLICY_CONDITION_LOGIC.AND).trim().toUpperCase(),
    }))
    .filter((condition) => condition.path || condition.operator || condition.value)
    .map((condition, index, rows) => {
      if (index < rows.length - 1) return condition
      const terminalCondition = { ...condition }
      delete terminalCondition.logic
      return terminalCondition
    })
}

const effectTypeValues = Object.values(WORKFLOW_POLICY_EFFECT_TYPES)
const overrideRoleValues = Object.values(WORKFLOW_POLICY_OVERRIDE_ROLES)
const escalationRoleKeyValues = Object.values(WORKFLOW_POLICY_ESCALATION_ROLE_KEYS)
const effectTypesRequiringTargetPath = new Set([
  WORKFLOW_POLICY_EFFECT_TYPES.SET_VALUE,
  WORKFLOW_POLICY_EFFECT_TYPES.INCREMENT_COUNTER,
  WORKFLOW_POLICY_EFFECT_TYPES.CLEAR_FIELD,
])
const effectTypesRequiringValue = new Set([
  WORKFLOW_POLICY_EFFECT_TYPES.SET_VALUE,
  WORKFLOW_POLICY_EFFECT_TYPES.APPEND_AUDIT_ENTRY,
  WORKFLOW_POLICY_EFFECT_TYPES.TRIGGER_POLICY_GROUP,
  WORKFLOW_POLICY_EFFECT_TYPES.QUEUE_NOTIFICATION,
])

const normalizeEffects = (values) => {
  if (!Array.isArray(values)) return []

  return values
    .map((effect) => {
      const type = String(effect?.type || '').trim().toUpperCase()
      return {
        type,
        targetPath: effectTypesRequiringTargetPath.has(type) ? String(effect?.targetPath || '').trim() : '',
        value: effectTypesRequiringValue.has(type) ? normalizeConditionValue(effect?.value) : '',
      }
    })
    .filter((effect) => effect.type || effect.targetPath || effect.value)
}

export const buildWorkflowPolicyStableId = (key) => `policy-${normalizeKey(key)}`

const tokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [keyPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const workflowPolicyConditionSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    operator: {
      type: String,
      required: true,
      trim: true,
      enum: conditionOperatorValues,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
    },
    logic: {
      type: String,
      enum: conditionLogicValues,
    },
  },
  { _id: false },
)

const workflowPolicyEffectSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: effectTypeValues,
    },
    targetPath: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
    },
  },
  { _id: false },
)

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
      default: WORKFLOW_POLICY_DEFAULTS.status,
    },
    policyType: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_TYPES),
      default: WORKFLOW_POLICY_DEFAULTS.policyType,
    },
    priority: {
      type: Number,
      required: true,
      min: 1,
      max: 9999,
      default: WORKFLOW_POLICY_DEFAULTS.priority,
    },
    frameworkKeys: [{
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    }],
    appliesTo: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_APPLIES_TO),
      default: WORKFLOW_POLICY_DEFAULTS.appliesTo,
    },
    triggerEvent: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      default: WORKFLOW_POLICY_DEFAULTS.triggerEvent,
    },
    triggerMode: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_TRIGGER_MODES),
      default: WORKFLOW_POLICY_DEFAULTS.triggerMode,
    },
    actorScope: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_ACTOR_SCOPES),
      default: WORKFLOW_POLICY_DEFAULTS.actorScope,
    },
    cooldownSeconds: {
      type: Number,
      min: 0,
      max: 86400,
      default: WORKFLOW_POLICY_DEFAULTS.cooldownSeconds,
    },
    reevaluateOnRetry: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.reevaluateOnRetry,
    },
    governedAction: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      default: WORKFLOW_POLICY_DEFAULTS.governedAction,
    },
    decisionMode: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_DECISION_MODES),
      default: WORKFLOW_POLICY_DEFAULTS.decisionMode,
    },
    passMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: WORKFLOW_POLICY_DEFAULTS.passMessage,
    },
    failMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: WORKFLOW_POLICY_DEFAULTS.failMessage,
    },
    severity: {
      type: String,
      required: true,
      enum: Object.values(WORKFLOW_POLICY_SEVERITIES),
      default: WORKFLOW_POLICY_DEFAULTS.severity,
    },
    conditions: {
      type: [workflowPolicyConditionSchema],
      default: WORKFLOW_POLICY_DEFAULTS.conditions,
    },
    routingMode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      enum: ['', ...Object.values(WORKFLOW_POLICY_ROUTING_MODES)],
      default: WORKFLOW_POLICY_DEFAULTS.routingMode,
    },
    primaryAgentId: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: WORKFLOW_POLICY_DEFAULTS.primaryAgentId,
    },
    fallbackAgentId: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: WORKFLOW_POLICY_DEFAULTS.fallbackAgentId,
    },
    timeoutMs: {
      type: Number,
      min: 0,
      max: 300000,
      default: WORKFLOW_POLICY_DEFAULTS.timeoutMs,
    },
    retryOverride: {
      type: String,
      trim: true,
      maxlength: 120,
      default: WORKFLOW_POLICY_DEFAULTS.retryOverride,
    },
    requireSuccess: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.requireSuccess,
    },
    requiredValidationKeys: [tokenField],
    validationBlockingOnFail: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.validationBlockingOnFail,
    },
    validationWarningOnly: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.validationWarningOnly,
    },
    validationFreshnessMinutes: {
      type: Number,
      min: 0,
      max: 10080,
      default: WORKFLOW_POLICY_DEFAULTS.validationFreshnessMinutes,
    },
    validationRequireLatestRun: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.validationRequireLatestRun,
    },
    onPassEffects: {
      type: [workflowPolicyEffectSchema],
      default: WORKFLOW_POLICY_DEFAULTS.onPassEffects,
    },
    onFailEffects: {
      type: [workflowPolicyEffectSchema],
      default: WORKFLOW_POLICY_DEFAULTS.onFailEffects,
    },
    overrideAllowed: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.overrideAllowed,
    },
    overrideRoles: [{
      type: String,
      trim: true,
      uppercase: true,
      enum: overrideRoleValues,
    }],
    approvalRequired: {
      type: Boolean,
      default: WORKFLOW_POLICY_DEFAULTS.approvalRequired,
    },
    escalationRoleKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      enum: ['', ...escalationRoleKeyValues],
      default: WORKFLOW_POLICY_DEFAULTS.escalationRoleKey,
    },
    escalateTo: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      enum: ['', ...overrideRoleValues],
      default: WORKFLOW_POLICY_DEFAULTS.escalateTo,
    },
    escalationMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: WORKFLOW_POLICY_DEFAULTS.escalationMessage,
    },
    slaMinutes: {
      type: Number,
      min: 0,
      max: 10080,
      default: WORKFLOW_POLICY_DEFAULTS.slaMinutes,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      default: WORKFLOW_POLICY_DEFAULTS.version,
    },
    lastActivatedAt: {
      type: Date,
      default: WORKFLOW_POLICY_DEFAULTS.lastActivatedAt,
    },
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
workflowPolicySchema.index({ policyType: 1, updatedAt: -1 })
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

  if (this.isNew || this.isModified('status')) {
    this.status = normalizeEnumValue(this.status)
  }

  if (this.isNew || this.isModified('policyType')) {
    this.policyType = normalizeEnumValue(this.policyType)
  }

  if (this.isNew || this.isModified('frameworkKeys')) {
    this.frameworkKeys = normalizeFrameworkKeyList(this.frameworkKeys)
  }

  if (this.isNew || this.isModified('appliesTo')) {
    this.appliesTo = normalizeEnumValue(this.appliesTo)
  }

  if (this.isNew || this.isModified('triggerEvent')) {
    this.triggerEvent = normalizeEnumValue(this.triggerEvent)
  }

  if (this.isNew || this.isModified('triggerMode')) {
    this.triggerMode = normalizeEnumValue(this.triggerMode)
  }

  if (this.isNew || this.isModified('actorScope')) {
    this.actorScope = normalizeEnumValue(this.actorScope)
  }

  if (this.isNew || this.isModified('governedAction')) {
    this.governedAction = normalizeEnumValue(this.governedAction)
  }

  if (this.isNew || this.isModified('decisionMode')) {
    this.decisionMode = normalizeEnumValue(this.decisionMode)
  }

  if (this.isNew || this.isModified('passMessage')) {
    this.passMessage = normalizeTextValue(this.passMessage)
  }

  if (this.isNew || this.isModified('failMessage')) {
    this.failMessage = normalizeTextValue(this.failMessage)
  }

  if (this.isNew || this.isModified('severity')) {
    this.severity = normalizeEnumValue(this.severity)
  }

  if (this.isNew || this.isModified('conditions')) {
    this.conditions = normalizeConditions(this.conditions)
  }

  if (this.isNew || this.isModified('onPassEffects')) {
    this.onPassEffects = normalizeEffects(this.onPassEffects)
  }

  if (this.isNew || this.isModified('onFailEffects')) {
    this.onFailEffects = normalizeEffects(this.onFailEffects)
  }

  if (this.isNew || this.isModified('overrideRoles')) {
    this.overrideRoles = normalizeEnumValueList(this.overrideRoles)
  }

  if (this.isNew || this.isModified('escalateTo')) {
    this.escalateTo = normalizeEnumValue(this.escalateTo)
  }

  if (this.isNew || this.isModified('escalationRoleKey')) {
    this.escalationRoleKey = normalizeEnumValue(this.escalationRoleKey)
  }

  if (!this.escalationRoleKey && this.escalateTo) {
    const legacyEscalation = normalizeEnumValue(this.escalateTo)
    this.escalationRoleKey = legacyEscalation === WORKFLOW_POLICY_ESCALATION_ROLE_KEYS.FRAMEWORK_OWNER
      ? WORKFLOW_POLICY_ESCALATION_ROLE_KEYS.FRAMEWORK_OWNER
      : WORKFLOW_POLICY_ESCALATION_ROLE_KEYS.CUSTOMER_ADMIN
  }

  if (this.isNew || this.isModified('escalationMessage')) {
    this.escalationMessage = normalizeTextValue(this.escalationMessage)
  }

  if (this.isNew || this.isModified('routingMode')) {
    this.routingMode = normalizeEnumValue(this.routingMode)
  }

  if (this.isNew || this.isModified('primaryAgentId')) {
    this.primaryAgentId = normalizeKey(this.primaryAgentId)
  }

  if (this.isNew || this.isModified('fallbackAgentId')) {
    this.fallbackAgentId = normalizeKey(this.fallbackAgentId)
  }

  if (this.isNew || this.isModified('retryOverride')) {
    this.retryOverride = normalizeTextValue(this.retryOverride)
  }

  if (this.isNew || this.isModified('requiredValidationKeys')) {
    this.requiredValidationKeys = normalizeTokenList(this.requiredValidationKeys)
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

applyRuntimeControlVersioning(workflowPolicySchema, {
  lockImpactingFields: RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS.WorkflowPolicy,
  compatibilityModeDefault: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
})

const WorkflowPolicy = mongoose.model('WorkflowPolicy', workflowPolicySchema)

export default WorkflowPolicy
