import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  isBoundedSafeJson,
  isValidUnicodeScalarString,
} from './runtimeStateSchemas.js'

const SNAPSHOT_METADATA_KEYS = [
  'artifactType',
  'build',
  'coverage',
  'dependencies',
  'frameworkId',
  'frameworkKey',
  'health',
  'packageKey',
  'packageVersion',
  'registries',
  'runtimeType',
  'scope',
  'validation',
  'warnings',
]

const DUPLICATED_IDENTITY_KEYS = [
  'runtimeInstanceId',
  'runtimeInstanceKey',
  'customerId',
  'tenantId',
  'stateVersion',
  'sourceStateVersion',
  'migrationReceiptId',
]

const isMinimalScope = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Object.keys(value)
  if (keys.some((key) => !['frameworkId', 'runtimeId'].includes(key))) return false
  return keys.every((key) => typeof value[key] === 'string'
    && value[key] === value[key].trim()
    && isValidUnicodeScalarString(value[key], 240))
}

const countsSchema = new mongoose.Schema({
  nodeCount: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
  edgeCount: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
}, { _id: false, strict: 'throw' })

const runtimeGraphSnapshotSchema = createRuntimeStateSchema({
  collection: 'runtime_graph_snapshots',
  fields: {
    snapshotId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    graphVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    graphHash: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    stateStatus: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 80,
    },
    counts: {
      type: countsSchema,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
      validate: {
        validator: (value) => isBoundedSafeJson(value, {
          maxDepth: 8,
          maxEntries: 20000,
          maxBytes: 512 * 1024,
          rootAllowedKeys: SNAPSHOT_METADATA_KEYS,
          rootForbiddenKeys: ['nodes', 'edges'],
          forbiddenKeys: DUPLICATED_IDENTITY_KEYS,
          validateSpecialValue: ({ key, value: nestedValue, depth }) => (
            depth !== 0 || key !== 'scope' || isMinimalScope(nestedValue)
          ),
        }),
        message: 'metadata must be bounded safe JSON',
      },
    },
  },
  indexes: [
    {
      keys: {
        customerId: 1,
        tenantId: 1,
        runtimeInstanceId: 1,
        graphVersion: 1,
        stateVersion: 1,
      },
      options: { unique: true, name: 'unique_runtime_graph_snapshot_version' },
    },
    {
      keys: {
        customerId: 1,
        tenantId: 1,
        runtimeInstanceId: 1,
        current: 1,
      },
      options: {
        unique: true,
        name: 'unique_current_runtime_graph_snapshot',
        partialFilterExpression: { current: true },
      },
    },
  ],
})

const RuntimeGraphSnapshot = mongoose.model('RuntimeGraphSnapshot', runtimeGraphSnapshotSchema)

export { runtimeGraphSnapshotSchema }
export default RuntimeGraphSnapshot
