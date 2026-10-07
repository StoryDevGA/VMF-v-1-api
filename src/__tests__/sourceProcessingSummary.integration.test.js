import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import AuditLog from '../models/AuditLog.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeAcquisitionRun from '../models/RuntimeAcquisitionRun.js'
import express from 'express'
import request from 'supertest'
import { getRuntimeStateSourceSummary as summaryController } from '../controllers/runtimeInstance.controller.js'
import { validateReviewCompletionScope } from '../validators/reviewCompletion.validator.js'
import { validateRuntimeInstanceId } from '../validators/runtimeInstance.validator.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { Customer, Tenant, LicenseLevel, Role } from '../models/index.js'
import { getRuntimeStateSourceSummary } from '../services/runtimeStateRepository.js'
import auditService from '../services/auditService.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { readSourceProcessingSummary } from '../services/sourceProcessingSummary.js'

let replica
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'actorUserId'].map(key => [key, new mongoose.Types.ObjectId()]))
const control = { ...Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, String(value)])),
  id: String(ids.runtimeInstanceId), runtimeInstanceKey: 'ss042-summary-isolated', stateVersion: 'rsv2:summary-current' }
const sourceFilter = { customerId: ids.customerId, tenantId: ids.tenantId, runtimeInstanceId: ids.runtimeInstanceId, current: true }
const collection = name => mongoose.connection.db.collection(name)
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  await mongoose.connect(replica.getUri(`ss042_summary_${randomUUID().replaceAll('-', '')}`), { autoIndex: false, autoCreate: false, monitorCommands: true })
  await AuditLog.createCollection()
  for (const model of [RuntimeInstance, Customer, Tenant, LicenseLevel, Role]) await model.createCollection()
  for (const name of ['runtime_evidence_sources', 'runtime_acquisition_runs']) await mongoose.connection.db.createCollection(name)
  await RuntimeEvidenceSource.createIndexes()
  await RuntimeAcquisitionRun.createIndexes()
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  for (const name of ['runtime_evidence_sources', 'runtime_acquisition_runs', AuditLog.collection.name]) await collection(name).deleteMany({})
  for (const model of [RuntimeInstance, Customer, Tenant, LicenseLevel, Role]) await model.collection.deleteMany({})
}, 15000)
const read = async () => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' }, maxCommitTimeMS: 2000 })
    const result = await readSourceProcessingSummary({ control, sourceFilter, session,
    deadline: Date.now() + 6000, validateSources: rows => {
      expect(new Set(rows.map(row => row.sourceId)).size).toBe(rows.length)
      for (const row of rows) expect(row.stateVersion).toBe(control.stateVersion)
    } })
    await session.commitTransaction({ timeoutMS: 2000 })
    return result
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction({ timeoutMS: 2000 })
    throw error
  }
  finally { await session.endSession() }
}
const source = (sourceId, extra = {}) => ({ ...sourceFilter, runtimeInstanceKey: control.runtimeInstanceKey, sourceId, sourceType: 'UPLOADED_DOCUMENT',
  stateVersion: control.stateVersion, sourceStateVersion: control.stateVersion, ...extra })
