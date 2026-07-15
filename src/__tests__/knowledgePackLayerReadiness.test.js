import { describe, expect, jest, test } from '@jest/globals'

import {
  auditKnowledgePackLayerReadiness,
  buildKnowledgePackLayerAuditRow,
  proposeKnowledgeLayer,
} from '../scripts/auditKnowledgePackLayerReadiness.js'

const policy = {
  policyVersion: 'test-policy-v1',
  packTypeLayerMap: {
    STYLE: 'STYLE',
    OUTPUT_SCHEMA: 'OUTPUT_SCHEMA',
  },
  capabilityRequiredLayers: ['STYLE', 'OUTPUT_SCHEMA'],
}

const buildReadOnlyModel = (rows, databaseName = 'vmf_test') => {
  const lean = jest.fn().mockResolvedValue(rows)
  const select = jest.fn().mockReturnValue({ lean })
  const find = jest.fn().mockReturnValue({ select, lean })
  return {
    collection: { db: { databaseName } },
    find,
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
  }
}

describe('Knowledge Pack layer readiness audit', () => {
  test('classifies persisted layers, suggests policy mappings, and blocks unmapped types', () => {
    expect(proposeKnowledgeLayer({ knowledgeLayer: 'style', packType: 'SYSTEM' }, policy))
      .toEqual(expect.objectContaining({
        status: 'CLASSIFIED',
        suggestedLayer: 'STYLE',
        reason: 'PERSISTED_LAYER',
      }))
    expect(proposeKnowledgeLayer({ packType: 'output_schema' }, policy))
      .toEqual(expect.objectContaining({
        status: 'SUGGESTED',
        suggestedLayer: 'OUTPUT_SCHEMA',
        reason: 'PACK_TYPE_POLICY',
      }))
    expect(proposeKnowledgeLayer({ packType: 'system' }, policy))
      .toEqual(expect.objectContaining({
        status: 'BLOCKED',
        reason: 'UNMAPPED_PACK_TYPE',
      }))
  })

  test('reports missing governance metadata without authorizing a write', () => {
    expect(buildKnowledgePackLayerAuditRow({
      collectionKey: 'KnowledgePackVersion',
      idField: 'versionId',
      includesDependencies: true,
      policy,
      row: {
        versionId: 'kpv-style-board-1-0-0-global',
        packType: 'STYLE',
        packKey: 'board',
      },
    })).toEqual(expect.objectContaining({
      proposalStatus: 'SUGGESTED',
      suggestedLayer: 'STYLE',
      issues: [
        'CAPABILITY_KEY_MISSING',
        'WORKSPACE_COMPATIBILITY_MISSING',
        'DEPENDENCY_METADATA_UNSET',
      ],
      writeAuthorized: false,
    }))
  })

  test('scans injected collections in read-only mode and always disconnects', async () => {
    const packModel = buildReadOnlyModel([{
      packId: 'kp-style-board',
      packType: 'STYLE',
      packKey: 'board',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'board',
      workspaceCompatibility: ['OUTCOME'],
    }])
    const versionModel = buildReadOnlyModel([{
      versionId: 'kpv-output-schema-board-1-0-0-global',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'board',
    }])
    const connect = jest.fn().mockResolvedValue(undefined)
    const disconnect = jest.fn().mockResolvedValue(undefined)
    const logger = jest.fn()

    const summary = await auditKnowledgePackLayerReadiness({
      json: true,
      logger,
      dependencies: {
        connect,
        disconnect,
        policy,
        modelConfigs: [
          {
            collectionKey: 'KnowledgePack',
            model: packModel,
            idField: 'packId',
            includesDependencies: false,
          },
          {
            collectionKey: 'KnowledgePackVersion',
            model: versionModel,
            idField: 'versionId',
            includesDependencies: true,
          },
        ],
      },
    })

    expect(summary).toEqual(expect.objectContaining({
      mode: 'dry-run',
      database: 'vmf_test',
      writePosture: 'READ_ONLY_NO_APPLY_MODE',
      totalScanned: 2,
      totalClassified: 1,
      totalSuggested: 1,
      totalBlocked: 0,
    }))
    expect(connect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('"writePosture": "READ_ONLY_NO_APPLY_MODE"'))
    for (const model of [packModel, versionModel]) {
      expect(model.updateOne).not.toHaveBeenCalled()
      expect(model.updateMany).not.toHaveBeenCalled()
      expect(model.bulkWrite).not.toHaveBeenCalled()
    }
  })
})
