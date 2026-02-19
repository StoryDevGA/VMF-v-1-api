import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { auditRateLimit } from '../middleware/rateLimits.js'
import { listDeniedAccessLogs } from '../controllers/superAdminAudit.controller.js'
import { validateDeniedAccessLogQuery } from '../validators/superAdminAudit.validator.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', auditRateLimit, validateDeniedAccessLogQuery, listDeniedAccessLogs)

export default router
