/**
 * Tenant Validators
 *
 * Zod schemas for tenant management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const objectIdRegex = /^[a-f\d]{24}$/i

const createTenantSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or fewer'),
  website: z
    .string({ required_error: 'Website is required' })
    .trim()
    .url('Website must be a valid URL')
    .max(500, 'Website must be 500 characters or fewer'),
  tenantAdminUserIds: z
    .array(
      z.string().regex(objectIdRegex, 'Each tenantAdminUserId must be a valid ObjectId'),
      { required_error: 'tenantAdminUserIds is required' },
    )
    .min(1, 'At least one tenant admin is required'),
})

const updateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer')
    .optional(),
  website: z
    .string()
    .trim()
    .url('Website must be a valid URL')
    .max(500, 'Website must be 500 characters or fewer')
    .optional(),
  tenantAdminUserIds: z
    .array(
      z.string().regex(objectIdRegex, 'Each tenantAdminUserId must be a valid ObjectId'),
    )
    .min(1, 'At least one tenant admin is required')
    .optional(),
})

/* ------------------------------------------------------------------ */
/*  Middleware factory                                                 */
/* ------------------------------------------------------------------ */

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

export const validateCreateTenant = validate(createTenantSchema)
export const validateUpdateTenant = validate(updateTenantSchema)
