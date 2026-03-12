/**
 * Bulk Operation Validators
 *
 * Zod schemas for bulk user management endpoints:
 *   - bulkCreateUsers  — POST /api/v1/customers/:customerId/users/bulk
 *   - bulkUpdateUsers  — PATCH /api/v1/customers/:customerId/users/bulk
 *   - bulkDisableUsers — POST /api/v1/customers/:customerId/users/bulk-disable
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

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

/**
 * Bulk Create — up to 100 users per request.
 */
const bulkCreateUsersSchema = z.object({
  users: z
    .array(
      z.object({
        name: nameSchema,
        email: emailSchema,
        roles: rolesSchema,
        tenantVisibility: tenantVisibilitySchema,
      }),
      { required_error: 'users array is required' },
    )
    .min(1, 'At least one user is required')
    .max(100, 'Maximum 100 users per request'),
  sendInvitations: z
    .boolean()
    .optional()
    .default(true),
})

/**
 * Bulk Update — up to 100 users per request.
 * Each entry must include a userId and at least one field to update.
 */
const bulkUpdateUsersSchema = z.object({
  users: z
    .array(
      z.object({
        userId: z
          .string({ required_error: 'userId is required' })
          .regex(objectIdRegex, 'userId must be a valid ObjectId'),
        roles: z
          .array(z.string().trim().min(1, 'Role must not be empty'))
          .min(1, 'At least one role is required')
          .optional(),
        tenantVisibility: z
          .array(
            z.string().regex(objectIdRegex, 'Each tenant ID must be a valid ObjectId'),
          )
          .optional(),
      }).refine(
        (u) => u.roles !== undefined || u.tenantVisibility !== undefined,
        { message: 'At least one of roles or tenantVisibility must be provided' },
      ),
      { required_error: 'users array is required' },
    )
    .min(1, 'At least one user is required')
    .max(100, 'Maximum 100 users per request'),
})

/**
 * Bulk Disable — up to 100 user IDs per request.
 */
const bulkDisableUsersSchema = z.object({
  userIds: z
    .array(
      z.string().regex(objectIdRegex, 'Each user ID must be a valid ObjectId'),
      { required_error: 'userIds array is required' },
    )
    .min(1, 'At least one user ID is required')
    .max(100, 'Maximum 100 users per request'),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateBulkCreateUsers = createBodyValidator(bulkCreateUsersSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
export const validateBulkUpdateUsers = createBodyValidator(bulkUpdateUsersSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
export const validateBulkDisableUsers = createBodyValidator(bulkDisableUsersSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
