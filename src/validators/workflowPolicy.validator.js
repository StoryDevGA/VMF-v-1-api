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
  WORKFLOW_POLICY_GOVERNED_ACTIONS,
  WORKFLOW_POLICY_OVERRIDE_ROLES,
  WORKFLOW_POLICY_ROUTING_MODES,
  WORKFLOW_POLICY_SEVERITIES,
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_TRIGGER_EVENTS,
  WORKFLOW_POLICY_TRIGGER_MODES,
  WORKFLOW_POLICY_TYPES,
} from '../models/WorkflowPolicy.js'

const keyRegex = /^[a-z][a-z0-9-]*$/
const policyIdRegex = /^policy-[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/

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

const orderedStepsSchema = z
  .array(tokenSchema('Workflow step'))
  .max(50, 'Ordered steps must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const requiredAgentIdsSchema = z
  .array(tokenSchema('Required agent id'))
  .max(50, 'Required agent ids must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const requiredSkillIdsSchema = z
  .array(tokenSchema('Required skill id'))
  .max(50, 'Required skill ids must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const gatingRulesSchema = z
  .array(tokenSchema('Gating rule'))
  .max(50, 'Gating rules must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string().trim().min(1, 'Condition value entries must not be empty')),
])

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

const workflowPolicyStatusSchema = z.enum(Object.values(WORKFLOW_POLICY_STATUSES))
const workflowPolicyTypeSchema = z.enum(Object.values(WORKFLOW_POLICY_TYPES))
const workflowPolicyAppliesToSchema = z.enum(Object.values(WORKFLOW_POLICY_APPLIES_TO))
const workflowPolicyTriggerEventSchema = z.enum(Object.values(WORKFLOW_POLICY_TRIGGER_EVENTS))
const workflowPolicyTriggerModeSchema = z.enum(Object.values(WORKFLOW_POLICY_TRIGGER_MODES))
const workflowPolicyActorScopeSchema = z.enum(Object.values(WORKFLOW_POLICY_ACTOR_SCOPES))
const workflowPolicyGovernedActionSchema = z.enum(Object.values(WORKFLOW_POLICY_GOVERNED_ACTIONS))
const workflowPolicyDecisionModeSchema = z.enum(Object.values(WORKFLOW_POLICY_DECISION_MODES))
const workflowPolicySeveritySchema = z.enum(Object.values(WORKFLOW_POLICY_SEVERITIES))

const createWorkflowPolicySchema = z.object({
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
  passMessage: z.string().trim().max(500, 'Pass message must be 500 characters or fewer').default(''),
  failMessage: z.string().trim().max(500, 'Fail message must be 500 characters or fewer').default(''),
  severity: workflowPolicySeveritySchema.default(WORKFLOW_POLICY_DEFAULTS.severity),
  conditions: workflowPolicyConditionsSchema.default([]),
  routingMode: workflowPolicyRoutingModeFieldSchema.default(WORKFLOW_POLICY_DEFAULTS.routingMode),
  primaryAgentId: optionalAgentIdSchema.default(WORKFLOW_POLICY_DEFAULTS.primaryAgentId),
  fallbackAgentId: optionalAgentIdSchema.default(WORKFLOW_POLICY_DEFAULTS.fallbackAgentId),
  timeoutMs: z.coerce.number().int().min(0).max(300000).default(WORKFLOW_POLICY_DEFAULTS.timeoutMs),
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
  escalateTo: workflowPolicyEscalateToSchema.default(WORKFLOW_POLICY_DEFAULTS.escalateTo),
  escalationMessage: z.string().trim().max(500, 'Escalation message must be 500 characters or fewer').default(WORKFLOW_POLICY_DEFAULTS.escalationMessage),
  slaMinutes: z.coerce.number().int().min(0).max(10080).default(WORKFLOW_POLICY_DEFAULTS.slaMinutes),
  orderedSteps: orderedStepsSchema.default([]),
  requiredAgentIds: requiredAgentIdsSchema.default([]),
  requiredSkillIds: requiredSkillIdsSchema.default([]),
  gatingRules: gatingRulesSchema.default([]),
})

const updateWorkflowPolicySchema = z.object({
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
  passMessage: z.string().trim().max(500, 'Pass message must be 500 characters or fewer').optional(),
  failMessage: z.string().trim().max(500, 'Fail message must be 500 characters or fewer').optional(),
  severity: workflowPolicySeveritySchema.optional(),
  conditions: workflowPolicyConditionsSchema.optional(),
  routingMode: workflowPolicyRoutingModeFieldSchema.optional(),
  primaryAgentId: optionalAgentIdSchema.optional(),
  fallbackAgentId: optionalAgentIdSchema.optional(),
  timeoutMs: z.coerce.number().int().min(0).max(300000).optional(),
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
  escalateTo: workflowPolicyEscalateToSchema.optional(),
  escalationMessage: z.string().trim().max(500, 'Escalation message must be 500 characters or fewer').optional(),
  slaMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  orderedSteps: orderedStepsSchema.optional(),
  requiredAgentIds: requiredAgentIdsSchema.optional(),
  requiredSkillIds: requiredSkillIdsSchema.optional(),
  gatingRules: gatingRulesSchema.optional(),
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
export const validateWorkflowPolicyId = createParamsValidator(workflowPolicyIdSchema)
export const validateListWorkflowPolicies = createQueryValidator(listWorkflowPoliciesQuerySchema)
export const validateWorkflowPolicyTestConsoleBody = createBodyValidator(workflowPolicyTestConsoleBodySchema, {
  message: 'Invalid workflow policy test request body.',
})
