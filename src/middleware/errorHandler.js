/**
 * Centralized Error Handler
 *
 * Catches unhandled errors from route handlers and middleware,
 * returning a structured error envelope that includes the
 * correlation `requestId` for end-to-end tracing.
 *
 * Response shape:
 *   { error: { code, message, requestId } }
 *
 * In non-production environments the stack trace is also included.
 *
 * @module middleware/errorHandler
 */

import env from '../config/env.js'
import logger from '../config/logger.js'

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err)
  }

  const status = err.statusCode || err.status || 500

  const payload = {
    error: {
      code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
      message: status >= 500 ? 'Internal Server Error' : err.message,
      requestId: req.requestId,
    },
  }

  if (!env.isProduction) {
    payload.error.stack = err.stack
  }

  // Use the correlation-enriched child logger when available
  ;(req.log || logger).error(
    { err, requestId: req.requestId },
    'request failed',
  )
  res.status(status).json(payload)
}

export default errorHandler
