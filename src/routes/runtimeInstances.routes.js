import express, { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  acceptRuntimeDiscovery,
  acceptRuntimeSection,
  clearRuntimeSectionEvidence,
  createRuntimeInstance,
  createRuntimeOutputRequest,
  executeRuntimeAction,
  exportRuntimeOutputAsset,
  getRuntimeInstance,
  getRuntimeEvidence,
  getRuntimeIntelligenceGraph,
  getRuntimeIntelligenceGraphCoverage,
  getRuntimeIntelligenceGraphHealth,
  getRuntimeIntelligenceGraphNodeLineage,
  getRuntimeIntelligenceGraphQuery,
  getRuntimeIntelligenceGraphSectionDependencies,
  getRuntimeOutputAsset,
  getRuntimeOutputLab,
  getRuntimeOutputLabDefinitions,
  getRuntimeOutputLabReadiness,
  getRuntimeOutputRequest,
  getRuntimeRenderer,
  generateRuntimeOutputRequest,
  listRuntimeOutputAssets,
  listRuntimeInstances,
  mutateRuntimeState,
  publishRuntimeOutputAsset,
  rebuildRuntimeIntelligenceGraph,
  resetRuntimeDiscovery,
  reviewAllRuntimeSectionEvidence,
  reviewRuntimeDiscoveryEvidence,
  reviewRuntimeSectionEvidence,
  updateRuntimeSectionEvidence,
  updateRuntimeDiscoveryInputs,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateAcceptRuntimeDiscovery,
  validateAcceptRuntimeSection,
  validateClearRuntimeSectionEvidence,
  validateCreateRuntimeOutputRequest,
  validateCreateRuntimeInstance,
  validateExecuteRuntimeAction,
  validateGenerateRuntimeOutputRequest,
  validateListRuntimeInstances,
  validateMutateRuntimeState,
  validatePublishRuntimeOutputAsset,
  validateReviewAllRuntimeSectionEvidence,
  validateRebuildRuntimeIntelligenceGraph,
  validateReviewRuntimeDiscoveryEvidence,
  validateReviewRuntimeSectionEvidence,
  validateResetRuntimeDiscovery,
  validateRuntimeIntelligenceGraphNodeParams,
  validateRuntimeIntelligenceGraphQueryParams,
  validateRuntimeIntelligenceGraphSectionParams,
  validateRuntimeDiscoveryEvidenceParams,
  validateRuntimeOutputAssetExportParams,
  validateRuntimeOutputAssetParams,
  validateRuntimeOutputRequestParams,
  validateRuntimeActionParams,
  validateRuntimeInstanceId,
  validateRuntimeSectionEvidenceParams,
  validateUpdateDiscoveryInputs,
  validateUpdateRuntimeSectionEvidence,
} from '../validators/runtimeInstance.validator.js'

const router = Router()
const defaultRuntimeInstanceJsonParser = express.json({ limit: '1mb' })
const documentIngestionJsonParser = express.json({ limit: '60mb' })

const isDocumentIngestionMutation = (req) => {
  if (!['POST', 'PATCH', 'PUT'].includes(req.method)) return false
  const routePath = String(req.path || '')
  return /^\/[^/]+\/section-evidence\/?$/.test(routePath)
    || /^\/[^/]+\/discovery-inputs\/?$/.test(routePath)
    || /^\/[^/]+\/actions\/[^/]+\/?$/.test(routePath)
}

router.use(authJwt, loadScopes)
router.use((req, res, next) => (
  isDocumentIngestionMutation(req)
    ? documentIngestionJsonParser(req, res, next)
    : defaultRuntimeInstanceJsonParser(req, res, next)
))

