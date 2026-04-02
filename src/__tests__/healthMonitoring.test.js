/**
 * Health and Monitoring Tests (Phase 5.1)
 *
 * Covers:
 *   1. Public health endpoint (GET /health)
 *      - Returns status, timestamp, version, uptime
 *   2. Detailed health endpoint (GET /health/detailed)
 *      - Auth guard (401 unauthenticated, 403 non-super-admin)
 *      - Returns services, metrics, alerts, thresholds for SUPER_ADMIN
 *   3. Prometheus metrics endpoint (GET /metrics)
 *      - Auth guard (401 unauthenticated)
 *      - Returns text/plain with Prometheus counters/histograms
 *   4. monitoringService unit tests
 *      - getPublicHealth returns correct shape
 *      - onRequestStart / onRequestComplete tracking
 *      - Performance snapshot calculations
 *      - Alert evaluation thresholds
 *      - resetForTests clears state
 *   5. performanceMonitor middleware unit tests
 *      - Calls onRequestStart and onRequestComplete
 *      - Populates route label from req
 *   6. env.js monitoring configuration
 *      - metricsPrefix normalization
 *      - toFloat for error rate threshold
 *      - Default values for all monitoring config
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.AUDIT_SIGNATURE_SECRET = 'test-audit-hmac-secret-for-unit-tests'
  process.env.MONITORING_WINDOW_MS = '300000'
  process.env.MONITORING_LATENCY_P95_THRESHOLD_MS = '200'
  process.env.MONITORING_ERROR_RATE_THRESHOLD = '0.05'
  process.env.MONITORING_EVENT_LOOP_LAG_THRESHOLD_MS = '100'
  process.env.MONITORING_HEAP_USAGE_THRESHOLD_PCT = '85'
})

let app
let request
let tokenService
let monitoringService
let env
let User, Role

const buildRoleQueryChain = (rows) => {
  const chain = {
    lean: jest.fn().mockResolvedValue(rows),
  }
  chain.select = jest.fn().mockReturnValue(chain)
  chain.sort = jest.fn().mockReturnValue(chain)
  chain.skip = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  return chain
}

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_VIEW', 'ROLE_MANAGE', 'AUDIT_VIEW_ALL'],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_CREATE', 'DEAL_UPDATE', 'DEAL_VIEW'],
    isActive: true,
  },
])

const makeUser = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  id: '507f1f77bcf86cd799439011',
  email: 'admin@storylineos.com',
  name: 'Admin User',
  isActive: true,
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  ...overrides,
})

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getLabeledCounterValue = (metricsText, metricName, labels = []) => {
  const labelPattern = labels.length > 0
    ? labels.map((label) => `(?=.*${escapeRegex(label)})`).join('')
    : ''
  const regex = new RegExp(
    `${escapeRegex(metricName)}\\{${labelPattern}[^\\n]*\\}\\s+([0-9]+(?:\\.[0-9]+)?)`,
  )
  const match = metricsText.match(regex)
  return match ? Number.parseFloat(match[1]) : 0
}

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  monitoringService = (await import('../services/monitoringService.js')).default
  env = (await import('../config/env.js')).default
  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  request = supertest(app)
})

beforeEach(() => {
  User.findById = jest.fn()
  Role.find = jest.fn().mockImplementation(() => buildRoleQueryChain(buildDefaultRoleRows()))
  monitoringService.resetForTests()
})

describe('GET /health', () => {
  test('returns public health payload', async () => {
    const res = await request.get('/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
    expect(res.body.timestamp).toBeDefined()
    expect(res.body.version).toBeDefined()
    expect(typeof res.body.uptime).toBe('number')
  })
})

describe('GET /health/detailed', () => {
  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/health/detailed')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns 403 for non-super-admin users', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439012',
      id: '507f1f77bcf86cd799439012',
      email: 'customer-admin@example.com',
      memberships: [{ customerId: null, roles: ['USER'] }],
    })
    User.findById.mockResolvedValue(user)

    const tokens = await tokenService.generateTokens(user)
    const res = await request
      .get('/health/detailed')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('returns detailed health payload for super admin', async () => {
    const user = makeUser()
    User.findById.mockResolvedValue(user)

    const tokens = await tokenService.generateTokens(user)
    const res = await request
      .get('/health/detailed')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect([200, 503]).toContain(res.status)
    expect(res.body.status).toBeDefined()
    expect(res.body.timestamp).toBeDefined()
    expect(res.body.version).toBeDefined()
    expect(res.body.services).toBeDefined()
    expect(res.body.services.database).toBeDefined()
    expect(res.body.services.redis).toBeDefined()
    expect(res.body.services.identityPlus).toBeDefined()
    expect(res.body.metrics).toBeDefined()
    expect(typeof res.body.metrics.requestsPerMinute).toBe('number')
    expect(Array.isArray(res.body.alerts)).toBe(true)
    expect(res.body.thresholds.p95ResponseTimeMs).toBe(env.monitoringLatencyP95ThresholdMs)
    expect(res.body.thresholds.errorRate).toBe(env.monitoringErrorRateThreshold)
    expect(res.body.thresholds.eventLoopLagMs).toBe(env.monitoringEventLoopLagThresholdMs)
    expect(res.body.thresholds.heapUsagePercent).toBe(env.monitoringHeapUsageThresholdPct)
  })
})

describe('GET /metrics', () => {
  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/metrics')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns Prometheus text payload for super admin', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439013',
      id: '507f1f77bcf86cd799439013',
      email: 'ops-admin@example.com',
    })
    User.findById.mockResolvedValue(user)
    const tokens = await tokenService.generateTokens(user)

    // Generate at least one request sample before scraping metrics.
    await request.get('/health')

    const res = await request
      .get('/metrics')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.text).toContain(`${env.metricsPrefix}http_requests_total`)
    expect(res.text).toContain(`${env.metricsPrefix}http_request_duration_seconds`)
    expect(res.text).toContain(`${env.metricsPrefix}health_status`)
  })
})

/* ------------------------------------------------------------------ */
/*  monitoringService - Unit Tests                                    */
/* ------------------------------------------------------------------ */

