import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  activateKnowledgePackVersion,
  createKnowledgePackVersion,
  deprecateKnowledgePackVersion,
  disableKnowledgePackVersion,
  getKnowledgePack,
  getKnowledgePackVersion,
  importKnowledgePackStarterVersion,
  listKnowledgePacks,
  previewKnowledgePackVersionContent,
  previewKnowledgePackResolution,
  rollbackKnowledgePack,
  validateKnowledgePackVersion,
} from '../controllers/outcomeKnowledgePacks.controller.js'
import {
  validateActivateKnowledgePackVersion,
  validateCreateKnowledgePackVersion,
  validateImportKnowledgePackStarterVersion,
  validateKnowledgePackId,
  validateKnowledgePackResolutionPreview,
  validateRollbackKnowledgePack,
  validateKnowledgePackVersionActionBody,
  validateKnowledgePackVersionParams,
  validateListKnowledgePacks,
} from '../validators/outcomeKnowledgePacks.validator.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListKnowledgePacks, listKnowledgePacks)
router.get('/resolution-preview', validateKnowledgePackResolutionPreview, previewKnowledgePackResolution)
router.post('/:packId/starter-import', validateKnowledgePackId, validateImportKnowledgePackStarterVersion, importKnowledgePackStarterVersion)
router.post('/:packId/versions', validateKnowledgePackId, validateCreateKnowledgePackVersion, createKnowledgePackVersion)
router.get('/:packId/versions/:versionId/content-preview', validateKnowledgePackVersionParams, previewKnowledgePackVersionContent)
router.get('/:packId/versions/:versionId', validateKnowledgePackVersionParams, getKnowledgePackVersion)
router.post('/:packId/versions/:versionId/validate', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, validateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/activate', validateKnowledgePackVersionParams, validateActivateKnowledgePackVersion, activateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/deprecate', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, deprecateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/disable', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, disableKnowledgePackVersion)
router.post('/:packId/rollback', validateKnowledgePackId, validateRollbackKnowledgePack, rollbackKnowledgePack)
router.get('/:packId', validateKnowledgePackId, getKnowledgePack)

export default router
