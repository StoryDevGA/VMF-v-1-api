import { jest, test, expect } from '@jest/globals'
import { getOutcomeSelectedVersionPreview, getOutcomeSuccessorCompare, getOutcomeSuccessorOperationByKey,
  projectOutcomeSuccessorContent, projectOutcomeSuccessorOperation } from '../services/outcomeSuccessorPresentationService.js'
import { getOutcomeSuccessorPreflightPresentation } from '../services/outcomeSuccessorPresentationService.js'
import { projectOutcomeSuccessorLineage } from '../services/outcomeSuccessorOperationService.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'
import { buildGovernedDraftCustomerContent } from '../services/outcomeStudioService.js'
import { freezeSs041Snapshot, makeSs041Fixture } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'

const sourceId = '6a0000000000000000000003'
const targetId = '6a0000000000000000000004'
const actorUserId = '6a0000000000000000000005'
const customerId = '6a0000000000000000000001'
const tenantId = '6a0000000000000000000002'
const setupSource = () => {
  const scope = { customerId, tenantId, runtimeInstanceId: sourceId, sessionId: 'historical-session' }
  const runtime = { _id: sourceId, customerId, tenantId, workspaceId: 'workspace', stateVersion: 'state',
    runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: 'package', packageKey: 'pk', packageVersion: '1',
    status: 'LOCKED', revision: { revisionNumber: 1 }, evidence: { dependencySnapshotId: 'snapshot', dependencySnapshotHash: 'hash' } }
  const target = { ...runtime, _id: targetId, revision: { revisionNumber: 2, rootRuntimeId: sourceId, parentRuntimeId: sourceId } }
  const plan = { ...scope, requestId: 'historical-request', planId: 'historical-plan', planFingerprint: 'fingerprint', payload: {
    consumerIntent: { originalRequest: 'Original request', requestedOutputTypeKey: 'brief', outcome: 'brief', decisionPurpose: 'decide',
      consumer: 'board', audience: ['board'], format: 'markdown' }, governedContext: {
      outputType: { key: 'brief' }, outputSchema: { key: 'schema' }, style: { key: 'style' } },
    resolution: { selectedPacks: ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE'].map((packType, index) => ({
      activationId: `activation-${index}`, packId: `pack-${index}`, versionId: `version-${index}`, packType,
      packKey: ['brief', 'schema', 'style'][index], semanticVersion: '1.0.0', contentHash: `sha256:${String(index + 1).repeat(64)}` })) } } }
  const records = {
    OutcomeAsset: { ...scope, outcomeAssetId: 'asset', status: 'PUBLISHED', currentVersionId: 'latest-version' },
    OutcomeAssetVersion: { ...scope, title: 'Original decision', outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
      versionNumber: 1, status: 'SUPERSEDED', frameworkKey: 'VMF', packageKey: 'pk', packageVersion: '1',
      customerContent: { sections: [{ key: 'evidence', label: 'Evidence', body: 'Early estimates remain uncertain.' }],
        metadata: { private: 'never expose this' } }, warnings: ['Estimate only.'], limitations: ['Further evidence is needed.'],
      lineageSummary: { draftApproval: { operation: 'DRAFT_APPROVAL', outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
        draftId: 'approved-draft', draftIterationId: 'approved-iteration', draftIterationNumber: 1, versionNumber: 1,
        approvedBy: actorUserId, approvedAt: '2026-10-13T10:00:00Z' } } },
    OutcomeSession: { ...scope, contextBindings: { requestPlan: { requestId: plan.requestId, planId: plan.planId, planFingerprint: plan.planFingerprint } } },
    OutcomeKnowledgeCompositionPlan: plan,
    OutcomeDraft: { ...scope, draftId: 'approved-draft', status: 'APPROVED', approvedIterationId: 'approved-iteration', approvedAssetVersionId: 'historical' },
    OutcomeDraftIteration: { ...scope, draftId: 'approved-draft', draftIterationId: 'approved-iteration', iterationNumber: 1, status: 'APPROVED' },
  }
  const deps = { readRuntimeControl: jest.fn(async ({ runtimeInstanceId }) => runtimeInstanceId === targetId ? target : runtime),
    assertRuntimePermission: jest.fn(async () => {}), readOne: jest.fn(async (model) => records[model.modelName]),
    // These source-row tests isolate presentation/lookup, not canonical plan authoring.
    assertPlanIntegrity: jest.fn() }
  const args = { actorUserId, runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', scopes: {}, deps }
  return { args, deps, records, runtime, target }
}
test('historical preview uses selected version own approval/session/plan and preserves all qualifications', async () => {
  const { args, deps, records } = setupSource(); const before = JSON.stringify(records)
  const preview = await getOutcomeSelectedVersionPreview(args)
  expect(preview.identity.outcomeAssetVersionId).toBe('historical')
  expect(preview.identity.runtimeInstanceId).toBe(sourceId)
  expect(preview.sections[0].body).toBe('Early estimates remain uncertain.')
  expect(preview.warnings).toEqual(['Estimate only.'])
  expect(preview.limitations).toEqual(['Further evidence is needed.'])
  expect(JSON.stringify(preview)).not.toMatch(/never expose this|latest-version|metadata/)
  expect(deps.readOne.mock.calls[2][1]).toEqual(expect.objectContaining({ sessionId: 'historical-session' }))
  expect(deps.readOne.mock.calls[3][1]).toEqual(expect.objectContaining({ requestId: 'historical-request', planId: 'historical-plan' }))
  expect(deps.readOne.mock.calls[5][1]).toEqual(expect.objectContaining({ draftIterationId: 'approved-iteration' }))
  expect(JSON.stringify(records)).toBe(before)
})
test('passive preflight exposes exact canonical source and frozen contract descriptors without raw scope/prose', async () => {
  const { args, deps, records } = setupSource()
  deps.listTargets = jest.fn(async () => [])
  deps.buildCandidate = jest.fn(async () => structuredClone(records.OutcomeKnowledgeCompositionPlan))
  deps.projectReadiness = jest.fn(() => ({ status: 'READY_TO_DRAFT', canExecute: true }))
  const result = await getOutcomeSuccessorPreflightPresentation(args)
  expect(result.source.runtimeInstanceId).toBe(sourceId)
  expect(result.target.runtimeInstanceId).toBe(sourceId)
  expect(result.targetExplicitlySelected).toBe(false)
  expect(result.carryForward.outputSchema).toEqual({ key: 'schema', label: 'schema', version: '1.0.0' })
  expect(result.confirmation.receipt).toBeNull()
  expect(JSON.stringify(result)).not.toMatch(/customerId|tenantId|workspaceId|never expose this/)
})
const snapshotIdentity = (prefix) => ({ publishSnapshotId: `${prefix}-publish`, publishSnapshotHash: 'a'.repeat(64),
  lockSnapshotId: `${prefix}-lock`, lockSnapshotHash: 'b'.repeat(64), replayAnchorId: `${prefix}-replay`, replayAnchorHash: 'c'.repeat(64) })
