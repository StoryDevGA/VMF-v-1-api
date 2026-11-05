import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { assertMasterLinkedPreparedSubject, simulationExact as exact, simulationSame as same } from './masterLinkedReviewSimulationContract.js'

export const G1_VERSION = 'master-linked-docx-dispatch.v2'
export const G1_OUTPUT = 'MASTER_LINKED_DOCX_DISPATCH'
export const G1_MODES = Object.freeze({ QA: 'NETWORK_SIMULATED', GENUINE: 'GENUINE_CONTROLLED_TEST' })
export const G1_STATUSES = Object.freeze({ GRANT: 'MASTER_DOCX_GRANTED', RESERVATION: 'MASTER_DOCX_RESERVED',
  START_OR_REVOKE: 'MASTER_DOCX_START_OR_REVOKE', HOLD_AFTER_START: 'MASTER_DOCX_HELD' })
export const G1_ACTIONS = Object.freeze({ GRANT: 'MASTER_DOCX_DISPATCH_GRANTED', RESERVATION: 'MASTER_DOCX_DISPATCH_RESERVED',
  START_OR_REVOKE: 'MASTER_DOCX_START_OR_REVOKE_RECORDED', HOLD_AFTER_START: 'MASTER_DOCX_LATE_HOLD_RECORDED',
  RESPONSE: 'MASTER_DOCX_RESPONSE_RECORDED', UNCERTAINTY: 'MASTER_DOCX_UNCERTAINTY_RECORDED' })
export const G1_FIXED = Object.freeze({ actorUserId: '6a6c763dcace7a21bd41efa9', tenantId: '6a6c76e3cace7a21bd41eff9',
  customerId: '6a6c75f2cace7a21bd41ef98', runtimeInstanceId: '6ad715c91f39fea112115875',
  candidateId: 'docx_candidate_45e4cd08-6750-4ebf-88d2-a97c81dc3d4b', masterId: 'meaning_master_7f34d431-6640-482e-8695-75cd6f76883c',
  reconciliation: '45483a1e0a372392d245d6bdcbae2183dddbf5f58badc827e8607551978a90a6' })
const frozenRequest = { requestIdentity: 'c5a51616e1783e96a6ac7395d490ce83522de8c88b34a05fd92c91f9774bf8ff',
  subjectFingerprint: '03361f15efa60ebd630449449931a64d633d225df50b3f5d862b398bd8d60504',
  contextFingerprint: 'd9fba3835d2c9ddfd6195ab202543a305cb96f293e45309a99b310f85ca8015b',
  policyFingerprint: '1ac4b2f41724224645c15553c6123c7e47eb151905e902adbde9f3a02623eff4' }
export const g1Need = (condition, reason) => { if (!condition) throw Object.assign(new Error('The master-linked review is held.'), {
  code: 'MASTER_DOCX_REVIEW_HELD', status: 409, details: { reason, dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false },
}) }
const need = g1Need
const oid = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const referenceId = value => oid(value) || value instanceof mongoose.Types.ObjectId && oid(value.toHexString())
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export const g1Root = (scope, mode, qaCase = '') => {
  need(Object.values(G1_MODES).includes(mode), 'MODE')
  need(mode !== G1_MODES.QA || typeof qaCase === 'string' && /^[a-z0-9-]{1,64}$/.test(qaCase), 'QA_CASE')
  return `${mode === G1_MODES.QA ? 'SS055_NETWORK_QA_DOCX:' : 'SS055_SINGLE_GENUINE_DOCX:'}${membershipHash({ sprint: 'SS-055',
    tenantId: scope.tenantId, customerId: scope.customerId, ...(mode === G1_MODES.QA ? { qaCase } : {}) })}`
}
export const g1Key = (root, phase) => `${root}:${phase}`
export const g1ReceiptId = (executionId, kind) => createHash('sha256').update(`${G1_VERSION}:${executionId}:${kind}`).digest('hex').slice(0, 24)
export const assertG1FixedSubject = (subject, request) => {
  need(subject.actorUserId === G1_FIXED.actorUserId && Object.entries(subject.binding.masterReference.scope).every(([k, v]) => G1_FIXED[k] === v)
    && subject.binding.candidateId === G1_FIXED.candidateId && subject.binding.masterReference.masterId === G1_FIXED.masterId
    && same(request, frozenRequest), 'GENUINE_SUBJECT_NOT_RELEASED')
}
export const G1_QA_RELEASE = Object.freeze({ version: 'ss055-review-release-qa.v1', action: 'MASTER_DOCX_QA_RELEASE_RECORDED', kind: 'NETWORK_QA_RELEASE' })
export const G1_CORRECTED_QA_RELEASE = Object.freeze({ version: 'ss055-corrected-review-release-qa.v1', action: G1_QA_RELEASE.action, kind: 'CORRECTED_NETWORK_QA_RELEASE',
  candidateId: 'docx_candidate_7c552bd4-90e9-43f8-8305-d1d6cfbb0a0a' })
