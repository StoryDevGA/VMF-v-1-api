import { beforeAll, afterAll, beforeEach, describe, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server'
import {
  OutcomeAsset, OutcomeAssetVersion, OutcomeDraft, OutcomeDraftIteration, OutcomeSession,
  OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution, OutcomeRenderOutput, RuntimeInstance, RuntimeGraphRelationship, AuditLog,
} from '../models/index.js'
import { approveRuntimeOutcomeDraft, renderRuntimeOutcomeAsset, exportRuntimeOutcomeAsset } from '../services/outcomeStudioService.js'
import { prepareOutcomeStudioAssetRender } from '../services/outcomeStudioAssetRenderingService.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'

let replica
let replicaUri
const models = [OutcomeAsset, OutcomeAssetVersion, OutcomeDraft, OutcomeDraftIteration, OutcomeSession,
  OutcomeKnowledgeCompositionPlan, OutcomeQualityStageExecution, OutcomeRenderOutput, RuntimeInstance, RuntimeGraphRelationship, AuditLog]
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const uri = replica.getUri(`ss044_finalisation_${randomUUID().replaceAll('-', '')}`)
  replicaUri = uri
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  for (const model of models) { await model.createCollection(); await model.createIndexes() }
}, 120000)
beforeEach(async () => { jest.restoreAllMocks(); for (const model of models) await model.collection.deleteMany({}) })
afterAll(async () => { jest.restoreAllMocks(); await mongoose.disconnect(); await replica?.stop() })

const seed = async (options = {}) => {
  const value = makeGovernedFinalisationFixture(options)
  await new RuntimeInstance(value.runtime).save({ timestamps: false })
  await OutcomeKnowledgeCompositionPlan.collection.insertOne(value.plan)
  await OutcomeQualityStageExecution.create(value.stages.map(stage => ({ ...stage, createdBy: value.plan.createdBy })))
  await OutcomeSession.collection.insertOne(value.session)
  await OutcomeDraft.collection.insertOne(value.draft)
  await OutcomeDraftIteration.collection.insertOne(value.iteration)
  return value
}
const approve = (fixture, overrides = {}) => approveRuntimeOutcomeDraft({
  actorUserId: fixture.plan.createdBy, draftId: fixture.draft.draftId, runtimeInstanceId: fixture.runtime._id,
  sessionId: fixture.session.sessionId, scopes: {},
  deps: {
    // Only access-control/network dependencies are controlled. All source reads,
    // final writes, indexes, audits and transaction sessions use real Mongo.
    assertMutationPermission: () => RuntimeInstance.findById(fixture.runtime._id).lean(),
    loadRenderingPackReceipt: fixture.loadRenderingPackReceipt, ...overrides,
  },
})
const assertNoFinalRows = async (fixture) => {
  for (const model of [OutcomeAsset, OutcomeAssetVersion, OutcomeRenderOutput]) expect(await model.countDocuments({})).toBe(0)
  expect((await OutcomeDraft.findById(fixture.draft._id).lean()).status).toBe('ACTIVE')
  expect((await OutcomeDraftIteration.findById(fixture.iteration._id).lean()).status).toBe('CURRENT')
  expect(await AuditLog.countDocuments({})).toBe(0)
}

