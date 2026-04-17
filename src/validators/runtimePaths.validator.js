import { z } from 'zod'
import {
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
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
  isProtected: z
    .preprocess((value) => String(value ?? '').trim().toLowerCase(), z.enum(['true', 'false']))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateRuntimePathId = createParamsValidator(runtimePathIdSchema)
export const validateListRuntimePaths = createQueryValidator(listRuntimePathsQuerySchema)
