import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeAssetVersion from '../models/OutcomeAssetVersion.js'

let replica
let source
let before
const immutable = { code: 'OUTCOME_ASSET_VERSION_IMMUTABLE' }
const fixture = (approved = true) => ({
  outcomeAssetVersionId: `version-${new mongoose.Types.ObjectId()}`,
  outcomeAssetId: 'controlled-asset', sessionId: 'controlled-session',
  tenantId: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId(),
  runtimeInstanceId: new mongoose.Types.ObjectId(), frameworkKey: 'VMF', packageKey: 'controlled-package',
  versionNumber: 1, outputTypeKey: 'EXECUTIVE_BRIEF', outputTypeLabel: 'Executive Brief',
  sourceOutputAssetId: 'controlled-output', generatedBy: new mongoose.Types.ObjectId(),
  customerContent: { markdown: '# Bounded decision\n\nIndependent validation remains required.' },
  truthSignature: { status: 'VALID', evidence: { sourceHash: 'a'.repeat(64) } },
  lineageSummary: { ...(approved ? { draftApproval: { operation: 'DRAFT_APPROVAL', draftId: 'draft-1' } } : {}) },
  warnings: ['Qualification remains visible.'], limitations: ['No outcome benefit established.'],
})
const read = () => OutcomeAssetVersion.findById(source._id).lean()
const legacyFilter = (version) => ({
  runtimeInstanceId: version.runtimeInstanceId, sessionId: version.sessionId, status: 'CURRENT',
  publishedAt: null, 'lineageSummary.draftApproval': { $exists: false },
})
const truthUpdate = { $set: { truthSignature: { status: 'VALID', evidence: { sourceHash: 'b'.repeat(64) } },
  'lineageSummary.truthSignatureStatus': 'VALID', 'lineageSummary.truthSignatureCurrentness': 'CURRENT' } }

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replica.getUri('ss044_version_immutability'), { autoCreate: false, autoIndex: false })
  expect(mongoose.connection.host).toBe('127.0.0.1')
  expect(mongoose.connection.name).toBe('ss044_version_immutability')
  await OutcomeAssetVersion.createCollection()
  await OutcomeAssetVersion.init()
}, 60000)
afterAll(async () => {
  await mongoose.disconnect()
  if (replica) await replica.stop()
}, 60000)
beforeEach(async () => {
  source = await OutcomeAssetVersion.create(fixture())
  before = await read()
})

