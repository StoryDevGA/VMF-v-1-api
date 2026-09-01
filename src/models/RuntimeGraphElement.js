import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  isBoundedSafeJson,
  isValidUnicodeScalarString,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateSchemas.js'

const NODE_ATTRIBUTE_KEYS = [
  'consumerType',
  'coverageDomain',
  'customerVisible',
  'entityDefinitionKey',
  'entityDisplayName',
  'evidenceObjectId',
  'frameworkKey',
  'graphQualityState',
  'lockVersion',
  'lockedAt',
  'lockedBy',
  'metadata',
  'nodeType',
  'packageKey',
  'packageVersion',
  'publishVersion',
  'publishedAt',
  'publishedBy',
  'replayAnchorId',
  'required',
  'reviewStatus',
  'runtimePath',
  'scope',
  'sectionKey',
  'signalType',
  'snapshotHash',
  'snapshotId',
  'snippet',
  'sourceEvidenceNodeIds',
  'sourceId',
  'sourceKind',
  'sourceType',
]

const EDGE_ATTRIBUTE_KEYS = [
  'basis',
  'builtAt',
  'confidenceDriverRefs',
  'contributesTo',
  'customerVisible',
  'relationshipDefinitionKey',
  'relationshipDisplayName',
  'sourceRefs',
  'validationState',
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

const isNodeScope = (value) => (
  (typeof value === 'string' && ['GLOBAL', 'SECTION'].includes(value))
  || isMinimalScope(value)
)

const runtimeGraphElementSchema = createRuntimeStateSchema({
  collection: 'runtime_graph_elements',
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
    elementType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: ['NODE', 'EDGE'],
    },
    elementKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    fromElementKey: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    toElementKey: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    relationshipType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      default: '',
    },
    label: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    summary: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
      validate: {
        validator: function validateAttributes(value) {
          const isNode = this.elementType === 'NODE'
          return isBoundedSafeJson(value, {
            maxDepth: 6,
            maxEntries: 1000,
            maxBytes: 32 * 1024,
            rootAllowedKeys: isNode ? NODE_ATTRIBUTE_KEYS : EDGE_ATTRIBUTE_KEYS,
            validateSpecialValue: ({ key, value: nestedValue, depth }) => (
              !isNode || depth !== 0 || key !== 'scope' || isNodeScope(nestedValue)
            ),
          })
        },
        message: 'attributes must match elementType and be bounded safe JSON',
      },
    },
  },
  indexes: [
    scopedVersionIndex('elementKey', 'unique_runtime_graph_element_version'),
    scopedCurrentIndex('elementKey', 'unique_current_runtime_graph_element'),
    {
      keys: {
        customerId: 1,
        tenantId: 1,
        runtimeInstanceId: 1,
        current: 1,
        snapshotId: 1,
        stateVersion: 1,
      },
      options: { name: 'runtime_graph_elements_scope_current_snapshot_version' },
    },
  ],
})

const RuntimeGraphElement = mongoose.model('RuntimeGraphElement', runtimeGraphElementSchema)

export { runtimeGraphElementSchema }
export default RuntimeGraphElement
