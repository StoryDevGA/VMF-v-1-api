import { jest } from '@jest/globals'

describe('synthetic isolation on already-created successor operations', () => {
  it.each(['source', 'target'])('execute rejects synthetic %s before successful replay or provider work', async side => {
    const { args, deps, operation } = setup()
    const root = '6ace5ee09bd4472c6be0cb07'
    operation[side === 'source' ? 'sourceRuntimeInstanceId' : 'targetRuntimeInstanceId'] = root
    if (side === 'source') args.runtimeInstanceId = root
    operation.status = 'SUCCEEDED'
    await expect(executeOutcomeSuccessorOperation(args)).rejects.toMatchObject({ code: 'SYNTHETIC_OUTCOME_ISOLATED', status: 409 })
    expect(deps.readOwnerState).not.toHaveBeenCalled()
    expect(deps.mongoose.startSession).not.toHaveBeenCalled()
    expect(deps.generateResponse).not.toHaveBeenCalled()
  })
  it.each(['source', 'target'])('reconcile rejects synthetic %s before exposing existing owners', async side => {
    const { args, deps, operation } = setup()
    const root = '6ace5ee09bd4472c6be0cb07'
    operation[side === 'source' ? 'sourceRuntimeInstanceId' : 'targetRuntimeInstanceId'] = root
    if (side === 'source') args.runtimeInstanceId = root
    operation.status = 'SUCCEEDED'
    await expect(reconcileOutcomeSuccessorOperation(args)).rejects.toMatchObject({ code: 'SYNTHETIC_OUTCOME_ISOLATED', status: 409 })
    expect(deps.readOwnerState).not.toHaveBeenCalled()
    expect(deps.mongoose.startSession).not.toHaveBeenCalled()
    expect(deps.generateResponse).not.toHaveBeenCalled()
  })
})
import { executeOutcomeSuccessorOperation, reconcileOutcomeSuccessorOperation,
  verifyOutcomeSuccessorOperationCurrentness } from '../services/outcomeSuccessorExecutionService.js'

