import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

// Opt-in only: this suite never starts MongoDB and never selects the source DB.
const database = process.env.VMF_RECOVERY_ISOLATED_DB
const baselinePath = process.env.VMF_RECOVERY_BASELINE_PATH
const baselineSha = process.env.VMF_RECOVERY_BASELINE_SHA
const expectedBaseline = 'C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-15-required-sections/lifecycle/handoff-reconciliation/readback-private.ejson.json'
const expectedBaselineHash = 'cc9d3e58c060514e69c50b21067105b386ada86a087de24bcb61bf75e4efeab5'
const enabled = Boolean(database && baselinePath && baselineSha)
if (enabled && (!/^ss044_[a-f0-9]{32}$/.test(database)
  || resolve(baselinePath).toLowerCase() !== resolve(expectedBaseline).toLowerCase()
  || baselineSha.toLowerCase() !== expectedBaselineHash)) {
  throw new Error('Recovery integration requires the exact cached baseline and an isolated UUID database.')
}

const isolated = enabled ? describe : describe.skip
isolated('published disposition real persistence (requires explicit isolated DB and baseline)', () => {
  let RuntimeInstance, EvidenceSource, EvidenceObject, Section, Receipt, AuditLog, Authority, Finding
  let service, policy, auditService, env, completeReview, authorityService, findingService, baselineText, permit, owned = false
  let names = []
  const decode = () => mongoose.mongo.BSON.EJSON.parse(baselineText)
  const assertIsolated = () => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database)) {
      throw new Error('Isolated recovery database ownership is unavailable.')
    }
  }
  const collection = name => { assertIsolated(); return mongoose.connection.db.collection(name) }
  const count = name => collection(name).countDocuments({}, { maxTimeMS: 3000 })
  const root = (session = null) => RuntimeInstance.collection.findOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId) }, { session, maxTimeMS: 3000 })
  const args = () => ({ actorUserId: '6a6c763dcace7a21bd41efa9', runtimeInstanceId: policy.scope.runtimeInstanceId,
    scopes: { customer: { _id: policy.scope.customerId }, tenant: { _id: policy.scope.tenantId } },
    auditRequest: { requestId: `isolated-published-recovery-${randomUUID()}` } })
  const verifyLock = runtime => service.withPublishedRecoveryTransaction(session => service.verifyPublishedDispositionForLock(runtime, session))
  const nativeFinding = async (disposition = 'NOT_CONTRADICTORY') => {
    const inspection = await findingService.inspectSupplementalFindingReview(args())
    return findingService.recordSupplementalFindingReview({ ...args(), payload: { requestKey: randomUUID(),
      expectedBasisHash: inspection.expectedBasisHash, expectedUpdatedAt: inspection.expectedUpdatedAt, disposition, confirm: true,
      rationale: 'Isolated engineering decision only; not operational Andrew adjudication.' } })
  }
  const request = async () => {
    const input = args(), inspection = await service.inspectPublishedDispositionRecovery(input)
    return { ...input, payload: { requestKey: randomUUID(), expectedBasisHash: inspection.expectedBasisHash,
      expectedUpdatedAt: inspection.expectedUpdatedAt, confirm: true,
      rationale: 'Complete synthetic evidence dispositions only; legacy locators and source authenticity remain unknown.' } }
  }
  const hash = value => service.publishedRuntimeWitnessHash(value)
  const signedTestAudit = binding => {
    // Unsaved model-signed test material, never a persisted LOCK event.
    const audit = new AuditLog({ actorUserId: args().actorUserId, action: 'ISOLATED_RECOVERY_LINK_TEST',
      resourceType: 'RuntimeInstance', resourceId: policy.scope.runtimeInstanceId,
      scope: { customerId: policy.scope.customerId, tenantId: policy.scope.tenantId, runtimeInstanceId: policy.scope.runtimeInstanceId },
      diff: { publishedDispositionRecovery: binding } })
    audit.generateSignature()
    return audit.toObject()
  }
  const typedHashes = async () => {
    const result = {}
    for (const name of [EvidenceSource.collection.name, EvidenceObject.collection.name, Section.collection.name]) {
      const rows = await collection(name).find({}, { maxTimeMS: 3000 }).sort({ _id: 1 }).toArray()
      result[name] = hash({ rows })
    }
    return result
  }
  const observed = async () => ({ root: hash(await root()), typed: await typedHashes(),
    receipts: await count(Receipt.collection.name), audits: await count(AuditLog.collection.name),
    updatedAt: (await root()).updatedAt.toISOString() })
  const expectNoWrite = async (input, code) => {
    const before = await observed()
    await expect(service.recordPublishedDispositionRecovery(input)).rejects.toMatchObject(typeof code === 'string' ? { code } : code)
    expect(await observed()).toEqual(before)
  }

  beforeAll(async () => {
    baselineText = readFileSync(baselinePath, 'utf8')
    expect(createHash('sha256').update(baselineText, 'utf8').digest('hex')).toBe(baselineSha.toLowerCase())
    const baseline = decode()
    expect(baseline.current.sources).toHaveLength(8)
    expect(baseline.current.evidence).toHaveLength(47)
    expect(baseline.current.sections).toHaveLength(6)
    expect(baseline.audits).toHaveLength(124)
    // Preserve all other exports; only the authority/scoped selection seam is simulated.
    const actual = await import('../services/runtimeInstanceService.js')
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...actual,
      getRuntimeInstance: async ({ runtimeInstanceId, session }) => {
        assertIsolated()
        if (String(runtimeInstanceId) !== policy.scope.runtimeInstanceId) throw Object.assign(new Error('scope'), { status: 403 })
        const value = await root(session)
        return { ...value, id: String(value._id) }
      },
      assertRuntimePermission: async () => {
        if (!permit) throw Object.assign(new Error('Denied isolated authority'), { status: 403, code: 'FORBIDDEN' })
      },
    }))
    ;({ default: env } = await import('../config/env.js'))
    ;({ default: RuntimeInstance } = await import('../models/RuntimeInstance.js'))
    ;({ default: EvidenceSource } = await import('../models/RuntimeEvidenceSource.js'))
    ;({ default: EvidenceObject } = await import('../models/RuntimeEvidenceObject.js'))
    ;({ default: Section } = await import('../models/RuntimeStateSection.js'))
    ;({ default: Receipt } = await import('../models/RuntimePublishedDispositionReceipt.js'))
    ;({ default: AuditLog } = await import('../models/AuditLog.js'))
    ;({ default: Authority } = await import('../models/RuntimeProductAuthorityReceipt.js'))
    ;({ default: Finding } = await import('../models/RuntimeSupplementalFindingReview.js'))
    ;({ PUBLISHED_DISPOSITION_POLICY: policy } = await import('../constants/publishedDispositionRecoveryPolicy.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
    service = await import('../services/publishedDispositionRecoveryService.js')
    authorityService = await import('../services/runtimeProductAuthorityService.js')
    findingService = await import('../services/supplementalFindingReviewService.js')
    ;({ completeReview } = await import('../services/reviewCompletionService.js'))
    if (mongoose.connection.readyState !== 0) throw new Error('Suite requires a fresh disconnected Mongoose connection.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false,
      maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    expect(hello.isWritablePrimary).toBe(true)
    const existing = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
    expect(existing).toHaveLength(0)
    const models = [RuntimeInstance, EvidenceSource, EvidenceObject, Section, Receipt, AuditLog, Authority, Finding]
    names = [...models.map(model => model.collection.name), 'runtime_synthetic_test_disposition_receipts']
    expect([...names].sort()).toEqual(['runtime_instances', 'runtime_evidence_sources', 'runtime_evidence_objects',
      'runtime_section_states', 'runtime_published_disposition_receipts', 'auditlogs', 'runtime_product_authority_receipts', 'runtime_supplemental_finding_reviews', 'runtime_synthetic_test_disposition_receipts'].sort())
    owned = true
    for (const model of models) { assertIsolated(); await model.createCollection() }
    await mongoose.connection.db.createCollection('runtime_synthetic_test_disposition_receipts')
    await Receipt.createIndexes()
    await Authority.createIndexes()
    await Finding.createIndexes()
  }, 30000)

  beforeEach(async () => {
    assertIsolated()
    permit = true
    for (const name of names) await collection(name).deleteMany({}, { maxTimeMS: 3000 })
    await Receipt.createIndexes()
    await Authority.createIndexes()
    await Finding.createIndexes()
    const baseline = decode()
    await RuntimeInstance.collection.insertOne(baseline.root)
    await EvidenceSource.collection.insertMany(baseline.current.sources)
    await EvidenceObject.collection.insertMany(baseline.current.evidence)
    await Section.collection.insertMany(baseline.current.sections)
    await AuditLog.collection.insertMany(baseline.audits)
    const admin = { ...args(), actorUserId: '698b3800f83b3257365fd7a3',
      scopes: { ...args().scopes, platformRoles: ['SUPER_ADMIN'] } }
    const authorityInspection = await authorityService.inspectRuntimeProductAuthority(admin)
    await authorityService.importRuntimeProductAuthority({ ...admin, payload: { requestKey: randomUUID(),
      expectedBasisHash: authorityInspection.expectedBasisHash, expectedUpdatedAt: authorityInspection.expectedUpdatedAt, confirm: true,
      approvalDocumentText: readFileSync(resolve('../docs/generated/harness-runs/ss-044/2026-10-16-product-authority/approval-v1.json'), 'utf8') } })
    await nativeFinding()
  }, 30000)
  afterEach(() => jest.restoreAllMocks())
  // Retain the isolated database for independent readback; never drop or clear it here.
  afterAll(async () => { await mongoose.disconnect() }, 20000)

  test('persists one signed supplemental freeze and exact replay without changing truth or typed rows', async () => {
    const input = await request(), before = await observed()
    const saved = await service.recordPublishedDispositionRecovery(input)
    expect(saved.replay).toBe(false)
    const record = await Receipt.findOne({ receiptId: saved.receipt.receiptId }).lean()
    expect(record.body.frozenMembership.counts).toEqual({ sources: 8, evidence: 47, sections: 6 })
    expect(record.body.qualifications.legacyMissingEvidenceSupportIds).toHaveLength(25)
    expect(record.body.qualifications.sourceAuthenticityApproval).toBe(false)
    const audit = await AuditLog.findById(record.auditId)
    expect(audit.verifySignature()).toBe(true)
    expect(audit.diff).toMatchObject({ action: 'PUBLISHED_DISPOSITION_SUPPLEMENT', receiptId: record.receiptId, bodyHash: record.bodyHash })
    const after = await observed()
    expect(after.root).toBe(before.root)
    expect(after.typed).toEqual(before.typed)
    expect(after.receipts).toBe(1)
    expect(after.audits).toBe(before.audits + 1)
    expect(after.updatedAt).toBe(record.body.committedUpdatedAt)
    expect(await service.recordPublishedDispositionRecovery(input)).toEqual({ receipt: saved.receipt, replay: true })
    expect(await observed()).toEqual(after)
  }, 30000)

  test('concurrent identical requests commit one receipt, one audit and the same receipt identity', async () => {
    const input = await request(), before = await observed()
    const results = await Promise.all([service.recordPublishedDispositionRecovery(input), service.recordPublishedDispositionRecovery(input)])
    expect(new Set(results.map(value => value.receipt.receiptId)).size).toBe(1)
    expect(results.filter(value => !value.replay)).toHaveLength(1)
    expect(await count(Receipt.collection.name)).toBe(1)
    expect(await count(AuditLog.collection.name)).toBe(before.audits + 1)
    expect((await observed()).typed).toEqual(before.typed)
  }, 40000)

  test('concurrent different request keys produce exactly one committed winner', async () => {
    const first = await request(), before = await observed()
    const second = { ...first, payload: { ...first.payload, requestKey: randomUUID() } }
    const results = await Promise.allSettled([service.recordPublishedDispositionRecovery(first), service.recordPublishedDispositionRecovery(second)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('PUBLISHED_RECOVERY_STALE')
    expect(await count(Receipt.collection.name)).toBe(1)
    expect(await count(AuditLog.collection.name)).toBe(before.audits + 1)
    expect((await observed()).root).toBe(before.root)
    expect((await observed()).typed).toEqual(before.typed)
  }, 40000)

  test.each(['audit', 'receipt'])('rolls back root CAS and all new records when %s persistence fails', async owner => {
    const input = await request(), before = await observed()
    const error = new Error(`isolated ${owner} failure`)
    const spy = owner === 'audit' ? jest.spyOn(auditService, 'log').mockRejectedValue(error)
      : jest.spyOn(Receipt, 'create').mockRejectedValue(error)
    await expect(service.recordPublishedDispositionRecovery(input)).rejects.toThrow(error.message)
    spy.mockRestore()
    expect(await observed()).toEqual(before)
  }, 30000)

  test.each(['state', 'source', 'evidence', 'section', 'audit', 'lock', 'updatedAt', 'updatedBy', '__v', 'current'])('rejects changed %s with no recovery writes', async kind => {
    const input = await request()
    if (kind === 'source') await EvidenceSource.collection.updateOne({ _id: decode().current.sources[0]._id }, { $set: { title: 'Changed source material' } })
    else if (kind === 'evidence') await EvidenceObject.collection.updateOne({ _id: decode().current.evidence[0]._id }, { $set: { extractedFact: 'Changed synthetic assertion' } })
    else if (kind === 'section') await Section.collection.updateOne({ _id: decode().current.sections[0]._id }, { $set: { 'sectionDetail.input': 'Changed section input' } })
    else if (kind === 'audit') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(policy.auditIds[0]) }, { $set: { signature: '0'.repeat(64) } })
    else await RuntimeInstance.collection.updateOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId) }, { $set:
      kind === 'state' ? { stateVersion: `rsv2:${randomUUID()}` } : kind === 'lock' ? { 'framework_state.lock.locked': true }
        : kind === 'updatedBy' ? { updatedBy: new mongoose.Types.ObjectId() }
          : ['__v', 'current'].includes(kind) ? { [kind]: 'intervening-change' }
        : { updatedAt: new Date(Date.parse(policy.updatedAt) + 1) } })
    await expectNoWrite(input, kind === 'section'
      ? { code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'CONTEXT_INPUT_MISMATCH' } }
      : kind === 'audit' ? 'PUBLISHED_RECOVERY_AUDIT_INVALID' : 'PUBLISHED_RECOVERY_STALE')
  }, 30000)
  test('rejects an actor-only intervening write after a committed receipt before replay or lock', async () => {
    const input = await request()
    await service.recordPublishedDispositionRecovery(input)
    await RuntimeInstance.collection.updateOne({ _id: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId) },
      { $set: { updatedBy: new mongoose.Types.ObjectId() } })
    await expectNoWrite(input, 'PUBLISHED_RECOVERY_STALE')
    await expect(verifyLock(await root())).rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_STALE' })
  }, 30000)

  test('rejects denied authority before any recovery write', async () => {
    const input = await request(); permit = false
    await expectNoWrite(input, 'FORBIDDEN')
  })
  test('rejects a missing required unique index before any recovery write', async () => {
    const input = await request()
    await Receipt.collection.dropIndex('unique_published_disposition_request')
    await expectNoWrite(input, 'PUBLISHED_RECOVERY_INDEX_REQUIRED')
  })
  test('requires a real receipt for lock and binds its exact signed link without executing LOCK', async () => {
    const input = await request()
    await expect(verifyLock(await root())).rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_REQUIRED' })
    const staleRoot = await root(), saved = await service.recordPublishedDispositionRecovery(input)
    await expect(verifyLock(staleRoot)).rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_STALE' })
    const current = await root(), link = await verifyLock(current)
    expect(link).toMatchObject({ receiptId: saved.receipt.receiptId, bodyHash: saved.receipt.bodyHash, freezeHash: policy.manifestHash })
    const before = await observed()
    const audit = signedTestAudit(link)
    await expect(service.verifyPublishedDispositionLockLink({ runtime: current, audit, session: null })).resolves.toBeUndefined()
    audit.diff.publishedDispositionRecovery.bodyHash = '0'.repeat(64)
    await expect(service.verifyPublishedDispositionLockLink({ runtime: current, audit, session: null }))
      .rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_INVALID' })
    await expect(service.verifyPublishedDispositionLockLink({ runtime: current,
      audit: signedTestAudit({ ...link, receiptId: randomUUID() }), session: null }))
      .rejects.toMatchObject({ code: 'PUBLISHED_RECOVERY_INVALID' })
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['source', 'evidence', 'section', 'audit'])('lock-link verification rejects changed historical %s after a valid recovery commit', async kind => {
    await service.recordPublishedDispositionRecovery(await request())
    const runtime = await root(), link = await verifyLock(runtime)
    const audit = signedTestAudit(link)
    if (kind === 'source') await EvidenceSource.collection.updateOne({ _id: decode().current.sources[0]._id }, { $set: { title: 'Changed historical source' } })
    if (kind === 'evidence') await EvidenceObject.collection.updateOne({ _id: decode().current.evidence[0]._id }, { $set: { extractedFact: 'Changed historical assertion' } })
    if (kind === 'section') await Section.collection.updateOne({ _id: decode().current.sections[0]._id }, { $set: { 'sectionDetail.input': 'Changed historical section' } })
    if (kind === 'audit') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(policy.auditIds[0]) }, { $set: { signature: '0'.repeat(64) } })
    const before = await observed()
    await expect(service.verifyPublishedDispositionLockLink({ runtime, audit, session: null }))
      .rejects.toMatchObject(kind === 'section'
        ? { code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'CONTEXT_INPUT_MISMATCH' } }
        : { code: kind === 'audit' ? 'PUBLISHED_RECOVERY_AUDIT_INVALID' : 'PUBLISHED_RECOVERY_INVALID' })
    expect(await observed()).toEqual(before)
  }, 30000)
  test('ordinary Review Completion still rejects missing ordinary history without adopting the supplemental receipt', async () => {
    const inspection = await service.inspectPublishedDispositionRecovery(args())
    expect(inspection.receipt).toBeNull()
    const { compileReviewPopulation } = await import('../services/reviewCompletionService.js')
    const runtime = await root(), session = await mongoose.startSession(), before = await observed()
    try {
      await expect(compileReviewPopulation({ ...runtime, id: String(runtime._id) }, session, Date.now() + 12000))
        .rejects.toMatchObject({ code: 'REVIEW_POPULATION_UNKNOWN' })
    } finally { await session.endSession() }
    await expect(completeReview({ ...args(), payload: { requestKey: randomUUID(), expectedPopulationHash: 'a'.repeat(64),
      rationale: 'Synthetic supplemental receipt is not ordinary historical review.', confirm: true } }))
      .rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['CONFIRMED', 'REOPENED'])('an actual native %s review remains blocking', async disposition => {
    const baseline = decode()
    await Finding.collection.deleteMany({})
    await RuntimeInstance.collection.replaceOne({ _id: baseline.root._id }, baseline.root)
    await nativeFinding(disposition)
    const before = await observed()
    await expect(service.inspectPublishedDispositionRecovery(args())).rejects.toMatchObject({ code: 'SUPPLEMENTAL_FINDING_UNRESOLVED' })
    await expect(verifyLock(await root())).rejects.toMatchObject({ code: 'SUPPLEMENTAL_FINDING_UNRESOLVED' })
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['missing', 'finding-audit', 'authority-audit', 'finding-body'])('rejects %s native finding proof without completion writes', async kind => {
    const finding = await Finding.findOne({}).lean(), authority = await Authority.findOne({}).lean()
    if (kind === 'missing') await Finding.collection.deleteMany({})
    if (kind === 'finding-audit') await AuditLog.collection.updateOne({ _id: finding.auditId }, { $set: { signature: '0'.repeat(64) } })
    if (kind === 'authority-audit') await AuditLog.collection.updateOne({ _id: authority.auditId }, { $set: { signature: '0'.repeat(64) } })
    if (kind === 'finding-body') await Finding.collection.updateOne({ _id: finding._id }, { $set: { 'body.rationale': 'Changed stored rationale.' } })
    const before = await observed()
    await expect(service.inspectPublishedDispositionRecovery(args())).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test.each(['basis', 'finding', 'population', 'downgrade'])('model rejects rehashed %s before storage', async kind => {
    await service.recordPublishedDispositionRecovery(await request())
    const record = await Receipt.findOne({}).lean()
    if (kind === 'basis') record.body.requestBasis.expectedBasisHash = '0'.repeat(64)
    if (kind === 'finding') record.body.findingReview.bodyHash = '0'.repeat(64)
    if (kind === 'population') {
      record.body.reviewPopulation.manifest.evidence[0].materialHash = '0'.repeat(64)
      const { membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
      record.body.reviewPopulation.populationHash = membershipHash(record.body.reviewPopulation.manifest)
    }
    if (kind === 'downgrade') { delete record.body.findingReview; delete record.body.predecessorControl; delete record.body.requestBasis }
    const { membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
    record.bodyHash = membershipHash(record.body); delete record._id
    const before = await observed()
    await expect(new Receipt(record).save({ validateBeforeSave: false })).rejects.toThrow()
    expect(await observed()).toEqual(before)
  }, 30000)
  test('even malformed scoped E1 test presence keeps the native lock guard held', async () => {
    await service.recordPublishedDispositionRecovery(await request())
    await collection('runtime_synthetic_test_disposition_receipts').insertOne({
      customerId: new mongoose.Types.ObjectId(policy.scope.customerId), tenantId: new mongoose.Types.ObjectId(policy.scope.tenantId),
      runtimeInstanceId: new mongoose.Types.ObjectId(policy.scope.runtimeInstanceId), malformed: true })
    const before = await observed()
    await expect(verifyLock(await root())).rejects.toMatchObject({ code: 'SYNTHETIC_PIPELINE_HELD' })
    expect(await observed()).toEqual(before)
  }, 30000)

})
