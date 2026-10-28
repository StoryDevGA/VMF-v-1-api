import { jest, beforeAll, beforeEach, test, expect } from '@jest/globals'

// Mounted HTTP/auth/scope/validation proof with explicitly stubbed domain owners.
// Native provider execution and persistence are proved by the separate M2 real suite.
const sourceId = '6a0000000000000000000003'
const targetId = '6a0000000000000000000004'
const actorId = '6a0000000000000000000005'
const customerId = '6a0000000000000000000001'
const tenantId = '6a0000000000000000000002'
const key = '12345678-1234-4123-8123-123456789abc'
const versionPath = `/api/v1/runtime-instances/${sourceId}/outcome-studio/assets/asset/versions/historical`
const operationPath = `/api/v1/runtime-instances/${sourceId}/outcome-studio/successor-operations/op`
const owners = Object.fromEntries(['getOutcomeSuccessorPreflightPresentation', 'getOutcomeSelectedVersionPreview',
  'getOutcomeSuccessorCompare', 'getOutcomeSuccessorOperationByKey', 'getOutcomeSuccessorOperationPresentation', 'confirmOutcomeSuccessor',
  'createOutcomeSuccessorOperation', 'getOutcomeSuccessorOperation', 'executeOutcomeSuccessorOperation',
  'reconcileOutcomeSuccessorOperation'].map((name) => [name, jest.fn()]))
let request, tokenService, cache
let sealConfirmation
const operation = { operationId: 'op', status: 'SUCCEEDED', source: { runtimeInstanceId: sourceId },
  target: { runtimeInstanceId: targetId }, result: { draftId: 'draft', draftIterationId: 'iteration' }, idempotent: false }
beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  await jest.unstable_mockModule('../services/outcomeSuccessorService.js', () => ({
    confirmOutcomeSuccessor: owners.confirmOutcomeSuccessor, createOutcomeSuccessorOperation: owners.createOutcomeSuccessorOperation,
    getOutcomeSuccessorOperation: owners.getOutcomeSuccessorOperation }))
  await jest.unstable_mockModule('../services/outcomeSuccessorExecutionService.js', () => ({
    executeOutcomeSuccessorOperation: owners.executeOutcomeSuccessorOperation,
    reconcileOutcomeSuccessorOperation: owners.reconcileOutcomeSuccessorOperation }))
  await jest.unstable_mockModule('../services/outcomeSuccessorPresentationService.js', () => ({
    ...Object.fromEntries(Object.entries(owners).filter(([name]) => /Presentation|Preview|Compare|ByKey/.test(name))),
    projectOutcomeSuccessorOperation: (value) => value.operation || value }))
  const express = (await import('express')).default
  const router = (await import('../routes/runtimeInstances.routes.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  cache = (await import('../services/performanceCacheService.js')).default
  sealConfirmation = (await import('../services/outcomeSuccessorConfirmation.js')).sealOutcomeSuccessorConfirmation
  const app = express()
  app.use((req, _res, next) => { req.context = {}; req.requestId = 'test-request'; next() })
  app.use('/api/v1/runtime-instances', router)
  request = (await import('supertest')).default(app)
})
beforeEach(() => {
  Object.values(owners).forEach((owner) => owner.mockReset())
  jest.spyOn(tokenService, 'isTokenBlacklisted').mockResolvedValue(false)
  jest.spyOn(tokenService, 'verifyAccessToken').mockReturnValue({ userId: actorId })
  jest.spyOn(cache, 'getUserPermissions').mockResolvedValue({ isActive: true, user: { _id: actorId },
    platformRoles: ['SUPER_ADMIN'], memberships: [], tenantMemberships: [], isPlatformUser: true,
    resolvedPermissions: { platform: { roleKeys: [], permissions: [] }, customers: [], tenants: [] } })
  owners.getOutcomeSuccessorPreflightPresentation.mockResolvedValue({ status: 'READY_FOR_CONFIRMATION' })
  owners.getOutcomeSuccessorOperation.mockResolvedValue(operation)
  owners.getOutcomeSuccessorOperationPresentation.mockResolvedValue(operation)
  owners.getOutcomeSelectedVersionPreview.mockResolvedValue({ historical: true })
  owners.getOutcomeSuccessorCompare.mockResolvedValue({ compareAvailable: false, to: null })
  owners.getOutcomeSuccessorOperationByKey.mockResolvedValue({ status: 'NOT_RECORDED', result: null })
  owners.createOutcomeSuccessorOperation.mockResolvedValue(operation)
  owners.executeOutcomeSuccessorOperation.mockResolvedValue({ operation })
  owners.reconcileOutcomeSuccessorOperation.mockResolvedValue({ operation })
})
const auth = (call) => call.set('Authorization', 'Bearer controlled-token').query({ customerId, tenantId })
const create = () => auth(request.post(`${versionPath}/successor`))
const payload = { confirm: true, targetRuntimeInstanceId: targetId, idempotencyKey: key, confirmationReceipt: 'sealed-receipt' }

