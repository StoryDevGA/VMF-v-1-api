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

// Public application codes owned by the shared HTTP boundary. Driver codes are never forwarded.
const publicRequestCodes = new Set([
  'BAD_REQUEST', 'REQUEST_ERROR', 'VALIDATION_FAILED', 'UNAUTHENTICATED',
  'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMIT_EXCEEDED',
  'CUSTOMER_INACTIVE', 'TENANT_DISABLED', 'STEP_UP_REQUIRED', 'STEP_UP_INVALID',
  'TENANT_ADMIN_REQUIRED', 'PAYLOAD_TOO_LARGE',
])

export const normalizeHttpError = (err) => {
  const candidate = err?.statusCode ?? err?.status
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500
  const code = status >= 500 ? 'INTERNAL_ERROR'
    : publicRequestCodes.has(err?.code) ? err.code : 'REQUEST_ERROR'
  return {
    status,
    code,
    message: status >= 500 ? 'Internal Server Error'
      : typeof err?.message === 'string' ? err.message : 'Request failed',
  }
}

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err)
  }

  const { status, code, message } = normalizeHttpError(err)

  const payload = {
    error: {
      code,
      message,
      requestId: req.requestId,
    },
  }

  if (!env.isProduction) {
    payload.error.stack = err?.stack
  }

  // Use the correlation-enriched child logger when available
  ;(req.log || logger).error(
    { err, requestId: req.requestId },
    'request failed',
  )
  res.status(status).json(payload)
}

export default errorHandler
