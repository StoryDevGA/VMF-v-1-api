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
import { AUDIT_ACTIONS, RESOURCE_TYPES } from '../services/auditService.js'

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

const trimmedToken = (maxLength = 100) =>
  z.string().trim().min(1).max(maxLength)

const booleanParam = z.preprocess((value) => {
  if (value === true || value === false) return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return value
}, z.boolean())

/* ------------------------------------------------------------------ */
/*  Audit actions & resource types for enum validation                */
/* ------------------------------------------------------------------ */

const validActions = Object.values(AUDIT_ACTIONS)

const validResourceTypes = Object.values(RESOURCE_TYPES)

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
  isSystemEvent: booleanParam.optional(),
  systemEventType: trimmedToken(100).optional(),
  eventCategory: trimmedToken(50).optional(),
  eventSeverity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  frameworkKey: trimmedToken(100).optional(),
  frameworkVersion: trimmedToken(50).optional(),
  packageKey: trimmedToken(160).optional(),
  componentType: trimmedToken(80).optional(),
  componentStableId: trimmedToken(180).optional(),
  componentVersion: z.coerce.number().int().min(0).optional(),
  checksum: trimmedToken(160).optional(),
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
