import { isDeepStrictEqual } from 'node:util'
import RuntimeSkill from '../models/RuntimeSkill.js'
import auditService from '../services/auditService.js'

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

const serializeRuntimeSkill = (runtimeSkill, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof runtimeSkill?.toJSON === 'function'
    ? runtimeSkill.toJSON()
    : { ...runtimeSkill }

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
      { supportedFrameworkKeys: regex },
    ]
  }

  return filter
}

export const listRuntimeSkills = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
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
      ...req.body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await runtimeSkill.save()
    await populateRuntimeSkill(runtimeSkill)

    const serializedRuntimeSkill = serializeRuntimeSkill(runtimeSkill, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_SKILL_CREATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeSkill,
      resourceId: runtimeSkill._id,
      scope: {},
      display: { resourceLabel: buildRuntimeSkillLabel(runtimeSkill) },
      diff: {
        id: runtimeSkill.stableId,
        key: runtimeSkill.key,
        name: runtimeSkill.name,
        description: runtimeSkill.description,
        status: runtimeSkill.status,
        supportedFrameworkKeys: runtimeSkill.supportedFrameworkKeys,
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

    return res.status(200).json({
      data: serializeRuntimeSkill(runtimeSkill),
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

    const diff = {}
    const fields = [
      'key',
      'name',
      'description',
      'status',
      'supportedFrameworkKeys',
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

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_SKILL_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeSkill,
        resourceId: runtimeSkill._id,
        scope: {},
        display: { resourceLabel: buildRuntimeSkillLabel(runtimeSkill) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeRuntimeSkill(runtimeSkill, {
        fallbackUpdatedBy: buildActorSummary(req),
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
