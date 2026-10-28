import { OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeDecisionLedCommercialExpressionProfile.js'
import { OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeGovernedCommercialExpressionProfile.js'
import { buildCommercialOutputContract } from '../utils/outcomeCommercialExpressionProfile.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { assertStyleOverlaySourceEligibility } from './styleOverlayPolicy.js'
import { OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeReadableCommercialExpressionProfile.js'
import { randomUUID } from 'node:crypto'
import { OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeCommercialExpressionProfile.js'
import { SYNTHETIC_OUTCOME_RUN_COMPLETION_VERSION as VERSION, SYNTHETIC_OUTCOME_RUN_COMPLETION_REFERENCE_VERSION as REFERENCE_VERSION,
  SYNTHETIC_OUTCOME_RUN_COMPLETION_TITLE_VERSION as TITLE_VERSION,
  SYNTHETIC_OUTCOME_RUN_COMPLETION_RL_PERSISTENCE_VERSION as RL_PERSISTENCE_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_REPAIR_VERSION as EXPRESSION_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_FOLLOWUP_VERSION as FOLLOWUP_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_FAITHFUL_VERSION as FAITHFUL_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_CONTRACT_VERSION as CONTRACT_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_READABLE_VERSION as READABLE_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_OVERLAY_VERSION as OVERLAY_VERSION,
  SYNTHETIC_OUTCOME_RUN_EXPRESSION_PRESENTATION_VERSION as PRESENTATION_VERSION } from '../models/SyntheticOutcomeRunEvent.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Grr from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { isolatedSyntheticOutcomeInternals as h, readIsolatedSyntheticOutcome } from './isolatedSyntheticOutcomeService.js'
import { createOutcomeNarrativePlan, createOutcomeShapedCandidate, createOutcomeShapedCandidateRevision, buildOutcomeShapedCandidateRevisionOutput } from './outcomePostArlQualityChainService.js'
import { executeOutcomeRenderedExpressionRl, assertSavedOutcomeRenderedExpressionRlFailure, persistSavedOutcomeRenderedExpressionRlFailure } from './outcomeRenderedExpressionRlExecutionService.js'
import { createGovernedReasoningExecution } from './governedReasoningRuntimeService.js'
import { assertNoSyntheticRenderRecordInsertion } from './syntheticRenderArtifactContract.js'
import { assertOutcomeQualityStageRetryLineage, hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION, OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeRenderedExpressionRevision.js'
import { isolatedSyntheticCompleteSchema } from '../validators/isolatedSyntheticOutcome.validator.js'

const KEYS = ['OUTCOME_NARRATIVE_PLAN', 'OUTPUT_SHAPING', 'RENDERED_EXPRESSION_RL']
const need = (value, reason, status = 409) => { if (!value) throw Object.assign(new Error('The isolated downstream test cannot continue.'), {
  code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', status, details: { reason } }) }
const equal = (a, b) => membershipHash(a) === membershipHash(b)
const read = (args, name, fallback, filter, session) => h.query(h.model(args.deps || {}, name, fallback).findOne(filter), session)
const rows = (args, name, fallback, filter, session) => h.query(h.model(args.deps || {}, name, fallback).find(filter).limit(2), session)
const planIdentity = plan => ({ recordId: String(plan._id || plan.id), requestId: plan.requestId, planId: plan.planId, planFingerprint: plan.planFingerprint })
const sourceLink = (claim, result) => ({ claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
  resultEventId: result.eventId, resultBodyHash: result.bodyHash,
  workingDraftStageExecutionId: result.body.stageRefs[1].stageExecutionId, workingDraftMaterialHash: result.body.stageRefs[1].materialHash,
  arlStageExecutionId: result.body.stageRefs[2].stageExecutionId, arlMaterialHash: result.body.stageRefs[2].materialHash })
const verifyGrrAudit = async (args, execution, session) => {
  need(execution.auditLogIds?.length === 1, 'GRR_AUDIT_REQUIRED')
  const audit = await read(args, 'AuditLog', Audit, { _id: execution.auditLogIds[0] }, session)
  need(audit && h.signed(audit, args.deps || {}) && audit.action === 'GOVERNED_REASONING_EXECUTED'
    && audit.resourceType === 'GovernedReasoningExecution' && String(audit.resourceId) === String(execution._id)
    && String(audit.actorUserId) === String(args.actorUserId)
    && audit.diff?.executionId === execution.executionId && equal(audit.diff.artifactIds, execution.artifactIds)
    && audit.diff.providerMode === 'LIVE_TEST' && audit.diff.outputTypeKey === execution.outputTypeKey
    && String(audit.diff.runtimeInstanceId) === args.runtimeInstanceId
    && ['customerId', 'tenantId'].every(key => String(audit.scope?.[key]) === String(execution[key])), 'GRR_AUDIT_INVALID')
}
// The recursive original reader runs outside transaction. Inside each snapshot, compare
// its exact immutable source cohort and verify the signed events/stages/provider audit.
const verifySource = async (args, auth, plan, verified, expected, session = null) => {
  const claim = await h.eventRead('AUTHORISED_REVIEW_CLAIM', args, session)
  const result = await h.eventRead('AUTHORISED_REVIEW_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(result.body.status === 'ARL_PASSED' && result.body.stageRefs.length === 3
    && result.body.stageRefs.every(row => row.status === 'SUCCEEDED')
    && equal(sourceLink(claim, result), expected)
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && verified.run.status === 'ARL_PASSED' && verified.run.claimEventId === claim.eventId
    && verified.run.resultEventId === result.eventId && equal(verified.run.stageRefs, result.body.stageRefs)
    && equal(verified.run.grrRefs, result.body.grrRefs), 'COMPLETION_SOURCE_CHANGED')
  for (const ref of result.body.stageRefs) {
    const recorded = await h.readRecordedStage(ref, args, claim.body.plan, session)
    h.assertReturnedStage(recorded.stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
    await h.verifyRecordedStageAudit(recorded.raw, args, session)
  }
  for (const pair of verified.grr) {
    const execution = await read(args, 'GovernedReasoningExecution', Grr, { ...h.scope(args.runtimeInstanceId), executionId: pair.executionId }, session)
    const artifact = await read(args, 'GovernedRuntimeArtifact', Artifact, { ...h.scope(args.runtimeInstanceId), runtimeArtifactId: pair.runtimeArtifactId }, session)
    need(execution && artifact && membershipHash(execution) === pair.executionHash && membershipHash(artifact) === pair.artifactHash, 'COMPLETION_SOURCE_PROVIDER_CHANGED')
    await verifyGrrAudit(args, execution, session)
  }
  return { claim, result }
}
const verifyReferenceRecovery = async (args, auth, plan, expected, completionSource, session = null) => {
  if (!expected) return null
  const claim = await h.eventRead('COMPLETION_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(claim.body.version === VERSION && result.body.version === VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'UNKNOWN' && result.body.failure?.failureCode === 'OUTCOME_QUALITY_STAGE_BINDING_INVALID'
    && result.body.failure?.details?.field === 'output.sections[0].truthReferences'
    && result.body.stageRefs.length === 0 && result.body.grrRefs.length === 0
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan)) && equal(result.body.completionSource, completionSource)
    && equal(claim.body.completionSource, completionSource), 'COMPLETION_REFERENCE_SOURCE_CHANGED')
  return { claim, result }
}
const verifyTitleRecovery = async (args, auth, plan, expected, completionSource, referenceRecovery, session = null) => {
  if (!expected) return null
  const claim = await h.eventRead('COMPLETION_REFERENCE_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_REFERENCE_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(claim.body.version === REFERENCE_VERSION && result.body.version === REFERENCE_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'UNKNOWN' && result.body.failure?.failureCode === 'OUTCOME_POST_ARL_QUALITY_CHAIN_INVALID'
    && result.body.failure?.message === 'The exact Outcome Narrative Plan is unavailable for shaping.'
    && result.body.stageRefs.length === 1 && result.body.stageRefs[0].stageKey === KEYS[0]
    && result.body.stageRefs[0].status === 'SUCCEEDED' && result.body.grrRefs.length === 0
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && equal(claim.body.completionSource, completionSource) && equal(result.body.completionSource, completionSource)
    && equal(claim.body.referenceRecovery, referenceRecovery) && equal(result.body.referenceRecovery, referenceRecovery),
  'COMPLETION_TITLE_SOURCE_CHANGED')
  const ref = result.body.stageRefs[0]
  need(ref.stageExecutionId === expected.narrativeStageExecutionId && ref.materialHash === expected.narrativeMaterialHash,
    'COMPLETION_TITLE_NARRATIVE_CHANGED')
  const narrative = await h.readRecordedStage(ref, args, claim.body.plan, session)
  h.assertReturnedStage(narrative.stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
  await h.verifyRecordedStageAudit(narrative.raw, args, session)
  const source = await h.eventRead('AUTHORISED_REVIEW_RESULT', args, session)
  const arl = source.body.stageRefs[2]
  need(narrative.stage.stageOrder === 4 && narrative.stage.attemptNumber === 1
    && narrative.stage.predecessorStageExecutionId === arl.stageExecutionId
    && narrative.stage.predecessorAttemptFingerprint === arl.attemptFingerprint
    && narrative.stage.inputSnapshot?.sourceStage?.stageExecutionId === arl.stageExecutionId
    && narrative.stage.inputSnapshot.sourceStage.attemptFingerprint === arl.attemptFingerprint
    && narrative.stage.inputSnapshot.sourceStage.outputFingerprint === arl.outputFingerprint, 'COMPLETION_TITLE_NARRATIVE_CHANGED')
  const draft = await h.readRecordedStage(source.body.stageRefs[1], args, claim.body.plan, session)
  const title = draft.stage.outputSnapshot?.title
  need(typeof title === 'string' && title.trim().length > 0 && membershipHash(title) === expected.titleHash,
    'COMPLETION_TITLE_CHANGED')
  return { claim, result, narrativeRef: ref, title }
}
const verifyRlPersistenceRecovery = async (args, auth, plan, expected, claimLinks, session = null, allowStage = false, originalStageIds = null) => {
  if (!expected) return null
  const claim = await h.eventRead('COMPLETION_TITLE_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_TITLE_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(claim.body.version === TITLE_VERSION && result.body.version === TITLE_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'UNKNOWN' && result.body.failure?.failureCode === 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED'
    && result.body.stageRefs.length === 2 && result.body.stageRefs.every(row => row.status === 'SUCCEEDED')
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'UNRESOLVED'
    && result.body.grrRefs[0].stageExecutionId === ''
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery'].every(key => equal(claim.body[key], claimLinks[key])
      && equal(result.body[key], claimLinks[key])), 'COMPLETION_RL_PERSISTENCE_SOURCE_CHANGED')
  const recorded = await collectDownstream(args, claim, session, originalStageIds)
  need(equal(recorded.stageRefs.slice(0, 2), result.body.stageRefs)
    && (allowStage ? recorded.stageRefs.length <= 3 : recorded.stageRefs.length === 2)
    && result.body.stageRefs[1].stageExecutionId === expected.shapingStageExecutionId
    && result.body.stageRefs[1].materialHash === expected.shapingMaterialHash
    && recorded.grr.length === 1 && recorded.grr[0].executionId === expected.executionId
    && recorded.grr[0].runtimeArtifactId === expected.runtimeArtifactId
    && recorded.grr[0].executionHash === expected.executionHash && recorded.grr[0].artifactHash === expected.artifactHash
    && equal({ ...recorded.grrRefs[0], stageLinkage: 'UNRESOLVED', stageExecutionId: '' }, result.body.grrRefs[0]),
  'COMPLETION_RL_PERSISTENCE_MATERIAL_CHANGED')
  const pair = recorded.grr[0], shaping = recorded.stages[1]
  assertSavedOutcomeRenderedExpressionRlFailure({ ...pair, source: shaping, plan, runtime: auth.runtime, classification: h.runClassification(claim) })
  if (recorded.stages[2]) need(recorded.stages[2].status === 'FAILED'
    && recorded.stages[2].failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && recorded.grrRefs[0].stageLinkage === 'LINKED', 'COMPLETION_RL_PERSISTENCE_STAGE_INVALID')
  return { claim, result, pair, shaping, classification: h.runClassification(claim) }
}
const collectDownstream = async (args, claim, session = null, originalStageIds = null) => {
  need(!originalStageIds || originalStageIds.length === 3 && new Set(originalStageIds).size === 3, 'EXPRESSION_ORIGINAL_STAGE_IDS_INVALID')
  const stageRows = await h.query(h.model(args.deps || {}, 'OutcomeQualityStageExecution', Stage).find({
    ...h.scope(args.runtimeInstanceId), requestId: claim.body.plan.requestId, planId: claim.body.plan.planId,
    draftId: claim.body.requestBinding.draftId, draftIterationId: claim.body.requestBinding.draftIterationId,
    stageKey: { $in: KEYS }, ...(originalStageIds ? { stageExecutionId: { $in: originalStageIds } } : {}) }).limit(4), session)
  need(stageRows.length <= 3 && new Set(stageRows.map(row => row.stageKey)).size === stageRows.length, 'COMPLETION_STAGE_POPULATION_INVALID')
  stageRows.sort((a, b) => KEYS.indexOf(a.stageKey) - KEYS.indexOf(b.stageKey))
  const stages = [], refs = []
  let previous = claim.body.completionSource.arlStageExecutionId
  const parent = await h.eventRead('AUTHORISED_REVIEW_RESULT', args, session)
  let prior = parent.body.stageRefs[2]
  for (const [index, raw] of stageRows.entries()) {
    const ref = h.stageRef(raw), recorded = await h.readRecordedStage(ref, args, claim.body.plan, session)
    const stage = recorded.stage
    need(stage.stageKey === KEYS[index] && stage.stageOrder === index + 4 && stage.attemptNumber === 1
      && stage.predecessorStageExecutionId === previous && stage.predecessorAttemptFingerprint === prior.attemptFingerprint
      && stage.inputSnapshot?.sourceStage?.stageExecutionId === previous
      && stage.inputSnapshot.sourceStage.attemptFingerprint === prior.attemptFingerprint
      && stage.inputSnapshot.sourceStage.outputFingerprint === prior.outputFingerprint
      && (!index || stages[index - 1].status === 'SUCCEEDED'), 'COMPLETION_STAGE_LINEAGE_INVALID')
    h.assertReturnedStage(stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
    await h.verifyRecordedStageAudit(recorded.raw, args, session)
    stages.push(stage); refs.push(ref); previous = stage.stageExecutionId; prior = ref
  }
  const provider = await collectDownstreamProvider(args, claim, refs, session)
  return { stages, stageRefs: refs, ...provider }
}
const collectDownstreamProvider = async (args, claim, refs, session = null) => {
  const providerClaim = !claim.body.expressionRepair && claim.body.rlPersistenceRecovery
    ? await h.eventRead('COMPLETION_TITLE_CLAIM', args, session) : claim
  const expectedClassification = h.runClassification(providerClaim)
  const executions = await rows(args, 'GovernedReasoningExecution', Grr, { ...h.scope(args.runtimeInstanceId), 'executionEvidence.syntheticClassification.runEventId': providerClaim.eventId }, session)
  const artifacts = await rows(args, 'GovernedRuntimeArtifact', Artifact, { ...h.scope(args.runtimeInstanceId), 'lineageSummary.syntheticClassification.runEventId': providerClaim.eventId }, session)
  need(executions.length <= 1 && artifacts.length === executions.length, 'COMPLETION_GRR_POPULATION_INVALID')
  const grr = [], grrRefs = []
  for (const execution of executions) {
    const artifact = artifacts.find(row => row.executionId === execution.executionId)
    need(artifact && execution.outputTypeKey === 'RENDERED_EXPRESSION_RL' && artifact.outputTypeKey === execution.outputTypeKey
      && artifact.artifactType === 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST'
      && execution.status === 'COMPLETED' && execution.providerMode === 'LIVE_TEST'
      && execution.provider?.liveProvider === true && execution.provider.providerMode === 'LIVE_TEST'
      && String(execution.requestedBy) === String(args.actorUserId)
      && artifact.status === 'GENERATED' && String(artifact.generatedBy) === String(args.actorUserId)
      && execution.artifactIds?.includes(artifact.runtimeArtifactId)
      && equal(execution.executionEvidence?.syntheticClassification, expectedClassification)
      && equal(artifact.lineageSummary?.syntheticClassification, expectedClassification), 'COMPLETION_GRR_CLASSIFICATION_INVALID')
    await new Grr(execution).validate()
    await new Artifact(artifact).validate()
    await verifyGrrAudit(args, execution, session)
    const matches = refs.filter(row => row.grrExecutionId === execution.executionId && row.grrRuntimeArtifactId === artifact.runtimeArtifactId)
    need(matches.length <= 1 && (!matches.length || matches[0].stageKey === KEYS[2]), 'COMPLETION_GRR_STAGE_INVALID')
    const ref = { executionId: execution.executionId, runtimeArtifactId: artifact.runtimeArtifactId,
      executionHash: membershipHash(execution), artifactHash: membershipHash(artifact), stageKey: KEYS[2],
      stageLinkage: matches.length ? 'LINKED' : 'UNRESOLVED', stageExecutionId: matches[0]?.stageExecutionId || '' }
    grrRefs.push(ref); grr.push({ ...ref, execution, artifact })
  }
  need(refs.every(ref => !ref.grrExecutionId || grrRefs.some(pair => pair.executionId === ref.grrExecutionId && pair.runtimeArtifactId === ref.grrRuntimeArtifactId)), 'COMPLETION_GRR_MISSING')
  return { grr, grrRefs }
}

export const readLatestIsolatedSyntheticOutcome = async args => {
  const contractClaim = await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_CLAIM', args)
  if (contractClaim) return readExpressionRepair(args, contractClaim)
  need(!await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_RESULT', args), 'EXPRESSION_CONTRACT_CLAIM_MISSING')
  const faithfulClaim = await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_CLAIM', args)
  if (faithfulClaim) return readExpressionRepair(args, faithfulClaim)
  need(!await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_RESULT', args), 'EXPRESSION_FAITHFUL_CLAIM_MISSING')
  const followupClaim = await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', args)
  if (followupClaim) return readExpressionRepair(args, followupClaim)
  need(!await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_RESULT', args), 'EXPRESSION_FOLLOWUP_CLAIM_MISSING')
  const expressionClaim = await h.eventRead('COMPLETION_EXPRESSION_REPAIR_CLAIM', args)
  if (expressionClaim) return readExpressionRepair(args, expressionClaim)
  need(!await h.eventRead('COMPLETION_EXPRESSION_REPAIR_RESULT', args), 'EXPRESSION_CLAIM_MISSING')
  const source = await (args.deps?.readSourceRun || readIsolatedSyntheticOutcome)(args)
  const baseClaim = await h.eventRead('COMPLETION_CLAIM', args), baseResult = await h.eventRead('COMPLETION_RESULT', args)
  const recoveryClaim = await h.eventRead('COMPLETION_REFERENCE_CLAIM', args), recoveryResult = await h.eventRead('COMPLETION_REFERENCE_RESULT', args)
  const titleClaim = await h.eventRead('COMPLETION_TITLE_CLAIM', args), titleResult = await h.eventRead('COMPLETION_TITLE_RESULT', args)
  const rlClaim = await h.eventRead('COMPLETION_RL_PERSISTENCE_CLAIM', args), rlResult = await h.eventRead('COMPLETION_RL_PERSISTENCE_RESULT', args)
  need(rlClaim || !rlResult, 'COMPLETION_RL_PERSISTENCE_CLAIM_MISSING')
  need(recoveryClaim || !recoveryResult, 'COMPLETION_REFERENCE_CLAIM_MISSING')
  need(titleClaim || !titleResult, 'COMPLETION_TITLE_CLAIM_MISSING')
  const claim = rlClaim || titleClaim || recoveryClaim || baseClaim, result = rlClaim ? rlResult : titleClaim ? titleResult : recoveryClaim ? recoveryResult : baseResult
  if (!claim) { need(!result, 'COMPLETION_CLAIM_MISSING'); return source }
  const auth = await h.authorize(args)
  const boundArgs = { ...args, payload: { requestId: claim.body.plan.requestId, planId: claim.body.plan.planId,
    expectedPlanFingerprint: claim.body.plan.planFingerprint } }
  const plan = await h.readPlan(boundArgs, auth)
  await verifySource(boundArgs, auth, plan, source, claim.body.completionSource)
  need(equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan)), 'COMPLETION_BASIS_CHANGED')
  const prior = await verifyReferenceRecovery(boundArgs, auth, plan, claim.body.referenceRecovery, claim.body.completionSource)
  const titlePrior = await verifyTitleRecovery(boundArgs, auth, plan, claim.body.titleRecovery, claim.body.completionSource, claim.body.referenceRecovery)
  const rlPrior = await verifyRlPersistenceRecovery(boundArgs, auth, plan, claim.body.rlPersistenceRecovery, claim.body, null, true)
  const recorded = await collectDownstream(args, claim)
  if (result) {
    h.assertEventPair(claim, result)
    need(equal(result.body.referenceRecovery || null, claim.body.referenceRecovery || null)
      && equal(result.body.rlPersistenceRecovery || null, claim.body.rlPersistenceRecovery || null)
      && equal(result.body.titleRecovery || null, claim.body.titleRecovery || null) && equal(result.body.completionSource, claim.body.completionSource)
      && equal(recorded.stageRefs, result.body.stageRefs) && equal(recorded.grrRefs, result.body.grrRefs), 'COMPLETION_RESULT_CHANGED')
  }
  return { ...source, sourceRun: source.run, completionSource: claim.body.completionSource,
    ...(prior ? { referenceRecovery: claim.body.referenceRecovery, priorRuns: [...(source.priorRuns || []), {
      status: prior.result.body.status, claimEventId: prior.claim.eventId, claimBodyHash: prior.claim.bodyHash,
      resultEventId: prior.result.eventId, resultBodyHash: prior.result.bodyHash, failure: prior.result.body.failure }] } : {}),
    ...(titlePrior ? { titleRecovery: claim.body.titleRecovery, priorRuns: [...(source.priorRuns || []),
      ...[prior, titlePrior, rlPrior].filter(Boolean).map(item => ({ status: item.result.body.status, claimEventId: item.claim.eventId,
        claimBodyHash: item.claim.bodyHash, resultEventId: item.result.eventId, resultBodyHash: item.result.bodyHash, failure: item.result.body.failure }))] } : {}),
    stages: [...source.stages, ...recorded.stages], grr: [...source.grr, ...recorded.grr],
    run: { status: result?.body.status || 'UNKNOWN', claimEventId: claim.eventId, resultEventId: result?.eventId || null,
      stageRefs: [...source.run.stageRefs, ...recorded.stageRefs], grrRefs: [...source.run.grrRefs, ...recorded.grrRefs],
      failure: result?.body.failure || null, completionVersion: claim.body.version } }
}
export const completeIsolatedSyntheticOutcome = async args => {
  const parsed = isolatedSyntheticCompleteSchema.safeParse(args.payload)
  need(parsed.success, 'COMPLETION_REQUEST_INVALID', 422)
  args = { ...args, payload: parsed.data }
  if (args.payload.expressionRepair) return completeExpressionRepair(args)
  const mode = args.payload.rlPersistenceRecovery ? { version: RL_PERSISTENCE_VERSION, claim: 'COMPLETION_RL_PERSISTENCE_CLAIM', result: 'COMPLETION_RL_PERSISTENCE_RESULT' }
    : args.payload.titleRecovery ? { version: TITLE_VERSION, claim: 'COMPLETION_TITLE_CLAIM', result: 'COMPLETION_TITLE_RESULT' }
    : args.payload.referenceRecovery ? { version: REFERENCE_VERSION, claim: 'COMPLETION_REFERENCE_CLAIM', result: 'COMPLETION_REFERENCE_RESULT' }
    : { version: VERSION, claim: 'COMPLETION_CLAIM', result: 'COMPLETION_RESULT' }
  const expressionClaim = await h.eventRead('COMPLETION_EXPRESSION_REPAIR_CLAIM', args)
  if (expressionClaim) {
    const historicalClaim = await h.eventRead(mode.claim, args)
    need(historicalClaim?.payloadHash === membershipHash(args.payload)
      && historicalClaim.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, expressionClaim)
  }
  const deps = args.deps || {}, source = await (deps.readSourceRun || readIsolatedSyntheticOutcome)(args)
  const auth = await h.authorize(args), plan = await h.readPlan(args, auth)
  need(source.run?.status === 'ARL_PASSED', 'GENUINE_ARL_PASS_REQUIRED')
  await h.indexesReady(deps); await h.revisionIndexReady(deps, auth.basis.lineage.parentRuntimeInstanceId)
  await verifySource(args, auth, plan, source, args.payload.completionSource)
  await verifyReferenceRecovery(args, auth, plan, args.payload.referenceRecovery, args.payload.completionSource)
  const titleRecovery = await verifyTitleRecovery(args, auth, plan, args.payload.titleRecovery, args.payload.completionSource, args.payload.referenceRecovery)
  await verifyRlPersistenceRecovery(args, auth, plan, args.payload.rlPersistenceRecovery, args.payload, null, true)
  const payloadHash = membershipHash(args.payload)
  let created = false, claim
  try {
    claim = await h.transaction(deps, async session => {
      created = false
      const currentAuth = await h.authorize(args, session), currentPlan = await h.readPlan(args, currentAuth, session)
      await verifySource(args, currentAuth, currentPlan, source, args.payload.completionSource, session)
      await verifyReferenceRecovery(args, currentAuth, currentPlan, args.payload.referenceRecovery, args.payload.completionSource, session)
      const savedTitle = await verifyTitleRecovery(args, currentAuth, currentPlan, args.payload.titleRecovery, args.payload.completionSource, args.payload.referenceRecovery, session)
      const existing = await h.eventRead(mode.claim, args, session)
      if (existing) {
        need(existing.payloadHash === payloadHash && existing.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
        return existing
      }
      const savedRl = await verifyRlPersistenceRecovery(args, currentAuth, currentPlan, args.payload.rlPersistenceRecovery, args.payload, session)
      const existingStages = await h.query(h.model(deps, 'OutcomeQualityStageExecution', Stage).find({
        ...h.scope(args.runtimeInstanceId), requestId: plan.requestId, planId: plan.planId, stageKey: { $in: KEYS } }).limit(4), session)
      need(savedRl ? existingStages.length === 2
        && equal(existingStages.map(h.stageRef).sort((a, b) => a.stageKey.localeCompare(b.stageKey)), savedRl.result.body.stageRefs.slice().sort((a, b) => a.stageKey.localeCompare(b.stageKey)))
        : savedTitle ? existingStages.length === 1 && equal(h.stageRef(existingStages[0]), savedTitle.narrativeRef)
        : existingStages.length === 0, 'COMPLETION_EXISTING_STAGES')
      for (const [name, fallback] of [['GovernedReasoningExecution', Grr], ['GovernedRuntimeArtifact', Artifact]]) {
        need((await rows(args, name, fallback, { ...h.scope(args.runtimeInstanceId), outputTypeKey: 'RENDERED_EXPRESSION_RL' }, session)).length === (savedRl ? 1 : 0),
          'COMPLETION_EXISTING_PROVIDER')
      }
      const body = membershipJson({ version: mode.version, classification: currentAuth.classification, eventId: randomUUID(), phase: mode.claim,
        requestKey: args.payload.requestKey, payloadHash, actorUserId: String(args.actorUserId), createdAt: new Date().toISOString(),
        basis: currentAuth.basis, plan: planIdentity(currentPlan), requestBinding: h.binding(currentPlan), completionSource: args.payload.completionSource,
        ...(args.payload.referenceRecovery ? { referenceRecovery: args.payload.referenceRecovery } : {}),
        ...(args.payload.titleRecovery ? { titleRecovery: args.payload.titleRecovery } : {}),
        ...(args.payload.rlPersistenceRecovery ? { rlPersistenceRecovery: args.payload.rlPersistenceRecovery } : {}),
        claim: null, status: 'CLAIMED', stageRefs: [], grrRefs: [], failure: null })
      const saved = await h.writeEvent(body, args, session); created = true; return saved
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    claim = await h.eventRead(mode.claim, args)
    need(claim && claim.payloadHash === payloadHash && claim.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    created = false
  }
  if (!created) return readLatestIsolatedSyntheticOutcome(args)
  const fresh = async () => {
    const currentAuth = await h.authorize(args), currentPlan = await h.readPlan(args, currentAuth)
    await verifySource(args, currentAuth, currentPlan, source, claim.body.completionSource)
    await verifyReferenceRecovery(args, currentAuth, currentPlan, claim.body.referenceRecovery, claim.body.completionSource)
    await verifyTitleRecovery(args, currentAuth, currentPlan, claim.body.titleRecovery, claim.body.completionSource, claim.body.referenceRecovery)
    await verifyRlPersistenceRecovery(args, currentAuth, currentPlan, claim.body.rlPersistenceRecovery, claim.body)
    const current = await h.eventRead(mode.claim, args)
    need(current?.bodyHash === claim.bodyHash && !await h.eventRead(mode.result, args), 'COMPLETION_CLAIM_CHANGED')
    return currentAuth
  }
  const identity = { actorUserId: args.actorUserId, auditRequest: args.auditRequest, scopes: args.scopes,
    runtimeInstanceId: args.runtimeInstanceId, planRecordId: String(plan._id || plan.id), expectedPlanFingerprint: plan.planFingerprint,
    requestBinding: h.binding(plan), ...(titleRecovery ? { title: titleRecovery.title } : {}) }
  let status = 'UNKNOWN', failure = null
  try {
    if (claim.body.rlPersistenceRecovery) {
      const currentAuth = await fresh()
      const saved = await verifyRlPersistenceRecovery(args, currentAuth, plan, claim.body.rlPersistenceRecovery, claim.body)
      const stageDeps = deps.rlRecoveryDeps?.stageDeps || {}
      const audit = stageDeps.auditService || auditService
      const guardedStageDeps = { ...stageDeps, auditService: { ...audit, log: async (entry, options) => {
        const savedAudit = await audit.log(entry, options)
        const session = options?.session
        need(session, 'RL_PERSISTENCE_TRANSACTION_REQUIRED')
        const checkedAuth = await h.authorize(args, session), checkedPlan = await h.readPlan(args, checkedAuth, session)
        await verifySource(args, checkedAuth, checkedPlan, source, claim.body.completionSource, session)
        await verifyReferenceRecovery(args, checkedAuth, checkedPlan, claim.body.referenceRecovery, claim.body.completionSource, session)
        await verifyTitleRecovery(args, checkedAuth, checkedPlan, claim.body.titleRecovery, claim.body.completionSource, claim.body.referenceRecovery, session)
        await verifyRlPersistenceRecovery(args, checkedAuth, checkedPlan, claim.body.rlPersistenceRecovery, claim.body, session, true)
        need((await h.eventRead(mode.claim, args, session))?.bodyHash === claim.bodyHash
          && !await h.eventRead(mode.result, args, session), 'COMPLETION_CLAIM_CHANGED')
        return savedAudit
      } } }
      const persisted = await (deps.persistSavedRlFailure || persistSavedOutcomeRenderedExpressionRlFailure)({
        ...identity, ...saved.pair, source: saved.shaping, plan, runtime: currentAuth.runtime,
        classification: saved.classification, deps: { ...(deps.rlRecoveryDeps || {}), stageDeps: guardedStageDeps } })
      need(persisted?.execution?.status === 'FAILED', 'RL_PERSISTENCE_RESULT_UNCONFIRMED')
      status = 'FAILED'; failure = persisted.execution.failure
    } else {
    const owners = titleRecovery ? [deps.createShapedCandidate || createOutcomeShapedCandidate]
      : [deps.createNarrativePlan || createOutcomeNarrativePlan, deps.createShapedCandidate || createOutcomeShapedCandidate]
    for (const owner of owners) {
      await fresh()
      const result = await owner({ ...identity, deps: deps.qualityDeps || {} })
      need(result?.stage?.status === 'SUCCEEDED', 'COMPLETION_INTERNAL_STAGE_FAILED')
      await collectDownstream(args, claim)
    }
    await fresh()
    const runtime = args.providerRuntimeDeps || {}
    need(runtime.executionMode === 'LIVE_TEST' && typeof runtime.renderedExpressionRlProviderAdapterFactory === 'function'
      && runtime.providerDescriptor, 'RL_PROVIDER_NOT_CONFIGURED', 503)
    let providerDispatches = 0
    const createGrr = async input => {
      need(++providerDispatches === 1, 'RL_PROVIDER_ALREADY_DISPATCHED')
      return (deps.createGovernedReasoningExecution || createGovernedReasoningExecution)({ ...input, deps: { ...input.deps,
        authorizeRuntime: async selectedRuntime => {
          need(String(selectedRuntime._id || selectedRuntime.id) === args.runtimeInstanceId, 'GRR_SCOPE_INVALID')
          await fresh()
          return h.runClassification(claim)
        } } })
    }
    const reviewed = await (deps.executeRenderedExpressionRl || executeOutcomeRenderedExpressionRl)({ ...identity,
      providerDescriptor: runtime.providerDescriptor, providerAdapter: runtime.renderedExpressionRlProviderAdapterFactory(),
      deps: { ...(deps.rlDeps || {}), createGovernedReasoningExecution: createGrr } })
    if (reviewed?.stage?.status === 'FAILED') { status = 'FAILED'; failure = reviewed.stage.failure }
    else {
      need(reviewed?.stage?.status === 'SUCCEEDED', 'RL_RESULT_UNCONFIRMED')
      // Exercise the existing synthetic delivery prohibition. No render/model/asset is created.
      const deliveryAuth = await fresh()
      assertNoSyntheticRenderRecordInsertion({ runtimeInstanceId: args.runtimeInstanceId,
        renderReceipt: { source: { runtimeRevision: deliveryAuth.runtime.revision } } })
      need(false, 'SYNTHETIC_DELIVERY_GUARD_MISSING')
    }
    }
  } catch (error) {
    failure = h.failureDetails(error)
    status = error.code === 'SYNTHETIC_TEST_DELIVERY_HELD' ? 'BLOCKED' : 'UNKNOWN'
  }
  await h.transaction(deps, async session => {
    const currentAuth = await h.authorize(args, session), currentPlan = await h.readPlan(args, currentAuth, session)
    await verifySource(args, currentAuth, currentPlan, source, claim.body.completionSource, session)
    await verifyReferenceRecovery(args, currentAuth, currentPlan, claim.body.referenceRecovery, claim.body.completionSource, session)
    await verifyTitleRecovery(args, currentAuth, currentPlan, claim.body.titleRecovery, claim.body.completionSource, claim.body.referenceRecovery, session)
    await verifyRlPersistenceRecovery(args, currentAuth, currentPlan, claim.body.rlPersistenceRecovery, claim.body, session, true)
    const current = await h.eventRead(mode.claim, args, session)
    need(current?.bodyHash === claim.bodyHash && !await h.eventRead(mode.result, args, session), 'COMPLETION_RESULT_ALREADY_RECORDED')
    const recorded = await collectDownstream(args, claim, session)
    await h.writeEvent(membershipJson({ ...claim.body, eventId: randomUUID(), phase: mode.result, createdAt: new Date().toISOString(),
      claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status, stageRefs: recorded.stageRefs, grrRefs: recorded.grrRefs, failure }), args, session)
  })
  return readLatestIsolatedSyntheticOutcome(args)
}

// Expression repair keeps its original three-stage cohort and new two-stage cohort
// distinct. Historical collector rules are not relaxed to accept duplicate stages.
const verifyExpressionSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionRepair
  const claim = await h.eventRead('COMPLETION_RL_PERSISTENCE_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_RL_PERSISTENCE_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected && expected.expressionProfileVersion === OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION
    && claim.body.version === RL_PERSISTENCE_VERSION && result.body.version === RL_PERSISTENCE_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_SOURCE_CHANGED')
  await verifySource(args, auth, plan, source, links.completionSource, session)
  await verifyReferenceRecovery(args, auth, plan, links.referenceRecovery, links.completionSource, session)
  await verifyTitleRecovery(args, auth, plan, links.titleRecovery, links.completionSource, links.referenceRecovery, session)
  const originalIds = result.body.stageRefs.map(row => row.stageExecutionId)
  await verifyRlPersistenceRecovery(args, auth, plan, links.rlPersistenceRecovery, links, session, true, originalIds)
  const original = await collectDownstream(args, claim, session, originalIds)
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_SOURCE_MATERIAL_CHANGED')
  return { claim, result, original, originalIds }
}
const expressionMode = links => links.expressionPresentation
  ? { version: PRESENTATION_VERSION, claim: 'COMPLETION_EXPRESSION_PRESENTATION_CLAIM', result: 'COMPLETION_EXPRESSION_PRESENTATION_RESULT' }
  : links.expressionOverlay
  ? { version: OVERLAY_VERSION, claim: 'COMPLETION_EXPRESSION_OVERLAY_CLAIM', result: 'COMPLETION_EXPRESSION_OVERLAY_RESULT' }
  : links.expressionReadable
  ? { version: READABLE_VERSION, claim: 'COMPLETION_EXPRESSION_READABLE_CLAIM', result: 'COMPLETION_EXPRESSION_READABLE_RESULT' }
  : links.expressionContract
  ? { version: CONTRACT_VERSION, claim: 'COMPLETION_EXPRESSION_CONTRACT_CLAIM', result: 'COMPLETION_EXPRESSION_CONTRACT_RESULT' }
  : links.expressionFaithful
  ? { version: FAITHFUL_VERSION, claim: 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM', result: 'COMPLETION_EXPRESSION_FAITHFUL_RESULT' }
  : links.expressionFollowup
  ? { version: FOLLOWUP_VERSION, claim: 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', result: 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT' }
  : { version: EXPRESSION_VERSION, claim: 'COMPLETION_EXPRESSION_REPAIR_CLAIM', result: 'COMPLETION_EXPRESSION_REPAIR_RESULT' }
const verifyExpressionFollowupSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionFollowup, claim = await h.eventRead('COMPLETION_EXPRESSION_REPAIR_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_REPAIR_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION
    && claim.body.version === EXPRESSION_VERSION && result.body.version === EXPRESSION_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_FOLLOWUP_SOURCE_CHANGED')
  const foundation = await verifyExpressionSource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_FOLLOWUP_MATERIAL_CHANGED')
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.original.grrRefs, ...original.grrRefs] }
}
const verifyExpressionFaithfulSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionFaithful, claim = await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION
    && claim.body.version === FOLLOWUP_VERSION && result.body.version === FOLLOWUP_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', 'expressionFollowup'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_FAITHFUL_SOURCE_CHANGED')
  const foundation = await verifyExpressionFollowupSource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_FAITHFUL_MATERIAL_CHANGED')
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.historicalGrrRefs, ...original.grrRefs] }
}
const verifyExpressionContractSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionContract, claim = await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_COMMERCIAL_EXPRESSION_PROFILE_VERSION
    && claim.body.version === FAITHFUL_VERSION && result.body.version === FAITHFUL_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', 'expressionFollowup', 'expressionFaithful'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_CONTRACT_SOURCE_CHANGED')
  const foundation = await verifyExpressionFaithfulSource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_CONTRACT_MATERIAL_CHANGED')
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.historicalGrrRefs, ...original.grrRefs] }
}
const verifyExpressionReadableSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionReadable, claim = await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION
    && claim.body.version === CONTRACT_VERSION && result.body.version === CONTRACT_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', 'expressionFollowup', 'expressionFaithful', 'expressionContract'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_READABLE_SOURCE_CHANGED')
  const foundation = await verifyExpressionContractSource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_READABLE_MATERIAL_CHANGED')
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.historicalGrrRefs, ...original.grrRefs] }
}
const verifyExpressionOverlaySource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionOverlay, claim = await h.eventRead('COMPLETION_EXPRESSION_READABLE_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_READABLE_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_COMMERCIAL_GOVERNED_EXPRESSION_PROFILE_VERSION
    && claim.body.version === READABLE_VERSION && result.body.version === READABLE_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', 'expressionFollowup', 'expressionFaithful', 'expressionContract', 'expressionReadable'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_READABLE_SOURCE_CHANGED')
  const foundation = await verifyExpressionReadableSource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds, overlayParent: true })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_READABLE_MATERIAL_CHANGED')
  const contract = buildCommercialOutputContract({ plan })
  const style = plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'STYLE' && pack.packKey === contract.styleKey)
  const styleSource = await (args.deps?.loadPackContent || loadOutcomeKnowledgePackVersionContent)({
    packId: style.packId, versionId: style.versionId, session,
  })
  assertStyleOverlaySourceEligibility({ style: { ...style, status: style.lifecycleStatus },
    outputType: plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'OUTPUT_TYPE_DEFINITION' && pack.packKey === contract.outputTypeKey),
    schema: contract.packs.find(pack => pack.packType === 'OUTPUT_SCHEMA'),
    audienceKeys: plan.payload.resolution.request?.audienceKeys || [], format: 'MARKDOWN', loaded: styleSource })
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion, styleSource })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.historicalGrrRefs, ...original.grrRefs] }
}
const verifyExpressionPresentationSource = async (args, auth, plan, source, links, session = null) => {
  const expected = links.expressionPresentation, claim = await h.eventRead('COMPLETION_EXPRESSION_OVERLAY_CLAIM', args, session)
  const result = await h.eventRead('COMPLETION_EXPRESSION_OVERLAY_RESULT', args, session)
  h.assertEventPair(claim, result)
  need(expected?.expressionProfileVersion === OUTCOME_COMMERCIAL_DECISION_LED_EXPRESSION_PROFILE_VERSION
    && claim.body.version === OVERLAY_VERSION && result.body.version === OVERLAY_VERSION
    && expected.claimEventId === claim.eventId && expected.claimBodyHash === claim.bodyHash
    && expected.resultEventId === result.eventId && expected.resultBodyHash === result.bodyHash
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
    && result.body.stageRefs.length === 3 && result.body.stageRefs[0].status === 'SUCCEEDED'
    && result.body.stageRefs[1].status === 'SUCCEEDED' && result.body.stageRefs[2].status === 'FAILED'
    && result.body.grrRefs.length === 1 && result.body.grrRefs[0].stageLinkage === 'LINKED'
    && equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan))
    && ['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', 'expressionFollowup', 'expressionFaithful', 'expressionContract', 'expressionReadable', 'expressionOverlay'].every(key =>
      equal(claim.body[key], links[key]) && equal(result.body[key], links[key])), 'EXPRESSION_PRESENTATION_SOURCE_CHANGED')
  const foundation = await verifyExpressionOverlaySource(args, auth, plan, source, links, session)
  const originalIds = [...foundation.originalIds, ...result.body.stageRefs.slice(1).map(row => row.stageExecutionId)]
  const original = await collectExpressionRepair(args, claim, foundation, session, { stageIds: originalIds, presentationParent: true })
  need(equal(original.stageRefs, result.body.stageRefs) && equal(original.grrRefs, result.body.grrRefs)
    && [['narrative', 0], ['shaping', 1], ['failedRl', 2]].every(([name, index]) =>
      expected[name + 'StageExecutionId'] === original.stageRefs[index].stageExecutionId
      && expected[name + 'MaterialHash'] === original.stageRefs[index].materialHash)
    && ['executionId', 'runtimeArtifactId', 'executionHash', 'artifactHash'].every(key => expected[key] === original.grrRefs[0][key]),
  'EXPRESSION_PRESENTATION_MATERIAL_CHANGED')
  const contract = buildCommercialOutputContract({ plan })
  const style = plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'STYLE' && pack.packKey === contract.styleKey)
  const styleSource = await (args.deps?.loadPackContent || loadOutcomeKnowledgePackVersionContent)({
    packId: style.packId, versionId: style.versionId, session,
  })
  assertStyleOverlaySourceEligibility({ style: { ...style, status: style.lifecycleStatus },
    outputType: plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'OUTPUT_TYPE_DEFINITION' && pack.packKey === contract.outputTypeKey),
    schema: contract.packs.find(pack => pack.packType === 'OUTPUT_SCHEMA'),
    audienceKeys: plan.payload.resolution.request?.audienceKeys || [], format: 'MARKDOWN', loaded: styleSource })
  const preview = (args.deps?.buildShapedCandidateRevisionOutput || buildOutcomeShapedCandidateRevisionOutput)({ plan,
    narrativePlanStage: original.stages[0], priorCandidateStage: original.stages[1], failedRlStage: original.stages[2],
    rlArtifact: original.grr[0].artifact, title: original.stages[1].outputSnapshot?.title,
    expressionProfileVersion: expected.expressionProfileVersion, styleSource })
  need(hashOutcomeQualityStageValue(preview) === expected.reviewedOutputFingerprint, 'EXPRESSION_REVIEWED_OUTPUT_CHANGED')
  return { claim, result, original, originalIds, historicalGrrRefs: [...foundation.historicalGrrRefs, ...original.grrRefs] }
}
const collectExpressionRepair = async (args, claim, prior, session = null, historical = null) => {
  const presentation = Boolean(claim.body.expressionPresentation), overlay = Boolean(claim.body.expressionOverlay), readable = Boolean(claim.body.expressionReadable), contract = Boolean(claim.body.expressionContract), faithful = Boolean(claim.body.expressionFaithful), followup = Boolean(claim.body.expressionFollowup)
  const link = claim.body.expressionPresentation || claim.body.expressionOverlay || claim.body.expressionReadable || claim.body.expressionContract || claim.body.expressionFaithful || claim.body.expressionFollowup || claim.body.expressionRepair
  need(!historical || !presentation && new Set(historical.stageIds).size === historical.stageIds.length
    && (overlay ? historical.presentationParent === true && claim.body.version === OVERLAY_VERSION && historical.stageIds.length === 15
      : readable ? historical.overlayParent === true && claim.body.version === READABLE_VERSION && historical.stageIds.length === 13
        : contract ? claim.body.version === CONTRACT_VERSION && historical.stageIds.length === 11
          : faithful ? claim.body.version === FAITHFUL_VERSION && historical.stageIds.length === 9
            : followup ? claim.body.version === FOLLOWUP_VERSION && historical.stageIds.length === 7
              : claim.body.version === EXPRESSION_VERSION && historical.stageIds.length === 5), 'EXPRESSION_HISTORY_SCOPE_INVALID')
  const all = await h.query(h.model(args.deps || {}, 'OutcomeQualityStageExecution', Stage).find({
    ...h.scope(args.runtimeInstanceId), requestId: claim.body.plan.requestId, planId: claim.body.plan.planId,
    draftId: claim.body.requestBinding.draftId, draftIterationId: claim.body.requestBinding.draftIterationId,
    stageKey: { $in: KEYS }, ...(historical ? { stageExecutionId: { $in: historical.stageIds } } : {}) }).limit(presentation ? 18 : overlay ? 16 : readable ? 14 : contract ? 12 : faithful ? 10 : followup ? 8 : 6), session)
  need(all.length >= prior.originalIds.length && all.length <= prior.originalIds.length + 2 && new Set(all.map(row => row.stageExecutionId)).size === all.length
    && prior.originalIds.every(id => all.some(row => row.stageExecutionId === id)), 'EXPRESSION_STAGE_POPULATION_INVALID')
  const added = all.filter(row => !prior.originalIds.includes(row.stageExecutionId)).sort((a, b) => a.stageOrder - b.stageOrder)
  const stages = [prior.original.stages[0]], refs = [prior.original.stageRefs[0]]
  for (const [index, raw] of added.entries()) {
    const ref = h.stageRef(raw), recorded = await h.readRecordedStage(ref, args, claim.body.plan, session), stage = recorded.stage
    const original = prior.original.stages[index + 1]
    const source = index === 0 ? prior.original.stages[0] : stages[1]
    if ((presentation || overlay) && index === 0) need(hashOutcomeQualityStageValue(stage.outputSnapshot) === stage.outputFingerprint
      && stage.outputFingerprint === link.reviewedOutputFingerprint
      && stage.outputSnapshot?.styleValidationReceipt?.rlApproved === false,
    'EXPRESSION_OVERLAY_SAVED_OUTPUT_CHANGED')
    need(stage.stageKey === KEYS[index + 1] && stage.stageOrder === index + 5 && stage.attemptNumber === (presentation ? 8 : overlay ? 7 : readable ? 6 : contract ? 5 : faithful ? 4 : followup ? 3 : 2)
      && stage.predecessorStageExecutionId === original.stageExecutionId
      && stage.predecessorAttemptFingerprint === original.attemptFingerprint
      && stage.inputSnapshot?.sourceStage?.stageExecutionId === source.stageExecutionId
      && stage.inputSnapshot.sourceStage.attemptFingerprint === source.attemptFingerprint
      && stage.inputSnapshot.sourceStage.outputFingerprint === source.outputFingerprint
      && (index !== 0 || stage.status === 'SUCCEEDED' && stage.outputSnapshot?.revisionScope === 'EXPRESSION_ONLY'
        && stage.outputSnapshot.expressionProfileVersion === link.expressionProfileVersion
        && (!followup || stage.outputFingerprint === link.reviewedOutputFingerprint)
        && stage.outputSnapshot.remediationSourceStageExecutionId === prior.original.stages[2].stageExecutionId
        && stage.outputSnapshot.remediationSourceAttemptFingerprint === prior.original.stages[2].attemptFingerprint),
    'EXPRESSION_STAGE_LINEAGE_INVALID')
    assertOutcomeQualityStageRetryLineage({ candidate: stage, latest: original, source,
      remediation: index === 0 ? prior.original.stages[2] : null })
    h.assertReturnedStage(stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
    await h.verifyRecordedStageAudit(recorded.raw, args, session)
    stages.push(stage); refs.push(ref)
  }
  const provider = await collectDownstreamProvider(args, claim, refs, session)
  need(!provider.grrRefs.length || refs.length >= 2, 'EXPRESSION_PROVIDER_WITHOUT_SHAPING')
  for (const [name, fallback, idKey] of [['GovernedReasoningExecution', Grr, 'executionId'], ['GovernedRuntimeArtifact', Artifact, 'runtimeArtifactId']]) {
    const expectedIds = [...(prior.historicalGrrRefs || prior.original.grrRefs), ...provider.grrRefs].map(row => row[idKey]).sort()
    const allReceipts = await h.query(h.model(args.deps || {}, name, fallback).find({ ...h.scope(args.runtimeInstanceId), outputTypeKey: 'RENDERED_EXPRESSION_RL',
      ...(historical ? { [idKey]: { $in: expectedIds } } : {}) }).limit(presentation ? 9 : overlay ? 8 : readable ? 7 : contract ? 6 : faithful ? 5 : followup ? 4 : 3), session)
    need(equal(allReceipts.map(row => row[idKey]).sort(), expectedIds), 'EXPRESSION_PROVIDER_POPULATION_INVALID')
  }
  return { stages, stageRefs: refs, ...provider }
}
const expressionContext = async (args, links, source, session = null) => {
  const auth = await h.authorize(args, session), plan = await h.readPlan(args, auth, session)
  const prior = links.expressionPresentation ? await verifyExpressionPresentationSource(args, auth, plan, source, links, session)
    : links.expressionOverlay ? await verifyExpressionOverlaySource(args, auth, plan, source, links, session)
    : links.expressionReadable ? await verifyExpressionReadableSource(args, auth, plan, source, links, session)
    : links.expressionContract ? await verifyExpressionContractSource(args, auth, plan, source, links, session)
    : links.expressionFaithful ? await verifyExpressionFaithfulSource(args, auth, plan, source, links, session)
    : links.expressionFollowup ? await verifyExpressionFollowupSource(args, auth, plan, source, links, session)
    : await verifyExpressionSource(args, auth, plan, source, links, session)
  return { auth, plan, prior }
}
const readExpressionRepair = async (args, claim) => {
  const presentationClaim = !claim.body.expressionPresentation && await h.eventRead('COMPLETION_EXPRESSION_PRESENTATION_CLAIM', args)
  if (presentationClaim) return readExpressionRepair(args, presentationClaim)
  const overlayClaim = !claim.body.expressionOverlay && await h.eventRead('COMPLETION_EXPRESSION_OVERLAY_CLAIM', args)
  if (overlayClaim) return readExpressionRepair(args, overlayClaim)
  const readableClaim = !claim.body.expressionReadable && await h.eventRead('COMPLETION_EXPRESSION_READABLE_CLAIM', args)
  if (readableClaim) return readExpressionRepair(args, readableClaim)
  const contractClaim = !claim.body.expressionContract && await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_CLAIM', args)
  if (contractClaim) return readExpressionRepair(args, contractClaim)
  const faithfulClaim = !claim.body.expressionFaithful && await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_CLAIM', args)
  if (faithfulClaim) return readExpressionRepair(args, faithfulClaim)
  const followupClaim = !claim.body.expressionFollowup && await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', args)
  if (followupClaim) return readExpressionRepair(args, followupClaim)
  const mode = expressionMode(claim.body)
  const source = await (args.deps?.readSourceRun || readIsolatedSyntheticOutcome)(args)
  const bound = { ...args, payload: { requestId: claim.body.plan.requestId, planId: claim.body.plan.planId,
    expectedPlanFingerprint: claim.body.plan.planFingerprint } }
  const { auth, plan, prior } = await expressionContext(bound, claim.body, source)
  need(equal(claim.body.basis, auth.basis) && equal(claim.body.plan, planIdentity(plan))
    && equal(claim.body.requestBinding, h.binding(plan)), 'EXPRESSION_BASIS_CHANGED')
  const recorded = await collectExpressionRepair(args, claim, prior)
  const result = await h.eventRead(mode.result, args)
  if (result) {
    h.assertEventPair(claim, result)
    need(['completionSource', 'referenceRecovery', 'titleRecovery', 'rlPersistenceRecovery', 'expressionRepair', ...(claim.body.expressionFollowup ? ['expressionFollowup'] : []), ...(claim.body.expressionFaithful ? ['expressionFaithful'] : []), ...(claim.body.expressionContract ? ['expressionContract'] : []), ...(claim.body.expressionReadable ? ['expressionReadable'] : []), ...(claim.body.expressionOverlay ? ['expressionOverlay'] : []), ...(claim.body.expressionPresentation ? ['expressionPresentation'] : [])].every(key =>
      equal(claim.body[key], result.body[key])) && equal(recorded.stageRefs, result.body.stageRefs)
      && equal(recorded.grrRefs, result.body.grrRefs), 'EXPRESSION_RESULT_CHANGED')
  }
  const history = []
  for (const prefix of ['COMPLETION', 'COMPLETION_REFERENCE', 'COMPLETION_TITLE', 'COMPLETION_RL_PERSISTENCE', ...(claim.body.expressionFollowup ? ['COMPLETION_EXPRESSION_REPAIR'] : []), ...(claim.body.expressionFaithful ? ['COMPLETION_EXPRESSION_FOLLOWUP'] : []), ...(claim.body.expressionContract ? ['COMPLETION_EXPRESSION_FAITHFUL'] : []), ...(claim.body.expressionReadable ? ['COMPLETION_EXPRESSION_CONTRACT'] : []), ...(claim.body.expressionOverlay ? ['COMPLETION_EXPRESSION_READABLE'] : []), ...(claim.body.expressionPresentation ? ['COMPLETION_EXPRESSION_OVERLAY'] : [])]) {
    const historicalClaim = await h.eventRead(prefix + '_CLAIM', args), historicalResult = await h.eventRead(prefix + '_RESULT', args)
    h.assertEventPair(historicalClaim, historicalResult)
    history.push({ status: historicalResult.body.status, claimEventId: historicalClaim.eventId, claimBodyHash: historicalClaim.bodyHash,
      resultEventId: historicalResult.eventId, resultBodyHash: historicalResult.bodyHash, stageRefs: historicalResult.body.stageRefs,
      grrRefs: historicalResult.body.grrRefs, failure: historicalResult.body.failure })
  }
  return { ...source, sourceRun: source.run, completionSource: claim.body.completionSource,
    expressionRepair: claim.body.expressionRepair, ...(claim.body.expressionFollowup ? { expressionFollowup: claim.body.expressionFollowup } : {}),
    ...(claim.body.expressionFaithful ? { expressionFaithful: claim.body.expressionFaithful } : {}),
    ...(claim.body.expressionContract ? { expressionContract: claim.body.expressionContract } : {}),
    ...(claim.body.expressionReadable ? { expressionReadable: claim.body.expressionReadable } : {}),
    ...(claim.body.expressionOverlay ? { expressionOverlay: claim.body.expressionOverlay } : {}),
    ...(claim.body.expressionPresentation ? { expressionPresentation: claim.body.expressionPresentation } : {}), priorRuns: [...(source.priorRuns || []), ...history],
    stages: [...source.stages, ...recorded.stages], grr: [...source.grr, ...recorded.grr],
    run: { status: result?.body.status || 'UNKNOWN', claimEventId: claim.eventId, resultEventId: result?.eventId || null,
      stageRefs: [...source.run.stageRefs, ...recorded.stageRefs], grrRefs: [...source.run.grrRefs, ...recorded.grrRefs],
      failure: result?.body.failure || null, completionVersion: claim.body.version } }
}
const completeExpressionRepair = async args => {
  const presentation = !args.payload.expressionPresentation && await h.eventRead('COMPLETION_EXPRESSION_PRESENTATION_CLAIM', args)
  if (presentation) {
    const historical = await h.eventRead(expressionMode(args.payload).claim, args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, presentation)
  }
  const overlay = !args.payload.expressionOverlay && await h.eventRead('COMPLETION_EXPRESSION_OVERLAY_CLAIM', args)
  if (overlay) {
    const historical = await h.eventRead(expressionMode(args.payload).claim, args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, overlay)
  }
  const readable = !args.payload.expressionReadable && await h.eventRead('COMPLETION_EXPRESSION_READABLE_CLAIM', args)
  if (readable) {
    const historical = await h.eventRead(expressionMode(args.payload).claim, args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, readable)
  }
  const latest = !args.payload.expressionContract && await h.eventRead('COMPLETION_EXPRESSION_CONTRACT_CLAIM', args)
  if (latest) {
    const historical = await h.eventRead(expressionMode(args.payload).claim, args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, latest)
  }
  const newest = !args.payload.expressionFaithful && await h.eventRead('COMPLETION_EXPRESSION_FAITHFUL_CLAIM', args)
  if (newest) {
    const historical = await h.eventRead(expressionMode(args.payload).claim, args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, newest)
  }
  const newer = !args.payload.expressionFollowup && await h.eventRead('COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', args)
  if (newer) {
    const historical = await h.eventRead('COMPLETION_EXPRESSION_REPAIR_CLAIM', args)
    need(historical?.payloadHash === membershipHash(args.payload) && historical.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    return readExpressionRepair(args, newer)
  }
  const deps = args.deps || {}, source = await (deps.readSourceRun || readIsolatedSyntheticOutcome)(args)
  need(source.run?.status === 'ARL_PASSED', 'GENUINE_ARL_PASS_REQUIRED')
  const { auth, plan, prior } = await expressionContext(args, args.payload, source)
  await h.indexesReady(deps); await h.revisionIndexReady(deps, auth.basis.lineage.parentRuntimeInstanceId)
  const payloadHash = membershipHash(args.payload), mode = expressionMode(args.payload)
  let claim, created = false
  try {
    claim = await h.transaction(deps, async session => {
      created = false
      const checked = await expressionContext(args, args.payload, source, session)
      const existing = await h.eventRead(mode.claim, args, session)
      if (existing) {
        need(existing.payloadHash === payloadHash && existing.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
        return existing
      }
      const draftClaim = { eventId: '', body: { plan: planIdentity(plan), requestBinding: h.binding(plan), expressionRepair: args.payload.expressionRepair, ...(args.payload.expressionFollowup ? { expressionFollowup: args.payload.expressionFollowup } : {}),
        ...(args.payload.expressionFaithful ? { expressionFaithful: args.payload.expressionFaithful } : {}),
        ...(args.payload.expressionContract ? { expressionContract: args.payload.expressionContract } : {}),
        ...(args.payload.expressionReadable ? { expressionReadable: args.payload.expressionReadable } : {}),
        ...(args.payload.expressionOverlay ? { expressionOverlay: args.payload.expressionOverlay } : {}),
        ...(args.payload.expressionPresentation ? { expressionPresentation: args.payload.expressionPresentation } : {}) } }
      const current = await collectExpressionRepair(args, draftClaim, checked.prior, session)
      need(current.stageRefs.length === 1 && current.grrRefs.length === 0, 'EXPRESSION_ALREADY_STARTED')
      const body = membershipJson({ version: mode.version, classification: checked.auth.classification, eventId: randomUUID(), phase: mode.claim,
        requestKey: args.payload.requestKey, payloadHash, actorUserId: String(args.actorUserId), createdAt: new Date().toISOString(),
        basis: checked.auth.basis, plan: planIdentity(checked.plan), requestBinding: h.binding(checked.plan),
        completionSource: args.payload.completionSource, referenceRecovery: args.payload.referenceRecovery,
        titleRecovery: args.payload.titleRecovery, rlPersistenceRecovery: args.payload.rlPersistenceRecovery, expressionRepair: args.payload.expressionRepair,
        ...(args.payload.expressionFollowup ? { expressionFollowup: args.payload.expressionFollowup } : {}),
        ...(args.payload.expressionFaithful ? { expressionFaithful: args.payload.expressionFaithful } : {}),
        ...(args.payload.expressionContract ? { expressionContract: args.payload.expressionContract } : {}),
        ...(args.payload.expressionReadable ? { expressionReadable: args.payload.expressionReadable } : {}),
        ...(args.payload.expressionOverlay ? { expressionOverlay: args.payload.expressionOverlay } : {}),
        ...(args.payload.expressionPresentation ? { expressionPresentation: args.payload.expressionPresentation } : {}),
        claim: null, status: 'CLAIMED', stageRefs: [], grrRefs: [], failure: null })
      const saved = await h.writeEvent(body, args, session); created = true; return saved
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    claim = await h.eventRead(mode.claim, args)
    need(claim && claim.payloadHash === payloadHash && claim.requestKey === args.payload.requestKey, 'COMPLETION_ALREADY_CLAIMED')
    created = false
  }
  if (!created) return readExpressionRepair(args, claim)
  const fresh = async (session = null) => {
    const checked = await expressionContext(args, claim.body, source, session)
    need((await h.eventRead(mode.claim, args, session))?.bodyHash === claim.bodyHash
      && !await h.eventRead(mode.result, args, session), 'COMPLETION_CLAIM_CHANGED')
    await collectExpressionRepair(args, claim, checked.prior, session)
    return checked
  }
  const guardedStageDeps = (selected = {}) => {
    const audit = selected.auditService || auditService
    return { ...selected, auditService: { ...audit, log: async (entry, options) => {
      const saved = await audit.log(entry, options)
      need(options?.session, 'EXPRESSION_TRANSACTION_REQUIRED'); await fresh(options.session)
      return saved
    } } }
  }
  const identity = { actorUserId: args.actorUserId, auditRequest: args.auditRequest, scopes: args.scopes,
    runtimeInstanceId: args.runtimeInstanceId, planRecordId: String(plan._id || plan.id), expectedPlanFingerprint: plan.planFingerprint,
    requestBinding: h.binding(plan) }
  let status = 'UNKNOWN', failure = null
  try {
    await fresh()
    const qualityDeps = deps.expressionQualityDeps || deps.qualityDeps || {}
    const shaped = await (deps.createShapedCandidateRevision || createOutcomeShapedCandidateRevision)({ ...identity,
      expressionProfileVersion: (claim.body.expressionPresentation || claim.body.expressionOverlay || claim.body.expressionReadable || claim.body.expressionContract || claim.body.expressionFaithful || claim.body.expressionFollowup || claim.body.expressionRepair).expressionProfileVersion,
      title: prior.original.stages[1].outputSnapshot?.title,
      deps: { ...qualityDeps, stageDeps: guardedStageDeps(qualityDeps.stageDeps) } })
    need(shaped?.stage?.status === 'SUCCEEDED', 'EXPRESSION_SHAPING_UNCONFIRMED')
    await fresh()
    const runtime = args.providerRuntimeDeps || {}
    need(runtime.executionMode === 'LIVE_TEST' && typeof runtime.renderedExpressionRlProviderAdapterFactory === 'function'
      && runtime.providerDescriptor, 'RL_PROVIDER_NOT_CONFIGURED', 503)
    let dispatches = 0
    const createGrr = async input => {
      need(++dispatches === 1, 'RL_PROVIDER_ALREADY_DISPATCHED')
      return (deps.createGovernedReasoningExecution || createGovernedReasoningExecution)({ ...input, deps: { ...input.deps,
        authorizeRuntime: async selectedRuntime => {
          need(String(selectedRuntime._id || selectedRuntime.id) === args.runtimeInstanceId, 'GRR_SCOPE_INVALID')
          await fresh(); return h.runClassification(claim)
        } } })
    }
    const rlDeps = deps.rlDeps || {}
    const reviewed = await (deps.executeRenderedExpressionRl || executeOutcomeRenderedExpressionRl)({ ...identity,
      providerDescriptor: runtime.providerDescriptor, providerAdapter: runtime.renderedExpressionRlProviderAdapterFactory(),
      deps: { ...rlDeps, createGovernedReasoningExecution: createGrr, stageDeps: guardedStageDeps(rlDeps.stageDeps),
        postArlDeps: { ...(rlDeps.postArlDeps || {}), stageDeps: guardedStageDeps(rlDeps.postArlDeps?.stageDeps) } } })
    if (reviewed?.stage?.status === 'FAILED') {
      failure = reviewed.stage.failure
      status = failure?.failureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        && reviewed.stage.executionIdentity?.grrExecutionId && reviewed.stage.executionIdentity?.grrRuntimeArtifactId ? 'FAILED' : 'UNKNOWN'
    }
    else {
      need(reviewed?.stage?.status === 'SUCCEEDED', 'RL_RESULT_UNCONFIRMED')
      const checked = await fresh()
      assertNoSyntheticRenderRecordInsertion({ runtimeInstanceId: args.runtimeInstanceId,
        renderReceipt: { source: { runtimeRevision: checked.auth.runtime.revision } } })
      need(false, 'SYNTHETIC_DELIVERY_GUARD_MISSING')
    }
  } catch (error) {
    failure = h.failureDetails(error); status = error.code === 'SYNTHETIC_TEST_DELIVERY_HELD' ? 'BLOCKED' : 'UNKNOWN'
  }
  await h.transaction(deps, async session => {
    const checked = await fresh(session), recorded = await collectExpressionRepair(args, claim, checked.prior, session)
    await h.writeEvent(membershipJson({ ...claim.body, eventId: randomUUID(), phase: mode.result, createdAt: new Date().toISOString(),
      claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status, stageRefs: recorded.stageRefs, grrRefs: recorded.grrRefs, failure }), args, session)
  })
  return readExpressionRepair(args, claim)
}
