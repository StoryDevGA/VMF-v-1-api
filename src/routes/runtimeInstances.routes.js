import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  acceptRuntimeDiscovery,
  acceptRuntimeSection,
  clearRuntimeSectionEvidence,
  createRuntimeInstance,
  executeRuntimeAction,
  getRuntimeInstance,
  getRuntimeEvidence,
  getRuntimeIntelligenceGraph,
  getRuntimeIntelligenceGraphCoverage,
  getRuntimeIntelligenceGraphHealth,
  getRuntimeIntelligenceGraphNodeLineage,
  getRuntimeIntelligenceGraphSectionDependencies,
  getRuntimeRenderer,
  listRuntimeInstances,
  mutateRuntimeState,
  rebuildRuntimeIntelligenceGraph,
  resetRuntimeDiscovery,
  reviewRuntimeDiscoveryEvidence,
  reviewRuntimeSectionEvidence,
  updateRuntimeSectionEvidence,
  updateRuntimeDiscoveryInputs,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateAcceptRuntimeDiscovery,
  validateAcceptRuntimeSection,
  validateClearRuntimeSectionEvidence,
  validateCreateRuntimeInstance,
  validateExecuteRuntimeAction,
  validateListRuntimeInstances,
  validateMutateRuntimeState,
  validateRebuildRuntimeIntelligenceGraph,
  validateReviewRuntimeDiscoveryEvidence,
  validateReviewRuntimeSectionEvidence,
  validateResetRuntimeDiscovery,
  validateRuntimeIntelligenceGraphNodeParams,
  validateRuntimeIntelligenceGraphSectionParams,
  validateRuntimeDiscoveryEvidenceParams,
  validateRuntimeActionParams,
  validateRuntimeInstanceId,
  validateRuntimeSectionEvidenceParams,
  validateUpdateDiscoveryInputs,
  validateUpdateRuntimeSectionEvidence,
} from '../validators/runtimeInstance.validator.js'

const router = Router()

router.use(authJwt, loadScopes)

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
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
