import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Event from '../models/SyntheticOutcomeRunEvent.js'
import Audit from '../models/AuditLog.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Grr from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import { buildSuccess, ids as stageIds } from './fixtures/outcomeQualityStageFixtures.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import { resolveOutcomeAudienceRequest } from '../services/outcomeAudienceRequestResolutionService.js'
import { resolveOutcomeCompositionRequest } from '../services/outcomeCompositionRequestResolutionService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { SNAPSHOT_RECOVERY_POLICY as p } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import auditService from '../services/auditService.js'
import { executeIsolatedSyntheticOutcome, readIsolatedSyntheticOutcome } from '../services/isolatedSyntheticOutcomeService.js'
import { completeIsolatedSyntheticOutcome, readLatestIsolatedSyntheticOutcome } from '../services/isolatedSyntheticOutcomeCompletionService.js'
import { buildDirectSyntheticRevisionLineage, buildSuccessorSyntheticRevisionLineage, SYNTHETIC_SUCCESSOR_IDENTITY as successor } from '../services/syntheticOutcomeIsolationService.js'
import { AUTHORISED_ARL_APPROVAL, AUTHORISED_ARL_SCOPE, AUTHORISED_ARL_BODY, verifyNativeAuthorisedArlReview,
  observeAuthorisedArlResponse, readAuthorisedArlProof } from '../services/outcomeArlTransportRecoveryService.js'

