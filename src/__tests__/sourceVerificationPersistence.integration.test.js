import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import Customer from '../models/Customer.js'
import Tenant from '../models/Tenant.js'
import auditService from '../services/auditService.js'
import AuditLog from '../models/AuditLog.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { recordRuntimeSourceVerification } from '../services/runtimeStateMutationService.js'
import { sourceMaterialFingerprint, resolveSourceRecordedReview } from '../services/sourceVerificationContext.js'
import express from 'express'
import request from 'supertest'
import { recordRuntimeSourceVerification as recordSourceReviewEndpoint } from '../controllers/runtimeInstance.controller.js'
import { validateSourceVerificationParams, validateRecordSourceVerification } from '../validators/runtimeInstance.validator.js'

let replica, runtime, source
const id = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, '0'))
const scopes = { resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } } }
const facts = { authenticity: 'AUTHENTIC', sourceOrigin: 'Synthetic origin', organizationRelationship: 'External',
  independenceGroup: 'fixture-origin', supportingReference: 'fixture:proof', rationale: 'Recorded fixture review.' }

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replica.getUri('source_review_isolated'), { autoIndex: false })
  await Promise.all([RuntimeEvidenceSource.createIndexes(), RuntimeEvidenceObject.createIndexes(),
    RuntimeStateSection.createIndexes(), AuditLog.createCollection()])
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  jest.restoreAllMocks()
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({})
  source = { sourceId: 'source-1', sourceType: 'WEBSITE', label: 'Fixture publisher',
    url: 'https://example.test', contentHash: `sha256:${'a'.repeat(64)}`, lineageRef: 'lineage:source-1' }
  runtime = { _id: id(1), customerId: id(2), tenantId: id(3), runtimeInstanceKey: 'source-review-fixture',
    runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', status: 'ACTIVE', executionStatus: 'IDLE',
    updatedAt: new Date('2026-10-09T10:00:00Z'), stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
    framework_state: { lifecycle: { stage: 'DRAFT' }, sections: { context: { accepted: { summary: 'Preserved truth.' } } },
      evidence_pack: { accepted: true, sourceRegistry: [source], evidenceObjects: [], acquisition: { sourceRegistry: [source] } },
      intelligence_graph: { graphVersion: 'fixture-graph', nodes: [], edges: [] } } }
  await Customer.collection.insertOne({ _id: id(2), entitlements: ['VMF'], licenseLevelId: null, topology: 'MULTI_TENANT' })
  await Tenant.collection.insertOne({ _id: id(3), customerId: id(2), status: 'ENABLED' })
  await RuntimeInstance.collection.insertOne(runtime)
  await RuntimePathRegistry.collection.insertOne({ pathKey: 'framework_state.evidence_pack', status: 'ACTIVE',
    frameworkKeys: ['VMF'], allowedOperations: ['READ', 'WRITE'], dataType: 'OBJECT', scope: 'FRAMEWORK_STATE' })
  await RuntimeStateMigrationReceipt.collection.insertOne({ receiptId: String(id(5)), customerId: id(2), tenantId: id(3),
    runtimeInstanceId: id(1), runtimeInstanceKey: runtime.runtimeInstanceKey, operationType: 'LEGACY_BASELINE', status: 'VERIFIED',
    assignedStateVersion: runtime.stateVersion })
  const rows = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 4096,
    sections: runtime.framework_state.sections, evidencePack: runtime.framework_state.evidence_pack,
    intelligenceGraph: runtime.framework_state.intelligence_graph }, scope: { runtimeInstanceId: String(id(1)),
    runtimeInstanceKey: runtime.runtimeInstanceKey, customerId: String(id(2)), tenantId: String(id(3)) },
    stateVersion: runtime.stateVersion, migrationReceiptId: String(id(5)), migrationTimestamp: runtime.updatedAt.toISOString() }).rows
  await RuntimeEvidenceSource.insertMany(rows.evidenceSources.map((row) => ({ ...row, current: true })))
  await RuntimeStateSection.insertMany(rows.sections.map((row) => ({ ...row, current: true })))
})
const write = (overrides = {}) => recordRuntimeSourceVerification({ actorUserId: String(id(4)), scopes,
  runtimeInstanceId: String(id(1)), sourceId: source.sourceId, payload: { expectedUpdatedAt: runtime.updatedAt.toISOString(),
    expectedSourceFingerprint: sourceMaterialFingerprint(source), facts, ...overrides } })

// Controller/validation/persistence proof with controlled request identity;
// authentication and scope loading remain separate middleware responsibilities.
const sourceReviewApp = (requestScopes = scopes) => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.context = { userId: String(id(4)) }
    req.scopes = requestScopes
    req.requestId = 'fixture-source-review-http'
    next()
  })
  app.patch('/:runtimeInstanceId/discovery-sources/:sourceId/verification',
    validateSourceVerificationParams, validateRecordSourceVerification, recordSourceReviewEndpoint)
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }))
  return app
}
const reviewBody = () => ({ expectedUpdatedAt: runtime.updatedAt.toISOString(),
  expectedSourceFingerprint: sourceMaterialFingerprint(source), facts })
