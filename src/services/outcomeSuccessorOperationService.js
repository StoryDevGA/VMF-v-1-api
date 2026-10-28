import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import OutcomeSuccessorOperation from '../models/OutcomeSuccessorOperation.js'
import OutcomeAsset from '../models/OutcomeAsset.js'
import OutcomeAssetVersion from '../models/OutcomeAssetVersion.js'
import auditService from './auditService.js'
import { outcomeSuccessorError, hashOutcomeSuccessorValue } from './outcomeSuccessorContract.js'
import { outcomeSuccessorConfirmationFingerprint } from './outcomeSuccessorConfirmation.js'

export const outcomeSuccessorOperationLookup = (binding) => ({ customerId: binding.source.customerId,
  tenantId: binding.source.tenantId, sourceRuntimeInstanceId: binding.source.runtimeInstanceId,
  idempotencyKey: binding.idempotencyKey })
export const assertOutcomeSuccessorOperationIndexes = async (model = OutcomeSuccessorOperation) => {
  const indexes = await model.collection.indexes()
  const required = [
    { operationId: 1 },
    { customerId: 1, tenantId: 1, sourceRuntimeInstanceId: 1, idempotencyKey: 1 },
    { customerId: 1, tenantId: 1, targetRuntimeInstanceId: 1, requestId: 1 },
  ]
  if (required.some((key) => !indexes.some((index) => index.unique === true
    && JSON.stringify(index.key) === JSON.stringify(key) && !index.partialFilterExpression && !index.sparse))) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_INDEXES_REQUIRED', 503)
  }
}
export const readOutcomeSuccessorOperationByKey = async (binding, deps = {}) =>
  (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).findOne(outcomeSuccessorOperationLookup(binding)).maxTimeMS(2000).lean()
export const assertOutcomeSuccessorOperationBinding = (operation, binding) => {
  if (operation.payloadFingerprint !== outcomeSuccessorConfirmationFingerprint(binding)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_IDEMPOTENCY_CONFLICT')
  }
}
export const writeOutcomeSuccessorClaimAudit = async ({ operation, binding, auditRequest, session }) => {
  const source = await OutcomeAsset.findOne({ customerId: binding.source.customerId, tenantId: binding.source.tenantId,
    runtimeInstanceId: binding.source.runtimeInstanceId, outcomeAssetId: binding.source.outcomeAssetId })
    .select('_id').session(session).maxTimeMS(2000).lean()
  if (!source) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_SOURCE_NOT_FOUND', 404)
  return auditService.logFromRequest(auditRequest, { actorUserId: binding.actorUserId,
    action: auditService.AUDIT_ACTIONS.OUTCOME_SUCCESSOR_REQUESTED,
    resourceType: auditService.RESOURCE_TYPES.OutcomeAsset, resourceId: source._id,
    scope: { customerId: binding.source.customerId, tenantId: binding.source.tenantId },
    diff: { successor: { operationId: operation.operationId, sourceAssetId: binding.source.outcomeAssetId,
      sourceAssetVersionId: binding.source.outcomeAssetVersionId, sourceRuntimeInstanceId: binding.source.runtimeInstanceId,
      targetRuntimeInstanceId: binding.target.runtimeInstanceId, targetRevisionNumber: binding.target.revisionNumber,
      status: 'PREPARING' } },
  }, { session, throwOnError: true })
}
export const claimOutcomeSuccessorOperation = async ({ binding, auditRequest, deps = {} }) => {
  const model = deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation
  const db = deps.mongoose || mongoose
  if (db.connection.readyState !== 1 || db.connection.getClient()?.topology?.description?.type !== 'ReplicaSetWithPrimary') {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_TRANSACTION_REQUIRED', 503)
  }
  await assertOutcomeSuccessorOperationIndexes(model)
  const previous = await readOutcomeSuccessorOperationByKey(binding, deps)
  if (previous) { assertOutcomeSuccessorOperationBinding(previous, binding); return { operation: previous, idempotent: true } }
  const document = { operationId: `outcome_successor_${randomUUID()}`, actorUserId: binding.actorUserId,
    ...outcomeSuccessorOperationLookup(binding), targetRuntimeInstanceId: binding.target.runtimeInstanceId,
    sourceAssetId: binding.source.outcomeAssetId, sourceAssetVersionId: binding.source.outcomeAssetVersionId,
    requestId: binding.requestId, payloadFingerprint: outcomeSuccessorConfirmationFingerprint(binding),
    binding: { source: binding.source, target: binding.target, metadataFingerprint: binding.metadataFingerprint,
      intentFingerprint: binding.intentFingerprint, contractFingerprint: binding.contractFingerprint }, status: 'PREPARING' }
  const session = await db.startSession()
  let created
  try {
    await session.withTransaction(async () => {
      ;[created] = await model.create([document], { session })
      const audit = await (deps.writeClaimAudit || writeOutcomeSuccessorClaimAudit)({ operation: created, binding, auditRequest, session })
      if (!audit) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_AUDIT_REQUIRED', 503)
    })
    return { operation: created.toObject(), idempotent: false }
  } catch (error) {
    if (error.code !== 11000) throw error
    const winner = await readOutcomeSuccessorOperationByKey(binding, deps)
    if (!winner) {
      if (error.keyPattern?.requestId) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_TARGET_REQUEST_CONFLICT')
      throw error
    }
    assertOutcomeSuccessorOperationBinding(winner, binding)
    return { operation: winner, idempotent: true }
  } finally { await session.endSession() }
}

