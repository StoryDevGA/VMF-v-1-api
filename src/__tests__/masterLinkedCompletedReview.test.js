import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Audit from '../models/AuditLog.js'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { masterLinkedCompletedReviewFixture } from './fixtures/masterLinkedCompletedReviewFixture.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { createNetworkQaMasterLinkedReviewAuthority } from '../services/masterLinkedGenuineReviewAuthorityService.js'
import { createFakeNetworkMasterLinkedDocxReviewProviderAdapter } from '../services/openAiMasterLinkedDocxReviewProviderAdapter.js'
import { createNetworkQaMasterLinkedCompletedReviewStore, createGenuineMasterLinkedCompletedReviewStore } from '../services/masterLinkedCompletedReviewService.js'
import { assertCompletedReviewResult, assertCompletedReviewArtifact, assertCompletedReviewStage, COMPLETED_REVIEW_ACTIONS, COMPLETED_REVIEW_VERSION,
  hasCompletedReviewIdentity, hasCompletedArtifactIdentity, hasCompletedStageIdentity, assertCompletedReviewAudit, completedReviewFamily } from '../services/masterLinkedCompletedReviewContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { originalOutcomeQualityStageFilter, MASTER_LINKED_REVIEW_STAGE_VERSION, MASTER_LINKED_REVIEW_STAGE_KEYS } from '../utils/outcomeQualityStageSubjects.js'
import { completedReviewRecoveryCases } from './fixtures/completedReviewRecoveryFixture.js'

