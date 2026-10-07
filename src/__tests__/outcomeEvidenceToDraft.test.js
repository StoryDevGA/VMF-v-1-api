import { describe, test, expect, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { makeSs040Fixture } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract, assertEvidenceToMeaningContract, hashEvidenceToMeaningValue } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectEvidenceToMeaningProviderContract, assertEvidenceToMeaningProviderClaims,
  assertEvidenceToMeaningProviderProjection } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { projectRuntimeEvidenceToMeaningReadiness, assertRuntimeEvidenceToMeaningReady,
  projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'
import { executeRequestScopedQualityCheckpoint, __testables as studio } from '../services/outcomeStudioService.js'

const outputFor = (projection) => ({ title: 'Working Draft', assumptions: [], decisionLogic: projection.decisionProjections,
  sections: projection.sectionLedger.filter((section) => section.status === 'SUPPORTED').map((section) => {
    const claims = section.claimKeys.map((key) => projection.claimProjections.find((claim) => claim.claimKey === key))
    return { sectionKey: section.targetSectionKey, title: section.heading, claims, content: claims.map((claim) => claim.statement).join(' '), assumptions: [] }
  }) })
const ss041PlanFixture = async (options = {}) => {
  const input = await makeSs041Fixture(options)
  const payload = { runtime: input.composition.runtimeBinding, lockedTruth: input.composition.truthBinding,
    consumerIntent: input.composition.requestBinding,
    resolution: { selectedPacks: Object.values(input.selectedTarget.receipt.contractIdentity).map((item) => item.selection) },
    governedContext: { outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
      outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' } } }
  input.composition.truthBinding = { lockedTruth: payload.lockedTruth, frameworkHandoff: null }
  input.composition.requestBinding = { ...payload.consumerIntent, requestId: '' }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(payload)
  const contract = compileEvidenceToMeaningContract(input)
  payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  return { input, contract, plan: { payload } }
}

describe('PO readiness diagnostics preserve saved authority', () => {
  test('projects exact historical target recovery and full source mappings without rewriting receipt', async () => {
    const { input, plan } = await ss041PlanFixture()
    input.composition.targetReadError = { code: 'OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKED', field: 'frameworkHandoff.claimBoundaries' }
    await freezeSs041Snapshot(input, { extraReferences: [{ sectionKey: input.selectedTarget.receipt.targetSections.required[0].targetSectionKey, reference: 'scoped_view' }] })
    const contract = compileEvidenceToMeaningContract(input)
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    const before = JSON.stringify(plan.payload.evidenceToMeaning)
    const projected = projectRuntimeEvidenceToMeaningReadiness(plan)
    expect(projected.clarification.questions[0]).toMatchObject({ field: 'frameworkHandoff.claimBoundaries', missingInput: 'frameworkHandoff.claimBoundaries' })
    expect(projected.snapshotReadiness).toMatchObject({ totalSourceCount: input.sourceSnapshot.sourceRegistry.length,
      totalEvidenceCount: input.sourceSnapshot.evidenceObjects.length,
      unresolvedReferences: [{ sourceSectionKey: input.selectedTarget.receipt.targetSections.required[0].targetSectionKey, missingReference: 'scoped_view' }] })
    expect(JSON.stringify(plan.payload.evidenceToMeaning)).toBe(before)
  })
  test('unmapped real runtime source-section keys cannot acquire schema target identity', async () => {
    const input = await makeSs041Fixture()
    input.composition.businessFactLedger.facts.forEach((fact) => { fact.sectionKeys = ['customer_context'] })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.clarification.firstBoundary).toMatch(/sectionMapping/)
  })
})

const placedFixture = async () => {
  const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
  for (const fact of input.composition.businessFactLedger.facts) {
    const row = input.sourceSnapshot.evidenceObjects.find((entry) => entry.evidenceObjectId === fact.evidenceObjectId)
    row.draftPlacement = { version: 'evidence-to-draft-placement.v1', targetReceiptFingerprint: input.selectedTarget.receiptFingerprint,
      sourceSectionKeys: ['customer_context'], targetSectionKeys: [...fact.sectionKeys] }
    fact.sectionKeys = ['customer_context']
  }
  await freezeSs041Snapshot(input, { sourceSections: [{ sectionKey: 'customer_context',
    references: input.sourceSnapshot.evidenceObjects.map((row) => row.evidenceObjectId) }] })
  return input
}

describe('source-owned editorial placement authority', () => {
  test('preserves actual source membership and exact provider target placements without upgrading claim status', async () => {
    const input = await placedFixture()
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY_TO_DRAFT')
    expect(contract.customerClaims.every((claim) => claim.claimStatus === 'SOURCE_PRESENTED'
      && claim.draftPlacementStatus === 'VALIDATED' && claim.sourceSectionKeys.join() === 'customer_context')).toBe(true)
    expect(contract.sectionLedger.every((section) => section.status === 'SUPPORTED' && section.sourceSectionKeys.join() === 'customer_context')).toBe(true)
    const projection = projectEvidenceToMeaningProviderContract(contract)
    expect(() => assertEvidenceToMeaningProviderClaims({ contract, output: outputFor(projection) })).not.toThrow()
    input.sectionBindings = { 'executive-summary': ['customer_context'] }
    expect(compileEvidenceToMeaningContract(input).clarification.firstBoundary).toBe('sectionBindings.authority')
  })
  test.each([
    ['absent', (row) => { delete row.draftPlacement }],
    ['empty', (row) => { row.draftPlacement = {} }],
    ['null', (row) => { row.draftPlacement = null }],
    ['unknown-version', (row) => { row.draftPlacement.version = 'unknown' }],
    ['wrong-target-fingerprint', (row) => { row.draftPlacement.targetReceiptFingerprint = 'f'.repeat(64) }],
    ['unknown-target', (row) => { row.draftPlacement.targetSectionKeys = ['customer_context'] }],
    ['duplicate-target', (row) => { row.draftPlacement.targetSectionKeys.push(row.draftPlacement.targetSectionKeys[0]) }],
    ['wrong-source', (row) => { row.draftPlacement.sourceSectionKeys = ['evidence_register'] }],
    ['duplicate-source', (row) => { row.draftPlacement.sourceSectionKeys.push('customer_context') }],
    ['extra-field', (row) => { row.draftPlacement.claimStatus = 'ESTABLISHED' }],
  ])('%s placement blocks exact source reference before provider', async (_name, change) => {
    const input = await placedFixture()
    change(input.sourceSnapshot.evidenceObjects[0])
    await freezeSs041Snapshot(input, { sourceSections: [{ sectionKey: 'customer_context', references: ['evidence-0', 'evidence-1'] }] })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.clarification.questions.some((question) => question.missingReference === 'evidence-0'
      && question.sourceSectionKey === 'customer_context' && question.reasons.some((reason) => reason.startsWith('DRAFT_PLACEMENT')))).toBe(true)
    expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow()
  })
  test('fact source keys alone cannot override inventory membership', async () => {
    const input = await placedFixture()
    input.composition.businessFactLedger.facts.find((fact) => fact.evidenceObjectId === 'evidence-0').sectionKeys = ['evidence_register']
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.customerClaims.find((claim) => claim.evidenceReference === 'evidence-0').draftPlacementReasons).toContain('DRAFT_PLACEMENT_SOURCE_MISMATCH')
  })
  test('mapped source scoped_view omissions remain exact across all affected required targets', async () => {
    const input = await placedFixture()
    input.composition.businessFactLedger.omitted.push({ reference: 'scoped_view', sectionKeys: ['customer_context'], reason: 'REFERENCE_UNRESOLVED' })
    await freezeSs041Snapshot(input, { sourceSections: [{ sectionKey: 'customer_context', references: ['evidence-0', 'evidence-1', 'scoped_view'] }] })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.sectionLedger.every((section) => section.status === 'PARTIAL' && section.reasons.includes('REFERENCE_UNRESOLVED'))).toBe(true)
    expect(contract.clarification.questions.filter((question) => question.missingReference === 'scoped_view')
      .every((question) => question.sourceSectionKey === 'customer_context')).toBe(true)
  })
  test('source-presented unvalidated claims retain qualification and distinct placements without cross-target false deficits', async () => {
    const input = await placedFixture()
    const facts = input.composition.businessFactLedger.facts
    input.sourceSnapshot.evidenceObjects.forEach((row) => { row.validationStatus = 'UNVALIDATED' })
    input.composition.businessFactLedger.facts = []
    input.composition.businessFactLedger.omitted = facts.map((fact) => ({ reference: fact.evidenceObjectId,
      sectionKeys: fact.sectionKeys, reason: 'EVIDENCE_NOT_VALIDATED' }))
    await freezeSs041Snapshot(input, { sourceSections: [{ sectionKey: 'customer_context', references: ['evidence-0', 'evidence-1'] }] })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY_TO_DRAFT')
    expect(contract.customerClaims.every((claim) => claim.validationStatus === 'UNVALIDATED' && claim.claimStatus === 'SOURCE_PRESENTED')).toBe(true)
    expect(() => projectEvidenceToMeaningProviderContract(contract)).not.toThrow()
    input.sourceSnapshot.evidenceObjects[0].draftPlacement.targetReceiptFingerprint = 'f'.repeat(64)
    await freezeSs041Snapshot(input, { sourceSections: [{ sectionKey: 'customer_context', references: ['evidence-0', 'evidence-1'] }] })
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
  })
  test('unlocated candidate blocks required targets rather than source names', async () => {
    const input = await placedFixture()
    input.sourceSnapshot.discoveryHealth.contradictionCandidates = [{ contradictionId: 'unknown-pair', evidenceObjectIds: ['evidence-0', 'missing-record'] }]
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.contradictionLedger[0].affectedSectionKeys).toEqual(input.selectedTarget.receipt.targetSections.required.map((section) => section.targetSectionKey))
  })
  test('source placement drift invalidates saved readiness and old frozen bytes remain intact', async () => {
    const input = await placedFixture(), contract = compileEvidenceToMeaningContract(input)
    const saved = { payload: { evidenceToMeaning: { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) } } }
    const before = JSON.stringify(saved)
    const changed = structuredClone(input.sourceSnapshot)
    changed.evidenceObjects[0].draftPlacement.targetReceiptFingerprint = 'f'.repeat(64)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan: saved, deps: { readOutcomeEvidenceContractSnapshot: async () => changed } }))
      .rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED' })
    expect(JSON.stringify(saved)).toBe(before)
  })
})

