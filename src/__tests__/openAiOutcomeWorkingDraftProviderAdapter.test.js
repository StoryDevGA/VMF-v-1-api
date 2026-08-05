import { createHash } from 'node:crypto'
import { describe, expect, jest, test } from '@jest/globals'

import {
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFEGUARDS } from '../services/outcomeStudioProviderSafeContextService.js'
import { createOpenAiOutcomeWorkingDraftProviderAdapter } from '../services/openAiOutcomeWorkingDraftProviderAdapter.js'

const providerConfig = {
  apiKey: 'test-secret-not-real',
  completionTimeoutMs: 300000,
  maxOutputTokens: 8000,
  maxRetries: 0,
  model: 'gpt-5.2',
  pollIntervalMs: 1000,
  providerKey: 'openai',
  timeoutMs: 60000,
}

const guidance = {
  businessInstructions: ['Create one Working Draft from the supplied verified truth.'],
  reasoningGuidance: ['Translate analysis into draft business sections.'],
  outputSchema: ['Return Working Draft sections, claims, decision logic, assumptions and visible gaps.'],
  styleGuidance: ['Use concise executive business language.'],
  validationCriteria: ['Every accepted truth reference must remain represented.'],
  prohibitedOutputBoundaries: ['Meaning remains unapproved at Working Draft.'],
}

const makeContext = (overrides = {}) => ({
  contractVersion: OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  businessRequest: {
    outputTypeKey: 'WORKING_DRAFT',
    requestedOutputTypeKey: 'working-draft',
    requestedStyleKey: 'governed-working-draft',
    workspaceType: 'PLATFORM',
    instruction: 'Create one Parlon executive Working Draft.',
  },
  draftContext: { content: '' },
  truthSummaries: [
    { label: 'customer_context', summary: 'Parlon supports evidence-sensitive teams.' },
    { label: 'strategic_objectives', summary: 'Parlon needs faster executive decisions.' },
  ],
  guidance,
  safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
  targetStage: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
  sourceCandidate: {
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
    schemaVersion: 'fs-003-framework-guidance-analysis.v0.2',
    title: 'Parlon decision guidance',
    sections: [{
      order: 1,
      sectionKey: 'governed_position',
      title: 'Governed position',
      analysis: 'The accepted evidence supports a bounded executive decision.',
      implications: ['The decision should preserve qualifications.'],
      recommendations: ['Keep visible gaps in the draft.'],
      qualification: 'Delivery channel remains unspecified.',
      truthReferences: ['customer_context', 'strategic_objectives'],
      assumptions: [],
      gaps: ['Exact delivery file type is not specified.'],
    }],
    decisionUsefulness: {
      summary: 'Use accepted evidence to sequence the decision.',
      priorities: ['Preserve the evidence boundary.'],
      materialRisks: ['Unspecified delivery detail may change execution.'],
      recommendedNextStep: 'Create the unapproved Working Draft.',
    },
    assumptions: [],
    visibleGaps: ['Exact delivery file type is not specified.'],
  },
  ...overrides,
})

const providerOutput = (overrides = {}) => ({
  outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
  schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
  draftVersion: 1,
  title: 'Parlon Executive Brief Working Draft',
  sections: [{
    order: 1,
    sectionKey: 'executive_position',
    title: 'Executive position',
    content: 'The accepted evidence supports a bounded executive decision with explicit qualifications.',
    claims: [{
      claimKey: 'claim_evidence_boundary',
      statement: 'The draft position remains bounded by accepted evidence.',
      truthReferences: ['customer_context', 'strategic_objectives'],
      evidence: ['Accepted truth establishes the customer context and strategic objective.'],
    }],
    truthReferences: ['customer_context', 'strategic_objectives'],
    assumptions: [],
    gaps: ['Exact delivery file type is not specified.'],
  }],
  decisionLogic: [{
    decisionKey: 'preserve_evidence_boundary',
    rationale: 'The recommendation should not outrun accepted evidence.',
    priority: 'HIGH',
    truthReferences: ['customer_context', 'strategic_objectives'],
  }],
  assumptions: [],
  visibleGaps: ['Exact delivery file type is not specified.'],
  ...overrides,
})

const responseBody = (output = providerOutput(), overrides = {}) => ({
  id: 'resp_working_draft_qa',
  status: 'completed',
  created_at: 1785938400,
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: JSON.stringify(output) }],
  }],
  usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
  ...overrides,
})

