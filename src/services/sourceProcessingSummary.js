import mongoose from 'mongoose'
import AuditLog from '../models/AuditLog.js'
import { assertAcquisitionTerminalProof } from './acquisitionReceiptProof.js'

const CAP = 1000
const BYTES = 512 * 1024
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash = /^sha256:[a-f0-9]{64}$/
const projection = fields => Object.fromEntries(fields.split(' ').map(field => [field, 1]))
const SOURCE_FIELDS = projection('_id customerId tenantId runtimeInstanceId runtimeInstanceKey sourceId sourceType contentHash processingReceipt current isCurrent stateStatus status stateVersion sourceStateVersion')
const RUN_FIELDS = projection('_id customerId tenantId runtimeInstanceId runtimeInstanceKey actorUserId runId executionAttemptId requestFingerprint status canonicalSaved outcomes outputStateVersion terminalAuditId terminalAuditSignatureVersion saveAuditId saveAuditSignature saveAuditSignatureVersion')
const SAVE_FIELDS = projection('_id action actorUserId resourceId signature signatureVersion')
const unavailable = reason => Object.assign(new Error('The source summary could not complete its bounded read. Refresh.'), {
  status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason },
})

// Production wrapper supplies scoped authorization and version/currentness checks.
// All data families share one snapshot session, deadline and byte allowance.
export const readSourceProcessingSummary = async ({ session, deadline, readBudget, control, sourceFilter, validateSources }) => {
  let usedBytes = 0
  const options = () => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw unavailable('SOURCE_SUMMARY_DEADLINE_EXCEEDED')
    const timeoutMS = Math.min(2000, remaining)
    return { session, ...(readBudget ? readBudget() : { timeoutMS, maxTimeMS: timeoutMS }) }
  }
  const readFamily = async (name, filter, fields, source = false) => {
    const collection = mongoose.connection.db.collection(name)
    const pipeline = [{ $match: filter }, ...(fields ? [{ $project: fields }] : []),
      { $sort: { _id: 1 } }, { $limit: CAP + 1 },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]
    const [size] = await collection.aggregate(pipeline, options()).toArray()
    if (!size) return []
    if (!Number.isSafeInteger(size.count) || !Number.isSafeInteger(size.bytes) || size.count < 0 || size.bytes < 0)
      throw unavailable('SOURCE_SUMMARY_INVALID_SIZE_RECEIPT')
    if (size.count > CAP) return null
    if (usedBytes + size.bytes > BYTES) {
      if (source) throw unavailable('SOURCE_SUMMARY_READ_CAP_EXCEEDED')
      return null
    }
    const rows = await collection.find(filter, { ...options(), batchSize: CAP + 1,
      ...(fields ? { projection: fields } : {}) })
      .sort({ _id: 1 }).limit(CAP + 1).toArray()
    const actual = Buffer.byteLength(JSON.stringify(rows), 'utf8')
    usedBytes += Math.max(size.bytes, actual)
    if (rows.length !== size.count || usedBytes > BYTES) {
      if (source) throw unavailable('SOURCE_SUMMARY_READ_CAP_EXCEEDED')
      return null
    }
    return rows
  }
  const scope = { customerId: control.customerId, tenantId: control.tenantId,
    runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey }
  const base = { contractVersion: 'intelligence-source-summary.v1', scope,
    stateVersion: control.stateVersion, currency: 'AS_READ', readAt: new Date().toISOString(),
    basis: 'DOCUMENT_SOURCE_CURRENT_CONTENT_SUCCESS_RECEIPT', countLimit: CAP,
    readReceipt: { bounded: true, maxSerializedPayloadBytes: BYTES, maxTimeMS: 2000,
      requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500,
      fullLegacyFrameworkStateFetched: false } }
  const sources = await readFamily('runtime_evidence_sources', sourceFilter, SOURCE_FIELDS, true)
  if (!sources) return { ...base, sourceCompleteness: 'PARTIAL', processingCompleteness: 'UNAVAILABLE',
    uniqueSourceCount: null, documentSourceCount: null, documentsProcessed: null,
    knownProcessedCount: null, unknownCount: null, staleCount: null,
    reasons: { SOURCE_COUNT_CAP_EXCEEDED: 1 } }
  validateSources(sources)
  for (const source of sources) {
    if (String(source.customerId) !== control.customerId || String(source.tenantId) !== control.tenantId
      || String(source.runtimeInstanceId) !== control.id || source.runtimeInstanceKey !== control.runtimeInstanceKey
      || typeof source.sourceId !== 'string' || !source.sourceId || source.sourceId.length > 240
      || source.sourceId.trim() !== source.sourceId
      || [...source.sourceId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || typeof source.sourceType !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(source.sourceType))
      throw unavailable('SOURCE_SUMMARY_IDENTITY_INVALID')
  }
  const types = Object.create(null)
  for (const source of sources) types[source.sourceType] = (types[source.sourceType] || 0) + 1
  const docs = sources.filter(source => source.sourceType === 'UPLOADED_DOCUMENT')
  const reasons = {}
  let knownProcessedCount = 0, unknownCount = 0, staleCount = 0
  const unknown = reason => { unknownCount++; reasons[reason] = (reasons[reason] || 0) + 1 }
  const candidates = []
  for (const doc of docs) {
    const receipt = doc.processingReceipt
    if (!hash.test(doc.contentHash || '') || !receipt
      || Object.keys(receipt).sort().join(',') !== 'contentHash,contractVersion,inputIndex,runId'
      || receipt.contractVersion !== 'document-processing-receipt.v1' || !uuid.test(receipt.runId || '')
      || !Number.isInteger(receipt.inputIndex) || receipt.inputIndex < 0 || receipt.inputIndex > 4
      || !hash.test(receipt.contentHash || '')) { unknown('PROCESSING_PROVENANCE_MISSING_OR_INVALID'); continue }
    if (receipt.contentHash !== doc.contentHash) {
      staleCount++; reasons.PROCESSING_CONTENT_CHANGED = (reasons.PROCESSING_CONTENT_CHANGED || 0) + 1
    } else candidates.push(doc)
  }
  const completeSources = { sourceCompleteness: 'COMPLETE', uniqueSourceCount: sources.length,
    documentSourceCount: docs.length, sourceCountsByType: types }
  const cappedProof = () => ({ ...base, ...completeSources, processingCompleteness: 'UNAVAILABLE',
    documentsProcessed: null, knownProcessedCount: 0, unknownCount: docs.length, staleCount: 0,
    reasons: { PROOF_READ_CAP_EXCEEDED: docs.length },
    readReceipt: { ...base.readReceipt, projectedReadBytes: usedBytes } })
  if (candidates.length) {
    const nativeScope = { customerId: new mongoose.Types.ObjectId(control.customerId),
      tenantId: new mongoose.Types.ObjectId(control.tenantId), runtimeInstanceId: new mongoose.Types.ObjectId(control.id) }
    const runs = await readFamily('runtime_acquisition_runs', { ...nativeScope,
      runId: { $in: [...new Set(candidates.map(doc => doc.processingReceipt.runId))] } }, RUN_FIELDS)
    if (!runs) return cappedProof()
    const auditIds = key => [...new Map(runs.filter(row => mongoose.isValidObjectId(row[key]))
      .map(row => [String(row[key]), new mongoose.Types.ObjectId(row[key])])).values()]
    const terminals = await readFamily(AuditLog.collection.name, { resourceId: nativeScope.runtimeInstanceId,
      action: 'RUNTIME_ACQUISITION_RECORDED', _id: { $in: auditIds('terminalAuditId') } }, null)
    if (!terminals) return cappedProof()
    const saves = await readFamily(AuditLog.collection.name, { resourceId: nativeScope.runtimeInstanceId,
      _id: { $in: auditIds('saveAuditId') } }, SAVE_FIELDS)
    if (!saves) return cappedProof()
    const runMap = new Map(runs.map(row => [row.runId, row]))
    const terminalMap = new Map(terminals.map(row => [String(row._id), row]))
    const saveMap = new Map(saves.map(row => [String(row._id), row]))
    for (const doc of candidates) {
      const row = runMap.get(doc.processingReceipt.runId)
      if (!row) { unknown('PROCESSING_RUN_UNAVAILABLE'); continue }
      try {
        assertAcquisitionTerminalProof(row, terminalMap.get(String(row.terminalAuditId)), saveMap.get(String(row.saveAuditId)))
      } catch (error) {
        if (error.details?.reason !== 'ACQUISITION_RECEIPT_UNVERIFIED') throw error
        unknown('PROCESSING_RECEIPT_UNVERIFIED'); continue
      }
      const outcome = Array.isArray(row.outcomes) && row.outcomes.length <= 16
        ? row.outcomes.filter(item => item.kind === 'DOCUMENT' && item.inputIndex === doc.processingReceipt.inputIndex) : []
      if (row.runtimeInstanceKey !== control.runtimeInstanceKey || row.canonicalSaved !== true
        || !['SUCCEEDED', 'PARTIALLY_SUCCEEDED'].includes(row.status)
        || !row.outputStateVersion || outcome.length !== 1 || outcome[0].status !== 'SUCCEEDED'
        || outcome[0].sourceId !== doc.sourceId || `sha256:${outcome[0].contentHash}` !== doc.contentHash
        || !Number.isSafeInteger(outcome[0].evidenceObjectCount) || outcome[0].evidenceObjectCount < 0) {
        unknown('PROCESSING_OUTCOME_UNVERIFIED'); continue
      }
      knownProcessedCount++
    }
  }
  return { ...base, ...completeSources, processingCompleteness: unknownCount ? 'PARTIAL' : 'COMPLETE',
    documentsProcessed: unknownCount ? null : knownProcessedCount, knownProcessedCount, unknownCount, staleCount, reasons,
    readReceipt: { ...base.readReceipt, projectedReadBytes: usedBytes } }
}
