import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

// Orchestration unit seams only. These do not prove native model validation,
// permissions, signatures, transactions, rollback or provider execution.
let current, owner
const bad = reason => { throw Object.assign(new Error(reason), { code: 'UNIT_GATE', details: { reason } }) }
const ref = stage => ({ stageKey: stage.stageKey, stageExecutionId: stage.stageExecutionId, status: stage.status,
  inputFingerprint: stage.inputFingerprint, outputFingerprint: stage.outputFingerprint || '', attemptFingerprint: stage.attemptFingerprint,
  materialHash: membershipHash(stage), grrExecutionId: stage.executionIdentity.grrExecutionId || '', grrRuntimeArtifactId: stage.executionIdentity.grrRuntimeArtifactId || '' })
const h = {
  authorize: jest.fn(async () => current.auth), readPlan: jest.fn(async () => current.plan), binding: () => current.binding,
  indexesReady: jest.fn(async () => {}), revisionIndexReady: jest.fn(async () => {}), scope: () => current.scope,
  query: value => Promise.resolve(value), signed: value => value.valid !== false,
  stageRef: ref, assertReturnedStage: stage => { if (stage.runtimeInstanceId !== current.runtimeId) bad('stage scope') },
  assertEventPair: (claim, result) => { if (!claim || !result || result.body.claim?.bodyHash !== claim.bodyHash) bad('event pair') },
  verifyRecordedStageAudit: jest.fn(async () => {}),
  readRecordedStage: async expected => {
    const stage = current.stages.find(row => row.stageExecutionId === expected.stageExecutionId)
    if (!stage || membershipHash(ref(stage)) !== membershipHash(expected)) bad('stage changed')
    return { raw: stage, stage }
  },
  eventRead: async phase => current.events.find(row => row.phase === phase) || null,
  transaction: async (_deps, fn) => fn({ unitOnly: true }),
  writeEvent: async body => {
    const row = { eventId: body.eventId, phase: body.phase, requestKey: body.requestKey, payloadHash: body.payloadHash, body, bodyHash: membershipHash(body) }
    current.events.push(row); return row
  },
  failureDetails: error => ({ failureCode: error.code || 'UNIT_UNKNOWN', message: error.message }),
  runClassification: claim => ({ ...claim.body.classification, runEventId: claim.eventId, runBodyHash: claim.bodyHash,
    requestId: claim.body.plan.requestId, planId: claim.body.plan.planId, planFingerprint: claim.body.plan.planFingerprint,
    ...claim.body.requestBinding }),
  model: (_deps, name) => ({
    find: filter => ({ limit: () => {
      if (name === 'OutcomeQualityStageExecution') return Promise.resolve(current.stages.filter(row => row.stageOrder >= 4
        && (!filter.stageExecutionId || filter.stageExecutionId.$in.includes(row.stageExecutionId))))
      const values = name === 'GovernedReasoningExecution' ? current.executions : current.artifacts
      if (filter.outputTypeKey) return Promise.resolve(values.filter(row => row.outputTypeKey === filter.outputTypeKey
        && (!filter.executionId || filter.executionId.$in.includes(row.executionId))
        && (!filter.runtimeArtifactId || filter.runtimeArtifactId.$in.includes(row.runtimeArtifactId))))
      const clsKey = name === 'GovernedReasoningExecution' ? 'executionEvidence' : 'lineageSummary'
      const id = filter[`${clsKey}.syntheticClassification.runEventId`]
      return Promise.resolve(values.filter(row => row[clsKey].syntheticClassification.runEventId === id))
    } }),
    findOne: filter => Promise.resolve(name === 'AuditLog' ? current.audits.find(row => row._id === filter._id)
      : (name === 'GovernedReasoningExecution' ? current.executions : current.artifacts).find(row => Object.entries(filter).every(([key, value]) => row[key] === value))),
  }),
}
beforeAll(async () => {
  jest.unstable_mockModule('../services/isolatedSyntheticOutcomeService.js', () => ({ isolatedSyntheticOutcomeInternals: h,
    readIsolatedSyntheticOutcome: async () => current.source }))
  for (const name of ['GovernedReasoningExecution', 'GovernedRuntimeArtifact']) jest.unstable_mockModule(`../models/${name}.js`, () => ({ default: class { async validate () {} } }))
  jest.unstable_mockModule('../services/outcomeRenderedExpressionRlExecutionService.js', () => ({
    executeOutcomeRenderedExpressionRl: jest.fn(), persistSavedOutcomeRenderedExpressionRlFailure: jest.fn(),
    assertSavedOutcomeRenderedExpressionRlFailure: input => { if (input.artifact.generatedOutput?.overallStatus !== 'FAIL') bad('saved FAIL required') },
  }))
  owner = await import('../services/isolatedSyntheticOutcomeCompletionService.js')
})
beforeEach(() => {
  jest.clearAllMocks()
  const runtimeId = '6ad715c91f39fea112115875', actorUserId = '6a6c763dcace7a21bd41efa9'
  const scope = { runtimeInstanceId: runtimeId, customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9' }
  const binding = { requestId: randomUUID(), draftId: 'outcome_draft_' + randomUUID(), draftIterationId: 'outcome_draft_iteration_' + randomUUID() }
  const plan = { _id: '6ad715c91f39fea112115876', requestId: binding.requestId, planId: 'outcome_kcp_' + randomUUID(), planFingerprint: 'a'.repeat(64) }
  const auth = { runtime: { _id: runtimeId, revision: { rootRuntimeId: '6ace5ee09bd4472c6be0cb07', parentRuntimeId: '6ad4b3cab439648c0f316453', revisionNumber: 3 } }, basis: { membershipHash: 'b'.repeat(64), lineage: { parentRuntimeInstanceId: '6ace5ee09bd4472c6be0cb08' } },
    classification: { ...scope, classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false } }
  const stages = ['FRAMEWORK_GUIDANCE', 'WORKING_DRAFT', 'ARL_MEANING_REVIEW'].map((stageKey, index) => ({ ...scope, ...binding,
    planId: plan.planId, planFingerprint: plan.planFingerprint, stageKey, stageOrder: index + 1, attemptNumber: 1, status: 'SUCCEEDED',
    stageExecutionId: 'outcome_quality_stage_' + randomUUID(), inputFingerprint: 'c'.repeat(64), outputFingerprint: 'd'.repeat(64),
    attemptFingerprint: 'e'.repeat(64), executionIdentity: {} }))
  const claim = { eventId: randomUUID(), phase: 'AUTHORISED_REVIEW_CLAIM', bodyHash: 'f'.repeat(64), body: {
    basis: auth.basis, classification: auth.classification, plan: { ...plan, recordId: plan._id }, requestBinding: binding } }
  delete claim.body.plan._id
  const result = { eventId: randomUUID(), phase: 'AUTHORISED_REVIEW_RESULT', bodyHash: '1'.repeat(64), body: { ...claim.body,
    claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status: 'ARL_PASSED', stageRefs: stages.map(ref), grrRefs: [] } }
  const completionSource = { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    workingDraftStageExecutionId: stages[1].stageExecutionId, workingDraftMaterialHash: ref(stages[1]).materialHash,
    arlStageExecutionId: stages[2].stageExecutionId, arlMaterialHash: ref(stages[2]).materialHash }
  current = { auth, scope, runtimeId, actorUserId, binding, plan, stages, events: [claim, result], executions: [], artifacts: [], audits: [], calls: [],
    source: { classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, normalOutputAvailable: false,
      run: { status: 'ARL_PASSED', claimEventId: claim.eventId, resultEventId: result.eventId, stageRefs: stages.map(ref), grrRefs: [] }, stages: [...stages], grr: [] } }
  const stageOwner = (stageKey, stageOrder) => jest.fn(async input => {
    current.calls.push(stageKey)
    const prior = current.stages.at(-1)
    const stage = { ...scope, ...binding, planId: plan.planId, planFingerprint: plan.planFingerprint, stageKey, stageOrder, attemptNumber: 1,
      status: stageOrder === 6 && current.failRl ? 'FAILED' : 'SUCCEEDED', stageExecutionId: 'outcome_quality_stage_' + randomUUID(),
      inputFingerprint: '2'.repeat(64), outputFingerprint: '3'.repeat(64), attemptFingerprint: '4'.repeat(64),
      predecessorStageExecutionId: prior.stageExecutionId, predecessorAttemptFingerprint: prior.attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: prior.stageExecutionId, attemptFingerprint: prior.attemptFingerprint, outputFingerprint: prior.outputFingerprint } },
      executionIdentity: {}, ...(stageOrder === 6 && current.failRl ? { failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } } : {}) }
    if (stageOrder === 6) {
      await input.deps.createGovernedReasoningExecution({ deps: {} })
      stage.executionIdentity = { grrExecutionId: current.executions[0].executionId, grrRuntimeArtifactId: current.artifacts[0].runtimeArtifactId }
    }
    current.stages.push(stage); return { stage }
  })
  current.args = { actorUserId, runtimeInstanceId: runtimeId, scopes: {}, payload: { requestKey: randomUUID(), requestId: plan.requestId,
    planId: plan.planId, expectedPlanFingerprint: plan.planFingerprint, completionSource },
    providerRuntimeDeps: { executionMode: 'LIVE_TEST', providerDescriptor: { serverOwned: true }, renderedExpressionRlProviderAdapterFactory: jest.fn(() => async () => {}) },
    deps: { createNarrativePlan: stageOwner('OUTCOME_NARRATIVE_PLAN', 4), createShapedCandidate: stageOwner('OUTPUT_SHAPING', 5),
      executeRenderedExpressionRl: stageOwner('RENDERED_EXPRESSION_RL', 6),
      createGovernedReasoningExecution: jest.fn(async input => {
        const cls = await input.deps.authorizeRuntime({ _id: runtimeId })
        const executionId = 'grr_exec_' + randomUUID(), runtimeArtifactId = 'grr_art_' + randomUUID(), auditId = randomUUID()
        const execution = { ...scope, _id: randomUUID(), executionId, outputTypeKey: 'RENDERED_EXPRESSION_RL', artifactIds: [runtimeArtifactId],
          executionEvidence: { syntheticClassification: cls }, auditLogIds: [auditId], status: 'COMPLETED', providerMode: 'LIVE_TEST',
          provider: { liveProvider: true, providerMode: 'LIVE_TEST' }, requestedBy: actorUserId }
        current.executions.push(execution)
        current.artifacts.push({ ...scope, executionId, runtimeArtifactId, outputTypeKey: execution.outputTypeKey,
          artifactType: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', lineageSummary: { syntheticClassification: cls }, status: 'GENERATED', generatedBy: actorUserId })
        current.audits.push({ _id: auditId, action: 'GOVERNED_REASONING_EXECUTED', resourceType: 'GovernedReasoningExecution', resourceId: execution._id,
          actorUserId, scope, diff: { executionId, artifactIds: [runtimeArtifactId], runtimeInstanceId: runtimeId, providerMode: 'LIVE_TEST', outputTypeKey: execution.outputTypeKey } })
      }) } }
})
describe('isolated downstream orchestration (unit seams only)', () => {
  test('runs only Narrative, Shaping and one RL, preserving source and stopping at actual synthetic delivery guard', async () => {
    const sourceHash = membershipHash(current.source)
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.calls).toEqual(['OUTCOME_NARRATIVE_PLAN', 'OUTPUT_SHAPING', 'RENDERED_EXPRESSION_RL'])
    expect(response.run).toMatchObject({ status: 'BLOCKED', failure: { failureCode: 'SYNTHETIC_TEST_DELIVERY_HELD' } })
    expect(response.stages).toHaveLength(6); expect(membershipHash(current.source)).toBe(sourceHash)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.executions[0].executionEvidence.syntheticClassification).toMatchObject({ authoritative: false,
      classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', runEventId: response.run.claimEventId })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
  })
  test('retains actual RL FAIL and never claims synthetic quality completion', async () => {
    current.failRl = true
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'FAILED', failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } })
    expect(response.stages.at(-1).status).toBe('FAILED')
  })
  test('stops on Narrative uncertainty without Shaping or provider dispatch and remains passive', async () => {
    current.args.deps.createNarrativePlan.mockRejectedValue(Object.assign(new Error('unknown owner'), { code: 'UNIT_OWNER_UNCONFIRMED' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run.status).toBe('UNKNOWN')
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createNarrativePlan).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    expect(current.args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  })
  test.each(['stage', 'provider', 'audit'])('rejects changed saved %s evidence on readback', async kind => {
    await owner.completeIsolatedSyntheticOutcome(current.args)
    if (kind === 'stage') current.stages.at(-1).outputFingerprint = 'f'.repeat(64)
    if (kind === 'provider') current.artifacts[0].changed = true
    if (kind === 'audit') current.audits[0].valid = false
    await expect(owner.readLatestIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
  })
  test('rejects changed retry payload and source mismatch before execution', async () => {
    current.args.payload.completionSource.arlMaterialHash = 'f'.repeat(64)
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_SOURCE_CHANGED' } })
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
  })
})

const referenceRecoveryFixture = () => {
  const source = current.args.payload.completionSource
  const base = { ...current.events[0].body, version: 'isolated-synthetic-outcome-run.v21', completionSource: source }
  const claim = { eventId: randomUUID(), phase: 'COMPLETION_CLAIM', bodyHash: '7'.repeat(64), body: { ...base, status: 'CLAIMED', stageRefs: [], grrRefs: [] } }
  const result = { eventId: randomUUID(), phase: 'COMPLETION_RESULT', bodyHash: '8'.repeat(64), body: { ...base,
    claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status: 'UNKNOWN', stageRefs: [], grrRefs: [],
    failure: { failureCode: 'OUTCOME_QUALITY_STAGE_BINDING_INVALID', details: { field: 'output.sections[0].truthReferences' } } } }
  current.events.push(claim, result)
  current.args.payload.referenceRecovery = { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
    resultEventId: result.eventId, resultBodyHash: result.bodyHash }
  return { claim, result }
}
describe('bounded reference recovery orchestration unit seams', () => {
  test('uses a new signed slot, preserves stopped receipt, and keeps original ARL source', async () => {
    const prior = referenceRecoveryFixture(), before = membershipHash(prior)
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run.status).toBe('BLOCKED')
    expect(response.run.completionVersion).toBe('isolated-synthetic-outcome-run.v22')
    expect(response.sourceRun.status).toBe('ARL_PASSED')
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(current.events.at(-1).phase).toBe('COMPLETION_REFERENCE_RESULT')
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createNarrativePlan).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
  })
  test.each(['hash', 'status', 'field', 'stage', 'provider', 'plan', 'basis', 'source'])('rejects changed parent %s before a claim', async kind => {
    const prior = referenceRecoveryFixture()
    if (kind === 'hash') current.args.payload.referenceRecovery.resultBodyHash = '9'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'FAILED'
    if (kind === 'field') prior.result.body.failure.details.field = 'other'
    if (kind === 'stage') prior.result.body.stageRefs.push({ stageKey: 'OUTCOME_NARRATIVE_PLAN' })
    if (kind === 'provider') prior.result.body.grrRefs.push({ executionId: 'other' })
    if (kind === 'plan') prior.claim.body.plan = { ...prior.claim.body.plan, planId: 'other' }
    if (kind === 'basis') prior.claim.body.basis = { ...prior.claim.body.basis, membershipHash: 'other' }
    if (kind === 'source') prior.result.body.completionSource = { ...prior.result.body.completionSource, arlStageExecutionId: 'other' }
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_REFERENCE_SOURCE_CHANGED' } })
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.events).toHaveLength(4)
  })
  test.each(['stage', 'provider'])('rejects actual orphan downstream %s before claiming a recovery', async kind => {
    referenceRecoveryFixture()
    if (kind === 'stage') current.stages.push({ stageKey: 'OUTCOME_NARRATIVE_PLAN', stageOrder: 4 })
    else current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionEvidence: { syntheticClassification: { runEventId: 'orphan' } } })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toMatchObject({ details: {
      reason: kind === 'stage' ? 'COMPLETION_EXISTING_STAGES' : 'COMPLETION_EXISTING_PROVIDER' } })
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.events).toHaveLength(4)
  })

})

