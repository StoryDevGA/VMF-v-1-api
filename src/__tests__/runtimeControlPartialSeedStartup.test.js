import { afterEach, describe, expect, jest, test } from '@jest/globals'

const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

afterEach(() => {
  jest.restoreAllMocks()
  jest.resetModules()
})

describe('Runtime Control partial seed startup boundary', () => {
  test('rejects partial Runtime Control bootstrap state without importing a Framework seed', async () => {
    jest.resetModules()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const connectDb = jest.fn(async () => {})
    const seedSystemRoles = jest.fn(async () => {})
    const seedFrameworkRegistry = jest.fn(async () => {})
    const seedSuperAdmin = jest.fn(async () => ({ _id: 'operator-id' }))
    const seedDefaultLicenseLevel = jest.fn(async () => {})
    const importFrameworkSeed = jest.fn(async () => ({ payload: {}, hasErrors: false }))
    const retainedModel = () => ({
      collection: { name: 'retained-runtime-control' },
      estimatedDocumentCount: jest.fn(async () => 1),
    })
    const frameworkPackageModel = {
      collection: { name: 'frameworkpackages' },
      estimatedDocumentCount: jest.fn(async () => 0),
    }

    await jest.unstable_mockModule('../config/db.js', () => ({ connectDb }))
    await jest.unstable_mockModule('../seeds/systemRoles.js', () => ({ seedSystemRoles }))
    await jest.unstable_mockModule('../seeds/frameworkRegistry.js', () => ({ seedFrameworkRegistry }))
    await jest.unstable_mockModule('../seeds/superAdmin.js', () => ({ seedSuperAdmin }))
    await jest.unstable_mockModule('../seeds/licenseLevels.js', () => ({ seedDefaultLicenseLevel }))
    await jest.unstable_mockModule('../models/FrameworkPackage.js', () => ({ default: frameworkPackageModel }))
    await jest.unstable_mockModule('../models/index.js', () => ({
      RuntimeAgent: retainedModel(),
      RuntimePathRegistry: retainedModel(),
      RuntimeSkill: retainedModel(),
      SkillRoleRegistry: retainedModel(),
      UIContract: retainedModel(),
      ValidationRegistry: retainedModel(),
      WorkflowPolicy: retainedModel(),
    }))
    await jest.unstable_mockModule('../scripts/importFrameworkSeed.js', () => ({ importFrameworkSeed }))

    const { runSeeds } = await import('../seeds/index.js')
    await expect(runSeeds()).rejects.toThrow(
      /Runtime Control collections are partially populated.*frameworkpackages.*framework-seed:import manually/s,
    )
    expect(importFrameworkSeed).not.toHaveBeenCalled()
    expect(seedDefaultLicenseLevel).not.toHaveBeenCalled()
  })

  test('keeps a partial-seed failure non-fatal during development server startup', async () => {
    jest.resetModules()
    const listen = jest.fn((_port, callback) => callback())
    const server = { on: jest.fn(), listen, close: jest.fn() }
    const runSeeds = jest.fn(async () => {
      throw new Error('[seed] Runtime Control collections are partially populated.')
    })
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const processOn = jest.spyOn(process, 'on').mockImplementation(() => process)

    await jest.unstable_mockModule('node:http', () => ({
      default: { createServer: jest.fn(() => server) },
    }))
    await jest.unstable_mockModule('../app.js', () => ({ default: {} }))
    await jest.unstable_mockModule('../config/env.js', () => ({
      default: { nodeEnv: 'development', port: 8000 },
    }))
    await jest.unstable_mockModule('../config/logger.js', () => ({ default: logger }))
    await jest.unstable_mockModule('../config/db.js', () => ({
      connectDb: jest.fn(async () => {}),
      disconnectDb: jest.fn(async () => {}),
    }))
    await jest.unstable_mockModule('../config/redis.js', () => ({
      connectRedis: jest.fn(async () => {}),
      disconnectRedis: jest.fn(async () => {}),
    }))
    await jest.unstable_mockModule('../seeds/index.js', () => ({ runSeeds }))
    await jest.unstable_mockModule('../services/retentionSchedulerService.js', () => ({
      startRetentionScheduler: jest.fn(),
      stopRetentionScheduler: jest.fn(),
    }))
    await jest.unstable_mockModule('../services/backgroundJobService.js', () => ({
      startBackgroundJobs: jest.fn(),
      stopBackgroundJobs: jest.fn(async () => {}),
    }))

    await import('../server.js')
    await nextTurn()
    await nextTurn()

    expect(runSeeds).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Database seeding failed (non-fatal in development)',
    )
    expect(listen).toHaveBeenCalledWith(8000, expect.any(Function))
    processOn.mockRestore()
  })
})
