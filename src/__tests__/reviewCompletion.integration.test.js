import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeReviewCompletion from '../models/RuntimeReviewCompletion.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import AuditLog from '../models/AuditLog.js'
import auditService from '../services/auditService.js'
import { getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { createRuntimeStateCanonicalMappingManifest } from '../services/runtimeStateCanonicalSerializer.js'
import { stageRuntimeStateSourceRollover } from '../services/runtimeStateSourceRolloverService.js'
import { buildSourceCapture, buildEvidenceSupport, sourceEvidenceHash } from '../services/sourceEvidenceContract.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

// Authority simulator only: real Mongo transaction/audit/index proof, not production permission proof.
let permit = true
const authority = jest.fn(async () => { if (!permit) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' }) })
const runtimeService = await import('../services/runtimeInstanceService.js')
await jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...runtimeService,
  assertRuntimePermission: authority,
  getRuntimeInstance: async ({ runtimeInstanceId, scopes, projection, session }) => {
    const row = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeInstanceId,
      customerId: scopes.customer._id, tenantId: scopes.tenant._id }).select(projection).session(session).lean()
    if (!row) throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' })
    return { ...row, id: String(row._id), customerId: String(row.customerId), tenantId: String(row.tenantId) }
  },
}))
const { completeReview, getReviewCompletion } = await import('../services/reviewCompletionService.js')
const { reviewCompletionBodySchema } = await import('../validators/reviewCompletion.validator.js')
const ids = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'actorUserId']
  .map((name) => [name, new mongoose.Types.ObjectId()]))
const runtimeInstanceKey = 'ss042-review-isolated'
const args = { runtimeInstanceId: runtimeInstanceKey, actorUserId: String(ids.actorUserId),
  scopes: { customer: { _id: String(ids.customerId) }, tenant: { _id: String(ids.tenantId) } } }
