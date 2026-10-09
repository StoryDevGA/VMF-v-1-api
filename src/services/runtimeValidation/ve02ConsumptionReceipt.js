import RuntimeValidationAudit from '../../models/RuntimeValidationAudit.js'
import RuntimeInstance from '../../models/RuntimeInstance.js'
import RuntimeEvidenceObject from '../../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../../models/RuntimeEvidenceSource.js'
import KnowledgePackActivation from '../../models/KnowledgePackActivation.js'
import KnowledgePackVersion from '../../models/KnowledgePackVersion.js'
import { generateChecksum } from '../governanceAudit/checksumService.js'
import { VE02_CONSUMER_VERSION } from './ve02EvidenceAssessmentResultContract.js'

export const assertVE02ReceiptIndex = async () => {
  const indexes = await RuntimeValidationAudit.collection.listIndexes().toArray()
  const index = indexes.find((entry) => entry.name === 'unique_ve02_consumption_result')
  const requiredKeys = ['ve02Receipt.customerId', 've02Receipt.tenantId', 've02Receipt.runtimeInstanceId', 've02Receipt.resultId']
  if (!index?.unique || JSON.stringify(Object.keys(index.key)) !== JSON.stringify(requiredKeys)
    || Object.values(index.key).some((direction) => direction !== 1)
    || generateChecksum(index.partialFilterExpression) !== generateChecksum({ 've02Receipt.resultId': { $type: 'string' } })) {
    throw Object.assign(new Error('VE02 consumption uniqueness index is unavailable.'), {
      status: 503, code: 'VE02_CONSUMPTION_INDEX_REQUIRED',
    })
  }
}

export const ve02ReceiptLookup = ({ context, resultId }) => ({
  've02Receipt.customerId': context.customerId, 've02Receipt.tenantId': context.tenantId,
  've02Receipt.runtimeInstanceId': context.runtimeId, 've02Receipt.resultId': resultId,
})
export const loadVE02ConsumptionHistory = async ({ context, resultId, session }) =>
  RuntimeValidationAudit.find(ve02ReceiptLookup({ context, resultId })).session(session).limit(2).lean()

export const buildVE02ConsumptionReceipt = ({ context, payload }) => ({
  customerId: context.customerId, tenantId: context.tenantId, runtimeInstanceId: context.runtimeId,
  resultId: payload.result_id, payloadHash: generateChecksum(payload), payload,
  evidenceRevisionRef: context.evidenceRevisionRef, activationId: context.activation.activationId,
  versionId: context.activation.versionId, contentHash: context.activation.contentHash,
  consumerVersion: VE02_CONSUMER_VERSION,
  ...(context.producerBinding ? { producerBinding: context.producerBinding } : {}),
})

const fail = () => { throw Object.assign(new Error('VE02 governed records changed during consumption.'), {
  status: 409, code: 'VE02_CONSUMPTION_BINDING_CHANGED',
}) }
export const fenceVE02Consumption = async ({ context, session }) => {
  if (!session?.inTransaction()) fail()
  const identity = { customerId: context.customerId, tenantId: context.tenantId }
  const childIdentity = { ...identity, runtimeInstanceId: context.runtimeId }
  const fences = [
    [RuntimeInstance, { _id: context.runtimeId, ...identity,
      stateVersion: context.stateVersion, packageId: context.packageId }],
    [RuntimeEvidenceObject, { _id: context.evidence._id, ...childIdentity, current: true,
      stateVersion: context.stateVersion, contentHash: context.evidence.contentHash,
      sourceHash: context.evidence.sourceHash }],
    [RuntimeEvidenceSource, { _id: context.source._id, ...childIdentity, current: true,
      stateVersion: context.stateVersion, contentHash: context.source.contentHash,
      sourceHash: context.source.sourceHash }],
    [KnowledgePackActivation, { activationId: context.activation.activationId,
      status: 'ACTIVE', versionId: context.activation.versionId, contentHash: context.activation.contentHash }],
    [KnowledgePackVersion, { versionId: context.activation.versionId,
      status: { $in: ['ACTIVE', 'VALIDATED'] }, contentHash: context.activation.contentHash }],
  ]
  for (const [model, filter] of fences) {
    const result = await model.updateOne(filter, { $inc: { __v: 1 } }, { session, timestamps: false })
    if (result.matchedCount !== 1) fail()
  }
}
