import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import mongoose from 'mongoose'
import WorkflowPolicy, {
  WORKFLOW_POLICY_ACTOR_SCOPES,
  WORKFLOW_POLICY_ALLOWED_STEPS_BY_FRAMEWORK,
  WORKFLOW_POLICY_CONDITION_OPERATORS,
  WORKFLOW_POLICY_DECISION_MODES,
  WORKFLOW_POLICY_DEFAULTS,
  WORKFLOW_POLICY_EFFECT_TYPES,
  WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_TARGET_PATH,
  WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_VALUE,
  WORKFLOW_POLICY_ESCALATION_ROLE_KEYS,
  WORKFLOW_POLICY_EXECUTION_TYPES,
  WORKFLOW_POLICY_ROUTING_MODES,
  WORKFLOW_POLICY_SEVERITIES,
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_STEP_TYPES,
  WORKFLOW_POLICY_STEP_ORDER_CONSTRAINTS_BY_FRAMEWORK,
  WORKFLOW_POLICY_TYPES,
  buildWorkflowPolicyStableId,
} from '../models/WorkflowPolicy.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeAgent, { RUNTIME_AGENT_STATUSES } from '../models/RuntimeAgent.js'
import RuntimeSkill, { RUNTIME_SKILL_STATUSES } from '../models/RuntimeSkill.js'
import ValidationRegistry, { VALIDATION_REGISTRY_STATUSES } from '../models/ValidationRegistry.js'
import {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
} from '../models/RuntimePathRegistry.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  normalizeFrameworkKeyList,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { resolveRuntimePathSelections } from '../services/runtimePathRegistryService.js'
import {
  LOCKED_RUNTIME_CONTROL_EDIT_MESSAGE,
  RUNTIME_CONTROL_VERSION_STATUSES,
} from '../utils/runtimeControlVersioning.js'
import {
  isWorkflowPolicyValueMissing,
  normalizeRuntimePathCommaList as normalizeCommaList,
  normalizeRuntimePathConditionOperator as normalizeConditionOperator,
  validateRuntimePathLiteralValue,
} from '../utils/runtimePathLiteralValidation.js'

const DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE = 'Workflow policy key must be unique.'
const WORKFLOW_POLICY_NOT_FOUND_MESSAGE = 'Workflow policy was not found.'
const WORKFLOW_POLICY_FIELD_DEFAULTS = Object.freeze({
  ...WORKFLOW_POLICY_DEFAULTS,
  frameworkKeys: [],
  conditions: [],
  requiredValidationKeys: [],
  onPassEffects: [],
  onFailEffects: [],
  escalationRoleKey: '',
  executionType: WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP,
  steps: [],
  orderedSteps: [],
  requiredAgentIds: [],
  requiredSkillIds: [],
  gatingRules: [],
  version: 1,
  lastActivatedAt: null,
})

const VALID_WORKFLOW_POLICY_CONDITION_OPERATORS = new Set(
  Object.values(WORKFLOW_POLICY_CONDITION_OPERATORS).map((value) => normalizeConditionOperator(value)),
)

const CONDITION_OPERATORS_WITHOUT_VALUE = new Set([
  normalizeConditionOperator(WORKFLOW_POLICY_CONDITION_OPERATORS.EXISTS),
  normalizeConditionOperator(WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EXISTS),
])

const ROUTING_MODES_REQUIRING_PRIMARY_AGENT = new Set([
  WORKFLOW_POLICY_ROUTING_MODES.FIXED_AGENT,
])

const WORKFLOW_POLICY_TEST_AUDIT_RESOURCE_PREFIX = 'workflow-policy-test'

const WORKFLOW_POLICY_MUTABLE_FIELDS = Object.freeze([
  'key',
  'name',
  'description',
  'status',
  'policyType',
  'priority',
  'frameworkKeys',
  'appliesTo',
  'triggerEvent',
  'triggerMode',
  'actorScope',
  'cooldownSeconds',
  'reevaluateOnRetry',
  'governedAction',
  'decisionMode',
  'executionType',
  'steps',
  'passMessage',
  'failMessage',
  'severity',
  'conditions',
  'routingMode',
  'primaryAgentId',
  'fallbackAgentId',
  'timeoutMs',
  'retryOverride',
  'requireSuccess',
  'requiredValidationKeys',
  'validationBlockingOnFail',
  'validationWarningOnly',
  'validationFreshnessMinutes',
  'validationRequireLatestRun',
  'onPassEffects',
  'onFailEffects',
  'overrideAllowed',
  'overrideRoles',
  'approvalRequired',
  'escalationRoleKey',
  'escalationMessage',
  'slaMinutes',
  'orderedSteps',
  'requiredAgentIds',
  'requiredSkillIds',
])

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (value?._bsontype === 'ObjectId' || value?.constructor?.name === 'ObjectId') {
      return typeof value.toString === 'function' ? value.toString() : String(value)
    }
    if (typeof value.id === 'string' && value.id.trim()) return value.id
    if (typeof value._id === 'string' && value._id.trim()) return value._id
    if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  }
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

const normalizeNullableText = (value) => {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized || null
}

const normalizeWorkflowPolicyStableId = (value) =>
  String(value || '').trim().toLowerCase()

const workflowPolicyKeyFromStableId = (policyId) => {
  const normalized = normalizeWorkflowPolicyStableId(policyId)
  return normalized.startsWith('policy-') ? normalized.slice('policy-'.length) : normalized
}

const buildWorkflowPolicyIdentityFilter = (policyId) => {
  const stableId = normalizeWorkflowPolicyStableId(policyId)
  const key = workflowPolicyKeyFromStableId(stableId)

  return {
    $or: [
      { stableId },
      { key },
    ],
  }
}

const normalizeEscalationRoleKey = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!normalized) return ''
  if (Object.values(WORKFLOW_POLICY_ESCALATION_ROLE_KEYS).includes(normalized)) return normalized
  if (normalized === 'FRAMEWORK_OWNER') return WORKFLOW_POLICY_ESCALATION_ROLE_KEYS.FRAMEWORK_OWNER
  return WORKFLOW_POLICY_ESCALATION_ROLE_KEYS.CUSTOMER_ADMIN
}

const normalizeWorkflowPolicyTokenList = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean),
  )]

const normalizeWorkflowPolicyTimeoutMs = (value) => {
  if (value === null) return null
  const numericValue = Number(value)
  if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 300000) {
    return numericValue
  }
  return WORKFLOW_POLICY_DEFAULTS.timeoutMs
}

const deriveWorkflowPolicyExecutionFields = ({
  steps = [],
  primaryAgentId = '',
  fallbackAgentId = '',
  orderedSteps = [],
  requiredAgentIds = [],
  requiredSkillIds = [],
} = {}) => {
  const normalizedSteps = normalizeWorkflowStepRows(steps)
  const hasCanonicalSteps = normalizedSteps.length > 0
  const derivedOrderedSteps = hasCanonicalSteps
    ? [...normalizedSteps]
      .sort((left, right) => Number(left.order) - Number(right.order))
      .map((step) => String(step.stepKey ?? '').trim().toLowerCase())
      .filter(Boolean)
    : normalizeWorkflowPolicyTokenList(orderedSteps)
  const derivedRequiredAgentIds = [
    primaryAgentId,
    fallbackAgentId,
    ...(hasCanonicalSteps
      ? normalizedSteps.map((step) => step.agentId)
      : normalizeWorkflowPolicyTokenList(requiredAgentIds)),
  ].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean)
  const derivedRequiredSkillIds = hasCanonicalSteps
    ? normalizedSteps.map((step) => String(step.skillId ?? '').trim().toLowerCase()).filter(Boolean)
    : normalizeWorkflowPolicyTokenList(requiredSkillIds)

  return {
    orderedSteps: [...new Set(derivedOrderedSteps)],
    requiredAgentIds: [...new Set(derivedRequiredAgentIds)],
    requiredSkillIds: [...new Set(derivedRequiredSkillIds)],
  }
}

const pickWorkflowPolicyPayload = (body = {}) => {
  const payload = WORKFLOW_POLICY_MUTABLE_FIELDS.reduce((nextPayload, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      nextPayload[field] = body[field]
    }
    return nextPayload
  }, {})

  if (
    !payload.escalationRoleKey
    && Object.prototype.hasOwnProperty.call(body, 'escalateTo')
  ) {
    payload.escalationRoleKey = normalizeEscalationRoleKey(body.escalateTo)
  }

  return payload
}

const buildActorSummary = (req) => {
  const actor = req.scopes?.user
  const id = toIdString(actor?.id || actor?._id || req.context?.userId || req.userId)

  if (!id) return null

  return {
    id,
    ...(actor?.name ? { name: actor.name } : {}),
    ...(actor?.email ? { email: actor.email } : {}),
  }
}

const serializeUserSummary = (value) => {
  if (!value) return null

  if (typeof value === 'string') {
    return { id: value }
  }

  const id = toIdString(value.id || value._id || value)
  if (!id) return null

  return {
    id,
    ...(value.name ? { name: value.name } : {}),
    ...(value.email ? { email: value.email } : {}),
  }
}

const serializeRuntimeDependencyReference = (value) => ({
  id: value?.stableId || value?.id || '',
  key: value?.key || '',
  name: value?.name || value?.key || '',
  status: value?.status || '',
})

const serializeFrameworkPackageDependencyReference = (value) => ({
  id: value?.stableId || `${value?.frameworkKey || 'framework'}-${value?.version || 'package'}`,
  frameworkKey: value?.frameworkKey || '',
  frameworkName: value?.frameworkName || '',
  version: value?.version || '',
  status: value?.status || '',
})

const serializeWorkflowFrameworkReference = (value) => ({
  id: value?.stableId || value?.frameworkKey || '',
  key: value?.frameworkKey || '',
  name: value?.name || value?.frameworkKey || '',
  status: value?.status || '',
})

const serializeWorkflowValidationReference = (value) => ({
  id: String(value ?? ''),
  key: String(value ?? ''),
  name: String(value ?? ''),
  status: 'CONFIGURED',
})

const serializeWorkflowRuntimePathReference = (value) => ({
  id: value?.stableId || value?.pathKey || '',
  key: value?.pathKey || '',
  name: value?.label || value?.pathKey || '',
  status: value?.status || '',
  scope: value?.scope || '',
  isProtected: Boolean(value?.isProtected),
})

const serializeWorkflowPolicy = (workflowPolicy, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof workflowPolicy?.toJSON === 'function'
    ? workflowPolicy.toJSON()
    : { ...workflowPolicy }

  if (!plain.id && plain.stableId) {
    plain.id = plain.stableId
  }

  delete plain._id
  delete plain.__v
  delete plain.stableId

  for (const [field, fallbackValue] of Object.entries(WORKFLOW_POLICY_FIELD_DEFAULTS)) {
    if (plain[field] === undefined) {
      plain[field] = cloneAuditValue(fallbackValue)
    }
  }

  if (!plain.escalationRoleKey && plain.escalateTo) {
    plain.escalationRoleKey = normalizeEscalationRoleKey(plain.escalateTo)
  }

  plain.lockedReason = normalizeNullableText(plain.lockedReason)
  plain.deprecatedInVersion = normalizeNullableText(plain.deprecatedInVersion)
  plain.timeoutMs = normalizeWorkflowPolicyTimeoutMs(plain.timeoutMs)
  plain.gatingRules = []
  Object.assign(plain, deriveWorkflowPolicyExecutionFields(plain))

  const serializedUpdatedBy = serializeUserSummary(plain.updatedBy)
  plain.createdBy = serializeUserSummary(plain.createdBy)
  plain.updatedBy =
    (serializedUpdatedBy?.name || serializedUpdatedBy?.email)
      ? serializedUpdatedBy
      : (fallbackUpdatedBy || serializedUpdatedBy)

  return plain
}

