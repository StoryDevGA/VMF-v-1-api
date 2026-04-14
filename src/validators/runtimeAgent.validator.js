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
const workflowKeyRegex = /^[a-z][a-z0-9_]*$/

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

const workflowKeySchema = z
  .string()
  .trim()
  .min(1, 'Workflow key is required')
  .max(120, 'Workflow key must be 120 characters or fewer')
  .transform((value) => String(value).trim().toLowerCase().replace(/-/g, '_'))
  .refine(
    (value) => workflowKeyRegex.test(value),
    'Workflow key must use lowercase letters, numbers, or underscores',
  )

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
  supportedWorkflows: z
    .array(workflowKeySchema)
    .max(50, 'Supported workflows must contain 50 items or fewer')
    .transform((values) => [...new Set(values)])
    .default([]),
  supportedFrameworkKeys: supportedFrameworkKeysSchema,
  defaultSkillIds: defaultSkillIdsSchema.default([]),
  primarySkillIds: skillIdsSchema.default([]),
  optionalSkillIds: skillIdsSchema.default([]),
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
  supportedWorkflows: z
    .array(workflowKeySchema)
    .max(50, 'Supported workflows must contain 50 items or fewer')
    .transform((values) => [...new Set(values)])
    .optional(),
  supportedFrameworkKeys: supportedFrameworkKeysSchema.optional(),
  defaultSkillIds: defaultSkillIdsSchema.optional(),
  primarySkillIds: skillIdsSchema.optional(),
  optionalSkillIds: skillIdsSchema.optional(),
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
  workflowKey: workflowKeySchema.optional(),
  input: objectSchema.optional().default({}),
  context: objectSchema.optional().default({}),
}).default({})

export const validateRuntimeAgentTestBody = createBodyValidator(runtimeAgentTestBodySchema, {
  message: 'Invalid test request body.',
})
