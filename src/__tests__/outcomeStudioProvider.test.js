import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { buildOutcomeStudioProviderRuntime } from '../config/outcomeStudioProvider.js'
import logger from '../config/logger.js'
import { createOpenAiOutcomeStudioProviderAdapter } from '../services/openAiOutcomeStudioProviderAdapter.js'

const providerContext = {
  contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
  businessRequest: {
    outputTypeKey: 'EXECUTIVE_BRIEF',
    requestedOutputTypeKey: 'executive-brief',
    requestedStyleKey: 'executive',
    workspaceType: 'OUTCOME',
    instruction: 'Prepare a concise executive brief for a customer decision.',
  },
  draftContext: { content: '' },
  truthSummaries: [
    { label: 'Situation', summary: 'The customer needs a clearer commercial value story.' },
  ],
  guidance: {
    businessInstructions: ['Focus on the customer decision and practical next steps.'],
    reasoningGuidance: ['Connect each recommendation to the supplied business information.'],
    outputSchema: ['Use an executive summary, findings and recommendations.'],
    styleGuidance: ['Use concise, confident executive language.'],
    validationCriteria: ['Do not introduce unsupported claims.'],
    prohibitedOutputBoundaries: ['Do not overstate financial impact.'],
  },
  safeguards: [
    'CUSTOMER_LANGUAGE_ONLY',
    'VERIFIED_BUSINESS_CONTEXT_ONLY',
    'NO_INTERNAL_RUNTIME_TERMINOLOGY',
    'NO_SECRETS_OR_PERSONAL_DATA',
    'FAIL_CLOSED_ON_UNSAFE_CONTEXT',
  ],
}

const validStructuredOutput = {
  title: 'Executive Brief',
  summary: 'The business can strengthen its customer proposition by focusing on measurable decision outcomes.',
  sections: [
    {
      heading: 'Situation',
      narrative: 'The current value story is credible but does not yet lead clearly to the customer decision.',
    },
    {
      heading: 'Recommendation',
      narrative: 'Reframe the proposition around the decision, supporting evidence and practical next action.',
    },
  ],
  caveats: ['Validate any financial estimates with the account owner before external use.'],
}

const makeProviderBody = (overrides = {}) => ({
  id: 'resp_test_123',
  created_at: 1784707200,
  status: 'completed',
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: JSON.stringify(validStructuredOutput) }],
  }],
  usage: {
    input_tokens: 1200,
    output_tokens: 650,
    total_tokens: 1850,
  },
  ...overrides,
})

const makeResponse = ({ body = makeProviderBody(), status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: jest.fn((key) => key.toLowerCase() === 'x-request-id' ? 'req_test_123' : null),
  },
  json: jest.fn().mockResolvedValue(body),
})

const validConfig = (overrides = {}) => ({
  outcomeStudioProviderEnabled: true,
  outcomeStudioProviderKey: 'openai',
  outcomeStudioProviderModel: 'approved-test-model',
  outcomeStudioProviderApiKey: 'test-secret-not-real',
  outcomeStudioProviderTimeoutMs: 5000,
  outcomeStudioProviderMaxRetries: 2,
  outcomeStudioProviderMaxOutputTokens: 4000,
  appEnv: 'development',
  isAppProduction: false,
  isProduction: false,
  ...overrides,
})

const makeAdapter = ({ fetchImpl, maxRetries = 0, sleep = jest.fn(), ...overrides } = {}) =>
  createOpenAiOutcomeStudioProviderAdapter({
    apiKey: 'test-secret-not-real',
    fetchImpl,
    maxOutputTokens: 4000,
    maxRetries,
    model: 'approved-test-model',
    providerKey: 'openai',
    sleep,
    timeoutMs: 5000,
    ...overrides,
  })

afterEach(() => jest.restoreAllMocks())