test.each([`${versionPath}/successor/preflight`, `${versionPath}/preview`, operationPath, `${operationPath}/compare`,
  `${versionPath}/successor/operation-by-key`])('GET %s requires real mounted authentication', async (path) => {
  expect((await request.get(path)).status).toBe(401)
  expect(Object.values(owners).every((owner) => owner.mock.calls.length === 0)).toBe(true)
})
test.each([`${versionPath}/successor`, `${versionPath}/successor/confirmation`, `${operationPath}/reconcile`])('POST %s requires authentication', async (path) => {
  expect((await request.post(path).send({})).status).toBe(401)
})
test('validated customer/tenant selectors pass through actual scope middleware', async () => {
  expect((await auth(request.get(`${versionPath}/successor/preflight`)).query({ targetRuntimeInstanceId: targetId })).status).toBe(200)
  expect(owners.getOutcomeSuccessorPreflightPresentation).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actorId,
    targetRuntimeInstanceId: targetId, scopes: expect.objectContaining({ customer: { _id: customerId },
      tenant: { _id: tenantId, customerId } }) }))
  expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
})
test.each([{ actorUserId: actorId }, { customerId: 'invalid' }, { tenantId: 'invalid' }, { claimId: 'fake' }])('unsupported/invalid GET query fails closed %j', async (query) => {
  expect((await auth(request.get(`${versionPath}/preview`)).query(query)).status).toBe(422)
  expect(owners.getOutcomeSelectedVersionPreview).not.toHaveBeenCalled()
})
test.each([{ ...payload, confirm: false }, { ...payload, claimId: 'fake' }, { ...payload, customerId },
  { ...payload, actorUserId: actorId }, { ...payload, targetRuntimeInstanceId: null }, { ...payload, idempotencyKey: 'bad' },
  { ...payload, confirmationReceipt: 'x'.repeat(32769) }, { ...payload, confirmationReceipt: '' }])('strict create rejects before owners', async (body) => {
  const result = await create().send(body)
  expect(result.status).toBe(422)
  expect(owners.createOutcomeSuccessorOperation).not.toHaveBeenCalled()
  expect(JSON.stringify(result.body)).not.toContain('sealed-receipt')
})
test.each([null, ''])('optional confirmation target rejects %j', async (targetRuntimeInstanceId) => {
  expect((await auth(request.post(`${versionPath}/successor/confirmation`)).send({ idempotencyKey: key, targetRuntimeInstanceId })).status).toBe(422)
})
test('fresh creation dispatches once and returns persisted result', async () => {
  expect((await create().send(payload)).status).toBe(201)
  expect(owners.executeOutcomeSuccessorOperation).toHaveBeenCalledTimes(1)
  expect(owners.executeOutcomeSuccessorOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op', actorUserId: actorId }))
})
test.each(['SUCCEEDED', 'GENERATING', 'RECOVERY_REQUIRED', 'PREPARING'])('existing/expired-token %s readback never redispatches', async (status) => {
  owners.createOutcomeSuccessorOperation.mockResolvedValue({ ...operation, status, idempotent: true })
  expect((await create().send(payload)).status).toBe(status === 'SUCCEEDED' ? 200 : 202)
  expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
})
test('readback by key is passive and requires exact stored target/key', async () => {
  expect((await auth(request.get(`${versionPath}/successor/operation-by-key`))).status).toBe(422)
  const result = await auth(request.get(`${versionPath}/successor/operation-by-key`)).query({ targetRuntimeInstanceId: targetId, idempotencyKey: key })
  expect(result.body.data).toEqual({ status: 'NOT_RECORDED', result: null })
  expect(owners.createOutcomeSuccessorOperation).not.toHaveBeenCalled()
  expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
})
test('late authorization error remains 403 and raw exception details do not leak', async () => {
  owners.getOutcomeSuccessorPreflightPresentation.mockRejectedValue(Object.assign(new Error('provider secret private-token'), { status: 403 }))
  const result = await auth(request.get(`${versionPath}/successor/preflight`))
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.body)).not.toMatch(/private-token|provider secret/)
  expect(owners.createOutcomeSuccessorOperation).not.toHaveBeenCalled()
})
test('unknown partial execution error uses neutral saved-result wording', async () => {
  owners.executeOutcomeSuccessorOperation.mockRejectedValue(new Error('secret internals'))
  const result = await create().send(payload)
  expect(result.status).toBe(500)
  expect(result.body.error.message).toMatch(/Check the saved result/)
  expect(JSON.stringify(result.body)).not.toMatch(/No changes were made|secret internals/)
})
test('reconcile strict empty body invokes only reconciliation', async () => {
  expect((await auth(request.post(`${operationPath}/reconcile`)).send({ claimId: 'fake' })).status).toBe(422)
  expect((await auth(request.post(`${operationPath}/reconcile`)).send({})).status).toBe(200)
  expect(owners.reconcileOutcomeSuccessorOperation).toHaveBeenCalledTimes(1)
  expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
})
test('confirmation returns exact sealed selection, expiry and descriptors without dispatch', async () => {
  const source = { runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
    sourceHash: 'a'.repeat(64), sourceVersionWitnessHash: 'b'.repeat(64) }
  const target = { runtimeInstanceId: targetId, stateVersion: 'state' }
  const binding = { actorUserId: actorId, requestId: key, idempotencyKey: key, source, target,
    metadataFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64), intentFingerprint: 'e'.repeat(64) }
  const receipt = sealConfirmation(binding)
  owners.confirmOutcomeSuccessor.mockResolvedValue({ source, target, requestId: key, idempotencyKey: key, confirmation: { receipt } })
  owners.getOutcomeSuccessorPreflightPresentation.mockImplementation(async (args) => {
    const canonical = { status: 'READY_FOR_CONFIRMATION', source, target, metadataFingerprint: binding.metadataFingerprint,
      carryForward: { contractFingerprint: binding.contractFingerprint, intentFingerprint: binding.intentFingerprint } }
    args.captureCanonicalPreflight(canonical)
    expect(args.deps.successorRequestId).toBe(binding.requestId)
    return { ...canonical, target: { ...target, evidenceSnapshot: { status: 'UNAVAILABLE' } } }
  })
  const result = await auth(request.post(`${versionPath}/successor/confirmation`)).send({ targetRuntimeInstanceId: targetId, idempotencyKey: key })
  expect(result.status).toBe(200)
  expect(result.body.data.confirmation.receipt).toBe(receipt)
  expect(result.body.data.confirmation.expiresAt).toMatch(/Z$/)
  expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
  owners.getOutcomeSuccessorPreflightPresentation.mockResolvedValue({ status: 'BLOCKED' })
  expect((await auth(request.post(`${versionPath}/successor/confirmation`)).send({ targetRuntimeInstanceId: targetId, idempotencyKey: key })).status).toBe(409)
})
test.each([['GET', `${versionPath}/successor/preflight`, 'getOutcomeSuccessorPreflightPresentation'],
  ['GET', `${versionPath}/preview`, 'getOutcomeSelectedVersionPreview'], ['GET', operationPath, 'getOutcomeSuccessorOperationPresentation'],
  ['GET', `${operationPath}/compare`, 'getOutcomeSuccessorCompare'], ['POST', `${versionPath}/successor`, 'createOutcomeSuccessorOperation'],
  ['POST', `${versionPath}/successor/confirmation`, 'confirmOutcomeSuccessor'], ['POST', `${operationPath}/reconcile`, 'reconcileOutcomeSuccessorOperation']])(
  '%s %s propagates independently denied owner permission', async (method, path, owner) => {
    owners[owner].mockRejectedValue(Object.assign(new Error('target denied'), { status: 403 }))
    const call = auth(request[method.toLowerCase()](path))
    const response = await (method === 'POST' ? call.send(path.endsWith('confirmation') ? { idempotencyKey: key }
      : path.endsWith('reconcile') ? {} : payload) : call)
    expect(response.status).toBe(403)
    expect(owners.executeOutcomeSuccessorOperation).not.toHaveBeenCalled()
  })
test('invalid source identity is rejected before any owner lookup', async () => {
  expect((await auth(request.get(versionPath.replace(sourceId, '!invalid!') + '/preview'))).status).toBe(422)
  expect(owners.getOutcomeSelectedVersionPreview).not.toHaveBeenCalled()
  expect((await auth(request.get(versionPath.replace(sourceId, 'value-narrative-display-key') + '/preview'))).status).toBe(422)
})
test('loadScopes rejects disabled actor before owner lookup', async () => {
  cache.getUserPermissions.mockResolvedValue({ isActive: false })
  expect((await auth(request.get(`${versionPath}/preview`))).status).toBe(401)
  expect(owners.getOutcomeSelectedVersionPreview).not.toHaveBeenCalled()
})