// Real journal transactions/indexes/signatures. Native selection, plan and stage
// owners are explicit component seams; these tests do not claim live ARL proof.
const database = process.env.VMF_SYNTHETIC_OUTCOME_ISOLATED_DB
const run = database ? describe : describe.skip
run('isolated synthetic journal real persistence', () => {
  let owned = false, payload, runtime, frozen, plan, deps, providerRuntimeDeps, stages, providers, revisionRoot
  const guarded = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database)
      || !['runtime_synthetic_outcome_run_events', 'auditlogs', RuntimeInstance.collection.name, Stage.collection.name, Grr.collection.name, Artifact.collection.name].includes(name)) throw new Error('Isolated ownership required')
    return mongoose.connection.db.collection(name)
  }
  const args = () => ({ actorUserId: p.actorUserId, runtimeInstanceId: String(runtime._id),
    scopes: { customer: { _id: p.customerId }, tenant: { _id: p.tenantId } }, payload,
    auditRequest: { requestId: 'isolated-journal-' + randomUUID() }, providerRuntimeDeps, deps })
  const eventCount = () => Event.countDocuments({})
  const auditCount = () => Audit.countDocuments({})
  beforeAll(async () => {
    if (!/^ss044_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 3, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    await Event.createCollection(); await Event.createIndexes(); await Audit.createCollection()
    await RuntimeInstance.createCollection()
    for (const owner of [Stage, Grr, Artifact]) await mongoose.connection.db.createCollection(owner.collection.name)
    await guarded(RuntimeInstance.collection.name).createIndex({ customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 },
      { unique: true, partialFilterExpression: { 'revision.parentRuntimeId': { $type: 'objectId' } } })
  }, 30000)
  beforeEach(async () => {
    await guarded(Event.collection.name).deleteMany({}); await guarded(Audit.collection.name).deleteMany({})
    await guarded(RuntimeInstance.collection.name).deleteMany({})
    for (const owner of [Stage, Grr, Artifact]) await guarded(owner.collection.name).deleteMany({})
    payload = { requestKey: randomUUID(), requestId: randomUUID(), planId: `outcome_kcp_${randomUUID()}`, expectedPlanFingerprint: 'a'.repeat(64) }
    runtime = { _id: p.runtimeInstanceId, customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceKey: p.runtimeInstanceKey,
      runtimeType: 'VALUE_NARRATIVE', revision: { revisionNumber: 1 }, status: 'LOCKED', stateVersion: p.stateVersion,
      framework_state: { lock: { locked: true } } }
    frozen = { available: true, completeness: 'VERIFIED', snapshotId: p.snapshotId, membershipHash: p.membershipHash,
      basisStateVersion: p.stateVersion, lockSnapshotId: 'isolated-original-lock', lockSnapshotHash: 'b'.repeat(64),
      counts: { sources: 8, evidence: 47, sections: 6 }, serializationCorrection: { receiptId: randomUUID(), bodyHash: 'c'.repeat(64) } }
    const basis = { snapshotId: frozen.snapshotId, membershipHash: frozen.membershipHash, basisStateVersion: frozen.basisStateVersion,
      lockSnapshotId: frozen.lockSnapshotId, lockSnapshotHash: frozen.lockSnapshotHash, counts: frozen.counts,
      correctionReceiptId: frozen.serializationCorrection.receiptId, correctionBodyHash: frozen.serializationCorrection.bodyHash }
    plan = { _id: new mongoose.Types.ObjectId(), customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId,
      requestId: payload.requestId, planId: payload.planId, planFingerprint: payload.expectedPlanFingerprint,
      payload: { requestId: payload.requestId, requestAssociation: { sessionId: '', basis,
        classification: { classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', customerId: p.customerId,
          tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId, authoritative: false } } } }
    stages = new Map(); providers = new Map()
    const owner = (key, index) => jest.fn(async input => {
      const value = { stageExecutionId: 'isolated-stage-' + index, stageKey: key, stageOrder: index, attemptNumber: 1,
        runtimeInstanceId: String(runtime._id), customerId: p.customerId, tenantId: p.tenantId,
        planId: plan.planId, planFingerprint: plan.planFingerprint, ...input.requestBinding, status: 'SUCCEEDED',
        inputFingerprint: String(index).repeat(64), outputFingerprint: 'e'.repeat(64), attemptFingerprint: 'f'.repeat(64),
        predecessorStageExecutionId: index === 1 ? '' : 'isolated-stage-' + (index - 1),
        predecessorAttemptFingerprint: index === 1 ? '' : 'f'.repeat(64),
        inputSnapshot: index === 1 ? {} : { sourceStage: { stageExecutionId: 'isolated-stage-' + (index - 1),
          attemptFingerprint: 'f'.repeat(64), outputFingerprint: 'e'.repeat(64) } },
        executionIdentity: { executionMode: 'LIVE_TEST', grrExecutionId: 'sim-execution-' + index, grrRuntimeArtifactId: 'sim-artifact-' + index },
        startedAt: '2026-10-16T19:30:00Z', completedAt: '2026-10-16T19:30:01Z',
        createdAt: '2026-10-16T19:30:01Z', outputSnapshot: { synthetic: true } }
      stages.set(value.stageExecutionId, value)
      const outputTypeKey = index === 1 ? 'FRAMEWORK_GUIDANCE_ANALYSIS' : key
      const common = { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: String(runtime._id),
        executionId: value.executionIdentity.grrExecutionId, outputTypeKey }
      providers.set(index, { execution: { ...common, artifactIds: [value.executionIdentity.grrRuntimeArtifactId], executionEvidence: {} },
        artifact: { ...common, runtimeArtifactId: value.executionIdentity.grrRuntimeArtifactId,
          artifactType: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', lineageSummary: {}, generatedOutput: { synthetic: true } } })
      return { stage: value, idempotent: false }
    })
    deps = { env: { nodeEnv: 'test', appEnv: 'development' }, getRuntimeInstance: async () => runtime,
      assertRuntimePermission: jest.fn(async () => true), readVerifiedBasis: async () => frozen,
      readPlan: async () => plan, assertPlanIntegrity: () => plan, assertPlanMatchesRuntime: () => plan,
      executeFrameworkGuidance: owner('FRAMEWORK_GUIDANCE', 1), executeWorkingDraft: owner('WORKING_DRAFT', 2),
      approveWorkingDraftMeaning: owner('ARL_MEANING_REVIEW', 3), readStage: async ref => stages.get(ref.stageExecutionId),
      assertStageIntegrity: () => true, collectGrrEvidence: async ({ claim }) => {
        const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash,
          requestId: claim.body.plan.requestId, planId: claim.body.plan.planId, planFingerprint: claim.body.plan.planFingerprint,
          draftId: claim.body.requestBinding.draftId, draftIterationId: claim.body.requestBinding.draftIterationId }
        for (const pair of providers.values()) {
          pair.execution.executionEvidence.syntheticClassification ||= JSON.parse(JSON.stringify(cls))
          pair.artifact.lineageSummary.syntheticClassification ||= JSON.parse(JSON.stringify(cls))
        }
        return [...providers.values()].filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === claim.eventId)
      } }
    providerRuntimeDeps = { executionMode: 'LIVE_TEST', providerDescriptor: { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST',
      environment: 'TEST', safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1', failurePosture: 'FAIL_CLOSED' },
      frameworkGuidanceProviderAdapterFactory: () => async () => {}, workingDraftProviderAdapterFactory: () => async () => {},
      arlMeaningReviewProviderAdapterFactory: () => async () => {} }
  })
  const configureDirectRevision = async (successorParent = false) => {
    const parent = JSON.parse(JSON.stringify(runtime)), parentFrozen = JSON.parse(JSON.stringify(frozen))
    parent.updatedAt = '2026-10-18T11:00:00.000Z'; parent.lockedAt = parent.updatedAt; parent.lockedBy = p.actorUserId
    stages.clear(); providers.clear()
    Object.assign(parent, { workspaceId: '', frameworkKey: 'value-narrative', packageId: '6aa923ac50c4a5b07e60b716',
      packageKey: 'vmf', packageVersion: '3.2.0', dependencyLockId: 'dependency-1', activationId: 'activation-1', deploymentId: 'deployment-1' })
    parent.framework_state = { lifecycle: { stage: 'LOCKED' }, publish: { state: 'PUBLISHED', published: true,
      snapshot: { snapshotId: 'parent-publish', snapshotHash: '1'.repeat(64) } }, lock: { locked: true,
      snapshot: { snapshotId: parentFrozen.lockSnapshotId, snapshotHash: parentFrozen.lockSnapshotHash },
      replayAnchor: { replayAnchorId: 'parent-replay', replayAnchorHash: '2'.repeat(64) } } }
    const pointer = value => Object.fromEntries(['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash']
      .map(key => [key, value[key]]))
    parent.lockedEvidenceSnapshot = pointer(parentFrozen)
    Object.assign(runtime, JSON.parse(JSON.stringify(parent)), { _id: '6ace5ee09bd4472c6be0cb08', runtimeInstanceKey: 'synthetic-direct-r2', stateVersion: `rsv2:${randomUUID()}`,
      revision: { revisionNumber: 2, createdFromRevision: 1, parentRuntimeId: p.runtimeInstanceId, rootRuntimeId: p.runtimeInstanceId,
        parentRuntimeInstanceKey: p.runtimeInstanceKey, rootRuntimeInstanceKey: p.runtimeInstanceKey,
        derivedFromPublishSnapshotId: 'parent-publish', derivedFromPublishSnapshotHash: '1'.repeat(64),
        derivedFromLockSnapshotId: parentFrozen.lockSnapshotId, derivedFromLockSnapshotHash: parentFrozen.lockSnapshotHash,
        derivedFromReplayAnchorId: 'parent-replay', derivedFromReplayAnchorHash: '2'.repeat(64) } })
    delete frozen.serializationCorrection
    Object.assign(frozen, { snapshotId: `evidence_snapshot_${randomUUID()}`, membershipHash: '4'.repeat(64), basisStateVersion: runtime.stateVersion,
      lockSnapshotId: 'own-r2-lock', lockSnapshotHash: '5'.repeat(64), counts: { sources: 9, evidence: 49, sections: 6 }, revisionNumber: 2 })
    if (successorParent) {
      Object.assign(runtime, { _id: successor.parentRuntimeInstanceId, runtimeInstanceKey: successor.parentRuntimeInstanceKey, stateVersion: successor.parentStateVersion })
      Object.assign(frozen, { snapshotId: successor.parentSnapshotId, membershipHash: successor.parentMembershipHash,
        basisStateVersion: successor.parentStateVersion, lockSnapshotId: successor.parentLockSnapshotId,
        lockSnapshotHash: successor.parentLockSnapshotHash, counts: { sources: 8, evidence: 47, sections: 6 } })
    }
    runtime.lockedEvidenceSnapshot = pointer(frozen)
    runtime.framework_state.lock.snapshot = { snapshotId: frozen.lockSnapshotId, snapshotHash: frozen.lockSnapshotHash }
    const parentBasis = { ...pointer(parentFrozen), counts: { ...parentFrozen.counts },
      correctionReceiptId: parentFrozen.serializationCorrection.receiptId, correctionBodyHash: parentFrozen.serializationCorrection.bodyHash }
    plan.runtimeInstanceId = runtime._id
    plan.payload.planningEvidence = { contractVersion: 'outcome-planning-evidence.v1' }
    deps.readPlanningEvidence = async () => ({ ...runtime, planningEvidence: { contractVersion: 'outcome-planning-evidence.v1' } })
    plan.payload.requestAssociation.classification.runtimeInstanceId = runtime._id
    plan.payload.requestAssociation.basis = { ...pointer(frozen), counts: { ...frozen.counts },
      lineage: buildDirectSyntheticRevisionLineage({ runtime, parentRuntime: parent, parentBasis }) }
    deps.getRuntimeInstance = async input => {
      const selected = input.runtimeInstanceId === p.runtimeInstanceId ? parent : runtime
      return input.projection ? { __evidenceSnapshotControl: { runtime: selected, pointer: selected.lockedEvidenceSnapshot } } : selected
    }
    const lockAudit = new Audit({ actorUserId: p.actorUserId, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
      resourceId: runtime._id, scope: { customerId: p.customerId, tenantId: p.tenantId,
        runtimeInstanceId: runtime._id, runtimeInstanceKey: runtime.runtimeInstanceKey },
      diff: { actionKey: 'LOCK_RECORD', actionedAt: runtime.lockedAt } })
    lockAudit.generateSignature()
    await guarded(Audit.collection.name).insertOne(lockAudit.toObject())
    deps.readVerifiedBasis = async input => {
      if (String(input.runtime._id) === p.runtimeInstanceId) return parentFrozen
      await input.deps.readAudit(lockAudit._id, { session: input.session, readBudget: input.readBudget })
      return frozen
    }
    // Real scoped child discovery/index; native lock verification and permissions remain
    // explicit component seams. These are not newly created operational runtime locks.
    await guarded(RuntimeInstance.collection.name).insertMany([parent, runtime].map(row => ({
      _id: new mongoose.Types.ObjectId(row._id), customerId: new mongoose.Types.ObjectId(row.customerId),
      tenantId: new mongoose.Types.ObjectId(row.tenantId), runtimeInstanceKey: row.runtimeInstanceKey,
      revision: { ...row.revision, ...(row.revision.parentRuntimeId ? { parentRuntimeId: new mongoose.Types.ObjectId(row.revision.parentRuntimeId) } : {}) },
    })))
    revisionRoot = JSON.parse(JSON.stringify(parent))
    return parent
  }
  const configureSuccessor = async (alreadyConfigured = false) => {
    const original = alreadyConfigured ? null : await configureDirectRevision(true)
    const direct = JSON.parse(JSON.stringify(runtime)), directFrozen = JSON.parse(JSON.stringify(frozen))
    const directBasis = JSON.parse(JSON.stringify(plan.payload.requestAssociation.basis))
    const root = original || revisionRoot
    const rootFrozen = { available: true, completeness: 'VERIFIED', ...directBasis.lineage.parentBasis,
      serializationCorrection: { receiptId: directBasis.lineage.parentBasis.correctionReceiptId,
        bodyHash: directBasis.lineage.parentBasis.correctionBodyHash } }
    direct.framework_state.publish.snapshot = { snapshotId: 'r2-publish', snapshotHash: '6'.repeat(64) }
    direct.framework_state.lock.replayAnchor = { replayAnchorId: 'r2-replay', replayAnchorHash: '7'.repeat(64) }
    Object.assign(runtime, JSON.parse(JSON.stringify(direct)), { _id: successor.runtimeInstanceId,
      runtimeInstanceKey: successor.runtimeInstanceKey, stateVersion: 'rsv2:33333333-3333-4333-8333-333333333333',
      revision: { revisionNumber: 3, createdFromRevision: 2, parentRuntimeId: direct._id,
        parentRuntimeInstanceKey: direct.runtimeInstanceKey, rootRuntimeId: p.runtimeInstanceId, rootRuntimeInstanceKey: p.runtimeInstanceKey,
        derivedFromPublishSnapshotId: 'r2-publish', derivedFromPublishSnapshotHash: '6'.repeat(64),
        derivedFromLockSnapshotId: directFrozen.lockSnapshotId, derivedFromLockSnapshotHash: directFrozen.lockSnapshotHash,
        derivedFromReplayAnchorId: 'r2-replay', derivedFromReplayAnchorHash: '7'.repeat(64) } })
    Object.assign(frozen, { snapshotId: 'evidence_snapshot_33333333-3333-4333-8333-333333333333',
      membershipHash: directFrozen.membershipHash, basisStateVersion: runtime.stateVersion, lockSnapshotId: 'qa-r3-own-lock',
      lockSnapshotHash: '8'.repeat(64), revisionNumber: 3 })
    runtime.lockedEvidenceSnapshot = Object.fromEntries(['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash'].map(key => [key, frozen[key]]))
    runtime.framework_state.lock.snapshot = { snapshotId: frozen.lockSnapshotId, snapshotHash: frozen.lockSnapshotHash }
    plan.runtimeInstanceId = runtime._id; plan.payload.requestAssociation.classification.runtimeInstanceId = runtime._id
    plan.payload.requestAssociation.basis = { ...runtime.lockedEvidenceSnapshot, counts: frozen.counts,
      lineage: buildSuccessorSyntheticRevisionLineage({ runtime, parentRuntime: direct, parentBasis: directBasis }) }
    const lockAudit = new Audit({ actorUserId: p.actorUserId, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
      resourceId: runtime._id, scope: { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: runtime._id,
        runtimeInstanceKey: runtime.runtimeInstanceKey }, diff: { actionKey: 'LOCK_RECORD', actionedAt: runtime.lockedAt } })
    lockAudit.generateSignature(); await guarded(Audit.collection.name).insertOne(lockAudit.toObject())
    const directAudit = await Audit.findOne({ resourceId: direct._id, action: 'RUNTIME_ACTION_EXECUTED' }).lean()
    deps.getRuntimeInstance = async input => { const selected = input.runtimeInstanceId === p.runtimeInstanceId ? root : input.runtimeInstanceId === direct._id ? direct : runtime
      return input.projection ? { __evidenceSnapshotControl: { runtime: selected, pointer: selected.lockedEvidenceSnapshot } } : selected }
    deps.readVerifiedBasis = async input => { const id = String(input.runtime._id)
      if (id === p.runtimeInstanceId) return rootFrozen
      const audit = id === direct._id ? directAudit : lockAudit
      await input.deps.readAudit(audit._id, { session: input.session, readBudget: input.readBudget })
      return id === direct._id ? directFrozen : frozen }
    stages.clear(); providers.clear()
    await guarded(RuntimeInstance.collection.name).insertOne({ _id: new mongoose.Types.ObjectId(runtime._id),
      customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId),
      runtimeInstanceKey: runtime.runtimeInstanceKey, revision: { ...runtime.revision, parentRuntimeId: new mongoose.Types.ObjectId(direct._id) } })
    return { root, direct }
  }
  const prepareContinuation = async () => {
    await configureSuccessor()
    const owner = deps.executeFrameworkGuidance.getMockImplementation()
    deps.executeFrameworkGuidance.mockImplementationOnce(async () => { throw Object.assign(new Error('assignedPack mismatch'), {
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID', details: { field: 'assignedPack', activationId: 'audience' } }) })
    await executeIsolatedSyntheticOutcome(args())
    deps.executeFrameworkGuidance.mockImplementation(owner)
    const originals = await Event.find({}).sort({ _id: 1 }).lean()
    const claim = originals.find(row => row.phase === 'CLAIM'), result = originals.find(row => row.phase === 'RESULT')
    payload = { ...payload, requestKey: randomUUID(), continuation: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
      failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash } }
    return originals
  }
  const prepareSavedRecovery = async () => {
    await prepareContinuation()
    const owner = deps.executeFrameworkGuidance.getMockImplementation()
    deps.executeFrameworkGuidance.mockImplementationOnce(async input => {
      await owner(input)
      const source = providers.get(1), claim = await Event.findOne({ phase: 'CONTINUATION_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash,
        ...claim.body.plan, ...claim.body.requestBinding }
      delete cls.recordId
      source.execution._id = new mongoose.Types.ObjectId(); source.artifact._id = new mongoose.Types.ObjectId()
      Object.assign(source.execution, { executionId: 'grr_exec_' + randomUUID(), status: 'COMPLETED', providerMode: 'LIVE_TEST',
        provider: { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', liveProvider: true },
        requestedAt: new Date('2026-10-16T19:30:00Z'), completedAt: new Date('2026-10-16T19:30:01Z') })
      Object.assign(source.artifact, { executionId: source.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), status: 'GENERATED' })
      source.execution.artifactIds = [source.artifact.runtimeArtifactId]
      source.execution.executionEvidence.syntheticClassification = cls; source.artifact.lineageSummary.syntheticClassification = cls
      const sourceAudit = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution',
        resourceId: source.execution._id, scope: { customerId: p.customerId, tenantId: p.tenantId },
        diff: { executionId: source.execution.executionId, artifactIds: source.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: source.execution.outputTypeKey } })
      source.execution.auditLogIds = [sourceAudit._id]
      for (const row of [source.execution, source.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(source.execution); await guarded(Artifact.collection.name).insertOne(source.artifact)
      stages.clear()
      throw Object.assign(new Error('stage persistence failed'), { code: 'OUTCOME_QUALITY_STAGE_PERSISTENCE_FAILED' })
    })
    await executeIsolatedSyntheticOutcome(args())
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(r => r.phase === 'CONTINUATION_CLAIM'), result = previous.find(r => r.phase === 'CONTINUATION_RESULT')
    const ref = result.body.grrRefs[0]
    expect(ref).toBeDefined()
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      recovery: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId,
        failedResultBodyHash: result.bodyHash, executionId: ref.executionId, runtimeArtifactId: ref.runtimeArtifactId,
        executionHash: ref.executionHash, artifactHash: ref.artifactHash } }
    const saved = providers.get(1)
    deps.executeFrameworkGuidance.mockImplementation(async input => {
      const prior = await input.deps.createGovernedReasoningExecution()
      expect(prior.executionId).toBe(saved.execution.executionId)
      const result = await owner(input)
      result.stage.executionIdentity.grrExecutionId = saved.execution.executionId
      result.stage.executionIdentity.grrRuntimeArtifactId = saved.artifact.runtimeArtifactId
      providers.set(1, saved)
      return result
    })
    return { previous, saved }
  }
  test('real stage model saves canonical request resolutions transactionally without stripping or hash drift', async () => {
    const candidate = buildSuccess(), intent = candidate.inputSnapshot.consumerIntent
    intent.audienceResolution = resolveOutcomeAudienceRequest(intent.audience)
    intent.compositionResolution = resolveOutcomeCompositionRequest([{ layer: 'STYLE', phrase: 'strategic-advisory-style' }])
    candidate.inputSnapshot.consumerIntentFingerprint = hashOutcomeQualityStageValue(intent)
    candidate.inputFingerprint = hashOutcomeQualityStageValue(candidate.inputSnapshot)
    candidate.attemptFingerprint = hashOutcomeQualityStageValue(Object.fromEntries(['qualityRunId', 'planId', 'planVersion', 'planFingerprint', 'stageKey', 'stageOrder',
      'attemptNumber', 'predecessorStageExecutionId', 'predecessorAttemptFingerprint', 'status', 'inputFingerprint', 'outputFingerprint', 'executionIdentity']
      .map(key => [key, candidate[key]]).concat([['output', candidate.outputSnapshot], ['failure', candidate.failure]])))
    const session = await mongoose.startSession()
    try { await session.withTransaction(async () => { await new Stage({ ...candidate, stageExecutionId: 'actual-model-save', createdBy: stageIds.actor }).save({ session }) }) }
    finally { await session.endSession() }
    const read = await Stage.findOne({ stageExecutionId: 'actual-model-save' }).lean()
    expect(read.inputSnapshot.consumerIntent).toEqual(intent)
    expect(hashOutcomeQualityStageValue(read.inputSnapshot)).toBe(candidate.inputFingerprint)
    await expect(new Stage(read).validate()).resolves.toBeUndefined()
    await expect(Stage.hydrate(read).save()).rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
    await expect(new Stage({ ...read, inputFingerprint: 'f'.repeat(64) }).validate()).rejects.toBeDefined()
    expect(await Stage.findOne({ stageExecutionId: 'actual-model-save' }).lean()).toEqual(read)
  })
  test('R3 recovery reuses exact saved provider lineage, appends signed pair, and concurrent retry dispatches ARL once', async () => {
    const { previous, saved } = await prepareSavedRecovery(), originalProvider = membershipHash(saved)
    const out = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const current = await readIsolatedSyntheticOutcome(args())
    expect(current.run.status).toBe('ARL_PASSED'); expect(current.priorRuns).toHaveLength(2)
    expect(current.grr.find(row => row.executionId === saved.execution.executionId).reusedProviderResult).toBe(true)
    expect(current.grr[0]).toBeDefined(); expect(current.stages).toHaveLength(3)
    expect(await eventCount()).toBe(6)
    expect(await Event.find({ phase: { $in: ['CLAIM', 'RESULT', 'CONTINUATION_CLAIM', 'CONTINUATION_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(membershipHash(providers.get(1))).toBe(originalProvider)
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    expect(out.every(row => ['UNKNOWN', 'ARL_PASSED'].includes(row.run.status))).toBe(true)
  })
  test.each(['audit', 'event'])('R3 recovery %s failure rolls back new claim and preserves source provider and prior events', async kind => {
    const { previous, saved } = await prepareSavedRecovery(), before = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('recovery rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('recovery rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('recovery rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before)
    expect(membershipHash(await Grr.findById(saved.execution._id).lean())).toBe(membershipHash(saved.execution))
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test.each(['executionHash', 'artifactHash', 'failedResultBodyHash'])('R3 rejects stale recovery %s before claim or execution', async key => {
    const { previous } = await prepareSavedRecovery(); payload.recovery[key] = 'f'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'RECOVERY_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(previous.length); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 recovery stops at one ARL failure and never dispatches on passive retry', async () => {
    await prepareSavedRecovery(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_REVIEW_FAILED' }; return out })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 recovery competing keys allow one committed winner', async () => {
    await prepareSavedRecovery()
    const out = await Promise.allSettled([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })])
    expect(out.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(out.find(row => row.status === 'rejected').reason.details.reason).toBe('EXECUTION_ALREADY_CLAIMED')
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  let pinCompositionStage
  const prepareDraftRetry = async () => {
    await prepareSavedRecovery()
    const fgOwner = deps.executeFrameworkGuidance.getMockImplementation(), wdOwner = deps.executeWorkingDraft.getMockImplementation()
    let guidance, failedDraft
    const pinStage = async value => {
      value._id = new mongoose.Types.ObjectId()
      const row = { ...value }
      for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Stage.collection.name).insertOne(row)
      const diff = Object.fromEntries(['stageExecutionId', 'qualityRunId', 'planId', 'planFingerprint', 'stageKey', 'stageOrder', 'attemptNumber',
        'status', 'predecessorStageExecutionId', 'inputFingerprint'].map(key => [key, value[key]]))
      Object.assign(diff, { outputFingerprint: value.outputFingerprint || '', providerConfigurationVersion: value.executionIdentity.providerConfigurationVersion,
        failureCode: value.failure?.failureCode || '', retryable: value.failure?.retryable === true })
      const audit = new Audit({ actorUserId: p.actorUserId, action: 'OUTCOME_QUALITY_STAGE_RECORDED', resourceType: 'OutcomeQualityStageExecution',
        resourceId: value._id, scope: { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: runtime._id }, diff })
      audit.generateSignature(); await guarded(Audit.collection.name).insertOne(audit.toObject())
    }
    pinCompositionStage = pinStage
    deps.executeFrameworkGuidance.mockImplementation(async input => {
      const out = await fgOwner(input); stages.delete(out.stage.stageExecutionId)
      out.stage.stageExecutionId = 'outcome_quality_stage_' + randomUUID(); stages.set(out.stage.stageExecutionId, out.stage)
      guidance = out.stage; await pinStage(guidance); return out
    })
    deps.executeWorkingDraft.mockImplementationOnce(async input => {
      const out = await wdOwner(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), status: 'FAILED', outputFingerprint: '',
        predecessorStageExecutionId: guidance.stageExecutionId, predecessorAttemptFingerprint: guidance.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: guidance.stageExecutionId, attemptFingerprint: guidance.attemptFingerprint, outputFingerprint: guidance.outputFingerprint } },
        executionIdentity: { executionMode: 'LIVE_TEST', grrExecutionId: '', grrRuntimeArtifactId: '' },
        failure: { failureCode: 'WORKING_DRAFT_PROVIDER_INCOMPLETE', retryable: true, safeReason: 'Explicit simulated provider failure' } })
      providers.delete(2); stages.set(out.stage.stageExecutionId, out.stage); failedDraft = out.stage; await pinStage(failedDraft); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(row => row.phase === 'RECOVERY_CLAIM'), result = previous.find(row => row.phase === 'RECOVERY_RESULT')
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      draftRetry: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: guidance.stageExecutionId, guidanceMaterialHash: result.body.stageRefs[0].materialHash,
        failedDraftStageExecutionId: failedDraft.stageExecutionId, failedDraftMaterialHash: result.body.stageRefs[1].materialHash } }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input)
      Object.assign(out.stage, { attemptNumber: 2, predecessorStageExecutionId: failedDraft.stageExecutionId,
        predecessorAttemptFingerprint: failedDraft.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: guidance.stageExecutionId, attemptFingerprint: guidance.attemptFingerprint, outputFingerprint: guidance.outputFingerprint } } })
      return out
    })
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { previous, guidance, failedDraft, pinStage }
  }
  test('R3 draft retry preserves all prior receipts and stages, reuses guidance, and commits one concurrent winner', async () => {
    const { previous } = await prepareDraftRetry(), oldStages = await Stage.find({}).sort({ _id: 1 }).lean()
    const results = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    expect(results.every(row => ['UNKNOWN', 'ARL_PASSED'].includes(row.run.status))).toBe(true)
    const read = await readIsolatedSyntheticOutcome(args()); expect(read.run.status).toBe('ARL_PASSED'); expect(read.priorRuns).toHaveLength(3)
    expect(read.stages[1].attemptNumber).toBe(2); expect(await eventCount()).toBe(8)
    expect(await Event.find({ phase: { $nin: ['DRAFT_RETRY_CLAIM', 'DRAFT_RETRY_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(oldStages)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await executeIsolatedSyntheticOutcome(args()); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
  })
  test.each(['guidanceMaterialHash', 'failedDraftMaterialHash', 'failedResultBodyHash'])('R3 draft retry rejects stale %s before claim', async key => {
    await prepareDraftRetry(); payload.draftRetry[key] = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(6); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 draft retry rejects altered signed stage audit', async () => {
    await prepareDraftRetry(); await guarded(Audit.collection.name).updateOne({ action: 'OUTCOME_QUALITY_STAGE_RECORDED' }, { $set: { 'diff.status': 'ALTERED' } })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_STAGE_AUDIT_INVALID' } })
    expect(await eventCount()).toBe(6); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 draft retry rejects extra actual stage history', async () => {
    await prepareDraftRetry(); await guarded(Stage.collection.name).insertOne({ runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), customerId: new mongoose.Types.ObjectId(p.customerId),
      tenantId: new mongoose.Types.ObjectId(p.tenantId), planId: plan.planId, stageExecutionId: 'unexpected-history' })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_EXTRA_STAGE_HISTORY' } })
    expect(await eventCount()).toBe(6); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test.each(['audit', 'event'])('R3 draft retry %s write failure rolls back only the new claim', async kind => {
    const { previous } = await prepareDraftRetry(), before = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('draft retry rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('draft retry rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('draft retry rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(previous); expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before)
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 draft retry stops at genuine owner failure, and a new key cannot redispatch', async () => {
    await prepareDraftRetry(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_EXACT_TEST_FAILURE' }; return out })
    expect((await executeIsolatedSyntheticOutcome(args())).run).toMatchObject({ status: 'FAILED', failure: { failureCode: 'ARL_EXACT_TEST_FAILURE' } })
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
  const prepareDraftRepair = async () => {
    const source = await prepareDraftRetry(), owner = deps.executeWorkingDraft.getMockImplementation()
    let failedDraft
    deps.executeWorkingDraft.mockImplementationOnce(async input => {
      const out = await owner(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID', retryable: true,
          safeReason: 'The governed Working Draft provider output failed validation at claimReferences (SCHEMA).' },
        executionIdentity: { executionMode: 'LIVE_TEST', grrExecutionId: '', grrRuntimeArtifactId: '' } })
      providers.delete(2); stages.set(out.stage.stageExecutionId, out.stage); failedDraft = out.stage; await source.pinStage(failedDraft); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(row => row.phase === 'DRAFT_RETRY_CLAIM'), result = previous.find(row => row.phase === 'DRAFT_RETRY_RESULT')
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      draftRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: source.guidance.stageExecutionId, guidanceMaterialHash: result.body.stageRefs[0].materialHash,
        failedDraftStageExecutionId: failedDraft.stageExecutionId, failedDraftMaterialHash: result.body.stageRefs[1].materialHash } }
    deps.executeWorkingDraft.mockImplementation(async input => { const out = await owner(input); Object.assign(out.stage, {
      attemptNumber: 3, predecessorStageExecutionId: failedDraft.stageExecutionId, predecessorAttemptFingerprint: failedDraft.attemptFingerprint }); return out })
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { previous }
  }
  const prepareHandoffRecovery = async () => {
    await prepareDraftRepair()
    deps.executeWorkingDraft.mockImplementationOnce(async () => { throw Object.assign(new Error('The live TEST provider response could not be verified.'), {
      code: 'GRR_LIVE_TEST_PROVIDER_RESULT_INVALID', details: { reason: 'LIVE_TEST_PROVIDER_RESULT_INVALID' } }) })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(row => row.phase === 'DRAFT_REPAIR_CLAIM'), result = previous.find(row => row.phase === 'DRAFT_REPAIR_RESULT')
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      handoffRecovery: { ...claim.body.draftRepair, failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
        failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash } }
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return previous
  }
  const prepareDraftPersistence = async () => {
    await prepareHandoffRecovery()
    const owner = deps.executeWorkingDraft.getMockImplementation()
    let saved, providerAudit
    deps.executeWorkingDraft.mockImplementationOnce(async input => {
      const out = await owner(input); stages.delete(out.stage.stageExecutionId)
      saved = providers.get(2)
      saved.execution._id = new mongoose.Types.ObjectId(); saved.artifact._id = new mongoose.Types.ObjectId()
      Object.assign(saved.execution, { executionId: 'grr_exec_' + randomUUID(), status: 'COMPLETED', providerMode: 'LIVE_TEST', requestedBy: p.actorUserId,
        provider: { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', liveProvider: true },
        requestedAt: new Date('2026-10-16T19:30:00Z'), completedAt: new Date('2026-10-16T19:30:01Z') })
      Object.assign(saved.artifact, { executionId: saved.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), status: 'GENERATED', generatedBy: p.actorUserId })
      saved.execution.artifactIds = [saved.artifact.runtimeArtifactId]
      const claim = await Event.findOne({ phase: 'HANDOFF_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }
      delete cls.recordId
      saved.execution.executionEvidence.syntheticClassification = cls; saved.artifact.lineageSummary.syntheticClassification = cls
      providerAudit = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution',
        resourceId: saved.execution._id, scope: { customerId: p.customerId, tenantId: p.tenantId },
        diff: { executionId: saved.execution.executionId, artifactIds: saved.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: 'WORKING_DRAFT' } })
      saved.execution.auditLogIds = [providerAudit._id]
      for (const row of [saved.execution, saved.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(saved.execution); await guarded(Artifact.collection.name).insertOne(saved.artifact)
      throw Object.assign(new Error('Working Draft execution input is invalid.'), { code: 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID',
        details: { field: 'providerOutput.sections[0].claims[0].blockedStrongerClaim', min: 1, max: 2000 } })
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(row => row.phase === 'HANDOFF_CLAIM'), result = previous.find(row => row.phase === 'HANDOFF_RESULT')
    const ref = result.body.grrRefs.find(row => row.stageKey === 'WORKING_DRAFT')
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      draftPersistence: { ...claim.body.handoffRecovery, failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
        failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        executionId: ref.executionId, runtimeArtifactId: ref.runtimeArtifactId, executionHash: ref.executionHash, artifactHash: ref.artifactHash } }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const reused = await input.deps.createGovernedReasoningExecution()
      expect(reused.executionId).toBe(saved.execution.executionId); expect(reused.artifact).toEqual(saved.artifact)
      const out = await owner(input)
      out.stage.executionIdentity.grrExecutionId = saved.execution.executionId
      out.stage.executionIdentity.grrRuntimeArtifactId = saved.artifact.runtimeArtifactId
      providers.set(2, saved); return out
    })
    const draftAdapter = jest.fn(); providerRuntimeDeps.workingDraftProviderAdapterFactory = () => draftAdapter
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { previous, saved, providerAudit, draftAdapter }
  }
  const prepareCompositionRevision = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareDraftPersistence()
    const savedOwner = deps.executeWorkingDraft.getMockImplementation()
    let draft, arl
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await savedOwner(input); stages.delete(out.stage.stageExecutionId)
      out.stage.stageExecutionId = 'outcome_quality_stage_' + randomUUID()
      draft = out.stage; stages.set(draft.stageExecutionId, draft); await pinCompositionStage(draft); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated required composition change' },
        predecessorStageExecutionId: draft.stageExecutionId, predecessorAttemptFingerprint: draft.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: draft.stageExecutionId, attemptFingerprint: draft.attemptFingerprint, outputFingerprint: draft.outputFingerprint } } })
      arl = out.stage
      const pair = providers.get(3)
      pair.execution._id = new mongoose.Types.ObjectId(); pair.artifact._id = new mongoose.Types.ObjectId()
      const audit = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [audit._id]
      const claim = await Event.findOne({ phase: 'DRAFT_PERSISTENCE_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      stages.set(arl.stageExecutionId, arl); await pinCompositionStage(arl); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(x => x.phase === 'DRAFT_PERSISTENCE_CLAIM'), result = previous.find(x => x.phase === 'DRAFT_PERSISTENCE_RESULT')
    const refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      compositionRevision: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 4,
        predecessorStageExecutionId: draft.stageExecutionId, predecessorAttemptFingerprint: draft.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision).toEqual({ draftStageExecutionId: draft.stageExecutionId, draftOutputFingerprint: draft.outputFingerprint, arlStageExecutionId: arl.stageExecutionId, arlAttemptFingerprint: arl.attemptFingerprint })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), current = [...stages.values()].find(x => x.attemptNumber === 4)
      Object.assign(out.stage, { attemptNumber: 2, predecessorStageExecutionId: arl.stageExecutionId, predecessorAttemptFingerprint: arl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: current.stageExecutionId, attemptFingerprint: current.attemptFingerprint, outputFingerprint: current.outputFingerprint } } })
      return out
    })
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { previous, stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareTransportRecovery = async (composed = false) => {
    await prepareCompositionRevision()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation()
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input)
      if (composed) out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v1'
      await pinCompositionStage(out.stage)
      const pair = providers.get(2), claim = await Event.findOne({ phase: 'COMPOSITION_CLAIM' }).lean()
      pair.execution._id = new mongoose.Types.ObjectId(); pair.artifact._id = new mongoose.Types.ObjectId()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      const audit = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [audit._id]
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const source = [...stages.values()].find(row => row.attemptNumber === 4), old = [...stages.values()].find(row => row.stageKey === 'ARL_MEANING_REVIEW')
      const value = { ...old, _id: undefined, stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 2, status: 'FAILED', outputFingerprint: '',
        predecessorStageExecutionId: old.stageExecutionId, predecessorAttemptFingerprint: old.attemptFingerprint,
        failure: { failureCode: 'ARL_MEANING_REVIEW_PROVIDER_CONTEXT_OVERFLOW', retryable: false, safeReason: 'Simulated pre-provider overflow' },
        inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
        executionIdentity: { executionMode: 'LIVE_TEST', providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V6_LOSSLESS_TEXT_PARTS', grrExecutionId: '', grrRuntimeArtifactId: '' } }
      stages.set(value.stageExecutionId, value); await pinCompositionStage(value); return { stage: value }
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const previous = await Event.find({}).sort({ _id: 1 }).lean(), claim = previous.find(row => row.phase === 'COMPOSITION_CLAIM'), result = previous.find(row => row.phase === 'COMPOSITION_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      transportRecovery: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const arl = stages.get(refs[2].stageExecutionId), source = stages.get(refs[1].stageExecutionId)
    deps.approveWorkingDraftMeaning.mockImplementation(async () => {
      const value = { ...arl, stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 3,
        predecessorStageExecutionId: arl.stageExecutionId, predecessorAttemptFingerprint: arl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } } }
      stages.set(value.stageExecutionId, value); return { stage: value }
    })
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { previous, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareLabelRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareTransportRecovery(true)
    const arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input), pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(3)))
      const claim = await Event.findOne({ phase: 'ARL_TRANSPORT_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: {
        overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => ({
          dimension, status: dimension === 'COHERENCE' ? 'FAIL' : 'PASS', requiredChange: dimension === 'COHERENCE', finding: 'Simulated label finding.' })) } })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      Object.assign(out.stage, { failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated label finding.' },
        executionIdentity: { executionMode: 'LIVE_TEST', providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId } })
      const wd = [...stages.values()].find(x => x.attemptNumber === 4)
      // This seam fixture pins an already composed V1 source before journal collection.
      // Its original stage/audit were inserted by prepareTransportRecovery.
      expect(wd.outputSnapshot.compositionVersion).toBe('evidence-bound-composition.v1')
      providers.set(3, pair); await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'ARL_TRANSPORT_CLAIM'), result = rows.find(x => x.phase === 'ARL_TRANSPORT_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      labelRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId)
    const history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 5,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 5)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 4, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareWordingRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareLabelRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'LABEL_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v2'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = ['PRIORITISATION', 'DECISION_USEFULNESS'].includes(dimension)
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated next-action heading finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'LABEL_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'LABEL_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      wordingRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 6,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 6)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 5, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareAttributionRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareWordingRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'WORDING_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v3'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = dimension === 'COHERENCE'
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated next-action heading finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'WORDING_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'WORDING_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      attributionRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 7,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 7)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 6, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareMetadataRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareAttributionRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'ATTRIBUTION_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v4'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = dimension === 'PRIORITISATION'
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated scope/currentness presentation finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'ATTRIBUTION_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'ATTRIBUTION_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      metadataRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 8,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 8)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 7, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareScopingRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareMetadataRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'METADATA_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v5'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = dimension === 'EVIDENCE_USE'
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated source-specific qualification finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'METADATA_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'METADATA_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      scopingRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 9,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 9)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 8, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareHolisticRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareReferenceRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'REFERENCE_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v7'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = ['COHERENCE', 'DECISION_USEFULNESS'].includes(dimension)
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated whole-draft composition finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'REFERENCE_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'REFERENCE_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      holisticRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 11,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 11)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 10, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  test('R3 whole-draft composition guard and rollback', async () => {
    console.info('HOLISTIC_QA_A_SETUP', new Date().toISOString())
    const before = await prepareHolisticRepair(), original = structuredClone(payload)
    const collect = deps.collectGrrEvidence, reads = []
    deps.collectGrrEvidence = async input => {
      reads.push({ phase: input.claim.phase, session: input.session })
      return collect(input)
    }
    console.info('HOLISTIC_QA_A_GUARDS', new Date().toISOString())
    payload.holisticRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // Each already verified immediate parent is collected once per snapshot,
    // rather than recursively repeating the same newer composition ancestry.
    for (const phase of ['LABEL_REPAIR_CLAIM', 'WORDING_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_CLAIM', 'REFERENCE_REPAIR_CLAIM']) {
      const matched = reads.filter(row => row.phase === phase)
      expect(matched).toHaveLength(1)
      expect(matched[0].session).toBeTruthy()
    }
    // A changed link between parent verification and receipt collection cannot
    // consume the handoff, even inside the same transaction.
    deps.collectGrrEvidence = async input => {
      const result = await collect(input)
      if (input.claim.phase === 'REFERENCE_REPAIR_CLAIM') input.claim.body.referenceRepair.failedClaimBodyHash = '2'.repeat(64)
      return result
    }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'VERIFIED_PARENT_BINDING_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    deps.collectGrrEvidence = collect
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'REFERENCE_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('HOLISTIC_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 whole-draft composition winner and retry', async () => {
    console.info('HOLISTIC_QA_B_SETUP', new Date().toISOString())
    const before = await prepareHolisticRepair()
    console.info('HOLISTIC_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('HOLISTIC_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(15)
    expect(read.stages[1].attemptNumber).toBe(11); expect(read.stages[2].attemptNumber).toBe(10)
    expect(await eventCount()).toBe(32)
    expect(await Event.find({ phase: { $nin: ['HOLISTIC_REPAIR_CLAIM', 'HOLISTIC_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('HOLISTIC_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('HOLISTIC_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  const prepareDescriptiveRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareHolisticRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'HOLISTIC_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v8'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = ['PRIORITISATION', 'DECISION_USEFULNESS'].includes(dimension)
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated descriptive replay finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'HOLISTIC_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'HOLISTIC_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      descriptiveRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v9'
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 12,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 12)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 11, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  test('R3 descriptive replay guard and rollback', async () => {
    console.info('DESCRIPTIVE_QA_A_SETUP', new Date().toISOString())
    const before = await prepareDescriptiveRepair(), original = structuredClone(payload)
    const collect = deps.collectGrrEvidence, reads = []
    deps.collectGrrEvidence = async input => {
      reads.push({ phase: input.claim.phase, session: input.session })
      return collect(input)
    }
    console.info('DESCRIPTIVE_QA_A_GUARDS', new Date().toISOString())
    payload.descriptiveRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // Each already verified immediate parent is collected once per snapshot,
    // rather than recursively repeating the same newer composition ancestry.
    for (const phase of ['LABEL_REPAIR_CLAIM', 'WORDING_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_CLAIM', 'HOLISTIC_REPAIR_CLAIM']) {
      const matched = reads.filter(row => row.phase === phase)
      expect(matched).toHaveLength(1)
      expect(matched[0].session).toBeTruthy()
    }
    // A changed link between parent verification and receipt collection cannot
    // consume the handoff, even inside the same transaction.
    deps.collectGrrEvidence = async input => {
      const result = await collect(input)
      if (input.claim.phase === 'HOLISTIC_REPAIR_CLAIM') input.claim.body.holisticRepair.failedClaimBodyHash = '2'.repeat(64)
      return result
    }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'VERIFIED_PARENT_BINDING_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    deps.collectGrrEvidence = collect
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'HOLISTIC_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('DESCRIPTIVE_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 descriptive replay winner and retry', async () => {
    console.info('DESCRIPTIVE_QA_B_SETUP', new Date().toISOString())
    const before = await prepareDescriptiveRepair()
    console.info('DESCRIPTIVE_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('DESCRIPTIVE_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(16)
    expect(read.stages[1].attemptNumber).toBe(12); expect(read.stages[2].attemptNumber).toBe(11)
    expect(await eventCount()).toBe(34)
    expect(await Event.find({ phase: { $nin: ['DESCRIPTIVE_REPAIR_CLAIM', 'DESCRIPTIVE_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('DESCRIPTIVE_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('DESCRIPTIVE_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  const prepareAuthorisedReview = async (pass = false) => {
    await prepareDescriptiveRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinPair = async (index, stage, phase, reviewReceipt = null) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID() })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      if (index === 3) {
        pair.artifact.generatedOutput = { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => ({ dimension,
          status: dimension === 'PRIORITISATION' ? 'FAIL' : 'PASS', requiredChange: dimension === 'PRIORITISATION', finding: 'Explicit QA component discrepancy; no provider call.' })) }
        pair.artifact.safeJson = { metadata: { responseId: reviewReceipt?.responseId || 'resp_prior_qa', requestIdentity: AUTHORISED_ARL_BODY.payloadSha256,
          ...(reviewReceipt ? { authorisedReview: reviewReceipt } : {}) } }
        if (pass && reviewReceipt) {
          pair.artifact.generatedOutput.overallStatus = 'PASS'
          for (const finding of pair.artifact.generatedOutput.findings) Object.assign(finding, { status: 'PASS', requiredChange: false })
        }
      }
      const audit = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [audit._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      Object.assign(stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      providers.set(index, pair)
      return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); stages.delete(out.stage.stageExecutionId)
      out.stage.stageExecutionId = AUTHORISED_ARL_SCOPE.workingDraftId
      await pinPair(2, out.stage, 'DESCRIPTIVE_REPAIR_CLAIM'); stages.set(out.stage.stageExecutionId, out.stage); await pinCompositionStage(out.stage)
      return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input); stages.delete(out.stage.stageExecutionId)
      out.stage.stageExecutionId = AUTHORISED_ARL_SCOPE.priorArlId
      out.stage.executionIdentity.providerConfigurationVersion = 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT'
      const wd = stages.get(AUTHORISED_ARL_SCOPE.workingDraftId)
      out.stage.inputSnapshot.sourceStage = { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint }
      await pinPair(3, out.stage, 'DESCRIPTIVE_REPAIR_CLAIM'); stages.set(out.stage.stageExecutionId, out.stage); await pinCompositionStage(out.stage)
      return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(row => row.phase === 'DESCRIPTIVE_REPAIR_CLAIM'), result = rows.find(row => row.phase === 'DESCRIPTIVE_REPAIR_RESULT')
    const refs = result.body.stageRefs, draft = stages.get(AUTHORISED_ARL_SCOPE.workingDraftId), prior = stages.get(AUTHORISED_ARL_SCOPE.priorArlId)
    expect(draft).toMatchObject({ attemptNumber: 12, outputSnapshot: { compositionVersion: 'evidence-bound-composition.v9' } })
    expect(prior).toMatchObject({ attemptNumber: 11, executionIdentity: { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT' } })
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      authorisedReview: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash,
        draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash,
        approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256,
        discrepancyOutcome: 'DISCREPANCY', discrepancyPackSha256: AUTHORISED_ARL_APPROVAL.discrepancyPackSha256 } }
    const historicalPairs = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...historicalPairs, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      // Actual signed CLAIM/model/HMAC proof, with selection and stage generation
      // explicit QA seams. No adapter or provider request is made by this test.
      const proof = await verifyNativeAuthorisedArlReview({ ...input.authorisedReview, actorUserId: p.actorUserId,
        runtimeInstanceId: String(runtime._id), plan, source: draft, latest: prior })
      observeAuthorisedArlResponse(proof, 'resp_fresh_qa')
      const receipt = readAuthorisedArlProof(proof)
      const stage = { ...prior, _id: undefined, stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 12,
        predecessorStageExecutionId: prior.stageExecutionId, predecessorAttemptFingerprint: prior.attemptFingerprint,
        executionIdentity: { ...prior.executionIdentity, authorisedReview: receipt } }
      if (pass) Object.assign(stage, { status: 'SUCCEEDED', failure: null })
      await pinPair(3, stage, 'AUTHORISED_REVIEW_CLAIM', receipt)
      stages.set(stage.stageExecutionId, stage); await pinCompositionStage(stage)
      return { stage }
    })
    deps.executeFrameworkGuidance.mockClear(); deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  const prepareCompletion = async () => {
    await prepareAuthorisedReview(true)
    const source = await executeIsolatedSyntheticOutcome(args())
    expect(source.run.status).toBe('ARL_PASSED')
    const claim = await Event.findOne({ phase: 'AUTHORISED_REVIEW_CLAIM' }).lean()
    const result = await Event.findOne({ phase: 'AUTHORISED_REVIEW_RESULT' }).lean()
    const [draft, arl] = source.run.stageRefs.slice(1)
    payload = { requestKey: randomUUID(), requestId: plan.requestId, planId: plan.planId, expectedPlanFingerprint: plan.planFingerprint,
      completionSource: { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
        workingDraftStageExecutionId: draft.stageExecutionId, workingDraftMaterialHash: draft.materialHash,
        arlStageExecutionId: arl.stageExecutionId, arlMaterialHash: arl.materialHash } }
    // Explicit owner seam: journal proof deliberately stops before a provider or stage.
    deps.createNarrativePlan = jest.fn(async () => { throw Object.assign(new Error('Explicit QA downstream owner gate'), { code: 'QA_DOWNSTREAM_GATE' }) })
    deps.createShapedCandidate = jest.fn()
    deps.executeRenderedExpressionRl = jest.fn()
    return { events: await Event.find({}).sort({ _id: 1 }).lean(), audits: await Audit.find({}).sort({ _id: 1 }).lean(),
      stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  test('R3 downstream completion claim audit and event rollback', async () => {
    const before = await prepareCompletion()
    for (const failure of ['audit', 'event']) {
      deps.auditService = failure === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('completion audit rollback') } } : auditService
      deps.models = failure === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('completion event rollback') } } } : undefined
      await expect(completeIsolatedSyntheticOutcome(args())).rejects.toThrow(`completion ${failure} rollback`)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.events)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    }
    expect(deps.createNarrativePlan).not.toHaveBeenCalled()
  }, 600000)
  test('R3 downstream completion concurrent winner and passive unknown retry', async () => {
    const before = await prepareCompletion()
    await Promise.all([completeIsolatedSyntheticOutcome(args()), completeIsolatedSyntheticOutcome(args())])
    const result = await readLatestIsolatedSyntheticOutcome(args())
    expect(result.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_DOWNSTREAM_GATE' } })
    expect(result.sourceRun.status).toBe('ARL_PASSED')
    expect(await Event.find({ phase: { $in: ['COMPLETION_CLAIM', 'COMPLETION_RESULT'] } })).toHaveLength(2)
    expect(await Event.find({ phase: { $nin: ['COMPLETION_CLAIM', 'COMPLETION_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.events)
    await completeIsolatedSyntheticOutcome(args())
    await expect(completeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
    expect(deps.createNarrativePlan).toHaveBeenCalledTimes(1)
    expect(deps.createShapedCandidate).not.toHaveBeenCalled(); expect(deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    for (const audit of await Audit.find({})) expect(audit.verifySignature()).toBe(true)
  }, 600000)
  test('R3 authorised review required audit rollback and strict source guards', async () => {
    const before = await prepareAuthorisedReview(), original = JSON.parse(JSON.stringify(payload))
    payload.authorisedReview.approvalSha256 = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow()
    payload = original
    const sourceClaim = before.rows.find(row => row.phase === 'DESCRIPTIVE_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let transactionOrdinal = 0, injected = false
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), originalTransaction = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } }); injected = true
        }
        return originalTransaction(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    for (const failure of ['audit', 'event']) {
      deps.auditService = failure === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('authorised audit rollback') } } : auditService
      deps.models = failure === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('authorised event rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow(`authorised ${failure} rollback`)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    }
    deps.auditService = auditService; deps.models = undefined
    expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const proof = await verifyNativeAuthorisedArlReview({ ...input.authorisedReview, actorUserId: p.actorUserId,
        runtimeInstanceId: String(runtime._id), plan, source: stages.get(AUTHORISED_ARL_SCOPE.workingDraftId), latest: stages.get(AUTHORISED_ARL_SCOPE.priorArlId) })
      observeAuthorisedArlResponse(proof, 'resp_completed_unusable_qa')
      throw Object.assign(new Error('Explicit completed but unusable QA component response'), { code: 'ARL_AUTHORISED_REVIEW_UNRESOLVED',
        details: { reason: 'COMPLETED_RESPONSE_UNUSABLE', authorisedReview: readAuthorisedArlProof(proof) } })
    })
    const unknown = await executeIsolatedSyntheticOutcome(args())
    expect(unknown.run.status).toBe('UNKNOWN')
    expect(unknown.run.failure.details.authorisedReview).toMatchObject({ responseState: 'FRESH', responseId: 'resp_completed_unusable_qa' })
    expect(unknown.stages).toHaveLength(2)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    expect((await readIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    await executeIsolatedSyntheticOutcome(args())
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  }, 600000)
  test('R3 authorised review single winner preserves draft and failed source', async () => {
    const before = await prepareAuthorisedReview()
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED')
    expect(read.stages[1].stageExecutionId).toBe(AUTHORISED_ARL_SCOPE.workingDraftId)
    expect(read.stages[2].attemptNumber).toBe(12)
    expect(read.stages[2].executionIdentity.authorisedReview.responseState).toBe('FRESH')
    expect(await Event.find({ phase: { $nin: ['AUTHORISED_REVIEW_CLAIM', 'AUTHORISED_REVIEW_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
  }, 600000)
  const prepareReferenceRepair = async () => {
    const freshWd = deps.executeWorkingDraft.getMockImplementation(), freshArl = deps.approveWorkingDraftMeaning.getMockImplementation()
    await prepareScopingRepair()
    const wdOwner = deps.executeWorkingDraft.getMockImplementation(), arlOwner = deps.approveWorkingDraftMeaning.getMockImplementation()
    const pinProvider = async (index, output) => {
      const pair = mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(providers.get(index)))
      const claim = await Event.findOne({ phase: 'SCOPING_REPAIR_CLAIM' }).lean()
      const cls = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash, ...claim.body.plan, ...claim.body.requestBinding }; delete cls.recordId
      Object.assign(pair.execution, { _id: new mongoose.Types.ObjectId(), executionId: 'grr_exec_' + randomUUID() })
      Object.assign(pair.artifact, { _id: new mongoose.Types.ObjectId(), executionId: pair.execution.executionId, runtimeArtifactId: 'grr_art_' + randomUUID(), generatedOutput: output })
      pair.execution.artifactIds = [pair.artifact.runtimeArtifactId]
      pair.execution.executionEvidence.syntheticClassification = cls; pair.artifact.lineageSummary.syntheticClassification = cls
      const a = await auditService.log({ actorUserId: p.actorUserId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: pair.execution._id,
        scope: { customerId: p.customerId, tenantId: p.tenantId }, diff: { executionId: pair.execution.executionId, artifactIds: pair.execution.artifactIds, runtimeInstanceId: String(runtime._id), providerMode: 'LIVE_TEST', outputTypeKey: pair.execution.outputTypeKey } })
      pair.execution.auditLogIds = [a._id]
      for (const row of [pair.execution, pair.artifact]) for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) row[key] = new mongoose.Types.ObjectId(row[key])
      await guarded(Grr.collection.name).insertOne(pair.execution); await guarded(Artifact.collection.name).insertOne(pair.artifact)
      providers.set(index, pair); return pair
    }
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await wdOwner(input); out.stage.outputSnapshot.compositionVersion = 'evidence-bound-composition.v6'
      const pair = await pinProvider(2, { synthetic: true })
      Object.assign(out.stage.executionIdentity, { grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await arlOwner(input)
      const pair = await pinProvider(3, { overallStatus: 'FAIL', findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS'].map(dimension => {
        const requiredChange = dimension === 'COHERENCE'
        return { dimension, status: requiredChange ? 'FAIL' : 'PASS', requiredChange, finding: 'Simulated complete reference sentence finding.' }
      }) })
      Object.assign(out.stage.executionIdentity, { providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT', grrExecutionId: pair.execution.executionId, grrRuntimeArtifactId: pair.artifact.runtimeArtifactId })
      await pinCompositionStage(out.stage); return out
    })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    const rows = await Event.find({}).sort({ _id: 1 }).lean(), claim = rows.find(x => x.phase === 'SCOPING_REPAIR_CLAIM'), result = rows.find(x => x.phase === 'SCOPING_REPAIR_RESULT'), refs = result.body.stageRefs
    payload = { requestKey: randomUUID(), requestId: payload.requestId, planId: payload.planId, expectedPlanFingerprint: payload.expectedPlanFingerprint,
      referenceRepair: { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash, failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash,
        guidanceStageExecutionId: refs[0].stageExecutionId, guidanceMaterialHash: refs[0].materialHash, draftStageExecutionId: refs[1].stageExecutionId, draftMaterialHash: refs[1].materialHash,
        failedArlStageExecutionId: refs[2].stageExecutionId, failedArlMaterialHash: refs[2].materialHash } }
    const sourceWd = stages.get(refs[1].stageExecutionId), sourceArl = stages.get(refs[2].stageExecutionId), history = [...providers.values()], collect = deps.collectGrrEvidence
    deps.collectGrrEvidence = async input => [...new Map([...history, ...await collect(input)].map(pair => [pair.execution.executionId, pair])).values()]
      .filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === input.claim.eventId)
    deps.executeWorkingDraft.mockImplementation(async input => {
      const out = await freshWd(input); stages.delete(out.stage.stageExecutionId)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 10,
        predecessorStageExecutionId: sourceWd.stageExecutionId, predecessorAttemptFingerprint: sourceWd.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: refs[0].stageExecutionId, attemptFingerprint: refs[0].attemptFingerprint, outputFingerprint: refs[0].outputFingerprint } } })
      expect(input.compositionRevision.draftStageExecutionId).toBe(sourceWd.stageExecutionId)
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await freshArl(input), wd = [...stages.values()].find(x => x.attemptNumber === 10)
      Object.assign(out.stage, { stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 9, status: 'FAILED', outputFingerprint: '',
        failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false, safeReason: 'Simulated stop.' },
        predecessorStageExecutionId: sourceArl.stageExecutionId, predecessorAttemptFingerprint: sourceArl.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: wd.stageExecutionId, attemptFingerprint: wd.attemptFingerprint, outputFingerprint: wd.outputFingerprint } } })
      stages.set(out.stage.stageExecutionId, out.stage); return out
    })
    deps.executeWorkingDraft.mockClear(); deps.approveWorkingDraftMeaning.mockClear()
    return { rows, audits: await Audit.find({}).sort({ _id: 1 }).lean(), stages: await Stage.find({}).sort({ _id: 1 }).lean(), providers: await Grr.find({}).sort({ _id: 1 }).lean() }
  }
  test('R3 complete reference sentence guard and rollback', async () => {
    console.info('REFERENCE_QA_A_SETUP', new Date().toISOString())
    const before = await prepareReferenceRepair(), original = structuredClone(payload)
    const collect = deps.collectGrrEvidence, reads = []
    deps.collectGrrEvidence = async input => {
      reads.push({ phase: input.claim.phase, session: input.session })
      return collect(input)
    }
    console.info('REFERENCE_QA_A_GUARDS', new Date().toISOString())
    payload.referenceRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // Each already verified immediate parent is collected once per snapshot,
    // rather than recursively repeating the same newer composition ancestry.
    for (const phase of ['LABEL_REPAIR_CLAIM', 'WORDING_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_CLAIM', 'SCOPING_REPAIR_CLAIM']) {
      const matched = reads.filter(row => row.phase === phase)
      expect(matched).toHaveLength(1)
      expect(matched[0].session).toBeTruthy()
    }
    // A changed link between parent verification and receipt collection cannot
    // consume the handoff, even inside the same transaction.
    deps.collectGrrEvidence = async input => {
      const result = await collect(input)
      if (input.claim.phase === 'SCOPING_REPAIR_CLAIM') input.claim.body.scopingRepair.failedClaimBodyHash = '2'.repeat(64)
      return result
    }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'VERIFIED_PARENT_BINDING_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    deps.collectGrrEvidence = collect
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'SCOPING_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('REFERENCE_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 complete reference sentence winner and retry', async () => {
    console.info('REFERENCE_QA_B_SETUP', new Date().toISOString())
    const before = await prepareReferenceRepair()
    console.info('REFERENCE_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('REFERENCE_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(14)
    expect(read.stages[1].attemptNumber).toBe(10); expect(read.stages[2].attemptNumber).toBe(9)
    expect(await eventCount()).toBe(30)
    expect(await Event.find({ phase: { $nin: ['REFERENCE_REPAIR_CLAIM', 'REFERENCE_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('REFERENCE_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('REFERENCE_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 document qualification scope guard and rollback', async () => {
    console.info('SCOPING_QA_A_SETUP', new Date().toISOString())
    const before = await prepareScopingRepair(), original = structuredClone(payload)
    const collect = deps.collectGrrEvidence, reads = []
    deps.collectGrrEvidence = async input => {
      reads.push({ phase: input.claim.phase, session: input.session })
      return collect(input)
    }
    console.info('SCOPING_QA_A_GUARDS', new Date().toISOString())
    payload.scopingRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // Each already verified immediate parent is collected once per snapshot,
    // rather than recursively repeating the same newer composition ancestry.
    for (const phase of ['LABEL_REPAIR_CLAIM', 'WORDING_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_CLAIM', 'METADATA_REPAIR_CLAIM']) {
      const matched = reads.filter(row => row.phase === phase)
      expect(matched).toHaveLength(1)
      expect(matched[0].session).toBeTruthy()
    }
    // A changed link between parent verification and receipt collection cannot
    // consume the handoff, even inside the same transaction.
    deps.collectGrrEvidence = async input => {
      const result = await collect(input)
      if (input.claim.phase === 'METADATA_REPAIR_CLAIM') input.claim.body.metadataRepair.failedClaimBodyHash = '2'.repeat(64)
      return result
    }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'VERIFIED_PARENT_BINDING_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    deps.collectGrrEvidence = collect
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'METADATA_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('SCOPING_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 document qualification scope winner and retry', async () => {
    console.info('SCOPING_QA_B_SETUP', new Date().toISOString())
    const before = await prepareScopingRepair()
    console.info('SCOPING_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('SCOPING_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(13)
    expect(read.stages[1].attemptNumber).toBe(9); expect(read.stages[2].attemptNumber).toBe(8)
    expect(await eventCount()).toBe(28)
    expect(await Event.find({ phase: { $nin: ['SCOPING_REPAIR_CLAIM', 'SCOPING_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('SCOPING_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('SCOPING_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 scope currentness metadata guard and rollback', async () => {
    console.info('METADATA_QA_A_SETUP', new Date().toISOString())
    const before = await prepareMetadataRepair(), original = structuredClone(payload)
    console.info('METADATA_QA_A_GUARDS', new Date().toISOString())
    payload.metadataRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'ATTRIBUTION_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('METADATA_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 scope currentness metadata winner and retry', async () => {
    console.info('METADATA_QA_B_SETUP', new Date().toISOString())
    const before = await prepareMetadataRepair()
    console.info('METADATA_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('METADATA_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(12)
    expect(read.stages[1].attemptNumber).toBe(8); expect(read.stages[2].attemptNumber).toBe(7)
    expect(await eventCount()).toBe(26)
    expect(await Event.find({ phase: { $nin: ['METADATA_REPAIR_CLAIM', 'METADATA_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('METADATA_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('METADATA_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 separate input attribution guard and rollback', async () => {
    console.info('ATTRIBUTION_QA_A_SETUP', new Date().toISOString())
    const before = await prepareAttributionRepair(), original = structuredClone(payload)
    console.info('ATTRIBUTION_QA_A_GUARDS', new Date().toISOString())
    payload.attributionRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'WORDING_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('ATTRIBUTION_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 separate input attribution winner and retry', async () => {
    console.info('ATTRIBUTION_QA_B_SETUP', new Date().toISOString())
    const before = await prepareAttributionRepair()
    console.info('ATTRIBUTION_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('ATTRIBUTION_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(11)
    expect(read.stages[1].attemptNumber).toBe(7); expect(read.stages[2].attemptNumber).toBe(6)
    expect(await eventCount()).toBe(24)
    expect(await Event.find({ phase: { $nin: ['ATTRIBUTION_REPAIR_CLAIM', 'ATTRIBUTION_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('ATTRIBUTION_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('ATTRIBUTION_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 decision gate wording guard and rollback', async () => {
    console.info('WORDING_QA_A_SETUP', new Date().toISOString())
    const before = await prepareWordingRepair(), original = structuredClone(payload)
    console.info('WORDING_QA_A_GUARDS', new Date().toISOString())
    payload.wordingRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'LABEL_REPAIR_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    console.info('WORDING_QA_A_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 decision gate wording winner and retry', async () => {
    console.info('WORDING_QA_B_SETUP', new Date().toISOString())
    const before = await prepareWordingRepair()
    console.info('WORDING_QA_B_WINNER', new Date().toISOString())
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    console.info('WORDING_QA_B_READBACK', new Date().toISOString())
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(10)
    expect(read.stages[1].attemptNumber).toBe(6); expect(read.stages[2].attemptNumber).toBe(5)
    expect(await eventCount()).toBe(22)
    expect(await Event.find({ phase: { $nin: ['WORDING_REPAIR_CLAIM', 'WORDING_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    console.info('WORDING_QA_B_PASSIVE', new Date().toISOString())
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    console.info('WORDING_QA_B_COMPLETE', new Date().toISOString())
  }, 600000)
  test('R3 reader label repair verifies stale rejection, both rollbacks, one concurrent winner and stop', async () => {
    const before = await prepareLabelRepair(), original = structuredClone(payload)
    payload.labelRepair.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    payload = original
    // A verified preflight must not provide cached authority to a later transaction.
    const sourceClaim = before.rows.find(row => row.phase === 'ARL_TRANSPORT_CLAIM')
    const sourceAudit = before.audits.find(row => String(row._id) === String(sourceClaim.auditId))
    let injected = false, transactionOrdinal = 0
    deps.mongoose = { startSession: async () => {
      const session = await mongoose.startSession(), original = session.withTransaction.bind(session)
      session.withTransaction = async (callback, options) => {
        if (++transactionOrdinal === 2 && !injected) {
          await guarded(Audit.collection.name).updateOne({ _id: sourceAudit._id }, { $set: { 'diff.bodyHash': '1'.repeat(64) } })
          injected = true
        }
        return original(callback, options)
      }
      return session
    } }
    try {
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
      expect(injected).toBe(true)
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    } finally {
      deps.mongoose = undefined
      if (injected) await guarded(Audit.collection.name).replaceOne({ _id: sourceAudit._id }, sourceAudit)
    }
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    for (const kind of ['audit', 'event']) {
      deps.auditService = kind === 'audit' ? { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('label rollback') } } : auditService
      deps.models = kind === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('label rollback') } } } : undefined
      await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('label rollback')
      expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.rows)
      expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
      expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
      expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
      expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    }
    deps.auditService = auditService; deps.models = undefined
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('FAILED'); expect(read.priorRuns).toHaveLength(9)
    expect(read.stages[1].attemptNumber).toBe(5); expect(read.stages[2].attemptNumber).toBe(4)
    expect(await eventCount()).toBe(20)
    expect(await Event.find({ phase: { $nin: ['LABEL_REPAIR_CLAIM', 'LABEL_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.rows)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    await executeIsolatedSyntheticOutcome(args())
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
  }, 600000)
  test('R3 ARL transport recovery has one concurrent winner, reuses exact draft and stops after failed ARL', async () => {
    const before = await prepareTransportRecovery()
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const result = await readIsolatedSyntheticOutcome(args())
    expect(result.run.status).toBe('FAILED'); expect(result.priorRuns).toHaveLength(8)
    expect(result.stages[1].attemptNumber).toBe(4); expect(result.stages[2].attemptNumber).toBe(3)
    expect(result.grr.every(row => row.reusedProviderResult)).toBe(true)
    expect(await eventCount()).toBe(18)
    expect(await Event.find({ phase: { $nin: ['ARL_TRANSPORT_CLAIM', 'ARL_TRANSPORT_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.previous)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
  test.each(['audit', 'event'])('R3 ARL transport recovery %s failure rolls back before dispatch', async kind => {
    const before = await prepareTransportRecovery()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('transport rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('transport rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('transport rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.previous)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before.audits)
    expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
  })
  test('R3 ARL transport recovery rejects stale bindings before claim', async () => {
    const before = await prepareTransportRecovery(); payload.transportRecovery.draftMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'TRANSPORT_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(before.previous.length); expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
  })
  test('R3 ARL transport recovery rejects extra actual provider history', async () => {
    await prepareTransportRecovery(); const row = await Grr.findOne({}).lean(); delete row._id
    row.executionId += '-extra'; await guarded(Grr.collection.name).insertOne(row)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_EXTRA_PROVIDER_HISTORY' } })
    expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
  })
  test('R3 composition revision commits one concurrent winner and preserves all fourteen earlier events', async () => {
    const before = await prepareCompositionRevision()
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = await readIsolatedSyntheticOutcome(args())
    expect(read.run.status).toBe('ARL_PASSED'); expect(read.priorRuns).toHaveLength(7)
    expect(read.stages[1].attemptNumber).toBe(4); expect(read.stages[2].attemptNumber).toBe(2)
    expect(await Event.find({ phase: { $nin: ['COMPOSITION_CLAIM', 'COMPOSITION_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(before.previous)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(before.stages)
    expect(await Grr.find({}).sort({ _id: 1 }).lean()).toEqual(before.providers)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 composition revision passive and conflicting retries never redispatch', async () => {
    await prepareCompositionRevision(); const first = await executeIsolatedSyntheticOutcome(args())
    expect((await executeIsolatedSyntheticOutcome(args())).run).toEqual(first.run)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test.each(['audit', 'event'])('R3 composition revision %s failure rolls back claim and required audit', async kind => {
    const before = await prepareCompositionRevision(), audits = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('composition rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('composition rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('composition rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(before.previous); expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(audits)
  })
  test('R3 composition revision rejects stale hash before dispatch', async () => {
    await prepareCompositionRevision(); payload.compositionRevision.failedArlMaterialHash = '1'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(14); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 composition revision rejects extra actual stage history', async () => {
    await prepareCompositionRevision()
    await guarded(Stage.collection.name).insertOne({ customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId), runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), planId: plan.planId, stageExecutionId: 'extra' })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'COMPOSITION_EXTRA_STAGE_HISTORY' } })
    expect(await eventCount()).toBe(14); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 composition revision stops after one new ARL failure and retains it', async () => {
    await prepareCompositionRevision(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false }; return out })
    const read = await executeIsolatedSyntheticOutcome(args()); expect(read.run.status).toBe('FAILED')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    expect(await eventCount()).toBe(16)
  })
  test('R3 saved draft persistence concurrent winner reuses provider and preserves twelve old events', async () => {
    const { previous, saved, draftAdapter } = await prepareDraftPersistence(), before = membershipHash(saved)
    const responses = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = responses.find(row => row.run.status === 'ARL_PASSED')
    expect(read.priorRuns).toHaveLength(6); expect(read.stages[1].attemptNumber).toBe(3); expect(await eventCount()).toBe(14)
    expect(read.grr.filter(row => row.reusedProviderResult)).toHaveLength(2)
    expect(await Event.find({ phase: { $nin: ['DRAFT_PERSISTENCE_CLAIM', 'DRAFT_PERSISTENCE_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(membershipHash(saved)).toBe(before); expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(draftAdapter).not.toHaveBeenCalled()
    expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 saved draft persistence passive and conflicting retries never dispatch again', async () => {
    await prepareDraftPersistence()
    const first = await executeIsolatedSyntheticOutcome(args()), replay = await executeIsolatedSyntheticOutcome(args())
    expect(replay.run).toEqual(first.run); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
  test.each(['audit', 'event'])('R3 saved draft persistence %s failure rolls back the new claim and audit', async kind => {
    const { previous } = await prepareDraftPersistence(), before = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('draft persistence rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('draft persistence rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('draft persistence rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(previous); expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before)
  })
  test('R3 saved draft persistence rejects changed provider hash before claim', async () => {
    await prepareDraftPersistence(); payload.draftPersistence.artifactHash = 'a'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_PERSISTENCE_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(12); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 saved draft persistence rejects a tampered provider audit', async () => {
    const { providerAudit } = await prepareDraftPersistence()
    await guarded(Audit.collection.name).updateOne({ _id: providerAudit._id }, { $set: { 'diff.outputTypeKey': 'ALTERED' } })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_PERSISTENCE_AUDIT_INVALID' } })
    expect(await eventCount()).toBe(12); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 saved draft persistence rejects additional provider history', async () => {
    await prepareDraftPersistence()
    await guarded(Grr.collection.name).insertOne({ customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId),
      runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), executionEvidence: { syntheticClassification: { planId: plan.planId } } })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_EXTRA_PROVIDER_HISTORY' } })
    expect(await eventCount()).toBe(12); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 saved draft persistence stops after one ARL failure', async () => {
    await prepareDraftPersistence(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_EXACT_TEST_FAILURE' }; return out })
    const result = await executeIsolatedSyntheticOutcome(args()); expect(result.run.status).toBe('FAILED'); expect(result.run.failure.failureCode).toBe('ARL_EXACT_TEST_FAILURE')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 handoff recovery persists one concurrent winner and preserves ten events and three stages', async () => {
    const previous = await prepareHandoffRecovery(), oldStages = await Stage.find({}).sort({ _id: 1 }).lean()
    const responses = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = responses.find(row => row.run.status === 'ARL_PASSED'); expect(read.run.status).toBe('ARL_PASSED'); expect(read.priorRuns).toHaveLength(5)
    expect(read.stages[1].attemptNumber).toBe(3); expect(await eventCount()).toBe(12)
    expect(await Event.find({ phase: { $nin: ['HANDOFF_CLAIM', 'HANDOFF_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(oldStages)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
  })
  test('R3 handoff recovery passive and conflicting retries never redispatch', async () => {
    await prepareHandoffRecovery()
    const first = await executeIsolatedSyntheticOutcome(args()), replay = await executeIsolatedSyntheticOutcome(args())
    expect(replay.run).toEqual(first.run); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
  test.each(['audit', 'event'])('R3 handoff recovery %s failure rolls back only the new claim', async kind => {
    const previous = await prepareHandoffRecovery(), before = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('handoff rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('handoff rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('handoff rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(previous); expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before)
  })
  test('R3 handoff recovery rejects stale source and extra native history before dispatch', async () => {
    await prepareHandoffRecovery(); const valid = { ...payload.handoffRecovery }; payload.handoffRecovery.failedResultBodyHash = 'a'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'HANDOFF_SOURCE_INVALID' } })
    payload.handoffRecovery = valid
    await guarded(Stage.collection.name).insertOne({ runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), customerId: new mongoose.Types.ObjectId(p.customerId),
      tenantId: new mongoose.Types.ObjectId(p.tenantId), planId: plan.planId, stageExecutionId: 'unexpected-fourth-stage' })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_EXTRA_STAGE_HISTORY' } })
    expect(await eventCount()).toBe(10); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 handoff recovery preserves ARL failure and stops all retries', async () => {
    await prepareHandoffRecovery(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_EXACT_TEST_FAILURE' }; return out })
    const read = await executeIsolatedSyntheticOutcome(args()); expect(read.run.status).toBe('FAILED'); expect(read.run.failure.failureCode).toBe('ARL_EXACT_TEST_FAILURE')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 decoder repair commits one winner with WD3 lineage while preserving all eight prior receipts and three stages', async () => {
    const { previous } = await prepareDraftRepair(), oldStages = await Stage.find({}).sort({ _id: 1 }).lean()
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    const read = await readIsolatedSyntheticOutcome(args()); expect(read.run.status).toBe('ARL_PASSED'); expect(read.priorRuns).toHaveLength(4)
    expect(read.stages[1].attemptNumber).toBe(3); expect(await eventCount()).toBe(10)
    expect(await Event.find({ phase: { $nin: ['DRAFT_REPAIR_CLAIM', 'DRAFT_REPAIR_RESULT'] } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect(await Stage.find({}).sort({ _id: 1 }).lean()).toEqual(oldStages)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled(); expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('R3 decoder repair detects a fourth native stage rather than hiding it behind its query limit', async () => {
    await prepareDraftRepair(); await guarded(Stage.collection.name).insertOne({ runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), customerId: new mongoose.Types.ObjectId(p.customerId),
      tenantId: new mongoose.Types.ObjectId(p.tenantId), planId: plan.planId, stageExecutionId: 'unexpected-fourth-stage' })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_EXTRA_STAGE_HISTORY' } })
    expect(await eventCount()).toBe(8); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test.each(['audit', 'event'])('R3 decoder repair %s failure rolls back the new claim only', async kind => {
    const { previous } = await prepareDraftRepair(), before = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw Error('decoder repair rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...input) => Event.findOne(...input), create: async () => { throw Error('decoder repair rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('decoder repair rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(previous); expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(before)
  })
  test('R3 decoder repair rejects stale linkage before dispatch', async () => {
    await prepareDraftRepair(); payload.draftRepair.failedDraftMaterialHash = 'a'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'DRAFT_RETRY_SOURCE_INVALID' } })
    expect(await eventCount()).toBe(8); expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 decoder repair preserves an ARL failure and cannot dispatch again under another key', async () => {
    await prepareDraftRepair(); const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => { const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_EXACT_TEST_FAILURE' }; return out })
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
  test('R3 continuation persists one signed pair on concurrent identical retries and preserves original rows', async () => {
    const original = await prepareContinuation()
    const responses = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    expect(await eventCount()).toBe(4)
    const current = await readIsolatedSyntheticOutcome(args()); expect(current.run.status).toBe('ARL_PASSED')
    expect(current.priorRuns).toHaveLength(1)
    expect((await Event.find({ phase: { $in: ['CLAIM', 'RESULT'] } }).sort({ _id: 1 }).lean())).toEqual(original)
    const rows = await Event.find({}).lean()
    for (const row of rows) expect(Audit.hydrate(await Audit.findById(row.auditId).lean()).verifySignature()).toBe(true)
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(2) // original rejected binding plus one continuation
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    await executeIsolatedSyntheticOutcome(args()); expect(await eventCount()).toBe(4)
    expect(responses.every(row => ['UNKNOWN', 'ARL_PASSED'].includes(row.run.status))).toBe(true)
  })
  test('R3 competing continuation keys produce one winner and one conflict', async () => {
    await prepareContinuation()
    const results = await Promise.allSettled([executeIsolatedSyntheticOutcome(args()),
      executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(row => row.status === 'rejected').reason.details.reason).toBe('EXECUTION_ALREADY_CLAIMED')
    expect(await eventCount()).toBe(4); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test.each(['audit', 'event'])('R3 continuation %s failure rolls back both new writes, preserving original history', async kind => {
    const original = await prepareContinuation(), auditBefore = await Audit.find({}).sort({ _id: 1 }).lean()
    if (kind === 'audit') deps.auditService = { ...auditService, log: async (input, options) => {
      await auditService.log(input, options); throw new Error('continuation audit rollback') } }
    else deps.models = { SyntheticOutcomeRunEvent: { collection: Event.collection, findOne: (...values) => Event.findOne(...values),
      create: async () => { throw new Error('continuation event rollback') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('rollback')
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(original)
    expect(await Audit.find({}).sort({ _id: 1 }).lean()).toEqual(auditBefore)
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 continuation with uncertain terminal persistence is retained without any redispatch', async () => {
    await prepareContinuation(); let count = 0
    deps.auditService = { ...auditService, log: async (input, options) => {
      const audit = await auditService.log(input, options); if (++count === 2) throw new Error('continuation terminal rollback'); return audit } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('terminal rollback')
    expect(await eventCount()).toBe(3)
    deps.auditService = auditService
    expect((await executeIsolatedSyntheticOutcome(args())).run).toMatchObject({ status: 'UNKNOWN', terminalReceiptAvailable: false })
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1); expect(await eventCount()).toBe(3)
  })
  test.each([
    [Stage, '', 'planId'], [Stage, '', 'requestId'],
    [Grr, 'executionEvidence.syntheticClassification.', 'planId'], [Grr, 'executionEvidence.syntheticClassification.', 'requestId'],
    [Artifact, 'lineageSummary.syntheticClassification.', 'planId'], [Artifact, 'lineageSummary.syntheticClassification.', 'requestId'],
  ])('R3 rejects native prior %s association with the other identity missing', async (owner, prefix, key) => {
    const original = await prepareContinuation()
    const native = { runtimeInstanceId: new mongoose.Types.ObjectId(runtime._id), customerId: new mongoose.Types.ObjectId(p.customerId),
      tenantId: new mongoose.Types.ObjectId(p.tenantId) }
    if (prefix) native[prefix.split('.')[0]] = { syntheticClassification: { [key]: payload[key] } }
    else native[key] = payload[key]
    await guarded(owner.collection.name).insertOne(native)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'CONTINUATION_PRIOR_EXECUTION_EXISTS' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(original)
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 stale continuation source hash rejects before any new event or provider', async () => {
    const original = await prepareContinuation(); payload.continuation.failedResultBodyHash = 'f'.repeat(64)
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'CONTINUATION_SOURCE_INVALID' } })
    expect(await Event.find({}).sort({ _id: 1 }).lean()).toEqual(original)
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('R3 continuation stops at genuine owner failure and repeated calls never retry ARL', async () => {
    await prepareContinuation()
    const owner = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const out = await owner(input); out.stage.status = 'FAILED'; out.stage.failure = { failureCode: 'ARL_REVIEW_FAILED' }; return out })
    const out = await executeIsolatedSyntheticOutcome(args()); expect(out.run.status).toBe('FAILED')
    await executeIsolatedSyntheticOutcome(args()); expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    expect(await eventCount()).toBe(4)
  })
  test('R3 own once-only slot preserves existing v1/v2 journal rows', async () => {
    await executeIsolatedSyntheticOutcome(args()); await configureDirectRevision(true); await executeIsolatedSyntheticOutcome(args())
    const previous = await Event.find({}).sort({ _id: 1 }).lean(); await configureSuccessor(true)
    await executeIsolatedSyntheticOutcome(args())
    expect(await eventCount()).toBe(6)
    expect(await Event.find({ runtimeInstanceId: { $ne: runtime._id } }).sort({ _id: 1 }).lean()).toEqual(previous)
    expect((await Event.find({ runtimeInstanceId: runtime._id }).lean()).every(row => row.body.version === 'isolated-synthetic-outcome-run.v3')).toBe(true)
  })
  test('R3 identical concurrent requests have one real dispatch winner', async () => {
    await configureSuccessor(); await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    expect(await eventCount()).toBe(2); expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
  })
  test('R3 different concurrent request keys have one exact conflict loser', async () => {
    await configureSuccessor()
    const settled = await Promise.allSettled([executeIsolatedSyntheticOutcome(args()),
      executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } })])
    expect(settled.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.filter(row => row.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(await eventCount()).toBe(2); expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('R3 required claim audit failure rolls back without a claim', async () => {
    await configureSuccessor(); const before = await auditCount()
    deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw new Error('R3 audit failure') } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('R3 audit failure')
    expect(await eventCount()).toBe(0); expect(await auditCount()).toBe(before); expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('R3 event write failure rolls back its signed audit', async () => {
    await configureSuccessor(); const before = await auditCount()
    deps.models = { SyntheticOutcomeRunEvent: { findOne: (...input) => Event.findOne(...input), collection: Event.collection,
      create: async () => { throw new Error('R3 event failure') } } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('R3 event failure')
    expect(await eventCount()).toBe(0); expect(await auditCount()).toBe(before); expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('R3 terminal uncertainty retains CLAIM and cannot redispatch', async () => {
    await configureSuccessor(); let count = 0
    deps.auditService = { ...auditService, log: async (input, options) => { const row = await auditService.log(input, options)
      if (++count === 2) throw new Error('R3 result failure'); return row } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('R3 result failure')
    expect(await eventCount()).toBe(1); const before = await auditCount()
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(await eventCount()).toBe(1); expect(await auditCount()).toBe(before)
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('R3 exact R2-parent unique partial rejects sibling without indexing other customers', async () => {
    await configureSuccessor(); const collection = guarded(RuntimeInstance.collection.name), indexes = await collection.listIndexes().toArray()
    const prior = indexes.find(index => index.unique && Object.hasOwn(index.key, 'revision.parentRuntimeId'))
    await collection.dropIndex(prior.name)
    const otherWitnessIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
    const other = { customerId: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId(p.tenantId),
      revision: { parentRuntimeId: new mongoose.Types.ObjectId(successor.parentRuntimeInstanceId) } }
    try {
      await collection.createIndex({ customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 }, { name: 'ss044_controlled_r2_parent_unique', unique: true,
        partialFilterExpression: { customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId),
          'revision.parentRuntimeId': new mongoose.Types.ObjectId(successor.parentRuntimeInstanceId) } })
      await expect(collection.insertOne({ _id: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId(p.customerId),
        tenantId: new mongoose.Types.ObjectId(p.tenantId), revision: { parentRuntimeId: new mongoose.Types.ObjectId(successor.parentRuntimeInstanceId) } })).rejects.toMatchObject({ code: 11000 })
      await collection.insertMany(otherWitnessIds.map(_id => ({ ...other, _id })))
      expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('ARL_PASSED')
    } finally {
      await guarded(RuntimeInstance.collection.name).deleteMany({ _id: { $in: otherWitnessIds },
        customerId: other.customerId, tenantId: other.tenantId, 'revision.parentRuntimeId': other.revision.parentRuntimeId })
      await collection.dropIndex('ss044_controlled_r2_parent_unique')
      await collection.createIndex(prior.key, { unique: true, partialFilterExpression: prior.partialFilterExpression })
    }
  })
  afterAll(async () => { if (owned) await mongoose.disconnect() })
  test('R2 has its own persisted winner and exact native partial parent index without consuming R1 phase', async () => {
    await executeIsolatedSyntheticOutcome(args())
    const original = await Event.find({}).lean(), parent = await configureDirectRevision(), before = JSON.stringify({ parent, runtime })
    await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    expect(await eventCount()).toBe(4); expect(await auditCount()).toBe(5)
    expect(await Event.find({ runtimeInstanceId: p.runtimeInstanceId }).lean()).toEqual(original)
    const own = await Event.find({ runtimeInstanceId: runtime._id }).lean()
    expect(own.map(row => row.body.version)).toEqual(['isolated-synthetic-outcome-run.v2', 'isolated-synthetic-outcome-run.v2'])
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(2)
    expect(JSON.stringify({ parent, runtime })).toBe(before)
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('ARL_PASSED')
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(2)
  })
  test('R2 claim audit failure rolls back with own slot empty and both native identities untouched', async () => {
    const parent = await configureDirectRevision(), before = JSON.stringify({ parent, runtime })
    deps.auditService = { ...auditService, log: async (input, options) => {
      await auditService.log(input, options); throw new Error('Injected R2 claim audit failure')
    } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('Injected R2')
    expect(await eventCount()).toBe(0); expect(await auditCount()).toBe(1)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
    expect(JSON.stringify({ parent, runtime })).toBe(before)
  })
  test('R2 terminal uncertainty retains its own claim and cannot redispatch under another key', async () => {
    await configureDirectRevision()
    let count = 0
    deps.auditService = { ...auditService, log: async (input, options) => {
      const row = await auditService.log(input, options)
      if (++count === 2) throw new Error('Injected R2 result failure')
      return row
    } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('Injected R2 result')
    expect(await eventCount()).toBe(1); expect(await auditCount()).toBe(2)
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    await expect(executeIsolatedSyntheticOutcome({ ...args(), payload: { ...payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('real exact controlled partial index rejects own sibling but does not index other customers', async () => {
    const collection = guarded(RuntimeInstance.collection.name)
    const indexes = await collection.listIndexes().toArray()
    const parentIndex = indexes.find(index => index.unique && Object.hasOwn(index.key, 'revision.parentRuntimeId'))
    await collection.dropIndex(parentIndex.name)
    const partialFilterExpression = { customerId: new mongoose.Types.ObjectId(p.customerId), tenantId: new mongoose.Types.ObjectId(p.tenantId),
      'revision.parentRuntimeId': new mongoose.Types.ObjectId(p.runtimeInstanceId) }
    await collection.createIndex({ customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 },
      { name: 'ss044_controlled_r1_parent_unique', unique: true, partialFilterExpression })
    await configureDirectRevision()
    const sibling = { ...partialFilterExpression, _id: new mongoose.Types.ObjectId(), revision: { parentRuntimeId: partialFilterExpression['revision.parentRuntimeId'] } }
    delete sibling['revision.parentRuntimeId']
    await expect(collection.insertOne(sibling)).rejects.toMatchObject({ code: 11000 })
    const foreign = { customerId: new mongoose.Types.ObjectId('6ace5ee09bd4472c6be0cb09'), tenantId: partialFilterExpression.tenantId,
      revision: { parentRuntimeId: partialFilterExpression['revision.parentRuntimeId'] } }
    await collection.insertMany([{ ...foreign, _id: new mongoose.Types.ObjectId() }, { ...foreign, _id: new mongoose.Types.ObjectId() }])
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('ARL_PASSED')
    expect(await eventCount()).toBe(2); expect(await auditCount()).toBe(3)
  })
  test('commits signed claim/result and exact read-back without a root write', async () => {
    const before = JSON.stringify(runtime)
    const result = await executeIsolatedSyntheticOutcome(args())
    expect(result).toMatchObject({ classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, run: { status: 'ARL_PASSED' } })
    expect(result.stages.map(stage => stage.stageKey)).toEqual(['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'])
    expect(await eventCount()).toBe(2); expect(await auditCount()).toBe(2)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    expect(JSON.stringify(runtime)).toBe(before)
  })
  test('identical concurrent requests produce one dispatch winner and passive retries', async () => {
    const results = await Promise.all([executeIsolatedSyntheticOutcome(args()), executeIsolatedSyntheticOutcome(args())])
    expect(results).toHaveLength(2)
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    expect(await eventCount()).toBe(2); expect(await auditCount()).toBe(2)
    await executeIsolatedSyntheticOutcome(args())
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('competing request keys cannot create a second run', async () => {
    const a = args(), b = { ...args(), payload: { ...payload, requestKey: randomUUID() } }
    const outcomes = await Promise.allSettled([executeIsolatedSyntheticOutcome(a), executeIsolatedSyntheticOutcome(b)])
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(row => row.status === 'rejected').reason.details.reason).toBe('EXECUTION_ALREADY_CLAIMED')
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
    expect(await eventCount()).toBe(2); expect(await auditCount()).toBe(2)
  })
  test('required claim audit failure rolls back before any dispatch', async () => {
    deps.auditService = { ...auditService, log: async (input, options) => { await auditService.log(input, options); throw new Error('Injected after actual audit write') } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('Injected')
    expect(await eventCount()).toBe(0); expect(await auditCount()).toBe(0)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('receipt write failure rolls back its already written signed audit', async () => {
    const spy = jest.spyOn(Event, 'create').mockRejectedValueOnce(new Error('Injected event write failure'))
    try { await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('Injected event') }
    finally { spy.mockRestore() }
    expect(await eventCount()).toBe(0); expect(await auditCount()).toBe(0)
    expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('terminal write failure retains claim and never dispatches again', async () => {
    let calls = 0
    deps.auditService = { ...auditService, log: async (input, options) => { const row = await auditService.log(input, options); if (++calls === 2) throw new Error('Injected terminal audit failure'); return row } }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toThrow('Injected terminal')
    expect(await eventCount()).toBe(1); expect(await auditCount()).toBe(1)
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('UNKNOWN')
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('failed Working Draft blocks ARL and preserves failure on replay', async () => {
    const success = deps.executeWorkingDraft.getMockImplementation()
    deps.executeWorkingDraft.mockImplementation(async input => {
      const value = await success(input); value.stage.status = 'FAILED'; value.stage.outputFingerprint = ''
      value.stage.failure = { failureCode: 'CONTROLLED_NATIVE_STAGE_FAILURE', safeReason: 'Preserve exact finding', retryable: false }
      return value
    })
    const result = await executeIsolatedSyntheticOutcome(args())
    expect(result.run).toMatchObject({ status: 'FAILED', failure: { failureCode: 'CONTROLLED_NATIVE_STAGE_FAILURE' } })
    expect(deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    expect((await executeIsolatedSyntheticOutcome(args())).run.status).toBe('FAILED')
    expect(deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
  })
  test('ARL failure is preserved, with no new request permitted', async () => {
    const success = deps.approveWorkingDraftMeaning.getMockImplementation()
    deps.approveWorkingDraftMeaning.mockImplementation(async input => {
      const value = await success(input); value.stage.status = 'FAILED'; value.stage.outputFingerprint = ''
      value.stage.failure = { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', safeReason: 'Exact simulated semantic failure', retryable: false }
      return value
    })
    const result = await executeIsolatedSyntheticOutcome(args())
    expect(result.run).toMatchObject({ status: 'FAILED', failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE' } })
    payload = { ...payload, requestKey: randomUUID() }
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('changed frozen basis rejects readback rather than upgrading currentness', async () => {
    await executeIsolatedSyntheticOutcome(args()); frozen.serializationCorrection.bodyHash = 'd'.repeat(64)
    await expect(readIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'CLAIM_BASIS_CHANGED' } })
  })
  test('changed signed audit fails and does not redispatch', async () => {
    await executeIsolatedSyntheticOutcome(args())
    await guarded(Audit.collection.name).updateOne({ 'diff.phase': 'CLAIM' }, { $set: { 'diff.bodyHash': 'd'.repeat(64) } })
    await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
    expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('changed stage material is rejected through immutable receipt binding', async () => {
    await executeIsolatedSyntheticOutcome(args()); stages.get('isolated-stage-2').outputSnapshot.synthetic = false
    await expect(readIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'STAGE_MATERIAL_CHANGED' } })
  })
  test('changed raw provider output retaining its run ID is rejected', async () => {
    await executeIsolatedSyntheticOutcome(args()); providers.get(3).artifact.generatedOutput.synthetic = false
    await expect(readIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'GRR_MATERIAL_CHANGED' } })
  })
  test('provider receipt survives an unknown stage-persistence outcome without redispatch', async () => {
    const success = deps.executeFrameworkGuidance.getMockImplementation()
    deps.executeFrameworkGuidance.mockImplementation(async input => {
      await success(input); stages.delete('isolated-stage-1')
      throw Object.assign(new Error('Simulated stage persistence failure after provider receipt'), { code: 'STAGE_PERSISTENCE_FAILED' })
    })
    const result = await executeIsolatedSyntheticOutcome(args())
    expect(result.run).toMatchObject({ status: 'UNKNOWN', grrRefs: [{ stageLinkage: 'UNRESOLVED', stageExecutionId: '' }] })
    expect(result.grr[0].artifact.generatedOutput).toEqual({ synthetic: true })
    await executeIsolatedSyntheticOutcome(args()); expect(deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    expect(deps.executeWorkingDraft).not.toHaveBeenCalled()
  })
  test('missing required unique index rejects before claiming', async () => {
    await Event.collection.dropIndex('unique_scoped_synthetic_outcome_phase')
    try { await expect(executeIsolatedSyntheticOutcome(args())).rejects.toMatchObject({ details: { reason: 'INDEX_NOT_READY' } }) }
    finally { await Event.createIndexes() }
    expect(await eventCount()).toBe(0); expect(deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
})
