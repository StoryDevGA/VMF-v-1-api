import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { G1_FIXED, G1_MODES, G1_CORRECTED_GENUINE_RELEASE, g1SubjectRoot, g1Root, assertG1Approval, assertG1QaRelease, assertG1Record, hasG1Identity } from '../services/masterLinkedGenuineReviewContract.js'
import { completedReviewFamily, hasCompletedStageIdentity } from '../services/masterLinkedCompletedReviewContract.js'
import { originalOutcomeQualityStageFilter, CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY } from '../utils/outcomeQualityStageSubjects.js'
import { correctedGenuineSeams as seams, installCorrectedGenuineModelSeams } from './fixtures/correctedGenuineReviewFixture.js'

// Capture the fake fetch BEFORE the native adapter's first import. Both its
// genuine factory and genuine authority remain the real zero-override owners.
const originalFetch = globalThis.fetch
const originalProviderKey = process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
globalThis.fetch = seams.fetch
const network = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
for (const trap of network) trap.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') })
process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = 'SS055_HERMETIC_ONLY_NO_PROVIDER'
const { issueCorrectedMasterLinkedReviewRelease, issueCorrectedNetworkQaMasterLinkedReviewRelease, issueMasterLinkedReviewRelease } = await import('../services/masterLinkedReviewReleaseService.js')
const { createGenuineMasterLinkedReviewAuthority, createNetworkQaMasterLinkedReviewAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createOpenAiMasterLinkedDocxReviewProviderAdapter, createFakeNetworkMasterLinkedDocxReviewProviderAdapter, snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createGenuineMasterLinkedCompletedReviewStore } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeCorrectedMasterLinkedReview } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const models = installCorrectedGenuineModelSeams(), copy = v => JSON.parse(JSON.stringify(v))
let f
beforeEach(() => { f = models.reset() })
afterAll(() => {
  for (const trap of network) expect(trap).not.toHaveBeenCalled()
  models.restoreName(); jest.restoreAllMocks(); globalThis.fetch = originalFetch
  if (originalProviderKey === undefined) delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
  else process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = originalProviderKey
})
const releaseArgs = () => ({ authorization: 'Bearer HERMETIC_NO_NATIVE_TOKEN', approvalReference: 'UNIT ONLY. No genuine release or provider execution.', expected: copy(f.request) })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: G1_FIXED.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(f.request), approvalAuditId: release.approvalAuditId })
const lookup = prepared => ({ actorUserId: f.subject.actorUserId, scopes: {}, grantExecutionId: prepared.grant.body.executionId })
const sign = row => { const doc = new Audit(row); doc.generateSignature(); return doc.toObject() }
const releaseRow = release => f.Audit.find(a => String(a._id) === release.approvalAuditId)

