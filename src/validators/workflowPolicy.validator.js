import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  WORKFLOW_POLICY_ACTOR_SCOPES,
  WORKFLOW_POLICY_APPLIES_TO,
  WORKFLOW_POLICY_CONDITION_LOGIC,
  WORKFLOW_POLICY_CONDITION_OPERATORS,
  WORKFLOW_POLICY_DECISION_MODES,
  WORKFLOW_POLICY_DEFAULTS,
  WORKFLOW_POLICY_EFFECT_TYPES,
  WORKFLOW_POLICY_ESCALATION_ROLE_KEYS,
  WORKFLOW_POLICY_EXECUTION_TYPES,
  WORKFLOW_POLICY_GOVERNED_ACTIONS,
  WORKFLOW_POLICY_OVERRIDE_ROLES,
  WORKFLOW_POLICY_ROUTING_MODES,
  WORKFLOW_POLICY_SEVERITIES,
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_STEP_TYPES,
  WORKFLOW_POLICY_TRIGGER_EVENTS,
  WORKFLOW_POLICY_TRIGGER_MODES,
  WORKFLOW_POLICY_TYPES,
} from '../models/WorkflowPolicy.js'

const keyRegex = /^[a-z][a-z0-9-]*$/
const policyIdRegex = /^policy-[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/

const governedMetadataFieldSchema = (field) =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value === undefined) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${field} is server-managed governance metadata and cannot be edited directly.`,
    })
  })

const governedMetadataFieldsSchema = {
  componentVersion: governedMetadataFieldSchema('componentVersion'),
  versionStatus: governedMetadataFieldSchema('versionStatus'),
  stableId: governedMetadataFieldSchema('stableId'),
  lineageId: governedMetadataFieldSchema('lineageId'),
  isLocked: governedMetadataFieldSchema('isLocked'),
  lockedAt: governedMetadataFieldSchema('lockedAt'),
  lockedBy: governedMetadataFieldSchema('lockedBy'),
  lockedReason: governedMetadataFieldSchema('lockedReason'),
  lockedByPackageKeys: governedMetadataFieldSchema('lockedByPackageKeys'),
  clonedFromStableId: governedMetadataFieldSchema('clonedFromStableId'),
  supersedesStableId: governedMetadataFieldSchema('supersedesStableId'),
  supersededByStableId: governedMetadataFieldSchema('supersededByStableId'),
}

const deprecatedRuntimePolicyFieldSchema = (field) =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value === undefined) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${field} is deprecated. Use conditions and governed steps instead.`,
    })
  })

const frameworkKeySchema = z
  .string()
  .trim()
  .min(1, 'Framework key is required')
  .max(100, 'Framework key must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => frameworkKeyRegex.test(value),
    'Framework key must use uppercase letters, numbers, or underscores',
  )

const tokenSchema = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(120, `${label} must be 120 characters or fewer`)
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      `${label} must use lowercase letters, numbers, or hyphens`,
    )

const frameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one framework key is required.')
  .max(20, 'Framework keys must contain 20 items or fewer')
  .transform((values) => [...new Set(values)])

const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string().trim().min(1, 'Condition value entries must not be empty')),
])

const getJsonDepth = (value, depth = 0) => {
  if (!value || typeof value !== 'object') return depth
  if (depth > 8) return depth
  const values = Array.isArray(value) ? value : Object.values(value)
  return values.reduce((maxDepth, item) => Math.max(maxDepth, getJsonDepth(item, depth + 1)), depth)
}

const parametersSchema = z
  .record(z.string(), z.unknown())
  .default({})
  .superRefine((value, ctx) => {
    let serialized = ''
    try {
      serialized = JSON.stringify(value)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Step parameters must be JSON serializable.',
      })
      return
    }

    if (serialized.length > 4096) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Step parameters must be 4096 characters or fewer.',
      })
    }

    if (getJsonDepth(value) > 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Step parameters must not be nested more than 8 levels deep.',
      })
    }
  })

