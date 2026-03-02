/**
 * Monitoring Service (Phase 5.1)
 *
 * Provides:
 *   - Prometheus registry + HTTP performance metrics
 *   - Rolling performance statistics for detailed health checks
 *   - Dependency health checks (MongoDB, Redis, Identity Plus circuit breaker)
 *   - Threshold-based alert evaluation
 */

import mongoose from 'mongoose'
import client from 'prom-client'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import env from '../config/env.js'
import { getRedis, isRedisConnected } from '../config/redis.js'
import { getCircuitBreakerState } from './identityPlusService.js'

const register = new client.Registry()
register.setDefaultLabels({
  service: 'vmf-v-1-api',
  environment: env.nodeEnv,
})

client.collectDefaultMetrics({
  register,
  prefix: env.metricsPrefix,
})

const httpRequestsTotal = new client.Counter({
  name: `${env.metricsPrefix}http_requests_total`,
  help: 'Total HTTP requests processed.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

const httpRequestDurationSeconds = new client.Histogram({
  name: `${env.metricsPrefix}http_request_duration_seconds`,
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [register],
})

const httpInFlightRequests = new client.Gauge({
  name: `${env.metricsPrefix}http_in_flight_requests`,
  help: 'Current number of in-flight HTTP requests.',
  registers: [register],
})

const eventLoopLagGauge = new client.Gauge({
  name: `${env.metricsPrefix}event_loop_lag_ms`,
  help: 'Event loop lag p95 in milliseconds.',
  registers: [register],
})

const healthStatusGauge = new client.Gauge({
  name: `${env.metricsPrefix}health_status`,
  help: 'Overall health status (1 healthy, 0 degraded, -1 unhealthy).',
  registers: [register],
})

const activeAlertsGauge = new client.Gauge({
  name: `${env.metricsPrefix}health_active_alerts`,
  help: 'Number of currently active health alerts.',
  registers: [register],
})

const governanceInactiveCustomerBlocksTotal = new client.Counter({
  name: `${env.metricsPrefix}governance_inactive_customer_blocks_total`,
  help: 'Total inactive-customer enforcement blocks.',
  labelNames: ['surface'],
  registers: [register],
})

const governanceLimitRejectionsTotal = new client.Counter({
  name: `${env.metricsPrefix}governance_limit_rejections_total`,
  help: 'Total tenant/vmf governance limit rejections.',
  labelNames: ['limit_type', 'surface'],
  registers: [register],
})

const governanceOnboardingTransactionFailuresTotal = new client.Counter({
  name: `${env.metricsPrefix}governance_onboarding_transaction_failures_total`,
  help: 'Total onboarding transaction failures.',
  labelNames: ['failure_type'],
  registers: [register],
})

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 })
eventLoopMonitor.enable()

const requestSamples = []
const alertLifecycle = new Map()
let inFlightRequests = 0
const governanceEventTotals = {
  inactiveCustomerBlocks: 0,
  limitRejections: 0,
  onboardingTransactionFailures: 0,
}

const HEALTH_VALUE = {
  healthy: 1,
  degraded: 0,
  unhealthy: -1,
}

const safeNowIso = () => new Date().toISOString()

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(digits))
}

const normalizeMetricLabel = (value, fallback = 'unknown') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || fallback
}

const pruneSamples = (now = Date.now()) => {
  const floor = now - env.monitoringHistoryRetentionMs
  while (requestSamples.length > 0 && requestSamples[0].ts < floor) {
    requestSamples.shift()
  }
  const overflow = requestSamples.length - env.monitoringHistoryMaxSamples
  if (overflow > 0) {
    requestSamples.splice(0, overflow)
  }
}

