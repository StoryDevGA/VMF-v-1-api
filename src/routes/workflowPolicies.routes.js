import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateWorkflowPolicy,
  validateListWorkflowPolicies,
  validateWorkflowPolicyId,
  validateUpdateWorkflowPolicy,
} from '../validators/workflowPolicy.validator.js'
import {
  createWorkflowPolicy,
  getWorkflowPolicy,
  listWorkflowPolicies,
  updateWorkflowPolicy,
} from '../controllers/workflowPolicy.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListWorkflowPolicies, listWorkflowPolicies)
router.post('/', validateCreateWorkflowPolicy, createWorkflowPolicy)
router.get('/:policyId', validateWorkflowPolicyId, getWorkflowPolicy)
router.patch('/:policyId', validateWorkflowPolicyId, validateUpdateWorkflowPolicy, updateWorkflowPolicy)

export default router
