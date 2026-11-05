import { jest } from '@jest/globals'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import { docxVisualReviewFixture, visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { claimGovernedRenditionReview, readGovernedRenditionReviewClaim } from '../services/governedRenditionReviewClaimService.js'
import { buildOpenAiDocxRenditionReviewRequest, createOpenAiDocxRenditionReviewProviderAdapter } from '../services/openAiDocxRenditionReviewProviderAdapter.js'
import { reserveGovernedRenditionReviewDispatch as reserve, recordRenditionReviewResponseIdentity as identify,
  recordRenditionReviewUncertainty as uncertain, readGovernedRenditionReviewDispatch as read } from '../services/governedRenditionReviewDispatchService.js'
import { renditionReceiptId } from '../services/outcomeRenditionReviewDispatchContract.js'
import { RENDITION_DISPATCH_VERSION, RENDITION_DISPATCH_STATUS } from '../services/outcomeRenditionReviewClaimContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

const database = process.env.VMF_RENDITION_DISPATCH_ISOLATED_DB
const run = database ? describe : describe.skip
run('durable review dispatch real isolated reservation/receipt; generic admission/context and fake provider', () => {
  jest.setTimeout(30000)
  let owned = false, evidencePath, f, deps, args, binding, transport
  const snapshots = []
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)
      || ![Execution.collection.name, Audit.collection.name].includes(name)) throw new Error('Owned isolated collection required')
    return mongoose.connection.db.collection(name)
  }
  const counts = async () => [await Execution.countDocuments({}), await Audit.countDocuments({})]
  const reserveAndIdentityArgs = async () => {
    const saved = await reserve(args)
    return { saved, input: { ...args, reservationExecutionId: saved.reservation.executionId, responseId: 'resp_isolated_review', postRequestId: 'req_isolated_review' } }
  }
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_RENDITION_DISPATCH_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 8, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true; await Execution.createCollection(); await Execution.createIndexes(); await Audit.createCollection()
  })
  beforeEach(async () => {
    f = docxVisualReviewFixture(); transport = await f.transport(); binding = buildOpenAiDocxRenditionReviewRequest(transport).binding
    const claimDeps = { Execution, Audit, prepareAdmission: f.admission,
      auditService: { log: (data, options) => Audit.createLog(data, { session: options.session }) } }
    const claimArgs = { ...f.args, deps: claimDeps }
    await claimGovernedRenditionReview(claimArgs)
    deps = { Execution, Audit, prepareTransport: jest.fn(f.transport), readClaim: jest.fn(async input => readGovernedRenditionReviewClaim({ ...claimArgs,
      actorUserId: input.actorUserId, runtimeInstanceId: input.runtimeInstanceId, candidateId: input.candidateId })),
    auditService: { log: jest.fn((data, options) => Audit.createLog(data, { session: options.session })) } }
    args = { ...f.args, binding, deps }
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    if (!owned) return
    const executions = await collection(Execution.collection.name).find({}).toArray(), audits = await collection(Audit.collection.name).find({}).toArray()
    snapshots.push({ case: expect.getState().currentTestName, executions, audits, indexes: await Execution.collection.indexes(),
      auditIndexes: await Audit.collection.indexes(), auditSignaturesValid: audits.map(row => Audit.hydrate(row).verifySignature()) })
    writeFileSync(evidencePath, JSON.stringify({ database, boundary: 'Real isolated uniqueness/transactions/signatures; generic source/auth/context and fake provider, not native parity', snapshots }, null, 2))
    await collection(Execution.collection.name).deleteMany({}); await collection(Audit.collection.name).deleteMany({})
  })
  afterAll(async () => { if (owned) expect(await counts()).toEqual([0, 0]); await mongoose.disconnect() })
  test('fresh durable winner alone owns one acknowledgement; replay/restart cannot recreate it', async () => {
    expect(await read(args)).toEqual({ state: 'ADMITTED_NOT_RESERVED', dispatchAvailable: false })
    const saved = await reserve(args)
    expect(await counts()).toEqual([2, 2]); expect(typeof saved.consumeAcknowledgement).toBe('function')
    expect(JSON.stringify(saved)).not.toContain('consumeAcknowledgement')
    expect(saved.consumeAcknowledgement(binding)).toMatchObject({ state: 'DURABLE_DISPATCH_RESERVED', ...binding })
    expect(() => saved.consumeAcknowledgement(binding)).toThrow()
    expect((await reserve(args)).consumeAcknowledgement).toBeUndefined()
    expect((await read(args)).state).toBe('RESERVED_OUTCOME_UNKNOWN')
    const row = await Execution.findOne({ contractVersion: RENDITION_DISPATCH_VERSION }).lean()
    expect(row.completedAt).toBeNull(); expect(row.artifactIds).toEqual([])
  })
  test('concurrent matching reservations produce one capability and one signed reservation', async () => {
    const rows = await Promise.all([reserve(args), reserve(args)])
    expect(rows.filter(row => typeof row.consumeAcknowledgement === 'function')).toHaveLength(1)
    expect(new Set(rows.map(row => row.reservation.executionId)).size).toBe(1); expect(await counts()).toEqual([2, 2])
  })
  test('different request/context and actor cannot reserve under an existing admission', async () => {
    const wrong = { ...binding, requestIdentity: 'f'.repeat(64) }
    const results = await Promise.allSettled([reserve(args), reserve({ ...args, binding: wrong })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(row => row.status === 'rejected').reason.details.reason).toBe('DISPATCH_REQUEST_CHANGED')
    await expect(reserve({ ...args, actorUserId: '507f1f77bcf86cd799439099' })).rejects.toThrow()
    expect(await counts()).toEqual([2, 2])
  })
  test('wrong acknowledgement consumes fresh capability without authorizing another binding', async () => {
    const saved = await reserve(args)
    expect(() => saved.consumeAcknowledgement({ ...binding, contextFingerprint: 'f'.repeat(64) })).toThrow()
    expect(() => saved.consumeAcknowledgement(binding)).toThrow(); expect((await reserve(args)).consumeAcknowledgement).toBeUndefined()
  })
  test('lost post-commit read grants no capability and permanent replay hold', async () => {
    const original = Execution.findOne.bind(Execution); let reservationReads = 0
    const spy = jest.spyOn(Execution, 'findOne').mockImplementation(filter => {
      const query = original(filter)
      if (String(filter.idempotencyKey || '').startsWith('DOCX_RENDITION_REVIEW_DISPATCH:') && ++reservationReads === 3)
        query.lean = jest.fn().mockRejectedValue(new Error('Durable read lost'))
      return query
    })
    await expect(reserve(args)).rejects.toThrow('Durable read lost'); spy.mockRestore()
    expect(await counts()).toEqual([2, 2]); expect((await reserve(args)).consumeAcknowledgement).toBeUndefined()
  })
  test('required audit failure and post-audit insertion failure roll back reservation', async () => {
    deps.auditService.log.mockRejectedValueOnce(new Error('Audit unavailable'))
    await expect(reserve(args)).rejects.toThrow('Audit unavailable'); expect(await counts()).toEqual([1, 1])
    jest.spyOn(Execution, 'create').mockRejectedValueOnce(new Error('Insert failed'))
    await expect(reserve(args)).rejects.toThrow('Insert failed'); expect(await counts()).toEqual([1, 1])
  })
  test('missing existing unique index blocks without automatic migration', async () => {
    await collection(Execution.collection.name).dropIndex('runtimeInstanceId_1_idempotencyKey_1')
    try { await expect(reserve(args)).rejects.toMatchObject({ status: 503 }); expect(await counts()).toEqual([1, 1]) }
    finally { await Execution.createIndexes() }
  })
  test('same provider identity concurrent receipts converge using builtin _id uniqueness', async () => {
    const { input } = await reserveAndIdentityArgs()
    const replies = await Promise.all([identify(input), identify(input)])
    expect(replies[0]).toEqual(replies[1]); expect(await counts()).toEqual([2, 3])
    expect((await read(args)).state).toBe('RESPONSE_KNOWN_AWAITING_RESULT')
  })
  test('conflicting provider identities race to one signed winner without overwrite', async () => {
    const { input } = await reserveAndIdentityArgs()
    const results = await Promise.allSettled([identify(input), identify({ ...input, responseId: 'resp_other' })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(await counts()).toEqual([2, 3])
    expect((await read(args)).receipts.RESPONSE.responseId).toMatch(/^resp_(isolated_review|other)$/)
  })
  test('foreign deterministic receipt occupant blocks and remains unchanged', async () => {
    const { saved, input } = await reserveAndIdentityArgs(), _id = new mongoose.Types.ObjectId(renditionReceiptId('RESPONSE', saved.reservation.executionId))
    const foreign = await Audit.createLog({ _id, actorUserId: f.actorUserId, action: 'UNRELATED_AUDIT', resourceType: 'GovernedReasoningExecution',
      resourceId: new mongoose.Types.ObjectId(), scope: f.scope, diff: { unrelated: true } })
    const before = membershipHash(foreign.toObject())
    await expect(identify(input)).rejects.toMatchObject({ details: { reason: 'DISPATCH_RECEIPT_INVALID' } })
    expect(membershipHash(await Audit.findById(_id).lean())).toBe(before); expect(await counts()).toEqual([2, 3])
  })
  test('known uncertainty writes response identity and uncertainty atomically and replays', async () => {
    const { input } = await reserveAndIdentityArgs(), value = { reason: 'PROVIDER_TIMEOUT', outcome: 'KNOWN_RESPONSE_UNRESOLVED',
      responseId: input.responseId, postRequestId: input.postRequestId }
    const first = await uncertain({ ...input, uncertainty: value })
    expect(await uncertain({ ...input, uncertainty: value })).toEqual(first)
    expect(await counts()).toEqual([2, 4]); expect((await read(args)).state).toBe('RECORDED_UNCERTAINTY')
    expect((await read(args)).receipts.RESPONSE.responseId).toBe(input.responseId)
  })
  test('unknown submission stays held and changed uncertainty cannot overwrite it', async () => {
    const { input } = await reserveAndIdentityArgs(), value = { reason: 'PROVIDER_NETWORK_FAILED', outcome: 'SUBMISSION_UNCERTAIN', responseId: '', postRequestId: '' }
    await uncertain({ ...input, uncertainty: value })
    await expect(uncertain({ ...input, uncertainty: { ...value, reason: 'PROVIDER_TIMEOUT' } })).rejects.toThrow()
    expect(await counts()).toEqual([2, 3]); expect((await read(args)).receipts.RESPONSE).toBeUndefined()
    expect((await reserve(args)).consumeAcknowledgement).toBeUndefined()
  })
  test('response and known-uncertainty write skew cannot persist disagreeing provider IDs', async () => {
    const { input } = await reserveAndIdentityArgs()
    const results = await Promise.allSettled([identify(input), uncertain({ ...input,
      uncertainty: { reason: 'PROVIDER_TIMEOUT', outcome: 'KNOWN_RESPONSE_UNRESOLVED', responseId: 'resp_conflict', postRequestId: input.postRequestId } })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const state = await read(args), known = Object.values(state.receipts).map(row => row.responseId).filter(Boolean)
    expect(new Set(known).size).toBe(1)
  })
  test('corrupt reservation and receipt signatures block composite read', async () => {
    const { saved, input } = await reserveAndIdentityArgs(); await identify(input)
    const responseId = renditionReceiptId('RESPONSE', saved.reservation.executionId)
    await collection(Audit.collection.name).updateOne({ _id: new mongoose.Types.ObjectId(responseId) }, { $set: { signature: 'invalid' } })
    await expect(read(args)).rejects.toMatchObject({ details: { reason: 'DISPATCH_RECEIPT_INVALID' } })
    const row = await Execution.findOne({ executionId: saved.reservation.executionId }).lean()
    await collection(Audit.collection.name).updateOne({ _id: row.executionEvidence.renditionReview.auditId }, { $set: { signature: 'invalid' } })
    await expect(reserve(args)).rejects.toMatchObject({ details: { reason: 'DISPATCH_SIGNED_AUDIT_INVALID' } })
  })
  test('reservation tuple cannot be promoted, removed or replaced through ordinary model paths', async () => {
    const { saved } = await reserveAndIdentityArgs(), filter = { executionId: saved.reservation.executionId }
    const remove = { $set: { contractVersion: '1.0.0', outputTypeKey: 'OTHER', status: 'COMPLETED', idempotencyKey: 'ordinary' }, $unset: { executionEvidence: '' } }
    for (const action of [() => Execution.updateOne(filter, remove), () => Execution.deleteMany(filter),
      () => Execution.bulkWrite([{ replaceOne: { filter, replacement: { executionId: 'other' } } }])]) await expect(action()).rejects.toThrow()
    const row = await Execution.findOne(filter); row.contractVersion = '1.0.0'; row.outputTypeKey = 'OTHER'; row.status = 'COMPLETED'; row.idempotencyKey = 'ordinary'; row.executionEvidence = null
    await expect(row.save()).rejects.toThrow(); await expect(row.deleteOne()).rejects.toThrow()
    for (const change of [{ contractVersion: ` ${RENDITION_DISPATCH_VERSION} ` }, { status: ` ${RENDITION_DISPATCH_STATUS.toLowerCase()} ` }])
      await expect(Execution.updateOne({ executionId: 'missing' }, { $set: change }, { upsert: true })).rejects.toThrow()
    expect(await counts()).toEqual([2, 2])
  })
  test.each(['query', 'bulk'])('actual %s predicate excludes a dispatch reserved after the guard observed none', async kind => {
    const filter = { idempotencyKey: /^DOCX_RENDITION_REVIEW_DISPATCH:/ }
    const spy = jest.spyOn(Execution, 'exists').mockImplementationOnce(async () => { await reserve(args); return null })
    if (kind === 'query') await Execution.updateMany(filter, { $set: { executionIntent: 'Should not change reservation' } })
    else await Execution.bulkWrite([{ deleteMany: { filter } }])
    spy.mockRestore(); expect((await read(args)).state).toBe('RESERVED_OUTCOME_UNKNOWN'); expect(await counts()).toEqual([2, 2])
  })
  test('two adapter instances with real reservation callbacks produce exactly one fake POST', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, headers: { get: () => 'req_fake' }, text: async () => JSON.stringify({ id: 'resp_fake', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput()) }] }] }) }))
    const make = () => {
      let owned
      return createOpenAiDocxRenditionReviewProviderAdapter({ apiKey: 'fake-unit-key', fetchImpl,
        reserveDispatch: async expected => { owned = await reserve({ ...args, binding: expected }); if (!owned.consumeAcknowledgement) throw new Error('Held'); return owned.consumeAcknowledgement(expected) },
        recordResponseIdentity: identity => identify({ ...args, binding: Object.fromEntries(['requestIdentity', 'subjectFingerprint', 'contextFingerprint'].map(key => [key, identity[key]])),
          reservationExecutionId: owned.reservation.executionId, responseId: identity.responseId, postRequestId: identity.postRequestId }) })
    }
    const results = await Promise.allSettled([make()(transport), make()(transport)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await counts()).toEqual([2, 3]); expect((await read(args)).state).toBe('RESPONSE_KNOWN_AWAITING_RESULT')
  })
  test('receipt audit failure prevents acknowledgement, preserves reservation, and can record known uncertainty', async () => {
    const { input } = await reserveAndIdentityArgs()
    deps.auditService.log.mockRejectedValueOnce(new Error('Response audit unavailable'))
    await expect(identify(input)).rejects.toThrow('Response audit unavailable'); expect(await counts()).toEqual([2, 2])
    await uncertain({ ...input, uncertainty: { reason: 'REQUIRED_DURABLE_CALLBACK_FAILED', outcome: 'KNOWN_RESPONSE_UNRESOLVED', responseId: input.responseId, postRequestId: input.postRequestId } })
    expect(await counts()).toEqual([2, 4]); expect((await reserve(args)).consumeAcknowledgement).toBeUndefined()
  })
  test('legacy provider population query shapes exclude claim and dispatch records', async () => {
    const nativeScope = Object.fromEntries(Object.entries(f.scope).map(([key, value]) => [key, new mongoose.Types.ObjectId(value)]))
    await collection(Execution.collection.name).insertOne({ ...nativeScope, executionId: 'historical', outputTypeKey: 'RENDERED_EXPRESSION_RL',
      executionEvidence: { syntheticClassification: { planId: f.plan.planId, requestId: f.plan.requestId, runEventId: 'old' } } })
    const filters = [{ ...nativeScope, outputTypeKey: 'RENDERED_EXPRESSION_RL' }, { ...nativeScope, 'executionEvidence.syntheticClassification.runEventId': 'old' },
      { ...nativeScope, $or: [{ 'executionEvidence.syntheticClassification.planId': f.plan.planId }, { 'executionEvidence.syntheticClassification.requestId': f.plan.requestId }] }]
    const before = await Promise.all(filters.map(filter => collection(Execution.collection.name).find(filter).toArray()))
    await reserve(args)
    expect((await Promise.all(filters.map(filter => collection(Execution.collection.name).find(filter).toArray()))).map(membershipHash)).toEqual(before.map(membershipHash))
  })
})
