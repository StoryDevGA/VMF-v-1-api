import { membershipHash } from './runtimeEvidenceSnapshotContract.js'

export const RENDITION_CLAIM_VERSION = 'outcome-rendition-review-claim.v1'
export const RENDITION_REVIEW_OUTPUT = 'RENDITION_RENDERED_EXPRESSION_RL'
export const RENDITION_CLAIM_STATUS = 'RENDITION_REVIEW_CLAIMED'
export const RENDITION_DISPATCH_VERSION = 'outcome-rendition-review-dispatch.v1'
export const RENDITION_DISPATCH_STATUS = 'RENDITION_REVIEW_DISPATCH_RESERVED'
export const RENDITION_RESULT_VERSION = 'outcome-rendition-review-result.v1'
export const RENDITION_RESULT_STATUS = 'RENDITION_REVIEW_COMPLETED'
export const RENDITION_CLAIM_ACTION = 'GOVERNED_RENDITION_REVIEW_CLAIMED'
export const RENDITION_TRANSPORT = Object.freeze({ provider: 'OPENAI', model: 'gpt-5.2',
  configurationVersion: 'DOCX_RENDITION_VISUAL_RL_V1', contextVersion: 'docx-rendition-visual-review.v1' })
export const renditionClaimError = (reason, status = 409) => Object.assign(new Error('The document review admission is unavailable.'), {
  code: 'RENDITION_REVIEW_CLAIM_BLOCKED', status, details: { reason, dispatchAvailable: false },
})
const need = (value, reason) => { if (!value) throw renditionClaimError(reason) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const checksum = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const oid = value => /^[a-f0-9]{24}$/.test(String(value || ''))
const token = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value)
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const flags = ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable']
export const renditionClaimKey = planId => `DOCX_RENDITION_REVIEW:${planId}`
const normalized = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
export const hasRenditionClaimIdentity = value => (typeof value?.contractVersion === 'string' && [RENDITION_CLAIM_VERSION, RENDITION_DISPATCH_VERSION, RENDITION_RESULT_VERSION].includes(value.contractVersion.trim()))
  || normalized(value?.outputTypeKey) === RENDITION_REVIEW_OUTPUT || [RENDITION_CLAIM_STATUS, RENDITION_DISPATCH_STATUS, RENDITION_RESULT_STATUS].includes(normalized(value?.status))
  || value?.executionEvidence?.renditionReview !== undefined
  || ['DOCX_RENDITION_REVIEW:', 'DOCX_RENDITION_REVIEW_DISPATCH:', 'DOCX_RENDITION_REVIEW_RESULT:'].some(prefix => String(value?.idempotencyKey || '').trim().startsWith(prefix))

