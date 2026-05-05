import { isDeepStrictEqual } from 'node:util'
import crypto from 'node:crypto'
import RuntimeAgent, {
  buildRuntimeAgentStableId,
  RUNTIME_AGENT_STATUSES,
} from '../models/RuntimeAgent.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import SkillRoleRegistry from '../models/SkillRoleRegistry.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { resolveRuntimePathSelections } from '../services/runtimePathRegistryService.js'
import { RUNTIME_PATH_REGISTRY_OPERATIONS } from '../models/RuntimePathRegistry.js'

const DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE = 'Agent key must be unique.'
const RUNTIME_AGENT_NOT_FOUND_MESSAGE = 'Agent was not found.'

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
const normalizeToken = (value) => String(value ?? '').trim().toLowerCase()
const normalizeFrameworkKey = (value) => String(value ?? '').trim().toUpperCase()
const executionTargetRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/
const normalizeEnumToken = (value) => String(value ?? '').trim().toUpperCase()

const normalizePathSelectionList = (values) => {
  const rawValues = Array.isArray(values)
    ? values
    : values === undefined || values === null || values === ''
      ? []
      : [values]

  return [...new Set(
    rawValues
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )]
}

const normalizeRequiredSkillRoleKeys = (values) => {
  if (!Array.isArray(values)) return []

  return [...new Set(
    values
      .map((value) => normalizeEnumToken(value))
      .filter(Boolean),
  )]
}

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

const serializeRuntimeAgent = (runtimeAgent, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof runtimeAgent?.toJSON === 'function'
    ? runtimeAgent.toJSON()
    : { ...runtimeAgent }

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
  version: value?.version,
  status: value?.status,
})

const buildRuntimeAgentLabel = (runtimeAgent) =>
  runtimeAgent?.name
    ? `${runtimeAgent.name} (${runtimeAgent.key})`
    : runtimeAgent?.key

const isDuplicateRuntimeAgentKeyError = (err) =>
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

const sendNotFound = (res, req, message = RUNTIME_AGENT_NOT_FOUND_MESSAGE) =>
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message,
      requestId: req.requestId,
    },
  })

const pickRuntimeAgentBody = (body = {}) => ({
  key: body?.key,
  name: body?.name,
  description: body?.description,
  status: body?.status,
  agentType: body?.agentType,
  supportedFrameworkKeys: body?.supportedFrameworkKeys,
  requiredSkillRoleKeys: body?.requiredSkillRoleKeys,
  defaultSkillIds: body?.defaultSkillIds,
  primarySkillIds: body?.primarySkillIds,
  optionalSkillIds: body?.optionalSkillIds,
  executionPlan: body?.executionPlan,
  promptConfig: body?.promptConfig,
  runtimeConfig: body?.runtimeConfig,
  inputContract: body?.inputContract,
  outputContract: body?.outputContract,
  policies: body?.policies,
})

const pickRuntimeAgentCloneBody = (body = {}) => ({
  key: body?.key,
  name: body?.name,
  description: body?.description,
})

const populateRuntimeAgent = async (runtimeAgent) => {
  if (!runtimeAgent || typeof runtimeAgent.populate !== 'function') {
    return runtimeAgent
  }

  await runtimeAgent.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
  ])

  return runtimeAgent
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
      { defaultSkillIds: regex },
    ]
  }

  return filter
}

const validateRuntimeAgentFrameworkKeys = async (supportedFrameworkKeys = []) => {
  const { missingKeys, inactiveKeys } = await resolveKnownFrameworkKeys(
    supportedFrameworkKeys,
    'frameworkKey name supportedWorkflowKeys status',
    { requireActive: true },
  )

  if (missingKeys.length === 0 && inactiveKeys.length === 0) {
    return {}
  }

  if (missingKeys.length > 0) {
    return {
      supportedFrameworkKeys: buildUnknownFrameworkKeyMessage(missingKeys),
    }
  }

  return {
    supportedFrameworkKeys: buildInactiveFrameworkKeyMessage(inactiveKeys),
  }
}

