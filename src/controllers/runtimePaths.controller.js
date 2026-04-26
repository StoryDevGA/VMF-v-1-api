import { isDeepStrictEqual } from 'node:util'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_SOURCE_TYPES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
} from '../models/RuntimePathRegistry.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import ValidationRegistry from '../models/ValidationRegistry.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  normalizeFrameworkKeyList,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { escapeRegex, serializeUserSummary } from '../utils/controllerUtils.js'

const RUNTIME_PATH_NOT_FOUND_MESSAGE = 'Runtime path was not found.'
const DUPLICATE_RUNTIME_PATH_KEY_MESSAGE = 'Path key must be unique.'

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.parse(JSON.stringify(value))
}

const serializeRuntimePath = (runtimePath, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof runtimePath?.toJSON === 'function'
    ? runtimePath.toJSON()
    : { ...runtimePath }

  if (!plain.id && plain.stableId) {
    plain.id = plain.stableId
  }

  delete plain._id
  delete plain.__v
  delete plain.stableId

  const serializedUpdatedBy = serializeUserSummary(plain.updatedBy)
  plain.createdBy = serializeUserSummary(plain.createdBy)
  plain.updatedBy =
    (serializedUpdatedBy?.name || serializedUpdatedBy?.email)
      ? serializedUpdatedBy
      : (fallbackUpdatedBy || serializedUpdatedBy)

  return plain
}

const parseCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const buildSearchClauses = (query) => {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []

  const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
  const normalizedQueryUpper = normalizedQuery.toUpperCase()
  const clauses = [
    { stableId: regex },
    { pathKey: regex },
    { label: regex },
    { description: regex },
  ]

  if (Object.values(RUNTIME_PATH_REGISTRY_SCOPES).includes(normalizedQueryUpper)) {
    clauses.push({ scope: normalizedQueryUpper })
  }

  if (Object.values(RUNTIME_PATH_REGISTRY_CATEGORIES).includes(normalizedQueryUpper)) {
    clauses.push({ category: normalizedQueryUpper })
  }

  if (Object.values(RUNTIME_PATH_REGISTRY_STATUSES).includes(normalizedQueryUpper)) {
    clauses.push({ status: normalizedQueryUpper })
  }

  if (Object.values(RUNTIME_PATH_REGISTRY_OPERATIONS).includes(normalizedQueryUpper)) {
    clauses.push({ allowedOperations: normalizedQueryUpper })
  }

  return clauses
}

const buildListFilter = ({
  q,
  status,
  frameworkKey,
  frameworkKeys,
  scope,
  operation,
  category,
  dataType,
  sourceType,
  isProtected,
}) => {
  const filter = {}

  const normalizedStatus = String(status || '').trim().toUpperCase()
  if (normalizedStatus) {
    filter.status = normalizedStatus
  }

  const normalizedScope = String(scope || '').trim().toUpperCase()
  if (normalizedScope) {
    filter.scope = normalizedScope
  }

  const normalizedOperation = String(operation || '').trim().toUpperCase()
  if (normalizedOperation) {
    filter.allowedOperations = normalizedOperation
  }

  const normalizedCategory = String(category || '').trim().toUpperCase()
  if (normalizedCategory) {
    filter.category = normalizedCategory
  }

  const normalizedDataType = String(dataType || '').trim().toUpperCase()
  if (normalizedDataType) {
    filter.dataType = normalizedDataType
  }

  const normalizedSourceType = String(sourceType || '').trim().toUpperCase()
  if (normalizedSourceType) {
    filter.sourceType = normalizedSourceType
  }

  if (isProtected !== undefined && isProtected !== null && String(isProtected).trim() !== '') {
    const normalized = String(isProtected).trim().toLowerCase()
    if (normalized === 'true') filter.isProtected = true
    if (normalized === 'false') filter.isProtected = false
  }

  const normalizedFrameworkKey = String(frameworkKey || '').trim().toUpperCase()
  const normalizedFrameworkKeys = Array.isArray(frameworkKeys)
    ? frameworkKeys
    : parseCsv(frameworkKeys)
  const frameworks = [
    ...(normalizedFrameworkKey ? [normalizedFrameworkKey] : []),
    ...normalizedFrameworkKeys.map((value) => String(value).trim().toUpperCase()).filter(Boolean),
  ]
  const uniqueFrameworks = [...new Set(frameworks)]

  if (uniqueFrameworks.length === 1) {
    filter.frameworkKeys = uniqueFrameworks[0]
  } else if (uniqueFrameworks.length > 1) {
    filter.frameworkKeys = { $in: uniqueFrameworks }
  }

  const searchClauses = buildSearchClauses(q)
  if (searchClauses.length > 0) {
    filter.$or = searchClauses
  }

  return filter
}

