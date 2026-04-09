import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateRuntimeAgent,
  validateListRuntimeAgents,
  validateRuntimeAgentId,
  validateUpdateRuntimeAgent,
} from '../validators/runtimeAgent.validator.js'
import {
  createRuntimeAgent,
  getRuntimeAgent,
  listRuntimeAgents,
  updateRuntimeAgent,
} from '../controllers/runtimeAgent.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRuntimeAgents, listRuntimeAgents)
router.post('/', validateCreateRuntimeAgent, createRuntimeAgent)
router.get('/:agentId', validateRuntimeAgentId, getRuntimeAgent)
router.patch('/:agentId', validateRuntimeAgentId, validateUpdateRuntimeAgent, updateRuntimeAgent)

export default router
