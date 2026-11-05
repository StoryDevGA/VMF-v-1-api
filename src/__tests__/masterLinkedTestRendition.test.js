import { jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Audit from '../models/AuditLog.js'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import auditService from '../services/auditService.js'
import { masterLinkedCompletedReviewFixture } from './fixtures/masterLinkedCompletedReviewFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { G1_MODES } from '../services/masterLinkedGenuineReviewContract.js'
import { privateDocxBytes } from '../services/outcomeDocxCandidateRecordContract.js'
import { createMasterLinkedTestRenditionPreflight, createQaMasterLinkedTestRenditionPreflight } from '../services/masterLinkedTestRenditionService.js'
import { assertTestRenditionDescriptor, assertTestRenditionProbeArtifact, assertTestRenditionProbeAudit,
  TEST_RENDITION_PROBE_TYPE, TEST_RENDITION_PROBE_ACTION, testRenditionProbeFamily } from '../services/masterLinkedTestRenditionContract.js'

// In-memory I/O seams with real schemas, signatures and protected mutation
// hooks. These do not establish Mongo transaction rollback or native admission.
const clone = v => mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize(v), { promoteBuffers: true })
const query = value => { const q = { select: () => q, session: () => q, setOptions: () => q, lean: async () => value() }; return q }
let f, owner, args, qa, rows, audits, session, spies, save, log, artifactFind, deps, oldDatabase
beforeAll(() => { oldDatabase = Artifact.db.name; Artifact.db.name = 'ss044_1619d7db635949898c9abb4592d10bcf' })
afterAll(() => { Artifact.db.name = oldDatabase })
beforeEach(async () => {
  f = await masterLinkedCompletedReviewFixture(); rows = new Map(); audits = new Map(); spies = []
  const records = {}, request = f.args.expected, subject = f.transport.subject
  for (const phase of ['GRANT', 'RESERVATION', 'START_OR_REVOKE']) {
    const body = { phase, mode: G1_MODES.QA, actorUserId: f.actorUserId, scope: f.scope, subject, request,
      runtime: f.runtime, executionId: 'master_docx_dispatch_' + randomUUID(), ...(phase === 'START_OR_REVOKE' ? { decision: 'START_ALLOWED' } : {}) }
    records[phase] = { body, bodyFingerprint: membershipHash(body) }
  }
  qa = { mode: G1_MODES.QA, genuineReviewUsed: false, genuineAttemptConsumed: false, submissionState: 'KNOWN_RESPONSE', records }
  args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: f.record.candidateId,
    scopes: f.args.scopes, expected: request, qaGrantExecutionId: records.GRANT.body.executionId }
  session = { withTransaction: jest.fn(async fn => fn()), endSession: jest.fn(async () => {}) }
  spies.push(jest.spyOn(Artifact.db, 'openUri').mockRejectedValue(Error('DATABASE_FORBIDDEN')))
  spies.push(jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('PROVIDER_FORBIDDEN')))
  spies.push(jest.spyOn(Artifact.db, 'startSession').mockResolvedValue(session))
  spies.push(jest.spyOn(Artifact.collection, 'indexes').mockResolvedValue([{ name: 'runtimeArtifactId_1', key: { runtimeArtifactId: 1 }, unique: true }]))
  artifactFind = jest.spyOn(Artifact, 'findOne').mockImplementation(filter => query(() => rows.get(String(filter._id)) || null)); spies.push(artifactFind)
  spies.push(jest.spyOn(Audit, 'findOne').mockImplementation(filter => query(() => audits.get(String(filter._id))
    || Object.values(f.sources.audits).find(a => String(a._id) === String(filter._id)) || null)))
  for (const [Model, key] of [[Master, 'master'], [Candidate, 'candidate'], [Preview, 'preview'], [Plan, 'plan']])
    spies.push(jest.spyOn(Model, 'findOne').mockImplementation(() => query(() => f.sources[key])))
  save = jest.spyOn(Artifact.prototype, 'save').mockImplementation(async function () {
    await this.validate(); rows.set(String(this._id), clone(this.toObject())); return this
  }); spies.push(save)
  log = jest.spyOn(auditService, 'log').mockImplementation(async (data, options) => {
    expect(options).toEqual({ session, throwOnError: true }); const audit = new Audit(data); audit.generateSignature()
    const row = audit.toObject(); audits.set(String(row._id), row); return row
  }); spies.push(log)
  deps = { prepareTransport: async () => f.transport, readQa: async () => qa,
    readCandidate: async () => ({ candidate: { bodyFingerprint: f.record.bodyFingerprint, artifact: f.record.body.artifact }, buffer: Buffer.from(f.record.fileBytes) }),
    assertPlanIntegrity: () => {} }
  owner = createQaMasterLinkedTestRenditionPreflight(deps)
})
afterEach(() => { expect(spies[0]).not.toHaveBeenCalled(); expect(spies[1]).not.toHaveBeenCalled(); spies.reverse().forEach(s => s.mockRestore()) })

