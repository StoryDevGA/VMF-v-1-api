import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import { validateOnboardCustomer } from '../validators/onboarding.validator.js'
import { onboardCustomer } from '../controllers/onboarding.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.post('/onboard', tenantManagementRateLimit, validateOnboardCustomer, onboardCustomer)

export default router