const percentile = (values, p) => {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

const withTimeout = async (promise, timeoutMs) => {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const getEventLoopLagP95Ms = () => {
  const ns = eventLoopMonitor.percentile(95)
  if (!Number.isFinite(ns)) return 0
  return ns / 1_000_000
}

const getPerformanceSnapshot = () => {
  const now = Date.now()
  pruneSamples(now)

  const windowFloor = now - env.monitoringWindowMs
  const oneMinuteAgo = now - 60_000
  let requestsPerMinute = 0
  let errorCount = 0
  let total = 0
  const durations = []

  for (const sample of requestSamples) {
    if (sample.ts < windowFloor) continue
    total += 1
    if (sample.ts >= oneMinuteAgo) requestsPerMinute += 1
    if (sample.statusCode >= 500) errorCount += 1
    durations.push(sample.durationMs)
  }

  const p95ResponseTimeMs = percentile(durations, 95)
  const avgResponseTimeMs =
    durations.length === 0 ? 0 : durations.reduce((sum, ms) => sum + ms, 0) / durations.length
  const errorRate = total === 0 ? 0 : errorCount / total
  const eventLoopLagMs = getEventLoopLagP95Ms()
  const memory = process.memoryUsage()
  const heapUsagePercent =
    memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) * 100 : 0

  eventLoopLagGauge.set(eventLoopLagMs)

  return {
    activeConnections: inFlightRequests,
    requestsPerMinute,
    errorRate: round(errorRate, 4),
    avgResponseTimeMs: round(avgResponseTimeMs),
    p95ResponseTimeMs: round(p95ResponseTimeMs),
    eventLoopLagMs: round(eventLoopLagMs),
    heapUsagePercent: round(heapUsagePercent),
    inactiveCustomerBlocks: governanceEventTotals.inactiveCustomerBlocks,
    governanceLimitRejections: governanceEventTotals.limitRejections,
    onboardingTransactionFailures: governanceEventTotals.onboardingTransactionFailures,
  }
}

const evaluateAlerts = (metrics) => {
  const alerts = []

  if (metrics.p95ResponseTimeMs > env.monitoringLatencyP95ThresholdMs) {
    alerts.push({
      code: 'HIGH_P95_LATENCY',
      severity: 'warning',
      metric: 'p95ResponseTimeMs',
      threshold: env.monitoringLatencyP95ThresholdMs,
      value: metrics.p95ResponseTimeMs,
      message: '95th percentile latency exceeds threshold.',
    })
  }

  if (metrics.errorRate > env.monitoringErrorRateThreshold) {
    alerts.push({
      code: 'HIGH_ERROR_RATE',
      severity: 'critical',
      metric: 'errorRate',
      threshold: env.monitoringErrorRateThreshold,
      value: metrics.errorRate,
      message: 'Server error rate exceeds threshold.',
    })
  }

  if (metrics.eventLoopLagMs > env.monitoringEventLoopLagThresholdMs) {
    alerts.push({
      code: 'HIGH_EVENT_LOOP_LAG',
      severity: 'warning',
      metric: 'eventLoopLagMs',
      threshold: env.monitoringEventLoopLagThresholdMs,
      value: metrics.eventLoopLagMs,
      message: 'Event loop lag exceeds threshold.',
    })
  }

  if (metrics.heapUsagePercent > env.monitoringHeapUsageThresholdPct) {
    alerts.push({
      code: 'HIGH_HEAP_USAGE',
      severity: 'warning',
      metric: 'heapUsagePercent',
      threshold: env.monitoringHeapUsageThresholdPct,
      value: metrics.heapUsagePercent,
      message: 'Heap usage exceeds threshold.',
    })
  }

  return alerts
}

const reconcileAlertLifecycle = (alerts, nowIso) => {
  const activeCodes = new Set(alerts.map((alert) => alert.code))

  for (const alert of alerts) {
    const existing = alertLifecycle.get(alert.code)
    const base = {
      code: alert.code,
      severity: alert.severity,
      metric: alert.metric,
      threshold: alert.threshold,
      message: alert.message,
      value: alert.value,
    }

    if (!existing || existing.status === 'resolved') {
      alertLifecycle.set(alert.code, {
        ...base,
        status: 'active',
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        resolvedAt: null,
        timesTriggered: 1,
      })
      continue
    }

    alertLifecycle.set(alert.code, {
      ...existing,
      ...base,
      status: 'active',
      lastSeenAt: nowIso,
      resolvedAt: null,
      timesTriggered: (existing.timesTriggered || 0) + 1,
    })
  }

  for (const [code, state] of alertLifecycle.entries()) {
    if (state.status === 'active' && !activeCodes.has(code)) {
      alertLifecycle.set(code, {
        ...state,
        status: 'resolved',
        resolvedAt: nowIso,
        lastSeenAt: nowIso,
      })
    }
  }
}

const pruneAlertLifecycle = (now = Date.now()) => {
  const floor = now - env.monitoringAlertRetentionMs
  for (const [code, state] of alertLifecycle.entries()) {
    if (state.status !== 'resolved' || !state.resolvedAt) continue
    const resolvedAtMs = Date.parse(state.resolvedAt)
    if (Number.isNaN(resolvedAtMs)) continue
    if (resolvedAtMs < floor) {
      alertLifecycle.delete(code)
    }
  }
}

const checkDatabase = async () => {
  const started = process.hrtime.bigint()
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1_000_000

  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      status: 'unhealthy',
      responseTime: round(elapsedMs()),
      details: 'MongoDB is not connected.',
    }
  }

  try {
    await withTimeout(mongoose.connection.db.admin().ping(), 1500)
    return {
      status: 'healthy',
      responseTime: round(elapsedMs()),
    }
  } catch (err) {
    return {
      status: 'unhealthy',
      responseTime: round(elapsedMs()),
      details: err.message || 'MongoDB ping failed.',
    }
  }
}

