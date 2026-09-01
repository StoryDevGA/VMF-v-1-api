const DATABASE_NAME = 'test'
const READ_MAX_TIME_MS = 2000
const ROOT_LIMIT = 2
const CHILD_LIMIT = 1001
const BATCH_SIZE = 100

const RUNTIME_KEY_PATTERN = /^[a-z][a-z0-9-]{2,159}$/
const LOWER_HEX_ID_PATTERN = /^[0-9a-f]{24}$/

const FAILURE_CODES = new Set([
  'SS014_DRY_RUN_SCOPE_REQUIRED',
  'SS014_DRY_RUN_SCOPE_INVALID',
  'SS014_DRY_RUN_PRODUCTION_BLOCKED',
  'SS014_DRY_RUN_APPLY_NOT_SUPPORTED',
  'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED',
  'SS014_DRY_RUN_STATE_VERSION_MIXED',
  'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
  'SS014_DRY_RUN_FULL_STATE_BLOCKED',
  'SS014_DRY_RUN_SIZE_CAP_EXCEEDED',
  'SS014_DRY_RUN_TIMEOUT',
  'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE',
  'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
  'SS014_DRY_RUN_UNKNOWN_COMMAND',
  'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
  'SS014_DRY_RUN_REDACTION_FAILED',
  'SS014_DRY_RUN_PLAN_DRIFT',
])

const LOGICAL_COLLECTIONS = Object.freeze({
  SECTIONS: 'runtime_section_states',
  EVIDENCE_SOURCES: 'runtime_evidence_sources',
  EVIDENCE_OBJECTS: 'runtime_evidence_objects',
  GRAPH_SNAPSHOTS: 'runtime_graph_snapshots',
  GRAPH_ELEMENTS: 'runtime_graph_elements',
})

const LOGICAL_COLLECTION_NAMES = Object.freeze(Object.keys(LOGICAL_COLLECTIONS))
const PHYSICAL_COLLECTION_NAMES = Object.freeze(Object.values(LOGICAL_COLLECTIONS))

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

const ROOT_OPTIONS = Object.freeze({
  limit: ROOT_LIMIT,
  batchSize: BATCH_SIZE,
  maxTimeMS: READ_MAX_TIME_MS,
})

const COLLECTION_PRESENCE_OPTIONS = Object.freeze({
  maxTimeMS: READ_MAX_TIME_MS,
})

const CHILD_OPTIONS = Object.freeze({
  limit: CHILD_LIMIT,
  batchSize: BATCH_SIZE,
  maxTimeMS: READ_MAX_TIME_MS,
})

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const isPromiseLike = (value) => (
  (typeof value === 'object' && value !== null) || typeof value === 'function'
) && typeof value.then === 'function'

