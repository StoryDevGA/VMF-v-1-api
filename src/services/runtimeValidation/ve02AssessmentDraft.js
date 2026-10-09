import mongoose from 'mongoose'
import { generateChecksum } from '../governanceAudit/checksumService.js'
import { resolveVE02RuntimeContext } from './ve02RuntimeContextResolver.js'
import { VE02_RESULT_CONTRACT_ID, VE02_RESULT_SCHEMA_VERSION } from './ve02EvidenceAssessmentResultContract.js'
import { VE02_UNRESOLVED_RESTRICTIONS } from './ve02Grading.js'

const fail = (code, message, status = 422) => {
  throw Object.assign(new Error(message), { code, status })
}

// Draft preparation only: judgments and hypothesis text are proposed inputs,
// not a verified assessor, canonical hypothesis link or consumption receipt.
export const prepareVE02AssessmentDraft = async ({ input, scopes, session = null, dependencies = {} }) => {
  if (!session) {
    const ownedSession = await mongoose.startSession()
    try {
      return await ownedSession.withTransaction(() => prepareVE02AssessmentDraft({
        input, scopes, session: ownedSession, dependencies,
      }), { readConcern: { level: 'snapshot' } })
    } finally {
      await ownedSession.endSession()
    }
  }
  if (!session.inTransaction()) fail('VE02_DRAFT_SNAPSHOT_REQUIRED', 'Assessment draft requires a scoped snapshot read.')
  const draftId = `draft:${generateChecksum(input)}`
  const resolver = dependencies.resolveContext || resolveVE02RuntimeContext
  const context = await resolver({ input: {
    packageId: input.packageId, frameworkKey: input.frameworkKey,
    runtimeInstanceId: input.runtimeInstanceId,
    payload: { evidence_id: input.evidenceId, result_id: draftId },
  }, scopes, session })
  if (!context) fail('VE02_DRAFT_BASIS_UNAVAILABLE', 'Current scoped evidence, provenance and installed VE02 contract must resolve.')
  if (context.evidenceRevisionRef !== input.expectedEvidenceRevisionRef) {
    fail('VE02_DRAFT_BASIS_CHANGED', 'Evidence or source changed. Reload its current revision before preparing the draft.', 409)
  }
  const assessedAt = new Date().toISOString()
  return {
    status: 'PROPOSED', executionEligible: false,
    assessmentProcedureVerified: false, hypothesisVerified: false,
    blockingReasons: ['VE02_ASSESSMENT_PROCEDURE_UNVERIFIED', 'VE02_HYPOTHESIS_UNVERIFIED', 'VE02_JUDGMENTS_PROPOSED'],
    proposedHypothesis: { ...input.proposedHypothesis, status: 'PROPOSED' },
    proposedJudgments: structuredClone(input.judgments),
    basis: {
      runtimeInstanceId: context.runtimeId, customerId: context.customerId, tenantId: context.tenantId,
      stateVersion: context.stateVersion, evidenceId: context.evidence.evidenceObjectId,
      packageKey: context.packageKey, packageVersion: context.packageVersion,
      evidenceRevisionRef: context.evidenceRevisionRef, sourceId: context.source.sourceId,
      governingRuntimeVersion: context.governingRuntimeVersion,
      activationId: context.activation.activationId, versionId: context.activation.versionId,
      contentHash: context.activation.contentHash, capturedAt: assessedAt,
    },
    contractCandidate: {
      ...structuredClone(input.judgments),
      assessment_result: 'INSUFFICIENT', evidence_direction: 'UNRESOLVED',
      restrictions: [...new Set([...input.judgments.restrictions, ...VE02_UNRESOLVED_RESTRICTIONS])],
      assessment_reasons: [...input.judgments.assessment_reasons,
        'Unresolved: assessment procedure, proposed classifications and canonical hypothesis binding have not been verified.'],
      contract_id: VE02_RESULT_CONTRACT_ID, schema_version: VE02_RESULT_SCHEMA_VERSION,
      result_id: draftId, result_status: 'UNRESOLVED',
      evidence_id: context.evidence.evidenceObjectId, evidence_revision_ref: context.evidenceRevisionRef,
      runtime_owner: 'VE02', runtime_version_ref: context.governingRuntimeVersion,
      assessed_at: assessedAt, provenance_refs: [...context.requiredProvenanceRefs],
    },
  }
}
