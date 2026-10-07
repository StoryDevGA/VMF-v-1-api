import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals'
import { randomUUID, createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeAcquisitionRun from '../models/RuntimeAcquisitionRun.js'
import AuditLog from '../models/AuditLog.js'
import { Customer, Tenant, LicenseLevel, Role } from '../models/index.js'
import { assertRuntimePermission } from '../services/runtimeInstanceService.js'
import auditService from '../services/auditService.js'
import { ingestUploadedDocumentDiscoveryEvidence, acquireWebsiteDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'
import { lookupAcquisitionRequest, startAcquisitionRun, executeAcquisitionBuild, withAcquisitionTransaction,
  recordAcquisitionTerminal, readCommittedAcquisition, handleAcquisitionFailure,
  acquisitionRequestFingerprint, publicAcquisitionRun, buildAcquisitionRunOutcomes, getAcquisitionRun } from '../services/acquisitionRunService.js'

const ids = Object.fromEntries(['customerId', 'tenantId', '_id', 'actorUserId'].map(key => [key, new mongoose.Types.ObjectId()]))
const scope = { customerId: ids.customerId, tenantId: ids.tenantId, runtimeInstanceId: ids._id }
const inputs = { companyWebsite: 'https://example.org/', companyName: 'Synthetic acquisition proof', marketRegion: 'Synthetic region', targetOffer: 'Synthetic service' }
let replica
const models = [RuntimeInstance, RuntimeAcquisitionRun, AuditLog, Customer, Tenant, LicenseLevel, Role]
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  const name = `ss042_acquisition_${randomUUID().replaceAll('-', '')}`
  const uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Fresh isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (mongoose.connection.name !== name || (await mongoose.connection.db.listCollections().toArray()).length)
    throw new Error('Fresh empty isolated database required')
  for (const model of models) await model.createCollection()
  await RuntimeAcquisitionRun.createIndexes()
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks(); jest.useRealTimers()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  for (const model of models) await model.collection.deleteMany({})
})
const fixture = async () => {
  const runtime = { ...ids, runtimeInstanceKey: 'ss042-run-isolated', runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE',
    executionStatus: 'IDLE', stateVersion: `rsv2:${randomUUID()}`, updatedAt: new Date(),
    framework_state: { lifecycle: { stage: 'DRAFT' }, evidence_pack: { acquisitionProfile: 'STANDARD' } } }
  const { actorUserId, ...stored } = runtime
  await RuntimeInstance.collection.insertOne(stored)
  return runtime
}
const invocation = (runtime, payload = {}, actionKey = 'SAVE_DISCOVERY_INPUTS') => lookupAcquisitionRequest({
  runtimeInstance: runtime, actorUserId: String(ids.actorUserId), actionKey,
  payload: { expectedUpdatedAt: runtime.updatedAt.toISOString(), inputs, requestKey: randomUUID(), ...payload },
})
const start = async (runtime, payload) => {
  const context = await invocation(runtime, payload)
  await startAcquisitionRun(context, context.payload.inputs || inputs)
  context.extractionSettled = true
  return context
}
const packFor = () => ({ inputComplete: true, evidenceObjects: [], lineage: { sources: [] }, acquisition: {
  websiteAcquisition: { latestAttempt: { items: [] } }, documentAcquisition: { latestAttempt: { items: [] } },
} })
const save = async (context, pack = packFor(context), { afterWrite, afterTerminal } = {}) => {
  const nextVersion = `rsv2:${randomUUID()}`
  context.rootPersistenceStarted = true
  await withAcquisitionTransaction(async session => {
    const update = await RuntimeInstance.collection.updateOne({ _id: ids._id, ...{ customerId: ids.customerId, tenantId: ids.tenantId },
      stateVersion: context.basisStateVersion }, { $set: { stateVersion: nextVersion } }, { session })
    if (update.modifiedCount !== 1) throw new Error('Synthetic root CAS rejected')
    if (afterWrite) await afterWrite(session)
    const audit = await auditService.log({ actorUserId: String(ids.actorUserId), action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance', resourceId: ids._id, scope,
      diff: { stateVersion: nextVersion, acquisitionRunId: context.runId } }, { session, throwOnError: true })
    await recordAcquisitionTerminal({ context, pack, outputStateVersion: nextVersion, saveAudit: audit, session })
    if (afterTerminal) await afterTerminal(session)
  }, context)
  return readCommittedAcquisition(context)
}

