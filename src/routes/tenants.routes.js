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

customerTenantRouter.use(authJwt, loadScopes)

customerTenantRouter.get(
  '/',
  requireCustomerAccess({
    roles: ['CUSTOMER_ADMIN'],
    allowTenantAdmin: true,
    allowCustomerMembershipWhenSingleTenant: true,
  }),
  requireCustomerActive(),
  listTenants,
)
customerTenantRouter.post(
  '/',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateCreateTenant,
  createTenant,
)
customerTenantRouter.patch(
  '/:tenantId',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'], allowTenantAdmin: true }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateUpdateTenant,
  updateTenant,
)
customerTenantRouter.post(
  '/:tenantId/enable',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'], allowTenantAdmin: true }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  enableTenant,
)
customerTenantRouter.post(
  '/:tenantId/disable',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'], allowTenantAdmin: true }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  disableTenant,
)

/* ------------------------------------------------------------------ */
/*  Tenant-scoped router: /api/v1/tenants                             */
/* ------------------------------------------------------------------ */

export const tenantRouter = Router()

tenantRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

tenantRouter.patch('/:tenantId', requireCustomerActive(), tenantManagementRateLimit, validateUpdateTenant, updateTenant)
tenantRouter.post('/:tenantId/enable', requireCustomerActive(), tenantManagementRateLimit, enableTenant)
tenantRouter.post('/:tenantId/disable', requireCustomerActive(), tenantManagementRateLimit, disableTenant)
