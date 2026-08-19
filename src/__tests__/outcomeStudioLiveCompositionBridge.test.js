import { describe, test, expect, jest } from '@jest/globals'

import {
  buildOutcomeStudioLiveComposition,
  OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS,
} from '../services/outcomeStudioLiveCompositionBridgeService.js'

const makePack = ({ packKey, capabilityKey = packKey, boundary = '', format = 'YAML' } = {}) => ({
  packId: `pack-${packKey}`,
  activationId: `activation-${packKey}`,
  versionId: `version-${packKey}`,
  contentHash: `sha256:${packKey.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`,
  semanticVersion: '1.0.0',
  status: 'ACTIVE',
  packKey,
  capabilityKey,
  contentFormat: format,
  ...(boundary ? { boundary } : {}),
})

const contentByPack = {
  'executive-brief': `# Executive Brief\n\n## Required Structure\n1. Executive context\n2. Material findings grounded in Certified Truth\n3. Business implications\n4. Recommended decisions\n5. Immediate actions and accountable owners\n\n## Governance Rules\n- Do not introduce claims absent from Certified Truth.\n- Separate evidence, interpretation, and recommendation.\n- Make uncertainty and missing evidence explicit.\n- Use resolved Executive Brief schema/style dependencies.`,
  'executive-brief-schema': `schemas:\n  executive-brief-schema:\n    required_sections:\n      - context\n      - findings\n      - implications\n      - decisions\n      - actions\n      - assumptions\n      - evidence\n      - risks\n      - next_steps\n    optional_sections:\n      - appendix\n      - sources\n    prohibited:\n      - Unsupported certainty`,
  'adaptive-reasoning-layer': `pack:\n  key: adaptive-reasoning-layer\n  principle: Preserve verified business information and make uncertainty visible.\ntruth_binding_rules:\n  must_preserve:\n    - Accepted evidence wording\n  must_not:\n    - Introduce unsupported claims\nreasoning_stages:\n  - key: assess\n    purpose: Assess decision relevance\nsafety_gates:\n  - key: truth\n    outcome: Preserve current evidence\ncustomer_visible:\n  prohibited:\n    - Hidden implementation detail`,
  'rendering-layer': `pack:\n  key: rendering-layer\n  principle: Present a clear, neutral business response.\nrendering_rules:\n  must_include:\n    - Required sections\n  must_not:\n    - Add unsupported certainty\ncustomer_safe_output:\n  sections:\n    - Business context\n  prohibited:\n    - Internal implementation detail\n    - unsupported ROI\n    - unsupported customer proof\nexport_rules:\n  MARKDOWN:\n    allowed: true\n    customer_content_only: true`,
}

