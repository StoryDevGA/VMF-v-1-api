import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import mongoose from 'mongoose'

const database = process.env.VMF_RECOVERY_ISOLATED_DB
const baselinePath = process.env.VMF_SNAPSHOT_RECOVERY_BASELINE_PATH
const baselineSha = process.env.VMF_SNAPSHOT_RECOVERY_BASELINE_SHA
const expectedPath = 'C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-16-snapshot-safe-recovery/native-recovery-baseline-private.ejson.json'
const expectedSha = '1daeec72156b58fffd1833090bee23b04ae1df4d835b220c01b00286d44dc850'
const enabled = Boolean(database && baselinePath && baselineSha)
if (enabled && (!/^ss044_[a-f0-9]{32}$/.test(database) || resolve(baselinePath).toLowerCase() !== resolve(expectedPath).toLowerCase() || baselineSha.toLowerCase() !== expectedSha)) {
  throw new Error('Snapshot correction tests require the exact native baseline and isolated UUID database.')
}
const isolated = enabled ? describe : describe.skip
isolated('native snapshot correction existing-replica persistence, no new server', () => {
  let baseline, Recovery, Runtime, Audit, service, reader, auditService, policy, env, serializeRuntimeInstance, owned = false
  const restored = []
  const allowedCollections = new Set(['runtime_instances', 'runtime_evidence_snapshots', 'runtime_product_authority_receipts',
    'runtime_supplemental_finding_reviews', 'runtime_published_disposition_receipts', 'runtime_evidence_sources',
    'runtime_evidence_objects', 'runtime_section_states', 'auditlogs', 'runtime_evidence_snapshot_recoveries'])
  const oid = value => new mongoose.Types.ObjectId(value)
  const hash = value => service ? serviceHash(value) : ''
  let serviceHash, witnessHash
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database)
      || !allowedCollections.has(name)) throw new Error('Isolated database ownership and collection allowlist required.')
    return mongoose.connection.db.collection(name)
  }
  const root = () => collection('runtime_instances').findOne({ _id: baseline.root._id }, { maxTimeMS: 3000 })
  const scope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, oid(policy[key])]))
  const args = () => ({ actorUserId: policy.actorUserId, runtimeInstanceId: policy.runtimeInstanceId,
    scopes: { customer: { _id: policy.customerId }, tenant: { _id: policy.tenantId } }, auditRequest: { requestId: 'isolated-correction-' + randomUUID() } })
  const input = async () => {
    const inspect = await service.inspectRuntimeEvidenceSnapshotRecovery(args())
    return { ...args(), payload: { requestKey: randomUUID(), expectedBasisHash: inspect.expectedBasisHash,
      expectedUpdatedAt: inspect.expectedUpdatedAt, rationale: 'Technical serialization correction only; original failed record and lock history retained.', confirm: true } }
  }
  const passiveControl = async () => {
    // Exact native RECORDED_LOCK_CONTROL_PROJECTION shape, then the ACTUAL
    // production serializer/internal-token attachment. No full legacy fetch.
    const projection = Object.fromEntries([
      '_id', 'runtimeInstanceKey', 'customerId', 'tenantId', 'workspaceId', 'runtimeType', 'frameworkKey', 'packageId', 'packageKey',
      'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'evidence.dependencySnapshotId', 'evidence.dependencySnapshotHash',
      'status', 'executionStatus', 'runtimeMode', 'name', 'description', 'lockedAt', 'lockedBy', 'lockedReason', 'revision.revisionNumber',
      'stateVersion', 'runtimeStateVersion', 'createdAt', 'updatedAt', 'lockedEvidenceSnapshot', 'revision.rootRuntimeId', 'revision.rootRuntimeInstanceKey',
      ...['state', 'locked', 'lockVersion', 'lockedAt', 'lockedBy', 'snapshot.snapshotId', 'snapshot.snapshotHash', 'snapshot.snapshotAt',
        'snapshot.contractVersion', 'snapshot.actionKey', 'replayAnchor.replayAnchorId', 'replayAnchor.replayAnchorHash', 'replayAnchor.relationship',
        'replayAnchor.runtimeInstanceId', 'replayAnchor.runtimeInstanceKey', 'replayAnchor.lockSnapshotId', 'replayAnchor.lockSnapshotHash']
        .map(key => 'framework_state.lock.' + key),
    ].map(key => [key, 1]))
    const selected = await Runtime.collection.findOne({ _id: baseline.root._id }, { projection, maxTimeMS: 3000 })
    expect(selected.framework_state).not.toHaveProperty('sections')
    expect(selected.framework_state).not.toHaveProperty('evidence_pack')
    const serialized = serializeRuntimeInstance(selected)
    expect(serialized).not.toHaveProperty('lockedEvidenceSnapshot')
    expect(serialized.updatedBy).toBeNull()
    expect(Buffer.byteLength(JSON.stringify(serialized))).toBeLessThanOrEqual(16384)
    return { runtime: { ...serialized, _id: serialized.id }, pointer: selected.lockedEvidenceSnapshot }
  }
  const passive = async () => reader.readVerifiedRuntimeEvidenceSnapshot(await passiveControl())
  const originalHashes = async () => {
    const result = { rootMaterial: witnessHash(await root()) }
    for (const name of Object.keys(baseline.collections)) {
      const ids = baseline.collections[name].map(row => row._id)
      const rows = await collection(name).find({ _id: { $in: ids } }, { maxTimeMS: 3000 }).sort({ _id: 1 })
        .limit(ids.length + 1).batchSize(ids.length + 1).toArray()
      expect(rows).toHaveLength(ids.length)
      result[name] = hash(rows)
    }
    return result
  }
  const observed = async () => ({ originals: await originalHashes(), root: hash(await root()),
    corrections: await Recovery.countDocuments({}), audits: await Audit.countDocuments({}) })
  const tamper = async (name, id, update) => {
    const original = await collection(name).findOne({ _id: id }, { maxTimeMS: 3000 })
    restored.push({ name, original })
    await collection(name).updateOne({ _id: id }, update)
  }
  beforeAll(async () => {
    const bytes = readFileSync(baselinePath)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha)
    baseline = mongoose.mongo.BSON.EJSON.parse(bytes.toString('utf8'))
    const actual = await import('../services/runtimeInstanceService.js')
    serializeRuntimeInstance = actual.serializeRuntimeInstance
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...actual,
      getRuntimeInstance: jest.fn(async ({ runtimeInstanceId, scopes, session }) => {
        if (runtimeInstanceId !== String(baseline.root._id) || String(scopes?.customer?._id) !== String(baseline.root.customerId)
          || String(scopes?.tenant?._id) !== String(baseline.root.tenantId)) throw Object.assign(new Error('Simulated scoped selector denied.'), { status: 403 })
        return mongoose.connection.db.collection('runtime_instances').findOne({ _id: baseline.root._id }, { session, maxTimeMS: 3000 })
      }), assertRuntimePermission: jest.fn(async () => true),
    }))
    ;({ default: env } = await import('../config/env.js'))
    ;({ default: Recovery, SNAPSHOT_RECOVERY_POLICY: policy } = await import('../models/RuntimeEvidenceSnapshotRecovery.js'))
    ;({ default: Runtime } = await import('../models/RuntimeInstance.js'))
    ;({ default: Audit } = await import('../models/AuditLog.js'))
    ;({ membershipHash: serviceHash } = await import('../services/runtimeEvidenceSnapshotContract.js'))
    ;({ publishedRuntimeWitnessHash: witnessHash } = await import('../services/publishedDispositionRecoveryService.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
    service = await import('../services/runtimeEvidenceSnapshotRecoveryService.js')
    reader = await import('../services/runtimeEvidenceSnapshotService.js')
    if (mongoose.connection.readyState !== 0) throw new Error('Fresh disconnected connection required.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String)); expect(hello.isWritablePrimary).toBe(true)
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    expect(Object.keys(baseline.collections).sort()).toEqual(['auditlogs', 'runtime_evidence_objects', 'runtime_evidence_snapshots',
      'runtime_evidence_sources', 'runtime_product_authority_receipts', 'runtime_published_disposition_receipts',
      'runtime_section_states', 'runtime_supplemental_finding_reviews'].sort())
    for (const [name, records] of Object.entries(baseline.collections)) {
      await mongoose.connection.db.createCollection(name)
      await collection(name).insertMany(records)
    }
    await Runtime.createCollection(); await Runtime.collection.insertOne(baseline.root)
    await Recovery.createCollection(); await Recovery.createIndexes()
    expect(baseline.collections.auditlogs).toHaveLength(128)
    expect(baseline.collections.auditlogs.every(row => Audit.hydrate(row).verifySignature())).toBe(true)
  }, 30000)
  beforeEach(async () => {
    expect(owned).toBe(true)
    await Runtime.collection.replaceOne({ _id: baseline.root._id }, baseline.root)
    await Recovery.collection.deleteMany({})
    await Audit.collection.deleteMany({ _id: { $nin: baseline.collections.auditlogs.map(row => row._id) } })
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    while (restored.length) { const row = restored.pop(); await collection(row.name).replaceOne({ _id: row.original._id }, row.original) }
  })
  afterAll(async () => { await mongoose.disconnect() })
  test('real create/raw read/passive verification preserves failed document and original lock; replay is read-only', async () => {
    const before = await originalHashes(), request = await input(), recorded = await service.recordRuntimeEvidenceSnapshotRecovery(request)
    const raw = await Recovery.collection.findOne(scope())
    expect(raw.body.original.documentHash).toBe(policy.originalDocumentHash)
    expect(hash(raw.body.correctedBody)).toBe(policy.membershipHash)
    expect(raw.body.correctedBody.sections.find(row => row.sectionKey === 'output_requirements').references).toEqual({})
    const result = await passive()
    expect(result).toMatchObject({ available: true, completeness: 'VERIFIED', counts: { sources: 8, evidence: 47, sections: 6 },
      serializationCorrection: { receiptId: recorded.receipt.receiptId, originalBodyHash: policy.failedBodyHash, authorisesARL: false } })
    expect(await originalHashes()).toEqual(before)
    const committed = await observed()
    expect(await service.recordRuntimeEvidenceSnapshotRecovery(request)).toMatchObject({ replay: true, receipt: { receiptId: recorded.receipt.receiptId } })
    expect(await observed()).toEqual(committed)
  }, 30000)
  test('a missing correction never reconstructs a success merely because original members still exist', async () => {
    const before = await observed()
    await expect(passive()).rejects.toMatchObject({ details: { reason: 'CORRECTION_REQUIRED' } })
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['audit', 'receipt'])('required %s write failure rolls back receipt, audit and metadata CAS', async kind => {
    const request = await input(), before = await observed()
    const spy = kind === 'audit' ? jest.spyOn(auditService, 'log') : jest.spyOn(Recovery, 'create')
    spy.mockRejectedValue(new Error('Controlled required write failure'))
    await expect(service.recordRuntimeEvidenceSnapshotRecovery(request)).rejects.toThrow('Controlled required write failure')
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['identical', 'different'])('concurrent %s requests commit one winner only', async kind => {
    const a = await input(), b = kind === 'identical' ? a : { ...a, payload: { ...a.payload, requestKey: randomUUID() } }
    const before = await Audit.countDocuments({})
    const results = await Promise.allSettled([service.recordRuntimeEvidenceSnapshotRecovery(a), service.recordRuntimeEvidenceSnapshotRecovery(b)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(kind === 'identical' ? 2 : 1)
    expect(await Recovery.countDocuments({})).toBe(1); expect(await Audit.countDocuments({})).toBe(before + 1)
    expect(await passive()).toMatchObject({ completeness: 'VERIFIED' })
  }, 30000)
  test.each(['actor', 'scope', 'timestamp', 'state', 'pointer'])('rejects changed %s without writes', async kind => {
    let request = await input()
    if (kind === 'actor') request = { ...request, actorUserId: '698b3800f83b3257365fd7a3' }
    if (kind === 'scope') request = { ...request, scopes: { ...request.scopes, tenant: { _id: '698b3800f83b3257365fd7a3' } } }
    if (kind === 'timestamp') request.payload.expectedUpdatedAt = '2026-10-16T18:00:00.000Z'
    if (kind === 'state') await Runtime.collection.updateOne({ _id: baseline.root._id }, { $set: { stateVersion: 'rsv2:' + randomUUID() } })
    if (kind === 'pointer') await Runtime.collection.updateOne({ _id: baseline.root._id }, { $set: { 'lockedEvidenceSnapshot.membershipHash': '0'.repeat(64) } })
    const before = await observed()
    await expect(service.recordRuntimeEvidenceSnapshotRecovery(request)).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['snapshot', 'member', 'original-audit', 'correction-body', 'correction-audit', 'correction-control'])('tampered %s cannot yield a verified passive read', async kind => {
    await service.recordRuntimeEvidenceSnapshotRecovery(await input())
    const record = await Recovery.findOne({}).lean()
    if (kind === 'snapshot') await tamper('runtime_evidence_snapshots', oid(policy.snapshotStorageId), { $set: { 'body.counts.evidence': 46 } })
    if (kind === 'member') await tamper('runtime_evidence_objects', baseline.collections.runtime_evidence_objects[0]._id, { $set: { extractedFact: 'Tampered admitted passage.' } })
    if (kind === 'original-audit') await tamper('auditlogs', oid(policy.lockAuditId), { $set: { signature: '0'.repeat(64) } })
    if (kind === 'correction-body') await Recovery.collection.updateOne({ _id: record._id }, { $set: { 'body.rationale': 'Tampered recovery rationale.' } })
    if (kind === 'correction-audit') await tamper('auditlogs', record.auditId, { $set: { signature: '0'.repeat(64) } })
    if (kind === 'correction-control') await Runtime.collection.updateOne({ _id: baseline.root._id }, { $set: { updatedAt: new Date() } })
    const before = await observed()
    await expect(passive()).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test('missing authoritative unique index fails closed before a recovery write', async () => {
    const request = await input(), before = await observed()
    await Recovery.collection.dropIndex('unique_scoped_snapshot_recovery_request')
    try {
      await expect(service.recordRuntimeEvidenceSnapshotRecovery(request)).rejects.toMatchObject({ details: { reason: 'INDEX_NOT_READY' } })
      expect(await observed()).toEqual(before)
    } finally { await Recovery.createIndexes() }
  }, 30000)
  test.each(['timestamp', 'package', 'pointer'])('actual partial serialized caller with changed %s is rejected', async kind => {
    await service.recordRuntimeEvidenceSnapshotRecovery(await input())
    const args = await passiveControl()
    if (kind === 'timestamp') args.runtime.updatedAt = new Date(0)
    if (kind === 'package') args.runtime.packageVersion = 'changed'
    if (kind === 'pointer') args.pointer = { ...args.pointer, membershipHash: '0'.repeat(64) }
    const before = await observed()
    await expect(reader.readVerifiedRuntimeEvidenceSnapshot(args)).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test('same key with changed payload cannot reuse a committed attestation', async () => {
    const request = await input(); await service.recordRuntimeEvidenceSnapshotRecovery(request)
    const before = await observed()
    await expect(service.recordRuntimeEvidenceSnapshotRecovery({ ...request, payload: { ...request.payload, rationale: 'Different recovery rationale cannot be replayed.' } })).rejects.toMatchObject({ details: { reason: 'REPLAY_CONFLICT' } })
    expect(await observed()).toEqual(before)
  }, 30000)
  test('model rejects rehashed checksum, authority and request mutations before storage', async () => {
    await service.recordRuntimeEvidenceSnapshotRecovery(await input())
    const original = await Recovery.findOne({}).lean(), before = await observed()
    for (const change of [row => { row.body.correctedBody.counts.evidence = 46 }, row => { row.body.actorUserId = '698b3800f83b3257365fd7a3' },
      row => { row.body.original.documentHash = '0'.repeat(64) }, row => { row.body.requestBasis.expectedBasisHash = '0'.repeat(64) }]) {
      const row = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(original))
      change(row); row.bodyHash = hash(row.body); delete row._id
      await expect(new Recovery(row).save({ validateBeforeSave: false })).rejects.toThrow()
    }
    expect(await observed()).toEqual(before)
  }, 30000)
})