// Trusted owner seam: an API body never supplies the operation executor identity.
export const assertOutcomeSuccessorExecutionClaim = async ({ operationId, claimId, runtimeInstanceId,
  requestId, planId, allowedStatuses = ['PREPARING', 'GENERATING'], session = null, deps = {} }) => {
  const operation = await (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).findOne({ operationId,
    claimId, targetRuntimeInstanceId: runtimeInstanceId, requestId, status: { $in: allowedStatuses } })
    .session(session).maxTimeMS(2000).lean()
  if (!claimId || !operation || (planId && operation.refs?.planId !== planId)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED')
  }
  return operation
}

export const requireOutcomeSuccessorSessionClaim = async ({ runtime, requestId, planId, successorOperation,
  allowedStatuses = ['PREPARING'], deps = {} }) => {
  const operation = await (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).findOne({
    customerId: runtime.customerId, tenantId: runtime.tenantId,
    targetRuntimeInstanceId: runtime._id || runtime.id, requestId }).maxTimeMS(2000).lean()
  if (!operation) {
    if (successorOperation) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED')
    return null
  }
  if (!successorOperation || successorOperation.operationId !== operation.operationId) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED')
  }
  return assertOutcomeSuccessorExecutionClaim({ operationId: operation.operationId,
    claimId: successorOperation.claimId, runtimeInstanceId: runtime._id || runtime.id,
    requestId, planId, allowedStatuses, deps })
}

export const assertOutcomeSuccessorApprovedDraftBinding = async ({ runtime, draft, iteration, session = null, deps = {} }) => {
  const lineage = sanitizeOutcomeSuccessorLineage(iteration.lineageSummary?.successor || draft.lineageSummary?.successor)
  if (!lineage) return null
  const operation = await (deps.OutcomeSuccessorOperation || OutcomeSuccessorOperation).findOne({
    operationId: lineage.operationId, status: 'SUCCEEDED', customerId: runtime.customerId, tenantId: runtime.tenantId,
    targetRuntimeInstanceId: runtime._id || runtime.id, requestId: lineage.requestId,
    'refs.planId': lineage.planId, 'refs.draftId': draft.draftId, 'refs.draftIterationId': iteration.draftIterationId,
  }).session(session).maxTimeMS(2000).lean()
  if (!operation || hashOutcomeSuccessorLineage(operation) !== hashOutcomeSuccessorValue(lineage)) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  }
  const sourceVersion = await (deps.OutcomeAssetVersion || OutcomeAssetVersion).findOne({
    customerId: operation.customerId, tenantId: operation.tenantId, runtimeInstanceId: operation.sourceRuntimeInstanceId,
    outcomeAssetId: operation.sourceAssetId, outcomeAssetVersionId: operation.sourceAssetVersionId,
  }).session(session).maxTimeMS(2000).lean()
  if (!sourceVersion || hashOutcomeSuccessorValue(sourceVersion) !== operation.binding.source.sourceVersionWitnessHash) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  }
  return operation
}
const hashOutcomeSuccessorLineage = (operation) => hashOutcomeSuccessorValue(projectOutcomeSuccessorLineage(operation))

