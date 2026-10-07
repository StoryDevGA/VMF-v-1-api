import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateSchemas.js'

const processingReceiptSchema = new mongoose.Schema({
  contractVersion: { type: String, required: true, enum: ['document-processing-receipt.v1'] },
  runId: { type: String, required: true, match: /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/ },
  inputIndex: { type: Number, required: true, min: 0, max: 4, validate: Number.isInteger },
  contentHash: { ...sha256Field(), required: true },
}, { _id: false, strict: 'throw' })

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
    processingReceipt: { type: processingReceiptSchema, default: undefined,
      validate: function (value) { return value === undefined || Boolean(value && this.sourceType === 'UPLOADED_DOCUMENT') } },
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
