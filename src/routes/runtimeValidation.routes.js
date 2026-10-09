import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  getRuntimeValidationAudit,
  getRuntimeValidationHistory,
  validateRuntimeOperationEndpoint,
  prepareVE02AssessmentDraftEndpoint,
  prepareVE02SyntheticAssessmentEndpoint,
  prepareVE02NativeAssessmentEndpoint,
  executeVE02LocalAssessmentEndpoint,
} from '../controllers/runtimeValidation.controller.js'
import {
  validateRuntimeValidationAuditParams,
  validateRuntimeValidationAuditQuery,
  validateRuntimeValidationBody,
  validateRuntimeValidationHistoryParams,
  validateVE02AssessmentDraftBody,
  validateVE02SyntheticAssessmentBody,
  validateVE02NativeAssessmentBody,
} from '../validators/runtimeValidation.validator.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.post('/validate', validateRuntimeValidationBody, validateRuntimeOperationEndpoint)
router.post('/ve02/assessment-draft', validateVE02AssessmentDraftBody, prepareVE02AssessmentDraftEndpoint)
router.post('/ve02/synthetic-assessment', validateVE02SyntheticAssessmentBody, prepareVE02SyntheticAssessmentEndpoint)
router.post('/ve02/synthetic-classification', validateVE02NativeAssessmentBody, prepareVE02NativeAssessmentEndpoint)
router.post('/ve02/local-assessment', validateVE02NativeAssessmentBody, executeVE02LocalAssessmentEndpoint)
router.get('/history/:packageId', validateRuntimeValidationHistoryParams, validateRuntimeValidationAuditQuery, getRuntimeValidationHistory)
router.get('/audit/:workspaceId', validateRuntimeValidationAuditParams, validateRuntimeValidationAuditQuery, getRuntimeValidationAudit)
router.get('/audit', validateRuntimeValidationAuditQuery, getRuntimeValidationAudit)

export default router
