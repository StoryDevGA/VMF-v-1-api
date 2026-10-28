import { createHash } from 'node:crypto'
import { OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSIONS as configs } from '../constants/outcomeGovernedQuality.js'

export const ARL_REQUEST_MAX_BYTES = 160000
export const ARL_REQUEST_SAFETY_MARGIN_BYTES = 1000
const hash = /^[a-f0-9]{64}$/
const keys = ['payloadBytes', 'payloadSha256', 'contextBytes', 'contextHash', 'transportVersion', 'maxBytes', 'safetyMarginBytes']

export const assertOutcomeArlTransportReceipt = (value, { succeeded = false } = {}) => {
  if (!value || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
    || !['payloadBytes', 'contextBytes'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
    || !hash.test(value.payloadSha256) || !hash.test(value.contextHash)
    || !['arl-context-values.v3', 'unencoded-context.v1'].includes(value.transportVersion)
    || value.maxBytes !== ARL_REQUEST_MAX_BYTES || value.safetyMarginBytes !== ARL_REQUEST_SAFETY_MARGIN_BYTES
    || (succeeded && value.payloadBytes > value.maxBytes - value.safetyMarginBytes)) {
    throw new TypeError('ARL transport receipt is invalid.')
  }
  return { ...value }
}

export const measureOutcomeArlRequest = (serializedRequest, context, transportVersion) => {
  if (typeof serializedRequest !== 'string') throw new TypeError('ARL serialized request is invalid.')
  const serializedContext = JSON.stringify(context)
  return Object.freeze(assertOutcomeArlTransportReceipt({
    payloadBytes: Buffer.byteLength(serializedRequest, 'utf8'),
    payloadSha256: createHash('sha256').update(serializedRequest).digest('hex'),
    contextBytes: Buffer.byteLength(serializedContext, 'utf8'),
    contextHash: createHash('sha256').update(serializedContext).digest('hex'),
    transportVersion, maxBytes: ARL_REQUEST_MAX_BYTES, safetyMarginBytes: ARL_REQUEST_SAFETY_MARGIN_BYTES,
  }))
}

// Only a technical failure before any ARL provider result may reuse an unchanged
// draft with the explicitly corrected transport. Semantic failures stay final.
export const isOutcomeArlTransportRecovery = ({ latest, source, configurationVersion }) => Boolean(
  latest?.stageKey === 'ARL_MEANING_REVIEW' && latest.status === 'FAILED'
  && latest.failure?.failureCode === 'ARL_MEANING_REVIEW_PROVIDER_CONTEXT_OVERFLOW'
  && latest.failure.retryable === false
  && latest.executionIdentity?.providerConfigurationVersion === configs.OPENAI_RESPONSES_V6_LOSSLESS_TEXT_PARTS
  && !latest.executionIdentity.grrExecutionId && !latest.executionIdentity.grrRuntimeArtifactId
  && configurationVersion === configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT
  && source?.stageKey === 'WORKING_DRAFT' && source.status === 'SUCCEEDED'
  && source.stageExecutionId === latest.inputSnapshot?.sourceStage?.stageExecutionId
  && source.outputFingerprint === latest.inputSnapshot?.sourceStage?.outputFingerprint
  && source.attemptFingerprint === latest.inputSnapshot?.sourceStage?.attemptFingerprint
  && source.planFingerprint === latest.planFingerprint && source.qualityRunId === latest.qualityRunId,
)


// One prospective, source-owned exception. This is not technical transport recovery
// or a general retry permission. No authority is loaded from repository files.
export const AUTHORISED_ARL_APPROVAL = Object.freeze({
  reference: 'ss044-synthetic-arl-discrepancy-followup.2026-10-22.v1',
  documentSha256: 'c78a48f9e034d796705cb9025183cefde05331fc6970ddbe78b9cc1cde6b8432',
  procedure: 'ss044-synthetic-arl-discrepancy-followup-procedure.v1',
  approverName: 'Angus Gregory', approverRole: 'Product Owner, StorylineOS',
  recordedAt: '2026-10-22T10:08:28.000Z', effectiveFrom: '2026-10-22T10:08:28.000Z',
  originalChatApprovalTimestamp: 'NOT_AVAILABLE', discrepancyOutcome: 'DISCREPANCY',
  discrepancyPackSha256: 'acb1be0bcb5cc4fd5f16bd9432800ec4007251c777aec98de3ae98126d1aa2f7',
})
export const AUTHORISED_ARL_SCOPE = Object.freeze({ customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
  runtimeInstanceId: '6ad715c91f39fea112115875', actorUserId: '6a6c763dcace7a21bd41efa9',
  workingDraftId: 'outcome_quality_stage_536b04b0-e58d-42bf-bddc-fcf5c73cd915', priorArlId: 'outcome_quality_stage_43eefa03-b673-4729-8f6e-130ddc267ee3' })
export const AUTHORISED_ARL_BODY = Object.freeze({ payloadBytes: 158972,
  payloadSha256: '6b0b88ba23b6619124f14aa77a5ac56bde746bb214f6c2c7b53efd02f9697975', contextBytes: 297103,
  contextHash: '226f224a02011584e07ecee489fe9d6053b771f01c511f489f565501ebab5dcf', transportVersion: 'arl-context-values.v3' })
const reviewKeys = ['contractVersion', 'claimEventId', 'claimBodyHash', 'approvalReference', 'approvalSha256', 'discrepancyOutcome',
  'workingDraftStageExecutionId', 'workingDraftOutputFingerprint', 'workingDraftAttemptFingerprint', 'workingDraftMaterialHash',
  'priorArlStageExecutionId', 'priorArlAttemptFingerprint', 'priorArlMaterialHash', 'priorResponseId',
  'requestPayloadSha256', 'requestPayloadBytes', 'requestContextHash', 'requestContextBytes', 'transportVersion',
  'providerConfigurationVersion', 'methodFingerprint', 'requestIdentity', 'grrIdempotencyKey', 'responseState', 'responseId', 'unresolvedReason']
const reviewLinkKeys = ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash',
  'guidanceStageExecutionId', 'guidanceMaterialHash', 'draftStageExecutionId', 'draftMaterialHash', 'failedArlStageExecutionId', 'failedArlMaterialHash',
  'approvalReference', 'approvalSha256', 'discrepancyOutcome', 'discrepancyPackSha256']
