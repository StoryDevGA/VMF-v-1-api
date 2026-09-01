import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateSchemas.js'

const runtimeEvidenceSourceSchema = createRuntimeStateSchema({
  collection: 'runtime_evidence_sources',
  fields: {
    sourceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    sourceType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    sourceRef: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    contentHash: sha256Field(),
    acquisitionStatus: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: undefined,
    },
    acquisitionProfile: {
      type: String,
      trim: true,
      maxlength: 120,
      default: undefined,
    },
    lineageRef: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: undefined,
    },
    reviewStatus: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: undefined,
    },
  },
  indexes: [
    scopedVersionIndex('sourceId', 'unique_runtime_evidence_source_version'),
    scopedCurrentIndex('sourceId', 'unique_current_runtime_evidence_source'),
  ],
})

const RuntimeEvidenceSource = mongoose.model('RuntimeEvidenceSource', runtimeEvidenceSourceSchema)

export { runtimeEvidenceSourceSchema }
export default RuntimeEvidenceSource