const checkRedis = async () => {
  const started = process.hrtime.bigint()
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1_000_000

  if (!isRedisConnected()) {
    return {
      status: env.redisRequired ? 'unhealthy' : 'degraded',
      responseTime: round(elapsedMs()),
      details: env.redisRequired
        ? 'Redis is required but not connected.'
        : 'Redis is optional and currently unavailable.',
    }
  }

  const redis = getRedis()
  if (!redis) {
    return {
      status: env.redisRequired ? 'unhealthy' : 'degraded',
      responseTime: round(elapsedMs()),
      details: 'Redis client is unavailable.',
    }
  }

  try {
    await withTimeout(redis.ping(), 1500)
    return {
      status: 'healthy',
      responseTime: round(elapsedMs()),
    }
  } catch (err) {
    return {
      status: env.redisRequired ? 'unhealthy' : 'degraded',
      responseTime: round(elapsedMs()),
      details: err.message || 'Redis ping failed.',
    }
  }
}

const checkIdentityPlus = async () => {
  const started = process.hrtime.bigint()
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1_000_000
  const breaker = getCircuitBreakerState()

  if (!env.identityPlusApiUrl) {
    return {
      status: 'degraded',
      responseTime: round(elapsedMs()),
      details: 'Identity Plus API URL is not configured (mock mode).',
      circuitBreaker: breaker.state,
    }
  }

  if (breaker.state === 'OPEN') {
    return {
      status: 'unhealthy',
      responseTime: round(elapsedMs()),
      details: 'Identity Plus circuit breaker is OPEN.',
      circuitBreaker: breaker.state,
    }
  }

  if (breaker.state === 'HALF_OPEN') {
    return {
      status: 'degraded',
      responseTime: round(elapsedMs()),
      details: 'Identity Plus circuit breaker is HALF_OPEN.',
      circuitBreaker: breaker.state,
    }
  }

  return {
    status: 'healthy',
    responseTime: round(elapsedMs()),
    circuitBreaker: breaker.state,
  }
}

const computeOverallStatus = (services, alerts) => {
  const states = Object.values(services).map((svc) => svc.status)
  if (states.includes('unhealthy')) return 'unhealthy'
  if (states.includes('degraded')) return 'degraded'
  if (alerts.length > 0) return 'degraded'
  return 'healthy'
}

