import mongoose from 'mongoose'

export const RUNTIME_CONTROL_VERSION_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  ARCHIVED: 'ARCHIVED',
})

export const RUNTIME_CONTROL_COMPATIBILITY_MODES = Object.freeze({
  STRICT: 'STRICT',
  INHERITED_MINOR: 'INHERITED_MINOR',
  OPEN: 'OPEN',
})

// Version and lock fields are model-owned governance metadata; request validators should not expose them as normal form inputs.
export const LOCKED_RUNTIME_CONTROL_EDIT_MESSAGE =
  'Locked Runtime Control records cannot be edited directly. Clone the record to make behavior changes.'

export const RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS = Object.freeze({
  RuntimePathRegistry: Object.freeze([
    'pathKey',
    'frameworkKeys',
    'scope',
    'allowedOperations',
    'dataType',
    'category',
    'sourceType',
    'isProtected',
    'allowedValues',
    'allowedValueLabels',
    'uiControl',
    'defaultValue',
    'minValue',
    'maxValue',
    'minLength',
    'maxLength',
    'regexPattern',
    'isNullable',
  ]),
  SkillRoleRegistry: Object.freeze([
    'roleKey',
    'label',
    'description',
    'status',
    'isSystem',
  ]),
  RuntimeSkill: Object.freeze([
    'key',
    'status',
    'supportedFrameworkKeys',
    'skillRoleKey',
    'category',
    'type',
    'executionMode',
    'inputContract',
    'outputContract',
    'runtimeConfig',
    'primaryOutputKey',
    'outputBindings',
    'allowedReadPaths',
    'allowedWritePaths',
    'forbiddenWritePaths',
    'executionConfig',
    'referenceAssets',
  ]),
  ValidationRegistry: Object.freeze([
    'key',
    'status',
    'supportedFrameworkKeys',
    'category',
    'severity',
    'producerSkillId',
    'defaultAgentIds',
    'outputPath',
    'resultType',
    'passFieldPath',
    'detailsFieldPath',
    'policyUsable',
    'packageUsable',
    'requiresLatestRun',
    'freshnessDefaultMinutes',
    'blockingDefault',
    'warningOnlyDefault',
    'allowManualRun',
    'executionMode',
  ]),
  RuntimeAgent: Object.freeze([
    'key',
    'status',
    'agentType',
    'supportedFrameworkKeys',
    'requiredSkillRoleKeys',
    'defaultSkillIds',
    'primarySkillIds',
    'optionalSkillIds',
    'executionPlan',
    'promptConfig',
    'inputContract',
    'outputContract',
    'policies',
  ]),
  WorkflowPolicy: Object.freeze([
    'key',
    'status',
    'policyType',
    'priority',
    'frameworkKeys',
    'appliesTo',
    'triggerEvent',
    'triggerMode',
    'actorScope',
    'cooldownSeconds',
    'reevaluateOnRetry',
    'governedAction',
    'decisionMode',
    'executionType',
    'steps',
    'conditions',
    'routingMode',
    'primaryAgentId',
    'fallbackAgentId',
    'timeoutMs',
    'retryOverride',
    'requireSuccess',
    'requiredValidationKeys',
    'validationBlockingOnFail',
    'validationWarningOnly',
    'validationFreshnessMinutes',
    'validationRequireLatestRun',
    'onPassEffects',
    'onFailEffects',
    'overrideAllowed',
    'overrideRoles',
    'approvalRequired',
    'escalationRoleKey',
    'escalateTo',
    'escalationMessage',
    'slaMinutes',
    'orderedSteps',
    'requiredAgentIds',
    'requiredSkillIds',
    'gatingRules',
  ]),
  UIContract: Object.freeze([
    'uiContractKey',
    'name',
    'description',
    'status',
    'frameworkKeys',
    'sourcePackageKey',
    'sourcePackageVersion',
    'sourceFrameworkKey',
    'sections',
    'lifecycleStages',
    'actions',
    'isSystem',
    'isProtected',
  ]),
})

const normalizeNullableText = (value) => {
  if (value === undefined || value === null) return null

  const normalized = String(value).trim()
  return normalized || null
}

const normalizeTextList = (values, { lower = false } = {}) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .map((value) => (lower ? value.toLowerCase() : value))
    .filter(Boolean)

  return [...new Set(normalized)]
}

