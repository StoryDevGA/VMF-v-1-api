import { z } from 'zod'
import { RUNTIME_VALIDATION_OPERATION_TYPES } from '../models/RuntimeValidationAudit.js'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'
import { VE02_RESULT_SCHEMA } from '../services/runtimeValidation/ve02EvidenceAssessmentResultContract.js'

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
  runtimeInstanceId: optionalTokenSchema('Runtime instance id'),
  customerId: optionalTokenSchema('Customer id'),
  tenantId: optionalTokenSchema('Tenant id'),
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

const assessmentText = z.string().trim().min(1).max(2000)
const assessmentReferences = z.array(assessmentText).max(95)
const categoricalFields = ['source_reliability', 'relevance', 'specificity', 'independence',
  'assessment_result', 'evidence_direction']

const ve02AssessmentIdentitySchema = z.object({
  frameworkKey: frameworkKeySchema,
  packageId: tokenSchema('Package id'),
  runtimeInstanceId: tokenSchema('Runtime instance id'),
  customerId: tokenSchema('Customer id'),
  tenantId: tokenSchema('Tenant id'),
  evidenceId: tokenSchema('Evidence id', 240),
  expectedEvidenceRevisionRef: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  proposedHypothesis: z.object({
    statement: z.string().trim().min(1).max(4000),
    reference: assessmentText.optional(),
  }).strict(),
}).strict()

export const ve02NativeAssessmentBodySchema = ve02AssessmentIdentitySchema.extend({
  claimBinding: z.object({ planId: z.string().regex(/^outcome_kcp_[a-f0-9-]{36}$/),
    requestId: z.string().uuid(), claimKey: z.string().regex(/^claim_[a-f0-9]{32}$/) }).strict().optional(),
}).strict().refine((value) =>
  Buffer.byteLength(JSON.stringify(value)) <= 12000, { message: 'Native assessment request exceeds its size bound.' })

export const validateVE02NativeAssessmentBody = createBodyValidator(ve02NativeAssessmentBodySchema, {
  message: 'Native synthetic VE02 assessment request is invalid.',
})

export const ve02AssessmentDraftBodySchema = ve02AssessmentIdentitySchema.extend({
  judgments: z.object({
    ...Object.fromEntries(categoricalFields.map((key) =>
      [key, z.enum(VE02_RESULT_SCHEMA.properties[key].enum)])),
    assessment_reasons: assessmentReferences.min(1),
    restrictions: assessmentReferences,
    contradiction_refs: assessmentReferences,
  }).strict(),
}).strict().refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 48000, {
  message: 'Assessment draft exceeds the bounded request size.',
})

export const validateVE02AssessmentDraftBody = createBodyValidator(ve02AssessmentDraftBodySchema, {
  message: 'VE02 assessment draft request is invalid.',
})

export const validateVE02SyntheticAssessmentBody = createBodyValidator(z.object({
  draft: ve02AssessmentDraftBodySchema,
  proposedConflict: z.object({ condition: assessmentText, scope: assessmentText, time: assessmentText,
    lineageRefs: z.array(assessmentText).length(2).refine((refs) => refs[0] !== refs[1]),
  }).strict().optional(),
}).strict(), { message: 'Synthetic VE02 assessment request is invalid.' })

export const validateRuntimeValidationHistoryParams = createParamsValidator(historyParamsSchema)

export const validateRuntimeValidationAuditParams = createParamsValidator(auditParamsSchema)

export const validateRuntimeValidationAuditQuery = createQueryValidator(auditQuerySchema)