const clone = value => JSON.parse(JSON.stringify(value))
const offlineClient = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { serverSelectionTimeoutMS: 1 })
const collection = offlineClient.db('ss044_1619d7db635949898c9abb4592d10bcf').collection('governed_reasoning_executions')
const connect = jest.spyOn(offlineClient, 'connect').mockRejectedValue(new Error('NETWORK_FORBIDDEN'))
afterAll(async () => { expect(connect).not.toHaveBeenCalled(); expect(offlineClient.topology).toBeUndefined(); await offlineClient.close() })
const setup = async (failed = false) => {
  const f = await masterLinkedCompletedReviewFixture(), executions = [], artifacts = [], stages = [], audits = [], all = [executions, artifacts, stages, audits]
  const trace = { queries: [], transactionBudgets: [], auditFault: '', recordFault: '', unknownCommit: false, readsFail: false, sourceReads: 0, failAfterCommit: false, prepares: 0 }
  // Array rollback remains a unit seam. Real driver sessions validate options
  // without iterating any cursor or connecting to a server.
  const db = { startSession: async () => {
    const session = offlineClient.startSession(), run = session.withTransaction.bind(session)
    session.withTransaction = async (fn, options) => {
      trace.transactionBudgets.push(options.timeoutMS)
      const before = all.map(rows => [...rows])
      const result = await run(async () => {
        try { return await fn() } catch (e) { all.forEach((rows, index) => rows.splice(0, rows.length, ...before[index])); throw e }
      }, options)
      if (trace.unknownCommit) { trace.unknownCommit = false; throw Object.assign(new Error('UNKNOWN_COMMIT'), { hasErrorLabel: label => label === 'UnknownTransactionCommitResult' }) }
      if (trace.failAfterCommit) { trace.failAfterCommit = false; trace.readsFail = true }
      return result
    }
    return session
  } }
  const indexes = {
    execution: [{ name: 'executionId_1', key: { executionId: 1 }, unique: true }, { name: 'runtimeInstanceId_1_idempotencyKey_1', key: { runtimeInstanceId: 1, idempotencyKey: 1 }, unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } }],
    artifact: [{ name: 'runtimeArtifactId_1', key: { runtimeArtifactId: 1 }, unique: true }], stage: [
      { name: 'uniq_outcome_quality_stage_execution_id', key: { stageExecutionId: 1 }, unique: true },
      { name: 'uniq_outcome_quality_stage_attempt', key: { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 }, unique: true }],
    audit: [{ name: '_id_', key: { _id: 1 } }],
  }
  const model = (rows, kind, Model) => ({ db, prototype: Audit.prototype, collection: { indexes: async () => indexes[kind] },
    findOne: filter => { const options = {}, q = { setOptions: values => { Object.assign(options, values); return q }, session: value => { options.session = value; return q }, lean: async () => {
      const cursor = collection.find(filter, options); await cursor.close(); trace.queries.push({ transaction: options.session?.inTransaction() === true, timeoutMS: options.timeoutMS })
      if (trace.readsFail && kind === 'execution' && String(filter.idempotencyKey || '').startsWith('MASTER_LINKED_DOCX_REVIEW_RESULT:')) throw Error('READ_UNAVAILABLE')
      return rows.find(row => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v)))
    } }; return q }, create: async values => {
      if (trace.recordFault === kind) throw Error('RECORD_UNAVAILABLE')
      for (const value of values) { await new Model(value).validate(); rows.push(value) } return values
    } })
  const models = { Execution: model(executions, 'execution', Execution), Artifact: model(artifacts, 'artifact', Artifact),
    Stage: model(stages, 'stage', Stage), Audit: model(audits, 'audit') }
  const writer = { log: jest.fn(async data => {
    if (trace.auditFault && data.action === COMPLETED_REVIEW_ACTIONS[trace.auditFault]) throw Error('AUDIT_UNAVAILABLE')
    const row = new Audit(data); row.generateSignature(); const value = row.toObject(); audits.push(value); return value
  }) }
  const authority = createNetworkQaMasterLinkedReviewAuthority({ ...f.authorityDeps, ...models, auditService: writer,
    prepareTransport: async value => { trace.prepares++; return f.authorityDeps.prepareTransport(value) } })
  const grant = await authority.prepare(f.args)
  const fetch = jest.fn(async () => new Response(JSON.stringify({ id: 'resp_g2_unit', model: 'gpt-5.2', status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput(failed)) }] }] }), { headers: { 'x-request-id': 'req_g2_unit' } }))
  const result = await createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: fetch })(grant.capability)
  const deps = { ...models, ...f.storageSourceDeps, readAuthority: authority.read, auditService: writer,
    readSourceRecords: async () => { trace.sourceReads++; return f.sources } }
  const store = createNetworkQaMasterLinkedCompletedReviewStore(deps), args = { actorUserId: f.actorUserId, scopes: f.args.scopes, providerResult: result },
    readArgs = { actorUserId: f.actorUserId, scopes: f.args.scopes, grantExecutionId: grant.grant.body.executionId }
  return { ...f, models, indexes, executions, artifacts, stages, audits, trace, deps, store, args, readArgs, grant, result, fetch, writer,
    count: () => all.map(rows => rows.length), changeSource: () => { f.sources.candidate.fileBytes = Buffer.from('Changed source') } }
}

completedReviewRecoveryCases('legacy completed-review recovery', setup, () => offlineClient.startSession())

