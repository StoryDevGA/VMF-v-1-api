import mongoose from 'mongoose'
import { isDeepStrictEqual } from 'node:util'
import FrameworkPackage, {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_STATE_MODEL_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_VISIBILITY,
} from '../models/FrameworkPackage.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import ValidationRegistry, { VALIDATION_REGISTRY_STATUSES } from '../models/ValidationRegistry.js'
import WorkflowPolicy, {
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_STEP_TYPES,
} from '../models/WorkflowPolicy.js'
import UIContract, { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import SkillRoleRegistry, { SKILL_ROLE_REGISTRY_STATUSES } from '../models/SkillRoleRegistry.js'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../models/RuntimePathRegistry.js'
import User from '../models/User.js'
import {
  RUNTIME_CONTROL_VERSION_STATUSES,
} from '../utils/runtimeControlVersioning.js'
import auditService from '../services/auditService.js'
import {
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import {
  DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES,
  DEPRECATED_FRAMEWORK_PACKAGE_FIELDS,
} from '../constants/frameworkPackageContract.js'

const DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE = 'Framework key and version must be unique.'
const FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE = 'Framework package not found.'
const ACTIVE_DEFAULT_CONFLICT_MESSAGE = 'Only one active default package is allowed per framework.'
const ACTIVATION_REQUIRES_VALIDATED_MESSAGE = 'Only validated framework packages can be activated.'
const ACTIVATION_ENDPOINT_REQUIRED_MESSAGE = 'Use the activation endpoint to mark a framework package active.'
const ACTIVE_PACKAGE_STATUS_CHANGE_MESSAGE =
  'Active framework packages cannot change lifecycle in place. Activate another validated package instead.'
const ACTIVE_PACKAGE_EDIT_MESSAGE =
  'Active framework packages cannot be edited directly. Clone the package to make changes.'
const VALIDATED_PACKAGE_STRUCTURAL_LOCK_MESSAGE =
  'Validated framework packages lock structural runtime fields. Return the package to Draft or clone it before changing runtime structure.'
const READY_FRAMEWORK_PACKAGE_STATUSES = new Set([
  FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
  FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
])
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

const STRUCTURAL_LOCK_FIELDS = Object.freeze([
  'frameworkKey',
  'version',
  'packageKey',
  'sections',
  'runtimeSettings',
  'executionModel',
  'validationBindings',
  'workflowBindings',
  'uiContractKey',
  'stateModelKey',
  'stateModelVersion',
  'stateModelMode',
  'stateBindingMode',
  'statePersistence',
])

const DEPENDENCY_LOCK_REASON = 'Locked by Framework Package validation.'

const DEPENDENCY_LOCK_GROUPS = Object.freeze([
  Object.freeze({
    key: 'runtimePaths',
    collectionKey: 'RuntimePathRegistry',
    model: RuntimePathRegistry,
  }),
  Object.freeze({
    key: 'validations',
    collectionKey: 'ValidationRegistry',
    model: ValidationRegistry,
  }),
  Object.freeze({
    key: 'workflowPolicies',
    collectionKey: 'WorkflowPolicy',
    model: WorkflowPolicy,
  }),
  Object.freeze({
    key: 'agents',
    collectionKey: 'RuntimeAgent',
    model: RuntimeAgent,
  }),
  Object.freeze({
    key: 'skills',
    collectionKey: 'RuntimeSkill',
    model: RuntimeSkill,
  }),
  Object.freeze({
    key: 'skillRoles',
    collectionKey: 'SkillRoleRegistry',
    model: SkillRoleRegistry,
  }),
  Object.freeze({
    key: 'uiContract',
    collectionKey: 'UIContract',
    model: UIContract,
    singleton: true,
  }),
])

const FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES = Object.freeze({
  PASS: 'PASS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  FAIL: 'FAIL',
})

const FRAMEWORK_PACKAGE_CHECKPOINT_MODES = Object.freeze({
  FULL: 'FULL',
  ACTIVATION: 'ACTIVATION',
  DRY_RUN: 'DRY_RUN',
})

const FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES = Object.freeze({
  BLOCKING: 'BLOCKING',
  WARNING: 'WARNING',
  INFO: 'INFO',
})

const OPTIONAL_FRAMEWORK_PACKAGE_FIELD_MESSAGES = Object.freeze({
  compatibleWorkflowKeys: 'compatibleWorkflowKeys is deprecated and not configured.',
  defaultAgentIds: 'defaultAgentIds is deprecated and not configured.',
  requiredSkillIds: 'requiredSkillIds is deprecated and not configured.',
  validationRules: 'validationRules is deprecated and not configured.',
  validationConfig: 'validationConfig is deprecated and not configured.',
  workflowPolicyConfig: 'workflowPolicyConfig is deprecated and not configured.',
})

const CHECKPOINT_CATEGORY_BY_INTEGRITY_GROUP = Object.freeze({
  'Configuration Integrity': 'PACKAGE_STRUCTURE',
  'Sections Integrity': 'RUNTIME_PATHS',
  'Dependency Integrity': 'DEPENDENCY_GRAPH',
  'UI Contract Integrity': 'UI_CONTRACT',
  'State Contract Integrity': 'STATE_CONTRACT',
  'Output Placeholder Integrity': 'PACKAGE_STRUCTURE',
})

const CHECKPOINT_CATEGORY_BY_FIELD = Object.freeze({
  packageKey: 'PACKAGE_STRUCTURE',
  sections: 'RUNTIME_PATHS',
  uiContractKey: 'UI_CONTRACT',
  validationBindings: 'VALIDATION_BINDINGS',
  workflowBindings: 'WORKFLOW_BINDINGS',
  dependencyLock: 'DEPENDENCY_LOCK',
  stateModelKey: 'STATE_CONTRACT',
  stateModelVersion: 'STATE_CONTRACT',
  stateModelMode: 'STATE_CONTRACT',
})

const FRAMEWORK_PACKAGE_AUDITED_FIELDS = Object.freeze([
  'frameworkKey',
  'frameworkName',
  'version',
  'description',
  'status',
  'packageKey',
  'packageName',
  'packageScope',
  'packageType',
  'derivedFromPackageId',
  'visibility',
  'customerAccessMode',
  'assignedCustomerIds',
  'sections',
  'runtimeSettings',
  'executionModel',
  'validationBindings',
  'workflowBindings',
  'uiContractKey',
  'uiContractBinding',
  'stateModelKey',
  'stateModelVersion',
  'stateModelMode',
  'stateBindingMode',
  'statePersistence',
  'stateContractNotes',
  'availableOutputKeys',
  'defaultOutputStyles',
  'allowCustomerOutputDefinitions',
  'artifactRetentionDays',
  'allowOutputRevisionHistory',
  'capabilities',
])

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (value?._bsontype === 'ObjectId' || value?.constructor?.name === 'ObjectId') {
      return typeof value.toString === 'function' ? value.toString() : String(value)
    }
    if (typeof value.id === 'string' && value.id.trim()) return value.id
    if (typeof value._id === 'string' && value._id.trim()) return value._id
    if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  }
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

const buildActorSummary = (req) => {
  const actor = req.scopes?.user
  const id = toIdString(actor?.id || actor?._id || req.context?.userId || req.userId)

  if (!id) return null

  return {
    id,
    ...(actor?.name ? { name: actor.name } : {}),
    ...(actor?.email ? { email: actor.email } : {}),
  }
}

const serializeUserSummary = (value) => {
  if (!value) return null

  if (typeof value === 'string') {
    return { id: value }
  }

  const id = toIdString(value.id || value._id || value)
  if (!id) return null

  return {
    id,
    ...(value.name ? { name: value.name } : {}),
    ...(value.email ? { email: value.email } : {}),
  }
}

const serializeCheckpointRunBy = (runBy, fallbackActor = null) => {
  const runBySummary = serializeUserSummary(runBy)
  const fallbackSummary = serializeUserSummary(fallbackActor)

  if (!runBySummary) return fallbackSummary

  if (fallbackSummary?.id && runBySummary.id === fallbackSummary.id) {
    const mergedSummary = { ...runBySummary }
    if (!mergedSummary.name && fallbackSummary.name) {
      mergedSummary.name = fallbackSummary.name
    }
    if (!mergedSummary.email && fallbackSummary.email) {
      mergedSummary.email = fallbackSummary.email
    }
    return mergedSummary
  }

  return runBySummary
}

const serializeCheckpointResult = (checkpoint, { fallbackRunBy = null } = {}) => {
  if (!checkpoint) return checkpoint

  const serializedCheckpoint = cloneAuditValue(checkpoint)
  serializedCheckpoint.runBy = serializeCheckpointRunBy(serializedCheckpoint.runBy, fallbackRunBy)
  return serializedCheckpoint
}

const hasStoredCheckpointResult = (checkpoint) =>
  checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint) && !(checkpoint instanceof Date)

const resolveCheckpointRunByFallback = async ({ checkpoint, fallbackRunBy = null } = {}) => {
  const runBySummary = serializeCheckpointRunBy(checkpoint?.runBy, fallbackRunBy)
  if (!runBySummary?.id || runBySummary.name || runBySummary.email) return fallbackRunBy
  if (!mongoose.Types.ObjectId.isValid(runBySummary.id)) return fallbackRunBy

  try {
    const user = await User.findById(runBySummary.id).select('name email').lean()
    return serializeUserSummary(user) || fallbackRunBy
  } catch {
    return fallbackRunBy
  }
}

const getCheckpointRunByResolutionId = ({ checkpoint, fallbackRunBy = null } = {}) => {
  const runBySummary = serializeCheckpointRunBy(checkpoint?.runBy, fallbackRunBy)
  if (!runBySummary?.id || runBySummary.name || runBySummary.email) return ''
  if (!mongoose.Types.ObjectId.isValid(runBySummary.id)) return ''
  return runBySummary.id
}

const resolveCheckpointRunByFallbacksById = async (frameworkPackages = []) => {
  const runByIds = Array.from(new Set(frameworkPackages
    .map((frameworkPackage) => getCheckpointRunByResolutionId({
      checkpoint: frameworkPackage?.lastCheckpointResult,
      fallbackRunBy: frameworkPackage?.activatedBy || frameworkPackage?.updatedBy,
    }))
    .filter(Boolean)))

  if (runByIds.length === 0) return new Map()

  try {
    const users = await User.find({ _id: { $in: runByIds } }).select('name email').lean()
    return new Map((users || [])
      .map((user) => serializeUserSummary(user))
      .filter(Boolean)
      .map((userSummary) => [userSummary.id, userSummary]))
  } catch {
    return new Map()
  }
}

const tokenPattern = /^[a-z][a-z0-9-]*$/

