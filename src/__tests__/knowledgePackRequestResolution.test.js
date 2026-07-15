import { describe, expect, test } from '@jest/globals'

import { resolveRequestSpecificKnowledgePacks } from '../services/knowledgePackRequestResolutionService.js'

const RESOLVED_AT = '2026-07-14T12:00:00.000Z'
const GLOBAL_SCOPE = [{ scopeType: 'GLOBAL', scopeKey: 'GLOBAL', precedence: 0 }]

const makePack = ({
  activationId,
  packType,
  packKey,
  knowledgeLayer,
  capabilityKey,
  semanticVersion = '1.0.0',
  scopeType = 'GLOBAL',
  scopeKey = 'GLOBAL',
  executionMode = 'PROVIDER_CONTEXT',
  workspaceCompatibility = ['OUTCOME'],
  dependencyReferences = [],
  activatedAt = '2026-07-14T10:00:00.000Z',
  status = 'ACTIVE',
  runtimeBindable = true,
  content = 'must never leak',
  sourceDocuments = [{ extractedText: 'must never leak' }],
} = {}) => ({
  activationId: activationId || `kpa-${packType.toLowerCase()}-${packKey}`,
  packId: `kp-${packType.toLowerCase()}-${packKey}`,
  versionId: `kpv-${packType.toLowerCase()}-${packKey}-${semanticVersion}-${scopeKey}`,
  packType,
  packKey,
  label: packKey,
  knowledgeLayer,
  capabilityKey,
  semanticVersion,
  schemaVersion: '1.0.0',
  scopeType,
  scopeKey,
  executionMode,
  workspaceCompatibility,
  dependencyReferences,
  activatedAt,
  status,
  runtimeBindable,
  contentHash: `sha256:${activationId || `${packType}-${packKey}-${semanticVersion}-${scopeKey}`}`,
  content,
  rawContent: content,
  sourceDocuments,
  sourceMetadata: { extractedText: 'must never leak' },
})

const mandatoryDefinitions = [
  ['ARL', 'adaptive-reasoning-layer', 'REASONING', 'adaptive-reasoning'],
  ['RL', 'rendering-layer', 'COMMUNICATION_PATTERN', 'rendering'],
  ['OUTPUT_SCHEMA', 'output-schemas-pack', 'OUTPUT_SCHEMA', 'mandatory-output-schema'],
  ['TRUTH_CERTIFICATION', 'truth-certification-pack', 'VALIDATION', 'truth-certification'],
  ['OUTPUT_TYPE_DEFINITION', 'outcome-output-types', 'OUTPUT_TYPE', 'outcome-output-types'],
]

const makeMandatorySafeguards = () => mandatoryDefinitions.map(([
  packType,
  packKey,
  knowledgeLayer,
  capabilityKey,
]) => makePack({
  packType,
  packKey,
  knowledgeLayer,
  capabilityKey,
  executionMode: packType === 'TRUTH_CERTIFICATION' ? 'PRE_VALIDATION' : 'PROVIDER_CONTEXT',
  workspaceCompatibility: [],
}))

const requiredDependency = (knowledgeLayer, capabilityKey) => ({
  knowledgeLayer,
  requirement: 'REQUIRED',
  capabilityKey,
})

const makeOutputCandidates = ({
  outputDependencies = [
    requiredDependency('OUTPUT_SCHEMA', 'board-summary-schema'),
    requiredDependency('STYLE', 'executive'),
  ],
  extra = [],
} = {}) => [
  makePack({
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'board-summary-output',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'board-summary',
    dependencyReferences: outputDependencies,
  }),
  makePack({
    packType: 'OUTPUT_SCHEMA',
    packKey: 'board-summary-schema',
    knowledgeLayer: 'OUTPUT_SCHEMA',
    capabilityKey: 'board-summary-schema',
  }),
  makePack({
    packType: 'STYLE',
    packKey: 'executive-style',
    knowledgeLayer: 'STYLE',
    capabilityKey: 'executive',
  }),
  ...extra,
]

const resolve = (overrides = {}) => resolveRequestSpecificKnowledgePacks({
  mandatorySafeguards: makeMandatorySafeguards(),
  candidates: makeOutputCandidates(),
  request: {
    workspaceType: 'OUTCOME_STUDIO',
    requestedOutputTypeKey: 'board-summary',
    resolvedAt: RESOLVED_AT,
  },
  scopeCandidates: GLOBAL_SCOPE,
  maxDepth: 10,
  ...overrides,
})

