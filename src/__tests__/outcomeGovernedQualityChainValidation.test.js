import { describe, expect, test } from '@jest/globals'
import { validateOutcomeGovernedQualityChain } from '../services/outcomeGovernedQualityChainValidationService.js'
import { makeRequestScopedQualityChain, makeRemediatedRequestScopedQualityChain, buildFailure } from './fixtures/outcomeQualityStageFixtures.js'

const requestBinding = {
  requestId: '8abedafd-8555-4342-be49-76ab906a26f6',
  draftId: 'outcome_draft_8d91bfbd-6670-4cfe-807b-a6d41bd4181e',
  draftIterationId: 'outcome_draft_iteration_5eebbe35-cfba-47d0-883f-e0cb408c1905',
}
const fixture = () => ({ ...makeRequestScopedQualityChain(requestBinding), requestBinding })
describe('exact accepted governed quality chain', () => {
  test('recomputes the real canonical chain without mutating its source history', () => {
    const input = fixture()
    const before = JSON.stringify(input)
    expect(validateOutcomeGovernedQualityChain(input)).toEqual(input.stages)
    expect(JSON.stringify(input)).toBe(before)
  })
  test('accepts recorded successful expression remediation while retaining failed RL and prior shaping', () => {
    const input = makeRemediatedRequestScopedQualityChain(requestBinding)
    const before = JSON.stringify(input.stages)
    expect(validateOutcomeGovernedQualityChain(input)).toEqual(input.recordedStages)
    expect(input.stages).toHaveLength(8)
    expect(JSON.stringify(input.stages)).toBe(before)
  })
  test('accepts an eligible same-stage provider retry and rejects a non-retryable predecessor', () => {
    const initial = fixture()
    const prior = { stageExecutionId: 'guidance_failed', ...buildFailure('FAILED', { plan: initial.plan, requestBinding }) }
    const input = { ...makeRequestScopedQualityChain(requestBinding, { frameworkGuidancePrior: prior }), requestBinding }
    input.recordedStages = [...input.stages]
    input.stages = [prior, ...input.stages]
    expect(validateOutcomeGovernedQualityChain(input)).toEqual(input.recordedStages)
    const disallowed = { stageExecutionId: 'guidance_failed', ...buildFailure('FAILED', {
      plan: initial.plan, requestBinding,
      failure: { failureCode: 'PROVIDER_INCOMPLETE', safeReason: 'Incomplete provider.', retryable: false },
    }) }
    const rejected = { ...makeRequestScopedQualityChain(requestBinding, { frameworkGuidancePrior: disallowed }), requestBinding }
    rejected.recordedStages = [...rejected.stages]
    rejected.stages = [disallowed, ...rejected.stages]
    expect(() => validateOutcomeGovernedQualityChain(rejected)).toThrow()
  })
  test.each(['inputFingerprint', 'outputFingerprint', 'attemptFingerprint'])('rejects forged %s even when recorded entry repeats the forgery', (key) => {
    const input = fixture()
    input.stages[4][key] = 'f'.repeat(64)
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
  })
  test.each(['inputSnapshot', 'outputSnapshot'])('rejects altered %s independently of stored hashes', (key) => {
    const input = fixture()
    input.stages[4][key].unownedField = 'corruption'
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
  })
  test.each(['tenantId', 'customerId', 'runtimeInstanceId', 'requestId', 'draftId', 'draftIterationId', 'planId', 'planFingerprint'])('rejects cross-binding %s', (key) => {
    const input = fixture()
    input.stages[4][key] = 'unrelated'
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
  })
  test('rejects a stale accepted stage when newer failed history exists', () => {
    const input = fixture()
    input.recordedStages = [...input.stages]
    input.stages.push({ ...input.stages[5], stageExecutionId: 'later_failed_rl', attemptNumber: 2, status: 'FAILED' })
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
  })
  test('rejects missing accepted predecessor and duplicate stage identity', () => {
    const input = fixture()
    input.recordedStages = [...input.stages]
    input.stages = input.stages.slice(1)
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
    const duplicate = fixture()
    duplicate.stages[4].stageExecutionId = duplicate.stages[3].stageExecutionId
    expect(() => validateOutcomeGovernedQualityChain(duplicate)).toThrow()
  })
  test('rejects changed accepted runtime and a plan with forged fingerprint', () => {
    const input = fixture()
    input.runtime.packageKey = 'different-package'
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
    const forged = fixture()
    forged.plan.payload.consumerIntent.outcome = 'Changed intent'
    expect(() => validateOutcomeGovernedQualityChain(forged)).toThrow()
  })
  test.each([2, 5])('rejects failed required ARL/RL stage %s', (index) => {
    const input = fixture()
    input.stages[index].status = 'FAILED'
    expect(() => validateOutcomeGovernedQualityChain(input)).toThrow()
  })
  test('rejects missing or corrupt remediation receipt and altered predecessor', () => {
    const missing = makeRemediatedRequestScopedQualityChain(requestBinding)
    missing.stages = missing.stages.filter((stage) => stage.stageExecutionId !== 'rl_failed')
    expect(() => validateOutcomeGovernedQualityChain(missing)).toThrow()
    const corrupt = makeRemediatedRequestScopedQualityChain(requestBinding)
    corrupt.stages.find((stage) => stage.stageExecutionId === 'rl_failed').failure.retryable = true
    expect(() => validateOutcomeGovernedQualityChain(corrupt)).toThrow()
    const predecessor = makeRemediatedRequestScopedQualityChain(requestBinding)
    predecessor.recordedStages[5].predecessorStageExecutionId = predecessor.recordedStages[4].stageExecutionId
    expect(() => validateOutcomeGovernedQualityChain(predecessor)).toThrow()
  })
})
