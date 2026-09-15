import { beforeAll, afterEach, expect, jest, test } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { EventEmitter } from 'node:events'
import { validate as isUuid } from 'uuid'

let Customer, LicenseLevel, Role, cache, entitlement, errorHandler, monitor, monitoring, requestContext, env, limiter
beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'platform-test-access-secret'
  process.env.JWT_REFRESH_SECRET = 'platform-test-refresh-secret'
  ;({ Customer, LicenseLevel, Role } = await import('../models/index.js'))
  cache = (await import('../services/performanceCacheService.js')).default
  entitlement = (await import('../middleware/featureEntitlements.js')).default
  errorHandler = (await import('../middleware/errorHandler.js')).default
  monitor = (await import('../middleware/performanceMonitor.js')).default
  monitoring = (await import('../services/monitoringService.js')).default
  requestContext = (await import('../middleware/requestContext.js')).default
  env = (await import('../config/env.js')).default
  limiter = await import('../middleware/rateLimits.js')
})
afterEach(() => jest.restoreAllMocks())

test('entitlement DB rejection reaches the mounted Express error handler without running protected action', async () => {
  jest.spyOn(cache, 'getCustomerTopology').mockResolvedValue(null)
  jest.spyOn(Customer, 'findById').mockReturnValue({ select: () => Promise.reject(new Error('DB unavailable')) })
  const action = jest.fn((_req, res) => res.sendStatus(204))
  const app = express()
  app.get('/protected', (req, _res, next) => {
    req.scopes = {}; req.params.customerId = '607f1f77bcf86cd799439022'; next()
  }, entitlement('VMF'), action)
  app.use(errorHandler)
  const response = await supertest(app).get('/protected').timeout(1500)
  expect(response.status).toBe(500)
  expect(response.body.error.code).toBe('INTERNAL_ERROR')
  expect(action).not.toHaveBeenCalled()
})

test.each([undefined, '', 'not-an-id', ['id', 'id'], 'x'.repeat(10000)])('invalid correlation ID is replaced: %p', (value) => {
  const req = { headers: { 'x-request-id': value }, ip: '127.0.0.1' }
  const res = { setHeader: jest.fn() }
  requestContext(req, res, jest.fn())
  expect(isUuid(req.requestId)).toBe(true)
  expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId)
})
test('valid correlation UUID is preserved', () => {
  const id = '8de8974b-0b73-4417-9147-107d9070067c'
  const req = { headers: { 'x-request-id': id }, ip: '127.0.0.1' }
  requestContext(req, { setHeader: jest.fn() }, jest.fn())
  expect(req.requestId).toBe(id)
})

test('unmatched paths and dynamic mount IDs cannot grow metric route labels', () => {
  jest.spyOn(monitoring, 'onRequestStart').mockImplementation(() => {})
  const complete = jest.spyOn(monitoring, 'onRequestComplete').mockImplementation(() => {})
  for (let i = 0; i < 30; i += 1) {
    const response = new EventEmitter(); response.statusCode = 404
    monitor({ method: 'GET', baseUrl: `/customers/${i}`, path: `/random/${i}` }, response, () => {})
    response.emit('finish'); response.emit('close')
  }
  expect(complete).toHaveBeenCalledTimes(30)
  expect(new Set(complete.mock.calls.map(([x]) => x.route))).toEqual(new Set(['unmatched']))
  const response = new EventEmitter(); response.statusCode = 200
  monitor({ method: 'GET', baseUrl: '/customers/private-id', route: { path: '/:tenantId' } }, response, () => {})
  response.emit('finish')
  expect(complete.mock.lastCall[0].route).toBe('/:tenantId')
})

test('rate-limit JSON contains seconds remaining, consistent with Retry-After header', async () => {
  const oldEnv = env.nodeEnv, oldLimit = env.authRateLimit
  env.nodeEnv = 'development'
  // Exercise the actual configured handler without making hundreds of requests.
  const app = express()
  app.use(limiter.authRateLimit)
  app.get('/', (_req, res) => res.sendStatus(200))
  try {
    let response
    for (let i = 0; i <= oldLimit; i += 1) response = await supertest(app).get('/')
    expect(response.status).toBe(429)
    expect(response.body.error.retryAfter).toBeGreaterThanOrEqual(0)
    expect(response.body.error.retryAfter).toBeLessThanOrEqual(60)
    expect(Math.abs(response.body.error.retryAfter - Number(response.headers['retry-after']))).toBeLessThanOrEqual(1)
  } finally { env.nodeEnv = oldEnv }
})

test.each(['licence', 'role'])('%s search treats regex characters literally', async (kind) => {
  const controller = kind === 'licence'
    ? (await import('../controllers/licenseLevel.controller.js')).listLicenseLevels
    : (await import('../controllers/role.controller.js')).listRoles
  const model = kind === 'licence' ? LicenseLevel : Role
  const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }
  const find = jest.spyOn(model, 'find').mockReturnValue(chain)
  jest.spyOn(model, 'countDocuments').mockResolvedValue(0)
  jest.spyOn(Customer, 'aggregate').mockResolvedValue([])
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }, next = jest.fn()
  await controller({ query: { q: '(a+)+$' } }, res, next)
  expect(next).not.toHaveBeenCalled()
  for (const clause of find.mock.calls[0][0].$or) {
    const pattern = new RegExp(Object.values(clause)[0].$regex)
    expect(pattern.test('(a+)+$')).toBe(true)
    expect(pattern.test('aaaa')).toBe(false)
  }
})
