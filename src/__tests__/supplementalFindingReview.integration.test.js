import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

const database = process.env.VMF_RECOVERY_ISOLATED_DB
const baselinePath = process.env.VMF_RECOVERY_BASELINE_PATH
const baselineSha = process.env.VMF_RECOVERY_BASELINE_SHA
const expectedPath = 'C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-15-required-sections/lifecycle/handoff-reconciliation/readback-private.ejson.json'
const expectedHash = 'cc9d3e58c060514e69c50b21067105b386ada86a087de24bcb61bf75e4efeab5'
const approvalPath = 'C:/Dev/StoryLineOS/VMF-APP/dev-v1/docs/generated/harness-runs/ss-044/2026-10-16-product-authority/approval-v1.json'
const approvalHash = 'f8db0fe0dec87691843987132ef3a4e449c64313e11e7755282e5d15742f71b8'
const enabled = Boolean(database && baselinePath && baselineSha)
if (enabled && (!/^ss044_[a-f0-9]{32}$/.test(database)
  || resolve(baselinePath).toLowerCase() !== resolve(expectedPath).toLowerCase()
  || baselineSha.toLowerCase() !== expectedHash)) throw new Error('An exact cached baseline and isolated UUID database are required.')

const isolated = enabled ? describe : describe.skip
isolated('supplemental finding isolated engineering dispositions (never operational decisions)', () => {
  let RuntimeInstance, Source, Evidence, Section, PriorReceipt, Review, Authority, AuditLog
  let service, authorityService, basisPolicy, policy, auditService, env, membershipHash, baselineText, approvalText, permit, owned = false
  let names = []
  const decode = () => mongoose.mongo.BSON.EJSON.parse(baselineText)
  const assertIsolated = () => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database)) throw new Error('Isolated database ownership unavailable.')
  }
  const collection = name => { assertIsolated(); return mongoose.connection.db.collection(name) }
  const root = (session = null) => RuntimeInstance.collection.findOne({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) }, { session, maxTimeMS: 3000 })
  const count = name => collection(name).countDocuments({}, { maxTimeMS: 3000 })
  const args = () => ({ actorUserId: '6a6c763dcace7a21bd41efa9', runtimeInstanceId: basisPolicy.scope.runtimeInstanceId,
    scopes: { customer: { _id: basisPolicy.scope.customerId }, tenant: { _id: basisPolicy.scope.tenantId } },
    auditRequest: { requestId: `isolated-finding-engineering-only-${randomUUID()}` } })
  const adminArgs = () => ({ ...args(), actorUserId: '000000000000000000000071',
    scopes: { ...args().scopes, platformRoles: ['SUPER_ADMIN'] } })
  const authorityRequest = async () => {
    const input = adminArgs(), inspection = await authorityService.inspectRuntimeProductAuthority(input)
    return { ...input, payload: { requestKey: randomUUID(), expectedBasisHash: inspection.expectedBasisHash,
      expectedUpdatedAt: inspection.expectedUpdatedAt, approvalDocumentText: approvalText, confirm: true } }
  }
  const ensureAuthority = async () => {
    if (await count(Authority.collection.name) === 0) await authorityService.importRuntimeProductAuthority(await authorityRequest())
  }
  const request = async (disposition = 'REOPENED') => {
    await ensureAuthority()
    const input = args(), inspection = await service.inspectSupplementalFindingReview(input)
    return { ...input, payload: { requestKey: randomUUID(), expectedBasisHash: inspection.expectedBasisHash,
      expectedUpdatedAt: inspection.expectedUpdatedAt, disposition, confirm: true,
      rationale: `Isolated engineering test of ${disposition}; not an operational adjudication or source-authenticity approval.` } }
  }
  const observed = async () => {
    const runtime = await root(), material = { ...runtime }
    delete material.updatedAt; delete material.updatedBy
    const typed = {}
    for (const name of [Source.collection.name, Evidence.collection.name, Section.collection.name]) {
      typed[name] = membershipHash(await collection(name).find({}, { maxTimeMS: 3000 }).sort({ _id: 1 }).toArray())
    }
    return { truth: membershipHash(material), rootHash: membershipHash(runtime), typed,
      reviews: await count(Review.collection.name), authorities: await count(Authority.collection.name),
      priorReceipts: await count(PriorReceipt.collection.name), audits: await count(AuditLog.collection.name) }
  }
  const unchanged = async operation => {
    const before = await observed()
    const result = await operation()
    expect(await observed()).toEqual(before)
    return result
  }
  const rejectUnchanged = async (input, code) => unchanged(async () => {
    await expect(service.recordSupplementalFindingReview(input)).rejects.toMatchObject({ code })
  })

  beforeAll(async () => {
    baselineText = readFileSync(baselinePath, 'utf8')
    expect(createHash('sha256').update(baselineText, 'utf8').digest('hex')).toBe(expectedHash)
    const approvalBytes = readFileSync(approvalPath)
    expect(approvalBytes.length).toBe(7143)
    expect(createHash('sha256').update(approvalBytes).digest('hex')).toBe(approvalHash)
    approvalText = approvalBytes.toString('utf8')
    const baseline = decode()
    expect(baseline.current.sources).toHaveLength(8)
    expect(baseline.current.evidence).toHaveLength(47)
    expect(baseline.current.sections).toHaveLength(6)
    expect(baseline.audits).toHaveLength(124)
    const actual = await import('../services/runtimeInstanceService.js')
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...actual,
      getRuntimeInstance: async ({ runtimeInstanceId, scopes, session }) => {
        assertIsolated()
        if (String(runtimeInstanceId) !== basisPolicy.scope.runtimeInstanceId
          || scopes?.customer?._id !== basisPolicy.scope.customerId || scopes?.tenant?._id !== basisPolicy.scope.tenantId) {
          throw Object.assign(new Error('Denied isolated scoped selection'), { status: 403, code: 'FORBIDDEN' })
        }
        const runtime = await root(session)
        return { ...runtime, id: String(runtime._id) }
      },
      assertRuntimePermission: async ({ actorUserId, permission }) => {
        if (!permit || !mongoose.isValidObjectId(actorUserId) || permission !== 'VMF_UPDATE') {
          throw Object.assign(new Error('Denied isolated reviewer authority'), { status: 403, code: 'FORBIDDEN' })
        }
      },
    }))
    ;({ default: env } = await import('../config/env.js'))
    ;({ default: RuntimeInstance } = await import('../models/RuntimeInstance.js'))
    ;({ default: Source } = await import('../models/RuntimeEvidenceSource.js'))
    ;({ default: Evidence } = await import('../models/RuntimeEvidenceObject.js'))
    ;({ default: Section } = await import('../models/RuntimeStateSection.js'))
    ;({ default: PriorReceipt } = await import('../models/RuntimePublishedDispositionReceipt.js'))
    ;({ default: Review } = await import('../models/RuntimeSupplementalFindingReview.js'))
    ;({ default: Authority } = await import('../models/RuntimeProductAuthorityReceipt.js'))
    ;({ default: AuditLog } = await import('../models/AuditLog.js'))
    ;({ PUBLISHED_DISPOSITION_POLICY: basisPolicy } = await import('../constants/publishedDispositionRecoveryPolicy.js'))
    ;({ SUPPLEMENTAL_FINDING_POLICY: policy } = await import('../constants/supplementalFindingReviewPolicy.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
    ;({ membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js'))
    service = await import('../services/supplementalFindingReviewService.js')
    authorityService = await import('../services/runtimeProductAuthorityService.js')
    if (mongoose.connection.readyState !== 0) throw new Error('Fresh disconnected Mongoose required.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    expect(hello.isWritablePrimary).toBe(true)
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    const models = [RuntimeInstance, Source, Evidence, Section, PriorReceipt, Review, Authority, AuditLog]
    names = models.map(model => model.collection.name)
    expect([...names].sort()).toEqual(['runtime_instances', 'runtime_evidence_sources', 'runtime_evidence_objects',
      'runtime_section_states', 'runtime_published_disposition_receipts', 'runtime_supplemental_finding_reviews',
      'runtime_product_authority_receipts', 'auditlogs'].sort())
    owned = true
    for (const model of models) { assertIsolated(); await model.createCollection() }
    await Review.createIndexes()
    await Authority.createIndexes()
  }, 30000)
  beforeEach(async () => {
    assertIsolated(); permit = true
    for (const name of names) await collection(name).deleteMany({}, { maxTimeMS: 3000 })
    // Restore the exact reviewed index definitions after missing/weakened-index tests.
    const indexes = await Review.collection.listIndexes({ maxTimeMS: 3000 }).toArray()
    for (const name of ['unique_supplemental_finding_policy', 'unique_supplemental_finding_request']) {
      const index = indexes.find(item => item.name === name)
      if (index && (index.sparse || index.partialFilterExpression || !index.unique)) await Review.collection.dropIndex(name)
    }
    await Review.createIndexes()
    const authorityIndexes = await Authority.collection.listIndexes({ maxTimeMS: 3000 }).toArray()
    for (const index of authorityIndexes) {
      if (index.name !== '_id_' && (index.sparse || index.partialFilterExpression || !index.unique)) await Authority.collection.dropIndex(index.name)
    }
    await Authority.createIndexes()
    const baseline = decode()
    await RuntimeInstance.collection.insertOne(baseline.root)
    await Source.collection.insertMany(baseline.current.sources)
    await Evidence.collection.insertMany(baseline.current.evidence)
    await Section.collection.insertMany(baseline.current.sections)
    await AuditLog.collection.insertMany(baseline.audits)
  }, 20000)
  afterEach(() => jest.restoreAllMocks())
  // Keep the owned UUID database for independent readback; no teardown deletion.
  afterAll(async () => { await mongoose.disconnect() }, 20000)

  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('persists explicit engineering-only %s with signed audit, replay and unchanged original truth/history', async disposition => {
    const input = await request(disposition), before = await observed()
    const saved = await service.recordSupplementalFindingReview(input)
    expect(saved.replay).toBe(false)
    expect(saved.receipt).toMatchObject({ authorisesLock: false, authorisesARL: false,
      findingResolved: disposition === 'NOT_CONTRADICTORY', origin: policy.contractVersion })
    const record = await Review.findOne({ receiptId: saved.receipt.receiptId }).lean()
    expect(record.body).toMatchObject({ disposition, originalReviewHistory: 'ABSENT', reviewEpoch: policy.reviewEpoch,
      evidencePairHash: policy.evidencePairHash, reviewer: { userId: input.actorUserId, permission: 'VMF_UPDATE' } })
    expect(record.body.frozenMembership.counts).toEqual({ sources: 8, evidence: 47, sections: 6 })
    expect(record.body.qualifications.legacyMissingEvidenceSupportIds).toHaveLength(25)
    expect(record.body.qualifications.sourceAuthenticityApproval).toBe(false)
    const authority = await Authority.findOne({}).lean()
    expect(record.body.authority).toEqual({ receiptId: authority.receiptId, bodyHash: authority.bodyHash,
      approvalReference: authority.approvalReference, version: authority.approvalVersion, documentHash: approvalHash })
    const audit = await AuditLog.findById(record.auditId)
    expect(audit.verifySignature()).toBe(true)
    expect(audit.diff).toMatchObject({ receiptId: record.receiptId, bodyHash: record.bodyHash, disposition })
    const after = await observed()
    expect(after.truth).toBe(before.truth); expect(after.typed).toEqual(before.typed)
    expect(after.reviews).toBe(1); expect(after.priorReceipts).toBe(0); expect(after.audits).toBe(before.audits + 1)
    expect((await root()).updatedAt.toISOString()).toBe(record.body.committedUpdatedAt)
    await unchanged(async () => {
      const retry = await service.recordSupplementalFindingReview(input)
      expect(retry.replay).toBe(true); expect(retry.receipt).toEqual(saved.receipt)
      const read = await service.inspectSupplementalFindingReview(args())
      expect(read.receipt).toEqual(saved.receipt)
      expect(read).toMatchObject({ authorisesLock: false, authorisesARL: false })
    })
  }, 30000)
  test.each([true, false])('concurrent requests identicalKey=%s have exactly one durable receipt/audit', async sameKey => {
    const input = await request(), before = await observed()
    const second = sameKey ? input : { ...input, payload: { ...input.payload, requestKey: randomUUID() } }
    const results = await Promise.allSettled([service.recordSupplementalFindingReview(input), service.recordSupplementalFindingReview(second)])
    const committed = results.filter(result => result.status === 'fulfilled')
    expect(committed).toHaveLength(sameKey ? 2 : 1)
    expect(new Set(committed.map(result => result.value.receipt.receiptId)).size).toBe(1)
    expect(committed.filter(result => !result.value.replay)).toHaveLength(1)
    if (!sameKey) expect(results.find(result => result.status === 'rejected').reason.code).toBe('SUPPLEMENTAL_FINDING_STALE')
    expect(await count(Review.collection.name)).toBe(1); expect(await count(AuditLog.collection.name)).toBe(before.audits + 1)
    expect((await observed()).truth).toBe(before.truth); expect((await observed()).typed).toEqual(before.typed)
  }, 40000)
  test.each(['audit', 'receipt'])('rolls back metadata CAS, audit and receipt after injected %s failure', async owner => {
    const input = await request(), before = await observed(), failure = new Error(`isolated ${owner} failure`)
    const spy = owner === 'audit' ? jest.spyOn(auditService, 'log').mockRejectedValue(failure) : jest.spyOn(Review, 'create').mockRejectedValue(failure)
    await expect(service.recordSupplementalFindingReview(input)).rejects.toThrow(failure.message)
    expect(spy).toHaveBeenCalled(); spy.mockRestore()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['root', 'state', 'source', 'evidence', 'section', 'audit', 'updatedAt', 'updatedBy', 'lock', 'epoch'])('rejects stale %s without any receipt, audit or CAS write', async kind => {
    const input = await request()
    if (kind === 'source') await Source.collection.updateOne({ _id: decode().current.sources[0]._id }, { $set: { title: 'Changed synthetic source' } })
    else if (kind === 'evidence') await Evidence.collection.updateOne({ _id: decode().current.evidence[0]._id }, { $set: { extractedFact: 'Changed synthetic assertion' } })
    else if (kind === 'section') await Section.collection.updateOne({ _id: decode().current.sections[0]._id }, { $set: { 'sectionDetail.input': 'Changed section context' } })
    else if (kind === 'audit') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(basisPolicy.auditIds[0]) }, { $set: { signature: '0'.repeat(64) } })
    else {
      const updates = { root: { name: 'Changed synthetic root' }, state: { stateVersion: `rsv2:${randomUUID()}` },
        updatedAt: { updatedAt: new Date(Date.parse(basisPolicy.updatedAt) + 1) }, updatedBy: { updatedBy: new mongoose.Types.ObjectId() },
        lock: { 'framework_state.lock.locked': true }, epoch: { 'framework_state.evidence_pack.contradictionReviewEpoch': randomUUID() } }
      await RuntimeInstance.collection.updateOne({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) }, { $set: updates[kind] })
    }
    await rejectUnchanged(input, kind === 'audit' ? 'PUBLISHED_RECOVERY_AUDIT_INVALID'
      : kind === 'section' ? 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' : 'PUBLISHED_RECOVERY_STALE')
  }, 30000)
  test('denied actual reviewer authority is rejected without writes', async () => {
    const input = await request(); permit = false
    await rejectUnchanged(input, 'FORBIDDEN')
  })
  test.each([{ disposition: 'UNKNOWN' }, { confirm: false }, { rationale: 'short' }])('rejects invalid explicit decision %j without writes', async invalid => {
    const input = await request(); Object.assign(input.payload, invalid)
    await rejectUnchanged(input, 'SUPPLEMENTAL_FINDING_INVALID')
  })
  test('rejects an invalid native reviewer identity before writes', async () => {
    const input = await request(); input.actorUserId = 'not-a-native-user-id'
    await rejectUnchanged(input, 'SUPPLEMENTAL_FINDING_DELEGATION_REQUIRED')
  })
  test.each(['runtime', 'customer', 'tenant'])('wrong %s scoped selection is rejected without writes', async kind => {
    const input = await request()
    if (kind === 'runtime') input.runtimeInstanceId = String(new mongoose.Types.ObjectId())
    else input.scopes[kind]._id = String(new mongoose.Types.ObjectId())
    await rejectUnchanged(input, 'FORBIDDEN')
  })
  test.each(['missing', 'sparse'])('fails closed before write with a %s required unique index', async kind => {
    const input = await request(), name = 'unique_supplemental_finding_request'
    await Review.collection.dropIndex(name)
    if (kind === 'sparse') await Review.collection.createIndex({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, sparse: true, name })
    await rejectUnchanged(input, 'SUPPLEMENTAL_FINDING_INDEX_REQUIRED')
  })
  test.each(['disposition', 'rationale', 'actor'])('changed %s cannot reuse the committed request identity', async kind => {
    const input = await request(); await service.recordSupplementalFindingReview(input)
    const changed = { ...input, payload: { ...input.payload } }
    if (kind === 'actor') changed.actorUserId = String(new mongoose.Types.ObjectId())
    else changed.payload[kind] = kind === 'disposition' ? 'CONFIRMED' : 'Different explicit isolated engineering rationale.'
    await rejectUnchanged(changed, kind === 'actor' ? 'SUPPLEMENTAL_FINDING_DELEGATION_REQUIRED' : 'SUPPLEMENTAL_FINDING_STALE')
  }, 30000)
  test('model mutation and raw receipt tampering are rejected without forging historical disposition', async () => {
    const input = await request(), saved = await service.recordSupplementalFindingReview(input)
    await unchanged(async () => {
      await expect(Review.updateOne({ receiptId: saved.receipt.receiptId }, { $set: { bodyHash: '0'.repeat(64) } })).rejects.toThrow('immutable')
      await expect(Review.deleteOne({ receiptId: saved.receipt.receiptId })).rejects.toThrow('immutable')
    })
    await Review.collection.updateOne({ receiptId: saved.receipt.receiptId }, { $set: { 'body.disposition': 'CONFIRMED' } })
    await unchanged(async () => {
      await expect(service.inspectSupplementalFindingReview(args())).rejects.toMatchObject({ code: 'SUPPLEMENTAL_FINDING_INVALID' })
    })
  }, 30000)
  test('readback rejects a tampered new signed audit without altering the original finding', async () => {
    const saved = await service.recordSupplementalFindingReview(await request())
    await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(saved.receipt.auditId) },
      { $set: { 'diff.disposition': 'CONFIRMED' } })
    await unchanged(async () => {
      await expect(service.inspectSupplementalFindingReview(args())).rejects.toMatchObject({ code: 'SUPPLEMENTAL_FINDING_AUDIT_INVALID' })
    })
  }, 30000)

  test('admin imports exact documentary authority with no root/control/typed mutation and one signed audit', async () => {
    const input = await authorityRequest(), before = await observed()
    const saved = await authorityService.importRuntimeProductAuthority(input)
    expect(saved.replay).toBe(false)
    expect(saved.receipt).toMatchObject({ documentHash: approvalHash, authorisesLock: false, authorisesARL: false })
    const record = await Authority.findOne({ receiptId: saved.receipt.receiptId }).lean()
    expect(record.body.approvalDocumentText).toBe(approvalText)
    expect(record.body.recorder).toEqual({ userId: input.actorUserId, platformRole: 'SUPER_ADMIN' })
    expect(Date.parse(record.body.recordedAt)).toBeGreaterThan(Date.parse(record.body.approvedAt))
    const audit = await AuditLog.findById(record.auditId)
    expect(audit.verifySignature()).toBe(true)
    expect(audit.diff).toMatchObject({ action: 'RUNTIME_PRODUCT_AUTHORITY_RECORDED', receiptId: record.receiptId,
      bodyHash: record.bodyHash, documentHash: approvalHash })
    const after = await observed()
    expect(after).toEqual({ ...before, authorities: 1, audits: before.audits + 1 })
    await unchanged(async () => {
      const replay = await authorityService.importRuntimeProductAuthority(input)
      expect(replay).toEqual({ receipt: saved.receipt, replay: true })
      expect((await authorityService.inspectRuntimeProductAuthority(args())).receipt).toEqual(saved.receipt)
    })
  }, 30000)
  test.each([true, false])('authority import concurrent identicalKey=%s has one native winner', async sameKey => {
    const input = await authorityRequest(), before = await observed()
    const second = sameKey ? input : { ...input, payload: { ...input.payload, requestKey: randomUUID() } }
    const results = await Promise.allSettled([authorityService.importRuntimeProductAuthority(input), authorityService.importRuntimeProductAuthority(second)])
    const success = results.filter(result => result.status === 'fulfilled')
    expect(success).toHaveLength(sameKey ? 2 : 1)
    expect(new Set(success.map(result => result.value.receipt.receiptId)).size).toBe(1)
    expect(success.filter(result => !result.value.replay)).toHaveLength(1)
    if (!sameKey) expect(results.find(result => result.status === 'rejected').reason.code).toBe('PRODUCT_AUTHORITY_STALE')
    expect(await observed()).toEqual({ ...before, authorities: 1, audits: before.audits + 1 })
  }, 40000)
  test.each(['audit', 'receipt'])('authority %s failure rolls back real transaction without a root edit', async owner => {
    const input = await authorityRequest(), before = await observed(), failure = new Error(`authority ${owner} failure`)
    const spy = owner === 'audit' ? jest.spyOn(auditService, 'log').mockRejectedValue(failure) : jest.spyOn(Authority, 'create').mockRejectedValue(failure)
    await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toThrow(failure.message)
    expect(spy).toHaveBeenCalled(); spy.mockRestore()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['Andrew', 'non-admin'])('%s cannot import authority as a platform recorder', async actor => {
    const input = await authorityRequest()
    input.scopes = args().scopes
    if (actor === 'Andrew') input.actorUserId = args().actorUserId
    await unchanged(async () => {
      await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toMatchObject({ code: 'PRODUCT_AUTHORITY_FORBIDDEN' })
    })
  })
  test('Andrew requires actual VMF_UPDATE even with a native delegated identity', async () => {
    await ensureAuthority(); permit = false
    await unchanged(async () => {
      await expect(authorityService.inspectRuntimeProductAuthority(args())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })
  test('platform recorder cannot adjudicate instead of the named Andrew delegate', async () => {
    const input = await request(), admin = adminArgs()
    await rejectUnchanged({ ...input, actorUserId: admin.actorUserId, scopes: admin.scopes }, 'SUPPLEMENTAL_FINDING_DELEGATION_REQUIRED')
  })
  test('review write requires persisted authority, not documentary bytes or a previous inspection', async () => {
    const input = await request()
    await Authority.collection.deleteMany({}) // Deliberate negative in owned isolated DB only.
    await rejectUnchanged(input, 'PRODUCT_AUTHORITY_REQUIRED')
  }, 30000)
  test('changed documentary source bytes reject before any native authority write', async () => {
    const input = await authorityRequest(); input.payload.approvalDocumentText += '\n'
    await unchanged(async () => {
      await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toMatchObject({ code: 'PRODUCT_AUTHORITY_INVALID' })
    })
  })
  test.each(['receipt', 'audit'])('finding consumer rejects tampered native authority %s', async kind => {
    const input = await request(), record = await Authority.findOne({}).lean()
    if (kind === 'receipt') await Authority.collection.updateOne({ _id: record._id }, { $set: { 'body.documentHash': '0'.repeat(64) } })
    else await AuditLog.collection.updateOne({ _id: record.auditId }, { $set: { signature: '0'.repeat(64) } })
    await rejectUnchanged(input, kind === 'receipt' ? 'PRODUCT_AUTHORITY_INVALID' : 'PRODUCT_AUTHORITY_AUDIT_INVALID')
  }, 30000)
  test.each(['missing', 'sparse'])('authority import rejects %s required index before any write', async kind => {
    const input = await authorityRequest(), name = 'unique_runtime_product_authority_request'
    await Authority.collection.dropIndex(name)
    if (kind === 'sparse') await Authority.collection.createIndex({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { name, unique: true, sparse: true })
    await unchanged(async () => {
      await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toMatchObject({ code: 'PRODUCT_AUTHORITY_INDEX_REQUIRED' })
    })
  })
  test('authority model rejects mutation and a saved authority grants no lock or ARL', async () => {
    const saved = await authorityService.importRuntimeProductAuthority(await authorityRequest())
    await unchanged(async () => {
      await expect(Authority.updateOne({ receiptId: saved.receipt.receiptId }, { $set: { bodyHash: '0'.repeat(64) } })).rejects.toThrow('immutable')
      await expect(Authority.deleteOne({ receiptId: saved.receipt.receiptId })).rejects.toThrow('immutable')
      expect(await authorityService.inspectRuntimeProductAuthority(args())).toMatchObject({ authorisesLock: false, authorisesARL: false })
    })
  }, 30000)
  test.each(['updatedAt', 'updatedBy'])('existing native authority read rejects intervening root %s', async field => {
    await authorityService.importRuntimeProductAuthority(await authorityRequest())
    await RuntimeInstance.collection.updateOne({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) },
      { $set: field === 'updatedAt' ? { updatedAt: new Date(Date.parse(basisPolicy.updatedAt) + 1) }
        : { updatedBy: new mongoose.Types.ObjectId() } })
    await unchanged(async () => {
      await expect(authorityService.inspectRuntimeProductAuthority(args())).rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_STALE' })
    })
  }, 30000)
  test('a competing root write committed before the real modified guard prevents authority commit', async () => {
    const input = await authorityRequest(), original = RuntimeInstance.collection.updateOne.bind(RuntimeInstance.collection)
    let injected = false, afterCompeting
    const spy = jest.spyOn(RuntimeInstance.collection, 'updateOne').mockImplementation(async (filter, update, options) => {
      if (options?.session && !injected) {
        injected = true
        const written = await original({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) },
          { $set: { updatedAt: new Date(Date.parse(basisPolicy.updatedAt) + 1) } }, { maxTimeMS: 3000 })
        expect(written.modifiedCount).toBe(1)
        afterCompeting = await observed()
      }
      return original(filter, update, options)
    })
    await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_STALE' })
    spy.mockRestore()
    expect(injected).toBe(true)
    expect(await observed()).toEqual(afterCompeting)
  }, 30000)
  test('real guard retains its write lock after exact restoration until authority commit', async () => {
    const input = await authorityRequest(), before = await observed()
    const original = RuntimeInstance.collection.updateOne.bind(RuntimeInstance.collection)
    let writer, fenceAt, fenceSession, checked = false, restoreVerified = false
    const spy = jest.spyOn(RuntimeInstance.collection, 'updateOne').mockImplementation(async (filter, update, options) => {
      const result = await original(filter, update, options)
      if (options?.session && !checked) {
        checked = true
        expect(result.matchedCount).toBe(1); expect(result.modifiedCount).toBe(1)
        expect(update.$set.updatedAt.getTime()).toBeGreaterThan(Date.parse(basisPolicy.updatedAt))
        fenceAt = update.$set.updatedAt
        fenceSession = options.session
      } else if (options?.session) {
        expect(restoreVerified).toBe(false)
        expect(options.session).toBe(fenceSession)
        expect(filter.updatedAt.getTime()).toBe(fenceAt.getTime())
        expect(result.matchedCount).toBe(1); expect(result.modifiedCount).toBe(1)
        expect(update.$set.updatedAt.toISOString()).toBe(basisPolicy.updatedAt)
        restoreVerified = true
        // Start only AFTER the second, real restore write, before basis/audit/commit.
        writer = original({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) },
          { $set: { updatedAt: new Date(Date.parse(basisPolicy.updatedAt) + 1) } }, { maxTimeMS: 500 })
          .then(value => ({ outcome: 'COMMITTED', value }), error => ({ outcome: 'REJECTED', error }))
        let timer
        const deadline = new Promise(resolveDeadline => { timer = setTimeout(() => resolveDeadline({ outcome: 'UNACKNOWLEDGED' }), 1500) })
        const race = await Promise.race([writer, deadline]); clearTimeout(timer)
        expect(race.outcome).toBe('REJECTED')
        expect(race.error.code).toBe(50)
        // An acknowledged server timeout proves contention, unlike a short pending timer.
      }
      return result
    })
    try {
      const saved = await authorityService.importRuntimeProductAuthority(input)
      expect(checked).toBe(true)
      expect(restoreVerified).toBe(true)
      const competing = await writer
      expect(competing.outcome).toBe('REJECTED'); expect(competing.error.code).toBe(50)
      expect((await observed()).rootHash).toBe(before.rootHash)
      expect(await count(Authority.collection.name)).toBe(1)
      expect(await count(AuditLog.collection.name)).toBe(before.audits + 1)
      expect((await Authority.findOne({ receiptId: saved.receipt.receiptId }).lean()).body.stateVersion).toBe(basisPolicy.stateVersion)
      expect((await observed()).typed).toEqual(before.typed)
      const afterCommit = await original({ _id: new mongoose.Types.ObjectId(basisPolicy.scope.runtimeInstanceId) },
        { $set: { updatedAt: new Date(Date.parse(basisPolicy.updatedAt) + 1) } }, { maxTimeMS: 3000 })
      expect(afterCommit.modifiedCount).toBe(1)
    } finally {
      spy.mockRestore()
      if (writer) await writer // Driver maxTimeMS bounds cleanup even on a failed guard assertion.
    }
  }, 30000)
  test.each(['driver-throw', 'modified-zero'])('a %s restore failure aborts the real fence and rolls back root/audit/authority', async failureMode => {
    const input = await authorityRequest(), before = await observed()
    const original = RuntimeInstance.collection.updateOne.bind(RuntimeInstance.collection)
    const injected = new Error('Isolated authority restore driver failure')
    let writes = 0, fenceAt, guardSession
    const spy = jest.spyOn(RuntimeInstance.collection, 'updateOne').mockImplementation(async (filter, update, options) => {
      if (!options?.session) return original(filter, update, options)
      writes++
      if (writes === 1) {
        guardSession = options.session
        expect(filter.updatedAt.toISOString()).toBe(basisPolicy.updatedAt)
        fenceAt = update.$set.updatedAt
        expect(fenceAt.getTime()).toBeGreaterThan(Date.parse(basisPolicy.updatedAt))
        const result = await original(filter, update, options)
        expect(result.matchedCount).toBe(1); expect(result.modifiedCount).toBe(1)
        return result
      }
      expect(writes).toBe(2)
      expect(options.session).toBe(guardSession)
      expect(filter.updatedAt.getTime()).toBe(fenceAt.getTime())
      expect(update.$set.updatedAt.toISOString()).toBe(basisPolicy.updatedAt)
      expect(String(filter.customerId)).toBe(basisPolicy.scope.customerId)
      expect(String(filter.tenantId)).toBe(basisPolicy.scope.tenantId)
      expect(filter.stateVersion).toBe(basisPolicy.stateVersion)
      expect(String(filter.updatedBy)).toBe(basisPolicy.originalUpdatedBy)
      if (failureMode === 'driver-throw') throw injected
      return { acknowledged: true, matchedCount: 1, modifiedCount: 0 }
    })
    try {
      if (failureMode === 'driver-throw') await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toThrow(injected.message)
      else await expect(authorityService.importRuntimeProductAuthority(input)).rejects.toMatchObject({ code: 'PRODUCT_AUTHORITY_STALE' })
      expect(writes).toBe(2)
    } finally { spy.mockRestore() }
    // Both transient updates belong to the aborted transaction; committed root is exact original.
    expect(await observed()).toEqual(before)
  }, 30000)
})
