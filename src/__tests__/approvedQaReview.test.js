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

// QA owners are real zero-override factories. Operator, source, serializer and
// model/session fixtures are explicit unit seams, not actual admission, saved
// files, signatures of historical evidence or database transaction proof.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedGenuineReviewSubject.json', import.meta.url)))
const corrected = JSON.parse(fs.readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
const oldCategoryRequest = JSON.parse(fs.readFileSync(new URL('./fixtures/categoryReviewRequest.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value)), expected = metadata.request, qaCase = 'ss055-release-proof-approved-qa-unit'
const previousFetch = globalThis.fetch, previousKeys = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OUTCOME_STUDIO_PROVIDER_API_KEY: process.env.OUTCOME_STUDIO_PROVIDER_API_KEY }
const realProvider = jest.fn(async () => { throw Error('REAL_PROVIDER_FORBIDDEN') })
globalThis.fetch = realProvider
delete process.env.OPENAI_API_KEY; delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
const traps = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
traps.forEach(trap => trap.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') }))
const g1 = await import('../services/masterLinkedGenuineReviewContract.js'), g2 = await import('../services/masterLinkedCompletedReviewContract.js')
const { issueApprovedNetworkQaMasterLinkedReviewRelease: issue, issueApprovedGenuineMasterLinkedReviewRelease: genuineIssue,
  issueCategoryNetworkQaMasterLinkedReviewRelease: oldIssue } = await import('../services/masterLinkedReviewReleaseService.js')
const { createApprovedNetworkQaMasterLinkedReviewAuthority: authority, createApprovedGenuineMasterLinkedReviewAuthority: genuineAuthority,
  createNetworkQaMasterLinkedReviewAuthority: oldAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createFakeNetworkApprovedMasterLinkedDocxReviewProviderAdapter: adapter, createFakeNetworkMasterLinkedCategoryReviewProviderAdapter: oldAdapter,
  createFakeNetworkMasterLinkedDocxReviewProviderAdapter: legacyAdapter, createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter: genuineAdapter,
  createOpenAiMasterLinkedCategoryDocxReviewProviderAdapter: oldGenuineAdapter, snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createApprovedNetworkQaMasterLinkedCompletedReviewStore: store, createApprovedGenuineMasterLinkedCompletedReviewStore: genuineStore,
  createNetworkQaMasterLinkedCompletedReviewStore: oldStore } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeApprovedNetworkQaMasterLinkedReview: execute } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const { originalOutcomeQualityStageFilter } = await import('../utils/outcomeQualityStageSubjects.js')
const harness = installCorrectedGenuineModelSeams(metadata)
let f, fetchImpl
const wire = (status = 'PASS') => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: status, findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(d => [d,
    { status: d === 'QUALIFICATION' ? status : 'PASS', finding: 'Synthetic approved-expression QA evidence only.', requiredChange: d === 'QUALIFICATION' && status === 'FAIL' }])) })
const response = (text, status = 'completed') => new Response(JSON.stringify({ id: 'resp_approved_qa_unit', status, model: 'gpt-5.2',
  output: status === 'completed' ? [{ type: 'message', content: [{ type: 'output_text', text }] }] : [] }), { headers: { 'x-request-id': 'req_approved_qa_unit' } })
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NO_NATIVE_TOKEN', approvalReference: 'Synthetic approved-expression QA only; not a genuine review release.', expected: copy(expected), qaCase })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: f.subject.binding.masterReference.scope.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(expected), qaCase, qaReleaseAuditId: release.approvalAuditId })
const grantRead = () => ({ actorUserId: f.subject.actorUserId, scopes: {},
  grantExecutionId: f.Execution.find(row => row.executionEvidence?.masterDocxDispatch?.body.phase === 'GRANT').executionId })
