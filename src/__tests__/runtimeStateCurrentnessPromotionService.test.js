import { jest } from '@jest/globals'

import {
  SS014_CURRENTNESS_CONTRACT,
  SS014_CURRENTNESS_ERROR_CODES,
  buildSs014CurrentnessTransitionPlan,
  createSs014CurrentnessWriterContext,
  promoteRuntimeStateCurrentnessTransaction,
} from '../services/runtimeStateCurrentnessPromotionService.js'

const ids = {
  runtimeInstanceId: '64b000000000000000000001',
  customerId: '64b000000000000000000002',
  tenantId: '64b000000000000000000003',
  migrationReceiptId: '64b000000000000000000004',
}
const scope = {
  ...ids,
  runtimeInstanceKey: 'runtime-one',
  stateVersion: 'rsv2:12345678-1234-4123-8123-123456789abc',
}
const hashes = {
  sections: `sha256:${'1'.repeat(64)}`,
  evidencePack: `sha256:${'2'.repeat(64)}`,
  intelligenceGraph: `sha256:${'3'.repeat(64)}`,
}
const sourceSetHash = `sha256:${'4'.repeat(64)}`
const scopeDigest = `sha256:${'5'.repeat(64)}`
const backupRestoreEvidenceRef = `sha256:${'6'.repeat(64)}`
const confirmationTokenDigest = `sha256:${'7'.repeat(64)}`
const baselineReceiptBackupManifestRef = `sha256:${'8'.repeat(64)}`

const common = (sourceHash) => ({
  runtimeInstanceId: ids.runtimeInstanceId,
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: ids.customerId,
  tenantId: ids.tenantId,
  stateVersion: scope.stateVersion,
  sourceStateVersion: scope.stateVersion,
  migrationReceiptId: ids.migrationReceiptId,
  sourceHash,
  current: false,
})

const createRowSet = () => ({
  schemaVersion: 'ss014-v2-row-set-v1',
  stateVersion: scope.stateVersion,
  sourceSetHash,
  counts: {
    sectionCount: 1, sourceCount: 1, evidenceObjectCount: 1,
    graphSnapshotCount: 1, graphNodeCount: 1, graphEdgeCount: 1,
  },
  rows: {
    sections: [{ ...common(hashes.sections), sectionKey: 'overview', stateStatus: 'ACCEPTED' }],
    evidenceSources: [{ ...common(hashes.evidencePack), sourceId: 'source-1' }],
    evidenceObjects: [{ ...common(hashes.evidencePack), evidenceObjectId: 'evidence-1', sourceId: 'source-1' }],
    graphSnapshots: [{
      ...common(hashes.intelligenceGraph), snapshotId: 'snapshot-1', stateStatus: 'STALE',
    }],
    graphElements: [
      { ...common(hashes.intelligenceGraph), elementKey: 'node-1', elementType: 'NODE', snapshotId: 'snapshot-1' },
      { ...common(hashes.intelligenceGraph), elementKey: 'edge-1', elementType: 'EDGE', snapshotId: 'snapshot-1' },
    ],
  },
})

const createPlan = (rowSet = createRowSet()) => buildSs014CurrentnessTransitionPlan({
  rowSet,
  scope,
  migrationReceiptId: ids.migrationReceiptId,
  sourceHashes: hashes,
  scopeDigest,
  sourceSetHash,
  backupRestoreEvidenceRef,
  baselineReceiptBackupManifestRef,
  confirmationTokenDigest,
})

const createQuery = (value) => {
  const query = Promise.resolve(value)
  query.session = jest.fn(() => query)
  query.lean = jest.fn(() => query)
  return query
}

