import {
  assertV1AssetWriteEnvironment,
  buildImportBody,
  buildV1AssetCatalogueDigest,
  planV1Asset,
  V1_KNOWLEDGE_ASSET_DEFINITIONS,
} from '../scripts/authorKnowledgePackV1Assets.js'
import { normalizeKnowledgePackRelationships } from '../services/knowledgePackRelationshipContract.js'

const asset = Object.freeze({
  packType: 'OUTPUT_TYPE_DEFINITION',
  packKey: 'executive-brief',
  packId: 'kp-output-type-definition-executive-brief',
  versionId: 'kpv-output-type-definition-executive-brief-1-0-0-global',
  knowledgeLayer: 'OUTPUT_TYPE',
  capabilityKey: 'executive-brief',
  expectedContentHash: 'sha256:source',
  dependencyReferences: [
    {
      relationshipType: 'REQUIRES_COMPATIBLE_PACK',
      targetPackType: 'OUTPUT_SCHEMA',
      requiredAt: 'RUNTIME',
      cardinality: 'ONE_OR_MORE',
    },
  ],
})

const governedRow = (overrides = {}) => ({
  knowledgeLayer: asset.knowledgeLayer,
  capabilityKey: asset.capabilityKey,
  workspaceCompatibility: ['OUTCOME'],
  dependencyReferences: asset.dependencyReferences,
  ...overrides,
})