const scope = { customerId: ids.customerId, tenantId: ids.tenantId, runtimeInstanceId: ids.runtimeInstanceId }
let replica
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const name = `ss042_review_${randomUUID().replaceAll('-', '')}`
  const uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Fresh isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (mongoose.connection.name !== name || (await mongoose.connection.db.listCollections().toArray()).length)
    throw new Error('Fresh isolated database required')
  for (const model of [RuntimeInstance, RuntimeEvidenceObject, RuntimeEvidenceSource, RuntimeReviewCompletion, AuditLog, RuntimeStateMigrationReceipt]) {
    await model.createCollection()
  }
  await RuntimeReviewCompletion.createIndexes()
  await RuntimeEvidenceObject.createIndexes()
  await RuntimeEvidenceSource.createIndexes()
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
beforeEach(async () => {
  permit = true; authority.mockClear(); jest.restoreAllMocks()
  for (const model of [RuntimeInstance, RuntimeEvidenceObject, RuntimeEvidenceSource, RuntimeReviewCompletion, AuditLog, RuntimeStateMigrationReceipt])
    await model.collection.deleteMany({})
})
const fixture = async (statuses = [], { contradiction = null, time = new Date() } = {}) => {
  const version = `rsv2:${randomUUID()}`
  const common = { ...scope, runtimeInstanceKey, current: true, stateVersion: version, sourceStateVersion: version,
    sourceHash: `sha256:${'c'.repeat(64)}`, migrationReceiptId: new mongoose.Types.ObjectId() }
  const evidence = statuses.map((reviewStatus, i) => ({ evidenceObjectId: `evidence-${i}`, sourceId: 'source-one',
    sourceType: 'UPLOADED_DOCUMENT', extractedFact: `Explicit synthetic statement ${i}`, lineageRef: `lineage-${i}`,
    reviewStatus, acceptanceState: '', acceptedBy: reviewStatus === 'ACCEPTED' ? String(ids.actorUserId) : '',
    acceptanceTimestamp: reviewStatus === 'ACCEPTED' ? time.toISOString() : '',
    rejectedBy: reviewStatus === 'REJECTED' ? String(ids.actorUserId) : '',
    rejectionTimestamp: reviewStatus === 'REJECTED' ? time.toISOString() : '' }))
  const sources = statuses.length ? [{ sourceId: 'source-one', sourceType: 'UPLOADED_DOCUMENT', sourceRef: 'synthetic.txt' }] : []
  const candidate = { contradictionId: 'contradiction-one', domain: 'Proof', severity: 'MEDIUM',
    basis: 'Synthetic pair detector', evidenceObjectIds: ['evidence-0', 'evidence-1'] }
  const epoch = randomUUID()
  const hash = getDiscoveryContradictionReview(candidate, evidence, [], String(ids.runtimeInstanceId), epoch).evidencePairHash
  const review = { contradictionId: candidate.contradictionId, contractVersion: 'discovery-contradiction-review-v1',
    runtimeInstanceId: String(ids.runtimeInstanceId), reviewEpoch: epoch, evidencePairHash: hash, reviewId: randomUUID(),
    reviewedBy: String(ids.actorUserId), reviewedAt: time.toISOString(), rationale: 'Explicit synthetic reviewed finding.', disposition: contradiction }
  const pack = { evidenceObjects: evidence, sourceRegistry: sources, evidenceReady: true, needsRefresh: false,
    contradictionReviewEpoch: epoch, contradictionReviews: contradiction ? [review] : [],
    discoveryHealth: { contradictionCandidates: contradiction ? [candidate] : [] } }
  await RuntimeInstance.collection.insertOne({ _id: ids.runtimeInstanceId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceKey, runtimeType: 'VALUE_NARRATIVE', status: 'ACTIVE', executionStatus: 'IDLE',
    stateVersion: version, updatedAt: time, framework_state: { evidence_pack: pack }, revision: { revisionNumber: 1 } })
  if (sources.length) await RuntimeEvidenceSource.collection.insertMany(sources.map((row) => ({ ...common, ...row })))
  if (evidence.length) await RuntimeEvidenceObject.collection.insertMany(evidence.map((row) => ({ ...common, ...row })))
  return { version, evidence, pack }
}
const signoff = async (overrides = {}) => {
  const read = await getReviewCompletion(args)
  return { requestKey: randomUUID(), expectedPopulationHash: read.population.hash,
    rationale: 'Explicit human review of the complete synthetic population.', confirm: true, ...overrides }
}

const capturedFixture = async () => {
  const fixtureState = await fixture(Array(4).fill('ACCEPTED'))
  const statements = ['A first original service statement.', 'A second original service statement.',
    'A third original service statement.', 'A fourth original service statement.']
  const captureText = statements.join('\n')
  const capture = buildSourceCapture({ sourceId: 'source-one', originalContentHash: sourceEvidenceHash('<html>saved offline</html>'),
    captureText, adapter: 'website-html-fetch-v1', extractionMethod: 'DECODED_HTML_STRIPPED_TEXT',
    capturedAt: new Date().toISOString(), operation: 'WEBSITE_DECODED_TEXT_CAPTURE',
    runId: randomUUID(), attemptId: randomUUID(), inputIndex: 0 })
  await RuntimeEvidenceSource.collection.updateOne(scope, { $set: { sourceCapture: capture, contentHash: capture.originalContentHash } })
  const objects = []
  for (let index = 0; index < statements.length; index++) {
    const metadata = { evidenceSupport: buildEvidenceSupport({ captureText, exactSegment: statements[index], sourceCapture: capture }),
      reviewRationale: `Accepted as an explicit synthetic first-party source assertion ${index}.` }
    await RuntimeEvidenceObject.collection.updateOne({ ...scope, evidenceObjectId: `evidence-${index}` }, { $set: metadata })
    objects.push({ ...fixtureState.evidence[index], ...metadata })
  }
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: {
    'framework_state.evidence_pack.evidenceObjects': objects,
  }, $unset: { 'framework_state.evidence_pack.contradictionReviews': '' } })
  return { ...fixtureState, capture, objects }
}

