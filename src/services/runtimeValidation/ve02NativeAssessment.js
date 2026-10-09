import mongoose from 'mongoose'
import env from '../../config/env.js'
import { prepareVE02AssessmentDraft } from './ve02AssessmentDraft.js'
import { resolveVE02RuntimeContext } from './ve02RuntimeContextResolver.js'
import { resolveVE02GradingBinding } from './ve02ContractBindingRegistry.js'
import { classifyVE02NativeText, validateVE02Classification, VE02_CLASSIFIER_VERSION } from './ve02EvidenceClassifier.js'
import { VE02_DIMENSIONS, gradeVE02PreclassifiedEvidence } from './ve02Grading.js'
import { generateChecksum } from '../governanceAudit/checksumService.js'
import { resolveSourceRecordedReview } from '../sourceVerificationContext.js'
import { resolveVE02ClaimBinding } from './ve02ClaimBinding.js'

const reject = (code, status = 422) => { throw Object.assign(new Error('Native synthetic VE02 assessment cannot proceed.'), { code, status }) }
const basisIdentity = ({ capturedAt, ...basis }) => basis
const unresolved = () => ({ ...Object.fromEntries(VE02_DIMENSIONS.map((key) => [key, 'UNRESOLVED'])),
  assessment_result: 'INSUFFICIENT', evidence_direction: 'UNRESOLVED', assessment_reasons: ['Native classification is proposed.'],
  restrictions: [], contradiction_refs: [] })

