import { resolveRuntimeStateVersion } from './runtimeStateVersionService.js'
import { observeSs014SynchronousAdapter } from './ss014SynchronousAdapterObservation.js'
import { createSs014NativeCommandMonitor } from './ss014NativeCommandMonitor.js'
import { prepareSs014NativeReadPlanInputV2 } from './ss014NativeReadResultBoundaryV2.js'

const MAX_RUN_DURATION_MS = 15000
const RAW_ROW_CAP = 65536
const ROOT_TOTAL_CAP = 65536
const CHILD_TOTAL_CAP = 131072
const ROOT_LIMIT = 2
const CHILD_LIMIT = 1001
const USABLE_CHILD_CAP = 1000
const BATCH_SIZE = 100
const MAX_TIME_MS = 2000

const ERROR_CODES = Object.freeze({
  REDACTION_FAILED: 'SS014_DRY_RUN_REDACTION_FAILED',
  SCOPE_INVALID: 'SS014_DRY_RUN_SCOPE_INVALID',
  PRODUCTION_BLOCKED: 'SS014_DRY_RUN_PRODUCTION_BLOCKED',
  AUTO_CREATE_GUARD_UNAVAILABLE: 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE',
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
  COLLECTION_READ_UNAVAILABLE: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
  SIZE_CAP_EXCEEDED: 'SS014_DRY_RUN_SIZE_CAP_EXCEEDED',
  TIMEOUT: 'SS014_DRY_RUN_TIMEOUT',
  FULL_STATE_BLOCKED: 'SS014_DRY_RUN_FULL_STATE_BLOCKED',
  UNKNOWN_COMMAND: 'SS014_DRY_RUN_UNKNOWN_COMMAND',
  WRITE_COMMAND_OBSERVED: 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
  STATE_VERSION_MIXED: 'SS014_DRY_RUN_STATE_VERSION_MIXED',
})

const INTERNAL_CODES = Object.freeze({
  NAMESPACE_NOT_FOUND: 'SS014_INTERNAL_NAMESPACE_NOT_FOUND',
})

const COLLECTIONS = Object.freeze([
  Object.freeze({ logical: 'SECTIONS', physical: 'runtime_section_states' }),
  Object.freeze({ logical: 'EVIDENCE_SOURCES', physical: 'runtime_evidence_sources' }),
  Object.freeze({ logical: 'EVIDENCE_OBJECTS', physical: 'runtime_evidence_objects' }),
  Object.freeze({ logical: 'GRAPH_SNAPSHOTS', physical: 'runtime_graph_snapshots' }),
  Object.freeze({ logical: 'GRAPH_ELEMENTS', physical: 'runtime_graph_elements' }),
])

const INPUT_KEYS = [
  'scope',
  'primitives',
  'objectIdAdapter',
  'environmentGuard',
  'autoCreateGuard',
  'autoIndexGuard',
  'clientFactory',
  'clock',
  'bsonSizer',
]
const PRIMITIVE_KEYS = [
  'databaseName',
  'buildRootFilter',
  'buildChildFilter',
  'rootQuery',
  'collectionPresenceQuery',
  'childQuery',
  'createDeadline',
  'makeIncompleteResult',
]
const OBJECT_ID_KEYS = ['isValidLowerHexId', 'fromLowerHexId', 'isOpaqueObjectId', 'toLowerHexId']
const ENVIRONMENT_KEYS = ['read']
const GUARD_KEYS = ['read', 'setFalse', 'restore']
const CLOCK_KEYS = ['now']
const MONITOR_KEYS = ['onCommandStarted', 'onCommandFailed', 'getSnapshot']
const COMMAND_CLASS_KEYS = ['setup', 'read', 'teardown']
const ROOT_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceKey: 1,
  customerId: 1,
  tenantId: 1,
  workspaceId: 1,
  runtimeType: 1,
  frameworkKey: 1,
  packageId: 1,
  packageKey: 1,
  packageVersion: 1,
  dependencyLockId: 1,
  activationId: 1,
  deploymentId: 1,
  'evidence.dependencySnapshotId': 1,
  'evidence.dependencySnapshotHash': 1,
  status: 1,
  executionStatus: 1,
  runtimeMode: 1,
  name: 1,
  description: 1,
  lockedAt: 1,
  lockedBy: 1,
  lockedReason: 1,
  'revision.revisionNumber': 1,
  stateVersion: 1,
  runtimeStateVersion: 1,
  createdAt: 1,
  updatedAt: 1,
})
const CHILD_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceId: 1,
  customerId: 1,
  tenantId: 1,
})

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const isThenable = (value) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    return typeof value.then === 'function'
  } catch {
    return true
  }
}