test('corrected genuine release is separately signed and cannot release QA or the original root', async () => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), row = releaseRow(released), scope = f.subject.binding.masterReference.scope
  const diff = assertG1Approval(row, f.subject, f.request, a => Audit.prototype.verifySignature.call(a), Date.now())
  expect(diff.version).toBe(G1_CORRECTED_GENUINE_RELEASE.version); expect(diff.operatorAuthority.realm).toBe('native-application-test.v1')
  expect(diff.onceRoot).toMatch(/^SS055_CORRECTED_GENUINE_DOCX:/); expect(diff.onceRoot).not.toBe(g1Root(scope, G1_MODES.GENUINE))
  expect(() => assertG1QaRelease(row, f.subject, f.request, () => true, Date.now(), 'ss055-release-proof-unit')).toThrow()
  expect(seams.auth).toHaveBeenCalledTimes(2); expect(released.dispatchAvailable).toBe(false); expect(seams.fetch).not.toHaveBeenCalled()
})
test('same release is idempotent but cannot renew expiry or change its approval reference', async () => {
  const a = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), count = f.Audit.length
  expect((await issueCorrectedMasterLinkedReviewRelease(releaseArgs())).approvalAuditId).toBe(a.approvalAuditId); expect(f.Audit).toHaveLength(count)
  await expect(issueCorrectedMasterLinkedReviewRelease({ ...releaseArgs(), approvalReference: 'A different release' })).rejects.toThrow()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(a.expiresAt) + 1)
  try { await expect(issueCorrectedMasterLinkedReviewRelease(releaseArgs())).rejects.toThrow(); expect(f.Audit).toHaveLength(count) } finally { clock.mockRestore() }
})
test.each(['auth', 'operator-after-preparation', 'request', 'source', 'scope', 'page', 'pack', 'predecessor', 'policy'])('issuer holds changed %s before a release write', async kind => {
  if (kind === 'auth') seams.auth.mockRejectedValueOnce(Error('UNAUTHORISED'))
  if (kind === 'operator-after-preparation') seams.auth.mockResolvedValueOnce(copy(f.native)).mockResolvedValueOnce({ ...f.native, fingerprint: 'b'.repeat(64) })
  const input = releaseArgs()
  if (kind === 'request') input.expected.requestIdentity = 'f'.repeat(64)
  if (kind === 'source') f.subject.binding.candidateId = G1_FIXED.candidateId
  if (kind === 'scope') f.subject.binding.masterReference.scope.tenantId = 'f'.repeat(24)
  if (kind === 'page') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'predecessor') f.subject.binding.correctionReference.predecessor.failedReviewResultFingerprint = 'f'.repeat(64)
  if (kind === 'policy') f.subject.policy.dispatchAvailable = true
  await expect(issueCorrectedMasterLinkedReviewRelease(input)).rejects.toThrow(); expect(f.Audit).toHaveLength(3); expect(seams.fetch).not.toHaveBeenCalled()
})
test.each([false, true])('default corrected genuine protocol stores fake-network quality FAIL=%s once and stops', async failed => {
  f.failed = failed; const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), input = args(released)
  const saved = await executeCorrectedMasterLinkedReview(input)
  expect(saved).toMatchObject({ completionConfirmed: true, mode: G1_MODES.GENUINE, reviewStatus: failed ? 'FAIL' : 'PASS', approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(seams.fetch).toHaveBeenCalledTimes(1); expect(seams.fetch.mock.calls[0][1].method).toBe('POST')
  expect(seams.fetch.mock.calls[0][1].body).toBe('{"hermeticCorrectedProtocolOnly":true}')
  expect(f.Execution).toHaveLength(4); expect(f.Artifact).toHaveLength(1); expect(f.Stage).toHaveLength(1)
  for (const row of f.Execution.filter(r => r.executionEvidence.masterDocxDispatch)) { assertG1Record(row); expect(row.providerMode).toBe('LIVE_TEST') }
  expect(f.Stage[0].stageKey).toBe(CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY); expect(f.Stage[0].status).toBe(failed ? 'FAILED' : 'SUCCEEDED')
  if (failed) expect(f.Stage[0].failure.retryable).toBe(false)
  const counts = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await executeCorrectedMasterLinkedReview(input)).executionId).toBe(saved.executionId)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(counts); expect(seams.fetch).toHaveBeenCalledTimes(1)
})
test.each(['missing', 'QA', 'original-version', 'signature', 'native-realm', 'scope', 'expiry', 'request'])('execution rejects %s permission with no POST', async kind => {
  let released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), row = releaseRow(released)
  if (kind === 'QA') released = await issueCorrectedNetworkQaMasterLinkedReviewRelease({ ...releaseArgs(), qaCase: 'ss055-release-proof-gen-hermetic' })
  if (kind === 'missing') f.Audit.splice(f.Audit.indexOf(row), 1)
  if (kind === 'signature') row.diff.approvalReference += '-tampered'
  if (kind === 'original-version') { row.diff.version = 'ss055-genuine-release-approval.v2'; row.action = 'MASTER_GENUINE_REVIEW_RELEASE_APPROVED' }
  if (kind === 'native-realm') row.diff.operatorAuthority.realm = 'isolated-test'
  if (kind === 'scope') row.diff.scope.tenantId = 'f'.repeat(24)
  if (kind === 'request') row.diff.requestBinding.policyFingerprint = 'f'.repeat(64)
  if (['original-version', 'native-realm', 'scope', 'request'].includes(kind)) Object.assign(row, sign(row))
  const clock = kind === 'expiry' ? jest.spyOn(Date, 'now').mockReturnValue(Date.parse(released.expiresAt) + 1) : null
  try { await expect(executeCorrectedMasterLinkedReview(args(released))).rejects.toThrow(); expect(seams.fetch).not.toHaveBeenCalled(); expect(f.Execution).toHaveLength(0) } finally { clock?.mockRestore() }
})
test('missing completed-store indexes hold before source preparation or grant allocation', async () => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), preparations = seams.prepare.mock.calls.length
  f.missingIndex = 'Stage'
  await expect(executeCorrectedMasterLinkedReview(args(released))).rejects.toMatchObject({ details: { reason: 'COMPLETION_INDEX_UNAVAILABLE' } })
  expect(seams.prepare).toHaveBeenCalledTimes(preparations); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})