const buildSort = ({ sortBy, sortOrder }) => {
  const normalizedSortBy = String(sortBy || '').trim()
  const normalizedSortOrder = String(sortOrder || '').trim().toLowerCase() === 'asc' ? 1 : -1

  if (normalizedSortBy === 'label') return { label: normalizedSortOrder, pathKey: 1 }
  if (normalizedSortBy === 'pathKey') return { pathKey: normalizedSortOrder }
  if (normalizedSortBy === 'status') return { status: normalizedSortOrder, pathKey: 1 }
  if (normalizedSortBy === 'scope') return { scope: normalizedSortOrder, pathKey: 1 }
  if (normalizedSortBy === 'category') return { category: normalizedSortOrder, pathKey: 1 }
  if (normalizedSortBy === 'updatedAt') return { updatedAt: normalizedSortOrder, pathKey: 1 }

  return { status: 1, updatedAt: -1, pathKey: 1 }
}

const isDuplicatePathKeyError = (err) => err?.code === 11000

const buildValidationDetailsFromMongooseError = (err) => {
  if (err?.name !== 'ValidationError' || !err.errors) return null

  return Object.entries(err.errors).reduce((details, [field, error]) => ({
    ...details,
    [field]: error?.message || 'Invalid value.',
  }), {})
}

const sendValidationFailed = (res, req, details, message = 'Please check the form for errors.') =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details,
      requestId: req.requestId,
    },
  })

const validateFrameworkKeys = async (frameworkKeys = []) => {
  const normalized = normalizeFrameworkKeyList(frameworkKeys)
  const { missingKeys, inactiveKeys } = await resolveKnownFrameworkKeys(normalized, undefined, { requireActive: true })

  return {
    frameworkKeys: normalized,
    missingKeys,
    inactiveKeys,
  }
}

const appendFrameworkErrors = (details, frameworkDetails) => {
  if (frameworkDetails.missingKeys.length > 0) {
    details.frameworkKeys = buildUnknownFrameworkKeyMessage(frameworkDetails.missingKeys)
  } else if (frameworkDetails.inactiveKeys.length > 0) {
    details.frameworkKeys = buildInactiveFrameworkKeyMessage(frameworkDetails.inactiveKeys)
  }
}

const RUNTIME_PATH_MUTABLE_FIELDS = Object.freeze([
  'label',
  'description',
  'status',
  'frameworkKeys',
  'scope',
  'allowedOperations',
  'dataType',
  'category',
  'sourceType',
  'isProtected',
  'isSystem',
  'introducedInVersion',
  'deprecatedInVersion',
  'replacementPathKey',
  'notes',
  'displayOrder',
  'exampleValue',
  'compatibilityTags',
  'allowedValues',
  'allowedValueLabels',
  'uiControl',
  'placeholderText',
  'helpText',
  'defaultValue',
  'minValue',
  'maxValue',
  'minLength',
  'maxLength',
  'regexPattern',
  'isNullable',
])

const RUNTIME_PATH_DUPLICATE_FIELDS = Object.freeze([
  'label',
  'description',
  'frameworkKeys',
  'scope',
  'allowedOperations',
  'dataType',
  'category',
  'sourceType',
  'isProtected',
  'introducedInVersion',
  'replacementPathKey',
  'notes',
  'displayOrder',
  'exampleValue',
  'compatibilityTags',
  'allowedValues',
  'allowedValueLabels',
  'uiControl',
  'placeholderText',
  'helpText',
  'defaultValue',
  'minValue',
  'maxValue',
  'minLength',
  'maxLength',
  'regexPattern',
  'isNullable',
])

