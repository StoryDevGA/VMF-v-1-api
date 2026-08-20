import os from 'os'
import path from 'path'
import mongoose from 'mongoose'
import { describe, expect, jest, test } from '@jest/globals'
import {
  ALLOWED_TARGET,
  APPLICATION_CREDENTIAL_RISK_CONFIRMATION,
  APPLY_CREDENTIAL_ROLE,
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BACKUP_SKIP_CONFIRMATION,
  AUDITLOGS_DELETE_CONFIRMATION,
  DELETE_CONFIRMATION,
  DISPOSABLE_COLLECTIONS,
  DRY_RUN_CREDENTIAL_ROLE,
  MAX_PACKAGE_LOCK_MUTATION_DOCUMENTS,
  MAX_QUERY_TIME_MS,
  MUTABLE_RETAINED_LOCK_COLLECTIONS,
  PROTECTED_COLLECTIONS,
  READ_BATCH_SIZE,
  RESET_PLAN_SCHEMA_VERSION,
  RESTORE_CONFIRMATION,
  SOCKET_TIMEOUT_MS,
  WRITE_PAUSE_CONFIRMATION,
  applyExactPlan,
  assertAllowedTarget,
  assertProtectionConfiguration,
  buildResetMutationSurface,
  buildResetPlan,
  canonicalJson,
  connectToResetDatabase,
  executeReset,
  hashCanonical,
  mutationSurfaceFromExactPlan,
  parseArgs,
  parseMongoTarget,
  sanitizePlan,
  serializeErrorForOutput,
  usage,
  validateBackupManifest,
  verifyCredentialScope,
} from '../scripts/resetDevelopmentCustomerVmfs.js'

const objectId = (number) => new mongoose.Types.ObjectId(number.toString(16).padStart(24, '0'))
const idString = (value) => value?.toHexString?.() || String(value)
const auditLog = (overrides = {}) => ({
  _id: objectId(700),
  ts: new Date('2026-08-19T10:00:00.000Z'),
  signatureVersion: 3,
  signature: 'a'.repeat(64),
  diff: { largeUnsignedPayload: 'must-not-be-projected' },
  ...overrides,
})

const cloneValue = (value) => {
  if (value === null || value === undefined) return value
  if (typeof value?.toHexString === 'function') return value
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(cloneValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]))
  }
  return value
}

const valueAtPath = (document, dottedPath) => {
  const segments = dottedPath.split('.')
  let values = [document]
  for (const segment of segments) {
    values = values.flatMap((value) => {
      if (Array.isArray(value)) return value.map((item) => item?.[segment])
      return [value?.[segment]]
    })
  }
  return values.flat(Infinity).filter((value) => value !== undefined)
}

const matches = (document, filter = {}) => Object.entries(filter).every(([field, expected]) => {
  if (field === '$or') return expected.some((candidate) => matches(document, candidate))
  const actualValues = valueAtPath(document, field)
  if (expected && typeof expected === 'object' && expected.$exists !== undefined) {
    return Boolean(expected.$exists) === (actualValues.length > 0)
  }
  if (expected && typeof expected === 'object' && expected.$type === 10) {
    return actualValues.some((value) => value === null)
  }
  if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
    const expectedIds = new Set(expected.$in.map(idString))
    return actualValues.some((value) => expectedIds.has(idString(value)))
  }
  if (Array.isArray(expected)) {
    const actual = document[field]
    return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  }
  return actualValues.some((value) => idString(value) === idString(expected))
})

const project = (document, projection) => {
  if (!projection) return cloneValue(document)
  const selected = {}
  for (const [field, included] of Object.entries(projection)) {
    if (included && document[field] !== undefined) selected[field] = cloneValue(document[field])
  }
  return selected
}

const createMemoryDatabase = (initialCollections = {}) => {
  let collections = new Map(
    Object.entries(initialCollections).map(([name, documents]) => [name, documents.map(cloneValue)]),
  )
  let failureCollection = ''
  let afterTransaction = null
  let afterAuditLogDelete = null
  let transactionCallbackAttempts = 1
  const writes = []
  const reads = []

  const getDocuments = (name) => {
    if (!collections.has(name)) collections.set(name, [])
    return collections.get(name)
  }

  const database = {
    databaseName: 'test',
    listCollections: () => ({
      toArray: async () => [...collections.keys()].map((name) => ({ name })),
    }),
    admin: () => ({
      command: jest.fn(async () => ({ setName: 'atlas-test-shard-0', logicalSessionTimeoutMinutes: 30 })),
    }),
    collection: (name) => ({
      find: (filter = {}, options = {}) => {
        const read = { collection: name, filter, options, sort: null }
        reads.push(read)
        const query = {
          sort: (sort) => {
            read.sort = sort
            return query
          },
          toArray: async () => getDocuments(name)
            .filter((document) => matches(document, filter))
            .map((document) => project(document, options.projection)),
        }
        return query
      },
      updateMany: jest.fn(async (filter) => {
        if (failureCollection === name) throw new Error(`forced ${name} failure`)
        const targetIds = new Set(filter['vmfGrants.vmfId'].$in.map(idString))
        let matchedCount = 0
        let modifiedCount = 0
        for (const user of getDocuments(name)) {
          const before = Array.isArray(user.vmfGrants) ? user.vmfGrants : []
          const after = before.filter((grant) => !targetIds.has(idString(grant.vmfId)))
          if (after.length !== before.length) {
            matchedCount += 1
            modifiedCount += 1
            user.vmfGrants = after
          }
        }
        writes.push({ operation: 'updateMany', collection: name })
        return { matchedCount, modifiedCount }
      }),
      updateOne: jest.fn(async () => {
        throw new Error('direct updateOne is prohibited by the reset contract')
      }),
      bulkWrite: jest.fn(async (operations, options) => {
        if (failureCollection === name) throw new Error(`forced ${name} failure`)
        let matchedCount = 0
        let modifiedCount = 0
        for (const operation of operations) {
          const spec = operation.updateOne
          if (!spec || spec.upsert !== false) throw new Error('invalid bulk operation')
          const document = getDocuments(name).find((candidate) => matches(candidate, spec.filter))
          if (!document) continue
          matchedCount += 1
          for (const [field, value] of Object.entries(spec.update?.$set || {})) {
            document[field] = cloneValue(value)
          }
          modifiedCount += 1
        }
        writes.push({ operation: 'bulkWrite', collection: name, operations, options })
        return { matchedCount, modifiedCount, upsertedCount: 0 }
      }),
      deleteMany: jest.fn(async (filter) => {
        if (failureCollection === name) throw new Error(`forced ${name} failure`)
        const ids = new Set(filter._id.$in.map(idString))
        const before = getDocuments(name)
        const after = before.filter((document) => !ids.has(idString(document._id)))
        const deletedCount = before.length - after.length
        collections.set(name, after)
        if (name === 'auditlogs' && afterAuditLogDelete) await afterAuditLogDelete(database)
        writes.push({ operation: 'deleteMany', collection: name })
        return { deletedCount }
      }),
      countDocuments: jest.fn(async (filter = {}) => getDocuments(name).filter((document) => matches(document, filter)).length),
    }),
    createSession: () => ({
      withTransaction: jest.fn(async (callback) => {
        let result
        for (let attempt = 1; attempt <= transactionCallbackAttempts; attempt += 1) {
          const snapshot = new Map(
            [...collections.entries()].map(([name, documents]) => [name, documents.map(cloneValue)]),
          )
          try {
            result = await callback()
            if (attempt < transactionCallbackAttempts) {
              collections = snapshot
              continue
            }
            if (afterTransaction) await afterTransaction(database)
          } catch (error) {
            collections = snapshot
            throw error
          }
        }
        return result
      }),
      endSession: jest.fn(async () => {}),
    }),
    getDocuments,
    getReads: () => [...reads],
    getWrites: () => [...writes],
    setFailureCollection: (name) => { failureCollection = name },
    setAfterAuditLogDelete: (callback) => { afterAuditLogDelete = callback },
    setAfterTransaction: (callback) => { afterTransaction = callback },
    setTransactionCallbackAttempts: (attempts) => { transactionCallbackAttempts = attempts },
  }
  return database
}

