/**
 * User Validators
 *
 * Zod schemas for user management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator, createQueryValidator } from './shared.js'

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

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const createUserSchema = z
  .object({
    existingUserId: z
      .string()
      .regex(objectIdRegex, 'existingUserId must be a valid ObjectId')
      .optional(),
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    roles: rolesSchema,
    tenantVisibility: tenantVisibilitySchema,
  })
  .superRefine((val, ctx) => {
    const isExistingUserPath = Boolean(val.existingUserId)
    if (isExistingUserPath) return

    if (!val.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'name is required when existingUserId is not provided',
      })
    }

    if (!val.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'email is required when existingUserId is not provided',
      })
    }
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

const normalizeOptionalQueryString = (value) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

const listUsersQuerySchema = z.object({
  q: z.preprocess(
    normalizeOptionalQueryString,
    z
      .string()
      .max(255, 'q must be 255 characters or fewer')
      .optional(),
  ),
  status: z.preprocess(
    (value) => {
      const normalized = normalizeOptionalQueryString(value)
      if (normalized === undefined) return undefined
      if (typeof normalized !== 'string') return normalized
      return normalized.toUpperCase()
    },
    z
      .enum(['ACTIVE', 'INACTIVE', 'DISABLED'])
      .transform((value) => (value === 'DISABLED' ? 'INACTIVE' : value))
      .optional(),
  ),
  role: z.preprocess(
    normalizeOptionalQueryString,
    z
      .string()
      .max(100, 'role must be 100 characters or fewer')
      .optional(),
  ),
  page: z.coerce
    .number()
    .int('page must be an integer')
    .min(1, 'page must be at least 1')
    .default(1),
  pageSize: z.coerce
    .number()
    .int('pageSize must be an integer')
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize must be 100 or fewer')
    .default(20),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateUser = createBodyValidator(createUserSchema)
export const validateUpdateUser = createBodyValidator(updateUserSchema)
export const validateResendInvitation = createBodyValidator(resendInvitationSchema)
export const validateListUsersQuery = createQueryValidator(listUsersQuerySchema)