const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key]
      if (typeof key === 'symbol' || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

const hasExactKeys = (value, keys) => {
  if (!isPlainRecord(value)) return false

  try {
    const actual = Reflect.ownKeys(value)
    return actual.length === keys.length && keys.every((key) => actual.includes(key))
  } catch {
    return false
  }
}

const isCallableRecord = (value, keys) => (
  hasExactKeys(value, keys) && keys.every((key) => typeof value[key] === 'function')
)

const makeIncompleteResult = (errorCode) => {
  const code = typeof errorCode === 'string' && FAILURE_CODES.has(errorCode)
    ? errorCode
    : 'SS014_DRY_RUN_REDACTION_FAILED'

  return Object.freeze({
    status: 'INCOMPLETE',
    errorCode: code,
    plan: null,
    planHash: null,
  })
}

const validateScope = (scope) => {
  if (!isPlainRecord(scope)) return false

  const keys = Reflect.ownKeys(scope)
  if (keys.some((key) => typeof key === 'symbol')) return false
  if (keys.length !== 5) return false
  if (!hasOwn(scope, 'schemaVersion') || !hasOwn(scope, 'environmentClass')) return false
  if (!hasOwn(scope, 'customerId') || !hasOwn(scope, 'tenantId')) return false

  const hasRuntimeId = hasOwn(scope, 'runtimeId')
  const hasRuntimeKey = hasOwn(scope, 'runtimeKey')
  if (hasRuntimeId === hasRuntimeKey) return false

  if (
    scope.schemaVersion !== 'ss014-scope-v1'
    || scope.environmentClass !== 'DEVELOPMENT_TEST'
    || typeof scope.customerId !== 'string'
    || !LOWER_HEX_ID_PATTERN.test(scope.customerId)
    || typeof scope.tenantId !== 'string'
    || !LOWER_HEX_ID_PATTERN.test(scope.tenantId)
  ) return false

  if (hasRuntimeId) {
    return typeof scope.runtimeId === 'string' && LOWER_HEX_ID_PATTERN.test(scope.runtimeId)
  }

  return typeof scope.runtimeKey === 'string' && RUNTIME_KEY_PATTERN.test(scope.runtimeKey)
}

const validateDependencyContract = (objectIdAdapter, clock) => (
  isCallableRecord(
    objectIdAdapter,
    ['isValidLowerHexId', 'fromLowerHexId', 'isOpaqueObjectId', 'toLowerHexId'],
  ) && isCallableRecord(clock, ['now'])
)

const callSync = (callback) => {
  try {
    const value = callback()
    return isPromiseLike(value) ? { ok: false } : { ok: true, value }
  } catch {
    return { ok: false }
  }
}

const convertId = (objectIdAdapter, value) => {
  const valid = callSync(() => objectIdAdapter.isValidLowerHexId(value))
  if (!valid.ok || valid.value !== true) return { ok: false }

  const converted = callSync(() => objectIdAdapter.fromLowerHexId(value))
  if (!converted.ok) return { ok: false }

  const opaque = callSync(() => objectIdAdapter.isOpaqueObjectId(converted.value))
  if (!opaque.ok || opaque.value !== true) return { ok: false }

  return { ok: true, value: converted.value }
}

const freezeFilter = (filter) => Object.freeze(filter)

const freezeQuery = (query) => Object.freeze(query)

const createDeadlineResult = (clock) => {
  const started = callSync(() => clock.now())
  if (
    !started.ok
    || !Number.isSafeInteger(started.value)
    || started.value < 0
    || started.value > Number.MAX_SAFE_INTEGER - READ_MAX_TIME_MS
  ) {
    return makeIncompleteResult('SS014_DRY_RUN_TIMEOUT')
  }

  const startedAt = started.value
  const expiresAt = startedAt + READ_MAX_TIME_MS
  let previous = startedAt

  const check = () => {
    const current = callSync(() => clock.now())
    if (
      !current.ok
      || !Number.isSafeInteger(current.value)
      || current.value < previous
      || current.value >= expiresAt
    ) {
      return makeIncompleteResult('SS014_DRY_RUN_TIMEOUT')
    }

    previous = current.value
    return Object.freeze({ status: 'OPEN' })
  }

  return Object.freeze({ status: 'READY', startedAt, expiresAt, check })
}

export function createSs014TopologyReadPrimitives(input) {
  if (!hasExactKeys(input, ['scope', 'objectIdAdapter', 'clock'])) {
    throw new TypeError('SS014_DRY_RUN_REDACTION_FAILED')
  }

  const { scope, objectIdAdapter, clock } = input
  if (!validateScope(scope) || !validateDependencyContract(objectIdAdapter, clock)) {
    throw new TypeError('SS014_DRY_RUN_SCOPE_INVALID')
  }

  const customerId = convertId(objectIdAdapter, scope.customerId)
  const tenantId = convertId(objectIdAdapter, scope.tenantId)
  const runtimeId = hasOwn(scope, 'runtimeId')
    ? convertId(objectIdAdapter, scope.runtimeId)
    : { ok: true, value: null }

  if (!customerId.ok || !tenantId.ok || !runtimeId.ok) {
    throw new TypeError('SS014_DRY_RUN_SCOPE_INVALID')
  }

  const rootFilter = freezeFilter(hasOwn(scope, 'runtimeId')
    ? {
        _id: runtimeId.value,
        customerId: customerId.value,
        tenantId: tenantId.value,
      }
    : {
        runtimeInstanceKey: scope.runtimeKey,
        customerId: customerId.value,
        tenantId: tenantId.value,
      })

  function buildChildFilter(rootId) {
    if (arguments.length !== 1) return makeIncompleteResult('SS014_DRY_RUN_REDACTION_FAILED')

    const opaque = callSync(() => objectIdAdapter.isOpaqueObjectId(rootId))
    if (!opaque.ok || opaque.value !== true) {
      return makeIncompleteResult('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    }

    const canonical = callSync(() => objectIdAdapter.toLowerHexId(rootId))
    if (!canonical.ok || typeof canonical.value !== 'string' || !LOWER_HEX_ID_PATTERN.test(canonical.value)) {
      return makeIncompleteResult('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    }

    return freezeFilter({
      runtimeInstanceId: rootId,
      customerId: customerId.value,
      tenantId: tenantId.value,
    })
  }

  function buildRootFilter() {
    if (arguments.length !== 0) return makeIncompleteResult('SS014_DRY_RUN_REDACTION_FAILED')
    return rootFilter
  }

  function rootQuery() {
    if (arguments.length !== 0) return makeIncompleteResult('SS014_DRY_RUN_REDACTION_FAILED')
    return freezeQuery({
      collection: 'runtime_instances',
      filter: rootFilter,
      projection: ROOT_PROJECTION,
      options: ROOT_OPTIONS,
    })
  }

  function collectionPresenceQuery(logicalName) {
    if (arguments.length !== 1 || !LOGICAL_COLLECTION_NAMES.includes(logicalName)) {
      return makeIncompleteResult('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    }
    return freezeQuery({
      collection: LOGICAL_COLLECTIONS[logicalName],
      options: COLLECTION_PRESENCE_OPTIONS,
    })
  }

  function childQuery(logicalName, rootId) {
    if (arguments.length !== 2 || !LOGICAL_COLLECTION_NAMES.includes(logicalName)) {
      return makeIncompleteResult('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    }

    const filter = buildChildFilter(rootId)
    if (filter.status === 'INCOMPLETE') return filter

    return freezeQuery({
      collection: LOGICAL_COLLECTIONS[logicalName],
      filter,
      projection: CHILD_PROJECTION,
      options: CHILD_OPTIONS,
    })
  }

  function createDeadline() {
    if (arguments.length !== 0) return makeIncompleteResult('SS014_DRY_RUN_REDACTION_FAILED')
    return createDeadlineResult(clock)
  }

  function makeIncomplete(errorCode) {
    if (arguments.length !== 1) return makeIncompleteResult('SS014_DRY_RUN_REDACTION_FAILED')
    return makeIncompleteResult(errorCode)
  }

  const primitives = {
    databaseName: DATABASE_NAME,
    buildRootFilter,
    buildChildFilter,
    rootQuery,
    collectionPresenceQuery,
    childQuery,
    createDeadline,
    makeIncompleteResult: makeIncomplete,
  }

  return Object.freeze(primitives)
}