test.each([undefined, targetId])('before confirmation source uses historical version and target uses captured candidate (%s)', async (selected) => {
  const { args, deps, records, runtime, target } = setupSource()
  const sourceEvidence = snapshotIdentity('selected-historical')
  const targetEvidence = snapshotIdentity(selected ? 'explicit-newer' : 'current-source')
  records.OutcomeAssetVersion.truthSignature = { evidence: { ...sourceEvidence,
    dependencySnapshotId: 'not-an-evidence-snapshot', privateNotes: 'private source detail' } }
  const candidate = structuredClone(records.OutcomeKnowledgeCompositionPlan)
  candidate.payload.lockedTruth = { ...targetEvidence, dependencySnapshotId: 'package-only', acceptedSections: [{ private: 'private target detail' }] }
  deps.listTargets = jest.fn(async () => [])
  deps.buildCandidate = jest.fn(async () => candidate)
  deps.projectReadiness = jest.fn(() => ({ status: 'READY_TO_DRAFT', canExecute: true }))
  const before = JSON.stringify({ records, runtime, target, candidate })
  const result = await getOutcomeSuccessorPreflightPresentation({ ...args, targetRuntimeInstanceId: selected })
  expect(result.source.evidenceSnapshot).toEqual({ status: 'AVAILABLE', ...sourceEvidence })
  expect(result.target.evidenceSnapshot).toEqual({ status: 'AVAILABLE', ...targetEvidence,
    inventoryReceipt: { status: 'UNAVAILABLE', reason: 'EVIDENCE_INVENTORY_RECEIPT_NOT_RECORDED' } })
  expect(result.source.outcomeAssetVersionId).toBe('historical')
  expect(result.target.runtimeInstanceId).toBe(selected || sourceId)
  expect(result.source.dependencySnapshotId).toBe('snapshot')
  expect(result.confirmation.receipt).toBeNull()
  expect(JSON.stringify(result)).not.toMatch(/private source detail|private target detail|package-only|not-an-evidence-snapshot|latest-version/)
  expect(JSON.stringify({ records, runtime, target, candidate })).toBe(before)
  expect(deps.buildCandidate.mock.calls[0][0].runtimeInstanceId).toBe(selected || sourceId)
})
test('missing or malformed snapshot identity stays unavailable without dependency/state aliases', async () => {
  const { args, deps, records } = setupSource()
  records.OutcomeAssetVersion.truthSignature = { evidence: { dependencySnapshotId: 'package', stateVersion: 'runtime', lockSnapshotId: 22 } }
  const candidate = structuredClone(records.OutcomeKnowledgeCompositionPlan)
  candidate.payload.lockedTruth = { ...snapshotIdentity('target'), replayAnchorHash: '', stateVersion: 'runtime' }
  deps.listTargets = jest.fn(async () => [])
  deps.buildCandidate = jest.fn(async () => candidate)
  deps.projectReadiness = jest.fn(() => ({ status: 'CLARIFICATION_REQUIRED', canExecute: false }))
  const result = await getOutcomeSuccessorPreflightPresentation(args)
  expect(result.status).toBe('BLOCKED')
  expect(result.source.evidenceSnapshot).toMatchObject({ status: 'UNAVAILABLE', reason: 'ACCEPTED_EVIDENCE_SNAPSHOT_NOT_RECORDED' })
  expect(result.source.evidenceSnapshot).not.toHaveProperty('lockSnapshotId')
  expect(result.target.evidenceSnapshot).toMatchObject({ status: 'UNAVAILABLE', missingFields: ['replayAnchorHash'] })
  expect(result.source.evidenceSnapshot).not.toHaveProperty('stateVersion')
  expect(result.source.evidenceSnapshot).not.toHaveProperty('dependencySnapshotId')
})
test('target inventory descriptor uses exact integrity-checked completeness receipt with a safe allowlist', async () => {
  const { args, deps, records } = setupSource()
  const input = await makeSs041Fixture()
  await freezeSs041Snapshot(input, { scopeOverride: { customerId, tenantId, runtimeInstanceId: sourceId } })
  const selectedPacks = Object.entries(input.selectedTarget.receipt.contractIdentity).map(([role, value]) => ({
    ...value.selection, packType: role === 'schema' ? 'OUTPUT_SCHEMA' : 'OUTPUT_TYPE_DEFINITION' }))
  selectedPacks.push(records.OutcomeKnowledgeCompositionPlan.payload.resolution.selectedPacks.find((pack) => pack.packType === 'STYLE'))
  const candidate = structuredClone(records.OutcomeKnowledgeCompositionPlan)
  candidate.payload = { runtime: input.composition.runtimeBinding, lockedTruth: snapshotIdentity('candidate'),
    consumerIntent: candidate.payload.consumerIntent, resolution: { selectedPacks }, governedContext: {
      outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
      outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' }, style: { key: 'style' } } }
  input.composition.truthBinding = { lockedTruth: candidate.payload.lockedTruth, frameworkHandoff: null }
  input.composition.requestBinding = { ...candidate.payload.consumerIntent, requestId: '' }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(candidate.payload)
  const contract = compileEvidenceToMeaningContract(input)
  candidate.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  records.OutcomeKnowledgeCompositionPlan.payload = structuredClone(candidate.payload)
  deps.listTargets = jest.fn(async () => [])
  deps.buildCandidate = jest.fn(async () => candidate)
  deps.projectReadiness = jest.fn(() => ({ status: 'READY_TO_DRAFT', canExecute: true }))
  const before = JSON.stringify({ records, candidate })
  const result = await getOutcomeSuccessorPreflightPresentation(args)
  const receipt = contract.inputs.sourceSnapshot.inventoryReceipt
  expect(result.target.evidenceSnapshot.inventoryReceipt).toEqual({ status: 'AVAILABLE', version: receipt.version,
    completeness: receipt.completeness, overallHash: receipt.overallHash,
    totalEvidenceCount: receipt.collections.evidence.totalCount, totalSourceCount: receipt.collections.sources.totalCount })
  expect(JSON.stringify(result.target.evidenceSnapshot)).not.toMatch(/selectedEvidenceIds|scope|records|extractedFact|stateVersion|dependencySnapshot/)
  expect(JSON.stringify({ records, candidate })).toBe(before)
  candidate.payload.evidenceToMeaning.contractHash = 'tampered'
  await expect(getOutcomeSuccessorPreflightPresentation(args)).rejects.toMatchObject({ details: { reason: 'CONTRACT_INTEGRITY_OR_BINDING_INVALID' } })
})
test.each(['Provider context is included.', 'A prompt describes the board.', 'x'.repeat(64001)])('unsafe or oversized prose is rejected', async (body) => {
  const { args, records } = setupSource(); records.OutcomeAssetVersion.customerContent.sections[0].body = body
  await expect(getOutcomeSelectedVersionPreview(args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_CONTENT_UNAVAILABLE' })
})
test.each([{ markdown: {} }, { sections: 'bad' }, { markdown: 'Valid', warnings: [{}] }, { markdown: 'Valid', limitations: 'bad' }])('malformed content is rejected %j', (content) => {
  expect(() => projectOutcomeSuccessorContent(content)).toThrow()
})
test('source authority and rejected owner promises remain failures', async () => {
  const { args, deps } = setupSource(); deps.assertRuntimePermission.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }))
  await expect(getOutcomeSelectedVersionPreview(args)).rejects.toMatchObject({ status: 403 })
  expect(deps.readOne).not.toHaveBeenCalled()
  const next = setupSource(); next.deps.readOne.mockRejectedValue(new Error('read unavailable'))
  await expect(getOutcomeSelectedVersionPreview(next.args)).rejects.toThrow('read unavailable')
})
test('both stored and content-level warnings/limitations are preserved', async () => {
  const { args, records } = setupSource()
  records.OutcomeAssetVersion.customerContent.warnings = ['Additional uncertainty.']
  records.OutcomeAssetVersion.customerContent.limitations = ['Independent verification is pending.']
  const result = await getOutcomeSelectedVersionPreview(args)
  expect(result.warnings).toEqual(['Estimate only.', 'Additional uncertainty.'])
  expect(result.limitations).toEqual(['Further evidence is needed.', 'Independent verification is pending.'])
})
test('selected source records cannot be replaced by another scope/session/approval', async () => {
  const { args, records } = setupSource(); records.OutcomeSession.sessionId = 'latest-session'
  await expect(getOutcomeSelectedVersionPreview(args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_SOURCE_LINEAGE_INCOMPLETE' })
  const next = setupSource(); next.records.OutcomeAssetVersion.customerId = targetId
  await expect(getOutcomeSelectedVersionPreview(next.args)).rejects.toMatchObject({ status: 403 })
})
test('readback key verified absence has zero mutation and target authorization is independent', async () => {
  const { args, deps } = setupSource()
  deps.getSourcePreview = jest.fn(async () => ({ governance: {} }))
  deps.readOne.mockResolvedValue(null)
  const result = await getOutcomeSuccessorOperationByKey({ ...args, targetRuntimeInstanceId: targetId, idempotencyKey: 'key' })
  expect(result).toMatchObject({ status: 'NOT_RECORDED', result: null })
  expect(deps.assertRuntimePermission).toHaveBeenCalledWith(expect.objectContaining({ permission: 'VMF_VIEW', customerId, tenantId }))
  expect(deps.readOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId, tenantId,
    sourceRuntimeInstanceId: sourceId, idempotencyKey: 'key' }))
  deps.assertRuntimePermission.mockRejectedValue(Object.assign(new Error('target denied'), { status: 403 }))
  await expect(getOutcomeSuccessorOperationByKey({ ...args, targetRuntimeInstanceId: targetId, idempotencyKey: 'key' })).rejects.toMatchObject({ status: 403 })
})
test('key dependency failure is unknown, never NOT_RECORDED', async () => {
  const { args, deps } = setupSource(); deps.getSourcePreview = jest.fn(async () => ({ governance: {} }))
  deps.readOne.mockRejectedValue(new Error('lookup interrupted'))
  await expect(getOutcomeSuccessorOperationByKey({ ...args, targetRuntimeInstanceId: targetId, idempotencyKey: 'key' })).rejects.toThrow('lookup interrupted')
})
test('key existing operation must bind exact selected source/target/hash', async () => {
  const { args, deps } = setupSource(); deps.getSourcePreview = jest.fn(async () => ({ governance: { sourceHash: 'hash', sourceVersionWitnessHash: 'witness' } }))
  const operation = { operationId: 'op', status: 'GENERATING', sourceAssetId: 'asset', sourceAssetVersionId: 'historical', targetRuntimeInstanceId: targetId,
    binding: { source: { runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', sourceHash: 'hash', sourceVersionWitnessHash: 'witness' },
      target: { runtimeInstanceId: targetId } } }
  deps.readOne.mockResolvedValue(operation)
  deps.getOperation = jest.fn(async () => ({ source: operation.binding.source, target: operation.binding.target }))
  expect((await getOutcomeSuccessorOperationByKey({ ...args, targetRuntimeInstanceId: targetId, idempotencyKey: 'key' })).status).toBe('GENERATING')
  expect(deps.getOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op', idempotent: true }))
  operation.sourceAssetVersionId = 'latest'
  await expect(getOutcomeSuccessorOperationByKey({ ...args, targetRuntimeInstanceId: targetId, idempotencyKey: 'key' })).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_IDEMPOTENCY_CONFLICT' })
})
const setupCompare = () => {
  const fixture = makeGovernedFinalisationFixture()
  const operation = { operationId: 'op', status: 'SUCCEEDED', customerId: fixture.scope.customerId, tenantId: fixture.scope.tenantId,
    sourceRuntimeInstanceId: sourceId, targetRuntimeInstanceId: fixture.runtime._id, sourceAssetId: 'asset', sourceAssetVersionId: 'historical',
    requestId: fixture.requestBinding.requestId, refs: { planId: fixture.plan.planId, sessionId: fixture.session.sessionId,
      messageId: 'message', draftId: fixture.draft.draftId, draftIterationId: fixture.iteration.draftIterationId },
    binding: { source: { runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', revisionNumber: 1,
      sourceHash: 'a'.repeat(64), sourceVersionWitnessHash: 'b'.repeat(64) }, target: { runtimeInstanceId: String(fixture.runtime._id), revisionNumber: 2 },
      intentFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64) } }
  fixture.draft.lineageSummary.successor = projectOutcomeSuccessorLineage(operation)
  fixture.iteration.lineageSummary.successor = projectOutcomeSuccessorLineage(operation)
  const records = { OutcomeSuccessorOperation: operation, OutcomeSession: fixture.session, OutcomeDraft: fixture.draft,
    OutcomeDraftIteration: fixture.iteration, OutcomeKnowledgeCompositionPlan: fixture.plan, OutcomeMessage: { messageId: 'message' } }
  const deps = { getOperation: jest.fn(async () => ({ source: operation.binding.source, target: operation.binding.target })),
    readRuntimeControl: jest.fn(async () => ({ _id: sourceId, customerId: fixture.scope.customerId, tenantId: fixture.scope.tenantId })),
    readOne: jest.fn(async (model) => records[model.modelName]), readStages: jest.fn(async () => fixture.stages),
    getSourcePreview: jest.fn(async () => ({ kind: 'APPROVED_ASSET_VERSION', title: 'Original', sections: [], markdown: 'Original qualified evidence.',
      governance: { ...operation.binding.source } })), getDraftPreview: jest.fn(async () => ({ draftId: fixture.draft.draftId,
      draftIterationId: fixture.iteration.draftIterationId, title: fixture.iteration.title, ...fixture.iteration.customerContent })) }
  return { args: { actorUserId, runtimeInstanceId: sourceId, operationId: 'op', scopes: {}, deps }, fixture, operation, deps }
}
test('comparison uses actual canonical accepted chain and exact result refs, separates governance', async () => {
  const { args, fixture, deps } = setupCompare(); fixture.iteration.warnings = ['Estimate only.']
  const result = await getOutcomeSuccessorCompare(args)
  expect(result.compareAvailable).toBe(true)
  expect(result.to.identity.draftIterationId).toBe(fixture.iteration.draftIterationId)
  expect(result.to.warnings).toEqual(['Estimate only.'])
  expect(result.governance.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'runtimeInstanceId' })]))
  expect(JSON.stringify(result.to)).not.toMatch(/governedQualityChain|provider|stageExecutionId/)
  expect(deps.getDraftPreview).toHaveBeenCalledWith(expect.objectContaining({ sessionId: fixture.session.sessionId }))
})

