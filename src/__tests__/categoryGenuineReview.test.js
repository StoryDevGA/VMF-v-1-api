import fs from 'node:fs'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { correctedGenuineSeams as seams, installCorrectedGenuineModelSeams } from './fixtures/correctedGenuineReviewFixture.js'
import { MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'

// Real zero-override genuine factories, but isolated unit operator/source/model
// seams and captured fake fetch. This creates no real permission or DB result.
const originalFetch = globalThis.fetch, originalKey = process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
globalThis.fetch = seams.fetch
process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = 'SS055_HERMETIC_ONLY_NO_PROVIDER'
const traps = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
traps.forEach(t => t.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') }))
const g1 = await import('../services/masterLinkedGenuineReviewContract.js')
const g2 = await import('../services/masterLinkedCompletedReviewContract.js')
const { issueCategoryGenuineMasterLinkedReviewRelease: issue, issueCategoryNetworkQaMasterLinkedReviewRelease: issueQa,
  issueCorrectedMasterLinkedReviewRelease: issueOld } = await import('../services/masterLinkedReviewReleaseService.js')
const { createGenuineMasterLinkedReviewAuthority: authority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter: adapter, createOpenAiMasterLinkedDocxReviewProviderAdapter: oldAdapter,
  createFakeNetworkMasterLinkedCategoryReviewProviderAdapter: qaAdapter, snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createGenuineMasterLinkedCompletedReviewStore: store, createNetworkQaMasterLinkedCompletedReviewStore: qaStore } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeCategoryGenuineMasterLinkedReview: execute, executeCorrectedMasterLinkedReview: oldExecute } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const { originalOutcomeQualityStageFilter } = await import('../utils/outcomeQualityStageSubjects.js')
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/categoryReviewRequest.json', import.meta.url)))
const copy = v => JSON.parse(JSON.stringify(v)), harness = installCorrectedGenuineModelSeams()
let f
const wire = (failed = false) => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: failed ? 'FAIL' : 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(d => [d,
    { status: failed && d === 'HEADINGS' ? 'FAIL' : 'PASS', finding: 'Synthetic category genuine-protocol unit evidence only.', requiredChange: failed && d === 'HEADINGS' }])) })
