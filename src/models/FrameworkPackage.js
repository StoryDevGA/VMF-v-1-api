import mongoose from 'mongoose'
import {
  DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES,
  DEPRECATED_FRAMEWORK_PACKAGE_FIELDS,
} from '../constants/frameworkPackageContract.js'
import {
  RUNTIME_CONTROL_VERSION_STATUSES,
  mapRuntimeControlStatusToVersionStatus,
} from '../utils/runtimeControlVersioning.js'

export const FRAMEWORK_PACKAGE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
})

export const FRAMEWORK_PACKAGE_SCOPES = Object.freeze({
  SYSTEM: 'SYSTEM',
  CUSTOMER: 'CUSTOMER',
})

export const FRAMEWORK_PACKAGE_TYPES = Object.freeze({
  STANDARD: 'STANDARD',
  EXPERIMENTAL: 'EXPERIMENTAL',
  CUSTOM: 'CUSTOM',
})

export const FRAMEWORK_PACKAGE_VISIBILITY = Object.freeze({
  INTERNAL_ONLY: 'INTERNAL_ONLY',
  CUSTOMER_VISIBLE: 'CUSTOMER_VISIBLE',
})

export const FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES = Object.freeze({
  ALL_CUSTOMERS: 'ALL_CUSTOMERS',
  SELECTED_CUSTOMERS: 'SELECTED_CUSTOMERS',
})

export const FRAMEWORK_PACKAGE_RETRY_POLICIES = Object.freeze({
  NONE: 'NONE',
  RETRY_ONCE: 'RETRY_ONCE',
  RETRY_WITH_BACKOFF: 'RETRY_WITH_BACKOFF',
})

export const FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS = Object.freeze({
  ON_SAVE: 'ON_SAVE',
  ON_SUBMIT: 'ON_SUBMIT',
  ON_VALIDATE: 'ON_VALIDATE',
  ON_STAGE_CHANGE: 'ON_STAGE_CHANGE',
  ON_PUBLISH: 'ON_PUBLISH',
  MANUAL: 'MANUAL',
})

export const FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS = Object.freeze({
  ON_CREATE: 'ON_CREATE',
  ON_SAVE: 'ON_SAVE',
  ON_RUN: 'ON_RUN',
  ON_SUBMIT: 'ON_SUBMIT',
  ON_REVIEW_START: 'ON_REVIEW_START',
  ON_STAGE_ENTER: 'ON_STAGE_ENTER',
  ON_STAGE_EXIT: 'ON_STAGE_EXIT',
  ON_APPROVAL: 'ON_APPROVAL',
  ON_APPROVE: 'ON_APPROVE',
  ON_DISCOVERY_SAVE: 'ON_DISCOVERY_SAVE',
  ON_GENERATE_TRUTH: 'ON_GENERATE_TRUTH',
  ON_CONTRADICTION_FOUND: 'ON_CONTRADICTION_FOUND',
  ON_ECONOMIC_MODEL_SAVE: 'ON_ECONOMIC_MODEL_SAVE',
  ON_COMMERCIAL_MODEL_SAVE: 'ON_COMMERCIAL_MODEL_SAVE',
  ON_DECISION_REVIEW: 'ON_DECISION_REVIEW',
  ON_RECOMMENDATION_GENERATED: 'ON_RECOMMENDATION_GENERATED',
  ON_OUTPUT_REQUEST: 'ON_OUTPUT_REQUEST',
  ON_ADVISOR_REQUEST: 'ON_ADVISOR_REQUEST',
  ON_OUTCOME_REQUEST: 'ON_OUTCOME_REQUEST',
  ON_HANDOFF: 'ON_HANDOFF',
  ON_SECTION_BUILD: 'ON_SECTION_BUILD',
  ON_SECTION_GENERATE: 'ON_SECTION_GENERATE',
  ON_SECTION_REGENERATE: 'ON_SECTION_REGENERATE',
  ON_TARGETING_COMPLETE: 'ON_TARGETING_COMPLETE',
  ON_DISCOVERY_COMPLETE: 'ON_DISCOVERY_COMPLETE',
  ON_VALUE_DRIVER_COMPLETE: 'ON_VALUE_DRIVER_COMPLETE',
  ON_DECISION_CONTEXT_COMPLETE: 'ON_DECISION_CONTEXT_COMPLETE',
  ON_POSITIONING_COMPLETE: 'ON_POSITIONING_COMPLETE',
  ON_PROOF_COMPLETE: 'ON_PROOF_COMPLETE',
  ON_ECONOMIC_COMPLETE: 'ON_ECONOMIC_COMPLETE',
  ON_ECONOMICS_COMPLETE: 'ON_ECONOMICS_COMPLETE',
  ON_COMMERCIAL_COMPLETE: 'ON_COMMERCIAL_COMPLETE',
  ON_SYNCHRONIZATION_CHECK: 'ON_SYNCHRONIZATION_CHECK',
  ON_HANDOFF_READY: 'ON_HANDOFF_READY',
  ON_PACKAGE_VALIDATE: 'ON_PACKAGE_VALIDATE',
  ON_PACKAGE_BUILD: 'ON_PACKAGE_BUILD',
  ON_POLICY_FAIL: 'ON_POLICY_FAIL',
  ON_MUTATION: 'ON_MUTATION',
  ON_CONSUMPTION_REQUEST: 'ON_CONSUMPTION_REQUEST',
  ON_TRAP_ANALYSIS_COMPLETE: 'ON_TRAP_ANALYSIS_COMPLETE',
  ON_VALIDATE: 'ON_VALIDATE',
  ON_DEAL_MODE_REQUEST: 'ON_DEAL_MODE_REQUEST',
  ON_SPD_COMPILE: 'ON_SPD_COMPILE',
  ON_RENDER: 'ON_RENDER',
  ON_QUERY: 'ON_QUERY',
  ON_PUBLISH: 'ON_PUBLISH',
  ON_LOCK: 'ON_LOCK',
})

