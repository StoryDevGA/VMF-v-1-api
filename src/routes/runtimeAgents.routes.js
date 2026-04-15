import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateRuntimeAgent,
  validateListRuntimeAgents,
  validateRuntimeAgentActionBody,
  validateRuntimeAgentId,
  validateRuntimeAgentTestBody,
  validateUpdateRuntimeAgent,
} from '../validators/runtimeAgent.validator.js'
import {
  createRuntimeAgent,
  getRuntimeAgent,
  getRuntimeAgentDependencies,
  listRuntimeAgents,
  updateRuntimeAgent,
  validateRuntimeAgent,
  testRuntimeAgent,
  activateRuntimeAgent,
  disableRuntimeAgent,
  deprecateRuntimeAgent,
} from '../controllers/runtimeAgent.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRuntimeAgents, listRuntimeAgents)
router.post('/', validateCreateRuntimeAgent, createRuntimeAgent)
router.get('/:agentId', validateRuntimeAgentId, getRuntimeAgent)
router.get('/:agentId/dependencies', validateRuntimeAgentId, getRuntimeAgentDependencies)
router.patch('/:agentId', validateRuntimeAgentId, validateUpdateRuntimeAgent, updateRuntimeAgent)
router.post('/:agentId/validate', validateRuntimeAgentId, validateRuntimeAgentActionBody, validateRuntimeAgent)
router.post('/:agentId/test', validateRuntimeAgentId, validateRuntimeAgentTestBody, testRuntimeAgent)
router.post('/:agentId/activate', validateRuntimeAgentId, validateRuntimeAgentActionBody, activateRuntimeAgent)
router.post('/:agentId/disable', validateRuntimeAgentId, validateRuntimeAgentActionBody, disableRuntimeAgent)
router.post('/:agentId/deprecate', validateRuntimeAgentId, validateRuntimeAgentActionBody, deprecateRuntimeAgent)

export default router