const titleRecoveryFixture = async () => {
  current.stages[1].outputSnapshot = { title: 'Working Draft' }
  const sourceRefs = current.stages.slice(0, 3).map(ref)
  current.events[1].body.stageRefs = sourceRefs
  current.source.run.stageRefs = sourceRefs
  current.args.payload.completionSource.workingDraftMaterialHash = sourceRefs[1].materialHash
  referenceRecoveryFixture()
  const narrative = (await current.args.deps.createNarrativePlan({})).stage
  current.args.deps.createNarrativePlan.mockClear(); current.calls.length = 0
  const base = { ...current.events[2].body, version: 'isolated-synthetic-outcome-run.v22',
    referenceRecovery: current.args.payload.referenceRecovery }
  const claim = { eventId: randomUUID(), phase: 'COMPLETION_REFERENCE_CLAIM', bodyHash: '9'.repeat(64),
    body: { ...base, status: 'CLAIMED', stageRefs: [], grrRefs: [] } }
  const result = { eventId: randomUUID(), phase: 'COMPLETION_REFERENCE_RESULT', bodyHash: 'a'.repeat(64),
    body: { ...base, claim: { eventId: claim.eventId, bodyHash: claim.bodyHash }, status: 'UNKNOWN',
      stageRefs: [ref(narrative)], grrRefs: [], failure: { failureCode: 'OUTCOME_POST_ARL_QUALITY_CHAIN_INVALID',
        message: 'The exact Outcome Narrative Plan is unavailable for shaping.' } } }
  current.events.push(claim, result)
  current.args.payload.titleRecovery = { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash,
    resultEventId: result.eventId, resultBodyHash: result.bodyHash, narrativeStageExecutionId: narrative.stageExecutionId,
    narrativeMaterialHash: ref(narrative).materialHash, titleHash: membershipHash('Working Draft') }
  return { claim, result, narrative }
}