export const FRAMEWORK_PACKAGE_EXECUTION_MODES = Object.freeze({
  EVENT_DRIVEN: 'EVENT_DRIVEN',
  MANUAL: 'MANUAL',
})

export const FRAMEWORK_PACKAGE_STATE_MODELS = Object.freeze({
  LIFECYCLE_BASED: 'LIFECYCLE_BASED',
  FREEFORM: 'FREEFORM',
  RUNTIME_KNOWLEDGE_MODEL: 'RUNTIME_KNOWLEDGE_MODEL',
})

export const FRAMEWORK_PACKAGE_STATE_MODEL_MODES = Object.freeze({
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
})

export const FRAMEWORK_PACKAGE_STATE_BINDING_MODES = Object.freeze({
  STRICT: 'STRICT',
  FLEXIBLE: 'FLEXIBLE',
})

export const FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES = Object.freeze({
  SESSION: 'SESSION',
  PERSISTED: 'PERSISTED',
})

export const FRAMEWORK_PACKAGE_EVALUATION_MODES = Object.freeze({
  POLICY_DRIVEN: 'POLICY_DRIVEN',
  VALIDATION_FIRST: 'VALIDATION_FIRST',
})

const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const semverPattern = /^\d+\.\d+\.\d+$/
const tokenPattern = /^[a-z][a-z0-9-]*$/
const sectionKeyPattern = /^[a-z][a-z0-9_-]*$/
const customerIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/

const normalizeFrameworkKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeFrameworkName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeVersion = (value) =>
  String(value || '')
    .trim()

const normalizeTokenList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const normalizeTokenValue = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

