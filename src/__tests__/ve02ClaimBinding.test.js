import { expect, jest, test } from '@jest/globals'
import { resolveVE02ClaimBinding } from '../services/runtimeValidation/ve02ClaimBinding.js'
import { hashEvidenceToMeaningValue, matchesEvidenceToMeaningFrozenRecord } from '../services/outcomeEvidenceToMeaningContractService.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { makeSs041Fixture } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { hashOutcomeKnowledgeCompositionSemanticValue, assertOutcomeKnowledgeCompositionPlanIntegrity } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION, OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'

const evidence = { evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'Exact claim.' }
const source = { sourceId: 'source-1', contentHash: 'exact-material' }
const context = { runtimeId: 'runtime-1', customerId: 'customer-1', tenantId: 'tenant-1', stateVersion: 'revision-1',
  packageKey: 'package-1', packageVersion: '1.0', evidence, source }
const binding = { planId: 'plan-1', requestId: 'request-1', claimKey: 'claim-1' }
const scope = { runtimeInstanceId: context.runtimeId, customerId: context.customerId, tenantId: context.tenantId,
  stateVersion: context.stateVersion }
const claim = { ...binding, evidenceReference: evidence.evidenceObjectId, sourceReference: source.sourceId,
  statement: evidence.extractedFact, evidenceHash: hashEvidenceToMeaningValue(evidence), sourceHash: hashEvidenceToMeaningValue(source),
  restriction: 'EXACT_STATEMENT_ONLY', admission: 'SOURCE_PRESENTED_UNVERIFIED' }
const contract = () => ({ contractHash: 'contract-hash', inputs: { sourceSnapshot: { inventoryReceipt: { scope } } },
  customerClaims: [claim] })
const plan = { ...binding, planFingerprint: 'plan-hash' }
const dependencies = (changes = {}) => ({ readPlan: jest.fn(async () => plan), assertPlan: jest.fn(), readContract: contract, ...changes })
const read = (deps = dependencies(), changes = {}) => resolveVE02ClaimBinding({ context, binding, statement: evidence.extractedFact,
  session: { inTransaction: () => true }, dependencies: deps, ...changes })

test('frozen records tolerate only monotonic mechanical version fences and preserve the original hash', () => {
  const frozen = { ...evidence, __v: 0 }, expectedHash = hashEvidenceToMeaningValue(frozen)
  expect(matchesEvidenceToMeaningFrozenRecord({ frozen, expectedHash, current: { ...frozen, __v: 4 } })).toBe(true)
  for (const change of [{ __v: -1 }, { __v: 0.5 }, { __v: '1' }, { __v: 4, extractedFact: 'Changed' },
    { __v: 4, updatedAt: 'Changed' }, { __v: 4, sourceLocation: 'New' }]) {
    expect(matchesEvidenceToMeaningFrozenRecord({ frozen, expectedHash, current: { ...frozen, ...change } })).toBe(false)
  }
  expect(matchesEvidenceToMeaningFrozenRecord({ frozen: { ...frozen, extractedFact: 'Forged' }, expectedHash,
    current: { ...frozen, __v: 4 } })).toBe(false)
  expect(matchesEvidenceToMeaningFrozenRecord({ frozen: evidence, expectedHash: hashEvidenceToMeaningValue(evidence),
    current: { ...evidence, __v: 4 } })).toBe(false)
})

test('queries exact authorised scope and returns bounded condition without hypothesis authority', async () => {
  const deps = dependencies()
  expect(await read(deps)).toMatchObject({ status: 'CURRENT_SAVED_CONDITION', restriction: 'EXACT_STATEMENT_ONLY',
    admission: 'SOURCE_PRESENTED_UNVERIFIED', hypothesisAuthority: false })
  expect(deps.readPlan).toHaveBeenCalledWith({ planId: binding.planId, requestId: binding.requestId,
    runtimeInstanceId: context.runtimeId, customerId: context.customerId, tenantId: context.tenantId,
    packageKey: context.packageKey, packageVersion: context.packageVersion })
})
test.each(['state', 'scope', 'claim', 'statement', 'evidenceHash', 'sourceHash', 'restriction', 'integrity'])('rejects changed %s', async (kind) => {
  const changed = structuredClone(contract())
  if (kind === 'state') changed.inputs.sourceSnapshot.inventoryReceipt.scope.stateVersion = 'changed'
  if (kind === 'scope') changed.inputs.sourceSnapshot.inventoryReceipt.scope.tenantId = 'different'
  if (kind === 'claim') changed.customerClaims.push(claim)
  if (kind === 'statement') changed.customerClaims[0].statement = 'Different'
  if (kind === 'evidenceHash' || kind === 'sourceHash' || kind === 'restriction') changed.customerClaims[0][kind] = 'changed'
  const status = ['state', 'scope', 'statement', 'evidenceHash', 'sourceHash', 'restriction'].includes(kind) ? 409 : 422
  await expect(read(dependencies({ readContract: () => changed,
    ...(kind === 'integrity' ? { assertPlan: () => { throw new Error('Tampered') } } : {}) }))).rejects.toMatchObject({ status })
})
test('missing plan and transaction fail closed; absent optional binding grants nothing', async () => {
  await expect(read(dependencies({ readPlan: async () => null }))).rejects.toMatchObject({ status: 404 })
  await expect(read(dependencies(), { session: null })).rejects.toMatchObject({ code: 'VE02_CLAIM_SNAPSHOT_REQUIRED' })
  expect(await read(dependencies(), { binding: undefined })).toBeNull()
})