test('comparison forwards the exact asynchronously loaded style to its chain validator', async () => {
  const { args, fixture, deps } = setupCompare()
  // This case isolates the caller contract; it does not claim the edited legacy
  // fixture is a valid commercial chain or a genuine provider acceptance.
  fixture.stages[4].outputSnapshot.expressionProfileVersion = 'outcome-commercial-expression.v3'
  const source = Object.freeze({ available: true, content: 'Exact frozen style' })
  deps.loadPackContent = jest.fn(async () => source)
  deps.validateQualityChain = jest.fn()
  const result = await getOutcomeSuccessorCompare(args)
  const style = fixture.plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'STYLE')
  expect(deps.loadPackContent).toHaveBeenCalledWith({ packId: style.packId, versionId: style.versionId })
  expect(deps.validateQualityChain).toHaveBeenCalledWith(expect.objectContaining({ styleSource: source }))
  expect(result.compareAvailable).toBe(true)
})
test.each(['PREPARING', 'GENERATING', 'BLOCKED', 'RECOVERY_REQUIRED'])('pending %s has no fabricated target', async (status) => {
  const { args, operation, deps } = setupCompare(); operation.status = status
  expect(await getOutcomeSuccessorCompare(args)).toMatchObject({ compareAvailable: false, to: null })
  expect(deps.getDraftPreview).not.toHaveBeenCalled()
})
test.each(['source', 'session', 'iteration', 'stage'])('comparison fails exact %s mismatch', async (field) => {
  const { args, fixture, operation } = setupCompare()
  if (field === 'source') operation.binding.source.sourceHash = 'changed'
  if (field === 'session') fixture.session.contextBindings.requestPlan.requestId = 'changed'
  if (field === 'iteration') fixture.draft.currentIterationId = 'changed'
  if (field === 'stage') fixture.stages[5].outputFingerprint = 'invalid'
  await expect(getOutcomeSuccessorCompare(args)).rejects.toThrow()
})
test('operation DTO omits claim/actor/internal scope and raw blocker detail', () => {
  const result = projectOutcomeSuccessorOperation({ operationId: 'op', status: 'RECOVERY_REQUIRED', claimId: 'private-claim', actorUserId,
    source: { runtimeInstanceId: sourceId, customerId }, target: { runtimeInstanceId: targetId, tenantId }, blockerReason: 'private provider failure' })
  expect(JSON.stringify(result)).not.toMatch(/private|claimId|customerId|tenantId|actorUserId/)
  expect(result.result).toBeNull()
  expect(result.retry.allowed).toBe(false)
  expect(result.recovery.canCheckSavedWork).toBe(true)
  expect(result.links.reconcile).toMatch(/\/reconcile$/)
})
test('operation presentation retains saved request refs after readback without redispatch', async () => {
  const { args, operation, deps } = setupCompare()
  const { getOutcomeSuccessorOperationPresentation } = await import('../services/outcomeSuccessorPresentationService.js')
  const result = await getOutcomeSuccessorOperationPresentation({ ...args, idempotent: true })
  expect(result.request).toMatchObject({ planId: operation.refs.planId, sessionId: operation.refs.sessionId, messageId: operation.refs.messageId })
  expect(result.idempotent).toBe(true)
  expect(result.recovery.canCheckSavedWork).toBe(false)
  expect(result.links.reconcile).toBeNull()
  deps.readOne.mockResolvedValue(null)
  await expect(getOutcomeSuccessorOperationPresentation(args)).rejects.toMatchObject({ status: 404 })
})
test('by-key SUCCEEDED readback uses actual persisted-owner content validation and rejects corrupted result without writes', async () => {
  const { args, fixture, operation, deps } = setupCompare()
  delete deps.getOperation
  const shapedContent = buildGovernedDraftCustomerContent(fixture.stages[4])
  fixture.draft.limitations = [...shapedContent.limitations]
  fixture.iteration.limitations = [...shapedContent.limitations]
  fixture.runtime.workspaceId = 'controlled-workspace'
  fixture.runtime.stateVersion = 'controlled-state'
  const sourceRuntime = { ...fixture.runtime, _id: sourceId, revision: { revisionNumber: 1 } }
  fixture.runtime.revision = { revisionNumber: 2, rootRuntimeId: sourceId, parentRuntimeId: sourceId }
  deps.readRuntimeControl.mockImplementation(async ({ runtimeInstanceId }) => runtimeInstanceId === sourceId ? sourceRuntime : fixture.runtime)
  deps.assertRuntimePermission = jest.fn(async () => {})
  const query = (value) => ({ session() { return this }, maxTimeMS() { return this }, lean: async () => value })
  for (const [model, record] of Object.entries({ OutcomeSuccessorOperation: operation,
    OutcomeKnowledgeCompositionPlan: fixture.plan, OutcomeSession: fixture.session, OutcomeMessage: { messageId: 'message' },
    OutcomeDraft: fixture.draft, OutcomeDraftIteration: fixture.iteration })) {
    deps[model] = { findOne: jest.fn(() => query(record)) }
  }
  deps.OutcomeQualityStageExecution = { find: jest.fn(() => query(fixture.stages)) }
  deps.claimOperation = jest.fn(); deps.writeCompletionAudit = jest.fn(); deps.generateResponse = jest.fn()
  const readArgs = { ...args, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
    targetRuntimeInstanceId: String(fixture.runtime._id), idempotencyKey: 'controlled-key' }
  expect((await getOutcomeSuccessorOperationByKey(readArgs)).status).toBe('SUCCEEDED')
  fixture.iteration.customerContent.markdown = 'Changed after completion'
  await expect(getOutcomeSuccessorOperationByKey(readArgs)).rejects.toMatchObject({ details: { reason: 'OUTCOME_SUCCESSOR_RESULT_CONTENT_CHANGED' } })
  expect(deps.claimOperation).not.toHaveBeenCalled()
  expect(deps.writeCompletionAudit).not.toHaveBeenCalled()
  expect(deps.generateResponse).not.toHaveBeenCalled()
})
