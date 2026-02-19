/**
 * Identity Plus Webhook Validators
 *
 * Zod schemas for incoming Identity Plus webhook payloads.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

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
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateRegistrationComplete = createBodyValidator(registrationCompleteSchema, {
  message: 'Invalid webhook payload.',
})
export const validateTrustUpdated = createBodyValidator(trustUpdatedSchema, {
  message: 'Invalid webhook payload.',
})
