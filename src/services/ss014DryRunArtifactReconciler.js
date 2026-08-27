import { createHash } from 'node:crypto'

const ALGORITHM = 'stable-json-v1/sha256-utf8-lowerhex'
const PLAN_HASH_STATUS = 'PROVISIONAL_NOT_APPLY_AUTHORITY'
const SOURCE_HASH_STATUS = 'NOT_COMPUTED_BASELINE_MAPPING_REQUIRED'
const MAX_ARTIFACT_BYTES = 262144

const COLLECTION_ORDER = Object.freeze([
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
])

const RECEIPT_ORDER = Object.freeze([
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
const EXECUTION_KEYS = [
  'monitorInstalledBeforeConnect',
  'monitorRemoved',
  'commandEventCount',
  'commandClasses',
  'cleanDisconnect',
]
const COMMAND_CLASS_KEYS = ['setup', 'read', 'teardown']
const INPUT_KEYS = [
  'normalizedPlan',
  'outcome',
  'selector',
  'execution',
  'planSerializer',
  'artifactSizer',
]

class ReconcileFailure extends Error {
  constructor(kind) {
    super(kind)
    this.kind = kind
  }
}

const redactionFailure = () => {
  throw new ReconcileFailure('REDACTION')
}

const driftFailure = () => {
  throw new ReconcileFailure('DRIFT')
}

const sizeFailure = () => {
  throw new ReconcileFailure('SIZE')
}

const mixedFailure = () => {
  throw new ReconcileFailure('MIXED')
}

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const getOwnKeys = (value) => {
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) redactionFailure()
    return Object.getOwnPropertyNames(value)
  } catch (error) {
    if (error instanceof ReconcileFailure) throw error
    redactionFailure()
  }
}

const assertPlainRecord = (value, expectedKeys, allowFrozen = false) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) redactionFailure()
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) redactionFailure()
    const ownKeys = getOwnKeys(value)
    if (ownKeys.length !== expectedKeys.length || expectedKeys.some((key) => !ownKeys.includes(key))) {
      redactionFailure()
    }
    expectedKeys.forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true
        || (!allowFrozen && (descriptor.writable !== true || descriptor.configurable !== true))) {
        redactionFailure()
      }
    })
  } catch (error) {
    if (error instanceof ReconcileFailure) throw error
    redactionFailure()
  }
}

const assertArray = (value, expectedLength, allowFrozen = false) => {
  if (value === null || typeof value !== 'object' || !Array.isArray(value)) redactionFailure()
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length !== expectedLength) redactionFailure()
    if (Object.getOwnPropertySymbols(value).length > 0) redactionFailure()
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedLength + 1 || !ownKeys.includes('length')) redactionFailure()
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || !('value' in lengthDescriptor)
      || lengthDescriptor.value !== expectedLength || lengthDescriptor.enumerable !== false
      || lengthDescriptor.configurable !== false
      || (!allowFrozen && lengthDescriptor.writable !== true)) {
      redactionFailure()
    }
    for (let index = 0; index < expectedLength; index += 1) {
      const key = String(index)
      if (!ownKeys.includes(key)) redactionFailure()
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true
        || (!allowFrozen && (descriptor.writable !== true || descriptor.configurable !== true))) {
        redactionFailure()
      }
    }
  } catch (error) {
    if (error instanceof ReconcileFailure) throw error
    redactionFailure()
  }
}

const assertSafeInteger = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) redactionFailure()
}

const assertString = (value) => {
  if (typeof value !== 'string') redactionFailure()
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) redactionFailure()
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      redactionFailure()
    }
  }
}

const assertBoolean = (value) => {
  if (typeof value !== 'boolean') redactionFailure()
}

