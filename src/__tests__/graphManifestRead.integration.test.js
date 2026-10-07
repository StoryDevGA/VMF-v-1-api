import { beforeAll, afterAll, beforeEach, test, expect, jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import express from 'express'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { Customer, Tenant, LicenseLevel, Role } from '../models/index.js'
import { getRuntimeStateGraphManifest, getRuntimeStateGraphProjection, getRuntimeStateGraphNeighbourhood, getRuntimeStateDiscoveryHealth, getRuntimeStateLockBasis, getRuntimeStateContradictionHistory, getRuntimeStateFindings } from '../services/runtimeStateRepository.js'
import { getRuntimeStateGraphManifest as controller, getRuntimeStateGraphNeighbourhood as neighbourhoodController, getRuntimeStateDiscoveryHealth as discoveryController, getRuntimeStateLockBasis as lockController, getRuntimeStateContradictionHistory as historyController, getRuntimeStateFindings as findingsController } from '../controllers/runtimeInstance.controller.js'
import { validateIntelligenceFindingQuery } from '../validators/intelligenceFinding.validator.js'
import { validateContradictionHistoryQuery } from '../validators/contradictionHistory.validator.js'
import { validateGraphNeighbourhoodQuery } from '../validators/graphNeighbourhood.validator.js'
import { validateRuntimeInstanceId } from '../validators/runtimeInstance.validator.js'
import { validateReviewCompletionScope } from '../validators/reviewCompletion.validator.js'
import { buildRuntimeIntelligenceGraphForFrameworkState } from '../services/runtimeIntelligenceGraphService.js'
import { createRuntimeStateLegacyRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildRuntimeActionTransition } from '../services/runtimeActionPolicyService.js'

let replica
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, new mongoose.Types.ObjectId()]))
const key = 'ss042-graph-manifest-native', version = 'rsv2:graph-manifest-native'
const models = [RuntimeInstance, Customer, Tenant, LicenseLevel, Role]
const graphs = () => mongoose.connection.db.collection('runtime_graph_snapshots')
const elements = () => mongoose.connection.db.collection('runtime_graph_elements')
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  await mongoose.connect(replica.getUri('ss042_graph_read_' + randomUUID().replaceAll('-', '')), { autoIndex: false, autoCreate: false, monitorCommands: true })
  for (const model of models) await model.createCollection()
  await mongoose.connection.db.createCollection('runtime_graph_snapshots')
  await mongoose.connection.db.createCollection('runtime_graph_elements')
  await mongoose.connection.db.createCollection('runtime_evidence_objects')
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  for (const model of models) await model.collection.deleteMany({})
  await graphs().deleteMany({})
  await elements().deleteMany({})
  await mongoose.connection.db.collection('runtime_evidence_objects').deleteMany({})
}, 15000)
const seed = async () => {
  const licence = new mongoose.Types.ObjectId()
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceKey: key, runtimeType: 'VALUE_NARRATIVE', stateVersion: version, status: 'ACTIVE',
    framework_state: { privateFact: 'Private full runtime truth' } })
  await Customer.collection.insertOne({ _id: ids.customerId, topology: 'SINGLE_TENANT', licenseLevelId: licence, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenantId, customerId: ids.customerId })
  await LicenseLevel.collection.insertOne({ _id: licence, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', isActive: true, permissions: ['VMF_VIEW'] })
  await graphs().insertOne({ ...ids, runtimeInstanceKey: key, snapshotId: 'graph-snapshot-one',
    stateVersion: version, sourceStateVersion: version, sourceHash: 'sha256:' + 'a'.repeat(64), graphHash: 'sha256:' + 'b'.repeat(64),
    graphVersion: '2.2', status: 'CURRENT', stateStatus: 'CURRENT', current: true, counts: { nodeCount: 1752, edgeCount: 2561 },
    metadata: { coverage: { coverageModel: 'EVIDENCE_DOMAIN_COVERAGE', coveredDomainCount: 7, totalDomainCount: 10, coveragePercent: 70 } } })
  return { runtimeInstanceId: key, scopes: { customer: { _id: String(ids.customerId) },
    tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) },
    resolvedPermissions: { customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW'] }] } } }
}
const mounted = args => {
  const app = express()
  app.use((req, _res, next) => { req.scopes = args.scopes; req.requestId = 'ss042-isolated-native-graph'; next() })
  app.get('/:runtimeInstanceId/state/graph-manifest', validateRuntimeInstanceId, validateReviewCompletionScope, controller)
  app.get('/:runtimeInstanceId/state/graph-neighbourhood', validateRuntimeInstanceId, validateGraphNeighbourhoodQuery, neighbourhoodController)
  app.get('/:runtimeInstanceId/state/discovery-health', validateRuntimeInstanceId, validateReviewCompletionScope, discoveryController)
  app.get('/:runtimeInstanceId/state/lock-basis', validateRuntimeInstanceId, validateReviewCompletionScope, lockController)
  app.get('/:runtimeInstanceId/state/contradiction-history', validateRuntimeInstanceId, validateContradictionHistoryQuery, historyController)
  app.get('/:runtimeInstanceId/state/findings', validateRuntimeInstanceId, validateIntelligenceFindingQuery, findingsController)
  app.use((_error, _req, res, _next) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE' } }))
  return app
}
const path = `/${key}/state/graph-manifest`
const query = { customerId: String(ids.customerId), tenantId: String(ids.tenantId) }

const findingsPath = `/${key}/state/findings`
const findingEvidence = () => mongoose.connection.db.collection('runtime_evidence_objects')
const seedFindings = async () => {
  const args = await seed(), candidates = Array.from({ length: 3 }, (_, i) => ({ contradictionId: `finding-${i}`, domain: `Domain${i}`,
    severity: 'LOW', basis: 'Existing deterministic detector', evidenceObjectIds: [`positive-${i}`, `negative-${i}`] }))
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack': {
    contradictionReviews: [], contradictionReviewEpoch: '', discoveryHealth: { contradictionCandidates: candidates },
    evidenceObjects: [{ privateRootFact: 'Root evidence must not be fetched' }] } } })
  const rows = candidates.flatMap((c, i) => c.evidenceObjectIds.map(id => ({ ...ids, runtimeInstanceKey: key,
    stateVersion: version, sourceStateVersion: version, sourceHash: 'sha256:' + 'a'.repeat(64), migrationReceiptId: new mongoose.Types.ObjectId(),
    current: true, isCurrent: true, status: 'CURRENT', stateStatus: 'CURRENT', evidenceObjectId: id, sourceId: `source-${i}`,
    sourceType: 'DOCUMENT', lineageRef: `lineage-${id}`, extractedFact: id === 'negative-2' ? 'Exact offpage provenance needle' : `Statement ${id}`,
    reviewStatus: 'ACCEPTED', validationStatus: 'VERIFIED', privateExtra: 'Extra must not be returned' })))
  await findingEvidence().insertMany(rows)
  return { args, candidates, rows }
}
test('finding native stored population search before page, exact same-snapshot pair and bounded whitelist without writes', async () => {
  const { args } = await seedFindings(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command); client.on('commandStarted', listener)
  let result
  try { result = await getRuntimeStateFindings({ ...args, population: 'DETECTED', search: 'PROVENANCE NEEDLE', pageSize: 1 }) }
  finally { client.off('commandStarted', listener) }
  expect(result).toMatchObject({ contractVersion: 'intelligence-finding-read.v1', control: { stateVersion: version },
    findings: { available: true, total: 1, completeness: 'COMPLETE_STORED_DETECTIONS', allTypesCompleteness: 'UNAVAILABLE',
      populations: { detected: 3, open: 3 }, records: [{ findingId: 'finding-2', reviewStatus: 'UNREVIEWED' }] } })
  expect((await getRuntimeStateFindings({ ...args, population: 'DETECTED', page: 3, pageSize: 1 })).findings.records[0].findingId).toBe('finding-2')
  const root = commands.find(c => c.find === 'runtime_instances'), evidence = commands.find(c => c.find === 'runtime_evidence_objects')
  expect(root.projection['framework_state.evidence_pack.discoveryHealth.contradictionCandidates']).toEqual({ $slice: 9 })
  expect(Object.keys(root.projection).filter(p => p.startsWith('framework_state')).sort()).toEqual([
    'framework_state.evidence_pack.contradictionReviewEpoch', 'framework_state.evidence_pack.contradictionReviews',
    'framework_state.evidence_pack.discoveryHealth.contradictionCandidates'])
  expect(evidence.limit).toBe(7); expect(evidence.batchSize).toBe(7); expect(evidence.projection.privateExtra).toBeUndefined()
  for (const command of commands.filter(c => c.find || c.aggregate)) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.lsid).toEqual(root.lsid); expect(command.txnNumber).toEqual(root.txnNumber); expect(command.autocommit).toBe(false)
  }
  expect(commands.some(c => c.getMore || c.insert || c.update || c.delete || c.findAndModify)).toBe(false)
  const { readReceipt, ...payload } = result
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload)))
  expect(JSON.stringify(result)).not.toMatch(/privateRootFact|Root evidence|privateExtra|Extra must|storedFindings/)
})
test('finding strict mounted query, actual role/licence/scope denials and locked read-only availability', async () => {
  const { args } = await seedFindings(), app = mounted(args)
  await RuntimeInstance.collection.updateOne({}, { $set: { status: 'LOCKED', lockedAt: new Date() } })
  expect((await request(app).get(findingsPath).query(query)).status).toBe(200)
  for (const bad of [{ ...query, search: 'x'.repeat(241) }, { ...query, search: 'a\nb' }, { ...query, population: 'ALL' },
    { ...query, sort: 'PRIORITY' }, { ...query, pageSize: 21 }, { ...query, unknown: 'value' }])
    expect((await request(app).get(findingsPath).query(bad)).status).toBe(422)
  expect((await request(app).get(findingsPath).query(new URLSearchParams(query).toString() + '&search[]=needle')).status).toBe(422)
  expect((await request(app).get(findingsPath).query({ ...query, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } }); expect((await request(app).get(findingsPath).query(query)).status).toBe(403)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } }); expect((await request(app).get(findingsPath).query(query)).status).toBe(403)
})
test.each(['customerVisible', 'private', 'visibility', 'accessLevel'])('finding planted undeclared visibility %s hides every statement', async field => {
  const { args } = await seedFindings(); await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $set: { [field]: false } })
  expect((await getRuntimeStateFindings(args)).findings).toMatchObject({ available: false, total: null, records: [], reason: 'UNVERIFIED_VISIBILITY_CONTRACT' })
})
test('finding rejected pair, malformed history, sentinel and missing row never become partial complete populations', async () => {
  const { args, candidates } = await seedFindings()
  await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $set: { reviewStatus: 'REJECTED' } })
  expect((await getRuntimeStateFindings(args)).findings.reason).toBe('EVIDENCE_PAIR_UNAVAILABLE')
  await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $set: { reviewStatus: 'ACCEPTED' } })
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.contradictionReviews': [historyRow({ reviewedBy: 'invalid' })] } })
  expect((await getRuntimeStateFindings(args)).findings.reason).toBe('HISTORY_RECORD_INVALID')
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.contradictionReviews': [],
    'framework_state.evidence_pack.discoveryHealth.contradictionCandidates': Array(9).fill(candidates[0]) } })
  expect((await getRuntimeStateFindings(args)).findings.reason).toBe('STORED_DETECTIONS_INVALID')
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.discoveryHealth.contradictionCandidates': candidates } })
  await findingEvidence().deleteOne({ evidenceObjectId: 'positive-0' })
  expect((await getRuntimeStateFindings(args)).findings.reason).toBe('EVIDENCE_BASIS_UNAVAILABLE')
})
test('finding same snapshot control/candidates/evidence cannot mix a concurrent successor', async () => {
  const { args } = await seedFindings(), collection = mongoose.connection.collection('runtime_evidence_objects'), find = collection.find.bind(collection)
  let changed = false
  jest.spyOn(collection, 'find').mockImplementation((...parameters) => { const cursor = find(...parameters), toArray = cursor.toArray.bind(cursor)
    cursor.toArray = async () => { if (!changed) { changed = true; await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:successor' } })
      await findingEvidence().updateMany({}, { $set: { stateVersion: 'rsv2:successor', sourceStateVersion: 'rsv2:successor' } }) }
      return toArray() }; return cursor })
  const result = await getRuntimeStateFindings(args)
  expect(result.control.stateVersion).toBe(version); expect(result.findings.available).toBe(true)
  const next = await getRuntimeStateFindings(args); expect(next.control.stateVersion).toBe('rsv2:successor'); expect(next.findings.available).toBe(true)
})
test('finding native malformed pair provenance stays unavailable while declared defaults remain valid', async () => {
  const { args } = await seedFindings()
  for (const [field, value] of [['sourceType', []], ['lineageRef', 7], ['validationStatus', {}]]) {
    await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $set: { [field]: value } })
    expect((await getRuntimeStateFindings(args)).findings).toMatchObject({ available: false, total: null, records: [], reason: 'EVIDENCE_BASIS_UNAVAILABLE' })
    await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $set: { [field]: '' } })
  }
  await findingEvidence().updateOne({ evidenceObjectId: 'positive-0' }, { $unset: { validationStatus: '' } })
  expect((await getRuntimeStateFindings(args)).findings.available).toBe(true)
})
test.each(['commitTransaction', 'abortTransaction'])('finding %s failure returns no retained population', async command => {
  const { args } = await seedFindings()
  if (command === 'abortTransaction') await findingEvidence().updateOne({}, { $set: { sourceStateVersion: 'rsv2:wrong' } })
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'alwaysOn', data: { failCommands: [command], errorCode: 2 } })
  const failures = [], client = mongoose.connection.getClient(), listener = event => failures.push(event.commandName)
  client.on('commandFailed', listener)
  let result
  try { result = await request(mounted(args)).get(findingsPath).query(query) }
  finally { client.off('commandFailed', listener) }
  // The driver suppresses abort-command errors. Preserve the original exact
  // source-version conflict rather than pretending it changed to an HTTP503.
  expect(result.status).toBe(command === 'abortTransaction' ? 409 : 503)
  expect(failures).toContain(command); expect(result.body.data).toBeUndefined()
})

