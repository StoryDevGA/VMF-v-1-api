import { MASTER_LINKED_REVIEW_BINDING_VERSION, CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION, APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION,
  NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION } from './outcomeMasterLinkedDocxReviewBindingService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { MEANING_MASTER_FLAGS, MEANING_MASTER_USE, projectMeaningMasterSource } from './outcomeMeaningSourceMasterContract.js'
import { assertMasterReference } from './outcomeMasterLinkedDocxContract.js'

export const MASTER_REVIEW_PREPARATION_POLICY = 'controlled-master-review-preparation.v1'
export const MASTER_REVIEW_TRANSPORT = Object.freeze({ provider: 'OPENAI', model: 'gpt-5.2',
  configurationVersion: 'MASTER_LINKED_DOCX_PREPARATION_V2', contextVersion: 'master-linked-docx-visual-review.v2' })
export const CORRECTED_MASTER_REVIEW_TRANSPORT = Object.freeze({ provider: 'OPENAI', model: 'gpt-5.2',
  configurationVersion: 'MASTER_LINKED_DOCX_CORRECTION_PREPARATION_V1', contextVersion: 'master-linked-docx-correction-visual-review.v1' })
export const masterReviewPreparationProfile = bindingVersion => {
  if (bindingVersion === MASTER_LINKED_REVIEW_BINDING_VERSION) return { subjectVersion: 'master-linked-docx-review-subject.v2', policyVersion: MASTER_REVIEW_PREPARATION_POLICY, transport: MASTER_REVIEW_TRANSPORT }
  if (bindingVersion === CORRECTED_MASTER_LINKED_REVIEW_BINDING_VERSION) return { subjectVersion: 'master-linked-docx-review-subject.v3', policyVersion: 'controlled-master-correction-review-preparation.v1', transport: CORRECTED_MASTER_REVIEW_TRANSPORT }
  if (bindingVersion === APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION) return { subjectVersion: 'master-linked-docx-review-subject.v4',
    policyVersion: 'controlled-approved-expression-review-preparation.v1', transport: { provider: 'OPENAI', model: 'gpt-5.2',
      configurationVersion: 'MASTER_LINKED_APPROVED_EXPRESSION_PREPARATION_V1', contextVersion: 'master-linked-approved-expression-visual-review.v1' } }
  if (bindingVersion === NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION) return { subjectVersion: 'master-linked-docx-review-subject.v5',
    policyVersion: 'controlled-narrow-expression-review-preparation.v1', transport: { provider: 'OPENAI', model: 'gpt-5.2',
      configurationVersion: 'MASTER_LINKED_NARROW_EXPRESSION_PREPARATION_V1', contextVersion: 'master-linked-narrow-expression-visual-review.v1' } }
  requireMasterReview(false, 'PREPARATION_BINDING_VERSION')
}
export const masterReviewBlocked = reason => Object.assign(new Error('The controlled document review preparation is unavailable.'), {
  code: 'MASTER_LINKED_REVIEW_PREPARATION_BLOCKED', status: 409, details: { reason, dispatchAvailable: false },
})
export const requireMasterReview = (value, reason) => { if (!value) throw masterReviewBlocked(reason) }
export const sameMasterReviewValue = (a, b) => membershipHash(a) === membershipHash(b)
export const masterReviewFalseFlags = () => Object.fromEntries([...MEANING_MASTER_FLAGS, 'dispatchAvailable', 'externalDisclosureAvailable'].map(key => [key, false]))

// A reproducible read-preparation decision, never a signed approval or dispatch
// reservation. The caller is the authenticated read owner, not a controller.
export const deriveMasterReviewSourceUse = ({ actorUserId, runtimeInstanceId, master, sourceEnvelope, binding,
  operation = 'PREPARE_PROVIDER_REVIEW_INPUT' }) => {
  const need = requireMasterReview, ref = binding?.masterReference
  assertMasterReference(ref)
  const profile = masterReviewPreparationProfile(binding?.contractVersion)
  const projection = projectMeaningMasterSource(sourceEnvelope)
  need(operation === 'PREPARE_PROVIDER_REVIEW_INPUT' && typeof actorUserId === 'string' && /^[a-f0-9]{24}$/.test(actorUserId)
    && ref.scope.runtimeInstanceId === runtimeInstanceId && sameMasterReviewValue(ref.scope,
      Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, sourceEnvelope.source.scope[key]]))), 'SOURCE_USE_SCOPE')
  need(master?.purpose === 'MEANING_SOURCE_ONLY' && master.status === 'RECORDED_MEANING_SOURCE_ONLY' && master.permittedUse === MEANING_MASTER_USE
    && master.classification === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST'
    && master.masterId === ref.masterId && master.version === ref.version
    && master.sourceFingerprint === ref.sourceFingerprint && sourceEnvelope.sourceFingerprint === ref.sourceFingerprint
    && master.sourceProjectionFingerprint === ref.sourceProjectionFingerprint
    && membershipHash(projection) === ref.sourceProjectionFingerprint
    && binding.sourceFingerprint === ref.sourceFingerprint && MEANING_MASTER_FLAGS.every(key => master[key] === false), 'SOURCE_USE_AUTHORITY')
  return { policyVersion: profile.policyVersion, operation, actorUserId, scope: { ...ref.scope },
    permittedUse: MEANING_MASTER_USE, classification: master.classification, decision: 'PREPARATION_ONLY',
    capability: 'BUILD_PROVIDER_SAFE_REQUEST', bindingFingerprint: membershipHash(binding), transport: { ...profile.transport },
    ...([APPROVED_MASTER_LINKED_REVIEW_BINDING_VERSION, NARROW_MASTER_LINKED_REVIEW_BINDING_VERSION].includes(binding.contractVersion) ? {
      compatibilityReference: JSON.parse(JSON.stringify(binding.compatibilityReference)), schemaContentComplete: false,
      unresolvedFacts: ['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'] } : {}), ...masterReviewFalseFlags() }
}