const buildWorkflowPolicyLabel = (workflowPolicy) =>
  workflowPolicy?.name
    ? `${workflowPolicy.name} (${workflowPolicy.key})`
    : workflowPolicy?.key

const isDuplicateWorkflowPolicyKeyError = (err) =>
  err?.code === 11000
  && (err?.keyPattern?.key || err?.keyPattern?.stableId)

const sendConflict = (res, req, message, details = {}) =>
  res.status(409).json({
    error: {
      code: 'CONFLICT',
      message,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      requestId: req.requestId,
    },
  })

const sendValidationFailed = (res, req, details, message = 'Please check the form for errors.') =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details,
      requestId: req.requestId,
    },
  })

const populateWorkflowPolicy = async (workflowPolicy) => {
  if (!workflowPolicy || typeof workflowPolicy.populate !== 'function') {
    return workflowPolicy
  }

  await workflowPolicy.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
  ])

  return workflowPolicy
}

const buildListFilter = ({ q, status, frameworkKey, type }) => {
  const filter = {}

  if (status) {
    filter.status = status
  }

  if (type) {
    filter.policyType = type
  }

  if (frameworkKey) {
    filter.frameworkKeys = frameworkKey
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { stableId: regex },
      { key: regex },
      { name: regex },
      { description: regex },
      { status: regex },
      { policyType: regex },
      { triggerEvent: regex },
      { governedAction: regex },
      { lineageId: regex },
      { 'steps.stepKey': regex },
      { 'steps.bindingKeys': regex },
      { 'steps.targetPath': regex },
      { 'steps.agentId': regex },
      { 'steps.skillId': regex },
    ]
  }

  return filter
}

const findUnsupportedFrameworkKey = (supportedFrameworkKeys = [], workflowFrameworkKeys = []) =>
  workflowFrameworkKeys.find((frameworkKey) => !supportedFrameworkKeys.includes(frameworkKey))

const getWorkflowPolicyFieldValue = (workflowPolicy, field) => {
  const directValue = workflowPolicy?.[field]
  if (field === 'timeoutMs' && directValue !== undefined) {
    return normalizeWorkflowPolicyTimeoutMs(directValue)
  }
  if (directValue !== undefined) return directValue
  return cloneAuditValue(WORKFLOW_POLICY_FIELD_DEFAULTS[field])
}

const getWorkflowStepValidationMessage = (frameworkKeys = [], orderedSteps = []) => {
  const positions = new Map(orderedSteps.map((step, index) => [step, index]))

  for (const frameworkKey of frameworkKeys) {
    const allowedSteps = WORKFLOW_POLICY_ALLOWED_STEPS_BY_FRAMEWORK[frameworkKey] || []
    for (const step of orderedSteps) {
      if (!allowedSteps.includes(step)) {
        return `Workflow step "${step}" is not valid for framework key "${frameworkKey}".`
      }
    }

    const orderConstraints = WORKFLOW_POLICY_STEP_ORDER_CONSTRAINTS_BY_FRAMEWORK[frameworkKey] || []
    for (const [beforeStep, afterStep] of orderConstraints) {
      if (!positions.has(beforeStep) || !positions.has(afterStep)) continue

      if (positions.get(beforeStep) > positions.get(afterStep)) {
        return `Workflow step "${beforeStep}" must come before "${afterStep}" for framework key "${frameworkKey}".`
      }
    }
  }

  return null
}

const normalizeConditionValue = (value, operator) => {
  const normalizedOperator = normalizeConditionOperator(operator)

  if (CONDITION_OPERATORS_WITHOUT_VALUE.has(normalizedOperator)) {
    return ''
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  if (
    normalizedOperator === normalizeConditionOperator(WORKFLOW_POLICY_CONDITION_OPERATORS.IN)
    || normalizedOperator === normalizeConditionOperator(WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_IN)
  ) {
    return normalizeCommaList(value)
  }

  return value
}

const normalizeConditionRows = (conditions = []) =>
  Array.isArray(conditions)
    ? conditions.map((condition) => ({
        path: String(condition?.path ?? '').trim(),
        operator: normalizeConditionOperator(condition?.operator),
        value: normalizeConditionValue(condition?.value, condition?.operator),
        logic: String(condition?.logic ?? 'AND').trim().toUpperCase(),
      }))
      .map((condition, index, rows) => {
        if (index < rows.length - 1) return condition
        const terminalCondition = { ...condition }
        delete terminalCondition.logic
        return terminalCondition
      })
    : []

const normalizeEffectRows = (effects = []) =>
  Array.isArray(effects)
    ? effects.map((effect) => {
        const type = String(effect?.type ?? '').trim().toUpperCase()
        return {
          type,
          targetPath: WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_TARGET_PATH.has(type)
            ? String(effect?.targetPath ?? '').trim()
            : '',
          value: WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_VALUE.has(type)
            ? (
                Array.isArray(effect?.value)
                  ? effect.value.map((item) => String(item ?? '').trim()).filter(Boolean)
                  : effect?.value
              )
            : '',
        }
      })
    : []

const normalizeWorkflowStepRows = (steps = []) =>
  Array.isArray(steps)
    ? steps.map((step) => ({
        stepKey: String(step?.stepKey ?? '').trim().toLowerCase(),
        type: String(step?.type ?? '').trim().toUpperCase(),
        order: Number(step?.order),
        bindingKeys: Array.isArray(step?.bindingKeys)
          ? [...new Set(step.bindingKeys.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean))]
          : [],
        targetPath: String(step?.targetPath ?? '').trim(),
        value: step?.value === undefined ? '' : step.value,
        agentId: String(step?.agentId ?? '').trim().toLowerCase(),
        skillId: String(step?.skillId ?? '').trim().toLowerCase(),
        eventKey: String(step?.eventKey ?? '').trim().toLowerCase(),
        blocking: step?.blocking === undefined ? true : Boolean(step.blocking),
        parameters:
          step?.parameters && typeof step.parameters === 'object' && !Array.isArray(step.parameters)
            ? step.parameters
            : {},
      }))
    : []

const validateWorkflowPolicyConditions = async ({
  conditions = [],
  frameworkKeys = [],
}) => {
  const details = {}
  const normalizedConditions = normalizeConditionRows(conditions)

  if (normalizedConditions.length === 0) {
    return details
  }

  const firstMissingPath = normalizedConditions.find((condition) => !condition.path)
  if (firstMissingPath) {
    details.conditions = 'Each condition row requires a governed runtime path.'
    return details
  }

  const firstMissingOperator = normalizedConditions.find((condition) => !condition.operator)
  if (firstMissingOperator) {
    details.conditions = `Condition "${firstMissingOperator.path}" is missing an operator.`
    return details
  }

  const firstUnsupportedOperator = normalizedConditions.find(
    (condition) => !VALID_WORKFLOW_POLICY_CONDITION_OPERATORS.has(condition.operator),
  )
  if (firstUnsupportedOperator) {
    details.conditions = `Condition "${firstUnsupportedOperator.path}" uses an unsupported operator.`
    return details
  }

  const firstMissingValue = normalizedConditions.find((condition) => {
    if (CONDITION_OPERATORS_WITHOUT_VALUE.has(condition.operator)) return false
    if (Array.isArray(condition.value)) return condition.value.length === 0
    if (typeof condition.value === 'boolean') return false
    if (typeof condition.value === 'number') return false
    return String(condition.value ?? '').trim() === ''
  })
  if (firstMissingValue) {
    details.conditions = `Condition "${firstMissingValue.path}" requires a comparison value.`
    return details
  }

  const conditionSelections = await resolveRuntimePathSelections({
    pathKeys: normalizedConditions.map((condition) => condition.path),
    frameworkKeys,
    operation: null,
    requireActive: true,
    forbidProtectedWrites: false,
    selectFields: [
      'pathKey',
      'status',
      'frameworkKeys',
      'allowedOperations',
      'isProtected',
      'scope',
      'dataType',
      'allowedValues',
      'allowedValueLabels',
      'uiControl',
      'placeholderText',
      'helpText',
      'defaultValue',
      'minValue',
      'maxValue',
      'minLength',
      'maxLength',
      'regexPattern',
      'isNullable',
    ],
  })

  if (conditionSelections.missing.length > 0) {
    details.conditions = `Unknown condition runtime path "${conditionSelections.missing[0]}".`
    return details
  }

  if (conditionSelections.inactive.length > 0) {
    details.conditions = `Condition runtime path "${conditionSelections.inactive[0]}" is not ACTIVE.`
    return details
  }

  if (conditionSelections.incompatibleFramework.length > 0) {
    details.conditions =
      `Condition runtime path "${conditionSelections.incompatibleFramework[0]}" is not compatible with the selected frameworks.`
    return details
  }

  const conditionPathKeySet = new Set(normalizedConditions.map((condition) => condition.path))
  const conditionRows = conditionSelections.rows.filter((row) =>
    conditionPathKeySet.has(String(row?.pathKey ?? '').trim()),
  )

  const firstNonFrameworkStatePath = conditionRows.find(
    (row) => !String(row?.pathKey ?? '').trim().startsWith('framework_state.'),
  )
  if (firstNonFrameworkStatePath) {
    details.conditions =
      `Condition runtime path "${firstNonFrameworkStatePath.pathKey}" must be under framework_state.*.`
    return details
  }

  const firstUnreadablePath = conditionRows.find((row) => {
    const allowedOperations = Array.isArray(row?.allowedOperations)
      ? row.allowedOperations.map((operation) => String(operation ?? '').trim().toUpperCase())
      : []
    return !allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.READ)
      && !allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.BIND)
  })
  if (firstUnreadablePath) {
    details.conditions = `Condition runtime path "${firstUnreadablePath.pathKey}" cannot be read.`
    return details
  }

  const byPathKey = new Map(conditionRows.map((row) => [String(row?.pathKey ?? '').trim(), row]))
  const firstInvalidLiteral = normalizedConditions.find((condition) => {
    if (CONDITION_OPERATORS_WITHOUT_VALUE.has(condition.operator)) return false
    const runtimePath = byPathKey.get(condition.path)
    const message = validateRuntimePathLiteralValue({
      runtimePath,
      operator: condition.operator,
      value: condition.value,
    })
    return Boolean(message)
  })

  if (firstInvalidLiteral) {
    const runtimePath = byPathKey.get(firstInvalidLiteral.path)
    const message = validateRuntimePathLiteralValue({
      runtimePath,
      operator: firstInvalidLiteral.operator,
      value: firstInvalidLiteral.value,
    })
    details.conditions = `Condition "${firstInvalidLiteral.path}" value is invalid. ${message}`
    return details
  }

  return details
}

