import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  VALIDATION_REGISTRY_CATEGORIES,
  VALIDATION_REGISTRY_RESULT_TYPES,
  VALIDATION_REGISTRY_SEVERITIES,
  VALIDATION_REGISTRY_STATUSES,
} from '../models/ValidationRegistry.js'

const validationIdRegex = /^validation-[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const skillIdRegex = /^skill-[a-z][a-z0-9-]*$/
const agentIdRegex = /^agent-[a-z][a-z0-9-]*$/
const keyRegex = /^[a-z][a-z0-9-]*$/

const keyQuerySchema = z
  .string()
  .trim()
  .min(1, 'Key is required')
  .max(120, 'Key must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine((value) => keyRegex.test(value), 'Key must use lowercase letters, numbers, or hyphens')

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

const frameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one supported framework key is required.')
  .max(20, 'Supported framework keys must contain 20 items or fewer')
  .transform((values) => [...new Set(values)])

const frameworkKeysQuerySchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return []
    return value
      .split(',')
      .map((item) => String(item).trim())
      .filter(Boolean)
  },
  z.array(frameworkKeySchema).max(50, 'Framework keys must contain 50 items or fewer'),
)

const validationIdSchema = z.object({
  validationId: z
    .string({ required_error: 'validationId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => validationIdRegex.test(value),
      'validationId must use the stable validation-<key> format',
    ),
})

const listValidationRegistryQuerySchema = z.object({
  q: z.string().trim().max(255, 'Search query must be 255 characters or fewer').optional(),
  keys: z
    .preprocess(
      (value) => {
        if (Array.isArray(value)) return value
        if (typeof value !== 'string') return []
        return value
          .split(',')
          .map((item) => String(item).trim())
          .filter(Boolean)
      },
      z.array(keyQuerySchema).max(200, 'Keys must contain 200 items or fewer'),
    )
    .optional(),
  status: z.enum(Object.values(VALIDATION_REGISTRY_STATUSES)).optional(),
  frameworkKey: frameworkKeySchema.optional(),
  frameworkKeys: frameworkKeysQuerySchema.optional(),
  category: z.enum(Object.values(VALIDATION_REGISTRY_CATEGORIES)).optional(),
  severity: z.enum(Object.values(VALIDATION_REGISTRY_SEVERITIES)).optional(),
  policyUsable: z
    .preprocess((value) => String(value ?? '').trim().toLowerCase(), z.enum(['true', 'false']))
    .optional(),
  packageUsable: z
    .preprocess((value) => String(value ?? '').trim().toLowerCase(), z.enum(['true', 'false']))
    .optional(),
  sortBy: z.enum(['label', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const keySchema = z
  .string({ required_error: 'Key is required' })
  .trim()
  .min(1, 'Key is required')
  .max(120, 'Key must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine((value) => keyRegex.test(value), 'Key must use lowercase letters, numbers, or hyphens')

const skillIdSchema = z
  .string({ required_error: 'Producer skill id is required' })
  .trim()
  .min(1, 'Producer skill id is required')
  .max(160, 'Producer skill id must be 160 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine((value) => skillIdRegex.test(value), 'Producer skill id must use the stable skill-<key> format')

const agentIdSchema = z
  .string()
  .trim()
  .min(1, 'Default agent id is required')
  .max(160, 'Default agent id must be 160 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine((value) => agentIdRegex.test(value), 'Default agent id must use the stable agent-<key> format')

const defaultAgentIdsSchema = z
  .array(agentIdSchema)
  .max(50, 'Default agent ids must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const runtimePathKeySchema = (label) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(200, `${label} must be 200 characters or fewer`)
    .refine((value) => !/\s/.test(String(value)), `${label} must not contain whitespace`)

const optionalRuntimePathKeySchema = (label) =>
  z
    .string()
    .trim()
    .max(200, `${label} must be 200 characters or fewer`)
    .refine((value) => !value || !/\s/.test(String(value)), `${label} must not contain whitespace`)
    .optional()
    .default('')

const defaultsSchema = z.object({
  freshnessDefaultMinutes: z.coerce.number().int().min(0).max(10080).default(30),
  blockingDefault: z.coerce.boolean().default(true),
  warningOnlyDefault: z.coerce.boolean().default(false),
}).refine(
  (value) => !(value.blockingDefault && value.warningOnlyDefault),
  { message: 'Blocking Default and Warning Only Default cannot both be true.', path: ['warningOnlyDefault'] },
)

const createValidationRegistryBodySchema = z.object({
  key: keySchema,
  label: z.string({ required_error: 'Label is required' }).trim().min(1, 'Label is required').max(140),
  description: z.string({ required_error: 'Description is required' }).trim().min(1, 'Description is required').max(800),
  status: z.enum(Object.values(VALIDATION_REGISTRY_STATUSES)).default(VALIDATION_REGISTRY_STATUSES.ACTIVE),
  supportedFrameworkKeys: frameworkKeysSchema,
  category: z.enum(Object.values(VALIDATION_REGISTRY_CATEGORIES)),
  severity: z.enum(Object.values(VALIDATION_REGISTRY_SEVERITIES)),
  producerSkillId: skillIdSchema,
  defaultAgentIds: defaultAgentIdsSchema.default([]),
  outputPath: runtimePathKeySchema('Output Path'),
  resultType: z.enum(Object.values(VALIDATION_REGISTRY_RESULT_TYPES)).optional(),
  passFieldPath: optionalRuntimePathKeySchema('Pass Field Path'),
  detailsFieldPath: optionalRuntimePathKeySchema('Details Field Path'),
  policyUsable: z.coerce.boolean().default(true),
  packageUsable: z.coerce.boolean().default(true),
  requiresLatestRun: z.coerce.boolean().default(false),
  ...defaultsSchema.shape,
}).refine(
  (value) => !(value.blockingDefault && value.warningOnlyDefault),
  { message: 'Blocking Default and Warning Only Default cannot both be true.', path: ['warningOnlyDefault'] },
)

const updateValidationRegistryBodySchema = z.object({
  key: keySchema.optional(),
  label: z.string().trim().min(1, 'Label is required').max(140).optional(),
  description: z.string().trim().min(1, 'Description is required').max(800).optional(),
  status: z.enum(Object.values(VALIDATION_REGISTRY_STATUSES)).optional(),
  supportedFrameworkKeys: frameworkKeysSchema.optional(),
  category: z.enum(Object.values(VALIDATION_REGISTRY_CATEGORIES)).optional(),
  severity: z.enum(Object.values(VALIDATION_REGISTRY_SEVERITIES)).optional(),
  producerSkillId: skillIdSchema.optional(),
  defaultAgentIds: defaultAgentIdsSchema.optional(),
  outputPath: runtimePathKeySchema('Output Path').optional(),
  resultType: z.enum(Object.values(VALIDATION_REGISTRY_RESULT_TYPES)).optional(),
  passFieldPath: optionalRuntimePathKeySchema('Pass Field Path'),
  detailsFieldPath: optionalRuntimePathKeySchema('Details Field Path'),
  policyUsable: z.coerce.boolean().optional(),
  packageUsable: z.coerce.boolean().optional(),
  requiresLatestRun: z.coerce.boolean().optional(),
  freshnessDefaultMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  blockingDefault: z.coerce.boolean().optional(),
  warningOnlyDefault: z.coerce.boolean().optional(),
}).refine(
  (value) => !(value.blockingDefault && value.warningOnlyDefault),
  { message: 'Blocking Default and Warning Only Default cannot both be true.', path: ['warningOnlyDefault'] },
)

export const validateValidationRegistryId = createParamsValidator(validationIdSchema)
export const validateListValidationRegistry = createQueryValidator(listValidationRegistryQuerySchema)
export const validateCreateValidationRegistry = createBodyValidator(createValidationRegistryBodySchema)
export const validateUpdateValidationRegistry = createBodyValidator(updateValidationRegistryBodySchema)
