import { jest } from '@jest/globals'
import mongoose from 'mongoose'

import {
  SS014_V2_APPLY_ERROR_CODES,
  applyRuntimeStateMigrationRowSetTransaction,
  assertRuntimeStateMigrationRowSet,
  castRuntimeStateMigrationRowSetForNativePersistence,
  createRuntimeStateMigrationApplyCommandMonitor,
  createRuntimeStateMigrationShadowParityReport,
  getRuntimeStateMigrationCollectionSpecs,
  readBackRuntimeStateMigrationRows,
} from '../services/runtimeStateMigrationApplyService.js'

const ids = {
  runtimeInstanceId: '64b000000000000000000001',
  customerId: '64b000000000000000000002',
  tenantId: '64b000000000000000000003',
  migrationReceiptId: '64b000000000000000000004',
}
const hashes = {
  sections: `sha256:${'1'.repeat(64)}`,
  evidencePack: `sha256:${'2'.repeat(64)}`,
  intelligenceGraph: `sha256:${'3'.repeat(64)}`,
}
const scope = {
  ...ids,
  runtimeInstanceKey: 'runtime-one',
  stateVersion: 'rsv2:12345678-1234-4123-8123-123456789abc',
}
const common = (sourceHash) => ({
  runtimeInstanceId: ids.runtimeInstanceId,
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: ids.customerId,
  tenantId: ids.tenantId,
  stateVersion: scope.stateVersion,
  migrationReceiptId: ids.migrationReceiptId,
  sourceHash,
})
const createRowSet = () => ({
  schemaVersion: 'ss014-v2-row-set-v1',
  counts: {
    sectionCount: 1, sourceCount: 1, evidenceObjectCount: 1,
    graphSnapshotCount: 1, graphNodeCount: 1, graphEdgeCount: 1,
  },
  rows: {
    sections: [{ ...common(hashes.sections), sectionKey: 'overview' }],
    evidenceSources: [{ ...common(hashes.evidencePack), sourceId: 'source-1' }],
    evidenceObjects: [{ ...common(hashes.evidencePack), evidenceObjectId: 'evidence-1' }],
    graphSnapshots: [{ ...common(hashes.intelligenceGraph), snapshotId: 'snapshot-1' }],
    graphElements: [
      { ...common(hashes.intelligenceGraph), elementKey: 'node-1', elementType: 'NODE' },
      { ...common(hashes.intelligenceGraph), elementKey: 'edge-1', elementType: 'EDGE' },
    ],
  },
})
const createPersistenceRowSet = () => {
  const rowSet = createRowSet()
  const timestamp = '2026-08-26T12:00:00.000Z'
  Object.values(rowSet.rows).flat().forEach((row) => {
    row.sourceStateVersion = scope.stateVersion
    row.current = false
    row.createdAt = timestamp
    row.updatedAt = timestamp
  })
  Object.assign(rowSet.rows.sections[0], {
    legacyPath: 'framework_state.sections.overview', stateStatus: 'CURRENT',
    sectionDetail: {
      input: 'Migrated section input',
      generated: {
        content: 'Generated section content',
        sections: [{ heading: 'Heading', body: 'Body', text: 'Text' }],
      },
      accepted: null,
      review: { status: 'PENDING' },
      state: { status: 'CURRENT' },
      lineage: { sectionKey: 'overview', runtimePath: 'framework_state.sections.overview' },
      revisions: [],
      dependencies: {},
      validation: {},
      confidence: {},
      intelligence: {},
      metrics: {},
      additionalEvidence: {},
      evidenceObjects: [],
      gsilContext: {},
    },
    projectionReceipt: {
      algorithm: 'ss014-legacy-domain-canonical-json-v1',
      logicalPath: 'framework_state.sections.overview', sourceHash: hashes.sections,
      stateVersion: scope.stateVersion, mappingVersion: 'ss014-v2-mapping-v1',
    },
  })
  Object.assign(rowSet.rows.evidenceSources[0], { sourceType: 'DOCUMENT' })
  Object.assign(rowSet.rows.evidenceObjects[0], { sourceId: 'source-1' })
  Object.assign(rowSet.rows.graphSnapshots[0], {
    graphVersion: 'graph-v1', stateStatus: 'CURRENT', counts: { nodeCount: 1, edgeCount: 1 },
  })
  Object.assign(rowSet.rows.graphElements[0], { snapshotId: 'snapshot-1', graphVersion: 'graph-v1' })
  Object.assign(rowSet.rows.graphElements[1], {
    snapshotId: 'snapshot-1', graphVersion: 'graph-v1',
    fromElementKey: 'node-1', toElementKey: 'node-1', relationshipType: 'RELATES_TO',
  })
  rowSet.sourceSetHash = `sha256:${'4'.repeat(64)}`
  rowSet.stateVersion = scope.stateVersion
  return rowSet
}