const validateWorkflowPolicyEffects = async ({
  label,
  effects = [],
  frameworkKeys = [],
}) => {
  const details = {}
  const normalizedEffects = normalizeEffectRows(effects)

  if (normalizedEffects.length === 0) {
    return details
  }

  const firstMissingType = normalizedEffects.find((effect) => !effect.type)
  if (firstMissingType) {
    details[label] = 'Each effect row requires an effect type.'
    return details
  }

  const firstMissingTargetPath = normalizedEffects.find((effect) =>
    WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_TARGET_PATH.has(effect.type) && !effect.targetPath,
  )
  if (firstMissingTargetPath) {
    details[label] = `Effect "${firstMissingTargetPath.type}" requires a writable runtime path.`
    return details
  }

  const firstMissingValue = normalizedEffects.find((effect) => {
    if (!WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_VALUE.has(effect.type)) return false
    return isWorkflowPolicyValueMissing(effect.value)
  })
  if (firstMissingValue) {
    details[label] = `Effect "${firstMissingValue.type}" requires a value.`
    return details
  }

  const pathSelections = await resolveRuntimePathSelections({
    pathKeys: normalizedEffects
      .map((effect) => effect.targetPath)
      .filter(Boolean),
    frameworkKeys,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    requireActive: true,
    forbidProtectedWrites: true,
    selectFields: [
      'pathKey',
      'status',
      'frameworkKeys',
      'allowedOperations',
      'isProtected',
      'scope',
      'dataType',
      'allowedValues',
      'allowedValueLabels',
      'uiControl',
      'placeholderText',
      'helpText',
      'defaultValue',
      'minValue',
      'maxValue',
      'minLength',
      'maxLength',
      'regexPattern',
      'isNullable',
    ],
  })

  if (pathSelections.missing.length > 0) {
    details[label] = `Unknown effect runtime path "${pathSelections.missing[0]}".`
    return details
  }

  if (pathSelections.inactive.length > 0) {
    details[label] = `Effect runtime path "${pathSelections.inactive[0]}" is not ACTIVE.`
    return details
  }

  if (pathSelections.invalidOperation.length > 0) {
    details[label] = `Effect runtime path "${pathSelections.invalidOperation[0]}" does not allow WRITE.`
    return details
  }

  if (pathSelections.incompatibleFramework.length > 0) {
    details[label] =
      `Effect runtime path "${pathSelections.incompatibleFramework[0]}" is not compatible with the selected frameworks.`
    return details
  }

  if (pathSelections.protectedWrite.length > 0) {
    details[label] = `Effect runtime path "${pathSelections.protectedWrite[0]}" is protected and cannot be written by Workflow Policy effects.`
    return details
  }

  const firstNonStatePath = pathSelections.rows.find(
    (row) => String(row?.scope ?? '').trim().toUpperCase() !== RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
  )
  if (firstNonStatePath) {
    details[label] = `Effect runtime path "${firstNonStatePath.pathKey}" must use FRAMEWORK_STATE scope.`
    return details
  }

  const byPathKey = new Map(pathSelections.rows.map((row) => [String(row?.pathKey ?? '').trim(), row]))
  const firstInvalidLiteral = normalizedEffects.find((effect) => {
    if (!WORKFLOW_POLICY_EFFECT_TYPES_REQUIRING_VALUE.has(effect.type)) return false
    if (!effect.targetPath) return false
    const runtimePath = byPathKey.get(effect.targetPath)
    const message = validateRuntimePathLiteralValue({
      runtimePath,
      operator: effect.type,
      value: effect.value,
    })
    return Boolean(message)
  })

  if (firstInvalidLiteral) {
    const runtimePath = byPathKey.get(firstInvalidLiteral.targetPath)
    const message = validateRuntimePathLiteralValue({
      runtimePath,
      operator: firstInvalidLiteral.type,
      value: firstInvalidLiteral.value,
    })
    details[label] = `Effect "${firstInvalidLiteral.type}" value is invalid. ${message}`
    return details
  }

  return details
}

const validateWorkflowPolicySteps = async ({
  executionType,
  steps = [],
  frameworkKeys = [],
}) => {
  const details = {}
  const normalizedSteps = normalizeWorkflowStepRows(steps)
  const normalizedExecutionType = String(executionType || WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP)
    .trim()
    .toUpperCase()

  if (
    normalizedExecutionType !== WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP
    && normalizedSteps.length === 0
  ) {
    details.steps = 'Ordered or composite workflow policies require at least one governed step.'
    return details
  }

  if (normalizedSteps.length === 0) {
    return details
  }

  const stepKeys = new Set()
  const orders = new Set()
  for (const step of normalizedSteps) {
    if (!step.stepKey) {
      details.steps = 'Every governed step requires a step key.'
      return details
    }
    if (stepKeys.has(step.stepKey)) {
      details.steps = `Workflow step key "${step.stepKey}" is duplicated.`
      return details
    }
    stepKeys.add(step.stepKey)

    if (!Number.isInteger(step.order) || step.order < 1) {
      details.steps = `Workflow step "${step.stepKey}" requires a positive order.`
      return details
    }
    if (orders.has(step.order)) {
      details.steps = `Workflow step order "${step.order}" is duplicated.`
      return details
    }
    orders.add(step.order)

    if (!Object.values(WORKFLOW_POLICY_STEP_TYPES).includes(step.type)) {
      details.steps = `Workflow step "${step.stepKey}" uses an unsupported type.`
      return details
    }

    if (step.type === WORKFLOW_POLICY_STEP_TYPES.VALIDATION && step.bindingKeys.length === 0) {
      details.steps = `Validation step "${step.stepKey}" requires at least one validation binding key.`
      return details
    }
    if (step.type === WORKFLOW_POLICY_STEP_TYPES.STATE_UPDATE && !step.targetPath) {
      details.steps = `State update step "${step.stepKey}" requires a writable runtime path.`
      return details
    }
    if (
      step.type === WORKFLOW_POLICY_STEP_TYPES.STATE_UPDATE
      && isWorkflowPolicyValueMissing(step.value)
    ) {
      details.steps = `State update step "${step.stepKey}" requires a value.`
      return details
    }
    if (step.type === WORKFLOW_POLICY_STEP_TYPES.AGENT_EXECUTION && !step.agentId) {
      details.steps = `Agent execution step "${step.stepKey}" requires an agent id.`
      return details
    }
    if (step.type === WORKFLOW_POLICY_STEP_TYPES.SKILL_EXECUTION && !step.skillId) {
      details.steps = `Skill execution step "${step.stepKey}" requires a skill id.`
      return details
    }
    if (step.type === WORKFLOW_POLICY_STEP_TYPES.EVENT_EMIT && !step.eventKey) {
      details.steps = `Event emit step "${step.stepKey}" requires an event key.`
      return details
    }
  }

  const stateUpdatePaths = normalizedSteps
    .filter((step) => step.type === WORKFLOW_POLICY_STEP_TYPES.STATE_UPDATE)
    .map((step) => step.targetPath)
    .filter(Boolean)

  if (stateUpdatePaths.length === 0) {
    return details
  }

  const pathSelections = await resolveRuntimePathSelections({
    pathKeys: stateUpdatePaths,
    frameworkKeys,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    requireActive: true,
    forbidProtectedWrites: true,
    selectFields: ['pathKey', 'status', 'frameworkKeys', 'allowedOperations', 'isProtected', 'scope'],
  })

  if (pathSelections.missing.length > 0) {
    details.steps = `Unknown step runtime path "${pathSelections.missing[0]}".`
    return details
  }
  if (pathSelections.inactive.length > 0) {
    details.steps = `Step runtime path "${pathSelections.inactive[0]}" is not ACTIVE.`
    return details
  }
  if (pathSelections.invalidOperation.length > 0) {
    details.steps = `Step runtime path "${pathSelections.invalidOperation[0]}" does not allow WRITE.`
    return details
  }
  if (pathSelections.incompatibleFramework.length > 0) {
    details.steps =
      `Step runtime path "${pathSelections.incompatibleFramework[0]}" is not compatible with the selected frameworks.`
    return details
  }
  if (pathSelections.protectedWrite.length > 0) {
    details.steps = `Step runtime path "${pathSelections.protectedWrite[0]}" is protected and cannot be written by Workflow Policy steps.`
  }

  return details
}

const fetchRegistryReferences = async ({ requiredAgentIds = [], requiredSkillIds = [] }) => {
  const [agents, skills] = await Promise.all([
    requiredAgentIds.length > 0
      ? RuntimeAgent.find({ stableId: { $in: requiredAgentIds } })
        .select('stableId key name status supportedFrameworkKeys')
        .lean()
      : Promise.resolve([]),
    requiredSkillIds.length > 0
      ? RuntimeSkill.find({ stableId: { $in: requiredSkillIds } })
        .select('stableId key name status supportedFrameworkKeys')
        .lean()
      : Promise.resolve([]),
  ])

  return { agents, skills }
}