export const G1_GENUINE_RELEASE = Object.freeze({ version: 'ss055-genuine-release-approval.v2', action: 'MASTER_GENUINE_REVIEW_RELEASE_APPROVED' })
export const G1_CORRECTED_GENUINE_RELEASE = Object.freeze({ version: 'ss055-corrected-review-release-genuine.v1',
  action: 'MASTER_CORRECTED_GENUINE_REVIEW_RELEASE_APPROVED', kind: 'CORRECTED_GENUINE_RELEASE', candidateId: G1_CORRECTED_QA_RELEASE.candidateId })
export const G1_CATEGORY_QA_RELEASE = Object.freeze({ version: 'ss055-category-review-release-qa.v1',
  action: 'MASTER_DOCX_CATEGORY_QA_RELEASE_RECORDED', kind: 'CATEGORY_NETWORK_QA_RELEASE', candidateId: G1_CORRECTED_QA_RELEASE.candidateId })
export const G1_CATEGORY_GENUINE_RELEASE = Object.freeze({ version: 'ss055-category-review-release-genuine.v1',
  action: 'MASTER_CATEGORY_GENUINE_REVIEW_RELEASE_APPROVED', kind: 'CATEGORY_GENUINE_RELEASE', candidateId: G1_CORRECTED_QA_RELEASE.candidateId })
export const G1_APPROVED_GENUINE_RELEASE = Object.freeze({ version: 'ss055-approved-expression-review-release-genuine.v1',
  action: 'MASTER_APPROVED_GENUINE_REVIEW_RELEASE_APPROVED', kind: 'APPROVED_EXPRESSION_GENUINE_RELEASE',
  candidateId: 'docx_candidate_c396012f-ebf6-4da0-b4e8-71580a359024' })
export const G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE = Object.freeze({ version: 'ss055-approved-expression-review-release-genuine.v2',
  action: 'MASTER_APPROVED_DIAGNOSTIC_GENUINE_REVIEW_RELEASE_APPROVED', kind: 'APPROVED_EXPRESSION_DIAGNOSTIC_GENUINE_RELEASE',
  candidateId: G1_APPROVED_GENUINE_RELEASE.candidateId })
export const G1_APPROVED_QA_RELEASE = Object.freeze({ version: 'ss055-approved-expression-review-release-qa.v1',
  action: 'MASTER_DOCX_APPROVED_QA_RELEASE_RECORDED', kind: 'APPROVED_EXPRESSION_NETWORK_QA_RELEASE',
  candidateId: G1_APPROVED_GENUINE_RELEASE.candidateId })
export const G1_NARROW_GENUINE_RELEASE = Object.freeze({ version: 'ss055-narrow-expression-review-release-genuine.v1',
  action: 'MASTER_NARROW_GENUINE_REVIEW_RELEASE_APPROVED', kind: 'NARROW_EXPRESSION_GENUINE_RELEASE',
  candidateId: 'docx_candidate_f032af3b-ad37-492a-ab38-9abbc7d4caeb' })
const correctedRequest = Object.freeze({ requestIdentity: 'd9e6f655c414d0f3c54564d53c702933f66563f4be3274d8bd5d2bdbb0a17980',
  subjectFingerprint: '27bcd815ac44c0d0802263e3096fb0e2ff1f6bf0209f4c8ac57d76e7b3713dab',
  contextFingerprint: '91df4ac18c8fc43c128b2ed023650fb4427d7db5934645d536cb7bc110bf13cb',
  policyFingerprint: '9fc3730052034c89e19726e0b0b784e7977432dce8061ebad9a648240f0e6144' })
// Frozen by default stored-source preparation, not by changing either consumed
// request. QA and genuine use separate signed releases and one-use roots.
export const G1_CATEGORY_QA_REQUEST = Object.freeze({ requestIdentity: 'ee193dfaa3dcc8ae1e3fc992763af419ea12a84458c6010f2b032d2c81b3dc97',
  subjectFingerprint: '27bcd815ac44c0d0802263e3096fb0e2ff1f6bf0209f4c8ac57d76e7b3713dab',
  contextFingerprint: '91df4ac18c8fc43c128b2ed023650fb4427d7db5934645d536cb7bc110bf13cb',
  policyFingerprint: '9fc3730052034c89e19726e0b0b784e7977432dce8061ebad9a648240f0e6144' })
