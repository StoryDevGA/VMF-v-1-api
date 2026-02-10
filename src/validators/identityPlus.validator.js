/**
 * Identity Plus Webhook Validators
 *
 * Zod schemas for incoming Identity Plus webhook payloads.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

/**
 * Payload for the registration-complete webhook.
 * Fired by Identity Plus when a user finishes sign-up / identity verification.
 */
const registrationCompleteSchema = z.object({
  externalId: z
    .string({ required_error: 'externalId is required' })
    .min(1, 'externalId must not be empty')
    .max(500, 'externalId too long'),
  email: z
    .string({ required_error: 'email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email format')
    .max(255, 'Email must be 255 characters or fewer'),
  registeredAt: z
    .string()
    .datetime({ message: 'registeredAt must be a valid ISO 8601 date' })
    .optional(),
})

/**
 * Payload for the trust-updated webhook.
 * Fired by Identity Plus when trust status changes externally
 * (e.g. manual revocation in the provider dashboard).
 */
const trustUpdatedSchema = z.object({
  externalId: z
    .string({ required_error: 'externalId is required' })
    .min(1, 'externalId must not be empty')
    .max(500, 'externalId too long'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email format')
    .max(255, 'Email must be 255 characters or fewer')
    .optional(),
  trustStatus: z.enum(['TRUSTED', 'REVOKED'], {
    required_error: 'trustStatus is required',
    invalid_type_error: 'trustStatus must be TRUSTED or REVOKED',
  }),
  updatedAt: z
    .string()
    .datetime({ message: 'updatedAt must be a valid ISO 8601 date' })
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
        message: 'Invalid webhook payload.',
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

export const validateRegistrationComplete = validate(registrationCompleteSchema)
export const validateTrustUpdated = validate(trustUpdatedSchema)