const fetchWorkflowPolicyDependencies = async (workflowPolicy) => {
  const policyKey = String(workflowPolicy?.key ?? '').trim().toLowerCase()
  const policyDbId = workflowPolicy?._id
  const frameworkKeys = normalizeFrameworkKeyList(workflowPolicy?.frameworkKeys)
  const usedAgentIds = [
    ...new Set([
      String(workflowPolicy?.primaryAgentId ?? '').trim().toLowerCase(),
      String(workflowPolicy?.fallbackAgentId ?? '').trim().toLowerCase(),
      ...(Array.isArray(workflowPolicy?.requiredAgentIds) ? workflowPolicy.requiredAgentIds : []),
      ...(Array.isArray(workflowPolicy?.steps) ? workflowPolicy.steps.map((step) => step?.agentId) : []),
    ].filter(Boolean)),
  ]
  const usedSkillIds = [
    ...new Set([
      ...(Array.isArray(workflowPolicy?.requiredSkillIds) ? workflowPolicy.requiredSkillIds : []),
      ...(Array.isArray(workflowPolicy?.steps) ? workflowPolicy.steps.map((step) => step?.skillId) : []),
    ].filter(Boolean)),
  ]
  const usedRuntimePathKeys = [
    ...new Set([
      ...(Array.isArray(workflowPolicy?.conditions) ? workflowPolicy.conditions.map((condition) => condition?.path) : []),
      ...(Array.isArray(workflowPolicy?.onPassEffects) ? workflowPolicy.onPassEffects.map((effect) => effect?.targetPath) : []),
      ...(Array.isArray(workflowPolicy?.onFailEffects) ? workflowPolicy.onFailEffects.map((effect) => effect?.targetPath) : []),
      ...(Array.isArray(workflowPolicy?.steps) ? workflowPolicy.steps.map((step) => step?.targetPath) : []),
    ].map((value) => String(value ?? '').trim()).filter(Boolean)),
  ]

  const [
    frameworkPackages,
    agents,
    skills,
    runtimePaths,
    collisions,
    knownFrameworks,
  ] = await Promise.all([
    policyKey
      ? FrameworkPackage.find({ 'workflowBindings.policyKey': policyKey })
        .maxTimeMS(3000)
        .select('stableId frameworkKey frameworkName version status')
        .lean()
      : Promise.resolve([]),
    usedAgentIds.length > 0
      ? RuntimeAgent.find({ stableId: { $in: usedAgentIds } })
        .maxTimeMS(3000)
        .select('stableId key name status')
        .lean()
      : Promise.resolve([]),
    usedSkillIds.length > 0
      ? RuntimeSkill.find({ stableId: { $in: usedSkillIds } })
        .maxTimeMS(3000)
        .select('stableId key name status')
        .lean()
      : Promise.resolve([]),
    usedRuntimePathKeys.length > 0
      ? resolveRuntimePathSelections({
        pathKeys: usedRuntimePathKeys,
        frameworkKeys,
        requireActive: false,
        forbidProtectedWrites: false,
      })
      : Promise.resolve({ rows: [] }),
    String(workflowPolicy?.triggerEvent ?? '').trim() && String(workflowPolicy?.governedAction ?? '').trim()
      ? WorkflowPolicy.find({
        _id: { $ne: policyDbId },
        priority: workflowPolicy?.priority,
        triggerEvent: workflowPolicy?.triggerEvent,
        governedAction: workflowPolicy?.governedAction,
        ...(frameworkKeys.length > 0 ? { frameworkKeys: { $in: frameworkKeys } } : {}),
      })
        .maxTimeMS(3000)
        .select('stableId key name status')
        .lean()
      : Promise.resolve([]),
    resolveKnownFrameworkKeys(frameworkKeys),
  ])

  const frameworkEntries = frameworkKeys.map((frameworkKey) => (
    knownFrameworks.registryByKey.get(frameworkKey) ?? {
      frameworkKey,
      name: frameworkKey,
      status: knownFrameworks.inactiveKeys.includes(frameworkKey) ? 'INACTIVE' : 'UNKNOWN',
    }
  ))

  return {
    referencedBy: {
      frameworkPackages: Array.isArray(frameworkPackages) ? frameworkPackages : [],
      workflowPolicies: [],
      scheduledJobs: [],
    },
    uses: {
      agents: Array.isArray(agents) ? agents : [],
      skills: Array.isArray(skills) ? skills : [],
      frameworks: frameworkEntries,
      validationOutputs: Array.isArray(workflowPolicy?.requiredValidationKeys)
        ? workflowPolicy.requiredValidationKeys
        : [],
      runtimePaths: Array.isArray(runtimePaths?.rows) ? runtimePaths.rows : [],
    },
    collisions: Array.isArray(collisions) ? collisions : [],
  }
}

const buildWorkflowPolicyDependencySummary = ({
  referencedBy = {},
  uses = {},
  collisions = [],
}) => {
  const frameworkPackages = Array.isArray(referencedBy.frameworkPackages) ? referencedBy.frameworkPackages : []
  const agents = Array.isArray(uses.agents) ? uses.agents : []
  const skills = Array.isArray(uses.skills) ? uses.skills : []
  const frameworks = Array.isArray(uses.frameworks) ? uses.frameworks : []
  const validationOutputs = Array.isArray(uses.validationOutputs) ? uses.validationOutputs : []
  const runtimePaths = Array.isArray(uses.runtimePaths) ? uses.runtimePaths : []
  const activeFrameworkPackages = frameworkPackages.filter((pkg) => pkg?.status === 'ACTIVE')

  const warnings = []
  const blocks = []

  const firstNonActiveAgent = agents.find((agent) => String(agent?.status ?? '').trim().toUpperCase() !== 'ACTIVE')
  if (firstNonActiveAgent) {
    warnings.push(`This policy references non-active Agent: ${firstNonActiveAgent.key || firstNonActiveAgent.stableId}.`)
  }

  const firstNonActiveSkill = skills.find((skill) => String(skill?.status ?? '').trim().toUpperCase() !== 'ACTIVE')
  if (firstNonActiveSkill) {
    warnings.push(`This policy references non-active Skill: ${firstNonActiveSkill.key || firstNonActiveSkill.stableId}.`)
  }

  const firstPriorityCollision = collisions[0]
  if (firstPriorityCollision) {
    warnings.push(
      `Priority collision with policy: ${firstPriorityCollision.key || firstPriorityCollision.stableId}.`,
    )
  }

  if (activeFrameworkPackages.length > 0) {
    warnings.push(`This policy is referenced by ${activeFrameworkPackages.length} ACTIVE framework package${activeFrameworkPackages.length === 1 ? '' : 's'}.`)
  }

  return {
    summary: {
      frameworkPackages: frameworkPackages.length,
      activeFrameworkPackages: activeFrameworkPackages.length,
      agents: agents.length,
      skills: skills.length,
      frameworks: frameworks.length,
      validationOutputs: validationOutputs.length,
      runtimePaths: runtimePaths.length,
      priorityCollisions: collisions.length,
    },
    warnings,
    blocks,
  }
}

const getValueAtPath = (source, path) => {
  if (!path) return undefined

  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === null || current === undefined) return undefined
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        return current[Number(segment)]
      }
      if (typeof current !== 'object') return undefined
      return current[segment]
    }, source)
}

const FRAMEWORK_STATE_ROOT_PATH = 'framework_state'

const getFrameworkStateValueAtPath = (frameworkState, path) => {
  const normalizedPath = String(path ?? '').trim()
  if (!normalizedPath) return undefined

  const literalValue = getValueAtPath(frameworkState, normalizedPath)
  if (literalValue !== undefined) {
    return literalValue
  }

  const canUseRootFallback =
    frameworkState
    && typeof frameworkState === 'object'
    && !Array.isArray(frameworkState)
    && !Object.prototype.hasOwnProperty.call(frameworkState, FRAMEWORK_STATE_ROOT_PATH)

  // The Workflow Policy test console asks for sample FRAMEWORK_STATE JSON, so it should accept
  // both the inner framework-state object and a fully wrapped payload that already includes
  // the top-level "framework_state" key.
  if (canUseRootFallback && normalizedPath === FRAMEWORK_STATE_ROOT_PATH) {
    return frameworkState
  }

  if (!canUseRootFallback || !normalizedPath.startsWith(`${FRAMEWORK_STATE_ROOT_PATH}.`)) {
    return undefined
  }

  return getValueAtPath(frameworkState, normalizedPath.slice(FRAMEWORK_STATE_ROOT_PATH.length + 1))
}

const canCoerceToNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return true
  if (typeof value === 'string' && String(value).trim() !== '') {
    return Number.isFinite(Number(value))
  }
  return false
}

const normalizeComparableScalar = (value) => {
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^(true|false)$/i.test(trimmed)) {
      return trimmed.toLowerCase() === 'true'
    }
    if (canCoerceToNumber(trimmed)) {
      return Number(trimmed)
    }
    return trimmed
  }
  return value
}

const valuesEqual = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return isDeepStrictEqual(left, right)
  }

  return isDeepStrictEqual(
    normalizeComparableScalar(left),
    normalizeComparableScalar(right),
  )
}

const evaluateWorkflowPolicyConditionMatch = ({ operator, actualValue, expectedValue }) => {
  const normalizedOperator = String(operator ?? '').trim().toLowerCase()

  switch (normalizedOperator) {
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EQUALS:
      return valuesEqual(actualValue, expectedValue)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EQUALS:
      return !valuesEqual(actualValue, expectedValue)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EXISTS:
      return actualValue !== undefined && actualValue !== null && String(actualValue).trim() !== ''
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EXISTS:
      return actualValue === undefined || actualValue === null || String(actualValue).trim() === ''
    case WORKFLOW_POLICY_CONDITION_OPERATORS.CONTAINS:
      if (Array.isArray(actualValue)) {
        return actualValue.some((entry) => valuesEqual(entry, expectedValue))
      }
      return String(actualValue ?? '').includes(String(expectedValue ?? ''))
    case WORKFLOW_POLICY_CONDITION_OPERATORS.IN: {
      const expectedList = Array.isArray(expectedValue) ? expectedValue : [expectedValue]
      if (Array.isArray(actualValue)) {
        return actualValue.some((entry) => expectedList.some((candidate) => valuesEqual(entry, candidate)))
      }
      return expectedList.some((candidate) => valuesEqual(actualValue, candidate))
    }
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_IN: {
      const expectedList = Array.isArray(expectedValue) ? expectedValue : [expectedValue]
      if (Array.isArray(actualValue)) {
        return actualValue.every((entry) => expectedList.every((candidate) => !valuesEqual(entry, candidate)))
      }
      return expectedList.every((candidate) => !valuesEqual(actualValue, candidate))
    }
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN:
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN:
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL:
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN_OR_EQUAL: {
      if (!canCoerceToNumber(actualValue) || !canCoerceToNumber(expectedValue)) {
        return false
      }

      const actualNumber = Number(actualValue)
      const expectedNumber = Number(expectedValue)

      if (normalizedOperator === WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN) {
        return actualNumber > expectedNumber
      }
      if (normalizedOperator === WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN) {
        return actualNumber < expectedNumber
      }
      if (normalizedOperator === WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL) {
        return actualNumber >= expectedNumber
      }
      return actualNumber <= expectedNumber
    }
    default:
      return false
  }
}

const evaluateWorkflowPolicyConditionsAgainstState = ({ conditions = [], frameworkState = {} }) => {
  const normalizedConditions = normalizeConditionRows(conditions)
  const conditionResults = normalizedConditions.map((condition) => {
    const actualValue = getFrameworkStateValueAtPath(frameworkState, condition.path)
    const matched = evaluateWorkflowPolicyConditionMatch({
      operator: condition.operator,
      actualValue,
      expectedValue: condition.value,
    })

    return {
      path: condition.path,
      operator: condition.operator,
      expectedValue: cloneAuditValue(condition.value),
      actualValue: cloneAuditValue(actualValue),
      matched,
      ...(condition.logic ? { logic: condition.logic } : {}),
    }
  })

  const allMatched = conditionResults.reduce((currentResult, conditionResult, index) => {
    if (index === 0) return conditionResult.matched
    const previousCondition = conditionResults[index - 1]
    if (String(previousCondition?.logic ?? 'AND').trim().toUpperCase() === 'OR') {
      return currentResult || conditionResult.matched
    }
    return currentResult && conditionResult.matched
  }, conditionResults.length === 0 ? true : false)

  return {
    allMatched,
    conditionResults,
  }
}

const serializeWorkflowPolicyTestTrace = (lines = []) =>
  lines
    .map((line) => String(line ?? '').trim())
    .filter(Boolean)

const buildWorkflowPolicyTestAuditResourceId = (draft = {}, requestId = '') => {
  const seed = [
    String(draft?.key ?? '').trim().toLowerCase(),
    String(draft?.stableId ?? '').trim().toLowerCase(),
    String(requestId ?? '').trim().toLowerCase(),
    String(draft?.name ?? '').trim().toLowerCase(),
  ].find(Boolean)

  if (!seed) {
    return new mongoose.Types.ObjectId()
  }

  const digest = crypto
    .createHash('sha256')
    .update(`${WORKFLOW_POLICY_TEST_AUDIT_RESOURCE_PREFIX}:${seed}`)
    .digest('hex')

  return new mongoose.Types.ObjectId(digest.slice(0, 24))
}

