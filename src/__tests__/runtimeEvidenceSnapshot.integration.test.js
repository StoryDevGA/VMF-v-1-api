import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import AuditLog from '../models/AuditLog.js'
import env from '../config/env.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { hashSectionHistoryPair } from '../services/runtimeSectionHistoryContract.js'
import { prepareRuntimeEvidenceSnapshot, persistRuntimeEvidenceSnapshot, readVerifiedRuntimeEvidenceSnapshot } from '../services/runtimeEvidenceSnapshotService.js'

// Explicit opt-in; uses the configured replica, never starts a database/server.
const database = process.env.VMF_SNAPSHOT_ISOLATED_DB
if (database && !/^snap_[a-f0-9]{32}$/.test(database)) throw new Error('Snapshot tests require an isolated UUID database.')
const isolated = database ? describe : describe.skip
const names = ['runtime_evidence_snapshots', 'auditlogs', 'runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_section_states']
isolated('immutable snapshot real serialization round trip', () => {
  let owned = false
  const assertIsolated = () => {
    if (!owned || mongoose.connection.name !== database || !/^snap_[a-f0-9]{32}$/.test(database)) {
      throw new Error('Snapshot fixture database ownership is unavailable.')
    }
  }
  const collection = name => {
    assertIsolated()
    if (!names.includes(name)) throw new Error('Collection is outside the snapshot fixture.')
    return mongoose.connection.db.collection(name)
  }
  const fixture = () => {
    const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'))
    const at = '2026-10-16T12:00:00.000Z', stateVersion = `rsv2:${randomUUID()}`
    const runtime = { _id: oid(1), customerId: oid(2), tenantId: oid(3), runtimeInstanceKey: 'snapshot-roundtrip-synthetic',
      workspaceId: '', revision: { revisionNumber: 1 }, packageId: oid(4), packageKey: 'snapshot-fixture', packageVersion: '1.0',
      dependencyLockId: 'fixture-dependency', activationId: 'fixture-activation', deploymentId: 'fixture-deployment', stateVersion,
      status: 'LOCKED', lockedAt: new Date(at), lockedBy: oid(9), framework_state: { lock: { locked: true, snapshot: {
        snapshotId: 'fixture-truth-lock', snapshotHash: 'a'.repeat(64), snapshotAt: at,
        contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } } } }
    const common = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
      runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion, sourceStateVersion: stateVersion,
      sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId: oid(5), current: true, createdAt: new Date(at), updatedAt: new Date(at) }
    return { runtime, oid, at, rows: {
      runtime_evidence_sources: [{ ...common, _id: oid(6), sourceId: 'source-1', contentHash: 'sha256:' + 'c'.repeat(64) }],
      runtime_evidence_objects: [{ ...common, _id: oid(7), evidenceObjectId: 'evidence-1', sourceId: 'source-1',
        extractedFact: 'Disposable synthetic fixture only; no trial authorised.', reviewStatus: 'ACCEPTED' }],
      runtime_section_states: [
        { ...common, _id: oid(8), sectionKey: 'output_requirements', sectionDetail: { accepted: {} } },
        { ...common, _id: oid(11), sectionKey: 'source_section', sectionDetail: { accepted: { evidenceRefs: ['source-1'] } } },
      ],
    } }
  }
  const counts = async () => ({ snapshots: await collection('runtime_evidence_snapshots').countDocuments(), audits: await collection('auditlogs').countDocuments() })
  const prepare = async f => {
    for (const [name, rows] of Object.entries(f.rows)) await collection(name).insertMany(rows)
    const session = await mongoose.startSession()
    let prepared
    try { await session.withTransaction(async () => { prepared = await prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session }) }) }
    finally { await session.endSession() }
    return prepared
  }
  const auditFor = (f, p) => new AuditLog({ actorUserId: f.oid(9), action: 'RUNTIME_ACTION_EXECUTED',
    resourceType: 'RuntimeInstance', resourceId: f.runtime._id,
    scope: { customerId: f.runtime.customerId, tenantId: f.runtime.tenantId, runtimeInstanceId: f.runtime._id, runtimeInstanceKey: f.runtime.runtimeInstanceKey },
    diff: { actionKey: 'LOCK_RECORD', actionedAt: f.at, evidenceMembershipSnapshot: { ...p.pointer, counts: p.body.counts } } })
  const persist = async (f, p, mode = 'service', abort = false) => {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const audit = auditFor(f, p)
        audit.generateSignature()
        await audit.save({ session })
        const data = { ...p.body.scope, ...p.pointer, body: p.body, createdBy: f.oid(9), createdAt: f.at,
          lockAuditId: audit._id, lockAuditSignatureVersion: audit.signatureVersion }
        if (mode === 'service') await persistRuntimeEvidenceSnapshot({ prepared: p, actorUserId: f.oid(9), audit, session })
        else if (mode === 'save') await new RuntimeEvidenceSnapshot(data).save({ session })
        else if (mode === 'insertMany') await RuntimeEvidenceSnapshot.insertMany([data], { session })
        else await RuntimeEvidenceSnapshot.bulkWrite([{ insertOne: { document: data } }], { session })
        if (abort) throw new Error('Intentional isolated transaction abort')
      })
    } finally { await session.endSession() }
  }
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) throw new Error('Snapshot tests require a disconnected Mongoose connection.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    expect(hello.isWritablePrimary).toBe(true)
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    for (const name of names) await mongoose.connection.db.createCollection(name)
    await RuntimeEvidenceSnapshot.createIndexes()
  }, 30000)
  beforeEach(async () => {
    for (const name of names) await collection(name).deleteMany({})
  })
  afterAll(async () => { await mongoose.disconnect() })
  test.each(['service', 'save', 'insertMany', 'bulkWrite'])('%s retains exact raw body/hash, audit and verified historical inventory', async mode => {
    const f = fixture(), p = await prepare(f), originalRowsHash = membershipHash(f.rows)
    expect(p.body.sections.find(row => row.sectionKey === 'output_requirements').references).toEqual({})
    await persist(f, p, mode)
    const saved = await collection('runtime_evidence_snapshots').findOne({ snapshotId: p.pointer.snapshotId })
    expect(saved.body).toEqual(p.body)
    expect(membershipHash(saved.body)).toBe(saved.membershipHash)
    expect(saved.membershipHash).toBe(p.pointer.membershipHash)
    const audit = await AuditLog.findById(saved.lockAuditId)
    expect(audit.verifySignature()).toBe(true)
    expect(await readVerifiedRuntimeEvidenceSnapshot({ runtime: f.runtime, pointer: p.pointer })).toMatchObject({
      completeness: 'VERIFIED', counts: { sources: 1, evidence: 1, sections: 2 } })
    const actual = {}
    for (const name of Object.keys(f.rows)) actual[name] = await collection(name).find({}).sort({ _id: 1 }).toArray()
    expect(membershipHash(actual)).toBe(originalRowsHash)
    expect(await counts()).toEqual({ snapshots: 1, audits: 1 })
  }, 30000)
  test.each(['missing-reference-map', 'hash-mismatch'])('rejects %s and rolls back the accompanying audit', async kind => {
    const f = fixture(), p = await prepare(f)
    if (kind === 'missing-reference-map') delete p.body.sections.find(row => row.sectionKey === 'output_requirements').references
    else p.pointer.membershipHash = 'd'.repeat(64)
    await expect(persist(f, p)).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' })
    expect(await counts()).toEqual({ snapshots: 0, audits: 0 })
  }, 30000)
  test('frozen reference history is verified from retained native material and rejects a changed target', async () => {
    const f = fixture(), current = f.rows.runtime_section_states[1]
    const historicalState = `rsv2:${randomUUID()}`
    const pair = { generated: { content: 'Original synthetic section; no trial authority.' }, accepted: null }
    const reference = { version: 'runtime-section-history.v1', stateVersion: historicalState,
      sourceHash: current.sourceHash, index: -1, hash: hashSectionHistoryPair(pair), hasGenerated: true, hasAccepted: false }
    const history = { ...current, _id: f.oid(12), current: false, stateVersion: historicalState, sourceStateVersion: historicalState,
      legacyPath: `framework_state.sections.${current.sectionKey}`,
      projectionReceipt: { algorithm: 'ss014-legacy-domain-canonical-json-v1', stateVersion: historicalState,
        sourceHash: current.sourceHash, logicalPath: `framework_state.sections.${current.sectionKey}` },
      sectionDetail: { ...pair, revisions: [] } }
    current.sectionDetail.revisions = [{ revisionNumber: 1, generated: null, historyReference: reference }]
    await collection('runtime_section_states').insertOne(history)
    const p = await prepare(f)
    await persist(f, p)
    expect(await readVerifiedRuntimeEvidenceSnapshot({ runtime: f.runtime, pointer: p.pointer })).toMatchObject({ completeness: 'VERIFIED' })
    await collection('runtime_section_states').updateOne({ _id: history._id }, { $set: { 'sectionDetail.generated.content': 'Changed material' } })
    await expect(readVerifiedRuntimeEvidenceSnapshot({ runtime: f.runtime, pointer: p.pointer })).rejects.toMatchObject({
      code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'REFERENCE_HASH_MISMATCH' },
    })
    expect(await counts()).toEqual({ snapshots: 1, audits: 1 })
  }, 30000)

  test('an aborted transaction retains no snapshot or signed success audit', async () => {
    const f = fixture(), p = await prepare(f)
    await expect(persist(f, p, 'service', true)).rejects.toThrow('Intentional isolated transaction abort')
    expect(await counts()).toEqual({ snapshots: 0, audits: 0 })
  }, 30000)
  test('existing unique lock index and immutable mutation guard preserve the original snapshot', async () => {
    const f = fixture(), p = await prepare(f)
    await persist(f, p)
    const before = await collection('runtime_evidence_snapshots').findOne({ snapshotId: p.pointer.snapshotId })
    const next = { ...p, pointer: { ...p.pointer, snapshotId: `evidence_snapshot_${randomUUID()}` } }
    await expect(persist(f, next)).rejects.toMatchObject({ code: 11000 })
    await expect(RuntimeEvidenceSnapshot.updateOne({ _id: before._id }, { $set: { body: {} } })).rejects.toMatchObject({ details: { reason: 'SNAPSHOT_IMMUTABLE' } })
    expect(await collection('runtime_evidence_snapshots').findOne({ _id: before._id })).toEqual(before)
    expect(await counts()).toEqual({ snapshots: 1, audits: 1 })
  }, 30000)
})
