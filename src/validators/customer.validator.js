/**
 * Customer Validators
 *
 * Zod schemas for customer management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'

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

const createCustomerSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(255, 'Name must be 255 characters or fewer'),
    topology: topologyEnum,
    vmfPolicy: vmfPolicyEnum,
    isServiceProvider: z.boolean().default(false),
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
  isServiceProvider: z.boolean().optional(),
  entitlements: z.array(z.string().trim()).optional(),
  billing: billingSchema.optional(),
  trial: trialSchema.optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED'], {
    required_error: 'Status is required',
    invalid_type_error: 'Status must be ACTIVE, DISABLED, or ARCHIVED',
  }),
})

const objectIdRegex = /^[a-f\d]{24}$/i

const assignAdminSchema = z.object({
  userId: z
    .string({ required_error: 'userId is required' })
    .regex(objectIdRegex, 'userId must be a valid ObjectId'),
})

/* ------------------------------------------------------------------ */
/*  Middleware factory                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create an Express middleware that validates `req.body` against a Zod schema.
 * On success, `req.body` is replaced with the parsed (coerced/trimmed) output.
 * On failure, responds 422 with structured field errors.
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.')
      details[key] = issue.message
    }

    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Please check the form for errors.',
        details,
        requestId: req.requestId,
      },
    })
  }

  req.body = result.data
  next()
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateCustomer = validate(createCustomerSchema)
export const validateUpdateCustomer = validate(updateCustomerSchema)
export const validateUpdateStatus = validate(updateStatusSchema)
export const validateAssignAdmin = validate(assignAdminSchema)
