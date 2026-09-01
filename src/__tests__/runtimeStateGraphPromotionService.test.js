import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import {
  promoteRuntimeStateGraphCandidate,
  RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES,
} from '../services/runtimeStateGraphPromotionService.js'

const IDS = Object.freeze({
  runtime: '64b000000000000000000001',
  customer: '64b000000000000000000002',
  tenant: '64b000000000000000000003',
  receipt: '64b000000000000000000004',
  actor: '64b000000000000000000005',
})
const STATE_VERSION = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
const SOURCE_HASH = `sha256:${'a'.repeat(64)}`
const GRAPH_HASH = `sha256:${'b'.repeat(64)}`

const candidate = () => {
  const common = {
    runtimeInstanceId: IDS.runtime,
    runtimeInstanceKey: 'runtime-one',
    customerId: IDS.customer,
    tenantId: IDS.tenant,
    stateVersion: STATE_VERSION,
    sourceStateVersion: STATE_VERSION,
    sourceHash: SOURCE_HASH,
    migrationReceiptId: IDS.receipt,
    current: false,
  }
  const snapshotId = `rgs:${'b'.repeat(64)}`
  const nodes = [{
    ...common,
    snapshotId,
    graphVersion: 'runtime-intelligence-graph-v1',
    elementType: 'NODE',
    elementKey: 'node-one',
    fromElementKey: '',
    toElementKey: '',
    relationshipType: '',
    label: 'Node one',
    summary: '',
    attributes: { nodeType: 'COMPANY' },
  }]
  return {
    schemaVersion: 'runtime-state-v2-graph-candidate-v1',
    sourceHash: SOURCE_HASH,
    stateVersion: STATE_VERSION,
    snapshot: {
      ...common,
      snapshotId,
      graphVersion: 'runtime-intelligence-graph-v1',
      graphHash: GRAPH_HASH,
      stateStatus: 'REBUILDING',
      counts: { nodeCount: 1, edgeCount: 0 },
      metadata: { artifactType: 'runtime-intelligence-graph' },
    },
    nodes,
    edges: [],
    counts: { nodeCount: 1, edgeCount: 0, elementCount: 1 },
  }
}

const clone = (value) => {
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]))
  }
  return value
}
const identity = (value) => String(value?.toHexString?.() ?? value ?? '').toLowerCase()
const equal = (left, right) => identity(left) === identity(right)

const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => equal(row?.[key], expected))

const applySet = (row, update) => {
  if (update.$set) Object.assign(row, clone(update.$set))
  if (update.$currentDate?.updatedAt) row.updatedAt = new Date('2026-08-28T12:00:00.000Z')
}

const query = (resolveRows) => {
  const options = { session: null, read: null, readConcern: null }
  const value = {
    session(session) { options.session = session; return value },
    read(preference) { options.read = preference; return value },
    readConcern(level) { options.readConcern = level; return value },
    lean() { return Promise.resolve(resolveRows(options)) },
    then(resolve, reject) { return Promise.resolve(resolveRows(options)).then(resolve, reject) },
  }
  return value
}