const pickRuntimePathFields = (source, fields) => {
  const plain = typeof source?.toObject === 'function'
    ? source.toObject()
    : typeof source?.toJSON === 'function'
      ? source.toJSON()
      : { ...source }

  return fields.reduce((picked, field) => {
    if (plain[field] !== undefined) picked[field] = cloneAuditValue(plain[field])
    return picked
  }, {})
}

const buildRuntimePathLabel = (runtimePath) =>
  String(runtimePath?.pathKey || runtimePath?.label || runtimePath?.stableId || 'runtime path')

const fetchRuntimePathSkillDependencies = async (pathKey) => {
  if (!pathKey) return []

  return RuntimeSkill.find({
    $or: [
      { allowedReadPaths: pathKey },
      { allowedWritePaths: pathKey },
      { forbiddenWritePaths: pathKey },
    ],
  })
    .select('stableId key name status allowedReadPaths allowedWritePaths forbiddenWritePaths')
    .lean()
}

const fetchRuntimePathAgentDependencies = async (pathKey) => {
  if (!pathKey) return []

  return RuntimeAgent.find({
    $or: [
      { 'executionPlan.readsFrom': pathKey },
      { 'executionPlan.writesTo': pathKey },
    ],
  })
    .select('stableId key name status executionPlan')
    .lean()
}

const fetchRuntimePathWorkflowPolicyDependencies = async (pathKey) => {
  if (!pathKey) return []

  return WorkflowPolicy.find({
    $or: [
      { 'conditions.path': pathKey },
      { 'onPassEffects.targetPath': pathKey },
      { 'onFailEffects.targetPath': pathKey },
    ],
  })
    .select('stableId key name status conditions onPassEffects onFailEffects')
    .lean()
}

const fetchRuntimePathValidationDependencies = async (pathKey) => {
  if (!pathKey) return []

  return ValidationRegistry.find({
    $or: [
      { outputPath: pathKey },
      { passFieldPath: pathKey },
      { detailsFieldPath: pathKey },
    ],
  })
    .select('stableId key label status outputPath passFieldPath detailsFieldPath')
    .lean()
}

const buildDependencyItem = ({
  sourceType,
  sourceId,
  sourceKey,
  sourceLabel,
  field,
  usage,
  status,
  route,
}) => ({
  sourceType,
  sourceId,
  sourceKey,
  sourceLabel,
  field,
  usage,
  status,
  ...(route ? { route } : {}),
})

const buildSkillDependencyItems = (pathKey, skills = []) =>
  skills.flatMap((skill) => {
    const items = []
    if ((skill.allowedReadPaths || []).includes(pathKey)) {
      items.push(buildDependencyItem({
        sourceType: 'Runtime Skill',
        sourceId: skill.stableId,
        sourceKey: skill.key,
        sourceLabel: skill.name,
        field: 'allowedReadPaths',
        usage: 'READ',
        status: skill.status,
        route: `/super-admin/runtime-control/skills/${skill.stableId}/edit`,
      }))
    }
    if ((skill.allowedWritePaths || []).includes(pathKey)) {
      items.push(buildDependencyItem({
        sourceType: 'Runtime Skill',
        sourceId: skill.stableId,
        sourceKey: skill.key,
        sourceLabel: skill.name,
        field: 'allowedWritePaths',
        usage: 'WRITE',
        status: skill.status,
        route: `/super-admin/runtime-control/skills/${skill.stableId}/edit`,
      }))
    }
    if ((skill.forbiddenWritePaths || []).includes(pathKey)) {
      items.push(buildDependencyItem({
        sourceType: 'Runtime Skill',
        sourceId: skill.stableId,
        sourceKey: skill.key,
        sourceLabel: skill.name,
        field: 'forbiddenWritePaths',
        usage: 'PROTECTED_WRITE_GUARD',
        status: skill.status,
        route: `/super-admin/runtime-control/skills/${skill.stableId}/edit`,
      }))
    }
    return items
  })

