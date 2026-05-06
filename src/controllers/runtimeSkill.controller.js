import { isDeepStrictEqual } from 'node:util'
import RuntimeSkill, {
  RUNTIME_SKILL_CATEGORIES,
  RUNTIME_SKILL_STATUSES,
} from '../models/RuntimeSkill.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import SkillRoleRegistry, { SKILL_ROLE_REGISTRY_STATUSES } from '../models/SkillRoleRegistry.js'
import ValidationRegistry from '../models/ValidationRegistry.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import auditService from '../services/auditService.js'
import {
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { resolveRuntimePathSelections } from '../services/runtimePathRegistryService.js'
import { escapeRegex, serializeUserSummary, toIdString } from '../utils/controllerUtils.js'
import { RUNTIME_CONTROL_VERSION_STATUSES } from '../utils/runtimeControlVersioning.js'

const DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE = 'Skill key must be unique.'
const RUNTIME_SKILL_NOT_FOUND_MESSAGE = 'Skill was not found.'

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

const serializeRuntimeDependencyReference = (value) => ({
  id: value?.stableId,
  key: value?.key,
  name: value?.name,
  status: value?.status,
})

const serializeFrameworkPackageDependencyReference = (value) => ({
  id: toIdString(value?._id || value?.id),
  frameworkKey: value?.frameworkKey,
  frameworkName: value?.frameworkName,
  packageKey: value?.packageKey,
  version: value?.version,
  status: value?.status,
})

const serializeRuntimeSkill = (
  runtimeSkill,
  { fallbackUpdatedBy = null, dependencySummary = null } = {},
) => {
  const plain = typeof runtimeSkill?.toJSON === 'function'
    ? runtimeSkill.toJSON()
    : { ...runtimeSkill }

  const stableId = plain.stableId || plain.id
  if (stableId) {
    plain.id = stableId
    plain.stableId = stableId
  }

  delete plain._id
  delete plain.__v

  plain.category = reqHasValue(plain.category) ? plain.category : RUNTIME_SKILL_CATEGORIES.VALIDATION
  plain.type = reqHasValue(plain.type) ? plain.type : 'DETERMINISTIC'
  plain.executionMode = reqHasValue(plain.executionMode) ? plain.executionMode : 'SYSTEM'
  plain.skillRoleKey = reqHasValue(plain.skillRoleKey) ? plain.skillRoleKey : ''
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
  skillRoleKey: body.skillRoleKey,
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

const pickRuntimeSkillCloneBody = (body = {}) => ({
  key: body.key,
  name: body.name,
  description: body.description,
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
      { skillRoleKey: regex },
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

const findSkillRoleByKey = async (skillRoleKey) => {
  const normalizedSkillRoleKey = String(skillRoleKey || '').trim().toUpperCase()
  if (!normalizedSkillRoleKey) return null

  return SkillRoleRegistry.findOne({ roleKey: normalizedSkillRoleKey })
    .select('roleKey status allowedOperations allowedWriteScopes')
    .lean()
}

const validateRuntimeSkillSkillRoleKey = async (skillRoleKey) => {
  const normalizedSkillRoleKey = String(skillRoleKey || '').trim().toUpperCase()

  if (!normalizedSkillRoleKey) {
    return {
      details: {
        skillRoleKey: 'Skill role key is required.',
      },
      skillRole: null,
      skillRoleKey: '',
    }
  }

  const skillRole = await findSkillRoleByKey(normalizedSkillRoleKey)
  if (!skillRole) {
    return {
      details: {
        skillRoleKey: `Unknown skill role key "${normalizedSkillRoleKey}".`,
      },
      skillRole: null,
      skillRoleKey: normalizedSkillRoleKey,
    }
  }

  return {
    details: {},
    skillRole,
    skillRoleKey: normalizedSkillRoleKey,
  }
}

const joinQuoted = (values) => values.map((value) => `"${value}"`).join(', ')

const normalizeRuntimeScopeList = (values = []) => [
  ...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)),
]

const runtimePathMatchesRoleScope = (pathKey, scope) => {
  const normalizedPathKey = String(pathKey || '').trim()
  const normalizedScope = String(scope || '').trim()
  if (!normalizedPathKey || !normalizedScope) return false
  if (normalizedScope === '*') return true
  if (normalizedScope === normalizedPathKey) return true
  if (normalizedScope.endsWith('.*')) {
    return normalizedPathKey.startsWith(normalizedScope.slice(0, -1))
  }
  if (normalizedScope.endsWith('*')) {
    return normalizedPathKey.startsWith(normalizedScope.slice(0, -1))
  }
  return false
}

const validateRuntimeSkillRoleWriteScopes = ({ skillRole, allowedWritePaths = [] } = {}) => {
  const writePaths = normalizeRuntimeScopeList(allowedWritePaths)
  if (writePaths.length === 0 || !skillRole) return {}

  const operations = normalizeRuntimeScopeList(skillRole.allowedOperations)
    .map((value) => value.toUpperCase())
  if (!operations.includes('WRITE')) {
    return {
      allowedWritePaths: `Skill role key "${skillRole.roleKey}" does not allow WRITE operations.`,
    }
  }

  const allowedWriteScopes = normalizeRuntimeScopeList(skillRole.allowedWriteScopes)
  const uncovered = writePaths.filter((pathKey) =>
    !allowedWriteScopes.some((scope) => runtimePathMatchesRoleScope(pathKey, scope)),
  )

  if (uncovered.length === 0) return {}

  return {
    allowedWritePaths:
      `Allowed write paths must be covered by the selected Skill Role write scopes: ${joinQuoted(uncovered)}.`,
  }
}

const buildRuntimePathSelectionMessage = ({ missing = [], inactive = [], invalidOperation = [], incompatibleFramework = [], protectedWrite = [], unprotected = [] } = {}) => {
  const blocks = []

  if (missing.length > 0) {
    blocks.push(`Unknown runtime path keys: ${joinQuoted(missing)}.`)
  }
  if (inactive.length > 0) {
    blocks.push(`Inactive or deprecated runtime path keys: ${joinQuoted(inactive)}.`)
  }
  if (invalidOperation.length > 0) {
    blocks.push(`Runtime path keys do not support the required operation: ${joinQuoted(invalidOperation)}.`)
  }
  if (incompatibleFramework.length > 0) {
    blocks.push(`Runtime path keys are not compatible with the selected frameworks: ${joinQuoted(incompatibleFramework)}.`)
  }
  if (protectedWrite.length > 0) {
    blocks.push(`Protected runtime path keys cannot be written by skills: ${joinQuoted(protectedWrite)}.`)
  }
  if (unprotected.length > 0) {
    blocks.push(`Runtime path keys must be protected: ${joinQuoted(unprotected)}.`)
  }

  return blocks.join(' ')
}

const validateRuntimeSkillRuntimePaths = async ({
  supportedFrameworkKeys = [],
  allowedReadPaths = [],
  allowedWritePaths = [],
  forbiddenWritePaths = [],
} = {}) => {
  const details = {}

  const readResult = await resolveRuntimePathSelections({
    pathKeys: allowedReadPaths,
    frameworkKeys: supportedFrameworkKeys,
    operation: 'READ',
  })
  if (
    readResult.missing.length > 0
    || readResult.inactive.length > 0
    || readResult.invalidOperation.length > 0
    || readResult.incompatibleFramework.length > 0
  ) {
    details.allowedReadPaths = buildRuntimePathSelectionMessage(readResult)
  }

  const allowedWriteResult = await resolveRuntimePathSelections({
    pathKeys: allowedWritePaths,
    frameworkKeys: supportedFrameworkKeys,
    operation: 'WRITE',
    forbidProtectedWrites: true,
  })
  if (
    allowedWriteResult.missing.length > 0
    || allowedWriteResult.inactive.length > 0
    || allowedWriteResult.invalidOperation.length > 0
    || allowedWriteResult.incompatibleFramework.length > 0
    || allowedWriteResult.protectedWrite.length > 0
  ) {
    details.allowedWritePaths = buildRuntimePathSelectionMessage(allowedWriteResult)
  }

  const forbiddenWriteResult = await resolveRuntimePathSelections({
    pathKeys: forbiddenWritePaths,
    frameworkKeys: supportedFrameworkKeys,
    operation: null,
    requireProtected: true,
    forbidProtectedWrites: false,
  })
  if (
    forbiddenWriteResult.missing.length > 0
    || forbiddenWriteResult.inactive.length > 0
    || forbiddenWriteResult.incompatibleFramework.length > 0
    || forbiddenWriteResult.unprotected.length > 0
  ) {
    details.forbiddenWritePaths = buildRuntimePathSelectionMessage(forbiddenWriteResult)
  }

  return details
}

const buildDependencySummary = (
  {
    agents = [],
    workflowPolicies = [],
    validations = [],
    frameworkPackages = [],
  },
  { includeEntities = false } = {},
) => ({
  agentIds: agents.map((agent) => agent.stableId),
  workflowPolicyIds: workflowPolicies.map((policy) => policy.stableId),
  validationIds: validations.map((validation) => validation.stableId),
  frameworkPackageIds: frameworkPackages.map((pkg) => toIdString(pkg?._id || pkg?.id)).filter(Boolean),
  ...(includeEntities
    ? {
        agents: agents.map(serializeRuntimeDependencyReference),
        workflowPolicies: workflowPolicies.map(serializeRuntimeDependencyReference),
        validations: validations.map(serializeRuntimeDependencyReference),
        frameworkPackages: frameworkPackages.map(serializeFrameworkPackageDependencyReference),
      }
    : {}),
})

const fetchRuntimeSkillDependencies = async (skillId) => {
  const normalizedSkillId = String(skillId || '').trim().toLowerCase()
  const [agents, workflowPolicies, validations, frameworkPackages] = await Promise.all([
    RuntimeAgent.find({
      $or: [
        { defaultSkillIds: normalizedSkillId },
        { primarySkillIds: normalizedSkillId },
        { optionalSkillIds: normalizedSkillId },
        { 'executionPlan.skillId': normalizedSkillId },
      ],
    })
      .select('stableId key name status')
      .lean(),
    WorkflowPolicy.find({
      $or: [
        { requiredSkillIds: normalizedSkillId },
        { 'steps.skillId': normalizedSkillId },
      ],
    })
      .select('stableId key name status')
      .lean(),
    ValidationRegistry.find({ producerSkillId: normalizedSkillId })
      .select('stableId key label name status')
      .lean(),
    FrameworkPackage.find({
      'dependencyLock.references': {
        $elemMatch: {
          collectionKey: 'RuntimeSkill',
          $or: [{ id: normalizedSkillId }, { key: normalizedSkillId }],
        },
      },
    })
      .select('frameworkKey frameworkName packageKey version status')
      .lean(),
  ])

  return { agents, workflowPolicies, validations, frameworkPackages }
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
    const effectiveStatus = String(req.body.status ?? 'ACTIVE').trim().toUpperCase()
    const isActiveSkill = effectiveStatus === 'ACTIVE'
    let selectedSkillRole = null

    // Skill role is required only for ACTIVE skills; legacy drafts may continue without one.
    if (isActiveSkill && !String(req.body.skillRoleKey || '').trim()) {
      return sendValidationFailed(res, req, {
        skillRoleKey: 'Skill role is required for active skills.',
      })
    }

    if (req.body.skillRoleKey) {
      const skillRoleValidation = await validateRuntimeSkillSkillRoleKey(req.body.skillRoleKey)
      if (Object.keys(skillRoleValidation.details).length > 0) {
        return sendValidationFailed(res, req, skillRoleValidation.details)
      }
      selectedSkillRole = skillRoleValidation.skillRole

      if (isActiveSkill && skillRoleValidation.skillRole?.status !== SKILL_ROLE_REGISTRY_STATUSES.ACTIVE) {
        return sendValidationFailed(res, req, {
          skillRoleKey: `Skill role key "${skillRoleValidation.skillRoleKey}" must reference an ACTIVE skill role.`,
        })
      }
    }

    const validationDetails = await validateRuntimeSkillFrameworkKeys(req.body.supportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const runtimePathDetails = await validateRuntimeSkillRuntimePaths({
      supportedFrameworkKeys: req.body.supportedFrameworkKeys,
      allowedReadPaths: req.body.allowedReadPaths,
      allowedWritePaths: req.body.allowedWritePaths,
      forbiddenWritePaths: req.body.forbiddenWritePaths,
    })
    if (Object.keys(runtimePathDetails).length > 0) {
      return sendValidationFailed(res, req, runtimePathDetails)
    }

    const skillRoleScopeDetails = validateRuntimeSkillRoleWriteScopes({
      skillRole: selectedSkillRole,
      allowedWritePaths: req.body.allowedWritePaths,
    })
    if (Object.keys(skillRoleScopeDetails).length > 0) {
      return sendValidationFailed(res, req, skillRoleScopeDetails)
    }

    const effectiveExecutionMode = String(req.body.executionMode ?? 'SYSTEM').trim().toUpperCase()
    const effectiveType = String(req.body.type ?? 'DETERMINISTIC').trim().toUpperCase()

    // Intentional duplication: enforced at validator → model → controller for defense-in-depth.
    if (effectiveType === 'AGENT_ASSISTED' && effectiveExecutionMode !== 'AGENT') {
      return sendValidationFailed(res, req, {
        type: 'Implementation type "AGENT_ASSISTED" is only compatible with AGENT execution mode.',
      })
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
        skillRoleKey: runtimeSkill.skillRoleKey,
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
        referenceAssets: runtimeSkill.referenceAssets,
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
    const runtimeSkill = await RuntimeSkill.findByStableId(req.params.skillId)

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
    const runtimeSkill = await RuntimeSkill.findByStableId(req.params.skillId)
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
        stableId: runtimeSkill.stableId,
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

export const cloneRuntimeSkill = async (req, res, next) => {
  try {
    const source = await RuntimeSkill.findByStableId(req.params.skillId)

    if (!source) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_SKILL_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const body = pickRuntimeSkillCloneBody(req.body)
    const duplicateRuntimeSkill = await RuntimeSkill.findOne({ key: body.key }).select('_id')
    if (duplicateRuntimeSkill) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_SKILL_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_SKILL_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const sourceStableId = source.stableId
    const clonedSkill = new RuntimeSkill({
      ...pickRuntimeSkillPayload(source),
      key: body.key,
      name: body.name,
      description: body.description ?? source.description ?? '',
      status: RUNTIME_SKILL_STATUSES.DRAFT,
      componentVersion: Math.max(1, Number(source.componentVersion) || 1) + 1,
      versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
      lineageId: source.lineageId || sourceStableId,
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockedReason: '',
      lockedByPackageKeys: [],
      clonedFromStableId: sourceStableId,
      supersedesStableId: sourceStableId,
      supersededByStableId: null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await clonedSkill.save()
    await RuntimeSkill.updateOne(
      { stableId: sourceStableId },
      { $set: { supersededByStableId: clonedSkill.stableId, updatedBy: actorUserId } },
      { runValidators: false },
    )
    await populateRuntimeSkill(clonedSkill)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_SKILL_CLONED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeSkill,
      resourceId: clonedSkill._id,
      scope: {
        frameworkKeys: clonedSkill.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeSkillLabel(clonedSkill) },
      diff: {
        sourceStableId,
        clonedStableId: clonedSkill.stableId,
        sourceKey: source.key,
        clonedKey: clonedSkill.key,
        sourceComponentVersion: source.componentVersion,
        clonedComponentVersion: clonedSkill.componentVersion,
        lineageId: clonedSkill.lineageId,
      },
    })

    const dependencies = buildDependencySummary(
      await fetchRuntimeSkillDependencies(clonedSkill.stableId),
    )

    return res.status(201).json({
      data: serializeRuntimeSkill(clonedSkill, {
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

export const updateRuntimeSkill = async (req, res, next) => {
  try {
    const runtimeSkill = await RuntimeSkill.findByStableId(req.params.skillId)

    if (!runtimeSkill) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_SKILL_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (runtimeSkill.isLocked === true) {
      return sendConflict(
        res,
        req,
        'Locked Runtime Control records cannot be edited directly. Clone the record to make behavior changes.',
        {
          field: 'isLocked',
          reason: 'RUNTIME_SKILL_LOCKED',
          lockedByPackageKeys: Array.isArray(runtimeSkill.lockedByPackageKeys)
            ? runtimeSkill.lockedByPackageKeys
            : [],
        },
      )
    }

    // Prevent key changes - the key is immutable after creation
    if (req.body.key !== undefined && req.body.key !== runtimeSkill.key) {
      return sendValidationFailed(res, req, {
        key: 'Skill key is immutable and cannot be changed after creation.',
      })
    }

    const nextSupportedFrameworkKeys =
      req.body.supportedFrameworkKeys ?? runtimeSkill.supportedFrameworkKeys
    const currentSkillRoleKey = String(runtimeSkill.skillRoleKey ?? '').trim().toUpperCase()
    const effectiveSkillRoleKey =
      req.body.skillRoleKey !== undefined
        ? req.body.skillRoleKey
        : currentSkillRoleKey
    const nextStatus = String(req.body.status ?? runtimeSkill.status ?? '').trim().toUpperCase()
    const normalizedEffectiveSkillRoleKey = String(effectiveSkillRoleKey ?? '').trim().toUpperCase()
    let selectedSkillRole = null

    if (!normalizedEffectiveSkillRoleKey) {
      if (nextStatus === RUNTIME_SKILL_STATUSES.ACTIVE) {
        return sendValidationFailed(res, req, {
          skillRoleKey: 'Skill role is required for active skills.',
        })
      }
    } else {
      const skillRoleValidation = await validateRuntimeSkillSkillRoleKey(effectiveSkillRoleKey)
      if (Object.keys(skillRoleValidation.details).length > 0) {
        return sendValidationFailed(res, req, skillRoleValidation.details)
      }
      selectedSkillRole = skillRoleValidation.skillRole

      const normalizedRequestedSkillRoleKey = String(req.body.skillRoleKey ?? '').trim().toUpperCase()
      const isChangingSkillRoleKey =
        req.body.skillRoleKey !== undefined
        && normalizedRequestedSkillRoleKey !== currentSkillRoleKey
      const requiresActiveSkillRole = isChangingSkillRoleKey || !currentSkillRoleKey

      if (
        requiresActiveSkillRole
        && skillRoleValidation.skillRole?.status !== SKILL_ROLE_REGISTRY_STATUSES.ACTIVE
      ) {
        return sendValidationFailed(res, req, {
          skillRoleKey: `Skill role key "${skillRoleValidation.skillRoleKey}" must reference an ACTIVE skill role.`,
        })
      }
    }

    const validationDetails = await validateRuntimeSkillFrameworkKeys(nextSupportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const nextAllowedReadPaths = req.body.allowedReadPaths ?? runtimeSkill.allowedReadPaths ?? []
    const nextAllowedWritePaths = req.body.allowedWritePaths ?? runtimeSkill.allowedWritePaths ?? []
    const nextForbiddenWritePaths = req.body.forbiddenWritePaths ?? runtimeSkill.forbiddenWritePaths ?? []

    const runtimePathDetails = await validateRuntimeSkillRuntimePaths({
      supportedFrameworkKeys: nextSupportedFrameworkKeys,
      allowedReadPaths: nextAllowedReadPaths,
      allowedWritePaths: nextAllowedWritePaths,
      forbiddenWritePaths: nextForbiddenWritePaths,
    })
    if (Object.keys(runtimePathDetails).length > 0) {
      return sendValidationFailed(res, req, runtimePathDetails)
    }

    const skillRoleScopeDetails = validateRuntimeSkillRoleWriteScopes({
      skillRole: selectedSkillRole,
      allowedWritePaths: nextAllowedWritePaths,
    })
    if (Object.keys(skillRoleScopeDetails).length > 0) {
      return sendValidationFailed(res, req, skillRoleScopeDetails)
    }

    const effectiveExecutionMode = String(req.body.executionMode ?? runtimeSkill.executionMode ?? 'SYSTEM').trim().toUpperCase()
    const effectiveType = String(req.body.type ?? runtimeSkill.type ?? 'DETERMINISTIC').trim().toUpperCase()

    if (req.body.executionConfig !== undefined && effectiveExecutionMode === 'SYSTEM' && hasObjectKeys(req.body.executionConfig)) {
      return sendValidationFailed(res, req, {
        executionConfig: 'Execution config is only supported for Rule Engine or Agent execution modes.',
      })
    }

    // Intentional duplication: enforced at validator → model → controller for defense-in-depth.
    if (effectiveType === 'AGENT_ASSISTED' && effectiveExecutionMode !== 'AGENT') {
      return sendValidationFailed(res, req, {
        type: 'Implementation type "AGENT_ASSISTED" is only compatible with AGENT execution mode.',
      })
    }

    const diff = {}
    const fields = [
      'key',
      'name',
      'description',
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
