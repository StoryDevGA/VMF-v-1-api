import { isDeepStrictEqual } from 'node:util'
import WorkflowPolicy, {
  WORKFLOW_POLICY_ALLOWED_STEPS_BY_FRAMEWORK,
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_STEP_ORDER_CONSTRAINTS_BY_FRAMEWORK,
} from '../models/WorkflowPolicy.js'
import RuntimeAgent, { RUNTIME_AGENT_STATUSES } from '../models/RuntimeAgent.js'
import RuntimeSkill, { RUNTIME_SKILL_STATUSES } from '../models/RuntimeSkill.js'
import auditService from '../services/auditService.js'

const DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE = 'Workflow policy key must be unique.'
const WORKFLOW_POLICY_NOT_FOUND_MESSAGE = 'Workflow policy was not found.'

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

const serializeWorkflowPolicy = (workflowPolicy, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof workflowPolicy?.toJSON === 'function'
    ? workflowPolicy.toJSON()
    : { ...workflowPolicy }

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

const buildWorkflowPolicyLabel = (workflowPolicy) =>
  workflowPolicy?.name
    ? `${workflowPolicy.name} (${workflowPolicy.key})`
    : workflowPolicy?.key

const isDuplicateWorkflowPolicyKeyError = (err) =>
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

const populateWorkflowPolicy = async (workflowPolicy) => {
  if (!workflowPolicy || typeof workflowPolicy.populate !== 'function') {
    return workflowPolicy
  }

  await workflowPolicy.populate([
    { path: 'createdBy', select: 'name email' },
    { path: 'updatedBy', select: 'name email' },
  ])

  return workflowPolicy
}

const buildListFilter = ({ q, status, frameworkKey }) => {
  const filter = {}

  if (status) {
    filter.status = status
  }

  if (frameworkKey) {
    filter.frameworkKeys = frameworkKey
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { stableId: regex },
      { key: regex },
      { name: regex },
      { description: regex },
      { status: regex },
      { frameworkKeys: regex },
      { orderedSteps: regex },
      { requiredAgentIds: regex },
      { requiredSkillIds: regex },
      { gatingRules: regex },
    ]
  }

  return filter
}

const findUnsupportedFrameworkKey = (supportedFrameworkKeys = [], workflowFrameworkKeys = []) =>
  workflowFrameworkKeys.find((frameworkKey) => !supportedFrameworkKeys.includes(frameworkKey))

const getWorkflowStepValidationMessage = (frameworkKeys = [], orderedSteps = []) => {
  const positions = new Map(orderedSteps.map((step, index) => [step, index]))

  for (const frameworkKey of frameworkKeys) {
    const allowedSteps = WORKFLOW_POLICY_ALLOWED_STEPS_BY_FRAMEWORK[frameworkKey] || []
    for (const step of orderedSteps) {
      if (!allowedSteps.includes(step)) {
        return `Workflow step "${step}" is not valid for framework key "${frameworkKey}".`
      }
    }

    const orderConstraints = WORKFLOW_POLICY_STEP_ORDER_CONSTRAINTS_BY_FRAMEWORK[frameworkKey] || []
    for (const [beforeStep, afterStep] of orderConstraints) {
      if (!positions.has(beforeStep) || !positions.has(afterStep)) continue

      if (positions.get(beforeStep) > positions.get(afterStep)) {
        return `Workflow step "${beforeStep}" must come before "${afterStep}" for framework key "${frameworkKey}".`
      }
    }
  }

  return null
}

const fetchRegistryReferences = async ({ requiredAgentIds = [], requiredSkillIds = [] }) => {
  const [agents, skills] = await Promise.all([
    requiredAgentIds.length > 0
      ? RuntimeAgent.find({ stableId: { $in: requiredAgentIds } })
        .select('stableId key name status supportedFrameworkKeys')
        .lean()
      : Promise.resolve([]),
    requiredSkillIds.length > 0
      ? RuntimeSkill.find({ stableId: { $in: requiredSkillIds } })
        .select('stableId key name status supportedFrameworkKeys')
        .lean()
      : Promise.resolve([]),
  ])

  return { agents, skills }
}