const exactReview = (v, keys) => v && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const reviewError = () => Object.assign(new Error('The authorised ARL followup proof is invalid.'), { status: 409, code: 'ARL_AUTHORISED_REVIEW_INVALID', details: { reason: 'AUTHORISED_REVIEW_INVALID' } })
const reviewNeed = condition => { if (!condition) throw reviewError() }
const reviewHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const canonicalReview = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])))
export const assertAuthorisedArlRequest = value => {
  reviewNeed(exactReview(value, reviewLinkKeys) && value.approvalReference === AUTHORISED_ARL_APPROVAL.reference
    && value.approvalSha256 === AUTHORISED_ARL_APPROVAL.documentSha256 && value.discrepancyOutcome === 'DISCREPANCY'
    && value.discrepancyPackSha256 === AUTHORISED_ARL_APPROVAL.discrepancyPackSha256)
  return value
}
export const assertAuthorisedArlApproval = body => {
  assertAuthorisedArlRequest(body.authorisedReview)
  reviewNeed(exactReview(body.reviewApproval, Object.keys(AUTHORISED_ARL_APPROVAL))
    && Object.keys(AUTHORISED_ARL_APPROVAL).every(key => body.reviewApproval[key] === AUTHORISED_ARL_APPROVAL[key])
    && body.actorUserId === AUTHORISED_ARL_SCOPE.actorUserId && Number.isFinite(Date.parse(body.createdAt))
    && Date.parse(body.createdAt) >= Date.parse(AUTHORISED_ARL_APPROVAL.effectiveFrom))
}
export const authorisedArlRequestIdentity = (claimEventId, claimBodyHash, payloadSha256) => reviewHash(
  ['ss044-authorised-arl-review.v1', claimEventId, claimBodyHash, payloadSha256].join('\n'))
