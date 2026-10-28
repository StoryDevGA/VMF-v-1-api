import { jest, beforeEach, test, expect } from '@jest/globals'

// Actual successor confirmation, passive presentation, controller and token owners.
// Runtime/model/auth reads and the KCP candidate read are controlled fixtures;
// canonical KCP integrity, evidence contract and readiness owners remain real.
const runtimeOwners = await import('../services/runtimeInstanceService.js')
const kcpOwners = await import('../services/outcomeKnowledgeCompositionPlanService.js')
let sourceRuntime, targetRuntime, sourcePlan, records, changeAfterSeal = false
const candidateCalls = []
const candidateFingerprints = []
const providerFactory = jest.fn(() => { throw new Error('Unexpected provider') })
const runtimeRead = jest.fn(async ({ runtimeInstanceId }) =>
  String(runtimeInstanceId) === String(targetRuntime._id) ? targetRuntime : sourceRuntime)
const permission = jest.fn(async () => {})
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...runtimeOwners,
  getRuntimeInstance: runtimeRead, assertRuntimePermission: permission }))
let attachContract, compile, providerVersion
jest.unstable_mockModule('../services/outcomeKnowledgeCompositionPlanService.js', () => ({ ...kcpOwners,
  buildOutcomeKnowledgeCompositionPlanForRuntime: jest.fn(async (args) => {
    candidateCalls.push(args)
    const plan = JSON.parse(JSON.stringify(sourcePlan))
    plan.requestId = args.requestScope.requestId
    plan.payload.requestId = plan.requestId
    if (changeAfterSeal && candidateCalls.length > 1) plan.payload.lockedTruth.lockSnapshotHash = '9'.repeat(64)
    attachContract(plan.payload)
    const input = JSON.parse(plan.payload.evidenceToMeaning.contractJson).inputs
    input.composition.providerCompatibility = { contractVersion: providerVersion, status: 'READY' }
    const contract = compile(input)
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    plan.planFingerprint = kcpOwners.hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    kcpOwners.assertOutcomeKnowledgeCompositionPlanIntegrity(plan)
    candidateFingerprints.push(plan.planFingerprint)
    return plan
  }) }))
const fixtures = await import('./fixtures/outcomeQualityStageFixtures.js')
const ss040 = await import('./fixtures/ss040EvidenceToMeaningFixtures.js')
attachContract = ss040.attachSs040PlanFixtureContract
compile = (await import('../services/outcomeEvidenceToMeaningContractService.js')).compileEvidenceToMeaningContract
providerVersion = (await import('../services/outcomeEvidenceToMeaningProviderService.js')).EVIDENCE_TO_MEANING_PROVIDER_VERSION
const models = await import('../models/index.js')
const { confirmRuntimeOutcomeSuccessor } = await import('../controllers/outcomeSuccessor.controller.js')
const { openOutcomeSuccessorConfirmation } = await import('../services/outcomeSuccessorConfirmation.js')
const { confirmOutcomeSuccessor } = await import('../services/outcomeSuccessorService.js')
const query = (value) => ({ select() { return this }, session() { return this }, maxTimeMS() { return this },
  sort() { return this }, limit() { return this }, lean: async () => value })
