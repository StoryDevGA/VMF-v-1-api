import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import { RUNTIME_AGENT_STATUSES } from '../models/RuntimeAgent.js'

const keyRegex = /^[a-z][a-z0-9-]*$/
const agentIdRegex = /^agent-[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const enumTokenRegex = /^[A-Z][A-Z0-9_]*$/

const normalizePathSelectionList = (value) => {
  const items = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ''
      ? []
      : [value]

  return [...new Set(
    items
      .map((item) => String(item ?? '').trim())
      .filter(Boolean),
  )]
}

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

const defaultSkillIdSchema = z
  .string()
  .trim()
  .min(1, 'Default skill id is required')
  .max(120, 'Default skill id must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => keyRegex.test(value),
    'Default skill ids must use lowercase letters, numbers, or hyphens',
  )

const runtimeAgentTypeSchema = z
  .string()
  .trim()
  .min(1, 'Agent type is required')
  .max(100, 'Agent type must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => enumTokenRegex.test(value),
    'Agent type must use uppercase letters, numbers, or underscores',
  )

const skillRoleKeySchema = z
  .string()
  .trim()
  .min(1, 'Skill role key is required')
  .max(80, 'Skill role key must be 80 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => enumTokenRegex.test(value),
    'Skill role key must use uppercase letters, numbers, or underscores',
  )

const pathKeySchema = z
  .string()
  .trim()
  .min(1, 'Runtime path key is required')
  .max(200, 'Runtime path key must be 200 characters or fewer')
  .refine(
    (value) => !/\s/.test(value),
    'Runtime path key must not contain whitespace.',
  )

const pathSelectionListSchema = z
  .union([pathKeySchema, z.array(pathKeySchema).max(50, 'Runtime path selections must contain 50 items or fewer')])
  .optional()
  .transform((value) => normalizePathSelectionList(value))

const supportedFrameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one supported framework key is required.')
  .max(20, 'Supported framework keys must contain 20 items or fewer')
  .transform((values) => [...new Set(values)])

const defaultSkillIdsSchema = z
  .array(defaultSkillIdSchema)
  .max(200, 'Default skill ids must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const skillIdsSchema = z
  .array(defaultSkillIdSchema)
  .max(200, 'Skill ids must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const requiredSkillRoleKeysSchema = z
  .array(skillRoleKeySchema)
  .max(50, 'Required skill role keys must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const executionPlanStepSchema = z.object({
  skillId: defaultSkillIdSchema,
  description: z
    .string()
    .trim()
    .max(500, 'Execution step description must be 500 characters or fewer')
    .optional()
    .default(''),
  readsFrom: pathSelectionListSchema.default([]),
  writesTo: pathSelectionListSchema.default([]),
})

const executionPlanSchema = z
  .array(executionPlanStepSchema)
  .min(1, 'Execution plan must contain at least one step.')
  .max(100, 'Execution plan must contain 100 steps or fewer.')
  .superRefine((steps, ctx) => {
    const seen = new Set()

    steps.forEach((step, index) => {
      if (seen.has(step.skillId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Execution plan steps must be unique.',
          path: [index, 'skillId'],
        })
      }
      seen.add(step.skillId)
    })
  })

const objectSchema = z
  .record(z.string(), z.unknown())
  .default({})

const createRuntimeAgentSchema = z.object({
  key: z
    .string({ required_error: 'Agent key is required' })
    .trim()
    .min(1, 'Agent key is required')
    .max(120, 'Agent key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Agent key must use lowercase letters, numbers, or hyphens',
    ),
  name: z
    .string({ required_error: 'Agent name is required' })
    .trim()
    .min(1, 'Agent name is required')
    .max(120, 'Agent name must be 120 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .default(''),
  status: z
    .enum(Object.values(RUNTIME_AGENT_STATUSES))
    .default(RUNTIME_AGENT_STATUSES.ACTIVE),
  agentType: runtimeAgentTypeSchema.default('EXECUTION'),
  supportedFrameworkKeys: supportedFrameworkKeysSchema,
  requiredSkillRoleKeys: requiredSkillRoleKeysSchema.default([]),
  defaultSkillIds: defaultSkillIdsSchema.default([]),
  primarySkillIds: skillIdsSchema.default([]),
  optionalSkillIds: skillIdsSchema.default([]),
  executionPlan: executionPlanSchema,
  promptConfig: objectSchema,
  inputContract: objectSchema,
  outputContract: objectSchema,
  policies: objectSchema,
})

const updateRuntimeAgentSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Agent key must not be empty')
    .max(120, 'Agent key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Agent key must use lowercase letters, numbers, or hyphens',
    )
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Agent name must not be empty')
    .max(120, 'Agent name must be 120 characters or fewer')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
  status: z
    .enum(Object.values(RUNTIME_AGENT_STATUSES))
    .optional(),
  agentType: runtimeAgentTypeSchema.optional(),
  supportedFrameworkKeys: supportedFrameworkKeysSchema.optional(),
  requiredSkillRoleKeys: requiredSkillRoleKeysSchema.optional(),
  defaultSkillIds: defaultSkillIdsSchema.optional(),
  primarySkillIds: skillIdsSchema.optional(),
  optionalSkillIds: skillIdsSchema.optional(),
  executionPlan: executionPlanSchema.optional(),
  promptConfig: objectSchema.optional(),
  inputContract: objectSchema.optional(),
  outputContract: objectSchema.optional(),
  policies: objectSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['key'] },
)

const runtimeAgentIdSchema = z.object({
  agentId: z
    .string({ required_error: 'agentId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => agentIdRegex.test(value),
      'agentId must use the stable agent-<key> format',
    ),
})

const listRuntimeAgentsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z
    .enum(Object.values(RUNTIME_AGENT_STATUSES))
    .optional(),
  frameworkKey: frameworkKeySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateRuntimeAgent = createBodyValidator(createRuntimeAgentSchema)
export const validateUpdateRuntimeAgent = createBodyValidator(updateRuntimeAgentSchema)
export const validateRuntimeAgentId = createParamsValidator(runtimeAgentIdSchema)
export const validateListRuntimeAgents = createQueryValidator(listRuntimeAgentsQuerySchema)

const emptyBodySchema = z.object({}).default({})
export const validateRuntimeAgentActionBody = createBodyValidator(emptyBodySchema, {
  message: 'Invalid request body.',
})

const runtimeAgentTestBodySchema = z.object({
  frameworkKey: frameworkKeySchema.optional(),
  input: objectSchema.optional().default({}),
  context: objectSchema.optional().default({}),
}).default({})

export const validateRuntimeAgentTestBody = createBodyValidator(runtimeAgentTestBodySchema, {
  message: 'Invalid test request body.',
})
