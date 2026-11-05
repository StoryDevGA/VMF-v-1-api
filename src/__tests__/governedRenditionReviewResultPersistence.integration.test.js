import { jest } from '@jest/globals'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Audit from '../models/AuditLog.js'
import { docxVisualReviewFixture } from './fixtures/docxVisualReviewFixture.js'
import { makeSimulatedOwnedReview } from './fixtures/renditionReviewResultFixture.js'
import { claimGovernedRenditionReview, readGovernedRenditionReviewClaim } from '../services/governedRenditionReviewClaimService.js'
import { reserveGovernedRenditionReviewDispatch, recordRenditionReviewResponseIdentity, readGovernedRenditionReviewDispatch } from '../services/governedRenditionReviewDispatchService.js'
import { persistGovernedRenditionReviewResult as persist, readGovernedRenditionReviewResult as read } from '../services/governedRenditionReviewResultService.js'
import { RENDITION_RESULT_ACTION, RENDITION_ARTIFACT_ACTION, RENDITION_STAGE_ACTION } from '../services/outcomeRenditionReviewResultContract.js'
import { RENDITION_RESULT_VERSION } from '../services/outcomeRenditionReviewClaimContract.js'

const database = process.env.VMF_RENDITION_RESULT_ISOLATED_DB
const run = database ? describe : describe.skip
run('atomic review result real isolated transactions; generic source/auth and fake provider', () => {
  jest.setTimeout(30000)
  let owned = false, evidencePath, f, args, deps, providerResult, transport
  const models = [Execution, Artifact, Stage, Audit], snapshots = []
  const collection = model => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database) || !models.includes(model)) throw new Error('Owned isolated collection required')
    return model.collection
  }
  const counts = async () => {
    const result = []
    for (const model of models) result.push(await collection(model).countDocuments({}))
    return result
  }
  const initialize = async (failed = false) => {
    f = docxVisualReviewFixture(); f.plan.planVersion = 1; transport = await f.transport()
    const realAudit = { log: (data, options) => Audit.createLog(data, { session: options.session }) }
    const claimArgs = { ...f.args, deps: { Execution, Audit, prepareAdmission: f.admission, auditService: realAudit } }
    await claimGovernedRenditionReview(claimArgs)
    const readClaim = input => readGovernedRenditionReviewClaim({ ...claimArgs, actorUserId: input.actorUserId,
      runtimeInstanceId: input.runtimeInstanceId, candidateId: input.candidateId })
    const dispatchArgs = { ...f.args, deps: { Execution, Audit, prepareTransport: f.transport, readClaim, auditService: realAudit } }
    let reservation
    providerResult = await makeSimulatedOwnedReview(transport, failed, {
      reserveDispatch: async binding => {
        reservation = await reserveGovernedRenditionReviewDispatch({ ...dispatchArgs, binding })
        return reservation.consumeAcknowledgement(binding)
      }, recordResponseIdentity: identity => recordRenditionReviewResponseIdentity({ ...dispatchArgs, ...identity,
        binding: Object.fromEntries(['requestIdentity', 'subjectFingerprint', 'contextFingerprint'].map(field => [field, identity[field]])),
        reservationExecutionId: reservation.reservation.executionId }),
    })
    deps = { Execution, Artifact, Stage, Audit, prepareTransport: f.transport, readClaim,
      readDispatch: input => readGovernedRenditionReviewDispatch({ ...dispatchArgs, binding: input.binding }),
      loadPlan: async () => f.plan, assertPlanIntegrity: () => {}, auditService: { log: jest.fn(realAudit.log) } }
    args = { ...f.args, deps, providerResult }
  }
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_RENDITION_RESULT_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 8, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    for (const model of models) { await model.createCollection(); await model.createIndexes() }
  })
  beforeEach(async () => { await initialize() })
  afterEach(async () => {
    jest.restoreAllMocks()
    if (!owned) return
    const rows = {}, indexes = {}
    for (const model of models) { rows[model.collection.name] = await collection(model).find({}).toArray(); indexes[model.collection.name] = await collection(model).indexes() }
    snapshots.push({ case: expect.getState().currentTestName, rows, indexes,
      auditSignaturesValid: rows[Audit.collection.name].map(row => Audit.hydrate(row).verifySignature()) })
    writeFileSync(evidencePath, JSON.stringify({ database,
      boundary: 'Real atomic stores/audits/immutable joins; source/auth/plan seams and fake provider, not native/genuine proof', snapshots }, null, 2))
    for (const model of models) await collection(model).deleteMany({})
  })
  afterAll(async () => { if (owned) expect(await counts()).toEqual([0, 0, 0, 0]); await mongoose.disconnect() })
  test('saves one result/artifact/stage and three signed audits, with read-only replay', async () => {
    expect(await counts()).toEqual([2, 0, 0, 3])
    const saved = await persist(args)
    expect(saved).toMatchObject({ state: 'REVIEW_COMPLETED', reviewStatus: 'PASS', completionConfirmed: true,
      approvalAvailable: false, deliveryAvailable: false, idempotent: false })
    expect(await counts()).toEqual([3, 1, 1, 6])
    expect((await persist(args)).idempotent).toBe(true)
    expect((await read({ ...args, providerResult: undefined })).executionId).toBe(saved.executionId)
    expect(await counts()).toEqual([3, 1, 1, 6])
    expect(saved.stage.startedAt).toBe('2026-10-28T19:10:00.000Z')
  })
  test('retains a completed FAIL with all findings and no approval', async () => {
    providerResult = await makeSimulatedOwnedReview(transport, true)
    const saved = await persist({ ...args, providerResult })
    expect(saved.reviewStatus).toBe('FAIL'); expect(saved.stage.status).toBe('FAILED')
    expect(saved.stage.outputSnapshot.findings).toHaveLength(7)
    expect(saved.stage.failure.retryable).toBe(false); expect(saved.approvalAvailable).toBe(false)
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test('fabricated/copied/mutated material fails before result writes', async () => {
    await expect(persist({ ...args, providerResult: JSON.parse(JSON.stringify(providerResult)) })).rejects.toThrow('adapter-owned')
    providerResult.output.findings[0].finding = 'Tampered'
    await expect(persist(args)).rejects.toThrow('adapter-owned')
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test.each([RENDITION_RESULT_ACTION, RENDITION_ARTIFACT_ACTION, RENDITION_STAGE_ACTION])('required audit %s failure rolls back every new row', async action => {
    const original = deps.auditService.log.getMockImplementation()
    deps.auditService.log.mockImplementation((data, options) => {
      if (data.action === action) throw new Error('Required isolated audit failure')
      return original(data, options)
    })
    await expect(persist(args)).rejects.toThrow('Required isolated audit failure')
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test.each(['Execution', 'Artifact', 'Stage'])('%s insertion failure rolls back records and required audits', async name => {
    const model = deps[name]
    jest.spyOn(model, 'create').mockImplementationOnce(async () => { throw new Error('Isolated record write failed') })
    await expect(persist(args)).rejects.toThrow('Isolated record write failed')
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test('matching concurrent callers commit one result and no duplicate artifacts/stages/audits', async () => {
    const saved = await Promise.all([persist(args), persist(args)])
    expect(new Set(saved.map(row => row.executionId)).size).toBe(1)
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test('conflicting adapter-owned findings cannot replace a committed result', async () => {
    await persist(args)
    // A second fake producer with simulated acknowledgements is an adversarial
    // fixture, not a second permitted native/provider submission.
    const conflicting = await makeSimulatedOwnedReview(transport, true)
    await expect(persist({ ...args, providerResult: conflicting })).rejects.toMatchObject({ details: { reason: 'RESULT_REPLAY_CONFLICT' } })
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test('post-commit lost readback remains unconfirmed and reconciles without result ownership', async () => {
    const original = Execution.findOne.bind(Execution); let outsideReads = 0
    const spy = jest.spyOn(Execution, 'findOne').mockImplementation(filter => {
      const query = original(filter), lean = query.lean.bind(query)
      query.lean = () => {
        if (filter.idempotencyKey?.startsWith('DOCX_RENDITION_REVIEW_RESULT:') && !query.getOptions().session && ++outsideReads === 2) {
          return Promise.reject(new Error('Lost committed readback'))
        }
        return lean()
      }
      return query
    })
    await expect(persist(args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_UNCONFIRMED', completionConfirmed: false } })
    spy.mockRestore()
    expect(await counts()).toEqual([3, 1, 1, 6])
    expect((await read({ ...args, providerResult: undefined })).completionConfirmed).toBe(true)
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test('transactional readback failure rolls back its records and audits', async () => {
    const original = Stage.findOne.bind(Stage); let failed = false
    jest.spyOn(Stage, 'findOne').mockImplementation(filter => {
      const query = original(filter), lean = query.lean.bind(query)
      query.lean = () => {
        if (filter.stageExecutionId && query.getOptions().session && !failed) { failed = true; return Promise.reject(new Error('Transactional stage read failed')) }
        return lean()
      }
      return query
    })
    await expect(persist(args)).rejects.toThrow('Transactional stage read failed')
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test('stored signed audit corruption blocks readback without rewriting history', async () => {
    await persist(args)
    const audit = await Audit.findOne({ action: RENDITION_STAGE_ACTION }).lean()
    await collection(Audit).updateOne({ _id: audit._id }, { $set: { 'diff.reviewStatus': 'FAIL' } })
    await expect(read(args)).rejects.toMatchObject({ details: { reason: 'SIGNED_RESULT_AUDIT' } })
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test('GRR result remains immutable after removal of its proposed reserved identity', async () => {
    const saved = await persist(args)
    await expect(Execution.updateOne({ executionId: saved.executionId }, { $set: { contractVersion: '1.0.0', status: 'COMPLETED',
      outputTypeKey: 'EXECUTIVE_BRIEF', idempotencyKey: 'ordinary' }, $unset: { executionEvidence: '' } })).rejects.toThrow()
    expect((await read(args)).executionId).toBe(saved.executionId)
    expect((await Execution.findOne({ executionId: saved.executionId }).lean()).contractVersion).toBe(RENDITION_RESULT_VERSION)
  })
  test('a missing signed response or foreign plan blocks all terminal writes', async () => {
    deps.loadPlan = async () => ({ ...f.plan, planId: 'foreign-plan' })
    await expect(persist(args)).rejects.toThrow()
    expect(await counts()).toEqual([2, 0, 0, 3])
    deps.loadPlan = async () => f.plan
    await collection(Audit).deleteOne({ action: 'GOVERNED_RENDITION_REVIEW_RESPONSE_IDENTIFIED' })
    await expect(persist(args)).rejects.toMatchObject({ details: { reason: 'SIGNED_DISPATCH_NOT_READY' } })
    expect(await counts()).toEqual([2, 0, 0, 2])
  })
  test('missing exact artifact index blocks writes; application does not recreate it', async () => {
    await collection(Artifact).dropIndex('runtimeArtifactId_1')
    try {
      await expect(persist(args)).rejects.toMatchObject({ details: { reason: 'RESULT_INDEX_NOT_READY' } })
      expect(await counts()).toEqual([2, 0, 0, 3])
      const indexes = await collection(Artifact).indexes()
      expect(indexes.some(index => index.name === 'runtimeArtifactId_1')).toBe(false)
      snapshots.push({ missingIndexProbe: indexes })
    } finally {
      await collection(Artifact).createIndex({ runtimeArtifactId: 1 }, { unique: true, name: 'runtimeArtifactId_1' })
    }
  })
  test('ignores caller timing and preserves adapter-owned completion times', async () => {
    const saved = await persist({ ...args, startedAt: '1970-01-01T00:00:00.000Z', completedAt: '1970-01-01T00:00:00.100Z' })
    expect(saved.stage.startedAt).toBe('2026-10-28T19:10:00.000Z')
    expect(saved.stage.completedAt).toBe('2026-10-28T19:10:00.012Z')
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])(
    'review artifact %s cannot mutate or remove its lineage', async operation => {
      const saved = await persist(args), row = await Artifact.findOne({ runtimeArtifactId: saved.runtimeArtifactId }).lean()
      await expect(Artifact[operation]({ _id: row._id }, { $unset: { lineageSummary: '' } })).rejects.toMatchObject({ details: { reason: 'REVIEW_ARTIFACT_IMMUTABLE' } })
      expect(await Artifact.findById(row._id).lean()).toEqual(row)
    })
  test('artifact document and bulk paths cannot escape by removing all proposed identity markers', async () => {
    const saved = await persist(args), document = await Artifact.findOne({ runtimeArtifactId: saved.runtimeArtifactId })
    const original = await Artifact.findById(document._id).lean()
    for (const action of [
      () => document.deleteOne(),
      () => Artifact.bulkWrite([{ deleteMany: { filter: { _id: document._id } } }]),
      () => Artifact.bulkWrite([{ updateOne: { filter: { _id: document._id }, update: { $unset: { lineageSummary: '' } } } }]),
    ]) await expect(action()).rejects.toMatchObject({ details: { reason: 'REVIEW_ARTIFACT_IMMUTABLE' } })
    document.contractVersion = '1.0.0'; document.artifactType = 'GOVERNED_REASONING_OUTPUT'; document.outputTypeKey = 'EXECUTIVE_BRIEF'
    document.runtimeArtifactId = 'ordinary-id'; document.lineageSummary = {}
    await expect(document.save()).rejects.toMatchObject({ details: { reason: 'REVIEW_ARTIFACT_IMMUTABLE' } })
    expect(await Artifact.findById(document._id).lean()).toEqual(original)
  })
  test('artifact bulk/lean insertion and normalized or computed promotion reject reserved identity', async () => {
    const saved = await persist(args), row = await Artifact.findOne({ runtimeArtifactId: saved.runtimeArtifactId }).lean()
    await expect(Artifact.insertMany([row], { lean: true })).rejects.toThrow()
    for (const update of [
      { $set: { contractVersion: ' outcome-rendition-review-artifact.v1 ' } },
      { $set: { outputTypeKey: ' rendition_rendered_expression_rl ' } },
      { $rename: { markdown: 'artifactType' } },
      [{ $set: { artifactType: { $concat: ['DOCX_', 'RENDITION_REVIEW'] } } }],
    ]) {
      await expect(Artifact.updateOne({ runtimeArtifactId: 'absent' }, update, { upsert: true })).rejects.toThrow()
      await expect(Artifact.bulkWrite([{ updateOne: { filter: { runtimeArtifactId: 'absent' }, update, upsert: true } }])).rejects.toThrow()
    }
    await expect(Artifact.bulkWrite([{ updateOne: { filter: { contractVersion: { $eq: 'outcome-rendition-review-artifact.v1' } },
      update: { $set: { markdown: 'ordinary' } }, upsert: true } }])).rejects.toThrow()
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
  test.each(['updateMany', 'deleteMany', 'bulkUpdate', 'bulkDelete'])('artifact atomic %s predicate protects a newly committed result', async operation => {
    const ordinary = await Artifact.create({ runtimeArtifactId: 'ordinary-control', executionId: 'ordinary-execution', ...f.scope,
      generatedBy: f.actorUserId, frameworkKey: f.runtime.frameworkKey, outputTypeKey: 'EXECUTIVE_BRIEF', markdown: 'Before' })
    jest.spyOn(Artifact, 'exists').mockImplementationOnce(async () => { await persist(args); return null })
    if (operation === 'updateMany') await Artifact.updateMany({}, { $set: { markdown: 'After' } })
    if (operation === 'deleteMany') await Artifact.deleteMany({})
    if (operation === 'bulkUpdate') await Artifact.bulkWrite([{ updateMany: { filter: {}, update: { $set: { markdown: 'After' } } } }])
    if (operation === 'bulkDelete') await Artifact.bulkWrite([{ deleteMany: { filter: {} } }])
    expect((await read(args)).completionConfirmed).toBe(true)
    const control = await Artifact.findById(ordinary._id).lean()
    if (operation.toLowerCase().includes('delete')) expect(control).toBeNull()
    else expect(control.markdown).toBe('After')
  })
  test('ordinary artifacts retain create/save/query update/delete behavior', async () => {
    const row = await Artifact.create({ runtimeArtifactId: 'ordinary-control', executionId: 'ordinary-execution', ...f.scope,
      generatedBy: f.actorUserId, frameworkKey: f.runtime.frameworkKey, outputTypeKey: 'EXECUTIVE_BRIEF' })
    row.markdown = 'Saved'; await row.save()
    await Artifact.updateOne({ _id: row._id }, { $set: { markdown: 'Updated' } })
    expect((await Artifact.findById(row._id)).markdown).toBe('Updated')
    await Artifact.deleteOne({ _id: row._id })
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test('awaits rejected plan-owner promises before terminal writes', async () => {
    deps.assertPlanIntegrity = async () => { throw new Error('Plan integrity unavailable') }
    await expect(persist(args)).rejects.toThrow('Plan integrity unavailable')
    expect(await counts()).toEqual([2, 0, 0, 3])
  })
  test('does not ignore housekeeping-named additions to a duplicate provider receipt', async () => {
    const saved = await persist(args)
    await collection(Execution).updateOne({ executionId: saved.executionId }, { $set: { 'provider.receipt.updatedAt': 'unbound-extra-material' } })
    await expect(read(args)).rejects.toMatchObject({ details: { reason: 'RESULT_BINDING' } })
    expect(await counts()).toEqual([3, 1, 1, 6])
  })
})
