const ERROR_CODES = Object.freeze({
  REDACTION_FAILED: 'SS014_DRY_RUN_REDACTION_FAILED',
  SCOPE_INVALID: 'SS014_DRY_RUN_SCOPE_INVALID',
  STATE_VERSION_MIXED: 'SS014_DRY_RUN_STATE_VERSION_MIXED',
  COLLECTION_READ_UNAVAILABLE: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
})

const VERSION_SOURCES = new Set(['missing', 'compatibility_alias', 'canonical', 'mixed'])
const PRESENCE_VALUES = new Set(['ABSENT', 'PRESENT'])
const COUNT_STATUSES = new Set(['NOT_RUN_ABSENT', 'EXACT', 'CAP_EXCEEDED', 'READ_FAILED'])
const COLLECTION_ORDER = [
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
]
const RECEIPT_ORDER = [
  'ROOT_CONTROL_FIND',
  'COLLECTION_LIST',
  'SECTIONS_FIND',
  'EVIDENCE_SOURCES_FIND',
  'EVIDENCE_OBJECTS_FIND',
  'GRAPH_SNAPSHOTS_FIND',
  'GRAPH_ELEMENTS_FIND',
]
const COMMAND_CLASS_KEYS = ['setup', 'read', 'teardown']
const RUNTIME_ID_PATTERN = /^[0-9a-f]{24}$/
const RUNTIME_KEY_PATTERN = /^[a-z][a-z0-9-]{2,159}$/

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    return (prototype === Object.prototype || prototype === null)
      && Object.getOwnPropertySymbols(value).length === 0
  } catch {
    return false
  }
}

const hasExactDataKeys = (value, expectedKeys) => {
  if (!isPlainRecord(value)) return false

  try {
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedKeys.length
      || expectedKeys.some((key) => !ownKeys.includes(key))) return false

    return expectedKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor
        && descriptor.enumerable === true
        && 'value' in descriptor
        && !('get' in descriptor)
        && !('set' in descriptor))
    })
  } catch {
    return false
  }
}

const hasExactArray = (value, expectedLength) => {
  if (!Array.isArray(value)) return false

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0) return false

    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedLength + 1
      || !ownKeys.includes('length')) return false

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || lengthDescriptor.value !== expectedLength
      || lengthDescriptor.enumerable !== false
      || !('value' in lengthDescriptor)
      || ('get' in lengthDescriptor) || ('set' in lengthDescriptor)) return false

    return Array.from({ length: expectedLength }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      return Boolean(descriptor
        && descriptor.enumerable === true
        && 'value' in descriptor
        && !('get' in descriptor)
        && !('set' in descriptor))
    }).every(Boolean)
  } catch {
    return false
  }
}

const readValues = (value, keys) => keys.reduce((result, key) => {
  result[key] = Object.getOwnPropertyDescriptor(value, key).value
  return result
}, {})

const isSafeCount = (value, maximum) => (
  Number.isSafeInteger(value)
  && value >= 0
  && !Object.is(value, -0)
  && value <= maximum
)

const validateScope = (scope) => {
  const baseKeys = ['schemaVersion', 'environmentClass', 'customerId', 'tenantId']
  const hasRuntimeId = isPlainRecord(scope) && Object.prototype.hasOwnProperty.call(scope, 'runtimeId')
  const hasRuntimeKey = isPlainRecord(scope) && Object.prototype.hasOwnProperty.call(scope, 'runtimeKey')
  if (hasRuntimeId === hasRuntimeKey) return { kind: 'STRUCTURE' }

  const runtimeKey = hasRuntimeId ? 'runtimeId' : 'runtimeKey'
  const expectedKeys = [...baseKeys, runtimeKey]
  if (!hasExactDataKeys(scope, expectedKeys)) return { kind: 'STRUCTURE' }

  const values = readValues(scope, expectedKeys)
  if (values.schemaVersion !== 'ss014-scope-v1'
    || values.environmentClass !== 'DEVELOPMENT_TEST'
    || typeof values.customerId !== 'string'
    || !RUNTIME_ID_PATTERN.test(values.customerId)
    || typeof values.tenantId !== 'string'
    || !RUNTIME_ID_PATTERN.test(values.tenantId)
    || (hasRuntimeId
      ? typeof values.runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(values.runtimeId)
      : typeof values.runtimeKey !== 'string' || !RUNTIME_KEY_PATTERN.test(values.runtimeKey))) {
    return { kind: 'VALUE' }
  }

  return {
    kind: 'READY',
    selector: hasRuntimeId ? 'ID' : 'KEY',
    value: { ...values },
  }
}

