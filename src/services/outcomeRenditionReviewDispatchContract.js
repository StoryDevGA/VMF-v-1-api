import { createHash } from 'node:crypto'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { RENDITION_DISPATCH_VERSION, RENDITION_DISPATCH_STATUS, RENDITION_REVIEW_OUTPUT, RENDITION_TRANSPORT } from './outcomeRenditionReviewClaimContract.js'

export const RENDITION_DISPATCH_ACTION = 'GOVERNED_RENDITION_REVIEW_DISPATCH_RESERVED'
export const RENDITION_RESPONSE_ACTION = 'GOVERNED_RENDITION_REVIEW_RESPONSE_IDENTIFIED'
export const RENDITION_UNCERTAINTY_ACTION = 'GOVERNED_RENDITION_REVIEW_UNCERTAINTY_RECORDED'
export const renditionDispatchError = (reason, status = 409) => Object.assign(new Error('The saved document review dispatch is held.'), {
  code: 'RENDITION_REVIEW_DISPATCH_BLOCKED', status, details: { reason, dispatchAvailable: false },
})
const need = (value, reason) => { if (!value) throw renditionDispatchError(reason) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const oid = value => /^[a-f0-9]{24}$/.test(String(value || ''))
const token = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value)
const same = (a, b) => membershipHash(a) === membershipHash(b)
export const renditionDispatchKey = planId => `DOCX_RENDITION_REVIEW_DISPATCH:${planId}`
export const assertRenditionDispatchBinding = binding => {
  need(exact(binding, ['requestIdentity', 'subjectFingerprint', 'contextFingerprint']) && Object.values(binding).every(hash), 'DISPATCH_BINDING_INVALID')
  return binding
}
export const renditionDispatchAuditDiff = record => ({ executionId: record.executionId,
  reservationFingerprint: record.executionEvidence.renditionReview.reservationFingerprint,
  claimExecutionId: record.executionEvidence.renditionReview.body.claimExecutionId,
  requestIdentity: record.requestFingerprint, state: 'RESERVED_NOT_CONFIRMED_SUBMITTED', dispatchAvailable: false })
