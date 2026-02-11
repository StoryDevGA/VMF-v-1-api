/**
 * GDPR Compliance Routes (Phase 5.2)
 *
 * SUPER_ADMIN-only endpoints for:
 *   - user data export
 *   - data deletion request workflow
 *   - GDPR retention information and cleanup
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { auditRateLimit, userManagementRateLimit } from '../middleware/rateLimits.js'
import {
  createDeletionRequest,
  exportUserData,
  getDeletionRequest,
  getRetentionInfo,
  listDeletionRequests,
  processDeletionRequest,
  runRetentionCleanup,
} from '../controllers/gdpr.controller.js'
import {
  validateCreateDeletionRequest,
  validateGdprExportParams,
  validateListDeletionRequests,
  validateProcessDeletionRequest,
  validateRequestIdParams,
} from '../validators/gdpr.validator.js'

const gdprRouter = Router()

gdprRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

gdprRouter.get('/export/users/:userId', auditRateLimit, validateGdprExportParams, exportUserData)

gdprRouter.get('/deletion-requests', auditRateLimit, validateListDeletionRequests, listDeletionRequests)

gdprRouter.post(
  '/deletion-requests',
  userManagementRateLimit,
  validateCreateDeletionRequest,
  createDeletionRequest,
)

gdprRouter.get(
  '/deletion-requests/:requestId',
  auditRateLimit,
  validateRequestIdParams,
  getDeletionRequest,
)

gdprRouter.post(
  '/deletion-requests/:requestId/process',
  userManagementRateLimit,
  validateRequestIdParams,
  validateProcessDeletionRequest,
  processDeletionRequest,
)

gdprRouter.get('/retention', auditRateLimit, getRetentionInfo)
gdprRouter.post('/retention/cleanup', userManagementRateLimit, runRetentionCleanup)

export default gdprRouter