const slugifyToken = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized) return ''
  if (tokenPattern.test(normalized)) return normalized

  const prefixed = `binding-${normalized}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return tokenPattern.test(prefixed) ? prefixed : 'binding'
}

const ensureValidationBindingKeys = (bindings = []) => {
  if (!Array.isArray(bindings)) return []

  const seen = new Set()
  return bindings.map((binding) => {
    const normalized = { ...(binding || {}) }
    const validationKey = slugifyToken(normalized.validationKey)
    const trigger = String(normalized.trigger || '').trim().toUpperCase()
    const triggerSlug = slugifyToken(trigger.toLowerCase().replace(/_/g, '-'))
    const base = `${validationKey || 'validation'}-${triggerSlug || 'trigger'}`

    // Request validators are the strict write gate; this keeps legacy/read-path payloads serializable.
    let bindingKey = slugifyToken(normalized.bindingKey)
    if (!bindingKey) {
      bindingKey = base
      let counter = 2
      while (seen.has(bindingKey)) {
        bindingKey = `${base}-${counter}`
        counter += 1
      }
    }

    seen.add(bindingKey)
    normalized.validationKey = validationKey
    normalized.trigger = trigger
    normalized.bindingKey = bindingKey
    return normalized
  })
}

const serializeFrameworkPackage = (
  frameworkPackage,
  { fallbackUpdatedBy = null, checkpointRunByFallback = null } = {},
) => {
  const plain = typeof frameworkPackage?.toJSON === 'function'
    ? frameworkPackage.toJSON()
    : { ...frameworkPackage }

  if (!plain.id && plain._id) {
    plain.id = toIdString(plain._id)
  }

  delete plain._id
  delete plain.__v

  const serializedUpdatedBy = serializeUserSummary(plain.updatedBy)
  plain.createdBy = serializeUserSummary(plain.createdBy)
  plain.updatedBy =
    (serializedUpdatedBy?.name || serializedUpdatedBy?.email)
      ? serializedUpdatedBy
      : (fallbackUpdatedBy || serializedUpdatedBy)
  plain.activatedBy = serializeUserSummary(plain.activatedBy)
  plain.lastCheckpointResult = serializeCheckpointResult(plain.lastCheckpointResult, {
    fallbackRunBy: checkpointRunByFallback || plain.activatedBy || plain.updatedBy,
  })
  if (!hasStoredCheckpointResult(plain.lastCheckpointResult)) {
    plain.lastCheckpointResult = null
    plain.lastCheckpointStatus = null
    plain.lastCheckpointAt = null
  }

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    delete plain[field]
  }

  plain.validationBindings = ensureValidationBindingKeys(plain.validationBindings)

  return plain
}

const omitDeprecatedFrameworkPackageFields = (payload = {}) => {
  const sanitizedPayload = { ...payload }

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    delete sanitizedPayload[field]
  }

  return sanitizedPayload
}

const filterPayloadToRequestedFields = (payload = {}, requestedFields = null) => {
  if (!requestedFields || typeof requestedFields.has !== 'function') return payload

  return Object.entries(payload).reduce((filteredPayload, [field, value]) => {
    if (requestedFields.has(field)) {
      filteredPayload[field] = value
    }
    return filteredPayload
  }, {})
}

const buildFrameworkPackageLabel = (frameworkPackage) =>
  `${frameworkPackage.frameworkKey} ${frameworkPackage.version}`

const isDuplicateFrameworkPackageVersionError = (err) =>
  err?.code === 11000
  && err?.keyPattern?.frameworkKey
  && err?.keyPattern?.version

const isActiveDefaultConflictError = (err) =>
  err?.code === 11000
  && err?.keyPattern?.frameworkKey
  && (err?.keyPattern?.status || err?.keyPattern?.isDefault)

const createActiveDefaultInvariantError = () => {
  const error = new Error(ACTIVE_DEFAULT_CONFLICT_MESSAGE)
  error.code = 'FRAMEWORK_PACKAGE_ACTIVE_DEFAULT_CONFLICT'
  return error
}

const isActiveDefaultInvariantError = (err) =>
  err?.code === 'FRAMEWORK_PACKAGE_ACTIVE_DEFAULT_CONFLICT'

const sendConflict = (res, req, message, details = {}) =>
  res.status(409).json({
    error: {
      code: 'CONFLICT',
      message,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      requestId: req.requestId,
    },
  })

const sendValidationFailed = (res, req, details, message = 'Please check the form for errors.') =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details,
      requestId: req.requestId,
    },
  })

const populateFrameworkPackage = async (frameworkPackage) => {
  if (!frameworkPackage || typeof frameworkPackage.populate !== 'function') {
    return frameworkPackage
  }

  await frameworkPackage.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
    { path: 'activatedBy', select: 'name email' },
  ])

  return frameworkPackage
}

const applySession = (queryOrPromise, session) =>
  queryOrPromise && typeof queryOrPromise.session === 'function'
    ? queryOrPromise.session(session)
    : queryOrPromise

const buildListFilter = ({ q, status, frameworkKey }) => {
  const filter = {}

  if (status) {
    filter.status = status
  }

  if (frameworkKey) {
    filter.frameworkKey = frameworkKey
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { frameworkKey: regex },
      { frameworkName: regex },
      { version: regex },
      { description: regex },
      { status: regex },
      { packageKey: regex },
      { packageName: regex },
      { packageScope: regex },
      { packageType: regex },
      { visibility: regex },
      { customerAccessMode: regex },
      { assignedCustomerIds: regex },
      { 'sections.sectionKey': regex },
      { 'sections.runtimePath': regex },
      { 'sections.validationKeys': regex },
      { 'validationBindings.validationKey': regex },
      { 'validationBindings.bindingKey': regex },
      { 'validationBindings.trigger': regex },
      { 'workflowBindings.policyKey': regex },
      { 'workflowBindings.executionContext': regex },
      { uiContractKey: regex },
      { 'executionModel.mode': regex },
      { 'executionModel.stateModel': regex },
      { 'executionModel.evaluationMode': regex },
      { availableOutputKeys: regex },
      { defaultOutputStyles: regex },
    ]
  }

  return filter
}

const normalizeSectionKey = (value) => String(value || '').trim().toLowerCase()

const normalizeRuntimePath = (value) => String(value || '').trim()

const getStructuralSections = (sections = []) =>
  Array.isArray(sections) ? sections : []

const isCustomUIContractSection = (section = {}) =>
  section?.isCustom === true
  || String(section?.source || '').trim().toUpperCase() === 'CUSTOM'

const summarizeUIContractSectionMapping = ({
  packageSections = [],
  uiSections = [],
} = {}) => {
  const normalizedPackageSections = getStructuralSections(packageSections)
  const packageSectionByKey = new Map(
    normalizedPackageSections
      .map((section) => [normalizeSectionKey(section?.sectionKey), section])
      .filter(([sectionKey]) => sectionKey),
  )
  const packageBackedUiSections = getStructuralSections(uiSections)
    .filter((section) => !isCustomUIContractSection(section))
  const uiSectionByKey = new Map(
    packageBackedUiSections
      .map((section) => [normalizeSectionKey(section?.sectionKey), section])
      .filter(([sectionKey]) => sectionKey),
  )
  const custom = getStructuralSections(uiSections)
    .filter((section) => isCustomUIContractSection(section))
    .map((section) => normalizeSectionKey(section?.sectionKey))
    .filter(Boolean)
  const mapped = []
  const missing = []
  const orphaned = []
  const runtimePathMismatches = []

  for (const [sectionKey, packageSection] of packageSectionByKey.entries()) {
    const uiSection = uiSectionByKey.get(sectionKey)
    if (!uiSection) {
      missing.push(sectionKey)
      continue
    }

    const expectedRuntimePath = normalizeRuntimePath(packageSection?.runtimePath)
    const actualRuntimePath = normalizeRuntimePath(uiSection?.runtimePath)
    if (actualRuntimePath !== expectedRuntimePath) {
      runtimePathMismatches.push({
        sectionKey,
        expectedRuntimePath,
        actualRuntimePath,
      })
      continue
    }

    mapped.push(sectionKey)
  }

  for (const sectionKey of uiSectionByKey.keys()) {
    if (!packageSectionByKey.has(sectionKey)) {
      orphaned.push(sectionKey)
    }
  }

  return {
    mapped,
    missing,
    orphaned,
    runtimePathMismatches,
    custom,
    counts: {
      packageSections: packageSectionByKey.size,
      mapped: mapped.length,
      missing: missing.length,
      orphaned: orphaned.length,
      runtimePathMismatches: runtimePathMismatches.length,
      custom: custom.length,
    },
  }
}

const normalizeKeyValue = (value) => String(value || '').trim()

const isReadyFrameworkPackageStatus = (status) =>
  READY_FRAMEWORK_PACKAGE_STATUSES.has(String(status || '').trim().toUpperCase())

const normalizeStateModelMode = (value) =>
  String(value || FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL).trim().toUpperCase()

const hasConfiguredSections = (sections = []) =>
  getStructuralSections(sections).some(
    (section) =>
      normalizeSectionKey(section?.sectionKey) || normalizeRuntimePath(section?.runtimePath),
  )

const normalizeSectionStructureForLock = (sections = []) =>
  getStructuralSections(sections)
    .map((section) => ({
      sectionKey: normalizeSectionKey(section?.sectionKey),
      runtimePath: normalizeRuntimePath(section?.runtimePath),
      required: section?.required !== false,
      validationKeys: Array.isArray(section?.validationKeys)
        ? [...new Set(section.validationKeys.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
        : [],
    }))
    .filter((section) => section.sectionKey || section.runtimePath)

const getStructuralLockComparableValue = (field, value) => {
  if (field === 'sections') {
    return normalizeSectionStructureForLock(value)
  }

  if (field === 'stateModelKey') {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized || null
  }

  if (field === 'stateModelVersion') {
    const normalized = String(value || '').trim()
    return normalized || null
  }

  if (field === 'stateModelMode' || field === 'stateBindingMode' || field === 'statePersistence') {
    return String(value || '').trim().toUpperCase()
  }

  if (field === 'uiContractKey' || field === 'packageKey') {
    return String(value || '').trim().toLowerCase()
  }

  if (field === 'frameworkKey') {
    return String(value || '').trim().toUpperCase()
  }

  return cloneAuditValue(value)
}

const validateStructuralLocks = (frameworkPackage, payload = {}) => {
  if (frameworkPackage.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    return {
      _message: ACTIVE_PACKAGE_EDIT_MESSAGE,
      _reason: 'FRAMEWORK_PACKAGE_ACTIVE_EDIT_LOCKED',
    }
  }

  if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.VALIDATED) {
    return {}
  }

  const requestedStatus = String(payload.status || '').trim().toUpperCase()
  if (requestedStatus === FRAMEWORK_PACKAGE_STATUSES.DRAFT) {
    return {}
  }

  const details = {}
  for (const field of STRUCTURAL_LOCK_FIELDS) {
    if (payload[field] === undefined) continue

    const previousValue = getStructuralLockComparableValue(field, frameworkPackage[field])
    const nextValue = getStructuralLockComparableValue(field, payload[field])
    if (isDeepStrictEqual(previousValue, nextValue)) continue

    details[field] = VALIDATED_PACKAGE_STRUCTURAL_LOCK_MESSAGE
  }

  if (Object.keys(details).length === 0) return {}

  return {
    ...details,
    _message: VALIDATED_PACKAGE_STRUCTURAL_LOCK_MESSAGE,
    _reason: 'FRAMEWORK_PACKAGE_VALIDATED_STRUCTURAL_LOCKED',
  }
}

export const validateDeprecatedFrameworkPackageFields = (payload = {}) => {
  const details = {}

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    if (!(field in payload)) continue

    details[field] = DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES[field]
  }

  return details
}

const validateFrameworkPackageReadiness = ({
  status,
  packageKey,
  sections = [],
  uiContractKey = '',
}) => {
  const details = {}
  if (!isReadyFrameworkPackageStatus(status)) return details

  if (!normalizeKeyValue(packageKey)) {
    details.packageKey = 'Package key is required before validation.'
  }

  if (hasConfiguredSections(sections) && !normalizeKeyValue(uiContractKey)) {
    details.uiContractKey = 'UI Contract is required before validation when sections are configured.'
  }

  return details
}

const validateFrameworkPackageStateContract = ({
  stateModelMode,
  stateModelKey,
  stateModelVersion,
}) => {
  const details = {}
  const normalizedMode = normalizeStateModelMode(stateModelMode)
  if (normalizedMode !== FRAMEWORK_PACKAGE_STATE_MODEL_MODES.EXTERNAL) return details

  if (!normalizeKeyValue(stateModelKey)) {
    details.stateModelKey = 'State Model key is required when State Model Mode is EXTERNAL.'
  }

  const normalizedVersion = normalizeKeyValue(stateModelVersion)
  if (!normalizedVersion) {
    details.stateModelVersion = 'State Model version is required when State Model Mode is EXTERNAL.'
  } else if (!SEMVER_PATTERN.test(normalizedVersion)) {
    details.stateModelVersion = 'State Model version must use semantic version format.'
  }

  return details
}

const resolveUIContractBinding = async ({ uiContractKey = '', frameworkPackage = {} } = {}) => {
  const normalizedUiContractKey = String(uiContractKey || '').trim().toLowerCase()
  if (!normalizedUiContractKey) return null

  const uiContract = await UIContract.findOne({ uiContractKey: normalizedUiContractKey })
    .select('uiContractKey status sourcePackageVersion introducedInVersion compatibilityMode')
    .lean()

  if (!uiContract) return null

  return {
    key: uiContract.uiContractKey,
    version:
      String(uiContract.sourcePackageVersion || '').trim()
      || String(uiContract.introducedInVersion || '').trim()
      || String(frameworkPackage.version || '').trim()
      || null,
    status: String(uiContract.status || '').trim().toUpperCase(),
    compatibilityMode: String(uiContract.compatibilityMode || '').trim().toUpperCase(),
    resolvedAt: new Date(),
  }
}

const validateSectionRuntimePaths = async ({ sections = [], frameworkKey }) => {
  const runtimePaths = [
    ...new Set(
      getStructuralSections(sections)
        .map((section) => normalizeRuntimePath(section?.runtimePath))
        .filter(Boolean),
    ),
  ]

  if (runtimePaths.length === 0) return null

  const rows = await RuntimePathRegistry.find({ pathKey: { $in: runtimePaths } })
    .select('pathKey status frameworkKeys scope category allowedOperations')
    .lean()
  const byPath = new Map(rows.map((row) => [row.pathKey, row]))
  const invalidRuntimePaths = runtimePaths.filter((runtimePath) => {
    const row = byPath.get(runtimePath)
    if (!row) return true
    if (row.status !== RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE) return true
    if (row.scope !== RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE) return true
    if (row.category !== RUNTIME_PATH_REGISTRY_CATEGORIES.SECTION) return true
    if (!runtimePath.startsWith('framework_state.sections.')) return true
    // Normalize here as a guard for legacy or seeded rows that predate model hooks.
    const allowedOperations = Array.isArray(row.allowedOperations)
      ? row.allowedOperations.map((operation) => String(operation ?? '').trim().toUpperCase())
      : []
    if (!allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.BIND)) return true
    return !Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)
  })

  if (invalidRuntimePaths.length === 0) return null

  return `Section runtime paths must be ACTIVE, FRAMEWORK_STATE/SECTION, allow BIND, and be compatible with "${frameworkKey}": ${invalidRuntimePaths.join(', ')}.`
}

const validateUIContractSectionAlignment = ({ sections = [], uiContract = null }) => {
  if (!uiContract) return null

  const sectionMapping = summarizeUIContractSectionMapping({
    packageSections: sections,
    uiSections: uiContract.sections,
  })
  if (sectionMapping.counts.packageSections === 0) return null

  const issues = []
  if (sectionMapping.missing.length > 0) {
    issues.push(
      `UI Contract "${uiContract.uiContractKey}" is missing presentation mappings for package sections: ${sectionMapping.missing.join(', ')}.`,
    )
  }
  if (sectionMapping.orphaned.length > 0) {
    issues.push(
      `UI Contract sections must exist in the source package unless marked custom: ${sectionMapping.orphaned.join(', ')}.`,
    )
  }
  if (sectionMapping.runtimePathMismatches.length > 0) {
    const mismatchKeys = sectionMapping.runtimePathMismatches
      .map((item) => item.sectionKey)
      .join(', ')
    issues.push(
      `UI Contract runtime paths must match package section definitions: ${mismatchKeys}.`,
    )
  }

  if (issues.length === 0) return null

  return issues.join(' ')
}

const inferJsonValueType = (value) => {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

const validateValidationBindingParameters = ({ parameters = {}, parameterSchema = {}, bindingKey = '' }) => {
  const schema = parameterSchema && typeof parameterSchema === 'object' && !Array.isArray(parameterSchema)
    ? parameterSchema
    : {}
  const normalizedParameters = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? parameters
    : {}
  const issues = []

  const required = Array.isArray(schema.required) ? schema.required : []
  for (const key of required) {
    const parameterKey = String(key || '').trim()
    if (parameterKey && normalizedParameters[parameterKey] === undefined) {
      issues.push(`${bindingKey}: missing required parameter "${parameterKey}".`)
    }
  }

  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties
    : {}
  for (const [parameterKey, definition] of Object.entries(properties)) {
    if (normalizedParameters[parameterKey] === undefined) continue
    const expectedTypes = Array.isArray(definition?.type)
      ? definition.type
      : [definition?.type].filter(Boolean)
    if (expectedTypes.length === 0) continue

    const actualType = inferJsonValueType(normalizedParameters[parameterKey])
    if (!expectedTypes.includes(actualType)) {
      issues.push(
        `${bindingKey}: parameter "${parameterKey}" must be ${expectedTypes.join(' or ')}; received ${actualType}.`,
      )
    }
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties))
    const unknown = Object.keys(normalizedParameters).filter((key) => !allowed.has(key))
    if (unknown.length > 0) {
      issues.push(`${bindingKey}: unknown parameter${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}.`)
    }
  }

  return issues
}

const validateFrameworkPackageAccessRules = ({
  visibility,
  customerAccessMode,
  assignedCustomerIds = [],
}) => {
  const details = {}
  const selectedCustomerIds = Array.isArray(assignedCustomerIds) ? assignedCustomerIds : []

  if (
    visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY
    && customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
  ) {
    details.customerAccessMode = 'Internal-only packages must use all-customers access mode.'
  }

  if (
    visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY
    && selectedCustomerIds.length > 0
  ) {
    details.assignedCustomerIds = 'Internal-only packages cannot be assigned to customers.'
  }

  if (
    customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS
    && selectedCustomerIds.length > 0
  ) {
    details.assignedCustomerIds = 'Assigned customers must be empty when access mode is all customers.'
  }

  if (
    visibility === FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE
    && customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
    && selectedCustomerIds.length === 0
  ) {
    details.assignedCustomerIds = 'Assigned customers are required when customer access is selected customers.'
  }

  return details
}

const validateFrameworkPackageRegistryReferences = async ({
  frameworkKey,
  validationBindings = [],
  workflowBindings = [],
  sections = [],
  uiContractKey = '',
  validateSections = false,
  validateUiContractSections = false,
}) => {
  const details = {}
  const { missingKeys } = await resolveKnownFrameworkKeys([frameworkKey])

  if (missingKeys.length > 0) {
    details.frameworkKey = buildUnknownFrameworkKeyMessage(missingKeys)
    return details
  }

  const validationKeys = [
    ...new Set([
      ...(validationBindings || []).map((item) => String(item?.validationKey || '').trim().toLowerCase()),
    ].filter(Boolean)),
  ]
  if (validationKeys.length > 0) {
    const validationRows = await ValidationRegistry.find({ key: { $in: validationKeys } })
      .select('key status supportedFrameworkKeys packageUsable parameterSchema')
      .lean()
    const validationByKey = new Map(validationRows.map((row) => [row.key, row]))
    const invalidValidationKeys = validationKeys.filter((validationKey) => {
      const row = validationByKey.get(validationKey)
      if (!row) return true
      if (row.status !== VALIDATION_REGISTRY_STATUSES.ACTIVE) return true
      if (!row.packageUsable) return true
      return !Array.isArray(row.supportedFrameworkKeys) || !row.supportedFrameworkKeys.includes(frameworkKey)
    })

    if (invalidValidationKeys.length > 0) {
      details.validationBindings =
        `Validation entries must be ACTIVE, package-usable, and compatible with "${frameworkKey}": ${invalidValidationKeys.join(', ')}.`
    }

    const parameterIssues = (validationBindings || []).flatMap((binding) => {
      const validationKey = String(binding?.validationKey || '').trim().toLowerCase()
      const bindingKey = String(binding?.bindingKey || validationKey || '').trim().toLowerCase()
      const validationRow = validationByKey.get(validationKey)
      if (!validationRow) return []
      return validateValidationBindingParameters({
        parameters: binding?.parameters,
        parameterSchema: validationRow.parameterSchema,
        bindingKey,
      })
    })

    if (parameterIssues.length > 0) {
      details['validationBindings.parameters'] = parameterIssues.join(' ')
    }
  }

  const policyKeys = [
    ...new Set([
      ...(workflowBindings || []).map((item) => String(item?.policyKey || '').trim().toLowerCase()),
    ].filter(Boolean)),
  ]
  if (policyKeys.length > 0) {
    const policyRows = await WorkflowPolicy.find({ key: { $in: policyKeys } })
      .select('key status frameworkKeys steps')
      .lean()
    const policyByKey = new Map(policyRows.map((row) => [row.key, row]))
    const invalidPolicyKeys = policyKeys.filter((policyKey) => {
      const row = policyByKey.get(policyKey)
      if (!row) return true
      if (row.status !== WORKFLOW_POLICY_STATUSES.ACTIVE) return true
      return !Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)
    })

    if (invalidPolicyKeys.length > 0) {
      details.workflowBindings =
        `Workflow policies must be ACTIVE and compatible with "${frameworkKey}": ${invalidPolicyKeys.join(', ')}.`
    }

    const validationBindingKeys = new Set((validationBindings || [])
      .map((binding) => String(binding?.bindingKey || '').trim().toLowerCase())
      .filter(Boolean))
    const missingWorkflowValidationBindings = policyRows.flatMap((policy) =>
      (Array.isArray(policy.steps) ? policy.steps : [])
        .filter((step) => String(step?.type || '').trim().toUpperCase() === WORKFLOW_POLICY_STEP_TYPES.VALIDATION)
        .flatMap((step) => Array.isArray(step?.bindingKeys) ? step.bindingKeys : [])
        .map((bindingKey) => String(bindingKey || '').trim().toLowerCase())
        .filter((bindingKey) => bindingKey && !validationBindingKeys.has(bindingKey))
        .map((bindingKey) => `${policy.key}: ${bindingKey}`))

    if (missingWorkflowValidationBindings.length > 0) {
      details.workflowBindings = [
        details.workflowBindings,
        `Workflow validation steps must reference package validation bindingKeys: ${missingWorkflowValidationBindings.join(', ')}.`,
      ].filter(Boolean).join(' ')
    }
  }

  const normalizedUiContractKey = String(uiContractKey || '').trim().toLowerCase()
  if (normalizedUiContractKey) {
    const uiContract = await UIContract.findOne({ uiContractKey: normalizedUiContractKey })
      .select('uiContractKey status versionStatus frameworkKeys introducedInVersion deprecatedInVersion compatibilityMode sections.sectionKey sections.runtimePath sections.source sections.isCustom')
      .lean()

    if (!uiContract) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" was not found.`
    } else if (uiContract.status !== UI_CONTRACT_STATUSES.ACTIVE) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" must be ACTIVE.`
    } else if (uiContract.versionStatus !== RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" version status must be ACTIVE.`
    } else if (!Array.isArray(uiContract.frameworkKeys) || !uiContract.frameworkKeys.includes(frameworkKey)) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" is not compatible with framework "${frameworkKey}".`
    } else if (validateUiContractSections) {
      const alignmentMessage = validateUIContractSectionAlignment({ sections, uiContract })
      if (alignmentMessage) {
        details.sections = alignmentMessage
      }
    }
  }

  if (validateSections) {
    const runtimePathMessage = await validateSectionRuntimePaths({ sections, frameworkKey })
    if (runtimePathMessage) {
      details.sections = details.sections
        ? `${details.sections} ${runtimePathMessage}`
        : runtimePathMessage
    }
  }

  return details
}

