import { beforeAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import express from 'express'
import supertest from 'supertest'

const USER_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const VMF_ID = '807f1f77bcf86cd799439055'
const redis = { get: jest.fn(), del: jest.fn(), setex: jest.fn(), set: jest.fn() }
let tokenService, env, requireStepUp, authorize, User, Customer, Tenant, VMF, Deal, Role
let loadScopes, cache, authController, authJwt, request
const req = () => ({ context: { userId: USER_ID }, userId: USER_ID,
  requestId: 'auth-fault', method: 'GET', headers: {},
  params: { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, dealId: VMF_ID },
  scopes: { platformRoles: ['SUPER_ADMIN'], memberships: [], tenantMemberships: [], vmfGrants: [],
    resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] }, customers: [], tenants: [] } } })
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() })

beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: 'test', AUTH_RATE_LIMIT: '2', AUTH_HOURLY_RATE_LIMIT: '100',
    JWT_SECRET: 'auth-security-test-access-secret-long-enough',
    JWT_REFRESH_SECRET: 'auth-security-test-refresh-secret-long-enough',
    MONGODB_URI: 'mongodb://localhost:27017/vmf_test' })
  await jest.unstable_mockModule('../config/redis.js', () => ({ getRedis: () => redis, isRedisConnected: () => true }))
  const models = await import('../models/index.js')
  ;({ User, Customer, Tenant, VMF, Deal, Role } = models)
  tokenService = (await import('../services/tokenService.js')).default
  env = (await import('../config/env.js')).default
  requireStepUp = (await import('../middleware/requireStepUp.js')).default
  authorize = await import('../middleware/authorize.js')
  loadScopes = (await import('../middleware/loadScopes.js')).default
  cache = (await import('../services/performanceCacheService.js')).default
  authController = await import('../controllers/auth.controller.js')
  authJwt = (await import('../middleware/authJwt.js')).default
  request = supertest((await import('../app.js')).default)
})

beforeEach(() => {
  redis.get.mockReset().mockResolvedValue(null)
  redis.del.mockReset().mockResolvedValue(1)
  redis.setex.mockReset().mockResolvedValue('OK')
  redis.set.mockReset().mockResolvedValue('OK')
  env.nodeEnv = 'test'
})
afterEach(() => { env.nodeEnv = 'test'; jest.restoreAllMocks() })

test.each([
  ['customer access', () => authorize.requireCustomerAccess(), () => Customer],
  ['customer permission', () => authorize.requireCustomerPermission('CUSTOMER_VIEW'), () => Customer],
  ['tenant access', () => authorize.requireTenantAccess(), () => Customer],
  ['tenant permission', () => authorize.requireTenantPermission('TENANT_VIEW'), () => Customer],
  ['VMF access', () => authorize.requireVmfAccess('read'), () => VMF],
  ['deal access', () => authorize.requireDealAccess('DEAL_VIEW', 'read'), () => Deal],
])('%s database rejection reaches the Express error handler once without running the action', async (_name, middleware, model) => {
  const fault = new Error('database unavailable')
  jest.spyOn(model(), 'findById').mockRejectedValue(fault)
  const action = jest.fn((_req, response) => response.sendStatus(204))
  const errorHandler = jest.fn((error, _req, response, _next) => response.status(503).json({ error: error.message }))
  const app = express()
  app.get('/guarded', (request, _res, next) => { Object.assign(request, req()); next() }, middleware(), action)
  app.use(errorHandler)
  const response = await supertest(app).get('/guarded').timeout(1500)
  expect(response.status).toBe(503)
  expect(errorHandler).toHaveBeenCalledTimes(1)
  expect(errorHandler.mock.calls[0][0]).toBe(fault)
  expect(action).not.toHaveBeenCalled()
})

test.each(['get', 'del'])('step-up Redis %s rejection forwards once without granting access', async (operation) => {
  const fault = new Error('redis unavailable')
  redis.get.mockResolvedValue('1')
  redis[operation].mockRejectedValue(fault)
  const next = jest.fn()
  await requireStepUp({ ...req(), headers: { 'x-step-up-token': 'proof' } }, res(), next)
  expect(next).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenCalledWith(fault)
  if (operation === 'get') expect(redis.del).not.toHaveBeenCalled()
})

test('middleware rejection with a non-Error value is normalized for Express', async () => {
  redis.get.mockRejectedValue(null)
  const next = jest.fn()
  await requireStepUp({ ...req(), headers: { 'x-step-up-token': 'proof' } }, res(), next)
  expect(next).toHaveBeenCalledTimes(1)
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
  expect(redis.del).not.toHaveBeenCalled()
})

test('scope resolution failure does not cache and a fresh request retries immediately', async () => {
  const user = { _id: USER_ID, isActive: true, memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }] }
  jest.spyOn(User, 'findById').mockResolvedValue(user)
  const roleLookup = jest.spyOn(Role, 'find').mockRejectedValueOnce(new Error('temporary outage'))
    .mockResolvedValue([{ key: 'SUPER_ADMIN', scope: 'PLATFORM', permissions: ['PLATFORM_MANAGE'], isActive: true }])
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue(null)
  const cacheWrite = jest.spyOn(cache, 'setUserPermissions').mockResolvedValue()
  const next = jest.fn()
  await loadScopes(req(), res(), next)
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'temporary outage' }))
  expect(cacheWrite).not.toHaveBeenCalled()
  next.mockClear()
  await loadScopes(req(), res(), next)
  expect(next).toHaveBeenCalledWith()
  expect(roleLookup).toHaveBeenCalledTimes(2)
  expect(cacheWrite).toHaveBeenCalledTimes(1)
})