export const G1_APPROVED_REQUEST = Object.freeze({ requestIdentity: '75184440a840dd12871c17cc565010fd69ab5a4ea175bb0b68ca62bc6d93b262',
  subjectFingerprint: 'ddc49dff8cf5587fd8970e608c3b312734c510725baf9f4cd0acbf7368b0d0d1',
  contextFingerprint: '19270a5cdb4107dce343414aa943b0bb26ad7dde129a7a068a1d97caad8f984e',
  policyFingerprint: 'edaf3da76403bfb752f3f6bf62a7d27e8f9c430f3d677e2ae65ec07115907050' })
// Frozen from the exact saved F032 bytes, seven PNGs, source and pack contents.
// This preparation identity alone grants no permission or provider capability.
export const G1_NARROW_REQUEST = Object.freeze({ requestIdentity: '4a9aa05d3bddb551c5e631f0b56855482f2aa55767dfa8fe7bf65c8f42c366a2',
  subjectFingerprint: 'eeee97c7ee711408eb7b88fa3cd3eced82a6bb0ce2a09a46ed977774d515cce5',
  contextFingerprint: '2031063332a36ec69625dd2580ef38dda5be410ea2d382710677a744db9d4fc6',
  policyFingerprint: 'f47a98837661ac794e0050bd1ae3f3d35e6c1ea4b2b6bcad29680411d72093b7' })
const corrected = subject => subject?.contractVersion === 'master-linked-docx-review-subject.v3'
const approved = subject => subject?.contractVersion === 'master-linked-docx-review-subject.v4'
const narrow = subject => subject?.contractVersion === 'master-linked-docx-review-subject.v5'
const literalJson = (value, depth = 0) => {
  if (depth > 40) return false
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) return false
  const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false
  if (array && (Object.keys(value).length !== value.length || Object.getOwnPropertyNames(value).length !== value.length + 1)) return false
  return Object.entries(descriptors).every(([key, descriptor]) => array && key === 'length'
    || descriptor.enumerable && Object.hasOwn(descriptor, 'value') && literalJson(descriptor.value, depth + 1))
}
export const isG1CategoryQaRequest = request => literalJson(request) && exact(request, Object.keys(G1_CATEGORY_QA_REQUEST)) && same(request, G1_CATEGORY_QA_REQUEST)
export const isG1ApprovedRequest = request => literalJson(request) && exact(request, Object.keys(G1_APPROVED_REQUEST)) && same(request, G1_APPROVED_REQUEST)
export const isG1NarrowRequest = request => literalJson(request) && exact(request, Object.keys(G1_NARROW_REQUEST))
  && Object.values(request).every(hash) && same(request, G1_NARROW_REQUEST)
