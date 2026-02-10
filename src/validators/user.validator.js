/**
 * User Validators
 *
 * Zod schemas for user management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Shared patterns                                                   */
/* ------------------------------------------------------------------ */

const objectIdRegex = /^[a-f\d]{24}$/i

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Must be a valid email address')
  .max(255, 'Email must be 255 characters or fewer')

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(255, 'Name must be 255 characters or fewer')

const rolesSchema = z
  .array(
    z.string().trim().min(1, 'Role must not be empty'),
    { required_error: 'Roles are required' },
  )
  .min(1, 'At least one role is required')

const tenantVisibilitySchema = z
  .array(
    z.string().regex(objectIdRegex, 'Each tenant ID must be a valid ObjectId'),
  )
  .optional()
  .default([])

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  roles: rolesSchema,
  tenantVisibility: tenantVisibilitySchema,
})

const updateUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer')
    .optional(),
  roles: z
    .array(z.string().trim().min(1, 'Role must not be empty'))
    .min(1, 'At least one role is required')
    .optional(),
  tenantVisibility: z
    .array(
      z.string().regex(objectIdRegex, 'Each tenant ID must be a valid ObjectId'),
    )
    .optional(),
})

const resendInvitationSchema = z.object({
  redirectUrl: z
    .string()
    .trim()
    .url('Must be a valid URL')
    .optional(),
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

export const validateCreateUser = validate(createUserSchema)
export const validateUpdateUser = validate(updateUserSchema)
export const validateResendInvitation = validate(resendInvitationSchema)
