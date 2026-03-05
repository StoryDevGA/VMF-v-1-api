import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import requireStepUp from '../middleware/requireStepUp.js'
import { superAdminInvitationRateLimit } from '../middleware/rateLimits.js'
import {
  validateInvitationId,
  validateListInvitationsQuery,
  validateRevokeInvitation,
} from '../validators/invitation.validator.js'
import {
  createInvitationDeprecated,
  listInvitations,
  getInvitation,
  resendInvitation,
  revokeInvitation,
} from '../controllers/invitation.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.post('/', superAdminInvitationRateLimit, createInvitationDeprecated)
router.get('/', validateListInvitationsQuery, listInvitations)
router.get('/:invitationId', validateInvitationId, getInvitation)
router.post('/:invitationId/resend', superAdminInvitationRateLimit, validateInvitationId, resendInvitation)
router.post(
  '/:invitationId/revoke',
  validateInvitationId,
  requireStepUp,
  validateRevokeInvitation,
  revokeInvitation,
)

export default router
