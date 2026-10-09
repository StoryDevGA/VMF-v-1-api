import RuntimeValidationAudit from '../models/RuntimeValidationAudit.js'
import { validateRuntimeOperation } from '../services/runtimeValidation/runtimeValidationEngine.js'
import { resolveVE02RuntimeContext } from '../services/runtimeValidation/ve02RuntimeContextResolver.js'
import { prepareVE02AssessmentDraft } from '../services/runtimeValidation/ve02AssessmentDraft.js'
import { prepareVE02SyntheticAssessment } from '../services/runtimeValidation/ve02SyntheticAssessment.js'
import { prepareVE02NativeAssessment } from '../services/runtimeValidation/ve02NativeAssessment.js'
import { executeVE02LocalAssessment } from '../services/runtimeValidation/ve02LocalAssessment.js'

const STATUS_VALUES = new Set(['PASS', 'WARN', 'FAIL'])
const RESULT_VALUES = new Set(['ALLOW', 'BLOCK', 'AUDIT_ONLY'])

const deriveActorId = (req) =>
  String(req.context?.userId || req.userId || req.user?._id || req.user?.id || '').trim()

const deriveAuditStatus = (plain = {}) => {
  const status = String(plain.status || '').trim().toUpperCase()
  if (STATUS_VALUES.has(status)) return status

  const legacyResult = String(plain.result || '').trim().toUpperCase()
  if (STATUS_VALUES.has(legacyResult)) return legacyResult

  return 'PASS'
}

const deriveAuditResult = (plain = {}) => {
  const result = String(plain.result || '').trim().toUpperCase()
  if (RESULT_VALUES.has(result)) return result

  const status = deriveAuditStatus(plain)
  if (status === 'FAIL') return 'BLOCK'
  return 'ALLOW'
}

const serializeRuntimeValidationAudit = (audit) => {
  if (!audit) return null
  const plain = typeof audit.toJSON === 'function' ? audit.toJSON() : { ...audit }
  const status = deriveAuditStatus(plain)
  const result = deriveAuditResult(plain)
  return {
    id: String(plain.id || plain._id || ''),
    validationCode: plain.validationCode || '',
    severity: plain.severity || 'INFO',
    operationType: plain.operationType || '',
    runtimePath: plain.runtimePath || '',
    actorId: plain.actorId || '',
    actorType: plain.actorType || 'USER',
    packageId: plain.packageId || '',
    frameworkKey: plain.frameworkKey || '',
    workspaceId: plain.workspaceId || '',
    status,
    result,
    mode: plain.mode || 'STRICT',
    message: plain.message || '',
    issues: Array.isArray(plain.issues) ? plain.issues : [],
    summary: plain.summary || {},
    beforeState: plain.beforeState ?? null,
    afterState: plain.afterState ?? null,
    packageResolved: plain.packageResolved !== false,
    ...(plain.ve02Receipt ? { ve02Receipt: plain.ve02Receipt } : {}),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  }
}

const buildIssueDetails = (issues = []) => issues.reduce((details, issue, index) => {
  const key = issue.path || issue.code || `issue_${index + 1}`
  return {
    ...details,
    [key]: issue.message,
  }
}, {})