const buildAgentDependencyItems = (pathKey, agents = []) =>
  agents.flatMap((agent) =>
    (Array.isArray(agent.executionPlan) ? agent.executionPlan : []).flatMap((step, index) => {
      const stepNumber = index + 1
      const items = []
      if ((step.readsFrom || []).includes(pathKey)) {
        items.push(buildDependencyItem({
          sourceType: 'Runtime Agent',
          sourceId: agent.stableId,
          sourceKey: agent.key,
          sourceLabel: agent.name,
          field: `executionPlan[${stepNumber}].readsFrom`,
          usage: 'READ',
          status: agent.status,
          route: `/super-admin/runtime-control/agents/${agent.stableId}/edit`,
        }))
      }
      if ((step.writesTo || []).includes(pathKey)) {
        items.push(buildDependencyItem({
          sourceType: 'Runtime Agent',
          sourceId: agent.stableId,
          sourceKey: agent.key,
          sourceLabel: agent.name,
          field: `executionPlan[${stepNumber}].writesTo`,
          usage: 'WRITE',
          status: agent.status,
          route: `/super-admin/runtime-control/agents/${agent.stableId}/edit`,
        }))
      }
      return items
    }))

const buildWorkflowPolicyDependencyItems = (pathKey, policies = []) =>
  policies.flatMap((policy) => {
    const items = []
    ;(Array.isArray(policy.conditions) ? policy.conditions : []).forEach((condition, index) => {
      if (condition?.path === pathKey) {
        items.push(buildDependencyItem({
          sourceType: 'Workflow Policy',
          sourceId: policy.stableId,
          sourceKey: policy.key,
          sourceLabel: policy.name,
          field: `conditions[${index + 1}].path`,
          usage: 'READ',
          status: policy.status,
          route: `/super-admin/runtime-control/workflow-policies/${policy.stableId}/edit`,
        }))
      }
    })
    ;(Array.isArray(policy.onPassEffects) ? policy.onPassEffects : []).forEach((effect, index) => {
      if (effect?.targetPath === pathKey) {
        items.push(buildDependencyItem({
          sourceType: 'Workflow Policy',
          sourceId: policy.stableId,
          sourceKey: policy.key,
          sourceLabel: policy.name,
          field: `onPassEffects[${index + 1}].targetPath`,
          usage: 'WRITE',
          status: policy.status,
          route: `/super-admin/runtime-control/workflow-policies/${policy.stableId}/edit`,
        }))
      }
    })
    ;(Array.isArray(policy.onFailEffects) ? policy.onFailEffects : []).forEach((effect, index) => {
      if (effect?.targetPath === pathKey) {
        items.push(buildDependencyItem({
          sourceType: 'Workflow Policy',
          sourceId: policy.stableId,
          sourceKey: policy.key,
          sourceLabel: policy.name,
          field: `onFailEffects[${index + 1}].targetPath`,
          usage: 'WRITE',
          status: policy.status,
          route: `/super-admin/runtime-control/workflow-policies/${policy.stableId}/edit`,
        }))
      }
    })
    return items
  })

const buildValidationDependencyItems = (pathKey, validations = []) =>
  validations.flatMap((validation) => {
    const base = {
      sourceType: 'Validation Registry',
      sourceId: validation.stableId,
      sourceKey: validation.key,
      sourceLabel: validation.label,
      status: validation.status,
      route: `/super-admin/runtime-control/validation-registry/${validation.stableId}/edit`,
    }
    const items = []
    if (validation.outputPath === pathKey) {
      items.push(buildDependencyItem({ ...base, field: 'outputPath', usage: 'WRITE' }))
    }
    if (validation.passFieldPath === pathKey) {
      items.push(buildDependencyItem({ ...base, field: 'passFieldPath', usage: 'READ' }))
    }
    if (validation.detailsFieldPath === pathKey) {
      items.push(buildDependencyItem({ ...base, field: 'detailsFieldPath', usage: 'READ' }))
    }
    return items
  })