test('legacy cached scope hydration fails without overwriting the cache on role error', async () => {
  const user = { _id: USER_ID, isActive: true, memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }] }
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue({ user, isActive: true, memberships: user.memberships })
  jest.spyOn(Role, 'find').mockRejectedValue(new Error('hydration outage'))
  const cacheWrite = jest.spyOn(cache, 'setUserPermissions').mockResolvedValue()
  const next = jest.fn()
  await loadScopes(req(), res(), next)
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'hydration outage' }))
  expect(cacheWrite).not.toHaveBeenCalled()
})

test('URL, query and header resembling a super-admin bypass do not skip inactive-customer checks', async () => {
  const user = { _id: USER_ID, isActive: true, memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }] }
  jest.spyOn(User, 'findById').mockResolvedValue(user)
  jest.spyOn(Role, 'find').mockResolvedValue([{ key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', permissions: ['CUSTOMER_VIEW'], isActive: true }])
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue(null)
  jest.spyOn(cache, 'getCustomerTopology').mockResolvedValue({ status: 'DISABLED' })
  const response = res(), next = jest.fn()
  await loadScopes({ ...req(), originalUrl: '/api/v1/super-admin/example?skipInactiveCustomerCheck=true',
    headers: { 'skipInactiveCustomerCheck': 'true' } }, response, next)
  expect(response.status).toHaveBeenCalledWith(403)
  expect(next).not.toHaveBeenCalled()
})

test('access-token expiry preserves the JWT error type and meaningful auth response', async () => {
  const expired = jwt.sign({ userId: USER_ID }, env.jwtSecret, {
    expiresIn: -1, issuer: 'storylineos-vmf-api', audience: 'storylineos-vmf-client' })
  expect(() => tokenService.verifyAccessToken(expired)).toThrow(jwt.TokenExpiredError)
  const response = res()
  await authJwt({ ...req(), headers: { authorization: `Bearer ${expired}` } }, response, jest.fn())
  expect(response.status).toHaveBeenCalledWith(401)
  expect(response.json.mock.calls[0][0].error.message).toBe('Token has expired')
})

test('auth middleware forwards unclassified dependency failures instead of reporting invalid credentials', async () => {
  const fault = new Error('revocation lookup failed')
  jest.spyOn(tokenService, 'isTokenBlacklisted').mockRejectedValue(fault)
  const response = res(), next = jest.fn()
  await authJwt({ ...req(), headers: { authorization: 'Bearer opaque' } }, response, next)
  expect(next).toHaveBeenCalledWith(fault)
  expect(response.status).not.toHaveBeenCalled()
})

test('refresh rejects a rotated stored token through typed authentication failure', async () => {
  const tokens = await tokenService.generateTokens({ _id: USER_ID })
  redis.get.mockResolvedValue('other-session-token')
  await expect(tokenService.refreshAccessToken(tokens.refreshToken)).rejects.toMatchObject({ name: 'TokenAuthenticationError' })
  const response = res(), next = jest.fn()
  await authController.refresh({ ...req(), body: { refreshToken: tokens.refreshToken } }, response, next)
  expect(response.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test.each([null, 'Invalid database connection', new Error('Invalid database connection')])('refresh infrastructure/non-Error failures reach next rather than credential classification (%p)', async (fault) => {
  jest.spyOn(tokenService, 'refreshAccessToken').mockRejectedValue(fault)
  const response = res(), next = jest.fn()
  await authController.refresh({ ...req(), body: { refreshToken: 'x' } }, response, next)
  expect(next).toHaveBeenCalledTimes(1)
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
  expect(response.status).not.toHaveBeenCalled()
})

test('blacklist writes only the hash key and honors both hashed and pre-deployment revocations', async () => {
  const tokens = await tokenService.generateTokens({ _id: USER_ID })
  redis.setex.mockClear()
  await tokenService.blacklistToken(tokens.accessToken)
  const key = `blacklist:sha256:${crypto.createHash('sha256').update(tokens.accessToken).digest('hex')}`
  expect(redis.setex).toHaveBeenCalledWith(key, expect.any(Number), 'true')
  expect(redis.setex.mock.calls[0][0]).not.toContain(tokens.accessToken)
  redis.get.mockResolvedValueOnce('true')
  expect(await tokenService.isTokenBlacklisted(tokens.accessToken)).toBe(true)
  expect(redis.get).toHaveBeenLastCalledWith(key)
  redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('true')
  expect(await tokenService.isTokenBlacklisted(tokens.accessToken)).toBe(true)
  expect(redis.get).toHaveBeenLastCalledWith(`blacklist:${tokens.accessToken}`)
})

test('step-up password limit rejects before looking up the user', async () => {
  const tokens = await tokenService.generateTokens({ _id: USER_ID })
  const lookup = jest.spyOn(User, 'findById')
  const response = await request.post('/api/v1/auth/step-up').set('Authorization', `Bearer ${tokens.accessToken}`)
    .send({ password: 'x'.repeat(201) })
  expect(response.status).toBe(422)
  expect(lookup).not.toHaveBeenCalled()
})

test('mounted step-up limiter stops repeated password attempts before bcrypt', async () => {
  const tokens = await tokenService.generateTokens({ _id: USER_ID })
  const comparePassword = jest.fn().mockResolvedValue(false)
  jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockResolvedValue({ isActive: true, comparePassword }) })
  env.nodeEnv = 'development'
  const statuses = []
  for (let index = 0; index < 3; index += 1) {
    const response = await request.post('/api/v1/auth/step-up').set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ password: 'wrong' })
    statuses.push(response.status)
  }
  expect(statuses).toEqual([401, 401, 429])
  expect(comparePassword).toHaveBeenCalledTimes(2)
})
