import express, { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import {
  acceptRuntimeDiscovery,
  acceptRuntimeSection,
  approveRuntimeOutcomeDraft,
  clearRuntimeSectionEvidence,
  createGovernedReasoningExecution,
  createRuntimeInstance,
  createRuntimeOutcomeMessage,
  createRuntimeOutcomeSession,
  createRuntimeOutputRequest,
  discardRuntimeOutcomeDraft,
  createRuntimeRevision,
  executeRuntimeAction,
  exportRuntimeOutcomeAsset,
  exportRuntimeOutputAsset,
  generateRuntimeOutcomeResponse,
  getGovernedReasoningExecution,
  getRuntimeCommercialStrategyDecisionPaperReadiness,
  getRuntimeOutcomeAsset,
  getRuntimeOutcomeAssetPreview,
  getRuntimeOutcomeAssetVersion,
  getRuntimeOutcomeDraftCompare,
  getRuntimeOutcomeDraftPreview,
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
  getRuntimeOutcomeSession,
  getRuntimeOutcomeStudio,
  getRuntimeOutcomeStudioReadiness,
  getRuntimeRenderer,
  getRuntimeTruthQuality,
  generateRuntimeOutputRequest,
  listRuntimeOutputAssets,
  listRuntimeOutcomeSessionAssets,
  listRuntimeInstances,
  mutateRuntimeState,
  publishRuntimeOutcomeAsset,
  reviseRuntimeOutcomeAsset,
  publishRuntimeOutputAsset,
  rebuildRuntimeIntelligenceGraph,
  resetRuntimeDiscovery,
  reviewAllRuntimeSectionEvidence,
  reviewRuntimeDiscoveryEvidence,
  reviewRuntimeSectionEvidence,
  updateRuntimeOutcomeSessionFromLatestTruth,
  updateRuntimeSectionEvidence,
  updateRuntimeDiscoveryInputs,
} from '../controllers/runtimeInstance.controller.js'
import {
  validateAcceptRuntimeDiscovery,
  validateAcceptRuntimeSection,
  validateClearRuntimeSectionEvidence,
  validateCreateRuntimeOutcomeMessage,
  validateCreateRuntimeOutcomeSession,
  validateCreateGovernedReasoningExecution,
  validateCreateRuntimeOutputRequest,
  validateCreateRuntimeInstance,
  validateCreateRuntimeRevision,
  validateExecuteRuntimeAction,
  validateGenerateRuntimeOutcomeResponse,
  validateDiscardRuntimeOutcomeDraft,
  validateGenerateRuntimeOutputRequest,
  validateApproveRuntimeOutcomeDraft,
  validateGovernedReasoningExecutionParams,
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
  validatePublishRuntimeOutcomeAsset,
  validateRuntimeOutcomeAssetExportParams,
  validateRuntimeOutcomeAssetParams,
  validateRuntimeOutcomeAssetVersionParams,
  validateRuntimeOutcomeDraftParams,
  validateRuntimeOutcomeInstanceId,
  validateRuntimeOutcomeMessageParams,
  validateRuntimeOutcomeReadinessGateQuery,
  validateRuntimeOutputRequestParams,
  validateRuntimeOutcomeSessionParams,
  validateRuntimeOutcomeSessionAssetParams,
  validateRuntimeActionParams,
  validateRuntimeInstanceId,
  validateRuntimeSectionEvidenceParams,
  validateUpdateRuntimeOutcomeSessionFromLatestTruth,
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
router.post(
  '/:runtimeInstanceId/governed-reasoning/executions',
  validateRuntimeInstanceId,
  validateCreateGovernedReasoningExecution,
  createGovernedReasoningExecution,
)
router.get(
  '/:runtimeInstanceId/governed-reasoning/executions/:executionId',
  validateGovernedReasoningExecutionParams,
  getGovernedReasoningExecution,
)
router.get('/:runtimeInstanceId/output-lab', validateRuntimeInstanceId, getRuntimeOutputLab)
router.get('/:runtimeInstanceId/output-lab/definitions', validateRuntimeInstanceId, getRuntimeOutputLabDefinitions)
router.get('/:runtimeInstanceId/output-lab/readiness', validateRuntimeInstanceId, getRuntimeOutputLabReadiness)
router.get('/:runtimeInstanceId/outcome-studio', validateRuntimeOutcomeInstanceId, getRuntimeOutcomeStudio)
router.get('/:runtimeInstanceId/outcome-studio/readiness', validateRuntimeOutcomeInstanceId, getRuntimeOutcomeStudioReadiness)
router.get(
  '/:runtimeInstanceId/outcome-studio/commercial-strategy-decision-paper/readiness',
  validateRuntimeOutcomeInstanceId,
  validateRuntimeOutcomeReadinessGateQuery,
  getRuntimeCommercialStrategyDecisionPaperReadiness,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/assets',
  validateRuntimeOutcomeSessionParams,
  listRuntimeOutcomeSessionAssets,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId',
  validateRuntimeOutcomeSessionParams,
  getRuntimeOutcomeSession,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/assets/:outcomeAssetId/versions/:outcomeAssetVersionId',
  validateRuntimeOutcomeAssetVersionParams,
  getRuntimeOutcomeAssetVersion,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/assets/:outcomeAssetId/preview',
  validateRuntimeOutcomeAssetParams,
  getRuntimeOutcomeAssetPreview,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/assets/:outcomeAssetId',
  validateRuntimeOutcomeAssetParams,
  getRuntimeOutcomeAsset,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/drafts/:draftId/preview',
  validateRuntimeOutcomeDraftParams,
  getRuntimeOutcomeDraftPreview,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/drafts/:draftId/compare',
  validateRuntimeOutcomeDraftParams,
  getRuntimeOutcomeDraftCompare,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/assets/:outcomeAssetId/publish',
  validateRuntimeOutcomeAssetParams,
  validatePublishRuntimeOutcomeAsset,
  publishRuntimeOutcomeAsset,
)
router.get(
  '/:runtimeInstanceId/outcome-studio/assets/:outcomeAssetId/export/:format',
  validateRuntimeOutcomeAssetExportParams,
  exportRuntimeOutcomeAsset,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/drafts/:draftId/approve',
  validateRuntimeOutcomeDraftParams,
  validateApproveRuntimeOutcomeDraft,
  approveRuntimeOutcomeDraft,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/assets/:outcomeAssetId/revise',
  validateRuntimeOutcomeSessionAssetParams,
  reviseRuntimeOutcomeAsset,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/drafts/:draftId/discard',
  validateRuntimeOutcomeDraftParams,
  validateDiscardRuntimeOutcomeDraft,
  discardRuntimeOutcomeDraft,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/update-from-latest-truth',
  validateRuntimeOutcomeSessionParams,
  validateUpdateRuntimeOutcomeSessionFromLatestTruth,
  updateRuntimeOutcomeSessionFromLatestTruth,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/messages/:messageId/generate-response',
  validateRuntimeOutcomeMessageParams,
  validateGenerateRuntimeOutcomeResponse,
  generateRuntimeOutcomeResponse,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions/:sessionId/messages',
  validateRuntimeOutcomeSessionParams,
  validateCreateRuntimeOutcomeMessage,
  createRuntimeOutcomeMessage,
)
router.post(
  '/:runtimeInstanceId/outcome-studio/sessions',
  validateRuntimeOutcomeInstanceId,
  validateCreateRuntimeOutcomeSession,
  createRuntimeOutcomeSession,
)
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
router.post(
  '/:runtimeInstanceId/revisions',
  validateRuntimeInstanceId,
  validateCreateRuntimeRevision,
  createRuntimeRevision,
)
router.get('/:runtimeInstanceId/truth-quality', validateRuntimeInstanceId, getRuntimeTruthQuality)
router.get('/:runtimeInstanceId/renderer', validateRuntimeInstanceId, getRuntimeRenderer)
router.get('/:runtimeInstanceId', validateRuntimeInstanceId, getRuntimeInstance)

export default router
