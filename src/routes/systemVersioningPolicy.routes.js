import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import requireStepUp from '../middleware/requireStepUp.js'
import {
  validateCreatePolicy,
  validatePatchPolicy,
  validatePolicyHistoryQuery,
  validatePolicyId,
} from '../validators/systemVersioningPolicy.validator.js'
import {
  createPolicy,
  getActivePolicy,
  listPolicyHistory,
  patchPolicy,
} from '../controllers/systemVersioningPolicy.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', getActivePolicy)
router.get('/history', validatePolicyHistoryQuery, listPolicyHistory)
router.post('/', requireStepUp, validateCreatePolicy, createPolicy)
router.patch('/:policyId', requireStepUp, validatePolicyId, validatePatchPolicy, patchPolicy)

export default router