const makeInput = ({
  contextStatus = 'READY',
  contextAvailable = contextStatus === 'READY',
  bindingStatus = 'READY',
  allowReadyWithGaps = false,
  handoffStatus = 'READY',
  contextBlockers = [],
  bindingBlockers = [],
  handoffBlockers = [],
  arlBoundary = 'GENERATION_CONTEXT',
  requestedFormat = '',
  outputTypeFormat = 'MARKDOWN',
  schemaFormat = 'YAML',
  outputTypeContent = contentByPack['executive-brief'],
  schemaContent = contentByPack['executive-brief-schema'],
  renderingContent = contentByPack['rendering-layer'],
  bindingLineageOverrides = {},
  loadedOverridesByPack = {},
  buildComposition,
} = {}) => {
  const outputType = makePack({ packKey: 'executive-brief', capabilityKey: 'executive-brief', format: outputTypeFormat })
  const schema = makePack({ packKey: 'executive-brief-schema', capabilityKey: 'executive-brief-schema', format: schemaFormat })
  const style = makePack({ packKey: 'executive-briefing-style', capabilityKey: 'executive-brief-style' })
  const arl = makePack({ packKey: 'adaptive-reasoning-layer', boundary: arlBoundary })
  const rl = makePack({ packKey: 'rendering-layer', boundary: 'POST_GENERATION_VALIDATION' })
  const packs = [outputType, schema, style, arl, rl]
  const frameworkState = {
    lock: {
      outputEligibility: {
        locked: true,
        outputEligible: true,
        canonicalOutputEligible: true,
        snapshotId: 'lock-1',
        snapshotHash: 'hash-lock-1',
        replayAnchorId: 'replay-1',
        replayAnchorHash: 'hash-replay-1',
      },
    },
    evidence_pack: {
      evidenceObjects: [{
        evidenceObjectId: 'evidence-1',
        sourceId: 'source-1',
        lineageRef: 'lineage-1',
        extractedFact: 'The customer has a governed decision process.',
        reviewStatus: 'ACCEPTED',
        validationStatus: 'VALIDATED',
        currentness: 'CURRENT',
      }],
      sourceRegistry: [{ sourceId: 'source-1', sourceType: 'DOCUMENT', label: 'Source 1' }],
      lineage: { builder: { version: 'evidence-v1' } },
      discoveryHealth: { contradictionCandidates: [] },
    },
    sections: {
      customer_context: { accepted: { supportingEvidenceRefs: ['evidence-1'] } },
    },
    intelligence_graph: { graphVersion: 'graph-v1', graphHash: 'hash-graph-1' },
  }
  return {
    runtimeInstance: {
      _id: 'runtime-1',
      runtimeInstanceKey: 'runtime-key-1',
      runtimeType: 'VALUE_NARRATIVE',
      frameworkKey: 'VMF',
      packageKey: 'standard-package',
      packageVersion: '3.1.3',
      status: 'LOCKED',
      revision: { revisionNumber: 2 },
    },
    frameworkState,
    frameworkHandoff: {
      status: handoffStatus,
      contractVersion: 'handoff-v1',
      currentness: { status: 'CURRENT', sectionTruthHash: 'section-truth-v1', handoffHash: 'handoff-hash-1' },
      warnings: ['Framework warning'],
      customerSafe: { nextAction: 'Resolve the Framework gap.' },
      blockers: handoffBlockers,
      gaps: handoffStatus === 'READY_WITH_GAPS' ? ['A bounded gap.'] : [],
      claimBoundaries: [
        'QUANTIFIED_CLAIMS',
        'ROI_CLAIMS',
        'FINANCIAL_IMPACT_CLAIMS',
        'CUSTOMER_PROOF',
        'NAMED_CUSTOMER_CLAIMS',
      ].map((claimType) => ({
        claimType,
        policyVersion: 'ss-011.claim-boundary-policy.v1',
        status: 'BLOCKED_UNLESS_ACCEPTED_EVIDENCE_AND_BOUNDARY_PASS',
      })),
    },
    knowledgeContextResult: {
      context: {
        status: contextStatus,
        available: contextAvailable,
        outputType: { key: 'executive-brief', label: 'Executive Brief', version: '1.0.0' },
        outputSchema: { key: 'executive-brief-schema', version: '1.0.0' },
        style: { key: 'executive-brief-style', version: '1.0.0' },
        lineage: { versionIds: ['context-v1'], contentHashes: ['context-hash-v1'] },
        warnings: ['A warning'],
        blockers: contextBlockers,
      },
      reasoningBinding: {
        status: bindingStatus,
        blockers: bindingBlockers,
        lineage: {
          versionIds: packs.map((pack) => pack.versionId),
          activationIds: packs.map((pack) => pack.activationId),
          contentHashes: packs.map((pack) => pack.contentHash),
          ...bindingLineageOverrides,
        },
        selectedByLayer: {
          OUTPUT_TYPE: [outputType],
          OUTPUT_SCHEMA: [schema],
          STYLE: [style],
          REASONING: [arl],
          COMMUNICATION_PATTERN: [rl],
        },
      },
    },
    truthSignature: {
      truthSignatureId: 'truth-signature-1',
      status: 'PROJECTED',
      currentness: 'CURRENT',
      evidence: { unresolvedContradictionCount: 0 },
    },
    sourceOutput: { outputAssetId: 'source-output-1', outputTypeKey: 'EXECUTIVE_BRIEF' },
    requestedOutputTypeKey: 'executive-brief',
    requestedFormat,
    userPrompt: 'Prepare a governed Executive Brief from the current business information.',
    allowReadyWithGaps,
    loadPackContent: jest.fn(async ({ packId, versionId }) => {
      const pack = packs.find((entry) => entry.packId === packId && entry.versionId === versionId)
      const loaded = {
        available: true,
        packId: pack.packId,
        packKey: pack.packKey,
        versionId,
        semanticVersion: pack.semanticVersion,
        status: pack.status,
        contentHash: pack.contentHash,
        contentFormat: pack.contentFormat,
        content: pack.packKey === 'executive-brief'
          ? outputTypeContent
          : pack.packKey === 'executive-brief-schema'
            ? schemaContent
            : pack.packKey === 'rendering-layer'
            ? renderingContent
              : contentByPack[pack.packKey],
      }
      return { ...loaded, ...(loadedOverridesByPack[pack.packKey] || {}) }
    }),
    ...(buildComposition ? { buildComposition } : {}),
  }
}