const buildIntegrityCheck = ({
  key,
  group,
  severity = 'PASS',
  message,
  field = '',
  details = {},
}) => ({
  key,
  group,
  severity,
  message,
  ...(field ? { field } : {}),
  ...(Object.keys(details).length > 0 ? { details } : {}),
})

const summarizeIntegrityChecks = (checks = []) => {
  const summary = checks.reduce(
    (counts, check) => ({
      ...counts,
      [String(check.severity || 'PASS').toLowerCase()]:
        (counts[String(check.severity || 'PASS').toLowerCase()] || 0) + 1,
    }),
    { pass: 0, warn: 0, fail: 0 },
  )

  const status = summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS'
  return { status, summary }
}

const normalizeCheckpointMode = (mode) => {
  const normalized = String(mode || '').trim().toUpperCase()
  return Object.values(FRAMEWORK_PACKAGE_CHECKPOINT_MODES).includes(normalized)
    ? normalized
    : FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL
}

const buildCheckpointCode = (value) =>
  String(value || 'checkpoint.issue')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    || 'CHECKPOINT_ISSUE'

const getCheckpointCategory = ({ group = '', field = '', key = '' } = {}) => {
  if (CHECKPOINT_CATEGORY_BY_FIELD[field]) return CHECKPOINT_CATEGORY_BY_FIELD[field]
  const normalizedKey = String(key || '').trim()
  if (normalizedKey.startsWith('dependencies.runtimePaths')) return 'RUNTIME_PATHS'
  if (normalizedKey.startsWith('dependencies.validations')) return 'VALIDATION_REGISTRY'
  if (normalizedKey.startsWith('dependencies.workflowPolicies')) return 'WORKFLOW_POLICIES'
  if (normalizedKey.startsWith('dependencies.agents')) return 'AGENTS'
  if (normalizedKey.startsWith('dependencies.skills')) return 'SKILLS'
  if (normalizedKey.startsWith('dependencies.skillRoles')) return 'SKILL_ROLES'
  if (normalizedKey.startsWith('dependencies.uiContract')) return 'UI_CONTRACT'
  if (normalizedKey.startsWith('deprecated.')) return 'PACKAGE_STRUCTURE'
  if (CHECKPOINT_CATEGORY_BY_INTEGRITY_GROUP[group]) return CHECKPOINT_CATEGORY_BY_INTEGRITY_GROUP[group]

  return 'PACKAGE_STRUCTURE'
}

const mapIntegrityCheckToCheckpointIssue = (check) => {
  const severity = String(check?.severity || '').trim().toUpperCase()
  if (severity === 'PASS') return null

  return {
    code: buildCheckpointCode(check?.key),
    severity: severity === 'FAIL'
      ? FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES.BLOCKING
      : FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES.WARNING,
    category: getCheckpointCategory(check),
    message: check?.message || 'Checkpoint issue detected.',
    path: check?.field || check?.key || '',
    source: check?.group || 'Runtime Architecture Checkpoint',
    ...(check?.details ? { details: check.details } : {}),
  }
}

const mapDetailsToCheckpointIssues = (details = {}) =>
  Object.entries(details)
    .filter(([field]) => !String(field || '').startsWith('_'))
    .map(([field, message]) => ({
      code: buildCheckpointCode(field),
      severity: FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES.BLOCKING,
      category: getCheckpointCategory({ field }),
      message: String(message || 'Checkpoint issue detected.'),
      path: field,
      source: 'Runtime Architecture Checkpoint',
    }))

const dedupeCheckpointIssues = (issues = []) => {
  const seen = new Set()
  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.severity,
      issue.category,
      issue.path,
      issue.message,
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const buildCheckpointErrorDetails = (checkpoint = {}) => {
  const blockingIssues = Array.isArray(checkpoint.errors) ? checkpoint.errors : []
  return blockingIssues.reduce((details, issue) => {
    const field = issue.path || issue.code || 'checkpoint'
    if (!details[field]) {
      details[field] = issue.message
      return details
    }
    if (!String(details[field]).includes(issue.message)) {
      details[field] = `${details[field]} ${issue.message}`
    }
    return details
  }, {})
}

const buildCheckpointDependencyGraph = ({ frameworkPackage, dependencies = {} }) => {
  const packageId = toIdString(frameworkPackage?._id) || frameworkPackage?.id || frameworkPackage?.packageKey || 'framework-package'
  const packageNodeId = `framework-package:${packageId}`
  const nodes = [
    {
      id: packageNodeId,
      type: 'FrameworkPackage',
      key: frameworkPackage?.packageKey || '',
      label: frameworkPackage?.packageName || buildFrameworkPackageLabel(frameworkPackage || {}),
      status: frameworkPackage?.status || '',
    },
  ]
  const edges = []

  for (const group of DEPENDENCY_LOCK_GROUPS) {
    const rows = getDependencyRowsForGroup(dependencies, group)
    for (const row of rows) {
      const nodeId = `${group.collectionKey}:${row.id || row.key || nodes.length}`
      nodes.push({
        id: nodeId,
        type: group.collectionKey,
        key: row.key || row.id || '',
        label: row.name || row.key || row.id || group.collectionKey,
        status: row.status || '',
        versionStatus: row.versionStatus || '',
        issueCount: Array.isArray(row.issues) ? row.issues.length : 0,
      })
      edges.push({
        id: `${packageNodeId}->${nodeId}`,
        from: packageNodeId,
        to: nodeId,
        relationship: row.source || group.key,
      })
    }
  }

  return {
    nodes,
    edges,
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      issueNodes: nodes.filter((node) => Number(node.issueCount) > 0).length,
    },
  }
}

const buildCheckpointResponse = ({
  frameworkPackage,
  mode,
  actorUserId,
  actorSummary = null,
  integrity,
  dependencyLockResult,
  extraIssues = [],
}) => {
  const integrityIssues = (integrity?.checks || [])
    .map(mapIntegrityCheckToCheckpointIssue)
    .filter(Boolean)
  const issues = dedupeCheckpointIssues([...integrityIssues, ...extraIssues])
  const errors = issues.filter((issue) => issue.severity === FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES.BLOCKING)
  const warnings = issues.filter((issue) => issue.severity === FRAMEWORK_PACKAGE_CHECKPOINT_SEVERITIES.WARNING)
  const passedChecks = (integrity?.checks || [])
    .filter((check) => String(check?.severity || '').trim().toUpperCase() === 'PASS')
    .map((check) => ({
      code: buildCheckpointCode(check.key),
      category: getCheckpointCategory(check),
      message: check.message,
      path: check.field || check.key || '',
      source: check.group || 'Runtime Architecture Checkpoint',
    }))
  const status = errors.length > 0
    ? FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.FAIL
    : warnings.length > 0
      ? FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.PASS_WITH_WARNINGS
      : FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.PASS
  const timestamp = new Date()

  return {
    schemaVersion: '1',
    id: toIdString(frameworkPackage?._id) || frameworkPackage?.id || null,
    frameworkKey: frameworkPackage?.frameworkKey || '',
    packageKey: frameworkPackage?.packageKey || '',
    packageVersion: frameworkPackage?.version || '',
    mode,
    status,
    errors,
    warnings,
    issues,
    passedChecks,
    dependencyGraph: buildCheckpointDependencyGraph({
      frameworkPackage,
      dependencies: dependencyLockResult?.dependencies,
    }),
    dependencyLockPreview: dependencyLockResult?.snapshot || null,
    summary: {
      totalChecks: passedChecks.length + warnings.length + errors.length,
      passed: passedChecks.length,
      warnings: warnings.length,
      failed: errors.length,
      resolvedReferences: Number(dependencyLockResult?.snapshot?.references?.length) || 0,
    },
    timestamp,
    runBy: serializeCheckpointRunBy(actorSummary || actorUserId),
  }
}

const normalizeIntegrityForCheckpoint = ({ integrity, dependencyLockResult }) => {
  const dependencyLockIssueCount = Object.keys(dependencyLockResult?.issueDetails || {}).length
  if (dependencyLockIssueCount > 0) return integrity

  return {
    ...integrity,
    checks: (integrity?.checks || []).map((check) => {
      if (check?.key !== 'dependencyLock.snapshot' || check?.severity !== 'WARN') {
        return check
      }

      return {
        ...check,
        severity: 'PASS',
        message: 'Dependency lock snapshot can be created by this checkpoint.',
      }
    }),
  }
}

const compactCheckpointForValidationError = (checkpoint = {}) => {
  const compactCheckpoint = { ...(checkpoint || {}) }
  delete compactCheckpoint.dependencyGraph
  delete compactCheckpoint.dependencyLockPreview
  delete compactCheckpoint.passedChecks
  return compactCheckpoint
}

const sendCheckpointValidationFailed = (res, req, checkpoint) =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Runtime Architecture Checkpoint failed.',
      details: buildCheckpointErrorDetails(checkpoint),
      checkpoint: compactCheckpointForValidationError(checkpoint),
      requestId: req.requestId,
    },
  })

const buildDependencyResolutionMessage = ({ label, issueRows }) =>
  issueRows.length > 0
    ? `${label} have unresolved issues: ${issueRows
      .map((row) => `${row.key || row.id}: ${(row.issues || []).join(' ')}`)
      .join(' ')}`
    : `${label} resolve without dependency issues.`

