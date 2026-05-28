import { z } from 'zod'
import { RUNTIME_INSTANCE_STATUSES, RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const runtimeInstanceIdSchema = z.object({
  runtimeInstanceId: z
    .string({ required_error: 'runtimeInstanceId is required' })
    .trim()
    .min(1, 'runtimeInstanceId is required')
    .max(180, 'runtimeInstanceId must be 180 characters or fewer'),
})

const runtimeActionParamsSchema = runtimeInstanceIdSchema.extend({
  actionKey: z
    .string({ required_error: 'actionKey is required' })
    .trim()
    .min(1, 'actionKey is required')
    .max(80, 'actionKey must be 80 characters or fewer')
    .transform((value) => value.toUpperCase()),
})

const expectedUpdatedAtSchema = z
  .string({ required_error: 'expectedUpdatedAt is required' })
  .trim()
  .min(1, 'expectedUpdatedAt is required')
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: 'expectedUpdatedAt must be a valid timestamp',
  })

const createRuntimeInstanceSchema = z.object({
  customerId: z
    .string({ required_error: 'customerId is required' })
    .regex(objectIdRegex, 'customerId must be a valid ObjectId'),
  tenantId: z
    .string({ required_error: 'tenantId is required' })
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId'),
  frameworkPackageId: z
    .string({ required_error: 'frameworkPackageId is required' })
    .regex(objectIdRegex, 'frameworkPackageId must be a valid ObjectId'),
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'frameworkKey must not be empty')
    .max(80, 'frameworkKey must be 80 characters or fewer')
    .optional()
    .default('VMF'),
  runtimeType: z
    .enum(Object.values(RUNTIME_TYPES), {
      invalid_type_error: 'runtimeType must be a supported runtime type',
    })
    .optional()
    .default(RUNTIME_TYPES.VALUE_NARRATIVE),
  runtimeInstanceKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{2,159}$/, 'runtimeInstanceKey must use lowercase letters, numbers, or hyphens')
    .optional(),
  workspaceId: z
    .string()
    .trim()
    .max(160, 'workspaceId must be 160 characters or fewer')
    .optional(),
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or fewer')
    .optional()
    .default(''),
}).strict()

const mutateRuntimeStateSchema = z.object({
  runtimePath: z
    .string({ required_error: 'runtimePath is required' })
    .trim()
    .min(1, 'runtimePath is required')
    .max(200, 'runtimePath must be 200 characters or fewer'),
  operation: z
    .string({ required_error: 'operation is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === 'WRITE', {
      message: 'operation must be WRITE',
    }),
  value: z
    .any()
    .refine((value) => value !== undefined, {
      message: 'value is required',
    }),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  saveAndNext: z.boolean().optional(),
}).strict()

const discoveryInputsSchema = z.object({
  companyWebsite: z.string().trim().max(500, 'companyWebsite must be 500 characters or fewer').optional().default(''),
  companyName: z.string().trim().max(255, 'companyName must be 255 characters or fewer').optional().default(''),
  marketRegion: z.string().trim().max(255, 'marketRegion must be 255 characters or fewer').optional().default(''),
  targetOffer: z.string().trim().max(500, 'targetOffer must be 500 characters or fewer').optional().default(''),
  notes: z.string().trim().max(4000, 'notes must be 4000 characters or fewer').optional().default(''),
}).strict()

const updateDiscoveryInputsSchema = z.object({
  inputs: discoveryInputsSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict()

const acceptRuntimeDiscoverySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict()

const acceptRuntimeSectionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  runtimePath: z
    .string()
    .trim()
    .min(1, 'runtimePath must not be empty')
    .max(200, 'runtimePath must be 200 characters or fewer')
    .optional(),
  sectionKey: z
    .string()
    .trim()
    .min(1, 'sectionKey must not be empty')
    .max(120, 'sectionKey must be 120 characters or fewer')
    .optional(),
}).strict()

const executeRuntimeActionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  inputs: discoveryInputsSchema.optional(),
  runtimePath: z
    .string()
    .trim()
    .min(1, 'runtimePath must not be empty')
    .max(200, 'runtimePath must be 200 characters or fewer')
    .optional(),
  sectionKey: z
    .string()
    .trim()
    .min(1, 'sectionKey must not be empty')
    .max(120, 'sectionKey must be 120 characters or fewer')
    .optional(),
  forceRegenerateReason: z
    .string()
    .trim()
    .min(1, 'forceRegenerateReason must not be empty')
    .max(500, 'forceRegenerateReason must be 500 characters or fewer')
    .optional(),
  additionalContext: z
    .string()
    .trim()
    .min(1, 'additionalContext must not be empty')
    .max(4000, 'additionalContext must be 4000 characters or fewer')
    .optional(),
  generationMode: z
    .enum(['ENRICHED_SECTION_TRUTH'])
    .optional(),
}).strict()