const validateRuntimeAgentRequiredSkillRoles = async (
  requiredSkillRoleKeys = [],
  { currentRequiredSkillRoleKeys = [], allowUnchangedNonActive = false } = {},
) => {
  const errors = {}
  const warnings = []
  const normalizedRoleKeys = normalizeRequiredSkillRoleKeys(requiredSkillRoleKeys)
  const normalizedCurrentRoleKeys = normalizeRequiredSkillRoleKeys(currentRequiredSkillRoleKeys)

  if (normalizedRoleKeys.length === 0) {
    return { errors, warnings }
  }

  const roles = await SkillRoleRegistry.find({
    roleKey: { $in: normalizedRoleKeys },
  })
    .select('roleKey status')
    .lean()

  const roleLookup = new Map(
    roles.map((role) => [normalizeEnumToken(role?.roleKey), role]),
  )

  const missingRoleKey = normalizedRoleKeys.find((roleKey) => !roleLookup.has(roleKey))
  if (missingRoleKey) {
    errors.requiredSkillRoleKeys = `Required skill role "${missingRoleKey}" was not found.`
    return { errors, warnings }
  }

  const currentRoleKeySet = new Set(normalizedCurrentRoleKeys)
  const keysRequiringActive = allowUnchangedNonActive
    ? normalizedRoleKeys.filter((roleKey) => !currentRoleKeySet.has(roleKey))
    : normalizedRoleKeys

  const inactiveRoleKey = keysRequiringActive.find((roleKey) => {
    const role = roleLookup.get(roleKey)
    return String(role?.status ?? '').trim().toUpperCase() !== 'ACTIVE'
  })

  if (inactiveRoleKey) {
    errors.requiredSkillRoleKeys = `Required skill role "${inactiveRoleKey}" must be ACTIVE.`
    return { errors, warnings }
  }

  if (allowUnchangedNonActive) {
    const nonActiveUnchanged = normalizedRoleKeys.filter((roleKey) => {
      if (!currentRoleKeySet.has(roleKey)) return false
      const role = roleLookup.get(roleKey)
      return String(role?.status ?? '').trim().toUpperCase() !== 'ACTIVE'
    })

    if (nonActiveUnchanged.length > 0) {
      warnings.push(
        `Agent references non-active required skill role${nonActiveUnchanged.length === 1 ? '' : 's'}: ${nonActiveUnchanged.join(', ')}.`,
      )
    }
  }

  return { errors, warnings }
}

const fetchRuntimeAgentDependencies = async (agentId) => {
  const normalizedAgentId = normalizeToken(agentId)
  if (!normalizedAgentId) return { workflowPolicies: [], frameworkPackages: [] }

  const [workflowPolicies, frameworkPackages] = await Promise.all([
    WorkflowPolicy.find({
      $or: [
        { requiredAgentIds: normalizedAgentId },
        { primaryAgentId: normalizedAgentId },
        { fallbackAgentIds: normalizedAgentId },
      ],
    })
      .select('stableId key name status')
      .lean(),
    FrameworkPackage.find({
      'dependencyLock.references': {
        $elemMatch: {
          collectionKey: 'RuntimeAgent',
          $or: [{ id: normalizedAgentId }, { key: normalizedAgentId }],
        },
      },
    })
      .select('frameworkKey frameworkName packageKey version status')
      .lean(),
  ])

  return {
    workflowPolicies: Array.isArray(workflowPolicies) ? workflowPolicies : [],
    frameworkPackages: Array.isArray(frameworkPackages) ? frameworkPackages : [],
  }
}

const buildRuntimeAgentDependencySummary = ({ workflowPolicies = [], frameworkPackages = [] }) => {
  const activeWorkflowPolicies = workflowPolicies.filter((policy) => policy?.status === 'ACTIVE')
  const activeFrameworkPackages = frameworkPackages.filter((pkg) => pkg?.status === 'ACTIVE')

  const warnings = []
  const blocks = []

  if (activeWorkflowPolicies.length > 0) {
    warnings.push(`This Agent is used by ${activeWorkflowPolicies.length} ACTIVE workflow policies.`)
  }

  if (activeFrameworkPackages.length > 0) {
    warnings.push(`This Agent is used by ${activeFrameworkPackages.length} ACTIVE framework packages.`)
  }

  if (warnings.length > 0) {
    blocks.push('Deactivation is blocked while this agent is referenced by ACTIVE runtime-control resources.')
  }

  return {
    summary: {
      workflowPolicies: workflowPolicies.length,
      frameworkPackages: frameworkPackages.length,
      activeWorkflowPolicies: activeWorkflowPolicies.length,
      activeFrameworkPackages: activeFrameworkPackages.length,
    },
    warnings,
    blocks,
  }
}

