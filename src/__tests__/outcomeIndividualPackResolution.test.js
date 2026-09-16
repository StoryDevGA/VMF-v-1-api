import { describe, expect, test } from '@jest/globals'

import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import {
  discoverRequestSpecificOutputTypes,
  resolveRequestSpecificKnowledgePacks,
} from '../services/knowledgePackRequestResolutionService.js'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'

const RESOLVED_AT = '2026-09-16T12:00:00.000Z'
const GLOBAL_SCOPE = [{ scopeType: 'GLOBAL', scopeKey: 'GLOBAL', precedence: 0 }]
const LEGACY_GROUPS = [
  ['RL', 'rendering-layer', 'COMMUNICATION_PATTERN'],
  ['OUTPUT_SCHEMA', 'output-schemas-pack', 'OUTPUT_SCHEMA'],
  ['OUTPUT_TYPE_DEFINITION', 'outcome-output-types', 'OUTPUT_TYPE'],
]

// Follow knowledgePackRequestResolution.test.js factories without importing a suite.
const makePack = ({
  packType,
  packKey,
  knowledgeLayer,
  capabilityKey = packKey,
  knowledgeAssetId = `QA-${packKey.toUpperCase()}`,
  dependencyReferences = [],
  status = 'ACTIVE',
  executionMode = 'PROVIDER_CONTEXT',
} = {}) => ({
  activationId: `kpa-${packType.toLowerCase()}-${packKey}`,
  packId: `kp-${packType.toLowerCase()}-${packKey}`,
  versionId: `kpv-${packType.toLowerCase()}-${packKey}-1.0.0-GLOBAL`,
  packType,
  packKey,
  label: packKey,
  knowledgeLayer,
  capabilityKey,
  knowledgeAssetId,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  executionMode,
  workspaceCompatibility: ['OUTCOME'],
  dependencyReferences,
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: buildKnowledgePackRelationshipChecksum(dependencyReferences),
  activatedAt: '2026-09-16T10:00:00.000Z',
  status,
  runtimeBindable: true,
  contentHash: `sha256:${packType}-${packKey}-1.0.0-GLOBAL`,
  content: 'must never leak',
  rawContent: 'must never leak',
  sourceDocuments: [{ extractedText: 'must never leak' }],
})

const makeMandatorySafeguards = () => [
  makePack({
    packType: 'ARL',
    packKey: 'adaptive-reasoning-layer',
    knowledgeLayer: 'REASONING',
  }),
  makePack({
    packType: 'TRUTH_CERTIFICATION',
    packKey: 'truth-certification-pack',
    knowledgeLayer: 'VALIDATION',
    executionMode: 'PRE_VALIDATION',
  }),
]

const compatibleSchemaRequirement = {
  relationshipType: 'REQUIRES_COMPATIBLE_PACK',
  targetPackType: 'OUTPUT_SCHEMA',
  requiredAt: 'RUNTIME',
  cardinality: 'ONE_OR_MORE',
}

const makeSchema = ({ packKey = 'board-summary-schema', knowledgeAssetId = 'OSC-025',
  compatibleOutputId = 'OT-023', status = 'ACTIVE' } = {}) => makePack({
  packType: 'OUTPUT_SCHEMA',
  packKey,
  knowledgeLayer: 'OUTPUT_SCHEMA',
  knowledgeAssetId,
  status,
  dependencyReferences: [{
    relationshipType: 'COMPATIBLE_WITH',
    targetKnowledgeAssetId: compatibleOutputId,
    requiredAt: 'NONE',
    cardinality: 'ZERO_OR_MORE',
  }],
})

const makeOutputCandidates = (additionalDependencies = []) => [
  makePack({
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'board-summary-output',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'board-summary',
    knowledgeAssetId: 'OT-023',
    dependencyReferences: [compatibleSchemaRequirement, ...additionalDependencies],
  }),
  makeSchema(),
]

