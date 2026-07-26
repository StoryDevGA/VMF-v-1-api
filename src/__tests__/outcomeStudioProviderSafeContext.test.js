import { afterEach, describe, expect, jest, test } from '@jest/globals'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeStudioProviderSafeContext,
  buildOutcomeStudioProviderSafeRequest,
  OUTCOME_STUDIO_PROVIDER_SAFEGUARDS,
} from '../services/outcomeStudioProviderSafeContextService.js'

const descriptor = {
  providerKey: 'approved-provider',
  model: 'approved-model',
  providerMode: 'LIVE_TEST',
  environment: 'TEST',
  safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
  failurePosture: 'FAIL_CLOSED',
}

const providerInput = (overrides = {}) => ({
  customerPrompt: 'Create a concise board review focused on growth priorities.',
  currentDraftMarkdown: '',
  request: {
    intentType: 'CREATE_DELIVERABLE',
    refinement: false,
    outputTypeKey: 'BOARD_REVIEW',
    outputTypeLabel: 'Board Review',
    outputSchemaKey: 'BOARD_REVIEW_SCHEMA',
    requiredSections: ['Executive summary', 'Priorities'],
    styleKey: 'EXECUTIVE',
    styleLabel: 'Executive',
    requestedOutputTypeKey: 'board-review',
    requestedStyleKey: 'executive',
    workspaceType: 'OUTCOME_STUDIO',
    ...overrides.request,
  },
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request')),
})

const safeRequest = () => buildOutcomeStudioProviderSafeRequest({
  providerDescriptor: descriptor,
  providerInput: providerInput(),
})

const governedContent = [
  '# Business Guidance',
  'Prioritise the decision, commercial consequence, and evidence-based recommendation.',
  '# Structure',
  'Open with an executive summary, followed by priorities and recommended actions.',
  '# Executive Style',
  'Use concise business language, short sections, and decision-oriented headings.',
  '# Validation Criteria',
  'Every material claim must be supported by the verified business context.',
].join('\n')

const mockVersions = (versions) => {
  const lean = jest.fn().mockResolvedValue(versions)
  const select = jest.fn().mockReturnValue({ lean })
  jest.spyOn(KnowledgePackVersion, 'find').mockReturnValue({ select })
  return { lean, select }
}

afterEach(() => jest.restoreAllMocks())