const createFixture = ({ reverse = false, orphanChild = false, unknownCollection = false } = {}) => {
  const customerId = objectId(1)
  const tenantId = objectId(2)
  const vmfId = objectId(3)
  const runtimeId = objectId(4)
  const packageId = objectId(8)
  const packageKey = 'vmf-reset-package'
  const activationId = 'activation-vmf-reset-package'
  const deploymentId = 'deployment-vmf-reset-package'
  const lockOwner = objectId(9)
  const lockedAt = new Date('2026-08-19T09:00:00.000Z')
  const collections = {
    customers: [{ _id: customerId, status: 'ACTIVE' }],
    tenants: [{ _id: tenantId, customerId, status: 'ACTIVE' }],
    users: [{
      _id: objectId(5),
      email: 'private@example.test',
      memberships: [{ customerId }],
      vmfGrants: [{ vmfId, permissions: ['VMF_VIEW'] }],
    }],
    vmfs: [{ _id: vmfId, customerId, tenantId }],
    runtime_instances: [{ _id: runtimeId, customerId, tenantId }],
    knowledge_pack_activations: [{
      _id: objectId(6),
      scopeType: 'RUNTIME_INSTANCE',
      scopeKey: `RUNTIME_INSTANCE:${runtimeId}`.toUpperCase(),
      status: 'ACTIVE',
    }],
    runtime_validation_audit: [{ _id: objectId(7), workspaceId: String(runtimeId) }],
    runtimevalidationaudits: [],
    frameworkpackages: [{
      _id: packageId,
      packageKey,
      frameworkKey: 'VMF',
      version: '1.0.0',
      status: 'ACTIVE',
    }],
    runtime_deployments: [{
      _id: objectId(10),
      deploymentId,
      activationId,
      packageId,
      packageKey,
      frameworkKey: 'VMF',
      frameworkVersion: '1.0.0',
      status: 'ACTIVE',
      supersededByDeploymentId: null,
    }],
    runtime_activation_snapshots: [{
      _id: objectId(11),
      activationId,
      deploymentId,
      packageId,
      packageKey,
      frameworkKey: 'VMF',
      frameworkVersion: '1.0.0',
      activationStatus: 'ACTIVE',
      supersedesActivationId: null,
      supersededByActivationId: null,
      rollbackSourceActivationId: null,
    }],
    auditlogs: [auditLog({ packageKey })],
  }

  let lockId = 100
  for (const collection of MUTABLE_RETAINED_LOCK_COLLECTIONS) {
    collections[collection] = [{
      _id: objectId(lockId++),
      stableId: `${collection}-stable-id`,
      substantive: `${collection}-protected-content`,
      lockedByPackageKeys: [packageKey],
      isLocked: collection !== 'runtimepathregistries',
      lockedBy: lockOwner,
      lockedAt,
      lockedReason: 'Locked by governed package.',
      ...(collection === 'uicontracts' ? { sourcePackageKey: packageKey } : {}),
    }]
  }

  let nextId = 20
  for (const config of DISPOSABLE_COLLECTIONS) {
    if ([
      'vmfs',
      'runtime_instances',
      'frameworkpackages',
      'runtime_deployments',
      'runtime_activation_snapshots',
      'auditlogs',
    ].includes(config.collection)) continue
    if (config.collection === 'deals') {
      collections[config.collection] = [{
        _id: objectId(nextId++),
        vmfId,
        customerId,
        tenantId,
      }]
      continue
    }
    collections[config.collection] = [{
      _id: objectId(nextId++),
      runtimeInstanceId: orphanChild && config.collection === 'outcome_messages'
        ? objectId(999)
        : runtimeId,
      customerId,
      tenantId,
    }]
  }

  for (const protectedName of PROTECTED_COLLECTIONS) {
    if (!collections[protectedName]) collections[protectedName] = []
  }
  if (unknownCollection) collections.unreviewed_future_records = []
  if (reverse) {
    for (const documents of Object.values(collections)) documents.reverse()
  }
  return { collections, customerId, tenantId, vmfId, runtimeId, packageId, packageKey }
}

const privatePath = (fileName) => path.join(os.tmpdir(), fileName)
const BACKUP_SHA = 'b'.repeat(64)

const createBackupManifest = ({
  planSha256,
  exactPlan,
  now = new Date('2026-08-19T12:00:00.000Z'),
  sourceCounts,
  restoreCounts,
} = {}) => {
  const derivedCounts = exactPlan
    ? Object.fromEntries([
        ...exactPlan.entries.map(({ collection, count }) => [collection, count]),
        ...exactPlan.protectedState.map(({ collection, count }) => [collection, count]),
      ])
    : { customers: 1, vmfs: 1 }
  const effectiveSourceCounts = sourceCounts || derivedCounts
  const effectiveRestoreCounts = restoreCounts || effectiveSourceCounts
  return ({
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    planSha256,
    artifact: {
      path: privatePath('storylineos-reset-backup.archive'),
      sha256: BACKUP_SHA,
    },
    source: {
      databaseName: ALLOWED_TARGET.databaseName,
      hostSha256: ALLOWED_TARGET.hostSha256,
      completedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      collectionCounts: effectiveSourceCounts,
    },
    restore: {
      verified: true,
      databaseName: 'storylineos_restore_verification',
      completedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      collectionCounts: effectiveRestoreCounts,
    },
  })
}

const createApplyArgs = (planSha256) => ({
  allCustomers: true,
  apply: true,
  backupManifest: privatePath('storylineos-reset-backup-manifest.json'),
  backupSha256: BACKUP_SHA,
  confirmDelete: true,
  confirmAuditLogsDelete: true,
  confirmRestore: true,
  confirmWritePause: true,
  evidenceDir: privatePath('storylineos-reset-evidence'),
  help: false,
  planSha256,
  privatePlan: privatePath('storylineos-reset-private-plan.json'),
})

const createExecutionDependencies = ({ database, exactPlan, manifest, durableWriteJson, invalidatePermissionCache } = {}) => ({
  parseMongoTarget: jest.fn(() => ({
    databaseName: ALLOWED_TARGET.databaseName,
    hostSha256: ALLOWED_TARGET.hostSha256,
  })),
  assertAllowedTarget: jest.fn(() => ALLOWED_TARGET),
  connect: jest.fn(async () => database),
  disconnect: jest.fn(async () => {}),
  startSession: jest.fn(async () => database.createSession()),
  verifyTransactionTopology: jest.fn(async () => ({ setName: 'atlas-test-shard-0' })),
  verifyCredentialScope: jest.fn(async () => ({ writePrivilegeCollectionCount: 18 })),
  assertEvidenceDirectory: jest.fn(async () => {}),
  readJsonFile: jest.fn(async (filePath) => (
    filePath.endsWith('private-plan.json') ? exactPlan : manifest
  )),
  durableWriteJson: durableWriteJson || jest.fn(async () => {}),
  hashFile: jest.fn(async () => BACKUP_SHA),
  invalidatePermissionCache: invalidatePermissionCache || jest.fn(async () => ({
    redisPatternDeleteFailed: false,
    deletedKeyCount: 0,
  })),
  now: jest.fn(() => new Date('2026-08-19T12:00:00.000Z')),
})