const validateVersionView = (versionView) => {
  const keys = ['stateVersion', 'runtimeStateVersion']
  if (!hasExactDataKeys(versionView, keys)) return null
  const values = readValues(versionView, keys)
  if (values.stateVersion !== undefined && typeof values.stateVersion !== 'string') return null
  if (values.runtimeStateVersion !== undefined && typeof values.runtimeStateVersion !== 'string') return null
  return Object.freeze(values)
}

const validateResolverResult = (result) => {
  const baseKeys = ['stateVersion', 'source', 'canonicalStateVersion', 'compatibilityStateVersion']
  if (!hasExactDataKeys(result, baseKeys)) {
    if (!hasExactDataKeys(result, [...baseKeys, 'errorCode'])) return { kind: 'REDACTION' }

    const mixed = readValues(result, [...baseKeys, 'errorCode'])
    if (mixed.stateVersion !== ''
      || mixed.source !== 'mixed'
      || typeof mixed.canonicalStateVersion !== 'string'
      || mixed.canonicalStateVersion === ''
      || typeof mixed.compatibilityStateVersion !== 'string'
      || mixed.compatibilityStateVersion === ''
      || mixed.canonicalStateVersion === mixed.compatibilityStateVersion
      || mixed.errorCode !== 'RUNTIME_STATE_VERSION_MIXED') {
      return { kind: 'REDACTION' }
    }
    return { kind: 'MIXED' }
  }

  const values = readValues(result, baseKeys)
  if (!VERSION_SOURCES.has(values.source)
    || values.source === 'mixed'
    || typeof values.stateVersion !== 'string'
    || typeof values.canonicalStateVersion !== 'string'
    || typeof values.compatibilityStateVersion !== 'string') {
    return { kind: 'REDACTION' }
  }

  if (values.source === 'missing'
    && values.stateVersion === ''
    && values.canonicalStateVersion === ''
    && values.compatibilityStateVersion === '') {
    return { kind: 'READY', versionStatus: 'MISSING' }
  }

  if (values.source === 'compatibility_alias'
    && values.stateVersion !== ''
    && values.stateVersion === values.compatibilityStateVersion
    && values.canonicalStateVersion === '') {
    return { kind: 'READY', versionStatus: 'ALIAS_ONLY' }
  }

  if (values.source === 'canonical'
    && values.stateVersion !== ''
    && values.stateVersion === values.canonicalStateVersion
    && (values.compatibilityStateVersion === ''
      || values.compatibilityStateVersion === values.canonicalStateVersion)) {
    return { kind: 'READY', versionStatus: 'CANONICAL' }
  }

  return { kind: 'REDACTION' }
}

const validateCollections = (collections) => {
  if (!hasExactArray(collections, COLLECTION_ORDER.length)) return { kind: 'REDACTION' }

  const keys = ['bounded', 'countStatus', 'name', 'presence', 'scopedCount']
  const entries = []
  for (let index = 0; index < COLLECTION_ORDER.length; index += 1) {
    const entry = collections[index]
    if (!hasExactDataKeys(entry, keys)) return { kind: 'REDACTION' }
    entries.push(readValues(entry, keys))
  }

  const normalized = []
  for (let index = 0; index < COLLECTION_ORDER.length; index += 1) {
    const values = entries[index]
    if (values.bounded !== true
      || values.name !== COLLECTION_ORDER[index]
      || !COUNT_STATUSES.has(values.countStatus)
      || !PRESENCE_VALUES.has(values.presence)
      || !isSafeCount(values.scopedCount, 1001)) {
      return { kind: 'COLLECTION' }
    }

    if (values.presence === 'ABSENT'
      && (values.countStatus !== 'NOT_RUN_ABSENT' || values.scopedCount !== 0)) {
      return { kind: 'COLLECTION' }
    }

    if (values.presence === 'ABSENT') {
      normalized.push({ ...values })
      continue
    }

    if (values.presence === 'PRESENT' && values.countStatus === 'EXACT'
      && values.scopedCount <= 1000) {
      normalized.push({ ...values })
      continue
    }

    if (values.presence === 'PRESENT' && values.countStatus === 'CAP_EXCEEDED'
      && values.scopedCount === 1001) return { kind: 'COLLECTION' }

    if (values.presence === 'PRESENT' && values.countStatus === 'READ_FAILED'
      && values.scopedCount === 0) return { kind: 'COLLECTION' }

    return { kind: 'COLLECTION' }
  }

  return { kind: 'READY', value: normalized }
}

