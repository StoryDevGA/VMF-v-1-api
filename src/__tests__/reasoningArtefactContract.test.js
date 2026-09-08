import { describe, expect, jest, test } from '@jest/globals'

import {
  buildReasoningArtefactOutputs,
  projectHandoffReasoningArtefacts,
  resolvePackageReasoningArtefacts,
  validateReasoningArtefactCandidate,
  validateReasoningArtefactDeclarations,
} from '../services/reasoningArtefactContractService.js'
import { buildIntermediateReasoningManifest } from '../services/outcomeStudioEvidenceCompositionService.js'
import { buildReasonedGeneratedSection } from '../services/runtimeSectionReasoningService.js'
import { createOpenAiRuntimeSectionReasoningAdapter } from '../services/openAiRuntimeSectionReasoningAdapter.js'
import {
  SECTION_COMPLETENESS_BINDING,
  executeSectionValidationRules,
} from '../services/sectionValidationExecutorService.js'
import { validateGeneratedReasoningArtefactsForAcceptance } from '../services/runtimeStateMutationService.js'
import FrameworkPackage from '../models/FrameworkPackage.js'

const objectSchema = (property) => ({
  type: 'object',
  additionalProperties: false,
  required: [property],
  properties: { [property]: { type: 'string', minLength: 1 } },
})

const declaration = (artefactKey, {
  sectionKey = 'customer-context',
  sourcePath = `sectionIntelligence.${artefactKey}`,
  lifecycleStage = 'GENERATED',
  handoff = { eligible: true, mappingKey: artefactKey, targetPath: `outcome_studio.intermediate_reasoning.${artefactKey}` },
} = {}) => ({
  artefactKey,
  label: artefactKey,
  purpose: `Governed ${artefactKey}.`,
  required: true,
  lifecycleStage,
  sectionKeys: [sectionKey],
  workflowActionKeys: ['GENERATE_SECTION'],
  sourcePath,
  writePath: `framework_state.sections.customer_context.${lifecycleStage.toLowerCase()}.reasoningArtefacts.${artefactKey}`,
  schema: objectSchema('value'),
  validation: {
    currentnessFields: ['packageVersion', 'inputHash', 'evidenceHash', 'dependencyHash', 'sectionContractHash', 'generatedAt'],
    maxBytes: 4096,
  },
  handoff,
})

