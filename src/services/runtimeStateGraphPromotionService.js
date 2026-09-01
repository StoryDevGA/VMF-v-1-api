import mongoose from 'mongoose'

import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import auditService, { AUDIT_ACTIONS, RESOURCE_TYPES } from './auditService.js'

export const RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES = Object.freeze({
  INVALID: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_INVALID',
  SOURCE_OBSOLETE: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_SOURCE_OBSOLETE',
  CURRENT_GRAPH_INVALID: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_CURRENT_GRAPH_INVALID',
  DUPLICATE_CONFLICT: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_DUPLICATE_CONFLICT',
  CONCURRENT_CONFLICT: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_CONCURRENT_CONFLICT',
  TRANSACTION_FAILED: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_TRANSACTION_FAILED',
  AUDIT_FAILED: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_AUDIT_FAILED',
  COMMIT_AMBIGUOUS: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_COMMIT_AMBIGUOUS',
  ROLLBACK_AMBIGUOUS: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_ROLLBACK_AMBIGUOUS',
  CLEANUP_FAILED: 'RUNTIME_STATE_V2_GRAPH_PROMOTION_CLEANUP_FAILED',
})

export const MAX_TRANSACTION_ATTEMPTS = 2

const CANDIDATE_KEYS = Object.freeze([
  'schemaVersion', 'sourceHash', 'stateVersion', 'snapshot', 'nodes', 'edges', 'counts',
])
const CANDIDATE_COUNT_KEYS = Object.freeze(['nodeCount', 'edgeCount', 'elementCount'])
const SNAPSHOT_FIELDS = Object.freeze([
  'runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId',
  'stateVersion', 'sourceStateVersion', 'sourceHash', 'migrationReceiptId',
  'current', 'snapshotId', 'graphVersion', 'graphHash', 'stateStatus', 'counts',
  'metadata',
])
const ELEMENT_FIELDS = Object.freeze([
  'runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId',
  'stateVersion', 'sourceStateVersion', 'sourceHash', 'migrationReceiptId',
  'current', 'snapshotId', 'graphVersion', 'elementType', 'elementKey',
  'fromElementKey', 'toElementKey', 'relationshipType', 'label', 'summary',
  'attributes',
])

const createError = (code, message = code, details, cause) => {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  if (cause !== undefined) error.cause = cause
  return error
}

const fail = (code, message, details, cause) => {
  throw createError(code, message, details, cause)
}

const isPlainRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))

const normalizeIdentity = (value) => {
  if (value && typeof value.toHexString === 'function') return value.toHexString().toLowerCase()
  return String(value ?? '').trim().toLowerCase()
}

const databaseIdentity = (value) => (
  typeof value === 'string' && mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(value)
    : value
)

const normalizeValue = (value) => {
  if (value === undefined) return null
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value.toHexString === 'function') return value.toHexString().toLowerCase()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]))
  }
  return String(value)
}

const project = (row, fields) => Object.fromEntries(fields.map((field) => [field, normalizeValue(row?.[field])]))
const stable = (value) => JSON.stringify(normalizeValue(value))
const equivalentSnapshot = (left, right) => stable(project(left, SNAPSHOT_FIELDS)) === stable(project(right, SNAPSHOT_FIELDS))
const elementProjection = (row) => project(row, ELEMENT_FIELDS)
const sortedElements = (rows) => rows.map(elementProjection).sort((left, right) => (
  `${left.elementType}\u0000${left.elementKey}`.localeCompare(`${right.elementType}\u0000${right.elementKey}`)
))
const equivalentElements = (left, right) => stable(sortedElements(left)) === stable(sortedElements(right))

const exactKeys = (value, expected) => isPlainRecord(value)
  && Object.keys(value).length === expected.length
  && Object.keys(value).every((key) => expected.includes(key))

const validateModelRow = (Model, row, message) => {
  try {
    const error = new Model(row).validateSync()
    if (error) {
      const validationPaths = Object.keys(error.errors || {}).sort()
      fail(
        RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID,
        `${message} (${validationPaths.join(', ')})`,
        { validationPaths },
      )
    }
  } catch (error) {
    if (error?.code === RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID) throw error
    fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID, message, undefined, error)
  }
}

