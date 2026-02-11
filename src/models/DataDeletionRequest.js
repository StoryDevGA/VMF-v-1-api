/**
 * DataDeletionRequest Model
 *
 * Tracks GDPR data-deletion requests through their lifecycle:
 *   PENDING → COMPLETED | REJECTED
 *
 * Stores the requesting user, reviewer, legal basis, an optional
 * export snapshot taken at processing time, and the execution summary
 * produced after anonymization + hard-delete.
 *
 * Compound indexes support status-based listing and per-user lookups.
 */

import mongoose from 'mongoose'

const dataDeletionRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    requestedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'REJECTED', 'COMPLETED'],
      default: 'PENDING',
      index: true,
    },
    legalBasis: {
      type: String,
      enum: ['USER_REQUEST', 'ACCOUNT_CLOSURE', 'RETENTION_POLICY', 'ADMIN_REQUEST'],
      default: 'USER_REQUEST',
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    reviewerNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    reviewedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
      index: true,
    },
    exportSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    executionSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

dataDeletionRequestSchema.index({ userId: 1, status: 1, createdAt: -1 })
dataDeletionRequestSchema.index({ status: 1, createdAt: -1 })

const DataDeletionRequest = mongoose.model('DataDeletionRequest', dataDeletionRequestSchema)

export default DataDeletionRequest