const makeOptions = (overrides = {}) => ({
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
const resolve = (overrides) => resolveRequestSpecificKnowledgePacks(makeOptions(overrides))

describe('Outcome Studio individual Knowledge Pack resolution', () => {
  test('requires exactly ARL and Truth Certification as global safeguards', () => {
    expect(OUTCOME_STUDIO_REQUIRED_PACKS.map(({ packType, packKey }) => ({ packType, packKey })))
      .toEqual([
        { packType: 'ARL', packKey: 'adaptive-reasoning-layer' },
        { packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack' },
      ])
  })

  test('resolves an explicit individual structural relationship without legacy groups or optional Style', () => {
    const result = resolve()

    expect(result.status).toBe('READY')
    expect(result.mandatorySafeguards).toHaveLength(2)
    expect(result.selectedByLayer.OUTPUT_TYPE).toEqual([
      expect.objectContaining({ knowledgeAssetId: 'OT-023' }),
    ])
    expect(result.selectedByLayer.OUTPUT_SCHEMA).toEqual([
      expect.objectContaining({ knowledgeAssetId: 'OSC-025' }),
    ])
    expect(result.selectedByLayer.STYLE || []).toEqual([])
    expect(result.relationshipFailures).toEqual([])
    expect(result.missingDependencies).toEqual([])
    expect(result.dependencyGraph.edges).toContainEqual(expect.objectContaining({
      from: 'kpa-output_type_definition-board-summary-output',
      to: 'kpa-output_schema-board-summary-schema',
      relationshipType: 'REQUIRES_COMPATIBLE_PACK',
      cardinality: 'ONE_OR_MORE',
    }))
    expect(result.lineage.activationIds).toHaveLength(4)
    for (const [, packKey] of LEGACY_GROUPS) {
      expect(JSON.stringify(result)).not.toContain(packKey)
    }
    expect(JSON.stringify(result)).not.toContain('must never leak')
    expect(discoverRequestSpecificOutputTypes(makeOptions())).toEqual([
      expect.objectContaining({
        capabilityKey: 'board-summary',
        status: 'READY',
        outputSchema: expect.objectContaining({ knowledgeAssetId: 'OSC-025' }),
        style: null,
        missingDependencies: [],
      }),
    ])
  })

  test('blocks a missing individual Schema', () => {
    const result = resolve({ candidates: makeOutputCandidates().slice(0, 1) })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP', observedState: 'NO_TARGET_IDENTITY',
    }))
  })

  test('blocks an inactive individual Schema', () => {
    const result = resolve({ candidates: [makeOutputCandidates()[0], makeSchema({ status: 'INACTIVE' })] })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'INACTIVE_DEPENDENCY', observedState: 'NO_ACTIVE_VISIBLE_WORKSPACE_CANDIDATE',
    }))
  })

  test('blocks an incompatible Schema even when its name matches the Output Type', () => {
    const result = resolve({
      candidates: [makeOutputCandidates()[0], makeSchema({ compatibleOutputId: 'OT-999' })],
    })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP', observedState: 'RECIPROCAL_COMPATIBLE_WITH_MISSING',
    }))
  })

  test('blocks equally ranked active versions of the same compatible Schema identity', () => {
    const result = resolve({ candidates: [
      ...makeOutputCandidates(),
      makeSchema({ packKey: 'alternative-board-schema', knowledgeAssetId: 'OSC-025' }),
    ] })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'AMBIGUOUS_DEPENDENCY', requiredState: 'ONE_VERSION_PER_IDENTITY:OSC-025',
    }))
  })

  test('blocks an explicitly required Style when absent', () => {
    const result = resolve({ candidates: makeOutputCandidates([{
      relationshipType: 'REQUIRED_AT_RUNTIME',
      targetKnowledgeLayer: 'STYLE',
      targetCapabilityKey: 'executive',
      requiredAt: 'RUNTIME',
      cardinality: 'ONE',
    }]) })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP',
      observedState: 'NO_TARGET_IDENTITY',
      requiredState: { knowledgeLayer: 'STYLE', capabilityKey: 'executive' },
    }))
  })

  test.each(['ARL', 'TRUTH_CERTIFICATION'])('blocks when retained safeguard %s is absent', (packType) => {
    const safeguards = makeMandatorySafeguards()
    const missing = safeguards.find((pack) => pack.packType === packType)
    const result = resolve({ mandatorySafeguards: safeguards.filter((pack) => pack.packType !== packType) })

    expect(result.status).toBe('BLOCKED')
    expect(result.missingDependencies).toContainEqual(expect.objectContaining({
      reason: 'MANDATORY_SAFEGUARD_MISSING',
      requirement: 'REQUIRED',
      selector: { packType, packKey: missing.packKey },
    }))
  })

  test('does not discover the legacy Output Type aggregate even with valid Schema relationships', () => {
    const aggregate = makePack({
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'outcome-output-types',
      knowledgeLayer: 'OUTPUT_TYPE',
      dependencyReferences: [{
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetKnowledgeAssetId: 'OSC-025',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
      }],
    })
    const discovered = discoverRequestSpecificOutputTypes(makeOptions({
      candidates: [...makeOutputCandidates(), aggregate],
    }))

    expect(discovered.map((entry) => entry.capabilityKey)).toEqual(['board-summary'])
    expect(discovered[0].status).toBe('READY')
  })

  test.each(LEGACY_GROUPS)('still blocks an explicit missing dependency on legacy %s / %s', (packType, packKey) => {
    const result = resolve({ candidates: makeOutputCandidates([{
      relationshipType: 'REQUIRED_AT_RUNTIME',
      targetPackType: packType,
      targetPackKey: packKey,
      requiredAt: 'RUNTIME',
      cardinality: 'ONE',
    }]) })

    expect(result.status).toBe('BLOCKED')
    expect(result.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP',
      observedState: 'NO_TARGET_IDENTITY',
      requiredState: { packType, packKey },
    }))
  })
})
