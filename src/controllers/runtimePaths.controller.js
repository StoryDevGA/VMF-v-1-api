import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_CATEGORIES,
} from '../models/RuntimePathRegistry.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import { escapeRegex, serializeUserSummary } from '../utils/controllerUtils.js'

const RUNTIME_PATH_NOT_FOUND_MESSAGE = 'Runtime path was not found.'

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

const buildListFilter = ({ q, status, frameworkKey, frameworkKeys, scope, operation, category, isProtected }) => {
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

const buildDependencySummary = (skills = []) => ({
  skillIds: skills.map((skill) => skill.stableId),
  skills: skills.map((skill) => ({
    id: skill.stableId,
    key: skill.key,
    name: skill.name,
    status: skill.status,
  })),
})

const fetchRuntimePathSkillDependencies = async (pathKey) => {
  if (!pathKey) return []

  return RuntimeSkill.find({
    $or: [
      { allowedReadPaths: pathKey },
      { allowedWritePaths: pathKey },
      { forbiddenWritePaths: pathKey },
    ],
  })
    .select('stableId key name status')
    .lean()
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
      .sort({ status: 1, updatedAt: -1, pathKey: 1 })
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

    const skills = await fetchRuntimePathSkillDependencies(runtimePath.pathKey)

    return res.status(200).json({
      data: {
        id: runtimePath.stableId,
        pathKey: runtimePath.pathKey,
        dependencies: buildDependencySummary(skills),
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
  fetchRuntimePathSkillDependencies,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_CATEGORIES,
})