export const mapRuntimeControlStatusToVersionStatus = (status) => {
  const normalized = String(status || '').trim().toUpperCase()

  if (normalized === 'ACTIVE' || normalized === 'VALIDATED') {
    return RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
  }

  if (normalized === 'DEPRECATED') {
    return RUNTIME_CONTROL_VERSION_STATUSES.DEPRECATED
  }

  if (normalized === 'ARCHIVED' || normalized === 'INACTIVE') {
    return RUNTIME_CONTROL_VERSION_STATUSES.ARCHIVED
  }

  // Unknown or blank statuses are treated as DRAFT for lazy backfill compatibility;
  // model enums and request validators remain responsible for rejecting invalid lifecycle values.
  return RUNTIME_CONTROL_VERSION_STATUSES.DRAFT
}

const buildRuntimeControlVersioningFields = ({ compatibilityModeDefault }) => ({
  componentVersion: {
    type: Number,
    min: 1,
    max: 100000,
    default: 1,
  },
  versionStatus: {
    type: String,
    enum: Object.values(RUNTIME_CONTROL_VERSION_STATUSES),
    default: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
  },
  lineageId: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 180,
    default: null,
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
  lockedByPackageKeys: {
    type: [String],
    default: [],
  },
  introducedInVersion: {
    type: String,
    trim: true,
    maxlength: 50,
    default: null,
  },
  deprecatedInVersion: {
    type: String,
    trim: true,
    maxlength: 50,
    default: null,
  },
  compatibilityTags: {
    type: [String],
    default: [],
  },
  compatibilityMode: {
    type: String,
    enum: Object.values(RUNTIME_CONTROL_COMPATIBILITY_MODES),
    default: compatibilityModeDefault,
  },
  clonedFromStableId: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 180,
    default: null,
  },
  supersedesStableId: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 180,
    default: null,
  },
  supersededByStableId: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 180,
    default: null,
  },
})

export const applyRuntimeControlVersioning = (
  schema,
  {
    lockImpactingFields = [],
    compatibilityModeDefault = RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  } = {},
) => {
  const fieldDefinitions = buildRuntimeControlVersioningFields({ compatibilityModeDefault })

  for (const [field, definition] of Object.entries(fieldDefinitions)) {
    if (!schema.path(field)) {
      schema.add({ [field]: definition })
    }
  }

  schema.post('init', function captureRuntimeControlOriginalLockState(doc) {
    doc.$locals.runtimeControlOriginalIsLocked = doc.isLocked === true
  })

  schema.pre('validate', function normalizeRuntimeControlVersioning(next) {
    const mappedVersionStatus = mapRuntimeControlStatusToVersionStatus(this.status)
    if (
      !this.versionStatus
      || this.$isDefault?.('versionStatus')
      || (this.isModified('status') && !this.isModified('versionStatus'))
    ) {
      this.versionStatus = mappedVersionStatus
    }

    if (!Number.isFinite(Number(this.componentVersion)) || Number(this.componentVersion) < 1) {
      this.componentVersion = 1
    }

    if (!this.lineageId && this.stableId) {
      this.lineageId = this.stableId
    }

    for (const field of [
      'lineageId',
      'introducedInVersion',
      'deprecatedInVersion',
      'clonedFromStableId',
      'supersedesStableId',
      'supersededByStableId',
    ]) {
      if (this.isNew || this.isModified(field)) {
        this[field] = normalizeNullableText(this[field])
      }
    }

    if (this.isNew || this.isModified('lockedReason')) {
      this.lockedReason = String(this.lockedReason || '').trim()
    }

    if (this.isNew || this.isModified('lockedByPackageKeys')) {
      this.lockedByPackageKeys = normalizeTextList(this.lockedByPackageKeys, { lower: true })
    }

    if (this.isNew || this.isModified('compatibilityTags')) {
      this.compatibilityTags = normalizeTextList(this.compatibilityTags)
    }

    if (this.isNew || this.isModified('compatibilityMode')) {
      const compatibilityMode = String(this.compatibilityMode || compatibilityModeDefault)
        .trim()
        .toUpperCase()
      this.compatibilityMode = Object.values(RUNTIME_CONTROL_COMPATIBILITY_MODES).includes(compatibilityMode)
        ? compatibilityMode
        : compatibilityModeDefault
    }

    const wasLoadedLocked =
      this.$locals?.runtimeControlOriginalIsLocked === true
      || this.$__?.priorDoc?.isLocked === true
    const isLockedForValidation = this.isLocked === true || wasLoadedLocked

    if (!this.isNew && isLockedForValidation === true) {
      if (this.isModified('isLocked') && this.isLocked !== true) {
        this.invalidate('isLocked', LOCKED_RUNTIME_CONTROL_EDIT_MESSAGE)
      }

      for (const field of lockImpactingFields) {
        if (this.isModified(field)) {
          this.invalidate(field, LOCKED_RUNTIME_CONTROL_EDIT_MESSAGE)
        }
      }
    }

    next()
  })
}
