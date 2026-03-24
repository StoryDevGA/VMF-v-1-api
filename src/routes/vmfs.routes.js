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
 *   DELETE /:vmfId                – Delete VMF (disabled/archived only)
 *   POST   /:vmfId/grants         – Grant user access to VMF
 *   DELETE /:vmfId/grants/:userId – Revoke user access
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireTenantAccess, requireVmfAccess } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
import requireFeatureEntitlement from '../middleware/featureEntitlements.js'
import topologyGuard from '../middleware/topologyGuard.js'
import requireTenantEnabled from '../middleware/tenantStatus.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
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

tenantVmfRouter.use(
  authJwt,
  loadScopes,
  requireTenantAccess({ roles: ['TENANT_ADMIN'], allowCustomerAdmin: true }),
  requireFeatureEntitlement('VMF'),
  requireCustomerActive(),
  requireTenantEnabled,
  topologyGuard,
)

tenantVmfRouter.get('/', listVmfs)
tenantVmfRouter.post('/', tenantManagementRateLimit, validateCreateVmf, createVmf)

/* ------------------------------------------------------------------ */
/*  VMF-scoped router                                                 */
/*  /api/v1/vmfs                                                      */
/* ------------------------------------------------------------------ */

export const vmfRouter = Router()

vmfRouter.use(authJwt, loadScopes)

// All VMF-scoped routes need requireVmfAccess (loads VMF, checks hierarchy)
vmfRouter.get('/:vmfId', requireVmfAccess('READ'), requireFeatureEntitlement('VMF'), requireCustomerActive(), getVmf)
vmfRouter.patch('/:vmfId', requireVmfAccess('WRITE'), requireFeatureEntitlement('VMF'), requireCustomerActive(), tenantManagementRateLimit, validateUpdateVmf, updateVmf)
vmfRouter.delete('/:vmfId', requireVmfAccess('WRITE'), requireFeatureEntitlement('VMF'), requireCustomerActive(), tenantManagementRateLimit, deleteVmf)
vmfRouter.post('/:vmfId/grants', requireVmfAccess('WRITE'), requireFeatureEntitlement('VMF'), requireCustomerActive(), tenantManagementRateLimit, validateGrantAccess, grantAccess)
vmfRouter.delete('/:vmfId/grants/:userId', requireVmfAccess('WRITE'), requireFeatureEntitlement('VMF'), requireCustomerActive(), tenantManagementRateLimit, revokeAccess)
