import { describe, expect, test } from '@jest/globals'

import {
  discoverRequestSpecificOutputTypes,
  resolveRequestSpecificKnowledgePacks,
} from '../services/knowledgePackRequestResolutionService.js'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'

const RESOLVED_AT = '2026-07-14T12:00:00.000Z'
const GLOBAL_SCOPE = [{ scopeType: 'GLOBAL', scopeKey: 'GLOBAL', precedence: 0 }]

const makePack = ({
  activationId,
  packType,
  packKey,
  knowledgeLayer,
  capabilityKey,
  knowledgeAssetId,
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
  knowledgeAssetId: knowledgeAssetId || `QA-${String(packKey).replace(/[^a-z0-9]+/gi, '-').toUpperCase()}`,
  semanticVersion,
  schemaVersion: '1.0.0',
  scopeType,
  scopeKey,
  executionMode,
  workspaceCompatibility,
  dependencyReferences,
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: buildKnowledgePackRelationshipChecksum(dependencyReferences),
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
  relationshipType: 'REQUIRED_AT_RUNTIME',
  targetKnowledgeLayer: knowledgeLayer,
  targetCapabilityKey: capabilityKey,
  requiredAt: 'RUNTIME',
  cardinality: 'ONE',
})

const compatibleSchemaRequirement = (versionConstraint) => ({
  relationshipType: 'REQUIRES_COMPATIBLE_PACK',
  targetPackType: 'OUTPUT_SCHEMA',
  requiredAt: 'RUNTIME',
  cardinality: 'ONE_OR_MORE',
  ...(versionConstraint ? { versionConstraint } : {}),
})

const compatibleWith = (targetKnowledgeAssetId, versionConstraint) => ({
  relationshipType: 'COMPATIBLE_WITH',
  targetKnowledgeAssetId,
  requiredAt: 'NONE',
  cardinality: 'ZERO_OR_MORE',
  ...(versionConstraint ? { versionConstraint } : {}),
})

