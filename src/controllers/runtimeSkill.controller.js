import { isDeepStrictEqual } from 'node:util'
import RuntimeSkill from '../models/RuntimeSkill.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import auditService from '../services/auditService.js'
import {
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'

const DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE = 'Skill key must be unique.'
const RUNTIME_SKILL_NOT_FOUND_MESSAGE = 'Skill was not found.'

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

const serializeRuntimeDependencyReference = (value) => ({
  id: value?.stableId,
  key: value?.key,
  name: value?.name,
  status: value?.status,
})

const serializeRuntimeSkill = (
  runtimeSkill,
  { fallbackUpdatedBy = null, dependencySummary = null } = {},
) => {
  const plain = typeof runtimeSkill?.toJSON === 'function'
    ? runtimeSkill.toJSON()
    : { ...runtimeSkill }

  if (!plain.id && plain.stableId) {
    plain.id = plain.stableId
  }

  delete plain._id
  delete plain.__v
  delete plain.stableId

  plain.category = reqHasValue(plain.category) ? plain.category : 'GENERAL'
  plain.type = reqHasValue(plain.type) ? plain.type : 'DETERMINISTIC'
  plain.executionMode = reqHasValue(plain.executionMode) ? plain.executionMode : 'SYSTEM'
  plain.inputContract =
    plain.inputContract && typeof plain.inputContract === 'object' && !Array.isArray(plain.inputContract)
      ? plain.inputContract
      : {}
  plain.outputContract =
    plain.outputContract && typeof plain.outputContract === 'object' && !Array.isArray(plain.outputContract)
      ? plain.outputContract
      : {}
  plain.runtimeConfig =
    plain.runtimeConfig && typeof plain.runtimeConfig === 'object' && !Array.isArray(plain.runtimeConfig)
      ? plain.runtimeConfig
      : {}
  plain.primaryOutputKey = reqHasValue(plain.primaryOutputKey) ? plain.primaryOutputKey : ''
  plain.outputBindings = Array.isArray(plain.outputBindings) ? plain.outputBindings : []
  plain.allowedReadPaths = Array.isArray(plain.allowedReadPaths) ? plain.allowedReadPaths : []
  plain.allowedWritePaths = Array.isArray(plain.allowedWritePaths) ? plain.allowedWritePaths : []
  plain.forbiddenWritePaths = Array.isArray(plain.forbiddenWritePaths) ? plain.forbiddenWritePaths : []
  plain.executionConfig =
    plain.executionConfig && typeof plain.executionConfig === 'object' && !Array.isArray(plain.executionConfig)
      ? plain.executionConfig
      : {}
  plain.referenceAssets = Array.isArray(plain.referenceAssets) ? plain.referenceAssets : []

  const serializedUpdatedBy = serializeUserSummary(plain.updatedBy)
  plain.createdBy = serializeUserSummary(plain.createdBy)
  plain.updatedBy =
    (serializedUpdatedBy?.name || serializedUpdatedBy?.email)
      ? serializedUpdatedBy
      : (fallbackUpdatedBy || serializedUpdatedBy)

  if (dependencySummary) {
    plain.dependencySummary = dependencySummary
  }

  return plain
}

const buildRuntimeSkillLabel = (runtimeSkill) =>
  runtimeSkill?.name
    ? `${runtimeSkill.name} (${runtimeSkill.key})`
    : runtimeSkill?.key

const isDuplicateRuntimeSkillKeyError = (err) =>
  err?.code === 11000
  && (err?.keyPattern?.key || err?.keyPattern?.stableId)

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

const pickRuntimeSkillPayload = (body = {}) => ({
  key: body.key,
  name: body.name,
  description: body.description,
  status: body.status,
  supportedFrameworkKeys: body.supportedFrameworkKeys,
  category: body.category,
  type: body.type,
  executionMode: body.executionMode,
  inputContract: body.inputContract,
  outputContract: body.outputContract,
  runtimeConfig: body.runtimeConfig,
  primaryOutputKey: body.primaryOutputKey,
  outputBindings: body.outputBindings,
  allowedReadPaths: body.allowedReadPaths,
  allowedWritePaths: body.allowedWritePaths,
  forbiddenWritePaths: body.forbiddenWritePaths,
  executionConfig: body.executionConfig,
  referenceAssets: body.referenceAssets,
})

const hasObjectKeys = (value) =>
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length > 0

const populateRuntimeSkill = async (runtimeSkill) => {
  if (!runtimeSkill || typeof runtimeSkill.populate !== 'function') {
    return runtimeSkill
  }

  await runtimeSkill.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
  ])

  return runtimeSkill
}

