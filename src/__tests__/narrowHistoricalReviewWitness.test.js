import { jest, test, expect, beforeEach, afterAll } from '@jest/globals'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Audit from '../models/AuditLog.js'
import { NARROW_EXPRESSION_FIXED as fixed } from '../services/commercialDocxApprovedExpression.js'
import { assertPrivateDocxMasterObservation } from '../services/outcomeDocxCandidatePersistenceService.js'
import * as runtimeOwner from '../services/runtimeInstanceService.js'
const masterRead = jest.fn(), runtimeRead = jest.fn(), permission = jest.fn()
jest.unstable_mockModule('../services/outcomeMeaningSourceMasterService.js', () => ({ readMeaningSourceMasterForRendition: masterRead }))
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...runtimeOwner,
  getRuntimeInstance: runtimeRead, assertRuntimePermission: permission }))
const { createApprovedGenuineMasterLinkedCompletedReviewStore: approvedStore,
  createGenuineMasterLinkedCompletedReviewStore, createNetworkQaMasterLinkedCompletedReviewStore,
  createApprovedNetworkQaMasterLinkedCompletedReviewStore } = await import('../services/masterLinkedCompletedReviewService.js')

// Early-refusal/composition tests only. Source/runtime owner and model/index
// seams contain no valid historical bundle or actual admission. They do not
// claim signature, complete-join or actual read success.
// The exact fixed historical body is proved by the separate read-only DB run.
const oldDatabaseName = Execution.db.name
const network = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw Error('NETWORK_FORBIDDEN') })
const provider = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('PROVIDER_FORBIDDEN') })
const args = () => ({ actorUserId: fixed.actorUserId, scopes: { customer: { _id: fixed.customerId },
  tenant: { _id: fixed.tenantId, customerId: fixed.customerId } } })

