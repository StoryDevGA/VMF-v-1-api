import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateWorkflowPolicy,
  validateListWorkflowPolicies,
  validateWorkflowPolicyId,
  validateWorkflowPolicyTestConsoleBody,
  validateUpdateWorkflowPolicy,
} from '../validators/workflowPolicy.validator.js'
import {
  createWorkflowPolicy,
  getWorkflowPolicy,
  getWorkflowPolicyDependencies,
  listWorkflowPolicies,
  testWorkflowPolicy,
  updateWorkflowPolicy,
} from '../controllers/workflowPolicy.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListWorkflowPolicies, listWorkflowPolicies)
router.post('/', validateCreateWorkflowPolicy, createWorkflowPolicy)
router.post('/test-console', validateWorkflowPolicyTestConsoleBody, testWorkflowPolicy)
router.get('/:policyId', validateWorkflowPolicyId, getWorkflowPolicy)
router.get('/:policyId/dependencies', validateWorkflowPolicyId, getWorkflowPolicyDependencies)
router.patch(
  '/:policyId',
  validateWorkflowPolicyId,
  validateUpdateWorkflowPolicy,
  updateWorkflowPolicy,
)

export default router