describe('Outcome Studio provider-safe projection', () => {
  test('builds the exact bounded ID-free safe request from one canonical input', () => {
    const result = safeRequest()
    expect(result).toEqual({
      businessRequest: {
        outputTypeKey: 'BOARD_REVIEW',
        requestedOutputTypeKey: 'board-review',
        requestedStyleKey: 'executive',
        workspaceType: 'OUTCOME_STUDIO',
        instruction: [
          'Outcome: CREATE_DELIVERABLE.',
          'Deliverable: Board Review (BOARD_REVIEW).',
          'Structure: BOARD_REVIEW_SCHEMA; required sections: Executive summary, Priorities.',
          'Style: Executive (EXECUTIVE).',
          'Draft operation: initial creation.',
          'Customer request: Create a concise board review focused on growth priorities.',
        ].join(' '),
      },
      draftContext: { content: '' },
      effectiveRequest: {
        executionIntent: expect.any(String),
        draftContext: { content: '' },
      },
    })
    expect(result.effectiveRequest.executionIntent).toBe(result.businessRequest.instruction)
    expect(assertOutcomeStudioProviderSafeRequest(result)).toBe(result)
  })

  test.each([
    ['missing top-level field', (value) => { delete value.effectiveRequest }],
    ['extra nested field', (value) => { value.businessRequest.extra = true }],
    ['oversize instruction', (value) => { value.businessRequest.instruction = 'A'.repeat(2001); value.effectiveRequest.executionIntent = value.businessRequest.instruction }],
    ['mismatched effective intent', (value) => { value.effectiveRequest.executionIntent = 'Different request.' }],
    ['mismatched draft copy', (value) => { value.effectiveRequest.draftContext.content = 'Different draft.' }],
    ['unsafe internal terminology', (value) => { value.businessRequest.instruction = 'Expose the provider context.'; value.effectiveRequest.executionIntent = value.businessRequest.instruction }],
  ])('rejects a safe request with %s', (_label, mutate) => {
    const value = safeRequest()
    mutate(value)
    expect(() => assertOutcomeStudioProviderSafeRequest(value)).toThrow(expect.objectContaining({
      status: 422,
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    }))
  })

  test.each([
    ['Mongo ObjectId', '507f1f77bcf86cd799439011'],
    ['bare UUID', '123e4567-e89b-12d3-a456-426614174000'],
    ['prefixed UUID', 'outcome_draft_iteration_123e4567-e89b-12d3-a456-426614174000'],
    ['email', 'director@example.com'],
    ['credential', 'api_key=not-safe-at-all'],
    ['URL', 'https://internal.example.test/source'],
    ['hash', 'a'.repeat(64)],
    ['internal term', 'provider context'],
  ])('blocks %s in complete customer input before bounding', (_label, unsafe) => {
    expect(() => buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({ customerPrompt: `Prepare this ${unsafe} ${'x'.repeat(2200)}` }),
    })).toThrow(expect.objectContaining({
      status: 422,
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
      details: expect.objectContaining({ reason: 'PROVIDER_SAFE_CONTEXT_BLOCKED' }),
    }))
  })

  test('detects UUIDs adjacent to non-hex separators and permits malformed lookalikes', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    for (const prefix of ['_', '-', ':', 'g', 'z']) {
      expect(() => buildOutcomeStudioProviderSafeRequest({
        providerDescriptor: descriptor,
        providerInput: providerInput({ customerPrompt: `Review ${prefix}${uuid}` }),
      })).toThrow(expect.objectContaining({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' }))
    }
    expect(() => buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({ customerPrompt: 'Review 123e4567-e89b-02d3-a456-4266ab174000 and abcdefabcdefabcdefabcde.' }),
    })).not.toThrow()
  })

  test.each([
    ['Mongo ObjectId', '507f1f77bcf86cd799439011'],
    ['UUID', '123e4567-e89b-12d3-a456-426614174000'],
  ])('rejects %s values from complete draft and truth sources and discards them from recognized Knowledge Pack sections', async (_label, identifier) => {
    expect(() => buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({ currentDraftMarkdown: `Earlier draft ${identifier}` }),
    })).toThrow(expect.objectContaining({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' }))

    mockVersions([{ versionId: 'kpv-reasoning-v1', content: governedContent }])
    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [{ label: 'Commercial priority', content: `Unsafe truth ${identifier}` }] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
    jest.restoreAllMocks()

    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Optional Notes\nInternal source ${identifier}`,
    }])
    const projected = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })
    expect(JSON.stringify(projected)).not.toContain(identifier)
  })

  test.each(['a'.repeat(23), 'a'.repeat(25)])('permits non-ObjectId %s-character hexadecimal business text across all source types', async (hexValue) => {
    const request = buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({
        customerPrompt: `Prepare reference ${hexValue}.`,
        currentDraftMarkdown: `Draft reference ${hexValue}.`,
      }),
    })
    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Optional Notes\nBusiness reference ${hexValue}.`,
    }])
    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: request,
      truthSource: { acceptedTruth: [{ label: 'Commercial priority', content: `Business reference ${hexValue}.` }] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).resolves.toEqual(expect.objectContaining({ contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1' }))
  })

  test('loads exact selected content and emits only bounded customer-safe guidance', async () => {
    const query = mockVersions([{ versionId: 'kpv-reasoning-v1', content: governedContent }])
    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [{ label: 'Commercial priority', content: 'Growth depends on a clearer executive decision path.' }] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })
    expect(KnowledgePackVersion.find).toHaveBeenCalledWith({ versionId: { $in: ['kpv-reasoning-v1'] } })
    expect(query.select).toHaveBeenCalledWith('+content')
    expect(result).toEqual({
      contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
      businessRequest: safeRequest().businessRequest,
      draftContext: { content: '' },
      truthSummaries: [{ label: 'Commercial priority', summary: 'Growth depends on a clearer executive decision path.' }],
      guidance: {
        businessInstructions: [],
        reasoningGuidance: ['Business Guidance. Prioritise the decision, commercial consequence, and evidence-based recommendation.'],
        outputSchema: ['Structure. Open with an executive summary, followed by priorities and recommended actions.'],
        styleGuidance: ['Executive Style. Use concise business language, short sections, and decision-oriented headings.'],
        validationCriteria: ['Validation Criteria. Every material claim must be supported by the verified business context.'],
        prohibitedOutputBoundaries: [],
      },
      safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    })
    expect(JSON.stringify(result)).not.toMatch(/kpv-reasoning-v1|versionId|contentHash|manifest/i)
    expect(assertOutcomeStudioProviderSafeContext(result)).toBe(result)
  })

  test('removes URLs from accepted truth summaries without exposing or discarding the surrounding business statement', async () => {
    mockVersions([{ versionId: 'kpv-reasoning-v1', content: governedContent }])
    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: {
        acceptedTruth: [{
          label: 'Company context',
          content: 'The company provides a strategic messaging platform. Source: https://www.example.com/company',
        }],
      },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })

    expect(result.truthSummaries).toEqual([{
      label: 'Company context',
      summary: 'The company provides a strategic messaging platform. Source:',
    }])
    expect(JSON.stringify(result)).not.toContain('https://')
  })

  test('accepts exactly 2500 non-empty source lines while preserving bounded guidance', async () => {
    const content = [
      ...governedContent.split('\n'),
      ...Array.from({ length: 2492 }, (_, index) => `- supporting business criterion ${index + 1}`),
    ].join('\n')
    mockVersions([{ versionId: 'kpv-reasoning-v1', content }])

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).resolves.toEqual(expect.objectContaining({
      contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
      guidance: expect.objectContaining({
        validationCriteria: [expect.any(String)],
      }),
    }))
  })

  test('fails closed at 2501 non-empty source lines', async () => {
    const content = [
      ...governedContent.split('\n'),
      ...Array.from({ length: 2493 }, (_, index) => `- supporting business criterion ${index + 1}`),
    ].join('\n')
    mockVersions([{ versionId: 'kpv-reasoning-v1', content }])

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).rejects.toMatchObject({
      status: 422,
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    })
  })

  test.each([
    ['missing context field', (value) => { delete value.contractVersion }],
    ['extra guidance field', (value) => { value.guidance.extra = [] }],
    ['missing output schema', (value) => { value.guidance.outputSchema = [] }],
    ['missing style guidance', (value) => { value.guidance.styleGuidance = [] }],
    ['missing validation criteria', (value) => { value.guidance.validationCriteria = [] }],
    ['unsafe guidance', (value) => { value.guidance.styleGuidance = ['Use the provider context.'] }],
    ['altered safeguards', (value) => { value.safeguards = value.safeguards.slice(0, 4) }],
    ['oversize aggregate', (value) => {
      for (const key of Object.keys(value.guidance)) value.guidance[key] = Array.from({ length: 12 }, () => 'A'.repeat(500))
    }],
  ])('rejects provider context with %s', (_label, mutate) => {
    const value = {
      contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
      businessRequest: { ...safeRequest().businessRequest },
      draftContext: { content: '' },
      truthSummaries: [{ label: 'Priority', summary: 'Growth depends on a clear decision.' }],
      guidance: {
        businessInstructions: ['Prioritise the decision.'],
        reasoningGuidance: [],
        outputSchema: ['Use an executive summary.'],
        styleGuidance: ['Use concise business language.'],
        validationCriteria: ['Support material claims.'],
        prohibitedOutputBoundaries: [],
      },
      safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    }
    mutate(value)
    expect(() => assertOutcomeStudioProviderSafeContext(value)).toThrow(expect.objectContaining({
      status: 422,
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    }))
  })

  test('discards an unsafe recognized pack section but preserves complete required guidance', async () => {
    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Source Basis\nhttps://internal.example.test/source`,
    }])
    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })
    expect(JSON.stringify(result)).not.toContain('internal.example.test')
  })

  test.each([
    ['missing selected version', []],
    ['duplicate selected version', [{ versionId: 'kpv-reasoning-v1', content: governedContent }, { versionId: 'kpv-reasoning-v1', content: governedContent }]],
  ])('fails closed for %s', async (_label, versions) => {
    mockVersions(versions)
    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).rejects.toMatchObject({ status: 422, code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
  })
})
