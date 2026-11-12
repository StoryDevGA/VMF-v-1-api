import { getAcquisitionRuns, getAcquisitionRun, cancelAcquisitionRun } from '../services/acquisitionRunService.js'
import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'
import { getResearchConfiguration, saveResearchConfiguration } from '../services/researchConfigurationService.js'

const handle = (operation, includeBody = false) => async (req, res, next) => {
  try {
    const data = await operation({ actorUserId: req.context?.userId || req.userId,
      runtimeInstanceId: req.params.runtimeInstanceId, runId: req.params.runId, query: req.query,
      ...(includeBody ? { payload: req.body, requestId: req.requestId } : {}),
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
export const readResearchConfiguration = handle(getResearchConfiguration)
export const writeResearchConfiguration = handle(saveResearchConfiguration, true)

export const cancelRecordedAcquisitionRun = handle(cancelAcquisitionRun, true)
