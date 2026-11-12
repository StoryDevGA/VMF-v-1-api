import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect, jest } from '@jest/globals'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, resolve, relative, sep } from 'node:path'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import express from 'express'
import request from 'supertest'

// Only fixture registration/authority and the renderer's action projection are
// substituted. Persistence, scoped permission checks, writers and readers are real.
// This is isolated integration evidence, never native registration or JWT proof.
const shippedCatalogue = await import('../constants/controlledReplayBindings.js')
const catalogue = [], authority = jest.fn(), exclusions = jest.fn()
jest.unstable_mockModule('../constants/controlledReplayBindings.js', () => ({
  CONTROLLED_REPLAY_BINDINGS: catalogue,
  verifyControlledReplayAuthority: authority,
  verifyControlledReplayExclusions: exclusions,
}))
const { default: originalEnv } = await import('../config/env.js')
jest.unstable_mockModule('../config/env.js', () => ({ default: { ...originalEnv,
  nodeEnv: 'test', appEnv: 'development', outcomeStudioProviderEnabled: false,
} }))
const renderer = await import('../services/runtimeRendererService.js')
jest.unstable_mockModule('../services/runtimeRendererService.js', () => ({ ...renderer,
  getRuntimeRenderer: async () => ({ actions: [{ actionKey: 'BUILD_EVIDENCE_PACK', enabled: true }] }),
}))
const { RuntimeInstance, FrameworkPackage, RuntimePathRegistry, Customer, Tenant, LicenseLevel,
  RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection, RuntimeStateMigrationReceipt,
  RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog } = await import('../models/index.js')
const { default: Run } = await import('../models/RuntimeAcquisitionRun.js')
const { default: User } = await import('../models/User.js')
const { default: Role } = await import('../models/Role.js')
const { default: auditService } = await import('../services/auditService.js')
const { stageRuntimeStateNativeInitialization } = await import('../services/runtimeStateNativeInitializationService.js')
const { storedControlledReplayBindingDigest, assertControlledReplayProvenancePairs,
  controlledReplayProvenanceForRow } = await import('../services/controlledReplayContract.js')
const { controlledReplayIsolationCas } = await import('../services/controlledReplayIsolationService.js')
const { assertAcquisitionTerminalProof } = await import('../services/acquisitionReceiptProof.js')
const { readResearchConfiguration, writeResearchConfiguration, readAcquisitionRuns, readAcquisitionRun, cancelRecordedAcquisitionRun } = await import('../controllers/acquisitionRun.controller.js')
const { validateResearchConfigurationScope, validateResearchConfigurationSave, validateAcquisitionCancellation, validateAcquisitionRunParams, validateAcquisitionRunScope } = await import('../validators/acquisitionRun.validator.js')
const { default: authJwt } = await import('../middleware/authJwt.js')
const actualAcquisition = await import('../services/acquisitionRunService.js')
jest.unstable_mockModule('../services/acquisitionRunService.js', () => ({ ...actualAcquisition,
  handleAcquisitionFailure: async (context, error, pack) => {
    console.info(JSON.stringify({ proof: 'ISOLATED_ORIGINAL_ACQUISITION_FAILURE', error: {
      name: error.name, code: error.code, message: error.message, reason: error.details?.reason,
    }, extractionSettled: context.extractionSettled, rootPersistenceStarted: context.rootPersistenceStarted,
    transaction: context.transaction && { abortConfirmed: context.transaction.abortConfirmed,
      commitPossible: context.transaction.commitPossible } }))
    return actualAcquisition.handleAcquisitionFailure(context, error, pack)
  },
}))
const { executeRuntimeAction, getRuntimeStateSourceRegistry, getRuntimeStateEvidencePage } =
  await import('../controllers/runtimeInstance.controller.js')
const { validateRuntimeInstanceId, validateRuntimeActionParams, validateExecuteRuntimeAction } =
  await import('../validators/runtimeInstance.validator.js')

const childMode = process.env.VMF_CONTROLLED_REPLAY_CHILD_MODE
const isolated = process.env.VMF_CONTROLLED_REPLAY_ISOLATED === '1' && !childMode ? describe : describe.skip
const database = 'ss049_provider_free_slice'
const binaryHash = '919ce2ee9893ffcac72e95610f543beacce721a7c226867568856ca0754d49d8'
const isProofDataDirectory = dataDir => {
  if (!dataDir || !isAbsolute(dataDir)) return false
  const pathFromEvidence = relative(resolve('C:/Dev/StoryLineOS/VMF-Evidence'), resolve(dataDir))
  return Boolean(pathFromEvidence && !isAbsolute(pathFromEvidence) && pathFromEvidence !== '..'
    && !pathFromEvidence.startsWith(`..${sep}`))
}
describe('provider-free fixture data directory', () => {
  test.each([
    [resolve(process.cwd(), '..', '..fixture'), false],
    [resolve(process.cwd(), 'fixture-data'), false],
    ['C:/Dev/StoryLineOS/VMF-Evidence', false],
    ['C:/Dev/StoryLineOS/VMF-Evidence-other/fixture', false],
    ['D:/unapproved-fixture', false],
    ['relative-fixture', false],
    ['C:/Dev/StoryLineOS/VMF-Evidence/ss-049/review/mongo-data', true],
  ])('allows %s only when it is within the prescribed evidence root', (directory, allowed) => {
    expect(isProofDataDirectory(directory)).toBe(allowed)
  })
})
const models = [RuntimeInstance, FrameworkPackage, RuntimePathRegistry, Customer, Tenant, LicenseLevel,
  Run, RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection, RuntimeStateMigrationReceipt,
  RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog, User, Role]
const ids = Object.fromEntries(['runtime', 'customer', 'tenant', 'actor', 'package', 'license']
  .map((key, index) => [key, new mongoose.Types.ObjectId(String(index + 1).repeat(24))]))
const at = '2026-11-11T10:00:00.000Z'
const state = 'rsv2:11111111-1111-4111-8111-111111111111'
const runtimeKey = 'provider-free-replay-r1'
const fixture = { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
  fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
  htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777',
  sourceUrl: 'https://controlled-context.example/case-study' }
const binding = () => ({ contractVersion: 'controlled-replay-binding.v1', bindingId: 'isolated-provider-free.1',
  bindingVersion: 1, classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
  scope: { customerId: String(ids.customer), tenantId: String(ids.tenant), runtimeInstanceId: String(ids.runtime) },
  revisionId: runtimeKey, basisStateVersion: state, actorUserId: String(ids.actor),
  authorityRef: 'ISOLATED_TEST:authority', isolationRef: 'ISOLATED_TEST:exclusions', fixture })
const scopes = (permissions = ['VMF_VIEW', 'VMF_UPDATE']) => ({
  customer: { _id: String(ids.customer) }, tenant: { _id: String(ids.tenant), customerId: String(ids.customer) },
  resolvedPermissions: { tenants: [{ customerId: String(ids.customer), tenantId: String(ids.tenant), permissions }] },
})
const body = () => ({ controlledReplay: { bindingId: binding().bindingId }, expectedUpdatedAt: at,
  requestKey: randomUUID(), acquisitionProfile: 'STANDARD' })
const digest = value => createHash('sha256').update(mongoose.mongo.BSON.serialize(value)).digest('hex')
const appFor = (selectedScopes = scopes(), actorId = String(ids.actor)) => {
  const app = express()
  app.use(express.json(), (req, _res, next) => {
    req.scopes = selectedScopes; req.context = { userId: actorId }; req.requestId = randomUUID(); next()
  })
  app.post('/:runtimeInstanceId/actions/:actionKey', validateRuntimeActionParams, validateExecuteRuntimeAction, executeRuntimeAction)
  app.get('/:runtimeInstanceId/state/sources', validateRuntimeInstanceId, getRuntimeStateSourceRegistry)
  app.get('/:runtimeInstanceId/state/evidence', validateRuntimeInstanceId, getRuntimeStateEvidencePage)
  app.get('/:runtimeInstanceId/acquisition-runs', validateRuntimeInstanceId, validateAcquisitionRunScope, readAcquisitionRuns)
  app.get('/:runtimeInstanceId/acquisition-runs/:runId', validateAcquisitionRunParams, validateResearchConfigurationScope, readAcquisitionRun)
  app.post('/:runtimeInstanceId/acquisition-runs/:runId/cancel', validateAcquisitionRunParams, validateResearchConfigurationScope, validateAcquisitionCancellation, cancelRecordedAcquisitionRun)
  app.get('/:runtimeInstanceId/research-configuration', validateRuntimeInstanceId, validateResearchConfigurationScope, readResearchConfiguration)
  app.put('/:runtimeInstanceId/research-configuration', validateRuntimeInstanceId, validateResearchConfigurationScope,
    validateResearchConfigurationSave, writeResearchConfiguration)
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR', message: error.message, details: error.details },
  }))
  return app
}

