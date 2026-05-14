import { z } from 'zod'
import { RUNTIME_VALIDATION_OPERATION_TYPES } from '../models/RuntimeValidationAudit.js'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const tokenSchema = (label, max = 180) => z
  .string()
  .trim()
  .min(1, `${label} is required.`)
  .max(max, `${label} must be ${max} characters or fewer.`)

const optionalTokenSchema = (label, max = 180) => z
  .string()
  .trim()
  .max(max, `${label} must be ${max} characters or fewer.`)
  .optional()
  .default('')

const frameworkKeySchema = z
  .string()
  .trim()
  .min(1, 'Framework key is required.')
  .max(100, 'Framework key must be 100 characters or fewer.')
  .transform((value) => value.toUpperCase())

const scopeListSchema = z
  .array(z.string().trim().min(1).max(240))
  .max(200)
  .optional()
  .default([])

const objectSchema = z.record(z.string(), z.unknown()).optional().default({})

const runtimeValidationBodySchema = z.object({
  operationType: z.enum(Object.values(RUNTIME_VALIDATION_OPERATION_TYPES)),
  mode: z.enum(['STRICT', 'WARN_ONLY', 'AUDIT_ONLY', 'DISABLED']).optional().default('STRICT'),
  packageId: optionalTokenSchema('Package id'),
  frameworkKey: frameworkKeySchema,
  workspaceId: optionalTokenSchema('Workspace id'),
  actorType: z.enum(['USER', 'AGENT', 'SKILL', 'SYSTEM', 'SERVICE']).optional().default('USER'),
  runtimePath: optionalTokenSchema('Runtime path', 240),
  operation: z.enum(['READ', 'WRITE', 'BIND', 'EXECUTE']).optional(),
  payload: z.unknown().optional(),
  outputContract: objectSchema,
  lifecycleStage: optionalTokenSchema('Lifecycle stage', 120),
  targetLifecycleStage: optionalTokenSchema('Target lifecycle stage', 120),
  skillId: optionalTokenSchema('Skill id'),
  skillRoleKey: optionalTokenSchema('Skill role key', 100).transform((value) => value.toUpperCase()),
  allowedReadScopes: scopeListSchema,
  allowedWriteScopes: scopeListSchema,
  forbiddenReadScopes: scopeListSchema,
  forbiddenWriteScopes: scopeListSchema,
  isPackageLevelValidation: z.boolean().optional().default(false),
  beforeState: z.unknown().optional(),
  afterState: z.unknown().optional(),
})

const historyParamsSchema = z.object({
  packageId: tokenSchema('Package id'),
})

const auditParamsSchema = z.object({
  workspaceId: tokenSchema('Workspace id'),
})

const auditQuerySchema = z.object({
  workspaceId: optionalTokenSchema('Workspace id'),
  packageId: optionalTokenSchema('Package id'),
  frameworkKey: optionalTokenSchema('Framework key', 100).transform((value) => value.toUpperCase()),
  status: z.enum(['PASS', 'WARN', 'FAIL']).optional(),
  result: z.enum(['PASS', 'WARN', 'FAIL', 'ALLOW', 'BLOCK', 'AUDIT_ONLY']).optional(),
  severity: z.enum(['INFO', 'WARN', 'ERROR', 'BLOCKING', 'CRITICAL']).optional(),
  operationType: z.enum(Object.values(RUNTIME_VALIDATION_OPERATION_TYPES)).optional(),
  runtimePath: optionalTokenSchema('Runtime path', 240),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateRuntimeValidationBody = createBodyValidator(runtimeValidationBodySchema, {
  message: 'Runtime validation request is invalid.',
})

export const validateRuntimeValidationHistoryParams = createParamsValidator(historyParamsSchema)

export const validateRuntimeValidationAuditParams = createParamsValidator(auditParamsSchema)

export const validateRuntimeValidationAuditQuery = createQueryValidator(auditQuerySchema)