test('admission and start are real separately signed commits before extraction, with verified required indexes', async () => {
  const context = await start(await fixture())
  const row = await RuntimeAcquisitionRun.collection.findOne({ ...scope, runId: context.runId })
  expect(row.status).toBe('RUNNING'); expect(row.active).toBe(true)
  expect(row.executionAttemptId).toBe(context.executionAttemptId)
  expect(await AuditLog.countDocuments()).toBe(2)
  for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  await expect(RuntimeAcquisitionRun.updateOne({ runId: row.runId }, { $set: { status: 'FAILED' } })).rejects.toThrow('guarded service')
})
test('missing actual active index blocks admission without rows or audit', async () => {
  await RuntimeAcquisitionRun.collection.dropIndex('unique_active_acquisition_run')
  try {
    await expect(invocation(await fixture())).rejects.toMatchObject({ details: { reason: 'ACQUISITION_INDEX_REQUIRED' } })
    expect(await RuntimeAcquisitionRun.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(0)
  } finally { await RuntimeAcquisitionRun.createIndexes() }
})
test.each(['QUEUED', 'RUNNING'])('required %s audit failure rolls back its transition before extraction', async phase => {
  const runtime = await fixture(), context = await invocation(runtime)
  const original = auditService.log.bind(auditService)
  jest.spyOn(auditService, 'log').mockImplementation((payload, options) => {
    if (payload.diff?.phase === phase) throw new Error('Synthetic required audit failure')
    return original(payload, options)
  })
  await expect(startAcquisitionRun(context, inputs)).rejects.toThrow('Synthetic required audit failure')
  const rows = await RuntimeAcquisitionRun.find().lean()
  expect(rows.map(row => row.status)).toEqual(phase === 'QUEUED' ? [] : ['QUEUED'])
  expect(await AuditLog.countDocuments()).toBe(phase === 'QUEUED' ? 0 : 1)
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(runtime.stateVersion)
})
test('same-key race has one original invocation owner and only one executor', async () => {
  const runtime = await fixture(), payload = { requestKey: randomUUID() }
  const contexts = await Promise.all([invocation(runtime, payload), invocation(runtime, payload)])
  expect(contexts[0].executionAttemptId).not.toBe(contexts[1].executionAttemptId)
  const result = await Promise.allSettled(contexts.map(context => startAcquisitionRun(context, inputs)))
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(result.filter(item => item.status === 'rejected')).toHaveLength(1)
  expect(await RuntimeAcquisitionRun.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(2)
})
test('different-key active race and replay do not acquire another execution', async () => {
  const runtime = await fixture(), first = await start(runtime)
  const second = await invocation(runtime)
  await expect(startAcquisitionRun(second, inputs)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_RUN_IN_PROGRESS' } })
  await expect(invocation(runtime, first.payload)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_RUN_IN_PROGRESS', runId: first.runId } })
  expect(await RuntimeAcquisitionRun.countDocuments()).toBe(1)
})
test.each(['SAVE_DISCOVERY_INPUTS', 'BUILD_EVIDENCE_PACK'])('%s omitted-profile replay uses the original fingerprint after current defaults change', async actionKey => {
  const runtime = await fixture(), payload = { expectedUpdatedAt: runtime.updatedAt.toISOString(), requestKey: randomUUID(), inputs }
  const context = await lookupAcquisitionRequest({ runtimeInstance: runtime, payload, actionKey, actorUserId: String(ids.actorUserId) })
  await startAcquisitionRun(context, inputs); context.extractionSettled = true
  const receipt = await save(context)
  const changed = { ...runtime, stateVersion: `rsv2:${randomUUID()}`, updatedAt: new Date(Date.now() + 1000),
    framework_state: { evidence_pack: { acquisitionProfile: 'ENHANCED', inputs: { companyName: 'Different current brief' } } } }
  const replay = await lookupAcquisitionRequest({ runtimeInstance: changed, payload, actionKey, actorUserId: String(ids.actorUserId) })
  expect(replay.replay.runId).toBe(receipt.runId); expect(replay.replay.acquisitionProfile).toBe('STANDARD')
  expect(replay.replay).toMatchObject({ replay: true, requiresRefresh: true })
  await expect(lookupAcquisitionRequest({ runtimeInstance: changed, payload: { ...payload, acquisitionProfile: 'STANDARD' }, actionKey,
    actorUserId: String(ids.actorUserId) })).rejects.toMatchObject({ details: { reason: 'ACQUISITION_REQUEST_CONFLICT' } })
})
test('receipt and signed save audit commit with root, and replay is bounded without input hashes or originals', async () => {
  const runtime = await fixture(), context = await start(runtime)
  const receipt = await save(context)
  expect(receipt).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true, runId: context.runId })
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(receipt.outputStateVersion)
  expect(await AuditLog.countDocuments()).toBe(4)
  expect(JSON.stringify(receipt)).not.toMatch(/Fingerprint|contentHash|example.org|Synthetic service|executionAttemptId/)
  const replay = await invocation(runtime, context.payload)
  expect(replay.replay.runId).toBe(context.runId)
})
test('terminal audit failure rolls back root and terminal Run; acknowledged abort permits a separate Failed receipt', async () => {
  const runtime = await fixture(), context = await start(runtime), original = auditService.log.bind(auditService)
  jest.spyOn(auditService, 'log').mockImplementation((payload, options) => {
    if (payload.diff?.phase === 'SUCCEEDED') throw new Error('Synthetic terminal audit failure')
    return original(payload, options)
  })
  let failure
  try { await save(context) } catch (error) { failure = error }
  expect(context.transaction).toEqual({ commitPossible: false, abortConfirmed: true })
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(runtime.stateVersion)
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).status).toBe('RUNNING')
  expect(await AuditLog.countDocuments()).toBe(2)
  await expect(handleAcquisitionFailure(context, failure, packFor(context))).rejects.toMatchObject({ details: {
    acquisitionRun: { status: 'FAILED', canonicalSaved: false } } })
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).active).toBe(false)
})
test('unacknowledged abort keeps active Running even when native driver state became aborted', async () => {
  const runtime = await fixture(), context = await start(runtime)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['abortTransaction'], errorCode: 2 } })
  let failure
  try { await save(context, packFor(context), { afterWrite: () => { throw new Error('Synthetic rejected save') } }) } catch (error) { failure = error }
  expect(context.transaction.abortConfirmed).toBe(false)
  await expect(handleAcquisitionFailure(context, failure)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_OUTCOME_UNCONFIRMED' } })
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).active).toBe(true)
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(runtime.stateVersion)
})
test('expired native transaction CSOT cannot confirm raw abort and cannot release active Run', async () => {
  const runtime = await fixture(), context = await start(runtime)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['insert'], blockConnection: true, blockTimeMS: 7000 } })
  const begun = Date.now()
  let failure
  try { await save(context) } catch (error) { failure = error }
  expect(failure).toBeTruthy(); expect(Date.now() - begun).toBeGreaterThanOrEqual(5900)
  expect(Date.now() - begun).toBeLessThan(14000)
  expect(context.transaction.abortConfirmed).toBe(false)
  await expect(handleAcquisitionFailure(context, failure)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_OUTCOME_UNCONFIRMED' } })
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).status).toBe('RUNNING')
}, 20000)
test('verified committed result survives postcommit finalization/response failure without changing terminal state', async () => {
  const context = await start(await fixture()), receipt = await save(context)
  const recovered = await handleAcquisitionFailure(context, new Error('Synthetic postcommit graph failure'))
  expect(recovered.acquisitionRun).toMatchObject({ runId: receipt.runId, status: 'SUCCEEDED', canonicalSaved: true, requiresRefresh: true })
  expect(await AuditLog.countDocuments()).toBe(4)
})
test('known pre-save input failure and explicit unsuccessful predecessor remain scoped', async () => {
  const runtime = await fixture(), first = await start(runtime)
  const failure = Object.assign(new Error('Synthetic all failed'), { details: { acquisitionOutcomes: {
    contractVersion: 'acquisition-error-outcomes.v1', briefComplete: true, websiteItems: [], documentItems: [] } } })
  await expect(handleAcquisitionFailure(first, failure)).rejects.toMatchObject({ details: { acquisitionRun: { status: 'FAILED' } } })
  const retry = await start(runtime, { predecessorRunId: first.runId })
  expect(retry.row.predecessorRunId).toBe(first.runId)
})
test('request fingerprint detects changed content bytes, actor and basis but never reads current profile', () => {
  const payload = { inputs, expectedUpdatedAt: '2026-10-05T00:00:00.000Z', documentSources: [{ fileName: 'synthetic.txt', textContent: 'abc' }] }
  const args = { payload, actionKey: 'SAVE_DISCOVERY_INPUTS', actorUserId: String(ids.actorUserId) }
  const hash = acquisitionRequestFingerprint(args)
  expect(hash).not.toBe(acquisitionRequestFingerprint({ ...args, actorUserId: String(new mongoose.Types.ObjectId()) }))
  expect(hash).not.toBe(acquisitionRequestFingerprint({ ...args, payload: { ...payload, expectedUpdatedAt: '2026-10-05T00:00:00.001Z' } }))
  expect(hash).not.toBe(acquisitionRequestFingerprint({ ...args, payload: { ...payload, documentSources: [{ fileName: 'synthetic.txt', textContent: 'changed' }] } }))
})
test('late extraction after the600s caller guard never reaches save or turns Running into a guessed failure', async () => {
  const runtime = await fixture(), context = await start(runtime)
  context.extractionSettled = false
  let resolve, saves = 0
  const work = new Promise(done => { resolve = done })
  jest.useFakeTimers()
  const operation = (async () => { const pack = await executeAcquisitionBuild(context, () => work); saves += 1; return save(context, pack) })()
  const rejected = expect(operation).rejects.toMatchObject({ details: { reason: 'ACQUISITION_OUTCOME_UNCONFIRMED' } })
  await jest.advanceTimersByTimeAsync(600000); await rejected
  resolve(packFor(context)); await Promise.resolve(); await Promise.resolve()
  jest.useRealTimers()
  expect(saves).toBe(0); expect(context.extractionSettled).toBe(false)
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).status).toBe('RUNNING')
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(runtime.stateVersion)
})
test('actual zero-fact document receipt binds its byte hash and keeps execution distinct from sufficiency', async () => {
  const runtime = await fixture(), context = await start(runtime, { documentSources: [{ fileName: 'short.txt', textContent: 'abc' }] })
  const documentHash = `sha256:${createHash('sha256').update('abc').digest('hex')}`
  const pack = packFor(context)
  const acquired = await ingestUploadedDocumentDiscoveryEvidence({ acquisitionProfile: 'STANDARD',
    capturedAt: new Date().toISOString(), documentSources: context.payload.documentSources, batchOutcomes: true })
  expect(acquired.evidenceObjects).toHaveLength(0)
  pack.acquisition.documentAcquisition.latestAttempt.items = acquired.itemOutcomes
  pack.lineage.sources = acquired.sources
  const receipt = await save(context, pack)
  expect(receipt.status).toBe('SUCCEEDED')
  expect(receipt.outcomes[1]).toMatchObject({ kind: 'DOCUMENT', status: 'SUCCEEDED', evidenceObjectCount: 0 })
  const row = await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })
  expect(row.outcomes[1].contentHash).toBe(documentHash.slice(7))
  expect(publicAcquisitionRun(row).outcomes[1]).not.toHaveProperty('contentHash')
})