export const assertRenditionDispatchRecord = record => {
  const evidence = record?.executionEvidence, reservation = evidence?.renditionReview, body = reservation?.body
  need(record?.contractVersion === RENDITION_DISPATCH_VERSION && record.outputTypeKey === RENDITION_REVIEW_OUTPUT
    && record.status === RENDITION_DISPATCH_STATUS && record.providerMode === 'LIVE_TEST'
    && exact(evidence, ['renditionReview']) && exact(reservation, ['body', 'reservationFingerprint', 'auditId', 'auditSignatureVersion'])
    && exact(body, ['contractVersion', 'executionId', 'claimExecutionId', 'claimFingerprint', 'scope', 'actorUserId', 'planId', 'runtime',
      'subjectFingerprint', 'requestIdentity', 'contextFingerprint', 'createdAt', 'state', 'dispatchAvailable'])
    && body.contractVersion === RENDITION_DISPATCH_VERSION && /^grr_rendition_dispatch_[a-f0-9-]{36}$/.test(body.executionId || '')
    && record.executionId === body.executionId && /^grr_rendition_claim_[a-f0-9-]{36}$/.test(body.claimExecutionId || '')
    && hash(body.claimFingerprint) && token(body.planId) && oid(body.actorUserId)
    && exact(body.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(body.scope).every(oid)
    && Object.keys(body.scope).every(key => String(record[key]) === body.scope[key])
    && body.state === 'RESERVED_NOT_CONFIRMED_SUBMITTED' && body.dispatchAvailable === false
    && Number.isFinite(Date.parse(body.createdAt)) && new Date(body.createdAt).toISOString() === body.createdAt
    && oid(reservation.auditId) && Number.isSafeInteger(reservation.auditSignatureVersion) && reservation.auditSignatureVersion > 0, 'DISPATCH_RECORD_SHAPE')
  assertRenditionDispatchBinding(Object.fromEntries(['requestIdentity', 'subjectFingerprint', 'contextFingerprint'].map(key => [key, body[key]])))
  need(exact(body.runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(key => token(body.runtime[key]))
    && ['packageKey', 'packageVersion'].every(key => typeof body.runtime[key] === 'string' && body.runtime[key].length <= 120)
    && Object.keys(body.runtime).every(key => record[key] === body.runtime[key])
    && record.requestFingerprint === body.requestIdentity && reservation.reservationFingerprint === membershipHash(body)
    && record.idempotencyKey === renditionDispatchKey(body.planId) && String(record.requestedBy) === body.actorUserId
    && new Date(record.requestedAt).toISOString() === body.createdAt && record.completedAt === null
    && record.artifactIds?.length === 0 && record.auditLogIds?.length === 1 && record.auditLogIds[0] === String(reservation.auditId)
    && same(record.provider, { ...RENDITION_TRANSPORT, state: body.state })
    && same(record.reasoningContext, { contentVisible: false, packContentLoaded: false, dispatchAvailable: false })
    && ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites'].every(key => record[key] === undefined || exact(record[key], []))
    && record.requestedOutputTypeKey === 'docx-rendition-review-dispatch'
    && record.executionIntent === 'Reserve one exact private DOCX visual review submission.'
    && record.failureReason === null && record.warnings?.length === 0 && record.limitations?.length === 0, 'DISPATCH_RECORD_BINDING')
  return body
}
export const assertRenditionDispatchAudit = (record, audit, verifySignature) => {
  const reservation = record.executionEvidence.renditionReview, body = reservation.body
  need(audit && String(audit._id) === String(reservation.auditId) && audit.signatureVersion === reservation.auditSignatureVersion
    && audit.action === RENDITION_DISPATCH_ACTION && audit.resourceType === 'GovernedReasoningExecution'
    && String(audit.resourceId) === String(record._id) && String(audit.actorUserId) === body.actorUserId
    && Object.keys(body.scope).every(key => String(audit.scope?.[key]) === body.scope[key])
    && same(audit.diff, renditionDispatchAuditDiff(record)) && verifySignature(audit) === true, 'DISPATCH_SIGNED_AUDIT_INVALID')
}
export const renditionReceiptId = (kind, executionId) => {
  need(['RESPONSE', 'UNCERTAINTY'].includes(kind) && /^grr_rendition_dispatch_[a-f0-9-]{36}$/.test(executionId || ''), 'RECEIPT_IDENTITY_INVALID')
  return createHash('sha256').update(`outcome-rendition-review.${kind}.v1:${executionId}`).digest('hex').slice(0, 24)
}
export const assertRenditionProviderIdentity = identity => {
  need(exact(identity, ['responseId', 'postRequestId']) && /^resp_[A-Za-z0-9_-]{1,195}$/.test(identity.responseId || '')
    && typeof identity.postRequestId === 'string' && (identity.postRequestId === '' || /^[A-Za-z0-9._:-]{1,200}$/.test(identity.postRequestId)), 'PROVIDER_IDENTITY_INVALID')
  return identity
}
const reasons = ['PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_FAILED', 'DISPATCH_RESERVATION_UNACKNOWLEDGED', 'RESPONSE_ID_UNACKNOWLEDGED',
  'PROVIDER_OUTPUT_INVALID', 'PROVIDER_CONTEXT_OVERFLOW', 'PROVIDER_HTTP_REJECTED', 'PROVIDER_RESPONSE_ID_INVALID', 'PROVIDER_RESPONSE_INVALID',
  'PROVIDER_TERMINAL_FAILURE', 'PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_REFUSED', 'REQUIRED_DURABLE_CALLBACK_FAILED', 'PROVIDER_RESPONSE_ID_CHANGED']
export const assertRenditionUncertainty = value => {
  need(exact(value, ['reason', 'outcome', 'responseId', 'postRequestId']) && reasons.includes(value.reason)
    && ['NOT_SUBMITTED', 'SUBMISSION_UNCERTAIN', 'SUBMISSION_REJECTED', 'KNOWN_RESPONSE_UNRESOLVED'].includes(value.outcome)
    && (value.responseId === '' || /^resp_[A-Za-z0-9_-]{1,195}$/.test(value.responseId || ''))
    && typeof value.postRequestId === 'string' && (value.postRequestId === '' || /^[A-Za-z0-9._:-]{1,200}$/.test(value.postRequestId))
    && (value.outcome !== 'KNOWN_RESPONSE_UNRESOLVED' || value.responseId !== ''), 'UNCERTAINTY_INVALID')
  return value
}