const validateRuntimeAgentExecutionPlan = async (
  runtimeAgent,
  { allowLegacyWriteTargets = false } = {},
) => {
  const errors = {}
  const warnings = []
  const plan = Array.isArray(runtimeAgent?.executionPlan) ? runtimeAgent.executionPlan : []

  if (plan.length === 0) {
    errors.executionPlan = 'Execution plan must contain at least one step.'
    return { errors, warnings }
  }

  const skillIds = plan
    .map((step) => normalizeToken(step?.skillId))
    .filter(Boolean)

  if (skillIds.length !== plan.length) {
    errors.executionPlan = 'Each execution plan step must reference a valid skill id.'
    return { errors, warnings }
  }

  const skillIdSet = new Set()
  const duplicateSkillId = skillIds.find((skillId) => {
    if (skillIdSet.has(skillId)) return true
    skillIdSet.add(skillId)
    return false
  })

  if (duplicateSkillId) {
    errors.executionPlan = `Duplicate skill "${duplicateSkillId}" is not allowed in the execution plan.`
    return { errors, warnings }
  }

  const stepKeys = plan.map((step, index) => normalizeToken(step?.stepKey) || `run-${normalizeToken(step?.skillId)}-${index + 1}`)
  const duplicateStepKeySet = new Set()
  const duplicateStepKey = stepKeys.find((stepKey) => {
    if (duplicateStepKeySet.has(stepKey)) return true
    duplicateStepKeySet.add(stepKey)
    return false
  })

  if (duplicateStepKey) {
    errors.executionPlan = `Duplicate step key "${duplicateStepKey}" is not allowed in the execution plan.`
    return { errors, warnings }
  }

  const orders = plan.map((step, index) => {
    const order = Number.parseInt(step?.order, 10)
    return Number.isInteger(order) && order > 0 ? order : index + 1
  })
  const duplicateOrderSet = new Set()
  const duplicateOrder = orders.find((order) => {
    if (duplicateOrderSet.has(order)) return true
    duplicateOrderSet.add(order)
    return false
  })

  if (duplicateOrder) {
    errors.executionPlan = `Duplicate execution order "${duplicateOrder}" is not allowed in the execution plan.`
    return { errors, warnings }
  }

  const assignedSkillIds = new Set([
    ...(Array.isArray(runtimeAgent?.defaultSkillIds) ? runtimeAgent.defaultSkillIds : []),
    ...(Array.isArray(runtimeAgent?.primarySkillIds) ? runtimeAgent.primarySkillIds : []),
    ...(Array.isArray(runtimeAgent?.optionalSkillIds) ? runtimeAgent.optionalSkillIds : []),
  ].map(normalizeToken).filter(Boolean))

  const unassignedSkillId = skillIds.find((skillId) => !assignedSkillIds.has(skillId))
  if (unassignedSkillId) {
    errors.executionPlan = `Skill "${unassignedSkillId}" must be assigned to the agent before it can be used in the execution plan.`
    return { errors, warnings }
  }

  const skills = await RuntimeSkill.find({ stableId: { $in: skillIds } })
    .select('stableId status supportedFrameworkKeys')
    .lean()

  const skillLookup = new Map(skills.map((skill) => [normalizeToken(skill.stableId), skill]))
  const unknownSkillId = skillIds.find((skillId) => !skillLookup.has(skillId))
  if (unknownSkillId) {
    errors.executionPlan = `Unknown skill id "${unknownSkillId}".`
    return { errors, warnings }
  }

  const inactiveSkillId = skillIds.find((skillId) => {
    const skill = skillLookup.get(skillId)
    return String(skill?.status ?? '').trim().toUpperCase() !== 'ACTIVE'
  })

  if (inactiveSkillId) {
    errors.executionPlan = `Skill "${inactiveSkillId}" is not ACTIVE and cannot be used in the execution plan.`
    return { errors, warnings }
  }

  const agentFrameworks = Array.isArray(runtimeAgent?.supportedFrameworkKeys)
    ? runtimeAgent.supportedFrameworkKeys.map(normalizeFrameworkKey).filter(Boolean)
    : []
  const agentFrameworkSet = new Set(agentFrameworks)

  const incompatibleSkillId = skillIds.find((skillId) => {
    const skill = skillLookup.get(skillId)
    const frameworks = Array.isArray(skill?.supportedFrameworkKeys)
      ? skill.supportedFrameworkKeys.map(normalizeFrameworkKey).filter(Boolean)
      : []
    return !frameworks.some((frameworkKey) => agentFrameworkSet.has(frameworkKey))
  })

  if (incompatibleSkillId) {
    errors.executionPlan = `Skill "${incompatibleSkillId}" is not compatible with the selected frameworks.`
    return { errors, warnings }
  }

  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index]
    const stepNumber = index + 1
    const readsFrom = normalizePathSelectionList(step?.readsFrom)
    const writesTo = normalizePathSelectionList(step?.writesTo)
    const wildcardReadsFrom = readsFrom.filter((pathKey) => pathKey.includes('*'))
    const governedReadsFrom = readsFrom.filter((pathKey) => !wildcardReadsFrom.includes(pathKey))
    const legacyWriteTargets = allowLegacyWriteTargets
      ? writesTo.filter((pathKey) => executionTargetRegex.test(pathKey) && !pathKey.includes('.'))
      : []
    const governedWriteTargets = writesTo.filter((pathKey) => !legacyWriteTargets.includes(pathKey))

    const readSelections = await resolveRuntimePathSelections({
      pathKeys: governedReadsFrom,
      frameworkKeys: agentFrameworks,
      operation: RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
      requireActive: true,
      forbidProtectedWrites: false,
    })

    if (readSelections.missing.length > 0) {
      errors.executionPlan = `Step ${stepNumber} reads from unknown runtime path "${readSelections.missing[0]}".`
      return { errors, warnings }
    }

    if (readSelections.inactive.length > 0) {
      errors.executionPlan = `Step ${stepNumber} reads from inactive runtime path "${readSelections.inactive[0]}".`
      return { errors, warnings }
    }

    if (readSelections.invalidOperation.length > 0) {
      errors.executionPlan = `Step ${stepNumber} cannot read from runtime path "${readSelections.invalidOperation[0]}".`
      return { errors, warnings }
    }

    if (readSelections.incompatibleFramework.length > 0) {
      errors.executionPlan = `Step ${stepNumber} reads from runtime path "${readSelections.incompatibleFramework[0]}", which is not compatible with the selected frameworks.`
      return { errors, warnings }
    }

    if (wildcardReadsFrom.length > 0) {
      warnings.push(
        `Step ${stepNumber} uses wildcard read target${wildcardReadsFrom.length === 1 ? '' : 's'}: ${wildcardReadsFrom.join(', ')}.`,
      )
    }

    const writeSelections = await resolveRuntimePathSelections({
      pathKeys: governedWriteTargets,
      frameworkKeys: agentFrameworks,
      operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
      requireActive: true,
      forbidProtectedWrites: true,
    })

    if (writeSelections.missing.length > 0) {
      errors.executionPlan = `Step ${stepNumber} writes to unknown runtime path "${writeSelections.missing[0]}".`
      return { errors, warnings }
    }

    if (writeSelections.inactive.length > 0) {
      errors.executionPlan = `Step ${stepNumber} writes to inactive runtime path "${writeSelections.inactive[0]}".`
      return { errors, warnings }
    }

    if (writeSelections.invalidOperation.length > 0) {
      errors.executionPlan = `Step ${stepNumber} cannot write to runtime path "${writeSelections.invalidOperation[0]}".`
      return { errors, warnings }
    }

    if (writeSelections.incompatibleFramework.length > 0) {
      errors.executionPlan = `Step ${stepNumber} writes to runtime path "${writeSelections.incompatibleFramework[0]}", which is not compatible with the selected frameworks.`
      return { errors, warnings }
    }

    if (writeSelections.protectedWrite.length > 0) {
      errors.executionPlan = `Step ${stepNumber} cannot write to protected runtime path "${writeSelections.protectedWrite[0]}".`
      return { errors, warnings }
    }

    if (legacyWriteTargets.length > 0) {
      warnings.push(
        `Step ${stepNumber} still uses legacy writes-to target${legacyWriteTargets.length === 1 ? '' : 's'}: ${legacyWriteTargets.join(', ')}.`,
      )
    }
  }

  return { errors, warnings }
}

