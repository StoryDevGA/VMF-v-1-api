import { createHash } from 'node:crypto'
import { buildOutcomeMethodDocument, readOutcomeMethodDocument } from '../services/outcomeMethodDocumentService.js'
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
import { buildOutcomeRenderedExpressionRlFailureLineage, normalizeOutcomeRenderedExpressionRlMethodSelection } from '../services/outcomeRenderedExpressionRlExecutionService.js'
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

const makeDocument = (content = '# RL\r\n\r\nReview all expression.\r\n| A | B |\r\n|---|---|\r\n| 😀 | preserve |\r\n', versionId = 'rl-version-1') => {
  const selection = {
    packId: 'rl-pack', packKey: 'library-rl', versionId, semanticVersion: '1.0.0',
    contentHash: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    contentFormat: 'MARKDOWN', status: 'ACTIVE', packType: 'RL',
    activationId: 'rl-activation', capabilityKey: 'rendered-expression-review', executionMode: 'PROVIDER_CONTEXT',
    boundary: 'POST_GENERATION_VALIDATION',
  }
  return buildOutcomeMethodDocument({ role: 'RL', selection, loaded: { ...selection, available: true, content } })
}

const makeContext = (document = makeDocument(), captureExecutionEvidence) => buildOutcomeRenderedExpressionRlProviderSafeContext({
  captureExecutionEvidence,
  knowledgeSelection: [{ versionId: document.source.versionId, knowledgeLayer: 'COMMUNICATION_PATTERN', executionMode: 'PROVIDER_CONTEXT' }],
  methodDocument: document,
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
  it('never accepts an incomplete response as a successful review', async () => {
    const fetchImpl = jest.fn(async () => response({
      id: 'resp_incomplete', status: 'incomplete',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reviewOutput()) }] }],
    }))
    await expect(makeAdapter(fetchImpl)({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'RENDERED_EXPRESSION_RL_PROVIDER_REQUEST_FAILED' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each([
    [400, 'context_length_exceeded', 'RENDERED_EXPRESSION_RL_PROVIDER_CONTEXT_OVERFLOW'],
    [500, 'context_window_exceeded', 'RENDERED_EXPRESSION_RL_PROVIDER_CONTEXT_OVERFLOW'],
    [200, 'context_overflow', 'RENDERED_EXPRESSION_RL_PROVIDER_CONTEXT_OVERFLOW'],
    [400, 'invalid_request_error', 'RENDERED_EXPRESSION_RL_PROVIDER_REJECTED'],
  ])('rejects context overflow distinctly without retry (%s %s)', async (status, code, reason) => {
    const fetchImpl = jest.fn(async () => response({ error: { code } }, { status, ok: status === 200 }))
    await expect(makeAdapter(fetchImpl)({ providerContext: makeContext() })).rejects.toMatchObject({ details: { reason } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).truncation).toBe('disabled')
  })
  it('rejects personal data in canonical RL text without altering the document', () => {
    const document = makeDocument('# Review\nContact qa@example.com for review.')
    expect(() => makeContext(document)).toThrow()
    expect(readOutcomeMethodDocument(document)).toBe('# Review\nContact qa@example.com for review.')
  })
  it('normalizes the KCP lifecycleStatus field for exact canonical document loading', () => {
    const document = makeDocument()
    const pack = { ...document.source, lifecycleStatus: 'ACTIVE', packType: 'RL', activationId: 'rl-activation', capabilityKey: 'rendered-expression-review', executionMode: 'PROVIDER_CONTEXT', boundary: 'POST_GENERATION_VALIDATION' }
    const selection = normalizeOutcomeRenderedExpressionRlMethodSelection(pack)
    expect(selection.status).toBe('ACTIVE')
    expect(pack).not.toHaveProperty('status')
    expect(buildOutcomeMethodDocument({ role: 'RL', selection, loaded: { ...document.source, status: 'ACTIVE', available: true, content: readOutcomeMethodDocument(document) } })).toEqual(document)
  })

  it.each([
    { lifecycleStatus: 'ACTIVE', status: 'DEPRECATED' },
    { lifecycleStatus: 'DEPRECATED', status: 'ACTIVE' },
    { lifecycleStatus: 'DRAFT' }, {},
  ])('rejects missing or contradictory KCP lifecycle %#', (pack) => {
    expect(() => normalizeOutcomeRenderedExpressionRlMethodSelection(pack)).toThrow()
  })
  it('transmits every chunk of the upgraded full source and captures only text-free provenance', async () => {
    const content = '# Review\r\n' + '| preserve 😀 | full prose |\r\n'.repeat(700) + '\nFinal instruction.  \n'
    const document = makeDocument(content, 'rl-version-2')
    const capture = jest.fn()
    const context = makeContext(document, capture)
    const fetchImpl = jest.fn(async () => response({
      id: 'resp_full_source', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reviewOutput()) }] }],
    }))
    await makeAdapter(fetchImpl)({ providerContext: context })
    const transmitted = JSON.parse(JSON.parse(fetchImpl.mock.calls[0][1].body).input).methodDocument
    expect(transmitted).toEqual(document)
    expect(transmitted.chunks.length).toBeGreaterThan(1)
    expect(readOutcomeMethodDocument(transmitted)).toBe(content)
    const evidence = capture.mock.calls[0][0]
    expect(evidence.methodDocumentReceipts[0]).toMatchObject({ versionId: 'rl-version-2', contentHash: document.source.contentHash, chunkCount: document.chunks.length })
    expect(evidence.packs[0].status).toBe('NOT_RECORDED')
    expect(JSON.stringify(evidence)).not.toContain('Final instruction')
    expect(JSON.stringify(evidence)).not.toContain('chunks')
  })

  it.each(['missing', 'reordered', 'modified', 'hash'])('rejects %s source coverage before provider invocation', async (kind) => {
    const context = makeContext(makeDocument('Canonical guidance.\n'.repeat(1000)))
    if (kind === 'missing') context.methodDocument.chunks.pop()
    if (kind === 'reordered') context.methodDocument.chunks.reverse()
    if (kind === 'modified') context.methodDocument.chunks[0].text = 'Changed'
    if (kind === 'hash') context.methodDocument.source.contentHash = 'sha256:' + '0'.repeat(64)
    const fetchImpl = jest.fn()
    await expect(makeAdapter(fetchImpl)({ providerContext: context })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects the final serialized request budget without truncating source', async () => {
    const document = makeDocument('"'.repeat(79000))
    const context = makeContext(document)
    const fetchImpl = jest.fn()
    await expect(makeAdapter(fetchImpl)({ providerContext: context })).rejects.toThrow(/too large/)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(readOutcomeMethodDocument(document)).toBe('"'.repeat(79000))
  })

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
      knowledgeSelection: [{ versionId: 'rl-version-1', knowledgeLayer: 'COMMUNICATION_PATTERN', executionMode: 'PROVIDER_CONTEXT' }],
  methodDocument: makeDocument(),
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
    expect(readOutcomeMethodDocument(JSON.parse(requestBody.input).methodDocument)).toBe(readOutcomeMethodDocument(makeDocument()))
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
