import mongoose from 'mongoose'

export const RUNTIME_INSTANCE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
  FAILED: 'FAILED',
})

export const RUNTIME_EXECUTION_STATUSES = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  VALIDATING: 'VALIDATING',
  BLOCKED: 'BLOCKED',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
})

export const RUNTIME_MODES = Object.freeze({
  INTERACTIVE: 'INTERACTIVE',
  ASSISTED: 'ASSISTED',
  AUTOMATED: 'AUTOMATED',
})

export const RUNTIME_TYPES = Object.freeze({
  VALUE_NARRATIVE: 'VALUE_NARRATIVE',
  DEAL_ANALYSIS: 'DEAL_ANALYSIS',
})

const runtimeInstanceKeyPattern = /^[a-z][a-z0-9-]{2,159}$/
const tokenPattern = /^[A-Z][A-Z0-9_]{1,79}$/

const frameworkStateSchema = new mongoose.Schema(
  {
    lifecycle: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ stage: 'DRAFT' }),
    },
    sections: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    validation: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    readiness: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    publish: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    lock: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    policy: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    attachments: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    artifacts: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { _id: false },
)

const runtimeAnchorSchema = new mongoose.Schema(
  {
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
    },
    runtimeInstanceKey: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    runtimeType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    relationship: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    lockedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
)

const runtimeEvidenceSchema = new mongoose.Schema(
  {
    activationId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
    },
    deploymentId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
    },
    dependencySnapshotId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
    },
    dependencySnapshotHash: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
  },
  { _id: false },
)

const runtimeInstanceSchema = new mongoose.Schema(
  {
    runtimeInstanceKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 160,
      match: [runtimeInstanceKeyPattern, 'Runtime instance key must use lowercase letters, numbers, or hyphens'],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    workspaceId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
      index: true,
    },
    runtimeType: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_TYPES),
      default: RUNTIME_TYPES.VALUE_NARRATIVE,
      index: true,
    },
    frameworkKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 80,
      match: [tokenPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
      index: true,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FrameworkPackage',
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
      required: true,
    },
    dependencyLockId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
      index: true,
    },
    activationId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
      index: true,
    },
    deploymentId: {
      type: String,
      trim: true,
      maxlength: 180,
      required: true,
      index: true,
    },
    evidence: {
      type: runtimeEvidenceSchema,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_INSTANCE_STATUSES),
      default: RUNTIME_INSTANCE_STATUSES.ACTIVE,
      index: true,
    },
    executionStatus: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_EXECUTION_STATUSES),
      default: RUNTIME_EXECUTION_STATUSES.IDLE,
      index: true,
    },
    runtimeMode: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_MODES),
      default: RUNTIME_MODES.INTERACTIVE,
    },
    runtimeCapacitySlot: {
      type: Number,
      min: 1,
      default: null,
      index: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    framework_state: {
      type: frameworkStateSchema,
      default: () => ({}),
    },
    lockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lockedReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    assignedTo: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    anchors: {
      type: [runtimeAnchorSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    collection: 'runtime_instances',
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

runtimeInstanceSchema.index({ customerId: 1, tenantId: 1, runtimeType: 1, status: 1, updatedAt: -1 })
runtimeInstanceSchema.index({ customerId: 1, tenantId: 1, frameworkKey: 1, packageId: 1, updatedAt: -1 })
runtimeInstanceSchema.index({ customerId: 1, tenantId: 1, executionStatus: 1, updatedAt: -1 })
runtimeInstanceSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 })
runtimeInstanceSchema.index(
  { customerId: 1, tenantId: 1, runtimeType: 1, status: 1, runtimeCapacitySlot: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: RUNTIME_INSTANCE_STATUSES.ACTIVE,
      runtimeCapacitySlot: { $type: 'number' },
    },
  },
)

runtimeInstanceSchema.pre('validate', function normalizeRuntimeInstance(next) {
  if (this.isNew || this.isModified('runtimeInstanceKey')) {
    this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  }

  if (this.isNew || this.isModified('frameworkKey')) {
    this.frameworkKey = String(this.frameworkKey || '').trim().toUpperCase()
  }

  if (!this.framework_state) {
    this.framework_state = {}
  }

  if (this.isNew || this.isModified('lockedReason')) {
    this.lockedReason = String(this.lockedReason || '').trim()
  }

  const frameworkState = this.framework_state
  frameworkState.lifecycle = frameworkState.lifecycle || { stage: 'DRAFT' }
  frameworkState.sections = frameworkState.sections || {}
  frameworkState.validation = frameworkState.validation || {}
  frameworkState.readiness = frameworkState.readiness || {}
  frameworkState.publish = frameworkState.publish || {}
  frameworkState.lock = frameworkState.lock || {}
  frameworkState.policy = frameworkState.policy || {}
  frameworkState.attachments = frameworkState.attachments || {}
  frameworkState.artifacts = frameworkState.artifacts || {}

  next()
})

const RuntimeInstance = mongoose.model('RuntimeInstance', runtimeInstanceSchema)

export default RuntimeInstance
