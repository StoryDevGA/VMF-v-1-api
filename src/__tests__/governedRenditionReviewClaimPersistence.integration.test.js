import { jest } from '@jest/globals'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
import { claimGovernedRenditionReview, readGovernedRenditionReviewClaim } from '../services/governedRenditionReviewClaimService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { RENDITION_CLAIM_VERSION, RENDITION_CLAIM_STATUS } from '../services/outcomeRenditionReviewClaimContract.js'

const clone = value => JSON.parse(JSON.stringify(value))
const database = process.env.VMF_RENDITION_CLAIM_ISOLATED_DB
const run = database ? describe : describe.skip
run('rendition claim real isolated persistence; explicit admission seam', () => {
  jest.setTimeout(30000)
  let owned = false, evidencePath, f, admission, deps, args
  const snapshots = []
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)
      || ![Execution.collection.name, Audit.collection.name].includes(name)) throw new Error('Owned isolated collection required')
    return mongoose.connection.db.collection(name)
  }
  const counts = async () => [await Execution.countDocuments({}), await Audit.countDocuments({})]
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_RENDITION_CLAIM_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 6, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    await Execution.createCollection(); await Execution.createIndexes(); await Audit.createCollection()
  })
  beforeEach(async () => {
    f = renditionReviewClaimFixture(); admission = await f.admission()
    deps = { Execution, Audit, prepareAdmission: jest.fn(async () => clone(admission)),
      auditService: { log: jest.fn((data, options) => Audit.createLog(data, { session: options.session })) } }
    args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: f.preview.candidateId, expected: f.args.expected,
      scopes: f.args.scopes, deps }
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    if (!owned) return
    const executions = await collection(Execution.collection.name).find({}).toArray(), audits = await collection(Audit.collection.name).find({}).toArray()
    snapshots.push({ case: expect.getState().currentTestName, executions, audits, indexes: await Execution.collection.indexes(),
      auditSignaturesValid: audits.map(row => Audit.hydrate(row).verifySignature()) })
    writeFileSync(evidencePath, JSON.stringify({ database, boundary: 'Real isolated transaction/index/audit; generic verified admission seam, not native source replay', snapshots }, null, 2))
    await collection(Execution.collection.name).deleteMany({}); await collection(Audit.collection.name).deleteMany({})
  })
  afterAll(async () => { if (owned) expect(await counts()).toEqual([0, 0]); await mongoose.disconnect() })
  test('signed claim read and stable replay never grant dispatch or produce artifacts', async () => {
    expect(await readGovernedRenditionReviewClaim(args)).toEqual({ claim: null, dispatchAvailable: false })
    const saved = await claimGovernedRenditionReview(args)
    expect(saved.idempotent).toBe(false); expect(saved.dispatchAvailable).toBe(false); expect(await counts()).toEqual([1, 1])
    expect(await claimGovernedRenditionReview(args)).toEqual({ ...saved, idempotent: true })
    expect(await readGovernedRenditionReviewClaim(args)).toEqual({ ...saved, idempotent: true })
    const record = await Execution.findOne({}).lean()
    expect(record.status).toBe(RENDITION_CLAIM_STATUS); expect(record.completedAt).toBeNull(); expect(record.artifactIds).toEqual([])
    expect(record.executionEvidence).not.toHaveProperty('syntheticClassification')
    expect(JSON.stringify(record)).not.toContain(f.methodContent)
    expect(Audit.hydrate(await Audit.findOne({}).lean()).verifySignature()).toBe(true)
  })
  test('same subject concurrency yields exactly one immutable claim and signed audit', async () => {
    const results = await Promise.all([claimGovernedRenditionReview(args), claimGovernedRenditionReview(args)])
    expect(new Set(results.map(row => row.claim.executionId)).size).toBe(1)
    expect(results.every(row => row.dispatchAvailable === false)).toBe(true); expect(await counts()).toEqual([1, 1])
  })
  test('competing candidate for same plan conflicts before any dispatch', async () => {
    const second = clone(admission); second.subject.candidate.candidateId = 'docx_candidate_12345678-1234-4234-8234-123456789012'
    const other = { ...args, candidateId: second.subject.candidate.candidateId, deps: { ...deps, prepareAdmission: async () => second } }
    const results = await Promise.allSettled([claimGovernedRenditionReview(args), claimGovernedRenditionReview(other)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(row => row.status === 'rejected').reason.details.reason).toBe('CLAIM_SUBJECT_CONFLICT')
    expect(await counts()).toEqual([1, 1])
  })
  test('changed subject including actor cannot reuse the fixed plan key', async () => {
    await claimGovernedRenditionReview(args)
    for (const mutate of [value => { value.subject.method.versionId = 'different' }, value => { value.subject.preview.runtimeFingerprint = 'f'.repeat(64) },
      value => { value.subject.actorUserId = '507f1f77bcf86cd799439099' }]) {
      const next = clone(admission); mutate(next)
      await expect(claimGovernedRenditionReview({ ...args, actorUserId: next.subject.actorUserId, deps: { ...deps, prepareAdmission: async () => next } }))
        .rejects.toMatchObject({ details: { reason: 'CLAIM_SUBJECT_CONFLICT', dispatchAvailable: false } })
    }
    expect(await counts()).toEqual([1, 1])
  })
  test('rejected admission and changed re-observation write nothing', async () => {
    deps.prepareAdmission.mockRejectedValueOnce(new Error('Admission denied'))
    await expect(claimGovernedRenditionReview(args)).rejects.toThrow('Admission denied')
    const next = clone(admission); next.subject.preview.runtimeFingerprint = 'f'.repeat(64)
    deps.prepareAdmission.mockResolvedValueOnce(admission).mockResolvedValueOnce(next)
    await expect(claimGovernedRenditionReview(args)).rejects.toMatchObject({ details: { reason: 'CLAIM_ADMISSION_CHANGED' } })
    expect(await counts()).toEqual([0, 0])
  })
  test('required audit failure rolls the transaction back', async () => {
    deps.auditService.log.mockRejectedValue(new Error('Audit failed'))
    await expect(claimGovernedRenditionReview(args)).rejects.toThrow('Audit failed'); expect(await counts()).toEqual([0, 0])
  })
  test('insertion failure after signed audit rolls the audit back', async () => {
    jest.spyOn(Execution, 'create').mockRejectedValueOnce(new Error('Insertion failed'))
    await expect(claimGovernedRenditionReview(args)).rejects.toThrow('Insertion failed'); expect(await counts()).toEqual([0, 0])
  })
  test('missing exact unique index refuses admission without restoring it automatically', async () => {
    await collection(Execution.collection.name).dropIndex('runtimeInstanceId_1_idempotencyKey_1')
    try { await expect(claimGovernedRenditionReview(args)).rejects.toMatchObject({ status: 503 }); expect(await counts()).toEqual([0, 0]) }
    finally { await Execution.createIndexes() }
  })
  test('wrong ordered keys or partial filter refuses claim', async () => {
    const actual = await Execution.collection.indexes()
    for (const change of [index => { index.key = { idempotencyKey: 1, runtimeInstanceId: 1 } }, index => { index.partialFilterExpression = { idempotencyKey: { $exists: true } } },
      index => { delete index.partialFilterExpression }]) {
      const fake = clone(actual); change(fake.find(index => index.name === 'runtimeInstanceId_1_idempotencyKey_1'))
      const spy = jest.spyOn(Execution.collection, 'indexes').mockResolvedValue(fake)
      await expect(claimGovernedRenditionReview(args)).rejects.toMatchObject({ status: 503 }); spy.mockRestore()
    }
    expect(await counts()).toEqual([0, 0])
  })
  test('corrupt audit or claim refuses read; failed evidence retained', async () => {
    await claimGovernedRenditionReview(args)
    await collection(Audit.collection.name).updateOne({}, { $set: { signature: 'invalid' } })
    await expect(readGovernedRenditionReviewClaim(args)).rejects.toMatchObject({ details: { reason: 'CLAIM_SIGNED_AUDIT_INVALID' } })
    expect(await counts()).toEqual([1, 1])
    await collection(Execution.collection.name).updateOne({}, { $set: { requestFingerprint: 'f'.repeat(64) } })
    await expect(readGovernedRenditionReviewClaim(args)).rejects.toMatchObject({ details: { reason: 'CLAIM_BINDING' } })
  })
  test('claim mutation blocked even when discriminator removed, through document/query/bulk paths', async () => {
    await claimGovernedRenditionReview(args)
    const before = membershipHash(await Execution.findOne({}).lean()), row = await Execution.findOne({})
    const remove = { $set: { contractVersion: '1.0.0', status: 'COMPLETED', outputTypeKey: 'OTHER', idempotencyKey: 'ordinary' }, $unset: { executionEvidence: '' } }
    for (const action of [() => Execution.updateOne({}, remove), () => Execution.updateMany({}, remove), () => Execution.findOneAndUpdate({}, remove),
      () => Execution.replaceOne({}, { executionId: 'replacement' }), () => Execution.findOneAndReplace({}, { executionId: 'replacement' }),
      () => Execution.deleteOne({}), () => Execution.deleteMany({}), () => Execution.findOneAndDelete({}),
      () => Execution.bulkWrite([{ updateOne: { filter: {}, update: remove } }]), () => row.deleteOne()]) {
      await expect(action()).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
    }
    row.contractVersion = '1.0.0'; row.status = 'COMPLETED'; row.outputTypeKey = 'OTHER'; row.idempotencyKey = 'ordinary'; row.executionEvidence = null
    await expect(row.save()).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
    expect(membershipHash(await Execution.findOne({}).lean())).toBe(before)
  })
  test('ordinary GRR retains statuses, create/update/delete and index contract', async () => {
    const ordinary = { executionId: 'ordinary', ...f.scope, runtimeType: 'VMF', frameworkKey: 'VMF', outputTypeKey: 'EXECUTIVE_BRIEF',
      status: 'COMPLETED', providerMode: 'DETERMINISTIC_TEST', requestedBy: f.actorUserId }
    const row = await Execution.create(ordinary); row.executionIntent = 'Updated'; await row.save()
    await Execution.updateOne({ _id: row._id }, { $set: { executionIntent: 'Query update' } })
    expect((await Execution.findById(row._id)).executionIntent).toBe('Query update')
    await Execution.deleteOne({ _id: row._id }); expect(await counts()).toEqual([0, 0])
    await expect(Execution.create({ ...ordinary, status: RENDITION_CLAIM_STATUS })).rejects.toThrow()
    await expect(Execution.create({ ...ordinary, contractVersion: RENDITION_CLAIM_VERSION })).rejects.toThrow()
    await expect(Execution.updateOne({}, { $set: { status: RENDITION_CLAIM_STATUS } }, { upsert: true })).rejects.toThrow()
  })
  test('legacy provider population query shapes exclude new claim and preserve representative rows', async () => {
    const nativeScope = Object.fromEntries(Object.entries(f.scope).map(([key, value]) => [key, new mongoose.Types.ObjectId(value)]))
    await collection(Execution.collection.name).insertOne({ ...nativeScope, executionId: 'historical-rl', outputTypeKey: 'RENDERED_EXPRESSION_RL',
      executionEvidence: { syntheticClassification: { requestId: f.plan.requestId, planId: f.plan.planId, runEventId: 'old-event' } } })
    const filters = [{ ...nativeScope, $or: [{ 'executionEvidence.syntheticClassification.requestId': f.plan.requestId }, { 'executionEvidence.syntheticClassification.planId': f.plan.planId }] },
      { ...nativeScope, 'executionEvidence.syntheticClassification.runEventId': 'old-event' }, { ...nativeScope, outputTypeKey: 'RENDERED_EXPRESSION_RL' }]
    const before = await Promise.all(filters.map(filter => collection(Execution.collection.name).find(filter).toArray()))
    await claimGovernedRenditionReview(args)
    const after = await Promise.all(filters.map(filter => collection(Execution.collection.name).find(filter).toArray()))
    expect(after.map(membershipHash)).toEqual(before.map(membershipHash)); expect(after.every(rows => rows.length === 1)).toBe(true)
    expect(await counts()).toEqual([2, 1])
  })
  test.each(['updateMany', 'deleteMany', 'bulkUpdate', 'bulkDelete'])('atomic %s predicate excludes a claim committed after guard observation', async operation => {
    await collection(Execution.collection.name).insertOne({ executionId: 'ordinary-race-control', ...f.scope, status: 'COMPLETED' })
    // Force the precise interleaving: pre-hook observed no claim, a different
    // operation commits one, then the broad mutation reaches MongoDB.
    const spy = jest.spyOn(Execution, 'exists').mockImplementationOnce(async () => {
      await claimGovernedRenditionReview(args)
      return null
    })
    if (operation === 'updateMany') await Execution.updateMany({}, { $set: { executionIntent: 'ordinary update' } })
    if (operation === 'deleteMany') await Execution.deleteMany({})
    if (operation === 'bulkUpdate') await Execution.bulkWrite([{ updateMany: { filter: {}, update: { $set: { executionIntent: 'ordinary update' } } } }])
    if (operation === 'bulkDelete') await Execution.bulkWrite([{ deleteMany: { filter: {} } }])
    spy.mockRestore()
    const saved = await readGovernedRenditionReviewClaim(args)
    expect(saved.claim.state).toBe('NOT_DISPATCHED'); expect(saved.dispatchAvailable).toBe(false)
    expect(await Audit.countDocuments({})).toBe(1)
    const ordinary = await Execution.findOne({ executionId: 'ordinary-race-control' }).lean()
    if (operation.toLowerCase().includes('delete')) expect(ordinary).toBeNull()
    else expect(ordinary.executionIntent).toBe('ordinary update')
  })
  test('rename and computed pipeline cannot promote ordinary fields into reserved identity', async () => {
    await collection(Execution.collection.name).insertOne({ executionId: 'ordinary-rename-control', ...f.scope, status: 'COMPLETED', executionIntent: RENDITION_CLAIM_STATUS })
    for (const update of [{ $rename: { executionIntent: 'status' } }, [{ $set: { status: { $concat: ['RENDITION_', 'REVIEW_CLAIMED'] } } }],
      [{ $replaceWith: { status: RENDITION_CLAIM_STATUS } }]]) {
      await expect(Execution.updateOne({}, update)).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
      await expect(Execution.bulkWrite([{ updateOne: { filter: {}, update } }])).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
    }
    expect((await Execution.findOne({ executionId: 'ordinary-rename-control' })).status).toBe('COMPLETED')
  })
  test('schema trimming and uppercase casting cannot promote a query update into reserved identity', async () => {
    for (const change of [{ contractVersion: ` ${RENDITION_CLAIM_VERSION} ` }, { status: ' rendition_review_claimed ' }, { outputTypeKey: ' rendition_rendered_expression_rl ' },
      { idempotencyKey: ' DOCX_RENDITION_REVIEW:other ' }]) {
      await expect(Execution.updateOne({}, { $set: change }, { upsert: true })).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
      await expect(Execution.bulkWrite([{ updateOne: { filter: {}, update: { $set: change }, upsert: true } }])).rejects.toThrow()
    }
    expect(await counts()).toEqual([0, 0])
  })
})