describe('Outcome Studio Development/Test provider configuration', () => {
  test.each([
    [{ apiKey: '  ' }, 'API key is invalid.'],
    [{ model: '' }, 'Model is invalid.'],
    [{ model: 'x'.repeat(161) }, 'Model is invalid.'],
    [{ providerKey: 'anthropic' }, 'Provider key must be openai.'],
    [{ timeoutMs: 4999 }, 'Timeout must be an integer from 5000 to 120000.'],
    [{ timeoutMs: 120001 }, 'Timeout must be an integer from 5000 to 120000.'],
    [{ maxRetries: -1 }, 'Maximum retries must be an integer from 0 to 2.'],
    [{ maxRetries: 3 }, 'Maximum retries must be an integer from 0 to 2.'],
    [{ maxOutputTokens: 511 }, 'Maximum output tokens must be an integer from 512 to 32000.'],
    [{ maxOutputTokens: 32001 }, 'Maximum output tokens must be an integer from 512 to 32000.'],
  ])('rejects invalid direct adapter construction %#', (overrides, message) => {
    expect(() => makeAdapter({ fetchImpl: jest.fn(), ...overrides })).toThrow(message)
  })

  test('remains LIVE_TEST and fail-closed when provider configuration is disabled', () => {
    const runtime = buildOutcomeStudioProviderRuntime({
      config: validConfig({ outcomeStudioProviderEnabled: false }),
    })

    expect(runtime).toEqual({
      deps: { executionMode: 'LIVE_TEST' },
      status: { configured: false, reason: 'PROVIDER_DISABLED' },
    })
    expect(runtime.deps).not.toHaveProperty('providerAdapter')
    expect(runtime.deps).not.toHaveProperty('providerDescriptor')
  })

  test.each([
    ['missing provider key', { outcomeStudioProviderKey: '' }],
    ['unsupported provider key', { outcomeStudioProviderKey: 'other' }],
    ['missing model', { outcomeStudioProviderModel: '' }],
    ['missing credential', { outcomeStudioProviderApiKey: '' }],
  ])('remains fail-closed for %s', (_label, overrides) => {
    const runtime = buildOutcomeStudioProviderRuntime({
      config: validConfig(overrides),
    })

    expect(runtime.deps).toEqual({ executionMode: 'LIVE_TEST' })
    expect(runtime.status).toEqual({
      configured: false,
      reason: 'PROVIDER_CONFIGURATION_INCOMPLETE',
    })
  })

  test.each([
    ['application production', { appEnv: 'production', isAppProduction: true }],
    ['staging', { appEnv: 'staging' }],
    ['missing application environment', { appEnv: '' }],
    ['unknown application environment', { appEnv: 'stagin' }],
  ])('does not enable the Development/Test adapter in %s', (_label, overrides) => {
    const runtime = buildOutcomeStudioProviderRuntime({ config: validConfig(overrides) })

    expect(runtime.deps).toEqual({ executionMode: 'LIVE_TEST' })
    expect(runtime.status.reason).toBe('PRODUCTION_NOT_AUTHORIZED')
  })

  test('allows hosted Development execution when Node runs in production mode', () => {
    const runtime = buildOutcomeStudioProviderRuntime({
      config: validConfig({
        appEnv: 'development',
        isAppProduction: false,
        isProduction: true,
      }),
      fetchImpl: jest.fn(),
    })

    expect(runtime.status).toEqual({
      configured: true,
      reason: 'LIVE_TEST_PROVIDER_CONFIGURED',
      providerKey: 'openai',
      model: 'approved-test-model',
    })
    expect(runtime.deps.providerAdapter).toEqual(expect.any(Function))
  })

  test('builds the exact LIVE_TEST descriptor only for complete non-production configuration', () => {
    const runtime = buildOutcomeStudioProviderRuntime({
      config: validConfig(),
      fetchImpl: jest.fn(),
    })

    expect(runtime.status).toEqual({
      configured: true,
      reason: 'LIVE_TEST_PROVIDER_CONFIGURED',
      providerKey: 'openai',
      model: 'approved-test-model',
    })
    expect(runtime.deps).toEqual({
      executionMode: 'LIVE_TEST',
      providerAdapter: expect.any(Function),
      providerDescriptor: {
        providerKey: 'openai',
        model: 'approved-test-model',
        providerMode: 'LIVE_TEST',
        environment: 'TEST',
        safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
        failurePosture: 'FAIL_CLOSED',
      },
    })
    expect(JSON.stringify(runtime)).not.toContain('test-secret-not-real')
  })
})

