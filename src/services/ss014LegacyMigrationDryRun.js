import { createHash } from 'node:crypto'

import { resolveRuntimeStateVersion } from './runtimeStateVersionService.js'
import { createSs014NativeCommandMonitor } from './ss014NativeCommandMonitor.js'

const MAX_COMMAND_TIME_MS = 2500
const MAX_DOMAIN_BYTES = 12 * 1024 * 1024
const MAX_ROOT_BYTES = 65536
const MAX_V2_ROWS = 1000
const LEGACY_READ_LIMIT = 2
const V2_READ_LIMIT = 1001
const BATCH_SIZE = 1
const MAX_EVENTS = 64
const PLAN_ALGORITHM = 'stable-json-v1/sha256-utf8-lowerhex'
const PLAN_HASH_STATUS = 'PROVISIONAL_NOT_APPLY_AUTHORITY'
const SOURCE_HASH_STATUS = 'NOT_COMPUTED_BASELINE_MAPPING_REQUIRED'

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
  BASELINE_MAPPING_REQUIRED: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED',
  PLAN_DRIFT: 'SS014_DRY_RUN_PLAN_DRIFT',
})

const INTERNAL_NAMESPACE_NOT_FOUND = 'SS014_INTERNAL_NAMESPACE_NOT_FOUND'

const LEGACY_DOMAINS = Object.freeze([
  Object.freeze({
    name: 'SECTIONS_LEGACY',
    path: 'sections',
    itemKind: 'sections',
    itemCap: 2000,
  }),
  Object.freeze({
    name: 'EVIDENCE_PACK_LEGACY',
    path: 'evidence_pack',
    itemKind: 'evidence',
    itemCap: 10000,
  }),
  Object.freeze({
    name: 'INTELLIGENCE_GRAPH_LEGACY',
    path: 'intelligence_graph',
    itemKind: 'graph',
    nodeCap: 20000,
    edgeCap: 40000,
  }),
])

const V2_DOMAINS = Object.freeze([
  Object.freeze({ logical: 'SECTIONS', physical: 'runtime_section_states' }),
  Object.freeze({ logical: 'EVIDENCE_SOURCES', physical: 'runtime_evidence_sources' }),
  Object.freeze({ logical: 'EVIDENCE_OBJECTS', physical: 'runtime_evidence_objects' }),
  Object.freeze({ logical: 'GRAPH_SNAPSHOTS', physical: 'runtime_graph_snapshots' }),
  Object.freeze({ logical: 'GRAPH_ELEMENTS', physical: 'runtime_graph_elements' }),
])

const LEGACY_PROJECTIONS = Object.freeze({
  SECTIONS_LEGACY: Object.freeze({
    _id: 1,
    customerId: 1,
    tenantId: 1,
    runtimeInstanceKey: 1,
    'framework_state.sections': 1,
  }),
  EVIDENCE_PACK_LEGACY: Object.freeze({
    _id: 1,
    customerId: 1,
    tenantId: 1,
    runtimeInstanceKey: 1,
    'framework_state.evidence_pack': 1,
  }),
  INTELLIGENCE_GRAPH_LEGACY: Object.freeze({
    _id: 1,
    customerId: 1,
    tenantId: 1,
    runtimeInstanceKey: 1,
    'framework_state.intelligence_graph': 1,
  }),
})

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const isThenable = (value) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    return typeof value.then === 'function'
  } catch {
    return true
  }
}

