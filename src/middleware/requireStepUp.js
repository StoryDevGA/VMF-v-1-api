import crypto from 'crypto'
import { getRedis } from '../config/redis.js'
import auditService from '../services/auditService.js'

const buildStepUpScope = (req) => {
  const scope = {}

  if (req.params?.customerId) scope.customerId = req.params.customerId
  if (req.params?.tenantId) scope.tenantId = req.params.tenantId
  if (req.params?.vmfId) scope.vmfId = req.params.vmfId
  if (req.body?.frameworkKey) scope.frameworkKey = String(req.body.frameworkKey).trim().toUpperCase()
  if (Array.isArray(req.body?.frameworkKeys) && req.body.frameworkKeys.length > 0) {
    scope.frameworkKeys = [...new Set(
      req.body.frameworkKeys
        .map((frameworkKey) => String(frameworkKey || '').trim().toUpperCase())
        .filter(Boolean),
    )]
  }

  return scope
}

const logStepUpDenied = async (req, reason, code) => {
  const userId = req.context?.userId || req.userId
  if (!userId) return

  try {
    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
      resourceType: auditService.RESOURCE_TYPES.User,
      resourceId: userId,
      scope: buildStepUpScope(req),
      diff: {
        requiredPermission: 'STEP_UP_AUTHENTICATION',
        path: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
        method: req.method,
        surface: 'requireStepUp',
        reason,
        code,
      },
    })
  } catch (_err) {
    // Step-up denial logging must never block the response path.
  }
}

const requireStepUp = async (req, res, next) => {
  const rawToken = req.headers['x-step-up-token']
  if (!rawToken) {
    await logStepUpDenied(req, 'missing_step_up_token', 'STEP_UP_REQUIRED')
    return res.status(403).json({
      error: {
        code: 'STEP_UP_REQUIRED',
        message: 'Step-up authentication is required for this action.',
        requestId: req.requestId,
      },
    })
  }

  const userId = req.context?.userId || req.userId
  const redis = getRedis()
  if (!redis) {
    await logStepUpDenied(req, 'step_up_service_unavailable', 'STEP_UP_UNAVAILABLE')
    return res.status(503).json({
      error: {
        code: 'STEP_UP_UNAVAILABLE',
        message: 'Step-up verification service unavailable.',
        requestId: req.requestId,
      },
    })
  }

  const hash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const key = `stepup:${userId}:${hash}`

  const valid = await redis.get(key)
  if (!valid) {
    await logStepUpDenied(req, 'invalid_or_expired_step_up_token', 'STEP_UP_INVALID')
    return res.status(403).json({
      error: {
        code: 'STEP_UP_INVALID',
        message: 'Step-up token is invalid or expired. Please re-authenticate.',
        requestId: req.requestId,
      },
    })
  }

  await redis.del(key)
  return next()
}

export default requireStepUp