const buildTrends = ({ windowMs, bucketMs }) => {
  const now = Date.now()
  pruneSamples(now)

  const floor = now - windowMs
  const bucketMap = new Map()

  for (const sample of requestSamples) {
    if (sample.ts < floor) continue
    const bucketStartMs = Math.floor(sample.ts / bucketMs) * bucketMs
    const bucket = bucketMap.get(bucketStartMs) || {
      requestCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
      durations: [],
    }

    bucket.requestCount += 1
    if (sample.statusCode >= 500) bucket.errorCount += 1
    bucket.totalDurationMs += sample.durationMs
    bucket.durations.push(sample.durationMs)
    bucketMap.set(bucketStartMs, bucket)
  }

  const points = []
  const startBucketMs = Math.floor(floor / bucketMs) * bucketMs
  const endBucketMs = Math.floor(now / bucketMs) * bucketMs

  for (let ts = startBucketMs; ts <= endBucketMs; ts += bucketMs) {
    const bucket = bucketMap.get(ts)
    if (!bucket) {
      points.push({
        timestamp: new Date(ts).toISOString(),
        requestCount: 0,
        errorRate: 0,
        avgResponseTimeMs: 0,
        p95ResponseTimeMs: 0,
      })
      continue
    }

    const avgResponseTimeMs =
      bucket.requestCount === 0 ? 0 : bucket.totalDurationMs / bucket.requestCount

    points.push({
      timestamp: new Date(ts).toISOString(),
      requestCount: bucket.requestCount,
      errorRate: round(bucket.errorCount / bucket.requestCount, 4),
      avgResponseTimeMs: round(avgResponseTimeMs),
      p95ResponseTimeMs: round(percentile(bucket.durations, 95)),
    })
  }

  return points
}

