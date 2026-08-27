import { createHash } from 'node:crypto'

export const SS014_PLAN_ALGORITHM = 'stable-json-v1/sha256-utf8-lowerhex'
export const SS014_PLAN_HASH_STATUS = 'PROVISIONAL_NOT_APPLY_AUTHORITY'
export const SS014_SOURCE_HASH_STATUS = 'NOT_COMPUTED_BASELINE_MAPPING_REQUIRED'

export const SS014_PLAN_ERROR_CODES = Object.freeze({
  REDACTION_FAILED: 'SS014_DRY_RUN_REDACTION_FAILED',
  PLAN_DRIFT: 'SS014_DRY_RUN_PLAN_DRIFT',
})

export const SS014_PLAN_COLLECTION_ORDER = Object.freeze([
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
])

export const SS014_PLAN_RECEIPT_ORDER = Object.freeze([
  'ROOT_CONTROL_FIND',
  'COLLECTION_LIST',
  'SECTIONS_FIND',
  'EVIDENCE_SOURCES_FIND',
  'EVIDENCE_OBJECTS_FIND',
  'GRAPH_SNAPSHOTS_FIND',
  'GRAPH_ELEMENTS_FIND',
])

const VERSION_STATUSES = new Set(['MISSING', 'ALIAS_ONLY', 'CANONICAL', 'MIXED'])
const PRESENCE_VALUES = new Set(['ABSENT', 'PRESENT'])
const COUNT_STATUSES = new Set(['NOT_RUN_ABSENT', 'EXACT', 'CAP_EXCEEDED', 'READ_FAILED'])
const RECEIPT_OUTCOMES = new Set(['READ', 'ABSENT', 'BLOCKED', 'FAILED', 'CAP_EXCEEDED'])
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

const TOP_LEVEL_KEYS = [
  'environmentClass',
  'scopeClass',
  'rootState',
  'v2Collections',
  'blockers',
  'readReceipts',
  'hashStatus',
]

const ROOT_KEYS = ['recordCount', 'versionStatus', 'frameworkStateProjected']
const V2_KEYS = ['name', 'presence', 'scopedCount', 'countStatus', 'bounded']
const BLOCKER_KEYS = ['code', 'severity']
const RECEIPT_KEYS = ['operation', 'outcome', 'bounded']
const HASH_STATUS_KEYS = ['algorithm', 'planHashStatus', 'sourceHashStatus']

const createPlanError = (code, cause) => {
  const error = new Error(code)
  error.code = code
  if (cause) error.cause = cause
  return error
}

const fail = (message, cause) => {
  throw createPlanError(SS014_PLAN_ERROR_CODES.REDACTION_FAILED, cause || message)
}

const getOwnKeys = (value) => {
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) fail('Symbols are not accepted.')
    return Object.getOwnPropertyNames(value)
  } catch (error) {
    if (error?.code === SS014_PLAN_ERROR_CODES.REDACTION_FAILED) throw error
    fail('Reflective inspection failed.', error)
  }
}

const assertPlainObject = (value, expectedKeys) => {
  if (value === null || typeof value !== 'object') fail('Expected a plain object.')

  try {
    if (Array.isArray(value)) fail('Expected a plain object.')
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) fail('Unexpected object prototype.')
    const ownKeys = getOwnKeys(value)
    if (ownKeys.length !== expectedKeys.length || expectedKeys.some((key) => !ownKeys.includes(key))) {
      fail('Unexpected object keys.')
    }
    expectedKeys.forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true || descriptor.writable !== true
        || descriptor.configurable !== true) {
        fail('Unexpected property descriptor.')
      }
    })
  } catch (error) {
    if (error?.code === SS014_PLAN_ERROR_CODES.REDACTION_FAILED) throw error
    fail('Reflective inspection failed.', error)
  }
}

const assertArray = (value, expectedLength) => {
  if (value === null || typeof value !== 'object') fail('Expected an array.')
  try {
    if (!Array.isArray(value)) fail('Expected an array.')
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length !== expectedLength) {
      fail('Unexpected array shape.')
    }
    if (Object.getOwnPropertySymbols(value).length > 0) fail('Array symbols are not accepted.')
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedLength + 1 || !ownKeys.includes('length')) fail('Unexpected array properties.')
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.value !== expectedLength
      || lengthDescriptor.enumerable !== false || lengthDescriptor.writable !== true
      || lengthDescriptor.configurable !== false) {
      fail('Unexpected array length descriptor.')
    }
    for (let index = 0; index < expectedLength; index += 1) {
      const key = String(index)
      if (!ownKeys.includes(key)) fail('Sparse arrays are not accepted.')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true || descriptor.writable !== true
        || descriptor.configurable !== true) {
        fail('Unexpected array index descriptor.')
      }
    }
  } catch (error) {
    if (error?.code === SS014_PLAN_ERROR_CODES.REDACTION_FAILED) throw error
    fail('Reflective inspection failed.', error)
  }
}

