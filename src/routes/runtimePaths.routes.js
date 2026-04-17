import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateListRuntimePaths,
  validateRuntimePathId,
} from '../validators/runtimePaths.validator.js'
import {
  getRuntimePath,
  getRuntimePathDependencies,
  listRuntimePaths,
} from '../controllers/runtimePaths.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRuntimePaths, listRuntimePaths)
router.get('/:pathId', validateRuntimePathId, getRuntimePath)
router.get('/:pathId/dependencies', validateRuntimePathId, getRuntimePathDependencies)

export default router

