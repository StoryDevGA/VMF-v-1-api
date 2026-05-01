import mongoose from 'mongoose'

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
  ON_STAGE_CHANGE: 'ON_STAGE_CHANGE',
  ON_PUBLISH: 'ON_PUBLISH',
  MANUAL: 'MANUAL',
})

export const FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS = Object.freeze({
  ON_CREATE: 'ON_CREATE',
  ON_SAVE: 'ON_SAVE',
  ON_SUBMIT: 'ON_SUBMIT',
  ON_STAGE_ENTER: 'ON_STAGE_ENTER',
  ON_STAGE_EXIT: 'ON_STAGE_EXIT',
  ON_APPROVAL: 'ON_APPROVAL',
  ON_PUBLISH: 'ON_PUBLISH',
})

export const FRAMEWORK_PACKAGE_EXECUTION_MODES = Object.freeze({
  EVENT_DRIVEN: 'EVENT_DRIVEN',
  MANUAL: 'MANUAL',
})

export const FRAMEWORK_PACKAGE_STATE_MODELS = Object.freeze({
  LIFECYCLE_BASED: 'LIFECYCLE_BASED',
  FREEFORM: 'FREEFORM',
})

export const FRAMEWORK_PACKAGE_STATE_MODEL_MODES = Object.freeze({
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
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

const DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES = Object.freeze({
  compatibleWorkflowKeys: 'compatibleWorkflowKeys is deprecated. Use workflowBindings instead.',
  defaultAgentIds: 'defaultAgentIds is deprecated. Agents are assigned through workflow policies.',
  requiredSkillIds: 'requiredSkillIds is deprecated. Skills are resolved through workflow policies.',
  validationRules: 'validationRules is deprecated. Use sections and validationBindings instead.',
  validationConfig: 'validationConfig is deprecated. Use validationBindings instead.',
  workflowPolicyConfig: 'workflowPolicyConfig is deprecated. Use workflowBindings instead.',
})

const DEPRECATED_FRAMEWORK_PACKAGE_FIELDS = Object.freeze(Object.keys(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES))

const isReadyFrameworkPackageStatus = (status) =>
  READY_FRAMEWORK_PACKAGE_STATUSES.has(String(status || '').trim().toUpperCase())

const hasConfiguredSections = (sections = []) =>
  Array.isArray(sections)
  && sections.some(
    (section) =>
      String(section?.sectionKey || '').trim()
      || String(section?.runtimePath || '').trim(),
  )

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
    stateModelKey: nullableStringTokenField,
    stateModelVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    stateModelMode: {
      type: String,
      enum: Object.values(FRAMEWORK_PACKAGE_STATE_MODEL_MODES),
      default: FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL,
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
        ret.id = ret._id
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
  { frameworkKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE },
    name: 'unique_active_framework_package',
  },
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
    const seenBindings = new Set()
    this.validationBindings.forEach((binding, index) => {
      const validationKey = String(binding?.validationKey || '').trim().toLowerCase()
      const trigger = String(binding?.trigger || '').trim().toUpperCase()
      const key = `${validationKey}:${trigger}`

      if (seenBindings.has(key)) {
        this.invalidate(
          `validationBindings.${index}.validationKey`,
          'Validation binding already exists for this trigger.',
        )
      }
      seenBindings.add(key)
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
    this.isDefault = this.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE
  }

  next()
})

const FrameworkPackage = mongoose.model('FrameworkPackage', frameworkPackageSchema)

export default FrameworkPackage
