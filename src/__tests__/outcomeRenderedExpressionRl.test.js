import { jest } from '@jest/globals'

import {
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import { createOpenAiOutcomeRenderedExpressionRlProviderAdapter } from '../services/openAiOutcomeRenderedExpressionRlProviderAdapter.js'
import { buildOutcomeRenderedExpressionRlFailureLineage } from '../services/outcomeRenderedExpressionRlExecutionService.js'
import {
  assertOutcomeRenderedExpressionRlProviderSafeContext,
  buildOutcomeRenderedExpressionRlProviderSafeContext,
} from '../services/outcomeRenderedExpressionRlProviderSafeContextService.js'
import { buildOutcomeStudioProviderSafeRequest } from '../services/outcomeStudioProviderSafeContextService.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'

const providerDescriptor = {
  providerKey: 'openai',
  model: 'gpt-5.2',
  providerMode: 'LIVE_TEST',
  environment: 'TEST',
  safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  failurePosture: 'FAIL_CLOSED',
}

const providerInput = {
  customerPrompt: 'Review the Executive Brief expression.',
  currentDraftMarkdown: '',
  request: {
    intentType: 'RENDERED_EXPRESSION_RL',
    refinement: false,
    outputTypeKey: 'RENDERED_EXPRESSION_RL',
    outputTypeLabel: 'Rendered-expression RL review',
    outputSchemaKey: 'fs-003-rendered-expression-rl-v0-2',
    requiredSections: ['STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION'],
    styleKey: 'executive-brief-review',
    styleLabel: 'Executive Brief expression review',
    requestedOutputTypeKey: 'rendered-expression-rl',
    requestedStyleKey: 'executive-brief-review',
    workspaceType: 'PLATFORM',
  },
}

const makeSource = () => {
  const outputSnapshot = {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
    narrativePlanStageExecutionId: 'internal-stage-id',
    narrativePlanOutputFingerprint: '1'.repeat(64),
    candidateType: 'EXECUTIVE_BRIEF',
    title: 'Parlon Executive Brief',
    sections: [{
      order: 1,
      elementId: 'executive_brief_position_1',
      sectionKey: 'executive_position',
      heading: 'Executive position',
      body: 'Parlon can proceed with a bounded decision while retaining the stated evidence limitations.',
      qualification: 'Delivery channel remains unspecified.',
      diagram: { present: false, description: '', accessibleText: '' },
      truthReferences: ['customer_context'],
    }],
    truthReferences: ['customer_context'],
    contributingActivationIds: ['internal-activation-id'],
    visibleGaps: ['Delivery channel remains unspecified'],
  }
  return {
    stageExecutionId: 'internal-shaped-stage-id',
    stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    stageOrder: 5,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    outputFingerprint: hashOutcomeQualityStageValue(outputSnapshot),
    outputSnapshot,
  }
}

const makeContext = () => buildOutcomeRenderedExpressionRlProviderSafeContext({
  knowledgeSelection: [{ versionId: 'internal-version-id', knowledgeLayer: 'COMMUNICATION_PATTERN', executionMode: 'PROVIDER_CONTEXT' }],
  providerDescriptor,
  safeRequest: buildOutcomeStudioProviderSafeRequest({ providerDescriptor, providerInput }),
  sourceStageExecution: makeSource(),
  targetStageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
})

const reviewOutput = () => ({
  outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
  schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  overallStatus: 'PASS',
  findings: [
    'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
  ].map((dimension) => ({
    dimension,
    status: 'PASS',
    finding: `${dimension.replaceAll('_', ' ')} passes the rendered-expression review.`,
    requiredChange: false,
  })),
})

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: jest.fn(() => 'req_rl_qa') },
  json: jest.fn(async () => body),
})

const makeAdapter = (fetchImpl) => createOpenAiOutcomeRenderedExpressionRlProviderAdapter({
  apiKey: 'test-key-not-real',
  completionTimeoutMs: 300000,
  fetchImpl,
  maxOutputTokens: 4000,
  maxRetries: 0,
  model: 'gpt-5.2',
  now: () => 1000,
  pollIntervalMs: 1000,
  providerKey: 'openai',
  sleep: jest.fn(async () => {}),
  timeoutMs: 60000,
})