const assertEnum = (value, values) => {
  assertString(value)
  if (!values.has(value)) redactionFailure()
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

const validateRootState = (value, allowFrozen) => {
  assertPlainRecord(value, ROOT_KEYS, allowFrozen)
  assertSafeInteger(value.recordCount)
  if (value.recordCount !== 1) redactionFailure()
  assertEnum(value.versionStatus, VERSION_STATUSES)
  if (value.frameworkStateProjected !== false) redactionFailure()
  return {
    frameworkStateProjected: false,
    recordCount: value.recordCount,
    versionStatus: value.versionStatus,
  }
}

const validateV2Collections = (value, allowFrozen) => {
  assertArray(value, COLLECTION_ORDER.length, allowFrozen)
  return value.map((entry, index) => {
    assertPlainRecord(entry, V2_KEYS, allowFrozen)
    if (entry.name !== COLLECTION_ORDER[index]) redactionFailure()
    assertEnum(entry.presence, PRESENCE_VALUES)
    assertSafeInteger(entry.scopedCount)
    if (entry.scopedCount > 1001) redactionFailure()
    assertEnum(entry.countStatus, COUNT_STATUSES)
    if (entry.bounded !== true) redactionFailure()
    if (entry.presence === 'ABSENT'
      && (entry.scopedCount !== 0 || entry.countStatus !== 'NOT_RUN_ABSENT')) redactionFailure()
    if (entry.presence === 'PRESENT' && entry.countStatus === 'NOT_RUN_ABSENT') redactionFailure()
    if (entry.countStatus === 'EXACT' && entry.scopedCount > 1000) redactionFailure()
    if (entry.countStatus === 'CAP_EXCEEDED' && entry.scopedCount !== 1001) redactionFailure()
    if (entry.countStatus === 'READ_FAILED' && entry.scopedCount !== 0) redactionFailure()
    return {
      bounded: true,
      countStatus: entry.countStatus,
      name: entry.name,
      presence: entry.presence,
      scopedCount: entry.scopedCount,
    }
  })
}

const validateBlockers = (value, allowFrozen) => {
  if (!Array.isArray(value)) redactionFailure()
  assertArray(value, value.length, allowFrozen)
  if (value.length > FAILURE_CODES.size) redactionFailure()
  const blockers = value.map((entry) => {
    assertPlainRecord(entry, BLOCKER_KEYS, allowFrozen)
    assertString(entry.code)
    if (!FAILURE_CODES.has(entry.code) || entry.severity !== 'BLOCKER') redactionFailure()
    return { code: entry.code, severity: entry.severity }
  })
  const sorted = [...blockers].sort((left, right) => (
    compareUnicodeScalars(left.code, right.code)
      || compareUnicodeScalars(left.severity, right.severity)
  ))
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].code === sorted[index].code
      && sorted[index - 1].severity === sorted[index].severity) redactionFailure()
  }
  return sorted
}

const validateReceipts = (value, collections, allowFrozen) => {
  assertArray(value, RECEIPT_ORDER.length, allowFrozen)
  return value.map((entry, index) => {
    assertPlainRecord(entry, RECEIPT_KEYS, allowFrozen)
    if (entry.operation !== RECEIPT_ORDER[index]) redactionFailure()
    assertEnum(entry.outcome, RECEIPT_OUTCOMES)
    if (entry.bounded !== true) redactionFailure()
    if (index < 2 && entry.outcome !== 'READ') redactionFailure()
    if (index >= 2) {
      const collection = collections[index - 2]
      const expectedOutcome = collection.presence === 'ABSENT'
        ? 'ABSENT'
        : collection.countStatus === 'EXACT'
          ? 'READ'
          : collection.countStatus === 'CAP_EXCEEDED'
            ? 'CAP_EXCEEDED'
            : 'FAILED'
      if (entry.outcome !== expectedOutcome) redactionFailure()
    }
    return { bounded: true, operation: entry.operation, outcome: entry.outcome }
  })
}

const validateHashStatus = (value, allowFrozen) => {
  assertPlainRecord(value, HASH_STATUS_KEYS, allowFrozen)
  if (value.algorithm !== ALGORITHM
    || value.planHashStatus !== PLAN_HASH_STATUS
    || value.sourceHashStatus !== SOURCE_HASH_STATUS) redactionFailure()
  return {
    algorithm: ALGORITHM,
    planHashStatus: PLAN_HASH_STATUS,
    sourceHashStatus: SOURCE_HASH_STATUS,
  }
}

const validatePlan = (value, allowFrozen = false) => {
  assertPlainRecord(value, TOP_LEVEL_KEYS, allowFrozen)
  assertString(value.environmentClass)
  if (value.environmentClass !== 'DEVELOPMENT_TEST') redactionFailure()
  assertString(value.scopeClass)
  if (value.scopeClass !== 'EXACT_SINGLE_RUNTIME') redactionFailure()
  const rootState = validateRootState(value.rootState, allowFrozen)
  const v2Collections = validateV2Collections(value.v2Collections, allowFrozen)
  const blockers = validateBlockers(value.blockers, allowFrozen)
  const readReceipts = validateReceipts(value.readReceipts, v2Collections, allowFrozen)
  const hashStatus = validateHashStatus(value.hashStatus, allowFrozen)
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
  if (value === null || typeof value !== 'object') redactionFailure()
  const keys = Object.keys(value).sort(compareUnicodeScalars)
  return `{${keys.map((key) => `${escapeJsonString(key)}:${stableStringify(value[key])}`).join(',')}}`
}