export const projectOutcomeSuccessorLineage = (operation) => ({
  contractVersion: 'outcome-successor.lineage.v1', operationId: operation.operationId,
  sourceAssetId: operation.sourceAssetId, sourceAssetVersionId: operation.sourceAssetVersionId,
  sourceRuntimeInstanceId: String(operation.sourceRuntimeInstanceId),
  sourceVersionWitnessHash: operation.binding.source.sourceVersionWitnessHash,
  sourceHash: operation.binding.source.sourceHash,
  sourceRevisionNumber: operation.binding.source.revisionNumber,
  targetRuntimeInstanceId: String(operation.targetRuntimeInstanceId),
  targetRevisionNumber: operation.binding.target.revisionNumber,
  targetStateVersion: operation.binding.target.stateVersion,
  requestId: operation.requestId, planId: operation.refs?.planId || '',
  intentFingerprint: operation.binding.intentFingerprint,
  contractFingerprint: operation.binding.contractFingerprint,
})

export const sanitizeOutcomeSuccessorLineage = (lineage) => {
  if (!lineage) return null
  const fields = ['contractVersion', 'operationId', 'sourceAssetId', 'sourceAssetVersionId', 'sourceRuntimeInstanceId',
    'sourceVersionWitnessHash', 'sourceHash', 'targetRuntimeInstanceId', 'targetStateVersion', 'requestId', 'planId',
    'intentFingerprint', 'contractFingerprint']
  if (lineage.contractVersion !== 'outcome-successor.lineage.v1' || fields.some((field) => !String(lineage[field] || '').trim())
    || ['sourceVersionWitnessHash', 'sourceHash', 'intentFingerprint', 'contractFingerprint']
      .some((field) => !/^[a-f0-9]{64}$/.test(lineage[field]))
    || !Number.isSafeInteger(lineage.sourceRevisionNumber) || lineage.sourceRevisionNumber < 1
    || !Number.isSafeInteger(lineage.targetRevisionNumber) || lineage.targetRevisionNumber < 1) {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID')
  }
  return { ...Object.fromEntries(fields.map((field) => [field, String(lineage[field]).trim()])),
    sourceRevisionNumber: lineage.sourceRevisionNumber, targetRevisionNumber: lineage.targetRevisionNumber }
}

export const writeOutcomeSuccessorCompletionAudit = async ({ operation, actorUserId, auditRequest, session }) => {
  const source = await OutcomeAsset.findOne({ customerId: operation.customerId, tenantId: operation.tenantId,
    runtimeInstanceId: operation.sourceRuntimeInstanceId, outcomeAssetId: operation.sourceAssetId })
    .select('_id').session(session).maxTimeMS(2000).lean()
  if (!source || !operation.refs?.draftId || !operation.refs?.draftIterationId || operation.status !== 'SUCCEEDED') {
    throw outcomeSuccessorError('OUTCOME_SUCCESSOR_COMPLETION_AUDIT_REQUIRED')
  }
  return auditService.logFromRequest(auditRequest, { actorUserId: actorUserId || operation.actorUserId,
    action: auditService.AUDIT_ACTIONS.OUTCOME_SUCCESSOR_COMPLETED,
    resourceType: auditService.RESOURCE_TYPES.OutcomeAsset, resourceId: source._id,
    scope: { customerId: operation.customerId, tenantId: operation.tenantId },
    diff: { successor: { operationId: operation.operationId, sourceAssetId: operation.sourceAssetId,
      sourceAssetVersionId: operation.sourceAssetVersionId, targetRuntimeInstanceId: String(operation.targetRuntimeInstanceId),
      requestId: operation.requestId, planId: operation.refs.planId, draftId: operation.refs.draftId,
      draftIterationId: operation.refs.draftIterationId, status: 'SUCCEEDED' } },
  }, { session, throwOnError: true })
}
