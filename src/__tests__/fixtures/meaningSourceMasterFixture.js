import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { makeRequestScopedQualityChain, ids } from './outcomeQualityStageFixtures.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../../models/SyntheticOutcomeRunEvent.js'
import { OUTCOME_DOCX_RENDITION_SOURCE_VERSION } from '../../services/outcomeDocxRenditionSourceService.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'
import { projectMeaningMasterSource, MEANING_MASTER_FLAGS, MEANING_MASTER_USE, MEANING_MASTER_VERSION,
  meaningMasterRequestFingerprint } from '../../services/outcomeMeaningSourceMasterContract.js'

// Unsigned test projection. Never source provenance, native admission or a review result.
export const meaningSourceMasterFixture = (runtimeInstanceId = String(ids.runtime)) => {
  const chain = makeRequestScopedQualityChain({ requestId: randomUUID(), draftId: 'logical-test-draft', draftIterationId: 'logical-test-iteration' })
  const scope = { tenantId: String(ids.tenant), customerId: String(ids.customer), runtimeInstanceId }
  const stageRefs = chain.stages.map(stage => ({ stageKey: stage.stageKey, stageExecutionId: stage.stageExecutionId, status: stage.status,
    inputFingerprint: stage.inputFingerprint, outputFingerprint: stage.outputFingerprint,
    attemptFingerprint: stage.attemptFingerprint, materialHash: membershipHash(stage) }))
  Object.assign(stageRefs[5], { status: 'FAILED', outputFingerprint: '' })
  const source = { kind: 'GOVERNED_STAGE_CHAIN', scope: { ...scope, classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false },
    basis: { snapshotId: 'test-snapshot', membershipHash: 'a'.repeat(64), basisStateVersion: 'test-state', lockSnapshotHash: 'b'.repeat(64) },
    plan: { recordId: new mongoose.Types.ObjectId().toString(), planId: 'test-plan', requestId: chain.plan.requestId,
      planFingerprint: chain.plan.planFingerprint, resolutionFingerprint: chain.plan.resolutionFingerprint, contextFingerprint: chain.plan.contextFingerprint },
    logicalDraft: { draftId: 'logical-test-draft', draftIterationId: 'logical-test-iteration' }, stageRefs, selectedPacks: {},
    journal: { claimEventId: 'test-claim', resultEventId: 'test-result' }, priorRuns: [],
    reviewState: { status: 'FAILED', stageStatus: 'FAILED', failure: { failureCode: 'PRESERVED_TEST_FAILURE' } },
    content: { workingDraft: chain.stages[1].outputSnapshot, approvedMeaning: chain.stages[2].outputSnapshot.approvedMeaning,
      shaping: { testOnly: 'Not promoted into the master meaning.' } } }
  const envelope = { contractVersion: OUTCOME_DOCX_RENDITION_SOURCE_VERSION, sourceAdmission: 'VERIFIED_READ_ONLY_CHAIN',
    classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false, normalOutputAvailable: false, authorisesApproval: false,
    renderingAvailable: false, finalisationAvailable: false, deliveryAvailable: false, source, sourceFingerprint: membershipHash(source) }
  const seal = () => { envelope.sourceFingerprint = membershipHash(source) }
  return { envelope, scope, actorUserId: String(ids.actor), seal }
}
export const meaningMasterRecordFixture = () => {
  const fixture = meaningSourceMasterFixture(), sourceSnapshot = projectMeaningMasterSource(fixture.envelope)
  const body = { contractVersion: MEANING_MASTER_VERSION, masterId: 'meaning_master_' + randomUUID(), version: 1,
    purpose: 'MEANING_SOURCE_ONLY', permittedUse: MEANING_MASTER_USE, classification: SYNTHETIC_OUTCOME_CLASSIFICATION,
    status: 'RECORDED_MEANING_SOURCE_ONLY', scope: fixture.scope, requestKey: 'test-' + randomUUID(),
    requestFingerprint: meaningMasterRequestFingerprint(fixture.envelope.sourceFingerprint), createdBy: fixture.actorUserId,
    createdAt: '2026-10-29T14:00:00.000Z', ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])),
    sourceFingerprint: fixture.envelope.sourceFingerprint, sourceProjectionFingerprint: membershipHash(sourceSnapshot), sourceSnapshot }
  const record = { _id: new mongoose.Types.ObjectId(), ...fixture.scope,
    ...Object.fromEntries(['masterId', 'version', 'requestKey', 'requestFingerprint', 'sourceFingerprint', 'permittedUse', 'contractVersion'].map(key => [key, body[key]])),
    bodyFingerprint: membershipHash(body), body, auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 2 }
  return { ...fixture, record, rehash: () => { body.sourceProjectionFingerprint = membershipHash(body.sourceSnapshot); record.bodyFingerprint = membershipHash(body) } }
}
