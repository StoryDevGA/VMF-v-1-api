import mongoose from 'mongoose'
import { sourceVerificationContextSchema } from '../services/sourceVerificationContext.js'
import { validateSourceCapture } from '../services/sourceEvidenceContract.js'
import { createControlledReplayProvenanceSchema, validateStoredControlledReplayProvenance,
  controlledReplayProvenanceForRow } from '../services/controlledReplayContract.js'

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

const captureReceiptSchema = new mongoose.Schema({
  contractVersion: String, operation: String, status: String, runId: String, attemptId: String, inputIndex: Number,
}, { _id: false, strict: 'throw' })
const sourceCaptureSchema = new mongoose.Schema({
  contractVersion: String, sourceId: String, originalContentHash: String, captureTextHash: String,
  textLength: Number, coordinateSystem: String, captureScope: String, adapter: String,
  extractionMethod: String, capturedAt: String, captureReceipt: { type: captureReceiptSchema, default: undefined },
}, { _id: false, strict: 'throw' })

const runtimeEvidenceSourceSchema = createRuntimeStateSchema({
  collection: 'runtime_evidence_sources',
  fields: {
    controlledReplayProvenance: { type: createControlledReplayProvenanceSchema(mongoose), default: undefined,
      set: value => value === undefined ? undefined : validateStoredControlledReplayProvenance(
        value instanceof mongoose.Document ? value.toObject() : value), validate: {
        validator: function (value) {
          if (value === undefined) return true
          try { controlledReplayProvenanceForRow(this.toObject({ depopulate: true }), this); return true } catch { return false }
        }, message: 'Invalid stored controlled replay provenance.',
      } },
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
    sourceCapture: { type: sourceCaptureSchema, default: undefined,
      set: value => value === undefined ? undefined : validateSourceCapture(
        value instanceof mongoose.Document ? value.toObject() : value), validate: {
      validator: function (value) {
        if (value === undefined) return true
        try { validateSourceCapture(value instanceof mongoose.Document ? value.toObject() : value,
          { sourceId: this.sourceId, contentHash: this.contentHash }); return true } catch { return false }
      }, message: 'Invalid recorded source capture.',
    } },
    verificationContext: { type: mongoose.Schema.Types.Mixed, default: undefined,
      validate: (value) => value === undefined || sourceVerificationContextSchema.safeParse(value).success },
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
