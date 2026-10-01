import { describe, test, expect } from '@jest/globals'
import { compileEvidenceToMeaningContract, assertEvidenceToMeaningContract,
  validateEvidenceToMeaningGeneratedClaims } from '../services/outcomeEvidenceToMeaningContractService.js'
import { makeSs040Fixture, ss040ScenarioFixtures } from './fixtures/ss040EvidenceToMeaningFixtures.js'

describe('SS-040 frozen cross-scenario Evidence-to-Meaning candidate', () => {
  test('compiles a 500-claim shared proof DAG and rejects downstream cyclic or invalid proof', () => {
    const input = makeSs040Fixture()
    const originalEvidence = input.sourceSnapshot.evidenceObjects[0]
    const originalFact = input.composition.businessFactLedger.facts[0]
    input.sourceSnapshot.evidenceObjects = Array.from({ length: 500 }, (_, index) => ({ ...structuredClone(originalEvidence),
      evidenceObjectId: `evidence-${index}`, proofDependency: index < 2 ? [] : [`evidence-${index - 1}`, `evidence-${index - 2}`] }))
    input.composition.businessFactLedger.facts = input.sourceSnapshot.evidenceObjects.map((evidence) => ({
      ...structuredClone(originalFact), evidenceObjectId: evidence.evidenceObjectId }))
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY')
    expect(contract.customerClaims).toHaveLength(500)
    expect(assertEvidenceToMeaningContract(contract)).toBe(contract)
    const invalid = structuredClone(input)
    invalid.sourceSnapshot.evidenceObjects[0].currentness = 'UNKNOWN'
    invalid.composition.businessFactLedger.facts[0].currentness = 'UNKNOWN'
    invalid.sourceSnapshot.evidenceObjects[1].proofDependency = ['evidence-0']
    const invalidContract = compileEvidenceToMeaningContract(invalid)
    expect(invalidContract.status).toBe('CLARIFICATION_REQUIRED')
    expect(invalidContract.sectionLedger[0].claimKeys).toHaveLength(0)
    input.sourceSnapshot.evidenceObjects[0].proofDependency = ['evidence-499']
    input.sourceSnapshot.evidenceObjects[1].proofDependency = ['evidence-0']
    const cyclic = compileEvidenceToMeaningContract(input)
    expect(cyclic.status).toBe('CLARIFICATION_REQUIRED')
    expect(cyclic.sectionLedger[0].claimKeys).toHaveLength(0)
    expect(cyclic.sectionLedger[0].reasons).toContain('PROOF_DEPENDENCY_UNRESOLVED')
  })
  test.each(ss040ScenarioFixtures())('$name compiles, maps, separates and replays deterministically', ({ input, expected }) => {
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe(expected)
    expect(assertEvidenceToMeaningContract(contract)).toBe(contract)
    const replay = structuredClone(input)
    replay.sourceSnapshot.evidenceObjects.reverse(); replay.sourceSnapshot.sourceRegistry.reverse()
    replay.composition.businessFactLedger.facts.reverse()
    expect(compileEvidenceToMeaningContract(replay).contractHash).toBe(contract.contractHash)
    for (const claim of contract.customerClaims) {
      const evidence = input.sourceSnapshot.evidenceObjects.find((entry) => entry.evidenceObjectId === claim.evidenceReference)
      expect(claim.statement).toBe(evidence.extractedFact)
      expect(claim.sourceReference).toBe(evidence.sourceId)
    }
    expect(contract.frameworkGuidance.label).toBe('FRAMEWORK_GUIDANCE_ONLY')
    if (expected !== 'READY') expect(contract.clarification.firstBoundary).not.toBe('')
    for (const section of contract.sectionLedger) {
      if (section.required && section.status !== 'SUPPORTED') expect(contract.clarification.required).toBe(true)
      if (section.status === 'OMITTED') expect(section.omissionPermitted).toBe(true)
    }
  })
  test('has at least eight non-Parlon classes', () => expect(ss040ScenarioFixtures().filter((item) => item.name !== 'Parlon').length).toBeGreaterThanOrEqual(8))
  test.each(['_id', '__v', 'attribution', 'proofOrderDisposition'])('stored %s changes invalidate source and contract hashes', (field) => {
    const input = makeSs040Fixture(); const before = compileEvidenceToMeaningContract(input)
    input.sourceSnapshot.evidenceObjects[0][field] = 'changed'
    const after = compileEvidenceToMeaningContract(input)
    expect(after.contractHash).not.toBe(before.contractHash)
    expect(after.fingerprints.source).not.toBe(before.fingerprints.source)
  })
  test('legacy current runtime does not supply missing evidence currentness', () => {
    const input = makeSs040Fixture(); delete input.sourceSnapshot.evidenceObjects[0].currentness
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.customerClaims[0].currentness).toBe('UNKNOWN')
    expect(contract.sectionLedger[0].reasons).toContain('CURRENTNESS_UNRESOLVED')
  })
  test('ACCEPTED does not supply missing validation or proof', () => {
    const input = makeSs040Fixture(); delete input.sourceSnapshot.evidenceObjects[0].proofOrderDisposition
    expect(compileEvidenceToMeaningContract(input).sectionLedger[0].reasons).toContain('PROOF_UNRESOLVED')
  })
  test('rejected review and empty interpretation restrictions cannot supply proof', () => {
    for (const mutate of [(input) => {
      input.sourceSnapshot.evidenceObjects[0].reviewStatus = 'REJECTED'
      input.composition.businessFactLedger.facts[0].reviewStatus = 'REJECTED'
    }, (input) => { input.sourceSnapshot.evidenceObjects[0].permittedInterpretation = '' },
    (input) => { input.sourceSnapshot.evidenceObjects[0].blockedStrongerClaim = [] }]) {
      const input = makeSs040Fixture(); mutate(input)
      expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
    }
  })
  test.each(['statement', 'sourceId', 'validationStatus', 'qualification'])('changed ledger %s fails closed', (field) => {
    const input = makeSs040Fixture(); input.composition.businessFactLedger.facts[0][field] = 'invented'
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.clarification.firstBoundary).toBe('evidence-0.ledgerMapping')
    expect(contract.clarification.questions.length).toBeGreaterThan(0)
    expect(contract.clarification.affectedSections[0].required).toBe(true)
  })
  test('duplicate source and ambiguous evidence identities fail closed', () => {
    for (const field of ['sourceRegistry', 'evidenceObjects']) {
      const input = makeSs040Fixture(); input.sourceSnapshot[field].push(structuredClone(input.sourceSnapshot[field][0]))
      const contract = compileEvidenceToMeaningContract(input)
      expect(contract.status).toBe('CLARIFICATION_REQUIRED')
      expect(assertEvidenceToMeaningContract(contract)).toBe(contract)
    }
  })
  test('missing audience and changed pack lineage fail closed', () => {
    for (const mutate of [(input) => { input.request.audience = [] },
      (input) => { input.composition.outputBinding.lineage.contentHashes = [] }]) {
      const input = makeSs040Fixture(); mutate(input)
      expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
    }
  })
  test('unauthenticated section mapping fails closed', () => {
    const input = makeSs040Fixture(); input.sectionBindings = { 'executive-summary': ['economics'] }
    expect(compileEvidenceToMeaningContract(input).clarification.firstBoundary).toBe('sectionBindings.authority')
  })
  test.each(['Executive Summary', 'executive_summary', 'unrelated'])('source key %s cannot be normalized into support', (key) => {
    const input = makeSs040Fixture(); input.composition.businessFactLedger.facts[0].sectionKeys = [key]
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.clarification.firstBoundary).toBe('evidence-0.sectionMapping')
    expect(contract.clarification.errors[0].sourceReference).toBe('source-1')
  })
  test('cyclic and unresolved dependencies cannot support required sections', () => {
    const input = makeSs040Fixture({ required: ['Executive Summary', 'Current Situation'] })
    input.sourceSnapshot.evidenceObjects[0].proofDependency = ['evidence-1']
    input.sourceSnapshot.evidenceObjects[1].proofDependency = ['evidence-0']
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
  })
  test('proof claims precede dependent interpretation and cannot be reordered', () => {
    const input = makeSs040Fixture({ required: ['Executive Summary', 'Current Situation'] })
    input.sourceSnapshot.evidenceObjects[0].proofDependency = ['evidence-1']
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY')
    expect(contract.customerClaims.map((claim) => claim.evidenceReference)).toEqual(['evidence-1', 'evidence-0'])
  })
  test('optional proof deficits omit while required proof deficits clarify', () => {
    const input = makeSs040Fixture({ required: ['Executive Summary', 'Economics'] })
    const evidence = input.sourceSnapshot.evidenceObjects[1]
    delete evidence.currentness; delete evidence.proofDependency
    expect(compileEvidenceToMeaningContract(input).status).toBe('CLARIFICATION_REQUIRED')
    // Test the same source ledger against a schema which explicitly permits omission.
    const optional = makeSs040Fixture({ optional: ['Economics'] })
    optional.sourceSnapshot.evidenceObjects.push(evidence)
    optional.composition.businessFactLedger.facts.push(input.composition.businessFactLedger.facts[1])
    const contract = compileEvidenceToMeaningContract(optional)
    expect(contract.status).toBe('READY')
    expect(contract.sectionLedger[1].status).toBe('OMITTED')
  })
  test('contract tampering rejects before generated claims', () => {
    const contract = compileEvidenceToMeaningContract(makeSs040Fixture()); contract.customerClaims[0].statement = 'Stronger claim'
    expect(() => assertEvidenceToMeaningContract(contract)).toThrow()
  })
  test.each(['statement', 'claimKey', 'qualification', 'attribution', 'validationStatus', 'currentness', 'proofOrderDisposition'])('generated %s cannot change', (field) => {
    const contract = compileEvidenceToMeaningContract(makeSs040Fixture())
    const claims = structuredClone(contract.customerClaims); claims[0][field] = 'invented'
    expect(() => validateEvidenceToMeaningGeneratedClaims({ contract, claims })).toThrow()
  })
  test('exact claims pass while missing, duplicated or reordered claims reject', () => {
    const contract = compileEvidenceToMeaningContract(makeSs040Fixture({ required: ['Executive Summary', 'Current Situation'] }))
    expect(validateEvidenceToMeaningGeneratedClaims({ contract, claims: structuredClone(contract.customerClaims) })).toHaveLength(2)
    for (const claims of [[], [...contract.customerClaims].reverse(), [contract.customerClaims[0], contract.customerClaims[0]]]) {
      expect(() => validateEvidenceToMeaningGeneratedClaims({ contract, claims })).toThrow()
    }
  })
})