const buildDependencySummary = ({ pathKey, skills = [], agents = [], workflowPolicies = [], validations = [] }) => {
  const items = [
    ...buildSkillDependencyItems(pathKey, skills),
    ...buildAgentDependencyItems(pathKey, agents),
    ...buildWorkflowPolicyDependencyItems(pathKey, workflowPolicies),
    ...buildValidationDependencyItems(pathKey, validations),
  ]
  const activeItems = items.filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE')

  return {
    skillIds: [...new Set(skills.map((skill) => skill.stableId).filter(Boolean))],
    agentIds: [...new Set(agents.map((agent) => agent.stableId).filter(Boolean))],
    workflowPolicyIds: [...new Set(workflowPolicies.map((policy) => policy.stableId).filter(Boolean))],
    validationIds: [...new Set(validations.map((validation) => validation.stableId).filter(Boolean))],
    frameworkPackageIds: [],
    skills: skills.map((skill) => ({
      id: skill.stableId,
      key: skill.key,
      name: skill.name,
      status: skill.status,
    })),
    agents: agents.map((agent) => ({
      id: agent.stableId,
      key: agent.key,
      name: agent.name,
      status: agent.status,
    })),
    workflowPolicies: workflowPolicies.map((policy) => ({
      id: policy.stableId,
      key: policy.key,
      name: policy.name,
      status: policy.status,
    })),
    validations: validations.map((validation) => ({
      id: validation.stableId,
      key: validation.key,
      label: validation.label,
      status: validation.status,
    })),
    frameworkPackages: [],
    items,
    summary: {
      skills: skills.length,
      agents: agents.length,
      workflowPolicies: workflowPolicies.length,
      validations: validations.length,
      frameworkPackages: 0,
      total: items.length,
      active: activeItems.length,
    },
    hasDependencies: items.length > 0,
    hasActiveDependencies: activeItems.length > 0,
  }
}

const fetchRuntimePathDependencies = async (pathKey) => {
  const [skills, agents, workflowPolicies, validations] = await Promise.all([
    fetchRuntimePathSkillDependencies(pathKey),
    fetchRuntimePathAgentDependencies(pathKey),
    fetchRuntimePathWorkflowPolicyDependencies(pathKey),
    fetchRuntimePathValidationDependencies(pathKey),
  ])

  return buildDependencySummary({
    pathKey,
    skills,
    agents,
    workflowPolicies,
    validations,
  })
}

const buildDependencyWarnings = (dependencies) => {
  const summary = dependencies?.summary || {}
  const warnings = []

  if (summary.total > 0) {
    warnings.push(`This runtime path is referenced by ${summary.total} governed configuration item${summary.total === 1 ? '' : 's'}.`)
  }

  if (summary.active > 0) {
    warnings.push(`${summary.active} active reference${summary.active === 1 ? '' : 's'} may continue to use the saved path after lifecycle changes.`)
  }

  return warnings
}

export const listRuntimePaths = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await RuntimePathRegistry.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await RuntimePathRegistry.find(filter)
      .sort(buildSort(req.query))
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeRuntimePath(item)),
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

export const createRuntimePath = async (req, res, next) => {
  try {
    const actorId = req.context?.userId || req.userId
    const body = req.body || {}
    const details = {}

    const existing = await RuntimePathRegistry.findOne({ pathKey: body.pathKey })
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE,
          requestId: req.requestId,
          details: { pathKey: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE },
        },
      })
    }

    const frameworkDetails = await validateFrameworkKeys(body.frameworkKeys)
    appendFrameworkErrors(details, frameworkDetails)

    if (Object.keys(details).length > 0) {
      return sendValidationFailed(res, req, details)
    }

    const created = new RuntimePathRegistry({
      ...body,
      frameworkKeys: frameworkDetails.frameworkKeys,
      createdBy: actorId,
      updatedBy: actorId,
    })

    await created.save()
    await created.populate('createdBy', 'name email')
    await created.populate('updatedBy', 'name email')

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_CREATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimePathRegistry,
      resourceId: created._id,
      display: { resourceLabel: buildRuntimePathLabel(created) },
      diff: { created: cloneAuditValue(created.toJSON()) },
    })

    return res.status(201).json({
      data: serializeRuntimePath(created),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicatePathKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE,
          requestId: req.requestId,
          details: { pathKey: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE },
        },
      })
    }

    const validationDetails = buildValidationDetailsFromMongooseError(err)
    if (validationDetails) {
      return sendValidationFailed(res, req, validationDetails)
    }

    next(err)
  }
}

