import { jest } from '@jest/globals'
import fs from 'node:fs'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import auditService from '../services/auditService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { G1_FIXED, G1_MODES, G1_QA_RELEASE, G1_CORRECTED_QA_RELEASE, assertG1CorrectedQaSubject,
  assertG1FixedSubject, assertG1Approval, assertG1QaRelease, assertG1Record, hasG1Identity, g1Root, g1SubjectRoot } from '../services/masterLinkedGenuineReviewContract.js'
import { assertMasterLinkedPreparedSubject } from '../services/masterLinkedReviewSimulationContract.js'

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
const copy = v => JSON.parse(JSON.stringify(v)), database = 'ss044_1619d7db635949898c9abb4592d10bcf'
const operator = { realm: 'native-application-test.v1', operatorUserId: '698b3800f83b3257365fd7a3', fingerprint: 'a'.repeat(64) }
const auth = jest.fn(), nativeOperator = jest.fn(), prepare = jest.fn(), permissions = jest.fn(), permission = jest.fn(), runtimeRead = jest.fn()
const need = (ok, reason) => { if (!ok) throw Object.assign(Error('HELD'), { details: { reason } }) }
jest.unstable_mockModule('../services/masterLinkedReviewOperatorAuthority.js', () => ({ authenticateMasterReviewNativeOperator: auth,
  readMasterReviewNativeOperator: nativeOperator, MASTER_REVIEW_DATABASE: database, releaseNeed: need }))
jest.unstable_mockModule('../services/outcomeMasterLinkedDocxReviewTransportService.js', () => ({ prepareMasterLinkedDocxReviewTransport: prepare,
  prepareApprovedMasterLinkedDocxReviewTransport: () => { throw Error('APPROVED_PROFILE_NOT_IN_LEGACY_TEST') } }))
