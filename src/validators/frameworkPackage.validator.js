import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'

const objectIdRegex = /^[a-f\d]{24}$/i
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const versionRegex = /^\d+\.\d+\.\d+$/
const tokenRegex = /^[a-z][a-z0-9-]*$/

const createStatusValues = [
  FRAMEWORK_PACKAGE_STATUSES.DRAFT,
  FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
  FRAMEWORK_PACKAGE_STATUSES.DEPRECATED,
]

const updateStatusValues = Object.values(FRAMEWORK_PACKAGE_STATUSES)

const tokenListItemSchema = z
  .string()
  .trim()
  .min(1, 'Value is required')
  .max(120, 'Value must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => tokenRegex.test(value),
    'Value must use lowercase letters, numbers, or hyphens',
  )

const tokenListSchema = z
  .array(tokenListItemSchema)
  .max(200, 'List must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const capabilitiesSchema = z.object({
  supportsPreviewMode: z.boolean().default(false),
  supportsFullReport: z.boolean().default(false),
  requiresValidationBeforePublish: z.boolean().default(true),
})

const validationRulesSchema = z.object({
  requiredSections: tokenListSchema.default([]),
  publishChecks: tokenListSchema.default([]),
})

const createFrameworkPackageSchema = z.object({
  frameworkKey: z
    .string({ required_error: 'Framework key is required' })
    .trim()
    .min(1, 'Framework key is required')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    ),
  frameworkName: z
    .string({ required_error: 'Framework name is required' })
    .trim()
    .min(1, 'Framework name is required')
    .max(120, 'Framework name must be 120 characters or fewer'),
  version: z
    .string({ required_error: 'Version is required' })
    .trim()
    .min(1, 'Version is required')
    .max(50, 'Version must be 50 characters or fewer')
    .refine((value) => versionRegex.test(value), 'Version must use semantic version format'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .default(''),
  status: z
    .enum(createStatusValues)
    .default(FRAMEWORK_PACKAGE_STATUSES.DRAFT),
  compatibleWorkflowKeys: tokenListSchema.default([]),
  defaultAgentIds: tokenListSchema.default([]),
  requiredSkillIds: tokenListSchema.default([]),
  capabilities: capabilitiesSchema.default({
    supportsPreviewMode: false,
    supportsFullReport: false,
    requiresValidationBeforePublish: true,
  }),
  validationRules: validationRulesSchema.default({
    requiredSections: [],
    publishChecks: [],
  }),
})

const updateFrameworkPackageSchema = z.object({
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'Framework key must not be empty')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    )
    .optional(),
  frameworkName: z
    .string()
    .trim()
    .min(1, 'Framework name must not be empty')
    .max(120, 'Framework name must be 120 characters or fewer')
    .optional(),
  version: z
    .string()
    .trim()
    .min(1, 'Version must not be empty')
    .max(50, 'Version must be 50 characters or fewer')
    .refine((value) => versionRegex.test(value), 'Version must use semantic version format')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
  status: z
    .enum(updateStatusValues)
    .optional(),
  compatibleWorkflowKeys: tokenListSchema.optional(),
  defaultAgentIds: tokenListSchema.optional(),
  requiredSkillIds: tokenListSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
  validationRules: validationRulesSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['frameworkKey'] },
)

const frameworkPackageIdSchema = z.object({
  packageId: z
    .string({ required_error: 'packageId is required' })
    .regex(objectIdRegex, 'packageId must be a valid ObjectId'),
})

const listFrameworkPackagesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z
    .enum(updateStatusValues)
    .optional(),
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'Framework key must not be empty')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    )
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateFrameworkPackage = createBodyValidator(createFrameworkPackageSchema)
export const validateUpdateFrameworkPackage = createBodyValidator(updateFrameworkPackageSchema)
export const validateFrameworkPackageId = createParamsValidator(frameworkPackageIdSchema)
export const validateListFrameworkPackages = createQueryValidator(listFrameworkPackagesQuerySchema)
