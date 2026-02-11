import http from 'node:http'
import app from './app.js'
import env from './config/env.js'
import logger from './config/logger.js'
import { connectDb, disconnectDb } from './config/db.js'
import { connectRedis, disconnectRedis } from './config/redis.js'
import { runSeeds } from './seeds/index.js'
import { startRetentionScheduler, stopRetentionScheduler } from './services/retentionSchedulerService.js'

const server = http.createServer(app)

server.on('error', (err) => {
  logger.error({ err }, 'server error')
  process.exit(1)
})

const startServer = async () => {
  try {
    // Connect to MongoDB (required)
    await connectDb()

    // Connect to Redis (optional in development)
    await connectRedis()
    
    // Run database seeds if needed
    if (env.nodeEnv === 'development') {
      try {
        logger.info('Running database seeds...')
        await runSeeds()
      } catch (seedErr) {
        logger.warn({ err: seedErr }, 'Database seeding failed (non-fatal in development)')
      }
    }
    
    server.listen(env.port, () => {
      logger.info({ port: env.port }, 'server listening')
      startRetentionScheduler()
    })
  } catch (err) {
    logger.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

const closeServer = () =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })

const shutdown = async (signal) => {
  logger.info({ signal }, 'graceful shutdown start')

  const timeout = setTimeout(() => {
    logger.error('force shutdown due to timeout')
    process.exit(1)
  }, 10000).unref()

  try {
    await closeServer()
    stopRetentionScheduler()
    await disconnectDb()
    await disconnectRedis()
    logger.info('graceful shutdown complete')
    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'shutdown error')
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

startServer()

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
