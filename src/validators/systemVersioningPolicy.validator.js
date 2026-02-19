import { z } from 'zod'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const createPolicySchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(255, 'name must be 255 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'description must be 1000 characters or fewer')
    .optional(),
  rules: z
    .record(z.string(), z.any(), { invalid_type_error: 'rules must be an object' })
    .refine((rules) => Object.keys(rules).length > 0, {
      message: 'rules must not be empty',
    }),
  reason: z
    .string({ required_error: 'reason is required' })
    .trim()
    .min(1, 'reason is required')
    .max(500, 'reason must be 500 characters or fewer'),
})

const patchPolicySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(1000).optional(),
    reason: z
      .string({ required_error: 'reason is required' })
      .trim()
      .min(1, 'reason is required')
      .max(500, 'reason must be 500 characters or fewer'),
    rules: z.any().optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'At least one of name or description must be provided.',
  })

const policyIdSchema = z.object({
  policyId: z
    .string({ required_error: 'policyId is required' })
    .regex(objectIdRegex, 'policyId must be a valid ObjectId'),
})

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreatePolicy = createBodyValidator(createPolicySchema)
export const validatePatchPolicy = createBodyValidator(patchPolicySchema)
export const validatePolicyId = createParamsValidator(policyIdSchema)
export const validatePolicyHistoryQuery = createQueryValidator(historyQuerySchema)