const workflowPolicyConditionSchema = z.object({
  path: z
    .string({ required_error: 'Condition path is required' })
    .trim()
    .min(1, 'Condition path is required')
    .max(200, 'Condition path must be 200 characters or fewer'),
  operator: z.enum(Object.values(WORKFLOW_POLICY_CONDITION_OPERATORS)),
  value: conditionValueSchema.optional().default(''),
  logic: z.enum(Object.values(WORKFLOW_POLICY_CONDITION_LOGIC)).optional(),
})

const workflowPolicyConditionsSchema = z
  .array(workflowPolicyConditionSchema)
  .max(50, 'Conditions must contain 50 rows or fewer')

const workflowPolicyEffectSchema = z.object({
  type: z.enum(Object.values(WORKFLOW_POLICY_EFFECT_TYPES)),
  targetPath: z
    .string()
    .trim()
    .max(200, 'Effect target path must be 200 characters or fewer')
    .optional()
    .default(''),
  value: conditionValueSchema.optional().default(''),
})

const workflowPolicyEffectsSchema = z
  .array(workflowPolicyEffectSchema)
  .max(50, 'Effects must contain 50 rows or fewer')

const optionalRuntimeControlIdSchema = (label) =>
  z
    .string()
    .trim()
    .max(120, `${label} must be 120 characters or fewer`)
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => !value || keyRegex.test(value),
      `${label} must use lowercase letters, numbers, or hyphens`,
    )

const timeoutMsSchema = z.union([
  z.null(),
  z.coerce.number().int().min(1).max(300000),
])

const workflowPolicyStepSchema = z.object({
  stepKey: tokenSchema('Step key'),
  type: z.enum(Object.values(WORKFLOW_POLICY_STEP_TYPES)),
  order: z.coerce.number().int().min(1).max(9999),
  bindingKeys: z.array(tokenSchema('Binding key')).max(50).default([]),
  targetPath: z.string().trim().max(200, 'Step target path must be 200 characters or fewer').default(''),
  value: conditionValueSchema.optional().default(''),
  agentId: optionalRuntimeControlIdSchema('Agent id').default(''),
  skillId: optionalRuntimeControlIdSchema('Skill id').default(''),
  eventKey: z
    .string()
    .trim()
    .max(120, 'Event key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => !value || keyRegex.test(value),
      'Event key must use lowercase letters, numbers, or hyphens',
    )
    .default(''),
  blocking: z.coerce.boolean().default(true),
  parameters: parametersSchema,
})

const workflowPolicyStepsSchema = z.array(workflowPolicyStepSchema).max(100, 'Steps must contain 100 rows or fewer').superRefine((items, ctx) => {
  const seenKeys = new Set()
  const seenOrders = new Set()
  items.forEach((item, index) => {
    if (seenKeys.has(item.stepKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'stepKey'],
        message: 'Workflow step keys must be unique.',
      })
    }
    seenKeys.add(item.stepKey)

    if (seenOrders.has(item.order)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'order'],
        message: 'Workflow step order values must be unique.',
      })
    }
    seenOrders.add(item.order)
  })
})

const workflowPolicyRoutingModeSchema = z.enum(Object.values(WORKFLOW_POLICY_ROUTING_MODES))
const workflowPolicyRoutingModeFieldSchema = z.union([workflowPolicyRoutingModeSchema, z.literal('')])

const optionalAgentIdSchema = z
  .string()
  .trim()
  .max(120, 'Agent id must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => !value || keyRegex.test(value),
    'Agent id must use lowercase letters, numbers, or hyphens',
  )