export const g1RequestProfile = request => isG1NarrowRequest(request) ? 'NARROW' : isG1ApprovedRequest(request)
export const g1QaReleaseProfile = (subject, request) => {
  if (approved(subject) || isG1ApprovedRequest(request)) {
    assertG1ApprovedSubject(subject, request)
    return G1_APPROVED_QA_RELEASE
  }
  return isG1CategoryQaRequest(request) ? G1_CATEGORY_QA_RELEASE : corrected(subject) ? G1_CORRECTED_QA_RELEASE : G1_QA_RELEASE
}
export const g1ReleaseProfile = (subject, mode, request, releaseVersion = null) => {
  need(Object.values(G1_MODES).includes(mode), 'MODE')
  if (narrow(subject) || isG1NarrowRequest(request)) {
    need(mode === G1_MODES.GENUINE && releaseVersion === null, 'NARROW_GENUINE_PROFILE_REQUIRED')
    assertG1NarrowSubject(subject, request)
    return G1_NARROW_GENUINE_RELEASE
  }
  need(releaseVersion === null || releaseVersion === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version, 'RELEASE_VERSION')
  if (releaseVersion !== null) {
    need(mode === G1_MODES.GENUINE, 'DIAGNOSTIC_GENUINE_PROFILE_REQUIRED')
    assertG1ApprovedSubject(subject, request)
    return G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE
  }
  if (approved(subject) || isG1ApprovedRequest(request)) {
    assertG1ApprovedSubject(subject, request)
    return mode === G1_MODES.GENUINE ? G1_APPROVED_GENUINE_RELEASE : G1_APPROVED_QA_RELEASE
  }
  if (isG1CategoryQaRequest(request) && mode === G1_MODES.GENUINE) return G1_CATEGORY_GENUINE_RELEASE
  return mode === G1_MODES.QA ? g1QaReleaseProfile(subject, request) : corrected(subject) ? G1_CORRECTED_GENUINE_RELEASE : G1_GENUINE_RELEASE
}
export const g1ApprovalReference = (subject, mode, audit) => {
  const releaseVersion = audit?.diff?.version === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version ? audit.diff.version : null
  return {
    ...(mode === G1_MODES.QA || corrected(subject) || approved(subject) || narrow(subject) ? { kind: g1ReleaseProfile(subject, mode, audit?.diff?.requestBinding, releaseVersion).kind } : {}),
    ...(releaseVersion === null ? {} : { version: releaseVersion }),
    auditId: String(audit._id), diffFingerprint: membershipHash(audit.diff) }
}
// One proven subject snapshot, not a general permission to review corrections.
// Its whole-subject commitment covers every page, pack and failed predecessor.
export const assertG1CorrectedSubject = (subject, request) => {
  need(literalJson(subject) && literalJson(request) && exact(request, Object.keys(correctedRequest)) && Object.values(request).every(hash), 'CORRECTED_QA_SUBJECT_NOT_RELEASED')
  const b = subject?.binding, ref = b?.masterReference
  need(corrected(subject) && b?.contractVersion === 'master-linked-docx-review-binding.v2'
    && subject.actorUserId === G1_FIXED.actorUserId && b.candidateId === G1_CORRECTED_QA_RELEASE.candidateId
    && ref?.masterId === G1_FIXED.masterId && same(ref.scope, Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(k => [k, G1_FIXED[k]])))
    && same(request, correctedRequest) && membershipHash(subject) === correctedRequest.subjectFingerprint
    && subject.policyFingerprint === correctedRequest.policyFingerprint && membershipHash(subject.policy) === correctedRequest.policyFingerprint
    && ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable', 'dispatchAvailable', 'externalDisclosureAvailable']
      .every(k => subject[k] === false && subject.policy[k] === false), 'CORRECTED_QA_SUBJECT_NOT_RELEASED')
}
export const assertG1CorrectedQaSubject = (subject, request) => assertG1CorrectedSubject(subject, request)
export const assertG1CategoryQaSubject = (subject, request) => {
  need(isG1CategoryQaRequest(request), 'CATEGORY_REQUEST_NOT_RELEASED')
  assertG1CorrectedSubject(subject, correctedRequest)
}
// Exact private wording correction only. The whole-subject commitment retains
// every source, page, pack, compatibility decision and non-authorising flag.
export const assertG1ApprovedSubject = (subject, request) => {
  need(literalJson(subject) && isG1ApprovedRequest(request), 'APPROVED_SUBJECT_NOT_RELEASED')
  const b = subject?.binding, ref = b?.masterReference
  need(approved(subject) && b?.contractVersion === 'master-linked-docx-review-binding.v3'
    && subject.actorUserId === G1_FIXED.actorUserId && b.candidateId === G1_APPROVED_GENUINE_RELEASE.candidateId
    && ref?.masterId === G1_FIXED.masterId && same(ref.scope, Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(k => [k, G1_FIXED[k]])))
    && membershipHash(subject) === G1_APPROVED_REQUEST.subjectFingerprint
    && subject.policyFingerprint === G1_APPROVED_REQUEST.policyFingerprint && membershipHash(subject.policy) === G1_APPROVED_REQUEST.policyFingerprint
    && ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable', 'dispatchAvailable', 'externalDisclosureAvailable']
      .every(k => subject[k] === false && subject.policy[k] === false), 'APPROVED_SUBJECT_NOT_RELEASED')
}
export const assertG1NarrowSubject = (subject, request) => {
  need(literalJson(subject) && isG1NarrowRequest(request), 'NARROW_SUBJECT_NOT_RELEASED')
  const b = subject?.binding, ref = b?.masterReference
  need(narrow(subject) && b?.contractVersion === 'master-linked-docx-review-binding.v4'
    && subject.actorUserId === G1_FIXED.actorUserId && b.candidateId === G1_NARROW_GENUINE_RELEASE.candidateId
    && ref?.masterId === G1_FIXED.masterId && same(ref.scope, Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(k => [k, G1_FIXED[k]])))
    && b.renderer?.version === '0.1.5' && b.compatibilityReference?.version === 'commercial-docx-approved-expression.v2'
    && membershipHash(subject) === G1_NARROW_REQUEST.subjectFingerprint
    && subject.policyFingerprint === G1_NARROW_REQUEST.policyFingerprint && membershipHash(subject.policy) === G1_NARROW_REQUEST.policyFingerprint
    && ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable', 'dispatchAvailable', 'externalDisclosureAvailable']
      .every(k => subject[k] === false && subject.policy[k] === false), 'NARROW_SUBJECT_NOT_RELEASED')
}
export const g1SubjectRoot = (subject, request, mode, qaCase = '', releaseVersion = null) => {
  if (narrow(subject) || isG1NarrowRequest(request)) {
    need(mode === G1_MODES.GENUINE && qaCase === '' && releaseVersion === null, 'NARROW_GENUINE_PROFILE_REQUIRED')
    assertG1NarrowSubject(subject, request)
    return 'SS055_NARROW_GENUINE_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
      candidateId: subject.binding.candidateId, compatibilityReference: subject.binding.compatibilityReference, request })
  }
  need(releaseVersion === null || releaseVersion === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version, 'RELEASE_VERSION')
  if (releaseVersion !== null) {
    need(mode === G1_MODES.GENUINE && qaCase === '', 'DIAGNOSTIC_GENUINE_PROFILE_REQUIRED')
    assertG1ApprovedSubject(subject, request)
  }
  if (approved(subject) || isG1ApprovedRequest(request)) {
    need(Object.values(G1_MODES).includes(mode), 'MODE')
    assertG1ApprovedSubject(subject, request)
    if (mode === G1_MODES.GENUINE) {
      need(qaCase === '', 'APPROVED_GENUINE_PROFILE_REQUIRED')
      return 'SS055_APPROVED_GENUINE_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
        candidateId: subject.binding.candidateId, compatibilityReference: subject.binding.compatibilityReference, request,
        ...(releaseVersion === null ? {} : { releaseVersion }) })
    }
    need(typeof qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(qaCase), 'QA_RELEASE_CASE')
    return 'SS055_APPROVED_NETWORK_QA_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
      candidateId: subject.binding.candidateId, compatibilityReference: subject.binding.compatibilityReference, request, qaCase })
  }
  if (isG1CategoryQaRequest(request)) {
    need(Object.values(G1_MODES).includes(mode), 'MODE'); assertG1CategoryQaSubject(subject, request)
    if (mode === G1_MODES.GENUINE) {
      need(qaCase === '', 'GENUINE_QA_CASE_FORBIDDEN')
      return 'SS055_CATEGORY_GENUINE_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
        candidateId: subject.binding.candidateId, correctionReference: subject.binding.correctionReference, request })
    }
    need(typeof qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(qaCase), 'QA_RELEASE_CASE')
    return 'SS055_CATEGORY_NETWORK_QA_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
      candidateId: subject.binding.candidateId, correctionReference: subject.binding.correctionReference, request, qaCase })
  }
  if (!corrected(subject)) return g1Root(subject.binding.masterReference.scope, mode, qaCase)
  need(Object.values(G1_MODES).includes(mode), 'MODE')
  assertG1CorrectedSubject(subject, request)
  if (mode === G1_MODES.GENUINE) {
    need(qaCase === '', 'GENUINE_QA_CASE_FORBIDDEN')
    return 'SS055_CORRECTED_GENUINE_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
      candidateId: subject.binding.candidateId, correctionReference: subject.binding.correctionReference, request })
  }
  need(typeof qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(qaCase), 'QA_RELEASE_CASE')
  return 'SS055_CORRECTED_NETWORK_QA_DOCX:' + membershipHash({ sprint: 'SS-055', scope: subject.binding.masterReference.scope,
    candidateId: subject.binding.candidateId, correctionReference: subject.binding.correctionReference, request, qaCase })
}
export const g1PostIdempotencyKey = (request, root, releaseVersion = null) => {
  need(releaseVersion === null || releaseVersion === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version, 'RELEASE_VERSION')
  if (releaseVersion === null) return request.requestIdentity
  need(isG1ApprovedRequest(request) && typeof root === 'string' && /^SS055_APPROVED_GENUINE_DOCX:[a-f0-9]{64}$/.test(root), 'DIAGNOSTIC_GENUINE_PROFILE_REQUIRED')
  return membershipHash({ releaseVersion, onceRoot: root, requestIdentity: request.requestIdentity })
}
const assertRelease = (audit, subject, request, verify, now, requireCurrent, qaCase = null) => {
  const correction = corrected(subject), approvedExpression = approved(subject), narrowExpression = narrow(subject)
  const qaProfile = qaCase === null ? null : g1QaReleaseProfile(subject, request)
  if (narrowExpression || isG1NarrowRequest(request)) assertG1NarrowSubject(subject, request)
  else if (approvedExpression || isG1ApprovedRequest(request)) assertG1ApprovedSubject(subject, request)
  else if (isG1CategoryQaRequest(request)) assertG1CategoryQaSubject(subject, request)
  else if (correction) assertG1CorrectedSubject(subject, request)
  else assertG1FixedSubject(subject, request)
  const d = audit?.diff, scope = subject.binding.masterReference.scope
  const qa = qaCase !== null, native = qa || correction || approvedExpression || narrowExpression || d?.version === 'ss055-genuine-release-approval.v2'
  const releaseVersion = d?.version === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version ? d.version : null
  const profile = g1ReleaseProfile(subject, qa ? G1_MODES.QA : G1_MODES.GENUINE, request, releaseVersion)
  need(!qa || typeof qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(qaCase), 'QA_RELEASE_CASE')
  need(audit && referenceId(audit._id) && referenceId(audit.actorUserId) && referenceId(audit.resourceId)
    && audit.action === profile.action && audit.resourceType === 'RuntimeInstance'
    && String(audit.resourceId) === G1_FIXED.runtimeInstanceId && audit.signatureVersion === 3 && verify(audit) === true
    && Object.entries(scope).every(([k, v]) => String(audit.scope?.[k]) === v)
    && exact(d, ['version', 'approvingOperatorUserId', 'appActorUserId', 'onceRoot', 'scope', 'candidateId', 'masterId', 'requestBinding',
      'legacyReconciliationFingerprint', 'approvalReference', 'issuedAt', 'expiresAt', 'permittedUse', 'maximumAttempts',
      'customerApproval', 'productionUse', 'automaticFinalisation', ...(native ? ['operatorAuthority'] : []), ...(qa ? ['qaCase', 'genuineReviewEligible'] : [])])
    && (qa ? d.version === qaProfile.version && d.qaCase === qaCase && d.genuineReviewEligible === false
      : correction || approvedExpression || narrowExpression ? d.version === profile.version : d.version === 'ss055-genuine-release-approval.v1' || d.version === 'ss055-genuine-release-approval.v2')
    && (!native || exact(d.operatorAuthority, ['realm', 'operatorUserId', 'fingerprint'])
      && d.operatorAuthority.realm === 'native-application-test.v1'
      && d.operatorAuthority.operatorUserId === d.approvingOperatorUserId && hash(d.operatorAuthority.fingerprint))
    && oid(d.approvingOperatorUserId) && String(audit.actorUserId) === d.approvingOperatorUserId && d.appActorUserId === G1_FIXED.actorUserId
    && same(d.scope, scope) && d.onceRoot === g1SubjectRoot(subject, request, qa ? G1_MODES.QA : G1_MODES.GENUINE, qaCase || '', releaseVersion) && same(d.requestBinding, request)
    && d.candidateId === (narrowExpression ? G1_NARROW_GENUINE_RELEASE.candidateId : approvedExpression ? G1_APPROVED_GENUINE_RELEASE.candidateId : correction ? G1_CORRECTED_QA_RELEASE.candidateId : G1_FIXED.candidateId) && d.masterId === G1_FIXED.masterId && d.legacyReconciliationFingerprint === G1_FIXED.reconciliation
    && typeof d.approvalReference === 'string' && d.approvalReference.trim().length > 0 && d.approvalReference.length <= 500
    && iso(d.issuedAt) && iso(d.expiresAt) && Date.parse(d.expiresAt) > Date.parse(d.issuedAt)
    && Date.parse(d.expiresAt) - Date.parse(d.issuedAt) <= 1800000 && (!requireCurrent || Date.parse(d.issuedAt) <= now && now < Date.parse(d.expiresAt))
    && d.permittedUse === 'CONTROLLED_DEVELOPMENT_TEST_ONLY' && d.maximumAttempts === 1
    && ['customerApproval', 'productionUse', 'automaticFinalisation'].every(k => d[k] === false), 'OPERATOR_RELEASE_INVALID')
  return d
}
export const assertG1Approval = (audit, subject, request, verify, now, requireCurrent = true) =>
  assertRelease(audit, subject, request, verify, now, requireCurrent)