const reviewUrl = () => `/${runtime.runtimeInstanceKey}/discovery-sources/${source.sourceId}/verification`

test('HTTP stable-key save returns exact persisted review and rejects stale replay without another audit', async () => {
  const app = sourceReviewApp()
  const body = reviewBody()
  const response = await request(app).patch(reviewUrl()).send(body)
  expect(response.status).toBe(200)
  expect(response.body.data.verificationContext.reviewedBy).toBe(String(id(4)))
  const current = await RuntimeEvidenceSource.findOne({ current: true }).lean()
  const root = await RuntimeInstance.findById(id(1)).lean()
  expect(current.verificationContext).toEqual(response.body.data.verificationContext)
  expect(root.stateVersion).toBe(response.body.data.stateVersion)
  expect(root.framework_state.sections).toEqual(runtime.framework_state.sections)
  const audits = await AuditLog.find({}).lean()
  expect(audits).toHaveLength(1)
  const rejected = await request(app).patch(reviewUrl()).send(body)
  expect(rejected.status).toBe(409)
  expect(await AuditLog.find({}).lean()).toEqual(audits)
  expect(await RuntimeInstance.findById(id(1)).lean()).toEqual(root)
  expect(await RuntimeEvidenceSource.findOne({ current: true }).lean()).toEqual(current)
})

test.each(['invalidBody', 'deniedScope', 'locked', 'missingSource', 'staleSource'])('HTTP %s rejection preserves native records and creates no success audit', async kind => {
  const app = sourceReviewApp(kind === 'deniedScope' ? {} : scopes)
  const body = reviewBody()
  if (kind === 'invalidBody') body.facts = { ...facts, reviewedBy: 'forged-actor' }
  if (kind === 'staleSource') body.expectedSourceFingerprint = `sha256:${'b'.repeat(64)}`
  if (kind === 'locked') await RuntimeInstance.collection.updateOne({ _id: id(1) }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
  const root = await RuntimeInstance.findById(id(1)).lean()
  const nativeSources = await RuntimeEvidenceSource.find({}).lean()
  const response = await request(app).patch(kind === 'missingSource' ? `/${runtime.runtimeInstanceKey}/discovery-sources/missing/verification` : reviewUrl()).send(body)
  expect(response.status).toBe({ invalidBody: 422, deniedScope: 403, locked: 409, missingSource: 404, staleSource: 409 }[kind])
  expect(await RuntimeInstance.findById(id(1)).lean()).toEqual(root)
  expect(await RuntimeEvidenceSource.find({}).lean()).toEqual(nativeSources)
  expect(await AuditLog.countDocuments({})).toBe(0)
})

test('concurrent source review writes admit one revision and reject the stale contender', async () => {
  const results = await Promise.allSettled([write(), write({ facts: { ...facts, rationale: 'Other reviewed finding.' } })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected').reason.status).toBe(409)
  expect(await RuntimeEvidenceSource.countDocuments({ runtimeInstanceId: id(1), current: true })).toBe(1)
  const saved = await RuntimeInstance.findById(id(1)).lean()
  expect(saved.framework_state.evidence_pack.sourceRegistry[0].verificationContext)
    .toEqual(results.find(result => result.status === 'fulfilled').value.verificationContext)
})

test('actual mutation saves review, rolls native source version and preserves accepted truth', async () => {
  const result = await write()
  const root = await RuntimeInstance.findById(id(1)).lean()
  const current = await RuntimeEvidenceSource.findOne({ runtimeInstanceId: id(1), current: true }).lean()
  expect(root.stateVersion).toBe(result.stateVersion)
  expect(root.stateVersion).not.toBe(runtime.stateVersion)
  expect(current.verificationContext).toEqual(result.verificationContext)
  expect(resolveSourceRecordedReview(current)).toEqual(result.verificationContext)
  expect(root.framework_state.sections).toEqual(runtime.framework_state.sections)
  expect(root.framework_state.evidence_pack.accepted).toBe(true)
  expect(root.framework_state.evidence_pack.evidenceObjects).toEqual([])
  expect(root.framework_state.evidence_pack.acquisition.sourceRegistry[0].verificationContext).toEqual(result.verificationContext)
  expect(await RuntimeEvidenceSource.countDocuments({ runtimeInstanceId: id(1) })).toBe(2)
  await expect(write()).rejects.toMatchObject({ status: 409 })
})

test('source without content hash retains material identity across root/native and repeated rollovers', async () => {
  delete source.contentHash
  const pack = { ...runtime.framework_state.evidence_pack, sourceRegistry: [source], acquisition: { sourceRegistry: [source] } }
  await RuntimeInstance.collection.updateOne({ _id: id(1) }, { $set: { 'framework_state.evidence_pack': pack } })
  // Rebuild the isolated fixture baseline, so observed rows still match exact root source hashes.
  const rows = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 4096,
    sections: runtime.framework_state.sections, evidencePack: pack, intelligenceGraph: runtime.framework_state.intelligence_graph },
    scope: { runtimeInstanceId: String(id(1)), runtimeInstanceKey: runtime.runtimeInstanceKey, customerId: String(id(2)), tenantId: String(id(3)) },
    stateVersion: runtime.stateVersion, migrationReceiptId: String(id(5)), migrationTimestamp: runtime.updatedAt.toISOString() }).rows
  await RuntimeEvidenceSource.deleteMany({})
  await RuntimeEvidenceSource.insertMany(rows.evidenceSources.map((row) => ({ ...row, current: true })))
  const first = await write()
  let current = await RuntimeEvidenceSource.findOne({ current: true }).lean()
  expect(resolveSourceRecordedReview(current)).toEqual(first.verificationContext)
  runtime.updatedAt = new Date(first.updatedAt)
  const second = await write()
  current = await RuntimeEvidenceSource.findOne({ current: true }).lean()
  expect(second.verificationContext.sourceFingerprint).toBe(first.verificationContext.sourceFingerprint)
  expect(resolveSourceRecordedReview(current)).toEqual(second.verificationContext)
})