describe('resolveRequestSpecificKnowledgePacks', () => {
  test('resolves a unique request and emits only sanitized deterministic lineage', () => {
    const result = resolve()

    expect(result.status).toBe('READY')
    expect(result.policyVersion).toBe('kp-004-v1')
    expect(result.request).toEqual({
      workspaceType: 'OUTCOME',
      requestedOutputTypeKey: 'board-summary',
      requestedStyleKey: '',
      audienceKeys: [],
      industryKeys: [],
      languageKey: '',
      channelKey: '',
    })
    expect(result.mandatorySafeguards).toHaveLength(5)
    expect(result.selectedByLayer.OUTPUT_TYPE).toHaveLength(1)
    expect(result.selectedByLayer.OUTPUT_SCHEMA).toHaveLength(1)
    expect(result.selectedByLayer.STYLE).toHaveLength(1)
    expect(result.dependencyGraph).toEqual(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.arrayContaining([
        expect.objectContaining({ requirement: 'REQUIRED' }),
      ]),
      cycles: [],
      depthOverflows: [],
    }))
    expect(result.lineage.resolvedAt).toBe(RESOLVED_AT)
    expect(result.lineage.activationIds).toHaveLength(8)
    expect(resolve()).toEqual(result)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('must never leak')
    expect(serialized).not.toContain('rawContent')
    expect(serialized).not.toContain('sourceDocuments')
    expect(serialized).not.toContain('sourceMetadata')
  })

  test('returns READY_WITH_GAPS when an optional dependency is missing', () => {
    const candidates = makeOutputCandidates()
    candidates[0].dependencyReferences.push({
      knowledgeLayer: 'AUDIENCE',
      requirement: 'OPTIONAL',
      capabilityKey: 'board-directors',
    })

    const result = resolve({ candidates })

    expect(result.status).toBe('READY_WITH_GAPS')
    expect(result.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'DEPENDENCY_MISSING',
      requirement: 'OPTIONAL',
      selector: { knowledgeLayer: 'AUDIENCE', capabilityKey: 'board-directors' },
    }))
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'OPTIONAL_DEPENDENCY_MISSING',
    }))
  })

  test('returns BLOCKED when a required dependency or mandatory safeguard is missing', () => {
    const candidates = makeOutputCandidates().filter((pack) =>
      pack.knowledgeLayer !== 'OUTPUT_SCHEMA')
    const safeguards = makeMandatorySafeguards().filter((pack) => pack.packType !== 'RL')

    const result = resolve({ mandatorySafeguards: safeguards, candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.mandatorySafeguards).toContainEqual(expect.objectContaining({
      packType: 'RL',
      status: 'MISSING',
      runtimeBindable: false,
    }))
    expect(result.missingDependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'MANDATORY_SAFEGUARD_MISSING' }),
      expect.objectContaining({
        reason: 'DEPENDENCY_MISSING',
        requirement: 'REQUIRED',
        selector: expect.objectContaining({ knowledgeLayer: 'OUTPUT_SCHEMA' }),
      }),
    ]))
  })

  test('requires resulting output schema and style coverage for an output request', () => {
    const noSchema = resolve({
      candidates: makeOutputCandidates({
        outputDependencies: [requiredDependency('STYLE', 'executive')],
      }),
    })
    const noStyle = resolve({
      candidates: makeOutputCandidates({
        outputDependencies: [requiredDependency('OUTPUT_SCHEMA', 'board-summary-schema')],
      }),
    })

    expect(noSchema.status).toBe('BLOCKED')
    expect(noSchema.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'REQUIRED_LAYER_COVERAGE_MISSING',
      selector: { knowledgeLayer: 'OUTPUT_SCHEMA' },
    }))
    expect(noStyle.status).toBe('BLOCKED')
    expect(noStyle.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'REQUIRED_LAYER_COVERAGE_MISSING',
      selector: { knowledgeLayer: 'STYLE' },
    }))
  })

  test('returns AMBIGUOUS for candidates tied on scope, semantic version, and activation time', () => {
    const candidates = makeOutputCandidates()
    candidates.push(makePack({
      activationId: 'kpa-output-type-tied',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-summary-output-tied',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      dependencyReferences: candidates[0].dependencyReferences,
    }))

    const result = resolve({ candidates })

    expect(result.status).toBe('AMBIGUOUS')
    expect(result.ambiguousCandidates).toContainEqual(expect.objectContaining({
      selector: { knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'board-summary' },
      candidates: expect.arrayContaining([
        expect.objectContaining({ activationId: 'kpa-output-type-tied' }),
      ]),
    }))
    expect(result.selectedByLayer.OUTPUT_TYPE).toBeUndefined()
  })

  test('ranks by scope precedence, then semantic version, then activatedAt', () => {
    const base = makeOutputCandidates()
    const outputDependencies = base[0].dependencyReferences
    const globalV9 = makePack({
      activationId: 'kpa-output-global-v9',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-global-v9',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      semanticVersion: '9.0.0',
      dependencyReferences: outputDependencies,
    })
    const customerV1Old = makePack({
      activationId: 'kpa-output-customer-v1-old',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-customer-v1-old',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      semanticVersion: '1.0.0',
      scopeType: 'CUSTOMER',
      scopeKey: 'CUSTOMER:C1',
      activatedAt: '2026-07-14T08:00:00.000Z',
      dependencyReferences: outputDependencies,
    })
    const customerV2Old = makePack({
      activationId: 'kpa-output-customer-v2-old',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-customer-v2-old',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      semanticVersion: '2.0.0',
      scopeType: 'CUSTOMER',
      scopeKey: 'CUSTOMER:C1',
      activatedAt: '2026-07-14T08:00:00.000Z',
      dependencyReferences: outputDependencies,
    })
    const customerV2Latest = makePack({
      activationId: 'kpa-output-customer-v2-latest',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-customer-v2-latest',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      semanticVersion: '2.0.0',
      scopeType: 'CUSTOMER',
      scopeKey: 'CUSTOMER:C1',
      activatedAt: '2026-07-14T09:00:00.000Z',
      dependencyReferences: outputDependencies,
    })
    const candidates = [
      globalV9,
      customerV1Old,
      customerV2Old,
      customerV2Latest,
      ...base.slice(1),
    ]

    const result = resolve({
      candidates,
      scopeCandidates: [
        ...GLOBAL_SCOPE,
        { scopeType: 'CUSTOMER', scopeKey: 'CUSTOMER:C1', precedence: 5 },
      ],
    })

    expect(result.status).toBe('READY')
    expect(result.selectedByLayer.OUTPUT_TYPE[0].activationId)
      .toBe('kpa-output-customer-v2-latest')
    expect(result.excludedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'LOWER_RANKED' }),
    ]))
  })

  test('returns BLOCKED and records a dependency cycle', () => {
    const candidates = makeOutputCandidates()
    candidates[1].dependencyReferences = [
      requiredDependency('OUTPUT_TYPE', 'board-summary'),
    ]

    const result = resolve({ candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.dependencyGraph.cycles).toHaveLength(1)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'DEPENDENCY_CYCLE',
    }))
  })

  test('returns BLOCKED when dependency traversal exceeds maxDepth', () => {
    const candidates = makeOutputCandidates()

    const result = resolve({ candidates, maxDepth: 0 })

    expect(result.status).toBe('BLOCKED')
    expect(result.dependencyGraph.depthOverflows.length).toBeGreaterThan(0)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'DEPENDENCY_DEPTH_EXCEEDED',
      maxDepth: 0,
    }))
  })

  test('excludes a dynamic candidate without exact workspace compatibility', () => {
    const candidates = makeOutputCandidates()
    candidates[0].workspaceCompatibility = ['ADVISOR']

    const result = resolve({ candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.excludedCandidates).toContainEqual(expect.objectContaining({
      reason: 'WORKSPACE_INCOMPATIBLE',
      candidate: expect.objectContaining({ knowledgeLayer: 'OUTPUT_TYPE' }),
    }))
    expect(result.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'REQUESTED_CAPABILITY_MISSING',
    }))
  })

  test('accepts OUTCOME and OUTCOME_STUDIO as workspace aliases', () => {
    const candidates = makeOutputCandidates()
    candidates.forEach((candidate) => {
      candidate.workspaceCompatibility = ['OUTCOME_STUDIO']
    })

    const result = resolve({
      candidates,
      request: {
        workspaceType: 'OUTCOME',
        requestedOutputTypeKey: 'board-summary',
        resolvedAt: RESOLVED_AT,
      },
    })

    expect(result.status).toBe('READY')
  })

  test('separates provider, pre-validation, post-validation, and system-only packs', () => {
    const candidates = makeOutputCandidates()
    candidates[0].dependencyReferences.push(
      requiredDependency('VALIDATION', 'input-validator'),
      requiredDependency('VALIDATION', 'output-validator'),
      requiredDependency('FRAMEWORK', 'system-coordinator'),
    )
    candidates.push(
      makePack({
        packType: 'VE',
        packKey: 'input-validator',
        knowledgeLayer: 'VALIDATION',
        capabilityKey: 'input-validator',
        executionMode: 'PRE_VALIDATION',
      }),
      makePack({
        packType: 'CR',
        packKey: 'output-validator',
        knowledgeLayer: 'VALIDATION',
        capabilityKey: 'output-validator',
        executionMode: 'POST_VALIDATION',
      }),
      makePack({
        packType: 'SYSTEM',
        packKey: 'system-coordinator',
        knowledgeLayer: 'FRAMEWORK',
        capabilityKey: 'system-coordinator',
        executionMode: 'SYSTEM_ONLY',
      }),
    )

    const result = resolve({ candidates })

    expect(result.status).toBe('READY')
    expect(result.providerContextPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ knowledgeLayer: 'OUTPUT_TYPE' }),
      expect.objectContaining({ knowledgeLayer: 'OUTPUT_SCHEMA' }),
      expect.objectContaining({ knowledgeLayer: 'STYLE' }),
    ]))
    expect(result.preValidationPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityKey: 'input-validator' }),
      expect.objectContaining({ packType: 'TRUTH_CERTIFICATION' }),
    ]))
    expect(result.postValidationPacks).toContainEqual(expect.objectContaining({
      capabilityKey: 'output-validator',
    }))
    expect(result.systemOnlyPacks).toContainEqual(expect.objectContaining({
      capabilityKey: 'system-coordinator',
    }))
    expect(result.providerContextPacks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityKey: 'input-validator' }),
      expect.objectContaining({ capabilityKey: 'output-validator' }),
      expect.objectContaining({ capabilityKey: 'system-coordinator' }),
    ]))
  })
})
