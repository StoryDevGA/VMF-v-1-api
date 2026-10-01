import { projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { describe, expect, jest, test } from '@jest/globals'
import { makeSs040Fixture } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { readRuntimeEvidenceToMeaningContract, projectRuntimeEvidenceToMeaningReadiness,
  assertRuntimeEvidenceToMeaningReady } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { assembleOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'
import { EVIDENCE_TO_MEANING_PROVIDER_VERSION } from '../services/outcomeEvidenceToMeaningProviderService.js'

const fixture = () => {
  const input = makeSs040Fixture()
  const payload = { runtime: input.composition.runtimeBinding,
    lockedTruth: input.composition.truthBinding, consumerIntent: input.composition.requestBinding,
    resolution: { selectedPacks: Object.values(input.selectedTarget.receipt.contractIdentity).map((item) => item.selection) },
    governedContext: { outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
      outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' } } }
  input.composition.truthBinding = { lockedTruth: payload.lockedTruth, frameworkHandoff: null }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(payload)
  input.composition.requestBinding = { ...payload.consumerIntent, requestId: '' }
  const contract = compileEvidenceToMeaningContract(input)
  payload.evidenceToMeaning = { contractVersion: contract.contractVersion,
    contractId: contract.contractId, contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  return { plan: { payload }, contract, input }
}
describe('SS-040 immutable plan receipt and pre-provider gate', () => {
  test.each(['RECORDS_CHANGED', 'PAGE_MISSING_OR_INVALID', 'DUPLICATE_OR_UNORDERED_RECORD',
    'OUTCOME_EVIDENCE_SCOPE_MISMATCH', 'CONTROL_CHANGED'])('preserves sanitized snapshot failure %s before provider execution', async (suffix) => {
    const { plan } = fixture(), provider = jest.fn(), session = { id: 'session' }
    const code = `OUTCOME_EVIDENCE_SNAPSHOT_${suffix}`
    const read = jest.fn().mockRejectedValue(Object.assign(new Error('private raw message'), { code,
      details: { snapshotReceipt: { completeness: 'COMPLETE', overallHash: 'a'.repeat(64),
        collections: { evidence: { totalCount: 853, records: [{ secret: 'private' }] } }, secret: 'private' } } }))
    const failure = await (async () => {
      await assertRuntimeEvidenceToMeaningReady({ plan, session, deps: { readOutcomeEvidenceContractSnapshot: read } })
      provider()
    })().catch((error) => error)
    expect(failure.details.reason).toBe(code)
    expect(failure.details.clarification.firstBoundary).toBe(code)
    expect(failure.details.snapshotReadiness).toEqual({ reason: code, completeness: 'INCOMPLETE',
      totalEvidenceCount: 853, overallHash: 'a'.repeat(64) })
    expect(JSON.stringify(failure.details)).not.toContain('private')
    expect(provider).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ session }))
  })
  test('unknown snapshot errors and malformed receipt metadata remain safely generic', async () => {
    const { plan } = fixture()
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot:
      jest.fn().mockRejectedValue({ code: 'api_key=synthetic-secret', details: { snapshotReceipt: {
        overallHash: 'private', collections: { evidence: { totalCount: -1 } } } } }) } }))
      .rejects.toMatchObject({ details: { reason: 'SOURCE_SNAPSHOT_UNAVAILABLE', snapshotReadiness: {
        completeness: 'INCOMPLETE', totalEvidenceCount: null, overallHash: '' } } })
  })
  test('request-scoped generation needs a declared provider contract and exact stored representation fields', async () => {
    const { plan, input } = fixture()
    plan.payload.requestId = '557d3e2e-3adb-4cb4-b71a-a4c256f2f878'
    input.composition.requestBinding.requestId = plan.payload.requestId
    const setReceipt = () => {
      const contract = compileEvidenceToMeaningContract(input)
      plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
        contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    }
    setReceipt()
    expect(projectRuntimeEvidenceToMeaningReadiness(plan).canExecute).toBe(false)
    const read = jest.fn().mockResolvedValue(input.sourceSnapshot)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: read } }))
      .rejects.toMatchObject({ details: { reason: 'PROVIDER_CONTRACT_REQUIRED_RE_RESOLVE_REQUEST' } })
    expect(read).not.toHaveBeenCalled()
    input.composition.providerCompatibility = { contractVersion: EVIDENCE_TO_MEANING_PROVIDER_VERSION, status: 'READY' }
    setReceipt()
    expect(projectRuntimeEvidenceToMeaningReadiness(plan).canExecute).toBe(true)
    delete input.sourceSnapshot.evidenceObjects[0].evidenceRequiredToSubstantiate
    setReceipt()
    expect(projectRuntimeEvidenceToMeaningReadiness(plan).canExecute).toBe(false)
  })
  test('persisted JSON survives source identity and timestamp fields', () => {
    const { plan, contract } = fixture()
    expect(readRuntimeEvidenceToMeaningContract(JSON.parse(JSON.stringify(plan)))).toEqual(contract)
    expect(projectRuntimeEvidenceToMeaningReadiness(plan).canExecute).toBe(true)
    expect(projectRuntimeEvidenceToMeaningReadiness(plan)).not.toHaveProperty('inputs')
    expect(projectRuntimeEvidenceToMeaningReadiness(plan)).not.toHaveProperty('contractJson')
  })
  test('legacy missing receipt requires explicit re-resolution', async () => {
    const provider = jest.fn()
    const read = jest.fn()
    await expect((async () => { await assertRuntimeEvidenceToMeaningReady({ plan: { payload: {} },
      deps: { readOutcomeEvidenceContractSnapshot: read } }); provider() })()).rejects.toMatchObject({
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: { reason: 'CONTRACT_REQUIRED_RE_RESOLVE_REQUEST' } })
    expect(provider).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
  })
  test.each(['runtime', 'lockedTruth', 'consumerIntent', 'resolution', 'governedContext'])('valid contract cannot be rebound to another %s', (field) => {
    const { plan } = fixture();
    if (field === 'resolution') plan.payload.resolution.selectedPacks[0].contentHash = 'changed'
    else if (field === 'governedContext') plan.payload.governedContext.outputSchema.key = 'changed'
    else plan.payload[field].changed = 'changed'
    expect(() => readRuntimeEvidenceToMeaningContract(plan)).toThrow()
  })
  test('optional omission stays executable; unresolved required section stops before source/provider', async () => {
    const { plan, input } = fixture()
    delete input.sourceSnapshot.evidenceObjects[0].proofDependency
    const contract = compileEvidenceToMeaningContract(input)
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    const read = jest.fn(); const provider = jest.fn()
    await expect((async () => { await assertRuntimeEvidenceToMeaningReady({ plan,
      deps: { readOutcomeEvidenceContractSnapshot: read } }); provider() })()).rejects.toMatchObject({
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: { contractHash: contract.contractHash } })
    expect(read).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled()
  })
  test('session-bound re-read rejects source drift even without runtime updatedAt changes', async () => {
    const { plan, input } = fixture(); const session = { id: 'isolated-session' }
    const scopes = { selected: 'isolated-tenant' }
    const read = jest.fn().mockResolvedValue(input.sourceSnapshot)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, scopes, session,
      deps: { readOutcomeEvidenceContractSnapshot: read } })).resolves.toMatchObject({ status: 'READY' })
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ scopes, session }))
    input.sourceSnapshot.evidenceObjects[0]._id = 'another-stored-identity'
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, scopes, session,
      deps: { readOutcomeEvidenceContractSnapshot: read } })).rejects.toMatchObject({
      details: { reason: 'SOURCE_SNAPSHOT_CHANGED_RE_RESOLVE_REQUEST' } })
  })
  test('corrupt receipt and source outage fail closed', async () => {
    const { plan } = fixture(); plan.payload.evidenceToMeaning.contractJson += 'invalid'
    expect(() => readRuntimeEvidenceToMeaningContract(plan)).toThrow()
    const valid = fixture().plan
    await expect(assertRuntimeEvidenceToMeaningReady({ plan: valid,
      deps: { readOutcomeEvidenceContractSnapshot: jest.fn().mockRejectedValue(new Error('Unavailable')) } })).rejects.toMatchObject({
      details: { reason: 'SOURCE_SNAPSHOT_UNAVAILABLE' } })
  })
})

