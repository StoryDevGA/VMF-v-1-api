import { assertOutcomeEvidenceInventory, OUTCOME_EVIDENCE_SNAPSHOT_VERSION } from '../utils/outcomeEvidenceSnapshot.js'

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 240
  && value.trim() === value && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const unavailable = () => Object.assign(new Error('The current evidence inventory receipt is unavailable. Refresh to verify it.'), {
  status: 503, code: 'INTELLIGENCE_EVIDENCE_INVENTORY_UNAVAILABLE',
})

// The SS-040 assembler owns completeness and record hashes. This is only its
// public projection; current inventory does not establish frozen membership.
export function projectIntelligenceEvidenceInventory({ snapshot, control, readAt }) {
  const receipt = snapshot?.inventoryReceipt
  if (!receipt || receipt.version !== OUTCOME_EVIDENCE_SNAPSHOT_VERSION
    || receipt.completeness !== 'COMPLETE' || snapshot.stateVersion !== control.stateVersion
    || receipt.scope?.runtimeInstanceId !== control.id || receipt.scope?.runtimeInstanceKey !== control.runtimeInstanceKey
    || receipt.scope?.customerId !== control.customerId || receipt.scope?.tenantId !== control.tenantId
    || receipt.scope?.stateVersion !== control.stateVersion || !hash(receipt.overallHash)) throw unavailable()
  try { assertOutcomeEvidenceInventory(snapshot) } catch { throw unavailable() }
  const evidence = receipt.collections.evidence
  const sources = receipt.collections.sources
  if (evidence.records.some(record => !validId(record.id) || !validId(record.sourceReference) || !hash(record.hash))
    || sources.records.some(record => !validId(record.id) || !hash(record.hash))) throw unavailable()
  const result = {
    contractVersion: 'intelligence-evidence-inventory.v1', upstreamContractVersion: receipt.version,
    scope: { runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey,
      customerId: control.customerId, tenantId: control.tenantId },
    stateVersion: control.stateVersion, currency: 'AS_READ', readAt,
    basis: 'CURRENT_STORED_INVENTORY', completeness: 'COMPLETE', inventoryHash: receipt.overallHash,
    evidence: { expectedCount: evidence.totalCount, readCount: evidence.records.length },
    sources: { expectedCount: sources.totalCount, readCount: sources.records.length,
      records: sources.records.map(record => ({ sourceId: record.id, recordHash: record.hash })) },
    sectionMapping: { basis: 'STORED_SECTION_REFERENCES', state: receipt.sectionReadiness,
      sectionCount: receipt.sectionCoverage.length,
      unresolvedReferenceCount: receipt.sectionCoverage.reduce((total, section) => total + section.missingReferences.length, 0)
        + receipt.contradictionReferences.filter(ref => !evidence.records.some(record => record.id === ref || record.sourceReference === ref)).length },
    readReceipt: { bounded: true, inventoryPageSize: receipt.pageSize, maxTimeMS: 2000,
      requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500, maxSerializedReadBytes: 512 * 1024,
      fullLegacyFrameworkStateFetched: false },
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw unavailable()
  return result
}