const validateWorkflowPolicyReferences = async ({
  frameworkKeys,
  orderedSteps,
  requiredAgentIds,
  requiredSkillIds,
  status,
}) => {
  const details = {}
  const stepMessage = getWorkflowStepValidationMessage(frameworkKeys, orderedSteps)

  if (stepMessage) {
    details.orderedSteps = stepMessage
  }

  const { agents, skills } = await fetchRegistryReferences({
    requiredAgentIds,
    requiredSkillIds,
  })

  const agentById = new Map(agents.map((agent) => [agent.stableId, agent]))
  const skillById = new Map(skills.map((skill) => [skill.stableId, skill]))

  const missingAgentIds = requiredAgentIds.filter((agentId) => !agentById.has(agentId))
  if (missingAgentIds.length > 0) {
    details.requiredAgentIds = `Unknown runtime agent ids: ${missingAgentIds.join(', ')}.`
  }

  const missingSkillIds = requiredSkillIds.filter((skillId) => !skillById.has(skillId))
  if (missingSkillIds.length > 0) {
    details.requiredSkillIds = `Unknown runtime skill ids: ${missingSkillIds.join(', ')}.`
  }

  if (!details.requiredAgentIds) {
    for (const agentId of requiredAgentIds) {
      const agent = agentById.get(agentId)
      const unsupportedFrameworkKey = findUnsupportedFrameworkKey(
        agent?.supportedFrameworkKeys,
        frameworkKeys,
      )

      if (unsupportedFrameworkKey) {
        details.requiredAgentIds =
          `Runtime agent "${agentId}" does not support framework key "${unsupportedFrameworkKey}".`
        break
      }
    }
  }

  if (!details.requiredSkillIds) {
    for (const skillId of requiredSkillIds) {
      const skill = skillById.get(skillId)
      const unsupportedFrameworkKey = findUnsupportedFrameworkKey(
        skill?.supportedFrameworkKeys,
        frameworkKeys,
      )

      if (unsupportedFrameworkKey) {
        details.requiredSkillIds =
          `Runtime skill "${skillId}" does not support framework key "${unsupportedFrameworkKey}".`
        break
      }
    }
  }

  if (
    status === WORKFLOW_POLICY_STATUSES.ACTIVE
    && !details.requiredAgentIds
    && requiredAgentIds.length === 1
  ) {
    const onlyAgent = agentById.get(requiredAgentIds[0])
    if (onlyAgent?.status !== RUNTIME_AGENT_STATUSES.ACTIVE) {
      details.requiredAgentIds =
        `Active workflow policies cannot depend on only inactive runtime agent "${requiredAgentIds[0]}".`
    }
  }

  if (
    status === WORKFLOW_POLICY_STATUSES.ACTIVE
    && !details.requiredSkillIds
    && requiredSkillIds.length === 1
  ) {
    const onlySkill = skillById.get(requiredSkillIds[0])
    if (onlySkill?.status !== RUNTIME_SKILL_STATUSES.ACTIVE) {
      details.requiredSkillIds =
        `Active workflow policies cannot depend on only inactive runtime skill "${requiredSkillIds[0]}".`
    }
  }

  return details
}