const GENERATION_RUNTIME_ACTIONS = new Set(['GENERATE_SECTION', 'REGENERATE_SECTION'])
const DISCOVERY_INPUT_RUNTIME_ACTIONS = new Set([
  'SAVE_DISCOVERY_INPUTS',
  'BUILD_EVIDENCE_PACK',
  'REFRESH_EVIDENCE_PACK',
])

const getSectionKeyFromRuntimePath = (runtimePath) => {
  const pathParts = String(runtimePath || '').trim().split('.').filter(Boolean)
  if (pathParts[0] !== 'framework_state' || pathParts[1] !== 'sections') return ''
  return String(pathParts[2] || '').trim()
}

const buildExecuteRuntimeActionSchema = (actionKey) => executeRuntimeActionSchema.superRefine((data, ctx) => {
  const hasRuntimePath = data.runtimePath !== undefined
  const hasSectionKey = data.sectionKey !== undefined
  const hasInputs = data.inputs !== undefined
  const hasForceRegenerateReason = data.forceRegenerateReason !== undefined
  const hasAdditionalContext = data.additionalContext !== undefined
  const hasGenerationMode = data.generationMode !== undefined

  if (GENERATION_RUNTIME_ACTIONS.has(actionKey)) {
    if (!hasRuntimePath && !hasSectionKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['_root'],
        message: 'Generation actions require runtimePath or sectionKey.',
      })
    }

    if (hasRuntimePath && hasSectionKey) {
      const runtimePathSectionKey = getSectionKeyFromRuntimePath(data.runtimePath)
      const sectionKeyLooksStateBacked = /^[a-z][a-z0-9_]*$/i.test(data.sectionKey)
      if (sectionKeyLooksStateBacked && runtimePathSectionKey && runtimePathSectionKey !== data.sectionKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['_root'],
          message: 'runtimePath and sectionKey must target the same section.',
        })
      }
    }
  } else if (hasRuntimePath || hasSectionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'runtimePath and sectionKey are only allowed for generation actions.',
    })
  }

  if ((hasAdditionalContext || hasGenerationMode) && !GENERATION_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'additionalContext and generationMode are only allowed for generation actions.',
    })
  }

  if (hasForceRegenerateReason && actionKey !== 'REGENERATE_SECTION') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'forceRegenerateReason is only allowed for REGENERATE_SECTION.',
    })
  }

  if (hasInputs && !DISCOVERY_INPUT_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'inputs are only allowed for discovery evidence build actions.',
    })
  }
})

const buildValidationErrorResponse = ({ details, message, requestId }) => ({
  error: {
    code: 'VALIDATION_FAILED',
    message,
    details,
    requestId,
  },
})

const listRuntimeInstancesSchema = z.object({
  customerId: z
    .string({ required_error: 'customerId is required' })
    .regex(objectIdRegex, 'customerId must be a valid ObjectId'),
  tenantId: z
    .string({ required_error: 'tenantId is required' })
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId'),
  // Keep preprocess instead of z.enum(required_error): this Zod version emits
  // the generic enum message for missing query values.
  runtimeType: z
    .preprocess(
      (value) => (value === undefined ? '' : value),
      z
        .string()
        .trim()
        .min(1, 'runtimeType is required')
        .refine(
          (value) => !value || Object.values(RUNTIME_TYPES).includes(value),
          'runtimeType must be a supported runtime type',
        ),
    ),
  status: z
    .enum(Object.values(RUNTIME_INSTANCE_STATUSES), {
      invalid_type_error: 'status must be a supported runtime instance status',
    })
    .optional(),
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict()

export const validateCreateRuntimeInstance = createBodyValidator(createRuntimeInstanceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateMutateRuntimeState = createBodyValidator(mutateRuntimeStateSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateUpdateDiscoveryInputs = createBodyValidator(updateDiscoveryInputsSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateAcceptRuntimeDiscovery = createBodyValidator(acceptRuntimeDiscoverySchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateAcceptRuntimeSection = (req, res, next) => {
  const result = acceptRuntimeSectionSchema.safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root'
      details[key] = issue.message
    }

    return res.status(422).json(buildValidationErrorResponse({
      details,
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  if (!result.data.runtimePath && !result.data.sectionKey) {
    return res.status(422).json(buildValidationErrorResponse({
      details: {
        _root: 'Section acceptance requires runtimePath or sectionKey.',
      },
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  req.body = result.data
  return next()
}

export const validateExecuteRuntimeAction = (req, res, next) => {
  const actionKey = String(req.params?.actionKey || '').trim().toUpperCase()
  const result = buildExecuteRuntimeActionSchema(actionKey).safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root'
      details[key] = issue.message
    }

    return res.status(422).json(buildValidationErrorResponse({
      details,
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  req.body = result.data
  return next()
}

export const validateListRuntimeInstances = createQueryValidator(listRuntimeInstancesSchema, {
  message: 'Invalid query parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeInstanceId = createParamsValidator(runtimeInstanceIdSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeActionParams = createParamsValidator(runtimeActionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})