const expectCode = (callback, code) => {
  try { callback() } catch (error) { expect(error.code).toBe(code); return }
  throw new Error(`Expected ${code}`)
}

const beginObservedTransaction = (monitor) => {
  const specification = {
    collection: 'runtime_instances', filter: { _id: ids.runtimeInstanceId },
    projection: { _id: 1 }, limit: 2, batchSize: 2, maxTimeMS: 15000,
  }
  monitor.setPhase('TRANSACTION_PRECHECK')
  monitor.expectFind(specification)
  monitor.observe({ commandName: 'find', databaseName: 'test', command: {
    find: specification.collection, filter: specification.filter, projection: specification.projection,
    limit: specification.limit, batchSize: specification.batchSize, maxTimeMS: specification.maxTimeMS,
    lsid: { id: 'session' }, txnNumber: 1, autocommit: false, startTransaction: true,
  } })
}

describe('SS-014 V2 migration apply service', () => {
  test('reports exact shadow parity across BSON ObjectId and Date representations', () => {
    const expected = castRuntimeStateMigrationRowSetForNativePersistence(createPersistenceRowSet())
    const asWireValue = (value) => {
      if (value instanceof Date) return value.toISOString()
      if (value instanceof mongoose.Types.ObjectId) return value.toHexString()
      if (Array.isArray(value)) return value.map(asWireValue)
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, asWireValue(child)]))
      }
      return value
    }
    const observedRows = Object.fromEntries(Object.entries(expected.rows)
      .map(([key, rows]) => [key, rows.map((row) => ({ _id: new mongoose.Types.ObjectId(), ...asWireValue(row) }))]))
    const report = createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows })
    expect(report.parity).toBe(true)
    expect(report.mismatchCount).toBe(0)
    expect(Object.values(report.collections).every((entry) => entry.digestMatch)).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/runtime-one|overview|source-1|evidence-1|snapshot-1|node-1|edge-1/)

    const promotedRows = Object.fromEntries(Object.entries(observedRows)
      .map(([key, rows]) => [key, rows.map((row) => ({
        ...row,
        current: true,
        ...(key === 'graphSnapshots' ? { stateStatus: 'CURRENT' } : {}),
      }))]))
    const promoted = createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows: promotedRows })
    expect(promoted).toMatchObject({ parity: true, mismatchCount: 0 })

    observedRows.evidenceObjects[0].summary = 'changed'
    const changed = createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows })
    expect(changed).toMatchObject({ parity: false, mismatchCount: 1 })
    expect(changed.collections.evidenceObjects.digestMatch).toBe(false)

    observedRows.evidenceObjects = []
    const missing = createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows })
    expect(missing.collections.evidenceObjects).toMatchObject({ expectedCount: 1, observedCount: 0, digestMatch: false })
  })

  test('keeps section state status parity-significant', () => {
    const expected = castRuntimeStateMigrationRowSetForNativePersistence(createPersistenceRowSet())
    const observedRows = Object.fromEntries(Object.entries(expected.rows)
      .map(([key, rows]) => [key, rows.map((row) => ({ ...row }))]))
    observedRows.sections[0].stateStatus = 'GENERATED'

    const report = createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows })
    expect(report).toMatchObject({ parity: false, mismatchCount: 1 })
    expect(report.collections.sections.digestMatch).toBe(false)
  })

  test('rejects duplicate or missing shadow identity keys and unsafe values', () => {
    const expected = castRuntimeStateMigrationRowSetForNativePersistence(createPersistenceRowSet())
    const duplicate = { ...expected.rows, sections: [...expected.rows.sections, { ...expected.rows.sections[0] }] }
    expectCode(
      () => createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows: duplicate }),
      SS014_V2_APPLY_ERROR_CODES.INPUT,
    )
    const missing = { ...expected.rows, graphElements: [{ ...expected.rows.graphElements[0], elementKey: '' }] }
    expectCode(
      () => createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows: missing }),
      SS014_V2_APPLY_ERROR_CODES.INPUT,
    )
    const unsafe = { ...expected.rows, evidenceSources: [{ ...expected.rows.evidenceSources[0], unsafe: Number.NaN }] }
    expectCode(
      () => createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows: unsafe }),
      SS014_V2_APPLY_ERROR_CODES.INPUT,
    )
    const extraCollection = { ...expected.rows, unexpectedRows: [] }
    expectCode(
      () => createRuntimeStateMigrationShadowParityReport({ expectedRowSet: expected, observedRows: extraCollection }),
      SS014_V2_APPLY_ERROR_CODES.INPUT,
    )
  })

  test('casts validated mapper DTOs to BSON-ready identities without semantic drift', () => {
    const canonical = createPersistenceRowSet()
    const persisted = castRuntimeStateMigrationRowSetForNativePersistence(canonical)
    expect(persisted).not.toBe(canonical)
    expect(persisted.counts).toEqual(canonical.counts)
    expect(persisted.sourceSetHash).toBe(canonical.sourceSetHash)
    expect(persisted.stateVersion).toBe(canonical.stateVersion)
    Object.values(persisted.rows).flat().forEach((row) => {
      expect(row.runtimeInstanceId).toBeInstanceOf(mongoose.Types.ObjectId)
      expect(row.customerId).toBeInstanceOf(mongoose.Types.ObjectId)
      expect(row.tenantId).toBeInstanceOf(mongoose.Types.ObjectId)
      expect(row.migrationReceiptId).toBeInstanceOf(mongoose.Types.ObjectId)
      expect(row.stateVersion).toBe(scope.stateVersion)
    })
    expect(canonical.rows.sections[0].runtimeInstanceId).toBe(ids.runtimeInstanceId)
    const invalid = createPersistenceRowSet()
    invalid.rows.graphElements[0].runtimeInstanceId = 'not-an-object-id'
    expectCode(() => castRuntimeStateMigrationRowSetForNativePersistence(invalid), SS014_V2_APPLY_ERROR_CODES.INPUT)
  })

  test('validates the exact scoped five-collection row set', () => {
    const rowSet = createRowSet()
    expect(assertRuntimeStateMigrationRowSet({ rowSet, scope, migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes }))
      .toEqual({ sectionCount: 1, sourceCount: 1, evidenceObjectCount: 1, graphSnapshotCount: 1, graphElementCount: 2 })
    rowSet.rows.evidenceObjects[0].tenantId = ids.customerId
    expectCode(
      () => assertRuntimeStateMigrationRowSet({ rowSet, scope, migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes }),
      SS014_V2_APPLY_ERROR_CODES.INPUT,
    )
  })

  test('admits exactly five ordered transactional insert commands and one commit', () => {
    const rowSet = createRowSet()
    const monitor = createRuntimeStateMigrationApplyCommandMonitor({
      databaseName: 'test', rowSet, scope,
      migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
    })
    beginObservedTransaction(monitor)
    monitor.setPhase('TRANSACTION_INSERT')
    getRuntimeStateMigrationCollectionSpecs().forEach((spec) => monitor.observe({
      commandName: 'insert', databaseName: 'test', command: {
        insert: spec.collection, ordered: true, lsid: { id: 'session' }, txnNumber: 1,
        autocommit: false, documents: rowSet.rows[spec.key],
      },
    }))
    monitor.setPhase('COMMIT_OR_ABORT')
    monitor.observe({ commandName: 'commitTransaction', databaseName: 'admin', command: {
      commitTransaction: 1, lsid: { id: 'session' }, txnNumber: 1, autocommit: false,
    } })
    monitor.setPhase('CLOSE')
    expect(monitor.finalize({ committed: true }).terminal).toBe('commitTransaction')
  })

  test.each([
    ['update', { update: 'runtime_section_states' }],
    ['delete', { delete: 'runtime_section_states' }],
    ['bulkWrite', { bulkWrite: 1 }],
    ['createIndexes', { createIndexes: 'runtime_section_states' }],
    ['aggregate', { aggregate: 'runtime_section_states', pipeline: [{ $out: 'x' }] }],
    ['aggregate', { aggregate: 'runtime_section_states', pipeline: [{ $merge: 'x' }] }],
  ])('rejects forbidden command %s', (commandName, command) => {
    const monitor = createRuntimeStateMigrationApplyCommandMonitor({
      databaseName: 'test', rowSet: createRowSet(), scope,
      migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
    })
    monitor.observe({ commandName, databaseName: 'test', command })
    expect(monitor.violation).toBe(SS014_V2_APPLY_ERROR_CODES.COMMAND)
  })

  test('rejects wrong insert order, count, scope, phase and transaction envelope', () => {
    const variants = [
      (event) => { event.command.insert = 'runtime_evidence_sources' },
      (event) => { event.command.documents = [] },
      (event) => { event.command.documents[0] = { ...event.command.documents[0], customerId: ids.tenantId } },
      (event, monitor) => { monitor.setPhase('PRECHECK_READ') },
      (event) => { delete event.command.lsid },
      (event) => { event.command.ordered = false },
      (event) => { event.command.txnNumber = 2 },
    ]
    variants.forEach((mutate) => {
      const rowSet = createRowSet()
      const monitor = createRuntimeStateMigrationApplyCommandMonitor({
        databaseName: 'test', rowSet, scope,
        migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
      })
      beginObservedTransaction(monitor)
      monitor.setPhase('TRANSACTION_INSERT')
      const event = { commandName: 'insert', databaseName: 'test', command: {
        insert: 'runtime_section_states', ordered: true, lsid: { id: 'session' },
        txnNumber: 1, autocommit: false, documents: [...rowSet.rows.sections],
      } }
      mutate(event, monitor)
      monitor.observe(event)
      expect(monitor.violation).toBe(SS014_V2_APPLY_ERROR_CODES.COMMAND)
    })
  })

  test('admits an implicit readback lsid but rejects transaction fields', () => {
    const makeMonitor = () => createRuntimeStateMigrationApplyCommandMonitor({
      databaseName: 'test', rowSet: createRowSet(), scope,
      migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
    })
    const specification = {
      collection: 'runtime_section_states', filter: { stateVersion: scope.stateVersion },
      projection: { _id: 1 }, limit: 2, batchSize: 2, maxTimeMS: 15000,
    }
    const event = {
      commandName: 'find', databaseName: 'test', command: {
        find: specification.collection, filter: specification.filter, projection: specification.projection,
        limit: 2, batchSize: 2, maxTimeMS: 15000, lsid: { id: 'implicit-read-session' },
      },
    }
    const admitted = makeMonitor()
    admitted.setPhase('READBACK')
    admitted.expectFind(specification)
    admitted.observe(event)
    admitted.setPhase('CLOSE')
    expect(admitted.finalizeReadback()).toEqual({ readCount: 1 })

    for (const field of ['txnNumber', 'autocommit', 'startTransaction']) {
      const rejected = makeMonitor()
      rejected.setPhase('READBACK')
      rejected.expectFind(specification)
      rejected.observe({ ...event, command: { ...event.command, [field]: field === 'txnNumber' ? 1 : false } })
      expect(rejected.violation).toBe(SS014_V2_APPLY_ERROR_CODES.COMMAND)
    }
  })

  test('commits only after transaction-local empty precheck, inserts and reconciliation', async () => {
    const rowSet = createRowSet()
    const rows = Object.fromEntries(getRuntimeStateMigrationCollectionSpecs().map((spec) => [spec.collection, []]))
    const session = {
      startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn(),
      inTransaction: jest.fn(() => true), endSession: jest.fn(),
    }
    const database = { collection: jest.fn((name) => ({
      find: jest.fn(() => ({ toArray: jest.fn(async () => rows[name]) })),
      insertMany: jest.fn(async (documents) => {
        rows[name].push(...documents)
        return { acknowledged: true, insertedCount: documents.length }
      }),
    })) }
    const monitor = { setPhase: jest.fn(), expectFind: jest.fn() }
    await expect(applyRuntimeStateMigrationRowSetTransaction({
      client: { startSession: () => session }, database, rowSet, filter: { stateVersion: scope.stateVersion },
      scope, migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes, monitor,
      transactionPrecondition: jest.fn(),
    })).resolves.toMatchObject({ counts: { graphElementCount: 2 } })
    expect(session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(session.abortTransaction).not.toHaveBeenCalled()
  })

  test('aborts on a partial insert failure and does not commit', async () => {
    const rowSet = createRowSet()
    let inserts = 0
    const committedRows = []
    const pendingRows = []
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(() => { committedRows.push(...pendingRows.splice(0)) }),
      abortTransaction: jest.fn(() => { pendingRows.splice(0) }),
      inTransaction: jest.fn(() => true), endSession: jest.fn(),
    }
    const database = { collection: jest.fn(() => ({
      find: jest.fn(() => ({ toArray: jest.fn(async () => []) })),
      insertMany: jest.fn(async (documents) => {
        inserts += 1
        if (inserts === 3) throw new Error('forced insert failure')
        pendingRows.push(...documents)
        return { acknowledged: true, insertedCount: documents.length }
      }),
    })) }
    await expect(applyRuntimeStateMigrationRowSetTransaction({
      client: { startSession: () => session }, database, rowSet, filter: {}, scope,
      migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
      monitor: { setPhase: jest.fn(), expectFind: jest.fn() }, transactionPrecondition: jest.fn(),
    })).rejects.toThrow('forced insert failure')
    expect(session.abortTransaction).toHaveBeenCalledTimes(1)
    expect(session.commitTransaction).not.toHaveBeenCalled()
    expect(pendingRows).toHaveLength(0)
    expect(committedRows).toHaveLength(0)
  })

  test('does not abort or retry an ambiguous commit result', async () => {
    const rowSet = createRowSet()
    const rows = Object.fromEntries(getRuntimeStateMigrationCollectionSpecs().map((spec) => [spec.collection, []]))
    const ambiguous = Object.assign(new Error('unknown commit'), {
      errorLabels: ['UnknownTransactionCommitResult'],
    })
    const session = {
      startTransaction: jest.fn(), commitTransaction: jest.fn().mockRejectedValue(ambiguous),
      abortTransaction: jest.fn(), inTransaction: jest.fn(() => true), endSession: jest.fn(),
    }
    const database = { collection: (name) => ({
      find: () => ({ toArray: async () => rows[name] }),
      insertMany: async (documents) => {
        rows[name].push(...documents)
        return { acknowledged: true, insertedCount: documents.length }
      },
    }) }
    await expect(applyRuntimeStateMigrationRowSetTransaction({
      client: { startSession: () => session }, database, rowSet, filter: {}, scope,
      migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
      monitor: { setPhase: jest.fn(), expectFind: jest.fn() }, transactionPrecondition: jest.fn(),
    })).rejects.toMatchObject({
      code: SS014_V2_APPLY_ERROR_CODES.COMMIT_AMBIGUOUS,
      commitAmbiguous: true,
    })
    expect(session.abortTransaction).not.toHaveBeenCalled()
    expect(session.commitTransaction).toHaveBeenCalledTimes(1)
  })

  test('preserves ambiguous commit when session cleanup also fails', async () => {
    const rowSet = createRowSet()
    const rows = Object.fromEntries(getRuntimeStateMigrationCollectionSpecs().map((spec) => [spec.collection, []]))
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockRejectedValue(Object.assign(new Error('unknown'), {
        errorLabels: ['UnknownTransactionCommitResult'],
      })),
      abortTransaction: jest.fn(), inTransaction: jest.fn(() => true),
      endSession: jest.fn().mockRejectedValue(new Error('cleanup failed')),
    }
    await expect(applyRuntimeStateMigrationRowSetTransaction({
      client: { startSession: () => session },
      database: { collection: (name) => ({
        find: () => ({ toArray: async () => rows[name] }),
        insertMany: async (documents) => {
          rows[name].push(...documents)
          return { acknowledged: true, insertedCount: documents.length }
        },
      }) },
      rowSet, filter: {}, scope, migrationReceiptId: ids.migrationReceiptId,
      sourceHashes: hashes, monitor: { setPhase: jest.fn(), expectFind: jest.fn() },
      transactionPrecondition: jest.fn(),
    })).rejects.toMatchObject({ code: SS014_V2_APPLY_ERROR_CODES.COMMIT_AMBIGUOUS, commitAmbiguous: true })
    expect(session.abortTransaction).not.toHaveBeenCalled()
  })

  test('marks successful commit when session cleanup fails', async () => {
    const rowSet = createRowSet()
    const rows = Object.fromEntries(getRuntimeStateMigrationCollectionSpecs().map((spec) => [spec.collection, []]))
    const session = {
      startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn(),
      inTransaction: jest.fn(() => false), endSession: jest.fn().mockRejectedValue(new Error('cleanup failed')),
    }
    await expect(applyRuntimeStateMigrationRowSetTransaction({
      client: { startSession: () => session },
      database: { collection: (name) => ({
        find: () => ({ toArray: async () => rows[name] }),
        insertMany: async (documents) => {
          rows[name].push(...documents)
          return { acknowledged: true, insertedCount: documents.length }
        },
      }) },
      rowSet, filter: {}, scope, migrationReceiptId: ids.migrationReceiptId,
      sourceHashes: hashes, monitor: { setPhase: jest.fn(), expectFind: jest.fn() },
      transactionPrecondition: jest.fn(),
    })).rejects.toMatchObject({ commitSucceeded: true })
    expect(session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(session.abortTransaction).not.toHaveBeenCalled()
  })

  test('readback proves exact counts and graph node/edge reconciliation', async () => {
    const rowSet = createRowSet()
    const byCollection = Object.fromEntries(getRuntimeStateMigrationCollectionSpecs().map((spec) => [spec.collection,
      rowSet.rows[spec.key].map((row, index) => ({ _id: index + 1, ...row })),
    ]))
    const result = await readBackRuntimeStateMigrationRows({
      database: { collection: (name) => ({ find: () => ({ toArray: async () => byCollection[name] }) }) },
      filter: {}, rowSet, scope, migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
      monitor: { setPhase: jest.fn(), expectFind: jest.fn() },
    })
    expect(result.runtime_graph_elements).toHaveLength(2)
    byCollection.runtime_graph_elements[1].elementType = 'NODE'
    await expect(readBackRuntimeStateMigrationRows({
      database: { collection: (name) => ({ find: () => ({ toArray: async () => byCollection[name] }) }) },
      filter: {}, rowSet, scope, migrationReceiptId: ids.migrationReceiptId, sourceHashes: hashes,
      monitor: { setPhase: jest.fn(), expectFind: jest.fn() },
    })).rejects.toMatchObject({ code: SS014_V2_APPLY_ERROR_CODES.RECONCILIATION })
  })
})