const expectBlockedWithoutComposition = async (input, reason) => {
  await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({ reason })
  expect(input.buildComposition).not.toHaveBeenCalled()
}

describe('Outcome Studio live composition bridge', () => {
  test('projects active content and truth identities into the composition worker', async () => {
    const input = makeInput()
    const result = await buildOutcomeStudioLiveComposition(input)

    expect(result.contractVersion).toBe('outcome-studio.live-composition-bridge.v1')
    expect(result.compositionPackage.status).toBe('READY')
    expect(result.compositionPackage.outputBinding.outputTypeStructure).toHaveLength(5)
    expect(result.compositionPackage.outputBinding.requiredSections).toHaveLength(9)
    expect(result.methodGuidance.map((entry) => entry.role)).toEqual(['ARL'])
    expect(result.methodPackBindings.map((entry) => entry.role)).toEqual(['ARL', 'RL'])
    expect(result.governanceConstraints.length).toBeGreaterThan(0)
    expect(result.governanceConstraints.length).toBeLessThanOrEqual(16)
    expect(result.governanceConstraints.join(' ')).toContain('Unsupported certainty')
    expect(result.governanceConstraints.join(' ')).toMatch(/ROI.*financial impact.*customer proof.*named customer/i)
    expect(result.governanceConstraints.join(' ')).toMatch(/Hidden.*internal.*raw source.*system-level instructions/i)
    expect(result.governanceConstraints.join(' ')).not.toMatch(/Add unsupported certainty|Internal implementation detail/)
    expect(result.generationContextConsumption.map((entry) => entry.role)).toEqual([
      'ARL',
      'OUTPUT_SCHEMA',
      'OUTPUT_TYPE',
    ])
    expect(result.generationContextConsumption).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'RL' }),
      expect.objectContaining({ role: 'STYLE' }),
    ]))
    expect(result.generationContextConsumptionFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.compositionPackage.truthBinding.evidenceVersion).toBe('evidence-v1')
    expect(result.compositionPackage.truthBinding.sectionTruthVersion).toBe('section-truth-v1')
    expect(input.loadPackContent).toHaveBeenCalledTimes(4)
  })

  test('blocks READY_WITH_GAPS before active content loading', async () => {
    const input = makeInput({ contextStatus: 'READY_WITH_GAPS' })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.READY_WITH_GAPS_BLOCKED,
      details: expect.objectContaining({
        warnings: expect.arrayContaining(['A warning']),
        nextAction: 'Resolve the Framework gap.',
      }),
    })
    expect(input.loadPackContent).not.toHaveBeenCalled()
  })

  test.each(['true', 1, null])('rejects non-boolean READY_WITH_GAPS opt-in: %p', async (allowReadyWithGaps) => {
    const input = makeInput({ allowReadyWithGaps })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTEXT_BLOCKED,
      details: { field: 'allowReadyWithGaps' },
    })
    expect(input.loadPackContent).not.toHaveBeenCalled()
  })

  test('allows an explicitly opted-in READY_WITH_GAPS draft while preserving readiness evidence', async () => {
    const input = makeInput({
      contextStatus: 'READY_WITH_GAPS',
      contextAvailable: true,
      bindingStatus: 'READY_WITH_GAPS',
      handoffStatus: 'READY_WITH_GAPS',
      allowReadyWithGaps: true,
    })

    const result = await buildOutcomeStudioLiveComposition(input)

    expect(result.readiness).toEqual(expect.objectContaining({
      status: 'READY_WITH_GAPS',
      draftOnly: true,
      gapCount: 4,
    }))
    expect(result.compositionPackage.readiness).toEqual(result.readiness)
    expect(result.readinessSources).toEqual({
      knowledgeContext: 'READY_WITH_GAPS',
      reasoningBinding: 'READY_WITH_GAPS',
      frameworkHandoff: 'READY_WITH_GAPS',
    })
    expect(input.loadPackContent).toHaveBeenCalledTimes(4)
  })

  test('projects the active Markdown schema into required, optional, and prohibited guidance', async () => {
    const input = makeInput({
      schemaFormat: 'MARKDOWN',
      schemaContent: '# Executive Brief Schema\n\n## Required Sections\n1. Executive Summary\n2. Current Situation\n3. Strategic Problem\n4. Value Opportunity\n5. Supporting Evidence\n6. Key Risks and Gaps\n7. Recommended Focus\n8. Limitations\n9. Lineage Summary\n\n## Optional Sections\n- Truth Certification\n- Output Warnings\n\n## Output Controls\n- Do not present uncertain inference as certified fact.',
    })

    const result = await buildOutcomeStudioLiveComposition(input)

    expect(result.compositionPackage.outputBinding.requiredSections).toEqual([
      'executive summary',
      'current situation',
      'strategic problem',
      'value opportunity',
      'supporting evidence',
      'key risks and gaps',
      'recommended focus',
      'limitations',
      'lineage summary',
    ])
    expect(result.governanceConstraints.join(' ')).toMatch(/uncertain inference.*certified fact/i)
  })

  test('projects a Markdown schema whose required sections are direct headings', async () => {
    const input = makeInput({
      schemaFormat: 'MARKDOWN',
      schemaContent: '# Executive Brief Schema\n\n## Executive Summary\nDecision context.\n\n## Current Situation\nVerified situation.\n\n## Strategic Problem\nDecision problem.\n\n## Value Opportunity\nValue opportunity.\n\n## Supporting Evidence\nEvidence.\n\n## Key Risks and Gaps\nRisks.\n\n## Recommended Focus\nFocus.\n\n## Limitations\nLimitations.\n\n## Lineage Summary\nLineage.\n\n## Truth Certification\nOptional.\n\n## Output Warnings\nOptional.\n\n## Prohibited Claims\n- Do not present uncertain inference as certified fact.',
    })

    const result = await buildOutcomeStudioLiveComposition(input)

    expect(result.compositionPackage.outputBinding.requiredSections).toHaveLength(9)
    expect(result.governanceConstraints.join(' ')).toMatch(/uncertain inference.*certified fact/i)
  })

  test('keeps explicitly opted-in drafts blocked when a readiness blocker is present', async () => {
    const input = makeInput({
      contextStatus: 'READY_WITH_GAPS',
      contextAvailable: true,
      allowReadyWithGaps: true,
      contextBlockers: ['required truth missing'],
      buildComposition: jest.fn(),
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTEXT_BLOCKED,
    )
    expect(input.loadPackContent).not.toHaveBeenCalled()
  })

  test('requires the explicit ARL activation boundary', async () => {
    const input = makeInput({ arlBoundary: '' })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_BOUNDARY_MISSING,
    })
  })

  test('keeps equivalent direct-consumption identity deterministic', async () => {
    const first = await buildOutcomeStudioLiveComposition(makeInput())
    const second = await buildOutcomeStudioLiveComposition(makeInput())

    expect(second.generationContextConsumption).toEqual(first.generationContextConsumption)
    expect(second.generationContextConsumptionFingerprint)
      .toBe(first.generationContextConsumptionFingerprint)
  })

  test('uses only the canonical builder and handoff truth identities', async () => {
    const input = makeInput()
    input.frameworkState.evidence_pack.lineage.builder.version = ''
    input.frameworkState.evidence_pack.evidenceVersion = 'alias-evidence-version'
    input.frameworkState.sectionTruthVersion = 'alias-section-truth-version'

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.TRUTH_IDENTITY_MISSING,
    })
  })

  test.each([
    ['case', 'EXECUTIVE CONTEXT'],
    ['trimming', '  Executive context  '],
    ['repeated spaces', 'Executive   context'],
    ['tab', 'Executive\tcontext'],
    ['underscore', 'Executive_context'],
  ])('rejects Markdown structure duplicates after %s normalization', async (_dimension, duplicateValue) => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      outputTypeContent: contentByPack['executive-brief'].replace(
        '2. Material findings grounded in Certified Truth',
        `2. ${duplicateValue}`,
      ),
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    )
  })

  test('requires all Framework claim-boundary types', async () => {
    const input = makeInput()
    input.frameworkHandoff.claimBoundaries = input.frameworkHandoff.claimBoundaries.slice(0, 4)

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID,
    })
  })

  test('rejects malformed schema arrays', async () => {
    const input = makeInput({
      schemaContent: 'schemas:\n  executive-brief-schema:\n    required_sections: not-an-array',
    })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    })
  })

  test.each([
    ['packId', { packId: '' }],
    ['versionId', { versionId: '' }],
    ['packKey', { packKey: '' }],
    ['semanticVersion', { semanticVersion: '' }],
    ['contentHash', { contentHash: '' }],
    ['status', { status: '' }],
    ['status', { status: 'DRAFT' }],
  ])('rejects missing or inactive returned %s metadata', async (_field, override) => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      loadedOverridesByPack: { 'executive-brief': override },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test.each([
    ['packId', { packId: 'pack-other' }],
    ['versionId', { versionId: 'version-other' }],
    ['packKey', { packKey: 'other-pack' }],
    ['semanticVersion', { semanticVersion: '9.9.9' }],
    ['contentHash', { contentHash: 'hash-other' }],
  ])('rejects mismatched returned %s metadata', async (_field, override) => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      loadedOverridesByPack: { 'executive-brief': override },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects an unsupported persisted content format without composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      outputTypeFormat: '',
      loadedOverridesByPack: { 'executive-brief': { contentFormat: 'TOML' } },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_FORMAT_UNSUPPORTED,
    )
  })

  test('rejects a missing persisted content format without composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      outputTypeFormat: '',
      loadedOverridesByPack: { 'executive-brief': { contentFormat: '' } },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects a persisted content format that conflicts with an optional binding hint', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      loadedOverridesByPack: { 'executive-brief': { contentFormat: 'JSON' } },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects an inactive selected activation before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({ buildComposition })
    input.knowledgeContextResult.reasoningBinding.selectedByLayer.OUTPUT_TYPE[0].status = 'DRAFT'

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects a selected activation missing its activation ID before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({ buildComposition })
    input.knowledgeContextResult.reasoningBinding.selectedByLayer.OUTPUT_TYPE[0].activationId = ''

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects a selected activation missing from active lineage before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      bindingLineageOverrides: { activationIds: [] },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects a selected version missing from active lineage before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      bindingLineageOverrides: { versionIds: [] },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects a selected content hash missing from active lineage before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      bindingLineageOverrides: { contentHashes: [] },
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH,
    )
  })

  test('rejects missing schema prohibition governance before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      schemaContent: contentByPack['executive-brief-schema'].replace(
        '    prohibited:\n      - Unsupported certainty',
        '',
      ),
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    )
  })

  test('rejects malformed schema prohibition governance before composing', async () => {
    const buildComposition = jest.fn()
    const input = makeInput({
      buildComposition,
      schemaContent: contentByPack['executive-brief-schema'].replace(
        '    prohibited:\n      - Unsupported certainty',
        '    prohibited: unsupported',
      ),
    })

    await expectBlockedWithoutComposition(
      input,
      OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    )
  })

  test('requires selected-format RL export permission', async () => {
    const input = makeInput({
      requestedFormat: 'MARKDOWN',
      renderingContent: contentByPack['rendering-layer'].replace('allowed: true', 'allowed: false'),
    })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_GUIDANCE_INVALID,
    })
  })

  test('rejects missing RL guidance fields', async () => {
    const input = makeInput({
      renderingContent: 'pack:\n  key: rendering-layer\n  principle: Present a clear response.',
    })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    })
  })

  test('rejects non-string structured output entries', async () => {
    const input = makeInput({
      outputTypeFormat: 'YAML',
      outputTypeContent: `outputTypeStructure:
  - Executive context
  - { invalid: true }
  - Business implications
  - Recommended decisions
  - Immediate actions`,
    })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID,
    })
  })

  test('rejects an output type without governance rules', async () => {
    const input = makeInput({
      outputTypeContent: contentByPack['executive-brief'].split('## Governance Rules')[0],
    })

    await expect(buildOutcomeStudioLiveComposition(input)).rejects.toMatchObject({
      reason: OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID,
    })
  })
})