const safeData = (value, key) => {
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

const safeMember = (value, key) => {
  try {
    return { ok: true, value: value[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

const isPlainData = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) return false
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

const isSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)

const validateScope = (scope) => {
  if (!isPlainData(scope)) return false
  const hasRuntimeId = hasOwn(scope, 'runtimeId')
  const hasRuntimeKey = hasOwn(scope, 'runtimeKey')
  const runtimeKey = hasRuntimeId ? 'runtimeId' : 'runtimeKey'
  const expectedKeys = ['schemaVersion', 'environmentClass', 'customerId', 'tenantId', runtimeKey]
  const actualKeys = Object.getOwnPropertyNames(scope)
  if (hasRuntimeId === hasRuntimeKey || actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !actualKeys.includes(key))) return false
  return scope.schemaVersion === 'ss014-scope-v1'
    && scope.environmentClass === 'DEVELOPMENT_TEST'
    && typeof scope.customerId === 'string'
    && /^[0-9a-f]{24}$/.test(scope.customerId)
    && typeof scope.tenantId === 'string'
    && /^[0-9a-f]{24}$/.test(scope.tenantId)
    && (hasRuntimeId
      ? typeof scope.runtimeId === 'string' && /^[0-9a-f]{24}$/.test(scope.runtimeId)
      : typeof scope.runtimeKey === 'string' && /^[a-z][a-z0-9-]{2,159}$/.test(scope.runtimeKey))
}

const validateInputShape = (input) => {
  if (!isPlainData(input)) return false
  const keys = [
    'scope', 'primitives', 'objectIdAdapter', 'environmentGuard', 'autoCreateGuard',
    'autoIndexGuard', 'clientFactory', 'clock', 'bsonSizer',
  ]
  const actual = Object.getOwnPropertyNames(input)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
    && typeof input.clientFactory === 'function'
    && typeof input.bsonSizer === 'function'
}

const callSync = (callback) => {
  try {
    const value = callback()
    return isThenable(value) ? { ok: false, value: undefined } : { ok: true, value }
  } catch {
    return { ok: false, value: undefined }
  }
}

const callAsync = async (callback) => {
  try {
    const value = callback()
    return { ok: true, value: isThenable(value) ? await value : value }
  } catch {
    return { ok: false, value: undefined }
  }
}

const waitBounded = async (callback, allowNamespaceNotFound = false) => {
  let operation
  try {
    operation = callback()
  } catch {
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }
  if (!isThenable(operation)) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }

  let timer
  try {
    const result = await Promise.race([
      Promise.resolve(operation).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, code: ERROR_CODES.TIMEOUT }), MAX_COMMAND_TIME_MS)
      }),
    ])
    try { clearTimeout(timer) } catch { return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE } }
    if (result.ok) return result
    const code = safeData(result.error, 'code')
    const codeName = safeData(result.error, 'codeName')
    if (allowNamespaceNotFound
      && ((code.ok && code.value === 26) || (codeName.ok && codeName.value === 'NamespaceNotFound'))) {
      return { ok: false, code: INTERNAL_NAMESPACE_NOT_FOUND }
    }
    return result.code ? { ok: false, code: result.code } : { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  } catch {
    try { clearTimeout(timer) } catch { /* fail closed below */ }
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }
}

const validateEnvironment = (guard) => {
  const result = safeData(guard, 'read')
  if (!result.ok || typeof result.value !== 'function') return { ok: false, code: ERROR_CODES.PRODUCTION_BLOCKED }
  const read = callSync(() => result.value())
  if (!read.ok || !isPlainData(read.value)
    || read.value.environmentClass !== 'DEVELOPMENT_TEST'
    || read.value.isProduction !== false || read.value.isAppProduction !== false) {
    return { ok: false, code: ERROR_CODES.PRODUCTION_BLOCKED }
  }
  return { ok: true }
}

const validateGuard = (guard) => {
  if (!isPlainData(guard)) return false
  return ['read', 'setFalse', 'restore'].every((key) => {
    const value = safeData(guard, key)
    return value.ok && typeof value.value === 'function'
  })
}

const validateObjectIdAdapter = (adapter) => isPlainData(adapter)
  && ['isValidLowerHexId', 'fromLowerHexId', 'isOpaqueObjectId', 'toLowerHexId'].every((key) => {
    const value = safeData(adapter, key)
    return value.ok && typeof value.value === 'function'
  })

const canonicalId = (adapter, value) => {
  const opaque = callSync(() => adapter.isOpaqueObjectId(value))
  const lower = opaque.ok && opaque.value === true ? callSync(() => adapter.toLowerHexId(value)) : { ok: false }
  return lower.ok && typeof lower.value === 'string' && /^[0-9a-f]{24}$/.test(lower.value)
    ? lower.value
    : null
}