isolated('provider-free acquisition through real persistence and ordinary readers', () => {
  let replica, owned = false, connected = false
  const assertOwned = () => {
    if (!owned || mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== database)
      throw new Error('Owned isolated provider-free database required.')
  }
  const snapshotMaterial = async () => {
    assertOwned()
    return Object.fromEntries(await Promise.all(models.filter(model => ![Run, AuditLog].includes(model)).map(async model => {
      const rows = await model.collection.find({}).sort({ _id: 1 }).toArray()
      return [model.collection.name, rows.map(row => [String(row._id), digest(row)])]
    })))
  }
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) throw new Error('Disconnected fixture process required.')
    const binary = process.env.VMF_CONTROLLED_REPLAY_MONGOD
    const dataDir = process.env.VMF_CONTROLLED_REPLAY_DATA_DIR
    if (!binary || createHash('sha256').update(readFileSync(binary)).digest('hex') !== binaryHash)
      throw new Error('Reviewed installed mongod binary required; no download fallback.')
    if (!isProofDataDirectory(dataDir))
      throw new Error('Explicit external fixture data directory required.')
    replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: '7.0.14' },
      replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ dbPath: dataDir }] })
    const uri = replica.getUri(database)
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Owned loopback replica required.')
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, maxPoolSize: 6,
      serverSelectionTimeoutMS: 10000 })
    connected = true
    if (mongoose.connection.name !== database || (await mongoose.connection.db.listCollections().toArray()).length)
      throw new Error('Empty fixed fixture database required.')
    owned = true; assertOwned()
    for (const model of models) await model.createCollection()
    for (const model of [Run, RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeInstance]) await model.createIndexes()
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
  }, 120000)
  afterAll(async () => {
    jest.restoreAllMocks()
    try {
      if (connected) { assertOwned(); await mongoose.disconnect(); connected = false }
    } finally { await replica?.stop({ doCleanup: false, force: false }); owned = false }
  })
  beforeEach(async () => {
    assertOwned(); jest.restoreAllMocks()
    const actual = (await mongoose.connection.db.listCollections().toArray()).map(row => row.name).sort()
    expect(actual).toEqual(models.map(model => model.collection.name).sort())
    for (const model of models) await model.collection.deleteMany({})
    catalogue.splice(0, catalogue.length, { binding: binding() })
    authority.mockReset().mockResolvedValue({ classification: 'ISOLATED_TEST_SEAM', authorityRef: binding().authorityRef })
    exclusions.mockReset().mockResolvedValue({ classification: 'ISOLATED_TEST_SEAM', isolationRef: binding().isolationRef,
      parlon: false, heldSs044Family: false })
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Provider-free fixture forbids network fetch.') })
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(() => { throw new Error('Provider-free fixture forbids DNS.') })
    await Customer.collection.insertOne({ _id: ids.customer, topology: 'SINGLE_TENANT', licenseLevelId: ids.license, entitlements: [] })
    await Tenant.collection.insertOne({ _id: ids.tenant, customerId: ids.customer })
    await LicenseLevel.collection.insertOne({ _id: ids.license, isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
    await FrameworkPackage.collection.insertOne({ _id: ids.package, frameworkKey: 'VMF', packageKey: 'provider-free-fixture',
      version: '1.0.0', sections: [] })
    await RuntimePathRegistry.collection.insertOne({ pathKey: 'framework_state.evidence_pack', status: 'ACTIVE',
      frameworkKeys: ['VMF'], allowedOperations: ['READ', 'WRITE'], dataType: 'OBJECT' })
    const runtime = { _id: ids.runtime, customerId: ids.customer, tenantId: ids.tenant,
      runtimeInstanceKey: runtimeKey, runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: ids.package,
      packageKey: 'provider-free-fixture', packageVersion: '1.0.0', revision: { revisionNumber: 1 },
      status: 'ACTIVE', executionStatus: 'IDLE', stateVersion: state, createdAt: new Date(at), updatedAt: new Date(at),
      framework_state: {} }
    await RuntimeInstance.collection.insertOne(runtime)
    const session = await mongoose.startSession()
    try { await session.withTransaction(() => stageRuntimeStateNativeInitialization({ runtimeInstance: runtime,
      actorUserId: ids.actor, session, now: new Date(at) })) } finally { await session.endSession() }
  })
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
    delete globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
    jest.restoreAllMocks()
  })
  const acquire = (app = appFor(), payload = body()) => request(app)
    .post(`/${runtimeKey}/actions/BUILD_EVIDENCE_PACK`).send(payload)
  const currentRoot = () => RuntimeInstance.collection.findOne({ _id: ids.runtime })
  const configQuery = { customerId: String(ids.customer), tenantId: String(ids.tenant) }
  const configPath = `/${runtimeKey}/research-configuration`
  const configurationBody = (previous = null) => ({ expectedUpdatedAt: at, expectedStateVersion: state,
    expectedConfigurationVersion: previous?.configurationVersion || null,
    context: { companyName: 'SS049 saved settings fixture', marketRegion: 'Synthetic UK scope', targetOffer: 'Synthetic service', notes: '' },
    coverage: 'STANDARD', settings: { startingUrls: ['https://fixture.example/'], legalEntity: 'SS049 Fixture Ltd', countryCode: 'GB',
      entityIdentifier: 'fixture-only', entityConfirmed: true, ukSubsidiary: false,
      sources: ['WEBSITE', 'SEARCH', 'REGISTRY'], instructions: 'Provider-free configuration only.' } })
  const putConfiguration = (payload = configurationBody(), app = appFor()) => request(app).put(configPath).query(configQuery).send(payload)
  const readConfiguration = (app = appFor()) => request(app).get(configPath).query(configQuery)

  const prepareResearchDispatch = async () => {
    const settings = configurationBody(); settings.settings.sources = ['WEBSITE']; settings.settings.startingUrls = [fixture.sourceUrl]
    const saved = await putConfiguration(settings); expect(saved.status).toBe(200)
    const record = saved.body.data.configuration
    return { record, payload: { ...body(), researchConfiguration: { configurationVersion: record.configurationVersion,
      configurationHash: record.configurationHash, basisStateVersion: record.basisStateVersion } } }
  }
  const prepareNativeLocalRegistration = async () => {
    const entry = shippedCatalogue.CONTROLLED_REPLAY_BINDINGS[0], local = entry.local
    catalogue.splice(0, catalogue.length, entry)
    authority.mockImplementation(shippedCatalogue.verifyControlledReplayAuthority)
    exclusions.mockImplementation(shippedCatalogue.verifyControlledReplayExclusions)
    await User.create({ _id: ids.actor, name: local.actorName, email: 'local-research@fixture.invalid', isActive: true,
      memberships: [], vmfGrants: [], tenantMemberships: [{ customerId: ids.customer, tenantId: ids.tenant, roles: [local.roleKey] }] })
    await Role.create({ key: local.roleKey, name: 'Local research fixture operator', scope: 'TENANT', isActive: true, permissions: ['VMF_VIEW', 'VMF_UPDATE'] })
    await Customer.collection.updateOne({ _id: ids.customer }, { $set: { name: local.customerName, nameNormalized: local.customerName.toLowerCase(),
      status: 'ACTIVE', defaultTenantId: ids.tenant } })
    await Tenant.collection.updateOne({ _id: ids.tenant }, { $set: { name: local.tenantName, status: 'ENABLED', isDefault: true, tenantAdminUserIds: [ids.actor] } })
    const prepared = await prepareResearchDispatch()
    prepared.payload.controlledReplay = { bindingId: entry.binding.bindingId }
    const ready = await readConfiguration()
    if (ready.body.data?.availability.fixtureStart?.eligible !== true) console.info(JSON.stringify({ proof: 'LOCAL_REGISTRATION_BASELINE_UNAVAILABLE',
      environment: { nodeEnv: originalEnv.nodeEnv, appEnv: originalEnv.appEnv }, database: mongoose.connection.name, host: mongoose.connection.host,
      result: ready.body.data?.availability.fixtureStart, error: ready.body.error?.details }))
    expect(ready.status).toBe(200); expect(ready.body.data.availability.fixtureStart.eligible).toBe(true)
    return { ...prepared, entry }
  }
  test('the real local registration verifies native authority/exclusions and persists a qualified research Run', async () => {
    const { payload, entry } = await prepareNativeLocalRegistration()
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { 'revision.rootRuntimeInstanceKey': entry.binding.revisionId } })
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const read = await readConfiguration(); expect(read.status).toBe(200)
    expect(read.body.data.availability.fixtureStart).toMatchObject({ eligible: true, bindingId: entry.binding.bindingId })
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    const response = await acquire(appFor(), payload); expect(response.status).toBe(200)
    const run = await Run.findOne().lean(); expect(run).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true })
    expect(authority.mock.results.length).toBeGreaterThanOrEqual(5)
    expect(run.controlledReplayProvenance.binding).toEqual(entry.binding)
    const exact = await request(appFor()).get(`/${runtimeKey}/acquisition-runs/${run.runId}`).query(configQuery)
    expect(exact.status).toBe(200)
    const savedMaterial = await snapshotMaterial(), savedAudits = await AuditLog.countDocuments()
    const replay = await acquire(appFor(), payload)
    expect([replay.status, replay.body.error]).toEqual([200, undefined])
    expect(replay.body.data.acquisitionRun).toMatchObject({ runId: run.runId,
      executionAttemptId: run.executionAttemptId, replay: true, researchConfiguration: run.researchConfiguration })
    expect(await Run.countDocuments()).toBe(1)
    expect(await Run.findOne().lean()).toEqual(run)
    expect(await AuditLog.countDocuments()).toBe(savedAudits)
    expect(await snapshotMaterial()).toEqual(savedMaterial)
    const next = await acquire(appFor(), { ...payload, requestKey: randomUUID() })
    expect(next.status).toBe(409)
    expect(next.body.error.details.reason).toBe('RESEARCH_CONFIGURATION_STALE')
    expect(await Run.countDocuments()).toBe(1)
    expect(await Run.findOne().lean()).toEqual(run)
    expect(await AuditLog.countDocuments()).toBe(savedAudits)
    expect(await snapshotMaterial()).toEqual(savedMaterial)
    console.info(JSON.stringify({ proof: 'SECTION3_NATIVE_LOCAL_REGISTRATION', classification: 'ISOLATED_REAL_LOCAL_VERIFIERS',
      caveat: 'Principal and renderer remain disclosed integration seams; no normal-login/browser proof.', availability: read.body.data.availability.fixtureStart, run: exact.body.data }))
  })
  test.each(['inactive actor', 'shared actor', 'missing actor', 'missing permission', 'inactive role', 'missing role', 'Parlon tenant',
    'duplicate role', 'scalar permissions', 'array-like membership roles', 'disabled customer', 'wrong customer name', 'wrong tenant owner', 'held parent', 'parent key', 'foreign root key', 'stale root'])('real local registration rejects %s without dispatch', async kind => {
    const { payload } = await prepareNativeLocalRegistration()
    if (kind === 'inactive actor') await User.collection.updateOne({ _id: ids.actor }, { $set: { isActive: false } })
    if (kind === 'shared actor') await User.collection.updateOne({ _id: ids.actor }, { $push: { tenantMemberships: { customerId: ids.customer, tenantId: new mongoose.Types.ObjectId('a'.repeat(24)), roles: ['LOCAL_RESEARCH_OPERATOR'] } } })
    if (kind === 'missing actor') await User.collection.deleteOne({ _id: ids.actor })
    if (kind === 'missing permission') await Role.collection.updateOne({}, { $set: { permissions: ['VMF_VIEW'] } })
    if (kind === 'inactive role') await Role.collection.updateOne({}, { $set: { isActive: false } })
    if (kind === 'missing role') await Role.collection.deleteMany({})
    if (kind === 'duplicate role') await Role.collection.insertOne({ key: 'LOCAL_RESEARCH_OPERATOR', scope: 'TENANT', isActive: true, permissions: ['VMF_VIEW', 'VMF_UPDATE'] })
    if (kind === 'scalar permissions') await Role.collection.updateOne({}, { $set: { permissions: 'VMF_VIEW VMF_UPDATE' } })
    if (kind === 'array-like membership roles') await User.collection.updateOne({ _id: ids.actor }, { $set: { 'tenantMemberships.0.roles': { 0: 'LOCAL_RESEARCH_OPERATOR', length: 1 } } })
    if (kind === 'Parlon tenant') await Tenant.collection.updateOne({ _id: ids.tenant }, { $set: { name: 'Parlon' } })
    if (kind === 'disabled customer') await Customer.collection.updateOne({ _id: ids.customer }, { $set: { status: 'DISABLED' } })
    if (kind === 'wrong customer name') await Customer.collection.updateOne({ _id: ids.customer }, { $set: { name: 'Unknown owner' } })
    if (kind === 'wrong tenant owner') await Tenant.collection.updateOne({ _id: ids.tenant }, { $set: { customerId: new mongoose.Types.ObjectId('a'.repeat(24)) } })
    if (kind === 'held parent') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { 'revision.parentRuntimeId': new mongoose.Types.ObjectId('6ace5ee09bd4472c6be0cb07') } })
    if (kind === 'parent key') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { 'revision.parentRuntimeInstanceKey': 'ss044-disposable-synthetic-20261013-r1' } })
    if (kind === 'foreign root key') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { 'revision.rootRuntimeInstanceKey': 'foreign-root' } })
    if (kind === 'stale root') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { stateVersion: 'rsv2:22222222-2222-4222-8222-222222222222' } })
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const response = await acquire(appFor(), payload); expect(response.status).not.toBe(200)
    expect(await Run.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['actor', 'role', 'tenant'])('a rejected native %s dependency fails the mounted read and dispatch closed', async kind => {
    const { payload } = await prepareNativeLocalRegistration(), before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const model = kind === 'actor' ? User : kind === 'role' ? Role : Tenant
    const method = kind === 'role' ? 'find' : 'findById'
    const original = model[method].bind(model)
    jest.spyOn(model, method).mockImplementation((...args) => {
      const query = original(...args); query.lean = async () => { throw new Error('Native verification storage unavailable') }; return query
    })
    const read = await readConfiguration(); expect(read.status).toBe(503); expect(read.body.data).toBeUndefined()
    const response = await acquire(appFor(), payload); expect(response.status).toBe(503)
    expect(await Run.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['saved research', 'generic controlled fixture'])('native role revocation after RUNNING prevents the %s final evidence save', async kind => {
    const { payload } = await prepareNativeLocalRegistration(), before = await snapshotMaterial(), original = auditService.log.bind(auditService)
    if (kind === 'generic controlled fixture') delete payload.researchConfiguration
    const spy = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
      const audit = await original(input, options)
      if (input.diff?.phase === 'RUNNING') await Role.collection.updateOne({}, { $set: { isActive: false } })
      return audit
    })
    try { expect((await acquire(appFor(), payload)).status).not.toBe(200) } finally { spy.mockRestore() }
    expect((await Run.findOne().lean())).toMatchObject({ status: 'FAILED', canonicalSaved: false })
    expect(await RuntimeEvidenceSource.countDocuments()).toBe(0); expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
    const after = await snapshotMaterial(); delete before.roles; delete after.roles; expect(after).toEqual(before)
  })
  test.each(['forged registration', 'forged binding', 'wrong actor', 'wrong runtime', 'wrong environment', 'wrong database'])('real local authority refuses %s', async kind => {
    const { entry } = await prepareNativeLocalRegistration(), runtime = await currentRoot()
    const args = { registration: entry, binding: structuredClone(entry.binding), runtimeInstance: runtime, actorUserId: String(ids.actor) }
    const previousEnvironment = originalEnv.nodeEnv, previousName = mongoose.connection.name
    if (kind === 'forged registration') args.registration = structuredClone(entry)
    if (kind === 'forged binding') args.binding.authorityRef = 'forged:authority'
    if (kind === 'wrong actor') args.actorUserId = 'a'.repeat(24)
    if (kind === 'wrong runtime') args.runtimeInstance = { ...runtime, _id: new mongoose.Types.ObjectId('a'.repeat(24)) }
    if (kind === 'wrong environment') originalEnv.nodeEnv = 'production'
    if (kind === 'wrong database') mongoose.connection.name = 'unapproved_database'
    try {
      await expect(shippedCatalogue.verifyControlledReplayAuthority(args)).rejects.toMatchObject({ status: 409 })
      await expect(shippedCatalogue.verifyControlledReplayExclusions(args)).rejects.toMatchObject({ status: 409 })
    } finally { originalEnv.nodeEnv = previousEnvironment; mongoose.connection.name = previousName }
    expect(await Run.countDocuments()).toBe(0)
  })
  test('owned worker stop and a fresh reader preserve the original uncertain Run without redispatch', async () => {
    const { payload } = await prepareResearchDispatch(), before = await snapshotMaterial(), children = []
    const launch = mode => {
      const child = spawn(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('../../node_modules/jest/bin/jest.js', import.meta.url)),
        '--runInBand', '--runTestsByPath', fileURLToPath(import.meta.url), '--testNamePattern', '^owned interrupted worker child '], {
        cwd: process.cwd(), env: { ...process.env, VMF_CONTROLLED_REPLAY_CHILD_MODE: mode,
          VMF_CONTROLLED_REPLAY_CHILD_OWNED_URI: replica.getUri(database), VMF_CONTROLLED_REPLAY_CHILD_PAYLOAD: JSON.stringify(payload) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '', timer
      const exited = new Promise(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
        child.once('error', () => resolve({ code: null, signal: 'SPAWN_ERROR' }))
      })
      const event = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Owned child proof deadline: ' + output.slice(-3000))), 30000)
        const read = chunk => {
          output += chunk.toString()
          for (const line of output.split('\n')) {
            const start = line.indexOf('{"proof":"SECTION3_CHILD_')
            if (start < 0) continue
            try { const value = JSON.parse(line.slice(start).trim()); clearTimeout(timer); resolve(value) } catch { /* A split JSON line waits for its next chunk. */ }
          }
        }
        child.stdout.on('data', read); child.stderr.on('data', read)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Owned child exited before proof: ' + output.slice(-3000))) })
      })
      const ownedChild = { child, exited, event, output: () => output }; children.push(ownedChild)
      return ownedChild
    }
    try {
      const worker = launch('worker'), started = await worker.event
      expect(started.proof).toBe('SECTION3_CHILD_RUNNING'); expect(started.pid).toBe(worker.child.pid)
      const row = await Run.findOne({ requestKey: payload.requestKey }).lean()
      expect(row).toMatchObject({ runId: started.runId, executionAttemptId: started.executionAttemptId, status: 'RUNNING', active: true })
      const read = await request(appFor()).get(`/${runtimeKey}/acquisition-runs/${row.runId}`).query(configQuery)
      expect(read.status).toBe(200); expect(read.body.data.status).toBe('RUNNING'); expect(read.body.data.recovery).toMatch(/unconfirmed/)
      const count = await Run.countDocuments(), audits = await AuditLog.countDocuments()
      expect((await acquire(appFor(), payload)).status).toBe(409)
      expect(await Run.countDocuments()).toBe(count); expect(await AuditLog.countDocuments()).toBe(audits)
      expect(await snapshotMaterial()).toEqual(before)
      expect(worker.child.kill()).toBe(true); const stopped = await worker.exited
      expect(() => process.kill(started.pid, 0)).toThrow()
      const restarted = launch('reader'), observed = await restarted.event, exit = await restarted.exited
      expect(observed.proof).toBe('SECTION3_CHILD_READ'); expect(observed.pid).toBe(restarted.child.pid); expect(observed.pid).not.toBe(started.pid)
      expect(exit.code).toBe(0)
      expect(observed.data).toMatchObject({ runId: row.runId, executionAttemptId: row.executionAttemptId, requestKey: payload.requestKey,
        status: 'RUNNING', currency: 'ACTIVE' })
      expect(observed.data.canonicalSaved).toBeUndefined(); expect(observed.data.recovery).toMatch(/unconfirmed/)
      expect(await Run.findOne({ runId: row.runId }).lean()).toEqual(row)
      expect(await Run.countDocuments()).toBe(count); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
      console.info(JSON.stringify({ proof: 'SECTION3_WORKER_RESTART', classification: 'ISOLATED_PROCESS_RESTART_READ_ONLY',
        worker: started, stopped, reader: observed, count, audits, noRedispatch: true, materialUnchanged: true }))
    } finally {
      for (const ownedChild of children) {
        if (ownedChild.child.pid && ownedChild.child.exitCode === null && ownedChild.child.signalCode === null) ownedChild.child.kill()
        await ownedChild.exited
      }
    }
  }, 90000)
  const failedResearchPredecessor = async () => {
    const prepared = await prepareResearchDispatch(), original = auditService.logFromRequest.bind(auditService)
    const spy = jest.spyOn(auditService, 'logFromRequest').mockImplementation((req, input, options) => {
      if (input.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED) throw new Error('Fixture predecessor save refused')
      return original(req, input, options)
    })
    try { expect((await acquire(appFor(), prepared.payload)).status).not.toBe(200) } finally { spy.mockRestore() }
    const predecessor = await Run.findOne().lean()
    expect(predecessor).toMatchObject({ status: 'FAILED', canonicalSaved: false })
    return { ...prepared, predecessor, retry: { ...prepared.payload, requestKey: randomUUID(), predecessorRunId: predecessor.runId,
      predecessorExecutionAttemptId: predecessor.executionAttemptId } }
  }
  test('an explicit fixture retry creates a separate signed Run and Attempt, and its request replays without execution', async () => {
    const { predecessor, retry } = await failedResearchPredecessor(), original = await Run.findOne().lean()
    const result = await acquire(appFor(), retry); expect(result.status).toBe(200)
    const successor = await Run.findOne({ requestKey: retry.requestKey }).lean()
    expect(successor).toMatchObject({ status: 'SUCCEEDED', predecessorRunId: predecessor.runId, predecessorExecutionAttemptId: predecessor.executionAttemptId })
    expect(successor.runId).not.toBe(predecessor.runId); expect(successor.executionAttemptId).not.toBe(predecessor.executionAttemptId)
    expect(await Run.findOne({ runId: predecessor.runId }).lean()).toEqual(original)
    for (const id of [successor.admissionAuditId, successor.startAuditId, successor.terminalAuditId]) {
      const audit = await AuditLog.findById(id); expect(audit.verifySignature()).toBe(true)
      expect(audit.diff.researchRetry).toEqual({ predecessorRunId: predecessor.runId, predecessorExecutionAttemptId: predecessor.executionAttemptId })
    }
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    expect((await acquire(appFor(), retry)).status).toBe(200); expect(await Run.countDocuments()).toBe(2)
    expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
    const read = await request(appFor()).get(`/${runtimeKey}/acquisition-runs/${successor.runId}`).query(configQuery)
    expect(read.status).toBe(200); expect(read.body.data.executionAttemptId).toBe(successor.executionAttemptId)
    console.info(JSON.stringify({ proof: 'SECTION3_EXPLICIT_RETRY', predecessorRunId: predecessor.runId,
      predecessorExecutionAttemptId: predecessor.executionAttemptId, data: read.body.data }))
    expect((await acquire(appFor(), { ...retry, predecessorExecutionAttemptId: randomUUID() })).status).toBe(409)
    expect(await Run.countDocuments()).toBe(2)
  })
  test.each(['missing attempt', 'wrong attempt', 'wrong run', 'other actor', 'changed configuration'])('refuses fixture retry with %s without a new Run or evidence', async kind => {
    const { predecessor, retry, record } = await failedResearchPredecessor()
    if (kind === 'missing attempt') delete retry.predecessorExecutionAttemptId
    if (kind === 'wrong attempt') retry.predecessorExecutionAttemptId = randomUUID()
    if (kind === 'wrong run') retry.predecessorRunId = randomUUID()
    if (kind === 'other actor') await Run.collection.updateOne({ runId: predecessor.runId }, { $set: { actorUserId: new mongoose.Types.ObjectId('a'.repeat(24)) } })
    if (kind === 'changed configuration') {
      const settings = configurationBody(record); settings.settings.sources = ['WEBSITE']; settings.settings.startingUrls = [fixture.sourceUrl]
      settings.settings.instructions = 'Explicit replacement settings'
      const saved = await putConfiguration(settings); expect(saved.status).toBe(200)
      retry.researchConfiguration = { configurationVersion: saved.body.data.configuration.configurationVersion,
        configurationHash: saved.body.data.configuration.configurationHash, basisStateVersion: state }
    }
    const before = await snapshotMaterial(), count = await Run.countDocuments(), audits = await AuditLog.countDocuments()
    expect((await acquire(appFor(), retry)).status).not.toBe(200)
    expect(await Run.countDocuments()).toBe(count); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test('retry admission audit failure rolls back its new Run and retains the original failed receipt', async () => {
    const { retry } = await failedResearchPredecessor(), before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), original = auditService.log.bind(auditService)
    jest.spyOn(auditService, 'log').mockImplementation((input, options) => {
      if (input.diff?.phase === 'QUEUED') throw new Error('Retry admission audit refused')
      return original(input, options)
    })
    expect((await acquire(appFor(), retry)).status).not.toBe(200)
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['changed', 'removed'])('a %s predecessor Attempt cannot pass signed receipt read-back', async kind => {
    const { retry } = await failedResearchPredecessor(); expect((await acquire(appFor(), retry)).status).toBe(200)
    const successor = await Run.findOne({ requestKey: retry.requestKey }).lean()
    await Run.collection.updateOne({ runId: successor.runId }, kind === 'changed' ? { $set: { predecessorExecutionAttemptId: randomUUID() } } : { $unset: { predecessorExecutionAttemptId: '' } })
    const read = await request(appFor()).get(`/${runtimeKey}/acquisition-runs/${successor.runId}`).query(configQuery)
    expect(read.status).toBe(503)
  })
  test('fixture eligibility is a side-effect-free verified descriptor and POST rechecks it', async () => {
    const { record } = await prepareResearchDispatch(), before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const first = await readConfiguration(); expect(first.status).toBe(200)
    const descriptor = first.body.data.availability.fixtureStart
    expect(descriptor).toMatchObject({ eligible: true, classification: 'CONTROLLED_SYNTHETIC_REPLAY', bindingId: binding().bindingId,
      selector: { configurationVersion: record.configurationVersion, configurationHash: record.configurationHash, basisStateVersion: state } })
    expect(first.body.data.availability.canStart).toBe(false); expect(first.body.data.availability.executionEnabled).toBe(false)
    expect((await readConfiguration()).body.data.availability.fixtureStart).toEqual(descriptor)
    expect(await Run.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
    const body = { requestKey: randomUUID(), expectedUpdatedAt: descriptor.basis.updatedAt, acquisitionProfile: record.coverage,
      researchConfiguration: descriptor.selector, controlledReplay: { bindingId: descriptor.bindingId } }
    authority.mockRejectedValueOnce(Object.assign(new Error('Authority changed after read.'), { status: 409, code: 'CONFLICT', details: { reason: 'CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED' } }))
    expect((await acquire(appFor(), body)).status).toBe(409); expect(await Run.countDocuments()).toBe(0)
    console.info(JSON.stringify({ proof: 'SECTION3_FIXTURE_START_DESCRIPTOR', data: first.body.data, postRechecked: true, authority: 'ISOLATED_TEST_SEAM_NOT_NATIVE' }))
  })
  test.each(['empty registration', 'ambiguous registration', 'read-only', 'authority', 'exclusions', 'asset', 'dependency'])('fixture Start fails closed for %s', async kind => {
    await prepareResearchDispatch(); let app = appFor(), dependency
    if (kind === 'empty registration') catalogue.splice(0)
    if (kind === 'ambiguous registration') catalogue.push({ binding: binding() })
    if (kind === 'read-only') app = appFor(scopes(['VMF_VIEW']))
    if (kind === 'authority') authority.mockResolvedValueOnce({ authorityRef: 'wrong' })
    if (kind === 'exclusions') exclusions.mockResolvedValueOnce({ isolationRef: binding().isolationRef, parlon: true, heldSs044Family: false })
    if (kind === 'asset') catalogue[0].binding = { ...catalogue[0].binding, fixture: { ...catalogue[0].binding.fixture, fixtureFileSha256: '0'.repeat(64) } }
    if (kind === 'dependency') dependency = jest.spyOn(RuntimeInstance.collection, 'findOne').mockRejectedValueOnce(new Error('Required readiness dependency failed'))
    try {
      const response = await readConfiguration(app)
      if (kind === 'dependency') expect(response.status).toBe(500)
      else { expect(response.status).toBe(200); expect(response.body.data.availability.fixtureStart.eligible).toBe(false) }
      expect(await Run.countDocuments()).toBe(0)
    } finally { dependency?.mockRestore() }
  })
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  const holdResearchWorker = async (stage = 'RUNNING') => {
    const { record, payload } = await prepareResearchDispatch(), reached = deferred(), released = deferred()
    const name = stage === 'QUEUED' ? 'log' : 'logFromRequest', original = auditService[name].bind(auditService)
    const spy = jest.spyOn(auditService, name).mockImplementation(async (...args) => {
      const input = stage === 'QUEUED' ? args[0] : args[1], audit = await original(...args)
      if (stage === 'QUEUED' ? input.diff?.phase === 'RUNNING' : input.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED) {
        reached.resolve(); await released.promise
      }
      return audit
    })
    const worker = acquire(appFor(), payload).then(value => value)
    await Promise.race([reached.promise, worker.then(response => { throw new Error('Worker ended before barrier: ' + response.status + ' ' + JSON.stringify(response.body)) })])
    const row = await Run.findOne().lean()
    return { record, payload, row, worker, release: () => released.resolve(), restore: () => spy.mockRestore() }
  }
  const cancelRun = (row, app = appFor(), payload = { executionAttemptId: row.executionAttemptId }) => request(app)
    .post('/' + runtimeKey + '/acquisition-runs/' + row.runId + '/cancel').query(configQuery).send(payload)
  test.each(['QUEUED', 'RUNNING'])('owned request lookup reads saved %s progress and terminal continuity without redispatch', async stage => {
    const held = await holdResearchWorker(stage)
    try {
      const query = { ...configQuery, requestKey: held.payload.requestKey }, url = '/' + runtimeKey + '/acquisition-runs'
      const progress = await request(appFor()).get(url).query(query)
      expect(progress.status).toBe(200); expect(progress.body.data.requestedRequestKey).toBe(held.payload.requestKey)
      expect(progress.body.data.items).toHaveLength(1); expect(progress.body.data.items[0]).toMatchObject({ runId: held.row.runId, status: stage, requestKey: held.payload.requestKey })
      const other = await request(appFor(scopes(), '8'.repeat(24))).get(url).query(query)
      expect(other.status).toBe(200); expect(other.body.data.items).toEqual([])
      const unknown = await request(appFor()).get(url).query({ ...query, requestKey: randomUUID() })
      expect(unknown.status).toBe(200); expect(unknown.body.data.items).toEqual([])
      expect((await request(appFor()).get(url).query({ ...query, cursor: 'not-allowed' })).status).toBe(422)
      expect(await Run.countDocuments()).toBe(1)
      held.release(); expect((await held.worker).status).toBe(200)
      const reloaded = await request(appFor()).get(url).query(query)
      expect(reloaded.body.data.items).toHaveLength(1); expect(reloaded.body.data.items[0]).toMatchObject({ runId: held.row.runId, status: 'SUCCEEDED' })
      console.info(JSON.stringify({ proof: 'SECTION3_START_PROGRESS_LOOKUP', stage, requestKey: held.payload.requestKey, progress: progress.body.data, terminal: reloaded.body.data, runCount: 1, providerCalls: 0 }))
    } finally { held.release(); await held.worker; held.restore() }
  })
  test.each(['QUEUED', 'RUNNING'])('durable %s cancellation wins, fences the late worker and replays without another attempt', async stage => {
    const held = await holdResearchWorker(stage)
    try {
      const before = await snapshotMaterial()
      const current = await request(appFor()).get('/' + runtimeKey + '/acquisition-runs/' + held.row.runId).query(configQuery)
      expect(current.status).toBe(200); expect(current.body.data.cancellation).toMatchObject({ eligible: true, executionAttemptId: held.row.executionAttemptId })
      const cancelled = await cancelRun(held.row)
      expect(cancelled.status).toBe(200)
      expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', canonicalSaved: false, reason: 'CANCELLED_BEFORE_SAVE',
        cancellation: { eligible: false, executionAttemptId: held.row.executionAttemptId, stage, workerStopConfirmed: false } })
      if (stage === 'QUEUED') { expect(cancelled.body.data.startedAt).toBeUndefined(); expect(cancelled.body.data.audit.startId).toBeUndefined() }
      else expect(cancelled.body.data.audit.startId).toBeTruthy()
      const auditCount = await AuditLog.countDocuments(), repeated = await cancelRun(held.row)
      expect(repeated.status).toBe(200); expect(repeated.body.data).toEqual(cancelled.body.data); expect(await AuditLog.countDocuments()).toBe(auditCount)
      held.release(); const worker = await held.worker
      expect(worker.status).toBe(200); expect(worker.body.data.acquisitionRun.status).toBe('CANCELLED')
      expect(await snapshotMaterial()).toEqual(before)
      expect((await Run.findOne().lean()).executionAttemptId).toBe(held.row.executionAttemptId); expect(await Run.countDocuments()).toBe(1)
      expect(await AuditLog.countDocuments({ 'diff.phase': 'CANCELLED' })).toBe(1)
      if (stage === 'QUEUED') expect(await AuditLog.countDocuments({ 'diff.phase': 'RUNNING' })).toBe(0)
      const replay = await acquire(appFor(), held.payload)
      expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ status: 'CANCELLED', runId: held.row.runId, replay: true })
      const detail = await actualAcquisition.getAcquisitionRun({ scopes: scopes(), actorUserId: String(ids.actor), runtimeInstanceId: runtimeKey, runId: held.row.runId })
      console.info(JSON.stringify({ proof: 'SECTION3_DURABLE_CANCELLATION', stage, detail, lateWorkerFenced: true, unchangedMaterial: true, attemptCount: 1, providerCalls: 0, jwtProof: false }))
    } finally { held.release(); await held.worker; held.restore() }
  })
  test('completion wins a cancellation race without changing its saved evidence or retaining a cancelled audit', async () => {
    const held = await holdResearchWorker(), reached = deferred(), released = deferred(), original = auditService.log.bind(auditService)
    const spy = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
      const audit = await original(input, options)
      if (input.diff?.phase === 'CANCELLED') { reached.resolve(); await released.promise }
      return audit
    })
    try {
      const cancel = cancelRun(held.row).then(value => value); await Promise.race([reached.promise, cancel.then(response => { throw new Error('Cancellation ended before race barrier: ' + response.status + ' ' + JSON.stringify(response.body)) })])
      held.release(); expect((await held.worker).status).toBe(200)
      const saved = await snapshotMaterial(); released.resolve()
      const response = await cancel
      expect(response.status).toBe(409); expect(response.body.error.details.reason).toBe('ACQUISITION_ALREADY_COMPLETED')
      expect((await Run.findOne().lean()).status).toBe('SUCCEEDED'); expect(await snapshotMaterial()).toEqual(saved)
      expect(await AuditLog.countDocuments({ 'diff.phase': 'CANCELLED' })).toBe(0)
    } finally { released.resolve(); held.release(); await held.worker; held.restore(); spy.mockRestore() }
  })
  test('required cancellation audit failure rolls back the command and lets the original worker finish', async () => {
    const held = await holdResearchWorker('QUEUED'), original = auditService.log.bind(auditService), before = await snapshotMaterial()
    const spy = jest.spyOn(auditService, 'log').mockImplementation((input, options) => {
      if (input.diff?.phase === 'CANCELLED') throw new Error('Required cancellation audit failed')
      return original(input, options)
    })
    try {
      const response = await cancelRun(held.row)
      expect(response.status).toBe(500); expect((await Run.findOne().lean()).status).toBe('QUEUED')
      expect(await AuditLog.countDocuments({ 'diff.phase': 'CANCELLED' })).toBe(0); expect(await snapshotMaterial()).toEqual(before)
    } finally { spy.mockRestore(); held.release(); expect((await held.worker).status).toBe(200); held.restore() }
  })
  test.each(['wrong attempt', 'read-only', 'other actor', 'locked', 'stale basis', 'malformed', 'dependency rejection'])('cancellation refuses %s without mutating the active Run', async kind => {
    const held = await holdResearchWorker('QUEUED'); let app = appFor(), payload = { executionAttemptId: held.row.executionAttemptId }, dependency
    try {
      if (kind === 'wrong attempt') payload.executionAttemptId = randomUUID()
      if (kind === 'read-only') app = appFor(scopes(['VMF_VIEW']))
      if (kind === 'other actor') app = appFor(scopes(), '8'.repeat(24))
      if (kind === 'locked') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED' } })
      if (kind === 'stale basis') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { updatedAt: new Date('2026-11-12T14:00:00Z') } })
      if (kind === 'malformed') payload.extra = true
      const before = await snapshotMaterial(), rowBefore = await Run.findOne().lean()
      if (kind === 'dependency rejection') dependency = jest.spyOn(RuntimeInstance.collection, 'findOne').mockRejectedValueOnce(new Error('Required scope dependency failed'))
      const response = await cancelRun(held.row, app, payload)
      expect(response.status).toBe(({ 'wrong attempt': 409, 'read-only': 403, 'other actor': 403, locked: 409, 'stale basis': 409, malformed: 422, 'dependency rejection': 500 })[kind])
      dependency?.mockRestore(); expect(await Run.findOne().lean()).toEqual(rowBefore); expect(await snapshotMaterial()).toEqual(before)
      expect(await AuditLog.countDocuments({ 'diff.phase': 'CANCELLED' })).toBe(0)
    } finally { dependency?.mockRestore(); held.release(); await held.worker; held.restore() }
  })
  test('foreign cancellation scope cannot reach the active controlled Run', async () => {
    const held = await holdResearchWorker('QUEUED')
    try {
      const otherCustomer = new mongoose.Types.ObjectId('6'.repeat(24)), otherTenant = new mongoose.Types.ObjectId('7'.repeat(24)), shared = scopes()
      await Customer.collection.insertOne({ _id: otherCustomer, topology: 'SINGLE_TENANT', licenseLevelId: ids.license, entitlements: [] })
      await Tenant.collection.insertOne({ _id: otherTenant, customerId: otherCustomer })
      shared.resolvedPermissions.tenants.push({ customerId: String(otherCustomer), tenantId: String(otherTenant), permissions: ['VMF_VIEW', 'VMF_UPDATE'] })
      const before = await snapshotMaterial(), response = await request(appFor(shared)).post('/' + runtimeKey + '/acquisition-runs/' + held.row.runId + '/cancel')
        .query({ customerId: String(otherCustomer), tenantId: String(otherTenant) }).send({ executionAttemptId: held.row.executionAttemptId })
      expect(response.status).toBe(404); expect(await snapshotMaterial()).toEqual(before)
      expect((await Run.findOne().lean()).status).toBe('QUEUED')
    } finally { held.release(); await held.worker; held.restore() }
  })
  test('concurrent cancellation commands record one terminal audit and no new attempt', async () => {
    const held = await holdResearchWorker('QUEUED')
    try {
      const responses = await Promise.all([cancelRun(held.row), cancelRun(held.row)])
      expect(responses.map(row => row.status)).toEqual([200, 200]); expect(responses[0].body.data).toEqual(responses[1].body.data)
      expect(await AuditLog.countDocuments({ 'diff.phase': 'CANCELLED' })).toBe(1); expect(await Run.countDocuments()).toBe(1)
      held.release(); expect((await held.worker).body.data.acquisitionRun.status).toBe('CANCELLED')
    } finally { held.release(); await held.worker; held.restore() }
  })
  test('legacy acquisition is not made cancellable by the new endpoint', async () => {
    const runtime = await currentRoot(), payload = { expectedUpdatedAt: at, acquisitionProfile: 'STANDARD', requestKey: randomUUID() }
    const context = await actualAcquisition.lookupAcquisitionRequest({ runtimeInstance: runtime, payload, actorUserId: String(ids.actor), actionKey: 'BUILD_EVIDENCE_PACK' })
    await actualAcquisition.startAcquisitionRun(context, { companyName: 'Existing legacy fixture', marketRegion: 'Synthetic scope', targetOffer: 'Synthetic offer' })
    const before = await snapshotMaterial(), row = await Run.findOne().lean(), response = await cancelRun(row)
    expect(response.status).toBe(409); expect(response.body.error.details.reason).toBe('ACQUISITION_CANCELLATION_UNAVAILABLE')
    expect(await Run.findOne().lean()).toEqual(row); expect(await snapshotMaterial()).toEqual(before)
  })
  test('a cancelled receipt cannot fabricate worker stop or a queued start', async () => {
    const held = await holdResearchWorker('QUEUED')
    try {
      expect((await cancelRun(held.row)).status).toBe(200)
      held.release(); await held.worker
      const row = await Run.findOne().lean(), audit = await AuditLog.findById(row.terminalAuditId)
      expect(() => assertAcquisitionTerminalProof(row, audit)).not.toThrow()
      audit.diff.workerStopConfirmed = true; expect(() => assertAcquisitionTerminalProof(row, audit)).toThrow()
      const original = await AuditLog.findById(row.terminalAuditId)
      expect(() => assertAcquisitionTerminalProof({ ...row, startedAt: new Date() }, original)).toThrow()
    } finally { held.release(); await held.worker; held.restore() }
  })
  test('explicit saved fixture dispatch creates one bound Run/Attempt and replays it without execution', async () => {
    const { record, payload } = await prepareResearchDispatch(), response = await acquire(appFor(), payload)
    expect(response.status).toBe(200)
    const run = await Run.findOne().lean()
    expect(run).toMatchObject({ contractVersion: 'controlled-acquisition-run.v1', status: 'SUCCEEDED', canonicalSaved: true, researchConfiguration: record })
    const readArgs = { scopes: scopes(), actorUserId: String(ids.actor), runtimeInstanceId: runtimeKey }
    const detail = await actualAcquisition.getAcquisitionRun({ ...readArgs, runId: run.runId })
    expect(detail.researchConfiguration).toEqual(record)
    const history = await actualAcquisition.getAcquisitionRuns(readArgs)
    expect(history.items[0].researchConfiguration).toEqual(record)
    for (const phase of ['QUEUED', 'RUNNING', 'SUCCEEDED']) {
      const audit = await AuditLog.findOne({ 'diff.runId': run.runId, 'diff.phase': phase })
      expect(audit.verifySignature()).toBe(true)
      expect(audit.diff.researchConfiguration).toEqual({ configurationVersion: record.configurationVersion, configurationHash: record.configurationHash, saveAuditId: record.saveAuditId })
    }
    const root = await currentRoot(), count = await AuditLog.countDocuments()
    const replay = await acquire(appFor(), payload)
    expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ runId: run.runId, replay: true, researchConfiguration: record })
    expect(await Run.countDocuments()).toBe(1); expect((await Run.findOne().lean()).executionAttemptId).toBe(run.executionAttemptId); expect(await AuditLog.countDocuments()).toBe(count); expect(await currentRoot()).toEqual(root)
    const conflict = await acquire(appFor(), { ...payload, researchConfiguration: { ...payload.researchConfiguration, configurationHash: 'sha256:' + '0'.repeat(64) } })
    expect(conflict.status).toBe(409); expect(conflict.body.error.details.reason).toBe('ACQUISITION_REQUEST_CONFLICT')
    console.info(JSON.stringify({ proof: 'SECTION3_EXPLICIT_FIXTURE_DISPATCH', detail, history, sameRunReplay: true, attemptCount: 1, providerCalls: 0, jwtProof: false, authority: 'ISOLATED_TEST_SEAM_NOT_NATIVE' }))
  })
  test.each(['missing selector binding', 'native fallback', 'missing request key', 'mixed inputs', 'broader sources', 'wrong URL', 'wrong coverage', 'stale basis', 'stale settings', 'locked', 'read-only', 'foreign scope', 'no fixture authority'])('rejects %s before research capture', async kind => {
    const { record, payload } = await prepareResearchDispatch(); let app = appFor()
    if (kind === 'missing selector binding') delete payload.researchConfiguration.configurationHash
    if (kind === 'native fallback') delete payload.controlledReplay
    if (kind === 'missing request key') delete payload.requestKey
    if (kind === 'mixed inputs') payload.inputs = { companyName: 'not allowed' }
    if (kind === 'broader sources' || kind === 'wrong URL') {
      const replacement = configurationBody(record)
      replacement.settings.sources = kind === 'broader sources' ? ['WEBSITE', 'SEARCH'] : ['WEBSITE']
      replacement.settings.startingUrls = [kind === 'wrong URL' ? 'https://fixture.example/other' : fixture.sourceUrl]
      const saved = await putConfiguration(replacement); expect(saved.status).toBe(200)
      payload.researchConfiguration = { configurationVersion: saved.body.data.configuration.configurationVersion,
        configurationHash: saved.body.data.configuration.configurationHash, basisStateVersion: state }
    }
    if (kind === 'wrong coverage') payload.acquisitionProfile = 'ENHANCED'
    if (kind === 'stale basis') payload.researchConfiguration.basisStateVersion = 'rsv2:stale'
    if (kind === 'stale settings') payload.researchConfiguration.configurationHash = 'sha256:' + '0'.repeat(64)
    if (kind === 'locked') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED' } })
    if (kind === 'read-only') app = appFor(scopes(['VMF_VIEW']))
    if (kind === 'foreign scope') { const selected = scopes(); selected.resolvedPermissions.tenants[0].tenantId = '7'.repeat(24); app = appFor(selected) }
    if (kind === 'no fixture authority') catalogue.splice(0)
    const before = await snapshotMaterial(), response = await acquire(app, payload)
    expect([403, 409, 422]).toContain(response.status)
    expect(await Run.countDocuments()).toBe(0); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['REFRESH_EVIDENCE_PACK', 'SAVE_DISCOVERY_INPUTS'])('does not dispatch a research selector through %s', async actionKey => {
    const { payload } = await prepareResearchDispatch(), before = await snapshotMaterial()
    const response = await request(appFor()).post('/' + runtimeKey + '/actions/' + actionKey).send(payload)
    expect(response.status).toBe(422); expect(await Run.countDocuments()).toBe(0); expect(await snapshotMaterial()).toEqual(before)
  })
  test('a selector cannot create research without a verified saved configuration', async () => {
    const payload = { ...body(), researchConfiguration: { configurationVersion: randomUUID(), configurationHash: 'sha256:' + '0'.repeat(64), basisStateVersion: state } }
    const response = await acquire(appFor(), payload)
    expect(response.status).toBe(409); expect(response.body.error.details.reason).toBe('RESEARCH_CONFIGURATION_STALE')
    expect(await Run.countDocuments()).toBe(0); expect(await RuntimeEvidenceSource.countDocuments()).toBe(0)
  })
  test('concurrent identical saved dispatches retain one execution attempt', async () => {
    const { payload } = await prepareResearchDispatch()
    const results = await Promise.all([acquire(appFor(), payload), acquire(appFor(), payload)])
    expect(results.some(r => r.status === 200)).toBe(true)
    expect(results.every(r => [200, 409].includes(r.status))).toBe(true)
    expect(await Run.countDocuments()).toBe(1)
    expect((await Run.findOne().lean()).status).toBe('SUCCEEDED')
  })
  test.each(['admission', 'save'])('required %s audit failure does not commit research evidence', async kind => {
    const { record, payload } = await prepareResearchDispatch(), before = await snapshotMaterial()
    const original = kind === 'admission' ? auditService.log.bind(auditService) : auditService.logFromRequest.bind(auditService)
    const spy = kind === 'admission' ? jest.spyOn(auditService, 'log').mockImplementation((input, options) => {
      if (input.diff?.phase === 'QUEUED') throw new Error('Required research admission audit failure')
      return original(input, options)
    }) : jest.spyOn(auditService, 'logFromRequest').mockImplementation((req, input, options) => {
      if (input.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED) throw new Error('Required research save audit failure')
      return original(req, input, options)
    })
    try { expect((await acquire(appFor(), payload)).status).not.toBe(200) } finally { spy.mockRestore() }
    expect(await snapshotMaterial()).toEqual(before)
    if (kind === 'admission') expect(await Run.countDocuments()).toBe(0)
    else { const run = await Run.findOne().lean(); expect(run).toMatchObject({ status: 'FAILED', canonicalSaved: false, researchConfiguration: record }); expect(run.saveAuditId).toBeUndefined() }
  })
  test('a legitimate settings replacement during capture prevents the final evidence commit and preserves FAILED Run', async () => {
    const { record, payload } = await prepareResearchDispatch(), before = await currentRoot(), original = auditService.log.bind(auditService)
    let injected = false
    const spy = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
      const audit = await original(input, options)
      if (input.diff?.phase === 'RUNNING' && !injected) {
        injected = true
        const replacement = configurationBody(record); replacement.settings.sources = ['WEBSITE']; replacement.settings.startingUrls = [fixture.sourceUrl]
        replacement.settings.instructions = 'Changed while the controlled operation was running.'
        expect((await putConfiguration(replacement)).status).toBe(200)
      }
      return audit
    })
    try { expect((await acquire(appFor(), payload)).status).not.toBe(200) } finally { spy.mockRestore() }
    expect(injected).toBe(true)
    const after = await currentRoot(), run = await Run.findOne().lean()
    expect(after.framework_state).toEqual(before.framework_state); expect(after.stateVersion).toBe(before.stateVersion)
    expect(after.researchConfiguration.configurationVersion).not.toBe(record.configurationVersion)
    expect(run).toMatchObject({ status: 'FAILED', canonicalSaved: false, researchConfiguration: record })
    expect(await RuntimeEvidenceSource.countDocuments()).toBe(0); expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
  })
  test.each(['changed', 'removed', 'audit binding removed'])('refuses a %s research receipt binding', async kind => {
    const { payload } = await prepareResearchDispatch(); expect((await acquire(appFor(), payload)).status).toBe(200)
    const run = await Run.findOne().lean(), terminal = await AuditLog.findById(run.terminalAuditId), save = await AuditLog.findById(run.saveAuditId)
    if (kind === 'changed') run.researchConfiguration.settings.instructions = 'tampered'
    if (kind === 'removed') delete run.researchConfiguration
    if (kind === 'audit binding removed') { delete terminal.diff.researchConfiguration; terminal.markModified('diff') }
    expect(() => assertAcquisitionTerminalProof(run, terminal, save)).toThrow()
    if (kind !== 'audit binding removed') {
      await Run.collection.updateOne({ _id: run._id }, kind === 'removed' ? { $unset: { researchConfiguration: '' } } : { $set: { researchConfiguration: run.researchConfiguration } })
      await expect(actualAcquisition.getAcquisitionRun({ scopes: scopes(), actorUserId: String(ids.actor), runtimeInstanceId: runtimeKey, runId: run.runId })).rejects.toMatchObject({ status: 503 })
    }
  })
  test('research settings save/readback is private, signed and separate from evidence and Runs', async () => {
    const before = await currentRoot()
    const empty = await readConfiguration()
    expect(empty.status).toBe(200); expect(empty.body.data).toMatchObject({ configuration: null, currency: 'NOT_RECORDED' })
    const saved = await putConfiguration()
    expect(saved.status).toBe(200)
    const record = saved.body.data.configuration
    expect(record).toMatchObject({ contextSource: 'USER_PREPARED_CONTEXT_BRIEF', context: configurationBody().context,
      settings: configurationBody().settings, coverage: 'STANDARD' })
    const reloaded = await readConfiguration()
    expect(reloaded.status).toBe(200); expect(reloaded.body.data.configuration).toEqual(record)
    expect(reloaded.body.data.currency).toBe('CURRENT_BASIS')
    const after = await currentRoot()
    expect(after.framework_state).toEqual(before.framework_state)
    expect(after.stateVersion).toBe(before.stateVersion); expect(after.updatedAt).toEqual(before.updatedAt)
    expect(await Run.countDocuments()).toBe(0)
    expect(await RuntimeEvidenceSource.countDocuments()).toBe(0)
    expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
    expect((await RuntimeInstance.findById(ids.runtime).lean()).researchConfiguration).toBeUndefined()
    const audit = await AuditLog.findById(record.saveAuditId)
    expect(audit.verifySignature()).toBe(true); expect(audit.diff.configurationHash).toBe(record.configurationHash)
    console.info(JSON.stringify({ proof: 'SECTION3_SAVED_CONFIGURATION', data: reloaded.body.data, canonicalMaterialUnchanged: true,
      runCount: 0, providerCalls: 0, jwtProof: false, authority: 'SCOPED_TEST_MIDDLEWARE' }))
  })
  test('availability maps only verified current saved intent and performs no read-side writes', async () => {
    const empty = await readConfiguration()
    expect(empty.body.data.availability).toMatchObject({ canStart: false, executionEnabled: false, reason: 'CONFIGURATION_NOT_RECORDED', requestMapping: null })
    expect(empty.body.data.availability.categories).toHaveLength(9)
    const payload = configurationBody(); payload.coverage = 'ENHANCED'; payload.settings.sources.push('GITHUB')
    const saved = await putConfiguration(payload); expect(saved.status).toBe(200)
    const before = await currentRoot(), auditCount = await AuditLog.countDocuments()
    const response = await readConfiguration(), data = response.body.data, descriptor = data.availability
    expect(response.status).toBe(200)
    expect(descriptor).toMatchObject({ canStart: false, executionEnabled: false, reason: 'OPERATING_APPROVAL_NOT_RECORDED', configurationVersion: data.configuration.configurationVersion, configurationHash: data.configuration.configurationHash })
    expect(descriptor.categories).toEqual([
      { key: 'WEBSITE', selected: true, status: 'GATED', reason: 'OPERATING_APPROVAL_NOT_RECORDED' },
      { key: 'SEARCH', selected: true, status: 'GATED', reason: 'OPERATING_APPROVAL_NOT_RECORDED' },
      { key: 'REGISTRY', selected: true, status: 'GATED', reason: 'OPERATING_APPROVAL_NOT_RECORDED' },
      { key: 'GITHUB', selected: true, status: 'UNAVAILABLE', reason: 'SOURCE_UNSUPPORTED' },
      ...['LINKEDIN', 'SOCIAL', 'NEWS', 'REVIEWS', 'INDUSTRY'].map(key => ({ key, selected: false, status: 'NOT_SELECTED', reason: 'SOURCE_NOT_SELECTED' })),
    ])
    expect(descriptor.requestMapping).toEqual({ contractVersion: 'public-research-request-mapping.v1', configurationVersion: data.configuration.configurationVersion,
      configurationHash: data.configuration.configurationHash, saveAuditId: data.configuration.saveAuditId, scope: data.scope, basis: data.basis,
      contextSource: 'USER_PREPARED_CONTEXT_BRIEF', inputs: payload.context, acquisitionProfile: 'ENHANCED', purpose: data.configuration.purpose, settings: payload.settings })
    expect(descriptor.requestMapping).not.toHaveProperty('actionKey'); expect(descriptor.requestMapping).not.toHaveProperty('requestKey')
    expect((await readConfiguration(appFor(scopes(['VMF_VIEW'])))).body.data.availability).toEqual(descriptor)
    expect(await currentRoot()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(auditCount)
    expect(await Run.countDocuments()).toBe(0); expect(await RuntimeEvidenceSource.countDocuments()).toBe(0); expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
    console.info(JSON.stringify({ proof: 'SECTION3_AVAILABILITY_MAPPING', data, readOnly: true, runCount: 0, providerCalls: 0, jwtProof: false }))
  })
  test.each([
    ['unconfirmed UK', { entityConfirmed: false }, 'GATED', 'ENTITY_UNCONFIRMED'],
    ['non-UK', { countryCode: 'IE', entityConfirmed: true }, 'NOT_APPLICABLE', 'UK_REGISTRY_NOT_APPLICABLE'],
    ['UK subsidiary', { countryCode: 'IE', ukSubsidiary: true, entityConfirmed: true }, 'GATED', 'OPERATING_APPROVAL_NOT_RECORDED'],
    ['unresolved', { countryCode: '', entityConfirmed: false }, 'GATED', 'ENTITY_UNCONFIRMED'],
  ])('registry availability preserves %s qualifications without a lookup', async (_name, entity, status, reason) => {
    const payload = configurationBody(); Object.assign(payload.settings, entity)
    const response = await putConfiguration(payload); expect(response.status).toBe(200)
    expect(response.body.data.availability.categories.find(item => item.key === 'REGISTRY')).toEqual({ key: 'REGISTRY', selected: true, status, reason })
    expect(response.body.data.availability.canStart).toBe(false)
    expect(await Run.countDocuments()).toBe(0)
  })
  test.each(['stale', 'locked'])('a %s saved basis has no request mapping', async kind => {
    const saved = await putConfiguration(); expect(saved.status).toBe(200)
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: kind === 'locked' ? { status: 'LOCKED' } : { updatedAt: new Date('2026-11-12T12:00:00Z') } })
    const before = await currentRoot(), read = await readConfiguration()
    expect(read.status).toBe(200)
    expect(read.body.data.availability).toMatchObject({ canStart: false, executionEnabled: false, requestMapping: null,
      reason: kind === 'locked' ? 'REVISION_NOT_EDITABLE' : 'CONFIGURATION_STALE' })
    expect(await currentRoot()).toEqual(before); expect(await Run.countDocuments()).toBe(0)
  })
  test('a rejected required audit never commits settings', async () => {
    const before = await currentRoot()
    const spy = jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('Required configuration audit failed'))
    try {
      const response = await putConfiguration()
      expect(response.status).toBe(500)
      expect(await currentRoot()).toEqual(before)
      expect(await AuditLog.countDocuments({ action: 'RUNTIME_RESEARCH_CONFIGURATION_SAVED' })).toBe(0)
    } finally { spy.mockRestore() }
  })
  test('concurrent first saves have one winner and one signed audit', async () => {
    const responses = await Promise.all([putConfiguration(), putConfiguration()])
    expect(responses.map(row => row.status).sort()).toEqual([200, 409])
    const winner = responses.find(row => row.status === 200).body.data.configuration
    expect((await readConfiguration()).body.data.configuration).toEqual(winner)
    expect(await AuditLog.countDocuments({ action: 'RUNTIME_RESEARCH_CONFIGURATION_SAVED' })).toBe(1)
  })
  test('a settings write failure rolls the actual audit insert back', async () => {
    const before = await currentRoot()
    const spy = jest.spyOn(RuntimeInstance, 'updateOne').mockRejectedValueOnce(new Error('Synthetic settings write failure'))
    try {
      expect((await putConfiguration()).status).toBe(500)
      expect(await currentRoot()).toEqual(before)
      expect(await AuditLog.countDocuments({ action: 'RUNTIME_RESEARCH_CONFIGURATION_SAVED' })).toBe(0)
    } finally { spy.mockRestore() }
  })
  test('stale configuration versions and root bases cannot overwrite a save', async () => {
    const first = await putConfiguration(); expect(first.status).toBe(200)
    const stale = await putConfiguration(); expect(stale.status).toBe(409)
    expect(stale.body.error.details.reason).toBe('RESEARCH_CONFIGURATION_STALE')
    const root = await currentRoot()
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { stateVersion: 'rsv2:77777777-7777-4777-8777-777777777777' } })
    const after = await readConfiguration()
    expect(after.status).toBe(200); expect(after.body.data.currency).toBe('STALE_BASIS')
    const mismatched = await putConfiguration(configurationBody(first.body.data.configuration))
    expect(mismatched.status).toBe(409)
    expect((await currentRoot()).researchConfiguration).toEqual(root.researchConfiguration)
  })
  test.each(['locked', 'published', 'approved'])('%s revisions retain settings but reject saves', async kind => {
    const first = await putConfiguration(); expect(first.status).toBe(200)
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: kind === 'locked' ? { status: 'LOCKED' }
      : { 'framework_state.lifecycle.stage': kind.toUpperCase() } })
    const before = await currentRoot(), response = await putConfiguration(configurationBody(first.body.data.configuration))
    expect(response.status).toBe(409); expect(response.body.error.details.reason).toBe('RESEARCH_CONFIGURATION_LOCKED')
    expect(await currentRoot()).toEqual(before)
    const read = await readConfiguration(); expect(read.status).toBe(200); expect(read.body.data.editable).toBe(false)
  })
  test('configuration scope and update permission fail closed', async () => {
    const readonly = appFor(scopes(['VMF_VIEW']))
    expect((await readConfiguration(readonly)).status).toBe(200)
    expect((await putConfiguration(configurationBody(), readonly)).status).toBe(403)
    const foreign = scopes(); foreign.tenant._id = '7'.repeat(24)
    // Active selection is not the permission grant; the original tenant is
    // still legitimately readable through explicit scope selection.
    expect((await readConfiguration(appFor(foreign))).status).toBe(200)
    const foreignQuery = { ...configQuery, tenantId: '7'.repeat(24) }
    expect((await request(appFor(foreign)).get(configPath).query(foreignQuery)).status).toBe(404)
    expect((await request(appFor(foreign)).put(configPath).query(foreignQuery).send(configurationBody())).status).toBe(404)
    expect((await currentRoot()).researchConfiguration).toBeUndefined()
  })
  test.each(['activation', 'unknown source', 'credentials URL', 'confirmation', 'duplicate source'])('rejects invalid %s configuration before persistence', async kind => {
    const payload = configurationBody()
    if (kind === 'activation') payload.activateProvider = true
    if (kind === 'unknown source') payload.settings.sources = ['PRIVATE_WEB']
    if (kind === 'credentials URL') payload.settings.startingUrls = ['https://user:secret@fixture.example/']
    if (kind === 'confirmation') payload.settings.legalEntity = ''
    if (kind === 'duplicate source') payload.settings.sources = ['WEBSITE', 'WEBSITE']
    expect((await putConfiguration(payload)).status).toBe(422)
    expect((await currentRoot()).researchConfiguration).toBeUndefined()
    expect(await Run.countDocuments()).toBe(0)
  })
  test.each(['settings', 'audit'])('tampered %s is unavailable, never an empty successful read', async kind => {
    const saved = await putConfiguration(); expect(saved.status).toBe(200)
    if (kind === 'settings') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { 'researchConfiguration.settings.instructions': 'tampered' } })
    else await AuditLog.collection.deleteOne({ _id: new mongoose.Types.ObjectId(saved.body.data.configuration.saveAuditId) })
    const read = await readConfiguration()
    expect(read.status).toBe(503); expect(read.body.data).toBeUndefined()
  })
  test('the mounted JWT boundary rejects unauthenticated configuration access', async () => {
    const app = express(); app.use(authJwt); app.get(configPath, readResearchConfiguration)
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }))
    expect((await request(app).get(configPath).query(configQuery)).status).toBe(401)
  })

  test('the shipped local grant cannot be used without its native qualified inputs', async () => {
    expect(shippedCatalogue.CONTROLLED_REPLAY_BINDINGS).toHaveLength(1)
    await expect(shippedCatalogue.verifyControlledReplayAuthority()).rejects.toMatchObject({ status: 409 })
    await expect(shippedCatalogue.verifyControlledReplayExclusions()).rejects.toMatchObject({ status: 409 })
  })

  test('actual writer commits qualified pending material and ordinary Sources/Review return the exact same IDs', async () => {
    const app = appFor()
    const empty = await request(app).get(`/${runtimeKey}/state/sources`)
    expect(empty.status).toBe(200); expect(empty.body.data.sourceRegistry).toEqual([])
    const response = await acquire(app)
    expect([response.status, response.body.error]).toEqual([200, undefined])
    const root = await currentRoot(), run = await Run.findOne().lean()
    expect(root.stateVersion).not.toBe(state)
    expect(run).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true, outputStateVersion: root.stateVersion })
    expect(root.controlledReplayIsolation.bindingDigest).toBe(storedControlledReplayBindingDigest(binding()))
    const objects = root.framework_state.evidence_pack.evidenceObjects
    expect(objects.length).toBeGreaterThan(0)
    expect(root.framework_state.evidence_pack.accepted).toBe(false)
    const fullSources = await RuntimeEvidenceSource.find({ current: true }).lean()
    const fullEvidence = await RuntimeEvidenceObject.find({ current: true }).lean()
    expect(() => assertControlledReplayProvenancePairs({ sources: fullSources, evidenceObjects: fullEvidence })).not.toThrow()
    for (const row of fullEvidence) {
      expect(() => controlledReplayProvenanceForRow(row, row)).not.toThrow()
      for (const field of ['migrationReceiptId', 'sourceHash']) {
        const incomplete = { ...row }; delete incomplete[field]
        expect(() => controlledReplayProvenanceForRow(incomplete)).toThrow()
      }
      expect(() => controlledReplayProvenanceForRow({ ...row, tenantId: ids.package })).toThrow()
      expect(() => controlledReplayProvenanceForRow(row, root)).toThrow()
    }
    const sources = await request(app).get(`/${runtimeKey}/state/sources`)
    const pending = await request(app).get(`/${runtimeKey}/state/evidence`).query({ reviewStatus: 'PENDING', pageSize: 50 })
    expect([sources.status, sources.body.error]).toEqual([200, undefined])
    expect([pending.status, pending.body.error]).toEqual([200, undefined])
    expect(sources.body.data.sourceRegistry).toHaveLength(1)
    expect(pending.body.data.evidenceObjects.map(row => row.evidenceObjectId).sort())
      .toEqual(objects.map(row => row.evidenceObjectId).sort())
    const source = sources.body.data.sourceRegistry[0]
    expect(source.sourceRef).toBe(fixture.sourceUrl)
    expect(source.sourceCapture.captureReceipt).toMatchObject({ runId: run.runId,
      attemptId: run.executionAttemptId, operation: 'CONTROLLED_HTML_REPLAY_CAPTURE' })
    for (const row of pending.body.data.evidenceObjects) {
      expect(row.reviewStatus).toBe('PENDING'); expect(row.stateVersion).toBe(root.stateVersion)
      expect(row.migrationReceiptId).toBeUndefined(); expect(row.sourceHash).toBeUndefined()
      expect(row.controlledReplayProvenance.binding).toEqual(binding())
      const original = objects.find(value => value.evidenceObjectId === row.evidenceObjectId)
      expect(row.evidenceSupport).toEqual(original.evidenceSupport || null)
      expect(row.sourceId).toBe(source.sourceId)
    }
    for (const reviewStatus of ['ACCEPTED', 'REJECTED']) {
      const page = await request(app).get(`/${runtimeKey}/state/evidence`).query({ reviewStatus })
      expect(page.status).toBe(200); expect(page.body.data.total).toBe(0)
    }
    const terminal = await AuditLog.findById(run.terminalAuditId), saved = await AuditLog.findById(run.saveAuditId)
    expect(() => assertAcquisitionTerminalProof(run, terminal, saved)).not.toThrow()
    for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
    const readArgs = { scopes: scopes(), actorUserId: String(ids.actor), runtimeInstanceId: runtimeKey }
    const history = await actualAcquisition.getAcquisitionRuns(readArgs)
    const detail = await actualAcquisition.getAcquisitionRun({ ...readArgs, runId: run.runId })
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({ runId: run.runId, contractVersion: 'controlled-acquisition-run.v1',
      controlledReplayProvenance: { binding: binding() } })
    expect(detail).toMatchObject({ runId: run.runId, currency: 'CURRENT_OUTPUT', canonicalSaved: true })
    expect(detail.controlledReplayProvenance).toEqual(history.items[0].controlledReplayProvenance)
    expect(detail).not.toHaveProperty('plannerVersion')
    await expect(actualAcquisition.getAcquisitionRuns({ ...readArgs,
      scopes: { ...scopes(), tenant: { _id: '777777777777777777777777', customerId: String(ids.customer) } },
    })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    console.info(JSON.stringify({ proof: 'SECTION3_CONTROLLED_RUN_READ_BACK', history, detail }))
    console.info(JSON.stringify({ proof: 'ISOLATED_PROVIDER_FREE_PERSISTENCE', runtimeKey, stateVersion: root.stateVersion,
      runId: run.runId, sourceCount: 1, pendingCount: objects.length, acceptedCount: 0, rejectedCount: 0,
      bindingDigest: root.controlledReplayIsolation.bindingDigest, fixtureHash: fixture.fixtureFileSha256,
      authority: 'TEST_PROCESS_SEAM_NOT_NATIVE', jwtProof: false, networkFetches: 0 }))
  })

  test('required save audit failure rolls back real root/source/evidence/graph writes, retaining a failed Run', async () => {
    const before = await snapshotMaterial(), log = auditService.logFromRequest.bind(auditService)
    let injected = 0
    jest.spyOn(auditService, 'logFromRequest').mockImplementation((req, input, options) => {
      if (input.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED) {
        injected += 1
        throw new Error('Isolated required save audit failure')
      }
      return log(req, input, options)
    })
    const response = await acquire()
    expect(injected).toBe(1)
    expect(response.status).not.toBe(200)
    expect(await snapshotMaterial()).toEqual(before)
    const run = await Run.findOne().lean()
    expect(run).toMatchObject({ status: 'FAILED', canonicalSaved: false })
    expect(run.saveAuditId).toBeUndefined(); expect(run.outputStateVersion).toBeUndefined()
    for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  })

  test('validated marker writes reject foreign, missing and edited identity without changing the root', async () => {
    const root = await currentRoot(), before = await snapshotMaterial()
    const marker = { contractVersion: 'controlled-replay-runtime-isolation.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
      scope: binding().scope, runtimeInstanceKey: runtimeKey, bindingDigest: storedControlledReplayBindingDigest(binding()) }
    const filter = controlledReplayIsolationCas(root)
    const missing = { ...filter }; delete missing.tenantId
    for (const [where, update] of [
      [filter, { $set: { controlledReplayIsolation: { ...marker, scope: { ...marker.scope, tenantId: 'f'.repeat(24) } } } }],
      [missing, { $set: { controlledReplayIsolation: marker } }],
      [filter, { $set: { controlledReplayIsolation: marker, tenantId: ids.tenant } }],
    ]) {
      await expect(RuntimeInstance.findOneAndUpdate(where, update, { runValidators: true })).rejects.toThrow()
      expect(await snapshotMaterial()).toEqual(before)
    }
  })

  test('missing acquisition permission rejects before fixture admission', async () => {
    const before = await snapshotMaterial()
    const response = await acquire(appFor(scopes(['VMF_VIEW'])))
    expect(response.status).toBe(403); expect(await Run.countDocuments()).toBe(0)
    expect(await snapshotMaterial()).toEqual(before)
  })

  test.each(['stale', 'foreign-binding', 'locked'])('%s request cannot create evidence or a Run', async mode => {
    if (mode === 'locked') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED' } })
    const before = await snapshotMaterial(), payload = body()
    if (mode === 'stale') payload.expectedUpdatedAt = '2026-11-10T10:00:00.000Z'
    if (mode === 'foreign-binding') catalogue[0].binding.scope.tenantId = 'f'.repeat(24)
    const response = await acquire(appFor(), payload)
    expect(response.status).toBe(409); expect(await Run.countDocuments()).toBe(0)
    expect(await snapshotMaterial()).toEqual(before)
  })

  test('ordinary scoped readers do not expose the isolated runtime to a different tenant', async () => {
    const foreign = scopes()
    foreign.customer._id = 'e'.repeat(24); foreign.tenant._id = 'f'.repeat(24); foreign.tenant.customerId = 'e'.repeat(24)
    const response = await request(appFor(foreign)).get(`/${runtimeKey}/state/sources`)
    expect([403, 404]).toContain(response.status)
    expect(response.body.data?.sourceRegistry).toBeUndefined()
  })
})

