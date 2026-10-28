import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'
import { inspectIsolatedSyntheticOutcome, planIsolatedSyntheticOutcome, confirmIsolatedSyntheticOutcomePlan,
  executeIsolatedSyntheticOutcome } from '../services/isolatedSyntheticOutcomeService.js'
import { completeIsolatedSyntheticOutcome, readLatestIsolatedSyntheticOutcome } from '../services/isolatedSyntheticOutcomeCompletionService.js'

const handle = operation => async (req, res, next) => {
  try {
    const data = await operation({ actorUserId: req.context?.userId || req.userId, runtimeInstanceId: req.params.runtimeInstanceId,
      requestId: req.params.requestId, scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }),
      payload: req.body, auditRequest: req, providerRuntimeDeps: req.app.locals.outcomeStudioReasoningDeps || {} })
    return res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: { code: error.code, message: error.message,
      reason: error.details?.reason, requestId: req.requestId } })
    return next(error)
  }
}
export const inspectIsolatedSyntheticOutcomeEndpoint = handle(inspectIsolatedSyntheticOutcome)
export const planIsolatedSyntheticOutcomeEndpoint = handle(planIsolatedSyntheticOutcome)
export const confirmIsolatedSyntheticOutcomePlanEndpoint = handle(confirmIsolatedSyntheticOutcomePlan)
export const executeIsolatedSyntheticOutcomeEndpoint = handle(executeIsolatedSyntheticOutcome)
export const readIsolatedSyntheticOutcomeEndpoint = handle(readLatestIsolatedSyntheticOutcome)
export const completeIsolatedSyntheticOutcomeEndpoint = handle(completeIsolatedSyntheticOutcome)