const actorUserId = '6a0000000000000000000005'
const sourceId = '6a0000000000000000000003'
const targetId = '6a0000000000000000000004'
const setup = () => {
  const source = { runtimeInstanceId: sourceId, customerId: '6a0000000000000000000001',
    tenantId: '6a0000000000000000000002', outcomeAssetId: 'asset', outcomeAssetVersionId: 'version',
    sourceHash: 'a'.repeat(64), sourceVersionWitnessHash: 'b'.repeat(64) }
  const target = { runtimeInstanceId: targetId, stateVersion: 'target-state' }
  const operation = { _id: 'operation-db', operationId: 'operation', customerId: source.customerId,
    tenantId: source.tenantId, sourceRuntimeInstanceId: sourceId, targetRuntimeInstanceId: targetId,
    sourceAssetId: 'asset', sourceAssetVersionId: 'version', requestId: 'request', payloadFingerprint: 'payload',
    status: 'PREPARING', claimId: '', refs: {}, binding: { source, target, metadataFingerprint: 'c'.repeat(64) } }
  const query = (value) => ({ session() { return this }, maxTimeMS() { return this }, lean: async () => value })
  const state = { plan: null, ownerSession: null, message: null, draft: null, iteration: null }
  const dbSession = { withTransaction: jest.fn(async (callback) => callback()), endSession: jest.fn(async () => {}) }
  const model = { findOne: jest.fn(() => query(structuredClone(operation))), updateOne: jest.fn(async (filter, update) => {
    if (filter.claimId === '' && operation.claimId) return { modifiedCount: 0, matchedCount: 0 }
    Object.assign(operation, update.$set); return { modifiedCount: 1, matchedCount: 1 }
  }) }
  const deps = { OutcomeSuccessorOperation: model,
    mongoose: { startSession: jest.fn(async () => dbSession) }, readRuntimeControl: jest.fn(async ({ runtimeInstanceId }) => ({
      _id: runtimeInstanceId, customerId: source.customerId, tenantId: source.tenantId, runtimeType: 'VALUE_NARRATIVE' })),
    assertRuntimePermission: jest.fn(async () => {}), getPreflight: jest.fn(async ({ deps: preflightDeps }) => {
      preflightDeps.capturePreflightContext({ targetRuntime: { updatedAt: 'now' }, sourcePlan: { payload: { consumerIntent: { originalRequest: 'Original' } } },
        candidate: { planFingerprint: 'candidate' } })
      return { status: 'READY_FOR_CONFIRMATION', source, target, metadataFingerprint: 'c'.repeat(64) }
    }), readOwnerState: jest.fn(async () => ({ ...state })),
    readRecordedFailure: jest.fn(async () => null),
    createPlan: jest.fn(async () => { state.plan = { planId: 'plan', planFingerprint: 'candidate' } }),
    createSession: jest.fn(async () => { state.ownerSession = { sessionId: 'session' }; state.message = { messageId: 'message', responseStatus: 'PENDING_RESPONSE' } }),
    generateResponse: jest.fn(async () => { state.draft = { draftId: 'draft' }; state.iteration = { draftIterationId: 'iteration' } }),
    writeCompletionAudit: jest.fn(async () => ({ signature: 'owned' })) }
  return { args: { actorUserId, runtimeInstanceId: sourceId, operationId: 'operation', scopes: {}, deps },
    deps, operation, state, dbSession }
}
describe('governed successor owner orchestration', () => {
  it('claims once, uses original intent and existing owners, then fresh readback before success', async () => {
    const { args, deps, operation, dbSession } = setup()
    const result = await executeOutcomeSuccessorOperation(args)
    expect(result.operation.status).toBe('SUCCEEDED')
    expect(deps.createPlan.mock.calls[0][0].consumerIntent.originalRequest).toBe('Original')
    expect(deps.createSession.mock.calls[0][0].successorOperation.claimId).toBe(operation.claimId)
    expect(deps.generateResponse.mock.calls[0][0].successorOperation.claimId).toBe(operation.claimId)
    expect(deps.generateResponse.mock.calls[0][0].executionMode).toBe('LIVE_TEST')
    expect(deps.getPreflight.mock.calls[0][0].deps.session).toBe(dbSession)
    expect(deps.readOwnerState.mock.calls.some(([call]) => call.session === dbSession)).toBe(true)
    expect(deps.writeCompletionAudit).toHaveBeenCalledTimes(1)
  })
  it('duplicate execution retrieves existing operation without another provider', async () => {
    const { args, deps } = setup()
    await executeOutcomeSuccessorOperation(args)
    expect((await executeOutcomeSuccessorOperation(args)).idempotent).toBe(true)
    expect(deps.generateResponse).toHaveBeenCalledTimes(1)
  })
  it('does not steal an active/uncertain executor or replay its providers', async () => {
    const { args, operation, deps } = setup(); operation.claimId = 'other-executor'; operation.status = 'RECOVERY_REQUIRED'
    expect((await executeOutcomeSuccessorOperation(args)).executionPending).toBe(true)
    expect(deps.generateResponse).not.toHaveBeenCalled()
    expect(deps.createPlan).not.toHaveBeenCalled()
  })
  it('blocked source/target currentness prevents claim and every owner call', async () => {
    const { args, deps } = setup(); deps.getPreflight.mockImplementation(async () => ({ status: 'BLOCKED' }))
    await expect(executeOutcomeSuccessorOperation(args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_CONFIRMATION_STALE' })
    expect(deps.OutcomeSuccessorOperation.updateOne).not.toHaveBeenCalled()
    expect(deps.createPlan).not.toHaveBeenCalled()
  })
  it('refuses changed full witness and keeps provider failure as honest recovery', async () => {
    const first = setup(); const original = first.deps.getPreflight.getMockImplementation()
    first.deps.getPreflight.mockImplementation(async (args) => ({ ...await original(args),
      source: { ...first.operation.binding.source, sourceVersionWitnessHash: 'changed' } }))
    await expect(verifyOutcomeSuccessorOperationCurrentness({ operation: first.operation, actorUserId, scopes: {},
      session: first.dbSession, deps: first.deps })).rejects.toThrow()
    const second = setup(); second.deps.generateResponse.mockRejectedValue(new Error('provider unavailable'))
    await expect(executeOutcomeSuccessorOperation(second.args)).rejects.toThrow('provider unavailable')
    expect(second.operation.status).toBe('RECOVERY_REQUIRED')
    expect(second.state.draft).toBeNull()
    await executeOutcomeSuccessorOperation(second.args)
    expect(second.deps.generateResponse).toHaveBeenCalledTimes(1)
  })
  it('reconciles a committed governed draft without calling any provider again', async () => {
    const { args, deps, operation, state } = setup(); operation.claimId = 'executor'; operation.status = 'RECOVERY_REQUIRED'
    Object.assign(state, { plan: { planId: 'plan' }, ownerSession: { sessionId: 'session' }, message: { messageId: 'message' },
      draft: { draftId: 'draft' }, iteration: { draftIterationId: 'iteration' } })
    expect((await reconcileOutcomeSuccessorOperation(args)).operation.status).toBe('SUCCEEDED')
    expect(deps.createPlan).not.toHaveBeenCalled(); expect(deps.createSession).not.toHaveBeenCalled()
    expect(deps.generateResponse).not.toHaveBeenCalled()
  })
  it('known incomplete owners remain recoverable, never fabricated as a draft', async () => {
    const { args, deps, operation } = setup(); operation.claimId = 'executor'; operation.status = 'RECOVERY_REQUIRED'
    expect((await reconcileOutcomeSuccessorOperation(args)).recoveryRequired).toBe(true)
    expect(deps.writeCompletionAudit).not.toHaveBeenCalled()
  })
  it('uses an actual persisted rejection to distinguish blocked from uncertain execution', async () => {
    const { args, deps, operation } = setup()
    deps.generateResponse.mockRejectedValue(new Error('meaning review failed'))
    deps.readRecordedFailure.mockResolvedValue({ status: 'FAILED', failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' } })
    await expect(executeOutcomeSuccessorOperation(args)).rejects.toThrow('meaning review failed')
    expect(operation.status).toBe('BLOCKED')
    expect(operation.blockerReason).toBe('ARL_MEANING_REVIEW_REQUIRED_CHANGE')
  })
})
