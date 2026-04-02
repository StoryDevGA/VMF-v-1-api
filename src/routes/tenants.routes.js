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
import { requirePlatformPermission, requireCustomerPermission } from '../middleware/authorize.js'
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
  requireCustomerPermission('TENANT_VIEW', {
    allowTenantPermission: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireCustomerActive(),
  listTenants,
)
customerTenantRouter.post(
  '/',
  requireCustomerPermission('TENANT_CREATE'),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateCreateTenant,
  createTenant,
)
customerTenantRouter.patch(
  '/:tenantId',
  requireCustomerPermission('TENANT_UPDATE', {
    allowTenantPermission: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  validateUpdateTenant,
  updateTenant,
)
customerTenantRouter.post(
  '/:tenantId/enable',
  requireCustomerPermission('TENANT_UPDATE', {
    allowTenantPermission: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  enableTenant,
)
customerTenantRouter.post(
  '/:tenantId/disable',
  requireCustomerPermission('TENANT_UPDATE', {
    allowTenantPermission: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireCustomerActive(),
  tenantManagementRateLimit,
  disableTenant,
)

/* ------------------------------------------------------------------ */
/*  Tenant-scoped router: /api/v1/tenants                             */
/* ------------------------------------------------------------------ */

export const tenantRouter = Router()

tenantRouter.use(authJwt, loadScopes, requirePlatformPermission('PLATFORM_MANAGE'))

tenantRouter.patch('/:tenantId', requireCustomerActive(), tenantManagementRateLimit, validateUpdateTenant, updateTenant)
tenantRouter.post('/:tenantId/enable', requireCustomerActive(), tenantManagementRateLimit, enableTenant)
tenantRouter.post('/:tenantId/disable', requireCustomerActive(), tenantManagementRateLimit, disableTenant)
