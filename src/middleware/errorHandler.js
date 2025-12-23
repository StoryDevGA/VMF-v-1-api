import env from '../config/env.js'
import logger from '../config/logger.js'

const errorHandler = (err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500
  const payload = {
    error: status >= 500 ? 'Internal Server Error' : err.message,
  }

  if (!env.isProduction) {
    payload.stack = err.stack
  }

  logger.error({ err }, 'request failed')
  res.status(status).json(payload)
}

export default errorHandler