const observeThenable = (value) => {
  try {
    Promise.resolve(value).then(() => undefined, () => undefined)
  } catch {
    // The operation is already fail-closed and no driver detail escapes.
  }
}

const isSafeNonNegativeInteger = (value) => (
  Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
)

const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    return Object.getOwnPropertyNames(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
        && !descriptor.get && !descriptor.set)
    })
  } catch {
    return false
  }
}

const hasExactDataKeys = (value, expectedKeys) => {
  if (!isPlainRecord(value)) return false
  try {
    const actual = Object.getOwnPropertyNames(value)
    return actual.length === expectedKeys.length
      && expectedKeys.every((key) => actual.includes(key))
  } catch {
    return false
  }
}

const hasExactFrozenArray = (value, expectedValues) => {
  if (!Array.isArray(value) || !Object.isFrozen(value) || value.length !== expectedValues.length) return false
  try {
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedValues.length + 1 || !ownKeys.includes('length')) return false
    return expectedValues.every((expected, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
        && !descriptor.get && !descriptor.set && descriptor.value === expected)
    })
  } catch {
    return false
  }
}

const isCallableDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
      && !descriptor.get && !descriptor.set && typeof descriptor.value === 'function')
  } catch {
    return false
  }
}

const getCallable = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && descriptor.enumerable === true
      && !descriptor.get && !descriptor.set && typeof descriptor.value === 'function'
      ? descriptor.value
      : null
  } catch {
    return null
  }
}

const callSync = (callback, args = []) => {
  try {
    const value = callback(...args)
    if (isThenable(value)) {
      observeThenable(value)
      return { ok: false, value: undefined }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, value: undefined }
  }
}

const safeRead = (value, key) => {
  try {
    return { ok: true, value: value[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

const safeDataValue = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && descriptor.enumerable === true
      && !descriptor.get && !descriptor.set
      ? { ok: true, value: descriptor.value }
      : { ok: false, value: undefined }
  } catch {
    return { ok: false, value: undefined }
  }
}

const isNamespaceNotFoundError = (error) => {
  const code = safeDataValue(error, 'code')
  const codeName = safeDataValue(error, 'codeName')
  return (code.ok && code.value === 26)
    || (codeName.ok && codeName.value === 'NamespaceNotFound')
}

const validateExactCallableObject = (value, keys) => (
  hasExactDataKeys(value, keys) && keys.every((key) => isCallableDataProperty(value, key))
)

const validateInput = (input) => (
  hasExactDataKeys(input, INPUT_KEYS) && typeof input.clientFactory === 'function'
)

const validateScope = (scope) => {
  if (!isPlainRecord(scope)) return false
  const hasRuntimeId = Object.prototype.hasOwnProperty.call(scope, 'runtimeId')
  const hasRuntimeKey = Object.prototype.hasOwnProperty.call(scope, 'runtimeKey')
  if (hasRuntimeId === hasRuntimeKey) return false
  const expected = ['schemaVersion', 'environmentClass', 'customerId', 'tenantId', hasRuntimeId ? 'runtimeId' : 'runtimeKey']
  if (!hasExactDataKeys(scope, expected)
    || scope.schemaVersion !== 'ss014-scope-v1'
    || scope.environmentClass !== 'DEVELOPMENT_TEST'
    || typeof scope.customerId !== 'string'
    || !/^[0-9a-f]{24}$/.test(scope.customerId)
    || typeof scope.tenantId !== 'string'
    || !/^[0-9a-f]{24}$/.test(scope.tenantId)) return false
  return hasRuntimeId
    ? typeof scope.runtimeId === 'string' && /^[0-9a-f]{24}$/.test(scope.runtimeId)
    : typeof scope.runtimeKey === 'string' && /^[a-z][a-z0-9-]{2,159}$/.test(scope.runtimeKey)
}

const validateEnvironment = (guard) => {
  if (!validateExactCallableObject(guard, ENVIRONMENT_KEYS)) return { ok: false, code: ERROR_CODES.PRODUCTION_BLOCKED }
  const result = callSync(() => guard.read())
  if (!result.ok || !hasExactDataKeys(result.value, ['environmentClass', 'isProduction', 'isAppProduction'])
    || result.value.environmentClass !== 'DEVELOPMENT_TEST'
    || result.value.isProduction !== false
    || result.value.isAppProduction !== false) {
    return { ok: false, code: ERROR_CODES.PRODUCTION_BLOCKED }
  }
  return { ok: true }
}

const createDeadline = (clock) => {
  if (!validateExactCallableObject(clock, CLOCK_KEYS)) return null
  const started = callSync(() => clock.now())
  if (!started.ok || !isSafeNonNegativeInteger(started.value)
    || started.value > Number.MAX_SAFE_INTEGER - MAX_RUN_DURATION_MS) return null

  let previous = started.value
  const expiresAt = started.value + MAX_RUN_DURATION_MS
  const readNow = () => {
    const current = callSync(() => clock.now())
    if (!current.ok || !isSafeNonNegativeInteger(current.value)
      || current.value < previous || current.value >= expiresAt) return null
    previous = current.value
    return current.value
  }

  return Object.freeze({
    check: () => readNow() !== null,
    remaining: () => {
      const current = readNow()
      return current === null ? null : expiresAt - current
    },
  })
}

const runBounded = async (operation, deadline, {
  forceStart = false,
  allowNamespaceNotFound = false,
} = {}) => {
  if (!forceStart && !deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT }

  let operationResult
  try {
    operationResult = operation()
  } catch {
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }
  if (!isThenable(operationResult)) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }

  const remaining = deadline.remaining()
  if (remaining === null) {
    observeThenable(operationResult)
    return { ok: false, code: ERROR_CODES.TIMEOUT }
  }

  let timerId
  try {
    const observed = Promise.resolve(operationResult).then(
      (value) => ({ kind: 'settled', ok: true, value }),
      (error) => ({ kind: 'settled', ok: false, error }),
    )
    const timeout = new Promise((resolve) => {
      timerId = setTimeout(() => resolve({ kind: 'timeout', ok: false }), remaining)
    })
    const result = await Promise.race([observed, timeout])
    try { clearTimeout(timerId) } catch { return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE } }
    if (result.kind === 'timeout') return { ok: false, code: ERROR_CODES.TIMEOUT }
    if (!result.ok) {
      if (allowNamespaceNotFound && isNamespaceNotFoundError(result.error)) {
        return { ok: false, code: INTERNAL_CODES.NAMESPACE_NOT_FOUND }
      }
      return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
    }
    if (!deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT }
    return { ok: true, value: result.value }
  } catch {
    try { clearTimeout(timerId) } catch { /* the operation is already fail-closed */ }
    observeThenable(operationResult)
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }
}

