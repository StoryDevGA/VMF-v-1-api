/**
 * VMF Validators
 *
 * Zod schemas for VMF management endpoints:
 *   - createVmf   — POST /api/v1/tenants/:tenantId/vmfs
 *   - updateVmf   — PATCH /api/v1/vmfs/:vmfId
 *   - grantAccess — POST /api/v1/vmfs/:vmfId/grants
 *   - revokeAccess — DELETE /api/v1/vmfs/:vmfId/grants/:userId
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                    */
/* ------------------------------------------------------------------ */

const objectIdRegex = /^[a-f\d]{24}$/i

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const createVmfSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer'),
})

const updateVmfSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer')
    .optional(),
  status: z
    .enum(['ACTIVE', 'DISABLED', 'ARCHIVED'], {
      invalid_type_error: 'Status must be ACTIVE, DISABLED, or ARCHIVED',
    })
    .optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
)

const grantAccessSchema = z.object({
  userId: z
    .string({ required_error: 'userId is required' })
    .regex(objectIdRegex, 'userId must be a valid ObjectId'),
  permissions: z
    .array(
      z.string().trim().min(1, 'Permission must not be empty'),
      { required_error: 'permissions is required' },
    )
    .min(1, 'At least one permission is required'),
})

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateVmf = createBodyValidator(createVmfSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
export const validateUpdateVmf = createBodyValidator(updateVmfSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
export const validateGrantAccess = createBodyValidator(grantAccessSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
