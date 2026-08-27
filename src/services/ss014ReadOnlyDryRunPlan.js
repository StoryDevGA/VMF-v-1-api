import {
  SS014_PLAN_ALGORITHM,
  SS014_PLAN_HASH_STATUS,
  SS014_PLAN_COLLECTION_ORDER,
  SS014_PLAN_RECEIPT_ORDER,
  SS014_SOURCE_HASH_STATUS,
  serializeNormalizedPlan,
} from './ss014StablePlanSerializer.js'
import { reconcileSs014DryRunArtifact } from './ss014DryRunArtifactReconciler.js'

const ERROR_CODES = Object.freeze({
  SCOPE_INVALID: 'SS014_DRY_RUN_SCOPE_INVALID',
  REDACTION_FAILED: 'SS014_DRY_RUN_REDACTION_FAILED',
  FULL_STATE_BLOCKED: 'SS014_DRY_RUN_FULL_STATE_BLOCKED',
  COLLECTION_READ_UNAVAILABLE: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
  STATE_VERSION_MIXED: 'SS014_DRY_RUN_STATE_VERSION_MIXED',
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
})

const RUNTIME_ID_PATTERN = /^[0-9a-f]{24}$/
const RUNTIME_KEY_PATTERN = /^[a-z][a-z0-9-]{2,159}$/
const VERSION_STATUSES = new Set(['MISSING', 'ALIAS_ONLY', 'CANONICAL', 'MIXED'])
const PRESENCE_VALUES = new Set(['ABSENT', 'PRESENT'])
const COUNT_STATUSES = new Set(['NOT_RUN_ABSENT', 'EXACT', 'CAP_EXCEEDED'])
const COMMAND_CLASS_KEYS = ['setup', 'read', 'teardown']

const INCOMPLETE = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    return true
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
        && 'value' in descriptor
        && descriptor.enumerable === true
        && !descriptor.get
        && !descriptor.set)
    })
  } catch {
    return false
  }
}

const hasExactArray = (value, expectedLength) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false

  try {
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedLength + 1 || !ownKeys.includes('length')) return false
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || lengthDescriptor.value !== expectedLength
      || lengthDescriptor.enumerable !== false || lengthDescriptor.get || lengthDescriptor.set) {
      return false
    }

    for (let index = 0; index < expectedLength; index += 1) {
      const key = String(index)
      if (!ownKeys.includes(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true
        || descriptor.get || descriptor.set) return false
    }
    return true
  } catch {
    return false
  }
}

const hasForbiddenFrameworkStateKey = (value, seen = new Set()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)

  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'framework_state') return true
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && 'value' in descriptor
        && hasForbiddenFrameworkStateKey(descriptor.value, seen)) return true
    }
  } catch {
    return false
  }
  return false
}

const isSafeCount = (value, maximum = 1000) => (
  Number.isSafeInteger(value)
  && value >= 0
  && !Object.is(value, -0)
  && value <= maximum
)

const validateScope = (scope) => {
  const baseKeys = ['schemaVersion', 'environmentClass', 'customerId', 'tenantId']
  const hasRuntimeId = isPlainRecord(scope) && Object.prototype.hasOwnProperty.call(scope, 'runtimeId')
  const hasRuntimeKey = isPlainRecord(scope) && Object.prototype.hasOwnProperty.call(scope, 'runtimeKey')
  if (hasRuntimeId === hasRuntimeKey) return null

  const selector = hasRuntimeId ? 'ID' : 'KEY'
  const expectedKeys = [...baseKeys, hasRuntimeId ? 'runtimeId' : 'runtimeKey']
  if (!hasExactDataKeys(scope, expectedKeys)
    || scope.schemaVersion !== 'ss014-scope-v1'
    || scope.environmentClass !== 'DEVELOPMENT_TEST'
    || typeof scope.customerId !== 'string'
    || !RUNTIME_ID_PATTERN.test(scope.customerId)
    || typeof scope.tenantId !== 'string'
    || !RUNTIME_ID_PATTERN.test(scope.tenantId)) return null

  if (hasRuntimeId) {
    if (typeof scope.runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(scope.runtimeId)) return null
  } else if (typeof scope.runtimeKey !== 'string' || !RUNTIME_KEY_PATTERN.test(scope.runtimeKey)) {
    return null
  }

  return selector
}

const validateExecution = (execution) => {
  const executionKeys = [
    'monitorInstalledBeforeConnect',
    'monitorRemoved',
    'commandEventCount',
    'commandClasses',
    'cleanDisconnect',
  ]
  if (!hasExactDataKeys(execution, executionKeys)
    || execution.monitorInstalledBeforeConnect !== true
    || execution.monitorRemoved !== true
    || execution.cleanDisconnect !== true
    || !isSafeCount(execution.commandEventCount, 64)
    || !hasExactDataKeys(execution.commandClasses, COMMAND_CLASS_KEYS)) return false

  if (COMMAND_CLASS_KEYS.some((key) => !isSafeCount(execution.commandClasses[key], 64))) return false
  return COMMAND_CLASS_KEYS.reduce((sum, key) => sum + execution.commandClasses[key], 0)
    === execution.commandEventCount
}

const validateRootState = (rootState) => {
  if (!hasExactDataKeys(rootState, ['recordCount', 'versionStatus', 'frameworkStateProjected'])
    || rootState.recordCount !== 1
    || rootState.frameworkStateProjected !== false
    || !VERSION_STATUSES.has(rootState.versionStatus)) return null

  return {
    recordCount: 1,
    versionStatus: rootState.versionStatus,
    frameworkStateProjected: false,
  }
}

