import mongoose from 'mongoose'
import env from '../../config/env.js'
import { prepareVE02AssessmentDraft } from './ve02AssessmentDraft.js'
import { gradeVE02PreclassifiedEvidence } from './ve02Grading.js'
import { resolveVE02GradingBinding } from './ve02ContractBindingRegistry.js'
import { generateChecksum } from '../governanceAudit/checksumService.js'

const reject = (code, message, status = 422) => { throw Object.assign(new Error(message), { code, status }) }

// Explicitly synthetic, preclassified input. No grading assertion supplied by
// a caller becomes verified evidence semantics, native hypothesis or authority.
export const prepareVE02SyntheticAssessment = async ({ input, scopes, session = null, dependencies = {} }) => {
  const enabled = dependencies.enabled ?? (process.env.VE02_SYNTHETIC_ASSESSMENT_ENABLED === 'true')
  if (!enabled || env.isProduction || env.isAppProduction || process.env.NODE_ENV === 'production'
    || process.env.APP_ENV === 'production' || !['development', 'test'].includes(env.appEnv)) {
    reject('VE02_SYNTHETIC_DISABLED', 'Synthetic VE02 assessment is disabled.', 403)
  }
  if (!session) {
    const ownedSession = await mongoose.startSession()
    try {
      return await ownedSession.withTransaction(() => prepareVE02SyntheticAssessment({ input, scopes,
        session: ownedSession, dependencies }), { readConcern: { level: 'snapshot' } })
    } finally { await ownedSession.endSession() }
  }
  const draft = await prepareVE02AssessmentDraft({ input: input.draft, scopes, session,
    dependencies: dependencies.draftDependencies })
  if (input.draft.frameworkKey !== 'QMF' || draft.basis.packageKey !== 'ss038-synthetic-qmf-0-38-1'
    || draft.basis.packageVersion !== '0.38.1') {
    reject('VE02_SYNTHETIC_SCOPE_REQUIRED', 'Only the exact synthetic QMF package may prepare this assessment.', 403)
  }
  const binding = await (dependencies.resolveGradingBinding || resolveVE02GradingBinding)({ session, query: {
    frameworkKey: 'QMF', packageKey: draft.basis.packageKey, packageVersion: draft.basis.packageVersion,
  } })
  if (!binding) reject('VE02_GRADING_BINDING_UNRESOLVED', 'Installed and activated grading clarification does not verify.')
  const candidate = { ...draft.contractCandidate, ...structuredClone(input.draft.judgments),
    assessment_result: 'INSUFFICIENT', result_status: 'COMPLETE',
    restrictions: [...new Set([...input.draft.judgments.restrictions, 'SYNTHETIC_QMF_ONLY', 'NO_HYPOTHESIS_PROMOTION'])] }
  const conflict = input.proposedConflict
  if (conflict) {
    candidate.contradiction_refs = [...conflict.lineageRefs]
    candidate.assessment_reasons.push(`Proposed conflict condition=${conflict.condition}; scope=${conflict.scope}; time=${conflict.time}`)
  }
  candidate.result_id = `synthetic:${generateChecksum({ candidate, conflict,
    gradingContentHash: binding.source.contentHash })}`
  const result = gradeVE02PreclassifiedEvidence({ candidate, currentRevision: draft.basis.evidenceRevisionRef,
    conflictEstablished: Boolean(conflict) })
  return { ...draft, status: 'SYNTHETIC_ASSESSMENT', assessmentProcedureVerified: true,
    classificationStatus: 'PROPOSED_PRECLASSIFIED', proposedConflict: conflict || null,
    gradingBinding: binding, contractCandidate: result, executionEligible: false,
    blockingReasons: ['VE02_CLASSIFICATIONS_PROPOSED', 'VE02_HYPOTHESIS_UNVERIFIED', 'SYNTHETIC_QMF_ONLY'] }
}
