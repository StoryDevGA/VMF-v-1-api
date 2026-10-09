import mongoose from 'mongoose'

import {
  createRuntimeStateSchema,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
  isBoundedSafeJson,
} from './runtimeStateSchemas.js'

export const isValidEvidenceSourceLocation = (value) => {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false
  return isBoundedSafeJson(value, { maxDepth: 6, maxEntries: 100, maxBytes: 8192 })
}

const confidenceSchema = new mongoose.Schema({
  level: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 80,
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 1,
  },
  basis: {
    type: [{ type: String, trim: true, maxlength: 500 }],
    default: [],
    validate: {
      validator: (value) => value.length <= 100,
      message: 'confidence basis exceeds 100 items',
    },
  },
}, { _id: false, strict: 'throw' })

const runtimeEvidenceObjectSchema = createRuntimeStateSchema({
  collection: 'runtime_evidence_objects',
  fields: {
    evidenceObjectId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    sourceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    sourceType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: '',
    },
    lineageRef: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    sourceLocation: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
      validate: { validator: isValidEvidenceSourceLocation, message: 'Invalid or oversized source location.' },
    },
    extractedFact: {
      type: String,
      trim: true,
      maxlength: 8000,
      default: '',
    },
    reviewStatus: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    acceptanceState: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    validationStatus: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: undefined,
    },
    confidence: {
      type: confidenceSchema,
      default: undefined,
    },
    materiality: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: undefined,
    },
    materialityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: undefined,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    summary: {
      type: String,
      trim: true,
      maxlength: 8000,
      default: '',
    },
    contentHash: sha256Field(),
    truthHash: sha256Field(),
    lineageHash: sha256Field(),
  },
  indexes: [
    scopedVersionIndex('evidenceObjectId', 'unique_runtime_evidence_object_version'),
    scopedCurrentIndex('evidenceObjectId', 'unique_current_runtime_evidence_object'),
  ],
})

const RuntimeEvidenceObject = mongoose.model('RuntimeEvidenceObject', runtimeEvidenceObjectSchema)

export { runtimeEvidenceObjectSchema }
export default RuntimeEvidenceObject
