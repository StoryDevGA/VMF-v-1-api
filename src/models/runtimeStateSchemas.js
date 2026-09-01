import mongoose from 'mongoose'

export const RUNTIME_STATE_VERSION_PATTERN = /^rsv2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/

const FORBIDDEN_SAFE_JSON_KEYS = new Set([
  '__proto__',
  'body',
  'constructor',
  'content',
  'framework_state',
  'prototype',
  'raw',
  'rawtext',
  'sourcetext',
  'text',
])

const compareUnicodeScalars = (left, right) => {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0))
  const rightPoints = Array.from(right, (value) => value.codePointAt(0))
  const sharedLength = Math.min(leftPoints.length, rightPoints.length)

  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index]
    }
  }

  return leftPoints.length - rightPoints.length
}

const hasOnlyDataProperties = (value, keys) => keys.every((key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor?.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    && descriptor.get === undefined
    && descriptor.set === undefined
})

export const isValidUnicodeScalarString = (value, maxScalars = Number.POSITIVE_INFINITY) => {
  if (typeof value !== 'string') return false
  let scalarCount = 0

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }

    scalarCount += 1
    if (scalarCount > maxScalars) return false
  }

  return true
}

export const isBoundedSafeJson = (value, {
  maxDepth,
  maxEntries,
  maxBytes,
  maxStringScalars = 8000,
  rootAllowedKeys,
  rootForbiddenKeys = [],
  forbiddenKeys = [],
  allowedForbiddenKeys = [],
  validateSpecialValue = () => true,
}) => {
  try {
    structuredClone(value)
  } catch {
    return false
  }

  const seen = new WeakSet()
  const forbiddenRootKeys = new Set(rootForbiddenKeys.map((key) => key.toLowerCase()))
  const additionalForbiddenKeys = new Set(forbiddenKeys.map((key) => key.toLowerCase()))
  const allowedGenericForbiddenKeys = new Set(allowedForbiddenKeys.map((key) => key.toLowerCase()))
  let entryCount = 0

  const serialize = (current, depth, path) => {
    if (depth > maxDepth) throw new Error('depth')
    if (current === null) return 'null'

    if (typeof current === 'boolean') return current ? 'true' : 'false'
    if (typeof current === 'string') {
      if (!isValidUnicodeScalarString(current, maxStringScalars)) throw new Error('string')
      return JSON.stringify(current)
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)
        || (Number.isInteger(current) && !Number.isSafeInteger(current))) {
        throw new Error('number')
      }
      return String(Object.is(current, -0) ? 0 : current)
    }
    if (typeof current !== 'object') throw new Error('scalar')
    if (seen.has(current)) throw new Error('cycle')
    seen.add(current)

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) throw new Error('array-prototype')
      if (Object.getOwnPropertySymbols(current).length > 0) throw new Error('array-symbol')
      const keys = Object.keys(current)
      const ownNames = Object.getOwnPropertyNames(current)
      if (ownNames.length !== keys.length + 1 || !ownNames.includes('length')) {
        throw new Error('array-properties')
      }
      if (keys.length !== current.length) throw new Error('array-properties')
      if (!keys.every((key, index) => key === String(index))) throw new Error('array-density')
      if (!hasOnlyDataProperties(current, keys)) throw new Error('array-accessor')
      entryCount += current.length
      if (entryCount > maxEntries) throw new Error('entries')
      return `[${current.map((item, index) => serialize(item, depth + 1, [...path, String(index)])).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) throw new Error('record-prototype')
    if (Object.getOwnPropertySymbols(current).length > 0) throw new Error('record-symbol')
    const keys = Object.keys(current)
    if (Object.getOwnPropertyNames(current).length !== keys.length) throw new Error('record-properties')
    if (!hasOnlyDataProperties(current, keys)) throw new Error('record-accessor')

    if (depth === 0 && rootAllowedKeys) {
      const allowed = new Set(rootAllowedKeys)
      if (keys.some((key) => !allowed.has(key))) throw new Error('root-key')
    }

    for (const key of keys) {
      if (!isValidUnicodeScalarString(key, maxStringScalars)) throw new Error('key-string')
      const normalizedKey = key.toLowerCase()
      if ((FORBIDDEN_SAFE_JSON_KEYS.has(normalizedKey) && !allowedGenericForbiddenKeys.has(normalizedKey))
        || additionalForbiddenKeys.has(normalizedKey)) {
        throw new Error('forbidden-key')
      }
      if (depth === 0 && forbiddenRootKeys.has(normalizedKey)) throw new Error('forbidden-root-key')
      if (!validateSpecialValue({ key, value: current[key], path, depth })) {
        throw new Error('special-value')
      }
    }

    entryCount += keys.length
    if (entryCount > maxEntries) throw new Error('entries')
    return `{${keys
      .sort(compareUnicodeScalars)
      .map((key) => `${JSON.stringify(key)}:${serialize(current[key], depth + 1, [...path, key])}`)
      .join(',')}}`
  }

  try {
    const serialized = serialize(value, 0, [])
    return Buffer.byteLength(serialized, 'utf8') <= maxBytes
  } catch {
    return false
  }
}

export const sha256Field = ({ defaultValue } = {}) => ({
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 71,
  match: SHA256_PATTERN,
  ...(defaultValue !== undefined ? { default: defaultValue } : { default: undefined }),
})

const scopedIdentityFields = {
  runtimeInstanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RuntimeInstance',
    required: true,
  },
  runtimeInstanceKey: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 160,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
  },
}

const versionFields = {
  stateVersion: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 200,
    match: RUNTIME_STATE_VERSION_PATTERN,
  },
  sourceStateVersion: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 200,
    match: RUNTIME_STATE_VERSION_PATTERN,
  },
  sourceHash: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 71,
    match: SHA256_PATTERN,
  },
  migrationReceiptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RuntimeStateMigrationReceipt',
    required: true,
  },
  current: {
    type: Boolean,
    required: true,
    default: false,
  },
}

export const createRuntimeStateSchema = ({ collection, fields, indexes }) => {
  const schema = new mongoose.Schema(
    {
      ...scopedIdentityFields,
      ...versionFields,
      ...fields,
    },
    {
      collection,
      timestamps: true,
      strict: 'throw',
    },
  )

  indexes.forEach(({ keys, options }) => schema.index(keys, options))
  schema.path('sourceStateVersion').validate(function validateSourceStateVersion(value) {
    return value === this.stateVersion
  }, 'sourceStateVersion must equal stateVersion')
  return schema
}

export const scopedVersionIndex = (keyField, name) => ({
  keys: {
    customerId: 1,
    tenantId: 1,
    runtimeInstanceId: 1,
    [keyField]: 1,
    stateVersion: 1,
  },
  options: { unique: true, name },
})

export const scopedCurrentIndex = (keyField, name) => ({
  keys: {
    customerId: 1,
    tenantId: 1,
    runtimeInstanceId: 1,
    [keyField]: 1,
    current: 1,
  },
  options: {
    unique: true,
    name,
    partialFilterExpression: { current: true },
  },
})

export const scopedIdentityFieldsForTest = Object.freeze(Object.keys(scopedIdentityFields))
export const versionFieldsForTest = Object.freeze(Object.keys(versionFields))
