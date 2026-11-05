import fs from 'node:fs'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import Audit from '../models/AuditLog.js'
import { correctedGenuineSeams as seams, installCorrectedGenuineModelSeams } from './fixtures/correctedGenuineReviewFixture.js'
import { MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'

// Unsigned metadata was derived from the actual retained F032 DOCX, seven PNGs,
// source, real plan and selected method/pack content through the real pure
// preparation owners. The dated external preparation report preserves that
// derivation. These tests reuse explicit operator/source/model/serialization
// seams: no live source admission, permission, persistence or quality is proven.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/narrowGenuineReviewSubject.json', import.meta.url)))
const predecessor = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedGenuineReviewSubject.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value)), expected = metadata.request
const originalFetch = globalThis.fetch, originalKey = process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
globalThis.fetch = seams.fetch
process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = 'SS055_HERMETIC_NARROW_ONLY_NO_PROVIDER'
const traps = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'),
  jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
traps.forEach(trap => trap.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') }))
const g1 = await import('../services/masterLinkedGenuineReviewContract.js')
const { issueNarrowGenuineMasterLinkedReviewRelease: issue, issueApprovedGenuineMasterLinkedReviewRelease: oldIssue,
  issueCategoryGenuineMasterLinkedReviewRelease: categoryIssue } = await import('../services/masterLinkedReviewReleaseService.js')
const { createNarrowGenuineMasterLinkedReviewAuthority: authority, createApprovedGenuineMasterLinkedReviewAuthority: oldAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createOpenAiNarrowMasterLinkedDocxReviewProviderAdapter: adapter, createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter: oldAdapter,
  createFakeNetworkApprovedMasterLinkedDocxReviewProviderAdapter: qaAdapter } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createNarrowGenuineMasterLinkedCompletedReviewStore: store, createApprovedGenuineMasterLinkedCompletedReviewStore: oldStore,
  createApprovedNetworkQaMasterLinkedCompletedReviewStore: qaStore } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeNarrowGenuineMasterLinkedReview: execute, executeApprovedGenuineMasterLinkedReview: oldExecute } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const { originalOutcomeQualityStageFilter } = await import('../utils/outcomeQualityStageSubjects.js')
const harness = installCorrectedGenuineModelSeams(metadata)
let f
const wire = (failed = false) => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: failed ? 'FAIL' : 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(dimension => [dimension,
    { status: failed && dimension === 'HEADINGS' ? 'FAIL' : 'PASS', finding: 'Synthetic narrow protocol evidence only.', requiredChange: failed && dimension === 'HEADINGS' }])) })
const response = (text, status = 'completed') => new Response(JSON.stringify({ id: 'resp_narrow_gen_unit', status, model: 'gpt-5.2',
  output: status === 'completed' ? [{ type: 'message', content: [{ type: 'output_text', text }] }] : [] }), { headers: { 'x-request-id': 'req_narrow_gen_unit' } })
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NO_NATIVE_TOKEN', approvalReference: 'UNIT ONLY; not a real release.', expected: copy(expected) })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: g1.G1_FIXED.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId })
const grantRead = () => ({ actorUserId: f.subject.actorUserId, scopes: {},
  grantExecutionId: f.Execution.find(row => row.executionEvidence?.masterDocxDispatch?.body.phase === 'GRANT').executionId })
const findingsCount = () => f.Execution.filter(row => row.outputTypeKey === 'MASTER_LINKED_DOCX_REVIEW').length
beforeEach(() => {
  f = harness.reset()
  delete f.rawText
  seams.fetch.mockImplementation(async () => response(f.rawText ?? JSON.stringify(wire(f.failed))))
})
afterAll(() => {
  traps.forEach(trap => expect(trap).not.toHaveBeenCalled())
  harness.restoreName(); jest.restoreAllMocks(); globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
  else process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = originalKey
})

