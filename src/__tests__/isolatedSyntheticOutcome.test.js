import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals'
import { randomUUID, createHash } from 'node:crypto'
import express from 'express'
import supertest from 'supertest'
import Event, { assertSyntheticOutcomeRunEvent, SYNTHETIC_OUTCOME_CLASSIFICATION as classification,
  SYNTHETIC_OUTCOME_RUN_VERSION as version, SYNTHETIC_OUTCOME_RUN_REVISION_VERSION as revisionVersion, SYNTHETIC_OUTCOME_RUN_SUCCESSOR_VERSION as successorVersion } from '../models/SyntheticOutcomeRunEvent.js'
import { SNAPSHOT_RECOVERY_POLICY as p } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { buildDirectSyntheticRevisionLineage, buildSuccessorSyntheticRevisionLineage,
  SYNTHETIC_SUCCESSOR_IDENTITY as successor } from '../services/syntheticOutcomeIsolationService.js'
import { buildOutcomeKnowledgeCompositionPlanCandidate, assertOutcomeKnowledgeCompositionPlanIntegrity, assertOutcomeKnowledgeCompositionPlanMatchesRuntime } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import Audit from '../models/AuditLog.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { AUTHORISED_ARL_APPROVAL, AUTHORISED_ARL_SCOPE, AUTHORISED_ARL_BODY, authorisedArlRequestIdentity, verifyNativeAuthorisedArlReview } from '../services/outcomeArlTransportRecoveryService.js'

let nativeIsolatedOwner

const eventFixture = (phase = 'CLAIM') => {
  const requestId = randomUUID()
  const body = { version, classification: { classification, runtimeInstanceId: p.runtimeInstanceId,
    customerId: p.customerId, tenantId: p.tenantId, authoritative: false }, eventId: randomUUID(), phase,
    requestKey: randomUUID(), payloadHash: 'a'.repeat(64), actorUserId: p.actorUserId,
    createdAt: '2026-10-16T19:30:00.000Z', basis: { membershipHash: p.membershipHash,
      basisStateVersion: p.stateVersion, snapshotId: p.snapshotId, lockSnapshotId: 'actual-unit-lock',
      lockSnapshotHash: 'f'.repeat(64), counts: { sources: 8, evidence: 47, sections: 6 },
      correctionReceiptId: randomUUID(), correctionBodyHash: 'b'.repeat(64) },
    plan: { requestId, planId: `outcome_kcp_${randomUUID()}`, recordId: '6ad267752b7668e0c1ae01af', planFingerprint: 'c'.repeat(64) },
    requestBinding: { requestId, draftId: `outcome_draft_${randomUUID()}`, draftIterationId: `outcome_draft_iteration_${randomUUID()}` },
    claim: null, status: 'CLAIMED', stageRefs: [], grrRefs: [], failure: null }
  if (phase === 'RESULT') Object.assign(body, { claim: { eventId: randomUUID(), bodyHash: 'd'.repeat(64) }, status: 'UNKNOWN' })
  body.payloadHash = membershipHash({ requestKey: body.requestKey, requestId, planId: body.plan.planId, expectedPlanFingerprint: body.plan.planFingerprint })
  return { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId,
    eventId: body.eventId, phase, requestKey: body.requestKey, payloadHash: body.payloadHash, body,
    bodyHash: membershipHash(body), auditId: '6ad267752b7668e0c1ae01ad', auditSignatureVersion: 1 }
}

