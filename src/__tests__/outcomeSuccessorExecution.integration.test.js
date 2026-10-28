import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { OutcomeSuccessorOperation, OutcomeAsset, OutcomeAssetVersion, OutcomeKnowledgeCompositionPlan,
  OutcomeSession, OutcomeMessage, OutcomeDraft, OutcomeDraftIteration, OutcomeQualityStageExecution, RuntimeInstance, AuditLog } from '../models/index.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'
import { executeOutcomeSuccessorOperation, reconcileOutcomeSuccessorOperation } from '../services/outcomeSuccessorExecutionService.js'
import { projectOutcomeSuccessorLineage, requireOutcomeSuccessorSessionClaim,
  assertOutcomeSuccessorApprovedDraftBinding } from '../services/outcomeSuccessorOperationService.js'
import { hashOutcomeSuccessorValue } from '../services/outcomeSuccessorContract.js'
import { getOutcomeSuccessorOperation } from '../services/outcomeSuccessorService.js'
import { createRuntimeOutcomeSession, generateRuntimeOutcomeResponse, persistGovernedQualityDraft,
  approveRuntimeOutcomeDraft, buildGovernedDraftCustomerContent } from '../services/outcomeStudioService.js'

const run = process.env.RUN_OUTCOME_SUCCESSOR_ISOLATED === '1' ? describe : describe.skip
run('successor committed-owner reconciliation with isolated actual receipts', () => {
  let server
  const models = [OutcomeSuccessorOperation, OutcomeAsset, OutcomeAssetVersion, OutcomeKnowledgeCompositionPlan,
    OutcomeSession, OutcomeMessage, OutcomeDraft, OutcomeDraftIteration, OutcomeQualityStageExecution, RuntimeInstance, AuditLog]
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ binary: { version: '7.0.14',
      ...(process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } : {}) },
      replSet: { count: 1, storageEngine: 'wiredTiger' } })
    const uri = server.getUri('ss044_successor_execution_isolated')
    const target = new URL(uri)
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/ss044_successor_execution_isolated') throw new Error('Exact isolated loopback required')
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
    for (const model of models) { await model.createCollection(); await model.createIndexes() }
  }, 60000)
  beforeEach(async () => { for (const model of models) await model.collection.deleteMany({}) })
  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      if (mongoose.connection.name !== 'ss044_successor_execution_isolated' || mongoose.connection.host !== '127.0.0.1') throw new Error('Unsafe cleanup')
      await mongoose.connection.dropDatabase()
      expect(await mongoose.connection.db.listCollections().toArray()).toEqual([])
      await mongoose.disconnect()
    }
    if (server) { await server.stop(); expect(server.state).toBe('stopped') }
  }, 30000)
  const seed = async () => {
    const sourceRuntimeId = new mongoose.Types.ObjectId()
    const fixture = makeGovernedFinalisationFixture({ revisionNumber: 2, rootRuntimeId: sourceRuntimeId, parentRuntimeId: sourceRuntimeId })
    const acceptedContent = buildGovernedDraftCustomerContent(fixture.stages[4])
    fixture.draft.limitations = [...acceptedContent.limitations]
    fixture.iteration.limitations = [...acceptedContent.limitations]
    const sourceRecord = { _id: new mongoose.Types.ObjectId(), ...fixture.scope, runtimeInstanceId: sourceRuntimeId,
      outcomeAssetId: 'immutable-source', outcomeAssetVersionId: 'immutable-version', warnings: ['Retain qualification'],
      customerContent: { markdown: 'Synthetic historical source; never copied as successor content' } }
    const source = { ...Object.fromEntries(Object.entries(fixture.scope).map(([field, value]) => [field, String(value)])),
      runtimeInstanceId: String(sourceRuntimeId), outcomeAssetId: sourceRecord.outcomeAssetId,
      outcomeAssetVersionId: sourceRecord.outcomeAssetVersionId, sourceHash: 'a'.repeat(64),
      sourceVersionWitnessHash: hashOutcomeSuccessorValue(sourceRecord), revisionNumber: 1 }
    const target = { runtimeInstanceId: String(fixture.runtime._id), stateVersion: 'synthetic-target-state', revisionNumber: 2 }
    const operation = await OutcomeSuccessorOperation.create({ operationId: 'synthetic-successor-operation', actorUserId: fixture.plan.createdBy,
      customerId: fixture.scope.customerId, tenantId: fixture.scope.tenantId, sourceRuntimeInstanceId: sourceRuntimeId,
      targetRuntimeInstanceId: fixture.runtime._id, sourceAssetId: sourceRecord.outcomeAssetId,
      sourceAssetVersionId: sourceRecord.outcomeAssetVersionId, idempotencyKey: '8abedafd-8555-4342-be49-76ab906a26f7',
      requestId: fixture.plan.requestId, payloadFingerprint: 'controlled-payload-fingerprint',
      binding: { source, target, metadataFingerprint: 'c'.repeat(64), intentFingerprint: 'd'.repeat(64), contractFingerprint: 'e'.repeat(64) },
      refs: { planId: fixture.plan.planId, planFingerprint: fixture.plan.planFingerprint } })
    const lineage = projectOutcomeSuccessorLineage(operation)
    fixture.draft.lineageSummary.successor = lineage
    fixture.iteration.lineageSummary.successor = lineage
    fixture.session.contextBindings.successor = lineage
    const sourceRuntime = { ...fixture.runtime, _id: sourceRuntimeId,
      runtimeInstanceKey: `${fixture.runtime.runtimeInstanceKey}-source`,
      revision: { revisionNumber: 1, rootRuntimeId: sourceRuntimeId, parentRuntimeId: null } }
    fixture.runtime.stateVersion = target.stateVersion
    await RuntimeInstance.collection.insertMany([sourceRuntime, fixture.runtime])
    await OutcomeAsset.collection.insertOne({ _id: new mongoose.Types.ObjectId(), ...fixture.scope,
      runtimeInstanceId: sourceRuntimeId, outcomeAssetId: sourceRecord.outcomeAssetId })
    await OutcomeAssetVersion.collection.insertOne(sourceRecord)
    await OutcomeKnowledgeCompositionPlan.collection.insertOne(fixture.plan)
    await OutcomeSession.collection.insertOne(fixture.session)
    await OutcomeMessage.collection.insertOne({ _id: new mongoose.Types.ObjectId(), ...fixture.scope,
      sessionId: fixture.session.sessionId, messageId: 'synthetic-initial-message', role: 'USER', responseStatus: 'RESPONSE_GENERATED',
      contextBindings: { requestPlan: fixture.session.contextBindings.requestPlan } })
    await OutcomeDraft.collection.insertOne(fixture.draft)
    await OutcomeDraftIteration.collection.insertOne(fixture.iteration)
    await OutcomeQualityStageExecution.create(fixture.stages.map((stage) => ({ ...stage, createdBy: fixture.plan.createdBy })))
    const deps = {
      // Only access control and bounded accepted-evidence projection are controlled. Receipt validation,
      // source witness reads, executor CAS, operation transitions, audit and transactions are actual Mongo.
      readRuntimeControl: ({ runtimeInstanceId }) => RuntimeInstance.findById(runtimeInstanceId).lean(),
      assertRuntimePermission: async () => {},
      getPreflight: async ({ deps: preflightDeps }) => {
        const storedSource = await OutcomeAssetVersion.findOne({ outcomeAssetVersionId: sourceRecord.outcomeAssetVersionId })
          .session(preflightDeps.session).lean()
        const storedTarget = await RuntimeInstance.findById(fixture.runtime._id).session(preflightDeps.session).lean()
        preflightDeps.capturePreflightContext({ targetRuntime: storedTarget, sourcePlan: fixture.plan, candidate: fixture.plan })
        return { status: 'READY_FOR_CONFIRMATION', source: { ...source, sourceVersionWitnessHash: hashOutcomeSuccessorValue(storedSource) },
          target: { ...target, stateVersion: storedTarget.stateVersion }, metadataFingerprint: 'c'.repeat(64) }
      },
      createPlan: jest.fn(async () => { throw new Error('Committed owner must be retrieved') }),
      createSession: jest.fn(async () => { throw new Error('Committed owner must be retrieved') }),
      generateResponse: jest.fn(async () => { throw new Error('Committed owner must be retrieved') }),
    }
    return { fixture, operation, sourceRecord, deps, args: { actorUserId: fixture.plan.createdBy,
      operationId: operation.operationId, runtimeInstanceId: String(sourceRuntimeId), scopes: {}, deps } }
  }
  it('two callers finalize one operation from exact actual committed stage receipts without another provider', async () => {
    const value = await seed()
    const results = await Promise.all([executeOutcomeSuccessorOperation(value.args), executeOutcomeSuccessorOperation(value.args)])
    expect(results.some((result) => result.operation.status === 'SUCCEEDED')).toBe(true)
    expect(await OutcomeDraft.countDocuments({})).toBe(1)
    expect(await OutcomeDraftIteration.countDocuments({})).toBe(1)
    const audits = await AuditLog.find({ action: 'OUTCOME_SUCCESSOR_COMPLETED' })
    expect(audits).toHaveLength(1); expect(audits[0].verifySignature()).toBe(true)
    expect(value.deps.generateResponse).not.toHaveBeenCalled()
    expect(await OutcomeAssetVersion.findOne({ outcomeAssetVersionId: value.sourceRecord.outcomeAssetVersionId }).lean()).toEqual(value.sourceRecord)
  }, 30000)
  it('changed selected-source warning blocks before executor claim', async () => {
    const value = await seed()
    await OutcomeAssetVersion.collection.updateOne({ _id: value.sourceRecord._id }, { $set: { warnings: ['Changed qualification'] } })
    await expect(executeOutcomeSuccessorOperation(value.args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_CONFIRMATION_STALE' })
    expect((await OutcomeSuccessorOperation.findById(value.operation._id).lean()).claimId).toBe('')
    expect(await AuditLog.countDocuments({})).toBe(0)
  })
  it('completion audit failure rolls back SUCCEEDED and later reconciliation reads committed winner without providers', async () => {
    const value = await seed()
    value.deps.writeCompletionAudit = async () => { throw new Error('completion audit unavailable') }
    await expect(executeOutcomeSuccessorOperation(value.args)).rejects.toThrow('completion audit unavailable')
    expect((await OutcomeSuccessorOperation.findById(value.operation._id).lean()).status).toBe('RECOVERY_REQUIRED')
    expect(await AuditLog.countDocuments({})).toBe(0)
    delete value.deps.writeCompletionAudit
    expect((await reconcileOutcomeSuccessorOperation(value.args)).operation.status).toBe('SUCCEEDED')
    expect(await AuditLog.countDocuments({ action: 'OUTCOME_SUCCESSOR_COMPLETED' })).toBe(1)
    expect(value.deps.generateResponse).not.toHaveBeenCalled()
  })
  it('an invalid actual stage receipt cannot be accepted by operation readback', async () => {
    const value = await seed()
    await OutcomeQualityStageExecution.collection.updateOne({ stageExecutionId: value.fixture.stages[2].stageExecutionId }, { $set: { outputFingerprint: 'wrong' } })
    await expect(executeOutcomeSuccessorOperation(value.args)).rejects.toThrow()
    expect((await OutcomeSuccessorOperation.findById(value.operation._id).lean()).status).toBe('RECOVERY_REQUIRED')
    expect(await AuditLog.countDocuments({})).toBe(0)
  })
  it('generic confirmed-plan preparation cannot bypass the claimed operation', async () => {
    const value = await seed()
    await expect(requireOutcomeSuccessorSessionClaim({ runtime: value.fixture.runtime,
      requestId: value.fixture.plan.requestId, planId: value.fixture.plan.planId })).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED' })
    await OutcomeSuccessorOperation.updateOne({ _id: value.operation._id }, { $set: { claimId: 'trusted-executor' } })
    expect((await requireOutcomeSuccessorSessionClaim({ runtime: value.fixture.runtime,
      requestId: value.fixture.plan.requestId, planId: value.fixture.plan.planId,
      successorOperation: { operationId: value.operation.operationId, claimId: 'trusted-executor' } })).operationId)
      .toBe(value.operation.operationId)
    expect(value.deps.generateResponse).not.toHaveBeenCalled()
  })
  it('successor draft approval requires the exact completed operation, not a copied lineage label', async () => {
    const value = await seed()
    await expect(assertOutcomeSuccessorApprovedDraftBinding({ runtime: value.fixture.runtime,
      draft: value.fixture.draft, iteration: value.fixture.iteration })).rejects.toThrow()
    await executeOutcomeSuccessorOperation(value.args)
    expect((await assertOutcomeSuccessorApprovedDraftBinding({ runtime: value.fixture.runtime,
      draft: value.fixture.draft, iteration: value.fixture.iteration })).status).toBe('SUCCEEDED')
    await OutcomeSuccessorOperation.updateOne({ _id: value.operation._id },
      { $set: { 'binding.source.sourceVersionWitnessHash': 'f'.repeat(64) } })
    await expect(assertOutcomeSuccessorApprovedDraftBinding({ runtime: value.fixture.runtime,
      draft: value.fixture.draft, iteration: value.fixture.iteration })).rejects.toThrow()
  })
  it('an altered immutable source record invalidates successor approval before final asset writes', async () => {
    const value = await seed()
    await executeOutcomeSuccessorOperation(value.args)
    await OutcomeAssetVersion.collection.updateOne({ _id: value.sourceRecord._id }, { $set: { warnings: ['Changed qualification'] } })
    await expect(assertOutcomeSuccessorApprovedDraftBinding({ runtime: value.fixture.runtime,
      draft: value.fixture.draft, iteration: value.fixture.iteration })).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID' })
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
  })
  it('actual generic session/generation owners reject bypass before downstream work', async () => {
    const value = await seed()
    const ownerArgs = { actorUserId: value.fixture.plan.createdBy, runtimeInstanceId: value.fixture.runtime._id,
      scopes: {}, deps: { assertMutationPermission: async () => value.fixture.runtime } }
    await expect(createRuntimeOutcomeSession({ ...ownerArgs,
      payload: { requestId: value.fixture.plan.requestId, planId: value.fixture.plan.planId } }))
      .rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED' })
    const factory = jest.fn()
    await expect(generateRuntimeOutcomeResponse({ ...ownerArgs, sessionId: value.fixture.session.sessionId,
      messageId: 'synthetic-initial-message', frameworkGuidanceProviderAdapterFactory: factory }))
      .rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED' } })
    expect(factory).not.toHaveBeenCalled()
    expect(await AuditLog.countDocuments({})).toBe(0)
    await OutcomeSession.collection.updateOne({ _id: value.fixture.session._id }, { $unset: { 'contextBindings.successor': '' } })
    await expect(generateRuntimeOutcomeResponse({ ...ownerArgs, sessionId: value.fixture.session.sessionId,
      messageId: 'synthetic-initial-message', frameworkGuidanceProviderAdapterFactory: factory }))
      .rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_EXECUTION_CLAIM_REQUIRED' })
    expect(factory).not.toHaveBeenCalled()
  })
  it('actual draft owner creates a fresh governed successor once from controlled new receipts and preserves source', async () => {
    const value = await seed()
    await OutcomeDraft.collection.deleteMany({}); await OutcomeDraftIteration.collection.deleteMany({})
    await OutcomeMessage.collection.updateOne({ messageId: 'synthetic-initial-message' }, { $set: { responseStatus: 'PENDING_RESPONSE' } })
    await OutcomeSuccessorOperation.updateOne({ _id: value.operation._id }, { $set: { status: 'GENERATING', claimId: 'fresh-executor',
      'refs.sessionId': value.fixture.session.sessionId, 'refs.messageId': 'synthetic-initial-message' } })
    const operation = await OutcomeSuccessorOperation.findById(value.operation._id).lean()
    const args = { actorUserId: value.fixture.plan.createdBy, auditRequest: {}, knowledgePackBinding: value.fixture.draft.knowledgePackBinding,
      plan: value.fixture.plan, requestBinding: value.fixture.requestBinding, runtimeInstance: value.fixture.runtime,
      serializedMessage: { messageId: 'synthetic-initial-message', responseStatus: 'PENDING_RESPONSE' },
      serializedSession: { ...value.fixture.session, successor: projectOutcomeSuccessorLineage(operation), successorClaimId: 'fresh-executor' },
      stages: value.fixture.stages }
    const first = await persistGovernedQualityDraft(args)
    const second = await persistGovernedQualityDraft(args)
    expect(first.draft.draftId).toBe(second.draft.draftId)
    expect(await OutcomeDraft.countDocuments({})).toBe(1); expect(await OutcomeDraftIteration.countDocuments({})).toBe(1)
    const draft = await OutcomeDraft.findOne({}).lean()
    expect(draft.lineageSummary.successor.sourceVersionWitnessHash).toBe(value.operation.binding.source.sourceVersionWitnessHash)
    expect(draft.lineageSummary.successor.targetRevisionNumber).toBe(2)
    const persistedContent = (await OutcomeDraftIteration.findOne({}).lean()).customerContent
    expect(persistedContent).toEqual(value.fixture.iteration.customerContent)
    expect(persistedContent).not.toEqual(value.sourceRecord.customerContent)
    expect(await OutcomeAssetVersion.findOne({ outcomeAssetVersionId: value.sourceRecord.outcomeAssetVersionId }).lean()).toEqual(value.sourceRecord)
    expect((await reconcileOutcomeSuccessorOperation(value.args)).operation.status).toBe('SUCCEEDED')
    expect(await AuditLog.countDocuments({ action: 'OUTCOME_DRAFT_GENERATED' })).toBe(1)
    expect(await AuditLog.countDocuments({ action: 'OUTCOME_SUCCESSOR_COMPLETED' })).toBe(1)
  })
  it('actual approval preserves safe successor lineage and rejects uncommitted operation before render/final writes', async () => {
    const value = await seed()
    const render = jest.fn()
    const args = { actorUserId: value.fixture.plan.createdBy, runtimeInstanceId: value.fixture.runtime._id,
      sessionId: value.fixture.session.sessionId, draftId: value.fixture.draft.draftId, scopes: {},
      deps: { assertMutationPermission: async () => value.fixture.runtime,
        prepareRender: render, loadRenderingPackReceipt: value.fixture.loadRenderingPackReceipt } }
    await expect(approveRuntimeOutcomeDraft(args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_RESULT_LINEAGE_INVALID' })
    expect(render).not.toHaveBeenCalled()
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    await executeOutcomeSuccessorOperation(value.args)
    delete args.deps.prepareRender
    const approved = await approveRuntimeOutcomeDraft(args)
    expect(approved.assetVersion.successor.operationId).toBe(value.operation.operationId)
    expect(approved.assetVersion.successor.sourceVersionWitnessHash).toBe(value.operation.binding.source.sourceVersionWitnessHash)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(2)
  }, 30000)
  it.each([
    ['iteration', 'customerContent.markdown', 'Changed meaning'],
    ['iteration', 'customerContent.sections.0.body', 'Unqualified changed claim'],
    ['iteration', 'title', 'Changed title'], ['iteration', 'limitations', ['Removed or changed qualification']],
    ['iteration', 'warnings', ['New warning']], ['draft', 'title', 'Changed draft title'],
    ['draft', 'limitations', ['Changed draft qualification']], ['draft', 'warnings', ['Changed draft warning']],
    ['draft', 'customerContent', { markdown: 'Contradictory extra draft content' }],
    ['draft', 'warnings', 'Malformed warning record'], ['iteration', 'limitations', 'Malformed qualification record'],
  ])('changed persisted %s %s cannot complete or reconcile an accepted receipt chain', async (owner, field, replacement) => {
    const value = await seed()
    const model = owner === 'draft' ? OutcomeDraft : OutcomeDraftIteration
    const record = owner === 'draft' ? value.fixture.draft : value.fixture.iteration
    await model.collection.updateOne({ _id: record._id }, { $set: { [field]: replacement } })
    await expect(executeOutcomeSuccessorOperation(value.args)).rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED' } })
    expect((await OutcomeSuccessorOperation.findById(value.operation._id).lean()).status).toBe('BLOCKED')
    await expect(reconcileOutcomeSuccessorOperation(value.args)).rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED' } })
    expect(await AuditLog.countDocuments({ action: 'OUTCOME_SUCCESSOR_COMPLETED' })).toBe(0)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await OutcomeAssetVersion.findOne({ outcomeAssetVersionId: value.sourceRecord.outcomeAssetVersionId }).lean()).toEqual(value.sourceRecord)
    expect(value.deps.generateResponse).not.toHaveBeenCalled()
  })
  it('completed operation replay and passive API readback validate persisted content rather than status alone', async () => {
    const value = await seed()
    await executeOutcomeSuccessorOperation(value.args)
    const readArgs = { ...value.args }
    expect((await getOutcomeSuccessorOperation(readArgs)).status).toBe('SUCCEEDED')
    await OutcomeDraftIteration.collection.updateOne({ _id: value.fixture.iteration._id },
      { $set: { 'customerContent.markdown': 'Changed after completion' } })
    await expect(executeOutcomeSuccessorOperation(value.args)).rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED' } })
    await expect(getOutcomeSuccessorOperation(readArgs)).rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED' } })
    expect(await AuditLog.countDocuments({ action: 'OUTCOME_SUCCESSOR_COMPLETED' })).toBe(1)
    expect(value.deps.generateResponse).not.toHaveBeenCalled()
  })
})
