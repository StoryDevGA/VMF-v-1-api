import fs from 'node:fs'
import { jest, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { installCorrectedGenuineModelSeams, correctedGenuineSeams as seams } from './fixtures/correctedGenuineReviewFixture.js'
import { MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'

const { issueCategoryNetworkQaMasterLinkedReviewRelease, issueCorrectedNetworkQaMasterLinkedReviewRelease } = await import('../services/masterLinkedReviewReleaseService.js')
const { executeCategoryNetworkQaMasterLinkedReview } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const { createNetworkQaMasterLinkedReviewAuthority, createGenuineMasterLinkedReviewAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createFakeNetworkMasterLinkedCategoryReviewProviderAdapter, createFakeNetworkMasterLinkedDocxReviewProviderAdapter,
  createOpenAiMasterLinkedDocxReviewProviderAdapter, snapshotOwnedMasterLinkedReviewResult } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createNetworkQaMasterLinkedCompletedReviewStore, createGenuineMasterLinkedCompletedReviewStore } = await import('../services/masterLinkedCompletedReviewService.js')
const g1 = await import('../services/masterLinkedGenuineReviewContract.js'), g2 = await import('../services/masterLinkedCompletedReviewContract.js')
const { default: Execution } = await import('../models/GovernedReasoningExecution.js')
const { default: Artifact } = await import('../models/GovernedRuntimeArtifact.js')
const { default: Stage } = await import('../models/OutcomeQualityStageExecution.js')
const { originalOutcomeQualityStageFilter } = await import('../utils/outcomeQualityStageSubjects.js')
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/categoryReviewRequest.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value)), qaCase = 'ss055-release-proof-category-unit'
let harness, f
beforeAll(() => { harness = installCorrectedGenuineModelSeams() })
beforeEach(() => {
  f = harness.reset()
  const prepare = seams.prepare.getMockImplementation()
  seams.prepare.mockImplementation(async args => ({ ...await prepare(args), categoryRequest: copy(expected) }))
})
afterAll(() => { harness.restoreName(); jest.restoreAllMocks() })
const releaseArgs = () => ({ authorization: 'Bearer synthetic-category-only', approvalReference: 'Synthetic unit QA permission only.', expected, qaCase })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: f.subject.binding.masterReference.scope.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected, qaCase, qaReleaseAuditId: release.approvalAuditId })
const wire = (status = 'PASS') => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: status, findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(d => [d,
    { status: d === 'STATEMENTS' ? status : 'PASS', finding: 'Simulated category protocol evidence only.', requiredChange: d === 'STATEMENTS' && status === 'FAIL' }])) })
const response = text => new Response(JSON.stringify({ id: 'resp_category_qa_unit', status: 'completed', model: 'gpt-5.2',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { headers: { 'x-request-id': 'req_category_qa_unit' } })
const fake = text => jest.fn(async (_url, options) => { expect(options.method).toBe('POST'); return response(text) })

test.each(['PASS', 'FAIL'])('runner stores complete simulated %s with separate release, v4 family and read-back', async status => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs()), fetchImpl = fake(JSON.stringify(wire(status)))
  const saved = await executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)
  expect(saved).toMatchObject({ mode: 'NETWORK_SIMULATED', completionConfirmed: true, genuineReviewUsed: false,
    reviewStatus: status, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(saved.findings.findings.map(v => v.dimension)).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  const grant = f.Execution.find(row => row.executionEvidence.masterDocxDispatch?.body.phase === 'GRANT')
  expect(grant.idempotencyKey).toMatch(/^SS055_CATEGORY_NETWORK_QA_DOCX:/)
  const read = { actorUserId: f.subject.actorUserId, scopes: {}, grantExecutionId: grant.executionId }, store = createNetworkQaMasterLinkedCompletedReviewStore()
  expect(await store.read(read)).toEqual(await store.reconcile(read))
  expect((await store.read(read)).resultFingerprint).toBe(saved.resultFingerprint)
  expect((await executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)).resultFingerprint).toBe(saved.resultFingerprint)
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(f.Execution).toHaveLength(4); expect(f.Artifact).toHaveLength(1); expect(f.Stage).toHaveLength(1)
  expect(f.Stage[0]).toMatchObject({ contractVersion: 'master-linked-docx-rendition-stage.v4', stageKey: 'MASTER_LINKED_CATEGORY_RENDITION_RL_QA',
    executionIdentity: { providerConfigurationVersion: 'MASTER_LINKED_DOCX_CATEGORY_QA_V1' } })
  const result = f.Execution.find(row => row.contractVersion === g2.CATEGORY_COMPLETED_REVIEW_VERSION)
  expect(result.executionEvidence.masterLinkedCompletedReview.body.input.receipt).toMatchObject({
    version: 'master-linked-docx-visual-review-receipt.v3', requestVersion: 'master-linked-docx-visual-review-request.v3', responseVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION })
  const signed = f.Audit.find(a => a.action === g1.G1_CATEGORY_QA_RELEASE.action)
  expect(signed.diff).toMatchObject({ version: g1.G1_CATEGORY_QA_RELEASE.version, maximumAttempts: 1, genuineReviewEligible: false, customerApproval: false })
})