const historyPath = `/${key}/state/contradiction-history`, findingId = 'contradiction_native'
const historyRow = change => ({ contractVersion: 'discovery-contradiction-review-v1', reviewId: randomUUID(),
  runtimeInstanceId: String(ids.runtimeInstanceId), contradictionId: findingId,
  evidencePairHash: 'sha256:' + 'a'.repeat(64), disposition: 'NOT_CONTRADICTORY', rationale: 'Recorded human explanation.',
  reviewEpoch: '', reviewedBy: String(ids.customerId), reviewedAt: '2026-10-06T10:00:00.000Z', reviewedStateVersion: version,
  ...change })
const seedHistory = async () => {
  const args = await seed(), rows = Array.from({ length: 130 }, () => historyRow())
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack': {
    contradictionReviews: rows, evidenceObjects: [{ privateEvidence: 'Not requested' }], privateField: 'Not requested' } } })
  return { args: { ...args, findingId }, rows }
}

test('native history pages offpage exact decisions, same-snapshot control, bounded projection, no writes or private fields', async () => {
  const { args, rows } = await seedHistory(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command); client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateContradictionHistory({ ...args, page: 101, pageSize: 1 }) }
  finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ contractVersion: 'intelligence-contradiction-history.v1', currency: 'AS_READ',
    control: { stateVersion: version }, history: { available: true, total: 130, totalPages: 130, page: 101,
      records: [{ reviewId: rows[29].reviewId }], currentness: 'NOT_ASSESSED', auditReferences: 'UNAVAILABLE' },
    readReceipt: { maxTimeMS: 2000, requestTimeoutMS: 6000, fullLegacyFrameworkStateFetched: false } })
  const reads = commands.filter(command => command.find || command.aggregate)
  const root = reads.find(command => command.find === 'runtime_instances')
  expect(root.projection['framework_state.evidence_pack.contradictionReviews']).toEqual({ $slice: 1001 })
  expect(Object.keys(root.projection).filter(path => path.startsWith('framework_state'))).toEqual(['framework_state.evidence_pack.contradictionReviews'])
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(root.lsid); expect(command.txnNumber).toEqual(root.txnNumber)
  }
  const { readReceipt, ...payload } = value
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  expect(JSON.stringify(value)).not.toMatch(/private|Not requested|contradictionHistoryRecords/)
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
})