const validationKeysSchema = z
  .array(tokenSchema('Required validation key'))
  .max(50, 'Required validation keys must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const workflowPolicyOverrideRoleSchema = z.enum(Object.values(WORKFLOW_POLICY_OVERRIDE_ROLES))
const workflowPolicyOverrideRolesSchema = z
  .array(workflowPolicyOverrideRoleSchema)
  .max(10, 'Override roles must contain 10 items or fewer')
  .transform((values) => [...new Set(values)])

const workflowPolicyEscalateToSchema = z.union([workflowPolicyOverrideRoleSchema, z.literal('')])
const workflowPolicyEscalationRoleKeySchema = z.union([
  z.enum(Object.values(WORKFLOW_POLICY_ESCALATION_ROLE_KEYS)),
  z.literal(''),
])

const workflowPolicyStatusSchema = z.enum(Object.values(WORKFLOW_POLICY_STATUSES))
const workflowPolicyTypeSchema = z.enum(Object.values(WORKFLOW_POLICY_TYPES))
const workflowPolicyAppliesToSchema = z.enum(Object.values(WORKFLOW_POLICY_APPLIES_TO))
const workflowPolicyTriggerEventSchema = z.enum(Object.values(WORKFLOW_POLICY_TRIGGER_EVENTS))
const workflowPolicyTriggerModeSchema = z.enum(Object.values(WORKFLOW_POLICY_TRIGGER_MODES))
const workflowPolicyActorScopeSchema = z.enum(Object.values(WORKFLOW_POLICY_ACTOR_SCOPES))
const workflowPolicyGovernedActionSchema = z.enum(Object.values(WORKFLOW_POLICY_GOVERNED_ACTIONS))
const workflowPolicyDecisionModeSchema = z.enum(Object.values(WORKFLOW_POLICY_DECISION_MODES))
const workflowPolicyExecutionTypeSchema = z.enum(Object.values(WORKFLOW_POLICY_EXECUTION_TYPES))
const workflowPolicySeveritySchema = z.enum(Object.values(WORKFLOW_POLICY_SEVERITIES))

const createWorkflowPolicySchema = z.object({
  ...governedMetadataFieldsSchema,
  key: z
    .string({ required_error: 'Workflow policy key is required' })
    .trim()
    .min(1, 'Workflow policy key is required')
    .max(120, 'Workflow policy key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Workflow policy key must use lowercase letters, numbers, or hyphens',
    ),
  name: z
    .string({ required_error: 'Workflow policy name is required' })
    .trim()
    .min(1, 'Workflow policy name is required')
    .max(120, 'Workflow policy name must be 120 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .default(''),
  status: workflowPolicyStatusSchema.default(WORKFLOW_POLICY_DEFAULTS.status),
  policyType: workflowPolicyTypeSchema.default(WORKFLOW_POLICY_DEFAULTS.policyType),
  priority: z.coerce.number().int().min(1).max(9999).default(WORKFLOW_POLICY_DEFAULTS.priority),
  frameworkKeys: frameworkKeysSchema,
  appliesTo: workflowPolicyAppliesToSchema.default(WORKFLOW_POLICY_DEFAULTS.appliesTo),
  triggerEvent: workflowPolicyTriggerEventSchema,
  triggerMode: workflowPolicyTriggerModeSchema.default(WORKFLOW_POLICY_DEFAULTS.triggerMode),
  actorScope: workflowPolicyActorScopeSchema.default(WORKFLOW_POLICY_DEFAULTS.actorScope),
  cooldownSeconds: z.coerce.number().int().min(0).max(86400).default(WORKFLOW_POLICY_DEFAULTS.cooldownSeconds),
  reevaluateOnRetry: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.reevaluateOnRetry),
  governedAction: workflowPolicyGovernedActionSchema,
  decisionMode: workflowPolicyDecisionModeSchema.default(WORKFLOW_POLICY_DEFAULTS.decisionMode),
  executionType: workflowPolicyExecutionTypeSchema.default(WORKFLOW_POLICY_DEFAULTS.executionType),
  steps: workflowPolicyStepsSchema.default([]),
  passMessage: z.string().trim().max(500, 'Pass message must be 500 characters or fewer').default(''),
  failMessage: z.string().trim().max(500, 'Fail message must be 500 characters or fewer').default(''),
  severity: workflowPolicySeveritySchema.default(WORKFLOW_POLICY_DEFAULTS.severity),
  conditions: workflowPolicyConditionsSchema.default([]),
  routingMode: workflowPolicyRoutingModeFieldSchema.default(WORKFLOW_POLICY_DEFAULTS.routingMode),
  primaryAgentId: optionalAgentIdSchema.default(WORKFLOW_POLICY_DEFAULTS.primaryAgentId),
  fallbackAgentId: optionalAgentIdSchema.default(WORKFLOW_POLICY_DEFAULTS.fallbackAgentId),
  timeoutMs: timeoutMsSchema.default(WORKFLOW_POLICY_DEFAULTS.timeoutMs),
  retryOverride: z.string().trim().max(120, 'Retry override must be 120 characters or fewer').default(WORKFLOW_POLICY_DEFAULTS.retryOverride),
  requireSuccess: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.requireSuccess),
  requiredValidationKeys: validationKeysSchema.default([]),
  validationBlockingOnFail: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.validationBlockingOnFail),
  validationWarningOnly: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.validationWarningOnly),
  validationFreshnessMinutes: z.coerce.number().int().min(0).max(10080).default(WORKFLOW_POLICY_DEFAULTS.validationFreshnessMinutes),
  validationRequireLatestRun: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.validationRequireLatestRun),
  onPassEffects: workflowPolicyEffectsSchema.default([]),
  onFailEffects: workflowPolicyEffectsSchema.default([]),
  overrideAllowed: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.overrideAllowed),
  overrideRoles: workflowPolicyOverrideRolesSchema.default([]),
  approvalRequired: z.coerce.boolean().default(WORKFLOW_POLICY_DEFAULTS.approvalRequired),
  escalationRoleKey: workflowPolicyEscalationRoleKeySchema.default(WORKFLOW_POLICY_DEFAULTS.escalationRoleKey),
  escalateTo: workflowPolicyEscalateToSchema.default(WORKFLOW_POLICY_DEFAULTS.escalateTo),
  escalationMessage: z.string().trim().max(500, 'Escalation message must be 500 characters or fewer').default(WORKFLOW_POLICY_DEFAULTS.escalationMessage),
  slaMinutes: z.coerce.number().int().min(0).max(10080).default(WORKFLOW_POLICY_DEFAULTS.slaMinutes),
  orderedSteps: deprecatedRuntimePolicyFieldSchema('orderedSteps'),
  requiredAgentIds: deprecatedRuntimePolicyFieldSchema('requiredAgentIds'),
  requiredSkillIds: deprecatedRuntimePolicyFieldSchema('requiredSkillIds'),
  gatingRules: deprecatedRuntimePolicyFieldSchema('gatingRules'),
})

