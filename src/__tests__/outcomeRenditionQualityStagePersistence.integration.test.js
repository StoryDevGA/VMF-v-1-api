import { jest } from '@jest/globals'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { renditionQualityStageFixture } from './fixtures/renditionQualityStageFixture.js'
import { assertRenditionQualityStage, buildRenditionQualityStage, serializeRenditionQualityStage } from '../services/outcomeRenditionQualityStageContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION } from '../constants/outcomeGovernedQuality.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'

const database = process.env.VMF_RENDITION_STAGE_ISOLATED_DB
const run = database ? describe : describe.skip
run('distinct stage model real isolated persistence; simulated source/provider receipts', () => {
  let owned = false, evidencePath, f
  const snapshots = []
  const collection = () => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)) throw new Error('Owned isolated collection required')
    return Stage.collection
  }
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_RENDITION_STAGE_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 })
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true; await Stage.createCollection(); await Stage.createIndexes()
  }, 30000)
  beforeEach(async () => { f = await renditionQualityStageFixture() })
  afterEach(async () => {
    jest.restoreAllMocks()
    if (!owned) return
    snapshots.push({ case: expect.getState().currentTestName, rows: await collection().find({}).toArray(), indexes: await collection().indexes() })
    writeFileSync(evidencePath, JSON.stringify({ database,
      boundary: 'Real isolated stage shape/index/immutability only; simulated receipts, no signed native result/provider/audit proof', snapshots }, null, 2))
    await collection().deleteMany({})
  })
  afterAll(async () => { if (owned) expect(await collection().countDocuments({})).toBe(0); await mongoose.disconnect() })
  test.each([false, true])('persists and reads full completed failed=%s findings through the new serializer', async failed => {
    f = await renditionQualityStageFixture(failed)
    const saved = await Stage.create(f.row), read = await Stage.findById(saved._id).lean()
    expect(serializeRenditionQualityStage(read).outputSnapshot).toEqual(f.row.outputSnapshot)
    expect(serializeRenditionQualityStage(read).status).toBe(failed ? 'FAILED' : 'SUCCEEDED')
    expect(assertRenditionQualityStage(read)).toBe(read)
    const indexes = await collection().indexes()
    expect(indexes.find(index => index.name === 'uniq_outcome_quality_stage_attempt')).toMatchObject({ unique: true,
      key: { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 } })
  })
  test('plan/stage/attempt index admits one concurrent stage even with different record IDs', async () => {
    const other = buildRenditionQualityStage(f.stageArgs)
    const results = await Promise.allSettled([Stage.create(f.row), Stage.create(other)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason.code).toBe(11000)
    expect(await Stage.countDocuments({})).toBe(1)
  })
  test.each([{}, { lean: true }, { skipValidation: true }, { lean: true, skipValidation: true }])(
    'insertMany validates and casts the reserved role despite options %j', async options => {
      const invalid = structuredClone(f.row); invalid.renditionInputSnapshot.receipt.terminalStatus = 'unknown'
      await expect(Stage.insertMany([invalid], options)).rejects.toThrow()
      expect(await Stage.countDocuments({})).toBe(0)
      await Stage.insertMany([f.row], options)
      const row = await Stage.findOne({ ...f.input.subject.scope }).lean()
      expect(row).not.toBeNull(); assertRenditionQualityStage(row)
      expect(row.runtimeInstanceId).toBeInstanceOf(mongoose.Types.ObjectId)
    })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])(
    'refuses immutable query %s and preserves the complete record', async operation => {
      const saved = await Stage.create(f.row), before = membershipHash(await Stage.findById(saved._id).lean())
      await expect(Stage[operation]({ _id: saved._id }, { $unset: { renditionInputSnapshot: '' } })).rejects.toThrow('immutable')
      expect(membershipHash(await Stage.findById(saved._id).lean())).toBe(before)
    })
  test('document save/delete cannot remove discriminators to escape immutability', async () => {
    const saved = await Stage.create(f.row), before = membershipHash(await Stage.findById(saved._id).lean())
    saved.contractVersion = OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION
    saved.stageKey = 'RENDERED_EXPRESSION_RL'; saved.renditionInputSnapshot = undefined
    await expect(saved.save()).rejects.toThrow('immutable')
    await expect(saved.deleteOne()).rejects.toThrow('immutable')
    expect(membershipHash(await Stage.findById(saved._id).lean())).toBe(before)
  })
  test('bulk mutations atomically exclude protected rows even when identity fields are removed', async () => {
    const saved = await Stage.create(f.row), before = await Stage.findById(saved._id).lean()
    const legacy = makeGovernedFinalisationFixture()
    await expect(Stage.bulkWrite([{ updateOne: { filter: { _id: saved._id },
      update: { $unset: { contractVersion: '', stageKey: '' } } } }])).rejects.toMatchObject({ name: 'StrictModeError' })
    for (const operation of [
      // __v is normally mutable, so these operations actually reach Mongo.
      { updateOne: { filter: { _id: saved._id }, update: { $inc: { __v: 1 } } } },
      { updateMany: { filter: {}, update: { $inc: { __v: 1 } } } },
      { deleteOne: { filter: { _id: saved._id } } }, { deleteMany: { filter: {} } },
      { replaceOne: { filter: { _id: saved._id }, replacement: { ...legacy.stages[0], createdBy: legacy.plan.createdBy } } },
    ]) {
      const result = await Stage.bulkWrite([operation])
      expect(result.modifiedCount + result.deletedCount).toBe(0)
      expect(await Stage.findById(saved._id).lean()).toEqual(before)
    }
  })
  test('bulk cannot insert/promote/upsert a reserved role, rename protected fields or use dynamic pipelines', async () => {
    for (const operation of [
      { insertOne: { document: f.row } }, { replaceOne: { filter: {}, replacement: f.row } },
      { updateOne: { filter: {}, update: { $set: { stageKey: f.row.stageKey } } } },
      { updateOne: { filter: {}, update: { $unset: { renditionInputSnapshot: '' } } } },
      { updateOne: { filter: { contractVersion: f.row.contractVersion }, update: { $set: { status: 'FAILED' } }, upsert: true } },
      { updateOne: { filter: {}, update: { $rename: { other: 'renditionInputSnapshot' } } } },
      { updateOne: { filter: {}, update: [{ $set: { stageKey: { $concat: ['RENDITION_', 'RENDERED_EXPRESSION_RL'] } } }] } },
    ]) await expect(Stage.bulkWrite([operation], { skipValidation: true })).rejects.toThrow('immutable')
    expect(await Stage.countDocuments({})).toBe(0)
  })
  test('bulk actual predicate still protects a stage inserted after middleware', async () => {
    const nativeBulk = Stage.collection.bulkWrite.bind(Stage.collection)
    jest.spyOn(Stage.collection, 'bulkWrite').mockImplementationOnce(async (operations, options) => {
      await collection().insertOne(new Stage(f.row).toObject())
      return nativeBulk(operations, options)
    })
    const result = await Stage.bulkWrite([{ deleteMany: { filter: {} } }])
    expect(result.deletedCount).toBe(0)
    expect(await Stage.countDocuments({})).toBe(1)
    assertRenditionQualityStage(await Stage.findOne({}).lean())
  })
  test('ordinary bulk predicates still reach their existing rows while reserved rows remain intact', async () => {
    await Stage.create(f.row)
    await collection().insertOne({ stageExecutionId: 'legacy-bulk-population-probe', contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
      runtimeInstanceId: new mongoose.Types.ObjectId(), planId: 'legacy-population', stageKey: 'FRAMEWORK_GUIDANCE', attemptNumber: 1 })
    const result = await Stage.bulkWrite([{ deleteMany: { filter: {} } }])
    expect(result.deletedCount).toBe(1)
    expect(await Stage.countDocuments({})).toBe(1)
    assertRenditionQualityStage(await Stage.findOne({}).lean())
  })
  test.each([
    ['claim', row => { row.renditionInputSnapshot.claim.executionId = [row.renditionInputSnapshot.claim.executionId] }],
    ['reservation', row => { row.renditionInputSnapshot.reservation.executionId = [row.renditionInputSnapshot.reservation.executionId] }],
    ['result', row => { row.renditionInputSnapshot.result.executionId = [row.renditionInputSnapshot.result.executionId] }],
    ['artifact', row => { row.renditionInputSnapshot.result.runtimeArtifactId = [row.renditionInputSnapshot.result.runtimeArtifactId] }],
    ['response', row => { row.renditionInputSnapshot.receipt.responseId = [row.renditionInputSnapshot.receipt.responseId] }],
    ['candidate', row => { row.renditionInputSnapshot.subject.candidate.candidateId = [row.renditionInputSnapshot.subject.candidate.candidateId] }],
    ['preview', row => { row.renditionInputSnapshot.subject.preview.previewId = [row.renditionInputSnapshot.subject.preview.previewId] }],
    ['numeric start', row => { row.startedAt = Date.parse(row.startedAt) }],
    ['numeric completion', row => { row.completedAt = Date.parse(row.completedAt) }],
    ['noncanonical string', row => { row.startedAt = row.startedAt.replace('T', ' ') }],
  ])('blocks %s before any persisted stage, including lean insertMany', async (_name, mutate) => {
    mutate(f.row)
    f.row.inputFingerprint = membershipHash(f.row.renditionInputSnapshot)
    await expect(Stage.create(f.row)).rejects.toThrow()
    await expect(Stage.insertMany([f.row], { lean: true, skipValidation: true })).rejects.toThrow()
    expect(await Stage.countDocuments({})).toBe(0)
  })
})
