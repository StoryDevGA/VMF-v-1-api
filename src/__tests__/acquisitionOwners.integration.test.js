import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeAcquisitionRun from '../models/RuntimeAcquisitionRun.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import AuditLog from '../models/AuditLog.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import { readSourceProcessingSummary } from '../services/sourceProcessingSummary.js'
import { prepareRuntimeEvidenceSnapshot, persistRuntimeEvidenceSnapshot, readVerifiedRuntimeEvidenceSnapshot } from '../services/runtimeEvidenceSnapshotService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import auditService from '../services/auditService.js'
import { createRuntimeStateCanonicalMappingManifest } from '../services/runtimeStateCanonicalSerializer.js'
import { buildRuntimeStateNativeInitialFrameworkState } from '../services/runtimeStateNativeInitializationService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildDiscoveryHealth } from '../services/discoveryIntelligenceService.js'
import { getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'

// Authority and path-registry simulators only. Persistence, source rollover,
// graph construction/staging/promotion, producer, Run indexes and audits are real.
// This suite cannot establish production roles, licences or delivered package policy.
const runtimeService = await import('../services/runtimeInstanceService.js')
await jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...runtimeService,
  assertRuntimePermission: jest.fn(), assertFeatureEntitlement: jest.fn(),
  assertCustomerTenantContext: jest.fn().mockResolvedValue({ customer: {} }),
  getRuntimeInstance: async ({ runtimeInstanceId, projection, session, maxTimeMS }) => {
    const row = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeInstanceId,
      customerId: ids.customerId, tenantId: ids.tenantId }).select(projection).session(session).maxTimeMS(maxTimeMS).lean()
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 })
    return row
  },
}))
await jest.unstable_mockModule('../services/runtimeValidation/runtimeMutationValidator.js', () => ({
  validateRuntimeMutation: jest.fn().mockResolvedValue([]),
}))
const rendererService = await import('../services/runtimeRendererService.js')
await jest.unstable_mockModule('../services/runtimeRendererService.js', () => ({ ...rendererService,
  getRuntimeRenderer: jest.fn().mockResolvedValue({ actions: [{ actionKey: 'BUILD_EVIDENCE_PACK', enabled: true }] }),
}))
const { updateRuntimeDiscoveryInputs, reviewRuntimeDiscoveryContradiction } = await import('../services/runtimeStateMutationService.js')
const { executeRuntimeAction } = await import('../services/runtimeActionExecutionService.js')
const { getAcquisitionRuns, getAcquisitionRun } = await import('../services/acquisitionRunService.js')
const models = [RuntimeInstance, RuntimeAcquisitionRun, RuntimeEvidenceObject, RuntimeEvidenceSource,
  RuntimeStateSection, RuntimeStateMigrationReceipt, RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog, FrameworkPackage]
const documentProof = process.env.VMF_DOCUMENT_MEMBERSHIP_PROOF === '1'
const proofDirectory = process.env.VMF_DOCUMENT_MEMBERSHIP_PROOF_DIR
const proofDatabase = 'ss049_document_membership'
if (documentProof) {
  if (proofDirectory !== 'C:/Dev/StoryLineOS/VMF-Evidence/ss-049/2026-11-11-document-membership-proof') throw new Error('Exact external proof directory required')
  models.push(RuntimeEvidenceSnapshot)
}
const proofTest = documentProof ? test : test.skip
const assertProofOwned = () => {
  if (!documentProof || mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== proofDatabase) throw new Error('Owned document proof database required')
}
const saveProof = (name, value) => {
  assertProofOwned()
  fs.writeFileSync(proofDirectory + '/' + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'actorUserId', 'packageId'].map(key => [key, new mongoose.Types.ObjectId()]))
