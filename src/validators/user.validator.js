/**
 * User Validators
 *
 * Zod schemas for user management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

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
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateUser = createBodyValidator(createUserSchema)
export const validateUpdateUser = createBodyValidator(updateUserSchema)
export const validateResendInvitation = createBodyValidator(resendInvitationSchema)
