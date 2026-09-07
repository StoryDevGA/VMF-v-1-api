import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import express from 'express'
import request from 'supertest'

const adopt = jest.fn()
const rollback = jest.fn()
const actorId = '507f1f77bcf86cd799439011'
const scopes = { testScope: 'tenant-scoped' }
jest.unstable_mockModule('../services/runtimeReleaseAdoptionService.js', () => ({
  adoptRuntimeRelease: adopt, rollbackRuntimeRelease: rollback,
}))
// Exercise the real JWT middleware; token verification and scope-loading I/O are isolated here.
jest.unstable_mockModule('../services/tokenService.js', () => ({ default: {
  isTokenBlacklisted: async (token) => token === 'revoked',
  verifyAccessToken: (token) => {
    if (token !== 'valid') throw new Error('invalid token')
    return { userId: actorId, email: 'test@example.test' }
  },
} }))
jest.unstable_mockModule('../middleware/loadScopes.js', () => ({
  default: (req, _res, next) => { req.scopes = scopes; next() },
}))
const { default: router } = await import('../routes/runtimeInstances.routes.js')
const app = express()
app.use((req, _res, next) => { req.context = {}; req.requestId = 'release-route-test'; next() })
app.use('/runtime', router)
app.use((err, _req, res, _next) => res.status(500).json({ error: { code: 'INTERNAL_ERROR' } }))
const path = '/runtime/test-runtime/release-adoption'
const forward = { targetPackageId: '607f1f77bcf86cd799439022', targetDeploymentId: 'deployment-successor',
  expectedUpdatedAt: '2026-09-04T14:57:06.181Z', reason: 'Restore governed return to draft' }
const reversal = { operationId: 'a93ecaf3-6c0b-4df3-b5be-8f907ca2c9c3',
  expectedUpdatedAt: forward.expectedUpdatedAt, reason: 'Undo before further work' }

beforeEach(() => { jest.clearAllMocks(); adopt.mockResolvedValue({ operationId: reversal.operationId, refreshRequired: true }); rollback.mockResolvedValue({ operationId: 'reversal', refreshRequired: true }) })

describe('release adoption API wiring (isolated service and identity I/O)', () => {
  test.each(['', 'Bearer invalid', 'Bearer revoked'])('rejects unauthenticated request %s', async (authorization) => {
    const req = request(app).post(path)
    if (authorization) req.set('Authorization', authorization)
    const res = await req.send(forward)
    expect(res.status).toBe(401)
    expect(adopt).not.toHaveBeenCalled()
  })
  test('passes authenticated actor, scopes, audit request and strict payload to service', async () => {
    const res = await request(app).post(path).set('Authorization', 'Bearer valid').send(forward)
    expect(res.status).toBe(200)
    expect(res.body.data.refreshRequired).toBe(true)
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actorId, scopes,
      runtimeInstanceId: 'test-runtime', payload: forward,
      auditRequest: expect.objectContaining({ requestId: 'release-route-test' }) }))
    expect(rollback).not.toHaveBeenCalled()
  })
  test('routes rollback separately', async () => {
    const res = await request(app).post(`${path}/rollback`).set('Authorization', 'Bearer valid').send(reversal)
    expect(res.status).toBe(200)
    expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ payload: reversal }))
    expect(adopt).not.toHaveBeenCalled()
  })
  test.each(['history', 'releaseBindingHistory', 'snapshotHash', 'evidence', 'framework_state', 'stateVersion', 'lockedAt'])('rejects caller-supplied %s', async (key) => {
    const res = await request(app).post(path).set('Authorization', 'Bearer valid').send({ ...forward, [key]: {} })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(adopt).not.toHaveBeenCalled()
  })
  test.each([
    { targetPackageId: 'bad' }, { targetDeploymentId: '' }, { reason: '  ' },
    { expectedUpdatedAt: 'bad' }, { reason: 'x'.repeat(1001) },
  ])('rejects invalid adoption payload %j', async (changes) => {
    const res = await request(app).post(path).set('Authorization', 'Bearer valid').send({ ...forward, ...changes })
    expect(res.status).toBe(422); expect(adopt).not.toHaveBeenCalled()
  })
  test.each([{ operationId: 'bad' }, { reason: '' }, { targetPackageId: forward.targetPackageId }, { history: [] }])(
    'rejects invalid rollback payload %j', async (changes) => {
      const res = await request(app).post(`${path}/rollback`).set('Authorization', 'Bearer valid').send({ ...reversal, ...changes })
      expect(res.status).toBe(422); expect(rollback).not.toHaveBeenCalled()
    },
  )
  test.each([403, 404, 409, 503])('preserves service error status %s and reason', async (status) => {
    adopt.mockRejectedValueOnce(Object.assign(new Error('Blocked'), { status, code: 'RELEASE_BLOCKED', details: { reason: 'test-blocker' } }))
    const res = await request(app).post(path).set('Authorization', 'Bearer valid').send(forward)
    expect(res.status).toBe(status)
    expect(res.body.error).toEqual({ code: 'RELEASE_BLOCKED', message: 'Blocked', details: { reason: 'test-blocker' }, requestId: 'release-route-test' })
  })
  test('forwards unexpected errors without success receipt', async () => {
    adopt.mockRejectedValueOnce(new Error('database failure'))
    const res = await request(app).post(path).set('Authorization', 'Bearer valid').send(forward)
    expect(res.status).toBe(500); expect(res.body.data).toBeUndefined()
  })
})
