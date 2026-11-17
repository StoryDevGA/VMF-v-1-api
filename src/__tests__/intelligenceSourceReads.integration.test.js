import { jest, beforeAll, afterAll, test, expect } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { randomUUID } from 'node:crypto'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import { stageRuntimeStateNativeInitialization } from '../services/runtimeStateNativeInitializationService.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'

const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId']
  .map(key => [key, new mongoose.Types.ObjectId()]))
const scope = { customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) } }
const basis = { ...ids, runtimeInstanceKey: 'ss042-isolated', current: true,
  stateVersion: 'runtime-revision:3', sourceStateVersion: 'runtime-revision:3' }
const getRuntimeInstance = jest.fn().mockResolvedValue({ ...basis, id: String(ids.runtimeInstanceId),
  customerId: String(ids.customerId), tenantId: String(ids.tenantId), revision: { revisionNumber: 3 } })
const runtimeService = await import('../services/runtimeInstanceService.js')
await jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...runtimeService, getRuntimeInstance }))
const { listRuntimeStateSources, listRuntimeStateEvidenceObjects } = await import('../services/runtimeStateRepository.js')
const input = { scopes: scope, runtimeInstanceId: String(ids.runtimeInstanceId) }
let mongo
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const uri = mongo.getUri('ss042_source_reads')
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback Mongo required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  await RuntimeEvidenceSource.createCollection()
  await RuntimeEvidenceObject.createCollection()
  await RuntimeStateMigrationReceipt.createCollection()
  await RuntimeStateMigrationReceipt.createIndexes()
  await RuntimeEvidenceSource.createIndexes()
  await RuntimeEvidenceObject.createIndexes()
  await RuntimeEvidenceSource.collection.insertMany(Array.from({ length: 61 }, (_, i) => ({
    ...basis, sourceId: `source-${String(i).padStart(3, '0')}`, sourceType: 'WEBSITE',
    title: i === 60 ? 'Source only a.*[$]' : `Source ${i}`, sourceRef: `https://synthetic.example/${i}`,
  })))
  await RuntimeEvidenceObject.collection.insertMany(Array.from({ length: 853 }, (_, i) => ({
    ...basis, evidenceObjectId: `evidence-${String(i).padStart(4, '0')}`, sourceId: 'source-000',
    createdAt: new Date(i * 1000), extractedFact: i === 1 ? 'Evidence only a.*[$]' : `Fact ${i}`,
  })))
  // Historical and other-tenant matches must never enter the selected revision's reads.
  await RuntimeEvidenceSource.collection.insertMany([
    { ...basis, sourceId: 'historical', current: false, stateStatus: 'HISTORICAL', title: 'a.*[$]' },
    { ...basis, tenantId: new mongoose.Types.ObjectId(), sourceId: 'other-tenant', title: 'a.*[$]' },
  ])
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('real storage independently pages sources and evidence with exact contribution counts', async () => {
  const page = await listRuntimeStateSources({ ...input, page: '3', pageSize: '25' })
  expect(page).toMatchObject({ total: 61, totalPages: 3, hasMore: false, completeness: 'COMPLETE' })
  expect(page.sourceRegistry).toHaveLength(11)
  expect(page.sourceRegistry[0].sourceId).toBe('source-050')
  const first = await listRuntimeStateSources({ ...input, sourceId: 'source-000' })
  expect(first.sourceRegistry[0].evidenceObjectCount).toBe(853)
  const evidence = await listRuntimeStateEvidenceObjects({ ...input, sourceId: 'source-000', page: 2, pageSize: 25 })
  expect(evidence).toMatchObject({ total: 853, page: 2 })
  expect(evidence.evidenceObjects).toHaveLength(25)
  expect(evidence.sourceRegistry[0].sourceId).toBe('source-000')
})
test('literal global search finds off-page source-only and evidence-only matches', async () => {
  const sources = await listRuntimeStateSources({ ...input, search: 'a.*[$]' })
  expect(sources.total).toBe(1)
  expect(sources.sourceRegistry[0]).toMatchObject({ sourceId: 'source-060', evidenceObjectCount: 0 })
  const evidence = await listRuntimeStateEvidenceObjects({ ...input, search: 'a.*[$]' })
  expect(evidence.total).toBe(1)
  expect(evidence.evidenceObjects[0]).toMatchObject({ evidenceObjectId: 'evidence-0001', sourceId: 'source-000' })
})
test('exact provenance resolves without fallback and distinguishes valid empty sources', async () => {
  const exact = await listRuntimeStateEvidenceObjects({ ...input, sourceId: 'source-000', evidenceObjectId: 'evidence-0001' })
  expect(exact.evidenceObjects).toHaveLength(1)
  await expect(listRuntimeStateEvidenceObjects({ ...input, sourceId: 'source-001', evidenceObjectId: 'evidence-0001' })).rejects.toMatchObject({ status: 404 })
  expect(await listRuntimeStateEvidenceObjects({ ...input, sourceId: 'source-060' })).toMatchObject({ total: 0, evidenceObjects: [] })
  await expect(listRuntimeStateEvidenceObjects({ ...input, sourceId: 'other-tenant' })).rejects.toMatchObject({ status: 404 })
})
test('actual aggregation fails closed on contradictory currentness without counting it', async () => {
  const row = { ...basis, evidenceObjectId: 'bad-current', sourceId: 'source-000', isCurrent: false }
  await RuntimeEvidenceObject.collection.insertOne(row)
  try { await expect(listRuntimeStateSources({ ...input, sourceId: 'source-000' }))
    .rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_SOURCE_CURRENTNESS_INVALID' }) }
  finally { await RuntimeEvidenceObject.collection.deleteOne({ evidenceObjectId: 'bad-current' }) }
})

test.each([
  { runtimeInstanceId: new mongoose.Types.ObjectId() }, { runtimeInstanceKey: 'wrong-revision' }, { runtimeInstanceId: null },
])('source registry rejects contradictory native runtime identity %j', async identity => {
  const saved = await RuntimeEvidenceSource.collection.insertOne({ ...basis, ...identity,
    sourceId: 'identity-conflict', sourceType: 'WEBSITE', title: 'Never returned' })
  try {
    await expect(listRuntimeStateSources({ ...input, sourceId: 'identity-conflict' }))
      .rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_SOURCE_MISSING' })
  } finally { await RuntimeEvidenceSource.collection.deleteOne({ _id: saved.insertedId }) }
})

test.each([
  { runtimeInstanceId: new mongoose.Types.ObjectId() }, { runtimeInstanceKey: 'wrong-revision' }, { runtimeInstanceId: null },
])('source contribution aggregation rejects contradictory native runtime identity %j', async identity => {
  const saved = await RuntimeEvidenceObject.collection.insertOne({ ...basis, ...identity,
    evidenceObjectId: 'identity-conflict', sourceId: 'source-000' })
  try {
    await expect(listRuntimeStateSources({ ...input, sourceId: 'source-000' }))
      .rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_SOURCE_MISSING' })
  } finally { await RuntimeEvidenceObject.collection.deleteOne({ _id: saved.insertedId }) }
})

test.each(['runtimeInstanceId', 'runtimeInstanceKey'])('matching native identity retains absent %s legacy compatibility', async absentField => {
  const legacy = { ...basis }
  delete legacy[absentField]
  const source = await RuntimeEvidenceSource.collection.insertOne({ ...legacy, sourceId: 'legacy-identity', sourceType: 'WEBSITE' })
  const evidence = await RuntimeEvidenceObject.collection.insertOne({ ...legacy, sourceId: 'legacy-identity', evidenceObjectId: 'legacy-identity' })
  try {
    expect(await listRuntimeStateSources({ ...input, sourceId: 'legacy-identity' })).toMatchObject({
      completeness: 'COMPLETE', total: 1, sourceRegistry: [{ sourceId: 'legacy-identity', evidenceObjectCount: 1 }],
    })
  } finally {
    await RuntimeEvidenceSource.collection.deleteOne({ _id: source.insertedId })
    await RuntimeEvidenceObject.collection.deleteOne({ _id: evidence.insertedId })
  }
})
test('records isolated query explain against existing indexes without live index changes', async () => {
  const collection = mongoose.connection.collection('runtime_evidence_sources')
  const spy = jest.spyOn(collection, 'find')
  await listRuntimeStateSources(input)
  const filter = spy.mock.calls[0][0]
  spy.mockRestore()
  const plan = await collection.find(filter)
    .sort({ sourceId: 1, _id: 1 }).limit(25).maxTimeMS(2000).explain('executionStats')
  expect(plan.executionStats.nReturned).toBe(25)
  expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(63)
  expect(plan.executionStats.executionTimeMillis).toBeLessThan(2000)
  console.info('SS042 isolated explain', JSON.stringify({ returned: plan.executionStats.nReturned,
    examined: plan.executionStats.totalDocsExamined, millis: plan.executionStats.executionTimeMillis,
    winningPlan: plan.queryPlanner.winningPlan }))
})
test('complete empty review/acceptance filters return scoped zero; missing unfiltered storage stays unavailable', async () => {
  await RuntimeEvidenceObject.collection.updateMany({ ...ids, current: true }, { $set: { reviewStatus: 'ACCEPTED', acceptanceState: 'ACCEPTED' } })
  for (const filter of [{ reviewStatus: 'PENDING' }, { reviewStatus: 'REJECTED' }, { acceptanceState: 'REJECTED' }]) {
    const page = await listRuntimeStateEvidenceObjects({ ...input, ...filter })
    expect(page).toMatchObject({ total: 0, totalCapped: false, evidenceObjects: [],
      control: { tenantId: String(ids.tenantId), id: String(ids.runtimeInstanceId) },
      pageReceipt: { result: 'EMPTY_PAGE', total: 0, stateVersion: basis.stateVersion } })
  }
  await expect(listRuntimeStateEvidenceObjects({ ...input, evidenceObjectId: 'missing-exact' })).rejects.toMatchObject({ status: 404 })
  const collection = mongoose.connection.collection('runtime_evidence_objects')
  const count = jest.spyOn(collection, 'countDocuments').mockRejectedValueOnce(new Error('Synthetic count unavailable'))
  await expect(listRuntimeStateEvidenceObjects({ ...input, reviewStatus: 'PENDING' })).rejects.toMatchObject({ status: 503 })
  count.mockRestore()
  await RuntimeEvidenceObject.collection.deleteMany({ ...ids, current: true })
  await expect(listRuntimeStateEvidenceObjects(input)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_MISSING' })
})

describe('authoritative native initial empty evidence', () => {
  const originalControl = getRuntimeInstance.getMockImplementation()
  let runtime, args, receipt
  beforeEach(async () => {
    const customerId = new mongoose.Types.ObjectId(), tenantId = new mongoose.Types.ObjectId(), _id = new mongoose.Types.ObjectId()
    runtime = { _id, id: String(_id), customerId, tenantId, runtimeInstanceKey: 'empty-' + randomUUID(),
      stateVersion: 'rsv2:' + randomUUID(), updatedAt: new Date(), status: 'ACTIVE', framework_state: {} }
    args = { runtimeInstanceId: String(_id), scopes: { customer: { _id: String(customerId) },
      tenant: { _id: String(tenantId), customerId: String(customerId) } } }
    const session = await mongoose.startSession()
    try { await session.withTransaction(async () => {
      receipt = await stageRuntimeStateNativeInitialization({ runtimeInstance: runtime, session })
    }) } finally { await session.endSession() }
    getRuntimeInstance.mockResolvedValue(runtime)
  })
  afterEach(() => { jest.restoreAllMocks(); getRuntimeInstance.mockImplementation(originalControl) })

  test('real native receipt permits a scoped current empty page without writing or inventing evidence', async () => {
    const before = await RuntimeStateMigrationReceipt.findById(receipt._id).lean()
    const page = await listRuntimeStateEvidenceObjects(args)
    expect(page).toMatchObject({ total: 0, totalCapped: false, evidenceObjects: [], sourceRegistry: [],
      stateVersion: runtime.stateVersion, pageReceipt: { result: 'EMPTY_PAGE', total: 0, stateVersion: runtime.stateVersion } })
    expect(await RuntimeStateMigrationReceipt.findById(receipt._id).lean()).toEqual(before)
    expect(await RuntimeEvidenceObject.countDocuments({ runtimeInstanceId: runtime._id })).toBe(0)
  })

  test.each(['missing', 'stale', 'scope', 'status', 'operation', 'hash', 'count', 'digest', 'binding', 'targets', 'duplicate domain'])('keeps %s initialization proof blocked', async mode => {
    const collection = RuntimeStateMigrationReceipt.collection, where = { _id: receipt._id }
    if (mode === 'missing') await collection.deleteOne(where)
    else {
      const changes = {
        stale: { assignedStateVersion: 'rsv2:' + randomUUID() }, scope: { tenantId: new mongoose.Types.ObjectId() },
        status: { status: 'FAILED' }, operation: { operationType: 'LEGACY_BASELINE' },
        hash: { 'logicalSources.1.sourceHash': 'sha256:' + 'a'.repeat(64) }, count: { 'logicalSources.1.recordCount': 1 },
        digest: { scopeDigest: 'sha256:' + 'b'.repeat(64) }, binding: { 'targetSelectionRef.bindingRef': 'foreign' },
        targets: { 'logicalSources.1.targetCollections': ['runtime_evidence_objects'] },
        'duplicate domain': { logicalSources: [receipt.logicalSources[1].toObject(), receipt.logicalSources[1].toObject()] },
      }
      await collection.updateOne(where, { $set: changes[mode] })
    }
    await expect(listRuntimeStateEvidenceObjects(args)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_MISSING' })
  })

  test.each(['source', 'historical source', 'historical evidence'])('does not treat %s storage as pristine empty', async mode => {
    const row = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
      runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion,
      current: mode === 'source', ...(mode !== 'source' ? { stateStatus: 'HISTORICAL' } : {}) }
    if (mode.includes('source')) await RuntimeEvidenceSource.collection.insertOne({ ...row, sourceId: 'previous', sourceType: 'WEBSITE' })
    else await RuntimeEvidenceObject.collection.insertOne({ ...row, evidenceObjectId: 'previous', sourceId: 'previous' })
    await expect(listRuntimeStateEvidenceObjects(args)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_MISSING' })
  })

  test('a rejected receipt read stays unavailable', async () => {
    jest.spyOn(mongoose.connection.collection('runtime_state_migration_receipts'), 'find').mockImplementationOnce(() => { throw Error('Synthetic read rejection') })
    await expect(listRuntimeStateEvidenceObjects(args)).rejects.toMatchObject({ status: 503 })
  })

  test('a basis change during empty-proof reads stays blocked', async () => {
    getRuntimeInstance.mockResolvedValueOnce(runtime).mockResolvedValueOnce({ ...runtime, stateVersion: 'rsv2:' + randomUUID() })
    await expect(listRuntimeStateEvidenceObjects(args)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_EVIDENCE_MISSING' })
  })
})