test('history exact scope/strict query/current role and licence, with locked inspection permitted', async () => {
  const { args } = await seedHistory(), app = mounted(args), selectedQuery = { ...query, findingId }
  await RuntimeInstance.collection.updateOne({}, { $set: { status: 'LOCKED', lockedAt: new Date() } })
  expect((await request(app).get(historyPath).query(selectedQuery)).status).toBe(200)
  for (const bad of [{}, { ...selectedQuery, search: 'hidden' }, { ...selectedQuery, page: 1001 }, { ...selectedQuery, pageSize: 21 }])
    expect((await request(app).get(historyPath).query(bad)).status).toBe(422)
  expect((await request(app).get(historyPath).query({ ...selectedQuery, page: ['1', '2'] })).status).toBe(422)
  // Superagent serializes a one-item array as scalar pageSize=1. Send the
  // bracketed shape explicitly to exercise a real non-scalar HTTP query.
  expect((await request(app).get(historyPath).query(new URLSearchParams(selectedQuery).toString() + '&pageSize[]=1')).status).toBe(422)
  expect((await request(app).get(historyPath).query({ ...selectedQuery, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  expect((await request(app).get(historyPath).query({ ...selectedQuery, customerId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  const denied = await request(app).get(historyPath).query(selectedQuery)
  expect(denied.status).toBe(403); expect(denied.body.data).toBeUndefined()
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(historyPath).query(selectedQuery)).status).toBe(403)
})

test('history nonarray, duplicates and sentinel-overcap remain unavailable; oversized stored row fails safe503', async () => {
  const { args } = await seedHistory()
  for (const rows of [null, [historyRow({ reviewId: 'invalid' })], Array(1001).fill(historyRow())]) {
    await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.contradictionReviews': rows } })
    expect((await getRuntimeStateContradictionHistory(args)).history).toMatchObject({ available: false, records: [], total: null })
  }
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.contradictionReviews': [historyRow({ rationale: 'Private'.repeat(100000) })] } })
  const response = await request(mounted(args)).get(historyPath).query({ ...query, findingId })
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private/)
})

test('history and current control never mix concurrent successor history', async () => {
  const { args, rows } = await seedHistory(), original = RuntimeInstance.collection.findOne.bind(RuntimeInstance.collection)
  let changed = false
  jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async (...parameters) => {
    const row = await original(...parameters)
    if (!changed) { changed = true; await RuntimeInstance.collection.updateOne({}, { $set: {
      stateVersion: 'rsv2:successor', 'framework_state.evidence_pack.contradictionReviews': [historyRow({ reviewedStateVersion: 'rsv2:successor' })] } }) }
    return row
  })
  const first = await getRuntimeStateContradictionHistory(args)
  expect(first.control.stateVersion).toBe(version); expect(first.history.total).toBe(130)
  expect(first.history.records[0].reviewId).toBe(rows.at(-1).reviewId)
  const next = await getRuntimeStateContradictionHistory(args)
  expect(next.control.stateVersion).toBe('rsv2:successor'); expect(next.history.total).toBe(1)
})

test.each(['commitTransaction', 'abortTransaction'])('history native %s failure publishes no decisions', async failedCommand => {
  const { args } = await seedHistory()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(args)).get(historyPath).query({ ...query, findingId })
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
})

test('history stalled read respects native deadline and exposes no old values', async () => {
  const { args } = await seedHistory()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const began = Date.now(), response = await request(mounted(args)).get(historyPath).query({ ...query, findingId })
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(Date.now() - began).toBeLessThan(3500)
}, 15000)

const lockPath = `/${key}/state/lock-basis`
const seedLock = async () => {
  const args = await seed()
  const transition = buildRuntimeActionTransition({ actionKey: 'LOCK_RECORD', actorUserId: String(ids.customerId),
    frameworkPackage: { packageKey: 'fixture-package', sections: [] },
    runtimeInstance: { _id: ids.runtimeInstanceId, runtimeInstanceKey: key, runtimeType: 'VALUE_NARRATIVE',
      customerId: ids.customerId, tenantId: ids.tenantId, framework_state: {} } })
  const lock = transition.nextFrameworkState.lock
  await RuntimeInstance.collection.updateOne({}, { $set: { ...transition.runtimeUpdate,
    'framework_state.lock': { ...lock, privateBody: 'Private lock truth', evidence: { privateFact: 'Private certification basis' } },
    'framework_state.sections': { privateSection: { accepted: { content: 'Private section truth' } } } } })
  return { args, lock }
}

test('actual lock producer metadata and matching anchor use a narrow same-snapshot native read without membership inference', async () => {
  const { args, lock } = await seedLock(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command); client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateLockBasis(args) } finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ contractVersion: 'intelligence-lock-basis.v1', source: 'runtime_state_v2.lock_basis',
    currency: 'AS_READ', control: { stateVersion: version }, lockBasis: { available: true, locked: true,
      snapshot: lock.snapshot, replay: { available: true, anchor: { lockSnapshotHash: lock.snapshot.snapshotHash } },
      frozenInventory: { available: false, completeness: 'UNAVAILABLE', reason: 'FROZEN_MEMBERSHIP_NOT_RECORDED' } },
    readReceipt: { maxTimeMS: 2000, requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500, maxSerializedPayloadBytes: 524288, fullLegacyFrameworkStateFetched: false } })
  const { readReceipt, ...payload } = value
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  expect(JSON.stringify(value)).not.toMatch(/Private|recordedLockBasisProjection|integrityVerified/)
  const reads = commands.filter(command => command.find || command.aggregate)
  expect(reads.some(command => ['runtime_graph_elements', 'runtime_graph_snapshots', 'runtime_evidence_objects', 'runtime_evidence_sources'].includes(command.find))).toBe(false)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  const paths = Object.keys(reads.find(command => command.find === 'runtime_instances').projection).filter(field => field.startsWith('framework_state'))
  expect(paths.sort()).toEqual(['state', 'locked', 'lockVersion', 'lockedAt', 'lockedBy',
    'snapshot.snapshotId', 'snapshot.snapshotHash', 'snapshot.snapshotAt', 'snapshot.contractVersion', 'snapshot.actionKey',
    'replayAnchor.replayAnchorId', 'replayAnchor.replayAnchorHash', 'replayAnchor.relationship',
    'replayAnchor.runtimeInstanceId', 'replayAnchor.runtimeInstanceKey', 'replayAnchor.lockSnapshotId', 'replayAnchor.lockSnapshotHash']
    .map(field => 'framework_state.lock.' + field).sort())
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify || command.createIndexes)).toBe(false)
})

test('unlocked revision and malformed stored lock remain explicit unavailable reads', async () => {
  const args = await seed()
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: false, reason: 'LOCK_NOT_RECORDED', locked: false, snapshot: null })
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt: new Date() } })
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: false, reason: 'LOCK_METADATA_MISSING', snapshot: null })
})
test('root LOCKED status without a time is a conflicting lock, not unlocked', async () => {
  const args = await seed()
  await RuntimeInstance.collection.updateOne({}, { $set: { status: 'LOCKED', lockedAt: null,
    'framework_state.lock': { state: 'UNLOCKED', locked: false } } })
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: false, reason: 'LOCK_STATE_CONFLICT', locked: null, snapshot: null })
})
test.each([0, false, ''])('native malformed root timestamp is preserved for fail-closed interpretation %#', async lockedAt => {
  const args = await seed()
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt } })
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: false, reason: 'LOCK_STATE_INVALID', locked: null, snapshot: null })
})
test('mismatched recorded replay anchor does not hide lock metadata or imply replay proof', async () => {
  const { args, lock } = await seedLock()
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.lock.replayAnchor.lockSnapshotId': 'other-snapshot' } })
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: true, snapshot: lock.snapshot,
    replay: { available: false, reason: 'REPLAY_ANCHOR_INVALID', anchor: null } })
})
test('invalid lock flags and oversized metadata never disclose retained or private basis', async () => {
  const { args } = await seedLock()
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.lock.locked': false } })
  expect((await getRuntimeStateLockBasis(args)).lockBasis).toMatchObject({ available: false, reason: 'LOCK_STATE_CONFLICT', snapshot: null })
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.lock.snapshot.snapshotId': 'Private'.repeat(100000) } })
  const response = await request(mounted(args)).get(lockPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private/)
})
test('lock query requires exact scope and current view authority/licence while allowing locked inspection', async () => {
  const { args } = await seedLock(), app = mounted(args)
  expect((await request(app).get(lockPath).query(query)).status).toBe(200)
  expect((await request(app).get(lockPath)).status).toBe(422)
  expect((await request(app).get(lockPath).query({ ...query, search: 'hidden' })).status).toBe(422)
  expect((await request(app).get(lockPath).query({ ...query, customerId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  expect((await request(app).get(lockPath).query({ ...query, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  expect((await request(app).get('/missing-revision/state/lock-basis').query(query)).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  const denied = await request(app).get(lockPath).query(query)
  expect(denied.status).toBe(403); expect(denied.body.data).toBeUndefined()
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(lockPath).query(query)).status).toBe(403)
})
test.each(['commitTransaction', 'abortTransaction'])('lock native %s failure publishes no recorded basis', async failedCommand => {
  const { args } = await seedLock()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(args)).get(lockPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
})
test('lock native stalled read respects its deadline without leaking snapshot metadata', async () => {
  const { args } = await seedLock()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const began = Date.now(), response = await request(mounted(args)).get(lockPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(Date.now() - began).toBeLessThan(3500)
}, 15000)
test('lock identity and observed control version do not mix concurrent basis changes', async () => {
  const { args, lock } = await seedLock(), original = RuntimeInstance.collection.findOne.bind(RuntimeInstance.collection)
  let changed = false
  jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async (...parameters) => {
    const row = await original(...parameters)
    if (!changed) {
      changed = true
      await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:successor',
        'framework_state.lock.snapshot.snapshotId': 'successor-snapshot',
        'framework_state.lock.replayAnchor.lockSnapshotId': 'successor-snapshot' } })
    }
    return row
  })
  const value = await getRuntimeStateLockBasis(args)
  expect(value.control.stateVersion).toBe(version); expect(value.lockBasis.snapshot).toEqual(lock.snapshot)
  const next = await getRuntimeStateLockBasis(args)
  expect(next.control.stateVersion).toBe('rsv2:successor'); expect(next.lockBasis.snapshot.snapshotId).toBe('successor-snapshot')
})
test('expired lock work schedules no later authorization or metadata reads', async () => {
  const { args } = await seedLock(), now = Date.now(), commands = [], client = mongoose.connection.getClient()
  const listener = event => { commands.push(event.command); if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000) }
  client.on('commandStarted', listener)
  try { await expect(getRuntimeStateLockBasis(args)).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})
test.each(['startSession', 'endSession'])('lock session %s failure hides the basis and private errors', async phase => {
  const { args } = await seedLock(), original = mongoose.startSession.bind(mongoose)
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => {
    if (phase === 'startSession') throw new Error('Private lock session failure')
    const session = await original(), end = session.endSession.bind(session)
    session.endSession = async () => { await end(); throw new Error('Private lock cleanup failure') }
    return session
  })
  const response = await request(mounted(args)).get(lockPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private lock/)
})

const discoveryPath = `/${key}/state/discovery-health`
const recordedReadiness = { state: 'PARTIALLY_READY', blockerReasons: [], warningReasons: ['EVIDENCE_REVIEW_PENDING'], assessedAt: '2026-10-06T12:00:00.000Z' }
const seedDiscovery = async () => {
  const args = await seed()
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack': {
    discoveryHealth: { readiness: { ...recordedReadiness, coveragePercent: 70, privateScore: 'Private readiness metadata' },
      contradictionCandidates: [{ privateCandidate: 'Private candidate not requested' }] },
    needsRefresh: false, inputs: { privateInput: 'Private input not requested' },
    evidenceObjects: [{ privateEvidence: 'Private evidence not requested' }],
  } } })
  return args
}

