/**
 * Auth Validators
 *
 * Zod schemas for authentication endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email format')
    .max(255, 'Email must be 255 characters or fewer'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
})

const refreshSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .min(1, 'Refresh token is required'),
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

export const validateLogin = validate(loginSchema)
export const validateRefresh = validate(refreshSchema)