const scopeFromSnapshot = (snapshot) => ({
  runtimeInstanceId: normalizeIdentity(snapshot.runtimeInstanceId),
  runtimeInstanceKey: String(snapshot.runtimeInstanceKey || '').trim().toLowerCase(),
  customerId: normalizeIdentity(snapshot.customerId),
  tenantId: normalizeIdentity(snapshot.tenantId),
})

const scopeFilter = (scope) => ({
  runtimeInstanceId: databaseIdentity(scope.runtimeInstanceId),
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: databaseIdentity(scope.customerId),
  tenantId: databaseIdentity(scope.tenantId),
})

const rootFilter = (scope) => ({
  _id: databaseIdentity(scope.runtimeInstanceId),
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: databaseIdentity(scope.customerId),
  tenantId: databaseIdentity(scope.tenantId),
})

const sameScope = (row, scope) => normalizeIdentity(row?.runtimeInstanceId) === scope.runtimeInstanceId
  && String(row?.runtimeInstanceKey || '').trim().toLowerCase() === scope.runtimeInstanceKey
  && normalizeIdentity(row?.customerId) === scope.customerId
  && normalizeIdentity(row?.tenantId) === scope.tenantId

const validateCandidate = ({ candidate, actorUserId, models }) => {
  if (!exactKeys(candidate, CANDIDATE_KEYS)
    || candidate.schemaVersion !== 'runtime-state-v2-graph-candidate-v1'
    || !/^[0-9a-f]{24}$/.test(String(actorUserId || ''))
    || !mongoose.isValidObjectId(actorUserId)
    || !isPlainRecord(candidate.snapshot)
    || !Array.isArray(candidate.nodes)
    || !Array.isArray(candidate.edges)
    || !exactKeys(candidate.counts, CANDIDATE_COUNT_KEYS)) {
    fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID)
  }

  const elements = [...candidate.nodes, ...candidate.edges]
  const snapshot = candidate.snapshot
  const scope = scopeFromSnapshot(snapshot)
  if (!scope.runtimeInstanceId || !scope.runtimeInstanceKey || !scope.customerId || !scope.tenantId
    || candidate.stateVersion !== snapshot.stateVersion
    || snapshot.stateVersion !== snapshot.sourceStateVersion
    || candidate.sourceHash !== snapshot.sourceHash
    || snapshot.current !== false
    || snapshot.stateStatus !== 'REBUILDING'
    || candidate.counts.nodeCount !== candidate.nodes.length
    || candidate.counts.edgeCount !== candidate.edges.length
    || candidate.counts.elementCount !== elements.length
    || snapshot.counts?.nodeCount !== candidate.nodes.length
    || snapshot.counts?.edgeCount !== candidate.edges.length) {
    fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID)
  }

  validateModelRow(models.RuntimeGraphSnapshot, snapshot, 'Candidate snapshot is invalid.')
  const keys = new Set()
  for (const element of elements) {
    validateModelRow(models.RuntimeGraphElement, element, 'Candidate graph element is invalid.')
    if (!sameScope(element, scope)
      || element.stateVersion !== candidate.stateVersion
      || element.sourceStateVersion !== candidate.stateVersion
      || element.sourceHash !== candidate.sourceHash
      || normalizeIdentity(element.migrationReceiptId) !== normalizeIdentity(snapshot.migrationReceiptId)
      || element.snapshotId !== snapshot.snapshotId
      || element.graphVersion !== snapshot.graphVersion
      || element.current !== false
      || keys.has(element.elementKey)) {
      fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID)
    }
    keys.add(element.elementKey)
  }
  const nodeKeys = new Set(candidate.nodes.map((row) => row.elementKey))
  if (candidate.nodes.some((row) => row.elementType !== 'NODE')
    || candidate.edges.some((row) => row.elementType !== 'EDGE'
      || !nodeKeys.has(row.fromElementKey) || !nodeKeys.has(row.toElementKey))) {
    fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID)
  }
  return { actorUserId: databaseIdentity(actorUserId), elements, scope }
}

const applyQueryOptions = (query, { session, fresh = false } = {}) => {
  let next = query
  if (session && typeof next?.session === 'function') next = next.session(session)
  if (fresh && typeof next?.read === 'function') next = next.read('primary')
  if (fresh && typeof next?.readConcern === 'function') next = next.readConcern('majority')
  if (typeof next?.lean === 'function') next = next.lean()
  return next
}