const createModels = (rowSet, plan) => ({
  RuntimeInstance: {
    findOne: jest.fn(() => createQuery({
      _id: plan.scope.runtimeInstanceId,
      runtimeInstanceId: plan.scope.runtimeInstanceId,
      runtimeInstanceKey: plan.scope.runtimeInstanceKey,
      customerId: plan.scope.customerId,
      tenantId: plan.scope.tenantId,
      stateVersion: plan.targetStateVersion,
    })),
  },
  RuntimeStateMigrationReceipt: {
    findOne: jest.fn(() => createQuery({
      receiptId: plan.migrationReceiptId,
      runtimeInstanceId: plan.scope.runtimeInstanceId,
      runtimeInstanceKey: plan.scope.runtimeInstanceKey,
      customerId: plan.scope.customerId,
      tenantId: plan.scope.tenantId,
      status: 'VERIFIED',
      assignedStateVersion: plan.targetStateVersion,
      scopeDigest: plan.scopeDigest,
      sourceSetHash: plan.sourceSetHash,
      targetSelectionRef: { scopeDigest: plan.scopeDigest },
      authority: { tokenDigest: plan.confirmationTokenDigest },
      backupManifestRef: plan.baselineReceiptBackupManifestRef,
      environmentClass: SS014_CURRENTNESS_CONTRACT.environmentClass,
      databaseName: SS014_CURRENTNESS_CONTRACT.databaseName,
    })),
  },
})

const createDatabase = (rowSet) => {
  const rowsByCollection = Object.fromEntries([
    ['runtime_section_states', rowSet.rows.sections],
    ['runtime_evidence_sources', rowSet.rows.evidenceSources],
    ['runtime_evidence_objects', rowSet.rows.evidenceObjects],
    ['runtime_graph_snapshots', rowSet.rows.graphSnapshots],
    ['runtime_graph_elements', rowSet.rows.graphElements],
  ])
  const collections = Object.fromEntries(Object.entries(rowsByCollection).map(([name, rows]) => {
    const collection = {
      find: jest.fn(() => ({ toArray: jest.fn(async () => rows) })),
      updateMany: jest.fn(async (_filter, update) => {
        rows.forEach((row) => {
          row.current = update.$set.current
          if (update.$set.stateStatus) row.stateStatus = update.$set.stateStatus
        })
        return { acknowledged: true, matchedCount: rows.length, modifiedCount: rows.length }
      }),
    }
    return [name, collection]
  }))
  return { collection: jest.fn((name) => collections[name]) }
}

const createSession = ({ commitError, cleanupError } = {}) => {
  let inTransaction = false
  const session = {
    startTransaction: jest.fn(() => { inTransaction = true }),
    inTransaction: jest.fn(() => inTransaction),
    abortTransaction: jest.fn(async () => { inTransaction = false }),
    commitTransaction: jest.fn(async () => {
      if (commitError) throw commitError
      inTransaction = false
    }),
    endSession: jest.fn(async () => {
      if (cleanupError) throw cleanupError
    }),
  }
  return session
}

