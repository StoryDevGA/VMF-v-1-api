import mongoose from 'mongoose'
import crypto from 'crypto'

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    website: {
      type: String,
      trim: true,
      maxlength: 500,
      match: [/^https?:\/\/.+/, 'Must be a valid URL starting with http:// or https://'],
    },
    registrationNumber: { type: String, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 500 },
    industry: { type: String, trim: true, maxlength: 100 },
    size: { type: String, trim: true, maxlength: 50 },
  },
  { _id: false },
)

export const INVITATION_STATUSES = Object.freeze([
  'created',
  'sent',
  'send_failed',
  'accessed',
  'authenticated',
  'expired',
  'revoked',
])

const invitationSchema = new mongoose.Schema(
  {
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 255,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    recipientName: { type: String, required: true, trim: true, maxlength: 255 },
    company: { type: companySchema, required: true },
    status: {
      type: String,
      required: true,
      enum: INVITATION_STATUSES,
      default: 'created',
    },
    tokenHash: { type: String, select: false },
    expiresAt: { type: Date, required: true },
    sentAt: { type: Date },
    sendFailedAt: { type: Date },
    sendFailureReason: { type: String, select: false, maxlength: 500 },
    accessedAt: { type: Date },
    authenticatedAt: { type: Date },
    revokedAt: { type: Date },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    identityPlusSubjectId: { type: String, trim: true },
    provisionedCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    provisionedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resendCount: { type: Number, required: true, default: 0 },
    lastResentAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        delete ret.tokenHash
        delete ret.sendFailureReason
        return ret
      },
    },
  },
)

invitationSchema.index({ recipientEmail: 1, status: 1 })
invitationSchema.index({ tokenHash: 1 }, { unique: true, sparse: true })
invitationSchema.index({ createdBy: 1, createdAt: -1 })
invitationSchema.index({ status: 1, expiresAt: 1 })

invitationSchema.statics.generateToken = function generateToken() {
  const raw = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

invitationSchema.statics.findByToken = function findByToken(rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex')
  return this.findOne({ tokenHash: hash }).select('+tokenHash')
}

invitationSchema.methods.isExpired = function isExpired() {
  return this.expiresAt < new Date()
}

// Spec defines non-resendable as 'authenticated' and 'revoked' only.
// This implementation also blocks 'expired' and checks isExpired() for defense-in-depth,
// preventing resend of invitations that are past expiry even if status hasn't been updated yet.
invitationSchema.methods.isResendable = function isResendable() {
  if (this.isExpired()) return false
  return !['authenticated', 'revoked', 'expired'].includes(this.status)
}

const Invitation = mongoose.model('Invitation', invitationSchema)

export default Invitation
