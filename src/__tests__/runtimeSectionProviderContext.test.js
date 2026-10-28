import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { buildRuntimeSectionReasoningProviderRuntime, compareSectionProviderContext } from '../config/runtimeSectionReasoningProvider.js'
import { VMF_SECTION_REASONING_CONTRACT_VERSION } from '../constants/runtimeSectionReasoningContract.js'

const config = {
  appEnv: 'development', isAppProduction: false, vmfSectionReasoningProviderEnabled: true,
  vmfSectionReasoningProviderKey: 'openai', vmfSectionReasoningProviderModel: 'gpt-4.1-mini',
  vmfSectionReasoningProviderApiKey: 'test-secret',
}
const runtime = (overrides = {}) => buildRuntimeSectionReasoningProviderRuntime({ config: { ...config, ...overrides }, fetchImpl: jest.fn() })
const previous = () => runtime().providerDescriptor

describe('governed section provider context', () => {
  test('preserves the absent-option descriptor and does not disclose credentials', () => {
    const currentRuntime = runtime()
    expect(currentRuntime.providerDescriptor).toEqual({ providerKey: 'openai', model: 'gpt-4.1-mini',
      providerMode: 'LIVE_TEST', environment: 'TEST', contractVersion: VMF_SECTION_REASONING_CONTRACT_VERSION, failurePosture: 'FAIL_CLOSED' })
    const result = compareSectionProviderContext({ previousProvider: { ...previous(), apiKey: 'secret', unrelated: true }, currentRuntime })
    expect(result.changed).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/secret|apiKey|unrelated|Adapter/)
  })

  test.each(['gpt-5.2', 'gpt-5.2-2025-12-11'])('recognizes model-only change to %s', model => {
    const result = compareSectionProviderContext({ previousProvider: previous(), currentRuntime: runtime({ vmfSectionReasoningProviderModel: model }) })
    expect(result.changed).toBe(true)
    expect(result.currentProviderContext.model).toBe(model)
    expect(result.previousProviderContext.model).toBe('gpt-4.1-mini')
  })

  test('recognizes effort-only change and unchanged explicit effort', () => {
    const currentRuntime = runtime({ vmfSectionReasoningProviderModel: 'gpt-5.2', vmfSectionReasoningProviderReasoningEffort: 'medium' })
    const prior = { ...currentRuntime.providerDescriptor, reasoningEffort: 'low' }
    expect(compareSectionProviderContext({ previousProvider: prior, currentRuntime }).changed).toBe(true)
    expect(compareSectionProviderContext({ previousProvider: currentRuntime.providerDescriptor, currentRuntime }).changed).toBe(false)
  })

  test.each([
    undefined, null, {}, [], { model: 'gpt-5.2' },
    { ...previous(), model: ' ' }, { ...previous(), model: 42 },
    { ...previous(), providerMode: 'DETERMINISTIC_TEST' }, { ...previous(), providerKey: 'unknown' },
    { ...previous(), contractVersion: 'unknown' }, { ...previous(), reasoningEffort: 'medium' },
    { ...previous(), reasoningEffort: null }, { ...previous(), reasoningEffort: '' },
  ])('rejects malformed/missing previous identity %#', previousProvider => {
    expect(() => compareSectionProviderContext({ previousProvider, currentRuntime: runtime() }))
      .toThrow(expect.objectContaining({ code: 'SECTION_PROVIDER_CONTEXT_INVALID' }))
  })

  test.each([
    { vmfSectionReasoningProviderEnabled: false }, { isAppProduction: true }, { appEnv: 'production' },
    { vmfSectionReasoningProviderApiKey: '' }, { vmfSectionReasoningProviderModel: '' },
    { vmfSectionReasoningProviderKey: 'unknown' }, { vmfSectionReasoningProviderReasoningEffort: 'medium' },
    { vmfSectionReasoningProviderModel: 'gpt-5.2', vmfSectionReasoningProviderReasoningEffort: 'invalid' },
  ])('unavailable configuration never unlocks a retry %#', overrides => {
    const currentRuntime = runtime(overrides)
    expect(currentRuntime.status.configured).toBe(false)
    expect(currentRuntime.providerAdapter).toBeNull()
    expect(() => compareSectionProviderContext({ previousProvider: previous(), currentRuntime }))
      .toThrow(expect.objectContaining({ code: 'SECTION_PROVIDER_CONTEXT_UNAVAILABLE' }))
  })

  test('malformed configured current identity fails closed', () => {
    expect(() => compareSectionProviderContext({ previousProvider: previous(), currentRuntime: {
      status: { configured: true }, providerDescriptor: { ...previous(), contractVersion: 'unknown' },
    } })).toThrow(expect.objectContaining({ code: 'SECTION_PROVIDER_CONTEXT_UNAVAILABLE' }))
  })
})