const selectWorkflowPolicyTestAgent = async ({
  workflowPolicy,
  frameworkKeys = [],
}) => {
  const decisionMode = String(workflowPolicy?.decisionMode ?? '').trim().toUpperCase()
  const policyType = String(workflowPolicy?.policyType ?? '').trim().toUpperCase()
  const routingMode = String(workflowPolicy?.routingMode ?? '').trim().toUpperCase()
  const requiresRouting =
    decisionMode === WORKFLOW_POLICY_DECISION_MODES.REQUIRE_AGENT_EVALUATION
    || policyType === 'ROUTING'

  if (!requiresRouting) {
    return {
      requiresRouting: false,
      chosenAgent: null,
      warnings: [],
    }
  }

  const candidateAgentIds = [
    ...new Set([
      String(workflowPolicy?.primaryAgentId ?? '').trim().toLowerCase(),
      String(workflowPolicy?.fallbackAgentId ?? '').trim().toLowerCase(),
      ...(Array.isArray(workflowPolicy?.requiredAgentIds) ? workflowPolicy.requiredAgentIds : []),
    ].filter(Boolean)),
  ]

  if (candidateAgentIds.length === 0) {
    return {
      requiresRouting: true,
      chosenAgent: null,
      warnings: ['This policy requires routing but no governed test agents are configured.'],
    }
  }

  const agents = await RuntimeAgent.find({
    stableId: { $in: candidateAgentIds },
  })
    .select('stableId key name status supportedFrameworkKeys')
    .lean()

  const activeCompatibleAgents = (Array.isArray(agents) ? agents : []).filter((agent) => {
    const status = String(agent?.status ?? '').trim().toUpperCase()
    if (status !== RUNTIME_AGENT_STATUSES.ACTIVE) return false

    const supportedFrameworkKeys = Array.isArray(agent?.supportedFrameworkKeys)
      ? agent.supportedFrameworkKeys
      : []

    return frameworkKeys.every((frameworkKey) => supportedFrameworkKeys.includes(frameworkKey))
  })

  const primaryAgentId = String(workflowPolicy?.primaryAgentId ?? '').trim().toLowerCase()
  const fallbackAgentId = String(workflowPolicy?.fallbackAgentId ?? '').trim().toLowerCase()
  const findCandidate = (stableId) =>
    activeCompatibleAgents.find((agent) => String(agent?.stableId ?? '').trim().toLowerCase() === stableId)

  let chosenAgent = null

  if (routingMode === WORKFLOW_POLICY_ROUTING_MODES.FIXED_AGENT) {
    chosenAgent = findCandidate(primaryAgentId) ?? findCandidate(fallbackAgentId) ?? null
  } else if (routingMode === WORKFLOW_POLICY_ROUTING_MODES.FIRST_COMPATIBLE_ACTIVE_AGENT) {
    chosenAgent = activeCompatibleAgents[0] ?? null
  } else {
    chosenAgent = findCandidate(primaryAgentId) ?? activeCompatibleAgents[0] ?? findCandidate(fallbackAgentId) ?? null
  }

  const warnings = []

  if (!chosenAgent) {
    warnings.push('No ACTIVE compatible Agent could be selected for this test run.')
  } else if (
    fallbackAgentId
    && String(chosenAgent?.stableId ?? '').trim().toLowerCase() === fallbackAgentId
  ) {
    warnings.push(`Fallback Agent "${chosenAgent.key}" was selected for this test run.`)
  }

  return {
    requiresRouting: true,
    chosenAgent: chosenAgent ? serializeRuntimeDependencyReference(chosenAgent) : null,
    warnings,
  }
}

const validateWorkflowPolicyRouting = async ({
  status,
  policyType,
  decisionMode,
  frameworkKeys,
  routingMode,
  primaryAgentId,
  fallbackAgentId,
}) => {
  const details = {}
  const normalizedRoutingMode = String(routingMode ?? '').trim().toUpperCase()
  const normalizedPrimaryAgentId = String(primaryAgentId ?? '').trim().toLowerCase()
  const normalizedFallbackAgentId = String(fallbackAgentId ?? '').trim().toLowerCase()
  const requiresRouting =
    decisionMode === 'REQUIRE_AGENT_EVALUATION'
    || String(policyType ?? '').trim().toUpperCase() === 'ROUTING'

  if (requiresRouting && !normalizedRoutingMode) {
    details.routingMode = 'Routing Mode is required when this policy routes execution.'
  }

  if (
    ROUTING_MODES_REQUIRING_PRIMARY_AGENT.has(normalizedRoutingMode)
    && !normalizedPrimaryAgentId
  ) {
    details.primaryAgentId = 'Primary Agent is required for the selected routing mode.'
  }

  if (normalizedFallbackAgentId && !normalizedPrimaryAgentId) {
    details.fallbackAgentId = 'Choose a Primary Agent before setting a Fallback Agent.'
  }

  const routingAgentIds = [
    ...new Set([normalizedPrimaryAgentId, normalizedFallbackAgentId].filter(Boolean)),
  ]

  if (routingAgentIds.length === 0) {
    return details
  }

  const routingAgents = await RuntimeAgent.find({ stableId: { $in: routingAgentIds } })
    .select('stableId status supportedFrameworkKeys executionPlan inputContract outputContract')
    .lean()
  const routingAgentById = new Map(routingAgents.map((agent) => [agent.stableId, agent]))

  const firstMissingAgentId = routingAgentIds.find((agentId) => !routingAgentById.has(agentId))
  if (firstMissingAgentId) {
    const field = firstMissingAgentId === normalizedPrimaryAgentId ? 'primaryAgentId' : 'fallbackAgentId'
    details[field] = `Unknown runtime agent id "${firstMissingAgentId}".`
    return details
  }

  for (const agentId of routingAgentIds) {
    const agent = routingAgentById.get(agentId)
    const unsupportedFrameworkKey = findUnsupportedFrameworkKey(
      agent?.supportedFrameworkKeys,
      frameworkKeys,
    )

    if (unsupportedFrameworkKey) {
      const field = agentId === normalizedPrimaryAgentId ? 'primaryAgentId' : 'fallbackAgentId'
      details[field] =
        `Runtime agent "${agentId}" does not support framework key "${unsupportedFrameworkKey}".`
      return details
    }

    if (status === WORKFLOW_POLICY_STATUSES.ACTIVE && agent?.status !== RUNTIME_AGENT_STATUSES.ACTIVE) {
      const field = agentId === normalizedPrimaryAgentId ? 'primaryAgentId' : 'fallbackAgentId'
      details[field] = `Active workflow policies require ACTIVE runtime agent "${agentId}".`
      return details
    }
  }

  return details
}

