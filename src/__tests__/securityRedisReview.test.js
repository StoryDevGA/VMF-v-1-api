import { beforeAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals'
import crypto from 'node:crypto'
import express from 'express'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'

const data = new Map()
const redis = {
  get: jest.fn(), set: jest.fn(), setex: jest.fn(), del: jest.fn(), eval: jest.fn(),
}
let available = true
let env, tokens, tokenService, authJwt, cache, SharedRateLimitStore, logout
const fault = new Error('Redis dependency failed')
const makeToken = (userId = '507f1f77bcf86cd799439011') => jwt.sign({ userId }, env.jwtSecret, {
  expiresIn: '15m', issuer: 'storylineos-vmf-api', audience: 'storylineos-vmf-client',
})
const mount = (handler = (_req, res) => res.sendStatus(204)) => {
  const app = express()
  const action = jest.fn(handler)
  const errors = jest.fn((error, _req, res, _next) => res.status(error.statusCode || 500).json({ failed: true }))
  app.use((req, _res, next) => { req.context = {}; next() })
  app.get('/guarded', authJwt, action)
  app.use(errors)
  return { request: supertest(app), action, errors }
}

beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'review-access-secret-long-enough',
    JWT_REFRESH_SECRET: 'review-refresh-secret-long-enough', MONGODB_URI: 'mongodb://localhost:27017/vmf_test' })
  await jest.unstable_mockModule('../config/redis.js', () => ({
    getRedis: () => available ? redis : null, isRedisConnected: () => available,
  }))
  env = (await import('../config/env.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  authJwt = (await import('../middleware/authJwt.js')).default
  cache = (await import('../services/performanceCacheService.js')).default
  ;({ SharedRateLimitStore } = await import('../services/rateLimitStore.js'))
  ;({ logout } = await import('../controllers/auth.controller.js'))
})

beforeEach(async () => {
  available = true
  data.clear()
  env.nodeEnv = 'development'
  env.redisRequired = false
  env.perfCacheEnabled = true
  redis.get.mockReset().mockImplementation(async key => data.get(key) ?? null)
  redis.set.mockReset().mockImplementation(async (key, value) => { data.set(key, value); return 'OK' })
  redis.setex.mockReset().mockImplementation(async (key, _ttl, value) => { data.set(key, value); return 'OK' })
  redis.del.mockReset().mockImplementation(async key => Number(data.delete(key)))
  redis.eval.mockReset().mockResolvedValue([1, 60000])
  tokens = await tokenService.generateTokens({ id: '507f1f77bcf86cd799439011' })
  await cache.resetForTests()
})

afterEach(() => { env.nodeEnv = 'test'; env.redisRequired = false; jest.restoreAllMocks() })

test.each([false, true])('real blacklist GET rejection (legacy=%s) denies mounted action once', async legacy => {
  if (legacy) redis.get.mockResolvedValueOnce(null).mockRejectedValueOnce(fault)
  else redis.get.mockRejectedValueOnce(fault)
  const route = mount()
  const response = await route.request.get('/guarded').set('Authorization', `Bearer ${tokens.accessToken}`)
  expect(response.status).toBe(500)
  expect(route.errors).toHaveBeenCalledTimes(1)
  expect(route.errors.mock.calls[0][0]).toBe(fault)
  expect(route.action).not.toHaveBeenCalled()
})

test.each(['production', 'required'])('missing Redis in %s denies mounted auth and all token mutations', async mode => {
  available = false
  env.nodeEnv = mode === 'production' ? 'production' : 'test'
  env.redisRequired = mode === 'required'
  const route = mount()
  const response = await route.request.get('/guarded').set('Authorization', `Bearer ${tokens.accessToken}`)
  expect(response.status).toBe(503)
  expect(route.action).not.toHaveBeenCalled()
  for (const operation of [
    () => tokenService.generateTokens({ id: 'user' }),
    () => tokenService.refreshAccessToken(tokens.refreshToken),
    () => tokenService.blacklistToken(tokens.accessToken),
    () => tokenService.revokeRefreshToken('user'),
    () => tokenService.revokeAllUserTokens('user'),
  ]) await expect(operation()).rejects.toMatchObject({ statusCode: 503 })
})

test('noeviction OOM during logout blacklist write produces an error, never success', async () => {
  const oom = new Error('OOM command not allowed when used memory > maxmemory')
  redis.setex.mockRejectedValueOnce(oom)
  const route = mount(logout)
  const response = await route.request.get('/guarded').set('Authorization', `Bearer ${tokens.accessToken}`)
  expect(response.status).toBe(500)
  expect(route.errors.mock.calls[0][0]).toBe(oom)
  expect(redis.del).not.toHaveBeenCalled()
})

test('refresh storage failures are propagated without returning token success', async () => {
  redis.setex.mockRejectedValueOnce(fault)
  await expect(tokenService.generateTokens({ id: 'user' })).rejects.toBe(fault)
  redis.get.mockRejectedValueOnce(fault)
  await expect(tokenService.refreshAccessToken(tokens.refreshToken)).rejects.toBe(fault)
  redis.del.mockRejectedValue(fault)
  await expect(tokenService.revokeRefreshToken('user')).rejects.toBe(fault)
  await expect(tokenService.revokeAllUserTokens('user')).rejects.toBe(fault)
})