// Only source loading/serialization are unit seams. All fixed subject, signed
// release, execution model and one-use validators below are the real owners.
jest.unstable_mockModule('../services/openAiMasterLinkedDocxReviewRequest.js', () => ({ buildOpenAiMasterLinkedDocxReviewRequest: t => ({
  binding: copy(t.request), serialized: '{"unitOnly":true}', pageReceipts: copy(t.subject.binding.pages),
  inputFingerprint: t.subject.binding.inputFingerprint, docxChecksum: t.subject.binding.docxChecksum }) }))
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({ buildUserPermissionsSnapshot: permissions }))
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ assertRuntimePermission: permission, getRuntimeInstance: runtimeRead }))
const { issueCorrectedNetworkQaMasterLinkedReviewRelease, issueMasterLinkedReviewRelease } = await import('../services/masterLinkedReviewReleaseService.js')
const { createNetworkQaMasterLinkedReviewAuthority, createGenuineMasterLinkedReviewAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createFakeNetworkMasterLinkedDocxReviewProviderAdapter, snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const scope = fixture.subject.binding.masterReference.scope, qaCase = 'ss055-release-proof-corrected-unit'
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NEVER_REAL', expected: copy(fixture.request), qaCase, approvalReference: 'Fake-network unit proof only' })
let rows, audits, subject, session, oldName, liveConnect, liveFetch, log
const matches = (row, filter) => Object.entries(filter).every(([k, v]) => v && typeof v === 'object' && '$in' in v
  ? v.$in.includes(row[k]) : v && typeof v === 'object' && '$ne' in v ? String(row[k]) !== String(v.$ne) : String(row[k]) === String(v))
const query = value => { const q = { maxTimeMS: () => q, setOptions: () => q, session: () => q, lean: async () => value() }; return q }
beforeAll(() => {
  oldName = Audit.db.name; Audit.db.name = database
  liveConnect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockRejectedValue(Error('LIVE_DATABASE_FORBIDDEN'))
  liveFetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('LIVE_HTTP_FORBIDDEN'))
  jest.spyOn(User, 'findById').mockImplementation(() => query(() => ({ _id: G1_FIXED.actorUserId, isActive: true })))
  jest.spyOn(User, 'findOne').mockImplementation(() => query(() => ({ _id: G1_FIXED.actorUserId, isActive: true })))
  jest.spyOn(Audit, 'findById').mockImplementation(id => query(() => audits.find(r => String(r._id) === String(id))))
  jest.spyOn(Audit, 'findOne').mockImplementation(filter => query(() => audits.find(r => matches(r, filter))))
  jest.spyOn(Execution, 'findOne').mockImplementation(filter => query(() => rows.find(r => matches(r, filter))))
  jest.spyOn(Execution, 'create').mockImplementation(async values => { for (const row of values) { await new Execution(row).validate(); rows.push(row) } return values })
  jest.spyOn(Execution.collection, 'indexes').mockResolvedValue([{ name: 'runtimeInstanceId_1_idempotencyKey_1', key: { runtimeInstanceId: 1, idempotencyKey: 1 },
    unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } }])
  jest.spyOn(Audit.collection, 'indexes').mockResolvedValue([{ name: '_id_', key: { _id: 1 } }])
  jest.spyOn(Audit.db, 'startSession').mockImplementation(async () => session)
  log = jest.spyOn(auditService, 'log')
})
beforeEach(() => {
  rows = []; audits = []; subject = copy(fixture.subject)
  // A rollback-capable in-memory seam, never real transaction/concurrency proof.
  session = { endSession: jest.fn(async () => {}), withTransaction: jest.fn(async fn => {
    const oldRows = [...rows], oldAudits = [...audits]
    try { return await fn() } catch (e) { rows.splice(0, rows.length, ...oldRows); audits.splice(0, audits.length, ...oldAudits); throw e }
  }) }
  auth.mockReset().mockResolvedValue(copy(operator)); nativeOperator.mockReset().mockResolvedValue(copy(operator))
  permissions.mockReset().mockResolvedValue({}); permission.mockReset().mockResolvedValue(undefined)
  runtimeRead.mockReset().mockResolvedValue({ id: scope.runtimeInstanceId, ...scope, status: 'LOCKED', runtimeInstanceKey: 'unit-corrected', runtimeType: 'VMF', frameworkKey: 'VMF' })
  prepare.mockReset().mockImplementation(async () => ({ subject: copy(subject), request: copy(fixture.request), sourceEnvelope: { source: { plan: { planId: 'unit-corrected-plan' } } } }))
  log.mockReset().mockImplementation(async data => { const audit = new Audit(data); audit.generateSignature(); const row = audit.toObject(); audits.push(row); return row })
})
afterAll(() => { expect(liveConnect).not.toHaveBeenCalled(); expect(liveFetch).not.toHaveBeenCalled(); Audit.db.name = oldName; jest.restoreAllMocks() })
const args = release => ({ actorUserId: subject.actorUserId, runtimeInstanceId: scope.runtimeInstanceId, candidateId: subject.binding.candidateId,
  scopes: {}, qaCase, expected: copy(fixture.request), ...(release ? { qaReleaseAuditId: release.approvalAuditId } : {}) })
const lookup = grant => ({ actorUserId: subject.actorUserId, scopes: {}, grantExecutionId: grant.grant.body.executionId })
const fakeResponse = (failed = false) => new Response(JSON.stringify({ id: 'resp_corrected_unit', status: 'completed', model: 'gpt-5.2',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput(failed)) }] }] }), { headers: { 'x-request-id': 'req_corrected_unit' } })
const adapter = fetchImpl => createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl, sleep: async () => {} })

