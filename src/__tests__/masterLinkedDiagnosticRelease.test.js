import fs from 'node:fs'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import Audit from '../models/AuditLog.js'
import { correctedGenuineSeams as seams, installCorrectedGenuineModelSeams } from './fixtures/correctedGenuineReviewFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'

// Focused unit protocol checks only. Existing fixture seams replace native
// authentication, source loading, serialization and model persistence. G1/G2
// validators, audit signing, capabilities and the provider adapter remain real.
// These checks prove no database transaction or actual provider behaviour.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedGenuineReviewSubject.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value)), expected = metadata.request
const legacyRoot = 'SS055_APPROVED_GENUINE_DOCX:2bd7ae507d9010f756fed72b0c7d0297790698c0bb11369f57a0120576fecd8a'
const serialized = '{"hermeticApprovedProtocolOnly":true}'
const originalFetch = globalThis.fetch, originalKey = process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
globalThis.fetch = seams.fetch
process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = 'SS055_HERMETIC_DIAGNOSTIC_ONLY_NO_PROVIDER'
const traps = [jest.spyOn(net.Socket.prototype, 'connect'), jest.spyOn(http, 'request'), jest.spyOn(https, 'request'), jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect')]
traps.forEach(trap => trap.mockImplementation(() => { throw Error('REAL_NETWORK_FORBIDDEN') }))

const g1 = await import('../services/masterLinkedGenuineReviewContract.js')
const g2 = await import('../services/masterLinkedCompletedReviewContract.js')
const { issueApprovedGenuineMasterLinkedReviewRelease: issueV1, issueDiagnosticGenuineMasterLinkedReviewRelease: issueV2 } = await import('../services/masterLinkedReviewReleaseService.js')
const { createApprovedGenuineMasterLinkedReviewAuthority: authority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
const { createOpenAiApprovedMasterLinkedDocxReviewProviderAdapter: adapter } = await import('../services/openAiMasterLinkedDocxReviewProviderAdapter.js')
const { createApprovedGenuineMasterLinkedCompletedReviewStore: store } = await import('../services/masterLinkedCompletedReviewService.js')
const { executeApprovedGenuineMasterLinkedReview: execute } = await import('../services/correctedMasterLinkedReviewExecutionService.js')
const harness = installCorrectedGenuineModelSeams(metadata)
let f
const version = () => g1.G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version
const rootV2 = () => g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE, '', version())
const releaseArgs = () => ({ authorization: 'Bearer UNIT_NO_NATIVE_TOKEN', approvalReference: 'UNIT ONLY: separate diagnostic review permission; no genuine authority.', expected: copy(expected) })
const args = release => ({ actorUserId: f.subject.actorUserId, runtimeInstanceId: g1.G1_FIXED.runtimeInstanceId,
  candidateId: f.subject.binding.candidateId, scopes: {}, expected: copy(expected), approvalAuditId: release.approvalAuditId })
const row = release => f.Audit.find(audit => String(audit._id) === release.approvalAuditId)
const grantRead = release => ({ actorUserId: f.subject.actorUserId, scopes: {}, grantExecutionId: f.Execution.find(record => {
  const body = record.executionEvidence?.masterDocxDispatch?.body
  return body?.phase === 'GRANT' && body.onceRoot === row(release).diff.onceRoot
}).executionId })
const sign = audit => { const model = new Audit(audit); model.generateSignature(); return model.toObject() }
const wire = failed => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
  overallStatus: failed ? 'FAIL' : 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(dimension => [dimension,
    { status: failed && dimension === 'HEADINGS' ? 'FAIL' : 'PASS', finding: 'Synthetic diagnostic-release protocol evidence only.', requiredChange: failed && dimension === 'HEADINGS' }])) })
const reset = () => {
  f = harness.reset()
  seams.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: 'resp_diagnostic_unit', status: 'completed', model: 'gpt-5.2',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(wire(f.failed)) }] }] }), { headers: { 'x-request-id': 'req_diagnostic_unit' } }))
}
beforeEach(reset)
afterAll(() => {
  traps.forEach(trap => expect(trap).not.toHaveBeenCalled())
  harness.restoreName(); jest.restoreAllMocks(); globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OUTCOME_STUDIO_PROVIDER_API_KEY
  else process.env.OUTCOME_STUDIO_PROVIDER_API_KEY = originalKey
})

test('keeps the frozen version-one root and approval-reference shape unchanged', async () => {
  const subjectBefore = copy(f.subject), requestBefore = copy(expected)
  expect(g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE)).toBe(legacyRoot)
  const release = await issueV1(releaseArgs()), audit = row(release)
  expect(audit.diff.version).toBe(g1.G1_APPROVED_GENUINE_RELEASE.version)
  expect(audit.diff.onceRoot).toBe(legacyRoot)
  expect(Object.keys(g1.g1ApprovalReference(f.subject, g1.G1_MODES.GENUINE, audit)).sort()).toEqual(['auditId', 'diffFingerprint', 'kind'])
  expect(g1.g1PostIdempotencyKey(expected, legacyRoot, null)).toBe(expected.requestIdentity)
  expect(f.subject).toEqual(subjectBefore); expect(expected).toEqual(requestBefore)
  expect(seams.fetch).not.toHaveBeenCalled()
})