describe('bounded saved-title recovery orchestration unit seams', () => {
  test('reuses the exact Narrative, forwards only the saved title, and keeps repeated calls passive', async () => {
    const prior = await titleRecoveryFixture(), before = membershipHash(prior)
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run.completionVersion).toBe('isolated-synthetic-outcome-run.v23')
    expect(response.run.status).toBe('BLOCKED')
    expect(current.calls).toEqual(['OUTPUT_SHAPING', 'RENDERED_EXPRESSION_RL'])
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate.mock.calls[0][0].title).toBe('Working Draft')
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(response.stageRefs).toBeUndefined()
    expect(response.run.stageRefs[3].stageExecutionId).toBe(prior.narrative.stageExecutionId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidate).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args,
      payload: { ...current.args.payload, requestKey: randomUUID() } })).rejects.toMatchObject({
      details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['parent-hash', 'status', 'message', 'basis', 'plan', 'source', 'reference', 'narrative-id', 'narrative-hash', 'title-hash', 'title-empty'])('rejects changed %s before claiming or generating', async kind => {
    const prior = await titleRecoveryFixture()
    if (kind === 'parent-hash') current.args.payload.titleRecovery.resultBodyHash = 'b'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'FAILED'
    if (kind === 'message') prior.result.body.failure.message = 'other'
    if (kind === 'basis') prior.claim.body.basis = { changed: true }
    if (kind === 'plan') prior.claim.body.plan = { changed: true }
    if (kind === 'source') prior.result.body.completionSource = { changed: true }
    if (kind === 'reference') prior.result.body.referenceRecovery = { changed: true }
    if (kind === 'narrative-id') current.args.payload.titleRecovery.narrativeStageExecutionId = 'outcome_quality_stage_' + randomUUID()
    if (kind === 'narrative-hash') current.args.payload.titleRecovery.narrativeMaterialHash = 'b'.repeat(64)
    if (kind === 'title-hash') current.args.payload.titleRecovery.titleHash = 'b'.repeat(64)
    if (kind === 'title-empty') {
      current.stages[1].outputSnapshot.title = ''
      const sourceRefs = current.stages.slice(0, 3).map(ref)
      current.events[1].body.stageRefs = sourceRefs; current.source.run.stageRefs = sourceRefs
      current.args.payload.completionSource.workingDraftMaterialHash = sourceRefs[1].materialHash
      current.args.payload.titleRecovery.titleHash = membershipHash('')
    }
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(6)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('stops on Shaping uncertainty without regenerating Narrative or dispatching RL', async () => {
    const prior = await titleRecoveryFixture()
    current.args.deps.createShapedCandidate.mockRejectedValue(Object.assign(new Error('Shaping gate'), { code: 'UNIT_SHAPING_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'UNIT_SHAPING_GATE' } })
    expect(response.run.stageRefs.at(-1).stageExecutionId).toBe(prior.narrative.stageExecutionId)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidate).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})

const rlPersistenceFixture = async () => {
  await titleRecoveryFixture()
  current.args.deps.executeRenderedExpressionRl.mockImplementationOnce(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    current.artifacts[0].generatedOutput = { overallStatus: 'FAIL' }
    throw Object.assign(new Error('Clarification is required before draft generation.'), { code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED' })
  })
  await owner.completeIsolatedSyntheticOutcome(current.args)
  const claim = current.events.find(x => x.phase === 'COMPLETION_TITLE_CLAIM')
  const result = current.events.find(x => x.phase === 'COMPLETION_TITLE_RESULT')
  const shaping = current.stages.at(-1), pair = result.body.grrRefs[0]
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), rlPersistenceRecovery: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    shapingStageExecutionId: shaping.stageExecutionId, shapingMaterialHash: ref(shaping).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash } }
  current.args.deps.persistSavedRlFailure = jest.fn(async input => {
    const stage = { ...shaping, stageKey: 'RENDERED_EXPRESSION_RL', stageOrder: 6, status: 'FAILED',
      stageExecutionId: 'outcome_quality_stage_' + randomUUID(), predecessorStageExecutionId: shaping.stageExecutionId,
      predecessorAttemptFingerprint: shaping.attemptFingerprint, inputSnapshot: { sourceStage: {
        stageExecutionId: shaping.stageExecutionId, attemptFingerprint: shaping.attemptFingerprint, outputFingerprint: shaping.outputFingerprint } },
      executionIdentity: { grrExecutionId: input.execution.executionId, grrRuntimeArtifactId: input.artifact.runtimeArtifactId },
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } }
    current.stages.push(stage); return { execution: stage }
  })
  jest.clearAllMocks(); current.calls.length = 0
  return { claim, result }
}
describe('saved RL failure persistence recovery, orchestration seams only', () => {
  test('appends FAILED from unchanged provider and keeps retries passive with no adapter or owners', async () => {
    const prior = await rlPersistenceFixture(), before = membershipHash(prior)
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'FAILED', completionVersion: 'isolated-synthetic-outcome-run.v24',
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } })
    expect(response.run.grrRefs.at(-1).stageLinkage).toBe('LINKED')
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.persistSavedRlFailure).toHaveBeenCalledTimes(1)
    for (const fn of [current.args.deps.createNarrativePlan, current.args.deps.createShapedCandidate,
      current.args.deps.executeRenderedExpressionRl, current.args.deps.createGovernedReasoningExecution,
      current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory]) expect(fn).not.toHaveBeenCalled()
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim hash', 'result hash', 'status', 'failure', 'shaping hash', 'provider hash', 'artifact hash', 'source', 'title', 'audit', 'PASS'])('rejects changed %s before persistence', async kind => {
    const prior = await rlPersistenceFixture(), link = current.args.payload.rlPersistenceRecovery
    if (kind === 'claim hash') link.claimBodyHash = 'f'.repeat(64)
    if (kind === 'result hash') link.resultBodyHash = 'f'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'FAILED'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'other'
    if (kind === 'shaping hash') link.shapingMaterialHash = 'f'.repeat(64)
    if (kind === 'provider hash') link.executionHash = 'f'.repeat(64)
    if (kind === 'artifact hash') link.artifactHash = 'f'.repeat(64)
    if (kind === 'source') prior.claim.body.completionSource = { changed: true }
    if (kind === 'title') prior.result.body.titleRecovery = { changed: true }
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'PASS') current.artifacts[0].generatedOutput.overallStatus = 'PASS'
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(8)
    expect(current.args.deps.persistSavedRlFailure).not.toHaveBeenCalled()
  })
  test('uncertain persistence remains passive and preserves provider/history', async () => {
    await rlPersistenceFixture()
    current.args.deps.persistSavedRlFailure.mockRejectedValueOnce(Object.assign(new Error('stage rollback'), { code: 'QA_STAGE_GATE' }))
    const result = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(result.run.status).toBe('UNKNOWN')
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.persistSavedRlFailure).toHaveBeenCalledTimes(1)
    expect(current.executions).toHaveLength(1); expect(current.stages).toHaveLength(5)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
  })
})

