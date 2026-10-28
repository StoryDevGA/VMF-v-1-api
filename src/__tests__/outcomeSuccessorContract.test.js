import { assertOutcomeSuccessorTarget, assertOutcomeSuccessorSource, assertOutcomeSuccessorCarryForward,
  hashOutcomeSuccessorValue } from '../services/outcomeSuccessorContract.js'
import { hashOutcomeKnowledgeCompositionValue } from '../services/outcomeKnowledgeCompositionPlanService.js'

const contractPacks = () => ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE'].map((packType, index) => ({
  activationId: `activation-${index}`, packId: `pack-${index}`, versionId: `version-${index}`, packType,
  packKey: ['brief', 'schema', 'style'][index], semanticVersion: '1.0.0', contentHash: `sha256:${String(index + 1).repeat(64)}`,
  lifecycleStatus: 'ACTIVE', knowledgeLayer: 'EXPRESSION', packCategory: 'OUTCOME', purposeCategory: 'SYSTEM',
  schemaVersion: '1.0.0', scopeType: 'GLOBAL', scopeKey: 'GLOBAL', executionMode: 'PROVIDER_CONTEXT',
  visibility: 'PLATFORM', workspaceCompatibility: ['OUTCOME'], relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: 'a'.repeat(64), dependencyReferences: [], stageAssignments: ['OUTPUT_SHAPING'],
}))

const runtime = (overrides = {}) => ({ _id: 'root', customerId: 'customer', tenantId: 'tenant', workspaceId: 'workspace',
  stateVersion: 'state', runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: 'package', packageKey: 'pk',
  packageVersion: '1', status: 'LOCKED', evidence: { dependencySnapshotId: 'snapshot', dependencySnapshotHash: 'hash' },
  revision: { revisionNumber: 1 }, ...overrides })
const sourceRecords = () => {
  const scope = { runtimeInstanceId: 'root', customerId: 'customer', tenantId: 'tenant', sessionId: 'session' }
  const plan = { ...scope, requestId: 'request', planId: 'plan', planFingerprint: 'fp', payload: {
    consumerIntent: { originalRequest: 'Create brief', requestedOutputTypeKey: 'brief', outcome: 'brief',
      decisionPurpose: 'decide', consumer: 'board', audience: ['board'], format: 'markdown' },
    governedContext: { outputType: { key: 'brief' }, outputSchema: { key: 'schema', hash: 's' }, style: { key: 'style', hash: 'v' } },
    resolution: { selectedPacks: contractPacks() },
  } }
  plan.planFingerprint = hashOutcomeKnowledgeCompositionValue(plan.payload)
  return { sourceRuntime: runtime(), asset: { ...scope, outcomeAssetId: 'asset', status: 'PUBLISHED', currentVersionId: 'other' },
    version: { ...scope, outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical', status: 'SUPERSEDED', versionNumber: 1,
      frameworkKey: 'VMF', packageKey: 'pk', packageVersion: '1', customerContent: { markdown: 'Original' },
      lineageSummary: { draftApproval: { operation: 'DRAFT_APPROVAL', outcomeAssetId: 'asset', outcomeAssetVersionId: 'historical',
        draftId: 'draft', draftIterationId: 'iteration', draftIterationNumber: 1, versionNumber: 1, approvedBy: 'actor', approvedAt: '2026-10-13T10:00:00Z' } } },
    session: { ...scope, contextBindings: { requestPlan: { requestId: 'request', planId: 'plan', planFingerprint: plan.planFingerprint } } },
    plan, draft: { ...scope, draftId: 'draft', status: 'APPROVED', approvedIterationId: 'iteration', approvedAssetVersionId: 'historical' },
    iteration: { ...scope, draftId: 'draft', draftIterationId: 'iteration', iterationNumber: 1, status: 'APPROVED' } }
}

