/**
 * Customer Validators
 *
 * Zod schemas for customer management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const topologyEnum = z.enum(['SINGLE_TENANT', 'MULTI_TENANT'], {
  required_error: 'Topology is required',
  invalid_type_error: 'Topology must be SINGLE_TENANT or MULTI_TENANT',
})

const vmfPolicyEnum = z.enum(
  ['SINGLE', 'MULTI', 'PER_TENANT_SINGLE', 'PER_TENANT_MULTI'],
  {
    required_error: 'VMF policy is required',
    invalid_type_error:
      'VMF policy must be SINGLE, MULTI, PER_TENANT_SINGLE, or PER_TENANT_MULTI',
  },
)

const websiteSchema = z
  .string()
  .trim()
  .url('Website must be a valid URL')
  .max(500, 'Website must be 500 characters or fewer')

const billingSchema = z.object({
  planCode: z
    .string({ required_error: 'Plan code is required' })
    .trim()
    .min(1, 'Plan code is required')
    .max(100, 'Plan code must be 100 characters or fewer'),
  cycle: z
    .enum(['MONTHLY', 'QUARTERLY', 'ANNUAL'], {
      invalid_type_error: 'Cycle must be MONTHLY, QUARTERLY, or ANNUAL',
    })
    .default('MONTHLY'),
})

const trialSchema = z
  .object({
    isTrial: z.boolean().default(false),
    endsAt: z.string().datetime({ message: 'endsAt must be a valid ISO date' }).optional(),
  })
  .refine(
    (val) => !val.isTrial || val.endsAt,
    { message: 'endsAt is required when isTrial is true', path: ['endsAt'] },
  )

const objectIdRegex = /^[a-f\d]{24}$/i

const objectIdString = z
  .string()
  .regex(objectIdRegex, 'Must be a valid ObjectId')

const governanceSchema = z
  .object({
    maxTenants: z
      .number({ invalid_type_error: 'maxTenants must be a number' })
      .int('maxTenants must be an integer')
      .min(1, 'maxTenants must be at least 1')
      .max(10000, 'maxTenants must be 10000 or fewer')
      .optional(),
    maxVmfsPerTenant: z
      .number({ invalid_type_error: 'maxVmfsPerTenant must be a number' })
      .int('maxVmfsPerTenant must be an integer')
      .min(1, 'maxVmfsPerTenant must be at least 1')
      .max(10000, 'maxVmfsPerTenant must be 10000 or fewer')
      .optional(),
    customerAdminUserId: objectIdString.optional(),
  })
  .optional()

const governanceUpdateSchema = z
  .object({
    maxTenants: z
      .number({ invalid_type_error: 'maxTenants must be a number' })
      .int('maxTenants must be an integer')
      .min(1, 'maxTenants must be at least 1')
      .max(10000, 'maxTenants must be 10000 or fewer')
      .optional(),
    maxVmfsPerTenant: z
      .number({ invalid_type_error: 'maxVmfsPerTenant must be a number' })
      .int('maxVmfsPerTenant must be an integer')
      .min(1, 'maxVmfsPerTenant must be at least 1')
      .max(10000, 'maxVmfsPerTenant must be 10000 or fewer')
      .optional(),
  })
  .strict()
  .optional()

const createCustomerSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(255, 'Name must be 255 characters or fewer'),
    website: websiteSchema.optional(),
    topology: topologyEnum,
    vmfPolicy: vmfPolicyEnum,
    isServiceProvider: z.boolean().default(false),
    licenseLevelId: objectIdString.optional(),
    governance: governanceSchema,
    entitlements: z.array(z.string().trim()).default([]),
    billing: billingSchema,
    trial: trialSchema.optional(),
  })
  .refine(
    (val) => {
      if (val.topology === 'SINGLE_TENANT') {
        return ['SINGLE', 'MULTI'].includes(val.vmfPolicy)
      }
      return ['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(val.vmfPolicy)
    },
    {
      message:
        'Single-tenant requires SINGLE or MULTI vmfPolicy; multi-tenant requires PER_TENANT_SINGLE or PER_TENANT_MULTI.',
      path: ['vmfPolicy'],
    },
  )

const updateCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer')
    .optional(),
  website: websiteSchema.optional(),
  isServiceProvider: z.boolean().optional(),
  licenseLevelId: objectIdString.optional(),
  governance: governanceUpdateSchema,
  entitlements: z.array(z.string().trim()).optional(),
  billing: billingSchema.optional(),
  trial: trialSchema.optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISABLED', 'ARCHIVED'], {
    required_error: 'Status is required',
    invalid_type_error: 'Status must be ACTIVE, INACTIVE, DISABLED, or ARCHIVED',
  }),
})

const assignAdminSchema = z
  .object({
    userId: z
      .string()
      .regex(objectIdRegex, 'userId must be a valid ObjectId')
      .optional(),
    recipientEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email('recipientEmail must be a valid email')
      .max(255, 'recipientEmail must be 255 characters or fewer')
      .optional(),
    recipientName: z
      .string()
      .trim()
      .min(1, 'recipientName is required')
      .max(255, 'recipientName must be 255 characters or fewer')
      .optional(),
  })
  .superRefine((val, ctx) => {
    const hasUserId = Boolean(val.userId)
    const hasRecipientEmail = Boolean(val.recipientEmail)
    const hasRecipientName = Boolean(val.recipientName)

    if (!hasUserId && !hasRecipientEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'userId is required when recipientEmail is not provided',
      })
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientEmail'],
        message: 'recipientEmail is required when userId is not provided',
      })
    }

    if (!hasUserId && hasRecipientEmail && !hasRecipientName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientName'],
        message: 'recipientName is required when recipientEmail is provided without userId',
      })
    }

    if (hasRecipientName && !hasRecipientEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientEmail'],
        message: 'recipientEmail is required when recipientName is provided',
      })
    }
  })

const createAdminInvitationSchema = z.object({
  recipientEmail: z
    .string({ required_error: 'recipientEmail is required' })
    .trim()
    .toLowerCase()
    .email('recipientEmail must be a valid email')
    .max(255, 'recipientEmail must be 255 characters or fewer'),
  recipientName: z
    .string({ required_error: 'recipientName is required' })
    .trim()
    .min(1, 'recipientName is required')
    .max(255, 'recipientName must be 255 characters or fewer'),
})

const replaceAdminSchema = z.object({
  newUserId: z
    .string({ required_error: 'newUserId is required' })
    .regex(objectIdRegex, 'newUserId must be a valid ObjectId'),
  reason: z
    .string({ required_error: 'reason is required' })
    .trim()
    .min(1, 'reason is required')
    .max(500, 'reason must be 500 characters or fewer'),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateCustomer = createBodyValidator(createCustomerSchema)
export const validateUpdateCustomer = createBodyValidator(updateCustomerSchema)
export const validateUpdateStatus = createBodyValidator(updateStatusSchema)
export const validateAssignAdmin = createBodyValidator(assignAdminSchema)
export const validateCreateAdminInvitation = createBodyValidator(createAdminInvitationSchema)
export const validateReplaceAdmin = createBodyValidator(replaceAdminSchema)
