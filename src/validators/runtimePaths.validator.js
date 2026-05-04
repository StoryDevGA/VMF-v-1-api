import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_SOURCE_TYPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
} from '../models/RuntimePathRegistry.js'

const pathIdRegex = /^path-[a-z0-9][a-z0-9-]*$/
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

const frameworkKeysSchema = z.preprocess(
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

const requiredFrameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one framework key is required.')
  .max(50, 'Framework keys must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const pathKeySchema = z
  .string({ required_error: 'Path key is required' })
  .trim()
  .min(1, 'Path key is required')
  .max(200, 'Path key must be 200 characters or fewer')
  .refine((value) => !/\s/.test(String(value)), 'Path key must not contain whitespace')

const optionalPathKeySchema = z
  .string()
  .trim()
  .max(200, 'Path key must be 200 characters or fewer')
  .refine((value) => !value || !/\s/.test(String(value)), 'Path key must not contain whitespace')
  .optional()

const stringListSchema = (label, { max = 100, upper = false } = {}) =>
  z
    .array(z.string().trim().min(1, `${label} values cannot be empty`).max(200, `${label} values must be 200 characters or fewer`))
    .max(max, `${label} must contain ${max} items or fewer`)
    .transform((values) => [
      ...new Set(values.map((value) => (upper ? value.toUpperCase() : value)).filter(Boolean)),
    ])

const optionalTextSchema = (label, max) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()

const runtimePathMutableFieldsSchema = {
  label: z.string({ required_error: 'Label is required' }).trim().min(1, 'Label is required').max(140),
  description: z.string({ required_error: 'Description is required' }).trim().min(1, 'Description is required').max(800),
  status: z.enum(Object.values(RUNTIME_PATH_REGISTRY_STATUSES)).default(RUNTIME_PATH_REGISTRY_STATUSES.DRAFT),
  frameworkKeys: requiredFrameworkKeysSchema,
  scope: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SCOPES)),
  allowedOperations: stringListSchema('Allowed operations', { max: 10, upper: true })
    .pipe(z.array(z.enum(Object.values(RUNTIME_PATH_REGISTRY_OPERATIONS))).min(1, 'At least one allowed operation is required.')),
  dataType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_DATA_TYPES)),
  category: z.enum(Object.values(RUNTIME_PATH_REGISTRY_CATEGORIES)),
  sourceType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SOURCE_TYPES)),
  isProtected: z.coerce.boolean().default(false),
  isSystem: z.coerce.boolean().default(false),
  introducedInVersion: optionalTextSchema('Introduced version', 40),
  deprecatedInVersion: optionalTextSchema('Deprecated version', 40),
  replacementPathKey: optionalPathKeySchema,
  notes: optionalTextSchema('Notes', 1000),
  displayOrder: z.coerce.number().int().min(0).max(100000).optional(),
  exampleValue: z.any().optional(),
  compatibilityTags: stringListSchema('Compatibility tags', { max: 100 }).default([]),
  allowedValues: stringListSchema('Allowed values', { max: 200 }).optional(),
  allowedValueLabels: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
  uiControl: z.enum(Object.values(RUNTIME_PATH_REGISTRY_UI_CONTROLS)).optional(),
  placeholderText: optionalTextSchema('Placeholder text', 200),
  helpText: optionalTextSchema('Help text', 600),
  defaultValue: z.any().optional(),
  minValue: z.coerce.number().optional(),
  maxValue: z.coerce.number().optional(),
  minLength: z.coerce.number().int().min(0).max(100000).optional(),
  maxLength: z.coerce.number().int().min(0).max(100000).optional(),
  regexPattern: optionalTextSchema('Regex pattern', 500),
  isNullable: z.coerce.boolean().optional(),
}

