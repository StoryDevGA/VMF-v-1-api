import { jest } from '@jest/globals'
import { readOutcomeDocxRenditionSource } from '../services/outcomeDocxRenditionSourceService.js'
import { OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { hashOutcomeQualityStageValue as hash } from '../services/outcomeQualityStageExecutionService.js'

// Generic projection fixtures. They simulate the native verified-reader seam;
// they do not prove database records, audit signatures or authentication.
const fixture = () => {
  const scope = { customerId: 'customer', tenantId: 'tenant', runtimeInstanceId: 'runtime',
    classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false }
  const common = { ...scope, requestId: 'request', planId: 'plan', planFingerprint: 'plan-hash',
    draftId: 'logical-draft', draftIterationId: 'logical-iteration', knowledgeCompositionPlanRecordId: 'record',
    planVersion: 1, resolutionFingerprint: 'resolution', contextFingerprint: 'context' }
  const stages = OUTCOME_QUALITY_STAGE_SEQUENCE.slice(0, 6).map((stageKey, i) => ({ ...common,
    stageKey, stageOrder: i + 1, stageExecutionId: `stage-${i}`, status: i === 5 ? 'FAILED' : 'SUCCEEDED',
    attemptFingerprint: `attempt-${i}`, inputSnapshot: {}, outputSnapshot: i === 5 ? undefined : { text: `Generic stage ${i}` } }))
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i], previous = stages[i - 1]
    if (i >= 2) stage.inputSnapshot.sourceStage = { stageExecutionId: previous.stageExecutionId,
      outputFingerprint: previous.outputFingerprint, attemptFingerprint: previous.attemptFingerprint }
    if (i === 2) Object.assign(stage.outputSnapshot, { workingDraftStageExecutionId: previous.stageExecutionId,
      workingDraftOutputFingerprint: previous.outputFingerprint, approvedMeaning: { state: 'APPROVED',
        workingDraftStageExecutionId: previous.stageExecutionId, workingDraftOutputFingerprint: previous.outputFingerprint } })
    stage.inputFingerprint = hash(stage.inputSnapshot)
    stage.outputFingerprint = i === 5 ? '' : hash(stage.outputSnapshot)
  }
  const packLayers = ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']
  const plan = { ...common, _id: 'record', payload: { resolution: { selectedPacks: packLayers.map(knowledgeLayer => ({
    knowledgeLayer, packId: knowledgeLayer, packKey: knowledgeLayer, capabilityKey: knowledgeLayer,
    versionId: 'version', semanticVersion: '1.0.0', activationId: 'activation', contentHash: `sha256:${'a'.repeat(64)}` })) } } }
  const native = { scope, classification: scope.classification, authoritative: false, normalOutputAvailable: false,
    authorisesApproval: false, basis: { snapshotId: 'snapshot', membershipHash: 'membership', lockSnapshotHash: 'lock', basisStateVersion: 1 },
    stages, run: { claimEventId: 'claim', resultEventId: 'result', status: 'FAILED', failure: { failureCode: 'HISTORICAL_REVIEW_FAILED' } },
    priorRuns: [{ status: 'FAILED' }] }
  const reseal = () => { native.run.stageRefs = stages.map(stage => ({ stageExecutionId: stage.stageExecutionId,
    stageKey: stage.stageKey, status: stage.status, materialHash: membershipHash(stage), inputFingerprint: stage.inputFingerprint,
    outputFingerprint: stage.outputFingerprint, attemptFingerprint: stage.attemptFingerprint })) }
  reseal()
  const deps = { readSourceRun: jest.fn(async () => native), loadPlan: jest.fn(async () => plan), assertPlanIntegrity: jest.fn() }
  return { native, plan, stages, deps, reseal, args: { actorUserId: 'actor', runtimeInstanceId: 'runtime',
    scopes: { customer: { _id: 'customer' }, tenant: { _id: 'tenant' } }, deps } }
}