export const prepareVE02NativeAssessment = async ({ input, scopes, dependencies = {} }) => {
  if (!(dependencies.enabled ?? process.env.VE02_SYNTHETIC_CLASSIFICATION_ENABLED === 'true')
    || env.isProduction || env.isAppProduction || process.env.NODE_ENV === 'production'
    || process.env.APP_ENV === 'production' || !['development', 'test'].includes(env.appEnv)) reject('VE02_NATIVE_SYNTHETIC_DISABLED', 403)
  const read = async () => {
    const session = await mongoose.startSession()
    try {
      return await session.withTransaction(async () => {
        let context
        const draft = await prepareVE02AssessmentDraft({ input: { ...input, judgments: unresolved() }, scopes, session,
          dependencies: { resolveContext: async (args) => {
            context = await (dependencies.resolveContext || resolveVE02RuntimeContext)(args)
            return context
          } } })
        if (input.frameworkKey !== 'QMF' || draft.basis.packageKey !== 'ss038-synthetic-qmf-0-38-1'
          || draft.basis.packageVersion !== '0.38.1') reject('VE02_SYNTHETIC_SCOPE_REQUIRED', 403)
        const binding = await (dependencies.resolveGradingBinding || resolveVE02GradingBinding)({ session, query: {
          frameworkKey: 'QMF', packageKey: draft.basis.packageKey, packageVersion: draft.basis.packageVersion,
        } })
        if (!binding) reject('VE02_GRADING_BINDING_UNRESOLVED')
        const sourceReview = resolveSourceRecordedReview(context.source)
        const claimBinding = await (dependencies.resolveClaimBinding || resolveVE02ClaimBinding)({ binding: input.claimBinding,
          context, statement: input.proposedHypothesis.statement, session })
        return { draft, binding, sourceReview, claimBinding, passage: context.evidence.extractedFact || context.evidence.summary || '' }
      }, { readConcern: { level: 'snapshot' } })
    } finally { await session.endSession() }
  }
  const first = await read()
  if (!first.passage.trim()) reject('VE02_NATIVE_PASSAGE_MISSING')
  // Provider outside Mongo transactions: transaction retries never repeat a call.
  const proposed = validateVE02Classification(await (dependencies.classify || classifyVE02NativeText)({
    passage: first.passage, proposedHypothesis: input.proposedHypothesis,
    sourceReview: first.sourceReview, claimBinding: first.claimBinding,
  }), first.passage, { sourceReview: first.sourceReview, claimBinding: first.claimBinding })
  const second = await read()
  if (generateChecksum(basisIdentity(first.draft.basis)) !== generateChecksum(basisIdentity(second.draft.basis))
    || generateChecksum(first.binding) !== generateChecksum(second.binding) || first.passage !== second.passage
    || generateChecksum(first.sourceReview) !== generateChecksum(second.sourceReview)
    || generateChecksum(first.claimBinding) !== generateChecksum(second.claimBinding)) reject('VE02_CLASSIFICATION_BASIS_CHANGED', 409)
  const candidate = { ...second.draft.contractCandidate,
    specificity: proposed.specificity.grade,
    assessment_reasons: [...second.draft.contractCandidate.assessment_reasons.filter(reason => !reason.startsWith('Unresolved: assessment procedure,')),
      'Unresolved: automatic assessment procedure and proposed classifications are not verified.',
      second.sourceReview ? 'Source facts are an authorised recorded review, not independent external certification.'
        : 'Source authenticity and origin/independence facts are unavailable.',
      second.claimBinding ? 'The saved condition is bound to its exact current claim; no hypothesis truth authority is granted.'
        : 'The assessment condition is proposed, not bound to a saved claim.',
      ...Object.entries(proposed).map(([key, value]) => `${key}: ${value.reason}${value.quote ? ` Citation (${value.basis}/${value.field}): ${value.quote}` : ''}`)],
  }
  const proposedCandidate = { ...candidate, result_status: 'COMPLETE',
    ...Object.fromEntries(VE02_DIMENSIONS.map(key => [key, proposed[key].grade])),
    evidence_direction: proposed.evidence_direction.grade }
  if (!second.sourceReview || second.sourceReview.authenticity === 'UNVERIFIED') proposedCandidate.source_reliability = 'UNRESOLVED'
  if (second.sourceReview?.authenticity === 'INVALID') {
    proposedCandidate.source_reliability = 'INSUFFICIENT'
    proposedCandidate.assessment_reasons = [...proposedCandidate.assessment_reasons,
      'Source reliability is insufficient: the current recorded authenticity review identifies an invalid, unusable source.']
  }
  if (!second.sourceReview) proposedCandidate.independence = 'UNRESOLVED'
  if (!second.claimBinding) {
    proposedCandidate.relevance = 'UNRESOLVED'
    proposedCandidate.evidence_direction = 'UNRESOLVED'
  }
  proposedCandidate.result_id = `native-proposed-grade:${generateChecksum({ basis: basisIdentity(second.draft.basis),
    proposed, sourceReview: second.sourceReview, claimBinding: second.claimBinding,
    binding: second.binding, classifier: VE02_CLASSIFIER_VERSION })}`
  const proposedGradingResult = { status: 'PROPOSED_NON_CONSUMABLE', executionEligible: false,
    basis: { evidenceRevisionRef: second.draft.basis.evidenceRevisionRef,
      sourceReviewFingerprint: second.sourceReview ? generateChecksum(second.sourceReview) : null,
      claimContractHash: second.claimBinding?.contractHash || null },
    result: gradeVE02PreclassifiedEvidence({ candidate: proposedCandidate, currentRevision: second.draft.basis.evidenceRevisionRef }) }
  candidate.result_id = `native-proposed:${generateChecksum({ candidate, proposed, binding: second.binding, classifier: VE02_CLASSIFIER_VERSION })}`
  return { ...second.draft, status: 'PROPOSED_NATIVE_ASSESSMENT', classificationStatus: 'PROPOSED_NATIVE_CLASSIFICATION',
    classifierVersion: VE02_CLASSIFIER_VERSION, proposedClassifications: proposed, gradingBinding: second.binding,
    sourceReview: second.sourceReview, claimBinding: second.claimBinding,
    proposedGradingResult,
    contractCandidate: gradeVE02PreclassifiedEvidence({ candidate: { ...candidate, result_status: 'COMPLETE' },
      currentRevision: second.draft.basis.evidenceRevisionRef }),
    executionEligible: false, assessmentProcedureVerified: false, hypothesisVerified: false,
    blockingReasons: [...(!second.sourceReview || second.sourceReview.authenticity === 'UNVERIFIED' ? ['VE02_SOURCE_AUTHENTICITY_UNVERIFIED'] : []),
      ...(!second.sourceReview ? ['VE02_INDEPENDENCE_FACTS_UNVERIFIED'] : []),
      ...(!second.claimBinding ? ['VE02_CLAIM_BINDING_UNVERIFIED'] : []),
      ...(!second.claimBinding ? ['VE02_HYPOTHESIS_UNVERIFIED'] : []), 'VE02_CLASSIFICATIONS_PROPOSED', 'SYNTHETIC_QMF_ONLY'] }
}
