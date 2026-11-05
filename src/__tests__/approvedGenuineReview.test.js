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

// Zero-override genuine protocol owners with unsigned metadata, explicit unit
// source/operator/model/serialization seams and captured fake fetch only. These
// checks create no real permission, database result or document-quality verdict.
// Session callbacks below simulate storage branches, never real transactions.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedGenuineReviewSubject.json', import.meta.url)))
const corrected = JSON.parse(fs.readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
const categoryRequest = JSON.parse(fs.readFileSync(new URL('./fixtures/categoryReviewRequest.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value)), expected = metadata.request
const originalFetch = globalThis.fetch, originalKey = process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
globalThis.fetch = seams.fetch
process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = 'SS055_HERMETIC_APPROVED_ONLY_NO_PROVIDER'
const traps = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
traps.forEach(trap => trap.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') }))
const g1 = await import('../services/masterLinkedGenuineReviewContract.js')
const g2 = await import('../services/masterLinkedCompletedReviewContract.js')
const { issueApprovedGenuineMasterLinkedReviewRelease: issue, issueCategoryGenuineMasterLinkedReviewRelease: oldCategoryIssue,
  issueCorrectedMasterLinkedReviewRelease: oldCorrectedIssue, issueMasterLinkedReviewRelease: oldOriginalIssue } = await import('../services/masterLinkedReviewReleaseService.js')
const { createApprovedGenuineMasterLinkedReviewAuthority: authority, createGenuineMasterLinkedReviewAuthority: oldAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter: adapter, createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter: oldCategoryAdapter,
  createOpenAiMasterLinkedDocxReviewProviderAdapter: oldAdapter, createFakeNetworkMasterLinkedCategoryReviewProviderAdapter: qaAdapter,
  snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createApprovedGenuineMasterLinkedCompletedReviewStore: store, createGenuineMasterLinkedCompletedReviewStore: oldStore,
  createNetworkQaMasterLinkedCompletedReviewStore: qaStore } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeApprovedGenuineMasterLinkedReview: execute, executeCategoryGenuineMasterLinkedReview: oldCategoryExecute,
  executeCorrectedMasterLinkedReview: oldCorrectedExecute } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const { originalOutcomeQualityStageFilter } = await import('../utils/outcomeQualityStageSubjects.js')
const harness = installCorrectedGenuineModelSeams(metadata)
let f
const wire = (failed = false) => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: failed ? 'FAIL' : 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(d => [d,
    { status: failed && d === 'HEADINGS' ? 'FAIL' : 'PASS', finding: 'Synthetic approved-expression protocol evidence only.', requiredChange: failed && d === 'HEADINGS' }])) })
const response = (text, status = 'completed') => new Response(JSON.stringify({ id: 'resp_approved_gen_unit', status, model: 'gpt-5.2',
  output: status === 'completed' ? [{ type: 'message', content: [{ type: 'output_text', text }] }] : [] }), { headers: { 'x-request-id': 'req_approved_gen_unit' } })
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NO_NATIVE_TOKEN', approvalReference: 'UNIT ONLY; not a real review release.', expected: copy(expected) })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: g1.G1_FIXED.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId })
const grantRead = () => ({ actorUserId: f.subject.actorUserId, scopes: {},
  grantExecutionId: f.Execution.find(r => r.executionEvidence?.masterDocxDispatch?.body.phase === 'GRANT').executionId })
const row = release => f.Audit.find(a => String(a._id) === release.approvalAuditId)
const sign = audit => { const model = new Audit(audit); model.generateSignature(); return model.toObject() }
const findingsCount = () => f.Execution.filter(r => r.outputTypeKey === g2.COMPLETED_REVIEW_OUTPUT).length
beforeEach(() => {
  f = harness.reset()
  for (const key of ['rawText', 'recordAfterResponse', 'poll', 'terminalFailure']) delete f[key]
  const prepare = seams.prepare.getMockImplementation()
  seams.prepare.mockImplementation(async input => ({ ...await prepare(input), categoryRequest: copy(categoryRequest) }))
  seams.fetch.mockImplementation(async (_url, options) => {
    if (f.recordAfterResponse) f.recordFault = f.recordAfterResponse
    return response(f.rawText ?? JSON.stringify(wire(f.failed)), f.terminalFailure ? 'failed' : f.poll && options.method === 'POST' ? 'queued' : 'completed')
  })
})
afterAll(() => {
  traps.forEach(trap => expect(trap).not.toHaveBeenCalled())
  harness.restoreName(); jest.restoreAllMocks(); globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
  else process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = originalKey
})

test('new release freezes the exact approved-expression subject and separate one-use root', async () => {
  expect(g1.G1_APPROVED_REQUEST).toEqual(expected)
  const release = await issue(releaseArgs()), audit = row(release)
  const diff = g1.assertG1Approval(audit, f.subject, expected, a => Audit.prototype.verifySignature.call(a), Date.now())
  expect(diff.version).toBe(g1.G1_APPROVED_GENUINE_RELEASE.version)
  expect(diff.onceRoot).toMatch(/^SS055_APPROVED_GENUINE_DOCX:/)
  expect(diff.candidateId).toBe(metadata.subject.binding.candidateId)
  expect(diff.operatorAuthority).toEqual(f.native); expect(diff.maximumAttempts).toBe(1)
  for (const flag of ['customerApproval', 'productionUse', 'automaticFinalisation']) expect(diff[flag]).toBe(false)
  expect(() => g1.assertG1QaRelease(audit, f.subject, expected, () => true, Date.now(), 'ss055-release-proof-approved-unit')).toThrow()
  const count = f.Audit.length
  expect((await issue(releaseArgs())).approvalAuditId).toBe(release.approvalAuditId); expect(f.Audit).toHaveLength(count)
  await expect(issue({ ...releaseArgs(), approvalReference: 'Changed unit reference' })).rejects.toThrow()
  expect(seams.fetch).not.toHaveBeenCalled()
})

test.each([false, true])('fake seven-category FAIL=%s saves, reads, reconciles and replays one v6 bundle', async failed => {
  f.failed = failed
  const release = await issue(releaseArgs()), input = args(release), saved = await execute(input)
  expect(saved).toMatchObject({ completionConfirmed: true, mode: g1.G1_MODES.GENUINE, reviewStatus: failed ? 'FAIL' : 'PASS',
    approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(saved.findings.findings.map(v => v.dimension)).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  expect(f.Stage[0]).toMatchObject({ contractVersion: 'master-linked-docx-rendition-stage.v6', stageKey: 'MASTER_LINKED_APPROVED_RENDITION_RL',
    executionIdentity: { providerConfigurationVersion: 'MASTER_LINKED_DOCX_APPROVED_GENUINE_V1' } })
  const snapshot = f.Stage[0].renditionInputSnapshot
  expect(snapshot.version).toBe(g2.APPROVED_COMPLETED_REVIEW_VERSION)
  expect(snapshot.receipt).toMatchObject({ version: 'master-linked-docx-visual-review-receipt.v4', requestVersion: 'master-linked-docx-visual-review-request.v4', responseVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION })
  expect(snapshot.subject.binding.compatibilityReference).toEqual(metadata.subject.binding.compatibilityReference)
  expect(f.Artifact[0].contractVersion).toBe(g2.APPROVED_COMPLETED_ARTIFACT_VERSION)
  expect((await store().read(grantRead())).resultFingerprint).toBe(saved.resultFingerprint)
  expect(await store().read(grantRead())).toEqual(await store().reconcile(grantRead()))
  const counts = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await execute(input)).resultFingerprint).toBe(saved.resultFingerprint)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(counts)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
  expect(seams.fetch.mock.calls[0][1].body).toBe('{"hermeticApprovedProtocolOnly":true}')
  if (failed) expect(f.Stage[0].failure.retryable).toBe(false)
})

const oldRequests = [
  { requestIdentity: 'c5a51616e1783e96a6ac7395d490ce83522de8c88b34a05fd92c91f9774bf8ff', subjectFingerprint: '03361f15efa60ebd630449449931a64d633d225df50b3f5d862b398bd8d60504',
    contextFingerprint: 'd9fba3835d2c9ddfd6195ab202543a305cb96f293e45309a99b310f85ca8015b', policyFingerprint: '1ac4b2f41724224645c15553c6123c7e47eb151905e902adbde9f3a02623eff4' },
  corrected.request, categoryRequest,
]
test.each(oldRequests)('new issuer rejects a consumed predecessor request $requestIdentity without writes', async expectedOld => {
  await expect(issue({ ...releaseArgs(), expected: copy(expectedOld) })).rejects.toThrow()
  expect(f.Audit).toHaveLength(3); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})
test.each([oldOriginalIssue, oldCorrectedIssue, oldCategoryIssue])('old issuer rejects the new candidate before recording authority', async oldIssue => {
  await expect(oldIssue(releaseArgs())).rejects.toThrow()
  expect(f.Audit).toHaveLength(3); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})
test.each([oldCorrectedExecute, oldCategoryExecute])('old executor rejects new candidate before index/source work', async oldExecute => {
  const release = await issue(releaseArgs()), prepared = seams.prepare.mock.calls.length
  await expect(oldExecute(args(release))).rejects.toThrow()
  expect(seams.prepare).toHaveBeenCalledTimes(prepared); expect(f.indexCalls).toHaveLength(0); expect(f.Execution).toHaveLength(0)
})

test.each(['missing', 'QA', 'original', 'corrected', 'category', 'signature', 'scope', 'expiry', 'request'])('refuses %s permission before grant or fake POST', async kind => {
  const release = await issue(releaseArgs()), audit = row(release)
  if (kind === 'missing') f.Audit.splice(f.Audit.indexOf(audit), 1)
  if (kind === 'signature') audit.diff.approvalReference += '-tampered'
  const profile = { QA: g1.G1_CATEGORY_QA_RELEASE, original: g1.G1_GENUINE_RELEASE, corrected: g1.G1_CORRECTED_GENUINE_RELEASE, category: g1.G1_CATEGORY_GENUINE_RELEASE }[kind]
  if (profile) { audit.diff.version = profile.version; audit.action = profile.action }
  if (kind === 'scope') audit.diff.scope.tenantId = 'f'.repeat(24)
  if (kind === 'request') audit.diff.requestBinding.requestIdentity = 'f'.repeat(64)
  if (profile || ['scope', 'request'].includes(kind)) Object.assign(audit, sign(audit))
  const clock = kind === 'expiry' ? jest.spyOn(Date, 'now').mockReturnValue(Date.parse(release.expiresAt) + 1) : null
  try {
    await expect(execute(args(release))).rejects.toMatchObject({ details: { reason: 'OPERATOR_RELEASE_INVALID' } })
    expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
  } finally { clock?.mockRestore() }
})

test.each(['operator', 'request', 'page', 'pack', 'compatibility', 'qualification', 'scope', 'candidate'])('issuer refuses changed %s before writing', async kind => {
  const input = releaseArgs()
  if (kind === 'operator') seams.auth.mockResolvedValueOnce(copy(f.native)).mockResolvedValueOnce({ ...f.native, fingerprint: 'b'.repeat(64) })
  if (kind === 'request') input.expected.requestIdentity = 'f'.repeat(64)
  if (kind === 'page') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'compatibility') f.subject.binding.compatibilityReference.decisionFingerprint = 'f'.repeat(64)
  if (kind === 'qualification') f.subject.binding.compatibilityReference.mappingFingerprint = 'f'.repeat(64)
  if (kind === 'scope') f.subject.binding.masterReference.scope.tenantId = 'f'.repeat(24)
  if (kind === 'candidate') f.subject.binding.candidateId = corrected.subject.binding.candidateId
  await expect(issue(input)).rejects.toThrow()
  expect(f.Audit).toHaveLength(3); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test.each(['operator', 'page', 'pack', 'compatibility', 'runtime'])('pre-start %s change consumes no fake provider submission', async kind => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release))
  if (kind === 'operator') seams.operator.mockResolvedValue({ ...f.native, fingerprint: 'b'.repeat(64) })
  if (kind === 'page') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'compatibility') f.subject.binding.compatibilityReference.auditId = 'f'.repeat(24)
  if (kind === 'runtime') seams.runtime.mockImplementation(async () => ({ ...f.subject.binding.masterReference.scope, _id: g1.G1_FIXED.runtimeInstanceId, status: 'DRAFT' }))
  await expect(adapter()(prepared.capability)).rejects.toThrow()
  expect(f.Execution.some(r => r.executionEvidence?.masterDocxDispatch?.body.decision === 'START_ALLOWED')).toBe(false)
  expect(seams.fetch).not.toHaveBeenCalled()
})