test('stored Discovery readiness is a narrow same-snapshot native read with unknown assessment basis and zero writes', async () => {
  const args = await seedDiscovery(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command); client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateDiscoveryHealth(args) } finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ contractVersion: 'intelligence-discovery-health.v1', currency: 'AS_READ',
    source: 'runtime_state_v2.discovery_health', control: { stateVersion: version },
    discoveryHealth: { available: true, assessmentBasis: 'UNKNOWN', freshness: 'NOT_MARKED_STALE', assessment: recordedReadiness },
    readReceipt: { maxTimeMS: 2000, requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500, fullLegacyFrameworkStateFetched: false } })
  const { readReceipt, ...payload } = value
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  expect(JSON.stringify(value)).not.toMatch(/Private|privateScore|coveragePercent|discoveryHealthProjection/)
  const reads = commands.filter(command => command.find || command.aggregate)
  expect(reads.some(command => ['runtime_graph_elements', 'runtime_graph_snapshots', 'runtime_evidence_objects'].includes(command.find))).toBe(false)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  const runtimeRead = reads.find(command => command.find === 'runtime_instances')
  const frameworkPaths = Object.keys(runtimeRead.projection).filter(field => field.startsWith('framework_state'))
  expect(frameworkPaths.sort()).toEqual(['framework_state.evidence_pack.needsRefresh', 'framework_state.evidence_pack.needs_refresh',
    ...['state', 'blockerReasons', 'warningReasons', 'assessedAt'].map(field => `framework_state.evidence_pack.discoveryHealth.readiness.${field}`)].sort())
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
})

test.each(['READY', 'PARTIALLY_READY', 'NOT_READY'])('Discovery endpoint preserves recorded %s including locked inspection', async state => {
  const args = await seedDiscovery()
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.discoveryHealth.readiness.state': state,
    lockedAt: new Date(), status: 'LOCKED' } })
  const response = await request(mounted(args)).get(discoveryPath).query(query)
  expect(response.status).toBe(200); expect(response.body.data.discoveryHealth.assessment.state).toBe(state)
  expect(response.body.data.control).not.toHaveProperty('discoveryHealthProjection')
})
test.each([
  ['needsRefresh', true, 'STALE'], ['needs_refresh', true, 'STALE'], ['needs_refresh', false, 'NOT_MARKED_STALE'],
])('Discovery marker %s=%s exposes %s without claiming assessed input currency', async (field, marker, freshness) => {
  const args = await seedDiscovery()
  await RuntimeInstance.collection.updateOne({}, { ...(field === 'needsRefresh' ? {} : { $unset: { 'framework_state.evidence_pack.needsRefresh': '' } }),
    $set: { [`framework_state.evidence_pack.${field}`]: marker } })
  expect((await getRuntimeStateDiscoveryHealth(args)).discoveryHealth).toMatchObject({ freshness, assessmentBasis: 'UNKNOWN' })
})
test('missing markers leave recorded assessment freshness unknown; missing assessment is not an empty READY assessment', async () => {
  const args = await seedDiscovery()
  await RuntimeInstance.collection.updateOne({}, { $unset: { 'framework_state.evidence_pack.needsRefresh': '' } })
  expect((await getRuntimeStateDiscoveryHealth(args)).discoveryHealth.freshness).toBe('UNKNOWN')
  await RuntimeInstance.collection.updateOne({}, { $unset: { 'framework_state.evidence_pack.discoveryHealth': '' } })
  expect((await getRuntimeStateDiscoveryHealth(args)).discoveryHealth).toMatchObject({ available: false, reason: 'ASSESSMENT_MISSING', assessment: null })
})
test('oversized Discovery reasons are unavailable rather than truncated; projected payload cap includes malformed fields', async () => {
  const args = await seedDiscovery()
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.discoveryHealth.readiness.warningReasons':
    Array.from({ length: 33 }, (_, index) => 'REASON_' + index) } })
  expect((await getRuntimeStateDiscoveryHealth(args)).discoveryHealth).toMatchObject({ available: false, reason: 'ASSESSMENT_INVALID', assessment: null })
  await RuntimeInstance.collection.updateOne({}, { $set: { 'framework_state.evidence_pack.discoveryHealth.readiness.state': 'Private'.repeat(100000) } })
  const response = await request(mounted(args)).get(discoveryPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private/)
})
test('Discovery query requires exact scope and rejects filters; current role/entitlement denial never returns assessment', async () => {
  const args = await seedDiscovery(), app = mounted(args)
  expect((await request(app).get(discoveryPath)).status).toBe(422)
  expect((await request(app).get(discoveryPath).query({ ...query, search: 'hidden' })).status).toBe(422)
  expect((await request(app).get(discoveryPath).query({ ...query, customerId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  expect((await request(app).get(discoveryPath).query({ ...query, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  const denied = await request(app).get(discoveryPath).query(query)
  expect(denied.status).toBe(403); expect(denied.body.data).toBeUndefined()
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(discoveryPath).query(query)).status).toBe(403)
})
test.each(['commitTransaction', 'abortTransaction'])('Discovery native %s failure hides recorded assessment', async failedCommand => {
  const args = await seedDiscovery()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(args)).get(discoveryPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
})
test('Discovery native stalled read respects its deadline and publishes no old assessment', async () => {
  const args = await seedDiscovery()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const began = Date.now(), response = await request(mounted(args)).get(discoveryPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(Date.now() - began).toBeLessThan(3500)
}, 15000)

test('Discovery assessment and observed control version do not mix a concurrent successor update', async () => {
  const args = await seedDiscovery(), original = RuntimeInstance.collection.findOne.bind(RuntimeInstance.collection)
  let changed = false
  jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async (...parameters) => {
    const row = await original(...parameters)
    if (!changed) {
      changed = true
      await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:successor',
        'framework_state.evidence_pack.discoveryHealth.readiness.state': 'NOT_READY',
        'framework_state.evidence_pack.discoveryHealth.readiness.blockerReasons': ['SUCCESSOR_ONLY'] } })
    }
    return row
  })
  const value = await getRuntimeStateDiscoveryHealth(args)
  expect(value.control.stateVersion).toBe(version)
  expect(value.discoveryHealth.assessment).toEqual(recordedReadiness)
  const next = await getRuntimeStateDiscoveryHealth(args)
  expect(next.control.stateVersion).toBe('rsv2:successor')
  expect(next.discoveryHealth.assessment.blockerReasons).toEqual(['SUCCESSOR_ONLY'])
})
test('expired Discovery work schedules no later authorization or metadata read', async () => {
  const args = await seedDiscovery(), now = Date.now(), commands = [], client = mongoose.connection.getClient()
  const listener = event => { commands.push(event.command); if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000) }
  client.on('commandStarted', listener)
  try { await expect(getRuntimeStateDiscoveryHealth(args)).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})
test.each(['startSession', 'endSession'])('Discovery session %s failure has no assessment or internal error leakage', async phase => {
  const args = await seedDiscovery(), original = mongoose.startSession.bind(mongoose)
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => {
    if (phase === 'startSession') throw new Error('Private Discovery session failure')
    const session = await original(), end = session.endSession.bind(session)
    session.endSession = async () => { await end(); throw new Error('Private Discovery cleanup failure') }
    return session
  })
  const response = await request(mounted(args)).get(discoveryPath).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private Discovery/)
})

test('producer source facts survive existing mapping and a current bounded native receipt without truth writes', async () => {
  const args = await seed()
  const graph = buildRuntimeIntelligenceGraphForFrameworkState({
    frameworkPackage: { frameworkKey: 'FIXTURE', packageKey: 'fixture', version: '1', sections: [] },
    frameworkState: { sections: {}, evidence_pack: { accepted: false,
      sourceRegistry: [{ sourceId: 'fixture-source', sourceType: 'WEBSITE' }],
      evidenceObjects: [{ evidenceObjectId: 'fixture-evidence', sourceId: 'fixture-source', category: 'Company',
        coverageArea: 'Company', extractedFact: 'Isolated recorded fact', reviewStatus: 'ACCEPTED' }] } },
    runtimeInstance: { _id: String(ids.runtimeInstanceId), runtimeInstanceKey: key,
      customerId: String(ids.customerId), tenantId: String(ids.tenantId), frameworkId: String(new mongoose.Types.ObjectId()) },
  })
  const mapped = createRuntimeStateLegacyRowSet({
    legacyInput: { rawBsonBytes: 4096, sections: {}, evidencePack: { sourceRegistry: [], evidenceObjects: [] }, intelligenceGraph: graph },
    scope: { ...Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, String(id)])), runtimeInstanceKey: key },
    stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000', migrationReceiptId: String(new mongoose.Types.ObjectId()), migrationTimestamp: '2026-10-06T12:00:00.000Z',
  })
  const snapshot = mapped.rows.graphSnapshots[0]
  expect(snapshot.metadata.coverage).toEqual(graph.coverage)
  await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: snapshot.stateVersion } })
  await graphs().deleteMany({})
  await graphs().insertOne({ ...snapshot, ...ids, status: 'CURRENT', stateStatus: 'CURRENT', current: true })
  const commands = [], client = mongoose.connection.getClient(), listener = event => commands.push(event.command)
  client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateGraphManifest(args) } finally { client.off('commandStarted', listener) }
  expect(value.manifest.metadata.coverage).toEqual(graph.coverage)
  expect(value.manifest.graphHash).toBe(graph.graphHash)
  expect(value.readReceipt).toMatchObject({ maxTimeMS: 2000, requestTimeoutMS: 6000, maxSerializedPayloadBytes: 512 * 1024, bounded: true, fullLegacyFrameworkStateFetched: false })
  expect(commands.some(command => command.insert || command.update || command.delete || command.getMore)).toBe(false)
  expect(commands.filter(command => command.find || command.aggregate).every(command => command.maxTimeMS <= 2000)).toBe(true)
  await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:successor' } })
  await expect(getRuntimeStateGraphManifest(args)).rejects.toMatchObject({ status: 409 })
})

