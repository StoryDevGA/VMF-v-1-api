import { assertAuthorisedArlApproval, assertAuthorisedArlReceipt } from '../services/outcomeArlTransportRecoveryService.js'
import mongoose from 'mongoose'
import { isolatedSyntheticCompletionSourceSchema, isolatedSyntheticCompletionRecoverySchema,
  isolatedSyntheticCompletionTitleRecoverySchema, isolatedSyntheticCompletionRlPersistenceSchema, isolatedSyntheticCompletionExpressionRepairSchema, isolatedSyntheticCompletionExpressionFollowupSchema, isolatedSyntheticCompletionExpressionFaithfulSchema, isolatedSyntheticCompletionExpressionContractSchema, isolatedSyntheticCompletionExpressionReadableSchema, isolatedSyntheticCompletionExpressionOverlaySchema, isolatedSyntheticCompletionExpressionPresentationSchema } from '../validators/isolatedSyntheticOutcome.validator.js'
import { membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'
import { SNAPSHOT_RECOVERY_POLICY as scope } from './RuntimeEvidenceSnapshotRecovery.js'
import { assertDirectSyntheticRevisionLineage, assertSuccessorSyntheticRevisionLineage,
  SYNTHETIC_SUCCESSOR_IDENTITY } from '../services/syntheticOutcomeIsolationService.js'

export const SYNTHETIC_OUTCOME_CLASSIFICATION = 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST'
export const SYNTHETIC_OUTCOME_RUN_COMPLETION_VERSION = 'isolated-synthetic-outcome-run.v21'
export const SYNTHETIC_OUTCOME_RUN_COMPLETION_REFERENCE_VERSION = 'isolated-synthetic-outcome-run.v22'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_PRESENTATION_VERSION = 'isolated-synthetic-outcome-run.v31'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_OVERLAY_VERSION = 'isolated-synthetic-outcome-run.v30'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_READABLE_VERSION = 'isolated-synthetic-outcome-run.v29'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_CONTRACT_VERSION = 'isolated-synthetic-outcome-run.v28'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_FAITHFUL_VERSION = 'isolated-synthetic-outcome-run.v27'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_FOLLOWUP_VERSION = 'isolated-synthetic-outcome-run.v26'
export const SYNTHETIC_OUTCOME_RUN_EXPRESSION_REPAIR_VERSION = 'isolated-synthetic-outcome-run.v25'
export const SYNTHETIC_OUTCOME_RUN_COMPLETION_RL_PERSISTENCE_VERSION = 'isolated-synthetic-outcome-run.v24'
export const SYNTHETIC_OUTCOME_RUN_COMPLETION_TITLE_VERSION = 'isolated-synthetic-outcome-run.v23'
export const SYNTHETIC_OUTCOME_RUN_VERSION = 'isolated-synthetic-outcome-run.v1'
export const SYNTHETIC_OUTCOME_RUN_REVISION_VERSION = 'isolated-synthetic-outcome-run.v2'
export const SYNTHETIC_OUTCOME_RUN_SUCCESSOR_VERSION = 'isolated-synthetic-outcome-run.v3'
export const SYNTHETIC_OUTCOME_RUN_CONTINUATION_VERSION = 'isolated-synthetic-outcome-run.v4'
export const SYNTHETIC_OUTCOME_RUN_RECOVERY_VERSION = 'isolated-synthetic-outcome-run.v5'
export const SYNTHETIC_OUTCOME_RUN_DRAFT_RETRY_VERSION = 'isolated-synthetic-outcome-run.v6'
export const SYNTHETIC_OUTCOME_RUN_DRAFT_REPAIR_VERSION = 'isolated-synthetic-outcome-run.v7'
export const SYNTHETIC_OUTCOME_RUN_HANDOFF_VERSION = 'isolated-synthetic-outcome-run.v8'
export const SYNTHETIC_OUTCOME_RUN_AUTHORISED_REVIEW_VERSION = 'isolated-synthetic-outcome-run.v20'
export const SYNTHETIC_OUTCOME_RUN_DESCRIPTIVE_VERSION = 'isolated-synthetic-outcome-run.v19'
export const SYNTHETIC_OUTCOME_RUN_HOLISTIC_VERSION = 'isolated-synthetic-outcome-run.v18'
export const SYNTHETIC_OUTCOME_RUN_REFERENCE_VERSION = 'isolated-synthetic-outcome-run.v17'
export const SYNTHETIC_OUTCOME_RUN_SCOPING_VERSION = 'isolated-synthetic-outcome-run.v16'
export const SYNTHETIC_OUTCOME_RUN_METADATA_VERSION = 'isolated-synthetic-outcome-run.v15'
export const SYNTHETIC_OUTCOME_RUN_ATTRIBUTION_VERSION = 'isolated-synthetic-outcome-run.v14'
export const SYNTHETIC_OUTCOME_RUN_WORDING_VERSION = 'isolated-synthetic-outcome-run.v13'
export const SYNTHETIC_OUTCOME_RUN_LABEL_VERSION = 'isolated-synthetic-outcome-run.v12'
export const SYNTHETIC_OUTCOME_RUN_TRANSPORT_VERSION = 'isolated-synthetic-outcome-run.v11'
export const SYNTHETIC_OUTCOME_RUN_COMPOSITION_VERSION = 'isolated-synthetic-outcome-run.v10'
export const SYNTHETIC_OUTCOME_RUN_DRAFT_PERSISTENCE_VERSION = 'isolated-synthetic-outcome-run.v9'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const need = condition => { if (!condition) throw new Error('The isolated synthetic run event is invalid.') }
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
export const assertSyntheticOutcomeRunEvent = record => {
  need(mongoose.isValidObjectId(record.auditId) && Number.isSafeInteger(record.auditSignatureVersion) && record.auditSignatureVersion > 0)
  const body = membershipJson(record.body)
  const completionPresentation = body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_PRESENTATION_VERSION
  const completionOverlay = completionPresentation || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_OVERLAY_VERSION
  const completionReadable = completionOverlay || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_READABLE_VERSION
  const completionContract = completionReadable || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_CONTRACT_VERSION
  const completionFaithful = completionContract || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_FAITHFUL_VERSION
  const completionFollowup = completionFaithful || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_FOLLOWUP_VERSION
  const completionExpression = completionFollowup || body?.version === SYNTHETIC_OUTCOME_RUN_EXPRESSION_REPAIR_VERSION
  const completionRl = completionExpression || body?.version === SYNTHETIC_OUTCOME_RUN_COMPLETION_RL_PERSISTENCE_VERSION
  const completionTitle = completionRl || body?.version === SYNTHETIC_OUTCOME_RUN_COMPLETION_TITLE_VERSION
  const completionReference = completionTitle || body?.version === SYNTHETIC_OUTCOME_RUN_COMPLETION_REFERENCE_VERSION
  const completion = completionReference || body?.version === SYNTHETIC_OUTCOME_RUN_COMPLETION_VERSION
  const authorised = body?.version === SYNTHETIC_OUTCOME_RUN_AUTHORISED_REVIEW_VERSION
  const descriptive = body?.version === SYNTHETIC_OUTCOME_RUN_DESCRIPTIVE_VERSION
  const holistic = body?.version === SYNTHETIC_OUTCOME_RUN_HOLISTIC_VERSION
  const reference = body?.version === SYNTHETIC_OUTCOME_RUN_REFERENCE_VERSION
  const scoping = body?.version === SYNTHETIC_OUTCOME_RUN_SCOPING_VERSION
  const metadata = body?.version === SYNTHETIC_OUTCOME_RUN_METADATA_VERSION
  const attribution = body?.version === SYNTHETIC_OUTCOME_RUN_ATTRIBUTION_VERSION
  const wording = body?.version === SYNTHETIC_OUTCOME_RUN_WORDING_VERSION
  const labels = body?.version === SYNTHETIC_OUTCOME_RUN_LABEL_VERSION
  const transport = body?.version === SYNTHETIC_OUTCOME_RUN_TRANSPORT_VERSION
  const composition = body?.version === SYNTHETIC_OUTCOME_RUN_COMPOSITION_VERSION
  const recovery = body?.version === SYNTHETIC_OUTCOME_RUN_RECOVERY_VERSION
  const draftRetry = body?.version === SYNTHETIC_OUTCOME_RUN_DRAFT_RETRY_VERSION
  const draftPersistence = body?.version === SYNTHETIC_OUTCOME_RUN_DRAFT_PERSISTENCE_VERSION
  const handoffRecovery = body?.version === SYNTHETIC_OUTCOME_RUN_HANDOFF_VERSION
  const draftRepair = body?.version === SYNTHETIC_OUTCOME_RUN_DRAFT_REPAIR_VERSION
  const continuation = body?.version === SYNTHETIC_OUTCOME_RUN_CONTINUATION_VERSION
  need(body && Object.keys(body).sort().join(',') === [...(completion ? ['completionSource', ...(completionReference ? ['referenceRecovery'] : []), ...(completionTitle ? ['titleRecovery'] : []), ...(completionRl ? ['rlPersistenceRecovery'] : []), ...(completionExpression ? ['expressionRepair'] : []), ...(completionFollowup ? ['expressionFollowup'] : []), ...(completionFaithful ? ['expressionFaithful'] : []), ...(completionContract ? ['expressionContract'] : []), ...(completionReadable ? ['expressionReadable'] : []), ...(completionOverlay ? ['expressionOverlay'] : []), ...(completionPresentation ? ['expressionPresentation'] : [])] : authorised ? ['authorisedReview', 'reviewApproval'] : descriptive ? ['descriptiveRepair'] : holistic ? ['holisticRepair'] : reference ? ['referenceRepair'] : scoping ? ['scopingRepair'] : metadata ? ['metadataRepair'] : attribution ? ['attributionRepair'] : wording ? ['wordingRepair'] : labels ? ['labelRepair'] : transport ? ['transportRecovery'] : composition ? ['compositionRevision'] : draftPersistence ? ['draftPersistence'] : handoffRecovery ? ['handoffRecovery'] : draftRepair ? ['draftRepair'] : draftRetry ? ['draftRetry'] : recovery ? ['recovery'] : continuation ? ['continuation'] : []), 'version', 'classification', 'eventId', 'phase', 'requestKey', 'payloadHash', 'actorUserId',
    'createdAt', 'basis', 'plan', 'requestBinding', 'claim', 'status', 'stageRefs', 'grrRefs', 'failure'].sort().join(','))
  if (authorised) assertAuthorisedArlApproval(body)
  if (completion) {
    isolatedSyntheticCompletionSourceSchema.parse(body.completionSource)
    if (completionReference) {
      isolatedSyntheticCompletionRecoverySchema.parse(body.referenceRecovery)
      need(body.referenceRecovery.claimEventId !== body.referenceRecovery.resultEventId)
    }
    if (completionTitle) {
      isolatedSyntheticCompletionTitleRecoverySchema.parse(body.titleRecovery)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId,
        body.referenceRecovery.claimEventId, body.referenceRecovery.resultEventId,
        body.titleRecovery.claimEventId, body.titleRecovery.resultEventId]).size === 6)
    }
    if (completionRl) {
      isolatedSyntheticCompletionRlPersistenceSchema.parse(body.rlPersistenceRecovery)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId]).size === 8)
    }
    if (completionExpression) {
      isolatedSyntheticCompletionExpressionRepairSchema.parse(body.expressionRepair)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId]).size === 10)
    }
    if (completionFollowup) {
      isolatedSyntheticCompletionExpressionFollowupSchema.parse(body.expressionFollowup)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId]).size === 12)
    }
    if (completionFaithful) {
      isolatedSyntheticCompletionExpressionFaithfulSchema.parse(body.expressionFaithful)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId,
        body.expressionFaithful.claimEventId, body.expressionFaithful.resultEventId]).size === 14)
    }
    if (completionContract) {
      isolatedSyntheticCompletionExpressionContractSchema.parse(body.expressionContract)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId,
        body.expressionFaithful.claimEventId, body.expressionFaithful.resultEventId,
        body.expressionContract.claimEventId, body.expressionContract.resultEventId]).size === 16)
    }
    if (completionReadable) {
      isolatedSyntheticCompletionExpressionReadableSchema.parse(body.expressionReadable)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId,
        body.expressionFaithful.claimEventId, body.expressionFaithful.resultEventId,
        body.expressionContract.claimEventId, body.expressionContract.resultEventId,
        body.expressionReadable.claimEventId, body.expressionReadable.resultEventId]).size === 18)
    }
    if (completionOverlay) {
      isolatedSyntheticCompletionExpressionOverlaySchema.parse(body.expressionOverlay)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId,
        body.expressionFaithful.claimEventId, body.expressionFaithful.resultEventId,
        body.expressionContract.claimEventId, body.expressionContract.resultEventId,
        body.expressionReadable.claimEventId, body.expressionReadable.resultEventId,
        body.expressionOverlay.claimEventId, body.expressionOverlay.resultEventId]).size === 20)
    }
    if (completionPresentation) {
      isolatedSyntheticCompletionExpressionPresentationSchema.parse(body.expressionPresentation)
      need(new Set([body.completionSource.claimEventId, body.completionSource.resultEventId, body.referenceRecovery.claimEventId,
        body.referenceRecovery.resultEventId, body.titleRecovery.claimEventId, body.titleRecovery.resultEventId,
        body.rlPersistenceRecovery.claimEventId, body.rlPersistenceRecovery.resultEventId,
        body.expressionRepair.claimEventId, body.expressionRepair.resultEventId,
        body.expressionFollowup.claimEventId, body.expressionFollowup.resultEventId,
        body.expressionFaithful.claimEventId, body.expressionFaithful.resultEventId,
        body.expressionContract.claimEventId, body.expressionContract.resultEventId,
        body.expressionReadable.claimEventId, body.expressionReadable.resultEventId,
        body.expressionOverlay.claimEventId, body.expressionOverlay.resultEventId,
        body.expressionPresentation.claimEventId, body.expressionPresentation.resultEventId]).size === 22)
    }
    need((completionPresentation ? ['COMPLETION_EXPRESSION_PRESENTATION_CLAIM', 'COMPLETION_EXPRESSION_PRESENTATION_RESULT'] : completionOverlay ? ['COMPLETION_EXPRESSION_OVERLAY_CLAIM', 'COMPLETION_EXPRESSION_OVERLAY_RESULT'] : completionReadable ? ['COMPLETION_EXPRESSION_READABLE_CLAIM', 'COMPLETION_EXPRESSION_READABLE_RESULT'] : completionContract ? ['COMPLETION_EXPRESSION_CONTRACT_CLAIM', 'COMPLETION_EXPRESSION_CONTRACT_RESULT'] : completionFaithful ? ['COMPLETION_EXPRESSION_FAITHFUL_CLAIM', 'COMPLETION_EXPRESSION_FAITHFUL_RESULT'] : completionFollowup ? ['COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT'] : completionExpression ? ['COMPLETION_EXPRESSION_REPAIR_CLAIM', 'COMPLETION_EXPRESSION_REPAIR_RESULT'] : completionRl ? ['COMPLETION_RL_PERSISTENCE_CLAIM', 'COMPLETION_RL_PERSISTENCE_RESULT'] : completionTitle ? ['COMPLETION_TITLE_CLAIM', 'COMPLETION_TITLE_RESULT'] : completionReference ? ['COMPLETION_REFERENCE_CLAIM', 'COMPLETION_REFERENCE_RESULT'] : ['COMPLETION_CLAIM', 'COMPLETION_RESULT']).includes(body.phase)
      && body.completionSource.claimEventId !== body.completionSource.resultEventId
      && body.completionSource.workingDraftStageExecutionId !== body.completionSource.arlStageExecutionId)
  }
  const successor = completion || authorised || descriptive || holistic || reference || scoping || metadata || attribution || wording || labels || transport || composition || draftPersistence || handoffRecovery || draftRepair || draftRetry || recovery || continuation || body.version === SYNTHETIC_OUTCOME_RUN_SUCCESSOR_VERSION
  const revision = successor || body.version === SYNTHETIC_OUTCOME_RUN_REVISION_VERSION
  need((revision || body.version === SYNTHETIC_OUTCOME_RUN_VERSION) && body.classification?.classification === SYNTHETIC_OUTCOME_CLASSIFICATION
    && exact(body.classification, ['classification', 'customerId', 'tenantId', 'runtimeInstanceId', 'authoritative'])
    && (revision ? /^[a-f0-9]{24}$/.test(body.classification.runtimeInstanceId) && body.classification.runtimeInstanceId !== scope.runtimeInstanceId
      : body.classification.runtimeInstanceId === scope.runtimeInstanceId) && body.classification.customerId === scope.customerId
    && body.classification.tenantId === scope.tenantId && body.classification.authoritative === false
    && body.actorUserId === scope.actorUserId && uuid.test(body.eventId) && uuid.test(body.requestKey)
    && body.eventId === record.eventId && body.phase === record.phase && body.requestKey === record.requestKey
    && body.payloadHash === record.payloadHash && hash.test(body.payloadHash) && membershipHash(body) === record.bodyHash
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(record[key]) === body.classification[key]))
  need(Number.isFinite(Date.parse(body.createdAt)))
  if (revision) {
    need(exact(body.basis, ['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash', 'counts', 'lineage'])
      && /^evidence_snapshot_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.basis.snapshotId)
      && body.basis.snapshotId !== scope.snapshotId && hash.test(body.basis.membershipHash) && (successor || body.basis.membershipHash !== scope.membershipHash)
      && /^rsv2:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.basis.basisStateVersion) && body.basis.basisStateVersion !== scope.stateVersion
      && typeof body.basis.lockSnapshotId === 'string' && body.basis.lockSnapshotId.length > 0 && body.basis.lockSnapshotId.length <= 240
      && hash.test(body.basis.lockSnapshotHash) && exact(body.basis.counts, ['sources', 'evidence', 'sections'])
      && Object.entries({ sources: 1000, evidence: 5000, sections: 100 }).every(([key, cap]) => Number.isSafeInteger(body.basis.counts[key])
        && body.basis.counts[key] >= 0 && body.basis.counts[key] <= cap))
    if (successor) {
      assertSuccessorSyntheticRevisionLineage(body.basis.lineage)
      need(body.classification.runtimeInstanceId === SYNTHETIC_SUCCESSOR_IDENTITY.runtimeInstanceId
        && body.basis.lineage.runtimeInstanceId === body.classification.runtimeInstanceId
        && ['snapshotId', 'basisStateVersion', 'lockSnapshotId'].every(key => body.basis[key] !== body.basis.lineage.parentBasis[key]
          && body.basis[key] !== body.basis.lineage.parentBasis.lineage.parentBasis[key]))
    } else assertDirectSyntheticRevisionLineage(body.basis.lineage)
    need(body.basis.lockSnapshotId !== body.basis.lineage.parentBasis.lockSnapshotId)
  } else need(body.basis?.membershipHash === scope.membershipHash
    && exact(body.basis, ['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash', 'counts', 'correctionReceiptId', 'correctionBodyHash'])
    && exact(body.basis.counts, ['sources', 'evidence', 'sections']) && body.basis.counts.sources === 8
    && body.basis.counts.evidence === 47 && body.basis.counts.sections === 6
    && body.basis.basisStateVersion === scope.stateVersion && body.basis.snapshotId === scope.snapshotId
    && typeof body.basis.correctionReceiptId === 'string' && hash.test(body.basis.correctionBodyHash))
  need(uuid.test(body.plan?.requestId) && /^outcome_kcp_[a-f0-9-]{36}$/.test(body.plan.planId)
    && exact(body.plan, ['recordId', 'requestId', 'planId', 'planFingerprint'])
    && mongoose.isValidObjectId(body.plan.recordId) && hash.test(body.plan.planFingerprint)
    && body.requestBinding?.requestId === body.plan.requestId
    && exact(body.requestBinding, ['requestId', 'draftId', 'draftIterationId'])
    && /^outcome_draft_[a-f0-9-]{36}$/.test(body.requestBinding.draftId)
    && /^outcome_draft_iteration_[a-f0-9-]{36}$/.test(body.requestBinding.draftIterationId))
  if (continuation) need(exact(body.continuation, ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash'])
    && uuid.test(body.continuation.failedClaimEventId) && uuid.test(body.continuation.failedResultEventId)
    && hash.test(body.continuation.failedClaimBodyHash) && hash.test(body.continuation.failedResultBodyHash)
    && body.continuation.failedClaimEventId !== body.continuation.failedResultEventId
    && ['CONTINUATION_CLAIM', 'CONTINUATION_RESULT'].includes(body.phase))
  if (recovery) need(exact(body.recovery, ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash',
    'executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'])
    && uuid.test(body.recovery.failedClaimEventId) && uuid.test(body.recovery.failedResultEventId)
    && hash.test(body.recovery.failedClaimBodyHash) && hash.test(body.recovery.failedResultBodyHash)
    && hash.test(body.recovery.executionHash) && hash.test(body.recovery.artifactHash)
    && /^grr_exec_[a-f0-9-]{36}$/.test(body.recovery.executionId) && /^grr_art_[a-f0-9-]{36}$/.test(body.recovery.runtimeArtifactId)
    && body.recovery.failedClaimEventId !== body.recovery.failedResultEventId
    && ['RECOVERY_CLAIM', 'RECOVERY_RESULT'].includes(body.phase))
  if (draftRetry || draftRepair || handoffRecovery || draftPersistence) {
    const retry = draftPersistence ? body.draftPersistence : handoffRecovery ? body.handoffRecovery : draftRepair ? body.draftRepair : body.draftRetry
    need(exact(retry, ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash',
    'guidanceStageExecutionId', 'guidanceMaterialHash', 'failedDraftStageExecutionId', 'failedDraftMaterialHash',
      ...(draftPersistence ? ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'] : [])])
    && uuid.test(retry.failedClaimEventId) && uuid.test(retry.failedResultEventId)
    && retry.failedClaimEventId !== retry.failedResultEventId
    && ['failedClaimBodyHash', 'failedResultBodyHash', 'guidanceMaterialHash', 'failedDraftMaterialHash'].every(key => hash.test(retry[key]))
    && ['guidanceStageExecutionId', 'failedDraftStageExecutionId'].every(key => /^outcome_quality_stage_[a-f0-9-]{36}$/.test(retry[key]))
    && retry.guidanceStageExecutionId !== retry.failedDraftStageExecutionId
    && (draftPersistence ? ['DRAFT_PERSISTENCE_CLAIM', 'DRAFT_PERSISTENCE_RESULT'] : handoffRecovery ? ['HANDOFF_CLAIM', 'HANDOFF_RESULT'] : draftRepair ? ['DRAFT_REPAIR_CLAIM', 'DRAFT_REPAIR_RESULT'] : ['DRAFT_RETRY_CLAIM', 'DRAFT_RETRY_RESULT']).includes(body.phase))
  }
  if (composition) need(exact(body.compositionRevision, ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash', 'guidanceStageExecutionId', 'guidanceMaterialHash', 'draftStageExecutionId', 'draftMaterialHash', 'failedArlStageExecutionId', 'failedArlMaterialHash'])
    && ['failedClaimEventId', 'failedResultEventId'].every(key => uuid.test(body.compositionRevision[key]))
    && body.compositionRevision.failedClaimEventId !== body.compositionRevision.failedResultEventId
    && ['failedClaimBodyHash', 'failedResultBodyHash', 'guidanceMaterialHash', 'draftMaterialHash', 'failedArlMaterialHash'].every(key => hash.test(body.compositionRevision[key]))
    && ['guidanceStageExecutionId', 'draftStageExecutionId', 'failedArlStageExecutionId'].every(key => /^outcome_quality_stage_[a-f0-9-]{36}$/.test(body.compositionRevision[key]))
    && ['COMPOSITION_CLAIM', 'COMPOSITION_RESULT'].includes(body.phase))
  if (authorised || descriptive || holistic || reference || scoping || metadata || attribution || wording || labels) {
    const repair = authorised ? body.authorisedReview : descriptive ? body.descriptiveRepair : holistic ? body.holisticRepair : reference ? body.referenceRepair : scoping ? body.scopingRepair : metadata ? body.metadataRepair : attribution ? body.attributionRepair : wording ? body.wordingRepair : body.labelRepair
    need(exact(repair, [...(authorised ? ['approvalReference', 'approvalSha256', 'discrepancyOutcome', 'discrepancyPackSha256'] : []), 'failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash', 'guidanceStageExecutionId', 'guidanceMaterialHash', 'draftStageExecutionId', 'draftMaterialHash', 'failedArlStageExecutionId', 'failedArlMaterialHash'])
    && ['failedClaimEventId', 'failedResultEventId'].every(key => uuid.test(repair[key]))
    && repair.failedClaimEventId !== repair.failedResultEventId
    && ['failedClaimBodyHash', 'failedResultBodyHash', 'guidanceMaterialHash', 'draftMaterialHash', 'failedArlMaterialHash'].every(key => hash.test(repair[key]))
    && ['guidanceStageExecutionId', 'draftStageExecutionId', 'failedArlStageExecutionId'].every(key => /^outcome_quality_stage_[a-f0-9-]{36}$/.test(repair[key]))
    && (authorised ? ['AUTHORISED_REVIEW_CLAIM', 'AUTHORISED_REVIEW_RESULT'] : descriptive ? ['DESCRIPTIVE_REPAIR_CLAIM', 'DESCRIPTIVE_REPAIR_RESULT'] : holistic ? ['HOLISTIC_REPAIR_CLAIM', 'HOLISTIC_REPAIR_RESULT'] : reference ? ['REFERENCE_REPAIR_CLAIM', 'REFERENCE_REPAIR_RESULT'] : scoping ? ['SCOPING_REPAIR_CLAIM', 'SCOPING_REPAIR_RESULT'] : metadata ? ['METADATA_REPAIR_CLAIM', 'METADATA_REPAIR_RESULT'] : attribution ? ['ATTRIBUTION_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_RESULT'] : wording ? ['WORDING_REPAIR_CLAIM', 'WORDING_REPAIR_RESULT'] : ['LABEL_REPAIR_CLAIM', 'LABEL_REPAIR_RESULT']).includes(body.phase))
  }
  if (transport) need(exact(body.transportRecovery, ['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash', 'guidanceStageExecutionId', 'guidanceMaterialHash', 'draftStageExecutionId', 'draftMaterialHash', 'failedArlStageExecutionId', 'failedArlMaterialHash'])
    && ['failedClaimEventId', 'failedResultEventId'].every(key => uuid.test(body.transportRecovery[key]))
    && body.transportRecovery.failedClaimEventId !== body.transportRecovery.failedResultEventId
    && ['failedClaimBodyHash', 'failedResultBodyHash', 'guidanceMaterialHash', 'draftMaterialHash', 'failedArlMaterialHash'].every(key => hash.test(body.transportRecovery[key]))
    && ['guidanceStageExecutionId', 'draftStageExecutionId', 'failedArlStageExecutionId'].every(key => /^outcome_quality_stage_[a-f0-9-]{36}$/.test(body.transportRecovery[key]))
    && ['ARL_TRANSPORT_CLAIM', 'ARL_TRANSPORT_RESULT'].includes(body.phase))
  if (draftPersistence) need(/^grr_exec_[a-f0-9-]{36}$/.test(body.draftPersistence.executionId)
    && /^grr_art_[a-f0-9-]{36}$/.test(body.draftPersistence.runtimeArtifactId)
    && hash.test(body.draftPersistence.executionHash) && hash.test(body.draftPersistence.artifactHash))
  need(body.payloadHash === membershipHash({ ...(completion ? { completionSource: body.completionSource, ...(completionReference ? { referenceRecovery: body.referenceRecovery } : {}), ...(completionTitle ? { titleRecovery: body.titleRecovery } : {}), ...(completionRl ? { rlPersistenceRecovery: body.rlPersistenceRecovery } : {}), ...(completionExpression ? { expressionRepair: body.expressionRepair } : {}), ...(completionFollowup ? { expressionFollowup: body.expressionFollowup } : {}), ...(completionFaithful ? { expressionFaithful: body.expressionFaithful } : {}), ...(completionContract ? { expressionContract: body.expressionContract } : {}), ...(completionReadable ? { expressionReadable: body.expressionReadable } : {}), ...(completionOverlay ? { expressionOverlay: body.expressionOverlay } : {}), ...(completionPresentation ? { expressionPresentation: body.expressionPresentation } : {}) } : authorised ? { authorisedReview: body.authorisedReview } : descriptive ? { descriptiveRepair: body.descriptiveRepair } : holistic ? { holisticRepair: body.holisticRepair } : reference ? { referenceRepair: body.referenceRepair } : scoping ? { scopingRepair: body.scopingRepair } : metadata ? { metadataRepair: body.metadataRepair } : attribution ? { attributionRepair: body.attributionRepair } : wording ? { wordingRepair: body.wordingRepair } : labels ? { labelRepair: body.labelRepair } : transport ? { transportRecovery: body.transportRecovery } : composition ? { compositionRevision: body.compositionRevision } : draftPersistence ? { draftPersistence: body.draftPersistence } : handoffRecovery ? { handoffRecovery: body.handoffRecovery } : draftRepair ? { draftRepair: body.draftRepair } : draftRetry ? { draftRetry: body.draftRetry } : recovery ? { recovery: body.recovery } : continuation ? { continuation: body.continuation } : {}), requestKey: body.requestKey, requestId: body.plan.requestId,
    planId: body.plan.planId, expectedPlanFingerprint: body.plan.planFingerprint }))
  need(Array.isArray(body.stageRefs) && body.stageRefs.length <= 3
    && new Set(body.stageRefs.map(row => row.stageKey)).size === body.stageRefs.length)
  for (const [index, row] of body.stageRefs.entries()) need((completion ? ['OUTCOME_NARRATIVE_PLAN', 'OUTPUT_SHAPING', 'RENDERED_EXPRESSION_RL'] : ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'])[index] === row.stageKey
    && (index === 0 || body.stageRefs[index - 1].status === 'SUCCEEDED')
    && exact(row, ['stageKey', 'stageExecutionId', 'status', 'inputFingerprint', 'outputFingerprint', 'attemptFingerprint', 'materialHash', 'grrExecutionId', 'grrRuntimeArtifactId'])
    && typeof row.stageExecutionId === 'string' && row.stageExecutionId.length > 0 && row.stageExecutionId.length <= 180
    && ['SUCCEEDED', 'FAILED'].includes(row.status) && hash.test(row.inputFingerprint)
    && (row.outputFingerprint === '' || hash.test(row.outputFingerprint)) && hash.test(row.attemptFingerprint) && hash.test(row.materialHash))
  need(Array.isArray(body.grrRefs) && body.grrRefs.length <= (completion ? 1 : 3) && new Set(body.grrRefs.map(row => row.executionId)).size === body.grrRefs.length
    && new Set(body.grrRefs.map(row => row.stageKey)).size === body.grrRefs.length)
  for (const row of body.grrRefs) need(Object.keys(row).sort().join(',') === ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash',
    'stageKey', 'stageLinkage', 'stageExecutionId'].sort().join(',') && typeof row.executionId === 'string' && row.executionId.length > 0
    && typeof row.runtimeArtifactId === 'string' && row.runtimeArtifactId.length > 0 && hash.test(row.executionHash) && hash.test(row.artifactHash)
    && (completion ? ['RENDERED_EXPRESSION_RL'] : ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW']).includes(row.stageKey)
    && ['LINKED', 'UNRESOLVED'].includes(row.stageLinkage) && typeof row.stageExecutionId === 'string'
    && (row.stageLinkage === 'UNRESOLVED' ? row.stageExecutionId === '' : body.stageRefs.some(stage => stage.stageExecutionId === row.stageExecutionId
      && stage.stageKey === row.stageKey && stage.grrExecutionId === row.executionId && stage.grrRuntimeArtifactId === row.runtimeArtifactId)))
  if (body.phase === (completion ? (completionPresentation ? 'COMPLETION_EXPRESSION_PRESENTATION_CLAIM' : completionOverlay ? 'COMPLETION_EXPRESSION_OVERLAY_CLAIM' : completionReadable ? 'COMPLETION_EXPRESSION_READABLE_CLAIM' : completionContract ? 'COMPLETION_EXPRESSION_CONTRACT_CLAIM' : completionFaithful ? 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM' : completionFollowup ? 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM' : completionExpression ? 'COMPLETION_EXPRESSION_REPAIR_CLAIM' : completionRl ? 'COMPLETION_RL_PERSISTENCE_CLAIM' : completionTitle ? 'COMPLETION_TITLE_CLAIM' : completionReference ? 'COMPLETION_REFERENCE_CLAIM' : 'COMPLETION_CLAIM') : authorised ? 'AUTHORISED_REVIEW_CLAIM' : descriptive ? 'DESCRIPTIVE_REPAIR_CLAIM' : holistic ? 'HOLISTIC_REPAIR_CLAIM' : reference ? 'REFERENCE_REPAIR_CLAIM' : scoping ? 'SCOPING_REPAIR_CLAIM' : metadata ? 'METADATA_REPAIR_CLAIM' : attribution ? 'ATTRIBUTION_REPAIR_CLAIM' : wording ? 'WORDING_REPAIR_CLAIM' : labels ? 'LABEL_REPAIR_CLAIM' : transport ? 'ARL_TRANSPORT_CLAIM' : composition ? 'COMPOSITION_CLAIM' : draftPersistence ? 'DRAFT_PERSISTENCE_CLAIM' : handoffRecovery ? 'HANDOFF_CLAIM' : draftRepair ? 'DRAFT_REPAIR_CLAIM' : draftRetry ? 'DRAFT_RETRY_CLAIM' : recovery ? 'RECOVERY_CLAIM' : continuation ? 'CONTINUATION_CLAIM' : 'CLAIM')) need(body.status === 'CLAIMED' && body.claim === null && body.stageRefs.length === 0 && body.grrRefs.length === 0 && body.failure === null)
  else need(body.phase === (completion ? (completionPresentation ? 'COMPLETION_EXPRESSION_PRESENTATION_RESULT' : completionOverlay ? 'COMPLETION_EXPRESSION_OVERLAY_RESULT' : completionReadable ? 'COMPLETION_EXPRESSION_READABLE_RESULT' : completionContract ? 'COMPLETION_EXPRESSION_CONTRACT_RESULT' : completionFaithful ? 'COMPLETION_EXPRESSION_FAITHFUL_RESULT' : completionFollowup ? 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT' : completionExpression ? 'COMPLETION_EXPRESSION_REPAIR_RESULT' : completionRl ? 'COMPLETION_RL_PERSISTENCE_RESULT' : completionTitle ? 'COMPLETION_TITLE_RESULT' : completionReference ? 'COMPLETION_REFERENCE_RESULT' : 'COMPLETION_RESULT') : authorised ? 'AUTHORISED_REVIEW_RESULT' : descriptive ? 'DESCRIPTIVE_REPAIR_RESULT' : holistic ? 'HOLISTIC_REPAIR_RESULT' : reference ? 'REFERENCE_REPAIR_RESULT' : scoping ? 'SCOPING_REPAIR_RESULT' : metadata ? 'METADATA_REPAIR_RESULT' : attribution ? 'ATTRIBUTION_REPAIR_RESULT' : wording ? 'WORDING_REPAIR_RESULT' : labels ? 'LABEL_REPAIR_RESULT' : transport ? 'ARL_TRANSPORT_RESULT' : composition ? 'COMPOSITION_RESULT' : draftPersistence ? 'DRAFT_PERSISTENCE_RESULT' : handoffRecovery ? 'HANDOFF_RESULT' : draftRepair ? 'DRAFT_REPAIR_RESULT' : draftRetry ? 'DRAFT_RETRY_RESULT' : recovery ? 'RECOVERY_RESULT' : continuation ? 'CONTINUATION_RESULT' : 'RESULT') && (completion ? ['BLOCKED', 'FAILED', 'UNKNOWN'] : ['ARL_PASSED', 'FAILED', 'UNKNOWN']).includes(body.status)
    && exact(body.claim, ['eventId', 'bodyHash']) && uuid.test(body.claim.eventId) && hash.test(body.claim.bodyHash)
    && (body.status !== 'FAILED' || body.stageRefs.at(-1)?.status === 'FAILED')
    && (body.status !== 'ARL_PASSED' || (body.stageRefs.length === 3 && body.stageRefs.every(row => row.status === 'SUCCEEDED')
      && body.grrRefs.length === 3 && body.grrRefs.every(row => row.stageLinkage === 'LINKED'))))
  if (completion && !completionExpression && body.phase === (completionPresentation ? 'COMPLETION_EXPRESSION_PRESENTATION_RESULT' : completionOverlay ? 'COMPLETION_EXPRESSION_OVERLAY_RESULT' : completionReadable ? 'COMPLETION_EXPRESSION_READABLE_RESULT' : completionContract ? 'COMPLETION_EXPRESSION_CONTRACT_RESULT' : completionFaithful ? 'COMPLETION_EXPRESSION_FAITHFUL_RESULT' : completionFollowup ? 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT' : completionExpression ? 'COMPLETION_EXPRESSION_REPAIR_RESULT' : completionRl ? 'COMPLETION_RL_PERSISTENCE_RESULT' : completionTitle ? 'COMPLETION_TITLE_RESULT' : completionReference ? 'COMPLETION_REFERENCE_RESULT' : 'COMPLETION_RESULT')) need(body.failure && typeof body.failure.failureCode === 'string'
    && (body.status !== 'BLOCKED' || (body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
      && body.stageRefs.length === 3 && body.stageRefs.every(row => row.status === 'SUCCEEDED')
      && body.grrRefs.length === 1 && body.grrRefs[0].stageLinkage === 'LINKED')))
  if (completionTitle && body.phase === 'COMPLETION_TITLE_RESULT') need(body.stageRefs[0]?.status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.titleRecovery.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.titleRecovery.narrativeMaterialHash)
  if (completionRl && body.phase === 'COMPLETION_RL_PERSISTENCE_RESULT') need(body.status === 'UNKNOWN' || (body.status === 'FAILED'
    && body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' && body.stageRefs.length === 3
    && body.stageRefs[1].stageExecutionId === body.rlPersistenceRecovery.shapingStageExecutionId
    && body.stageRefs[1].materialHash === body.rlPersistenceRecovery.shapingMaterialHash
    && body.grrRefs.length === 1 && body.grrRefs[0].stageLinkage === 'LINKED'
    && body.grrRefs[0].executionHash === body.rlPersistenceRecovery.executionHash
    && body.grrRefs[0].artifactHash === body.rlPersistenceRecovery.artifactHash))
  if (completionExpression && body.phase === 'COMPLETION_EXPRESSION_REPAIR_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionRepair.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionRepair.narrativeMaterialHash
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionFollowup && body.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionFollowup.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionFollowup.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionFollowup.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionFaithful && body.phase === 'COMPLETION_EXPRESSION_FAITHFUL_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionFaithful.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionFaithful.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionFaithful.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionContract && body.phase === 'COMPLETION_EXPRESSION_CONTRACT_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionContract.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionContract.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionContract.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionReadable && body.phase === 'COMPLETION_EXPRESSION_READABLE_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionReadable.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionReadable.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionReadable.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionOverlay && body.phase === 'COMPLETION_EXPRESSION_OVERLAY_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionOverlay.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionOverlay.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionOverlay.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (completionPresentation && body.phase === 'COMPLETION_EXPRESSION_PRESENTATION_RESULT') need(body.failure && body.stageRefs.length >= 1
    && body.stageRefs.length <= 3 && body.stageRefs[0].status === 'SUCCEEDED'
    && body.stageRefs[0].stageExecutionId === body.expressionPresentation.narrativeStageExecutionId
    && body.stageRefs[0].materialHash === body.expressionPresentation.narrativeMaterialHash
    && (body.stageRefs.length < 2 || body.stageRefs[1].outputFingerprint === body.expressionPresentation.reviewedOutputFingerprint)
    && (body.status === 'UNKNOWN' || (body.stageRefs.length === 3 && body.grrRefs.length === 1
      && body.grrRefs[0].stageLinkage === 'LINKED' && (body.status === 'FAILED'
        ? body.failure.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        : body.status === 'BLOCKED' && body.failure.failureCode === 'SYNTHETIC_TEST_DELIVERY_HELD'
          && body.stageRefs.every(row => row.status === 'SUCCEEDED')))))
  if (authorised && body.failure?.details?.authorisedReview) {
    const observed = assertAuthorisedArlReceipt(body.failure.details.authorisedReview, { terminal: true })
    need(body.status === 'UNKNOWN' && body.phase === 'AUTHORISED_REVIEW_RESULT'
      && !body.stageRefs.some(row => row.stageKey === 'ARL_MEANING_REVIEW')
      && body.failure.failureCode === 'ARL_AUTHORISED_REVIEW_UNRESOLVED' && body.failure.details.reason === 'COMPLETED_RESPONSE_UNUSABLE'
      && observed.responseState === 'FRESH' && observed.claimEventId === body.claim.eventId && observed.claimBodyHash === body.claim.bodyHash
      && observed.workingDraftMaterialHash === body.authorisedReview.draftMaterialHash
      && observed.priorArlMaterialHash === body.authorisedReview.failedArlMaterialHash)
  }
  need(Buffer.byteLength(JSON.stringify(body)) <= 128 * 1024)
  return body
}
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
const schema = new mongoose.Schema({ customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  eventId: { type: String, required: true, match: uuid }, phase: { type: String, required: true, enum: ['COMPLETION_EXPRESSION_PRESENTATION_CLAIM', 'COMPLETION_EXPRESSION_PRESENTATION_RESULT', 'COMPLETION_EXPRESSION_OVERLAY_CLAIM', 'COMPLETION_EXPRESSION_OVERLAY_RESULT', 'COMPLETION_EXPRESSION_READABLE_CLAIM', 'COMPLETION_EXPRESSION_READABLE_RESULT', 'COMPLETION_EXPRESSION_CONTRACT_CLAIM', 'COMPLETION_EXPRESSION_CONTRACT_RESULT', 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM', 'COMPLETION_EXPRESSION_FAITHFUL_RESULT', 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT', 'COMPLETION_EXPRESSION_REPAIR_CLAIM', 'COMPLETION_EXPRESSION_REPAIR_RESULT', 'COMPLETION_RL_PERSISTENCE_CLAIM', 'COMPLETION_RL_PERSISTENCE_RESULT', 'COMPLETION_TITLE_CLAIM', 'COMPLETION_TITLE_RESULT', 'COMPLETION_REFERENCE_CLAIM', 'COMPLETION_REFERENCE_RESULT', 'COMPLETION_CLAIM', 'COMPLETION_RESULT', 'AUTHORISED_REVIEW_CLAIM', 'AUTHORISED_REVIEW_RESULT', 'DESCRIPTIVE_REPAIR_CLAIM', 'DESCRIPTIVE_REPAIR_RESULT', 'HOLISTIC_REPAIR_CLAIM', 'HOLISTIC_REPAIR_RESULT', 'REFERENCE_REPAIR_CLAIM', 'REFERENCE_REPAIR_RESULT', 'SCOPING_REPAIR_CLAIM', 'SCOPING_REPAIR_RESULT', 'METADATA_REPAIR_CLAIM', 'METADATA_REPAIR_RESULT', 'ATTRIBUTION_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_RESULT', 'WORDING_REPAIR_CLAIM', 'WORDING_REPAIR_RESULT', 'LABEL_REPAIR_CLAIM', 'LABEL_REPAIR_RESULT', 'ARL_TRANSPORT_CLAIM', 'ARL_TRANSPORT_RESULT', 'COMPOSITION_CLAIM', 'COMPOSITION_RESULT', 'CLAIM', 'RESULT', 'CONTINUATION_CLAIM', 'CONTINUATION_RESULT', 'RECOVERY_CLAIM', 'RECOVERY_RESULT', 'DRAFT_RETRY_CLAIM', 'DRAFT_RETRY_RESULT', 'DRAFT_REPAIR_CLAIM', 'DRAFT_REPAIR_RESULT', 'HANDOFF_CLAIM', 'HANDOFF_RESULT', 'DRAFT_PERSISTENCE_CLAIM', 'DRAFT_PERSISTENCE_RESULT'] },
  requestKey: { type: String, required: true, match: uuid }, payloadHash: { type: String, required: true, match: hash },
  bodyHash: { type: String, required: true, match: hash }, body: { type: mongoose.Schema.Types.Mixed, required: true },
  auditId: id('AuditLog'), auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_synthetic_outcome_run_events', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) { try { assertSyntheticOutcomeRunEvent(this); next() } catch (error) { next(error) } })
schema.pre('save', function (next) {
  try { need(this.isNew); assertSyntheticOutcomeRunEvent(this); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const row of records) { assertSyntheticOutcomeRunEvent(row); const error = new this(row).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Synthetic outcome run events are immutable.') })
}
schema.pre('bulkWrite', function (next, operations) {
  try { for (const operation of operations) {
    need(Object.keys(operation).length === 1 && operation.insertOne)
    assertSyntheticOutcomeRunEvent(operation.insertOne.document)
    const error = new this(operation.insertOne.document).validateSync(); if (error) throw error
  }; next() } catch (error) { next(error) }
})
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, phase: 1 }, { unique: true, name: 'unique_scoped_synthetic_outcome_phase' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, eventId: 1 }, { unique: true, name: 'unique_scoped_synthetic_outcome_event' })
export default mongoose.model('SyntheticOutcomeRunEvent', schema)