const validateRuntimeAgentDocument = async (runtimeAgent) => {
  const errors = {}
  const warnings = []

  if (!runtimeAgent?.key) {
    errors.key = 'Agent key is required.'
  }

  if (!runtimeAgent?.name) {
    errors.name = 'Agent name is required.'
  }

  if (!Array.isArray(runtimeAgent?.supportedFrameworkKeys) || runtimeAgent.supportedFrameworkKeys.length === 0) {
    errors.supportedFrameworkKeys = 'At least one supported framework key is required.'
  } else {
    const validationDetails = await validateRuntimeAgentFrameworkKeys(runtimeAgent.supportedFrameworkKeys)
    Object.assign(errors, validationDetails)
  }

  if (!errors.requiredSkillRoleKeys) {
    const requiredRolesResult = await validateRuntimeAgentRequiredSkillRoles(
      runtimeAgent?.requiredSkillRoleKeys,
      {
        currentRequiredSkillRoleKeys: runtimeAgent?.requiredSkillRoleKeys,
        allowUnchangedNonActive: true,
      },
    )
    Object.assign(errors, requiredRolesResult.errors)
    warnings.push(...(requiredRolesResult.warnings || []))
  }

  if (!errors.supportedFrameworkKeys && !errors.requiredSkillRoleKeys) {
    const planDetails = await validateRuntimeAgentExecutionPlan(runtimeAgent, {
      allowLegacyWriteTargets: true, // TODO: remove after legacy migration window closes per STORYLINEOS-RUNTIME-CONTROL-ALIGNMENT-SPRINT-02-SPEC.md
    })
    Object.assign(errors, planDetails.errors)
    warnings.push(...(planDetails.warnings || []))
  }

  if (runtimeAgent?.status === 'DEPRECATED') {
    warnings.push('Agent is deprecated and should not be selected as a default for new policies.')
  }

  return {
    errors,
    warnings,
    isValid: Object.keys(errors).length === 0,
  }
}