const buildListFilter = ({ q, status, frameworkKey }) => {
  const filter = {}

  if (status) {
    filter.status = status
  }

  if (frameworkKey) {
    filter.supportedFrameworkKeys = frameworkKey
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { stableId: regex },
      { key: regex },
      { name: regex },
      { description: regex },
      { status: regex },
      { category: regex },
      { type: regex },
      { executionMode: regex },
      { supportedFrameworkKeys: regex },
    ]
  }

  return filter
}

const reqHasValue = (value) => String(value ?? '').trim().length > 0

const buildRuntimeSkillListFilter = ({ q, status, frameworkKey, category, executionMode }) => {
  const filter = buildListFilter({ q, status, frameworkKey })

  if (reqHasValue(category)) {
    filter.category = category
  }

  if (reqHasValue(executionMode)) {
    filter.executionMode = executionMode
  }

  return filter
}

const validateRuntimeSkillFrameworkKeys = async (supportedFrameworkKeys = []) => {
  const { missingKeys } = await resolveKnownFrameworkKeys(supportedFrameworkKeys)

  if (missingKeys.length === 0) {
    return {}
  }

  return {
    supportedFrameworkKeys: buildUnknownFrameworkKeyMessage(missingKeys),
  }
}

const buildDependencySummary = ({ agents = [], workflowPolicies = [] }, { includeEntities = false } = {}) => ({
  agentIds: agents.map((agent) => agent.stableId),
  workflowPolicyIds: workflowPolicies.map((policy) => policy.stableId),
  ...(includeEntities
    ? {
        agents: agents.map(serializeRuntimeDependencyReference),
        workflowPolicies: workflowPolicies.map(serializeRuntimeDependencyReference),
      }
    : {}),
})

const fetchRuntimeSkillDependencies = async (skillId) => {
  const [agents, workflowPolicies] = await Promise.all([
    RuntimeAgent.find({ defaultSkillIds: skillId })
      .select('stableId key name status')
      .lean(),
    WorkflowPolicy.find({ requiredSkillIds: skillId })
      .select('stableId key name status')
      .lean(),
  ])

  return { agents, workflowPolicies }
}

