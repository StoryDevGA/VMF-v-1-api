import {
  createRuntimeInstance as createRuntimeInstanceRecord,
  getRuntimeInstance as getRuntimeInstanceRecord,
  listRuntimeInstances as listRuntimeInstanceRecords,
} from '../services/runtimeInstanceService.js'
import { createRuntimeRevision as createRuntimeRevisionRecord } from '../services/runtimeRevisionService.js'
import { executeRuntimeAction as executeRuntimeActionRecord } from '../services/runtimeActionExecutionService.js'
import { getRuntimeRenderer as getRuntimeRendererProjection } from '../services/runtimeRendererService.js'
import { getRuntimeTruthQuality as getRuntimeTruthQualityProjection } from '../services/runtimeTruthQualityService.js'
import {
  createGovernedReasoningExecution as createGovernedReasoningExecutionRecord,
  getGovernedReasoningExecution as getGovernedReasoningExecutionRecord,
} from '../services/governedReasoningRuntimeService.js'
import {
  buildCommercialStrategyDecisionPaperRuntimeReadinessPackage,
} from '../services/outcomeCommercialStrategyDecisionPaperRuntimeReadinessService.js'
import {
  getRuntimeIntelligenceGraph as getRuntimeIntelligenceGraphRecord,
  getRuntimeIntelligenceGraphCoverage as getRuntimeIntelligenceGraphCoverageRecord,
  getRuntimeIntelligenceGraphHealth as getRuntimeIntelligenceGraphHealthRecord,
  getRuntimeIntelligenceGraphNodeLineage as getRuntimeIntelligenceGraphNodeLineageRecord,
  getRuntimeIntelligenceGraphQuery as getRuntimeIntelligenceGraphQueryRecord,
  getRuntimeIntelligenceGraphSectionDependencies as getRuntimeIntelligenceGraphSectionDependenciesRecord,
} from '../services/runtimeIntelligenceGraphService.js'
import {
  acceptRuntimeDiscovery as acceptRuntimeDiscoveryRecord,
  acceptRuntimeSection as acceptRuntimeSectionRecord,
  clearRuntimeSectionEvidence as clearRuntimeSectionEvidenceRecord,
  getRuntimeDiscoveryEvidence as getRuntimeDiscoveryEvidenceRecord,
  mutateRuntimeState as mutateRuntimeStateRecord,
  rebuildRuntimeIntelligenceGraph as rebuildRuntimeIntelligenceGraphRecord,
  resetRuntimeDiscovery as resetRuntimeDiscoveryRecord,
  reviewAllRuntimeSectionEvidence as reviewAllRuntimeSectionEvidenceRecord,
  reviewRuntimeDiscoveryEvidence as reviewRuntimeDiscoveryEvidenceRecord,
  reviewRuntimeSectionEvidence as reviewRuntimeSectionEvidenceRecord,
  updateRuntimeSectionEvidence as updateRuntimeSectionEvidenceRecord,
  updateRuntimeDiscoveryInputs as updateRuntimeDiscoveryInputsRecord,
} from '../services/runtimeStateMutationService.js'
import {
  createRuntimeOutputRequest as createRuntimeOutputRequestRecord,
  exportRuntimeOutputAsset as exportRuntimeOutputAssetRecord,
  generateRuntimeOutputAsset as generateRuntimeOutputAssetRecord,
  getOutputLabDefinitions as getRuntimeOutputLabDefinitionsRecord,
  getRuntimeOutputAsset as getRuntimeOutputAssetRecord,
  getRuntimeOutputLab as getRuntimeOutputLabRecord,
  getRuntimeOutputLabReadiness as getRuntimeOutputLabReadinessRecord,
  getRuntimeOutputRequest as getRuntimeOutputRequestRecord,
  listRuntimeOutputAssets as listRuntimeOutputAssetsRecord,
  publishRuntimeOutputAsset as publishRuntimeOutputAssetRecord,
} from '../services/runtimeOutputLabService.js'
import {
  approveRuntimeOutcomeDraft as approveRuntimeOutcomeDraftRecord,
  createRuntimeOutcomeMessage as createRuntimeOutcomeMessageRecord,
  createRuntimeOutcomeSession as createRuntimeOutcomeSessionRecord,
  discardRuntimeOutcomeDraft as discardRuntimeOutcomeDraftRecord,
  exportRuntimeOutcomeAsset as exportRuntimeOutcomeAssetRecord,
  generateRuntimeOutcomeResponse as generateRuntimeOutcomeResponseRecord,
  getRuntimeOutcomeAsset as getRuntimeOutcomeAssetRecord,
  getRuntimeOutcomeAssetPreview as getRuntimeOutcomeAssetPreviewRecord,
  getRuntimeOutcomeAssetVersion as getRuntimeOutcomeAssetVersionRecord,
  getRuntimeOutcomeDraftCompare as getRuntimeOutcomeDraftCompareRecord,
  getRuntimeOutcomeDraftPreview as getRuntimeOutcomeDraftPreviewRecord,
  getRuntimeOutcomeSession as getRuntimeOutcomeSessionRecord,
  getRuntimeOutcomeStudio as getRuntimeOutcomeStudioRecord,
  getRuntimeOutcomeStudioReadiness as getRuntimeOutcomeStudioReadinessRecord,
  listRuntimeOutcomeSessionAssets as listRuntimeOutcomeSessionAssetsRecord,
  publishRuntimeOutcomeAsset as publishRuntimeOutcomeAssetRecord,
  reviseRuntimeOutcomeAsset as reviseRuntimeOutcomeAssetRecord,
  updateRuntimeOutcomeSessionFromLatestTruth as updateRuntimeOutcomeSessionFromLatestTruthRecord,
} from '../services/outcomeStudioService.js'
import { isOutcomeCustomerLanguageSafe } from '../services/outcomeCustomerLanguageService.js'
import {
  getRuntimeStateControl,
  getRuntimeStateGraphManifest as readRuntimeStateGraphManifest,
  getRuntimeStateOutcomeHandoffReadiness as readRuntimeStateOutcomeHandoffReadiness,
  getRuntimeStateSectionSummary as readRuntimeStateSectionSummary,
  listRuntimeStateEvidenceObjects,
} from '../services/runtimeStateV2Repository.js'

const buildRuntimeInstanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || 'REQUEST_ERROR',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

const OUTCOME_CUSTOMER_ERROR_STATE_KEYS = Object.freeze([
  'actionAvailable',
  'approvalAvailable',
  'compareAvailable',
  'draftCreated',
  'exportAvailable',
  'previewAvailable',
  'publishAvailable',
  'responseCreated',
  'responseGenerationAvailable',
  'updateAvailable',
])

const OUTCOME_CUSTOMER_ERROR_CODES = new Set([
  'CONFLICT',
  'CUSTOMER_CONTENT_REQUIRES_REVIEW',
  'DRAFTING_SERVICE_UNAVAILABLE',
  'FORBIDDEN',
  'NOT_FOUND',
  'OUTCOME_OUTPUT_CONTRACT_CLARIFICATION_REQUIRED',
  'VALIDATION_ERROR',
  'VALIDATION_FAILED',
])

const OUTCOME_PROVIDER_PUBLIC_FAILURES = Object.freeze({
  LIVE_TEST_PROVIDER_CUSTOMER_LANGUAGE_BLOCKED: Object.freeze({
    code: 'CUSTOMER_LANGUAGE_BLOCKED',
    message: 'Outcome Studio blocked the draft because its customer-facing wording did not pass the content-safety language check. No changes were made.',
  }),
})

const OUTCOME_PROVIDER_SAFE_CONTEXT_PUBLIC_STAGES = Object.freeze({
  REQUEST_VALIDATION: 'REQUEST',
  TRUTH_PROJECTION: 'TRUTH',
  KNOWLEDGE_SELECTION_VALIDATION: 'KNOWLEDGE_SELECTION',
  SELECTED_VERSION_LOOKUP: 'KNOWLEDGE_VERSION',
  GUIDANCE_PROJECTION: 'GUIDANCE',
  REQUIRED_GUIDANCE_ADMISSION: 'GUIDANCE',
  CONTEXT_VALIDATION: 'SAFE_CONTEXT',
})