test.each(['missing', 'duplicate', 'extra', 'status', 'old wire'])('malformed %s response preserves held uncertainty and never resends', async kind => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs()), value = wire()
  if (kind === 'missing') delete value.findings.BRAND_EXPRESSION
  if (kind === 'extra') value.findings.EXTRA = value.findings.STATEMENTS
  if (kind === 'status') value.overallStatus = 'FAIL'
  if (kind === 'old wire') value.findings = RENDERED_EXPRESSION_RL_DIMENSIONS.map(d => ({ dimension: d, ...value.findings[d] }))
  let text = JSON.stringify(value); if (kind === 'duplicate') text = text.replace('"findings":{', '"findings":{"STATEMENTS":{},')
  const fetchImpl = fake(text)
  await expect(executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)).rejects.toMatchObject({ details: { reason: 'PROVIDER_OUTPUT_INVALID' } })
  expect(f.Execution).toHaveLength(3); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(f.Audit.some(a => a.action === g1.G1_ACTIONS.UNCERTAINTY)).toBe(true)
  expect((await executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)).completionConfirmed).toBe(false)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('wrong genuine and legacy adapters refuse category capability before consuming it', async () => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs()), prepared = await createNetworkQaMasterLinkedReviewAuthority().prepare(args(release)), fetchImpl = fake(JSON.stringify(wire()))
  await expect(createOpenAiMasterLinkedDocxReviewProviderAdapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  await expect(createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(f.Execution).toHaveLength(2); expect(fetchImpl).not.toHaveBeenCalled()
  const owned = await createFakeNetworkMasterLinkedCategoryReviewProviderAdapter({ fetchImpl })(prepared.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(owned).genuineProviderEligible).toBe(false)
  const before = f.Audit.length
  await expect(createGenuineMasterLinkedCompletedReviewStore().persist({ actorUserId: f.subject.actorUserId, scopes: {}, providerResult: owned })).rejects.toMatchObject({ details: { reason: 'COMPLETION_MODE_MISMATCH' } })
  expect(f.Audit).toHaveLength(before)
})

test('category adapter refuses an old QA capability without consuming it', async () => {
  const oldExpected = copy(f.request), release = await issueCorrectedNetworkQaMasterLinkedReviewRelease({ ...releaseArgs(), expected: oldExpected }), input = { ...args(release), expected: oldExpected }
  const prepared = await createNetworkQaMasterLinkedReviewAuthority().prepare(input), categoryFetch = fake(JSON.stringify(wire()))
  await expect(createFakeNetworkMasterLinkedCategoryReviewProviderAdapter({ fetchImpl: categoryFetch })(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect(f.Execution).toHaveLength(2); expect(categoryFetch).not.toHaveBeenCalled()
  await expect(createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: seams.fetch })(prepared.capability)).resolves.toHaveProperty('output.overallStatus', 'PASS')
})

