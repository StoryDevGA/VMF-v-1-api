/**
 * VMF Routes
 *
 * Mounts VMF management endpoints.
 *
 * Tenant-scoped routes (under /api/v1/customers/:customerId/tenants/:tenantId/vmfs):
 *   GET    /                      – List VMFs
 *   POST   /                      – Create VMF (policy-checked by topologyGuard)
 *
 * VMF-scoped routes (under /api/v1/vmfs):
 *   GET    /:vmfId                – Get single VMF
 *   PATCH  /:vmfId                – Update VMF
 *   DELETE /:vmfId                – Soft-delete VMF (disabled/archived only)
 *   POST   /:vmfId/grants         – Grant user access to VMF
 *   DELETE /:vmfId/grants/:userId – Revoke user access
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireTenantPermission, requireVmfAccess } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
import requireFeatureEntitlement from '../middleware/featureEntitlements.js'
import topologyGuard from '../middleware/topologyGuard.js'
import requireTenantEnabled from '../middleware/tenantStatus.js'
import { vmfManagementRateLimit } from '../middleware/rateLimits.js'
import {
  validateCreateVmf,
  validateUpdateVmf,
  validateGrantAccess,
} from '../validators/vmf.validator.js'
import {
  listVmfs,
  createVmf,
  getVmf,
  updateVmf,
  deleteVmf,
  grantAccess,
  revokeAccess,
} from '../controllers/vmf.controller.js'

/* ------------------------------------------------------------------ */
/*  Tenant-scoped router                                              */
/*  /api/v1/customers/:customerId/tenants/:tenantId/vmfs              */
/* ------------------------------------------------------------------ */

export const tenantVmfRouter = Router({ mergeParams: true })

tenantVmfRouter.use(authJwt, loadScopes)

tenantVmfRouter.get(
  '/',
  requireTenantPermission('VMF_VIEW', {
    allowCustomerPermission: true,
    allowCustomerPermissionScopes: ['CUSTOMER'],
    allowCustomerPermissionWhenSingleTenant: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  requireTenantEnabled,
  topologyGuard,
  listVmfs,
)

tenantVmfRouter.post(
  '/',
  requireTenantPermission('VMF_CREATE', {
    allowCustomerPermission: true,
    allowCustomerPermissionScopes: ['CUSTOMER'],
    allowCustomerPermissionWhenSingleTenant: true,
    allowCustomerScopedTenantPermission: true,
  }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  requireTenantEnabled,
  topologyGuard,
  vmfManagementRateLimit,
  validateCreateVmf,
  createVmf,
)

/* ------------------------------------------------------------------ */
/*  VMF-scoped router                                                 */
/*  /api/v1/vmfs                                                      */
/* ------------------------------------------------------------------ */

export const vmfRouter = Router()

vmfRouter.use(authJwt, loadScopes)

// All VMF-scoped routes need requireVmfAccess (loads VMF, checks hierarchy)
vmfRouter.get(
  '/:vmfId',
  requireVmfAccess('READ', { requiredPermission: 'VMF_VIEW' }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  getVmf,
)
vmfRouter.patch(
  '/:vmfId',
  requireVmfAccess(null, {
    requiredPermission: 'VMF_UPDATE',
    requireVmfGrant: false,
  }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  vmfManagementRateLimit,
  validateUpdateVmf,
  updateVmf,
)
vmfRouter.delete(
  '/:vmfId',
  requireVmfAccess(null, {
    requiredPermission: 'VMF_UPDATE',
    requireVmfGrant: false,
  }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  vmfManagementRateLimit,
  deleteVmf,
)
vmfRouter.post(
  '/:vmfId/grants',
  requireVmfAccess('WRITE', { requiredPermission: 'VMF_UPDATE' }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  vmfManagementRateLimit,
  validateGrantAccess,
  grantAccess,
)
vmfRouter.delete(
  '/:vmfId/grants/:userId',
  requireVmfAccess('WRITE', { requiredPermission: 'VMF_UPDATE' }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  vmfManagementRateLimit,
  revokeAccess,
)