describe('isolated actual governed finalisation service', () => {
  test('prepares Markdown before atomic version, receipt, approval and audit commit; exact retry returns winner', async () => {
    const fixture = await seed()
    const prepareRender = jest.fn(async (args) => {
      await assertNoFinalRows(fixture)
      return prepareOutcomeStudioAssetRender(args)
    })
    const history = await OutcomeQualityStageExecution.find({}).lean()
    for (const entry of fixture.draft.lineageSummary.governedQualityChain.stages) {
      const stage = history.find((row) => row.stageExecutionId === entry.stageExecutionId)
      expect({ stageOrder: entry.stageOrder, status: entry.status, predecessorStageExecutionId: entry.predecessorStageExecutionId,
        predecessorAttemptFingerprint: entry.predecessorAttemptFingerprint, grrExecutionId: entry.grrExecutionId, grrRuntimeArtifactId: entry.grrRuntimeArtifactId })
        .toEqual({ stageOrder: stage.stageOrder, status: stage.status, predecessorStageExecutionId: stage.predecessorStageExecutionId,
          predecessorAttemptFingerprint: stage.predecessorAttemptFingerprint, grrExecutionId: stage.executionIdentity.grrExecutionId,
          grrRuntimeArtifactId: stage.executionIdentity.grrRuntimeArtifactId })
    }
    const result = await approve(fixture, { prepareRender })
    expect(result.idempotent).toBe(false)
    expect(await OutcomeAsset.countDocuments({})).toBe(1)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await OutcomeRenderOutput.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
    const version = await OutcomeAssetVersion.findOne().lean()
    const receipt = await OutcomeRenderOutput.findOne().lean()
    expect(receipt.outcomeAssetVersionId).toBe(version.outcomeAssetVersionId)
    expect(version.lineageSummary.governedQualityChain.planFingerprint).toBe(fixture.plan.planFingerprint)
    expect(receipt.runtimeRevisionId).toBe(String(fixture.runtime._id))
    expect(receipt.runtimeRevisionId).not.toBe(fixture.plan.lockSnapshotId)
    expect(receipt.stylePackReceipt.contentHash).toBe(fixture.plan.payload.resolution.selectedPacks.find((pack) => pack.knowledgeLayer === 'STYLE').contentHash)
    const retry = await approve(fixture, { prepareRender })
    expect(retry.idempotent).toBe(true)
    expect(retry.assetVersion.outcomeAssetVersionId).toBe(result.assetVersion.outcomeAssetVersionId)
    expect(retry.renderOutput.renderOutputId).toBe(result.renderOutput.renderOutputId)
    expect(prepareRender).toHaveBeenCalledTimes(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
  }, 30000)
  test('renderer failure precedes every final write', async () => {
    const fixture = await seed()
    await expect(approve(fixture, { prepareRender: async () => { throw new Error('Synthetic renderer failure') } }))
      .rejects.toMatchObject({ details: { reason: 'OUTCOME_STUDIO_RENDER_FAILED' } })
    await assertNoFinalRows(fixture)
  })
  test.each(['receipt', 'graph', 'draft audit', 'asset audit'])('actual transaction rolls back %s failure', async (failure) => {
    const fixture = await seed()
    let injected = false
    if (failure === 'receipt') jest.spyOn(OutcomeRenderOutput.prototype, 'save').mockImplementationOnce(async () => { injected = true; throw new Error('Synthetic receipt failure') })
    if (failure === 'graph') jest.spyOn(RuntimeGraphRelationship.prototype, 'save').mockImplementationOnce(async () => { injected = true; throw new Error('Synthetic graph failure') })
    if (failure.includes('audit')) {
      const original = AuditLog.createLog.bind(AuditLog)
      jest.spyOn(AuditLog, 'createLog').mockImplementation(async (...args) => {
        if (args[0].action === (failure === 'draft audit' ? 'OUTCOME_DRAFT_APPROVED' : 'ASSET_GENERATED')) { injected = true; throw new Error('Synthetic audit failure') }
        return original(...args)
      })
    }
    await expect(approve(fixture)).rejects.toThrow()
    expect(injected).toBe(true)
    await assertNoFinalRows(fixture)
    expect(await RuntimeGraphRelationship.countDocuments({})).toBe(0)
  }, 30000)
  test('two service approvals reconcile to one committed winner', async () => {
    const fixture = await seed()
    const results = await Promise.all([approve(fixture), approve(fixture)])
    expect(results[0].assetVersion.outcomeAssetVersionId).toBe(results[1].assetVersion.outcomeAssetVersionId)
    expect(results[0].renderOutput.renderOutputId).toBe(results[1].renderOutput.renderOutputId)
    expect(await OutcomeAsset.countDocuments({})).toBe(1)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await OutcomeRenderOutput.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
    expect(await OutcomeQualityStageExecution.countDocuments({})).toBe(6)
  }, 30000)
  test('transaction-time source drift rejects prepared bytes without final rows', async () => {
    const fixture = await seed()
    await expect(approve(fixture, { prepareRender: async (args) => {
      const prepared = await prepareOutcomeStudioAssetRender(args)
      await OutcomeDraftIteration.collection.updateOne({ _id: fixture.iteration._id }, { $set: { title: 'Changed current iteration' } })
      return prepared
    } })).rejects.toMatchObject({ details: { blockerReason: 'OUTCOME_GOVERNED_APPROVAL_SOURCE_CHANGED' } })
    await assertNoFinalRows(fixture)
  })
  test('partial approved winner fails closed rather than generating another version', async () => {
    const fixture = await seed()
    await approve(fixture)
    await OutcomeRenderOutput.collection.deleteMany({})
    await expect(approve(fixture)).rejects.toMatchObject({ details: { blockerReason: 'OUTCOME_GOVERNED_APPROVAL_WINNER_INCOMPLETE' } })
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
  })
  test('native governed render and export replay the frozen clean Markdown receipt', async () => {
    const fixture = await seed()
    const result = await approve(fixture)
    const args = { actorUserId: fixture.plan.createdBy, format: 'MARKDOWN', outcomeAssetId: result.asset.outcomeAssetId,
      runtimeInstanceId: fixture.runtime._id, scopes: {}, deps: {
        getRuntimeInstance: () => RuntimeInstance.findById(fixture.runtime._id).lean(), loadRenderingPackReceipt: fixture.loadRenderingPackReceipt,
      } }
    const render = await renderRuntimeOutcomeAsset(args)
    const exported = await exportRuntimeOutcomeAsset(args)
    expect(render.renderOutput.renderOutputId).toBe(result.renderOutput.renderOutputId)
    expect(exported.contentBase64).toBe(render.contentBase64)
    const markdown = Buffer.from(exported.contentBase64, 'base64').toString('utf8')
    expect(markdown).not.toContain('Governance boundary')
    expect(markdown).toContain(fixture.stages[4].outputSnapshot.sections[0].qualification)
    expect(await OutcomeRenderOutput.countDocuments({})).toBe(1)
    await expect(renderRuntimeOutcomeAsset({ ...args, format: 'HTML' })).rejects.toMatchObject({ status: 422 })
    await OutcomeQualityStageExecution.collection.deleteOne({ stageKey: 'ARL_MEANING_REVIEW' })
    await expect(renderRuntimeOutcomeAsset(args)).rejects.toThrow()
  })
  test('missing or corrupt persisted predecessor prevents final rows', async () => {
    const fixture = await seed()
    await OutcomeQualityStageExecution.collection.deleteOne({ stageKey: 'ARL_MEANING_REVIEW' })
    await expect(approve(fixture)).rejects.toThrow()
    await assertNoFinalRows(fixture)
  })
  test('selected output type mismatch is rejected before rendering', async () => {
    const fixture = await seed()
    await OutcomeDraft.collection.updateOne({ _id: fixture.draft._id }, { $set: { outputTypeCapabilityKey: 'commercial-strategy-and-decision-paper' } })
    const prepareRender = jest.fn()
    await expect(approve(fixture, { prepareRender })).rejects.toMatchObject({ details: { blockerReason: 'OUTCOME_RENDERED_CANDIDATE_CONTRACT_MISMATCH' } })
    expect(prepareRender).not.toHaveBeenCalled()
    await assertNoFinalRows(fixture)
  })
  test('fresh document instances survive an actual aborted transaction callback retry', async () => {
    const fixture = await seed()
    const transient = new mongoose.mongo.MongoServerError({ errmsg: 'Synthetic transient write conflict', code: 112 })
    transient.addErrorLabel('TransientTransactionError')
    const graphSave = jest.spyOn(RuntimeGraphRelationship.prototype, 'save').mockRejectedValueOnce(transient)
    await approve(fixture)
    expect(graphSave.mock.calls.length).toBeGreaterThan(1)
    expect(await OutcomeAsset.countDocuments({})).toBe(1)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await OutcomeRenderOutput.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
  }, 30000)
  test('lost commit acknowledgement returns the real committed winner', async () => {
    const fixture = await seed()
    const original = mongoose.startSession.bind(mongoose)
    jest.spyOn(mongoose, 'startSession').mockImplementationOnce(async () => {
      const session = await original()
      const transaction = session.withTransaction.bind(session)
      session.withTransaction = async (...args) => {
        await transaction(...args)
        throw new Error('Synthetic lost commit acknowledgement')
      }
      return session
    })
    const result = await approve(fixture)
    expect(result.idempotent).toBe(true)
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await OutcomeRenderOutput.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
  })
  test('altered frozen rendering pack receipt fails before final writes', async () => {
    const fixture = await seed()
    await expect(approve(fixture, { loadRenderingPackReceipt: async (args) => ({
      ...await fixture.loadRenderingPackReceipt(args), contentHash: 'sha256:unrelated',
    }) })).rejects.toMatchObject({ details: { blockerReason: 'RENDERING_PACK_RECEIPT_MISMATCH' } })
    await assertNoFinalRows(fixture)
  })
  test('draft content cannot bypass the exact accepted shaped output', async () => {
    const fixture = await seed()
    await OutcomeDraftIteration.collection.updateOne({ _id: fixture.iteration._id }, {
      $set: { 'customerContent.sections.0.body': 'An unreviewed new assertion.' },
    })
    await expect(approve(fixture)).rejects.toMatchObject({ details: { blockerReason: 'OUTCOME_GOVERNED_DRAFT_CONTENT_CHANGED' } })
    await assertNoFinalRows(fixture)
  })
  test('an approved retry does not accept changed iteration content', async () => {
    const fixture = await seed()
    await approve(fixture)
    await OutcomeDraftIteration.collection.updateOne({ _id: fixture.iteration._id }, { $set: { 'customerContent.markdown': 'Changed approved content' } })
    await expect(approve(fixture)).rejects.toMatchObject({ details: { blockerReason: 'OUTCOME_GOVERNED_APPROVAL_WINNER_INCOMPLETE' } })
    expect(await OutcomeAssetVersion.countDocuments({})).toBe(1)
    expect(await AuditLog.countDocuments({})).toBe(2)
  })
  test('a real derived RuntimeInstance binds its own ID and canonical revision number, separately from snapshots', async () => {
    const rootId = new mongoose.Types.ObjectId()
    const rootFixture = makeGovernedFinalisationFixture()
    await new RuntimeInstance({ ...rootFixture.runtime, _id: rootId, runtimeInstanceKey: 'synthetic-root-runtime' }).save({ timestamps: false })
    const fixture = await seed({ revisionNumber: 2, rootRuntimeId: rootId, parentRuntimeId: rootId })
    const actual = await RuntimeInstance.findById(fixture.runtime._id).lean()
    expect(String(actual.revision.rootRuntimeId)).toBe(String(rootId))
    expect(actual.framework_state.revision).toBeUndefined()
    const result = await approve(fixture)
    const version = await OutcomeAssetVersion.findOne().lean()
    const receipt = await OutcomeRenderOutput.findOne().lean()
    expect(receipt.runtimeRevisionId).toBe(String(actual._id))
    expect(receipt.renderReceipt.source.runtimeRevision).toEqual({ id: String(actual._id), number: 2 })
    expect(version.lineageSummary.runtimeRevisionId).toBe(String(actual._id))
    expect(version.lineageSummary.runtimeRevisionNumber).toBe(2)
    expect(result.renderOutput.runtimeRevisionId).toBeUndefined() // Scope metadata stays in its recorded receipt.
    expect(fixture.plan.lockSnapshotId).toBe('lock-qa')
    expect(receipt.runtimeRevisionId).not.toBe(fixture.plan.lockSnapshotId)
  })
  test.each([
    ['framework_state.revision.revisionId', 'unrelated-snapshot-or-revision'],
    ['framework_state.revision.revisionNumber', 9],
    ['currentRevisionId', 'unrelated-current-revision'],
    ['currentRevisionNumber', 9],
  ])('rejects contradictory legacy revision alias %s before final writes', async (field, value) => {
    const fixture = await seed()
    await RuntimeInstance.collection.updateOne({ _id: fixture.runtime._id }, { $set: { [field]: value } })
    await expect(approve(fixture)).rejects.toMatchObject({ details: { blockerReason: 'RUNTIME_REVISION_ALIAS_CONFLICT' } })
    await assertNoFinalRows(fixture)
  })
  test('canonical revision evidence is required and cannot be supplied by a legacy alias', async () => {
    const fixture = await seed()
    await RuntimeInstance.collection.updateOne({ _id: fixture.runtime._id }, {
      $unset: { 'revision.revisionNumber': '' },
      $set: { 'framework_state.revision': { revisionId: String(fixture.runtime._id), revisionNumber: 1 } },
    })
    await expect(approve(fixture)).rejects.toMatchObject({ details: { blockerReason: 'RUNTIME_REVISION_NOT_BOUND_TO_ASSET_VERSION' } })
    await assertNoFinalRows(fixture)
  })
  test('real standalone topology has no governed compensation fallback or final writes', async () => {
    await mongoose.disconnect()
    const standalone = await MongoMemoryServer.create()
    try {
      const uri = standalone.getUri(`ss044_standalone_${randomUUID().replaceAll('-', '')}`)
      if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback standalone required')
      await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
      for (const model of models) await model.createCollection()
      const fixture = await seed()
      await expect(approve(fixture)).rejects.toMatchObject({ status: 503, code: 'OUTCOME_QUALITY_STAGE_TRANSACTION_REQUIRED' })
      await assertNoFinalRows(fixture)
    } finally {
      await mongoose.disconnect()
      await standalone.stop()
      await mongoose.connect(replicaUri, { autoIndex: false, autoCreate: false })
    }
  }, 30000)
})