const updateWorkflowPolicySchema = z.object({
  ...governedMetadataFieldsSchema,
  key: z
    .string()
    .trim()
    .min(1, 'Workflow policy key must not be empty')
    .max(120, 'Workflow policy key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Workflow policy key must use lowercase letters, numbers, or hyphens',
    )
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Workflow policy name must not be empty')
    .max(120, 'Workflow policy name must be 120 characters or fewer')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
  status: workflowPolicyStatusSchema.optional(),
  policyType: workflowPolicyTypeSchema.optional(),
  priority: z.coerce.number().int().min(1).max(9999).optional(),
  frameworkKeys: frameworkKeysSchema.optional(),
  appliesTo: workflowPolicyAppliesToSchema.optional(),
  triggerEvent: workflowPolicyTriggerEventSchema.optional(),
  triggerMode: workflowPolicyTriggerModeSchema.optional(),
  actorScope: workflowPolicyActorScopeSchema.optional(),
  cooldownSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  reevaluateOnRetry: z.coerce.boolean().optional(),
  governedAction: workflowPolicyGovernedActionSchema.optional(),
  decisionMode: workflowPolicyDecisionModeSchema.optional(),
  executionType: workflowPolicyExecutionTypeSchema.optional(),
  steps: workflowPolicyStepsSchema.optional(),
  passMessage: z.string().trim().max(500, 'Pass message must be 500 characters or fewer').optional(),
  failMessage: z.string().trim().max(500, 'Fail message must be 500 characters or fewer').optional(),
  severity: workflowPolicySeveritySchema.optional(),
  conditions: workflowPolicyConditionsSchema.optional(),
  routingMode: workflowPolicyRoutingModeFieldSchema.optional(),
  primaryAgentId: optionalAgentIdSchema.optional(),
  fallbackAgentId: optionalAgentIdSchema.optional(),
  timeoutMs: timeoutMsSchema.optional(),
  retryOverride: z.string().trim().max(120, 'Retry override must be 120 characters or fewer').optional(),
  requireSuccess: z.coerce.boolean().optional(),
  requiredValidationKeys: validationKeysSchema.optional(),
  validationBlockingOnFail: z.coerce.boolean().optional(),
  validationWarningOnly: z.coerce.boolean().optional(),
  validationFreshnessMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  validationRequireLatestRun: z.coerce.boolean().optional(),
  onPassEffects: workflowPolicyEffectsSchema.optional(),
  onFailEffects: workflowPolicyEffectsSchema.optional(),
  overrideAllowed: z.coerce.boolean().optional(),
  overrideRoles: workflowPolicyOverrideRolesSchema.optional(),
  approvalRequired: z.coerce.boolean().optional(),
  escalationRoleKey: workflowPolicyEscalationRoleKeySchema.optional(),
  escalateTo: workflowPolicyEscalateToSchema.optional(),
  escalationMessage: z.string().trim().max(500, 'Escalation message must be 500 characters or fewer').optional(),
  slaMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  orderedSteps: deprecatedRuntimePolicyFieldSchema('orderedSteps'),
  requiredAgentIds: deprecatedRuntimePolicyFieldSchema('requiredAgentIds'),
  requiredSkillIds: deprecatedRuntimePolicyFieldSchema('requiredSkillIds'),
  gatingRules: deprecatedRuntimePolicyFieldSchema('gatingRules'),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['key'] },
)