const key = 'ss042-real-acquisition-owner'
const scope = { customerId: ids.customerId, tenantId: ids.tenantId, runtimeInstanceId: ids.runtimeInstanceId }
const args = { runtimeInstanceId: key, actorUserId: String(ids.actorUserId), scopes: {} }
const owners = [
  ['discovery-inputs', payload => updateRuntimeDiscoveryInputs({ ...args, payload })],
  ['build-action', payload => executeRuntimeAction({ ...args, payload, actionKey: 'BUILD_EVIDENCE_PACK' })],
]
let replica
beforeAll(async () => {
  if (documentProof) {
    const binary = process.env.MONGOMS_SYSTEM_BINARY
    if (binary !== 'C:/Users/garya/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
      || createHash('sha256').update(fs.readFileSync(binary)).digest('hex') !== '919ce2ee9893ffcac72e95610f543beacce721a7c226867568856ca0754d49d8') throw new Error('Pinned installed Mongo binary required')
  }
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    ...(documentProof ? { binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' },
      instanceOpts: [{ port: 27087, ip: '127.0.0.1', dbPath: proofDirectory + '/mongo-data' }] } : {}) })
  const name = documentProof ? proofDatabase : 'ss042_owner_' + randomUUID().replaceAll('-', ''), uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Fresh isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (mongoose.connection.name !== name || (await mongoose.connection.db.listCollections().toArray()).length)
    throw new Error('Fresh empty database required')
  for (const model of models) await model.createCollection()
  for (const model of [RuntimeAcquisitionRun, RuntimeEvidenceObject, RuntimeEvidenceSource, RuntimeStateSection,
    RuntimeGraphSnapshot, RuntimeGraphElement]) await model.createIndexes()
  if (documentProof) await RuntimeEvidenceSnapshot.createIndexes()
}, 120000)
afterAll(async () => {
  if (!documentProof) { await mongoose.disconnect(); await replica?.stop(); return }
  let evidenceFailure, stopped
  try {
    if (mongoose.connection.readyState === 1) saveProof('final-owned-collections', await proofMaterial())
  } catch (error) { evidenceFailure = error }
  try { await mongoose.disconnect() }
  finally {
    stopped = await replica?.stop({ doCleanup: false, force: false })
    fs.writeFileSync(proofDirectory + '/cleanup.json', JSON.stringify({
      ownedMongoStopped: stopped === true, mongoFilesRetained: true,
      evidenceCaptureFailure: evidenceFailure ? { name: evidenceFailure.name, message: evidenceFailure.message } : null,
    }) + String.fromCharCode(10), { flag: 'wx' })
  }
  if (replica && stopped !== true) throw new Error('Owned proof Mongo stop was not confirmed')
  if (evidenceFailure) throw evidenceFailure
})

beforeEach(async () => {
  jest.restoreAllMocks()
  if (documentProof) assertProofOwned()
  for (const model of models) await model.collection.deleteMany({})
})
const fixture = async () => {
  const stateVersion = `rsv2:${randomUUID()}`, updatedAt = new Date(), receiptId = new mongoose.Types.ObjectId()
  await FrameworkPackage.collection.insertOne({ _id: ids.packageId, frameworkKey: 'VMF', packageKey: 'synthetic-owner-package',
    version: '1.0.0', sections: [], actions: [] })
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    packageId: ids.packageId,
    runtimeInstanceKey: key, runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', status: 'ACTIVE', executionStatus: 'IDLE',
    stateVersion, updatedAt, framework_state: { lifecycle: { stage: 'DRAFT' }, sections: {},
      evidence_pack: {}, intelligence_graph: {} } })
  await RuntimeStateMigrationReceipt.collection.insertOne({ ...scope, runtimeInstanceKey: key, receiptId,
    operationType: 'NATIVE_INITIALIZATION', status: 'VERIFIED', assignedStateVersion: stateVersion, verifiedAt: updatedAt })
  const row = (await RuntimeInstance.findById(ids.runtimeInstanceId)).toObject({ depopulate: true, virtuals: false })
  const canonical = buildRuntimeStateNativeInitialFrameworkState({ frameworkState: row.framework_state, stateVersion })
  createRuntimeStateCanonicalMappingManifest({ rawBsonBytes: mongoose.mongo.BSON.serialize(row).length,
    sections: canonical.sections, evidencePack: canonical.evidence_pack, intelligenceGraph: canonical.intelligence_graph })
  return { stateVersion, payload: { requestKey: randomUUID(), expectedUpdatedAt: updatedAt.toISOString(), acquisitionProfile: 'STANDARD',
    inputs: { companyName: 'Synthetic owner proof', companyWebsite: 'https://example.org/', marketRegion: 'Synthetic region',
      targetOffer: 'Synthetic service', websiteSources: [] }, documentSources: [{ fileName: 'short.txt', textContent: 'abc' }] } }
}

