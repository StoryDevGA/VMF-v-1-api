import { getReviewCompletion, completeReview } from '../services/reviewCompletionService.js'
import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'

const handle = (operation) => async (req, res, next) => {
  try {
    const data = await operation({ actorUserId: req.context?.userId || req.userId,
      runtimeInstanceId: req.params.runtimeInstanceId,
      scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }),
      payload: req.body, auditRequest: req })
    return res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: {
      code: error.code, message: error.message, requestId: req.requestId,
    } })
    return next(error)
  }
}
export const readReviewCompletion = handle(getReviewCompletion)
export const recordReviewCompletion = handle(completeReview)
