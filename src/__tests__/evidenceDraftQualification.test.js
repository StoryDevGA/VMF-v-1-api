import { describe, test, expect } from '@jest/globals'
import { recordEvidenceDraftQualification, assertEvidenceDraftQualification, projectEvidenceDraftQualification,
  evidenceDraftMaterialFingerprint, preserveEvidenceDraftQualification, evidenceDraftQualificationRequestSchema,
  evidenceDraftQualificationFingerprint, revalidateEvidenceDraftQualification } from '../services/evidenceDraftQualification.js'
import { normalizeDiscoveryEvidenceObjects, applyDiscoveryEvidenceReview } from '../services/discoveryIntelligenceService.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { createRuntimeStateLegacySourceRowSet, createRuntimeStateLegacyRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildRuntimeIntelligenceGraphForFrameworkState } from '../services/runtimeIntelligenceGraphService.js'
import { getAcceptedDiscoveryEvidenceObjects } from '../services/runtimeSectionModelService.js'
import { createRuntimeStateCanonicalMappingManifest } from '../services/runtimeStateCanonicalSerializer.js'
import { __testables as repository } from '../services/runtimeStateRepository.js'
import { compileEvidenceToMeaningContract, hashEvidenceToMeaningValue } from '../services/outcomeEvidenceToMeaningContractService.js'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'

const actor = '64b7f7a4e1e5f8320c000001'
const source = () => ({ sourceId: 'source-1', sourceType: 'WEBSITE', title: 'Recorded synthetic pilot source', lineageRef: 'lineage:source-1' })
const evidence = () => ({ evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'The bounded synthetic pilot remains subject to access review.',
  lineageRef: 'lineage:source-1', reviewStatus: 'ACCEPTED', validationStatus: 'UNVALIDATED' })
const facts = row => ({ claimStatus: 'SOURCE_PRESENTED', classification: 'CUSTOMER_EVIDENCE', currentness: 'CURRENT',
  sourceLocation: 'synthetic-source#paragraph-1', scope: 'Disposable synthetic pilot only', time: 'Source statement at 18 October2026',
  attribution: 'Explicit synthetic source statement', permittedStatement: row.extractedFact,
  permittedInterpretation: 'EXACT_STATEMENT_ONLY', confidenceWarnings: ['Source-presented; independent proof remains absent.'],
  blockedStrongerClaim: ['No authorization to execute or claim customer results.'], proofDependency: [],
  proofOrderDisposition: 'NOT_ESTABLISHED', proofOrder: [], proofRequirementCodes: [],
  evidenceRequiredToSubstantiate: ['Independent access approval and outcome measurement.'] })