describe('KP-004 V1 Knowledge Asset authoring guard', () => {
  test('plans the ordered governed lifecycle and recognizes completed readback', () => {
    expect(planV1Asset({ asset, state: { pack: null, version: null, activations: [] } }))
      .toEqual({ action: 'IMPORT' })
    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({ status: 'DRAFT', contentHash: asset.expectedContentHash }),
        activations: [],
      },
    })).toEqual({ action: 'VALIDATE' })
    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({
          status: 'VALIDATED',
          reviewStatus: 'APPROVED',
          contentHash: asset.expectedContentHash,
        }),
        activations: [],
      },
    })).toEqual({ action: 'ACTIVATE' })
    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({ status: 'ACTIVE', contentHash: asset.expectedContentHash }),
        activations: [governedRow({ status: 'ACTIVE' })],
      },
    })).toEqual({ complete: true })
  })

  test('recognizes canonical relationship equality independent of object key order', () => {
    const semanticallySameRelationships = [
      {
        cardinality: 'ONE_OR_MORE',
        requiredAt: 'RUNTIME',
        targetPackType: 'OUTPUT_SCHEMA',
        relationshipType: 'REQUIRES_COMPATIBLE_PACK',
      },
    ]

    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({
          status: 'ACTIVE',
          contentHash: asset.expectedContentHash,
          dependencyReferences: semanticallySameRelationships,
        }),
        activations: [governedRow({
          status: 'ACTIVE',
          dependencyReferences: semanticallySameRelationships,
        })],
      },
    })).toEqual({ complete: true })
  })

  test('fails closed on source drift and plans governed metadata update for metadata drift', () => {
    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({ status: 'DRAFT', contentHash: 'sha256:different' }),
        activations: [],
      },
    })).toEqual({ blocker: 'SOURCE_CONTENT_DRIFT' })
    expect(planV1Asset({
      asset,
      state: {
        pack: governedRow({ capabilityKey: 'wrong' }),
        version: governedRow({ status: 'DRAFT', contentHash: asset.expectedContentHash }),
        activations: [],
      },
    })).toEqual({ action: 'UPDATE_GOVERNANCE_METADATA' })
  })

  test('fails closed on non-development databases', () => {
    expect(() => assertV1AssetWriteEnvironment({ databaseName: 'production', nodeEnv: 'production' }))
      .toThrow('Refusing V1 Knowledge Asset authoring')
  })

  test('catalogue digest changes when approved source content changes', () => {
    const first = buildV1AssetCatalogueDigest([{ ...asset, extractedText: 'one', sourcePath: 'ignored' }])
    const second = buildV1AssetCatalogueDigest([{ ...asset, extractedText: 'two', sourcePath: 'ignored' }])
    expect(first).not.toBe(second)
  })

  test('catalogue includes the generic commercial strategy decision-paper triplet', () => {
    const byPackKey = new Map(V1_KNOWLEDGE_ASSET_DEFINITIONS.map((definition) => [
      definition.packKey,
      definition,
    ]))

    expect(byPackKey.get('commercial-strategy-decision-paper')).toMatchObject({
      packType: 'OUTPUT_TYPE_DEFINITION',
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'commercial-strategy-decision-paper',
      knowledgeAssetId: 'QA-SS007-OUTPUT-TYPE-COMMERCIAL-STRATEGY-DECISION-PAPER',
      filename: 'commercial-strategy-decision-paper.md',
    })
    expect(byPackKey.get('commercial-strategy-decision-paper-schema')).toMatchObject({
      packType: 'OUTPUT_SCHEMA',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'commercial-strategy-decision-paper-schema',
      knowledgeAssetId: 'QA-SS007-OUTPUT-SCHEMA-COMMERCIAL-STRATEGY-DECISION-PAPER',
      filename: 'commercial-strategy-decision-paper-schema.md',
    })
    expect(byPackKey.get('commercial-strategy-decision-paper-style')).toMatchObject({
      packType: 'STYLE',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'commercial-strategy-decision-paper-style',
      knowledgeAssetId: 'QA-SS007-STYLE-COMMERCIAL-STRATEGY-DECISION-PAPER',
      filename: 'commercial-strategy-decision-paper-style.md',
    })
    expect(byPackKey.get('commercial-strategy-decision-paper').dependencyReferences).toEqual(expect.arrayContaining([
      {
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetPackType: 'OUTPUT_SCHEMA',
        targetPackKey: 'commercial-strategy-decision-paper-schema',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
      },
      {
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetKnowledgeLayer: 'STYLE',
        targetCapabilityKey: 'commercial-strategy-decision-paper-style',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
      },
      {
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetPackType: 'SYSTEM_REFERENCE',
        targetPackKey: 'cacr-runtime-pack',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
        versionConstraint: { exactVersion: '1.0.0' },
      },
      {
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetPackType: 'ARL',
        targetPackKey: 'adaptive-reasoning-layer',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
        versionConstraint: { exactVersion: '1.0.0' },
      },
      {
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetPackType: 'RL',
        targetPackKey: 'rendering-layer',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
        versionConstraint: { exactVersion: '1.0.0' },
      },
    ]))
    expect(byPackKey.get('commercial-strategy-decision-paper').dependencyReferences).toHaveLength(22)
  })

  test('CSDP import body sends governed knowledge asset identity', () => {
    const definition = V1_KNOWLEDGE_ASSET_DEFINITIONS.find((entry) => (
      entry.packKey === 'commercial-strategy-decision-paper'
    ))
    const body = buildImportBody({
      ...definition,
      extractedText: 'source text',
    })

    expect(body.knowledgeAssetId).toBe('QA-SS007-OUTPUT-TYPE-COMMERCIAL-STRATEGY-DECISION-PAPER')
    expect(body.sourceDocument).toMatchObject({
      filename: 'commercial-strategy-decision-paper.md',
      contentType: 'text/markdown',
      fileExtension: 'md',
    })
  })

  test('catalogue uses canonical SS-002 relationship metadata', () => {
    for (const definition of V1_KNOWLEDGE_ASSET_DEFINITIONS) {
      expect(() => normalizeKnowledgePackRelationships(definition.dependencyReferences))
        .not.toThrow()
    }
    expect(() => normalizeKnowledgePackRelationships([
      {
        knowledgeLayer: 'OUTPUT_SCHEMA',
        requirement: 'REQUIRED',
        packType: 'OUTPUT_SCHEMA',
        packKey: 'legacy-shorthand',
      },
    ])).toThrow('Legacy dependency metadata requires the guarded SS-002 migration')
  })
})