const response = (text, queued = false) => new Response(JSON.stringify({ id: 'resp_category_gen_unit', status: queued ? 'queued' : 'completed', model: 'gpt-5.2',
  output: queued ? [] : [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { headers: { 'x-request-id': 'req_category_gen_unit' } })
beforeEach(() => {
  f = harness.reset(); f.request = copy(expected)
  for (const key of ['rawText', 'recordAfterResponse', 'poll']) delete f[key]
  const prepare = seams.prepare.getMockImplementation()
  seams.prepare.mockImplementation(async args => ({ ...await prepare(args), categoryRequest: copy(expected) }))
  seams.fetch.mockImplementation(async (_url, options) => {
    if (f.recordAfterResponse) f.recordFault = f.recordAfterResponse
    return response(f.rawText ?? JSON.stringify(wire(f.failed)), f.poll && options.method === 'POST')
  })
})
afterAll(() => {
  traps.forEach(t => expect(t).not.toHaveBeenCalled()); harness.restoreName(); jest.restoreAllMocks(); globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
  else process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = originalKey
})
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NO_NATIVE_TOKEN', approvalReference: 'UNIT ONLY; not genuine execution authority.', expected: copy(expected) })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: g1.G1_FIXED.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId })
const grantRead = () => ({ actorUserId: f.subject.actorUserId, scopes: {},
  grantExecutionId: f.Execution.find(r => r.executionEvidence?.masterDocxDispatch?.body.phase === 'GRANT').executionId })
const row = release => f.Audit.find(a => String(a._id) === release.approvalAuditId)
const sign = a => { const d = new Audit(a); d.generateSignature(); return d.toObject() }

test('new release binds native operator and exact request, with a new genuine root and no QA permission', async () => {
  const release = await issue(releaseArgs()), audit = row(release), diff = g1.assertG1Approval(audit, f.subject, expected, a => Audit.prototype.verifySignature.call(a), Date.now())
  expect(diff.version).toBe(g1.G1_CATEGORY_GENUINE_RELEASE.version); expect(diff.onceRoot).toMatch(/^SS055_CATEGORY_GENUINE_DOCX:/)
  expect(diff.operatorAuthority).toEqual(f.native); expect(diff.maximumAttempts).toBe(1)
  for (const key of ['customerApproval', 'productionUse', 'automaticFinalisation']) expect(diff[key]).toBe(false)
  expect(() => g1.assertG1QaRelease(audit, f.subject, expected, () => true, Date.now(), 'ss055-release-proof-unit')).toThrow()
  expect(seams.auth).toHaveBeenCalledTimes(2); expect(seams.fetch).not.toHaveBeenCalled()
  const n = f.Audit.length; expect((await issue(releaseArgs())).approvalAuditId).toBe(release.approvalAuditId); expect(f.Audit).toHaveLength(n)
  await expect(issue({ ...releaseArgs(), approvalReference: 'Changed reference' })).rejects.toThrow()
})

test.each([false, true])('complete seven-category genuine protocol with fake FAIL=%s saves, reads and replays once', async failed => {
  f.failed = failed; const release = await issue(releaseArgs()), input = args(release), saved = await execute(input)
  expect(saved).toMatchObject({ completionConfirmed: true, mode: g1.G1_MODES.GENUINE, reviewStatus: failed ? 'FAIL' : 'PASS', approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(saved.findings.findings.map(x => x.dimension)).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  expect(f.Stage[0]).toMatchObject({ contractVersion: 'master-linked-docx-rendition-stage.v5', stageKey: 'MASTER_LINKED_CATEGORY_RENDITION_RL' })
  const inputSnapshot = f.Stage[0].renditionInputSnapshot
  expect(inputSnapshot.receipt).toMatchObject({ version: 'master-linked-docx-visual-review-receipt.v3', requestVersion: 'master-linked-docx-visual-review-request.v3', responseVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION })
  expect(inputSnapshot.version).toBe(g2.CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION)
  expect(f.Artifact[0].contractVersion).toBe(g2.CATEGORY_GENUINE_COMPLETED_ARTIFACT_VERSION)
  expect(await store().read(grantRead())).toEqual(await store().reconcile(grantRead()))
  expect((await store().read(grantRead())).resultFingerprint).toBe(saved.resultFingerprint)
  const counts = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await execute(input)).resultFingerprint).toBe(saved.resultFingerprint)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(counts)
  expect(seams.fetch).toHaveBeenCalledTimes(1); expect(seams.fetch.mock.calls[0][1].body).toBe('{"hermeticCategoryProtocolOnly":true}')
  if (failed) expect(f.Stage[0].failure.retryable).toBe(false)
})

test('legacy executor refuses new binding before index/source work or reservation', async () => {
  const release = await issue(releaseArgs()), n = seams.prepare.mock.calls.length
  await expect(oldExecute(args(release))).rejects.toMatchObject({ details: { reason: 'CATEGORY_EXECUTOR_REQUIRED' } })
  expect(seams.prepare).toHaveBeenCalledTimes(n); expect(f.Execution).toHaveLength(0); expect(f.indexCalls).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test.each(['missing', 'QA', 'old-kind', 'signature', 'scope', 'expiry', 'request'])('refuses %s permission before POST or grant', async kind => {
  let release = await issue(releaseArgs()); const audit = row(release)
  if (kind === 'missing') f.Audit.splice(f.Audit.indexOf(audit), 1)
  if (kind === 'QA') release = await issueQa({ ...releaseArgs(), qaCase: 'ss055-release-proof-category-gen-unit' })
  if (kind === 'signature') audit.diff.approvalReference += '-tampered'
  if (kind === 'old-kind') { audit.diff.version = g1.G1_CORRECTED_GENUINE_RELEASE.version; audit.action = g1.G1_CORRECTED_GENUINE_RELEASE.action }
  if (kind === 'scope') audit.diff.scope.tenantId = 'f'.repeat(24)
  if (kind === 'request') audit.diff.requestBinding.requestIdentity = 'f'.repeat(64)
  if (['old-kind', 'scope', 'request'].includes(kind)) Object.assign(audit, sign(audit))
  const clock = kind === 'expiry' ? jest.spyOn(Date, 'now').mockReturnValue(Date.parse(release.expiresAt) + 1) : null
  try { await expect(execute(args(release))).rejects.toMatchObject({ details: { reason: 'OPERATOR_RELEASE_INVALID' } }); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled() } finally { clock?.mockRestore() }
})

test.each(['operator', 'request', 'page', 'pack', 'predecessor'])('issuer refuses changed %s without write', async kind => {
  const input = releaseArgs()
  if (kind === 'operator') seams.auth.mockResolvedValueOnce(copy(f.native)).mockResolvedValueOnce({ ...f.native, fingerprint: 'b'.repeat(64) })
  if (kind === 'request') input.expected.requestIdentity = 'f'.repeat(64)
  if (kind === 'page') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'predecessor') f.subject.binding.correctionReference.predecessor.failedReviewResultFingerprint = 'f'.repeat(64)
  await expect(issue(input)).rejects.toThrow(); expect(f.Audit).toHaveLength(3); expect(seams.fetch).not.toHaveBeenCalled()
})

test('new factories reject overrides; wrong adapter refuses before consuming genuine category capability', async () => {
  expect(() => adapter({ fetchImpl: seams.fetch })).toThrow()
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release))
  await expect(oldAdapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  await expect(qaAdapter({ fetchImpl: seams.fetch })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  const output = await adapter()(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(output).genuineProviderEligible).toBe(true)
  await expect(qaStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
  await expect(store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: copy(output) })).rejects.toThrow()
  await expect(adapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test.each(['missing', 'extra', 'duplicate', 'wrong-version', 'status'])('invalid %s response consumes once, retains failure and never stores findings or resends', async kind => {
  const w = wire()
  if (kind === 'missing') delete w.findings.BRAND_EXPRESSION
  if (kind === 'extra') w.findings.EXTRA = w.findings.HEADINGS
  if (kind === 'wrong-version') w.schemaVersion = 'other'
  if (kind === 'status') w.overallStatus = 'FAIL'
  f.rawText = JSON.stringify(w)
  if (kind === 'duplicate') f.rawText = f.rawText.replace('"STATEMENTS":', '"HEADINGS":{"status":"PASS","finding":"duplicate","requiredChange":false},"STATEMENTS":')
  const release = await issue(releaseArgs()), input = args(release)
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_OUTPUT_INVALID' } })
  expect((await authority().read(grantRead()))).toMatchObject({ genuineAttemptConsumed: true, submissionState: 'KNOWN_RESPONSE',
    receipts: { UNCERTAINTY: { payload: { reason: 'PROVIDER_FAILED', state: 'HELD_NO_RETRY' } } } })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(await execute(input)).toEqual({ state: 'COMPLETED_REVIEW_NOT_RECORDED', completionConfirmed: false,
    approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test.each(['Execution', 'Artifact', 'Stage'])('unit transaction simulation preserves no partial findings on %s create failure', async name => {
  f.recordAfterResponse = name; const release = await issue(releaseArgs())
  await expect(execute(args(release))).rejects.toThrow()
  expect(f.Execution.filter(r => r.outputTypeKey === g2.COMPLETED_REVIEW_OUTPUT)).toHaveLength(0)
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test.each(Object.values(g2.COMPLETED_REVIEW_ACTIONS))('unit transaction simulation rejects required %s audit failure', async action => {
  f.auditFault = action; const release = await issue(releaseArgs())
  await expect(execute(args(release))).rejects.toThrow()
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(f.Execution.filter(r => r.outputTypeKey === g2.COMPLETED_REVIEW_OUTPUT)).toHaveLength(0)
})

test('missing indexes holds before new source preparation or root allocation', async () => {
  const release = await issue(releaseArgs()), n = seams.prepare.mock.calls.length; f.missingIndex = 'Stage'
  await expect(execute(args(release))).rejects.toMatchObject({ details: { reason: 'COMPLETION_INDEX_UNAVAILABLE' } })
  expect(seams.prepare).toHaveBeenCalledTimes(n); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test('polling is GET-only after one fake POST and produces one v5 result', async () => {
  f.poll = true; const release = await issue(releaseArgs()); await execute(args(release))
  expect(seams.fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET']); expect(f.Stage).toHaveLength(1)
})

test('old issuer does not admit new wire binding and new v5 stage stays out of original chain', async () => {
  await expect(issueOld(releaseArgs())).rejects.toThrow(); expect(f.Audit).toHaveLength(3)
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.GENUINE, expected)
  expect(originalOutcomeQualityStageFilter({}).$and[1].$nor).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', profile.stageVersion] }, { $eq: ['$stageKey', profile.stageKey] }] } })
})

const containsMarker = (value, marker) => value instanceof RegExp ? value.test(marker)
  : value === marker || value && typeof value === 'object' && Object.values(value).some(v => containsMarker(v, marker))
test.each([[Execution, 'SS055_CATEGORY_GENUINE_DOCX:held'], [Artifact, 'master-linked-docx-review-artifact.v5'], [Stage, 'master-linked-docx-rendition-stage.v5']])('model protects stored genuine category markers on $modelName', async (Model, marker) => {
  const query = value => { const q = Promise.resolve(value); q.session = () => q; return q }, exists = Model.exists
  exists.mockClear().mockImplementation(() => query({ _id: 'a'.repeat(24) }))
  const update = jest.spyOn(Model.collection, 'updateOne').mockResolvedValue({ acknowledged: true }),
    bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
  try {
    await expect(Model.updateOne({ _id: 'a'.repeat(24) }, { $set: { warnings: [] } })).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
    if (Model !== Stage) expect(containsMarker(exists.mock.calls[0][0], marker)).toBe(true)
    exists.mockImplementation(() => query(null))
    await Model.bulkWrite([{ deleteOne: { filter: { _id: 'a'.repeat(24) } } }])
    expect(containsMarker(bulk.mock.calls[0][0][0].deleteOne.filter, marker)).toBe(true)
  } finally { update.mockRestore(); bulk.mockRestore(); exists.mockImplementation(() => query(null)) }
})
