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
  validateCreateUser,
  validateUpdateUser,
  validateResendInvitation,
} from '../validators/user.validator.js'
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  disableUser,
  deleteUser,
  resendInvitation,
} from '../controllers/user.controller.js'

/* ------------------------------------------------------------------ */
/*  Customer-scoped router: /api/v1/customers/:customerId/users       */
/* ------------------------------------------------------------------ */

export const customerUserRouter = Router({ mergeParams: true })

customerUserRouter.use(
  authJwt,
  loadScopes,
  requireCustomerAccess({ roles: ['CUSTOMER_ADMIN'] }),
  requireCustomerActive(),
)

customerUserRouter.get('/', listUsers)
customerUserRouter.post('/', userManagementRateLimit, validateCreateUser, createUser)
customerUserRouter.get('/:userId', getUser)

/* ------------------------------------------------------------------ */
/*  User-scoped router: /api/v1/users                                 */
/* ------------------------------------------------------------------ */

export const userRouter = Router()

userRouter.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

userRouter.patch('/:userId', userManagementRateLimit, validateUpdateUser, updateUser)
userRouter.post('/:userId/disable', userManagementRateLimit, disableUser)
userRouter.delete('/:userId', userManagementRateLimit, deleteUser)
userRouter.post(
  '/:userId/resend-invitation',
  userManagementRateLimit,
  validateResendInvitation,
  resendInvitation,
)
