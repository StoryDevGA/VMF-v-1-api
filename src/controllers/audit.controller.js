/**
 * Audit Controller
 *
 * HTTP handlers for the audit system:
 *
 *   GET    /api/v1/audit-logs                                 — queryAuditLogs
 *   GET    /api/v1/audit-logs/stats                           — getAuditStats
 *   GET    /api/v1/audit-logs/request/:requestId              — getByRequestId
 *   GET    /api/v1/audit-logs/resource/:resourceType/:resourceId — getByResource
 *   POST   /api/v1/audit-logs/verify                          — verifyIntegrity
 *   GET    /api/v1/audit-logs/retention                       — getRetentionInfo
 *   POST   /api/v1/audit-logs/retention/cleanup               — runRetentionCleanup
 *
 * All endpoints require SUPER_ADMIN platform role.
 */

import auditService from '../services/auditService.js'
import auditRetentionService from '../services/auditRetentionService.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Query audit logs                                                  */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/audit-logs
 * Paginated, multi-filter audit log query.
 */
export const queryAuditLogs = async (req, res) => {
  try {
    const result = await auditService.query(req.validatedQuery)

    return res.status(200).json(result)
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to query audit logs')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to query audit logs',
        requestId: req.requestId,
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/*  Stats                                                             */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/audit-logs/stats
 * Aggregate statistics for dashboard / monitoring.
 */
export const getAuditStats = async (req, res) => {
  try {
    const stats = await auditService.getStats(req.validatedQuery)

    return res.status(200).json({ data: stats })
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to get audit stats')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve audit statistics',
        requestId: req.requestId,
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/*  Request ID correlation                                            */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/audit-logs/request/:requestId
 * Retrieve all audit entries correlated by a single request ID.
 */
export const getByRequestId = async (req, res) => {
  try {
    const result = await auditService.getByRequestId(req.validatedParams.requestId)

    return res.status(200).json(result)
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to get audit logs by request ID')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve audit logs for request',
        requestId: req.requestId,
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/*  Resource audit trail                                              */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/audit-logs/resource/:resourceType/:resourceId
 * Retrieve the full audit trail for a specific resource.
 */
export const getByResource = async (req, res) => {
  try {
    const { resourceType, resourceId, page, pageSize } = req.validatedQuery

    const result = await auditService.getByResource(resourceType, resourceId, { page, pageSize })

    return res.status(200).json(result)
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to get audit logs by resource')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve audit logs for resource',
        requestId: req.requestId,
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/*  Integrity verification                                            */
/* ------------------------------------------------------------------ */

/**
 * POST /api/v1/audit-logs/verify
 * Verify HMAC signatures on a batch of audit log documents.
 */
export const verifyIntegrity = async (req, res) => {
  try {
    const result = await auditService.verifyIntegrity(req.validatedBody)

    const status = result.invalid > 0 ? 200 : 200 // always 200, the body tells the story
    return res.status(status).json({ data: result })
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to verify audit log integrity')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify audit log integrity',
        requestId: req.requestId,
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/*  Retention                                                         */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/audit-logs/retention
 * Retrieve current retention policy information and storage stats.
 */
export const getRetentionInfo = async (req, res) => {
  try {
    const info = await auditRetentionService.getRetentionInfo()

    return res.status(200).json({ data: info })
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to get retention info')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve retention information',
        requestId: req.requestId,
      },
    })
  }
}

/**
 * POST /api/v1/audit-logs/retention/cleanup
 * Manually trigger retention cleanup (archive + delete expired).
 * In production this would be a scheduled job; the endpoint is for admin-triggered runs.
 */
export const runRetentionCleanup = async (req, res) => {
  try {
    const result = await auditRetentionService.runCleanup()

    // Audit the cleanup action itself
    await auditService.logFromRequest(req, {
      action: 'AUDIT_RETENTION_CLEANUP',
      resourceType: 'AuditLog',
      resourceId: req.context?.userId || req.userId,
      scope: {},
      diff: result,
    })

    return res.status(200).json({ data: result })
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'Failed to run retention cleanup')
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to run retention cleanup',
        requestId: req.requestId,
      },
    })
  }
}
