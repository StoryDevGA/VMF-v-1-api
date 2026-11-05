import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { buildCanonicalJson } from './governanceAudit/checksumService.js'
import { assertMasterLinkedPreparedSubject } from './masterLinkedReviewSimulationContract.js'
import { G1_MODES, g1SubjectRoot, assertG1FixedSubject, assertG1CorrectedSubject, isG1CategoryQaRequest, assertG1CategoryQaSubject,
  isG1ApprovedRequest, assertG1ApprovedSubject, isG1NarrowRequest, assertG1NarrowSubject, G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE } from './masterLinkedGenuineReviewContract.js'
import { normalizeRenderedExpressionRlOutput } from '../utils/outcomeRenderedExpressionRlOutput.js'
import { MASTER_LINKED_REVIEW_STAGE_VERSION, MASTER_LINKED_REVIEW_STAGE_KEYS,
  CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION, CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY, CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY,
  CATEGORY_MASTER_LINKED_REVIEW_STAGE_VERSION, CATEGORY_MASTER_LINKED_REVIEW_STAGE_KEY,
  CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_VERSION, CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_KEY,
  APPROVED_MASTER_LINKED_REVIEW_STAGE_VERSION, APPROVED_MASTER_LINKED_REVIEW_STAGE_KEY,
  APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_VERSION, APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_KEY,
  NARROW_MASTER_LINKED_REVIEW_STAGE_VERSION, NARROW_MASTER_LINKED_REVIEW_STAGE_KEY } from '../utils/outcomeQualityStageSubjects.js'
import { MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from './masterLinkedCategoryReviewResponseContract.js'

export const COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v2'
export const COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v2'
export const CORRECTED_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v3'
export const CORRECTED_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v3'
export const CATEGORY_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v4'
export const CATEGORY_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v4'
export const CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v5'
export const CATEGORY_GENUINE_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v5'
export const APPROVED_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v6'
export const APPROVED_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v6'
export const APPROVED_QA_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v7'
export const APPROVED_QA_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v7'
export const NARROW_COMPLETED_REVIEW_VERSION = 'master-linked-docx-review-result.v8'
export const NARROW_COMPLETED_ARTIFACT_VERSION = 'master-linked-docx-review-artifact.v8'
export const COMPLETED_REVIEW_OUTPUT = 'MASTER_LINKED_DOCX_REVIEW'
export const COMPLETED_REVIEW_STATUS = 'MASTER_DOCX_REVIEW_COMPLETED'
export const COMPLETED_ARTIFACT_TYPE = 'MASTER_LINKED_DOCX_REVIEW_FINDINGS'
export const COMPLETED_REVIEW_ACTIONS = Object.freeze({ result: 'MASTER_LINKED_DOCX_REVIEW_RESULT_RECORDED',
  artifact: 'MASTER_LINKED_DOCX_FINDINGS_RECORDED', stage: 'MASTER_LINKED_DOCX_REVIEW_STAGE_RECORDED' })
export const completedReviewFailure = (reason, status = 409) => Object.assign(new Error('The completed document review cannot be confirmed.'), {
  code: 'MASTER_LINKED_COMPLETED_REVIEW_HELD', status, details: { reason, completionConfirmed: false, approvalAvailable: false, finalisationAvailable: false },
})
export const completedNeed = (value, reason) => { if (!value) throw completedReviewFailure(reason) }
export const completedExact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export const completedSame = (a, b) => buildCanonicalJson(a) === buildCanonicalJson(b)
const need = completedNeed, exact = completedExact, same = completedSame
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const oid = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v)
const refId = v => oid(v) || v instanceof mongoose.Types.ObjectId && oid(v.toHexString())
export const completedBoundScope = (scope, expected) => exact(scope, Object.keys(expected))
  && Object.entries(expected).every(([k, v]) => refId(scope[k]) && String(scope[k]) === v)
const token = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(v)
const iso = v => v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString()
  : typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? v : ''