test.each(['missing', 'duplicate', 'extra', 'bad-count', 'drifted-count', 'missing-source', 'duplicate-source', 'wrong-hash', 'invalid-status', 'wrong-source-kind', 'wrong-source-hash'])('actual document outcome %s fails closed before root/save audit', async scenario => {
  const runtime = await fixture(), context = await start(runtime, { documentSources: [{ fileName: 'short.txt', textContent: 'abc' }] })
  const acquired = await ingestUploadedDocumentDiscoveryEvidence({ acquisitionProfile: 'STANDARD', capturedAt: new Date().toISOString(),
    documentSources: context.payload.documentSources, batchOutcomes: true })
  const pack = packFor()
  pack.lineage.sources = acquired.sources
  pack.acquisition.documentAcquisition.latestAttempt.items = acquired.itemOutcomes
  const items = pack.acquisition.documentAcquisition.latestAttempt.items
  if (scenario === 'missing') items.pop()
  if (scenario === 'duplicate') items.push({ ...items[0] })
  if (scenario === 'extra') items.push({ ...items[0], inputIndex: 1 })
  if (scenario === 'bad-count') items[0].evidenceObjectCount = 1.5
  if (scenario === 'drifted-count') items[0].evidenceObjectCount = 999
  if (scenario === 'missing-source') pack.lineage.sources = []
  if (scenario === 'duplicate-source') pack.lineage.sources.push({ ...pack.lineage.sources[0] })
  if (scenario === 'wrong-hash') items[0].documentHash = `sha256:${'f'.repeat(64)}`
  if (scenario === 'invalid-status') items[0].status = 'ACQUIRED'
  if (scenario === 'wrong-source-kind') pack.lineage.sources[0].sourceType = 'WEBSITE'
  if (scenario === 'wrong-source-hash') pack.lineage.sources[0].valueHash = `sha256:${'f'.repeat(64)}`
  await expect(save(context, pack)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_OUTCOME_INVALID' } })
  expect((await RuntimeInstance.collection.findOne({ _id: ids._id })).stateVersion).toBe(runtime.stateVersion)
  expect(await AuditLog.countDocuments()).toBe(2)
  expect((await RuntimeAcquisitionRun.collection.findOne({ runId: context.runId })).status).toBe('RUNNING')
})

test('failed actual document input remains zero-count, and a suppressed website is explicitly unattempted', async () => {
  const context = await start(await fixture(), { inputs: { ...inputs, companyName: '', websiteSources: ['https://example.org/'] },
    documentSources: [{ fileName: 'blank.txt', textContent: ' ' }] })
  const acquired = await ingestUploadedDocumentDiscoveryEvidence({ acquisitionProfile: 'STANDARD', capturedAt: new Date().toISOString(),
    documentSources: context.payload.documentSources, batchOutcomes: true })
  const pack = packFor(); pack.inputComplete = false
  pack.acquisition.documentAcquisition.latestAttempt.items = acquired.itemOutcomes
  expect(buildAcquisitionRunOutcomes(context, pack)).toMatchObject([
    { kind: 'BRIEF', status: 'FAILED' }, { kind: 'WEBSITE', status: 'UNATTEMPTED' },
    { kind: 'DOCUMENT', status: 'FAILED', evidenceObjectCount: 0 },
  ])
})

test.each(['corrupt', 'other-scope', 'successful'])('retry predecessor %s cannot establish execution lineage', async scenario => {
  const runtime = await fixture(), first = await start(runtime)
  if (scenario === 'successful') await save(first)
  else {
    await expect(handleAcquisitionFailure(first, new Error('Synthetic extraction failure'))).rejects.toThrow('Synthetic extraction failure')
    if (scenario === 'corrupt') await RuntimeAcquisitionRun.collection.updateOne({ runId: first.runId }, { $set: { outcomes: [] } })
    if (scenario === 'other-scope') await RuntimeAcquisitionRun.collection.updateOne({ runId: first.runId }, { $set: { tenantId: new mongoose.Types.ObjectId() } })
  }
  const current = await RuntimeInstance.findById(ids._id).lean()
  const context = await invocation(current, { predecessorRunId: first.runId })
  await expect(startAcquisitionRun(context, inputs)).rejects.toMatchObject({ details: {
    reason: scenario === 'corrupt' ? 'ACQUISITION_RECEIPT_UNVERIFIED' : 'ACQUISITION_PREDECESSOR_INVALID',
  } })
  expect(await RuntimeAcquisitionRun.countDocuments()).toBe(1)
})

test.each(['valid', 'wrong-url', 'wrong-kind', 'drifted-count', 'duplicate-evidence'])('actual website producer %s binds exact provenance and contributions', async scenario => {
  const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
  try {
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, url: 'https://example.org/',
      headers: { get: key => key === 'content-type' ? 'text/html' : null },
      text: async () => '<html><p>The synthetic company provides workflow monitoring services to customers in the United Kingdom.</p></html>' }))
    const runtime = await fixture(), context = await start(runtime, { inputs: { ...inputs, websiteSources: ['https://example.org/'] } })
    const acquired = await acquireWebsiteDiscoveryEvidence({ websiteUrl: 'https://example.org/', acquisitionProfile: 'STANDARD', acquiredAt: new Date().toISOString() })
    const pack = packFor(); pack.lineage.sources = [acquired.source]; pack.evidenceObjects = acquired.evidenceObjects
    pack.acquisition.websiteAcquisition.latestAttempt.items = [{ inputIndex: 0, status: 'SUCCEEDED', sourceId: acquired.source.sourceId,
      evidenceObjectCount: acquired.evidenceObjects.length }]
    if (scenario === 'wrong-url') acquired.source.url = 'https://other.example/'
    if (scenario === 'wrong-kind') acquired.source.sourceType = 'UPLOADED_DOCUMENT'
    if (scenario === 'drifted-count') pack.acquisition.websiteAcquisition.latestAttempt.items[0].evidenceObjectCount = 999
    if (scenario === 'duplicate-evidence') pack.evidenceObjects.push({ ...pack.evidenceObjects[0] })
    if (scenario === 'valid') expect((await save(context, pack)).status).toBe('SUCCEEDED')
    else {
      await expect(save(context, pack)).rejects.toMatchObject({ details: { reason: 'ACQUISITION_OUTCOME_INVALID' } })
      expect((await RuntimeInstance.findById(ids._id)).stateVersion).toBe(runtime.stateVersion)
      expect(await AuditLog.countDocuments()).toBe(2)
    }
  } finally { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns }
})

