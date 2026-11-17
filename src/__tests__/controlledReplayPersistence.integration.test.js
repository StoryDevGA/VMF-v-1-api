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
  verifyProviderFreeSearchReceiptScope: shippedCatalogue.verifyProviderFreeSearchReceiptScope,
}))
const { default: originalEnv } = await import('../config/env.js')
jest.unstable_mockModule('../config/env.js', () => ({ default: { ...originalEnv,
  nodeEnv: 'test', appEnv: 'development', outcomeStudioProviderEnabled: false,
} }))
const renderer = await import('../services/runtimeRendererService.js')
let projectedBuildEnabled = true
jest.unstable_mockModule('../services/runtimeRendererService.js', () => ({ ...renderer,
  getRuntimeRenderer: async () => ({ actions: [{ actionKey: 'BUILD_EVIDENCE_PACK', enabled: projectedBuildEnabled }] }),
}))
const { RuntimeInstance, FrameworkPackage, RuntimePathRegistry, Customer, Tenant, LicenseLevel,
  RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection, RuntimeStateMigrationReceipt,
  RuntimeGraphSnapshot, RuntimeGraphElement, RuntimeEvidenceSnapshot, AuditLog } = await import('../models/index.js')
const { default: Run } = await import('../models/RuntimeAcquisitionRun.js')
const { default: User } = await import('../models/User.js')
const { default: Role } = await import('../models/Role.js')
const { default: auditService } = await import('../services/auditService.js')
const { stageRuntimeStateNativeInitialization, buildRuntimeStateNativeInitialFrameworkState } = await import('../services/runtimeStateNativeInitializationService.js')
const { storedControlledReplayBindingDigest, assertControlledReplayProvenancePairs,
  controlledReplayProvenanceForRow } = await import('../services/controlledReplayContract.js')
