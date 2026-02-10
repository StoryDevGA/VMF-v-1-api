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
/*  Middleware factory                                                 */
/* ------------------------------------------------------------------ */

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root'
      details[key] = issue.message
    }
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
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

export const validateCreateVmf = validate(createVmfSchema)
export const validateUpdateVmf = validate(updateVmfSchema)
export const validateGrantAccess = validate(grantAccessSchema)
