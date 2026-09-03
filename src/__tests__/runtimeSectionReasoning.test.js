import { describe, expect, jest, test } from '@jest/globals'

import {
  buildCustomerContextReasoningCoverage,
  buildReasonedGeneratedSection,
  buildVmfSectionReasoningCoverage,
} from '../services/runtimeSectionReasoningService.js'
import {
  createOpenAiRuntimeSectionReasoningAdapter,
  runtimeSectionIntelligenceJsonSchema,
  validateRuntimeSectionIntelligence,
} from '../services/openAiRuntimeSectionReasoningAdapter.js'
import {
  SECTION_COMPLETENESS_BINDING,
  executeSectionValidationRules,
} from '../services/sectionValidationExecutorService.js'
import { requiresVmfSectionReasoning } from '../services/sectionExecutionContractService.js'
import { buildRuntimeSectionRevision, getAcceptedDiscoveryEvidenceObjects, hashSectionInput, normalizeRuntimeSectionObject } from '../services/runtimeSectionModelService.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildFrameworkOutcomeStudioHandoff } from '../services/outcomeFrameworkHandoffService.js'
import { __testables as repositoryTestables } from '../services/runtimeStateRepository.js'

const makeEvidence = (index) => ({
  evidenceObjectId: `evidence_${index}`,
  sourceId: `source_${index}`,
  reviewStatus: 'ACCEPTED',
  category: index % 2 === 0 ? 'Company' : 'Proof',
  coverageArea: index % 3 === 0 ? 'Decision Context' : 'Products',
  extractedFact: `Company platform observability commercial replacement investor decision proof claim customer market context ${index}.`,
})

const guidedSections = [
  ['customer-context', 'framework_state.sections.customer_context'],
  ['strategic-objectives', 'framework_state.sections.strategic_objectives'],
  ['current-state-assessment', 'framework_state.sections.current_state_assessment'],
  ['stakeholder-register', 'framework_state.sections.stakeholder_register'],
  ['evidence-register', 'framework_state.sections.evidence_register'],
  ['output-requirements', 'framework_state.sections.output_requirements'],
].map(([sectionKey, runtimePath]) => ({ sectionKey, runtimePath }))

const makeFrameworkPackage = (version = '3.1.5') => ({
  frameworkKey: 'VMF',
  packageKey: 'standard-package-value-mapping-framework-3-1-5-runtime-knowledge-model',
  version,
  sections: guidedSections,
})

const makeOutput = () => ({
  sectionSummary: 'The company has a credible operating context with a material commercial positioning choice.',
  sectionNarrative: 'The accepted evidence supports a customer context centred on infrastructure observability and decision confidence.',
  commercialInterpretation: 'The commercial centre is a replacement-led proposition with a broader operational intelligence opportunity.',
  strategicTensions: [{
    signal: 'Replacement clarity competes with a broader strategic narrative.',
    interpretation: 'The wider story is valuable only when it remains anchored in supported capability.',
    evidenceRefs: ['evidence_1', 'evidence_2'],
  }],
  supportedClaims: [{ claim: 'The offer addresses infrastructure observability.', interpretation: 'This is directly stated.', evidenceRefs: ['evidence_1'] }],
  representedClaims: [{ claim: 'The company presents a broader intelligence ambition.', interpretation: 'Treat this as company positioning.', evidenceRefs: ['evidence_2'] }],
  restrictedClaims: [{ claim: 'Quantified ROI is proven.', interpretation: 'Do not assert without direct proof.', evidenceRefs: ['evidence_3'] }],
  evidenceBoundaries: [{ boundary: 'Keep ROI qualified.', rationale: 'The evidence does not independently validate it.', evidenceRefs: ['evidence_3'] }],
  contradictionSignals: [],
  alternativeInterpretations: [{ signal: 'The offer may remain primarily a replacement proposition.', interpretation: 'The broader category is not yet independently proven.', evidenceRefs: ['evidence_1'] }],
  decisionRelevance: 'Downstream work should lead with the operating problem and preserve the proof boundary.',
  downstreamHandoffSignals: [{ signal: 'Lead with decision confidence.', relevance: 'This connects technical context to commercial relevance.', evidenceRefs: ['evidence_1', 'evidence_2'] }],
  sourceTraceability: ['evidence_1', 'evidence_2', 'evidence_3'],
  validationGaps: [],
})

const makeExecutionContract = () => ({
  contractVersion: 'section-execution-contract-v1',
  sectionContractHash: 'a'.repeat(64),
  sectionIdentity: {
    sectionKey: 'customer_context',
    runtimePath: 'framework_state.sections.customer_context',
    label: 'Customer Context',
    purpose: 'Interpret the governed customer and offer context.',
  },
  runtimeInstructions: {
    stableId: 'skill-customer-context-reasoning-test',
    key: 'customer-context-reasoning-test',
    componentVersion: 1,
    description: 'Test-only reasoning contract.',
  },
  runtimeSupportAssets: [{
    assetKey: 'customer-context-policy-guidance',
    assetType: 'POLICY_GUIDANCE',
    contentHash: 'b'.repeat(64),
    byteLength: 24,
    content: 'Governed runtime guidance.',
  }],
  validationRules: [],
})

const makeValidationContract = () => ({
  ...makeExecutionContract(),
  validationRules: [{
    stableId: 'validation-section-completeness-validator',
    key: 'section-completeness-validator',
    componentVersion: 1,
    blockingDefault: true,
    metadataOnlyDuringGeneration: false,
    executionBinding: {
      selectionKey: SECTION_COMPLETENESS_BINDING.selectionKey,
      executorVersion: 'test',
      producerSkill: { stableId: 'skill-section-completeness-validator', key: 'section-completeness-validator', componentVersion: 1 },
    },
  }],
})