test.each(['reject', 'hang'])('index preflight %s is bounded and never reaches preparation', async kind => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), preparations = seams.prepare.mock.calls.length
  f.indexFault = kind
  if (kind === 'hang') jest.useFakeTimers()
  try {
    const result = executeCorrectedMasterLinkedReview(args(released))
    const assertion = kind === 'hang' ? expect(result).rejects.toMatchObject({ status: 503, details: { reason: 'COMPLETION_INDEX_TIMEOUT' } }) : expect(result).rejects.toThrow()
    if (kind === 'hang') await jest.advanceTimersByTimeAsync(90001)
    await assertion
    if (kind === 'hang') { f.resolveIndexes(); await jest.advanceTimersByTimeAsync(0); expect(f.indexCalls).toEqual(['Execution']) }
    expect(seams.prepare).toHaveBeenCalledTimes(preparations); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
  } finally { if (kind === 'hang') jest.useRealTimers() }
})
test.each(['operator', 'source', 'revocation'])('post-preparation %s drift prevents capability consumption reaching POST', async kind => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), owner = createGenuineMasterLinkedReviewAuthority(), prepared = await owner.prepare(args(released))
  if (kind === 'operator') f.native.fingerprint = 'b'.repeat(64)
  if (kind === 'source') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'revocation') await owner.revoke(lookup(prepared))
  await expect(createOpenAiMasterLinkedDocxReviewProviderAdapter()(prepared.capability)).rejects.toThrow(); expect(seams.fetch).not.toHaveBeenCalled()
})
test('genuine capability cannot use QA adapter, cannot replay, and copied output cannot become owned findings', async () => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), prepared = await createGenuineMasterLinkedReviewAuthority().prepare(args(released))
  await expect(createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: seams.fetch })(prepared.capability)).rejects.toThrow()
  const adapter = createOpenAiMasterLinkedDocxReviewProviderAdapter(), result = await adapter(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(result).genuineProviderEligible).toBe(true)
  await expect(adapter(prepared.capability)).rejects.toThrow(); expect(seams.fetch).toHaveBeenCalledTimes(1)
  await expect(createGenuineMasterLinkedCompletedReviewStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: copy(result) })).rejects.toThrow()
  expect(f.Artifact).toHaveLength(0)
})
test('an actual corrected QA-owned terminal result cannot enter the default genuine store', async () => {
  const qaCase = 'ss055-release-proof-gen-hermetic', released = await issueCorrectedNetworkQaMasterLinkedReviewRelease({ ...releaseArgs(), qaCase })
  const prepared = await createNetworkQaMasterLinkedReviewAuthority().prepare({ actorUserId: f.subject.actorUserId, runtimeInstanceId: G1_FIXED.runtimeInstanceId,
    candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(f.request), qaCase, qaReleaseAuditId: released.approvalAuditId })
  await expect(createOpenAiMasterLinkedDocxReviewProviderAdapter()(prepared.capability)).rejects.toThrow()
  const result = await createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: seams.fetch })(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(result).genuineProviderEligible).toBe(false)
  await expect(createGenuineMasterLinkedCompletedReviewStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: result })).rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})
