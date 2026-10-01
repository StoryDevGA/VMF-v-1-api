import { describe, expect, test } from '@jest/globals'
import { makeSs040Fixture } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { compileEvidenceToMeaningContract, hashEvidenceToMeaningValue } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectEvidenceToMeaningProviderContract, assertEvidenceToMeaningProviderClaims,
  assertEvidenceToMeaningProviderProjection } from '../services/outcomeEvidenceToMeaningProviderService.js'

const fixture = () => {
  const input = makeSs040Fixture()
  input.sourceSnapshot.evidenceObjects[0].evidenceRequiredToSubstantiate = ['Retain the original documented source.']
  const contract = compileEvidenceToMeaningContract(input)
  const projection = projectEvidenceToMeaningProviderContract(contract)
  const output = { sections: projection.sectionLedger.filter((section) => section.status === 'SUPPORTED').map((section) => ({
    sectionKey: section.targetSectionKey, title: section.heading,
    claims: projection.claimProjections.filter((claim) => section.claimKeys.includes(claim.claimKey)),
    content: projection.claimProjections.filter((claim) => section.claimKeys.includes(claim.claimKey)).map((claim) => claim.statement).join(' '),
  })) }
  return { input, contract, projection, output }
}
describe('SS-040 deterministic bounded provider projection', () => {
  test.each(['lineageRef', 'sourceType', 'storedSourceHash', 'evidenceReference', 'sourceReference'])('rejects private provider metadata in %s even when rehashed', (field) => {
    const { projection } = fixture()
    const claim = projection.customerClaims[0]
    if (['sourceType', 'storedSourceHash'].includes(field)) claim.attribution[field] = 'api_key=synthetic-review-secret'
    else claim[field] = 'api_key=synthetic-review-secret'
    const { projectionHash, ...payload } = projection
    projection.projectionHash = hashEvidenceToMeaningValue(payload)
    expect(() => assertEvidenceToMeaningProviderProjection(projection)).toThrow(expect.objectContaining({
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED' }))
  })
  test('rejects private stored lineage before creating a provider projection', () => {
    const { input } = fixture()
    input.sourceSnapshot.evidenceObjects[0].lineageRef = 'api_key=synthetic-review-secret'
    input.composition.businessFactLedger.facts[0].provenance.lineageRef = 'api_key=synthetic-review-secret'
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY')
    expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow()
  })
  test('preserves originals separately from exact compatibility records', () => {
    const { contract, projection, output } = fixture()
    expect(projection.customerClaims[0].validationStatus).toBe('VALIDATED')
    expect(projection.claimProjections[0].validationStatus).toBe('SOURCE_REPORTED_VALIDATED')
    expect(projection.customerClaims[0].classification).toBe('CUSTOMER_EVIDENCE')
    expect(projection.claimProjections[0].meaningClass).toBe('QUALIFIED')
    expect(projection).not.toHaveProperty('sourceSnapshot')
    expect(projection).not.toHaveProperty('inputs')
    expect(projectEvidenceToMeaningProviderContract(contract)).toEqual(projection)
    expect(assertEvidenceToMeaningProviderClaims({ contract, output })).toEqual(projection)
  })
  test.each(['statement', 'evidence', 'validationStatus', 'proofDependencies', 'whatCanBeSaidNow', 'blockedStrongerClaim', 'claimKey', 'truthReferences', 'meaningClass', 'proofDisposition', 'evidenceRequiredToSubstantiate'])('rejects changed %s before persistence', (field) => {
    const { contract, output } = fixture()
    output.sections[0].claims[0][field] = Array.isArray(output.sections[0].claims[0][field]) ? ['invented'] : 'invented'
    expect(() => assertEvidenceToMeaningProviderClaims({ contract, output })).toThrow()
  })
  test('rejects hidden stronger prose and missing/extra claim coverage', () => {
    const { contract, output } = fixture()
    output.sections[0].content += ' This proves financial returns.'
    expect(() => assertEvidenceToMeaningProviderClaims({ contract, output })).toThrow()
    output.sections[0].claims = []
    expect(() => assertEvidenceToMeaningProviderClaims({ contract, output })).toThrow()
  })
  test.each(['missing-proof-requirement', 'excess-proof-requirements', 'multiple-restrictions', 'unsafe-attribution'])('clarifies %s without inventing a representation', (kind) => {
    const { input } = fixture(), evidence = input.sourceSnapshot.evidenceObjects[0]
    if (kind === 'missing-proof-requirement') delete evidence.evidenceRequiredToSubstantiate
    if (kind === 'excess-proof-requirements') evidence.evidenceRequiredToSubstantiate = Array(11).fill('Retain the original documented source.')
    if (kind === 'multiple-restrictions') evidence.blockedStrongerClaim.push('Another original restriction.')
    if (kind === 'unsafe-attribution') evidence.attribution = 'api_key=secret-value'
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.status).toBe('READY')
    expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow(expect.objectContaining({
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: expect.objectContaining({
        reason: 'PROVIDER_SCHEMA_REPRESENTATION_UNRESOLVED', contractHash: contract.contractHash }) }))
  })
  test.each(['decision', 'title', 'assumption', 'heading', 'optional-section'])('rejects unsupported %s outside claim records', (kind) => {
    const { contract, projection, output } = fixture()
    if (kind === 'decision') output.decisionLogic = [{ ...projection.decisionProjections[0], priority: 'HIGH' }]
    if (kind === 'title') output.title = 'Evidence proves financial returns'
    if (kind === 'assumption') output.assumptions = ['Commercial authority is established.']
    if (kind === 'heading') output.sections[0].title = 'Evidence proves financial returns'
    if (kind === 'optional-section') output.sections.push({ sectionKey: 'optional', title: 'Optional', claims: [], content: '' })
    expect(() => assertEvidenceToMeaningProviderClaims({ contract, output })).toThrow()
  })
})

test.each(['person@example.test', 'api_key=secret-value'])('rejects private nested Framework guidance: %s', (text) => {
  const input = makeSs040Fixture()
  input.composition.frameworkIntelligence = { instructions: [{ nested: { guidance: text } }] }
  const contract = compileEvidenceToMeaningContract(input)
  expect(contract.status).toBe('READY')
  expect(() => projectEvidenceToMeaningProviderContract(contract)).toThrow(expect.objectContaining({
    code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: expect.objectContaining({
      clarification: expect.objectContaining({ missingFields: ['frameworkGuidance.content.instructions[0].nested.guidance'] }) }) }))
})
