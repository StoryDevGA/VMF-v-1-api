import mongoose from 'mongoose'
import {
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_MESSAGE_ROLES,
  OUTCOME_STUDIO_MESSAGE_STATUSES,
  OUTCOME_STUDIO_PHASE,
  OUTCOME_STUDIO_RESPONSE_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'

const nullableString = {
  type: String,
  trim: true,
  default: null,
}

const outcomeMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
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
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
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
    contractVersion: {
      type: String,
      trim: true,
      maxlength: 80,
      default: OUTCOME_STUDIO_CONTRACT_VERSION,
    },
    phase: {
      type: String,
      trim: true,
      maxlength: 80,
      default: OUTCOME_STUDIO_PHASE,
    },
    role: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_MESSAGE_ROLES),
      default: OUTCOME_STUDIO_MESSAGE_ROLES.USER,
      index: true,
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_MESSAGE_STATUSES),
      default: OUTCOME_STUDIO_MESSAGE_STATUSES.SUBMITTED,
      index: true,
    },
    responseStatus: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(OUTCOME_STUDIO_RESPONSE_STATUSES),
      default: OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE,
      index: true,
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    sourceOutputSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    truthSignature: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    knowledgePackBinding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'outcome_messages',
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

outcomeMessageSchema.index({ runtimeInstanceId: 1, sessionId: 1, createdAt: 1 })
outcomeMessageSchema.index({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, sessionId: 1, status: 1, createdAt: 1 })
outcomeMessageSchema.index({ submittedBy: 1, submittedAt: -1 })

outcomeMessageSchema.pre('validate', function normalizeOutcomeMessage(next) {
  this.messageId = String(this.messageId || '').trim()
  this.sessionId = String(this.sessionId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.runtimeType = String(this.runtimeType || '').trim().toUpperCase()
  this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  this.packageKey = String(this.packageKey || '').trim()
  this.packageVersion = String(this.packageVersion || '').trim()
  this.contractVersion = String(this.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION).trim()
  this.phase = String(this.phase || OUTCOME_STUDIO_PHASE).trim()
  this.role = String(this.role || OUTCOME_STUDIO_MESSAGE_ROLES.USER).trim().toUpperCase()
  this.status = String(this.status || OUTCOME_STUDIO_MESSAGE_STATUSES.SUBMITTED).trim().toUpperCase()
  this.responseStatus = String(this.responseStatus || OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE)
    .trim()
    .toUpperCase()
  this.prompt = String(this.prompt || '').trim()
  next()
})

const OutcomeMessage = mongoose.model('OutcomeMessage', outcomeMessageSchema)

export default OutcomeMessage