const { controlledReplayIsolationCas } = await import('../services/controlledReplayIsolationService.js')
const { assertAcquisitionTerminalProof } = await import('../services/acquisitionReceiptProof.js')
const { publicResearchHash } = await import('../services/publicResearchContract.js')
const { createRuntimeStateLegacySourceRowSet } = await import('../services/runtimeStateLegacyMapper.js')
const { buildWebsiteDiscoveryEvidenceFromDecodedHtml } = await import('../services/discoveryIntelligenceService.js')
const { buildEvidenceMembershipBody, membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
const { readResearchConfiguration, writeResearchConfiguration, readAcquisitionRuns, readAcquisitionRun, cancelRecordedAcquisitionRun } = await import('../controllers/acquisitionRun.controller.js')
const { validateResearchConfigurationScope, validateResearchConfigurationSave, validateAcquisitionCancellation, validateAcquisitionRunParams, validateAcquisitionRunScope } = await import('../validators/acquisitionRun.validator.js')
const { default: authJwt } = await import('../middleware/authJwt.js')
const actualAcquisition = await import('../services/acquisitionRunService.js')
const OriginalResponse = globalThis.Response
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
const requestedPort = process.env.VMF_CONTROLLED_REPLAY_PORT
const fixturePort = requestedPort === undefined ? 0 : Number(requestedPort)
if (requestedPort !== undefined && (!/^(0|[1-9]\d*)$/.test(requestedPort) || !Number.isSafeInteger(fixturePort)
  || fixturePort !== 0 && (fixturePort <= 1024 || fixturePort > 65535
    || [5173, 6379, 6382, 8000, 8003, 9231, 27017, 27018, 27019, 27087, 27088, 27089].includes(fixturePort))))
  throw new Error('Explicit owned fixture port required')
const isProofDataDirectory = dataDir => {
  if (!dataDir || !isAbsolute(dataDir)) return false
  const pathFromEvidence = relative(resolve('C:/Dev/StoryLineOS/VMF-Evidence'), resolve(dataDir))
  return Boolean(pathFromEvidence && !isAbsolute(pathFromEvidence) && pathFromEvidence !== '..'
    && !pathFromEvidence.startsWith(`..${sep}`))
}
describe('provider-free fixture data directory', () => {
  test.each([
    [resolve(fileURLToPath(new URL('../../', import.meta.url)), '..', '..fixture'), false],
    [resolve(fileURLToPath(new URL('../../', import.meta.url)), 'fixture-data'), false],
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
  RuntimeGraphSnapshot, RuntimeGraphElement, RuntimeEvidenceSnapshot, AuditLog, User, Role]
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
  let expectedFixtureFetchCalls = 0, expectedFixtureDnsCalls = 0
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
      replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ dbPath: dataDir, ...(fixturePort ? { port: fixturePort } : {}) }] })
    const uri = replica.getUri(database)
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Owned loopback replica required.')
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, maxPoolSize: 6,
      serverSelectionTimeoutMS: 10000 })
    connected = true
    if (mongoose.connection.name !== database || (await mongoose.connection.db.listCollections().toArray()).length)
      throw new Error('Empty fixed fixture database required.')
    owned = true; assertOwned()
    for (const model of models) await model.createCollection()
    for (const model of [Run, RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeInstance, RuntimeEvidenceSnapshot]) await model.createIndexes()
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
    expectedFixtureFetchCalls = 0; expectedFixtureDnsCalls = 0
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
    projectedBuildEnabled = true
    expect(globalThis.fetch).toHaveBeenCalledTimes(expectedFixtureFetchCalls)
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(expectedFixtureDnsCalls)
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
  const tavilyResponses = JSON.parse(readFileSync(new URL('./fixtures/syntheticPublicResearchResponses.json', import.meta.url), 'utf8'))
  const protectExistingMaterial = async () => {
    // Authored synthetic protection preconditions, not a native lock/acceptance.
    // The snapshot's audit reference is deliberately unverified and it is NOT
    // installed as this active runtime's lockedEvidenceSnapshot pointer.
    const captured = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
    const product = buildWebsiteDiscoveryEvidenceFromDecodedHtml({ html: captured.html, normalizedUrl: captured.url, finalUrl: captured.url,
      acquisitionProfile: 'STANDARD', acquiredAt: captured.capturedAt, recordSourceCapture: true,
      contentTruncated: false, charactersRead: captured.html.length, characterLimit: 320000 })
    const migration = await RuntimeStateMigrationReceipt.collection.findOne({ runtimeInstanceId: ids.runtime })
    const mapped = createRuntimeStateLegacySourceRowSet({ scope: { runtimeInstanceId: ids.runtime, runtimeInstanceKey: runtimeKey,
      customerId: ids.customer, tenantId: ids.tenant }, stateVersion: state, migrationReceiptId: migration.receiptId, migrationTimestamp: at,
    legacyInput: { rawBsonBytes: 4096, sections: { customer_problem: { input: 'Synthetic protected context',
      accepted: { evidenceRefs: [product.source.sourceId] }, state: { status: 'DRAFT' } } },
    evidencePack: { sourceRegistry: [product.sourceRegistryEntry], evidenceObjects: product.evidenceObjects },
    intelligenceGraph: { graphVersion: 'synthetic-protected-membership', nodes: [], edges: [] } } })
    const sources = await RuntimeEvidenceSource.create(mapped.rows.evidenceSources.map(row => ({ ...row, current: true })))
    const evidence = await RuntimeEvidenceObject.create(mapped.rows.evidenceObjects.map(row => ({ ...row, current: true })))
    const sections = await RuntimeStateSection.create(mapped.rows.sections.map(row => ({ ...row, current: true })))
    expect(sources.length).toBeGreaterThan(0); expect(evidence.length).toBeGreaterThan(0); expect(sections.length).toBeGreaterThan(0)
    // Authored package-binding labels only: no installation, activation or deployment occurred.
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime, customerId: ids.customer, tenantId: ids.tenant }, { $set: {
      dependencyLockId: 'ss049-authored-protection-dependency-not-installed',
      activationId: 'ss049-authored-protection-activation-not-performed',
      deploymentId: 'ss049-authored-protection-deployment-not-performed',
    } })
    const runtime = await currentRoot(), lockTruthRecord = { snapshotId: 'ss049-authored-protected-lock-fixture', snapshotHash: 'a'.repeat(64),
      snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' }
    const body = buildEvidenceMembershipBody({ runtime, lockTruthRecord, sources: sources.map(row => row.toObject()),
      evidence: evidence.map(row => row.toObject()), sections: sections.map(row => row.toObject()) })
    const snapshot = new RuntimeEvidenceSnapshot({ ...body.scope, snapshotId: 'evidence_snapshot_' + randomUUID(), contractVersion: body.contractVersion,
      basisStateVersion: state, lockSnapshotId: lockTruthRecord.snapshotId, lockSnapshotHash: lockTruthRecord.snapshotHash,
      membershipHash: membershipHash(body), body, createdBy: ids.actor, createdAt: new Date(at),
      lockAuditId: new mongoose.Types.ObjectId(), lockAuditSignatureVersion: 3 })
    expect(snapshot.validateSync()).toBeUndefined(); await snapshot.save()
    expect(await RuntimeEvidenceSnapshot.countDocuments()).toBe(1)
  }
  const prepareTavilyReceipt = async () => {
    const prepared = await prepareNativeLocalRegistration(), settings = configurationBody(prepared.record)
    await protectExistingMaterial()
    settings.settings.sources = ['SEARCH']; settings.settings.startingUrls = ['https://controlled-capture.example/']
    const saved = await putConfiguration(settings); expect(saved.status).toBe(200)
    const configuration = saved.body.data.configuration
    expect(saved.body.data.availability.canStart).toBe(false)
    expect(saved.body.data.availability.fixtureStart.eligible).toBe(false)
    return { configuration, payload: { requestKey: randomUUID(), expectedUpdatedAt: at,
      fixture: { selector: { configurationVersion: configuration.configurationVersion, configurationHash: configuration.configurationHash,
        basisStateVersion: state }, settings: configuration.settings, provider: 'TAVILY_SEARCH', approvedHostname: 'controlled-capture.example',
      approvedTerms: ['workflow monitoring'], transportOutcome: 'COMPLETE', httpStatus: 200,
      responseId: 'synthetic-saved-tavily-response', capturedAt: '2026-11-13T09:00:00.000Z', simulatedElapsedMs: 20,
      responseText: JSON.stringify(tavilyResponses.providerShapes.tavily) } } }
  }
  const recordTavily = (payload, extra = {}) => actualAcquisition.recordProviderFreeTavilyReceipt({ scopes: scopes(),
    actorUserId: String(ids.actor), runtimeInstanceId: runtimeKey, payload, ...extra })
  const exactTavily = runId => request(appFor()).get(`/${runtimeKey}/acquisition-runs/${runId}`).query(configQuery)
  const protectedReceiptMaterial = async () => {
    assertOwned()
    const versioned = new Set([RuntimeInstance, User, Role, Customer, Tenant])
    const material = Object.fromEntries(await Promise.all(models.filter(model => ![Run, AuditLog].includes(model)).map(async model => {
      const rows = await model.collection.find({}).sort({ _id: 1 }).toArray()
      return [model.collection.name, rows.map(row => {
        const copy = { ...row }; if (versioned.has(model)) delete copy.__v
        return [String(copy._id), digest(copy)]
      })]
    })))
    const snapshot = await RuntimeEvidenceSnapshot.collection.findOne({ runtimeInstanceId: ids.runtime })
    expect(snapshot).not.toBeNull()
    const [sources, evidence, sections] = await Promise.all([RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection]
      .map(model => model.collection.find({ runtimeInstanceId: ids.runtime, current: true }).toArray()))
    expect(sources.length).toBeGreaterThan(0); expect(evidence.length).toBeGreaterThan(0); expect(sections.length).toBeGreaterThan(0)
    material.authoredFrozenMembershipHash = membershipHash(buildEvidenceMembershipBody({ runtime: await currentRoot(),
      lockTruthRecord: snapshot.body.lockTruthRecord, sources, evidence, sections }))
    expect(material.authoredFrozenMembershipHash).toBe(snapshot.membershipHash)
    return material
  }
  const prepareTrilogyStart = async () => {
    const { configuration } = await prepareTavilyReceipt(), next = configurationBody(configuration)
    next.settings.sources = ['SEARCH']; next.settings.startingUrls = ['https://www.trilogywebsolutions.co.uk/clients/']
    const saved = await putConfiguration(next); expect(saved.status).toBe(200)
    const descriptor = saved.body.data.availability.fixtureStart
    expect(saved.body.data.availability.canStart).toBe(false)
    expect(descriptor).toMatchObject({ contractVersion: 'provider-free-search-start.v1', eligible: true,
      classification: 'LOCAL_SYNTHETIC_RECEIPT_ONLY', fixture: { fixtureId: 'trilogy-clients-search.v1', fixtureVersion: 1,
        targetUrl: next.settings.startingUrls[0], provider: 'TAVILY_SEARCH' } })
    const { fixtureId, fixtureVersion, fixtureFileSha256 } = descriptor.fixture
    return { descriptor, configuration: saved.body.data.configuration, payload: { requestKey: randomUUID(), expectedUpdatedAt: at,
      researchConfiguration: descriptor.selector, providerFreeSearch: { fixtureId, fixtureVersion, fixtureFileSha256 } } }
  }
  describe('PUBLIC research SEARCH and original WEBSITE', () => {
    const retainedResponseTest = process.env.VMF_TAVILY_RETAINED_RESPONSE_FILE ? test : test.skip
    const preparePublicStart = async () => {
      const prepared = await prepareNativeLocalRegistration(), next = configurationBody(prepared.record)
      const ownedScope = { runtimeInstanceId: ids.runtime, customerId: ids.customer, tenantId: ids.tenant }
      const root = await currentRoot(), pack = root.framework_state?.evidence_pack
      const sections = root.framework_state?.sections, graph = root.framework_state?.intelligence_graph
      if (sections !== undefined) {
        expect(sections).not.toBeNull(); expect(typeof sections).toBe('object'); expect(Array.isArray(sections)).toBe(false)
        expect(Object.keys(sections)).toEqual([])
      }
      if (graph !== undefined) {
        expect(graph).not.toBeNull(); expect(typeof graph).toBe('object'); expect(Array.isArray(graph)).toBe(false)
        expect(Object.keys(graph).every(key => ['graphVersion', 'nodes', 'edges'].includes(key))).toBe(true)
        if (graph.graphVersion !== undefined) expect(graph.graphVersion).toBe(root.stateVersion)
        for (const key of ['nodes', 'edges']) if (graph[key] !== undefined) expect(graph[key]).toEqual([])
      }
      if (pack !== undefined) {
        expect(pack).not.toBeNull(); expect(typeof pack).toBe('object'); expect(Array.isArray(pack)).toBe(false)
        expect(Object.keys(pack).every(key => ['sourceRegistry', 'evidenceObjects'].includes(key))).toBe(true)
        for (const key of ['sourceRegistry', 'evidenceObjects']) if (pack[key] !== undefined) expect(pack[key]).toEqual([])
      }
      for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeEvidenceSnapshot,
        RuntimeStateSection, RuntimeGraphSnapshot, RuntimeGraphElement])
        expect(await model.countDocuments(ownedScope)).toBe(0)
      const receiptBefore = await RuntimeStateMigrationReceipt.collection.find({ ...ownedScope }).sort({ _id: 1 }).toArray()
      const initial = buildRuntimeStateNativeInitialFrameworkState({ frameworkState: {}, stateVersion: root.stateVersion })
      const seeded = await RuntimeInstance.collection.updateOne({ _id: ids.runtime, customerId: ids.customer, tenantId: ids.tenant,
        stateVersion: root.stateVersion, updatedAt: root.updatedAt },
      { $set: { 'framework_state.sections': initial.sections, 'framework_state.evidence_pack': initial.evidence_pack,
        'framework_state.intelligence_graph': initial.intelligence_graph } })
      expect(seeded.matchedCount).toBe(1)
      const seededRoot = await currentRoot()
      expect(seededRoot).toEqual({ ...root, framework_state: { ...root.framework_state, ...initial } })
      expect(await RuntimeStateMigrationReceipt.collection.find({ ...ownedScope }).sort({ _id: 1 }).toArray()).toEqual(receiptBefore)
      next.settings.sources = ['SEARCH', 'WEBSITE']; next.settings.startingUrls = [fixture.sourceUrl]
      const saved = await putConfiguration(next)
      expect([saved.status, saved.body.error]).toEqual([200, undefined])
      const descriptor = saved.body.data.availability.researchStart
      expect(descriptor.reason).toBeUndefined()
      expect(descriptor).toMatchObject({ contractVersion: 'public-research-start.v1', eligible: true,
        mode: 'OFFLINE', liveExecutionEnabled: false, classification: 'CONTROLLED_PROVIDER_FREE_RESEARCH' })
      const { fixtureId, fixtureVersion, fixtureFileSha256, controlledBindingId } = descriptor.fixture
      return { configuration: saved.body.data.configuration, payload: { requestKey: randomUUID(), expectedUpdatedAt: at,
        acquisitionProfile: 'STANDARD', researchConfiguration: descriptor.selector,
        controlledReplay: { bindingId: controlledBindingId },
        publicResearch: { mode: 'OFFLINE', fixture: { fixtureId, fixtureVersion, fixtureFileSha256 } } } }
    }
    const rawPublicRun = runId => Run.collection.findOne({ ...(runId ? { runId } : {}), contractVersion: 'public-research-run.v1' })
    const noCanonicalResearch = async () => {
      const root = await currentRoot()
      expect(root.stateVersion).toBe(state)
      expect(root.framework_state.evidence_pack?.evidenceObjects || []).toEqual([])
      expect(await RuntimeEvidenceSource.countDocuments()).toBe(0)
      expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
    }
    const prepareRetainedResponseStart = async () => {
      const file = process.env.VMF_TAVILY_RETAINED_RESPONSE_FILE
      expect(typeof file).toBe('string'); expect(isAbsolute(file)).toBe(true); expect(isProofDataDirectory(file)).toBe(true)
      const bytes = readFileSync(file)
      expect(bytes.length).toBe(6175)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe('1d2e9986210b9e679a30f84cc0f951bddf95422f3eee1e5e4ab43e9ad03dd11b')
      const retained = bytes.toString('utf8'), retainedBody = JSON.parse(retained)
      expect(retainedBody.query === 'infrastructure observability').toBe(true)
      expect(process.env.PUBLIC_RESEARCH_OPERATING_POLICY).toBeUndefined()
      expect(process.env.TAVILY_API_KEY).toBeUndefined()
      const { configuration } = await preparePublicStart(), next = configurationBody(configuration)
      next.settings.sources = ['SEARCH', 'WEBSITE']; next.settings.startingUrls = ['https://parlon.io/']
      next.settings.instructions = 'Isolated retained-response proof; homepage and authority are synthetic.'
      const saved = await putConfiguration(next)
      expect([saved.status, saved.body.error]).toEqual([200, undefined])
      const record = saved.body.data.configuration, requestKey = randomUUID()
      expect(requestKey).not.toBe('a9f9330a-39aa-44b0-814f-544bd8cd74cf')
      const policy = { contractVersion: 'public-research-operating-policy.v1', environment: 'DEVELOPMENT_TEST',
        releaseId: requestKey, expiresAt: new Date(Date.now() + 3600000).toISOString(), binding: {
          customerId: String(ids.customer), tenantId: String(ids.tenant), runtimeInstanceId: String(ids.runtime),
          runtimeInstanceKey: runtimeKey, actorUserId: String(ids.actor), configurationVersion: record.configurationVersion,
          configurationHash: record.configurationHash, basisStateVersion: state, basisUpdatedAt: at },
        approvalRef: 'ISOLATED_FAKE_HTTP_NOT_LIVE_APPROVAL', licensingRef: 'RETAINED_PUBLIC_RESPONSE_OFFLINE_ONLY',
        retentionRef: 'EXTERNAL_FIXTURE_EVIDENCE', disclosureRef: 'NO_EXTERNAL_DISCLOSURE', processingRegion: 'LOCAL_ONLY',
        credentialOwner: 'SYNTHETIC_KEY_ONLY', spendOwner: 'NO_EXTERNAL_SPEND', references: [{
          url: 'https://docs.tavily.com/documentation/api-reference/endpoint/search', version: 'snapshot-2026-11-13',
          sha256: 'sha256:f21c26009cd512a70e18ee6d4bedd9e7699e429fe850fc957a93705ccd24c888' }],
        approvedStartingUrls: ['https://parlon.io/'], approvedDiscoveryUrls: [], approvedTerms: ['infrastructure observability'],
        partialSave: 'NONE', limits: { maxSearchRequests: 1, maxRegistryRequests: 0, maxPages: 1,
          maxPageBytes: 320000, maxJsonBytes: 16384, maxTotalBytes: 1048576, maxElapsedMs: 120000, maxRequestMs: 6000,
          maxCostMicros: 0, searchRequestCostMicros: 0, registryRequestCostMicros: 0,
          concurrency: 1, retries: 0, redirects: 0, modelTokens: 0 } }
      const synthetic = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
      const counters = { search: 0, website: 0 }
      const priorFetch = globalThis.fetch, priorDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
      const priorPolicy = process.env.PUBLIC_RESEARCH_OPERATING_POLICY, priorKey = process.env.TAVILY_API_KEY
      process.env.PUBLIC_RESEARCH_OPERATING_POLICY = JSON.stringify(policy)
      process.env.TAVILY_API_KEY = 'SYNTHETIC_RETAINED_RESPONSE_ONLY_NOT_A_REAL_CREDENTIAL'
      expectedFixtureFetchCalls = 2; expectedFixtureDnsCalls = 1
      globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async hostname => {
        expect(hostname).toBe('parlon.io'); return [{ address: '93.184.216.34', family: 4 }]
      })
      // A callable fake is the only transport dependency. The external fence
      // still denies actual sockets/DNS/TLS even if this exact dispatch changes.
      globalThis.fetch = jest.fn(async (url, options) => {
        if (url === 'https://api.tavily.com/search') {
          counters.search++
          expect(options.method).toBe('POST'); expect(options.redirect).toBe('error')
          expect(options.headers.Authorization === 'Bearer SYNTHETIC_RETAINED_RESPONSE_ONLY_NOT_A_REAL_CREDENTIAL').toBe(true)
          const body = JSON.parse(options.body)
          expect(body.query).toBe('site:parlon.io infrastructure observability')
          expect(body.include_domains).toEqual(['parlon.io']); expect(body.include_domains_mode).toBe('restrict')
          expect(body.max_results).toBe(4); expect(body.search_depth).toBe('basic')
          return new OriginalResponse(bytes, { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (url === 'https://parlon.io/') {
          counters.website++
          expect(options.method ?? 'GET').toBe('GET')
          expect(options.redirect).toBe('manual')
          expect(options.headers.Authorization).toBeUndefined()
          return new OriginalResponse(synthetic.html, { status: 200, headers: {
            'content-type': 'text/html', 'content-length': String(Buffer.byteLength(synthetic.html)) } })
        }
        throw new Error('UNEXPECTED_ISOLATED_RETAINED_RESPONSE_DISPATCH')
      })
      return { retained, retainedBody, counters, payload: { requestKey, expectedUpdatedAt: at, acquisitionProfile: 'STANDARD',
        researchConfiguration: { configurationVersion: record.configurationVersion,
          configurationHash: record.configurationHash, basisStateVersion: state },
        publicResearch: { mode: 'LIVE', releaseId: requestKey } }, restore: () => {
        // Verify exact fake dispatch counts before restoring; never clear calls.
        try {
          expect(globalThis.fetch).toHaveBeenCalledTimes(2)
          expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(1)
          expect(counters).toEqual({ search: 1, website: 1 })
        } finally {
          globalThis.fetch = priorFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = priorDns
          expectedFixtureFetchCalls = 0; expectedFixtureDnsCalls = 0
          if (priorPolicy === undefined) delete process.env.PUBLIC_RESEARCH_OPERATING_POLICY
          else process.env.PUBLIC_RESEARCH_OPERATING_POLICY = priorPolicy
          if (priorKey === undefined) delete process.env.TAVILY_API_KEY
          else process.env.TAVILY_API_KEY = priorKey
        }
      } }
    }
    const assertRetainedOperation = async row => {
      const search = row.publicResearch.operations[0]
      expect(search.category).toBe('SEARCH'); expect(search.phase).toBe('RECORDED'); expect(search.outcome).toBe('SUCCEEDED')
      expect(search.receipt.httpStatus).toBe(200); expect(search.receipt.bytesRead).toBe(6175)
      expect(search.receipt.responseTextHash).toBe('sha256:1d2e9986210b9e679a30f84cc0f951bddf95422f3eee1e5e4ab43e9ad03dd11b')
      expect(search.mapping.queryBinding).toEqual({ contractVersion: 'tavily-query-binding.v2',
        submittedQuery: 'site:parlon.io infrastructure observability', providerQuery: 'infrastructure observability',
        normalization: 'LEADING_APPROVED_SITE_OPERATOR_REMOVED' })
      expect(search.requestDescriptor.body.query).toBe('site:parlon.io infrastructure observability')
      expect(search.requestHash).toBe(publicResearchHash(search.requestDescriptor))
      expect(row.publicResearch.operations.map(operation => operation.category)).toEqual(['SEARCH', 'WEBSITE'])
      expect(row.publicResearch.ledgerSequence).toBe(4)
      for (const audit of await AuditLog.find({ 'diff.runId': row.runId })) expect(audit.verifySignature()).toBe(true)
      const exact = await exactTavily(row.runId)
      expect(exact.status).toBe(200); expect(exact.body.data.publicResearch.receiptHash).toBe(row.publicResearch.ledgerHash)
      return exact.body.data
    }
    retainedResponseTest('retained Tavily response persists exact bytes through synthetic LIVE-shaped transport, pending originals, read-back and idempotent replay', async () => {
      const retained = await prepareRetainedResponseStart()
      try {
        const available = await readConfiguration()
        expect(available.status).toBe(200); expect(available.body.data.availability.researchStart).toMatchObject({ eligible: true, mode: 'LIVE' })
        const started = await acquire(appFor(), retained.payload)
        expect([started.status, started.body.error]).toEqual([200, undefined])
        const row = await rawPublicRun(started.body.data.acquisitionRun.runId)
        expect(row.status).toBe('SUCCEEDED'); expect(row.canonicalSaved).toBe(true)
        expect(row.publicResearch.operations[0].receipt.responseText === retained.retained).toBe(true)
        await assertRetainedOperation(row)
        const sources = await request(appFor()).get(`/${runtimeKey}/state/sources`)
        const pending = await request(appFor()).get(`/${runtimeKey}/state/evidence`).query({ reviewStatus: 'PENDING', pageSize: 50 })
        expect(sources.status).toBe(200); expect(pending.status).toBe(200)
        expect(sources.body.data.sourceRegistry).toHaveLength(1)
        const source = sources.body.data.sourceRegistry[0]
        expect(source.sourceRef).toBe('https://parlon.io/')
        expect(source.sourceCapture.captureReceipt).toMatchObject({ runId: row.runId, attemptId: row.executionAttemptId,
          inputIndex: 0, operation: 'WEBSITE_DECODED_TEXT_CAPTURE' })
        expect(pending.body.data.evidenceObjects.length).toBeGreaterThan(0)
        const serialized = JSON.stringify(pending.body.data.evidenceObjects)
        expect(retained.retainedBody.results.some(item => serialized.includes(item.content))).toBe(false)
        expect(pending.body.data.evidenceObjects.every(object => object.reviewStatus === 'PENDING' && object.sourceId === source.sourceId)).toBe(true)
        const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), original = digest(row)
        const replay = await acquire(appFor(), retained.payload)
        expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ runId: row.runId,
          executionAttemptId: row.executionAttemptId, replay: true, canonicalSaved: true })
        expect(digest(await rawPublicRun(row.runId))).toBe(original)
        expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits)
        expect(await snapshotMaterial()).toEqual(before)
      } finally { retained.restore() }
    })
    retainedResponseTest('retained Tavily response remains signed and replayable when canonical terminal audit failure rolls back synthetic originals', async () => {
      const retained = await prepareRetainedResponseStart(), rootBefore = { ...await currentRoot() }
      delete rootBefore.__v
      const before = await Promise.all([RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection, RuntimeStateMigrationReceipt,
        RuntimeGraphSnapshot, RuntimeGraphElement, RuntimeEvidenceSnapshot].map(async model => [model.collection.name,
        digest({ rows: await model.collection.find({}).sort({ _id: 1 }).toArray() })]))
      const originalLog = auditService.log.bind(auditService)
      let attemptedCanonical = false
      const log = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
        if (input.diff?.phase === 'SUCCEEDED' && input.diff.publicResearchPlanHash) {
          expect(await RuntimeEvidenceSource.countDocuments({ current: true }).session(options.session)).toBeGreaterThan(0)
          expect(await RuntimeEvidenceObject.countDocuments({ current: true }).session(options.session)).toBeGreaterThan(0)
          attemptedCanonical = true
          throw Object.assign(new Error('Synthetic retained-response terminal audit failure'), { status: 503, code: 'SERVICE_UNAVAILABLE',
            details: { reason: 'SYNTHETIC_RETAINED_TERMINAL_AUDIT_FAILURE' } })
        }
        return originalLog(input, options)
      })
      try {
        const started = await acquire(appFor(), retained.payload)
        log.mockRestore()
        expect(attemptedCanonical).toBe(true); expect(started.status).toBe(503)
        expect(started.body.error.details.reason).toBe('SYNTHETIC_RETAINED_TERMINAL_AUDIT_FAILURE')
        const row = await rawPublicRun()
        expect(row.status).toBe('PARTIALLY_SUCCEEDED'); expect(row.canonicalSaved).toBe(false)
        expect(row.publicResearch.operations[0].receipt.responseText === retained.retained).toBe(true)
        await assertRetainedOperation(row)
        const rootAfter = { ...await currentRoot() }; delete rootAfter.__v
        expect(rootAfter).toEqual(rootBefore)
        for (const [collection, hash] of before)
          expect(digest({ rows: await mongoose.connection.db.collection(collection).find({}).sort({ _id: 1 }).toArray() })).toBe(hash)
        expect(await AuditLog.countDocuments({ action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED })).toBe(0)
        const audits = await AuditLog.countDocuments(), saved = digest(row)
        const replay = await acquire(appFor(), retained.payload)
        expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ runId: row.runId,
          status: 'PARTIALLY_SUCCEEDED', canonicalSaved: false, replay: true })
        expect(digest(await rawPublicRun(row.runId))).toBe(saved); expect(await Run.countDocuments()).toBe(1)
        expect(await AuditLog.countDocuments()).toBe(audits)
      } finally { log.mockRestore(); retained.restore() }
    })
    test.each(['EXACT', 'LEADING_APPROVED_SITE_OPERATOR_REMOVED'])('mounted Start persists two signed operations, pending originals and safe exact/history read-back; replay performs no IO with %s query', async normalization => {
      const { payload } = await preparePublicStart()
      let submittedQuery, providerQuery, suppliedResponse, snippet
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation((raw, options) => {
        const body = JSON.parse(raw)
        submittedQuery = body.query
        providerQuery = normalization === 'EXACT' ? submittedQuery
          : submittedQuery.slice(('site:' + new URL(fixture.sourceUrl).hostname + ' ').length)
        body.query = providerQuery; snippet = body.results[0].content; suppliedResponse = JSON.stringify(body)
        return new OriginalResponse(suppliedResponse, options)
      })
      const started = await acquire(appFor(), payload)
      expect([started.status, started.body.error]).toEqual([200, undefined])
      const dto = started.body.data.acquisitionRun, row = await rawPublicRun(dto.runId), root = await currentRoot()
      expect(dto).toMatchObject({ contractVersion: 'public-research-run.v1', plannerVersion: 'public-research-planner.v1',
        status: 'SUCCEEDED', canonicalSaved: true, outputStateVersion: root.stateVersion,
        publicResearch: { mode: 'OFFLINE', liveExecutionEnabled: false, operationCount: 2, completedOperationCount: 2 } })
      expect(dto).not.toHaveProperty('controlledReplayProvenance')
      expect(row.publicResearch.ledgerSequence).toBe(4)
      expect(row.publicResearch.operations.map(operation => [operation.ordinal, operation.category, operation.phase, operation.outcome]))
        .toEqual([[0, 'SEARCH', 'RECORDED', 'SUCCEEDED'], [1, 'WEBSITE', 'RECORDED', 'SUCCEEDED']])
      expect(row.publicResearch.plan.limits).toMatchObject({ maxRegistryRequests: 0, retries: 0, concurrency: 1, redirects: 0, modelTokens: 0 })
      expect(dto.publicResearch.categories.find(category => category.key === 'REGISTRY')).toMatchObject({ status: 'NOT_SELECTED', completedCount: 0 })
      expect(row.publicResearch.operations[0].receipt.httpStatus).toBe(200)
      const search = row.publicResearch.operations[0]
      expect(submittedQuery).toBe('site:controlled-context.example case study')
      expect(providerQuery).toBe(normalization === 'EXACT' ? submittedQuery : 'case study')
      expect(search.mapping.queryBinding).toEqual({ contractVersion: 'tavily-query-binding.v2', submittedQuery, providerQuery, normalization })
      expect(search.requestDescriptor).toEqual({ method: 'POST', url: 'https://api.tavily.com/search', body: {
        query: submittedQuery, search_depth: 'basic', topic: 'general', max_results: 4,
        include_domains: ['controlled-context.example'], include_domains_mode: 'restrict', auto_parameters: false,
        include_answer: false, include_raw_content: false, include_images: false,
        include_image_descriptions: false, include_favicon: false, include_usage: true } })
      expect(search.requestHash).toBe(publicResearchHash(search.requestDescriptor))
      expect(search.receipt.responseText).toBe(suppliedResponse)
      expect(search.receipt.responseTextHash).toBe('sha256:' + createHash('sha256').update(suppliedResponse).digest('hex'))
      expect(row.publicResearch.operations[1].receipt.responseTextHash).toBe('sha256:' + fixture.htmlSha256)
      const ledger = await AuditLog.find({ 'diff.runId': row.runId, 'diff.publicResearchLedgerHash': { $exists: true } }).sort({ 'diff.publicResearchLedgerSequence': 1 })
      expect(ledger.map(audit => audit.diff.publicResearchLedgerSequence)).toEqual([1, 2, 3, 4])
      for (const audit of await AuditLog.find({ 'diff.runId': row.runId })) expect(audit.verifySignature()).toBe(true)
      const exact = await exactTavily(row.runId)
      const history = await request(appFor()).get(`/${runtimeKey}/acquisition-runs`).query(configQuery)
      expect(exact.status).toBe(200); expect(history.status).toBe(200)
      expect(exact.body.data.publicResearch.receiptHash).toBe(row.publicResearch.ledgerHash)
      expect(history.body.data.items[0].publicResearch).toEqual(exact.body.data.publicResearch)
      for (const response of [dto, exact.body.data, history.body.data.items[0]]) {
        expect(response).not.toHaveProperty('controlledReplayProvenance')
        expect(JSON.stringify(response)).not.toContain(row.publicResearch.operations[0].receipt.responseText)
        expect(JSON.stringify(response)).not.toContain(row.publicResearch.operations[1].receipt.responseText)
      }
      const sources = await request(appFor()).get(`/${runtimeKey}/state/sources`)
      const pending = await request(appFor()).get(`/${runtimeKey}/state/evidence`).query({ reviewStatus: 'PENDING', pageSize: 50 })
      expect(sources.status).toBe(200); expect(pending.status).toBe(200)
      expect(sources.body.data.sourceRegistry).toHaveLength(1)
      const source = sources.body.data.sourceRegistry[0], objects = root.framework_state.evidence_pack.evidenceObjects
      expect(JSON.stringify(objects)).not.toContain(snippet)
      expect(source.sourceRef).toBe(fixture.sourceUrl)
      expect(source.sourceCapture.captureReceipt).toMatchObject({ runId: row.runId, attemptId: row.executionAttemptId,
        operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', inputIndex: 0 })
      expect(objects.length).toBeGreaterThan(0)
      expect(pending.body.data.evidenceObjects.map(object => object.evidenceObjectId).sort())
        .toEqual(objects.map(object => object.evidenceObjectId).sort())
      for (const object of pending.body.data.evidenceObjects) {
        expect(object.reviewStatus).toBe('PENDING'); expect(object.sourceId).toBe(source.sourceId)
        expect(object.evidenceSupport).toEqual(objects.find(value => value.evidenceObjectId === object.evidenceObjectId).evidenceSupport || null)
      }
      for (const reviewStatus of ['ACCEPTED', 'REJECTED']) {
        const page = await request(appFor()).get(`/${runtimeKey}/state/evidence`).query({ reviewStatus })
        expect(page.status).toBe(200); expect(page.body.data.total).toBe(0)
      }
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), rows = digest(row)
      const replay = await acquire(appFor(), payload)
      expect(replay.status).toBe(200)
      expect(replay.body.data.acquisitionRun).toMatchObject({ runId: row.runId, executionAttemptId: row.executionAttemptId, replay: true })
      expect(responses).toHaveBeenCalledTimes(1); expect(await Run.countDocuments()).toBe(1)
      expect(digest(await rawPublicRun(row.runId))).toBe(rows)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test.each(['extra wrapper', 'raw response', 'mixed mode', 'missing fixture', 'partial predecessor'])('rejects %s before Run admission or IO', async kind => {
      const { payload } = await preparePublicStart(), responses = jest.spyOn(globalThis, 'Response')
      if (kind === 'extra wrapper') payload.publicResearch.extra = true
      if (kind === 'raw response') payload.responseText = 'UNTRUSTED_CLIENT_BODY'
      if (kind === 'mixed mode') payload.providerFreeSearch = { fixtureId: 'trilogy-clients-search.v1', fixtureVersion: 1, fixtureFileSha256: 'a'.repeat(64) }
      if (kind === 'missing fixture') delete payload.publicResearch.fixture
      if (kind === 'partial predecessor') payload.predecessorRunId = randomUUID()
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
      const response = await acquire(appFor(), payload)
      expect(response.status).toBe(422); expect(responses).not.toHaveBeenCalled()
      expect(await Run.countDocuments()).toBe(0); expect(await snapshotMaterial()).toEqual(before)
      expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test.each(['rate limit', 'malformed JSON', 'IO refusal'])('preserves %s and stops before original capture; replay does not dispatch', async kind => {
      const { payload } = await preparePublicStart()
      const raw = kind === 'rate limit' ? '{"error":"SYNTHETIC_PUBLIC_RATE_LIMIT"}' : '{"incomplete":'
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation(() => {
        if (kind === 'IO refusal') throw new Error('SYNTHETIC_PRIVATE_TRANSPORT_ERROR')
        return new OriginalResponse(raw, { status: kind === 'rate limit' ? 429 : 200 })
      })
      const started = await acquire(appFor(), payload)
      expect([started.status, started.body.error]).toEqual([200, undefined])
      const row = await rawPublicRun(started.body.data.acquisitionRun.runId)
      expect(row).toMatchObject({ status: 'FAILED', canonicalSaved: false })
      expect(row.publicResearch.operations).toHaveLength(1)
      expect(row.publicResearch.operations[0]).toMatchObject({ category: 'SEARCH', phase: 'RECORDED',
        outcome: kind === 'IO refusal' ? 'UNKNOWN' : 'FAILED' })
      if (kind === 'IO refusal') expect(row.publicResearch.operations[0].receipt).toMatchObject({ httpStatus: null,
        responseText: '', bytesRead: 0, transportOutcome: 'FAILED', bodyComplete: false })
      else expect(row.publicResearch.operations[0].receipt).toMatchObject({ responseText: raw, httpStatus: kind === 'rate limit' ? 429 : 200 })
      expect(JSON.stringify(started.body)).not.toContain('SYNTHETIC_PRIVATE_TRANSPORT_ERROR')
      expect(JSON.stringify(started.body)).not.toContain(raw)
      await noCanonicalResearch()
      const audits = await AuditLog.countDocuments(), before = await snapshotMaterial()
      const replay = await acquire(appFor(), payload)
      expect(replay.status).toBe(200)
      expect(replay.body.data.acquisitionRun).toMatchObject({ runId: row.runId, status: 'FAILED', replay: true })
      expect(responses).toHaveBeenCalledTimes(1); expect(await Run.countDocuments()).toBe(1)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test('original failed request replays after settings replacement and lock; a new key cannot dispatch', async () => {
      const { payload, configuration } = await preparePublicStart()
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation(() => new OriginalResponse('', { status: 429 }))
      const first = await acquire(appFor(), payload); expect(first.status).toBe(200)
      const replacement = configurationBody(configuration)
      replacement.settings.sources = ['SEARCH', 'WEBSITE']; replacement.settings.startingUrls = [fixture.sourceUrl]
      replacement.settings.instructions = 'New synthetic saved configuration'
      expect((await putConfiguration(replacement)).status).toBe(200)
      await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
      const replay = await acquire(appFor(), payload)
      expect(replay.status).toBe(200)
      expect(replay.body.data.acquisitionRun).toMatchObject({ runId: first.body.data.acquisitionRun.runId, replay: true })
      const refused = await acquire(appFor(), { ...payload, requestKey: randomUUID() })
      expect(refused.status).toBe(409)
      expect(responses).toHaveBeenCalledTimes(1); expect(await Run.countDocuments()).toBe(1)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test('an explicitly paired retry of the exact failed unsaved basis creates one new attempt', async () => {
      const { payload } = await preparePublicStart()
      const responses = jest.spyOn(globalThis, 'Response').mockImplementationOnce(() => new OriginalResponse('', { status: 429 }))
        .mockImplementation((...args) => new OriginalResponse(...args))
      const first = await acquire(appFor(), payload); expect(first.status).toBe(200)
      const previous = first.body.data.acquisitionRun
      expect(previous).toMatchObject({ status: 'FAILED', canonicalSaved: false })
      const retried = await acquire(appFor(), { ...payload, requestKey: randomUUID(), predecessorRunId: previous.runId,
        predecessorExecutionAttemptId: previous.executionAttemptId })
      expect([retried.status, retried.body.error]).toEqual([200, undefined])
      expect(retried.body.data.acquisitionRun).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true,
        predecessorRunId: previous.runId, predecessorExecutionAttemptId: previous.executionAttemptId })
      expect(retried.body.data.acquisitionRun.executionAttemptId).not.toBe(previous.executionAttemptId)
      expect(await Run.countDocuments()).toBe(2); expect(responses).toHaveBeenCalledTimes(2)
    })
    test('a replacement configuration cannot be used to retry an older failed configuration', async () => {
      const { payload, configuration } = await preparePublicStart()
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation(() => new OriginalResponse('', { status: 429 }))
      const first = await acquire(appFor(), payload); expect(first.status).toBe(200)
      const prior = first.body.data.acquisitionRun, replacement = configurationBody(configuration)
      replacement.settings.sources = ['SEARCH', 'WEBSITE']; replacement.settings.startingUrls = [fixture.sourceUrl]
      const saved = await putConfiguration(replacement); expect(saved.status).toBe(200)
      const selector = saved.body.data.availability.researchStart.selector
      expect(selector.configurationVersion).not.toBe(payload.researchConfiguration.configurationVersion)
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
      const retry = await acquire(appFor(), { ...payload, requestKey: randomUUID(), researchConfiguration: selector,
        predecessorRunId: prior.runId, predecessorExecutionAttemptId: prior.executionAttemptId })
      expect(retry.status).toBe(409); expect(retry.body.error.details.reason).toBe('ACQUISITION_PREDECESSOR_INVALID')
      expect(await Run.countDocuments()).toBe(1); expect(responses).toHaveBeenCalledTimes(1)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    const holdPublicResponse = async () => {
      const prepared = await preparePublicStart(), reached = deferred(), release = deferred()
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation(raw => new OriginalResponse(new ReadableStream({
        async start(controller) {
          reached.resolve()
          await release.promise
          controller.enqueue(new TextEncoder().encode(raw)); controller.close()
        },
      })))
      const worker = acquire(appFor(), prepared.payload).then(value => value)
      await Promise.race([reached.promise, worker.then(response => { throw new Error('PUBLIC worker ended before response barrier: ' + response.status) })])
      const row = await rawPublicRun()
      expect(row).toMatchObject({ status: 'RUNNING', publicResearch: { ledgerSequence: 1 } })
      return { ...prepared, row, worker, responses, release: () => release.resolve() }
    }
    test('a concurrent in-flight original key has one Run and Attempt and refuses the second POST without IO', async () => {
      const held = await holdPublicResponse()
      try {
        const duplicate = await acquire(appFor(), held.payload)
        expect(duplicate.status).toBe(409)
        expect(duplicate.body.error.details.reason).toBe('ACQUISITION_RUN_IN_PROGRESS')
        expect(await Run.countDocuments()).toBe(1)
        expect(await rawPublicRun()).toMatchObject({ runId: held.row.runId, executionAttemptId: held.row.executionAttemptId,
          status: 'RUNNING', publicResearch: { ledgerSequence: 1 } })
        expect(held.responses).toHaveBeenCalledTimes(1)
        held.release()
        const completed = await held.worker
        expect([completed.status, completed.body.error]).toEqual([200, undefined])
        expect(completed.body.data.acquisitionRun).toMatchObject({ runId: held.row.runId,
          executionAttemptId: held.row.executionAttemptId, status: 'SUCCEEDED', canonicalSaved: true })
        expect(await Run.countDocuments()).toBe(1); expect(held.responses).toHaveBeenCalledTimes(1)
      } finally { held.release(); await held.worker }
    })
    test('cancelled PUBLIC Run fences an already dispatched late response and replays without another operation', async () => {
      const held = await holdPublicResponse()
      try {
        const cancelled = await cancelRun(held.row)
        expect([cancelled.status, cancelled.body.error]).toEqual([200, undefined])
        expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', canonicalSaved: false,
          cancellation: { eligible: false, workerStopConfirmed: false } })
        const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), cancelledRow = digest(await rawPublicRun())
        held.release()
        const late = await held.worker
        expect(late.status).toBe(200); expect(late.body.data.acquisitionRun).toMatchObject({ runId: held.row.runId, status: 'CANCELLED' })
        expect(digest(await rawPublicRun())).toBe(cancelledRow)
        expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
        expect(held.responses).toHaveBeenCalledTimes(1)
        const replay = await acquire(appFor(), held.payload)
        expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ status: 'CANCELLED', replay: true })
        expect(held.responses).toHaveBeenCalledTimes(1); expect(await Run.countDocuments()).toBe(1)
      } finally { held.release(); await held.worker }
    })
    test('configuration replacement disables PUBLIC cancellation and stops the next operation after retaining the admitted response', async () => {
      const held = await holdPublicResponse()
      try {
        const replacement = configurationBody(held.configuration)
        replacement.settings.sources = ['SEARCH', 'WEBSITE']; replacement.settings.startingUrls = [fixture.sourceUrl]
        replacement.settings.instructions = 'Changed during the already dispatched synthetic search'
        expect((await putConfiguration(replacement)).status).toBe(200)
        const exact = await exactTavily(held.row.runId)
        expect(exact.status).toBe(200); expect(exact.body.data.cancellation.eligible).toBe(false)
        const cancelled = await cancelRun(held.row)
        expect(cancelled.status).toBe(409); expect(cancelled.body.error.details.reason).toBe('ACQUISITION_CANCELLATION_UNAVAILABLE')
        held.release()
        const late = await held.worker
        expect(late.status).toBe(409); expect(late.body.error.details.reason).toBe('RESEARCH_CONFIGURATION_STALE')
        const row = await rawPublicRun()
        expect(row).toMatchObject({ canonicalSaved: false, status: 'PARTIALLY_SUCCEEDED', publicResearch: { ledgerSequence: 2 } })
        expect(row.publicResearch.operations).toHaveLength(1)
        expect(row.publicResearch.operations[0]).toMatchObject({ category: 'SEARCH', phase: 'RECORDED', outcome: 'SUCCEEDED' })
        expect(held.responses).toHaveBeenCalledTimes(1)
        await noCanonicalResearch()
      } finally { held.release(); await held.worker }
    })
    test.each(['stored response', 'ledger hash', 'same timestamp later audit', 'query binding metadata'])('exact read fails closed for %s tampering', async kind => {
      const { payload } = await preparePublicStart(), started = await acquire(appFor(), payload)
      expect(started.status).toBe(200)
      const row = await rawPublicRun(started.body.data.acquisitionRun.runId)
      if (kind === 'stored response') await Run.collection.updateOne({ _id: row._id }, { $set: { 'publicResearch.operations.0.receipt.responseText': 'UNSIGNED_CHANGED_RESPONSE' } })
      if (kind === 'ledger hash') await Run.collection.updateOne({ _id: row._id }, { $set: { 'publicResearch.ledgerHash': 'sha256:' + 'a'.repeat(64) } })
      if (kind === 'query binding metadata') {
        expect(row.publicResearch.operations[0].mapping.queryBinding.normalization).toBe('EXACT')
        await Run.collection.updateOne({ _id: row._id }, { $set: {
          'publicResearch.operations.0.mapping.queryBinding.normalization': 'LEADING_APPROVED_SITE_OPERATOR_REMOVED' } })
      }
      if (kind === 'same timestamp later audit') {
        const old = await AuditLog.findById(row.publicResearch.ledgerAuditId)
        const data = old.toObject(); delete data._id; delete data.__v
        const later = new AuditLog({ ...data, ts: old.ts, diff: { ...old.diff,
          publicResearchLedgerSequence: row.publicResearch.ledgerSequence + 1 } })
        later.generateSignature(); await later.save()
        expect(later.verifySignature()).toBe(true); expect(later.ts.getTime()).toBe(old.ts.getTime())
      }
      const response = await exactTavily(row.runId)
      expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
    })
    test('PUBLIC history accepts only its correctly bound recorded marker while receipt-only qualification remains closed', async () => {
      const { payload } = await preparePublicStart(), started = await acquire(appFor(), payload)
      expect(started.status).toBe(200)
      const row = await rawPublicRun(started.body.data.acquisitionRun.runId), root = await currentRoot()
      expect(root.controlledReplayIsolation.bindingDigest).toBe(storedControlledReplayBindingDigest(shippedCatalogue.CONTROLLED_REPLAY_BINDINGS[0].binding))
      expect((await exactTavily(row.runId)).status).toBe(200)
      await expect(shippedCatalogue.verifyProviderFreeSearchReceiptScope({ runtimeInstance: root, actorUserId: String(ids.actor) }))
        .rejects.toMatchObject({ status: 409, details: { reason: 'PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED' } })
      await RuntimeInstance.collection.updateOne({ _id: ids.runtime },
        { $set: { 'controlledReplayIsolation.bindingDigest': 'sha256:' + 'a'.repeat(64) } })
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), stored = digest(row)
      const exact = await exactTavily(row.runId)
      expect(exact.status).toBe(409); expect(exact.body.error.details.reason).toBe('PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED')
      expect(exact.body.data).toBeUndefined()
      const replay = await acquire(appFor(), payload)
      expect(replay.status).toBe(409); expect(replay.body.error.details.reason).toBe('PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED')
      expect(digest(await rawPublicRun(row.runId))).toBe(stored); expect(await Run.countDocuments()).toBe(1)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test('required response-audit failure leaves durable DISPATCHING, unchanged material and no automatic redispatch', async () => {
      const { payload } = await preparePublicStart(), original = auditService.log.bind(auditService)
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation((...args) => new OriginalResponse(...args))
      const log = jest.spyOn(auditService, 'log').mockImplementation((input, options) => {
        if (input.diff?.publicResearchLedgerSequence === 2) throw new Error('Synthetic required response audit failure')
        return original(input, options)
      })
      const result = await acquire(appFor(), payload)
      log.mockRestore()
      expect(result.status).toBe(503); expect(result.body.error.details.reason).toBe('ACQUISITION_OUTCOME_UNCONFIRMED')
      const row = await rawPublicRun()
      expect(row).toMatchObject({ status: 'RUNNING', active: true, publicResearch: { ledgerSequence: 1 } })
      expect(row.publicResearch.operations).toHaveLength(1)
      expect(row.publicResearch.operations[0]).toMatchObject({ category: 'SEARCH', phase: 'DISPATCHING', receipt: null })
      expect(await AuditLog.countDocuments({ 'diff.runId': row.runId, 'diff.publicResearchLedgerSequence': 2 })).toBe(0)
      await noCanonicalResearch()
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), originalRow = digest(row)
      const replay = await acquire(appFor(), payload)
      expect(replay.status).toBe(409); expect(replay.body.error.details.reason).toBe('ACQUISITION_RUN_IN_PROGRESS')
      expect(responses).toHaveBeenCalledTimes(1); expect(digest(await rawPublicRun())).toBe(originalRow)
      expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    })
    test.each(['EXACT', 'LEADING_APPROVED_SITE_OPERATOR_REMOVED'])('required terminal audit failure rolls back canonical root, V2 material and save audit after both original operations with %s query', async normalization => {
      const { payload } = await preparePublicStart(), original = auditService.log.bind(auditService)
      const responses = jest.spyOn(globalThis, 'Response').mockImplementation((raw, options) => {
        if (normalization === 'EXACT') return new OriginalResponse(raw, options)
        const body = JSON.parse(raw)
        body.query = body.query.slice(('site:' + new URL(fixture.sourceUrl).hostname + ' ').length)
        return new OriginalResponse(JSON.stringify(body), options)
      })
      const protectedCanonical = async () => {
        const root = { ...await currentRoot() }; delete root.__v // Declared authority CAS bookkeeping, not canonical material.
        const rows = await Promise.all([RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeStateSection, RuntimeStateMigrationReceipt,
          RuntimeGraphSnapshot, RuntimeGraphElement, RuntimeEvidenceSnapshot].map(async model => [model.collection.name,
          (await model.collection.find({}).sort({ _id: 1 }).toArray()).map(row => [String(row._id), digest(row)])]))
        return { root: digest(root), collections: Object.fromEntries(rows) }
      }
      const before = await protectedCanonical()
      let reachedCanonicalSave = false
      const log = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
        if (input.diff?.phase === 'SUCCEEDED' && input.diff.publicResearchPlanHash) {
          expect(options.session.inTransaction()).toBe(true)
          const root = await RuntimeInstance.collection.findOne({ _id: ids.runtime }, { session: options.session })
          expect(root.stateVersion).not.toBe(state)
          expect(await RuntimeEvidenceSource.countDocuments({ current: true }).session(options.session)).toBeGreaterThan(0)
          expect(await RuntimeEvidenceObject.countDocuments({ current: true }).session(options.session)).toBeGreaterThan(0)
          expect(await AuditLog.countDocuments({ action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED }).session(options.session)).toBe(1)
          reachedCanonicalSave = true
          throw Object.assign(new Error('Synthetic required terminal audit failure'), { status: 503, code: 'SERVICE_UNAVAILABLE',
            details: { reason: 'SYNTHETIC_REQUIRED_TERMINAL_AUDIT_FAILURE' } })
        }
        return original(input, options)
      })
      let result
      try { result = await acquire(appFor(), payload) } finally { log.mockRestore() }
      expect(reachedCanonicalSave).toBe(true)
      expect(result.status).toBe(503); expect(result.body.error.details.reason).toBe('SYNTHETIC_REQUIRED_TERMINAL_AUDIT_FAILURE')
      expect(await protectedCanonical()).toEqual(before)
      expect(await AuditLog.countDocuments({ action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED })).toBe(0)
      expect(await AuditLog.countDocuments({ 'diff.phase': 'SUCCEEDED' })).toBe(0)
      const row = await rawPublicRun()
      expect(row).toMatchObject({ status: 'PARTIALLY_SUCCEEDED', active: false, canonicalSaved: false, publicResearch: { ledgerSequence: 4 } })
      expect(row.publicResearch.operations.map(operation => operation.outcome)).toEqual(['SUCCEEDED', 'SUCCEEDED'])
      expect(row.publicResearch.operations[0].mapping.queryBinding.normalization).toBe(normalization)
      expect(responses).toHaveBeenCalledTimes(1)
      expect(row.saveAuditId).toBeUndefined(); expect(row.outputStateVersion).toBeUndefined()
      for (const outcome of row.outcomes) { expect(outcome.evidenceObjectCount).toBe(0); expect(outcome.sourceId).toBeUndefined() }
      expect(await Run.countDocuments()).toBe(1)
      const exact = await exactTavily(row.runId)
      expect(exact.status).toBe(200); expect(exact.body.data.canonicalSaved).toBe(false)
      await noCanonicalResearch()
    })
    test('a locked nonempty protected fixture is refused before admission and remains byte-for-byte unchanged', async () => {
      const { payload } = await preparePublicStart()
      await protectExistingMaterial()
      await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
      const before = await snapshotMaterial(), audits = await AuditLog.countDocuments(), responses = jest.spyOn(globalThis, 'Response')
      const result = await acquire(appFor(), payload)
      expect(result.status).toBe(409); expect(responses).not.toHaveBeenCalled()
      expect(await Run.countDocuments()).toBe(0); expect(await snapshotMaterial()).toEqual(before)
      expect(await AuditLog.countDocuments()).toBe(audits)
    })
  })
  test('registered Trilogy fixture Start persists through the mounted action and ordinary exact/history readers', async () => {
    const { payload } = await prepareTrilogyStart(), before = await protectedReceiptMaterial()
    const responses = jest.spyOn(globalThis, 'Response').mockImplementation((...args) => new OriginalResponse(...args))
    const started = await acquire(appFor(), payload)
    expect(started.status).toBe(200)
    const run = started.body.data.acquisitionRun
    expect(run).toMatchObject({ contractVersion: 'provider-free-search-run.v1', status: 'SUCCEEDED', receiptRecorded: true,
      canonicalSaved: false, providerFreeSearch: { discoveryItemCount: 1, liveExecutionEnabled: false, evidenceObjectCount: 0 } })
    expect(await protectedReceiptMaterial()).toEqual(before)
    const exact = await exactTavily(run.runId), history = await request(appFor()).get(`/${runtimeKey}/acquisition-runs`).query(configQuery)
    expect(exact.status).toBe(200); expect(history.status).toBe(200)
    expect(history.body.data.items.map(item => item.runId)).toEqual([run.runId])
    expect(exact.body.data.providerFreeSearch.recordHash).toBe(run.providerFreeSearch.recordHash)
    const stored = await Run.collection.findOne({ runId: run.runId })
    expect(stored.providerFreeSearch.input.approvedTerms).toEqual(['clients'])
    expect(responses).toHaveBeenCalledTimes(1)
    expect(stored.providerFreeSearch.descriptor).toMatchObject({ method: 'POST', url: 'https://api.tavily.com/search' })
    expect(stored.providerFreeSearch.input.responseText).toContain('not retrieved website content or a client fact')
    expect(JSON.stringify(exact.body)).not.toContain('not retrieved website content or a client fact')
    const unchanged = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const replay = await acquire(appFor(), payload)
    expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({ runId: run.runId,
      executionAttemptId: run.executionAttemptId, replay: true })
    expect(await snapshotMaterial()).toEqual(unchanged); expect(await AuditLog.countDocuments()).toBe(audits)
    expect(await Run.countDocuments()).toBe(1)
    expect(responses).toHaveBeenCalledTimes(1)
  })
  test('mounted fixture Start saves actual HTTP refusal bytes and reopens the original failed receipt without dispatch', async () => {
    const { payload } = await prepareTrilogyStart(), before = await protectedReceiptMaterial()
    const raw = '{"error":"synthetic rate limit"}'
    const responses = jest.spyOn(globalThis, 'Response').mockImplementation(() => new OriginalResponse(raw, { status: 429 }))
    const started = await acquire(appFor(), payload)
    expect(started.status).toBe(200)
    const run = started.body.data.acquisitionRun
    expect(run).toMatchObject({ status: 'FAILED', receiptRecorded: true, canonicalSaved: false })
    const stored = await Run.collection.findOne({ runId: run.runId })
    expect(stored.providerFreeSearch.input).toMatchObject({ responseText: raw, httpStatus: 429, transportOutcome: 'COMPLETE' })
    expect(await protectedReceiptMaterial()).toEqual(before)
    const audits = await AuditLog.countDocuments()
    const replay = await acquire(appFor(), payload)
    expect(replay.status).toBe(200)
    expect(replay.body.data.acquisitionRun).toMatchObject({ runId: run.runId, executionAttemptId: run.executionAttemptId, status: 'FAILED', replay: true })
    expect(responses).toHaveBeenCalledTimes(1)
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits)
    expect((await exactTavily(run.runId)).status).toBe(200)
  })
  test('mounted fixture transport IO refusal saves no invented HTTP receipt or protected material', async () => {
    const { payload } = await prepareTrilogyStart(), before = await snapshotMaterial()
    jest.spyOn(globalThis, 'Response').mockImplementation(() => { throw new Error('SYNTHETIC_SECRET_SENTINEL') })
    const started = await acquire(appFor(), payload)
    expect(started.status).toBe(409)
    expect(started.body.error.details.reason).toBe('PROVIDER_FREE_SEARCH_TRANSPORT_INVALID')
    expect(JSON.stringify(started.body)).not.toContain('SYNTHETIC_SECRET_SENTINEL')
    expect(await Run.countDocuments()).toBe(0); expect(await snapshotMaterial()).toEqual(before)
  })
  test('registered fixture original request replays after configuration replacement and lock without writes', async () => {
    const { payload, configuration } = await prepareTrilogyStart(), first = await acquire(appFor(), payload)
    expect(first.status).toBe(200)
    const changed = configurationBody(configuration); changed.settings.instructions = 'Different saved synthetic settings'
    expect((await putConfiguration(changed)).status).toBe(200)
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const replay = await acquire(appFor(), payload)
    expect(replay.status).toBe(200); expect(replay.body.data.acquisitionRun).toMatchObject({
      runId: first.body.data.acquisitionRun.runId, replay: true })
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    const refused = await acquire(appFor(), { ...payload, requestKey: randomUUID() })
    expect(refused.status).toBe(409); expect(await snapshotMaterial()).toEqual(before)
    expect(await AuditLog.countDocuments()).toBe(audits); expect(await Run.countDocuments()).toBe(1)
  })
  test('registered fixture availability and new dispatch both refuse a disabled renderer action', async () => {
    const { payload } = await prepareTrilogyStart(); projectedBuildEnabled = false
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const availability = await readConfiguration()
    expect(availability.status).toBe(200); expect(availability.body.data.availability.fixtureStart.eligible).toBe(false)
    const refused = await acquire(appFor(), payload)
    expect(refused.status).toBe(409); expect(refused.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits)
    expect(await Run.countDocuments()).toBe(0)
  })
  test.each(['asset', 'selector', 'foreign actor', 'view only', 'mixed raw body'])('registered fixture refuses %s without saved material changes', async kind => {
    const { payload } = await prepareTrilogyStart(), before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    let app = appFor(), status = 409
    if (kind === 'asset') payload.providerFreeSearch.fixtureFileSha256 = 'a'.repeat(64)
    if (kind === 'selector') payload.researchConfiguration.configurationHash = 'sha256:' + 'a'.repeat(64)
    if (kind === 'foreign actor') app = appFor(scopes(), 'aaaaaaaaaaaaaaaaaaaaaaaa')
    if (kind === 'view only') { app = appFor(scopes(['VMF_VIEW'])); status = 403 }
    if (kind === 'mixed raw body') { payload.responseText = '{}'; status = 422 }
    const refused = await acquire(app, payload)
    expect(refused.status).toBe(status)
    if (kind === 'foreign actor') expect(refused.body.error.details.reason).toBe('PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED')
    expect(await snapshotMaterial()).toEqual(before)
    expect(await AuditLog.countDocuments()).toBe(audits); expect(await Run.countDocuments()).toBe(0)
  })

  test('Tavily receipt uses actual independent qualification, existing Run/Attempt and three signed phases without evidence writes', async () => {
    const { payload } = await prepareTavilyReceipt(), before = await protectedReceiptMaterial(), audits = await AuditLog.countDocuments()
    const result = await recordTavily(payload)
    expect(result).toMatchObject({ contractVersion: 'provider-free-search-run.v1', status: 'SUCCEEDED', receiptRecorded: true, canonicalSaved: false,
      providerFreeSearch: { classification: 'LOCAL_SYNTHETIC_RECEIPT_ONLY', provider: 'TAVILY_SEARCH', liveExecutionEnabled: false,
        discoveryItemCount: 1, evidenceObjectCount: 0 } })
    expect(result.outcomes).toEqual([{ kind: 'SEARCH', inputIndex: 0, status: 'SUCCEEDED', evidenceObjectCount: 0 }])
    expect(result.outputStateVersion).toBeUndefined(); expect(result.cancellation).toBeUndefined()
    expect(await protectedReceiptMaterial()).toEqual(before)
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits + 3)
    for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
    expect((await Run.findOne({ runId: result.runId }).lean()).providerFreeSearch).toBeUndefined()
    const stored = await Run.collection.findOne({ runId: result.runId })
    expect(stored.providerFreeSearch.input.responseText).toBe(payload.fixture.responseText)
    expect(stored.providerFreeSearch.rawResponseHash).toBe('sha256:' + createHash('sha256').update(payload.fixture.responseText).digest('hex'))
    const exact = await exactTavily(result.runId); expect(exact.status).toBe(200)
    expect(exact.body.data.providerFreeSearch.recordHash).toBe(result.providerFreeSearch.recordHash)
    expect(JSON.stringify(exact.body)).not.toContain(tavilyResponses.providerShapes.tavily.results[0].content)
    expect(exact.body.data.providerFreeSearch.input).toBeUndefined()
    const history = await request(appFor()).get(`/${runtimeKey}/acquisition-runs`).query(configQuery)
    expect(history.status).toBe(200); expect(history.body.data.items[0].providerFreeSearch.recordHash).toBe(result.providerFreeSearch.recordHash)
    expect(history.body.data.items[0].researchConfiguration.settings).toBeUndefined()
    expect((await readConfiguration()).body.data.availability.canStart).toBe(false)
  })
  test.each(['malformed', 'identity mismatch', 'empty', 'partial', 'rate limited', 'timeout'])('Tavily %s records its bounded private response and truthful terminal receipt', async kind => {
    const { payload } = await prepareTavilyReceipt(), body = JSON.parse(payload.fixture.responseText)
    if (kind === 'malformed') payload.fixture.responseText = '{SYNTHETIC_PRIVATE_FAILURE'
    if (kind === 'identity mismatch') { body.query = 'site:foreign.example'; payload.fixture.responseText = JSON.stringify(body) }
    if (kind === 'empty') { body.results = []; payload.fixture.responseText = JSON.stringify(body) }
    if (kind === 'partial') payload.fixture.transportOutcome = 'PARTIAL'
    if (kind === 'rate limited') { payload.fixture.httpStatus = 429; payload.fixture.responseText = '{SYNTHETIC_PRIVATE_FAILURE' }
    if (kind === 'timeout') { payload.fixture.transportOutcome = 'TIMEOUT'; payload.fixture.httpStatus = null; payload.fixture.responseText = '' }
    const before = await protectedReceiptMaterial(), result = await recordTavily(payload)
    expect(result.status).toBe(kind === 'empty' ? 'SUCCEEDED' : kind === 'partial' ? 'PARTIALLY_SUCCEEDED' : 'FAILED')
    expect(result).toMatchObject({ receiptRecorded: true, canonicalSaved: false })
    const stored = await Run.collection.findOne({ runId: result.runId })
    expect(stored.providerFreeSearch.input.responseText).toBe(payload.fixture.responseText)
    expect(stored.providerFreeSearch.adaptationStatus).toBe(['malformed', 'identity mismatch'].includes(kind) ? 'INVALID_RESPONSE' : 'VALID')
    const read = await exactTavily(result.runId); expect(read.status).toBe(200)
    expect(JSON.stringify(read.body)).not.toContain('SYNTHETIC_PRIVATE_FAILURE')
    expect(await protectedReceiptMaterial()).toEqual(before)
  })
  test('Tavily same-key replay after a signed configuration replacement and lock has no writes or new attempt', async () => {
    const { payload, configuration } = await prepareTavilyReceipt(), original = await recordTavily(payload)
    const changed = configurationBody(configuration); changed.settings.sources = ['SEARCH']; changed.settings.instructions = 'Replacement synthetic scope'
    expect((await putConfiguration(changed)).status).toBe(200)
    await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const replay = await recordTavily(payload)
    expect(replay).toMatchObject({ replay: true, runId: original.runId, executionAttemptId: original.executionAttemptId })
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits); expect(await Run.countDocuments()).toBe(1)
    const read = await exactTavily(original.runId); expect(read.status).toBe(200)
  })
  test('Tavily changed same-key material conflicts and concurrent identical commands keep one Run/Attempt', async () => {
    const { payload } = await prepareTavilyReceipt(), audits = await AuditLog.countDocuments()
    const results = await Promise.all([recordTavily(payload), recordTavily(payload)])
    expect(results[0].runId).toBe(results[1].runId); expect(results[0].executionAttemptId).toBe(results[1].executionAttemptId)
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits + 3)
    const before = await snapshotMaterial()
    await expect(recordTavily({ ...payload, fixture: { ...payload.fixture, responseText: payload.fixture.responseText + ' ' } })).rejects.toMatchObject({ status: 409 })
    expect(await snapshotMaterial()).toEqual(before)
  })
  test('Tavily explicit predecessor Run/Attempt creates a separate retry receipt and replays without changing its failed predecessor', async () => {
    const { payload } = await prepareTavilyReceipt(), originalPayload = { ...payload, fixture: { ...payload.fixture, httpStatus: 429, responseText: '' } }
    const failed = await recordTavily(originalPayload), original = await Run.collection.findOne({ runId: failed.runId })
    const retryPayload = { ...payload, requestKey: randomUUID(), predecessorRunId: failed.runId, predecessorExecutionAttemptId: failed.executionAttemptId }
    const result = await recordTavily(retryPayload)
    expect(result).toMatchObject({ status: 'SUCCEEDED', predecessorRunId: failed.runId, predecessorExecutionAttemptId: failed.executionAttemptId })
    expect(result.runId).not.toBe(failed.runId); expect(result.executionAttemptId).not.toBe(failed.executionAttemptId)
    expect(await Run.collection.findOne({ runId: failed.runId })).toEqual(original)
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    expect(await recordTavily(retryPayload)).toMatchObject({ replay: true, runId: result.runId, executionAttemptId: result.executionAttemptId })
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits); expect(await Run.countDocuments()).toBe(2)
  })
  test.each(['missing attempt', 'wrong attempt', 'other Run', 'changed scope', 'successful predecessor'])('Tavily retry refuses %s without admitting another receipt', async kind => {
    const { payload } = await prepareTavilyReceipt()
    const predecessor = await recordTavily(kind === 'successful predecessor' ? payload : { ...payload, fixture: { ...payload.fixture, httpStatus: 429, responseText: '' } })
    const retry = { ...payload, requestKey: randomUUID(), predecessorRunId: predecessor.runId, predecessorExecutionAttemptId: predecessor.executionAttemptId }
    if (kind === 'missing attempt') delete retry.predecessorExecutionAttemptId
    if (kind === 'wrong attempt') retry.predecessorExecutionAttemptId = randomUUID()
    if (kind === 'other Run') retry.predecessorRunId = randomUUID()
    if (kind === 'changed scope') retry.fixture = { ...retry.fixture, approvedTerms: ['different terms'] }
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    await expect(recordTavily(retry)).rejects.toMatchObject({ status: kind === 'missing attempt' ? 422 : 409 })
    expect(await snapshotMaterial()).toEqual(before); expect(await AuditLog.countDocuments()).toBe(audits); expect(await Run.countDocuments()).toBe(1)
  })
  test.each(['QUEUED', 'RUNNING', 'SUCCEEDED'])('Tavily required %s audit failure rolls back receipt and all version fences', async phase => {
    const { payload } = await prepareTavilyReceipt(), before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const log = auditService.log.bind(auditService)
    const spy = jest.spyOn(auditService, 'log').mockImplementation((input, options) => {
      if (input.action === 'RUNTIME_ACQUISITION_RECORDED' && input.diff.phase === phase) throw new Error('Synthetic required audit unavailable')
      return log(input, options)
    })
    try { await expect(recordTavily(payload)).rejects.toMatchObject({ status: 503, details: { reason: 'PROVIDER_FREE_SEARCH_RECORD_UNAVAILABLE' } }) } finally { spy.mockRestore() }
    expect(await Run.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['raw', 'mapped', 'configuration', 'admission audit', 'start audit', 'terminal audit', 'retry pair'])('Tavily exact read refuses tampered %s rather than returning empty success', async kind => {
    const { payload } = await prepareTavilyReceipt(), result = await recordTavily(payload), row = await Run.collection.findOne({ runId: result.runId })
    if (kind === 'raw') await Run.collection.updateOne({ _id: row._id }, { $set: { 'providerFreeSearch.input.responseText': row.providerFreeSearch.input.responseText + ' ' } })
    if (kind === 'mapped') await Run.collection.updateOne({ _id: row._id }, { $set: { 'providerFreeSearch.mapped.normalized.discoveryItems.0.snippet': 'Changed synthetic claim' } })
    if (kind === 'configuration') await Run.collection.updateOne({ _id: row._id }, { $unset: { researchConfiguration: '' } })
    if (kind === 'retry pair') await Run.collection.updateOne({ _id: row._id }, { $set: { predecessorRunId: randomUUID(), predecessorExecutionAttemptId: randomUUID() } })
    for (const [label, key] of [['admission audit', 'admissionAuditId'], ['start audit', 'startAuditId'], ['terminal audit', 'terminalAuditId']]) {
      if (kind === label) await AuditLog.collection.updateOne({ _id: row[key] }, { $set: { 'diff.providerFreeSearch.recordHash': 'sha256:' + 'f'.repeat(64) } })
    }
    const read = await exactTavily(result.runId); expect(read.status).toBe(503); expect(read.body.data).toBeUndefined()
    expect(read.body.error.details.reason).toBe(['raw', 'mapped'].includes(kind)
      ? 'PROVIDER_FREE_SEARCH_RECEIPT_UNVERIFIED' : 'ACQUISITION_RECEIPT_UNVERIFIED')
  })
  test.each(['locked', 'stale time', 'stale selector', 'read only', 'foreign scope', 'shared actor', 'inactive role', 'controlled marker'])('Tavily refuses %s before receipt admission', async kind => {
    const { payload } = await prepareTavilyReceipt(), extra = {}
    if (kind === 'locked') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED' } })
    if (kind === 'stale time') payload.expectedUpdatedAt = '2026-11-10T10:00:00.000Z'
    if (kind === 'stale selector') payload.fixture.selector.configurationHash = 'sha256:' + 'f'.repeat(64)
    if (kind === 'read only') extra.scopes = scopes(['VMF_VIEW'])
    if (kind === 'foreign scope') extra.scopes = { ...scopes(), tenant: { _id: 'f'.repeat(24), customerId: String(ids.customer) } }
    if (kind === 'shared actor') await User.collection.updateOne({ _id: ids.actor }, { $push: { tenantMemberships: { customerId: ids.customer, tenantId: new mongoose.Types.ObjectId('e'.repeat(24)), roles: ['LOCAL_RESEARCH_OPERATOR'] } } })
    if (kind === 'inactive role') await Role.collection.updateOne({}, { $set: { isActive: false } })
    if (kind === 'controlled marker') await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { controlledReplayIsolation: { classification: 'UNVERIFIED_MARKER' } } })
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const expected = kind === 'read only' ? [403, 'FORBIDDEN'] : kind === 'foreign scope' ? [404, 'RUNTIME_INSTANCE_NOT_FOUND']
      : ['shared actor', 'inactive role', 'controlled marker'].includes(kind) ? [409, 'PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED']
        : [409, 'PROVIDER_FREE_SEARCH_BASIS_STALE']
    await expect(recordTavily(payload, extra)).rejects.toMatchObject({ status: expected[0], details: { reason: expected[1] } })
    expect(await Run.countDocuments()).toBe(0); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['actor', 'role', 'customer', 'tenant'])('Tavily rejected native %s dependency fails record and mounted read closed', async kind => {
    const { payload } = await prepareTavilyReceipt(), result = await recordTavily(payload)
    const model = { actor: User, role: Role, customer: Customer, tenant: Tenant }[kind], method = kind === 'role' ? 'find' : 'findById'
    const original = model[method].bind(model), before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    const spy = jest.spyOn(model, method).mockImplementation((...args) => {
      const query = original(...args); query.lean = async () => { throw new Error('Synthetic native dependency unavailable') }; return query
    })
    try {
      await expect(recordTavily({ ...payload, requestKey: randomUUID() })).rejects.toMatchObject({ status: 503, details: { reason: 'PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED' } })
      const read = await exactTavily(result.runId); expect(read.status).toBe(503); expect(read.body.data).toBeUndefined()
      expect(read.body.error.details.reason).toBe('PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED')
    } finally { spy.mockRestore() }
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test('Tavily queued insertion shares the existing active-acquisition uniqueness fence', async () => {
    const { payload } = await prepareTavilyReceipt(), runtime = await currentRoot()
    const context = await actualAcquisition.lookupAcquisitionRequest({ runtimeInstance: runtime, actorUserId: String(ids.actor),
      actionKey: 'SAVE_DISCOVERY_INPUTS', payload: { requestKey: randomUUID(), expectedUpdatedAt: at, inputs: {} } })
    await actualAcquisition.startAcquisitionRun(context, {})
    const before = await snapshotMaterial(), audits = await AuditLog.countDocuments()
    await expect(recordTavily(payload)).rejects.toMatchObject({ status: 409, details: { reason: 'ACQUISITION_RUN_IN_PROGRESS' } })
    expect(await Run.countDocuments()).toBe(1); expect(await AuditLog.countDocuments()).toBe(audits); expect(await snapshotMaterial()).toEqual(before)
  })
  test.each(['lock first', 'receipt first', 'role revocation first'])('Tavily real transaction linearises %s without changing protected evidence', async order => {
    const { payload } = await prepareTavilyReceipt(), materialBefore = await protectedReceiptMaterial()
    let release, entered, pauseTimer
    const wait = new Promise(resolve => { release = resolve }), seen = new Promise(resolve => { entered = resolve })
    let paused = false, spy
    if (order === 'receipt first') {
      const log = auditService.log.bind(auditService)
      spy = jest.spyOn(auditService, 'log').mockImplementation(async (input, options) => {
        if (!paused && input.action === 'RUNTIME_ACQUISITION_RECORDED' && input.diff.phase === 'QUEUED') { paused = true; entered(); await wait }
        return log(input, options)
      })
    } else {
      const collection = order === 'lock first' ? RuntimeInstance.collection : Role.collection, update = collection.updateOne.bind(collection)
      spy = jest.spyOn(collection, 'updateOne').mockImplementation(async (...args) => {
        if (!paused && args[1]?.$inc?.__v === 1) { paused = true; entered(); await wait }
        return update(...args)
      })
    }
    const recording = recordTavily(payload).then(value => ({ value }), error => ({ error }))
    let competing
    try {
      await Promise.race([seen, new Promise((_, reject) => { pauseTimer = setTimeout(() => reject(new Error('Synthetic overlap pause was not reached')), 10000) })])
      clearTimeout(pauseTimer)
      if (order === 'role revocation first') {
        await Role.collection.updateOne({}, { $set: { isActive: false } })
      } else {
        competing = RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'LOCKED', lockedAt: new Date(at) } })
        if (order === 'lock first') await competing
      }
      release()
      const outcome = await recording
      if (competing) await competing
      if (order === 'receipt first') {
        expect(outcome.value).toMatchObject({ status: 'SUCCEEDED', receiptRecorded: true, canonicalSaved: false })
        expect(await Run.countDocuments()).toBe(1)
      } else {
        expect(outcome.error).toMatchObject({ status: 409, details: { reason: order === 'lock first'
          ? 'PROVIDER_FREE_SEARCH_BASIS_STALE' : 'PROVIDER_FREE_SEARCH_SCOPE_UNVERIFIED' } }); expect(await Run.countDocuments()).toBe(0)
      }
      // The competing lifecycle/role change is the only material change allowed.
      if (order === 'role revocation first') await Role.collection.updateOne({}, { $set: { isActive: true } })
      else await RuntimeInstance.collection.updateOne({ _id: ids.runtime }, { $set: { status: 'ACTIVE' }, $unset: { lockedAt: '' } })
      expect(await protectedReceiptMaterial()).toEqual(materialBefore)
    } finally { clearTimeout(pauseTimer); release(); await recording; spy.mockRestore() }
  }, 30000)

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
        '--config', process.env.VMF_CONTROLLED_REPLAY_JEST_CONFIG || fileURLToPath(new URL('../../package.json', import.meta.url)),
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