test('exact retained metadata has its proven hash, separate roots and no legacy authority', () => {
  assertG1CorrectedQaSubject(subject, fixture.request)
  expect(membershipHash(subject)).toBe(fixture.request.subjectFingerprint)
  const root = g1SubjectRoot(subject, fixture.request, G1_MODES.QA, qaCase)
  expect(root).toMatch(/^SS055_CORRECTED_NETWORK_QA_DOCX:/)
  expect(root).not.toBe(g1Root(scope, G1_MODES.QA, qaCase)); expect(root).not.toBe(g1Root(scope, G1_MODES.GENUINE))
  expect(hasG1Identity({ idempotencyKey: root })).toBe(true)
  expect(() => assertG1FixedSubject(subject, fixture.request)).toThrow()
  expect(() => assertMasterLinkedPreparedSubject(subject, fixture.request, scope, subject.actorUserId)).toThrow()
  expect(g1SubjectRoot(subject, fixture.request, G1_MODES.GENUINE)).toMatch(/^SS055_CORRECTED_GENUINE_DOCX:/)
  expect(g1SubjectRoot(subject, fixture.request, G1_MODES.GENUINE)).not.toBe(root)
})
test.each(['candidate', 'actor', 'scope', 'master', 'predecessor', 'page', 'pack', 'flag', 'version', 'policy', ...Object.keys(fixture.request)])(
  'frozen corrected predicate rejects %s', kind => {
    const request = copy(fixture.request)
    if (kind === 'candidate') subject.binding.candidateId = G1_FIXED.candidateId
    if (kind === 'actor') subject.actorUserId = 'f'.repeat(24)
    if (kind === 'scope') subject.binding.masterReference.scope.tenantId = 'f'.repeat(24)
    if (kind === 'master') subject.binding.masterReference.masterId += '-other'
    if (kind === 'predecessor') subject.binding.correctionReference.predecessor.failedReviewResultFingerprint = 'f'.repeat(64)
    if (kind === 'page') subject.binding.pages[0].sha256 = 'f'.repeat(64)
    if (kind === 'pack') subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
    if (kind === 'flag') subject.authoritative = true
    if (kind === 'version') subject.contractVersion = 'master-linked-docx-review-subject.v2'
    if (kind === 'policy') subject.policy.dispatchAvailable = true
    if (Object.hasOwn(request, kind)) request[kind] = 'f'.repeat(64)
    expect(() => assertG1CorrectedQaSubject(subject, request)).toThrow()
  })
test.each(['top-undefined', 'nested-undefined', 'request-undefined', 'bson-scope', 'accessor', 'sparse-array', 'housekeeping'])(
  'exact literal snapshot refuses %s even when canonicalization could conceal it', kind => {
    const request = copy(fixture.request)
    if (kind === 'top-undefined') subject.extra = undefined
    if (kind === 'nested-undefined') subject.binding.correctionReference.extra = undefined
    if (kind === 'request-undefined') request.extra = undefined
    if (kind === 'bson-scope') subject.binding.masterReference.scope.tenantId = new mongoose.Types.ObjectId(scope.tenantId)
    if (kind === 'accessor') Object.defineProperty(subject, 'extra', { enumerable: true, get: () => { throw Error('ACCESSOR_MUST_NOT_RUN') } })
    if (kind === 'sparse-array') delete subject.binding.pages[0]
    if (kind === 'housekeeping') subject.binding.current = true
    expect(() => assertG1CorrectedQaSubject(subject, request)).toThrow()
  })