const seed = async (sourceId = 'doc_1', count = 10) => {
  const run = { ...ids, runtimeInstanceKey: control.runtimeInstanceKey, runId: randomUUID(), requestKey: randomUUID(), active: false, executionAttemptId: randomUUID(),
    requestFingerprint: 'a'.repeat(64), status: 'SUCCEEDED', canonicalSaved: true,
    outputStateVersion: 'rsv2:historical-processing-output', outcomes: [{ kind: 'DOCUMENT', inputIndex: 0,
      status: 'SUCCEEDED', sourceId, contentHash: 'b'.repeat(64), evidenceObjectCount: count }] }
  const save = await auditService.log({ actorUserId: String(ids.actorUserId), action: 'RUNTIME_STATE_MUTATED',
    resourceType: 'RuntimeInstance', resourceId: ids.runtimeInstanceId,
    scope: { customerId: ids.customerId, tenantId: ids.tenantId }, diff: { stateVersion: run.outputStateVersion } }, { throwOnError: true })
  run.saveAuditId = save._id; run.saveAuditSignature = save.signature; run.saveAuditSignatureVersion = save.signatureVersion
  const terminal = await auditService.log({ actorUserId: String(ids.actorUserId), action: 'RUNTIME_ACQUISITION_RECORDED',
    resourceType: 'RuntimeInstance', resourceId: ids.runtimeInstanceId,
    scope: { customerId: ids.customerId, tenantId: ids.tenantId }, diff: { runId: run.runId,
      executionAttemptId: run.executionAttemptId, phase: run.status, requestFingerprint: run.requestFingerprint,
      outcomeHash: snapshotHash(run.outcomes), outputStateVersion: run.outputStateVersion, canonicalSaved: true,
      saveAuditId: String(save._id), saveAuditSignature: save.signature } }, { throwOnError: true })
  run.terminalAuditId = terminal._id; run.terminalAuditSignatureVersion = terminal.signatureVersion
  await collection('runtime_acquisition_runs').insertOne(run)
  await collection('runtime_evidence_sources').insertOne(source(sourceId, { contentHash: `sha256:${'b'.repeat(64)}`,
    processingReceipt: { contractVersion: 'document-processing-receipt.v1', runId: run.runId, inputIndex: 0,
      contentHash: `sha256:${'b'.repeat(64)}` } }))
  return run
}
test('two actual signed document receipts count unique sources rather than twenty evidence objects', async () => {
  await seed('doc_1'); await seed('doc_2')
  expect(await read()).toMatchObject({ uniqueSourceCount: 2, documentSourceCount: 2,
    documentsProcessed: 2, knownProcessedCount: 2, processingCompleteness: 'COMPLETE' })
})
test('zero-object success counts once and historical output remains valid for unchanged content', async () => {
  await seed('doc_zero', 0)
  expect(await read()).toMatchObject({ documentsProcessed: 1, stateVersion: control.stateVersion })
})
test('missing provenance qualifies unknown without inventing a processed zero', async () => {
  await collection('runtime_evidence_sources').insertOne(source('legacy'))
  expect(await read()).toMatchObject({ sourceCompleteness: 'COMPLETE', uniqueSourceCount: 1,
    documentsProcessed: null, unknownCount: 1, processingCompleteness: 'PARTIAL' })
})
test('changed content is stale, while unchanged successful receipt survives independent later failed attempt', async () => {
  await seed()
  await collection('runtime_acquisition_runs').insertOne({ ...ids, runId: randomUUID(), requestKey: randomUUID(), active: false, status: 'FAILED' })
  expect((await read()).documentsProcessed).toBe(1)
  await collection('runtime_evidence_sources').updateOne({ sourceId: 'doc_1' }, { $set: { contentHash: `sha256:${'c'.repeat(64)}` } })
  expect(await read()).toMatchObject({ documentsProcessed: 0, staleCount: 1, unknownCount: 0 })
})
test.each(['outcomes', 'requestFingerprint', 'executionAttemptId', 'outputStateVersion', 'actorUserId', 'runtimeInstanceId', 'terminalAuditSignatureVersion',
  'terminal-signature', 'save-signature', 'save-actor', 'missing-terminal', 'missing-save'])('tampered %s cannot count as processing proof', async key => {
  const run = await seed()
  if (key === 'terminal-signature') await AuditLog.collection.updateOne({ _id: run.terminalAuditId }, { $set: { signature: 'invalid' } })
  else if (key === 'save-signature') await AuditLog.collection.updateOne({ _id: run.saveAuditId }, { $set: { signature: 'invalid' } })
  else if (key === 'save-actor') await AuditLog.collection.updateOne({ _id: run.saveAuditId }, { $set: { actorUserId: new mongoose.Types.ObjectId() } })
  else if (key === 'missing-terminal') await AuditLog.collection.deleteOne({ _id: run.terminalAuditId })
  else if (key === 'missing-save') await AuditLog.collection.deleteOne({ _id: run.saveAuditId })
  else await collection('runtime_acquisition_runs').updateOne({ runId: run.runId }, { $set: {
    [key]: key === 'outcomes' ? [] : key === 'terminalAuditSignatureVersion' ? 2
      : key.endsWith('Id') && key !== 'executionAttemptId' ? new mongoose.Types.ObjectId() : 'tampered' } })
  expect(await read()).toMatchObject({ documentsProcessed: null, unknownCount: 1, knownProcessedCount: 0 })
})
test('whole scoped population includes off-page sources and excludes foreign tenant', async () => {
  await collection('runtime_evidence_sources').insertMany(Array.from({ length: 31 }, (_, i) => source(`doc_${i}`)))
  await collection('runtime_evidence_sources').insertOne(source('foreign', { tenantId: new mongoose.Types.ObjectId() }))
  expect(await read()).toMatchObject({ uniqueSourceCount: 31, documentSourceCount: 31, unknownCount: 31 })
})
test.each([{ sourceId: { malformed: true } }, { sourceId: ' padded ' }, { sourceType: '__proto__' },
  { runtimeInstanceKey: 'wrong-runtime' }])('malformed native source identity %j fails closed', async extra => {
  await collection('runtime_evidence_sources').insertOne(source('doc', extra))
  await expect(read()).rejects.toMatchObject({ status: 503, details: { reason: 'SOURCE_SUMMARY_IDENTITY_INVALID' } })
})
test('matching runtime key cannot admit a contradictory runtime ID in production legacy-compatible filter', async () => {
  const scopes = await authorizedFixture()
  await collection('runtime_evidence_sources').insertOne(source('doc', { runtimeInstanceId: new mongoose.Types.ObjectId() }))
  await expect(getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({
    status: 503, details: { reason: 'SOURCE_SUMMARY_IDENTITY_INVALID' } })
})
test('source cap returns partial before source hydration', async () => {
  await collection('runtime_evidence_sources').insertMany(Array.from({ length: 1001 }, (_, i) => source(`doc_${i}`)))
  const spy = jest.spyOn(mongoose.mongo.Collection.prototype, 'find')
  expect(await read()).toMatchObject({ uniqueSourceCount: null, documentsProcessed: null,
    reasons: { SOURCE_COUNT_CAP_EXCEEDED: 1 } })
  expect(spy).not.toHaveBeenCalled()
})
test('oversized stored source pointer fails before source hydration', async () => {
  await collection('runtime_evidence_sources').insertOne(source('oversized', { processingReceipt: { blob: 'x'.repeat(530000) } }))
  const spy = jest.spyOn(mongoose.mongo.Collection.prototype, 'find')
  await expect(read()).rejects.toMatchObject({ details: { reason: 'SOURCE_SUMMARY_READ_CAP_EXCEEDED' } })
  expect(spy).not.toHaveBeenCalled()
})
test('oversized signed-terminal family keeps complete source totals but fetches no terminal audit', async () => {
  const run = await seed()
  await AuditLog.collection.updateOne({ _id: run.terminalAuditId }, { $set: { before: { blob: 'x'.repeat(530000) } } })
  const spy = jest.spyOn(mongoose.mongo.Collection.prototype, 'find')
  expect(await read()).toMatchObject({ uniqueSourceCount: 1, documentsProcessed: null,
    processingCompleteness: 'UNAVAILABLE', reasons: { PROOF_READ_CAP_EXCEEDED: 1 } })
  expect(spy.mock.instances.filter(item => item.collectionName === AuditLog.collection.name)).toHaveLength(0)
})

test.each([500, 1000])('%i individually referenced Runs cannot expand the cumulative read allowance', async population => {
  const docs = [], runs = []
  for (let i = 0; i < population; i++) {
    const runId = randomUUID(), contentHash = `sha256:${'b'.repeat(64)}`
    docs.push(source(`doc_${i}`, { contentHash, processingReceipt: {
      contractVersion: 'document-processing-receipt.v1', runId, contentHash, inputIndex: 0 } }))
    runs.push({ ...ids, runtimeInstanceKey: control.runtimeInstanceKey, runId, requestKey: randomUUID(), active: false, executionAttemptId: randomUUID(),
      actorUserId: ids.actorUserId, requestFingerprint: 'a'.repeat(64), status: 'SUCCEEDED', canonicalSaved: true,
      outputStateVersion: 'rsv2:actual-output', outcomes: [{ kind: 'DOCUMENT', inputIndex: 0, status: 'SUCCEEDED',
        sourceId: `doc_${i}`, contentHash: 'b'.repeat(64), evidenceObjectCount: 0 }] })
  }
  await collection('runtime_evidence_sources').insertMany(docs)
  await collection('runtime_acquisition_runs').insertMany(runs)
  const spy = jest.spyOn(mongoose.mongo.Collection.prototype, 'find')
  if (population === 1000) await expect(read()).rejects.toMatchObject({ status: 503,
    details: { reason: 'SOURCE_SUMMARY_READ_CAP_EXCEEDED' } })
  else expect(await read()).toMatchObject({ uniqueSourceCount: population, documentSourceCount: population,
    documentsProcessed: null, unknownCount: population, reasons: { PROOF_READ_CAP_EXCEEDED: population } })
  expect(spy.mock.instances.filter(item => item.collectionName === 'runtime_acquisition_runs')).toHaveLength(0)
})

const authorizedFixture = async () => {
  const licenseId = new mongoose.Types.ObjectId()
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceKey: control.runtimeInstanceKey, runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE',
    stateVersion: control.stateVersion, updatedAt: new Date() })
  await Customer.collection.insertOne({ _id: ids.customerId, topology: 'SINGLE_TENANT', licenseLevelId: licenseId, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenantId, customerId: ids.customerId })
  await LicenseLevel.collection.insertOne({ _id: licenseId, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', isActive: true, permissions: ['VMF_VIEW'] })
  return { customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) },
    resolvedPermissions: { customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW'] }] } }
}
test('production wrapper uses actual scoped permission/licence metadata inside one bounded snapshot', async () => {
  const scopes = await authorizedFixture()
  await seed()
  const spies = [RuntimeInstance, Customer, Tenant, LicenseLevel].map(model => jest.spyOn(model.collection, 'findOne'))
  expect(await getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).toMatchObject({ documentsProcessed: 1 })
  for (const spy of spies) {
    expect(spy).toHaveBeenCalled()
    for (const [, options] of spy.mock.calls) { expect(options.maxTimeMS).toBeLessThanOrEqual(2000); expect(options.session).toBeTruthy() }
  }
})

test('production native metadata and signed proof reads keep each wire budget within two seconds', async () => {
  const scopes = await authorizedFixture()
  await seed()
  const commands = [], listener = event => commands.push(event.command)
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  let result
  try { result = await getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey }) }
  finally { client.off('commandStarted', listener) }
  expect(result).toMatchObject({ documentsProcessed: 1, readReceipt: { workTimeoutMS: 5500, cleanupReserveMS: 500 } })
  const reads = commands.filter(command => command.find || command.aggregate)
  const sessionId = JSON.stringify(reads[0].lsid)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0)
    expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false)
    expect(JSON.stringify(command.lsid)).toBe(sessionId)
    expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  for (const name of [RuntimeInstance, Customer, Tenant, LicenseLevel, Role].map(model => model.collection.name))
    expect(reads.some(command => command.find === name)).toBe(true)
  for (const name of ['runtime_evidence_sources', 'runtime_acquisition_runs', AuditLog.collection.name]) {
    expect(reads.some(command => command.aggregate === name)).toBe(true)
    expect(reads.some(command => command.find === name)).toBe(true)
  }
  expect(commands.some(command => command.getMore)).toBe(false)
  expect(commands.some(command => command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
})