const findRows = async (Model, filter, options) => applyQueryOptions(Model.find(filter), options)
const findOne = async (Model, filter, options) => applyQueryOptions(Model.findOne(filter), options)

const assertMutationCount = (result, expected, code = RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED) => {
  if (!result || result.acknowledged !== true
    || result.matchedCount !== expected || result.modifiedCount !== expected) fail(code)
}

const promotedSnapshot = (snapshot) => ({ ...snapshot, current: true, stateStatus: 'CURRENT' })
const promotedElements = (elements) => elements.map((row) => ({ ...row, current: true }))

const validateCurrentGraph = ({ snapshots, elements, scope, models }) => {
  if (!Array.isArray(snapshots) || !Array.isArray(elements) || snapshots.length > 1) {
    fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID)
  }
  if (snapshots.length === 0) {
    if (elements.length !== 0) fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID)
    return null
  }

  const snapshot = snapshots[0]
  try {
    validateModelRow(models.RuntimeGraphSnapshot, snapshot, 'Current snapshot is invalid.')
    if (!sameScope(snapshot, scope) || snapshot.current !== true || snapshot.stateStatus !== 'CURRENT'
      || snapshot.stateVersion !== snapshot.sourceStateVersion) {
      fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID)
    }
    const keys = new Set()
    const nodeKeys = new Set()
    for (const element of elements) {
      validateModelRow(models.RuntimeGraphElement, element, 'Current graph element is invalid.')
      if (!sameScope(element, scope) || element.current !== true
        || element.snapshotId !== snapshot.snapshotId
        || element.graphVersion !== snapshot.graphVersion
        || element.stateVersion !== snapshot.stateVersion
        || element.sourceStateVersion !== snapshot.sourceStateVersion
        || element.sourceHash !== snapshot.sourceHash
        || normalizeIdentity(element.migrationReceiptId) !== normalizeIdentity(snapshot.migrationReceiptId)
        || keys.has(element.elementKey)) {
        fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID)
      }
      keys.add(element.elementKey)
      if (element.elementType === 'NODE') nodeKeys.add(element.elementKey)
    }
    if (elements.filter((row) => row.elementType === 'NODE').length !== snapshot.counts?.nodeCount
      || elements.filter((row) => row.elementType === 'EDGE').length !== snapshot.counts?.edgeCount
      || elements.some((row) => row.elementType === 'EDGE'
        && (!nodeKeys.has(row.fromElementKey) || !nodeKeys.has(row.toElementKey)))) {
      fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID)
    }
  } catch (error) {
    if (error?.code === RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID) throw error
    fail(
      RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID,
      undefined,
      error?.details,
      error,
    )
  }
  return snapshot
}

const readCurrentGraph = async ({ models, scope, session, fresh = false }) => {
  const filter = { ...scopeFilter(scope), current: true }
  const options = { session, fresh }
  const snapshots = await findRows(models.RuntimeGraphSnapshot, filter, options)
  const elements = await findRows(models.RuntimeGraphElement, filter, options)
  return { snapshots, elements }
}

const exactCandidateCurrent = ({ candidate, current }) => current.snapshots.length === 1
  && equivalentSnapshot(current.snapshots[0], promotedSnapshot(candidate.snapshot))
  && equivalentElements(current.elements, promotedElements([...candidate.nodes, ...candidate.edges]))

const isLabel = (error, label) => error?.errorLabels?.includes?.(label)
const isDuplicate = (error) => error?.code === 11000 || error?.codeName === 'DuplicateKey'

const cleanup = async ({ session, committed, primaryError }) => {
  try {
    await session.endSession()
  } catch (error) {
    if (primaryError?.code === RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.COMMIT_AMBIGUOUS
      || primaryError?.code === RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.ROLLBACK_AMBIGUOUS) {
      primaryError.details = { ...(primaryError.details || {}), cleanupError: error.message }
      throw primaryError
    }
    throw createError(
      RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CLEANUP_FAILED,
      undefined,
      { committed, primaryError: primaryError?.code || primaryError?.message || null },
      error,
    )
  }
  if (primaryError) throw primaryError
}

