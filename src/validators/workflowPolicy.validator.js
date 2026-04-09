import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import { WORKFLOW_POLICY_STATUSES } from '../models/WorkflowPolicy.js'

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
  .min(1, 'At least one ordered step is required.')
  .max(50, 'Ordered steps must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const requiredAgentIdsSchema = z
  .array(tokenSchema('Required agent id'))
  .min(1, 'At least one required agent id is required.')
  .max(50, 'Required agent ids must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const requiredSkillIdsSchema = z
  .array(tokenSchema('Required skill id'))
  .min(1, 'At least one required skill id is required.')
  .max(50, 'Required skill ids must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const gatingRulesSchema = z
  .array(tokenSchema('Gating rule'))
  .max(50, 'Gating rules must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

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
  status: z
    .enum(Object.values(WORKFLOW_POLICY_STATUSES))
    .default(WORKFLOW_POLICY_STATUSES.ACTIVE),
  frameworkKeys: frameworkKeysSchema,
  orderedSteps: orderedStepsSchema,
  requiredAgentIds: requiredAgentIdsSchema,
  requiredSkillIds: requiredSkillIdsSchema,
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
  status: z
    .enum(Object.values(WORKFLOW_POLICY_STATUSES))
    .optional(),
  frameworkKeys: frameworkKeysSchema.optional(),
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
  status: z
    .enum(Object.values(WORKFLOW_POLICY_STATUSES))
    .optional(),
  frameworkKey: frameworkKeySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateWorkflowPolicy = createBodyValidator(createWorkflowPolicySchema)
export const validateUpdateWorkflowPolicy = createBodyValidator(updateWorkflowPolicySchema)
export const validateWorkflowPolicyId = createParamsValidator(workflowPolicyIdSchema)
export const validateListWorkflowPolicies = createQueryValidator(listWorkflowPoliciesQuerySchema)
