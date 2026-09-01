import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { RUNTIME_STATE_VERSION_PATTERN, SHA256_PATTERN } from '../models/runtimeStateSchemas.js'

const COLLECTION_SPECS = Object.freeze([
  Object.freeze({
    key: 'sections', collection: 'runtime_section_states', countKey: 'sectionCount',
    identityKey: 'sectionKey', model: RuntimeStateSection,
  }),
  Object.freeze({
    key: 'evidenceSources', collection: 'runtime_evidence_sources', countKey: 'sourceCount',
    identityKey: 'sourceId', model: RuntimeEvidenceSource,
  }),
  Object.freeze({
    key: 'evidenceObjects', collection: 'runtime_evidence_objects', countKey: 'evidenceObjectCount',
    identityKey: 'evidenceObjectId', model: RuntimeEvidenceObject,
  }),
  Object.freeze({
    key: 'graphSnapshots', collection: 'runtime_graph_snapshots', countKey: 'graphSnapshotCount',
    identityKey: 'snapshotId', model: RuntimeGraphSnapshot,
  }),
  Object.freeze({
    key: 'graphElements', collection: 'runtime_graph_elements', countKey: 'graphElementCount',
    identityKey: 'elementKey', model: RuntimeGraphElement,
  }),
])

const MAX_COLLECTION_ROWS = 10_000
const APPROVED_WRITER_ID = 'ss014-v2-currentness-promotion-service'
const WRITER_CONTEXT_TOKEN = Symbol('ss014-v2-currentness-promotion-writer')

export const SS014_CURRENTNESS_CONTRACT = Object.freeze({
  contractVersion: 'ss014-currentness-transition-v1',
  operation: 'PROMOTE_EXACT_V2_STATE_CURRENT',
  adoptionStatus: 'ADOPTED_BY_PRODUCT_OWNER',
  adoptionRef: 'docs/generated/harness-runs/ss-014/2026-08-27-currentness-transition-adoption-v1/adoption-decision.md',
  approvedWriter: APPROVED_WRITER_ID,
  environmentClass: 'DEVELOPMENT_TEST',
  databaseName: 'test',
})

export const SS014_CURRENTNESS_ERROR_CODES = Object.freeze({
  INPUT: 'SS014_CURRENTNESS_INPUT_INVALID',
  AUTHORIZATION: 'SS014_CURRENTNESS_AUTHORIZATION_INVALID',
  PRECONDITION: 'SS014_CURRENTNESS_PRECONDITION_FAILED',
  RECONCILIATION: 'SS014_CURRENTNESS_RECONCILIATION_FAILED',
  TRANSACTION: 'SS014_CURRENTNESS_TRANSACTION_FAILED',
  AUDIT: 'SS014_CURRENTNESS_AUDIT_FAILED',
  COMMIT_AMBIGUOUS: 'SS014_CURRENTNESS_COMMIT_AMBIGUOUS',
  ROLLBACK_AMBIGUOUS: 'SS014_CURRENTNESS_ROLLBACK_AMBIGUOUS',
  CLEANUP_FAILED: 'SS014_CURRENTNESS_CLEANUP_FAILED',
})

const fail = (code, message = code, details) => {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  throw error
}

const normalizeText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const normalizeKey = (value) => (typeof value === 'string' ? value.trim() : '')
const normalizeIdentity = (value) => {
  if (value && typeof value.toHexString === 'function') return value.toHexString().toLowerCase()
  return normalizeText(value?.toString?.() ?? value)
}
const sameIdentity = (left, right) => normalizeIdentity(left) === normalizeIdentity(right)
const databaseIdentity = (value) => (
  typeof value === 'string' && mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(value)
    : value
)

const stableSerialize = (value) => {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
}

const sha256Json = (value) => `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`
const isSha256 = (value) => typeof value === 'string' && SHA256_PATTERN.test(value)
const isStateVersion = (value) => typeof value === 'string' && RUNTIME_STATE_VERSION_PATTERN.test(value)
const isSafeCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COLLECTION_ROWS