const packageWith = (reasoningArtefacts, frameworkKey = 'VMF') => ({
  frameworkKey,
  packageKey: `${frameworkKey.toLowerCase()}-fixture`,
  version: '3.1.6',
  sections: [{ sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' }],
  reasoningArtefacts,
})

const context = {
  packageKey: 'vmf-fixture',
  packageVersion: '3.1.6',
  inputHash: 'a'.repeat(64),
  evidenceHash: 'b'.repeat(64),
  dependencyHash: 'c'.repeat(64),
  sectionContractHash: 'd'.repeat(64),
  generatedAt: '2026-09-07T12:00:00.000Z',
}

describe('package-declared reasoning artefact runtime contract', () => {
  test('resolves VMF declarations by section and workflow without framework constants', () => {
    const frameworkPackage = packageWith([
      declaration('fxGxAssessmentSignals'),
      declaration('arlRlReviewChangeRationale'),
    ])
    expect(resolvePackageReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer_context',
      actionKey: 'GENERATE_SECTION',
    }).map((item) => item.artefactKey)).toEqual([
      'fxGxAssessmentSignals',
      'arlRlReviewChangeRationale',
    ])
  })

  test('fails closed when a required VMF artefact is missing before persistence', () => {
    const declarations = validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([declaration('fxGxAssessmentSignals')]),
    })
    expect(() => buildReasoningArtefactOutputs({
      candidate: {},
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_REQUIRED_MISSING' }))
  })

  test('accepts a non-VMF package declaration without VMF artefact requirements', () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = resolvePackageReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      actionKey: 'GENERATE_SECTION',
    })
    const candidate = { riskNarrative: { value: 'The operating risk remains bounded.' } }
    expect(() => validateReasoningArtefactCandidate({ candidate, declarations })).not.toThrow()
    const result = buildReasoningArtefactOutputs({
      candidate,
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
      packageKey: frameworkPackage.packageKey,
    })
    expect(result.values).toEqual({ riskNarrative: { value: 'The operating risk remains bounded.' } })
    expect(result.receipts.riskNarrative.handoffEligible).toBe(true)
  })

  test('uses the declared artefact key for provider output when the source path is a mapped field', async () => {
    const frameworkPackage = packageWith([
      declaration('riskNarrative', { sourcePath: 'sectionIntelligence.customRiskSignal' }),
    ], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const providerAdapter = jest.fn().mockResolvedValue({
      output: { riskNarrative: { value: 'Mapped provider output.' } },
      provider: { providerKey: 'fixture', model: 'fixture-model' },
      metadata: { storedByProvider: false },
    })
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage,
      frameworkState: {},
      generatedAt: context.generatedAt,
      input: 'Customer operating context',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section: frameworkPackage.sections[0],
      sectionExecutionContract: {
        contractVersion: 'section-execution-contract-v1',
        sectionContractHash: context.sectionContractHash,
        sectionIdentity: { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', label: 'Customer Context', purpose: 'Fixture.' },
        reasoningArtefacts: declarations,
      },
    })
    expect(result.generated.reasoningArtefacts).toEqual({ riskNarrative: { value: 'Mapped provider output.' } })
  })

  test('sends package artefact keys, rather than source-path suffixes, to the strict provider schema', async () => {
    const frameworkPackage = packageWith([
      declaration('riskNarrative', { sourcePath: 'sectionIntelligence.customRiskSignal' }),
    ], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'provider-request' },
      json: async () => ({
        id: 'provider-response',
        status: 'completed',
        output: [{ type: 'message', content: [{
          type: 'output_text',
          text: JSON.stringify({ riskNarrative: { value: 'Strict schema output.' } }),
        }] }],
      }),
    })
    const adapter = createOpenAiRuntimeSectionReasoningAdapter({
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl,
      maxRetries: 0,
    })
    await expect(adapter({
      providerContext: { section: { sectionKey: 'customer-context' } },
      reasoningArtefactDeclarations: declarations,
    })).resolves.toMatchObject({ output: { riskNarrative: { value: 'Strict schema output.' } } })
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.text.format.schema.properties).toHaveProperty('riskNarrative')
    expect(requestBody.text.format.schema.properties).not.toHaveProperty('customRiskSignal')
  })

  test('rejects malformed, duplicate and conflicting package declarations', () => {
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([declaration('riskNarrative'), declaration('riskNarrative')], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_DUPLICATE_KEY' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([{ ...declaration('riskNarrative'), writePath: 'framework_state.runtime.riskNarrative' }], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_WRITE_PATH_INVALID' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([{ ...declaration('riskNarrative'), schema: {} }], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_SCHEMA_MALFORMED' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([{ ...declaration('riskNarrative'), schema: undefined }], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_SCHEMA_MALFORMED' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([{ ...declaration('riskNarrative'), schema: { type: 'object' } }], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_SCHEMA_MALFORMED' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([
        declaration('riskNarrative'),
        declaration('riskSummary', { sourcePath: 'sectionIntelligence.riskNarrative' }),
      ], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_DUPLICATE_SOURCE_PATH' }))
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([
        declaration('riskNarrative', {
          handoff: {
            eligible: true,
            mappingKey: 'riskNarrative',
            targetPath: 'outcome_studio.intermediate_reasoning.otherKey',
          },
        }),
      ], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_HANDOFF_MAPPING_INVALID' }))
  })

  test('fails closed for stale or schema-incompatible generated artefacts', () => {
    const staleDeclaration = declaration('riskNarrative')
    staleDeclaration.validation.maxAgeSeconds = 60
    const declarations = validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([staleDeclaration], 'CUSTOM'),
    })
    expect(() => buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 'Old risk.' } },
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
      now: '2026-09-07T12:02:00.000Z',
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_STALE' }))

    const incompatible = validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([declaration('riskNarrative')], 'CUSTOM'),
    })
    expect(() => buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 42 } },
      declarations: incompatible,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_SCHEMA_INVALID' }))

    expect(() => buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 'Malformed lineage.' } },
      declarations: incompatible,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
      generatedAt: 'not-a-timestamp',
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_CURRENTNESS_INVALID' }))
  })

  test('projects only current handoff-eligible artefacts from accepted truth', () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const generated = buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 'Current risk.' } },
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
    })
    const projection = projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        reasoningArtefacts: generated.values,
        reasoningArtefactReceipts: generated.receipts,
        inputHash: context.inputHash,
        evidenceHash: context.evidenceHash,
        dependencyHash: context.dependencyHash,
        sectionContractHash: context.sectionContractHash,
        sourceGeneratedAt: context.generatedAt,
      },
    })
    expect(projection.values).toEqual({ risknarrative: { value: 'Current risk.' } })
    expect(projection.receipts.risknarrative.currentnessStatus).toBe('CURRENT')
    expect(() => projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        reasoningArtefacts: generated.values,
        reasoningArtefactReceipts: generated.receipts,
      },
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_CURRENTNESS_MISSING' }))
    expect(() => projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        reasoningArtefacts: { riskNarrative: { value: 42 } },
        reasoningArtefactReceipts: generated.receipts,
      },
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_SCHEMA_INVALID' }))

    expect(() => projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        inputHash: 'f'.repeat(64),
        evidenceHash: context.evidenceHash,
        dependencyHash: context.dependencyHash,
        sectionContractHash: context.sectionContractHash,
        sourceGeneratedAt: context.generatedAt,
        reasoningArtefacts: generated.values,
        reasoningArtefactReceipts: generated.receipts,
      },
      })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_CURRENTNESS_MISMATCH' }))

    expect(() => projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        inputHash: context.inputHash,
        evidenceHash: context.evidenceHash,
        dependencyHash: context.dependencyHash,
        sectionContractHash: context.sectionContractHash,
        sourceGeneratedAt: context.generatedAt,
        reasoningArtefacts: generated.values,
        reasoningArtefactReceipts: {
          ...generated.receipts,
          riskNarrative: {
            ...generated.receipts.riskNarrative,
            dependencyHash: 'f'.repeat(64),
          },
        },
      },
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_CURRENTNESS_MISMATCH' }))

    const staleDeclaration = declaration('riskNarrative')
    staleDeclaration.validation.maxAgeSeconds = 60
    const stalePackage = packageWith([staleDeclaration], 'CUSTOM')
    const staleDeclarations = validateReasoningArtefactDeclarations({ frameworkPackage: stalePackage })
    const staleGenerated = buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 'Stale risk.' } },
      declarations: staleDeclarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
      now: context.generatedAt,
    })
    expect(() => projectHandoffReasoningArtefacts({
      frameworkPackage: stalePackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        reasoningArtefacts: staleGenerated.values,
        reasoningArtefactReceipts: staleGenerated.receipts,
        inputHash: context.inputHash,
        evidenceHash: context.evidenceHash,
        dependencyHash: context.dependencyHash,
        sectionContractHash: context.sectionContractHash,
        sourceGeneratedAt: context.generatedAt,
      },
      now: '2026-09-07T12:02:00.000Z',
    })).toThrow(expect.objectContaining({ reason: 'REASONING_ARTEFACT_STALE' }))
  })

  test('does not project declared artefacts that are not handoff-eligible', () => {
    const frameworkPackage = packageWith([
      declaration('riskNarrative'),
      declaration('internalNote', { handoff: { eligible: false } }),
    ], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const generated = buildReasoningArtefactOutputs({
      candidate: {
        riskNarrative: { value: 'Current risk.' },
        internalNote: { value: 'Runtime-only note.' },
      },
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
    })
    const projection = projectHandoffReasoningArtefacts({
      frameworkPackage,
      sectionKey: 'customer-context',
      acceptedSection: {
        reasoningArtefacts: generated.values,
        reasoningArtefactReceipts: generated.receipts,
        inputHash: context.inputHash,
        evidenceHash: context.evidenceHash,
        dependencyHash: context.dependencyHash,
        sectionContractHash: context.sectionContractHash,
        sourceGeneratedAt: context.generatedAt,
      },
    })
    expect(projection.values).toEqual({ risknarrative: { value: 'Current risk.' } })
    expect(projection.values).not.toHaveProperty('internalnote')
  })

  test('does not apply the legacy VMF checklist to a non-VMF package with internal artefacts only', () => {
    const frameworkPackage = packageWith([
      declaration('internalNote', { handoff: { eligible: false } }),
    ], 'CUSTOM')
    const manifest = buildIntermediateReasoningManifest({
      frameworkHandoff: {
        reasoningArtefactsContractActive: true,
        reasoningArtefactDeclarations: validateReasoningArtefactDeclarations({ frameworkPackage }),
        sectionTruth: [{
          sectionKey: 'customer-context',
          reasoningArtefacts: {},
          reasoningArtefactReceipts: {},
        }],
      },
      knowledgeContext: {
        outputTypeStructure: ['a', 'b', 'c', 'd', 'e'],
        outputSchema: { key: 'schema', version: '1', requiredSections: ['a'] },
        style: { key: 'style', version: '1' },
      },
      enforceMissing: false,
    }).manifest
    expect(manifest.status).toBe('READY')
    expect(manifest.artefacts.map((entry) => entry.key)).toEqual(['outputSpecificCompositionGuidance'])
    expect(manifest.artefacts.map((entry) => entry.key)).not.toEqual(expect.arrayContaining([
      'fxGxAssessmentSignals',
      'arlRlReviewChangeRationale',
    ]))
  })

  test('requires a current eligible receipt before a package artefact is admitted to Outcome Studio', () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const manifest = buildIntermediateReasoningManifest({
      frameworkHandoff: {
        reasoningArtefactsContractActive: true,
        reasoningArtefactDeclarations: declarations,
        sectionTruth: [{
          sectionKey: 'customer-context',
          reasoningArtefacts: { riskNarrative: { value: 'Value without receipt.' } },
          reasoningArtefactReceipts: {},
        }],
      },
      knowledgeContext: {
        outputTypeStructure: ['a', 'b', 'c', 'd', 'e'],
        outputSchema: { key: 'schema', version: '1', requiredSections: ['a'] },
        style: { key: 'style', version: '1' },
      },
      enforceMissing: false,
    }).manifest
    expect(manifest.status).toBe('BLOCKED')
    expect(manifest.artefacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'risknarrative', present: false, classification: 'MISSING' }),
    ]))
  })

  test('does not apply VMF artefacts to a non-VMF package that declares no reasoning artefacts', () => {
    const manifest = buildIntermediateReasoningManifest({
      frameworkHandoff: {
        reasoningArtefactsContractActive: true,
        reasoningArtefactDeclarations: [],
        sectionTruth: [{ sectionKey: 'customer-context' }],
      },
      knowledgeContext: {
        outputTypeStructure: ['a', 'b', 'c', 'd', 'e'],
        outputSchema: { key: 'schema', version: '1', requiredSections: ['a'] },
        style: { key: 'style', version: '1' },
      },
      enforceMissing: false,
    }).manifest
    expect(manifest.status).toBe('READY')
    expect(manifest.artefacts.map((entry) => entry.key)).toEqual(['outputSpecificCompositionGuidance'])
  })

  test('revalidates generated artefacts before accepted truth is written', () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const generated = buildReasoningArtefactOutputs({
      candidate: { riskNarrative: { value: 'Current risk.' } },
      declarations,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
      ...context,
      packageKey: frameworkPackage.packageKey,
    })
    const generatedSection = {
      content: 'Generated content.',
      reasoningArtefacts: generated.values,
      reasoningArtefactReceipts: generated.receipts,
      inputHash: context.inputHash,
      evidenceHash: context.evidenceHash,
      dependencyHash: context.dependencyHash,
      generatedAt: context.generatedAt,
      generator: { sectionContractHash: context.sectionContractHash },
      actionKey: 'GENERATE_SECTION',
    }
    expect(() => validateGeneratedReasoningArtefactsForAcceptance({
      frameworkPackage,
      generated: generatedSection,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
    })).not.toThrow()
    expect(() => validateGeneratedReasoningArtefactsForAcceptance({
      frameworkPackage,
      generated: { ...generatedSection, actionKey: 'REGENERATE_SECTION' },
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
    })).not.toThrow()
    const tampered = {
      ...generatedSection,
      reasoningArtefactReceipts: {
        ...generatedSection.reasoningArtefactReceipts,
        riskNarrative: {
          ...generatedSection.reasoningArtefactReceipts.riskNarrative,
          outputHash: 'f'.repeat(64),
        },
      },
    }
    expect(() => validateGeneratedReasoningArtefactsForAcceptance({
      frameworkPackage,
      generated: tampered,
      sectionKey: 'customer-context',
      stateSectionKey: 'customer_context',
    })).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'REASONING_ARTEFACT_ACCEPTANCE_INVALID' }) }))
  })

  test('rejects unsupported accepted lifecycle declarations instead of silently dropping them', () => {
    expect(() => validateReasoningArtefactDeclarations({
      frameworkPackage: packageWith([declaration('riskNarrative', { lifecycleStage: 'ACCEPTED' })], 'CUSTOM'),
    })).toThrow(expect.objectContaining({ reason: 'DECLARATION_LIFECYCLE_INVALID' }))
  })

  test('section generation persists declared artefacts in the existing generated envelope', async () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const providerAdapter = jest.fn().mockResolvedValue({
      output: { riskNarrative: { value: 'Generated from the custom package contract.' } },
      provider: { providerKey: 'fixture', model: 'fixture-model' },
      metadata: { storedByProvider: false },
    })
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage,
      frameworkState: {},
      generatedAt: context.generatedAt,
      input: 'Customer operating context',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section: frameworkPackage.sections[0],
      sectionExecutionContract: {
        contractVersion: 'section-execution-contract-v1',
        sectionContractHash: context.sectionContractHash,
        sectionIdentity: { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', label: 'Customer Context', purpose: 'Fixture.' },
        reasoningArtefacts: declarations,
      },
    })
    expect(providerAdapter).toHaveBeenCalledWith(expect.objectContaining({
      reasoningArtefactDeclarations: declarations,
    }))
    expect(result.generated.sectionIntelligence).toEqual({
      riskNarrative: { value: 'Generated from the custom package contract.' },
    })
    expect(result.generated.reasoningArtefacts).toEqual({ riskNarrative: { value: 'Generated from the custom package contract.' } })
    expect(result.generated.reasoningArtefactReceipts.riskNarrative.statePath)
      .toBe('framework_state.sections.customer_context.generated.reasoningArtefacts.riskNarrative')
  })

  test('generates VMF v3.1.6 artefacts through the package contract', async () => {
    const frameworkPackage = packageWith([
      declaration('fxGxAssessmentSignals'),
      declaration('arlRlReviewChangeRationale'),
    ])
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const providerAdapter = jest.fn().mockResolvedValue({
      output: {
        fxGxAssessmentSignals: { value: 'FX/GX fixture signal.' },
        arlRlReviewChangeRationale: { value: 'ARL/RL fixture rationale.' },
      },
      provider: { providerKey: 'fixture', model: 'fixture-model' },
      metadata: { storedByProvider: false },
    })
    const section = frameworkPackage.sections[0]
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage,
      frameworkState: {},
      generatedAt: context.generatedAt,
      input: 'VMF v3.1.6 Customer Context',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section,
      sectionExecutionContract: {
        contractVersion: 'section-execution-contract-v1',
        sectionContractHash: context.sectionContractHash,
        sectionIdentity: { sectionKey: 'customer-context', runtimePath: section.runtimePath, label: 'Customer Context', purpose: 'Fixture.' },
        reasoningArtefacts: declarations,
      },
    })
    expect(result.generated.generator.mode).toBe('GOVERNED_PACKAGE_REASONING')
    expect(Object.keys(result.generated.reasoningArtefacts)).toEqual([
      'fxGxAssessmentSignals',
      'arlRlReviewChangeRationale',
    ])
    expect(providerAdapter).toHaveBeenCalledTimes(1)
  })

  test('completeness validation reads package artefacts from the generated envelope', async () => {
    const frameworkPackage = packageWith([declaration('riskNarrative')], 'CUSTOM')
    const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
    const providerAdapter = jest.fn().mockResolvedValue({
      output: { riskNarrative: { value: 'Generated for completeness validation.' } },
      provider: { providerKey: 'fixture', model: 'fixture-model' },
      metadata: { storedByProvider: false },
    })
    const sectionExecutionContract = {
      contractVersion: 'section-execution-contract-v1',
      sectionContractHash: context.sectionContractHash,
      packageIdentity: {
        packageKey: frameworkPackage.packageKey,
        packageVersion: frameworkPackage.version,
      },
      sectionIdentity: {
        sectionKey: 'customer-context',
        runtimePath: 'framework_state.sections.customer_context',
        label: 'Customer Context',
        purpose: 'Fixture.',
      },
      reasoningArtefacts: declarations,
      validationRules: [{
        stableId: SECTION_COMPLETENESS_BINDING.validationStableId,
        key: SECTION_COMPLETENESS_BINDING.validationKey,
        componentVersion: SECTION_COMPLETENESS_BINDING.validationComponentVersion,
        blockingDefault: true,
        metadataOnlyDuringGeneration: false,
        executionBinding: {
          selectionKey: SECTION_COMPLETENESS_BINDING.selectionKey,
          executorVersion: SECTION_COMPLETENESS_BINDING.executorVersion,
          producerSkill: {
            stableId: SECTION_COMPLETENESS_BINDING.producerSkillStableId,
            key: SECTION_COMPLETENESS_BINDING.producerSkillKey,
            componentVersion: SECTION_COMPLETENESS_BINDING.producerSkillComponentVersion,
          },
        },
      }],
    }
    const result = await buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage,
      frameworkState: {},
      generatedAt: context.generatedAt,
      input: 'Custom package completeness fixture',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version },
      section: frameworkPackage.sections[0],
      sectionExecutionContract,
    })

    expect(executeSectionValidationRules({
      candidate: result.generated,
      checkedAt: result.generated.generatedAt,
      sectionExecutionContract,
    })[0]).toEqual(expect.objectContaining({ status: 'PASS', is_valid: true }))
  })

  test('rejects malformed declarations before invoking the provider', async () => {
    const providerAdapter = jest.fn()
    await expect(buildReasonedGeneratedSection({
      actionKey: 'GENERATE_SECTION',
      frameworkPackage: packageWith([declaration('riskNarrative')], 'CUSTOM'),
      frameworkState: {},
      generatedAt: context.generatedAt,
      input: 'Customer operating context',
      providerRuntime: { status: { configured: true }, providerAdapter },
      runtimeInstance: { packageKey: 'custom-fixture', packageVersion: '3.1.6' },
      section: packageWith([declaration('riskNarrative')], 'CUSTOM').sections[0],
      sectionExecutionContract: {
        contractVersion: 'section-execution-contract-v1',
        sectionContractHash: context.sectionContractHash,
        sectionIdentity: { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', label: 'Customer Context', purpose: 'Fixture.' },
        reasoningArtefacts: [{
          ...declaration('riskNarrative'),
          writePath: 'framework_state.runtime.riskNarrative',
        }],
      },
    })).rejects.toThrow(expect.objectContaining({ reason: 'DECLARATION_WRITE_PATH_INVALID' }))
    expect(providerAdapter).not.toHaveBeenCalled()
  })

  test('persists the package declaration envelope without introducing a new collection', () => {
    const frameworkPackage = new FrameworkPackage({
      frameworkKey: 'CUSTOM',
      frameworkName: 'Custom fixture',
      version: '1.0.0',
      packageKey: 'custom-fixture-1',
      packageScope: 'SYSTEM',
      packageType: 'CUSTOM',
      status: 'DRAFT',
      isDefault: false,
      createdBy: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439011',
      sections: packageWith([declaration('riskNarrative')], 'CUSTOM').sections,
      reasoningArtefacts: [declaration('riskNarrative')],
    })
    expect(frameworkPackage.validateSync()).toBeUndefined()
    expect(frameworkPackage.toObject().reasoningArtefacts[0].schema).toEqual(objectSchema('value'))
    expect(frameworkPackage.collection.name).toBe('frameworkpackages')
  })
})
