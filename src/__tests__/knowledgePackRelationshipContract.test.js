import { describe, expect, test } from '@jest/globals'

import {
  assertCanonicalRelationshipSourcesEqual,
  buildKnowledgePackRelationshipChecksum,
  evaluateRelationshipCardinality,
  normalizeKnowledgeAssetId,
  normalizeKnowledgePackRelationship,
  normalizeKnowledgePackRelationships,
  parseKnowledgePackFrontMatter,
  semanticVersionSatisfies,
} from '../services/knowledgePackRelationshipContract.js'

const outputSchemaRequirement = (overrides = {}) => ({
  relationshipType: 'REQUIRES_COMPATIBLE_PACK',
  targetPackType: 'OUTPUT_SCHEMA',
  requiredAt: 'RUNTIME',
  cardinality: 'ONE_OR_MORE',
  ...overrides,
})

const styleReference = (overrides = {}) => ({
  relationshipType: 'REFERENCES',
  targetPackType: 'STYLE',
  targetPackKey: 'board-executive',
  requiredAt: 'NONE',
  cardinality: 'ZERO_OR_MORE',
  ...overrides,
})

describe('SS-002 Knowledge Pack relationship contract', () => {
  test('normalizes governed identities and rejects unsafe identities', () => {
    expect(normalizeKnowledgeAssetId(' ot-002 ')).toBe('OT-002')
    expect(() => normalizeKnowledgeAssetId('Board Paper', { required: true }))
      .toThrow('governed uppercase hyphenated identity')
  })

  test.each([
    ['REQUIRED_AT_ACTIVATION', 'ACTIVATION', 'ONE', { targetPackType: 'STYLE', targetPackKey: 'board' }],
    ['REQUIRED_AT_RUNTIME', 'RUNTIME', 'ONE_OR_MORE', { targetCapabilityKey: 'truth-certification' }],
    ['OPTIONAL', 'RUNTIME', 'ZERO_OR_ONE', { targetKnowledgeAssetId: 'AUD-001' }],
    ['COMPATIBLE_WITH', 'NONE', 'ZERO_OR_MORE', { targetKnowledgeAssetId: 'OT-002' }],
    ['SUPERSEDES', 'NONE', 'ZERO_OR_MORE', { targetKnowledgeAssetId: 'OSC-001' }],
    ['REFERENCES', 'NONE', 'ZERO_OR_MORE', { targetPackType: 'STYLE', targetPackKey: 'board' }],
    ['REQUIRES_COMPATIBLE_PACK', 'RUNTIME', 'ONE_OR_MORE', { targetPackType: 'OUTPUT_SCHEMA' }],
  ])('accepts %s invariant', (relationshipType, requiredAt, cardinality, selector) => {
    expect(normalizeKnowledgePackRelationship({
      relationshipType,
      requiredAt,
      cardinality,
      ...selector,
    })).toMatchObject({ relationshipType, requiredAt, cardinality })
  })

  test('rejects legacy and invalid timing/cardinality/selector shapes', () => {
    expect(() => normalizeKnowledgePackRelationship({
      knowledgeLayer: 'STYLE',
      requirement: 'REQUIRED',
      packType: 'STYLE',
      packKey: 'board',
    })).toThrow('guarded SS-002 migration')
    expect(() => normalizeKnowledgePackRelationship(outputSchemaRequirement({
      requiredAt: 'ACTIVATION',
    }))).toThrow('timing')
    expect(() => normalizeKnowledgePackRelationship(outputSchemaRequirement({
      cardinality: 'ONE',
    }))).toThrow('cardinality')
    expect(() => normalizeKnowledgePackRelationship(outputSchemaRequirement({
      targetKnowledgeAssetId: 'OSC-002',
    }))).toThrow('forbids an exact target')
  })

  test('canonicalizes order, rejects duplicates and builds stable checksums', () => {
    const left = [
      outputSchemaRequirement(),
      {
        relationshipType: 'REFERENCES',
        targetKnowledgeAssetId: 'POL-001',
        requiredAt: 'NONE',
        cardinality: 'ZERO_OR_MORE',
      },
    ]
    const right = [...left].reverse()
    expect(normalizeKnowledgePackRelationships(left))
      .toEqual(normalizeKnowledgePackRelationships(right))
    expect(buildKnowledgePackRelationshipChecksum(left))
      .toBe(buildKnowledgePackRelationshipChecksum(right))
    expect(() => normalizeKnowledgePackRelationships([left[0], left[0]]))
      .toThrow('Duplicate canonical relationship')
  })

  test.each([
    ['ONE', 0, false], ['ONE', 1, true], ['ONE', 2, false],
    ['ZERO_OR_ONE', 0, true], ['ZERO_OR_ONE', 1, true], ['ZERO_OR_ONE', 2, false],
    ['ONE_OR_MORE', 0, false], ['ONE_OR_MORE', 1, true], ['ONE_OR_MORE', 3, true],
    ['ZERO_OR_MORE', 0, true], ['ZERO_OR_MORE', 1, true], ['ZERO_OR_MORE', 3, true],
  ])('evaluates %s with %i candidates', (cardinality, count, success) => {
    expect(evaluateRelationshipCardinality(cardinality, count).success).toBe(success)
  })

  test('evaluates exact and ranged SemVer including prereleases', () => {
    expect(semanticVersionSatisfies('2.0.0', { exactVersion: '2.0.0' })).toBe(true)
    expect(semanticVersionSatisfies('2.0.0-beta.1', {
      minimumVersionInclusive: '2.0.0-beta.1',
      maximumVersionExclusive: '2.0.0',
    })).toBe(true)
    expect(semanticVersionSatisfies('2.0.0', {
      minimumVersionInclusive: '1.0.0',
      maximumVersionExclusive: '2.0.0',
    })).toBe(false)
  })

  test('parses canonical Output Type front matter without a permanent schema identity', () => {
    const parsed = parseKnowledgePackFrontMatter(`---
relationshipContractVersion: SS002_RELATIONSHIP_V1
knowledge_asset_id: OT-002
dependencyReferences:
  - relationshipType: REQUIRES_COMPATIBLE_PACK
    targetPackType: OUTPUT_SCHEMA
    requiredAt: RUNTIME
    cardinality: ONE_OR_MORE
---
# Board Paper
` , { packType: 'OUTPUT_TYPE' })
    expect(parsed).toMatchObject({
      knowledgeAssetId: 'OT-002',
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      dependencyReferences: [outputSchemaRequirement()],
    })
  })

  test('normalizes Output Schema compatibility metadata into reciprocal declarations', () => {
    const parsed = parseKnowledgePackFrontMatter(`---
knowledge_asset_id: OSC-002
compatible_output_types:
  - knowledge_asset_id: OT-002
---
# Board Paper Schema
`, { packType: 'OUTPUT_SCHEMA' })
    expect(parsed.dependencyReferences).toEqual([{
      relationshipType: 'COMPATIBLE_WITH',
      targetKnowledgeAssetId: 'OT-002',
      requiredAt: 'NONE',
      cardinality: 'ZERO_OR_MORE',
    }])
  })

  test('allows front matter without knowledgeAssetId when the registry owns governance completeness', () => {
    const parsed = parseKnowledgePackFrontMatter(`---
relationshipContractVersion: SS002_RELATIONSHIP_V1
dependencyReferences:
  - relationshipType: REQUIRES_COMPATIBLE_PACK
    targetPackType: OUTPUT_SCHEMA
    requiredAt: RUNTIME
    cardinality: ONE_OR_MORE
---
# Board Paper
`, { packType: 'OUTPUT_TYPE' })
    expect(parsed).toMatchObject({
      knowledgeAssetId: '',
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      dependencyReferences: [outputSchemaRequirement()],
    })
  })

  test.each([
    ['anchor', 'knowledge_asset_id: &id OT-002\ncopy: *id'],
    ['tag', 'knowledge_asset_id: !foo OT-002'],
    ['merge', 'knowledge_asset_id: OT-002\nbase: &base { a: 1 }\ncopy: { <<: *base }'],
    ['duplicate', 'knowledge_asset_id: OT-002\nknowledge_asset_id: OT-003'],
    ['unsafe key', 'knowledge_asset_id: OT-002\n__proto__: polluted'],
  ])('rejects unsafe YAML %s', (_name, yaml) => {
    expect(() => parseKnowledgePackFrontMatter(`---\n${yaml}\n---\n# Body`, {
      packType: 'OUTPUT_TYPE',
    })).toThrow()
  })

  test('rejects malformed and multiple front-matter envelopes', () => {
    expect(() => parseKnowledgePackFrontMatter('knowledge_asset_id: OT-002'))
      .toThrow('must start')
    expect(() => parseKnowledgePackFrontMatter(
      '\n---\nknowledge_asset_id: OT-002\n---\n# Body',
    )).toThrow('must start')
    expect(() => parseKnowledgePackFrontMatter(
      '---\nknowledge_asset_id: OT-002\n---\n---\nknowledge_asset_id: OT-003\n---',
    )).toThrow('Multiple YAML documents')
  })

  test('accepts an optional BOM and CRLF delimiters at the exact start', () => {
    expect(parseKnowledgePackFrontMatter(
      '\uFEFF---\r\nknowledge_asset_id: OT-002\r\n---\r\n# Body',
      { packType: 'OUTPUT_TYPE' },
    )).toMatchObject({ knowledgeAssetId: 'OT-002' })
  })

  test('requires canonical equality when request and source both govern relationships', () => {
    const source = {
      knowledgeAssetId: 'OT-002',
      dependencyReferences: [outputSchemaRequirement(), styleReference()],
    }
    expect(assertCanonicalRelationshipSourcesEqual({
      request: { ...source, dependencyReferences: [...source.dependencyReferences].reverse() },
      source,
    })).toMatchObject({ knowledgeAssetId: 'OT-002' })
    expect(() => assertCanonicalRelationshipSourcesEqual({
      request: { knowledgeAssetId: 'OT-003' },
      source,
    })).toThrow('conflict')
    expect(() => assertCanonicalRelationshipSourcesEqual({
      request: {
        knowledgeAssetId: 'OT-002',
        dependencyReferences: [outputSchemaRequirement(), styleReference({
          targetPackKey: 'board-executive-v2',
        })],
      },
      source,
    })).toThrow('conflict')
  })

  test('accepts legacy compatible output type metadata as non-executable compatibility without SS-002 opt-in', () => {
    const result = parseKnowledgePackFrontMatter(`---
knowledge_asset_id: OSC-001
compatible_output_types:
  - OT-001
---
# Output schema`, { packType: 'OUTPUT_SCHEMA' })

    expect(result.relationshipContractVersion).toBe('SS002_RELATIONSHIP_V1')
    expect(result.dependencyReferences).toEqual([expect.objectContaining({
      relationshipType: 'COMPATIBLE_WITH',
      targetKnowledgeAssetId: 'OT-001',
      requiredAt: 'NONE',
      cardinality: 'ZERO_OR_MORE',
    })])
  })
})
