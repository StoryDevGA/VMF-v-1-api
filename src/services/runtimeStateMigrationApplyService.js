import { createHash } from 'node:crypto'

import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'

const COLLECTION_SPECS = Object.freeze([
  Object.freeze({ key: 'sections', collection: 'runtime_section_states', countKey: 'sectionCount' }),
  Object.freeze({ key: 'evidenceSources', collection: 'runtime_evidence_sources', countKey: 'sourceCount' }),
  Object.freeze({ key: 'evidenceObjects', collection: 'runtime_evidence_objects', countKey: 'evidenceObjectCount' }),
  Object.freeze({ key: 'graphSnapshots', collection: 'runtime_graph_snapshots', countKey: 'graphSnapshotCount' }),
  Object.freeze({ key: 'graphElements', collection: 'runtime_graph_elements', countKey: 'graphElementCount' }),
])
const PERSISTENCE_MODELS = Object.freeze({
  sections: RuntimeStateSection,
  evidenceSources: RuntimeEvidenceSource,
  evidenceObjects: RuntimeEvidenceObject,
  graphSnapshots: RuntimeGraphSnapshot,
  graphElements: RuntimeGraphElement,
})
const SHADOW_IDENTITY_KEYS = Object.freeze({
  sections: 'sectionKey',
  evidenceSources: 'sourceId',
  evidenceObjects: 'evidenceObjectId',
  graphSnapshots: 'snapshotId',
  graphElements: 'elementKey',
})
const SHADOW_COLLECTION_ROW_LIMIT = 10_000

export const SS014_V2_APPLY_ERROR_CODES = Object.freeze({
  INPUT: 'SS014_V2_APPLY_INPUT_INVALID',
  COMMAND: 'SS014_V2_APPLY_COMMAND_BOUNDARY_FAILED',
  PRECONDITION: 'SS014_V2_APPLY_PRECONDITION_FAILED',
  TRANSACTION: 'SS014_V2_APPLY_TRANSACTION_FAILED',
  RECONCILIATION: 'SS014_V2_APPLY_RECONCILIATION_FAILED',
  COMMIT_AMBIGUOUS: 'SS014_V2_APPLY_COMMIT_AMBIGUOUS',
  DEADLINE: 'SS014_V2_APPLY_DEADLINE_EXCEEDED',
})

const FORBIDDEN_COMMANDS = new Set([
  'bulkWrite', 'collMod', 'create', 'createIndexes', 'delete', 'drop', 'dropIndexes',
  'findAndModify', 'mapReduce', 'renameCollection', 'replace', 'update',
])
const HOUSEKEEPING_COMMANDS = new Set([
  'authenticate', 'endSessions', 'getnonce', 'hello', 'ismaster', 'killCursors',
  'saslContinue', 'saslStart',
])
const READ_PHASES = new Set([
  'PRECHECK_READ', 'TRANSACTION_PRECHECK', 'TRANSACTION_RECONCILE', 'READBACK',
])

const fail = (code, message = code) => {
  const error = new Error(message)
  error.code = code
  throw error
}
const normalize = (value) => value?.toString?.().toLowerCase() || ''
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const same = (left, right) => stable(left) === stable(right)

export const getRuntimeStateMigrationCollectionSpecs = () => COLLECTION_SPECS

export const getRuntimeStateMigrationExpectedCounts = (rowSet) => ({
  sectionCount: rowSet?.counts?.sectionCount,
  sourceCount: rowSet?.counts?.sourceCount,
  evidenceObjectCount: rowSet?.counts?.evidenceObjectCount,
  graphSnapshotCount: rowSet?.counts?.graphSnapshotCount,
  graphElementCount: Number(rowSet?.counts?.graphNodeCount) + Number(rowSet?.counts?.graphEdgeCount),
})

export const castRuntimeStateMigrationRowSetForNativePersistence = (rowSet) => {
  if (!rowSet || rowSet.schemaVersion !== 'ss014-v2-row-set-v1' || !rowSet.rows) {
    fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  }
  const castRows = {}
  for (const spec of COLLECTION_SPECS) {
    const Model = PERSISTENCE_MODELS[spec.key]
    if (!Array.isArray(rowSet.rows[spec.key]) || !Model) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    castRows[spec.key] = rowSet.rows[spec.key].map((row) => {
      try {
        const document = new Model(row)
        const validationError = document.validateSync()
        if (validationError) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
        return document.toObject({ depopulate: true, flattenObjectIds: false, minimize: false, versionKey: false })
      } catch (error) {
        if (error?.code === SS014_V2_APPLY_ERROR_CODES.INPUT) throw error
        fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
      }
    })
  }
  return {
    schemaVersion: rowSet.schemaVersion,
    algorithm: rowSet.algorithm,
    sourceSetHash: rowSet.sourceSetHash,
    stateVersion: rowSet.stateVersion,
    counts: { ...rowSet.counts },
    rows: castRows,
  }
}