const response = ({ body = responseBody(), ok = true, status = 200, requestId = 'req_working_draft_qa' } = {}) => ({
  ok,
  status,
  headers: { get: jest.fn((header) => (header === 'x-request-id' ? requestId : '')) },
  json: jest.fn(async () => body),
})

const makeAdapter = (overrides = {}) => createOpenAiOutcomeWorkingDraftProviderAdapter({
  ...providerConfig,
  fetchImpl: jest.fn().mockResolvedValue(response()),
  now: () => 1000,
  sleep: jest.fn(async () => {}),
  ...overrides,
})

describe('createOpenAiOutcomeWorkingDraftProviderAdapter', () => {
  test('sends one exact background request and returns sanitized governed Working Draft output', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response())
    const adapter = makeAdapter({ fetchImpl })
    const context = makeContext()

    const result = await adapter({ providerContext: context })

    expect(adapter.configurationVersion).toBe(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer test-secret-not-real')
    const body = JSON.parse(options.body)
    expect(Object.keys(body)).toEqual(['model', 'background', 'store', 'max_output_tokens', 'instructions', 'input', 'text'])
    expect(body).toMatchObject({
      model: 'gpt-5.2',
      background: true,
      store: false,
      max_output_tokens: 8000,
    })
    expect(body.instructions).toContain('Working Draft only')
    expect(body.instructions).toContain('ARL approval is still required downstream')
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'fs_003_working_draft_v0_2',
      strict: true,
    })
    expect(body.text.format.schema.additionalProperties).toBe(false)
    expect(body.text.format.schema.properties.outputType.const).toBe('WORKING_DRAFT')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.additionalProperties).toBe(false)
    expect(body.input).toBe(JSON.stringify(context))
    expect(options.headers['Idempotency-Key'])
      .toBe(createHash('sha256').update(options.body).digest('hex'))
    expect(result).toMatchObject({
      provider: { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', liveProvider: true },
      output: { outputType: 'WORKING_DRAFT', schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION },
      limitations: ['Exact delivery file type is not specified.'],
      metadata: {
        configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
        httpRequestId: 'req_working_draft_qa',
        responseId: 'resp_working_draft_qa',
        terminalStatus: 'completed',
        storeRequested: false,
        temporaryProviderStorageForPolling: true,
        tokenUsage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      },
    })
    expect(JSON.stringify(result.metadata)).not.toContain('test-secret-not-real')
    expect(JSON.stringify(result.metadata)).not.toContain('Parlon supports evidence-sensitive teams')
    expect(result.output).not.toHaveProperty('compositionProvenance')
    expect(result.output).not.toHaveProperty('revisionHistory')
  })

  test('rejects malformed, unsafe or oversized context before transport', async () => {
    const fetchImpl = jest.fn()
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: { ...makeContext(), rawPrompt: 'not allowed' } })).rejects.toThrow()
    await expect(adapter({
      providerContext: makeContext({
        truthSummaries: [{ label: 'customer_context', summary: 'Read https://example.com.' }],
      }),
    })).rejects.toThrow()
    await expect(adapter({
      providerContext: makeContext({
        sourceCandidate: {
          ...makeContext().sourceCandidate,
          sections: [{
            ...makeContext().sourceCandidate.sections[0],
            analysis: 'x'.repeat(181000),
          }],
        },
      }),
    })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('polls a background response without issuing another create request', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockResolvedValueOnce(response())
    const sleep = jest.fn(async () => {})
    const adapter = makeAdapter({ fetchImpl, sleep })

    await adapter({ providerContext: makeContext() })

    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET'])
    expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  test('maps lifecycle, transport and extraction failures to accepted Working Draft reasons only', async () => {
    const cases = [
      ['transient', jest.fn().mockResolvedValue(response({ ok: false, status: 503 })), 'WORKING_DRAFT_PROVIDER_TRANSIENT_FAILURE'],
      ['rejected', jest.fn().mockResolvedValue(response({ ok: false, status: 400 })), 'WORKING_DRAFT_PROVIDER_REJECTED'],
      ['network', jest.fn().mockRejectedValue(Object.assign(new Error('socket reset secret'), { code: 'ECONNRESET' })), 'WORKING_DRAFT_PROVIDER_NETWORK_FAILED'],
      ['response id', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { id: 'unsafe/id' }) })), 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID'],
      ['incomplete', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'incomplete', output: [] }) })), 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID'],
      ['failed', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'failed', output: [] }) })), 'WORKING_DRAFT_PROVIDER_REQUEST_FAILED'],
      ['cancelled', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'cancelled', output: [] }) })), 'WORKING_DRAFT_PROVIDER_REQUEST_FAILED'],
      ['unknown status', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'mystery', output: [] }) })), 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID'],
      ['refusal', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'refusal' }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_REFUSED'],
      ['zero outputs', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), { output: [] }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID'],
      ['multiple outputs', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [
            { type: 'output_text', text: JSON.stringify(providerOutput()) },
            { type: 'output_text', text: JSON.stringify(providerOutput()) },
          ] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID'],
      ['invalid json', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{not-json' }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID'],
      ['oversized output', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(100001) }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_TOO_LARGE'],
      ['multibyte oversized output', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'é'.repeat(50001) }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_TOO_LARGE'],
    ]

    for (const [_label, fetchImpl, reason] of cases) {
      const adapter = makeAdapter({ fetchImpl })
      const caught = await adapter({ providerContext: makeContext() }).catch((error) => error)
      expect(caught).toMatchObject({
        code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED',
        details: { reason },
      })
      expect(Object.keys(caught.details)).toEqual(['reason'])
      expect(caught.message).not.toContain('socket reset secret')
    }
  })

  test('cancels at most once after a timed-out background response', async () => {
    const abortError = Object.assign(new Error('poll timeout secret'), { name: 'AbortError' })
    const now = () => 1000
    const sleep = jest.fn(async () => {})
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(response({ body: { id: 'resp_working_draft_qa', status: 'cancelled' } }))
    const adapter = makeAdapter({ fetchImpl, now, sleep })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'WORKING_DRAFT_PROVIDER_TIMEOUT' },
    })
    expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['https://api.openai.com/v1/responses', 'POST'],
      ['https://api.openai.com/v1/responses/resp_working_draft_qa', 'GET'],
      ['https://api.openai.com/v1/responses/resp_working_draft_qa/cancel', 'POST'],
    ])
  })

  test('rejects a changed response id while polling', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { id: 'resp_other', status: 'completed' }) }))
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID' },
    })
  })

  test('rejects schema, reference, gap and current approval drift while allowing pending approval wording', async () => {
    const invalidOutputs = [
      { ...providerOutput(), compositionProvenance: { hidden: true } },
      providerOutput({ visibleGaps: ['Changed gap.'] }),
      providerOutput({
        sections: [{ ...providerOutput().sections[0], truthReferences: ['customer_context'] }],
      }),
      providerOutput({
        sections: [{ ...providerOutput().sections[0], claims: [
          { ...providerOutput().sections[0].claims[0] },
          { ...providerOutput().sections[0].claims[0] },
        ] }],
      }),
      providerOutput({ decisionLogic: [{ ...providerOutput().decisionLogic[0], decisionKey: 'preserve_evidence_boundary' }, { ...providerOutput().decisionLogic[0] }] }),
      providerOutput({ title: 'The Working Draft is approved.' }),
      providerOutput({ title: 'The Outcome Narrative Plan is ready.' }),
      providerOutput({ title: 'Output shaping is completed.' }),
      providerOutput({ title: 'The RL review has passed.' }),
      providerOutput({ title: 'The Executive Brief is final.' }),
      providerOutput({ title: 'Meaning\nis approved.' }),
    ]

    for (const output of invalidOutputs) {
      const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })
      await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
        details: { reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID' },
      })
    }

    const allowed = providerOutput({
      sections: [{
        ...providerOutput().sections[0],
        content: 'This Working Draft keeps ARL approval as a required downstream step.',
      }],
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(allowed) })),
    })
    await expect(adapter({ providerContext: makeContext() })).resolves.toMatchObject({
      output: { sections: [expect.objectContaining({ content: expect.stringContaining('ARL approval') })] },
    })
  })

  test('sanitizes request-id and token metadata without exposing provider content', async () => {
    const body = responseBody(providerOutput(), {
      usage: { input_tokens: -1, output_tokens: 'not-a-number', total_tokens: 12.5 },
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body, requestId: 'unsafe request id with spaces' })),
    })
    await expect(adapter({ providerContext: makeContext() })).resolves.toMatchObject({
      metadata: {
        httpRequestId: '',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    })
  })

  test('rejects non-Run87 provider settings before transport', () => {
    const fetchImpl = jest.fn()
    expect(() => makeAdapter({ fetchImpl, model: 'gpt-5.1' })).toThrow(TypeError)
    expect(() => makeAdapter({ fetchImpl, maxOutputTokens: 7999 })).toThrow(TypeError)
    expect(() => makeAdapter({ fetchImpl, maxRetries: 1 })).toThrow(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
