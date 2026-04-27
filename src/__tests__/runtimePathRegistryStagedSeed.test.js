import { describe, expect, jest, test } from '@jest/globals'
import { getRuntimePathRegistryVmf231Seeds } from '../seeds/runtimePathRegistryVmf231.js'
import { runSeedRuntimePathRegistryStaged } from '../scripts/seedRuntimePathRegistryStaged.js'
import {
  inferRuntimePathCategory,
  reclassifyRuntimePathCategories,
} from '../scripts/reclassifyRuntimePathCategories.js'

const ACTOR_USER_ID = '507f1f77bcf86cd799439011'

describe('Runtime Path Registry staged seed normalization', () => {
  test('normalizes the VMF v2.3.1 temp artifact to the current app contract', () => {
    const runtimePathRegistryVmf231Seeds = getRuntimePathRegistryVmf231Seeds()

    expect(runtimePathRegistryVmf231Seeds).toHaveLength(50)
    expect(runtimePathRegistryVmf231Seeds.some((row) => row.scope === 'ARTIFACT_OUTPUT')).toBe(false)
    expect(runtimePathRegistryVmf231Seeds.some((row) => row.category === 'POLICY')).toBe(true)
    expect(runtimePathRegistryVmf231Seeds.some((row) => row.category === 'SECTION')).toBe(true)
    expect(runtimePathRegistryVmf231Seeds.some((row) => row.category === 'ARTIFACT')).toBe(true)

    expect(runtimePathRegistryVmf231Seeds.find((row) => row.pathKey === 'framework_state.policy.last_result'))
      .toMatchObject({
        scope: 'FRAMEWORK_STATE',
        category: 'POLICY',
        sourceType: 'DERIVED',
      })

    expect(runtimePathRegistryVmf231Seeds.find((row) => row.pathKey === 'framework_state.artifacts.board_summary'))
      .toMatchObject({
        scope: 'FRAMEWORK_STATE',
        category: 'ARTIFACT',
      })
  })

  test('vmf-v2-3-1 stage dry-run validates cleanly', async () => {
    const logger = jest.fn()

    const result = await runSeedRuntimePathRegistryStaged({
      stage: 'vmf-v2-3-1',
      actorUserId: ACTOR_USER_ID,
      logger,
      dependencies: {
        connect: async () => {},
        disconnect: async () => {},
      },
    })

    expect(result.summary).toMatchObject({
      mode: 'dry-run',
      stage: 'vmf-v2-3-1',
      totalSeeds: 50,
      validSeeds: 50,
      invalidSeeds: 0,
    })
    expect(result.invalid).toEqual([])
  })

  test('runtime path category reclassification infers governed categories from path roots', async () => {
    expect(inferRuntimePathCategory('framework_state.workflow.assignment')).toBe('WORKFLOW')
    expect(inferRuntimePathCategory('framework_state.policy.last_result')).toBe('POLICY')
    expect(inferRuntimePathCategory('framework_state.audit.events')).toBe('AUDIT')

    const logger = jest.fn()
    const result = await reclassifyRuntimePathCategories({
      logger,
      dependencies: {
        connect: async () => {},
        disconnect: async () => {},
        model: {
          find: jest.fn(() => ({
            lean: jest.fn(async () => [
              {
                _id: '507f1f77bcf86cd799439011',
                pathKey: 'framework_state.workflow.assignment',
                category: 'STATE',
              },
              {
                _id: '507f1f77bcf86cd799439012',
                pathKey: 'framework_state.policy.last_result',
                category: 'SYSTEM',
              },
              {
                _id: '507f1f77bcf86cd799439013',
                pathKey: 'framework_state.validation.required_sections',
                category: 'VALIDATION',
              },
            ]),
          })),
          collection: {
            bulkWrite: jest.fn(),
          },
        },
      },
    })

    expect(result).toMatchObject({
      mode: 'dry-run',
      scanned: 3,
      pending: 2,
    })
    expect(result.changes).toEqual([
      expect.objectContaining({
        pathKey: 'framework_state.workflow.assignment',
        previousCategory: 'STATE',
        nextCategory: 'WORKFLOW',
      }),
      expect.objectContaining({
        pathKey: 'framework_state.policy.last_result',
        previousCategory: 'SYSTEM',
        nextCategory: 'POLICY',
      }),
    ])
  })
})
