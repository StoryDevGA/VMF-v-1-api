import mongoose from 'mongoose'
import { isDeepStrictEqual } from 'node:util'
import FrameworkPackage, {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_VISIBILITY,
} from '../models/FrameworkPackage.js'
import ValidationRegistry, { VALIDATION_REGISTRY_STATUSES } from '../models/ValidationRegistry.js'
import WorkflowPolicy, { WORKFLOW_POLICY_STATUSES } from '../models/WorkflowPolicy.js'
import UIContract, { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../models/RuntimePathRegistry.js'
import auditService from '../services/auditService.js'
import {
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'

const DUPLICATE_FRAMEWORK_PACKAGE_MESSAGE = 'Framework key and version must be unique.'
const FRAMEWORK_PACKAGE_NOT_FOUND_MESSAGE = 'Framework package not found.'
const ACTIVE_DEFAULT_CONFLICT_MESSAGE = 'Only one active default package is allowed per framework.'
const ACTIVATION_REQUIRES_VALIDATED_MESSAGE = 'Only validated framework packages can be activated.'
const ACTIVATION_ENDPOINT_REQUIRED_MESSAGE = 'Use the activation endpoint to mark a framework package active.'
const ACTIVE_PACKAGE_STATUS_CHANGE_MESSAGE =
  'Active framework packages cannot change lifecycle in place. Activate another validated package instead.'
const READY_FRAMEWORK_PACKAGE_STATUSES = new Set([
  FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
  FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
])
const DEPRECATED_FRAMEWORK_PACKAGE_FIELDS = Object.freeze([
  'compatibleWorkflowKeys',
  'defaultAgentIds',
  'requiredSkillIds',
  'validationRules',
  'validationConfig',
  'workflowPolicyConfig',
])

const DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES = Object.freeze({
  compatibleWorkflowKeys: 'compatibleWorkflowKeys is deprecated. Use workflowBindings instead.',
  defaultAgentIds: 'defaultAgentIds is deprecated. Agents are assigned through workflow policies.',
  requiredSkillIds: 'requiredSkillIds is deprecated. Skills are resolved through workflow policies.',
  validationRules: 'validationRules is deprecated. Use sections and validationBindings instead.',
  validationConfig: 'validationConfig is deprecated. Use validationBindings instead.',
  workflowPolicyConfig: 'workflowPolicyConfig is deprecated. Use workflowBindings instead.',
})

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

const serializeFrameworkPackage = (frameworkPackage, { fallbackUpdatedBy = null } = {}) => {
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

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    delete plain[field]
  }

  return plain
}

const omitDeprecatedFrameworkPackageFields = (payload = {}) => {
  const sanitizedPayload = { ...payload }

  for (const field of DEPRECATED_FRAMEWORK_PACKAGE_FIELDS) {
    delete sanitizedPayload[field]
  }

  return sanitizedPayload
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

const normalizeKeyValue = (value) => String(value || '').trim()

const isReadyFrameworkPackageStatus = (status) =>
  READY_FRAMEWORK_PACKAGE_STATUSES.has(String(status || '').trim().toUpperCase())

const hasConfiguredSections = (sections = []) =>
  getStructuralSections(sections).some(
    (section) =>
      normalizeSectionKey(section?.sectionKey) || normalizeRuntimePath(section?.runtimePath),
  )

const validateDeprecatedFrameworkPackageFields = (payload = {}) => {
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
    .select('pathKey status frameworkKeys scope category')
    .lean()
  const byPath = new Map(rows.map((row) => [row.pathKey, row]))
  const invalidRuntimePaths = runtimePaths.filter((runtimePath) => {
    const row = byPath.get(runtimePath)
    if (!row) return true
    if (row.status !== RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE) return true
    if (row.scope !== RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE) return true
    if (row.category !== RUNTIME_PATH_REGISTRY_CATEGORIES.SECTION) return true
    if (!runtimePath.startsWith('framework_state.sections.')) return true
    return !Array.isArray(row.frameworkKeys) || !row.frameworkKeys.includes(frameworkKey)
  })

  if (invalidRuntimePaths.length === 0) return null

  return `Section runtime paths must be ACTIVE, FRAMEWORK_STATE/SECTION, and compatible with "${frameworkKey}": ${invalidRuntimePaths.join(', ')}.`
}

const validateUIContractSectionAlignment = ({ sections = [], uiContract = null }) => {
  if (!uiContract) return null

  const packageSectionKeys = [
    ...new Set(
      getStructuralSections(sections)
        .map((section) => normalizeSectionKey(section?.sectionKey))
        .filter(Boolean),
    ),
  ]
  if (packageSectionKeys.length === 0) return null

  const uiContractSectionKeys = new Set(
    getStructuralSections(uiContract.sections)
      .map((section) => normalizeSectionKey(section?.sectionKey))
      .filter(Boolean),
  )
  const missingSectionKeys = packageSectionKeys.filter(
    (sectionKey) => !uiContractSectionKeys.has(sectionKey),
  )

  if (missingSectionKeys.length === 0) return null

  return `UI Contract "${uiContract.uiContractKey}" is missing presentation mappings for package sections: ${missingSectionKeys.join(', ')}.`
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
      .select('key status supportedFrameworkKeys packageUsable')
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
  }

  const policyKeys = [
    ...new Set([
      ...(workflowBindings || []).map((item) => String(item?.policyKey || '').trim().toLowerCase()),
    ].filter(Boolean)),
  ]
  if (policyKeys.length > 0) {
    const policyRows = await WorkflowPolicy.find({ key: { $in: policyKeys } })
      .select('key status frameworkKeys')
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
  }

  const normalizedUiContractKey = String(uiContractKey || '').trim().toLowerCase()
  if (normalizedUiContractKey) {
    const uiContract = await UIContract.findOne({ uiContractKey: normalizedUiContractKey })
      .select('uiContractKey status frameworkKeys introducedInVersion deprecatedInVersion compatibilityMode sections.sectionKey')
      .lean()

    if (!uiContract) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" was not found.`
    } else if (uiContract.status !== UI_CONTRACT_STATUSES.ACTIVE) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" must be ACTIVE.`
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

    return res.status(200).json({
      data: items.map((item) => serializeFrameworkPackage(item)),
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

    const canonicalPackagePayload = omitDeprecatedFrameworkPackageFields(req.body)

    const accessRuleDetails = validateFrameworkPackageAccessRules(req.body)
    if (Object.keys(accessRuleDetails).length > 0) {
      return sendValidationFailed(res, req, accessRuleDetails)
    }

    const readinessDetails = validateFrameworkPackageReadiness(canonicalPackagePayload)
    if (Object.keys(readinessDetails).length > 0) {
      return sendValidationFailed(res, req, readinessDetails)
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

    const actorUserId = req.context?.userId || req.userId
    const frameworkPackage = new FrameworkPackage({
      ...canonicalPackagePayload,
      isDefault: false,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await frameworkPackage.save()
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
        stateModelKey: frameworkPackage.stateModelKey,
        stateModelVersion: frameworkPackage.stateModelVersion,
        stateModelMode: frameworkPackage.stateModelMode,
        availableOutputKeys: frameworkPackage.availableOutputKeys,
        defaultOutputStyles: frameworkPackage.defaultOutputStyles,
        allowCustomerOutputDefinitions: frameworkPackage.allowCustomerOutputDefinitions,
        artifactRetentionDays: frameworkPackage.artifactRetentionDays,
        allowOutputRevisionHistory: frameworkPackage.allowOutputRevisionHistory,
        capabilities: frameworkPackage.capabilities,
      },
    })

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

    return res.status(200).json({
      data: serializeFrameworkPackage(frameworkPackage),
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

    const canonicalPackagePayload = omitDeprecatedFrameworkPackageFields(req.body)
    const nextFrameworkKey = canonicalPackagePayload.frameworkKey ?? frameworkPackage.frameworkKey
    const nextVersion = canonicalPackagePayload.version ?? frameworkPackage.version
    const nextStatus = canonicalPackagePayload.status ?? frameworkPackage.status
    const nextPackageKey = canonicalPackagePayload.packageKey ?? frameworkPackage.packageKey
    const nextValidationBindings = canonicalPackagePayload.validationBindings ?? frameworkPackage.validationBindings
    const nextWorkflowBindings = canonicalPackagePayload.workflowBindings ?? frameworkPackage.workflowBindings
    const nextSections = canonicalPackagePayload.sections ?? frameworkPackage.sections
    const nextUiContractKey = canonicalPackagePayload.uiContractKey ?? frameworkPackage.uiContractKey
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
    const fields = [
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
      'stateModelKey',
      'stateModelVersion',
      'stateModelMode',
      'availableOutputKeys',
      'defaultOutputStyles',
      'allowCustomerOutputDefinitions',
      'artifactRetentionDays',
      'allowOutputRevisionHistory',
      'capabilities',
    ]

    for (const field of fields) {
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

    frameworkPackage.updatedBy = req.context?.userId || req.userId
    await frameworkPackage.save()
    await populateFrameworkPackage(frameworkPackage)

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_UPDATED,
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

    const readinessDetails = validateFrameworkPackageReadiness({
      status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
      packageKey: frameworkPackage.packageKey,
      sections: frameworkPackage.sections,
      uiContractKey: frameworkPackage.uiContractKey,
    })
    if (Object.keys(readinessDetails).length > 0) {
      return sendValidationFailed(res, req, readinessDetails)
    }

    const validationDetails = await validateFrameworkPackageRegistryReferences({
      frameworkKey: frameworkPackage.frameworkKey,
      validationBindings: frameworkPackage.validationBindings,
      workflowBindings: frameworkPackage.workflowBindings,
      sections: frameworkPackage.sections,
      uiContractKey: frameworkPackage.uiContractKey,
      validateSections: true,
      validateUiContractSections: true,
    })
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const actorUserId = req.context?.userId || req.userId
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
      frameworkPackage.updatedBy = actorUserId
      frameworkPackage.activatedAt = activationTime
      frameworkPackage.activatedBy = actorUserId
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
