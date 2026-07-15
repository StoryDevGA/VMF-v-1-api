import {
  assertV1AssetWriteEnvironment,
  buildV1AssetCatalogueDigest,
  planV1Asset,
} from '../scripts/authorKnowledgePackV1Assets.js'

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
      knowledgeLayer: 'OUTPUT_SCHEMA',
      requirement: 'REQUIRED',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'executive-brief-schema',
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

  test('fails closed on source drift, metadata drift, and non-development databases', () => {
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
    })).toEqual({ blocker: 'GOVERNANCE_METADATA_DRIFT' })
    expect(() => assertV1AssetWriteEnvironment({ databaseName: 'production', nodeEnv: 'production' }))
      .toThrow('Refusing V1 Knowledge Asset authoring')
  })

  test('catalogue digest changes when approved source content changes', () => {
    const first = buildV1AssetCatalogueDigest([{ ...asset, extractedText: 'one', sourcePath: 'ignored' }])
    const second = buildV1AssetCatalogueDigest([{ ...asset, extractedText: 'two', sourcePath: 'ignored' }])
    expect(first).not.toBe(second)
  })
})