test('actual metadata, role, licence and one bounded manifest share a read-only snapshot and native operation deadlines', async () => {
  const args = await seed(), commands = []
  const listener = event => commands.push(event.command), client = mongoose.connection.getClient()
  client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateGraphManifest(args) }
  finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ currency: 'AS_READ', control: { stateVersion: version }, manifest: { snapshotId: 'graph-snapshot-one' },
    readReceipt: { maxTimeMS: 2000, requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500, fullLegacyFrameworkStateFetched: false } })
  const { readReceipt, ...payload } = value
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  const reads = commands.filter(command => command.find || command.aggregate)
  expect(reads.map(command => command.find || command.aggregate)).toEqual(expect.arrayContaining(['runtime_instances', 'roles', 'customers', 'tenants', 'licenselevels', 'runtime_graph_snapshots']))
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  expect(reads.find(command => command.find === 'runtime_graph_snapshots')).toMatchObject({ limit: 1, batchSize: 1 })
  expect(reads.find(command => command.find === 'runtime_instances').projection.framework_state).toBeUndefined()
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
  expect(JSON.stringify(value)).not.toMatch(/Private full runtime truth/)
})
test('locked inspection remains available with view-only authority', async () => {
  const args = await seed()
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt: new Date(), status: 'LOCKED' } })
  expect((await request(mounted(args)).get(path).query(query)).status).toBe(200)
})
test.each([
  [null, 'RUNTIME_STATE_V2_GRAPH_MANIFEST_MISSING'],
  [{ status: 'STALE', current: false, stateStatus: 'STALE' }, 'RUNTIME_STATE_V2_GRAPH_MANIFEST_MISSING'],
  [{ sourceStateVersion: 'rsv2:old' }, 'RUNTIME_STATE_V2_STATE_VERSION_MIXED'],
  [{ sourceHash: '' }, 'RUNTIME_STATE_V2_GRAPH_SOURCE_HASH_INVALID'],
])('invalid or missing current basis remains an explicit409 %#', async (change, code) => {
  const args = await seed()
  if (change) await graphs().updateOne({}, { $set: change }); else await graphs().deleteMany({})
  const response = await request(mounted(args)).get(path).query(query)
  expect(response.status).toBe(409); expect(response.body.data).toBeUndefined(); expect(response.body.error.code).toBe(code)
})
test('wrong tenant, revoked current role and licence fail before returning a graph receipt', async () => {
  const args = await seed(), app = mounted(args)
  expect((await request(app).get(path).query({ ...query, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  expect((await request(app).get(path).query(query)).status).toBe(403)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(path).query(query)).status).toBe(403)
})
test.each([Customer, Tenant, LicenseLevel])('rejected %s metadata fails safely without a graph receipt', async model => {
  const args = await seed()
  jest.spyOn(model.collection, 'findOne').mockRejectedValue(new Error('Private manifest metadata failure'))
  const response = await request(mounted(args)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private manifest/)
})
test('expired work schedules no later metadata or manifest query', async () => {
  const args = await seed(), now = Date.now(), commands = [], client = mongoose.connection.getClient()
  const listener = event => { commands.push(event.command); if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000) }
  client.on('commandStarted', listener)
  try { await expect(getRuntimeStateGraphManifest(args)).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})
test('stalled native read returns safe unavailable within its operation deadline', async () => {
  const args = await seed()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const began = Date.now(), response = await request(mounted(args)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(Date.now() - began).toBeLessThan(3500)
}, 15000)
test.each(['commitTransaction', 'abortTransaction'])('native %s failure cannot return a verified graph manifest', async failedCommand => {
  const args = await seed()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(args)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
})
test.each(['startSession', 'endSession'])('session %s failure is safe unavailable', async phase => {
  const args = await seed(), original = mongoose.startSession.bind(mongoose)
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => {
    if (phase === 'startSession') throw new Error('Private session acquisition failure')
    const session = await original(), end = session.endSession.bind(session)
    session.endSession = async () => { await end(); throw new Error('Private session cleanup failure') }
    return session
  })
  const response = await request(mounted(args)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Private session/)
})

const seedProjection = async () => {
  const args = await seed()
  await graphs().updateOne({}, { $set: { counts: { nodeCount: 100, edgeCount: 50 } } })
  const basis = { ...ids, runtimeInstanceKey: key, current: true, stateStatus: 'CURRENT', stateVersion: version,
    sourceStateVersion: version, snapshotId: 'graph-snapshot-one', graphVersion: '2.2' }
  await elements().insertMany(Array.from({ length: 50 }, (_, index) => {
    const suffix = String(index).padStart(3, '0')
    return [
      { ...basis, elementType: 'EDGE', elementKey: 'edge-' + suffix, fromElementKey: 'source-' + suffix,
        toElementKey: 'evidence-' + suffix, relationshipType: 'SOURCE_PRODUCES_EVIDENCE' },
      { ...basis, elementType: 'NODE', elementKey: 'source-' + suffix, label: 'Source ' + suffix, attributes: { nodeType: 'SOURCE', sourceId: 'canonical-source-' + suffix } },
      { ...basis, elementType: 'NODE', elementKey: 'evidence-' + suffix, label: 'Evidence ' + suffix, attributes: { nodeType: 'EVIDENCE', sourceId: 'canonical-source-' + suffix, evidenceObjectId: 'canonical-evidence-' + suffix } },
    ]
  }).flat())
  return args
}

// Runs a separate-session change immediately before the first native element query.
const beforeEdges = callback => {
  const collection = mongoose.connection.collection('runtime_graph_elements')
  const originalFind = collection.find.bind(collection)
  jest.spyOn(collection, 'find').mockImplementation((filter, ...args) => {
    const cursor = originalFind(filter, ...args), toArray = cursor.toArray.bind(cursor)
    if (filter.elementType === 'EDGE') cursor.toArray = async () => { await callback(); return toArray() }
    return cursor
  })
}

test('projection metadata, manifest, 48 edges and 96 exact endpoints share one bounded snapshot without getMore or writes', async () => {
  const args = await seedProjection(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command)
  client.on('commandStarted', listener)
  let value
  try { value = await getRuntimeStateGraphProjection(args) }
  finally { client.off('commandStarted', listener) }
  expect(value).toMatchObject({ currency: 'AS_READ', graph: { totalNodeCount: 100, totalEdgeCount: 50,
    projection: { truncated: true, edgeLimit: 48, nodeLimit: 96 } }, readReceipt: { requestTimeoutMS: 6000, maxTimeMS: 2000 } })
  expect(value.graph.edges).toHaveLength(48); expect(value.graph.nodes).toHaveLength(96)
  expect(value.graph.nodes.find(node => node.nodeId === 'source-000')).toMatchObject({ sourceId: 'canonical-source-000' })
  expect(value.graph.nodes.find(node => node.nodeId === 'evidence-000')).toMatchObject({ sourceId: 'canonical-source-000', evidenceObjectId: 'canonical-evidence-000' })
  const { readReceipt, ...payload } = value
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  const reads = commands.filter(command => command.find || command.aggregate)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  const graphReads = reads.filter(command => command.find === 'runtime_graph_elements')
  expect(graphReads).toHaveLength(2)
  expect(graphReads[0]).toMatchObject({ limit: 48, batchSize: 48 })
  expect(graphReads[1]).toMatchObject({ limit: 96, batchSize: 96 })
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
  expect(JSON.stringify(value)).not.toMatch(/Private full runtime truth/)
})

test.each([
  ['missing', undefined], ['nonstring', 42], ['empty', '  '], ['control', 'canonical\u0001id'],
  ['DEL', 'canonical\u007fid'], ['overbound', 'x'.repeat(241)], ['physical storage token', 'runtime_evidence_objects'],
])('recorded provenance omits %s identity without node-ID inference or sanitizer fabrication', async (_name, invalidId) => {
  const args = await seedProjection()
  const attributes = { nodeType: 'EVIDENCE', customerVisible: true }
  if (invalidId !== undefined) Object.assign(attributes, { sourceId: invalidId, evidenceObjectId: invalidId })
  await elements().updateOne({ elementKey: 'evidence-000' }, { $set: { attributes } })
  const result = await getRuntimeStateGraphProjection(args)
  const node = result.graph.nodes.find(item => item.nodeId === 'evidence-000')
  expect(node).toBeDefined()
  expect(node).not.toHaveProperty('sourceId'); expect(node).not.toHaveProperty('evidenceObjectId')
})

test.each(['INTELLIGENCE', 'SIGNAL', 'SECTION_TRUTH', 'OUTPUT_REFERENCE'])('does not project provenance IDs on %s nodes', async nodeType => {
  const args = await seedProjection()
  await elements().updateOne({ elementKey: 'evidence-000' }, { $set: { 'attributes.nodeType': nodeType } })
  const node = (await getRuntimeStateGraphProjection(args)).graph.nodes.find(item => item.nodeId === 'evidence-000')
  expect(node).not.toHaveProperty('sourceId'); expect(node).not.toHaveProperty('evidenceObjectId')
})

test('private nodes omit recorded provenance; visible fields trim independently at the 240-character bound', async () => {
  const args = await seedProjection()
  await elements().updateOne({ elementKey: 'source-000' }, { $set: { 'attributes.customerVisible': false, 'attributes.evidenceObjectId': 'must-not-expose' } })
  await elements().updateOne({ elementKey: 'evidence-000' }, { $set: { 'attributes.sourceId': '  canonical-source-000  ', 'attributes.evidenceObjectId': 'x'.repeat(240) } })
  const nodes = (await getRuntimeStateGraphProjection(args)).graph.nodes
  const source = nodes.find(node => node.nodeId === 'source-000')
  expect(source).not.toHaveProperty('sourceId'); expect(source).not.toHaveProperty('evidenceObjectId')
  expect(nodes.find(node => node.nodeId === 'evidence-000')).toMatchObject({ sourceId: 'canonical-source-000', evidenceObjectId: 'x'.repeat(240) })
  await elements().updateOne({ elementKey: 'evidence-000' }, { $set: { 'attributes.evidenceObjectId': 42 } })
  const evidence = (await getRuntimeStateGraphProjection(args)).graph.nodes.find(node => node.nodeId === 'evidence-000')
  expect(evidence.sourceId).toBe('canonical-source-000'); expect(evidence).not.toHaveProperty('evidenceObjectId')
})

test('a concurrent control, manifest and element update cannot mix a new basis into the old snapshot', async () => {
  const args = await seedProjection()
  beforeEdges(async () => {
    await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:successor' } })
    await graphs().updateOne({}, { $set: { stateVersion: 'rsv2:successor', sourceStateVersion: 'rsv2:successor', snapshotId: 'graph-successor' } })
    await elements().updateMany({}, { $set: { stateVersion: 'rsv2:successor', sourceStateVersion: 'rsv2:successor', snapshotId: 'graph-successor', label: 'Successor' } })
  })
  const value = await getRuntimeStateGraphProjection(args)
  expect(value.control.stateVersion).toBe(version)
  expect(value.graph.nodes).toHaveLength(96); expect(value.graph.edges).toHaveLength(48)
  expect(value.graph.nodes.every(node => node.label !== 'Successor')).toBe(true)
  expect((await graphs().findOne({})).snapshotId).toBe('graph-successor')
})

test.each([
  { nodeCount: undefined, edgeCount: 50 }, { nodeCount: '100', edgeCount: 50 },
  { nodeCount: -1, edgeCount: 50 }, { nodeCount: 100, edgeCount: 1.5 },
  { nodeCount: Number.MAX_SAFE_INTEGER + 1, edgeCount: 50 }, { nodeCount: 1, edgeCount: 50 },
  { nodeCount: 100, edgeCount: 1 },
])('missing, fabricated or insufficient graph totals fail closed %#', async counts => {
  const args = await seedProjection()
  await graphs().updateOne({}, { $set: { counts } })
  await expect(getRuntimeStateGraphProjection(args)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_GRAPH_ELEMENTS_INVALID' })
})

test.each([
  ['EDGE', { elementKey: '' }], ['EDGE', { elementKey: 'edge-001' }],
  ['EDGE', { isCurrent: false }], ['NODE', { isCurrent: false }], ['NODE', { stateStatus: 'STALE' }],
  ['NODE', { sourceStateVersion: 'rsv2:old' }], ['NODE', { snapshotId: 'other-snapshot' }], ['NODE', { graphVersion: '1' }],
])('invalid or incomplete %s identity/version/currency fails closed %#', async (type, changes) => {
  const args = await seedProjection()
  await elements().updateOne({ elementType: type, elementKey: type === 'EDGE' ? 'edge-000' : 'source-000' }, { $set: changes })
  await expect(getRuntimeStateGraphProjection(args)).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_GRAPH_ELEMENTS_INVALID' })
})

test('expired work after manifest prevents scheduling an element query', async () => {
  const args = await seedProjection(), began = Date.now(), commands = [], client = mongoose.connection.getClient()
  const listener = event => {
    commands.push(event.command)
    if (event.command.find === 'runtime_graph_snapshots') jest.spyOn(Date, 'now').mockReturnValue(began + 6000)
  }
  client.on('commandStarted', listener)
  try { await expect(getRuntimeStateGraphProjection(args)).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find === 'runtime_graph_elements')).toHaveLength(0)
})

test('a stalled native element read is unavailable within the per-operation deadline', async () => {
  const args = await seedProjection()
  beforeEdges(async () => {
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  })
  const began = Date.now()
  await expect(getRuntimeStateGraphProjection(args)).rejects.toMatchObject({ status: 503 })
  expect(Date.now() - began).toBeLessThan(3500)
}, 15000)

const neighbourhoodQuery = { nodeId: 'source-000', mode: 'Journey', graphHash: 'sha256:' + 'b'.repeat(64) }
const evidenceQuery = { evidenceObjectId: 'canonical-evidence-049', mode: 'Lineage', graphHash: 'sha256:' + 'b'.repeat(64) }
const seedCanonicalSelection = async () => {
  const args = await seedProjection()
  await elements().updateMany({ 'attributes.nodeType': 'EVIDENCE' }, { $set: { 'attributes.scope': 'GLOBAL' } })
  return args
}

test('canonical evidence beyond flat projection resolves recorded node with one bounded snapshot and no writes', async () => {
  const args = await seedCanonicalSelection(), commands = [], client = mongoose.connection.getClient()
  const flat = await getRuntimeStateGraphProjection(args)
  expect(flat.graph.nodes.some(node => node.evidenceObjectId === evidenceQuery.evidenceObjectId)).toBe(false)
  const listener = event => commands.push(event.command)
  client.on('commandStarted', listener)
  let result
  try { result = await getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery }) }
  finally { client.off('commandStarted', listener) }
  expect(result.graph.neighbourhood).toMatchObject({ nodeId: 'evidence-049', complete: true,
    evidenceSelection: { evidenceObjectId: 'canonical-evidence-049', nodeId: 'evidence-049', scope: 'GLOBAL' } })
  expect(result.graph.nodes.map(node => node.nodeId)).toEqual(['evidence-049', 'source-049'])
  expect(result.graph.nodes[0].evidenceObjectId).toBe(evidenceQuery.evidenceObjectId)
  expect(result.graph.edges.map(edge => edge.edgeId)).toEqual(['edge-049'])
  const reads = commands.filter(command => command.find || command.aggregate)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  const lookup = reads.find(command => command.find === 'runtime_graph_elements')
  expect(lookup).toMatchObject({ limit: 2, batchSize: 2, collation: { locale: 'simple' }, filter: {
    elementType: 'NODE', 'attributes.nodeType': 'EVIDENCE', 'attributes.scope': 'GLOBAL',
    'attributes.evidenceObjectId': evidenceQuery.evidenceObjectId, snapshotId: 'graph-snapshot-one', stateVersion: version,
  } })
  expect(lookup.filter.$and).toEqual([
    { $or: [{ runtimeInstanceId: String(ids.runtimeInstanceId) }, { runtimeInstanceId: ids.runtimeInstanceId }, { runtimeInstanceKey: key }] },
    { $or: [{ customerId: String(ids.customerId) }, { customerId: ids.customerId }] },
    { $or: [{ tenantId: String(ids.tenantId) }, { tenantId: ids.tenantId }] },
  ])
  expect(reads.filter(command => command.find === 'runtime_graph_elements').map(command => command.limit)).toEqual([2, 48, 2])
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
  const { readReceipt, ...payload } = result
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload)))
  const explained = await elements().find(lookup.filter, { projection: lookup.projection, collation: { locale: 'simple' }, maxTimeMS: 2000 })
    .sort({ elementKey: 1 }).limit(2).explain('executionStats')
  expect(explained.executionStats.nReturned).toBe(1)
  expect(explained.executionStats.totalDocsExamined).toBeGreaterThan(0)
  console.log('SS042 isolated canonical lookup scan', { nReturned: explained.executionStats.nReturned,
    documentsExamined: explained.executionStats.totalDocsExamined, executionTimeMillis: explained.executionStats.executionTimeMillis })
})