const sha = v => createHash('sha256').update(v).digest('hex')
const falseFlags = { approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
const resultVersions = [COMPLETED_REVIEW_VERSION, CORRECTED_COMPLETED_REVIEW_VERSION, CATEGORY_COMPLETED_REVIEW_VERSION, CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION, APPROVED_COMPLETED_REVIEW_VERSION, APPROVED_QA_COMPLETED_REVIEW_VERSION, NARROW_COMPLETED_REVIEW_VERSION]
const artifactVersions = [COMPLETED_ARTIFACT_VERSION, CORRECTED_COMPLETED_ARTIFACT_VERSION, CATEGORY_COMPLETED_ARTIFACT_VERSION, CATEGORY_GENUINE_COMPLETED_ARTIFACT_VERSION, APPROVED_COMPLETED_ARTIFACT_VERSION, APPROVED_QA_COMPLETED_ARTIFACT_VERSION, NARROW_COMPLETED_ARTIFACT_VERSION]
const stageVersions = [MASTER_LINKED_REVIEW_STAGE_VERSION, CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION, CATEGORY_MASTER_LINKED_REVIEW_STAGE_VERSION, CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_VERSION, APPROVED_MASTER_LINKED_REVIEW_STAGE_VERSION, APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_VERSION, NARROW_MASTER_LINKED_REVIEW_STAGE_VERSION]
const stageKeys = [...Object.values(MASTER_LINKED_REVIEW_STAGE_KEYS), CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY, CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY, CATEGORY_MASTER_LINKED_REVIEW_STAGE_KEY, CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_KEY, APPROVED_MASTER_LINKED_REVIEW_STAGE_KEY, APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_KEY, NARROW_MASTER_LINKED_REVIEW_STAGE_KEY]
export const completedReviewProfile = (subject, mode, binding) => {
  if (isG1NarrowRequest(binding)) {
    need(mode === G1_MODES.GENUINE, 'NARROW_COMPLETION_MODE'); assertG1NarrowSubject(subject, binding)
    return { version: NARROW_COMPLETED_REVIEW_VERSION, artifactVersion: NARROW_COMPLETED_ARTIFACT_VERSION,
      stageVersion: NARROW_MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: NARROW_MASTER_LINKED_REVIEW_STAGE_KEY,
      providerConfigurationVersion: 'MASTER_LINKED_DOCX_NARROW_GENUINE_V1' }
  }
  if (isG1ApprovedRequest(binding)) {
    need(Object.values(G1_MODES).includes(mode), 'APPROVED_COMPLETION_MODE'); assertG1ApprovedSubject(subject, binding)
    if (mode === G1_MODES.QA) return { version: APPROVED_QA_COMPLETED_REVIEW_VERSION, artifactVersion: APPROVED_QA_COMPLETED_ARTIFACT_VERSION,
      stageVersion: APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: APPROVED_QA_MASTER_LINKED_REVIEW_STAGE_KEY,
      providerConfigurationVersion: 'MASTER_LINKED_DOCX_APPROVED_QA_V1' }
    return { version: APPROVED_COMPLETED_REVIEW_VERSION, artifactVersion: APPROVED_COMPLETED_ARTIFACT_VERSION,
      stageVersion: APPROVED_MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: APPROVED_MASTER_LINKED_REVIEW_STAGE_KEY,
      providerConfigurationVersion: 'MASTER_LINKED_DOCX_APPROVED_GENUINE_V1' }
  }
  if (isG1CategoryQaRequest(binding)) {
    need(Object.values(G1_MODES).includes(mode), 'COMPLETION_MODE'); assertG1CategoryQaSubject(subject, binding)
    if (mode === G1_MODES.GENUINE) return { version: CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION, artifactVersion: CATEGORY_GENUINE_COMPLETED_ARTIFACT_VERSION,
      stageVersion: CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: CATEGORY_GENUINE_MASTER_LINKED_REVIEW_STAGE_KEY,
      providerConfigurationVersion: 'MASTER_LINKED_DOCX_CATEGORY_GENUINE_V1' }
    return { version: CATEGORY_COMPLETED_REVIEW_VERSION, artifactVersion: CATEGORY_COMPLETED_ARTIFACT_VERSION,
      stageVersion: CATEGORY_MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: CATEGORY_MASTER_LINKED_REVIEW_STAGE_KEY,
      providerConfigurationVersion: 'MASTER_LINKED_DOCX_CATEGORY_QA_V1' }
  }
  if (subject?.contractVersion === 'master-linked-docx-review-subject.v3') {
    need(Object.values(G1_MODES).includes(mode), 'COMPLETION_MODE')
    return { version: CORRECTED_COMPLETED_REVIEW_VERSION, artifactVersion: CORRECTED_COMPLETED_ARTIFACT_VERSION,
      stageVersion: CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION,
      stageKey: mode === G1_MODES.QA ? CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY : CORRECTED_MASTER_LINKED_GENUINE_STAGE_KEY }
  }
  need(subject?.contractVersion === 'master-linked-docx-review-subject.v2', 'COMPLETION_SUBJECT_VERSION')
  return { version: COMPLETED_REVIEW_VERSION, artifactVersion: COMPLETED_ARTIFACT_VERSION,
    stageVersion: MASTER_LINKED_REVIEW_STAGE_VERSION, stageKey: MASTER_LINKED_REVIEW_STAGE_KEYS[mode] }
}
export const completedReviewKey = root => `MASTER_LINKED_DOCX_REVIEW_RESULT:${root}`
export const completedReviewFamily = root => {
  const digest = sha(root).slice(0, 40), result = { executionId: `master_docx_result_${digest}`, runtimeArtifactId: `master_docx_findings_${digest}`, stageExecutionId: `master_docx_stage_${digest}` }
  const version = /^SS055_NARROW_GENUINE_DOCX:/.test(root) ? NARROW_COMPLETED_REVIEW_VERSION
    : /^SS055_APPROVED_NETWORK_QA_DOCX:/.test(root) ? APPROVED_QA_COMPLETED_REVIEW_VERSION
    : /^SS055_APPROVED_GENUINE_DOCX:/.test(root) ? APPROVED_COMPLETED_REVIEW_VERSION
    : /^SS055_CATEGORY_GENUINE_DOCX:/.test(root) ? CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION
    : /^SS055_CATEGORY_NETWORK_QA_DOCX:/.test(root) ? CATEGORY_COMPLETED_REVIEW_VERSION
    : /^SS055_CORRECTED_(NETWORK_QA|GENUINE)_DOCX:/.test(root) ? CORRECTED_COMPLETED_REVIEW_VERSION : COMPLETED_REVIEW_VERSION
  const nativeId = (kind, role) => sha(`${version}:${root}:${kind}:${role}`).slice(0, 24)
  return { result, rowIds: Object.fromEntries(['result', 'artifact', 'stage'].map(k => [k, nativeId(k, 'row')])),
    audits: Object.fromEntries(['result', 'artifact', 'stage'].map(k => [k, { id: nativeId(k, 'audit'), signatureVersion: 3 }])) }
}
const assertPhaseRef = ref => need(exact(ref, ['executionId', 'bodyFingerprint']) && typeof ref.executionId === 'string'
  && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(ref.executionId) && hash(ref.bodyFingerprint), 'PHASE_REFERENCE')
const assertAuditRef = ref => need(exact(ref, ['id', 'signatureVersion']) && oid(ref.id) && ref.signatureVersion === 3, 'AUDIT_REFERENCE')
export const assertCompletedReviewInput = input => {
  need(exact(input, ['version', 'mode', 'sourceProof', 'scope', 'actorUserId', 'onceRoot', 'qaCase', 'plan', 'runtime', 'subject', 'binding',
    'grant', 'reservation', 'start', 'response', 'sourceRecords', 'result', 'audits', 'receipt', 'startedAt', 'completedAt'])
    && resultVersions.includes(input.version) && Object.values(G1_MODES).includes(input.mode)
    && exact(input.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(input.scope).every(oid) && oid(input.actorUserId)
    && ['STORED_SOURCE_RECORDS', 'SIGNED_IN_MEMORY_TEST_FIXTURE'].includes(input.sourceProof), 'INPUT_SHAPE')
  const profile = completedReviewProfile(input.subject, input.mode, input.binding)
  const roots = [g1SubjectRoot(input.subject, input.binding, input.mode, input.qaCase)]
  if (input.mode === G1_MODES.GENUINE && isG1ApprovedRequest(input.binding)) {
    roots.push(g1SubjectRoot(input.subject, input.binding, input.mode, input.qaCase, G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version))
  }
  need(input.version === profile.version && roots.includes(input.onceRoot), 'COMPLETION_VERSION_ROOT')
  if ([CORRECTED_COMPLETED_REVIEW_VERSION, CATEGORY_COMPLETED_REVIEW_VERSION, CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION, APPROVED_COMPLETED_REVIEW_VERSION, APPROVED_QA_COMPLETED_REVIEW_VERSION, NARROW_COMPLETED_REVIEW_VERSION].includes(input.version)) {
    if (input.version === NARROW_COMPLETED_REVIEW_VERSION) assertG1NarrowSubject(input.subject, input.binding)
    else if ([APPROVED_COMPLETED_REVIEW_VERSION, APPROVED_QA_COMPLETED_REVIEW_VERSION].includes(input.version)) assertG1ApprovedSubject(input.subject, input.binding)
    else if ([CATEGORY_COMPLETED_REVIEW_VERSION, CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION].includes(input.version)) assertG1CategoryQaSubject(input.subject, input.binding)
    else assertG1CorrectedSubject(input.subject, input.binding)
    need(input.sourceProof === 'STORED_SOURCE_RECORDS' && input.actorUserId === input.subject.actorUserId
      && same(input.scope, input.subject.binding.masterReference.scope), 'CORRECTED_COMPLETION_SOURCE')
  } else assertMasterLinkedPreparedSubject(input.subject, input.binding, input.scope, input.actorUserId)
  if (input.mode === G1_MODES.GENUINE) {
    need(input.qaCase === '' && input.sourceProof === 'STORED_SOURCE_RECORDS', 'GENUINE_SOURCE_PROOF')
    if (![CORRECTED_COMPLETED_REVIEW_VERSION, CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION, APPROVED_COMPLETED_REVIEW_VERSION, NARROW_COMPLETED_REVIEW_VERSION].includes(input.version)) assertG1FixedSubject(input.subject, input.binding)
  }
  const plan = input.plan, runtime = input.runtime
  need(exact(plan, ['recordId', 'planId', 'planVersion', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'])
    && oid(plan.recordId) && token(plan.planId) && token(plan.requestId) && Number.isSafeInteger(plan.planVersion) && plan.planVersion > 0
    && ['planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(k => hash(plan[k]))
    && exact(runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(k => token(runtime[k]))
    && ['packageKey', 'packageVersion'].every(k => typeof runtime[k] === 'string' && runtime[k].length <= 120), 'PLAN_RUNTIME')
  ;['grant', 'reservation', 'start'].forEach(k => assertPhaseRef(input[k]))
  const family = completedReviewFamily(input.onceRoot)
  need(same(input.result, family.result) && same(input.audits, family.audits), 'RESULT_FAMILY')
  Object.values(input.audits).forEach(assertAuditRef)
  const response = input.response, identity = response?.identity
  need(exact(response, ['auditId', 'signatureVersion', 'diffFingerprint', 'identity']) && oid(response.auditId) && response.signatureVersion === 3 && hash(response.diffFingerprint)
    && exact(identity, ['responseId', 'postRequestId', 'provider', 'model', 'accountFingerprint']) && typeof identity.responseId === 'string'
    && /^resp_[A-Za-z0-9_-]{1,195}$/.test(identity.responseId) && typeof identity.postRequestId === 'string'
    && (identity.postRequestId === '' || /^[A-Za-z0-9._:-]{1,200}$/.test(identity.postRequestId))
    && identity.provider === 'OPENAI' && identity.model === 'gpt-5.2' && hash(identity.accountFingerprint), 'RESPONSE_IDENTITY')
  need(exact(input.sourceRecords, ['master', 'candidate', 'preview']), 'SOURCE_RECORDS')
  for (const ref of Object.values(input.sourceRecords)) need(exact(ref, ['storageId', 'bodyFingerprint', 'auditId', 'auditSignatureVersion'])
    && oid(ref.storageId) && hash(ref.bodyFingerprint) && oid(ref.auditId) && Number.isSafeInteger(ref.auditSignatureVersion) && ref.auditSignatureVersion > 0, 'SOURCE_REFERENCE')
  const ref = input.subject.binding.masterReference
  need(same(input.sourceRecords.master, { storageId: ref.storageId, bodyFingerprint: ref.bodyFingerprint, auditId: ref.auditId, auditSignatureVersion: ref.auditSignatureVersion })
    && input.sourceRecords.candidate.bodyFingerprint === input.subject.binding.candidateBodyFingerprint, 'SOURCE_REFERENCE_BINDING')
  const receipt = input.receipt, binding = input.subject.binding
  const approved = [APPROVED_COMPLETED_REVIEW_VERSION, APPROVED_QA_COMPLETED_REVIEW_VERSION].includes(input.version)
  const narrow = input.version === NARROW_COMPLETED_REVIEW_VERSION
  const category = narrow || [CATEGORY_COMPLETED_REVIEW_VERSION, CATEGORY_GENUINE_COMPLETED_REVIEW_VERSION, APPROVED_COMPLETED_REVIEW_VERSION, APPROVED_QA_COMPLETED_REVIEW_VERSION].includes(input.version)
  need(exact(receipt, ['version', 'mode', 'requestIdentity', 'subjectFingerprint', 'contextFingerprint', 'policyFingerprint', 'responseId', 'postRequestId',
    'grant', 'reservation', 'start', 'provider', 'returnedModel', 'terminalStatus', 'latencyMs', 'pages', 'inputFingerprint', 'docxChecksum', 'tokenUsage', 'storeRequested', 'temporaryProviderStorageForPolling',
    ...(category ? ['requestVersion', 'responseVersion'] : [])])
    && receipt.version === (narrow ? 'master-linked-docx-visual-review-receipt.v5' : approved ? 'master-linked-docx-visual-review-receipt.v4' : category ? 'master-linked-docx-visual-review-receipt.v3' : 'master-linked-docx-visual-review-receipt.v2') && receipt.mode === input.mode
    && (!category || receipt.requestVersion === (narrow ? 'master-linked-docx-visual-review-request.v5' : approved ? 'master-linked-docx-visual-review-request.v4' : 'master-linked-docx-visual-review-request.v3') && receipt.responseVersion === MASTER_LINKED_CATEGORY_RESPONSE_VERSION)
    && Object.entries(input.binding).every(([k, v]) => receipt[k] === v)
    && ['grant', 'reservation', 'start'].every(k => same(receipt[k], input[k]))
    && receipt.responseId === identity.responseId && receipt.postRequestId === identity.postRequestId
    && same(receipt.provider, input.subject.transport) && typeof receipt.returnedModel === 'string'
    && (receipt.returnedModel === 'gpt-5.2' || /^gpt-5\.2-\d{4}-\d{2}-\d{2}$/.test(receipt.returnedModel))
    && receipt.terminalStatus === 'completed' && Number.isSafeInteger(receipt.latencyMs) && receipt.latencyMs >= 0 && receipt.latencyMs < 300000
    && same(receipt.pages, binding.pages) && receipt.inputFingerprint === binding.inputFingerprint && receipt.docxChecksum === binding.docxChecksum
    && exact(receipt.tokenUsage, ['inputTokens', 'outputTokens', 'totalTokens']) && Object.values(receipt.tokenUsage).every(v => v === null || Number.isSafeInteger(v) && v >= 0)
    && receipt.storeRequested === false && receipt.temporaryProviderStorageForPolling === true
    && iso(input.startedAt) === input.startedAt && iso(input.completedAt) === input.completedAt
    && Date.parse(input.completedAt) - Date.parse(input.startedAt) === receipt.latencyMs, 'OWNED_RECEIPT')
  return input
}
const stageFields = ['stageExecutionId', 'qualityRunId', 'contractVersion', 'tenantId', 'customerId', 'runtimeInstanceId', 'runtimeInstanceKey',
  'knowledgeCompositionPlanRecordId', 'planId', 'requestId', 'planVersion', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint', 'stageKey',
  'stageOrder', 'attemptNumber', 'predecessorStageExecutionId', 'predecessorAttemptFingerprint', 'status', 'inputFingerprint', 'outputFingerprint',
  'renditionInputSnapshot', 'outputSnapshot', 'failure', 'executionIdentity', 'assignedActivationCount', 'contributingActivationCount', 'truthReferenceCount',
  'startedAt', 'completedAt', 'durationMs', 'createdBy']
const stageMaterial = row => Object.fromEntries(stageFields.filter(k => row[k] !== undefined).map(k => [k,
  ['tenantId', 'customerId', 'runtimeInstanceId', 'knowledgeCompositionPlanRecordId', 'createdBy'].includes(k) ? String(row[k])
    : ['startedAt', 'completedAt'].includes(k) ? iso(row[k]) : row[k]]))
export const completedStageReference = row => ({ stageExecutionId: row.stageExecutionId, attemptFingerprint: row.attemptFingerprint,
  inputFingerprint: row.inputFingerprint, outputFingerprint: row.outputFingerprint })
const failedReview = () => ({ failureCode: 'MASTER_LINKED_RENDITION_REQUIRES_CHANGE', safeReason: 'The document presentation needs changes. Approval remains held.', retryable: false })
export const buildCompletedReviewStage = (input, output) => {
  assertCompletedReviewInput(input)
  const profile = completedReviewProfile(input.subject, input.mode, input.binding)
  const findings = normalizeRenderedExpressionRlOutput(output, () => completedReviewFailure('FINDINGS_INVALID')), plan = input.plan
  const activations = new Set(Object.values(input.subject.packs).map(p => p.activationId)).size
  const row = { stageExecutionId: input.result.stageExecutionId, qualityRunId: `master_docx_review_${sha(input.onceRoot).slice(0, 40)}`,
    contractVersion: profile.stageVersion, ...input.scope, runtimeInstanceKey: input.runtime.runtimeInstanceKey,
    knowledgeCompositionPlanRecordId: plan.recordId, ...Object.fromEntries(['planId', 'requestId', 'planVersion', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, plan[k]])),
    stageKey: profile.stageKey, stageOrder: 0, attemptNumber: 1, predecessorStageExecutionId: '', predecessorAttemptFingerprint: '',
    status: findings.overallStatus === 'PASS' ? 'SUCCEEDED' : 'FAILED', inputFingerprint: membershipHash(input), outputFingerprint: membershipHash(findings),
    renditionInputSnapshot: input, outputSnapshot: findings, ...(findings.overallStatus === 'FAIL' ? { failure: failedReview() } : {}),
    executionIdentity: { executionMode: input.mode === G1_MODES.QA ? 'DETERMINISTIC_TEST' : 'LIVE_TEST', providerKey: 'openai',
      providerConfigurationVersion: profile.providerConfigurationVersion || input.subject.transport.configurationVersion, model: 'gpt-5.2', grrExecutionId: input.result.executionId,
      grrRuntimeArtifactId: input.result.runtimeArtifactId, runtimeVersion: profile.version },
    assignedActivationCount: activations, contributingActivationCount: activations, truthReferenceCount: 0,
    startedAt: input.startedAt, completedAt: input.completedAt, durationMs: input.receipt.latencyMs, createdBy: input.actorUserId }
  row.attemptFingerprint = membershipHash(stageMaterial(row)); return row
}
export const assertCompletedReviewStage = value => {
  const row = value?.toObject ? value.toObject({ depopulate: true }) : value, input = assertCompletedReviewInput(row?.renditionInputSnapshot)
  const expected = buildCompletedReviewStage(input, row.outputSnapshot)
  need(refId(row._id) && String(row._id) === completedReviewFamily(input.onceRoot).rowIds.stage
    && row.contractVersion === expected.contractVersion && row.inputSnapshot === undefined && row.draftId === undefined && row.draftIterationId === undefined
    && same(stageMaterial(row), stageMaterial(expected)) && row.attemptFingerprint === expected.attemptFingerprint, 'STAGE_BINDING')
  return row
}
const sourceScope = (row, input) => Object.entries(input.scope).every(([k, v]) => refId(row[k]) && String(row[k]) === v)
const empty = (row, keys) => keys.every(k => row[k] === undefined || exact(row[k], []))
export const assertCompletedReviewResult = row => {
  const e = row?.executionEvidence?.masterLinkedCompletedReview, b = e?.body, input = b?.input
  need(row && resultVersions.includes(row.contractVersion) && row.status === COMPLETED_REVIEW_STATUS && row.outputTypeKey === COMPLETED_REVIEW_OUTPUT
    && exact(row.executionEvidence, ['masterLinkedCompletedReview']) && exact(e, ['body', 'bodyFingerprint'])
    && exact(b, ['version', 'input', 'reviewStatus', 'stage', 'artifact', ...Object.keys(falseFlags)]) && b.version === row.contractVersion, 'RESULT_SHAPE')
  assertCompletedReviewInput(input)
  need(row.contractVersion === input.version, 'RESULT_VERSION')
  const family = completedReviewFamily(input.onceRoot)
  need(refId(row._id) && String(row._id) === family.rowIds.result && sourceScope(row, input) && row.executionId === input.result.executionId
    && row.idempotencyKey === completedReviewKey(input.onceRoot) && row.requestFingerprint === input.binding.requestIdentity
    && row.providerMode === (input.mode === G1_MODES.QA ? 'DETERMINISTIC_TEST' : 'LIVE_TEST')
    && same(row.provider, { mode: input.mode, provenance: input.mode === G1_MODES.QA ? 'NETWORK_QA' : 'GEN', state: 'COMPLETED', receipt: input.receipt })
    && Object.entries(input.runtime).every(([k, v]) => row[k] === v) && row.workspaceType === 'PLATFORM'
    && row.requestedOutputTypeKey === 'master-linked-docx-review-result' && row.executionIntent === 'Record exact completed master-linked review findings without approval.'
    && same(row.reasoningContext, falseFlags) && Object.entries(falseFlags).every(([k, v]) => b[k] === v)
    && refId(row.requestedBy) && String(row.requestedBy) === input.actorUserId && iso(row.requestedAt) === input.startedAt && iso(row.completedAt) === input.completedAt
    && row.failureReason === null && same(row.artifactIds, [input.result.runtimeArtifactId])
    && same(row.auditLogIds, ['result', 'artifact', 'stage'].map(k => input.audits[k].id)) && same(row.warnings, []) && same(row.limitations, [])
    && empty(row, ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites'])
    && e.bodyFingerprint === membershipHash(b) && ['PASS', 'FAIL'].includes(b.reviewStatus)
    && exact(b.stage, ['stageExecutionId', 'attemptFingerprint', 'inputFingerprint', 'outputFingerprint']) && b.stage.stageExecutionId === input.result.stageExecutionId
    && b.stage.inputFingerprint === membershipHash(input) && ['attemptFingerprint', 'inputFingerprint', 'outputFingerprint'].every(k => hash(b.stage[k]))
    && exact(b.artifact, ['runtimeArtifactId', 'bodyFingerprint']) && b.artifact.runtimeArtifactId === input.result.runtimeArtifactId && hash(b.artifact.bodyFingerprint), 'RESULT_BINDING')
  return b
}
export const assertCompletedReviewArtifact = row => {
  const e = row?.lineageSummary?.masterLinkedCompletedReview, b = e?.body
  need(artifactVersions.includes(row?.contractVersion) && row.artifactType === COMPLETED_ARTIFACT_TYPE && row.outputTypeKey === COMPLETED_REVIEW_OUTPUT
    && row.status === 'GENERATED' && exact(row.lineageSummary, ['masterLinkedCompletedReview']) && exact(e, ['body', 'bodyFingerprint', 'audit'])
    && exact(b, ['version', 'input', 'stage', 'outputFingerprint']) && b.version === row.contractVersion, 'ARTIFACT_SHAPE')
  const input = assertCompletedReviewInput(b.input), family = completedReviewFamily(input.onceRoot), stage = buildCompletedReviewStage(input, row.generatedOutput)
  need(row.contractVersion === completedReviewProfile(input.subject, input.mode, input.binding).artifactVersion, 'ARTIFACT_VERSION')
  need(refId(row._id) && String(row._id) === family.rowIds.artifact && sourceScope(row, input) && row.runtimeArtifactId === input.result.runtimeArtifactId
    && row.executionId === input.result.executionId && row.runtimeInstanceKey === input.runtime.runtimeInstanceKey && row.frameworkKey === input.runtime.frameworkKey
    && row.requestedOutputTypeKey === 'master-linked-docx-review-result' && row.markdown === '' && same(row.warnings, []) && same(row.limitations, [])
    && empty(row, ['safeJson', 'certification']) && refId(row.generatedBy) && String(row.generatedBy) === input.actorUserId && iso(row.generatedAt) === input.completedAt
    && same(row.generatedOutput, stage.outputSnapshot) && same(b.stage, completedStageReference(stage)) && b.outputFingerprint === stage.outputFingerprint
    && e.bodyFingerprint === membershipHash(b) && same(e.audit, input.audits.artifact), 'ARTIFACT_BINDING')
  return b
}
export const completedAuditDiff = (kind, row, input) => ({ version: input.version, mode: input.mode, onceRoot: input.onceRoot, kind,
  resultExecutionId: input.result.executionId, bodyFingerprint: kind === 'stage' ? row.attemptFingerprint
    : kind === 'result' ? row.executionEvidence.masterLinkedCompletedReview.bodyFingerprint : row.lineageSummary.masterLinkedCompletedReview.bodyFingerprint,
  request: input.binding })
export const assertCompletedReviewAudit = (kind, row, audit, input, verify) => {
  const ref = input.audits[kind], resource = { result: 'GovernedReasoningExecution', artifact: 'GovernedRuntimeArtifact', stage: 'OutcomeQualityStageExecution' }[kind]
  need(audit && refId(audit._id) && String(audit._id) === ref.id && audit.signatureVersion === 3 && audit.action === COMPLETED_REVIEW_ACTIONS[kind]
    && audit.resourceType === resource && refId(audit.resourceId) && String(audit.resourceId) === String(row._id)
    && refId(audit.actorUserId) && String(audit.actorUserId) === input.actorUserId && completedBoundScope(audit.scope, input.scope)
    && exact(audit.diff, Object.keys(completedAuditDiff(kind, row, input))) && same(audit.diff, completedAuditDiff(kind, row, input)) && verify(audit) === true, 'SIGNED_BUNDLE_AUDIT')
}
export const hasCompletedReviewIdentity = v => resultVersions.includes(String(v?.contractVersion || '').trim())
  || String(v?.status || '').trim().toUpperCase() === COMPLETED_REVIEW_STATUS || String(v?.outputTypeKey || '').trim().toUpperCase() === COMPLETED_REVIEW_OUTPUT
  || String(v?.idempotencyKey || '').trim().startsWith('MASTER_LINKED_DOCX_REVIEW_RESULT:') || String(v?.executionId || '').trim().startsWith('master_docx_result_')
  || v?.executionEvidence?.masterLinkedCompletedReview !== undefined
export const hasCompletedArtifactIdentity = v => artifactVersions.includes(String(v?.contractVersion || '').trim())
  || String(v?.artifactType || '').trim().toUpperCase() === COMPLETED_ARTIFACT_TYPE || String(v?.outputTypeKey || '').trim().toUpperCase() === COMPLETED_REVIEW_OUTPUT
  || String(v?.runtimeArtifactId || '').trim().startsWith('master_docx_findings_') || v?.lineageSummary?.masterLinkedCompletedReview !== undefined
export const hasCompletedStageIdentity = v => stageVersions.includes(String(v?.contractVersion || '').trim())
  || stageKeys.includes(String(v?.stageKey || '').trim().toUpperCase())
  || resultVersions.includes(v?.renditionInputSnapshot?.version) || String(v?.stageExecutionId || '').trim().startsWith('master_docx_stage_')
export const completedResultFilter = { $or: [{ contractVersion: { $in: resultVersions } }, { status: COMPLETED_REVIEW_STATUS }, { outputTypeKey: COMPLETED_REVIEW_OUTPUT },
  { idempotencyKey: /^MASTER_LINKED_DOCX_REVIEW_RESULT:/ }, { executionId: /^master_docx_result_/ }, { 'executionEvidence.masterLinkedCompletedReview': { $exists: true } }] }
export const completedArtifactFilter = { $or: [{ contractVersion: { $in: artifactVersions } }, { artifactType: COMPLETED_ARTIFACT_TYPE }, { outputTypeKey: COMPLETED_REVIEW_OUTPUT },
  { runtimeArtifactId: /^master_docx_findings_/ }, { 'lineageSummary.masterLinkedCompletedReview': { $exists: true } }] }
export const completedStageFilter = { $or: [{ contractVersion: { $in: stageVersions } }, { stageKey: { $in: stageKeys } },
  { stageExecutionId: /^master_docx_stage_/ }, { 'renditionInputSnapshot.version': { $in: resultVersions } }] }
export const carriesCompletedReviewValue = value => typeof value === 'string'
  ? [...resultVersions, ...artifactVersions, COMPLETED_REVIEW_STATUS, COMPLETED_REVIEW_OUTPUT, COMPLETED_ARTIFACT_TYPE,
    ...stageVersions, ...stageKeys].some(v => value.trim().toUpperCase() === v.toUpperCase())
    || /^(?:master_docx_(?:result|findings|stage)_|MASTER_LINKED_DOCX_REVIEW_RESULT:)/i.test(value.trim())
  : value && typeof value === 'object' && Object.entries(value).some(([k, v]) => k.includes('masterLinkedCompletedReview') || carriesCompletedReviewValue(v))