// Use the real acquisition producer/root/V2 baseline, then prepare explicit
// synthetic candidate facts. Only fixture preparation directly rewrites rows.
const contradictionFixture = async () => {
  const { payload } = await fixture()
  await owners[0][1](payload)
  let root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const pack = root.framework_state.evidence_pack
  expect(pack.evidenceObjects.length).toBeGreaterThanOrEqual(2)
  for (const [index, item] of pack.evidenceObjects.slice(0, 2).entries()) {
    item.extractedFact = index ? 'The synthetic service does not establish customer outcomes.' : 'Synthetic service offers a managed proposal platform.'
    item.coverageArea = 'Products'; item.category = 'Products'; item.reviewStatus = 'ACCEPTED'
    item.validationStatus = index ? 'VALIDATED' : 'UNVALIDATED'
    item.graphReadyMetadata = { ...item.graphReadyMetadata, domain: 'Products', validationStatus: item.validationStatus }
  }
  pack.contradictionReviews = []
  pack.discoveryHealth = buildDiscoveryHealth({ evidenceObjects: pack.evidenceObjects, runtimeInstanceId: String(root._id), reviewEpoch: pack.contradictionReviewEpoch })
  const candidate = pack.discoveryHealth.contradictionCandidates[0]
  expect(candidate).toBeDefined()
  await RuntimeInstance.collection.updateOne({ _id: root._id }, { $set: { 'framework_state.evidence_pack': pack } })
  root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const receipt = await RuntimeStateMigrationReceipt.findOne().lean()
  const rows = createRuntimeStateLegacySourceRowSet({
    legacyInput: { rawBsonBytes: mongoose.mongo.BSON.serialize(root).length,
      sections: root.framework_state.sections || {}, evidencePack: pack, intelligenceGraph: root.framework_state.intelligence_graph },
    scope: { ...scope, runtimeInstanceKey: key }, stateVersion: root.stateVersion,
    migrationReceiptId: receipt.receiptId, migrationTimestamp: receipt.verifiedAt.toISOString(),
  }).rows
  for (const [model, family] of [[RuntimeEvidenceObject, 'evidenceObjects'], [RuntimeEvidenceSource, 'evidenceSources'], [RuntimeStateSection, 'sections']]) {
    await model.collection.deleteMany({ ...scope })
    if (rows[family].length) await model.insertMany(rows[family].map(row => ({ ...row, current: true })))
  }
  return { contradictionId: candidate.contradictionId, payload: {
    requestKey: randomUUID(), expectedUpdatedAt: root.updatedAt.toISOString(),
    expectedEvidencePairHash: getDiscoveryContradictionReview(candidate, pack.evidenceObjects, [], String(root._id), pack.contradictionReviewEpoch).evidencePairHash,
    disposition: 'NOT_CONTRADICTORY', rationale: 'The two synthetic statements concern different propositions.', confirm: true,
  } }
}

test('contradiction decision retry preserves one real root/V2 save, signed audit and original receipt', async () => {
  const command = await contradictionFixture()
  const first = await reviewRuntimeDiscoveryContradiction({ ...args, ...command })
  const root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean(), audits = await AuditLog.countDocuments(),
    rows = await RuntimeEvidenceObject.countDocuments()
  const replay = await reviewRuntimeDiscoveryContradiction({ ...args, ...command })
  expect(replay).toMatchObject({ review: { reviewId: first.review.reviewId }, replay: true, requiresRefresh: true, receiptCurrentness: 'CURRENT' })
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).stateVersion).toBe(root.stateVersion)
  expect(await AuditLog.countDocuments()).toBe(audits)
  expect(await RuntimeEvidenceObject.countDocuments()).toBe(rows)
  expect(root.framework_state.evidence_pack.contradictionReviews).toHaveLength(1)
  for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
})

