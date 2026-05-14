import mongoose from 'mongoose'

export const RUNTIME_DEPLOYMENT_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ROLLBACK_ACTIVE: 'ROLLBACK_ACTIVE',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
})

const runtimeDeploymentSchema = new mongoose.Schema(
  {
    deploymentId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 160,
      index: true,
    },
    activationId: {
      type: String,
      required: true,
      trim: true,
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
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_DEPLOYMENT_STATUSES),
      default: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
      index: true,
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
    registeredAt: {
      type: Date,
      default: null,
      index: true,
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isRollbackDeployment: {
      type: Boolean,
      default: false,
    },
    supersededAt: {
      type: Date,
      default: null,
    },
    supersededByDeploymentId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
    },
  },
  {
    collection: 'runtime_deployments',
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

runtimeDeploymentSchema.index(
  { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE },
    name: 'unique_active_runtime_deployment',
  },
)
runtimeDeploymentSchema.index({ packageId: 1, registeredAt: -1 })

const RuntimeDeployment = mongoose.model('RuntimeDeployment', runtimeDeploymentSchema)

export default RuntimeDeployment