export const getRuntimePath = async (req, res, next) => {
  try {
    const runtimePath = await RuntimePathRegistry.findByStableId(req.params.pathId)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')

    if (!runtimePath) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_PATH_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: serializeRuntimePath(runtimePath),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateRuntimePath = async (req, res, next) => {
  try {
    const runtimePath = await RuntimePathRegistry.findByStableId(req.params.pathId)

    if (!runtimePath) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_PATH_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (req.body.pathKey !== undefined && String(req.body.pathKey).trim() !== runtimePath.pathKey) {
      return sendValidationFailed(res, req, {
        pathKey: 'Path key is immutable and cannot be changed after creation.',
      }, 'Validation failed.')
    }

    const details = {}
    const nextFrameworkKeys = req.body.frameworkKeys === undefined ? runtimePath.frameworkKeys : req.body.frameworkKeys
    const frameworkDetails = await validateFrameworkKeys(nextFrameworkKeys)
    appendFrameworkErrors(details, frameworkDetails)

    if (Object.keys(details).length > 0) {
      return sendValidationFailed(res, req, details)
    }

    const diff = {}
    for (const field of RUNTIME_PATH_MUTABLE_FIELDS) {
      if (req.body[field] === undefined) continue

      const nextValue = field === 'frameworkKeys'
        ? frameworkDetails.frameworkKeys
        : req.body[field]
      const previousValue = cloneAuditValue(runtimePath[field])

      if (isDeepStrictEqual(previousValue, cloneAuditValue(nextValue))) {
        continue
      }

      diff[field] = { from: previousValue, to: cloneAuditValue(nextValue) }
      runtimePath[field] = nextValue
    }

    runtimePath.updatedBy = req.context?.userId || req.userId
    await runtimePath.save()
    await runtimePath.populate('createdBy', 'name email')
    await runtimePath.populate('updatedBy', 'name email')

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimePathRegistry,
        resourceId: runtimePath._id,
        display: { resourceLabel: buildRuntimePathLabel(runtimePath) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeRuntimePath(runtimePath),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicatePathKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE,
          requestId: req.requestId,
          details: { pathKey: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE },
        },
      })
    }

    const validationDetails = buildValidationDetailsFromMongooseError(err)
    if (validationDetails) {
      return sendValidationFailed(res, req, validationDetails)
    }

    next(err)
  }
}

export const duplicateRuntimePath = async (req, res, next) => {
  try {
    const actorId = req.context?.userId || req.userId
    const source = await RuntimePathRegistry.findByStableId(req.params.pathId)

    if (!source) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_PATH_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const existing = await RuntimePathRegistry.findOne({ pathKey: req.body.pathKey })
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE,
          requestId: req.requestId,
          details: { pathKey: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE },
        },
      })
    }

    const copied = pickRuntimePathFields(source, RUNTIME_PATH_DUPLICATE_FIELDS)
    const nextFrameworkKeys = copied.frameworkKeys || []
    const frameworkDetails = await validateFrameworkKeys(nextFrameworkKeys)
    const details = {}
    appendFrameworkErrors(details, frameworkDetails)

    if (Object.keys(details).length > 0) {
      return sendValidationFailed(res, req, details)
    }

    const duplicate = new RuntimePathRegistry({
      ...copied,
      pathKey: req.body.pathKey,
      label: req.body.label || copied.label,
      description: req.body.description || copied.description,
      status: req.body.status || RUNTIME_PATH_REGISTRY_STATUSES.DRAFT,
      frameworkKeys: frameworkDetails.frameworkKeys,
      isSystem: false,
      createdBy: actorId,
      updatedBy: actorId,
    })

    await duplicate.save()
    await duplicate.populate('createdBy', 'name email')
    await duplicate.populate('updatedBy', 'name email')

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_PATH_DUPLICATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimePathRegistry,
      resourceId: duplicate._id,
      display: { resourceLabel: buildRuntimePathLabel(duplicate) },
      diff: {
        duplicatedFrom: source.stableId,
        created: cloneAuditValue(duplicate.toJSON()),
      },
    })

    return res.status(201).json({
      data: serializeRuntimePath(duplicate),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicatePathKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE,
          requestId: req.requestId,
          details: { pathKey: DUPLICATE_RUNTIME_PATH_KEY_MESSAGE },
        },
      })
    }

    const validationDetails = buildValidationDetailsFromMongooseError(err)
    if (validationDetails) {
      return sendValidationFailed(res, req, validationDetails)
    }

    next(err)
  }
}

