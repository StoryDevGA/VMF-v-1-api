import { jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { sealOutcomeSuccessorConfirmation, openOutcomeSuccessorConfirmation,
  outcomeSuccessorConfirmationFingerprint } from '../services/outcomeSuccessorConfirmation.js'
import { confirmOutcomeSuccessor, createOutcomeSuccessorOperation } from '../services/outcomeSuccessorService.js'

const actor = '6a0000000000000000000005'
const source = { runtimeInstanceId: '6a0000000000000000000003', customerId: '6a0000000000000000000001',
  tenantId: '6a0000000000000000000002', workspaceId: 'workspace', outcomeAssetId: 'asset', outcomeAssetVersionId: 'version',
  sourceHash: 'a'.repeat(64), sourceVersionWitnessHash: 'e'.repeat(64), revisionNumber: 1 }
const target = { ...source, stateVersion: 'state' }
const fixture = () => ({ actorUserId: actor, source: { ...source }, target: { ...target },
  idempotencyKey: randomUUID(), requestId: randomUUID(), metadataFingerprint: 'b'.repeat(64),
  intentFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64) })
const depsFor = () => ({ receiptSecret: 'controlled-test-secret-'.repeat(3), now: () => 1000 })
const runtime = { _id: source.runtimeInstanceId, customerId: source.customerId, tenantId: source.tenantId,
  workspaceId: 'workspace', runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: 'p', packageKey: 'pk',
  packageVersion: '1', stateVersion: 'state', revision: { revisionNumber: 1 }, status: 'LOCKED',
  evidence: { dependencySnapshotId: 'snapshot', dependencySnapshotHash: 'hash' } }
const preflight = { status: 'READY_FOR_CONFIRMATION', source, target, metadataFingerprint: 'b'.repeat(64),
  carryForward: { intentFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64) } }
const serviceDeps = () => ({ ...depsFor(), readRuntimeControl: jest.fn(async () => runtime),
  assertRuntimePermission: jest.fn(async () => {}), readOperationByKey: jest.fn(async () => null),
  getPreflight: jest.fn(async () => preflight), claimOperation: jest.fn(async ({ binding }) => ({
    operation: { operationId: 'operation', status: 'PREPARING', requestId: binding.requestId,
      binding: { source: binding.source, target: binding.target } }, idempotent: false })) })
const createArgs = (binding, deps) => ({ actorUserId: actor, runtimeInstanceId: source.runtimeInstanceId,
  outcomeAssetId: 'asset', outcomeAssetVersionId: 'version', targetRuntimeInstanceId: target.runtimeInstanceId,
  idempotencyKey: binding.idempotencyKey, confirmationReceipt: sealOutcomeSuccessorConfirmation(binding, deps), confirm: true,
  scopes: {}, deps })

