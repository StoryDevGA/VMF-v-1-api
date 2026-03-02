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
import { requireVmfAccess, requirePlatformRole } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
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

vmfDealRouter.use(authJwt, loadScopes, requireVmfAccess('READ'), requireCustomerActive())

vmfDealRouter.get('/', listDeals)
vmfDealRouter.post('/', tenantManagementRateLimit, validateCreateDeal, createDeal)

/* ------------------------------------------------------------------ */
/*  Deal-scoped router                                                */
/*  /api/v1/deals                                                     */
/* ------------------------------------------------------------------ */

export const dealRouter = Router()

dealRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), requireCustomerActive())

dealRouter.get('/:dealId', getDeal)
dealRouter.patch('/:dealId', tenantManagementRateLimit, validateUpdateDeal, updateDeal)
dealRouter.delete('/:dealId', tenantManagementRateLimit, archiveDeal)