const buildDependencyResolutionIntegrityChecks = (dependencies = {}) => {
  const dependencyGroups = [
    { key: 'agents', label: 'Resolved Agents', field: 'workflowBindings' },
    { key: 'skills', label: 'Resolved Skills', field: 'workflowBindings' },
    { key: 'skillRoles', label: 'Resolved Skill Roles', field: 'workflowBindings' },
    { key: 'runtimePaths', label: 'Resolved Runtime Paths', field: 'sections' },
    { key: 'validations', label: 'Resolved Validations', field: 'validationBindings' },
    { key: 'workflowPolicies', label: 'Resolved Workflow Policies', field: 'workflowBindings' },
    { key: 'uiContract', label: 'Resolved UI Contract', field: 'uiContractKey', singleton: true },
  ]

  return dependencyGroups.map(({ key, label, field, singleton = false }) => {
    const rows = singleton
      ? (dependencies[key] ? [dependencies[key]] : [])
      : (Array.isArray(dependencies[key]) ? dependencies[key] : [])
    const issueRows = rows.filter((row) => Array.isArray(row.issues) && row.issues.length > 0)

    return buildIntegrityCheck({
      key: `dependencies.${key}`,
      group: 'Dependency Integrity',
      severity: issueRows.length > 0 ? 'FAIL' : 'PASS',
      message: rows.length === 0
        ? `${label} are not required by this package.`
        : buildDependencyResolutionMessage({ label, issueRows }),
      field,
      details: issueRows.length > 0
        ? {
            issues: issueRows.map((row) => ({
              key: row.key || row.id,
              status: row.status,
              issues: row.issues,
            })),
          }
        : {},
    })
  })
}