export const assertAuthorisedArlReceipt = (value, { terminal = false } = {}) => {
  reviewNeed(exactReview(value, reviewKeys) && value.contractVersion === 'authorised-arl-review.v1'
    && /^[a-f0-9-]{36}$/.test(value.claimEventId) && hash.test(value.claimBodyHash)
    && value.approvalReference === AUTHORISED_ARL_APPROVAL.reference && value.approvalSha256 === AUTHORISED_ARL_APPROVAL.documentSha256
    && value.discrepancyOutcome === 'DISCREPANCY' && value.workingDraftStageExecutionId === AUTHORISED_ARL_SCOPE.workingDraftId
    && value.priorArlStageExecutionId === AUTHORISED_ARL_SCOPE.priorArlId
    && ['workingDraftOutputFingerprint', 'workingDraftAttemptFingerprint', 'workingDraftMaterialHash', 'priorArlAttemptFingerprint', 'priorArlMaterialHash', 'methodFingerprint'].every(k => hash.test(value[k]))
    && value.requestPayloadSha256 === AUTHORISED_ARL_BODY.payloadSha256 && value.requestPayloadBytes === AUTHORISED_ARL_BODY.payloadBytes
    && value.requestContextHash === AUTHORISED_ARL_BODY.contextHash && value.requestContextBytes === AUTHORISED_ARL_BODY.contextBytes
    && value.transportVersion === AUTHORISED_ARL_BODY.transportVersion && value.providerConfigurationVersion === configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT
    && value.methodFingerprint === '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e'
    && /^resp_[a-zA-Z0-9_-]+$/.test(value.priorResponseId)
    && value.requestIdentity === authorisedArlRequestIdentity(value.claimEventId, value.claimBodyHash, value.requestPayloadSha256)
    && value.requestIdentity !== value.requestPayloadSha256 && value.grrIdempotencyKey === 'ARL_AUTHORISED_REVIEW:' + value.requestIdentity)
  if (value.responseState === 'PENDING') reviewNeed(!terminal && value.responseId === '' && value.unresolvedReason === '')
  else if (value.responseState === 'FRESH') reviewNeed(/^resp_[a-zA-Z0-9_-]+$/.test(value.responseId) && value.responseId !== value.priorResponseId && value.unresolvedReason === '')
  else reviewNeed(value.responseState === 'UNRESOLVED' && ['REUSED_RESPONSE', 'MISSING_RESPONSE', 'DISPATCH_UNCERTAIN', 'BODY_MISMATCH'].includes(value.unresolvedReason)
    && typeof value.responseId === 'string' && value.responseId.length <= 180)
  return { ...value }
}
export const isAuthorisedArlRetry = ({ candidate, latest, source }) => {
  const r = candidate?.executionIdentity?.authorisedReview
  if (!r) return false
  try { assertAuthorisedArlReceipt(r, { terminal: true }) } catch { return false }
  return String(candidate.runtimeInstanceId) === AUTHORISED_ARL_SCOPE.runtimeInstanceId
    && candidate.stageKey === 'ARL_MEANING_REVIEW' && candidate.attemptNumber === 12
    && latest?.stageExecutionId === r.priorArlStageExecutionId && latest.attemptNumber === 11 && latest.status === 'FAILED'
    && latest.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' && latest.failure.retryable === false
    && latest.attemptFingerprint === r.priorArlAttemptFingerprint && candidate.predecessorStageExecutionId === latest.stageExecutionId
    && candidate.predecessorAttemptFingerprint === latest.attemptFingerprint
    && source?.stageExecutionId === r.workingDraftStageExecutionId && source.status === 'SUCCEEDED' && source.attemptNumber === 12
    && source.outputFingerprint === r.workingDraftOutputFingerprint && source.attemptFingerprint === r.workingDraftAttemptFingerprint
    && latest.inputSnapshot?.sourceStage?.stageExecutionId === source.stageExecutionId
    && latest.inputSnapshot.sourceStage.outputFingerprint === source.outputFingerprint
    && latest.inputSnapshot.sourceStage.attemptFingerprint === source.attemptFingerprint
    && source.planFingerprint === latest.planFingerprint && source.qualityRunId === latest.qualityRunId
}
const authorisedProofs = new WeakSet()
export const readAuthorisedArlProof = proof => { reviewNeed(authorisedProofs.has(proof)); return { ...proof.receipt } }
export const prepareAuthorisedArlTransport = (proof, receipt, context) => {
  reviewNeed(authorisedProofs.has(proof))
  const r = proof.receipt
  if (!Object.keys(AUTHORISED_ARL_BODY).every(k => receipt[k] === AUTHORISED_ARL_BODY[k])
    || !context.methodDocument || reviewHash(JSON.stringify(context.methodDocument)) !== '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e') {
    Object.assign(r, { responseState: 'UNRESOLVED', unresolvedReason: 'BODY_MISMATCH' })
    throw reviewError()
  }
  r.methodFingerprint = '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e'
  assertAuthorisedArlReceipt(r)
  return r.requestIdentity
}
export const observeAuthorisedArlResponse = (proof, responseId) => {
  reviewNeed(authorisedProofs.has(proof))
  const r = proof.receipt; r.responseId = typeof responseId === 'string' ? responseId : ''
  r.responseState = r.responseId && r.responseId !== r.priorResponseId ? 'FRESH' : 'UNRESOLVED'
  r.unresolvedReason = r.responseState === 'FRESH' ? '' : r.responseId ? 'REUSED_RESPONSE' : 'MISSING_RESPONSE'
  if (r.responseState !== 'FRESH') throw reviewError()
}
export const unresolvedAuthorisedArlProof = proof => {
  reviewNeed(authorisedProofs.has(proof))
  if (proof.receipt.responseState === 'PENDING') Object.assign(proof.receipt, { responseState: 'UNRESOLVED', unresolvedReason: 'DISPATCH_UNCERTAIN' })
  return readAuthorisedArlProof(proof)
}
export const verifyNativeAuthorisedArlReview = async ({ claimEventId, claimBodyHash, actorUserId, runtimeInstanceId,
  plan, source, latest, session = null, readBudget, deps = {}, terminalReceipt, artifactId } = {}) => {
  reviewNeed(actorUserId === AUTHORISED_ARL_SCOPE.actorUserId && String(runtimeInstanceId) === AUTHORISED_ARL_SCOPE.runtimeInstanceId
    && String(plan.customerId) === AUTHORISED_ARL_SCOPE.customerId && String(plan.tenantId) === AUTHORISED_ARL_SCOPE.tenantId)
  const [{ default: Event, assertSyntheticOutcomeRunEvent }, { default: Audit }, { default: Artifact }, { membershipHash }] = await Promise.all([
    import('../models/SyntheticOutcomeRunEvent.js'), import('../models/AuditLog.js'), import('../models/GovernedRuntimeArtifact.js'), import('./runtimeEvidenceSnapshotContract.js')])
  const models = deps.models || deps
  const scope = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(k => [k, AUTHORISED_ARL_SCOPE[k]]))
  const read = async (Model, filter) => {
    const budget = readBudget ? readBudget() : {}, q = Model.findOne(filter).maxTimeMS(Math.min(2000, budget.maxTimeMS ?? 2000))
    if (session) q.session(session)
    if (readBudget) q.setOptions({ ...budget, maxTimeMS: Math.min(2000, budget.maxTimeMS ?? 2000) })
    return q.lean()
  }
  const claim = await read(models.SyntheticOutcomeRunEvent || Event, { ...scope, phase: 'AUTHORISED_REVIEW_CLAIM', eventId: claimEventId })
  reviewNeed(claim && claim.bodyHash === claimBodyHash); assertSyntheticOutcomeRunEvent(claim); assertAuthorisedArlApproval(claim.body)
  reviewNeed(membershipHash(claim.body) === claim.bodyHash && claim.body.plan.planId === plan.planId && claim.body.plan.planFingerprint === plan.planFingerprint
    && claim.body.plan.requestId === plan.requestId && !await read(models.SyntheticOutcomeRunEvent || Event, { ...scope, phase: 'AUTHORISED_REVIEW_RESULT' }))
  const a = await read(models.AuditLog || Audit, { _id: claim.auditId, 'scope.customerId': scope.customerId, 'scope.tenantId': scope.tenantId, resourceId: runtimeInstanceId })
  reviewNeed(a && Audit.hydrate(a).verifySignature() && String(a._id) === String(claim.auditId) && a.signatureVersion === claim.auditSignatureVersion
    && String(a.actorUserId) === actorUserId && a.diff?.phase === 'AUTHORISED_REVIEW_CLAIM' && a.diff.eventId === claim.eventId && a.diff.bodyHash === claim.bodyHash)
  const { serializeOutcomeQualityStageExecution } = await import('./outcomeQualityStageExecutionService.js')
  source = serializeOutcomeQualityStageExecution(source); latest = serializeOutcomeQualityStageExecution(latest)
  const link = claim.body.authorisedReview
  reviewNeed(source?.stageExecutionId === AUTHORISED_ARL_SCOPE.workingDraftId && latest?.stageExecutionId === AUTHORISED_ARL_SCOPE.priorArlId
    && membershipHash(source) === link.draftMaterialHash && membershipHash(latest) === link.failedArlMaterialHash)
  const prior = await read(models.GovernedRuntimeArtifact || Artifact, { ...scope, runtimeArtifactId: latest.executionIdentity?.grrRuntimeArtifactId })
  const priorResponseId = prior?.safeJson?.metadata?.responseId
  reviewNeed(/^resp_[a-zA-Z0-9_-]+$/.test(priorResponseId || '') && prior.safeJson.metadata.requestIdentity === AUTHORISED_ARL_BODY.payloadSha256)
  const identity = authorisedArlRequestIdentity(claim.eventId, claim.bodyHash, AUTHORISED_ARL_BODY.payloadSha256)
  const receipt = { contractVersion: 'authorised-arl-review.v1', claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
    approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256, discrepancyOutcome: 'DISCREPANCY',
    workingDraftStageExecutionId: source.stageExecutionId, workingDraftOutputFingerprint: source.outputFingerprint,
    workingDraftAttemptFingerprint: source.attemptFingerprint, workingDraftMaterialHash: link.draftMaterialHash,
    priorArlStageExecutionId: latest.stageExecutionId, priorArlAttemptFingerprint: latest.attemptFingerprint, priorArlMaterialHash: link.failedArlMaterialHash,
    priorResponseId, requestPayloadSha256: AUTHORISED_ARL_BODY.payloadSha256, requestPayloadBytes: AUTHORISED_ARL_BODY.payloadBytes,
    requestContextHash: AUTHORISED_ARL_BODY.contextHash, requestContextBytes: AUTHORISED_ARL_BODY.contextBytes,
    transportVersion: AUTHORISED_ARL_BODY.transportVersion, providerConfigurationVersion: configs.OPENAI_RESPONSES_V7_EXACT_TRANSPORT,
    methodFingerprint: '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e', requestIdentity: identity, grrIdempotencyKey: 'ARL_AUTHORISED_REVIEW:' + identity,
    responseState: 'PENDING', responseId: '', unresolvedReason: '' }
  assertAuthorisedArlReceipt(receipt)
  if (terminalReceipt) {
    assertAuthorisedArlReceipt(terminalReceipt, { terminal: true })
    reviewNeed(Object.keys(receipt).filter(k => !['methodFingerprint', 'responseState', 'responseId', 'unresolvedReason'].includes(k)).every(k => terminalReceipt[k] === receipt[k]))
    if (terminalReceipt.responseState === 'FRESH') {
      const artifact = await read(models.GovernedRuntimeArtifact || Artifact, { ...scope, runtimeArtifactId: artifactId })
      reviewNeed(artifact?.safeJson?.metadata?.responseId === terminalReceipt.responseId
        && terminalReceipt.responseId !== priorResponseId
        && artifact?.safeJson?.metadata?.requestIdentity === AUTHORISED_ARL_BODY.payloadSha256
        && membershipHash(artifact.safeJson.metadata.authorisedReview) === membershipHash(terminalReceipt))
    }
    return terminalReceipt
  }
  const proof = { receipt }; authorisedProofs.add(proof); return proof
}

