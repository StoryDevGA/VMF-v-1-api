/**
 * Monitoring Routes
 *
 * Exposes Prometheus metrics for operational monitoring:
 *
 *   GET /metrics   — Prometheus text-format metrics scrape endpoint
 *
 * Protected by authJwt + loadScopes + requirePlatformPermission('SYSTEM_HEALTH_VIEW').
 */

import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformPermission } from '../middleware/authorize.js'
import logger from '../config/logger.js'
import monitoringService from '../services/monitoringService.js'

const router = Router()

router.get('/', authJwt, loadScopes, requirePlatformPermission('SYSTEM_HEALTH_VIEW'), async (req, res) => {
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
