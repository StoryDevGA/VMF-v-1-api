import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { assertRenditionQualityStageInput, isRenditionQualityStageTime } from './outcomeRenditionQualityStageContract.js'
import { RENDITION_RESULT_VERSION, RENDITION_RESULT_STATUS, RENDITION_REVIEW_OUTPUT, RENDITION_TRANSPORT } from './outcomeRenditionReviewClaimContract.js'
import { normalizeRenderedExpressionRlOutput } from '../utils/outcomeRenderedExpressionRlOutput.js'
import { buildCanonicalJson } from './governanceAudit/checksumService.js'

export const RENDITION_REVIEW_ARTIFACT_VERSION = 'outcome-rendition-review-artifact.v1'
export const RENDITION_RESULT_ACTION = 'GOVERNED_RENDITION_REVIEW_RESULT_RECORDED'
export const RENDITION_ARTIFACT_ACTION = 'GOVERNED_RENDITION_REVIEW_ARTIFACT_RECORDED'
export const RENDITION_STAGE_ACTION = 'GOVERNED_RENDITION_QUALITY_STAGE_RECORDED'
export const renditionResultKey = planId => `DOCX_RENDITION_REVIEW_RESULT:${planId}`
export const renditionResultError = (reason, status = 409) => Object.assign(new Error('The document review result cannot be confirmed.'), {
  code: 'RENDITION_REVIEW_RESULT_BLOCKED', status, details: { reason, completionConfirmed: false, approvalAvailable: false },
})
const need = (condition, reason) => { if (!condition) throw renditionResultError(reason) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(field => Object.hasOwn(value, field))
const same = (a, b) => buildCanonicalJson(a) === buildCanonicalJson(b)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const oid = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const prefixed = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[a-f0-9-]{36}$`).test(value)
const iso = value => isRenditionQualityStageTime(value) ? new Date(value).toISOString() : ''
const emptyDefaults = record => ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites']
  .every(field => record[field] === undefined || exact(record[field], []))
const stageReference = stage => ({ stageExecutionId: stage.stageExecutionId, attemptFingerprint: stage.attemptFingerprint,
  inputFingerprint: stage.inputFingerprint, outputFingerprint: stage.outputFingerprint })
export const renditionStageReference = stageReference
const assertStageReference = (stage, input) => {
  need(exact(stage, ['stageExecutionId', 'attemptFingerprint', 'inputFingerprint', 'outputFingerprint'])
    && prefixed(stage.stageExecutionId, 'rendition_quality_stage_')
    && ['attemptFingerprint', 'inputFingerprint', 'outputFingerprint'].every(field => hash(stage[field]))
    && stage.inputFingerprint === membershipHash(input), 'STAGE_REFERENCE')
}
const assertAuditReference = reference => need(exact(reference, ['id', 'signatureVersion']) && oid(reference.id)
  && Number.isSafeInteger(reference.signatureVersion) && reference.signatureVersion > 0, 'AUDIT_REFERENCE')
const assertCommonBody = body => {
  const input = assertRenditionQualityStageInput(body.input)
  assertStageReference(body.stage, input)
  need(iso(body.startedAt) === body.startedAt && iso(body.completedAt) === body.completedAt
    && Date.parse(body.completedAt) - Date.parse(body.startedAt) >= input.receipt.latencyMs
    && Date.parse(body.completedAt) - Date.parse(body.startedAt) <= 86400000, 'RESULT_TIMES')
  return input
}

export const assertRenditionResultRecord = record => {
  const evidence = record?.executionEvidence?.renditionReview, body = evidence?.body
  need(record?.contractVersion === RENDITION_RESULT_VERSION && record.status === RENDITION_RESULT_STATUS
    && record.outputTypeKey === RENDITION_REVIEW_OUTPUT && record.providerMode === 'LIVE_TEST'
    && exact(record.executionEvidence, ['renditionReview']) && exact(evidence, ['body', 'resultFingerprint', 'audits'])
    && exact(body, ['contractVersion', 'executionId', 'input', 'stage', 'artifact', 'startedAt', 'completedAt', 'reviewStatus',
      'approvalAvailable', 'deliveryAvailable']) && body.contractVersion === RENDITION_RESULT_VERSION
    && prefixed(body.executionId, 'grr_rendition_result_') && body.executionId === record.executionId
    && ['PASS', 'FAIL'].includes(body.reviewStatus) && body.approvalAvailable === false && body.deliveryAvailable === false, 'RESULT_SHAPE')
  const input = assertCommonBody(body), { subject, runtime } = input
  need(body.executionId === input.result.executionId && exact(body.artifact, ['runtimeArtifactId', 'artifactFingerprint'])
    && body.artifact.runtimeArtifactId === input.result.runtimeArtifactId && hash(body.artifact.artifactFingerprint)
    && Object.keys(subject.scope).every(field => String(record[field]) === subject.scope[field])
    && Object.keys(runtime).every(field => record[field] === runtime[field])
    && record.requestedBy?.toString() === subject.actorUserId
    && record.requestFingerprint === input.binding.subjectFingerprint && record.idempotencyKey === renditionResultKey(subject.source.plan.planId)
    && iso(record.requestedAt) === body.startedAt && iso(record.completedAt) === body.completedAt
    && evidence.resultFingerprint === membershipHash(body) && same(record.artifactIds, [body.artifact.runtimeArtifactId])
    && exact(record.provider, [...Object.keys(RENDITION_TRANSPORT), 'state', 'receipt'])
    && same(record.provider, { ...RENDITION_TRANSPORT, state: 'COMPLETED', receipt: input.receipt })
    && exact(record.reasoningContext, ['contentVisible', 'packContentLoaded', 'dispatchAvailable', 'approvalAvailable'])
    && same(record.reasoningContext, { contentVisible: false, packContentLoaded: true, dispatchAvailable: false, approvalAvailable: false })
    && emptyDefaults(record) && record.requestedOutputTypeKey === 'docx-rendition-review-result'
    && record.executionIntent === 'Record one completed private DOCX visual review without approving delivery.'
    && record.failureReason === null && record.warnings?.length === 0 && record.limitations?.length === 0, 'RESULT_BINDING')
  need(exact(evidence.audits, ['result', 'artifact', 'stage']), 'RESULT_AUDITS')
  Object.values(evidence.audits).forEach(assertAuditReference)
  need(new Set(Object.values(evidence.audits).map(ref => ref.id)).size === 3
    && same(record.auditLogIds, ['result', 'artifact', 'stage'].map(kind => evidence.audits[kind].id)), 'RESULT_AUDITS')
  return body
}

export const assertRenditionReviewArtifact = record => {
  const evidence = record?.lineageSummary?.renditionReview, body = evidence?.body
  need(record?.contractVersion === RENDITION_REVIEW_ARTIFACT_VERSION && record.artifactType === 'DOCX_RENDITION_REVIEW'
    && record.outputTypeKey === RENDITION_REVIEW_OUTPUT && record.status === 'GENERATED'
    && exact(record.lineageSummary, ['renditionReview']) && exact(evidence, ['body', 'artifactFingerprint', 'audit'])
    && exact(body, ['contractVersion', 'input', 'stage', 'startedAt', 'completedAt'])
    && body.contractVersion === RENDITION_REVIEW_ARTIFACT_VERSION, 'ARTIFACT_SHAPE')
  const input = assertCommonBody(body), { subject, runtime } = input
  const output = normalizeRenderedExpressionRlOutput(record.generatedOutput, () => renditionResultError('ARTIFACT_FINDINGS'))
  need(same(record.generatedOutput, output) && body.stage.outputFingerprint === membershipHash(output)
    && record.runtimeArtifactId === input.result.runtimeArtifactId && record.executionId === input.result.executionId
    && Object.keys(subject.scope).every(field => String(record[field]) === subject.scope[field])
    && record.runtimeInstanceKey === runtime.runtimeInstanceKey && record.frameworkKey === runtime.frameworkKey
    && String(record.generatedBy) === subject.actorUserId && iso(record.generatedAt) === body.completedAt
    && record.requestedOutputTypeKey === 'docx-rendition-review-result' && record.markdown === ''
    && ['safeJson', 'certification'].every(field => record[field] === undefined || exact(record[field], []))
    && record.warnings?.length === 0 && record.limitations?.length === 0
    && evidence.artifactFingerprint === membershipHash(body), 'ARTIFACT_BINDING')
  assertAuditReference(evidence.audit)
  return body
}

export const renditionResultAuditDiff = record => {
  const { body, resultFingerprint } = record.executionEvidence.renditionReview
  return { executionId: record.executionId, resultFingerprint, runtimeArtifactId: body.artifact.runtimeArtifactId,
    stageExecutionId: body.stage.stageExecutionId, reviewStatus: body.reviewStatus, approvalAvailable: false }
}
export const renditionArtifactAuditDiff = record => ({ runtimeArtifactId: record.runtimeArtifactId,
  executionId: record.executionId, artifactFingerprint: record.lineageSummary.renditionReview.artifactFingerprint,
  stageExecutionId: record.lineageSummary.renditionReview.body.stage.stageExecutionId })
export const renditionQualityStageAuditDiff = stage => ({ ...stageReference(stage),
  executionId: stage.renditionInputSnapshot.result.executionId, reviewStatus: stage.outputSnapshot.overallStatus, approvalAvailable: false })
export const assertSignedRenditionResultAudit = ({ audit, reference, action, resourceType, resourceId, input, diff, verifySignature }) => {
  assertAuditReference(reference)
  need(audit && String(audit._id) === reference.id && audit.signatureVersion === reference.signatureVersion
    && audit.action === action && audit.resourceType === resourceType && String(audit.resourceId) === String(resourceId)
    && String(audit.actorUserId) === input.subject.actorUserId
    && Object.keys(input.subject.scope).every(field => String(audit.scope?.[field]) === input.subject.scope[field])
    && exact(audit.diff, Object.keys(diff)) && same(audit.diff, diff) && verifySignature(audit) === true, 'SIGNED_RESULT_AUDIT')
}

const normalized = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
export const hasRenditionReviewArtifactIdentity = row => (typeof row?.contractVersion === 'string' && row.contractVersion.trim() === RENDITION_REVIEW_ARTIFACT_VERSION)
  || normalized(row?.artifactType) === 'DOCX_RENDITION_REVIEW' || normalized(row?.outputTypeKey) === RENDITION_REVIEW_OUTPUT
  || row?.lineageSummary?.renditionReview !== undefined || (typeof row?.runtimeArtifactId === 'string' && row.runtimeArtifactId.trim().startsWith('artifact_rendition_review_'))
export const reservedRenditionArtifactFilter = { $or: [{ contractVersion: RENDITION_REVIEW_ARTIFACT_VERSION },
  { artifactType: 'DOCX_RENDITION_REVIEW' }, { outputTypeKey: RENDITION_REVIEW_OUTPUT }, { 'lineageSummary.renditionReview': { $exists: true } },
  { runtimeArtifactId: /^artifact_rendition_review_/ }] }
