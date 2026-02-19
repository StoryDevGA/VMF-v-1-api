/**
 * Auth Validators
 *
 * Zod schemas for authentication endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

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

const stepUpSchema = z.object({
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateLogin = createBodyValidator(loginSchema)
export const validateRefresh = createBodyValidator(refreshSchema)
export const validateStepUp = createBodyValidator(stepUpSchema)
