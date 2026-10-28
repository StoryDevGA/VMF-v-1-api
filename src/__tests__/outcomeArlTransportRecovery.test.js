import { createHash } from 'node:crypto'
import { measureOutcomeArlRequest, assertOutcomeArlTransportReceipt, isOutcomeArlTransportRecovery } from '../services/outcomeArlTransportRecoveryService.js'
import { OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSIONS as configs } from '../constants/outcomeGovernedQuality.js'
import { assertOutcomeQualityStageRetryLineage } from '../services/outcomeQualityStageExecutionService.js'
import { buildArlReview, executionIdentity } from './fixtures/outcomeQualityStageFixtures.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { AUTHORISED_ARL_APPROVAL, AUTHORISED_ARL_SCOPE, AUTHORISED_ARL_BODY,
  authorisedArlRequestIdentity, assertAuthorisedArlReceipt, assertStoredAuthorisedArlReview,
  prepareAuthorisedArlTransport, readAuthorisedArlProof } from '../services/outcomeArlTransportRecoveryService.js'

const receipt = size => measureOutcomeArlRequest('x'.repeat(size), { text: 'Névé — 漢字' }, 'arl-context-values.v3')
test.each([[158999, true], [159000, true], [159001, false], [159999, false], [160000, false], [160001, false]])('records exact %i bytes and enforces safety headroom', (size, allowed) => {
  const actual = receipt(size)
  expect(actual.payloadBytes).toBe(size)
  expect(actual.payloadSha256).toBe(createHash('sha256').update('x'.repeat(size)).digest('hex'))
  if (allowed) expect(assertOutcomeArlTransportReceipt(actual, { succeeded: true })).toEqual(actual)
  else expect(() => assertOutcomeArlTransportReceipt(actual, { succeeded: true })).toThrow()
  expect(assertOutcomeArlTransportReceipt(actual)).toEqual(actual)
})
test('measures UTF8 bytes rather than JavaScript string length', () => {
  const serialized = JSON.stringify({ text: 'Névé — 漢字\n' })
  const measured = measureOutcomeArlRequest(serialized, { text: 'Névé — 漢字\n' }, 'arl-context-values.v3')
  expect(measured.payloadBytes).toBe(Buffer.byteLength(serialized, 'utf8'))
  expect(measured.payloadBytes).toBeGreaterThan(serialized.length)
})
test.each(['extra', 'null', 'wrong cap', 'wrong margin', 'wrong hash', 'fraction', 'wrong version'])('rejects receipt %s', kind => {
  const value = { ...receipt(100) }
  if (kind === 'extra') value.extra = true
  if (kind === 'wrong cap') value.maxBytes = 160001
  if (kind === 'wrong margin') value.safetyMarginBytes = 0
  if (kind === 'wrong hash') value.payloadSha256 = 'bad'
  if (kind === 'fraction') value.payloadBytes = 1.5
  if (kind === 'wrong version') value.transportVersion = 'unknown'
  expect(() => assertOutcomeArlTransportReceipt(kind === 'null' ? null : value)).toThrow()
})
const recovery = () => {
  const source = { stageKey: 'WORKING_DRAFT', status: 'SUCCEEDED', stageExecutionId: 'wd4', outputFingerprint: 'a'.repeat(64), attemptFingerprint: 'b'.repeat(64), planFingerprint: 'c'.repeat(64), qualityRunId: 'run' }
  const latest = { stageKey: 'ARL_MEANING_REVIEW', stageExecutionId: 'arl2', attemptNumber: 2, attemptFingerprint: 'd'.repeat(64), status: 'FAILED', failure: { failureCode: 'ARL_MEANING_REVIEW_PROVIDER_CONTEXT_OVERFLOW', retryable: false }, inputSnapshot: { sourceStage: { ...source } }, executionIdentity: { providerConfigurationVersion: configs.OPENAI_RESPONSES_V6_LOSSLESS_TEXT_PARTS }, planFingerprint: source.planFingerprint, qualityRunId: source.qualityRunId }
  return { latest, source, configurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT }
}
test('permits one corrected technical transport without changing old retryablefalse', () => {
  const input = recovery(), before = JSON.stringify(input)
  expect(isOutcomeArlTransportRecovery(input)).toBe(true)
  const candidate = { stageKey: 'ARL_MEANING_REVIEW', predecessorStageExecutionId: 'arl2', predecessorAttemptFingerprint: input.latest.attemptFingerprint, qualityRunId: 'run', planFingerprint: input.source.planFingerprint, inputFingerprint: 'different-config', executionIdentity: { providerConfigurationVersion: input.configurationVersion } }
  expect(() => assertOutcomeQualityStageRetryLineage({ ...input, candidate })).not.toThrow()
  expect(JSON.stringify(input)).toBe(before)
})
test.each(['semantic', 'provider exists', 'wrong config', 'changed draft', 'changed plan', 'changed source attempt', 'already corrected'])('blocks %s recovery', kind => {
  const input = recovery()
  if (kind === 'semantic') input.latest.failure.failureCode = 'ARL_MEANING_REVIEW_REQUIRED_CHANGE'
  if (kind === 'provider exists') input.latest.executionIdentity.grrExecutionId = 'grr_exec_saved'
  if (kind === 'wrong config') input.configurationVersion = configs.OPENAI_RESPONSES_V6_LOSSLESS_TEXT_PARTS
  if (kind === 'changed draft') input.source.outputFingerprint = 'e'.repeat(64)
  if (kind === 'changed plan') input.source.planFingerprint = 'e'.repeat(64)
  if (kind === 'changed source attempt') input.source.attemptFingerprint = 'e'.repeat(64)
  if (kind === 'already corrected') input.latest.executionIdentity.providerConfigurationVersion = input.configurationVersion
  expect(isOutcomeArlTransportRecovery(input)).toBe(false)
})
test('actual stage model retains the exact receipt in its signed fingerprint', async () => {
  const candidate = buildArlReview({ executionIdentity: { ...executionIdentity(), providerConfigurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT, transportReceipt: receipt(158000) } })
  const row = new Stage({ ...candidate, stageExecutionId: 'outcome_quality_stage_test', createdBy: '507f1f77bcf86cd799439011' })
  await expect(row.validate()).resolves.toBeUndefined()
  expect(row.toObject().executionIdentity.transportReceipt).toEqual(receipt(158000))
  row.executionIdentity.transportReceipt.payloadBytes++
  await expect(row.validate()).rejects.toThrow()
})


