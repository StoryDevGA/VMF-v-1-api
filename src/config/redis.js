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
  // Already connected — return existing client
  if (redis && connected) return redis

  // Already attempted and failed — don't retry
  if (attempted && !connected) return null

  attempted = true

  try {
    redis = new Redis(env.redisUrl, {
      password: env.redisPassword || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // In non-production: disable automatic reconnection to stop log spam
      retryStrategy: env.nodeEnv === 'production'
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
    // In production this is fatal; in development we warn and continue
    if (env.nodeEnv === 'production') {
      logger.error({ error }, 'Failed to connect to Redis (production — fatal)')
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