const validateWorkflowPolicyReferences = async ({
  policyType,
  priority,
  frameworkKeys,
  triggerEvent,
  triggerMode,
  governedAction,
  decisionMode,
  executionType,
  steps,
  severity,
  conditions,
  routingMode,
  primaryAgentId,
  fallbackAgentId,
  timeoutMs,
  orderedSteps,
  requiredAgentIds,
  requiredSkillIds,
  requiredValidationKeys,
  validationFreshnessMinutes,
  onPassEffects,
  onFailEffects,
  overrideAllowed,
  overrideRoles,
  approvalRequired,
  escalationRoleKey,
  escalationMessage,
  slaMinutes,
  status,
}, { previousRequiredValidationKeys = [] } = {}) => {
  const details = {}
  const normalizedFrameworkKeys = normalizeFrameworkKeyList(frameworkKeys)
  const normalizedSteps = normalizeWorkflowStepRows(steps)
  const derivedExecutionFields = deriveWorkflowPolicyExecutionFields({
    steps: normalizedSteps,
    primaryAgentId,
    fallbackAgentId,
    orderedSteps,
    requiredAgentIds,
    requiredSkillIds,
  })
  const normalizedOrderedSteps = derivedExecutionFields.orderedSteps
  const normalizedRequiredAgentIds = derivedExecutionFields.requiredAgentIds
  const normalizedRequiredSkillIds = derivedExecutionFields.requiredSkillIds
  const stepAgentIds = normalizedSteps.map((step) => step.agentId).filter(Boolean)
  const stepSkillIds = normalizedSteps.map((step) => step.skillId).filter(Boolean)
  const normalizedRequiredValidationKeys = Array.isArray(requiredValidationKeys) ? requiredValidationKeys : []
  const normalizedPreviousValidationKeys = Array.isArray(previousRequiredValidationKeys) ? previousRequiredValidationKeys : []
  const normalizedOverrideRoles = Array.isArray(overrideRoles) ? overrideRoles : []
  const normalizedEscalationRoleKey = normalizeEscalationRoleKey(escalationRoleKey)
  const requiresActiveFrameworks = status === WORKFLOW_POLICY_STATUSES.ACTIVE
  const { missingKeys, inactiveKeys } = await resolveKnownFrameworkKeys(
    normalizedFrameworkKeys,
    undefined,
    { requireActive: requiresActiveFrameworks },
  )

  if (missingKeys.length > 0) {
    details.frameworkKeys = buildUnknownFrameworkKeyMessage(missingKeys)
    return details
  }

  if (inactiveKeys.length > 0) {
    details.frameworkKeys = buildInactiveFrameworkKeyMessage(inactiveKeys)
  }

  if (!policyType) {
    details.policyType = 'Workflow policy type is required.'
  }

  if (!Number.isInteger(Number(priority)) || Number(priority) < 1) {
    details.priority = 'Workflow policy priority must be a positive integer.'
  }

  if (!triggerEvent) {
    details.triggerEvent = 'Workflow policy trigger event is required.'
  }

  if (!governedAction) {
    details.governedAction = 'Workflow policy governed action is required.'
  }

  if (
    timeoutMs !== undefined
    && timeoutMs !== null
    && (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) < 1 || Number(timeoutMs) > 300000)
  ) {
    details.timeoutMs = 'Timeout Override must be between 1 and 300000 milliseconds.'
  }

  if (
    String(policyType ?? '').trim().toUpperCase() === WORKFLOW_POLICY_TYPES.LIFECYCLE_GATE
    && approvalRequired === true
    && String(severity ?? '').trim().toUpperCase() === WORKFLOW_POLICY_SEVERITIES.INFO
  ) {
    details.severity = 'Approval-required lifecycle gates must use WARNING, CRITICAL, or BLOCKING severity.'
  }

  if (
    String(executionType ?? '').trim().toUpperCase() === WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP
    && normalizedSteps.length === 0
    && String(decisionMode ?? '').trim().toUpperCase() !== WORKFLOW_POLICY_DECISION_MODES.ALLOW
  ) {
    details.steps = 'Single-step policies without governed steps are only allowed for ALLOW decisions.'
  }

  const stepMessage = getWorkflowStepValidationMessage(normalizedFrameworkKeys, normalizedOrderedSteps)

  if (stepMessage) {
    details.orderedSteps = stepMessage
  }

  const conditionDetails = await validateWorkflowPolicyConditions({
    conditions,
    frameworkKeys: normalizedFrameworkKeys,
  })
  Object.assign(details, conditionDetails)

  const stepDetails = await validateWorkflowPolicySteps({
    executionType,
    steps: normalizedSteps,
    frameworkKeys: normalizedFrameworkKeys,
  })
  Object.assign(details, stepDetails)

  const routingDetails = await validateWorkflowPolicyRouting({
    status,
    policyType,
    decisionMode,
    frameworkKeys: normalizedFrameworkKeys,
    routingMode,
    primaryAgentId,
    fallbackAgentId,
  })
  Object.assign(details, routingDetails)

  const [passEffectDetails, failEffectDetails] = await Promise.all([
    validateWorkflowPolicyEffects({
      label: 'onPassEffects',
      effects: onPassEffects,
      frameworkKeys: normalizedFrameworkKeys,
    }),
    validateWorkflowPolicyEffects({
      label: 'onFailEffects',
      effects: onFailEffects,
      frameworkKeys: normalizedFrameworkKeys,
    }),
  ])
  Object.assign(details, passEffectDetails, failEffectDetails)

  const duplicateValidationKey = normalizedRequiredValidationKeys.find(
    (value, index) => normalizedRequiredValidationKeys.indexOf(value) !== index,
  )
  if (duplicateValidationKey) {
    details.requiredValidationKeys = `Duplicate validation key "${duplicateValidationKey}" is not allowed.`
  }

  if (!details.requiredValidationKeys && normalizedRequiredValidationKeys.length > 0) {
    const uniqueValidationKeys = [...new Set(
      normalizedRequiredValidationKeys
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    )]
    const previousKeySet = new Set(
      normalizedPreviousValidationKeys
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    )
    const addedKeys = uniqueValidationKeys.filter((key) => !previousKeySet.has(key))

    const rows = await ValidationRegistry.find({ key: { $in: uniqueValidationKeys } })
      .select('key status supportedFrameworkKeys policyUsable')
      .lean()
    const byKey = new Map(rows.map((row) => [String(row.key || '').trim().toLowerCase(), row]))

    const missingAddedValidationKeys = addedKeys.filter((key) => !byKey.has(key))
    if (missingAddedValidationKeys.length > 0) {
      details.requiredValidationKeys =
        `Unknown validation key${missingAddedValidationKeys.length === 1 ? '' : 's'}: ${missingAddedValidationKeys.join(', ')}.`
    } else {
      const incompatibleAddedKey = addedKeys.find((key) => {
        const row = byKey.get(key)
        if (!row) return false
        const supported = Array.isArray(row?.supportedFrameworkKeys)
          ? row.supportedFrameworkKeys.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
          : []
        return normalizedFrameworkKeys.some((frameworkKey) => !supported.includes(frameworkKey))
      })

      if (incompatibleAddedKey) {
        details.requiredValidationKeys = `Validation key "${incompatibleAddedKey}" is not compatible with the selected frameworks.`
      } else {
        const nonUsable = addedKeys.find((key) => {
          const row = byKey.get(key)
          return row && row.policyUsable === false
        })

        if (nonUsable) {
          details.requiredValidationKeys = `Validation key "${nonUsable}" is not available for Workflow Policies.`
        } else {
          const nonActive = addedKeys.find((key) => {
            const row = byKey.get(key)
            const rowStatus = String(row?.status || '').trim().toUpperCase()
            return rowStatus !== VALIDATION_REGISTRY_STATUSES.ACTIVE
          })

          if (nonActive) {
            details.requiredValidationKeys = `Validation key "${nonActive}" is not ACTIVE and cannot be newly assigned.`
          }
        }
      }
    }
  }

  if (
    validationFreshnessMinutes !== undefined
    && (!Number.isInteger(Number(validationFreshnessMinutes)) || Number(validationFreshnessMinutes) < 0)
  ) {
    details.validationFreshnessMinutes = 'Validation freshness must be zero or a positive whole number.'
  }

  if (overrideAllowed && normalizedOverrideRoles.length === 0) {
    details.overrideRoles = 'Select at least one override role when overrides are allowed.'
  }

  if (approvalRequired && !overrideAllowed) {
    details.approvalRequired = 'Approval Required can only be enabled when overrides are allowed.'
  }

  if (approvalRequired && !normalizedEscalationRoleKey) {
    details.escalationRoleKey = 'Escalation Role is required when approval is required.'
  }

  if (String(escalationMessage ?? '').trim().length > 500) {
    details.escalationMessage = 'Escalation message must be 500 characters or fewer.'
  }

  if (slaMinutes !== undefined && (!Number.isInteger(Number(slaMinutes)) || Number(slaMinutes) < 0)) {
    details.slaMinutes = 'SLA Minutes must be zero or a positive whole number.'
  } else if (approvalRequired && Number(slaMinutes) < 1) {
    details.slaMinutes = 'Approval-required escalation must use at least 1 SLA minute.'
  }

  const { agents, skills } = await fetchRegistryReferences({
    requiredAgentIds: [...new Set([...normalizedRequiredAgentIds, ...stepAgentIds])],
    requiredSkillIds: [...new Set([...normalizedRequiredSkillIds, ...stepSkillIds])],
  })

  const agentById = new Map(agents.map((agent) => [agent.stableId, agent]))
  const skillById = new Map(skills.map((skill) => [skill.stableId, skill]))
  const combinedAgentIds = [...new Set([...normalizedRequiredAgentIds, ...stepAgentIds])]
  const combinedSkillIds = [...new Set([...normalizedRequiredSkillIds, ...stepSkillIds])]

  const missingAgentIds = combinedAgentIds.filter((agentId) => !agentById.has(agentId))
  if (missingAgentIds.length > 0) {
    details.requiredAgentIds = `Unknown runtime agent ids: ${missingAgentIds.join(', ')}.`
  }

  const missingSkillIds = combinedSkillIds.filter((skillId) => !skillById.has(skillId))
  if (missingSkillIds.length > 0) {
    details.requiredSkillIds = `Unknown runtime skill ids: ${missingSkillIds.join(', ')}.`
  }

  if (!details.requiredAgentIds) {
    for (const agentId of combinedAgentIds) {
      const agent = agentById.get(agentId)
      const unsupportedFrameworkKey = findUnsupportedFrameworkKey(
        agent?.supportedFrameworkKeys,
        normalizedFrameworkKeys,
      )

      if (unsupportedFrameworkKey) {
        details.requiredAgentIds =
          `Runtime agent "${agentId}" does not support framework key "${unsupportedFrameworkKey}".`
        break
      }
    }
  }

  if (!details.requiredSkillIds) {
    for (const skillId of combinedSkillIds) {
      const skill = skillById.get(skillId)
      const unsupportedFrameworkKey = findUnsupportedFrameworkKey(
        skill?.supportedFrameworkKeys,
        normalizedFrameworkKeys,
      )

      if (unsupportedFrameworkKey) {
        details.requiredSkillIds =
          `Runtime skill "${skillId}" does not support framework key "${unsupportedFrameworkKey}".`
        break
      }
    }
  }

  if (
    status === WORKFLOW_POLICY_STATUSES.ACTIVE
    && !details.requiredAgentIds
    && combinedAgentIds.length === 1
  ) {
    const onlyAgent = agentById.get(combinedAgentIds[0])
    if (onlyAgent?.status !== RUNTIME_AGENT_STATUSES.ACTIVE) {
      details.requiredAgentIds =
        `Active workflow policies cannot depend on only inactive runtime agent "${combinedAgentIds[0]}".`
    }
  }

  if (
    status === WORKFLOW_POLICY_STATUSES.ACTIVE
    && !details.requiredSkillIds
    && combinedSkillIds.length === 1
  ) {
    const onlySkill = skillById.get(combinedSkillIds[0])
    if (onlySkill?.status !== RUNTIME_SKILL_STATUSES.ACTIVE) {
      details.requiredSkillIds =
        `Active workflow policies cannot depend on only inactive runtime skill "${combinedSkillIds[0]}".`
    }
  }

  return details
}

