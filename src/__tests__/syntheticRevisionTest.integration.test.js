import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals'
import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

// Explicit opt-in only. No listener, native database write or runtime action.
const database = process.env.VMF_R3_TEST_RECEIPT_DB
if (database && !/^ss044_[a-f0-9]{32}$/.test(database)) throw new Error('Isolated UUID database required.')
const isolated = database ? describe : describe.skip
isolated('R3 test-only receipt isolated real transactions; engineering decisions only', () => {
  let owned = false, permit = true, cache, p, env, Receipt, Audit, service, auditService, hash
  const names = ['runtime_instances', 'runtime_evidence_sources', 'runtime_evidence_objects',
    'runtime_section_states', 'runtime_synthetic_revision_receipts', 'auditlogs']
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !names.includes(name)) throw new Error('QA namespace not owned.')
    return mongoose.connection.db.collection(name)
  }
  const args = () => ({ actorUserId: p.recorderUserId, runtimeInstanceId: p.runtimeInstanceId,
    scopes: { platformRoles: ['SUPER_ADMIN'], customer: { _id: p.customerId }, tenant: { _id: p.tenantId } } })
  const root = () => collection('runtime_instances').findOne({ _id: new mongoose.Types.ObjectId(p.runtimeInstanceId) })
  const observed = async () => Object.fromEntries(await Promise.all(names.map(async n => [n,
    hash(await collection(n).find({}).sort({ _id: 1 }).toArray())])))
  const request = async (disposition = 'NOT_CONTRADICTORY') => {
    const basis = await service.inspectSyntheticRevisionDisposition(args())
    return { ...args(), payload: { requestKey: randomUUID(), expectedBasisHash: basis.expectedBasisHash,
      expectedUpdatedAt: basis.expectedUpdatedAt, disposition,
      amendmentDocumentText: readFileSync(new URL('../../../docs/generated/harness-runs/ss-044/2026-10-16-synthetic-amendment-preflight/amendment-v1.json', import.meta.url), 'utf8'),
      rationale: 'ENGINEERING FIXTURE ONLY: compatible synthetic boundaries. Not an actual human decision.',
      decisionSource: { reference: 'isolated-engineering-fixture:' + database,
        text: 'ENGINEERING INPUT ONLY. This does not submit Angus or Andrew adjudication.', decidedAt: new Date().toISOString() },
      conflictDisclosed: true, recorderAttestsDecision: true, confirm: true } }
  }
  const completion = async () => ({ ...args(), payload: { requestKey: randomUUID(),
    expectedPopulationHash: (await service.inspectSyntheticRevisionCompletion(args())).expectedPopulationHash,
    rationale: 'ENGINEERING FIXTURE ONLY: explicit non-authoritative test completion.', confirm: true } })
  beforeAll(async () => {
    const bytes = readFileSync(process.env.VMF_R3_TEST_BASIS_CACHE)
    if (createHash('sha256').update(bytes).digest('hex') !== 'bf33c96479909ef6778ebd8d737050b36339dedeefb62350a84656d12df8bacc') throw new Error('Exact read-only fixture cache required.')
    cache = mongoose.mongo.BSON.EJSON.parse(bytes.toString(), { relaxed: true })
    const unexpected = () => { throw new Error('Unexpected execution dependency.') }
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
      RUNTIME_INSTANCE_ERROR_REASONS: {}, RUNTIME_INSTANCE_RENDERER_PROJECTION: '',
      toIdString: v => String(v || ''), normalizeToken: v => String(v || '').trim().toUpperCase(),
      createRuntimeInstanceError: unexpected, assertCustomerTenantContext: unexpected,
      assertFeatureEntitlement: unexpected, getFeatureForRuntimeType: unexpected, serializeRuntimeInstance: unexpected,
      getRuntimeInstance: async ({ runtimeInstanceId, scopes, session }) => {
        if (runtimeInstanceId !== p.runtimeInstanceId || scopes?.customer?._id !== p.customerId || scopes?.tenant?._id !== p.tenantId)
          throw Object.assign(new Error('Denied QA scope'), { status: 403, code: 'FORBIDDEN' })
        const value = await collection('runtime_instances').findOne({ _id: new mongoose.Types.ObjectId(p.runtimeInstanceId) }, { session })
        return { ...value, id: String(value._id) }
      },
      assertRuntimePermission: async ({ permission }) => {
        if (!permit || permission !== 'VMF_UPDATE') throw Object.assign(new Error('Denied QA permission'), { status: 403, code: 'FORBIDDEN' })
      },
    }))
    ;({ default: env } = await import('../config/env.js'))
    ;({ SYNTHETIC_REVISION_TEST_POLICY: p } = await import('../constants/syntheticRevisionTestPolicy.js'))
    ;({ default: Receipt } = await import('../models/RuntimeSyntheticRevisionReceipt.js'))
    ;({ default: Audit } = await import('../models/AuditLog.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
    ;({ membershipHash: hash } = await import('../services/runtimeEvidenceSnapshotContract.js'))
    service = await import('../services/syntheticRevisionTestService.js')
    if (mongoose.connection.readyState !== 0 || env.appEnv !== 'development'
      || new URL(env.mongoUri).hostname !== 'vmf-v1.fxsnmwy.mongodb.net') throw new Error('Fresh approved Development cluster required.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 3, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    for (const n of names) await mongoose.connection.db.createCollection(n)
    await Receipt.createIndexes()
  }, 30000)
  beforeEach(async () => {
    permit = true
    for (const n of names) await collection(n).deleteMany({})
    await Receipt.createIndexes()
    const c = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(cache), { relaxed: true })
    await collection('runtime_instances').insertOne(c.root)
    for (const n of names.slice(1, 4)) {
      const rows = c.reads.filter(r => r.collection === n).flatMap(r => r.rows)
      await collection(n).insertMany([...new Map(rows.map(r => [String(r._id), r])).values()])
    }
  }, 20000)
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => { await mongoose.disconnect() }, 20000)
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('signed %s receipt preserves all source/history and only NOT permits test completion', async disposition => {
    const before = await observed(), input = await request(disposition)
    const saved = await service.recordSyntheticRevisionDisposition(input)
    expect(saved.receipt).toMatchObject({ disposition, authoritative: false, execution: 'HELD', lockExecuted: false, arlExecuted: false })
    expect((await service.recordSyntheticRevisionDisposition(input)).replay).toBe(true)
    expect((await service.inspectSyntheticRevisionDisposition(args())).receipt).toEqual(saved.receipt)
    const record = await Receipt.findOne({ kind: 'DISPOSITION' }).lean()
    expect((await Audit.findById(record.auditId)).verifySignature()).toBe(true)
    if (disposition === 'NOT_CONTRADICTORY') {
      const c = await completion(), result = await service.recordSyntheticRevisionCompletion(c)
      expect(result.receipt.receiptType).toBe('NON_AUTHORITATIVE_TEST_COMPLETION_RECEIPT')
      expect((await service.recordSyntheticRevisionCompletion(c)).replay).toBe(true)
      expect((await service.inspectSyntheticRevisionCompletion(args())).receipt).toEqual(result.receipt)
    } else await expect(service.recordSyntheticRevisionCompletion(await completion())).rejects.toMatchObject({ details: { reason: 'TEST_FINDING_BLOCKING' } })
    const after = await observed()
    for (const n of names.slice(0, 4)) expect(after[n]).toBe(before[n])
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(names.length)
  }, 30000)
  test.each([true, false])('concurrent retry sameKey=%s yields one committed signed result', async same => {
    const a = await request(), b = same ? a : { ...a, payload: { ...a.payload, requestKey: randomUUID() } }
    const results = await Promise.allSettled([service.recordSyntheticRevisionDisposition(a), service.recordSyntheticRevisionDisposition(b)])
    const wins = results.filter(r => r.status === 'fulfilled')
    expect(wins).toHaveLength(same ? 2 : 1)
    expect(wins.filter(r => !r.value.replay)).toHaveLength(1)
    expect(await Receipt.countDocuments()).toBe(1); expect(await Audit.countDocuments()).toBe(1)
  }, 30000)
  test.each(['audit', 'receipt', 'restore'])('real rollback on %s write failure restores root, receipts and audits', async failure => {
    const input = await request(), before = await observed()
    if (failure === 'audit') jest.spyOn(auditService, 'log').mockRejectedValue(new Error('Injected required audit failure'))
    if (failure === 'receipt') jest.spyOn(Receipt, 'create').mockRejectedValue(new Error('Injected receipt failure after audit write'))
    if (failure === 'restore') {
      const proto = Object.getPrototypeOf(collection('runtime_instances')), original = proto.updateOne
      jest.spyOn(proto, 'updateOne').mockImplementation(function (filter, update, options) {
        return this.collectionName === 'runtime_instances' && update.$inc?.__v === -1
          ? Promise.resolve({ modifiedCount: 0 }) : original.call(this, filter, update, options)
      })
    }
    await expect(service.recordSyntheticRevisionDisposition(input)).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['permission', 'recorder', 'scope', 'stale', 'lifecycle'])('rejects %s without persistence', async failure => {
    const input = await request()
    if (failure === 'permission') permit = false
    if (failure === 'recorder') input.actorUserId = '6a6c763dcace7a21bd41efa9'
    if (failure === 'scope') input.scopes.tenant._id = new mongoose.Types.ObjectId().toString()
    if (failure === 'stale') input.payload.expectedUpdatedAt = '2026-10-19T00:00:00Z'
    if (failure === 'lifecycle') await collection('runtime_instances').updateOne({}, { $set: { 'framework_state.lifecycle.stage': 'PUBLISHED' } })
    const before = await observed()
    await expect(service.recordSyntheticRevisionDisposition(input)).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test('missing unique index rejects without writing', async () => {
    const input = await request(); await Receipt.collection.dropIndex('unique_synthetic_revision_kind')
    const before = await observed()
    await expect(service.recordSyntheticRevisionDisposition(input)).rejects.toMatchObject({ details: { reason: 'UNIQUE_INDEX_REQUIRED' } })
    expect(await observed()).toEqual(before)
  }, 30000)
  test('actual transaction consumer rejects missing completion; no lock action dispatched', async () => {
    await service.recordSyntheticRevisionDisposition(await request())
    const session = await mongoose.startSession()
    try {
      await expect(session.withTransaction(async () => {
        await collection('runtime_instances').updateOne({}, { $set: { 'framework_state.publish.published': true } }, { session })
        await service.verifySyntheticRevisionForLock(await root(), session)
      })).rejects.toMatchObject({ details: { reason: 'RECEIPT_REQUIRED' } })
    } finally { await session.endSession() }
    expect((await root()).framework_state.publish.published).not.toBe(true)
  }, 30000)
  test('signed simulated lifecycle consumer/readback verifies complete chain; no native action dispatched', async () => {
    await service.recordSyntheticRevisionDisposition(await request())
    await service.recordSyntheticRevisionCompletion(await completion())
    const transition = async (action, set, link) => {
      const before = await root(), next = `rsv2:${randomUUID()}`, now = new Date(Date.now() + 1000)
      await collection('runtime_instances').updateOne({}, { $set: { ...set, stateVersion: next, updatedAt: now } })
      for (const n of names.slice(1, 4)) {
        await collection(n).updateMany({ current: true }, { $set: { stateVersion: next, sourceStateVersion: next } })
        if (n === 'runtime_section_states') await collection(n).updateMany({ current: true }, { $set: { 'projectionReceipt.stateVersion': next } })
      }
      const a = new Audit({ actorUserId: p.recorderUserId, resourceId: p.runtimeInstanceId,
        action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
        scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].map(k => [k, p[k]])),
        diff: { actionKey: action, syntheticTestStateTransition: { from: before.stateVersion, to: next },
          updatedAtBefore: before.updatedAt.toISOString(), updatedAtAfter: now.toISOString(),
          runtimeStateSource: { sourceSetHash: 'ISOLATED_COMPONENT_FIXTURE_NOT_NATIVE_ACTION' },
          ...(link ? { syntheticTestCompletion: link } : {}) } })
      a.generateSignature(); await collection('auditlogs').insertOne(a.toObject()); return a.toObject()
    }
    await transition('PUBLISH', { 'framework_state.publish.published': true, 'framework_state.lifecycle.stage': 'PUBLISHED' })
    const session = await mongoose.startSession()
    let link
    try { await session.withTransaction(async () => { link = await service.verifySyntheticRevisionForLock(await root(), session) }) }
    finally { await session.endSession() }
    expect(link).toMatchObject({ authoritative: false, classification: p.classification, materialHash: p.initialMaterialHash })
    const audit = await transition('LOCK_RECORD', { status: 'LOCKED', 'framework_state.lock.locked': true,
      'framework_state.lifecycle.stage': 'LOCKED' }, link)
    const current = await root()
    await expect(service.verifySyntheticRevisionLockLink({ runtime: current, audit })).resolves.toBeUndefined()
    audit.diff.syntheticTestCompletion.materialHash = 'forged'
    await expect(service.verifySyntheticRevisionLockLink({ runtime: current, audit })).rejects.toThrow()
  }, 30000)
})
