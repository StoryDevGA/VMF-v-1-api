import { Redis } from 'ioredis'
import env from './env.js'
import logger from './logger.js'

let redis = null
let connected = false
let attempted = false

/**
 * Attempt to connect to Redis.
 * In development, Redis is optional — the server will start without it
 * and token blacklisting / refresh-token storage will degrade gracefully.
 * This function is idempotent — subsequent calls return the existing connection
 * or null if the initial attempt failed.
 */
export const connectRedis = async () => {
  const required = env.nodeEnv === 'production' || env.redisRequired
  // Already connected — return existing client
  if (redis && connected) return redis

  // Already attempted and failed — don't retry
  if (attempted && !connected) {
    if (required) throw new Error('Required Redis connection unavailable')
    return null
  }

  attempted = true

  try {
    redis = new Redis(env.redisUrl, {
      password: env.redisPassword || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Only enable automatic reconnection when Redis is explicitly required
      retryStrategy: required
        ? (times) => Math.min(times * 200, 5000)
        : () => null,
    })

    redis.on('connect', () => {
      connected = true
      logger.info('Redis connected')
    })

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error')
    })

    redis.on('close', () => {
      connected = false
      logger.warn('Redis connection closed')
    })

    await redis.connect()
    return redis
  } catch (error) {
    connected = false
    redis = null
    // Production auth must never start without its revocation store.
    if (required) {
      logger.error({ error }, 'Failed to connect to required Redis')
      throw error
    }
    logger.warn('Redis unavailable — running without Redis. Token blacklisting and refresh-token storage are disabled.')
    return null
  }
}

/**
 * Returns the Redis client, or null if Redis is unavailable.
 * Callers MUST handle a null return gracefully.
 */
export const getRedis = () => {
  if (!redis || !connected) return null
  return redis
}

/** Whether Redis is currently connected */
export const isRedisConnected = () => connected

export const disconnectRedis = async () => {
  if (redis) {
    try { await redis.disconnect() } catch { /* ignore */ }
    redis = null
    connected = false
    logger.info('Redis disconnected')
  }
}