export const listWorkflowPolicies = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await WorkflowPolicy.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await WorkflowPolicy.find(filter)
      .sort({ status: 1, updatedAt: -1, key: 1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeWorkflowPolicy(item)),
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

export const createWorkflowPolicy = async (req, res, next) => {
  try {
    const existingWorkflowPolicy = await WorkflowPolicy.findOne({
      key: req.body.key,
    }).select('_id')

    if (existingWorkflowPolicy) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    const validationDetails = await validateWorkflowPolicyReferences(req.body)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const actorUserId = req.context?.userId || req.userId
    const workflowPolicy = new WorkflowPolicy({
      ...req.body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await workflowPolicy.save()
    await populateWorkflowPolicy(workflowPolicy)

    const serializedWorkflowPolicy = serializeWorkflowPolicy(workflowPolicy, {
      fallbackUpdatedBy: buildActorSummary(req),
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_CREATED,
      resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
      resourceId: workflowPolicy._id,
      scope: {
        frameworkKeys: workflowPolicy.frameworkKeys,
      },
      display: { resourceLabel: buildWorkflowPolicyLabel(workflowPolicy) },
      diff: {
        id: workflowPolicy.stableId,
        key: workflowPolicy.key,
        name: workflowPolicy.name,
        description: workflowPolicy.description,
        status: workflowPolicy.status,
        frameworkKeys: workflowPolicy.frameworkKeys,
        orderedSteps: workflowPolicy.orderedSteps,
        requiredAgentIds: workflowPolicy.requiredAgentIds,
        requiredSkillIds: workflowPolicy.requiredSkillIds,
        gatingRules: workflowPolicy.gatingRules,
        stepUpVerified: true,
      },
    })

    return res.status(201).json({
      data: serializedWorkflowPolicy,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateWorkflowPolicyKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
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

export const getWorkflowPolicy = async (req, res, next) => {
  try {
    const workflowPolicy = await WorkflowPolicy.findOne({ stableId: req.params.policyId })

    if (!workflowPolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateWorkflowPolicy(workflowPolicy)

    return res.status(200).json({
      data: serializeWorkflowPolicy(workflowPolicy),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateWorkflowPolicy = async (req, res, next) => {
  try {
    const workflowPolicy = await WorkflowPolicy.findOne({ stableId: req.params.policyId })

    if (!workflowPolicy) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: WORKFLOW_POLICY_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const nextKey = req.body.key ?? workflowPolicy.key
    const duplicateWorkflowPolicy = await WorkflowPolicy.findOne({
      _id: { $ne: workflowPolicy._id },
      key: nextKey,
    }).select('_id')

    if (duplicateWorkflowPolicy) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
      })
    }

    const nextWorkflowPolicy = {
      key: req.body.key ?? workflowPolicy.key,
      name: req.body.name ?? workflowPolicy.name,
      description: req.body.description ?? workflowPolicy.description,
      status: req.body.status ?? workflowPolicy.status,
      frameworkKeys: req.body.frameworkKeys ?? workflowPolicy.frameworkKeys,
      orderedSteps: req.body.orderedSteps ?? workflowPolicy.orderedSteps,
      requiredAgentIds: req.body.requiredAgentIds ?? workflowPolicy.requiredAgentIds,
      requiredSkillIds: req.body.requiredSkillIds ?? workflowPolicy.requiredSkillIds,
      gatingRules: req.body.gatingRules ?? workflowPolicy.gatingRules,
    }

    const validationDetails = await validateWorkflowPolicyReferences(nextWorkflowPolicy)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const diff = {}
    const fields = [
      'key',
      'name',
      'description',
      'status',
      'frameworkKeys',
      'orderedSteps',
      'requiredAgentIds',
      'requiredSkillIds',
      'gatingRules',
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(workflowPolicy[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = {
        from: previousValue,
        to: nextValue,
      }
      workflowPolicy[field] = req.body[field]
    }

    workflowPolicy.updatedBy = req.context?.userId || req.userId
    await workflowPolicy.save()
    await populateWorkflowPolicy(workflowPolicy)

    if (Object.keys(diff).length > 0) {
      diff.stepUpVerified = true
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.WORKFLOW_POLICY_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.WorkflowPolicy,
        resourceId: workflowPolicy._id,
        scope: {
          frameworkKeys: workflowPolicy.frameworkKeys,
        },
        display: { resourceLabel: buildWorkflowPolicyLabel(workflowPolicy) },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeWorkflowPolicy(workflowPolicy, {
        fallbackUpdatedBy: buildActorSummary(req),
      }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateWorkflowPolicyKeyError(err)) {
      return sendConflict(res, req, DUPLICATE_WORKFLOW_POLICY_KEY_MESSAGE, {
        field: 'key',
        reason: 'WORKFLOW_POLICY_KEY_CONFLICT',
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