describe('SS-041 frozen evidence-to-draft checkpoint and regression matrix', () => {
  test('supported golden receipt anchors exact bytes and stable future replay hash', async () => {
    const contract = compileEvidenceToMeaningContract(await makeSs041Fixture())
    expect(JSON.stringify(contract)).toBe(readFileSync(new URL('./fixtures/supportedEvidenceToDraftContract.json', import.meta.url), 'utf8'))
    expect(contract.contractHash).toBe('dba2e552062fd4064481a8ea5882d9375d2e719fd04611ecbd33ad310a354790')
  })
  test.each(['Parlon', 'StorylineOS internal VMF', 'BuildQM', 'CodeKarma', 'Routeability', 'IdentityPlus', 'Synthetic complete'])('%s compiles repeatably and renders only exact admitted identities', async (name) => {
    const input = await makeSs041Fixture({ name })
    const first = compileEvidenceToMeaningContract(input), second = compileEvidenceToMeaningContract(JSON.parse(JSON.stringify(input)))
    expect(first.status).toBe('READY_TO_DRAFT')
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(assertEvidenceToMeaningContract(first)).toEqual(first)
    const projection = projectEvidenceToMeaningProviderContract(first)
    expect(projection.claimProjections[0].proofDisposition).toBe('NOT_ESTABLISHED')
    expect(projection.claimProjections[0].proofDependencies).toEqual(['ATTRIBUTION'])
    expect(projection).not.toHaveProperty('inputs')
    expect(assertEvidenceToMeaningProviderClaims({ contract: first, output: outputFor(projection) })).toEqual(projection)
  })
  test('legacy v1 byte-stable contract remains READY and replayable', () => {
    const first = compileEvidenceToMeaningContract(makeSs040Fixture())
    expect(first.status).toBe('READY')
    expect(first.contractVersion).toBe('evidence-to-meaning.v1')
    expect(assertEvidenceToMeaningContract(JSON.parse(JSON.stringify(first)))).toEqual(first)
  })
  test.each(['claimStatus', 'sourceLocation', 'scope', 'time', 'materiality', 'proofRequirementCodes', 'proofOrderDisposition', 'attribution'])('ACCEPTED cannot manufacture missing %s', async (field) => {
    const input = await makeSs041Fixture()
    delete input.sourceSnapshot.evidenceObjects[0][field]
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.clarification.questions[0]).toMatchObject({ sectionKey: 'executive-summary', missingReference: 'evidence-0', nextAction: 'CLARIFY_GOVERNED_SOURCE_AND_RE_RESOLVE' })
    expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow()
  })
  test.each(['ESTABLISHED', 'HYPOTHETICAL', 'PROOF_BEFORE_INTERPRETATION', 'UNRESOLVED'])('proof disposition %s without stored basis never manufactures ordering', async (disposition) => {
    const input = await makeSs041Fixture(); input.sourceSnapshot.evidenceObjects[0].proofOrderDisposition = disposition
    await freezeSs041Snapshot(input)
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
  })
  test('explicit established proof order is distinct from dependency evidence IDs', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    const row = input.sourceSnapshot.evidenceObjects[1]
    row.proofDependency = ['evidence-0']; row.proofOrderDisposition = 'ESTABLISHED'; row.proofOrder = ['ATTRIBUTION']
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY_TO_DRAFT')
    const projection = projectEvidenceToMeaningProviderContract(contract)
    expect(projection.customerClaims.find((claim) => claim.evidenceReference === 'evidence-1').proofDependency).toEqual(['evidence-0'])
    expect(projection.claimProjections.every((claim) => claim.proofDependencies[0] === 'ATTRIBUTION')).toBe(true)
  })
  test('cycle and missing dependency block exact sections', async () => {
    const input = await makeSs041Fixture()
    input.sourceSnapshot.evidenceObjects[0].proofDependency = ['evidence-0']
    await freezeSs041Snapshot(input)
    expect(compileEvidenceToMeaningContract(input).sectionLedger[0].reasons).toContain('PROOF_DEPENDENCY_UNRESOLVED')
  })
  test('scoped_view stays exact unresolved and optional omission does not globally block', async () => {
    const input = await makeSs041Fixture({ optional: ['Economics'] })
    input.composition.businessFactLedger.omitted.push({ reference: 'scoped_view', reason: 'REFERENCE_UNRESOLVED', sectionKeys: ['economics'] })
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY_TO_DRAFT')
    expect(contract.sectionLedger[1]).toMatchObject({ status: 'OPTIONAL', evidenceReferences: ['scoped_view'], omissionPermitted: true })
    expect(contract.omissions[0].reference).toBe('scoped_view')
    input.composition.businessFactLedger.omitted[0].sectionKeys = ['executive-summary']
    await freezeSs041Snapshot(input)
    const blocked = compileEvidenceToMeaningContract(input)
    expect(blocked.status).toBe('CLARIFICATION_REQUIRED')
    expect(blocked.clarification.questions.some((entry) => entry.missingReference === 'scoped_view')).toBe(true)
  })
  test('metadata-only and empty/framework-only sections cannot become customer claims', async () => {
    const input = await makeSs041Fixture()
    input.composition.businessFactLedger.facts = []
    input.composition.businessFactLedger.omitted = [{ reference: 'source-1', sectionKeys: ['executive-summary'], reason: 'SOURCE_ONLY_REFERENCE_NOT_A_FACT' }]
    await freezeSs041Snapshot(input)
    expect(compileEvidenceToMeaningContract(input).sectionLedger[0].status).toBe('METADATA_ONLY')
    input.composition.businessFactLedger.omitted = []; input.sourceSnapshot.evidenceObjects = []
    input.composition.frameworkIntelligence = { guidance: 'A documented decision process is useful.' }
    await freezeSs041Snapshot(input)
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
  })
  test.each([499, 500, 501, 853])('%i inventory identities receive a disposition without raw provider transport', async (inventoryCount) => {
    const input = await makeSs041Fixture({ inventoryCount })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY_TO_DRAFT')
    expect(contract.identityDispositionLedger).toHaveLength(inventoryCount)
    expect(contract.completenessReceipt.collections.evidence.totalCount).toBe(inventoryCount)
    expect(contract.customerClaims).toHaveLength(1)
    expect(Buffer.byteLength(JSON.stringify(projectEvidenceToMeaningProviderContract(contract)))).toBeLessThan(120000)
  })
  test.each([499, 500, 501])('%i selected bodies are governed by byte size rather than a 500-record cap', async (inventoryCount) => {
    const input = await makeSs041Fixture({ inventoryCount, allSelected: true })
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.clarification.errors).toEqual([])
    expect(contract.sectionLedger[0].reasons).toContain('SECTION_REFERENCE_UNMAPPED')
    expect(contract.inputs.sourceSnapshot.evidenceObjects).toHaveLength(inventoryCount)
    expect(contract.identityDispositionLedger).toHaveLength(inventoryCount)
  })
  test('inventory receipt is mandatory for v2 and any scoped body drift rejects readiness', async () => {
    const input = await makeSs041Fixture()
    delete input.sourceSnapshot.inventoryReceipt
    expect(compileEvidenceToMeaningContract(input).clarification.firstBoundary).toBe('sourceSnapshot.INVENTORY_RECEIPT_REQUIRED')
    await freezeSs041Snapshot(input)
    input.sourceSnapshot.evidenceObjects[0].tenantId = 'other'
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
  })
  test('explicit qualification candidate remains visible, unresolved dimensions block only mapped sections', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    input.sourceSnapshot.evidenceObjects[1].qualificationOf = 'evidence-0'
    input.sourceSnapshot.discoveryHealth.contradictionCandidates = [{ contradictionId: 'candidate-1', evidenceObjectIds: ['evidence-0', 'evidence-1'], basis: 'Source qualification', domain: 'decision' }]
    await freezeSs041Snapshot(input)
    const supported = compileEvidenceToMeaningContract(input)
    expect(supported.status).toBe('READY_TO_DRAFT')
    expect(supported.contradictionLedger[0].disposition).toBe('COMPATIBLE_QUALIFICATION')
    delete input.sourceSnapshot.evidenceObjects[1].materiality
    await freezeSs041Snapshot(input)
    const blocked = compileEvidenceToMeaningContract(input)
    expect(blocked.contradictionLedger[0].disposition).toBe('UNRESOLVED')
    expect(blocked.sectionLedger[0].reasons).toContain('CONTRADICTION_CANDIDATE_UNRESOLVED')
  })
  test('different or overlapping scope records keep an unresolved candidate without deleting it', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    input.sourceSnapshot.evidenceObjects[1].scope = { organisation: 'Other', domain: 'decision-process' }
    input.sourceSnapshot.discoveryHealth.contradictionCandidates = [{ contradictionId: 'candidate-1', evidenceObjectIds: ['evidence-0', 'evidence-1'] }]
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.contradictionLedger[0].disposition).toBe('UNRESOLVED')
    input.sourceSnapshot.evidenceObjects[1].scope = { organisation: 'Synthetic', domain: 'decision-process', department: 'Subset' }
    await freezeSs041Snapshot(input)
    expect(compileEvidenceToMeaningContract(input).contradictionLedger[0].disposition).toBe('UNRESOLVED')
  })
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('legacy %s review cannot override unknown or changed v2 dimensions', async (disposition) => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    const candidate = { contradictionId: 'candidate-reviewed', evidenceObjectIds: ['evidence-0', 'evidence-1'], domain: 'decision', severity: 'REVIEW', basis: 'Explicit qualification' }
    input.sourceSnapshot.evidenceObjects[1].qualificationOf = 'evidence-0'
    input.sourceSnapshot.discoveryHealth.contradictionCandidates = [candidate]
    const review = getDiscoveryContradictionReview(candidate, input.sourceSnapshot.evidenceObjects)
    input.sourceSnapshot.contradictionReviews = [{ contradictionId: candidate.contradictionId,
      runtimeInstanceId: 'runtime-id-1', contractVersion: 'discovery-contradiction-review-v1', reviewEpoch: '',
      evidencePairHash: review.evidencePairHash, reviewId: 'synthetic-review', reviewedBy: 'synthetic-reviewer',
      reviewedAt: '2026-10-01T12:00:00Z', rationale: 'Synthetic source review retained as information.', disposition }]
    await freezeSs041Snapshot(input)
    if (disposition !== 'NOT_CONTRADICTORY') expect(compileEvidenceToMeaningContract(input).contradictionLedger[0].disposition).toBe('UNRESOLVED')
    delete input.sourceSnapshot.evidenceObjects[1].materiality
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.contradictionLedger[0].sourceReview.reviewStatus).toBe(disposition)
    expect(contract.contradictionLedger[0].disposition).toBe('UNRESOLVED')
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
  })
  test('invalid provider claim, section identity and stronger prose fail before persistence', async () => {
    const contract = compileEvidenceToMeaningContract(await makeSs041Fixture())
    const projection = projectEvidenceToMeaningProviderContract(contract)
    for (const mutation of [out => { out.sections[0].claims[0].claimKey = 'invented' },
      out => { out.sections[0].sectionKey = 'invented' }, out => { out.sections[0].content += ' This proves financial returns.' }]) {
      const output = JSON.parse(JSON.stringify(outputFor(projection))); mutation(output)
      expect(() => assertEvidenceToMeaningProviderClaims({ contract, output })).toThrow()
    }
  })
  test('clarification names only the deficient reference and its own missing fields', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    input.composition.businessFactLedger.facts[1].sectionKeys = ['executive-summary', 'evidence-boundary']
    delete input.sourceSnapshot.evidenceObjects[1].claimStatus
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.clarification.questions.every((question) => question.missingReference === 'evidence-1')).toBe(true)
    expect(contract.clarification.questions[0].missingInput).toBe('stored claimStatus (source-presented or independently established)')
  })
  test('a claim shared across two supported sections keeps exact placements', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    input.composition.businessFactLedger.facts[0].sectionKeys = ['executive-summary', 'evidence-boundary']
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input), projection = projectEvidenceToMeaningProviderContract(contract)
    expect(contract.status).toBe('READY_TO_DRAFT')
    expect(assertEvidenceToMeaningProviderClaims({ contract, output: outputFor(projection) })).toEqual(projection)
    projection.sectionLedger[0].claimKeys = ['invented']
    const { projectionHash, ...payload } = projection
    projection.projectionHash = hashEvidenceToMeaningValue(payload)
    expect(() => assertEvidenceToMeaningProviderProjection(projection)).toThrow()
  })
  test('private metadata and projected byte overflow fail before provider transport', async () => {
    const input = await makeSs041Fixture()
    input.sourceSnapshot.evidenceObjects[0].sourceLocation = 'api_key=synthetic-secret'
    await freezeSs041Snapshot(input)
    expect(() => projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(input))).toThrow()
    input.sourceSnapshot.evidenceObjects[0].sourceLocation = 'source-1#documented-decision'
    input.composition.frameworkIntelligence = { guidance: 'x'.repeat(120001) }
    await freezeSs041Snapshot(input)
    expect(() => projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(input))).toThrow(expect.objectContaining({ details: expect.objectContaining({ clarification: expect.objectContaining({ missingFields: ['providerContext.size'] }) }) }))
  })
  test.each(['Only a source-reported hypothesis may be stated.', '', null])('stored permittedStatement %s cannot allow a stronger original statement', async (permittedStatement) => {
    const { input, plan } = await ss041PlanFixture()
    input.sourceSnapshot.evidenceObjects[0].permittedStatement = permittedStatement
    await freezeSs041Snapshot(input)
    const contract = compileEvidenceToMeaningContract(input), provider = jest.fn()
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.sectionLedger[0].reasons).toContain('PERMITTED_STATEMENT_REPRESENTATION_UNRESOLVED')
    expect(contract.clarification.questions[0]).toMatchObject({ missingReference: 'evidence-0', reasons: ['PERMITTED_STATEMENT_REPRESENTATION_UNRESOLVED'] })
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    await expect((async () => {
      await assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: async () => input.sourceSnapshot } })
      provider()
    })()).rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED' })
    expect(provider).not.toHaveBeenCalled()
    expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow()
  })
  test.each(['scope', 'time', 'materiality', 'sourceLocation'])('unknown or empty object-form %s cannot satisfy claim or qualification constraints', async (field) => {
    for (const value of [{}, { status: 'UNRESOLVED' }, { status: 'UNKNOWN' }, { nested: { status: 'UNKNOWN' } }]) {
      const input = await makeSs041Fixture({ name: 'BuildQM' })
      input.sourceSnapshot.evidenceObjects[1][field] = value
      await freezeSs041Snapshot(input)
      const contract = compileEvidenceToMeaningContract(input)
      expect(contract.status).toBe('CLARIFICATION_REQUIRED')
      expect(contract.contradictionLedger[0].disposition).toBe('UNRESOLVED')
      const dimension = field === 'sourceLocation' ? 'provenance' : field
      expect(contract.contradictionLedger[0].dimensions[dimension]).toBe('UNRESOLVED')
      expect(contract.clarification.questions.some((question) => question.missingReference === 'evidence-1')).toBe(true)
    }
  })
  test('retry preserves immutable receipt and source change invalidates before provider', async () => {
    const { input, plan } = await ss041PlanFixture()
    expect(projectRuntimeEvidenceToMeaningReadiness(plan)).toMatchObject({ status: 'READY_TO_DRAFT', canExecute: true })
    const read = jest.fn().mockResolvedValue(input.sourceSnapshot)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: read } })).resolves.toMatchObject({ status: 'READY_TO_DRAFT' })
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: read } })).resolves.toMatchObject({ status: 'READY_TO_DRAFT' })
    input.sourceSnapshot.evidenceObjects[0].extractedFact = 'A changed source statement.'
    await freezeSs041Snapshot(input)
    await expect(assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: read } })).rejects.toMatchObject({ details: { reason: 'SOURCE_SNAPSHOT_CHANGED_RE_RESOLVE_REQUEST' } })
  })
  test.each([false, true])('request-scoped quality routing evaluates v2 qualification instead of the legacy candidate count: unresolved=%s', async (unresolved) => {
    const { input, plan } = await ss041PlanFixture({ name: 'BuildQM' })
    if (unresolved) {
      delete input.sourceSnapshot.evidenceObjects[1].materiality
      await freezeSs041Snapshot(input)
      const contract = compileEvidenceToMeaningContract(input)
      plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
        contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    }
    const provider = jest.fn(), workingDraft = jest.fn()
    const failure = await executeRequestScopedQualityCheckpoint({ requestPlan: {
      requestId: '8abedafd-8555-4342-be49-76ab906a26f6', planId: 'outcome_kcp_synthetic', planFingerprint: 'a'.repeat(64) },
      frameworkGuidanceProviderAdapterFactory: () => provider, workingDraftProviderAdapterFactory: () => provider,
      arlMeaningReviewProviderAdapterFactory: () => provider, renderedExpressionRlProviderAdapterFactory: () => provider,
      deps: { findPlan: async () => plan, assertPlan: () => undefined,
        executeFrameworkGuidance: async () => {
          await assertRuntimeEvidenceToMeaningReady({ plan, deps: { readOutcomeEvidenceContractSnapshot: async () => input.sourceSnapshot } })
          return { stage: { status: 'FAILED', failure: { failureCode: 'SYNTHETIC_CHECKPOINT_STOP_NO_PROVIDER' } } }
        }, executeWorkingDraft: workingDraft } }).catch((error) => error)
    if (unresolved) expect(failure.code).toBe('EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED')
    else expect(failure.details.blockerReason).toBe('SYNTHETIC_CHECKPOINT_STOP_NO_PROVIDER')
    expect(provider).not.toHaveBeenCalled()
    expect(workingDraft).not.toHaveBeenCalled()
  })
  test('bootstrap uses exact current v2 plan and still enforces provider and engine gates', async () => {
    const { input, plan } = await ss041PlanFixture({ name: 'BuildQM' })
    const requestId = '8abedafd-8555-4342-be49-76ab906a26f6'
    plan.payload.requestId = requestId
    input.composition.requestBinding.requestId = requestId
    input.composition.providerCompatibility = { contractVersion: 'evidence-to-draft-provider.v2', status: 'READY' }
    const contract = compileEvidenceToMeaningContract(input)
    Object.assign(plan, { tenantId: 'tenant', customerId: 'customer', runtimeInstanceId: 'runtime-id-1', requestId,
      planId: 'outcome_kcp_synthetic', planFingerprint: 'a'.repeat(64) })
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    const args = { activeSession: { requestPlan: { requestId, planId: plan.planId, planFingerprint: plan.planFingerprint } },
      runtimeScope: { tenantId: 'tenant', customerId: 'customer', runtimeInstanceId: 'runtime-id-1' },
      selectedTarget: input.selectedTarget.receipt,
      deps: { findPlan: jest.fn(async () => plan), findLatestPlan: async () => plan, assertPlan: () => {},
        readOutcomeEvidenceContractSnapshot: async () => input.sourceSnapshot } }
    expect(await studio.resolveRequestPlanEvidenceCompositionCheck(args)).toMatchObject({ passed: true })
    expect(args.deps.findPlan).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant', customerId: 'customer', runtimeInstanceId: 'runtime-id-1', requestId, planId: plan.planId, planFingerprint: plan.planFingerprint }))
    expect(studio.buildDraftProviderCompositionCheck({ engineEnabled: true, provider: { configured: false, reason: 'PROVIDER_DISABLED' } })).toMatchObject({ passed: false, reason: 'PROVIDER_DISABLED' })
    expect(studio.buildDraftProviderCompositionCheck({ engineEnabled: false, provider: { configured: true } })).toMatchObject({ passed: false, reason: 'DRAFTING_ENGINE_DISABLED' })
    expect(await studio.resolveRequestPlanEvidenceCompositionCheck({ ...args, activeSession: {} })).toBeNull()
    for (const changed of [
      { runtimeScope: { ...args.runtimeScope, tenantId: 'other' } },
      { selectedTarget: { ...args.selectedTarget, drift: true } },
      { deps: { ...args.deps, findLatestPlan: async () => ({ ...plan, planId: 'later-plan' }) } },
      { deps: { ...args.deps, readOutcomeEvidenceContractSnapshot: async () => ({ ...input.sourceSnapshot, drift: true }) } },
      { deps: { ...args.deps, assertPlan: () => { throw new Error('invalid receipt') } } },
    ]) expect(await studio.resolveRequestPlanEvidenceCompositionCheck({ ...args, ...changed })).toMatchObject({ passed: false })
    input.composition.contractVersion = 'outcome-studio.evidence-to-meaning-input.v1'
    input.sourceSnapshot.evidenceObjects.forEach((row) => { row.proofOrderDisposition = 'PROOF_BEFORE_INTERPRETATION' })
    await freezeSs041Snapshot(input)
    const legacy = compileEvidenceToMeaningContract(input)
    plan.payload.evidenceToMeaning = { contractVersion: legacy.contractVersion, contractId: legacy.contractId,
      contractHash: legacy.contractHash, contractJson: JSON.stringify(legacy) }
    expect(await studio.resolveRequestPlanEvidenceCompositionCheck(args)).toBeNull()
  })
})
