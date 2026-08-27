const COLLECTION_NAMES = new Set([
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
])

const INPUT_KEYS = [
  'bounded',
  'countStatus',
  'name',
  'presence',
  'scopedCount',
]

const INCOMPLETE_COLLECTION_READ = Object.freeze({
  status: 'INCOMPLETE',
  errorCode: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
  plan: null,
  planHash: null,
})

const REDACTION_FAILURE = Object.freeze({
  status: 'INCOMPLETE',
  errorCode: 'SS014_DRY_RUN_REDACTION_FAILED',
  plan: null,
  planHash: null,
})

const hasStrictDataShape = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false

    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== INPUT_KEYS.length
      || INPUT_KEYS.some((key) => !ownKeys.includes(key))) return false

    return INPUT_KEYS.every((key) => {
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

const readDataValues = (value) => INPUT_KEYS.reduce((values, key) => {
  values[key] = Object.getOwnPropertyDescriptor(value, key).value
  return values
}, {})

const isAdmissible = ({ bounded, countStatus, name, presence, scopedCount }) => {
  if (bounded !== true
    || !COLLECTION_NAMES.has(name)
    || (presence !== 'ABSENT' && presence !== 'PRESENT')
    || !Number.isSafeInteger(scopedCount)
    || scopedCount < 0) {
    return false
  }

  if (presence === 'ABSENT') {
    return countStatus === 'NOT_RUN_ABSENT' && scopedCount === 0
  }

  return countStatus === 'EXACT' && scopedCount <= 1000
}

export const resolveSs014NativeCollectionAdmission = (input) => {
  if (!hasStrictDataShape(input)) return REDACTION_FAILURE

  let values
  try {
    values = readDataValues(input)
  } catch {
    return REDACTION_FAILURE
  }

  if (!isAdmissible(values)) return INCOMPLETE_COLLECTION_READ

  const collection = Object.freeze({
    bounded: true,
    countStatus: values.countStatus,
    name: values.name,
    presence: values.presence,
    scopedCount: values.scopedCount,
  })

  return Object.freeze({
    status: 'READY',
    collection,
  })
}
