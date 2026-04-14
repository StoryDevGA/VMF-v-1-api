import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateFrameworkPackage,
  validateFrameworkPackageId,
  validateListFrameworkPackages,
  validateUpdateFrameworkPackage,
} from '../validators/frameworkPackage.validator.js'
import {
  activateFrameworkPackage,
  createFrameworkPackage,
  getFrameworkPackage,
  listFrameworkPackages,
  updateFrameworkPackage,
} from '../controllers/frameworkPackage.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListFrameworkPackages, listFrameworkPackages)
router.post('/', validateCreateFrameworkPackage, createFrameworkPackage)
router.get('/:packageId', validateFrameworkPackageId, getFrameworkPackage)
router.patch(
  '/:packageId',
  validateFrameworkPackageId,
  validateUpdateFrameworkPackage,
  updateFrameworkPackage,
)
router.post('/:packageId/activate', validateFrameworkPackageId, activateFrameworkPackage)

export default router