test('new request needs its mode-specific release; old release and changed request cannot admit it', async () => {
  expect(expected).toEqual(g1.G1_CATEGORY_QA_REQUEST)
  expect(g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE)).toMatch(/^SS055_CATEGORY_GENUINE_DOCX:/)
  expect(g2.completedReviewProfile(f.subject, g1.G1_MODES.GENUINE, expected).version).toBe(g2.CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION)
  await expect(createGenuineMasterLinkedReviewAuthority().prepare({ ...args({ approvalAuditId: 'a'.repeat(24) }), approvalAuditId: 'a'.repeat(24), qaReleaseAuditId: undefined })).rejects.toMatchObject({ details: { reason: 'OPERATOR_RELEASE_INVALID' } })
  const old = await issueCorrectedNetworkQaMasterLinkedReviewRelease({ ...releaseArgs(), expected: f.request })
  await expect(executeCategoryNetworkQaMasterLinkedReview(args(old), fake(JSON.stringify(wire())))).rejects.toThrow()
  const changed = { ...expected, requestIdentity: 'f'.repeat(64) }
  await expect(issueCategoryNetworkQaMasterLinkedReviewRelease({ ...releaseArgs(), expected: changed })).rejects.toThrow()
  expect(f.Execution).toHaveLength(0)
})

test.each(['audit', 'record'])('required completed %s failure leaves no bundle and does not resubmit', async kind => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs()), fetchImpl = fake(JSON.stringify(wire()))
  if (kind === 'audit') f.auditFault = 'MASTER_LINKED_DOCX_FINDINGS_RECORDED'
  else f.recordFault = 'Stage'
  await expect(executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)).rejects.toThrow()
  expect(f.Execution).toHaveLength(3); expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0)
  expect(f.Audit.filter(a => Object.values(g2.COMPLETED_REVIEW_ACTIONS).includes(a.action))).toHaveLength(0)
  expect((await executeCategoryNetworkQaMasterLinkedReview(args(release), fetchImpl)).completionConfirmed).toBe(false)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test.each(['actor', 'runtime', 'candidate', 'request', 'case', 'release', 'override'])('runner refuses changed %s before any fake submission', async kind => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs()), input = args(release), fetchImpl = fake(JSON.stringify(wire()))
  if (kind === 'actor') input.actorUserId = 'a'.repeat(24)
  if (kind === 'runtime') input.runtimeInstanceId = 'a'.repeat(24)
  if (kind === 'candidate') input.candidateId = g1.G1_FIXED.candidateId
  if (kind === 'request') input.expected = { ...expected, requestIdentity: 'f'.repeat(64) }
  if (kind === 'case') input.qaCase = 'ss055-release-proof-another'
  if (kind === 'release') input.qaReleaseAuditId = 'a'.repeat(24)
  if (kind === 'override') input.deps = {}
  await expect(executeCategoryNetworkQaMasterLinkedReview(input, fetchImpl)).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled(); expect(f.Execution).toHaveLength(0)
})

test.each(['response version', 'request version', 'legacy receipt', 'receipt mode', 'input mode', 'root', 'source approval flag'])('new stored input refuses changed %s', async kind => {
  const release = await issueCategoryNetworkQaMasterLinkedReviewRelease(releaseArgs())
  await executeCategoryNetworkQaMasterLinkedReview(args(release), fake(JSON.stringify(wire())))
  const result = f.Execution.find(row => row.contractVersion === g2.CATEGORY_COMPLETED_REVIEW_VERSION), input = copy(result.executionEvidence.masterLinkedCompletedReview.body.input)
  if (kind === 'response version') input.receipt.responseVersion = 'other'
  if (kind === 'request version') delete input.receipt.requestVersion
  if (kind === 'legacy receipt') input.receipt.version = 'master-linked-docx-visual-review-receipt.v2'
  if (kind === 'receipt mode') input.receipt.mode = g1.G1_MODES.GENUINE
  if (kind === 'input mode') input.mode = g1.G1_MODES.GENUINE
  if (kind === 'root') input.onceRoot = g1.g1SubjectRoot(f.subject, f.request, g1.G1_MODES.QA, qaCase)
  if (kind === 'source approval flag') input.subject.policy.authorisesApproval = true
  expect(() => g2.assertCompletedReviewInput(input)).toThrow()
})

