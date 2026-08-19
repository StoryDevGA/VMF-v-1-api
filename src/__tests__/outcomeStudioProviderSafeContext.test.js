import crypto from 'crypto'
import { afterEach, describe, expect, jest, test } from '@jest/globals'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeComposition,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeFrameworkGuidanceProviderSafeContext,
  buildOutcomeStudioProviderSafeComposition,
  buildOutcomeStudioProviderSafeContext,
  buildOutcomeStudioGenerationContextConsumption,
  buildOutcomeStudioProviderSafeRequest,
  OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT,
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

const compositionPackage = (overrides = {}) => ({
  contractVersion: 'outcome-studio.evidence-to-composition.v1',
  status: 'READY',
  outputBinding: {
    outputTypeKey: 'BOARD_REVIEW',
    outputTypeVersion: '1.0.0',
    outputTypeStructure: [
      'Executive context',
      'Material findings grounded in Certified Truth',
      'Business implications',
      'Recommended decisions',
      'Immediate actions and accountable owners',
    ],
    outputSchemaKey: 'BOARD_REVIEW_SCHEMA',
    outputSchemaVersion: '1.0.0',
    styleKey: 'EXECUTIVE',
    styleVersion: '1.0.0',
    requiredSections: ['Executive summary', 'Priorities'],
    optionalSections: ['Truth certification'],
  },
  businessFactLedger: {
    facts: [{
      evidenceObjectId: 'evidence-object-1',
      sourceId: 'source-1',
      sectionKeys: ['customer_context'],
      statement: 'The customer has a governed decision process.',
      extractedFact: 'The customer has a governed decision process.',
      reviewStatus: 'ACCEPTED',
      validationStatus: 'VALIDATED',
      confidence: 'HIGH',
      materiality: 'HIGH',
      currentness: 'CURRENT',
      provenance: {
        lineageRef: 'lineage:source-1:1',
        sourceRegistryRef: 'source-1',
      },
      claimPermission: 'SUPPORTED_FACT_ONLY',
      qualification: ['Use as supplied business information.'],
      selectionReason: 'ACCEPTED_VALIDATED_TYPED_REFERENCE',
      factId: 'fact_abc123',
    }],
    omitted: [],
    contradictions: [],
  },
  ...overrides,
})

const methodGuidance = [{
  role: 'ARL',
  boundary: 'GENERATION_CONTEXT',
  version: 'arl-v1',
  guidance: 'Keep interpretation tied to supplied business information and retain material uncertainty.',
}]

const governanceConstraints = [
  'Do not invent unsupported claims or convert uncertainty into certainty.',
]

const directPackContents = Object.freeze({
  'kpv-direct-output-type': '# Document Metadata\nOutput type metadata only.',
  'kpv-direct-output-schema': '# Document Metadata\nOutput schema metadata only.',
  'kpv-direct-arl': '# Document Metadata\nARL metadata only.',
})