const canonicalShadowValue = (value) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    return value.toISOString()
  }
  if (value && typeof value.toHexString === 'function'
    && /^[0-9a-f]{24}$/.test(value.toHexString())) return value.toHexString()
  if (Array.isArray(value)) return value.map(canonicalShadowValue)
  if (!value || typeof value !== 'object') fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    return [key, canonicalShadowValue(value[key])]
  }))
}

const canonicalShadowRows = ({ rows, identityKey }) => {
  if (!Array.isArray(rows) || rows.length > SHADOW_COLLECTION_ROW_LIMIT) {
    fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  }
  const identities = new Set()
  const normalized = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    const identity = row[identityKey]
    if (typeof identity !== 'string' || identity.length === 0 || identity.length > 240
      || identity !== identity.trim() || identities.has(identity)) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    identities.add(identity)
    const withoutMongoId = Object.fromEntries(Object.entries(row).filter(([key]) => (
      key !== '_id'
      && key !== 'current'
      && !(identityKey === 'snapshotId' && key === 'stateStatus')
    )))
    return { identity, row: canonicalShadowValue(withoutMongoId) }
  })
  normalized.sort((left, right) => (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0))
  return normalized.map(({ row }) => row)
}

const shadowDigest = (rows) => `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`

export const createRuntimeStateMigrationShadowParityReport = ({ expectedRowSet, observedRows }) => {
  if (!expectedRowSet?.rows || !observedRows || typeof observedRows !== 'object' || Array.isArray(observedRows)) {
    fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  }
  const exactCollectionKeys = COLLECTION_SPECS.map(({ key }) => key).sort()
  if (!same(Object.keys(expectedRowSet.rows).sort(), exactCollectionKeys)
    || !same(Object.keys(observedRows).sort(), exactCollectionKeys)) {
    fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  }
  const collections = {}
  let mismatchCount = 0
  for (const spec of COLLECTION_SPECS) {
    const identityKey = SHADOW_IDENTITY_KEYS[spec.key]
    if (!Object.prototype.hasOwnProperty.call(observedRows, spec.key)) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    const expected = canonicalShadowRows({ rows: expectedRowSet.rows[spec.key], identityKey })
    const observed = canonicalShadowRows({ rows: observedRows[spec.key], identityKey })
    const expectedDigest = shadowDigest(expected)
    const observedDigest = shadowDigest(observed)
    const digestMatch = expected.length === observed.length && expectedDigest === observedDigest
    if (!digestMatch) mismatchCount += 1
    collections[spec.key] = {
      expectedCount: expected.length,
      observedCount: observed.length,
      expectedDigest,
      observedDigest,
      digestMatch,
    }
  }
  return {
    schemaVersion: 'ss014-v2-shadow-parity-v1',
    parity: mismatchCount === 0,
    mismatchCount,
    collections,
  }
}

export const assertRuntimeStateMigrationRowSet = ({ rowSet, scope, migrationReceiptId, sourceHashes }) => {
  if (!rowSet || rowSet.schemaVersion !== 'ss014-v2-row-set-v1' || !rowSet.rows) {
    fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
  }
  const counts = getRuntimeStateMigrationExpectedCounts(rowSet)
  for (const spec of COLLECTION_SPECS) {
    const rows = rowSet.rows[spec.key]
    const expectedCount = counts[spec.countKey]
    if (!Array.isArray(rows) || !Number.isSafeInteger(expectedCount) || expectedCount < 0
      || rows.length !== expectedCount) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    for (const row of rows) {
      if (normalize(row.runtimeInstanceId) !== normalize(scope.runtimeInstanceId)
        || normalize(row.customerId) !== normalize(scope.customerId)
        || normalize(row.tenantId) !== normalize(scope.tenantId)
        || String(row.runtimeInstanceKey || '').toLowerCase() !== String(scope.runtimeInstanceKey || '').toLowerCase()
        || row.stateVersion !== scope.stateVersion
        || normalize(row.migrationReceiptId) !== normalize(migrationReceiptId)) {
        fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
      }
      const expectedHash = spec.key === 'sections' ? sourceHashes.sections
        : spec.key === 'evidenceSources' || spec.key === 'evidenceObjects' ? sourceHashes.evidencePack
          : sourceHashes.intelligenceGraph
      if (row.sourceHash !== expectedHash) fail(SS014_V2_APPLY_ERROR_CODES.INPUT)
    }
  }
  return counts
}