const readListenerCount = (client, eventName) => {
  const method = safeRead(client, 'listenerCount')
  if (!method.ok || typeof method.value !== 'function') return { ok: false }
  const result = callSync(() => method.value.call(client, eventName))
  return result.ok && isSafeNonNegativeInteger(result.value)
    ? { ok: true, value: result.value }
    : { ok: false }
}

const isSafeRow = (row) => isPlainRecord(row)

const measureRow = (row, bsonSizer) => {
  if (!isSafeRow(row)) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  if (Object.prototype.hasOwnProperty.call(row, 'framework_state')) {
    return { ok: false, code: ERROR_CODES.FULL_STATE_BLOCKED }
  }
  const result = callSync(() => bsonSizer(row))
  if (!result.ok || !isSafeNonNegativeInteger(result.value)) {
    return { ok: false, code: ERROR_CODES.SIZE_CAP_EXCEEDED }
  }
  return { ok: true, value: result.value }
}

const validateQueryOptions = (options, limit, expectedKeys = ['limit', 'batchSize', 'maxTimeMS']) => (
  Object.isFrozen(options)
    && hasExactDataKeys(options, expectedKeys)
    && options.limit === limit
    && options.batchSize === BATCH_SIZE
    && options.maxTimeMS === MAX_TIME_MS
)

const validateProjection = (projection) => (
  Object.isFrozen(projection)
    && isPlainRecord(projection) && !Object.prototype.hasOwnProperty.call(projection, 'framework_state')
)

const hasExactProjection = (projection, expected) => (
  validateProjection(projection)
    && hasExactDataKeys(projection, Object.keys(expected))
    && Object.keys(expected).every((key) => projection[key] === expected[key])
)