test('recorded empty detector and four fully reconciled decisions create a signed immutable population receipt without invented history', async () => {
  const { capture, objects, version } = await capturedFixture()
  const before = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  const basis = await getReviewCompletion(args)
  expect(basis.population).toMatchObject({ completeness: 'COMPLETE', evidenceCount: 4, sourceCount: 1,
    decisionCount: 4, pendingEvidence: 0, pendingFindings: 0, complete: true })
  const result = await completeReview({ ...args, payload: await signoff() })
  const read = await getReviewCompletion(args)
  const membership = read.latestReceipt.membership
  expect(read.latestReceipt).toMatchObject({ membershipStatus: 'VERIFIED', currency: 'CURRENT', receiptId: result.receipt.receiptId })
  expect(membership).toMatchObject({ runtimeInstanceId: String(ids.runtimeInstanceId), runtimeInstanceKey,
    revisionNumber: 1, observedStateVersion: version, membershipHash: result.receipt.populationHash,
    auditVerified: true, lockFrozen: false })
  expect(membership.evidence.map(item => item.id)).toEqual(objects.map(item => item.evidenceObjectId))
  expect(membership.evidence[0]).toMatchObject({ sourceId: 'source-one', status: 'ACCEPTED',
    decision: { reviewerId: String(ids.actorUserId), rationale: objects[0].reviewRationale },
    support: { excerptHash: objects[0].evidenceSupport.excerptHash } })
  expect(membership.sources[0].capture).toEqual(capture)
  expect(JSON.stringify(membership)).not.toContain('exactExcerpt')
  expect(JSON.stringify(membership)).not.toContain('extractedFact')
  const after = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect(after.framework_state).toEqual(before.framework_state)
  expect(after.status).toBe('ACTIVE')
  expect(after.framework_state.evidence_pack).not.toHaveProperty('contradictionReviews')
  const stored = await RuntimeReviewCompletion.findOne({ receiptId: result.receipt.receiptId })
  await expect(stored.updateOne({ rationale: 'Altered historical membership.' })).rejects.toThrow('append-only')
})

test.each(['missing-detector', 'missing-history-with-candidate', 'null-history', 'malformed-history'])(
  'unknown %s cannot be replaced with an empty population', async kind => {
  await fixture(['ACCEPTED', 'ACCEPTED'], { contradiction: kind === 'missing-history-with-candidate' ? 'CONFIRMED' : null })
  const base = 'framework_state.evidence_pack'
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, kind === 'missing-detector'
    ? { $unset: { [`${base}.discoveryHealth.contradictionCandidates`]: '' } }
    : kind === 'missing-history-with-candidate' ? { $unset: { [`${base}.contradictionReviews`]: '' } }
      : { $set: { [`${base}.contradictionReviews`]: kind === 'null-history' ? null : {} } })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ code: 'REVIEW_POPULATION_UNKNOWN' })
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})

test('an extra canonical object outside a four-item display is never silently excluded', async () => {
  await capturedFixture()
  const existing = await RuntimeEvidenceObject.findOne(scope).lean()
  const { _id, reviewRationale, acceptedBy, acceptanceTimestamp, ...extra } = existing
  await RuntimeEvidenceObject.collection.insertOne({ ...extra, evidenceObjectId: 'outside-display', reviewStatus: 'PENDING' })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ status: 409 })
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $push: {
    'framework_state.evidence_pack.evidenceObjects': { evidenceObjectId: 'outside-display', sourceId: 'source-one', reviewStatus: 'PENDING' },
  } })
  // A legitimate fifth member is counted, rather than refused because a UI happened to show four.
  const read = await getReviewCompletion(args)
  expect(read.population).toMatchObject({ evidenceCount: 5, pendingEvidence: 1, complete: false })
  expect(read.canComplete).toBe(false)
})

