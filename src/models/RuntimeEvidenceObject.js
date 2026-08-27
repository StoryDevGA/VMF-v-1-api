import mongoose from 'mongoose'

import {
  createRuntimeStateV2Schema,
  sha256Field,
  scopedCurrentIndex,
  scopedVersionIndex,
} from './runtimeStateV2Schemas.js'

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

const runtimeEvidenceObjectSchema = createRuntimeStateV2Schema({
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
