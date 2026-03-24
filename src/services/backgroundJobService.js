/**
 * Background Job Service (Phase 5.3)
 *
 * Manages recurring background jobs via `jobQueueService`:
 *   - Identity Plus reconciliation  — promotes UNTRUSTED → TRUSTED / REVOKED
 *   - Audit archival                — delegates to auditRetentionService cleanup
 *   - Cache warming                 — re-populates performance caches from DB
 *
 * Lifecycle:
 *   - `startBackgroundJobs()`  — called once in server.js after listen
 *   - `stopBackgroundJobs()`   — called during graceful shutdown
 *   - `runBackgroundJobNow()`  — ad-hoc trigger for testing / admin endpoints
 *
 * All timers are `.unref()`-ed so they do not prevent process exit.
 * Disabled entirely when `BACKGROUND_JOBS_ENABLED=false`.
 */

import env from '../config/env.js'
import logger from '../config/logger.js'
import { User } from '../models/index.js'
import auditRetentionService from './auditRetentionService.js'
import identityPlusService from './identityPlusService.js'
import jobQueueService from './jobQueueService.js'
import performanceCacheService from './performanceCacheService.js'
import vmfRetentionService from './vmfRetentionService.js'

const timers = new Map()
let started = false

const scheduleRecurring = (name, intervalMs, handler) => {
  const safeIntervalMs = Math.max(1000, intervalMs)
  const timer = setInterval(() => {
    jobQueueService.enqueue(name, handler).catch(() => {
      // Errors are logged by the queue service.
    })
  }, safeIntervalMs)
  timer.unref()
  timers.set(name, timer)
}

const runIdentityPlusReconciliationJob = async () => {
  const candidates = await User.find({
    isActive: true,
    'identityPlus.trustStatus': 'UNTRUSTED',
    'identityPlus.externalId': { $exists: true, $ne: null },
  })
    .sort({ updatedAt: -1 })
    .limit(env.identityPlusReconciliationBatchSize)
    .select('_id email isActive identityPlus')
    .lean()

  let promotedCount = 0
  let revokedCount = 0

  for (const candidate of candidates) {
    try {
      const status = await identityPlusService.checkRegistrationStatus({
        externalId: candidate.identityPlus?.externalId,
        email: candidate.email,
      })

      if (status.status === 'REGISTERED') {
        await User.updateOne(
          { _id: candidate._id },
          {
            $set: {
              'identityPlus.trustStatus': 'TRUSTED',
              'identityPlus.trustedAt': status.registeredAt || new Date(),
            },
          },
        )
        await performanceCacheService.invalidateUserPermissions(candidate._id)
        promotedCount += 1
      }

      if (status.status === 'REVOKED') {
        await User.updateOne(
          { _id: candidate._id },
          {
            $set: {
              isActive: false,
              'identityPlus.trustStatus': 'REVOKED',
            },
          },
        )
        await performanceCacheService.invalidateUserPermissions(candidate._id)
        revokedCount += 1
      }
    } catch (err) {
      logger.warn(
        {
          err,
          userId: candidate._id,
        },
        'identity-plus reconciliation failed for user',
      )
    }
  }

  logger.info(
    {
      scanned: candidates.length,
      promotedCount,
      revokedCount,
    },
    'identity-plus reconciliation job completed',
  )
}

const runAuditArchivalJob = async () => {
  const result = await auditRetentionService.runCleanup()
  logger.info(
    {
      expiredCount: result.expiredCount,
      deletedCount: result.deletedCount,
    },
    'audit archival job completed',
  )
}

const runCacheWarmingJob = async () => {
  const result = await performanceCacheService.warmAuthorizationCaches()
  logger.info(result, 'authorization cache warming job completed')
}

const runVmfRetentionPurgeJob = async () => {
  const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs()
  logger.info(result, 'vmf retention purge job completed')
}

export const startBackgroundJobs = () => {
  if (!env.backgroundJobsEnabled) {
    logger.info('background jobs disabled via BACKGROUND_JOBS_ENABLED=false')
    return
  }
  if (started) return

  jobQueueService.start({ concurrency: env.backgroundJobConcurrency })

  scheduleRecurring(
    'identity-plus-reconciliation',
    env.identityPlusReconciliationIntervalMs,
    runIdentityPlusReconciliationJob,
  )
  scheduleRecurring('audit-archival', env.auditArchivalIntervalMs, runAuditArchivalJob)
  scheduleRecurring('cache-warming', env.cacheWarmingIntervalMs, runCacheWarmingJob)
  scheduleRecurring('vmf-retention-purge', env.vmfRetentionPurgeIntervalMs, runVmfRetentionPurgeJob)

  jobQueueService.enqueue('cache-warming-initial', runCacheWarmingJob).catch(() => {
    // Errors are logged by the queue service.
  })

  started = true
  logger.info(
    {
      workerConcurrency: env.backgroundJobConcurrency,
      identityPlusIntervalMs: env.identityPlusReconciliationIntervalMs,
      auditArchivalIntervalMs: env.auditArchivalIntervalMs,
      cacheWarmingIntervalMs: env.cacheWarmingIntervalMs,
      vmfRetentionPurgeIntervalMs: env.vmfRetentionPurgeIntervalMs,
    },
    'background jobs started',
  )
}

export const stopBackgroundJobs = async () => {
  if (!started) return

  for (const timer of timers.values()) {
    clearInterval(timer)
  }
  timers.clear()

  await jobQueueService.stop({ drain: false })
  started = false
  logger.info('background jobs stopped')
}

export const runBackgroundJobNow = async (jobName) => {
  if (jobName === 'identity-plus-reconciliation') {
    return jobQueueService.enqueue(jobName, runIdentityPlusReconciliationJob)
  }
  if (jobName === 'audit-archival') {
    return jobQueueService.enqueue(jobName, runAuditArchivalJob)
  }
  if (jobName === 'cache-warming') {
    return jobQueueService.enqueue(jobName, runCacheWarmingJob)
  }
  if (jobName === 'vmf-retention-purge') {
    return jobQueueService.enqueue(jobName, runVmfRetentionPurgeJob)
  }
  throw new Error(`Unknown background job: ${jobName}`)
}