const hashCanonicalJson = (canonicalJson) => createHash('sha256')
  .update(Buffer.from(canonicalJson, 'utf8'))
  .digest('hex')

const clonePlan = (value, allowFrozen = false) => validatePlan(value, allowFrozen)

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]))
    Object.freeze(value)
  }
  return value
}

const validateExecution = (value) => {
  assertPlainRecord(value, EXECUTION_KEYS)
  assertBoolean(value.monitorInstalledBeforeConnect)
  assertBoolean(value.monitorRemoved)
  assertSafeInteger(value.commandEventCount)
  if (value.monitorInstalledBeforeConnect !== true
    || value.monitorRemoved !== true
    || value.cleanDisconnect !== true
    || value.commandEventCount > 64) redactionFailure()
  assertPlainRecord(value.commandClasses, COMMAND_CLASS_KEYS)
  COMMAND_CLASS_KEYS.forEach((key) => assertSafeInteger(value.commandClasses[key]))
  if (COMMAND_CLASS_KEYS.some((key) => value.commandClasses[key] > 64)
    || value.commandClasses.setup + value.commandClasses.read + value.commandClasses.teardown
      !== value.commandEventCount) redactionFailure()
  return {
    monitorInstalledBeforeConnect: true,
    monitorRemoved: true,
    commandEventCount: value.commandEventCount,
    commandClasses: {
      setup: value.commandClasses.setup,
      read: value.commandClasses.read,
      teardown: value.commandClasses.teardown,
    },
    cleanDisconnect: true,
  }
}

const assertSerializerResult = (value, expected) => {
  try {
    assertPlainRecord(value, ['algorithm', 'canonicalJson', 'planHash', 'planHashStatus'])
    assertString(value.algorithm)
    assertString(value.canonicalJson)
    assertString(value.planHash)
    assertString(value.planHashStatus)
    if (value.algorithm !== ALGORITHM || value.canonicalJson !== expected.canonicalJson
      || value.planHash !== expected.planHash || value.planHashStatus !== PLAN_HASH_STATUS) {
      driftFailure()
    }
  } catch (error) {
    if (error instanceof ReconcileFailure) throw error
    redactionFailure()
  }
}

const serializeArtifactEnvelope = (artifact, planCanonicalJson) => {
  const scope = artifact.scopeBinding
  const execution = artifact.execution
  const classes = execution.commandClasses
  return `{"schemaVersion":${escapeJsonString(artifact.schemaVersion)},"outcome":${escapeJsonString(artifact.outcome)},"environmentClass":${escapeJsonString(artifact.environmentClass)},"scopeBinding":{"customer":${escapeJsonString(scope.customer)},"tenant":${escapeJsonString(scope.tenant)},"runtime":${escapeJsonString(scope.runtime)},"selector":${escapeJsonString(scope.selector)}},"plan":${planCanonicalJson},"planHash":${escapeJsonString(artifact.planHash)},"execution":{"monitorInstalledBeforeConnect":true,"monitorRemoved":true,"commandEventCount":${execution.commandEventCount},"commandClasses":{"setup":${classes.setup},"read":${classes.read},"teardown":${classes.teardown}},"cleanDisconnect":true}}`
}

const validateInput = (input) => {
  assertPlainRecord(input, INPUT_KEYS)
  if (!['BLOCKED', 'READY_FOR_BASELINE_REVIEW'].includes(input.outcome)
    || !['ID', 'KEY'].includes(input.selector)
    || typeof input.planSerializer !== 'function'
    || typeof input.artifactSizer !== 'function') redactionFailure()
}

