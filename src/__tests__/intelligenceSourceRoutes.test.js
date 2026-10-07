import { beforeEach, expect, jest, test } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const repository = await import('../services/runtimeStateRepository.js')
const sources = jest.fn()
const evidence = jest.fn()
await jest.unstable_mockModule('../services/runtimeStateRepository.js', () => ({
  ...repository, listRuntimeStateSources: sources, listRuntimeStateEvidenceObjects: evidence,
}))
const { isTokenAuthenticationError } = await import('../services/tokenService.js')
await jest.unstable_mockModule('../services/tokenService.js', () => ({ isTokenAuthenticationError,
  default: { isTokenBlacklisted: async token => token === 'revoked', verifyAccessToken: token => {
    if (token !== 'valid') throw new jwt.JsonWebTokenError('invalid token')
    return { userId: '507f1f77bcf86cd799439011', email: 'test@example.test' }
  } } }))
const scopes = { customer: { _id: '507f1f77bcf86cd799439012' },
  tenant: { _id: '507f1f77bcf86cd799439013', customerId: '507f1f77bcf86cd799439012' } }
await jest.unstable_mockModule('../middleware/loadScopes.js', () => ({
  default: (req, _res, next) => { req.scopes = scopes; next() },
}))
const { default: router } = await import('../routes/runtimeInstances.routes.js')
const app = express()
app.use((req, _res, next) => { req.context = {}; req.requestId = 'ss042-route-proof'; next() })
app.use('/runtime', router)
app.use((err, _req, res, _next) => res.status(500).json({ error: { code: 'INTERNAL_ERROR' } }))
beforeEach(() => { jest.clearAllMocks(); sources.mockResolvedValue({ sourceRegistry: [] }); evidence.mockResolvedValue({ evidenceObjects: [] }) })
test.each(['', 'invalid', 'revoked'])('source and evidence reads require authentication (%s)', async token => {
  for (const type of ['sources', 'evidence']) {
    const req = request(app).get(`/runtime/test-revision/state/${type}`)
    if (token) req.set('Authorization', `Bearer ${token}`)
    expect((await req).status).toBe(401)
  }
  expect(sources).not.toHaveBeenCalled(); expect(evidence).not.toHaveBeenCalled()
})
test('source route forwards exact scope and bounded query to canonical repository', async () => {
  const result = await request(app).get('/runtime/test-revision/state/sources')
    .set('Authorization', 'Bearer valid').query({ page: 2, pageSize: 10, search: 'a.*[$]', sourceId: 'source-1', sourceType: 'WEBSITE' })
  expect(result.status).toBe(200)
  expect(sources).toHaveBeenCalledWith({ scopes, runtimeInstanceId: 'test-revision',
    page: '2', pageSize: '10', search: 'a.*[$]', sourceId: 'source-1', sourceType: 'WEBSITE' })
  expect(result.body.meta.storage).toBe('runtime-state-v2-read-only')
})
test('evidence route forwards exact source/evidence focus and global search', async () => {
  await request(app).get('/runtime/test-revision/state/evidence').set('Authorization', 'Bearer valid')
    .query({ sourceId: 'source-1', evidenceObjectId: 'evidence-1', search: 'needle' })
  expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ scopes,
    sourceId: 'source-1', evidenceObjectId: 'evidence-1', search: 'needle' }))
})
test.each([400, 403, 404, 503])('preserves safe canonical read error (%s)', async status => {
  sources.mockRejectedValueOnce(Object.assign(new Error('Unavailable in this scope'), { status, code: 'READ_BLOCKED' }))
  const result = await request(app).get('/runtime/test-revision/state/sources').set('Authorization', 'Bearer valid')
  expect(result.status).toBe(status)
  expect(result.body.error.code).toBe('READ_BLOCKED')
})