const createHarness = ({ initial = {}, faults = {} } = {}) => {
  const db = {
    root: {
      _id: IDS.runtime,
      runtimeInstanceKey: 'runtime-one',
      customerId: IDS.customer,
      tenantId: IDS.tenant,
      stateVersion: STATE_VERSION,
      updatedAt: new Date('2026-08-28T10:00:00.000Z'),
      updatedBy: null,
      ...(initial.root || {}),
    },
    snapshots: clone(initial.snapshots || []),
    elements: clone(initial.elements || []),
    audits: [],
  }
  const sessions = []
  const auditSessions = []
  const operationSessions = []
  let commitCalls = 0
  const track = (operation, session, details = {}) => operationSessions.push({ operation, session, details })

  const stateFor = (session) => session?.tx || db
  const sessionFactory = () => {
    const session = {
      tx: null,
      aborted: false,
      committed: false,
      ended: false,
      abortCalls: 0,
      endCalls: 0,
      startTransaction(options) {
        session.options = options
        session.tx = clone(db)
      },
      async abortTransaction() {
        session.abortCalls += 1
        if (faults.abort) throw new Error('abort failed')
        session.aborted = true
        session.tx = null
      },
      async commitTransaction() {
        commitCalls += 1
        if (faults.transientCommitAlways || (faults.transientCommitOnce && commitCalls === 1)) {
          const error = new Error('transient commit')
          error.errorLabels = ['TransientTransactionError']
          throw error
        }
        if (session.tx) Object.assign(db, clone(session.tx))
        if (faults.unknownCommit) {
          const error = new Error('unknown commit')
          error.errorLabels = ['UnknownTransactionCommitResult']
          throw error
        }
        session.committed = true
      },
      async endSession() {
        session.endCalls += 1
        session.ended = true
        if (faults.cleanup) throw new Error('cleanup failed')
      },
    }
    sessions.push(session)
    return session
  }

  const adapter = (Actual, methods) => {
    function Adapter(row) { return new Actual(row) }
    return Object.assign(Adapter, methods)
  }

  const RuntimeInstanceModel = {
    updateOne: async (filter, update, { session }) => {
      track('root.updateOne', session, { filter, update })
      if (faults.ordinaryTransaction) throw new Error('ordinary transaction failure')
      const state = stateFor(session)
      if (!matches(state.root, filter)) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      applySet(state.root, update)
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
    },
    findOne: (filter) => query((options) => {
      const { session } = options
      track('root.findOne', session, { filter, options })
      const root = stateFor(session).root
      return matches(root, filter) ? clone(root) : null
    }),
  }

  const SnapshotModel = adapter(RuntimeGraphSnapshot, {
    find: (filter) => query((options) => {
      const { session } = options
      track('snapshot.find', session, { filter, options })
      return clone(stateFor(session).snapshots.filter((row) => matches(row, filter)))
    }),
    findOne: (filter) => query((options) => {
      const { session } = options
      track('snapshot.findOne', session, { filter, options })
      return clone(stateFor(session).snapshots.find((row) => matches(row, filter)) || null)
    }),
    create: async ([row], { session }) => {
      track('snapshot.create', session, { row })
      if (faults.snapshotInsert) throw new Error('snapshot insert failed')
      if (faults.duplicateOnInsert) {
        const promoted = { ...clone(row), current: true, stateStatus: 'CURRENT' }
        if (faults.duplicateOnInsert === 'conflicting') promoted.graphHash = `sha256:${'d'.repeat(64)}`
        db.snapshots = [promoted]
        db.elements = candidate().nodes.map((element) => ({ ...clone(element), current: true }))
        const error = new Error('duplicate')
        error.code = 11000
        throw error
      }
      stateFor(session).snapshots.push(clone(row))
    },
    updateOne: async (filter, update, { session }) => {
      track('snapshot.updateOne', session, { filter, update })
      if (faults.demoteSnapshot && update.$set?.stateStatus === 'STALE') {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      }
      if (faults.promoteSnapshot && update.$set?.stateStatus === 'CURRENT') {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      }
      const row = stateFor(session).snapshots.find((item) => matches(item, filter))
      if (!row) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      applySet(row, update)
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
    },
  })

  const ElementModel = adapter(RuntimeGraphElement, {
    find: (filter) => query((options) => {
      const { session } = options
      track('element.find', session, { filter, options })
      const rows = stateFor(session).elements.filter((row) => matches(row, filter))
      if (faults.readback && filter.current === true
        && stateFor(session).snapshots.some((row) => row.snapshotId === candidate().snapshot.snapshotId && row.current)) return []
      return clone(rows)
    }),
    insertMany: async (rows, { session }) => {
      track('element.insertMany', session, { rows })
      if (faults.elementInsert) throw new Error('element insert failed')
      stateFor(session).elements.push(...clone(rows))
    },
    updateMany: async (filter, update, { session }) => {
      track('element.updateMany', session, { filter, update })
      if (faults.demoteElements && update.$set?.current === false) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      }
      if (faults.promoteElements && update.$set?.current === true) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      }
      const rows = stateFor(session).elements.filter((row) => matches(row, filter))
      rows.forEach((row) => applySet(row, update))
      return { acknowledged: true, matchedCount: rows.length, modifiedCount: rows.length }
    },
  })

  const audit = {
    log: async (payload, { session, throwOnError }) => {
      track('audit.log', session, { payload, throwOnError })
      if (faults.audit) throw new Error('audit failed')
      auditSessions.push(session)
      stateFor(session).audits.push({ payload: clone(payload), throwOnError })
    },
  }

  return {
    db,
    sessions,
    auditSessions,
    operationSessions,
    dependencies: {
      mongoose: { startSession: async () => sessionFactory() },
      RuntimeInstance: RuntimeInstanceModel,
      RuntimeGraphSnapshot: SnapshotModel,
      RuntimeGraphElement: ElementModel,
      auditService: audit,
    },
  }
}

