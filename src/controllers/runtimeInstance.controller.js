import {
  createRuntimeInstance as createRuntimeInstanceRecord,
  getRuntimeInstance as getRuntimeInstanceRecord,
  listRuntimeInstances as listRuntimeInstanceRecords,
} from '../services/runtimeInstanceService.js'
import { executeRuntimeAction as executeRuntimeActionRecord } from '../services/runtimeActionExecutionService.js'
import { getRuntimeRenderer as getRuntimeRendererProjection } from '../services/runtimeRendererService.js'
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

const buildRuntimeInstanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || 'REQUEST_ERROR',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

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
