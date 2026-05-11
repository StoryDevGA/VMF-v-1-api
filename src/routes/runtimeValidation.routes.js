import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  getRuntimeValidationAudit,
  getRuntimeValidationHistory,
  validateRuntimeOperationEndpoint,
} from '../controllers/runtimeValidation.controller.js'
import {
  validateRuntimeValidationAuditParams,
  validateRuntimeValidationAuditQuery,
  validateRuntimeValidationBody,
  validateRuntimeValidationHistoryParams,
} from '../validators/runtimeValidation.validator.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.post('/validate', validateRuntimeValidationBody, validateRuntimeOperationEndpoint)
router.get('/history/:packageId', validateRuntimeValidationHistoryParams, validateRuntimeValidationAuditQuery, getRuntimeValidationHistory)
router.get('/audit/:workspaceId', validateRuntimeValidationAuditParams, validateRuntimeValidationAuditQuery, getRuntimeValidationAudit)
router.get('/audit', validateRuntimeValidationAuditQuery, getRuntimeValidationAudit)

export default router