test.each([
  ['absent', { 'attributes.evidenceObjectId': 'other' }],
  ['SECTION-only', { 'attributes.scope': 'SECTION' }],
  ['legacy object scope', { 'attributes.scope': { runtimeInstanceId: key } }],
  ['private', { 'attributes.customerVisible': false }],
  ['wrong node type', { 'attributes.nodeType': 'SOURCE' }],
])('canonical %s selection is unavailable without fallback or private details', async (_name, changes) => {
  const args = await seedCanonicalSelection()
  await elements().updateOne({ elementKey: 'evidence-049' }, { $set: changes })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery })).rejects.toMatchObject({ status: 404 })
  const response = await request(mounted(args)).get(`/${key}/state/graph-neighbourhood`).query({ ...query, ...evidenceQuery })
  expect(response.status).toBe(404); expect(response.body.data).toBeUndefined()
})

test('ambiguous canonical GLOBAL identities and invalid source version fail without success receipt', async () => {
  const args = await seedCanonicalSelection(), original = await elements().findOne({ elementKey: 'evidence-049' })
  const { _id, ...duplicate } = original
  const inserted = await elements().insertOne({ ...duplicate, elementKey: 'another-global-node' })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery })).rejects.toMatchObject({ status: 409 })
  await elements().deleteOne({ _id: inserted.insertedId })
  await elements().updateOne({ _id }, { $set: { sourceStateVersion: 'rsv2:old' } })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery })).rejects.toMatchObject({ status: 409 })
})