test.each([false, true])('stores exact owned review with failed=%s and all signed joins; no approval', async failed => {
  const f = await setup(failed), before = f.count(), saved = await f.store.persist(f.args)
  expect(saved).toMatchObject({ state: 'COMPLETED_REVIEW_STORED', reviewStatus: failed ? 'FAIL' : 'PASS', mode: 'NETWORK_SIMULATED',
    completionPersisted: true, genuineReviewUsed: false, approvalAvailable: false, finalisationAvailable: false })
  expect(f.count()).toEqual([before[0] + 1, 1, 1, before[3] + 3]); expect(f.fetch).toHaveBeenCalledTimes(1)
  assertCompletedReviewResult(f.executions.at(-1)); assertCompletedReviewArtifact(f.artifacts[0]); assertCompletedReviewStage(f.stages[0])
  expect(f.stages[0].stageKey).toBe('MASTER_LINKED_RENDITION_RL_QA'); expect(f.stages[0].attemptNumber).toBe(1)
  expect((await f.store.read(f.readArgs)).findings).toEqual(saved.findings)
  expect((await f.store.persist(f.args)).idempotent).toBe(true)
  expect(f.count()).toEqual([before[0] + 1, 1, 1, before[3] + 3])
  expect(f.trace.queries.filter(q => q.transaction).every(q => q.timeoutMS === undefined)).toBe(true)
  expect(f.trace.transactionBudgets.at(-1)).toBeLessThanOrEqual(50000)
})
test('default source queries include private byte fields while ordinary queries keep them hidden', async () => {
  const f = await setup(), queries = [], spies = []
  // Real ODM projection, with driver reads stubbed: no Mongo persistence or
  // native source admission is claimed by these locally signed fixture rows.
  const sourceModels = { Master, Candidate, Preview, Plan }
  try {
    for (const [name, Model] of Object.entries(sourceModels)) {
      const source = f.sources[name.toLowerCase()]
      spies.push(jest.spyOn(Model.collection, 'findOne').mockImplementation(async (filter, options) => {
        expect(Object.entries(filter).every(([key, value]) => String(source[key]) === String(value))).toBe(true)
        const row = mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize(source), { promoteBuffers: true })
        queries.push({ name, projection: options.projection })
        for (const [key, included] of Object.entries(options.projection || {})) if (included === 0) delete row[key]
        return row
      }))
    }
    expect(Candidate.schema.path('fileBytes').options.select).toBe(false)
    expect(Preview.schema.path('pageBytes').options.select).toBe(false)
    expect((await Candidate.findOne({ _id: f.sources.candidate._id }).lean()).fileBytes).toBeUndefined()
    expect((await Preview.findOne({ _id: f.sources.preview._id }).lean()).pageBytes).toBeUndefined()
    queries.length = 0
    f.audits.push(...Object.values(f.sources.audits))
    const deps = { ...f.deps, ...sourceModels }
    delete deps.readSourceRecords
    const store = createNetworkQaMasterLinkedCompletedReviewStore(deps)
    const saved = await store.persist(f.args)
    expect(saved).toMatchObject({ completionConfirmed: true, sourceProof: 'STORED_SOURCE_RECORDS', approvalAvailable: false })
    expect((await store.read(f.readArgs)).findings).toEqual(saved.findings)
    for (const [name, field] of [['Candidate', 'fileBytes'], ['Preview', 'pageBytes']]) {
      const reads = queries.filter(query => query.name === name)
      expect(reads.length).toBeGreaterThan(1)
      expect(reads.every(query => query.projection?.[field] !== 0)).toBe(true)
    }
    expect(f.fetch).toHaveBeenCalledTimes(1)
  } finally { spies.forEach(spy => spy.mockRestore()) }
})