export const reconcileSs014DryRunArtifact = (input) => {
  try {
    validateInput(input)
    const sourcePlan = clonePlan(input.normalizedPlan)
    const execution = validateExecution(input.execution)

    if (sourcePlan.rootState.versionStatus === 'MIXED') mixedFailure()
    const isBlocked = sourcePlan.rootState.versionStatus === 'MISSING'
      || sourcePlan.rootState.versionStatus === 'ALIAS_ONLY'
    const expectedBlocker = { code: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED', severity: 'BLOCKER' }
    const hasOnlyBaselineBlocker = sourcePlan.blockers.length === 1
      && sourcePlan.blockers[0].code === expectedBlocker.code
      && sourcePlan.blockers[0].severity === expectedBlocker.severity
    if ((isBlocked && (input.outcome !== 'BLOCKED' || !hasOnlyBaselineBlocker))
      || (!isBlocked && (input.outcome !== 'READY_FOR_BASELINE_REVIEW' || sourcePlan.blockers.length !== 0))) {
      redactionFailure()
    }

    const firstPlan = clonePlan(sourcePlan)
    const firstCanonicalJson = stableStringify(firstPlan)
    const expectedPlanResult = {
      algorithm: ALGORITHM,
      canonicalJson: firstCanonicalJson,
      planHash: hashCanonicalJson(firstCanonicalJson),
      planHashStatus: PLAN_HASH_STATUS,
    }
    const artifact = deepFreeze({
      schemaVersion: 'ss014-dry-run-artifact-v1',
      outcome: input.outcome,
      environmentClass: 'DEVELOPMENT_TEST',
      scopeBinding: {
        customer: 'REDACTED',
        tenant: 'REDACTED',
        runtime: 'REDACTED',
        selector: input.selector,
      },
      plan: firstPlan,
      planHash: expectedPlanResult.planHash,
      execution: deepFreeze(execution),
    })

    const serializerFirstPlan = clonePlan(artifact.plan, true)
    let firstResult
    try {
      firstResult = input.planSerializer(serializerFirstPlan)
    } catch (error) {
      redactionFailure()
    }
    assertSerializerResult(firstResult, expectedPlanResult)

    const secondPlan = clonePlan(artifact.plan, true)
    const secondCanonicalJson = stableStringify(secondPlan)
    if (secondCanonicalJson !== firstCanonicalJson) driftFailure()
    let secondResult
    try {
      secondResult = input.planSerializer(clonePlan(secondPlan))
    } catch (error) {
      redactionFailure()
    }
    assertSerializerResult(secondResult, expectedPlanResult)

    const recomputedHash = hashCanonicalJson(secondCanonicalJson)
    if (recomputedHash !== expectedPlanResult.planHash
      || recomputedHash !== firstResult.planHash
      || recomputedHash !== secondResult.planHash) driftFailure()

    const finalArtifact = deepFreeze({
      schemaVersion: artifact.schemaVersion,
      outcome: artifact.outcome,
      environmentClass: artifact.environmentClass,
      scopeBinding: {
        customer: artifact.scopeBinding.customer,
        tenant: artifact.scopeBinding.tenant,
        runtime: artifact.scopeBinding.runtime,
        selector: artifact.scopeBinding.selector,
      },
      plan: clonePlan(secondPlan),
      planHash: recomputedHash,
      execution: {
        monitorInstalledBeforeConnect: artifact.execution.monitorInstalledBeforeConnect,
        monitorRemoved: artifact.execution.monitorRemoved,
        commandEventCount: artifact.execution.commandEventCount,
        commandClasses: {
          setup: artifact.execution.commandClasses.setup,
          read: artifact.execution.commandClasses.read,
          teardown: artifact.execution.commandClasses.teardown,
        },
        cleanDisconnect: artifact.execution.cleanDisconnect,
      },
    })
    const canonicalArtifactJson = serializeArtifactEnvelope(finalArtifact, secondCanonicalJson)
    let reportedBytes
    try {
      reportedBytes = input.artifactSizer(canonicalArtifactJson)
    } catch (error) {
      sizeFailure()
    }
    if (!Number.isSafeInteger(reportedBytes) || reportedBytes < 0 || Object.is(reportedBytes, -0)) {
      sizeFailure()
    }
    const actualBytes = Buffer.byteLength(canonicalArtifactJson, 'utf8')
    if (reportedBytes !== actualBytes || actualBytes > MAX_ARTIFACT_BYTES) sizeFailure()
    return finalArtifact
  } catch (error) {
    if (!(error instanceof ReconcileFailure)) return incomplete('SS014_DRY_RUN_REDACTION_FAILED')
    if (error.kind === 'MIXED') return incomplete('SS014_DRY_RUN_STATE_VERSION_MIXED')
    if (error.kind === 'DRIFT') return incomplete('SS014_DRY_RUN_PLAN_DRIFT')
    if (error.kind === 'SIZE') return incomplete('SS014_DRY_RUN_SIZE_CAP_EXCEEDED')
    return incomplete('SS014_DRY_RUN_REDACTION_FAILED')
  }
}
