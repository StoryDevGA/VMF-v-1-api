import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  createRuntimeInstance,
  getRuntimeInstance,
  getRuntimeRenderer,
  listRuntimeInstances,
  mutateRuntimeState,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateCreateRuntimeInstance,
  validateListRuntimeInstances,
  validateMutateRuntimeState,
  validateRuntimeInstanceId,
} from '../validators/runtimeInstance.validator.js'

const router = Router()

router.use(authJwt, loadScopes)

router.get('/', validateListRuntimeInstances, listRuntimeInstances)
router.post('/', validateCreateRuntimeInstance, createRuntimeInstance)
router.patch('/:runtimeInstanceId/data', validateRuntimeInstanceId, validateMutateRuntimeState, mutateRuntimeState)
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