const workflowPolicyIdSchema = z.object({
  policyId: z
    .string({ required_error: 'policyId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => policyIdRegex.test(value),
      'policyId must use the stable policy-<key> format',
    ),
})

const cloneWorkflowPolicySchema = z.object({
  ...governedMetadataFieldsSchema,
  key: z
    .string({ required_error: 'Workflow policy key is required for clone.' })
    .trim()
    .min(1, 'Workflow policy key is required for clone.')
    .max(120, 'Workflow policy key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Workflow policy key must use lowercase letters, numbers, or hyphens',
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Workflow policy name is required for clone.')
    .max(120, 'Workflow policy name must be 120 characters or fewer')
    .optional(),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer').optional(),
})

const listWorkflowPoliciesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: workflowPolicyStatusSchema.optional(),
  frameworkKey: frameworkKeySchema.optional(),
  type: workflowPolicyTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const objectSchema = z.record(z.string(), z.unknown()).default({})

const workflowPolicyTestConsoleBodySchema = z.object({
  draft: createWorkflowPolicySchema,
  frameworkState: objectSchema,
  triggerEvent: workflowPolicyTriggerEventSchema.optional(),
  actorScope: workflowPolicyActorScopeSchema.optional(),
}).default({
  frameworkState: {},
})

export const validateCreateWorkflowPolicy = createBodyValidator(createWorkflowPolicySchema)
export const validateUpdateWorkflowPolicy = createBodyValidator(updateWorkflowPolicySchema)
export const validateCloneWorkflowPolicy = createBodyValidator(cloneWorkflowPolicySchema)
export const validateWorkflowPolicyId = createParamsValidator(workflowPolicyIdSchema)
export const validateListWorkflowPolicies = createQueryValidator(listWorkflowPoliciesQuerySchema)
export const validateWorkflowPolicyTestConsoleBody = createBodyValidator(workflowPolicyTestConsoleBodySchema, {
  message: 'Invalid workflow policy test request body.',
})
