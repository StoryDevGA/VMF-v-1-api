import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  captureFrameworkPackageUpdateFields,
  validateCreateFrameworkPackage,
  validateFrameworkPackageId,
  validateListFrameworkPackages,
  validateUpdateFrameworkPackage,
} from '../validators/frameworkPackage.validator.js'
import {
  activateFrameworkPackage,
  createFrameworkPackage,
  getFrameworkPackage,
  getFrameworkPackageAudit,
  getFrameworkPackageDependencies,
  getFrameworkPackageDiff,
  getFrameworkPackageIntegrity,
  listFrameworkPackages,
  updateFrameworkPackage,
} from '../controllers/frameworkPackage.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListFrameworkPackages, listFrameworkPackages)
router.post('/', validateCreateFrameworkPackage, createFrameworkPackage)
router.get('/:packageId/dependencies', validateFrameworkPackageId, getFrameworkPackageDependencies)
router.get('/:packageId/integrity', validateFrameworkPackageId, getFrameworkPackageIntegrity)
router.get('/:packageId/audit', validateFrameworkPackageId, getFrameworkPackageAudit)
router.get('/:packageId/diff/:version', validateFrameworkPackageId, getFrameworkPackageDiff)
router.get('/:packageId', validateFrameworkPackageId, getFrameworkPackage)
router.patch(
  '/:packageId',
  validateFrameworkPackageId,
  captureFrameworkPackageUpdateFields,
  validateUpdateFrameworkPackage,
  updateFrameworkPackage,
)
router.post('/:packageId/activate', validateFrameworkPackageId, activateFrameworkPackage)

export default router