const measure = (row, bsonSizer, maximum, allowFrameworkState = false) => {
  if (!isPlainData(row) || (!allowFrameworkState && hasOwn(row, 'framework_state'))) {
    return { ok: false, code: hasOwn(row, 'framework_state') && !allowFrameworkState ? ERROR_CODES.FULL_STATE_BLOCKED : ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  }
  const size = callSync(() => bsonSizer(row))
  if (!size.ok || !isSafeInteger(size.value) || size.value > maximum) {
    return { ok: false, code: ERROR_CODES.SIZE_CAP_EXCEEDED }
  }
  return { ok: true, bytes: size.value }
}

const configureCursor = (cursor, limit) => {
  if (cursor === null || (typeof cursor !== 'object' && typeof cursor !== 'function')) return false
  for (const [method, value] of [['limit', limit], ['batchSize', BATCH_SIZE], ['maxTimeMS', 2000]]) {
    const result = safeMember(cursor, method)
    if (!result.ok || typeof result.value !== 'function') return false
    const configured = callSync(() => result.value.call(cursor, value))
    if (!configured.ok || configured.value !== cursor) return false
  }
  return true
}

const readCursor = async ({ cursor, limit, bsonSizer, rowMaximum = MAX_DOMAIN_BYTES, validateRow, allowFrameworkState = false }) => {
  if (!configureCursor(cursor, limit)) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  const rows = []
  try {
    while (true) {
      const hasNextMethod = safeMember(cursor, 'hasNext')
      if (!hasNextMethod.ok || typeof hasNextMethod.value !== 'function') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
      const hasNext = await waitBounded(() => hasNextMethod.value.call(cursor))
      if (!hasNext.ok) return hasNext
      if (typeof hasNext.value !== 'boolean') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
      if (!hasNext.value) break
      if (rows.length >= limit) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
      const nextMethod = safeMember(cursor, 'next')
      if (!nextMethod.ok || typeof nextMethod.value !== 'function') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
      const next = await waitBounded(() => nextMethod.value.call(cursor))
      if (!next.ok) return next
      const measured = measure(next.value, bsonSizer, rowMaximum, allowFrameworkState)
      if (!measured.ok) return measured
      if (validateRow && !validateRow(next.value)) {
        return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
      }
      rows.push(next.value)
    }
    return { ok: true, rows }
  } finally {
    const closeMethod = safeMember(cursor, 'close')
    const closed = closeMethod.ok && typeof closeMethod.value === 'function'
      ? await waitBounded(() => closeMethod.value.call(cursor))
      : { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    if (!closed.ok) return closed
  }
}

const jsonBytes = (value) => {
  try {
    const json = JSON.stringify(value)
    if (typeof json !== 'string') return { ok: false }
    return { ok: true, bytes: Buffer.byteLength(json, 'utf8') }
  } catch {
    return { ok: false }
  }
}

const countLegacyDomain = (domain, definition) => {
  if (domain === undefined) {
    return { ok: true, value: { presence: 'ABSENT', itemCount: 0, nodeCount: 0, edgeCount: 0, sizeClass: 'EMPTY' } }
  }
  const serialized = jsonBytes(domain)
  if (!serialized.ok || serialized.bytes > MAX_DOMAIN_BYTES) {
    return { ok: false, code: serialized.ok ? ERROR_CODES.SIZE_CAP_EXCEEDED : ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  }
  if (definition.itemKind === 'sections') {
    if (!isPlainData(domain)) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const itemCount = Object.keys(domain).length
    if (itemCount > definition.itemCap) return { ok: false, code: ERROR_CODES.SIZE_CAP_EXCEEDED }
    return {
      ok: true,
      value: {
        presence: 'PRESENT', itemCount, nodeCount: 0, edgeCount: 0,
        sizeClass: itemCount === 0 ? 'EMPTY' : serialized.bytes <= 1024 * 1024 ? 'SMALL' : 'LARGE',
      },
    }
  }
  if (definition.itemKind === 'evidence') {
    const itemCount = Array.isArray(domain)
      ? domain.length
      : isPlainData(domain) && Array.isArray(domain.evidenceObjects)
        ? domain.evidenceObjects.length
        : isPlainData(domain) ? Object.keys(domain).length : -1
    if (itemCount < 0) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    if (itemCount > definition.itemCap) return { ok: false, code: ERROR_CODES.SIZE_CAP_EXCEEDED }
    return {
      ok: true,
      value: {
        presence: 'PRESENT', itemCount, nodeCount: 0, edgeCount: 0,
        sizeClass: itemCount === 0 ? 'EMPTY' : serialized.bytes <= 1024 * 1024 ? 'SMALL' : 'LARGE',
      },
    }
  }
  if (!isPlainData(domain)) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  const nodes = hasOwn(domain, 'nodes') ? domain.nodes : []
  const edges = hasOwn(domain, 'edges') ? domain.edges : []
  if (!Array.isArray(nodes) || !Array.isArray(edges)
    || nodes.length > definition.nodeCap || edges.length > definition.edgeCap) {
    return { ok: false, code: Array.isArray(nodes) && Array.isArray(edges)
      ? ERROR_CODES.SIZE_CAP_EXCEEDED : ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
  }
  return {
    ok: true,
    value: {
      presence: 'PRESENT', itemCount: nodes.length + edges.length,
      nodeCount: nodes.length, edgeCount: edges.length,
      sizeClass: nodes.length + edges.length === 0 ? 'EMPTY' : serialized.bytes <= 1024 * 1024 ? 'SMALL' : 'LARGE',
    },
  }
}

const getNestedDomain = (row, path) => {
  const state = safeData(row, 'framework_state')
  if (!state.ok) return { ok: true, value: undefined }
  if (!isPlainData(state.value)) return { ok: false }
  const domain = safeData(state.value, path)
  return domain.ok ? { ok: true, value: domain.value } : { ok: true, value: undefined }
}

const stableStringify = (value) => {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!isPlainData(value)) throw new Error('redaction')
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

const addBlocker = (blockers, code) => {
  if (!blockers.some((entry) => entry.code === code)) blockers.push({ code, severity: 'BLOCKER' })
}

const makeReceipt = (operation, outcome = 'READ') => ({ operation, outcome, bounded: true })

const snapshotForComparison = (observation) => ({
  rootVersionStatus: observation.rootState.versionStatus,
  legacyDomains: observation.legacyDomains.map(({ name, presence, itemCount, nodeCount, edgeCount, sizeClass }) => ({
    name, presence, itemCount, nodeCount, edgeCount, sizeClass,
  })),
  v2Collections: observation.v2Collections.map(({ name, presence, scopedCount, countStatus }) => ({
    name, presence, scopedCount, countStatus,
  })),
  blockers: observation.blockers.map(({ code, severity }) => ({ code, severity })),
  commandClasses: observation.execution.commandClasses,
  readReceipts: observation.readReceipts.map(({ operation, outcome }) => ({ operation, outcome })),
})

const makePlan = (observation) => ({
  applyAuthority: false,
  blockers: observation.blockers,
  environmentClass: 'DEVELOPMENT_TEST',
  execution: observation.execution,
  hashStatus: {
    algorithm: PLAN_ALGORITHM,
    planHashStatus: PLAN_HASH_STATUS,
    sourceHashStatus: SOURCE_HASH_STATUS,
  },
  legacyDomains: observation.legacyDomains,
  readReceipts: observation.readReceipts,
  repeatRead: { driftStatus: 'MATCHED', independentObservations: 2 },
  rootState: observation.rootState,
  scopeClass: 'EXACT_SINGLE_RUNTIME',
  v2Collections: observation.v2Collections,
})

const validateMonitorSnapshot = (snapshot) => isPlainData(snapshot)
  && isSafeInteger(snapshot.commandEventCount)
  && snapshot.commandEventCount <= MAX_EVENTS
  && isPlainData(snapshot.commandClasses)
  && ['setup', 'read', 'teardown'].every((key) => isSafeInteger(snapshot.commandClasses[key]))
  && snapshot.commandClasses.setup + snapshot.commandClasses.read + snapshot.commandClasses.teardown
    === snapshot.commandEventCount
  && (snapshot.failureCode === null || typeof snapshot.failureCode === 'string')

const safeSnapshot = (monitor) => {
  const result = callSync(() => monitor.getSnapshot())
  return result.ok && validateMonitorSnapshot(result.value) ? result.value : null
}

const readLegacyObservation = async ({ database, primitives, root, rootId, scope, objectIdAdapter, bsonSizer, monitor }) => {
  const filterResult = callSync(() => primitives.buildRootFilter())
  if (!filterResult.ok || !isPlainData(filterResult.value)) return { ok: false, code: ERROR_CODES.REDACTION_FAILED }
  const legacyDomains = []
  const receipts = [makeReceipt('ROOT_CONTROL_FIND')]
  for (const definition of LEGACY_DOMAINS) {
    const projection = LEGACY_PROJECTIONS[definition.name]
    const collectionResult = callSync(() => database.collection('runtime_instances'))
    if (!collectionResult.ok || collectionResult.value === null) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const find = safeMember(collectionResult.value, 'find')
    if (!find.ok || typeof find.value !== 'function') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const cursorResult = callSync(() => find.value.call(collectionResult.value, filterResult.value, { projection }))
    if (!cursorResult.ok) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const rows = await readCursor({
      cursor: cursorResult.value,
      limit: LEGACY_READ_LIMIT,
      bsonSizer,
      rowMaximum: MAX_DOMAIN_BYTES,
      allowFrameworkState: true,
    })
    if (!rows.ok) return rows
    if (rows.rows.length !== 1) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const row = rows.rows[0]
    const rowIdentityOk = canonicalId(objectIdAdapter, row._id) === rootId
      && canonicalId(objectIdAdapter, row.customerId) === scope.customerId
      && canonicalId(objectIdAdapter, row.tenantId) === scope.tenantId
      && row.runtimeInstanceKey === scope.runtimeKey
    if (!rowIdentityOk) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const domain = getNestedDomain(row, definition.path)
    if (!domain.ok) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const counted = countLegacyDomain(domain.value, definition)
    if (!counted.ok) return counted
    legacyDomains.push({ bounded: true, name: definition.name, ...counted.value })
    receipts.push(makeReceipt(`${definition.name}_FIND`, counted.value.presence === 'ABSENT' ? 'ABSENT' : 'READ'))
    const failure = safeSnapshot(monitor)?.failureCode
    if (failure) return { ok: false, code: failure }
  }
  return { ok: true, legacyDomains, receipts }
}

const readV2Observation = async ({ database, primitives, root, rootId, scope, objectIdAdapter, bsonSizer, monitor }) => {
  const v2Collections = []
  const receipts = []
  for (const entry of V2_DOMAINS) {
    const presence = callSync(() => primitives.collectionPresenceQuery(entry.logical))
    if (!presence.ok || !isPlainData(presence.value)
      || presence.value.collection !== entry.physical
      || !isPlainData(presence.value.options) || presence.value.options.maxTimeMS !== 2000) {
      return { ok: false, code: ERROR_CODES.REDACTION_FAILED }
    }
    const command = { collStats: presence.value.collection, maxTimeMS: presence.value.options.maxTimeMS }
    const stats = await waitBounded(() => database.command(command), true)
    if (!stats.ok && stats.code === INTERNAL_NAMESPACE_NOT_FOUND) {
      v2Collections.push({ bounded: true, name: entry.logical, presence: 'ABSENT', scopedCount: 0, countStatus: 'NOT_RUN_ABSENT' })
      receipts.push(makeReceipt(`${entry.logical}_FIND`, 'ABSENT'))
      continue
    }
    if (!stats.ok) return stats
    if (!isPlainData(stats.value) || stats.value.ok !== 1) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const failure = safeSnapshot(monitor)?.failureCode
    if (failure) return { ok: false, code: failure }
    const query = callSync(() => primitives.childQuery(entry.logical, root._id))
    if (!query.ok || !isPlainData(query.value)) return { ok: false, code: ERROR_CODES.REDACTION_FAILED }
    const collection = callSync(() => database.collection(entry.physical))
    const find = collection.ok ? safeMember(collection.value, 'find') : { ok: false }
    if (!find.ok || typeof find.value !== 'function') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const cursor = callSync(() => find.value.call(collection.value, query.value.filter, { projection: query.value.projection }))
    if (!cursor.ok) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const rows = await readCursor({
      cursor: cursor.value,
      limit: V2_READ_LIMIT,
      bsonSizer,
      rowMaximum: MAX_ROOT_BYTES,
      validateRow: (row) => canonicalId(objectIdAdapter, row.runtimeInstanceId) === rootId
        && canonicalId(objectIdAdapter, row.customerId) === scope.customerId
        && canonicalId(objectIdAdapter, row.tenantId) === scope.tenantId,
    })
    if (!rows.ok) return rows
    if (rows.rows.length > MAX_V2_ROWS) {
      v2Collections.push({ bounded: true, name: entry.logical, presence: 'PRESENT', scopedCount: 1001, countStatus: 'CAP_EXCEEDED' })
      receipts.push(makeReceipt(`${entry.logical}_FIND`, 'CAP_EXCEEDED'))
      return { ok: false, code: ERROR_CODES.SIZE_CAP_EXCEEDED }
    }
    v2Collections.push({ bounded: true, name: entry.logical, presence: 'PRESENT', scopedCount: rows.rows.length, countStatus: 'EXACT' })
    receipts.push(makeReceipt(`${entry.logical}_FIND`))
  }
  return { ok: true, v2Collections, receipts }
}

const runObservation = async (input, clientInput) => {
  let client = clientInput
  let monitor = null
  let removeMethod = null
  let listeners = []
  const originalListenerCounts = new Map()
  let autoCreatePrevious
  let autoIndexPrevious
  let autoCreateCaptured = false
  let autoIndexCaptured = false
  let guardFailure = false
  let cleanupFailure = false
  const guardCapture = (guard, label) => {
    const read = safeData(guard, 'read')
    const setFalse = safeData(guard, 'setFalse')
    if (!read.ok || !setFalse.ok) return false
    const current = callSync(() => read.value())
    if (!current.ok || typeof current.value !== 'boolean') return false
    if (label === 'autoCreate') { autoCreatePrevious = current.value; autoCreateCaptured = true }
    else { autoIndexPrevious = current.value; autoIndexCaptured = true }
    const set = callSync(() => setFalse.value())
    const verify = callSync(() => read.value())
    return set.ok && set.value === undefined && verify.ok && verify.value === false
  }
  const restoreGuard = (guard, previous, captured) => {
    if (!captured) return
    const restore = safeData(guard, 'restore')
    if (!restore.ok || !callSync(() => restore.value(previous)).ok) guardFailure = true
  }
  try {
    if (!guardCapture(input.autoCreateGuard, 'autoCreate') || !guardCapture(input.autoIndexGuard, 'autoIndex')) {
      return { ok: false, code: ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE }
    }
    if (client === null || (typeof client !== 'object' && typeof client !== 'function')) {
      return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
    }
    const options = safeMember(client, 'options')
    const on = safeMember(client, 'on')
    const off = safeMember(client, 'off')
    const removeListener = safeMember(client, 'removeListener')
    const listenerCount = safeMember(client, 'listenerCount')
    const connect = safeMember(client, 'connect')
    const close = safeMember(client, 'close')
    const db = safeMember(client, 'db')
    if (!options.ok || options.value.monitorCommands !== true || !on.ok || !listenerCount.ok
      || typeof on.value !== 'function' || typeof listenerCount.value !== 'function'
      || (!off.ok && !removeListener.ok) || !connect.ok || typeof connect.value !== 'function'
      || !close.ok || typeof close.value !== 'function' || !db.ok || typeof db.value !== 'function') {
      return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
    }
    removeMethod = off.ok && typeof off.value === 'function' ? off.value : removeListener.value
    monitor = createSs014NativeCommandMonitor()
    for (const [event, handler] of [['commandStarted', monitor.onCommandStarted], ['commandFailed', monitor.onCommandFailed]]) {
      const count = callSync(() => listenerCount.value.call(client, event))
      if (!count.ok || !isSafeInteger(count.value)) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
      originalListenerCounts.set(event, count.value)
      const attached = callSync(() => on.value.call(client, event, handler))
      if (!attached.ok || (attached.value !== undefined && attached.value !== client)) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
      listeners.push([event, handler])
    }
    const connected = await waitBounded(() => connect.value.call(client))
    if (!connected.ok) return connected
    if (safeSnapshot(monitor)?.failureCode) return { ok: false, code: safeSnapshot(monitor).failureCode }
    const database = callSync(() => db.value.call(client, 'test'))
    if (!database.ok || !database.value || typeof database.value !== 'object') return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
    const rootQuery = callSync(() => input.primitives.rootQuery())
    if (!rootQuery.ok || !isPlainData(rootQuery.value) || rootQuery.value.collection !== 'runtime_instances'
      || !isPlainData(rootQuery.value.filter) || !isPlainData(rootQuery.value.projection)
      || hasOwn(rootQuery.value.projection, 'framework_state')) return { ok: false, code: ERROR_CODES.REDACTION_FAILED }
    const rootCollection = callSync(() => database.value.collection('runtime_instances'))
    const rootFind = rootCollection.ok ? safeMember(rootCollection.value, 'find') : { ok: false }
    if (!rootFind.ok || typeof rootFind.value !== 'function') return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const rootCursor = callSync(() => rootFind.value.call(rootCollection.value, rootQuery.value.filter, { projection: rootQuery.value.projection }))
    if (!rootCursor.ok) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const rootRows = await readCursor({ cursor: rootCursor.value, limit: 2, bsonSizer: input.bsonSizer, rowMaximum: MAX_ROOT_BYTES })
    if (!rootRows.ok) return rootRows
    if (rootRows.rows.length !== 1) return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    const root = rootRows.rows[0]
    const rootId = canonicalId(input.objectIdAdapter, root._id)
    const customerId = canonicalId(input.objectIdAdapter, root.customerId)
    const tenantId = canonicalId(input.objectIdAdapter, root.tenantId)
    if (!rootId || customerId !== input.scope.customerId || tenantId !== input.scope.tenantId
      || (input.scope.runtimeId ? rootId !== input.scope.runtimeId : root.runtimeInstanceKey !== input.scope.runtimeKey)) {
      return { ok: false, code: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }
    }
    const version = resolveRuntimeStateVersion({ stateVersion: root.stateVersion, runtimeStateVersion: root.runtimeStateVersion })
    if (version.errorCode === 'RUNTIME_STATE_VERSION_MIXED') return { ok: false, code: ERROR_CODES.STATE_VERSION_MIXED }
    const legacy = await readLegacyObservation({
      database: database.value, primitives: input.primitives, root, rootId, scope: input.scope,
      objectIdAdapter: input.objectIdAdapter, bsonSizer: input.bsonSizer, monitor,
    })
    if (!legacy.ok) return legacy
    const v2 = await readV2Observation({
      database: database.value, primitives: input.primitives, root, rootId, scope: input.scope,
      objectIdAdapter: input.objectIdAdapter, bsonSizer: input.bsonSizer, monitor,
    })
    if (!v2.ok) return v2
    const snapshot = safeSnapshot(monitor)
    if (!snapshot) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
    const blockers = [{ code: ERROR_CODES.BASELINE_MAPPING_REQUIRED, severity: 'BLOCKER' }]
    if (version.source === 'missing' || version.source === 'compatibility_alias') addBlocker(blockers, ERROR_CODES.BASELINE_MAPPING_REQUIRED)
    return {
      ok: true,
      observation: {
        blockers,
        execution: {
          commandClasses: snapshot.commandClasses,
          commandEventCount: snapshot.commandEventCount,
          cleanDisconnect: true,
          monitorInstalledBeforeConnect: true,
          monitorRemoved: true,
        },
        legacyDomains: legacy.legacyDomains,
        readReceipts: [...legacy.receipts, ...v2.receipts],
        rootState: { recordCount: 1, versionStatus: version.source === 'canonical' ? 'CANONICAL' : version.source === 'compatibility_alias' ? 'ALIAS_ONLY' : 'MISSING', frameworkStateProjected: false },
        v2Collections: v2.v2Collections,
      },
    }
  } catch {
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  } finally {
    if (client) {
      const close = safeMember(client, 'close')
      if (!close.ok || typeof close.value !== 'function') cleanupFailure = true
      else if (!(await waitBounded(() => close.value.call(client))).ok) cleanupFailure = true
      for (const [event, handler] of [...listeners].reverse()) {
        if (!removeMethod || !callSync(() => removeMethod.call(client, event, handler)).ok) cleanupFailure = true
      }
      const listenerCount = safeMember(client, 'listenerCount')
      if (listenerCount.ok && typeof listenerCount.value === 'function') {
        for (const [event] of listeners) {
          const count = callSync(() => listenerCount.value.call(client, event))
          if (!count.ok || count.value !== originalListenerCounts.get(event)) cleanupFailure = true
        }
      } else cleanupFailure = true
    }
    restoreGuard(input.autoIndexGuard, autoIndexPrevious, autoIndexCaptured)
    restoreGuard(input.autoCreateGuard, autoCreatePrevious, autoCreateCaptured)
    if (guardFailure || cleanupFailure) {
      return {
        ok: false,
        code: guardFailure ? ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE : ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE,
      }
    }
  }
}

const normalizeObservation = (observation) => ({
  blockers: [...observation.blockers].sort((left, right) => left.code.localeCompare(right.code)),
  execution: {
    commandClasses: { ...observation.execution.commandClasses },
    commandEventCount: observation.execution.commandEventCount,
  },
  legacyDomains: observation.legacyDomains,
  readReceipts: observation.readReceipts.map(({ operation, outcome }) => ({ operation, outcome, bounded: true })),
  rootState: observation.rootState,
  v2Collections: observation.v2Collections,
})

export const runSs014LegacyMigrationDryRun = async (input) => {
  if (!validateInputShape(input) || !validateScope(input.scope) || !validateObjectIdAdapter(input.objectIdAdapter)
    || !validateGuard(input.autoCreateGuard) || !validateGuard(input.autoIndexGuard)) {
    return incomplete(ERROR_CODES.REDACTION_FAILED)
  }
  const environment = validateEnvironment(input.environmentGuard)
  if (!environment.ok) return incomplete(environment.code)
  const firstClient = await callAsync(() => input.clientFactory({ monitorCommands: true }))
  if (!firstClient.ok || !firstClient.value) return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  const first = await runObservation(input, firstClient.value)
  if (!first.ok) return incomplete(first.code)
  const secondClient = await callAsync(() => input.clientFactory({ monitorCommands: true }))
  if (!secondClient.ok || !secondClient.value || secondClient.value === firstClient.value) {
    return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }
  const second = await runObservation(input, secondClient.value)
  if (!second.ok) return incomplete(second.code)
  const firstNormalized = normalizeObservation(first.observation)
  const secondNormalized = normalizeObservation(second.observation)
  const firstComparison = stableStringify(snapshotForComparison(firstNormalized))
  const secondComparison = stableStringify(snapshotForComparison(secondNormalized))
  if (firstComparison !== secondComparison) return incomplete(ERROR_CODES.PLAN_DRIFT)
  const plan = makePlan(firstNormalized)
  let canonicalJson
  try { canonicalJson = stableStringify(plan) } catch { return incomplete(ERROR_CODES.REDACTION_FAILED) }
  const planHash = createHash('sha256').update(Buffer.from(canonicalJson, 'utf8')).digest('hex')
  return Object.freeze({
    status: plan.blockers.length > 0 ? 'BLOCKED' : 'READY_FOR_BASELINE_REVIEW',
    errorCode: null,
    plan: Object.freeze(plan),
    planHash,
    planHashStatus: PLAN_HASH_STATUS,
    sourceHashStatus: SOURCE_HASH_STATUS,
  })
}

export { ERROR_CODES as SS014_LEGACY_DRY_RUN_ERROR_CODES, LEGACY_PROJECTIONS, LEGACY_DOMAINS }