test('canonical continuation re-resolves literal evidence and cursor direction on every page', async () => {
  const args = await seedCanonicalSelection()
  await elements().updateMany({ elementType: 'EDGE' }, { $set: { toElementKey: 'evidence-049' } })
  const first = await getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery })
  expect(first.graph.edges).toHaveLength(48)
  const second = await getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery, afterEdgeKey: first.graph.neighbourhood.nextAfterEdgeKey })
  expect(second.graph.edges.map(edge => edge.edgeId)).toEqual(['edge-048', 'edge-049'])
  expect(second.graph.neighbourhood.evidenceSelection).toEqual(first.graph.neighbourhood.evidenceSelection)
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery, mode: 'Impact', afterEdgeKey: 'edge-047' })).rejects.toMatchObject({ status: 400 })
  await elements().updateOne({ elementKey: 'evidence-049' }, { $set: { 'attributes.evidenceObjectId': 'changed' } })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery, afterEdgeKey: 'edge-047' })).rejects.toMatchObject({ status: 404 })
})

test.each([
  { nodeId: 'evidence-049' }, { evidenceObjectId: undefined }, { evidenceObjectId: '' },
  { evidenceObjectId: ['first', 'second'] }, { evidenceObjectId: { $ne: '' } },
  { evidenceObjectId: 'x'.repeat(241) }, { evidenceObjectId: 'id\u0001bad' },
  { evidenceObjectId: 'runtime_evidence_objects' }, { extra: 'not-allowed' },
])('canonical malformed or nonexclusive selection rejected before service lookup %#', async invalid => {
  const args = await seedCanonicalSelection(), selection = { ...evidenceQuery, ...invalid }
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...selection })).rejects.toMatchObject({ status: 400 })
  const response = await request(mounted(args)).get(`/${key}/state/graph-neighbourhood`).query({ ...query, ...selection })
  expect(response.status).toBe(422); expect(response.body.data).toBeUndefined()
})

test('canonical mounted selection serves locked inspection and rejects stale graph, wrong scope, role and licence', async () => {
  const args = await seedCanonicalSelection(), app = mounted(args), endpoint = `/${key}/state/graph-neighbourhood`
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt: new Date(), status: 'LOCKED' } })
  const response = await request(app).get(endpoint).query({ ...query, ...evidenceQuery })
  expect(response.status).toBe(200); expect(response.body.data.graph.neighbourhood.evidenceSelection.nodeId).toBe('evidence-049')
  expect((await request(app).get(endpoint).query({ ...query, ...evidenceQuery, graphHash: 'sha256:' + 'c'.repeat(64) })).status).toBe(409)
  expect((await request(app).get(endpoint).query({ ...query, ...evidenceQuery, tenantId: String(new mongoose.Types.ObjectId()) })).status).toBe(404)
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  expect((await request(app).get(endpoint).query({ ...query, ...evidenceQuery })).status).toBe(403)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(endpoint).query({ ...query, ...evidenceQuery })).status).toBe(403)
})

test('canonical lookup and relationships do not mix concurrent successor basis', async () => {
  const args = await seedCanonicalSelection()
  beforeEdges(async () => {
    await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:new' } })
    await graphs().updateOne({}, { $set: { graphHash: 'sha256:' + 'c'.repeat(64), stateVersion: 'rsv2:new', sourceStateVersion: 'rsv2:new' } })
    await elements().updateMany({}, { $set: { stateVersion: 'rsv2:new', sourceStateVersion: 'rsv2:new', label: 'New basis' } })
  })
  const result = await getRuntimeStateGraphNeighbourhood({ ...args, ...evidenceQuery })
  expect(result.control.stateVersion).toBe(version)
  expect(result.graph.graphHash).toBe(evidenceQuery.graphHash)
  expect(result.graph.nodes.every(node => node.label !== 'New basis')).toBe(true)
  expect(result.graph.neighbourhood.evidenceSelection.evidenceObjectId).toBe(evidenceQuery.evidenceObjectId)
})

const seedStar = async () => {
  const args = await seedProjection()
  await elements().updateMany({ elementType: 'EDGE' }, { $set: { fromElementKey: 'source-000' } })
  return args
}

test('selected neighbourhood beyond the flat first page reads exact incoming relationship and isolated direction', async () => {
  const args = await seedProjection()
  const incoming = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'evidence-049', mode: 'Lineage' })
  expect(incoming.graph.edges.map(edge => edge.edgeId)).toEqual(['edge-049'])
  expect(incoming.graph.nodes.map(node => node.nodeId)).toEqual(['evidence-049', 'source-049'])
  expect(incoming.graph.neighbourhood).toMatchObject({ nodeId: 'evidence-049', depth: 1, direction: 'INCOMING', complete: true, continuation: 'EXHAUSTED' })
  const outgoing = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'evidence-049', mode: 'Impact' })
  expect(outgoing.graph.nodes.map(node => node.nodeId)).toEqual(['evidence-049'])
  expect(outgoing.graph.edges).toEqual([])
  expect(outgoing.graph.neighbourhood.complete).toBe(true)
  expect(outgoing.graph.projection.truncated).toBe(true)
})

test('48-edge page and verified continuation keep same-snapshot native bounds and honest completeness', async () => {
  const args = await seedStar(), commands = [], client = mongoose.connection.getClient()
  const listener = event => commands.push(event.command)
  client.on('commandStarted', listener)
  let first
  try { first = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery }) }
  finally { client.off('commandStarted', listener) }
  expect(first.graph.edges).toHaveLength(48); expect(first.graph.nodes).toHaveLength(49)
  expect(first.graph.neighbourhood).toMatchObject({ complete: false, continuation: 'MAY_HAVE_MORE', nextAfterEdgeKey: 'edge-047' })
  const reads = commands.filter(command => command.find || command.aggregate)
  for (const command of reads) {
    expect(command.maxTimeMS).toBeGreaterThan(0); expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false); expect(command.lsid).toEqual(reads[0].lsid); expect(command.txnNumber).toEqual(reads[0].txnNumber)
  }
  const elementReads = reads.filter(command => command.find === 'runtime_graph_elements')
  expect(elementReads.map(command => command.limit)).toEqual([2, 48, 49])
  expect(elementReads.every(command => command.collation?.locale === 'simple')).toBe(true)
  expect(Object.fromEntries(elementReads[1].sort)).toEqual({ elementKey: 1 })
  expect(commands.some(command => command.getMore || command.insert || command.update || command.delete || command.findAndModify)).toBe(false)
  const { readReceipt, ...payload } = first
  expect(readReceipt.serializedPayloadBytes).toBe(Buffer.byteLength(JSON.stringify(payload)))
  expect(readReceipt.source).toBe('runtime_state_v2.graph_neighbourhood')
  const second = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, afterEdgeKey: first.graph.neighbourhood.nextAfterEdgeKey })
  expect(second.graph.edges.map(edge => edge.edgeId)).toEqual(['edge-048', 'edge-049'])
  expect(second.graph.neighbourhood).toMatchObject({ complete: false, continuation: 'EXHAUSTED', nextAfterEdgeKey: null })
})

