import mongoose from 'mongoose'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import AuditLog from '../models/AuditLog.js'
import { createRuntimeInstanceError } from './runtimeInstanceService.js'
import { readVerifiedPostLockLockedContext, withPostLockEvidenceTransaction,
  parsePostLockOriginalPair, assertPostLockOriginalPairBinding, verifyPostLockOriginalReceipt } from './postLockEvidenceIntakeService.js'
import { postLockError } from './postLockEvidenceIntakeContract.js'
import { createPostLockReadBudget, normalizePostLockReadStateError } from './postLockEvidenceReadStateService.js'
import { parsePostLockEvidenceListQuery, parsePostLockEvidenceListCursor, buildPostLockEvidenceListBasis,
  projectPostLockEvidenceList, assertPostLockEvidenceListMaterialSize, postLockEvidenceListError,
  isPostLockEvidenceListError } from './postLockEvidenceListContract.js'

const projection = Object.freeze(Object.fromEntries([
  '_id', 'customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey', 'stateVersion', 'sourceStateVersion',
  'sourceHash', 'current', 'stateStatus', 'status', 'isCurrent', 'migrationReceiptId', 'evidenceObjectId', 'sourceId',
  'sourceType', 'title', 'sourceRef', 'contentHash', 'lineageRef', 'extractedFact', 'acceptanceState', 'reviewStatus',
  'acquisitionStatus', 'postLockAssociation', 'postLockOrigin',
].map(key => [key, 1])))
const requireReceipt = condition => { if (!condition) throw postLockError('POST_LOCK_RECEIPT_UNVERIFIED', 503) }
const oid = value => new mongoose.Types.ObjectId(value)
const buildEvidenceQuery = ({ frame, afterEvidenceObjectId, pageSize }) => {
  const frozenIds = frame.body.evidence.map(member => member.storageId)
  requireReceipt(frozenIds.length <= 5000 && new Set(frozenIds).size === frozenIds.length
    && frozenIds.every(value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)))
  return { filter: { ...frame.scope, stateVersion: frame.runtime.stateVersion,
    evidenceObjectId: { ...(afterEvidenceObjectId ? { $gt: afterEvidenceObjectId } : { $gte: 'post-lock:' }), $lt: 'post-lock;' },
    _id: { $nin: frozenIds.map(oid) } },
  options: { projection, hint: 'unique_runtime_evidence_object_version', collation: { locale: 'simple' } },
  sort: { evidenceObjectId: 1 }, limit: pageSize + 1, batchSize: pageSize + 1 }
}
const buildSourceQuery = ({ frame, sourceIds }) => ({ filter: { ...frame.scope, stateVersion: frame.runtime.stateVersion,
  sourceId: { $in: sourceIds } },
options: { projection, hint: 'unique_runtime_evidence_source_version', collation: { locale: 'simple' } },
sort: { sourceId: 1 }, limit: sourceIds.length + 1, batchSize: sourceIds.length + 1 })
const buildAuditQuery = ({ receiptIds }) => ({ filter: { _id: { $in: receiptIds.map(oid) } },
  options: { hint: '_id_', collation: { locale: 'simple' } }, sort: { _id: 1 },
  limit: receiptIds.length + 1, batchSize: receiptIds.length + 1 })
const readPlan = (model, plan, session, readBudget) => model.collection.find(plan.filter,
  { ...plan.options, session, ...readBudget() }).sort(plan.sort).limit(plan.limit).batchSize(plan.batchSize).toArray()
const budgetReasons = Object.freeze({
  POST_LOCK_READ_STATE_DEADLINE_EXCEEDED: 'POST_LOCK_EVIDENCE_LIST_DEADLINE_EXCEEDED',
  POST_LOCK_READ_STATE_AUDIT_CAPACITY_EXCEEDED: 'POST_LOCK_EVIDENCE_LIST_AUDIT_CAPACITY_EXCEEDED',
  POST_LOCK_READ_STATE_CAPACITY_EXCEEDED: 'POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED',
  POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED: 'POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED',
  POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE: 'POST_LOCK_EVIDENCE_LIST_DEPENDENCY_UNAVAILABLE',
})
export const normalizePostLockEvidenceListError = (error, readBudget) => {
  if (isPostLockEvidenceListError(error)) {
    return error.status === 503 && readBudget?.isExpired()
      ? postLockEvidenceListError('POST_LOCK_EVIDENCE_LIST_DEADLINE_EXCEEDED') : error
  }
  const normalized = normalizePostLockReadStateError(error, readBudget), reason = normalized.details?.reason
  return Object.hasOwn(budgetReasons, reason) ? postLockEvidenceListError(budgetReasons[reason]) : normalized
}
const requireSelectedScope = (frame, query) => {
  if (String(frame.runtime.customerId) !== query.customerId || String(frame.runtime.tenantId) !== query.tenantId) {
    throw createRuntimeInstanceError({ status: 403, code: 'BOUNDED_SCOPE_REQUIRED',
      reason: 'RUNTIME_INSTANCE_BOUNDED_SCOPE_REQUIRED', message: 'The list requires one matching selected customer and tenant scope.' })
  }
}
const verifyAuditIdentity = (audit, pair, frame) => {
  requireReceipt(audit && String(audit._id) === pair.common.receiptId && audit.action === 'POST_LOCK_EVIDENCE_SUBMITTED'
    && audit.resourceType === 'RuntimeInstance' && String(audit.resourceId) === frame.runtime.id
    && String(audit.actorUserId) === pair.common.submittedBy
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(audit.scope?.[key]) === String(frame.scope[key]))
    && audit.scope?.runtimeInstanceKey === frame.runtime.runtimeInstanceKey)
}

