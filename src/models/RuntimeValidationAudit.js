import mongoose from 'mongoose'

export const RUNTIME_VALIDATION_AUDIT_RESULTS = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
})

export const RUNTIME_VALIDATION_AUDIT_VERDICTS = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
  AUDIT_ONLY: 'AUDIT_ONLY',
})

export const RUNTIME_VALIDATION_AUDIT_MODES = Object.freeze({
  STRICT: 'STRICT',
  WARN_ONLY: 'WARN_ONLY',
  AUDIT_ONLY: 'AUDIT_ONLY',
  DISABLED: 'DISABLED',
})

export const RUNTIME_VALIDATION_AUDIT_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  BLOCKING: 'BLOCKING',
  CRITICAL: 'CRITICAL',
})

export const RUNTIME_VALIDATION_OPERATION_TYPES = Object.freeze({
  STATE_READ: 'STATE_READ',
  STATE_WRITE: 'STATE_WRITE',
  // Backward-compatible aliases for early RVL harness rows.
  STATE_MUTATION: 'STATE_MUTATION',
  OUTPUT_VALIDATION: 'OUTPUT_VALIDATION',
  LIFECYCLE_TRANSITION: 'LIFECYCLE_TRANSITION',
  WORKFLOW_EXECUTION: 'WORKFLOW_EXECUTION',
  AGENT_EXECUTION: 'AGENT_EXECUTION',
  // Backward-compatible alias for early RVL harness rows.
  AGENT_ACTION: 'AGENT_ACTION',
  SKILL_EXECUTION: 'SKILL_EXECUTION',
})

const runtimeValidationIssueSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    severity: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_AUDIT_SEVERITIES),
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    path: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    source: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'runtime-validation',
    },
  },
  { _id: false },
)

const runtimeValidationSummarySchema = new mongoose.Schema(
  {
    totalChecks: {
      type: Number,
      min: 0,
      default: 0,
    },
    passed: {
      type: Number,
      min: 0,
      default: 0,
    },
    warnings: {
      type: Number,
      min: 0,
      default: 0,
    },
    failed: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
)

const runtimeValidationAuditSchema = new mongoose.Schema(
  {
    validationCode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
      index: true,
    },
    severity: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_AUDIT_SEVERITIES),
      default: RUNTIME_VALIDATION_AUDIT_SEVERITIES.INFO,
      index: true,
    },
    operationType: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_OPERATION_TYPES),
      index: true,
    },
    runtimePath: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
      index: true,
    },
    actorId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },
    actorType: {
      type: String,
      trim: true,
      uppercase: true,
      enum: ['USER', 'AGENT', 'SKILL', 'SYSTEM', 'SERVICE'],
      default: 'USER',
    },
    packageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },
    frameworkKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: '',
      index: true,
    },
    workspaceId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_AUDIT_RESULTS),
      default: RUNTIME_VALIDATION_AUDIT_RESULTS.PASS,
      index: true,
    },
    result: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_AUDIT_VERDICTS),
      index: true,
    },
    mode: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_VALIDATION_AUDIT_MODES),
      default: RUNTIME_VALIDATION_AUDIT_MODES.STRICT,
      index: true,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 800,
      default: '',
    },
    issues: {
      type: [runtimeValidationIssueSchema],
      default: () => [],
    },
    summary: {
      type: runtimeValidationSummarySchema,
      default: () => ({
        totalChecks: 0,
        passed: 0,
        warnings: 0,
        failed: 0,
      }),
    },
    beforeState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    afterState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    packageResolved: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    collection: 'runtime_validation_audit',
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

runtimeValidationAuditSchema.index({ packageId: 1, createdAt: -1 })
runtimeValidationAuditSchema.index({ workspaceId: 1, createdAt: -1 })
runtimeValidationAuditSchema.index({ workspaceId: 1, frameworkKey: 1, createdAt: -1 })
runtimeValidationAuditSchema.index({ frameworkKey: 1, operationType: 1, createdAt: -1 })
runtimeValidationAuditSchema.index({ status: 1, severity: 1, createdAt: -1 })
runtimeValidationAuditSchema.index({ result: 1, createdAt: -1 })

const RuntimeValidationAudit = mongoose.model('RuntimeValidationAudit', runtimeValidationAuditSchema)

export default RuntimeValidationAudit
