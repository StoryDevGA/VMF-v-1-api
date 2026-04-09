import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import { RUNTIME_SKILL_STATUSES } from '../models/RuntimeSkill.js'

const keyRegex = /^[a-z][a-z0-9-]*$/
const skillIdRegex = /^skill-[a-z][a-z0-9-]*$/
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

const supportedFrameworkKeysSchema = z
  .array(frameworkKeySchema)
  .min(1, 'At least one supported framework key is required.')
  .max(20, 'Supported framework keys must contain 20 items or fewer')
  .transform((values) => [...new Set(values)])

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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateRuntimeSkill = createBodyValidator(createRuntimeSkillSchema)
export const validateUpdateRuntimeSkill = createBodyValidator(updateRuntimeSkillSchema)
export const validateRuntimeSkillId = createParamsValidator(runtimeSkillIdSchema)
export const validateListRuntimeSkills = createQueryValidator(listRuntimeSkillsQuerySchema)