const expectedCounts = (rowSet) => ({
  sectionCount: rowSet?.counts?.sectionCount,
  sourceCount: rowSet?.counts?.sourceCount,
  evidenceObjectCount: rowSet?.counts?.evidenceObjectCount,
  graphSnapshotCount: rowSet?.counts?.graphSnapshotCount,
  graphElementCount: Number(rowSet?.counts?.graphNodeCount) + Number(rowSet?.counts?.graphEdgeCount),
})

const expectedSourceHash = (key, sourceHashes) => (
  key === 'sections' ? sourceHashes.sections
    : key === 'evidenceSources' || key === 'evidenceObjects' ? sourceHashes.evidencePack
      : sourceHashes.intelligenceGraph
)

const scopeFilter = (scope) => ({
  runtimeInstanceId: databaseIdentity(scope.runtimeInstanceId),
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: databaseIdentity(scope.customerId),
  tenantId: databaseIdentity(scope.tenantId),
})

const targetFilter = ({ scope, stateVersion, migrationReceiptId, graphSnapshot = false }) => ({
  ...scopeFilter(scope),
  stateVersion,
  migrationReceiptId: databaseIdentity(migrationReceiptId),
  current: false,
  ...(graphSnapshot ? { stateStatus: 'STALE' } : {}),
})

const rowIdentitySet = (rows, identityKey) => {
  if (!Array.isArray(rows)) fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  const identities = rows.map((row) => normalizeKey(row?.[identityKey]))
  if (identities.some((identity) => !identity) || new Set(identities).size !== identities.length) {
    fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }
  return new Set(identities)
}

const assertScopeRow = ({ row, scope, migrationReceiptId, sourceHash, identityKey, current }) => {
  if (!row || typeof row !== 'object'
    || !sameIdentity(row.runtimeInstanceId, scope.runtimeInstanceId)
    || normalizeText(row.runtimeInstanceKey) !== normalizeText(scope.runtimeInstanceKey)
    || !sameIdentity(row.customerId, scope.customerId)
    || !sameIdentity(row.tenantId, scope.tenantId)
    || row.stateVersion !== scope.stateVersion
    || row.sourceStateVersion !== scope.stateVersion
    || !sameIdentity(row.migrationReceiptId, migrationReceiptId)
    || row.sourceHash !== sourceHash
    || row.current !== current
    || !normalizeKey(row[identityKey])) {
    fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }
}

export const assertSs014CurrentnessRowSet = ({ rowSet, scope, migrationReceiptId, sourceHashes }) => {
  if (!rowSet || rowSet.schemaVersion !== 'ss014-v2-row-set-v1'
    || !rowSet.rows || !scope || !isStateVersion(scope.stateVersion)
    || rowSet.stateVersion !== scope.stateVersion) {
    fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  }

  const counts = expectedCounts(rowSet)
  if (COLLECTION_SPECS.some((spec) => !isSafeCount(counts[spec.countKey])
    || !Array.isArray(rowSet.rows[spec.key])
    || rowSet.rows[spec.key].length !== counts[spec.countKey])) {
    fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  }
  if (!sourceHashes || !isSha256(sourceHashes.sections)
    || !isSha256(sourceHashes.evidencePack) || !isSha256(sourceHashes.intelligenceGraph)) {
    fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  }

  for (const spec of COLLECTION_SPECS) {
    const identitySet = rowIdentitySet(rowSet.rows[spec.key], spec.identityKey)
    const sourceHash = expectedSourceHash(spec.key, sourceHashes)
    for (const row of rowSet.rows[spec.key]) {
      assertScopeRow({
        row, scope, migrationReceiptId, sourceHash, identityKey: spec.identityKey, current: false,
      })
    }
    if (identitySet.size !== counts[spec.countKey]) fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }

  const graphSnapshots = rowSet.rows.graphSnapshots
  if (graphSnapshots.some((row) => row.stateStatus !== 'STALE')) {
    fail(SS014_CURRENTNESS_ERROR_CODES.PRECONDITION)
  }
  const snapshotId = graphSnapshots.length === 1 ? normalizeText(graphSnapshots[0].snapshotId) : ''
  if (rowSet.rows.graphElements.some((row) => normalizeText(row.snapshotId) !== snapshotId)) {
    fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }
  return counts
}