const fixture = async () => {
  const input = await makeSs041Fixture()
  const selectedTarget = input.selectedTarget
  const row = evidence(), owner = source()
  row.draftQualification = recordEvidenceDraftQualification({ evidence: row, source: owner, sourceSectionKeys: ['customer_context'],
    selectedTarget, targetSectionKeys: [selectedTarget.receipt.targetSections.required[0].targetSectionKey], facts: facts(row), actorUserId: actor,
    authoredAt: '2026-10-18T10:00:00.000Z' })
  return { row, owner, input, selectedTarget }
}
describe('explicit source-presented qualification, no persistence proof', () => {
  test('keeps absent legacy envelopes absent without defaults', () => {
    const row = evidence()
    expect(assertEvidenceDraftQualification({ evidence: row })).toBeNull()
    expect(projectEvidenceDraftQualification({ evidence: row })).toBeNull()
    expect(preserveEvidenceDraftQualification(row, row)).toBe(row)
    expect(new RuntimeEvidenceObject().draftQualification).toBeUndefined()
    expect(normalizeDiscoveryEvidenceObjects({ evidenceObjects: [row], sourceRegistry: [] }))
      .toEqual(normalizeDiscoveryEvidenceObjects({ evidenceObjects: [row] }))
  })
  test('roundtrips exact authored metadata through normalizer without graph validation promotion', async () => {
    const { row, owner } = await fixture()
    const result = normalizeDiscoveryEvidenceObjects({ evidenceObjects: [row], sourceRegistry: [owner],
      sources: [{ sourceId: owner.sourceId, type: 'USER_PROVIDED_INPUT', fieldKey: 'companyName' }] })[0]
    expect(result.draftQualification).toEqual(row.draftQualification)
    expect(result.validationStatus).toBe('UNVALIDATED')
    expect(result.extractedFact).toBe(row.extractedFact)
    expect(assertEvidenceDraftQualification({ evidence: result, source: owner })).toEqual(row.draftQualification)
    expect(projectEvidenceDraftQualification({ evidence: result, source: owner }).proofOrderDisposition).toBe('NOT_ESTABLISHED')
  })
  test.each(['missing', 'duplicate', 'changed', 'lineage-only'])('rejects %s canonical source without falling back to lineage', async mode => {
    const { row, owner } = await fixture()
    let sourceRegistry = [owner]
    if (mode === 'missing') sourceRegistry = undefined
    if (mode === 'duplicate') sourceRegistry = [owner, owner]
    if (mode === 'changed') sourceRegistry = [{ ...owner, title: 'Different source' }]
    if (mode === 'lineage-only') sourceRegistry = [{ sourceId: owner.sourceId, type: 'WEBSITE' }]
    expect(() => normalizeDiscoveryEvidenceObjects({ evidenceObjects: [row], sourceRegistry, sources: [owner] }))
      .toThrow(expect.objectContaining({ code: 'EVIDENCE_DRAFT_QUALIFICATION_INVALID' }))
  })
  test('actual graph, accepted-section owner and mapper retain authored evidence against canonical sources', async () => {
    const { row, owner } = await fixture()
    const pack = { accepted: true, state: { accepted: true }, evidenceObjects: [row], sourceRegistry: [owner],
      lineage: { sources: [{ sourceId: owner.sourceId, type: 'USER_PROVIDED_INPUT', fieldKey: 'companyName' }] } }
    const sections = { customer_context: { accepted: { supportingEvidenceRefs: [row.evidenceObjectId] } } }
    const runtimeInstance = { _id: actor, customerId: actor, tenantId: actor, frameworkId: actor,
      runtimeInstanceKey: 'synthetic-child', runtimeType: 'VALUE_NARRATIVE' }
    const frameworkPackage = { frameworkKey: 'FIXTURE', packageKey: 'fixture', version: '1',
      sections: [{ sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' }] }
    const before = JSON.stringify(pack)
    expect(getAcceptedDiscoveryEvidenceObjects(pack)[0].draftQualification).toEqual(row.draftQualification)
    const graph = buildRuntimeIntelligenceGraphForFrameworkState({ runtimeInstance, frameworkPackage,
      frameworkState: { sections, evidence_pack: pack }, builtAt: '2026-10-18T10:00:00.000Z' })
    expect(graph.validation.status).toBe('VALID')
    const mapped = createRuntimeStateLegacyRowSet({ legacyInput: { rawBsonBytes: 4096, sections,
      evidencePack: pack, intelligenceGraph: graph }, scope: { runtimeInstanceId: actor, customerId: actor,
      tenantId: actor, runtimeInstanceKey: 'synthetic-child' }, stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
      migrationReceiptId: actor, migrationTimestamp: '2026-10-18T10:00:00.000Z' })
    expect(mapped.rows.evidenceObjects[0].draftQualification).toEqual(row.draftQualification)
    expect(mapped.rows.evidenceObjects[0].extractedFact).toBe(row.extractedFact)
    expect(JSON.stringify(pack)).toBe(before)
    const changed = { ...pack, sourceRegistry: [{ ...owner, title: 'Changed canonical source' }] }
    expect(() => getAcceptedDiscoveryEvidenceObjects(changed)).toThrow()
    expect(() => buildRuntimeIntelligenceGraphForFrameworkState({ runtimeInstance, frameworkPackage,
      frameworkState: { sections, evidence_pack: changed } })).toThrow(expect.objectContaining({ code: 'EVIDENCE_DRAFT_QUALIFICATION_INVALID' }))
  })
  test.each(['passage', 'source', 'review', 'validation', 'target', 'membership', 'extra', 'established', 'proof', 'oversize', 'self', 'null'])('rejects %s drift without resealing', async mode => {
    const { row, owner, selectedTarget } = await fixture()
    let membership = ['customer_context'], target = selectedTarget
    if (mode === 'passage') row.extractedFact += ' Changed.'
    if (mode === 'source') owner.title += ' Changed'
    if (mode === 'review') row.reviewStatus = 'PENDING'
    if (mode === 'validation') row.validationStatus = 'VALIDATED'
    if (mode === 'target') target = { ...selectedTarget, receiptFingerprint: 'a'.repeat(64) }
    if (mode === 'membership') membership = ['different-section']
    if (mode === 'extra') row.draftQualification.facts.force = true
    if (mode === 'established') row.draftQualification.facts.claimStatus = 'ESTABLISHED'
    if (mode === 'proof') row.draftQualification.facts.proofOrderDisposition = 'ESTABLISHED'
    if (mode === 'oversize') row.draftQualification.facts.blockedStrongerClaim = Array.from({ length: 30 }, (_, i) => String(i) + 'x'.repeat(900))
    if (mode === 'self') row.draftQualification.facts.proofDependency = [row.evidenceObjectId]
    if (mode === 'null') row.draftQualification = null
    expect(() => assertEvidenceDraftQualification({ evidence: row, source: owner, sourceSectionKeys: membership, selectedTarget: target })).toThrow()
  })
  test('does not reseal an envelope after review changes its base', async () => {
    const { row } = await fixture()
    const reviewed = applyDiscoveryEvidenceReview({ actorUserId: actor, evidenceObjectId: row.evidenceObjectId,
      evidenceObjects: [row], reviewStatus: 'REJECTED', reviewedAt: '2026-10-18T11:00:00Z' }).evidenceObjects[0]
    expect(reviewed.draftQualification).toEqual(row.draftQualification)
    expect(() => assertEvidenceDraftQualification({ evidence: reviewed })).toThrow()
  })
  test('typed model validates envelope against original native evidence material', async () => {
    const { row } = await fixture()
    const common = { runtimeInstanceId: actor, customerId: actor, tenantId: actor, runtimeInstanceKey: 'synthetic-child',
      stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000', sourceStateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
      migrationReceiptId: actor, sourceHash: 'sha256:' + 'a'.repeat(64) }
    const doc = new RuntimeEvidenceObject({ ...common, ...row })
    expect(doc.validateSync()).toBeUndefined()
    expect(doc.toObject().draftQualification).toEqual(row.draftQualification)
    doc.extractedFact += ' changed'
    expect(doc.validateSync()).toBeDefined()
  })
  test('actual mapper and bounded serializer retain exact envelope and reject changed source', async () => {
    const { row, owner } = await fixture()
    const stateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
    const input = { legacyInput: { rawBsonBytes: 4096, sections: { customer_context: { accepted: { supportingEvidenceRefs: [row.evidenceObjectId] } } },
      evidencePack: { evidenceObjects: [row], sourceRegistry: [owner] }, intelligenceGraph: { graphVersion: 'graph-v1', nodes: [], edges: [] } },
    scope: { runtimeInstanceId: actor, customerId: actor, tenantId: actor, runtimeInstanceKey: 'synthetic-child' },
    stateVersion, migrationReceiptId: actor, migrationTimestamp: '2026-10-18T10:00:00.000Z' }
    createRuntimeStateCanonicalMappingManifest(input.legacyInput)
    const mapped = createRuntimeStateLegacySourceRowSet(input).rows.evidenceObjects[0]
    expect(mapped.draftQualification).toEqual(row.draftQualification)
    expect(repository.serializeEvidenceObject(mapped, stateVersion).draftQualification).toEqual(row.draftQualification)
    owner.title += ' Changed'
    expect(() => createRuntimeStateLegacySourceRowSet(input)).toThrow()
    mapped.draftQualification.facts.force = true
    expect(() => repository.serializeEvidenceObject(mapped, stateVersion)).toThrow()
  })
  test('strict request cannot set status, actor or provider authority', async () => {
    const { row } = await fixture()
    const body = { expectedUpdatedAt: '2026-10-18T10:00:00.000Z', expectedEvidenceFingerprint: evidenceDraftMaterialFingerprint(row),
      expectedSourceFingerprint: row.draftQualification.binding.sourceFingerprint,
      expectedTargetFingerprint: row.draftQualification.binding.targetReceiptFingerprint,
      requestedOutputTypeKey: 'synthetic-output', requestedFormat: 'MARKDOWN', targetSectionKeys: ['summary'],
      facts: facts(row), rationale: 'Grounded synthetic fixture qualification.' }
    expect(evidenceDraftQualificationRequestSchema.safeParse(body).success).toBe(true)
    for (const key of ['validationStatus', 'actorUserId', 'providerRuntimeDeps', 'force']) {
      expect(evidenceDraftQualificationRequestSchema.safeParse({ ...body, [key]: true }).success).toBe(false)
    }
  })
  test('compiler consumes validated local values while evidence hash and snapshot remain raw', async () => {
    const input = await makeSs041Fixture()
    const raw = input.sourceSnapshot.evidenceObjects[0], owner = input.sourceSnapshot.sourceRegistry.find(row => row.sourceId === raw.sourceId)
    const keys = input.sourceSnapshot.inventoryReceipt.sectionCoverage.filter(section => section.evidenceIds.includes(raw.evidenceObjectId)).map(section => section.sectionKey)
    const targets = [...keys]
    for (const field of ['claimStatus', 'scope', 'time', 'attribution', 'currentness', 'permittedInterpretation', 'blockedStrongerClaim',
      'confidenceWarnings', 'proofOrder', 'proofOrderDisposition', 'proofRequirementCodes', 'proofDependency', 'evidenceRequiredToSubstantiate', 'permittedStatement']) delete raw[field]
    raw.draftQualification = recordEvidenceDraftQualification({ evidence: raw, source: owner, sourceSectionKeys: keys,
      selectedTarget: input.selectedTarget, targetSectionKeys: targets, facts: facts(raw), actorUserId: actor })
    const fact = input.composition.businessFactLedger.facts.find(row => row.evidenceObjectId === raw.evidenceObjectId)
    fact.qualification = [...raw.draftQualification.facts.confidenceWarnings].sort()
    fact.currentness = 'CURRENT'
    await freezeSs041Snapshot(input)
    const before = JSON.stringify(input.sourceSnapshot)
    const result = compileEvidenceToMeaningContract(input)
    const claim = result.customerClaims.find(row => row.evidenceReference === raw.evidenceObjectId)
    expect(claim.evidenceHash).toBe(hashEvidenceToMeaningValue(input.sourceSnapshot.evidenceObjects.find(row => row.evidenceObjectId === raw.evidenceObjectId)))
    expect(claim.claimStatus).toBe('SOURCE_PRESENTED')
    expect(claim.draftPlacement).toEqual(expect.objectContaining({ targetReceiptFingerprint: input.selectedTarget.receiptFingerprint }))
    expect(JSON.stringify(input.sourceSnapshot)).toBe(before)
    expect(result.clarification.errors).toEqual([])
  })
})


describe('explicit binding-only qualification revalidation, pure contract', () => {
  const argsFor = async () => {
    const f = await fixture()
    return { ...f, args: { evidence: f.row, source: f.owner, sourceSectionKeys: ['customer_context', 'stakeholder_register'],
      selectedTarget: f.selectedTarget, targetSectionKeys: [...f.row.draftQualification.binding.targetSectionKeys],
      facts: JSON.parse(JSON.stringify(f.row.draftQualification.facts)),
      expectedQualificationFingerprint: evidenceDraftQualificationFingerprint(f.row.draftQualification),
      actorUserId: actor, authoredAt: '2026-10-20T06:00:00.000Z' } }
  }
  test('revalidates only membership and actual author/time, preserving original facts and envelope', async () => {
    const { row, args } = await argsFor(), before = JSON.stringify(row)
    const result = revalidateEvidenceDraftQualification(args)
    expect(result.binding.sourceSectionKeys).toEqual(['customer_context', 'stakeholder_register'])
    expect(result.facts).toEqual(row.draftQualification.facts)
    expect(result.binding).toEqual({ ...row.draftQualification.binding, sourceSectionKeys: args.sourceSectionKeys })
    expect(result.authoredAt).toBe(args.authoredAt)
    expect(evidenceDraftQualificationFingerprint(result)).not.toBe(args.expectedQualificationFingerprint)
    expect(evidenceDraftQualificationFingerprint(JSON.parse(JSON.stringify(result)))).toBe(evidenceDraftQualificationFingerprint(result))
    expect(JSON.stringify(row)).toBe(before)
    expect(() => assertEvidenceDraftQualification({ evidence: { ...row, draftQualification: result }, source: args.source,
      sourceSectionKeys: ['customer_context'], selectedTarget: args.selectedTarget })).toThrow()
  })
  test.each([
    ['stale prior hash', a => { a.expectedQualificationFingerprint = 'a'.repeat(64) }],
    ['no-op membership', a => { a.sourceSectionKeys = ['customer_context'] }],
    ['changed fact qualification', a => { a.facts.scope = 'A different scope' }],
    ['changed evidence passage', a => { a.evidence.extractedFact += ' Changed' }],
    ['changed source material', a => { a.source.title += ' Changed' }],
    ['changed target receipt', a => { a.selectedTarget = { ...a.selectedTarget, receiptFingerprint: 'a'.repeat(64) } }],
    ['changed target section membership', a => { a.targetSectionKeys = ['other-target'] }],
  ])('binding-only rejects %s without modifying the previous envelope', async (_name, alter) => {
    const f = await argsFor(); alter(f.args)
    const before = JSON.stringify(f.args.evidence)
    expect(() => revalidateEvidenceDraftQualification(f.args)).toThrow(expect.objectContaining({ code: 'EVIDENCE_DRAFT_QUALIFICATION_INVALID' }))
    expect(JSON.stringify(f.args.evidence)).toBe(before)
  })
  test('strict request requires mode and prior hash together and retains legacy AUTHOR payload', async () => {
    const { row } = await fixture()
    const base = { expectedUpdatedAt: '2026-10-20T06:00:00.000Z', expectedEvidenceFingerprint: evidenceDraftMaterialFingerprint(row),
      expectedSourceFingerprint: row.draftQualification.binding.sourceFingerprint,
      expectedTargetFingerprint: row.draftQualification.binding.targetReceiptFingerprint,
      requestedOutputTypeKey: 'synthetic-output', requestedFormat: 'MARKDOWN', targetSectionKeys: ['summary'],
      facts: facts(row), rationale: 'Explicit metadata-only binding revalidation.' }
    const hash = evidenceDraftQualificationFingerprint(row.draftQualification)
    expect(evidenceDraftQualificationRequestSchema.safeParse(base).success).toBe(true)
    expect(evidenceDraftQualificationRequestSchema.safeParse({ ...base, mode: 'REVALIDATE_BINDING', expectedQualificationFingerprint: hash }).success).toBe(true)
    for (const extra of [{ mode: 'REVALIDATE_BINDING' }, { expectedQualificationFingerprint: hash },
      { mode: 'AUTHOR', expectedQualificationFingerprint: hash }, { mode: 'REVALIDATE_BINDING', expectedQualificationFingerprint: 'invalid' }]) {
      expect(evidenceDraftQualificationRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false)
    }
  })
})