test.each([true, false])('concurrent contradiction decisions same-key=%s save once; losing CAS never resubmits', async sameKey => {
  const command = await contradictionFixture()
  const other = { ...command, payload: { ...command.payload, requestKey: sameKey ? command.payload.requestKey : randomUUID() } }
  const results = await Promise.allSettled([command, other].map(item => reviewRuntimeDiscoveryContradiction({ ...args, ...item })))
  expect(results.some(result => result.status === 'fulfilled')).toBe(true)
  for (const result of results.filter(result => result.status === 'rejected')) {
    expect(result.reason).toMatchObject({ status: 409, details: { reason: 'RUNTIME_MUTATION_STALE' } })
  }
  const root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect(root.framework_state.evidence_pack.contradictionReviews).toHaveLength(1)
  const saved = root.framework_state.evidence_pack.contradictionReviews[0]
  const decisionAudits = await AuditLog.find({ 'diff.contradictionReview.requestKey': { $in: [command.payload.requestKey, other.payload.requestKey] } })
  expect(decisionAudits).toHaveLength(1)
  expect(decisionAudits[0].diff.contradictionReview.reviewId).toBe(saved.reviewId)
  for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  const audits = await AuditLog.countDocuments()
  const retry = [command, other].find(item => item.payload.requestKey === saved.requestKey)
  expect(await reviewRuntimeDiscoveryContradiction({ ...args, ...retry })).toMatchObject({ replay: true, review: { reviewId: saved.reviewId } })
  if (!sameKey) {
    const loser = [command, other].find(item => item.payload.requestKey !== saved.requestKey)
    await expect(reviewRuntimeDiscoveryContradiction({ ...args, ...loser })).rejects.toMatchObject({ status: 409 })
  }
  expect(await AuditLog.countDocuments()).toBe(audits)
})

test('contradiction audit failure rolls back retry identity and canonical rows, allowing the same original request afterward', async () => {
  const command = await contradictionFixture(), before = await RuntimeInstance.findById(ids.runtimeInstanceId).lean(),
    rows = await RuntimeEvidenceObject.countDocuments(), audits = await AuditLog.countDocuments(), original = auditService.log.bind(auditService)
  const spy = jest.spyOn(auditService, 'log').mockImplementation((entry, options) => {
    if (entry.diff?.contradictionReview) throw new Error('Synthetic contradiction audit rejection')
    return original(entry, options)
  })
  await expect(reviewRuntimeDiscoveryContradiction({ ...args, ...command })).rejects.toMatchObject({ status: 500, code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED' })
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).stateVersion).toBe(before.stateVersion)
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).framework_state.evidence_pack.contradictionReviews).toHaveLength(0)
  expect(await RuntimeEvidenceObject.countDocuments()).toBe(rows)
  expect(await AuditLog.countDocuments()).toBe(audits)
  spy.mockRestore()
  const result = await reviewRuntimeDiscoveryContradiction({ ...args, ...command })
  expect((await reviewRuntimeDiscoveryContradiction({ ...args, ...command })).review.reviewId).toBe(result.review.reviewId)
})

test.each(owners)('actual %s owner saves Run, root, canonical sources/evidence and signed audit, then replay performs no second write', async (_name, invoke) => {
  const { stateVersion, payload } = await fixture()
  const result = await invoke(payload)
  expect(result.acquisitionRun).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true })
  const root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect(root.stateVersion).not.toBe(stateVersion)
  expect(root.framework_state.evidence_pack.acquisition.runId).toBe(result.acquisitionRun.runId)
  const sources = await RuntimeEvidenceSource.find({ ...scope, current: true }).lean()
  const evidence = await RuntimeEvidenceObject.find({ ...scope, current: true }).lean()
  expect(sources.length).toBeGreaterThan(0); expect(evidence.length).toBeGreaterThan(0)
  expect(sources.every(row => row.stateVersion === root.stateVersion)).toBe(true)
  const document = sources.find(row => row.sourceType === 'UPLOADED_DOCUMENT')
  const outcome = (await RuntimeAcquisitionRun.findOne({ runId: result.acquisitionRun.runId }).lean()).outcomes.find(item => item.kind === 'DOCUMENT')
  expect(outcome.evidenceObjectCount).toBe(0)
  expect(document).toMatchObject({ sourceRef: 'short.txt', contentHash: `sha256:${outcome.contentHash}`,
    processingReceipt: { contractVersion: 'document-processing-receipt.v1', runId: result.acquisitionRun.runId,
      inputIndex: 0, contentHash: `sha256:${outcome.contentHash}` } })
  expect(root.framework_state.evidence_pack.sourceRegistry.find(row => row.sourceId === document.sourceId).processingReceipt)
    .toEqual(document.processingReceipt)
  expect(evidence.every(row => row.stateVersion === root.stateVersion)).toBe(true)
  expect(await RuntimeGraphSnapshot.countDocuments({ ...scope, current: true, stateVersion: root.stateVersion })).toBe(1)
  expect(await RuntimeGraphElement.countDocuments({ ...scope, current: true, stateVersion: root.stateVersion })).toBeGreaterThan(0)
  for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  const audits = await AuditLog.find().lean(), counts = [sources.length, evidence.length, audits.length]
  const replay = await invoke(payload)
  expect(replay).toMatchObject({ acquisitionRun: { runId: result.acquisitionRun.runId, replay: true, requiresRefresh: true } })
  expect([await RuntimeEvidenceSource.countDocuments(), await RuntimeEvidenceObject.countDocuments(), await AuditLog.countDocuments()]).toEqual(counts)
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).stateVersion).toBe(root.stateVersion)
})

