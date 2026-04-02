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
import { requirePlatformPermission } from '../middleware/authorize.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import requireStepUp from '../middleware/requireStepUp.js'
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateUpdateStatus,
  validateAssignAdmin,
  validateCreateAdminInvitation,
  validateReplaceAdmin,
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
} from '../controllers/customer.controller.js'

const router = Router()

/* ------------------------------------------------------------------ */
/*  Common middleware: auth + scopes                                  */
/* ------------------------------------------------------------------ */

router.use(authJwt, loadScopes)

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

router.get('/', requirePlatformPermission('CUSTOMER_VIEW'), listCustomers)
router.post(
  '/',
  requirePlatformPermission('CUSTOMER_CREATE'),
  tenantManagementRateLimit,
  validateCreateCustomer,
  createCustomer,
)
router.get('/:customerId', requirePlatformPermission('CUSTOMER_VIEW'), getCustomer)
router.patch(
  '/:customerId',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateUpdateCustomer,
  updateCustomer,
)
router.patch(
  '/:customerId/status',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateUpdateStatus,
  updateCustomerStatus,
)
router.post(
  '/:customerId/admins',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateAssignAdmin,
  assignAdmin,
)
router.post(
  '/:customerId/admin-invitations',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  validateCreateAdminInvitation,
  createAdminInvitation,
)
router.post(
  '/:customerId/admins/replace',
  requirePlatformPermission('CUSTOMER_UPDATE'),
  tenantManagementRateLimit,
  requireStepUp,
  validateReplaceAdmin,
  replaceAdmin,
)

export default router
