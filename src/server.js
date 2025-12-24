import http from 'node:http'
import app from './app.js'
import env from './config/env.js'
import logger from './config/logger.js'
import { connectDb, disconnectDb } from './config/db.js'

const server = http.createServer(app)

const startServer = async () => {
  try {
    await connectDb()
    server.listen(env.port, () => {
      logger.info({ port: env.port }, 'server listening')
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
    await disconnectDb()
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