describe('successor confirmation receipt', () => {
  it('round trips actor/source/target/key binding and rejects tamper or wrong key', () => {
    const binding = fixture(); const deps = depsFor(); const token = sealOutcomeSuccessorConfirmation(binding, deps)
    expect(openOutcomeSuccessorConfirmation(token, deps)).toMatchObject(binding)
    expect(() => openOutcomeSuccessorConfirmation(`${token.slice(0, -4)}xxxx`, deps)).toThrow()
    expect(() => openOutcomeSuccessorConfirmation(token, { ...deps, receiptSecret: 'wrong-secret'.repeat(4) })).toThrow()
  })
  it.each([{ purpose: 'other' }, { version: 2 }, { requestId: 'invalid' }, { idempotencyKey: 'invalid' },
    { metadataFingerprint: 'invalid' }])('rejects incompatible claims %j', (changes) => {
    const deps = depsFor(); expect(() => openOutcomeSuccessorConfirmation(sealOutcomeSuccessorConfirmation({ ...fixture(), ...changes }, deps), deps)).toThrow()
  })
  it('rejects expired receipt for execution but permits authenticated persisted readback decoding', () => {
    const deps = depsFor(); const token = sealOutcomeSuccessorConfirmation(fixture(), deps)
    const expired = { ...deps, now: () => 1801000 }
    expect(() => openOutcomeSuccessorConfirmation(token, expired)).toThrow()
    expect(openOutcomeSuccessorConfirmation(token, expired, { allowExpired: true }).requestId).toBeTruthy()
  })
  it('fails closed with unavailable signing key and fingerprints semantic bindings only', () => {
    expect(() => sealOutcomeSuccessorConfirmation(fixture(), { receiptSecret: 'short' })).toThrow()
    const binding = fixture()
    expect(outcomeSuccessorConfirmationFingerprint(binding)).toBe(outcomeSuccessorConfirmationFingerprint({ ...binding, expiresAt: 123 }))
  })
})
describe('successor preparation without generation', () => {
  it('defaults confirmation target to source, requires UPDATE twice and carries fixed new request identity', async () => {
    const deps = serviceDeps(); const result = await confirmOutcomeSuccessor({ actorUserId: actor,
      runtimeInstanceId: source.runtimeInstanceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'version',
      idempotencyKey: randomUUID(), scopes: {}, deps })
    expect(result.target.runtimeInstanceId).toBe(source.runtimeInstanceId)
    expect(deps.assertRuntimePermission.mock.calls.map(([args]) => args.permission)).toEqual(['VMF_UPDATE', 'VMF_UPDATE'])
    expect(deps.getPreflight.mock.calls[0][0].deps.successorRequestId).toBe(result.requestId)
    expect(result.confirmation.executable).toBe(false)
  })
  it('reuses request identity on identical confirmation retries before any claim exists', async () => {
    const deps = serviceDeps(); const args = { actorUserId: actor, runtimeInstanceId: source.runtimeInstanceId,
      outcomeAssetId: 'asset', outcomeAssetVersionId: 'version', idempotencyKey: randomUUID(), scopes: {}, deps }
    const first = await confirmOutcomeSuccessor(args)
    const second = await confirmOutcomeSuccessor(args)
    expect(second.requestId).toBe(first.requestId)
    expect(openOutcomeSuccessorConfirmation(second.confirmation.receipt, deps).metadataFingerprint)
      .toBe(openOutcomeSuccessorConfirmation(first.confirmation.receipt, deps).metadataFingerprint)
  })
  it('claims only revalidated confirmation, with no draft/execution result', async () => {
    const deps = serviceDeps(); const result = await createOutcomeSuccessorOperation(createArgs(fixture(), deps))
    expect(result).toMatchObject({ status: 'PREPARING', result: null, execution: { canExecute: false } })
    expect(deps.claimOperation).toHaveBeenCalledTimes(1)
  })
  it.each(['actorUserId', 'targetRuntimeInstanceId', 'outcomeAssetVersionId', 'idempotencyKey'])('rejects changed %s before claim', async (field) => {
    const deps = serviceDeps(); await expect(createOutcomeSuccessorOperation({ ...createArgs(fixture(), deps), [field]: 'changed' })).rejects.toThrow()
    expect(deps.claimOperation).not.toHaveBeenCalled()
  })
  it('rejects stale preflight and rejected target permission before claim', async () => {
    const deps = serviceDeps(); deps.getPreflight.mockResolvedValue({ ...preflight, metadataFingerprint: 'f'.repeat(64) })
    await expect(createOutcomeSuccessorOperation(createArgs(fixture(), deps))).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_CONFIRMATION_STALE' })
    expect(deps.claimOperation).not.toHaveBeenCalled()
    const other = serviceDeps(); other.assertRuntimePermission.mockRejectedValue(new Error('denied'))
    await expect(createOutcomeSuccessorOperation(createArgs(fixture(), other))).rejects.toThrow('denied')
  })
  it.each(['warning', 'lineage', 'record metadata'])('rejects changed full source witness for %s before claim', async () => {
    const deps = serviceDeps(); deps.getPreflight.mockResolvedValue({ ...preflight,
      source: { ...source, sourceVersionWitnessHash: 'f'.repeat(64) } })
    await expect(createOutcomeSuccessorOperation(createArgs(fixture(), deps))).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_CONFIRMATION_STALE' })
    expect(deps.claimOperation).not.toHaveBeenCalled()
  })
  it('returns one existing identity on expired retry but never permits an expired new claim', async () => {
    const binding = fixture(); const deps = serviceDeps(); const args = createArgs(binding, deps)
    deps.now = () => 1801000
    await expect(createOutcomeSuccessorOperation(args)).rejects.toThrow()
    expect(deps.claimOperation).not.toHaveBeenCalled()
    deps.readOperationByKey.mockResolvedValue({ operationId: 'winner', requestId: binding.requestId, status: 'PREPARING',
      payloadFingerprint: outcomeSuccessorConfirmationFingerprint(binding), binding: { source, target } })
    expect(await createOutcomeSuccessorOperation(args)).toMatchObject({ operationId: 'winner', idempotent: true, requestId: binding.requestId })
    expect(deps.getPreflight).not.toHaveBeenCalled()
  })
})
