import { describe, expect, jest, test } from '@jest/globals'
import {
  DELETE_CONFIRMATION,
  buildPreV31VmfCleanupPlan,
  cleanupPreV31VmfRecords,
  isVersionBeforeMinimum,
  parseArgs,
} from '../scripts/cleanupPreV31VmfRecords.js'

const MODEL_NAMES = [
  'Deal',
  'FrameworkPackage',
  'KnowledgePackActivation',
  'KnowledgePackManifest',
  'OutcomeAsset',
  'OutcomeAssetVersion',
  'OutcomeMessage',
  'OutcomeSession',
  'RuntimeActivationSnapshot',
  'RuntimeAgent',
  'RuntimeDeployment',
  'RuntimeGraphRelationship',
  'RuntimeInstance',
  'RuntimeOutputAsset',
  'RuntimeOutputRequest',
  'RuntimePathRegistry',
  'RuntimeSkill',
  'RuntimeValidationAudit',
  'SkillRoleRegistry',
  'TruthSignature',
  'UIContract',
  'ValidationRegistry',
  'VMF',
  'WorkflowPolicy',
]

const createModel = (name, records = [], callOrder = []) => {
  const model = {
    modelName: name,
    collection: { name },
    find: jest.fn(() => {
      const query = {}
      query.select = jest.fn(() => query)
      query.lean = jest.fn(async () => records)
      return query
    }),
    deleteMany: jest.fn(async (filter) => {
      callOrder.push(name)
      return { deletedCount: filter?._id?.$in?.length || 0 }
    }),
  }
  return model
}

const createModels = (recordsByModel = {}, callOrder = []) =>
  Object.fromEntries(
    MODEL_NAMES.map((name) => [name, createModel(name, recordsByModel[name] || [], callOrder)]),
  )

const createNoopDependencies = (models, session = null) => ({
  connect: jest.fn(async () => {}),
  disconnect: jest.fn(async () => {}),
  models,
  startSession: jest.fn(async () => session || ({
    withTransaction: jest.fn(async (callback) => callback()),
    endSession: jest.fn(async () => {}),
  })),
})

