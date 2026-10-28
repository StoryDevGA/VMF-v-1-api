import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

const database = process.env.VMF_SYNTHETIC_RECEIPT_DB
const enabled = Boolean(database)
if (enabled && !/^ss044_[a-f0-9]{32}$/.test(database)) throw new Error('An exact isolated UUID database is required.')
const evidenceRoot = 'C:/Dev/StoryLineOS/VMF-Evidence/ss-044/'
const baselinePath = evidenceRoot + '2026-10-15-required-sections/lifecycle/handoff-reconciliation/readback-private.ejson.json'
const authorityPath = evidenceRoot + '2026-10-16-native-product-authority/native-record-readback.json'
const authorityAuditPath = evidenceRoot + '2026-10-16-native-product-authority/native-audit-readback.json'
const amendmentPath = 'C:/Dev/StoryLineOS/VMF-APP/dev-v1/docs/generated/harness-runs/ss-044/2026-10-16-synthetic-amendment-preflight/amendment-v1.json'
const bytes = (path, hash) => {
  const data = readFileSync(path)
  if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('Exact cached fixture hash required.')
  return data.toString('utf8')
}
const isolated = enabled ? describe : describe.skip
isolated('synthetic test receipt real persistence (engineering inputs, never actual Angus decisions)', () => {
  let Receipt, Runtime, Authority, Audit, env, service, recovery, auditService, hash, policy
  let baselineText, authorityText, authorityAuditText, amendmentText, owned = false, permit = true
  const names = ['runtime_instances', 'runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_section_states',
    'runtime_product_authority_receipts', 'runtime_synthetic_test_disposition_receipts', 'auditlogs']
  const assertOwned = () => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database))
      throw new Error('Isolated database ownership unavailable.')
  }
  const collection = name => {
    assertOwned()
    if (!names.includes(name)) throw new Error('Collection not allowlisted for QA writes.')
    return mongoose.connection.db.collection(name)
  }
  const decode = () => mongoose.mongo.BSON.EJSON.parse(baselineText)
  const args = () => ({ actorUserId: '698b3800f83b3257365fd7a3', runtimeInstanceId: policy.scope.runtimeInstanceId,
    scopes: { platformRoles: ['SUPER_ADMIN'], customer: { _id: policy.scope.customerId }, tenant: { _id: policy.scope.tenantId } },
    auditRequest: { requestId: 'isolated-synthetic-engineering-test-' + randomUUID() } })
  const root = () => collection('runtime_instances').findOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId) })
  const request = async (disposition = 'REOPENED') => {
    const inspect = await service.inspectSyntheticTestDisposition(args())
    return { ...args(), payload: { requestKey: randomUUID(), expectedBasisHash: inspect.expectedBasisHash,
      expectedUpdatedAt: inspect.expectedUpdatedAt, amendmentDocumentText: amendmentText, disposition,
      rationale: 'Isolated engineering validator input; not an operational Angus adjudication.',
      decisionSource: { reference: 'isolated-engineering-input:' + database,
        text: 'ENGINEERING TEST INPUT ONLY. This copied fixture does not record an actual Angus decision.',
        decidedAt: '2026-10-16T15:27:18Z' }, conflictDisclosed: true, recorderAttestsDecision: true, confirm: true } }
  }
  const observed = async () => {
    const result = {}
    for (const name of names) result[name] = hash(await collection(name).find({}).sort({ _id: 1 }).toArray())
    return result
  }
  const unchanged = async operation => {
    const before = await observed()
    await operation()
    expect(await observed()).toEqual(before)
  }
  beforeAll(async () => {
    baselineText = bytes(baselinePath, 'cc9d3e58c060514e69c50b21067105b386ada86a087de24bcb61bf75e4efeab5')
    authorityText = bytes(authorityPath, '36118f138de36707838494d679d2200ab28e26b5086435fd088c61aa1adf6861')
    authorityAuditText = bytes(authorityAuditPath, '5db79a6a772d3aa7570177b189f95fc819d3e51b64220997bba0286dbf8a6192')
    amendmentText = bytes(amendmentPath, '5f1f39d75a4a1b5b6d32eb9eb8e122d1dd12ccf169c7f0f6e62e6a3de2e4634b')
    const unexpected = () => { throw new Error('Unexpected runtime execution dependency in receipt-only QA.') }
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
      RUNTIME_INSTANCE_ERROR_REASONS: {}, RUNTIME_INSTANCE_RENDERER_PROJECTION: '',
      toIdString: value => String(value || ''), normalizeToken: value => String(value || '').trim().toUpperCase(),
      createRuntimeInstanceError: unexpected, assertCustomerTenantContext: unexpected,
      assertFeatureEntitlement: unexpected, getFeatureForRuntimeType: unexpected, serializeRuntimeInstance: unexpected,
      getRuntimeInstance: async ({ runtimeInstanceId, scopes, session }) => {
        if (runtimeInstanceId !== policy.scope.runtimeInstanceId || scopes?.customer?._id !== policy.scope.customerId
          || scopes?.tenant?._id !== policy.scope.tenantId)
          throw Object.assign(new Error('Denied isolated scope'), { status: 403, code: 'FORBIDDEN' })
        const runtime = await collection('runtime_instances').findOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId) }, { session })
        return { ...runtime, id: String(runtime._id) }
      },
      assertRuntimePermission: async ({ permission }) => {
        if (!permit || permission !== 'VMF_UPDATE') throw Object.assign(new Error('Denied isolated permission'), { code: 'FORBIDDEN', status: 403 })
      },
    }))
    ;({ default: env } = await import('../config/env.js'))
    ;({ default: Receipt } = await import('../models/RuntimeSyntheticTestDispositionReceipt.js'))
    ;({ default: Runtime } = await import('../models/RuntimeInstance.js'))
    ;({ default: Authority } = await import('../models/RuntimeProductAuthorityReceipt.js'))
    ;({ default: Audit } = await import('../models/AuditLog.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
    ;({ membershipHash: hash } = await import('../services/runtimeEvidenceSnapshotContract.js'))
    ;({ PUBLISHED_DISPOSITION_POLICY: policy } = await import('../constants/publishedDispositionRecoveryPolicy.js'))
    service = await import('../services/syntheticTestDispositionService.js')
    recovery = await import('../services/publishedDispositionRecoveryService.js')
    if (mongoose.connection.readyState !== 0) throw new Error('Fresh disconnected connection required.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 3, serverSelectionTimeoutMS: 10000 })
    expect(env.appEnv).toBe('development')
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    expect(hello.isWritablePrimary).toBe(true)
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    for (const name of names) await mongoose.connection.db.createCollection(name)
    await Receipt.createIndexes()
  }, 30000)
  beforeEach(async () => {
    assertOwned(); permit = true
    for (const name of names) await collection(name).deleteMany({})
    const indexes = await Receipt.collection.listIndexes().toArray()
    for (const row of indexes) if (row.name !== '_id_') await Receipt.collection.dropIndex(row.name)
    await Receipt.createIndexes()
    const baseline = decode()
    await collection('runtime_instances').insertOne(baseline.root)
    await collection('runtime_evidence_sources').insertMany(baseline.current.sources)
    await collection('runtime_evidence_objects').insertMany(baseline.current.evidence)
    await collection('runtime_section_states').insertMany(baseline.current.sections)
    await collection('auditlogs').insertMany(baseline.audits)
    await Authority.collection.insertOne(Authority.hydrate(JSON.parse(authorityText)).toObject())
    await Audit.collection.insertOne(Audit.hydrate(JSON.parse(authorityAuditText)).toObject())
  }, 20000)
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => { await mongoose.disconnect() }, 20000)
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('persists %s without authorising execution or altering original truth/history', async disposition => {
    const input = await request(disposition), before = await observed()
    const saved = await service.recordSyntheticTestDisposition(input)
    expect(saved.receipt).toMatchObject({ receiptType: 'NON_AUTHORITATIVE_TEST_DISPOSITION_RECEIPT',
      disposition, authorisesCompletion: false, authorisesLock: false, authorisesARL: false,
      authorisesDownstream: false, officialVMFAcceptance: false, pipelineExecution: 'HELD',
      qualifiesFindingOnly: disposition === 'NOT_CONTRADICTORY',
      decisionMaker: { name: 'Angus Gregory', independent: false, dualRoleDisclosed: true, nativeUserId: null },
      recorder: { userId: input.actorUserId } })
    const record = await Receipt.findOne({}).lean()
    expect(record.body.basis.manifest.counts).toEqual({ sources: 8, evidence: 47, sections: 6 })
    expect(record.body.basis.qualifications.legacyMissingEvidenceSupportIds).toHaveLength(25)
    expect(record.body.basis.qualifications.sourceAuthenticityApproval).toBe(false)
    const audit = await Audit.findById(record.auditId)
    expect(audit.verifySignature()).toBe(true)
    const after = await observed()
    for (const name of names.filter(name => !['auditlogs', Receipt.collection.name].includes(name))) expect(after[name]).toBe(before[name])
    await unchanged(async () => {
      expect((await service.recordSyntheticTestDisposition(input)).replay).toBe(true)
      expect((await service.inspectSyntheticTestDisposition(args())).receipt).toEqual(saved.receipt)
    })
    await expect(recovery.verifyPublishedDispositionForLock(await root(), null)).rejects.toMatchObject({ code: 'SYNTHETIC_PIPELINE_HELD' })
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(names.length)
  }, 30000)
  test.each([true, false])('concurrent retries sameKey=%s create one committed receipt and audit', async sameKey => {
    const input = await request(), auditsBefore = await collection('auditlogs').countDocuments()
    const second = sameKey ? input : { ...input, payload: { ...input.payload, requestKey: randomUUID() } }
    const results = await Promise.allSettled([service.recordSyntheticTestDisposition(input), service.recordSyntheticTestDisposition(second)])
    const fulfilled = results.filter(row => row.status === 'fulfilled')
    expect(fulfilled).toHaveLength(sameKey ? 2 : 1)
    expect(fulfilled.filter(row => !row.value.replay)).toHaveLength(1)
    expect(new Set(fulfilled.map(row => row.value.receipt.receiptId)).size).toBe(1)
    if (!sameKey) expect(results.find(row => row.status === 'rejected').reason.code).toBe('SYNTHETIC_TEST_STALE')
    expect(await Receipt.countDocuments()).toBe(1)
    expect(await collection('auditlogs').countDocuments()).toBe(auditsBefore + 1)
  }, 40000)
  test.each(['audit', 'receipt', 'fence-restore'])('rolls back required %s failure without root/history change', async kind => {
    const input = await request()
    let spy
    if (kind === 'audit') spy = jest.spyOn(auditService, 'log').mockRejectedValue(new Error('Injected audit failure'))
    else if (kind === 'receipt') spy = jest.spyOn(Receipt, 'create').mockRejectedValue(new Error('Injected receipt failure'))
    else {
      const original = Runtime.collection.updateOne.bind(Runtime.collection)
      let writes = 0
      spy = jest.spyOn(Runtime.collection, 'updateOne').mockImplementation(async (...args) => {
        writes += 1
        if (writes === 2) return { modifiedCount: 0 }
        return original(...args)
      })
    }
    await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(input)).rejects.toThrow() })
    expect(spy).toHaveBeenCalled()
  }, 30000)
  test.each(['source', 'evidence', 'section', 'state', 'updatedAt', 'lock', 'audit', 'epoch'])('stale %s invalidates save with no extra writes', async kind => {
    const input = await request()
    if (kind === 'source') await collection('runtime_evidence_sources').updateOne({ _id: decode().current.sources[0]._id }, { $set: { title: 'Changed source' } })
    else if (kind === 'evidence') await collection('runtime_evidence_objects').updateOne({ _id: decode().current.evidence[0]._id }, { $set: { extractedFact: 'Changed fact' } })
    else if (kind === 'section') await collection('runtime_section_states').updateOne({ _id: decode().current.sections[0]._id }, { $set: { 'sectionDetail.input': 'Changed context' } })
    else if (kind === 'audit') await collection('auditlogs').updateOne({ _id: new mongoose.Types.ObjectId(policy.auditIds[0]) }, { $set: { signature: '0'.repeat(64) } })
    else {
      const changes = { state: { stateVersion: 'rsv2:' + randomUUID() }, updatedAt: { updatedAt: new Date() },
        lock: { 'framework_state.lock.locked': true }, epoch: { 'framework_state.evidence_pack.contradictionReviewEpoch': randomUUID() } }
      await collection('runtime_instances').updateOne({ _id: (await root())._id }, { $set: changes[kind] })
    }
    await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(input)).rejects.toThrow() })
  }, 30000)
  test.each(['actor', 'role', 'customer', 'tenant', 'permission', 'environment'])('denies invalid %s without writes', async kind => {
    const input = await request()
    if (kind === 'actor') input.actorUserId = '6a6c763dcace7a21bd41efa9'
    if (kind === 'role') input.scopes.platformRoles = []
    if (kind === 'customer') input.scopes.customer._id = '000000000000000000000001'
    if (kind === 'tenant') input.scopes.tenant._id = '000000000000000000000001'
    if (kind === 'permission') permit = false
    const previousEnv = env.appEnv
    if (kind === 'environment') env.appEnv = 'production'
    try { await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(input)).rejects.toMatchObject({ status: 403 }) }) }
    finally { env.appEnv = previousEnv }
  }, 30000)
  test.each(['amendment', 'future-time', 'prior-time', 'basis', 'conflicting-key', 'conflicting-rationale'])('rejects changed %s without false success audit', async kind => {
    const input = await request()
    if (kind.startsWith('conflicting')) await service.recordSyntheticTestDisposition(input)
    const changed = structuredClone(input)
    if (kind === 'amendment') changed.payload.amendmentDocumentText += ' '
    if (kind === 'future-time') changed.payload.decisionSource.decidedAt = '2099-01-01T00:00:00Z'
    if (kind === 'prior-time') changed.payload.decisionSource.decidedAt = '2026-01-01T00:00:00Z'
    if (kind === 'basis') changed.payload.expectedBasisHash = '0'.repeat(64)
    if (kind === 'conflicting-key') changed.payload.requestKey = randomUUID()
    if (kind === 'conflicting-rationale') changed.payload.rationale = 'Different isolated engineering-only rationale.'
    await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(changed)).rejects.toThrow() })
  }, 30000)
  test.each(['missing', 'sparse', 'nonunique'])('rejects %s unique-index contract', async kind => {
    const input = await request()
    await Receipt.collection.dropIndex('unique_synthetic_test_policy')
    if (kind !== 'missing') await Receipt.collection.createIndex({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, policyReference: 1 },
      { name: 'unique_synthetic_test_policy', unique: kind === 'sparse', sparse: kind === 'sparse' })
    await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(input)).rejects.toMatchObject({ code: 'SYNTHETIC_TEST_INDEX_REQUIRED' }) })
  }, 30000)
  test.each(['receipt', 'audit', 'authority', 'root'])('readback and retries reject changed %s', async kind => {
    const input = await request(), saved = await service.recordSyntheticTestDisposition(input)
    if (kind === 'receipt') await Receipt.collection.updateOne({ receiptId: saved.receipt.receiptId }, { $set: { 'body.input.disposition': 'CONFIRMED' } })
    if (kind === 'audit') await collection('auditlogs').updateOne({ _id: new mongoose.Types.ObjectId(saved.receipt.auditId) }, { $set: { 'diff.disposition': 'CONFIRMED' } })
    if (kind === 'authority') await Authority.collection.updateOne({}, { $set: { bodyHash: '0'.repeat(64) } })
    if (kind === 'root') await collection('runtime_instances').updateOne({}, { $set: { updatedBy: new mongoose.Types.ObjectId() } })
    await unchanged(async () => {
      await expect(service.inspectSyntheticTestDisposition(args())).rejects.toThrow()
      await expect(service.recordSyntheticTestDisposition(input)).rejects.toThrow()
    })
  }, 30000)
  test('model rejects a rehashed receipt with a different claimed basis before storage', async () => {
    await service.recordSyntheticTestDisposition(await request())
    const record = await Receipt.findOne({}).lean()
    record.body.input.expectedBasisHash = '0'.repeat(64)
    record.payloadHash = hash({ ...record.body.input, actorUserId: args().actorUserId })
    record.body.payloadHash = record.payloadHash
    record.bodyHash = hash(record.body)
    delete record._id
    await unchanged(async () => { await expect(Receipt.create(record)).rejects.toThrow('binding is invalid') })
  }, 30000)
  test('a competing root writer before the fence cannot commit a test receipt', async () => {
    const input = await request(), original = Runtime.collection.updateOne.bind(Runtime.collection)
    const before = await observed()
    let injected = false
    jest.spyOn(Runtime.collection, 'updateOne').mockImplementation(async (...args) => {
      if (!injected) {
        injected = true
        await original({ _id: (await root())._id }, { $set: { updatedBy: new mongoose.Types.ObjectId() } })
      }
      return original(...args)
    })
    await expect(service.recordSyntheticTestDisposition(input)).rejects.toThrow()
    expect(injected).toBe(true)
    const after = await observed()
    for (const name of names.filter(name => name !== 'runtime_instances')) expect(after[name]).toBe(before[name])
    expect(after.runtime_instances).not.toBe(before.runtime_instances)
  }, 30000)
  test('a changed root after fence restoration is detected and rolled back', async () => {
    const input = await request(), original = Runtime.collection.updateOne.bind(Runtime.collection)
    let writes = 0
    jest.spyOn(Runtime.collection, 'updateOne').mockImplementation(async (...args) => {
      const result = await original(...args)
      writes += 1
      if (writes === 2) await original({ _id: (await root())._id }, { $set: { name: 'Injected stale synthetic root' } }, args[2])
      return result
    })
    await unchanged(async () => { await expect(service.recordSyntheticTestDisposition(input)).rejects.toThrow() })
    expect(writes).toBe(2)
  }, 30000)
  test('leaves one signed, explicitly non-authoritative engineering receipt for independent readback', async () => {
    const input = await request('REOPENED')
    const saved = await service.recordSyntheticTestDisposition(input)
    expect(saved.receipt.pipelineExecution).toBe('HELD')
    expect(await Receipt.countDocuments()).toBe(1)
  }, 30000)
})