describe('persisted Outcome asset version immutability through Mongoose', () => {
  test('creates and reads the exact qualified customer content', async () => {
    expect(before.customerContent.markdown).toContain('Independent validation remains required.')
    expect(before.lineageSummary.draftApproval.operation).toBe('DRAFT_APPROVAL')
  })
  test.each([true, false])('document content changes reject with validateBeforeSave=%s', async (validateBeforeSave) => {
    source.customerContent.markdown = 'Invented proven benefit'
    source.markModified('customerContent')
    await expect(source.save({ validateBeforeSave })).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('clearing approval cannot unlock lineage or content', async () => {
    source.lineageSummary = {}
    source.customerContent = { markdown: 'replacement' }
    await expect(source.save()).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('document lifecycle transition preserves every content and lineage field', async () => {
    source.status = 'SUPERSEDED'
    await source.save()
    const { status, updatedAt, ...afterContent } = await read()
    const { status: previousStatus, updatedAt: previousUpdatedAt, ...beforeContent } = before
    expect(status).toBe('SUPERSEDED')
    expect(afterContent).toEqual(beforeContent)
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(previousUpdatedAt.getTime())
    expect(previousStatus).toBe('CURRENT')
  })
  test.each(['updateOne', 'updateMany', 'findOneAndUpdate'])('%s rejects qualified content overwrite', async (method) => {
    await expect(OutcomeAssetVersion[method]({ _id: source._id }, { $set: { 'customerContent.markdown': 'overwrite' } })).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test.each(['outcomeAssetVersionId', 'versionNumber', 'lineageSummary', 'truthSignature', 'generatedBy'])('query cannot mutate %s', async (field) => {
    await expect(OutcomeAssetVersion.updateOne({ _id: source._id }, { $set: { [field]: 'changed' } })).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test.each(['replaceOne', 'findOneAndReplace'])('%s rejects replacement', async (method) => {
    await expect(OutcomeAssetVersion[method]({ _id: source._id }, fixture())).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('pipeline, upsert and unset reject without modifying source', async () => {
    await expect(OutcomeAssetVersion.updateOne({ _id: source._id }, [{ $set: { status: 'ARCHIVED' } }])).rejects.toMatchObject(immutable)
    await expect(OutcomeAssetVersion.updateOne({ _id: source._id }, { $set: { status: 'ARCHIVED' } }, { upsert: true })).rejects.toMatchObject(immutable)
    await expect(OutcomeAssetVersion.updateOne({ _id: source._id }, { $unset: { 'lineageSummary.draftApproval': 1 } })).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('query status transition is allowed, invalid lifecycle state rejects', async () => {
    await expect(OutcomeAssetVersion.updateOne({ _id: source._id }, { $set: { status: 'INVENTED' } })).rejects.toMatchObject(immutable)
    await OutcomeAssetVersion.updateOne({ _id: source._id }, { $set: { status: 'ARCHIVED' } })
    expect(await read()).toEqual({ ...before, status: 'ARCHIVED', updatedAt: expect.any(Date) })
  })
  test('bulk content and replacement operations fail before any batch mutation', async () => {
    await expect(OutcomeAssetVersion.bulkWrite([
      { updateOne: { filter: { _id: source._id }, update: { $set: { status: 'ARCHIVED' } } } },
      { updateOne: { filter: { _id: source._id }, update: { $set: { customerContent: {} } } } },
    ])).rejects.toMatchObject(immutable)
    await expect(OutcomeAssetVersion.bulkWrite([{ replaceOne: { filter: { _id: source._id }, replacement: fixture() } }])).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('bulk legitimate lifecycle transition preserves source content', async () => {
    await OutcomeAssetVersion.bulkWrite([{ updateOne: { filter: { _id: source._id }, update: { $set: { status: 'SUPERSEDED' } } } }])
    expect(await read()).toEqual({ ...before, status: 'SUPERSEDED', updatedAt: expect.any(Date) })
  })
  test('exact legacy rebind updates unapproved version and cannot reach governed version', async () => {
    const legacy = await OutcomeAssetVersion.create({ ...fixture(false), runtimeInstanceId: source.runtimeInstanceId })
    const result = await OutcomeAssetVersion.updateMany(legacyFilter(source), truthUpdate)
    expect(result.modifiedCount).toBe(1)
    expect((await OutcomeAssetVersion.findById(legacy._id).lean()).truthSignature).toEqual(truthUpdate.$set.truthSignature)
    expect(await read()).toEqual(before)
  })
  test.each(['sessionId', 'runtimeInstanceId', 'publishedAt', 'lineageSummary.draftApproval'])('legacy exception rejects missing %s scope', async (field) => {
    const filter = legacyFilter(source); delete filter[field]
    await expect(OutcomeAssetVersion.updateMany(filter, truthUpdate)).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
  test('legacy exception rejects broad scope, lifecycle mismatch and unrelated fields', async () => {
    await expect(OutcomeAssetVersion.updateMany({ ...legacyFilter(source), sessionId: { $ne: null } }, truthUpdate)).rejects.toMatchObject(immutable)
    await expect(OutcomeAssetVersion.updateMany({ ...legacyFilter(source), status: 'SUPERSEDED' }, truthUpdate)).rejects.toMatchObject(immutable)
    await expect(OutcomeAssetVersion.updateMany(legacyFilter(source), { $set: { ...truthUpdate.$set, customerContent: {} } })).rejects.toMatchObject(immutable)
    expect(await read()).toEqual(before)
  })
})