describe('pre-v3.1 VMF cleanup harness', () => {
  test('compares numeric versions and keeps v3.1+', () => {
    expect(isVersionBeforeMinimum('2.3.1', '3.1')).toBe(true)
    expect(isVersionBeforeMinimum('3.0.9', '3.1')).toBe(true)
    expect(isVersionBeforeMinimum('3.1', '3.1')).toBe(false)
    expect(isVersionBeforeMinimum('3.1.0', '3.1')).toBe(false)
    expect(isVersionBeforeMinimum('3.2.0', '3.1')).toBe(false)
    expect(isVersionBeforeMinimum('unknown', '3.1')).toBe(false)
  })

  test('requires explicit confirmation for apply mode', () => {
    expect(() => parseArgs(['--apply'])).toThrow(DELETE_CONFIRMATION)

    expect(parseArgs(['--apply', DELETE_CONFIRMATION])).toEqual(
      expect.objectContaining({
        apply: true,
        confirmDelete: true,
        frameworkKey: 'VMF',
        minimumVersion: '3.1',
      }),
    )
  })

  test('builds a dry-run plan that excludes v3.1 and non-VMF records', async () => {
    const models = createModels({
      FrameworkPackage: [
        {
          _id: 'pkg-old',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v2-3-1',
          version: '2.3.1',
        },
        {
          _id: 'pkg-new',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v3-1',
          version: '3.1.0',
        },
        {
          _id: 'pkg-other',
          frameworkKey: 'RLD',
          packageKey: 'rld-v2',
          version: '2.0.0',
        },
      ],
      RuntimeInstance: [
        {
          _id: 'runtime-old',
          frameworkKey: 'VMF',
          packageId: 'pkg-old',
          packageKey: 'vmf-v2-3-1',
          packageVersion: '2.3.1',
        },
        {
          _id: 'runtime-new',
          frameworkKey: 'VMF',
          packageId: 'pkg-new',
          packageKey: 'vmf-v3-1',
          packageVersion: '3.1.0',
        },
      ],
      RuntimeOutputAsset: [
        {
          _id: 'output-old-runtime',
          runtimeInstanceId: 'runtime-old',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v3-1',
          packageVersion: '3.1.0',
        },
        {
          _id: 'output-new-runtime',
          runtimeInstanceId: 'runtime-new',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v3-1',
          packageVersion: '3.1.0',
        },
      ],
      RuntimeSkill: [
        {
          _id: 'skill-old',
          stableId: 'skill-old',
          key: 'old-skill',
          supportedFrameworkKeys: ['VMF'],
          introducedInVersion: '2.3.1',
        },
        {
          _id: 'skill-new',
          stableId: 'skill-new',
          key: 'new-skill',
          supportedFrameworkKeys: ['VMF'],
          introducedInVersion: '3.1',
        },
      ],
      SkillRoleRegistry: [
        {
          _id: 'role-old',
          stableId: 'role-old',
          roleKey: 'OLD_ROLE',
          introducedInVersion: '2.3.1',
        },
        {
          _id: 'role-new',
          stableId: 'role-new',
          roleKey: 'NEW_ROLE',
          introducedInVersion: '3.1',
        },
      ],
    })

    const plan = await buildPreV31VmfCleanupPlan({
      dependencies: { models },
    })

    expect(plan.oldPackageIds).toEqual(['pkg-old'])
    expect(plan.oldPackageKeys).toEqual(['vmf-v2-3-1'])
    expect(plan.oldRuntimeInstanceIds).toEqual(['runtime-old'])

    const packageEntry = plan.entries.find((entry) => entry.key === 'FrameworkPackage')
    expect(packageEntry.records.map((record) => record.id)).toEqual(['pkg-old'])

    const runtimeEntry = plan.entries.find((entry) => entry.key === 'RuntimeInstance')
    expect(runtimeEntry.records.map((record) => record.id)).toEqual(['runtime-old'])

    const outputEntry = plan.entries.find((entry) => entry.key === 'RuntimeOutputAsset')
    expect(outputEntry.records.map((record) => record.id)).toEqual(['output-old-runtime'])

    const skillEntry = plan.entries.find((entry) => entry.key === 'RuntimeSkill')
    expect(skillEntry.records.map((record) => record.id)).toEqual(['skill-old'])

    const roleEntry = plan.entries.find((entry) => entry.key === 'SkillRoleRegistry')
    expect(roleEntry.records.map((record) => record.id)).toEqual(['role-old'])

    expect(JSON.stringify(plan)).not.toContain('pkg-new')
    expect(JSON.stringify(plan)).not.toContain('pkg-other')
    expect(plan.totals.matched).toBe(5)
  })

  test('dry-run does not delete matched records', async () => {
    const models = createModels({
      FrameworkPackage: [
        {
          _id: 'pkg-old',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v2-3-1',
          version: '2.3.1',
        },
      ],
    })
    const dependencies = createNoopDependencies(models)

    const summary = await cleanupPreV31VmfRecords({
      dependencies,
      logger: jest.fn(),
      noReport: true,
    })

    expect(summary.mode).toBe('dry-run')
    expect(summary.totals.matched).toBe(1)
    expect(summary.totals.deleted).toBe(0)
    expect(models.FrameworkPackage.deleteMany).not.toHaveBeenCalled()
    expect(dependencies.connect).toHaveBeenCalled()
    expect(dependencies.disconnect).toHaveBeenCalled()
  })

  test('apply deletes dependents before parent runtime and package records', async () => {
    const callOrder = []
    const models = createModels({
      FrameworkPackage: [
        {
          _id: 'pkg-old',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v2-3-1',
          version: '2.3.1',
        },
        {
          _id: 'pkg-new',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v3-1',
          version: '3.1.0',
        },
      ],
      RuntimeInstance: [
        {
          _id: 'runtime-old',
          frameworkKey: 'VMF',
          packageId: 'pkg-old',
          packageKey: 'vmf-v2-3-1',
          packageVersion: '2.3.1',
        },
      ],
      RuntimeOutputRequest: [
        {
          _id: 'request-old',
          runtimeInstanceId: 'runtime-old',
          frameworkKey: 'VMF',
          packageKey: 'vmf-v2-3-1',
          packageVersion: '2.3.1',
        },
      ],
      RuntimeGraphRelationship: [
        {
          _id: 'graph-old',
          runtimeInstanceId: 'runtime-old',
          relationshipId: 'rel-old',
        },
      ],
      VMF: [
        {
          _id: 'vmf-old',
          frameworkVersion: '2.3.1',
          frameworkPackageId: 'pkg-old',
        },
      ],
      Deal: [
        {
          _id: 'deal-old',
          vmfId: 'vmf-old',
          title: 'Old Deal',
        },
      ],
    }, callOrder)
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(async () => {}),
    }
    const dependencies = createNoopDependencies(models, session)

    const summary = await cleanupPreV31VmfRecords({
      apply: true,
      confirmDelete: true,
      dependencies,
      logger: jest.fn(),
      noReport: true,
    })

    expect(summary.mode).toBe('apply')
    expect(summary.totals.matched).toBe(6)
    expect(summary.totals.deleted).toBe(6)
    expect(session.withTransaction).toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalled()

    expect(callOrder.indexOf('RuntimeOutputRequest')).toBeLessThan(callOrder.indexOf('RuntimeInstance'))
    expect(callOrder.indexOf('RuntimeGraphRelationship')).toBeLessThan(callOrder.indexOf('RuntimeInstance'))
    expect(callOrder.indexOf('Deal')).toBeLessThan(callOrder.indexOf('VMF'))
    expect(callOrder.indexOf('RuntimeInstance')).toBeLessThan(callOrder.indexOf('FrameworkPackage'))

    const packageDeleteFilter = models.FrameworkPackage.deleteMany.mock.calls[0][0]
    expect(packageDeleteFilter._id.$in).toEqual(['pkg-old'])
    expect(packageDeleteFilter._id.$in).not.toContain('pkg-new')
  })
})