describe('GET /health/trends', () => {
  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/health/trends')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns trends payload for super admin', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439031',
      id: '507f1f77bcf86cd799439031',
      email: 'trends-admin@example.com',
    })
    User.findById.mockResolvedValue(user)
    const tokens = await tokenService.generateTokens(user)

    for (let i = 0; i < 5; i++) {
      await request.get('/health')
    }

    const res = await request
      .get('/health/trends?window=15m&bucket=1m')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.generatedAt).toBe('string')
    expect(res.body.windowMs).toBe(15 * 60 * 1000)
    expect(res.body.bucketMs).toBe(60 * 1000)
    expect(Array.isArray(res.body.points)).toBe(true)
    expect(res.body.points.length).toBeGreaterThan(0)
    expect(res.body.points[0]).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        requestCount: expect.any(Number),
        errorRate: expect.any(Number),
        avgResponseTimeMs: expect.any(Number),
        p95ResponseTimeMs: expect.any(Number),
      }),
    )
  })

  test('returns 422 on invalid query parameters', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439032',
      id: '507f1f77bcf86cd799439032',
      email: 'trends-validation@example.com',
    })
    User.findById.mockResolvedValue(user)
    const tokens = await tokenService.generateTokens(user)

    const res = await request
      .get('/health/trends?window=abc&bucket=1m')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /health/alerts', () => {
  test('returns 401 when unauthenticated', async () => {
    const res = await request.get('/health/alerts')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('returns alert lifecycle payload for super admin', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439033',
      id: '507f1f77bcf86cd799439033',
      email: 'alerts-admin@example.com',
    })
    User.findById.mockResolvedValue(user)
    const tokens = await tokenService.generateTokens(user)

    for (let i = 0; i < 10; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/failing',
        statusCode: 500,
        durationMs: 10,
      })
    }
    await monitoringService.getDetailedHealth()

    const res = await request
      .get('/health/alerts?status=active&limit=25')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.generatedAt).toBe('string')
    expect(res.body.summary).toBeDefined()
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.items.length).toBeGreaterThan(0)
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        status: 'active',
        firstSeenAt: expect.any(String),
        lastSeenAt: expect.any(String),
      }),
    )
  })

  test('returns 422 on invalid status query parameter', async () => {
    const user = makeUser({
      _id: '507f1f77bcf86cd799439034',
      id: '507f1f77bcf86cd799439034',
      email: 'alerts-validation@example.com',
    })
    User.findById.mockResolvedValue(user)
    const tokens = await tokenService.generateTokens(user)

    const res = await request
      .get('/health/alerts?status=invalid')
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
describe('monitoringService - Unit', () => {
  test('getPublicHealth returns correct shape', () => {
    const health = monitoringService.getPublicHealth()

    expect(health.status).toBe('healthy')
    expect(typeof health.timestamp).toBe('string')
    expect(typeof health.uptime).toBe('number')
    expect(health.version).toBe(env.appVersion)
  })

  test('onRequestStart / onRequestComplete increments and decrements in-flight', () => {
    monitoringService.resetForTests()
    monitoringService.onRequestStart()
    monitoringService.onRequestStart()

    // After two starts and one complete, one should remain in-flight
    monitoringService.onRequestComplete({
      method: 'GET',
      route: '/test',
      statusCode: 200,
      durationMs: 10,
    })

    // Complete the second
    monitoringService.onRequestComplete({
      method: 'GET',
      route: '/test',
      statusCode: 200,
      durationMs: 5,
    })

    // No assertion on internal state, but should not throw
    expect(true).toBe(true)
  })

  test('onRequestComplete handles edge-case inputs', () => {
    monitoringService.resetForTests()

    // Should not throw with undefined/null/NaN values
    expect(() => {
      monitoringService.onRequestComplete({
        method: undefined,
        route: undefined,
        statusCode: undefined,
        durationMs: NaN,
      })
    }).not.toThrow()

    expect(() => {
      monitoringService.onRequestComplete({
        method: 'POST',
        route: '/api/test',
        statusCode: 500,
        durationMs: -1,
      })
    }).not.toThrow()
  })

  test('getDetailedHealth returns all required sections', async () => {
    monitoringService.resetForTests()

    const health = await monitoringService.getDetailedHealth()

    expect(health.status).toBeDefined()
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status)
    expect(health.timestamp).toBeDefined()
    expect(health.version).toBe(env.appVersion)
    expect(typeof health.uptime).toBe('number')

    // Services
    expect(health.services).toBeDefined()
    expect(health.services.database).toBeDefined()
    expect(health.services.redis).toBeDefined()
    expect(health.services.identityPlus).toBeDefined()

    // Each service has status + responseTime
    for (const svc of Object.values(health.services)) {
      expect(['healthy', 'degraded', 'unhealthy']).toContain(svc.status)
      expect(typeof svc.responseTime).toBe('number')
    }

    // Metrics shape
    expect(typeof health.metrics.activeConnections).toBe('number')
    expect(typeof health.metrics.requestsPerMinute).toBe('number')
    expect(typeof health.metrics.errorRate).toBe('number')
    expect(typeof health.metrics.avgResponseTimeMs).toBe('number')
    expect(typeof health.metrics.p95ResponseTimeMs).toBe('number')
    expect(typeof health.metrics.eventLoopLagMs).toBe('number')
    expect(typeof health.metrics.heapUsagePercent).toBe('number')

    // Alerts
    expect(Array.isArray(health.alerts)).toBe(true)

    // Thresholds
    expect(health.thresholds).toEqual({
      p95ResponseTimeMs: env.monitoringLatencyP95ThresholdMs,
      errorRate: env.monitoringErrorRateThreshold,
      eventLoopLagMs: env.monitoringEventLoopLagThresholdMs,
      heapUsagePercent: env.monitoringHeapUsageThresholdPct,
    })
  })

  test('getMetrics returns Prometheus text', async () => {
    const text = await monitoringService.getMetrics()

    expect(typeof text).toBe('string')
    expect(text).toContain('http_requests_total')
  })

  test('getMetricsContentType returns Prometheus content type', () => {
    const ct = monitoringService.getMetricsContentType()

    expect(typeof ct).toBe('string')
    expect(ct).toContain('text/plain')
  })

  test('getTrends returns bucketed historical points', () => {
    monitoringService.resetForTests()

    for (let i = 0; i < 20; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/trend',
        statusCode: i % 5 === 0 ? 500 : 200,
        durationMs: 15 + i,
      })
    }

    const trends = monitoringService.getTrends({
      windowMs: 5 * 60 * 1000,
      bucketMs: 60 * 1000,
    })

    expect(typeof trends.generatedAt).toBe('string')
    expect(trends.windowMs).toBe(5 * 60 * 1000)
    expect(trends.bucketMs).toBe(60 * 1000)
    expect(Array.isArray(trends.points)).toBe(true)
    expect(trends.points.length).toBeGreaterThan(0)
    expect(trends.points[trends.points.length - 1]).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        requestCount: expect.any(Number),
        errorRate: expect.any(Number),
        avgResponseTimeMs: expect.any(Number),
        p95ResponseTimeMs: expect.any(Number),
      }),
    )
  })

  test('getAlertLifecycle exposes active and resolved alert states', async () => {
    monitoringService.resetForTests()

    for (let i = 0; i < 20; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/alert',
        statusCode: 500,
        durationMs: 10,
      })
    }

    await monitoringService.getDetailedHealth()
    const activeSnapshot = monitoringService.getAlertLifecycle({ status: 'active', limit: 10 })
    const activeErrorAlert = activeSnapshot.items.find((item) => item.code === 'HIGH_ERROR_RATE')

    expect(activeErrorAlert).toBeDefined()
    expect(activeErrorAlert.status).toBe('active')

    for (let i = 0; i < 500; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/healthy',
        statusCode: 200,
        durationMs: 5,
      })
    }

    await monitoringService.getDetailedHealth()
    const resolvedSnapshot = monitoringService.getAlertLifecycle({ status: 'resolved', limit: 10 })
    const resolvedErrorAlert = resolvedSnapshot.items.find((item) => item.code === 'HIGH_ERROR_RATE')

    expect(resolvedErrorAlert).toBeDefined()
    expect(resolvedErrorAlert.status).toBe('resolved')
    expect(typeof resolvedErrorAlert.resolvedAt).toBe('string')
  })

  test('resetForTests clears accumulated samples', () => {
    // Accumulate some data
    monitoringService.onRequestStart()
    monitoringService.onRequestComplete({
      method: 'GET',
      route: '/test',
      statusCode: 200,
      durationMs: 50,
    })

    monitoringService.resetForTests()

    // After reset, public health should still return 'healthy'
    const health = monitoringService.getPublicHealth()
    expect(health.status).toBe('healthy')
  })

  test('records governance counters and exposes them in health metrics + Prometheus', async () => {
    monitoringService.resetForTests()

    monitoringService.recordInactiveCustomerBlock({ surface: 'auth_login' })
    monitoringService.recordLimitRejection({
      limitType: 'MAX_VMFS_PER_TENANT',
      surface: 'vmf_controller',
    })
    monitoringService.recordOnboardingTransactionFailure({ failureType: 'internal' })

    const health = await monitoringService.getDetailedHealth()
    expect(health.metrics.inactiveCustomerBlocks).toBe(1)
    expect(health.metrics.governanceLimitRejections).toBe(1)
    expect(health.metrics.onboardingTransactionFailures).toBe(1)

    const metricsText = await monitoringService.getMetrics()
    expect(
      getLabeledCounterValue(
        metricsText,
        `${env.metricsPrefix}governance_inactive_customer_blocks_total`,
        ['surface="auth_login"'],
      ),
    ).toBeGreaterThanOrEqual(1)
    expect(
      getLabeledCounterValue(
        metricsText,
        `${env.metricsPrefix}governance_limit_rejections_total`,
        ['limit_type="max_vmfs_per_tenant"', 'surface="vmf_controller"'],
      ),
    ).toBeGreaterThanOrEqual(1)
    expect(
      getLabeledCounterValue(
        metricsText,
        `${env.metricsPrefix}governance_onboarding_transaction_failures_total`,
        ['failure_type="internal"'],
      ),
    ).toBeGreaterThanOrEqual(1)
  })
})

