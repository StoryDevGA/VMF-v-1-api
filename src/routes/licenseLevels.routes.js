import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { tenantManagementRateLimit } from '../middleware/rateLimits.js'
import {
  validateCreateLicenseLevel,
  validateLicenseLevelId,
  validateListLicenseLevels,
  validateUpdateLicenseLevel,
} from '../validators/licenseLevel.validator.js'
import {
  createLicenseLevel,
  getLicenseLevel,
  listLicenseLevels,
  updateLicenseLevel,
} from '../controllers/licenseLevel.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListLicenseLevels, listLicenseLevels)
router.post('/', tenantManagementRateLimit, validateCreateLicenseLevel, createLicenseLevel)
router.get('/:licenseLevelId', validateLicenseLevelId, getLicenseLevel)
router.patch(
  '/:licenseLevelId',
  tenantManagementRateLimit,
  validateLicenseLevelId,
  validateUpdateLicenseLevel,
  updateLicenseLevel,
)

export default router