export const assertG1QaRelease = (audit, subject, request, verify, now, qaCase, requireCurrent = true) => {
  need(typeof qaCase === 'string' && /^ss055-release-proof-[a-z0-9-]{1,42}$/.test(qaCase), 'QA_RELEASE_CASE')
  return assertRelease(audit, subject, request, verify, now, requireCurrent, qaCase)
}
export const hasG1Identity = value => String(value?.contractVersion || '').trim() === G1_VERSION
  || String(value?.outputTypeKey || '').trim().toUpperCase() === G1_OUTPUT || Object.values(G1_STATUSES).includes(String(value?.status || '').trim().toUpperCase())
  || /^SS055_(NARROW_GENUINE|APPROVED_GENUINE|APPROVED_NETWORK_QA|CATEGORY_GENUINE|CATEGORY_NETWORK_QA|CORRECTED_GENUINE|CORRECTED_NETWORK_QA|NETWORK_QA|SINGLE_GENUINE)_DOCX:/.test(String(value?.idempotencyKey || '').trim()) || value?.executionEvidence?.masterDocxDispatch !== undefined
export const assertG1Record = record => {
  const e = record?.executionEvidence?.masterDocxDispatch, b = e?.body
  need(record?.contractVersion === G1_VERSION && record.outputTypeKey === G1_OUTPUT && exact(record.executionEvidence, ['masterDocxDispatch'])
    && exact(e, ['body', 'bodyFingerprint', 'auditId', 'auditSignatureVersion'])
    && exact(b, ['version', 'phase', 'decision', 'executionId', 'scope', 'actorUserId', 'planId', 'runtime', 'subject', 'request', 'mode', 'qaCase',
      'onceRoot', 'approval', 'grantCreatedAt', 'expiresAt', 'createdAt', 'grant', 'reservation'])
    && b.version === G1_VERSION && typeof b.phase === 'string' && Object.hasOwn(G1_STATUSES, b.phase) && Object.values(G1_MODES).includes(b.mode)
    && exact(b.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(b.scope).every(oid)
    && Object.entries(b.scope).every(([k, v]) => String(record[k]) === v) && oid(b.actorUserId)
    && typeof b.planId === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(b.planId)
    && typeof b.executionId === 'string' && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(b.executionId) && record.executionId === b.executionId
    && b.onceRoot === g1SubjectRoot(b.subject, b.request, b.mode, b.qaCase, b.approval?.version ?? null) && (b.mode === G1_MODES.QA || b.qaCase === '')
    && record.idempotencyKey === g1Key(b.onceRoot, b.phase) && record.status === G1_STATUSES[b.phase]
    && b.decision === (b.phase === 'START_OR_REVOKE' ? b.decision : b.phase)
    && (b.phase !== 'START_OR_REVOKE' || ['START_ALLOWED', 'REVOKED'].includes(b.decision)), 'G1_RECORD_SHAPE')
  if (approved(b.subject) || narrow(b.subject)) {
    need(b.actorUserId === G1_FIXED.actorUserId && same(b.scope, b.subject.binding.masterReference.scope)
      && b.approval?.kind === g1ReleaseProfile(b.subject, b.mode, b.request, b.approval?.version ?? null).kind,
    b.mode === G1_MODES.GENUINE ? 'APPROVED_GENUINE_RELEASE_REQUIRED' : 'APPROVED_QA_RELEASE_REQUIRED')
    ;(narrow(b.subject) ? assertG1NarrowSubject : assertG1ApprovedSubject)(b.subject, b.request)
  } else if (corrected(b.subject)) {
    need(b.actorUserId === G1_FIXED.actorUserId && same(b.scope, b.subject.binding.masterReference.scope)
      && b.approval?.kind === g1ReleaseProfile(b.subject, b.mode, b.request).kind,
    b.mode === G1_MODES.QA ? 'CORRECTED_QA_RELEASE_REQUIRED' : 'CORRECTED_GENUINE_RELEASE_REQUIRED')
    if (isG1CategoryQaRequest(b.request)) assertG1CategoryQaSubject(b.subject, b.request)
    else assertG1CorrectedSubject(b.subject, b.request)
  } else assertMasterLinkedPreparedSubject(b.subject, b.request, b.scope, b.actorUserId)
  need(iso(b.createdAt) && iso(b.grantCreatedAt) && iso(b.expiresAt) && Date.parse(b.expiresAt) > Date.parse(b.grantCreatedAt)
    && Date.parse(b.expiresAt) - Date.parse(b.grantCreatedAt) <= 1800000 && Date.parse(b.createdAt) >= Date.parse(b.grantCreatedAt)
    && exact(b.runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && Object.values(b.runtime).every(v => typeof v === 'string' && v.length <= 160)
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(k => b.runtime[k].length > 0)
    && Object.entries(b.runtime).every(([k, v]) => record[k] === v), 'G1_TIME_RUNTIME')
  const ref = value => exact(value, ['executionId', 'bodyFingerprint']) && typeof value.executionId === 'string'
    && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(value.executionId) && hash(value.bodyFingerprint)
  need(b.phase === 'GRANT' ? b.grant === null && b.reservation === null : ref(b.grant)
    && (b.phase === 'RESERVATION' || b.decision === 'REVOKED' ? b.reservation === null : ref(b.reservation)), 'G1_REFERENCES')
  if (b.mode === G1_MODES.GENUINE) {
    if (!corrected(b.subject) && !approved(b.subject) && !narrow(b.subject)) assertG1FixedSubject(b.subject, b.request)
    need(exact(b.approval, [...(corrected(b.subject) || approved(b.subject) || narrow(b.subject) ? ['kind'] : []),
      ...(b.approval?.version === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version ? ['version'] : []), 'auditId', 'diffFingerprint'])
      && oid(b.approval.auditId) && hash(b.approval.diffFingerprint), 'G1_APPROVAL_REFERENCE')
  } else need(b.approval === null || exact(b.approval, ['kind', 'auditId', 'diffFingerprint'])
    && b.approval.kind === g1QaReleaseProfile(b.subject, b.request).kind && oid(b.approval.auditId) && hash(b.approval.diffFingerprint), 'QA_APPROVAL_FORBIDDEN')
  need(record.providerMode === (b.mode === G1_MODES.QA ? 'DETERMINISTIC_TEST' : 'LIVE_TEST')
    && same(record.provider, { mode: b.mode, provenance: b.mode === G1_MODES.QA ? 'NETWORK_QA' : 'GEN', phase: b.phase })
    && same(record.reasoningContext, { dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false })
    && String(record.requestedBy) === b.actorUserId && new Date(record.requestedAt).toISOString() === b.createdAt
    && record.requestFingerprint === b.request.requestIdentity && e.bodyFingerprint === membershipHash(b)
    && referenceId(record._id) && referenceId(e.auditId) && e.auditSignatureVersion === 3
    && same(record.auditLogIds, [String(e.auditId)]) && same(record.artifactIds, []) && same(record.warnings, []) && same(record.limitations, [])
    && ['knowledgeManifest', 'knowledgeBinding', 'certifiedTruth', 'runtimeStateWrites'].every(k => record[k] === undefined || exact(record[k], []))
    && record.workspaceType === 'PLATFORM' && record.requestedOutputTypeKey === 'master-linked-docx-dispatch'
    && record.executionIntent === 'Record bounded master-linked DOCX review authority; no customer approval.'
    && record.completedAt === null && record.failureReason === null, 'G1_RECORD_BINDING')
  return b
}
export const g1Reference = record => ({ executionId: record.executionId, bodyFingerprint: record.executionEvidence.masterDocxDispatch.bodyFingerprint })
export const g1AuditDiff = record => { const e = record.executionEvidence.masterDocxDispatch; return { version: G1_VERSION,
  phase: e.body.phase, decision: e.body.decision, mode: e.body.mode, onceRoot: e.body.onceRoot, request: e.body.request,
  executionId: record.executionId, bodyFingerprint: e.bodyFingerprint } }
export const assertG1Audit = (record, audit, verify) => {
  const e = record.executionEvidence.masterDocxDispatch, b = e.body
  need(audit && referenceId(audit._id) && referenceId(audit.resourceId) && referenceId(audit.actorUserId)
    && String(audit._id) === String(e.auditId) && audit.signatureVersion === 3 && audit.action === G1_ACTIONS[b.phase]
    && audit.resourceType === 'GovernedReasoningExecution' && String(audit.resourceId) === String(record._id)
    && String(audit.actorUserId) === b.actorUserId && Object.entries(b.scope).every(([k, v]) => String(audit.scope?.[k]) === v)
    && same(audit.diff, g1AuditDiff(record)) && verify(audit) === true, 'G1_AUDIT')
}
