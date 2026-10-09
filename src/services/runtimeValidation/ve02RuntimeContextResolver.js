import { getRuntimeOutcomeEvidenceContractSnapshot } from '../runtimeStateRepository.js'
import { getRuntimeInstance } from '../runtimeInstanceService.js'
import { assertOutcomeEvidenceInventory, snapshotHash } from '../../utils/outcomeEvidenceSnapshot.js'
import RuntimeEvidenceObject from '../../models/RuntimeEvidenceObject.js'
import { loadVE02ConsumptionHistory } from './ve02ConsumptionReceipt.js'
import { resolveVE02ContractBinding } from './ve02ContractBindingRegistry.js'
export { VE02_SOURCE_BINDING } from './ve02ContractBindingRegistry.js'

// Exact material fingerprint; receipt fences change only Mongo version metadata.
export const ve02MaterialRevision = (evidence, source) => {
  const material = ({ __v, createdAt, updatedAt, ...record }) => record
  return `sha256:${snapshotHash({ evidence: material(evidence), source: material(source) })}`
}

// Scoped canonical reads only. The public request cannot supply the resolver,
// inventory receipt or lifecycle proof. This does not assess evidence quality.
export const resolveVE02RuntimeContext = async ({ input, scopes, session, dependencies = {} }) => {
  if (!input.runtimeInstanceId || !session?.inTransaction()) return undefined
  const runtimeReader = dependencies.runtimeReader || getRuntimeInstance
  const snapshotReader = dependencies.snapshotReader || getRuntimeOutcomeEvidenceContractSnapshot
  const evidenceReader = dependencies.evidenceReader || ((filter) => RuntimeEvidenceObject.findOne(filter).session(session).lean())
  const runtime = await runtimeReader({ scopes, runtimeInstanceId: input.runtimeInstanceId, session,
    maxTimeMS: 2000, projection: '_id customerId tenantId runtimeInstanceKey stateVersion runtimeStateVersion packageId packageKey packageVersion frameworkKey runtimeType' })
  if (String(runtime.packageId) !== String(input.packageId) || runtime.frameworkKey !== input.frameworkKey) return undefined
  const snapshot = await snapshotReader({ scopes, runtimeInstanceId: input.runtimeInstanceId, session, boundedInventoryRead: true })
  if (!snapshot.inventoryReceipt) return undefined // No legacy proof inferred.
  assertOutcomeEvidenceInventory(snapshot)
  const scope = snapshot.inventoryReceipt.scope
  if (scope.runtimeInstanceId !== String(runtime.id || runtime._id)
    || scope.customerId !== String(runtime.customerId) || scope.tenantId !== String(runtime.tenantId)) return undefined
  const inventoryRecord = snapshot.inventoryReceipt.collections.evidence.records.find((record) => record.id === input.payload?.evidence_id)
  if (!inventoryRecord) return undefined
  const evidence = snapshot.evidenceObjects.find((row) => row.evidenceObjectId === inventoryRecord.id)
    || await evidenceReader({ _id: inventoryRecord.storageId, customerId: scope.customerId,
      tenantId: scope.tenantId, runtimeInstanceId: scope.runtimeInstanceId, current: true, stateVersion: scope.stateVersion })
  if (!evidence || snapshotHash(evidence) !== inventoryRecord.hash) return undefined
  const source = snapshot.sourceRegistry.find((row) => row.sourceId === evidence.sourceId)
  if (!source || evidence.current !== true || source.current !== true
    || evidence.stateVersion !== scope.stateVersion || source.stateVersion !== scope.stateVersion) return undefined
  const contractBinding = await resolveVE02ContractBinding({ session, dependencies, query: {
    frameworkKey: runtime.frameworkKey, runtimeType: runtime.runtimeType,
    packageKey: runtime.packageKey, packageVersion: runtime.packageVersion,
  } })
  if (!contractBinding) return undefined
  const { activation, source: binding } = contractBinding
  const sourceRef = source.sourceRef || source.lineageRef
  if (!sourceRef || !evidence.lineageRef) return undefined
  const context = {
    runtimeId: scope.runtimeInstanceId, customerId: scope.customerId, tenantId: scope.tenantId,
    stateVersion: scope.stateVersion, packageId: String(runtime.packageId),
    frameworkKey: runtime.frameworkKey, packageKey: runtime.packageKey, packageVersion: runtime.packageVersion,
    evidence: { ...evidence, currentnessState: 'CURRENT' }, source: { ...source, currentnessState: 'CURRENT' },
    claimEvidence: evidence, claimSource: source,
    evidenceRevisionRef: ve02MaterialRevision(evidence, source),
    governingRuntimeVersion: binding.governingRuntimeVersion, activation,
    provenanceRefs: [...new Set([sourceRef, evidence.lineageRef])],
    requiredProvenanceRefs: [...new Set([sourceRef, evidence.lineageRef])],
  }
  const historyReader = dependencies.historyReader || loadVE02ConsumptionHistory
  const history = await historyReader({ context, resultId: input.payload?.result_id, session })
  if (!Array.isArray(history) || history.length > 1) return undefined
  context.resultRecords = history.map((record) => record.ve02Receipt.payload)
  context.existingReceiptAudit = history[0]
  return context
}
