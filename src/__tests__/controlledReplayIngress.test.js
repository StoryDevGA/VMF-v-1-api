import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals'

// Actual route validators/controller/action service; authorization and native reads are explicit seams.
// This invokes no router-wide JWT/session middleware, listener, HTTP or persistence transaction.
const nativeService = await import('../services/runtimeInstanceService.js')
const permission = jest.fn(), customerContext = jest.fn()
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...nativeService,
  assertRuntimePermission: permission, assertCustomerTenantContext: customerContext }))
const { default: routes } = await import('../routes/runtimeInstances.routes.js')
const { executeRuntimeAction } = await import('../services/runtimeActionExecutionService.js')
const { acquisitionRequestFingerprint, lookupAcquisitionRequest } = await import('../services/acquisitionRunService.js')
const { RuntimeInstance, FrameworkPackage, AuditLog } = await import('../models/index.js')
const { default: RuntimeAcquisitionRun } = await import('../models/RuntimeAcquisitionRun.js')
const id = '3'.repeat(24), actor = '1'.repeat(24)
const base = () => ({ expectedUpdatedAt: '2026-10-19T12:00:00.000Z' })
const selector = () => ({ bindingId: 'synthetic-binding.1' })
const effects = []
const dispatch = async (body, actionKey = 'BUILD_EVIDENCE_PACK', method = 'post') => {
  const path = method === 'patch' ? '/:runtimeInstanceId/discovery-inputs' : '/:runtimeInstanceId/actions/:actionKey'
  const layer = routes.stack.find(entry => entry.route?.path === path && entry.route.methods[method])
  expect(layer).toBeDefined()
  const req = { body, params: { runtimeInstanceId: id, actionKey }, query: {},
    context: { userId: actor }, scopes: { synthetic: true }, requestId: 'synthetic-handler-chain' }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this } }
  for (const entry of layer.route.stack) {
    let advance = false
    await entry.handle(req, res, error => { if (error) throw error; advance = true })
    if (!advance) break
  }
  return res
}
const expectNoEffects = () => {
  expect(customerContext).not.toHaveBeenCalled()
  effects.forEach(effect => expect(effect).not.toHaveBeenCalled())
}

beforeEach(() => {
  permission.mockReset().mockResolvedValue(undefined)
  customerContext.mockReset().mockRejectedValue(new Error('Unexpected post-guard work'))
  jest.spyOn(RuntimeInstance, 'findOne').mockResolvedValue({ _id: id, runtimeType: 'VALUE_NARRATIVE',
    customerId: '4'.repeat(24), tenantId: '5'.repeat(24) })
  const blocked = () => { throw new Error('Unexpected persistence or external effect') }
  effects.push(jest.spyOn(RuntimeInstance, 'findOneAndUpdate').mockImplementation(blocked),
    jest.spyOn(FrameworkPackage, 'findById').mockImplementation(blocked),
    jest.spyOn(AuditLog, 'createLog').mockImplementation(blocked),
    jest.spyOn(RuntimeAcquisitionRun.collection, 'listIndexes').mockImplementation(blocked),
    jest.spyOn(RuntimeAcquisitionRun, 'findOne').mockImplementation(blocked),
    jest.spyOn(RuntimeAcquisitionRun, 'create').mockImplementation(blocked),
    jest.spyOn(globalThis, 'fetch').mockImplementation(blocked))
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(blocked)
  effects.push(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__)
})
afterEach(() => { jest.restoreAllMocks(); effects.length = 0; delete globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ })

