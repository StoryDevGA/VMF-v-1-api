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

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 })
eventLoopMonitor.enable()

const requestSamples = []
let inFlightRequests = 0

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

const pruneSamples = (now = Date.now()) => {
  const floor = now - env.monitoringWindowMs
  while (requestSamples.length > 0 && requestSamples[0].ts < floor) {
    requestSamples.shift()
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

  const total = requestSamples.length
  const oneMinuteAgo = now - 60_000
  let requestsPerMinute = 0
  let errorCount = 0
  const durations = []

  for (const sample of requestSamples) {
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
    const status = computeOverallStatus(services, alerts)

    healthStatusGauge.set(HEALTH_VALUE[status] ?? 0)
    activeAlertsGauge.set(alerts.length)

    return {
      status,
      timestamp: safeNowIso(),
      version: env.appVersion,
      uptime: round(process.uptime()),
      services,
      metrics,
      alerts,
      thresholds: {
        p95ResponseTimeMs: env.monitoringLatencyP95ThresholdMs,
        errorRate: env.monitoringErrorRateThreshold,
        eventLoopLagMs: env.monitoringEventLoopLagThresholdMs,
        heapUsagePercent: env.monitoringHeapUsageThresholdPct,
      },
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
    inFlightRequests = 0
    httpInFlightRequests.set(0)
    eventLoopMonitor.reset()
    healthStatusGauge.set(0)
    activeAlertsGauge.set(0)
  },
}

export default monitoringService