const assertSafeInteger = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('Unsafe numeric value.')
}

const assertString = (value) => {
  if (typeof value !== 'string') fail('Expected a string.')
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) fail('Unpaired high surrogate.')
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      fail('Unpaired low surrogate.')
    }
  }
}

const assertBoolean = (value) => {
  if (typeof value !== 'boolean') fail('Expected a boolean.')
}

const compareUnicodeScalars = (left, right) => {
  const leftScalars = Array.from(left, (character) => character.codePointAt(0))
  const rightScalars = Array.from(right, (character) => character.codePointAt(0))
  const length = Math.min(leftScalars.length, rightScalars.length)
  for (let index = 0; index < length; index += 1) {
    if (leftScalars[index] !== rightScalars[index]) return leftScalars[index] - rightScalars[index]
  }
  return leftScalars.length - rightScalars.length
}

const assertEnum = (value, values) => {
  assertString(value)
  if (!values.has(value)) fail('Unexpected enum value.')
}

const validateRootState = (value) => {
  assertPlainObject(value, ROOT_KEYS)
  assertSafeInteger(value.recordCount)
  if (value.recordCount !== 1) fail('Normalized plans require one root record.')
  assertEnum(value.versionStatus, VERSION_STATUSES)
  if (value.frameworkStateProjected !== false) fail('Full framework state is not permitted.')
  return {
    frameworkStateProjected: false,
    recordCount: value.recordCount,
    versionStatus: value.versionStatus,
  }
}

const validateV2Collections = (value) => {
  assertArray(value, SS014_PLAN_COLLECTION_ORDER.length)
  return value.map((entry, index) => {
    assertPlainObject(entry, V2_KEYS)
    if (entry.name !== SS014_PLAN_COLLECTION_ORDER[index]) fail('Unexpected logical collection order.')
    assertEnum(entry.presence, PRESENCE_VALUES)
    assertSafeInteger(entry.scopedCount)
    if (entry.scopedCount > 1001) fail('Collection count cap exceeded.')
    assertEnum(entry.countStatus, COUNT_STATUSES)
    if (entry.bounded !== true) fail('Unbounded collection read.')
    if (entry.presence === 'ABSENT'
      && (entry.scopedCount !== 0 || entry.countStatus !== 'NOT_RUN_ABSENT')) {
      fail('Absent collection state is contradictory.')
    }
    if (entry.presence === 'PRESENT' && entry.countStatus === 'NOT_RUN_ABSENT') {
      fail('Present collection state is contradictory.')
    }
    if (entry.countStatus === 'EXACT' && entry.scopedCount > 1000) fail('Exact count exceeds cap.')
    if (entry.countStatus === 'CAP_EXCEEDED' && entry.scopedCount !== 1001) fail('Cap count is not 1001.')
    if (entry.countStatus === 'READ_FAILED' && entry.scopedCount !== 0) fail('Failed count must be zero.')
    return {
      bounded: true,
      countStatus: entry.countStatus,
      name: entry.name,
      presence: entry.presence,
      scopedCount: entry.scopedCount,
    }
  })
}

const validateBlockers = (value) => {
  if (value === null || typeof value !== 'object') fail('Expected a blockers array.')
  let blockerLength
  try {
    if (!Array.isArray(value)) fail('Expected a blockers array.')
    blockerLength = value.length
  } catch (error) {
    if (error?.code === SS014_PLAN_ERROR_CODES.REDACTION_FAILED) throw error
    fail('Reflective inspection failed.', error)
  }
  assertArray(value, blockerLength)
  if (value.length > FAILURE_CODES.size) fail('Too many blockers.')
  const blockers = value.map((entry) => {
    assertPlainObject(entry, BLOCKER_KEYS)
    assertString(entry.code)
    if (!FAILURE_CODES.has(entry.code)) fail('Unexpected blocker code.')
    if (entry.severity !== 'BLOCKER') fail('Unexpected blocker severity.')
    return { code: entry.code, severity: entry.severity }
  })
  const sorted = [...blockers].sort((left, right) => (
    compareUnicodeScalars(left.code, right.code)
      || compareUnicodeScalars(left.severity, right.severity)
  ))
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].code === sorted[index].code
      && sorted[index - 1].severity === sorted[index].severity) {
      fail('Duplicate blocker.')
    }
  }
  return sorted
}