test('freezes the actual F032 preparation tuple and issues a distinct one-use held release', async () => {
  expect(g1.G1_NARROW_REQUEST).toEqual(expected)
  expect(f.subject.binding).toMatchObject({ contractVersion: 'master-linked-docx-review-binding.v4',
    candidateId: 'docx_candidate_f032af3b-ad37-492a-ab38-9abbc7d4caeb',
    docxChecksum: 'sha256:79525d457a1f5deb0460ac3dfcf6731d60b65c0e18ae433e7685661c947909f5' })
  expect(f.subject.binding.pages).toHaveLength(7)
  const release = await issue(releaseArgs()), audit = f.Audit.find(row => String(row._id) === release.approvalAuditId)
  const diff = g1.assertG1Approval(audit, f.subject, expected, row => Audit.prototype.verifySignature.call(row), Date.now())
  expect(diff.version).toBe(g1.G1_NARROW_GENUINE_RELEASE.version)
  expect(diff.onceRoot).toMatch(/^SS055_NARROW_GENUINE_DOCX:/)
  expect(diff.maximumAttempts).toBe(1)
  for (const key of ['customerApproval', 'productionUse', 'automaticFinalisation']) expect(diff[key]).toBe(false)
  const count = f.Audit.length
  expect((await issue(releaseArgs())).approvalAuditId).toBe(release.approvalAuditId)
  expect(f.Audit).toHaveLength(count); expect(seams.fetch).not.toHaveBeenCalled()
})

test.each([false, true])('fake FAIL=%s saves, reads, reconciles and replays one v8 result without resend', async failed => {
  f.failed = failed
  const release = await issue(releaseArgs()), input = args(release), saved = await execute(input)
  expect(saved).toMatchObject({ completionConfirmed: true, mode: g1.G1_MODES.GENUINE, reviewStatus: failed ? 'FAIL' : 'PASS',
    approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(saved.findings.findings.map(value => value.dimension)).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  expect(f.Stage[0]).toMatchObject({ contractVersion: 'master-linked-docx-rendition-stage.v8',
    stageKey: 'MASTER_LINKED_NARROW_RENDITION_RL', executionIdentity: { providerConfigurationVersion: 'MASTER_LINKED_DOCX_NARROW_GENUINE_V1' } })
  expect(f.Stage[0].renditionInputSnapshot.receipt).toMatchObject({ version: 'master-linked-docx-visual-review-receipt.v5',
    requestVersion: 'master-linked-docx-visual-review-request.v5', responseVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION })
  expect(f.Stage[0].renditionInputSnapshot.subject.binding).toEqual(metadata.subject.binding)
  expect(f.Artifact[0].contractVersion).toBe('master-linked-docx-review-artifact.v8')
  expect((await store().read(grantRead())).resultFingerprint).toBe(saved.resultFingerprint)
  expect(await store().read(grantRead())).toEqual(await store().reconcile(grantRead()))
  const counts = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await execute(input)).resultFingerprint).toBe(saved.resultFingerprint)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(counts)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
  expect(seams.fetch.mock.calls[0][1].body).toBe('{"hermeticNarrowProtocolOnly":true}')
  expect(originalOutcomeQualityStageFilter().$and[1].$nor).toContainEqual({ $expr: { $and: [
    { $eq: ['$contractVersion', 'master-linked-docx-rendition-stage.v8'] }, { $eq: ['$stageKey', 'MASTER_LINKED_NARROW_RENDITION_RL'] },
  ] } })
  if (failed) expect(f.Stage[0].failure.retryable).toBe(false)
})

test('rejects old and QA permissions before granting or sending', async () => {
  for (const profile of [g1.G1_APPROVED_GENUINE_RELEASE, g1.G1_CATEGORY_GENUINE_RELEASE, g1.G1_APPROVED_QA_RELEASE]) {
    f = harness.reset()
    const release = await issue(releaseArgs()), audit = f.Audit.find(row => String(row._id) === release.approvalAuditId)
    audit.diff.version = profile.version; audit.action = profile.action
    const resigned = new Audit(audit); resigned.generateSignature(); Object.assign(audit, resigned.toObject())
    await expect(execute(args(release))).rejects.toThrow()
    expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
  }
})

