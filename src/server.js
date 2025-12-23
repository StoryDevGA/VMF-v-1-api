import http from 'node:http'
import app from './app.js'
import env from './config/env.js'
import logger from './config/logger.js'

const server = http.createServer(app)

server.listen(env.port, () => {
  logger.info({ port: env.port }, 'server listening')
})

const shutdown = (signal) => {
  logger.info({ signal }, 'graceful shutdown start')
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'shutdown error')
      process.exit(1)
    }

    logger.info('graceful shutdown complete')
    process.exit(0)
  })

  setTimeout(() => {
    logger.error('force shutdown due to timeout')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