test.each(['decision-rationale', 'source-capture', 'support-span'])('changed %s makes the recorded membership stale', async kind => {
  await capturedFixture()
  const saved = await completeReview({ ...args, payload: await signoff() })
  if (kind === 'decision-rationale') {
    const reason = 'A separately changed synthetic reason for this source assertion.'
    await RuntimeEvidenceObject.collection.updateOne({ ...scope, evidenceObjectId: 'evidence-0' }, { $set: { reviewRationale: reason } })
    await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: {
      'framework_state.evidence_pack.evidenceObjects.0.reviewRationale': reason,
    } })
  } else if (kind === 'source-capture') {
    await RuntimeEvidenceSource.collection.updateOne(scope, { $set: { 'sourceCapture.capturedAt': '2026-11-01T10:00:00.000Z' } })
  } else {
    const row = await RuntimeEvidenceObject.findOne({ ...scope, evidenceObjectId: 'evidence-0' }).lean()
    const other = await RuntimeEvidenceObject.findOne({ ...scope, evidenceObjectId: 'evidence-1' }).lean()
    await RuntimeEvidenceObject.collection.updateOne({ _id: row._id }, { $set: { evidenceSupport: other.evidenceSupport } })
  }
  const read = await getReviewCompletion(args)
  expect(read.latestReceipt).toMatchObject({ receiptId: saved.receipt.receiptId, currency: 'STALE', membershipStatus: 'VERIFIED' })
  expect(read.latestReceipt.membership.membershipHash).not.toBe(read.population.hash)
})

test.each(['audit-signature', 'audit-binding', 'manifest', 'binding-removed'])('tampered %s cannot produce verified membership', async kind => {
  await capturedFixture()
  const result = await completeReview({ ...args, payload: await signoff() })
  if (kind === 'manifest') await RuntimeReviewCompletion.collection.updateOne({ receiptId: result.receipt.receiptId },
    { $set: { 'manifest.evidence.0.sourceId': 'unrelated-source' } })
  else if (kind === 'binding-removed') await RuntimeReviewCompletion.collection.updateOne({ receiptId: result.receipt.receiptId },
    { $unset: { 'manifest.binding': '' } })
  else if (kind === 'audit-signature') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(result.receipt.auditId) },
    { $set: { signature: 'not-a-valid-signature' } })
  else {
    const audit = await AuditLog.findById(result.receipt.auditId)
    audit.diff = { ...audit.diff, receiptId: randomUUID() }
    audit.generateSignature()
    await AuditLog.collection.replaceOne({ _id: audit._id }, audit.toObject())
  }
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ code: 'REVIEW_COMPLETION_PROOF_INVALID', status: 503 })
})