const setRelationships = (pack, dependencyReferences) => {
  pack.dependencyReferences = dependencyReferences
  pack.relationshipChecksum = buildKnowledgePackRelationshipChecksum(dependencyReferences)
  return pack
}

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
    expect(result.policyVersion).toBe('ss-002-v1')
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

  test('traverses governed mandatory dependencies without duplicating the mandatory root by layer', () => {
    const safeguards = makeMandatorySafeguards()
    const truthCertification = safeguards.find((pack) => pack.packType === 'TRUTH_CERTIFICATION')
    setRelationships(truthCertification, [requiredDependency('VALIDATION', 'truth-rule')])
    const truthRule = makePack({
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-rule',
      knowledgeLayer: 'VALIDATION',
      capabilityKey: 'truth-rule',
      executionMode: 'POST_VALIDATION',
    })

    const result = resolve({
      mandatorySafeguards: safeguards,
      candidates: [...makeOutputCandidates(), truthRule],
    })

    expect(result.status).toBe('READY')
    expect(result.selectedByLayer.VALIDATION).toEqual([
      expect.objectContaining({ knowledgeAssetId: truthRule.knowledgeAssetId }),
    ])
    expect(result.selectedByLayer.VALIDATION).not.toContainEqual(expect.objectContaining({
      activationId: truthCertification.activationId,
    }))
    expect(result.dependencyGraph.edges).toContainEqual(expect.objectContaining({
      from: truthCertification.activationId,
      to: truthRule.activationId,
      selector: { knowledgeAssetId: truthRule.knowledgeAssetId },
      requiredAt: 'RUNTIME',
      cardinality: 'ONE',
    }))
  })

  test('blocks when a selected mandatory safeguard lacks governed relationship metadata', () => {
    const safeguards = makeMandatorySafeguards()
    safeguards[0].knowledgeAssetId = ''

    const result = resolve({ mandatorySafeguards: safeguards })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_GOVERNANCE_METADATA',
      pack: expect.objectContaining({
        packType: 'ARL',
        packKey: 'adaptive-reasoning-layer',
      }),
      resolutionResult: 'BLOCKED',
    }))
  })

  test('returns READY_WITH_GAPS when an optional dependency is missing', () => {
    const candidates = makeOutputCandidates()
    setRelationships(candidates[0], [
      ...candidates[0].dependencyReferences,
      {
        relationshipType: 'OPTIONAL',
        targetKnowledgeLayer: 'AUDIENCE',
        targetCapabilityKey: 'board-directors',
        requiredAt: 'RUNTIME',
        cardinality: 'ZERO_OR_ONE',
      },
    ])

    const result = resolve({ candidates })

    expect(result.status).toBe('READY_WITH_GAPS')
    expect(result.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'MISSING_RELATIONSHIP',
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
    ]))
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP',
      relationship: expect.objectContaining({ targetKnowledgeLayer: 'OUTPUT_SCHEMA' }),
    }))
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
    setRelationships(candidates[1], [
      requiredDependency('OUTPUT_TYPE', 'board-summary'),
    ])

    const result = resolve({ candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.dependencyGraph.cycles).toHaveLength(1)
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'CIRCULAR_DEPENDENCY',
    }))
  })

  test('detects a cycle by governed identity across scope and version activations', () => {
    const root = makePack({
      activationId: 'kpa-ot-customer-2-0-0',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-summary-customer',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      knowledgeAssetId: 'OT-001',
      semanticVersion: '2.0.0',
      scopeType: 'CUSTOMER',
      scopeKey: 'CUSTOMER:QA',
      dependencyReferences: [
        requiredDependency('OUTPUT_SCHEMA', 'board-summary-schema'),
        requiredDependency('STYLE', 'executive'),
      ],
    })
    const globalVersion = makePack({
      activationId: 'kpa-ot-global-1-0-0',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'board-summary-global',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'board-summary',
      knowledgeAssetId: 'OT-001',
      semanticVersion: '1.0.0',
    })
    const schema = makePack({
      activationId: 'kpa-schema-global-1-0-0',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-summary-schema',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-summary-schema',
      knowledgeAssetId: 'OSC-001',
      dependencyReferences: [{
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetKnowledgeAssetId: 'OT-001',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
        versionConstraint: { exactVersion: '1.0.0' },
      }],
    })
    const style = makePack({
      packType: 'STYLE',
      packKey: 'executive-style',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive',
    })

    const result = resolve({
      candidates: [root, globalVersion, schema, style],
      scopeCandidates: [
        { scopeType: 'CUSTOMER', scopeKey: 'CUSTOMER:QA', precedence: 10 },
        ...GLOBAL_SCOPE,
      ],
    })

    expect(result.status).toBe('BLOCKED')
    expect(result.dependencyGraph.cycles).toContainEqual(expect.objectContaining({
      identities: ['OT-001', 'OSC-001', 'OT-001'],
      path: ['kpa-ot-customer-2-0-0', 'kpa-schema-global-1-0-0', 'kpa-ot-global-1-0-0'],
    }))
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'CIRCULAR_DEPENDENCY',
    }))
  })

  test('returns BLOCKED when dependency traversal exceeds maxDepth', () => {
    const candidates = makeOutputCandidates()

    const result = resolve({ candidates, maxDepth: 0 })

    expect(result.status).toBe('BLOCKED')
    expect(result.dependencyGraph.depthOverflows.length).toBeGreaterThan(0)
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'DEPENDENCY_DEPTH_EXCEEDED',
      observedState: expect.objectContaining({ maxDepth: 0 }),
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
    setRelationships(candidates[0], [
      ...candidates[0].dependencyReferences,
      requiredDependency('VALIDATION', 'input-validator'),
      requiredDependency('VALIDATION', 'output-validator'),
      requiredDependency('FRAMEWORK', 'system-coordinator'),
    ])
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

  test('returns every distinct reciprocal schema identity for ONE_OR_MORE', () => {
    const candidates = makeOutputCandidates()
    const outputType = candidates[0]
    outputType.knowledgeAssetId = 'OT-002'
    setRelationships(outputType, [
      compatibleSchemaRequirement(),
      requiredDependency('STYLE', 'executive'),
    ])
    candidates.splice(1, 1,
      makePack({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'board-schema-primary',
        knowledgeLayer: 'OUTPUT_SCHEMA',
        capabilityKey: 'board-schema-primary',
        knowledgeAssetId: 'OSC-002',
        dependencyReferences: [compatibleWith('OT-002')],
      }),
      makePack({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'board-schema-secondary',
        knowledgeLayer: 'OUTPUT_SCHEMA',
        capabilityKey: 'board-schema-secondary',
        knowledgeAssetId: 'OSC-102',
        dependencyReferences: [compatibleWith('OT-002')],
      }),
    )

    const result = resolve({ candidates })

    expect(result.status).toBe('READY')
    expect(result.selectedByLayer.OUTPUT_SCHEMA.map((pack) => pack.knowledgeAssetId))
      .toEqual(['OSC-002', 'OSC-102'])
    expect(result.dependencyGraph.edges.filter((edge) => (
      edge.relationshipType === 'REQUIRES_COMPATIBLE_PACK'
    ))).toHaveLength(2)
  })

  test('fails closed when compatible candidates lack reciprocity or the required version', () => {
    const candidates = makeOutputCandidates()
    const outputType = candidates[0]
    outputType.knowledgeAssetId = 'OT-002'
    setRelationships(outputType, [
      compatibleSchemaRequirement({ minimumVersionInclusive: '2.0.0' }),
      requiredDependency('STYLE', 'executive'),
    ])
    candidates[1] = makePack({
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-schema-primary',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-schema-primary',
      knowledgeAssetId: 'OSC-002',
      semanticVersion: '1.5.0',
      dependencyReferences: [compatibleWith('OT-003')],
    })

    const incompatible = resolve({ candidates })
    expect(incompatible.status).toBe('BLOCKED')
    expect(incompatible.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'INCOMPATIBLE_VERSION',
    }))

    candidates[1] = makePack({
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-schema-primary',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-schema-primary',
      knowledgeAssetId: 'OSC-002',
      semanticVersion: '2.0.0',
      dependencyReferences: [compatibleWith('OT-003')],
    })
    const nonReciprocal = resolve({ candidates })
    expect(nonReciprocal.status).toBe('BLOCKED')
    expect(nonReciprocal.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP',
      observedState: 'RECIPROCAL_COMPATIBLE_WITH_MISSING',
    }))
  })

  test('reports invalid compatible candidate governance before reciprocity', () => {
    const candidates = makeOutputCandidates()
    const outputType = candidates[0]
    outputType.knowledgeAssetId = 'OT-002'
    setRelationships(outputType, [
      compatibleSchemaRequirement(),
      requiredDependency('STYLE', 'executive'),
    ])
    candidates[1] = makePack({
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-schema-invalid',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-schema-invalid',
      knowledgeAssetId: 'invalid identity',
      dependencyReferences: [],
    })

    const result = resolve({ candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_GOVERNANCE_METADATA',
      observedState: expect.stringContaining('knowledgeAssetId'),
    }))
    expect(result.relationshipFailures).not.toContainEqual(expect.objectContaining({
      observedState: 'RECIPROCAL_COMPATIBLE_WITH_MISSING',
    }))
  })

  test.each([
    ['missing identity', (pack) => { delete pack.knowledgeAssetId }],
    ['missing contract version', (pack) => { delete pack.relationshipContractVersion }],
    ['empty-array checksum mismatch', (pack) => { pack.relationshipChecksum = '' }],
  ])('rejects selected active candidates with %s', (_label, mutate) => {
    const candidates = makeOutputCandidates()
    mutate(candidates[2])

    const result = resolve({ candidates })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_GOVERNANCE_METADATA',
    }))
  })

  test('traverses the exact reciprocal version that satisfied the relationship', () => {
    const candidates = makeOutputCandidates()
    const outputType = candidates[0]
    outputType.knowledgeAssetId = 'OT-002'
    setRelationships(outputType, [
      compatibleSchemaRequirement({ maximumVersionExclusive: '2.0.0' }),
      requiredDependency('STYLE', 'executive'),
    ])
    candidates[1] = makePack({
      activationId: 'kpa-board-schema-1-5-0',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-schema-1-5-0',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-schema',
      knowledgeAssetId: 'OSC-002',
      semanticVersion: '1.5.0',
      dependencyReferences: [compatibleWith('OT-002')],
    })
    candidates.push(makePack({
      activationId: 'kpa-board-schema-2-0-0',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board-schema-2-0-0',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'board-schema',
      knowledgeAssetId: 'OSC-002',
      semanticVersion: '2.0.0',
      dependencyReferences: [compatibleWith('OT-003')],
      activatedAt: '2026-07-14T11:00:00.000Z',
    }))

    const result = resolve({ candidates })

    expect(result.status).toBe('READY')
    expect(result.selectedByLayer.OUTPUT_SCHEMA).toEqual([
      expect.objectContaining({
        activationId: 'kpa-board-schema-1-5-0',
        semanticVersion: '1.5.0',
        knowledgeAssetId: 'OSC-002',
      }),
    ])
  })

  test('traverses the exact generic dependency version that satisfied its constraint', () => {
    const candidates = makeOutputCandidates()
    setRelationships(candidates[0], [
      requiredDependency('OUTPUT_SCHEMA', 'board-summary-schema'),
      {
        ...requiredDependency('STYLE', 'executive'),
        versionConstraint: { maximumVersionExclusive: '2.0.0' },
      },
    ])
    candidates[2] = makePack({
      activationId: 'kpa-executive-style-1-5-0',
      packType: 'STYLE',
      packKey: 'executive-style-1-5-0',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive',
      knowledgeAssetId: 'STY-002',
      semanticVersion: '1.5.0',
    })
    candidates.push(makePack({
      activationId: 'kpa-executive-style-2-0-0',
      packType: 'STYLE',
      packKey: 'executive-style-2-0-0',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive',
      knowledgeAssetId: 'STY-002',
      semanticVersion: '2.0.0',
      activatedAt: '2026-07-14T11:00:00.000Z',
    }))

    const result = resolve({ candidates })

    expect(result.status).toBe('READY')
    expect(result.selectedByLayer.STYLE).toEqual([
      expect.objectContaining({
        activationId: 'kpa-executive-style-1-5-0',
        semanticVersion: '1.5.0',
        knowledgeAssetId: 'STY-002',
      }),
    ])
  })
})

