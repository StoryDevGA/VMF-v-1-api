import { beforeAll, afterAll, beforeEach, test, expect, jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import express from 'express'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeReviewCompletion from '../models/RuntimeReviewCompletion.js'
import AuditLog from '../models/AuditLog.js'
import { Customer, Tenant, LicenseLevel, Role } from '../models/index.js'
import { getReviewCompletion, completeReview } from '../services/reviewCompletionService.js'
import { readReviewCompletion } from '../controllers/reviewCompletion.controller.js'
import { validateRuntimeInstanceId } from '../validators/runtimeInstance.validator.js'
import { validateReviewCompletionScope } from '../validators/reviewCompletion.validator.js'

let replica
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'actorUserId'].map(key => [key, new mongoose.Types.ObjectId()]))
const key = 'ss042-review-native-read', version = 'rsv2:review-native-read'
const collections = ['runtime_evidence_objects', 'runtime_evidence_sources']
const models = [RuntimeInstance, RuntimeReviewCompletion, AuditLog, Customer, Tenant, LicenseLevel, Role]
const collection = name => mongoose.connection.db.collection(name)
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  await mongoose.connect(replica.getUri('ss042_review_read_' + randomUUID().replaceAll('-', '')), { autoIndex: false, autoCreate: false, monitorCommands: true })
  for (const model of models) await model.createCollection()
  for (const name of collections) await mongoose.connection.db.createCollection(name)
  await RuntimeReviewCompletion.createIndexes()
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  for (const model of models) await model.collection.deleteMany({})
  for (const name of collections) await collection(name).deleteMany({})
}, 15000)
const seed = async (count = 160, pending = 1) => {
  const licence = new mongoose.Types.ObjectId(), migrationReceiptId = new mongoose.Types.ObjectId()
  const current = { customerId: ids.customerId, tenantId: ids.tenantId, runtimeInstanceId: ids.runtimeInstanceId,
    runtimeInstanceKey: key, stateVersion: version, sourceStateVersion: version, sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId, current: true }
  const time = '2026-10-06T10:00:00.000Z'
  const decisions = Array.from({ length: count }, (_, index) => ({ evidenceObjectId: 'e' + String(index).padStart(4, '0'),
    sourceId: 'source-one', reviewStatus: index < pending ? 'PENDING' : 'ACCEPTED', acceptedBy: String(ids.actorUserId), acceptanceTimestamp: time }))
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceKey: key, runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE', stateVersion: version, updatedAt: new Date(time),
    framework_state: { evidence_pack: { evidenceObjects: decisions, sourceRegistry: [{ sourceId: 'source-one' }],
      evidenceReady: true, contradictionReviewEpoch: '', contradictionReviews: [], discoveryHealth: { contradictionCandidates: [] } } } })
  await Customer.collection.insertOne({ _id: ids.customerId, topology: 'SINGLE_TENANT', licenseLevelId: licence, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenantId, customerId: ids.customerId })
  await LicenseLevel.collection.insertOne({ _id: licence, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', isActive: true, permissions: ['VMF_VIEW', 'VMF_UPDATE'] })
  await collection(collections[1]).insertOne({ ...current, sourceId: 'source-one', sourceType: 'UPLOADED_DOCUMENT' })
  if (count) await collection(collections[0]).insertMany(decisions.map(row => ({ ...current, ...row, sourceType: 'UPLOADED_DOCUMENT', extractedFact: 'Private stored fact' })))
  return { actorUserId: String(ids.actorUserId), runtimeInstanceId: key, scopes: {
    customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) },
    resolvedPermissions: { customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW', 'VMF_UPDATE'] }] } } }
}
const mounted = args => {
  const app = express()
  app.use((req, _res, next) => { req.scopes = args.scopes; req.userId = args.actorUserId; req.requestId = 'ss042-isolated-native-review'; next() })
  app.get('/:runtimeInstanceId/review-completion', validateRuntimeInstanceId, validateReviewCompletionScope, readReviewCompletion)
  app.use((_error, _req, res, _next) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE' } }))
  return app
}
const path = `/${key}/review-completion`
const scopeQuery = { customerId: String(ids.customerId), tenantId: String(ids.tenantId) }

test('native multi-page review read budgets actual metadata, population and receipt history in one snapshot', async () => {
  const args = await seed()
  const commands = [], listener = event => commands.push(event.command)
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  let value
  try { value = await getReviewCompletion(args) }
  finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ currency: 'AS_READ', stateVersion: version, latestReceipt: null, canComplete: false,
    population: { completeness: 'COMPLETE', target: null, policy: 'revision-evidence-contradiction-decisions.v1', evidenceCount: 160,
      sourceCount: 1, pendingEvidence: 1, pendingFindings: 0, decisionCount: 160, complete: false },
    readReceipt: { maxTimeMS: 2000, workTimeoutMS: 5500, cleanupReserveMS: 500, fullLegacyFrameworkStateFetched: false } })
  expect(Date.parse(value.readAt)).not.toBeNaN()
  const reads = commands.filter(command => command.find || command.aggregate)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false)
    expect(JSON.stringify(command.lsid)).toBe(JSON.stringify(reads[0].lsid)); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  for (const name of [RuntimeInstance, Role, Customer, Tenant, LicenseLevel, RuntimeReviewCompletion].map(model => model.collection.name))
    expect(reads.some(command => command.find === name)).toBe(true)
  const pages = reads.filter(command => command.find === collections[0])
  expect(pages).toHaveLength(4)
  for (const command of pages) { expect(command.limit).toBe(150); expect(command.batchSize).toBe(150) }
  const history = reads.find(command => command.find === RuntimeReviewCompletion.collection.name)
  expect(history.limit).toBe(26)
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
  for (const command of reads.filter(command => command.find === RuntimeInstance.collection.name)) expect(command.projection.framework_state).toBeUndefined()
  expect(JSON.stringify(value)).not.toMatch(/Private stored fact|acceptedBy|extractedFact/)
})