// A child uses only the already-created parent fixture. It never seeds, clears,
// starts Mongo, exposes HTTP or connects to a configured application database.
const ownedChildSuite = ['worker', 'reader'].includes(childMode) && process.env.VMF_CONTROLLED_REPLAY_ISOLATED === '1' ? describe : describe.skip
ownedChildSuite('owned interrupted worker child', () => {
  beforeAll(async () => {
    const uri = process.env.VMF_CONTROLLED_REPLAY_CHILD_OWNED_URI, parsed = new URL(uri)
    if (parsed.protocol !== 'mongodb:' || parsed.hostname !== '127.0.0.1' || !parsed.port
      || parsed.pathname !== '/' + database || parsed.username || parsed.password
      || !isProofDataDirectory(process.env.VMF_CONTROLLED_REPLAY_DATA_DIR) || mongoose.connection.readyState !== 0)
      throw new Error('Exact parent-owned loopback fixture required.')
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, maxPoolSize: 3, serverSelectionTimeoutMS: 5000 })
    expect(mongoose.connection.name).toBe(database)
    expect((await mongoose.connection.db.listCollections().toArray()).map(row => row.name).sort()).toEqual(models.map(model => model.collection.name).sort())
    catalogue.push({ binding: binding() })
    authority.mockResolvedValue({ classification: 'ISOLATED_TEST_SEAM', authorityRef: binding().authorityRef })
    exclusions.mockResolvedValue({ classification: 'ISOLATED_TEST_SEAM', isolationRef: binding().isolationRef, parlon: false, heldSs044Family: false })
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Owned child forbids provider calls.') })
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(() => { throw new Error('Owned child forbids DNS.') })
  })
  afterAll(async () => { jest.restoreAllMocks(); delete globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__; await mongoose.disconnect() })
  test('uses the actual acquisition owner or its read-only receipt in the owned fixture', async () => {
    const payload = JSON.parse(process.env.VMF_CONTROLLED_REPLAY_CHILD_PAYLOAD), identity = {
      pid: process.pid, commandSha256: createHash('sha256').update(JSON.stringify(process.argv)).digest('hex'),
      testSourceSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    }
    if (childMode === 'reader') {
      const row = await Run.findOne({ runtimeInstanceId: ids.runtime, requestKey: payload.requestKey }).lean()
      expect(row.status).toBe('RUNNING')
      const read = await request(appFor()).get(`/${runtimeKey}/acquisition-runs/${row.runId}`).query({ customerId: String(ids.customer), tenantId: String(ids.tenant) })
      expect(read.status).toBe(200)
      console.info(JSON.stringify({ proof: 'SECTION3_CHILD_READ', ...identity, data: read.body.data }))
    } else {
      const original = Run.collection.findOne.bind(Run.collection)
      jest.spyOn(Run.collection, 'findOne').mockImplementation(async (filter, options) => {
        const row = await original(filter, options)
        if (!options?.session && row?.requestKey === payload.requestKey && row.status === 'RUNNING') {
          console.info(JSON.stringify({ proof: 'SECTION3_CHILD_RUNNING', ...identity, runId: row.runId, executionAttemptId: row.executionAttemptId,
            interruptionPoint: 'AFTER_COMMITTED_RUNNING_READ_BEFORE_CAPTURE' }))
          await new Promise(() => {}) // Only the parent's exact owned-PID stop releases this process.
        }
        return row
      })
      await request(appFor()).post(`/${runtimeKey}/actions/BUILD_EVIDENCE_PACK`).send(payload)
      throw new Error('Owned worker unexpectedly completed instead of stopping at its barrier.')
    }
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
  }, 120000)
})