test('selects one fixed distinct version-two root and rejects unsupported or QA version selection', () => {
  const next = rootV2()
  expect(next).not.toBe(legacyRoot); expect(rootV2()).toBe(next)
  expect(next).toBe('SS055_APPROVED_GENUINE_DOCX:' + membershipHash({ sprint: 'SS-055', scope: f.subject.binding.masterReference.scope,
    candidateId: f.subject.binding.candidateId, compatibilityReference: f.subject.binding.compatibilityReference, request: expected, releaseVersion: version() }))
  expect(g1.g1ReleaseProfile(f.subject, g1.G1_MODES.GENUINE, expected, version())).toEqual(g1.G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE)
  for (const invalid of ['', 'ss055-approved-expression-review-release-genuine.v3', {}, 2]) {
    expect(() => g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.GENUINE, '', invalid)).toThrow()
    expect(() => g1.g1ReleaseProfile(f.subject, g1.G1_MODES.GENUINE, expected, invalid)).toThrow()
  }
  expect(() => g1.g1SubjectRoot(f.subject, expected, g1.G1_MODES.QA, 'ss055-release-proof-diagnostic-unit', version())).toThrow()
  expect(() => g1.g1ReleaseProfile(f.subject, g1.G1_MODES.QA, expected, version())).toThrow()
})

test('version-two issuer signs exact native authority once without renewing version one', async () => {
  const previous = await issueV1(releaseArgs()), previousAudit = JSON.stringify(row(previous))
  const release = await issueV2(releaseArgs()), audit = row(release)
  expect(release.approvalAuditId).not.toBe(previous.approvalAuditId)
  const diff = g1.assertG1Approval(audit, f.subject, expected, value => Audit.prototype.verifySignature.call(value), Date.now())
  expect(diff).toMatchObject({ version: version(), onceRoot: rootV2(), operatorAuthority: f.native,
    candidateId: metadata.subject.binding.candidateId, requestBinding: expected, maximumAttempts: 1,
    customerApproval: false, productionUse: false, automaticFinalisation: false })
  expect(g1.g1ApprovalReference(f.subject, g1.G1_MODES.GENUINE, audit)).toMatchObject({ version: version(), kind: g1.G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.kind })
  const count = f.Audit.length
  expect((await issueV2(releaseArgs())).approvalAuditId).toBe(release.approvalAuditId)
  expect(f.Audit).toHaveLength(count)
  await expect(issueV2({ ...releaseArgs(), approvalReference: 'Changed unit reference' })).rejects.toThrow()
  expect(JSON.stringify(row(previous))).toBe(previousAudit); expect(seams.fetch).not.toHaveBeenCalled()
})

