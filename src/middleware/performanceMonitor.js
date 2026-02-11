/**
 * Performance Monitoring Middleware
 *
 * Captures per-request latency and status code so monitoringService can:
 *   - publish Prometheus metrics (httpRequestsTotal, httpRequestDurationSeconds)
 *   - compute rolling performance snapshots for /health/detailed
 *
 * Must be placed in the middleware stack AFTER requestLogger and BEFORE
 * route handlers so that every request is instrumented.
 */

import monitoringService from '../services/monitoringService.js'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const getRouteLabel = (req) => {
  if (req.baseUrl && req.route?.path) return `${req.baseUrl}${req.route.path}`
  if (req.route?.path) return req.route.path
  if (req.baseUrl) return req.baseUrl
  if (req.path) return req.path
  return 'unknown'
}

const performanceMonitor = (req, res, next) => {
  const started = process.hrtime.bigint()
  let completed = false

  monitoringService.onRequestStart()

  const finalize = () => {
    if (completed) return
    completed = true

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
    monitoringService.onRequestComplete({
      method: req.method,
      route: getRouteLabel(req),
      statusCode: res.statusCode,
      durationMs,
    })
  }

  res.on('finish', finalize)
  res.on('close', finalize)

  next()
}

export default performanceMonitor