const validateExecution = (execution) => {
  const keys = [
    'monitorInstalledBeforeConnect',
    'monitorRemoved',
    'commandEventCount',
    'commandClasses',
    'cleanDisconnect',
  ]
  if (!hasExactDataKeys(execution, keys)) return { kind: 'REDACTION' }

  const values = readValues(execution, keys)
  if (!hasExactDataKeys(values.commandClasses, COMMAND_CLASS_KEYS)) return { kind: 'REDACTION' }
  const commandClasses = readValues(values.commandClasses, COMMAND_CLASS_KEYS)
  if (values.monitorInstalledBeforeConnect !== true
    || values.monitorRemoved !== true
    || values.cleanDisconnect !== true
    || !isSafeCount(values.commandEventCount, 64)
    || COMMAND_CLASS_KEYS.some((key) => !isSafeCount(commandClasses[key], 64))
    || COMMAND_CLASS_KEYS.reduce((sum, key) => sum + commandClasses[key], 0)
      !== values.commandEventCount) {
    return { kind: 'MONITOR' }
  }

  return {
    kind: 'READY',
    value: {
      monitorInstalledBeforeConnect: true,
      monitorRemoved: true,
      commandEventCount: values.commandEventCount,
      commandClasses: { ...commandClasses },
      cleanDisconnect: true,
    },
  }
}

const createReceipts = (collections) => RECEIPT_ORDER.map((operation, index) => {
  const outcome = index < 2
    ? 'READ'
    : collections[index - 2].presence === 'ABSENT' ? 'ABSENT' : 'READ'
  return { operation, outcome, bounded: true }
})

export const prepareRuntimeStateNativeReadPlanInput = (input) => {
  const outerKeys = ['scope', 'selector', 'stateVersionResolver', 'versionView', 'v2Collections', 'execution']
  if (!hasExactDataKeys(input, outerKeys)) return incomplete(ERROR_CODES.REDACTION_FAILED)

  const outer = readValues(input, outerKeys)
  const scope = validateScope(outer.scope)
  if (scope.kind === 'STRUCTURE') return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (scope.kind === 'VALUE' || (outer.selector !== 'ID' && outer.selector !== 'KEY')
    || outer.selector !== scope.selector) return incomplete(ERROR_CODES.SCOPE_INVALID)

  if (typeof outer.stateVersionResolver !== 'function') return incomplete(ERROR_CODES.REDACTION_FAILED)
  const versionView = validateVersionView(outer.versionView)
  if (!versionView) return incomplete(ERROR_CODES.REDACTION_FAILED)

  let resolverResult
  try {
    resolverResult = outer.stateVersionResolver(versionView)
  } catch {
    return incomplete(ERROR_CODES.REDACTION_FAILED)
  }

  const version = validateResolverResult(resolverResult)
  if (version.kind === 'REDACTION') return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (version.kind === 'MIXED') return incomplete(ERROR_CODES.STATE_VERSION_MIXED)

  const collections = validateCollections(outer.v2Collections)
  if (collections.kind === 'REDACTION') return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (collections.kind === 'COLLECTION') return incomplete(ERROR_CODES.COLLECTION_READ_UNAVAILABLE)

  const execution = validateExecution(outer.execution)
  if (execution.kind === 'REDACTION') return incomplete(ERROR_CODES.REDACTION_FAILED)
  if (execution.kind === 'MONITOR') return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)

  const observation = {
    rootState: {
      recordCount: 1,
      versionStatus: version.versionStatus,
      frameworkStateProjected: false,
    },
    v2Collections: collections.value,
    readReceipts: createReceipts(collections.value),
  }
  const planInput = {
    scope: scope.value,
    selector: scope.selector,
    observation,
    execution: execution.value,
  }

  return Object.freeze({ status: 'READY', planInput })
}
