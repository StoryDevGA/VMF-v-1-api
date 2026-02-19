import crypto from 'crypto'
import { getRedis } from '../config/redis.js'

const requireStepUp = async (req, res, next) => {
  const rawToken = req.headers['x-step-up-token']
  if (!rawToken) {
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