test('caller-created and serialized master receipts cannot acquire same-operation authority', () => {
  const receipt = { masterReference: { masterId: fixed.masterId, version: 1 }, sourceEnvelope: {} }
  for (const value of [undefined, receipt, JSON.parse(JSON.stringify(receipt))]) {
    expect(() => assertPrivateDocxMasterObservation(value, { ...args(), runtimeInstanceId: fixed.runtimeInstanceId,
      masterId: fixed.masterId, version: 1 })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'CANDIDATE_MASTER_OBSERVATION_INVALID' }) }))
  }
})
const idx = (name, key, extra = {}) => ({ name, key, unique: true, ...extra })
const indexes = new Map([
  [Execution, [idx('executionId_1', { executionId: 1 }), idx('runtimeInstanceId_1_idempotencyKey_1', { runtimeInstanceId: 1, idempotencyKey: 1 },
    { partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } })]],
  [Artifact, [idx('runtimeArtifactId_1', { runtimeArtifactId: 1 })]],
  [Stage, [idx('uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }),
    idx('uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 })]],
  [Audit, [idx('_id_', { _id: 1 })]],
])
let row
const reads = jest.spyOn(Execution, 'findOne').mockImplementation(() => {
  const q = { setOptions: () => q, lean: async () => row }
  return q
})
for (const [model, value] of indexes) jest.spyOn(model.collection, 'indexes').mockResolvedValue(value)
beforeEach(() => {
  Execution.db.name = 'ss044_1619d7db635949898c9abb4592d10bcf'; row = null; reads.mockClear()
  masterRead.mockReset().mockResolvedValue({})
  runtimeRead.mockReset().mockResolvedValue({ _id: fixed.runtimeInstanceId, customerId: fixed.customerId,
    tenantId: fixed.tenantId, runtimeType: 'VALUE_NARRATIVE' })
  permission.mockReset().mockResolvedValue(undefined)
})
afterAll(() => {
  expect(network).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled()
  Execution.db.name = oldDatabaseName; jest.restoreAllMocks()
})

test('only the zero-override approved genuine store exposes the fixed historical witness', () => {
  expect(typeof approvedStore().readNarrowHistoricalFailureWitness).toBe('function')
  for (const store of [createGenuineMasterLinkedCompletedReviewStore(), createNetworkQaMasterLinkedCompletedReviewStore(),
    createApprovedNetworkQaMasterLinkedCompletedReviewStore()]) expect(store.readNarrowHistoricalFailureWitness).toBeUndefined()
  expect(() => approvedStore({ readAuthority: () => {} })).toThrow()
})

test('refuses supplied result, source, QA and dispatch overrides before any model read', async () => {
  const read = approvedStore().readNarrowHistoricalFailureWitness
  for (const field of ['executionId', 'resultFingerprint', 'sourceEnvelope', 'qaCase', 'deps', 'dispatchAvailable']) {
    await expect(read({ ...args(), [field]: 'not-authorised' })).rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_REQUEST' } })
  }
  await expect(read(args(), {}, {})).rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_REQUEST' } })
  expect(reads).not.toHaveBeenCalled()
})

test('refuses a foreign actor or selected customer/tenant scope before any model read', async () => {
  const inputs = [args(), args(), args(), args()]
  inputs[0].actorUserId = 'a'.repeat(24); inputs[1].scopes.customer._id = 'a'.repeat(24)
  inputs[2].scopes.tenant._id = 'a'.repeat(24); inputs[3].scopes.tenant.customerId = 'a'.repeat(24)
  for (const input of inputs) await expect(approvedStore().readNarrowHistoricalFailureWitness(input))
    .rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_SCOPE' } })
  expect(reads).not.toHaveBeenCalled()
})

test('refuses a native or unrelated database owner before any model read', async () => {
  Execution.db.name = 'test'
  await expect(approvedStore().readNarrowHistoricalFailureWitness(args()))
    .rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_DATABASE_OWNER' } })
  expect(reads).not.toHaveBeenCalled()
})

test('queries only the fixed failure in the exact isolated scope and rejects its absence', async () => {
  const input = args()
  await expect(approvedStore().readNarrowHistoricalFailureWitness(input))
    .rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_RESULT_MISSING' } })
  expect(masterRead).toHaveBeenCalledTimes(1)
  expect(masterRead.mock.calls[0][0].scopes).toBe(input.scopes)
  expect(permission).toHaveBeenCalledWith({ actorUserId: fixed.actorUserId, scopes: input.scopes,
    customerId: fixed.customerId, tenantId: fixed.tenantId, permission: 'VMF_UPDATE' })
  expect(reads).toHaveBeenCalledTimes(1)
  expect(reads).toHaveBeenCalledWith({ tenantId: fixed.tenantId, customerId: fixed.customerId,
    runtimeInstanceId: fixed.runtimeInstanceId, executionId: fixed.failedReviewExecutionId })
})

test('a supplied unbranded or cloned observation rejects with no standalone fallback', async () => {
  for (const observation of [{}, JSON.parse(JSON.stringify({ masterReference: { masterId: fixed.masterId, version: 1 } }))]) {
    await expect(approvedStore().readNarrowHistoricalFailureWitness(args(), observation))
      .rejects.toMatchObject({ details: { reason: 'CANDIDATE_MASTER_OBSERVATION_INVALID' } })
  }
  expect(masterRead).not.toHaveBeenCalled(); expect(runtimeRead).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled()
})

test('standalone source time does not consume the separate immutable-leaf budget', async () => {
  let now = 100000
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  masterRead.mockImplementation(async () => { now += 90001; return {} })
  try {
    await expect(approvedStore().readNarrowHistoricalFailureWitness(args()))
      .rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_RESULT_MISSING' } })
    expect(masterRead).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
  } finally { clock.mockRestore() }
})

test('rejects an alternative execution identity or fingerprint before interpreting its result', async () => {
  for (const replacement of [
    { executionId: 'master_docx_result_' + 'a'.repeat(40), executionEvidence: { masterLinkedCompletedReview: { bodyFingerprint: fixed.failedReviewResultFingerprint } } },
    { executionId: fixed.failedReviewExecutionId, executionEvidence: { masterLinkedCompletedReview: { bodyFingerprint: 'a'.repeat(64) } } },
  ]) {
    row = replacement
    await expect(approvedStore().readNarrowHistoricalFailureWitness(args()))
      .rejects.toMatchObject({ details: { reason: 'NARROW_WITNESS_RESULT_CHANGED' } })
  }
})

test('a matching identity alone cannot substitute an unsigned or incomplete result', async () => {
  row = { executionId: fixed.failedReviewExecutionId,
    executionEvidence: { masterLinkedCompletedReview: { bodyFingerprint: fixed.failedReviewResultFingerprint, body: { reviewStatus: 'PASS' } } } }
  await expect(approvedStore().readNarrowHistoricalFailureWitness(args()))
    .rejects.toMatchObject({ details: { reason: 'RESULT_SHAPE' } })
})
