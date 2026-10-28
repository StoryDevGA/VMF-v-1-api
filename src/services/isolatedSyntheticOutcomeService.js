import { AUTHORISED_ARL_APPROVAL, assertAuthorisedArlRequest, assertStoredAuthorisedArlReview } from './outcomeArlTransportRecoveryService.js'
import { withSyntheticOutcomeTransactionReads, invalidateSyntheticOutcomeTransactionReads, readSyntheticOutcomeQuery } from './syntheticOutcomeTransactionReads.js'
import { isOutcomeArlTransportRecovery } from './outcomeArlTransportRecoveryService.js'
import { OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION } from '../constants/outcomeGovernedQuality.js'
import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Event, { assertSyntheticOutcomeRunEvent, SYNTHETIC_OUTCOME_CLASSIFICATION as CLASS, SYNTHETIC_OUTCOME_RUN_VERSION as VERSION,
  SYNTHETIC_OUTCOME_RUN_REVISION_VERSION as REVISION_VERSION,
  SYNTHETIC_OUTCOME_RUN_SUCCESSOR_VERSION as SUCCESSOR_VERSION,
  SYNTHETIC_OUTCOME_RUN_CONTINUATION_VERSION as CONTINUATION_VERSION,
  SYNTHETIC_OUTCOME_RUN_RECOVERY_VERSION as RECOVERY_VERSION, SYNTHETIC_OUTCOME_RUN_DRAFT_RETRY_VERSION as DRAFT_RETRY_VERSION, SYNTHETIC_OUTCOME_RUN_DRAFT_REPAIR_VERSION as DRAFT_REPAIR_VERSION, SYNTHETIC_OUTCOME_RUN_HANDOFF_VERSION as HANDOFF_VERSION,
  SYNTHETIC_OUTCOME_RUN_COMPOSITION_VERSION as COMPOSITION_VERSION,
  SYNTHETIC_OUTCOME_RUN_TRANSPORT_VERSION as TRANSPORT_VERSION,
  SYNTHETIC_OUTCOME_RUN_LABEL_VERSION as LABEL_VERSION,
  SYNTHETIC_OUTCOME_RUN_WORDING_VERSION as WORDING_VERSION,
  SYNTHETIC_OUTCOME_RUN_AUTHORISED_REVIEW_VERSION as AUTHORISED_REVIEW_VERSION,
  SYNTHETIC_OUTCOME_RUN_DESCRIPTIVE_VERSION as DESCRIPTIVE_VERSION,
  SYNTHETIC_OUTCOME_RUN_HOLISTIC_VERSION as HOLISTIC_VERSION,
  SYNTHETIC_OUTCOME_RUN_REFERENCE_VERSION as REFERENCE_VERSION,
  SYNTHETIC_OUTCOME_RUN_SCOPING_VERSION as SCOPING_VERSION,
  SYNTHETIC_OUTCOME_RUN_METADATA_VERSION as METADATA_VERSION,
  SYNTHETIC_OUTCOME_RUN_ATTRIBUTION_VERSION as ATTRIBUTION_VERSION,
  SYNTHETIC_OUTCOME_RUN_DRAFT_PERSISTENCE_VERSION as DRAFT_PERSISTENCE_VERSION } from '../models/SyntheticOutcomeRunEvent.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { SNAPSHOT_RECOVERY_POLICY as p } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Grr from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { loadPublishedRecoveryRuntime } from './publishedDispositionRecoveryService.js'
import { readVerifiedRuntimeEvidenceSnapshot } from './runtimeEvidenceSnapshotService.js'
import { EVIDENCE_SNAPSHOT_INTERNAL_READ, membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { buildDirectSyntheticRevisionLineage, buildSuccessorSyntheticRevisionLineage,
  SYNTHETIC_SUCCESSOR_IDENTITY as successor } from './syntheticOutcomeIsolationService.js'
import { getRuntimeOutcomePlanningEvidence } from './runtimeStateRepository.js'
import { OUTCOME_PLANNING_EVIDENCE_VERSIONS } from './outcomeFrameworkHandoffService.js'
import { planOutcomeStudioRequest, confirmOutcomeStudioRequestPlan } from './outcomeStudioRequestPlanService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity, assertOutcomeKnowledgeCompositionPlanMatchesRuntime } from './outcomeKnowledgeCompositionPlanService.js'
import { executeOutcomeFrameworkGuidance } from './outcomeFrameworkGuidanceExecutionService.js'
import { executeOutcomeWorkingDraft } from './outcomeWorkingDraftExecutionService.js'
import { approveOutcomeWorkingDraftMeaning } from './outcomeArlMeaningReviewService.js'
import { serializeOutcomeQualityStageExecution } from './outcomeQualityStageExecutionService.js'
import { createGovernedReasoningExecution } from './governedReasoningRuntimeService.js'
import { isolatedSyntheticExecuteSchema } from '../validators/isolatedSyntheticOutcome.validator.js'

const fail = (reason, status = 409) => { throw Object.assign(new Error('The isolated synthetic test cannot continue.'), {
  code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', status, details: { reason },
}) }
const need = (value, reason, status) => { if (!value) fail(reason, status) }
const oid = value => new mongoose.Types.ObjectId(value)
const scope = runtimeInstanceId => ({ customerId: oid(p.customerId), tenantId: oid(p.tenantId), runtimeInstanceId: oid(runtimeInstanceId) })
const classification = runtimeInstanceId => ({ classification: CLASS, customerId: p.customerId, tenantId: p.tenantId,
  runtimeInstanceId, authoritative: false })
const envelope = data => ({ ...data, classification: CLASS, authoritative: false, normalOutputAvailable: false, authorisesApproval: false })
const query = async (value, session = null, readBudget = null) => {
  const budget = readBudget ? readBudget() : null
  if (session && value?.session) value = value.session(session)
  if (budget && value?.setOptions) value = value.setOptions(budget)
  if (value?.maxTimeMS) value = value.maxTimeMS(budget ? Math.min(3000, budget.maxTimeMS) : 3000)
  return readSyntheticOutcomeQuery(value, session)
}
const model = (deps, name, fallback) => deps.models?.[name] || fallback
const eventModel = deps => model(deps, 'SyntheticOutcomeRunEvent', Event)
const transaction = async (deps, fn) => {
  const session = await (deps.mongoose || mongoose).startSession()
  need(session?.withTransaction && session?.endSession, 'TRANSACTION_REQUIRED', 503)
  try { return await session.withTransaction(() => withSyntheticOutcomeTransactionReads(session, () => fn(session)), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 3000, timeoutMS: 20000 }) }
  finally { await session.endSession() }
}
const signed = (row, deps) => (deps.verifyAudit || (audit => Audit.hydrate(audit).verifySignature()))(row) === true
const REVISION_CONTROL_PROJECTION = ['customerId', 'tenantId', 'workspaceId', 'runtimeInstanceKey', 'runtimeType', 'frameworkKey',
  'packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'revision', 'status', 'stateVersion', 'updatedAt', 'lockedAt', 'lockedBy',
  'lockedEvidenceSnapshot', 'framework_state.lifecycle', 'framework_state.lock', 'framework_state.publish'].join(' ')
const loadRevisionControl = async (args, runtimeInstanceId, session) => {
  const selected = await (args.deps?.getRuntimeInstance || getRuntimeInstance)({ scopes: args.scopes, runtimeInstanceId,
    customerId: p.customerId, tenantId: p.tenantId, projection: REVISION_CONTROL_PROJECTION, maxTimeMS: 3000,
    metadataMaxTimeMS: 3000, internalEvidenceSnapshotToken: EVIDENCE_SNAPSHOT_INTERNAL_READ, session, readBudget: args.readBudget })
  const control = selected?.__evidenceSnapshotControl
  need(control?.runtime && control.pointer && String(control.runtime._id || control.runtime.id) === runtimeInstanceId, 'ACTOR_OR_RUNTIME_DENIED', 403)
  return { ...control.runtime, lockedEvidenceSnapshot: control.pointer }
}
const authorize = async (args, session = null) => {
  const deps = args.deps || {}, environment = deps.env || env, database = deps.databaseName || mongoose.connection.name
  need(['development', 'test'].includes(environment.nodeEnv) && environment.appEnv === 'development'
    && /^(test|ss044_[a-f0-9]{32})$/.test(database || ''), 'ENVIRONMENT_DENIED', 403)
  need(String(args.actorUserId) === p.actorUserId && typeof args.runtimeInstanceId === 'string'
    && /^[a-f0-9]{24}$/.test(args.runtimeInstanceId), 'ACTOR_OR_RUNTIME_DENIED', 403)
  if (args.runtimeInstanceId !== p.runtimeInstanceId) {
    const runtime = await loadRevisionControl(args, args.runtimeInstanceId, session)
    const isSuccessor = args.runtimeInstanceId === successor.runtimeInstanceId
    const parentId = isSuccessor ? successor.parentRuntimeInstanceId : p.runtimeInstanceId
    need(['customerId', 'tenantId'].every(key => String(runtime[key]) === p[key]) && runtime.revision?.revisionNumber === (isSuccessor ? 3 : 2)
      && String(runtime.revision.parentRuntimeId) === parentId && String(runtime.revision.rootRuntimeId) === p.runtimeInstanceId,
    'ACTOR_OR_RUNTIME_DENIED', 403)
    const parentAuth = await authorize({ ...args, runtimeInstanceId: parentId }, session)
    const parentRuntime = await loadRevisionControl(args, parentId, session)
    let lineage
    try { lineage = (isSuccessor ? buildSuccessorSyntheticRevisionLineage : buildDirectSyntheticRevisionLineage)({ runtime, parentRuntime, parentBasis: parentAuth.basis }) }
    catch { fail('REVISION_LINEAGE_INVALID') }
    need(runtime.status === 'LOCKED' && runtime.framework_state?.lock?.locked === true
      && runtime.framework_state?.publish?.state === 'PUBLISHED' && runtime.framework_state.publish.published === true
      && runtime.framework_state?.lifecycle?.stage === 'LOCKED', 'REVISION_LOCK_REQUIRED')
    await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId: args.actorUserId, scopes: args.scopes,
      customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session })
    const pointer = runtime.lockedEvidenceSnapshot
    let lockAuditVerified = false
    const frozen = await (deps.readVerifiedBasis || readVerifiedRuntimeEvidenceSnapshot)({ runtime, pointer, session, readBudget: args.readBudget,
      deps: { readAudit: async (auditId, options = {}) => {
        need(mongoose.isValidObjectId(auditId), 'REVISION_LOCK_AUDIT_INVALID')
        let read = model(deps, 'AuditLog', Audit).find({ _id: oid(auditId), resourceId: oid(args.runtimeInstanceId),
          action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
          'scope.customerId': oid(p.customerId), 'scope.tenantId': oid(p.tenantId),
          'scope.runtimeInstanceId': oid(args.runtimeInstanceId), 'scope.runtimeInstanceKey': runtime.runtimeInstanceKey }).limit(2).maxTimeMS(2000)
        if (options.session) read = read.session(options.session)
        if (options.readBudget) read = read.setOptions(options.readBudget())
        const audits = await read.lean()
        need(Array.isArray(audits) && audits.length === 1 && Buffer.byteLength(JSON.stringify(membershipJson(audits))) <= 512 * 1024
          && String(audits[0]._id) === String(auditId) && Audit.hydrate(audits[0]).verifySignature() === true, 'REVISION_LOCK_AUDIT_INVALID')
        lockAuditVerified = true
        return audits[0]
      } } })
    need(lockAuditVerified, 'REVISION_LOCK_AUDIT_REQUIRED')
    need(frozen?.available === true && frozen.completeness === 'VERIFIED' && frozen.revisionNumber === (isSuccessor ? 3 : 2)
      && !frozen.serializationCorrection && frozen.snapshotId !== p.snapshotId && (isSuccessor || frozen.membershipHash !== p.membershipHash)
      && frozen.basisStateVersion === runtime.stateVersion && frozen.basisStateVersion !== p.stateVersion
      && ['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash'].every(key => frozen[key] === pointer?.[key])
      && frozen.lockSnapshotId === runtime.framework_state.lock.snapshot?.snapshotId
      && frozen.lockSnapshotHash === runtime.framework_state.lock.snapshot?.snapshotHash
      && frozen.lockSnapshotId !== parentAuth.basis.lockSnapshotId
      && Object.keys(frozen.counts || {}).sort().join(',') === 'evidence,sections,sources'
      && Object.entries({ sources: 1000, evidence: 5000, sections: 100 }).every(([key, cap]) => Number.isSafeInteger(frozen.counts[key])
        && frozen.counts[key] >= 0 && frozen.counts[key] <= cap), 'REVISION_BASIS_REQUIRED')
    if (isSuccessor) need(['snapshotId', 'basisStateVersion', 'lockSnapshotId'].every(key => frozen[key] !== parentAuth.basis[key]
      && frozen[key] !== parentAuth.basis.lineage.parentBasis[key]), 'REVISION_BASIS_REQUIRED')
    const children = await query(model(deps, 'RuntimeInstance', RuntimeInstance).find({ customerId: oid(p.customerId), tenantId: oid(p.tenantId),
      'revision.parentRuntimeId': oid(parentId) }).select('_id').limit(2), session, args.readBudget)
    need(Array.isArray(children) && children.length === 1 && String(children[0]._id) === args.runtimeInstanceId, 'REVISION_CHILD_AMBIGUOUS')
    const basis = { snapshotId: frozen.snapshotId, membershipHash: frozen.membershipHash, basisStateVersion: frozen.basisStateVersion,
      lockSnapshotId: frozen.lockSnapshotId, lockSnapshotHash: frozen.lockSnapshotHash, counts: { ...frozen.counts }, lineage }
    return { runtime, basis, classification: classification(args.runtimeInstanceId), version: isSuccessor ? SUCCESSOR_VERSION : REVISION_VERSION }
  }
  const runtime = await (deps.getRuntimeInstance || loadPublishedRecoveryRuntime)({ ...args, session }, session)
  need(runtime && String(runtime._id || runtime.id) === p.runtimeInstanceId
    && ['customerId', 'tenantId'].every(key => String(runtime[key]) === p[key])
    && runtime.runtimeInstanceKey === p.runtimeInstanceKey && runtime.revision?.revisionNumber === 1
    && runtime.status === 'LOCKED' && runtime.stateVersion === p.stateVersion && runtime.framework_state?.lock?.locked === true, 'RUNTIME_SCOPE_DENIED', 403)
  await (deps.assertRuntimePermission || assertRuntimePermission)({ actorUserId: args.actorUserId, scopes: args.scopes,
    customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session })
  const frozen = await (deps.readVerifiedBasis || readVerifiedRuntimeEvidenceSnapshot)({ runtime, pointer: runtime.lockedEvidenceSnapshot, session })
  need(frozen?.available === true && frozen.completeness === 'VERIFIED' && frozen.snapshotId === p.snapshotId
    && frozen.membershipHash === p.membershipHash && frozen.basisStateVersion === p.stateVersion
    && frozen.counts?.sources === 8 && frozen.counts.evidence === 47 && frozen.counts.sections === 6
    && frozen.serializationCorrection?.receiptId && frozen.serializationCorrection?.bodyHash, 'RECOVERED_BASIS_REQUIRED')
  const basis = { snapshotId: frozen.snapshotId, membershipHash: frozen.membershipHash, basisStateVersion: frozen.basisStateVersion,
    lockSnapshotId: frozen.lockSnapshotId, lockSnapshotHash: frozen.lockSnapshotHash, counts: { ...frozen.counts },
    correctionReceiptId: frozen.serializationCorrection.receiptId, correctionBodyHash: frozen.serializationCorrection.bodyHash }
  return { runtime, basis, classification: classification(p.runtimeInstanceId), version: VERSION }
}
const association = auth => ({ classification: auth.classification, basis: auth.basis })
const plannerDeps = (args, auth) => ({ ...(args.deps?.plannerDeps || {}),
  authorizeRuntime: async () => { await authorize(args) }, requestAssociation: association(auth), preserveInitialRequest: true })