export const listRuntimeSkills = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildRuntimeSkillListFilter(req.query)
    const total = await RuntimeSkill.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await RuntimeSkill.find(filter)
      .sort({ status: 1, updatedAt: -1, key: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeRuntimeSkill(item)),
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

export const createRuntimeSkill = async (req, res, next) => {
  try {
    const validationDetails = await validateRuntimeSkillFrameworkKeys(req.body.supportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const existingRuntimeSkill = await RuntimeSkill.findOne({
      key: req.body.key,
    }).select('_id')

    if (existingRuntimeSkill) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_SKILL_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const runtimeSkill = new RuntimeSkill({
      ...pickRuntimeSkillPayload(req.body),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await runtimeSkill.save()
    await populateRuntimeSkill(runtimeSkill)
    const dependencies = buildDependencySummary(
      await fetchRuntimeSkillDependencies(runtimeSkill.stableId),
    )

    const serializedRuntimeSkill = serializeRuntimeSkill(runtimeSkill, {
      fallbackUpdatedBy: buildActorSummary(req),
      dependencySummary: dependencies,
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_SKILL_CREATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeSkill,
      resourceId: runtimeSkill._id,
      scope: {
        frameworkKeys: runtimeSkill.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeSkillLabel(runtimeSkill) },
      diff: {
        id: runtimeSkill.stableId,
        key: runtimeSkill.key,
        name: runtimeSkill.name,
        description: runtimeSkill.description,
        status: runtimeSkill.status,
        supportedFrameworkKeys: runtimeSkill.supportedFrameworkKeys,
        category: runtimeSkill.category,
        type: runtimeSkill.type,
        executionMode: runtimeSkill.executionMode,
        inputContract: runtimeSkill.inputContract,
        outputContract: runtimeSkill.outputContract,
        runtimeConfig: runtimeSkill.runtimeConfig,
        primaryOutputKey: runtimeSkill.primaryOutputKey,
        outputBindings: runtimeSkill.outputBindings,
        allowedReadPaths: runtimeSkill.allowedReadPaths,
        allowedWritePaths: runtimeSkill.allowedWritePaths,
        forbiddenWritePaths: runtimeSkill.forbiddenWritePaths,
        executionConfig: runtimeSkill.executionConfig,
      },
    })

    return res.status(201).json({
      data: serializedRuntimeSkill,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRuntimeSkillKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_SKILL_KEY_CONFLICT',
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

export const getRuntimeSkill = async (req, res, next) => {
  try {
    const runtimeSkill = await RuntimeSkill.findOne({ stableId: req.params.skillId })

    if (!runtimeSkill) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_SKILL_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateRuntimeSkill(runtimeSkill)
    const dependencies = buildDependencySummary(
      await fetchRuntimeSkillDependencies(runtimeSkill.stableId),
    )

    return res.status(200).json({
      data: serializeRuntimeSkill(runtimeSkill, {
        dependencySummary: dependencies,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getRuntimeSkillDependencies = async (req, res, next) => {
  try {
    const runtimeSkill = await RuntimeSkill.findOne({ stableId: req.params.skillId })
      .select('stableId key name')
      .lean()

    if (!runtimeSkill) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_SKILL_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const dependencies = buildDependencySummary(
      await fetchRuntimeSkillDependencies(runtimeSkill.stableId),
      { includeEntities: true },
    )

    return res.status(200).json({
      data: {
        id: runtimeSkill.stableId,
        key: runtimeSkill.key,
        name: runtimeSkill.name,
        ...dependencies,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateRuntimeSkill = async (req, res, next) => {
  try {
    const runtimeSkill = await RuntimeSkill.findOne({ stableId: req.params.skillId })

    if (!runtimeSkill) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_SKILL_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const nextKey = req.body.key ?? runtimeSkill.key
    const nextSupportedFrameworkKeys =
      req.body.supportedFrameworkKeys ?? runtimeSkill.supportedFrameworkKeys

    const validationDetails = await validateRuntimeSkillFrameworkKeys(nextSupportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const duplicateRuntimeSkill = await RuntimeSkill.findOne({
      _id: { $ne: runtimeSkill._id },
      key: nextKey,
    }).select('_id')

    if (duplicateRuntimeSkill) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_SKILL_KEY_CONFLICT',
      })
    }

    const effectiveExecutionMode = String(req.body.executionMode ?? runtimeSkill.executionMode ?? 'SYSTEM').trim().toUpperCase()

    if (req.body.executionConfig !== undefined && effectiveExecutionMode === 'SYSTEM' && hasObjectKeys(req.body.executionConfig)) {
      return sendValidationFailed(res, req, {
        executionConfig: 'Execution config is only supported for rule engine or agent-assisted skills.',
      })
    }

    const diff = {}
    const fields = [
      'key',
      'name',
      'description',
      'status',
      'supportedFrameworkKeys',
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
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(runtimeSkill[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      runtimeSkill[field] = req.body[field]
    }

    runtimeSkill.updatedBy = req.context?.userId || req.userId
    await runtimeSkill.save()
    await populateRuntimeSkill(runtimeSkill)
    const dependencies = buildDependencySummary(
      await fetchRuntimeSkillDependencies(runtimeSkill.stableId),
    )

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_SKILL_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeSkill,
        resourceId: runtimeSkill._id,
        scope: {
          frameworkKeys: runtimeSkill.supportedFrameworkKeys,
        },
        display: { resourceLabel: buildRuntimeSkillLabel(runtimeSkill) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeRuntimeSkill(runtimeSkill, {
        fallbackUpdatedBy: buildActorSummary(req),
        dependencySummary: dependencies,
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRuntimeSkillKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_SKILL_KEY_CONFLICT',
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
