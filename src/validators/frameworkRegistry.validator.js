import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  FRAMEWORK_REGISTRY_STATUSES,
  FRAMEWORK_REGISTRY_STRUCTURE_TYPES,
  FRAMEWORK_REGISTRY_TYPES,
} from '../models/FrameworkRegistry.js'

const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const registryIdRegex = /^framework-[a-z0-9][a-z0-9-]*$/
const workflowKeyRegex = /^[a-z][a-z0-9-]*$/

const frameworkKeySchema = z
  .string({ required_error: 'Framework key is required' })
  .trim()
  .min(1, 'Framework key is required')
  .max(100, 'Framework key must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => frameworkKeyRegex.test(value),
    'Framework key must use uppercase letters, numbers, or underscores',
  )

const workflowKeySchema = z
  .string()
  .trim()
  .min(1, 'Workflow key is required')
  .max(120, 'Workflow key must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => workflowKeyRegex.test(value),
    'Workflow keys must use lowercase letters, numbers, or hyphens',
  )

const supportedWorkflowKeysSchema = z
  .array(workflowKeySchema)
  .max(200, 'Supported workflow keys must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const defaultBehaviorProfileSchema = z
  .unknown()
  .refine(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
    'Default behavior profile must be an object.',
  )

const createFrameworkRegistrySchema = z.object({
  frameworkKey: frameworkKeySchema,
  name: z
    .string({ required_error: 'Framework name is required' })
    .trim()
    .min(1, 'Framework name is required')
    .max(120, 'Framework name must be 120 characters or fewer'),
  type: z
    .enum(Object.values(FRAMEWORK_REGISTRY_TYPES))
    .default(FRAMEWORK_REGISTRY_TYPES.STRUCTURED),
  structureType: z
    .enum(Object.values(FRAMEWORK_REGISTRY_STRUCTURE_TYPES))
    .default(FRAMEWORK_REGISTRY_STRUCTURE_TYPES.SECTION_BASED),
  supportedWorkflowKeys: supportedWorkflowKeysSchema.default([]),
  defaultBehaviorProfile: defaultBehaviorProfileSchema.default({}),
  status: z
    .enum(Object.values(FRAMEWORK_REGISTRY_STATUSES))
    .default(FRAMEWORK_REGISTRY_STATUSES.ACTIVE),
})

const updateFrameworkRegistrySchema = z.object({
  frameworkKey: frameworkKeySchema.optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Framework name must not be empty')
    .max(120, 'Framework name must be 120 characters or fewer')
    .optional(),
  type: z.enum(Object.values(FRAMEWORK_REGISTRY_TYPES)).optional(),
  structureType: z.enum(Object.values(FRAMEWORK_REGISTRY_STRUCTURE_TYPES)).optional(),
  supportedWorkflowKeys: supportedWorkflowKeysSchema.optional(),
  defaultBehaviorProfile: defaultBehaviorProfileSchema.optional(),
  status: z.enum(Object.values(FRAMEWORK_REGISTRY_STATUSES)).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['frameworkKey'] },
)

const frameworkRegistryIdSchema = z.object({
  registryId: z
    .string({ required_error: 'registryId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => registryIdRegex.test(value),
      'registryId must use the stable framework-<key> format',
    ),
})

const listFrameworkRegistriesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z.enum(Object.values(FRAMEWORK_REGISTRY_STATUSES)).optional(),
  type: z.enum(Object.values(FRAMEWORK_REGISTRY_TYPES)).optional(),
  structureType: z.enum(Object.values(FRAMEWORK_REGISTRY_STRUCTURE_TYPES)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateFrameworkRegistry = createBodyValidator(createFrameworkRegistrySchema)
export const validateUpdateFrameworkRegistry = createBodyValidator(updateFrameworkRegistrySchema)
export const validateFrameworkRegistryId = createParamsValidator(frameworkRegistryIdSchema)
export const validateListFrameworkRegistries = createQueryValidator(listFrameworkRegistriesQuerySchema)