test('exact saved-byte preflight stays test-only and grants no final action', async () => {
  const result = await owner.prepare(args), d = result.descriptor
  expect(assertTestRenditionDescriptor(d)).toEqual(d)
  expect(d.docx).toEqual({ checksum: f.record.body.artifact.outputChecksum, byteLength: f.record.fileBytes.length })
  expect(d.subject).toEqual(f.transport.subject); expect(d.request).toEqual(f.args.expected)
  expect(d.genuineReview).toEqual({ state: 'GENUINE_REQUIRED', reference: null }); expect(d.approvalReference).toBeNull()
  for (const key of ['finalAssetCreated', 'approvalAvailable', 'finalisationAvailable', 'deliveryAvailable', 'docxExportAvailable', 'pdfExportAvailable']) expect(d[key]).toBe(false)
  expect(save).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
})
test('probe saves a signed exact copy, returns metadata only and replays without rewriting', async () => {
  const first = await owner.persist(args), stored = [...rows.values()][0]
  expect(assertTestRenditionProbeArtifact(stored)).toEqual(first.descriptor)
  expect(privateDocxBytes(stored.testRenditionFileBytes).equals(Buffer.from(f.record.fileBytes))).toBe(true)
  assertTestRenditionProbeAudit(stored, [...audits.values()][0], a => Audit.prototype.verifySignature.call(a))
  expect(await owner.read(args)).toEqual(expect.objectContaining({ descriptorFingerprint: first.descriptorFingerprint }))
  expect(await owner.persist(args)).toEqual({ ...first, idempotent: true })
  expect(log).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1); expect(session.endSession).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(first)).not.toContain('testRenditionFileBytes')
  expect(JSON.stringify(first)).not.toContain(Buffer.from(f.record.fileBytes).toString('base64'))
})
test.each(['caller-approval', 'actor', 'expected', 'qa-mode', 'qa-subject', 'qa-state', 'bytes', 'source-across-await', 'index'])(
  'refuses %s without a probe audit', async kind => {
    const input = { ...args }
    if (kind === 'caller-approval') input.approvalReference = 'caller says approved'
    if (kind === 'actor') input.actorUserId = '111111111111111111111111'
    if (kind === 'expected') input.expected = { ...args.expected, requestIdentity: 'f'.repeat(64) }
    if (kind === 'qa-mode') qa.mode = G1_MODES.GENUINE
    if (kind === 'qa-subject') { qa.records.RESERVATION.body = { ...qa.records.RESERVATION.body, actorUserId: '111111111111111111111111' } }
    if (kind === 'qa-state') qa.submissionState = 'UNRESOLVED'
    if (kind === 'bytes') deps.readCandidate = async () => ({ candidate: { bodyFingerprint: f.record.bodyFingerprint, artifact: f.record.body.artifact }, buffer: Buffer.from('changed') })
    if (kind === 'source-across-await') deps.readCandidate = async () => {
      const buffer = Buffer.from(f.record.fileBytes); f.sources.candidate.fileBytes = Buffer.from('changed after preparation')
      return { candidate: { bodyFingerprint: f.record.bodyFingerprint, artifact: f.record.body.artifact }, buffer }
    }
    if (kind === 'index') Artifact.collection.indexes.mockResolvedValue([])
    const reasons = { 'caller-approval': 'PREFLIGHT_INPUT', actor: 'PREFLIGHT_SUBJECT_CHANGED', expected: 'PREFLIGHT_SUBJECT_CHANGED',
      'qa-mode': 'QA_PARENT_NOT_COMPLETE', 'qa-subject': 'QA_PARENT_CHANGED', 'qa-state': 'QA_PARENT_NOT_COMPLETE',
      bytes: 'SOURCE_BYTES_CHANGED', 'source-across-await': 'STORED_FILE_CHANGED', index: 'PROBE_INDEX_REQUIRED' }
    await expect(createQaMasterLinkedTestRenditionPreflight(deps).persist(input)).rejects.toMatchObject({ details: { reason: reasons[kind] } })
    expect(log).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  })
