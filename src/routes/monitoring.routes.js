/**
 * Monitoring Routes
 *
 * Exposes Prometheus metrics for operational monitoring:
 *
 *   GET /metrics   — Prometheus text-format metrics scrape endpoint (SUPER_ADMIN only)
 *
 * Protected by authJwt + loadScopes + requirePlatformRole('SUPER_ADMIN').
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import logger from '../config/logger.js'
import monitoringService from '../services/monitoringService.js'

const router = Router()

router.get('/', authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const payload = await monitoringService.getMetrics()

    res.set('Cache-Control', 'no-store')
    res.set('Content-Type', monitoringService.getMetricsContentType())
    res.status(200).send(payload)
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'metrics endpoint failed')
    res.status(503).json({
      error: {
        code: 'METRICS_UNAVAILABLE',
        message: 'Metrics are currently unavailable.',
        requestId: req.requestId,
      },
    })
  }
})

export default router
