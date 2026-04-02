/**
 * Bulk Operation Routes
 *
 * Customer-scoped routes for bulk user management:
 *   POST  /api/v1/customers/:customerId/users/bulk          — Bulk create (max 100)
 *   PATCH /api/v1/customers/:customerId/users/bulk          — Bulk update (roles, tenantVisibility)
 *   POST  /api/v1/customers/:customerId/users/bulk-disable  — Bulk disable (immediate, revokes trust)
 *
 * All routes require CUSTOMER_ADMIN role and are rate-limited
 * with the bulkOperationsRateLimit (10 req/min).
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireCustomerPermission } from '../middleware/authorize.js'
import { bulkOperationsRateLimit } from '../middleware/rateLimits.js'
import {
  validateBulkCreateUsers,
  validateBulkUpdateUsers,
  validateBulkDisableUsers,
} from '../validators/bulk.validator.js'
import {
  bulkCreateUsers,
  bulkUpdateUsers,
  bulkDisableUsers,
} from '../controllers/bulk.controller.js'

/* ------------------------------------------------------------------ */
/*  Customer-scoped bulk router                                       */
/*  /api/v1/customers/:customerId/users/bulk                          */
/* ------------------------------------------------------------------ */

export const bulkRouter = Router({ mergeParams: true })

bulkRouter.use(
  authJwt,
  loadScopes,
  bulkOperationsRateLimit,
)

bulkRouter.post('/', requireCustomerPermission('USER_CREATE'), validateBulkCreateUsers, bulkCreateUsers)
bulkRouter.patch('/', requireCustomerPermission('USER_UPDATE'), validateBulkUpdateUsers, bulkUpdateUsers)

/* ------------------------------------------------------------------ */
/*  Bulk-disable router (separate path segment)                       */
/*  /api/v1/customers/:customerId/users/bulk-disable                  */
/* ------------------------------------------------------------------ */

export const bulkDisableRouter = Router({ mergeParams: true })

bulkDisableRouter.use(
  authJwt,
  loadScopes,
  bulkOperationsRateLimit,
)

bulkDisableRouter.post('/', requireCustomerPermission('USER_UPDATE'), validateBulkDisableUsers, bulkDisableUsers)
