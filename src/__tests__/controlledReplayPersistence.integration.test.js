import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect, jest } from '@jest/globals'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
const { default: auditService } = await import('../services/auditService.js')
const { stageRuntimeStateNativeInitialization } = await import('../services/runtimeStateNativeInitializationService.js')
const { storedControlledReplayBindingDigest, assertControlledReplayProvenancePairs,
  controlledReplayProvenanceForRow } = await import('../services/controlledReplayContract.js')
const { controlledReplayIsolationCas } = await import('../services/controlledReplayIsolationService.js')
const { assertAcquisitionTerminalProof } = await import('../services/acquisitionReceiptProof.js')
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

const isolated = process.env.VMF_CONTROLLED_REPLAY_ISOLATED === '1' ? describe : describe.skip
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
  RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog]
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
const appFor = (selectedScopes = scopes()) => {
  const app = express()
  app.use(express.json(), (req, _res, next) => {
    req.scopes = selectedScopes; req.context = { userId: String(ids.actor) }; req.requestId = randomUUID(); next()
  })
  app.post('/:runtimeInstanceId/actions/:actionKey', validateRuntimeActionParams, validateExecuteRuntimeAction, executeRuntimeAction)
  app.get('/:runtimeInstanceId/state/sources', validateRuntimeInstanceId, getRuntimeStateSourceRegistry)
  app.get('/:runtimeInstanceId/state/evidence', validateRuntimeInstanceId, getRuntimeStateEvidencePage)
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

  test('normal shipped registration remains unavailable', () => {
    expect(shippedCatalogue.CONTROLLED_REPLAY_BINDINGS).toEqual([])
    expect(() => shippedCatalogue.verifyControlledReplayAuthority()).toThrow()
    expect(() => shippedCatalogue.verifyControlledReplayExclusions()).toThrow()
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
