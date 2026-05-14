import mongoose from 'mongoose'

export const RUNTIME_ACTIVATION_STATUSES = Object.freeze({
  ACTIVATING: 'ACTIVATING',
  ACTIVE: 'ACTIVE',
  ACTIVATION_FAILED: 'ACTIVATION_FAILED',
  ROLLBACK_IN_PROGRESS: 'ROLLBACK_IN_PROGRESS',
  ROLLED_BACK: 'ROLLED_BACK',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
})

const runtimeActivationSnapshotSchema = new mongoose.Schema(
  {
    activationId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 160,
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
      default: '',
    },
    frameworkKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      index: true,
    },
    frameworkVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    packageStatusAtActivation: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    activationStatus: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_ACTIVATION_STATUSES),
      default: RUNTIME_ACTIVATION_STATUSES.ACTIVATING,
      index: true,
    },
    dependencySnapshotId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    dependencySnapshotHash: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    checkpointId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    checkpointStatus: {
      type: String,
      trim: true,
      maxlength: 40,
      default: '',
    },
    runtimeVerdictId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    runtimeVerdictResult: {
      type: String,
      trim: true,
      maxlength: 40,
      default: '',
    },
    deploymentGraph: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    tenantScope: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: 'GLOBAL',
      index: true,
    },
    deploymentMode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: 'PRODUCTION',
      index: true,
    },
    activatedAt: {
      type: Date,
      default: null,
      index: true,
    },
    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    supersedesActivationId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
      index: true,
    },
    supersededByActivationId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
      index: true,
    },
    rollbackSourceActivationId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    collection: 'runtime_activation_snapshots',
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

runtimeActivationSnapshotSchema.index({
  frameworkKey: 1,
  frameworkVersion: 1,
  tenantScope: 1,
  deploymentMode: 1,
  activationStatus: 1,
})
runtimeActivationSnapshotSchema.index({ packageId: 1, activatedAt: -1 })

const RuntimeActivationSnapshot = mongoose.model('RuntimeActivationSnapshot', runtimeActivationSnapshotSchema)

export default RuntimeActivationSnapshot