describe('discoverRequestSpecificOutputTypes', () => {
  test('discovers a newly activated valid Output Type without an application enumeration', () => {
    const candidates = makeOutputCandidates({
      extra: [
        makePack({
          packType: 'OUTPUT_TYPE_DEFINITION',
          packKey: 'strategic-option-review-output',
          knowledgeLayer: 'OUTPUT_TYPE',
          capabilityKey: 'strategic-option-review',
          dependencyReferences: [
            requiredDependency('OUTPUT_SCHEMA', 'strategic-option-review-schema'),
            requiredDependency('STYLE', 'strategy-review-style'),
          ],
        }),
        makePack({
          packType: 'OUTPUT_SCHEMA',
          packKey: 'strategic-option-review-schema',
          knowledgeLayer: 'OUTPUT_SCHEMA',
          capabilityKey: 'strategic-option-review-schema',
        }),
        makePack({
          packType: 'STYLE',
          packKey: 'strategy-review-style',
          knowledgeLayer: 'STYLE',
          capabilityKey: 'strategy-review-style',
        }),
      ],
    })

    const discovered = discoverRequestSpecificOutputTypes({
      mandatorySafeguards: makeMandatorySafeguards(),
      candidates,
      request: {
        workspaceType: 'OUTCOME',
        resolvedAt: RESOLVED_AT,
      },
      scopeCandidates: GLOBAL_SCOPE,
    })

    expect(discovered.map((entry) => entry.capabilityKey)).toEqual([
      'board-summary',
      'strategic-option-review',
    ])
    expect(discovered).toContainEqual(expect.objectContaining({
      capabilityKey: 'strategic-option-review',
      status: 'READY',
      outputType: expect.objectContaining({ capabilityKey: 'strategic-option-review' }),
      outputSchema: expect.objectContaining({ capabilityKey: 'strategic-option-review-schema' }),
      style: expect.objectContaining({ capabilityKey: 'strategy-review-style' }),
    }))
    expect(JSON.stringify(discovered)).not.toContain('must never leak')
  })

  test('retains blocked discovery evidence when required deliverable guidance is missing', () => {
    const candidates = makeOutputCandidates()
      .filter((candidate) => candidate.knowledgeLayer !== 'STYLE')

    const discovered = discoverRequestSpecificOutputTypes({
      mandatorySafeguards: makeMandatorySafeguards(),
      candidates,
      request: {
        workspaceType: 'OUTCOME',
        resolvedAt: RESOLVED_AT,
      },
      scopeCandidates: GLOBAL_SCOPE,
    })

    expect(discovered).toHaveLength(1)
    expect(discovered[0]).toEqual(expect.objectContaining({
      capabilityKey: 'board-summary',
      status: 'BLOCKED',
      style: null,
    }))
    expect(discovered[0].missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'REQUIRED_LAYER_COVERAGE_MISSING',
      selector: expect.objectContaining({ knowledgeLayer: 'STYLE' }),
    }))
  })
})
