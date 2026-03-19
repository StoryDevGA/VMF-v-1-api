/**
 * Tenant Validators
 *
 * Zod schemas for tenant management endpoint input validation.
 * Each export is an Express middleware that validates `req.body`
 * and returns a 422 with field-level details on failure.
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const objectIdRegex = /^[a-f\d]{24}$/i
const singleTenantAdminMessage = 'Only one tenant admin is allowed'

const websiteSchema = z
  .string({ required_error: 'Website is required' })
  .trim()
  .url('Website must be a valid URL')
  .max(500, 'Website must be 500 characters or fewer')

const createTenantSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or fewer'),
  website: websiteSchema,
  tenantAdminUserIds: z
    .array(
      z.string().regex(objectIdRegex, 'Each tenantAdminUserId must be a valid ObjectId'),
      { required_error: 'tenantAdminUserIds is required' },
    )
    .min(1, 'At least one tenant admin is required')
    .max(1, singleTenantAdminMessage),
})

const updateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer')
    .optional(),
  website: websiteSchema.optional(),
  tenantAdminUserIds: z
    .array(
      z.string().regex(objectIdRegex, 'Each tenantAdminUserId must be a valid ObjectId'),
    )
    .min(1, 'At least one tenant admin is required')
    .max(1, singleTenantAdminMessage)
    .optional(),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateTenant = createBodyValidator(createTenantSchema)
export const validateUpdateTenant = createBodyValidator(updateTenantSchema)