const row = release => f.Audit.find(audit => String(audit._id) === release.approvalAuditId)
const sign = audit => { const model = new Audit(audit); model.generateSignature(); return model.toObject() }
const findingsCount = () => f.Execution.filter(record => record.outputTypeKey === g2.COMPLETED_REVIEW_OUTPUT).length
beforeEach(() => {
  f = harness.reset()
  for (const key of ['rawText', 'poll', 'recordAfterResponse']) delete f[key]
  const prepare = seams.prepare.getMockImplementation()
  seams.prepare.mockImplementation(async input => ({ ...await prepare(input), categoryRequest: copy(oldCategoryRequest) }))
  fetchImpl = jest.fn(async (_url, options) => {
    expect(options.headers.Authorization).toBe('Bearer SS055_FAKE_NETWORK_ONLY')
    if (f.recordAfterResponse) f.recordFault = f.recordAfterResponse
    return response(f.rawText ?? JSON.stringify(wire(f.failed ? 'FAIL' : 'PASS')), f.poll && options.method === 'POST' ? 'queued' : 'completed')
  })
})
afterAll(() => {
  traps.forEach(trap => expect(trap).not.toHaveBeenCalled()); expect(realProvider).not.toHaveBeenCalled(); expect(seams.fetch).not.toHaveBeenCalled()
  harness.restoreName(); jest.restoreAllMocks(); globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(previousKeys)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

test('QA release freezes native identity, case and request in a disjoint non-genuine root', async () => {
  const genuineRoot = g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE), release = await issue(releaseArgs()), audit = row(release)
  const diff = g1.assertG1QaRelease(audit, f.subject, expected, a => Audit.prototype.verifySignature.call(a), Date.now(), qaCase)
  expect(audit.action).toBe(g1.G1_APPROVED_QA_RELEASE.action)
  expect(diff).toMatchObject({ version: g1.G1_APPROVED_QA_RELEASE.version, qaCase, genuineReviewEligible: false, maximumAttempts: 1,
    customerApproval: false, productionUse: false, automaticFinalisation: false, operatorAuthority: f.native, requestBinding: expected })
  expect(diff.onceRoot).toMatch(/^SS055_APPROVED_NETWORK_QA_DOCX:/); expect(diff.onceRoot).not.toBe(genuineRoot)
  expect(g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE)).toBe(genuineRoot)
  expect(g2.completedReviewProfile(f.subject, g1.G1_MODES.GENUINE, expected).version).toBe('master-linked-docx-review-result.v6')
  expect(g2.completedReviewFamily(diff.onceRoot).result).not.toEqual(g2.completedReviewFamily(genuineRoot).result)
  const count = f.Audit.length
  expect((await issue(releaseArgs())).approvalAuditId).toBe(release.approvalAuditId); expect(f.Audit).toHaveLength(count)
  await expect(issue({ ...releaseArgs(), approvalReference: 'Another unit reference' })).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled(); expect(f.Execution).toHaveLength(0)
})

test.each(['PASS', 'FAIL'])('QA7 fake %s persists, reads and replays once with genuine eligibility false', async status => {
  f.failed = status === 'FAIL'
  const release = await issue(releaseArgs()), input = args(release), saved = await execute(input, fetchImpl)
  expect(saved).toMatchObject({ mode: g1.G1_MODES.QA, reviewStatus: status, completionConfirmed: true, genuineReviewUsed: false,
    approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(saved.findings.findings.map(finding => finding.dimension)).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  expect(f.Stage[0]).toMatchObject({ contractVersion: 'master-linked-docx-rendition-stage.v7', stageKey: 'MASTER_LINKED_APPROVED_RENDITION_RL_QA',
    executionIdentity: { providerConfigurationVersion: 'MASTER_LINKED_DOCX_APPROVED_QA_V1', executionMode: 'DETERMINISTIC_TEST' } })
  const snapshot = f.Stage[0].renditionInputSnapshot
  expect(snapshot.version).toBe(g2.APPROVED_QA_COMPLETED_REVIEW_VERSION)
  expect(snapshot.receipt).toMatchObject({ version: 'master-linked-docx-visual-review-receipt.v4', requestVersion: 'master-linked-docx-visual-review-request.v4', mode: g1.G1_MODES.QA })
  expect(snapshot.subject.binding.compatibilityReference).toEqual(metadata.subject.binding.compatibilityReference)
  expect(f.Artifact[0].contractVersion).toBe(g2.APPROVED_QA_COMPLETED_ARTIFACT_VERSION)
  expect(f.Execution.every(record => record.providerMode === 'DETERMINISTIC_TEST' && record.provider.provenance === 'NETWORK_QA')).toBe(true)
  expect(await store().read(grantRead())).toEqual(await store().reconcile(grantRead()))
  const count = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await execute(input, fetchImpl)).resultFingerprint).toBe(saved.resultFingerprint)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(count)
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0][1].body).toBe('{"hermeticApprovedProtocolOnly":true}')
  if (status === 'FAIL') expect(f.Stage[0].failure.retryable).toBe(false)
})

