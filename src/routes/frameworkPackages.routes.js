import { getDisplayBinding, applyDisplayBinding } from '../controllers/frameworkPackageDisplayBinding.controller.js'
import { Router } from 'express'
import { runUIContractDisplayCheckpointEndpoint } from '../controllers/uiContractDisplayCheckpoint.controller.js'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  captureFrameworkPackageUpdateFields,
  validateCloneFrameworkPackage,
  validateCreateFrameworkPackage,
  validateFrameworkPackageId,
  validateListFrameworkPackages,
  validateRunFrameworkPackageCheckpoint,
  validateUIContractDisplayCheckpoint,
  validateUpdateFrameworkPackage,
  validateUpdateFrameworkPackageSafeMetadata,
} from '../validators/frameworkPackage.validator.js'
import {
  activateFrameworkPackage,
  cloneFrameworkPackage,
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
  updateFrameworkPackageSafeMetadata,
  validateFrameworkPackage,
} from '../controllers/frameworkPackage.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))
router.post('/:packageId/ui-contract-display-checkpoint', validateFrameworkPackageId,
  validateUIContractDisplayCheckpoint, runUIContractDisplayCheckpointEndpoint)

router.get('/:packageId/ui-contract-display-binding', validateFrameworkPackageId, getDisplayBinding)
router.post('/:packageId/ui-contract-display-binding', validateFrameworkPackageId, applyDisplayBinding)

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
router.post('/:packageId/clone', validateFrameworkPackageId, validateCloneFrameworkPackage, cloneFrameworkPackage)
router.patch(
  '/:packageId/safe-metadata',
  validateFrameworkPackageId,
  validateUpdateFrameworkPackageSafeMetadata,
  updateFrameworkPackageSafeMetadata,
)
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