const validateRootQuery = (query, scope, objectIdAdapter) => (
  Object.isFrozen(query)
    && hasExactDataKeys(query, ['collection', 'filter', 'projection', 'options'])
    && query.collection === 'runtime_instances'
    && Object.isFrozen(query.filter)
    && isPlainRecord(query.filter)
    && hasExactDataKeys(query.filter, scope.runtimeId
      ? ['_id', 'customerId', 'tenantId']
      : ['runtimeInstanceKey', 'customerId', 'tenantId'])
    && canonicalId(objectIdAdapter, query.filter.customerId) === scope.customerId
    && canonicalId(objectIdAdapter, query.filter.tenantId) === scope.tenantId
    && (scope.runtimeId
      ? canonicalId(objectIdAdapter, query.filter._id) === scope.runtimeId
      : query.filter.runtimeInstanceKey === scope.runtimeKey)
    && hasExactProjection(query.projection, ROOT_PROJECTION)
    && validateQueryOptions(query.options, ROOT_LIMIT)
)

const validateCollectionPresenceQuery = (query, expectedPhysical) => (
  Object.isFrozen(query)
    && hasExactDataKeys(query, ['collection', 'options'])
    && query.collection === expectedPhysical
    && Object.isFrozen(query.options)
    && hasExactDataKeys(query.options, ['maxTimeMS'])
    && query.options.maxTimeMS === MAX_TIME_MS
)

const validateCollStatsResponse = (response) => {
  if (!isPlainRecord(response)) return false
  const ok = safeDataValue(response, 'ok')
  return ok.ok && ok.value === 1
}

const validateChildQuery = (query, expectedPhysical, rootId, scope, objectIdAdapter) => (
  Object.isFrozen(query)
    && hasExactDataKeys(query, ['collection', 'filter', 'projection', 'options'])
    && query.collection === expectedPhysical
    && Object.isFrozen(query.filter)
    && isPlainRecord(query.filter)
    && hasExactDataKeys(query.filter, ['runtimeInstanceId', 'customerId', 'tenantId'])
    && canonicalId(objectIdAdapter, query.filter.runtimeInstanceId) === rootId
    && canonicalId(objectIdAdapter, query.filter.customerId) === scope.customerId
    && canonicalId(objectIdAdapter, query.filter.tenantId) === scope.tenantId
    && hasExactProjection(query.projection, CHILD_PROJECTION)
    && validateQueryOptions(query.options, CHILD_LIMIT)
)

const configureCursor = (cursor, options, requireLimit = true) => {
  const requiredMethods = [
    ...(requireLimit ? ['limit'] : []),
    'batchSize',
    'maxTimeMS',
    'hasNext',
    'next',
    'close',
  ]
  if (cursor === null || (typeof cursor !== 'object' && typeof cursor !== 'function')
    || requiredMethods.some((methodName) => typeof cursor[methodName] !== 'function')) return { ok: false }

  const configuration = [
    ['batchSize', options.batchSize],
    ['maxTimeMS', options.maxTimeMS],
  ]
  if (requireLimit) configuration.unshift(['limit', options.limit])

  for (const [methodName, value] of configuration) {
    const result = callSync(() => cursor[methodName](value))
    if (!result.ok || result.value !== cursor) return { ok: false }
  }
  return { ok: true }
}

const consumeCursor = async ({ cursor, limit, cap, totalCap, bsonSizer, deadline, validateRow }) => {
  const rows = []
  let totalBytes = 0
  let failure = null
  try {
    while (true) {
      const hasNext = await runBounded(() => cursor.hasNext(), deadline)
      if (!hasNext.ok) {
        failure = hasNext.code
        break
      }
      if (typeof hasNext.value !== 'boolean') {
        failure = ERROR_CODES.COLLECTION_READ_UNAVAILABLE
        break
      }
      if (!hasNext.value) break
      if (rows.length >= limit) {
        failure = ERROR_CODES.COLLECTION_READ_UNAVAILABLE
        break
      }

      const next = await runBounded(() => cursor.next(), deadline)
      if (!next.ok) {
        failure = next.code
        break
      }
      const measured = measureRow(next.value, bsonSizer)
      if (!measured.ok) {
        failure = measured.code
        break
      }
      if (measured.value > RAW_ROW_CAP || totalBytes > totalCap - measured.value) {
        failure = ERROR_CODES.SIZE_CAP_EXCEEDED
        break
      }
      totalBytes += measured.value
      if (validateRow && !validateRow(next.value)) {
        failure = ERROR_CODES.COLLECTION_READ_UNAVAILABLE
        break
      }
      rows.push(next.value)
      if (rows.length > cap) {
        failure = ERROR_CODES.COLLECTION_READ_UNAVAILABLE
        break
      }
    }
  } finally {
    const closed = await runBounded(() => cursor.close(), deadline, { forceStart: true })
    if (!closed.ok) failure = closed.code
  }
  return failure ? { ok: false, code: failure } : { ok: true, rows }
}

