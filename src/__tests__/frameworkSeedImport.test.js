import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { describe, expect, jest, test } from '@jest/globals'
import {
  buildImportUpdatePayload,
  importRecord,
  parseArgs,
} from '../scripts/importFrameworkSeed.js'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')
const seedDir = path.resolve(workspaceRoot, 'docs/seed-data')
const importScript = path.resolve(apiRoot, 'src/scripts/importFrameworkSeed.js')

jest.setTimeout(30_000)

const runSeedGuard = (args = []) =>
  execFileAsync(process.execPath, [importScript, '--json', '--no-report', ...args], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    maxBuffer: 1024 * 1024 * 5,
  })

describe('framework seed import guard', () => {
  test('suggests help for unknown script arguments', () => {
    expect(() => parseArgs(['--no-edditor-contract'])).toThrow(/--help/i)
  })

  test.each(['--seed-dir', '--audit-file', '--report-dir'])(
    'rejects %s when the value is omitted or another flag',
    (flagName) => {
      expect(() => parseArgs([flagName])).toThrow(`${flagName} requires a value`)
      expect(() => parseArgs([flagName, '--apply'])).toThrow(`${flagName} requires a value`)
    },
  )

  test('passes when seeded Framework Package dropdown values are exposed by the editor contract', async () => {
    const { stdout } = await runSeedGuard()
    const payload = JSON.parse(stdout)

    expect(payload.editorOptionContract.status).toBe('pass')
    expect(payload.editorOptionContract.failures).toBe(0)
    expect(payload.auditRegistryContract.status).toBe('pass')
    expect(payload.auditRegistryContract.failures).toBe(0)
    expect(payload.editorOptionContract.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'validationBindings.trigger',
          seededValues: expect.arrayContaining(['ON_VALIDATE']),
          missingFromClient: [],
          missingFromBackend: [],
        }),
        expect.objectContaining({
          field: 'workflowBindings.executionContext',
          seededValues: expect.arrayContaining(['ON_QUERY', 'ON_RENDER', 'ON_SPD_COMPILE']),
          missingFromClient: [],
          missingFromBackend: [],
        }),
        expect.objectContaining({
          field: 'availableOutputKeys',
          seededValues: expect.arrayContaining(['full-report', 'validation-audit']),
          missingFromClient: [],
        }),
      ]),
    )
  })

  test('reports the framework version from the seed package instead of a hardcoded importer value', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-version-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const packageFile = path.join(tempSeedDir, 'v2_3_1_framework_package.json')
    const frameworkPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    frameworkPackage.version = '2.3.530847'
    fs.writeFileSync(packageFile, `${JSON.stringify(frameworkPackage, null, 2)}\n`, 'utf8')

    const { stdout } = await runSeedGuard(['--seed-dir', tempSeedDir])
    const payload = JSON.parse(stdout)

    expect(payload.version).toBe('2.3.530847')
  })

  test('blocks audit-shaped seed data that references an unregistered audit action', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-audit-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    fs.writeFileSync(
      path.join(tempSeedDir, 'audit_seed_test.json'),
      `${JSON.stringify({
        actorUserId: '507f1f77bcf86cd799439011',
        action: 'FUTURE_AUDIT_EVENT',
        resourceType: 'FrameworkPackage',
        resourceId: '807f1f77bcf86cd799439044',
        requestId: 'req-seed-audit-contract',
      }, null, 2)}\n`,
      'utf8',
    )

    await expect(runSeedGuard(['--seed-dir', tempSeedDir, '--no-audit'])).rejects.toMatchObject({
      stdout: expect.stringContaining('FUTURE_AUDIT_EVENT'),
    })
  })

  test('blocks generated seed data that contains an output key missing from the editor options', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const packageFile = path.join(tempSeedDir, 'v2_3_1_framework_package.json')
    const frameworkPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    frameworkPackage.availableOutputKeys = [
      ...(Array.isArray(frameworkPackage.availableOutputKeys) ? frameworkPackage.availableOutputKeys : []),
      'future-output-pack',
    ]
    fs.writeFileSync(packageFile, `${JSON.stringify(frameworkPackage, null, 2)}\n`, 'utf8')

    await expect(runSeedGuard(['--seed-dir', tempSeedDir, '--no-audit'])).rejects.toMatchObject({
      stdout: expect.stringContaining('future-output-pack'),
    })
  })

  test('preserves managed fields when updating existing records', async () => {
    const updatePayload = buildImportUpdatePayload({
      key: 'standard-package-2-3-1',
      name: 'Standard Package',
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockedReason: null,
      dependencyLock: null,
      lastCheckpointResult: null,
      status: 'DRAFT',
      assignedCustomerIds: [],
      updatedBy: '000000000000000000000001',
    })

    expect(updatePayload).toEqual({
      key: 'standard-package-2-3-1',
      name: 'Standard Package',
    })
  })

  test('updates existing seed rows through the safe payload only', async () => {
    const existing = {
      $locals: {},
      set: jest.fn(function set(payload) {
        this.payload = payload
      }),
      isModified: jest.fn(() => true),
      save: jest.fn(),
    }
    class FakeModel {
      static findOne = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(existing),
      }))
      constructor(record) {
        this.record = record
      }
    }

    const status = await importRecord(
      {
        label: 'Framework Packages',
        model: FakeModel,
        identityFields: ['key'],
      },
      {
        key: 'standard-package-2-3-1',
        name: 'Updated Package',
        status: 'DRAFT',
        lockedReason: null,
        lastCheckpointResult: null,
        updatedBy: '000000000000000000000001',
      },
    )

    expect(status).toBe('updated')
    expect(existing.set).toHaveBeenCalledWith({
      key: 'standard-package-2-3-1',
      name: 'Updated Package',
    })
    expect(existing.save).toHaveBeenCalled()
  })

  test('creates missing seed rows', async () => {
    const saved = jest.fn()
    class FakeModel {
      static findOne = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(null),
      }))
      constructor(record) {
        this.record = record
        this.save = saved
      }
    }

    const status = await importRecord(
      {
        label: 'Runtime Paths',
        model: FakeModel,
        identityFields: ['pathKey'],
      },
      {
        pathKey: 'framework_state.sections.executive_summary',
      },
    )

    expect(status).toBe('created')
    expect(saved).toHaveBeenCalled()
  })
})
