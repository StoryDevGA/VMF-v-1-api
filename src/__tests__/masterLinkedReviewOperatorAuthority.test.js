import { jest } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import env from '../config/env.js'
import tokenService from '../services/tokenService.js'
import { readMasterReviewNativeOperator, authenticateMasterReviewNativeOperator } from '../services/masterLinkedReviewOperatorAuthority.js'

// Mounted test adapter for the internal owner, not a released customer route.
// Actual JWT/role resolver, explicit fake database rows; no live connection.
const id = '698b3800f83b3257365fd7a3'
let user, roles, readError, roleError, blacklist, close, connect, app, afterUserRead
const original = { ...env }
const token = (type = 'access') => 'Bearer ' + jwt.sign({ userId: id, type }, env.jwtSecret,
  { issuer: 'storylineos-vmf-api', audience: 'storylineos-vmf-client', expiresIn: 60 })
beforeAll(() => {
  env.appEnv = 'development'; env.mongoUri = 'mongodb://127.0.0.1:1'
  connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockResolvedValue(undefined)
  close = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'close').mockResolvedValue(undefined)
  jest.spyOn(mongoose.mongo.MongoClient.prototype, 'db').mockImplementation(name => {
    expect(name).toBe('test')
    return { collection: collection => {
      expect(['users', 'roles']).toContain(collection)
      return collection === 'users' ? { findOne: async (filter, options) => {
        expect(String(filter._id)).toBe(id); expect(options.projection.passwordHash).toBeUndefined()
        if (readError) throw readError; afterUserRead?.(); return user
      } } : { find: () => ({ limit: () => ({ toArray: async () => { if (roleError) throw roleError; return roles } }) }) }
    } }
  })
  blacklist = jest.spyOn(tokenService, 'isTokenBlacklisted')
  app = express(); app.post('/internal-owner-test', async (req, res, next) => {
    try { res.json(await authenticateMasterReviewNativeOperator(req.headers.authorization)) } catch (error) { next(error) }
  }); app.use((error, _req, res, _next) => res.status(error.status || 503).json({ code: error.code || 'DEPENDENCY_UNAVAILABLE' }))
})
beforeEach(() => {
  user = { _id: id, isActive: true, memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }] }
  roles = [{ key: 'SUPER_ADMIN', scope: 'PLATFORM', isActive: true, permissions: ['VMF_UPDATE'] }]
  readError = null; roleError = null; afterUserRead = null; blacklist.mockReset().mockResolvedValue(false); close.mockClear(); connect.mockClear()
})
afterAll(() => { jest.restoreAllMocks(); Object.assign(env, original) })
test('real access JWT and actual role resolver yield only native authority metadata', async () => {
  const response = await supertest(app).post('/internal-owner-test').set('Authorization', token())
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ realm: 'native-application-test.v1', operatorUserId: id, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(close).toHaveBeenCalledTimes(1); expect(blacklist).toHaveBeenCalledTimes(2)
})
test.each(['missing', 'inactive', 'wrong-id', 'customer-only', 'inactive-role', 'missing-role', 'wrong-scope', 'implicit-role-active'])(
  'native authority rejects %s and closes its connection', async kind => {
    if (kind === 'missing') user = null
    if (kind === 'inactive') user.isActive = false
    if (kind === 'wrong-id') user._id = 'a'.repeat(24)
    if (kind === 'customer-only') user.memberships[0].customerId = 'a'.repeat(24)
    if (kind === 'inactive-role') roles[0].isActive = false
    if (kind === 'missing-role') roles = []
    if (kind === 'wrong-scope') roles[0].scope = 'CUSTOMER'
    if (kind === 'implicit-role-active') delete roles[0].isActive
    // The real driver filters by requested role keys; this fake seam follows it.
    if (kind === 'customer-only') roles = []
    await expect(readMasterReviewNativeOperator(id)).rejects.toMatchObject({ code: 'MASTER_DOCX_RELEASE_HELD' })
    expect(close).toHaveBeenCalledTimes(1)
  })
test.each(['user', 'roles', 'blacklist'] )('mounted adapter rejects %s dependency failure', async kind => {
  if (kind === 'user') readError = Error('OFFLINE')
  if (kind === 'roles') roleError = Error('OFFLINE')
  if (kind === 'blacklist') blacklist.mockRejectedValue(Error('OFFLINE'))
  expect((await supertest(app).post('/internal-owner-test').set('Authorization', token())).status).toBe(503)
})
test.each(['missing', 'refresh', 'revoked', 'revoked-after-read'])('rejects %s credential', async kind => {
  if (kind === 'revoked') blacklist.mockResolvedValue(true)
  if (kind === 'revoked-after-read') blacklist.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await expect(authenticateMasterReviewNativeOperator(kind === 'missing' ? undefined : token(kind === 'refresh' ? 'refresh' : 'access'))).rejects.toMatchObject({ status: 401 })
})
test('changed native permissions change the authority fingerprint', async () => {
  const before = await readMasterReviewNativeOperator(id); roles[0].permissions.push('VMF_VIEW')
  expect((await readMasterReviewNativeOperator(id)).fingerprint).not.toBe(before.fingerprint)
})
test('production context refuses before connecting', async () => {
  env.appEnv = 'production'
  try { await expect(readMasterReviewNativeOperator(id)).rejects.toMatchObject({ details: { reason: 'NATIVE_OPERATOR_CONTEXT' } }); expect(connect).not.toHaveBeenCalled() }
  finally { env.appEnv = 'development' }
})
test('NODE_ENV production refuses even when APP_ENV says development', async () => {
  const old = env.nodeEnv; env.nodeEnv = 'production'
  try { await expect(readMasterReviewNativeOperator(id)).rejects.toThrow(); expect(connect).not.toHaveBeenCalled() }
  finally { env.nodeEnv = old }
})
test('JWT expiring during native read is rejected after the read', async () => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  const authorization = 'Bearer ' + jwt.sign({ userId: id, type: 'access' }, env.jwtSecret,
    { issuer: 'storylineos-vmf-api', audience: 'storylineos-vmf-client', expiresIn: 1 })
  afterUserRead = () => clock.mockReturnValue(now + 1100)
  try { await expect(authenticateMasterReviewNativeOperator(authorization)).rejects.toMatchObject({ status: 401 }) }
  finally { clock.mockRestore() }
})
test('native query exceeding the complete read budget is held and closed', async () => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  afterUserRead = () => clock.mockReturnValue(now + 12001)
  try { await expect(readMasterReviewNativeOperator(id)).rejects.toMatchObject({ details: { reason: 'NATIVE_OPERATOR_DEADLINE' } }); expect(close).toHaveBeenCalled() }
  finally { clock.mockRestore() }
})