describe('development customer VMF reset contract', () => {
  test('requires explicit all-customer and private-plan scope before connection', () => {
    expect(() => parseArgs([])).toThrow(/--all-customers/)
    expect(() => parseArgs(['--all-customers'])).toThrow(/--private-plan/)
    expect(parseArgs([
      '--all-customers',
      '--private-plan', privatePath('dry-run-plan.json'),
    ])).toEqual(expect.objectContaining({ allCustomers: true, apply: false }))
    expect(parseArgs([
      '--all-customers',
      APPLICATION_CREDENTIAL_RISK_CONFIRMATION,
      '--private-plan', privatePath('risk-dry-run-plan.json'),
    ])).toEqual(expect.objectContaining({
      apply: false,
      confirmApplicationCredentialReadOnlyRisk: true,
    }))
    expect(usage()).toContain(APPLICATION_CREDENTIAL_RISK_CONFIRMATION)
  })

  test('requires every destructive, write-pause, restore, backup, and evidence gate', () => {
    expect(() => parseArgs([
      '--apply',
      '--all-customers',
      '--private-plan', privatePath('plan.json'),
    ])).toThrow(/Apply requires/)

    const args = parseArgs([
      '--apply',
      '--all-customers',
      DELETE_CONFIRMATION,
      WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION,
      AUDITLOGS_DELETE_CONFIRMATION,
      '--private-plan', privatePath('plan.json'),
      '--plan-sha256', 'a'.repeat(64),
      '--backup-manifest', privatePath('manifest.json'),
      '--backup-sha256', BACKUP_SHA,
      '--evidence-dir', privatePath('evidence'),
    ])
    expect(args).toEqual(expect.objectContaining({
      apply: true,
      confirmDelete: true,
      confirmWritePause: true,
      confirmRestore: true,
      confirmAuditLogsDelete: true,
    }))

    expect(() => parseArgs([
      '--apply',
      '--all-customers',
      APPLICATION_CREDENTIAL_RISK_CONFIRMATION,
      '--private-plan', privatePath('plan.json'),
    ])).toThrow(/read-only dry-run/)

    const skipArgs = parseArgs([
      '--apply',
      '--all-customers',
      DELETE_CONFIRMATION,
      WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION,
      AUDITLOGS_DELETE_CONFIRMATION,
      BACKUP_SKIP_CONFIRMATION,
      '--private-plan', privatePath('skip-plan.json'),
      '--plan-sha256', 'a'.repeat(64),
      '--evidence-dir', privatePath('skip-evidence'),
    ])
    expect(skipArgs).toEqual(expect.objectContaining({
      apply: true,
      confirmBackupVerificationSkipped: true,
      backupManifest: '',
      backupSha256: '',
    }))
    expect(() => parseArgs([
      '--apply', '--all-customers', DELETE_CONFIRMATION, WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION, AUDITLOGS_DELETE_CONFIRMATION, BACKUP_SKIP_CONFIRMATION,
      '--private-plan', privatePath('skip-with-manifest.json'), '--plan-sha256', 'a'.repeat(64),
      '--backup-manifest', privatePath('manifest.json'), '--evidence-dir', privatePath('evidence'),
    ])).toThrow(/together|backup manifest arguments/)
    expect(() => parseArgs([
      '--apply', '--all-customers', DELETE_CONFIRMATION, WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION, AUDITLOGS_DELETE_CONFIRMATION, '--private-plan', privatePath('manifest-only.json'), '--plan-sha256', 'a'.repeat(64),
      '--backup-manifest', privatePath('manifest.json'), '--evidence-dir', privatePath('evidence'),
    ])).toThrow(/together|Apply requires/)
    expect(() => parseArgs([
      '--apply', '--all-customers', DELETE_CONFIRMATION, WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION, AUDITLOGS_DELETE_CONFIRMATION, '--private-plan', privatePath('hash-only.json'), '--plan-sha256', 'a'.repeat(64),
      '--backup-sha256', BACKUP_SHA, '--evidence-dir', privatePath('evidence'),
    ])).toThrow(/together|Apply requires/)
    expect(() => parseArgs([
      '--apply', '--all-customers', DELETE_CONFIRMATION, WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION, AUDITLOGS_DELETE_CONFIRMATION, '--private-plan', privatePath('no-backup-mode.json'), '--plan-sha256', 'a'.repeat(64),
      '--evidence-dir', privatePath('evidence'),
    ])).toThrow(/backup-manifest|backup-verification-skipped/)
    expect(() => parseArgs([
      '--apply', '--all-customers', DELETE_CONFIRMATION, WRITE_PAUSE_CONFIRMATION,
      RESTORE_CONFIRMATION, AUDITLOGS_DELETE_CONFIRMATION, BACKUP_SKIP_CONFIRMATION,
      '--private-plan', privatePath('skip-with-hash.json'), '--plan-sha256', 'a'.repeat(64),
      '--backup-sha256', BACKUP_SHA, '--evidence-dir', privatePath('evidence'),
    ])).toThrow(/together|backup manifest arguments/)
    expect(() => parseArgs([
      '--all-customers', BACKUP_SKIP_CONFIRMATION, '--private-plan', privatePath('skip-dry-run.json'),
    ])).toThrow(/only for apply/)
    expect(() => parseArgs([
      '--all-customers', AUDITLOGS_DELETE_CONFIRMATION, '--private-plan', privatePath('audit-dry-run.json'),
    ])).toThrow(/only for apply/)
  })

  test('requires the audit-log delete acknowledgement before an apply connection', async () => {
    const connect = jest.fn()
    await expect(executeReset({
      args: { ...createApplyArgs('a'.repeat(64)), confirmAuditLogsDelete: false },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies: { connect },
    })).rejects.toMatchObject({ code: 'APPLY_GATES_REQUIRED', committed: false })
    expect(connect).not.toHaveBeenCalled()
  })

  test('rejects the audit-log delete acknowledgement on direct dry-run execution', async () => {
    const parseMongoTargetMock = jest.fn()
    const connect = jest.fn()
    await expect(executeReset({
      args: {
        allCustomers: true,
        apply: false,
        confirmAuditLogsDelete: true,
        privatePlan: privatePath('audit-dry-run-private-plan.json'),
      },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies: { parseMongoTarget: parseMongoTargetMock, connect },
    })).rejects.toMatchObject({ code: 'AUDITLOGS_DELETE_APPLY_ONLY', committed: false })
    expect(parseMongoTargetMock).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  test('keeps the exact 21 disposable, 28 protected, and 49 reviewed collections disjoint', () => {
    expect(() => assertProtectionConfiguration()).not.toThrow()
    expect(DISPOSABLE_COLLECTIONS).toHaveLength(21)
    expect(PROTECTED_COLLECTIONS).toHaveLength(28)
    expect(PROTECTED_COLLECTIONS).toContain('runtime_validation_audit')
    expect(PROTECTED_COLLECTIONS).toContain('runtimevalidationaudits')
    expect(PROTECTED_COLLECTIONS).toContain('knowledge_pack_activations')
    expect(PROTECTED_COLLECTIONS).not.toContain('auditlogs')
    expect(DISPOSABLE_COLLECTIONS.at(-1).collection).toBe('auditlogs')
    const protectedSet = new Set(PROTECTED_COLLECTIONS)
    expect(DISPOSABLE_COLLECTIONS.some(({ collection }) => protectedSet.has(collection))).toBe(false)
  })

  test('parses a credential-independent host fingerprint and enforces the code-owned target', () => {
    const first = parseMongoTarget('mongodb+srv://user-one:secret@cluster.example.test/test?retryWrites=true')
    const second = parseMongoTarget('mongodb+srv://different:credential@cluster.example.test/test')
    expect(first).toEqual(second)
    expect(first.databaseName).toBe('test')
    expect(() => parseMongoTarget('mongodb://localhost:27017')).toThrow(/explicitly name/)
    expect(assertAllowedTarget(ALLOWED_TARGET)).toEqual(ALLOWED_TARGET)
    expect(() => assertAllowedTarget({ ...ALLOWED_TARGET, databaseName: 'production' })).toThrow(/allowlist/)
  })

  test('uses fixed bounded connection and collection-read transport options', async () => {
    const database = { databaseName: 'test' }
    const connect = jest.fn(async () => {})
    const mongooseClient = { connect, connection: { db: database } }

    await expect(connectToResetDatabase('injected-test-uri', { mongooseClient })).resolves.toBe(database)
    expect(connect).toHaveBeenCalledWith('injected-test-uri', {
      autoIndex: false,
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      socketTimeoutMS: SOCKET_TIMEOUT_MS,
      maxPoolSize: 4,
      readConcern: { level: 'majority' },
    })
    expect(SOCKET_TIMEOUT_MS).toBe(120_000)
    expect(READ_BATCH_SIZE).toBe(25)
    expect(MAX_QUERY_TIME_MS).toBe(30_000)
  })

  test('rejects broad credentials and requires exactly scoped apply privileges', async () => {
    const command = jest.fn(async () => ({
      authInfo: {
        authenticatedUserRoles: [{ role: APPLY_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [
          ...PROTECTED_COLLECTIONS.map((collection) => ({
            resource: { db: 'test', collection },
            actions: collection === 'users' || MUTABLE_RETAINED_LOCK_COLLECTIONS.includes(collection)
              ? ['find', 'update']
              : ['find'],
          })),
          ...DISPOSABLE_COLLECTIONS.map(({ collection }) => ({
            resource: { db: 'test', collection },
            actions: ['find', 'remove'],
          })),
          { resource: { db: 'test', collection: '' }, actions: ['listCollections'] },
        ],
      },
    }))
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: true }))
      .resolves.toEqual(expect.objectContaining({ writePrivilegeCollectionCount: 29 }))

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: APPLY_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [
          ...PROTECTED_COLLECTIONS.map((collection) => ({
            resource: { db: 'test', collection },
            actions: collection === 'users'
              || (MUTABLE_RETAINED_LOCK_COLLECTIONS.includes(collection) && collection !== 'uicontracts')
              ? ['find', 'update']
              : ['find'],
          })),
          ...DISPOSABLE_COLLECTIONS.map(({ collection }) => ({
            resource: { db: 'test', collection },
            actions: ['find', 'remove'],
          })),
          { resource: { db: 'test', collection: '' }, actions: ['listCollections'] },
        ],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: true }))
      .rejects.toMatchObject({ code: 'APPLY_PRIVILEGES_INCOMPLETE' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: 'atlasAdmin', db: 'admin' }],
        authenticatedUserPrivileges: [],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: false }))
      .rejects.toMatchObject({ code: 'OVERPRIVILEGED_RESET_CREDENTIAL' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: 'atlasAdmin', db: 'admin' }],
        authenticatedUserPrivileges: [{
          resource: { anyResource: true },
          actions: ['anyAction'],
        }],
      },
    })
    await expect(verifyCredentialScope(
      { admin: () => ({ command }) },
      { apply: false, allowApplicationCredentialReadOnlyRisk: true },
    )).resolves.toEqual(expect.objectContaining({
      credentialMode: 'APPLICATION_CREDENTIAL_READ_ONLY_RISK_ACCEPTED',
      roleCount: 1,
    }))

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: 'atlasAdmin', db: 'admin' }],
        authenticatedUserPrivileges: [],
      },
    })
    await expect(verifyCredentialScope(
      { admin: () => ({ command }) },
      { apply: true, allowApplicationCredentialReadOnlyRisk: true },
    )).rejects.toMatchObject({ code: 'APPLICATION_CREDENTIAL_APPLY_REJECTED' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: APPLY_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [{
          resource: { db: 'test', collection: '' },
          actions: ['find', 'remove'],
        }],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: true }))
      .rejects.toMatchObject({ code: 'OVERPRIVILEGED_RESET_CREDENTIAL' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: APPLY_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [{
          resource: { db: 'test', collection: 'customers' },
          actions: ['find', 'renameCollectionSameDB'],
        }],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: true }))
      .rejects.toMatchObject({ code: 'OVERPRIVILEGED_RESET_CREDENTIAL' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: DRY_RUN_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [
          ...[...PROTECTED_COLLECTIONS, ...DISPOSABLE_COLLECTIONS.map(({ collection }) => collection)]
            .map((collection) => ({
              resource: { db: 'test', collection },
              actions: ['find'],
            })),
          { resource: { db: 'test', collection: '' }, actions: ['listCollections'] },
        ],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: false }))
      .resolves.toEqual(expect.objectContaining({
        readPrivilegeCollectionCount: 49,
        writePrivilegeCollectionCount: 0,
      }))

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: DRY_RUN_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [{
          resource: { db: 'test', collection: '' },
          actions: ['find'],
        }],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: false }))
      .rejects.toMatchObject({ code: 'OVERPRIVILEGED_RESET_CREDENTIAL' })

    command.mockResolvedValueOnce({
      authInfo: {
        authenticatedUserRoles: [{ role: DRY_RUN_CREDENTIAL_ROLE, db: 'admin' }],
        authenticatedUserPrivileges: [{
          resource: { db: 'other', collection: 'rogue' },
          actions: [],
        }],
      },
    })
    await expect(verifyCredentialScope({ admin: () => ({ command }) }, { apply: false }))
      .rejects.toMatchObject({ code: 'OVERPRIVILEGED_RESET_CREDENTIAL' })
  })

  test('builds deterministic independent VMF/runtime roots and sanitizes all identities and content', async () => {
    const fixture = createFixture()
    const reversedFixture = createFixture({ reverse: true })
    const firstDatabase = createMemoryDatabase(fixture.collections)
    const first = await buildResetPlan({ database: firstDatabase })
    const second = await buildResetPlan({ database: createMemoryDatabase(reversedFixture.collections) })

    expect(first.planSha256).toBe(second.planSha256)
    expect(first.exactPlan.entries).toHaveLength(21)
    expect(first.exactPlan.roots.vmfIds).toEqual([String(fixture.vmfId)])
    expect(first.exactPlan.roots.runtimeInstanceIds).toEqual([String(fixture.runtimeId)])
    expect(first.exactPlan.roots.packageIds).toEqual([String(fixture.packageId)])
    expect(first.exactPlan.packageLockState).toHaveLength(7)
    expect(first.exactPlan.packageLockState.every(({ mutationCount }) => mutationCount === 1)).toBe(true)
    expect(first.exactPlan.userGrantState).toEqual(expect.objectContaining({
      matchedUserDocuments: 1,
      expectedModifiedUserDocuments: 1,
      expectedRemovedGrantElements: 1,
    }))
    expect(first.exactPlan.retainedResidue).toEqual(expect.objectContaining({
      runtimeValidationAuditCount: 1,
      runtimeScopedKnowledgePackActivationCount: 1,
      uiContractPackageProvenanceCount: 1,
    }))
    expect(first.exactPlan.retainedResidue).not.toHaveProperty('auditPackageReferences')

    const sanitized = JSON.stringify(sanitizePlan(first))
    expect(sanitized).not.toContain(String(fixture.vmfId))
    expect(sanitized).not.toContain(String(fixture.runtimeId))
    expect(sanitized).not.toContain(String(fixture.packageId))
    expect(sanitized).not.toContain(fixture.packageKey)
    expect(sanitized).not.toContain('private@example.test')
    expect(sanitized).not.toContain('RUNTIME_INSTANCE:')
    const auditRead = firstDatabase.getReads().find(({ collection }) => collection === 'auditlogs')
    expect(auditRead).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        batchSize: READ_BATCH_SIZE,
        maxTimeMS: MAX_QUERY_TIME_MS,
        projection: { _id: 1, ts: 1, signatureVersion: 1, signature: 1 },
      }),
      sort: { _id: 1 },
    }))
    expect(first.exactPlan.auditLogsDelete)
      .toEqual({
        collection: 'auditlogs',
        count: 1,
        digestMode: 'AUDITLOG_DELETE_HMAC_IDENTITY_V1',
        idSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    expect(first.exactPlan.protectedState.some(({ collection }) => collection === 'auditlogs')).toBe(false)
    expect(sanitizePlan(first).auditLogsDelete).toEqual(expect.objectContaining({
      collection: 'auditlogs',
      count: 1,
      digestMode: 'AUDITLOG_DELETE_HMAC_IDENTITY_V1',
      identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(PROTECTED_COLLECTIONS
      .filter((collection) => collection !== 'auditlogs')
      .every((collection) => firstDatabase.getReads().some((read) => (
        read.collection === collection && !read.options.projection
      )))).toBe(true)
  })

  test('derives an exact transaction mutation surface without protected full-content reads', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const readOffset = database.getReads().length
    const session = { transaction: true }

    const surface = await buildResetMutationSurface({ database, session })

    expect(surface).toEqual(mutationSurfaceFromExactPlan(planned.exactPlan))
    expect(surface.entries.map(({ order, collection, root, linkField }) => ({ order, collection, root, linkField })))
      .toEqual(DISPOSABLE_COLLECTIONS.map((config, order) => ({
        order,
        collection: config.collection,
        root: config.root,
        linkField: config.root === 'runtime'
          ? 'runtimeInstanceId'
          : (config.root === 'vmf' ? 'vmfId' : (config.root === 'package' ? 'packageId' : null)),
      })))
    const transactionReads = database.getReads().slice(readOffset)
    expect(transactionReads.length).toBeGreaterThan(0)
    expect(transactionReads.every(({ options }) => options.session === session)).toBe(true)
    expect(transactionReads.some(({ collection }) => collection === 'auditlogs')).toBe(true)
    expect(transactionReads.some(({ collection }) => collection === 'runtime_validation_audit')).toBe(false)
    expect(transactionReads.some(({ collection }) => collection === 'knowledge_pack_activations')).toBe(false)
    const userRead = transactionReads.find(({ collection }) => collection === 'users')
    expect(userRead.options.projection).toEqual({ _id: 1, vmfGrants: 1 })
    expect(transactionReads
      .filter(({ collection }) => PROTECTED_COLLECTIONS.includes(collection))
      .every(({ options }) => Boolean(options.projection))).toBe(true)
  })

  test('fingerprints only valid signed AuditLog identities and keeps other protected digests full-content', async () => {
    const baseFixture = createFixture()
    const base = await buildResetPlan({ database: createMemoryDatabase(baseFixture.collections) })
    const baseAudit = base.exactPlan.auditLogsDelete

    const legacyFixture = createFixture()
    delete legacyFixture.collections.auditlogs[0].signatureVersion
    const legacy = await buildResetPlan({ database: createMemoryDatabase(legacyFixture.collections) })
    const explicitV1Fixture = createFixture()
    explicitV1Fixture.collections.auditlogs[0].signatureVersion = 1
    const explicitV1 = await buildResetPlan({ database: createMemoryDatabase(explicitV1Fixture.collections) })
    expect(legacy.exactPlan.auditLogsDelete)
      .toEqual(explicitV1.exactPlan.auditLogsDelete)

    const auditMutations = [
      { _id: objectId(701) },
      { ts: new Date('2026-08-19T10:00:01.000Z') },
      { signatureVersion: 2 },
      { signature: 'b'.repeat(64) },
    ]
    for (const mutation of auditMutations) {
      const fixture = createFixture()
      Object.assign(fixture.collections.auditlogs[0], mutation)
      const planned = await buildResetPlan({ database: createMemoryDatabase(fixture.collections) })
      expect(planned.exactPlan.auditLogsDelete.identitySha256)
        .not.toBe(baseAudit.identitySha256)
    }

    const addedFixture = createFixture()
    addedFixture.collections.auditlogs.push(auditLog({ _id: objectId(702), signature: 'c'.repeat(64) }))
    const added = await buildResetPlan({ database: createMemoryDatabase(addedFixture.collections) })
    expect(added.exactPlan.auditLogsDelete.identitySha256)
      .not.toBe(baseAudit.identitySha256)

    const removedFixture = createFixture()
    removedFixture.collections.auditlogs = []
    const removed = await buildResetPlan({ database: createMemoryDatabase(removedFixture.collections) })
    expect(removed.exactPlan.auditLogsDelete.identitySha256)
      .not.toBe(baseAudit.identitySha256)

    const unsignedPayloadFixture = createFixture()
    unsignedPayloadFixture.collections.auditlogs[0].diff = { changedWithoutSignatureChange: true }
    const unsignedPayload = await buildResetPlan({
      database: createMemoryDatabase(unsignedPayloadFixture.collections),
    })
    expect(unsignedPayload.exactPlan.auditLogsDelete)
      .toEqual(baseAudit)

    const orderedFixture = createFixture()
    orderedFixture.collections.auditlogs.push(auditLog({ _id: objectId(703), signature: 'e'.repeat(64) }))
    const reverseOrderedFixture = createFixture()
    reverseOrderedFixture.collections.auditlogs = [...orderedFixture.collections.auditlogs].reverse()
    const ordered = await buildResetPlan({ database: createMemoryDatabase(orderedFixture.collections) })
    const reverseOrdered = await buildResetPlan({
      database: createMemoryDatabase(reverseOrderedFixture.collections),
    })
    expect(ordered.exactPlan.auditLogsDelete)
      .toEqual(reverseOrdered.exactPlan.auditLogsDelete)

    const protectedContentFixture = createFixture()
    protectedContentFixture.collections.customers[0].status = 'SUSPENDED'
    const protectedContent = await buildResetPlan({
      database: createMemoryDatabase(protectedContentFixture.collections),
    })
    expect(protectedContent.exactPlan.protectedState.find(({ collection }) => collection === 'customers').sha256)
      .not.toBe(base.exactPlan.protectedState.find(({ collection }) => collection === 'customers').sha256)

    const invalidRows = [
      { signature: undefined },
      { signature: 'A'.repeat(64) },
      { signature: ` ${'a'.repeat(64)}` },
      { _id: 'not-an-object-id' },
      { _id: '000000000000000000000001' },
      { ts: new Date('invalid') },
      { signatureVersion: 4 },
      { signatureVersion: 1.0.toString() },
    ]
    for (const invalidRow of invalidRows) {
      const fixture = createFixture()
      Object.assign(fixture.collections.auditlogs[0], invalidRow)
      await expect(buildResetPlan({ database: createMemoryDatabase(fixture.collections) }))
        .rejects.toMatchObject({ code: expect.stringMatching(/^AUDIT_/) })
    }

    const duplicateFixture = createFixture()
    duplicateFixture.collections.auditlogs.push(auditLog())
    await expect(buildResetPlan({ database: createMemoryDatabase(duplicateFixture.collections) }))
      .rejects.toMatchObject({ code: 'AUDIT_IDENTITY_INVALID' })
  })

  test('fails closed for orphan descendants and unreviewed collections', async () => {
    await expect(buildResetPlan({
      database: createMemoryDatabase(createFixture({ orphanChild: true }).collections),
    })).rejects.toMatchObject({ code: 'DESCENDANT_OUTSIDE_ROOT_CLOSURE' })

    await expect(buildResetPlan({
      database: createMemoryDatabase(createFixture({ unknownCollection: true }).collections),
    })).rejects.toMatchObject({ code: 'UNKNOWN_COLLECTIONS' })

    const missingFixture = createFixture()
    delete missingFixture.collections.auditlogs
    await expect(buildResetPlan({
      database: createMemoryDatabase(missingFixture.collections),
    })).rejects.toMatchObject({ code: 'MISSING_REVIEWED_COLLECTIONS' })
  })

  test('fails closed for package-lineage mismatches and references outside the closed component', async () => {
    const mismatched = createFixture()
    mismatched.collections.runtime_deployments[0].packageKey = 'different-package'
    await expect(buildResetPlan({ database: createMemoryDatabase(mismatched.collections) }))
      .rejects.toMatchObject({ code: 'PACKAGE_LINEAGE_MISMATCH' })

    const external = createFixture()
    external.collections.runtime_activation_snapshots[0].supersededByActivationId = 'external-activation'
    await expect(buildResetPlan({ database: createMemoryDatabase(external.collections) }))
      .rejects.toMatchObject({ code: 'PACKAGE_LINEAGE_OUTSIDE_CLOSURE' })

    const duplicate = createFixture()
    duplicate.collections.runtime_activation_snapshots.push({
      ...cloneValue(duplicate.collections.runtime_activation_snapshots[0]),
      _id: objectId(888),
    })
    await expect(buildResetPlan({ database: createMemoryDatabase(duplicate.collections) }))
      .rejects.toMatchObject({ code: 'PACKAGE_LINEAGE_DUPLICATE' })
  })

  test('fails closed for malformed, orphaned, non-reciprocal, and duplicate package lineage identities', async () => {
    const cases = []

    const malformedPackageId = createFixture()
    malformedPackageId.collections.frameworkpackages[0]._id = String(malformedPackageId.packageId)
    cases.push([malformedPackageId, 'PACKAGE_LINEAGE_INVALID'])

    const malformedChildId = createFixture()
    malformedChildId.collections.runtime_deployments[0].packageId = String(malformedChildId.packageId)
    cases.push([malformedChildId, 'PACKAGE_LINEAGE_INVALID'])

    const orphanDeployment = createFixture()
    orphanDeployment.collections.runtime_deployments[0].packageId = objectId(880)
    cases.push([orphanDeployment, 'PACKAGE_LINEAGE_ORPHAN'])

    const orphanSnapshot = createFixture()
    orphanSnapshot.collections.runtime_activation_snapshots[0].packageId = objectId(881)
    cases.push([orphanSnapshot, 'PACKAGE_LINEAGE_ORPHAN'])

    const deploymentWithoutSnapshot = createFixture()
    deploymentWithoutSnapshot.collections.runtime_deployments[0].activationId = 'missing-snapshot'
    cases.push([deploymentWithoutSnapshot, 'PACKAGE_LINEAGE_MISMATCH'])

    const snapshotWithoutDeployment = createFixture()
    snapshotWithoutDeployment.collections.runtime_activation_snapshots[0].deploymentId = 'missing-deployment'
    cases.push([snapshotWithoutDeployment, 'PACKAGE_LINEAGE_MISMATCH'])

    const duplicatePackageKey = createFixture()
    duplicatePackageKey.collections.frameworkpackages.push({
      ...cloneValue(duplicatePackageKey.collections.frameworkpackages[0]),
      _id: objectId(882),
    })
    cases.push([duplicatePackageKey, 'PACKAGE_LINEAGE_DUPLICATE'])

    const duplicateDeploymentIdentity = createFixture()
    duplicateDeploymentIdentity.collections.runtime_deployments.push({
      ...cloneValue(duplicateDeploymentIdentity.collections.runtime_deployments[0]),
      _id: objectId(883),
    })
    cases.push([duplicateDeploymentIdentity, 'PACKAGE_LINEAGE_DUPLICATE'])

    for (const [fixture, code] of cases) {
      await expect(buildResetPlan({ database: createMemoryDatabase(fixture.collections) }))
        .rejects.toMatchObject({ code })
    }
  })

  test('rejects malformed package lock state and the fixed 1000-document ceiling', async () => {
    const malformed = createFixture()
    malformed.collections.runtimeagents[0].lockedByPackageKeys = [malformed.packageKey, malformed.packageKey]
    await expect(buildResetPlan({ database: createMemoryDatabase(malformed.collections) }))
      .rejects.toMatchObject({ code: 'PACKAGE_LOCK_STATE_INVALID' })

    const aboveLimit = createFixture()
    const template = aboveLimit.collections.runtimepathregistries[0]
    aboveLimit.collections.runtimepathregistries = Array.from(
      { length: MAX_PACKAGE_LOCK_MUTATION_DOCUMENTS - 5 },
      (_, index) => ({ ...cloneValue(template), _id: objectId(2000 + index) }),
    )
    await expect(buildResetPlan({ database: createMemoryDatabase(aboveLimit.collections) }))
      .rejects.toMatchObject({ code: 'PACKAGE_LOCK_MUTATION_LIMIT_EXCEEDED' })
  })

  test('keeps empty and unrelated package-lock states outside the mutation set', async () => {
    const fixture = createFixture()
    fixture.collections.runtimeagents[0] = {
      _id: fixture.collections.runtimeagents[0]._id,
      stableId: 'empty-lock-state',
      lockedByPackageKeys: [],
    }
    fixture.collections.runtimepathregistries[0].lockedByPackageKeys = ['unrelated-package']

    const planned = await buildResetPlan({ database: createMemoryDatabase(fixture.collections) })
    const empty = planned.exactPlan.packageLockState.find(({ collection }) => collection === 'runtimeagents')
    const unrelated = planned.exactPlan.packageLockState.find(({ collection }) => collection === 'runtimepathregistries')

    expect(empty).toEqual(expect.objectContaining({ mutationCount: 0 }))
    expect(empty.beforeCollectionLockSha256).toBe(empty.afterCollectionLockSha256)
    expect(unrelated).toEqual(expect.objectContaining({ mutationCount: 0 }))
    expect(unrelated.beforeCollectionLockSha256).toBe(unrelated.afterCollectionLockSha256)
  })

  test('validates a recent hash-bound isolated restore with exact collection counts', async () => {
    const now = new Date('2026-08-19T12:00:00.000Z')
    const planSha256 = 'a'.repeat(64)
    const exactPlan = {
      schemaVersion: RESET_PLAN_SCHEMA_VERSION,
      entries: [{ collection: 'vmfs', count: 1 }],
      protectedState: [{ collection: 'customers', count: 1 }],
    }
    const manifest = createBackupManifest({ planSha256, exactPlan, now })
    await expect(validateBackupManifest({
      manifest,
      exactPlan,
      planSha256,
      backupSha256: BACKUP_SHA,
      now,
      hashFileFn: async () => BACKUP_SHA,
    })).resolves.toEqual(expect.objectContaining({ backupSha256: BACKUP_SHA }))

    await expect(validateBackupManifest({
      manifest: createBackupManifest({
        planSha256,
        exactPlan,
        now,
        restoreCounts: { customers: 1, vmfs: 0 },
      }),
      exactPlan,
      planSha256,
      backupSha256: BACKUP_SHA,
      now,
      hashFileFn: async () => BACKUP_SHA,
    })).rejects.toMatchObject({ code: 'BACKUP_COLLECTION_COUNT_MISMATCH' })

    const stale = createBackupManifest({ planSha256, exactPlan, now })
    stale.source.completedAt = new Date(now.getTime() - (25 * 60 * 60 * 1000)).toISOString()
    await expect(validateBackupManifest({
      manifest: stale,
      exactPlan,
      planSha256,
      backupSha256: BACKUP_SHA,
      now,
      hashFileFn: async () => BACKUP_SHA,
    })).rejects.toMatchObject({ code: 'BACKUP_TOO_OLD' })

    const falseSourceCounts = createBackupManifest({
      planSha256,
      exactPlan,
      now,
      sourceCounts: { customers: 1, vmfs: 0 },
      restoreCounts: { customers: 1, vmfs: 0 },
    })
    await expect(validateBackupManifest({
      manifest: falseSourceCounts,
      exactPlan,
      planSha256,
      backupSha256: BACKUP_SHA,
      now,
      hashFileFn: async () => BACKUP_SHA,
    })).rejects.toMatchObject({ code: 'BACKUP_SOURCE_PLAN_COUNT_MISMATCH' })
  })

  test('rejects v1, v2, and v3 private plans before connection or mutation', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    for (const schemaVersion of [
      'storylineos.development-customer-vmf-reset-plan.v1',
      'storylineos.development-customer-vmf-reset-plan.v2',
      'storylineos.development-customer-vmf-reset-plan.v3',
    ]) {
      const connect = jest.fn()
      await expect(executeReset({
        args: createApplyArgs(planned.planSha256),
        env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
        dependencies: {
          parseMongoTarget: () => ({ databaseName: 'test', hostSha256: ALLOWED_TARGET.hostSha256 }),
          assertAllowedTarget: () => ALLOWED_TARGET,
          connect,
          readJsonFile: jest.fn(async () => ({ ...planned.exactPlan, schemaVersion })),
        },
      })).rejects.toMatchObject({ code: 'PRIVATE_PLAN_SCHEMA_INVALID', committed: false })
      expect(connect).not.toHaveBeenCalled()
    }
    expect(database.getWrites()).toEqual([])
  })

  test('default execution is read-only and writes only the private exact plan', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const durableWriteJson = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const result = await executeReset({
      args: {
        allCustomers: true,
        apply: false,
        privatePlan: privatePath('dry-run-private-plan.json'),
      },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies: {
        parseMongoTarget: () => ({ databaseName: 'test', hostSha256: ALLOWED_TARGET.hostSha256 }),
        assertAllowedTarget: () => ALLOWED_TARGET,
        connect: async () => database,
        disconnect,
        durableWriteJson,
        verifyCredentialScope: jest.fn(async () => ({ writePrivilegeCollectionCount: 0 })),
      },
    })

    expect(result.mode).toBe('DRY_RUN')
    expect(database.getWrites()).toEqual([])
    expect(durableWriteJson).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  test('application credential exception is read-only and cannot enter apply', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const durableWriteJson = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const startSession = jest.fn()
    const invalidatePermissionCache = jest.fn()
    const verifyCredentialScopeMock = jest.fn(async () => ({
      credentialMode: 'APPLICATION_CREDENTIAL_READ_ONLY_RISK_ACCEPTED',
      roleCount: 1,
      roleEvidenceSha256: 'a'.repeat(64),
      privilegeEvidenceSha256: 'b'.repeat(64),
      writePrivilegeCollectionCount: null,
    }))
    const injectedSecret = 'mongodb+srv://application-user:do-not-print@cluster.example.test/test'
    const result = await executeReset({
      args: {
        allCustomers: true,
        apply: false,
        confirmApplicationCredentialReadOnlyRisk: true,
        privatePlan: privatePath('risk-dry-run-private-plan.json'),
      },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: injectedSecret },
      dependencies: {
        parseMongoTarget: () => ({ databaseName: 'test', hostSha256: ALLOWED_TARGET.hostSha256 }),
        assertAllowedTarget: () => ALLOWED_TARGET,
        connect: async () => database,
        disconnect,
        durableWriteJson,
        verifyCredentialScope: verifyCredentialScopeMock,
        startSession,
        invalidatePermissionCache,
      },
    })

    expect(result).toEqual(expect.objectContaining({
      mode: 'DRY_RUN',
      credentialMode: 'APPLICATION_CREDENTIAL_READ_ONLY_RISK_ACCEPTED',
    }))
    expect(JSON.stringify(result)).not.toContain(injectedSecret)
    expect(JSON.stringify(durableWriteJson.mock.calls)).not.toContain(injectedSecret)
    expect(verifyCredentialScopeMock).toHaveBeenCalledWith(database, {
      apply: false,
      allowApplicationCredentialReadOnlyRisk: true,
    })
    expect(database.getWrites()).toEqual([])
    expect(durableWriteJson).toHaveBeenCalledTimes(1)
    expect(startSession).not.toHaveBeenCalled()
    expect(invalidatePermissionCache).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledTimes(1)

    const connect = jest.fn()
    await expect(executeReset({
      args: {
        ...createApplyArgs('c'.repeat(64)),
        confirmApplicationCredentialReadOnlyRisk: true,
      },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: injectedSecret },
      dependencies: { connect, startSession, invalidatePermissionCache },
    })).rejects.toMatchObject({ code: 'APPLICATION_CREDENTIAL_APPLY_REJECTED' })
    expect(connect).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('redacts the active URI and MongoDB credentials from failure output', async () => {
    const injectedSecret = 'mongodb+srv://application-user:super-secret-password@cluster.example.test/test'
    const nestedUri = 'mongodb://nested-user:nested-password@localhost:27017/test'
    const connectionError = new Error(`Connection failed for ${injectedSecret}`)
    connectionError.code = 'DRIVER_CONNECTION_FAILED'
    connectionError.details = {
      attemptedUri: injectedSecret,
      nested: { diagnostic: `driver retried ${nestedUri}` },
    }
    connectionError.cause = new Error(`Authentication rejected super-secret-password via ${injectedSecret}`)

    let thrown
    try {
      await executeReset({
        args: {
          allCustomers: true,
          apply: false,
          confirmApplicationCredentialReadOnlyRisk: true,
          privatePlan: privatePath('risk-failure-private-plan.json'),
        },
        env: { NODE_ENV: 'development', MONGODB_RESET_URI: injectedSecret },
        dependencies: {
          parseMongoTarget: () => ({ databaseName: 'test', hostSha256: ALLOWED_TARGET.hostSha256 }),
          assertAllowedTarget: () => ALLOWED_TARGET,
          connect: async () => { throw connectionError },
        },
      })
    } catch (error) {
      thrown = error
    }

    const output = JSON.stringify(serializeErrorForOutput(thrown, { activeUri: injectedSecret }))
    expect(output).toContain('[REDACTED_MONGODB_URI]')
    expect(output).not.toContain(injectedSecret)
    expect(output).not.toContain(nestedUri)
    expect(output).not.toContain('super-secret-password')
    expect(output).not.toContain('nested-password')
  })

  test('applies child-first transactionally, removes exact grants, reconciles, and reports', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const manifest = createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan })
    const writes = []
    const durableWriteJson = jest.fn(async (_filePath, value) => { writes.push(value) })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest,
      durableWriteJson,
    })

    const result = await executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })

    expect(result.status).toBe('COMMITTED_RECONCILED')
    expect(database.getDocuments('vmfs')).toHaveLength(0)
    expect(database.getDocuments('runtime_instances')).toHaveLength(0)
    expect(database.getDocuments('users')[0].vmfGrants).toHaveLength(0)
    expect(database.getDocuments('knowledge_pack_activations')).toHaveLength(1)
    expect(database.getDocuments('runtime_validation_audit')).toHaveLength(1)
    expect(database.getDocuments('frameworkpackages')).toHaveLength(0)
    expect(database.getDocuments('runtime_deployments')).toHaveLength(0)
    expect(database.getDocuments('runtime_activation_snapshots')).toHaveLength(0)
    expect(database.getDocuments('auditlogs')).toHaveLength(0)
    for (const collection of MUTABLE_RETAINED_LOCK_COLLECTIONS) {
      expect(database.getDocuments(collection)[0]).toEqual(expect.objectContaining({
        lockedByPackageKeys: [],
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
        lockedReason: '',
      }))
    }
    expect(database.getDocuments('uicontracts')[0].sourcePackageKey).toBe(createFixture().packageKey)
    const bulkWrites = database.getWrites().filter(({ operation }) => operation === 'bulkWrite')
    expect(bulkWrites.map(({ collection }) => collection)).toEqual(MUTABLE_RETAINED_LOCK_COLLECTIONS)
    expect(bulkWrites.every(({ options }) => options.ordered === true && options.session)).toBe(true)
    const deleteOrder = database.getWrites()
      .filter(({ operation }) => operation === 'deleteMany')
      .map(({ collection }) => collection)
    expect(deleteOrder).toEqual(DISPOSABLE_COLLECTIONS.map(({ collection }) => collection))
    expect(deleteOrder.indexOf('runtime_output_assets')).toBeLessThan(deleteOrder.indexOf('runtime_output_requests'))
    expect(deleteOrder.indexOf('outcome_messages')).toBeLessThan(deleteOrder.indexOf('outcome_sessions'))
    expect(deleteOrder.indexOf('outcome_draft_iterations')).toBeLessThan(deleteOrder.indexOf('outcome_drafts'))
    expect(deleteOrder.indexOf('outcome_asset_versions')).toBeLessThan(deleteOrder.indexOf('outcome_assets'))
    expect(deleteOrder.indexOf('outcome_quality_stage_executions')).toBeLessThan(deleteOrder.indexOf('outcome_knowledge_composition_plans'))
    expect(deleteOrder.indexOf('governed_runtime_artifacts')).toBeLessThan(deleteOrder.indexOf('governed_reasoning_executions'))
    expect(deleteOrder.slice(-7)).toEqual([
      'deals',
      'runtime_instances',
      'vmfs',
      'runtime_deployments',
      'runtime_activation_snapshots',
      'frameworkpackages',
      'auditlogs',
    ])
    const sessionReads = database.getReads().filter(({ options }) => Boolean(options.session))
    expect(sessionReads.some(({ collection }) => collection === 'auditlogs')).toBe(true)
    expect(sessionReads.some(({ collection }) => collection === 'runtime_validation_audit')).toBe(false)
    expect(sessionReads.some(({ collection, options }) => (
      PROTECTED_COLLECTIONS.includes(collection) && !options.projection
    ))).toBe(false)
    expect(database.getReads().some(({ collection, options }) => (
      collection === 'auditlogs' && !options.session
    ))).toBe(true)
    expect(durableWriteJson).toHaveBeenCalledTimes(2)
    expect(writes[0]).toEqual(expect.objectContaining({
      backupSha256: BACKUP_SHA,
      backupVerification: {
        status: 'VERIFIED',
        restoreConfirmationSupplied: true,
      },
      confirmations: expect.objectContaining({ restoreVerified: true }),
      auditLogsDelete: expect.objectContaining({
        status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
        count: 1,
      }),
    }))
    expect(writes[1]).toEqual(expect.objectContaining({
      backupSha256: BACKUP_SHA,
      backupVerification: {
        status: 'VERIFIED',
        restoreConfirmationSupplied: true,
      },
      auditLogsDelete: expect.objectContaining({
        status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
        count: 1,
        remainingCount: 0,
      }),
    }))
    expect(dependencies.invalidatePermissionCache).toHaveBeenCalledTimes(1)
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })

  test('supports explicit backup-verification skip without reading or hashing a backup', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const writes = []
    const durableWriteJson = jest.fn(async (_filePath, value) => { writes.push(value) })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: null,
      durableWriteJson,
    })
    const args = {
      ...createApplyArgs(planned.planSha256),
      backupManifest: '',
      backupSha256: '',
      confirmBackupVerificationSkipped: true,
    }

    const result = await executeReset({
      args,
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })

    expect(result.status).toBe('COMMITTED_RECONCILED')
    expect(dependencies.readJsonFile).toHaveBeenCalledTimes(1)
    expect(dependencies.readJsonFile.mock.calls[0][0]).toContain('private-plan.json')
    expect(dependencies.hashFile).not.toHaveBeenCalled()
    expect(writes).toHaveLength(2)
    expect(writes[0]).toEqual(expect.objectContaining({
      backupSha256: null,
      backupVerification: {
        status: 'SKIPPED_BY_EXPLICIT_ACKNOWLEDGEMENT',
        restoreConfirmationSupplied: true,
      },
      confirmations: expect.objectContaining({ restoreVerified: false }),
      auditLogsDelete: expect.objectContaining({
        status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
        count: 1,
      }),
    }))
    expect(writes[1]).toEqual(expect.objectContaining({
      backupSha256: null,
      backupVerification: {
        status: 'SKIPPED_BY_EXPLICIT_ACKNOWLEDGEMENT',
        restoreConfirmationSupplied: true,
      },
      auditLogsDelete: expect.objectContaining({
        status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
        remainingCount: 0,
      }),
    }))
  })

  test('rejects invalid backup modes before URI parsing or connection', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const parseMongoTargetMock = jest.fn(() => ({
      databaseName: ALLOWED_TARGET.databaseName,
      hostSha256: ALLOWED_TARGET.hostSha256,
    }))
    const dependencies = createExecutionDependencies({ database, exactPlan: planned.exactPlan })
    dependencies.parseMongoTarget = parseMongoTargetMock
    const baseArgs = createApplyArgs(planned.planSha256)

    await expect(executeReset({
      args: { ...baseArgs, backupManifest: '', backupSha256: '' },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'BACKUP_VERIFICATION_REQUIRED' })

    await expect(executeReset({
      args: { ...baseArgs, confirmBackupVerificationSkipped: true },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'BACKUP_MODES_CONFLICT' })

    await expect(executeReset({
      args: { ...baseArgs, backupSha256: '' },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'BACKUP_ARGUMENTS_INCOMPLETE' })

    await expect(executeReset({
      args: { ...baseArgs, backupManifest: '' },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'BACKUP_ARGUMENTS_INCOMPLETE' })

    await expect(executeReset({
      args: { ...baseArgs, backupSha256: 'not-a-sha256' },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'INVALID_SHA256' })

    await expect(executeReset({
      args: {
        ...baseArgs,
        apply: false,
        confirmAuditLogsDelete: false,
        confirmBackupVerificationSkipped: true,
        backupManifest: '',
        backupSha256: '',
      },
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'must-not-be-read' },
      dependencies,
    })).rejects.toMatchObject({ code: 'BACKUP_SKIP_APPLY_ONLY' })

    expect(parseMongoTargetMock).not.toHaveBeenCalled()
    expect(dependencies.connect).not.toHaveBeenCalled()
  })

  test('keeps driver-managed transaction callback retries local and externally single-effect', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setTransactionCallbackAttempts(2)
    const durableWriteJson = jest.fn(async () => {})
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
      durableWriteJson,
    })

    const result = await executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })

    expect(result.status).toBe('COMMITTED_RECONCILED')
    expect(database.getDocuments('frameworkpackages')).toHaveLength(0)
    expect(database.getWrites().filter(({ operation }) => operation === 'bulkWrite')).toHaveLength(14)
    expect(dependencies.invalidatePermissionCache).toHaveBeenCalledTimes(1)
    expect(durableWriteJson).toHaveBeenCalledTimes(2)
  })

  test('preserves unrelated package locks and their four metadata fields', async () => {
    const fixture = createFixture()
    const row = fixture.collections.runtimeagents[0]
    row.lockedByPackageKeys = ['retained-package', fixture.packageKey]
    const beforeMetadata = {
      isLocked: row.isLocked,
      lockedBy: row.lockedBy,
      lockedAt: row.lockedAt,
      lockedReason: row.lockedReason,
    }
    const database = createMemoryDatabase(fixture.collections)
    const planned = await buildResetPlan({ database })
    const session = database.createSession()

    await session.withTransaction(() => applyExactPlan({ database, exactPlan: planned.exactPlan, session }))

    expect(database.getDocuments('runtimeagents')[0]).toEqual(expect.objectContaining({
      lockedByPackageKeys: ['retained-package'],
      ...beforeMetadata,
    }))
  })

  test('distinguishes missing lock metadata from persisted null in exact bulk predicates', async () => {
    const fixture = createFixture()
    delete fixture.collections.runtimeagents[0].lockedAt
    const database = createMemoryDatabase(fixture.collections)
    const planned = await buildResetPlan({ database })
    database.getDocuments('runtimeagents')[0].lockedAt = null
    const session = database.createSession()

    await expect(session.withTransaction(() => applyExactPlan({
      database,
      exactPlan: planned.exactPlan,
      session,
    }))).rejects.toMatchObject({ code: 'PACKAGE_LOCK_UPDATE_MISMATCH' })
    expect(database.getDocuments('frameworkpackages')).toHaveLength(1)
  })

  test('models rollback on a mid-delete failure and never invalidates cache', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setFailureCollection('outcome_messages')
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toThrow(/forced outcome_messages failure/)

    expect(database.getDocuments('vmfs')).toHaveLength(1)
    expect(database.getDocuments('runtime_instances')).toHaveLength(1)
    expect(database.getDocuments('users')[0].vmfGrants).toHaveLength(1)
    expect(database.getDocuments('runtimeagents')[0].lockedByPackageKeys).toEqual(['vmf-reset-package'])
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })

  test('rolls back all earlier mutations when the final AuditLog delete fails', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setFailureCollection('auditlogs')
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toThrow(/forced auditlogs failure/)

    expect(database.getDocuments('frameworkpackages')).toHaveLength(1)
    expect(database.getDocuments('auditlogs')).toHaveLength(1)
    expect(database.getDocuments('users')[0].vmfGrants).toHaveLength(1)
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('aborts inside the transaction when AuditLogs reappear before reconciliation', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setAfterAuditLogDelete((targetDatabase) => {
      targetDatabase.getDocuments('auditlogs').push(auditLog({ _id: objectId(805), signature: 'g'.repeat(64) }))
    })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({ code: 'RECONCILIATION_RESIDUE', committed: false })

    expect(database.getDocuments('frameworkpackages')).toHaveLength(1)
    expect(database.getDocuments('auditlogs')).toHaveLength(1)
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('rolls back earlier package-lock bulk writes when a later bulk collection fails', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setFailureCollection('validationregistries')
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toThrow(/forced validationregistries failure/)

    expect(database.getDocuments('runtimeagents')[0].lockedByPackageKeys).toEqual(['vmf-reset-package'])
    expect(database.getDocuments('frameworkpackages')).toHaveLength(1)
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('models rollback on the user-grant update failure and never starts deletes or cache invalidation', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setFailureCollection('users')
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toThrow(/forced users failure/)

    expect(database.getDocuments('users')[0].vmfGrants).toHaveLength(1)
    expect(database.getWrites()).toEqual([])
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('rejects a stale plan when protected state changes before the transaction', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.getDocuments('auditlogs').push(auditLog({
      _id: objectId(800),
      signature: 'd'.repeat(64),
    }))
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({ code: 'STALE_PLAN', committed: false })
    expect(dependencies.startSession).not.toHaveBeenCalled()
    expect(database.getWrites()).toEqual([])
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('rejects immutable retained lock-collection content drift before the transaction', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.getDocuments('runtimeagents')[0].stableId = 'changed-before-transaction'
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({ code: 'STALE_PLAN', committed: false })
    expect(dependencies.startSession).not.toHaveBeenCalled()
    expect(database.getWrites()).toEqual([])
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test.each([
    ['root ID', (database) => { database.getDocuments('vmfs')[0]._id = objectId(810) }],
    ['root scope identity', (database) => { database.getDocuments('runtime_instances')[0].customerId = objectId(999) }],
    ['descendant ID', (database) => { database.getDocuments('outcome_messages')[0]._id = objectId(811) }],
    ['descendant link', (database) => { database.getDocuments('outcome_messages')[0].runtimeInstanceId = objectId(999) }],
    ['matched user ID', (database) => { database.getDocuments('users')[0]._id = objectId(812) }],
    ['target grant multiplicity', (database) => {
      database.getDocuments('users')[0].vmfGrants.push(cloneValue(database.getDocuments('users')[0].vmfGrants[0]))
    }],
    ['collection count', (database, fixture) => {
      database.getDocuments('deals').push({
        _id: objectId(813),
        vmfId: fixture.vmfId,
        customerId: fixture.customerId,
        tenantId: fixture.tenantId,
      })
    }],
  ])('rejects %s mutation-surface drift inside the transaction before the first write', async (_label, mutate) => {
    const fixture = createFixture()
    const database = createMemoryDatabase(fixture.collections)
    const planned = await buildResetPlan({ database })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })
    dependencies.startSession.mockImplementationOnce(async () => {
      mutate(database, fixture)
      return database.createSession()
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({ code: 'STALE_PLAN', committed: false })

    expect(database.getWrites()).toEqual([])
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('rejects reviewed mutation entries that do not preserve governed child-first order', async () => {
    const planned = await buildResetPlan({ database: createMemoryDatabase(createFixture().collections) })
    const reordered = cloneValue(planned.exactPlan)
    ;[reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]]
    expect(() => mutationSurfaceFromExactPlan(reordered))
      .toThrow(/child-first configuration/)
  })

  test('reports committed-with-reconciliation-failure for a write-pause violation', async () => {
    const fixture = createFixture()
    const database = createMemoryDatabase(fixture.collections)
    const planned = await buildResetPlan({ database })
    database.setAfterTransaction(() => {
      database.getDocuments('vmfs').push({
        _id: objectId(801),
        customerId: fixture.customerId,
        tenantId: fixture.tenantId,
      })
    })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_RECONCILIATION_FAILURE',
      committed: true,
    })
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('reports committed-with-reconciliation-failure when protected content drifts after commit', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setAfterTransaction(() => {
      database.getDocuments('roles').push({ _id: objectId(803), name: 'unexpected-protected-change' })
    })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_RECONCILIATION_FAILURE',
      committed: true,
    })
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('reports committed-with-reconciliation-failure when immutable retained lock-collection content drifts after commit', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setAfterTransaction(() => {
      database.getDocuments('runtimeagents')[0].stableId = 'changed-after-commit'
    })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_RECONCILIATION_FAILURE',
      committed: true,
    })
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('reports committed-with-reconciliation-failure when AuditLogs reappear after commit', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    database.setAfterTransaction(() => {
      database.getDocuments('auditlogs').push(auditLog({ _id: objectId(804), signature: 'f'.repeat(64) }))
    })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_RECONCILIATION_FAILURE',
      committed: true,
    })
    expect(dependencies.invalidatePermissionCache).not.toHaveBeenCalled()
  })

  test('reports committed-with-cache-failure only after successful reconciliation', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
      invalidatePermissionCache: jest.fn(async () => ({ redisPatternDeleteFailed: true })),
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_CACHE_INVALIDATION_FAILURE',
      committed: true,
    })
    expect(database.getDocuments('vmfs')).toHaveLength(0)
  })

  test('surfaces post-commit evidence failure without claiming rollback', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    const durableWriteJson = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('evidence disk unavailable'))
    const dependencies = createExecutionDependencies({
      database,
      exactPlan: planned.exactPlan,
      manifest: createBackupManifest({ planSha256: planned.planSha256, exactPlan: planned.exactPlan }),
      durableWriteJson,
    })

    await expect(executeReset({
      args: createApplyArgs(planned.planSha256),
      env: { NODE_ENV: 'development', MONGODB_RESET_URI: 'injected-test-uri' },
      dependencies,
    })).rejects.toMatchObject({
      code: 'COMMITTED_WITH_EVIDENCE_FAILURE',
      committed: true,
    })
    expect(database.getDocuments('vmfs')).toHaveLength(0)
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })

  test('detects exact user-grant update count mismatches before deletion', async () => {
    const database = createMemoryDatabase(createFixture().collections)
    const planned = await buildResetPlan({ database })
    planned.exactPlan.userGrantState.expectedModifiedUserDocuments = 2
    const session = database.createSession()
    await expect(session.withTransaction(() => applyExactPlan({
      database,
      exactPlan: planned.exactPlan,
      session,
    }))).rejects.toMatchObject({ code: 'USER_GRANT_UPDATE_MISMATCH' })
    expect(database.getDocuments('vmfs')).toHaveLength(1)
  })

  test('canonical hashing is stable for object key order but not changed values', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
    expect(hashCanonical({ b: 2, a: 1 })).toBe(hashCanonical({ a: 1, b: 2 }))
    expect(hashCanonical({ a: 2 })).not.toBe(hashCanonical({ a: 1 }))
  })
})
