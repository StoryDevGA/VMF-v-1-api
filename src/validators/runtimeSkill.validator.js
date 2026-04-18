import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  RUNTIME_SKILL_EXECUTION_MODES,
  RUNTIME_SKILL_STATUSES,
} from '../models/RuntimeSkill.js'

const keyRegex = /^[a-z][a-z0-9-]*$/
const skillIdRegex = /^skill-[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const enumTokenRegex = /^[A-Z][A-Z0-9_]*$/
const outputBindingRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/
const primaryOutputSelectionRegex = /^(\$root|[a-zA-Z][a-zA-Z0-9_]*)$/
const assetIdRegex = /^asset-[a-z0-9-]{6,}$/
const REFERENCE_ASSET_PURPOSES = Object.freeze([
  'AUTHORING_HELP',
  'RUNTIME_REFERENCE',
  'EXAMPLE_INPUT',
  'EXAMPLE_OUTPUT',
  'TEMPLATE',
  'POLICY_GUIDANCE',
  'TEST_ASSET',
])
const REFERENCE_ASSET_USAGE_MODES = Object.freeze([
  'OPTIONAL',
  'REQUIRED',
  'TEST_ONLY',
])
const REFERENCE_ASSET_STATUSES = Object.freeze([
  'ACTIVE',
  'INACTIVE',
])

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

const supportedFrameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one supported framework key is required.')
  .max(20, 'Supported framework keys must contain 20 items or fewer')
  .transform((values) => [...new Set(values)])

const enumTokenSchema = (fieldLabel) =>
  z
    .string()
    .trim()
    .min(1, `${fieldLabel} is required`)
    .max(100, `${fieldLabel} must be 100 characters or fewer`)
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => enumTokenRegex.test(value),
      `${fieldLabel} must use uppercase letters, numbers, or underscores`,
    )

const objectSchema = (fieldLabel) =>
  z.object({}).catchall(z.unknown()).refine(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
    `${fieldLabel} must be an object.`,
  )

const outputBindingSchema = z
  .string()
  .trim()
  .min(1, 'Output binding is required')
  .max(120, 'Output binding must be 120 characters or fewer')
  .refine(
    (value) => outputBindingRegex.test(value),
    'Output binding must start with a letter and only use letters, numbers, or underscores.',
  )

const optionalPrimaryOutputSelectionSchema = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
  z
    .string()
    .trim()
    // NOTE: Empty strings are preprocessed to undefined, so this min() is only relevant for
    // non-empty inputs and primarily documents the intended field semantics.
    .min(1, 'Primary output selection is required')
    .max(120, 'Primary output selection must be 120 characters or fewer')
    .refine(
      (value) => primaryOutputSelectionRegex.test(value),
      'Primary output selection must be $root or start with a letter and only use letters, numbers, or underscores.',
    )
    .optional(),
)

const pathSchema = z
  .string()
  .trim()
  .min(1, 'Path is required')
  .max(200, 'Path must be 200 characters or fewer')
  .refine(
    (value) => !/\s/.test(value),
    'Path must not contain whitespace.',
  )

const uniqueList = (values) => [...new Set(values)]