const runtimePathIdSchema = z.object({
  pathId: z
    .string({ required_error: 'pathId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => pathIdRegex.test(value),
      'pathId must use the stable path-<token> format',
    ),
})

const listRuntimePathsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z.enum(Object.values(RUNTIME_PATH_REGISTRY_STATUSES)).optional(),
  frameworkKey: frameworkKeySchema.optional(),
  frameworkKeys: frameworkKeysSchema.optional(),
  scope: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SCOPES)).optional(),
  operation: z.enum(Object.values(RUNTIME_PATH_REGISTRY_OPERATIONS)).optional(),
  category: z.enum(Object.values(RUNTIME_PATH_REGISTRY_CATEGORIES)).optional(),
  dataType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_DATA_TYPES)).optional(),
  sourceType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SOURCE_TYPES)).optional(),
  sortBy: z.enum(['label', 'pathKey', 'status', 'scope', 'category', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  isProtected: z
    .preprocess((value) => String(value ?? '').trim().toLowerCase(), z.enum(['true', 'false']))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createRuntimePathBodySchema = z.object({
  pathKey: pathKeySchema,
  ...runtimePathMutableFieldsSchema,
})

const updateRuntimePathBodySchema = z.object({
  pathKey: optionalPathKeySchema,
  label: runtimePathMutableFieldsSchema.label.optional(),
  description: runtimePathMutableFieldsSchema.description.optional(),
  status: z.enum(Object.values(RUNTIME_PATH_REGISTRY_STATUSES)).optional(),
  frameworkKeys: requiredFrameworkKeysSchema.optional(),
  scope: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SCOPES)).optional(),
  allowedOperations: stringListSchema('Allowed operations', { max: 10, upper: true })
    .pipe(z.array(z.enum(Object.values(RUNTIME_PATH_REGISTRY_OPERATIONS))).min(1, 'At least one allowed operation is required.'))
    .optional(),
  dataType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_DATA_TYPES)).optional(),
  category: z.enum(Object.values(RUNTIME_PATH_REGISTRY_CATEGORIES)).optional(),
  sourceType: z.enum(Object.values(RUNTIME_PATH_REGISTRY_SOURCE_TYPES)).optional(),
  isProtected: z.coerce.boolean().optional(),
  isSystem: z.coerce.boolean().optional(),
  introducedInVersion: optionalTextSchema('Introduced version', 40),
  deprecatedInVersion: optionalTextSchema('Deprecated version', 40),
  replacementPathKey: optionalPathKeySchema,
  notes: optionalTextSchema('Notes', 1000),
  displayOrder: z.coerce.number().int().min(0).max(100000).optional(),
  exampleValue: z.any().optional(),
  compatibilityTags: stringListSchema('Compatibility tags', { max: 100 }).optional(),
  allowedValues: stringListSchema('Allowed values', { max: 200 }).optional(),
  allowedValueLabels: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
  uiControl: z.enum(Object.values(RUNTIME_PATH_REGISTRY_UI_CONTROLS)).optional(),
  placeholderText: optionalTextSchema('Placeholder text', 200),
  helpText: optionalTextSchema('Help text', 600),
  defaultValue: z.any().optional(),
  minValue: z.coerce.number().optional(),
  maxValue: z.coerce.number().optional(),
  minLength: z.coerce.number().int().min(0).max(100000).optional(),
  maxLength: z.coerce.number().int().min(0).max(100000).optional(),
  regexPattern: optionalTextSchema('Regex pattern', 500),
  isNullable: z.coerce.boolean().optional(),
  confirmDependencies: z.coerce.boolean().optional(),
})

const cloneRuntimePathBodySchema = z.object({
  pathKey: pathKeySchema,
  label: runtimePathMutableFieldsSchema.label.optional(),
  description: runtimePathMutableFieldsSchema.description.optional(),
  status: z.enum(Object.values(RUNTIME_PATH_REGISTRY_STATUSES))
    .optional()
    .refine(
      (value) => value === undefined || value === RUNTIME_PATH_REGISTRY_STATUSES.DRAFT,
      'Cloned runtime paths must start in DRAFT status.',
    ),
})

const lifecycleRuntimePathBodySchema = z.object({
  confirmDependencies: z.coerce.boolean().optional(),
  deprecatedInVersion: optionalTextSchema('Deprecated version', 40),
})

export const validateRuntimePathId = createParamsValidator(runtimePathIdSchema)
export const validateListRuntimePaths = createQueryValidator(listRuntimePathsQuerySchema)
export const validateCreateRuntimePath = createBodyValidator(createRuntimePathBodySchema)
export const validateUpdateRuntimePath = createBodyValidator(updateRuntimePathBodySchema)
export const validateCloneRuntimePath = createBodyValidator(cloneRuntimePathBodySchema)
export const validateDuplicateRuntimePath = validateCloneRuntimePath
export const validateRuntimePathLifecycle = createBodyValidator(lifecycleRuntimePathBodySchema)