describe('OpenAI Outcome Studio provider adapter', () => {
  test('sends one bounded strict Responses API request and returns validated customer content', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter({ fetchImpl })

    const result = await adapter({ providerContext })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(request).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-secret-not-real',
        'Content-Type': 'application/json',
        'Idempotency-Key': expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      signal: expect.any(AbortSignal),
    }))
    const body = JSON.parse(request.body)
    expect(body.instructions).toContain('customer-visible')
    expect(body.instructions).toContain('ordinary business language')
    expect(body.instructions).toContain('internal governance')
    expect(body.instructions).toContain('knowledge packs')
    expect(body.instructions).not.toMatch(/\bprompts?\b/i)
    expect(body).toEqual(expect.objectContaining({
      model: 'approved-test-model',
      store: false,
      max_output_tokens: 4000,
      input: expect.any(String),
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'governed_deliverable_v1',
          strict: true,
          schema: expect.objectContaining({ additionalProperties: false }),
        }),
      },
    }))
    const providerInput = JSON.parse(body.input)
    expect(providerInput).toEqual({
      request: providerContext.businessRequest,
      currentDraft: providerContext.draftContext,
      verifiedBusinessInformation: providerContext.truthSummaries,
      businessGuidance: providerContext.guidance,
      safeguards: providerContext.safeguards,
    })
    expect(providerInput).not.toHaveProperty('contractVersion')

    expect(result).toEqual(expect.objectContaining({
      generatedAt: new Date('2026-07-22T08:00:00.000Z'),
      provider: {
        providerKey: 'openai',
        model: 'approved-test-model',
        providerMode: 'LIVE_TEST',
        liveProvider: true,
      },
      output: expect.objectContaining({
        title: 'Executive Brief',
        outputTypeKey: 'EXECUTIVE_BRIEF',
        markdown: expect.stringContaining('## Recommendation'),
      }),
      warnings: [],
      limitations: validStructuredOutput.caveats,
      metadata: expect.objectContaining({
        configurationVersion: 'OUTCOME_STUDIO_OPENAI_RESPONSES_V1',
        requestId: 'req_test_123',
        responseId: 'resp_test_123',
        tokenUsage: {
          inputTokens: 1200,
          outputTokens: 650,
          totalTokens: 1850,
        },
        storedByProvider: false,
        responseSchema: {
          name: 'governed_deliverable_v1',
          version: '1',
          strict: true,
          parsed: true,
        },
      }),
    }))
    expect(JSON.stringify(result)).not.toContain('test-secret-not-real')
  })

  test.each([
    ['incomplete response', makeProviderBody({ status: 'incomplete' }), 'LIVE_TEST_PROVIDER_RESPONSE_INCOMPLETE'],
    ['missing output', makeProviderBody({ output: [] }), 'LIVE_TEST_PROVIDER_OUTPUT_MISSING'],
    ['refusal', makeProviderBody({
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }],
    }), 'LIVE_TEST_PROVIDER_REFUSED'],
    ['refusal after valid output', makeProviderBody({
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify(validStructuredOutput) },
          { type: 'refusal', refusal: 'Cannot comply.' },
        ],
      }],
    }), 'LIVE_TEST_PROVIDER_REFUSED'],
    ['multiple output payloads', makeProviderBody({
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify(validStructuredOutput) },
          { type: 'output_text', text: JSON.stringify(validStructuredOutput) },
        ],
      }],
    }), 'LIVE_TEST_PROVIDER_OUTPUT_INVALID'],
    ['malformed JSON', makeProviderBody({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{bad json' }] }],
    }), 'LIVE_TEST_PROVIDER_OUTPUT_INVALID'],
    ['invalid schema', makeProviderBody({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: 'Missing fields' }) }] }],
    }), 'LIVE_TEST_PROVIDER_OUTPUT_INVALID'],
    ['oversized output', makeProviderBody({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(100001) }] }],
    }), 'LIVE_TEST_PROVIDER_OUTPUT_TOO_LARGE'],
  ])('rejects %s without returning provider content', async (_label, body, reason) => {
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(makeResponse({ body })),
    })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      code: 'GRR_LIVE_TEST_PROVIDER_REQUEST_FAILED',
      details: { reason },
    })
  })

  test('rejects internal implementation language before returning provider content', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    const unsafe = {
      ...validStructuredOutput,
      summary: 'The Knowledge Pack and provider context confirm this recommendation.',
    }
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(makeResponse({
        body: makeProviderBody({
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(unsafe) }],
          }],
        }),
      })),
    })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      code: 'GRR_LIVE_TEST_PROVIDER_REQUEST_FAILED',
      details: {
        reason: 'LIVE_TEST_PROVIDER_CUSTOMER_LANGUAGE_BLOCKED',
        violation: {
          code: 'CUSTOMER_LANGUAGE_PROHIBITED_TERM',
          path: 'providerOutput.summary',
          termKey: 'KNOWLEDGE_PACK',
        },
      },
    })
    expect(warn).toHaveBeenCalledWith({
      reasonCode: 'LIVE_TEST_PROVIDER_CUSTOMER_LANGUAGE_BLOCKED',
      violation: {
        code: 'CUSTOMER_LANGUAGE_PROHIBITED_TERM',
        path: 'providerOutput.summary',
        termKey: 'KNOWLEDGE_PACK',
      },
    }, 'outcome studio live provider request failed')
  })

  test('rejects prompt terminology before returning provider content', async () => {
    const unsafe = {
      ...validStructuredOutput,
      sections: [
        ...validStructuredOutput.sections,
        {
          heading: 'Internal note',
          narrative: 'The prompt asked the system to produce this recommendation.',
        },
      ],
    }
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(makeResponse({
        body: makeProviderBody({
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(unsafe) }],
          }],
        }),
      })),
    })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      code: 'GRR_LIVE_TEST_PROVIDER_REQUEST_FAILED',
      details: { reason: 'LIVE_TEST_PROVIDER_CUSTOMER_LANGUAGE_BLOCKED' },
    })
  })

  test('retries configured transient responses at most twice with one request identity', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 429 }))
      .mockResolvedValueOnce(makeResponse({ status: 503 }))
      .mockResolvedValueOnce(makeResponse())
    const sleep = jest.fn().mockResolvedValue(undefined)
    const adapter = makeAdapter({ fetchImpl, maxRetries: 2, sleep })

    await expect(adapter({ providerContext })).resolves.toEqual(expect.objectContaining({
      output: expect.objectContaining({ title: 'Executive Brief' }),
    }))

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[250], [500]])
    const identities = fetchImpl.mock.calls.map(([, request]) => request.headers['Idempotency-Key'])
    expect(new Set(identities).size).toBe(1)
  })

  test('does not retry a non-transient provider rejection', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ status: 400 }))
    const sleep = jest.fn()
    const adapter = makeAdapter({ fetchImpl, maxRetries: 2, sleep })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      details: { reason: 'LIVE_TEST_PROVIDER_REJECTED' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      { reasonCode: 'LIVE_TEST_PROVIDER_REJECTED' },
      'outcome studio live provider request failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/test-secret-not-real|approved-test-model|providerContext|Authorization/)
  })

  test('does not retry a TypeError without an explicit transient network code', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Invalid request configuration'))
    const sleep = jest.fn()
    const adapter = makeAdapter({ fetchImpl, maxRetries: 2, sleep })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      details: { reason: 'LIVE_TEST_PROVIDER_NETWORK_FAILED' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  test('retries a TypeError whose cause carries an allowed transient network code', async () => {
    const transientError = new TypeError('fetch failed')
    transientError.cause = { code: 'ECONNRESET' }
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(makeResponse())
    const sleep = jest.fn().mockResolvedValue(undefined)
    const adapter = makeAdapter({ fetchImpl, maxRetries: 1, sleep })

    await expect(adapter({ providerContext })).resolves.toEqual(expect.objectContaining({
      output: expect.objectContaining({ title: 'Executive Brief' }),
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(250)
  })

  test('classifies an exhausted aborted request as a timeout without leaking its cause', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    const timeoutError = new Error('secret transport details')
    timeoutError.name = 'AbortError'
    const fetchImpl = jest.fn().mockRejectedValue(timeoutError)
    const adapter = makeAdapter({ fetchImpl })

    await expect(adapter({ providerContext })).rejects.toMatchObject({
      message: 'The governed generation provider could not complete this request.',
      code: 'GRR_LIVE_TEST_PROVIDER_REQUEST_FAILED',
      details: { reason: 'LIVE_TEST_PROVIDER_TIMEOUT' },
    })
    expect(warn).toHaveBeenCalledWith(
      { reasonCode: 'LIVE_TEST_PROVIDER_TIMEOUT' },
      'outcome studio live provider request failed',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret transport details')
  })
})
