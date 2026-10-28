import { jest } from '@jest/globals'
import { getOutcomeSuccessorPreflight, OUTCOME_SUCCESSOR_CONTROL_PROJECTION } from '../services/outcomeSuccessorService.js'
import { hashOutcomeKnowledgeCompositionValue } from '../services/outcomeKnowledgeCompositionPlanService.js'

const customerId = '6a0000000000000000000001'
const tenantId = '6a0000000000000000000002'
const sourceId = '6a0000000000000000000003'
const targetId = '6a0000000000000000000004'
const actorUserId = '6a0000000000000000000005'
const setup = () => {
  const scope = { customerId, tenantId, runtimeInstanceId: sourceId, sessionId: 'session' }
  const runtime = { _id: sourceId, customerId, tenantId, workspaceId: 'workspace', stateVersion: 'state',
    runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: 'package', packageKey: 'pk', packageVersion: '1',
    status: 'LOCKED', revision: { revisionNumber: 1 }, evidence: { dependencySnapshotId: 'snapshot', dependencySnapshotHash: 'hash' }, updatedAt: '2026-10-13' }
  const target = { ...runtime, _id: targetId, stateVersion: 'state2', revision: { revisionNumber: 2, rootRuntimeId: sourceId, parentRuntimeId: sourceId } }
  const plan = { ...scope, requestId: 'request', planId: 'plan', planFingerprint: 'fp', payload: {
    consumerIntent: { originalRequest: 'Original request', requestedOutputTypeKey: 'brief', outcome: 'brief',
      decisionPurpose: 'decide', consumer: 'board', audience: ['board'], format: 'markdown' },
    governedContext: { outputType: { key: 'brief' }, outputSchema: { key: 'schema' }, style: { key: 'style' } },
    resolution: { selectedPacks: ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE'].map((packType, index) => ({
      activationId: `activation-${index}`, packId: `pack-${index}`, versionId: `version-${index}`, packType,
      packKey: ['brief', 'schema', 'style'][index], semanticVersion: '1.0.0', contentHash: `sha256:${String(index + 1).repeat(64)}`,
    })) } } }
  plan.planFingerprint = hashOutcomeKnowledgeCompositionValue(plan.payload)
  const records = [
    { ...scope, outcomeAssetId: 'asset', status: 'PUBLISHED' },
    { ...scope, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', versionNumber: 1, status: 'SUPERSEDED',
      frameworkKey: 'VMF', packageKey: 'pk', packageVersion: '1', customerContent: { markdown: 'original' },
      lineageSummary: { draftApproval: { operation: 'DRAFT_APPROVAL', outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
        draftId: 'draft', draftIterationId: 'iteration', draftIterationNumber: 1, versionNumber: 1, approvedBy: actorUserId, approvedAt: '2026-10-13T10:00:00Z' } } },
    { ...scope, contextBindings: { requestPlan: { requestId: 'request', planId: 'plan', planFingerprint: plan.planFingerprint } } },
    plan, { ...scope, draftId: 'draft', status: 'APPROVED', approvedIterationId: 'iteration', approvedAssetVersionId: 'historical' },
    { ...scope, draftId: 'draft', draftIterationId: 'iteration', iterationNumber: 1, status: 'APPROVED' },
  ]
  let position = 0
  const deps = { readRuntimeControl: jest.fn(async ({ runtimeInstanceId }) => runtimeInstanceId === targetId ? target : runtime),
    assertRuntimePermission: jest.fn(async () => {}), readOne: jest.fn(async () => records[position++]),
    assertPlanIntegrity: jest.fn(), listTargets: jest.fn(async () => []),
    buildCandidate: jest.fn(async () => ({ ...structuredClone(plan), planFingerprint: 'candidate' })),
    projectReadiness: jest.fn(() => ({ status: 'READY_TO_DRAFT', canExecute: true })) }
  const args = { actorUserId, runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
    scopes: { marker: 'selected-scope' }, deps }
  return { args, deps, runtime, target, records }
}
describe('passive successor preflight', () => {
  it.each([null, undefined, '', 'workspace'])('keeps bounded family target discovery scoped to optional workspace %j', async (workspaceId) => {
    const { args, deps, runtime, target, records } = setup()
    runtime.workspaceId = workspaceId; target.workspaceId = workspaceId
    const witness = JSON.stringify(records)
    const result = await getOutcomeSuccessorPreflight({ ...args, targetRuntimeInstanceId: targetId })
    expect(result.source.workspaceId).toBe(workspaceId || '')
    expect(result.target.workspaceId).toBe(workspaceId || '')
    expect(deps.listTargets).toHaveBeenCalledWith(expect.objectContaining({
      filter: { customerId, tenantId, workspaceId: workspaceId || { $in: [null, ''] },
        'revision.rootRuntimeId': sourceId, 'revision.revisionNumber': { $gt: 1 } },
      limit: 21, maxTimeMS: 2000,
    }))
    expect(JSON.stringify(records)).toBe(witness)
    expect(deps.assertRuntimePermission).toHaveBeenCalledTimes(2)
  })
  it('does not expose a present foreign workspace candidate for an absent source', async () => {
    const { args, deps, runtime, target } = setup(); runtime.workspaceId = ''
    deps.listTargets.mockResolvedValue([target])
    const result = await getOutcomeSuccessorPreflight(args)
    expect(result.targets[0]).toMatchObject({ eligible: false, blocker: 'OUTCOME_SUCCESSOR_SCOPE_MISMATCH' })
    expect(deps.assertRuntimePermission).toHaveBeenCalledTimes(2)
  })
  it('defaults to source, binds exact historical lookup and preserves source records', async () => {
    const { args, deps, records } = setup(); const witness = JSON.stringify(records)
    const result = await getOutcomeSuccessorPreflight(args)
    expect(result.target.runtimeInstanceId).toBe(sourceId)
    expect(result.targetExplicitlySelected).toBe(false)
    expect(result.confirmation.executable).toBe(false)
    expect(result.source.sourceVersionWitnessHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.source.customerContent).toBeUndefined()
    expect(result.source.lineageSummary).toBeUndefined()
    expect(deps.readOne.mock.calls[1][1]).toEqual(expect.objectContaining({ customerId, tenantId,
      runtimeInstanceId: sourceId, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical' }))
    expect(JSON.stringify(records)).toBe(witness)
    expect(OUTCOME_SUCCESSOR_CONTROL_PROJECTION).toContain('revision.rootRuntimeId')
    expect(OUTCOME_SUCCESSOR_CONTROL_PROJECTION).not.toContain('framework_state')
  })
  it('authorizes explicit target and forwards accepted-evidence owner to candidate builder', async () => {
    const { args, deps } = setup()
    const result = await getOutcomeSuccessorPreflight({ ...args, targetRuntimeInstanceId: targetId })
    expect(result.target.runtimeInstanceId).toBe(targetId)
    expect(deps.assertRuntimePermission).toHaveBeenCalledTimes(2)
    const call = deps.buildCandidate.mock.calls[0][0]
    expect(call.consumerIntent.originalRequest).toBe('Original request')
    expect(call.deps.readKcpRuntimeEvidence).toBeInstanceOf(Function)
    expect(call.requestScope.requestId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/)
  })
  it('propagates rejected authorization and candidate reads without empty success', async () => {
    const { args, deps } = setup(); deps.assertRuntimePermission.mockRejectedValue(new Error('denied'))
    await expect(getOutcomeSuccessorPreflight(args)).rejects.toThrow('denied')
    expect(deps.readOne).not.toHaveBeenCalled()
    const next = setup(); next.deps.buildCandidate.mockRejectedValue(new Error('evidence unavailable'))
    await expect(getOutcomeSuccessorPreflight(next.args)).rejects.toThrow('evidence unavailable')
  })
  it('retains blocked readiness and rejects a schema changed by current resolver', async () => {
    const { args, deps } = setup(); deps.projectReadiness.mockReturnValue({ status: 'CLARIFICATION_REQUIRED', canExecute: false })
    expect((await getOutcomeSuccessorPreflight(args)).status).toBe('BLOCKED')
    const next = setup(); next.deps.buildCandidate.mockImplementation(async () => {
      const candidate = structuredClone(next.records[3]); candidate.payload.governedContext.outputSchema.key = 'changed'; return candidate
    })
    await expect(getOutcomeSuccessorPreflight(next.args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_OUTPUT_CONTRACT_CHANGED' })
  })
  it('records listing cap and authorizes visible candidates', async () => {
    const { args, deps, target } = setup(); deps.listTargets.mockResolvedValue(Array.from({ length: 21 }, () => target))
    const result = await getOutcomeSuccessorPreflight(args)
    expect(result.targets).toHaveLength(20)
    expect(result.targetList.limitReached).toBe(true)
    expect(deps.listTargets).toHaveBeenCalledWith(expect.objectContaining({ limit: 21, maxTimeMS: 2000 }))
    expect(deps.assertRuntimePermission).toHaveBeenCalledTimes(21)
  })
  it('rejects unknown candidate readiness and invalid actors', async () => {
    const { args, deps } = setup(); deps.projectReadiness.mockReturnValue(null)
    await expect(getOutcomeSuccessorPreflight(args)).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_EVIDENCE_UNASSESSED' })
    await expect(getOutcomeSuccessorPreflight({ ...args, actorUserId: '' })).rejects.toMatchObject({ status: 401 })
  })
})