test('preserves approved source, selected pack receipts, logical identity and failed review without write authority', async () => {
  const f = fixture(), before = JSON.stringify(f.native)
  const result = await readOutcomeDocxRenditionSource(f.args)
  expect(result).toMatchObject({ sourceAdmission: 'VERIFIED_READ_ONLY_CHAIN', authoritative: false,
    authorisesApproval: false, renderingAvailable: false, finalisationAvailable: false, deliveryAvailable: false,
    source: { kind: 'GOVERNED_STAGE_CHAIN', logicalDraft: { draftId: 'logical-draft' },
      reviewState: { status: 'FAILED', failure: { failureCode: 'HISTORICAL_REVIEW_FAILED' } } } })
  expect(Object.keys(result.source.selectedPacks)).toHaveLength(5)
  expect(result.sourceFingerprint).toBe(membershipHash(result.source))
  expect(f.deps.readSourceRun).toHaveBeenCalledWith({ actorUserId: 'actor', runtimeInstanceId: 'runtime', scopes: f.args.scopes })
  expect(f.deps.loadPlan).toHaveBeenCalledWith(expect.objectContaining({ _id: 'record', customerId: 'customer', requestId: 'request' }))
  result.source.content.workingDraft.text = 'Changed projection'
  expect(JSON.stringify(f.native)).toBe(before)
})

test.each([
  ['authority', f => { f.native.authoritative = true }],
  ['customer', f => { f.args.scopes.customer._id = 'other' }],
  ['runtime', f => { f.native.scope.runtimeInstanceId = 'other' }],
  ['basis', f => { delete f.native.basis.lockSnapshotHash }],
  ['journal', f => { delete f.native.run.resultEventId }],
  ['stage population', f => { f.stages.pop() }],
  ['failed meaning stage', f => { f.stages[2].status = 'FAILED'; f.reseal() }],
  ['changed source', f => { f.stages[1].outputSnapshot.text = 'tampered' }],
  ['cross plan', f => { f.stages[3].planId = 'other'; f.reseal() }],
  ['not approved', f => { f.stages[2].outputSnapshot.approvedMeaning.state = 'REJECTED'; f.stages[2].outputFingerprint = hash(f.stages[2].outputSnapshot); f.reseal() }],
  ['predecessor', f => { f.stages[4].inputSnapshot.sourceStage.stageExecutionId = 'other'; f.stages[4].inputFingerprint = hash(f.stages[4].inputSnapshot); f.reseal() }],
  ['plan identity', f => { f.plan._id = 'other' }],
  ['missing pack', f => { f.plan.payload.resolution.selectedPacks.pop() }],
  ['ambiguous pack', f => { f.plan.payload.resolution.selectedPacks.push(f.plan.payload.resolution.selectedPacks[0]) }],
  ['missing receipt', f => { delete f.plan.payload.resolution.selectedPacks[0].activationId }],
])('fails closed on %s', async (_name, change) => {
  const f = fixture(); change(f)
  await expect(readOutcomeDocxRenditionSource(f.args)).rejects.toMatchObject({ status: 409, code: 'OUTCOME_DOCX_SOURCE_BLOCKED',
    details: { contentIncludedInError: false } })
})

test('does not disguise a rejected native read or plan dependency as an empty source', async () => {
  const f = fixture(), error = Object.assign(new Error('Unavailable'), { status: 503, code: 'NATIVE_READ_UNAVAILABLE' })
  f.deps.readSourceRun.mockRejectedValue(error)
  await expect(readOutcomeDocxRenditionSource(f.args)).rejects.toBe(error)
  expect(f.deps.loadPlan).not.toHaveBeenCalled()
  const other = fixture(); other.deps.loadPlan.mockRejectedValue(error)
  await expect(readOutcomeDocxRenditionSource(other.args)).rejects.toBe(error)
})

test('rejects invalid plan integrity', async () => {
  const f = fixture(); f.deps.assertPlanIntegrity.mockImplementation(() => { throw new Error('Invalid plan') })
  await expect(readOutcomeDocxRenditionSource(f.args)).rejects.toMatchObject({ details: { reason: 'SOURCE_PLAN_INVALID' } })
})