test('expired work budget schedules no later metadata or signed-proof reads', async () => {
  const scopes = await authorizedFixture()
  await seed()
  const now = Date.now(), commands = []
  const listener = event => {
    commands.push(event.command)
    if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000)
  }
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  try { await expect(getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})

test.each(['commitTransaction', 'abortTransaction'])('native %s failure returns safe unavailable without fabricated source counts', async failedCommand => {
  const scopes = await authorizedFixture()
  await seed()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(scopes)).get(`/${control.runtimeInstanceKey}/state/source-summary`).query(queryScope)
  expect(response.status).toBe(503)
  expect(response.body.data).toBeUndefined()
  expect(JSON.stringify(response.body)).not.toMatch(/canonicalSaved|executionAttemptId|saveAuditSignature/)
})
test('production wrapper rejects denied permission and wrong tenant before summary hydration', async () => {
  const scopes = await authorizedFixture()
  scopes.resolvedPermissions = {}
  await expect(getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({ status: 403 })
  // Existing fixture stays intact; only the request tenant changes.
  const wrong = { ...scopes, resolvedPermissions: {
    customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW'] }] },
    tenant: { _id: String(new mongoose.Types.ObjectId()), customerId: String(ids.customerId) } }
  await expect(getRuntimeStateSourceSummary({ scopes: wrong, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({ status: 404 })
})

test.each(['SINGLE_TENANT', 'MULTI_TENANT'].flatMap(topology =>
  ['missing', 'inactive', 'revoked', 'empty-roleKeys'].map(reason => [topology, reason])))('%s current %s customer role denies before source/proof hydration', async (topology, reason) => {
  const scopes = await authorizedFixture()
  await seed()
  await Customer.collection.updateOne({}, { $set: { topology } })
  if (reason === 'missing') await Role.collection.deleteMany({})
  if (reason === 'inactive') await Role.collection.updateOne({}, { $set: { isActive: false } })
  if (reason === 'revoked') await Role.collection.updateOne({}, { $set: { permissions: [] } })
  if (reason === 'empty-roleKeys') scopes.resolvedPermissions.customers[0].roleKeys = []
  const commands = [], listener = event => commands.push(event.command)
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  let response
  try { response = await request(mounted(scopes)).get(`/${control.runtimeInstanceKey}/state/source-summary`).query(queryScope) }
  finally { client.off('commandStarted', listener) }
  expect(response.status).toBe(403)
  expect(response.body.data).toBeUndefined()
  expect(commands.some(command => ['runtime_evidence_sources', 'runtime_acquisition_runs', AuditLog.collection.name]
    .includes(command.find || command.aggregate))).toBe(false)
})

test('rejected current Role query cannot become a topology fallback grant', async () => {
  const scopes = await authorizedFixture()
  jest.spyOn(Role.collection, 'find').mockRejectedValue(new Error('Private role dependency failure'))
  const response = await request(mounted(scopes)).get(`/${control.runtimeInstanceKey}/state/source-summary`).query(queryScope)
  expect(response.status).toBe(503)
  expect(response.body.data).toBeUndefined()
  expect(JSON.stringify(response.body)).not.toMatch(/Private role/)
})
test('native query deadline failure becomes unavailable rather than empty or partial success', async () => {
  const scopes = await authorizedFixture()
  await collection('runtime_evidence_sources').insertOne(source('legacy'))
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['aggregate'], errorCode: 50 } })
  const began = Date.now()
  await expect(getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({ status: 503 })
  expect(Date.now() - began).toBeLessThan(6500)
}, 12000)

test('native stalled proof response cannot exceed its operation budget or return fabricated completeness', async () => {
  const scopes = await authorizedFixture()
  await collection('runtime_evidence_sources').insertOne(source('legacy'))
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['aggregate'], blockConnection: true, blockTimeMS: 7500 } })
  const began = Date.now()
  await expect(getRuntimeStateSourceSummary({ scopes, runtimeInstanceId: control.runtimeInstanceKey })).rejects.toMatchObject({ status: 503 })
  expect(Date.now() - began).toBeLessThan(3500)
}, 12000)

