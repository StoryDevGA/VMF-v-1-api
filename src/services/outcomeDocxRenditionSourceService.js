import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'
import { readLatestIsolatedSyntheticOutcome } from './isolatedSyntheticOutcomeCompletionService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { projectOutcomeRequestSelectedPack } from './outcomeAudienceRequestResolutionService.js'

export const OUTCOME_DOCX_RENDITION_SOURCE_VERSION = 'outcome-docx-governed-source.v1'
const sequence = OUTCOME_QUALITY_STAGE_SEQUENCE.slice(0, 6)
const id = value => String(value ?? '')
const clone = value => JSON.parse(JSON.stringify(value))
const equal = (left, right) => membershipHash(left) === membershipHash(right)
const fail = reason => { throw Object.assign(new Error('The read-only Word-document source is unavailable.'), {
  status: 409, code: 'OUTCOME_DOCX_SOURCE_BLOCKED', details: { reason, contentIncludedInError: false },
}) }

// A separate read projection, never an executor or source of write authority.
// Test seams are server-only; controllers accept no client dependency overrides.
export const readOutcomeDocxRenditionSource = async ({ actorUserId, runtimeInstanceId, scopes, deps = {} } = {}) => {
  const native = await (deps.readSourceRun || readLatestIsolatedSyntheticOutcome)({ actorUserId, runtimeInstanceId, scopes })
  if (!native || native.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION || native.authoritative !== false
    || native.normalOutputAvailable !== false || native.authorisesApproval !== false
    || native.scope?.classification !== native.classification || native.scope?.authoritative !== false
    || native.scope?.runtimeInstanceId !== runtimeInstanceId) fail('SOURCE_CLASSIFICATION_OR_SCOPE_INVALID')
  if (['customerId', 'tenantId'].some(key => !native.scope[key])) fail('SOURCE_SCOPE_MISSING')
  if ((scopes?.customer?._id && id(scopes.customer._id) !== native.scope.customerId)
    || (scopes?.tenant?._id && id(scopes.tenant._id) !== native.scope.tenantId)) fail('SOURCE_SELECTED_SCOPE_MISMATCH')
  if (!native.basis?.snapshotId || !native.basis.membershipHash || !native.basis.lockSnapshotHash
    || !native.basis.basisStateVersion || !native.run?.claimEventId || !native.run.resultEventId) fail('SOURCE_BASIS_OR_JOURNAL_MISSING')
  const stages = native.stages, refs = native.run.stageRefs
  if (!Array.isArray(stages) || stages.length !== sequence.length || !Array.isArray(refs) || refs.length !== sequence.length
    || new Set(stages.map(stage => stage.stageExecutionId)).size !== sequence.length) fail('SOURCE_STAGE_POPULATION_INVALID')
  const first = stages[0]
  const identityKeys = ['requestId', 'planId', 'planFingerprint', 'draftId', 'draftIterationId']
  if (identityKeys.some(key => !first[key])) fail('SOURCE_IDENTITY_MISSING')
  for (const [index, stage] of stages.entries()) {
    const ref = refs[index]
    if (stage.stageKey !== sequence[index] || stage.stageOrder !== index + 1
      || (index < 5 && stage.status !== 'SUCCEEDED')
      || !['SUCCEEDED', 'FAILED', 'BLOCKED'].includes(stage.status)
      || identityKeys.some(key => stage[key] !== first[key])
      || ['customerId', 'tenantId', 'runtimeInstanceId'].some(key => id(stage[key]) !== native.scope[key])
      || !ref || ref.stageExecutionId !== stage.stageExecutionId || ref.stageKey !== stage.stageKey
      || ref.status !== stage.status || ref.materialHash !== membershipHash(stage)
      || ['inputFingerprint', 'outputFingerprint', 'attemptFingerprint'].some(key => (ref[key] || '') !== (stage[key] || ''))
      || hashOutcomeQualityStageValue(stage.inputSnapshot) !== stage.inputFingerprint
      || (stage.status === 'SUCCEEDED' && hashOutcomeQualityStageValue(stage.outputSnapshot) !== stage.outputFingerprint)) {
      fail('SOURCE_STAGE_BINDING_CHANGED')
    }
    // The native reader validates raw stored models, signed audits and journal
    // bindings before serialization. Rehydrating this public projection would
    // apply model defaults to a different shape and is not equivalent proof.
  }
  const workingDraft = stages[1], arl = stages[2], narrative = stages[3], shaping = stages[4], review = stages[5]
  const approved = arl.outputSnapshot?.approvedMeaning
  if (approved?.state !== 'APPROVED' || approved.workingDraftStageExecutionId !== workingDraft.stageExecutionId
    || approved.workingDraftOutputFingerprint !== workingDraft.outputFingerprint
    || arl.outputSnapshot.workingDraftStageExecutionId !== workingDraft.stageExecutionId
    || arl.outputSnapshot.workingDraftOutputFingerprint !== workingDraft.outputFingerprint) fail('SOURCE_MEANING_NOT_APPROVED')
  for (const [stage, predecessor] of [[arl, workingDraft], [narrative, arl], [shaping, narrative], [review, shaping]]) {
    const source = stage.inputSnapshot?.sourceStage
    if (source?.stageExecutionId !== predecessor.stageExecutionId || source.outputFingerprint !== predecessor.outputFingerprint
      || source.attemptFingerprint !== predecessor.attemptFingerprint) fail('SOURCE_PREDECESSOR_CHANGED')
  }
  const filter = { planId: first.planId, requestId: first.requestId,
    tenantId: native.scope.tenantId, customerId: native.scope.customerId, runtimeInstanceId,
    _id: first.knowledgeCompositionPlanRecordId }
  const plan = await (deps.loadPlan || (query => Plan.findOne(query).lean()))(filter)
  try { (deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan) } catch { fail('SOURCE_PLAN_INVALID') }
  if (!plan || id(plan._id || plan.id) !== id(first.knowledgeCompositionPlanRecordId)
    || ['planId', 'requestId', 'planFingerprint', 'planVersion', 'resolutionFingerprint', 'contextFingerprint'].some(key => plan[key] !== first[key])
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => id(plan[key]) !== native.scope[key])) fail('SOURCE_PLAN_CHANGED')
  const selected = plan.payload?.resolution?.selectedPacks
  const packs = {}
  for (const layer of ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']) {
    const matches = Array.isArray(selected) ? selected.filter(pack => pack.knowledgeLayer === layer) : []
    if (matches.length !== 1) fail('SOURCE_PACK_SELECTION_INCOMPLETE')
    const pack = projectOutcomeRequestSelectedPack(matches[0])
    if (!pack.packId || !pack.packKey || !pack.capabilityKey || !pack.versionId || !pack.semanticVersion
      || !pack.activationId || !/^sha256:[a-f0-9]{64}$/.test(pack.contentHash)) fail('SOURCE_PACK_RECEIPT_INCOMPLETE')
    packs[layer] = pack
  }
  const source = {
    kind: 'GOVERNED_STAGE_CHAIN', scope: clone(native.scope), basis: clone(native.basis),
    plan: { recordId: id(plan._id || plan.id), planId: plan.planId, requestId: plan.requestId, planFingerprint: plan.planFingerprint,
      resolutionFingerprint: plan.resolutionFingerprint, contextFingerprint: plan.contextFingerprint },
    // These are stage-carried identities, not claims that draft rows exist.
    logicalDraft: { draftId: first.draftId, draftIterationId: first.draftIterationId },
    stageRefs: clone(refs), selectedPacks: packs,
    journal: { claimEventId: native.run.claimEventId, resultEventId: native.run.resultEventId,
      sourceRun: clone(native.sourceRun || null), completionSource: clone(native.completionSource || null) },
    reviewState: { status: native.run.status, stageStatus: review.status, failure: clone(native.run.failure || null) },
    priorRuns: clone(native.priorRuns || []),
    content: { workingDraft: clone(workingDraft.outputSnapshot), approvedMeaning: clone(approved),
      narrative: clone(narrative.outputSnapshot), shaping: clone(shaping.outputSnapshot) },
  }
  return {
    contractVersion: OUTCOME_DOCX_RENDITION_SOURCE_VERSION, sourceAdmission: 'VERIFIED_READ_ONLY_CHAIN',
    classification: native.classification, authoritative: false, normalOutputAvailable: false, authorisesApproval: false,
    renderingAvailable: false, finalisationAvailable: false, deliveryAvailable: false,
    currentness: 'READ_BOUNDARY_ONLY_REVERIFY_BEFORE_WRITE',
    source, sourceFingerprint: membershipHash(source),
  }
}
