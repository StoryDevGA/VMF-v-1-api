import crypto from 'crypto'
import { afterEach, describe, expect, jest, test } from '@jest/globals'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeFrameworkGuidanceProviderSafeContext,
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

const contentHash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`

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
    ['padded Basic credential', 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='],
    ['unpadded Basic credential', 'Basic dXNlcjpwYXNz'],
    ['Bearer credential', 'Bearer live-test-access-token'],
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

  test.each([
    ['ordinary certification prose', 'Basic evidence exists'],
    ['ordinary business prose', 'Basic business guidance'],
    ['canonical Base64 without a colon', 'Basic ZXZpZGVuY2U='],
    ['invalid alphabet suffix', 'Basic dXNlcjpwYXNz!suffix'],
    ['invalid padding', 'Basic dXNlcjpwYXNz==='],
  ])('does not classify %s as a Basic-auth credential', (_label, text) => {
    expect(() => buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({ customerPrompt: `Review ${text} for the executive brief.` }),
    })).not.toThrow()
  })

  test('still rejects an independent unsafe signal beside malformed Basic-auth text', () => {
    expect(() => buildOutcomeStudioProviderSafeRequest({
      providerDescriptor: descriptor,
      providerInput: providerInput({
        customerPrompt: 'Review Basic dXNlcjpwYXNz!suffix for director@example.com.',
      }),
    })).toThrow(expect.objectContaining({
      status: 422,
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
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

  test('projects SS-008 governance layers into provider-safe guidance buckets', async () => {
    mockVersions([
      { versionId: 'kpv-foundation-v1', content: `${governedContent}\n# General Guidance\nFoundation operating model.` },
      { versionId: 'kpv-domain-v1', content: '# General Guidance\nDomain context model.' },
      { versionId: 'kpv-solution-v1', content: '# General Guidance\nSolution design model.' },
      { versionId: 'kpv-organisation-v1', content: '# General Guidance\nOrganisation operating model.' },
      { versionId: 'kpv-runtime-v1', content: '# General Guidance\nRuntime behavior model.' },
      { versionId: 'kpv-system-v1', content: '# General Guidance\nSystem governance model.' },
    ])
    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [
        { versionId: 'kpv-foundation-v1', knowledgeLayer: 'FOUNDATION', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-domain-v1', knowledgeLayer: 'DOMAIN', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-solution-v1', knowledgeLayer: 'SOLUTION', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-organisation-v1', knowledgeLayer: 'ORGANISATION', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-runtime-v1', knowledgeLayer: 'RUNTIME', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-system-v1', knowledgeLayer: 'SYSTEM', executionMode: 'PROVIDER_CONTEXT' },
      ],
    })

    expect(result.guidance.businessInstructions).toEqual(expect.arrayContaining([
      expect.stringContaining('Foundation operating model'),
      expect.stringContaining('Domain context model'),
      expect.stringContaining('Solution design model'),
      expect.stringContaining('Organisation operating model'),
    ]))
    expect(result.guidance.reasoningGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('Runtime behavior model'),
      expect.stringContaining('System governance model'),
    ]))
  })

  test('admits ordinary Basic certification prose from selected Knowledge Pack content', async () => {
    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Evidence Guidance\nBasic evidence exists, but truth remains early-stage and qualified.`,
    }])

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).resolves.toEqual(expect.objectContaining({
      contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
    }))
  })

  test('builds framework-guidance provider context only from bound truth and pack references', async () => {
    const frameworkContent = [
      '# Business Guidance',
      'Prioritise the decision, commercial consequence, and evidence-based recommendation.',
      '# Structure',
      'Open with an executive summary, followed by priorities and recommended actions.',
      '# Executive Style',
      'Use concise business language, short sections, and decision-oriented headings.',
      '# Validation Criteria',
      'Use accepted reference tokens as scoped business inputs.',
    ].join('\n')
    const truthBinding = {
      sectionKey: 'customer_problem',
      content: 'The customer needs a clearer decision narrative for the leadership group.',
    }
    const knowledgeSelection = [
      { versionId: 'kpv-framework-guidance-v1', knowledgeLayer: 'FRAMEWORK', executionMode: 'PROVIDER_CONTEXT' },
    ]
    mockVersions([{ versionId: 'kpv-framework-guidance-v1', content: frameworkContent, contentHash: contentHash(frameworkContent) }])

    const result = await buildOutcomeFrameworkGuidanceProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [{ label: truthBinding.sectionKey, content: truthBinding.content }] },
      knowledgeSelection,
      expectedTruthBindings: [truthBinding],
      expectedPackBindings: [{
        ...knowledgeSelection[0],
        contentHash: contentHash(frameworkContent),
      }],
      truthReferenceKeys: [truthBinding.sectionKey],
      activationReferenceIds: ['actv-framework-guidance-v1'],
    })

    expect(result.truthSummaries).toEqual([{
      label: truthBinding.sectionKey,
      summary: truthBinding.content,
    }])
    expect(result.guidance.validationCriteria).toEqual(expect.arrayContaining([
      expect.stringContaining('accepted reference tokens'),
    ]))
    expect(JSON.stringify(result)).not.toMatch(/actv-framework-guidance-v1|contentHash|versionId/i)
  })

  test('rejects framework-guidance context when expected pack binding hash is stale', async () => {
    const frameworkContent = governedContent
    const knowledgeSelection = [
      { versionId: 'kpv-framework-guidance-v1', knowledgeLayer: 'FRAMEWORK', executionMode: 'PROVIDER_CONTEXT' },
    ]
    mockVersions([{ versionId: 'kpv-framework-guidance-v1', content: frameworkContent, contentHash: contentHash(frameworkContent) }])

    await expect(buildOutcomeFrameworkGuidanceProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [{ label: 'customer_problem', content: 'The customer needs a clearer decision narrative.' }] },
      knowledgeSelection,
      expectedTruthBindings: [{ sectionKey: 'customer_problem', content: 'The customer needs a clearer decision narrative.' }],
      expectedPackBindings: [{
        ...knowledgeSelection[0],
        contentHash: contentHash(`${frameworkContent} changed`),
      }],
      truthReferenceKeys: ['customer_problem'],
      activationReferenceIds: ['actv-framework-guidance-v1'],
    })).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
  })

  test('handles separator-heavy numeric lookalikes without rejecting provider-safe content', async () => {
    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Optional Notes\n${'1'.padEnd(20000, '(')}`,
    }])

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-reasoning-v1', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
    })).resolves.toEqual(expect.objectContaining({
      contractVersion: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
    }))
  })

  test.each([
    ['padded', 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='],
    ['unpadded', 'Basic dXNlcjpwYXNz'],
  ])('rejects %s Basic credentials from selected Knowledge Pack content', async (_label, credential) => {
    mockVersions([{
      versionId: 'kpv-reasoning-v1',
      content: `${governedContent}\n# Evidence Guidance\n${credential}`,
    }])

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