const mounted = scopes => {
  const app = express()
  app.use((req, _res, next) => { req.scopes = scopes; req.requestId = 'ss042-summary-isolated'; next() })
  app.get('/:runtimeInstanceId/state/source-summary', validateRuntimeInstanceId, validateReviewCompletionScope, summaryController)
  app.use((error, _req, res, _next) => res.status(500).json({ error: { message: error.message } }))
  return app
}
const queryScope = { customerId: String(ids.customerId), tenantId: String(ids.tenantId) }
test('mounted actual summary controller returns native proof and rejects malformed or denied scope', async () => {
  const scopes = await authorizedFixture()
  await seed()
  const app = mounted(scopes), path = `/${control.runtimeInstanceKey}/state/source-summary`
  expect((await request(app).get(path).query(queryScope)).body.data.documentsProcessed).toBe(1)
  expect((await request(app).get(path).query({ ...queryScope, search: 'unsupported' })).status).toBe(422)
  scopes.resolvedPermissions = {}
  const denied = await request(app).get(path).query(queryScope)
  expect(denied.status).toBe(403); expect(denied.body.data).toBeUndefined()
})
test.each([Customer, Tenant, LicenseLevel])('mounted rejected %s dependency is unavailable rather than empty success', async model => {
  const scopes = await authorizedFixture()
  jest.spyOn(model.collection, 'findOne').mockRejectedValue(new Error('Synthetic scoped metadata failure'))
  const response = await request(mounted(scopes)).get(`/${control.runtimeInstanceKey}/state/source-summary`).query(queryScope)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
})
test('bounded projection commands and existing scoped indexes are exercised without full runtime save payloads', async () => {
  await seed()
  const find = jest.spyOn(mongoose.mongo.Collection.prototype, 'find')
  const aggregate = jest.spyOn(mongoose.mongo.Collection.prototype, 'aggregate')
  await read()
  expect(aggregate).toHaveBeenCalledTimes(4); expect(find).toHaveBeenCalledTimes(4)
  for (const [, options] of aggregate.mock.calls) { expect(options.session).toBeTruthy(); expect(options.maxTimeMS).toBeLessThanOrEqual(2000) }
  for (const [, options] of find.mock.calls) { expect(options.batchSize).toBe(1001); expect(options.session).toBeTruthy() }
  const saveProjection = find.mock.calls.find(([filter, options]) => options.projection?.signature && filter._id)?.[1].projection
  expect(Object.keys(saveProjection).sort()).toEqual(['_id', 'action', 'actorUserId', 'resourceId', 'signature', 'signatureVersion'])
  const sourcePlan = await collection('runtime_evidence_sources').find(sourceFilter).explain('executionStats')
  expect(JSON.stringify(sourcePlan.queryPlanner.winningPlan)).toContain('IXSCAN')
  const runPlan = await collection('runtime_acquisition_runs').find({ ...ids, runId: { $exists: true } }).explain('executionStats')
  expect(JSON.stringify(runPlan.queryPlanner.winningPlan)).toContain('IXSCAN')
})