test('actual receipt metadata path caps runtime/customer/tenant/licence queries within its shared session budget', async () => {
  const context = await start(await fixture()), receipt = await save(context), licenseId = new mongoose.Types.ObjectId()
  await Customer.collection.insertOne({ _id: ids.customerId, topology: 'SINGLE_TENANT', licenseLevelId: licenseId, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenantId, customerId: ids.customerId })
  await LicenseLevel.collection.insertOne({ _id: licenseId, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  const spies = [RuntimeInstance, Customer, Tenant, LicenseLevel].map(model => jest.spyOn(model.collection, 'findOne'))
  const scopes = { customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) },
    resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'] } } }
  const detail = await getAcquisitionRun({ runtimeInstanceId: 'ss042-run-isolated', runId: receipt.runId, actorUserId: String(ids.actorUserId), scopes })
  expect(detail.runId).toBe(receipt.runId)
  for (const spy of spies) {
    expect(spy).toHaveBeenCalled()
    for (const [, options] of spy.mock.calls) { expect(options.maxTimeMS).toBeLessThanOrEqual(2000); expect(options.session).toBeTruthy() }
  }
})

test('actual customer-role authority lookup accepts the same optional bounded query cap', async () => {
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', isActive: true, permissions: ['VMF_VIEW'] })
  const spy = jest.spyOn(Role.collection, 'find')
  await assertRuntimePermission({ actorUserId: String(ids.actorUserId), customerId: String(ids.customerId), tenantId: String(ids.tenantId),
    permission: 'VMF_VIEW', maxTimeMS: 2000, scopes: { resolvedPermissions: {
      customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW'] }],
    } } })
  expect(spy).toHaveBeenCalled()
  expect(spy.mock.calls[0][1].maxTimeMS).toBe(2000)
})
