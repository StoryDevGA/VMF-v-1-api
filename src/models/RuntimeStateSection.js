import mongoose from 'mongoose'

import {
  createRuntimeStateV2Schema,
  RUNTIME_STATE_VERSION_PATTERN,
  SHA256_PATTERN,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateV2Schemas.js'
import { SS014_LEGACY_CANONICAL_ALGORITHM } from '../services/ss014LegacyDomainCanonicalSerializer.js'

const projectionReceiptSchema = new mongoose.Schema({
  algorithm: {
    type: String,
    required: true,
    enum: [SS014_LEGACY_CANONICAL_ALGORITHM],
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

const runtimeStateSectionSchema = createRuntimeStateV2Schema({
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