test('provider failure preserves the consumed start and uncertainty without automatic resubmission', async () => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), input = args(released)
  seams.fetch.mockRejectedValue(Error('FAKE_NETWORK_FAILURE'))
  await expect(executeCorrectedMasterLinkedReview(input)).rejects.toThrow(); expect(f.Execution).toHaveLength(3)
  expect(f.Audit.some(a => a.action === 'MASTER_DOCX_UNCERTAINTY_RECORDED')).toBe(true)
  await expect(executeCorrectedMasterLinkedReview(input)).rejects.toThrow(); expect(seams.fetch).toHaveBeenCalledTimes(1); expect(f.Artifact).toHaveLength(0)
})
test.each(['audit', 'record'])('required completed %s failure leaves no partial six-record bundle and replay never submits again', async kind => {
  const released = await issueCorrectedMasterLinkedReviewRelease(releaseArgs()), input = args(released)
  if (kind === 'audit') f.auditFault = 'MASTER_LINKED_DOCX_FINDINGS_RECORDED'
  else f.recordFault = 'Stage'
  await expect(executeCorrectedMasterLinkedReview(input)).rejects.toThrow(); expect(f.Execution).toHaveLength(3); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(f.Audit.filter(a => String(a.action).startsWith('MASTER_LINKED_DOCX_'))).toHaveLength(0)
  expect((await executeCorrectedMasterLinkedReview(input)).completionConfirmed).toBe(false); expect(seams.fetch).toHaveBeenCalledTimes(1)
})
test('legacy issuer and all genuine constructors retain their no-override boundaries', async () => {
  await expect(issueMasterLinkedReviewRelease(releaseArgs())).rejects.toThrow()
  expect(() => createGenuineMasterLinkedReviewAuthority({})).toThrow(); expect(() => createOpenAiMasterLinkedDocxReviewProviderAdapter({})).toThrow()
  expect(() => createGenuineMasterLinkedCompletedReviewStore({})).toThrow()
  await expect(createGenuineMasterLinkedCompletedReviewStore().assertIndexes({})).rejects.toThrow()
  await expect(executeCorrectedMasterLinkedReview({ ...args({ approvalAuditId: 'a'.repeat(24) }), deps: {} })).rejects.toThrow()
  expect(seams.fetch).not.toHaveBeenCalled()
})
test('new genuine root and exact stage tuple are guarded without altering old QA identities', async () => {
  const root = g1SubjectRoot(f.subject, f.request, G1_MODES.GENUINE), qa = g1SubjectRoot(f.subject, f.request, G1_MODES.QA, 'ss055-release-proof-gen-hermetic')
  expect(hasG1Identity({ idempotencyKey: root })).toBe(true); expect(root).not.toBe(qa)
  expect(hasCompletedStageIdentity({ stageKey: CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY })).toBe(true)
  const filter = originalOutcomeQualityStageFilter({ runtimeInstanceId: G1_FIXED.runtimeInstanceId })
  expect(filter.$and[1].$nor).toHaveLength(9); expect(filter.$and[1].$nor).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', 'master-linked-docx-rendition-stage.v3'] }, { $eq: ['$stageKey', CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY] }] } })
  expect(completedReviewFamily(root).rowIds).not.toEqual(completedReviewFamily(qa).rowIds)
  const bulk = jest.spyOn(Execution.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true }), insert = jest.spyOn(Stage.collection, 'insertMany').mockResolvedValue({ acknowledged: true })
  try {
    await expect(Execution.bulkWrite([{ insertOne: { document: { idempotencyKey: root } } }], { skipValidation: true })).rejects.toThrow()
    await expect(Stage.insertMany([{ stageKey: CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY }], { lean: true })).rejects.toThrow()
    expect(bulk).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled()
  } finally { bulk.mockRestore(); insert.mockRestore() }
  expect(membershipHash(f.subject)).toBe(f.request.subjectFingerprint)
})
const containsGuard = (value, root, stage) => value instanceof RegExp ? value.test(root) : value === stage
  || value && typeof value === 'object' && Object.values(value).some(v => containsGuard(v, root, stage))
test.each([Execution, Stage])('$modelName guards stored genuine-only markers and negative-exists atomic exclusions', async Model => {
  const root = g1SubjectRoot(f.subject, f.request, G1_MODES.GENUINE), stage = CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY
  const exists = Model.exists; exists.mockClear().mockImplementation(() => { const q = Promise.resolve({ _id: new mongoose.Types.ObjectId() }); q.session = () => q; return q })
  const update = jest.spyOn(Model.collection, 'updateOne').mockResolvedValue({ acknowledged: true, matchedCount: 0 }), remove = jest.spyOn(Model.collection, 'deleteOne').mockResolvedValue({ acknowledged: true, deletedCount: 0 }), bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
  try {
    await expect(Model.updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { warnings: [] } })).rejects.toThrow(); expect(update).not.toHaveBeenCalled()
    if (Model === Execution) expect(containsGuard(exists.mock.calls[0][0], root, stage)).toBe(true)
    else expect(exists).not.toHaveBeenCalled()
    exists.mockImplementation(() => { const q = Promise.resolve(null); q.session = () => q; return q })
    if (Model === Stage) await expect(Model.deleteOne({ _id: new mongoose.Types.ObjectId() })).rejects.toThrow()
    else { await Model.deleteOne({ _id: new mongoose.Types.ObjectId() }); expect(containsGuard(remove.mock.calls[0][0].$and[1].$nor, root, stage)).toBe(true) }
    await Model.bulkWrite([{ deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } }])
    expect(containsGuard(bulk.mock.calls[0][0][0].deleteOne.filter.$and[1].$nor, root, stage)).toBe(true)
  } finally { update.mockRestore(); remove.mockRestore(); bulk.mockRestore() }
})