const validateReceipts = (value, collections) => {
  assertArray(value, SS014_PLAN_RECEIPT_ORDER.length)
  return value.map((entry, index) => {
    assertPlainObject(entry, RECEIPT_KEYS)
    if (entry.operation !== SS014_PLAN_RECEIPT_ORDER[index]) fail('Unexpected receipt order.')
    assertEnum(entry.outcome, RECEIPT_OUTCOMES)
    if (entry.bounded !== true) fail('Unbounded receipt.')
    if (index < 2 && entry.outcome !== 'READ') fail('Root receipts must be read.')
    if (index >= 2) {
      const collection = collections[index - 2]
      const expectedOutcome = collection.presence === 'ABSENT'
        ? 'ABSENT'
        : collection.countStatus === 'EXACT'
          ? 'READ'
          : collection.countStatus === 'CAP_EXCEEDED'
            ? 'CAP_EXCEEDED'
            : 'FAILED'
      if (entry.outcome !== expectedOutcome) fail('Receipt and collection state disagree.')
    }
    return { bounded: true, operation: entry.operation, outcome: entry.outcome }
  })
}

const validateHashStatus = (value) => {
  assertPlainObject(value, HASH_STATUS_KEYS)
  if (value.algorithm !== SS014_PLAN_ALGORITHM
    || value.planHashStatus !== SS014_PLAN_HASH_STATUS
    || value.sourceHashStatus !== SS014_SOURCE_HASH_STATUS) {
    fail('Unexpected hash authority status.')
  }
  return {
    algorithm: SS014_PLAN_ALGORITHM,
    planHashStatus: SS014_PLAN_HASH_STATUS,
    sourceHashStatus: SS014_SOURCE_HASH_STATUS,
  }
}

const validatePlan = (plan) => {
  assertPlainObject(plan, TOP_LEVEL_KEYS)
  assertString(plan.environmentClass)
  if (plan.environmentClass !== 'DEVELOPMENT_TEST') fail('Unexpected environment class.')
  assertString(plan.scopeClass)
  if (plan.scopeClass !== 'EXACT_SINGLE_RUNTIME') fail('Unexpected scope class.')
  const rootState = validateRootState(plan.rootState)
  const v2Collections = validateV2Collections(plan.v2Collections)
  const blockers = validateBlockers(plan.blockers)
  const readReceipts = validateReceipts(plan.readReceipts, v2Collections)
  const hashStatus = validateHashStatus(plan.hashStatus)
  return {
    blockers,
    environmentClass: 'DEVELOPMENT_TEST',
    hashStatus,
    readReceipts,
    rootState,
    scopeClass: 'EXACT_SINGLE_RUNTIME',
    v2Collections,
  }
}

const escapeJsonString = (value) => {
  assertString(value)
  let escaped = '"'
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const codeUnit = value.charCodeAt(index)
    if (character === '"') escaped += '\\"'
    else if (character === '\\') escaped += '\\\\'
    else if (codeUnit === 0x08) escaped += '\\b'
    else if (codeUnit === 0x09) escaped += '\\t'
    else if (codeUnit === 0x0A) escaped += '\\n'
    else if (codeUnit === 0x0C) escaped += '\\f'
    else if (codeUnit === 0x0D) escaped += '\\r'
    else if (codeUnit <= 0x1F) escaped += `\\u${codeUnit.toString(16).padStart(4, '0')}`
    else escaped += character
  }
  return `${escaped}"`
}

const stableStringify = (value) => {
  if (value === null) return 'null'
  if (typeof value === 'string') return escapeJsonString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    assertSafeInteger(value)
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort(compareUnicodeScalars)
  return `{${keys.map((key) => `${escapeJsonString(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export const serializeNormalizedPlan = (plan) => {
  let normalizedPlan
  try {
    normalizedPlan = validatePlan(plan)
  } catch (error) {
    if (error?.code === SS014_PLAN_ERROR_CODES.REDACTION_FAILED) throw error
    throw createPlanError(SS014_PLAN_ERROR_CODES.PLAN_DRIFT, error)
  }
  const canonicalJson = stableStringify(normalizedPlan)
  const planHash = createHash('sha256').update(Buffer.from(canonicalJson, 'utf8')).digest('hex')
  return {
    algorithm: SS014_PLAN_ALGORITHM,
    canonicalJson,
    planHash,
    planHashStatus: SS014_PLAN_HASH_STATUS,
  }
}

export const SS014_PLAN_FAILURE_CODES = Object.freeze([...FAILURE_CODES])
