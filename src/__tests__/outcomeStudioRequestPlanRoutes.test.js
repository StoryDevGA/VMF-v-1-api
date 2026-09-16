import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

const operation = jest.fn()
jest.unstable_mockModule('../services/outcomeStudioRequestPlanService.js', () => ({
  planOutcomeStudioRequest: operation, confirmOutcomeStudioRequestPlan: operation,
  retrieveOutcomeStudioRequestPlan: operation,
}))
const { default: tokenService } = await import('../services/tokenService.js')
const { default: cache } = await import('../services/performanceCacheService.js')
const { default: router } = await import('../routes/runtimeInstances.routes.js')
const { User } = await import('../models/index.js')
const app = express()
app.use((req, _res, next) => { req.context = {}; next() })
app.use('/runtime-instances', router)
app.use((_err, _req, res, _next) => res.status(503).json({ error: { code: 'DEPENDENCY_UNAVAILABLE' } }))
const base = '/runtime-instances/6a6c8115bb9cebc18a1eca9c/outcome-studio'
const requestId = '557d3e2e-3adb-4cb4-b71a-a4c256f2f878'
const endpoints = [
  ['post', `${base}/planning`, { prompt: 'Executive brief' }],
  ['post', `${base}/requests/${requestId}/plans`, { continuation: 'opaque', confirm: true }],
  ['get', `${base}/requests/${requestId}/plans/outcome_kcp_${requestId}`, {}],
]
beforeEach(() => {
  jest.restoreAllMocks(); operation.mockReset()
  jest.spyOn(tokenService, 'isTokenBlacklisted').mockResolvedValue(false)
  jest.spyOn(tokenService, 'verifyAccessToken').mockReturnValue({ userId: '6a6b135ba737c717e99b7f8a' })
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue({
    isActive: true, user: {}, platformRoles: ['SUPER_ADMIN'], isPlatformUser: true,
    resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: ['*'] }, customers: [], tenants: [] },
  })
})
afterAll(() => jest.restoreAllMocks())
describe('production planning router authentication and strict boundaries', () => {
  it.each(endpoints)('%s %s rejects missing authentication before planning', async (method, url, body) => {
    const result = await request(app)[method](url).send(body)
    expect(result.status).toBe(401); expect(operation).not.toHaveBeenCalled()
  })
  it.each(['revocation', 'scope-cache', 'user-read'])('fails closed on rejected %s dependency', async (dependency) => {
    if (dependency === 'revocation') tokenService.isTokenBlacklisted.mockRejectedValueOnce(new Error('synthetic Redis failure'))
    if (dependency === 'scope-cache') cache.getUserPermissions.mockRejectedValueOnce(new Error('synthetic cache failure'))
    if (dependency === 'user-read') {
      cache.getUserPermissions.mockResolvedValueOnce(null)
      jest.spyOn(User, 'findById').mockRejectedValueOnce(new Error('synthetic Mongo failure'))
    }
    const result = await request(app).post(`${base}/planning`).set('Authorization', 'Bearer synthetic').send({ prompt: 'brief' })
    expect(result.status).toBe(503); expect(operation).not.toHaveBeenCalled()
  })
  it.each(['requestId', 'planId', 'continuation'])('rejects planning %s at the direct generation body boundary', async (field) => {
    const result = await request(app).post(`${base}/sessions/session/messages/message/generate-response`)
      .set('Authorization', 'Bearer synthetic').send({ [field]: 'not-execution-authority' })
    expect(result.status).toBe(422); expect(operation).not.toHaveBeenCalled()
  })
  it('forwards selected scope to the planning owner only after real middleware and validation', async () => {
    operation.mockResolvedValueOnce({ status: 'CLARIFICATION_REQUIRED', execution: { status: 'BLOCKED', canExecute: false } })
    const result = await request(app).post(`${base}/planning?customerId=customer-a&tenantId=tenant-a`)
      .set('Authorization', 'Bearer synthetic').send({ prompt: 'brief' })
    expect(result.status).toBe(200)
    expect(operation).toHaveBeenCalledWith(expect.objectContaining({ scopes: expect.objectContaining({
      customer: expect.objectContaining({ _id: 'customer-a' }), tenant: expect.objectContaining({ _id: 'tenant-a' }),
    }) }))
  })
})