router.get('/', validateListRuntimeInstances, listRuntimeInstances)
router.post('/', validateCreateRuntimeInstance, createRuntimeInstance)
router.patch('/:runtimeInstanceId/discovery-acceptance', validateRuntimeInstanceId, validateAcceptRuntimeDiscovery, acceptRuntimeDiscovery)
router.patch(
  '/:runtimeInstanceId/discovery-evidence/:evidenceObjectId/review',
  validateRuntimeDiscoveryEvidenceParams,
  validateReviewRuntimeDiscoveryEvidence,
  reviewRuntimeDiscoveryEvidence,
)
router.patch('/:runtimeInstanceId/discovery-reset', validateRuntimeInstanceId, validateResetRuntimeDiscovery, resetRuntimeDiscovery)
router.post(
  '/:runtimeInstanceId/intelligence-graph/rebuild',
  validateRuntimeInstanceId,
  validateRebuildRuntimeIntelligenceGraph,
  rebuildRuntimeIntelligenceGraph,
)
router.get(
  '/:runtimeInstanceId/intelligence-graph/health',
  validateRuntimeInstanceId,
  getRuntimeIntelligenceGraphHealth,
)
router.get(
  '/:runtimeInstanceId/intelligence-graph/coverage',
  validateRuntimeInstanceId,
  getRuntimeIntelligenceGraphCoverage,
)
router.get(
  '/:runtimeInstanceId/intelligence-graph/query/:queryType',
  validateRuntimeIntelligenceGraphQueryParams,
  getRuntimeIntelligenceGraphQuery,
)
router.get(
  '/:runtimeInstanceId/intelligence-graph/nodes/:nodeId/lineage',
  validateRuntimeIntelligenceGraphNodeParams,
  getRuntimeIntelligenceGraphNodeLineage,
)
router.get(
  '/:runtimeInstanceId/intelligence-graph/sections/:sectionKey/dependencies',
  validateRuntimeIntelligenceGraphSectionParams,
  getRuntimeIntelligenceGraphSectionDependencies,
)
router.get('/:runtimeInstanceId/intelligence-graph', validateRuntimeInstanceId, getRuntimeIntelligenceGraph)
router.patch('/:runtimeInstanceId/section-evidence', validateRuntimeInstanceId, validateUpdateRuntimeSectionEvidence, updateRuntimeSectionEvidence)
router.patch(
  '/:runtimeInstanceId/section-evidence/clear',
  validateRuntimeInstanceId,
  validateClearRuntimeSectionEvidence,
  clearRuntimeSectionEvidence,
)
router.patch(
  '/:runtimeInstanceId/section-evidence/review-all',
  validateRuntimeInstanceId,
  validateReviewAllRuntimeSectionEvidence,
  reviewAllRuntimeSectionEvidence,
)
router.patch(
  '/:runtimeInstanceId/section-evidence/:evidenceObjectId/review',
  validateRuntimeSectionEvidenceParams,
  validateReviewRuntimeSectionEvidence,
  reviewRuntimeSectionEvidence,
)
router.patch('/:runtimeInstanceId/section-acceptance', validateRuntimeInstanceId, validateAcceptRuntimeSection, acceptRuntimeSection)
router.patch('/:runtimeInstanceId/discovery-inputs', validateRuntimeInstanceId, validateUpdateDiscoveryInputs, updateRuntimeDiscoveryInputs)
router.patch('/:runtimeInstanceId/data', validateRuntimeInstanceId, validateMutateRuntimeState, mutateRuntimeState)
router.post(
  '/:runtimeInstanceId/actions/:actionKey',
  validateRuntimeActionParams,
  validateExecuteRuntimeAction,
  executeRuntimeAction,
)
router.get('/:runtimeInstanceId/evidence', validateRuntimeInstanceId, getRuntimeEvidence)
router.get('/:runtimeInstanceId/output-lab', validateRuntimeInstanceId, getRuntimeOutputLab)
router.get('/:runtimeInstanceId/output-lab/definitions', validateRuntimeInstanceId, getRuntimeOutputLabDefinitions)
router.get('/:runtimeInstanceId/output-lab/readiness', validateRuntimeInstanceId, getRuntimeOutputLabReadiness)
router.post(
  '/:runtimeInstanceId/output-lab/requests',
  validateRuntimeInstanceId,
  validateCreateRuntimeOutputRequest,
  createRuntimeOutputRequest,
)
router.get(
  '/:runtimeInstanceId/output-lab/requests/:outputRequestId',
  validateRuntimeOutputRequestParams,
  getRuntimeOutputRequest,
)
router.post(
  '/:runtimeInstanceId/output-lab/requests/:outputRequestId/generate',
  validateRuntimeOutputRequestParams,
  validateGenerateRuntimeOutputRequest,
  generateRuntimeOutputRequest,
)
router.get('/:runtimeInstanceId/output-lab/assets', validateRuntimeInstanceId, listRuntimeOutputAssets)
router.get(
  '/:runtimeInstanceId/output-lab/assets/:outputAssetId',
  validateRuntimeOutputAssetParams,
  getRuntimeOutputAsset,
)
router.post(
  '/:runtimeInstanceId/output-lab/assets/:outputAssetId/publish',
  validateRuntimeOutputAssetParams,
  validatePublishRuntimeOutputAsset,
  publishRuntimeOutputAsset,
)
router.get(
  '/:runtimeInstanceId/output-lab/assets/:outputAssetId/export/:format',
  validateRuntimeOutputAssetExportParams,
  exportRuntimeOutputAsset,
)
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