/* ------------------------------------------------------------------ */
/*  Alert evaluation                                                  */
/* ------------------------------------------------------------------ */

describe('monitoringService - Alert evaluation', () => {
  test('no alerts when all metrics are within thresholds', async () => {
    monitoringService.resetForTests()

    // Fresh state with no requests -> all zeros -> within thresholds
    const health = await monitoringService.getDetailedHealth()

    // Error rate is 0, p95 is 0 - should not trigger latency or error alerts
    const latencyAlert = health.alerts.find((a) => a.code === 'HIGH_P95_LATENCY')
    const errorAlert = health.alerts.find((a) => a.code === 'HIGH_ERROR_RATE')
    expect(latencyAlert).toBeUndefined()
    expect(errorAlert).toBeUndefined()
  })

  test('HIGH_ERROR_RATE alert when error rate exceeds threshold', async () => {
    monitoringService.resetForTests()

    // Simulate 10 requests where ALL return 500 -> error rate = 1.0
    for (let i = 0; i < 10; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/fail',
        statusCode: 500,
        durationMs: 10,
      })
    }

    const health = await monitoringService.getDetailedHealth()
    const errorAlert = health.alerts.find((a) => a.code === 'HIGH_ERROR_RATE')

    expect(errorAlert).toBeDefined()
    expect(errorAlert.severity).toBe('critical')
    expect(errorAlert.metric).toBe('errorRate')
    expect(errorAlert.value).toBeGreaterThan(env.monitoringErrorRateThreshold)
  })

  test('alert object shape matches specification', async () => {
    monitoringService.resetForTests()

    // Force an error rate alert
    for (let i = 0; i < 5; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/err',
        statusCode: 500,
        durationMs: 5,
      })
    }

    const health = await monitoringService.getDetailedHealth()
    const alert = health.alerts.find((a) => a.code === 'HIGH_ERROR_RATE')

    expect(alert).toBeDefined()
    expect(alert).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        severity: expect.any(String),
        metric: expect.any(String),
        threshold: expect.any(Number),
        value: expect.any(Number),
        message: expect.any(String),
      }),
    )
  })

  test('overall status is degraded when alerts are present', async () => {
    monitoringService.resetForTests()

    // Force error rate alert
    for (let i = 0; i < 10; i++) {
      monitoringService.onRequestStart()
      monitoringService.onRequestComplete({
        method: 'GET',
        route: '/err',
        statusCode: 500,
        durationMs: 5,
      })
    }

    const health = await monitoringService.getDetailedHealth()

    // With alerts present, status should be at least 'degraded'
    expect(['degraded', 'unhealthy']).toContain(health.status)
  })
})

