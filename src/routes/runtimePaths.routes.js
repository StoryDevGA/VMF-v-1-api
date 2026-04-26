import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateRuntimePath,
  validateDuplicateRuntimePath,
  validateListRuntimePaths,
  validateRuntimePathLifecycle,
  validateRuntimePathId,
  validateUpdateRuntimePath,
} from '../validators/runtimePaths.validator.js'
import {
  activateRuntimePath,
  createRuntimePath,
  deprecateRuntimePath,
  disableRuntimePath,
  duplicateRuntimePath,
  getRuntimePath,
  getRuntimePathDependencies,
  listRuntimePaths,
  updateRuntimePath,
} from '../controllers/runtimePaths.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRuntimePaths, listRuntimePaths)
router.post('/', validateCreateRuntimePath, createRuntimePath)
router.get('/:pathId', validateRuntimePathId, getRuntimePath)
router.get('/:pathId/dependencies', validateRuntimePathId, getRuntimePathDependencies)
router.patch('/:pathId', validateRuntimePathId, validateUpdateRuntimePath, updateRuntimePath)
router.post('/:pathId/duplicate', validateRuntimePathId, validateDuplicateRuntimePath, duplicateRuntimePath)
router.post('/:pathId/activate', validateRuntimePathId, validateRuntimePathLifecycle, activateRuntimePath)
router.post('/:pathId/disable', validateRuntimePathId, validateRuntimePathLifecycle, disableRuntimePath)
router.post('/:pathId/deprecate', validateRuntimePathId, validateRuntimePathLifecycle, deprecateRuntimePath)

export default router