const OUTCOME_PROVIDER_SAFE_CONTEXT_PUBLIC_CODES = Object.freeze({
  SAFE_REQUEST_INVALID: 'REQUEST_INVALID',
  TRUTH_PROJECTION_REJECTED: 'TRUTH_UNUSABLE',
  KNOWLEDGE_SELECTION_INVALID: 'KNOWLEDGE_SELECTION_INVALID',
  SELECTED_VERSION_LOOKUP_FAILED: 'KNOWLEDGE_VERSION_UNAVAILABLE',
  GUIDANCE_PROJECTION_REJECTED: 'GUIDANCE_NOT_USABLE',
  REQUIRED_GUIDANCE_MISSING: 'REQUIRED_GUIDANCE_UNAVAILABLE',
  CONTEXT_VALIDATION_REJECTED: 'SAFE_CONTEXT_VALIDATION_FAILED',
  PACK_CONTENT_TYPE_INVALID: 'GUIDANCE_CONTENT_REJECTED',
  PACK_CONTENT_TOO_LARGE: 'GUIDANCE_CONTENT_REJECTED',
  PACK_CONTENT_TOO_MANY_LINES: 'GUIDANCE_CONTENT_REJECTED',
  PACK_CONTENT_MALFORMED: 'GUIDANCE_CONTENT_REJECTED',
  PACK_CONTENT_CONTROL_CHARACTER: 'GUIDANCE_CONTENT_REJECTED',
  PACK_CONTENT_PII_OR_CREDENTIAL: 'GUIDANCE_CONTENT_REJECTED',
})

const getOutcomeCustomerErrorCode = (err = {}) => {
  if (OUTCOME_CUSTOMER_ERROR_CODES.has(err.code)) return err.code
  const providerFailure = OUTCOME_PROVIDER_PUBLIC_FAILURES[err.details?.reason]
  if (providerFailure) return providerFailure.code
  if ([400, 422].includes(err.status)) return 'INVALID_REQUEST'
  if ([401, 403].includes(err.status)) return 'FORBIDDEN'
  if (err.status === 404) return 'NOT_FOUND'
  if (err.status === 409) return 'CONFLICT'
  return 'OUTCOME_ACTION_FAILED'
}

const getOutcomeCustomerErrorMessage = (err = {}) => {
  const providerFailure = OUTCOME_PROVIDER_PUBLIC_FAILURES[err.details?.reason]
  if (providerFailure) return providerFailure.message
  if (Number(err.status) >= 500) {
    return 'Outcome Studio could not complete this action. No changes were made.'
  }

  const message = String(err.message || '').trim()
  if (message && isOutcomeCustomerLanguageSafe(message, { path: 'error.message' })) return message
  if ([400, 422].includes(err.status)) return 'Please review the information provided and try again.'
  if ([401, 403].includes(err.status)) return 'You do not have permission to perform this action.'
  if (err.status === 404) return 'The requested Outcome Studio item could not be found.'
  return 'Outcome Studio cannot complete this action in its current state.'
}

const getOutcomeCustomerErrorState = (details = {}) => {
  if (!details || typeof details !== 'object') return null
  const state = {}
  OUTCOME_CUSTOMER_ERROR_STATE_KEYS.forEach((key) => {
    if (typeof details[key] === 'boolean') state[key] = details[key]
  })
  return Object.keys(state).length > 0 ? state : null
}