const createDependencies = ({ rowSet = createRowSet(), sessionOptions } = {}) => {
  const plan = createPlan(rowSet)
  const session = createSession(sessionOptions)
  const auditWrite = jest.fn(async () => ({ acknowledged: true }))
  return {
    rowSet,
    plan,
    session,
    auditWrite,
    models: createModels(rowSet, plan),
    database: createDatabase(rowSet),
    client: { startSession: jest.fn(() => session) },
  }
}

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('SS-014 V2 currentness promotion service', () => {
  test('promotes one exact non-current V2 version in one transaction', async () => {
    const dependencies = createDependencies()
    const result = await promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    })

    expect(result).toMatchObject({ status: 'COMMITTED', operation: SS014_CURRENTNESS_CONTRACT.operation })
    expect(dependencies.session.startTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.abortTransaction).not.toHaveBeenCalled()
    expect(dependencies.auditWrite).toHaveBeenCalledTimes(1)
    expect(dependencies.rowSet.rows.sections[0].stateStatus).toBe('ACCEPTED')
    expect(dependencies.rowSet.rows.graphSnapshots[0].stateStatus).toBe('CURRENT')
    expect(Object.values(dependencies.rowSet.rows).flat().every((row) => row.current === true)).toBe(true)
  })

  test('rejects an untrusted writer context before opening a session', async () => {
    const dependencies = createDependencies()
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: { writerId: SS014_CURRENTNESS_CONTRACT.approvedWriter },
    }), SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
    expect(dependencies.client.startSession).not.toHaveBeenCalled()
  })

  test('rejects a tampered plan hash before opening a session', async () => {
    const dependencies = createDependencies()
    const tamperedPlan = { ...dependencies.plan, counts: { ...dependencies.plan.counts, sectionCount: 2 } }
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      plan: tamperedPlan,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.AUTHORIZATION)
    expect(dependencies.client.startSession).not.toHaveBeenCalled()
  })

  test('preserves a historical baseline receipt reference while binding fresh restore evidence', async () => {
    const dependencies = createDependencies()

    expect(dependencies.plan.backupRestoreEvidenceRef).not.toBe(
      dependencies.plan.baselineReceiptBackupManifestRef,
    )
    const result = await promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    })

    expect(result.status).toBe('COMMITTED')
    expect(dependencies.models.RuntimeStateMigrationReceipt.findOne).toHaveBeenCalledTimes(1)
  })

  test('rejects a baseline receipt reference that does not match the plan', async () => {
    const dependencies = createDependencies()
    dependencies.models.RuntimeStateMigrationReceipt.findOne = jest.fn(() => createQuery({
      receiptId: dependencies.plan.migrationReceiptId,
      runtimeInstanceId: dependencies.plan.scope.runtimeInstanceId,
      runtimeInstanceKey: dependencies.plan.scope.runtimeInstanceKey,
      customerId: dependencies.plan.scope.customerId,
      tenantId: dependencies.plan.scope.tenantId,
      status: 'VERIFIED',
      assignedStateVersion: dependencies.plan.targetStateVersion,
      scopeDigest: dependencies.plan.scopeDigest,
      sourceSetHash: dependencies.plan.sourceSetHash,
      targetSelectionRef: { scopeDigest: dependencies.plan.scopeDigest },
      authority: { tokenDigest: dependencies.plan.confirmationTokenDigest },
      backupManifestRef: backupRestoreEvidenceRef,
      environmentClass: SS014_CURRENTNESS_CONTRACT.environmentClass,
      databaseName: SS014_CURRENTNESS_CONTRACT.databaseName,
    }))

    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.PRECONDITION)
    expect(dependencies.session.abortTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.commitTransaction).not.toHaveBeenCalled()
  })

  test('aborts when the root or verified receipt no longer matches', async () => {
    const dependencies = createDependencies()
    dependencies.models.RuntimeInstance.findOne = jest.fn(() => createQuery({
      _id: dependencies.plan.scope.runtimeInstanceId,
      stateVersion: 'rsv2:12345678-1234-4123-8123-123456789abd',
    }))
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.PRECONDITION)
    expect(dependencies.session.abortTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.commitTransaction).not.toHaveBeenCalled()
  })

  test('aborts when an exact optimistic update does not modify every target row', async () => {
    const dependencies = createDependencies()
    const originalCollection = dependencies.database.collection
    dependencies.database.collection = jest.fn((name) => {
      const collection = originalCollection(name)
      if (name === 'runtime_evidence_sources') {
        collection.updateMany = jest.fn(async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }))
      }
      return collection
    })
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.TRANSACTION)
    expect(dependencies.session.abortTransaction).toHaveBeenCalledTimes(1)
  })

  test('aborts when the transaction-scoped audit write fails', async () => {
    const dependencies = createDependencies()
    dependencies.auditWrite = jest.fn(async () => false)
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.AUDIT)
    expect(dependencies.session.abortTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.commitTransaction).not.toHaveBeenCalled()
  })

  test('does not abort after an ambiguous commit result', async () => {
    const dependencies = createDependencies({ sessionOptions: { commitError: new Error('network timeout') } })
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.COMMIT_AMBIGUOUS)
    expect(dependencies.session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.abortTransaction).not.toHaveBeenCalled()
  })

  test('does not report success when session cleanup fails after commit', async () => {
    const dependencies = createDependencies({ sessionOptions: { cleanupError: new Error('close failed') } })
    await expectCode(promoteRuntimeStateCurrentnessTransaction({
      ...dependencies,
      writerContext: createSs014CurrentnessWriterContext(),
    }), SS014_CURRENTNESS_ERROR_CODES.COMMIT_AMBIGUOUS)
    expect(dependencies.session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(dependencies.session.abortTransaction).not.toHaveBeenCalled()
  })
})