test.each(['source-1#page-2', { documentRef: 'fixture-document', page: 2, fieldPath: 'finding' }])('source location survives actual native revision rollover without altering its predecessor: %j', async sourceLocation => {
  const evidence = { evidenceObjectId: 'located-evidence', sourceId: source.sourceId,
    extractedFact: 'Bounded synthetic observation.', sourceLocation, reviewStatus: 'PENDING' }
  const pack = { ...runtime.framework_state.evidence_pack, evidenceObjects: [evidence] }
  await RuntimeInstance.collection.updateOne({ _id: id(1) }, { $set: { 'framework_state.evidence_pack': pack } })
  const rows = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 4096,
    sections: runtime.framework_state.sections, evidencePack: pack, intelligenceGraph: runtime.framework_state.intelligence_graph },
    scope: { runtimeInstanceId: String(id(1)), runtimeInstanceKey: runtime.runtimeInstanceKey,
      customerId: String(id(2)), tenantId: String(id(3)) }, stateVersion: runtime.stateVersion,
    migrationReceiptId: String(id(5)), migrationTimestamp: runtime.updatedAt.toISOString() }).rows
  await RuntimeEvidenceObject.insertMany(rows.evidenceObjects.map(row => ({ ...row, current: true })))
  const before = await RuntimeEvidenceObject.findOne({ current: true }).lean()
  const result = await write()
  const current = await RuntimeEvidenceObject.findOne({ current: true }).lean()
  const predecessor = await RuntimeEvidenceObject.findById(before._id).lean()
  expect(current.sourceLocation).toEqual(sourceLocation)
  expect(current.stateVersion).toBe(result.stateVersion)
  expect(predecessor.sourceLocation).toEqual(before.sourceLocation)
  expect(predecessor.sourceHash).toBe(before.sourceHash)
  expect(predecessor.current).toBe(false)
  expect((await RuntimeInstance.findById(id(1)).lean()).framework_state.evidence_pack.evidenceObjects[0]).toEqual(evidence)
})

test('audit failure rolls root and native rows back in the real transaction', async () => {
  jest.spyOn(auditService, 'log').mockRejectedValue(new Error('Injected audit failure'))
  await expect(write()).rejects.toMatchObject({ code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED' })
  const root = await RuntimeInstance.findById(id(1)).lean()
  expect(root.stateVersion).toBe(runtime.stateVersion)
  expect(root.framework_state).toEqual(runtime.framework_state)
  expect(await RuntimeEvidenceSource.countDocuments({ runtimeInstanceId: id(1) })).toBe(1)
  expect(await RuntimeEvidenceSource.countDocuments({ current: true, verificationContext: { $exists: true } })).toBe(0)
})

test('rejects locked runtime, stale source and unauthorised caller without mutation', async () => {
  await expect(write({ expectedSourceFingerprint: `sha256:${'b'.repeat(64)}` })).rejects.toMatchObject({ status: 409 })
  await expect(recordRuntimeSourceVerification({ runtimeInstanceId: String(id(1)), sourceId: source.sourceId,
    actorUserId: String(id(4)), scopes: {} })).rejects.toMatchObject({ status: 403 })
  await RuntimeInstance.collection.updateOne({ _id: id(1) }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
  await expect(write()).rejects.toMatchObject({ status: 409 })
  expect(await RuntimeEvidenceSource.countDocuments({ verificationContext: { $exists: true } })).toBe(0)
})