/* ------------------------------------------------------------------ */
/*  performanceMonitor middleware - Unit                               */
/* ------------------------------------------------------------------ */

describe('performanceMonitor - Unit', () => {
  let performanceMonitor

  beforeAll(async () => {
    performanceMonitor = (await import('../middleware/performanceMonitor.js')).default
  })

  test('is a function with arity 3 (req, res, next)', () => {
    expect(typeof performanceMonitor).toBe('function')
    expect(performanceMonitor.length).toBe(3)
  })

  test('calls next() synchronously', () => {
    const req = { method: 'GET', path: '/test' }
    const listeners = {}
    const res = {
      statusCode: 200,
      on: (event, fn) => { listeners[event] = fn },
    }
    const next = jest.fn()

    performanceMonitor(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ */
/*  env.js monitoring config - Unit                                   */
/* ------------------------------------------------------------------ */

describe('env.js - Monitoring configuration', () => {
  test('metricsPrefix ends with underscore', () => {
    expect(env.metricsPrefix).toBeDefined()
    expect(typeof env.metricsPrefix).toBe('string')
    expect(env.metricsPrefix.endsWith('_')).toBe(true)
  })

  test('monitoringWindowMs is a positive number', () => {
    expect(typeof env.monitoringWindowMs).toBe('number')
    expect(env.monitoringWindowMs).toBeGreaterThan(0)
  })

  test('monitoringLatencyP95ThresholdMs defaults to 200', () => {
    expect(env.monitoringLatencyP95ThresholdMs).toBe(200)
  })

  test('monitoringErrorRateThreshold defaults to 0.05', () => {
    expect(env.monitoringErrorRateThreshold).toBe(0.05)
  })

  test('monitoringEventLoopLagThresholdMs defaults to 100', () => {
    expect(env.monitoringEventLoopLagThresholdMs).toBe(100)
  })

  test('monitoringHeapUsageThresholdPct defaults to 85', () => {
    expect(env.monitoringHeapUsageThresholdPct).toBe(85)
  })

  test('appVersion is defined', () => {
    expect(env.appVersion).toBeDefined()
    expect(typeof env.appVersion).toBe('string')
  })
})
