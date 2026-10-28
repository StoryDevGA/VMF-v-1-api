import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

const actualRuntimeServices = await import('../services/runtimeInstanceService.js')
const runtime = { _id: '6a0000000000000000000003', customerId: '6a0000000000000000000001',
  tenantId: '6a0000000000000000000002', runtimeType: 'VALUE_NARRATIVE' }
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...actualRuntimeServices,
  getRuntimeInstance: jest.fn(async () => runtime), assertRuntimePermission: jest.fn(async () => {}) }))
const { default: tokenService } = await import('../services/tokenService.js')
const { default: cache } = await import('../services/performanceCacheService.js')
const { default: router } = await import('../routes/runtimeInstances.routes.js')
const { OutcomeSession, OutcomeSuccessorOperation } = await import('../models/index.js')
const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.context = {}; next() })
app.use('/runtime-instances', router)
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code,
  reason: error.reason || error.details?.reason } }))
const base = `/runtime-instances/${runtime._id}/outcome-studio`
const source = { operationId: 'operation', contractVersion: 'outcome-successor.lineage.v1', sourceAssetId: 'source',
  sourceAssetVersionId: 'version', sourceRuntimeInstanceId: '6a0000000000000000000004',
  sourceHash: 'a'.repeat(64), sourceVersionWitnessHash: 'b'.repeat(64), sourceRevisionNumber: 1,
  targetRuntimeInstanceId: runtime._id, targetRevisionNumber: 2, targetStateVersion: 'state',
  requestId: '8abedafd-8555-4342-be49-76ab906a26f6', planId: 'outcome_kcp_8abedafd-8555-4342-be49-76ab906a26f6',
  intentFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64) }
beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(tokenService, 'isTokenBlacklisted').mockResolvedValue(false)
  jest.spyOn(tokenService, 'verifyAccessToken').mockReturnValue({ userId: '6a0000000000000000000005' })
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue({ isActive: true, user: {}, platformRoles: ['SUPER_ADMIN'],
    isPlatformUser: true, resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] }, customers: [], tenants: [] } })
  jest.spyOn(OutcomeSession, 'findOne').mockReturnValue({ lean: async () => ({ sessionId: 'session', status: 'ACTIVE',
    contextBindings: { successor: source, requestPlan: { requestId: source.requestId, planId: source.planId,
      planFingerprint: 'e'.repeat(64) } } }) })
})
describe('mounted generic owner successor guard', () => {
  it('authenticated direct generation rejects missing coordinated claim rather than executing providers', async () => {
    const factory = jest.fn()
    app.locals.outcomeStudioReasoningDeps = { frameworkGuidanceProviderAdapterFactory: factory }
    const result = await request(app).post(`${base}/sessions/session/messages/message/generate-response`)
      .set('Authorization', 'Bearer controlled').send({})
    expect(result.status).toBe(409)
    expect(result.body.error.code).toBe('CONFLICT')
    expect(result.body.error.message).toContain('governed successor action')
    expect(factory).not.toHaveBeenCalled()
  })
  it.each(['claimId', 'operationId', 'successorOperation'])('rejects client-provided %s execution authority', async (field) => {
    const result = await request(app).post(`${base}/sessions/session/messages/message/generate-response`)
      .set('Authorization', 'Bearer controlled').send({ [field]: 'forged' })
    expect(result.status).toBe(422)
  })
  it('failed receipt dependency on a missing session binding rejects instead of normal generation', async () => {
    OutcomeSession.findOne.mockReturnValue({ lean: async () => ({ sessionId: 'session', status: 'ACTIVE',
      contextBindings: { requestPlan: { requestId: source.requestId, planId: source.planId } } }) })
    jest.spyOn(OutcomeSuccessorOperation, 'findOne').mockReturnValue({ maxTimeMS() { return this },
      lean: async () => { throw new Error('receipt dependency unavailable') } })
    const result = await request(app).post(`${base}/sessions/session/messages/message/generate-response`)
      .set('Authorization', 'Bearer controlled').send({})
    expect(result.status).toBe(500)
  })
})