const getUniqueValidationKeys = (frameworkPackage = {}) => [
  ...new Set([
    ...(Array.isArray(frameworkPackage.validationBindings)
      ? frameworkPackage.validationBindings.map((binding) => binding?.validationKey)
      : []),
    ...(Array.isArray(frameworkPackage.sections)
      ? frameworkPackage.sections.flatMap((section) =>
        Array.isArray(section?.validationKeys) ? section.validationKeys : [])
      : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)),
]

const getUniqueWorkflowPolicyKeys = (frameworkPackage = {}) => [
  ...new Set((Array.isArray(frameworkPackage.workflowBindings) ? frameworkPackage.workflowBindings : [])
    .map((binding) => String(binding?.policyKey || '').trim().toLowerCase())
    .filter(Boolean)),
]

const serializeDependencyReference = ({
  id,
  key,
  name,
  label,
  status,
  source,
  frameworkCompatible = true,
  issues = [],
  ...rest
}) => ({
  id: id || key || '',
  key: key || id || '',
  name: name || label || key || id || '',
  status: status || 'UNKNOWN',
  source: source || 'PACKAGE',
  frameworkCompatible,
  issues,
  ...rest,
})

const pickDependencyVersioningFields = (row = {}) => ({
  componentVersion: Number(row?.componentVersion) || 1,
  versionStatus: row?.versionStatus || '',
  lineageId: row?.lineageId || row?.stableId || row?.id || '',
  isLocked: Boolean(row?.isLocked),
  lockedAt: row?.lockedAt || null,
  lockedByPackageKeys: Array.isArray(row?.lockedByPackageKeys) ? row.lockedByPackageKeys : [],
})

const serializeRuntimePathDependencyReference = ({ row, pathKey, source, issues = [] }) =>
  serializeDependencyReference({
    id: row?.stableId || row?.id || pathKey,
    key: row?.pathKey || pathKey,
    name: row?.label || pathKey,
    status: row?.status || 'MISSING',
    source,
    frameworkCompatible: issues.length === 0,
    issues,
    scope: row?.scope || '',
    category: row?.category || '',
    isProtected: Boolean(row?.isProtected),
    ...pickDependencyVersioningFields(row),
  })

const serializeUIContractDependencyReference = ({
  uiContract,
  uiContractKey,
  frameworkKey,
  packageSections = [],
}) => {
  if (!uiContract && !uiContractKey) return null
  if (!uiContract) {
    return serializeDependencyReference({
      id: uiContractKey,
      key: uiContractKey,
      name: uiContractKey,
      status: 'MISSING',
      source: 'uiContractKey',
      frameworkCompatible: false,
      issues: [`UI Contract "${uiContractKey}" was not found.`],
    })
  }

  const issues = []
  if (uiContract.status !== UI_CONTRACT_STATUSES.ACTIVE) {
    issues.push(`UI Contract must be ACTIVE; current status is ${uiContract.status}.`)
  }
  if (uiContract.versionStatus !== RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE) {
    issues.push(`UI Contract version status must be ACTIVE; current version status is ${uiContract.versionStatus || 'UNKNOWN'}.`)
  }
  if (frameworkKey && (!Array.isArray(uiContract.frameworkKeys) || !uiContract.frameworkKeys.includes(frameworkKey))) {
    issues.push(`UI Contract is not compatible with framework "${frameworkKey}".`)
  }

  return serializeDependencyReference({
    id: uiContract.stableId || uiContract.id || `ui-contract-${uiContract.uiContractKey}`,
    key: uiContract.uiContractKey,
    name: uiContract.name || uiContract.uiContractKey,
    status: uiContract.status,
    source: 'uiContractKey',
    frameworkCompatible: issues.length === 0,
    issues,
    version:
      String(uiContract.sourcePackageVersion || '').trim()
      || String(uiContract.introducedInVersion || '').trim()
      || '',
    sourcePackageKey: uiContract.sourcePackageKey || '',
    sourcePackageVersion: uiContract.sourcePackageVersion || '',
    compatibilityMode: uiContract.compatibilityMode || '',
    sectionMapping: summarizeUIContractSectionMapping({
      packageSections,
      uiSections: uiContract.sections,
    }),
    lifecycleStageCount: Array.isArray(uiContract.lifecycleStages) ? uiContract.lifecycleStages.length : 0,
    actionCount: Array.isArray(uiContract.actions) ? uiContract.actions.length : 0,
    ...pickDependencyVersioningFields(uiContract),
  })
}

const fetchFrameworkPackageDependencies = async (frameworkPackage) => {
  const frameworkKey = String(frameworkPackage.frameworkKey || '').trim().toUpperCase()
  const sectionRuntimePathKeys = [
    ...new Set((Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : [])
      .map((section) => normalizeRuntimePath(section?.runtimePath))
      .filter(Boolean)),
  ]
  const validationKeys = getUniqueValidationKeys(frameworkPackage)
  const validationBindingKeys = new Set(
    (Array.isArray(frameworkPackage.validationBindings) ? frameworkPackage.validationBindings : [])
      .map((binding) => String(binding?.bindingKey || '').trim().toLowerCase())
      .filter(Boolean),
  )
  const workflowPolicyKeys = getUniqueWorkflowPolicyKeys(frameworkPackage)
  const uiContractKey = String(frameworkPackage.uiContractKey || '').trim().toLowerCase()

  const [validationRows, workflowRows, uiContract] = await Promise.all([
    validationKeys.length > 0
      ? ValidationRegistry.find({ key: { $in: validationKeys } })
        .select('stableId key label status supportedFrameworkKeys packageUsable producerSkillId defaultAgentIds outputPath passFieldPath detailsFieldPath messageFieldPath parameterSchema defaultParameters retryPolicy componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
        .lean()
      : Promise.resolve([]),
    workflowPolicyKeys.length > 0
      ? WorkflowPolicy.find({ key: { $in: workflowPolicyKeys } })
        .select('stableId key name status frameworkKeys governedAction primaryAgentId fallbackAgentId requiredAgentIds requiredSkillIds requiredValidationKeys conditions onPassEffects onFailEffects steps componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
        .lean()
      : Promise.resolve([]),
    uiContractKey
      ? UIContract.findOne({ uiContractKey })
        .select('stableId uiContractKey name status frameworkKeys sourcePackageKey sourcePackageVersion introducedInVersion compatibilityMode sections.sectionKey sections.runtimePath sections.source sections.isCustom lifecycleStages.stageKey lifecycleStages.isVisible actions.actionKey actions.governedAction actions.isVisible componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
        .lean()
      : Promise.resolve(null),
  ])

  const validationByKey = new Map(validationRows.map((row) => [row.key, row]))
  const workflowByKey = new Map(workflowRows.map((row) => [row.key, row]))

  const validationDependencies = validationKeys.map((validationKey) => {
    const row = validationByKey.get(validationKey)
    const issues = []
    if (!row) {
      issues.push(`Validation "${validationKey}" was not found.`)
    } else {
      if (row.status !== VALIDATION_REGISTRY_STATUSES.ACTIVE) issues.push('Validation must be ACTIVE.')
      if (row.packageUsable === false) issues.push('Validation must be package-usable.')
      if (!Array.isArray(row.supportedFrameworkKeys) || !row.supportedFrameworkKeys.includes(frameworkKey)) {
        issues.push(`Validation is not compatible with framework "${frameworkKey}".`)
      }
    }

    return serializeDependencyReference({
      id: row?.stableId || validationKey,
      key: row?.key || validationKey,
      name: row?.label || validationKey,
      status: row?.status || 'MISSING',
      source: 'validationBindings',
      frameworkCompatible: issues.length === 0,
      issues,
      outputPath: row?.outputPath || '',
      producerSkillId: row?.producerSkillId || '',
      defaultAgentIds: Array.isArray(row?.defaultAgentIds) ? row.defaultAgentIds : [],
      ...pickDependencyVersioningFields(row),
      outputPaths: {
        outputPath: row?.outputPath || '',
        passFieldPath: row?.passFieldPath || '',
        detailsFieldPath: row?.detailsFieldPath || '',
        messageFieldPath: row?.messageFieldPath || '',
      },
      bindingKeys: (Array.isArray(frameworkPackage.validationBindings) ? frameworkPackage.validationBindings : [])
        .filter((binding) => String(binding?.validationKey || '').trim().toLowerCase() === validationKey)
        .map((binding) => String(binding?.bindingKey || '').trim())
        .filter(Boolean),
      hasParameterSchema: Boolean(row?.parameterSchema && typeof row.parameterSchema === 'object'),
      defaultParameters: row?.defaultParameters || {},
      retryPolicy: row?.retryPolicy || {},
    })
  })

  const workflowDependencies = workflowPolicyKeys.map((policyKey) => {
    const row = workflowByKey.get(policyKey)
    const issues = []
    if (!row) {
      issues.push(`Workflow policy "${policyKey}" was not found.`)
    } else {
      if (row.status !== WORKFLOW_POLICY_STATUSES.ACTIVE) issues.push('Workflow policy must be ACTIVE.')
      if (!Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)) {
        issues.push(`Workflow policy is not compatible with framework "${frameworkKey}".`)
      }
      const validationStepBindingKeys = (Array.isArray(row.steps) ? row.steps : [])
        .filter((step) => String(step?.type || '').trim().toUpperCase() === WORKFLOW_POLICY_STEP_TYPES.VALIDATION)
        .flatMap((step) => Array.isArray(step?.bindingKeys) ? step.bindingKeys : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
      const missingValidationStepBindingKey = validationStepBindingKeys
        .find((bindingKey) => !validationBindingKeys.has(bindingKey))
      if (missingValidationStepBindingKey) {
        issues.push(`Validation step binding "${missingValidationStepBindingKey}" is not configured on the package.`)
      }
    }

    return serializeDependencyReference({
      id: row?.stableId || policyKey,
      key: row?.key || policyKey,
      name: row?.name || policyKey,
      status: row?.status || 'MISSING',
      source: 'workflowBindings',
      frameworkCompatible: issues.length === 0,
      issues,
      governedAction: row?.governedAction || '',
      stepCount: Array.isArray(row?.steps) ? row.steps.length : 0,
      ...pickDependencyVersioningFields(row),
    })
  })

  const workflowAgentIds = workflowRows.flatMap((policy) => [
    policy.primaryAgentId,
    policy.fallbackAgentId,
    ...(Array.isArray(policy.requiredAgentIds) ? policy.requiredAgentIds : []),
    ...(Array.isArray(policy.steps) ? policy.steps.map((step) => step?.agentId) : []),
  ])
  const validationAgentIds = validationRows.flatMap((validation) =>
    Array.isArray(validation.defaultAgentIds) ? validation.defaultAgentIds : [])
  const agentIds = [...new Set([...workflowAgentIds, ...validationAgentIds]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))]

  const workflowSkillIds = workflowRows.flatMap((policy) =>
    [
      ...(Array.isArray(policy.requiredSkillIds) ? policy.requiredSkillIds : []),
      ...(Array.isArray(policy.steps) ? policy.steps.map((step) => step?.skillId) : []),
    ])
  const validationSkillIds = validationRows.map((validation) => validation.producerSkillId)
  const agentRows = agentIds.length > 0
    ? await RuntimeAgent.find({ stableId: { $in: agentIds } })
      .select('stableId key name status supportedFrameworkKeys requiredSkillRoleKeys defaultSkillIds primarySkillIds optionalSkillIds executionPlan componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
      .lean()
    : []

  const agentSkillIds = agentRows.flatMap((agent) => [
    ...(Array.isArray(agent.defaultSkillIds) ? agent.defaultSkillIds : []),
    ...(Array.isArray(agent.primarySkillIds) ? agent.primarySkillIds : []),
    ...(Array.isArray(agent.optionalSkillIds) ? agent.optionalSkillIds : []),
    ...(Array.isArray(agent.executionPlan) ? agent.executionPlan.map((step) => step?.skillId) : []),
  ])
  const skillIds = [...new Set([...workflowSkillIds, ...validationSkillIds, ...agentSkillIds]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))]
  const skillRows = skillIds.length > 0
    ? await RuntimeSkill.find({ stableId: { $in: skillIds } })
      .select('stableId key name status supportedFrameworkKeys skillRoleKey category componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
      .lean()
    : []

  const skillRoleKeys = [...new Set([
    ...skillRows.map((skill) => skill.skillRoleKey),
    ...agentRows.flatMap((agent) => Array.isArray(agent.requiredSkillRoleKeys) ? agent.requiredSkillRoleKeys : []),
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean))]
  const skillRoleRows = skillRoleKeys.length > 0
    ? await SkillRoleRegistry.find({ roleKey: { $in: skillRoleKeys } })
      .select('stableId roleKey label status componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
      .lean()
    : []

  const workflowRuntimePathKeys = workflowRows.flatMap((policy) => [
    ...(Array.isArray(policy.conditions) ? policy.conditions.map((condition) => condition?.path) : []),
    ...(Array.isArray(policy.onPassEffects) ? policy.onPassEffects.map((effect) => effect?.targetPath) : []),
    ...(Array.isArray(policy.onFailEffects) ? policy.onFailEffects.map((effect) => effect?.targetPath) : []),
    ...(Array.isArray(policy.steps) ? policy.steps.map((step) => step?.targetPath) : []),
  ])
  const validationRuntimePathKeys = validationRows.flatMap((validation) => [
    validation.outputPath,
    validation.passFieldPath,
    validation.detailsFieldPath,
    validation.messageFieldPath,
  ])
  const runtimePathKeys = [...new Set([...sectionRuntimePathKeys, ...workflowRuntimePathKeys, ...validationRuntimePathKeys]
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
  const runtimePathRows = runtimePathKeys.length > 0
    ? await RuntimePathRegistry.find({ pathKey: { $in: runtimePathKeys } })
      .select('stableId pathKey label status frameworkKeys scope category isProtected componentVersion versionStatus lineageId isLocked lockedAt lockedByPackageKeys')
      .lean()
    : []
  const runtimePathByKey = new Map(runtimePathRows.map((row) => [row.pathKey, row]))

  const agentById = new Map(agentRows.map((row) => [row.stableId, row]))
  const skillById = new Map(skillRows.map((row) => [row.stableId, row]))
  const skillRoleByKey = new Map(skillRoleRows.map((row) => [row.roleKey, row]))

  const agents = agentIds.map((agentId) => {
    const row = agentById.get(agentId)
    const issues = []
    if (!row) issues.push(`Runtime Agent "${agentId}" was not found.`)
    else if (!Array.isArray(row.supportedFrameworkKeys) || !row.supportedFrameworkKeys.includes(frameworkKey)) {
      issues.push(`Runtime Agent is not compatible with framework "${frameworkKey}".`)
    }

    return serializeDependencyReference({
      id: row?.stableId || agentId,
      key: row?.key || agentId,
      name: row?.name || agentId,
      status: row?.status || 'MISSING',
      source: 'workflow/validation',
      frameworkCompatible: issues.length === 0,
      issues,
      ...pickDependencyVersioningFields(row),
    })
  })

  const skills = skillIds.map((skillId) => {
    const row = skillById.get(skillId)
    const issues = []
    if (!row) issues.push(`Runtime Skill "${skillId}" was not found.`)
    else if (!Array.isArray(row.supportedFrameworkKeys) || !row.supportedFrameworkKeys.includes(frameworkKey)) {
      issues.push(`Runtime Skill is not compatible with framework "${frameworkKey}".`)
    }

    return serializeDependencyReference({
      id: row?.stableId || skillId,
      key: row?.key || skillId,
      name: row?.name || skillId,
      status: row?.status || 'MISSING',
      source: 'workflow/validation/agent',
      frameworkCompatible: issues.length === 0,
      issues,
      skillRoleKey: row?.skillRoleKey || '',
      category: row?.category || '',
      ...pickDependencyVersioningFields(row),
    })
  })

  const skillRoles = skillRoleKeys.map((roleKey) => {
    const row = skillRoleByKey.get(roleKey)
    const issues = []
    if (!row) {
      issues.push(`Skill Role "${roleKey}" was not found.`)
    } else if (row.status !== SKILL_ROLE_REGISTRY_STATUSES.ACTIVE) {
      issues.push('Skill Role must be ACTIVE.')
    }

    return serializeDependencyReference({
      id: row?.stableId || roleKey,
      key: row?.roleKey || roleKey,
      name: row?.label || roleKey,
      status: row?.status || 'MISSING',
      source: 'skills/agents',
      frameworkCompatible: issues.length === 0,
      issues,
      ...pickDependencyVersioningFields(row),
    })
  })

  const runtimePaths = runtimePathKeys.map((pathKey) => {
    const row = runtimePathByKey.get(pathKey)
    const issues = []
    if (!row) {
      issues.push(`Runtime path "${pathKey}" was not found.`)
    } else {
      if (row.status !== RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE) issues.push('Runtime path must be ACTIVE.')
      if (!Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)) {
        issues.push(`Runtime path is not compatible with framework "${frameworkKey}".`)
      }
    }

    return serializeRuntimePathDependencyReference({
      row,
      pathKey,
      source: sectionRuntimePathKeys.includes(pathKey)
        ? 'sections'
        : validationRuntimePathKeys.includes(pathKey)
          ? 'validation'
          : 'workflow',
      issues,
    })
  })

  const uiContractReference = serializeUIContractDependencyReference({
    uiContract,
    uiContractKey,
    frameworkKey,
    packageSections: frameworkPackage.sections,
  })
  const dependencyGroups = {
    agents,
    skills,
    skillRoles,
    runtimePaths,
    validations: validationDependencies,
    workflowPolicies: workflowDependencies,
    uiContract: uiContractReference,
  }
  const issueCount = [
    ...agents,
    ...skills,
    ...skillRoles,
    ...runtimePaths,
    ...validationDependencies,
    ...workflowDependencies,
    ...(uiContractReference ? [uiContractReference] : []),
  ].reduce((count, row) => count + (Array.isArray(row.issues) ? row.issues.length : 0), 0)

  return {
    id: toIdString(frameworkPackage._id) || frameworkPackage.id,
    frameworkKey,
    packageKey: frameworkPackage.packageKey || '',
    summary: {
      agents: agents.length,
      skills: skills.length,
      skillRoles: skillRoles.length,
      runtimePaths: runtimePaths.length,
      validations: validationDependencies.length,
      workflowPolicies: workflowDependencies.length,
      uiContract: uiContractReference ? 1 : 0,
      issues: issueCount,
    },
    ...dependencyGroups,
  }
}

const getDependencyRowsForGroup = (dependencies, group) => {
  if (group.singleton) {
    return dependencies[group.key] ? [dependencies[group.key]] : []
  }

  return Array.isArray(dependencies[group.key]) ? dependencies[group.key] : []
}

const buildDependencyLockIssueDetails = (dependencies = {}) =>
  DEPENDENCY_LOCK_GROUPS.reduce((details, group) => {
    const issueRows = getDependencyRowsForGroup(dependencies, group)
      .filter((row) => Array.isArray(row?.issues) && row.issues.length > 0)

    if (issueRows.length > 0) {
      details[`dependencyLock.${group.key}`] = issueRows
        .map((row) => `${row.key || row.id}: ${row.issues.join(' ')}`)
        .join(' ')
    }

    return details
  }, {})

const buildDependencyLockReferences = ({ dependencies = {}, lockedAt }) =>
  DEPENDENCY_LOCK_GROUPS.flatMap((group) =>
    getDependencyRowsForGroup(dependencies, group).map((row) => ({
      collectionKey: group.collectionKey,
      id: row.id,
      key: row.key || '',
      name: row.name || '',
      status: row.status || '',
      versionStatus: row.versionStatus || RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
      componentVersion: Number(row.componentVersion) || 1,
      lineageId: row.lineageId || row.id,
      lockedAt,
      issues: Array.isArray(row.issues) ? row.issues : [],
      ...(row.governedAction ? { governedAction: row.governedAction } : {}),
      ...(row.stepCount !== undefined ? { stepCount: Number(row.stepCount) || 0 } : {}),
      ...(row.outputPaths ? { outputPaths: row.outputPaths } : {}),
      ...(Array.isArray(row.bindingKeys) ? { bindingKeys: row.bindingKeys } : {}),
      ...(row.producerSkillId ? { producerSkillId: row.producerSkillId } : {}),
      ...(row.hasParameterSchema !== undefined ? { hasParameterSchema: Boolean(row.hasParameterSchema) } : {}),
    })))

const buildUIContractSnapshot = ({ dependencies = {} } = {}) => {
  const uiContract = dependencies.uiContract
  if (!uiContract) return null

  return {
    uiContractKey: uiContract.key || '',
    stableId: uiContract.id || '',
    lineageId: uiContract.lineageId || uiContract.id || '',
    componentVersion: Number(uiContract.componentVersion) || 1,
    versionStatus: uiContract.versionStatus || '',
    sourcePackageKey: uiContract.sourcePackageKey || '',
    sourcePackageVersion: uiContract.sourcePackageVersion || '',
    compatibilityMode: uiContract.compatibilityMode || '',
    sectionMapping: uiContract.sectionMapping || null,
    lifecycleStageCount: Number(uiContract.lifecycleStageCount) || 0,
    actionCount: Number(uiContract.actionCount) || 0,
  }
}

const buildDependencyLockSnapshot = ({
  frameworkPackage,
  dependencies,
  actorUserId,
  lockedAt,
  status = 'PASS',
}) => ({
  status,
  resolvedAt: lockedAt,
  resolvedBy: actorUserId,
  packageKey: frameworkPackage.packageKey,
  packageVersion: frameworkPackage.version,
  references: buildDependencyLockReferences({ dependencies, lockedAt }),
  ...(dependencies?.uiContract ? { uiContractSnapshot: buildUIContractSnapshot({ dependencies }) } : {}),
})

const updateRuntimeControlDependencyLocks = async ({
  dependencies,
  packageKey,
  packageVersion,
  actorUserId,
  lockedAt,
  session,
}) => {
  const updateOptions = session ? { session } : {}

  for (const group of DEPENDENCY_LOCK_GROUPS) {
    const ids = [
      ...new Set(getDependencyRowsForGroup(dependencies, group)
        .filter((row) => !(Array.isArray(row?.issues) && row.issues.length > 0))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean)),
    ]

    if (ids.length === 0) continue

    await group.model.updateMany(
      { stableId: { $in: ids } },
      {
        $addToSet: {
          lockedByPackageKeys: packageKey,
        },
      },
      updateOptions,
    )

    await group.model.updateMany(
      {
        stableId: { $in: ids },
        $or: [
          { isLocked: { $exists: false } },
          { isLocked: { $ne: true } },
        ],
      },
      {
        $set: {
          isLocked: true,
          lockedAt,
          lockedBy: actorUserId,
          lockedReason: DEPENDENCY_LOCK_REASON,
          versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
        },
      },
      updateOptions,
    )

    await group.model.updateMany(
      {
        stableId: { $in: ids },
        $or: [
          { introducedInVersion: { $exists: false } },
          { introducedInVersion: null },
          { introducedInVersion: '' },
        ],
      },
      {
        $set: {
          introducedInVersion: packageVersion,
        },
      },
      updateOptions,
    )
  }
}

const recomputeRuntimeControlDependencyLockState = async ({
  packageKey,
  session,
}) => {
  const updateOptions = session ? { session } : {}

  for (const group of DEPENDENCY_LOCK_GROUPS) {
    const lockedRows = await group.model.find(
      { lockedByPackageKeys: packageKey },
      { stableId: 1, lockedByPackageKeys: 1 },
      updateOptions,
    )

    for (const row of lockedRows) {
      const updatedPackageKeys = (row.lockedByPackageKeys || [])
        .filter((key) => key !== packageKey)

      if (updatedPackageKeys.length === 0) {
        await group.model.updateOne(
          { stableId: row.stableId },
          {
            $set: {
              lockedByPackageKeys: [],
              isLocked: false,
              lockedBy: null,
              lockedAt: null,
              lockedReason: '',
            },
          },
          updateOptions,
        )
      } else {
        await group.model.updateOne(
          { stableId: row.stableId },
          {
            $set: {
              lockedByPackageKeys: updatedPackageKeys,
            },
          },
          updateOptions,
        )
      }
    }
  }
}

const prepareFrameworkPackageDependencyLock = async ({
  frameworkPackage,
  actorUserId,
}) => {
  const lockedAt = new Date()
  const dependencies = await fetchFrameworkPackageDependencies(frameworkPackage)
  const issueDetails = buildDependencyLockIssueDetails(dependencies)
  const status = Object.keys(issueDetails).length > 0 ? 'FAIL' : 'PASS'
  const snapshot = buildDependencyLockSnapshot({
    frameworkPackage,
    dependencies,
    actorUserId,
    lockedAt,
    status,
  })

  return {
    dependencies,
    issueDetails,
    snapshot,
    lockedAt,
  }
}

const resolveUIContractIntegrity = ({ frameworkPackage, uiContract }) => {
  const checks = []
  const frameworkKey = String(frameworkPackage.frameworkKey || '').trim().toUpperCase()
  const uiContractKey = String(frameworkPackage.uiContractKey || '').trim().toLowerCase()
  const packageSections = getStructuralSections(frameworkPackage.sections)
  const packageSectionByKey = new Map(
    packageSections
      .map((section) => [normalizeSectionKey(section?.sectionKey), section])
      .filter(([sectionKey]) => sectionKey),
  )

  if (packageSections.length > 0 && !uiContractKey) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.required',
      group: 'UI Contract Integrity',
      severity: isReadyFrameworkPackageStatus(frameworkPackage.status) ? 'FAIL' : 'WARN',
      message: 'UI Contract is required before validation when sections are configured.',
      field: 'uiContractKey',
    }))
    return checks
  }

  if (!uiContractKey) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.optional',
      group: 'UI Contract Integrity',
      message: 'No UI Contract is required while the package has no configured sections.',
      field: 'uiContractKey',
    }))
    return checks
  }

  if (!uiContract) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.exists',
      group: 'UI Contract Integrity',
      severity: 'FAIL',
      message: `UI Contract "${uiContractKey}" was not found.`,
      field: 'uiContractKey',
    }))
    return checks
  }

  checks.push(buildIntegrityCheck({
    key: 'uiContract.exists',
    group: 'UI Contract Integrity',
    message: `UI Contract "${uiContractKey}" exists.`,
    field: 'uiContractKey',
  }))

  if (uiContract.status !== UI_CONTRACT_STATUSES.ACTIVE) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.active',
      group: 'UI Contract Integrity',
      severity: isReadyFrameworkPackageStatus(frameworkPackage.status) ? 'FAIL' : 'WARN',
      message: `UI Contract "${uiContractKey}" must be ACTIVE before validation.`,
      field: 'uiContractKey',
    }))
  } else {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.active',
      group: 'UI Contract Integrity',
      message: `UI Contract "${uiContractKey}" is ACTIVE.`,
      field: 'uiContractKey',
    }))
  }

  if (uiContract.versionStatus !== RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.versionStatus',
      group: 'UI Contract Integrity',
      severity: isReadyFrameworkPackageStatus(frameworkPackage.status) ? 'FAIL' : 'WARN',
      message: `UI Contract "${uiContractKey}" version status must be ACTIVE before validation.`,
      field: 'uiContractKey',
    }))
  } else {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.versionStatus',
      group: 'UI Contract Integrity',
      message: `UI Contract "${uiContractKey}" version status is ACTIVE.`,
      field: 'uiContractKey',
    }))
  }

  if (!Array.isArray(uiContract.frameworkKeys) || !uiContract.frameworkKeys.includes(frameworkKey)) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.framework',
      group: 'UI Contract Integrity',
      severity: 'FAIL',
      message: `UI Contract "${uiContractKey}" is not compatible with framework "${frameworkKey}".`,
      field: 'uiContractKey',
    }))
  } else {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.framework',
      group: 'UI Contract Integrity',
      message: `UI Contract "${uiContractKey}" supports framework "${frameworkKey}".`,
      field: 'uiContractKey',
    }))
  }

  const packageBackedUiSections = getStructuralSections(uiContract.sections)
    .filter((section) =>
      section?.isCustom !== true
      && String(section?.source || '').trim().toUpperCase() !== 'CUSTOM')
  const uiSectionByKey = new Map(
    packageBackedUiSections
      .map((section) => [normalizeSectionKey(section?.sectionKey), section])
      .filter(([sectionKey]) => sectionKey),
  )
  const missingMappings = [...packageSectionByKey.keys()].filter((sectionKey) => !uiSectionByKey.has(sectionKey))
  const orphanMappings = [...uiSectionByKey.keys()].filter((sectionKey) => !packageSectionByKey.has(sectionKey))
  const runtimePathMismatches = [...packageSectionByKey.entries()]
    .filter(([sectionKey, packageSection]) => {
      const uiSection = uiSectionByKey.get(sectionKey)
      return uiSection && normalizeRuntimePath(uiSection.runtimePath) !== normalizeRuntimePath(packageSection.runtimePath)
    })
    .map(([sectionKey]) => sectionKey)

  if (missingMappings.length > 0) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.sectionCoverage',
      group: 'UI Contract Integrity',
      severity: 'FAIL',
      message: `UI Contract "${uiContractKey}" is missing presentation mappings for package sections: ${missingMappings.join(', ')}.`,
      field: 'sections',
    }))
  } else {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.sectionCoverage',
      group: 'UI Contract Integrity',
      message: 'Every package section has a mapped UI Contract section.',
      field: 'sections',
    }))
  }

  if (orphanMappings.length > 0) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.orphanSections',
      group: 'UI Contract Integrity',
      severity: 'FAIL',
      message: `UI Contract sections must exist in the source package unless marked custom: ${orphanMappings.join(', ')}.`,
      field: 'sections',
    }))
  }

  if (runtimePathMismatches.length > 0) {
    checks.push(buildIntegrityCheck({
      key: 'uiContract.runtimePathMatch',
      group: 'UI Contract Integrity',
      severity: 'FAIL',
      message: `UI Contract runtime paths must match package section definitions: ${runtimePathMismatches.join(', ')}.`,
      field: 'sections',
    }))
  }

  return checks
}