test('hashed and legacy blacklist records are both enforced by real mounted auth', async () => {
  const digest = crypto.createHash('sha256').update(tokens.accessToken).digest('hex')
  for (const key of [`blacklist:sha256:${digest}`, `blacklist:${tokens.accessToken}`]) {
    data.clear(); data.set(key, 'true')
    const route = mount()
    expect((await route.request.get('/guarded').set('Authorization', `Bearer ${tokens.accessToken}`)).status).toBe(401)
    expect(route.action).not.toHaveBeenCalled()
  }
})

test('expired or malformed tokens need no blacklist write', async () => {
  redis.setex.mockClear()
  await tokenService.blacklistToken('invalid')
  await tokenService.blacklistToken(jwt.sign({ exp: 1 }, env.jwtSecret))
  expect(redis.setex).not.toHaveBeenCalled()
})

test.each(['UserPermissions', 'TenantStatus', 'CustomerTopology', 'LicenseLevelEntitlements'])(
  '%s reads shared changes and never falls back to stale local data', async namespace => {
    const getter = `get${namespace}`, setter = `set${namespace}`
    await cache[setter]('record', { status: 'ENABLED' })
    expect(await cache[getter]('record')).toEqual({ status: 'ENABLED' })
    // Simulate a second instance invalidating the shared entry; no local entry may survive.
    data.clear()
    expect(await cache[getter]('record')).toBeNull()
    await cache[setter]('record', { status: 'DISABLED' })
    expect(await cache[getter]('record')).toEqual({ status: 'DISABLED' })
    redis.get.mockRejectedValueOnce(fault)
    expect(await cache[getter]('record')).toBeNull()
    available = false
    await cache[setter]('record', { status: 'ENABLED' })
    expect(await cache[getter]('record')).toBeNull()
  },
)

test('store emits one atomic increment with expiry and uses stable isolated hashed keys', async () => {
  const first = new SharedRateLimitStore('auth'), second = new SharedRateLimitStore('auth')
  const other = new SharedRateLimitStore('bulk')
  for (const store of [first, second, other]) store.init({ windowMs: 60000 })
  redis.eval.mockResolvedValueOnce([1, 60000]).mockResolvedValueOnce([2, 50000])
  const one = await first.increment('private@example.test')
  const two = await second.increment('private@example.test')
  expect(one.totalHits).toBe(1); expect(two.totalHits).toBe(2)
  expect(two.resetTime.getTime() - Date.now()).toBeGreaterThan(49000)
  expect(redis.eval.mock.calls[0][2]).toBe(redis.eval.mock.calls[1][2])
  expect(redis.eval.mock.calls[0][2]).not.toContain('private@example.test')
  expect(redis.eval.mock.calls[0][0]).toContain("redis.call('PEXPIRE'")
  expect(other.key('private@example.test')).not.toBe(first.key('private@example.test'))
  await first.decrement('private@example.test')
  await first.resetKey('private@example.test')
  expect(redis.del).toHaveBeenCalledWith(first.key('private@example.test'))
  for (const store of [first, second, other]) store.shutdown()
})

test('rate storage errors and missing required Redis deny mounted requests', async () => {
  const route = mount()
  redis.eval.mockRejectedValueOnce(fault)
  expect((await route.request.get('/guarded').set('Authorization', `Bearer ${tokens.accessToken}`)).status).toBe(500)
  expect(route.action).not.toHaveBeenCalled()
  expect(route.errors.mock.calls[0][0]).toBe(fault)
  const store = new SharedRateLimitStore('required')
  store.init({ windowMs: 60000 })
  available = false; env.redisRequired = true
  await expect(store.increment('key')).rejects.toMatchObject({ statusCode: 503 })
  await expect(store.decrement('key')).rejects.toMatchObject({ statusCode: 503 })
  await expect(store.resetKey('key')).rejects.toMatchObject({ statusCode: 503 })
  store.shutdown()
})

test('only optional development can use a local rate store', async () => {
  const store = new SharedRateLimitStore('optional')
  store.init({ windowMs: 60000 })
  available = false
  expect((await store.increment('key')).totalHits).toBe(1)
  expect((await store.increment('key')).totalHits).toBe(2)
  await store.decrement('key')
  expect((await store.increment('key')).totalHits).toBe(2)
  await store.resetKey('key')
  expect((await store.increment('key')).totalHits).toBe(1)
  env.nodeEnv = 'production'
  await expect(store.increment('key')).rejects.toMatchObject({ statusCode: 503 })
  store.shutdown()
})

test('verified users share their quota across IPs but not across identities', async () => {
  const app = express()
  app.set('trust proxy', 1)
  app.use((req, _res, next) => { req.context = {}; next() })
  app.get('/guarded', authJwt, authJwt, (_req, res) => res.sendStatus(204))
  const request = supertest(app)
  for (const [user, ip] of [['first', '192.0.2.1'], ['first', '192.0.2.2'], ['second', '192.0.2.1']]) {
    expect((await request.get('/guarded').set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${makeToken(user)}`)).status).toBe(204)
  }
  expect(redis.eval).toHaveBeenCalledTimes(3)
  expect(redis.eval.mock.calls[0][2]).toBe(redis.eval.mock.calls[1][2])
  expect(redis.eval.mock.calls[0][2]).not.toBe(redis.eval.mock.calls[2][2])
  redis.eval.mockClear()
  expect((await request.get('/guarded').set('Authorization', 'Bearer forged')).status).toBe(401)
  expect(redis.eval).not.toHaveBeenCalled()
})