describe('controlled replay disabled in-process route handler chain', () => {
  test.each(['BUILD_EVIDENCE_PACK', 'REFRESH_EVIDENCE_PACK'])('%s returns409 after permission and before admission/effects', async actionKey => {
    const res = await dispatch({ ...base(), controlledReplay: selector() }, actionKey)
    expect(res.statusCode).toBe(409)
    expect(res.body.error.details.reason).toBe('CONTROLLED_REPLAY_NOT_ACTIVATED')
    expect(permission).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor, permission: 'VMF_UPDATE' }))
    expectNoEffects()
  })
  test('permission rejection and rejected permission promise retain fail-closed precedence', async () => {
    permission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN',
      details: { reason: 'FORBIDDEN' } }))
    const res = await dispatch({ ...base(), controlledReplay: selector() })
    expect(res.statusCode).toBe(403)
    const rejected = new Error('Permission dependency unavailable')
    permission.mockRejectedValueOnce(rejected)
    await expect(dispatch({ ...base(), controlledReplay: selector() })).rejects.toBe(rejected)
    expectNoEffects()
  })
  test.each([
    ['malformed', { controlledReplay: { bindingId: 'https://example.test' } }, 'BUILD_EVIDENCE_PACK'],
    ['extra selector field', { controlledReplay: { ...selector(), approved: true } }, 'BUILD_EVIDENCE_PACK'],
    ['raw HTML', { controlledReplay: selector(), html: '<p>blocked</p>' }, 'BUILD_EVIDENCE_PACK'],
    ['mixed inputs', { controlledReplay: selector(), inputs: {} }, 'BUILD_EVIDENCE_PACK'],
    ['mixed documents', { controlledReplay: selector(), documentSources: [] }, 'BUILD_EVIDENCE_PACK'],
    ['nonbuild', { controlledReplay: selector() }, 'RUN_VALIDATION'],
    ['save inputs', { controlledReplay: selector() }, 'SAVE_DISCOVERY_INPUTS'],
  ])('rejects %s at actual validator before service', async (_name, fields, action) => {
    const res = await dispatch({ ...base(), ...fields }, action)
    expect(res.statusCode).toBe(422)
    expect(permission).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expectNoEffects()
  })
  test('discovery inputs PATCH remains strict and gets no controlled selector capability', async () => {
    const res = await dispatch({ ...base(), controlledReplay: selector() }, undefined, 'patch')
    expect(res.statusCode).toBe(422)
    expect(permission).not.toHaveBeenCalled()
    expectNoEffects()
  })
  test.each([null, false, undefined, {}, { bindingId: 'synthetic-binding.1' }])('direct action/lookup/fingerprint refuse own selector value %p', async value => {
    const payload = { ...base(), controlledReplay: value }
    await expect(executeRuntimeAction({ actionKey: 'BUILD_EVIDENCE_PACK', runtimeInstanceId: id,
      actorUserId: actor, scopes: {}, payload })).rejects.toMatchObject({ status: 409,
      details: { reason: 'CONTROLLED_REPLAY_NOT_ACTIVATED' } })
    await expect(lookupAcquisitionRequest({ payload })).rejects.toMatchObject({ status: 409,
      details: { reason: 'CONTROLLED_REPLAY_NOT_ACTIVATED' } })
    expect(() => acquisitionRequestFingerprint({ payload, actionKey: 'BUILD_EVIDENCE_PACK', actorUserId: actor }))
      .toThrow('Controlled replay is not activated')
    expectNoEffects()
  })
  test('absence preserves actual old fingerprint and continues the ordinary action path', async () => {
    expect(acquisitionRequestFingerprint({ payload: base(), actionKey: 'BUILD_EVIDENCE_PACK', actorUserId: actor }))
      .toBe('1ea4cbe6eb4a083a2575e1129b5d4ef30f6f99cc59d747185c210bb24d7e6021')
    const expected = new Error('Ordinary downstream sentinel')
    customerContext.mockRejectedValueOnce(expected)
    await expect(dispatch(base())).rejects.toBe(expected)
    expect(permission).toHaveBeenCalledTimes(1)
    expect(customerContext).toHaveBeenCalledTimes(1)
    effects.forEach(effect => expect(effect).not.toHaveBeenCalled())
  })
})