describe('VMF Customer Context section reasoning', () => {
  test('recognises the released hyphenated Customer Context section key', () => {
    expect(requiresVmfSectionReasoning({
      frameworkPackage: makeFrameworkPackage(),
      sectionKey: 'customer-context',
      runtimePath: 'framework_state.sections.customer_context',
    })).toBe(true)
  })

  test('includes every unique evidence record beyond the former 120-item selection cap', () => {
    const evidenceObjects = Array.from({ length: 803 }, (_value, index) => ({
      ...makeEvidence(index + 1), sourceId: index < 800 ? 'source_bulk' : 'source_minor',
      validationStatus: index % 2 ? 'VALIDATED' : 'UNVALIDATED',
    }))
    const before = JSON.stringify(evidenceObjects)
    const coverage = buildCustomerContextReasoningCoverage({
      evidenceObjects,
    })

    expect(coverage.algorithm).toBe('SECTION_REASONING_COVERAGE')
    expect(coverage.version).toBe('ss-016-vmf-full-evidence-v2')
    expect(coverage.eligibleAcceptedCount).toBe(803)
    expect(coverage.includedCount).toBe(803)
    expect(coverage.excludedCount).toBe(0)
    expect(coverage.evidence).toEqual(evidenceObjects.map((item) => ({
      evidenceObjectId: item.evidenceObjectId, sourceId: item.sourceId,
      excerpt: item.extractedFact,
    })))
    expect(coverage.validationStatusByEvidenceIndex).toEqual(evidenceObjects.map((item) => item.validationStatus))
    expect(coverage.selectedEvidenceHash).toBe(hashSectionInput({
      evidence: coverage.evidence, validationStatusByEvidenceIndex: coverage.validationStatusByEvidenceIndex,
    }))
    expect(coverage.dimensionCoverage).toHaveLength(6)
    expect(coverage.allEvidenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(buildCustomerContextReasoningCoverage({ evidenceObjects })).toEqual(coverage)
    expect(JSON.stringify(evidenceObjects)).toBe(before)
  })

  test('retains full late qualifiers, low-keyword facts and empty validation status without truncation markers', () => {
    const qualifier = 'The 35% and 48% figures are illustrative only, not validated customer outcomes.'
    const fact = `${'Neutral introductory text. '.repeat(60)}${qualifier}`
    const coverage = buildCustomerContextReasoningCoverage({ evidenceObjects: [
      { evidenceObjectId: 'long', sourceId: 's1', extractedFact: fact, reviewStatus: 'ACCEPTED', validationStatus: 'UNVALIDATED' },
      { evidenceObjectId: 'short', sourceId: 's2', extractedFact: 'UK', reviewStatus: 'ACCEPTED' },
    ] })
    expect(fact.indexOf(qualifier)).toBeGreaterThan(1200)
    expect(coverage.evidence).toEqual([
      { evidenceObjectId: 'long', sourceId: 's1', excerpt: fact },
      { evidenceObjectId: 'short', sourceId: 's2', excerpt: 'UK' },
    ])
    expect(coverage.validationStatusByEvidenceIndex).toEqual(['UNVALIDATED', ''])
    expect(coverage.includedCount).toBe(2)
  })

  test('deduplicates identical projected IDs without discarding a later distinct record', () => {
    const first = { ...makeEvidence(1), validationStatus: 'VALIDATED' }
    const coverage = buildCustomerContextReasoningCoverage({ evidenceObjects: [
      first, { ...first }, { ...first, category: 'Different diagnostic metadata' }, makeEvidence(2),
      null, {}, { evidenceObjectId: 'bad', extractedFact: ' ' }, { extractedFact: 'No ID' },
    ] })
    expect(coverage.evidence.map((item) => item.evidenceObjectId)).toEqual(['evidence_1', 'evidence_2'])
    expect(coverage.eligibleAcceptedCount).toBe(2)
    expect(coverage.includedCount).toBe(2)
    expect(coverage.excludedCount).toBe(0)
    expect(coverage.validationStatusByEvidenceIndex).toEqual(['VALIDATED', ''])
  })

  test.each([
    ['source', { sourceId: 'different_source' }],
    ['fact', { extractedFact: 'A different substantive statement.' }],
    ['validation status', { validationStatus: 'UNVALIDATED' }],
  ])('rejects a duplicate ID with conflicting projected %s', (_, change) => {
    const first = { ...makeEvidence(1), validationStatus: 'VALIDATED' }
    expect(() => buildCustomerContextReasoningCoverage({ evidenceObjects: [first, { ...first, ...change }] }))
      .toThrow(expect.objectContaining({ status: 409, code: 'VMF_SECTION_REASONING_EVIDENCE_CONFLICT' }))
  })

  test.each([
    { label: 'empty input', evidenceObjects: [] },
    { label: 'malformed input', evidenceObjects: [null, {}, { evidenceObjectId: 'empty', extractedFact: '' }] },
  ])(
    'fails closed when no well-formed evidence remains: $label', ({ evidenceObjects }) => {
      expect(() => buildCustomerContextReasoningCoverage({ evidenceObjects }))
        .toThrow(expect.objectContaining({ status: 409, code: 'VMF_SECTION_REASONING_EVIDENCE_MISSING' }))
    },
  )

  test('reports all dimension matches without selection ID lists or filtering nonmatches', () => {
    const evidenceObjects = Array.from({ length: 25 }, (_, index) => ({
      evidenceObjectId: `e${index}`, sourceId: 's', extractedFact: 'Revenue', reviewStatus: 'ACCEPTED',
    }))
    evidenceObjects.push({ evidenceObjectId: 'neutral', sourceId: 's', extractedFact: 'UK', reviewStatus: 'ACCEPTED' })
    const coverage = buildCustomerContextReasoningCoverage({ evidenceObjects })
    expect(coverage.includedCount).toBe(26)
    expect(coverage.dimensionCoverage).toEqual([
      { dimensionKey: 'customer_offer_identity', matchingCount: 0, selectedCount: 0 },
      { dimensionKey: 'buyer_operating_context', matchingCount: 0, selectedCount: 0 },
      { dimensionKey: 'commercial_context', matchingCount: 25, selectedCount: 25 },
      { dimensionKey: 'strategic_tension', matchingCount: 0, selectedCount: 0 },
      { dimensionKey: 'proof_claim_boundaries', matchingCount: 0, selectedCount: 0 },
      { dimensionKey: 'decision_handoff', matchingCount: 0, selectedCount: 0 },
    ])
  })

  test('produces rich generated intelligence through the bounded provider path', async () => {
    const providerAdapter = jest.fn().mockResolvedValue({
      output: makeOutput(),
      provider: { providerKey: 'openai', model: 'test-model' },
      metadata: { storedByProvider: false },
    })
    const frameworkPackage = makeFrameworkPackage()
    const section = {
      sectionKey: 'customer_context',
      runtimePath: 'framework_state.sections.customer_context',
    }
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      actorUserId: 'user_1',
      frameworkPackage,
      frameworkState: {
        evidence_pack: {
          accepted: true,
          evidenceObjects: [
            ...Array.from({ length: 20 }, (_value, index) => ({
              ...makeEvidence(index + 1), validationStatus: index === 0 ? 'UNVALIDATED' : 'VALIDATED',
            })),
            { ...makeEvidence(21), reviewStatus: 'REJECTED' },
            { ...makeEvidence(22), reviewStatus: 'PENDING_REVIEW' },
          ],
        },
      },
      generatedAt: '2026-09-02T12:00:00.000Z',
      input: 'Preserve the customer operating context.',
      providerRuntime: {
        status: { configured: true },
        providerAdapter,
        providerDescriptor: { providerKey: 'openai', model: 'test-model' },
      },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section,
      sectionExecutionContract: makeExecutionContract(),
    })

    expect(providerAdapter).toHaveBeenCalledTimes(1)
    expect(result.generated.generator).toEqual(expect.objectContaining({
      mode: 'GOVERNED_PROVIDER_SECTION_REASONING',
      adapter: 'ss-016-vmf-section-reasoning-v1',
    }))
    expect(result.generated.evidenceProjection.includedCount).toBeGreaterThan(10)
    expect(result.intelligence.scopedEvidence.projection.algorithm).toBe('SECTION_REASONING_COVERAGE')
    expect(result.generated.evidenceProjection.includedCount).toBe(20)
    expect(result.intelligence.scopedEvidence.sourceRefs).toHaveLength(3)
    expect(result.generated.sectionIntelligence).toEqual(makeOutput())
    expect(result.generated.content).toBe(makeOutput().sectionNarrative)
    expect(result.intelligence).not.toHaveProperty('sectionIntelligence')
    expect(result.generated.sectionIntelligence.restrictedClaims).toHaveLength(1)
    const display = result.intelligence.displayProjection
    expect(display.generatedInsight.summary).toBe(result.generated.summary)
    expect(display.generatedInsight.sections).toEqual(result.generated.sections)
    expect(display.generatedInsight.sections.map((item) => item.heading)).toContain('Commercial Interpretation')
    const selectedEvidence = providerAdapter.mock.calls[0][0].providerContext.reasoningCoverage.evidence
    const providerCoverage = providerAdapter.mock.calls[0][0].providerContext.reasoningCoverage
    expect(providerCoverage.validationStatusByEvidenceIndex).toEqual(['UNVALIDATED', ...Array(19).fill('VALIDATED')])
    expect(selectedEvidence[0]).toEqual({ evidenceObjectId: 'evidence_1', sourceId: 'source_1', excerpt: makeEvidence(1).extractedFact })
    expect(selectedEvidence.map((item) => item.evidenceObjectId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `evidence_${index + 1}`),
    )
    expect(display.supportingEvidence.items).toEqual(
      selectedEvidence.filter((item) => makeOutput().sourceTraceability.includes(item.evidenceObjectId))
        .map((item) => `${item.evidenceObjectId}: ${item.excerpt}`),
    )
    expect(display.supportingEvidence.title).toBe('Referenced Evidence')
    expect(display.supportingEvidence.items).toHaveLength(3)
    expect(display.boundaries.items).toEqual(makeOutput().evidenceBoundaries.map((item) => item.boundary))

    const validationResults = executeSectionValidationRules({
      candidate: result.generated,
      checkedAt: result.generated.generatedAt,
      sectionExecutionContract: makeValidationContract(),
    })
    expect(validationResults[0]).toEqual(expect.objectContaining({ status: 'PASS', is_valid: true }))

    const invalidCandidate = structuredClone(result.generated)
    invalidCandidate.sectionIntelligence.restrictedClaims[0].claim =
      invalidCandidate.sectionIntelligence.supportedClaims[0].claim
    expect(() => executeSectionValidationRules({
      candidate: invalidCandidate,
      checkedAt: invalidCandidate.generatedAt,
      sectionExecutionContract: makeValidationContract(),
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ contractIssue: 'SECTION_VALIDATION_FAILED' }),
    }))

    const unknownReferenceCandidate = structuredClone(result.generated)
    unknownReferenceCandidate.sectionIntelligence.supportedClaims[0].evidenceRefs = ['unknown_evidence']
    unknownReferenceCandidate.sectionIntelligence.sourceTraceability = [
      ...unknownReferenceCandidate.sectionIntelligence.sourceTraceability,
      'unknown_evidence',
    ]
    unknownReferenceCandidate.supportingEvidenceRefs = [
      ...unknownReferenceCandidate.supportingEvidenceRefs,
      'unknown_evidence',
    ]
    expect(() => executeSectionValidationRules({
      candidate: unknownReferenceCandidate,
      checkedAt: unknownReferenceCandidate.generatedAt,
      sectionExecutionContract: makeValidationContract(),
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ contractIssue: 'SECTION_VALIDATION_FAILED' }),
    }))
  })

  test('persists one full 803-ID manifest with compact receipts and three citations through model and handoff consumers', async () => {
    const evidenceObjects = Array.from({ length: 803 }, (_, index) => ({
      ...makeEvidence(index + 1), extractedFact: `Synthetic statement ${index + 1}.`,
      validationStatus: index < 333 ? 'UNVALIDATED' : 'VALIDATED',
    }))
    const providerAdapter = jest.fn().mockResolvedValue({
      output: makeOutput(), provider: { providerKey: 'openai', model: 'test-model' }, metadata: {},
    })
    const frameworkPackage = makeFrameworkPackage()
    const { generated, intelligence } = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION', frameworkPackage, actorUserId: 'user_1',
      frameworkState: { evidence_pack: { accepted: true, evidenceObjects } },
      generatedAt: '2026-09-02T12:00:00.000Z',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section: { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context' },
      sectionExecutionContract: makeExecutionContract(),
    })
    const coverage = providerAdapter.mock.calls[0][0].providerContext.reasoningCoverage
    expect(coverage.evidence).toHaveLength(803)
    expect(coverage.validationStatusByEvidenceIndex).toEqual([...Array(333).fill('UNVALIDATED'), ...Array(470).fill('VALIDATED')])
    const manifest = generated.evidenceProjection
    expect(manifest.included).toEqual(evidenceObjects.map(({ evidenceObjectId }) => ({ evidenceObjectId })))
    expect(manifest.includedCount).toBe(803)
    expect(manifest.excludedCount).toBe(0)
    const { included, ...receipt } = manifest
    expect(intelligence.reasoningCoverage).toEqual(receipt)
    expect(intelligence.scopedEvidence.projection).toEqual(receipt)
    for (const compact of [intelligence.reasoningCoverage, intelligence.scopedEvidence.projection]) {
      expect(compact).not.toHaveProperty('included')
      expect(compact.allEvidenceHash).toBe(coverage.allEvidenceHash)
      expect(compact.selectedEvidenceHash).toBe(coverage.selectedEvidenceHash)
    }
    expect(generated.evidenceHash).toBe(coverage.allEvidenceHash)
    expect(intelligence.scopedEvidence.evidenceHash).toBe(coverage.allEvidenceHash)
    expect(generated.sectionIntelligence).toEqual(makeOutput())
    expect(generated.supportingEvidenceRefs).toEqual(makeOutput().sourceTraceability)
    expect(intelligence.scopedEvidence.sourceRefs.map((item) => item.refKey)).toEqual(makeOutput().sourceTraceability)
    expect(intelligence.displayProjection.supportingEvidence).toEqual({
      title: 'Referenced Evidence',
      items: evidenceObjects.slice(0, 3).map((item) => `${item.evidenceObjectId}: ${item.extractedFact}`),
    })

    const sectionDetail = normalizeRuntimeSectionObject({
      sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context',
      value: { input: null, generated, accepted: null, intelligence, state: { status: 'GENERATED' },
        revisions: [buildRuntimeSectionRevision({ generated, revisionNumber: 1,
          replacedAt: '2026-09-02T12:01:00.000Z', reason: 'SECTION_GENERATION_REPLACED' })] },
    })
    const stateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
    const storedSections = JSON.parse(JSON.stringify({ customer_context: sectionDetail }))
    const mapped = createRuntimeStateLegacySourceRowSet({
      legacyInput: {
        rawBsonBytes: Buffer.byteLength(JSON.stringify(storedSections), 'utf8'),
        sections: storedSections, evidencePack: { sourceRegistry: [], evidenceObjects: [] },
        intelligenceGraph: { graphVersion: stateVersion, nodes: [], edges: [] },
      },
      scope: { runtimeInstanceId: 'a27f1f77bcf86cd799439111', runtimeInstanceKey: 'compact-reasoning-test',
        customerId: '607f1f77bcf86cd799439022', tenantId: '707f1f77bcf86cd799439033' },
      stateVersion, migrationReceiptId: '64b000000000000000000004',
      migrationTimestamp: '2026-09-02T12:01:00.000Z',
    })
    const row = new RuntimeStateSection(mapped.rows.sections[0])
    expect(row.validateSync()).toBeUndefined()
    expect(row.sectionDetail.revisions).toHaveLength(1)

    // Use the repository's actual inclusion projection, then the real handoff builder.
    const project = (value, paths) => {
      if (paths.some((path) => path.length === 0)) return value
      if (Array.isArray(value)) return value.map((item) => project(item, paths))
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
        const childPaths = paths.filter((path) => path[0] === key).map((path) => path.slice(1))
        return childPaths.length ? [[key, project(child, childPaths)]] : []
      }))
    }
    // Handoff consumes accepted truth; this test does not perform acceptance.
    const handoffSection = { ...sectionDetail,
      accepted: { content: generated.content, truthHash: `sha256:${'b'.repeat(64)}` },
      state: { status: 'ACCEPTED' },
    }
    const projected = project({ sectionDetail: handoffSection }, Object.keys(repositoryTestables.RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION)
      .map((path) => path.split('.'))).sectionDetail
    const handoffFor = (section) => buildFrameworkOutcomeStudioHandoff({ frameworkPackage,
      runtimeInstance: { _id: 'a27f1f77bcf86cd799439111', runtimeInstanceKey: 'compact-reasoning-test',
        packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version,
        framework_state: { sections: { customer_context: section }, evidence_pack: { accepted: true, evidenceObjects } } },
    })
    const fullHandoff = handoffFor(handoffSection)
    const boundedHandoff = handoffFor(projected)
    expect(boundedHandoff.sectionTruth[0].projectionReceipt).toEqual(fullHandoff.sectionTruth[0].projectionReceipt)
    expect(boundedHandoff.sectionTruth[0].projectionReceipt.includedCount).toBe(803)
    expect(boundedHandoff.sectionTruth[0].projectionReceipt.selectedEvidenceRefs.map((item) => item.evidenceObjectId))
      .toEqual(included.map((item) => item.evidenceObjectId))
  })

  test('maps long valid provider fields with twelve handoff signals, accepted truth and one prior revision within unchanged model limits', async () => {
    const output = makeOutput()
    output.sectionNarrative = 'N'.repeat(7000)
    output.commercialInterpretation = 'C'.repeat(1500)
    output.decisionRelevance = 'D'.repeat(1500)
    output.downstreamHandoffSignals = Array.from({ length: 12 }, (_, index) => ({
      signal: `Signal ${index + 1}`, relevance: 'R'.repeat(1200), evidenceRefs: ['evidence_1'],
    }))
    validateRuntimeSectionIntelligence(output, { allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'] })
    expect(Buffer.byteLength(JSON.stringify(output), 'utf8')).toBeLessThan(56 * 1024)
    const frameworkPackage = makeFrameworkPackage()
    const generate = (result, count) => buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION', frameworkPackage,
      frameworkState: { evidence_pack: { accepted: true,
        evidenceObjects: Array.from({ length: count }, (_, index) => makeEvidence(index + 1)) } },
      generatedAt: '2026-09-02T12:00:00.000Z',
      providerRuntime: { status: { configured: true }, providerAdapter: async () => ({ output: result,
        provider: { providerKey: 'fake', model: 'test-model' }, metadata: {} }) },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section: { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context' },
      sectionExecutionContract: makeExecutionContract(),
    })
    const prior = await generate(makeOutput(), 39)
    const { generated, intelligence } = await generate(output, 803)
    const validationResults = executeSectionValidationRules({ candidate: generated,
      checkedAt: generated.generatedAt, sectionExecutionContract: makeValidationContract() })
    expect(validationResults[0]).toEqual(expect.objectContaining({ status: 'PASS', is_valid: true }))
    expect(generated.content).toBe(output.sectionNarrative)
    expect(generated.sectionIntelligence).toEqual(output)
    expect(intelligence).not.toHaveProperty('sectionIntelligence')
    expect(generated.sections.find((section) => section.heading === 'Downstream Handoff')).toEqual({
      heading: 'Downstream Handoff', body: output.downstreamHandoffSignals[0].relevance,
      bullets: output.downstreamHandoffSignals.map((item) => `${item.signal}: ${item.relevance}`),
    })
    // Accepted shape mirrors the ordinary acceptance projection, not the entire generated object.
    const accepted = Object.fromEntries(['format', 'content', 'summary', 'sections', 'sectionIntelligence',
      'supportingEvidenceRefs', 'generationBoundaries'].map((key) => [key, generated[key]]))
    accepted.truthHash = `sha256:${'b'.repeat(64)}`
    const section = normalizeRuntimeSectionObject({ sectionKey: 'customer_context',
      runtimePath: 'framework_state.sections.customer_context', value: { input: null, generated, accepted, intelligence,
        state: { status: 'ACCEPTED' }, revisions: [buildRuntimeSectionRevision({ generated: prior.generated,
          revisionNumber: 1, replacedAt: '2026-09-02T12:01:00.000Z', reason: 'SECTION_GENERATION_REPLACED' })] } })
    const stored = JSON.parse(JSON.stringify(section))
    expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThan(256 * 1024)
    const version = 'rsv2:00000000-0000-4000-8000-000000000001'
    const mapped = createRuntimeStateLegacySourceRowSet({
      legacyInput: { rawBsonBytes: Buffer.byteLength(JSON.stringify(stored)), sections: { customer_context: stored },
        evidencePack: { sourceRegistry: [], evidenceObjects: [] }, intelligenceGraph: { graphVersion: version, nodes: [], edges: [] } },
      scope: { runtimeInstanceId: 'a27f1f77bcf86cd799439111', runtimeInstanceKey: 'long-output-test',
        customerId: '607f1f77bcf86cd799439022', tenantId: '707f1f77bcf86cd799439033' },
      stateVersion: version, migrationReceiptId: '64b000000000000000000004', migrationTimestamp: '2026-09-02T12:01:00.000Z',
    })
    expect(new RuntimeStateSection(mapped.rows.sections[0]).validateSync()).toBeUndefined()
  })

  test('routes every v3.1.5 guided section through section-specific reasoning coverage', () => {
    const frameworkPackage = makeFrameworkPackage()
    for (const section of guidedSections) {
      expect(requiresVmfSectionReasoning({ frameworkPackage, ...section })).toBe(true)
      const coverage = buildVmfSectionReasoningCoverage({
        evidenceObjects: Array.from({ length: 30 }, (_value, index) => makeEvidence(index + 1)),
        sectionKey: section.sectionKey,
      })
      expect(coverage.includedCount).toBeGreaterThan(10)
      expect(coverage.dimensionCoverage.map((item) => item.dimensionKey)).toEqual(
        expect.arrayContaining(['commercial_context', 'proof_claim_boundaries', 'decision_handoff']),
      )
    }
  })

  test('retains deterministic generation outside the exact v3.1.5 Customer Context switch', async () => {
    const providerAdapter = jest.fn()
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage: { frameworkKey: 'VMF', packageKey: 'legacy-vmf', version: '3.1.4' },
      frameworkState: { evidence_pack: { accepted: true, evidenceObjects: [makeEvidence(1)] } },
      generatedAt: '2026-09-02T12:00:00.000Z',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: 'legacy-vmf', packageVersion: '3.1.4' },
      section: { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context' },
      sectionExecutionContract: makeExecutionContract(),
    })

    expect(providerAdapter).not.toHaveBeenCalled()
    expect(result.generated.generator.mode).toBe('DETERMINISTIC_PLUS_BOUNDED_SYNTHESIS')
  })

  test('rejects provider traceability outside admitted accepted evidence', () => {
    const output = makeOutput()
    output.supportedClaims[0].evidenceRefs = ['unknown_evidence']
    output.sourceTraceability = ['evidence_1', 'evidence_2', 'evidence_3', 'unknown_evidence']

    expect(() => validateRuntimeSectionIntelligence(output, {
      allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'],
    })).toThrow(expect.objectContaining({
      code: 'VMF_SECTION_REASONING_PROVIDER_FAILED',
    }))
  })

  test('normalizes the redundant source traceability list from typed evidence references', () => {
    const output = makeOutput()
    output.sourceTraceability = ['evidence_1']

    expect(validateRuntimeSectionIntelligence(output, {
      allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'],
    }).sourceTraceability).toEqual(['evidence_1', 'evidence_2', 'evidence_3'])
  })

  test('uses strict Responses API output and returns validated section intelligence', async () => {
    const responseOutput = makeOutput()
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'request_1' },
      json: async () => ({
        id: 'response_1',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(responseOutput) }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }),
    })
    const adapter = createOpenAiRuntimeSectionReasoningAdapter({
      apiKey: 'test-key',
      fetchImpl,
      model: 'test-model',
      sleep: async () => {},
    })
    const fullFact = `${'Neutral text. '.repeat(100)}The 35% figure is illustrative, not verified customer ROI.`
    const evidenceObjects = Array.from({ length: 803 }, (_, index) => ({
      ...makeEvidence(index + 1), extractedFact: index === 0 ? fullFact : `Statement ${index + 1}.`,
      validationStatus: index === 0 ? 'UNVALIDATED' : '',
    }))
    const reasoningCoverage = buildCustomerContextReasoningCoverage({ evidenceObjects })
    const result = await adapter({
      providerContext: { section: { sectionKey: 'customer_context' }, supportAssets: [], reasoningCoverage },
      allowedEvidenceIds: evidenceObjects.map((item) => item.evidenceObjectId),
    })

    expect(result.output).toEqual(responseOutput)
    expect(result.metadata.refConstraintVersion).toBe('admitted-evidence-id-enum-v1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const suppliedCoverage = JSON.parse(JSON.parse(fetchImpl.mock.calls[0][1].body).input).reasoningCoverage
    expect(suppliedCoverage.evidence).toHaveLength(803)
    expect(suppliedCoverage).toEqual(reasoningCoverage)
    expect(suppliedCoverage.evidence[0].excerpt).toBe(fullFact)
    expect(suppliedCoverage.validationStatusByEvidenceIndex[0]).toBe('UNVALIDATED')
    const suppliedSchema = JSON.parse(fetchImpl.mock.calls[0][1].body).text.format.schema
    expect(suppliedSchema.$defs.evidenceId.anyOf.map((branch) => branch.enum.length)).toEqual([250, 250, 250, 53])
    expect(suppliedSchema.$defs.evidenceId.anyOf.flatMap((branch) => branch.enum))
      .toEqual(evidenceObjects.map((item) => item.evidenceObjectId))
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      store: false,
      text: { format: expect.objectContaining({ type: 'json_schema', strict: true }) },
    }))
  })

  describe('admitted evidence reference schema', () => {
    const fakeResponse = (output = makeOutput()) => ({
      ok: true, headers: { get: () => 'test-request' },
      json: async () => ({ id: 'test-response', status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }),
    })
    const makeAdapter = (fetchImpl) => createOpenAiRuntimeSectionReasoningAdapter({
      apiKey: 'test-key', model: 'test-model', fetchImpl, maxRetries: 0,
    })
    const context = { section: { sectionKey: 'customer_context' } }
    const ids = (count) => Array.from({ length: count }, (_, index) => `evidence_${index + 1}`)
    const schemaFrom = (call) => JSON.parse(call[1].body).text.format.schema

    test.each([250, 251, 803, 1000])('constrains exactly %i IDs in chunks no larger than 250 across all ten reference slots', async (count) => {
      const fetchImpl = jest.fn().mockResolvedValue(fakeResponse())
      const allowedEvidenceIds = ids(count)
      const result = await makeAdapter(fetchImpl)({ providerContext: context, allowedEvidenceIds })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result.metadata.refConstraintVersion).toBe('admitted-evidence-id-enum-v1')
      const schema = schemaFrom(fetchImpl.mock.calls[0])
      expect(Object.keys(schema.$defs).sort()).toEqual(['claim', 'evidenceId', 'signal'])
      const branches = schema.$defs.evidenceId.anyOf
      expect(Object.keys(schema.$defs.evidenceId)).toEqual(['anyOf'])
      expect(branches).toHaveLength(Math.ceil(count / 250))
      expect(branches.flatMap((branch) => branch.enum)).toEqual(allowedEvidenceIds)
      for (const branch of branches) {
        expect(Object.keys(branch).sort()).toEqual(['enum', 'type'])
        expect(branch.type).toBe('string')
        expect(branch.enum.length).toBeGreaterThan(0)
        expect(branch.enum.length).toBeLessThanOrEqual(250)
        expect(branch.enum).not.toContain('unknown_evidence')
      }
      const objectSlots = ['strategicTensions', 'supportedClaims', 'representedClaims', 'restrictedClaims',
        'evidenceBoundaries', 'contradictionSignals', 'alternativeInterpretations', 'downstreamHandoffSignals', 'validationGaps']
      for (const key of objectSlots) {
        const item = schema.properties[key].items
        const resolved = item.$ref ? schema.$defs[item.$ref.split('/').at(-1)] : item
        expect(resolved.properties.evidenceRefs.items).toEqual({ $ref: '#/$defs/evidenceId' })
      }
      expect(schema.properties.sourceTraceability.items).toEqual({ $ref: '#/$defs/evidenceId' })
      for (const key of ['supportedClaims', 'representedClaims', 'restrictedClaims']) {
        expect(schema.properties[key].items).toEqual({ $ref: '#/$defs/claim' })
      }
      for (const key of ['strategicTensions', 'contradictionSignals', 'alternativeInterpretations']) {
        expect(schema.properties[key].items).toEqual({ $ref: '#/$defs/signal' })
      }
      // Undo only the dynamic reference substitution; every other schema field must match the exported base.
      const expand = (value) => {
        if (Array.isArray(value)) return value.map(expand)
        if (!value || typeof value !== 'object') return value
        if (value.$ref === '#/$defs/evidenceId') return { type: 'string', minLength: 1, maxLength: 240 }
        if (value.$ref) return expand(schema.$defs[value.$ref.split('/').at(-1)])
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$defs').map(([key, item]) => [key, expand(item)]))
      }
      expect(expand(schema)).toEqual(runtimeSectionIntelligenceJsonSchema)
    })

    test.each([120000, 120001])('enforces the exact aggregate schema string budget at %i characters', async (budget) => {
      const fetchImpl = jest.fn().mockResolvedValue(fakeResponse())
      const adapter = makeAdapter(fetchImpl)
      const allowedEvidenceIds = ids(1000)
      // Capture the real small-ID request, then vary only its enum literals.
      await adapter({ providerContext: context, allowedEvidenceIds })
      const expectedRequest = JSON.parse(fetchImpl.mock.calls[0][1].body)
      const expectedSchema = expectedRequest.text.format.schema
      const measure = (root) => {
        let total = 0
        const pending = [root]
        while (pending.length) {
          const node = pending.pop()
          if (!node || typeof node !== 'object') continue
          total += Object.keys(node.properties || {}).join('').length
          total += Object.keys(node.$defs || {}).join('').length
          total += (Array.isArray(node.enum) ? node.enum : []).reduce((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0)
          if (typeof node.const === 'string') total += node.const.length
          pending.push(...Object.values(node))
        }
        return total
      }
      let remaining = budget - measure(expectedSchema)
      // Retain IDs 1..3 used by the fake output; all padded IDs remain unique and <=240 characters.
      for (let index = 3; index < allowedEvidenceIds.length && remaining > 0; index += 1) {
        const padding = Math.min(240 - allowedEvidenceIds[index].length, remaining)
        allowedEvidenceIds[index] += 'x'.repeat(padding)
        remaining -= padding
      }
      expect(remaining).toBe(0)
      expect(allowedEvidenceIds).toHaveLength(1000)
      expect(new Set(allowedEvidenceIds).size).toBe(1000)
      expect(allowedEvidenceIds.every((id) => id.length >= 1 && id.length <= 240 && id.trim() === id)).toBe(true)
      expectedSchema.$defs.evidenceId.anyOf.forEach((branch, index) => {
        branch.enum = allowedEvidenceIds.slice(index * 250, (index + 1) * 250)
      })
      expect(measure(expectedSchema)).toBe(budget)
      expect(Buffer.byteLength(JSON.stringify(context), 'utf8')).toBeLessThan(220 * 1024)
      expect(Buffer.byteLength(JSON.stringify(expectedRequest), 'utf8')).toBeLessThan(256 * 1024)
      fetchImpl.mockClear()
      if (budget === 120000) {
        await expect(adapter({ providerContext: context, allowedEvidenceIds })).resolves.toHaveProperty('output')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(schemaFrom(fetchImpl.mock.calls[0])).toEqual(expectedSchema)
      } else {
        await expect(adapter({ providerContext: context, allowedEvidenceIds })).rejects.toMatchObject({
          status: 409, code: 'VMF_SECTION_REASONING_PROVIDER_FAILED', details: { reason: 'PROVIDER_EVIDENCE_SCHEMA_INVALID' },
        })
        expect(fetchImpl).not.toHaveBeenCalled()
      }
    })

    test.each([
      ['empty', []], ['not an array', 'evidence_1'], ['null', null],
      ['1001 IDs', ids(1001)], ['duplicate', ['evidence_1', 'evidence_1']],
      ['nonstring', [7]], ['empty string', ['']], ['whitespace only', [' ']],
      ['untrimmed', [' evidence_1 ']], ['overlength', ['x'.repeat(241)]],
    ])('rejects %s admitted IDs before fetch', async (_, allowedEvidenceIds) => {
      const fetchImpl = jest.fn()
      await expect(makeAdapter(fetchImpl)({ providerContext: context, allowedEvidenceIds })).rejects.toMatchObject({
        status: 409, code: 'VMF_SECTION_REASONING_PROVIDER_FAILED', details: { reason: 'PROVIDER_EVIDENCE_SCHEMA_INVALID' },
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('keeps the base schema immutable across concurrent and sequential calls', async () => {
      const before = JSON.stringify(runtimeSectionIntelligenceJsonSchema)
      const output = JSON.parse(JSON.stringify(makeOutput()).replaceAll('evidence_2', 'evidence_1').replaceAll('evidence_3', 'evidence_1'))
      const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(output))
      const adapter = makeAdapter(fetchImpl)
      const first = ['evidence_1']
      const second = ['evidence_1', 'other_2']
      await Promise.all([adapter({ providerContext: context, allowedEvidenceIds: first }),
        adapter({ providerContext: context, allowedEvidenceIds: second })])
      const initialBodies = fetchImpl.mock.calls.map((call) => call[1].body)
      await adapter({ providerContext: context, allowedEvidenceIds: ids(251) })
      expect(fetchImpl.mock.calls.slice(0, 2).map((call) => call[1].body)).toEqual(initialBodies)
      expect(fetchImpl.mock.calls.map(schemaFrom).map((schema) => schema.$defs.evidenceId.anyOf.flatMap((branch) => branch.enum)))
        .toEqual([first, second, ids(251)])
      expect(first).toEqual(['evidence_1'])
      expect(second).toEqual(['evidence_1', 'other_2'])
      expect(JSON.stringify(runtimeSectionIntelligenceJsonSchema)).toBe(before)
      expect(runtimeSectionIntelligenceJsonSchema).not.toHaveProperty('$defs')
    })

    test('still rejects an unknown output reference after a constrained-schema request without retry or correction', async () => {
      const output = makeOutput()
      output.supportedClaims[0].evidenceRefs = ['unknown_evidence']
      const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(output))
      await expect(makeAdapter(fetchImpl)({ providerContext: context, allowedEvidenceIds: ids(3) })).rejects.toMatchObject({
        code: 'VMF_SECTION_REASONING_PROVIDER_FAILED', details: { reason: 'PROVIDER_OUTPUT_TRACEABILITY_INVALID' },
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(output.supportedClaims[0].evidenceRefs).toEqual(['unknown_evidence'])
    })
  })

  test.each([
    ['UTF-8 context bytes', '漢'.repeat(80000), 'PROVIDER_CONTEXT_TOO_LARGE'],
    ['escaped request-body bytes', '"'.repeat(70000), 'PROVIDER_REQUEST_TOO_LARGE'],
  ])('rejects excessive %s through the real adapter before fetch', async (_, payload, reason) => {
    const fetchImpl = jest.fn()
    const sleep = jest.fn()
    const reasoningCoverage = buildCustomerContextReasoningCoverage({ evidenceObjects:
      Array.from({ length: 121 }, (_, index) => ({ evidenceObjectId: `e${index + 1}`, sourceId: 's',
        extractedFact: index === 0 ? payload : 'UK', reviewStatus: 'ACCEPTED' })),
    })
    expect(reasoningCoverage.includedCount).toBe(121)
    expect(reasoningCoverage.evidence[0].excerpt).toBe(payload)
    const providerContext = { reasoningCoverage }
    const serializedContext = JSON.stringify(providerContext)
    if (reason === 'PROVIDER_CONTEXT_TOO_LARGE') {
      expect(serializedContext.length).toBeLessThan(220 * 1024)
      expect(Buffer.byteLength(serializedContext, 'utf8')).toBeGreaterThan(220 * 1024)
    } else {
      expect(Buffer.byteLength(serializedContext, 'utf8')).toBeLessThan(220 * 1024)
      expect(Buffer.byteLength(JSON.stringify({ input: serializedContext }), 'utf8')).toBeGreaterThan(256 * 1024)
    }
    const adapter = createOpenAiRuntimeSectionReasoningAdapter({ apiKey: 'test-key', model: 'test-model', fetchImpl, sleep })
    await expect(adapter({ providerContext, allowedEvidenceIds: ['e1'] })).rejects.toMatchObject({
      status: 409, code: 'VMF_SECTION_REASONING_PROVIDER_FAILED', details: { reason },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  test('retains the strict fourteen-field output and 120-item traceability boundary', () => {
    const output = makeOutput()
    expect(Object.keys(output)).toHaveLength(14)
    expect(() => validateRuntimeSectionIntelligence({ ...output, extraField: 'Not permitted' }, {
      allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'],
    })).toThrow(expect.objectContaining({ code: 'VMF_SECTION_REASONING_PROVIDER_FAILED' }))
    const ids = Array.from({ length: 121 }, (_, index) => `evidence_${index + 1}`)
    expect(() => validateRuntimeSectionIntelligence({ ...output, sourceTraceability: ids }, {
      allowedEvidenceIds: ids,
    })).toThrow(expect.objectContaining({ code: 'VMF_SECTION_REASONING_PROVIDER_FAILED' }))
  })

  test(
    'resolves whitespace-normalized accepted IDs before provider invocation', async () => {
      const evidenceObjects = [makeEvidence(1), makeEvidence(2), makeEvidence(3)]
      evidenceObjects[0] = { ...evidenceObjects[0], evidenceObjectId: '  evidence_1  ', validationStatus: 'UNVALIDATED' }
      const evidencePack = { accepted: true, evidenceObjects }
      const original = JSON.stringify(evidencePack)
      const normalizedAccepted = getAcceptedDiscoveryEvidenceObjects(evidencePack)
      expect(normalizedAccepted).toHaveLength(3)
      const providerAdapter = jest.fn().mockResolvedValue({
        output: makeOutput(), provider: { providerKey: 'openai', model: 'test-model' }, metadata: {},
      })
      const frameworkPackage = makeFrameworkPackage()
      const generation = buildReasonedGeneratedSection({
        actionKey: 'GENERATE_SECTION', actorUserId: 'user_1', frameworkPackage,
        frameworkState: { evidence_pack: evidencePack }, generatedAt: '2026-09-02T12:00:00.000Z',
        providerRuntime: { status: { configured: true }, providerAdapter },
        runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
        section: { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context' },
        sectionExecutionContract: makeExecutionContract(),
      })
      await expect(generation).resolves.toHaveProperty('generated')
      expect(providerAdapter).toHaveBeenCalledTimes(1)
      const coverage = providerAdapter.mock.calls[0][0].providerContext.reasoningCoverage
      expect(coverage.evidence.map((item) => item.evidenceObjectId)).toEqual(['evidence_1', 'evidence_2', 'evidence_3'])
      expect(coverage.evidence[0].excerpt).toBe(evidenceObjects[0].extractedFact)
      expect(coverage.validationStatusByEvidenceIndex).toEqual(['UNVALIDATED', '', ''])
      expect(JSON.stringify(evidencePack)).toBe(original)
    },
  )

  test('fails closed when provider assets or configuration are missing', async () => {
    const request = {
      actionKey: 'GENERATE_SECTION',
      frameworkPackage: { ...makeFrameworkPackage(), packageKey: 'vmf-3-1-5' },
      frameworkState: { evidence_pack: { accepted: true, evidenceObjects: [makeEvidence(1), makeEvidence(2), makeEvidence(3)] } },
      generatedAt: '2026-09-02T12:00:00.000Z',
      runtimeInstance: { packageKey: 'vmf-3-1-5', packageVersion: '3.1.5' },
      section: { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer_context' },
    }

    await expect(buildReasonedGeneratedSection({
      ...request,
      providerRuntime: { status: { configured: true }, providerAdapter: jest.fn() },
      sectionExecutionContract: { ...makeExecutionContract(), runtimeSupportAssets: [] },
    })).rejects.toMatchObject({
      code: 'VMF_SECTION_REASONING_PROVIDER_UNAVAILABLE',
      details: { reason: 'RUNTIME_SUPPORT_ASSETS_MISSING' },
    })

    await expect(buildReasonedGeneratedSection({
      ...request,
      providerRuntime: { status: { configured: false, reason: 'PROVIDER_DISABLED' } },
      sectionExecutionContract: makeExecutionContract(),
    })).rejects.toMatchObject({
      code: 'VMF_SECTION_REASONING_PROVIDER_UNAVAILABLE',
      details: { reason: 'PROVIDER_DISABLED' },
    })
  })

  test.each([0, 1])('times out stalled response bodies with %i retries and clears timers', async (maxRetries) => {
    jest.useFakeTimers()
    try {
      const signals = []
      const fetchImpl = jest.fn(async (_url, { signal }) => {
        signals.push(signal)
        return {
          ok: true,
          json: () => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
          }),
        }
      })
      const sleep = jest.fn().mockResolvedValue(undefined)
      const adapter = createOpenAiRuntimeSectionReasoningAdapter({
        apiKey: 'test-key', model: 'test-model', fetchImpl, maxRetries, sleep, timeoutMs: 10,
      })
      const assertion = expect(adapter({ providerContext: {}, allowedEvidenceIds: ['evidence_1'] }))
        .rejects.toMatchObject({ details: { reason: 'PROVIDER_TIMEOUT' } })
      await jest.runAllTimersAsync()
      await assertion
      expect(fetchImpl).toHaveBeenCalledTimes(maxRetries + 1)
      expect(sleep).toHaveBeenCalledTimes(maxRetries)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  test('accepts a response body completed before the deadline and clears its timer', async () => {
    jest.useFakeTimers()
    try {
      let requestSignal
      const fetchImpl = jest.fn(async (_url, { signal }) => {
        requestSignal = signal
        return {
          ok: true,
          json: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(makeOutput()) }] }] }
          },
        }
      })
      const adapter = createOpenAiRuntimeSectionReasoningAdapter({
        apiKey: 'test-key', model: 'test-model', fetchImpl, timeoutMs: 10,
      })
      const pending = adapter({ providerContext: {}, allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'] })
      await jest.runAllTimersAsync()
      await expect(pending).resolves.toHaveProperty('output.sectionNarrative', makeOutput().sectionNarrative)
      expect(requestSignal.aborted).toBe(false)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  test('does not retry malformed response JSON and clears its timer', async () => {
    jest.useFakeTimers()
    try {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('invalid JSON') } })
      const adapter = createOpenAiRuntimeSectionReasoningAdapter({ apiKey: 'test-key', model: 'test-model', fetchImpl })
      await expect(adapter({ providerContext: {}, allowedEvidenceIds: ['evidence_1'] }))
        .rejects.toMatchObject({ details: { reason: 'PROVIDER_RESPONSE_INVALID' } })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  test('retries one transient provider timeout and fails closed after exhaustion', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { name: 'AbortError' })
    const fetchImpl = jest.fn().mockRejectedValue(timeoutError)
    const sleep = jest.fn().mockResolvedValue(undefined)
    const adapter = createOpenAiRuntimeSectionReasoningAdapter({
      apiKey: 'test-key',
      fetchImpl,
      maxRetries: 1,
      model: 'test-model',
      sleep,
      timeoutMs: 10,
    })

    await expect(adapter({
      providerContext: { section: { sectionKey: 'customer_context' }, supportAssets: [], reasoningCoverage: {} },
      allowedEvidenceIds: ['evidence_1', 'evidence_2', 'evidence_3'],
    })).rejects.toMatchObject({
      code: 'VMF_SECTION_REASONING_PROVIDER_FAILED',
      details: { reason: 'PROVIDER_TIMEOUT' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