const monitoringService = {
  onRequestStart() {
    inFlightRequests += 1
    httpInFlightRequests.set(inFlightRequests)
  },

  onRequestComplete({ method, route, statusCode, durationMs }) {
    inFlightRequests = Math.max(0, inFlightRequests - 1)
    httpInFlightRequests.set(inFlightRequests)

    const safeMethod = method || 'UNKNOWN'
    const safeRoute = route || 'unknown'
    const safeStatusCode = String(statusCode || 0)
    const safeDurationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0

    httpRequestsTotal.labels(safeMethod, safeRoute, safeStatusCode).inc()
    httpRequestDurationSeconds
      .labels(safeMethod, safeRoute, safeStatusCode)
      .observe(safeDurationMs / 1000)

    requestSamples.push({
      ts: Date.now(),
      statusCode: Number.parseInt(safeStatusCode, 10) || 0,
      durationMs: safeDurationMs,
    })
    pruneSamples()
  },

  recordInactiveCustomerBlock({ surface = 'unknown' } = {}) {
    const normalizedSurface = normalizeMetricLabel(surface)
    governanceInactiveCustomerBlocksTotal.labels(normalizedSurface).inc()
    governanceEventTotals.inactiveCustomerBlocks += 1
  },

  recordLimitRejection({ limitType = 'unknown', surface = 'unknown' } = {}) {
    const normalizedLimitType = normalizeMetricLabel(limitType)
    const normalizedSurface = normalizeMetricLabel(surface)
    governanceLimitRejectionsTotal
      .labels(normalizedLimitType, normalizedSurface)
      .inc()
    governanceEventTotals.limitRejections += 1
  },

  recordOnboardingTransactionFailure({ failureType = 'unknown' } = {}) {
    const normalizedFailureType = normalizeMetricLabel(failureType)
    governanceOnboardingTransactionFailuresTotal
      .labels(normalizedFailureType)
      .inc()
    governanceEventTotals.onboardingTransactionFailures += 1
  },

  getPublicHealth() {
    return {
      status: 'healthy',
      timestamp: safeNowIso(),
      version: env.appVersion,
      uptime: round(process.uptime()),
    }
  },

  async getDetailedHealth() {
    const [database, redis, identityPlus] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkIdentityPlus(),
    ])

    const services = { database, redis, identityPlus }
    const metrics = getPerformanceSnapshot()
    const alerts = evaluateAlerts(metrics)
    const timestamp = safeNowIso()
    reconcileAlertLifecycle(alerts, timestamp)
    pruneAlertLifecycle()
    const status = computeOverallStatus(services, alerts)

    healthStatusGauge.set(HEALTH_VALUE[status] ?? 0)
    activeAlertsGauge.set(alerts.length)

    return {
      status,
      timestamp,
      version: env.appVersion,
      uptime: round(process.uptime()),
      services,
      metrics,
      alerts,
      alertSummary: {
        activeCount: [...alertLifecycle.values()].filter((alert) => alert.status === 'active').length,
        resolvedCount: [...alertLifecycle.values()].filter((alert) => alert.status === 'resolved').length,
      },
      thresholds: {
        p95ResponseTimeMs: env.monitoringLatencyP95ThresholdMs,
        errorRate: env.monitoringErrorRateThreshold,
        eventLoopLagMs: env.monitoringEventLoopLagThresholdMs,
        heapUsagePercent: env.monitoringHeapUsageThresholdPct,
      },
    }
  },

  getTrends({ windowMs = env.monitoringTrendDefaultWindowMs, bucketMs = env.monitoringTrendDefaultBucketMs } = {}) {
    const points = buildTrends({ windowMs, bucketMs })
    return {
      generatedAt: safeNowIso(),
      windowMs,
      bucketMs,
      points,
    }
  },

  getAlertLifecycle({ status = 'all', limit = 100 } = {}) {
    const metrics = getPerformanceSnapshot()
    const currentAlerts = evaluateAlerts(metrics)
    reconcileAlertLifecycle(currentAlerts, safeNowIso())
    pruneAlertLifecycle()

    const activeItems = [...alertLifecycle.values()]
      .filter((alert) => alert.status === 'active')
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))

    const resolvedItems = [...alertLifecycle.values()]
      .filter((alert) => alert.status === 'resolved')
      .sort((a, b) => Date.parse(b.resolvedAt || b.lastSeenAt) - Date.parse(a.resolvedAt || a.lastSeenAt))

    if (status === 'active') {
      return {
        generatedAt: safeNowIso(),
        summary: {
          activeCount: activeItems.length,
          resolvedCount: resolvedItems.length,
          total: activeItems.length + resolvedItems.length,
        },
        items: activeItems.slice(0, limit),
      }
    }

    if (status === 'resolved') {
      return {
        generatedAt: safeNowIso(),
        summary: {
          activeCount: activeItems.length,
          resolvedCount: resolvedItems.length,
          total: activeItems.length + resolvedItems.length,
        },
        items: resolvedItems.slice(0, limit),
      }
    }

    return {
      generatedAt: safeNowIso(),
      summary: {
        activeCount: activeItems.length,
        resolvedCount: resolvedItems.length,
        total: activeItems.length + resolvedItems.length,
      },
      items: [...activeItems, ...resolvedItems].slice(0, limit),
    }
  },

  async getMetrics() {
    return register.metrics()
  },

  getMetricsContentType() {
    return register.contentType
  },

  resetForTests() {
    requestSamples.length = 0
    alertLifecycle.clear()
    inFlightRequests = 0
    governanceEventTotals.inactiveCustomerBlocks = 0
    governanceEventTotals.limitRejections = 0
    governanceEventTotals.onboardingTransactionFailures = 0

    httpRequestsTotal.reset()
    httpRequestDurationSeconds.reset()
    governanceInactiveCustomerBlocksTotal.reset()
    governanceLimitRejectionsTotal.reset()
    governanceOnboardingTransactionFailuresTotal.reset()

    httpInFlightRequests.set(0)
    eventLoopMonitor.reset()
    healthStatusGauge.set(0)
    activeAlertsGauge.set(0)
  },
}

export default monitoringService
