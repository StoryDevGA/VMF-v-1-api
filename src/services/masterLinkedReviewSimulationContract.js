import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'

export const MASTER_SIMULATION_VERSION = 'master-linked-review-simulation.v1'
export const MASTER_SIMULATION_OUTPUT = 'MASTER_LINKED_REVIEW_SIMULATION'
export const MASTER_SIMULATION_STATUSES = Object.freeze({ AUTHORITY: 'MASTER_SIMULATION_AUTHORISED', RESERVATION: 'MASTER_SIMULATION_RESERVED' })
export const MASTER_SIMULATION_ACTIONS = Object.freeze({ AUTHORITY: 'MASTER_REVIEW_SIMULATION_AUTHORISED', RESERVATION: 'MASTER_REVIEW_SIMULATION_RESERVED',
  RESPONSE: 'MASTER_REVIEW_SIMULATION_RESPONSE_RECORDED', UNCERTAINTY: 'MASTER_REVIEW_SIMULATION_UNCERTAINTY_RECORDED' })
export const simulationFailure = reason => Object.assign(new Error('The simulation-only review is held.'), {
  code: 'MASTER_REVIEW_SIMULATION_BLOCKED', status: 409, details: { reason, genuineReviewUsed: false, dispatchAvailable: false },
})
export const simulationNeed = (value, reason) => { if (!value) throw simulationFailure(reason) }
export const simulationSame = (a, b) => membershipHash(a) === membershipHash(b)
export const simulationExact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const need = simulationNeed, exact = simulationExact, same = simulationSame
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const oid = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const referenceId = value => oid(value) || value instanceof mongoose.Types.ObjectId && oid(value.toHexString())
const token = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value)
const flags = ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable', 'dispatchAvailable', 'externalDisclosureAvailable']
const transport = { provider: 'OPENAI', model: 'gpt-5.2', configurationVersion: 'MASTER_LINKED_DOCX_PREPARATION_V2', contextVersion: 'master-linked-docx-visual-review.v2' }
const checksum = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const assertSubject = subject => {
  const binding = subject.binding, ref = binding?.masterReference, policy = subject.policy, method = subject.method
  need(exact(binding, ['contractVersion', 'candidateId', 'candidateBodyFingerprint', 'masterReference', 'masterBindingFingerprint', 'sourceFingerprint', 'inputFingerprint',
    'docxChecksum', 'renderer', 'previewId', 'conversionFingerprint', 'runtimeFingerprint', 'pages']) && binding.contractVersion === 'master-linked-docx-review-binding.v1'
    && typeof binding.candidateId === 'string' && /^docx_candidate_[a-f0-9-]{36}$/.test(binding.candidateId)
    && typeof binding.previewId === 'string' && /^docx_preview_[a-f0-9-]{36}$/.test(binding.previewId)
    && ['candidateBodyFingerprint', 'masterBindingFingerprint', 'sourceFingerprint', 'inputFingerprint', 'conversionFingerprint', 'runtimeFingerprint'].every(key => hash(binding[key]))
    && checksum(binding.docxChecksum) && exact(ref, ['storageId', 'masterId', 'version', 'scope', 'bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint', 'auditId', 'auditSignatureVersion'])
    && oid(ref.storageId) && oid(ref.auditId) && typeof ref.masterId === 'string' && /^meaning_master_[a-f0-9-]{36}$/.test(ref.masterId) && ref.version === 1
    && ['bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint'].every(key => hash(ref[key])) && ref.sourceFingerprint === binding.sourceFingerprint
    && exact(ref.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(ref.scope).every(oid)
    && Number.isSafeInteger(ref.auditSignatureVersion) && ref.auditSignatureVersion > 0, 'SIMULATION_BINDING_SHAPE')
  const renderer = binding.renderer
  need(exact(renderer, ['key', 'version', 'format', 'qualificationPolicy', 'layoutProfile', 'presentationProfile', 'engine', 'supportedComponents', 'scope'])
    && renderer.key === 'governed-source-private-docx' && renderer.version === '0.1.3' && renderer.format === 'DOCX'
    && renderer.qualificationPolicy === 'SOURCE_QUALIFICATION_CALLOUT_V1' && renderer.layoutProfile === 'KEEP_LABEL_WITH_QUOTE_V1'
    && renderer.presentationProfile === 'CUSTOMER_DOCUMENT_V1' && exact(renderer.engine, ['key', 'version'])
    && renderer.engine.key === 'DOCX_JS_IN_PROCESS_ENGINEERING_CANDIDATE' && typeof renderer.engine.version === 'string' && /^docx@\d+\.\d+\.\d+$/.test(renderer.engine.version)
    && same(renderer.supportedComponents, ['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT'])
    && renderer.scope === 'PRIVATE_NON_AUTHORITATIVE_IN_MEMORY_ONLY', 'SIMULATION_RENDERER')
  need(Array.isArray(binding.pages) && binding.pages.length > 0 && binding.pages.length <= 20, 'SIMULATION_PAGES')
  let bytes = 0, pixels = 0
  binding.pages.forEach((page, index) => {
    need(exact(page, ['number', 'width', 'height', 'byteLength', 'sha256']) && page.number === index + 1
      && [page.width, page.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2500)
      && Number.isSafeInteger(page.byteLength) && page.byteLength > 0 && page.byteLength <= 2 * 1024 ** 2 && hash(page.sha256), 'SIMULATION_PAGE')
    bytes += page.byteLength; pixels += page.width * page.height
  })
  need(bytes <= 8 * 1024 ** 2 && pixels <= 60000000 && same(subject.transport, transport)
    && exact(policy, ['policyVersion', 'operation', 'actorUserId', 'scope', 'permittedUse', 'classification', 'decision', 'capability', 'bindingFingerprint', 'transport', ...flags])
    && policy.policyVersion === 'controlled-master-review-preparation.v1' && policy.permittedUse === 'ISOLATED_ENGINEERING_TEST_ONLY'
    && policy.classification === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST' && same(policy.transport, transport), 'SIMULATION_POLICY_SHAPE')
  need(exact(method, ['contractVersion', 'role', 'boundary', 'packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash', 'contentFormat', 'characterCount', 'byteCount', 'chunkCount'])
    && method.contractVersion === 'outcome-studio.method-document.v1' && method.role === 'RL' && method.boundary === 'POST_GENERATION_VALIDATION'
    && ['packId', 'packKey', 'versionId', 'semanticVersion'].every(key => token(method[key])) && checksum(method.contentHash)
    && ['MARKDOWN', 'JSON', 'YAML', 'YML'].includes(method.contentFormat)
    && Number.isSafeInteger(method.characterCount) && method.characterCount > 0 && method.characterCount <= 200000
    && Number.isSafeInteger(method.byteCount) && method.byteCount >= method.characterCount && method.byteCount <= 200000
    && Number.isSafeInteger(method.chunkCount) && method.chunkCount > 0 && method.chunkCount <= 64, 'SIMULATION_METHOD')
  need(exact(subject.packs, ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']), 'SIMULATION_PACKS')
  for (const pack of Object.values(subject.packs)) need(exact(pack, ['packId', 'versionId', 'activationId', 'contentHash'])
    && ['packId', 'versionId', 'activationId'].every(key => token(pack[key])) && checksum(pack.contentHash), 'SIMULATION_PACK')
}
export const simulationPolicy = () => ({ version: MASTER_SIMULATION_VERSION, executionMode: 'SIMULATED', capability: 'INJECTED_FAKE_ONCE',
  externalDisclosureAvailable: false, dispatchAvailable: false, genuineReviewUsed: false, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false })
export const simulationKey = (planId, phase) => `MASTER_REVIEW_SIMULATED:${planId}:${phase}`
export const assertSimulationBinding = binding => {
  need(exact(binding, ['requestIdentity', 'subjectFingerprint', 'contextFingerprint', 'policyFingerprint']) && Object.values(binding).every(hash), 'REQUEST_BINDING')
  return binding
}
// Shared strict v2 subject validation. Source permission remains preparation-only;
// dispatch authority is a separate protocol and must never alter these flags.
export const assertMasterLinkedPreparedSubject = (subject, request, scope, actorUserId) => {
  assertSimulationBinding(request)
  need(exact(subject, ['contractVersion', 'actorUserId', 'binding', 'policy', 'policyFingerprint', 'method', 'packs', 'transport', ...flags])
    && subject.contractVersion === 'master-linked-docx-review-subject.v2' && subject.actorUserId === actorUserId
    && same(subject.binding?.masterReference?.scope, scope) && flags.every(key => subject[key] === false)
    && subject.policy?.decision === 'PREPARATION_ONLY' && subject.policy.operation === 'PREPARE_PROVIDER_REVIEW_INPUT'
    && subject.policy.capability === 'BUILD_PROVIDER_SAFE_REQUEST' && flags.every(key => subject.policy[key] === false)
    && subject.policy.actorUserId === actorUserId && same(subject.policy.scope, scope)
    && subject.policy.bindingFingerprint === membershipHash(subject.binding)
    && subject.policyFingerprint === membershipHash(subject.policy) && request.policyFingerprint === subject.policyFingerprint
    && request.subjectFingerprint === membershipHash(subject), 'SIMULATION_SUBJECT')
  assertSubject(subject)
  return subject
}
export const hasMasterReviewSimulationIdentity = value => String(value?.contractVersion || '').trim() === MASTER_SIMULATION_VERSION
  || String(value?.outputTypeKey || '').trim().toUpperCase() === MASTER_SIMULATION_OUTPUT
  || Object.values(MASTER_SIMULATION_STATUSES).includes(String(value?.status || '').trim().toUpperCase())
  || String(value?.idempotencyKey || '').trim().startsWith('MASTER_REVIEW_SIMULATED:') || value?.executionEvidence?.masterLinkedReview !== undefined
export const assertMasterReviewSimulationRecord = record => {
  const evidence = record?.executionEvidence?.masterLinkedReview, body = evidence?.body
  need(record?.contractVersion === MASTER_SIMULATION_VERSION && record.outputTypeKey === MASTER_SIMULATION_OUTPUT
    && exact(record.executionEvidence, ['masterLinkedReview']) && exact(evidence, ['body', 'bodyFingerprint', 'auditId', 'auditSignatureVersion'])
    && exact(body, ['contractVersion', 'phase', 'executionId', 'scope', 'actorUserId', 'planId', 'runtime', 'subject', 'request', 'policy', 'authority', 'createdAt'])
    && body.contractVersion === MASTER_SIMULATION_VERSION && Object.hasOwn(MASTER_SIMULATION_STATUSES, body.phase)
    && typeof body.executionId === 'string' && /^master_review_sim_[a-f0-9-]{36}$/.test(body.executionId) && record.executionId === body.executionId
    && exact(body.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(body.scope).every(oid)
    && Object.keys(body.scope).every(key => String(record[key]) === body.scope[key]) && oid(body.actorUserId) && token(body.planId)
    && same(body.policy, simulationPolicy()) && record.providerMode === 'DETERMINISTIC_TEST'
    && record.status === MASTER_SIMULATION_STATUSES[body.phase] && record.idempotencyKey === simulationKey(body.planId, body.phase), 'SIMULATION_RECORD_SHAPE')
  assertSimulationBinding(body.request)
  const subject = body.subject
  need(exact(subject, ['contractVersion', 'actorUserId', 'binding', 'policy', 'policyFingerprint', 'method', 'packs', 'transport', ...flags])
    && subject.contractVersion === 'master-linked-docx-review-subject.v2' && subject.actorUserId === body.actorUserId
    && same(subject.binding?.masterReference?.scope, body.scope) && flags.every(key => subject[key] === false)
    && subject.policy?.decision === 'PREPARATION_ONLY' && subject.policy.operation === 'PREPARE_PROVIDER_REVIEW_INPUT'
    && subject.policy.capability === 'BUILD_PROVIDER_SAFE_REQUEST' && flags.every(key => subject.policy[key] === false)
    && subject.policy.actorUserId === body.actorUserId && same(subject.policy.scope, body.scope)
    && subject.policy.bindingFingerprint === membershipHash(subject.binding)
    && subject.policyFingerprint === membershipHash(subject.policy) && body.request.policyFingerprint === subject.policyFingerprint
    && body.request.subjectFingerprint === membershipHash(subject), 'SIMULATION_SUBJECT')
  assertSubject(subject)
  need(body.phase === 'AUTHORITY' ? body.authority === null : exact(body.authority, ['executionId', 'bodyFingerprint'])
    && typeof body.authority.executionId === 'string' && /^master_review_sim_[a-f0-9-]{36}$/.test(body.authority.executionId) && hash(body.authority.bodyFingerprint), 'SIMULATION_AUTHORITY_REFERENCE')
  need(exact(body.runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(key => token(body.runtime[key]))
    && ['packageKey', 'packageVersion'].every(key => typeof body.runtime[key] === 'string' && body.runtime[key].length <= 120)
    && Object.keys(body.runtime).every(key => record[key] === body.runtime[key])
    && typeof body.createdAt === 'string' && Number.isFinite(Date.parse(body.createdAt)) && new Date(body.createdAt).toISOString() === body.createdAt
    && new Date(record.requestedAt).toISOString() === body.createdAt && String(record.requestedBy) === body.actorUserId
    && evidence.bodyFingerprint === membershipHash(body) && record.requestFingerprint === body.request.requestIdentity
    && referenceId(record._id) && referenceId(evidence.auditId) && Number.isSafeInteger(evidence.auditSignatureVersion) && evidence.auditSignatureVersion > 0
    && record.auditLogIds?.length === 1 && record.auditLogIds[0] === String(evidence.auditId) && record.artifactIds?.length === 0
    && same(record.provider, { executionMode: 'SIMULATED', phase: body.phase })
    && same(record.reasoningContext, { contentVisible: false, packContentLoaded: false, dispatchAvailable: false, approvalAvailable: false })
    && ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites'].every(key => record[key] === undefined || exact(record[key], []))
    && record.requestedOutputTypeKey === 'master-review-simulation'
    && record.executionIntent === 'Record simulation-only review authority or reservation; genuine review held.'
    && record.workspaceType === 'PLATFORM' && record.completedAt === null && record.failureReason === null
    && record.warnings?.length === 0 && record.limitations?.length === 0, 'SIMULATION_RECORD_BINDING')
  return body
}
export const simulationAuditDiff = record => { const e = record.executionEvidence.masterLinkedReview; return {
  contractVersion: MASTER_SIMULATION_VERSION, phase: e.body.phase, executionId: record.executionId,
  bodyFingerprint: e.bodyFingerprint, request: e.body.request, executionMode: 'SIMULATED', genuineReviewUsed: false } }
export const assertSimulationAudit = (record, audit, verify) => {
  const e = record.executionEvidence.masterLinkedReview, body = e.body
  need(audit && String(audit._id) === String(e.auditId) && audit.signatureVersion === e.auditSignatureVersion
    && audit.action === MASTER_SIMULATION_ACTIONS[body.phase] && audit.resourceType === 'GovernedReasoningExecution'
    && String(audit.resourceId) === String(record._id) && String(audit.actorUserId) === body.actorUserId
    && Object.keys(body.scope).every(key => String(audit.scope?.[key]) === body.scope[key])
    && same(audit.diff, simulationAuditDiff(record)) && verify(audit) === true, 'SIMULATION_SIGNED_AUDIT')
}
export const simulationReceiptId = (kind, executionId) => createHash('sha256').update(`${MASTER_SIMULATION_VERSION}:${executionId}:${kind}`).digest('hex').slice(0, 24)
export const assertSimulationResponse = value => {
  need(exact(value, ['responseId']) && typeof value.responseId === 'string' && /^simulated_[A-Za-z0-9_-]{1,180}$/.test(value.responseId), 'SIMULATION_RESPONSE_ID')
  return value
}
export const assertSimulationUncertainty = value => {
  need(exact(value, ['reason', 'responseId', 'state']) && ['SIMULATION_SOURCE_CHANGED', 'SIMULATION_CALLBACK_FAILED', 'SIMULATION_RESPONSE_INVALID',
    'SIMULATION_RECEIPT_FAILED', 'SIMULATION_OUTPUT_INVALID', 'SIMULATION_DEADLINE'].includes(value.reason)
    && value.state === 'HELD_NO_RETRY' && (value.responseId === '' || typeof value.responseId === 'string' && /^simulated_[A-Za-z0-9_-]{1,180}$/.test(value.responseId)), 'SIMULATION_UNCERTAINTY')
  return value
}