test.each(['audit', 'artifact'])('propagates %s failure and closes the unit session; real rollback remains separate', async kind => {
  if (kind === 'audit') log.mockRejectedValue(Error('AUDIT_OFFLINE'))
  else save.mockRejectedValue(Error('ARTIFACT_OFFLINE'))
  await expect(owner.persist(args)).rejects.toThrow(kind === 'audit' ? 'AUDIT_OFFLINE' : 'ARTIFACT_OFFLINE')
  expect(session.endSession).toHaveBeenCalledTimes(1)
})
test.each(['approval', 'finalisationAvailable', 'deliveryAvailable', 'docxExportAvailable', 'pdfExportAvailable', 'classification', 'fake-review'])(
  'descriptor rejects altered authority %s', async field => {
    const d = (await owner.prepare(args)).descriptor
    if (field === 'approval') d.approvalReference = { approved: true }
    else if (field === 'classification') d.classification = 'CUSTOMER_APPROVED'
    else if (field === 'fake-review') d.genuineReview = { state: 'GENUINE_PASS_APPROVAL_REQUIRED', reference: { kind: 'NETWORK_QA' } }
    else d[field] = true
    expect(() => assertTestRenditionDescriptor(d)).toThrow()
  })
test.each(['PASS', 'FAIL'])('even a typed genuine %s descriptor cannot enable final delivery without separate approval', async status => {
  const d = (await owner.prepare(args)).descriptor
  d.genuineReview = { state: status === 'PASS' ? 'GENUINE_PASS_APPROVAL_REQUIRED' : 'GENUINE_FAIL_HELD', reference: {
    kind: 'GENUINE_MASTER_LINKED_REVIEW', executionId: 'result_reference', runtimeArtifactId: 'artifact_reference', stageExecutionId: 'stage_reference', resultFingerprint: 'a'.repeat(64) } }
  expect(assertTestRenditionDescriptor(d).finalisationAvailable).toBe(false)
  expect(assertTestRenditionDescriptor(d).docxExportAvailable).toBe(false)
})
test('default preflight rejects dependency overrides and QA probe rejects a genuine reference', async () => {
  expect(() => createMasterLinkedTestRenditionPreflight({})).toThrow()
  await expect(owner.persist({ ...args, reviewGrantExecutionId: args.qaGrantExecutionId })).rejects.toMatchObject({ details: { reason: 'PROBE_IS_PREFLIGHT_ONLY' } })
  expect(log).not.toHaveBeenCalled()
})
test('optional genuine reference must be read by the genuine owner; QA material cannot masquerade as a pass', async () => {
  const readGenuine = jest.fn().mockResolvedValue({ mode: G1_MODES.QA, completionConfirmed: true, genuineReviewUsed: false, reviewStatus: 'PASS' })
  await expect(createQaMasterLinkedTestRenditionPreflight({ ...deps, readGenuine }).prepare({ ...args, reviewGrantExecutionId: args.qaGrantExecutionId })).rejects.toMatchObject({ details: { reason: 'GENUINE_REVIEW_REQUIRED' } })
  expect(readGenuine).toHaveBeenCalledWith({ actorUserId: args.actorUserId, scopes: args.scopes, grantExecutionId: args.qaGrantExecutionId })
})
test('private field is hidden by real ODM default projection and JSON, available only by explicit selection', async () => {
  await owner.persist(args); const stored = [...rows.values()][0]
  expect(Artifact.schema.path('testRenditionFileBytes').options.select).toBe(false)
  expect(new Artifact({}).testRenditionFileBytes).toBeUndefined()
  expect(new Artifact(stored).toJSON()).not.toHaveProperty('testRenditionFileBytes')
  artifactFind.mockRestore()
  const projections = [], driverRead = jest.spyOn(Artifact.collection, 'findOne').mockImplementation(async (_filter, options) => {
    const result = clone(stored); projections.push(options.projection)
    if (options.projection?.testRenditionFileBytes === 0) delete result.testRenditionFileBytes
    return result
  })
  try {
    expect(await Artifact.findOne({ _id: stored._id }).lean()).not.toHaveProperty('testRenditionFileBytes')
    const selected = await Artifact.findOne({ _id: stored._id }).select('+testRenditionFileBytes').lean()
    expect(privateDocxBytes(selected.testRenditionFileBytes).equals(Buffer.from(f.record.fileBytes))).toBe(true)
    expect(projections[0].testRenditionFileBytes).toBe(0)
  } finally { driverRead.mockRestore() }
})
test('non-probe records cannot acquire the private field', async () => {
  const row = new Artifact({ ...f.scope, runtimeArtifactId: 'ordinary', executionId: 'ordinary', frameworkKey: 'VMF',
    outputTypeKey: 'NORMAL', generatedBy: f.actorUserId, testRenditionFileBytes: Buffer.from('private') })
  await expect(row.validate()).rejects.toThrow()
})
test.each(['bytes', 'descriptor', 'audit', 'scope'])('probe read refuses changed %s', async kind => {
  await owner.persist(args); const stored = [...rows.values()][0]
  if (kind === 'bytes') stored.testRenditionFileBytes = Buffer.from('changed')
  if (kind === 'descriptor') stored.generatedOutput.descriptor.pdfExportAvailable = true
  if (kind === 'scope') stored.customerId = new mongoose.Types.ObjectId()
  if (kind === 'audit') [...audits.values()][0].diff.docx.byteLength++
  await expect(owner.read(args)).rejects.toThrow()
})
test('actual ODM mutation hooks protect probe rows, stripped markers and private-field injection', async () => {
  await owner.persist(args); const stored = [...rows.values()][0], writes = []
  save.mockRestore()
  const exists = jest.spyOn(Artifact, 'exists').mockImplementation(() => { const q = Promise.resolve({ _id: stored._id }); q.session = () => q; return q })
  for (const method of ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite'])
    writes.push(jest.spyOn(Artifact.collection, method).mockResolvedValue({ acknowledged: true }))
  try {
    const attempts = [() => Artifact.hydrate(stored).save({ validateBeforeSave: false }), () => Artifact.hydrate(stored).deleteOne(),
      () => Artifact.insertMany([clone(stored)], { lean: true }), () => Artifact.bulkWrite([{ insertOne: { document: clone(stored) } }], { skipValidation: true }),
      ...['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'].map(method => () => Artifact[method]({ _id: stored._id }, { $set: { warnings: [] } })),
      ...['deleteOne', 'deleteMany', 'findOneAndDelete'].map(method => () => Artifact[method]({ _id: stored._id })),
      () => Artifact.updateOne({}, { $set: { testRenditionFileBytes: Buffer.from('inject') } }, { upsert: true }),
      () => Artifact.updateOne({}, [{ $unset: ['testRenditionFileBytes', 'lineageSummary'] }])]
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow()
    expect(writes.every(spy => spy.mock.calls.length === 0)).toBe(true)
  } finally { exists.mockRestore(); writes.forEach(spy => spy.mockRestore()) }
})
test('probe audit uses a deterministic internal artifact identity and no final asset identity', async () => {
  const d = (await owner.prepare(args)).descriptor, family = testRenditionProbeFamily(d)
  await owner.persist(args)
  expect([...rows.values()][0]).toMatchObject({ artifactType: TEST_RENDITION_PROBE_TYPE, runtimeArtifactId: family.runtimeArtifactId })
  expect([...audits.values()][0]).toMatchObject({ action: TEST_RENDITION_PROBE_ACTION, resourceType: 'GovernedRuntimeArtifact' })
  expect([...rows.values()][0]).not.toHaveProperty('outcomeAssetId')
})
