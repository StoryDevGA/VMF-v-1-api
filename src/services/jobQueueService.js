/**
 * Job Queue Service (Phase 5.3)
 *
 * In-process async job queue with configurable concurrency.
 * Jobs are enqueued as `{ name, handler, payload }` and processed FIFO.
 *
 * Provides:
 *   - `enqueue(name, handler, payload)` — returns a Promise that resolves/rejects with the handler result
 *   - `start({ concurrency })`          — begins processing
 *   - `stop({ drain })`                 — halts processing (optionally drains remaining jobs)
 *   - `getState()`                       — snapshot for health checks
 *   - `resetForTests()`                  — clears queue and resets state
 */

import { randomUUID } from 'node:crypto'
import env from '../config/env.js'
import logger from '../config/logger.js'

const queue = []
let isRunning = false
let workerConcurrency = 1
let activeWorkers = 0

const processQueue = () => {
  while (isRunning && activeWorkers < workerConcurrency && queue.length > 0) {
    const job = queue.shift()
    runJob(job)
  }
}

const runJob = async (job) => {
  activeWorkers += 1
  const startedAt = Date.now()

  try {
    const result = await job.handler(job.payload)
    job.resolve(result)
    logger.debug(
      {
        jobId: job.id,
        jobName: job.name,
        durationMs: Date.now() - startedAt,
      },
      'background job completed',
    )
  } catch (err) {
    job.reject(err)
    logger.error(
      {
        err,
        jobId: job.id,
        jobName: job.name,
        durationMs: Date.now() - startedAt,
      },
      'background job failed',
    )
  } finally {
    activeWorkers -= 1
    setImmediate(processQueue)
  }
}

const enqueue = (name, handler, payload = {}) =>
  new Promise((resolve, reject) => {
    queue.push({
      id: randomUUID(),
      name,
      handler,
      payload,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    })
    processQueue()
  })

const start = ({ concurrency = env.backgroundJobConcurrency } = {}) => {
  if (isRunning) return
  isRunning = true
  workerConcurrency = Math.max(1, concurrency)
  processQueue()
  logger.info({ workerConcurrency }, 'background job queue started')
}

const stop = async ({ drain = false } = {}) => {
  isRunning = false

  if (!drain) {
    queue.length = 0
    logger.info('background job queue stopped')
    return
  }

  await new Promise((resolve) => {
    const check = () => {
      if (queue.length === 0 && activeWorkers === 0) {
        resolve()
        return
      }
      setTimeout(check, 25).unref()
    }
    check()
  })

  logger.info('background job queue drained and stopped')
}

const getState = () => ({
  isRunning,
  workerConcurrency,
  activeWorkers,
  queuedJobs: queue.length,
})

const resetForTests = () => {
  queue.length = 0
  isRunning = false
  workerConcurrency = 1
  activeWorkers = 0
}

const jobQueueService = {
  enqueue,
  start,
  stop,
  getState,
  resetForTests,
}

export default jobQueueService