test('preserves a consumed uncertain version-one attempt when creating version-two authority', async () => {
  const previous = await issueV1(releaseArgs()), prepared = await authority().prepare(args(previous))
  seams.fetch.mockRejectedValueOnce(new TypeError('UNIT_TRANSPORT_FAILURE'))
  await expect(adapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'PROVIDER_NETWORK_FAILED' } })
  const priorExecutions = f.Execution.map(record => JSON.stringify(record)), priorAudits = f.Audit.map(audit => JSON.stringify(audit))
  const release = await issueV2(releaseArgs()), next = await authority().prepare(args(release))
  expect(next.state).toBe('FRESH_RESERVATION')
  expect(next.grant.body.onceRoot).toBe(rootV2()); expect(next.grant.body.approval.version).toBe(version())
  expect(f.Execution.slice(0, priorExecutions.length).map(record => JSON.stringify(record))).toEqual(priorExecutions)
  expect(f.Audit.slice(0, priorAudits.length).map(audit => JSON.stringify(audit))).toEqual(priorAudits)
  expect(await authority().read(grantRead(previous))).toMatchObject({ genuineAttemptConsumed: true, submissionState: 'START_CONSUMED_SUBMISSION_UNCONFIRMED' })
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('version-two issuer rejects an operator changed between native checks without writing authority', async () => {
  seams.auth.mockResolvedValueOnce(copy(f.native)).mockResolvedValueOnce({ ...f.native, fingerprint: 'b'.repeat(64) })
  await expect(issueV2(releaseArgs())).rejects.toMatchObject({ details: { reason: 'OPERATOR_CHANGED' } })
  expect(f.Audit).toHaveLength(3); expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test('a re-signed version-two permission cannot select the consumed version-one root', async () => {
  const release = await issueV2(releaseArgs()), audit = row(release)
  audit.diff.onceRoot = legacyRoot
  Object.assign(audit, sign(audit))
  await expect(authority().prepare(args(release))).rejects.toMatchObject({ details: { reason: 'OPERATOR_RELEASE_INVALID' } })
  expect(f.Execution).toHaveLength(0); expect(seams.fetch).not.toHaveBeenCalled()
})

test('version-two fake PASS keeps request bytes but uses its owned header and one readable version-six result', async () => {
  const release = await issueV2(releaseArgs()), input = args(release), saved = await execute(input)
  expect(saved).toMatchObject({ completionConfirmed: true, reviewStatus: 'PASS', approvalAvailable: false, finalisationAvailable: false })
  const options = seams.fetch.mock.calls[0][1]
  expect(options.body).toBe(serialized)
  expect(options.headers['Idempotency-Key']).toBe(membershipHash({ releaseVersion: version(), onceRoot: rootV2(), requestIdentity: expected.requestIdentity }))
  expect(options.headers['Idempotency-Key']).not.toBe(expected.requestIdentity)
  expect(f.Stage[0].contractVersion).toBe('master-linked-docx-rendition-stage.v6')
  expect(f.Stage[0].renditionInputSnapshot.onceRoot).toBe(rootV2())
  expect(g2.assertCompletedReviewInput(f.Stage[0].renditionInputSnapshot).binding).toEqual(expected)
  expect((await store().read(grantRead(release))).resultFingerprint).toBe(saved.resultFingerprint)
  expect(await store().read(grantRead(release))).toEqual(await store().reconcile(grantRead(release)))
  const counts = [f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]
  expect((await execute(input)).resultFingerprint).toBe(saved.resultFingerprint)
  expect([f.Execution.length, f.Artifact.length, f.Stage.length, f.Audit.length]).toEqual(counts)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('version-two fake quality FAIL is stored and replayed without another submission', async () => {
  f.failed = true
  const release = await issueV2(releaseArgs()), input = args(release), saved = await execute(input)
  expect(saved).toMatchObject({ completionConfirmed: true, reviewStatus: 'FAIL', approvalAvailable: false, finalisationAvailable: false })
  expect(f.Stage[0].failure.retryable).toBe(false)
  expect((await execute(input)).resultFingerprint).toBe(saved.resultFingerprint)
  expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('version-two capability can be consumed only once', async () => {
  const release = await issueV2(releaseArgs()), prepared = await authority().prepare(args(release))
  await adapter()(prepared.capability)
  await expect(adapter()(prepared.capability)).rejects.toMatchObject({ details: { reason: 'CAPABILITY_UNAVAILABLE' } })
  expect((await authority().read(grantRead(release))).genuineAttemptConsumed).toBe(true)
  expect(seams.fetch).toHaveBeenCalledTimes(1); expect(f.Stage).toHaveLength(0)
})

test('version-two network failure preserves consumed uncertainty and replay cannot resubmit', async () => {
  seams.fetch.mockRejectedValue(new TypeError('UNIT_TRANSPORT_FAILURE'))
  const release = await issueV2(releaseArgs()), input = args(release)
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_NETWORK_FAILED', outcome: 'SUBMISSION_UNCERTAIN' } })
  expect(await authority().read(grantRead(release))).toMatchObject({ genuineAttemptConsumed: true,
    submissionState: 'START_CONSUMED_SUBMISSION_UNCONFIRMED', receipts: { UNCERTAINTY: { payload: { state: 'HELD_NO_RETRY' } } } })
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'COMPLETED_RESPONSE_NOT_READY' } })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('version-two invalid findings remain held with no accepted result or resend', async () => {
  const invalid = wire(false); delete invalid.findings.BRAND_EXPRESSION
  seams.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'resp_diagnostic_invalid_unit', status: 'completed', model: 'gpt-5.2',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(invalid) }] }] })))
  const release = await issueV2(releaseArgs()), input = args(release)
  await expect(execute(input)).rejects.toMatchObject({ details: { reason: 'PROVIDER_OUTPUT_INVALID' } })
  expect(await authority().read(grantRead(release))).toMatchObject({ genuineAttemptConsumed: true, submissionState: 'KNOWN_RESPONSE' })
  expect(await execute(input)).toMatchObject({ state: 'COMPLETED_REVIEW_NOT_RECORDED', completionConfirmed: false })
  expect(f.Artifact).toHaveLength(0); expect(f.Stage).toHaveLength(0); expect(seams.fetch).toHaveBeenCalledTimes(1)
})

test('completed input accepts only the two exact approved genuine roots', async () => {
  for (const issue of [issueV1, issueV2]) {
    reset()
    const release = await issue(releaseArgs()); await execute(args(release))
    const input = f.Stage[0].renditionInputSnapshot
    expect(g2.assertCompletedReviewInput(input)).toBe(input)
    const post = seams.fetch.mock.calls[0][1]
    expect(post.body).toBe(serialized)
    expect(post.headers['Idempotency-Key']).toBe(issue === issueV1 ? expected.requestIdentity : g1.g1PostIdempotencyKey(expected, input.onceRoot, version()))
    const changed = copy(input); changed.onceRoot = 'SS055_APPROVED_GENUINE_DOCX:' + 'f'.repeat(64)
    expect(() => g2.assertCompletedReviewInput(changed)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'COMPLETION_VERSION_ROOT' }) }))
  }
})