const expressionRepairFixture = async () => {
  await rlPersistenceFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const claim = current.events.find(row => row.phase === 'COMPLETION_RL_PERSISTENCE_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_RL_PERSISTENCE_RESULT')
  const original = current.stages.slice(3)
  const pair = result.body.grrRefs[0]
  const link = { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-readable-expression.v2' }
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionRepair: link }
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 2,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: '9'.repeat(64), outputSnapshot: { revisionScope: 'EXPRESSION_ONLY', expressionProfileVersion: input.expressionProfileVersion,
        revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
        remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint } }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const source = current.stages.at(-1), stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 2,
      status: current.expressionPass ? 'SUCCEEDED' : 'FAILED', failure: current.expressionPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original }
}
describe('versioned expression repair without regenerating meaning, orchestration unit seams', () => {
  test.each([false, true])('reuses exact history and performs one expression revision/review (PASS=%s)', async pass => {
    const prior = await expressionRepairFixture(), before = membershipHash(prior); current.expressionPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v25', status: pass ? 'BLOCKED' : 'FAILED',
      failure: { failureCode: pass ? 'SYNTHETIC_TEST_DELIVERY_HELD' : 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } })
    expect(response.run.stageRefs).toHaveLength(6)
    expect(response.run.stageRefs[3].stageExecutionId).toBe(prior.original[0].stageExecutionId)
    expect(response.run.stageRefs[4].stageExecutionId).not.toBe(prior.original[1].stageExecutionId)
    expect(response.priorRuns.at(-1).stageRefs).toEqual(prior.result.body.stageRefs)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_REPAIR_CLAIM')).toHaveLength(1)
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'audit', 'population'])('rejects altered %s before claim or generation', async kind => {
    const prior = await expressionRepairFixture(), link = current.args.payload.expressionRepair
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'unknown'
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'population') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(10)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('uncertain Shaping remains passive and never dispatches a provider', async () => {
    await expressionRepairFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('revision gate'), { code: 'QA_EXPRESSION_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_EXPRESSION_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
  })
  test('persists transport-failed RL as UNKNOWN and never mistakes it for a genuine semantic FAIL or retries', async () => {
    const prior = await expressionRepairFixture()
    current.args.deps.executeRenderedExpressionRl.mockImplementation(async () => {
      const shaping = current.stages.at(-1), old = prior.original[2]
      const stage = { ...old, stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 2,
        failure: { failureCode: 'RENDERED_EXPRESSION_RL_PROVIDER_TIMEOUT', retryable: true }, executionIdentity: {},
        predecessorStageExecutionId: old.stageExecutionId, predecessorAttemptFingerprint: old.attemptFingerprint,
        inputSnapshot: { sourceStage: { stageExecutionId: shaping.stageExecutionId, attemptFingerprint: shaping.attemptFingerprint, outputFingerprint: shaping.outputFingerprint } } }
      current.stages.push(stage); return { stage }
    })
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'RENDERED_EXPRESSION_RL_PROVIDER_TIMEOUT' } })
    expect(response.run.grrRefs).toHaveLength(0)
    expect(response.stages.at(-1).status).toBe('FAILED')
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
  })

})