export const createRuntimeStateMigrationApplyCommandMonitor = ({ databaseName, rowSet, scope, migrationReceiptId, sourceHashes }) => {
  const counts = assertRuntimeStateMigrationRowSet({ rowSet, scope, migrationReceiptId, sourceHashes })
  const expectedFinds = []
  let findIndex = 0
  let insertIndex = 0
  let phase = 'CONNECT'
  let violation = null
  let terminal = null
  let transactionIdentity = null
  let transactionCommandCount = 0
  const observedInsertCounts = {}
  const mark = () => { violation = SS014_V2_APPLY_ERROR_CODES.COMMAND }
  const commandHasOutputStage = (command) => Array.isArray(command?.pipeline)
    && command.pipeline.some((stage) => stage && (stage.$out !== undefined || stage.$merge !== undefined))

  const normalizeTransactionIdentity = (command) => ({
    lsid: command?.lsid,
    txnNumber: command?.txnNumber?.toString?.() ?? String(command?.txnNumber),
  })
  const validateTransactionEnvelope = (command, { first = false } = {}) => {
    if (!command?.lsid || command.txnNumber === undefined || command.autocommit !== false
      || (first ? command.startTransaction !== true : command.startTransaction === true)) return false
    const observed = normalizeTransactionIdentity(command)
    if (!transactionIdentity) transactionIdentity = observed
    return same(transactionIdentity, observed)
  }
  const transitions = Object.freeze({
    CONNECT: new Set(['CONNECT', 'TRANSACTION_PRECHECK', 'READBACK', 'CLOSE']),
    TRANSACTION_PRECHECK: new Set(['TRANSACTION_PRECHECK', 'TRANSACTION_INSERT', 'COMMIT_OR_ABORT', 'CLOSE']),
    TRANSACTION_INSERT: new Set(['TRANSACTION_INSERT', 'TRANSACTION_RECONCILE', 'COMMIT_OR_ABORT', 'CLOSE']),
    TRANSACTION_RECONCILE: new Set(['TRANSACTION_RECONCILE', 'COMMIT_OR_ABORT', 'CLOSE']),
    COMMIT_OR_ABORT: new Set(['COMMIT_OR_ABORT', 'CLOSE']),
    READBACK: new Set(['READBACK', 'CLOSE']),
    CLOSE: new Set(['CLOSE']),
  })

  return {
    setPhase(next) {
      if (!transitions[phase]?.has(next)) { mark(); return }
      phase = next
    },
    expectFind(specification) { expectedFinds.push({ ...specification, phase }) },
    observe(event = {}) {
      if (violation) return
      const { commandName, databaseName: eventDatabaseName, command = {} } = event
      if (FORBIDDEN_COMMANDS.has(commandName) || (commandName === 'aggregate' && commandHasOutputStage(command))) {
        mark(); return
      }
      if (commandName === 'insert') {
        const spec = COLLECTION_SPECS[insertIndex]
        if (phase !== 'TRANSACTION_INSERT' || eventDatabaseName !== databaseName || !spec
          || command.insert !== spec.collection || command.ordered !== true
          || transactionCommandCount === 0
          || !validateTransactionEnvelope(command, { first: false })
          || !Array.isArray(command.documents)
          || command.documents.length !== counts[spec.countKey]) { mark(); return }
        try {
          assertRuntimeStateMigrationRowSet({
            rowSet: {
              schemaVersion: rowSet.schemaVersion,
              counts: {
                sectionCount: spec.key === 'sections' ? command.documents.length : 0,
                sourceCount: spec.key === 'evidenceSources' ? command.documents.length : 0,
                evidenceObjectCount: spec.key === 'evidenceObjects' ? command.documents.length : 0,
                graphSnapshotCount: spec.key === 'graphSnapshots' ? command.documents.length : 0,
                graphNodeCount: spec.key === 'graphElements' ? command.documents.filter((row) => row.elementType === 'NODE').length : 0,
                graphEdgeCount: spec.key === 'graphElements' ? command.documents.filter((row) => row.elementType === 'EDGE').length : 0,
              },
              rows: Object.fromEntries(COLLECTION_SPECS.map((entry) => [entry.key, entry.key === spec.key ? command.documents : []])),
            },
            scope, migrationReceiptId, sourceHashes,
          })
        } catch { mark(); return }
        observedInsertCounts[spec.collection] = command.documents.length
        insertIndex += 1
        transactionCommandCount += 1
        return
      }
      if (commandName === 'find') {
        const expected = expectedFinds[findIndex]
        findIndex += 1
        if (!READ_PHASES.has(phase) || !expected || expected.phase !== phase
          || eventDatabaseName !== databaseName || command.find !== expected.collection
          || !same(command.filter, expected.filter) || !same(command.projection, expected.projection)
          || command.limit !== expected.limit || command.batchSize !== expected.batchSize
          || command.maxTimeMS !== expected.maxTimeMS) { mark(); return }
        if (phase.startsWith('TRANSACTION_')) {
          if (!validateTransactionEnvelope(command, { first: transactionCommandCount === 0 })) { mark(); return }
          transactionCommandCount += 1
        } else if (command.txnNumber !== undefined || command.autocommit !== undefined
          || command.startTransaction !== undefined) { mark(); return }
        return
      }
      if (commandName === 'commitTransaction' || commandName === 'abortTransaction') {
        const isCommit = commandName === 'commitTransaction'
        if (phase !== 'COMMIT_OR_ABORT' || terminal || eventDatabaseName !== 'admin'
          || (isCommit && (insertIndex !== COLLECTION_SPECS.length || findIndex !== expectedFinds.length))
          || !validateTransactionEnvelope(command, { first: false })) { mark(); return }
        terminal = commandName
        return
      }
      if (commandName === 'ping') {
        if (!['CONNECT', 'READBACK'].includes(phase) || command.ping !== 1) mark()
        return
      }
      if (commandName === 'getMore') { mark(); return }
      if (HOUSEKEEPING_COMMANDS.has(commandName)) {
        const applicationName = Object.values(command)
          .some((value) => typeof value === 'string' && COLLECTION_SPECS.some((spec) => spec.collection === value))
        if (applicationName) { mark(); return }
        const expectedPhase = commandName === 'endSessions' || commandName === 'killCursors' ? 'CLOSE' : 'CONNECT'
        if (phase !== expectedPhase) mark()
        return
      }
      mark()
    },
    get violation() { return violation },
    finalize({ committed }) {
      if (violation || phase !== 'CLOSE' || findIndex !== expectedFinds.length || insertIndex !== COLLECTION_SPECS.length
        || terminal !== (committed ? 'commitTransaction' : 'abortTransaction')) {
        fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
      }
      return { terminal, observedInsertCounts }
    },
    finalizeReadback() {
      if (violation || phase !== 'CLOSE' || findIndex !== expectedFinds.length || insertIndex !== 0 || terminal !== null) {
        fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
      }
      return { readCount: findIndex }
    },
  }
}