test('v4 stage belongs beside original quality chain and result/artifact/stage identity guards reserve it', () => {
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.QA, expected)
  expect(g2.hasCompletedStageIdentity({ contractVersion: profile.stageVersion })).toBe(true)
  expect(g2.hasCompletedArtifactIdentity({ contractVersion: profile.artifactVersion })).toBe(true)
  expect(g2.hasCompletedReviewIdentity({ contractVersion: profile.version })).toBe(true)
  const rows = originalOutcomeQualityStageFilter({}).$and[1].$nor
  expect(rows).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', profile.stageVersion] }, { $eq: ['$stageKey', profile.stageKey] }] } })
})

test.each(['prefix', 'result version', 'artifact version', 'stage version'])('ODM atomic mutation blocks reserved category %s', async kind => {
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.QA, expected), Native = kind === 'artifact version' ? Artifact : kind === 'stage version' ? Stage : Execution
  const changes = kind === 'prefix' ? { idempotencyKey: 'SS055_CATEGORY_NETWORK_QA_DOCX:unit' }
    : { contractVersion: kind === 'result version' ? profile.version : kind === 'artifact version' ? profile.artifactVersion : profile.stageVersion }
  await expect(Native.updateOne({ _id: 'a'.repeat(24) }, { $set: changes }).exec()).rejects.toThrow()
})

const containsMarker = (value, needle) => value instanceof RegExp ? value.test(needle)
  : value === needle || value && typeof value === 'object' && Object.values(value).some(v => containsMarker(v, needle))

test.each([Execution, Artifact, Stage])('$modelName protects stored-only category markers and negative-precheck atomic query/bulk filters', async Model => {
  const profile = g2.completedReviewProfile(f.subject, g1.G1_MODES.QA, expected)
  const marker = Model === Execution ? g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.QA, qaCase)
    : Model === Artifact ? profile.artifactVersion : profile.stageVersion
  const exists = Model.exists, query = result => { const q = Promise.resolve(result); q.session = () => q; return q }
  exists.mockClear().mockImplementation(() => query({ _id: 'a'.repeat(24) }))
  const update = jest.spyOn(Model.collection, 'updateOne').mockResolvedValue({ acknowledged: true, matchedCount: 0 }),
    remove = jest.spyOn(Model.collection, 'deleteOne').mockResolvedValue({ acknowledged: true, deletedCount: 0 }),
    bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
  try {
    await expect(Model.updateOne({ _id: 'a'.repeat(24) }, { $set: { warnings: [] } })).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
    if (Model === Stage) expect(exists).not.toHaveBeenCalled()
    else {
      expect(containsMarker(exists.mock.calls[0][0], marker)).toBe(true)
      await expect(Model.bulkWrite([{ deleteOne: { filter: { _id: 'a'.repeat(24) } } }])).rejects.toThrow()
      expect(bulk).not.toHaveBeenCalled()
    }
    exists.mockImplementation(() => query(null))
    if (Model === Stage) { await expect(Model.deleteOne({ _id: 'a'.repeat(24) })).rejects.toThrow(); expect(remove).not.toHaveBeenCalled() }
    else {
      await Model.deleteOne({ _id: 'a'.repeat(24) })
      expect(containsMarker(remove.mock.calls[0][0].$and[1].$nor, marker)).toBe(true)
    }
    await Model.bulkWrite([{ deleteOne: { filter: { _id: 'a'.repeat(24) } } }])
    expect(containsMarker(bulk.mock.calls[0][0][0].deleteOne.filter.$and[1].$nor, marker)).toBe(true)
  } finally { update.mockRestore(); remove.mockRestore(); bulk.mockRestore(); exists.mockImplementation(() => query(null)) }
})