test('binds a compiled saved ledger using both real plan and result-contract integrity validators', async () => {
  const input = await makeSs041Fixture()
  const runtime = { ...input.composition.runtimeBinding, customerId: 'customer', tenantId: 'tenant' }
  const lockedTruth = { ...input.composition.truthBinding, publishSnapshotId: 'publish-fixture',
    lockSnapshotId: 'lock-fixture', replayAnchorId: 'replay-fixture', dependencySnapshotId: 'dependency-fixture',
    acceptedSections: [{ sectionKey: 'executive-summary', runtimePath: 'framework_state.sections.executive-summary', truthHash: `sha256:${'a'.repeat(64)}` }] }
  const requestId = '123e4567-e89b-42d3-a456-426614174000'
  const selectedPacks = Object.values(input.selectedTarget.receipt.contractIdentity).map(item => item.selection)
  const resolution = { selectedPacks, consideredPacks: selectedPacks }
  const governedContext = { outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
    outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' } }
  const payload = { contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION, status: 'READY', runtime, lockedTruth,
    requestId, consumerIntent: input.composition.requestBinding, resolution, governedContext, optionalGapCount: 0,
    stagePlan: OUTCOME_QUALITY_STAGE_SEQUENCE.map((stageKey, index) => ({ stageKey, order: index + 1, assignedActivationIds: [] })) }
  input.composition.runtimeBinding = runtime
  input.composition.truthBinding = { lockedTruth, frameworkHandoff: null }
  input.composition.requestBinding = { ...payload.consumerIntent, requestId }
  const hash = hashOutcomeKnowledgeCompositionSemanticValue
  const resolutionFingerprint = hash({ resolution: {}, selectedPacks, consideredPacks: selectedPacks }), contextFingerprint = hash(governedContext)
  payload.resolution.resolutionFingerprint = resolutionFingerprint
  payload.governedContext.contextFingerprint = contextFingerprint
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(payload)
  const compiled = compileEvidenceToMeaningContract(input)
  payload.evidenceToMeaning = { contractVersion: compiled.contractVersion, contractId: compiled.contractId,
    contractHash: compiled.contractHash, contractJson: JSON.stringify(compiled) }
  const saved = { _id: 'fixture-record', planId: 'outcome_kcp_123e4567-e89b-42d3-a456-426614174000', planVersion: 1,
    contractVersion: payload.contractVersion, status: payload.status, ...runtime, requestId,
    requestedOutputTypeKey: payload.consumerIntent.requestedOutputTypeKey,
    ...Object.fromEntries(['publishSnapshotId', 'lockSnapshotId', 'replayAnchorId', 'dependencySnapshotId'].map(key => [key, lockedTruth[key]])),
    planFingerprint: hash(payload), resolutionFingerprint, contextFingerprint,
    selectedPackCount: selectedPacks.length, consideredPackCount: selectedPacks.length, gapCount: 0, payload }
  expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(saved)).not.toThrow()
  const exactClaim = compiled.customerClaims[0]
  const selectedEvidence = input.sourceSnapshot.evidenceObjects.find(row => row.evidenceObjectId === exactClaim.evidenceReference)
  const selectedSource = input.sourceSnapshot.sourceRegistry.find(row => row.sourceId === exactClaim.sourceReference)
  const bound = await resolveVE02ClaimBinding({ binding: { planId: saved.planId, requestId, claimKey: exactClaim.claimKey },
    context: { ...runtime, runtimeId: runtime.runtimeInstanceId, stateVersion: input.sourceSnapshot.inventoryReceipt.scope.stateVersion,
      evidence: selectedEvidence, source: selectedSource }, statement: exactClaim.statement,
    session: { inTransaction: () => true }, dependencies: { readPlan: async () => saved } })
  expect(bound).toMatchObject({ claimKey: exactClaim.claimKey, status: 'CURRENT_SAVED_CONDITION', hypothesisAuthority: false })
})