test('exactly48 may have more yields an empty exhausted continuation without inventing another edge', async () => {
  const args = await seedStar()
  await elements().deleteMany({ elementType: 'EDGE', elementKey: { $gte: 'edge-048' } })
  await graphs().updateOne({}, { $set: { 'counts.edgeCount': 48 } })
  const first = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })
  expect(first.graph.neighbourhood.continuation).toBe('MAY_HAVE_MORE')
  const next = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, afterEdgeKey: first.graph.neighbourhood.nextAfterEdgeKey })
  expect(next.graph.edges).toEqual([]); expect(next.graph.nodes.map(node => node.nodeId)).toEqual(['source-000'])
  expect(next.graph.neighbourhood).toMatchObject({ continuation: 'EXHAUSTED', complete: false })
})

test('self-loop is returned once and isolated visible node remains inspectable', async () => {
  const args = await seedProjection()
  await elements().updateOne({ elementKey: 'edge-000' }, { $set: { toElementKey: 'source-000' } })
  const loop = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })
  expect(loop.graph.edges).toHaveLength(1); expect(loop.graph.nodes).toHaveLength(1)
  const isolated = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'evidence-000' })
  expect(isolated.graph.nodes).toHaveLength(1); expect(isolated.graph.edges).toEqual([])
})

test.each([{}, { customerVisible: false, nodeType: 'SOURCE' }, { nodeType: 'UNSUPPORTED' }])('missing/private/unsupported selection returns generic404 %#', async attributes => {
  const args = await seedProjection()
  await elements().updateOne({ elementKey: 'source-000' }, { $set: { attributes } })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 404, message: 'The selected graph object is unavailable.' })
})

test.each([
  { isCurrent: false }, { sourceStateVersion: 'rsv2:old' }, { stateStatus: 'STALE' },
])('selected node malformed current basis remains409 %#', async change => {
  const args = await seedProjection()
  await elements().updateOne({ elementKey: 'source-000' }, { $set: change })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 409 })
})

test('changed graph basis, missing selection, wrong cursor direction and wrong scope fail closed', async () => {
  const args = await seedProjection()
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, graphHash: 'sha256:' + 'c'.repeat(64) })).rejects.toMatchObject({ status: 409 })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'absent' })).rejects.toMatchObject({ status: 404 })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, afterEdgeKey: 'edge-049' })).rejects.toMatchObject({ status: 400 })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, afterEdgeKey: 'edge-000', mode: 'Lineage' })).rejects.toMatchObject({ status: 400 })
  const response = await request(mounted(args)).get(`/${key}/state/graph-neighbourhood`).query({ ...query, ...neighbourhoodQuery, tenantId: String(new mongoose.Types.ObjectId()) })
  expect(response.status).toBe(404); expect(response.body.data).toBeUndefined()
})

test.each([
  { nodeId: '' }, { nodeId: ['source-000', 'evidence-000'] }, { nodeId: 'x'.repeat(241) }, { nodeId: 'source\u0001id' },
  { mode: 'Gaps' }, { graphHash: '' }, { afterEdgeKey: '' }, { afterEdgeKey: { $gt: '' } }, { extra: 'not-allowed' },
])('malformed selection is rejected before reads in mounted route and direct service %#', async invalid => {
  const args = await seedProjection(), selection = { ...neighbourhoodQuery, ...invalid }
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...selection })).rejects.toMatchObject({ status: 400 })
  const response = await request(mounted(args)).get(`/${key}/state/graph-neighbourhood`).query({ ...query, ...selection })
  expect(response.status).toBe(422); expect(response.body.data).toBeUndefined()
})

test('duplicate selected nodes and missing endpoints prevent a success receipt', async () => {
  const args = await seedProjection(), original = await elements().findOne({ elementKey: 'source-000' })
  const { _id, ...duplicate } = original
  await elements().insertOne(duplicate)
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 409 })
  await elements().deleteOne({ _id })
  await elements().deleteOne({ elementKey: 'evidence-000' })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 409 })
})

test('mounted neighbourhood serves locked exact inspection but rejects revoked role and licence', async () => {
  const args = await seedProjection(), app = mounted(args), endpoint = `/${key}/state/graph-neighbourhood`
  await RuntimeInstance.collection.updateOne({}, { $set: { lockedAt: new Date(), status: 'LOCKED' } })
  const response = await request(app).get(endpoint).query({ ...query, ...neighbourhoodQuery })
  expect(response.status).toBe(200); expect(response.body.data.graph.neighbourhood.nodeId).toBe('source-000')
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  expect((await request(app).get(endpoint).query({ ...query, ...neighbourhoodQuery })).status).toBe(403)
  await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
  await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(app).get(endpoint).query({ ...query, ...neighbourhoodQuery })).status).toBe(403)
})

test('neighbourhood concurrent replacement remains one original snapshot', async () => {
  const args = await seedProjection()
  beforeEdges(async () => {
    await RuntimeInstance.collection.updateOne({}, { $set: { stateVersion: 'rsv2:new' } })
    await graphs().updateOne({}, { $set: { graphHash: 'sha256:' + 'c'.repeat(64), stateVersion: 'rsv2:new', sourceStateVersion: 'rsv2:new' } })
    await elements().updateMany({}, { $set: { stateVersion: 'rsv2:new', sourceStateVersion: 'rsv2:new', label: 'New basis' } })
  })
  const result = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })
  expect(result.control.stateVersion).toBe(version)
  expect(result.graph.graphHash).toBe(neighbourhoodQuery.graphHash)
  expect(result.graph.nodes.every(node => node.label !== 'New basis')).toBe(true)
})

test('stalled selected-neighbourhood native page read fails within its deadline', async () => {
  const args = await seedProjection()
  beforeEdges(async () => {
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  })
  const began = Date.now()
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 503 })
  expect(Date.now() - began).toBeLessThan(3500)
}, 15000)

test('neighbourhood private endpoint and edge expose structural placeholders without any recorded private facts', async () => {
  const args = await seedProjection(), secret = 'SS042_PRIVATE_NEIGHBOUR_FACT'
  await elements().updateOne({ elementKey: 'evidence-000' }, { $set: { label: secret, attributes: {
    customerVisible: false, nodeType: 'EVIDENCE', entityDisplayName: secret, sourceId: secret,
    evidenceObjectId: secret, sectionKey: secret, frameworkKey: secret, packageKey: secret,
    reviewStatus: secret, graphQualityState: secret, metadata: { confidenceReason: secret },
  } } })
  await elements().updateOne({ elementKey: 'edge-000' }, { $set: { label: secret, attributes: {
    customerVisible: false, basis: secret, contributesTo: [secret], validationState: secret,
    relationshipDisplayName: secret, relationshipDefinitionKey: secret,
  } } })
  const result = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(result.graph.nodes.find(node => node.nodeId === 'evidence-000')).toEqual({ nodeId: 'evidence-000', customerVisible: false })
  expect(result.graph.edges).toEqual([{ edgeId: 'edge-000', fromNodeId: 'source-000', toNodeId: 'evidence-000', customerVisible: false }])
  expect(result.graph.neighbourhood).toMatchObject({ complete: true, completenessBasis: 'RECORDED_ONE_HOP_EDGES' })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'evidence-000' })).rejects.toMatchObject({ status: 404 })
  const flat = await getRuntimeStateGraphProjection(args)
  expect(JSON.stringify(flat)).not.toContain(secret)
  expect(flat.graph.nodes.find(node => node.nodeId === 'evidence-000')).toEqual({ nodeId: 'evidence-000', customerVisible: false })
  expect(flat.graph.nodes.find(node => node.nodeId === 'source-000')).toMatchObject({ label: 'Source 000', sourceId: 'canonical-source-000', customerVisible: true })
})

test('private source facts are redacted before serialization while structural counts remain unchanged', async () => {
  const args = await seedProjection(), secret = 'SS042_PRIVATE_SOURCE_FACT'
  await elements().updateOne({ elementKey: 'source-000' }, { $set: { label: secret, summary: secret, attributes: {
    customerVisible: false, nodeType: 'SOURCE', sourceId: secret, entityDisplayName: secret,
    coverageDomain: secret, sectionKey: secret, frameworkKey: secret, packageKey: secret,
    reviewStatus: secret, graphQualityState: secret, metadata: { confidenceReason: secret, confidenceFactors: [secret] },
  } } })
  const flat = await getRuntimeStateGraphProjection(args)
  expect(JSON.stringify(flat)).not.toContain(secret)
  expect(flat.graph.nodes).toHaveLength(96); expect(flat.graph.edges).toHaveLength(48)
  expect(flat.graph.nodes.find(node => node.nodeId === 'source-000')).toEqual({ nodeId: 'source-000', customerVisible: false })
  const neighbour = await getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery, nodeId: 'evidence-000', mode: 'Lineage' })
  expect(JSON.stringify(neighbour)).not.toContain(secret)
  expect(neighbour.graph.nodes.find(node => node.nodeId === 'source-000')).toEqual({ nodeId: 'source-000', customerVisible: false })
  await expect(getRuntimeStateGraphNeighbourhood({ ...args, ...neighbourhoodQuery })).rejects.toMatchObject({ status: 404 })
})
