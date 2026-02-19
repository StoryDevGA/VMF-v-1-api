import { Router } from 'express'
import { superAdminInvitationAuthRateLimit } from '../middleware/rateLimits.js'
import { handleAuthLinkAccess } from '../controllers/invitation.controller.js'

const router = Router()

router.get('/auth/:token', superAdminInvitationAuthRateLimit, handleAuthLinkAccess)

export default router
