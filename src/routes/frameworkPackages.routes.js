import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  captureFrameworkPackageUpdateFields,
  validateCreateFrameworkPackage,
  validateFrameworkPackageId,
  validateListFrameworkPackages,
  validateRunFrameworkPackageCheckpoint,
  validateUpdateFrameworkPackage,
} from '../validators/frameworkPackage.validator.js'
import {
  activateFrameworkPackage,
  createFrameworkPackage,
  getFrameworkPackage,
  getFrameworkPackageAudit,
  getFrameworkPackageDependencies,
  getFrameworkPackageDiff,
  getFrameworkPackageDependencyGraph,
  getFrameworkPackageDependencyLock,
  getFrameworkPackageIntegrity,
  getFrameworkPackageLatestCheckpoint,
  listFrameworkPackages,
  runFrameworkPackageCheckpointEndpoint,
  updateFrameworkPackage,
  validateFrameworkPackage,
} from '../controllers/frameworkPackage.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListFrameworkPackages, listFrameworkPackages)
router.post('/', validateCreateFrameworkPackage, createFrameworkPackage)
router.get('/:packageId/dependencies', validateFrameworkPackageId, getFrameworkPackageDependencies)
router.get('/:packageId/dependency-graph', validateFrameworkPackageId, getFrameworkPackageDependencyGraph)
router.get('/:packageId/dependency-lock', validateFrameworkPackageId, getFrameworkPackageDependencyLock)
router.get('/:packageId/integrity', validateFrameworkPackageId, getFrameworkPackageIntegrity)
router.post(
  '/:packageId/checkpoint',
  validateFrameworkPackageId,
  validateRunFrameworkPackageCheckpoint,
  runFrameworkPackageCheckpointEndpoint,
)
router.get('/:packageId/checkpoint/latest', validateFrameworkPackageId, getFrameworkPackageLatestCheckpoint)
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
router.post('/:packageId/validate', validateFrameworkPackageId, validateFrameworkPackage)
router.post('/:packageId/activate', validateFrameworkPackageId, activateFrameworkPackage)

export default router