let mutationSpies
beforeEach(() => {
  jest.restoreAllMocks(); candidateCalls.length = 0; candidateFingerprints.length = 0; changeAfterSeal = false
  providerFactory.mockClear()
  sourceRuntime = fixtures.makeRuntime()
  Object.assign(sourceRuntime, { workspaceId: 'confirmation-fixture-workspace', stateVersion: 'source-state', packageId: 'fixture-package',
    revision: { revisionNumber: 1 }, evidence: { dependencySnapshotId: 'dependency-qa', dependencySnapshotHash: 'f'.repeat(64) } })
  targetRuntime = { ...sourceRuntime, _id: '6a0000000000000000000004', stateVersion: 'target-state',
    revision: { revisionNumber: 2, rootRuntimeId: sourceRuntime._id, parentRuntimeId: sourceRuntime._id } }
  const binding = fixtures.makeBinding()
  for (const pack of Object.values(binding.selectedByLayer).flat()) {
    if (['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA'].includes(pack.packType)) pack.contentHash = ss040.ss040TargetHashFor(pack.capabilityKey)
  }
  sourcePlan = fixtures.makePlan({ originalRequest: 'Preserve this exact selected request.' }, sourceRuntime, binding)
  sourcePlan.requestId = '8abedafd-8555-4342-be49-76ab906a26f6'; sourcePlan.payload.requestId = sourcePlan.requestId
  sourcePlan.planFingerprint = kcpOwners.hashOutcomeKnowledgeCompositionSemanticValue(sourcePlan.payload)
  kcpOwners.assertOutcomeKnowledgeCompositionPlanIntegrity(sourcePlan)
  const scope = { customerId: sourceRuntime.customerId, tenantId: sourceRuntime.tenantId,
    runtimeInstanceId: sourceRuntime._id, sessionId: 'historical-session' }
  const truth = sourcePlan.payload.lockedTruth
  records = {
    OutcomeAsset: { ...scope, outcomeAssetId: 'asset', status: 'PUBLISHED', currentVersionId: 'later-version' },
    OutcomeAssetVersion: { ...scope, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', versionNumber: 1,
      status: 'SUPERSEDED', title: 'Historical qualified output', frameworkKey: sourceRuntime.frameworkKey,
      packageKey: sourceRuntime.packageKey, packageVersion: sourceRuntime.packageVersion,
      customerContent: { markdown: 'The source estimates remain qualified.' }, truthSignature: { evidence: {
        publishSnapshotId: truth.publishSnapshotId, publishSnapshotHash: truth.publishSnapshotHash,
        lockSnapshotId: truth.lockSnapshotId, lockSnapshotHash: truth.lockSnapshotHash,
        replayAnchorId: truth.replayAnchorId, replayAnchorHash: truth.replayAnchorHash } },
      lineageSummary: { draftApproval: { operation: 'DRAFT_APPROVAL', outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
        draftId: 'draft', draftIterationId: 'iteration', draftIterationNumber: 1, versionNumber: 1,
        approvedBy: String(fixtures.ids.actor), approvedAt: '2026-10-13T10:00:00Z' } } },
    OutcomeSession: { ...scope, contextBindings: { requestPlan: { requestId: sourcePlan.requestId,
      planId: sourcePlan.planId, planFingerprint: sourcePlan.planFingerprint } } },
    OutcomeKnowledgeCompositionPlan: sourcePlan,
    OutcomeDraft: { ...scope, draftId: 'draft', status: 'APPROVED', approvedIterationId: 'iteration', approvedAssetVersionId: 'historical' },
    OutcomeDraftIteration: { ...scope, draftId: 'draft', draftIterationId: 'iteration', iterationNumber: 1, status: 'APPROVED' },
    OutcomeSuccessorOperation: null,
  }
  for (const [name, value] of Object.entries(records)) jest.spyOn(models[name], 'findOne').mockImplementation(() => query(value))
  jest.spyOn(models.RuntimeInstance, 'find').mockImplementation(() => query([]))
  mutationSpies = ['OutcomeSuccessorOperation', 'OutcomeKnowledgeCompositionPlan', 'OutcomeDraft', 'OutcomeAssetVersion']
    .map((name) => jest.spyOn(models[name], 'create').mockImplementation(() => { throw new Error('Unexpected mutation') }))
})
const invoke = async () => {
  const req = { context: { userId: String(fixtures.ids.actor) }, scopes: {}, requestId: 'owner-confirmation-test',
    app: { locals: { outcomeStudioReasoningDeps: { frameworkGuidanceProviderAdapterFactory: providerFactory } } },
    params: { runtimeInstanceId: String(sourceRuntime._id), outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical' },
    body: { targetRuntimeInstanceId: String(targetRuntime._id), idempotencyKey: '12345678-1234-4123-8123-123456789abc' } }
  const res = { status: jest.fn(function (value) { this.statusCode = value; return this }),
    json: jest.fn(function (value) { this.body = value; return this }) }
  await confirmRuntimeOutcomeSuccessor(req, res)
  return res
}
test('actual signed confirmation accepts snapshot-bearing presentation and binds the same request across both reads', async () => {
  const before = JSON.stringify({ records, sourceRuntime, targetRuntime })
  await confirmOutcomeSuccessor({ actorUserId: String(fixtures.ids.actor), scopes: {}, runtimeInstanceId: String(sourceRuntime._id),
    outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', targetRuntimeInstanceId: String(targetRuntime._id),
    idempotencyKey: '12345678-1234-4123-8123-123456789abc' })
  candidateCalls.length = 0; candidateFingerprints.length = 0
  const res = await invoke()
  expect(res.statusCode).toBe(200)
  const result = res.body.data
  expect(result.source.evidenceSnapshot.status).toBe('AVAILABLE')
  expect(result.target.evidenceSnapshot.status).toBe('AVAILABLE')
  expect(result.source.outcomeAssetVersionId).toBe('historical')
  const binding = openOutcomeSuccessorConfirmation(result.confirmation.receipt)
  expect(candidateCalls).toHaveLength(2)
  expect(candidateCalls.map((call) => call.requestScope.requestId)).toEqual([binding.requestId, binding.requestId])
  expect(candidateFingerprints[0]).toBe(candidateFingerprints[1])
  expect(binding.target).not.toHaveProperty('evidenceSnapshot')
  expect(JSON.stringify({ records, sourceRuntime, targetRuntime })).toBe(before)
  mutationSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled())
  expect(providerFactory).not.toHaveBeenCalled()
})
test('real canonical candidate snapshot drift after sealing fails stale before operation/provider work', async () => {
  changeAfterSeal = true
  const before = JSON.stringify(records)
  const res = await invoke()
  expect(res.statusCode).toBe(409)
  expect(res.body.error.details.recoveryAction).toBe('REFRESH_CONFIRMATION')
  expect(candidateCalls).toHaveLength(2)
  expect(candidateCalls[0].requestScope.requestId).toBe(candidateCalls[1].requestScope.requestId)
  expect(candidateFingerprints[0]).not.toBe(candidateFingerprints[1])
  mutationSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled())
  expect(providerFactory).not.toHaveBeenCalled()
  expect(JSON.stringify(records)).toBe(before)
})