test('real recorded receipt remains individually current or stale independently from AS_READ inventory currency', async () => {
  const args = await seed(2, 0), basis = await getReviewCompletion(args)
  expect(basis.canComplete).toBe(true)
  const payload = { requestKey: randomUUID(), expectedPopulationHash: basis.population.hash, rationale: 'Complete the isolated verified decision population.', confirm: true }
  const saved = await completeReview({ ...args, payload })
  const current = await getReviewCompletion(args)
  expect(current).toMatchObject({ currency: 'AS_READ', latestReceipt: { receiptId: saved.receipt.receiptId, currency: 'CURRENT' } })
  await collection(collections[0]).updateOne({ evidenceObjectId: 'e0000' }, { $set: { reviewStatus: 'PENDING' } })
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.evidenceObjects.0.reviewStatus': 'PENDING' } })
  expect(await getReviewCompletion(args)).toMatchObject({ currency: 'AS_READ', latestReceipt: { currency: 'STALE' }, population: { pendingEvidence: 1 }, canComplete: false })
})

test('view permission without update authority and locked truth both keep inspection available without completion', async () => {
  const args = await seed(2, 0)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  expect(await getReviewCompletion(args)).toMatchObject({ canComplete: false, population: { complete: true } })
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW', 'VMF_UPDATE'] } })
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt: new Date() } })
  expect(await getReviewCompletion(args)).toMatchObject({ canComplete: false, population: { complete: true } })
})

test('native role, licence and wrong tenant deny mounted review reads before any population response', async () => {
  const args = await seed(2)
  const app = mounted(args)
  expect((await request(app).get(path).query({ ...scopeQuery, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  expect((await request(app).get(path).query(scopeQuery)).status).toBe(403)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW', 'VMF_UPDATE'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  const denied = await request(app).get(path).query(scopeQuery)
  expect(denied.status).toBe(403); expect(denied.body.data).toBeUndefined()
})

test.each([Customer, Tenant, LicenseLevel])('native rejected %s dependency returns unavailable without private failure data', async model => {
  const args = await seed(2)
  jest.spyOn(model.collection, 'findOne').mockRejectedValue(new Error('Private review metadata failure'))
  const result = await request(mounted(args)).get(path).query(scopeQuery)
  expect(result.status).toBe(503); expect(result.body.data).toBeUndefined()
  expect(JSON.stringify(result.body)).not.toMatch(/Private review/)
})

test('expired work budget cannot schedule further metadata or population queries', async () => {
  const args = await seed(2), now = Date.now(), commands = []
  const listener = event => { commands.push(event.command); if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000) }
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  try { await expect(getReviewCompletion(args)).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})

test('native stalled response fails within its operation budget without fabricated population or receipt', async () => {
  const args = await seed(2)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const began = Date.now(), result = await request(mounted(args)).get(path).query(scopeQuery)
  expect(result.status).toBe(503); expect(result.body.data).toBeUndefined()
  expect(Date.now() - began).toBeLessThan(3500)
}, 15000)

test.each(['commitTransaction', 'abortTransaction'])('native %s failure cannot return a verified review population', async failedCommand => {
  const args = await seed(2)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const result = await request(mounted(args)).get(path).query(scopeQuery)
  expect(result.status).toBe(503); expect(result.body.data).toBeUndefined()
})
