import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  RUNTIME_STATE_VERSION_PATTERN,
  SHA256_PATTERN,
  isBoundedSafeJson,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateSchemas.js'
import { RUNTIME_STATE_V2_CANONICAL_ALGORITHM } from '../services/runtimeStateCanonicalSerializer.js'

export const RUNTIME_SECTION_DETAIL_ROOT_KEYS = Object.freeze([
  'input',
  'generated',
  'accepted',
  'review',
  'state',
  'lineage',
  'revisions',
  'dependencies',
  'validation',
  'confidence',
  'intelligence',
  'metrics',
  'additionalEvidence',
  'evidenceObjects',
  'gsilContext',
])

export const RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS = Object.freeze([
  'framework_state',
  'mongodb',
  'mongo',
  'mongoose',
  'collection',
  'runtime_state_v2',
  'runtime_instances',
  'runtime_section_states',
  'runtime_evidence_sources',
  'runtime_evidence_objects',
  'runtime_graph_snapshots',
  'runtime_graph_elements',
  'runtime_state_migration_receipts',
  'runtime_activation_snapshots',
  'runtime_deployments',
  'runtime_output_requests',
  'runtime_output_assets',
  'runtime_validation_audit',
])

export const isBoundedRuntimeSectionDetail = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!isBoundedSafeJson(value, {
    maxDepth: 12,
    maxEntries: 10000,
    maxBytes: 256 * 1024,
    maxStringScalars: 8000,
    rootAllowedKeys: RUNTIME_SECTION_DETAIL_ROOT_KEYS,
    forbiddenKeys: RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS,
    allowedForbiddenKeys: ['content', 'body', 'text'],
  })) return false

  return Object.keys(value).length === RUNTIME_SECTION_DETAIL_ROOT_KEYS.length
    && RUNTIME_SECTION_DETAIL_ROOT_KEYS.every((key) => Object.hasOwn(value, key))
}

const projectionReceiptSchema = new mongoose.Schema({
  algorithm: {
    type: String,
    required: true,
    enum: [RUNTIME_STATE_V2_CANONICAL_ALGORITHM],
  },
  logicalPath: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 320,
  },
  sourceHash: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 71,
    match: SHA256_PATTERN,
  },
  stateVersion: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 200,
    match: RUNTIME_STATE_VERSION_PATTERN,
  },
  mappingVersion: {
    type: String,
    enum: ['ss014-v2-mapping-v1'],
    default: undefined,
  },
}, { _id: false, strict: 'throw' })

const runtimeStateSectionSchema = createRuntimeStateSchema({
  collection: 'runtime_section_states',
  fields: {
    sectionKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    legacyPath: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320,
    },
    stateStatus: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 80,
    },
    truthStatus: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    truthHash: sha256Field({ defaultValue: '' }),
    contentHash: sha256Field({ defaultValue: '' }),
    summary: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
    },
    evidenceRefs: {
      type: [{
        type: String,
        trim: true,
        maxlength: 240,
      }],
      default: [],
      validate: {
        validator: (value) => value.length <= 10000,
        message: 'evidenceRefs exceeds 10000 items',
      },
    },
    sectionDetail: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      validate: {
        validator: isBoundedRuntimeSectionDetail,
        message: 'sectionDetail must be a bounded renderer-facing section model',
      },
    },
    projectionReceipt: {
      type: projectionReceiptSchema,
      required: true,
    },
  },
  indexes: [
    scopedVersionIndex('sectionKey', 'unique_runtime_state_section_version'),
    scopedCurrentIndex('sectionKey', 'unique_current_runtime_state_section'),
  ],
})

runtimeStateSectionSchema.set('minimize', false)

runtimeStateSectionSchema.path('legacyPath').validate(function validateLegacyPath(value) {
  return value === `framework_state.sections.${this.sectionKey}`
}, 'legacyPath must match sectionKey')

runtimeStateSectionSchema.path('projectionReceipt').validate(function validateProjectionReceipt(value) {
  return value?.logicalPath === this.legacyPath
    && value?.sourceHash === this.sourceHash
    && value?.stateVersion === this.stateVersion
}, 'projectionReceipt must match the section row')

const RuntimeStateSection = mongoose.model('RuntimeStateSection', runtimeStateSectionSchema)

export { runtimeStateSectionSchema }
export default RuntimeStateSection