test('approved factories reject overrides and old/QA adapters cannot consume the approved capability', async () => {
  for (const factory of [authority, adapter, store]) expect(() => factory({ fetchImpl: seams.fetch })).toThrow()
  const release = await issue(releaseArgs()), input = args(release), prepared = await authority().prepare(input)
  for (const wrong of [oldAdapter(), oldCategoryAdapter(), qaAdapter({ fetchImpl: seams.fetch })]) await expect(wrong(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(seams.fetch).not.toHaveBeenCalled()
  const output = await adapter()(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(output).genuineProviderEligible).toBe(true)
  await expect(adapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  await expect(store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: copy(output) })).rejects.toThrow()
  await expect(oldStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toThrow()
  await expect(qaStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
  expect(seams.fetch).toHaveBeenCalledTimes(1); expect(findingsCount()).toBe(0)
})

test('old authority prepare/read/revoke/recover and old store read/reconcile reject approved profile', async () => {
  const release = await issue(releaseArgs()), input = args(release)
  await expect(oldAuthority().prepare(input)).rejects.toThrow()
  const prepared = await authority().prepare(input)
  for (const operation of ['read', 'revoke', 'recover']) await expect(oldAuthority()[operation](grantRead())).rejects.toThrow()
  for (const operation of ['read', 'reconcile']) await expect(oldStore()[operation](grantRead())).rejects.toThrow()
  expect(f.Execution).toHaveLength(2); expect(findingsCount()).toBe(0); expect(seams.fetch).not.toHaveBeenCalled()
  await adapter()(prepared.capability)
})

test('approved authority/store and adapter reject old category records and capability before start', async () => {
  f.subject = copy(corrected.subject); f.request = copy(categoryRequest)
  const release = await oldCategoryIssue({ ...releaseArgs(), expected: copy(categoryRequest) })
  const input = { ...args(release), expected: copy(categoryRequest) }, prepared = await oldAuthority().prepare(input)
  await expect(authority().prepare(input)).rejects.toThrow()
  for (const operation of ['read', 'revoke', 'recover']) await expect(authority()[operation](grantRead())).rejects.toThrow()
  for (const operation of ['read', 'reconcile']) await expect(store()[operation](grantRead())).rejects.toThrow()
  await expect(adapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(f.Execution).toHaveLength(2); expect(seams.fetch).not.toHaveBeenCalled()
  expect(f.Execution.some(r => r.executionEvidence?.masterDocxDispatch?.body.decision === 'START_ALLOWED')).toBe(false)
  const output = await oldCategoryAdapter()(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(output).receipt.version).toBe('master-linked-docx-visual-review-receipt.v3')
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test.each(['missing', 'extra', 'duplicate', 'wrong-version', 'status', 'terminal'])('invalid %s response preserves consumed uncertainty and never resends', async kind => {
  const value = wire()
  if (kind === 'missing') delete value.findings.BRAND_EXPRESSION
  if (kind === 'extra') value.findings.EXTRA = value.findings.HEADINGS
  if (kind === 'wrong-version') value.schemaVersion = 'other'
  if (kind === 'status') value.overallStatus = 'FAIL'
  f.rawText = JSON.stringify(value)
  if (kind === 'duplicate') f.rawText = f.rawText.replace('"STATEMENTS":', '"HEADINGS":{"status":"PASS","finding":"duplicate","requiredChange":false},"STATEMENTS":')
  if (kind === 'terminal') f.terminalFailure = true
  const release = await issue(releaseArgs()), input = args(release)
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: kind === 'terminal' ? 'PROVIDER_TERMINAL_FAILURE' : 'PROVIDER_OUTPUT_INVALID' } })
  expect(await authority().read(grantRead())).toMatchObject({ genuineAttemptConsumed: true, submissionState: 'KNOWN_RESPONSE', receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(await execute(input)).toMatchObject({ state: 'COMPLETED_REVIEW_NOT_RECORDED', completionConfirmed: false })
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('fake provider timeout preserves uncertainty and never produces findings or a second submission', async () => {
  const release = await issue(releaseArgs()), input = args(release), realNow = Date.now()
  let elapsed = 0
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow + elapsed)
  seams.fetch.mockImplementation(async () => { elapsed = 300001; return response(JSON.stringify(wire()), 'queued') })
  try {
    await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_TIMEOUT' } })
    expect(await authority().read(grantRead())).toMatchObject({ genuineAttemptConsumed: true, receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
    await expect(execute(input)).rejects.toThrow()
    expect(seams.fetch).toHaveBeenCalledTimes(1); expect(findingsCount()).toBe(0); expect(f.Stage).toHaveLength(0)
  } finally { clock.mockRestore() }
})

test('polling uses one fake POST and one GET, preserving receipt4 and one result', async () => {
  f.poll = true
  const release = await issue(releaseArgs()); await execute(args(release))
  expect(seams.fetch.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET'])
  expect(f.Stage).toHaveLength(1); expect(f.Stage[0].renditionInputSnapshot.receipt.version).toBe('master-linked-docx-visual-review-receipt.v4')
})

test('stored candidate compatibility-reference mismatch blocks completed findings without another fetch', async () => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release)), output = await adapter()(prepared.capability)
  f.Candidate.body.masterBinding.compatibilityReference = { ...f.Candidate.body.masterBinding.compatibilityReference, decisionFingerprint: 'f'.repeat(64) }
  await expect(store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test.each(['Execution', 'Artifact', 'Stage'])('unit transaction simulation rejects %s failure without partial findings', async name => {
  f.recordAfterResponse = name
  const release = await issue(releaseArgs())
  await expect(execute(args(release))).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})
test.each(Object.values(g2.COMPLETED_REVIEW_ACTIONS))('unit transaction simulation rejects required %s audit failure', async action => {
  f.auditFault = action
  const release = await issue(releaseArgs())
  await expect(execute(args(release))).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
})
test('matching unit saved result recovers after callback limit with no extra writes or fake submission', async () => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release)), output = await adapter()(prepared.capability)
  const before = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length], end = jest.fn()
  Audit.db.startSession.mockImplementationOnce(async () => ({ endSession: end, withTransaction: async callback => { await callback(); await callback(); await callback() } }))
  const saved = await store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })
  expect(saved).toMatchObject({ completionConfirmed: true, idempotent: true })
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length].map((n, i) => n - before[i])).toEqual([1, 1, 1, 3])
  expect(end).toHaveBeenCalledTimes(1); expect(seams.fetch).toHaveBeenCalledTimes(1)
})
test('missing index rejects before preparing a source or allocating a root', async () => {
  const release = await issue(releaseArgs()), prepared = seams.prepare.mock.calls.length
  f.missingIndex = 'Stage'
  await expect(execute(args(release))).rejects.toMatchObject({ details: { reason: 'COMPLETION_INDEX_UNAVAILABLE' } })
  expect(seams.prepare).toHaveBeenCalledTimes(prepared); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})
test('approved v6 stage has its own exact version/key exclusion from the original chain', () => {
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.GENUINE, expected)
  expect(originalOutcomeQualityStageFilter({}).$and[1].$nor).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', profile.stageVersion] }, { $eq: ['$stageKey', profile.stageKey] }] } })
  expect(g2.completedReviewProfile(f.subject, g1.G1_MODES.QA, expected)).toEqual({
    version: 'master-linked-docx-review-result.v7', artifactVersion: 'master-linked-docx-review-artifact.v7',
    stageVersion: 'master-linked-docx-rendition-stage.v7', stageKey: 'MASTER_LINKED_APPROVED_RENDITION_RL_QA',
    providerConfigurationVersion: 'MASTER_LINKED_DOCX_APPROVED_QA_V1',
  })
})
test.each(['version', 'stage', 'configuration'])('stage validation rejects crossed approved %s identity', async kind => {
  const release = await issue(releaseArgs()); await execute(args(release))
  const changed = copy(f.Stage[0])
  if (kind === 'version') changed.contractVersion = 'master-linked-docx-rendition-stage.v5'
  if (kind === 'stage') changed.stageKey = 'MASTER_LINKED_CATEGORY_RENDITION_RL'
  if (kind === 'configuration') changed.executionIdentity.providerConfigurationVersion = 'MASTER_LINKED_DOCX_CATEGORY_GENUINE_V1'
  await expect(new Stage(changed).validate()).rejects.toThrow()
})
const containsMarker = (value, marker) => value instanceof RegExp ? value.test(marker)
  : value === marker || value && typeof value === 'object' && Object.values(value).some(v => containsMarker(v, marker))
test.each([[Execution, 'SS055_APPROVED_GENUINE_DOCX:held'], [Artifact, 'master-linked-docx-review-artifact.v6'], [Stage, 'master-linked-docx-rendition-stage.v6']])('model protects approved marker on $modelName', async (Model, marker) => {
  const query = value => { const q = Promise.resolve(value); q.session = () => q; return q }, exists = Model.exists
  exists.mockClear().mockImplementation(() => query({ _id: 'a'.repeat(24) }))
  const update = jest.spyOn(Model.collection, 'updateOne').mockResolvedValue({ acknowledged: true }), bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
  try {
    await expect(Model.updateOne({ _id: 'a'.repeat(24) }, { $set: { warnings: [] } })).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
    if (Model !== Stage) expect(containsMarker(exists.mock.calls[0][0], marker)).toBe(true)
    exists.mockImplementation(() => query(null)); await Model.bulkWrite([{ deleteOne: { filter: { _id: 'a'.repeat(24) } } }])
    expect(containsMarker(bulk.mock.calls[0][0][0].deleteOne.filter, marker)).toBe(true)
  } finally { update.mockRestore(); bulk.mockRestore(); exists.mockImplementation(() => query(null)) }
})
