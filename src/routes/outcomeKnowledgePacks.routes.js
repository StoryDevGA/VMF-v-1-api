import express, { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  activateKnowledgePackVersion,
  cloneKnowledgePackManifestController,
  compareKnowledgePackManifestsController,
  createKnowledgePackManifestController,
  createKnowledgePackVersion,
  deleteKnowledgePack,
  deprecateKnowledgePackVersion,
  disableKnowledgePackVersion,
  getKnowledgePackManifestController,
  getKnowledgePack,
  getKnowledgePackVersion,
  importKnowledgePackStarterVersion,
  importKnowledgePackSourceDocumentDraft,
  listKnowledgePackManifestsController,
  listKnowledgePacks,
  previewKnowledgePackReasoningContextController,
  previewKnowledgePackVersionContent,
  previewKnowledgePackManifestResolutionController,
  previewKnowledgePackResolution,
  rollbackKnowledgePack,
  updateKnowledgePackManifestController,
  updateKnowledgePackVersionReview,
  validateKnowledgePackVersion,
} from '../controllers/outcomeKnowledgePacks.controller.js'
import {
  validateActivateKnowledgePackVersion,
  validateCloneKnowledgePackManifest,
  validateCompareKnowledgePackManifestParams,
  validateCreateKnowledgePackManifest,
  validateCreateKnowledgePackVersion,
  validateImportKnowledgePackStarterVersion,
  validateImportSourceDocumentDraft,
  validateKnowledgePackId,
  validateKnowledgePackManifestId,
  validateKnowledgePackResolutionPreview,
  validateReasoningContextPreview,
  validateRollbackKnowledgePack,
  validateKnowledgePackVersionActionBody,
  validateKnowledgePackVersionParams,
  validateListKnowledgePackManifests,
  validateListKnowledgePacks,
  validateUpdateKnowledgePackReview,
  validateUpdateKnowledgePackManifest,
} from '../validators/outcomeKnowledgePacks.validator.js'

const router = Router()
const sourceDocumentImportJsonParser = express.json({ limit: '15mb' })

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListKnowledgePacks, listKnowledgePacks)
router.get('/manifests', validateListKnowledgePackManifests, listKnowledgePackManifestsController)
router.post('/manifests', validateCreateKnowledgePackManifest, createKnowledgePackManifestController)
router.get('/manifests/:manifestId/reasoning-context-preview', validateKnowledgePackManifestId, validateReasoningContextPreview, previewKnowledgePackReasoningContextController)
router.get('/manifests/:manifestId/resolution-preview', validateKnowledgePackManifestId, validateKnowledgePackResolutionPreview, previewKnowledgePackManifestResolutionController)
router.get('/manifests/:manifestId/compare/:targetManifestId', validateCompareKnowledgePackManifestParams, compareKnowledgePackManifestsController)
router.post('/manifests/:manifestId/clone', validateKnowledgePackManifestId, validateCloneKnowledgePackManifest, cloneKnowledgePackManifestController)
router.put('/manifests/:manifestId', validateKnowledgePackManifestId, validateUpdateKnowledgePackManifest, updateKnowledgePackManifestController)
router.get('/manifests/:manifestId', validateKnowledgePackManifestId, getKnowledgePackManifestController)
router.get('/resolution-preview', validateKnowledgePackResolutionPreview, previewKnowledgePackResolution)
router.post(
  '/source-document-import',
  sourceDocumentImportJsonParser,
  validateImportSourceDocumentDraft,
  importKnowledgePackSourceDocumentDraft,
)
router.post('/:packId/starter-import', validateKnowledgePackId, validateImportKnowledgePackStarterVersion, importKnowledgePackStarterVersion)
router.post('/:packId/versions', validateKnowledgePackId, validateCreateKnowledgePackVersion, createKnowledgePackVersion)
router.get('/:packId/versions/:versionId/content-preview', validateKnowledgePackVersionParams, previewKnowledgePackVersionContent)
router.get('/:packId/versions/:versionId', validateKnowledgePackVersionParams, getKnowledgePackVersion)
router.post('/:packId/versions/:versionId/validate', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, validateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/review', validateKnowledgePackVersionParams, validateUpdateKnowledgePackReview, updateKnowledgePackVersionReview)
router.post('/:packId/versions/:versionId/activate', validateKnowledgePackVersionParams, validateActivateKnowledgePackVersion, activateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/deprecate', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, deprecateKnowledgePackVersion)
router.post('/:packId/versions/:versionId/disable', validateKnowledgePackVersionParams, validateKnowledgePackVersionActionBody, disableKnowledgePackVersion)
router.post('/:packId/rollback', validateKnowledgePackId, validateRollbackKnowledgePack, rollbackKnowledgePack)
router.delete('/:packId', validateKnowledgePackId, deleteKnowledgePack)
router.get('/:packId', validateKnowledgePackId, getKnowledgePack)

export default router