const expressionFollowupFixture = async () => {
  await expressionRepairFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_REPAIR_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_REPAIR_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0], preview = { title: 'Unchanged title', expressionProfileVersion: 'outcome-readable-expression.v3' }
  const reviewed = membershipHash(preview)
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionFollowup: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-readable-expression.v3', reviewedOutputFingerprint: reviewed } }
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(() => preview)
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 3,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: { revisionScope: 'EXPRESSION_ONLY', expressionProfileVersion: input.expressionProfileVersion,
        revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
        remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint } }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const source = current.stages.at(-1), stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 3,
      status: current.followupPass ? 'SUCCEEDED' : 'FAILED', failure: current.followupPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview }
}
describe('fixed presentation v3 follow-up, orchestration unit seams', () => {
  test.each([false, true])('preserves v25, uses exact reviewed Shaping3 and performs at most one RL3 (PASS=%s)', async pass => {
    const prior = await expressionFollowupFixture(), before = membershipHash(prior); current.followupPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v26', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 3, outputFingerprint: current.args.payload.expressionFollowup.reviewedOutputFingerprint })
    expect(response.stages.at(-1).attemptNumber).toBe(3)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionFollowupFixture(), link = current.args.payload.expressionFollowup
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'unknown'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(12)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('stops before provider when committed output differs from the reviewed fingerprint and remains passive', async () => {
    await expressionFollowupFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input); result.stage.outputFingerprint = '0'.repeat(64); return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM')).toHaveLength(1)
  })
  test('uncertain Shaping3 claim is passive and never reruns provider', async () => {
    await expressionFollowupFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('presentation gate'), { code: 'QA_PRESENTATION_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_PRESENTATION_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})

const expressionFaithfulFixture = async () => {
  await expressionFollowupFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const historicalPayload = { ...current.args.payload }
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0], preview = { title: 'Unchanged title', expressionProfileVersion: 'outcome-readable-expression.v4' }
  const reviewed = membershipHash(preview), priorBuilder = current.args.deps.buildShapedCandidateRevisionOutput.getMockImplementation()
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionFaithful: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-readable-expression.v4', reviewedOutputFingerprint: reviewed } }
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(input => input.expressionProfileVersion === 'outcome-readable-expression.v4' ? preview : priorBuilder(input))
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 4,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: { revisionScope: 'EXPRESSION_ONLY', expressionProfileVersion: input.expressionProfileVersion,
        revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
        remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint } }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const source = current.stages.at(-1), stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 4,
      status: current.faithfulPass ? 'SUCCEEDED' : 'FAILED', failure: current.faithfulPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview, historicalPayload }
}
describe('fixed faithful v4 continuation, orchestration unit seams', () => {
  test.each([false, true])('preserves v26 and exact reviewed Shaping4, runs at most one RL4 (PASS=%s)', async pass => {
    const prior = await expressionFaithfulFixture(), before = membershipHash(prior); current.faithfulPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v27', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 4, outputFingerprint: current.args.payload.expressionFaithful.reviewedOutputFingerprint })
    expect(response.stages.at(-1).attemptNumber).toBe(4)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    const historical = await owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: prior.historicalPayload })
    expect(historical.run.claimEventId).toBe(response.run.claimEventId)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionFaithfulFixture(), link = current.args.payload.expressionFaithful
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'unknown'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(14)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('stops before provider for committed output differing from reviewed v4 and remains passive', async () => {
    await expressionFaithfulFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input); result.stage.outputFingerprint = '0'.repeat(64); return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM')).toHaveLength(1)
  })
  test('uncertain Shaping4 claim is passive with no provider or regeneration', async () => {
    await expressionFaithfulFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('faithful gate'), { code: 'QA_FAITHFUL_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_FAITHFUL_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})

const expressionContractFixture = async () => {
  await expressionFaithfulFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const historicalPayload = { ...current.args.payload }
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0], preview = { title: 'Unchanged title', expressionProfileVersion: 'outcome-commercial-expression.v1',
    candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', outputContract: { outputTypeKey: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER' },
    revisionScope: 'EXPRESSION_ONLY', revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
    remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint }
  const reviewed = membershipHash(preview), priorBuilder = current.args.deps.buildShapedCandidateRevisionOutput.getMockImplementation()
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionContract: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-commercial-expression.v1', reviewedOutputFingerprint: reviewed } }
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(input => input.expressionProfileVersion === 'outcome-commercial-expression.v1' ? preview : priorBuilder(input))
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    expect(input.expressionProfileVersion).toBe('outcome-commercial-expression.v1')
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 5,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: preview }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const source = current.stages.at(-1), stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 5,
      status: current.contractPass ? 'SUCCEEDED' : 'FAILED', failure: current.contractPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview, historicalPayload }
}
describe('fixed selected-contract continuation, orchestration unit seams', () => {
  test.each([false, true])('preserves v27 and selected Commercial Shaping5, at most one RL5 (PASS=%s)', async pass => {
    const prior = await expressionContractFixture(), before = membershipHash(prior); current.contractPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v28', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 5, outputFingerprint: current.args.payload.expressionContract.reviewedOutputFingerprint,
      outputSnapshot: { candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER' } })
    expect(response.stages.at(-1).attemptNumber).toBe(5)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    const historical = await owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: prior.historicalPayload })
    expect(historical.run.claimEventId).toBe(response.run.claimEventId)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionContractFixture(), link = current.args.payload.expressionContract
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'outcome-readable-expression.v4'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(16)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('stops before provider if committed Commercial output differs from reviewed hash, remains passive', async () => {
    await expressionContractFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input); result.stage.outputFingerprint = '0'.repeat(64); return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_CLAIM')).toHaveLength(1)
  })
  test('uncertain Shaping5 claim stays passive without provider or meaning regeneration', async () => {
    await expressionContractFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('contract gate'), { code: 'QA_CONTRACT_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_CONTRACT_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})

const expressionReadableFixture = async () => {
  await expressionContractFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const historicalPayload = { ...current.args.payload }
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0], preview = { title: 'Unchanged title', expressionProfileVersion: 'outcome-commercial-expression.v2',
    candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', outputContract: { outputTypeKey: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER' },
    revisionScope: 'EXPRESSION_ONLY', revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
    remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint }
  const reviewed = membershipHash(preview), priorBuilder = current.args.deps.buildShapedCandidateRevisionOutput.getMockImplementation()
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionReadable: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-commercial-expression.v2', reviewedOutputFingerprint: reviewed } }
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(input => input.expressionProfileVersion === 'outcome-commercial-expression.v2' ? preview : priorBuilder(input))
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    expect(input.expressionProfileVersion).toBe('outcome-commercial-expression.v2')
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 6,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: preview }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const source = current.stages.at(-1), stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 6,
      status: current.readablePass ? 'SUCCEEDED' : 'FAILED', failure: current.readablePass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview, historicalPayload }
}
describe('fixed readable-Commercial continuation, orchestration unit seams', () => {
  test.each([false, true])('preserves v28 and selected Commercial Shaping6, at most one RL6 (PASS=%s)', async pass => {
    const prior = await expressionReadableFixture(), before = membershipHash(prior); current.readablePass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v29', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 6, outputFingerprint: current.args.payload.expressionReadable.reviewedOutputFingerprint,
      outputSnapshot: { candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER' } })
    expect(response.stages.at(-1).attemptNumber).toBe(6)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    const historical = await owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: prior.historicalPayload })
    expect(historical.run.claimEventId).toBe(response.run.claimEventId)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled()
    expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionReadableFixture(), link = current.args.payload.expressionReadable
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'outcome-readable-expression.v4'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(18)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled()
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test('stops before provider if committed Commercial output differs from reviewed hash, remains passive', async () => {
    await expressionReadableFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input); result.stage.outputFingerprint = '0'.repeat(64); return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_CLAIM')).toHaveLength(1)
  })
  test('uncertain Shaping6 claim stays passive without provider or meaning regeneration', async () => {
    await expressionReadableFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('contract gate'), { code: 'QA_CONTRACT_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_CONTRACT_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})
const expressionOverlayFixture = async () => {
  await expressionReadableFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const historicalPayload = { ...current.args.payload }
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0]
  const { createHash } = await import('node:crypto')
  const { buildCommercialOutputContract } = await import('../utils/outcomeCommercialExpressionProfile.js')
  const { buildCommercialStyleValidationReceipt } = await import('../services/commercialOutputReviewContract.js')
  const content = '# Controlled unit style\nUse a readable, faithful presentation.\n'
  const descriptors = [
    ['OUTPUT_TYPE_DEFINITION', 'commercial-strategy-and-decision-paper', 'OT-023'],
    ['OUTPUT_SCHEMA', 'commercial-strategy-and-decision-paper-schema', 'OSC-025'],
    ['STYLE', 'strategic-advisory-style', 'STY-001'],
    ['VISUAL_SYSTEM', 'executive-consulting-visual-style', 'VIS-006'],
  ].map(([packType, packKey, knowledgeAssetId]) => ({ packType, packKey, knowledgeAssetId,
    packId: 'kp-' + packKey, versionId: 'kpv-' + packKey + '-1', semanticVersion: '1.0.0', lifecycleStatus: 'ACTIVE',
    contentHash: 'sha256:' + (packType === 'STYLE' ? createHash('sha256').update(content).digest('hex') : 'a'.repeat(64)) }))
  current.plan.requestedOutputTypeKey = 'commercial-strategy-and-decision-paper'
  current.plan.payload = { consumerIntent: { requestedOutputTypeKey: current.plan.requestedOutputTypeKey,
    compositionResolution: { request: { requestedStyleKey: 'strategic-advisory-style', visualSystemKey: 'executive-consulting-visual-style' } } },
  resolution: { selectedPacks: descriptors } }
  const style = descriptors.find(pack => pack.packType === 'STYLE')
  const styleSource = { ...style, available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN', content }
  const contract = buildCommercialOutputContract({ plan: current.plan })
  const preview = { title: 'Unchanged title', expressionProfileVersion: 'outcome-commercial-expression.v3',
    candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', outputContract: contract,
    sections: contract.sections.map((sectionKey, index) => ({ sectionKey, order: index + 1, heading: sectionKey,
      body: 'Exact unit expression content.', qualification: '', diagram: { present: false, description: '', accessibleText: '' }, truthReferences: ['evidence-register'] })),
    revisionScope: 'EXPRESSION_ONLY', revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
    remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint }
  preview.styleValidationReceipt = buildCommercialStyleValidationReceipt({ contract, styleSource,
    outputAssetId: 'OT-023', title: preview.title, sections: preview.sections })
  const reviewed = membershipHash(preview), priorBuilder = current.args.deps.buildShapedCandidateRevisionOutput.getMockImplementation()
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionOverlay: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-commercial-expression.v3', reviewedOutputFingerprint: reviewed } }
  current.args.deps.loadPackContent = jest.fn(async request => {
    expect(request.packId).toBe(style.packId); expect(request.versionId).toBe(style.versionId)
    expect(Object.hasOwn(request, 'session')).toBe(true)
    return styleSource
  })
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(input => {
    if (input.expressionProfileVersion !== 'outcome-commercial-expression.v3') return priorBuilder(input)
    expect(input.styleSource).toBe(styleSource)
    return preview
  })
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    expect(input.expressionProfileVersion).toBe('outcome-commercial-expression.v3')
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 7,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: JSON.parse(JSON.stringify(preview)) }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    const saved = current.stages.at(-1)
    expect(saved.stageKey).toBe('OUTPUT_SHAPING'); expect(saved.attemptNumber).toBe(7)
    expect(saved.outputFingerprint).toBe(reviewed)
    expect(saved.outputSnapshot).toEqual(preview)
    expect(h.readRecordedStage).toBeDefined()
    expect(h.verifyRecordedStageAudit.mock.calls.some(([raw]) => raw === saved)).toBe(true)
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 7,
      status: current.overlayPass ? 'SUCCEEDED' : 'FAILED', failure: current.overlayPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: saved.stageExecutionId, attemptFingerprint: saved.attemptFingerprint, outputFingerprint: saved.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview, historicalPayload, styleSource, style }
}

describe('fixed native-style Commercial continuation, orchestration unit seams', () => {
  test.each([false, true])('preserves v29 and exact receipt-backed Shaping7 before one RL7 (PASS=%s)', async pass => {
    const prior = await expressionOverlayFixture(), before = membershipHash(prior); current.overlayPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v30', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 7, outputFingerprint: current.args.payload.expressionOverlay.reviewedOutputFingerprint,
      outputSnapshot: { styleValidationReceipt: prior.preview.styleValidationReceipt } })
    expect(response.stages.at(-1).attemptNumber).toBe(7)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    const historical = await owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: prior.historicalPayload })
    expect(historical.run.claimEventId).toBe(response.run.claimEventId)
    for (const name of ['createShapedCandidateRevision', 'executeRenderedExpressionRl', 'createGovernedReasoningExecution']) expect(current.args.deps[name]).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled(); expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    expect(current.args.deps.loadPackContent.mock.calls.some(([request]) => request.session?.unitOnly === true)).toBe(true)
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionOverlayFixture(), link = current.args.payload.expressionOverlay
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'outcome-commercial-expression.v2'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(20)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled(); expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test.each(['missing', 'status', 'version', 'hash', 'content', 'dependency', 'incompatible'])('rejects invalid native STYLE %s without a claim or provider', async kind => {
    const prior = await expressionOverlayFixture()
    if (kind === 'missing') current.args.deps.loadPackContent.mockResolvedValue(null)
    if (kind === 'status') prior.styleSource.status = 'RETIRED'
    if (kind === 'version') prior.styleSource.versionId += '-changed'
    if (kind === 'hash') prior.styleSource.contentHash = 'sha256:' + '0'.repeat(64)
    if (kind === 'content') prior.styleSource.content += ' Changed source.'
    if (kind === 'dependency') current.args.deps.loadPackContent.mockRejectedValue(new Error('STYLE source unavailable'))
    if (kind === 'incompatible') {
      const { createHash } = await import('node:crypto')
      prior.styleSource.contentFormat = 'JSON'
      prior.styleSource.content = JSON.stringify({ styleConstraints: { contractVersion: 'style-overlay.constraints.v1',
        incompatibleOutputTypes: ['commercial-strategy-and-decision-paper'], incompatibleAudienceKeys: [], requiredRendererCapabilities: [] } })
      prior.styleSource.contentHash = 'sha256:' + createHash('sha256').update(prior.styleSource.content).digest('hex')
      prior.style.contentHash = prior.styleSource.contentHash
    }
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(20)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled(); expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
  })
  test.each(['paper', 'receipt', 'stage audit'])('requires persisted %s readback before provider and keeps failed acknowledgement passive', async kind => {
    await expressionOverlayFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input)
      if (kind === 'paper') result.stage.outputSnapshot.sections[0].body = 'Changed after reviewed output.'
      if (kind === 'receipt') result.stage.outputSnapshot.styleValidationReceipt.paperFingerprint = '0'.repeat(64)
      if (kind === 'stage audit') {
        current.rejectStageAudit = true
        h.verifyRecordedStageAudit.mockImplementation(async raw => { if (current.rejectStageAudit && raw.attemptNumber === 7) bad('stage audit invalid') })
      }
      return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_CLAIM')).toHaveLength(1)
  })
  test('overlapping exact retries after claim stay passive while Shaping is pending', async () => {
    await expressionOverlayFixture()
    let release, entered
    const pending = new Promise(resolve => { release = resolve }), claimed = new Promise(resolve => { entered = resolve })
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => { entered(); await pending; return original(input) })
    const first = owner.completeIsolatedSyntheticOutcome(current.args); await claimed
    const second = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(second.run.status).toBe('UNKNOWN')
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    release(); const completed = await first
    expect(completed.run.status).toBe('FAILED')
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_CLAIM')).toHaveLength(1)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
  })
  test('uncertain Shaping7 claim stays passive without provider or meaning regeneration', async () => {
    await expressionOverlayFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('overlay gate'), { code: 'QA_OVERLAY_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_OVERLAY_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})


const expressionPresentationFixture = async () => {
  const prior = await expressionOverlayFixture(); await owner.completeIsolatedSyntheticOutcome(current.args)
  const historicalPayload = { ...current.args.payload }
  const claim = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_CLAIM')
  const result = current.events.find(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_RESULT')
  const original = result.body.stageRefs.map(expected => current.stages.find(row => row.stageExecutionId === expected.stageExecutionId))
  const pair = result.body.grrRefs[0], { style, styleSource } = prior
  const { buildCommercialStyleValidationReceipt } = await import('../services/commercialOutputReviewContract.js')
  const preview = { ...JSON.parse(JSON.stringify(prior.preview)), expressionProfileVersion: 'outcome-commercial-expression.v4',
    revisionOfStageExecutionId: original[1].stageExecutionId, revisionOfOutputFingerprint: original[1].outputFingerprint,
    remediationSourceStageExecutionId: original[2].stageExecutionId, remediationSourceAttemptFingerprint: original[2].attemptFingerprint }
  preview.styleValidationReceipt = buildCommercialStyleValidationReceipt({ contract: preview.outputContract, styleSource,
    outputAssetId: 'OT-023', title: preview.title, sections: preview.sections })
  const reviewed = membershipHash(preview), priorBuilder = current.args.deps.buildShapedCandidateRevisionOutput.getMockImplementation()
  current.args.payload = { ...current.args.payload, requestKey: randomUUID(), expressionPresentation: {
    claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash,
    narrativeStageExecutionId: original[0].stageExecutionId, narrativeMaterialHash: ref(original[0]).materialHash,
    shapingStageExecutionId: original[1].stageExecutionId, shapingMaterialHash: ref(original[1]).materialHash,
    failedRlStageExecutionId: original[2].stageExecutionId, failedRlMaterialHash: ref(original[2]).materialHash,
    executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
    expressionProfileVersion: 'outcome-commercial-expression.v4', reviewedOutputFingerprint: reviewed } }
  current.args.deps.buildShapedCandidateRevisionOutput = jest.fn(input => {
    if (input.expressionProfileVersion !== 'outcome-commercial-expression.v4') return priorBuilder(input)
    expect(input.styleSource).toBe(styleSource); return preview
  })
  current.args.deps.createShapedCandidateRevision = jest.fn(async input => {
    expect(input.expressionProfileVersion).toBe('outcome-commercial-expression.v4')
    const stage = { ...original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 8,
      predecessorStageExecutionId: original[1].stageExecutionId, predecessorAttemptFingerprint: original[1].attemptFingerprint,
      outputFingerprint: reviewed, outputSnapshot: JSON.parse(JSON.stringify(preview)) }
    current.stages.push(stage); return { stage }
  })
  current.args.deps.executeRenderedExpressionRl = jest.fn(async input => {
    const source = current.stages.at(-1)
    expect(source.stageKey).toBe('OUTPUT_SHAPING'); expect(source.attemptNumber).toBe(8)
    expect(source.outputFingerprint).toBe(reviewed); expect(source.outputSnapshot).toEqual(preview)
    expect(h.verifyRecordedStageAudit.mock.calls.some(([raw]) => raw === source)).toBe(true)
    await input.deps.createGovernedReasoningExecution({ deps: {} })
    const stage = { ...original[2], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 8,
      status: current.presentationPass ? 'SUCCEEDED' : 'FAILED', failure: current.presentationPass ? undefined : original[2].failure,
      predecessorStageExecutionId: original[2].stageExecutionId, predecessorAttemptFingerprint: original[2].attemptFingerprint,
      inputSnapshot: { sourceStage: { stageExecutionId: source.stageExecutionId, attemptFingerprint: source.attemptFingerprint, outputFingerprint: source.outputFingerprint } },
      executionIdentity: { grrExecutionId: current.executions.at(-1).executionId, grrRuntimeArtifactId: current.artifacts.at(-1).runtimeArtifactId } }
    current.stages.push(stage); return { stage }
  })
  jest.clearAllMocks(); return { claim, result, original, preview, historicalPayload, styleSource, style }
}

describe('fixed decision-led Commercial continuation, orchestration unit seams', () => {
  test.each([false, true])('preserves v30 and exact receipt-backed Shaping8 before one RL8 (PASS=%s)', async pass => {
    const prior = await expressionPresentationFixture(), before = membershipHash(prior); current.presentationPass = pass
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ completionVersion: 'isolated-synthetic-outcome-run.v31', status: pass ? 'BLOCKED' : 'FAILED' })
    expect(response.stages.at(-2)).toMatchObject({ attemptNumber: 8, outputFingerprint: current.args.payload.expressionPresentation.reviewedOutputFingerprint,
      outputSnapshot: { styleValidationReceipt: prior.preview.styleValidationReceipt } })
    expect(response.stages.at(-1).attemptNumber).toBe(8)
    expect(response.priorRuns.at(-1).resultEventId).toBe(prior.result.eventId)
    expect(membershipHash(prior)).toBe(before)
    await owner.completeIsolatedSyntheticOutcome(current.args)
    const historical = await owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: prior.historicalPayload })
    expect(historical.run.claimEventId).toBe(response.run.claimEventId)
    for (const name of ['createShapedCandidateRevision', 'executeRenderedExpressionRl', 'createGovernedReasoningExecution']) expect(current.args.deps[name]).toHaveBeenCalledTimes(1)
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    expect(current.args.deps.createNarrativePlan).not.toHaveBeenCalled(); expect(current.args.deps.createShapedCandidate).not.toHaveBeenCalled()
    expect(current.args.deps.loadPackContent.mock.calls.some(([request]) => request.session?.unitOnly === true)).toBe(true)
    await expect(owner.completeIsolatedSyntheticOutcome({ ...current.args, payload: { ...current.args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
  })
  test.each(['claim', 'result', 'status', 'failure', 'narrative', 'shaping', 'RL', 'execution', 'artifact', 'profile', 'reviewed output', 'audit', 'extra stage', 'orphan provider'])('rejects changed %s before claim or provider', async kind => {
    const prior = await expressionPresentationFixture(), link = current.args.payload.expressionPresentation
    if (kind === 'claim') link.claimBodyHash = '0'.repeat(64)
    if (kind === 'result') link.resultBodyHash = '0'.repeat(64)
    if (kind === 'status') prior.result.body.status = 'UNKNOWN'
    if (kind === 'failure') prior.result.body.failure.failureCode = 'OTHER'
    if (kind === 'narrative') link.narrativeMaterialHash = '0'.repeat(64)
    if (kind === 'shaping') link.shapingMaterialHash = '0'.repeat(64)
    if (kind === 'RL') link.failedRlMaterialHash = '0'.repeat(64)
    if (kind === 'execution') link.executionHash = '0'.repeat(64)
    if (kind === 'artifact') link.artifactHash = '0'.repeat(64)
    if (kind === 'profile') link.expressionProfileVersion = 'outcome-commercial-expression.v2'
    if (kind === 'reviewed output') link.reviewedOutputFingerprint = '0'.repeat(64)
    if (kind === 'audit') current.audits[0].valid = false
    if (kind === 'extra stage') current.stages.push({ ...prior.original[1], stageExecutionId: 'outcome_quality_stage_' + randomUUID(), attemptNumber: 99 })
    if (kind === 'orphan provider') current.executions.push({ outputTypeKey: 'RENDERED_EXPRESSION_RL', executionId: 'orphan' })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(22)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled(); expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
  test.each(['missing', 'status', 'version', 'hash', 'content', 'dependency', 'incompatible'])('rejects invalid native STYLE %s without a claim or provider', async kind => {
    const prior = await expressionPresentationFixture()
    if (kind === 'missing') current.args.deps.loadPackContent.mockResolvedValue(null)
    if (kind === 'status') prior.styleSource.status = 'RETIRED'
    if (kind === 'version') prior.styleSource.versionId += '-changed'
    if (kind === 'hash') prior.styleSource.contentHash = 'sha256:' + '0'.repeat(64)
    if (kind === 'content') prior.styleSource.content += ' Changed source.'
    if (kind === 'dependency') current.args.deps.loadPackContent.mockRejectedValue(new Error('STYLE source unavailable'))
    if (kind === 'incompatible') {
      const { createHash } = await import('node:crypto')
      prior.styleSource.contentFormat = 'JSON'
      prior.styleSource.content = JSON.stringify({ styleConstraints: { contractVersion: 'style-overlay.constraints.v1',
        incompatibleOutputTypes: ['commercial-strategy-and-decision-paper'], incompatibleAudienceKeys: [], requiredRendererCapabilities: [] } })
      prior.styleSource.contentHash = 'sha256:' + createHash('sha256').update(prior.styleSource.content).digest('hex')
      prior.style.contentHash = prior.styleSource.contentHash
    }
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.events).toHaveLength(22)
    expect(current.args.deps.createShapedCandidateRevision).not.toHaveBeenCalled(); expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
  })
  test.each(['paper', 'receipt', 'stage audit'])('requires persisted %s readback before provider and keeps failed acknowledgement passive', async kind => {
    await expressionPresentationFixture()
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => {
      const result = await original(input)
      if (kind === 'paper') result.stage.outputSnapshot.sections[0].body = 'Changed after reviewed output.'
      if (kind === 'receipt') result.stage.outputSnapshot.styleValidationReceipt.paperFingerprint = '0'.repeat(64)
      if (kind === 'stage audit') {
        current.rejectStageAudit = true
        h.verifyRecordedStageAudit.mockImplementation(async raw => { if (current.rejectStageAudit && raw.attemptNumber === 8) bad('stage audit invalid') })
      }
      return result
    })
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    await expect(owner.completeIsolatedSyntheticOutcome(current.args)).rejects.toThrow()
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    expect(current.args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).not.toHaveBeenCalled()
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_PRESENTATION_CLAIM')).toHaveLength(1)
  })
  test('overlapping exact retries after claim stay passive while Shaping is pending', async () => {
    await expressionPresentationFixture()
    let release, entered
    const pending = new Promise(resolve => { release = resolve }), claimed = new Promise(resolve => { entered = resolve })
    const original = current.args.deps.createShapedCandidateRevision.getMockImplementation()
    current.args.deps.createShapedCandidateRevision.mockImplementation(async input => { entered(); await pending; return original(input) })
    const first = owner.completeIsolatedSyntheticOutcome(current.args); await claimed
    const second = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(second.run.status).toBe('UNKNOWN')
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    release(); const completed = await first
    expect(completed.run.status).toBe('FAILED')
    expect(current.events.filter(row => row.phase === 'COMPLETION_EXPRESSION_PRESENTATION_CLAIM')).toHaveLength(1)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
  })
  test('uncertain Shaping8 claim stays passive without provider or meaning regeneration', async () => {
    await expressionPresentationFixture()
    current.args.deps.createShapedCandidateRevision.mockRejectedValueOnce(Object.assign(new Error('overlay gate'), { code: 'QA_OVERLAY_GATE' }))
    const response = await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'QA_OVERLAY_GATE' } })
    await owner.completeIsolatedSyntheticOutcome(current.args)
    expect(current.args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
    expect(current.args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
  })
})
