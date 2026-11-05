import Execution from '../models/GovernedReasoningExecution.js'
import { assertCompletedReviewResult } from './masterLinkedCompletedReviewContract.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { G1_MODES } from './masterLinkedGenuineReviewContract.js'

const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const need = value => {
  if (!value) throw Object.assign(new Error('The failed document predecessor cannot be confirmed.'), {
    code: 'DOCX_CORRECTION_PREDECESSOR_BLOCKED', status: 409,
    details: { reason: 'FAILED_PREDECESSOR_BINDING_CHANGED', contentIncludedInError: false },
  })
}
const defaultReadCompleted = async request => {
  // Defer orchestration imports: immutable record/model contracts must not
  // initialise the persistence -> authority -> transport -> persistence cycle.
  const { createGenuineMasterLinkedCompletedReviewStore } = await import('./masterLinkedCompletedReviewService.js')
  return createGenuineMasterLinkedCompletedReviewStore().read(request)
}

// Pure predicate over projections, not a receipt reader or authority capability.
// The default reader below supplies only validated stored records and readback.
export const assertFailedCorrectionReviewBinding = (args, projection) => {
  const { candidate, scope } = args, { body, executionId, resultFingerprint } = projection
  need(candidate.body?.contractVersion === 'private-docx-candidate.v2'
    && candidate.body.input?.contractVersion === 'governed-private-docx-input.v1'
    && candidate.body.masterBinding?.contractVersion === 'master-linked-private-docx-binding.v1'
    && same(candidate.body.scope, scope))
  const input = body.input, binding = input.subject.binding
  need(input.mode === G1_MODES.GENUINE && input.sourceProof === 'STORED_SOURCE_RECORDS'
    && body.reviewStatus === 'FAIL' && input.actorUserId === args.actorUserId && same(input.scope, scope)
    && executionId === args.failedReviewExecutionId && resultFingerprint === args.expectedFailedReviewResultFingerprint
    && binding.candidateId === candidate.candidateId && binding.candidateBodyFingerprint === candidate.bodyFingerprint
    && binding.inputFingerprint === candidate.body.inputFingerprint && binding.docxChecksum === candidate.body.artifact.outputChecksum
    && binding.sourceFingerprint === candidate.body.sourceFingerprint
    && same(binding.masterReference, candidate.body.masterBinding.masterReference)
    && same(binding.renderer, candidate.body.input.renderer))
}
export const assertFailedCorrectionCompletion = (args, projection, verified) => {
  assertFailedCorrectionReviewBinding(args, projection)
  const { candidate } = args, { resultFingerprint } = projection
  need(verified?.mode === G1_MODES.GENUINE && verified.sourceProof === 'STORED_SOURCE_RECORDS'
    && verified.completionConfirmed === true && verified.completionPersisted === true && verified.genuineReviewUsed === true
    && verified.executionId === args.failedReviewExecutionId && verified.resultFingerprint === resultFingerprint
    && verified.reviewStatus === 'FAIL' && verified.findings?.overallStatus === 'FAIL'
    && verified.docxChecksum === candidate.body.artifact.outputChecksum
    && ['approvalAvailable', 'finalisationAvailable', 'deliveryAvailable'].every(key => verified[key] === false))
  return { predecessor: { candidateId: candidate.candidateId, inputFingerprint: candidate.body.inputFingerprint,
    outputChecksum: candidate.body.artifact.outputChecksum, failedReviewExecutionId: args.failedReviewExecutionId,
    failedReviewResultFingerprint: resultFingerprint }, predecessorBodyFingerprint: candidate.bodyFingerprint }
}

// The caller has already verified the scoped candidate, bytes and creation
// audit through the existing reader. No caller-supplied review receipt is used.
export const readFailedDocxCorrectionPredecessor = async args => {
  const frozen = { ...args, candidate: clone(args.candidate), scope: clone(args.scope) }
  const row = await (args.deps?.readResult || (filter => Execution.findOne(filter).maxTimeMS(3000).lean()))({
    ...frozen.scope, executionId: frozen.failedReviewExecutionId,
  })
  const projection = { body: clone(assertCompletedReviewResult(row)), executionId: row.executionId,
    resultFingerprint: row.executionEvidence.masterLinkedCompletedReview.bodyFingerprint }
  assertFailedCorrectionReviewBinding(frozen, projection)
  const verified = await (args.deps?.readCompleted || defaultReadCompleted)({ actorUserId: frozen.actorUserId,
    scopes: args.scopes, grantExecutionId: projection.body.input.grant.executionId })
  return assertFailedCorrectionCompletion(frozen, projection, verified)
}