test.each(owners)('actual %s owner rolls legacy sources forward, preserves failed retry linkage and replaces changed success', async (_name, invoke) => {
  const { payload } = await fixture()
  const first = await invoke(payload)
  let root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const prior = await RuntimeEvidenceSource.findOne({ ...scope, current: true, sourceType: 'UPLOADED_DOCUMENT' }).lean()
  // Simulate a source from before capture metadata existed. Its optional capture
  // and support must be removed together with the hash they bind to.
  await RuntimeEvidenceSource.collection.updateOne({ _id: prior._id }, {
    $unset: { processingReceipt: '', contentHash: '', sourceCapture: '' },
  })
  await RuntimeEvidenceObject.collection.updateMany({ ...scope, current: true, sourceId: prior.sourceId }, {
    $unset: { evidenceSupport: '' },
  })
  const oldPack = structuredClone(root.framework_state.evidence_pack)
  for (const source of [...oldPack.sourceRegistry, ...(oldPack.lineage?.sources || [])]) {
    if (source.sourceId !== prior.sourceId) continue
    delete source.processingReceipt; delete source.contentHash; delete source.sourceCapture
  }
  for (const item of oldPack.evidenceObjects || []) {
    if (item.sourceId === prior.sourceId) delete item.evidenceSupport
  }
  await RuntimeInstance.collection.updateOne({ _id: root._id }, { $set: { 'framework_state.evidence_pack': oldPack } })
  const second = await invoke({ ...payload, requestKey: randomUUID(), expectedUpdatedAt: root.updatedAt.toISOString() })
  root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const current = await RuntimeEvidenceSource.findOne({ ...scope, current: true, sourceType: 'UPLOADED_DOCUMENT' }).lean()
  expect(current.sourceId).toBe(prior.sourceId)
  expect(current.processingReceipt.runId).toBe(second.acquisitionRun.runId)
  expect(await RuntimeEvidenceSource.countDocuments({ ...scope, current: true, sourceType: 'UPLOADED_DOCUMENT' })).toBe(1)
  expect(first.acquisitionRun.runId).not.toBe(second.acquisitionRun.runId)
  // An all-failed extraction records a failed Run and leaves previously saved
  // canonical document material and its pointer unchanged.
  await expect(invoke({ ...payload, requestKey: randomUUID(), expectedUpdatedAt: root.updatedAt.toISOString(),
    documentSources: [{ fileName: 'short.txt', textContent: '' }] })).rejects.toMatchObject({
      details: { acquisitionRun: { status: 'FAILED', canonicalSaved: false } },
    })
  const retained = await RuntimeEvidenceSource.findOne({ ...scope, current: true, sourceId: current.sourceId }).lean()
  expect(retained.processingReceipt).toEqual(current.processingReceipt)
  root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const changed = await invoke({ ...payload, requestKey: randomUUID(), expectedUpdatedAt: root.updatedAt.toISOString(),
    documentSources: [{ fileName: 'short.txt', textContent: 'Changed synthetic document for engineering verification.' }] })
  const changedSources = await RuntimeEvidenceSource.find({ ...scope, current: true, sourceType: 'UPLOADED_DOCUMENT' }).lean()
  expect(changedSources.find(source => source.processingReceipt?.runId === changed.acquisitionRun.runId)?.contentHash).not.toBe(current.contentHash)
})