describe('Rendered-expression RL provider boundary', () => {
  it('appends a second failed RL attempt behind the immutable first failure and revised candidate', () => {
    const latestRl = {
      stageExecutionId: 'outcome_quality_stage_rl_attempt_1',
      attemptNumber: 1,
      attemptFingerprint: 'a'.repeat(64),
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', retryable: false },
    }
    const source = makeSource()
    source.attemptFingerprint = 'b'.repeat(64)
    source.outputSnapshot.revisionScope = 'EXPRESSION_ONLY'
    source.outputSnapshot.remediationSourceStageExecutionId = latestRl.stageExecutionId
    source.outputSnapshot.remediationSourceAttemptFingerprint = latestRl.attemptFingerprint
    expect(buildOutcomeRenderedExpressionRlFailureLineage({ latestRl, source })).toEqual({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestRl.stageExecutionId,
      predecessorAttemptFingerprint: latestRl.attemptFingerprint,
    })
    delete source.outputSnapshot.revisionScope
    expect(() => buildOutcomeRenderedExpressionRlFailureLineage({ latestRl, source }))
      .toThrow(expect.objectContaining({ code: 'OUTCOME_RENDERED_EXPRESSION_RL_STAGE_HISTORY_INVALID' }))
  })

  it('projects the exact visible candidate without internal lineage identifiers', () => {
    const context = makeContext()
    expect(context.candidate).toEqual({
      candidateType: 'EXECUTIVE_BRIEF',
      title: 'Parlon Executive Brief',
      sections: [{
        order: 1,
        heading: 'Executive position',
        body: 'Parlon can proceed with a bounded decision while retaining the stated evidence limitations.',
        qualification: 'Delivery channel remains unspecified.',
        diagram: { present: false, description: '', accessibleText: '' },
      }],
      visibleGaps: ['Delivery channel remains unspecified'],
    })
    expect(JSON.stringify(context)).not.toContain('internal-')
    expect(context.guidance.reasoningGuidance).toContain(
      'For diagrams, present false with empty description and accessible text is an intentional absence and is compliant without a reader-facing absence notice; when present is true, assess both description and accessible text.',
    )
    expect(context.guidance.validationCriteria).toContain(
      'Do not fail diagrams or accessibility merely because an intentionally absent diagram has empty diagram text.',
    )
    expect(context.guidance.reasoningGuidance).toContain(
      'Evidence limitations may appear under Evidence, section unknowns may repeat global visible gaps, and optional preferences about brevity, repetition, sentence density, skimmability or word choice are polish rather than required changes.',
    )
    expect(context.guidance.validationCriteria).toContain(
      'Set requiredChange true only for an explicit contract breach. Optional polish may be mentioned only in a PASS finding with requiredChange false and must not make overallStatus FAIL.',
    )
  })

  it.each([
    ['email', 'Contact qa@example.com for the decision.'],
    ['credential', 'api_key=not-a-real-provider-secret'],
    ['URL', 'See https://example.com/private-source for evidence.'],
  ])('rejects an unsafe %s anywhere in the projected candidate before provider submission', (_label, unsafeText) => {
    const source = makeSource()
    source.outputSnapshot.sections[0].body = unsafeText
    source.outputFingerprint = hashOutcomeQualityStageValue(source.outputSnapshot)
    expect(() => buildOutcomeRenderedExpressionRlProviderSafeContext({
      knowledgeSelection: [{ versionId: 'internal-version-id', knowledgeLayer: 'COMMUNICATION_PATTERN', executionMode: 'PROVIDER_CONTEXT' }],
      providerDescriptor,
      safeRequest: buildOutcomeStudioProviderSafeRequest({ providerDescriptor, providerInput }),
      sourceStageExecution: source,
      targetStageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    })).toThrow(expect.objectContaining({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' }))
  })

  it('revalidates the candidate when an already-built context is supplied directly', () => {
    const context = makeContext()
    context.candidate.sections[0].body = 'Bearer unsafe-test-token'
    expect(() => assertOutcomeRenderedExpressionRlProviderSafeContext(context))
      .toThrow(expect.objectContaining({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' }))
  })

  it('executes one no-retry Responses call and returns all seven RL dimensions', async () => {
    const fetchImpl = jest.fn(async () => response({
      id: 'resp_rl_qa_1',
      status: 'completed',
      created_at: 1,
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reviewOutput()) }] }],
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    }))
    const adapter = makeAdapter(fetchImpl)
    const result = await adapter({ providerContext: makeContext() })
    expect(adapter.configurationVersion).toBe(OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.instructions).toContain(
      'Treat diagram present false with empty description and accessible text as a valid intentional absence that needs no reader-facing notice; when diagram present is true, require meaningful description and accessible text.',
    )
    expect(requestBody.instructions).toContain(
      'Evidence limitations may appear under Evidence, section unknowns may repeat global visible gaps, and preferences about brevity, repetition, sentence density, skimmability or word choice are optional polish, not required changes.',
    )
    expect(requestBody.instructions).toContain(
      'Set requiredChange true only for an explicit contract breach; optional polish may appear only in a PASS finding with requiredChange false and must not cause overallStatus FAIL. Do not invent a new acceptance criterion.',
    )
    expect(result.output.overallStatus).toBe('PASS')
    expect(result.output.findings).toHaveLength(7)
    expect(result.metadata).toEqual(expect.objectContaining({
      responseId: 'resp_rl_qa_1',
      storeRequested: false,
      tokenUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    }))
  })

  it('rejects duplicate dimensions and does not retry a transient provider response', async () => {
    const duplicate = reviewOutput()
    duplicate.findings[6].dimension = 'STATEMENTS'
    const invalidFetch = jest.fn(async () => response({
      id: 'resp_rl_qa_2',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(duplicate) }] }],
    }))
    await expect(makeAdapter(invalidFetch)({ providerContext: makeContext() })).rejects.toMatchObject({
      code: 'OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_FAILED',
      details: { reason: 'RENDERED_EXPRESSION_RL_PROVIDER_OUTPUT_INVALID' },
    })
    const transientFetch = jest.fn(async () => response({}, { ok: false, status: 429 }))
    await expect(makeAdapter(transientFetch)({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'RENDERED_EXPRESSION_RL_PROVIDER_TRANSIENT_FAILURE' },
    })
    expect(transientFetch).toHaveBeenCalledTimes(1)
  })
})
