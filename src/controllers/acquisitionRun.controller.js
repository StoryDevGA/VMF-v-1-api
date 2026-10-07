import { getAcquisitionRuns, getAcquisitionRun } from '../services/acquisitionRunService.js'
import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'

const handle = operation => async (req, res, next) => {
  try {
    const data = await operation({ actorUserId: req.context?.userId || req.userId,
      runtimeInstanceId: req.params.runtimeInstanceId, runId: req.params.runId, query: req.query,
      scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }) })
    return res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: { code: error.code,
      message: error.message, details: error.details, requestId: req.requestId } })
    return next(error)
  }
}
export const readAcquisitionRuns = handle(getAcquisitionRuns)
export const readAcquisitionRun = handle(getAcquisitionRun)