const slugifyToken = (value) => {
  const normalized = normalizeTokenValue(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized) return ''
  if (tokenPattern.test(normalized)) return normalized

  // Request validators are the strict write gate; model slugification preserves legacy/read-path records.
  const prefixed = `binding-${normalized}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return tokenPattern.test(prefixed) ? prefixed : 'binding'
}

const buildUniqueToken = (base, existing) => {
  const safeBase = slugifyToken(base) || 'binding'
  if (!existing.has(safeBase)) return safeBase

  let counter = 2
  while (existing.has(`${safeBase}-${counter}`)) {
    counter += 1
  }
  return `${safeBase}-${counter}`
}

const normalizeCustomerIdList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const READY_FRAMEWORK_PACKAGE_STATUSES = new Set([
  FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
  FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
])

const isReadyFrameworkPackageStatus = (status) =>
  READY_FRAMEWORK_PACKAGE_STATUSES.has(String(status || '').trim().toUpperCase())

const hasConfiguredSections = (sections = []) =>
  Array.isArray(sections)
  && sections.some(
    (section) =>
      String(section?.sectionKey || '').trim()
      || String(section?.runtimePath || '').trim(),
  )

const hasCheckpointResultValue = (value) =>
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && !(value instanceof Date)

const stringTokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [tokenPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const sectionKeyField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [sectionKeyPattern, 'Section key must use lowercase letters, numbers, underscores, or hyphens'],
}

const nullableStringTokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  default: null,
  match: [tokenPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const customerIdField = {
  type: String,
  trim: true,
  maxlength: 120,
  match: [customerIdPattern, 'Customer id must use letters, numbers, underscores, or hyphens'],
}

const frameworkPackageSectionSchema = new mongoose.Schema(
  {
    sectionKey: {
      ...sectionKeyField,
      required: true,
    },
    runtimePath: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    required: {
      type: Boolean,
      default: true,
    },
    validationKeys: [stringTokenField],
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const frameworkPackageExecutionModelSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_EXECUTION_MODES),
      default: FRAMEWORK_PACKAGE_EXECUTION_MODES.EVENT_DRIVEN,
    },
    stateModel: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_STATE_MODELS),
      default: FRAMEWORK_PACKAGE_STATE_MODELS.LIFECYCLE_BASED,
    },
    evaluationMode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_EVALUATION_MODES),
      default: FRAMEWORK_PACKAGE_EVALUATION_MODES.POLICY_DRIVEN,
    },
  },
  { _id: false },
)

const frameworkPackageRuntimeSettingsSchema = new mongoose.Schema(
  {
    enablePreviewMode: {
      type: Boolean,
      default: true,
    },
    enableRuntimeValidation: {
      type: Boolean,
      default: true,
    },
    requireValidationBeforePublish: {
      type: Boolean,
      default: true,
    },
    allowManualValidationRun: {
      type: Boolean,
      default: true,
    },
    allowPolicyRetry: {
      type: Boolean,
      default: true,
    },
    retryPolicy: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_RETRY_POLICIES),
      default: FRAMEWORK_PACKAGE_RETRY_POLICIES.RETRY_ONCE,
    },
    defaultTimeoutMs: {
      type: Number,
      min: 0,
      max: 300000,
      default: 30000,
    },
    maxPolicyExecutionsPerRun: {
      type: Number,
      min: 1,
      max: 100,
      default: 10,
    },
  },
  { _id: false },
)

const frameworkPackageValidationConfigSchema = new mongoose.Schema(
  {
    validationKey: {
      ...stringTokenField,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    blockingOverride: {
      type: Boolean,
      default: null,
    },
    warningOnlyOverride: {
      type: Boolean,
      default: null,
    },
    freshnessOverrideMinutes: {
      type: Number,
      min: 0,
      max: 10080,
      default: null,
    },
    requiresLatestRunOverride: {
      type: Boolean,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const frameworkPackageValidationBindingSchema = new mongoose.Schema(
  {
    bindingKey: {
      ...stringTokenField,
      required: true,
    },
    validationKey: {
      ...stringTokenField,
      required: true,
    },
    trigger: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS),
      required: true,
    },
    blocking: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      min: 1,
      max: 10000,
      required: true,
      default: 100,
    },
    freshnessMinutes: {
      type: Number,
      min: 1,
      max: 10080,
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    parameters: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const frameworkPackageWorkflowPolicyConfigSchema = new mongoose.Schema(
  {
    policyKey: {
      ...stringTokenField,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    stageGroup: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 120,
      default: '',
    },
    executionOrder: {
      type: Number,
      min: 0,
      max: 10000,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const frameworkPackageValidationRulesSchema = new mongoose.Schema(
  {
    requiredSections: [sectionKeyField],
    publishChecks: [stringTokenField],
  },
  { _id: false },
)

const frameworkPackageWorkflowBindingSchema = new mongoose.Schema(
  {
    policyKey: {
      ...stringTokenField,
      required: true,
    },
    executionContext: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS),
      required: true,
    },
    priority: {
      type: Number,
      min: 1,
      max: 10000,
      required: true,
      default: 100,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const frameworkPackageUiContractBindingSchema = new mongoose.Schema(
  {
    key: {
      ...stringTokenField,
      required: true,
    },
    version: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    status: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 40,
      default: '',
    },
    compatibilityMode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: '',
    },
    resolvedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
)

const frameworkPackageDependencyLockReferenceSchema = new mongoose.Schema(
  {
    collectionKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    key: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 40,
      default: '',
    },
    versionStatus: {
      type: String,
      enum: Object.values(RUNTIME_CONTROL_VERSION_STATUSES),
      default: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
    },
    componentVersion: {
      type: Number,
      min: 1,
      max: 100000,
      default: 1,
    },
    lineageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    issues: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
)

const frameworkPackageDependencyLockSchema = new mongoose.Schema(
  {
    snapshotId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    snapshotHash: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    status: {
      type: String,
      enum: ['PASS', 'PASS_WITH_WARNINGS', 'FAIL'],
      default: 'PASS',
    },
    resolvedAt: {
      type: Date,
      default: Date.now,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    packageKey: {
      ...stringTokenField,
      required: true,
    },
    packageVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      required: true,
    },
    references: {
      type: [frameworkPackageDependencyLockReferenceSchema],
      default: [],
    },
  },
  { _id: false },
)

const frameworkPackageRuntimeVerdictSchema = new mongoose.Schema(
  {
    validationId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    auditId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    status: {
      type: String,
      enum: ['PASS', 'WARN', 'FAIL'],
      default: 'PASS',
    },
    result: {
      type: String,
      enum: ['ALLOW', 'BLOCK', 'AUDIT_ONLY'],
      default: 'ALLOW',
    },
    mode: {
      type: String,
      enum: ['STRICT', 'WARN_ONLY', 'AUDIT_ONLY', 'DISABLED'],
      default: 'STRICT',
    },
    lastValidatedAt: {
      type: Date,
      default: null,
    },
    auditPersisted: {
      type: Boolean,
      default: false,
    },
    dependencyLockState: {
      type: String,
      enum: ['LOCKED', 'NOT_LOCKED', 'STALE', 'FAILED'],
      default: 'NOT_LOCKED',
    },
    blockingIssues: {
      type: Number,
      min: 0,
      default: 0,
    },
    warnings: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
)

const frameworkPackageSchema = new mongoose.Schema(
  {
    frameworkKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    },
    frameworkName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    version: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      match: [semverPattern, 'Version must use semantic version format'],
    },
    packageKey: {
      ...stringTokenField,
      default: '',
    },
    packageName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    packageScope: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_SCOPES),
      default: FRAMEWORK_PACKAGE_SCOPES.SYSTEM,
    },
    packageType: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_TYPES),
      default: FRAMEWORK_PACKAGE_TYPES.STANDARD,
    },
    derivedFromPackageId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(FRAMEWORK_PACKAGE_STATUSES),
      default: FRAMEWORK_PACKAGE_STATUSES.DRAFT,
    },
    versionStatus: {
      type: String,
      enum: Object.values(RUNTIME_CONTROL_VERSION_STATUSES),
      default: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockedAt: {
      type: Date,
      default: null,
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
    dependencyLock: {
      type: frameworkPackageDependencyLockSchema,
      default: null,
    },
    lastCheckpointStatus: {
      type: String,
      enum: ['PASS', 'PASS_WITH_WARNINGS', 'WARN', 'FAIL'],
      default: null,
    },
    lastCheckpointAt: {
      type: Date,
      default: null,
    },
    lastCheckpointResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    runtimeVerdict: {
      type: frameworkPackageRuntimeVerdictSchema,
      default: null,
    },
    isDefault: {
      type: Boolean,
      required: true,
      default: false,
    },
    visibility: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_VISIBILITY),
      default: FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY,
    },
    customerAccessMode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES),
      default: FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS,
    },
    assignedCustomerIds: [customerIdField],
    sections: [frameworkPackageSectionSchema],
    runtimeSettings: {
      type: frameworkPackageRuntimeSettingsSchema,
      default: () => ({}),
    },
    executionModel: {
      type: frameworkPackageExecutionModelSchema,
      default: () => ({}),
    },
    validationConfig: {
      type: [frameworkPackageValidationConfigSchema],
      select: false,
      default: undefined,
    },
    workflowPolicyConfig: {
      type: [frameworkPackageWorkflowPolicyConfigSchema],
      select: false,
      default: undefined,
    },
    validationBindings: [frameworkPackageValidationBindingSchema],
    workflowBindings: [frameworkPackageWorkflowBindingSchema],
    uiContractKey: {
      ...stringTokenField,
      default: '',
    },
    uiContractBinding: {
      type: frameworkPackageUiContractBindingSchema,
      default: null,
    },
    stateModelKey: nullableStringTokenField,
    stateModelVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
      validate: {
        validator(value) {
          return !value || semverPattern.test(String(value).trim())
        },
        message: 'State Model version must use semantic version format.',
      },
    },
    stateModelMode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_STATE_MODEL_MODES),
      default: FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL,
    },
    stateBindingMode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_STATE_BINDING_MODES),
      default: FRAMEWORK_PACKAGE_STATE_BINDING_MODES.STRICT,
    },
    statePersistence: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES),
      default: FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES.SESSION,
    },
    stateContractNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    availableOutputKeys: [stringTokenField],
    defaultOutputStyles: [stringTokenField],
    allowCustomerOutputDefinitions: {
      type: Boolean,
      default: false,
    },
    artifactRetentionDays: {
      type: Number,
      min: 0,
      max: 3650,
      default: 365,
    },
    allowOutputRevisionHistory: {
      type: Boolean,
      default: true,
    },
    compatibleWorkflowKeys: {
      type: [stringTokenField],
      select: false,
      default: undefined,
    },
    defaultAgentIds: {
      type: [stringTokenField],
      select: false,
      default: undefined,
    },
    requiredSkillIds: {
      type: [stringTokenField],
      select: false,
      default: undefined,
    },
    capabilities: {
      supportsPreviewMode: {
        type: Boolean,
        default: false,
      },
      supportsFullReport: {
        type: Boolean,
        default: false,
      },
      requiresValidationBeforePublish: {
        type: Boolean,
        default: true,
      },
    },
    validationRules: {
      type: frameworkPackageValidationRulesSchema,
      select: false,
      default: undefined,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.packageKey || ret.id || ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

frameworkPackageSchema.index(
  { frameworkKey: 1, version: 1 },
  { unique: true, name: 'unique_framework_package_version' },
)
frameworkPackageSchema.index(
  { packageKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      $and: [
        { packageKey: { $exists: true } },
        { packageKey: { $type: 'string' } },
        { packageKey: { $gt: '' } },
      ],
    },
    name: 'unique_framework_package_key',
  },
)
frameworkPackageSchema.index(
  { frameworkKey: 1, status: 1 },
  { name: 'framework_package_status_lookup' },
)
frameworkPackageSchema.index(
  { frameworkKey: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
    name: 'unique_default_framework_package',
  },
)
frameworkPackageSchema.index({ uiContractKey: 1, status: 1, updatedAt: -1 })
frameworkPackageSchema.index({ 'validationBindings.validationKey': 1, status: 1, updatedAt: -1 })
frameworkPackageSchema.index({ 'workflowBindings.policyKey': 1, status: 1, updatedAt: -1 })
frameworkPackageSchema.index({ 'sections.runtimePath': 1, status: 1, updatedAt: -1 })
frameworkPackageSchema.index({ frameworkKey: 1, updatedAt: -1 })
frameworkPackageSchema.index({ status: 1, updatedAt: -1 })

frameworkPackageSchema.statics.findActiveByFrameworkKey = function findActiveByFrameworkKey(frameworkKey) {
  return this.findOne({
    frameworkKey: normalizeFrameworkKey(frameworkKey),
    status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
    isDefault: true,
  })
}

frameworkPackageSchema.pre('validate', function normalizeFrameworkPackage(next) {
  if (this.isNew || this.isModified('frameworkKey')) {
    this.frameworkKey = normalizeFrameworkKey(this.frameworkKey)
  }

  if (this.isNew || this.isModified('frameworkName')) {
    this.frameworkName = normalizeFrameworkName(this.frameworkName)
  }

  if (this.isNew || this.isModified('version')) {
    this.version = normalizeVersion(this.version)
  }

  if (
    this.isNew
    || this.isModified('packageKey')
    || this.isModified('frameworkKey')
    || this.isModified('version')
  ) {
    const packageKey = String(this.packageKey || '').trim()
    const sourceKey = packageKey || (
      isReadyFrameworkPackageStatus(this.status)
        ? ''
        : `${this.frameworkKey}-${this.version}`
    )

    this.packageKey = String(sourceKey)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  if (this.isNew || this.isModified('packageName')) {
    this.packageName = normalizeFrameworkName(this.packageName || `${this.frameworkName} ${this.version}`)
  }

  if (this.isNew || this.isModified('assignedCustomerIds')) {
    this.assignedCustomerIds = normalizeCustomerIdList(this.assignedCustomerIds)
  }

  if ((this.isNew || this.isModified('lastCheckpointResult')) && !hasCheckpointResultValue(this.lastCheckpointResult)) {
    this.lastCheckpointResult = null
    this.lastCheckpointStatus = null
    this.lastCheckpointAt = null
  }

  if (this.visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY) {
    this.assignedCustomerIds = []
  }

  if (this.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS) {
    this.assignedCustomerIds = []
  }

  if (
    this.visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY
    && this.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
  ) {
    this.invalidate(
      'customerAccessMode',
      'Internal-only packages must use all-customers access mode.',
    )
  }

  if (
    this.visibility === FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE
    && this.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
    && (!Array.isArray(this.assignedCustomerIds) || this.assignedCustomerIds.length === 0)
  ) {
    this.invalidate(
      'assignedCustomerIds',
      'Assigned customers are required when customer access is selected customers.',
    )
  }

  if (Array.isArray(this.validationBindings)) {
    const seenBindingKeys = new Set()

    this.validationBindings.forEach((binding) => {
      if (!binding) return
      binding.validationKey = normalizeTokenValue(binding.validationKey)
      binding.trigger = String(binding.trigger || '').trim().toUpperCase()

      const triggerSlug = slugifyToken(String(binding.trigger || '').toLowerCase().replace(/_/g, '-'))
      const baseKey = `${binding.validationKey || 'validation'}-${triggerSlug || 'trigger'}`

      if (!String(binding.bindingKey || '').trim()) {
        binding.bindingKey = buildUniqueToken(baseKey, seenBindingKeys)
      } else {
        binding.bindingKey = slugifyToken(binding.bindingKey)
      }

      if (binding.bindingKey) {
        // Pre-seed so later bindings can avoid collisions with earlier explicit keys.
        seenBindingKeys.add(binding.bindingKey)
      }
    })

    // Validate uniqueness after generation/normalization.
    const bindingKeySeen = new Set()
    this.validationBindings.forEach((binding, index) => {
      const bindingKey = String(binding?.bindingKey || '').trim().toLowerCase()
      if (!bindingKey) return

      if (bindingKeySeen.has(bindingKey)) {
        this.invalidate(
          `validationBindings.${index}.bindingKey`,
          'Validation binding id must be unique within a package.',
        )
      }
      bindingKeySeen.add(bindingKey)
    })
  }

  if (Array.isArray(this.workflowBindings)) {
    const seenBindings = new Set()
    const seenPriorities = new Set()
    this.workflowBindings.forEach((binding, index) => {
      const policyKey = String(binding?.policyKey || '').trim().toLowerCase()
      const executionContext = String(binding?.executionContext || '').trim().toUpperCase()
      const bindingKey = `${policyKey}:${executionContext}`
      const priorityKey = `${executionContext}:${binding?.priority}`

      if (seenBindings.has(bindingKey)) {
        this.invalidate(
          `workflowBindings.${index}.policyKey`,
          'Workflow binding already exists for this execution context.',
        )
      }
      seenBindings.add(bindingKey)

      if (seenPriorities.has(priorityKey)) {
        this.invalidate(
          `workflowBindings.${index}.priority`,
          'Workflow binding priority must be unique within an execution context.',
        )
      }
      seenPriorities.add(priorityKey)
    })
  }

  if (Array.isArray(this.sections)) {
    const seenSectionKeys = new Set()
    const seenRuntimePaths = new Set()
    this.sections.forEach((section, index) => {
      const sectionKey = String(section?.sectionKey || '').trim().toLowerCase()
      if (!sectionKey) return

      section.sectionKey = sectionKey
      section.runtimePath = String(section?.runtimePath || '').trim()
      section.notes = String(section?.notes || '').trim()
      section.validationKeys = normalizeTokenList(section.validationKeys)

      if (seenSectionKeys.has(sectionKey)) {
        this.invalidate(
          `sections.${index}.sectionKey`,
          'Section keys must be unique.',
        )
      }
      seenSectionKeys.add(sectionKey)

      if (!section.runtimePath) return
      if (seenRuntimePaths.has(section.runtimePath)) {
        this.invalidate(
          `sections.${index}.runtimePath`,
          'Section runtime paths must be unique.',
        )
      }
      seenRuntimePaths.add(section.runtimePath)
    })
  }

  if (this.isNew || this.isModified('uiContractKey')) {
    this.uiContractKey = String(this.uiContractKey || '').trim().toLowerCase()
  }

  if (this.isNew || this.isModified('uiContractBinding')) {
    if (!this.uiContractBinding || !String(this.uiContractBinding.key || '').trim()) {
      this.uiContractBinding = null
    } else {
      this.uiContractBinding.key = String(this.uiContractBinding.key || '').trim().toLowerCase()
      this.uiContractBinding.version = String(this.uiContractBinding.version || '').trim() || null
      this.uiContractBinding.status = String(this.uiContractBinding.status || '').trim().toUpperCase()
      this.uiContractBinding.compatibilityMode = String(this.uiContractBinding.compatibilityMode || '').trim().toUpperCase()
      this.uiContractBinding.resolvedAt = this.uiContractBinding.resolvedAt || new Date()
    }
  }

  if (this.isNew || this.isModified('stateModelKey')) {
    const stateModelKey = String(this.stateModelKey || '').trim().toLowerCase()
    this.stateModelKey = stateModelKey || null
  }

  if (this.isNew || this.isModified('stateModelVersion')) {
    const stateModelVersion = String(this.stateModelVersion || '').trim()
    this.stateModelVersion = stateModelVersion || null
  }

  if (this.isNew || this.isModified('stateModelMode')) {
    this.stateModelMode = String(this.stateModelMode || FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL)
      .trim()
      .toUpperCase()
  }

  if (this.stateModelMode === FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL) {
    this.stateModelKey = null
    this.stateModelVersion = null
  }

  if (this.isNew || this.isModified('stateBindingMode')) {
    this.stateBindingMode = String(this.stateBindingMode || FRAMEWORK_PACKAGE_STATE_BINDING_MODES.STRICT)
      .trim()
      .toUpperCase()
  }

  if (this.isNew || this.isModified('statePersistence')) {
    this.statePersistence = String(this.statePersistence || FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES.SESSION)
      .trim()
      .toUpperCase()
  }

  if (this.isNew || this.isModified('stateContractNotes')) {
    this.stateContractNotes = String(this.stateContractNotes || '').trim()
  }

  if (
    this.stateModelMode === FRAMEWORK_PACKAGE_STATE_MODEL_MODES.EXTERNAL
    && !String(this.stateModelKey || '').trim()
  ) {
    this.invalidate('stateModelKey', 'State Model key is required when State Model Mode is EXTERNAL.')
  }

  if (
    this.stateModelMode === FRAMEWORK_PACKAGE_STATE_MODEL_MODES.EXTERNAL
    && !String(this.stateModelVersion || '').trim()
  ) {
    this.invalidate('stateModelVersion', 'State Model version is required when State Model Mode is EXTERNAL.')
  }

  if (isReadyFrameworkPackageStatus(this.status) && !String(this.packageKey || '').trim()) {
    this.invalidate('packageKey', 'Package key is required before validation.')
  }

  if (
    isReadyFrameworkPackageStatus(this.status)
    && hasConfiguredSections(this.sections)
    && !String(this.uiContractKey || '').trim()
  ) {
    this.invalidate(
      'uiContractKey',
      'UI Contract is required before validation when sections are configured.',
    )
  }

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    if (this.isModified(field) && this[field] !== undefined && this[field] !== null) {
      this.invalidate(field, DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES[field])
    }
  }

  if (this.isNew || this.isModified('availableOutputKeys')) {
    this.availableOutputKeys = normalizeTokenList(this.availableOutputKeys)
  }

  if (this.isNew || this.isModified('defaultOutputStyles')) {
    this.defaultOutputStyles = normalizeTokenList(this.defaultOutputStyles)
  }

  if (this.isNew || this.isModified('status') || this.isModified('isDefault')) {
    if (this.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
      this.isDefault = false
    }
    this.versionStatus = mapRuntimeControlStatusToVersionStatus(this.status)
    this.isLocked = isReadyFrameworkPackageStatus(this.status)

    if (this.isLocked) {
      this.lockedAt = this.lockedAt || new Date()
      this.lockedReason = this.lockedReason || 'Framework package reached a governed runtime release boundary.'
    } else {
      this.lockedAt = null
      this.lockedBy = null
      this.lockedReason = ''
    }
  }

  if (this.isNew || this.isModified('lockedReason')) {
    this.lockedReason = String(this.lockedReason || '').trim()
  }

  next()
})

const FrameworkPackage = mongoose.model('FrameworkPackage', frameworkPackageSchema)

export default FrameworkPackage