const sectionGapFixture = async ({ contradictionReferences = [], sectionGap = true } = {}) => {
  const { plan, input } = fixture()
  const scope = { customerId: 'customer', tenantId: 'tenant', runtimeInstanceId: 'runtime-id-1', stateVersion: 'version' }
  const evidence = input.sourceSnapshot.evidenceObjects.map((row, index) => ({ ...row, ...scope, _id: String(index).padStart(6, '0') }))
  const sources = input.sourceSnapshot.sourceRegistry.map((row, index) => ({ ...row, ...scope, _id: 'source-' + index }))
  const sections = ['current_state_assessment', 'evidence_register', 'strategic_objectives']
    .map((sectionKey) => ({ sectionKey, references: [...(sectionGap ? ['scoped_view'] : []), evidence[0].evidenceObjectId] }))
  const rows = { evidence, sources }
  const result = await assembleOutcomeEvidenceInventory({ scope, sections, contradictionReferences,
    count: async (kind) => rows[kind].length,
    readPage: async (kind, after, limit) => rows[kind].filter((row) => !after || row._id > after).slice(0, limit),
    validateRows: () => {},
  })
  input.sourceSnapshot = { ...input.sourceSnapshot, evidenceObjects: result.evidenceObjects,
    sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
  const contract = compileEvidenceToMeaningContract(input)
  plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  return { plan, contract }
}
describe('precise recovery from immutable persisted section coverage', () => {
  test.each([false, true])('keeps contradiction recovery with section gaps=%s', async (sectionGap) => {
    const { plan, contract } = await sectionGapFixture({ sectionGap, contradictionReferences: ['missing-contradiction', 'source-1'] })
    const original = JSON.stringify(plan.payload.evidenceToMeaning)
    const readiness = projectRuntimeEvidenceToMeaningReadiness(plan)
    expect(readiness.canExecute).toBe(false)
    expect(readiness.clarification.missingFields).toContain('contradictionReferences.missing-contradiction')
    const question = readiness.clarification.questions.find((entry) => entry.field === 'contradictionReferences.missing-contradiction')
    expect(question.missingReference).toBe('missing-contradiction')
    expect(question).not.toHaveProperty('sourceSectionKey')
    expect(readiness.clarification.questions).toHaveLength(sectionGap ? 4 : 1)
    expect(projectRuntimeEvidenceToMeaningReadiness(plan)).toEqual(readiness)
    expect(JSON.stringify(plan.payload.evidenceToMeaning)).toBe(original)
    expect(readRuntimeEvidenceToMeaningContract(plan).contractHash).toBe(contract.contractHash)
  })
  test('derives exact three source section gaps without changing the original receipt or hash', async () => {
    const { plan, contract } = await sectionGapFixture()
    const original = JSON.stringify(plan.payload.evidenceToMeaning)
    const one = projectRuntimeEvidenceToMeaningReadiness(plan)
    expect(one.clarification.firstBoundary).toBe('sourceSnapshot.SECTION_REFERENCE_UNRESOLVED')
    expect(one.clarification.affectedSections.map((section) => section.sourceSectionKey)).toEqual([
      'current_state_assessment', 'evidence_register', 'strategic_objectives'])
    expect(one.clarification.affectedSections.every((section) => section.missingReferences[0] === 'scoped_view')).toBe(true)
    expect(one.clarification.questions).toHaveLength(3)
    expect(one.clarification.questions[0]).toMatchObject({ sourceSectionKey: 'current_state_assessment', missingReference: 'scoped_view' })
    expect(one.canExecute).toBe(false)
    expect(projectRuntimeEvidenceToMeaningReadiness(plan)).toEqual(one)
    expect(JSON.stringify(plan.payload.evidenceToMeaning)).toBe(original)
    expect(readRuntimeEvidenceToMeaningContract(plan).contractHash).toBe(contract.contractHash)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan })).rejects.toMatchObject({ details: { clarification: {
      affectedSections: one.clarification.affectedSections, questions: one.clarification.questions } } })
  })
  test('does not enrich another boundary or fabricate source section mappings', () => {
    const { plan, contract } = fixture()
    expect(projectRuntimeEvidenceToMeaningReadiness(plan).clarification).toEqual(contract.clarification)
  })
  test('rejects tampered persisted coverage before projecting authoritative recovery references', async () => {
    const { plan, contract } = await sectionGapFixture()
    contract.inputs.sourceSnapshot.inventoryReceipt.sectionCoverage[0].missingReferences.push('forged')
    plan.payload.evidenceToMeaning.contractJson = JSON.stringify(contract)
    expect(() => projectRuntimeEvidenceToMeaningReadiness(plan)).toThrow()
  })
})