const eventRead = async (phase, args, session = null) => {
  const deps = args.deps || {}
  const row = await query(eventModel(deps).findOne({ ...scope(args.runtimeInstanceId), phase }), session)
  if (!row) return null
  assertSyntheticOutcomeRunEvent(row)
  need(String(row.runtimeInstanceId) === args.runtimeInstanceId, 'EVENT_SCOPE_INVALID')
  const audit = await query(model(deps, 'AuditLog', Audit).findOne({ _id: row.auditId }), session)
  need(audit && String(audit._id) === String(row.auditId) && signed(audit, deps) && audit.signatureVersion === row.auditSignatureVersion
    && String(audit.actorUserId) === p.actorUserId && audit.action === 'RUNTIME_STATE_MUTATED'
    && audit.resourceType === 'RuntimeInstance' && String(audit.resourceId) === args.runtimeInstanceId
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(audit.scope?.[key]) === (key === 'runtimeInstanceId' ? args.runtimeInstanceId : p[key]))
    && audit.diff?.action === 'ISOLATED_SYNTHETIC_OUTCOME_EVENT' && audit.diff.eventId === row.eventId
    && audit.diff.phase === phase && audit.diff.bodyHash === row.bodyHash
    && (!row.body.basis.lineage || audit.scope.runtimeInstanceKey === row.body.basis.lineage.runtimeInstanceKey), 'EVENT_AUDIT_INVALID')
  return row
}
const noClaim = async args => need(!await eventRead('CLAIM', args), 'EXECUTION_ALREADY_CLAIMED')
export const inspectIsolatedSyntheticOutcome = async args => {
  const auth = await authorize(args)
  if (await eventRead('DRAFT_PERSISTENCE_CLAIM', args) || await eventRead('DRAFT_PERSISTENCE_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  if (await eventRead('HANDOFF_CLAIM', args) || await eventRead('HANDOFF_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  if (await eventRead('DRAFT_REPAIR_CLAIM', args) || await eventRead('DRAFT_REPAIR_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  if (await eventRead('DRAFT_RETRY_CLAIM', args) || await eventRead('DRAFT_RETRY_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  if (await eventRead('RECOVERY_CLAIM', args) || await eventRead('RECOVERY_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  if (await eventRead('CONTINUATION_CLAIM', args) || await eventRead('CONTINUATION_RESULT', args)) return readIsolatedSyntheticOutcome(args)
  const claim = await eventRead('CLAIM', args), result = await eventRead('RESULT', args)
  return readEnvelope(args, auth, { basis: auth.basis, run: { status: result?.body.status || (claim ? 'UNKNOWN' : 'NOT_STARTED'),
    claimEventId: claim?.eventId || null, resultEventId: result?.eventId || null } })
}
export const planIsolatedSyntheticOutcome = async args => {
  const auth = await authorize(args); await noClaim(args)
  const result = await (args.deps?.planRequest || planOutcomeStudioRequest)({ ...args, deps: plannerDeps(args, auth) })
  return envelope(result)
}
export const confirmIsolatedSyntheticOutcomePlan = async args => {
  const auth = await authorize(args); await noClaim(args)
  const result = await (args.deps?.confirmPlan || confirmOutcomeStudioRequestPlan)({ ...args, deps: plannerDeps(args, auth) })
  return envelope(result)
}
const readPlan = async (args, auth, session = null) => {
  const deps = args.deps || {}, payload = args.payload
  const plan = await (deps.readPlan ? deps.readPlan({ ...args, session }) : query(model(deps, 'OutcomeKnowledgeCompositionPlan', Plan).findOne({
    ...scope(args.runtimeInstanceId), requestId: payload.requestId,
  }).sort({ planVersion: -1 }), session))
  need(plan, 'PLAN_REQUIRED')
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  let planningRuntime = auth.runtime
  if ([REVISION_VERSION, SUCCESSOR_VERSION].includes(auth.version)) {
    const planningEvidenceVersion = plan.payload?.planningEvidence?.contractVersion
    need(Object.values(OUTCOME_PLANNING_EVIDENCE_VERSIONS).includes(planningEvidenceVersion), 'REVISION_PLANNING_EVIDENCE_REQUIRED')
    planningRuntime = await (deps.readPlanningEvidence || getRuntimeOutcomePlanningEvidence)({ scopes: args.scopes,
      runtimeInstanceId: args.runtimeInstanceId, session, planningEvidenceVersion })
    need(planningRuntime && String(planningRuntime._id || planningRuntime.id) === args.runtimeInstanceId
      && ['customerId', 'tenantId', 'runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageId', 'packageKey', 'packageVersion', 'stateVersion']
        .every(key => String(planningRuntime[key]) === String(auth.runtime[key]))
      && (planningRuntime.workspaceId || '') === (auth.runtime.workspaceId || '')
      && Number.isFinite(new Date(planningRuntime.updatedAt).getTime())
      && new Date(planningRuntime.updatedAt).getTime() === new Date(auth.runtime.updatedAt).getTime()
      && planningRuntime.planningEvidence?.contractVersion === planningEvidenceVersion
      && membershipHash(planningRuntime.framework_state?.lock) === membershipHash(auth.runtime.framework_state?.lock)
      && membershipHash(planningRuntime.framework_state?.publish) === membershipHash(auth.runtime.framework_state?.publish), 'REVISION_PLANNING_BASIS_CHANGED')
  }
  ;(deps.assertPlanMatchesRuntime || assertOutcomeKnowledgeCompositionPlanMatchesRuntime)(plan, planningRuntime)
  need(['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(plan[key]) === auth.classification[key])
    && plan.requestId === payload.requestId && plan.planId === payload.planId && plan.planFingerprint === payload.expectedPlanFingerprint
    && membershipHash(plan.payload?.requestAssociation) === membershipHash({ sessionId: '', ...association(auth) })
    && plan.payload?.requestId === payload.requestId, 'PLAN_CLASSIFICATION_OR_SCOPE_INVALID')
  return plan
}
const deterministicUuid = value => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  const text = hex.join(''); return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}
const binding = plan => ({ requestId: plan.requestId, draftId: `outcome_draft_${deterministicUuid(`SS-033:DRAFT:${plan.requestId}:${plan.planId}`)}`,
  draftIterationId: `outcome_draft_iteration_${deterministicUuid(`SS-033:ITERATION:1:${plan.requestId}:${plan.planId}`)}` })
const indexesReady = async deps => {
  let indexes
  try { indexes = await eventModel(deps).collection.listIndexes({ maxTimeMS: 3000 }).toArray() }
  catch (error) { if (error.code === 26 || error.codeName === 'NamespaceNotFound') fail('INDEX_NOT_READY', 503); throw error }
  for (const [name, last] of [['unique_scoped_synthetic_outcome_phase', 'phase'], ['unique_scoped_synthetic_outcome_event', 'eventId']]) {
    need(indexes.some(index => index.name === name && index.unique === true && !index.sparse && !index.partialFilterExpression
      && membershipHash(index.key) === membershipHash({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [last]: 1 })), 'INDEX_NOT_READY', 503)
  }
}
const readEnvelope = async (args, auth, data) => {
  let persistenceReadiness = { status: 'READY', reason: null }
  try {
    await indexesReady(args.deps || {})
    if ([REVISION_VERSION, SUCCESSOR_VERSION].includes(auth.version)) await revisionIndexReady(args.deps || {}, auth.basis.lineage.parentRuntimeInstanceId)
  } catch (error) {
    if (error.code !== 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED'
      || !['INDEX_NOT_READY', 'REVISION_INDEX_NOT_READY'].includes(error.details?.reason)) throw error
    persistenceReadiness = { status: 'UNAVAILABLE', reason: error.details.reason }
  }
  return envelope({ ...data, scope: auth.classification, persistenceReadiness })
}
const revisionIndexReady = async (deps, parentRuntimeInstanceId = p.runtimeInstanceId) => {
  const indexes = await model(deps, 'RuntimeInstance', RuntimeInstance).collection.listIndexes({ maxTimeMS: 3000 }).toArray()
  need(indexes.some(index => {
    if (index.unique !== true || index.sparse
      || membershipHash(index.key) !== membershipHash({ customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 })) return false
    const partial = index.partialFilterExpression
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return false
    const exactScope = { customerId: p.customerId, tenantId: p.tenantId, 'revision.parentRuntimeId': parentRuntimeInstanceId }
    const controlled = partial && Object.keys(partial).sort().join(',') === Object.keys(exactScope).sort().join(',')
      && Object.entries(exactScope).every(([key, value]) => partial[key] instanceof mongoose.Types.ObjectId && partial[key].toHexString() === value)
    return controlled || membershipHash(partial) === membershipHash({ 'revision.parentRuntimeId': { $type: 'objectId' } })
  }), 'REVISION_INDEX_NOT_READY', 503)
}
const writeEvent = async (body, args, session) => {
  invalidateSyntheticOutcomeTransactionReads(session)
  const deps = args.deps || {}, bodyHash = membershipHash(body), audit = deps.auditService || auditService
  const savedAudit = await audit.log({ actorUserId: args.actorUserId, action: audit.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
    resourceType: audit.RESOURCE_TYPES.RuntimeInstance, resourceId: oid(args.runtimeInstanceId), scope: { ...scope(args.runtimeInstanceId), runtimeInstanceKey: body.basis.lineage?.runtimeInstanceKey || p.runtimeInstanceKey },
    requestId: args.auditRequest?.requestId, diff: { action: 'ISOLATED_SYNTHETIC_OUTCOME_EVENT', phase: body.phase, eventId: body.eventId,
      bodyHash, classification: CLASS, planId: body.plan.planId, planFingerprint: body.plan.planFingerprint } }, { session, throwOnError: true })
  const rawAudit = savedAudit?.toObject ? savedAudit.toObject() : savedAudit
  need(rawAudit?._id && signed(rawAudit, deps), 'REQUIRED_AUDIT_FAILED', 503)
  const [saved] = await eventModel(deps).create([{ ...scope(args.runtimeInstanceId), eventId: body.eventId, phase: body.phase, requestKey: body.requestKey,
    payloadHash: body.payloadHash, bodyHash, body, auditId: rawAudit._id, auditSignatureVersion: rawAudit.signatureVersion }], { session })
  return saved.toObject ? saved.toObject() : saved
}
const stageRef = stage => ({ stageKey: stage.stageKey, stageExecutionId: stage.stageExecutionId, status: stage.status,
  inputFingerprint: stage.inputFingerprint, outputFingerprint: stage.outputFingerprint || '', attemptFingerprint: stage.attemptFingerprint,
  materialHash: membershipHash(serializeOutcomeQualityStageExecution(stage)),
  grrExecutionId: stage.executionIdentity?.grrExecutionId || '', grrRuntimeArtifactId: stage.executionIdentity?.grrRuntimeArtifactId || '' })
const assertReturnedStage = (stage, plan, requestBinding, runtimeInstanceId) => need(stage && String(stage.runtimeInstanceId) === runtimeInstanceId
  && stage.requestId === plan.requestId && stage.planId === plan.planId && stage.planFingerprint === plan.planFingerprint
  && stage.draftId === requestBinding.draftId && stage.draftIterationId === requestBinding.draftIterationId, 'STAGE_LINEAGE_INVALID')
const STAGES = ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW']
const assertOrderedStage = (stage, prior, index, retrySource = null) => {
  const retryArl = index === 2 && retrySource?.failedArl
  const retryDraft = index === 1 && retrySource && !(retrySource.transportRecovery || retrySource.authorisedReview)
  need(stage.stageKey === STAGES[index] && stage.stageOrder === index + 1 && stage.attemptNumber === (index === 1 && (retrySource?.transportRecovery || retrySource?.authorisedReview) ? retrySource.draft.attemptNumber : retryArl ? retrySource.failedArl.attemptNumber + 1 : retryDraft ? retrySource.failedDraft.attemptNumber + 1 : 1), 'STAGE_ORDER_INVALID')
  if (index === 1 && (retrySource?.transportRecovery || retrySource?.authorisedReview)) { need(membershipHash(stageRef(stage)) === membershipHash(stageRef(retrySource.draft)), 'TRANSPORT_DRAFT_CHANGED'); return }
  if (prior) need(stage.inputSnapshot?.sourceStage?.stageExecutionId === prior.stageExecutionId
    && stage.inputSnapshot.sourceStage.attemptFingerprint === prior.attemptFingerprint
    && stage.inputSnapshot.sourceStage.outputFingerprint === prior.outputFingerprint
    && stage.predecessorStageExecutionId === (retryArl ? retrySource.failedArl.stageExecutionId : retryDraft ? retrySource.failedDraft.stageExecutionId : prior.stageExecutionId)
    && stage.predecessorAttemptFingerprint === (retryArl ? retrySource.failedArl.attemptFingerprint : retryDraft ? retrySource.failedDraft.attemptFingerprint : prior.attemptFingerprint), 'STAGE_PREDECESSOR_INVALID')
  else need(!stage.predecessorStageExecutionId && !stage.predecessorAttemptFingerprint, 'STAGE_PREDECESSOR_INVALID')
  if (stage.status === 'SUCCEEDED') need(stage.executionIdentity?.executionMode === 'LIVE_TEST'
    && stage.executionIdentity.grrExecutionId && stage.executionIdentity.grrRuntimeArtifactId, 'LIVE_STAGE_PROVIDER_REQUIRED')
}
const runClassification = claim => ({ ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash,
  requestId: claim.body.plan.requestId, planId: claim.body.plan.planId, planFingerprint: claim.body.plan.planFingerprint,
  draftId: claim.body.requestBinding.draftId, draftIterationId: claim.body.requestBinding.draftIterationId })
const collectGrr = async (claim, args, stageRefs, session = null, verifiedParent = null) => {
  const deps = args.deps || {}, expected = runClassification(claim)
  // The immediate caller already verified this parent in this exact snapshot.
  // Standalone readers must still traverse and verify their own source chain.
  const sourceFor = async (link, read) => {
    if (!verifiedParent) return read()
    need(session && verifiedParent.session === session && verifiedParent.args === args
      && verifiedParent.claim === claim
      && membershipHash(verifiedParent.source?.link) === membershipHash(link)
      && membershipHash(verifiedParent.source?.claim?.body?.basis) === membershipHash(claim.body.basis),
    'VERIFIED_PARENT_BINDING_INVALID')
    return verifiedParent.source
  }
  let pairs
  if (deps.collectGrrEvidence) pairs = await deps.collectGrrEvidence({ claim, args, session })
  else {
    const executions = await query(model(deps, 'GovernedReasoningExecution', Grr).find({ ...scope(args.runtimeInstanceId),
      'executionEvidence.syntheticClassification.runEventId': claim.eventId }).sort({ _id: 1 }).limit(4), session)
    const artifacts = await query(model(deps, 'GovernedRuntimeArtifact', Artifact).find({ ...scope(args.runtimeInstanceId),
      'lineageSummary.syntheticClassification.runEventId': claim.eventId }).sort({ _id: 1 }).limit(4), session)
    need(executions.length <= 3 && artifacts.length === executions.length, 'GRR_POPULATION_INVALID')
    pairs = executions.map(execution => ({ execution, artifact: artifacts.find(artifact => artifact.executionId === execution.executionId) }))
  }
  let reused = null, reusedDraft = null, authorisedSource = null
  if (claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair || claim.body.metadataRepair || claim.body.attributionRepair || claim.body.wordingRepair || claim.body.labelRepair) {
    const link = claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair || claim.body.metadataRepair || claim.body.attributionRepair || claim.body.wordingRepair || claim.body.labelRepair
    const source = await sourceFor(link, () => compositionSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, link, session, true, Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair || claim.body.metadataRepair || claim.body.attributionRepair || claim.body.wordingRepair), Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair || claim.body.metadataRepair || claim.body.attributionRepair), Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair || claim.body.metadataRepair), Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair || claim.body.scopingRepair), Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair || claim.body.referenceRepair), Boolean(claim.body.descriptiveRepair || claim.body.holisticRepair), Boolean(claim.body.descriptiveRepair)))
    reused = source.saved
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.authorisedReview) {
    const source = await sourceFor(claim.body.authorisedReview, () => compositionSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.authorisedReview, session, true, true, true, true, true, true, true, true, true))
    authorisedSource = source
    reused = source.saved; reusedDraft = { claim: source.claim, pair: source.draftPair }
    need(!pairs.some(pair => [reused.pair.execution.executionId, reusedDraft.pair.execution.executionId].includes(pair.execution?.executionId)), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, reusedDraft.pair, ...pairs]
  }
  if (claim.body.transportRecovery) {
    const source = await sourceFor(claim.body.transportRecovery, () => transportSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.transportRecovery, session))
    reused = source.saved
    reusedDraft = { claim: source.claim, pair: source.draftPair }
    need(!pairs.some(pair => [reused.pair.execution.executionId, reusedDraft.pair.execution.executionId].includes(pair.execution?.executionId)), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, reusedDraft.pair, ...pairs]
  }
  if (claim.body.compositionRevision) {
    const source = await sourceFor(claim.body.compositionRevision, () => compositionSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.compositionRevision, session))
    reused = source.saved
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.recovery) {
    reused = await recoverySource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.recovery, session)
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.draftRetry) {
    const source = await draftRetrySource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.draftRetry, session)
    reused = source.saved
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.draftRepair) {
    const source = await draftRetrySource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.draftRepair, session, true)
    reused = source.saved
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.handoffRecovery) {
    const source = await handoffSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.handoffRecovery, session)
    reused = source.saved
    need(!pairs.some(pair => pair.execution?.executionId === reused.pair.execution.executionId), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, ...pairs]
  }
  if (claim.body.draftPersistence) {
    const source = await sourceFor(claim.body.draftPersistence, () => draftPersistenceSource(args, { version: SUCCESSOR_VERSION, basis: claim.body.basis }, claim.body.draftPersistence, session))
    reused = source.saved; reusedDraft = source.draftSaved
    need(!pairs.some(pair => [reused.pair.execution.executionId, reusedDraft.pair.execution.executionId].includes(pair.execution?.executionId)), 'RECOVERY_DUPLICATE_SOURCE')
    pairs = [reused.pair, reusedDraft.pair, ...pairs]
  }
  need(Array.isArray(pairs) && pairs.length <= 3 && new Set(pairs.map(row => row.execution?.executionId)).size === pairs.length
    && new Set(pairs.map(row => row.artifact?.runtimeArtifactId)).size === pairs.length, 'GRR_POPULATION_INVALID')
  const refs = [], output = []
  for (const pair of pairs) {
    const { execution, artifact } = pair
    const expectedClassification = reusedDraft && execution?.executionId === reusedDraft.pair.execution.executionId ? runClassification(reusedDraft.claim)
      : reused && execution?.executionId === reused.pair.execution.executionId ? runClassification(reused.claim) : expected
    need(execution && artifact && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(execution[key]) === claim.body.classification[key] && String(artifact[key]) === claim.body.classification[key])
      && execution.executionId === artifact.executionId && execution.artifactIds?.includes(artifact.runtimeArtifactId)
      && membershipHash(execution.executionEvidence?.syntheticClassification) === membershipHash(expectedClassification)
      && membershipHash(artifact.lineageSummary?.syntheticClassification) === membershipHash(expectedClassification)
      && artifact.artifactType === CLASS && execution.outputTypeKey === artifact.outputTypeKey, 'GRR_LINEAGE_INVALID')
    const key = { FRAMEWORK_GUIDANCE_ANALYSIS: 'FRAMEWORK_GUIDANCE', WORKING_DRAFT: 'WORKING_DRAFT', ARL_MEANING_REVIEW: 'ARL_MEANING_REVIEW' }[execution.outputTypeKey]
    need(key, 'GRR_STAGE_INVALID')
    const matches = stageRefs.filter(stage => stage.grrExecutionId === execution.executionId && stage.grrRuntimeArtifactId === artifact.runtimeArtifactId)
    need(matches.length <= 1 && (!matches.length || matches[0].stageKey === key), 'GRR_STAGE_LINK_INVALID')
    const ref = { executionId: execution.executionId, runtimeArtifactId: artifact.runtimeArtifactId,
      executionHash: membershipHash(execution), artifactHash: membershipHash(artifact), stageKey: key,
      stageLinkage: matches.length ? 'LINKED' : 'UNRESOLVED', stageExecutionId: matches[0]?.stageExecutionId || '' }
    refs.push(ref); output.push({ ...ref, ...([reused, reusedDraft].some(source => source && execution.executionId === source.pair.execution.executionId) ? { reusedProviderResult: true } : {}), execution, artifact })
  }
  need(stageRefs.every(stage => !stage.grrExecutionId || refs.some(ref => ref.executionId === stage.grrExecutionId
    && ref.runtimeArtifactId === stage.grrRuntimeArtifactId)), 'GRR_MISSING')
  need(new Set(refs.map(ref => ref.stageKey)).size === refs.length, 'GRR_POPULATION_INVALID')
  if (claim.body.authorisedReview) {
    const ref = stageRefs.find(row => row.stageKey === 'ARL_MEANING_REVIEW')
    const pair = output.find(row => row.stageKey === 'ARL_MEANING_REVIEW')
    const stage = ref ? (await readRecordedStage(ref, args, claim.body.plan, session)).stage : null
    const receipt = stage?.executionIdentity?.authorisedReview || pair?.artifact.safeJson?.metadata?.authorisedReview
    if (stage || pair) {
      need(receipt, 'AUTHORISED_REVIEW_RECEIPT_MISSING')
      assertStoredAuthorisedArlReview({ claim, receipt, stage, artifact: pair?.artifact,
        priorResponseId: authorisedSource.priorArlPair?.artifact.safeJson?.metadata?.responseId })
    }
  }
  refs.sort((a, b) => a.executionId.localeCompare(b.executionId)); output.sort((a, b) => a.executionId.localeCompare(b.executionId))
  return { refs, output }
}
const failureDetails = error => {
  const result = { failureCode: error.code || 'EXECUTION_OUTCOME_UNCONFIRMED',
    message: String(error.message).replace(/Bearer\s+\S+|sk-[\w-]+/gi, '[REDACTED]').slice(0, 500) }
  if (error.details !== undefined) {
    try {
      const text = JSON.stringify(error.details, (key, value) => /password|token|secret|api.?key|authorization|cookie|headers|stack/i.test(key) ? '[REDACTED]' : value)
      if (Buffer.byteLength(text) <= 16384) result.details = JSON.parse(text)
      else { result.detailsOmitted = true; result.detailsHash = createHash('sha256').update(text).digest('hex') }
    } catch { result.detailsUnavailable = true }
  }
  return result
}
const assertEventPair = (claim, result) => need(claim && result
  && result.body.version === claim.body.version
  && result.body.claim?.eventId === claim.eventId && result.body.claim.bodyHash === claim.bodyHash
  && result.payloadHash === claim.payloadHash && result.requestKey === claim.requestKey
  && ['basis', 'classification', 'plan', 'requestBinding', 'continuation', 'recovery', 'draftRetry', 'draftRepair', 'handoffRecovery', 'draftPersistence', 'compositionRevision', 'transportRecovery', 'labelRepair', 'wordingRepair', 'attributionRepair', 'metadataRepair', 'scopingRepair', 'referenceRepair', 'holisticRepair', 'descriptiveRepair', 'authorisedReview', 'reviewApproval'].every(key =>
    membershipHash(result.body[key] ?? null) === membershipHash(claim.body[key] ?? null)), 'RESULT_CLAIM_MISMATCH')