test.each(['missing', 'signature', 'genuine', 'old QA', 'expiry', 'qaCase', 'operator'])('QA7 refuses %s release without grant or fake submission', async kind => {
  let release = await issue(releaseArgs()); const audit = row(release)
  if (kind === 'missing') f.Audit.splice(f.Audit.indexOf(audit), 1)
  if (kind === 'signature') audit.diff.approvalReference += '-tampered'
  if (kind === 'genuine') release = await genuineIssue({ authorization: releaseArgs().authorization, approvalReference: 'Unit genuine profile only.', expected: copy(expected) })
  if (kind === 'old QA') { audit.action = g1.G1_CATEGORY_QA_RELEASE.action; audit.diff.version = g1.G1_CATEGORY_QA_RELEASE.version; Object.assign(audit, sign(audit)) }
  if (kind === 'qaCase') { audit.diff.qaCase += '-changed'; Object.assign(audit, sign(audit)) }
  if (kind === 'operator') seams.operator.mockResolvedValue({ ...f.native, fingerprint: 'b'.repeat(64) })
  const clock = kind === 'expiry' ? jest.spyOn(Date, 'now').mockReturnValue(Date.parse(release.expiresAt) + 1) : null
  try {
    await expect(execute(args(release), fetchImpl)).rejects.toThrow()
    expect(f.Execution).toHaveLength(0); expect(fetchImpl).not.toHaveBeenCalled()
  } finally { clock?.mockRestore() }
})

test.each(['', 'other-case', 'ss055-release-proof-' + 'a'.repeat(43)])('QA issuer rejects malformed case %s before writes', async invalidCase => {
  await expect(issue({ ...releaseArgs(), qaCase: invalidCase })).rejects.toMatchObject({ details: { reason: 'QA_RELEASE_CASE' } })
  expect(f.Audit).toHaveLength(3); expect(fetchImpl).not.toHaveBeenCalled()
})

test.each(['request', 'page', 'pack', 'compatibility'])('QA issuer rejects changed %s without recording permission', async kind => {
  const input = releaseArgs()
  if (kind === 'request') input.expected.requestIdentity = 'f'.repeat(64)
  if (kind === 'page') f.subject.binding.pages[0].sha256 = 'f'.repeat(64)
  if (kind === 'pack') f.subject.packs.STYLE.contentHash = 'sha256:' + 'f'.repeat(64)
  if (kind === 'compatibility') f.subject.binding.compatibilityReference.decisionFingerprint = 'f'.repeat(64)
  await expect(issue(input)).rejects.toThrow(); expect(f.Audit).toHaveLength(3); expect(fetchImpl).not.toHaveBeenCalled()
})

test.each(['operator', 'source', 'compatibility'])('pre-start %s drift prevents QA submission', async kind => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release))
  if (kind === 'operator') seams.operator.mockResolvedValue({ ...f.native, fingerprint: 'b'.repeat(64) })
  if (kind === 'source') f.subject.binding.sourceFingerprint = 'f'.repeat(64)
  if (kind === 'compatibility') f.subject.binding.compatibilityReference.auditId = 'f'.repeat(24)
  await expect(adapter({ fetchImpl })(prepared.capability)).rejects.toThrow()
  expect(f.Execution.some(record => record.executionEvidence?.masterDocxDispatch?.body.decision === 'START_ALLOWED')).toBe(false)
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('new QA factories prohibit source/storage overrides and adapter evaluates no getters', () => {
  for (const factory of [authority, store]) expect(() => factory({})).toThrow()
  for (const key of ['now', 'sleep', 'source', 'store', 'deps']) expect(() => adapter({ fetchImpl, [key]: () => {} })).toThrow()
  let evaluated = 0
  const getter = Object.defineProperty({}, 'fetchImpl', { enumerable: true, get() { evaluated++; return fetchImpl } })
  expect(() => adapter(getter)).toThrow(); expect(evaluated).toBe(0)
  expect(() => adapter()).toThrow(); expect(() => adapter({ fetchImpl: null })).toThrow()
})

