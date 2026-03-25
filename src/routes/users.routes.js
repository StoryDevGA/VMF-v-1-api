/**
 * User Routes
 *
 * Mounts user management endpoints.
 *
 * Customer-scoped routes (under /api/v1/customers/:customerId/users):
 *   GET    /                      – List users
 *   POST   /                      – Create user + Identity Plus invitation
 *   GET    /:userId               – Get single user
 *
 * User-scoped routes (under /api/v1/users):
 *   PATCH  /:userId               – Update user (roles, tenant visibility)
 *   POST   /:userId/disable       – Disable user + revoke trust
 *   DELETE /:userId               – Delete disabled user
 *   POST   /:userId/resend-invitation – Resend Identity Plus invitation
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requireCustomerAccess, requirePlatformRole } from '../middleware/authorize.js'
import requireCustomerActive from '../middleware/customerStatus.js'
import { userManagementRateLimit } from '../middleware/rateLimits.js'
import {
  validateListUsersQuery,
  validateCreateUser,
  validateUpdateUser,
  validateResendInvitation,
} from '../validators/user.validator.js'
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  enableUser,
  disableUser,
  deleteUser,
  resendInvitation,
} from '../controllers/user.controller.js'
import { listAssignableRoles } from '../controllers/role.controller.js'

/* ------------------------------------------------------------------ */
/*  Customer-scoped router: /api/v1/customers/:customerId/users       */
/* ------------------------------------------------------------------ */

export const customerUserRouter = Router({ mergeParams: true })

customerUserRouter.use(
  authJwt,
  loadScopes,
)

customerUserRouter.get(
  '/',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'], allowTenantAdmin: true }),
  requireCustomerActive(),
  validateListUsersQuery,
  listUsers,
)
customerUserRouter.post(
  '/',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  userManagementRateLimit,
  validateCreateUser,
  createUser,
)
customerUserRouter.get(
  '/assignable-roles',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  listAssignableRoles,
)
customerUserRouter.get(
  '/:userId',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  getUser,
)
customerUserRouter.patch(
  '/:userId',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'], allowTenantAdmin: true }),
  requireCustomerActive(),
  userManagementRateLimit,
  validateUpdateUser,
  updateUser,
)
customerUserRouter.post(
  '/:userId/enable',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  userManagementRateLimit,
  enableUser,
)
customerUserRouter.post(
  '/:userId/disable',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  userManagementRateLimit,
  disableUser,
)
customerUserRouter.delete(
  '/:userId',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  userManagementRateLimit,
  deleteUser,
)
customerUserRouter.post(
  '/:userId/resend-invitation',
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
  userManagementRateLimit,
  validateResendInvitation,
  resendInvitation,
)

/* ------------------------------------------------------------------ */
/*  User-scoped router: /api/v1/users                                 */
/* ------------------------------------------------------------------ */

export const userRouter = Router()

userRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

userRouter.patch('/:userId', requireCustomerActive(), userManagementRateLimit, validateUpdateUser, updateUser)
userRouter.post('/:userId/enable', requireCustomerActive(), userManagementRateLimit, enableUser)
userRouter.post('/:userId/disable', requireCustomerActive(), userManagementRateLimit, disableUser)
userRouter.delete('/:userId', requireCustomerActive(), userManagementRateLimit, deleteUser)
userRouter.post(
  '/:userId/resend-invitation',
  requireCustomerActive(),
  userManagementRateLimit,
  validateResendInvitation,
  resendInvitation,
)
