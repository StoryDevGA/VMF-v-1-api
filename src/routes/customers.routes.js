import { validateCustomerList } from '../validators/resourceList.validator.js'
/**
 * Customer Routes
 *
 * Mounts customer management endpoints under `/api/v1/customers`.
 * All routes require explicit platform customer-management permissions.
 *
 * Route map:
 *   GET    /                              – List customers
 *   POST   /                              – Create customer + provision defaults
 *   GET    /:customerId                   – Get single customer
 *   PATCH  /:customerId                   – Update customer
 *   PATCH  /:customerId/status            – Update customer status
 *   POST   /:customerId/admins            – Assign CUSTOMER_ADMIN
 *   POST   /:customerId/admin-invitations – Create customer-admin invitation
 *   POST   /:customerId/admins/replace    – Replace CUSTOMER_ADMIN (step-up required)
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireCustomerAccess, requirePlatformPermission } from '../middleware/authorize.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import requireStepUp from '../middleware/requireStepUp.js'
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateUpdateStatus,
  validateAssignAdmin,
  validateCreateAdminInvitation,
  validateReplaceAdmin,
  validateAdjustCredit,
  validateCustomerId,
} from '../validators/customer.validator.js'
import {
  listCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  updateCustomerStatus,
  assignAdmin,
  createAdminInvitation,
  replaceAdmin,
  getCustomerCredits,
  adjustCustomerCredits,
} from '../controllers/customer.controller.js'

const router = Router()

/* ------------------------------------------------------------------ */
/*  Common middleware: auth + scopes                                  */
/* ------------------------------------------------------------------ */

router.use(authJwt, loadScopes)

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

router.get('/', requirePlatformPermission('CUSTOMER_VIEW'), validateCustomerList, listCustomers)
router.post(
  '/',
  requirePlatformPermission('CUSTOMER_CREATE'),
  tenantManagementRateLimit,
  validateCreateCustomer,
  createCustomer,
)
router.get('/:customerId', requirePlatformPermission('CUSTOMER_VIEW'), validateCustomerId, getCustomer)
router.get(
  '/:customerId/credits',
  validateCustomerId,
  requireCustomerAccess({
    allowPlatform: true,
    allowCustomerMembershipWhenSingleTenant: true,
    allowTenantMember: true,
  }),
  getCustomerCredits,
)
router.post(
  '/:customerId/credits/adjust',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCustomerId,
  validateAdjustCredit,
  adjustCustomerCredits,
)
router.patch(
  '/:customerId',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCustomerId,
  validateUpdateCustomer,
  updateCustomer,
)
router.patch(
  '/:customerId/status',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCustomerId,
  validateUpdateStatus,
  updateCustomerStatus,
)
router.post(
  '/:customerId/admins',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCustomerId,
  validateAssignAdmin,
  assignAdmin,
)
router.post(
  '/:customerId/admin-invitations',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCustomerId,
  validateCreateAdminInvitation,
  createAdminInvitation,
)
router.post(
  '/:customerId/admins/replace',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  requireStepUp,
  validateCustomerId,
  validateReplaceAdmin,
  replaceAdmin,
)

export default router