const runtimeSkillReferenceAssetSchema = z.object({
  assetId: z
    .string()
    .trim()
    .min(1, 'Asset id is required')
    .max(120, 'Asset id must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine((value) => assetIdRegex.test(value), 'Asset id must use the asset-<token> format'),
  name: z
    .string({ required_error: 'Asset name is required' })
    .trim()
    .min(1, 'Asset name is required')
    .max(140, 'Asset name must be 140 characters or fewer'),
  assetType: z
    .string()
    .trim()
    .max(40, 'Asset type must be 40 characters or fewer')
    .transform((value) => value.toUpperCase())
    .default('OTHER'),
  mimeType: z
    .string()
    .trim()
    .max(140, 'Mime type must be 140 characters or fewer')
    .default(''),
  purpose: z
    .string()
    .trim()
    .min(1, 'Asset purpose is required')
    .max(60, 'Asset purpose must be 60 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => REFERENCE_ASSET_PURPOSES.includes(value),
      `Asset purpose must be one of: ${REFERENCE_ASSET_PURPOSES.join(', ')}`,
    ),
  usageMode: z
    .string()
    .trim()
    .max(40, 'Usage mode must be 40 characters or fewer')
    .transform((value) => value.toUpperCase())
    .transform((value) => (value === 'TESTING' ? 'TEST_ONLY' : value))
    .refine(
      (value) => REFERENCE_ASSET_USAGE_MODES.includes(value),
      `Usage mode must be one of: ${REFERENCE_ASSET_USAGE_MODES.join(', ')}`,
    )
    .default('OPTIONAL'),
  status: z
    .string()
    .trim()
    .max(40, 'Asset status must be 40 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => REFERENCE_ASSET_STATUSES.includes(value),
      `Asset status must be one of: ${REFERENCE_ASSET_STATUSES.join(', ')}`,
    )
    .default('ACTIVE'),
  isRuntimeAccessible: z.boolean().default(false),
  isAdminOnly: z.boolean().default(false),
  isTestOnly: z.boolean().default(false),
  description: z
    .string()
    .trim()
    .max(500, 'Asset description must be 500 characters or fewer')
    .default(''),
  storageKey: z
    .string()
    .trim()
    .max(500, 'Storage key must be 500 characters or fewer')
    .default(''),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.isRuntimeAccessible && value.isAdminOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isRuntimeAccessible'],
        message: 'Runtime-accessible assets cannot be marked as admin-only.',
      })
    }

    if (value.isRuntimeAccessible && value.isTestOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isRuntimeAccessible'],
        message: 'Runtime-accessible assets cannot be marked as test-only.',
      })
    }

    if (value.usageMode === 'TEST_ONLY' && !value.isTestOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isTestOnly'],
        message: 'Test-only usage mode requires the asset to be marked as test-only.',
      })
    }

    if (value.purpose === 'TEST_ASSET' && !value.isTestOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isTestOnly'],
        message: 'Test asset purpose requires the asset to be marked as test-only.',
      })
    }

    if (value.usageMode === 'REQUIRED' && !String(value.storageKey || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageKey'],
        message: 'Required assets must include a storage key or URL.',
      })
    }

    if (value.isRuntimeAccessible && !String(value.storageKey || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageKey'],
        message: 'Runtime-accessible assets must include a storage key or URL.',
      })
    }
  })

const createRuntimeSkillSchema = z.object({
  key: z
    .string({ required_error: 'Skill key is required' })
    .trim()
    .min(1, 'Skill key is required')
    .max(120, 'Skill key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Skill key must use lowercase letters, numbers, or hyphens',
    ),
  name: z
    .string({ required_error: 'Skill name is required' })
    .trim()
    .min(1, 'Skill name is required')
    .max(120, 'Skill name must be 120 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .default(''),
  status: z
    .enum(Object.values(RUNTIME_SKILL_STATUSES))
    .default(RUNTIME_SKILL_STATUSES.ACTIVE),
  supportedFrameworkKeys: supportedFrameworkKeysSchema,
  category: enumTokenSchema('Skill category').default('GENERAL'),
  type: enumTokenSchema('Skill type').default('DETERMINISTIC'),
  executionMode: z
    .enum(Object.values(RUNTIME_SKILL_EXECUTION_MODES))
    .default(RUNTIME_SKILL_EXECUTION_MODES.SYSTEM),
  inputContract: objectSchema('Input contract').default({}),
  outputContract: objectSchema('Output contract').default({}),
  runtimeConfig: objectSchema('Runtime config').default({}),
  primaryOutputKey: optionalPrimaryOutputSelectionSchema,
  outputBindings: z
    .array(outputBindingSchema)
    .max(50, 'Output bindings must contain 50 items or fewer')
    .transform(uniqueList)
    .default([]),
  allowedReadPaths: z
    .array(pathSchema)
    .max(100, 'Allowed read paths must contain 100 items or fewer')
    .transform(uniqueList)
    .default([]),
  allowedWritePaths: z
    .array(pathSchema)
    .max(100, 'Allowed write paths must contain 100 items or fewer')
    .transform(uniqueList)
    .default([]),
  forbiddenWritePaths: z
    .array(pathSchema)
    .max(100, 'Forbidden write paths must contain 100 items or fewer')
    .transform(uniqueList)
    .default([]),
  executionConfig: objectSchema('Execution config').default({}),
  referenceAssets: z
    .array(runtimeSkillReferenceAssetSchema)
    .max(50, 'Reference assets must contain 50 items or fewer')
    .default([]),
}).superRefine((value, ctx) => {
  // Intentional duplication: enforced at validator → model → controller for defense-in-depth.
  if (value.type === 'AGENT_ASSISTED' && value.executionMode !== RUNTIME_SKILL_EXECUTION_MODES.AGENT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'Skill type "AGENT_ASSISTED" is only compatible with AGENT execution mode.',
    })
  }

  if (value.primaryOutputKey && value.outputBindings.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryOutputKey'],
      message: 'Provide either a primary output key or output bindings, not both.',
    })
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputBindings'],
      message: 'Provide either a primary output key or output bindings, not both.',
    })
  }

  const allowedWrite = new Set(value.allowedWritePaths)
  const overlap = value.forbiddenWritePaths.find((item) => allowedWrite.has(item))
  if (overlap) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forbiddenWritePaths'],
      message: 'Forbidden write paths must not overlap with allowed write paths.',
    })
  }

  if (value.executionMode === RUNTIME_SKILL_EXECUTION_MODES.SYSTEM && Object.keys(value.executionConfig || {}).length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executionConfig'],
      message: 'Execution config is only supported for rule engine or agent-assisted skills.',
    })
  }
})

const updateRuntimeSkillSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Skill key must not be empty')
    .max(120, 'Skill key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => keyRegex.test(value),
      'Skill key must use lowercase letters, numbers, or hyphens',
    )
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Skill name must not be empty')
    .max(120, 'Skill name must be 120 characters or fewer')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
  status: z
    .enum(Object.values(RUNTIME_SKILL_STATUSES))
    .optional(),
  supportedFrameworkKeys: supportedFrameworkKeysSchema.optional(),
  category: enumTokenSchema('Skill category').optional(),
  type: enumTokenSchema('Skill type').optional(),
  executionMode: z
    .enum(Object.values(RUNTIME_SKILL_EXECUTION_MODES))
    .optional(),
  inputContract: objectSchema('Input contract').optional(),
  outputContract: objectSchema('Output contract').optional(),
  runtimeConfig: objectSchema('Runtime config').optional(),
  primaryOutputKey: optionalPrimaryOutputSelectionSchema.optional(),
  outputBindings: z
    .array(outputBindingSchema)
    .max(50, 'Output bindings must contain 50 items or fewer')
    .transform(uniqueList)
    .optional(),
  allowedReadPaths: z
    .array(pathSchema)
    .max(100, 'Allowed read paths must contain 100 items or fewer')
    .transform(uniqueList)
    .optional(),
  allowedWritePaths: z
    .array(pathSchema)
    .max(100, 'Allowed write paths must contain 100 items or fewer')
    .transform(uniqueList)
    .optional(),
  forbiddenWritePaths: z
    .array(pathSchema)
    .max(100, 'Forbidden write paths must contain 100 items or fewer')
    .transform(uniqueList)
    .optional(),
  executionConfig: objectSchema('Execution config').optional(),
  referenceAssets: z
    .array(runtimeSkillReferenceAssetSchema)
    .max(50, 'Reference assets must contain 50 items or fewer')
    .optional(),
}).superRefine((value, ctx) => {
  // Intentional duplication: enforced at validator → model → controller for defense-in-depth.
  if (
    value.type === 'AGENT_ASSISTED'
    && value.executionMode
    && value.executionMode !== RUNTIME_SKILL_EXECUTION_MODES.AGENT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'Skill type "AGENT_ASSISTED" is only compatible with AGENT execution mode.',
    })
  }

  if (value.primaryOutputKey && Array.isArray(value.outputBindings) && value.outputBindings.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryOutputKey'],
      message: 'Provide either a primary output key or output bindings, not both.',
    })
  }

  if (Array.isArray(value.allowedWritePaths) && Array.isArray(value.forbiddenWritePaths)) {
    const allowedWrite = new Set(value.allowedWritePaths)
    const overlap = value.forbiddenWritePaths.find((item) => allowedWrite.has(item))
    if (overlap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forbiddenWritePaths'],
        message: 'Forbidden write paths must not overlap with allowed write paths.',
      })
    }
  }

  if (value.executionMode === RUNTIME_SKILL_EXECUTION_MODES.SYSTEM && value.executionConfig && Object.keys(value.executionConfig).length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executionConfig'],
      message: 'Execution config is only supported for rule engine or agent-assisted skills.',
    })
  }
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['key'] },
)

const runtimeSkillIdSchema = z.object({
  skillId: z
    .string({ required_error: 'skillId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => skillIdRegex.test(value),
      'skillId must use the stable skill-<key> format',
    ),
})

const listRuntimeSkillsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z
    .enum(Object.values(RUNTIME_SKILL_STATUSES))
    .optional(),
  frameworkKey: frameworkKeySchema.optional(),
  category: enumTokenSchema('Skill category').optional(),
  executionMode: z
    .enum(Object.values(RUNTIME_SKILL_EXECUTION_MODES))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateRuntimeSkill = createBodyValidator(createRuntimeSkillSchema)
export const validateUpdateRuntimeSkill = createBodyValidator(updateRuntimeSkillSchema)
export const validateRuntimeSkillId = createParamsValidator(runtimeSkillIdSchema)
export const validateListRuntimeSkills = createQueryValidator(listRuntimeSkillsQuerySchema)