export const listRuntimeAgents = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await RuntimeAgent.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await RuntimeAgent.find(filter)
      .sort({ status: 1, updatedAt: -1, key: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeRuntimeAgent(item)),
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

export const createRuntimeAgent = async (req, res, next) => {
  try {
    const body = pickRuntimeAgentBody(req.body)

    const validationDetails = await validateRuntimeAgentFrameworkKeys(body.supportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const requiredSkillRoleValidationDetails = await validateRuntimeAgentRequiredSkillRoles(
      body.requiredSkillRoleKeys,
    )
    if (Object.keys(requiredSkillRoleValidationDetails.errors).length > 0) {
      return sendValidationFailed(res, req, requiredSkillRoleValidationDetails.errors)
    }

    const planDetails = await validateRuntimeAgentExecutionPlan(body, {
      allowLegacyWriteTargets: false,
    })
    if (Object.keys(planDetails.errors).length > 0) {
      return sendValidationFailed(res, req, planDetails.errors)
    }

    const existingRuntimeAgent = await RuntimeAgent.findOne({
      key: body.key,
    }).select('_id')

    if (existingRuntimeAgent) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const runtimeAgent = new RuntimeAgent({
      ...body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await runtimeAgent.save()
    await populateRuntimeAgent(runtimeAgent)

    const serializedRuntimeAgent = serializeRuntimeAgent(runtimeAgent, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_CREATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
      resourceId: runtimeAgent._id,
      scope: {
        frameworkKeys: runtimeAgent.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
      diff: {
        id: runtimeAgent.stableId,
        key: runtimeAgent.key,
        name: runtimeAgent.name,
        description: runtimeAgent.description,
        status: runtimeAgent.status,
        agentType: runtimeAgent.agentType,
        supportedFrameworkKeys: runtimeAgent.supportedFrameworkKeys,
        requiredSkillRoleKeys: runtimeAgent.requiredSkillRoleKeys,
        defaultSkillIds: runtimeAgent.defaultSkillIds,
        primarySkillIds: runtimeAgent.primarySkillIds,
        optionalSkillIds: runtimeAgent.optionalSkillIds,
        executionPlan: runtimeAgent.executionPlan,
        promptConfig: runtimeAgent.promptConfig,
        runtimeConfig: runtimeAgent.runtimeConfig,
        inputContract: runtimeAgent.inputContract,
        outputContract: runtimeAgent.outputContract,
        policies: runtimeAgent.policies,
      },
    })

    return res.status(201).json({
      data: serializedRuntimeAgent,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRuntimeAgentKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
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

export const getRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    await populateRuntimeAgent(runtimeAgent)

    return res.status(200).json({
      data: serializeRuntimeAgent(runtimeAgent),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getRuntimeAgentDependencies = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)
      .select('stableId key name status supportedFrameworkKeys')
      .lean()

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    const dependencies = await fetchRuntimeAgentDependencies(runtimeAgent.stableId)
    const summary = buildRuntimeAgentDependencySummary(dependencies)

    return res.status(200).json({
      data: {
        agentId: runtimeAgent.stableId,
        workflowPolicies: dependencies.workflowPolicies.map(serializeRuntimeDependencyReference),
        frameworkPackages: dependencies.frameworkPackages.map(serializeFrameworkPackageDependencyReference),
        ...summary,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const cloneRuntimeAgent = async (req, res, next) => {
  try {
    const source = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!source) {
      return sendNotFound(res, req)
    }

    const body = pickRuntimeAgentCloneBody(req.body)
    const duplicateRuntimeAgent = await RuntimeAgent.findOne({ key: body.key }).select('_id')
    if (duplicateRuntimeAgent) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const sourceStableId = source.stableId
    const sourcePlain = source.toObject({ depopulate: true })
    delete sourcePlain._id
    delete sourcePlain.id
    delete sourcePlain.stableId
    delete sourcePlain.createdAt
    delete sourcePlain.updatedAt
    delete sourcePlain.__v

    const clonedAgent = new RuntimeAgent({
      ...sourcePlain,
      stableId: buildRuntimeAgentStableId(body.key),
      key: body.key,
      name: body.name,
      description: body.description === undefined ? source.description : body.description,
      status: RUNTIME_AGENT_STATUSES.DRAFT,
      componentVersion: Number(source.componentVersion || 1) + 1,
      versionStatus: 'DRAFT',
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

    await clonedAgent.save()
    await RuntimeAgent.updateOne(
      { stableId: sourceStableId },
      { $set: { supersededByStableId: clonedAgent.stableId, updatedBy: actorUserId } },
      { runValidators: false },
    )
    await populateRuntimeAgent(clonedAgent)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_CLONED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
      resourceId: clonedAgent._id,
      scope: {
        frameworkKeys: clonedAgent.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeAgentLabel(clonedAgent) },
      diff: {
        clonedFromStableId: sourceStableId,
        supersedesStableId: sourceStableId,
        key: clonedAgent.key,
        status: clonedAgent.status,
        componentVersion: clonedAgent.componentVersion,
        versionStatus: clonedAgent.versionStatus,
        lineageId: clonedAgent.lineageId,
      },
    })

    return res.status(201).json({
      data: serializeRuntimeAgent(clonedAgent, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRuntimeAgentKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
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

export const updateRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    if (runtimeAgent.isLocked === true) {
      return sendConflict(
        res,
        req,
        'Locked Runtime Control records cannot be edited directly. Clone the record to make behavior changes.',
        {
          field: 'isLocked',
          reason: 'RUNTIME_AGENT_LOCKED',
          lockedByPackageKeys: Array.isArray(runtimeAgent.lockedByPackageKeys)
            ? runtimeAgent.lockedByPackageKeys
            : [],
        },
      )
    }

    const requestedStatusRaw = req.body.status
    if (requestedStatusRaw !== undefined) {
      const currentStatus = String(runtimeAgent.status ?? '').trim().toUpperCase()
      const nextStatus = String(requestedStatusRaw ?? '').trim().toUpperCase()
      const lifecycleStatuses = new Set(['ACTIVE', 'INACTIVE', 'DEPRECATED'])

      if (lifecycleStatuses.has(nextStatus) && nextStatus !== currentStatus) {
        return sendConflict(
          res,
          req,
          'Agent status must be changed using the lifecycle actions (activate, disable, deprecate).',
          {
            field: 'status',
            reason: 'RUNTIME_AGENT_LIFECYCLE_ACTION_REQUIRED',
          },
        )
      }

      // Prevent bypassing dependency-protected lifecycle rules by using DRAFT as an "inactive-like" status.
      if (nextStatus === 'DRAFT' && nextStatus !== currentStatus) {
        const dependencySummary = buildRuntimeAgentDependencySummary(
          await fetchRuntimeAgentDependencies(runtimeAgent.stableId),
        )

        if (dependencySummary.blocks.length > 0) {
          return sendConflict(
            res,
            req,
            'Agent cannot be set to DRAFT while referenced by ACTIVE workflow policies or framework packages.',
            {
              field: 'status',
              reason: 'RUNTIME_AGENT_DEPENDENCIES_ACTIVE',
              ...dependencySummary.summary,
            },
          )
        }
      }
    }

    const nextKey = req.body.key ?? runtimeAgent.key
    const nextSupportedFrameworkKeys =
      req.body.supportedFrameworkKeys ?? runtimeAgent.supportedFrameworkKeys

    const validationDetails = await validateRuntimeAgentFrameworkKeys(nextSupportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const nextRequiredSkillRoleKeys =
      req.body.requiredSkillRoleKeys ?? runtimeAgent.requiredSkillRoleKeys
    const requiredSkillRoleValidationDetails = await validateRuntimeAgentRequiredSkillRoles(
      nextRequiredSkillRoleKeys,
      {
        currentRequiredSkillRoleKeys: runtimeAgent.requiredSkillRoleKeys,
        allowUnchangedNonActive: true,
      },
    )
    if (Object.keys(requiredSkillRoleValidationDetails.errors).length > 0) {
      return sendValidationFailed(res, req, requiredSkillRoleValidationDetails.errors)
    }

    const planDetails = await validateRuntimeAgentExecutionPlan({
      supportedFrameworkKeys: nextSupportedFrameworkKeys,
      requiredSkillRoleKeys: nextRequiredSkillRoleKeys,
      defaultSkillIds: req.body.defaultSkillIds ?? runtimeAgent.defaultSkillIds,
      primarySkillIds: req.body.primarySkillIds ?? runtimeAgent.primarySkillIds,
      optionalSkillIds: req.body.optionalSkillIds ?? runtimeAgent.optionalSkillIds,
      executionPlan: req.body.executionPlan ?? runtimeAgent.executionPlan,
    }, {
      allowLegacyWriteTargets: true, // TODO: remove after legacy migration window closes per STORYLINEOS-RUNTIME-CONTROL-ALIGNMENT-SPRINT-02-SPEC.md
    })
    if (Object.keys(planDetails.errors).length > 0) {
      return sendValidationFailed(res, req, planDetails.errors)
    }

    const duplicateRuntimeAgent = await RuntimeAgent.findOne({
      _id: { $ne: runtimeAgent._id },
      key: nextKey,
    }).select('_id')

    if (duplicateRuntimeAgent) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
      })
    }

    const diff = {}
    const fields = [
      'key',
      'name',
      'description',
      'status',
      'agentType',
      'supportedFrameworkKeys',
      'requiredSkillRoleKeys',
      'defaultSkillIds',
      'primarySkillIds',
      'optionalSkillIds',
      'executionPlan',
      'promptConfig',
      'runtimeConfig',
      'inputContract',
      'outputContract',
      'policies',
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(runtimeAgent[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      runtimeAgent[field] = req.body[field]
    }

    runtimeAgent.updatedBy = req.context?.userId || req.userId
    await runtimeAgent.save()
    await populateRuntimeAgent(runtimeAgent)

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
        resourceId: runtimeAgent._id,
        scope: {
          frameworkKeys: runtimeAgent.supportedFrameworkKeys,
        },
        display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeRuntimeAgent(runtimeAgent, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRuntimeAgentKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
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

const buildLifecycleDiff = (field, fromValue, toValue) => ({
  [field]: {
    from: cloneAuditValue(fromValue),
    to: cloneAuditValue(toValue),
  },
})

const compilePromptPreview = (promptConfig = {}) => {
  const blocks = [
    { label: 'Base System Prompt', value: String(promptConfig.baseSystemPrompt ?? '').trim() },
    { label: 'Role Prompt', value: String(promptConfig.rolePrompt ?? '').trim() },
    { label: 'Developer Instructions', value: String(promptConfig.developerInstructions ?? '').trim() },
    { label: 'Output Contract Prompt', value: String(promptConfig.outputContractPrompt ?? '').trim() },
    { label: 'Forbidden Actions Prompt', value: String(promptConfig.forbiddenActionsPrompt ?? '').trim() },
    { label: 'Handoff Prompt', value: String(promptConfig.handoffPrompt ?? '').trim() },
  ].filter((block) => block.value)

  if (blocks.length === 0) return ''

  return blocks
    .map((block) => `## ${block.label}\n\n${block.value}`)
    .join('\n\n')
}

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(String(value ?? '')).digest('hex')

export const validateRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    await populateRuntimeAgent(runtimeAgent)

    const { errors, warnings } = await validateRuntimeAgentDocument(runtimeAgent)
    const isValid = Object.keys(errors).length === 0

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_VALIDATED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
      resourceId: runtimeAgent._id,
      scope: {
        frameworkKeys: runtimeAgent.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
      diff: {
        id: runtimeAgent.stableId,
        key: runtimeAgent.key,
        status: runtimeAgent.status,
        valid: isValid,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      },
    })

    if (!isValid) {
      return sendValidationFailed(res, req, errors, 'Agent validation failed.')
    }

    return res.status(200).json({
      data: {
        valid: true,
        warnings,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const testRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    await populateRuntimeAgent(runtimeAgent)

    const { errors, warnings } = await validateRuntimeAgentDocument(runtimeAgent)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const frameworkKey = String(body.frameworkKey ?? '').trim().toUpperCase()
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
    const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {}

    if (frameworkKey) {
      const frameworks = Array.isArray(runtimeAgent.supportedFrameworkKeys) ? runtimeAgent.supportedFrameworkKeys : []
      if (!frameworks.includes(frameworkKey)) {
        errors.frameworkKey = `Agent does not support framework key "${frameworkKey}".`
      }
    }
    const compiledPrompt = compilePromptPreview(runtimeAgent.promptConfig ?? {})
    const promptHash = sha256Hex(compiledPrompt)
    const isValid = Object.keys(errors).length === 0

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_TESTED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
      resourceId: runtimeAgent._id,
      scope: {
        frameworkKeys: runtimeAgent.supportedFrameworkKeys,
      },
      display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
      diff: {
        id: runtimeAgent.stableId,
        key: runtimeAgent.key,
        status: runtimeAgent.status,
        valid: isValid,
        ...(frameworkKey ? { frameworkKey } : {}),
        promptHash,
        promptLength: compiledPrompt.length,
        inputKeys: Object.keys(input).length,
        contextKeys: Object.keys(context).length,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      },
    })

    if (!isValid) {
      return sendValidationFailed(res, req, errors, 'Agent test failed.')
    }

    return res.status(200).json({
      data: {
        ok: true,
        warnings,
        promptHash,
        compiledPromptPreview: compiledPrompt,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const activateRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    if (runtimeAgent.status === 'DEPRECATED') {
      return sendConflict(res, req, 'Deprecated agents cannot be activated.', {
        field: 'status',
        reason: 'RUNTIME_AGENT_DEPRECATED',
      })
    }

    const { errors } = await validateRuntimeAgentDocument(runtimeAgent)
    if (Object.keys(errors).length > 0) {
      return sendValidationFailed(
        res,
        req,
        errors,
        'Agent must pass validation before activation.',
      )
    }

    const previousStatus = runtimeAgent.status
    runtimeAgent.status = 'ACTIVE'
    runtimeAgent.updatedBy = req.context?.userId || req.userId
    await runtimeAgent.save()
    await populateRuntimeAgent(runtimeAgent)

    if (previousStatus !== runtimeAgent.status) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_ACTIVATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
        resourceId: runtimeAgent._id,
        scope: {
          frameworkKeys: runtimeAgent.supportedFrameworkKeys,
        },
        display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
        diff: buildLifecycleDiff('status', previousStatus, runtimeAgent.status),
      })
    }

    return res.status(200).json({
      data: serializeRuntimeAgent(runtimeAgent, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const disableRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    const dependencySummary = buildRuntimeAgentDependencySummary(
      await fetchRuntimeAgentDependencies(runtimeAgent.stableId),
    )
    if (dependencySummary.blocks.length > 0) {
      return sendConflict(res, req, dependencySummary.blocks[0], {
        field: 'status',
        reason: 'RUNTIME_AGENT_DEPENDENCIES_ACTIVE',
        ...dependencySummary.summary,
      })
    }

    const previousStatus = runtimeAgent.status
    runtimeAgent.status = 'INACTIVE'
    runtimeAgent.updatedBy = req.context?.userId || req.userId
    await runtimeAgent.save()
    await populateRuntimeAgent(runtimeAgent)

    if (previousStatus !== runtimeAgent.status) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_DISABLED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
        resourceId: runtimeAgent._id,
        scope: {
          frameworkKeys: runtimeAgent.supportedFrameworkKeys,
        },
        display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
        diff: buildLifecycleDiff('status', previousStatus, runtimeAgent.status),
      })
    }

    return res.status(200).json({
      data: serializeRuntimeAgent(runtimeAgent, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const deprecateRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findByStableId(req.params.agentId)

    if (!runtimeAgent) {
      return sendNotFound(res, req)
    }

    const dependencySummary = buildRuntimeAgentDependencySummary(
      await fetchRuntimeAgentDependencies(runtimeAgent.stableId),
    )
    if (dependencySummary.blocks.length > 0) {
      return sendConflict(res, req, dependencySummary.blocks[0], {
        field: 'status',
        reason: 'RUNTIME_AGENT_DEPENDENCIES_ACTIVE',
        ...dependencySummary.summary,
      })
    }

    const previousStatus = runtimeAgent.status
    runtimeAgent.status = 'DEPRECATED'
    runtimeAgent.updatedBy = req.context?.userId || req.userId
    await runtimeAgent.save()
    await populateRuntimeAgent(runtimeAgent)

    if (previousStatus !== runtimeAgent.status) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.RUNTIME_AGENT_DEPRECATED,
        resourceType: auditService.RESOURCE_TYPES.RuntimeAgent,
        resourceId: runtimeAgent._id,
        scope: {
          frameworkKeys: runtimeAgent.supportedFrameworkKeys,
        },
        display: { resourceLabel: buildRuntimeAgentLabel(runtimeAgent) },
        diff: buildLifecycleDiff('status', previousStatus, runtimeAgent.status),
      })
    }

    return res.status(200).json({
      data: serializeRuntimeAgent(runtimeAgent, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
