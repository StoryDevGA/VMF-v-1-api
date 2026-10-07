import { beforeAll, afterAll, beforeEach, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { Customer, Tenant, LicenseLevel, Role, User } from '../models/index.js'
import AuditLog from '../models/AuditLog.js'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformPermission } from '../middleware/authorize.js'
import tokenService from '../services/tokenService.js'
import performanceCacheService from '../services/performanceCacheService.js'
import { updateRole } from '../controllers/role.controller.js'
import { getRuntimeStateEvidenceInventory } from '../services/runtimeStateRepository.js'
import { getRuntimeStateEvidenceInventory as controller } from '../controllers/runtimeInstance.controller.js'
import { validateRuntimeInstanceId } from '../validators/runtimeInstance.validator.js'
import { validateReviewCompletionScope } from '../validators/reviewCompletion.validator.js'
import { projectIntelligenceEvidenceInventory } from '../services/intelligenceEvidenceInventory.js'
import { assembleOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'

let replica
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, new mongoose.Types.ObjectId()]))
const version = 'rsv2:inventory-current'
const key = 'ss042-isolated-inventory'
const scope = { ...ids, runtimeInstanceKey: key, stateVersion: version, sourceStateVersion: version, current: true }
const collection = name => mongoose.connection.db.collection(name)
const childCollections = ['runtime_section_states', 'runtime_evidence_objects', 'runtime_evidence_sources']
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  await mongoose.connect(replica.getUri('ss042_inventory_' + randomUUID().replaceAll('-', '')), { autoIndex: false, autoCreate: false, monitorCommands: true })
  for (const model of [RuntimeInstance, Customer, Tenant, LicenseLevel, Role, User, AuditLog]) await model.createCollection()
  for (const name of childCollections) await mongoose.connection.db.createCollection(name)
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  for (const name of childCollections) await collection(name).deleteMany({})
  for (const model of [RuntimeInstance, Customer, Tenant, LicenseLevel, Role, User, AuditLog]) await model.collection.deleteMany({})
}, 15000)
const seed = async (count = 160, references = ['e0000']) => {
  const licence = new mongoose.Types.ObjectId()
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceKey: key, runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE', stateVersion: version, updatedAt: new Date(),
    framework_state: { evidence_pack: { accepted: true } } })
  await Customer.collection.insertOne({ _id: ids.customerId, status: 'ACTIVE', topology: 'SINGLE_TENANT', licenseLevelId: licence, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenantId, customerId: ids.customerId })
  await LicenseLevel.collection.insertOne({ _id: licence, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', name: 'Isolated customer reviewer', scope: 'CUSTOMER', isActive: true, isSystem: false, permissions: ['VMF_VIEW'] })
  await collection(childCollections[0]).insertOne({ ...scope, sectionKey: 'market', sectionDetail: { accepted: { supportingEvidenceRefs: references } } })
  await collection(childCollections[2]).insertOne({ ...scope, sourceId: 'source-one', sourceType: 'UPLOADED_DOCUMENT', contentHash: 'sha256:' + 'b'.repeat(64) })
  if (count) await collection(childCollections[1]).insertMany(Array.from({ length: count }, (_, index) => ({ ...scope,
    evidenceObjectId: 'e' + String(index).padStart(4, '0'), sourceId: 'source-one', extractedFact: 'Private stored evidence body',
    proofDependency: [], reviewStatus: 'ACCEPTED', validationStatus: 'VALID' })))
  return { customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId), customerId: String(ids.customerId) },
    resolvedPermissions: { customers: [{ customerId: String(ids.customerId), roleKeys: ['CUSTOMER_ADMIN'], permissions: ['VMF_VIEW'] }] } }
}
const mounted = scopes => {
  const app = express()
  app.use((req, _res, next) => { req.scopes = scopes; next() })
  app.get('/:runtimeInstanceId/state/evidence-inventory', validateRuntimeInstanceId, validateReviewCompletionScope, controller)
  app.use((error, _req, res, _next) => res.status(500).json({ error: { message: error.message } }))
  return app
}
const path = `/${key}/state/evidence-inventory`
const query = { customerId: String(ids.customerId), tenantId: String(ids.tenantId) }
test('native complete inventory covers multiple pages but exposes no bodies or storage IDs', async () => {
  const scopes = await seed()
  const events = []; const listener = event => events.push(event.command)
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  let result
  try { result = await getRuntimeStateEvidenceInventory({ scopes, runtimeInstanceId: key }) }
  finally { client.off('commandStarted', listener) }
  expect(result).toMatchObject({ completeness: 'COMPLETE', basis: 'CURRENT_STORED_INVENTORY', currency: 'AS_READ',
    evidence: { expectedCount: 160, readCount: 160 }, sources: { expectedCount: 1, readCount: 1 },
    upstreamContractVersion: 'outcome-evidence-inventory.v1', sectionMapping: { state: 'REFERENCES_RESOLVED' } })
  expect(result.inventoryHash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(result)).not.toMatch(/Private stored|storageId|extractedFact|framework_state/)
  const evidenceReads = events.filter(command => command.find === childCollections[1])
  expect(evidenceReads).toHaveLength(4)
  for (const command of evidenceReads) { expect(command.limit).toBe(150); expect(command.batchSize).toBe(150); expect(command.maxTimeMS).toBeLessThanOrEqual(2000); expect(command.autocommit).toBe(false) }
  expect(events.some(command => command.getMore)).toBe(false)
  for (const command of events.filter(command => command.find || command.aggregate)) {
    expect(command.maxTimeMS).toBeGreaterThan(0)
    expect(command.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(command.autocommit).toBe(false)
  }
  for (const command of events.filter(command => command.find === RuntimeInstance.collection.name)) expect(command.projection['framework_state.evidence_pack']).toBeUndefined()
})
test('complete inventory with unresolved references is not fabricated incomplete inventory or target readiness', async () => {
  const scopes = await seed(2, ['missing-reference'])
  const result = await getRuntimeStateEvidenceInventory({ scopes, runtimeInstanceId: key })
  expect(result).toMatchObject({ completeness: 'COMPLETE', evidence: { readCount: 2 }, sectionMapping: { state: 'UNRESOLVED', unresolvedReferenceCount: 1 } })
  expect(result).not.toHaveProperty('ready'); expect(result).not.toHaveProperty('approved'); expect(result).not.toHaveProperty('snapshotId')
})
test('only a proved empty inventory returns complete zero', async () => {
  const scopes = await seed(0, [])
  expect(await getRuntimeStateEvidenceInventory({ scopes, runtimeInstanceId: key })).toMatchObject({ completeness: 'COMPLETE', evidence: { expectedCount: 0, readCount: 0 } })
})
test.each(['missing-source', 'stale-version', 'duplicate-evidence', 'non-current'])('native %s does not produce a complete receipt or leak raw failure receipts', async reason => {
  const scopes = await seed(2)
  if (reason === 'missing-source') await collection(childCollections[2]).deleteMany({})
  if (reason === 'stale-version') await collection(childCollections[1]).updateOne({}, { $set: { sourceStateVersion: 'other' } })
  if (reason === 'duplicate-evidence') await collection(childCollections[1]).updateOne({ evidenceObjectId: 'e0001' }, { $set: { evidenceObjectId: 'e0000' } })
  if (reason === 'non-current') await collection(childCollections[1]).updateOne({}, { $set: { isCurrent: false } })
  const response = await request(mounted(scopes)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
  expect(JSON.stringify(response.body)).not.toMatch(/snapshotReceipt|storageId|Private stored evidence body/)
})
test('legacy missing state version fails before a full evidence-pack fallback', async () => {
  const scopes = await seed(1)
  await RuntimeInstance.collection.updateOne({}, { $unset: { stateVersion: '' } })
  const find = jest.spyOn(RuntimeInstance.collection, 'findOne')
  await expect(getRuntimeStateEvidenceInventory({ scopes, runtimeInstanceId: key })).rejects.toMatchObject({ status: 503 })
  for (const [, options] of find.mock.calls) expect(options.projection['framework_state.evidence_pack']).toBeUndefined()
})
test('mounted scope validator, current role and licence are enforced', async () => {
  const scopes = await seed(2)
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(200)
  expect((await request(mounted(scopes)).get(path).query({ ...query, search: 'unsupported' })).status).toBe(422)
  const wrongTenant = await request(mounted(scopes)).get(path).query({ ...query, tenantId: String(new mongoose.Types.ObjectId()) })
  expect(wrongTenant.status).toBe(404); expect(wrongTenant.body.data).toBeUndefined()
  await Role.collection.updateOne({}, { $set: { permissions: [] } })
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(403)
})

test.each(['SINGLE_TENANT', 'MULTI_TENANT'].flatMap(topology =>
  ['missing', 'inactive', 'revoked', 'empty-roleKeys'].map(reason => [topology, reason])))('%s %s current customer role cannot hydrate inventory despite an old scope grant', async (topology, reason) => {
  const scopes = await seed(2)
  await Customer.collection.updateOne({}, { $set: { topology } })
  if (reason === 'missing') await Role.collection.deleteMany({})
  if (reason === 'inactive') await Role.collection.updateOne({}, { $set: { isActive: false } })
  if (reason === 'revoked') await Role.collection.updateOne({}, { $set: { permissions: [] } })
  if (reason === 'empty-roleKeys') scopes.resolvedPermissions.customers[0].roleKeys = []
  const commands = [], listener = event => commands.push(event.command)
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  let response
  try { response = await request(mounted(scopes)).get(path).query(query) }
  finally { client.off('commandStarted', listener) }
  expect(response.status).toBe(403)
  expect(response.body.data).toBeUndefined()
  expect(commands.some(command => childCollections.includes(command.find || command.aggregate))).toBe(false)
})

test.each(['SINGLE_TENANT', 'MULTI_TENANT'])('real authenticated %s refresh after role-controller revocation denies the inventory read', async topology => {
  await seed(2)
  await Customer.collection.updateOne({}, { $set: { topology } })
  const otherCustomer = new mongoose.Types.ObjectId(), otherTenant = new mongoose.Types.ObjectId(), otherRuntime = new mongoose.Types.ObjectId()
  const otherKey = 'ss042-other-customer-inventory'
  await Customer.collection.insertOne({ _id: otherCustomer, status: 'ACTIVE', topology: 'SINGLE_TENANT' })
  await Tenant.collection.insertOne({ _id: otherTenant, customerId: otherCustomer })
  await RuntimeInstance.collection.insertOne({ _id: otherRuntime, customerId: otherCustomer, tenantId: otherTenant,
    runtimeInstanceKey: otherKey, runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE', stateVersion: version })
  await Role.collection.insertOne({ key: 'SS_CUSTOMER_MEMBER', name: 'Isolated other customer membership', scope: 'CUSTOMER', isActive: true, permissions: [] })
  const reviewer = { _id: new mongoose.Types.ObjectId(), email: 'reviewer@ss042.invalid', name: 'Isolated reviewer', isActive: true,
    memberships: [{ customerId: ids.customerId, roles: ['CUSTOMER_ADMIN'] }, { customerId: otherCustomer, roles: ['SS_CUSTOMER_MEMBER'] }], tenantMemberships: [], vmfGrants: [] }
  const admin = { _id: new mongoose.Types.ObjectId(), email: 'admin@ss042.invalid', name: 'Isolated administrator', isActive: true,
    memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }], tenantMemberships: [], vmfGrants: [] }
  await User.collection.insertMany([reviewer, admin])
  await Role.collection.insertOne({ key: 'SUPER_ADMIN', name: 'Isolated platform administrator', scope: 'PLATFORM', isActive: true, permissions: ['ROLE_MANAGE'] })
  const reviewerToken = (await tokenService.generateTokens(reviewer)).accessToken
  const adminToken = (await tokenService.generateTokens(admin)).accessToken
  const invalidation = jest.spyOn(performanceCacheService, 'invalidateUserPermissionsForRoleKey')
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.context = {}; req.requestId = 'ss042-isolated-role-refresh'; next() })
  app.use(authJwt, loadScopes)
  app.get('/refreshed-scopes', (req, res) => res.json({ data: req.scopes.resolvedPermissions }))
  app.patch('/roles/:roleId', requirePlatformPermission('ROLE_MANAGE'), updateRole)
  app.get('/:runtimeInstanceId/state/evidence-inventory', validateRuntimeInstanceId, validateReviewCompletionScope, controller)
  app.use((_error, _req, res, _next) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE' } }))
  const access = () => request(app).get(path).set('Authorization', `Bearer ${reviewerToken}`).query(query)
  expect((await access()).status).toBe(200)
  const other = await request(app).get(`/${otherKey}/state/evidence-inventory`).set('Authorization', `Bearer ${reviewerToken}`)
    .query({ customerId: String(otherCustomer), tenantId: String(otherTenant) })
  expect(other.status).toBe(403)
  expect(other.body.data).toBeUndefined()
  const before = await request(app).get('/refreshed-scopes').set('Authorization', `Bearer ${reviewerToken}`)
  expect(before.body.data.customers[0].permissions).toContain('VMF_VIEW')
  const role = await Role.collection.findOne({ key: 'CUSTOMER_ADMIN' })
  const update = await request(app).patch(`/roles/${role._id}`).set('Authorization', `Bearer ${adminToken}`).send({ permissions: [] })
  expect(update.status).toBe(200)
  expect(invalidation).toHaveBeenCalledWith('CUSTOMER_ADMIN', expect.any(Object))
  expect((await Role.collection.findOne({ _id: role._id })).permissions).toEqual([])
  const after = await request(app).get('/refreshed-scopes').set('Authorization', `Bearer ${reviewerToken}`)
  expect(after.status).toBe(200)
  expect(after.body.data.customers.flatMap(bucket => bucket.permissions)).not.toContain('VMF_VIEW')
  const denied = await access()
  expect(denied.status).toBe(403)
  expect(denied.body.data).toBeUndefined()
  expect(await collection(childCollections[1]).countDocuments({})).toBe(2)
  // Test cache is disabled: this proves real fresh hydration and controller invocation,
  // not distributed Redis invalidation or externally verified Identity Plus.
})

test.each(['VMF', 'TENANT'])('active legacy %s customer placement retains permitted single-tenant access', async roleScope => {
  const scopes = await seed(2)
  await Role.collection.updateOne({ key: 'CUSTOMER_ADMIN' }, { $set: { key: 'SS_LEGACY_VIEWER', scope: roleScope } })
  scopes.resolvedPermissions.customers[0].roleKeys = ['SS_LEGACY_VIEWER']
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(200)
  await Customer.collection.updateOne({}, { $set: { topology: 'MULTI_TENANT' } })
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(403)
})

test('current TenantAdmin legacy grant retains exact assigned-tenant access on a multi-tenant customer', async () => {
  const scopes = await seed(2)
  await Customer.collection.updateOne({}, { $set: { topology: 'MULTI_TENANT' } })
  await Role.collection.updateOne({ key: 'CUSTOMER_ADMIN' }, { $set: { key: 'TENANT_ADMIN', scope: 'TENANT' } })
  scopes.resolvedPermissions.customers[0].roleKeys = ['TENANT_ADMIN']
  scopes.memberships = [{ customerId: String(ids.customerId), roles: ['TENANT_ADMIN'] }]
  scopes.tenantMemberships = [{ customerId: String(ids.customerId), tenantId: String(ids.tenantId), roles: ['TENANT_ADMIN'] }]
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(200)
  scopes.tenantMemberships = []
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(403)
})

test('existing explicit platform bypass retains scoped reads independently from customer role rows', async () => {
  const scopes = await seed(2)
  await Role.collection.deleteMany({})
  scopes.resolvedPermissions.platform = { roleKeys: ['SUPER_ADMIN'], permissions: [] }
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(200)
})

test('native current Role failure is unavailable without inventory hydration or internal error leakage', async () => {
  const scopes = await seed(2)
  jest.spyOn(Role.collection, 'find').mockRejectedValue(new Error('Private current role failure'))
  const response = await request(mounted(scopes)).get(path).query(query)
  expect(response.status).toBe(503)
  expect(response.body.data).toBeUndefined()
  expect(JSON.stringify(response.body)).not.toMatch(/Private current role/)
})
test('missing VMF licence denies the actual controller', async () => {
  const scopes = await seed(1); await LicenseLevel.collection.updateOne({}, { $set: { featureEntitlements: [] } })
  expect((await request(mounted(scopes)).get(path).query(query)).status).toBe(403)
})
test.each([Customer, Tenant, LicenseLevel])('rejected %s metadata is unavailable, never empty success', async model => {
  const scopes = await seed(1); jest.spyOn(model.collection, 'findOne').mockRejectedValue(new Error('Private native dependency failure'))
  const response = await request(mounted(scopes)).get(path).query(query)
  expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toMatch(/Private native/)
})
test('native stalled read is bounded by the transaction deadline and safely unavailable', async () => {
  const scopes = await seed(1)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 8000 } })
  const started = Date.now()
  const response = await request(mounted(scopes)).get(path).query(query)
  expect(response.status).toBe(503); expect(Date.now() - started).toBeLessThan(7500)
}, 15000)
test('expired work budget schedules no later metadata or inventory read', async () => {
  const scopes = await seed(1)
  const now = Date.now(); const commands = []
  const listener = event => {
    commands.push(event.command)
    if (event.command.find) jest.spyOn(Date, 'now').mockReturnValue(now + 6000)
  }
  const client = mongoose.connection.getClient(); client.on('commandStarted', listener)
  try { await expect(getRuntimeStateEvidenceInventory({ scopes, runtimeInstanceId: key })).rejects.toMatchObject({ status: 503 }) }
  finally { client.off('commandStarted', listener); jest.restoreAllMocks() }
  expect(commands.filter(command => command.find || command.aggregate)).toHaveLength(1)
})
test.each(['commitTransaction', 'abortTransaction'])('native %s failure remains safe and cleanup does not schedule another read', async failedCommand => {
  const scopes = await seed(1)
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: failedCommand === 'abortTransaction' ? 2 : 1 },
    data: { failCommands: failedCommand === 'abortTransaction' ? ['find', 'abortTransaction'] : ['commitTransaction'], errorCode: 2 } })
  const response = await request(mounted(scopes)).get(path).query(query)
  expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
  expect(JSON.stringify(response.body)).not.toMatch(/Private stored|snapshotReceipt/)
})
test('pure public projection rejects hash/count/scope tampering', async () => {
  const proofScope = { runtimeInstanceId: 'runtime', runtimeInstanceKey: 'key', customerId: 'customer', tenantId: 'tenant', stateVersion: version }
  const row = { _id: '001', ...proofScope, sourceId: 'source-one' }
  const assembled = await assembleOutcomeEvidenceInventory({ scope: proofScope, sections: [], count: async kind => kind === 'sources' ? 1 : 0,
    readPage: async kind => kind === 'sources' ? [row] : [], validateRows: () => {} })
  const snapshot = { ...assembled, inventoryReceipt: assembled.receipt, stateVersion: version }
  const control = { ...proofScope, id: proofScope.runtimeInstanceId }
  expect(projectIntelligenceEvidenceInventory({ snapshot, control, readAt: new Date().toISOString() }).sources.readCount).toBe(1)
  for (const field of ['overallHash', 'scope', 'collections']) {
    const tampered = structuredClone(snapshot)
    if (field === 'overallHash') tampered.inventoryReceipt.overallHash = 'a'.repeat(64)
    if (field === 'scope') tampered.inventoryReceipt.scope.tenantId = 'other'
    if (field === 'collections') tampered.inventoryReceipt.collections.sources.totalCount = 0
    expect(() => projectIntelligenceEvidenceInventory({ snapshot: tampered, control })).toThrow('unavailable')
  }
})