const abortAndCleanup = async ({ session, committed = false, primaryError = null }) => {
  let finalError = primaryError
  try {
    await session.abortTransaction()
  } catch (error) {
    finalError = createError(
      RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.ROLLBACK_AMBIGUOUS,
      undefined,
      { primaryError: primaryError?.code || primaryError?.message || null },
      error,
    )
  }
  await cleanup({ session, committed, primaryError: finalError })
}

const reconcileDuplicateWinner = async ({ candidate, models, scope }) => {
  const root = await findOne(models.RuntimeInstance, {
    ...rootFilter(scope),
    stateVersion: candidate.stateVersion,
  }, { fresh: true })
  if (!root) return null
  const current = await readCurrentGraph({ models, scope, fresh: true })
  return exactCandidateCurrent({ candidate, current }) ? root : null
}

const executeAttempt = async ({ candidate, actorUserId, models, audit, mongooseInstance }) => {
  const scope = scopeFromSnapshot(candidate.snapshot)
  const session = await mongooseInstance.startSession()
  let transactionStarted = false
  let commitStarted = false
  let committed = false
  let finalized = false
  let promotedRoot = null
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true },
      readPreference: 'primary',
    })
    transactionStarted = true

    const rootResult = await models.RuntimeInstance.updateOne({
      ...rootFilter(scope),
      stateVersion: candidate.stateVersion,
    }, {
      $currentDate: { updatedAt: true },
      $set: { updatedBy: actorUserId },
    }, { session })
    assertMutationCount(rootResult, 1, RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.SOURCE_OBSOLETE)

    const candidateUniqueFilter = {
      ...scopeFilter(scope),
      graphVersion: candidate.snapshot.graphVersion,
      stateVersion: candidate.stateVersion,
    }
    const candidateRowFilter = {
      ...scopeFilter(scope),
      snapshotId: candidate.snapshot.snapshotId,
      stateVersion: candidate.stateVersion,
    }
    const duplicate = await findOne(models.RuntimeGraphSnapshot, candidateUniqueFilter, { session })
    if (duplicate) {
      const current = await readCurrentGraph({ models, scope, session })
      if (!exactCandidateCurrent({ candidate, current })) {
        fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.DUPLICATE_CONFLICT)
      }
      finalized = true
      await abortAndCleanup({ session })
      const currentRoot = await findOne(models.RuntimeInstance, {
        ...rootFilter(scope),
        stateVersion: candidate.stateVersion,
      }, { fresh: true })
      if (!currentRoot) fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.SOURCE_OBSOLETE)
      return {
        status: 'ALREADY_CURRENT',
        snapshotId: candidate.snapshot.snapshotId,
        updatedAt: currentRoot.updatedAt,
      }
    }

    const previous = await readCurrentGraph({ models, scope, session })
    const previousSnapshot = validateCurrentGraph({ ...previous, scope, models })

    await models.RuntimeGraphSnapshot.create([candidate.snapshot], { session })
    if (candidate.nodes.length + candidate.edges.length > 0) {
      await models.RuntimeGraphElement.insertMany([...candidate.nodes, ...candidate.edges], { session })
    }

    if (previousSnapshot) {
      const previousFilter = {
        ...scopeFilter(scope), current: true,
        snapshotId: previousSnapshot.snapshotId,
        stateVersion: previousSnapshot.stateVersion,
      }
      const demotedElements = await models.RuntimeGraphElement.updateMany(
        previousFilter,
        { $set: { current: false } },
        { session },
      )
      assertMutationCount(demotedElements, previous.elements.length)
      const demotedSnapshot = await models.RuntimeGraphSnapshot.updateOne(
        previousFilter,
        { $set: { current: false, stateStatus: 'STALE' } },
        { session },
      )
      assertMutationCount(demotedSnapshot, 1)
    }

    const promotedSnapshotResult = await models.RuntimeGraphSnapshot.updateOne(
      { ...candidateRowFilter, current: false, stateStatus: 'REBUILDING' },
      { $set: { current: true, stateStatus: 'CURRENT' } },
      { session },
    )
    assertMutationCount(promotedSnapshotResult, 1)
    const promotedElementResult = await models.RuntimeGraphElement.updateMany(
      { ...candidateRowFilter, current: false },
      { $set: { current: true } },
      { session },
    )
    assertMutationCount(promotedElementResult, candidate.counts.elementCount)

    const readback = await readCurrentGraph({ models, scope, session })
    if (!exactCandidateCurrent({ candidate, current: readback })) {
      fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED)
    }
    promotedRoot = await findOne(models.RuntimeInstance, {
      ...rootFilter(scope),
      stateVersion: candidate.stateVersion,
    }, { session })
    if (!promotedRoot) fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.SOURCE_OBSOLETE)

    try {
      await audit.log({
        action: AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
        resourceType: RESOURCE_TYPES.RuntimeInstance,
        resourceId: databaseIdentity(scope.runtimeInstanceId),
        actorUserId,
        scope: {
          customerId: scope.customerId,
          tenantId: scope.tenantId,
          runtimeInstanceId: scope.runtimeInstanceId,
          runtimeInstanceKey: scope.runtimeInstanceKey,
        },
        diff: {
          operation: 'V2_GRAPH_REBUILD_PROMOTED',
          previousSnapshotId: previousSnapshot?.snapshotId || null,
          newSnapshotId: candidate.snapshot.snapshotId,
          sourceStateVersion: candidate.stateVersion,
          graphHash: candidate.snapshot.graphHash,
          counts: candidate.counts,
        },
      }, { session, throwOnError: true })
    } catch (error) {
      fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.AUDIT_FAILED, undefined, undefined, error)
    }

    commitStarted = true
    await session.commitTransaction()
    committed = true
    await cleanup({ session, committed })
    return {
      status: 'PROMOTED',
      previousSnapshotId: previousSnapshot?.snapshotId || null,
      snapshotId: candidate.snapshot.snapshotId,
      stateVersion: candidate.stateVersion,
      updatedAt: promotedRoot.updatedAt,
    }
  } catch (error) {
    if (committed || finalized) throw error
    if (commitStarted && isLabel(error, 'UnknownTransactionCommitResult')) {
      const ambiguous = createError(
        RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.COMMIT_AMBIGUOUS,
        undefined,
        undefined,
        error,
      )
      finalized = true
      await cleanup({ session, committed: false, primaryError: ambiguous })
    }

    let primaryError = error
    if (isDuplicate(primaryError)) {
      // Preserve E11000 for fresh post-abort winner reconciliation.
    } else if (!primaryError?.code || typeof primaryError.code !== 'string') {
      primaryError = createError(
        RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED,
        undefined,
        { transient: isLabel(error, 'TransientTransactionError') },
        error,
      )
    } else if (isLabel(error, 'TransientTransactionError')) {
      primaryError.details = { ...(primaryError.details || {}), transient: true }
    }

    finalized = true
    if (transactionStarted) await abortAndCleanup({ session, primaryError })
    await cleanup({ session, committed: false, primaryError })
  }
}

