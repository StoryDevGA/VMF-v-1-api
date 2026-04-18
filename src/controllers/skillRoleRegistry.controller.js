import { isDeepStrictEqual } from 'node:util'
import SkillRoleRegistry, { SKILL_ROLE_REGISTRY_STATUSES } from '../models/SkillRoleRegistry.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import auditService from '../services/auditService.js'
import { escapeRegex, serializeUserSummary } from '../utils/controllerUtils.js'

const SKILL_ROLE_NOT_FOUND_MESSAGE = 'Skill role was not found.'
const DUPLICATE_SKILL_ROLE_KEY_MESSAGE = 'Role key must be unique.'

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.parse(JSON.stringify(value))
}

const serializeSkillRole = (skillRole, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof skillRole?.toJSON === 'function'
    ? skillRole.toJSON()
    : { ...skillRole }

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

const buildSearchClauses = (query) => {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []

  // TODO(perf): when the registry grows, replace regex $or search with a text index strategy.
  const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
  const normalizedQueryUpper = normalizedQuery.toUpperCase()
  const clauses = [
    { stableId: regex },
    { roleKey: regex },
    { label: regex },
    { description: regex },
  ]

  if (Object.values(SKILL_ROLE_REGISTRY_STATUSES).includes(normalizedQueryUpper)) {
    clauses.push({ status: normalizedQueryUpper })
  }

  return clauses
}

const buildListFilter = ({ q, status }) => {
  const filter = {}

  const normalizedStatus = String(status || '').trim().toUpperCase()
  if (normalizedStatus) {
    filter.status = normalizedStatus
  }

  const searchClauses = buildSearchClauses(q)
  if (searchClauses.length > 0) {
    filter.$or = searchClauses
  }

  return filter
}

const isDuplicateRoleKeyError = (err) => err?.code === 11000

const fetchSkillRoleDependencies = async (roleKey) => {
  const skills = await RuntimeSkill.find({ skillRoleKey: roleKey })
    .select('stableId')
    .lean()

  return {
    skillIds: skills.map((skill) => skill.stableId).filter(Boolean),
  }
}

export const listSkillRoles = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await SkillRoleRegistry.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await SkillRoleRegistry.find(filter)
      .sort({ status: 1, updatedAt: -1, roleKey: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeSkillRole(item)),
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

export const createSkillRole = async (req, res, next) => {
  try {
    const roleKey = String(req.body.roleKey || '').trim().toUpperCase()
    const existing = await SkillRoleRegistry.findOne({ roleKey })

    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_SKILL_ROLE_KEY_MESSAGE,
          requestId: req.requestId,
          details: { roleKey: DUPLICATE_SKILL_ROLE_KEY_MESSAGE },
        },
      })
    }

    const created = await SkillRoleRegistry.create({
      roleKey,
      label: req.body.label,
      description: req.body.description,
      status: req.body.status,
      // System roles are reserved for seeded platform entries.
      isSystem: false,
      createdBy: req.context?.userId || req.userId,
      updatedBy: req.context?.userId || req.userId,
    })

    await created.populate('createdBy', 'name email')
    await created.populate('updatedBy', 'name email')

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.SKILL_ROLE_CREATED,
      resourceType: auditService.RESOURCE_TYPES.SkillRole,
      resourceId: created._id,
      display: { resourceLabel: created.roleKey },
      diff: { created: cloneAuditValue(created.toJSON()) },
    })

    return res.status(201).json({
      data: serializeSkillRole(created),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRoleKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_SKILL_ROLE_KEY_MESSAGE,
          requestId: req.requestId,
          details: { roleKey: DUPLICATE_SKILL_ROLE_KEY_MESSAGE },
        },
      })
    }

    next(err)
  }
}

export const getSkillRole = async (req, res, next) => {
  try {
    const skillRole = await SkillRoleRegistry.findByStableId(req.params.roleId)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')

    if (!skillRole) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: SKILL_ROLE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: serializeSkillRole(skillRole),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateSkillRole = async (req, res, next) => {
  try {
    const skillRole = await SkillRoleRegistry.findByStableId(req.params.roleId)

    if (!skillRole) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: SKILL_ROLE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (req.body.roleKey !== undefined && String(req.body.roleKey).trim().toUpperCase() !== skillRole.roleKey) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed.',
          details: { roleKey: 'Role key is immutable and cannot be changed after creation.' },
          requestId: req.requestId,
        },
      })
    }

    if (req.body.isSystem !== undefined && Boolean(req.body.isSystem) !== Boolean(skillRole.isSystem)) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed.',
          details: { isSystem: 'System flag is managed by the platform and cannot be changed.' },
          requestId: req.requestId,
        },
      })
    }

    const diff = {}
    const fields = ['label', 'description', 'status']

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(skillRole[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = { from: previousValue, to: nextValue }
      skillRole[field] = req.body[field]
    }

    skillRole.updatedBy = req.context?.userId || req.userId
    await skillRole.save()
    await skillRole.populate('createdBy', 'name email')
    await skillRole.populate('updatedBy', 'name email')

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.SKILL_ROLE_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.SkillRole,
        resourceId: skillRole._id,
        display: { resourceLabel: skillRole.roleKey },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeSkillRole(skillRole),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getSkillRoleDependencies = async (req, res, next) => {
  try {
    const skillRole = await SkillRoleRegistry.findByStableId(req.params.roleId).select('stableId roleKey')

    if (!skillRole) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: SKILL_ROLE_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: {
        id: skillRole.stableId,
        roleKey: skillRole.roleKey,
        dependencies: await fetchSkillRoleDependencies(skillRole.roleKey),
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
  SKILL_ROLE_REGISTRY_STATUSES,
})