const continuationSource = async (args, auth, expected, session = null) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'CONTINUATION_SCOPE_INVALID')
  const claim = await eventRead('CLAIM', args, session), result = await eventRead('RESULT', args, session)
  assertEventPair(claim, result)
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash }
  need(membershipHash(expected) === membershipHash(link) && claim.body.version === SUCCESSOR_VERSION
    && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'UNKNOWN' && result.body.stageRefs.length === 0 && result.body.grrRefs.length === 0
    && result.body.failure?.failureCode === 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID'
    && result.body.failure?.details?.field === 'assignedPack', 'CONTINUATION_SOURCE_INVALID')
  need((await collectGrr(claim, args, [], session)).refs.length === 0, 'CONTINUATION_PRIOR_PROVIDER_EXISTS')
  return { claim, result, link }
}
const assertNoPriorExecution = async (args, plan, session) => {
  const deps = args.deps || {}
  // Query native records as well as immutable receipts: empty receipt arrays alone
  // cannot prove that an earlier provider or stage did not commit.
  for (const [name, fallback, prefix] of [['OutcomeQualityStageExecution', Stage, ''],
    ['GovernedReasoningExecution', Grr, 'executionEvidence.syntheticClassification.'],
    ['GovernedRuntimeArtifact', Artifact, 'lineageSummary.syntheticClassification.']]) {
    const filter = { ...scope(args.runtimeInstanceId), $or: [
      { [`${prefix}requestId`]: plan.requestId }, { [`${prefix}planId`]: plan.planId },
    ] }
    need(!await query(model(deps, name, fallback).findOne(filter), session), 'CONTINUATION_PRIOR_EXECUTION_EXISTS')
  }
}
const recoverySource = async (args, auth, expected, session = null) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'RECOVERY_SCOPE_INVALID')
  const claim = await eventRead('CONTINUATION_CLAIM', args, session), result = await eventRead('CONTINUATION_RESULT', args, session)
  assertEventPair(claim, result)
  await continuationSource(args, auth, claim.body.continuation, session)
  need(claim.body.version === CONTINUATION_VERSION && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'UNKNOWN' && result.body.stageRefs.length === 0 && result.body.grrRefs.length === 1
    && result.body.failure?.failureCode === 'OUTCOME_QUALITY_STAGE_PERSISTENCE_FAILED', 'RECOVERY_SOURCE_INVALID')
  const evidence = await collectGrr(claim, args, [], session)
  need(evidence.refs.length === 1 && membershipHash(evidence.refs) === membershipHash(result.body.grrRefs), 'RECOVERY_PROVIDER_CHANGED')
  const ref = evidence.refs[0], pair = evidence.output[0]
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    executionId: ref.executionId, runtimeArtifactId: ref.runtimeArtifactId, executionHash: ref.executionHash, artifactHash: ref.artifactHash }
  need(membershipHash(expected) === membershipHash(link) && ref.stageKey === 'FRAMEWORK_GUIDANCE' && ref.stageLinkage === 'UNRESOLVED'
    && pair.execution.status === 'COMPLETED' && pair.execution.providerMode === 'LIVE_TEST'
    && pair.execution.provider?.liveProvider === true && pair.execution.provider.providerMode === 'LIVE_TEST'
    && pair.artifact.status === 'GENERATED' && pair.artifact.generatedOutput
    && Number.isFinite(new Date(pair.execution.requestedAt).getTime())
    && Number.isFinite(new Date(pair.execution.completedAt).getTime()), 'RECOVERY_SOURCE_INVALID')
  return { claim, result, pair, ref, link }
}
const assertRecoveryHistory = async (args, plan, source, session) => {
  const deps = args.deps || {}, nativeScope = scope(args.runtimeInstanceId)
  need(!await query(model(deps, 'OutcomeQualityStageExecution', Stage).findOne({ ...nativeScope,
    $or: [{ requestId: plan.requestId }, { planId: plan.planId }] }), session), 'RECOVERY_PRIOR_STAGE_EXISTS')
  for (const [name, fallback, prefix, expected] of [
    ['GovernedReasoningExecution', Grr, 'executionEvidence.syntheticClassification.', source.ref.executionHash],
    ['GovernedRuntimeArtifact', Artifact, 'lineageSummary.syntheticClassification.', source.ref.artifactHash],
  ]) {
    const rows = await query(model(deps, name, fallback).find({ ...nativeScope,
      $or: [{ [`${prefix}requestId`]: plan.requestId }, { [`${prefix}planId`]: plan.planId }] }).limit(2), session)
    need(rows.length === 1 && membershipHash(rows[0]) === expected, 'RECOVERY_EXTRA_PROVIDER_HISTORY')
  }
}
const readRecordedStage = async (ref, args, plan, session = null) => {
  const deps = args.deps || {}
  const raw = await (deps.readStage ? deps.readStage(ref) : query(model(deps, 'OutcomeQualityStageExecution', Stage).findOne({
    ...scope(args.runtimeInstanceId), stageExecutionId: ref.stageExecutionId, planId: plan.planId, requestId: plan.requestId,
  }), session))
  need(raw, 'STAGE_MISSING')
  if (deps.assertStageIntegrity) await deps.assertStageIntegrity(raw)
  else await new Stage(raw).validate()
  const stage = serializeOutcomeQualityStageExecution(raw)
  need(membershipHash(stageRef(stage)) === membershipHash(ref), 'STAGE_MATERIAL_CHANGED')
  return { raw, stage }
}
const verifyRecordedStageAudit = async (raw, args, session) => {
  const deps = args.deps || {}, filter = { action: 'OUTCOME_QUALITY_STAGE_RECORDED', resourceType: 'OutcomeQualityStageExecution',
    resourceId: raw._id, 'scope.runtimeInstanceId': oid(args.runtimeInstanceId), 'scope.customerId': oid(p.customerId), 'scope.tenantId': oid(p.tenantId) }
  const rows = await query(model(deps, 'AuditLog', Audit).find(filter).limit(2), session)
  need(raw._id && rows.length === 1 && signed(rows[0], deps)
    && String(rows[0].actorUserId) === p.actorUserId
    && ['stageExecutionId', 'qualityRunId', 'planId', 'planFingerprint', 'stageKey', 'stageOrder', 'attemptNumber', 'status', 'predecessorStageExecutionId', 'inputFingerprint']
      .every(key => rows[0].diff?.[key] === raw[key])
    && rows[0].diff?.outputFingerprint === (raw.outputFingerprint || '')
    && rows[0].diff?.providerConfigurationVersion === raw.executionIdentity?.providerConfigurationVersion
    && rows[0].diff?.failureCode === (raw.failure?.failureCode || '')
    && rows[0].diff?.retryable === (raw.failure?.retryable === true), 'DRAFT_RETRY_STAGE_AUDIT_INVALID')
}
const draftRetrySource = async (args, auth, expected, session = null, repair = false) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'DRAFT_RETRY_SCOPE_INVALID')
  const claim = await eventRead(repair ? 'DRAFT_RETRY_CLAIM' : 'RECOVERY_CLAIM', args, session), result = await eventRead(repair ? 'DRAFT_RETRY_RESULT' : 'RECOVERY_RESULT', args, session)
  assertEventPair(claim, result)
  need(claim.body.version === (repair ? DRAFT_RETRY_VERSION : RECOVERY_VERSION) && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'FAILED' && result.body.stageRefs.length === 2 && result.body.grrRefs.length === 1
    && result.body.failure?.failureCode === (repair ? 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID' : 'WORKING_DRAFT_PROVIDER_INCOMPLETE')
    && (!repair || result.body.failure.safeReason === 'The governed Working Draft provider output failed validation at claimReferences (SCHEMA).') && result.body.failure.retryable === true, 'DRAFT_RETRY_SOURCE_INVALID')
  const parent = repair ? await draftRetrySource(args, auth, claim.body.draftRetry, session) : null
  const saved = parent?.saved || await recoverySource(args, auth, claim.body.recovery, session)
  const guidance = await readRecordedStage(result.body.stageRefs[0], args, claim.body.plan, session)
  const draft = await readRecordedStage(result.body.stageRefs[1], args, claim.body.plan, session)
  for (const value of [guidance, draft]) {
    assertReturnedStage(value.stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
    await verifyRecordedStageAudit(value.raw, args, session)
  }
  assertOrderedStage(guidance.stage, null, 0); assertOrderedStage(draft.stage, guidance.stage, 1, parent)
  need(guidance.stage.status === 'SUCCEEDED' && draft.stage.status === 'FAILED'
    && draft.stage.failure?.failureCode === (repair ? 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID' : 'WORKING_DRAFT_PROVIDER_INCOMPLETE') && draft.stage.failure.retryable === true
    && !draft.stage.executionIdentity.grrExecutionId && !draft.stage.executionIdentity.grrRuntimeArtifactId
    && guidance.stage.executionIdentity.grrExecutionId === saved.ref.executionId
    && guidance.stage.executionIdentity.grrRuntimeArtifactId === saved.ref.runtimeArtifactId
    && membershipHash(result.body.grrRefs[0]) === membershipHash({ ...saved.ref, stageLinkage: 'LINKED', stageExecutionId: guidance.stage.stageExecutionId }), 'DRAFT_RETRY_SOURCE_INVALID')
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    guidanceStageExecutionId: guidance.stage.stageExecutionId, guidanceMaterialHash: result.body.stageRefs[0].materialHash,
    failedDraftStageExecutionId: draft.stage.stageExecutionId, failedDraftMaterialHash: result.body.stageRefs[1].materialHash }
  need(membershipHash(expected) === membershipHash(link), 'DRAFT_RETRY_SOURCE_INVALID')
  return { claim, result, saved, guidance: guidance.stage, failedDraft: draft.stage, link, historyRefs: parent ? [...parent.historyRefs, result.body.stageRefs[1]] : result.body.stageRefs }
}
const handoffSource = async (args, auth, expected, session = null) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'HANDOFF_SCOPE_INVALID')
  const claim = await eventRead('DRAFT_REPAIR_CLAIM', args, session), result = await eventRead('DRAFT_REPAIR_RESULT', args, session)
  assertEventPair(claim, result)
  need(claim.body.version === DRAFT_REPAIR_VERSION && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'UNKNOWN' && result.body.failure?.failureCode === 'GRR_LIVE_TEST_PROVIDER_RESULT_INVALID'
    && result.body.failure?.details?.reason === 'LIVE_TEST_PROVIDER_RESULT_INVALID'
    && result.body.stageRefs.length === 1 && result.body.grrRefs.length === 1, 'HANDOFF_SOURCE_INVALID')
  const parent = await draftRetrySource(args, auth, claim.body.draftRepair, session, true)
  need(membershipHash(claim.body.plan) === membershipHash(parent.claim.body.plan)
    && membershipHash(claim.body.requestBinding) === membershipHash(parent.claim.body.requestBinding)
    && membershipHash(result.body.stageRefs[0]) === membershipHash(stageRef(parent.guidance))
    && membershipHash(result.body.grrRefs) === membershipHash(parent.result.body.grrRefs), 'HANDOFF_SOURCE_INVALID')
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    guidanceStageExecutionId: parent.guidance.stageExecutionId, guidanceMaterialHash: stageRef(parent.guidance).materialHash,
    failedDraftStageExecutionId: parent.failedDraft.stageExecutionId, failedDraftMaterialHash: stageRef(parent.failedDraft).materialHash }
  need(membershipHash(expected) === membershipHash(link), 'HANDOFF_SOURCE_INVALID')
  return { ...parent, claim, result, link }
}
const draftPersistenceSource = async (args, auth, expected, session = null) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'DRAFT_PERSISTENCE_SCOPE_INVALID')
  const claim = await eventRead('HANDOFF_CLAIM', args, session), result = await eventRead('HANDOFF_RESULT', args, session)
  assertEventPair(claim, result)
  need(claim.body.version === HANDOFF_VERSION && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'UNKNOWN' && result.body.failure?.failureCode === 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID'
    && result.body.failure?.details?.field === 'providerOutput.sections[0].claims[0].blockedStrongerClaim'
    && result.body.failure?.details?.min === 1 && result.body.failure?.details?.max === 2000
    && result.body.stageRefs.length === 1 && result.body.grrRefs.length === 2, 'DRAFT_PERSISTENCE_SOURCE_INVALID')
  const parent = await handoffSource(args, auth, claim.body.handoffRecovery, session)
  need(membershipHash(claim.body.plan) === membershipHash(parent.claim.body.plan)
    && membershipHash(claim.body.requestBinding) === membershipHash(parent.claim.body.requestBinding)
    && membershipHash(result.body.stageRefs[0]) === membershipHash(stageRef(parent.guidance)), 'DRAFT_PERSISTENCE_SOURCE_INVALID')
  const evidence = await collectGrr(claim, args, result.body.stageRefs, session)
  need(membershipHash(evidence.refs) === membershipHash(result.body.grrRefs), 'DRAFT_PERSISTENCE_PROVIDER_CHANGED')
  const ref = evidence.refs.find(row => row.stageKey === 'WORKING_DRAFT')
  const pair = evidence.output.find(row => row.executionId === ref?.executionId)
  need(ref?.stageLinkage === 'UNRESOLVED' && ref.stageExecutionId === '' && pair
    && pair.execution.status === 'COMPLETED' && pair.execution.providerMode === 'LIVE_TEST'
    && pair.execution.provider?.liveProvider === true && pair.execution.provider.providerMode === 'LIVE_TEST'
    && String(pair.execution.requestedBy) === p.actorUserId && pair.artifact.status === 'GENERATED'
    && String(pair.artifact.generatedBy) === p.actorUserId && pair.artifact.generatedOutput
    && Number.isFinite(new Date(pair.execution.requestedAt).getTime())
    && Number.isFinite(new Date(pair.execution.completedAt).getTime()), 'DRAFT_PERSISTENCE_SOURCE_INVALID')
  const ids = pair.execution.auditLogIds
  need(Array.isArray(ids) && ids.length > 0 && ids.length <= 4 && ids.every(value => mongoose.isValidObjectId(value))
    && new Set(ids.map(String)).size === ids.length, 'DRAFT_PERSISTENCE_AUDIT_INVALID')
  const audits = await query(model(args.deps || {}, 'AuditLog', Audit).find({ _id: { $in: ids.map(oid) } }).limit(5), session)
  need(audits.length === ids.length && audits.every(audit => signed(audit, args.deps || {})
    && audit.action === 'GOVERNED_REASONING_EXECUTED' && audit.resourceType === 'GovernedReasoningExecution'
    && String(audit.resourceId) === String(pair.execution._id) && String(audit.actorUserId) === p.actorUserId
    && String(audit.scope?.customerId) === p.customerId && String(audit.scope?.tenantId) === p.tenantId
    && audit.diff?.executionId === ref.executionId && audit.diff?.runtimeInstanceId === args.runtimeInstanceId
    && audit.diff?.providerMode === 'LIVE_TEST' && audit.diff?.outputTypeKey === 'WORKING_DRAFT'
    && membershipHash(audit.diff?.artifactIds) === membershipHash(pair.execution.artifactIds)), 'DRAFT_PERSISTENCE_AUDIT_INVALID')
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    guidanceStageExecutionId: parent.guidance.stageExecutionId, guidanceMaterialHash: stageRef(parent.guidance).materialHash,
    failedDraftStageExecutionId: parent.failedDraft.stageExecutionId, failedDraftMaterialHash: stageRef(parent.failedDraft).materialHash,
    executionId: ref.executionId, runtimeArtifactId: ref.runtimeArtifactId, executionHash: ref.executionHash, artifactHash: ref.artifactHash }
  need(membershipHash(expected) === membershipHash(link), 'DRAFT_PERSISTENCE_SOURCE_INVALID')
  return { ...parent, claim, result, link, draftSaved: { claim, pair, ref } }
}
const assertDraftRetryHistory = async (args, plan, source, session) => {
  const deps = args.deps || {}, nativeScope = scope(args.runtimeInstanceId)
  const rows = await query(model(deps, 'OutcomeQualityStageExecution', Stage).find({ ...nativeScope,
    $or: [{ requestId: plan.requestId }, { planId: plan.planId }] }).limit(4), session)
  need(rows.length === source.historyRefs.length && rows.every(row => source.historyRefs.some(ref => membershipHash(stageRef(serializeOutcomeQualityStageExecution(row))) === membershipHash(ref))), 'DRAFT_RETRY_EXTRA_STAGE_HISTORY')
  const sources = [source.saved, ...(source.draftSaved ? [source.draftSaved] : [])]
  for (const [name, fallback, prefix, key] of [
    ['GovernedReasoningExecution', Grr, 'executionEvidence.syntheticClassification.', 'executionHash'],
    ['GovernedRuntimeArtifact', Artifact, 'lineageSummary.syntheticClassification.', 'artifactHash'],
  ]) {
    const values = await query(model(deps, name, fallback).find({ ...nativeScope,
      $or: [{ [`${prefix}requestId`]: plan.requestId }, { [`${prefix}planId`]: plan.planId }] }).limit(sources.length + 1), session)
    need(values.length === sources.length && values.every(value => sources.some(item => membershipHash(value) === item.ref[key])), 'DRAFT_RETRY_EXTRA_PROVIDER_HISTORY')
  }
}
const verifyProviderAudits = async (pairs, args, session) => {
  for (const pair of pairs) {
    const ids = pair.execution.auditLogIds
    need(Array.isArray(ids) && ids.length > 0 && ids.length <= 4 && new Set(ids.map(String)).size === ids.length, 'PROVIDER_AUDIT_INVALID')
    const audits = await query(model(args.deps || {}, 'AuditLog', Audit).find({ _id: { $in: ids.map(oid) } }).limit(5), session)
    need(audits.length === ids.length && audits.every(audit => signed(audit, args.deps || {})
      && audit.action === 'GOVERNED_REASONING_EXECUTED' && audit.resourceType === 'GovernedReasoningExecution'
      && String(audit.resourceId) === String(pair.execution._id) && String(audit.actorUserId) === p.actorUserId
      && String(audit.scope?.customerId) === p.customerId && String(audit.scope?.tenantId) === p.tenantId
      && audit.diff?.executionId === pair.execution.executionId && audit.diff?.runtimeInstanceId === args.runtimeInstanceId
      && audit.diff?.providerMode === 'LIVE_TEST' && audit.diff?.outputTypeKey === pair.execution.outputTypeKey
      && membershipHash(audit.diff?.artifactIds) === membershipHash(pair.execution.artifactIds)), 'PROVIDER_AUDIT_INVALID')
  }
}
const compositionSource = async (args, auth, expected, session = null, labels = false, wording = false, attribution = false, metadata = false, scoping = false, reference = false, holistic = false, descriptive = false, authorised = false) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'COMPOSITION_SCOPE_INVALID')
  if (!session) return transaction(args.deps || {}, active => compositionSource(args, auth, expected, active, labels, wording, attribution, metadata, scoping, reference, holistic, descriptive, authorised))
  const claim = await eventRead(authorised ? 'DESCRIPTIVE_REPAIR_CLAIM' : descriptive ? 'HOLISTIC_REPAIR_CLAIM' : holistic ? 'REFERENCE_REPAIR_CLAIM' : reference ? 'SCOPING_REPAIR_CLAIM' : scoping ? 'METADATA_REPAIR_CLAIM' : metadata ? 'ATTRIBUTION_REPAIR_CLAIM' : attribution ? 'WORDING_REPAIR_CLAIM' : wording ? 'LABEL_REPAIR_CLAIM' : labels ? 'ARL_TRANSPORT_CLAIM' : 'DRAFT_PERSISTENCE_CLAIM', args, session), result = await eventRead(authorised ? 'DESCRIPTIVE_REPAIR_RESULT' : descriptive ? 'HOLISTIC_REPAIR_RESULT' : holistic ? 'REFERENCE_REPAIR_RESULT' : reference ? 'SCOPING_REPAIR_RESULT' : scoping ? 'METADATA_REPAIR_RESULT' : metadata ? 'ATTRIBUTION_REPAIR_RESULT' : attribution ? 'WORDING_REPAIR_RESULT' : wording ? 'LABEL_REPAIR_RESULT' : labels ? 'ARL_TRANSPORT_RESULT' : 'DRAFT_PERSISTENCE_RESULT', args, session)
  assertEventPair(claim, result)
  need(claim.body.version === (authorised ? DESCRIPTIVE_VERSION : descriptive ? HOLISTIC_VERSION : holistic ? REFERENCE_VERSION : reference ? SCOPING_VERSION : scoping ? METADATA_VERSION : metadata ? ATTRIBUTION_VERSION : attribution ? WORDING_VERSION : wording ? LABEL_VERSION : labels ? TRANSPORT_VERSION : DRAFT_PERSISTENCE_VERSION) && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE'
    && result.body.failure.retryable === false && result.body.stageRefs.length === 3 && result.body.grrRefs.length === 3, 'COMPOSITION_SOURCE_INVALID')
  const parent = authorised ? await compositionSource(args, auth, claim.body.descriptiveRepair, session, true, true, true, true, true, true, true, true) : descriptive ? await compositionSource(args, auth, claim.body.holisticRepair, session, true, true, true, true, true, true, true) : holistic ? await compositionSource(args, auth, claim.body.referenceRepair, session, true, true, true, true, true, true) : reference ? await compositionSource(args, auth, claim.body.scopingRepair, session, true, true, true, true, true) : scoping ? await compositionSource(args, auth, claim.body.metadataRepair, session, true, true, true, true) : metadata ? await compositionSource(args, auth, claim.body.attributionRepair, session, true, true, true) : attribution ? await compositionSource(args, auth, claim.body.wordingRepair, session, true, true) : wording ? await compositionSource(args, auth, claim.body.labelRepair, session, true) : labels ? await transportSource(args, auth, claim.body.transportRecovery, session) : await draftPersistenceSource(args, auth, claim.body.draftPersistence, session)
  const stages = []
  for (const ref of result.body.stageRefs) {
    const { raw, stage } = await readRecordedStage(ref, args, claim.body.plan, session)
    await verifyRecordedStageAudit(raw, args, session)
    need(membershipHash(stageRef(stage)) === membershipHash(ref), 'COMPOSITION_STAGE_CHANGED')
    assertOrderedStage(stage, stages.at(-1), stages.length, parent)
    stages.push(stage)
  }
  const [guidance, draft, arl] = stages
  need(guidance.stageExecutionId === parent.guidance.stageExecutionId && draft.status === 'SUCCEEDED'
    && arl.status === 'FAILED' && arl.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', 'COMPOSITION_SOURCE_INVALID')
  const evidence = await collectGrr(claim, args, result.body.stageRefs, session, { source: parent, claim, args, session })
  need(membershipHash(evidence.refs) === membershipHash(result.body.grrRefs), 'COMPOSITION_PROVIDER_CHANGED')
  await verifyProviderAudits(evidence.output, args, session)
  if (labels) {
    const review = evidence.output.find(pair => pair.stageKey === 'ARL_MEANING_REVIEW')?.artifact.generatedOutput
    need(review?.overallStatus === 'FAIL' && Array.isArray(review.findings) && review.findings.length === 5
      && new Set(review.findings.map(row => row.dimension)).size === 5
      && ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].every(dimension => {
        const row = review.findings.find(item => item.dimension === dimension)
        const required = authorised ? row.requiredChange === true : descriptive ? ['PRIORITISATION', 'DECISION_USEFULNESS'].includes(dimension) : holistic ? ['COHERENCE', 'DECISION_USEFULNESS'].includes(dimension) : reference ? dimension === 'COHERENCE' : scoping ? dimension === 'EVIDENCE_USE' : metadata ? dimension === 'PRIORITISATION' : attribution ? dimension === 'COHERENCE' : wording ? ['PRIORITISATION', 'DECISION_USEFULNESS'].includes(dimension) : dimension === 'COHERENCE'
        return row?.status === (required ? 'FAIL' : 'PASS') && row.requiredChange === required
      }) && draft.outputSnapshot?.compositionVersion === (authorised ? 'evidence-bound-composition.v9' : descriptive ? 'evidence-bound-composition.v8' : holistic ? 'evidence-bound-composition.v7' : reference ? 'evidence-bound-composition.v6' : scoping ? 'evidence-bound-composition.v5' : metadata ? 'evidence-bound-composition.v4' : attribution ? 'evidence-bound-composition.v3' : wording ? 'evidence-bound-composition.v2' : 'evidence-bound-composition.v1')
      && arl.executionIdentity?.providerConfigurationVersion === OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION, 'LABEL_REPAIR_SOURCE_INVALID')
  }
  if (descriptive && !authorised) need(draft.attemptNumber === 11 && arl.attemptNumber === 10, 'DESCRIPTIVE_REPAIR_SOURCE_INVALID')
  if (authorised) {
    assertAuthorisedArlRequest(expected)
    need(draft.attemptNumber === 12 && arl.attemptNumber === 11
      && evidence.output.find(pair => pair.stageKey === 'ARL_MEANING_REVIEW')?.artifact.generatedOutput.findings.some(row => row.status === 'FAIL' && row.requiredChange), 'AUTHORISED_REVIEW_SOURCE_INVALID')
  }
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    guidanceStageExecutionId: guidance.stageExecutionId, guidanceMaterialHash: stageRef(guidance).materialHash,
    draftStageExecutionId: draft.stageExecutionId, draftMaterialHash: stageRef(draft).materialHash,
    failedArlStageExecutionId: arl.stageExecutionId, failedArlMaterialHash: stageRef(arl).materialHash }
  if (authorised) Object.assign(link, { approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256,
    discrepancyOutcome: 'DISCREPANCY', discrepancyPackSha256: AUTHORISED_ARL_APPROVAL.discrepancyPackSha256 })
  need(membershipHash(expected) === membershipHash(link), 'COMPOSITION_SOURCE_INVALID')
  return { ...parent, claim, result, link, guidance, failedDraft: draft, failedArl: arl, transportRecovery: false,
    ...(authorised ? { authorisedReview: true, draft, draftPair: evidence.output.find(pair => pair.stageKey === 'WORKING_DRAFT'), priorArlPair: evidence.output.find(pair => pair.stageKey === 'ARL_MEANING_REVIEW') } : {}),
    historyRefs: [...new Map([...parent.historyRefs, stageRef(draft), stageRef(arl)].map(ref => [ref.stageExecutionId, ref])).values()],
    priorProviderRefs: labels ? [...new Map([...parent.priorProviderRefs, ...evidence.refs].map(ref => [ref.executionId, ref])).values()] : evidence.refs,
    compositionRevision: { draftStageExecutionId: draft.stageExecutionId, draftOutputFingerprint: draft.outputFingerprint,
      arlStageExecutionId: arl.stageExecutionId, arlAttemptFingerprint: arl.attemptFingerprint } }
}
const transportSource = async (args, auth, expected, session = null) => {
  need(auth.version === SUCCESSOR_VERSION && args.runtimeInstanceId === successor.runtimeInstanceId, 'TRANSPORT_SCOPE_INVALID')
  if (!session) return transaction(args.deps || {}, active => transportSource(args, auth, expected, active))
  const claim = await eventRead('COMPOSITION_CLAIM', args, session), result = await eventRead('COMPOSITION_RESULT', args, session)
  assertEventPair(claim, result)
  need(claim.body.version === COMPOSITION_VERSION && membershipHash(claim.body.basis) === membershipHash(auth.basis)
    && result.body.status === 'FAILED' && result.body.failure?.failureCode === 'ARL_MEANING_REVIEW_PROVIDER_CONTEXT_OVERFLOW'
    && result.body.stageRefs.length === 3 && result.body.grrRefs.length === 2, 'TRANSPORT_SOURCE_INVALID')
  const parent = await compositionSource(args, auth, claim.body.compositionRevision, session), stages = []
  for (const ref of result.body.stageRefs) {
    const { raw, stage } = await readRecordedStage(ref, args, claim.body.plan, session)
    await verifyRecordedStageAudit(raw, args, session)
    assertOrderedStage(stage, stages.at(-1), stages.length, parent)
    need(membershipHash(stageRef(stage)) === membershipHash(ref), 'TRANSPORT_STAGE_CHANGED')
    stages.push(stage)
  }
  const [guidance, draft, arl] = stages
  need(isOutcomeArlTransportRecovery({ latest: arl, source: draft, configurationVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION }), 'TRANSPORT_SOURCE_INVALID')
  const evidence = await collectGrr(claim, args, result.body.stageRefs, session, { source: parent, claim, args, session })
  need(membershipHash(evidence.refs) === membershipHash(result.body.grrRefs), 'TRANSPORT_PROVIDER_CHANGED')
  await verifyProviderAudits(evidence.output, args, session)
  const link = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
    failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
    guidanceStageExecutionId: guidance.stageExecutionId, guidanceMaterialHash: stageRef(guidance).materialHash,
    draftStageExecutionId: draft.stageExecutionId, draftMaterialHash: stageRef(draft).materialHash,
    failedArlStageExecutionId: arl.stageExecutionId, failedArlMaterialHash: stageRef(arl).materialHash }
  need(membershipHash(expected) === membershipHash(link), 'TRANSPORT_SOURCE_INVALID')
  return { ...parent, claim, result, link, guidance, draft, failedArl: arl, transportRecovery: true,
    draftPair: evidence.output.find(pair => pair.stageKey === 'WORKING_DRAFT'),
    historyRefs: [...parent.historyRefs, stageRef(draft), stageRef(arl)],
    priorProviderRefs: [...new Map([...parent.priorProviderRefs, ...evidence.refs].map(ref => [ref.executionId, ref])).values()] }
}
const assertCompositionHistory = async (args, plan, source, session) => {
  const deps = args.deps || {}, nativeScope = scope(args.runtimeInstanceId)
  const rows = await query(model(deps, 'OutcomeQualityStageExecution', Stage).find({ ...nativeScope,
    $or: [{ requestId: plan.requestId }, { planId: plan.planId }] }).limit(source.historyRefs.length + 1), session)
  need(rows.length === source.historyRefs.length && rows.every(row => source.historyRefs.some(ref => membershipHash(stageRef(serializeOutcomeQualityStageExecution(row))) === membershipHash(ref))), 'COMPOSITION_EXTRA_STAGE_HISTORY')
  for (const [name, fallback, prefix, key] of [['GovernedReasoningExecution', Grr, 'executionEvidence.syntheticClassification.', 'executionHash'], ['GovernedRuntimeArtifact', Artifact, 'lineageSummary.syntheticClassification.', 'artifactHash']]) {
    const values = await query(model(deps, name, fallback).find({ ...nativeScope, $or: [{ [`${prefix}requestId`]: plan.requestId }, { [`${prefix}planId`]: plan.planId }] }).limit(source.priorProviderRefs.length + 1), session)
    need(values.length === source.priorProviderRefs.length && values.every(value => source.priorProviderRefs.some(ref => membershipHash(value) === ref[key])), 'COMPOSITION_EXTRA_PROVIDER_HISTORY')
  }
}
export const executeIsolatedSyntheticOutcome = async args => {
  const parsed = isolatedSyntheticExecuteSchema.safeParse(args.payload)
  need(parsed.success, 'REQUEST_INVALID', 422)
  args = { ...args, payload: parsed.data }
  const deps = args.deps || {}, auth = await authorize(args), plan = await readPlan(args, auth), payloadHash = membershipHash(args.payload)
  const runtimeDeps = args.providerRuntimeDeps || {}
  need(runtimeDeps.executionMode === 'LIVE_TEST' && runtimeDeps.providerDescriptor
    && ['frameworkGuidanceProviderAdapterFactory', 'workingDraftProviderAdapterFactory', 'arlMeaningReviewProviderAdapterFactory'].every(key => typeof runtimeDeps[key] === 'function'), 'PROVIDER_NOT_CONFIGURED', 503)
  await indexesReady(deps)
  if ([REVISION_VERSION, SUCCESSOR_VERSION].includes(auth.version)) await revisionIndexReady(deps, auth.basis.lineage.parentRuntimeInstanceId)
  const requestBinding = binding(plan)
  const authorisedReview = args.payload.authorisedReview
  const descriptiveRepair = args.payload.descriptiveRepair
  const holisticRepair = args.payload.holisticRepair
  const referenceRepair = args.payload.referenceRepair
  const scopingRepair = args.payload.scopingRepair
  const metadataRepair = args.payload.metadataRepair
  const attributionRepair = args.payload.attributionRepair
  const wordingRepair = args.payload.wordingRepair
  const labelRepair = args.payload.labelRepair
  const transportRecovery = args.payload.transportRecovery
  const compositionRevision = args.payload.compositionRevision
  const continuation = args.payload.continuation, recovery = args.payload.recovery, draftRetry = args.payload.draftRetry, draftRepair = args.payload.draftRepair, handoffRecovery = args.payload.handoffRecovery, draftPersistence = args.payload.draftPersistence
  const claimPhase = authorisedReview ? 'AUTHORISED_REVIEW_CLAIM' : descriptiveRepair ? 'DESCRIPTIVE_REPAIR_CLAIM' : holisticRepair ? 'HOLISTIC_REPAIR_CLAIM' : referenceRepair ? 'REFERENCE_REPAIR_CLAIM' : scopingRepair ? 'SCOPING_REPAIR_CLAIM' : metadataRepair ? 'METADATA_REPAIR_CLAIM' : attributionRepair ? 'ATTRIBUTION_REPAIR_CLAIM' : wordingRepair ? 'WORDING_REPAIR_CLAIM' : labelRepair ? 'LABEL_REPAIR_CLAIM' : transportRecovery ? 'ARL_TRANSPORT_CLAIM' : compositionRevision ? 'COMPOSITION_CLAIM' : draftPersistence ? 'DRAFT_PERSISTENCE_CLAIM' : handoffRecovery ? 'HANDOFF_CLAIM' : draftRepair ? 'DRAFT_REPAIR_CLAIM' : draftRetry ? 'DRAFT_RETRY_CLAIM' : recovery ? 'RECOVERY_CLAIM' : continuation ? 'CONTINUATION_CLAIM' : 'CLAIM'
  const resultPhase = authorisedReview ? 'AUTHORISED_REVIEW_RESULT' : descriptiveRepair ? 'DESCRIPTIVE_REPAIR_RESULT' : holisticRepair ? 'HOLISTIC_REPAIR_RESULT' : referenceRepair ? 'REFERENCE_REPAIR_RESULT' : scopingRepair ? 'SCOPING_REPAIR_RESULT' : metadataRepair ? 'METADATA_REPAIR_RESULT' : attributionRepair ? 'ATTRIBUTION_REPAIR_RESULT' : wordingRepair ? 'WORDING_REPAIR_RESULT' : labelRepair ? 'LABEL_REPAIR_RESULT' : transportRecovery ? 'ARL_TRANSPORT_RESULT' : compositionRevision ? 'COMPOSITION_RESULT' : draftPersistence ? 'DRAFT_PERSISTENCE_RESULT' : handoffRecovery ? 'HANDOFF_RESULT' : draftRepair ? 'DRAFT_REPAIR_RESULT' : draftRetry ? 'DRAFT_RETRY_RESULT' : recovery ? 'RECOVERY_RESULT' : continuation ? 'CONTINUATION_RESULT' : 'RESULT'
  const version = authorisedReview ? AUTHORISED_REVIEW_VERSION : descriptiveRepair ? DESCRIPTIVE_VERSION : holisticRepair ? HOLISTIC_VERSION : referenceRepair ? REFERENCE_VERSION : scopingRepair ? SCOPING_VERSION : metadataRepair ? METADATA_VERSION : attributionRepair ? ATTRIBUTION_VERSION : wordingRepair ? WORDING_VERSION : labelRepair ? LABEL_VERSION : transportRecovery ? TRANSPORT_VERSION : compositionRevision ? COMPOSITION_VERSION : draftPersistence ? DRAFT_PERSISTENCE_VERSION : handoffRecovery ? HANDOFF_VERSION : draftRepair ? DRAFT_REPAIR_VERSION : draftRetry ? DRAFT_RETRY_VERSION : recovery ? RECOVERY_VERSION : continuation ? CONTINUATION_VERSION : auth.version
  if (continuation) await continuationSource(args, auth, continuation)
  const savedSource = recovery ? await recoverySource(args, auth, recovery) : null
  const retrySource = authorisedReview ? await compositionSource(args, auth, authorisedReview, null, true, true, true, true, true, true, true, true, true) : descriptiveRepair ? await compositionSource(args, auth, descriptiveRepair, null, true, true, true, true, true, true, true, true) : holisticRepair ? await compositionSource(args, auth, holisticRepair, null, true, true, true, true, true, true, true) : referenceRepair ? await compositionSource(args, auth, referenceRepair, null, true, true, true, true, true, true) : scopingRepair ? await compositionSource(args, auth, scopingRepair, null, true, true, true, true, true) : metadataRepair ? await compositionSource(args, auth, metadataRepair, null, true, true, true, true) : attributionRepair ? await compositionSource(args, auth, attributionRepair, null, true, true, true) : wordingRepair ? await compositionSource(args, auth, wordingRepair, null, true, true) : labelRepair ? await compositionSource(args, auth, labelRepair, null, true) : transportRecovery ? await transportSource(args, auth, transportRecovery) : compositionRevision ? await compositionSource(args, auth, compositionRevision) : draftPersistence ? await draftPersistenceSource(args, auth, draftPersistence) : handoffRecovery ? await handoffSource(args, auth, handoffRecovery) : draftRepair ? await draftRetrySource(args, auth, draftRepair, null, true) : draftRetry ? await draftRetrySource(args, auth, draftRetry) : null
  let created = false, claim
  const claimTransaction = () => transaction(deps, async session => {
    created = false
    const currentAuth = await authorize(args, session), currentPlan = await readPlan(args, currentAuth, session)
    if ([REVISION_VERSION, SUCCESSOR_VERSION].includes(currentAuth.version)) await revisionIndexReady(deps, currentAuth.basis.lineage.parentRuntimeInstanceId)
    need(membershipHash(currentAuth.basis) === membershipHash(auth.basis)
      && String(currentPlan._id || currentPlan.id) === String(plan._id || plan.id), 'CLAIM_BASIS_CHANGED')
    const existing = await eventRead(claimPhase, args, session)
    if (existing) {
      need(existing.requestKey === args.payload.requestKey && existing.payloadHash === payloadHash, 'EXECUTION_ALREADY_CLAIMED')
      return existing
    }
    if (authorisedReview || descriptiveRepair || holisticRepair || referenceRepair || scopingRepair || metadataRepair || attributionRepair || wordingRepair || labelRepair || transportRecovery || compositionRevision || draftRetry || draftRepair || handoffRecovery || draftPersistence) {
      const source = authorisedReview ? await compositionSource(args, currentAuth, authorisedReview, session, true, true, true, true, true, true, true, true, true) : descriptiveRepair ? await compositionSource(args, currentAuth, descriptiveRepair, session, true, true, true, true, true, true, true, true) : holisticRepair ? await compositionSource(args, currentAuth, holisticRepair, session, true, true, true, true, true, true, true) : referenceRepair ? await compositionSource(args, currentAuth, referenceRepair, session, true, true, true, true, true, true) : scopingRepair ? await compositionSource(args, currentAuth, scopingRepair, session, true, true, true, true, true) : metadataRepair ? await compositionSource(args, currentAuth, metadataRepair, session, true, true, true, true) : attributionRepair ? await compositionSource(args, currentAuth, attributionRepair, session, true, true, true) : wordingRepair ? await compositionSource(args, currentAuth, wordingRepair, session, true, true) : labelRepair ? await compositionSource(args, currentAuth, labelRepair, session, true) : transportRecovery ? await transportSource(args, currentAuth, transportRecovery, session) : compositionRevision ? await compositionSource(args, currentAuth, compositionRevision, session) : draftPersistence ? await draftPersistenceSource(args, currentAuth, draftPersistence, session) : handoffRecovery ? await handoffSource(args, currentAuth, handoffRecovery, session) : await draftRetrySource(args, currentAuth, draftRepair || draftRetry, session, Boolean(draftRepair))
      need(membershipHash(source.claim.body.plan) === membershipHash({ recordId: String(plan._id || plan.id), requestId: plan.requestId,
        planId: plan.planId, planFingerprint: plan.planFingerprint })
        && membershipHash(source.claim.body.requestBinding) === membershipHash(requestBinding), 'DRAFT_RETRY_PLAN_CHANGED')
      await (authorisedReview || descriptiveRepair || holisticRepair || referenceRepair || scopingRepair || metadataRepair || attributionRepair || wordingRepair || labelRepair || transportRecovery || compositionRevision ? assertCompositionHistory : assertDraftRetryHistory)(args, plan, source, session)
    }
    if (recovery) {
      const source = await recoverySource(args, currentAuth, recovery, session)
      need(membershipHash(source.claim.body.plan) === membershipHash({ recordId: String(plan._id || plan.id), requestId: plan.requestId,
        planId: plan.planId, planFingerprint: plan.planFingerprint })
        && membershipHash(source.claim.body.requestBinding) === membershipHash(requestBinding), 'RECOVERY_PLAN_CHANGED')
      await assertRecoveryHistory(args, plan, source, session)
    }
    if (continuation) {
      const prior = await continuationSource(args, currentAuth, continuation, session)
      need(membershipHash(prior.claim.body.plan) === membershipHash({ recordId: String(plan._id || plan.id), requestId: plan.requestId,
        planId: plan.planId, planFingerprint: plan.planFingerprint })
        && membershipHash(prior.claim.body.requestBinding) === membershipHash(requestBinding), 'CONTINUATION_PLAN_CHANGED')
      await assertNoPriorExecution(args, plan, session)
    }
    const body = membershipJson({ version, ...(authorisedReview ? { authorisedReview, reviewApproval: { ...AUTHORISED_ARL_APPROVAL } } : descriptiveRepair ? { descriptiveRepair } : holisticRepair ? { holisticRepair } : referenceRepair ? { referenceRepair } : scopingRepair ? { scopingRepair } : metadataRepair ? { metadataRepair } : attributionRepair ? { attributionRepair } : wordingRepair ? { wordingRepair } : labelRepair ? { labelRepair } : transportRecovery ? { transportRecovery } : compositionRevision ? { compositionRevision } : draftPersistence ? { draftPersistence } : handoffRecovery ? { handoffRecovery } : draftRepair ? { draftRepair } : draftRetry ? { draftRetry } : recovery ? { recovery } : continuation ? { continuation } : {}), classification: auth.classification, eventId: randomUUID(), phase: claimPhase,
      requestKey: args.payload.requestKey, payloadHash, actorUserId: p.actorUserId, createdAt: new Date().toISOString(), basis: auth.basis,
      plan: { recordId: String(plan._id || plan.id), requestId: plan.requestId, planId: plan.planId, planFingerprint: plan.planFingerprint },
      requestBinding, claim: null, status: 'CLAIMED', stageRefs: [], grrRefs: [], failure: null })
    const saved = await writeEvent(body, args, session); created = true; return saved
  })
  try { claim = await claimTransaction() } catch (error) {
    if (error.code !== 11000) throw error
    claim = await eventRead(claimPhase, args)
    need(claim && claim.requestKey === args.payload.requestKey && claim.payloadHash === payloadHash, 'EXECUTION_ALREADY_CLAIMED')
    created = false
  }
  if (!created) return readIsolatedSyntheticOutcome(args)
  const stages = (authorisedReview || transportRecovery) ? [retrySource.guidance, retrySource.draft] : retrySource ? [retrySource.guidance] : [], identity = { actorUserId: args.actorUserId, auditRequest: args.auditRequest, scopes: args.scopes,
    runtimeInstanceId: args.runtimeInstanceId, planRecordId: String(plan._id || plan.id), expectedPlanFingerprint: plan.planFingerprint,
    requestBinding, providerDescriptor: runtimeDeps.providerDescriptor }
  const internalGrr = async input => createGovernedReasoningExecution({ ...input, deps: { ...input.deps, authorizeRuntime: async runtime => {
    need(String(runtime._id || runtime.id) === args.runtimeInstanceId, 'GRR_SCOPE_INVALID')
    const freshAuth = await authorize(args)
    const current = await eventRead(claimPhase, args)
    need(current?.eventId === claim.eventId && current.bodyHash === claim.bodyHash && !await eventRead(resultPhase, args), 'GRR_CLAIM_INVALID')
    need((authorisedReview ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === AUTHORISED_REVIEW_VERSION : descriptiveRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === DESCRIPTIVE_VERSION : holisticRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === HOLISTIC_VERSION : referenceRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === REFERENCE_VERSION : scopingRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === SCOPING_VERSION : metadataRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === METADATA_VERSION : attributionRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === ATTRIBUTION_VERSION : wordingRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === WORDING_VERSION : labelRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === LABEL_VERSION : transportRecovery ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === TRANSPORT_VERSION : compositionRevision ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === COMPOSITION_VERSION : draftPersistence ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === DRAFT_PERSISTENCE_VERSION : handoffRecovery ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === HANDOFF_VERSION : draftRepair ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === DRAFT_REPAIR_VERSION : draftRetry ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === DRAFT_RETRY_VERSION : recovery ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === RECOVERY_VERSION : continuation ? freshAuth.version === SUCCESSOR_VERSION && claim.body.version === CONTINUATION_VERSION : freshAuth.version === claim.body.version) && membershipHash(freshAuth.classification) === membershipHash(claim.body.classification)
      && membershipHash(freshAuth.basis) === membershipHash(claim.body.basis), 'CLAIM_BASIS_CHANGED')
    if (authorisedReview || descriptiveRepair || holisticRepair || referenceRepair || scopingRepair || metadataRepair || attributionRepair || wordingRepair || labelRepair || transportRecovery || compositionRevision || draftRetry || draftRepair || handoffRecovery || draftPersistence) {
      const source = authorisedReview ? await compositionSource(args, freshAuth, authorisedReview, null, true, true, true, true, true, true, true, true, true) : descriptiveRepair ? await compositionSource(args, freshAuth, descriptiveRepair, null, true, true, true, true, true, true, true, true) : holisticRepair ? await compositionSource(args, freshAuth, holisticRepair, null, true, true, true, true, true, true, true) : referenceRepair ? await compositionSource(args, freshAuth, referenceRepair, null, true, true, true, true, true, true) : scopingRepair ? await compositionSource(args, freshAuth, scopingRepair, null, true, true, true, true, true) : metadataRepair ? await compositionSource(args, freshAuth, metadataRepair, null, true, true, true, true) : attributionRepair ? await compositionSource(args, freshAuth, attributionRepair, null, true, true, true) : wordingRepair ? await compositionSource(args, freshAuth, wordingRepair, null, true, true) : labelRepair ? await compositionSource(args, freshAuth, labelRepair, null, true) : transportRecovery ? await transportSource(args, freshAuth, transportRecovery) : compositionRevision ? await compositionSource(args, freshAuth, compositionRevision) : draftPersistence ? await draftPersistenceSource(args, freshAuth, draftPersistence) : handoffRecovery ? await handoffSource(args, freshAuth, handoffRecovery) : await draftRetrySource(args, freshAuth, draftRepair || draftRetry, null, Boolean(draftRepair))
      if (authorisedReview || transportRecovery || stages.length === 1) await (authorisedReview || descriptiveRepair || holisticRepair || referenceRepair || scopingRepair || metadataRepair || attributionRepair || wordingRepair || labelRepair || transportRecovery || compositionRevision ? assertCompositionHistory : assertDraftRetryHistory)(args, plan, source)
    }
    return runClassification(claim)
  } } })
  let status = 'UNKNOWN', failure = null
  try {
    for (const [owner, adapter, factory] of [
      [deps.executeFrameworkGuidance || executeOutcomeFrameworkGuidance, 'providerAdapterFactory', runtimeDeps.frameworkGuidanceProviderAdapterFactory],
      [deps.executeWorkingDraft || executeOutcomeWorkingDraft, 'providerAdapter', runtimeDeps.workingDraftProviderAdapterFactory],
      [deps.approveWorkingDraftMeaning || approveOutcomeWorkingDraftMeaning, 'providerAdapter', runtimeDeps.arlMeaningReviewProviderAdapterFactory],
    ].slice(authorisedReview || transportRecovery ? 2 : retrySource ? 1 : 0)) {
      const reuseFramework = recovery && stages.length === 0
      const reuseDraft = draftPersistence && stages.length === 1
      const reuseGrr = async () => {
        const freshAuth = await authorize(args)
        if (reuseDraft) {
          const source = await draftPersistenceSource(args, freshAuth, draftPersistence), current = await eventRead(claimPhase, args)
          need(current?.eventId === claim.eventId && current.bodyHash === claim.bodyHash
            && membershipHash(freshAuth.basis) === membershipHash(claim.body.basis)
            && membershipHash(source.link) === membershipHash(retrySource.link) && !await eventRead(resultPhase, args), 'DRAFT_PERSISTENCE_SOURCE_CHANGED')
          await assertDraftRetryHistory(args, plan, source)
          const { execution, artifact } = source.draftSaved.pair
          need(execution.provider.providerKey === runtimeDeps.providerDescriptor.providerKey && execution.provider.model === runtimeDeps.providerDescriptor.model, 'RECOVERY_PROVIDER_IDENTITY_CHANGED')
          return { executionId: execution.executionId, provider: execution.provider, requestedAt: execution.requestedAt, completedAt: execution.completedAt, artifact }
        }
        const source = await recoverySource(args, freshAuth, recovery)
        need(membershipHash(source.ref) === membershipHash(savedSource.ref) && !await eventRead(resultPhase, args), 'RECOVERY_SOURCE_CHANGED')
        const execution = source.pair.execution
        need(execution.provider.providerKey === runtimeDeps.providerDescriptor.providerKey && execution.provider.model === runtimeDeps.providerDescriptor.model,
          'RECOVERY_PROVIDER_IDENTITY_CHANGED')
        return { executionId: execution.executionId, provider: execution.provider, requestedAt: execution.requestedAt,
          completedAt: execution.completedAt, artifact: source.pair.artifact }
      }
      const result = await owner({ ...identity, ...(authorisedReview ? { authorisedReview: { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash } } : {}), ...((authorisedReview || descriptiveRepair || holisticRepair || referenceRepair || scopingRepair || metadataRepair || attributionRepair || wordingRepair || labelRepair || compositionRevision) && stages.length === 1 ? { compositionRevision: retrySource.compositionRevision } : {}), [adapter]: adapter === 'providerAdapterFactory' ? factory : factory(),
        deps: { createGovernedReasoningExecution: reuseFramework || reuseDraft ? reuseGrr : internalGrr } })
      assertReturnedStage(result?.stage, plan, requestBinding, args.runtimeInstanceId)
      assertOrderedStage(result.stage, stages.at(-1), stages.length, retrySource)
      stages.push(result.stage)
      if (result.stage.status !== 'SUCCEEDED') { status = 'FAILED'; failure = result.stage.failure || { failureCode: 'STAGE_FAILED' }; break }
    }
    if (stages.length === 3 && stages.every(stage => stage.status === 'SUCCEEDED')) status = 'ARL_PASSED'
  } catch (error) { failure = failureDetails(error) }
  const stageRefs = stages.map(stageRef), grrEvidence = await collectGrr(claim, args, stageRefs)
  const body = membershipJson({ ...claim.body, eventId: randomUUID(), phase: resultPhase, createdAt: new Date().toISOString(),
    claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status, stageRefs, grrRefs: grrEvidence.refs, failure })
  await transaction(deps, async session => {
    const existing = await eventRead(resultPhase, args, session)
    need(!existing, 'RESULT_ALREADY_RECORDED')
    await writeEvent(body, args, session)
  })
  return readIsolatedSyntheticOutcome(args)
}
export const readIsolatedSyntheticOutcome = async args => {
  const auth = await authorize(args), deps = args.deps || {}
  const authorisedClaim = await eventRead('AUTHORISED_REVIEW_CLAIM', args), authorisedResult = await eventRead('AUTHORISED_REVIEW_RESULT', args)
  need(authorisedClaim || !authorisedResult, 'ORPHAN_RESULT')
  const descriptiveClaim = await eventRead('DESCRIPTIVE_REPAIR_CLAIM', args), descriptiveResult = await eventRead('DESCRIPTIVE_REPAIR_RESULT', args)
  need(descriptiveClaim || !descriptiveResult, 'ORPHAN_RESULT')
  const holisticClaim = await eventRead('HOLISTIC_REPAIR_CLAIM', args), holisticResult = await eventRead('HOLISTIC_REPAIR_RESULT', args)
  need(holisticClaim || !holisticResult, 'ORPHAN_RESULT')
  const referenceClaim = await eventRead('REFERENCE_REPAIR_CLAIM', args), referenceResult = await eventRead('REFERENCE_REPAIR_RESULT', args)
  need(referenceClaim || !referenceResult, 'ORPHAN_RESULT')
  const scopingClaim = await eventRead('SCOPING_REPAIR_CLAIM', args), scopingResult = await eventRead('SCOPING_REPAIR_RESULT', args)
  need(scopingClaim || !scopingResult, 'ORPHAN_RESULT')
  const metadataClaim = await eventRead('METADATA_REPAIR_CLAIM', args), metadataResult = await eventRead('METADATA_REPAIR_RESULT', args)
  need(metadataClaim || !metadataResult, 'ORPHAN_RESULT')
  const attributionClaim = await eventRead('ATTRIBUTION_REPAIR_CLAIM', args), attributionResult = await eventRead('ATTRIBUTION_REPAIR_RESULT', args)
  need(attributionClaim || !attributionResult, 'ORPHAN_RESULT')
  const wordingClaim = await eventRead('WORDING_REPAIR_CLAIM', args), wordingResult = await eventRead('WORDING_REPAIR_RESULT', args)
  need(wordingClaim || !wordingResult, 'ORPHAN_RESULT')
  const labelClaim = await eventRead('LABEL_REPAIR_CLAIM', args), labelResult = await eventRead('LABEL_REPAIR_RESULT', args)
  need(labelClaim || !labelResult, 'ORPHAN_RESULT')
  const transportClaim = await eventRead('ARL_TRANSPORT_CLAIM', args), transportResult = await eventRead('ARL_TRANSPORT_RESULT', args)
  need(transportClaim || !transportResult, 'ORPHAN_RESULT')
  const compositionClaim = await eventRead('COMPOSITION_CLAIM', args), compositionResult = await eventRead('COMPOSITION_RESULT', args)
  need(compositionClaim || !compositionResult, 'ORPHAN_RESULT')
  const persistenceClaim = await eventRead('DRAFT_PERSISTENCE_CLAIM', args), persistenceResult = await eventRead('DRAFT_PERSISTENCE_RESULT', args)
  need(persistenceClaim || !persistenceResult, 'ORPHAN_RESULT')
  const handoffClaim = await eventRead('HANDOFF_CLAIM', args), handoffResult = await eventRead('HANDOFF_RESULT', args)
  need(handoffClaim || !handoffResult, 'ORPHAN_RESULT')
  const repairClaim = await eventRead('DRAFT_REPAIR_CLAIM', args), repairResult = await eventRead('DRAFT_REPAIR_RESULT', args)
  need(repairClaim || !repairResult, 'ORPHAN_RESULT')
  const retryClaim = await eventRead('DRAFT_RETRY_CLAIM', args), retryResult = await eventRead('DRAFT_RETRY_RESULT', args)
  need(retryClaim || !retryResult, 'ORPHAN_RESULT')
  const recoveryClaim = await eventRead('RECOVERY_CLAIM', args), recoveryResult = await eventRead('RECOVERY_RESULT', args)
  need(recoveryClaim || !recoveryResult, 'ORPHAN_RESULT')
  const continuationClaim = await eventRead('CONTINUATION_CLAIM', args)
  const continuationResult = await eventRead('CONTINUATION_RESULT', args)
  need(continuationClaim || !continuationResult, 'ORPHAN_RESULT')
  let priorRuns = []
  if (continuationClaim) {
    const source = await continuationSource(args, auth, continuationClaim.body.continuation)
    need(membershipHash(source.claim.body.plan) === membershipHash(continuationClaim.body.plan)
      && membershipHash(source.claim.body.requestBinding) === membershipHash(continuationClaim.body.requestBinding), 'CONTINUATION_PLAN_CHANGED')
    priorRuns = [{ status: source.result.body.status, claimEventId: source.claim.eventId, claimBodyHash: source.claim.bodyHash,
      resultEventId: source.result.eventId, resultBodyHash: source.result.bodyHash, failure: source.result.body.failure }]
  }
  if (recoveryClaim) {
    const source = await recoverySource(args, auth, recoveryClaim.body.recovery)
    need(membershipHash(source.claim.body.plan) === membershipHash(recoveryClaim.body.plan)
      && membershipHash(source.claim.body.requestBinding) === membershipHash(recoveryClaim.body.requestBinding), 'RECOVERY_PLAN_CHANGED')
    priorRuns.push({ status: source.result.body.status, claimEventId: source.claim.eventId, claimBodyHash: source.claim.bodyHash,
      resultEventId: source.result.eventId, resultBodyHash: source.result.bodyHash, failure: source.result.body.failure })
  }
  let retrySource = null
  if (retryClaim) {
    retrySource = await draftRetrySource(args, auth, retryClaim.body.draftRetry)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(retryClaim.body.plan)
      && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(retryClaim.body.requestBinding), 'DRAFT_RETRY_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash,
      resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (repairClaim) {
    retrySource = await draftRetrySource(args, auth, repairClaim.body.draftRepair, null, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(repairClaim.body.plan)
      && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(repairClaim.body.requestBinding), 'DRAFT_RETRY_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash,
      resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (handoffClaim) {
    retrySource = await handoffSource(args, auth, handoffClaim.body.handoffRecovery)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(handoffClaim.body.plan)
      && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(handoffClaim.body.requestBinding), 'DRAFT_RETRY_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash,
      resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (persistenceClaim) {
    retrySource = await draftPersistenceSource(args, auth, persistenceClaim.body.draftPersistence)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(persistenceClaim.body.plan)
      && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(persistenceClaim.body.requestBinding), 'DRAFT_RETRY_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash,
      resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (compositionClaim) {
    retrySource = await compositionSource(args, auth, compositionClaim.body.compositionRevision)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(compositionClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(compositionClaim.body.requestBinding), 'COMPOSITION_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (transportClaim) {
    retrySource = await transportSource(args, auth, transportClaim.body.transportRecovery)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(transportClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(transportClaim.body.requestBinding), 'TRANSPORT_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (labelClaim) {
    retrySource = await compositionSource(args, auth, labelClaim.body.labelRepair, null, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(labelClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(labelClaim.body.requestBinding), 'LABEL_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (wordingClaim) {
    retrySource = await compositionSource(args, auth, wordingClaim.body.wordingRepair, null, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(wordingClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(wordingClaim.body.requestBinding), 'WORDING_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (attributionClaim) {
    retrySource = await compositionSource(args, auth, attributionClaim.body.attributionRepair, null, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(attributionClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(attributionClaim.body.requestBinding), 'ATTRIBUTION_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (metadataClaim) {
    retrySource = await compositionSource(args, auth, metadataClaim.body.metadataRepair, null, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(metadataClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(metadataClaim.body.requestBinding), 'METADATA_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (scopingClaim) {
    retrySource = await compositionSource(args, auth, scopingClaim.body.scopingRepair, null, true, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(scopingClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(scopingClaim.body.requestBinding), 'SCOPING_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (referenceClaim) {
    retrySource = await compositionSource(args, auth, referenceClaim.body.referenceRepair, null, true, true, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(referenceClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(referenceClaim.body.requestBinding), 'REFERENCE_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (holisticClaim) {
    retrySource = await compositionSource(args, auth, holisticClaim.body.holisticRepair, null, true, true, true, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(holisticClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(holisticClaim.body.requestBinding), 'HOLISTIC_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (descriptiveClaim) {
    retrySource = await compositionSource(args, auth, descriptiveClaim.body.descriptiveRepair, null, true, true, true, true, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(descriptiveClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(descriptiveClaim.body.requestBinding), 'DESCRIPTIVE_REPAIR_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  if (authorisedClaim) {
    retrySource = await compositionSource(args, auth, authorisedClaim.body.authorisedReview, null, true, true, true, true, true, true, true, true, true)
    need(membershipHash(retrySource.claim.body.plan) === membershipHash(authorisedClaim.body.plan) && membershipHash(retrySource.claim.body.requestBinding) === membershipHash(authorisedClaim.body.requestBinding), 'AUTHORISED_REVIEW_PLAN_CHANGED')
    priorRuns.push({ status: retrySource.result.body.status, claimEventId: retrySource.claim.eventId, claimBodyHash: retrySource.claim.bodyHash, resultEventId: retrySource.result.eventId, resultBodyHash: retrySource.result.bodyHash, failure: retrySource.result.body.failure })
  }
  const claim = authorisedClaim || descriptiveClaim || holisticClaim || referenceClaim || scopingClaim || metadataClaim || attributionClaim || wordingClaim || labelClaim || transportClaim || compositionClaim || persistenceClaim || handoffClaim || repairClaim || retryClaim || recoveryClaim || continuationClaim || await eventRead('CLAIM', args)
  const result = authorisedClaim ? authorisedResult : descriptiveClaim ? descriptiveResult : holisticClaim ? holisticResult : referenceClaim ? referenceResult : scopingClaim ? scopingResult : metadataClaim ? metadataResult : attributionClaim ? attributionResult : wordingClaim ? wordingResult : labelClaim ? labelResult : transportClaim ? transportResult : compositionClaim ? compositionResult : persistenceClaim ? persistenceResult : handoffClaim ? handoffResult : repairClaim ? repairResult : retryClaim ? retryResult : recoveryClaim ? recoveryResult : continuationClaim ? continuationResult : await eventRead('RESULT', args)
  if (!claim) { need(!result, 'ORPHAN_RESULT'); return readEnvelope(args, auth, { basis: auth.basis, run: { status: 'NOT_STARTED' }, stages: [], grr: [] }) }
  need(membershipHash(claim.body.basis) === membershipHash(auth.basis), 'CLAIM_BASIS_CHANGED')
  if (!result) {
    const evidence = await collectGrr(claim, args, [])
    return readEnvelope(args, auth, { basis: auth.basis, priorRuns, run: { status: 'UNKNOWN', claimEventId: claim.eventId, grrRefs: evidence.refs,
      terminalReceiptAvailable: false }, stages: [], grr: evidence.output })
  }
  assertEventPair(claim, result)
  const stages = []
  if (claim.body.authorisedReview && result.body.failure?.details?.authorisedReview) {
    need(result.body.status === 'UNKNOWN' && !result.body.stageRefs.some(row => row.stageKey === 'ARL_MEANING_REVIEW'), 'AUTHORISED_REVIEW_OBSERVATION_INVALID')
    assertStoredAuthorisedArlReview({ claim, receipt: result.body.failure.details.authorisedReview,
      priorResponseId: retrySource.priorArlPair.artifact.safeJson.metadata.responseId })
  }
  for (const ref of result.body.stageRefs) {
    const { stage } = await readRecordedStage(ref, args, claim.body.plan)
    assertReturnedStage(stage, claim.body.plan, claim.body.requestBinding, args.runtimeInstanceId)
    assertOrderedStage(stage, stages.at(-1), stages.length, retrySource)
    need(membershipHash(stageRef(stage)) === membershipHash(ref), 'STAGE_MATERIAL_CHANGED')
    stages.push(stage)
  }
  const evidence = await collectGrr(claim, args, result.body.stageRefs)
  need(membershipHash(evidence.refs) === membershipHash(result.body.grrRefs), 'GRR_MATERIAL_CHANGED')
  return readEnvelope(args, auth, { basis: auth.basis, priorRuns, run: { status: result.body.status, claimEventId: claim.eventId, resultEventId: result.eventId,
    stageRefs: result.body.stageRefs, grrRefs: result.body.grrRefs, failure: result.body.failure }, stages, grr: evidence.output })
}

// Narrow internal facade shared by the independently classified downstream route.
// It retains the existing native permission, snapshot, signature and transaction owners.
export const isolatedSyntheticOutcomeInternals = Object.freeze({ authorize, readPlan, binding, indexesReady,
  revisionIndexReady, eventRead, writeEvent, transaction, scope, query, model, signed, stageRef,
  readRecordedStage, verifyRecordedStageAudit, assertReturnedStage, assertEventPair, failureDetails, runClassification })