const identityBound = async (promise) => promise

const readIds = async ({ database, spec, filter, expectedCount, session, monitor, maxTimeMS, bounded = identityBound }) => {
  const projection = {
    _id: 1, runtimeInstanceId: 1, runtimeInstanceKey: 1, customerId: 1, tenantId: 1,
    stateVersion: 1, migrationReceiptId: 1, sourceHash: 1, elementType: 1,
  }
  const limit = expectedCount + 1
  const batchSize = limit
  monitor.expectFind({ collection: spec.collection, filter, projection, limit, batchSize, maxTimeMS })
  return bounded(database.collection(spec.collection).find(filter, {
    projection, limit, batchSize, maxTimeMS, ...(session ? { session } : {}),
  }).toArray(), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
}

export const applyRuntimeStateMigrationRowSetTransaction = async ({
  client, database, rowSet, filter, scope, migrationReceiptId, sourceHashes,
  monitor, transactionPrecondition, bounded = identityBound, maxTimeMS = 15_000,
}) => {
  const counts = assertRuntimeStateMigrationRowSet({ rowSet, scope, migrationReceiptId, sourceHashes })
  const session = client.startSession()
  let committed = false
  let commitStarted = false
  let primaryError = null
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true },
      readPreference: 'primary',
    })
    monitor.setPhase('TRANSACTION_PRECHECK')
    if (typeof transactionPrecondition !== 'function') fail(SS014_V2_APPLY_ERROR_CODES.PRECONDITION)
    await bounded(transactionPrecondition({ session }), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
    if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
    for (const spec of COLLECTION_SPECS) {
      const rows = await readIds({ database, spec, filter, expectedCount: 0, session, monitor, maxTimeMS, bounded })
      if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
      if (rows.length !== 0) fail(SS014_V2_APPLY_ERROR_CODES.PRECONDITION)
    }
    monitor.setPhase('TRANSACTION_INSERT')
    for (const spec of COLLECTION_SPECS) {
      const result = await bounded(database.collection(spec.collection)
        .insertMany(rowSet.rows[spec.key], { session, ordered: true }), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
      if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
      if (result.acknowledged !== true || result.insertedCount !== counts[spec.countKey]) {
        fail(SS014_V2_APPLY_ERROR_CODES.TRANSACTION)
      }
    }
    monitor.setPhase('TRANSACTION_RECONCILE')
    for (const spec of COLLECTION_SPECS) {
      const rows = await readIds({ database, spec, filter, expectedCount: counts[spec.countKey], session, monitor, maxTimeMS, bounded })
      if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
      if (rows.length !== counts[spec.countKey]) fail(SS014_V2_APPLY_ERROR_CODES.RECONCILIATION)
    }
    monitor.setPhase('COMMIT_OR_ABORT')
    if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
    commitStarted = true
    try {
      await bounded(session.commitTransaction(), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
    } catch (error) {
      if (error?.errorLabels?.includes?.('UnknownTransactionCommitResult')
        || error?.codeName === 'UnknownTransactionCommitResult'
        || error?.code === SS014_V2_APPLY_ERROR_CODES.DEADLINE) {
        const ambiguous = new Error(SS014_V2_APPLY_ERROR_CODES.COMMIT_AMBIGUOUS)
        ambiguous.code = SS014_V2_APPLY_ERROR_CODES.COMMIT_AMBIGUOUS
        ambiguous.commitAmbiguous = true
        throw ambiguous
      }
      throw error
    }
    committed = true
    return { counts }
  } catch (error) {
    primaryError = error
    if (!committed && !(commitStarted && error?.commitAmbiguous)) {
      monitor.setPhase('COMMIT_OR_ABORT')
      try {
        if (session.inTransaction()) await bounded(session.abortTransaction(), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
      } catch { /* retain primary error */ }
    }
    throw error
  } finally {
    try {
      await bounded(session.endSession(), SS014_V2_APPLY_ERROR_CODES.DEADLINE)
    } catch (cleanupError) {
      if (!primaryError) {
        cleanupError.commitSucceeded = committed
        throw cleanupError
      }
    }
  }
}

export const readBackRuntimeStateMigrationRows = async ({
  database, filter, rowSet, scope, migrationReceiptId, sourceHashes, monitor,
  bounded = identityBound, maxTimeMS = 15_000,
}) => {
  const counts = getRuntimeStateMigrationExpectedCounts(rowSet)
  monitor.setPhase('READBACK')
  const result = {}
  for (const spec of COLLECTION_SPECS) {
    const rows = await readIds({ database, spec, filter, expectedCount: counts[spec.countKey], monitor, maxTimeMS, bounded })
    if (monitor.violation) fail(SS014_V2_APPLY_ERROR_CODES.COMMAND)
    if (rows.length !== counts[spec.countKey]) fail(SS014_V2_APPLY_ERROR_CODES.RECONCILIATION)
    const expectedHash = spec.key === 'sections' ? sourceHashes.sections
      : spec.key === 'evidenceSources' || spec.key === 'evidenceObjects' ? sourceHashes.evidencePack
        : sourceHashes.intelligenceGraph
    if (rows.some((row) => normalize(row.runtimeInstanceId) !== normalize(scope.runtimeInstanceId)
      || normalize(row.customerId) !== normalize(scope.customerId)
      || normalize(row.tenantId) !== normalize(scope.tenantId)
      || String(row.runtimeInstanceKey || '').toLowerCase() !== String(scope.runtimeInstanceKey || '').toLowerCase()
      || row.stateVersion !== scope.stateVersion
      || normalize(row.migrationReceiptId) !== normalize(migrationReceiptId)
      || row.sourceHash !== expectedHash)) fail(SS014_V2_APPLY_ERROR_CODES.RECONCILIATION)
    result[spec.collection] = rows
  }
  const elements = result.runtime_graph_elements
  if (elements.filter((row) => row.elementType === 'NODE').length !== rowSet.counts.graphNodeCount
    || elements.filter((row) => row.elementType === 'EDGE').length !== rowSet.counts.graphEdgeCount) {
    fail(SS014_V2_APPLY_ERROR_CODES.RECONCILIATION)
  }
  return result
}