export const assertRenditionReviewSubject = subject => {
  need(exact(subject, ['contractVersion', 'actorUserId', 'scope', 'classification', ...flags, 'source', 'candidate', 'preview', 'method', 'transport']), 'SUBJECT_SHAPE')
  need(subject.contractVersion === 'outcome-docx-review-subject.v1' && oid(subject.actorUserId)
    && exact(subject.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(subject.scope).every(oid)
    && subject.classification === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST' && flags.every(key => subject[key] === false), 'SUBJECT_SCOPE_OR_CLASSIFICATION')
  const { source, candidate, preview, method } = subject
  need(exact(source, ['sourceFingerprint', 'admission', 'plan', 'logicalDraft', 'stageRefs']) && hash(source.sourceFingerprint)
    && source.admission === 'VERIFIED_READ_ONLY_CHAIN' && exact(source.plan, ['recordId', 'planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'])
    && oid(source.plan.recordId) && token(source.plan.planId) && token(source.plan.requestId)
    && ['planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(key => hash(source.plan[key]))
    && exact(source.logicalDraft, ['draftId', 'draftIterationId']) && Object.values(source.logicalDraft).every(token)
    && Array.isArray(source.stageRefs) && source.stageRefs.length === 6, 'SUBJECT_SOURCE')
  source.stageRefs.forEach(ref => need(exact(ref, ['stageExecutionId', 'attemptFingerprint', 'outputFingerprint'])
    && token(ref.stageExecutionId) && hash(ref.attemptFingerprint) && (ref.outputFingerprint === '' || hash(ref.outputFingerprint)), 'SUBJECT_STAGE_REFERENCE'))
  need(new Set(source.stageRefs.map(ref => ref.stageExecutionId)).size === 6, 'SUBJECT_STAGE_REFERENCE')
  need(exact(candidate, ['candidateId', 'inputFingerprint', 'docxChecksum', 'byteLength', 'renderer', 'packs'])
    && /^docx_candidate_[a-f0-9-]{36}$/.test(candidate.candidateId || '') && hash(candidate.inputFingerprint)
    && checksum(candidate.docxChecksum) && Number.isSafeInteger(candidate.byteLength) && candidate.byteLength > 0 && candidate.byteLength <= 8 * 1024 ** 2
    && exact(candidate.renderer, ['key', 'version', 'fingerprint']) && token(candidate.renderer.key) && token(candidate.renderer.version) && hash(candidate.renderer.fingerprint)
    && exact(candidate.packs, ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']), 'SUBJECT_CANDIDATE')
  for (const pack of Object.values(candidate.packs)) need(exact(pack, ['packId', 'versionId', 'activationId', 'contentHash'])
    && ['packId', 'versionId', 'activationId'].every(key => token(pack[key])) && checksum(pack.contentHash), 'SUBJECT_PACK')
  need(exact(preview, ['previewId', 'conversionFingerprint', 'runtimeFingerprint', 'pages'])
    && /^docx_preview_[a-f0-9-]{36}$/.test(preview.previewId || '') && hash(preview.conversionFingerprint) && hash(preview.runtimeFingerprint)
    && Array.isArray(preview.pages) && preview.pages.length >= 1 && preview.pages.length <= 20, 'SUBJECT_PREVIEW')
  preview.pages.forEach((page, index) => need(exact(page, ['number', 'width', 'height', 'byteLength', 'sha256'])
    && page.number === index + 1 && [page.width, page.height, page.byteLength].every(value => Number.isSafeInteger(value) && value > 0)
    && page.width <= 2500 && page.height <= 2500 && hash(page.sha256), 'SUBJECT_PAGE'))
  need(exact(method, ['contractVersion', 'role', 'boundary', 'packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash', 'contentFormat', 'characterCount', 'byteCount', 'chunkCount'])
    && method.contractVersion === 'outcome-studio.method-document.v1' && method.role === 'RL' && method.boundary === 'POST_GENERATION_VALIDATION'
    && ['packId', 'packKey', 'versionId', 'semanticVersion'].every(key => token(method[key])) && checksum(method.contentHash)
    && ['MARKDOWN', 'YAML', 'YML', 'JSON'].includes(method.contentFormat)
    && ['characterCount', 'byteCount', 'chunkCount'].every(key => Number.isSafeInteger(method[key]) && method[key] > 0)
    && method.byteCount <= 200000 && method.chunkCount <= 64, 'SUBJECT_METHOD')
  need(membershipHash(subject.transport) === membershipHash(RENDITION_TRANSPORT), 'SUBJECT_TRANSPORT')
  need(Buffer.byteLength(JSON.stringify(subject)) <= 64 * 1024, 'SUBJECT_SIZE')
  return subject
}

export const renditionClaimAuditDiff = record => ({ executionId: record.executionId, requestFingerprint: record.requestFingerprint,
  claimFingerprint: record.executionEvidence.renditionReview.claimFingerprint, outputTypeKey: RENDITION_REVIEW_OUTPUT,
  state: 'NOT_DISPATCHED', dispatchAvailable: false })

export const assertRenditionClaimRecord = record => {
  const evidence = record?.executionEvidence, claim = evidence?.renditionReview, body = claim?.body
  need(record?.contractVersion === RENDITION_CLAIM_VERSION && record.outputTypeKey === RENDITION_REVIEW_OUTPUT
    && record.status === RENDITION_CLAIM_STATUS && record.providerMode === 'LIVE_TEST'
    && exact(evidence, ['renditionReview']) && exact(claim, ['body', 'claimFingerprint', 'auditId', 'auditSignatureVersion'])
    && exact(body, ['contractVersion', 'executionId', 'subject', 'runtime', 'admittedAt', 'state', 'dispatchAvailable'])
    && body.contractVersion === RENDITION_CLAIM_VERSION && body.state === 'NOT_DISPATCHED' && body.dispatchAvailable === false
    && /^grr_rendition_claim_[a-f0-9-]{36}$/.test(record.executionId || '') && body.executionId === record.executionId
    && iso(body.admittedAt)
    && oid(claim.auditId) && Number.isSafeInteger(claim.auditSignatureVersion) && claim.auditSignatureVersion > 0, 'CLAIM_SHAPE')
  const subject = assertRenditionReviewSubject(body.subject)
  need(exact(body.runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(key => token(body.runtime[key]))
    && ['packageKey', 'packageVersion'].every(key => typeof body.runtime[key] === 'string' && body.runtime[key].length <= 120)
    && Object.keys(body.runtime).every(key => record[key] === body.runtime[key]), 'CLAIM_RUNTIME_BINDING')
  need(record.requestFingerprint === membershipHash(subject) && claim.claimFingerprint === membershipHash(body)
    && record.idempotencyKey === renditionClaimKey(subject.source.plan.planId)
    && Object.keys(subject.scope).every(key => String(record[key]) === subject.scope[key])
    && String(record.requestedBy) === subject.actorUserId && new Date(record.requestedAt).toISOString() === body.admittedAt
    && record.completedAt === null && Array.isArray(record.artifactIds) && record.artifactIds.length === 0
    && Array.isArray(record.auditLogIds) && record.auditLogIds.length === 1 && record.auditLogIds[0] === String(claim.auditId)
    && membershipHash(record.provider) === membershipHash({ ...RENDITION_TRANSPORT, state: 'NOT_DISPATCHED' })
    && membershipHash(record.reasoningContext) === membershipHash({ contentVisible: false, packContentLoaded: false, dispatchAvailable: false })
    // Mongoose's existing minimize policy omits empty objects. Both forms mean
    // no knowledge/truth/state projection; changing global policy would alter GRR.
    && ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites'].every(key => record[key] === undefined || exact(record[key], []))
    && record.requestedOutputTypeKey === 'docx-rendition-review' && record.executionIntent === 'Admit one private DOCX rendition for a separate visual review.'
    && record.failureReason === null && record.warnings?.length === 0 && record.limitations?.length === 0, 'CLAIM_BINDING')
  return body
}

export const assertRenditionClaimAudit = (record, audit, verifySignature) => {
  const claim = record.executionEvidence.renditionReview, subject = claim.body.subject
  need(audit && String(audit._id) === String(claim.auditId) && audit.signatureVersion === claim.auditSignatureVersion
    && audit.action === RENDITION_CLAIM_ACTION && audit.resourceType === 'GovernedReasoningExecution'
    && String(audit.resourceId) === String(record._id) && String(audit.actorUserId) === subject.actorUserId
    && Object.keys(subject.scope).every(key => String(audit.scope?.[key]) === subject.scope[key])
    && membershipHash(audit.diff) === membershipHash(renditionClaimAuditDiff(record)) && verifySignature(audit) === true, 'CLAIM_SIGNED_AUDIT_INVALID')
}
