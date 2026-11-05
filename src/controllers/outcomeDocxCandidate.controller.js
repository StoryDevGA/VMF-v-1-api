import { buildRuntimeStateRequestScopes } from './runtimeInstance.controller.js'
import { createPrivateDocxCandidate, readPrivateDocxCandidate, listCurrentPrivateDocxCandidates } from '../services/outcomeDocxCandidatePersistenceService.js'
import { readControlledDocxForRequest, usesControlledDocxRead } from '../services/controlledDocxReadService.js'
const input = req => ({ actorUserId: req.context?.userId || req.userId, runtimeInstanceId: req.params.runtimeInstanceId,
  candidateId: req.params.candidateId, scopes: buildRuntimeStateRequestScopes({ scopes: req.scopes, query: req.query }),
  payload: req.body, auditRequest: req })
const handle = (operation, includeBytes = false, controlledOperation = null) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store')
    const data = controlledOperation && usesControlledDocxRead(req.params.runtimeInstanceId)
      ? await readControlledDocxForRequest(req, res, controlledOperation)
      : await operation({ ...input(req), includeBytes })
    if (includeBytes) return res.set({ 'Content-Type': data.candidate.artifact.mimeType,
      'Content-Disposition': 'inline; filename="private-outcome-candidate.docx"',
      'X-Outcome-Candidate-Status': 'PRIVATE_UNREVIEWED', 'X-Content-Type-Options': 'nosniff' }).send(data.buffer)
    return res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) {
    if (error.status && error.code) return res.status(error.status).json({ error: { code: error.code, message: error.message,
      reason: error.details?.reason, requestId: req.requestId } })
    return next(error)
  }
}
export const createPrivateDocxCandidateEndpoint = handle(createPrivateDocxCandidate)
export const readPrivateDocxCandidateEndpoint = handle(readPrivateDocxCandidate)
export const readPrivateDocxCandidateFileEndpoint = handle(readPrivateDocxCandidate, true)
export const listCurrentPrivateDocxCandidatesEndpoint = handle(listCurrentPrivateDocxCandidates, false, 'LIST')