const buildFrameworkPackageIntegrity = async (frameworkPackage) => {
  const checks = []
  const frameworkKey = String(frameworkPackage.frameworkKey || '').trim().toUpperCase()
  const readyStatus = isReadyFrameworkPackageStatus(frameworkPackage.status)
  const sections = getStructuralSections(frameworkPackage.sections)
  const validationKeys = getUniqueValidationKeys(frameworkPackage)
  const workflowPolicyKeys = getUniqueWorkflowPolicyKeys(frameworkPackage)
  const uiContractKey = String(frameworkPackage.uiContractKey || '').trim().toLowerCase()

  checks.push(buildIntegrityCheck({
    key: 'packageKey.required',
    group: 'Configuration Integrity',
    severity: normalizeKeyValue(frameworkPackage.packageKey) ? 'PASS' : readyStatus ? 'FAIL' : 'WARN',
    message: normalizeKeyValue(frameworkPackage.packageKey)
      ? 'Package key is present.'
      : 'Package key is required before validation.',
    field: 'packageKey',
  }))

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    const value = frameworkPackage[field]
    const hasValue =
      value !== undefined
      && value !== null
      && (!Array.isArray(value) || value.length > 0)
      && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0)

    checks.push(buildIntegrityCheck({
      key: `deprecated.${field}`,
      group: 'Configuration Integrity',
      severity: hasValue ? 'FAIL' : 'PASS',
      message: hasValue
        ? DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES[field]
        : (OPTIONAL_FRAMEWORK_PACKAGE_FIELD_MESSAGES[field] ?? `${field} is deprecated and not configured.`),
      field,
    }))
  }

  const sectionKeys = sections.map((section) => normalizeSectionKey(section?.sectionKey)).filter(Boolean)
  const sectionRuntimePaths = sections.map((section) => normalizeRuntimePath(section?.runtimePath)).filter(Boolean)
  checks.push(buildIntegrityCheck({
    key: 'sections.uniqueKeys',
    group: 'Sections Integrity',
    severity: sectionKeys.length === new Set(sectionKeys).size ? 'PASS' : 'FAIL',
    message: sectionKeys.length === new Set(sectionKeys).size
      ? 'Section keys are unique.'
      : 'Section keys must be unique.',
    field: 'sections',
  }))
  checks.push(buildIntegrityCheck({
    key: 'sections.uniqueRuntimePaths',
    group: 'Sections Integrity',
    severity: sectionRuntimePaths.length === new Set(sectionRuntimePaths).size ? 'PASS' : 'FAIL',
    message: sectionRuntimePaths.length === new Set(sectionRuntimePaths).size
      ? 'Section runtime paths are unique.'
      : 'Section runtime paths must be unique.',
    field: 'sections',
  }))

  const runtimePathMessage = await validateSectionRuntimePaths({ sections, frameworkKey })
  checks.push(buildIntegrityCheck({
    key: 'sections.runtimePaths',
    group: 'Sections Integrity',
    severity: runtimePathMessage ? 'FAIL' : 'PASS',
    message: runtimePathMessage || 'Section runtime paths are registered and package-compatible.',
    field: 'sections',
  }))

  const [validationRows, workflowRows, uiContract] = await Promise.all([
    validationKeys.length > 0
      ? ValidationRegistry.find({ key: { $in: validationKeys } })
        .select('key status supportedFrameworkKeys packageUsable')
        .lean()
      : Promise.resolve([]),
    workflowPolicyKeys.length > 0
      ? WorkflowPolicy.find({ key: { $in: workflowPolicyKeys } })
        .select('key status frameworkKeys')
        .lean()
      : Promise.resolve([]),
    uiContractKey
      ? UIContract.findOne({ uiContractKey })
        .select('uiContractKey status versionStatus frameworkKeys sourcePackageVersion introducedInVersion compatibilityMode sections.sectionKey sections.runtimePath sections.source sections.isCustom')
        .lean()
      : Promise.resolve(null),
  ])

  const validationByKey = new Map(validationRows.map((row) => [row.key, row]))
  const invalidValidationKeys = validationKeys.filter((validationKey) => {
    const row = validationByKey.get(validationKey)
    if (!row) return true
    if (row.status !== VALIDATION_REGISTRY_STATUSES.ACTIVE) return true
    if (row.packageUsable === false) return true
    return !Array.isArray(row.supportedFrameworkKeys) || !row.supportedFrameworkKeys.includes(frameworkKey)
  })
  checks.push(buildIntegrityCheck({
    key: 'validations.registry',
    group: 'Dependency Integrity',
    severity: invalidValidationKeys.length > 0 ? 'FAIL' : 'PASS',
    message: invalidValidationKeys.length > 0
      ? `Validation entries must be ACTIVE, package-usable, and compatible with "${frameworkKey}": ${invalidValidationKeys.join(', ')}.`
      : 'Validation bindings resolve to active package-usable registry entries.',
    field: 'validationBindings',
  }))

  const workflowByKey = new Map(workflowRows.map((row) => [row.key, row]))
  const invalidWorkflowKeys = workflowPolicyKeys.filter((policyKey) => {
    const row = workflowByKey.get(policyKey)
    if (!row) return true
    if (row.status !== WORKFLOW_POLICY_STATUSES.ACTIVE) return true
    return !Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)
  })
  checks.push(buildIntegrityCheck({
    key: 'workflows.registry',
    group: 'Dependency Integrity',
    severity: invalidWorkflowKeys.length > 0 ? 'FAIL' : 'PASS',
    message: invalidWorkflowKeys.length > 0
      ? `Workflow policies must be ACTIVE and compatible with "${frameworkKey}": ${invalidWorkflowKeys.join(', ')}.`
      : 'Workflow bindings resolve to active framework-compatible policies.',
    field: 'workflowBindings',
  }))

  const dependencies = await fetchFrameworkPackageDependencies(frameworkPackage)
  checks.push(...buildDependencyResolutionIntegrityChecks(dependencies))

  const dependencyIssueDetails = buildDependencyLockIssueDetails(dependencies)
  const dependencyLock = frameworkPackage.dependencyLock
  const hasDependencyLock =
    dependencyLock
    && String(dependencyLock.status || '').trim().toUpperCase() === 'PASS'
    && Array.isArray(dependencyLock.references)
    && dependencyLock.references.length > 0
  checks.push(buildIntegrityCheck({
    key: 'dependencyLock.snapshot',
    group: 'Dependency Integrity',
    severity: Object.keys(dependencyIssueDetails).length > 0
      ? 'FAIL'
      : readyStatus && !hasDependencyLock
        ? 'WARN'
        : 'PASS',
    message: Object.keys(dependencyIssueDetails).length > 0
      ? 'Dependency lock snapshot cannot be created until unresolved dependencies are fixed.'
      : hasDependencyLock
        ? 'Dependency lock snapshot exists for this package release boundary.'
        : 'Dependency lock snapshot will be created when the package is validated.',
    field: 'dependencyLock',
  }))

  checks.push(...resolveUIContractIntegrity({ frameworkPackage, uiContract }))

  const stateContractDetails = validateFrameworkPackageStateContract(frameworkPackage)
  checks.push(buildIntegrityCheck({
    key: 'stateContract.consistency',
    group: 'State Contract Integrity',
    severity: Object.keys(stateContractDetails).length > 0 ? 'FAIL' : 'PASS',
    message: Object.keys(stateContractDetails).length > 0
      ? Object.values(stateContractDetails).join(' ')
      : 'State Contract fields are internally consistent.',
    field: Object.keys(stateContractDetails)[0] || 'stateModelMode',
  }))

  checks.push(buildIntegrityCheck({
    key: 'outputs.metadataOnly',
    group: 'Output Placeholder Integrity',
    severity: 'PASS',
    message: 'Output fields are metadata placeholders only; no runtime output execution is bound here.',
    field: 'availableOutputKeys',
  }))

  const { status, summary } = summarizeIntegrityChecks(checks)
  return {
    status,
    summary,
    checks,
  }
}

const buildCheckpointPackageProjection = ({ frameworkPackage, mode }) => {
  const plain = typeof frameworkPackage?.toObject === 'function'
    ? frameworkPackage.toObject()
    : { ...(frameworkPackage || {}) }
  // Non-activation checkpoints answer "would this package satisfy the validated runtime contract?"
  const checkpointStatus = mode === FRAMEWORK_PACKAGE_CHECKPOINT_MODES.ACTIVATION
    ? FRAMEWORK_PACKAGE_STATUSES.ACTIVE
    : FRAMEWORK_PACKAGE_STATUSES.VALIDATED

  return {
    ...plain,
    _id: plain._id || frameworkPackage?._id,
    id: plain.id || frameworkPackage?.id,
    status: checkpointStatus,
  }
}

const runFrameworkPackageCheckpoint = async ({
  frameworkPackage,
  actorUserId,
  actorSummary = null,
  mode = FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL,
} = {}) => {
  const normalizedMode = normalizeCheckpointMode(mode)
  const checkpointPackage = buildCheckpointPackageProjection({
    frameworkPackage,
    mode: normalizedMode,
  })
  const [integrity, registryDetails, dependencyLockResult] = await Promise.all([
    buildFrameworkPackageIntegrity(checkpointPackage),
    validateFrameworkPackageRegistryReferences({
      frameworkKey: checkpointPackage.frameworkKey,
      validationBindings: checkpointPackage.validationBindings,
      workflowBindings: checkpointPackage.workflowBindings,
      sections: checkpointPackage.sections,
      uiContractKey: checkpointPackage.uiContractKey,
      validateSections: true,
      validateUiContractSections: true,
    }),
    prepareFrameworkPackageDependencyLock({
      frameworkPackage: checkpointPackage,
      actorUserId,
    }),
  ])
  const readinessDetails = validateFrameworkPackageReadiness(checkpointPackage)
  const stateContractDetails = validateFrameworkPackageStateContract(checkpointPackage)
  const extraIssues = mapDetailsToCheckpointIssues({
    ...readinessDetails,
    ...stateContractDetails,
    ...registryDetails,
    ...dependencyLockResult.issueDetails,
  })
  const checkpointIntegrity = normalizeIntegrityForCheckpoint({
    integrity,
    dependencyLockResult,
  })
  const checkpoint = buildCheckpointResponse({
    frameworkPackage: checkpointPackage,
    mode: normalizedMode,
    actorUserId,
    actorSummary,
    integrity: checkpointIntegrity,
    dependencyLockResult,
    extraIssues,
  })

  return {
    checkpoint,
    dependencyLockResult,
  }
}

const persistFrameworkPackageCheckpointMetadata = ({ frameworkPackage, checkpoint }) => {
  // runBy is a point-in-time audit snapshot; later user profile edits should not rewrite prior checkpoint evidence.
  frameworkPackage.lastCheckpointStatus = checkpoint.status
  frameworkPackage.lastCheckpointAt = checkpoint.timestamp
  frameworkPackage.lastCheckpointResult = checkpoint
}

const summarizeCheckpointForAudit = (checkpoint) => {
  if (!checkpoint) return checkpoint

  return {
    schemaVersion: checkpoint.schemaVersion || '1',
    mode: checkpoint.mode || null,
    status: checkpoint.status || null,
    summary: checkpoint.summary || null,
    timestamp: checkpoint.timestamp || null,
    errorCount: Array.isArray(checkpoint.errors) ? checkpoint.errors.length : 0,
    warningCount: Array.isArray(checkpoint.warnings) ? checkpoint.warnings.length : 0,
  }
}