const buildDirectConsumptionFixture = (bindings = [
  { role: 'OUTPUT_TYPE', versionId: 'kpv-direct-output-type', contentHash: contentHash(directPackContents['kpv-direct-output-type']) },
  { role: 'OUTPUT_SCHEMA', versionId: 'kpv-direct-output-schema', contentHash: contentHash(directPackContents['kpv-direct-output-schema']) },
  { role: 'ARL', versionId: 'kpv-direct-arl', contentHash: contentHash(directPackContents['kpv-direct-arl']) },
]) => buildOutcomeStudioGenerationContextConsumption({
  compositionPackage: compositionPackage(),
  directBindings: bindings,
  methodGuidance,
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
  test('attributes exact direct composition items while keeping loaded-only candidate attribution unchanged', async () => {
    const supportContent = governedContent
    const versions = [
      ...Object.entries(directPackContents).map(([versionId, content]) => ({
        versionId,
        content,
        contentHash: contentHash(content),
      })),
      { versionId: 'kpv-guidance-support', content: supportContent, contentHash: contentHash(supportContent) },
    ]
    mockVersions(versions)
    const consumption = buildDirectConsumptionFixture()
    const captureExecutionEvidence = jest.fn()
    const knowledgeSelection = [
      { versionId: 'kpv-direct-output-type', knowledgeLayer: 'OUTPUT_TYPE', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_TYPE_DEFINITION' },
      { versionId: 'kpv-direct-output-schema', knowledgeLayer: 'OUTPUT_SCHEMA', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_SCHEMA' },
      { versionId: 'kpv-direct-arl', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT', packType: 'ARL' },
      { versionId: 'kpv-guidance-support', knowledgeLayer: 'FOUNDATION', executionMode: 'PROVIDER_CONTEXT', packType: 'FOUNDATION' },
    ]
    const executionBindings = versions.map(({ versionId, contentHash: hash }) => ({
      versionId,
      contentHash: hash,
    }))

    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection,
      executionBindings,
      compositionPackage: compositionPackage(),
      methodGuidance,
      governanceConstraints,
      ...consumption,
      captureExecutionEvidence,
    })

    const receipt = captureExecutionEvidence.mock.calls[0][0]
    for (const versionId of Object.keys(directPackContents)) {
      expect(receipt.packs.find((pack) => pack.versionId === versionId)).toEqual(expect.objectContaining({
        suppliedEntryCount: expect.any(Number),
        checks: expect.arrayContaining([
          expect.objectContaining({ key: 'PROVIDER_CONTEXT_SUPPLIED', status: 'PASSED' }),
        ]),
      }))
      expect(receipt.packs.find((pack) => pack.versionId === versionId).suppliedEntryCount)
        .toBeGreaterThan(0)
    }
    expect(JSON.stringify(result)).not.toMatch(/generationContextConsumption|itemFingerprints|kpv-direct-output-type/i)
  })

  test('canonical direct-consumption identity is stable across equivalent binding order', () => {
    const first = buildDirectConsumptionFixture()
    const second = buildDirectConsumptionFixture([
      { role: 'ARL', versionId: 'kpv-direct-arl', contentHash: contentHash(directPackContents['kpv-direct-arl']) },
      { role: 'OUTPUT_SCHEMA', versionId: 'kpv-direct-output-schema', contentHash: contentHash(directPackContents['kpv-direct-output-schema']) },
      { role: 'OUTPUT_TYPE', versionId: 'kpv-direct-output-type', contentHash: contentHash(directPackContents['kpv-direct-output-type']) },
    ])

    expect(second).toEqual(first)
  })

  test('fails closed when an exact direct contribution is missing from the final provider composition', async () => {
    const supportContent = governedContent
    const versions = [
      ...Object.entries(directPackContents).map(([versionId, content]) => ({
        versionId,
        content,
        contentHash: contentHash(content),
      })),
      { versionId: 'kpv-guidance-support', content: supportContent, contentHash: contentHash(supportContent) },
    ]
    mockVersions(versions)
    const consumption = buildDirectConsumptionFixture()
    consumption.generationContextConsumption[0].contributions[0].itemFingerprints[0] = contentHash('not supplied')

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [
        { versionId: 'kpv-direct-output-type', knowledgeLayer: 'OUTPUT_TYPE', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_TYPE_DEFINITION' },
        { versionId: 'kpv-direct-output-schema', knowledgeLayer: 'OUTPUT_SCHEMA', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_SCHEMA' },
        { versionId: 'kpv-direct-arl', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT', packType: 'ARL' },
        { versionId: 'kpv-guidance-support', knowledgeLayer: 'FOUNDATION', executionMode: 'PROVIDER_CONTEXT', packType: 'FOUNDATION' },
      ],
      executionBindings: versions.map(({ versionId, contentHash: hash }) => ({ versionId, contentHash: hash })),
      compositionPackage: compositionPackage(),
      methodGuidance,
      governanceConstraints,
      ...consumption,
    })).rejects.toMatchObject({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
      internalFailureStage: 'DIRECT_CONSUMPTION_VALIDATION',
    })
  })

  test('projects a READY composition package into explicit safe provider blocks and a redacted manifest', () => {
    const result = buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage(),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })

    expect(result).toEqual(expect.objectContaining({
      contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_COMPOSITION_CONTRACT,
      businessFacts: [expect.objectContaining({
        statement: 'The customer has a governed decision process.',
        sourceAttribution: {
          sourceType: 'GOVERNED_SOURCE',
          sourceLabel: 'Accepted business source',
        },
      })],
      outputStructure: expect.objectContaining({
        requiredSections: ['Executive summary', 'Priorities'],
      }),
      safetyManifest: expect.objectContaining({
        contentSafetyStatus: 'PASSED',
        businessFactCount: 1,
        requiredEvidenceRefs: [expect.stringMatching(/^ref_[a-f0-9]{16}$/)],
      }),
      readiness: {
        status: 'READY',
        draftOnly: false,
        gapCount: 0,
        notice: '',
      },
    }))
    expect(JSON.stringify(result)).not.toContain('evidence-object-1')
    expect(JSON.stringify(result)).not.toContain('source-1')
    expect(JSON.stringify(result)).not.toContain('lineage:source-1:1')
    expect(assertOutcomeStudioProviderSafeComposition(result)).toBe(result)
  })

  test('derives evidence handles from the corresponding raw fact when safe statement text is normalized', () => {
    const result = buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        businessFactLedger: {
          ...compositionPackage().businessFactLedger,
          facts: [{
            ...compositionPackage().businessFactLedger.facts[0],
            statement: '  The customer has a governed decision process.   ',
          }],
        },
      }),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })

    expect(result.businessFacts[0].statement).toBe('The customer has a governed decision process.')
    expect(result.safetyManifest.requiredEvidenceRefs).toHaveLength(1)
    expect(result.safetyManifest.requiredEvidenceRefs[0]).toMatch(/^ref_[a-f0-9]{16}$/)
  })

  test('rejects duplicate raw evidence identities instead of emitting duplicate redacted handles', () => {
    const fact = compositionPackage().businessFactLedger.facts[0]
    expect(() => buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        businessFactLedger: {
          facts: [
            fact,
            { ...fact, statement: 'A second statement with the same evidence identity.' },
          ],
          omitted: [],
          contradictions: [],
        },
      }),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })).toThrow(expect.objectContaining({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    }))
  })

  test.each([null, false, 0])('rejects primitive generation-composition inputs: %p', (invalidComposition) => {
    expect(() => buildOutcomeStudioGenerationContextConsumption({
      compositionPackage: invalidComposition,
      directBindings: [
        { role: 'OUTPUT_TYPE', versionId: 'output-type', contentHash: contentHash('type') },
        { role: 'OUTPUT_SCHEMA', versionId: 'output-schema', contentHash: contentHash('schema') },
        { role: 'ARL', versionId: 'arl', contentHash: contentHash('arl') },
      ],
      methodGuidance,
    })).toThrow(expect.objectContaining({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    }))
  })

  test('rejects empty method guidance before generation-context fingerprints are built', () => {
    expect(() => buildOutcomeStudioGenerationContextConsumption({
      compositionPackage: compositionPackage(),
      directBindings: [
        { role: 'OUTPUT_TYPE', versionId: 'output-type', contentHash: contentHash('type') },
        { role: 'OUTPUT_SCHEMA', versionId: 'output-schema', contentHash: contentHash('schema') },
        { role: 'ARL', versionId: 'arl', contentHash: contentHash('arl') },
      ],
      methodGuidance: [],
    })).toThrow(expect.objectContaining({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    }))
  })

  test('preserves a bounded READY_WITH_GAPS draft state in provider-safe composition and manifest', () => {
    const result = buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        readiness: {
          status: 'READY_WITH_GAPS',
          draftOnly: true,
          gapCount: 2,
          notice: 'This draft uses current governed information with unresolved source or framework gaps. Keep unsupported claims qualified and do not treat this draft as final.',
        },
      }),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })

    expect(result.readiness).toEqual(expect.objectContaining({
      status: 'READY_WITH_GAPS',
      draftOnly: true,
      gapCount: 2,
    }))
    expect(result.safetyManifest).toEqual(expect.objectContaining({
      readinessStatus: 'READY_WITH_GAPS',
      readinessGapCount: 2,
      draftOnly: true,
    }))
    expect(assertOutcomeStudioProviderSafeComposition(result)).toBe(result)
  })

  test('preserves the inferred output contract and method roles in the provider-safe manifest', () => {
    const inferredOutputContract = {
      contractVersion: 'outcome-studio.conversation-output-resolution.v1',
      status: 'RESOLVED',
      source: 'CONVERSATION_INFERENCE',
      confidence: 'HIGH',
      inferenceReason: 'Matched the available output phrase "Board Review" in the customer request.',
      outputIntent: { key: 'BOARD_REVIEW', label: 'Board Review', version: '' },
      audience: { key: 'EXECUTIVE', label: 'Executive', version: '' },
      purpose: { key: 'DECISION_SUPPORT', label: 'Decision support', version: '' },
      selectedOutputType: { key: 'BOARD_REVIEW', label: 'Board Review', version: '1.0.0' },
      selectedOutputSchema: { key: 'BOARD_REVIEW_SCHEMA', label: 'Board Review Schema', version: '1.0.0' },
      selectedStyle: { key: 'EXECUTIVE', label: 'Executive', version: '1.0.0' },
      knowledgePackRoles: [
        { role: 'OUTPUT_TYPE', classification: 'OUTPUT_TYPE', key: 'BOARD_REVIEW', label: 'Board Review', version: '1.0.0' },
        { role: 'OUTPUT_SCHEMA', classification: 'OUTPUT_SCHEMA', key: 'BOARD_REVIEW_SCHEMA', label: 'Board Review Schema', version: '1.0.0' },
        { role: 'STYLE', classification: 'STYLE', key: 'EXECUTIVE', label: 'Executive', version: '1.0.0' },
        { role: 'ARL', classification: 'METHOD', key: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer', version: 'arl-v1' },
        { role: 'RL', classification: 'METHOD', key: 'rendering-layer', label: 'Rendering Layer', version: 'rl-v1' },
        { role: 'VMF', classification: 'FRAMEWORK', key: 'VMF', label: 'Value Management Framework', version: '2.3.1' },
      ],
      clarificationPath: { required: false, reason: '', question: '' },
    }
    const expandedMethodGuidance = [
      ...methodGuidance,
      {
        role: 'RL',
        boundary: 'POST_GENERATION_VALIDATION',
        version: 'rl-v1',
        guidance: 'Preserve the selected structure and validate the rendered output.',
      },
    ]
    const result = buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        outputContractResolution: inferredOutputContract,
      }),
      governanceConstraints,
      methodGuidance: expandedMethodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })

    expect(result.outputContract).toEqual(inferredOutputContract)
    expect(result.outputContract.knowledgePackRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'ARL', version: 'arl-v1' }),
      expect.objectContaining({ role: 'RL', version: 'rl-v1' }),
      expect.objectContaining({ role: 'VMF', version: '2.3.1' }),
    ]))
    expect(result.safetyManifest).not.toHaveProperty('outputContractResolution')
    expect(assertOutcomeStudioProviderSafeComposition(result)).toBe(result)
  })

  test('blocks when the composition package is unsafe or the output selector does not match', () => {
    expect(() => buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        outputBinding: {
          ...compositionPackage().outputBinding,
          outputTypeKey: 'DIFFERENT_OUTPUT',
        },
      }),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })).toThrow()

    expect(() => buildOutcomeStudioProviderSafeComposition({
      compositionPackage: compositionPackage({
        businessFactLedger: {
          ...compositionPackage().businessFactLedger,
          facts: [{
            ...compositionPackage().businessFactLedger.facts[0],
            statement: 'Use the secret=not-safe value.',
          }],
        },
      }),
      governanceConstraints,
      methodGuidance,
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      styleGuidance: ['Use concise, neutral business language.'],
    })).toThrow()
  })

  test('adds the composition block and manifest receipt only when the explicit seam is supplied', async () => {
    const versionRows = [
      ...Object.entries(directPackContents).map(([versionId, content]) => ({
        versionId,
        contentHash: contentHash(content),
        content,
      })),
      { versionId: 'pack-1', contentHash: contentHash(governedContent), content: governedContent },
    ]
    const versions = mockVersions(versionRows)
    const consumption = buildDirectConsumptionFixture()
    const captureExecutionEvidence = jest.fn()
    const context = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [{ label: 'Situation', content: 'The customer has a governed decision process.' }] },
      knowledgeSelection: [
        { versionId: 'kpv-direct-output-type', knowledgeLayer: 'OUTPUT_TYPE', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_TYPE_DEFINITION' },
        { versionId: 'kpv-direct-output-schema', knowledgeLayer: 'OUTPUT_SCHEMA', executionMode: 'PROVIDER_CONTEXT', packType: 'OUTPUT_SCHEMA' },
        { versionId: 'kpv-direct-arl', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT', packType: 'ARL' },
        { versionId: 'pack-1', knowledgeLayer: 'FOUNDATION', executionMode: 'PROVIDER_CONTEXT', packType: 'FOUNDATION' },
      ],
      executionBindings: versionRows.map(({ versionId, contentHash: hash }) => ({ versionId, contentHash: hash })),
      compositionPackage: compositionPackage(),
      methodGuidance,
      governanceConstraints,
      ...consumption,
      captureExecutionEvidence,
    })

    expect(context.composition).toBeDefined()
    expect(captureExecutionEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestManifest: context.composition,
    }))
    expect(assertOutcomeStudioProviderSafeContext(context)).toBe(context)
    versions.lean.mockClear()
  })

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

  test('records exact load, projection, admission, and shared deduplicated attribution without changing provider context', async () => {
    const versionIds = ['kpv-shared-one', 'kpv-shared-two']
    mockVersions(versionIds.map((versionId) => ({
      versionId,
      content: governedContent,
      contentHash: contentHash(governedContent),
    })))
    const captureExecutionEvidence = jest.fn()

    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: versionIds.map((versionId) => ({
        versionId,
        knowledgeLayer: 'REASONING',
        executionMode: 'PROVIDER_CONTEXT',
      })),
      executionBindings: versionIds.map((versionId) => ({
        versionId,
        contentHash: contentHash(governedContent),
      })),
      captureExecutionEvidence,
    })

    expect(Object.keys(result)).toEqual([
      'contractVersion',
      'businessRequest',
      'draftContext',
      'truthSummaries',
      'safeguards',
      'guidance',
    ])
    expect(captureExecutionEvidence).toHaveBeenCalledTimes(1)
    const receipt = captureExecutionEvidence.mock.calls[0][0]
    expect(receipt.packs).toHaveLength(2)
    expect(receipt.packs).toEqual(expect.arrayContaining(versionIds.map((versionId) => expect.objectContaining({
      versionId,
      contentHash: contentHash(governedContent),
      sharedContribution: true,
      safeCandidateEntryCount: 4,
      projectionDisposition: 'PROJECTED',
      admissionDisposition: 'ADMITTED',
      suppliedEntryCount: 4,
      checks: expect.arrayContaining([
        expect.objectContaining({ key: 'RESOLUTION_VERIFIED', status: 'PASSED' }),
        expect.objectContaining({ key: 'VERSION_CONTENT_LOADED', status: 'PASSED' }),
        expect.objectContaining({ key: 'SAFE_GUIDANCE_PROJECTED', status: 'PASSED' }),
        expect.objectContaining({ key: 'PROVIDER_CONTEXT_SUPPLIED', status: 'PASSED' }),
        expect.objectContaining({ key: 'PROVIDER_COMPLETED', status: 'NOT_RECORDED' }),
      ]),
    }))))
    expect(JSON.stringify(result)).not.toMatch(/kpv-shared|contentHash|executionEvidence/i)
  })

  test('projects at least one safe entry per selected validation pack before filling category capacity', async () => {
    const validationHeavyContent = [
      governedContent,
      ...Array.from({ length: 20 }, (_item, index) => [
        `# Validation Criteria ${index + 1}`,
        `Check ${index + 1} must preserve verified business support.`,
      ].join('\n')),
    ].join('\n')
    const laterValidationPacks = Array.from({ length: 6 }, (_item, index) => ({
      versionId: `kpv-validation-later-${index + 1}`,
      content: [
        '# Validation Criteria',
        `Later validation pack ${index + 1} must contribute one safe check.`,
      ].join('\n'),
    }))
    const versions = [
      { versionId: 'kpv-validation-heavy', content: validationHeavyContent },
      ...laterValidationPacks,
    ].map((version) => ({
      ...version,
      contentHash: contentHash(version.content),
    }))
    mockVersions(versions)
    const captureExecutionEvidence = jest.fn()

    const providerVersions = versions.slice(0, 1)
    mockVersions(providerVersions)
    await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: providerVersions.map((version) => ({
        versionId: version.versionId,
        knowledgeLayer: 'REASONING',
        executionMode: 'PROVIDER_CONTEXT',
      })),
      executionBindings: providerVersions.map((version) => ({
        versionId: version.versionId,
        contentHash: version.contentHash,
      })),
      captureExecutionEvidence,
    })

    const receipt = captureExecutionEvidence.mock.calls[0][0]
    for (const version of providerVersions) {
      expect(receipt.packs.find((pack) => pack.versionId === version.versionId)).toEqual(expect.objectContaining({
        projectedEntryCount: expect.any(Number),
        suppliedEntryCount: expect.any(Number),
        checks: expect.arrayContaining([
          expect.objectContaining({ key: 'SAFE_GUIDANCE_PROJECTED', status: 'PASSED' }),
          expect.objectContaining({ key: 'PROVIDER_CONTEXT_SUPPLIED', status: 'PASSED' }),
        ]),
      }))
    }
    expect(receipt.packs.every((pack) => pack.projectedEntryCount >= 1 && pack.suppliedEntryCount >= 1)).toBe(true)
  })

  test('rejects validation-only selections before provider-safe projection', async () => {
    const content = `${governedContent}\n# Validation Criteria\nReview the rendered draft.`
    const hash = contentHash(content)
    mockVersions([{ versionId: 'kpv-post-validation', content, contentHash: hash }])

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{
        versionId: 'kpv-post-validation',
        knowledgeLayer: 'VALIDATION',
        executionMode: 'POST_VALIDATION',
      }],
      executionBindings: [{ versionId: 'kpv-post-validation', contentHash: hash }],
    })).rejects.toMatchObject({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    })
  })

  test('fails closed before provider-context completion when selected version content hash differs', async () => {
    mockVersions([{
      versionId: 'kpv-hash-mismatch',
      content: governedContent,
      contentHash: contentHash(governedContent),
    }])
    const captureExecutionEvidence = jest.fn()

    await expect(buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [{ versionId: 'kpv-hash-mismatch', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
      executionBindings: [{
        versionId: 'kpv-hash-mismatch',
        contentHash: contentHash(`${governedContent} changed`),
      }],
      captureExecutionEvidence,
    })).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
    expect(captureExecutionEvidence).not.toHaveBeenCalled()
  })

  test('marks a selected metadata-only pack as not supplied while other packs satisfy required guidance', async () => {
    const metadataOnly = '# Document Metadata\nVersion 1.0.0'
    mockVersions([
      { versionId: 'kpv-governed', content: governedContent, contentHash: contentHash(governedContent) },
      { versionId: 'kpv-metadata-only', content: metadataOnly, contentHash: contentHash(metadataOnly) },
    ])
    const captureExecutionEvidence = jest.fn()

    await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: [
        { versionId: 'kpv-governed', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' },
        { versionId: 'kpv-metadata-only', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' },
      ],
      executionBindings: [
        { versionId: 'kpv-governed', contentHash: contentHash(governedContent) },
        { versionId: 'kpv-metadata-only', contentHash: contentHash(metadataOnly) },
      ],
      captureExecutionEvidence,
    })

    const metadataReceipt = captureExecutionEvidence.mock.calls[0][0].packs
      .find((pack) => pack.versionId === 'kpv-metadata-only')
    expect(metadataReceipt).toEqual(expect.objectContaining({
      projectedEntryCount: 0,
      safeCandidateEntryCount: 0,
      suppliedEntryCount: 0,
      projectionDisposition: 'NO_SAFE_GUIDANCE',
      admissionDisposition: 'NOT_APPLICABLE',
      status: 'NOT_SUPPLIED',
      checks: expect.arrayContaining([
        expect.objectContaining({ key: 'SAFE_GUIDANCE_PROJECTED', status: 'NOT_SUPPLIED' }),
        expect.objectContaining({ key: 'PROVIDER_CONTEXT_SUPPLIED', status: 'NOT_SUPPLIED' }),
      ]),
    }))
  })

  test('records a bounded internal stage and reason when required guidance is missing', async () => {
    mockVersions([{ versionId: 'kpv-metadata-only', content: '# Document Metadata\nVersion 1.0.0' }])

    try {
      await buildOutcomeStudioProviderSafeContext({
        providerDescriptor: descriptor,
        safeRequest: safeRequest(),
        truthSource: { acceptedTruth: [] },
        knowledgeSelection: [{ versionId: 'kpv-metadata-only', knowledgeLayer: 'REASONING', executionMode: 'PROVIDER_CONTEXT' }],
      })
      throw new Error('Expected provider-safe context construction to fail.')
    } catch (error) {
      expect(error).toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
      expect(error.internalFailureStage).toBe('REQUIRED_GUIDANCE_ADMISSION')
      expect(error.internalDiagnosticCode).toBe('REQUIRED_GUIDANCE_MISSING')
      expect(Object.keys(error.details)).not.toEqual(expect.arrayContaining([
        'internalFailureStage',
        'internalDiagnosticCode',
      ]))
    }
  })

  test('distinguishes safe candidates omitted by the per-category cap', async () => {
    const laterReasoningPacks = Array.from({ length: 12 }, (_item, index) => ({
      versionId: `kpv-reasoning-later-${index + 1}`,
      content: `# Runtime Guidance ${index + 1}\nUnique reasoning guidance ${index + 1} preserves verified business support.`,
    }))
    const versions = [
      { versionId: 'kpv-reasoning-base', content: governedContent },
      ...laterReasoningPacks,
    ].map((version) => ({
      ...version,
      contentHash: contentHash(version.content),
    }))
    mockVersions(versions)
    const captureExecutionEvidence = jest.fn()

    await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: versions.map((version) => ({
        versionId: version.versionId,
        knowledgeLayer: 'REASONING',
        executionMode: 'PROVIDER_CONTEXT',
      })),
      executionBindings: versions.map((version) => ({
        versionId: version.versionId,
        contentHash: version.contentHash,
      })),
      captureExecutionEvidence,
    })

    const cappedReceipt = captureExecutionEvidence.mock.calls[0][0].packs
      .find((pack) => pack.versionId === 'kpv-reasoning-later-12')
    expect(cappedReceipt).toEqual(expect.objectContaining({
      safeCandidateEntryCount: 1,
      projectedEntryCount: 0,
      suppliedEntryCount: 0,
      projectionDisposition: 'CATEGORY_LIMITED',
      admissionDisposition: 'NOT_APPLICABLE',
      status: 'NOT_SUPPLIED',
    }))
  })

  test('records context-limit admission when a projected candidate cannot fit', async () => {
    const longGuidance = 'Use only verified business context and preserve material qualification. '.repeat(10)
    const versions = Array.from({ length: 20 }, (_item, index) => {
      const content = [
        `# Business Guidance ${index + 1}\n${longGuidance}`,
        `# Reasoning Guidance ${index + 1}\n${longGuidance}`,
        `# Output Schema ${index + 1}\n${longGuidance}`,
        `# Executive Style ${index + 1}\n${longGuidance}`,
        `# Validation Criteria ${index + 1}\n${longGuidance}`,
        `# Prohibited Boundary ${index + 1}\n${longGuidance}`,
      ].join('\n')
      return {
        versionId: `kpv-context-limit-${index + 1}`,
        content,
        contentHash: contentHash(content),
      }
    })
    mockVersions(versions)
    const captureExecutionEvidence = jest.fn()

    await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection: versions.map((version) => ({
        versionId: version.versionId,
        knowledgeLayer: 'REASONING',
        executionMode: 'PROVIDER_CONTEXT',
      })),
      executionBindings: versions.map((version) => ({
        versionId: version.versionId,
        contentHash: version.contentHash,
      })),
      captureExecutionEvidence,
    })

    const receipt = captureExecutionEvidence.mock.calls[0][0]
    expect(receipt.packs.some((pack) => (
      pack.projectionDisposition === 'PROJECTED'
      && pack.admissionDisposition === 'CONTEXT_LIMIT'
      && pack.suppliedEntryCount === 0
    ))).toBe(true)
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

  test('admits CSDP-sized governed selections without exposing pack identifiers', async () => {
    const knowledgeLayers = [
      'FOUNDATION',
      'DOMAIN',
      'SOLUTION',
      'ORGANISATION',
      'RUNTIME',
      'SYSTEM',
      'REASONING',
      'FRAMEWORK',
      'AUDIENCE',
      'INDUSTRY',
      'OUTPUT_TYPE',
      'OUTPUT_SCHEMA',
      'COMMUNICATION_PATTERN',
      'STYLE',
      'CHANNEL',
      'BRAND',
      'LANGUAGE',
      'VISUAL_SYSTEM',
      'VALIDATION',
    ]
    const versions = Array.from({ length: 33 }, (_, index) => ({
      versionId: `kpv-csdp-selection-${index + 1}`,
      content: `${governedContent}\n# General Guidance\nCSDP selected guidance item ${index + 1}.`,
    }))
    const knowledgeSelection = versions.map((version, index) => ({
      versionId: version.versionId,
      knowledgeLayer: knowledgeLayers[index % knowledgeLayers.length],
      executionMode: 'PROVIDER_CONTEXT',
    }))
    mockVersions(versions)

    const result = await buildOutcomeStudioProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: safeRequest(),
      truthSource: { acceptedTruth: [] },
      knowledgeSelection,
    })

    expect(result.contractVersion).toBe('OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1')
    expect(result.guidance.validationCriteria.length).toBeGreaterThan(0)
    expect(result.guidance.outputSchema.length).toBeGreaterThan(0)
    expect(result.guidance.styleGuidance.length).toBeGreaterThan(0)
    expect(
      result.guidance.businessInstructions.length + result.guidance.reasoningGuidance.length,
    ).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toMatch(/kpv-csdp-selection|versionId|contentHash|manifest/i)
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
