import { describe, expect, jest, test } from '@jest/globals'

import {
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_RESPONSE_SCHEMA_NAME,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { assertStrictProviderResponseSchema } from '../services/governedReasoningRuntimeService.js'
import { OUTCOME_STUDIO_GOVERNED_PHASE } from '../constants/runtimeOutcomeStudio.js'
import { OutcomeDraft, OutcomeDraftIteration, OutcomeMessage } from '../models/index.js'
import {
  buildGovernedQualityChainApprovalReadiness,
  buildGovernedQualityChainManifest,
  executeRequestScopedQualityCheckpoint,
  persistGovernedQualityDraft,
  __testables as outcomeStudioTestables,
} from '../services/outcomeStudioService.js'
import {
  OUTCOME_ARL_REVIEW_DIMENSIONS,
  normalizeOutcomeArlProviderReview,
} from '../services/outcomeArlReviewContract.js'

const requestBinding = {
  requestId: '8abedafd-8555-4342-be49-76ab906a26f6',
  draftId: 'outcome_draft_8d91bfbd-6670-4cfe-807b-a6d41bd4181e',
  draftIterationId: 'outcome_draft_iteration_5eebbe35-cfba-47d0-883f-e0cb408c1905',
}
const plan = {
  planId: 'outcome_kcp_8abedafd-8555-4342-be49-76ab906a26f6',
  planFingerprint: 'a'.repeat(64),
}
const executionSequence = OUTCOME_QUALITY_STAGE_SEQUENCE.slice(0, 6)

const makeStages = () => executionSequence.map((stageKey, index) => ({
  requestId: requestBinding.requestId,
  draftId: requestBinding.draftId,
  draftIterationId: requestBinding.draftIterationId,
  planId: plan.planId,
  planFingerprint: plan.planFingerprint,
  stageKey,
  stageOrder: index + 1,
  status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
  stageExecutionId: `outcome_quality_stage_${index + 1}`,
  attemptFingerprint: String(index + 1).repeat(64),
  outputFingerprint: String(index + 2).repeat(64),
  predecessorStageExecutionId: index ? `outcome_quality_stage_${index}` : '',
  predecessorAttemptFingerprint: index ? String(index).repeat(64) : '',
  inputSnapshot: index ? { sourceStage: {
    stageExecutionId: `outcome_quality_stage_${index}`,
    attemptFingerprint: String(index).repeat(64),
  } } : {},
  executionIdentity: [0, 1, 2, 5].includes(index) ? {
    grrExecutionId: `grr_exec_${index + 1}`,
    grrRuntimeArtifactId: `grr_art_${index + 1}`,
  } : {},
}))

describe('SS-033 governed quality-chain finalisation gate', () => {
  test('routes a controlled ARL-pass fixture through stages 4-6 before draft persistence', async () => {
    const calls = []
    const stageResult = (index) => ({ stage: {
      ...makeStages()[index],
      ...(index === 1 ? { outputSnapshot: { title: 'Parlon Executive Brief' } } : {}),
    } })
    const result = await executeRequestScopedQualityCheckpoint({
      actorUserId: '6a7100000000000000000001',
      auditRequest: {},
      arlMeaningReviewProviderAdapterFactory: () => jest.fn(),
      frameworkGuidanceProviderAdapterFactory: () => jest.fn(),
      knowledgePackBinding: {},
      providerDescriptor: {},
      renderedExpressionRlProviderAdapterFactory: () => jest.fn(),
      requestPlan: {
        requestId: requestBinding.requestId,
        planId: plan.planId,
        planFingerprint: plan.planFingerprint,
      },
      runtimeInstance: { _id: '6a7100000000000000000002' },
      runtimeInstanceId: '6a7100000000000000000002',
      scopes: [],
      serializedMessage: {},
      serializedSession: {},
      workingDraftProviderAdapterFactory: () => jest.fn(),
      deps: {
        findPlan: async () => ({ ...plan, _id: '6a7100000000000000000003' }),
        assertPlan: () => undefined,
        executeFrameworkGuidance: async () => { calls.push('FRAMEWORK_GUIDANCE'); return stageResult(0) },
        executeWorkingDraft: async () => { calls.push('WORKING_DRAFT'); return stageResult(1) },
        approveWorkingDraftMeaning: async () => { calls.push('ARL_MEANING_REVIEW'); return stageResult(2) },
        createNarrativePlan: async () => { calls.push('OUTCOME_NARRATIVE_PLAN'); return stageResult(3) },
        createShapedCandidate: async () => { calls.push('OUTPUT_SHAPING'); return stageResult(4) },
        executeRenderedExpressionRl: async () => { calls.push('RENDERED_EXPRESSION_RL'); return stageResult(5) },
        persistGovernedQualityDraft: async ({ stages }) => {
          calls.push('PERSIST_DRAFT')
          expect(stages.map((stage) => stage.stageKey)).toEqual(executionSequence)
          return { draft: { draftId: requestBinding.draftId } }
        },
      },
    })

    expect(calls).toEqual([...executionSequence, 'PERSIST_DRAFT'])
    expect(result).toEqual({ draft: { draftId: requestBinding.draftId } })
  })

  test('stops at a substantive ARL failure and never calls downstream stages', async () => {
    const calls = []
    await expect(executeRequestScopedQualityCheckpoint({
      actorUserId: '6a7100000000000000000001',
      auditRequest: {},
      arlMeaningReviewProviderAdapterFactory: () => jest.fn(),
      frameworkGuidanceProviderAdapterFactory: () => jest.fn(),
      knowledgePackBinding: {},
      providerDescriptor: {},
      renderedExpressionRlProviderAdapterFactory: () => jest.fn(),
      requestPlan: {
        requestId: requestBinding.requestId,
        planId: plan.planId,
        planFingerprint: plan.planFingerprint,
      },
      runtimeInstance: { _id: '6a7100000000000000000002' },
      runtimeInstanceId: '6a7100000000000000000002',
      scopes: [],
      serializedMessage: {},
      serializedSession: {},
      workingDraftProviderAdapterFactory: () => jest.fn(),
      deps: {
        findPlan: async () => ({ ...plan, _id: '6a7100000000000000000003' }),
        assertPlan: () => undefined,
        executeFrameworkGuidance: async () => ({ stage: makeStages()[0] }),
        executeWorkingDraft: async () => ({ stage: makeStages()[1] }),
        approveWorkingDraftMeaning: async () => ({ stage: {
          ...makeStages()[2],
          status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
          failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' },
        } }),
        createNarrativePlan: async () => { calls.push('OUTCOME_NARRATIVE_PLAN') },
        createShapedCandidate: async () => { calls.push('OUTPUT_SHAPING') },
        executeRenderedExpressionRl: async () => { calls.push('RENDERED_EXPRESSION_RL') },
        persistGovernedQualityDraft: async () => { calls.push('PERSIST_DRAFT') },
      },
    })).rejects.toMatchObject({
      details: expect.objectContaining({ blockerReason: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' }),
    })
    expect(calls).toEqual([])
  })

  test('accepts one exact six-stage chain with real stage and GRR receipt identities', () => {
    const manifest = buildGovernedQualityChainManifest({ plan, requestBinding, stages: makeStages() })
    const readiness = buildGovernedQualityChainApprovalReadiness({
      draft: {
        draftId: requestBinding.draftId,
        currentIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
      iteration: {
        draftIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
    })

    expect(manifest.stages.map((stage) => stage.stageKey)).toEqual(executionSequence)
    expect(manifest.stages[2]).toEqual(expect.objectContaining({
      grrExecutionId: 'grr_exec_3',
      stageExecutionId: 'outcome_quality_stage_3',
    }))
    expect(manifest.stages[5]).toEqual(expect.objectContaining({
      grrExecutionId: 'grr_exec_6',
      stageExecutionId: 'outcome_quality_stage_6',
    }))
    expect(readiness).toEqual(expect.objectContaining({
      status: 'PASSED',
      approvalAvailable: true,
      passedRuntimeCheckCount: 6,
    }))
  })

  test('blocks finalisation when any stage is missing', () => {
    expect(() => buildGovernedQualityChainManifest({
      plan,
      requestBinding,
      stages: makeStages().slice(0, 5),
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ blockerReason: 'OUTCOME_QUALITY_CHAIN_INCOMPLETE' }),
    }))
  })

  test('blocks finalisation when predecessor lineage is not exact', () => {
    const stages = makeStages()
    stages[4].inputSnapshot.sourceStage.stageExecutionId = 'outcome_quality_stage_unrelated'
    expect(() => buildGovernedQualityChainManifest({ plan, requestBinding, stages }))
      .toThrow(expect.objectContaining({
        details: expect.objectContaining({ blockerReason: 'OUTCOME_QUALITY_CHAIN_LINEAGE_INVALID' }),
      }))
  })

  test('blocks finalisation when a predecessor fingerprint is not exact', () => {
    const stages = makeStages()
    stages[4].predecessorAttemptFingerprint = 'f'.repeat(64)
    expect(() => buildGovernedQualityChainManifest({ plan, requestBinding, stages }))
      .toThrow(expect.objectContaining({
        details: expect.objectContaining({ blockerReason: 'OUTCOME_QUALITY_CHAIN_LINEAGE_INVALID' }),
      }))
  })

  test('blocks approval when an AI review receipt is absent', () => {
    const manifest = buildGovernedQualityChainManifest({ plan, requestBinding, stages: makeStages() })
    manifest.stages[2].grrExecutionId = ''
    const readiness = buildGovernedQualityChainApprovalReadiness({
      draft: {
        draftId: requestBinding.draftId,
        currentIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
      iteration: {
        draftIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
    })
    expect(readiness).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      approvalAvailable: false,
      blockerReason: 'OUTCOME_GOVERNED_QUALITY_CHAIN_INCOMPLETE',
    }))
  })

  test('blocks approval when the persisted chain is for a different confirmed request plan', () => {
    const manifest = buildGovernedQualityChainManifest({ plan, requestBinding, stages: makeStages() })
    const readiness = buildGovernedQualityChainApprovalReadiness({
      draft: {
        draftId: requestBinding.draftId,
        currentIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
      iteration: {
        draftIterationId: requestBinding.draftIterationId,
        lineageSummary: { governedQualityChain: manifest },
      },
      requestPlan: {
        requestId: 'different-request',
        planId: plan.planId,
        planFingerprint: plan.planFingerprint,
      },
    })

    expect(readiness).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      approvalAvailable: false,
      blockerReason: 'OUTCOME_GOVERNED_QUALITY_CHAIN_NOT_CURRENT',
    }))
  })

  test('persists governed visible gaps as customer-safe draft limitations', () => {
    const projection = outcomeStudioTestables.buildGovernedDraftCustomerContent({
      outputSnapshot: {
        title: 'Governed Executive Brief',
        sections: [{ heading: 'Situation', body: 'The current position is qualified.' }],
        visibleGaps: ['The available evidence does not establish a financial impact.'],
      },
    })

    expect(projection.limitations).toEqual(['The available evidence does not establish a financial impact.'])
    expect(projection.customerContent.sections[0].body).toBe('The current position is qualified.')
  })

  test('preserves a substantive ARL failure instead of normalising it into approval', () => {
    const findings = OUTCOME_ARL_REVIEW_DIMENSIONS.map((dimension, index) => ({
      dimension,
      status: index === 0 ? 'FAIL' : 'PASS',
      finding: index === 0 ? 'An unsupported causal conclusion requires revision.' : 'No change is required.',
      requiredChange: index === 0,
    }))
    expect(normalizeOutcomeArlProviderReview({
      outputType: 'ARL_MEANING_REVIEW',
      schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
      overallStatus: 'FAIL',
      findings,
    })).toEqual(expect.objectContaining({ overallStatus: 'FAIL', findings }))
  })

  test('rejects contradictory or duplicate ARL findings at the provider boundary', () => {
    const duplicateFindings = OUTCOME_ARL_REVIEW_DIMENSIONS.map(() => ({
      dimension: 'ANALYTICAL_STRENGTH',
      status: 'PASS',
      finding: 'No change is required.',
      requiredChange: false,
    }))
    expect(() => normalizeOutcomeArlProviderReview({
      outputType: 'ARL_MEANING_REVIEW',
      schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
      overallStatus: 'PASS',
      findings: duplicateFindings,
    })).toThrow('The ARL review result is invalid.')
  })

  test('accepts the real Stage 6 strict response receipt and rejects the old incomplete receipt', () => {
    const providerResult = {
      output: {
        outputType: 'RENDERED_EXPRESSION_RL',
        schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
      },
      metadata: {
        responseSchema: {
          name: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_RESPONSE_SCHEMA_NAME,
          version: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
          strict: true,
          parsed: true,
        },
      },
    }
    expect(() => assertStrictProviderResponseSchema(providerResult, 'RENDERED_EXPRESSION_RL'))
      .not.toThrow()
    providerResult.metadata.responseSchema = { strict: true, parsed: true }
    expect(() => assertStrictProviderResponseSchema(providerResult, 'RENDERED_EXPRESSION_RL'))
      .toThrow(expect.objectContaining({ code: 'GRR_LIVE_TEST_PROVIDER_RESULT_INVALID' }))
  })

  test('returns the exact persisted governed result on an idempotent final-draft retry', async () => {
    const stages = makeStages()
    const manifest = buildGovernedQualityChainManifest({ plan, requestBinding, stages })
    const message = {
      messageId: 'outcome_message_existing',
      sessionId: 'outcome_session_existing',
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      role: 'ASSISTANT',
      status: 'GENERATED',
      responseStatus: 'RESPONSE_GENERATED',
    }
    const draft = {
      draftId: requestBinding.draftId,
      sessionId: message.sessionId,
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      status: 'ACTIVE',
      currentIterationId: requestBinding.draftIterationId,
      currentIterationNumber: 1,
      knowledgePackBinding: {},
      lineageSummary: { governedQualityChain: manifest },
    }
    const iteration = {
      draftIterationId: requestBinding.draftIterationId,
      draftId: requestBinding.draftId,
      sessionId: message.sessionId,
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      status: 'CURRENT',
      iterationNumber: 1,
      lineageSummary: { governedQualityChain: manifest },
    }
    const messageRead = jest.spyOn(OutcomeMessage, 'findOne').mockResolvedValue(message)
    const draftRead = jest.spyOn(OutcomeDraft, 'findOne').mockResolvedValue(draft)
    const iterationRead = jest.spyOn(OutcomeDraftIteration, 'findOne').mockResolvedValue(iteration)
    try {
      const result = await persistGovernedQualityDraft({
        actorUserId: '6a7100000000000000000001',
        knowledgePackBinding: {},
        plan,
        requestBinding,
        runtimeInstance: { _id: '6a7100000000000000000002' },
        serializedMessage: {},
        serializedSession: {},
        stages,
      })
      expect(result).toEqual(expect.objectContaining({
        message: expect.objectContaining({ messageId: message.messageId }),
        draft: expect.objectContaining({ draftId: requestBinding.draftId }),
        draftIteration: expect.objectContaining({ draftIterationId: requestBinding.draftIterationId }),
      }))
    } finally {
      messageRead.mockRestore()
      draftRead.mockRestore()
      iterationRead.mockRestore()
    }
  })

  test('reconciles a concurrent duplicate final-draft write to the committed winner', async () => {
    const stages = makeStages()
    stages[4].outputSnapshot = {
      title: 'Parlon decision brief',
      sections: [{
        sectionKey: 'summary',
        heading: 'Summary',
        body: 'This is a bounded summary of the accepted information.',
        qualification: 'Commercial conclusions remain subject to the stated evidence limits.',
      }],
    }
    const manifest = buildGovernedQualityChainManifest({ plan, requestBinding, stages })
    const winnerMessage = {
      messageId: 'outcome_message_winner',
      sessionId: 'outcome_session_winner',
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      role: 'ASSISTANT',
      status: 'GENERATED',
      responseStatus: 'RESPONSE_GENERATED',
    }
    const winnerDraft = {
      draftId: requestBinding.draftId,
      sessionId: winnerMessage.sessionId,
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      status: 'ACTIVE',
      currentIterationId: requestBinding.draftIterationId,
      currentIterationNumber: 1,
      knowledgePackBinding: {},
      lineageSummary: { governedQualityChain: manifest },
    }
    const winnerIteration = {
      draftIterationId: requestBinding.draftIterationId,
      draftId: requestBinding.draftId,
      sessionId: winnerMessage.sessionId,
      phase: OUTCOME_STUDIO_GOVERNED_PHASE,
      status: 'CURRENT',
      iterationNumber: 1,
      lineageSummary: { governedQualityChain: manifest },
    }
    const messageRead = jest.spyOn(OutcomeMessage, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winnerMessage)
    const draftRead = jest.spyOn(OutcomeDraft, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winnerDraft)
    const iterationRead = jest.spyOn(OutcomeDraftIteration, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winnerIteration)
    const duplicate = Object.assign(new Error('duplicate'), { code: 11000 })
    const messageSave = jest.spyOn(OutcomeMessage.prototype, 'save').mockRejectedValueOnce(duplicate)
    try {
      const result = await persistGovernedQualityDraft({
        actorUserId: '6a7100000000000000000001',
        auditRequest: {},
        knowledgePackBinding: { status: 'READY', activeCount: 1, requiredCount: 1 },
        plan: { ...plan, requestedOutputTypeKey: 'commercial-strategy-and-decision-paper' },
        requestBinding,
        runtimeInstance: {
          _id: '6a7100000000000000000002',
          tenantId: '6a7100000000000000000003',
          customerId: '6a7100000000000000000004',
          runtimeInstanceKey: 'parlon-runtime',
          runtimeType: 'VALUE_NARRATIVE',
          frameworkKey: 'vmf',
          packageKey: 'vmf-v3',
          packageVersion: '3.0.0',
        },
        serializedMessage: {
          messageId: 'outcome_message_request',
          responseStatus: 'READY_TO_GENERATE',
          outputContractResolution: {
            selectedOutputType: { key: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', label: 'Decision paper' },
          },
        },
        serializedSession: {
          sessionId: winnerMessage.sessionId,
          sourceOutput: {},
          truthSignature: { currentness: 'CURRENT' },
        },
        stages,
      })
      expect(result).toEqual(expect.objectContaining({
        message: expect.objectContaining({ messageId: winnerMessage.messageId }),
        draft: expect.objectContaining({ draftId: requestBinding.draftId }),
        draftIteration: expect.objectContaining({ draftIterationId: requestBinding.draftIterationId }),
      }))
    } finally {
      messageRead.mockRestore()
      draftRead.mockRestore()
      iterationRead.mockRestore()
      messageSave.mockRestore()
    }
  })
})
