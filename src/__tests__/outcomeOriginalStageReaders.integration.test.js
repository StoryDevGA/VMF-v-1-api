import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { OutcomeQualityStageExecution as Stage, RuntimeInstance, OutcomeSession, OutcomeDraft,
  OutcomeDraftIteration, OutcomeKnowledgeCompositionPlan } from '../models/index.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'
import { readGovernedApprovalState } from '../services/outcomeGovernedFinalisationService.js'
import { originalOutcomeQualityStageFilter as original, OUTCOME_RENDITION_QUALITY_STAGE_VERSION as version,
  OUTCOME_RENDITION_QUALITY_STAGE_KEY as key } from '../utils/outcomeQualityStageSubjects.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

const database = process.env.VMF_ORIGINAL_STAGE_ISOLATED_DB
const run = database ? describe : describe.skip
run('original quality-chain readers with real isolated Mongo population probes', () => {
  let owned = false, evidencePath, fixture
  const models = [Stage, RuntimeInstance, OutcomeSession, OutcomeDraft, OutcomeDraftIteration, OutcomeKnowledgeCompositionPlan]
  const snapshots = []
  const collection = model => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)
      || !models.includes(model)) throw new Error('Owned isolated collection required')
    return model.collection
  }
  const rows = async () => {
    const result = {}
    for (const model of models) result[model.collection.name] = await collection(model).find({}).sort({ _id: 1 }).toArray()
    return result
  }
  const approval = () => readGovernedApprovalState({ scope: fixture.scope,
    sessionId: fixture.session.sessionId, draftId: fixture.draft.draftId })
  const probe = (changes = {}) => ({ ...fixture.scope, requestId: fixture.plan.requestId, planId: fixture.plan.planId,
    draftId: fixture.draft.draftId, draftIterationId: fixture.iteration.draftIterationId,
    contractVersion: version, stageKey: key, stageExecutionId: 'population-probe', stageOrder: 99,
    attemptNumber: 99, status: 'FAILED', ...changes })
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_ORIGINAL_STAGE_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 })
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    for (const model of models) { await model.createCollection(); await model.createIndexes() }
  }, 30000)
  beforeEach(async () => {
    fixture = makeGovernedFinalisationFixture()
    // Existing stages use their normal model casting/validation. Additional
    // prospective raw rows below are query probes, not admitted stages.
    await Stage.create(fixture.stages.map(stage => ({ ...stage, createdBy: fixture.plan.createdBy })))
    for (const [model, values] of [[RuntimeInstance, [fixture.runtime]],
      [OutcomeSession, [fixture.session]], [OutcomeDraft, [fixture.draft]],
      [OutcomeDraftIteration, [fixture.iteration]], [OutcomeKnowledgeCompositionPlan, [fixture.plan]]]) {
      await collection(model).insertMany(values.map(value => ({ ...value })))
    }
  })
  afterEach(async () => {
    if (!owned) return
    snapshots.push({ case: expect.getState().currentTestName, rows: await rows(), indexes: await Stage.collection.indexes() })
    writeFileSync(evidencePath, JSON.stringify({ database,
      boundary: 'Real Mongo query/approval-reader proof; generic fixture and raw population probes, no valid new stage/native/provider proof', snapshots }, null, 2))
    for (const model of models) await collection(model).deleteMany({})
  })
  afterAll(async () => {
    if (owned) for (const model of models) expect(await collection(model).countDocuments({})).toBe(0)
    await mongoose.disconnect()
  })
  test('ordinary approval history remains identical with an exact rendition tuple and reads preserve every source', async () => {
    const before = await approval()
    await collection(Stage).insertOne(probe())
    const saved = membershipHash(await rows()), after = await approval()
    expect(after.stages).toEqual(before.stages)
    expect(after.stages).toHaveLength(6)
    expect(membershipHash(await rows())).toBe(saved)
    expect(await Stage.countDocuments({})).toBe(7)
  })
  test.each([
    ['missing version', { contractVersion: undefined }], ['unknown version', { contractVersion: 'unknown' }],
    ['legacy version', { contractVersion: 'outcome-governed-quality.v1' }],
    ['missing key', { stageKey: undefined }], ['unknown key', { stageKey: 'UNKNOWN_STAGE' }],
    ['legacy key', { stageKey: 'RENDERED_EXPRESSION_RL' }],
    ['array version', { contractVersion: [version] }], ['array key', { stageKey: [key] }],
    ['both arrays', { contractVersion: [version], stageKey: [key] }],
    ['null version', { contractVersion: null }], ['null key', { stageKey: null }],
    ['numeric version', { contractVersion: 1 }], ['numeric key', { stageKey: 1 }],
    ['object version', { contractVersion: { value: version } }], ['object key', { stageKey: { value: key } }],
  ])('keeps %s visible to existing chain rejection', async (_name, changes) => {
    const value = probe(changes)
    for (const field of Object.keys(value)) if (value[field] === undefined) delete value[field]
    await collection(Stage).insertOne(value)
    const saved = membershipHash(await rows())
    expect(await Stage.find(original(fixture.scope)).lean()).toHaveLength(7)
    await expect(approval()).rejects.toThrow()
    expect(membershipHash(await rows())).toBe(saved)
  })
  test('preserves existing scope/or/nor predicates and does not mutate a reusable filter', async () => {
    await collection(Stage).insertMany([probe(), probe({ stageExecutionId: 'wrong-scope',
      tenantId: new mongoose.Types.ObjectId(), stageKey: 'UNKNOWN_STAGE' })])
    const filter = { ...fixture.scope, $or: [{ requestId: fixture.plan.requestId }, { planId: 'other' }],
      $nor: [{ stageKey: 'WORKING_DRAFT' }] }
    const saved = membershipHash(filter)
    const plain = await Stage.find(filter).lean(), selected = await Stage.find(original(filter)).lean()
    expect(selected.map(row => row.stageExecutionId).sort()).toEqual(plain.filter(row => row.stageExecutionId !== 'population-probe')
      .map(row => row.stageExecutionId).sort())
    expect(selected).toHaveLength(5)
    expect(membershipHash(filter)).toBe(saved)
  })
  test('preserves legacy order/latest failure despite a later failed rendition and records query explain', async () => {
    const failed = probe({ contractVersion: fixture.stages[0].contractVersion, stageKey: 'RENDERED_EXPRESSION_RL',
      stageExecutionId: 'legacy-failure-probe', stageOrder: 6, attemptNumber: 2 })
    await collection(Stage).insertOne(failed)
    const filter = { ...fixture.scope, planId: fixture.plan.planId }, sort = { stageOrder: 1, attemptNumber: 1 }
    const before = await Stage.find(filter).sort(sort).lean()
    await collection(Stage).insertOne(probe())
    expect(await Stage.find(original(filter)).sort(sort).lean()).toEqual(before)
    expect((await Stage.findOne(original({ ...filter, status: 'FAILED' })).sort({ stageOrder: -1, attemptNumber: -1 }).lean())
      .stageExecutionId).toBe('legacy-failure-probe')
    const explain = await Stage.find(original(filter)).sort(sort).explain('executionStats')
    snapshots.push({ explain, boundary: 'Small isolated fixture only; no production-scale performance claim' })
    expect(explain.executionStats.nReturned).toBe(7)
  })
})