export const listFrameworkPackages = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await FrameworkPackage.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await FrameworkPackage.find(filter)
      .sort({ frameworkKey: 1, isDefault: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('activatedBy', 'name email')
      .lean()

    const checkpointRunByFallbacksById = await resolveCheckpointRunByFallbacksById(items)

    return res.status(200).json({
      data: items.map((item) => {
        const checkpointRunById = getCheckpointRunByResolutionId({
          checkpoint: item.lastCheckpointResult,
          fallbackRunBy: item.activatedBy || item.updatedBy,
        })
        return serializeFrameworkPackage(item, {
          checkpointRunByFallback: checkpointRunByFallbacksById.get(checkpointRunById),
        })
      }),
      meta: {
        page: normalizedPage,
        pageSize: limit,
        total,
        totalPages,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const createFrameworkPackage = async (req, res, next) => {
  try {
    const deprecatedFieldDetails = validateDeprecatedFrameworkPackageFields(req.body)
    if (Object.keys(deprecatedFieldDetails).length > 0) {
      return sendValidationFailed(res, req, deprecatedFieldDetails)
    }

    // Create uses the validator-normalized payload as the full contract; requested-field capture is PATCH-only.
    const canonicalPackagePayload = filterPayloadToRequestedFields(
      omitDeprecatedFrameworkPackageFields(req.body),
      req.frameworkPackageUpdateFields,
    )

    const accessRuleDetails = validateFrameworkPackageAccessRules(req.body)
    if (Object.keys(accessRuleDetails).length > 0) {
      return sendValidationFailed(res, req, accessRuleDetails)
    }

    const readinessDetails = validateFrameworkPackageReadiness(canonicalPackagePayload)
    if (Object.keys(readinessDetails).length > 0) {
      return sendValidationFailed(res, req, readinessDetails)
    }

    const stateContractDetails = validateFrameworkPackageStateContract(canonicalPackagePayload)
    if (Object.keys(stateContractDetails).length > 0) {
      return sendValidationFailed(res, req, stateContractDetails)
    }

    const validationDetails = await validateFrameworkPackageRegistryReferences({
      ...canonicalPackagePayload,
      validateSections: true,
      validateUiContractSections: true,
    })
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const existingPackage = await FrameworkPackage.findOne({
      frameworkKey: req.body.frameworkKey,
      version: req.body.version,
    }).select('_id')

    if (existingPackage) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE, {
        field: 'version',
        reason: 'FRAMEWORK_PACKAGE_VERSION_CONFLICT',
      })
    }

    const uiContractBinding = await resolveUIContractBinding({
      uiContractKey: canonicalPackagePayload.uiContractKey,
      frameworkPackage: canonicalPackagePayload,
    })

    const actorUserId = req.context?.userId || req.userId
    const actorSummary = buildActorSummary(req)
    const frameworkPackage = new FrameworkPackage({
      ...canonicalPackagePayload,
      uiContractBinding,
      isDefault: false,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    let dependencyLockResult = null
    if (frameworkPackage.status === FRAMEWORK_PACKAGE_STATUSES.VALIDATED) {
      const checkpointRun = await runFrameworkPackageCheckpoint({
        frameworkPackage,
        actorUserId,
        actorSummary,
        mode: FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL,
      })
      if (checkpointRun.checkpoint.status === FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.FAIL) {
        return sendCheckpointValidationFailed(res, req, checkpointRun.checkpoint)
      }

      dependencyLockResult = checkpointRun.dependencyLockResult
      frameworkPackage.dependencyLock = dependencyLockResult.snapshot
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      frameworkPackage.versionStatus = RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
      frameworkPackage.isLocked = true
      frameworkPackage.lockedAt = dependencyLockResult.lockedAt
      frameworkPackage.lockedBy = actorUserId
      frameworkPackage.lockedReason = 'Framework package reached a governed runtime release boundary.'
    }

    if (dependencyLockResult) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          await frameworkPackage.save({ session })
          await updateRuntimeControlDependencyLocks({
            dependencies: dependencyLockResult.dependencies,
            packageKey: frameworkPackage.packageKey,
            packageVersion: frameworkPackage.version,
            actorUserId,
            lockedAt: dependencyLockResult.lockedAt,
            session,
          })
        })
      } finally {
        await session.endSession()
      }
    } else {
      await frameworkPackage.save()
    }
    await populateFrameworkPackage(frameworkPackage)

    const serializedPackage = serializeFrameworkPackage(frameworkPackage, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_CREATED,
      resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
      resourceId: frameworkPackage._id,
      scope: {
        frameworkKey: frameworkPackage.frameworkKey,
      },
      display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
      diff: {
        frameworkKey: frameworkPackage.frameworkKey,
        frameworkName: frameworkPackage.frameworkName,
        version: frameworkPackage.version,
        description: frameworkPackage.description,
        status: frameworkPackage.status,
        versionStatus: frameworkPackage.versionStatus,
        isLocked: frameworkPackage.isLocked,
        dependencyLock: frameworkPackage.dependencyLock,
        lastCheckpointStatus: frameworkPackage.lastCheckpointStatus,
        lastCheckpointAt: frameworkPackage.lastCheckpointAt,
        isDefault: frameworkPackage.isDefault,
        packageKey: frameworkPackage.packageKey,
        packageName: frameworkPackage.packageName,
        packageScope: frameworkPackage.packageScope,
        packageType: frameworkPackage.packageType,
        derivedFromPackageId: frameworkPackage.derivedFromPackageId,
        visibility: frameworkPackage.visibility,
        customerAccessMode: frameworkPackage.customerAccessMode,
        assignedCustomerIds: frameworkPackage.assignedCustomerIds,
        sections: frameworkPackage.sections,
        runtimeSettings: frameworkPackage.runtimeSettings,
        executionModel: frameworkPackage.executionModel,
        validationBindings: frameworkPackage.validationBindings,
        workflowBindings: frameworkPackage.workflowBindings,
        uiContractKey: frameworkPackage.uiContractKey,
        uiContractBinding: frameworkPackage.uiContractBinding,
        stateModelKey: frameworkPackage.stateModelKey,
        stateModelVersion: frameworkPackage.stateModelVersion,
        stateModelMode: frameworkPackage.stateModelMode,
        stateBindingMode: frameworkPackage.stateBindingMode,
        statePersistence: frameworkPackage.statePersistence,
        stateContractNotes: frameworkPackage.stateContractNotes,
        availableOutputKeys: frameworkPackage.availableOutputKeys,
        defaultOutputStyles: frameworkPackage.defaultOutputStyles,
        allowCustomerOutputDefinitions: frameworkPackage.allowCustomerOutputDefinitions,
        artifactRetentionDays: frameworkPackage.artifactRetentionDays,
        allowOutputRevisionHistory: frameworkPackage.allowOutputRevisionHistory,
        capabilities: frameworkPackage.capabilities,
      },
    })

    if (frameworkPackage.status === FRAMEWORK_PACKAGE_STATUSES.VALIDATED) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_VALIDATED,
        resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
        resourceId: frameworkPackage._id,
        scope: {
          frameworkKey: frameworkPackage.frameworkKey,
        },
        display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
        diff: {
          status: {
            from: null,
            to: FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
          },
          packageKey: frameworkPackage.packageKey,
          uiContractKey: frameworkPackage.uiContractKey,
          validationBindings: frameworkPackage.validationBindings,
          workflowBindings: frameworkPackage.workflowBindings,
          dependencyLock: frameworkPackage.dependencyLock,
        },
      })
    }

    return res.status(201).json({
      data: serializedPackage,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateFrameworkPackageVersionError(err)) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE, {
        field: 'version',
        reason: 'FRAMEWORK_PACKAGE_VERSION_CONFLICT',
      })
    }

    if (isActiveDefaultConflictError(err)) {
      return sendConflict(res, req, ACTIVE_DEFAULT_CONFLICT_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_ACTIVE_DEFAULT_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

export const getFrameworkPackage = async (req, res, next) => {
  try {
    const frameworkPackage = await FrameworkPackage.findById(req.params.packageId)

    if (!frameworkPackage) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateFrameworkPackage(frameworkPackage)
    const checkpointRunByFallback = await resolveCheckpointRunByFallback({
      checkpoint: frameworkPackage.lastCheckpointResult,
      fallbackRunBy: frameworkPackage.activatedBy || frameworkPackage.updatedBy,
    })

    return res.status(200).json({
      data: serializeFrameworkPackage(frameworkPackage, { checkpointRunByFallback }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateFrameworkPackage = async (req, res, next) => {
  try {
    const frameworkPackage = await FrameworkPackage.findById(req.params.packageId)

    if (!frameworkPackage) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const deprecatedFieldDetails = validateDeprecatedFrameworkPackageFields(req.body)
    if (Object.keys(deprecatedFieldDetails).length > 0) {
      return sendValidationFailed(res, req, deprecatedFieldDetails)
    }

    const canonicalPackagePayload = filterPayloadToRequestedFields(
      omitDeprecatedFrameworkPackageFields(req.body),
      req.frameworkPackageUpdateFields,
    )

    const structuralLockDetails = validateStructuralLocks(frameworkPackage, canonicalPackagePayload)
    if (structuralLockDetails._reason) {
      const { _message, _reason, ...fieldDetails } = structuralLockDetails
      return sendConflict(res, req, _message, {
        reason: _reason,
        ...(Object.keys(fieldDetails).length > 0 ? { fields: fieldDetails } : {}),
      })
    }

    const nextFrameworkKey = canonicalPackagePayload.frameworkKey ?? frameworkPackage.frameworkKey
    const nextVersion = canonicalPackagePayload.version ?? frameworkPackage.version
    const nextStatus = canonicalPackagePayload.status ?? frameworkPackage.status
    const nextPackageKey = canonicalPackagePayload.packageKey ?? frameworkPackage.packageKey
    const nextValidationBindings = canonicalPackagePayload.validationBindings ?? frameworkPackage.validationBindings
    const nextWorkflowBindings = canonicalPackagePayload.workflowBindings ?? frameworkPackage.workflowBindings
    const nextSections = canonicalPackagePayload.sections ?? frameworkPackage.sections
    const nextUiContractKey = canonicalPackagePayload.uiContractKey ?? frameworkPackage.uiContractKey
    const nextStateModelKey = canonicalPackagePayload.stateModelKey ?? frameworkPackage.stateModelKey
    const nextStateModelVersion = canonicalPackagePayload.stateModelVersion ?? frameworkPackage.stateModelVersion
    const nextStateModelMode = canonicalPackagePayload.stateModelMode ?? frameworkPackage.stateModelMode
    const nextVisibility = canonicalPackagePayload.visibility ?? frameworkPackage.visibility
    const nextCustomerAccessMode = canonicalPackagePayload.customerAccessMode ?? frameworkPackage.customerAccessMode
    const nextAssignedCustomerIds = canonicalPackagePayload.assignedCustomerIds ?? frameworkPackage.assignedCustomerIds

    const accessRuleDetails = validateFrameworkPackageAccessRules({
      visibility: nextVisibility,
      customerAccessMode: nextCustomerAccessMode,
      assignedCustomerIds: nextAssignedCustomerIds,
    })
    if (Object.keys(accessRuleDetails).length > 0) {
      return sendValidationFailed(res, req, accessRuleDetails)
    }

    if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE && nextStatus === FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
      return sendConflict(res, req, ACTIVATION_ENDPOINT_REQUIRED_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_USE_ACTIVATE_ENDPOINT',
      })
    }

    if (frameworkPackage.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE && nextStatus !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
      return sendConflict(res, req, ACTIVE_PACKAGE_STATUS_CHANGE_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_ACTIVE_STATUS_LOCKED',
      })
    }

    const readinessDetails = validateFrameworkPackageReadiness({
      status: nextStatus,
      packageKey: nextPackageKey,
      sections: nextSections,
      uiContractKey: nextUiContractKey,
    })
    if (Object.keys(readinessDetails).length > 0) {
      return sendValidationFailed(res, req, readinessDetails)
    }

    const stateContractDetails = validateFrameworkPackageStateContract({
      stateModelKey: nextStateModelKey,
      stateModelVersion: nextStateModelVersion,
      stateModelMode: nextStateModelMode,
    })
    if (Object.keys(stateContractDetails).length > 0) {
      return sendValidationFailed(res, req, stateContractDetails)
    }

    const shouldValidateCanonicalReferences = [
      'frameworkKey',
      'status',
      'sections',
      'uiContractKey',
      'validationBindings',
      'workflowBindings',
    ].some((field) => canonicalPackagePayload[field] !== undefined)

    const validationDetails = shouldValidateCanonicalReferences
      ? await validateFrameworkPackageRegistryReferences({
        frameworkKey: nextFrameworkKey,
        validationBindings: nextValidationBindings,
        workflowBindings: nextWorkflowBindings,
        sections: nextSections,
        uiContractKey: nextUiContractKey,
        validateSections: true,
        validateUiContractSections: true,
      })
      : {}
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    if (canonicalPackagePayload.uiContractKey !== undefined) {
      canonicalPackagePayload.uiContractBinding = await resolveUIContractBinding({
        uiContractKey: nextUiContractKey,
        frameworkPackage: {
          ...frameworkPackage.toObject?.(),
          ...canonicalPackagePayload,
          version: nextVersion,
        },
      })
    }

    const duplicatePackage = await FrameworkPackage.findOne({
      _id: { $ne: frameworkPackage._id },
      frameworkKey: nextFrameworkKey,
      version: nextVersion,
    }).select('_id')

    if (duplicatePackage) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE, {
        field: 'version',
        reason: 'FRAMEWORK_PACKAGE_VERSION_CONFLICT',
      })
    }

    const diff = {}
    const previousStatus = frameworkPackage.status

    for (const field of FRAMEWORK_PACKAGE_AUDITED_FIELDS) {
      if (canonicalPackagePayload[field] === undefined) continue

      const previousValue = cloneAuditValue(frameworkPackage[field])
      const nextValue = cloneAuditValue(canonicalPackagePayload[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      frameworkPackage[field] = canonicalPackagePayload[field]
    }

    const actorUserId = req.context?.userId || req.userId
    let dependencyLockResult = null
    if (
      frameworkPackage.status === FRAMEWORK_PACKAGE_STATUSES.VALIDATED
      && (previousStatus !== FRAMEWORK_PACKAGE_STATUSES.VALIDATED || !frameworkPackage.dependencyLock)
    ) {
      const actorSummary = buildActorSummary(req)
      const checkpointRun = await runFrameworkPackageCheckpoint({
        frameworkPackage,
        actorUserId,
        actorSummary,
        mode: FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL,
      })
      if (checkpointRun.checkpoint.status === FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.FAIL) {
        return sendCheckpointValidationFailed(res, req, checkpointRun.checkpoint)
      }

      dependencyLockResult = checkpointRun.dependencyLockResult
      const previousDependencyLock = cloneAuditValue(frameworkPackage.dependencyLock)
      const previousCheckpointStatus = cloneAuditValue(frameworkPackage.lastCheckpointStatus)
      const previousCheckpointAt = cloneAuditValue(frameworkPackage.lastCheckpointAt)
      const previousCheckpointResult = cloneAuditValue(frameworkPackage.lastCheckpointResult)
      frameworkPackage.dependencyLock = dependencyLockResult.snapshot
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      frameworkPackage.versionStatus = RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
      frameworkPackage.isLocked = true
      frameworkPackage.lockedAt = dependencyLockResult.lockedAt
      frameworkPackage.lockedBy = actorUserId
      frameworkPackage.lockedReason = 'Framework package reached a governed runtime release boundary.'
      diff.dependencyLock = {
        from: previousDependencyLock,
        to: cloneAuditValue(dependencyLockResult.snapshot),
      }
      diff.lastCheckpointStatus = {
        from: previousCheckpointStatus,
        to: checkpointRun.checkpoint.status,
      }
      diff.lastCheckpointAt = {
        from: previousCheckpointAt,
        to: checkpointRun.checkpoint.timestamp,
      }
      diff.lastCheckpointResult = {
        from: summarizeCheckpointForAudit(previousCheckpointResult),
        to: summarizeCheckpointForAudit(checkpointRun.checkpoint),
      }
    }

    const isDemotedFromValidated = previousStatus === FRAMEWORK_PACKAGE_STATUSES.VALIDATED
      && nextStatus === FRAMEWORK_PACKAGE_STATUSES.DRAFT

    frameworkPackage.updatedBy = actorUserId
    if (isDemotedFromValidated) {
      // When demoting a package from VALIDATED to DRAFT, recompute dependency locks it owned.
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          await frameworkPackage.save({ session })
          await recomputeRuntimeControlDependencyLockState({
            packageKey: frameworkPackage.packageKey,
            session,
          })
        })
      } finally {
        await session.endSession()
      }
    } else if (dependencyLockResult) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          await frameworkPackage.save({ session })
          await updateRuntimeControlDependencyLocks({
            dependencies: dependencyLockResult.dependencies,
            packageKey: frameworkPackage.packageKey,
            packageVersion: frameworkPackage.version,
            actorUserId,
            lockedAt: dependencyLockResult.lockedAt,
            session,
          })
        })
      } finally {
        await session.endSession()
      }
    } else {
      await frameworkPackage.save()
    }
    await populateFrameworkPackage(frameworkPackage)

    if (Object.keys(diff).length > 0) {
      const auditAction = diff.status?.to === FRAMEWORK_PACKAGE_STATUSES.VALIDATED
        ? auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_VALIDATED
        : auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_UPDATED

      await auditService.logFromRequest(req, {
        action: auditAction,
        resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
        resourceId: frameworkPackage._id,
        scope: {
          frameworkKey: frameworkPackage.frameworkKey,
        },
        display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeFrameworkPackage(frameworkPackage, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateFrameworkPackageVersionError(err)) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE, {
        field: 'version',
        reason: 'FRAMEWORK_PACKAGE_VERSION_CONFLICT',
      })
    }

    if (isActiveDefaultConflictError(err)) {
      return sendConflict(res, req, ACTIVE_DEFAULT_CONFLICT_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_ACTIVE_DEFAULT_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

const findFrameworkPackageOr404 = async (req, res) => {
  const frameworkPackage = await FrameworkPackage.findById(req.params.packageId)

  if (!frameworkPackage) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE,
        requestId: req.requestId,
      },
    })
    return null
  }

  return frameworkPackage
}

