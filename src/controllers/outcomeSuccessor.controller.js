import { confirmOutcomeSuccessor, createOutcomeSuccessorOperation } from '../services/outcomeSuccessorService.js'
import { executeOutcomeSuccessorOperation, reconcileOutcomeSuccessorOperation } from '../services/outcomeSuccessorExecutionService.js'
import { getOutcomeSuccessorPreflightPresentation, getOutcomeSelectedVersionPreview, getOutcomeSuccessorCompare,
  projectOutcomeSuccessorOperation, getOutcomeSuccessorOperationByKey,
  getOutcomeSuccessorOperationPresentation } from '../services/outcomeSuccessorPresentationService.js'
import { openOutcomeSuccessorConfirmation } from '../services/outcomeSuccessorConfirmation.js'
import { outcomeSuccessorError, hashOutcomeSuccessorValue } from '../services/outcomeSuccessorContract.js'

const args = (req) => ({ actorUserId: req.context?.userId || req.userId, scopes: req.scopes, ...req.params })
const envelope = (req, data) => ({ data, meta: { requestId: req.requestId, version: 'v1' } })
const failure = (req, res, error) => {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
  const material = error?.reason === 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE'
  const confirmation = /^OUTCOME_SUCCESSOR_CONFIRMATION_/.test(error?.reason || '')
  return res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN'
    : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'REQUEST_FAILED' : 'CONFLICT',
  message: material ? 'The Framework or package lineage changed. Create a new asset instead.'
    : confirmation ? 'Refresh the version and target details, then confirm again.'
      : 'The request could not be completed. Check the saved result before continuing.',
  details: { diagnosticCode: material ? 'OUTCOME_SUCCESSOR_MATERIAL_LINEAGE_CHANGE'
    : confirmation ? 'OUTCOME_SUCCESSOR_CONFIRMATION_REQUIRED' : 'OUTCOME_SUCCESSOR_REQUEST_UNAVAILABLE',
  recoveryAction: material ? 'CREATE_NEW_ASSET' : confirmation ? 'REFRESH_CONFIRMATION' : 'CHECK_SAVED_RESULT' }, requestId: req.requestId } })
}
const handle = (owner) => async (req, res) => {
  try { return await owner(req, res) } catch (error) { return failure(req, res, error) }
}
export const preflightOutcomeSuccessor = handle(async (req, res) => res.status(200).json(envelope(req,
  await getOutcomeSuccessorPreflightPresentation({ ...args(req), targetRuntimeInstanceId: req.query.targetRuntimeInstanceId }))))
export const confirmRuntimeOutcomeSuccessor = handle(async (req, res) => {
  const result = await confirmOutcomeSuccessor({ ...args(req), ...req.body })
  const binding = openOutcomeSuccessorConfirmation(result.confirmation.receipt)
  // Refresh only passive customer-facing descriptors; preserve the exact sealed confirmation.
  let canonical
  const presentation = await getOutcomeSuccessorPreflightPresentation({ ...args(req),
    targetRuntimeInstanceId: binding.target.runtimeInstanceId, deps: { successorRequestId: binding.requestId },
    captureCanonicalPreflight: (value) => { canonical = value } })
  if (canonical?.status !== 'READY_FOR_CONFIRMATION'
    || hashOutcomeSuccessorValue(canonical.source) !== hashOutcomeSuccessorValue(binding.source)
    || hashOutcomeSuccessorValue(canonical.target) !== hashOutcomeSuccessorValue(binding.target)
    || canonical.metadataFingerprint !== binding.metadataFingerprint
    || canonical.carryForward?.contractFingerprint !== binding.contractFingerprint
    || canonical.carryForward?.intentFingerprint !== binding.intentFingerprint) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_STALE')
  return res.status(200).json(envelope(req, { ...presentation, requestId: result.requestId,
    idempotencyKey: result.idempotencyKey, confirmation: { required: true, executable: false, receipt: result.confirmation.receipt,
      expiresAt: new Date(binding.expiresAt).toISOString() } }))
})
export const createRuntimeOutcomeSuccessor = handle(async (req, res) => {
  const claimed = await createOutcomeSuccessorOperation({ ...args(req), ...req.body, auditRequest: req })
  if (claimed.idempotent) return res.status(claimed.status === 'SUCCEEDED' ? 200 : 202).json(envelope(req,
    await getOutcomeSuccessorOperationPresentation({ ...args(req), operationId: claimed.operationId, idempotent: true })))
  const result = await executeOutcomeSuccessorOperation({ ...args(req), operationId: claimed.operationId, auditRequest: req,
    deps: { generationOptions: req.app.locals.outcomeStudioReasoningDeps || {} } })
  return res.status(result.operation.status === 'SUCCEEDED' ? 201 : 202).json(envelope(req, projectOutcomeSuccessorOperation(result)))
})
export const readRuntimeOutcomeSuccessor = handle(async (req, res) => res.status(200).json(envelope(req,
  await getOutcomeSuccessorOperationPresentation(args(req)))))
export const compareRuntimeOutcomeSuccessor = handle(async (req, res) => res.status(200).json(envelope(req,
  await getOutcomeSuccessorCompare(args(req)))))
export const reconcileRuntimeOutcomeSuccessor = handle(async (req, res) => res.status(200).json(envelope(req,
  projectOutcomeSuccessorOperation(await reconcileOutcomeSuccessorOperation({ ...args(req), auditRequest: req })))))
export const previewRuntimeOutcomeSelectedVersion = handle(async (req, res) => res.status(200).json(envelope(req,
  await getOutcomeSelectedVersionPreview(args(req)))))
export const readRuntimeOutcomeSuccessorByKey = handle(async (req, res) => res.status(200).json(envelope(req,
  await getOutcomeSuccessorOperationByKey({ ...args(req), targetRuntimeInstanceId: req.query.targetRuntimeInstanceId,
    idempotencyKey: req.query.idempotencyKey }))))
