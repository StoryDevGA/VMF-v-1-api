/**
 * Tenant Routes
 *
 * Mounts tenant management endpoints.
 *
 * Customer-scoped routes (under /api/v1/customers/:customerId/tenants):
 *   GET    /                      – List tenants
 *   POST   /                      – Create tenant
 *
 * Tenant-scoped routes (under /api/v1/tenants):
 *   PATCH  /:tenantId             – Update tenant
 *   POST   /:tenantId/enable      – Enable tenant
 *   POST   /:tenantId/disable     – Disable tenant
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole, requireCustomerAccess } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import { validateCreateTenant, validateUpdateTenant } from '../validators/tenant.validator.js'
import {
  listTenants,
  createTenant,
  updateTenant,
  enableTenant,
  disableTenant,
} from '../controllers/tenant.controller.js'

/* ------------------------------------------------------------------ */
/*  Customer-scoped router: /api/v1/customers/:customerId/tenants     */
/* ------------------------------------------------------------------ */

export const customerTenantRouter = Router({ mergeParams: true })

customerTenantRouter.use(authJwt, loadScopes, requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }))
customerTenantRouter.use(requireCustomerActive())

customerTenantRouter.get('/', listTenants)
customerTenantRouter.post('/', tenantManagementRateLimit, validateCreateTenant, createTenant)

/* ------------------------------------------------------------------ */
/*  Tenant-scoped router: /api/v1/tenants                             */
/* ------------------------------------------------------------------ */

export const tenantRouter = Router()

tenantRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), requireCustomerActive())

tenantRouter.patch('/:tenantId', tenantManagementRateLimit, validateUpdateTenant, updateTenant)
tenantRouter.post('/:tenantId/enable', tenantManagementRateLimit, enableTenant)
tenantRouter.post('/:tenantId/disable', tenantManagementRateLimit, disableTenant)