describe('governed successor contract', () => {
  it.each([null, undefined, ''].flatMap((sourceWorkspace) => [null, undefined, '']
    .map((targetWorkspace) => [sourceWorkspace, targetWorkspace])))(
    'preserves absent workspace scope %j / %j within the same canonical family', (sourceWorkspace, targetWorkspace) => {
    const sourceRuntime = runtime({ workspaceId: sourceWorkspace })
    for (const targetRuntime of [runtime({ workspaceId: targetWorkspace }), runtime({ _id: 'new',
      workspaceId: targetWorkspace, revision: { revisionNumber: 2, rootRuntimeId: 'root', parentRuntimeId: 'root' } })]) {
      const result = assertOutcomeSuccessorTarget({ sourceRuntime, targetRuntime })
      expect(result.source.workspaceId).toBe('')
      expect(result.target.workspaceId).toBe('')
    }
  })
  it.each([null, undefined, ''])('rejects one-sided workspace presence %j in either direction', (absent) => {
    for (const [sourceWorkspace, targetWorkspace] of [[absent, 'workspace'], ['workspace', absent]]) {
      expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime({ workspaceId: sourceWorkspace }),
        targetRuntime: runtime({ workspaceId: targetWorkspace }) })).toThrow()
    }
  })
  it.each([1, {}, [], false])('rejects malformed workspace identity %j rather than coercing it', (workspaceId) => {
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime({ workspaceId }), targetRuntime: runtime() })).toThrow()
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime({ workspaceId }) })).toThrow()
  })
  it.each([
    { customerId: 'foreign' }, { tenantId: 'foreign' }, { packageId: 'foreign' },
    { packageVersion: '2' }, { status: 'ACTIVE' }, { evidence: {} },
    { _id: 'new', revision: { revisionNumber: 2, rootRuntimeId: 'foreign', parentRuntimeId: 'foreign' } },
    { _id: 'new', revision: { revisionNumber: 2 } },
  ])('retains strict boundaries when both workspaces are absent %j', (overrides) => {
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime({ workspaceId: '' }),
      targetRuntime: runtime({ workspaceId: null, ...overrides }) })).toThrow()
  })
  it.each([null, undefined, ''])('accepts an approved source with absent workspace %j without changing source', (workspaceId) => {
    const records = sourceRecords(); records.sourceRuntime.workspaceId = workspaceId
    const witness = JSON.stringify(records)
    expect(assertOutcomeSuccessorSource(records).source.workspaceId).toBe('')
    expect(JSON.stringify(records)).toBe(witness)
  })
  it('keeps same revision and permits an explicit newer member of the same family', () => {
    expect(assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime() }).target.revisionNumber).toBe(1)
    expect(assertOutcomeSuccessorTarget({ sourceRuntime: runtime({ revision: { revisionNumber: 1, rootRuntimeId: 'root' } }),
      targetRuntime: runtime({ revision: { revisionNumber: 1, rootRuntimeId: 'root' } }) }).target.rootRuntimeId).toBe('root')
    expect(assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime({ _id: 'new',
      revision: { revisionNumber: 2, rootRuntimeId: 'root', parentRuntimeId: 'root' } }) }).target.runtimeInstanceId).toBe('new')
  })
  it.each(['customerId', 'tenantId', 'workspaceId'])('rejects different %s', (field) => {
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime({ [field]: 'other' }) }))
      .toThrow('governed successor boundary')
  })
  it.each(['frameworkKey', 'packageId', 'packageKey', 'packageVersion'])('rejects material %s change', (field) => {
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime({ [field]: 'other' }) }))
      .toThrow('Create a new asset')
  })
  it.each([
    { _id: 'other', revision: { revisionNumber: 1 } },
    { _id: 'other', revision: { revisionNumber: 2, rootRuntimeId: 'fork', parentRuntimeId: 'fork' } },
    { _id: 'other', revision: { revisionNumber: 2 } },
    { status: 'ACTIVE' }, { workspaceId: '' }, { evidence: {} },
    { revision: { revisionNumber: 1, parentRuntimeId: 'parent' } },
    { revision: { revisionNumber: 1, rootRuntimeId: 'foreign' } },
  ])('rejects incomplete/older/fork/unlocked target %j', (target) => {
    expect(() => assertOutcomeSuccessorTarget({ sourceRuntime: runtime(), targetRuntime: runtime(target) })).toThrow()
  })
  it('accepts the selected historical approved version of a published source without mutating it', () => {
    const records = sourceRecords()
    const witness = JSON.stringify(records)
    expect(assertOutcomeSuccessorSource(records).sourceAssetVersionId).toBe('historical')
    expect(JSON.stringify(records)).toBe(witness)
  })
  it.each(['warnings', 'limitations', 'updatedAt'])('binds complete selected version witness including %s', (field) => {
    const records = sourceRecords(); const first = assertOutcomeSuccessorSource(records)
    records.version[field] = field === 'updatedAt' ? '2026-10-13T11:00:00Z' : ['Qualified source boundary']
    const second = assertOutcomeSuccessorSource(records)
    expect(second.sourceVersionWitnessHash).not.toBe(first.sourceVersionWitnessHash)
    expect(second.sourceHash).toBe(first.sourceHash)
  })
  it.each(['asset', 'version', 'session', 'plan', 'draft', 'iteration'])('rejects cross-scope %s', (field) => {
    const records = sourceRecords(); records[field].customerId = 'other'
    expect(() => assertOutcomeSuccessorSource(records)).toThrow()
  })
  it('rejects forged approval and missing intent', () => {
    const records = sourceRecords(); records.iteration.status = 'CURRENT'
    expect(() => assertOutcomeSuccessorSource(records)).toThrow()
    records.iteration.status = 'APPROVED'; delete records.plan.payload.consumerIntent.originalRequest
    expect(() => assertOutcomeSuccessorSource(records)).toThrow()
  })
  it('requires exact intent and schema/style carry-forward', () => {
    const { plan } = sourceRecords(); const candidate = structuredClone(plan)
    expect(() => assertOutcomeSuccessorCarryForward({ sourcePlan: plan, candidate })).not.toThrow()
    candidate.payload.governedContext.style.hash = 'changed'
    expect(() => assertOutcomeSuccessorCarryForward({ sourcePlan: plan, candidate })).toThrow()
    candidate.payload = structuredClone(plan.payload); candidate.payload.consumerIntent.originalRequest = 'changed'
    expect(() => assertOutcomeSuccessorCarryForward({ sourcePlan: plan, candidate })).toThrow()
  })
  it.each(['activationId', 'packId', 'versionId', 'semanticVersion', 'contentHash'])('rejects changed frozen %s despite same display descriptor', (field) => {
    const { plan } = sourceRecords(); const candidate = structuredClone(plan)
    candidate.payload.resolution.selectedPacks[1][field] = field === 'contentHash' ? `sha256:${'f'.repeat(64)}` : 'changed'
    expect(() => assertOutcomeSuccessorCarryForward({ sourcePlan: plan, candidate })).toThrow()
  })
  it.each(['status', 'approvedIterationId', 'approvedAssetVersionId'])('rejects invalid persisted draft approval %s', (field) => {
    const records = sourceRecords(); records.draft[field] = 'changed'
    expect(() => assertOutcomeSuccessorSource(records)).toThrow()
  })
  it('rejects missing frozen proof and wrong persisted approval numbers', () => {
    const records = sourceRecords(); records.plan.payload.resolution.selectedPacks = []
    expect(() => assertOutcomeSuccessorSource(records)).toThrow()
    const second = sourceRecords(); second.iteration.iterationNumber = 2
    expect(() => assertOutcomeSuccessorSource(second)).toThrow()
    const third = sourceRecords(); third.version.versionNumber = 2
    expect(() => assertOutcomeSuccessorSource(third)).toThrow()
  })
  it('canonical fingerprints ignore object key order and detect content changes', () => {
    expect(hashOutcomeSuccessorValue({ a: 1, b: 2 })).toBe(hashOutcomeSuccessorValue({ b: 2, a: 1 }))
    expect(hashOutcomeSuccessorValue({ a: 1 })).not.toBe(hashOutcomeSuccessorValue({ a: 2 }))
  })
})
