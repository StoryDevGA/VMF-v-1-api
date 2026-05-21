import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  createRuntimeInstance,
  executeRuntimeAction,
  getRuntimeInstance,
  getRuntimeRenderer,
  listRuntimeInstances,
  mutateRuntimeState,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateCreateRuntimeInstance,
  validateExecuteRuntimeAction,
  validateListRuntimeInstances,
  validateMutateRuntimeState,
  validateRuntimeActionParams,
  validateRuntimeInstanceId,
} from '../validators/runtimeInstance.validator.js'

const router = Router()

router.use(authJwt, loadScopes)

router.get('/', validateListRuntimeInstances, listRuntimeInstances)
router.post('/', validateCreateRuntimeInstance, createRuntimeInstance)
router.patch('/:runtimeInstanceId/data', validateRuntimeInstanceId, validateMutateRuntimeState, mutateRuntimeState)
router.post(
  '/:runtimeInstanceId/actions/:actionKey',
  validateRuntimeActionParams,
  validateExecuteRuntimeAction,
  executeRuntimeAction,
)
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
