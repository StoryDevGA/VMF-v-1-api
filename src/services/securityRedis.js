import env from '../config/env.js'
import { getRedis } from '../config/redis.js'

// Optional Redis is a development convenience, never a production auth fallback.
export const getSecurityRedis = () => {
  const redis = getRedis()
  if (!redis && (env.nodeEnv === 'production' || env.redisRequired)) {
    const error = new Error('Security storage unavailable')
    error.statusCode = 503
    throw error
  }
  return redis
}