const updateRuntimePathLifecycle = async ({
  req,
  res,
  next,
  nextStatus,
  auditAction,
  requireDependencyConfirmation = false,
}) => {
  try {
    const runtimePath = await RuntimePathRegistry.findByStableId(req.params.pathId)

    if (!runtimePath) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_PATH_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const dependencies = await fetchRuntimePathDependencies(runtimePath.pathKey)
    const warnings = buildDependencyWarnings(dependencies)
    const confirmed = req.body?.confirmDependencies === true

    if (requireDependencyConfirmation && dependencies.hasActiveDependencies && !confirmed) {
      return res.status(409).json({
        error: {
          code: 'DEPENDENCY_CONFIRMATION_REQUIRED',
          message: 'Runtime path has active dependencies. Confirm the lifecycle change to continue.',
          details: {
            dependencies,
            warnings,
            confirmDependencies: 'Set confirmDependencies to true after reviewing dependencies.',
          },
          requestId: req.requestId,
        },
      })
    }

    const previousStatus = runtimePath.status
    const previousDeprecatedInVersion = runtimePath.deprecatedInVersion

    runtimePath.status = nextStatus
    if (nextStatus === RUNTIME_PATH_REGISTRY_STATUSES.DEPRECATED && req.body?.deprecatedInVersion !== undefined) {
      runtimePath.deprecatedInVersion = req.body.deprecatedInVersion
    }
    runtimePath.updatedBy = req.context?.userId || req.userId

    const diff = {}
    if (previousStatus !== nextStatus) {
      diff.status = { from: previousStatus, to: nextStatus }
    }
    if (!isDeepStrictEqual(previousDeprecatedInVersion, runtimePath.deprecatedInVersion)) {
      diff.deprecatedInVersion = {
        from: cloneAuditValue(previousDeprecatedInVersion),
        to: cloneAuditValue(runtimePath.deprecatedInVersion),
      }
    }

    await runtimePath.save()
    await runtimePath.populate('createdBy', 'name email')
    await runtimePath.populate('updatedBy', 'name email')

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditAction,
        resourceType: auditService.RESOURCE_TYPES.RuntimePathRegistry,
        resourceId: runtimePath._id,
        display: { resourceLabel: buildRuntimePathLabel(runtimePath) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeRuntimePath(runtimePath),
      warnings,
      dependencies,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    const validationDetails = buildValidationDetailsFromMongooseError(err)
    if (validationDetails) {
      return sendValidationFailed(res, req, validationDetails)
    }

    next(err)
  }
}

export const activateRuntimePath = (req, res, next) =>
  updateRuntimePathLifecycle({
    req,
    res,
    next,
    nextStatus: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    auditAction: auditService.AUDIT_ACTIONS.RUNTIME_PATH_ACTIVATED,
  })

export const disableRuntimePath = (req, res, next) =>
  updateRuntimePathLifecycle({
    req,
    res,
    next,
    nextStatus: RUNTIME_PATH_REGISTRY_STATUSES.INACTIVE,
    auditAction: auditService.AUDIT_ACTIONS.RUNTIME_PATH_DISABLED,
    requireDependencyConfirmation: true,
  })

export const deprecateRuntimePath = (req, res, next) =>
  updateRuntimePathLifecycle({
    req,
    res,
    next,
    nextStatus: RUNTIME_PATH_REGISTRY_STATUSES.DEPRECATED,
    auditAction: auditService.AUDIT_ACTIONS.RUNTIME_PATH_DEPRECATED,
  })

export const getRuntimePathDependencies = async (req, res, next) => {
  try {
    const runtimePath = await RuntimePathRegistry.findByStableId(req.params.pathId).select('stableId pathKey')

    if (!runtimePath) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_PATH_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const dependencies = await fetchRuntimePathDependencies(runtimePath.pathKey)

    return res.status(200).json({
      data: {
        id: runtimePath.stableId,
        pathKey: runtimePath.pathKey,
        dependencies,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const __testables = Object.freeze({
  buildListFilter,
  buildSearchClauses,
  parseCsv,
  buildSort,
  fetchRuntimePathSkillDependencies,
  fetchRuntimePathDependencies,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_SOURCE_TYPES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
})