const prepareAssessmentEndpoint = (prepare, selectInput, exposeVE02Reason = false) => async (req, res, next) => {
  try {
    const selected = selectInput(req.body)
    const data = await prepare({ input: req.body, scopes: {
      ...req.scopes,
      customer: { ...req.scopes?.customer, _id: selected.customerId },
      tenant: { ...req.scopes?.tenant, _id: selected.tenantId, customerId: selected.customerId },
    } })
    return res.status(200).json({ data, meta: { requestId: req.requestId } })
  } catch (error) {
    if (exposeVE02Reason && /^VE02_[A-Z_]+$/.test(error.code || '')
      && [403, 409, 422].includes(error.status)) {
      return res.status(error.status).json({ error: {
        code: error.status === 403 ? 'FORBIDDEN' : error.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED',
        message: 'Native synthetic VE02 assessment cannot proceed.',
        details: { reason: error.code }, requestId: req.requestId,
      } })
    }
    return next(error)
  }
}
export const prepareVE02AssessmentDraftEndpoint = prepareAssessmentEndpoint(prepareVE02AssessmentDraft, (input) => input)
export const prepareVE02SyntheticAssessmentEndpoint = prepareAssessmentEndpoint(prepareVE02SyntheticAssessment, (input) => input.draft)
export const prepareVE02NativeAssessmentEndpoint = prepareAssessmentEndpoint(prepareVE02NativeAssessment, (input) => input, true)
export const executeVE02LocalAssessmentEndpoint = async (req, res, next) => {
  try {
    const data = await executeVE02LocalAssessment({ input: req.body, actorId: deriveActorId(req), requestId: req.requestId,
      scopes: { ...req.scopes, customer: { ...req.scopes?.customer, _id: req.body.customerId },
        tenant: { ...req.scopes?.tenant, _id: req.body.tenantId, customerId: req.body.customerId } } })
    return res.status(data.executionEligible ? 200 : 422).json({ data, meta: { requestId: req.requestId } })
  } catch (error) {
    if (/^VE02_[A-Z_]+$/.test(error.code || '') && [403, 409, 422].includes(error.status)) {
      return res.status(error.status).json({ error: { code: error.code,
        message: 'Provisional VE02 assessment cannot proceed.', requestId: req.requestId } })
    }
    return next(error)
  }
}

export const validateRuntimeOperationEndpoint = async (req, res, next) => {
  try {
    const validation = await validateRuntimeOperation({
      ...req.body,
      actorId: deriveActorId(req),
      actorType: req.body.actorType || 'USER',
      requestId: req.requestId,
    }, { resolveVE02Context: req.body.runtimeInstanceId ? (input, { session }) => resolveVE02RuntimeContext({
      input, session, scopes: {
        ...req.scopes,
        customer: { ...req.scopes?.customer, _id: req.body.customerId || req.scopes?.customer?._id },
        tenant: { ...req.scopes?.tenant, _id: req.body.tenantId || req.scopes?.tenant?._id,
          customerId: req.body.customerId || req.scopes?.customer?._id },
      },
    }) : undefined })

    if (validation.result === 'BLOCK') {
      return res.status(422).json({
        error: {
          code: 'RUNTIME_VALIDATION_FAILED',
          message: validation.message,
          details: buildIssueDetails(validation.issues),
          validation,
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: validation,
      meta: {
        requestId: req.requestId,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const getRuntimeValidationHistory = async (req, res, next) => {
  try {
    const { packageId } = req.params
    const { page = 1, pageSize = 20 } = req.query
    const filter = { packageId }
    const skip = (page - 1) * pageSize

    const [rows, total] = await Promise.all([
      RuntimeValidationAudit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      RuntimeValidationAudit.countDocuments(filter),
    ])

    return res.status(200).json({
      data: rows.map(serializeRuntimeValidationAudit),
      meta: {
        page,
        pageSize,
        total,
        requestId: req.requestId,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const getRuntimeValidationAudit = async (req, res, next) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      workspaceId: workspaceIdQuery,
      packageId,
      frameworkKey,
      result,
      status,
      severity,
      operationType,
      runtimePath,
    } = req.query
    const workspaceId = req.params?.workspaceId || workspaceIdQuery
    const filter = {}
    if (workspaceId) filter.workspaceId = workspaceId
    if (packageId) filter.packageId = packageId
    if (frameworkKey) filter.frameworkKey = frameworkKey
    if (status) filter.status = status
    if (result) {
      if (STATUS_VALUES.has(result)) filter.status = result
      if (RESULT_VALUES.has(result)) filter.result = result
    }
    if (severity) filter.severity = severity
    if (operationType) filter.operationType = operationType
    if (runtimePath) filter.runtimePath = runtimePath

    const skip = (page - 1) * pageSize
    const [rows, total] = await Promise.all([
      RuntimeValidationAudit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      RuntimeValidationAudit.countDocuments(filter),
    ])

    return res.status(200).json({
      data: rows.map(serializeRuntimeValidationAudit),
      meta: {
        page,
        pageSize,
        total,
        requestId: req.requestId,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const __testables = {
  serializeRuntimeValidationAudit,
  buildIssueDetails,
}