const getOutcomeCustomerErrorDiagnostic = (err = {}) => {
  if (err.code !== 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') return null
  const failureStage = OUTCOME_PROVIDER_SAFE_CONTEXT_PUBLIC_STAGES[err.internalFailureStage]
  const diagnosticCode = OUTCOME_PROVIDER_SAFE_CONTEXT_PUBLIC_CODES[err.internalDiagnosticCode]
  if (!failureStage || !diagnosticCode) return null
  return { failureStage, diagnosticCode }
}

const buildRuntimeOutcomeErrorResponse = (req, err) => {
  const state = getOutcomeCustomerErrorState(err.details)
  const diagnostic = getOutcomeCustomerErrorDiagnostic(err)
  return {
    error: {
      code: getOutcomeCustomerErrorCode(err),
      message: getOutcomeCustomerErrorMessage(err),
      ...(state ? { state } : {}),
      ...(diagnostic ? { diagnostic } : {}),
      requestId: req.requestId,
    },
  }
}

export const createRuntimeInstance = async (req, res, next) => {
  try {
    const runtimeInstance = await createRuntimeInstanceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      payload: req.body,
    })

    return res.status(201).json({
      data: runtimeInstance,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const createRuntimeRevision = async (req, res, next) => {
  try {
    const runtimeInstance = await createRuntimeRevisionRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(201).json({
      data: runtimeInstance,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const listRuntimeInstances = async (req, res, next) => {
  try {
    const { data, meta } = await listRuntimeInstanceRecords({
      scopes: req.scopes,
      query: req.query,
    })

    return res.status(200).json({
      data,
      meta: {
        ...meta,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeInstance = async (req, res, next) => {
  try {
    const runtimeInstance = await getRuntimeInstanceRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: runtimeInstance,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

const sendRuntimeStateV2Read = async ({ req, res, next, read }) => {
  try {
    const data = await read()
    return res.status(200).json({
      data,
      meta: { requestId: req.requestId, version: 'v1', storage: 'runtime-state-v2-read-only' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeStateBootstrap = async (req, res, next) => sendRuntimeStateV2Read({
  req,
  res,
  next,
  read: () => getRuntimeStateControl({
    scopes: req.scopes,
    runtimeInstanceId: req.params.runtimeInstanceId,
  }),
})

export const getRuntimeStateSectionSummary = async (req, res, next) => sendRuntimeStateV2Read({
  req,
  res,
  next,
  read: () => readRuntimeStateSectionSummary({
    scopes: req.scopes,
    runtimeInstanceId: req.params.runtimeInstanceId,
    sectionKey: req.params.sectionKey,
  }),
})

export const getRuntimeStateEvidencePage = async (req, res, next) => sendRuntimeStateV2Read({
  req,
  res,
  next,
  read: () => listRuntimeStateEvidenceObjects({
    scopes: req.scopes,
    runtimeInstanceId: req.params.runtimeInstanceId,
    page: req.query.page,
    pageSize: req.query.pageSize,
    reviewStatus: req.query.reviewStatus,
    acceptanceState: req.query.acceptanceState,
  }),
})

export const getRuntimeStateGraphManifest = async (req, res, next) => sendRuntimeStateV2Read({
  req,
  res,
  next,
  read: () => readRuntimeStateGraphManifest({
    scopes: req.scopes,
    runtimeInstanceId: req.params.runtimeInstanceId,
  }),
})

export const getRuntimeStateOutcomeHandoffReadiness = async (req, res, next) => sendRuntimeStateV2Read({
  req,
  res,
  next,
  read: () => readRuntimeStateOutcomeHandoffReadiness({
    scopes: req.scopes,
    runtimeInstanceId: req.params.runtimeInstanceId,
  }),
})

export const getRuntimeRenderer = async (req, res, next) => {
  try {
    const renderer = await getRuntimeRendererProjection({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: renderer,
      meta: {
        requestId: req.requestId,
        renderTraceId: renderer.diagnostics?.renderTraceId,
        version: 'v1',
      },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeTruthQuality = async (req, res, next) => {
  try {
    const truthQuality = await getRuntimeTruthQualityProjection({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: truthQuality,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const createGovernedReasoningExecution = async (req, res, next) => {
  try {
    const execution = await createGovernedReasoningExecutionRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      payload: req.body,
      runtimeInstanceId: req.params.runtimeInstanceId,
      scopes: req.scopes,
    })

    return res.status(201).json({
      data: execution,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getGovernedReasoningExecution = async (req, res, next) => {
  try {
    const execution = await getGovernedReasoningExecutionRecord({
      executionId: req.params.executionId,
      runtimeInstanceId: req.params.runtimeInstanceId,
      scopes: req.scopes,
    })

    return res.status(200).json({
      data: execution,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const mutateRuntimeState = async (req, res, next) => {
  try {
    const mutation = await mutateRuntimeStateRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: mutation,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const updateRuntimeDiscoveryInputs = async (req, res, next) => {
  try {
    const discovery = await updateRuntimeDiscoveryInputsRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: discovery,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const acceptRuntimeDiscovery = async (req, res, next) => {
  try {
    const discovery = await acceptRuntimeDiscoveryRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: discovery,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const reviewRuntimeDiscoveryEvidence = async (req, res, next) => {
  try {
    const discovery = await reviewRuntimeDiscoveryEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      evidenceObjectId: req.params.evidenceObjectId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: discovery,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const updateRuntimeSectionEvidence = async (req, res, next) => {
  try {
    const sectionEvidence = await updateRuntimeSectionEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: sectionEvidence,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const reviewRuntimeSectionEvidence = async (req, res, next) => {
  try {
    const sectionEvidence = await reviewRuntimeSectionEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      evidenceObjectId: req.params.evidenceObjectId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: sectionEvidence,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const reviewAllRuntimeSectionEvidence = async (req, res, next) => {
  try {
    const sectionEvidence = await reviewAllRuntimeSectionEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: sectionEvidence,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const clearRuntimeSectionEvidence = async (req, res, next) => {
  try {
    const sectionEvidence = await clearRuntimeSectionEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: sectionEvidence,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const resetRuntimeDiscovery = async (req, res, next) => {
  try {
    const discovery = await resetRuntimeDiscoveryRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: discovery,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeEvidence = async (req, res, next) => {
  try {
    const evidence = await getRuntimeDiscoveryEvidenceRecord({
      actorUserId: req.context?.userId || req.userId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: evidence,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const rebuildRuntimeIntelligenceGraph = async (req, res, next) => {
  try {
    const graph = await rebuildRuntimeIntelligenceGraphRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: graph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraph = async (req, res, next) => {
  try {
    const graph = await getRuntimeIntelligenceGraphRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: graph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraphHealth = async (req, res, next) => {
  try {
    const graph = await getRuntimeIntelligenceGraphHealthRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: graph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraphCoverage = async (req, res, next) => {
  try {
    const graph = await getRuntimeIntelligenceGraphCoverageRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: graph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraphQuery = async (req, res, next) => {
  try {
    const graph = await getRuntimeIntelligenceGraphQueryRecord({
      queryType: req.params.queryType,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: graph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraphNodeLineage = async (req, res, next) => {
  try {
    const lineage = await getRuntimeIntelligenceGraphNodeLineageRecord({
      nodeId: req.params.nodeId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: lineage,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeIntelligenceGraphSectionDependencies = async (req, res, next) => {
  try {
    const dependencies = await getRuntimeIntelligenceGraphSectionDependenciesRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sectionKey: req.params.sectionKey,
    })

    return res.status(200).json({
      data: dependencies,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const acceptRuntimeSection = async (req, res, next) => {
  try {
    const section = await acceptRuntimeSectionRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: section,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutputLab = async (req, res, next) => {
  try {
    const outputLab = await getRuntimeOutputLabRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputLab,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutputLabDefinitions = async (req, res, next) => {
  try {
    const definitions = await getRuntimeOutputLabDefinitionsRecord()

    return res.status(200).json({
      data: definitions,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutputLabReadiness = async (req, res, next) => {
  try {
    const readiness = await getRuntimeOutputLabReadinessRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: readiness,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeStudio = async (req, res, next) => {
  try {
    const outcomeStudio = await getRuntimeOutcomeStudioRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeStudio,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeStudioReadiness = async (req, res, next) => {
  try {
    const readiness = await getRuntimeOutcomeStudioReadinessRecord({
      actorUserId: req.user?._id || req.user?.id,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: readiness,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeCommercialStrategyDecisionPaperReadiness = async (req, res, next) => {
  try {
    const readinessPackage = await buildCommercialStrategyDecisionPaperRuntimeReadinessPackage({
      actorUserId: req.user?._id || req.user?.id,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      expectedRuntimeUpdatedAt: req.query.expectedRuntimeUpdatedAt,
      consumerIntent: {
        source: 'RUNTIME_OUTCOME_STUDIO_READINESS_ROUTE',
      },
      deps: req.app.locals.outcomeStudioReasoningDeps || {},
    })

    return res.status(200).json({
      data: readinessPackage,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeSession = async (req, res, next) => {
  try {
    const outcomeSession = await getRuntimeOutcomeSessionRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: outcomeSession,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const listRuntimeOutcomeSessionAssets = async (req, res, next) => {
  try {
    const outcomeAssets = await listRuntimeOutcomeSessionAssetsRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: outcomeAssets,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeAsset = async (req, res, next) => {
  try {
    const outcomeAsset = await getRuntimeOutcomeAssetRecord({
      outcomeAssetId: req.params.outcomeAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeAssetVersion = async (req, res, next) => {
  try {
    const outcomeAssetVersion = await getRuntimeOutcomeAssetVersionRecord({
      outcomeAssetId: req.params.outcomeAssetId,
      outcomeAssetVersionId: req.params.outcomeAssetVersionId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeAssetVersion,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeAssetPreview = async (req, res, next) => {
  try {
    const outcomeAssetPreview = await getRuntimeOutcomeAssetPreviewRecord({
      outcomeAssetId: req.params.outcomeAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeAssetPreview,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeDraftPreview = async (req, res, next) => {
  try {
    const outcomeDraftPreview = await getRuntimeOutcomeDraftPreviewRecord({
      draftId: req.params.draftId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: outcomeDraftPreview,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutcomeDraftCompare = async (req, res, next) => {
  try {
    const outcomeDraftCompare = await getRuntimeOutcomeDraftCompareRecord({
      draftId: req.params.draftId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: outcomeDraftCompare,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const publishRuntimeOutcomeAsset = async (req, res, next) => {
  try {
    const outcomeAsset = await publishRuntimeOutcomeAssetRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      outcomeAssetId: req.params.outcomeAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const exportRuntimeOutcomeAsset = async (req, res, next) => {
  try {
    const outcomeAssetExport = await exportRuntimeOutcomeAssetRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      format: req.params.format,
      outcomeAssetId: req.params.outcomeAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outcomeAssetExport,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const createRuntimeOutcomeSession = async (req, res, next) => {
  try {
    const outcomeSession = await createRuntimeOutcomeSessionRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      payload: req.body,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(201).json({
      data: outcomeSession,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const createRuntimeOutcomeMessage = async (req, res, next) => {
  try {
    const outcomeMessage = await createRuntimeOutcomeMessageRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      payload: req.body,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(201).json({
      data: outcomeMessage,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const generateRuntimeOutcomeResponse = async (req, res, next) => {
  try {
    const outcomeResponse = await generateRuntimeOutcomeResponseRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      allowReadyWithGaps: req.body?.allowReadyWithGaps,
      executionMode: req.app.locals.outcomeStudioReasoningDeps?.executionMode,
      providerAdapter: req.app.locals.outcomeStudioReasoningDeps?.providerAdapter,
      providerDescriptor: req.app.locals.outcomeStudioReasoningDeps?.providerDescriptor,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
      messageId: req.params.messageId,
    })

    return res.status(200).json({
      data: outcomeResponse,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const approveRuntimeOutcomeDraft = async (req, res, next) => {
  try {
    const approvedOutcomeDraft = await approveRuntimeOutcomeDraftRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      draftId: req.params.draftId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(201).json({
      data: approvedOutcomeDraft,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const reviseRuntimeOutcomeAsset = async (req, res, next) => {
  try {
    const revisedOutcomeAsset = await reviseRuntimeOutcomeAssetRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      outcomeAssetId: req.params.outcomeAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })
    return res.status(201).json({ data: revisedOutcomeAsset })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const discardRuntimeOutcomeDraft = async (req, res, next) => {
  try {
    const discardedDraft = await discardRuntimeOutcomeDraftRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      draftId: req.params.draftId,
      expectedUpdatedAt: req.body.expectedUpdatedAt,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: { draft: discardedDraft },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const updateRuntimeOutcomeSessionFromLatestTruth = async (req, res, next) => {
  try {
    const outcomeSession = await updateRuntimeOutcomeSessionFromLatestTruthRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      sessionId: req.params.sessionId,
    })

    return res.status(200).json({
      data: outcomeSession,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeOutcomeErrorResponse(req, err))
    }
    return next(err)
  }
}

export const createRuntimeOutputRequest = async (req, res, next) => {
  try {
    const outputRequest = await createRuntimeOutputRequestRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      payload: req.body,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(201).json({
      data: outputRequest,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutputRequest = async (req, res, next) => {
  try {
    const outputRequest = await getRuntimeOutputRequestRecord({
      scopes: req.scopes,
      outputRequestId: req.params.outputRequestId,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputRequest,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const generateRuntimeOutputRequest = async (req, res, next) => {
  try {
    const outputAsset = await generateRuntimeOutputAssetRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      outputRequestId: req.params.outputRequestId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const listRuntimeOutputAssets = async (req, res, next) => {
  try {
    const outputAssets = await listRuntimeOutputAssetsRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputAssets,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeOutputAsset = async (req, res, next) => {
  try {
    const outputAsset = await getRuntimeOutputAssetRecord({
      scopes: req.scopes,
      outputAssetId: req.params.outputAssetId,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const publishRuntimeOutputAsset = async (req, res, next) => {
  try {
    const outputAsset = await publishRuntimeOutputAssetRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      outputAssetId: req.params.outputAssetId,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: outputAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const exportRuntimeOutputAsset = async (req, res, next) => {
  try {
    const exportedAsset = await exportRuntimeOutputAssetRecord({
      format: req.params.format,
      scopes: req.scopes,
      outputAssetId: req.params.outputAssetId,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: exportedAsset,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const executeRuntimeAction = async (req, res, next) => {
  try {
    const action = await executeRuntimeActionRecord({
      actionKey: req.params.actionKey,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
      payload: req.body,
    })

    return res.status(200).json({
      data: action,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}
