import mongoose from 'mongoose'
import {
  OUTPUT_LAB_OUTPUT_TYPE_KEYS,
  OUTPUT_LAB_REQUEST_STATUSES,
} from '../constants/runtimeOutputLab.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const runtimeOutputRequestSchema = new mongoose.Schema(
  {
    outputRequestId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
      index: true,
    },
    runtimeInstanceKey: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
      index: true,
    },
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      required: true,
      index: true,
    },
    packageKey: {
      type: String,
      trim: true,
      maxlength: 120,
      required: true,
    },
    packageVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },
    projectId: nullableString,
    outcomeId: nullableString,
    outputTypeKey: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTPUT_LAB_OUTPUT_TYPE_KEYS),
      index: true,
    },
    outputTypeLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      required: true,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTPUT_LAB_REQUEST_STATUSES),
      default: OUTPUT_LAB_REQUEST_STATUSES.REQUESTED,
      index: true,
    },
    readinessState: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    readinessSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    generatedAt: {
      type: Date,
      default: null,
    },
    outputAssetId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  {
    collection: 'runtime_output_requests',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

runtimeOutputRequestSchema.index({ runtimeInstanceId: 1, createdAt: -1 })
runtimeOutputRequestSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, status: 1, createdAt: -1 })

runtimeOutputRequestSchema.pre('validate', function normalizeRuntimeOutputRequest(next) {
  this.outputRequestId = String(this.outputRequestId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.outputTypeKey = String(this.outputTypeKey || '').trim().toUpperCase()
  this.status = String(this.status || OUTPUT_LAB_REQUEST_STATUSES.REQUESTED).trim().toUpperCase()
  this.outputTypeLabel = String(this.outputTypeLabel || '').trim()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.failureReason = String(this.failureReason || '').trim()
  next()
})

const RuntimeOutputRequest = mongoose.model('RuntimeOutputRequest', runtimeOutputRequestSchema)

export default RuntimeOutputRequest
