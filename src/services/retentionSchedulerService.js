/**
 * Retention Scheduler Service (Phase 5.2)
 *
 * Runs a recurring setInterval job that invokes
 * `gdprService.runRetentionCleanup()` at the cadence configured
 * by `GDPR_CLEANUP_INTERVAL_MS` (default 24 h).
 *
 * Lifecycle:
 *   - `startRetentionScheduler()` — called once in server.js after listen
 *   - `stopRetentionScheduler()`  — called during graceful shutdown
 *
 * The timer is `.unref()`-ed so it does not prevent the process from
 * exiting when all other work is done.
 */

import gdprService from './gdprService.js'
import env from '../config/env.js'
import logger from '../config/logger.js'

let cleanupTimer = null

const executeCleanupJob = async () => {
  try {
    const result = await gdprService.runRetentionCleanup()
    logger.info(
      {
        deletedGdprRequests: result.deletedGdprRequests,
        deletedAuditLogs: result.auditCleanup?.deletedCount || 0,
      },
      'Automated retention cleanup job completed',
    )
  } catch (err) {
    logger.error({ err }, 'Automated retention cleanup job failed')
  }
}

export const startRetentionScheduler = () => {
  if (!env.gdprCleanupEnabled) {
    logger.info('Retention scheduler disabled via GDPR_CLEANUP_ENABLED=false')
    return
  }
  if (cleanupTimer) return

  cleanupTimer = setInterval(executeCleanupJob, env.gdprCleanupIntervalMs)
  cleanupTimer.unref()

  logger.info(
    { intervalMs: env.gdprCleanupIntervalMs },
    'Retention scheduler started',
  )
}

export const stopRetentionScheduler = () => {
  if (!cleanupTimer) return
  clearInterval(cleanupTimer)
  cleanupTimer = null
  logger.info('Retention scheduler stopped')
}