test('an authentic historical-shaped manifest remains limited legacy data without reconstruction', async () => {
  await capturedFixture()
  const result = await completeReview({ ...args, payload: await signoff() })
  const stored = await RuntimeReviewCompletion.findOne({ receiptId: result.receipt.receiptId }).lean()
  const manifest = { policy: stored.manifest.policy, refreshNeeded: false,
    evidence: stored.manifest.evidence.map(({ id, basisHash, status }) => ({ id, basisHash, status })),
    sources: stored.manifest.sources.map(({ id, basisHash }) => ({ id, basisHash })), contradictions: [] }
  const populationHash = snapshotHash(manifest)
  // Synthetic historical format only, with its own valid hash and genuine model-signed audit.
  await RuntimeReviewCompletion.collection.updateOne({ _id: stored._id }, { $set: { manifest, populationHash } })
  const audit = await AuditLog.findById(stored.auditId)
  audit.diff = { ...audit.diff, populationHash }
  audit.generateSignature()
  await AuditLog.collection.replaceOne({ _id: audit._id }, audit.toObject())
  const read = await getReviewCompletion(args)
  expect(read.latestReceipt).toMatchObject({ receiptId: stored.receiptId, membershipStatus: 'LEGACY_NOT_RECORDED', currency: 'STALE' })
  expect(read.latestReceipt).not.toHaveProperty('membership')
  expect((await RuntimeReviewCompletion.findById(stored._id).lean()).manifest).toEqual(manifest)
  expect((await AuditLog.findById(stored.auditId)).verifySignature()).toBe(true)
})
test('one decided item out of twenty cannot complete regardless of displayed/filter population', async () => {
  await fixture(['ACCEPTED', ...Array(19).fill('PENDING')])
  const read = await getReviewCompletion(args)
  expect(read).toMatchObject({ canComplete: false, population: { evidenceCount: 20, pendingEvidence: 19 }, latestReceipt: null })
  await expect(completeReview({ ...args, payload: await signoff() })).rejects.toMatchObject({ code: 'REVIEW_COMPLETION_PENDING' })
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})
test.each([[[]], [['REJECTED']], [['ACCEPTED', 'REJECTED']]])('explicit complete/empty population %j persists one signed receipt without truth rollover', async (statuses) => {
  const { version } = await fixture(statuses)
  const before = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect((await getReviewCompletion(args)).latestReceipt).toBeNull()
  const result = await completeReview({ ...args, payload: await signoff() })
  expect(result.receipt).toMatchObject({ currency: 'CURRENT', authority: 'VMF_UPDATE' })
  const after = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect(after.stateVersion).toBe(version)
  expect(after.framework_state).toEqual(before.framework_state)
  expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
  const audit = await AuditLog.findById(result.receipt.auditId)
  expect(audit.verifySignature()).toBe(true)
  expect(audit.diff.action).toBe('REVIEW_COMPLETION')
  expect((await getReviewCompletion(args)).latestReceipt.receiptId).toBe(result.receipt.receiptId)
})
test.each(['CONFIRMED', 'NOT_CONTRADICTORY'])('current %s is disposed; confirmed retains independent readiness blocker', async (contradiction) => {
  await fixture(['ACCEPTED', 'ACCEPTED'], { contradiction })
  const result = await completeReview({ ...args, payload: await signoff() })
  expect(result.population).toMatchObject({ complete: true, pendingFindings: 0,
    confirmedReadinessBlockers: contradiction === 'CONFIRMED' ? 1 : 0 })
})
test('REOPENED and stale decisions block completion', async () => {
  await fixture(['ACCEPTED', 'ACCEPTED'], { contradiction: 'REOPENED' })
  expect((await getReviewCompletion(args)).population.pendingFindings).toBe(1)
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: {
    'framework_state.evidence_pack.contradictionReviewEpoch': randomUUID() } })
  expect((await getReviewCompletion(args)).population.pendingFindings).toBe(1)
})
test('audit failure rolls receipt and concurrency guard back in real transaction', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  const before = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  jest.spyOn(auditService, 'log').mockRejectedValue(new Error('Synthetic audit failure'))
  await expect(completeReview({ ...args, payload })).rejects.toMatchObject({ status: 503 })
  const after = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  expect(after.updatedAt).toEqual(before.updatedAt)
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})
test('concurrent same-key requests serialize and replay one receipt/audit', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  const results = await Promise.all([completeReview({ ...args, payload }), completeReview({ ...args, payload })])
  expect(results[0].receipt.receiptId).toBe(results[1].receipt.receiptId)
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(1)
  expect(await AuditLog.countDocuments()).toBe(1)
})
test('same key changed payload conflicts; permission is rechecked before replay', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  await completeReview({ ...args, payload })
  await expect(completeReview({ ...args, payload: { ...payload, rationale: 'Different human rationale.' } }))
    .rejects.toMatchObject({ code: 'REVIEW_COMPLETION_REQUEST_CONFLICT' })
  permit = false
  await expect(completeReview({ ...args, payload })).rejects.toMatchObject({ status: 403 })
  expect(await AuditLog.countDocuments()).toBe(1)
})
test('unrelated changes preserve currency; relevant evidence/decision changes stale original replay', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  const first = await completeReview({ ...args, payload })
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { name: 'Unrelated title' } })
  expect((await getReviewCompletion(args)).latestReceipt.currency).toBe('CURRENT')
  await RuntimeEvidenceObject.collection.updateOne({ evidenceObjectId: 'evidence-0' }, { $set: { extractedFact: 'Changed exact statement' } })
  const replay = await completeReview({ ...args, payload })
  expect(replay).toMatchObject({ replay: true, receipt: { receiptId: first.receipt.receiptId, currency: 'STALE' } })
  await expect(completeReview({ ...args, payload: { ...payload, requestKey: randomUUID() } }))
    .rejects.toMatchObject({ code: 'REVIEW_COMPLETION_STALE' })
})
test('unrelated opaque rollover retains semantic currentness', async () => {
  await fixture(['ACCEPTED'])
  await completeReview({ ...args, payload: await signoff() })
  const next = `rsv2:${randomUUID()}`
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { stateVersion: next } })
  for (const model of [RuntimeEvidenceObject, RuntimeEvidenceSource])
    await model.collection.updateMany(scope, { $set: { stateVersion: next, sourceStateVersion: next } })
  expect((await getReviewCompletion(args)).latestReceipt.currency).toBe('CURRENT')
})
test.each(['unknown', 'missing-row', 'mixed-current', 'missing-version'])('invalid %s population fails closed without audit', async (kind) => {
  await fixture(['ACCEPTED'])
  if (kind === 'unknown') {
    await RuntimeEvidenceObject.collection.updateOne({ evidenceObjectId: 'evidence-0' }, { $set: { reviewStatus: 'UNKNOWN' } })
    await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { 'framework_state.evidence_pack.evidenceObjects.0.reviewStatus': 'UNKNOWN' } })
  }
  if (kind === 'missing-row') await RuntimeEvidenceObject.collection.deleteMany({})
  if (kind === 'mixed-current') await RuntimeEvidenceObject.collection.updateMany({}, { $set: { isCurrent: false } })
  if (kind === 'missing-version') await RuntimeEvidenceObject.collection.updateMany({}, { $unset: { sourceStateVersion: '' } })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ status: 409 })
  expect(await AuditLog.countDocuments()).toBe(0)
})
test('locked inspection available, new signoff denied; wrong tenant/revision not found', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { status: 'LOCKED', lockedAt: new Date() } })
  expect((await getReviewCompletion(args)).canComplete).toBe(false)
  await expect(completeReview({ ...args, payload })).rejects.toMatchObject({ code: 'REVIEW_COMPLETION_LOCKED' })
  await expect(getReviewCompletion({ ...args, runtimeInstanceId: 'wrong-revision' })).rejects.toMatchObject({ status: 404 })
  await expect(getReviewCompletion({ ...args, scopes: { ...args.scopes, tenant: { _id: new mongoose.Types.ObjectId() } } }))
    .rejects.toMatchObject({ status: 404 })
})
test('large complete population uses150-record pages and no public manifest/body payload', async () => {
  await fixture(Array(1102).fill('ACCEPTED'))
  const started = Date.now()
  const result = await getReviewCompletion(args)
  expect(result.population.evidenceCount).toBe(1102)
  expect(Date.now() - started).toBeLessThan(6000)
  expect(JSON.stringify(result)).not.toContain('Explicit synthetic statement')
  expect(JSON.stringify(result)).not.toContain('manifest')
  expect(result.canComplete).toBe(true)
})
test('strict payload schema rejects guessed counters/actions and missing explicit confirmation', () => {
  const value = { requestKey: randomUUID(), expectedPopulationHash: 'a'.repeat(64), rationale: 'Explicit rationale.', confirm: true }
  expect(reviewCompletionBodySchema.safeParse(value).success).toBe(true)
  expect(reviewCompletionBodySchema.safeParse({ ...value, confirm: false }).success).toBe(false)
  expect(reviewCompletionBodySchema.safeParse({ ...value, count: 0 }).success).toBe(false)
})
test.each(['detector-missing', 'actor-missing', 'time-invalid', 'not-ready'])('unknown %s basis cannot silently complete', async (kind) => {
  await fixture(['ACCEPTED'])
  const path = kind === 'detector-missing' ? 'framework_state.evidence_pack.discoveryHealth'
    : kind === 'actor-missing' ? 'framework_state.evidence_pack.evidenceObjects.0.acceptedBy'
      : kind === 'time-invalid' ? 'framework_state.evidence_pack.evidenceObjects.0.acceptanceTimestamp'
        : 'framework_state.evidence_pack.evidenceReady'
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, kind === 'time-invalid'
    ? { $set: { [path]: 'not-a-server-time' } } : { $unset: { [path]: '' } })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ status: 409 })
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
})
test('absent native arrays/detector need the exact verified empty receipt, never guessed zero', async () => {
  const { version } = await fixture([])
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $unset: { 'framework_state.evidence_pack': '' } })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ code: 'REVIEW_POPULATION_UNKNOWN' })
  await RuntimeStateMigrationReceipt.collection.insertOne({ customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceId: ids.runtimeInstanceId, operationType: 'NATIVE_INITIALIZATION', status: 'VERIFIED',
    assignedStateVersion: version, logicalSources: [{ logicalPath: 'framework_state.evidence_pack', recordCount: 0 }] })
  expect((await getReviewCompletion(args)).population).toMatchObject({ evidenceCount: 0, complete: true })
})
test('refresh-needed marks original completion stale and leaves completion blocked', async () => {
  await fixture(['ACCEPTED'])
  await completeReview({ ...args, payload: await signoff() })
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { 'framework_state.evidence_pack.state.needsRefresh': true } })
  expect(await getReviewCompletion(args)).toMatchObject({ canComplete: false,
    population: { complete: false, reason: 'EVIDENCE_REFRESH_REQUIRED' }, latestReceipt: { currency: 'STALE' } })
})
test('a concurrent governed evidence change before root guard cannot persist old completion', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  const original = RuntimeInstance.updateOne.bind(RuntimeInstance)
  let injected = false
  jest.spyOn(RuntimeInstance, 'updateOne').mockImplementation(async (...values) => {
    if (!injected) {
      injected = true
      const concurrent = await mongoose.connection.startSession()
      try { await concurrent.withTransaction(async () => {
        await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { updatedAt: new Date(Date.now() + 1),
          'framework_state.evidence_pack.evidenceObjects.0.reviewStatus': 'PENDING' } }, { session: concurrent })
        await RuntimeEvidenceObject.collection.updateOne({ evidenceObjectId: 'evidence-0' }, { $set: { reviewStatus: 'PENDING' } }, { session: concurrent })
      }) } finally { await concurrent.endSession() }
    }
    return original(...values)
  })
  await expect(completeReview({ ...args, payload })).rejects.toMatchObject({ code: 'REVIEW_COMPLETION_STALE' })
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})
test('same-millisecond guard always changes the root timestamp', async () => {
  const time = new Date(Date.now() + 30000)
  await fixture(['ACCEPTED'], { time })
  await completeReview({ ...args, payload: await signoff() })
  expect((await RuntimeInstance.findById(ids.runtimeInstanceId).lean()).updatedAt.getTime()).toBe(time.getTime() + 1)
})
test('history states bounded partiality instead of implying complete audit history', async () => {
  await fixture(['ACCEPTED'])
  const payload = await signoff()
  for (let i = 0; i < 26; i++) await completeReview({ ...args, payload: { ...payload, requestKey: randomUUID() } })
  const read = await getReviewCompletion(args)
  expect(read.history).toMatchObject({ hasMore: true, completeness: 'PARTIAL' })
  expect(read.history.records).toHaveLength(25)
}, 15000)
test('shared deadline aborts a slow inventory without receipt/audit writes', async () => {
  await fixture(['ACCEPTED'])
  const original = RuntimeEvidenceObject.find.bind(RuntimeEvidenceObject)
  jest.spyOn(RuntimeEvidenceObject, 'find').mockImplementation((...values) => {
    const query = original(...values)
    const lean = query.lean.bind(query)
    query.lean = async (...options) => {
      await new Promise((resolve) => setTimeout(resolve, 6100))
      return lean(...options)
    }
    return query
  })
  await expect(getReviewCompletion(args)).rejects.toMatchObject({ status: 503 })
  expect(await RuntimeReviewCompletion.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
}, 15000)
test('actual canonical mapper and unrelated rollover retain semantic receipt currency', async () => {
  const { version } = await fixture(['ACCEPTED'])
  const receiptId = new mongoose.Types.ObjectId(), time = new Date().toISOString()
  await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: {
    'framework_state.sections': {}, 'framework_state.intelligence_graph': { graphVersion: version, nodes: [], edges: [] },
    'framework_state.evidence_pack.sourceRegistry.0.contentHash': `sha256:${'a'.repeat(64)}`,
    'framework_state.evidence_pack.evidenceObjects.0.contentHash': `sha256:${'b'.repeat(64)}`,
    'framework_state.evidence_pack.evidenceObjects.0.truthHash': `sha256:${'d'.repeat(64)}`,
    'framework_state.evidence_pack.evidenceObjects.0.lineageHash': `sha256:${'e'.repeat(64)}`,
  } })
  const root = await RuntimeInstance.findById(ids.runtimeInstanceId).lean()
  createRuntimeStateCanonicalMappingManifest({ rawBsonBytes: mongoose.mongo.BSON.serialize(root).length,
    sections: root.framework_state.sections, evidencePack: root.framework_state.evidence_pack,
    intelligenceGraph: root.framework_state.intelligence_graph })
  const set = createRuntimeStateLegacySourceRowSet({ scope: { ...scope, runtimeInstanceKey }, stateVersion: version,
    migrationReceiptId: receiptId, migrationTimestamp: time, legacyInput: {
      rawBsonBytes: mongoose.mongo.BSON.serialize(root).length, sections: root.framework_state.sections,
      evidencePack: root.framework_state.evidence_pack, intelligenceGraph: root.framework_state.intelligence_graph,
    } })
  await RuntimeEvidenceSource.collection.deleteMany({})
  await RuntimeEvidenceObject.collection.deleteMany({})
  await RuntimeEvidenceSource.insertMany(set.rows.evidenceSources.map(row => ({ ...row, current: true })))
  await RuntimeEvidenceObject.insertMany(set.rows.evidenceObjects.map(row => ({ ...row, current: true })))
  await RuntimeStateMigrationReceipt.collection.insertOne({ _id: receiptId, customerId: ids.customerId, tenantId: ids.tenantId,
    runtimeInstanceId: ids.runtimeInstanceId, runtimeInstanceKey, receiptId, operationType: 'LEGACY_BASELINE', status: 'VERIFIED',
    assignedStateVersion: version, verifiedAt: time })
  await completeReview({ ...args, payload: await signoff() })
  const before = await getReviewCompletion(args)
  const next = `rsv2:${randomUUID()}`
  const session = await mongoose.connection.startSession()
  try { await session.withTransaction(async () => {
    const runtime = await RuntimeInstance.findById(ids.runtimeInstanceId).session(session).lean()
    await stageRuntimeStateSourceRollover({ runtimeInstance: runtime, expectedStateVersion: version,
      nextStateVersion: next, nextFrameworkState: runtime.framework_state, mutationTimestamp: new Date().toISOString(), session })
    await RuntimeInstance.collection.updateOne({ _id: ids.runtimeInstanceId }, { $set: { stateVersion: next, updatedAt: new Date() } }, { session })
  }) } finally { await session.endSession() }
  const after = await getReviewCompletion(args)
  expect(after.stateVersion).toBe(next)
  expect(after.population.hash).toBe(before.population.hash)
  expect(after.latestReceipt.currency).toBe('CURRENT')
  expect(await RuntimeEvidenceObject.countDocuments({ current: false })).toBe(1)
  await RuntimeEvidenceSource.collection.updateOne({ current: true }, { $set: { contentHash: `sha256:${'f'.repeat(64)}` } })
  expect((await getReviewCompletion(args)).latestReceipt.currency).toBe('STALE')
})