const promotedRows = () => {
  const next = candidate()
  return {
    snapshots: [{ ...clone(next.snapshot), current: true, stateStatus: 'CURRENT' }],
    elements: next.nodes.map((row) => ({ ...clone(row), current: true })),
  }
}

const previousCurrentRows = () => {
  const next = candidate()
  const stateVersion = 'rsv2:223e4567-e89b-42d3-a456-426614174000'
  return {
    snapshots: [{
      ...clone(next.snapshot), stateVersion, sourceStateVersion: stateVersion,
      snapshotId: 'rgs:old', graphHash: `sha256:${'c'.repeat(64)}`,
      current: true, stateStatus: 'CURRENT', metadata: {},
    }],
    elements: [{
      ...clone(next.nodes[0]), stateVersion, sourceStateVersion: stateVersion,
      snapshotId: 'rgs:old', current: true,
    }],
  }
}

describe('Runtime State V2 graph promotion', () => {
  test('promotes the first graph atomically with one same-session audit', async () => {
    const harness = createHarness()
    const result = await promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })

    expect(result.status).toBe('PROMOTED')
    expect(harness.db.snapshots).toHaveLength(1)
    expect(harness.db.snapshots[0]).toMatchObject({ current: true, stateStatus: 'CURRENT' })
    expect(harness.db.elements).toHaveLength(1)
    expect(harness.db.elements[0].current).toBe(true)
    expect(harness.db.audits).toHaveLength(1)
    expect(harness.db.audits[0].payload.diff.operation).toBe('V2_GRAPH_REBUILD_PROMOTED')
    expect(harness.auditSessions[0]).toBe(harness.sessions[0])
    expect(harness.operationSessions.length).toBeGreaterThan(0)
    expect(harness.operationSessions.every(({ session }) => session === harness.sessions[0])).toBe(true)
    expect(harness.sessions[0].options).toEqual({
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', j: true }, readPreference: 'primary',
    })
  })

  test('idempotent retry aborts the root fence and emits no second audit', async () => {
    const existing = promotedRows()
    const harness = createHarness({ initial: existing })
    const before = clone(harness.db.root)
    const result = await promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })

    expect(result.status).toBe('ALREADY_CURRENT')
    expect(harness.sessions[0]).toMatchObject({ aborted: true, ended: true, committed: false })
    expect(harness.db.root).toEqual(before)
    expect(harness.db.audits).toHaveLength(0)
  })

  test('replaces one valid current graph and preserves it as stale history', async () => {
    const next = candidate()
    const harness = createHarness({ initial: previousCurrentRows() })

    const result = await promoteRuntimeStateGraphCandidate({
      candidate: next, actorUserId: IDS.actor, dependencies: harness.dependencies,
    })
    expect(result).toMatchObject({ status: 'PROMOTED', previousSnapshotId: 'rgs:old' })
    expect(harness.db.snapshots.find((row) => row.snapshotId === 'rgs:old')).toMatchObject({ current: false, stateStatus: 'STALE' })
    expect(harness.db.elements.find((row) => row.snapshotId === 'rgs:old').current).toBe(false)
    expect(harness.operationSessions.some(({ operation, details }) => (
      operation === 'element.updateMany' && details.update.$set?.current === false
    ))).toBe(true)
    expect(harness.operationSessions.some(({ operation, details }) => (
      operation === 'snapshot.updateOne' && details.update.$set?.stateStatus === 'STALE'
    ))).toBe(true)
    expect(harness.operationSessions.some(({ operation }) => operation === 'root.updateOne')).toBe(true)
    expect(harness.operationSessions.some(({ operation }) => operation === 'snapshot.findOne')).toBe(true)
    expect(harness.operationSessions.filter(({ operation }) => operation === 'snapshot.find').length).toBeGreaterThanOrEqual(2)
    expect(harness.operationSessions.filter(({ operation }) => operation === 'element.find').length).toBeGreaterThanOrEqual(2)
    expect(harness.operationSessions.some(({ operation }) => operation === 'snapshot.create')).toBe(true)
    expect(harness.operationSessions.some(({ operation }) => operation === 'element.insertMany')).toBe(true)
    expect(harness.operationSessions.some(({ operation, details }) => (
      operation === 'snapshot.updateOne' && details.update.$set?.stateStatus === 'CURRENT'
    ))).toBe(true)
    expect(harness.operationSessions.some(({ operation, details }) => (
      operation === 'element.updateMany' && details.update.$set?.current === true
    ))).toBe(true)
    expect(harness.operationSessions.some(({ operation }) => operation === 'audit.log')).toBe(true)
    expect(harness.operationSessions.every(({ session }) => session === harness.sessions[0])).toBe(true)
  })

  test('rejects malformed input before opening a session', async () => {
    const harness = createHarness()
    const invalid = candidate()
    invalid.counts.elementCount = 99
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: invalid, actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID })
    expect(harness.sessions).toHaveLength(0)

    const extraCount = candidate()
    extraCount.counts.unexpected = 1
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: extraCount, actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.INVALID })
    expect(harness.sessions).toHaveLength(0)
  })

  test('obsolete source and audit failure both leave no graph writes', async () => {
    const previous = previousCurrentRows()
    const obsolete = createHarness({ initial: { ...previous, root: { stateVersion: 'rsv2:obsolete' } } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: obsolete.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.SOURCE_OBSOLETE })
    expect(obsolete.db.snapshots).toEqual(previous.snapshots)
    expect(obsolete.db.elements).toEqual(previous.elements)

    const auditFailure = createHarness({ initial: previousCurrentRows(), faults: { audit: true } })
    const auditBefore = clone({ snapshots: auditFailure.db.snapshots, elements: auditFailure.db.elements })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: auditFailure.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.AUDIT_FAILED })
    expect(auditFailure.db.snapshots).toEqual(auditBefore.snapshots)
    expect(auditFailure.db.elements).toEqual(auditBefore.elements)
    expect(auditFailure.sessions[0].aborted).toBe(true)
  })

  test('retries one transient transaction failure without duplicating audit', async () => {
    const harness = createHarness({ faults: { transientCommitOnce: true } })
    const result = await promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })
    expect(result.status).toBe('PROMOTED')
    expect(harness.sessions).toHaveLength(2)
    expect(harness.db.audits).toHaveLength(1)
  })

  test('keeps unknown commit ambiguous and reports cleanup after a confirmed commit', async () => {
    const ambiguous = createHarness({ faults: { unknownCommit: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: ambiguous.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.COMMIT_AMBIGUOUS })
    expect(ambiguous.sessions[0].aborted).toBe(false)

    const cleanup = createHarness({ faults: { cleanup: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: cleanup.dependencies,
    })).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CLEANUP_FAILED,
      details: { committed: true },
    })
    expect(cleanup.db.snapshots[0].current).toBe(true)
  })

  test('reconciles an equivalent E11000 winner only after abort and cleanup', async () => {
    const harness = createHarness({ faults: { duplicateOnInsert: true } })
    const result = await promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })
    expect(result.status).toBe('ALREADY_CURRENT')
    expect(harness.sessions[0]).toMatchObject({ aborted: true, ended: true })
    expect(harness.db.snapshots[0].current).toBe(true)
    const freshReads = harness.operationSessions.filter(({ details }) => details.options?.read === 'primary')
    expect(freshReads.length).toBeGreaterThanOrEqual(3)
    expect(freshReads.every(({ session, details }) => (
      session === null && details.options.readConcern === 'majority'
    ))).toBe(true)
  })

  test('classifies deterministic and E11000 conflicts without accepting a different graph', async () => {
    const next = candidate()
    const deterministic = createHarness({ initial: {
      snapshots: [{ ...clone(next.snapshot), graphHash: `sha256:${'d'.repeat(64)}` }],
    } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: next, actorUserId: IDS.actor, dependencies: deterministic.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.DUPLICATE_CONFLICT })
    const uniqueLookup = deterministic.operationSessions.find(({ operation }) => operation === 'snapshot.findOne')
    expect(uniqueLookup.details.filter).toMatchObject({
      runtimeInstanceKey: next.snapshot.runtimeInstanceKey,
      graphVersion: next.snapshot.graphVersion,
      stateVersion: next.stateVersion,
    })
    expect(identity(uniqueLookup.details.filter.runtimeInstanceId)).toBe(IDS.runtime)
    expect(identity(uniqueLookup.details.filter.customerId)).toBe(IDS.customer)
    expect(identity(uniqueLookup.details.filter.tenantId)).toBe(IDS.tenant)
    expect(uniqueLookup.details.filter).not.toHaveProperty('snapshotId')

    const raced = createHarness({ faults: { duplicateOnInsert: 'conflicting' } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: raced.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CONCURRENT_CONFLICT })
    expect(raced.sessions[0]).toMatchObject({ aborted: true, ended: true })
  })

  test('rejects an invalid previous-current row set before candidate insertion', async () => {
    const invalid = previousCurrentRows()
    invalid.elements = []
    const harness = createHarness({ initial: invalid })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CURRENT_GRAPH_INVALID })
    expect(harness.db.snapshots).toEqual(invalid.snapshots)
  })

  test.each([
    ['snapshot insertion', { snapshotInsert: true }],
    ['element insertion', { elementInsert: true }],
  ])('rolls back %s failure', async (_label, faults) => {
    const initial = previousCurrentRows()
    const harness = createHarness({ initial, faults })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED })
    expect(harness.db.snapshots).toEqual(initial.snapshots)
    expect(harness.db.elements).toEqual(initial.elements)
  })

  test.each([
    ['old element demotion', { demoteElements: true }],
    ['old snapshot demotion', { demoteSnapshot: true }],
    ['new snapshot promotion', { promoteSnapshot: true }],
    ['new element promotion', { promoteElements: true }],
    ['current readback', { readback: true }],
  ])('preserves the last valid graph on %s mismatch', async (_label, faults) => {
    const initial = previousCurrentRows()
    const before = clone(initial)
    const harness = createHarness({ initial, faults })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED })
    expect(harness.db.snapshots).toEqual(before.snapshots || [])
    expect(harness.db.elements).toEqual(before.elements || [])
  })

  test('bounds ordinary and repeated transient failures', async () => {
    const ordinaryInitial = previousCurrentRows()
    const ordinary = createHarness({ initial: ordinaryInitial, faults: { ordinaryTransaction: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: ordinary.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED })
    expect(ordinary.sessions).toHaveLength(1)
    expect(ordinary.db.snapshots).toEqual(ordinaryInitial.snapshots)
    expect(ordinary.db.elements).toEqual(ordinaryInitial.elements)

    const transientInitial = previousCurrentRows()
    const transient = createHarness({ initial: transientInitial, faults: { transientCommitAlways: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: transient.dependencies,
    })).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.TRANSACTION_FAILED,
      details: { attempts: 2 },
    })
    expect(transient.sessions).toHaveLength(2)
    expect(transient.db.snapshots).toEqual(transientInitial.snapshots)
    expect(transient.db.elements).toEqual(transientInitial.elements)
  })

  test('keeps abort failure rollback-ambiguous and pre-commit cleanup explicit', async () => {
    const rollbackInitial = previousCurrentRows()
    const rollback = createHarness({ initial: rollbackInitial, faults: { audit: true, abort: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: rollback.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.ROLLBACK_AMBIGUOUS })
    expect(rollback.sessions[0]).toMatchObject({ abortCalls: 1, endCalls: 1 })
    expect(rollback.db.snapshots).toEqual(rollbackInitial.snapshots)
    expect(rollback.db.elements).toEqual(rollbackInitial.elements)

    const cleanupInitial = previousCurrentRows()
    const cleanup = createHarness({ initial: cleanupInitial, faults: { audit: true, cleanup: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: cleanup.dependencies,
    })).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CLEANUP_FAILED,
      details: { committed: false },
    })
    expect(cleanup.sessions[0]).toMatchObject({ abortCalls: 1, endCalls: 1 })
    expect(cleanup.db.snapshots).toEqual(cleanupInitial.snapshots)
    expect(cleanup.db.elements).toEqual(cleanupInitial.elements)
  })

  test('does not re-enter abort or cleanup when idempotent finalization fails', async () => {
    const harness = createHarness({ initial: promotedRows(), faults: { cleanup: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.CLEANUP_FAILED,
      details: { committed: false },
    })
    expect(harness.sessions[0]).toMatchObject({ abortCalls: 1, endCalls: 1 })
  })

  test('does not re-enter idempotent finalization when abort itself fails', async () => {
    const initial = promotedRows()
    const harness = createHarness({ initial, faults: { abort: true } })
    await expect(promoteRuntimeStateGraphCandidate({
      candidate: candidate(), actorUserId: IDS.actor, dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_GRAPH_PROMOTION_ERROR_CODES.ROLLBACK_AMBIGUOUS })
    expect(harness.sessions[0]).toMatchObject({ abortCalls: 1, endCalls: 1 })
    expect(harness.db.snapshots).toEqual(initial.snapshots)
    expect(harness.db.elements).toEqual(initial.elements)
  })
})