test('issuer signs the exact corrected QA release and replays without renewal', async () => {
  const first = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), stored = audits[0]
  expect(first).toMatchObject({ mode: G1_MODES.QA, genuineReviewEligible: false, dispatchAvailable: false })
  expect(stored.diff.version).toBe(G1_CORRECTED_QA_RELEASE.version)
  expect(prepare.mock.calls[0][0].candidateId).toBe(G1_CORRECTED_QA_RELEASE.candidateId)
  assertG1QaRelease(stored, subject, fixture.request, a => Audit.prototype.verifySignature.call(a), Date.now(), qaCase)
  expect(() => assertG1Approval(stored, subject, fixture.request, () => true, Date.now())).toThrow()
  expect(await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs())).toEqual(first)
  expect(audits).toHaveLength(1); expect(auth).toHaveBeenCalledTimes(4)
})
test.each(['old-version', 'wrong-case', 'signature', 'expired', 'operator', 'expected', 'source'])('release rejects %s without execution writes', async kind => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), audit = audits[0]
  if (kind === 'old-version') audit.diff.version = G1_QA_RELEASE.version
  if (kind === 'wrong-case') audit.diff.qaCase += '-other'
  if (kind === 'signature') audit.diff.approvalReference = 'unsigned change'
  if (kind === 'expired') { audit.diff.issuedAt = new Date(Date.now() - 3600000).toISOString(); audit.diff.expiresAt = new Date(Date.now() - 1800000).toISOString() }
  if (['old-version', 'wrong-case', 'expired'].includes(kind)) { const resealed = new Audit(audit); resealed.generateSignature(); audits[0] = resealed.toObject() }
  if (kind === 'operator') nativeOperator.mockResolvedValue({ ...operator, fingerprint: 'b'.repeat(64) })
  if (kind === 'expected') subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'source') prepare.mockRejectedValue(Error('SOURCE_REFUSED'))
  await expect(createNetworkQaMasterLinkedReviewAuthority().prepare(args(release))).rejects.toThrow()
  expect(rows).toHaveLength(0); expect(audits).toHaveLength(1)
})
test('corrected preparation needs signed authority and genuine refuses an absent release without writes', async () => {
  await expect(createNetworkQaMasterLinkedReviewAuthority().prepare(args())).rejects.toMatchObject({ details: { reason: 'CORRECTED_QA_RELEASE_REQUIRED' } })
  prepare.mockClear()
  await expect(createGenuineMasterLinkedReviewAuthority().prepare({ ...args(), approvalAuditId: 'a'.repeat(24) })).rejects.toMatchObject({ details: { reason: 'OPERATOR_RELEASE_INVALID' } })
  expect(prepare).toHaveBeenCalledTimes(1); expect(rows).toHaveLength(0); expect(audits).toHaveLength(0)
  await expect(issueMasterLinkedReviewRelease({ ...releaseArgs(), candidateId: subject.binding.candidateId })).rejects.toThrow()
  expect(auth).not.toHaveBeenCalled()
})
test.each([false, true])('signed corrected QA executes once and preserves a fake quality failure=%s', async failed => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), owner = createNetworkQaMasterLinkedReviewAuthority()
  const grant = await owner.prepare(args(release)), fetchImpl = jest.fn(async () => fakeResponse(failed))
  const result = snapshotOwnedMasterLinkedReviewResult(await adapter(fetchImpl)(grant.capability))
  expect(result.output.overallStatus).toBe(failed ? 'FAIL' : 'PASS'); expect(result.genuineProviderEligible).toBe(false)
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer SS055_FAKE_NETWORK_ONLY')
  expect(rows).toHaveLength(3); expect(audits).toHaveLength(5)
  for (const row of rows) { assertG1Record(row); await new Execution(row).validate() }
  const state = await owner.read(lookup(grant)); expect(state.genuineReviewUsed).toBe(false); expect(state.submissionState).toBe('KNOWN_RESPONSE')
  expect((await owner.prepare(args(release))).state).toBe('REPLAY_HELD')
  await expect(adapter(fetchImpl)(grant.capability)).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test('expired signed correction can only recover a known response through fake GET', async () => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), owner = createNetworkQaMasterLinkedReviewAuthority()
  const grant = await owner.prepare(args(release)), fetchImpl = jest.fn(async () => fakeResponse())
  await adapter(fetchImpl)(grant.capability)
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(grant.grant.body.expiresAt) + 1)
  try {
    const recovery = await owner.recover(lookup(grant)); await adapter(fetchImpl)(recovery.capability)
    expect(fetchImpl.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET'])
    await expect(adapter(fetchImpl)(recovery.capability)).rejects.toThrow()
    await expect(owner.prepare(args(release))).rejects.toThrow(); expect(rows).toHaveLength(3)
  } finally { clock.mockRestore() }
})
test('simultaneous uses of one capability produce only one fake POST', async () => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), owner = createNetworkQaMasterLinkedReviewAuthority()
  const grant = await owner.prepare(args(release)), fetchImpl = jest.fn(async () => fakeResponse())
  const attempts = await Promise.allSettled([adapter(fetchImpl)(grant.capability), adapter(fetchImpl)(grant.capability)])
  expect(attempts.filter(v => v.status === 'fulfilled')).toHaveLength(1)
  expect(attempts.filter(v => v.status === 'rejected')).toHaveLength(1)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test.each(['permission', 'operator', 'source', 'revoke'])('change at start: %s prevents fake POST and replay', async kind => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), owner = createNetworkQaMasterLinkedReviewAuthority()
  const grant = await owner.prepare(args(release)), fetchImpl = jest.fn()
  if (kind === 'permission') permission.mockRejectedValue(Error('DENIED'))
  if (kind === 'operator') nativeOperator.mockResolvedValue({ ...operator, fingerprint: 'b'.repeat(64) })
  if (kind === 'source') subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'revoke') await owner.revoke(lookup(grant))
  await expect(adapter(fetchImpl)(grant.capability)).rejects.toThrow(); await expect(adapter(fetchImpl)(grant.capability)).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled()
})
test.each(['unsigned-kind', 'old-kind', 'mode', 'root', 'subject', 'audit-failed'])('model/atomic seam refuses %s', async kind => {
  const release = await issueCorrectedNetworkQaMasterLinkedReviewRelease(releaseArgs()), owner = createNetworkQaMasterLinkedReviewAuthority()
  if (kind === 'audit-failed') {
    log.mockRejectedValue(Error('AUDIT_FAILED')); await expect(owner.prepare(args(release))).rejects.toThrow(); expect(rows).toHaveLength(0); expect(audits).toHaveLength(1); return
  }
  await owner.prepare(args(release)); const row = copy(rows[0]), body = row.executionEvidence.masterDocxDispatch.body
  if (kind === 'unsigned-kind') body.approval = null
  if (kind === 'old-kind') body.approval.kind = G1_QA_RELEASE.kind
  if (kind === 'mode') body.mode = G1_MODES.GENUINE
  if (kind === 'root') body.onceRoot = g1Root(scope, G1_MODES.QA, qaCase)
  if (kind === 'subject') body.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  row.executionEvidence.masterDocxDispatch.bodyFingerprint = membershipHash(body)
  await expect(new Execution(row).validate()).rejects.toThrow()
})
describe('persisted reserved-prefix model filters, without database writes', () => {
  const reserved = (value, root) => value && typeof value === 'object' && (value.idempotencyKey instanceof RegExp
    ? value.idempotencyKey.test(root) : Object.values(value).some(v => reserved(v, root)))
  const guarded = async (stored, callback) => {
    const root = g1SubjectRoot(subject, fixture.request, G1_MODES.QA, qaCase), writes = {}
    for (const name of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) {
      writes[name] = jest.spyOn(Execution.collection, name).mockResolvedValue({ acknowledged: true, matchedCount: 0, deletedCount: 0 })
    }
    const exists = jest.spyOn(Execution, 'exists').mockImplementation(filter => {
      const q = Promise.resolve(stored && reserved(filter, root) ? { _id: new mongoose.Types.ObjectId() } : null); q.session = () => q; return q
    })
    try { await callback({ root, writes, exists }) } finally { exists.mockRestore(); Object.values(writes).forEach(spy => spy.mockRestore()) }
  }
  test.each(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])(
    '%s protects a stored root-only marker through the actual query hook', async operation => {
      await guarded(true, async ({ root, writes, exists }) => {
        const filter = { _id: new mongoose.Types.ObjectId() }, update = operation.includes('Replace') || operation === 'replaceOne'
          ? { warnings: ['changed'] } : { $set: { warnings: ['changed'] } }
        await expect(Execution[operation](filter, update)).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } })
        expect(reserved(exists.mock.calls[0][0], root)).toBe(true)
        expect(Object.values(writes).every(spy => spy.mock.calls.length === 0)).toBe(true)
      })
    })
  test('query writes exclude the new and both historical prefixes atomically after an empty precheck', async () => {
    await guarded(false, async ({ root, writes }) => {
      await Execution.updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { warnings: [] } })
      const exclusion = writes.updateOne.mock.calls[0][0].$and[1].$nor
      for (const value of [root, g1Root(scope, G1_MODES.QA, qaCase), g1Root(scope, G1_MODES.GENUINE)]) expect(reserved(exclusion, value)).toBe(true)
    })
  })
  test('bulk mutation uses the same stored precheck and atomic exclusion', async () => {
    for (const stored of [true, false]) await guarded(stored, async ({ root, writes }) => {
      const call = Execution.bulkWrite([{ deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } }])
      if (stored) { await expect(call).rejects.toMatchObject({ details: { reason: 'CLAIM_IMMUTABLE' } }); expect(writes.bulkWrite).not.toHaveBeenCalled() }
      else { await call; expect(reserved(writes.bulkWrite.mock.calls[0][0][0].deleteOne.filter.$and[1].$nor, root)).toBe(true) }
    })
  })
})
