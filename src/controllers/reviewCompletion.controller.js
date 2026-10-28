import { getReviewCompletion, completeReview } from '../services/reviewCompletionService.js'
import { inspectPublishedDispositionRecovery, recordPublishedDispositionRecovery } from '../services/publishedDispositionRecoveryService.js'
import { inspectSupplementalFindingReview, recordSupplementalFindingReview } from '../services/supplementalFindingReviewService.js'
import { inspectRuntimeProductAuthority, importRuntimeProductAuthority } from '../services/runtimeProductAuthorityService.js'
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
export const readPublishedDispositionRecovery = handle(inspectPublishedDispositionRecovery)
export const recordSupplementalPublishedDisposition = handle(recordPublishedDispositionRecovery)
export const readSupplementalFindingReview = handle(inspectSupplementalFindingReview)
export const recordSupplementalFinding = handle(recordSupplementalFindingReview)
export const readRuntimeProductAuthority = handle(inspectRuntimeProductAuthority)
export const recordRuntimeProductAuthority = handle(importRuntimeProductAuthority)
export const readEvidenceSnapshotRecovery = handle(async args => (await import('../services/runtimeEvidenceSnapshotRecoveryService.js')).inspectRuntimeEvidenceSnapshotRecovery(args))
export const recordEvidenceSnapshotRecovery = handle(async args => (await import('../services/runtimeEvidenceSnapshotRecoveryService.js')).recordRuntimeEvidenceSnapshotRecovery(args))