test('does not accept JSON copies, forged material or caller mutation', async () => {
  const f = await setup(), before = f.count()
  await expect(f.store.persist({ ...f.args, providerResult: clone(f.result) })).rejects.toThrow()
  await expect(f.store.persist({ ...f.args, providerResult: { output: visualReviewOutput(), receipt: {} } })).rejects.toThrow()
  f.result.output.findings[0].finding = 'Changed'; await expect(f.store.persist(f.args)).rejects.toThrow(); expect(f.count()).toEqual(before)
})
test('genuine storage constructor cannot accept seams or turn a fake result into genuine', async () => {
  const f = await setup()
  expect(() => createGenuineMasterLinkedCompletedReviewStore({})).toThrow()
  await expect(createGenuineMasterLinkedCompletedReviewStore().persist({ actorUserId: 'wrong', providerResult: f.result }))
    .rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
})
test.each(['result', 'artifact', 'stage'])('required %s audit failure rolls back unit seam', async kind => {
  const f = await setup(), before = f.count(); f.trace.auditFault = kind
  await expect(f.store.persist(f.args)).rejects.toThrow(); expect(f.count()).toEqual(before)
  f.trace.auditFault = ''; expect((await f.store.persist(f.args)).completionConfirmed).toBe(true); expect(f.fetch).toHaveBeenCalledTimes(1)
})
test.each(['execution', 'artifact', 'stage'])('required %s record failure rolls back all earlier unit writes', async kind => {
  const f = await setup(), before = f.count(); f.trace.recordFault = kind
  await expect(f.store.persist(f.args)).rejects.toThrow(); expect(f.count()).toEqual(before)
  f.trace.recordFault = ''; expect((await f.store.persist(f.args)).completionConfirmed).toBe(true)
})
test.each(['actor', 'permission', 'response', 'source', 'master-audit', 'candidate-audit', 'preview-audit', 'plan', 'index'])('rejects changed %s before completed writes', async kind => {
  const f = await setup(), before = f.count()
  if (kind === 'actor') f.args.actorUserId = 'f'.repeat(24)
  if (kind === 'permission') f.deps.readAuthority = async () => { throw Error('DENIED') }
  if (kind === 'response') f.audits.find(row => row.action === 'MASTER_DOCX_RESPONSE_RECORDED').diff.payload.responseId = 'resp_changed'
  if (kind === 'source') f.sources.candidate.fileBytes = Buffer.from('changed')
  if (kind.endsWith('-audit')) f.sources.audits[kind.split('-')[0]].signature = 'changed'
  if (kind === 'plan') f.sources.plan.planFingerprint = 'f'.repeat(64)
  if (kind === 'index') f.indexes.stage[1].unique = false
  const store = createNetworkQaMasterLinkedCompletedReviewStore(f.deps)
  await expect(store.persist(f.args)).rejects.toThrow(); expect(f.count()).toEqual(before)
})
test('late hold preserves the completed failure but never provides finalisation', async () => {
  const f = await setup(true), authority = createNetworkQaMasterLinkedReviewAuthority({ ...f.authorityDeps, ...f.models, auditService: f.writer })
  await authority.revoke(f.readArgs)
  const result = await f.store.persist(f.args)
  expect(result.reviewStatus).toBe('FAIL'); expect(result.finalisationAvailable).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1)
})
test('unknown commit returns unconfirmed and read reconciles the actual complete unit bundle', async () => {
  const f = await setup(); f.trace.unknownCommit = true
  await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_UNCONFIRMED' } })
  expect((await f.store.reconcile(f.readArgs)).completionConfirmed).toBe(true)
  expect((await f.store.persist(f.args)).idempotent).toBe(true); expect(f.fetch).toHaveBeenCalledTimes(1)
})
test.each(['artifact', 'stage', 'audit'])('partial or corrupt %s cannot be read as complete or repaired by replay', async kind => {
  const f = await setup(); await f.store.persist(f.args)
  if (kind === 'artifact') f.artifacts.length = 0
  if (kind === 'stage') f.stages[0].attemptFingerprint = 'f'.repeat(64)
  if (kind === 'audit') f.audits.at(-1).signature = 'bad'
  await expect(f.store.read(f.readArgs)).rejects.toThrow(); await expect(f.store.persist(f.args)).rejects.toThrow()
})
test('all three models reject malformed new discriminators after validation', async () => {
  const f = await setup(); await f.store.persist(f.args)
  const tuples = [[Execution, f.executions.at(-1), hasCompletedReviewIdentity, 'executionEvidence'],
    [Artifact, f.artifacts[0], hasCompletedArtifactIdentity, 'lineageSummary'], [Stage, f.stages[0], hasCompletedStageIdentity, 'renditionInputSnapshot']]
  for (const [Model, row, detect, key] of tuples) {
    expect(detect(row)).toBe(true)
    const changed = clone(row); changed[key] = {}; await expect(new Model(changed).validate()).rejects.toThrow()
  }
})
test('shared original-stage selector preserves scope and excludes only the declared exact scalar pairs', () => {
  const scope = { runtimeInstanceId: 'f'.repeat(24), planId: 'test-plan' }, filter = originalOutcomeQualityStageFilter(scope)
  expect(filter.$and[0]).toEqual(scope)
  expect(filter.$and[1].$nor).toHaveLength(9)
  expect(filter.$and[1].$nor).toContainEqual({ $expr: { $and: [
    { $eq: ['$contractVersion', MASTER_LINKED_REVIEW_STAGE_VERSION] }, { $eq: ['$stageKey', MASTER_LINKED_REVIEW_STAGE_KEYS.NETWORK_SIMULATED] },
  ] } })
  expect(filter.$and[1].$nor.every(x => x.$expr.$and.length === 2)).toBe(true)
  expect(COMPLETED_REVIEW_VERSION).not.toBe(MASTER_LINKED_REVIEW_STAGE_VERSION)
})
test('stage native identity must belong to the deterministic family', async () => {
  const f = await setup(); await f.store.persist(f.args)
  const changed = { ...f.stages[0], _id: new mongoose.Types.ObjectId() }
  expect(() => assertCompletedReviewStage(changed)).toThrow()
  await expect(new Stage(changed).validate()).rejects.toThrow()
})
test('artifact contract rejects noncanonical findings even if they normalize to the same output', async () => {
  const f = await setup(); await f.store.persist(f.args)
  const changed = clone(f.artifacts[0]); changed.generatedOutput.findings[0].finding += ' '
  expect(() => assertCompletedReviewArtifact(changed)).toThrow()
  await expect(new Artifact(changed).validate()).rejects.toThrow()
})
test.each(['array-scope', 'extra-scope'])('valid signature cannot conceal %s in a completed audit', async kind => {
  const f = await setup(); await f.store.persist(f.args)
  const result = f.executions.at(-1), input = result.executionEvidence.masterLinkedCompletedReview.body.input
  const audit = clone(f.audits.find(row => row.action === COMPLETED_REVIEW_ACTIONS.result))
  if (kind === 'array-scope') audit.scope.runtimeInstanceId = [audit.scope.runtimeInstanceId]
  else audit.scope.unexpected = false
  Audit.prototype.generateSignature.call(audit)
  expect(Audit.prototype.verifySignature.call(audit)).toBe(true)
  expect(() => assertCompletedReviewAudit('result', result, audit, input, a => Audit.prototype.verifySignature.call(a))).toThrow()
})
test('plan payload integrity is checked again inside the transaction despite unchanged descriptor hashes', async () => {
  const f = await setup(), before = f.count(), initial = membershipHash(f.sources.plan.payload); let reads = 0, checks = 0
  const store = createNetworkQaMasterLinkedCompletedReviewStore({ ...f.deps,
    readSourceRecords: async () => { if (++reads === 2) f.sources.plan.payload.changed = true; return f.sources },
    assertPlanIntegrity: plan => { checks++; if (membershipHash(plan.payload) !== initial) throw Error('PLAN_PAYLOAD_CHANGED') } })
  await expect(store.persist(f.args)).rejects.toThrow('PLAN_PAYLOAD_CHANGED')
  expect(checks).toBe(2); expect(f.count()).toEqual(before)
})
test('plan checker also runs during durable read-back', async () => {
  const f = await setup(), check = jest.fn(f.deps.assertPlanIntegrity), store = createNetworkQaMasterLinkedCompletedReviewStore({ ...f.deps, assertPlanIntegrity: check })
  await store.persist(f.args); expect(check.mock.calls.length).toBeGreaterThanOrEqual(4)
})
test('foreign duplicate-key errors are not accepted as matching bundle reconciliation', async () => {
  const f = await setup(), before = f.count(), failure = Object.assign(new Error('unrelated_index'), { code: 11000, keyPattern: { other: 1 }, keyValue: { other: 1 } })
  f.models.Execution.create = async () => { throw failure }
  await expect(f.store.persist(f.args)).rejects.toBe(failure); expect(f.count()).toEqual(before)
})
test('foreign index names with the same recognised pattern and value cannot masquerade as the owned index', async () => {
  const f = await setup(), executionId = completedReviewFamily(f.grant.grant.body.onceRoot).result.executionId, before = f.count()
  const failure = Object.assign(new Error('E11000 duplicate key error collection: fixture index: foreign_executionId_1_shadow dup key: {}'),
    { code: 11000, keyPattern: { executionId: 1 }, keyValue: { executionId } })
  f.models.Execution.create = async () => { throw failure }
  await expect(f.store.persist(f.args)).rejects.toBe(failure); expect(f.count()).toEqual(before)
})
test('an exact owned index collision without the matching complete result holds its occupied slot', async () => {
  const f = await setup(), executionId = completedReviewFamily(f.grant.grant.body.onceRoot).result.executionId, before = f.count()
  const failure = Object.assign(new Error('E11000 duplicate key error collection: fixture index: executionId_1 dup key: {}'),
    { code: 11000, keyPattern: { executionId: 1 }, keyValue: { executionId } })
  f.models.Execution.create = async () => { throw failure }
  await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_SLOT_CONFLICT' } }); expect(f.count()).toEqual(before)
})
test('lost durable acknowledgement is unconfirmed and read-only reconciliation finds the complete bundle', async () => {
  const f = await setup(); f.trace.failAfterCommit = true
  await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_UNCONFIRMED' } })
  f.trace.readsFail = false
  expect((await f.store.reconcile(f.readArgs)).completionConfirmed).toBe(true); expect(f.fetch).toHaveBeenCalledTimes(1)
})
test('owned findings are frozen before awaited authority checks and source preparation is never repeated', async () => {
  const f = await setup(), original = clone(f.result.output), readAuthority = f.deps.readAuthority
  const store = createNetworkQaMasterLinkedCompletedReviewStore({ ...f.deps, readAuthority: async args => {
    f.result.output.findings[0].finding = 'Caller changed while awaiting'; return readAuthority(args)
  } })
  expect((await store.persist(f.args)).findings).toEqual(original)
  expect(f.trace.prepares).toBe(2); expect(f.fetch).toHaveBeenCalledTimes(1)
})
test('source audit drift after pending writes aborts the whole unit transaction', async () => {
  const f = await setup(), before = f.count(), log = f.writer.log.getMockImplementation()
  f.writer.log.mockImplementation(async data => {
    const row = await log(data)
    if (data.action === COMPLETED_REVIEW_ACTIONS.result) f.sources.audits.master.signature = 'changed after await'
    return row
  })
  await expect(f.store.persist(f.args)).rejects.toThrow(); expect(f.count()).toEqual(before)
})

