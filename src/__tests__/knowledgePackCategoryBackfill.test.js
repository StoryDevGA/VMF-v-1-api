import { describe, expect, jest, test } from '@jest/globals'
import {
  backfillKnowledgePackCategories,
  buildKnowledgePackCategoryBackfillFilter,
  buildKnowledgePackCategoryChanges,
  resolveBackfilledKnowledgePackCategory,
} from '../scripts/backfillKnowledgePackCategories.js'

const buildFindModel = ({ rows = [], databaseName = 'vmf_test' } = {}) => {
  const lean = jest.fn(async () => rows)
  const select = jest.fn(() => ({ lean }))
  const find = jest.fn(() => ({ select }))
  const bulkWrite = jest.fn(async () => ({ modifiedCount: rows.length }))

  return {
    find,
    collection: {
      db: { databaseName },
      bulkWrite,
    },
    helpers: {
      find,
      select,
      lean,
      bulkWrite,
    },
  }
}

describe('Knowledge Pack category backfill', () => {
  test('resolves missing and platform categories without changing valid future categories', () => {
    expect(resolveBackfilledKnowledgePackCategory({
      packType: 'OUTPUT_SCHEMA',
      packCategory: '',
    })).toBe('OUTCOME')
    expect(resolveBackfilledKnowledgePackCategory({
      packType: 'TRUTH_CERTIFICATION',
      packCategory: 'OUTCOME',
    })).toBe('PLATFORM')
    expect(resolveBackfilledKnowledgePackCategory({
      packType: 'ARL',
      packCategory: 'DISCOVERY',
    })).toBe('DISCOVERY')
  })

  test('builds deterministic category changes for missing, invalid, and stale platform rows', () => {
    const changes = buildKnowledgePackCategoryChanges({
      idField: 'packId',
      rows: [
        {
          _id: '507f1f77bcf86cd799439011',
          packId: 'kp-output-schema-output-schemas-pack',
          packType: 'OUTPUT_SCHEMA',
          packKey: 'output-schemas-pack',
        },
        {
          _id: '507f1f77bcf86cd799439012',
          packId: 'kp-arl-adaptive-reasoning-layer',
          packCategory: 'discovery',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
        },
        {
          _id: '507f1f77bcf86cd799439013',
          packId: 'kp-truth-certification-truth-certification-pack',
          packCategory: 'OUTCOME',
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
        },
        {
          _id: '507f1f77bcf86cd799439014',
          packId: 'kp-rl-rendering-layer',
          packCategory: 'OUTCOME',
          packType: 'RL',
          packKey: 'rendering-layer',
        },
      ],
    })

    expect(changes).toEqual([
      expect.objectContaining({
        recordKey: 'kp-output-schema-output-schemas-pack',
        previousCategory: '',
        nextCategory: 'OUTCOME',
      }),
      expect.objectContaining({
        recordKey: 'kp-truth-certification-truth-certification-pack',
        previousCategory: 'OUTCOME',
        nextCategory: 'PLATFORM',
      }),
    ])
  })

  test('dry-run reports pending collection changes without writing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const packModel = buildFindModel({
      rows: [
        {
          _id: '507f1f77bcf86cd799439011',
          packId: 'kp-output-schema-output-schemas-pack',
          packType: 'OUTPUT_SCHEMA',
          packKey: 'output-schemas-pack',
        },
      ],
    })
    const versionModel = buildFindModel({
      rows: [
        {
          _id: '507f1f77bcf86cd799439012',
          versionId: 'kpv-truth-certification-truth-certification-pack-1-0-0-global',
          packCategory: 'OUTCOME',
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
        },
      ],
    })
    const activationModel = buildFindModel({ rows: [] })
    const logs = []

    const result = await backfillKnowledgePackCategories({
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        modelConfigs: [
          { collectionKey: 'KnowledgePack', model: packModel, idField: 'packId' },
          { collectionKey: 'KnowledgePackVersion', model: versionModel, idField: 'versionId' },
          { collectionKey: 'KnowledgePackActivation', model: activationModel, idField: 'activationId' },
        ],
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      mode: 'dry-run',
      database: 'vmf_test',
      totalScanned: 2,
      totalPending: 2,
      totalChanged: 0,
      indexPosture: 'UNCHANGED_CATEGORY_NEUTRAL_UNIQUE_INDEXES',
    }))
    expect(packModel.helpers.find).toHaveBeenCalledWith(buildKnowledgePackCategoryBackfillFilter())
    expect(packModel.helpers.select).toHaveBeenCalledWith(
      '_id packId packCategory packType packKey updatedAt',
    )
    expect(packModel.helpers.bulkWrite).not.toHaveBeenCalled()
    expect(versionModel.helpers.bulkWrite).not.toHaveBeenCalled()
    expect(logs[0]).toContain('Unique-index posture: unchanged')
  })

  test('apply mode writes only pending category changes by stable record key', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const packModel = buildFindModel({
      rows: [
        {
          _id: '507f1f77bcf86cd799439011',
          packId: 'kp-output-schema-output-schemas-pack',
          packType: 'OUTPUT_SCHEMA',
          packKey: 'output-schemas-pack',
        },
      ],
    })

    const result = await backfillKnowledgePackCategories({
      apply: true,
      dependencies: {
        connect,
        disconnect,
        modelConfigs: [
          { collectionKey: 'KnowledgePack', model: packModel, idField: 'packId' },
        ],
      },
    })

    expect(result.mode).toBe('apply')
    expect(result.totalChanged).toBe(1)
    expect(packModel.helpers.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { packId: 'kp-output-schema-output-schemas-pack' },
            update: {
              $set: {
                packCategory: 'OUTCOME',
                updatedAt: expect.any(Date),
              },
            },
          },
        },
      ],
      { ordered: false },
    )
  })
})
