/**
 * Health Routes
 *
 * Public and authenticated health check endpoints:
 *
 *   GET /health           — Public liveness probe (status, version, uptime)
 *   GET /health/detailed   — Authenticated deep health check (SUPER_ADMIN only)
 *                            Includes database, Redis, Identity Plus status,
 *                            performance metrics, active alerts, and thresholds.
 *                            Returns 503 when overall status is 'unhealthy'.
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import logger from '../config/logger.js'
import env from '../config/env.js'
import monitoringService from '../services/monitoringService.js'

const router = Router()

const DURATION_UNITS_MS = Object.freeze({
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
})

const parseDurationMs = (rawValue, fallbackMs) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallbackMs
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return Math.max(1, Math.floor(rawValue))
  const value = String(rawValue).trim().toLowerCase()
  if (/^\d+$/.test(value)) return Math.max(1, Number.parseInt(value, 10))
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) return null
  const quantity = Number.parseInt(match[1], 10)
  const unit = match[2]
  return quantity * DURATION_UNITS_MS[unit]
}

const parsePositiveInt = (rawValue, fallbackValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallbackValue
  const parsed = Number.parseInt(String(rawValue), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const validationError = (req, res, message) =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      requestId: req.requestId,
    },
  })

router.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(200).json(monitoringService.getPublicHealth())
})

router.get('/detailed', authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const health = await monitoringService.getDetailedHealth()
    const statusCode = health.status === 'unhealthy' ? 503 : 200

    res.set('Cache-Control', 'no-store')
    res.status(statusCode).json(health)
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'health.detailed failed')
    res.status(503).json({
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Detailed health check failed.',
        requestId: req.requestId,
      },
    })
  }
})

router.get('/trends', authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), (req, res) => {
  const windowMs = parseDurationMs(req.query.window, env.monitoringTrendDefaultWindowMs)
  const bucketMs = parseDurationMs(req.query.bucket, env.monitoringTrendDefaultBucketMs)

  if (!windowMs || !bucketMs) {
    return validationError(
      req,
      res,
      "Invalid query parameters. Use durations like '15m', '1h', or milliseconds.",
    )
  }
  if (windowMs > env.monitoringHistoryRetentionMs) {
    return validationError(
      req,
      res,
      `window must be <= ${env.monitoringHistoryRetentionMs} milliseconds.`,
    )
  }
  if (bucketMs > windowMs) {
    return validationError(req, res, 'bucket must be less than or equal to window.')
  }
  if (windowMs / bucketMs > 720) {
    return validationError(req, res, 'Requested resolution is too fine; please use a larger bucket.')
  }

  const payload = monitoringService.getTrends({ windowMs, bucketMs })
  res.set('Cache-Control', 'no-store')
  res.status(200).json(payload)
})

router.get('/alerts', authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), (req, res) => {
  const status = req.query.status ? String(req.query.status).toLowerCase() : 'all'
  if (!['all', 'active', 'resolved'].includes(status)) {
    return validationError(req, res, "status must be one of: 'all', 'active', 'resolved'.")
  }

  const limit = parsePositiveInt(req.query.limit, 100)
  if (!limit || limit > 500) {
    return validationError(req, res, 'limit must be a positive integer up to 500.')
  }

  const payload = monitoringService.getAlertLifecycle({ status, limit })
  res.set('Cache-Control', 'no-store')
  res.status(200).json(payload)
})

export default router