test.each(owners.flatMap(([name, invoke]) => ['save', 'terminal'].map(phase => [name, phase, invoke])))('actual %s owner %s audit failure rolls back root and canonical source children', async (name, phase, invoke) => {
  const failedAction = phase === 'terminal' ? 'RUNTIME_ACQUISITION_RECORDED' : name === 'build-action' ? 'RUNTIME_ACTION_EXECUTED' : 'RUNTIME_STATE_MUTATED'
  const { stateVersion, payload } = await fixture(), original = auditService.log.bind(auditService)
  let reached = false
  jest.spyOn(auditService, 'log').mockImplementation((entry, options) => {
    if (entry.action === failedAction && (phase === 'save' || entry.diff?.phase === 'SUCCEEDED'))
      { reached = true; throw new Error('Synthetic required save audit rejection') }
    return original(entry, options)
  })
  await expect(invoke(payload)).rejects.toMatchObject({ details: {
    acquisitionRun: { status: 'FAILED', canonicalSaved: false },
  } })
  expect(reached).toBe(true)
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).stateVersion).toBe(stateVersion)
  expect(await RuntimeEvidenceSource.countDocuments()).toBe(0)
  expect(await RuntimeEvidenceObject.countDocuments()).toBe(0)
  expect(await RuntimeGraphSnapshot.countDocuments()).toBe(0)
  expect((await RuntimeAcquisitionRun.findOne()).status).toBe('FAILED')
})

test.each(owners)('actual %s owner preserves its committed receipt when graph promotion fails afterward', async (_name, invoke) => {
  const { payload } = await fixture()
  jest.spyOn(RuntimeGraphSnapshot, 'create').mockRejectedValue(new Error('Synthetic postcommit graph promotion failure'))
  const result = await invoke(payload)
  expect(result.acquisitionRun).toMatchObject({ status: 'SUCCEEDED', canonicalSaved: true })
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId)).stateVersion).toBe(result.acquisitionRun.outputStateVersion)
  expect(await RuntimeEvidenceSource.countDocuments({ ...scope, current: true })).toBeGreaterThan(0)
  expect((await invoke(payload)).acquisitionRun.runId).toBe(result.acquisitionRun.runId)
})

test('history reads project bounded safe previews and exact details verify the signed terminal receipt', async () => {
  const { payload } = await fixture(), result = await owners[0][1](payload)
  const original = await RuntimeAcquisitionRun.findOne().lean()
  await RuntimeAcquisitionRun.collection.insertMany(Array.from({ length: 29 }, (_, index) => ({ ...original,
    _id: new mongoose.Types.ObjectId(), runId: randomUUID(), requestKey: randomUUID(),
    createdAt: new Date(new Date(original.createdAt).getTime() - index - 1) })))
  const spy = jest.spyOn(RuntimeAcquisitionRun.collection, 'find')
  const first = await getAcquisitionRuns(args)
  expect(first).toMatchObject({ hasMore: true, completeness: 'MORE_PAGES', verification: 'RECORDED_HISTORY_PREVIEW' })
  expect(first.items).toHaveLength(25)
  expect(spy.mock.calls.at(-1)[1].projection).not.toHaveProperty('inputs')
  expect(spy.mock.calls.at(-1)[1].projection).not.toHaveProperty('requestFingerprint')
  expect(JSON.stringify(first)).not.toMatch(/contentHash|Fingerprint|textContent|executionAttemptId/)
  const last = await getAcquisitionRuns({ ...args, query: { cursor: first.nextCursor } })
  expect(last).toMatchObject({ hasMore: false, completeness: 'COMPLETE_PAGE' }); expect(last.items).toHaveLength(5)
  expect(new Set([...first.items, ...last.items].map(item => item.runId)).size).toBe(30)
  expect((await getAcquisitionRun({ ...args, runId: result.acquisitionRun.runId })).currency).toBe('CURRENT_OUTPUT')
  await RuntimeAcquisitionRun.collection.updateOne({ runId: result.acquisitionRun.runId }, { $set: { outcomes: [] } })
  await expect(getAcquisitionRun({ ...args, runId: result.acquisitionRun.runId })).rejects.toMatchObject({
    details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED' },
  })
})


