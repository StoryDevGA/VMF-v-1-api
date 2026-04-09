import { isDeepStrictEqual } from 'node:util'
import FrameworkRegistry from '../models/FrameworkRegistry.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import auditService from '../services/auditService.js'

const DUPLICATE_FRAMEWORK_REGISTRY_KEY_MESSAGE = 'Framework key must be unique.'
const FRAMEWORK_REGISTRY_NOT_FOUND_MESSAGE = 'Framework registry entry was not found.'
const FRAMEWORK_REGISTRY_KEY_IN_USE_MESSAGE =
  'Framework key cannot change while Runtime Control resources still reference it.'

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

const serializeFrameworkRegistry = (frameworkRegistry, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof frameworkRegistry?.toJSON === 'function'
    ? frameworkRegistry.toJSON()
    : { ...frameworkRegistry }

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

const buildFrameworkRegistryLabel = (frameworkRegistry) =>
  frameworkRegistry?.name
    ? `${frameworkRegistry.name} (${frameworkRegistry.frameworkKey})`
    : frameworkRegistry?.frameworkKey

const isDuplicateFrameworkRegistryKeyError = (err) =>
  err?.code === 11000
  && (err?.keyPattern?.frameworkKey || err?.keyPattern?.stableId)

const sendConflict = (res, req, message, details = {}) =>
  res.status(409).json({
    error: {
      code: 'CONFLICT',
      message,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      requestId: req.requestId,
    },
  })

const populateFrameworkRegistry = async (frameworkRegistry) => {
  if (!frameworkRegistry || typeof frameworkRegistry.populate !== 'function') {
    return frameworkRegistry
  }

  await frameworkRegistry.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
  ])

  return frameworkRegistry
}

const buildListFilter = ({ q, status, type, structureType }) => {
  const filter = {}

  if (status) {
    filter.status = status
  }

  if (type) {
    filter.type = type
  }

  if (structureType) {
    filter.structureType = structureType
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { stableId: regex },
      { frameworkKey: regex },
      { name: regex },
      { type: regex },
      { structureType: regex },
      { status: regex },
      { supportedWorkflowKeys: regex },
    ]
  }

  return filter
}

const buildFrameworkKeyDependencyCounts = async (frameworkKey) => {
  const [frameworkPackages, runtimeAgents, runtimeSkills, workflowPolicies] = await Promise.all([
    FrameworkPackage.countDocuments({ frameworkKey }),
    RuntimeAgent.countDocuments({ supportedFrameworkKeys: frameworkKey }),
    RuntimeSkill.countDocuments({ supportedFrameworkKeys: frameworkKey }),
    WorkflowPolicy.countDocuments({ frameworkKeys: frameworkKey }),
  ])

  return {
    frameworkPackages,
    runtimeAgents,
    runtimeSkills,
    workflowPolicies,
  }
}

