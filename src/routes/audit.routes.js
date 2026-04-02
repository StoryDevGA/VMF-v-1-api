/**
 * Audit Routes
 *
 * SUPER_ADMIN-only endpoints for querying, verifying, and managing
 * the immutable audit log:
 *
 *   GET    /api/v1/audit-logs                                          — Paginated query
 *   GET    /api/v1/audit-logs/stats                                    — Aggregate statistics
 *   GET    /api/v1/audit-logs/request/:requestId                       — Correlation lookup
 *   GET    /api/v1/audit-logs/resource/:resourceType/:resourceId       — Resource trail
 *   POST   /api/v1/audit-logs/verify                                   — HMAC integrity check
 *   GET    /api/v1/audit-logs/retention                                — Retention info
 *   POST   /api/v1/audit-logs/retention/cleanup                        — Manual cleanup
 *
 * All routes are protected by authJwt + loadScopes + requirePlatformPermission('AUDIT_VIEW_ALL').
 * Manual retention cleanup also requires requirePlatformPermission('PLATFORM_MANAGE').
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformPermission } from '../middleware/authorize.js'
import {
  validateQueryAuditLogs,
  validateAuditStats,
  validateRequestId,
  validateResourceAuditLogs,
  validateVerifyIntegrity,
} from '../validators/audit.validator.js'
import {
  queryAuditLogs,
  getAuditStats,
  getByRequestId,
  getByResource,
  verifyIntegrity,
  getRetentionInfo,
  runRetentionCleanup,
} from '../controllers/audit.controller.js'

const auditRouter = Router()

/* ------------------------------------------------------------------ */
/*  Common middleware for all audit routes                             */
/* ------------------------------------------------------------------ */

auditRouter.use(authJwt, loadScopes, requirePlatformPermission('AUDIT_VIEW_ALL'))

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

// Paginated query with multi-filter support
auditRouter.get('/', validateQueryAuditLogs, queryAuditLogs)

// Aggregate statistics
auditRouter.get('/stats', validateAuditStats, getAuditStats)

// Correlation lookup by request ID
auditRouter.get('/request/:requestId', validateRequestId, getByRequestId)

// Resource audit trail
auditRouter.get(
  '/resource/:resourceType/:resourceId',
  validateResourceAuditLogs,
  getByResource,
)

// HMAC integrity verification
auditRouter.post('/verify', validateVerifyIntegrity, verifyIntegrity)

// Retention info & manual cleanup
auditRouter.get('/retention', getRetentionInfo)
auditRouter.post('/retention/cleanup', requirePlatformPermission('PLATFORM_MANAGE'), runRetentionCleanup)

export default auditRouter
