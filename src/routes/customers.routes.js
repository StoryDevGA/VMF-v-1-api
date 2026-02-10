/**
 * Customer Routes
 *
 * Mounts customer management endpoints under `/api/v1/customers`.
 * All routes require SUPER_ADMIN platform role.
 *
 * Route map:
 *   GET    /                      – List customers
 *   POST   /                      – Create customer + provision defaults
 *   GET    /:customerId           – Get single customer
 *   PATCH  /:customerId           – Update customer
 *   PATCH  /:customerId/status    – Update customer status
 *   POST   /:customerId/admins    – Assign CUSTOMER_ADMIN
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateUpdateStatus,
  validateAssignAdmin,
} from '../validators/customer.validator.js'
import {
  listCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  updateCustomerStatus,
  assignAdmin,
} from '../controllers/customer.controller.js'

const router = Router()

/* ------------------------------------------------------------------ */
/*  Common middleware: auth + scopes + SUPER_ADMIN                    */
/* ------------------------------------------------------------------ */

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

router.get('/', listCustomers)
router.post('/', tenantManagementRateLimit, validateCreateCustomer, createCustomer)
router.get('/:customerId', getCustomer)
router.patch('/:customerId', tenantManagementRateLimit, validateUpdateCustomer, updateCustomer)
router.patch('/:customerId/status', tenantManagementRateLimit, validateUpdateStatus, updateCustomerStatus)
router.post('/:customerId/admins', tenantManagementRateLimit, validateAssignAdmin, assignAdmin)

export default router