// Saved-read validation has no admission/no-RESULT check and never mints a proof.
// The caller supplies records already verified through the native signed journal.
export const assertStoredAuthorisedArlReview = ({ claim, receipt, priorResponseId, artifact, stage }) => {
  assertAuthorisedArlApproval(claim.body)
  assertAuthorisedArlReceipt(receipt, { terminal: true })
  const link = claim.body.authorisedReview
  reviewNeed(receipt.claimEventId === claim.eventId && receipt.claimBodyHash === claim.bodyHash
    && receipt.workingDraftMaterialHash === link.draftMaterialHash && receipt.priorArlMaterialHash === link.failedArlMaterialHash
    && receipt.priorResponseId === priorResponseId)
  if (artifact) {
    const meta = artifact.safeJson?.metadata
    reviewNeed(receipt.responseState === 'FRESH' && meta?.responseId === receipt.responseId && meta.responseId !== priorResponseId
      && meta.requestIdentity === AUTHORISED_ARL_BODY.payloadSha256
      && meta.authorisedReview && canonicalReview(meta.authorisedReview) === canonicalReview(receipt))
  }
  if (stage) {
    reviewNeed(stage.executionIdentity?.authorisedReview
      && canonicalReview(stage.executionIdentity.authorisedReview) === canonicalReview(receipt))
    if (stage.status === 'SUCCEEDED' || stage.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE') reviewNeed(receipt.responseState === 'FRESH' && artifact)
    else reviewNeed(stage.status === 'FAILED' && (receipt.responseState === 'UNRESOLVED' || artifact))
  }
  return receipt
}