// Explicit isolated proof only. LOCKED metadata below is an in-memory authored
// precondition; the stored document producer root stays ACTIVE. No lock action,
// approval, publication, provider, customer record or browser fixture is changed.
const proofMaterial = async () => {
  assertProofOwned()
  const result = {}
  for (const model of models) {
    const rows = await model.collection.find({}).sort({ _id: 1 }).toArray()
    result[model.collection.name] = { count: rows.length,
      hash: createHash('sha256').update(Buffer.concat(rows.map(row => mongoose.mongo.BSON.serialize(row)))).digest('hex'),
      indexes: await model.collection.indexes() }
  }
  return result
}
const readDocumentProof = async root => {
  const session = await mongoose.startSession()
  let result
  try {
    await session.withTransaction(async () => {
      result = await readSourceProcessingSummary({ session, deadline: Date.now() + 6000,
        control: { id: String(root._id), customerId: String(root.customerId), tenantId: String(root.tenantId),
          runtimeInstanceKey: root.runtimeInstanceKey, stateVersion: root.stateVersion },
        sourceFilter: { ...scope, runtimeInstanceKey: key, current: true },
        validateSources: rows => { expect(rows.every(row => row.stateVersion === root.stateVersion && row.sourceStateVersion === root.stateVersion)).toBe(true) } })
    })
  } finally { await session.endSession() }
  return result
}
const documentMembershipFixture = async () => {
  const { payload } = await fixture()
  payload.documentSources = [{ fileName: 'synthetic-proof.txt', textContent:
    'The fictional team provides proposal drafting software for an illustrative internal workflow. This synthetic document is only for isolated processing proof; it establishes no measured improvement, customer result or deployment authority.' }]
  const result = await owners[1][1](payload)
  expect(result.acquisitionRun.status).toBe('SUCCEEDED')
  const root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const document = await RuntimeEvidenceSource.findOne({ ...scope, current: true, sourceType: 'UPLOADED_DOCUMENT' }).lean()
  const run = await RuntimeAcquisitionRun.findOne({ runId: result.acquisitionRun.runId }).lean()
  const outcome = run.outcomes.find(row => row.kind === 'DOCUMENT' && row.inputIndex === 0)
  expect(outcome.status).toBe('SUCCEEDED')
  expect(outcome.evidenceObjectCount).toBeGreaterThan(0)
  expect(document.processingReceipt).toEqual({ contractVersion: 'document-processing-receipt.v1',
    runId: run.runId, inputIndex: 0, contentHash: document.contentHash })
  expect(document.contentHash).toBe('sha256:' + outcome.contentHash)
  for (const id of [run.saveAuditId, run.terminalAuditId]) expect((await AuditLog.findById(id)).verifySignature()).toBe(true)
  expect(await readDocumentProof(root)).toMatchObject({ documentsProcessed: 1, knownProcessedCount: 1,
    documentSourceCount: 1, unknownCount: 0, staleCount: 0 })
  const at = new Date().toISOString()
  const lockView = { ...root, packageKey: 'synthetic-owner-package', packageVersion: '1.0.0',
    dependencyLockId: 'AUTHORED_FIXTURE_DEPENDENCY', activationId: 'AUTHORED_FIXTURE_ACTIVATION', deploymentId: 'AUTHORED_FIXTURE_DEPLOYMENT',
    revision: { revisionNumber: 1 }, status: 'LOCKED', lockedAt: new Date(at), lockedBy: ids.actorUserId,
    framework_state: { ...root.framework_state, lock: { locked: true, snapshot: {
      snapshotId: 'AUTHORED_FIXTURE_TRUTH_LOCK', snapshotHash: 'a'.repeat(64), snapshotAt: at,
      contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } } } }
  return { root, document, run, lockView, at }
}
const saveDocumentMembership = async (f, abort = false, preparedOverride) => {
  const session = await mongoose.startSession()
  let prepared
  try {
    await session.withTransaction(async () => {
      prepared = preparedOverride || await prepareRuntimeEvidenceSnapshot({ runtime: f.lockView, session })
      const audit = new AuditLog({ actorUserId: ids.actorUserId, action: 'RUNTIME_ACTION_EXECUTED',
        resourceType: 'RuntimeInstance', resourceId: ids.runtimeInstanceId,
        scope: { ...scope, runtimeInstanceKey: key },
        diff: { actionKey: 'LOCK_RECORD', actionedAt: f.at,
          evidenceMembershipSnapshot: { ...prepared.pointer, counts: prepared.body.counts } } })
      audit.generateSignature()
      await audit.save({ session })
      await persistRuntimeEvidenceSnapshot({ prepared, actorUserId: ids.actorUserId, audit, session })
      if (abort) throw new Error('Intentional owned snapshot abort')
    })
  } finally { await session.endSession() }
  return prepared
}
proofTest.each(['positive', 'missing-receipt', 'changed-content', 'terminal-signature', 'abort'])('provider-free document membership proof: %s', async mode => {
  assertProofOwned()
  const f = await documentMembershipFixture(), producerMaterial = await proofMaterial()
  if (mode === 'abort') {
    await expect(saveDocumentMembership(f, true)).rejects.toThrow('Intentional owned snapshot abort')
    expect(await proofMaterial()).toEqual(producerMaterial)
    saveProof('case-' + mode, { proof: 'ISOLATED_PROVIDER_FREE_REAL_TRANSACTION_ABORT',
      root: f.root, document: f.document, run: f.run, before: producerMaterial, after: await proofMaterial(),
      snapshots: await RuntimeEvidenceSnapshot.countDocuments(), storedRootRemainsActive: f.root.status === 'ACTIVE' })
    return
  }
  const prepared = await saveDocumentMembership(f)
  const saved = await RuntimeEvidenceSnapshot.collection.findOne({ snapshotId: prepared.pointer.snapshotId })
  expect(saved.body).toEqual(prepared.body)
  expect(membershipHash(saved.body)).toBe(prepared.pointer.membershipHash)
  expect(saved.body.sources.some(row => row.sourceId === f.document.sourceId && row.storageId === String(f.document._id))).toBe(true)
  const verified = await readVerifiedRuntimeEvidenceSnapshot({ runtime: f.lockView, pointer: prepared.pointer })
  expect(verified).toMatchObject({ available: true, completeness: 'VERIFIED', verification: { auditLinkVerified: true } })
  const lockAudit = await AuditLog.findById(saved.lockAuditId)
  expect(lockAudit.verifySignature()).toBe(true)
  let summary, refusal = null
  if (mode === 'positive') {
    const baseline = await proofMaterial()
    await expect(RuntimeEvidenceSnapshot.updateOne({ _id: saved._id }, { $set: { body: {} } })).rejects.toMatchObject({ details: { reason: 'SNAPSHOT_IMMUTABLE' } })
    const duplicate = { ...prepared, pointer: { ...prepared.pointer, snapshotId: 'evidence_snapshot_' + randomUUID() } }
    await expect(saveDocumentMembership(f, false, duplicate)).rejects.toMatchObject({ code: 11000 })
    expect(await proofMaterial()).toEqual(baseline)
    summary = await readDocumentProof(f.root)
  } else {
    if (mode === 'missing-receipt') await RuntimeEvidenceSource.collection.updateOne({ _id: f.document._id }, { $unset: { processingReceipt: '' } })
    if (mode === 'changed-content') await RuntimeEvidenceSource.collection.updateOne({ _id: f.document._id }, { $set: { contentHash: 'sha256:' + '0'.repeat(64) } })
    if (mode === 'terminal-signature') await AuditLog.collection.updateOne({ _id: f.run.terminalAuditId }, { $set: { signature: '0'.repeat(64) } })
    summary = await readDocumentProof(f.root)
    const reason = mode === 'missing-receipt' ? 'PROCESSING_PROVENANCE_MISSING_OR_INVALID'
      : mode === 'changed-content' ? 'PROCESSING_CONTENT_CHANGED' : 'PROCESSING_RECEIPT_UNVERIFIED'
    expect(summary).toMatchObject({ documentSourceCount: 1, knownProcessedCount: 0, reasons: { [reason]: 1 } })
    if (mode !== 'changed-content') expect(summary.documentsProcessed).toBeNull()
    else expect(summary.staleCount).toBe(1)
    if (mode !== 'terminal-signature') {
      await expect(readVerifiedRuntimeEvidenceSnapshot({ runtime: f.lockView, pointer: prepared.pointer })).rejects.toMatchObject({ details: { reason: 'MEMBER_MATERIAL_CHANGED' } })
      refusal = 'MEMBER_MATERIAL_CHANGED'
    } else expect((await readVerifiedRuntimeEvidenceSnapshot({ runtime: f.lockView, pointer: prepared.pointer })).completeness).toBe('VERIFIED')
  }
  expect(await RuntimeEvidenceSnapshot.collection.findOne({ _id: saved._id })).toEqual(saved)
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId).lean()).status).toBe('ACTIVE')
  saveProof('case-' + mode, { proof: 'ISOLATED_PROVIDER_FREE_DOCUMENT_TO_MEMBERSHIP',
    authoredPreconditions: 'In-memory LOCKED/package/dependency view and signed synthetic audit; no actual lock, activation, approval or publication',
    root: f.root, document: f.document, run: f.run, lockView: f.lockView, prepared, saved,
    lockAudit: lockAudit.toObject(), verified, summary, refusal, producerMaterial, finalMaterial: await proofMaterial(),
    storedRootRemainsActive: true })
}, 30000)
