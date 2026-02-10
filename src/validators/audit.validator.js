/**
 * Audit Log Validators
 *
 * Zod schemas for audit system endpoints:
 *   - queryAuditLogs       — GET  /api/v1/audit-logs
 *   - getAuditLogsByResource — GET  /api/v1/audit-logs/resource/:resourceType/:resourceId
 *   - verifyIntegrity      — POST /api/v1/audit-logs/verify
 *   - getAuditStats        — GET  /api/v1/audit-logs/stats
 *   - getRetentionInfo     — GET  /api/v1/audit-logs/retention
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Shared patterns                                                   */
/* ------------------------------------------------------------------ */

const objectIdRegex = /^[a-f\d]{24}$/i

const objectIdString = z
  .string()
  .regex(objectIdRegex, 'Must be a valid ObjectId')

const isoDateString = z
  .string()
  .datetime({ message: 'Must be a valid ISO 8601 date' })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'))

const pageParam = z.coerce
  .number()
  .int()
  .min(1, 'Page must be at least 1')
  .default(1)

const pageSizeParam = z.coerce
  .number()
  .int()
  .min(1, 'Page size must be at least 1')
  .max(200, 'Page size must be 200 or fewer')
  .default(50)

/* ------------------------------------------------------------------ */
/*  Audit actions & resource types for enum validation                */
/* ------------------------------------------------------------------ */

const validActions = [
  'CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_STATUS_CHANGED', 'CUSTOMER_ADMIN_ASSIGNED',
  'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_ENABLED', 'TENANT_DISABLED',
  'USER_CREATED', 'USER_INVITED', 'USER_ROLE_UPDATED', 'USER_DISABLED', 'USER_DELETED',
  'BULK_USERS_CREATED', 'BULK_USERS_UPDATED', 'BULK_USERS_DISABLED',
  'VMF_CREATED', 'VMF_UPDATED', 'VMF_DELETED', 'VMF_GRANT_CREATED', 'VMF_GRANT_REVOKED',
  'DEAL_CREATED', 'DEAL_UPDATED', 'DEAL_ARCHIVED',
  'IDENTITY_PLUS_REGISTRATION_COMPLETE', 'IDENTITY_PLUS_TRUST_UPDATED',
]

const validResourceTypes = ['Customer', 'Tenant', 'User', 'VMF', 'Deal']

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

/**
 * Query audit logs — GET /api/v1/audit-logs
 * All parameters come from query string.
 */
const queryAuditLogsSchema = z.object({
  customerId: objectIdString.optional(),
  tenantId: objectIdString.optional(),
  actorUserId: objectIdString.optional(),
  action: z.enum(validActions).optional(),
  resourceType: z.enum(validResourceTypes).optional(),
  resourceId: objectIdString.optional(),
  requestId: z.string().trim().min(1).optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  page: pageParam,
  pageSize: pageSizeParam,
})

/**
 * Get logs for a specific resource — GET /api/v1/audit-logs/resource/:resourceType/:resourceId
 */
const resourceAuditLogsSchema = z.object({
  resourceType: z.enum(validResourceTypes),
  resourceId: objectIdString,
  page: pageParam,
  pageSize: pageSizeParam,
})

/**
 * Verify integrity — POST /api/v1/audit-logs/verify
 */
const verifyIntegritySchema = z.object({
  ids: z.array(objectIdString).min(1).max(1000).optional(),
  customerId: objectIdString.optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
}).refine(
  (data) => data.ids || data.customerId || data.startDate || data.endDate,
  { message: 'At least one filter (ids, customerId, startDate, or endDate) is required' },
)

/**
 * Get stats — GET /api/v1/audit-logs/stats
 */
const auditStatsSchema = z.object({
  customerId: objectIdString.optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
})

/**
 * Get by request ID — GET /api/v1/audit-logs/request/:requestId
 */
const requestIdSchema = z.object({
  requestId: z.string().trim().min(1, 'Request ID is required'),
})

/* ------------------------------------------------------------------ */
/*  Express middleware factories                                      */
/* ------------------------------------------------------------------ */

/**
 * Validate query string for audit log listing.
 */
export const validateQueryAuditLogs = (req, res, next) => {
  const result = queryAuditLogsSchema.safeParse(req.query)
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid query parameters',
        details: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      },
    })
  }
  req.validatedQuery = result.data
  next()
}

/**
 * Validate params + query for resource audit logs.
 */
export const validateResourceAuditLogs = (req, res, next) => {
  const result = resourceAuditLogsSchema.safeParse({
    ...req.params,
    ...req.query,
  })
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid resource parameters',
        details: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      },
    })
  }
  req.validatedQuery = result.data
  next()
}

/**
 * Validate body for integrity verification.
 */
export const validateVerifyIntegrity = (req, res, next) => {
  const result = verifyIntegritySchema.safeParse(req.body)
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid verification parameters',
        details: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      },
    })
  }
  req.validatedBody = result.data
  next()
}

/**
 * Validate query string for audit stats.
 */
export const validateAuditStats = (req, res, next) => {
  const result = auditStatsSchema.safeParse(req.query)
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid stats parameters',
        details: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      },
    })
  }
  req.validatedQuery = result.data
  next()
}

/**
 * Validate params for request-ID lookup.
 */
export const validateRequestId = (req, res, next) => {
  const result = requestIdSchema.safeParse(req.params)
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request ID',
        details: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      },
    })
  }
  req.validatedParams = result.data
  next()
}