describe('isolated run event append-only contract (no persistence proof)', () => {
  test.each(['CLAIM', 'RESULT'])('admits an explicitly classified %s without operational defaults', phase => {
    const row = eventFixture(phase)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    expect(new Event(row).validateSync()).toBeUndefined()
    expect(new Event().body).toBeUndefined()
  })
  test('requires runtime-wide phase uniqueness across request keys and no automatic indexes', () => {
    expect(Event.schema.options).toMatchObject({ strict: 'throw', minimize: false, autoCreate: false, autoIndex: false })
    expect(Event.schema.indexes().map(([fields, options]) => ({ fields, unique: options.unique, name: options.name }))).toEqual([
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, phase: 1 }, unique: true, name: 'unique_scoped_synthetic_outcome_phase' },
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, eventId: 1 }, unique: true, name: 'unique_scoped_synthetic_outcome_event' },
    ])
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects immutable %s before any connection', async operation => {
    await expect(Event[operation]({}, {})).rejects.toThrow('immutable')
  })
  test.each([
    row => { row.body.classification.authoritative = true },
    row => { row.body.actorUserId = '6a6c763dcace7a21bd41efa8' },
    row => { row.body.classification.runtimeInstanceId = '6a6c763dcace7a21bd41efa8' },
    row => { row.body.basis.membershipHash = 'e'.repeat(64) },
    row => { row.body.requestBinding.requestId = randomUUID() },
    row => { row.body.stageRefs = [{ stageKey: 'OUTPUT_SHAPING', stageExecutionId: 'forbidden', status: 'SUCCEEDED', inputFingerprint: 'a'.repeat(64), outputFingerprint: '' }] },
    row => { row.body.extraAuthority = true },
  ])('rejects resealed invalid semantic identity %j', change => {
    const row = eventFixture(); change(row); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
  test('never accepts an ARL pass without all three successful real-stage references', () => {
    const row = eventFixture('RESULT'); row.body.status = 'ARL_PASSED'; row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
  test('blocks invalid insert/bulk/save even when caller skips normal validation', async () => {
    const insert = jest.spyOn(Event.collection, 'insertOne').mockImplementation(() => { throw new Error('Unexpected storage') })
    const bulk = jest.spyOn(Event.collection, 'bulkWrite').mockImplementation(() => { throw new Error('Unexpected storage') })
    try {
      await expect(new Event({ body: {} }).save({ validateBeforeSave: false })).rejects.toThrow()
      await expect(Event.insertMany([{ body: {} }], { lean: true })).rejects.toThrow()
      await expect(Event.bulkWrite([{ insertOne: { document: { body: {} } } }], { skipValidation: true })).rejects.toThrow()
      await expect(Event.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow()
      expect(insert).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled()
    } finally { insert.mockRestore(); bulk.mockRestore() }
  })
})

describe('immutable native identity is independent of caller labels', () => {
  let guards
  beforeAll(async () => { guards = await import('../services/syntheticOutcomeIsolationService.js') })
  test.each([
    { _id: p.runtimeInstanceId }, { runtimeInstanceKey: p.runtimeInstanceKey },
    { revision: { rootRuntimeId: p.runtimeInstanceId } }, { revision: { parentRuntimeId: p.runtimeInstanceId } },
  ])('normal delivery rejects controlled identity even when classification is stripped %j', runtime => {
    expect(() => guards.assertNormalOutcomeRuntime({ ...runtime, classification: undefined })).toThrow('isolated')
    expect(guards.isControlledSyntheticOutcomeRuntime(runtime)).toBe(true)
  })
  test('a caller synthetic label cannot make an unrelated native runtime controlled', () => {
    const runtime = { _id: '6a6c763dcace7a21bd41efa8', runtimeInstanceKey: 'different-native-runtime',
      classification, synthetic: true, allowSynthetic: true }
    expect(guards.isControlledSyntheticOutcomeRuntime(runtime)).toBe(false)
    expect(guards.assertNormalOutcomeRuntime(runtime)).toBe(runtime)
  })
})

// Query/model seams exercise coordinator ordering and errors only. They do not prove transactions,
// indexes, concurrency or Mongo rollback; those belong to the separate real integration suite.
const coordinatorFixture = () => {
  const rows = [], audits = [], stages = [], calls = [], grrPairs = []
  const runtime = { _id: p.runtimeInstanceId, customerId: p.customerId, tenantId: p.tenantId,
    runtimeInstanceKey: p.runtimeInstanceKey, revision: { revisionNumber: 1 }, status: 'LOCKED',
    stateVersion: p.stateVersion, framework_state: { lock: { locked: true } } }
  const frozen = { available: true, completeness: 'VERIFIED', snapshotId: p.snapshotId,
    membershipHash: p.membershipHash, basisStateVersion: p.stateVersion,
    lockSnapshotId: 'actual-unit-lock', lockSnapshotHash: 'f'.repeat(64), counts: { sources: 8, evidence: 47, sections: 6 },
    serializationCorrection: { receiptId: randomUUID(), bodyHash: 'b'.repeat(64) } }
  const basis = { snapshotId: frozen.snapshotId, membershipHash: frozen.membershipHash, basisStateVersion: frozen.basisStateVersion,
    lockSnapshotId: frozen.lockSnapshotId, lockSnapshotHash: frozen.lockSnapshotHash, counts: { ...frozen.counts },
    correctionReceiptId: frozen.serializationCorrection.receiptId, correctionBodyHash: frozen.serializationCorrection.bodyHash }
  const requestId = randomUUID(), planId = `outcome_kcp_${randomUUID()}`
  const plan = { _id: '6ad267752b7668e0c1ae01af', customerId: p.customerId, tenantId: p.tenantId,
    runtimeInstanceId: p.runtimeInstanceId, requestId, planId, planFingerprint: 'c'.repeat(64), payload: {
      requestId, requestAssociation: { sessionId: '', basis, classification: {
        classification, customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId, authoritative: false } } } }
  const collection = { listIndexes: jest.fn(() => ({ toArray: async () => Event.schema.indexes().map(([key, options]) => ({ key, ...options })) })) }
  const EventModel = { collection, findOne: jest.fn(async filter => rows.find(row => row.phase === filter.phase && String(row.runtimeInstanceId) === String(filter.runtimeInstanceId)) || null),
    create: jest.fn(async ([row]) => { assertSyntheticOutcomeRunEvent(row); rows.push(row); calls.push(`persist:${row.phase}`); return [row] }) }
  const audit = { AUDIT_ACTIONS: { RUNTIME_STATE_MUTATED: 'RUNTIME_STATE_MUTATED' }, RESOURCE_TYPES: { RuntimeInstance: 'RuntimeInstance' },
    log: jest.fn(async input => { const row = { ...input, _id: randomUUID().replaceAll('-', '').slice(0, 24), signatureVersion: 1 }; audits.push(row); calls.push(`audit:${input.diff.phase}`); return row }) }
  const deps = { env: { nodeEnv: 'test', appEnv: 'development' }, databaseName: 'ss044_' + 'a'.repeat(32),
    getRuntimeInstance: jest.fn(async () => runtime), assertRuntimePermission: jest.fn(async () => {}),
    readVerifiedBasis: jest.fn(async () => frozen), readPlan: jest.fn(async () => plan), assertPlanIntegrity: jest.fn(), assertPlanMatchesRuntime: jest.fn(),
    assertStageIntegrity: jest.fn(async () => {}), readStage: jest.fn(async ref => stages.find(row => row.stageExecutionId === ref.stageExecutionId)),
    verifyAudit: jest.fn(() => true), auditService: audit, collectGrrEvidence: jest.fn(async ({ claim }) => grrPairs.filter(pair => pair.execution.executionEvidence.syntheticClassification.runEventId === claim.eventId)),
    models: { SyntheticOutcomeRunEvent: EventModel, AuditLog: { findOne: jest.fn(async filter => audits.find(row => String(row._id) === String(filter._id))) } },
    mongoose: { startSession: jest.fn(async () => ({ withTransaction: async fn => fn(), endSession: jest.fn(async () => {}) })) } }
  const owner = stageKey => jest.fn(async args => {
    calls.push(`owner:${stageKey}`)
    const stage = { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: runtime._id,
      stageKey, stageExecutionId: `${stageKey}-${randomUUID()}`, status: 'SUCCEEDED', requestId, planId,
      planFingerprint: plan.planFingerprint, ...args.requestBinding, inputFingerprint: 'a'.repeat(64), outputFingerprint: 'b'.repeat(64), attemptFingerprint: 'd'.repeat(64) }
    const order = ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'].indexOf(stageKey) + 1
    const previous = stages.at(-1)
    Object.assign(stage, { attemptNumber: 1, stageOrder: order, predecessorStageExecutionId: previous?.stageExecutionId || '',
      predecessorAttemptFingerprint: previous?.attemptFingerprint || '', inputSnapshot: { sourceStage: previous ? {
        stageKey: previous.stageKey, stageExecutionId: previous.stageExecutionId, attemptFingerprint: previous.attemptFingerprint,
        outputFingerprint: previous.outputFingerprint } : null }, executionIdentity: { executionMode: 'LIVE_TEST',
        grrExecutionId: `grr_exec_${randomUUID()}`, grrRuntimeArtifactId: `grr_art_${randomUUID()}` } })
    const claim = rows.findLast(row => ['CLAIM', 'CONTINUATION_CLAIM'].includes(row.phase) && String(row.runtimeInstanceId) === runtime._id)
    const syntheticClassification = { ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash,
      requestId, planId, planFingerprint: plan.planFingerprint, ...args.requestBinding }
    const common = { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: runtime._id,
      executionId: stage.executionIdentity.grrExecutionId, outputTypeKey: stageKey === 'FRAMEWORK_GUIDANCE' ? 'FRAMEWORK_GUIDANCE_ANALYSIS' : stageKey }
    grrPairs.push({ execution: { ...common, artifactIds: [stage.executionIdentity.grrRuntimeArtifactId], status: 'SUCCEEDED', executionEvidence: { syntheticClassification } }, artifact: {
      ...common, runtimeArtifactId: stage.executionIdentity.grrRuntimeArtifactId, artifactType: classification,
      generatedOutput: { qualifiedMeaning: `Actual controlled ${stageKey} unit-owner output` }, lineageSummary: { syntheticClassification } } })
    stages.push(stage); return { stage }
  })
  deps.executeFrameworkGuidance = owner('FRAMEWORK_GUIDANCE')
  deps.executeWorkingDraft = owner('WORKING_DRAFT')
  deps.approveWorkingDraftMeaning = owner('ARL_MEANING_REVIEW')
  const factory = () => jest.fn(() => ({ execute: jest.fn() }))
  const providerRuntimeDeps = { executionMode: 'LIVE_TEST', providerDescriptor: { providerKey: 'unit-controlled-provider' },
    frameworkGuidanceProviderAdapterFactory: factory(), workingDraftProviderAdapterFactory: factory(), arlMeaningReviewProviderAdapterFactory: factory() }
  const payload = { requestKey: randomUUID(), requestId, planId, expectedPlanFingerprint: plan.planFingerprint }
  const args = { actorUserId: p.actorUserId, runtimeInstanceId: p.runtimeInstanceId, scopes: { testSelectedScope: true }, payload, deps, providerRuntimeDeps }
  return { args, deps, runtime, frozen, plan, rows, audits, stages, grrPairs, calls, EventModel, audit }
}

describe('isolated coordinator actual service with controlled dependency seams', () => {
  let service
  beforeAll(async () => { service = await import('../services/isolatedSyntheticOutcomeService.js'); nativeIsolatedOwner = service })
  test('stored stages use detached validation without saving or weakening signed material checks', async () => {
    const f = coordinatorFixture()
    await service.executeIsolatedSyntheticOutcome(f.args)
    delete f.deps.assertStageIntegrity
    const validate = jest.spyOn(Stage.prototype, 'validate').mockImplementation(async function () {
      expect(this.isNew).toBe(true)
    })
    const save = jest.spyOn(Stage.prototype, 'save')
    try {
      const read = await service.readIsolatedSyntheticOutcome(f.args)
      expect(read.stages).toHaveLength(3)
      expect(validate).toHaveBeenCalledTimes(3)
      expect(save).not.toHaveBeenCalled()
      f.stages[0].outputFingerprint = 'e'.repeat(64)
      await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'STAGE_MATERIAL_CHANGED' } })
    } finally { validate.mockRestore(); save.mockRestore() }
  })
  test.each([
    ['ENVIRONMENT_DENIED', f => { f.deps.env.appEnv = 'production' }],
    ['ENVIRONMENT_DENIED', f => { f.deps.databaseName = 'customer-production' }],
    ['ACTOR_OR_RUNTIME_DENIED', f => { f.args.actorUserId = '6a6c763dcace7a21bd41efa8' }],
    ['ACTOR_OR_RUNTIME_DENIED', f => { f.args.runtimeInstanceId = '6a6c763dcace7a21bd41efa8' }],
    ['RUNTIME_SCOPE_DENIED', f => { f.runtime.tenantId = '6a6c763dcace7a21bd41efa8' }],
    ['RUNTIME_SCOPE_DENIED', f => { f.runtime.revision.revisionNumber = 2 }],
    ['RUNTIME_SCOPE_DENIED', f => { f.runtime.framework_state.lock.locked = false }],
    ['RECOVERED_BASIS_REQUIRED', f => { f.frozen.counts.evidence = 46 }],
    ['RECOVERED_BASIS_REQUIRED', f => { f.frozen.serializationCorrection = null }],
  ])('rejects %s before planner/provider or event creation', async (reason, alter) => {
    const f = coordinatorFixture(); alter(f); f.deps.planRequest = jest.fn()
    await expect(service.planIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason } })
    expect(f.deps.planRequest).not.toHaveBeenCalled(); expect(f.EventModel.create).not.toHaveBeenCalled()
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('awaits rejected permission and basis promises rather than producing empty success', async () => {
    const f = coordinatorFixture(), denied = Object.assign(new Error('denied'), { status: 403, code: 'FORBIDDEN' })
    f.deps.assertRuntimePermission.mockRejectedValue(denied)
    await expect(service.inspectIsolatedSyntheticOutcome(f.args)).rejects.toBe(denied)
    expect(f.deps.readVerifiedBasis).not.toHaveBeenCalled()
    f.deps.assertRuntimePermission.mockResolvedValue(undefined); f.deps.readVerifiedBasis.mockRejectedValue(new Error('missing canonical source'))
    await expect(service.inspectIsolatedSyntheticOutcome(f.args)).rejects.toThrow('missing canonical source')
    expect(f.EventModel.findOne).not.toHaveBeenCalled()
  })
  test('missing event collection is a read-only persistence hold, never an ARL result', async () => {
    const f = coordinatorFixture()
    f.EventModel.collection.listIndexes.mockReturnValue({ toArray: async () => { throw Object.assign(new Error('namespace missing'), { code: 26 }) } })
    const result = await service.readIsolatedSyntheticOutcome(f.args)
    expect(result).toMatchObject({ run: { status: 'NOT_STARTED' }, stages: [],
      persistenceReadiness: { status: 'UNAVAILABLE', reason: 'INDEX_NOT_READY' }, scope: { runtimeInstanceId: p.runtimeInstanceId } })
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ status: 503, details: { reason: 'INDEX_NOT_READY' } })
    expect(f.EventModel.create).not.toHaveBeenCalled()
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('readiness does not turn unrelated database dependency failures into a successful hold', async () => {
    const f = coordinatorFixture(), failure = new Error('database disconnected')
    f.EventModel.collection.listIndexes.mockReturnValue({ toArray: async () => { throw failure } })
    await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toBe(failure)
  })
  test.each(['planIsolatedSyntheticOutcome', 'confirmIsolatedSyntheticOutcomePlan'])('passes server-derived classified association through %s', async operation => {
    const f = coordinatorFixture(), handler = jest.fn(async input => {
      await input.deps.authorizeRuntime(f.runtime)
      return { status: 'CLARIFICATION_REQUIRED', requestId: f.plan.requestId }
    })
    f.deps[operation.startsWith('plan') ? 'planRequest' : 'confirmPlan'] = handler
    const result = await service[operation](f.args)
    expect(result).toMatchObject({ classification, authoritative: false, normalOutputAvailable: false, authorisesApproval: false })
    expect(handler.mock.calls[0][0].deps.requestAssociation).toEqual(f.plan.payload.requestAssociation && {
      classification: f.plan.payload.requestAssociation.classification, basis: f.plan.payload.requestAssociation.basis })
    expect(f.deps.assertRuntimePermission).toHaveBeenCalledTimes(2)
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
  test.each([
    ['PLAN_CLASSIFICATION_OR_SCOPE_INVALID', f => { delete f.plan.payload.requestAssociation.classification }],
    ['PLAN_CLASSIFICATION_OR_SCOPE_INVALID', f => { f.plan.payload.requestId = randomUUID() }],
    ['PROVIDER_NOT_CONFIGURED', f => { delete f.args.providerRuntimeDeps.arlMeaningReviewProviderAdapterFactory }],
    ['INDEX_NOT_READY', f => { f.EventModel.collection.listIndexes.mockReturnValue({ toArray: async () => [] }) }],
  ])('rejects %s before claim or provider invocation', async (reason, alter) => {
    const f = coordinatorFixture(); alter(f)
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason } })
    expect(f.EventModel.create).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test.each(['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'])('stops at failed %s without invoking any later owner', async failureStage => {
    const f = coordinatorFixture(), keys = ['executeFrameworkGuidance', 'executeWorkingDraft', 'approveWorkingDraftMeaning']
    const index = ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'].indexOf(failureStage), original = f.deps[keys[index]]
    f.deps[keys[index]] = jest.fn(async args => { const result = await original(args); result.stage.status = 'FAILED'; result.stage.failure = { failureCode: 'EXACT_PROVIDER_FINDING' }; return result })
    const result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'FAILED', failure: { failureCode: 'EXACT_PROVIDER_FINDING' } })
    for (const key of keys.slice(index + 1)) expect(f.deps[key]).not.toHaveBeenCalled()
    expect(f.calls.slice(0, 3)).toEqual(['audit:CLAIM', 'persist:CLAIM', 'owner:FRAMEWORK_GUIDANCE'])
    expect(f.rows.map(row => row.phase)).toEqual(['CLAIM', 'RESULT'])
    const before = [...f.calls]; await service.executeIsolatedSyntheticOutcome(f.args)
    expect(f.calls).toEqual(before)
  })
  test('stops after successful ARL, binds deterministic native request identity and never creates ordinary outputs', async () => {
    const f = coordinatorFixture(), result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(f.calls.filter(item => item.startsWith('owner:'))).toEqual(['owner:FRAMEWORK_GUIDANCE', 'owner:WORKING_DRAFT', 'owner:ARL_MEANING_REVIEW'])
    const identity = f.deps.executeFrameworkGuidance.mock.calls[0][0]
    for (const key of ['executeWorkingDraft', 'approveWorkingDraftMeaning']) expect(f.deps[key].mock.calls[0][0]).toMatchObject({
      requestBinding: identity.requestBinding, planRecordId: f.plan._id, expectedPlanFingerprint: f.plan.planFingerprint,
      providerDescriptor: f.args.providerRuntimeDeps.providerDescriptor })
    expect(result).toMatchObject({ classification, normalOutputAvailable: false, authorisesApproval: false })
    expect(f.rows).toHaveLength(2)
    expect(f.args.providerRuntimeDeps.arlMeaningReviewProviderAdapterFactory).toHaveBeenCalledTimes(1)
  })
  test('required claim audit rejection prevents every stage owner and creates no event', async () => {
    const f = coordinatorFixture(), error = new Error('required audit unavailable')
    f.audit.log.mockRejectedValue(error)
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toBe(error)
    expect(f.EventModel.create).not.toHaveBeenCalled()
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
    expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled()
    expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
  })
  test.each(['sparse', 'partialFilterExpression'])('rejects unsafe %s unique-index metadata before any claim/provider', async option => {
    const f = coordinatorFixture()
    f.EventModel.collection.listIndexes.mockReturnValue({ toArray: async () => Event.schema.indexes().map(([key, options]) => ({
      key, ...options, [option]: option === 'sparse' ? true : { phase: 'CLAIM' } })) })
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ status: 503, details: { reason: 'INDEX_NOT_READY' } })
    expect(f.audit.log).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('mismatched owner lineage becomes UNKNOWN without invoking later stages', async () => {
    const f = coordinatorFixture(), original = f.deps.executeFrameworkGuidance
    f.deps.executeFrameworkGuidance = jest.fn(async args => {
      const result = await original(args); result.stage.requestId = randomUUID(); return result
    })
    const result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED' } })
    expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    expect(result.run.stageRefs).toEqual([])
  })
  test('changed persisted stage content cannot be delivered as the recorded result', async () => {
    const f = coordinatorFixture(); await service.executeIsolatedSyntheticOutcome(f.args)
    f.stages[0].outputFingerprint = 'f'.repeat(64)
    await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'STAGE_MATERIAL_CHANGED' } })
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test.each([
    ['GRR_MATERIAL_CHANGED', f => { f.grrPairs[0].artifact.generatedOutput.qualifiedMeaning = 'Changed native output' }],
    ['GRR_MATERIAL_CHANGED', f => { f.grrPairs[0].execution.provider = { alteredModel: 'changed' } }],
    ['GRR_LINEAGE_INVALID', f => { f.grrPairs[0].artifact.lineageSummary.syntheticClassification.runBodyHash = 'e'.repeat(64) }],
    ['GRR_LINEAGE_INVALID', f => { f.grrPairs[0].execution.executionEvidence.syntheticClassification.planId = `outcome_kcp_${randomUUID()}` }],
    ['GRR_LINEAGE_INVALID', f => { f.grrPairs[0].execution.executionEvidence.syntheticClassification.authoritative = true }],
    ['GRR_LINEAGE_INVALID', f => { f.grrPairs[0].artifact.tenantId = '6a6c763dcace7a21bd41efa8' }],
    ['GRR_LINEAGE_INVALID', f => { f.grrPairs[0].artifact.artifactType = 'GOVERNED_REASONING_OUTPUT' }],
    ['GRR_POPULATION_INVALID', f => { f.grrPairs.push(f.grrPairs[0]) }],
    ['GRR_MISSING', f => { f.grrPairs.pop() }],
  ])('rejects %s for changed pinned native GRR population without redispatch', async (reason, alter) => {
    const f = coordinatorFixture(); await service.executeIsolatedSyntheticOutcome(f.args); alter(f)
    await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason } })
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    expect(f.deps.executeWorkingDraft).toHaveBeenCalledTimes(1)
    expect(f.deps.approveWorkingDraftMeaning).toHaveBeenCalledTimes(1)
  })
  test('UNKNOWN preserves committed provider evidence when its stage persistence throws', async () => {
    const f = coordinatorFixture(), nativeProviderOwner = f.deps.executeFrameworkGuidance
    f.deps.executeFrameworkGuidance = jest.fn(async args => {
      await nativeProviderOwner(args)
      throw Object.assign(new Error('provider committed; stage persistence failed'), {
        code: 'STAGE_PERSISTENCE_FAILED', details: { failedBoundary: 'STAGE_AUDIT', token: 'must-not-expose' } })
    })
    const result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'UNKNOWN', stageRefs: [], failure: { failureCode: 'STAGE_PERSISTENCE_FAILED',
      details: { failedBoundary: 'STAGE_AUDIT', token: '[REDACTED]' } } })
    expect(result.run.grrRefs).toHaveLength(1)
    expect(result.run.grrRefs[0]).toMatchObject({ stageKey: 'FRAMEWORK_GUIDANCE', stageLinkage: 'UNRESOLVED', stageExecutionId: '',
      executionHash: membershipHash(f.grrPairs[0].execution), artifactHash: membershipHash(f.grrPairs[0].artifact) })
    expect(result.grr[0].artifact.generatedOutput).toEqual(f.grrPairs[0].artifact.generatedOutput)
    await service.executeIsolatedSyntheticOutcome(f.args)
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
  })
  test('missing terminal remains UNKNOWN and exposes committed native pairs passively as unresolved', async () => {
    const f = coordinatorFixture(), create = f.EventModel.create.getMockImplementation()
    f.EventModel.create.mockImplementation(async (records, options) => {
      if (records[0].phase === 'RESULT') throw new Error('terminal persistence unavailable')
      return create(records, options)
    })
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toThrow('terminal persistence unavailable')
    const result = await service.readIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'UNKNOWN', terminalReceiptAvailable: false })
    expect(result.run.grrRefs).toHaveLength(3)
    expect(result.run.grrRefs.every(ref => ref.stageLinkage === 'UNRESOLVED' && ref.stageExecutionId === '')).toBe(true)
    expect(f.rows.map(row => row.phase)).toEqual(['CLAIM'])
    await service.executeIsolatedSyntheticOutcome(f.args)
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test.each([
    ['STAGE_ORDER_INVALID', stage => { stage.stageKey = 'ARL_MEANING_REVIEW' }],
    ['STAGE_ORDER_INVALID', stage => { stage.stageOrder = 3 }],
    ['STAGE_ORDER_INVALID', stage => { stage.attemptNumber = 2 }],
    ['STAGE_PREDECESSOR_INVALID', stage => { stage.predecessorStageExecutionId = 'different-native-predecessor' }],
    ['STAGE_PREDECESSOR_INVALID', stage => { stage.predecessorAttemptFingerprint = 'e'.repeat(64) }],
    ['STAGE_PREDECESSOR_INVALID', stage => { stage.inputSnapshot.sourceStage.outputFingerprint = 'f'.repeat(64) }],
    ['LIVE_STAGE_PROVIDER_REQUIRED', stage => { stage.executionIdentity.executionMode = 'INTERNAL_GOVERNED' }],
  ])('rejects %s before next stage for changed ordered predecessor/provider receipt', async (reason, change) => {
    const f = coordinatorFixture(), owner = f.deps.executeWorkingDraft
    f.deps.executeWorkingDraft = jest.fn(async args => { const result = await owner(args); change(result.stage); return result })
    const result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'UNKNOWN', failure: { details: { reason } } })
    expect(result.run.stageRefs).toHaveLength(1)
    expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    expect(result.run.grrRefs.filter(ref => ref.stageLinkage === 'UNRESOLVED')).toHaveLength(1)
  })
  test.each([
    ['missing audit ID', row => { delete row.auditId }],
    ['null audit ID', row => { row.auditId = null }],
    ['malformed audit ID', row => { row.auditId = 'not-an-object-id' }],
    ['missing signature version', row => { delete row.auditSignatureVersion }],
    ['zero signature version', row => { row.auditSignatureVersion = 0 }],
    ['negative signature version', row => { row.auditSignatureVersion = -1 }],
    ['fractional signature version', row => { row.auditSignatureVersion = 1.5 }],
    ['unsafe signature version', row => { row.auditSignatureVersion = Number.MAX_SAFE_INTEGER + 1 }],
    ['string signature version', row => { row.auditSignatureVersion = '1' }],
  ])('rejects raw event %s before attempting an audit lookup', async (_label, alter) => {
    const f = coordinatorFixture(); await service.executeIsolatedSyntheticOutcome(f.args)
    alter(f.rows[0]); f.deps.models.AuditLog.findOne.mockClear(); f.deps.verifyAudit.mockClear()
    await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toThrow('run event is invalid')
    expect(f.deps.models.AuditLog.findOne).not.toHaveBeenCalled()
    expect(f.deps.verifyAudit).not.toHaveBeenCalled()
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('rejects a returned audit with a different ID even when the signature seam verifies its body', async () => {
    const f = coordinatorFixture(); await service.executeIsolatedSyntheticOutcome(f.args)
    f.deps.models.AuditLog.findOne.mockImplementation(async filter => {
      const correctAudit = f.audits.find(row => String(row._id) === String(filter._id))
      return { ...correctAudit, _id: '6ad267752b7668e0c1ae01ae' }
    })
    await expect(service.readIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'EVENT_AUDIT_INVALID' } })
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test('provider exception is retained as UNKNOWN and an identical retry cannot redispatch', async () => {
    const f = coordinatorFixture(); f.deps.executeFrameworkGuidance.mockRejectedValue(Object.assign(new Error('ambiguous transport'), { code: 'PROVIDER_UNCONFIRMED' }))
    const result = await service.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'PROVIDER_UNCONFIRMED' } })
    await service.executeIsolatedSyntheticOutcome(f.args)
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
    expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    f.args.payload.requestKey = randomUUID()
    await expect(service.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
  })
})

