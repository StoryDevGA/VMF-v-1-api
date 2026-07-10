import { describe, expect, jest, test } from '@jest/globals'
import {
  applyRetirementPlan,
  buildRetirementPlan,
  parseArgs,
  retiredStarterPackFilter,
} from '../scripts/retireOutcomeStarterKnowledgePacks.js'

const makeFindModel = (records = []) => ({
  find: jest.fn(() => {
    const query = {
      select: jest.fn(() => query),
      lean: jest.fn(async () => records),
    }
    return query
  }),
})

describe('retireOutcomeStarterKnowledgePacks script', () => {
  test('requires explicit confirmation for apply mode', () => {
    expect(parseArgs(['--apply'])).toEqual(expect.objectContaining({
      apply: true,
      confirm: false,
    }))
    expect(parseArgs(['--apply', '--confirm-retire-starter-packs'])).toEqual(
      expect.objectContaining({
        apply: true,
        confirm: true,
      }),
    )
  })

  test('starter pack filter does not match source-document packs by system flag alone', () => {
    expect(JSON.stringify(retiredStarterPackFilter)).not.toContain('"isSystem"')
    expect(JSON.stringify(retiredStarterPackFilter)).toContain('BUNDLED_STARTER_SOURCE')
    expect(JSON.stringify(retiredStarterPackFilter)).toContain('SOURCE_ONLY')
  })

  test('dry-run plan reports only matched pack records for destructive pack deletion', async () => {
    const models = {
      KnowledgePack: makeFindModel([
        {
          packId: 'kp-arl-adaptive-reasoning-layer',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          status: 'ACTIVE',
          isSystem: true,
        },
      ]),
      KnowledgePackVersion: makeFindModel([
        {
          versionId: 'kpv-arl-adaptive-reasoning-layer-1',
          packId: 'kp-arl-adaptive-reasoning-layer',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          semanticVersion: '1.0.0',
          status: 'ACTIVE',
        },
        {
          versionId: 'kpv-output-schemas-pack-1',
          packId: 'kp-source-document-output-schemas-pack',
          packType: 'OUTPUT_SCHEMA',
          packKey: 'output-schemas-pack',
          semanticVersion: '1.0.0',
          status: 'ACTIVE',
        },
      ]),
      KnowledgePackManifest: makeFindModel([]),
      KnowledgePackActivation: makeFindModel([
        {
          activationId: 'kpa-arl-global',
          packId: 'kp-arl-adaptive-reasoning-layer',
          versionId: 'kpv-arl-adaptive-reasoning-layer-1',
          status: 'ACTIVE',
          scopeKey: 'GLOBAL',
        },
      ]),
    }

    const plan = await buildRetirementPlan({ dependencies: { models } })

    expect(models.KnowledgePack.find).toHaveBeenCalledWith(retiredStarterPackFilter)
    expect(plan.summary).toEqual(expect.objectContaining({
      packs: 1,
      versions: 2,
      activations: 1,
    }))
    expect(plan.filters.packIds).toEqual(['kp-arl-adaptive-reasoning-layer'])
    expect(plan.filters.versionIds).toEqual([
      'kpv-arl-adaptive-reasoning-layer-1',
      'kpv-output-schemas-pack-1',
    ])
    expect(plan.filters.packIds).not.toContain('kp-source-document-output-schemas-pack')
    expect(models.KnowledgePackActivation.find).toHaveBeenCalledWith({
      $or: [
        {
          packId: {
            $in: [
              'kp-arl-adaptive-reasoning-layer',
              'kp-source-document-output-schemas-pack',
            ],
          },
        },
        {
          versionId: {
            $in: [
              'kpv-arl-adaptive-reasoning-layer-1',
              'kpv-output-schemas-pack-1',
            ],
          },
        },
      ],
    })
  })

  test('apply deletes children and pack records inside one transaction with audit evidence', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(async () => {}),
    }
    const models = {
      KnowledgePackActivation: {
        deleteMany: jest.fn(async () => ({ deletedCount: 1 })),
      },
      KnowledgePackVersion: {
        deleteMany: jest.fn(async () => ({ deletedCount: 2 })),
      },
      KnowledgePack: {
        deleteMany: jest.fn(async () => ({ deletedCount: 1 })),
      },
    }
    const audit = {
      log: jest.fn(async () => ({})),
    }
    const plan = {
      filters: {
        packIds: ['kp-arl-adaptive-reasoning-layer'],
        versionIds: ['kpv-arl-adaptive-reasoning-layer-1', 'kpv-output-schemas-pack-1'],
        activationIds: ['kpa-arl-global'],
      },
      summary: {
        retiredKeys: 5,
        packs: 1,
        versions: 2,
        activations: 1,
        manifestReferences: 0,
      },
    }

    const result = await applyRetirementPlan({
      plan,
      dependencies: {
        auditService: audit,
        models,
        startSession: jest.fn(async () => session),
      },
    })

    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(models.KnowledgePackActivation.deleteMany).toHaveBeenCalledWith(
      { activationId: { $in: ['kpa-arl-global'] } },
      { session },
    )
    expect(models.KnowledgePackVersion.deleteMany).toHaveBeenCalledWith(
      {
        versionId: {
          $in: ['kpv-arl-adaptive-reasoning-layer-1', 'kpv-output-schemas-pack-1'],
        },
      },
      { session },
    )
    expect(models.KnowledgePack.deleteMany).toHaveBeenCalledWith(
      { packId: { $in: ['kp-arl-adaptive-reasoning-layer'] } },
      { session },
    )
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'KNOWLEDGE_PACK_DELETED',
        actorType: 'SYSTEM',
        systemActor: 'knowledge-pack-starter-retirement-script',
        isSystemEvent: true,
        systemEventType: 'OUTCOME_STARTER_KNOWLEDGE_PACKS_RETIRED',
        diff: expect.objectContaining({
          operation: 'RETIRE_OUTCOME_STARTER_KNOWLEDGE_PACKS',
          deletedCounts: {
            packs: 1,
            versions: 2,
            activations: 1,
          },
        }),
      }),
      { session, throwOnError: true },
    )
    expect(result).toEqual({
      packsDeleted: 1,
      versionsDeleted: 2,
      activationsDeleted: 1,
      auditPersisted: true,
    })
    expect(session.endSession).toHaveBeenCalled()
  })
})