const validateCollections = (collections) => {
  if (!hasExactArray(collections, SS014_PLAN_COLLECTION_ORDER.length)) return null

  const normalized = []
  for (let index = 0; index < SS014_PLAN_COLLECTION_ORDER.length; index += 1) {
    const entry = collections[index]
    if (!hasExactDataKeys(entry, ['name', 'presence', 'scopedCount', 'countStatus', 'bounded'])
      || entry.name !== SS014_PLAN_COLLECTION_ORDER[index]
      || !PRESENCE_VALUES.has(entry.presence)
      || entry.bounded !== true
      || !COUNT_STATUSES.has(entry.countStatus)) return null

    if (entry.presence === 'ABSENT'
      && (entry.scopedCount !== 0 || entry.countStatus !== 'NOT_RUN_ABSENT')) return null
    if (entry.presence === 'PRESENT'
      && (entry.countStatus !== 'EXACT' || !isSafeCount(entry.scopedCount))) return null

    normalized.push({
      bounded: true,
      countStatus: entry.countStatus,
      name: entry.name,
      presence: entry.presence,
      scopedCount: entry.scopedCount,
    })
  }
  return normalized
}

const validateReceipts = (receipts, collections) => {
  if (!hasExactArray(receipts, SS014_PLAN_RECEIPT_ORDER.length)) return null

  const normalized = []
  for (let index = 0; index < SS014_PLAN_RECEIPT_ORDER.length; index += 1) {
    const entry = receipts[index]
    if (!hasExactDataKeys(entry, ['operation', 'outcome', 'bounded'])
      || entry.operation !== SS014_PLAN_RECEIPT_ORDER[index]
      || entry.bounded !== true) return null

    const expectedOutcome = index < 2
      ? 'READ'
      : collections[index - 2].presence === 'ABSENT' ? 'ABSENT' : 'READ'
    if (entry.outcome !== expectedOutcome) return null

    normalized.push({ bounded: true, operation: entry.operation, outcome: entry.outcome })
  }
  return normalized
}

const validateObservation = (observation) => {
  if (!hasExactDataKeys(observation, ['rootState', 'v2Collections', 'readReceipts'])) {
    return { errorCode: ERROR_CODES.REDACTION_FAILED }
  }
  if (!hasExactDataKeys(observation.rootState, ['recordCount', 'versionStatus', 'frameworkStateProjected'])) {
    return { errorCode: ERROR_CODES.REDACTION_FAILED }
  }

  const rootState = validateRootState(observation.rootState)
  if (!rootState) return { errorCode: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }

  const v2Collections = validateCollections(observation.v2Collections)
  if (!v2Collections) return { errorCode: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }

  const readReceipts = validateReceipts(observation.readReceipts, v2Collections)
  if (!readReceipts) return { errorCode: ERROR_CODES.COLLECTION_READ_UNAVAILABLE }

  if (rootState.versionStatus === 'MIXED') {
    return { errorCode: ERROR_CODES.STATE_VERSION_MIXED }
  }

  return { rootState, v2Collections, readReceipts }
}

const buildPlan = ({ rootState, v2Collections, readReceipts }) => ({
  environmentClass: 'DEVELOPMENT_TEST',
  scopeClass: 'EXACT_SINGLE_RUNTIME',
  rootState,
  v2Collections,
  blockers: rootState.versionStatus === 'MISSING' || rootState.versionStatus === 'ALIAS_ONLY'
    ? [{ code: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED', severity: 'BLOCKER' }]
    : [],
  readReceipts,
  hashStatus: {
    algorithm: SS014_PLAN_ALGORITHM,
    planHashStatus: SS014_PLAN_HASH_STATUS,
    sourceHashStatus: SS014_SOURCE_HASH_STATUS,
  },
})

export const runSs014ReadOnlyDryRunPlan = (input) => {
  try {
    if (hasForbiddenFrameworkStateKey(input)) return INCOMPLETE(ERROR_CODES.FULL_STATE_BLOCKED)
    if (!hasExactDataKeys(input, ['scope', 'observation', 'execution', 'selector'])) {
      return INCOMPLETE(ERROR_CODES.REDACTION_FAILED)
    }

    const selector = validateScope(input.scope)
    if (!selector || input.selector !== selector) return INCOMPLETE(ERROR_CODES.SCOPE_INVALID)
    if (!validateExecution(input.execution)) return INCOMPLETE(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)

    const observation = validateObservation(input.observation)
    if (observation.errorCode) return INCOMPLETE(observation.errorCode)

    const plan = buildPlan(observation)
    const outcome = observation.rootState.versionStatus === 'MISSING'
      || observation.rootState.versionStatus === 'ALIAS_ONLY'
      ? 'BLOCKED'
      : 'READY_FOR_BASELINE_REVIEW'

    return reconcileSs014DryRunArtifact({
      normalizedPlan: plan,
      outcome,
      selector,
      execution: input.execution,
      planSerializer: serializeNormalizedPlan,
      artifactSizer: (canonicalJson) => Buffer.byteLength(canonicalJson, 'utf8'),
    })
  } catch {
    return INCOMPLETE(ERROR_CODES.REDACTION_FAILED)
  }
}
