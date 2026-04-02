/**
 * Deal Routes
 *
 * Mounts deal management endpoints.
 *
 * VMF-scoped routes (under /api/v1/vmfs/:vmfId/deals):
 *   GET    /                      – List deals
 *   POST   /                      – Create deal
 *
 * Deal-scoped routes (under /api/v1/deals):
 *   GET    /:dealId               – Get single deal
 *   PATCH  /:dealId               – Update deal
 *   DELETE /:dealId               – Archive (soft-delete) deal
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireDealAccess, requireVmfAccess } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
import requireFeatureEntitlement from '../middleware/featureEntitlements.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import {
  validateCreateDeal,
  validateUpdateDeal,
} from '../validators/deal.validator.js'
import {
  listDeals,
  createDeal,
  getDeal,
  updateDeal,
  archiveDeal,
} from '../controllers/deal.controller.js'

/* ------------------------------------------------------------------ */
/*  VMF-scoped router                                                 */
/*  /api/v1/vmfs/:vmfId/deals                                        */
/* ------------------------------------------------------------------ */

export const vmfDealRouter = Router({ mergeParams: true })

vmfDealRouter.use(authJwt, loadScopes)

vmfDealRouter.get(
  '/',
  requireVmfAccess('READ', { requiredPermission: 'DEAL_VIEW' }),
  requireFeatureEntitlement('DEALS'),
  requireCustomerActive(),
  listDeals,
)
vmfDealRouter.post(
  '/',
  requireVmfAccess('WRITE', { requiredPermission: 'DEAL_CREATE' }),
  requireFeatureEntitlement('DEALS'),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateCreateDeal,
  createDeal,
)

/* ------------------------------------------------------------------ */
/*  Deal-scoped router                                                */
/*  /api/v1/deals                                                     */
/* ------------------------------------------------------------------ */

export const dealRouter = Router()

dealRouter.use(authJwt, loadScopes)

dealRouter.get('/:dealId', requireDealAccess('DEAL_VIEW', 'READ'), requireCustomerActive(), getDeal)
dealRouter.patch(
  '/:dealId',
  requireDealAccess('DEAL_UPDATE', 'WRITE'),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateUpdateDeal,
  updateDeal,
)
dealRouter.delete(
  '/:dealId',
  requireDealAccess('DEAL_DELETE', 'WRITE'),
  requireCustomerActive(),
  tenantManagementRateLimit,
  archiveDeal,
)