test('requires a measured receipt on a V7 failed semantic review as well as success', () => {
  expect(() => buildArlReview({ executionIdentity: { ...executionIdentity(), providerConfigurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT } })).toThrow('receipt')
  const valid = buildArlReview({ executionIdentity: { ...executionIdentity(), providerConfigurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT, transportReceipt: receipt(158000) } })
  // A failed stage cannot silently drop an existing measured payload receipt.
  valid.status = 'FAILED'; delete valid.executionIdentity.transportReceipt
  const row = new Stage({ ...valid, stageExecutionId: 'transport-failure-model', createdBy: '507f1f77bcf86cd799439011' })
  return expect(row.validate()).rejects.toThrow('transport receipt')
})

describe('prospective same-draft authorised review transport and saved proof', () => {
  const fixture = () => {
    const claim = { eventId: '11111111-1111-4111-8111-111111111111', bodyHash: 'a'.repeat(64), body: {
      actorUserId: AUTHORISED_ARL_SCOPE.actorUserId, createdAt: '2026-10-22T10:08:29.000Z', reviewApproval: { ...AUTHORISED_ARL_APPROVAL },
      authorisedReview: { failedClaimEventId: '22222222-2222-4222-8222-222222222222', failedClaimBodyHash: 'b'.repeat(64),
        failedResultEventId: '33333333-3333-4333-8333-333333333333', failedResultBodyHash: 'c'.repeat(64),
        guidanceStageExecutionId: 'outcome_quality_stage_guidance', guidanceMaterialHash: 'd'.repeat(64),
        draftStageExecutionId: AUTHORISED_ARL_SCOPE.workingDraftId, draftMaterialHash: 'e'.repeat(64),
        failedArlStageExecutionId: AUTHORISED_ARL_SCOPE.priorArlId, failedArlMaterialHash: 'f'.repeat(64),
        approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256,
        discrepancyOutcome: 'DISCREPANCY', discrepancyPackSha256: AUTHORISED_ARL_APPROVAL.discrepancyPackSha256 } } }
    const requestIdentity = authorisedArlRequestIdentity(claim.eventId, claim.bodyHash, AUTHORISED_ARL_BODY.payloadSha256)
    const receipt = { contractVersion: 'authorised-arl-review.v1', claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
      approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256, discrepancyOutcome: 'DISCREPANCY',
      workingDraftStageExecutionId: AUTHORISED_ARL_SCOPE.workingDraftId, workingDraftOutputFingerprint: '1'.repeat(64),
      workingDraftAttemptFingerprint: '2'.repeat(64), workingDraftMaterialHash: 'e'.repeat(64),
      priorArlStageExecutionId: AUTHORISED_ARL_SCOPE.priorArlId, priorArlAttemptFingerprint: '3'.repeat(64), priorArlMaterialHash: 'f'.repeat(64),
      priorResponseId: 'resp_prior', requestPayloadSha256: AUTHORISED_ARL_BODY.payloadSha256, requestPayloadBytes: AUTHORISED_ARL_BODY.payloadBytes,
      requestContextHash: AUTHORISED_ARL_BODY.contextHash, requestContextBytes: AUTHORISED_ARL_BODY.contextBytes,
      transportVersion: AUTHORISED_ARL_BODY.transportVersion, providerConfigurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT,
      methodFingerprint: '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e', requestIdentity,
      grrIdempotencyKey: 'ARL_AUTHORISED_REVIEW:' + requestIdentity, responseState: 'FRESH', responseId: 'resp_new', unresolvedReason: '' }
    const artifact = { safeJson: { metadata: { responseId: 'resp_new', requestIdentity: AUTHORISED_ARL_BODY.payloadSha256,
      authorisedReview: { ...receipt } } } }
    const stage = { status: 'SUCCEEDED', executionIdentity: { authorisedReview: { ...receipt } } }
    return { claim, receipt, artifact, stage, priorResponseId: 'resp_prior' }
  }
  test('derives the stable header using literal LF and leaves body identity distinct', () => {
    const f = fixture()
    const seed = ['ss044-authorised-arl-review.v1', f.claim.eventId, f.claim.bodyHash, AUTHORISED_ARL_BODY.payloadSha256].join(String.fromCharCode(10))
    expect(f.receipt.requestIdentity).toBe(createHash('sha256').update(seed).digest('hex'))
    expect(f.receipt.requestIdentity).not.toBe(AUTHORISED_ARL_BODY.payloadSha256)
  })
  test('saved completed proof remains valid without a new admission and with reordered keys', () => {
    const f = fixture(), before = JSON.stringify(f.claim)
    f.artifact.safeJson.metadata.authorisedReview = Object.fromEntries(Object.entries(f.receipt).reverse())
    expect(assertStoredAuthorisedArlReview(f)).toEqual(f.receipt)
    expect(JSON.stringify(f.claim)).toBe(before)
  })
  test.each(['stage missing', 'stage replaced', 'artifact missing', 'artifact replaced', 'reused', 'pending', 'claim', 'method', 'body', 'approval'])('rejects completed proof: %s', kind => {
    const f = fixture()
    if (kind === 'stage missing') delete f.stage.executionIdentity.authorisedReview
    if (kind === 'stage replaced') f.stage.executionIdentity.authorisedReview.claimBodyHash = '9'.repeat(64)
    if (kind === 'artifact missing') delete f.artifact.safeJson.metadata.authorisedReview
    if (kind === 'artifact replaced') f.artifact.safeJson.metadata.authorisedReview.responseId = 'resp_other'
    if (kind === 'reused') f.receipt.responseId = f.receipt.priorResponseId
    if (kind === 'pending') Object.assign(f.receipt, { responseState: 'PENDING', responseId: '' })
    if (kind === 'claim') f.claim.eventId = '44444444-4444-4444-8444-444444444444'
    if (kind === 'method') f.receipt.methodFingerprint = '9'.repeat(64)
    if (kind === 'body') f.receipt.requestPayloadSha256 = '9'.repeat(64)
    if (kind === 'approval') f.claim.body.reviewApproval.discrepancyOutcome = 'PASS'
    expect(() => assertStoredAuthorisedArlReview(f)).toThrow()
  })
  test.each(['REUSED_RESPONSE', 'MISSING_RESPONSE', 'DISPATCH_UNCERTAIN', 'BODY_MISMATCH'])('retains terminal unresolved %s without claiming freshness', reason => {
    const f = fixture(); delete f.artifact
    Object.assign(f.receipt, { responseState: 'UNRESOLVED', responseId: reason === 'REUSED_RESPONSE' ? 'resp_prior' : '', unresolvedReason: reason })
    f.stage = { status: 'FAILED', failure: { failureCode: 'ARL_MEANING_REVIEW_PROVIDER_FAILED' }, executionIdentity: { authorisedReview: { ...f.receipt } } }
    expect(assertStoredAuthorisedArlReview(f)).toEqual(f.receipt)
    f.stage.status = 'SUCCEEDED'
    expect(() => assertStoredAuthorisedArlReview(f)).toThrow()
  })
  test('plain payload receipt cannot activate native transport proof', () => {
    const f = fixture()
    expect(() => readAuthorisedArlProof({ receipt: f.receipt })).toThrow()
    expect(() => prepareAuthorisedArlTransport({ receipt: f.receipt }, AUTHORISED_ARL_BODY, {})).toThrow()
    expect(() => assertAuthorisedArlReceipt({ ...f.receipt, extra: true })).toThrow()
  })
})
