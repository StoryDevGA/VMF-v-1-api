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

  return plain
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
      { 'sections.validationKeys': regex },
      { 'validationConfig.validationKey': regex },
      { 'workflowPolicyConfig.policyKey': regex },
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
      { compatibleWorkflowKeys: regex },
      { defaultAgentIds: regex },
      { requiredSkillIds: regex },
      { 'validationRules.requiredSections': regex },
      { 'validationRules.publishChecks': regex },
    ]
  }

  return filter
}

const buildUnsupportedWorkflowKeyMessage = (frameworkKey, workflowKeys = []) => {
  if (workflowKeys.length === 1) {
    return `Workflow key "${workflowKeys[0]}" is not supported by framework "${frameworkKey}".`
  }

  return `Workflow keys ${workflowKeys.join(', ')} are not supported by framework "${frameworkKey}".`
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
  compatibleWorkflowKeys = [],
  validationConfig = [],
  workflowPolicyConfig = [],
  validationBindings = [],
  workflowBindings = [],
  sections = [],
  uiContractKey = '',
}) => {
  const details = {}
  const { missingKeys, registryByKey } = await resolveKnownFrameworkKeys([frameworkKey])

  if (missingKeys.length > 0) {
    details.frameworkKey = buildUnknownFrameworkKeyMessage(missingKeys)
    return details
  }

  const registryEntry = registryByKey.get(frameworkKey)
  const supportedWorkflowKeySet = new Set(registryEntry?.supportedWorkflowKeys || [])
  const unsupportedWorkflowKeys = compatibleWorkflowKeys.filter(
    (workflowKey) => !supportedWorkflowKeySet.has(workflowKey),
  )

  if (unsupportedWorkflowKeys.length > 0) {
    details.compatibleWorkflowKeys = buildUnsupportedWorkflowKeyMessage(
      frameworkKey,
      unsupportedWorkflowKeys,
    )
  }

  const validationKeys = [
    ...new Set([
      ...(validationConfig || []).map((item) => String(item?.validationKey || '').trim().toLowerCase()),
      ...(validationBindings || []).map((item) => String(item?.validationKey || '').trim().toLowerCase()),
      ...(sections || []).flatMap((section) =>
        (section?.validationKeys || []).map((validationKey) => String(validationKey || '').trim().toLowerCase()),
      ),
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
      ...(workflowPolicyConfig || []).map((item) => String(item?.policyKey || '').trim().toLowerCase()),
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
      .select('uiContractKey status frameworkKeys introducedInVersion deprecatedInVersion compatibilityMode')
      .lean()

    if (!uiContract) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" was not found.`
    } else if (uiContract.status !== UI_CONTRACT_STATUSES.ACTIVE) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" must be ACTIVE.`
    } else if (!Array.isArray(uiContract.frameworkKeys) || !uiContract.frameworkKeys.includes(frameworkKey)) {
      details.uiContractKey = `UI Contract "${normalizedUiContractKey}" is not compatible with framework "${frameworkKey}".`
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
    const accessRuleDetails = validateFrameworkPackageAccessRules(req.body)
    if (Object.keys(accessRuleDetails).length > 0) {
      return sendValidationFailed(res, req, accessRuleDetails)
    }

    const validationDetails = await validateFrameworkPackageRegistryReferences(req.body)
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
      ...req.body,
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
        validationConfig: frameworkPackage.validationConfig,
        workflowPolicyConfig: frameworkPackage.workflowPolicyConfig,
        validationBindings: frameworkPackage.validationBindings,
        workflowBindings: frameworkPackage.workflowBindings,
        uiContractKey: frameworkPackage.uiContractKey,
        availableOutputKeys: frameworkPackage.availableOutputKeys,
        defaultOutputStyles: frameworkPackage.defaultOutputStyles,
        allowCustomerOutputDefinitions: frameworkPackage.allowCustomerOutputDefinitions,
        artifactRetentionDays: frameworkPackage.artifactRetentionDays,
        allowOutputRevisionHistory: frameworkPackage.allowOutputRevisionHistory,
        compatibleWorkflowKeys: frameworkPackage.compatibleWorkflowKeys,
        defaultAgentIds: frameworkPackage.defaultAgentIds,
        requiredSkillIds: frameworkPackage.requiredSkillIds,
        capabilities: frameworkPackage.capabilities,
        validationRules: frameworkPackage.validationRules,
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

    const nextFrameworkKey = req.body.frameworkKey ?? frameworkPackage.frameworkKey
    const nextVersion = req.body.version ?? frameworkPackage.version
    const nextStatus = req.body.status ?? frameworkPackage.status
    const nextCompatibleWorkflowKeys =
      req.body.compatibleWorkflowKeys ?? frameworkPackage.compatibleWorkflowKeys
    const nextValidationConfig = req.body.validationConfig ?? frameworkPackage.validationConfig
    const nextWorkflowPolicyConfig = req.body.workflowPolicyConfig ?? frameworkPackage.workflowPolicyConfig
    const nextValidationBindings = req.body.validationBindings ?? frameworkPackage.validationBindings
    const nextWorkflowBindings = req.body.workflowBindings ?? frameworkPackage.workflowBindings
    const nextSections = req.body.sections ?? frameworkPackage.sections
    const nextUiContractKey = req.body.uiContractKey ?? frameworkPackage.uiContractKey
    const nextVisibility = req.body.visibility ?? frameworkPackage.visibility
    const nextCustomerAccessMode = req.body.customerAccessMode ?? frameworkPackage.customerAccessMode
    const nextAssignedCustomerIds = req.body.assignedCustomerIds ?? frameworkPackage.assignedCustomerIds

    const accessRuleDetails = validateFrameworkPackageAccessRules({
      visibility: nextVisibility,
      customerAccessMode: nextCustomerAccessMode,
      assignedCustomerIds: nextAssignedCustomerIds,
    })
    if (Object.keys(accessRuleDetails).length > 0) {
      return sendValidationFailed(res, req, accessRuleDetails)
    }

    const validationDetails = await validateFrameworkPackageRegistryReferences({
      frameworkKey: nextFrameworkKey,
      compatibleWorkflowKeys: nextCompatibleWorkflowKeys,
      validationConfig: nextValidationConfig,
      workflowPolicyConfig: nextWorkflowPolicyConfig,
      validationBindings: nextValidationBindings,
      workflowBindings: nextWorkflowBindings,
      sections: nextSections,
      uiContractKey: nextUiContractKey,
    })
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
      'validationConfig',
      'workflowPolicyConfig',
      'validationBindings',
      'workflowBindings',
      'uiContractKey',
      'availableOutputKeys',
      'defaultOutputStyles',
      'allowCustomerOutputDefinitions',
      'artifactRetentionDays',
      'allowOutputRevisionHistory',
      'compatibleWorkflowKeys',
      'defaultAgentIds',
      'requiredSkillIds',
      'capabilities',
      'validationRules',
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(frameworkPackage[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      frameworkPackage[field] = req.body[field]
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
        if (relatedPackage.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
          previousActivePackageIds.push(toIdString(relatedPackage._id))
          relatedPackage.status = FRAMEWORK_PACKAGE_STATUSES.VALIDATED
        }

        relatedPackage.isDefault = false
        relatedPackage.updatedBy = actorUserId
        relatedPackage.updatedAt = activationTime
        await relatedPackage.save({ session })
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
  } finally {
    await session.endSession()
  }
}