test('genuine and old QA adapters reject new QA capability without consuming it', async () => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release))
  for (const wrong of [genuineAdapter(), oldGenuineAdapter(), oldAdapter({ fetchImpl }), legacyAdapter({ fetchImpl })]) {
    await expect(wrong(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  }
  expect(fetchImpl).not.toHaveBeenCalled(); expect(f.Execution).toHaveLength(2)
  const output = await adapter({ fetchImpl })(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(output).genuineProviderEligible).toBe(false)
  await expect(adapter({ fetchImpl })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  const input = { actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output }
  await expect(genuineStore().persist(input)).rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
  await expect(oldStore().persist(input)).rejects.toThrow()
  await expect(store().persist({ ...input, providerResult: copy(output) })).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('genuine and old QA authorities/stores cannot load new QA records', async () => {
  const release = await issue(releaseArgs()), input = args(release), prepared = await authority().prepare(input)
  const genuineInput = { actorUserId: input.actorUserId, candidateId: input.candidateId, runtimeInstanceId: input.runtimeInstanceId,
    scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId }
  await expect(genuineAuthority().prepare(genuineInput)).rejects.toThrow()
  await expect(oldAuthority().prepare(input)).rejects.toThrow()
  for (const wrong of [genuineAuthority(), oldAuthority()]) for (const operation of ['read', 'revoke', 'recover']) await expect(wrong[operation](grantRead())).rejects.toThrow()
  for (const wrong of [genuineStore(), oldStore()]) for (const operation of ['read', 'reconcile']) await expect(wrong[operation](grantRead())).rejects.toThrow()
  expect(f.Execution).toHaveLength(2); expect(fetchImpl).not.toHaveBeenCalled()
  await adapter({ fetchImpl })(prepared.capability)
})

test('new QA owner and adapter reject genuine v6 grant/capability before start', async () => {
  const release = await genuineIssue({ authorization: releaseArgs().authorization, approvalReference: 'Synthetic genuine permission profile only.', expected: copy(expected) })
  const input = { actorUserId: f.subject.actorUserId, candidateId: f.subject.binding.candidateId, runtimeInstanceId: g1.G1_FIXED.runtimeInstanceId,
    scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId }, prepared = await genuineAuthority().prepare(input)
  for (const operation of ['read', 'revoke', 'recover']) await expect(authority()[operation](grantRead())).rejects.toThrow()
  for (const operation of ['read', 'reconcile']) await expect(store()[operation](grantRead())).rejects.toThrow()
  await expect(adapter({ fetchImpl })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(f.Execution).toHaveLength(2); expect(fetchImpl).not.toHaveBeenCalled(); expect(realProvider).not.toHaveBeenCalled()
})

test('new QA owner/store/adapter reject old QA records without consuming the old capability', async () => {
  f.subject = copy(corrected.subject); f.request = copy(oldCategoryRequest)
  const release = await oldIssue({ ...releaseArgs(), expected: copy(oldCategoryRequest) })
  const input = { ...args(release), expected: copy(oldCategoryRequest) }, prepared = await oldAuthority().prepare(input)
  for (const operation of ['read', 'revoke', 'recover']) await expect(authority()[operation](grantRead())).rejects.toThrow()
  for (const operation of ['read', 'reconcile']) await expect(store()[operation](grantRead())).rejects.toThrow()
  await expect(adapter({ fetchImpl })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(fetchImpl).not.toHaveBeenCalled(); expect(f.Execution).toHaveLength(2)
  const output = await oldAdapter({ fetchImpl })(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(output).receipt.version).toBe('master-linked-docx-visual-review-receipt.v3')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test.each(['missing category', 'status conflict'])('invalid QA response %s preserves uncertainty and cannot resubmit', async kind => {
  const value = wire()
  if (kind === 'missing category') delete value.findings.BRAND_EXPRESSION
  else value.overallStatus = 'FAIL'
  f.rawText = JSON.stringify(value)
  const release = await issue(releaseArgs()), input = args(release)
  await expect(execute(input, fetchImpl)).rejects.toMatchObject({ details: { reason: 'PROVIDER_OUTPUT_INVALID' } })
  expect(await authority().read(grantRead())).toMatchObject({ mode: g1.G1_MODES.QA, genuineAttemptConsumed: false,
    receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
  expect((await execute(input, fetchImpl)).completionConfirmed).toBe(false)
  expect(findingsCount()).toBe(0); expect(f.Stage).toHaveLength(0); expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('QA fake-provider timeout preserves a held result and never calls the real provider', async () => {
  const release = await issue(releaseArgs()), input = args(release), now = Date.now()
  let elapsed = 0
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now + elapsed)
  fetchImpl.mockImplementation(async () => { elapsed = 300001; return response(JSON.stringify(wire()), 'queued') })
  try {
    await expect(execute(input, fetchImpl)).rejects.toMatchObject({ details: { reason: 'PROVIDER_TIMEOUT' } })
    expect(await authority().read(grantRead())).toMatchObject({ mode: g1.G1_MODES.QA, genuineAttemptConsumed: false,
      receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
    await expect(execute(input, fetchImpl)).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(findingsCount()).toBe(0); expect(f.Stage).toHaveLength(0)
  } finally { clock.mockRestore() }
})

test('QA polling uses only injected fake fetch and emits a QA receipt4', async () => {
  f.poll = true
  const release = await issue(releaseArgs()); await execute(args(release), fetchImpl)
  expect(fetchImpl.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET'])
  expect(f.Stage[0].renditionInputSnapshot.receipt).toMatchObject({ version: 'master-linked-docx-visual-review-receipt.v4', mode: g1.G1_MODES.QA })
})

test('signed-source compatibility-reference drift blocks QA7 findings storage', async () => {
  const release = await issue(releaseArgs()), prepared = await authority().prepare(args(release)), output = await adapter({ fetchImpl })(prepared.capability)
  f.Candidate.body.masterBinding.compatibilityReference = { ...f.Candidate.body.masterBinding.compatibilityReference, decisionFingerprint: 'f'.repeat(64) }
  await expect(store().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: output })).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test.each(['Execution', 'Artifact', 'Stage'])('unit QA transaction simulation leaves no partial bundle after %s failure', async name => {
  f.recordAfterResponse = name
  const release = await issue(releaseArgs()); await expect(execute(args(release), fetchImpl)).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test.each(Object.values(g2.COMPLETED_REVIEW_ACTIONS))('unit QA transaction simulation rejects required %s audit failure', async action => {
  f.auditFault = action
  const release = await issue(releaseArgs()); await expect(execute(args(release), fetchImpl)).rejects.toThrow()
  expect(findingsCount()).toBe(0); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
})
test('missing QA stage index holds before preparation or a new root', async () => {
  const release = await issue(releaseArgs()), prepared = seams.prepare.mock.calls.length
  f.missingIndex = 'Stage'
  await expect(execute(args(release), fetchImpl)).rejects.toMatchObject({ details: { reason: 'COMPLETION_INDEX_UNAVAILABLE' } })
  expect(seams.prepare).toHaveBeenCalledTimes(prepared); expect(f.Execution).toHaveLength(0); expect(fetchImpl).not.toHaveBeenCalled()
})

test('QA7 is exactly the ninth original-chain exclusion and GEN6 stays distinct', () => {
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.QA, expected), genuine = g2.completedReviewProfile(f.subject, g1.G1_MODES.GENUINE, expected)
  expect(profile).toMatchObject({ version: 'master-linked-docx-review-result.v7', artifactVersion: 'master-linked-docx-review-artifact.v7',
    stageVersion: 'master-linked-docx-rendition-stage.v7', stageKey: 'MASTER_LINKED_APPROVED_RENDITION_RL_QA' })
  expect(genuine).toMatchObject({ version: 'master-linked-docx-review-result.v6', artifactVersion: 'master-linked-docx-review-artifact.v6',
    stageVersion: 'master-linked-docx-rendition-stage.v6', stageKey: 'MASTER_LINKED_APPROVED_RENDITION_RL' })
  const exclusions = originalOutcomeQualityStageFilter({}).$and[1].$nor
  expect(exclusions).toHaveLength(9)
  expect(exclusions).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', profile.stageVersion] }, { $eq: ['$stageKey', profile.stageKey] }] } })
  expect(exclusions.every(value => value.$expr.$and.length === 2)).toBe(true)
})
test.each(['stage key', 'configuration'])('QA stage rejects crossed genuine %s', async kind => {
  const release = await issue(releaseArgs()); await execute(args(release), fetchImpl)
  const changed = copy(f.Stage[0])
  if (kind === 'stage key') changed.stageKey = 'MASTER_LINKED_APPROVED_RENDITION_RL'
  else changed.executionIdentity.providerConfigurationVersion = 'MASTER_LINKED_DOCX_APPROVED_GENUINE_V1'
  await expect(new Stage(changed).validate()).rejects.toThrow()
})
const containsMarker = (value, marker) => value instanceof RegExp ? value.test(marker)
  : value === marker || value && typeof value === 'object' && Object.values(value).some(v => containsMarker(v, marker))
test.each([[Execution, 'SS055_APPROVED_NETWORK_QA_DOCX:unit'], [Artifact, 'master-linked-docx-review-artifact.v7'], [Stage, 'master-linked-docx-rendition-stage.v7']])('ODM protects stored QA7 marker on $modelName', async (Model, marker) => {
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
