import { isDeepStrictEqual } from 'node:util'
import crypto from 'node:crypto'
import RuntimeAgent from '../models/RuntimeAgent.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'

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
    const validationDetails = await validateRuntimeAgentFrameworkKeys(req.body.supportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
    }

    const existingRuntimeAgent = await RuntimeAgent.findOne({
      key: req.body.key,
    }).select('_id')

    if (existingRuntimeAgent) {
      return sendConflict(res, req, DUPLICATE_RUNTIME_AGENT_KEY_MESSAGE, {
        field: 'key',
        reason: 'RUNTIME_AGENT_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const runtimeAgent = new RuntimeAgent({
      ...req.body,
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
        supportedWorkflows: runtimeAgent.supportedWorkflows,
        supportedFrameworkKeys: runtimeAgent.supportedFrameworkKeys,
        defaultSkillIds: runtimeAgent.defaultSkillIds,
        primarySkillIds: runtimeAgent.primarySkillIds,
        optionalSkillIds: runtimeAgent.optionalSkillIds,
        promptConfig: runtimeAgent.promptConfig,
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
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

export const updateRuntimeAgent = async (req, res, next) => {
  try {
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const nextKey = req.body.key ?? runtimeAgent.key
    const nextSupportedFrameworkKeys =
      req.body.supportedFrameworkKeys ?? runtimeAgent.supportedFrameworkKeys

    const validationDetails = await validateRuntimeAgentFrameworkKeys(nextSupportedFrameworkKeys)
    if (Object.keys(validationDetails).length > 0) {
      return sendValidationFailed(res, req, validationDetails)
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
      'supportedWorkflows',
      'supportedFrameworkKeys',
      'defaultSkillIds',
      'primarySkillIds',
      'optionalSkillIds',
      'promptConfig',
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await populateRuntimeAgent(runtimeAgent)

    const { errors, warnings } = await validateRuntimeAgentDocument(runtimeAgent)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const frameworkKey = String(body.frameworkKey ?? '').trim().toUpperCase()
    const workflowKey = String(body.workflowKey ?? '').trim().toLowerCase()
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
    const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {}

    if (frameworkKey) {
      const frameworks = Array.isArray(runtimeAgent.supportedFrameworkKeys) ? runtimeAgent.supportedFrameworkKeys : []
      if (!frameworks.includes(frameworkKey)) {
        errors.frameworkKey = `Agent does not support framework key "${frameworkKey}".`
      }
    }

    if (workflowKey) {
      const workflows = Array.isArray(runtimeAgent.supportedWorkflows) ? runtimeAgent.supportedWorkflows : []
      if (!workflows.includes(workflowKey)) {
        errors.workflowKey = `Agent does not support workflow key "${workflowKey}".`
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
        ...(workflowKey ? { workflowKey } : {}),
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
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
    const runtimeAgent = await RuntimeAgent.findOne({ stableId: req.params.agentId })

    if (!runtimeAgent) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: RUNTIME_AGENT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
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
