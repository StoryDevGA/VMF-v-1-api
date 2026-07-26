import { Router, json } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  getCurrentOutcomeStudioReadiness,
  getOutcomeStudioReadinessHistory,
  putOutcomeStudioDevelopmentTestReadiness,
  putOutcomeStudioReadiness,
} from '../controllers/outcomeStudioReadiness.controller.js'
import {
  validateOutcomeStudioReadinessHistory,
  validateOutcomeStudioDevelopmentTestReadinessPut,
  validateOutcomeStudioReadinessPut,
} from '../validators/outcomeStudioReadiness.validator.js'
import {
  approveOutcomeStudioTestReference,
  downloadOutcomeStudioTestReference,
  getOutcomeStudioTestReference,
  listOutcomeStudioTestReferenceHistory,
  listOutcomeStudioTestReferences,
  supersedeOutcomeStudioTestReference,
  uploadOutcomeStudioTestReference,
} from '../controllers/outcomeStudioTestReference.controller.js'
import {
  validateOutcomeStudioTestReferenceApproval,
  validateOutcomeStudioTestReferenceKey,
  validateOutcomeStudioTestReferencePagination,
  validateOutcomeStudioTestReferenceSupersession,
  validateOutcomeStudioTestReferenceUpload,
} from '../validators/outcomeStudioTestReference.validator.js'

const referenceJsonParser = json({ limit: '15mb' })
const parseReferenceJson = (req, res, next) => referenceJsonParser(req, res, (error) => {
  if (!error) return next()
  res.status(422).json({ error: { code: 'OUTCOME_STUDIO_TEST_REFERENCE_VALIDATION_FAILED', message: 'TEST reference upload body is invalid or too large.', requestId: req.requestId } })
})

const router = Router()
router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))
router.get('/', getCurrentOutcomeStudioReadiness)
router.get('/history', validateOutcomeStudioReadinessHistory, getOutcomeStudioReadinessHistory)
router.put('/development-test', validateOutcomeStudioDevelopmentTestReadinessPut, putOutcomeStudioDevelopmentTestReadiness)
router.post('/references', parseReferenceJson, validateOutcomeStudioTestReferenceUpload, uploadOutcomeStudioTestReference)
router.get('/references', validateOutcomeStudioTestReferencePagination, listOutcomeStudioTestReferences)
router.get('/references/:referenceKey/history', validateOutcomeStudioTestReferenceKey, validateOutcomeStudioTestReferencePagination, listOutcomeStudioTestReferenceHistory)
router.get('/references/:referenceKey/content', validateOutcomeStudioTestReferenceKey, downloadOutcomeStudioTestReference)
router.post('/references/:referenceKey/approve', validateOutcomeStudioTestReferenceKey, validateOutcomeStudioTestReferenceApproval, approveOutcomeStudioTestReference)
router.post('/references/:referenceKey/supersede', validateOutcomeStudioTestReferenceKey, validateOutcomeStudioTestReferenceSupersession, supersedeOutcomeStudioTestReference)
router.get('/references/:referenceKey', validateOutcomeStudioTestReferenceKey, getOutcomeStudioTestReference)
router.put('/', validateOutcomeStudioReadinessPut, putOutcomeStudioReadiness)
export default router