test('old issuers and executor reject narrow identity before recording or index work', async () => {
  for (const issuer of [oldIssue, categoryIssue]) await expect(issuer(releaseArgs())).rejects.toThrow()
  const release = await issue(releaseArgs()), calls = seams.prepare.mock.calls.length
  await expect(oldExecute(args(release))).rejects.toThrow()
  expect(seams.prepare).toHaveBeenCalledTimes(calls); expect(f.indexCalls).toHaveLength(0)
  expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test('narrow factories forbid overrides and old/QA adapters and stores reject its capability/result', async () => {
  for (const factory of [authority, adapter, store]) expect(() => factory({ fetchImpl: seams.fetch })).toThrow()
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release))
  for (const wrong of [oldAdapter(), qaAdapter({ fetchImpl: seams.fetch })]) await expect(wrong(prepared.capability)).rejects.toThrow()
  expect(seams.fetch).not.toHaveBeenCalled()
  const output = await adapter()(prepared.capability)
  await expect(adapter()(prepared.capability)).rejects.toThrow()
  for (const wrong of [oldStore(), qaStore()]) await expect(wrong.persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toThrow()
  expect(seams.fetch).toHaveBeenCalledTimes(1); expect(f.Stage).toHaveLength(0)
})

test('old authority and store refuse narrow grants without consuming them', async () => {
  const release = await issue(releaseArgs()), input = args(release)
  await expect(oldAuthority().prepare(input)).rejects.toThrow()
  await authority().prepare(input)
  for (const operation of ['read', 'revoke', 'recover']) await expect(oldAuthority()[operation](grantRead())).rejects.toThrow()
  for (const operation of ['read', 'reconcile']) await expect(oldStore()[operation](grantRead())).rejects.toThrow()
  expect(seams.fetch).not.toHaveBeenCalled()
})

test.each(['candidate', 'bytes commitment', 'page', 'master', 'pack', 'operator', 'compatibility', 'version'])('refuses changed %s before release or fake submission', async kind => {
  if (kind === 'candidate') f.subject.binding.candidateId = predecessor.subject.binding.candidateId
  if (kind === 'bytes commitment') f.subject.binding.docxChecksum = 'sha256:' + 'f'.repeat(64)
  if (kind === 'page') f.subject.binding.pages[6].sha256 = 'f'.repeat(64)
  if (kind === 'master') f.subject.binding.masterReference.masterId += '-changed'
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'operator') seams.auth.mockResolvedValueOnce(copy(f.native)).mockResolvedValueOnce({ ...f.native, fingerprint: 'b'.repeat(64) })
  if (kind === 'compatibility') f.subject.binding.compatibilityReference.decisionFingerprint = 'f'.repeat(64)
  if (kind === 'version') f.subject.binding.contractVersion = 'master-linked-docx-review-binding.v3'
  await expect(issue(releaseArgs())).rejects.toThrow()
  expect(f.Audit).toHaveLength(3); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test('incomplete seven-category response is consumed and held without findings or resend', async () => {
  const value = wire(); delete value.findings.BRAND_EXPRESSION; f.rawText = JSON.stringify(value)
  const release = await issue(releaseArgs()), input = args(release)
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_OUTPUT_INVALID' } })
  expect(await authority().read(grantRead())).toMatchObject({ genuineAttemptConsumed: true,
    receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
  expect(await execute(input)).toMatchObject({ completionConfirmed: false })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('timeout remains consumed with no findings and no second submission', async () => {
  const release = await issue(releaseArgs()), input = args(release), realNow = Date.now()
  let elapsed = 0
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow + elapsed)
  seams.fetch.mockImplementation(async () => { elapsed = 300001; return response(JSON.stringify(wire()), 'queued') })
  try {
    await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_TIMEOUT' } })
    expect(await authority().read(grantRead())).toMatchObject({ genuineAttemptConsumed: true,
      receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
    await expect(execute(input)).rejects.toThrow()
    expect(seams.fetch).toHaveBeenCalledTimes(1); expect(f.Stage).toHaveLength(0)
  } finally { clock.mockRestore() }
})

test('changed saved compatibility blocks findings after one fake response', async () => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release)), output = await adapter()(prepared.capability)
  f.Candidate.body.masterBinding.compatibilityReference.decisionFingerprint = 'f'.repeat(64)
  await expect(store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toThrow()
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(findingsCount()).toBe(0)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('C396 request and release remain frozen while narrow rejects the predecessor tuple', async () => {
  expect(g1.G1_APPROVED_REQUEST).toEqual(predecessor.request)
  expect(g1.G1_APPROVED_GENUINE_RELEASE.candidateId).toBe(predecessor.subject.binding.candidateId)
  await expect(issue({ ...releaseArgs(), expected: copy(predecessor.request) })).rejects.toThrow()
  expect(f.Audit).toHaveLength(3); expect(seams.fetch).not.toHaveBeenCalled()
})