export const listWorkflowPolicies = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await WorkflowPolicy.countDocuments(filter).maxTimeMS(3000)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await WorkflowPolicy.find(filter)
      .maxTimeMS(3000)
      .sort({ status: 1, updatedAt: -1, key: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeWorkflowPolicy(item)),
      meta: {
        page: normalizedPage,
        pageSize: limit,
        total,
        totalPages,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const createWorkflowPolicy = async (req, res, next) => {
  try {
    const body = pickWorkflowPolicyPayload(req.body)
    const normalizedBody = {
      ...body,
      ...(body.timeoutMs !== undefined ? { timeoutMs: normalizeWorkflowPolicyTimeoutMs(body.timeoutMs) } : {}),
      ...(body.conditions !== undefined ? { conditions: normalizeConditionRows(body.conditions) } : {}),
      ...(body.onPassEffects !== undefined ? { onPassEffects: normalizeEffectRows(body.onPassEffects) } : {}),
      ...(body.onFailEffects !== undefined ? { onFailEffects: normalizeEffectRows(body.onFailEffects) } : {}),
      ...(body.steps !== undefined ? { steps: normalizeWorkflowStepRows(body.steps) } : {}),
    }
    Object.assign(normalizedBody, deriveWorkflowPolicyExecutionFields(normalizedBody), { gatingRules: [] })
    const existingWorkflowPolicy = await WorkflowPolicy.findOne({
      key: body.key,
    }).select('_id')

    if (existingWorkflowPolicy) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    const validationDetails = await validateWorkflowPolicyReferences(normalizedBody, { previousRequiredValidationKeys: [] })
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const actorUserId = req.context?.userId || req.userId
    const workflowPolicy = new WorkflowPolicy({
      ...normalizedBody,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    if (workflowPolicy.status === WORKFLOW_POLICY_STATUSES.ACTIVE && !workflowPolicy.lastActivatedAt) {
      workflowPolicy.lastActivatedAt = new Date()
    }

    await workflowPolicy.save()
    await populateWorkflowPolicy(workflowPolicy)

    const serializedWorkflowPolicy = serializeWorkflowPolicy(workflowPolicy, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_CREATED,
      resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
      resourceId: workflowPolicy._id,
      scope: {
        frameworkKeys: workflowPolicy.frameworkKeys,
      },
      display: { resourceLabel: buildWorkflowPolicyLabel(workflowPolicy) },
      diff: {
        id: workflowPolicy.stableId,
        key: workflowPolicy.key,
        name: workflowPolicy.name,
        description: workflowPolicy.description,
        status: workflowPolicy.status,
        policyType: workflowPolicy.policyType,
        priority: workflowPolicy.priority,
        frameworkKeys: workflowPolicy.frameworkKeys,
        appliesTo: workflowPolicy.appliesTo,
        triggerEvent: workflowPolicy.triggerEvent,
        triggerMode: workflowPolicy.triggerMode,
        actorScope: workflowPolicy.actorScope,
        cooldownSeconds: workflowPolicy.cooldownSeconds,
        reevaluateOnRetry: workflowPolicy.reevaluateOnRetry,
        governedAction: workflowPolicy.governedAction,
        decisionMode: workflowPolicy.decisionMode,
        executionType: workflowPolicy.executionType,
        steps: workflowPolicy.steps,
        passMessage: workflowPolicy.passMessage,
        failMessage: workflowPolicy.failMessage,
        severity: workflowPolicy.severity,
        conditions: workflowPolicy.conditions,
        routingMode: workflowPolicy.routingMode,
        primaryAgentId: workflowPolicy.primaryAgentId,
        fallbackAgentId: workflowPolicy.fallbackAgentId,
        timeoutMs: workflowPolicy.timeoutMs,
        retryOverride: workflowPolicy.retryOverride,
        requireSuccess: workflowPolicy.requireSuccess,
        requiredValidationKeys: workflowPolicy.requiredValidationKeys,
        validationBlockingOnFail: workflowPolicy.validationBlockingOnFail,
        validationWarningOnly: workflowPolicy.validationWarningOnly,
        validationFreshnessMinutes: workflowPolicy.validationFreshnessMinutes,
        validationRequireLatestRun: workflowPolicy.validationRequireLatestRun,
        onPassEffects: workflowPolicy.onPassEffects,
        onFailEffects: workflowPolicy.onFailEffects,
        overrideAllowed: workflowPolicy.overrideAllowed,
        overrideRoles: workflowPolicy.overrideRoles,
        approvalRequired: workflowPolicy.approvalRequired,
        escalationRoleKey: workflowPolicy.escalationRoleKey,
        escalationMessage: workflowPolicy.escalationMessage,
        slaMinutes: workflowPolicy.slaMinutes,
        orderedSteps: workflowPolicy.orderedSteps,
        requiredAgentIds: workflowPolicy.requiredAgentIds,
        requiredSkillIds: workflowPolicy.requiredSkillIds,
        version: workflowPolicy.version,
        lastActivatedAt: workflowPolicy.lastActivatedAt,
      },
    })

    return res.status(201).json({
      data: serializedWorkflowPolicy,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateWorkflowPolicyKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

export const getWorkflowPolicy = async (req, res, next) => {
  try {
    const workflowPolicy = await WorkflowPolicy.findOne(buildWorkflowPolicyIdentityFilter(req.params.policyId))

    if (!workflowPolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateWorkflowPolicy(workflowPolicy)

    return res.status(200).json({
      data: serializeWorkflowPolicy(workflowPolicy),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getWorkflowPolicyDependencies = async (req, res, next) => {
  try {
    const workflowPolicy = await WorkflowPolicy.findOne(buildWorkflowPolicyIdentityFilter(req.params.policyId))
      .select([
        '_id',
        'stableId',
        'key',
        'name',
        'status',
        'priority',
        'frameworkKeys',
        'triggerEvent',
        'governedAction',
        'conditions',
        'steps',
        'primaryAgentId',
        'fallbackAgentId',
        'requiredAgentIds',
        'requiredSkillIds',
        'requiredValidationKeys',
        'onPassEffects',
        'onFailEffects',
      ].join(' '))
      .lean()

    if (!workflowPolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const dependencies = await fetchWorkflowPolicyDependencies(workflowPolicy)
    const summary = buildWorkflowPolicyDependencySummary(dependencies)

    return res.status(200).json({
      data: {
        policyId: workflowPolicy.stableId || buildWorkflowPolicyStableId(workflowPolicy.key),
        referencedBy: {
          frameworkPackages: dependencies.referencedBy.frameworkPackages.map(serializeFrameworkPackageDependencyReference),
          workflowPolicies: dependencies.referencedBy.workflowPolicies.map(serializeRuntimeDependencyReference),
          scheduledJobs: dependencies.referencedBy.scheduledJobs,
        },
        uses: {
          agents: dependencies.uses.agents.map(serializeRuntimeDependencyReference),
          skills: dependencies.uses.skills.map(serializeRuntimeDependencyReference),
          frameworks: dependencies.uses.frameworks.map(serializeWorkflowFrameworkReference),
          validationOutputs: dependencies.uses.validationOutputs.map(serializeWorkflowValidationReference),
          runtimePaths: dependencies.uses.runtimePaths.map(serializeWorkflowRuntimePathReference),
        },
        collisions: dependencies.collisions.map(serializeRuntimeDependencyReference),
        ...summary,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const cloneWorkflowPolicy = async (req, res, next) => {
  try {
    const sourcePolicy = await WorkflowPolicy.findOne(buildWorkflowPolicyIdentityFilter(req.params.policyId))

    if (!sourcePolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const nextKey = String(req.body?.key || '').trim().toLowerCase()
    const duplicateWorkflowPolicy = await WorkflowPolicy.findOne({ key: nextKey }).select('_id')
    if (duplicateWorkflowPolicy) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const sourcePlain = typeof sourcePolicy.toObject === 'function'
      ? sourcePolicy.toObject()
      : { ...sourcePolicy }
    const sourceStableId = normalizeWorkflowPolicyStableId(
      sourcePolicy.stableId
        || sourcePlain.stableId
        || buildWorkflowPolicyStableId(sourcePolicy.key || sourcePlain.key),
    )
    const nextName = String(req.body?.name || '').trim() || `${sourcePolicy.name || sourcePolicy.key} Clone`
    const nextDescription = req.body?.description === undefined
      ? sourcePolicy.description
      : req.body.description
    delete sourcePlain._id
    delete sourcePlain.id
    delete sourcePlain.__v
    delete sourcePlain.stableId

    const clonedPolicy = new WorkflowPolicy({
      ...sourcePlain,
      key: nextKey,
      name: nextName,
      description: nextDescription,
      status: WORKFLOW_POLICY_STATUSES.DRAFT,
      timeoutMs: normalizeWorkflowPolicyTimeoutMs(sourcePlain.timeoutMs),
      version: Number(sourcePolicy.version || 1) + 1,
      lastActivatedAt: null,
      componentVersion: Number(sourcePolicy.componentVersion || 1) + 1,
      versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
      lineageId: sourcePolicy.lineageId || sourceStableId,
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockedReason: null,
      lockedByPackageKeys: [],
      ...deriveWorkflowPolicyExecutionFields(sourcePlain),
      gatingRules: [],
      clonedFromStableId: sourceStableId,
      supersedesStableId: sourceStableId,
      supersededByStableId: null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await clonedPolicy.save()
    await WorkflowPolicy.updateOne(
      buildWorkflowPolicyIdentityFilter(sourceStableId),
      { $set: { supersededByStableId: clonedPolicy.stableId } },
      { runValidators: false },
    )
    await populateWorkflowPolicy(clonedPolicy)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_CLONED,
      resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
      resourceId: clonedPolicy._id,
      scope: {
        frameworkKeys: clonedPolicy.frameworkKeys,
      },
      display: { resourceLabel: buildWorkflowPolicyLabel(clonedPolicy) },
      diff: {
        clonedFromStableId: sourceStableId,
        supersedesStableId: sourceStableId,
        key: clonedPolicy.key,
        status: clonedPolicy.status,
        componentVersion: clonedPolicy.componentVersion,
        versionStatus: clonedPolicy.versionStatus,
      },
    })

    return res.status(201).json({
      data: serializeWorkflowPolicy(clonedPolicy, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateWorkflowPolicyKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

export const testWorkflowPolicy = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : null
    const frameworkState =
      body.frameworkState && typeof body.frameworkState === 'object' && !Array.isArray(body.frameworkState)
        ? body.frameworkState
        : {}

    if (!draft) {
      return sendValidationFailed(res, req, {
        draft: 'Workflow policy draft payload is required for test console runs.',
      }, 'Workflow policy test failed.')
    }

    const validationDetails = await validateWorkflowPolicyReferences(draft, { previousRequiredValidationKeys: [] })
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails, 'Workflow policy test failed.')
    }

    const resolvedTriggerEvent = String(body.triggerEvent ?? draft.triggerEvent ?? '').trim().toUpperCase()
    const resolvedActorScope = String(body.actorScope ?? draft.actorScope ?? '').trim().toUpperCase()
    const policyTriggerEvent = String(draft.triggerEvent ?? '').trim().toUpperCase()
    const policyActorScope = String(draft.actorScope ?? '').trim().toUpperCase()
    const trace = [
      `Evaluating policy "${draft.name || draft.key}" for governed action "${draft.governedAction}".`,
      `Resolved trigger event: ${resolvedTriggerEvent || '--'}.`,
      `Resolved actor scope: ${resolvedActorScope || '--'}.`,
    ]

    const triggerMatched = resolvedTriggerEvent === policyTriggerEvent
    const actorMatched =
      policyActorScope === WORKFLOW_POLICY_ACTOR_SCOPES.ANY
      || resolvedActorScope === policyActorScope
    const conditionEvaluation = evaluateWorkflowPolicyConditionsAgainstState({
      conditions: draft.conditions,
      frameworkState,
    })

    if (!triggerMatched) {
      trace.push(`Trigger mismatch: policy expects "${policyTriggerEvent}" but test input resolved "${resolvedTriggerEvent}".`)
    }
    if (!actorMatched) {
      trace.push(`Actor scope mismatch: policy expects "${policyActorScope}" but test input resolved "${resolvedActorScope}".`)
    }
    if (conditionEvaluation.conditionResults.length > 0) {
      trace.push(
        `Evaluated ${conditionEvaluation.conditionResults.length} governed condition row${conditionEvaluation.conditionResults.length === 1 ? '' : 's'}.`,
      )
    } else {
      trace.push('No governed conditions are configured, so the condition phase passed automatically.')
    }

    let outcome = triggerMatched && actorMatched && conditionEvaluation.allMatched ? 'PASS' : 'FAIL'

    const agentSelection = await selectWorkflowPolicyTestAgent({
      workflowPolicy: draft,
      frameworkKeys: normalizeFrameworkKeyList(draft.frameworkKeys),
    })

    if (agentSelection.requiresRouting) {
      if (outcome === 'PASS' && agentSelection.chosenAgent) {
        trace.push(`Selected governed Agent "${agentSelection.chosenAgent.key}" for routed execution.`)
      } else if (outcome === 'PASS') {
        trace.push('Routing is required but no ACTIVE compatible Agent could be selected.')
        outcome = 'FAIL'
      } else {
        trace.push('Routing preview skipped because the policy did not reach a passing state.')
      }
    }

    const selectedEffects = outcome === 'PASS'
      ? normalizeEffectRows(draft.onPassEffects)
      : normalizeEffectRows(draft.onFailEffects)

    trace.push(
      `Selected ${selectedEffects.length} ${outcome === 'PASS' ? 'pass' : 'fail'} effect row${selectedEffects.length === 1 ? '' : 's'} for preview.`,
    )

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_TESTED,
      resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
      // Test-console runs can target unsaved drafts, but AuditLog requires an ObjectId resourceId.
      resourceId: buildWorkflowPolicyTestAuditResourceId(draft, req.requestId),
      scope: {
        frameworkKeys: normalizeFrameworkKeyList(draft.frameworkKeys),
      },
      display: { resourceLabel: buildWorkflowPolicyLabel(draft) || draft.key || 'Workflow Policy Draft' },
      diff: {
        key: draft.key,
        name: draft.name,
        outcome,
        triggerMatched,
        actorMatched,
        conditionsMatched: conditionEvaluation.allMatched,
        chosenAgentId: agentSelection.chosenAgent?.id || null,
        matchedConditionCount: conditionEvaluation.conditionResults.filter((result) => result.matched).length,
        effectCount: selectedEffects.length,
      },
    })

    return res.status(200).json({
      data: {
        ok: true,
        outcome,
        triggerMatched,
        actorMatched,
        conditionsMatched: conditionEvaluation.allMatched,
        matchedConditions: conditionEvaluation.conditionResults,
        chosenAgent: agentSelection.chosenAgent,
        stateEffectsPreview: {
          outcome,
          effects: selectedEffects,
        },
        executionTrace: serializeWorkflowPolicyTestTrace(trace),
        warnings: agentSelection.warnings,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateWorkflowPolicy = async (req, res, next) => {
  try {
    const body = pickWorkflowPolicyPayload(req.body)
    const workflowPolicy = await WorkflowPolicy.findOne(buildWorkflowPolicyIdentityFilter(req.params.policyId))

    if (!workflowPolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (workflowPolicy.isLocked === true) {
      return sendConflict(res, req, LOCKED_RUNTIME_CONTROL_EDIT_MESSAGE, {
        field: 'isLocked',
        reason: 'WORKFLOW_POLICY_LOCKED',
        lockedByPackageKeys: Array.isArray(workflowPolicy.lockedByPackageKeys)
          ? workflowPolicy.lockedByPackageKeys
          : [],
      })
    }

    if (
      body.key !== undefined
      && String(body.key).trim().toLowerCase() !== String(workflowPolicy.key ?? '').trim().toLowerCase()
    ) {
      return sendValidationFailed(res, req, {
        key: 'Workflow policy key is immutable after creation.',
      })
    }

    const nextKey = body.key ?? workflowPolicy.key
    const duplicateWorkflowPolicy = await WorkflowPolicy.findOne({
      _id: { $ne: workflowPolicy._id },
      key: nextKey,
    }).select('_id')

    if (duplicateWorkflowPolicy) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    const hasSubmittedTimeoutMs = Object.prototype.hasOwnProperty.call(body, 'timeoutMs')
    const nextWorkflowPolicy = {
      key: body.key ?? workflowPolicy.key,
      name: body.name ?? workflowPolicy.name,
      description: body.description ?? workflowPolicy.description,
      status: body.status ?? getWorkflowPolicyFieldValue(workflowPolicy, 'status'),
      policyType: body.policyType ?? getWorkflowPolicyFieldValue(workflowPolicy, 'policyType'),
      priority: body.priority ?? getWorkflowPolicyFieldValue(workflowPolicy, 'priority'),
      frameworkKeys: body.frameworkKeys ?? getWorkflowPolicyFieldValue(workflowPolicy, 'frameworkKeys'),
      appliesTo: body.appliesTo ?? getWorkflowPolicyFieldValue(workflowPolicy, 'appliesTo'),
      triggerEvent: body.triggerEvent ?? getWorkflowPolicyFieldValue(workflowPolicy, 'triggerEvent'),
      triggerMode: body.triggerMode ?? getWorkflowPolicyFieldValue(workflowPolicy, 'triggerMode'),
      actorScope: body.actorScope ?? getWorkflowPolicyFieldValue(workflowPolicy, 'actorScope'),
      cooldownSeconds: body.cooldownSeconds ?? getWorkflowPolicyFieldValue(workflowPolicy, 'cooldownSeconds'),
      reevaluateOnRetry: body.reevaluateOnRetry ?? getWorkflowPolicyFieldValue(workflowPolicy, 'reevaluateOnRetry'),
      governedAction: body.governedAction ?? getWorkflowPolicyFieldValue(workflowPolicy, 'governedAction'),
      decisionMode: body.decisionMode ?? getWorkflowPolicyFieldValue(workflowPolicy, 'decisionMode'),
      executionType: body.executionType ?? getWorkflowPolicyFieldValue(workflowPolicy, 'executionType'),
      steps: body.steps !== undefined
        ? normalizeWorkflowStepRows(body.steps)
        : getWorkflowPolicyFieldValue(workflowPolicy, 'steps'),
      passMessage: body.passMessage ?? getWorkflowPolicyFieldValue(workflowPolicy, 'passMessage'),
      failMessage: body.failMessage ?? getWorkflowPolicyFieldValue(workflowPolicy, 'failMessage'),
      severity: body.severity ?? getWorkflowPolicyFieldValue(workflowPolicy, 'severity'),
      conditions: body.conditions !== undefined
        ? normalizeConditionRows(body.conditions)
        : getWorkflowPolicyFieldValue(workflowPolicy, 'conditions'),
      routingMode: body.routingMode ?? getWorkflowPolicyFieldValue(workflowPolicy, 'routingMode'),
      primaryAgentId: body.primaryAgentId ?? getWorkflowPolicyFieldValue(workflowPolicy, 'primaryAgentId'),
      fallbackAgentId: body.fallbackAgentId ?? getWorkflowPolicyFieldValue(workflowPolicy, 'fallbackAgentId'),
      timeoutMs: hasSubmittedTimeoutMs
        ? normalizeWorkflowPolicyTimeoutMs(body.timeoutMs)
        : getWorkflowPolicyFieldValue(workflowPolicy, 'timeoutMs'),
      retryOverride: body.retryOverride ?? getWorkflowPolicyFieldValue(workflowPolicy, 'retryOverride'),
      requireSuccess: body.requireSuccess ?? getWorkflowPolicyFieldValue(workflowPolicy, 'requireSuccess'),
      requiredValidationKeys: body.requiredValidationKeys ?? getWorkflowPolicyFieldValue(workflowPolicy, 'requiredValidationKeys'),
      validationBlockingOnFail: body.validationBlockingOnFail ?? getWorkflowPolicyFieldValue(workflowPolicy, 'validationBlockingOnFail'),
      validationWarningOnly: body.validationWarningOnly ?? getWorkflowPolicyFieldValue(workflowPolicy, 'validationWarningOnly'),
      validationFreshnessMinutes: body.validationFreshnessMinutes ?? getWorkflowPolicyFieldValue(workflowPolicy, 'validationFreshnessMinutes'),
      validationRequireLatestRun: body.validationRequireLatestRun ?? getWorkflowPolicyFieldValue(workflowPolicy, 'validationRequireLatestRun'),
      onPassEffects: body.onPassEffects !== undefined
        ? normalizeEffectRows(body.onPassEffects)
        : getWorkflowPolicyFieldValue(workflowPolicy, 'onPassEffects'),
      onFailEffects: body.onFailEffects !== undefined
        ? normalizeEffectRows(body.onFailEffects)
        : getWorkflowPolicyFieldValue(workflowPolicy, 'onFailEffects'),
      overrideAllowed: body.overrideAllowed ?? getWorkflowPolicyFieldValue(workflowPolicy, 'overrideAllowed'),
      overrideRoles: body.overrideRoles ?? getWorkflowPolicyFieldValue(workflowPolicy, 'overrideRoles'),
      approvalRequired: body.approvalRequired ?? getWorkflowPolicyFieldValue(workflowPolicy, 'approvalRequired'),
      escalationRoleKey: body.escalationRoleKey
        ?? (
          getWorkflowPolicyFieldValue(workflowPolicy, 'escalationRoleKey')
          || normalizeEscalationRoleKey(getWorkflowPolicyFieldValue(workflowPolicy, 'escalateTo'))
        ),
      escalationMessage: body.escalationMessage ?? getWorkflowPolicyFieldValue(workflowPolicy, 'escalationMessage'),
      slaMinutes: body.slaMinutes ?? getWorkflowPolicyFieldValue(workflowPolicy, 'slaMinutes'),
      orderedSteps: getWorkflowPolicyFieldValue(workflowPolicy, 'orderedSteps'),
      requiredAgentIds: getWorkflowPolicyFieldValue(workflowPolicy, 'requiredAgentIds'),
      requiredSkillIds: getWorkflowPolicyFieldValue(workflowPolicy, 'requiredSkillIds'),
      gatingRules: [],
    }
    Object.assign(nextWorkflowPolicy, deriveWorkflowPolicyExecutionFields(nextWorkflowPolicy))

    const validationDetails = await validateWorkflowPolicyReferences(nextWorkflowPolicy, {
      previousRequiredValidationKeys: workflowPolicy.requiredValidationKeys,
    })
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const diff = {}
    const originalStatus = String(workflowPolicy.status ?? '').trim().toUpperCase()
    const fieldsToApply = new Set(WORKFLOW_POLICY_MUTABLE_FIELDS.filter((field) => body[field] !== undefined))
    if (
      body.steps !== undefined
      || body.primaryAgentId !== undefined
      || body.fallbackAgentId !== undefined
      || body.executionType !== undefined
    ) {
      fieldsToApply.add('orderedSteps')
      fieldsToApply.add('requiredAgentIds')
      fieldsToApply.add('requiredSkillIds')
    }
    if (!isDeepStrictEqual(cloneAuditValue(workflowPolicy.timeoutMs), cloneAuditValue(nextWorkflowPolicy.timeoutMs))) {
      fieldsToApply.add('timeoutMs')
    }

    for (const field of WORKFLOW_POLICY_MUTABLE_FIELDS) {
      if (!fieldsToApply.has(field)) continue

      const previousValue = cloneAuditValue(workflowPolicy[field])
      const nextValue = cloneAuditValue(nextWorkflowPolicy[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      workflowPolicy[field] = nextWorkflowPolicy[field]
    }

    if (Object.keys(diff).length > 0) {
      const previousVersion = Number(workflowPolicy.version ?? 1)
      workflowPolicy.version = previousVersion + 1
      diff.version = {
        from: previousVersion,
        to: workflowPolicy.version,
      }

      const nextStatus = String(workflowPolicy.status ?? '').trim().toUpperCase()
      if (nextStatus === WORKFLOW_POLICY_STATUSES.ACTIVE && originalStatus !== WORKFLOW_POLICY_STATUSES.ACTIVE) {
        const previousLastActivatedAt = cloneAuditValue(workflowPolicy.lastActivatedAt)
        workflowPolicy.lastActivatedAt = new Date()
        diff.lastActivatedAt = {
          from: previousLastActivatedAt,
          to: workflowPolicy.lastActivatedAt,
        }
      }
    }

    workflowPolicy.updatedBy = req.context?.userId || req.userId
    await workflowPolicy.save()
    await populateWorkflowPolicy(workflowPolicy)

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
        resourceId: workflowPolicy._id,
        scope: {
          frameworkKeys: workflowPolicy.frameworkKeys,
        },
        display: { resourceLabel: buildWorkflowPolicyLabel(workflowPolicy) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeWorkflowPolicy(workflowPolicy, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateWorkflowPolicyKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}