export const listFrameworkRegistries = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await FrameworkRegistry.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await FrameworkRegistry.find(filter)
      .sort({ status: 1, updatedAt: -1, frameworkKey: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeFrameworkRegistry(item)),
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

export const createFrameworkRegistry = async (req, res, next) => {
  try {
    const existingFrameworkRegistry = await FrameworkRegistry.findOne({
      frameworkKey: req.body.frameworkKey,
    }).select('_id')

    if (existingFrameworkRegistry) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_REGISTRY_KEY_MESSAGE, {
        field: 'frameworkKey',
        reason: 'FRAMEWORK_REGISTRY_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const frameworkRegistry = new FrameworkRegistry({
      ...req.body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await frameworkRegistry.save()
    await populateFrameworkRegistry(frameworkRegistry)

    const serializedFrameworkRegistry = serializeFrameworkRegistry(frameworkRegistry, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.FRAMEWORK_REGISTRY_CREATED,
      resourceType: auditService.RESOURCE_TYPES.FrameworkRegistry,
      resourceId: frameworkRegistry._id,
      scope: {
        frameworkKey: frameworkRegistry.frameworkKey,
      },
      display: { resourceLabel: buildFrameworkRegistryLabel(frameworkRegistry) },
      diff: {
        id: frameworkRegistry.stableId,
        frameworkKey: frameworkRegistry.frameworkKey,
        name: frameworkRegistry.name,
        type: frameworkRegistry.type,
        structureType: frameworkRegistry.structureType,
        supportedWorkflowKeys: frameworkRegistry.supportedWorkflowKeys,
        defaultBehaviorProfile: frameworkRegistry.defaultBehaviorProfile,
        status: frameworkRegistry.status,
        stepUpVerified: true,
      },
    })

    return res.status(201).json({
      data: serializedFrameworkRegistry,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateFrameworkRegistryKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_REGISTRY_KEY_MESSAGE, {
        field: 'frameworkKey',
        reason: 'FRAMEWORK_REGISTRY_KEY_CONFLICT',
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

export const getFrameworkRegistry = async (req, res, next) => {
  try {
    const frameworkRegistry = await FrameworkRegistry.findOne({ stableId: req.params.registryId })

    if (!frameworkRegistry) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: FRAMEWORK_REGISTRY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateFrameworkRegistry(frameworkRegistry)

    return res.status(200).json({
      data: serializeFrameworkRegistry(frameworkRegistry),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateFrameworkRegistry = async (req, res, next) => {
  try {
    const frameworkRegistry = await FrameworkRegistry.findOne({ stableId: req.params.registryId })

    if (!frameworkRegistry) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: FRAMEWORK_REGISTRY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const nextFrameworkKey = req.body.frameworkKey ?? frameworkRegistry.frameworkKey
    const duplicateFrameworkRegistry = await FrameworkRegistry.findOne({
      _id: { $ne: frameworkRegistry._id },
      frameworkKey: nextFrameworkKey,
    }).select('_id')

    if (duplicateFrameworkRegistry) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_REGISTRY_KEY_MESSAGE, {
        field: 'frameworkKey',
        reason: 'FRAMEWORK_REGISTRY_KEY_CONFLICT',
      })
    }

    if (nextFrameworkKey !== frameworkRegistry.frameworkKey) {
      const dependencyCounts = await buildFrameworkKeyDependencyCounts(frameworkRegistry.frameworkKey)
      const totalDependencies = Object.values(dependencyCounts).reduce((sum, count) => sum + count, 0)

      if (totalDependencies > 0) {
        return sendConflict(res, req, FRAMEWORK_REGISTRY_KEY_IN_USE_MESSAGE, {
          field: 'frameworkKey',
          reason: 'FRAMEWORK_REGISTRY_KEY_IN_USE',
          dependencyCounts,
        })
      }
    }

    const diff = {}
    const fields = [
      'frameworkKey',
      'name',
      'type',
      'structureType',
      'supportedWorkflowKeys',
      'defaultBehaviorProfile',
      'status',
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(frameworkRegistry[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      frameworkRegistry[field] = req.body[field]
    }

    frameworkRegistry.updatedBy = req.context?.userId || req.userId
    await frameworkRegistry.save()
    await populateFrameworkRegistry(frameworkRegistry)

    if (Object.keys(diff).length > 0) {
      diff.stepUpVerified = true
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.FRAMEWORK_REGISTRY_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.FrameworkRegistry,
        resourceId: frameworkRegistry._id,
        scope: {
          frameworkKey: frameworkRegistry.frameworkKey,
        },
        display: { resourceLabel: buildFrameworkRegistryLabel(frameworkRegistry) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeFrameworkRegistry(frameworkRegistry, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateFrameworkRegistryKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_FRAMEWORK_REGISTRY_KEY_MESSAGE, {
        field: 'frameworkKey',
        reason: 'FRAMEWORK_REGISTRY_KEY_CONFLICT',
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