describe('strict isolated transport and mounted controller (simulated authentication only)', () => {
  const owners = Object.fromEntries(['inspectIsolatedSyntheticOutcome', 'planIsolatedSyntheticOutcome',
    'confirmIsolatedSyntheticOutcomePlan', 'executeIsolatedSyntheticOutcome', 'readIsolatedSyntheticOutcome'].map(key => [key, jest.fn()]))
  let app, schemas
  const path = `/${p.runtimeInstanceId}/synthetic-outcome`
  const selectedScope = `?customerId=${p.customerId}&tenantId=${p.tenantId}`
  beforeAll(async () => {
    schemas = await import('../validators/isolatedSyntheticOutcome.validator.js')
    jest.unstable_mockModule('../services/isolatedSyntheticOutcomeService.js', () => owners)
    jest.unstable_mockModule('../services/isolatedSyntheticOutcomeCompletionService.js', () => ({
      readLatestIsolatedSyntheticOutcome: owners.readIsolatedSyntheticOutcome,
      completeIsolatedSyntheticOutcome: jest.fn(),
    }))
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({
      buildRuntimeStateRequestScopes: ({ scopes, query }) => ({ ...scopes, selectedCustomerId: query.customerId, selectedTenantId: query.tenantId }),
    }))
    const handlers = await import('../controllers/isolatedSyntheticOutcome.controller.js')
    app = express(); app.use(express.json())
    app.locals.outcomeStudioReasoningDeps = { executionMode: 'LIVE_TEST', trustedServerTransport: true }
    app.use((req, _res, next) => { req.context = { userId: req.get('x-unit-actor') || p.actorUserId }; req.scopes = { authenticatedScope: true }; req.requestId = 'mounted-unit'; next() })
    app.get('/:runtimeInstanceId/synthetic-outcome', schemas.validateIsolatedSyntheticScope, handlers.inspectIsolatedSyntheticOutcomeEndpoint)
    app.post('/:runtimeInstanceId/synthetic-outcome/plan', schemas.validateIsolatedSyntheticScope, schemas.validateIsolatedSyntheticPlan, handlers.planIsolatedSyntheticOutcomeEndpoint)
    app.post('/:runtimeInstanceId/synthetic-outcome/requests/:requestId/confirm', schemas.validateIsolatedSyntheticScope, schemas.validateIsolatedSyntheticRequestParams,
      schemas.validateIsolatedSyntheticConfirm, handlers.confirmIsolatedSyntheticOutcomePlanEndpoint)
    app.post('/:runtimeInstanceId/synthetic-outcome/execute', schemas.validateIsolatedSyntheticScope, schemas.validateIsolatedSyntheticExecute, handlers.executeIsolatedSyntheticOutcomeEndpoint)
    app.get('/:runtimeInstanceId/synthetic-outcome/run', schemas.validateIsolatedSyntheticScope, handlers.readIsolatedSyntheticOutcomeEndpoint)
    app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'REJECTED_DEPENDENCY' } }))
  })
  beforeEach(() => { Object.values(owners).forEach(owner => owner.mockReset()) })
  test.each(['actorUserId', 'classification', 'force', 'providerRuntimeDeps', 'stageOutputs', 'allowSynthetic'])('rejects caller %s override before execution', async key => {
    const response = await supertest(app).post(path + '/execute' + selectedScope).send({ ...coordinatorFixture().args.payload, [key]: true })
    expect(response.status).toBe(422); expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
  })
  test.each(['requestKey', 'requestId', 'planId', 'expectedPlanFingerprint'])('requires execution %s', async key => {
    const body = coordinatorFixture().args.payload; delete body[key]
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(422)
    expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
  })
  test('mounted continuation accepts only exact immutable prior event references', async () => {
    const body = { ...coordinatorFixture().args.payload, continuation: {
      failedClaimEventId: randomUUID(), failedClaimBodyHash: 'a'.repeat(64),
      failedResultEventId: randomUUID(), failedResultBodyHash: 'b'.repeat(64),
    } }
    owners.executeIsolatedSyntheticOutcome.mockResolvedValue({ status: 'UNKNOWN' })
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(200)
    expect(owners.executeIsolatedSyntheticOutcome).toHaveBeenCalledWith(expect.objectContaining({ payload: body }))
    owners.executeIsolatedSyntheticOutcome.mockClear()
    body.continuation.force = true
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(422)
    expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
  })
  test('mounted descriptive replay carries only the strict predecessor link and preserves rejected owner errors', async () => {
    const body = { ...coordinatorFixture().args.payload, descriptiveRepair: descriptiveLink() }
    owners.executeIsolatedSyntheticOutcome.mockResolvedValue({ status: 'UNKNOWN' })
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(200)
    expect(owners.executeIsolatedSyntheticOutcome).toHaveBeenCalledWith(expect.objectContaining({ payload: body }))
    for (const change of [value => { value.descriptiveRepair.force = true },
      value => { value.holisticRepair = descriptiveLink() }, value => { delete value.descriptiveRepair.draftMaterialHash }]) {
      owners.executeIsolatedSyntheticOutcome.mockClear()
      const malformed = JSON.parse(JSON.stringify(body)); change(malformed)
      expect((await supertest(app).post(path + '/execute' + selectedScope).send(malformed)).status).toBe(422)
      expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
    }
    owners.executeIsolatedSyntheticOutcome.mockRejectedValue(Object.assign(new Error('Exact descriptive source unavailable'), { status: 503, code: 'DESCRIPTIVE_SOURCE_UNAVAILABLE' }))
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(503)
  })
  test('mounted authorised review admits strict reference only and fails closed on rejected proof owner', async () => {
    const body = { ...coordinatorFixture().args.payload, authorisedReview: authorisedLink() }
    owners.executeIsolatedSyntheticOutcome.mockResolvedValue({ status: 'UNKNOWN' })
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(200)
    expect(owners.executeIsolatedSyntheticOutcome).toHaveBeenCalledWith(expect.objectContaining({ payload: body, actorUserId: p.actorUserId }))
    for (const change of [v => { v.authorisedReview.force = true }, v => { v.descriptiveRepair = descriptiveLink() },
      v => { delete v.authorisedReview.approvalSha256 }, v => { v.authorisedReview.discrepancyOutcome = 'PASS' },
      v => { v.actorUserId = '507f1f77bcf86cd799439011' }]) {
      owners.executeIsolatedSyntheticOutcome.mockClear()
      const invalid = JSON.parse(JSON.stringify(body)); change(invalid)
      expect((await supertest(app).post(path + '/execute' + selectedScope).send(invalid)).status).toBe(422)
      expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
    }
    owners.executeIsolatedSyntheticOutcome.mockRejectedValue(Object.assign(new Error('Signed review proof unavailable'), { status: 503, code: 'REVIEW_PROOF_UNAVAILABLE' }))
    const rejected = await supertest(app).post(path + '/execute' + selectedScope).send(body)
    expect(rejected.status).toBe(503)
    expect(rejected.body.error.code).toBe('REVIEW_PROOF_UNAVAILABLE')
  })
  test.each(['wrong actor', 'wrong customer', 'rejected signed proof read'])('mounted authorised review actual proof boundary rejects %s with zero dispatch', async kind => {
    const read = jest.fn(() => ({ maxTimeMS() { return this }, lean: async () => { throw Object.assign(new Error('Proof store unavailable'), { status: 503, code: 'REVIEW_PROOF_UNAVAILABLE' }) } }))
    const dispatch = jest.fn()
    owners.executeIsolatedSyntheticOutcome.mockImplementation(async input => {
      await verifyNativeAuthorisedArlReview({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), actorUserId: input.actorUserId,
        runtimeInstanceId: input.runtimeInstanceId, plan: { customerId: input.scopes.selectedCustomerId, tenantId: input.scopes.selectedTenantId },
        deps: { models: { SyntheticOutcomeRunEvent: { findOne: read } } } })
      dispatch()
    })
    const customerId = kind === 'wrong customer' ? '507f1f77bcf86cd799439011' : p.customerId
    const request = supertest(app).post(`/${AUTHORISED_ARL_SCOPE.runtimeInstanceId}/synthetic-outcome/execute?customerId=${customerId}&tenantId=${p.tenantId}`)
    if (kind === 'wrong actor') request.set('x-unit-actor', '507f1f77bcf86cd799439011')
    const response = await request.send({ ...coordinatorFixture().args.payload, authorisedReview: authorisedLink() })
    expect(response.status).toBe(kind === 'rejected signed proof read' ? 503 : 409)
    expect(response.body.error.code).toBe(kind === 'rejected signed proof read' ? 'REVIEW_PROOF_UNAVAILABLE' : 'ARL_AUTHORISED_REVIEW_INVALID')
    expect(read).toHaveBeenCalledTimes(kind === 'rejected signed proof read' ? 1 : 0)
    expect(dispatch).not.toHaveBeenCalled()
  })
  test('mounted recovery requires exact saved-provider references and excludes combined modes', async () => {
    const body = { ...coordinatorFixture().args.payload, recovery: {
      failedClaimEventId: randomUUID(), failedClaimBodyHash: 'a'.repeat(64),
      failedResultEventId: randomUUID(), failedResultBodyHash: 'b'.repeat(64),
      executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(),
      executionHash: 'c'.repeat(64), artifactHash: 'd'.repeat(64),
    } }
    owners.executeIsolatedSyntheticOutcome.mockResolvedValue({ status: 'UNKNOWN' })
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(200)
    owners.executeIsolatedSyntheticOutcome.mockClear()
    body.continuation = Object.fromEntries(Object.entries(body.recovery).filter(([key]) => key.startsWith('failed')))
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(422)
    delete body.continuation; body.recovery.providerOutput = {}
    expect((await supertest(app).post(path + '/execute' + selectedScope).send(body)).status).toBe(422)
    expect(owners.executeIsolatedSyntheticOutcome).not.toHaveBeenCalled()
  })
  test('rejects missing or injected selected scope before the reader', async () => {
    expect((await supertest(app).get(path)).status).toBe(422)
    expect((await supertest(app).get(path + selectedScope + '&allowSynthetic=true')).status).toBe(422)
    expect(owners.inspectIsolatedSyntheticOutcome).not.toHaveBeenCalled()
  })
  test('planner receives unchanged original intent, real selected scope and only app-owned provider dependencies', async () => {
    owners.planIsolatedSyntheticOutcome.mockResolvedValue({ status: 'CLARIFICATION_REQUIRED', classification, authoritative: false })
    const prompt = 'Create the specifically requested CSDP using accepted synthetic evidence; preserve qualification.'
    const response = await supertest(app).post(path + '/plan' + selectedScope).send({ prompt })
    expect(response.status).toBe(200)
    expect(owners.planIsolatedSyntheticOutcome.mock.calls[0][0]).toMatchObject({ actorUserId: p.actorUserId, runtimeInstanceId: p.runtimeInstanceId, payload: { prompt },
      scopes: { authenticatedScope: true, selectedCustomerId: p.customerId, selectedTenantId: p.tenantId },
      providerRuntimeDeps: app.locals.outcomeStudioReasoningDeps })
    expect(response.body.data).toMatchObject({ authoritative: false, classification })
  })
  test('strict confirmation never defaults confirmation or accepts stage/provider flags', () => {
    expect(schemas.isolatedSyntheticConfirmSchema.safeParse({ continuation: 'native-continuation', confirm: true }).success).toBe(true)
    for (const body of [{ continuation: 'native-continuation' }, { continuation: 'native-continuation', confirm: false },
      { continuation: 'native-continuation', confirm: true, allowReadyWithGaps: true }]) {
      expect(schemas.isolatedSyntheticConfirmSchema.safeParse(body).success).toBe(false)
    }
  })
  test.each([
    ['get', '', 'inspectIsolatedSyntheticOutcome'], ['get', '/run', 'readIsolatedSyntheticOutcome'],
    ['post', '/plan', 'planIsolatedSyntheticOutcome'], ['post', '/execute', 'executeIsolatedSyntheticOutcome'],
  ])('mounted %s %s preserves rejected owner promise instead of returning empty success', async (method, suffix, owner) => {
    owners[owner].mockRejectedValue(Object.assign(new Error('Exact governance dependency rejected'), { status: 503,
      code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', details: { reason: 'REQUIRED_AUDIT_FAILED' } }))
    const response = await supertest(app)[method](path + suffix + selectedScope)
      .send(method === 'get' ? undefined : suffix === '/plan' ? { prompt: 'Preserve exact intent' } : coordinatorFixture().args.payload)
    expect(response.status).toBe(503)
    expect(response.body.error).toMatchObject({ code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', reason: 'REQUIRED_AUDIT_FAILED' })
    expect(response.body).not.toHaveProperty('data')
  })
  test('unexpected rejected dependency reaches mounted error middleware', async () => {
    owners.readIsolatedSyntheticOutcome.mockRejectedValue(new Error('driver disconnected'))
    expect((await supertest(app).get(path + '/run' + selectedScope)).body).toEqual({ error: { code: 'REJECTED_DEPENDENCY' } })
  })
})

const frozenOriginalRequest = 'Create a Commercial Strategy and Decision Paper in Markdown for the executive leadership team, using only the accepted evidence for this explicitly synthetic SS-044 bounded internal document-drafting pilot review. Explain whether the bounded trial may be considered, preserve outstanding access review and distinguish conditional reviewer support from final approval or execution authorization. Keep limitations and unknown benefits visible; do not claim wider rollout, market validation, quantified benefit, customer results or completed success. Style: strategic-advisory-style. Visual system: executive-consulting-visual-style.'
const planningContinuityFixture = actualPlanner => {
  const f = coordinatorFixture()
  const outputType = { packKey: 'commercial-strategy-and-decision-paper', capabilityKey: 'commercial-strategy-and-decision-paper',
    label: 'Commercial Strategy and Decision Paper', semanticVersion: '1.0.1' }
  const outputSchema = { packKey: 'commercial-strategy-and-decision-paper-schema', capabilityKey: 'commercial-strategy-and-decision-paper-schema',
    label: 'Commercial Strategy and Decision Paper Schema', semanticVersion: '1.0.1' }
  const binding = { status: 'READY', availableOutputTypes: [{ status: 'READY', capabilityKey: outputType.capabilityKey, outputType, outputSchema }],
    selectedByLayer: { OUTPUT_TYPE: [outputType], OUTPUT_SCHEMA: [outputSchema] }, missingDependencies: [], relationshipFailures: [], ambiguousCandidates: [] }
  const plannerDeps = { receiptSecret: 'isolated-native-continuity-unit-secret-longer-than-32',
    readRuntimeControl: jest.fn(async () => f.runtime), assertRuntimePermission: jest.fn(async () => {}),
    resolveBinding: jest.fn(async () => ({ binding })), readKcpRuntimeEvidence: jest.fn(), buildKcpCandidate: jest.fn() }
  f.deps.plannerDeps = plannerDeps
  f.deps.planRequest = actualPlanner
  return { ...f, plannerDeps }
}

describe('isolated original-request continuity through the actual native planner and resolver', () => {
  let actualPlanner, schemas
  beforeAll(async () => {
    ;({ planOutcomeStudioRequest: actualPlanner } = await import('../services/outcomeStudioRequestPlanService.js'))
    schemas = await import('../validators/isolatedSyntheticOutcome.validator.js')
  })
  test('ambiguous frozen first request then explicit CSDP answer preserves original intent and actual clarification provenance', async () => {
    const f = planningContinuityFixture(actualPlanner)
    expect(createHash('sha256').update(frozenOriginalRequest).digest('hex')).toBe('cf043cb9dda3447fd877a61dd82e47380344af24e0f711f82010b9d9d6284163')
    const first = await nativeIsolatedOwner.planIsolatedSyntheticOutcome({ ...f.args, payload: { prompt: frozenOriginalRequest } })
    expect(first.status).toBe('CLARIFICATION_REQUIRED'); expect(first.question).toMatch(/output type/i)
    const answer = 'Commercial Strategy and Decision Paper'
    const second = await nativeIsolatedOwner.planIsolatedSyntheticOutcome({ ...f.args,
      payload: { prompt: answer, action: 'ANSWER', continuation: first.continuation } })
    expect(second.requestId).toBe(first.requestId)
    expect(second.intent.originalRequest).toBe(frozenOriginalRequest)
    expect(second.intent.requestedOutputTypeKey).toBe('commercial-strategy-and-decision-paper')
    expect(second.intent.audience).toEqual(['executive leadership team'])
    expect(second.intent.audienceResolution.audienceKeys).toEqual(['executive-leadership-team'])
    expect(second.intent.compositionResolution.request).toMatchObject({ requestedStyleKey: 'strategic-advisory-style',
      visualSystemKey: 'executive-consulting-visual-style' })
    expect(second.intent.answeredClarificationQuestions).toContain(first.question)
    expect(second.intent.originalRequest).toContain('outstanding access review')
    expect(second.intent.originalRequest).toContain('do not claim wider rollout, market validation, quantified benefit, customer results or completed success')
    expect(second.status).toBe('CLARIFICATION_REQUIRED')
    expect(f.plannerDeps.buildKcpCandidate).not.toHaveBeenCalled()
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
  test('normal planner default keeps its existing clarification behavior when no server opt-in is supplied', async () => {
    const f = planningContinuityFixture(actualPlanner)
    f.runtime._id = '6a6c763dcace7a21bd41efa8'; f.runtime.runtimeInstanceKey = 'ordinary-native-runtime'
    const args = { actorUserId: p.actorUserId, runtimeInstanceId: f.runtime._id, scopes: {}, deps: f.plannerDeps }
    const first = await actualPlanner({ ...args, payload: { prompt: frozenOriginalRequest } })
    const answer = 'Commercial Strategy and Decision Paper'
    const second = await actualPlanner({ ...args, payload: { prompt: answer, action: 'ANSWER', continuation: first.continuation } })
    expect(second.intent.originalRequest).toBe(answer)
    expect(second.intent.originalRequest).not.toBe(frozenOriginalRequest)
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
  test('old valid continuation without preserved initial bytes fails closed instead of using its clarification answer as original intent', async () => {
    const f = planningContinuityFixture(actualPlanner)
    const legacy = await actualPlanner({ ...f.args, payload: { prompt: frozenOriginalRequest },
      deps: { ...f.plannerDeps, authorizeRuntime: async () => {} } })
    expect(legacy.status).toBe('CLARIFICATION_REQUIRED')
    await expect(nativeIsolatedOwner.planIsolatedSyntheticOutcome({ ...f.args, payload: {
      prompt: 'Commercial Strategy and Decision Paper', action: 'ANSWER', continuation: legacy.continuation,
    } })).rejects.toMatchObject({ code: 'OUTCOME_PLANNING_ORIGINAL_REQUEST_UNAVAILABLE', status: 409 })
    expect(f.EventModel.create).not.toHaveBeenCalled()
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('request body cannot enable server-only original-request preservation', () => {
    expect(schemas.isolatedSyntheticPlanSchema.safeParse({ prompt: frozenOriginalRequest, preserveInitialRequest: true }).success).toBe(false)
    expect(schemas.isolatedSyntheticPlanSchema.safeParse({ prompt: frozenOriginalRequest, initialRequest: frozenOriginalRequest }).success).toBe(false)
  })
})

// Native control, child-index and stage owners are component seams here; no installed
// Mongo index, transaction, real lock or live provider result is claimed by these tests.
const directRevisionFixture = () => {
  const f = coordinatorFixture()
  const parent = JSON.parse(JSON.stringify(f.runtime)), parentFrozen = JSON.parse(JSON.stringify(f.frozen))
  parent.updatedAt = '2026-10-18T11:00:00.000Z'; parent.lockedAt = parent.updatedAt; parent.lockedBy = p.actorUserId
  Object.assign(parent, { runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'value-narrative', workspaceId: '',
    packageId: '6aa923ac50c4a5b07e60b716', packageKey: 'vmf', packageVersion: '3.2.0', dependencyLockId: 'dependency-1',
    activationId: 'activation-1', deploymentId: 'deployment-1' })
  parent.framework_state = { lifecycle: { stage: 'LOCKED' }, publish: { state: 'PUBLISHED', published: true,
    snapshot: { snapshotId: 'parent-publish', snapshotHash: '1'.repeat(64) } }, lock: { locked: true,
    snapshot: { snapshotId: parentFrozen.lockSnapshotId, snapshotHash: parentFrozen.lockSnapshotHash },
    replayAnchor: { replayAnchorId: 'parent-replay', replayAnchorHash: '2'.repeat(64) } } }
  parent.lockedEvidenceSnapshot = Object.fromEntries(['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash']
    .map(key => [key, parentFrozen[key]]))
  Object.assign(f.runtime, JSON.parse(JSON.stringify(parent)), { _id: '6ace5ee09bd4472c6be0cb08', runtimeInstanceKey: 'synthetic-direct-r2', stateVersion: `rsv2:${randomUUID()}`,
    revision: { revisionNumber: 2, createdFromRevision: 1, parentRuntimeId: p.runtimeInstanceId, rootRuntimeId: p.runtimeInstanceId,
      parentRuntimeInstanceKey: p.runtimeInstanceKey, rootRuntimeInstanceKey: p.runtimeInstanceKey,
      derivedFromPublishSnapshotId: 'parent-publish', derivedFromPublishSnapshotHash: '1'.repeat(64),
      derivedFromLockSnapshotId: parentFrozen.lockSnapshotId, derivedFromLockSnapshotHash: parentFrozen.lockSnapshotHash,
      derivedFromReplayAnchorId: 'parent-replay', derivedFromReplayAnchorHash: '2'.repeat(64) } })
  delete f.frozen.serializationCorrection
  Object.assign(f.frozen, { snapshotId: `evidence_snapshot_${randomUUID()}`, membershipHash: 'e'.repeat(64),
    basisStateVersion: f.runtime.stateVersion, lockSnapshotId: 'own-r2-lock', lockSnapshotHash: '3'.repeat(64), revisionNumber: 2,
    counts: { sources: 9, evidence: 49, sections: 6 } })
  f.runtime.lockedEvidenceSnapshot = Object.fromEntries(['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash']
    .map(key => [key, f.frozen[key]]))
  f.runtime.framework_state.lock.snapshot = { snapshotId: f.frozen.lockSnapshotId, snapshotHash: f.frozen.lockSnapshotHash }
  f.args.runtimeInstanceId = f.runtime._id
  const parentBasis = { snapshotId: parentFrozen.snapshotId, membershipHash: parentFrozen.membershipHash,
    basisStateVersion: parentFrozen.basisStateVersion, lockSnapshotId: parentFrozen.lockSnapshotId, lockSnapshotHash: parentFrozen.lockSnapshotHash,
    counts: { ...parentFrozen.counts }, correctionReceiptId: parentFrozen.serializationCorrection.receiptId,
    correctionBodyHash: parentFrozen.serializationCorrection.bodyHash }
  const basis = { snapshotId: f.frozen.snapshotId, membershipHash: f.frozen.membershipHash, basisStateVersion: f.frozen.basisStateVersion,
    lockSnapshotId: f.frozen.lockSnapshotId, lockSnapshotHash: f.frozen.lockSnapshotHash, counts: { ...f.frozen.counts },
    lineage: buildDirectSyntheticRevisionLineage({ runtime: f.runtime, parentRuntime: parent, parentBasis }) }
  f.plan.runtimeInstanceId = f.runtime._id
  f.plan.payload.requestAssociation.basis = basis
  f.plan.payload.requestAssociation.classification.runtimeInstanceId = f.runtime._id
  f.plan.payload.planningEvidence = { contractVersion: 'outcome-planning-evidence.v1' }
  const planningRuntime = JSON.parse(JSON.stringify(f.runtime))
  planningRuntime.planningEvidence = { contractVersion: 'outcome-planning-evidence.v1' }
  f.deps.readPlanningEvidence = jest.fn(async () => planningRuntime)
  f.deps.getRuntimeInstance.mockImplementation(async input => {
    const row = input.runtimeInstanceId === p.runtimeInstanceId ? parent : f.runtime
    return input.projection ? { __evidenceSnapshotControl: { runtime: row, pointer: row.lockedEvidenceSnapshot } } : row
  })
  const lockAuditDocument = new Audit({ actorUserId: p.actorUserId, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
    resourceId: f.runtime._id, scope: { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: f.runtime._id, runtimeInstanceKey: f.runtime.runtimeInstanceKey },
    diff: { actionKey: 'LOCK_RECORD', actionedAt: f.runtime.lockedAt } })
  lockAuditDocument.generateSignature()
  const lockAudit = lockAuditDocument.toObject(), lockAuditRows = [lockAudit]
  const lockAuditQuery = { limit: jest.fn().mockReturnThis(), maxTimeMS: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis(),
    setOptions: jest.fn().mockReturnThis(), lean: jest.fn(async () => lockAuditRows) }
  f.deps.models.AuditLog.find = jest.fn(() => lockAuditQuery)
  f.deps.readVerifiedBasis.mockImplementation(async input => {
    if (String(input.runtime._id) === p.runtimeInstanceId) return parentFrozen
    await input.deps.readAudit(lockAudit._id, { session: input.session, readBudget: input.readBudget })
    return f.frozen
  })
  const children = [{ _id: f.runtime._id }]
  const childQuery = { select: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis(),
    maxTimeMS: jest.fn().mockReturnThis(), lean: jest.fn(async () => children) }
  const parentIndex = { unique: true, key: { customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 },
    partialFilterExpression: { 'revision.parentRuntimeId': { $type: 'objectId' } } }
  f.deps.models.RuntimeInstance = { find: jest.fn(() => childQuery),
    collection: { listIndexes: jest.fn(() => ({ toArray: async () => [parentIndex] })) } }
  return { ...f, parent, parentFrozen, basis, children, childQuery, parentIndex, planningRuntime, lockAudit, lockAuditRows, lockAuditQuery }
}

const successorRevisionFixture = () => {
  const f = directRevisionFixture(), clone = value => JSON.parse(JSON.stringify(value))
  const original = f.parent, originalFrozen = f.parentFrozen
  const direct = clone(f.runtime), directFrozen = clone(f.frozen)
  Object.assign(direct, { _id: successor.parentRuntimeInstanceId, runtimeInstanceKey: successor.parentRuntimeInstanceKey,
    stateVersion: successor.parentStateVersion })
  Object.assign(directFrozen, { snapshotId: successor.parentSnapshotId, membershipHash: successor.parentMembershipHash,
    basisStateVersion: successor.parentStateVersion, lockSnapshotId: successor.parentLockSnapshotId,
    lockSnapshotHash: successor.parentLockSnapshotHash, counts: { sources: 8, evidence: 47, sections: 6 } })
  const pointer = value => Object.fromEntries(['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash'].map(key => [key, value[key]]))
  direct.lockedEvidenceSnapshot = pointer(directFrozen)
  direct.framework_state.publish.snapshot = { snapshotId: 'native-r2-publish', snapshotHash: '5'.repeat(64) }
  direct.framework_state.lock.snapshot = { snapshotId: directFrozen.lockSnapshotId, snapshotHash: directFrozen.lockSnapshotHash }
  direct.framework_state.lock.replayAnchor = { replayAnchorId: 'native-r2-replay', replayAnchorHash: '6'.repeat(64) }
  const originalBasis = f.basis.lineage.parentBasis
  const directBasis = { ...pointer(directFrozen), counts: directFrozen.counts,
    lineage: buildDirectSyntheticRevisionLineage({ runtime: direct, parentRuntime: original, parentBasis: originalBasis }) }
  Object.assign(f.runtime, clone(direct), { _id: successor.runtimeInstanceId, runtimeInstanceKey: successor.runtimeInstanceKey,
    stateVersion: 'rsv2:33333333-3333-4333-8333-333333333333', revision: { revisionNumber: 3, createdFromRevision: 2,
      parentRuntimeId: direct._id, parentRuntimeInstanceKey: direct.runtimeInstanceKey,
      rootRuntimeId: original._id, rootRuntimeInstanceKey: original.runtimeInstanceKey,
      derivedFromPublishSnapshotId: 'native-r2-publish', derivedFromPublishSnapshotHash: '5'.repeat(64),
      derivedFromLockSnapshotId: directFrozen.lockSnapshotId, derivedFromLockSnapshotHash: directFrozen.lockSnapshotHash,
      derivedFromReplayAnchorId: 'native-r2-replay', derivedFromReplayAnchorHash: '6'.repeat(64) } })
  Object.assign(f.frozen, { snapshotId: 'evidence_snapshot_33333333-3333-4333-8333-333333333333',
    membershipHash: directFrozen.membershipHash, basisStateVersion: f.runtime.stateVersion,
    lockSnapshotId: 'own-r3-lock', lockSnapshotHash: '7'.repeat(64), revisionNumber: 3,
    counts: { sources: 8, evidence: 47, sections: 6 } })
  f.runtime.lockedEvidenceSnapshot = pointer(f.frozen)
  f.runtime.framework_state.lock.snapshot = { snapshotId: f.frozen.lockSnapshotId, snapshotHash: f.frozen.lockSnapshotHash }
  const basis = { ...pointer(f.frozen), counts: f.frozen.counts,
    lineage: buildSuccessorSyntheticRevisionLineage({ runtime: f.runtime, parentRuntime: direct, parentBasis: directBasis }) }
  f.args.runtimeInstanceId = f.runtime._id
  f.plan.runtimeInstanceId = f.runtime._id
  f.plan.payload.requestAssociation.basis = basis
  f.plan.payload.requestAssociation.classification.runtimeInstanceId = f.runtime._id
  Object.assign(f.planningRuntime, clone(f.runtime), { planningEvidence: { contractVersion: 'outcome-planning-evidence.v1' } })
  const controls = new Map([[original._id, original], [direct._id, direct], [f.runtime._id, f.runtime]])
  const frozen = new Map([[original._id, originalFrozen], [direct._id, directFrozen], [f.runtime._id, f.frozen]])
  f.deps.getRuntimeInstance.mockImplementation(async input => { const row = controls.get(input.runtimeInstanceId)
    return input.projection ? { __evidenceSnapshotControl: { runtime: row, pointer: row.lockedEvidenceSnapshot } } : row })
  const audits = [direct, f.runtime].map(row => { const audit = new Audit({ actorUserId: p.actorUserId,
    action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', resourceId: row._id,
    scope: { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: row._id, runtimeInstanceKey: row.runtimeInstanceKey },
    diff: { actionKey: 'LOCK_RECORD', actionedAt: row.lockedAt } }); audit.generateSignature(); return audit.toObject() })
  f.deps.models.AuditLog.find = jest.fn(filter => ({ limit() { return this }, maxTimeMS() { return this },
    session() { return this }, setOptions() { return this }, lean: async () => audits.filter(a => String(a._id) === String(filter._id)) }))
  f.deps.readVerifiedBasis.mockImplementation(async input => { const id = String(input.runtime._id)
    if (id !== original._id) { const audit = audits.find(row => String(row.resourceId) === id)
      await input.deps.readAudit(audit._id, { session: input.session, readBudget: input.readBudget }) }
    return frozen.get(id) })
  const children = new Map([[original._id, [{ _id: direct._id }]], [direct._id, [{ _id: f.runtime._id }]]])
  f.deps.models.RuntimeInstance.find = jest.fn(filter => ({ select() { return this }, limit() { return this },
    maxTimeMS() { return this }, session() { return this }, setOptions() { return this },
    lean: async () => children.get(String(filter['revision.parentRuntimeId'])) }))
  return { ...f, original, originalFrozen, direct, directFrozen, directBasis, basis, controls, children, lockAudits: audits }
}

describe('direct native synthetic revision admission and v2 journal', () => {
  test('R2 uses own verified counts and target-bound audit, stage, GRR and once-only receipts', async () => {
    const f = directRevisionFixture(), before = membershipHash({ parent: f.parent, target: f.runtime })
    const result = await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(result.basis).toEqual(f.basis)
    expect(f.rows.map(row => row.body.version)).toEqual([revisionVersion, revisionVersion])
    expect(f.rows.every(row => String(row.runtimeInstanceId) === f.runtime._id)).toBe(true)
    expect(f.audits.every(row => String(row.resourceId) === f.runtime._id && row.scope.runtimeInstanceKey === f.runtime.runtimeInstanceKey)).toBe(true)
    expect(result.stages.every(row => row.runtimeInstanceId === f.runtime._id)).toBe(true)
    expect(result.grr.every(row => row.execution.runtimeInstanceId === f.runtime._id && row.artifact.runtimeInstanceId === f.runtime._id)).toBe(true)
    expect(f.childQuery.limit).toHaveBeenCalledWith(2)
    for (const [input] of f.deps.getRuntimeInstance.mock.calls.filter(([input]) => input.projection)) {
      expect(input.projection.split(' ')).toEqual(expect.arrayContaining(['updatedAt', 'lockedAt', 'lockedBy', 'lockedEvidenceSnapshot']))
      expect(input.projection).not.toContain('framework_state.sections')
      expect(input.projection).not.toContain('framework_state.evidence_pack')
    }
    expect(f.deps.readPlanningEvidence).toHaveBeenCalledWith(expect.objectContaining({ runtimeInstanceId: f.runtime._id,
      planningEvidenceVersion: 'outcome-planning-evidence.v1', session: expect.anything() }))
    expect(f.deps.models.RuntimeInstance.find.mock.calls[0][0]).toMatchObject({ 'revision.parentRuntimeId': expect.anything() })
    const unchanged = [...f.calls]
    await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(f.calls).toEqual(unchanged)
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome({ ...f.args, payload: { ...f.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'EXECUTION_ALREADY_CLAIMED' } })
    expect(membershipHash({ parent: f.parent, target: f.runtime })).toBe(before)
  })
  test.each(['planIsolatedSyntheticOutcome', 'confirmIsolatedSyntheticOutcomePlan'])('binds native R2 association identically through %s', async operation => {
    const f = directRevisionFixture(), owner = jest.fn(async input => { await input.deps.authorizeRuntime(); return { status: 'BLOCKED' } })
    f.deps[operation.startsWith('plan') ? 'planRequest' : 'confirmPlan'] = owner
    await nativeIsolatedOwner[operation](f.args)
    expect(owner.mock.calls[0][0].deps.requestAssociation).toEqual({ basis: f.basis, classification: f.plan.payload.requestAssociation.classification })
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
  test.each([
    ['foreign customer', f => { f.runtime.customerId = '6ace5ee09bd4472c6be0cb09' }],
    ['foreign tenant', f => { f.runtime.tenantId = '6ace5ee09bd4472c6be0cb09' }],
    ['wrong parent', f => { f.runtime.revision.parentRuntimeId = '6ace5ee09bd4472c6be0cb09' }],
    ['wrong root', f => { f.runtime.revision.rootRuntimeId = '6ace5ee09bd4472c6be0cb09' }],
    ['deeper revision', f => { f.runtime.revision.revisionNumber = 3 }],
    ['wrong parent key', f => { f.runtime.revision.parentRuntimeInstanceKey = 'foreign' }],
    ['wrong root key', f => { f.runtime.revision.rootRuntimeInstanceKey = 'foreign' }],
    ['wrong source revision', f => { f.runtime.revision.createdFromRevision = 2 }],
    ['wrong runtime type', f => { f.runtime.runtimeType = 'DEAL_ANALYSIS' }],
    ...['frameworkKey', 'packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'workspaceId']
      .map(key => [key, f => { f.runtime[key] = 'foreign' }]),
    ['malformed workspace', f => { f.runtime.workspaceId = {} }],
    ...['derivedFromPublishSnapshotId', 'derivedFromPublishSnapshotHash', 'derivedFromLockSnapshotId', 'derivedFromLockSnapshotHash',
      'derivedFromReplayAnchorId', 'derivedFromReplayAnchorHash'].map(key => [key, f => { f.runtime.revision[key] = 'foreign' }]),
    ['not published', f => { f.runtime.framework_state.publish.published = false }],
    ['not locked', f => { f.runtime.framework_state.lifecycle.stage = 'PUBLISHED' }],
    ['wrong own pointer', f => { f.runtime.lockedEvidenceSnapshot.membershipHash = 'a'.repeat(64) }],
    ['parent snapshot', f => { f.frozen.snapshotId = p.snapshotId }],
    ['parent correction', f => { f.frozen.serializationCorrection = f.parentFrozen.serializationCorrection }],
    ['missing count', f => { delete f.frozen.counts.evidence }],
    ['fractional count', f => { f.frozen.counts.evidence = 1.5 }],
    ['overflow count', f => { f.frozen.counts.evidence = 5001 }],
    ['ambiguous direct child', f => { f.children.push({ _id: '6ace5ee09bd4472c6be0cb09' }) }],
    ['missing direct child', f => { f.children.length = 0 }],
    ['parent index unverified', f => { f.parentIndex.unique = false }],
  ])('denies %s before claim/provider without changing either runtime', async (label, alter) => {
    const f = directRevisionFixture(); alter(f)
    const before = membershipHash({ parent: f.parent, target: f.runtime })
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED' })
    expect(f.EventModel.create).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
    expect(membershipHash({ parent: f.parent, target: f.runtime })).toBe(before)
  })
  test('preserves actually supplied zero counts and rejects missing counts rather than inventing defaults', async () => {
    const f = directRevisionFixture()
    f.frozen.counts = { sources: 0, evidence: 0, sections: 0 }
    const result = await nativeIsolatedOwner.inspectIsolatedSyntheticOutcome(f.args)
    expect(result.basis.counts).toEqual(f.frozen.counts)
    expect(result.run.status).toBe('NOT_STARTED')
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('R1 claim cannot consume R2 once-only slot or authorize R2 output delivery', async () => {
    const f = directRevisionFixture(), original = eventFixture()
    f.rows.push(original)
    await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(f.rows.filter(row => row.phase === 'CLAIM')).toHaveLength(2)
    expect(f.rows[0]).toBe(original)
    const guards = await import('../services/syntheticOutcomeIsolationService.js')
    expect(() => guards.assertNormalOutcomeRuntime(f.runtime)).toThrow('isolated')
  })
  test('fresh transaction reread rejects changed native lineage before claim', async () => {
    const f = directRevisionFixture(), load = f.deps.getRuntimeInstance.getMockImplementation()
    f.deps.getRuntimeInstance.mockImplementation(async input => {
      if (input.session) f.runtime.revision.derivedFromReplayAnchorHash = '0'.repeat(64)
      return load(input)
    })
    // Unit transaction seam supplies an actual identity token, not a database transaction.
    f.deps.mongoose.startSession.mockResolvedValue({ withTransaction: async fn => fn(), endSession: async () => {} })
    const before = f.deps.models.RuntimeInstance.find.getMockImplementation()
    f.deps.models.RuntimeInstance.find.mockImplementation(filter => before(filter))
    // authorize receives the same session object even when the unit callback has no argument.
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'REVISION_LINEAGE_INVALID' } })
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
  test.each([
    row => { row.body.basis.lineage.rootRuntimeInstanceId = row.runtimeInstanceId },
    row => { row.body.basis.lineage.package.activationId = '' },
    row => { row.body.basis.correctionReceiptId = randomUUID() },
    row => { row.body.classification.runtimeInstanceId = p.runtimeInstanceId },
    row => { row.body.basis.snapshotId = p.snapshotId },
    row => { row.body.basis.basisStateVersion = randomUUID() },
    row => { delete row.body.basis.counts.sources },
  ])('v2 model rejects resealed malformed admission before any storage %j', async change => {
    const f = directRevisionFixture(), row = eventFixture()
    row.runtimeInstanceId = f.runtime._id; row.body.classification.runtimeInstanceId = f.runtime._id
    row.body.version = revisionVersion; row.body.basis = f.basis; change(row); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
    await expect(new Event(row).save({ validateBeforeSave: false })).rejects.toThrow()
    await expect(Event.insertMany([row], { lean: true })).rejects.toThrow()
    await expect(Event.bulkWrite([{ insertOne: { document: row } }], { skipValidation: true })).rejects.toThrow()
  })
})

const useRealRevisionPlanComparator = f => {
  const runtime = f.planningRuntime, lock = runtime.framework_state.lock
  Object.assign(lock, { state: 'LOCKED', lockedAt: runtime.lockedAt, lockedBy: p.actorUserId,
    outputEligibility: { canonicalOutputEligible: true }, evidence: { dependencySnapshotId: 'dependency-1', dependencySnapshotHash: '6'.repeat(64) } })
  runtime.framework_state.sections = { customer_context: { state: { status: 'ACCEPTED' }, accepted: {
    sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', truthHash: 'sha256:' + '7'.repeat(64),
    acceptedAt: '2026-10-18T10:50:00.000Z', acceptedBy: p.actorUserId, sourceActionKey: 'GENERATE_SECTION',
    sourceGeneratedAt: '2026-10-18T10:49:00.000Z' } } }
  // Independent auth control contains lock metadata only, never accepted section bodies.
  f.runtime.framework_state.lock = JSON.parse(JSON.stringify(lock))
  const packs = OUTCOME_STUDIO_REQUIRED_PACKS.map((pack, index) => ({ ...pack,
    activationId: `unit-activation-${index}`, packId: `unit-pack-${index}`, versionId: `unit-version-${index}`,
    knowledgeAssetId: `QA-REQUIRED-${index}`, purposeCategory: pack.packType === 'ARL' ? 'SYSTEM' : 'VALIDATION',
    knowledgeLayer: pack.packType === 'ARL' ? 'REASONING' : 'VALIDATION', semanticVersion: '1.0.0', schemaVersion: '1.0.0',
    status: 'ACTIVE', scopeType: 'GLOBAL', scopeKey: 'GLOBAL', executionMode: pack.packType === 'ARL' ? 'PROVIDER_CONTEXT' : 'POST_VALIDATION',
    visibility: 'PLATFORM', workspaceCompatibility: ['OUTCOME'], contentHash: 'sha256:' + '8'.repeat(64),
    relationshipContractVersion: 'SS002_RELATIONSHIP_V1', relationshipChecksum: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', dependencyReferences: [] }))
  const candidate = buildOutcomeKnowledgeCompositionPlanCandidate({ runtime,
    binding: { status: 'READY', mode: 'REQUEST_SPECIFIC', policyKey: 'unit-real-comparator', policyVersion: '1.0.0', mandatorySafeguards: packs,
      resolution: { request: { requestedOutputTypeKey: 'controlled-paper' } } },
    context: { status: 'READY', available: true, requestedOutputTypeKey: 'controlled-paper' },
    consumerIntent: { originalRequest: 'Prepare a synthetic controlled paper.', outcome: 'A bounded synthetic paper', decisionPurpose: 'Review the bounded fixture',
      consumer: 'Synthetic reviewer', audience: ['synthetic reviewer'], requestedOutputTypeKey: 'controlled-paper', format: 'Markdown' },
    requestScope: { requestId: f.plan.requestId, runtimeInstanceId: runtime._id, customerId: p.customerId, tenantId: p.tenantId },
    requestAssociation: f.plan.payload.requestAssociation })
  Object.assign(f.plan, candidate, { contractVersion: candidate.payload.contractVersion, planVersion: 1,
    runtimeInstanceKey: runtime.runtimeInstanceKey, runtimeType: runtime.runtimeType, frameworkKey: runtime.frameworkKey,
    packageKey: runtime.packageKey, packageVersion: runtime.packageVersion, requestedOutputTypeKey: 'controlled-paper',
    ...Object.fromEntries(['publishSnapshotId', 'lockSnapshotId', 'replayAnchorId', 'dependencySnapshotId'].map(key => [key, candidate.payload.lockedTruth[key]])) })
  f.args.payload.expectedPlanFingerprint = f.plan.planFingerprint
  f.deps.assertPlanIntegrity = assertOutcomeKnowledgeCompositionPlanIntegrity
  f.deps.assertPlanMatchesRuntime = assertOutcomeKnowledgeCompositionPlanMatchesRuntime
  return f
}

describe('R2 native planning material uses the unchanged actual plan comparator', () => {
  test('accepts actual candidate hashes and accepted truth via the bounded planning owner', async () => {
    const f = useRealRevisionPlanComparator(directRevisionFixture())
    expect(f.runtime.framework_state.sections).toBeUndefined()
    const result = await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(f.deps.readPlanningEvidence).toHaveBeenCalledWith(expect.objectContaining({ runtimeInstanceId: f.runtime._id,
      planningEvidenceVersion: f.plan.payload.planningEvidence.contractVersion, session: expect.anything() }))
  })
  test.each(['truth', 'time'])('real comparator rejects changed %s without weakening native currentness', async field => {
    const f = useRealRevisionPlanComparator(directRevisionFixture())
    if (field === 'truth') f.planningRuntime.framework_state.sections.customer_context.accepted.truthHash = 'sha256:' + '9'.repeat(64)
    else f.runtime.updatedAt = f.planningRuntime.updatedAt = '2026-10-18T11:01:00.000Z'
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ code: 'OUTCOME_KCP_RUNTIME_STALE', details: { field: 'lockedTruthEvidence' } })
    expect(f.EventModel.create).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test.each(['runtimeInstanceKey', 'stateVersion', 'updatedAt'])('rejects mismatched planning %s against independent control', async key => {
    const f = directRevisionFixture(); f.planningRuntime[key] = key === 'updatedAt' ? '2026-10-18T11:01:00.000Z' : 'different'
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'REVISION_PLANNING_BASIS_CHANGED' } })
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
})

describe('R2 lock proof requires actual model HMAC before child admission', () => {
  test('reads exact scoped lock audit with native bounds and actual session/budget', async () => {
    const f = directRevisionFixture(), session = {}, budget = jest.fn(() => ({ maxTimeMS: 321 }))
    f.args.readBudget = budget
    f.deps.mongoose.startSession.mockResolvedValue({ withTransaction: async fn => fn(), endSession: async () => {}, marker: session })
    expect(Audit.hydrate(f.lockAudit).verifySignature()).toBe(true)
    const result = await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(f.deps.models.AuditLog.find).toHaveBeenCalledWith(expect.objectContaining({ _id: f.lockAudit._id,
      action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', 'scope.runtimeInstanceKey': f.runtime.runtimeInstanceKey }))
    const filter = f.deps.models.AuditLog.find.mock.calls[0][0]
    expect(String(filter.resourceId)).toBe(f.runtime._id)
    expect(String(filter['scope.runtimeInstanceId'])).toBe(f.runtime._id)
    expect(String(filter['scope.customerId'])).toBe(p.customerId); expect(String(filter['scope.tenantId'])).toBe(p.tenantId)
    expect(f.lockAuditQuery.limit).toHaveBeenCalledWith(2); expect(f.lockAuditQuery.maxTimeMS).toHaveBeenCalledWith(2000)
    expect(f.lockAuditQuery.session).toHaveBeenCalledWith(expect.objectContaining({ marker: session }))
    expect(budget).toHaveBeenCalled(); expect(f.lockAuditQuery.setOptions).toHaveBeenCalledWith({ maxTimeMS: 321 })
  })
  test.each([
    ['signature tampered', f => { f.lockAudit.signature = 'f'.repeat(64) }],
    ['signed material altered', f => { f.lockAudit.diff.actionedAt = '2026-10-18T12:00:00Z' }],
    ['missing audit', f => { f.lockAuditRows.length = 0 }],
    ['duplicate audit', f => { f.lockAuditRows.push(f.lockAudit) }],
  ])('rejects %s without provider or event', async (label, alter) => {
    const f = directRevisionFixture(); alter(f)
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'REVISION_LOCK_AUDIT_INVALID' } })
    expect(f.EventModel.create).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('does not accept an owner seam that skips the actual audit callback', async () => {
    const f = directRevisionFixture()
    f.deps.readVerifiedBasis.mockImplementation(async input => String(input.runtime._id) === p.runtimeInstanceId ? f.parentFrozen : f.frozen)
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'REVISION_LOCK_AUDIT_REQUIRED' } })
    expect(f.EventModel.create).not.toHaveBeenCalled()
  })
})

const controlledParentPartial = () => Object.fromEntries(Object.entries({ customerId: p.customerId, tenantId: p.tenantId,
  'revision.parentRuntimeId': p.runtimeInstanceId }).map(([key, value]) => [key, new Event.db.base.Types.ObjectId(value)]))

describe('exact controlled-parent uniqueness index equivalence', () => {
  test('accepts only actual typed controlled partial filter alongside unchanged canonical support', async () => {
    const f = directRevisionFixture(); f.parentIndex.partialFilterExpression = controlledParentPartial()
    expect((await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).run.status).toBe('ARL_PASSED')
    expect(f.rows).toHaveLength(2)
  })
  test.each([
    ['strings with identical canonical hash', f => { const typed = controlledParentPartial()
      f.parentIndex.partialFilterExpression = Object.fromEntries(Object.entries(typed).map(([key, value]) => [key, String(value)]))
      expect(membershipHash(f.parentIndex.partialFilterExpression)).toBe(membershipHash(typed)) }],
    ['nonunique existing native index', f => { f.parentIndex.unique = false; delete f.parentIndex.partialFilterExpression }],
    ['sparse index', f => { f.parentIndex.sparse = true }],
    ['missing partial filter', f => { delete f.parentIndex.partialFilterExpression }],
    ['missing tenant', f => { f.parentIndex.partialFilterExpression = controlledParentPartial(); delete f.parentIndex.partialFilterExpression.tenantId }],
    ['extra filter', f => { f.parentIndex.partialFilterExpression = { ...controlledParentPartial(), status: 'LOCKED' } }],
    ...['customerId', 'tenantId', 'revision.parentRuntimeId'].map(key => [key, f => {
      f.parentIndex.partialFilterExpression = controlledParentPartial()
      f.parentIndex.partialFilterExpression[key] = new Event.db.base.Types.ObjectId('6ace5ee09bd4472c6be0cb09') }]),
    ['wrong compound key', f => { f.parentIndex.key.status = 1 }],
  ])('rejects %s before claim/provider', async (name, alter) => {
    const f = directRevisionFixture(); alter(f)
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'REVISION_INDEX_NOT_READY' } })
    expect(f.EventModel.create).not.toHaveBeenCalled(); expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
})

const installNativeOrphanReadEffects = async runtime => {
  const Source = (await import('../models/RuntimeEvidenceSource.js')).default
  const Evidence = (await import('../models/RuntimeEvidenceObject.js')).default
  const reads = [], spies = [Source, Evidence].map(Model => jest.spyOn(Model, 'findOne').mockImplementation(filter => {
    expect(filter).toEqual({ customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: runtime._id,
      runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion,
      current: true, controlledReplayProvenance: { $exists: true } })
    reads.push({ model: Model.modelName, filter })
    const cursor = { select: jest.fn(value => { expect(value).toEqual({ _id: 1 }); return cursor }),
      maxTimeMS: jest.fn(value => { expect(value).toBe(2000); return cursor }),
      limit: jest.fn(value => { expect(value).toBe(1); return cursor }), lean: async () => null }
    return cursor
  }))
  return { reads, restore: () => spies.forEach(spy => spy.mockRestore()) }
}

describe('provider-bound authorization retains the immutable R2 claim basis', () => {
  test('actual native GRR early authorizer rejects changed own basis before framework/provider work', async () => {
    const f = directRevisionFixture(), framework = jest.fn(() => { throw new Error('Must not reach framework/provider work') })
    const nativeEffects = await installNativeOrphanReadEffects(f.runtime)
    try {
    let observed
    f.deps.executeFrameworkGuidance = jest.fn(async input => {
      // Component-selected hypothetical new valid own freeze; no operational runtime mutation.
      f.runtime.stateVersion = `rsv2:${randomUUID()}`
      f.frozen.basisStateVersion = f.runtime.stateVersion
      f.frozen.snapshotId = `evidence_snapshot_${randomUUID()}`
      f.frozen.membershipHash = 'a'.repeat(64)
      Object.assign(f.runtime.lockedEvidenceSnapshot, { basisStateVersion: f.frozen.basisStateVersion,
        snapshotId: f.frozen.snapshotId, membershipHash: f.frozen.membershipHash })
      try {
        return await input.deps.createGovernedReasoningExecution({ actorUserId: p.actorUserId, runtimeInstanceId: f.runtime._id,
          scopes: f.args.scopes, payload: {}, deps: { executionMode: 'LEGACY', resolveRuntimeInstance: async () => f.runtime,
            resolveFrameworkPackage: framework } })
      } catch (error) { observed = error; throw error }
    })
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'CLAIM_BASIS_CHANGED' } })
    expect(observed).toMatchObject({ code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', details: { reason: 'CLAIM_BASIS_CHANGED' } })
    expect(framework).not.toHaveBeenCalled()
    expect(f.args.providerRuntimeDeps.frameworkGuidanceProviderAdapterFactory).not.toHaveBeenCalled()
    expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
    expect(f.stages).toHaveLength(0); expect(f.grrPairs).toHaveLength(0)
    expect(f.rows.map(row => row.phase)).toEqual(['CLAIM', 'RESULT'])
    expect(f.rows[1].body).toMatchObject({ status: 'UNKNOWN', failure: { details: { reason: 'CLAIM_BASIS_CHANGED' } } })
    expect(nativeEffects.reads).toHaveLength(2)
    } finally { nativeEffects.restore() }
  })
})


describe('exact native successor R3 admission and v3 journal', () => {
  test('R3 actual coordinator binds own basis and signed journal/stages/GRR without granting normal output', async () => {
    const f = successorRevisionFixture(), before = membershipHash([...f.controls.values()])
    const result = await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(result.basis).toEqual(f.basis)
    expect(f.rows.map(row => row.body.version)).toEqual([successorVersion, successorVersion])
    for (const row of f.rows) expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    expect(membershipHash([...f.controls.values()])).toBe(before)
    expect(result.stages).toHaveLength(3)
    expect(result.grr).toHaveLength(3)
    expect((await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).run.status).toBe('ARL_PASSED')
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(1)
  })
  test.each(['wrong-id', 'wrong-key', 'wrong-parent', 'wrong-created-from', 'stale-r2', 'missing-freeze', 'copied-basis', 'correction', 'tampered-audit', 'sibling', 'copied-r1-lock'])('rejects R3 %s before claiming/provider', async kind => {
    const f = successorRevisionFixture()
    if (kind === 'wrong-id') f.args.runtimeInstanceId = '6ad715c91f39fea112115876'
    if (kind === 'wrong-key') f.runtime.runtimeInstanceKey += '-wrong'
    if (kind === 'wrong-parent') f.runtime.revision.parentRuntimeId = p.runtimeInstanceId
    if (kind === 'wrong-created-from') f.runtime.revision.createdFromRevision = 1
    if (kind === 'stale-r2') f.direct.stateVersion = 'rsv2:44444444-4444-4444-8444-444444444444'
    if (kind === 'missing-freeze') f.controls.get(f.runtime._id).lockedEvidenceSnapshot = null
    if (kind === 'copied-basis') Object.assign(f.frozen, { snapshotId: f.directFrozen.snapshotId })
    if (kind === 'correction') f.frozen.serializationCorrection = { receiptId: randomUUID(), bodyHash: 'a'.repeat(64) }
    if (kind === 'tampered-audit') f.lockAudits[0].diff.actionKey = 'APPROVE'
    if (kind === 'sibling') f.children.get(f.direct._id).push({ _id: '6ad715c91f39fea112115876' })
    if (kind === 'copied-r1-lock') { f.frozen.lockSnapshotId = f.originalFrozen.lockSnapshotId; f.runtime.lockedEvidenceSnapshot.lockSnapshotId = f.frozen.lockSnapshotId; f.runtime.framework_state.lock.snapshot.snapshotId = f.frozen.lockSnapshotId }
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toThrow()
    expect(f.rows).toHaveLength(0)
    expect(f.deps.executeFrameworkGuidance).not.toHaveBeenCalled()
  })
  test('R3 uses immediate R2 BSON partial and actual unchanged native plan comparator', async () => {
    const f = useRealRevisionPlanComparator(successorRevisionFixture())
    f.parentIndex.partialFilterExpression = { customerId: new (await import('mongoose')).default.Types.ObjectId(p.customerId),
      tenantId: new (await import('mongoose')).default.Types.ObjectId(p.tenantId),
      'revision.parentRuntimeId': new (await import('mongoose')).default.Types.ObjectId(successor.parentRuntimeInstanceId) }
    expect((await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).run.status).toBe('ARL_PASSED')
    const stale = useRealRevisionPlanComparator(successorRevisionFixture()); stale.planningRuntime.updatedAt = '2026-10-19T11:00:00.000Z'
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(stale.args)).rejects.toMatchObject({ details: { reason: 'REVISION_PLANNING_BASIS_CHANGED' } })
    expect(stale.rows).toHaveLength(0)
  })
  test('v3 event rejects resealed changed native identity/parent basis without changing v2 interpretation', async () => {
    const f = successorRevisionFixture(); await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    for (const change of [row => { row.body.classification.runtimeInstanceId = f.direct._id; row.runtimeInstanceId = f.direct._id },
      row => { row.body.basis.lineage.parentBasis.basisStateVersion = f.runtime.stateVersion },
      row => { row.body.basis.snapshotId = f.directFrozen.snapshotId },
      row => { row.body.basis.lockSnapshotId = f.originalFrozen.lockSnapshotId }]) {
      const row = JSON.parse(JSON.stringify(f.rows[0])); change(row); row.bodyHash = membershipHash(row.body)
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
    }
  })
})


describe('R3 actual early GRR authorization with native classification read effects', () => {
  test.each([false, true])('own claim basis changed=%s is checked before framework/provider work', async changed => {
    const f = successorRevisionFixture(), framework = jest.fn(() => { throw new Error('COMPONENT_FRAMEWORK_BOUNDARY_REACHED') })
    const nativeEffects = await installNativeOrphanReadEffects(f.runtime)
    let observed
    try {
      f.deps.executeFrameworkGuidance = jest.fn(async input => {
        if (changed) {
          f.runtime.stateVersion = 'rsv2:44444444-4444-4444-8444-444444444444'
          f.frozen.basisStateVersion = f.runtime.stateVersion
          f.frozen.snapshotId = 'evidence_snapshot_44444444-4444-4444-8444-444444444444'
          Object.assign(f.runtime.lockedEvidenceSnapshot, { basisStateVersion: f.frozen.basisStateVersion, snapshotId: f.frozen.snapshotId })
        }
        try { return await input.deps.createGovernedReasoningExecution({ actorUserId: p.actorUserId,
          runtimeInstanceId: f.runtime._id, scopes: f.args.scopes, payload: {}, deps: { executionMode: 'LEGACY',
            resolveRuntimeInstance: async () => f.runtime, resolveFrameworkPackage: framework } }) }
        catch (error) { observed = error; throw error }
      })
      if (changed) {
        await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'CLAIM_BASIS_CHANGED' } })
        expect(observed).toMatchObject({ code: 'ISOLATED_SYNTHETIC_OUTCOME_BLOCKED', details: { reason: 'CLAIM_BASIS_CHANGED' } })
        expect(framework).not.toHaveBeenCalled()
      } else {
        expect((await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).run.status).toBe('UNKNOWN')
        expect(observed.message).toBe('COMPONENT_FRAMEWORK_BOUNDARY_REACHED')
        expect(framework).toHaveBeenCalledTimes(1)
      }
      expect(nativeEffects.reads).toHaveLength(2)
      expect(f.args.providerRuntimeDeps.frameworkGuidanceProviderAdapterFactory).not.toHaveBeenCalled()
      expect(f.deps.executeWorkingDraft).not.toHaveBeenCalled(); expect(f.deps.approveWorkingDraftMeaning).not.toHaveBeenCalled()
      expect(f.rows.map(row => row.phase)).toEqual(['CLAIM', 'RESULT'])
      expect(f.rows[1].body.status).toBe('UNKNOWN')
    } finally { nativeEffects.restore() }
  })
})


describe('R3 preserved failed binding run continuation', () => {
  const prepare = async () => {
    const f = successorRevisionFixture()
    const owner = f.deps.executeFrameworkGuidance.getMockImplementation()
    f.deps.executeFrameworkGuidance.mockImplementationOnce(async () => { throw Object.assign(new Error('assignedPack mismatch'), {
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID', details: { field: 'assignedPack', activationId: 'audience' } }) })
    await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    const [claim, result] = f.rows
    const continuation = { failedClaimEventId: claim.eventId, failedClaimBodyHash: claim.bodyHash,
      failedResultEventId: result.eventId, failedResultBodyHash: result.bodyHash }
    f.args.payload = { ...f.args.payload, requestKey: randomUUID(), continuation }
    f.deps.executeFrameworkGuidance.mockImplementation(owner)
    for (const key of ['OutcomeQualityStageExecution', 'GovernedReasoningExecution', 'GovernedRuntimeArtifact'])
      f.deps.models[key] = { findOne: jest.fn(async () => null) }
    return f
  }
  test('appends one v4 pair, leaves original rows unchanged, and reads both attempts without redispatch', async () => {
    const f = await prepare(), originals = membershipHash(f.rows.slice(0, 2))
    const result = await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    expect(result.run.status).toBe('ARL_PASSED')
    expect(result.priorRuns[0]).toMatchObject({ status: 'UNKNOWN', resultEventId: f.rows[1].eventId,
      failure: { failureCode: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID' } })
    expect(f.rows.map(r => r.phase)).toEqual(['CLAIM', 'RESULT', 'CONTINUATION_CLAIM', 'CONTINUATION_RESULT'])
    expect(f.rows.slice(2).every(r => r.body.version === 'isolated-synthetic-outcome-run.v4')).toBe(true)
    for (const row of f.rows) assertSyntheticOutcomeRunEvent(row)
    const calls = f.deps.executeFrameworkGuidance.mock.calls.length
    expect((await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).run.status).toBe('ARL_PASSED')
    expect(f.deps.executeFrameworkGuidance).toHaveBeenCalledTimes(calls)
    expect(membershipHash(f.rows.slice(0, 2))).toBe(originals)
    expect((await nativeIsolatedOwner.inspectIsolatedSyntheticOutcome(f.args)).run.status).toBe('ARL_PASSED')
  })
  test.each(['failedClaimEventId', 'failedClaimBodyHash', 'failedResultEventId', 'failedResultBodyHash'])('rejects stale %s before claiming', async key => {
    const f = await prepare(); f.args.payload.continuation[key] = key.endsWith('Id') ? randomUUID() : 'f'.repeat(64)
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'CONTINUATION_SOURCE_INVALID' } })
    expect(f.rows).toHaveLength(2)
  })
  test.each(['OutcomeQualityStageExecution', 'GovernedReasoningExecution', 'GovernedRuntimeArtifact'])('rejects independently detected prior %s even with empty receipt arrays', async key => {
    const f = await prepare(); f.deps.models[key].findOne.mockResolvedValue({ _id: 'prior' })
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'CONTINUATION_PRIOR_EXECUTION_EXISTS' } })
    expect(f.rows).toHaveLength(2)
    const filter = f.deps.models[key].findOne.mock.calls[0][0]
    expect(filter.$or).toEqual([
      { [key === 'OutcomeQualityStageExecution' ? 'requestId' : key === 'GovernedReasoningExecution' ? 'executionEvidence.syntheticClassification.requestId' : 'lineageSummary.syntheticClassification.requestId']: f.plan.requestId },
      { [key === 'OutcomeQualityStageExecution' ? 'planId' : key === 'GovernedReasoningExecution' ? 'executionEvidence.syntheticClassification.planId' : 'lineageSummary.syntheticClassification.planId']: f.plan.planId },
    ])
  })
  test('rejects another cause of failure rather than allowing a generic retry', async () => {
    const f = await prepare(); f.rows[1].body.failure.details.field = 'acceptedTruth'
    f.rows[1].bodyHash = membershipHash(f.rows[1].body)
    f.audits.find(a => String(a._id) === String(f.rows[1].auditId)).diff.bodyHash = f.rows[1].bodyHash
    f.args.payload.continuation.failedResultBodyHash = f.rows[1].bodyHash
    await expect(nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)).rejects.toMatchObject({ details: { reason: 'CONTINUATION_SOURCE_INVALID' } })
  })
})

const descriptiveLink = () => ({ failedClaimEventId: randomUUID(), failedClaimBodyHash: 'a'.repeat(64),
  failedResultEventId: randomUUID(), failedResultBodyHash: 'b'.repeat(64),
  guidanceStageExecutionId: 'outcome_quality_stage_' + randomUUID(), guidanceMaterialHash: 'c'.repeat(64),
  draftStageExecutionId: 'outcome_quality_stage_' + randomUUID(), draftMaterialHash: 'd'.repeat(64),
  failedArlStageExecutionId: 'outcome_quality_stage_' + randomUUID(), failedArlMaterialHash: 'e'.repeat(64) })
const authorisedLink = () => ({ ...descriptiveLink(), approvalReference: AUTHORISED_ARL_APPROVAL.reference,
  approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256, discrepancyOutcome: 'DISCREPANCY',
  discrepancyPackSha256: AUTHORISED_ARL_APPROVAL.discrepancyPackSha256 })

describe('strict v19 descriptive replay event without historical reinterpretation', () => {
  const fixture = async phase => {
    const f = successorRevisionFixture(); await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    const row = JSON.parse(JSON.stringify(f.rows[phase === 'DESCRIPTIVE_REPAIR_CLAIM' ? 0 : 1]))
    Object.assign(row.body, { version: 'isolated-synthetic-outcome-run.v19', phase, descriptiveRepair: descriptiveLink() })
    Object.assign(row, { phase })
    if (phase === 'DESCRIPTIVE_REPAIR_RESULT') Object.assign(row.body, { status: 'UNKNOWN', stageRefs: [], grrRefs: [], failure: { failureCode: 'EXPLICIT_COMPONENT_UNKNOWN' } })
    row.body.payloadHash = row.payloadHash = membershipHash({ requestKey: row.requestKey, requestId: row.body.plan.requestId,
      planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint, descriptiveRepair: row.body.descriptiveRepair })
    row.bodyHash = membershipHash(row.body)
    return row
  }
  test.each(['DESCRIPTIVE_REPAIR_CLAIM', 'DESCRIPTIVE_REPAIR_RESULT'])('accepts exact %s and preserves valid v18 body interpretation', async phase => {
    const row = await fixture(phase)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    expect(new Event(row).validateSync()).toBeUndefined()
    const old = JSON.parse(JSON.stringify(row)); old.body.version = 'isolated-synthetic-outcome-run.v18'
    old.phase = old.body.phase = phase.replace('DESCRIPTIVE', 'HOLISTIC')
    old.body.holisticRepair = old.body.descriptiveRepair; delete old.body.descriptiveRepair
    old.body.payloadHash = old.payloadHash = membershipHash({ requestKey: old.requestKey, requestId: old.body.plan.requestId,
      planId: old.body.plan.planId, expectedPlanFingerprint: old.body.plan.planFingerprint, holisticRepair: old.body.holisticRepair })
    old.bodyHash = membershipHash(old.body)
    expect(assertSyntheticOutcomeRunEvent(old)).toEqual(old.body)
  })
  test.each(['phase', 'extra-link', 'missing-link', 'link-hash', 'payload', 'status', 'combined'])('rejects resealed %s before persistence', async kind => {
    const row = await fixture('DESCRIPTIVE_REPAIR_CLAIM')
    if (kind === 'phase') row.phase = row.body.phase = 'HOLISTIC_REPAIR_CLAIM'
    if (kind === 'extra-link') row.body.descriptiveRepair.force = true
    if (kind === 'missing-link') delete row.body.descriptiveRepair.draftStageExecutionId
    if (kind === 'link-hash') row.body.descriptiveRepair.failedClaimBodyHash = 'changed'
    if (kind === 'payload') row.payloadHash = row.body.payloadHash = 'f'.repeat(64)
    if (kind === 'status') row.body.status = 'ARL_PASSED'
    if (kind === 'combined') row.body.holisticRepair = descriptiveLink()
    row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
    await expect(new Event(row).validate()).rejects.toThrow()
  })
})

describe('strict v20 prospective authorised review journal', () => {
  const fixture = async phase => {
    const f = successorRevisionFixture(); await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    const row = JSON.parse(JSON.stringify(f.rows[phase === 'AUTHORISED_REVIEW_CLAIM' ? 0 : 1]))
    Object.assign(row.body, { version: 'isolated-synthetic-outcome-run.v20', phase, createdAt: '2026-10-22T10:08:29.000Z',
      authorisedReview: authorisedLink(), reviewApproval: { ...AUTHORISED_ARL_APPROVAL } })
    row.phase = phase
    if (phase === 'AUTHORISED_REVIEW_RESULT') Object.assign(row.body, { status: 'UNKNOWN', stageRefs: [], grrRefs: [], failure: { failureCode: 'COMPONENT_UNCERTAIN' } })
    row.body.payloadHash = row.payloadHash = membershipHash({ requestKey: row.requestKey, requestId: row.body.plan.requestId,
      planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint, authorisedReview: row.body.authorisedReview })
    row.bodyHash = membershipHash(row.body)
    return row
  }
  test.each(['AUTHORISED_REVIEW_CLAIM', 'AUTHORISED_REVIEW_RESULT'])('retains exact immutable %s approval and actual recorder separately', async phase => {
    const row = await fixture(phase)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    expect(row.body.reviewApproval.approverName).toBe('Angus Gregory')
    expect(row.body.actorUserId).toBe(p.actorUserId)
  })
  test.each(['before approval', 'invented approver', 'approval hash', 'PASS review', 'combined', 'extra approval', 'old phase'])('rejects resealed %s', async kind => {
    const row = await fixture('AUTHORISED_REVIEW_CLAIM')
    if (kind === 'before approval') row.body.createdAt = '2026-10-22T10:08:27.000Z'
    if (kind === 'invented approver') row.body.reviewApproval.approverName = 'Andrew'
    if (kind === 'approval hash') row.body.authorisedReview.approvalSha256 = '1'.repeat(64)
    if (kind === 'PASS review') row.body.reviewApproval.discrepancyOutcome = 'PASS'
    if (kind === 'combined') row.body.descriptiveRepair = descriptiveLink()
    if (kind === 'extra approval') row.body.reviewApproval.approverUserId = p.actorUserId
    if (kind === 'old phase') row.phase = row.body.phase = 'DESCRIPTIVE_REPAIR_CLAIM'
    row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
    await expect(new Event(row).validate()).rejects.toThrow()
  })
  const addObservation = row => {
    const link = row.body.authorisedReview, claim = row.body.claim
    const requestIdentity = authorisedArlRequestIdentity(claim.eventId, claim.bodyHash, AUTHORISED_ARL_BODY.payloadSha256)
    row.body.failure = { failureCode: 'ARL_AUTHORISED_REVIEW_UNRESOLVED', details: { reason: 'COMPLETED_RESPONSE_UNUSABLE', authorisedReview: {
      contractVersion: 'authorised-arl-review.v1', claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
      approvalReference: AUTHORISED_ARL_APPROVAL.reference, approvalSha256: AUTHORISED_ARL_APPROVAL.documentSha256, discrepancyOutcome: 'DISCREPANCY',
      workingDraftStageExecutionId: AUTHORISED_ARL_SCOPE.workingDraftId, workingDraftOutputFingerprint: '1'.repeat(64), workingDraftAttemptFingerprint: '2'.repeat(64),
      workingDraftMaterialHash: link.draftMaterialHash, priorArlStageExecutionId: AUTHORISED_ARL_SCOPE.priorArlId, priorArlAttemptFingerprint: '3'.repeat(64),
      priorArlMaterialHash: link.failedArlMaterialHash, priorResponseId: 'resp_prior', requestPayloadSha256: AUTHORISED_ARL_BODY.payloadSha256,
      requestPayloadBytes: AUTHORISED_ARL_BODY.payloadBytes, requestContextHash: AUTHORISED_ARL_BODY.contextHash, requestContextBytes: AUTHORISED_ARL_BODY.contextBytes,
      transportVersion: AUTHORISED_ARL_BODY.transportVersion, providerConfigurationVersion: 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V7_EXACT_TRANSPORT',
      methodFingerprint: '1b2e77dabcb15eac8da085cd4dfedc0807743ab3d93194cb57e2d0b57eb6186e', requestIdentity,
      grrIdempotencyKey: 'ARL_AUTHORISED_REVIEW:' + requestIdentity, responseState: 'FRESH', responseId: 'resp_observed_unusable', unresolvedReason: '',
    } } }
    row.bodyHash = membershipHash(row.body)
    return row
  }
  test('persists actual fresh response observation as UNKNOWN without inventing an ARL stage', async () => {
    const row = addObservation(await fixture('AUTHORISED_REVIEW_RESULT'))
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    expect(row.body.stageRefs).toEqual([])
  })
  test.each(['semantic promotion', 'changed source', 'changed claim', 'pending', 'wrong failure'])('rejects observation-only %s', async kind => {
    const row = addObservation(await fixture('AUTHORISED_REVIEW_RESULT'))
    const observed = row.body.failure.details.authorisedReview
    if (kind === 'semantic promotion') row.body.status = 'ARL_PASSED'
    if (kind === 'changed source') observed.workingDraftMaterialHash = '9'.repeat(64)
    if (kind === 'changed claim') row.body.claim.bodyHash = '9'.repeat(64)
    if (kind === 'pending') Object.assign(observed, { responseState: 'PENDING', responseId: '' })
    if (kind === 'wrong failure') row.body.failure.failureCode = 'PASS'
    row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
})

describe('strict isolated downstream completion journal v21', () => {
  const source = () => ({ claimEventId: randomUUID(), claimBodyHash: '1'.repeat(64), resultEventId: randomUUID(), resultBodyHash: '2'.repeat(64),
    workingDraftStageExecutionId: 'outcome_quality_stage_' + randomUUID(), workingDraftMaterialHash: '3'.repeat(64),
    arlStageExecutionId: 'outcome_quality_stage_' + randomUUID(), arlMaterialHash: '4'.repeat(64) })
  const fixture = async phase => {
    const f = successorRevisionFixture(); await nativeIsolatedOwner.executeIsolatedSyntheticOutcome(f.args)
    const row = JSON.parse(JSON.stringify(f.rows[phase === 'COMPLETION_CLAIM' ? 0 : 1]))
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v21'; row.body.completionSource = source()
    if (phase === 'COMPLETION_RESULT') Object.assign(row.body, { status: 'UNKNOWN', stageRefs: [], grrRefs: [], failure: { failureCode: 'EXPLICIT_COMPONENT_UNKNOWN' } })
    row.body.payloadHash = row.payloadHash = membershipHash({ requestKey: row.requestKey, requestId: row.body.plan.requestId,
      planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource })
    row.bodyHash = membershipHash(row.body)
    return row
  }
  test.each(['COMPLETION_CLAIM', 'COMPLETION_RESULT'])('accepts exact %s without interpreting it as ARL or final assets', async phase => {
    const row = await fixture(phase)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    await expect(new Event(row).validate()).resolves.toBeUndefined()
  })
  test.each(['source-extra', 'source-missing', 'source-hash', 'same-source', 'payload', 'phase', 'arl-pass', 'pretend-delivery'])('rejects resealed %s', async kind => {
    const row = await fixture('COMPLETION_RESULT')
    if (kind === 'source-extra') row.body.completionSource.force = true
    if (kind === 'source-missing') delete row.body.completionSource.workingDraftMaterialHash
    if (kind === 'source-hash') row.body.completionSource.arlMaterialHash = 'changed'
    if (kind === 'same-source') row.body.completionSource.arlStageExecutionId = row.body.completionSource.workingDraftStageExecutionId
    if (kind === 'payload') row.payloadHash = row.body.payloadHash = 'f'.repeat(64)
    if (kind === 'phase') row.phase = row.body.phase = 'RESULT'
    if (kind === 'arl-pass') row.body.status = 'ARL_PASSED'
    if (kind === 'pretend-delivery') { row.body.status = 'BLOCKED'; row.body.failure.failureCode = 'SYNTHETIC_TEST_DELIVERY_HELD' }
    row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
  test('completion payload rejects caller-owned capability, mode and extra provider settings', async () => {
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    const f = coordinatorFixture(), payload = { ...f.args.payload, completionSource: source() }
    expect(isolatedSyntheticCompleteSchema.safeParse(payload).success).toBe(true)
    for (const extra of [{ force: true }, { executionMode: 'LIVE_TEST' }, { providerDescriptor: {} }, { authorisedReview: authorisedLink() }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload, ...extra }).success).toBe(false)
  })
  test.each(['COMPLETION_REFERENCE_CLAIM', 'COMPLETION_REFERENCE_RESULT'])('accepts strict v22 %s with an immutable stopped parent link', async phase => {
    const row = await fixture(phase.endsWith('_CLAIM') ? 'COMPLETION_CLAIM' : 'COMPLETION_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v22'
    row.body.referenceRecovery = { claimEventId: randomUUID(), claimBodyHash: '5'.repeat(64), resultEventId: randomUUID(), resultBodyHash: '6'.repeat(64) }
    row.body.payloadHash = row.payloadHash = membershipHash({ requestKey: row.requestKey, requestId: row.body.plan.requestId,
      planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint,
      completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery })
    row.bodyHash = membershipHash(row.body)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    for (const kind of ['missing', 'extra', 'hash', 'same']) {
      const changed = JSON.parse(JSON.stringify(row))
      if (kind === 'missing') delete changed.body.referenceRecovery
      if (kind === 'extra') changed.body.referenceRecovery.force = true
      if (kind === 'hash') changed.body.referenceRecovery.resultBodyHash = 'bad'
      if (kind === 'same') changed.body.referenceRecovery.resultEventId = changed.body.referenceRecovery.claimEventId
      changed.body.payloadHash = changed.payloadHash = membershipHash({ requestKey: changed.requestKey, requestId: changed.body.plan.requestId,
        planId: changed.body.plan.planId, expectedPlanFingerprint: changed.body.plan.planFingerprint,
        completionSource: changed.body.completionSource, ...(changed.body.referenceRecovery ? { referenceRecovery: changed.body.referenceRecovery } : {}) })
      changed.bodyHash = membershipHash(changed.body)
      expect(() => assertSyntheticOutcomeRunEvent(changed)).toThrow()
    }
  })

  const titleFixture = async phase => {
    const row = await fixture(phase.endsWith('_CLAIM') ? 'COMPLETION_CLAIM' : 'COMPLETION_RESULT')
    row.phase = row.body.phase = phase
    row.body.version = 'isolated-synthetic-outcome-run.v23'
    row.body.referenceRecovery = { claimEventId: randomUUID(), claimBodyHash: '5'.repeat(64),
      resultEventId: randomUUID(), resultBodyHash: '6'.repeat(64) }
    row.body.titleRecovery = { claimEventId: randomUUID(), claimBodyHash: '7'.repeat(64),
      resultEventId: randomUUID(), resultBodyHash: '8'.repeat(64), narrativeStageExecutionId: 'outcome_quality_stage_' + randomUUID(),
      narrativeMaterialHash: '9'.repeat(64), titleHash: membershipHash('Working Draft') }
    if (phase.endsWith('_RESULT')) row.body.stageRefs = [{ stageKey: 'OUTCOME_NARRATIVE_PLAN',
      stageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, status: 'SUCCEEDED',
      inputFingerprint: 'a'.repeat(64), outputFingerprint: 'b'.repeat(64), attemptFingerprint: 'c'.repeat(64),
      materialHash: row.body.titleRecovery.narrativeMaterialHash, grrExecutionId: '', grrRuntimeArtifactId: '' }]
    resealTitle(row)
    return row
  }
  const resealTitle = row => {
    row.body.payloadHash = row.payloadHash = membershipHash({ requestKey: row.requestKey, requestId: row.body.plan.requestId,
      planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint,
      completionSource: row.body.completionSource, ...(row.body.referenceRecovery ? { referenceRecovery: row.body.referenceRecovery } : {}),
      ...(row.body.titleRecovery ? { titleRecovery: row.body.titleRecovery } : {}) })
    row.bodyHash = membershipHash(row.body)
  }
  test.each(['COMPLETION_TITLE_CLAIM', 'COMPLETION_TITLE_RESULT'])('accepts strict v23 %s with a fixed reused Narrative and hashed title', async phase => {
    const row = await titleFixture(phase), before = JSON.stringify(row)
    expect(assertSyntheticOutcomeRunEvent(row)).toEqual(row.body)
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    expect(JSON.stringify(row)).toBe(before)
  })
  test.each(['missing title', 'missing reference', 'extra title', 'caller title', 'bad title hash', 'bad narrative hash',
    'bad narrative id', 'bad parent id', 'same parent ids', 'reused source parent', 'reused reference parent',
    'wrong phase', 'downgraded version', 'missing reused Narrative', 'changed reused Narrative', 'changed Narrative hash',
    'failed reused Narrative', 'pretend ARL pass'])('rejects resealed v23 %s', async kind => {
    const row = await titleFixture('COMPLETION_TITLE_RESULT')
    if (kind === 'missing title') delete row.body.titleRecovery
    if (kind === 'missing reference') delete row.body.referenceRecovery
    if (kind === 'extra title') row.body.titleRecovery.extra = true
    if (kind === 'caller title') row.body.title = 'Caller title'
    if (kind === 'bad title hash') row.body.titleRecovery.titleHash = 'bad'
    if (kind === 'bad narrative hash') row.body.titleRecovery.narrativeMaterialHash = 'bad'
    if (kind === 'bad narrative id') row.body.titleRecovery.narrativeStageExecutionId = 'not-a-stage'
    if (kind === 'bad parent id') row.body.titleRecovery.claimEventId = 'not-a-uuid'
    if (kind === 'same parent ids') row.body.titleRecovery.resultEventId = row.body.titleRecovery.claimEventId
    if (kind === 'reused source parent') row.body.titleRecovery.claimEventId = row.body.completionSource.claimEventId
    if (kind === 'reused reference parent') row.body.titleRecovery.resultEventId = row.body.referenceRecovery.resultEventId
    if (kind === 'wrong phase') row.phase = row.body.phase = 'COMPLETION_REFERENCE_RESULT'
    if (kind === 'downgraded version') row.body.version = 'isolated-synthetic-outcome-run.v22'
    if (kind === 'missing reused Narrative') row.body.stageRefs = []
    if (kind === 'changed reused Narrative') row.body.stageRefs[0].stageExecutionId = 'outcome_quality_stage_' + randomUUID()
    if (kind === 'changed Narrative hash') row.body.stageRefs[0].materialHash = 'a'.repeat(64)
    if (kind === 'failed reused Narrative') row.body.stageRefs[0].status = 'FAILED'
    if (kind === 'pretend ARL pass') row.body.status = 'ARL_PASSED'
    resealTitle(row)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
  test('binds the exact title hash in the signed payload instead of accepting an unbound replacement', async () => {
    const row = await titleFixture('COMPLETION_TITLE_CLAIM')
    row.body.titleRecovery.titleHash = membershipHash('Changed title')
    row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })
  test('v23 HTTP payload requires reference lineage and rejects caller title or mode settings', async () => {
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    const row = await titleFixture('COMPLETION_TITLE_CLAIM')
    const payload = { requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource,
      referenceRecovery: row.body.referenceRecovery, titleRecovery: row.body.titleRecovery }
    expect(isolatedSyntheticCompleteSchema.safeParse(payload).success).toBe(true)
    for (const extra of [{ title: 'Caller title' }, { executionMode: 'LIVE_TEST' }, { providerDescriptor: {} },
      { referenceRecovery: undefined }, { titleRecovery: { ...payload.titleRecovery, title: 'Caller title' } },
      { titleRecovery: { ...payload.titleRecovery, titleHash: 'bad' } },
      { titleRecovery: { ...payload.titleRecovery, resultEventId: payload.referenceRecovery.resultEventId } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload, ...extra }).success).toBe(false)
  })

  test.each(['COMPLETION_RL_PERSISTENCE_CLAIM', 'COMPLETION_RL_PERSISTENCE_RESULT'])('validates strict v24 %s with hashed saved provider recovery', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v24'
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: 'outcome_quality_stage_' + randomUUID(), shapingMaterialHash: 'c'.repeat(64), executionId: 'grr_exec_' + randomUUID(),
      runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'd'.repeat(64), artifactHash: 'e'.repeat(64) }
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash({ requestKey: row.requestKey,
      requestId: row.body.plan.requestId, planId: row.body.plan.planId, expectedPlanFingerprint: row.body.plan.planFingerprint,
      completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery, titleRecovery: row.body.titleRecovery,
      rlPersistenceRecovery: row.body.rlPersistenceRecovery }); row.bodyHash = membershipHash(row.body) }
    reseal()
    expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    for (const key of Object.keys(row.body.rlPersistenceRecovery)) {
      const old = row.body.rlPersistenceRecovery[key]; row.body.rlPersistenceRecovery[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.rlPersistenceRecovery[key] = old
    }
    reseal()
    row.body.rlPersistenceRecovery.findings = []; reseal()
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

  test.each(['COMPLETION_EXPRESSION_REPAIR_CLAIM', 'COMPLETION_EXPRESSION_REPAIR_RESULT'])('validates strict v25 %s and rejects unbound caller expression changes', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v25'
    const shapingId = 'outcome_quality_stage_' + randomUUID(), executionId = 'grr_exec_' + randomUUID(), artifactId = 'grr_art_' + randomUUID()
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: shapingId, shapingMaterialHash: 'c'.repeat(64), executionId, runtimeArtifactId: artifactId,
      executionHash: 'd'.repeat(64), artifactHash: 'e'.repeat(64) }
    row.body.expressionRepair = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: shapingId, shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: 'outcome_quality_stage_' + randomUUID(),
      failedRlMaterialHash: 'f'.repeat(64), executionId, runtimeArtifactId: artifactId, executionHash: 'd'.repeat(64), artifactHash: 'e'.repeat(64),
      expressionProfileVersion: 'outcome-readable-expression.v2' }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionRepair)) {
      const old = row.body.expressionRepair[key]; row.body.expressionRepair[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionRepair[key] = old
    }
    for (const extra of [{ output: {} }, { providerDescriptor: {} }, { expressionRepair: { ...row.body.expressionRepair, findings: [] } },
      { rlPersistenceRecovery: undefined }, { expressionRepair: { ...row.body.expressionRepair, claimEventId: row.body.titleRecovery.claimEventId } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.bodyHash = membershipHash({ ...row.body, expressionRepair: { ...row.body.expressionRepair, shapingMaterialHash: '0'.repeat(64) } })
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

  test.each(['COMPLETION_EXPRESSION_FOLLOWUP_CLAIM', 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT'])('validates strict v26 %s with exact reviewed output and all historical parentlinks', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v26'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionFollowup)) {
      const old = row.body.expressionFollowup[key]; row.body.expressionFollowup[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionFollowup[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionFollowup: { ...row.body.expressionFollowup, force: true } },
      { expressionRepair: undefined }, { expressionFollowup: { ...row.body.expressionFollowup, claimEventId: row.body.expressionRepair.claimEventId } },
      { expressionFollowup: { ...row.body.expressionFollowup, expressionProfileVersion: 'outcome-readable-expression.v2' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionFollowup.reviewedOutputFingerprint = 'f'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

  test.each(['COMPLETION_EXPRESSION_FAITHFUL_CLAIM', 'COMPLETION_EXPRESSION_FAITHFUL_RESULT'])('validates strict v27 %s, exact v4 hash and 14 distinct historical parents', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v27'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    row.body.expressionFaithful = { ...link('outcome-readable-expression.v4'), reviewedOutputFingerprint: 'f'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup, expressionFaithful: row.body.expressionFaithful })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionFaithful)) {
      const old = row.body.expressionFaithful[key]; row.body.expressionFaithful[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionFaithful[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionFaithful: { ...row.body.expressionFaithful, force: true } },
      { expressionFollowup: undefined }, { expressionFaithful: { ...row.body.expressionFaithful, claimEventId: row.body.expressionFollowup.claimEventId } },
      { expressionFaithful: { ...row.body.expressionFaithful, expressionProfileVersion: 'outcome-readable-expression.v3' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionFaithful.reviewedOutputFingerprint = '0'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

  test.each(['COMPLETION_EXPRESSION_CONTRACT_CLAIM', 'COMPLETION_EXPRESSION_CONTRACT_RESULT'])('validates strict v28 %s with Commercial profile and 16 distinct parents', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v28'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    row.body.expressionFaithful = { ...link('outcome-readable-expression.v4'), reviewedOutputFingerprint: 'f'.repeat(64) }
    row.body.expressionContract = { ...link('outcome-commercial-expression.v1'), reviewedOutputFingerprint: '0'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup, expressionFaithful: row.body.expressionFaithful, expressionContract: row.body.expressionContract })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionContract)) {
      const old = row.body.expressionContract[key]; row.body.expressionContract[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionContract[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionContract: { ...row.body.expressionContract, force: true } },
      { expressionFaithful: undefined }, { expressionContract: { ...row.body.expressionContract, claimEventId: row.body.expressionFaithful.claimEventId } },
      { expressionContract: { ...row.body.expressionContract, expressionProfileVersion: 'outcome-readable-expression.v4' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionContract.reviewedOutputFingerprint = '1'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })


  test.each(['COMPLETION_EXPRESSION_READABLE_CLAIM', 'COMPLETION_EXPRESSION_READABLE_RESULT'])('validates strict v29 %s with Commercial profile and 18 distinct parents', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v29'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    row.body.expressionFaithful = { ...link('outcome-readable-expression.v4'), reviewedOutputFingerprint: 'f'.repeat(64) }
    row.body.expressionContract = { ...link('outcome-commercial-expression.v1'), reviewedOutputFingerprint: '9'.repeat(64) }
    row.body.expressionReadable = { ...link('outcome-commercial-expression.v2'), reviewedOutputFingerprint: '0'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup, expressionFaithful: row.body.expressionFaithful, expressionContract: row.body.expressionContract, expressionReadable: row.body.expressionReadable })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionReadable)) {
      const old = row.body.expressionReadable[key]; row.body.expressionReadable[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionReadable[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionReadable: { ...row.body.expressionReadable, force: true } },
      { expressionContract: undefined }, { expressionReadable: { ...row.body.expressionReadable, claimEventId: row.body.expressionContract.claimEventId } },
      { expressionReadable: { ...row.body.expressionReadable, expressionProfileVersion: 'outcome-readable-expression.v4' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionReadable.reviewedOutputFingerprint = '1'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

  test.each(['COMPLETION_EXPRESSION_OVERLAY_CLAIM', 'COMPLETION_EXPRESSION_OVERLAY_RESULT'])('validates strict v30 %s with Commercial profile and 20 distinct parents', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v30'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    row.body.expressionFaithful = { ...link('outcome-readable-expression.v4'), reviewedOutputFingerprint: 'f'.repeat(64) }
    row.body.expressionContract = { ...link('outcome-commercial-expression.v1'), reviewedOutputFingerprint: '9'.repeat(64) }
    row.body.expressionReadable = { ...link('outcome-commercial-expression.v2'), reviewedOutputFingerprint: '0'.repeat(64) }
    row.body.expressionOverlay = { ...link('outcome-commercial-expression.v3'), reviewedOutputFingerprint: '8'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup, expressionFaithful: row.body.expressionFaithful, expressionContract: row.body.expressionContract, expressionReadable: row.body.expressionReadable, expressionOverlay: row.body.expressionOverlay })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionOverlay)) {
      const old = row.body.expressionOverlay[key]; row.body.expressionOverlay[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionOverlay[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionOverlay: { ...row.body.expressionOverlay, force: true } },
      { expressionReadable: undefined }, { expressionOverlay: { ...row.body.expressionOverlay, claimEventId: row.body.expressionReadable.claimEventId } },
      { expressionOverlay: { ...row.body.expressionOverlay, expressionProfileVersion: 'outcome-commercial-expression.v2' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionOverlay.reviewedOutputFingerprint = '1'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })


  test.each(['COMPLETION_EXPRESSION_PRESENTATION_CLAIM', 'COMPLETION_EXPRESSION_PRESENTATION_RESULT'])('validates strict v31 %s with Commercial profile and 22 distinct parents', async phase => {
    const row = await titleFixture(phase.endsWith('CLAIM') ? 'COMPLETION_TITLE_CLAIM' : 'COMPLETION_TITLE_RESULT')
    row.phase = row.body.phase = phase; row.body.version = 'isolated-synthetic-outcome-run.v31'
    const stage = () => 'outcome_quality_stage_' + randomUUID()
    const pair = () => ({ executionId: 'grr_exec_' + randomUUID(), runtimeArtifactId: 'grr_art_' + randomUUID(), executionHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64) })
    row.body.rlPersistenceRecovery = { claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), ...pair() }
    const link = profile => ({ claimEventId: randomUUID(), claimBodyHash: 'a'.repeat(64), resultEventId: randomUUID(), resultBodyHash: 'b'.repeat(64),
      narrativeStageExecutionId: row.body.titleRecovery.narrativeStageExecutionId, narrativeMaterialHash: row.body.titleRecovery.narrativeMaterialHash,
      shapingStageExecutionId: stage(), shapingMaterialHash: 'c'.repeat(64), failedRlStageExecutionId: stage(), failedRlMaterialHash: 'd'.repeat(64),
      ...pair(), expressionProfileVersion: profile })
    row.body.expressionRepair = link('outcome-readable-expression.v2')
    row.body.expressionFollowup = { ...link('outcome-readable-expression.v3'), reviewedOutputFingerprint: 'e'.repeat(64) }
    row.body.expressionFaithful = { ...link('outcome-readable-expression.v4'), reviewedOutputFingerprint: 'f'.repeat(64) }
    row.body.expressionContract = { ...link('outcome-commercial-expression.v1'), reviewedOutputFingerprint: '9'.repeat(64) }
    row.body.expressionReadable = { ...link('outcome-commercial-expression.v2'), reviewedOutputFingerprint: '0'.repeat(64) }
    row.body.expressionOverlay = { ...link('outcome-commercial-expression.v3'), reviewedOutputFingerprint: '7'.repeat(64) }
    row.body.expressionPresentation = { ...link('outcome-commercial-expression.v4'), reviewedOutputFingerprint: '8'.repeat(64) }
    const payload = () => ({ requestKey: row.requestKey, requestId: row.body.plan.requestId, planId: row.body.plan.planId,
      expectedPlanFingerprint: row.body.plan.planFingerprint, completionSource: row.body.completionSource, referenceRecovery: row.body.referenceRecovery,
      titleRecovery: row.body.titleRecovery, rlPersistenceRecovery: row.body.rlPersistenceRecovery, expressionRepair: row.body.expressionRepair,
      expressionFollowup: row.body.expressionFollowup, expressionFaithful: row.body.expressionFaithful, expressionContract: row.body.expressionContract, expressionReadable: row.body.expressionReadable, expressionOverlay: row.body.expressionOverlay, expressionPresentation: row.body.expressionPresentation })
    const reseal = () => { row.payloadHash = row.body.payloadHash = membershipHash(payload()); row.bodyHash = membershipHash(row.body) }
    reseal(); expect(() => assertSyntheticOutcomeRunEvent(row)).not.toThrow()
    await expect(new Event(row).validate()).resolves.toBeUndefined()
    const { isolatedSyntheticCompleteSchema } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    expect(isolatedSyntheticCompleteSchema.safeParse(payload()).success).toBe(true)
    for (const key of Object.keys(row.body.expressionPresentation)) {
      const old = row.body.expressionPresentation[key]; row.body.expressionPresentation[key] = 'invalid'; reseal()
      expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow(); row.body.expressionPresentation[key] = old
    }
    for (const extra of [{ output: {} }, { title: 'replacement' }, { expressionPresentation: { ...row.body.expressionPresentation, force: true } },
      { expressionOverlay: undefined }, { expressionPresentation: { ...row.body.expressionPresentation, claimEventId: row.body.expressionOverlay.claimEventId } },
      { expressionPresentation: { ...row.body.expressionPresentation, expressionProfileVersion: 'outcome-commercial-expression.v2' } }])
      expect(isolatedSyntheticCompleteSchema.safeParse({ ...payload(), ...extra }).success).toBe(false)
    reseal(); row.body.expressionPresentation.reviewedOutputFingerprint = '1'.repeat(64); row.bodyHash = membershipHash(row.body)
    expect(() => assertSyntheticOutcomeRunEvent(row)).toThrow()
  })

})