const canonicalId = (adapter, value) => {
  const opaque = callSync(() => adapter.isOpaqueObjectId(value))
  if (!opaque.ok || opaque.value !== true) return null
  const canonical = callSync(() => adapter.toLowerHexId(value))
  return canonical.ok && typeof canonical.value === 'string' && /^[0-9a-f]{24}$/.test(canonical.value)
    ? canonical.value
    : null
}

const readDatabase = (client) => {
  const method = safeRead(client, 'db')
  if (!method.ok || typeof method.value !== 'function') return { ok: false }
  const result = callSync(() => method.value.call(client, 'test'))
  return result.ok && result.value !== null && typeof result.value === 'object' && !isThenable(result.value)
    ? { ok: true, value: result.value }
    : { ok: false }
}

const safeSnapshot = (monitor) => {
  const result = callSync(() => monitor.getSnapshot())
  if (!result.ok || !hasExactDataKeys(result.value, ['commandEventCount', 'commandClasses', 'failureCode'])
    || !hasExactDataKeys(result.value.commandClasses, COMMAND_CLASS_KEYS)
    || !isSafeNonNegativeInteger(result.value.commandEventCount)
    || COMMAND_CLASS_KEYS.some((key) => !isSafeNonNegativeInteger(result.value.commandClasses[key]))) {
    return null
  }
  return result.value
}