describe('native section action provider-context preparation', () => {
  let apply, allocation, branch, writer, resolver
  const qualificationHash = 'a'.repeat(64)
  const input = 'Original controlled request'
  const section = { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' }
  let hashInput
  const fixture = (mode = 'GOVERNED_PROVIDER_SECTION_REASONING') => ({
    actionKey: 'REGENERATE_SECTION', actorUserId: 'synthetic-actor',
    frameworkPackage: { packageKey: 'pack', version: '1.0.0', sections: [section] },
    payload: { sectionKey: section.sectionKey },
    runtimeInstance: { _id: 'synthetic-id', runtimeInstanceKey: 'synthetic', framework_state: { evidence_pack: { accepted: true }, sections: { customer_context: {
      input, generated: { inputHash: hashInput(input), evidenceHash: 'e', sectionEvidenceHash: 's', dependencyHash: 'd',
        generator: { mode, provider: previous(), packageKey: 'pack', packageVersion: '1.0.0',
          evidenceQualificationHash: qualificationHash, evidenceQualificationContractVersion: 'qualification-test-v1' } },
    } } } },
  })

  beforeAll(async () => {
    const realConfig = await import('../config/runtimeSectionReasoningProvider.js')
    const realReasoning = await import('../services/runtimeSectionReasoningService.js')
    const realModel = await import('../services/runtimeSectionModelService.js')
    const realContract = await import('../services/sectionExecutionContractService.js')
    const realValidation = await import('../services/sectionValidationExecutorService.js')
    const realManaged = await import('../services/runtimeManagedSectionService.js')
    hashInput = realModel.hashSectionInput
    resolver = jest.fn(() => allocation)
    writer = jest.fn(async args => ({ generated: { inputHash: hashInput(args.input), sectionIntelligence: {},
      generator: { provider: args.providerRuntime?.providerDescriptor } }, intelligence: {} }))
    await jest.unstable_mockModule('../config/runtimeSectionReasoningProvider.js', () => ({ ...realConfig, buildRuntimeSectionReasoningProviderRuntime: resolver }))
    await jest.unstable_mockModule('../services/runtimeSectionReasoningService.js', () => ({ ...realReasoning,
      buildReasonedGeneratedSection: writer,
      prepareRuntimeSectionEvidenceQualificationContext: () => branch ? { branch,
        coverage: { allEvidenceHash: 'e' }, base: { generated: { evidenceHash: 'e' } },
        evidenceQualificationHash: qualificationHash, evidenceQualificationContractVersion: 'qualification-test-v1' } : null,
    }))
    await jest.unstable_mockModule('../services/runtimeSectionModelService.js', () => ({ ...realModel,
      buildSectionIntelligenceDisplayProjection: () => ({ boundedContext: { evidenceHash: 'e', sectionEvidenceHash: 's', dependencyHash: 'd' } }),
      evaluateSectionInterpretationSimilarity: () => ({ passed: true }),
    }))
    await jest.unstable_mockModule('../services/sectionExecutionContractService.js', () => ({ ...realContract,
      resolveSectionExecutionContract: async () => ({ sectionIdentity: { label: 'Context' } }),
    }))
    await jest.unstable_mockModule('../services/sectionValidationExecutorService.js', () => ({ ...realValidation, executeSectionValidationRules: () => [] }))
    await jest.unstable_mockModule('../services/runtimeManagedSectionService.js', () => ({ ...realManaged,
      assertCustomerSectionTarget: () => {}, buildRuntimeManagedSourceReceipt: () => null,
    }))
    apply = (await import('../services/runtimeActionExecutionService.js')).__testables.applyRuntimeSectionGeneration
  })

  beforeEach(() => {
    branch = 'VMF'
    allocation = runtime({ vmfSectionReasoningProviderModel: 'gpt-5.2', vmfSectionReasoningProviderReasoningEffort: 'medium' })
    resolver.mockClear(); writer.mockClear()
  })

  test.each(['VMF', 'PACKAGE'])('actual %s action emits only model context reason, passes exact runtime and prepares safe audit pair', async selectedBranch => {
    branch = selectedBranch
    const args = fixture(branch === 'PACKAGE' ? 'GOVERNED_PACKAGE_REASONING' : undefined)
    const before = structuredClone(args.runtimeInstance)
    const result = await apply(args)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer.mock.calls[0][0].providerRuntime).toBe(allocation)
    expect(result.generationResult.regeneration.reasons).toEqual(['SECTION_PROVIDER_CONTEXT_CHANGED'])
    expect(result.generationResult.regeneration.currentProviderContext).toMatchObject({ model: 'gpt-5.2', reasoningEffort: 'medium' })
    expect(result.generationResult.regeneration.previousProviderContext.model).toBe('gpt-4.1-mini')
    expect(JSON.stringify(result.generationResult.regeneration)).not.toMatch(/test-secret|providerAdapter|apiKey/)
    expect(result.generationResult.regeneration).not.toHaveProperty('providerRuntime')
    expect(args.runtimeInstance).toEqual(before)
    expect(result.nextFrameworkState.sections.customer_context.accepted).toBeNull()
  })

  test('actual unchanged context rejects before writer', async () => {
    allocation = runtime()
    await expect(apply(fixture())).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
    expect(writer).not.toHaveBeenCalled()
  })

  test.each(['missing', 'malformed', 'unavailable'])('actual %s context rejects before writer', async variant => {
    const args = fixture()
    if (variant === 'missing') delete args.runtimeInstance.framework_state.sections.customer_context.generated.generator.provider
    if (variant === 'malformed') args.runtimeInstance.framework_state.sections.customer_context.generated.generator.provider.model = 42
    if (variant === 'unavailable') allocation = runtime({ vmfSectionReasoningProviderEnabled: false })
    await expect(apply(args)).rejects.toMatchObject({ status: 409,
      code: variant === 'unavailable' ? 'SECTION_PROVIDER_CONTEXT_UNAVAILABLE' : 'SECTION_PROVIDER_CONTEXT_INVALID' })
    expect(writer).not.toHaveBeenCalled()
  })

  test.each(['DETERMINISTIC', 'RUNTIME_MANAGED', 'OTHER_MODE'])('actual %s path skips provider resolution', async mode => {
    branch = null
    const args = fixture(mode)
    args.payload.additionalContext = 'Changed legitimate section request'
    const result = await apply(args)
    expect(resolver).not.toHaveBeenCalled()
    expect(writer.mock.calls[0][0].providerRuntime).toBeUndefined()
    expect(result.generationResult.regeneration.reasons).toEqual(['INPUT_CHANGED'])
    expect(result.generationResult.regeneration).not.toHaveProperty('currentProviderContext')
  })
})

