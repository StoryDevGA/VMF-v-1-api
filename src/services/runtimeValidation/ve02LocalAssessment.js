import { prepareVE02NativeAssessment } from './ve02NativeAssessment.js'
import { classifyVE02NativeText, VE02_CLASSIFIER_VERSION } from './ve02EvidenceClassifier.js'
import { resolveVE02RuntimeContext } from './ve02RuntimeContextResolver.js'
import { resolveVE02GradingBinding } from './ve02ContractBindingRegistry.js'
import { resolveVE02ClaimBinding } from './ve02ClaimBinding.js'
import { resolveSourceRecordedReview } from '../sourceVerificationContext.js'
import { validateRuntimeOperation } from './runtimeValidationEngine.js'
import { generateChecksum } from '../governanceAudit/checksumService.js'
import { assertVE02LocalEnvironment, buildVE02LocalActivation, ve02ProducerBindingSchema,
  VE02_LOCAL_RESULT_RESTRICTION } from './ve02LocalAssessorRegistration.js'

const reject = (code, status = 422) => { throw Object.assign(new Error('Provisional VE02 assessment cannot proceed.'), { code, status }) }
const proposalMarkers = new Set(['NON_COMPLETE_DO_NOT_CONSUME', 'TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING', 'SYNTHETIC_QMF_ONLY'])

// Fresh server-owned assessment only. Caller drafts and attestations never enter
// this path. Provider execution stays outside consumption transaction retries.
export const executeVE02LocalAssessment = async ({ input, scopes, actorId, requestId, dependencies = {} }) => {
  const enabled = () => dependencies.enabled ?? process.env.VE02_LOCAL_ASSESSMENT_ENABLED === 'true'
  const model = () => dependencies.model ?? process.env.VE02_CLASSIFICATION_MODEL
  const readActivation = async ({ query, session }) => {
    assertVE02LocalEnvironment(enabled())
    const binding = await (dependencies.resolveGradingBinding || resolveVE02GradingBinding)({ query, session })
    return { binding, local: buildVE02LocalActivation({ query, binding, model: model(), classifierVersion: VE02_CLASSIFIER_VERSION }) }
  }
  assertVE02LocalEnvironment(enabled())
  let activation
  const assessment = await prepareVE02NativeAssessment({ input, scopes, dependencies: {
    enabled: true,
    resolveContext: dependencies.resolveContext,
    resolveClaimBinding: dependencies.resolveClaimBinding,
    classify: dependencies.classify || (args => classifyVE02NativeText({ ...args, model: model() })),
    resolveGradingBinding: async args => {
      const current = await readActivation(args)
      if (activation && activation.bindingHash !== current.local.bindingHash) reject('VE02_LOCAL_BINDING_CHANGED', 409)
      activation = current.local
      return current.binding
    },
  } })
  const candidate = assessment.proposedGradingResult.result
  if (candidate.result_status !== 'COMPLETE' || candidate.assessment_result === 'CONTRADICTORY'
    || candidate.assessment_result === 'INSUFFICIENT' || assessment.sourceReview?.authenticity !== 'AUTHENTIC'
    || !assessment.claimBinding) reject('VE02_LOCAL_REVIEW_REQUIRED')
  const producerBinding = ve02ProducerBindingSchema.parse({
    authorityClass: activation.authorityClass, implementationRef: activation.implementationRef,
    implementationVersion: activation.implementationVersion, decisionRef: activation.decisionRef,
    model: activation.model, classifierVersion: assessment.classifierVersion,
    activationBindingHash: activation.bindingHash, gradingContentHash: activation.gradingContentHash,
    evidenceRevisionRef: assessment.basis.evidenceRevisionRef,
    claimPlanId: assessment.claimBinding.planId, claimKey: assessment.claimBinding.claimKey,
    claimContractHash: assessment.claimBinding.contractHash,
    sourceReviewFingerprint: generateChecksum(assessment.sourceReview),
  })
  const payload = { ...candidate,
    restrictions: [...new Set([...candidate.restrictions.filter(value => !proposalMarkers.has(value)),
      VE02_LOCAL_RESULT_RESTRICTION, 'NO_HYPOTHESIS_PROMOTION'])],
    assessment_reasons: [...candidate.assessment_reasons.filter(reason =>
      !reason.startsWith('Unresolved: automatic assessment procedure') && reason !== 'Native classification is proposed.'),
    'Assessed under the provisional StorylineOS local activation; no separate VMF automated-assessor authority is claimed.'],
  }
  payload.result_id = `storylineos-ve02:${generateChecksum({ payload, producerBinding })}`
  const validation = await (dependencies.validateOperation || validateRuntimeOperation)({
    ...input, payload, outputContract: { $id: payload.contract_id }, operationType: 'OUTPUT_VALIDATION',
    mode: 'STRICT', persistAudit: true, actorId, actorType: 'SERVICE', requestId,
  }, { resolveVE02Context: async (operation, { session }) => {
    const context = await (dependencies.resolveContext || resolveVE02RuntimeContext)({ input: operation, scopes, session })
    if (!context) reject('VE02_LOCAL_BINDING_CHANGED', 409)
    const current = await readActivation({ session, query: { frameworkKey: input.frameworkKey,
      packageKey: context.packageKey, packageVersion: context.packageVersion } })
    const basis = assessment.basis
    if (current.local.bindingHash !== activation.bindingHash
      || ['runtimeId', 'customerId', 'tenantId'].some((key, index) => String(context[key]) !== String(basis[['runtimeInstanceId', 'customerId', 'tenantId'][index]]))
      || context.stateVersion !== basis.stateVersion || context.evidenceRevisionRef !== basis.evidenceRevisionRef
      || context.activation.activationId !== basis.activationId || context.activation.versionId !== basis.versionId
      || context.activation.contentHash !== basis.contentHash || context.governingRuntimeVersion !== basis.governingRuntimeVersion)
      reject('VE02_LOCAL_BINDING_CHANGED', 409)
    const review = resolveSourceRecordedReview(context.source)
    const claim = await (dependencies.resolveClaimBinding || resolveVE02ClaimBinding)({ binding: input.claimBinding,
      context, statement: input.proposedHypothesis.statement, session })
    if (generateChecksum(review) !== producerBinding.sourceReviewFingerprint
      || generateChecksum(claim) !== generateChecksum(assessment.claimBinding)) reject('VE02_LOCAL_BINDING_CHANGED', 409)
    assertVE02LocalEnvironment(enabled())
    if (model() !== activation.model) reject('VE02_LOCAL_BINDING_CHANGED', 409)
    if (context.existingReceiptAudit && (generateChecksum(context.existingReceiptAudit.ve02Receipt?.producerBinding ?? null)
      !== generateChecksum(producerBinding))) reject('VE02_LOCAL_RECEIPT_BINDING_CHANGED', 409)
    return { ...context, producerBinding, localActivation: current.local }
  } })
  return { status: validation.ve02ResultEligibility?.eligible ? 'COMPLETE' : 'BLOCKED',
    executionEligible: validation.ve02ResultEligibility?.eligible === true, result: payload,
    producerBinding, activationDecision: activation, validation }
}
