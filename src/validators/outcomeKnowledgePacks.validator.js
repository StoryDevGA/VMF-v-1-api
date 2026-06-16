import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'

const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const packIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,179}$/
const versionIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,239}$/
const semanticVersionRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const optionalFrameworkKeySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => !value || frameworkKeyRegex.test(value), 'Framework key must use uppercase letters, numbers, or underscores')
  .optional()

const optionalRuntimeTypeSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value) => value.toUpperCase())
  .optional()

const optionalKeySchema = (label, max = 140) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()

const listKnowledgePacksQuerySchema = z.object({
  q: optionalKeySchema('Search query', 255),
  packType: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES)).optional(),
  packKey: optionalKeySchema('Pack key'),
  status: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_STATUSES)).optional(),
  sortBy: z.enum(['label', 'packKey', 'packType', 'status', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const knowledgePackIdParamsSchema = z.object({
  packId: z
    .string({ required_error: 'packId is required' })
    .trim()
    .refine((value) => packIdRegex.test(value), 'packId must use a safe identifier format'),
})

const knowledgePackVersionParamsSchema = knowledgePackIdParamsSchema.extend({
  versionId: z
    .string({ required_error: 'versionId is required' })
    .trim()
    .refine((value) => versionIdRegex.test(value), 'versionId must use a safe identifier format'),
})

const previewResolutionQuerySchema = z.object({
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  packageVersion: optionalKeySchema('Package version', 60),
  environmentKey: optionalRuntimeTypeSchema,
})

const createKnowledgePackVersionBodySchema = z.object({
  semanticVersion: z
    .string({ required_error: 'semanticVersion is required' })
    .trim()
    .regex(semanticVersionRegex, 'semanticVersion must use major.minor.patch format'),
  schemaVersion: z
    .string()
    .trim()
    .regex(semanticVersionRegex, 'schemaVersion must use major.minor.patch format')
    .default('1.0.0'),
  contentFormat: z
    .enum([OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML])
    .default(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML),
  sourceFilename: z
    .string()
    .trim()
    .max(180, 'sourceFilename must be 180 characters or fewer')
    .optional(),
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(40, 'content must include the starter knowledge pack source')
    .max(750000, 'content must be 750000 characters or fewer'),
}).strict()

const emptyBodySchema = z.object({}).strict()

const supportedActivationScopeTypes = [
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT,
]

const activationScopeFields = {
  scopeType: z
    .enum(supportedActivationScopeTypes)
    .default(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  packageVersion: optionalKeySchema('Package version', 60),
  environmentKey: optionalRuntimeTypeSchema,
}

const validateActivationScope = (value, ctx) => {
  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK && !value.frameworkKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['frameworkKey'],
      message: 'frameworkKey is required for FRAMEWORK scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE && !value.runtimeType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runtimeType'],
      message: 'runtimeType is required for RUNTIME_TYPE scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE && !value.packageKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packageKey'],
      message: 'packageKey is required for PACKAGE scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT && !value.environmentKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['environmentKey'],
      message: 'environmentKey is required for ENVIRONMENT scope',
    })
  }
}

const activateKnowledgePackVersionBodySchema = z
  .object(activationScopeFields)
  .strict()
  .superRefine(validateActivationScope)

const rollbackKnowledgePackBodySchema = z
  .object({
    versionId: z
      .string({ required_error: 'versionId is required' })
      .trim()
      .refine((value) => versionIdRegex.test(value), 'versionId must use a safe identifier format'),
    rollbackReason: optionalKeySchema('Rollback reason', 500),
    ...activationScopeFields,
  })
  .strict()
  .superRefine(validateActivationScope)

export const validateListKnowledgePacks = createQueryValidator(listKnowledgePacksQuerySchema)
export const validateKnowledgePackId = createParamsValidator(knowledgePackIdParamsSchema)
export const validateKnowledgePackVersionParams = createParamsValidator(knowledgePackVersionParamsSchema)
export const validateKnowledgePackResolutionPreview = createQueryValidator(previewResolutionQuerySchema)
export const validateCreateKnowledgePackVersion = createBodyValidator(createKnowledgePackVersionBodySchema)
export const validateImportKnowledgePackStarterVersion = createBodyValidator(emptyBodySchema)
export const validateKnowledgePackVersionActionBody = createBodyValidator(emptyBodySchema)
export const validateActivateKnowledgePackVersion = createBodyValidator(activateKnowledgePackVersionBodySchema)
export const validateRollbackKnowledgePack = createBodyValidator(rollbackKnowledgePackBodySchema)
