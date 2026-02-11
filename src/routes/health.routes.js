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
import monitoringService from '../services/monitoringService.js'

const router = Router()

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

export default router
