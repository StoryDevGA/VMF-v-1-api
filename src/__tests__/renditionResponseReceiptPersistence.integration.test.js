import { jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import mongoose from 'mongoose'
import env from '../config/env.js'
import BaseExecution from '../models/GovernedReasoningExecution.js'
import BaseAudit from '../models/AuditLog.js'
import { docxVisualReviewFixture, resealVisualReviewFixture, visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { claimGovernedRenditionReview, readGovernedRenditionReviewClaim } from '../services/governedRenditionReviewClaimService.js'
import { reserveGovernedRenditionReviewDispatch as reserve, recordRenditionReviewResponseIdentity as identify,
  recordRenditionReviewUncertainty as uncertain } from '../services/governedRenditionReviewDispatchService.js'
import { renditionReceiptId, RENDITION_RESPONSE_ACTION } from '../services/outcomeRenditionReviewDispatchContract.js'
import { renditionClaimKey } from '../services/outcomeRenditionReviewClaimContract.js'
import { buildOpenAiDocxRenditionReviewRequest, createOpenAiDocxRenditionReviewProviderAdapter } from '../services/openAiDocxRenditionReviewProviderAdapter.js'

const database = process.env.VMF_RESPONSE_RECEIPT_REUSE_DB
const fenceCheck = process.env.VMF_RESPONSE_RECEIPT_FENCE_CHECK ? test : test.skip
fenceCheck('offline receipt fence ownership uses the actual imported driver before connection', () => {
  expect(mongoose.get('autoCreate')).toBe(false); expect(mongoose.get('autoIndex')).toBe(false)
  const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { dbName: 'test' })
  expect(() => client.db('test').collection('runtime_instances').find({})).toThrow('RECEIPT_QA_NAMESPACE_OR_OPERATION_REFUSED')
  expect(() => client.db('ss044_1619d7db635949898c9abb4592d10bcf').collection('ss055_qa_rendition_audits').find({})).toThrow('RECEIPT_QA_NAMESPACE_OR_OPERATION_REFUSED')
  const intended = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { dbName: 'ss044_1619d7db635949898c9abb4592d10bcf' })
  expect(intended.options.dbName).toBe('ss044_1619d7db635949898c9abb4592d10bcf')
  expect(() => intended.db().collection('ss055_qa_rendition_audits').find({})).toThrow('RECEIPT_QA_NAMESPACE_OR_OPERATION_REFUSED')
})
const run = database ? describe : describe.skip
run('response receipt real persistence in reusable QA collections; generic source and fake provider only', () => {
  jest.setTimeout(30000)
  let Execution, Audit, args, f, transport, binding, deps, claimArgs, saved
  const evidence = [], ids = new Set()
  const snapshot = async () => {
    const executions = await Execution.find({ executionId: { $in: [...ids] } }).lean()
    const audits = await Audit.find({ resourceId: { $in: executions.map(row => row._id) } }).lean()
    return { executions, audits, signatures: audits.map(row => Audit.hydrate(row).verifySignature()) }
  }
  beforeAll(async () => {
    if (database !== 'ss044_1619d7db635949898c9abb4592d10bcf' || mongoose.connection.readyState !== 0
      || !process.env.VMF_RESPONSE_RECEIPT_EVIDENCE?.replaceAll('\\', '/').startsWith('C:/Dev/StoryLineOS/VMF-Evidence/ss-055/')) throw Error('REUSED_DATABASE_AND_EXTERNAL_EVIDENCE_REQUIRED')
    expect(mongoose.get('autoCreate')).toBe(false); expect(mongoose.get('autoIndex')).toBe(false)
    const foreign = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { dbName: 'test' })
    expect(() => foreign.db('test').collection('runtime_instances').find({})).toThrow('RECEIPT_QA_NAMESPACE_OR_OPERATION_REFUSED')
    // Mongoose.connect removes dbName before constructing its MongoClient. Keep
    // the exact target visible to the preconnection fence using supported setClient.
    const client = new mongoose.mongo.MongoClient(env.mongoUri, { dbName: database, maxPoolSize: 6, serverSelectionTimeoutMS: 10000 })
    expect(client.options.dbName).toBe(database)
    await client.connect(); mongoose.connection.setClient(client)
    expect(mongoose.connection.name).toBe(database)
    Execution = mongoose.model('RenditionReceiptQaExecution', BaseExecution.schema.clone(), 'ss055_qa_rendition_executions')
    Audit = mongoose.model('RenditionReceiptQaAudit', BaseAudit.schema.clone(), 'ss055_qa_rendition_audits')
    await Execution.createCollection(); await Execution.createIndexes(); await Audit.createCollection()
  })
  beforeEach(async () => {
    f = docxVisualReviewFixture()
    f.plan.planId = `receipt-test-${randomUUID()}`; f.source.source.plan.planId = f.plan.planId
    resealVisualReviewFixture(f)
    transport = await f.transport(); binding = buildOpenAiDocxRenditionReviewRequest(transport).binding
    const auditService = { log: jest.fn((data, options) => Audit.createLog(data, { session: options.session })) }
    claimArgs = { ...f.args, deps: { Execution, Audit, prepareAdmission: f.admission, auditService } }
    const admitted = await claimGovernedRenditionReview(claimArgs); ids.add(admitted.claim.executionId)
    deps = { Execution, Audit, prepareTransport: jest.fn(f.transport),
      readClaim: jest.fn(() => readGovernedRenditionReviewClaim(claimArgs)), auditService }
    args = { ...f.args, binding, deps }
    saved = await reserve(args); ids.add(saved.reservation.executionId)
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    evidence.push({ name: expect.getState().currentTestName, ...(Execution && Audit ? await snapshot() : { startupUnproved: true }) })
    writeFileSync(process.env.VMF_RESPONSE_RECEIPT_EVIDENCE, JSON.stringify({ database,
      boundary: 'Retained two QA collections, real transaction/index/signature; generic source/auth and fake provider, not full default orchestration', evidence }, null, 2))
  })
  afterAll(async () => { await mongoose.disconnect() })
  const identity = (extra = {}) => ({ ...binding, responseId: 'resp_receipt_test', postRequestId: 'req_receipt_test', ...extra })
  const ack = () => saved.consumeAcknowledgement(binding)
  const receipt = () => Audit.findById(renditionReceiptId('RESPONSE', saved.reservation.executionId)).lean()
  const oldArgs = extra => ({ ...args, reservationExecutionId: saved.reservation.executionId, ...identity(), ...extra })

  test('fresh capability records signed receipt without repeating source readers and is absent on replay/JSON', async () => {
    expect(JSON.stringify(saved)).not.toContain('recordResponseIdentity')
    expect((await reserve(args)).recordResponseIdentity).toBeUndefined()
    const reads = [deps.prepareTransport.mock.calls.length, deps.readClaim.mock.calls.length]
    ack()
    await expect(saved.recordResponseIdentity(identity())).resolves.toMatchObject({ state: 'DURABLE_RESPONSE_ID_RECORDED', ...binding })
    expect([deps.prepareTransport.mock.calls.length, deps.readClaim.mock.calls.length]).toEqual(reads)
    expect(Audit.hydrate(await receipt()).verifySignature()).toBe(true)
    await expect(saved.recordResponseIdentity(identity())).rejects.toMatchObject({ details: { reason: 'RESPONSE_CAPABILITY_CONSUMED' } })
  })
  test('receipt before acknowledgement consumes response authority without writing', async () => {
    await expect(saved.recordResponseIdentity(identity())).rejects.toMatchObject({ details: { reason: 'RESPONSE_DISPATCH_UNACKNOWLEDGED' } })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow()
    expect(await receipt()).toBeNull()
  })
  test('bad acknowledgement cannot unlock response recording', async () => {
    expect(() => saved.consumeAcknowledgement({ ...binding, requestIdentity: 'f'.repeat(64) })).toThrow()
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow(); expect(await receipt()).toBeNull()
  })
  test.each(['requestIdentity', 'subjectFingerprint', 'contextFingerprint', 'extra'])('rejects changed or extra callback field %s and holds capability', async key => {
    ack(); await expect(saved.recordResponseIdentity(identity({ [key]: 'f'.repeat(64) }))).rejects.toThrow()
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow(); expect(await receipt()).toBeNull()
  })
  test('invalid provider identity consumes authority and stores no receipt', async () => {
    ack(); await expect(saved.recordResponseIdentity(identity({ responseId: 'invalid' }))).rejects.toThrow()
    expect(await receipt()).toBeNull()
  })
  test('mutable returned reservation and caller args cannot redirect captured ownership', async () => {
    const originalExecutionId = saved.reservation.executionId
    saved.reservation.executionId = `grr_rendition_dispatch_${randomUUID()}`
    saved.reservation.claimFingerprint = 'f'.repeat(64); args.actorUserId = new mongoose.Types.ObjectId().toString()
    args.binding = { ...binding, requestIdentity: 'f'.repeat(64) }
    expect(ack().reservationExecutionId).toBe(originalExecutionId)
    await expect(saved.recordResponseIdentity(identity())).resolves.toMatchObject({ state: 'DURABLE_RESPONSE_ID_RECORDED' })
    expect(Audit.hydrate(await Audit.findById(renditionReceiptId('RESPONSE', originalExecutionId)).lean()).verifySignature()).toBe(true)
  })
  test('concurrent capability use records only the first identity', async () => {
    ack(); const results = await Promise.allSettled([saved.recordResponseIdentity(identity()), saved.recordResponseIdentity(identity({ responseId: 'resp_other' }))])
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected'])
    expect((await receipt()).diff.responseId).toBe('resp_receipt_test')
  })
  test.each(['claim', 'reservation', 'claimAudit', 'reservationAudit'])('corrupt signed %s rejects and preserves failure', async kind => {
    const row = await Execution.findOne({ idempotencyKey: kind.startsWith('claim') ? renditionClaimKey(f.plan.planId) : `DOCX_RENDITION_REVIEW_DISPATCH:${f.plan.planId}` }).lean()
    if (kind.endsWith('Audit')) await Audit.collection.updateOne({ _id: row.executionEvidence.renditionReview.auditId }, { $set: { signature: 'corrupt-qa-fixture' } })
    else await Execution.collection.updateOne({ _id: row._id }, { $set: { requestFingerprint: 'f'.repeat(64) } })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow(); expect(await receipt()).toBeNull()
  })
  test('same durable response converges without duplicate audit', async () => {
    await identify(oldArgs()); ack()
    await expect(saved.recordResponseIdentity(identity())).resolves.toMatchObject({ state: 'DURABLE_RESPONSE_ID_RECORDED' })
    expect(await Audit.countDocuments({ _id: renditionReceiptId('RESPONSE', saved.reservation.executionId) })).toBe(1)
  })
  test('conflicting durable response remains unchanged', async () => {
    await identify(oldArgs({ responseId: 'resp_existing' })); ack()
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow(); expect((await receipt()).diff.responseId).toBe('resp_existing')
  })
  test('known uncertainty conflicts through shared response slot', async () => {
    await uncertain({ ...oldArgs(), uncertainty: { reason: 'PROVIDER_TIMEOUT', outcome: 'KNOWN_RESPONSE_UNRESOLVED', responseId: 'resp_known', postRequestId: 'req_receipt_test' } })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow(); expect((await receipt()).diff.responseId).toBe('resp_known')
  })
  test('foreign deterministic occupant remains signed and unchanged', async () => {
    const _id = new mongoose.Types.ObjectId(renditionReceiptId('RESPONSE', saved.reservation.executionId))
    await Audit.createLog({ _id, actorUserId: f.actorUserId, action: 'UNRELATED_AUDIT', resourceType: 'GovernedReasoningExecution', resourceId: new mongoose.Types.ObjectId(), scope: f.scope, diff: { qa: true } })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow()
    expect((await receipt()).action).toBe('UNRELATED_AUDIT')
  })
  test('audit write failure rolls back; post-write error also rolls back', async () => {
    deps.auditService.log.mockImplementationOnce(async (data, options) => { await Audit.createLog(data, { session: options.session }); throw Error('QA_AFTER_WRITE') })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow('QA_AFTER_WRITE')
    expect(await receipt()).toBeNull()
  })
  test('required signer failure creates no receipt and grants no retry', async () => {
    deps.auditService.log.mockRejectedValueOnce(Error('QA_SIGNER_FAILED')); ack()
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow('QA_SIGNER_FAILED'); expect(await receipt()).toBeNull()
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow()
  })
  test('public competing response race and fresh callback leave one immutable identity', async () => {
    ack(); const results = await Promise.allSettled([saved.recordResponseIdentity(identity()), identify(oldArgs({ responseId: 'resp_competitor' }))])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(['resp_receipt_test', 'resp_competitor']).toContain((await receipt()).diff.responseId)
  })
  test('lost postcommit readback stays held but leaves durable identity for read-only recovery', async () => {
    const original = Audit.findOne.bind(Audit)
    jest.spyOn(Audit, 'findOne').mockImplementation(filter => {
      const query = original(filter), set = query.setOptions.bind(query)
      query.setOptions = options => { set(options); if (options.timeoutMS) query.lean = jest.fn().mockRejectedValue(Error('QA_DURABLE_READ_LOST')); return query }
      return query
    })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow('QA_DURABLE_READ_LOST')
    jest.restoreAllMocks(); expect((await receipt()).diff.responseId).toBe('resp_receipt_test')
    await expect(saved.recordResponseIdentity(identity())).rejects.toThrow()
  })
  test('transaction uses installed driver timeout and session; unknown commit remains held', async () => {
    const original = Execution.db.startSession.bind(Execution.db)
    jest.spyOn(Execution.db, 'startSession').mockImplementation(async () => {
      const session = await original(), transact = session.withTransaction.bind(session)
      session.withTransaction = async (fn, options) => {
        expect(options.timeoutMS).toBeGreaterThan(0); expect(options.timeoutMS).toBeLessThanOrEqual(50000)
        await transact(fn, options); throw Object.assign(Error('QA_UNKNOWN_COMMIT'), { errorLabels: ['UnknownTransactionCommitResult'] })
      }; return session
    })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toThrow('QA_UNKNOWN_COMMIT')
    expect((await receipt()).diff.responseId).toBe('resp_receipt_test')
  })
  test('expired durable callback rolls back rather than acknowledging a late write; fake clock only', async () => {
    const clock = Date.now(), spy = jest.spyOn(Date, 'now').mockReturnValue(clock)
    deps.auditService.log.mockImplementationOnce(async (data, options) => {
      const row = await Audit.createLog(data, { session: options.session }); spy.mockReturnValue(clock + 60001); return row
    })
    ack(); await expect(saved.recordResponseIdentity(identity())).rejects.toMatchObject({ details: { reason: 'RESPONSE_RECEIPT_TIMEOUT' } })
    spy.mockRestore(); expect(await receipt()).toBeNull()
  })
  test('actual durable callback between one fake POST and GET completes without reassembly', async () => {
    const response = body => ({ ok: true, headers: { get: () => 'req_receipt_test' }, text: async () => JSON.stringify(body) })
    const fetchImpl = jest.fn(async (_url, options) => response(options.method === 'POST' ? { id: 'resp_receipt_test', status: 'queued' }
      : { id: 'resp_receipt_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput()) }] }] }))
    const reads = deps.prepareTransport.mock.calls.length
    const adapter = createOpenAiDocxRenditionReviewProviderAdapter({ apiKey: 'fake-qa-key', fetchImpl, sleep: async () => {},
      reserveDispatch: async value => saved.consumeAcknowledgement(value), recordResponseIdentity: value => saved.recordResponseIdentity(value) })
    await expect(adapter(transport)).resolves.toMatchObject({ output: { overallStatus: 'PASS' } })
    expect(fetchImpl.mock.calls.map(row => row[1].method)).toEqual(['POST', 'GET'])
    expect(deps.prepareTransport.mock.calls.length).toBe(reads)
    expect((await receipt()).action).toBe(RENDITION_RESPONSE_ACTION)
  })
  test('failed real callback stops GET and adapter cannot POST again', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, headers: { get: () => '' }, text: async () => JSON.stringify({ id: 'resp_receipt_test', status: 'queued' }) }))
    deps.auditService.log.mockRejectedValueOnce(Error('QA_SIGNER_FAILED'))
    const adapter = createOpenAiDocxRenditionReviewProviderAdapter({ apiKey: 'fake-qa-key', fetchImpl,
      reserveDispatch: async value => saved.consumeAcknowledgement(value), recordResponseIdentity: value => saved.recordResponseIdentity(value) })
    await expect(adapter(transport)).rejects.toMatchObject({ details: { reason: 'REQUIRED_DURABLE_CALLBACK_FAILED', responseId: 'resp_receipt_test' } })
    await expect(adapter(transport)).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await receipt()).toBeNull()
  })
})