export const promoteRuntimeStateGraphCandidate = async ({
  candidate,
  actorUserId,
  dependencies = {},
} = {}) => {
  const models = {
    RuntimeInstance: dependencies.RuntimeInstance || RuntimeInstance,
    RuntimeGraphSnapshot: dependencies.RuntimeGraphSnapshot || RuntimeGraphSnapshot,
    RuntimeGraphElement: dependencies.RuntimeGraphElement || RuntimeGraphElement,
  }
  const audit = dependencies.auditService || auditService
  const mongooseInstance = dependencies.mongoose || mongoose
  const validated = validateCandidate({ candidate, actorUserId, models })

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executeAttempt({
        candidate,
        actorUserId: validated.actorUserId,
        models,
        audit,
        mongooseInstance,
      })
    } catch (error) {
      if (isDuplicate(error)) {
        const winnerRoot = await reconcileDuplicateWinner({ candidate, models, scope: validated.scope })
        if (winnerRoot) {
          return {
            status: 'ALREADY_CURRENT',
            snapshotId: candidate.snapshot.snapshotId,
            updatedAt: winnerRoot.updatedAt,
          }
        }
        fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CONCURRENT_CONFLICT, undefined, undefined, error)
      }
      if (error?.details?.transient === true && attempt < MAX_TRANSACTION_ATTEMPTS) continue
      if (error?.details?.transient === true) {
        fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED, undefined, { attempts: attempt }, error)
      }
      throw error
    }
  }
  fail(RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED)
}
