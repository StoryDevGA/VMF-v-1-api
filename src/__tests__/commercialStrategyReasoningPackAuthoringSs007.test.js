import crypto from 'node:crypto'
import { jest } from '@jest/globals'

import {
  assertSs007ReasoningWriteEnvironment,
  buildSs007ReasoningCatalogueDigest,
  buildSs007ReasoningImportBody,
  buildSs007ReasoningPackDefinitions,
  convergeSs007ReasoningPacks,
  loadSs007ReasoningPacks,
  planSs007ReasoningPack,
  runSs007ReasoningPackAuthoring,
  SS007_REASONING_PACK_CONFIRM_FLAG,
} from '../scripts/authorCommercialStrategyReasoningPacksSs007.js'
import {
  ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'

const EMPTY_CHECKSUM = buildKnowledgePackRelationshipChecksum([])
const hashText = (value) => `sha256:${crypto.createHash('sha256').update(String(value ?? '').trim(), 'utf8').digest('hex')}`

const asset = Object.freeze({
  packType: 'ARL',
  packKey: 'adaptive-reasoning-layer',
  packId: 'kp-arl-adaptive-reasoning-layer',
  versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
  label: 'ARL Runtime Knowledge Pack',
  description: 'Adaptive reasoning layer review.',
  purposeCategory: 'SYSTEM',
  knowledgeLayer: 'REASONING',
  capabilityKey: 'adaptive-reasoning',
  knowledgeAssetId: 'QA-SS007-ARL-ADAPTIVE-REASONING-LAYER',
  executionMode: 'PROVIDER_CONTEXT',
  filename: 'system-reference-arl-v1-5-source-derived-canonical-runtime.md',
  sourcePath: 'docs/seed-data/support_assets/system-reference-arl-v1-5-source-derived-canonical-runtime.md',
  expectedContentHash: 'sha256:source',
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: EMPTY_CHECKSUM,
})

const governedRow = (overrides = {}) => ({
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  capabilityKey: asset.capabilityKey,
  knowledgeAssetId: asset.knowledgeAssetId,
  workspaceCompatibility: ['OUTCOME'],
  executionMode: asset.executionMode,
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: EMPTY_CHECKSUM,
  dependencyReferences: [],
  ...overrides,
})

const queryResult = (value) => ({
  lean: jest.fn().mockResolvedValue(value),
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const completeModelsForAllAssets = () => ({
  KnowledgePack: {
    findOne: jest.fn((query) => {
      if (query?.knowledgeAssetId) return queryResult(null)
      return queryResult(governedRow({ packId: query?.packId }))
    }),
  },
  KnowledgePackVersion: {
    findOne: jest.fn((query) => queryResult(governedRow({
      versionId: query?.versionId,
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
      content: 'approved source text',
      contentHash: hashText('approved source text'),
      sourceFilename: 'Approved Source.docx',
      sourceDocuments: [{
        filename: 'Approved Source.docx',
        sourceHash: 'sha256:source-document',
      }],
    }))),
  },
  KnowledgePackActivation: {
    find: jest.fn(() => queryResult([governedRow({
      status: 'ACTIVE',
      contentHash: hashText('approved source text'),
    })])),
  },
})

describe('SS-007 commercial strategy reasoning pack authoring dry-run', () => {
  test('builds the exact generic Andrew-derived reasoning catalogue', () => {
    const definitions = buildSs007ReasoningPackDefinitions()
    const byPackKey = new Map(definitions.map((definition) => [definition.packKey, definition]))

    expect(definitions).toHaveLength(ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.length)
    expect(byPackKey.get('cacr-runtime-pack')).toMatchObject({
      packType: 'SYSTEM_REFERENCE',
      sourceSeedPackKey: 'cacr-runtime-pack',
      knowledgeLayer: 'FRAMEWORK',
      capabilityKey: 'cacr-runtime-pack',
      knowledgeAssetId: 'QA-SS007-SYSTEM-REFERENCE-CACR-RUNTIME-PACK',
      filename: 'system-reference-cacr-v2-0-source-authority-runtime-artifact.md',
    })
    expect(byPackKey.get('adaptive-reasoning-layer')).toMatchObject({
      packType: 'ARL',
      knowledgeLayer: 'REASONING',
      capabilityKey: 'adaptive-reasoning',
      filename: 'system-reference-arl-v1-5-source-derived-canonical-runtime.md',
    })
    expect(byPackKey.get('rendering-layer')).toMatchObject({
      packType: 'RL',
      knowledgeLayer: 'COMMUNICATION_PATTERN',
      capabilityKey: 'rendering',
      filename: 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
    })
    expect(byPackKey.get('fx-runtime-pack')).toMatchObject({
      packType: 'SYSTEM',
      sourceSeedPackKey: 'fx-runtime-pack',
      capabilityKey: 'fx-runtime-pack',
      filename: 'system-reference-fx-v2-6-canonical-specification.md',
    })
    expect(definitions.every((definition) => definition.capabilityKey)).toBe(true)
  })

  test('plans import for exact missing records and does not reuse alias identity', () => {
    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: null,
        version: null,
        activations: [],
        identityConflict: null,
      },
    })).toEqual({ action: 'IMPORT' })

    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: null,
        version: null,
        activations: [],
        identityConflict: {
          packId: 'kp-framework-pack-arl-v1-2-analytical-rendering-layer',
        },
      },
    })).toEqual({
      blocker: 'KNOWLEDGE_ASSET_ID_CONFLICT',
      conflictPackId: 'kp-framework-pack-arl-v1-2-analytical-rendering-layer',
    })
  })

  test('plans metadata convergence for exact rows before lifecycle advancement', () => {
    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: governedRow({ knowledgeLayer: '' }),
        version: governedRow({
          status: 'DRAFT',
          contentHash: asset.expectedContentHash,
        }),
        activations: [],
        identityConflict: null,
      },
    })).toEqual({
      action: 'UPDATE_GOVERNANCE_METADATA',
      mismatchFields: ['pack.knowledgeLayer'],
    })
  })

  test('recognizes completed active records and fails closed on protected drift', () => {
    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({
          status: 'ACTIVE',
          contentHash: asset.expectedContentHash,
        }),
        activations: [governedRow({ status: 'ACTIVE' })],
        identityConflict: null,
      },
    })).toEqual({ complete: true })

    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: governedRow(),
        version: governedRow({
          status: 'DRAFT',
          contentHash: 'sha256:different',
        }),
        activations: [],
        identityConflict: null,
      },
    })).toEqual({
      blocker: 'SOURCE_CONTENT_DRIFT',
      observedContentHash: 'sha256:different',
      expectedContentHash: asset.expectedContentHash,
      sourceBaselineBlocker: 'VERSION_NOT_ACTIVE',
    })
  })

  test('uses an internally consistent active approved database version as source baseline', () => {
    const dbContent = 'approved source text'
    const dbContentHash = hashText(dbContent)

    expect(planSs007ReasoningPack({
      asset,
      state: {
        pack: governedRow({ knowledgeAssetId: '' }),
        version: governedRow({
          status: 'ACTIVE',
          reviewStatus: 'APPROVED',
          content: dbContent,
          contentHash: dbContentHash,
          sourceFilename: 'ARL Runtime.docx',
          sourceDocuments: [{
            filename: 'ARL Runtime.docx',
            sourceHash: 'sha256:source-document',
          }],
        }),
        activations: [governedRow({
          status: 'ACTIVE',
          contentHash: dbContentHash,
        })],
        identityConflict: null,
      },
    })).toEqual({
      action: 'UPDATE_GOVERNANCE_METADATA',
      mismatchFields: ['pack.knowledgeAssetId'],
      sourceBaseline: {
        mode: 'EXISTING_APPROVED_DATABASE_VERSION',
        contentHash: dbContentHash,
        sourceFilenames: ['ARL Runtime.docx'],
        sourceHashes: ['sha256:source-document'],
      },
    })
  })

  test('builds import payload with exact governed identity and canonical relationship metadata', () => {
    const body = buildSs007ReasoningImportBody({
      ...asset,
      extractedText: 'source text',
    })

    expect(body).toMatchObject({
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      knowledgeLayer: 'REASONING',
      capabilityKey: 'adaptive-reasoning',
      knowledgeAssetId: 'QA-SS007-ARL-ADAPTIVE-REASONING-LAYER',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: [],
      contentFormat: 'MARKDOWN',
      executionMode: 'PROVIDER_CONTEXT',
    })
    expect(body.sourceDocument).toMatchObject({
      filename: 'system-reference-arl-v1-5-source-derived-canonical-runtime.md',
      contentType: 'text/markdown',
      fileExtension: 'md',
    })
  })

  test('rejects unsafe write environments before mutation services run', async () => {
    expect(() => assertSs007ReasoningWriteEnvironment({
      databaseName: 'production',
      nodeEnv: 'production',
    })).toThrow('Refusing SS-007 reasoning pack authoring')
  })

  test('requires exact digest and confirmation flag for apply', async () => {
    const logger = jest.fn()
    const dependencies = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      models: completeModelsForAllAssets(),
    }

    await expect(runSs007ReasoningPackAuthoring({
      args: {
        apply: true,
        confirm: false,
        json: true,
        catalogueSha256: 'WRONG',
      },
      dependencies,
      logger,
    })).rejects.toThrow('Apply requires')
  })

  test('blocks apply in production-like environments after dry-run plan readback', async () => {
    const logger = jest.fn()
    const assets = await loadSs007ReasoningPacks()
    const catalogueSha256 = buildSs007ReasoningCatalogueDigest(assets)
    const importDraft = jest.fn()
    const dependencies = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      databaseName: 'test',
      nodeEnv: 'production',
      models: completeModelsForAllAssets(),
      services: {
        importDraft,
        validate: jest.fn(),
        review: jest.fn(),
        activate: jest.fn(),
      },
    }

    await expect(runSs007ReasoningPackAuthoring({
      args: {
        apply: true,
        confirm: true,
        json: true,
        catalogueSha256,
      },
      dependencies,
      logger,
    })).rejects.toThrow('Refusing SS-007 reasoning pack authoring')
    expect(importDraft).not.toHaveBeenCalled()
  })

  test('converges import lifecycle then verifies complete readback', async () => {
    const imported = { current: false }
    const validated = { current: false }
    const ready = { current: false }
    const approved = { current: false }
    const activated = { current: false }
    const currentVersion = () => {
      if (!imported.current) return null
      return governedRow({
        status: activated.current ? 'ACTIVE' : (validated.current ? 'VALIDATED' : 'DRAFT'),
        reviewStatus: approved.current
          ? 'APPROVED'
          : (ready.current ? 'READY_FOR_REVIEW' : 'DRAFT'),
        contentHash: asset.expectedContentHash,
      })
    }
    const models = {
      KnowledgePack: {
        findOne: jest.fn((query) => {
          if (query?.knowledgeAssetId) return queryResult(null)
          return queryResult(imported.current ? governedRow() : null)
        }),
      },
      KnowledgePackVersion: {
        findOne: jest.fn(() => queryResult(currentVersion())),
      },
      KnowledgePackActivation: {
        find: jest.fn(() => queryResult(activated.current ? [governedRow({
          status: 'ACTIVE',
          contentHash: asset.expectedContentHash,
        })] : [])),
      },
    }
    const services = {
      importDraft: jest.fn().mockImplementation(() => {
        imported.current = true
      }),
      validate: jest.fn().mockImplementation(() => {
        validated.current = true
      }),
      review: jest.fn().mockImplementation(({ body }) => {
        if (body.reviewStatus === 'READY_FOR_REVIEW') ready.current = true
        if (body.reviewStatus === 'APPROVED') approved.current = true
      }),
      activate: jest.fn().mockImplementation(() => {
        activated.current = true
      }),
    }

    const result = await convergeSs007ReasoningPacks({
      assets: [{ ...asset, extractedText: 'source text' }],
      models,
      services,
    })

    expect(result.actions).toEqual([
      { packKey: 'adaptive-reasoning-layer', action: 'IMPORT' },
      { packKey: 'adaptive-reasoning-layer', action: 'VALIDATE' },
      { packKey: 'adaptive-reasoning-layer', action: 'SUBMIT_FOR_REVIEW' },
      { packKey: 'adaptive-reasoning-layer', action: 'APPROVE' },
      { packKey: 'adaptive-reasoning-layer', action: 'ACTIVATE' },
    ])
    expect(result.readback).toMatchObject({
      ok: true,
      complete: true,
      actionsRequired: 0,
    })
  })

  test('updates only governance metadata for an existing active approved baseline', async () => {
    const approvedContentHash = hashText('approved source text')
    const pack = governedRow({ knowledgeAssetId: '' })
    const version = governedRow({
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
      content: 'approved source text',
      contentHash: approvedContentHash,
      sourceFilename: 'Approved Source.docx',
      sourceDocuments: [{
        filename: 'Approved Source.docx',
        sourceHash: 'sha256:source-document',
      }],
    })
    const activation = governedRow({
      status: 'ACTIVE',
      contentHash: approvedContentHash,
    })
    let updated = false
    const models = {
      KnowledgePack: {
        findOne: jest.fn((query) => {
          if (query?.knowledgeAssetId) return queryResult(null)
          return queryResult(updated ? governedRow() : pack)
        }),
        updateOne: jest.fn().mockImplementation(() => {
          updated = true
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
        }),
      },
      KnowledgePackVersion: {
        findOne: jest.fn((query) => {
          if (query?.versionId) return queryResult(updated ? governedRow({
            status: 'ACTIVE',
            reviewStatus: 'APPROVED',
            content: 'approved source text',
            contentHash: approvedContentHash,
            sourceFilename: 'Approved Source.docx',
            sourceDocuments: [{
              filename: 'Approved Source.docx',
              sourceHash: 'sha256:source-document',
            }],
          }) : version)
          return queryResult(version)
        }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
      KnowledgePackActivation: {
        find: jest.fn(() => queryResult([updated ? governedRow({
          status: 'ACTIVE',
          contentHash: approvedContentHash,
        }) : activation])),
        countDocuments: jest.fn().mockResolvedValue(1),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
    }

    const result = await convergeSs007ReasoningPacks({
      assets: [asset],
      models,
      services: {
        importDraft: jest.fn(),
        validate: jest.fn(),
        review: jest.fn(),
        activate: jest.fn(),
      },
    })

    expect(result.actions).toEqual([
      { packKey: 'adaptive-reasoning-layer', action: 'UPDATE_GOVERNANCE_METADATA' },
    ])
    expect(models.KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-arl-adaptive-reasoning-layer' },
      expect.objectContaining({
        $set: expect.objectContaining({
          knowledgeAssetId: 'QA-SS007-ARL-ADAPTIVE-REASONING-LAYER',
        }),
      }),
      { runValidators: true },
    )
    expect(models.KnowledgePackVersion.updateOne).toHaveBeenCalledWith(
      {
        versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
        contentHash: approvedContentHash,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          dependencyReferences: [],
          relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
          relationshipChecksum: EMPTY_CHECKSUM,
        }),
      }),
      { runValidators: true },
    )
    expect(models.KnowledgePackActivation.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: approvedContentHash,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          knowledgeAssetId: 'QA-SS007-ARL-ADAPTIVE-REASONING-LAYER',
        }),
      }),
      { runValidators: true },
    )
  })
})