export const listPostLockEvidence = async (args, { readBudget = createPostLockReadBudget() } = {}) => {
  try {
    const query = parsePostLockEvidenceListQuery(args.query), cursor = parsePostLockEvidenceListCursor(query.cursor)
    readBudget.check()
    const result = await withPostLockEvidenceTransaction(async session => {
      readBudget.check()
      const frame = await readVerifiedPostLockLockedContext(args, session, { readBudget })
      requireSelectedScope(frame, query)
      const basis = buildPostLockEvidenceListBasis(frame)
      readBudget.check()
      if (cursor && cursor.basisHash !== basis.basisHash) throw postLockEvidenceListError('POST_LOCK_EVIDENCE_LIST_CURSOR_STALE')
      const evidence = await readPlan(RuntimeEvidenceObject, buildEvidenceQuery({ frame,
        afterEvidenceObjectId: cursor?.afterEvidenceObjectId, pageSize: query.pageSize }), session, readBudget)
      assertPostLockEvidenceListMaterialSize(evidence, [])
      const selections = evidence.map(row => {
        const match = typeof row.evidenceObjectId === 'string' && /^post-lock:([a-f0-9]{64})$/.exec(row.evidenceObjectId)
        requireReceipt(match && !Object.hasOwn(row, 'postLockOrigin') && row.sourceId === `post-lock-source:${match[1]}`)
        return { row, submissionId: match[1], sourceId: `post-lock-source:${match[1]}` }
      })
      requireReceipt(new Set(selections.map(item => item.submissionId)).size === selections.length)
      if (!selections.length) {
        readBudget.check()
        return projectPostLockEvidenceList({ frame, receipts: [], pageSize: query.pageSize })
      }
      const sources = await readPlan(RuntimeEvidenceSource, buildSourceQuery({ frame,
        sourceIds: selections.map(item => item.sourceId) }), session, readBudget)
      assertPostLockEvidenceListMaterialSize(evidence, sources)
      requireReceipt(sources.length === selections.length && new Set(sources.map(row => row.sourceId)).size === selections.length)
      const pairs = selections.map(item => {
        const source = sources.find(row => row.sourceId === item.sourceId)
        requireReceipt(source && !Object.hasOwn(source, 'postLockOrigin'))
        const pair = parsePostLockOriginalPair({ evidence: item.row, source, submissionId: item.submissionId })
        assertPostLockOriginalPairBinding({ pair, runtime: frame.runtime, pointer: frame.pointer })
        return { pair, submissionId: item.submissionId }
      })
      const receiptIds = pairs.map(item => item.pair.common.receiptId)
      requireReceipt(new Set(receiptIds).size === receiptIds.length)
      const audits = await readPlan(AuditLog, buildAuditQuery({ receiptIds }), session, readBudget)
      readBudget.accountAuditRows(audits)
      requireReceipt(audits.length === pairs.length)
      const receipts = pairs.map(item => {
        readBudget.check()
        const audit = audits.find(row => String(row._id) === item.pair.common.receiptId)
        verifyAuditIdentity(audit, item.pair, frame)
        return verifyPostLockOriginalReceipt({ ...item, audit: AuditLog.hydrate(audit) })
      })
      readBudget.check()
      return projectPostLockEvidenceList({ frame, receipts, pageSize: query.pageSize })
    }, { timeoutMS: readBudget.remainingMS() })
    readBudget.check()
    return result
  } catch (error) { throw normalizePostLockEvidenceListError(error, readBudget) }
}

export const __testables = Object.freeze({ buildEvidenceQuery, buildSourceQuery, buildAuditQuery })