const assertPlanFields = (plan) => {
  const planScope = plan?.scope
  if (!plan || typeof plan !== 'object'
    || !planScope || typeof planScope !== 'object'
    || JSON.stringify(plan.contract) !== JSON.stringify(SS014_CURRENTNESS_CONTRACT)
    || planScope.runtimeInstanceId !== normalizeIdentity(planScope.runtimeInstanceId)
    || planScope.customerId !== normalizeIdentity(planScope.customerId)
    || planScope.tenantId !== normalizeIdentity(planScope.tenantId)
    || planScope.runtimeInstanceKey !== normalizeText(planScope.runtimeInstanceKey)
    || !isStateVersion(planScope.stateVersion)
    || plan.targetStateVersion !== planScope.stateVersion
    || !isSha256(plan.scopeDigest)
    || !isSha256(plan.sourceSetHash)
    || !isSha256(plan.backupRestoreEvidenceRef)
    || !isSha256(plan.baselineReceiptBackupManifestRef)
    || !isSha256(plan.confirmationTokenDigest)
    || !isSha256(plan.planHash)
    || !normalizeIdentity(plan.migrationReceiptId)) {
    fail(SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
  }

  const unsigned = { ...plan }
  delete unsigned.planHash
  if (sha256Json(unsigned) !== plan.planHash) fail(SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
  return plan
}

export const buildSs014CurrentnessTransitionPlan = ({
  rowSet, scope, migrationReceiptId, sourceHashes, scopeDigest, sourceSetHash,
  backupRestoreEvidenceRef, baselineReceiptBackupManifestRef, confirmationTokenDigest,
}) => {
  const counts = assertSs014CurrentnessRowSet({ rowSet, scope, migrationReceiptId, sourceHashes })
  const normalizedScope = {
    runtimeInstanceId: normalizeIdentity(scope.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(scope.runtimeInstanceKey),
    customerId: normalizeIdentity(scope.customerId),
    tenantId: normalizeIdentity(scope.tenantId),
    stateVersion: scope.stateVersion,
  }
  if (!isSha256(scopeDigest) || !isSha256(sourceSetHash)
    || !isSha256(backupRestoreEvidenceRef)
    || !isSha256(baselineReceiptBackupManifestRef)
    || !isSha256(confirmationTokenDigest)
    || rowSet.sourceSetHash !== sourceSetHash) {
    fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  }
  const unsigned = {
    contract: SS014_CURRENTNESS_CONTRACT,
    scope: normalizedScope,
    targetStateVersion: normalizedScope.stateVersion,
    migrationReceiptId: normalizeIdentity(migrationReceiptId),
    scopeDigest,
    sourceSetHash,
    sourceHashes,
    counts,
    backupRestoreEvidenceRef,
    baselineReceiptBackupManifestRef,
    confirmationTokenDigest,
  }
  return Object.freeze({ ...unsigned, planHash: sha256Json(unsigned) })
}

export const createSs014CurrentnessWriterContext = () => Object.freeze({
  writerId: APPROVED_WRITER_ID,
  token: WRITER_CONTEXT_TOKEN,
})

const assertWriterContext = (writerContext) => {
  if (writerContext?.writerId !== APPROVED_WRITER_ID || writerContext.token !== WRITER_CONTEXT_TOKEN) {
    fail(SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
  }
}

const executeFindOne = async (Model, filter, projection, session) => {
  const query = Model.findOne(filter, projection)
  if (query && typeof query.session === 'function') query.session(session)
  if (query && typeof query.lean === 'function') return query.lean()
  return query
}

const assertRootAndReceipt = async ({ models, plan, session }) => {
  const root = await executeFindOne(models.RuntimeInstance, {
    _id: plan.scope.runtimeInstanceId,
    runtimeInstanceKey: plan.scope.runtimeInstanceKey,
    customerId: databaseIdentity(plan.scope.customerId),
    tenantId: databaseIdentity(plan.scope.tenantId),
    stateVersion: plan.targetStateVersion,
  }, {
    _id: 1, runtimeInstanceId: 1, runtimeInstanceKey: 1, customerId: 1, tenantId: 1,
    stateVersion: 1, runtimeStateVersion: 1,
  }, session)
  if (!root || !sameIdentity(root._id, plan.scope.runtimeInstanceId)
    || (root.runtimeInstanceId && !sameIdentity(root.runtimeInstanceId, plan.scope.runtimeInstanceId))
    || normalizeText(root.runtimeInstanceKey) !== plan.scope.runtimeInstanceKey
    || !sameIdentity(root.customerId, plan.scope.customerId)
    || !sameIdentity(root.tenantId, plan.scope.tenantId)
    || root.stateVersion !== plan.targetStateVersion
    || (root.runtimeStateVersion && root.runtimeStateVersion !== plan.targetStateVersion)) {
    fail(SS014_CURRENTNESS_ERROR_CODES.PRECONDITION)
  }

  const receipt = await executeFindOne(models.RuntimeStateMigrationReceipt, {
    receiptId: plan.migrationReceiptId,
    runtimeInstanceId: plan.scope.runtimeInstanceId,
    runtimeInstanceKey: plan.scope.runtimeInstanceKey,
    customerId: plan.scope.customerId,
    tenantId: plan.scope.tenantId,
    status: 'VERIFIED',
    assignedStateVersion: plan.targetStateVersion,
    scopeDigest: plan.scopeDigest,
    sourceSetHash: plan.sourceSetHash,
    'authority.tokenDigest': plan.confirmationTokenDigest,
    backupManifestRef: plan.baselineReceiptBackupManifestRef,
  }, {
    _id: 1, receiptId: 1, runtimeInstanceId: 1, runtimeInstanceKey: 1, customerId: 1, tenantId: 1,
    status: 1, assignedStateVersion: 1, scopeDigest: 1, sourceSetHash: 1,
    targetSelectionRef: 1, environmentClass: 1, databaseName: 1,
    authority: 1, backupManifestRef: 1,
  }, session)
  if (!receipt || !sameIdentity(receipt.receiptId, plan.migrationReceiptId)
    || !sameIdentity(receipt.runtimeInstanceId, plan.scope.runtimeInstanceId)
    || normalizeText(receipt.runtimeInstanceKey) !== plan.scope.runtimeInstanceKey
    || !sameIdentity(receipt.customerId, plan.scope.customerId)
    || !sameIdentity(receipt.tenantId, plan.scope.tenantId)
    || receipt.status !== 'VERIFIED'
    || receipt.assignedStateVersion !== plan.targetStateVersion
    || receipt.scopeDigest !== plan.scopeDigest
    || receipt.sourceSetHash !== plan.sourceSetHash
    || receipt.authority?.tokenDigest !== plan.confirmationTokenDigest
    || receipt.backupManifestRef !== plan.baselineReceiptBackupManifestRef
    || receipt.environmentClass !== SS014_CURRENTNESS_CONTRACT.environmentClass
    || receipt.databaseName !== SS014_CURRENTNESS_CONTRACT.databaseName
    || receipt.targetSelectionRef?.scopeDigest !== plan.scopeDigest) {
    fail(SS014_CURRENTNESS_ERROR_CODES.PRECONDITION)
  }
}

const readScopedRows = async ({ database, spec, scope, expectedCount, session, maxTimeMS }) => {
  const limit = expectedCount + 1
  const projection = {
    _id: 1, runtimeInstanceId: 1, runtimeInstanceKey: 1, customerId: 1, tenantId: 1,
    stateVersion: 1, sourceStateVersion: 1, migrationReceiptId: 1, sourceHash: 1,
    current: 1, stateStatus: 1, [spec.identityKey]: 1,
    ...(spec.key === 'graphSnapshots' ? { snapshotId: 1 } : {}),
    ...(spec.key === 'graphElements' ? { snapshotId: 1, elementType: 1 } : {}),
  }
  return database.collection(spec.collection).find(scopeFilter(scope), {
    projection, limit, batchSize: limit, maxTimeMS, session,
  }).toArray()
}

const assertObservedRows = ({ rows, expectedRows, spec, scope, migrationReceiptId, sourceHashes, expectedCurrent }) => {
  if (!Array.isArray(rows) || rows.length !== expectedRows.length) {
    fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }
  const expectedIds = rowIdentitySet(expectedRows, spec.identityKey)
  const observedIds = rowIdentitySet(rows, spec.identityKey)
  if (expectedIds.size !== observedIds.size || [...expectedIds].some((id) => !observedIds.has(id))) {
    fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
  }
  const sourceHash = expectedSourceHash(spec.key, sourceHashes)
  for (const row of rows) {
    assertScopeRow({ row, scope, migrationReceiptId, sourceHash, identityKey: spec.identityKey, current: expectedCurrent })
    if (spec.key === 'graphSnapshots') {
      const expectedStatus = expectedCurrent ? 'CURRENT' : 'STALE'
      if (row.stateStatus !== expectedStatus) fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
    }
    if (spec.key === 'graphElements') {
      const expectedByIdentity = new Map(expectedRows.map((expectedRow) => [
        normalizeKey(expectedRow[spec.identityKey]), expectedRow,
      ]))
      const expected = expectedByIdentity.get(normalizeKey(row[spec.identityKey]))
      if (!expected || row.elementType !== expected.elementType || row.snapshotId !== expected.snapshotId) {
        fail(SS014_CURRENTNESS_ERROR_CODES.RECONCILIATION)
      }
    }
  }
  return rows
}

const readAndAssertAllRows = async ({ database, plan, rowSet, session, maxTimeMS, expectedCurrent }) => {
  const result = {}
  for (const spec of COLLECTION_SPECS) {
    const rows = await readScopedRows({
      database, spec, scope: plan.scope, expectedCount: plan.counts[spec.countKey], session, maxTimeMS,
    })
    result[spec.key] = assertObservedRows({
      rows,
      expectedRows: rowSet.rows[spec.key],
      spec,
      scope: plan.scope,
      migrationReceiptId: plan.migrationReceiptId,
      sourceHashes: plan.sourceHashes,
      expectedCurrent,
    })
  }
  return result
}

const assertMutationResult = ({ result, expectedCount }) => {
  if (!result || result.acknowledged !== true
    || result.matchedCount !== expectedCount || result.modifiedCount !== expectedCount) {
    fail(SS014_CURRENTNESS_ERROR_CODES.TRANSACTION)
  }
}

const createCommitAmbiguousError = (cause, details = {}) => {
  const error = new Error(SS014_CURRENTNESS_ERROR_CODES.COMMIT_AMBIGUOUS)
  error.code = SS014_CURRENTNESS_ERROR_CODES.COMMIT_AMBIGUOUS
  error.commitAmbiguous = true
  error.cause = cause
  Object.assign(error, details)
  return error
}

const isAmbiguousCommitError = (error) => (
  error?.commitAmbiguous === true
  || error?.errorLabels?.includes?.('UnknownTransactionCommitResult')
  || error?.codeName === 'UnknownTransactionCommitResult'
  || error?.code === 50
  || /timeout|timed out|network|socket|topology/i.test(String(error?.message || ''))
)

export const promoteRuntimeStateCurrentnessTransaction = async ({
  client,
  database,
  rowSet,
  plan,
  writerContext,
  auditWrite,
  models = { RuntimeInstance, RuntimeStateMigrationReceipt },
  maxTimeMS = 15_000,
}) => {
  assertWriterContext(writerContext)
  assertPlanFields(plan)
  const rowSetCounts = assertSs014CurrentnessRowSet({
    rowSet,
    scope: plan.scope,
    migrationReceiptId: plan.migrationReceiptId,
    sourceHashes: plan.sourceHashes,
  })
  if (stableSerialize(rowSetCounts) !== stableSerialize(plan.counts)) {
    fail(SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
  }
  if (!client || typeof client.startSession !== 'function' || !database?.collection
    || typeof auditWrite !== 'function') {
    fail(SS014_CURRENTNESS_ERROR_CODES.INPUT)
  }

  const session = client.startSession()
  let transactionStarted = false
  let commitStarted = false
  let committed = false
  let primaryError = null
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true },
      readPreference: 'primary',
    })
    transactionStarted = true

    await assertRootAndReceipt({ models, plan, session })
    await readAndAssertAllRows({ database, plan, rowSet, session, maxTimeMS, expectedCurrent: false })

    for (const spec of COLLECTION_SPECS) {
      const update = { $set: { current: true } }
      if (spec.key === 'graphSnapshots') update.$set.stateStatus = 'CURRENT'
      const result = await database.collection(spec.collection).updateMany(
        targetFilter({
          scope: plan.scope,
          stateVersion: plan.targetStateVersion,
          migrationReceiptId: plan.migrationReceiptId,
          graphSnapshot: spec.key === 'graphSnapshots',
        }),
        update,
        { session },
      )
      assertMutationResult({ result, expectedCount: plan.counts[spec.countKey] })
    }

    await readAndAssertAllRows({ database, plan, rowSet, session, maxTimeMS, expectedCurrent: true })
    const auditResult = await auditWrite({
      session,
      operation: SS014_CURRENTNESS_CONTRACT.operation,
      plan,
      counts: plan.counts,
    })
    if (auditResult !== true && auditResult?.acknowledged !== true) {
      fail(SS014_CURRENTNESS_ERROR_CODES.AUDIT)
    }

    commitStarted = true
    try {
      await session.commitTransaction()
      committed = true
    } catch (error) {
      if (isAmbiguousCommitError(error)) throw createCommitAmbiguousError(error)
      fail(SS014_CURRENTNESS_ERROR_CODES.TRANSACTION, SS014_CURRENTNESS_ERROR_CODES.TRANSACTION, { cause: error })
    }
    return {
      status: 'COMMITTED',
      operation: SS014_CURRENTNESS_CONTRACT.operation,
      planHash: plan.planHash,
      counts: plan.counts,
    }
  } catch (error) {
    primaryError = error
    if (transactionStarted && !committed && !(commitStarted && error?.commitAmbiguous)) {
      try {
        if (typeof session.inTransaction !== 'function' || session.inTransaction()) {
          await session.abortTransaction()
        }
      } catch (rollbackError) {
        error.code = SS014_CURRENTNESS_ERROR_CODES.ROLLBACK_AMBIGUOUS
        error.rollbackError = rollbackError
      }
    }
    throw error
  } finally {
    try {
      await session.endSession()
    } catch (cleanupError) {
      if (!primaryError && committed) {
        throw createCommitAmbiguousError(cleanupError, { committed: true, cleanupFailed: true })
      }
      if (primaryError) primaryError.cleanupError = cleanupError
      else throw Object.assign(cleanupError, { code: SS014_CURRENTNESS_ERROR_CODES.CLEANUP_FAILED })
    }
  }
}

export const getSs014CurrentnessCollectionSpecs = () => COLLECTION_SPECS