describe('actual ODM guards for new completed-review identities before driver writes', () => {
  let tuples
  beforeAll(async () => {
    const f = await setup(); await f.store.persist(f.args)
    tuples = [[Execution, f.executions.at(-1), 'executionEvidence'], [Artifact, f.artifacts[0], 'lineageSummary'], [Stage, f.stages[0], 'renditionInputSnapshot']]
  })
  const guarded = async (Model, row, callback, stored = true) => {
    const writes = {}
    for (const name of ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
      'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite']) {
      writes[name] = jest.spyOn(Model.collection, name).mockResolvedValue({ acknowledged: true, matchedCount: 0, modifiedCount: 0, deletedCount: 0, insertedCount: 0 })
    }
    const exists = jest.spyOn(Model, 'exists').mockImplementation(() => { const query = Promise.resolve(stored ? { _id: row._id } : null); query.session = () => query; return query })
    try { await callback(writes, exists) } finally { exists.mockRestore(); Object.values(writes).forEach(spy => spy.mockRestore()) }
  }
  test.each([0, 1, 2])('model%s rejects skipped-validation save, lean insertMany and bulk skipValidation', async index => {
    const [Model, row, marker] = tuples[index]
    await guarded(Model, row, async writes => {
      const corrupted = clone(row); corrupted[marker] = {}
      await expect(new Model(corrupted).save({ validateBeforeSave: false })).rejects.toThrow()
      await expect(Model.insertMany([clone(row)], { lean: true })).rejects.toThrow()
      await expect(Model.bulkWrite([{ insertOne: { document: clone(row) } }], { skipValidation: true })).rejects.toThrow()
      expect(Object.values(writes).every(spy => spy.mock.calls.length === 0)).toBe(true)
    }, false)
  })
  test.each([0, 1, 2])('model%s blocks existing rows across update/delete/replace/rename/pipeline and document paths', async index => {
    const [Model, row, marker] = tuples[index]
    await guarded(Model, row, async writes => {
      const filter = { _id: row._id }
      const attempts = [
        () => Model.updateOne(filter, { $set: { warnings: ['changed'] } }),
        () => Model.updateMany(filter, { $set: { warnings: ['changed'] } }),
        () => Model.findOneAndUpdate(filter, { $set: { warnings: ['changed'] } }),
        () => Model.replaceOne(filter, { ...clone(row), [marker]: {} }),
        () => Model.findOneAndReplace(filter, { ...clone(row), [marker]: {} }),
        () => Model.deleteOne(filter), () => Model.deleteMany(filter), () => Model.findOneAndDelete(filter),
        () => Model.updateOne(filter, { $rename: { [marker]: 'oldMarker' } }),
        () => Model.updateOne(filter, [{ $unset: [marker, 'contractVersion', 'status', 'outputTypeKey', 'idempotencyKey'] }]),
        () => Model.updateOne(filter, [{ $set: { [marker]: { $literal: {} } } }]),
        () => Model.updateOne(filter, [{ $replaceWith: '$$ROOT' }]),
        () => Model.hydrate(row).deleteOne(),
      ]
      for (const attempt of attempts) await expect(attempt()).rejects.toThrow()
      const document = Model.hydrate(row)
      Object.assign(document, { contractVersion: 'ordinary.v1', outputTypeKey: 'NORMAL', status: 'COMPLETED', executionId: 'ordinary-execution', idempotencyKey: '' })
      if (Model === Artifact) Object.assign(document, { artifactType: 'GOVERNED_REASONING_OUTPUT', runtimeArtifactId: 'ordinary-artifact' })
      document[marker] = {}
      await expect(document.save({ validateBeforeSave: false })).rejects.toThrow()
      expect(Object.values(writes).every(spy => spy.mock.calls.length === 0)).toBe(true)
    })
  })
  test.each([0, 1, 2])('model%s rejects new markers in upsert filters and proposed bulk mutations', async index => {
    const [Model, row, marker] = tuples[index]
    await guarded(Model, row, async writes => {
      await expect(Model.updateOne({ contractVersion: { $eq: row.contractVersion } }, { $set: { warnings: [] } }, { upsert: true })).rejects.toThrow()
      await expect(Model.bulkWrite([{ updateOne: { filter: { contractVersion: { $eq: row.contractVersion } }, update: { $set: { warnings: [] } }, upsert: true } }])).rejects.toThrow()
      // A generic container can be removed from ordinary rows under the atomic
      // exclusion. Target the new review marker itself for this rejection case.
      const protectedMarker = Model === Stage ? marker : `${marker}.masterLinkedCompletedReview`
      await expect(Model.bulkWrite([{ updateOne: { filter: {}, update: { $unset: { [protectedMarker]: '' } } } }])).rejects.toThrow()
      expect(Object.values(writes).every(spy => spy.mock.calls.length === 0)).toBe(true)
    }, false)
  })
  test.each([0, 1])('model%s ordinary update receives atomic stored-row exclusion after a negative existence read', async index => {
    const [Model, row] = tuples[index]
    await guarded(Model, row, async writes => {
      await Model.updateOne({ frameworkKey: 'VMF' }, { $set: { warnings: [] } })
      expect(writes.updateOne).toHaveBeenCalledTimes(1)
      const filter = writes.updateOne.mock.calls[0][0]
      expect(filter.$and[1].$nor).toBeDefined()
      expect(JSON.stringify(filter)).toContain(row.contractVersion)
      expect(JSON.stringify(filter)).toContain('masterLinkedCompletedReview')
    }, false)
  })
  test.each([0, 1, 2])('model%s ordinary bulk update receives atomic stored-row exclusion', async index => {
    const [Model, row] = tuples[index]
    await guarded(Model, row, async writes => {
      await Model.bulkWrite([{ updateOne: { filter: { runtimeInstanceKey: row.runtimeInstanceKey }, update: { $inc: { __v: 1 } } } }])
      expect(writes.bulkWrite).toHaveBeenCalledTimes(1)
      const filter = writes.bulkWrite.mock.calls[0][0][0].updateOne.filter
      expect(filter.$and[1].$nor).toBeDefined(); expect(JSON.stringify(filter)).toContain(row.contractVersion)
    }, false)
  })
})