const runSs014NativeReadSessionRunnerV2 = async (input) => {
  if (!validateInput(input)) return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (!validateScope(input.scope)) return incomplete(ERROR_CODES.SCOPE_INVALID)
  if (!hasExactDataKeys(input.primitives, PRIMITIVE_KEYS)
    || input.primitives.databaseName !== 'test'
    || PRIMITIVE_KEYS.filter((key) => key !== 'databaseName')
      .some((key) => !isCallableDataProperty(input.primitives, key))) {
    return incomplete(ERROR_CODES.REDACTION_FAILED)
  }
  if (!validateExactCallableObject(input.objectIdAdapter, OBJECT_ID_KEYS)
    || typeof input.bsonSizer !== 'function') return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (!validateExactCallableObject(input.autoCreateGuard, GUARD_KEYS)
    || !validateExactCallableObject(input.autoIndexGuard, GUARD_KEYS)) {
    return incomplete(ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
  }

  const environment = validateEnvironment(input.environmentGuard)
  if (!environment.ok) return incomplete(environment.code)
  const deadline = createDeadline(input.clock)
  if (!deadline || !deadline.check()) return incomplete(ERROR_CODES.TIMEOUT)

  let client = null
  let database = null
  let monitor = null
  let primaryFailure = null
  let timeoutFailure = false
  let teardownFailure = false
  let guardFailure = false
  let autoCreatePrevious
  let autoIndexPrevious
  let autoCreateCaptured = false
  let autoIndexCaptured = false
  let listenerRemoveMethod = null
  const listeners = []
  const originalListenerCounts = new Map()

  const setFailure = (code) => {
    if (code === ERROR_CODES.TIMEOUT) timeoutFailure = true
    else if (!primaryFailure) primaryFailure = code
  }

  const monitorFailure = () => {
    const snapshot = monitor ? safeSnapshot(monitor) : null
    return snapshot ? snapshot.failureCode : ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE
  }

  const guardedSync = (callback, code) => {
    if (!deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT }
    const result = callSync(callback)
    if (!deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT }
    return result.ok ? { ok: true, value: result.value } : { ok: false, code }
  }

  const cleanupSync = (callback) => {
    const before = deadline.check()
    const result = callSync(callback)
    const after = deadline.check()
    if (!before || !after) timeoutFailure = true
    return result
  }

  const captureAndDisable = (guard, label) => {
    const read = guardedSync(() => guard.read(), ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
    if (!read.ok || typeof read.value !== 'boolean') return { ok: false, code: read.code || ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE }
    if (label === 'autoCreate') {
      autoCreatePrevious = read.value
      autoCreateCaptured = true
    } else {
      autoIndexPrevious = read.value
      autoIndexCaptured = true
    }
    const setFalse = guardedSync(() => guard.setFalse(), ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
    if (!setFalse.ok || setFalse.value !== undefined) return { ok: false, code: setFalse.code || ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE }
    const verify = guardedSync(() => guard.read(), ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
    if (!verify.ok || verify.value !== false) return { ok: false, code: verify.code || ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE }
    return { ok: true }
  }

  const restoreGuard = (guard, previous, captured) => {
    if (!captured) return
    const restored = cleanupSync(() => guard.restore(previous))
    if (!restored.ok || restored.value !== undefined) guardFailure = true
  }

  try {
    const autoCreate = captureAndDisable(input.autoCreateGuard, 'autoCreate')
    if (!autoCreate.ok) setFailure(autoCreate.code)
    if (!primaryFailure && !timeoutFailure) {
      const autoIndex = captureAndDisable(input.autoIndexGuard, 'autoIndex')
      if (!autoIndex.ok) setFailure(autoIndex.code)
    }

    if (!primaryFailure && !timeoutFailure) {
      const factory = guardedSync(() => input.clientFactory({ monitorCommands: true }), ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
      if (!factory.ok) setFailure(factory.code)
      else {
        client = factory.value
        const options = safeRead(client, 'options')
        const hasClose = safeRead(client, 'close')
        const hasConnect = safeRead(client, 'connect')
        const hasOn = safeRead(client, 'on')
        const hasListenerCount = safeRead(client, 'listenerCount')
        const hasDb = safeRead(client, 'db')
        const hasOff = safeRead(client, 'off')
        const hasRemoveListener = safeRead(client, 'removeListener')
        if (client === null || (typeof client !== 'object' && typeof client !== 'function')
          || isThenable(client)
          || !options.ok || !options.value || options.value.monitorCommands !== true
          || !hasClose.ok || typeof hasClose.value !== 'function'
          || !hasConnect.ok || typeof hasConnect.value !== 'function'
          || !hasOn.ok || typeof hasOn.value !== 'function'
          || !hasListenerCount.ok || typeof hasListenerCount.value !== 'function'
          || !hasDb.ok || typeof hasDb.value !== 'function'
          || ((!hasOff.ok || typeof hasOff.value !== 'function') && (!hasRemoveListener.ok || typeof hasRemoveListener.value !== 'function'))) {
          setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
        } else {
          listenerRemoveMethod = hasOff.ok && typeof hasOff.value === 'function' ? 'off' : 'removeListener'
          monitor = createSs014NativeCommandMonitor()
          if (!validateExactCallableObject(monitor, MONITOR_KEYS)) setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
          else {
            for (const [eventName, handler] of [
              ['commandStarted', monitor.onCommandStarted],
              ['commandFailed', monitor.onCommandFailed],
            ]) {
              const before = readListenerCount(client, eventName)
              if (!before.ok) { setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE); break }
              originalListenerCounts.set(eventName, before.value)
              listeners.push([eventName, handler])
              const attached = callSync(() => client.on(eventName, handler))
              if (!attached.ok || (attached.value !== undefined && attached.value !== client)) {
                setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
                break
              }
              const after = readListenerCount(client, eventName)
              if (!after.ok || after.value !== before.value + 1) {
                setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
                break
              }
            }

            if (!primaryFailure && !timeoutFailure && listeners.length === 2) {
              const connected = await runBounded(() => client.connect(), deadline)
              if (!connected.ok) setFailure(connected.code)
              else {
                const failureCode = monitorFailure()
                if (failureCode) setFailure(failureCode)
              }
            }

            if (!primaryFailure && !timeoutFailure && listeners.length === 2) {
              const dbResult = readDatabase(client)
              if (!dbResult.ok) setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
              else database = dbResult.value
            }

            if (!primaryFailure && !timeoutFailure && database) {
              const rootQueryResult = guardedSync(() => input.primitives.rootQuery(), ERROR_CODES.REDACTION_FAILED)
              if (!rootQueryResult.ok || !validateRootQuery(rootQueryResult.value, input.scope, input.objectIdAdapter)) setFailure(rootQueryResult.code || ERROR_CODES.REDACTION_FAILED)
              else {
                const rootCollection = callSync(() => database.collection(rootQueryResult.value.collection))
                const rootCursor = rootCollection.ok && rootCollection.value && !isThenable(rootCollection.value)
                  ? callSync(() => rootCollection.value.find(rootQueryResult.value.filter, { projection: rootQueryResult.value.projection }))
                  : { ok: false }
                if (!rootCursor.ok || !configureCursor(rootCursor.value, rootQueryResult.value.options).ok) {
                  setFailure(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                } else {
                  const rootRead = await consumeCursor({
                    cursor: rootCursor.value,
                    limit: ROOT_LIMIT,
                    cap: 1,
                    totalCap: ROOT_TOTAL_CAP,
                    bsonSizer: input.bsonSizer,
                    deadline,
                  })
                  if (!rootRead.ok) setFailure(rootRead.code)
                  else if (rootRead.rows.length !== 1) setFailure(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                  else {
                    const rootMonitorFailure = monitorFailure()
                    if (rootMonitorFailure) setFailure(rootMonitorFailure)
                    const root = rootRead.rows[0]
                    const rootId = canonicalId(input.objectIdAdapter, root._id)
                    const customerId = canonicalId(input.objectIdAdapter, root.customerId)
                    const tenantId = canonicalId(input.objectIdAdapter, root.tenantId)
                    const expectedRuntimeId = input.scope.runtimeId || null
                    const rootIdentityOk = rootId
                      && customerId === input.scope.customerId
                      && tenantId === input.scope.tenantId
                      && (expectedRuntimeId ? rootId === expectedRuntimeId : root.runtimeInstanceKey === input.scope.runtimeKey)
                    if (!rootIdentityOk) setFailure(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                    else {
                      const versionView = {
                        stateVersion: root.stateVersion,
                        runtimeStateVersion: root.runtimeStateVersion,
                      }
                      const version = resolveRuntimeStateVersion(versionView)
                      if (version.errorCode === 'RUNTIME_STATE_VERSION_MIXED') setFailure(ERROR_CODES.STATE_VERSION_MIXED)
                      if (!primaryFailure && !timeoutFailure) {
                        const v2Collections = []
                        for (const entry of COLLECTIONS) {
                          const presenceQueryResult = guardedSync(
                            () => input.primitives.collectionPresenceQuery(entry.logical),
                            ERROR_CODES.REDACTION_FAILED,
                          )
                          if (!presenceQueryResult.ok
                            || !validateCollectionPresenceQuery(presenceQueryResult.value, entry.physical)) {
                            setFailure(presenceQueryResult.code || ERROR_CODES.REDACTION_FAILED)
                            break
                          }

                          const presenceCommand = {
                            collStats: presenceQueryResult.value.collection,
                            maxTimeMS: presenceQueryResult.value.options.maxTimeMS,
                          }
                          const presenceRead = await runBounded(
                            () => database.command(presenceCommand),
                            deadline,
                            { allowNamespaceNotFound: true },
                          )
                          if (!presenceRead.ok && presenceRead.code === INTERNAL_CODES.NAMESPACE_NOT_FOUND) {
                            v2Collections.push({
                              bounded: true,
                              countStatus: 'NOT_RUN_ABSENT',
                              name: entry.logical,
                              presence: 'ABSENT',
                              scopedCount: 0,
                            })
                            continue
                          }
                          if (!presenceRead.ok) {
                            setFailure(presenceRead.code === ERROR_CODES.TIMEOUT
                              || presenceRead.code === ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE
                              ? presenceRead.code
                              : ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                            break
                          }
                          if (!validateCollStatsResponse(presenceRead.value)) {
                            setFailure(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                            break
                          }
                          const presenceMonitorFailure = monitorFailure()
                          if (presenceMonitorFailure) {
                            setFailure(presenceMonitorFailure)
                            break
                          }

                                const childQueryResult = guardedSync(() => input.primitives.childQuery(entry.logical, root._id), ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                                if (!childQueryResult.ok || !validateChildQuery(childQueryResult.value, entry.physical, rootId, input.scope, input.objectIdAdapter)) {
                                  setFailure(childQueryResult.code || ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                                  break
                                }
                                const collection = callSync(() => database.collection(childQueryResult.value.collection))
                                const cursor = collection.ok && collection.value && !isThenable(collection.value)
                                  ? callSync(() => collection.value.find(childQueryResult.value.filter, { projection: childQueryResult.value.projection }))
                                  : { ok: false }
                                if (!cursor.ok || !configureCursor(cursor.value, childQueryResult.value.options).ok) {
                                  setFailure(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)
                                  break
                                }
                                const childRead = await consumeCursor({
                                  cursor: cursor.value,
                                  limit: CHILD_LIMIT,
                                  cap: USABLE_CHILD_CAP,
                                  totalCap: CHILD_TOTAL_CAP,
                                  bsonSizer: input.bsonSizer,
                                  deadline,
                                  validateRow: (row) => {
                                    const childRuntime = canonicalId(input.objectIdAdapter, row.runtimeInstanceId)
                                    const childCustomer = canonicalId(input.objectIdAdapter, row.customerId)
                                    const childTenant = canonicalId(input.objectIdAdapter, row.tenantId)
                                    return childRuntime === rootId
                                      && childCustomer === input.scope.customerId
                                      && childTenant === input.scope.tenantId
                                  },
                                })
                                const childMonitorFailure = monitorFailure()
                                if (childMonitorFailure) {
                                  setFailure(childMonitorFailure)
                                  break
                                }
                                if (!childRead.ok) {
                                  setFailure(childRead.code)
                                  break
                                }
                                v2Collections.push({
                                  bounded: true,
                                  countStatus: 'EXACT',
                                  name: entry.logical,
                                  presence: 'PRESENT',
                                  scopedCount: childRead.rows.length,
                                })
                        }

                        if (!primaryFailure && !timeoutFailure) {
                          const prepared = prepareSs014NativeReadPlanInputV2({
                            scope: input.scope,
                            selector: input.scope.runtimeId ? 'ID' : 'KEY',
                            stateVersionResolver: resolveRuntimeStateVersion,
                            versionView,
                            v2Collections,
                            execution: {
                              monitorInstalledBeforeConnect: true,
                              monitorRemoved: true,
                              commandEventCount: 0,
                              commandClasses: { setup: 0, read: 0, teardown: 0 },
                              cleanDisconnect: true,
                            },
                          })
                          if (prepared.status !== 'READY') setFailure(prepared.errorCode)
                          else primaryFailure = { prepared, versionView }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  catch {
    setFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }

  if (client) {
    const close = safeRead(client, 'close')
    if (!close.ok || typeof close.value !== 'function') teardownFailure = true
    else {
      const closed = await runBounded(() => close.value.call(client), deadline, { forceStart: true })
      if (!closed.ok) teardownFailure = true
    }
    for (const [eventName, handler] of [...listeners].reverse()) {
      const remove = safeRead(client, listenerRemoveMethod)
      const removed = remove.ok && typeof remove.value === 'function'
        ? cleanupSync(() => remove.value.call(client, eventName, handler))
        : { ok: false }
      if (!removed.ok || (removed.value !== undefined && removed.value !== client)) teardownFailure = true
    }
    for (const [eventName] of listeners) {
      const expected = originalListenerCounts.get(eventName)
      const actual = readListenerCount(client, eventName)
      if (!actual.ok || actual.value !== expected) teardownFailure = true
    }
  }

  restoreGuard(input.autoIndexGuard, autoIndexPrevious, autoIndexCaptured)
  restoreGuard(input.autoCreateGuard, autoCreatePrevious, autoCreateCaptured)

  const snapshot = monitor ? safeSnapshot(monitor) : null
  if (!snapshot) teardownFailure = true
  if (guardFailure || primaryFailure === ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE) {
    return incomplete(ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
  }
  if (timeoutFailure) return incomplete(ERROR_CODES.TIMEOUT)
  if (teardownFailure) return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  if (snapshot?.failureCode) return incomplete(snapshot.failureCode)
  if (primaryFailure && typeof primaryFailure === 'string') return incomplete(primaryFailure)
  if (!primaryFailure || typeof primaryFailure !== 'object') return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)

  const execution = {
    monitorInstalledBeforeConnect: true,
    monitorRemoved: true,
    commandEventCount: snapshot.commandEventCount,
    commandClasses: {
      setup: snapshot.commandClasses.setup,
      read: snapshot.commandClasses.read,
      teardown: snapshot.commandClasses.teardown,
    },
    cleanDisconnect: true,
  }
  const prepared = prepareSs014NativeReadPlanInputV2({
    scope: input.scope,
    selector: input.scope.runtimeId ? 'ID' : 'KEY',
    stateVersionResolver: resolveRuntimeStateVersion,
    versionView: primaryFailure.versionView,
    v2Collections: primaryFailure.prepared.planInput.observation.v2Collections,
    execution,
  })
  if (prepared.status !== 'READY') return incomplete(prepared.errorCode)
  return Object.freeze({
    status: 'READY',
    sessionBinding: 'ONE_CLIENT_ONE_DATABASE',
    planInput: prepared.planInput,
  })
}

export { runSs014NativeReadSessionRunnerV2 }
