import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  acceptRuntimeDiscovery,
  acceptRuntimeSection,
  createRuntimeInstance,
  executeRuntimeAction,
  getRuntimeInstance,
  getRuntimeEvidence,
  getRuntimeRenderer,
  listRuntimeInstances,
  mutateRuntimeState,
  updateRuntimeDiscoveryInputs,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateAcceptRuntimeDiscovery,
  validateAcceptRuntimeSection,
  validateCreateRuntimeInstance,
  validateExecuteRuntimeAction,
  validateListRuntimeInstances,
  validateMutateRuntimeState,
  validateRuntimeActionParams,
  validateRuntimeInstanceId,
  validateUpdateDiscoveryInputs,
} from '../validators/runtimeInstance.validator.js'

const router = Router()

router.use(authJwt, loadScopes)

router.get('/', validateListRuntimeInstances, listRuntimeInstances)
router.post('/', validateCreateRuntimeInstance, createRuntimeInstance)
router.patch('/:runtimeInstanceId/discovery-acceptance', validateRuntimeInstanceId, validateAcceptRuntimeDiscovery, acceptRuntimeDiscovery)
router.patch('/:runtimeInstanceId/section-acceptance', validateRuntimeInstanceId, validateAcceptRuntimeSection, acceptRuntimeSection)
router.patch('/:runtimeInstanceId/discovery-inputs', validateRuntimeInstanceId, validateUpdateDiscoveryInputs, updateRuntimeDiscoveryInputs)
router.patch('/:runtimeInstanceId/data', validateRuntimeInstanceId, validateMutateRuntimeState, mutateRuntimeState)
router.post(
  '/:runtimeInstanceId/actions/:actionKey',
  validateRuntimeActionParams,
  validateExecuteRuntimeAction,
  executeRuntimeAction,
)
router.get('/:runtimeInstanceId/evidence', validateRuntimeInstanceId, getRuntimeEvidence)
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
