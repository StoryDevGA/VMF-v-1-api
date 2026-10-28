import { beforeAll, describe, expect, jest, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import { OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION } from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
let execute
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
beforeAll(async () => {
  const actualPlan = await import('../services/outcomeKnowledgeCompositionPlanService.js')
  const actualStage = await import('../services/outcomeQualityStageExecutionService.js')
  jest.unstable_mockModule('../services/outcomeKnowledgeCompositionPlanService.js', () => ({ ...actualPlan,
    assertOutcomeKnowledgeCompositionPlanIntegrity: x => x, assertLegacyOutcomeKnowledgeCompositionPlan: x => x,
    assertOutcomeKnowledgeCompositionPlanMatchesRuntime: () => {},
  }))
  jest.unstable_mockModule('../services/outcomeQualityStageExecutionService.js', () => ({ ...actualStage,
    assertOutcomeQualityStageTransactionSupport: () => {}, buildOutcomeQualityStageExecutionCandidate: () => ({ attemptFingerprint: 'f'.repeat(64) }),
    createOutcomeQualityStageExecution: jest.fn(), hashOutcomeQualityStageValue: hash, serializeOutcomeQualityStageExecution: x => x,
  }))
  execute = (await import('../services/outcomeRenderedExpressionRlExecutionService.js')).executeOutcomeRenderedExpressionRl
})
// Candidate building and plan integrity are explicit unit seams. These tests prove
// both native execute failure branches propagate the exact caller scope to writer.
describe('RL failure scope propagation', () => {
  test.each(['semantic FAIL', 'provider error'])('retains scope on %s without bypassing the stage writer', async kind => {
    const runtimeId = '6ad715c91f39fea112115875', planId = 'outcome_kcp_scope', fp = 'a'.repeat(64)
    const plan = { _id: '6ad715c91f39fea112115876', runtimeInstanceId: runtimeId, planId, planFingerprint: fp, planVersion: 1,
      payload: { stagePlan: [{ stageKey: 'RENDERED_EXPRESSION_RL', order: 6, assignedActivationIds: ['rl'] }], resolution: {
        selectedPacks: [{ activationId: 'rl', versionId: 'rl-v1', packType: 'RL', executionMode: 'PROVIDER_CONTEXT', boundary: 'POST_GENERATION_VALIDATION', stageAssignments: ['RENDERED_EXPRESSION_RL'] }] } } }
    const outputSnapshot = { outputType: 'RENDERED_EXPRESSION', schemaVersion: 'fs-003-rendered-expression.v0.2' }
    const source = { runtimeInstanceId: runtimeId, planId, planFingerprint: fp, stageKey: 'OUTPUT_SHAPING', stageOrder: 5,
      stageExecutionId: 'saved-shaping', attemptFingerprint: 'b'.repeat(64), status: 'SUCCEEDED', outputSnapshot, outputFingerprint: hash(outputSnapshot) }
    const q = value => ({ sort() { return this }, lean: async () => value })
    const scopes = { customer: { _id: '6a6c75f2cace7a21bd41ef98' }, tenant: { _id: '6a6c76e3cace7a21bd41eff9' } }
    const createStage = jest.fn(async input => ({ execution: { status: 'FAILED', failure: input.failure }, idempotent: false }))
    const providerDescriptor = { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', environment: 'TEST',
      safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY, failurePosture: 'FAIL_CLOSED' }
    const createGrr = jest.fn(async () => {
      if (kind === 'provider error') throw Object.assign(new Error('provider timeout'), { code: 'OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_FAILED',
        details: { reason: 'RENDERED_EXPRESSION_RL_PROVIDER_TIMEOUT' } })
      return { executionId: 'grr_saved', artifact: { runtimeArtifactId: 'artifact_saved', generatedOutput: { overallStatus: 'FAIL' } },
        provider: { ...providerDescriptor, liveProvider: true } }
    })
    const adapter = Object.assign(jest.fn(), { configurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION })
    const result = await execute({ actorUserId: '6a6c763dcace7a21bd41efa9', planRecordId: plan._id,
      runtimeInstanceId: runtimeId, expectedPlanFingerprint: fp, providerDescriptor, providerAdapter: adapter, scopes,
      deps: { OutcomeKnowledgeCompositionPlan: { findOne: () => q(plan) }, RuntimeInstance: { findOne: () => q({ _id: runtimeId, updatedAt: '2026-10-01T10:00:00Z' }) },
        OutcomeQualityStageExecution: { findOne: filter => q(filter.stageKey === 'OUTPUT_SHAPING' ? source : null) },
        createGovernedReasoningExecution: createGrr, createOutcomeQualityStageExecution: createStage } })
    expect(result.stage.status).toBe('FAILED')
    expect(createStage).toHaveBeenCalledTimes(1)
    expect(createStage.mock.calls[0][0].scopes).toBe(scopes)
    expect(createStage.mock.calls[0][0].failure.failureCode).toBe(kind === 'semantic FAIL' ? 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' : 'RENDERED_EXPRESSION_RL_PROVIDER_TIMEOUT')
    expect(adapter).not.toHaveBeenCalled()
  })
})