export const getFrameworkPackageDependencies = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const dependencies = await fetchFrameworkPackageDependencies(frameworkPackage)

    return res.status(200).json({
      data: dependencies,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getFrameworkPackageIntegrity = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const integrity = await buildFrameworkPackageIntegrity(frameworkPackage)

    return res.status(200).json({
      data: {
        id: toIdString(frameworkPackage._id) || frameworkPackage.id,
        frameworkKey: frameworkPackage.frameworkKey,
        packageKey: frameworkPackage.packageKey,
        version: frameworkPackage.version,
        status: frameworkPackage.status,
        ...integrity,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const runFrameworkPackageCheckpointEndpoint = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const actorUserId = req.context?.userId || req.userId
    const actorSummary = buildActorSummary(req)
    const mode = req.body?.mode || FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL
    if (req.body?.persist === true && mode === FRAMEWORK_PACKAGE_CHECKPOINT_MODES.DRY_RUN) {
      return sendValidationFailed(res, req, {
        persist: 'Dry-run checkpoints cannot be persisted.',
      })
    }

    const checkpointRun = await runFrameworkPackageCheckpoint({
      frameworkPackage,
      actorUserId,
      actorSummary,
      mode,
    })

    if (req.body?.persist === true) {
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      await frameworkPackage.save()
      await populateFrameworkPackage(frameworkPackage)
    }

    return res.status(200).json({
      data: checkpointRun.checkpoint,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getFrameworkPackageLatestCheckpoint = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    await populateFrameworkPackage(frameworkPackage)
    const storedCheckpoint = hasStoredCheckpointResult(frameworkPackage.lastCheckpointResult)
      ? frameworkPackage.lastCheckpointResult
      : null
    const fallbackRunBy = storedCheckpoint
      ? await resolveCheckpointRunByFallback({
        checkpoint: storedCheckpoint,
        fallbackRunBy: frameworkPackage.activatedBy || frameworkPackage.updatedBy,
      })
      : null
    const fallbackCheckpoint = storedCheckpoint || {
      schemaVersion: '1',
      id: toIdString(frameworkPackage._id) || frameworkPackage.id,
      frameworkKey: frameworkPackage.frameworkKey,
      packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version,
      mode: null,
      status: 'NOT_RUN',
      errors: [],
      warnings: [],
      issues: [],
      passedChecks: [],
      dependencyGraph: null,
      dependencyLockPreview: frameworkPackage.dependencyLock || null,
      summary: {
        totalChecks: 0,
        passed: 0,
        warnings: 0,
        failed: 0,
        resolvedReferences: Number(frameworkPackage.dependencyLock?.references?.length) || 0,
      },
      timestamp: null,
      runBy: null,
    }

    return res.status(200).json({
      data: serializeCheckpointResult(fallbackCheckpoint, {
        fallbackRunBy,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getFrameworkPackageDependencyGraph = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const dependencies = await fetchFrameworkPackageDependencies(frameworkPackage)
    const dependencyGraph = buildCheckpointDependencyGraph({
      frameworkPackage,
      dependencies,
    })

    return res.status(200).json({
      data: dependencyGraph,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getFrameworkPackageDependencyLock = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    if (frameworkPackage.dependencyLock) {
      return res.status(200).json({
        data: frameworkPackage.dependencyLock,
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    const dependencyLockResult = await prepareFrameworkPackageDependencyLock({
      frameworkPackage,
      actorUserId: req.context?.userId || req.userId,
    })

    return res.status(200).json({
      data: dependencyLockResult.snapshot,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const validateFrameworkPackage = async (req, res, next) => {
  let session
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const actorUserId = req.context?.userId || req.userId
    const actorSummary = buildActorSummary(req)
    const previousStatus = frameworkPackage.status
    const previousDependencyLock = cloneAuditValue(frameworkPackage.dependencyLock)
    const previousCheckpointStatus = cloneAuditValue(frameworkPackage.lastCheckpointStatus)
    const previousCheckpointAt = cloneAuditValue(frameworkPackage.lastCheckpointAt)
    const previousCheckpointResult = cloneAuditValue(frameworkPackage.lastCheckpointResult)
    const checkpointRun = await runFrameworkPackageCheckpoint({
      frameworkPackage,
      actorUserId,
      actorSummary,
      mode: FRAMEWORK_PACKAGE_CHECKPOINT_MODES.FULL,
    })

    if (checkpointRun.checkpoint.status === FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.FAIL) {
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      await frameworkPackage.save()
      await populateFrameworkPackage(frameworkPackage)

      return sendCheckpointValidationFailed(res, req, checkpointRun.checkpoint)
    }

    if (previousStatus === FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      await frameworkPackage.save()
      await populateFrameworkPackage(frameworkPackage)

      return res.status(200).json({
        data: {
          package: serializeFrameworkPackage(frameworkPackage, {
            fallbackUpdatedBy: buildActorSummary(req),
          }),
          checkpoint: checkpointRun.checkpoint,
        },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    const dependencyLockResult = checkpointRun.dependencyLockResult
    const nextUIContractBinding = await resolveUIContractBinding({
      uiContractKey: frameworkPackage.uiContractKey,
      frameworkPackage,
    })

    session = await mongoose.startSession()
    await session.withTransaction(async () => {
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      frameworkPackage.updatedBy = actorUserId
      frameworkPackage.status = FRAMEWORK_PACKAGE_STATUSES.VALIDATED
      frameworkPackage.isDefault = false
      frameworkPackage.versionStatus = RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
      frameworkPackage.isLocked = true
      frameworkPackage.lockedAt = dependencyLockResult.lockedAt
      frameworkPackage.lockedBy = actorUserId
      frameworkPackage.lockedReason = 'Framework package reached a governed runtime release boundary.'
      frameworkPackage.dependencyLock = dependencyLockResult.snapshot
      frameworkPackage.uiContractBinding = nextUIContractBinding

      await frameworkPackage.save({ session })
      await updateRuntimeControlDependencyLocks({
        dependencies: dependencyLockResult.dependencies,
        packageKey: frameworkPackage.packageKey,
        packageVersion: frameworkPackage.version,
        actorUserId,
        lockedAt: dependencyLockResult.lockedAt,
        session,
      })
    })
    await populateFrameworkPackage(frameworkPackage)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_VALIDATED,
      resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
      resourceId: frameworkPackage._id,
      scope: {
        frameworkKey: frameworkPackage.frameworkKey,
      },
      display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
      diff: {
        status: {
          from: previousStatus,
          to: FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
        },
        dependencyLock: {
          from: previousDependencyLock,
          to: cloneAuditValue(frameworkPackage.dependencyLock),
        },
        lastCheckpointStatus: {
          from: previousCheckpointStatus,
          to: checkpointRun.checkpoint.status,
        },
        lastCheckpointAt: {
          from: previousCheckpointAt,
          to: checkpointRun.checkpoint.timestamp,
        },
        lastCheckpointResult: {
          from: summarizeCheckpointForAudit(previousCheckpointResult),
          to: summarizeCheckpointForAudit(checkpointRun.checkpoint),
        },
      },
    })

    return res.status(200).json({
      data: {
        package: serializeFrameworkPackage(frameworkPackage, {
          fallbackUpdatedBy: buildActorSummary(req),
        }),
        checkpoint: checkpointRun.checkpoint,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  } finally {
    await session?.endSession()
  }
}

export const getFrameworkPackageAudit = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const result = await auditService.getByResource(
      auditService.RESOURCE_TYPES.FrameworkPackage,
      frameworkPackage._id,
      { page, pageSize },
    )

    return res.status(200).json({
      data: result.data,
      meta: {
        ...result.meta,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const getFrameworkPackageDiff = async (req, res, next) => {
  try {
    const frameworkPackage = await findFrameworkPackageOr404(req, res)
    if (!frameworkPackage) return

    return res.status(501).json({
      error: {
        code: 'FRAMEWORK_PACKAGE_DIFF_NOT_AVAILABLE',
        message: 'Framework package version diff is not available until package snapshot history is implemented.',
        details: {
          packageId: req.params.packageId,
          requestedVersion: String(req.params.version || '').trim(),
        },
        requestId: req.requestId,
      },
    })
  } catch (err) {
    next(err)
  }
}

export const activateFrameworkPackage = async (req, res, next) => {
  const session = await mongoose.startSession()
  try {
    const frameworkPackage = await FrameworkPackage.findById(req.params.packageId)

    if (!frameworkPackage) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.VALIDATED) {
      return sendConflict(res, req, ACTIVATION_REQUIRES_VALIDATED_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_ACTIVATION_REQUIRES_VALIDATED',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const actorSummary = buildActorSummary(req)
    const checkpointRun = await runFrameworkPackageCheckpoint({
      frameworkPackage,
      actorUserId,
      actorSummary,
      mode: FRAMEWORK_PACKAGE_CHECKPOINT_MODES.ACTIVATION,
    })
    if (checkpointRun.checkpoint.status === FRAMEWORK_PACKAGE_CHECKPOINT_STATUSES.FAIL) {
      return sendCheckpointValidationFailed(res, req, checkpointRun.checkpoint)
    }
    const dependencyLockResult = checkpointRun.dependencyLockResult

    const shouldRefreshDependencyLock =
      !frameworkPackage.dependencyLock
      || String(frameworkPackage.dependencyLock.status || '').trim().toUpperCase() !== 'PASS'
    const previousActivePackageIds = []

    await session.withTransaction(async () => {
      const activationTime = new Date()
      const relatedPackages = await applySession(
        FrameworkPackage.find({
          frameworkKey: frameworkPackage.frameworkKey,
          _id: { $ne: frameworkPackage._id },
          $or: [
            { status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE },
            { isDefault: true },
          ],
        }),
        session,
      )

      for (const relatedPackage of relatedPackages) {
        const relatedPackagePatch = {
          isDefault: false,
          updatedBy: actorUserId,
          updatedAt: activationTime,
        }

        if (relatedPackage.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
          previousActivePackageIds.push(toIdString(relatedPackage._id))
          relatedPackagePatch.status = FRAMEWORK_PACKAGE_STATUSES.VALIDATED
        }

        // Demotion must tolerate legacy incumbent data until the deprecated-field cleanup script has run.
        await FrameworkPackage.updateOne(
          { _id: relatedPackage._id },
          { $set: relatedPackagePatch },
          { session, runValidators: false },
        )
      }

      const remainingActiveOrDefaultCount = await applySession(
        FrameworkPackage.countDocuments({
          frameworkKey: frameworkPackage.frameworkKey,
          _id: { $ne: frameworkPackage._id },
          $or: [
            { status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE },
            { isDefault: true },
          ],
        }),
        session,
      )

      if (remainingActiveOrDefaultCount > 0) {
        throw createActiveDefaultInvariantError()
      }

      frameworkPackage.status = FRAMEWORK_PACKAGE_STATUSES.ACTIVE
      frameworkPackage.isDefault = true
      frameworkPackage.versionStatus = RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
      frameworkPackage.isLocked = true
      frameworkPackage.lockedAt = frameworkPackage.lockedAt || activationTime
      frameworkPackage.lockedReason = frameworkPackage.lockedReason || 'Framework package reached a governed runtime release boundary.'
      frameworkPackage.uiContractBinding = await resolveUIContractBinding({
        uiContractKey: frameworkPackage.uiContractKey,
        frameworkPackage,
      })
      frameworkPackage.updatedBy = actorUserId
      frameworkPackage.activatedAt = activationTime
      frameworkPackage.activatedBy = actorUserId
      if (shouldRefreshDependencyLock) {
        frameworkPackage.dependencyLock = dependencyLockResult.snapshot
        frameworkPackage.lockedBy = actorUserId

        // Legacy validated packages may predate dependency snapshots; activation verifies and repairs that state.
        await updateRuntimeControlDependencyLocks({
          dependencies: dependencyLockResult.dependencies,
          packageKey: frameworkPackage.packageKey,
          packageVersion: frameworkPackage.version,
          actorUserId,
          lockedAt: dependencyLockResult.lockedAt,
          session,
        })
      }
      persistFrameworkPackageCheckpointMetadata({
        frameworkPackage,
        checkpoint: checkpointRun.checkpoint,
      })
      await frameworkPackage.save({ session })
    })

    await populateFrameworkPackage(frameworkPackage)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_ACTIVATED,
      resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
      resourceId: frameworkPackage._id,
      scope: {
        frameworkKey: frameworkPackage.frameworkKey,
      },
      display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
      diff: {
        frameworkKey: frameworkPackage.frameworkKey,
        version: frameworkPackage.version,
        previousActivePackageIds,
        activatedAt: frameworkPackage.activatedAt,
        checkpoint: summarizeCheckpointForAudit(checkpointRun.checkpoint),
        ...(shouldRefreshDependencyLock ? { dependencyLock: frameworkPackage.dependencyLock } : {}),
      },
    })

    return res.status(200).json({
      data: serializeFrameworkPackage(frameworkPackage, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isActiveDefaultConflictError(err) || isActiveDefaultInvariantError(err)) {
      return sendConflict(res, req, ACTIVE_DEFAULT_CONFLICT_MESSAGE, {
        field: 'status',
        reason: 'FRAMEWORK_PACKAGE_ACTIVE_DEFAULT_CONFLICT',
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  } finally {
    await session.endSession()
  }
}
