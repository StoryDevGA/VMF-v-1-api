import { describe, expect, test, jest } from '@jest/globals'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'
import { prepareGovernedOutcomeApprovalRender } from '../services/outcomeGovernedFinalisationService.js'
import { loadOutcomeGovernedQualityChainStyleSource } from '../services/outcomeGovernedQualityChainValidationService.js'
import { buildCommercialOutputContract, COMMERCIAL_OUTPUT_SECTION_KEYS } from '../utils/outcomeCommercialExpressionProfile.js'

// These tests exercise preparation and exact source loading, not native receipt
// persistence, a genuine RL verdict or permission to deliver synthetic outputs.
const commercialFixture = (version = 'outcome-commercial-expression.v3') => {
  const value = makeGovernedFinalisationFixture()
  const { plan } = value
  const packs = plan.payload.resolution.selectedPacks
  const output = packs.find(pack => pack.packType === 'OUTPUT_TYPE_DEFINITION')
  const schema = packs.find(pack => pack.packType === 'OUTPUT_SCHEMA')
  const style = packs.find(pack => pack.packType === 'STYLE')
  const visual = packs.find(pack => pack.packType === 'VISUAL_SYSTEM')
  output.packKey = output.capabilityKey = 'commercial-strategy-and-decision-paper'
  schema.packKey = schema.capabilityKey = 'commercial-strategy-and-decision-paper-schema'
  plan.requestedOutputTypeKey = output.packKey
  plan.payload.consumerIntent.requestedOutputTypeKey = output.packKey
  plan.payload.consumerIntent.compositionResolution = { request: { requestedStyleKey: style.packKey, visualSystemKey: visual.packKey } }
  plan.payload.governedContext.outputType.key = output.packKey
  plan.payload.governedContext.outputSchema.key = schema.packKey
  for (const record of [value.draft, value.iteration]) record.outputTypeCapabilityKey = output.packKey
  Object.assign(value.stages[4].outputSnapshot, {
    candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', expressionProfileVersion: version,
    outputContract: buildCommercialOutputContract({ plan }),
    sections: COMMERCIAL_OUTPUT_SECTION_KEYS.map(sectionKey => ({ sectionKey })),
  })
  return value
}

describe('governed commercial preparation compatibility', () => {
  test.each(['outcome-commercial-expression.v1', 'outcome-commercial-expression.v2', 'outcome-commercial-expression.v3', 'outcome-commercial-expression.v4'])(
    'prepares %s using the frozen contract without changing sources', async version => {
      const value = commercialFixture(version), before = JSON.stringify(value)
      const prepareRender = jest.fn(async args => args)
      const result = await prepareGovernedOutcomeApprovalRender({ state: value,
        assetVersion: { outputTypeCapabilityKey: value.plan.requestedOutputTypeKey },
        loadPackReceipt: value.loadRenderingPackReceipt, prepareRender })
      expect(prepareRender).toHaveBeenCalledTimes(1)
      expect(result.format).toBe('MARKDOWN')
      expect(result.outputContract.outputTypeKey).toBe('commercial-strategy-and-decision-paper')
      expect(result.outputContract.outputSchemaKey).toBe('commercial-strategy-and-decision-paper-schema')
      expect(value.stages[4].outputSnapshot.outputContract.sections).toEqual(COMMERCIAL_OUTPUT_SECTION_KEYS)
      expect(JSON.stringify(value)).toBe(before)
    })
  test.each([
    ['candidate type', value => { value.stages[4].outputSnapshot.candidateType = 'EXECUTIVE_BRIEF' }],
    ['unknown profile', value => { value.stages[4].outputSnapshot.expressionProfileVersion = 'outcome-commercial-expression.v99' }],
    ['contract pin', value => { value.stages[4].outputSnapshot.outputContract.packs[2].versionId = 'different-version' }],
    ['contract order', value => { value.stages[4].outputSnapshot.outputContract.sections.reverse() }],
    ['selected type', value => { value.plan.payload.governedContext.outputType.key = 'executive-brief' }],
  ])('rejects mismatched %s before preparing a render', async (_name, mutate) => {
    const value = commercialFixture(), prepareRender = jest.fn()
    mutate(value)
    await expect(prepareGovernedOutcomeApprovalRender({ state: value,
      assetVersion: { outputTypeCapabilityKey: value.plan.requestedOutputTypeKey },
      loadPackReceipt: value.loadRenderingPackReceipt, prepareRender })).rejects.toThrow()
    expect(prepareRender).not.toHaveBeenCalled()
  })
  test('preserves the existing Executive Brief route', async () => {
    const value = makeGovernedFinalisationFixture()
    const result = await prepareGovernedOutcomeApprovalRender({ state: value,
      assetVersion: { outputTypeCapabilityKey: value.plan.requestedOutputTypeKey },
      loadPackReceipt: value.loadRenderingPackReceipt, prepareRender: async args => args })
    expect(result.outputContract.outputTypeKey).toBe('executive-brief')
  })
  test.each(['outcome-commercial-expression.v3', 'outcome-commercial-expression.v4'])(
    'loads exact trusted style identity for %s in the caller transaction', async version => {
      const value = commercialFixture(version), session = {}, source = { available: true }
      const loadPackContent = jest.fn(async () => source)
      const result = await loadOutcomeGovernedQualityChainStyleSource({ ...value, session, loadPackContent })
      const style = value.plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'STYLE')
      expect(loadPackContent).toHaveBeenCalledWith({ packId: style.packId, versionId: style.versionId, session })
      expect(result).toBe(source)
    })
  test('rejects ambiguous style selection and source-loader failure without fallback', async () => {
    const value = commercialFixture(), loadPackContent = jest.fn(async () => { throw new Error('Source unavailable') })
    await expect(loadOutcomeGovernedQualityChainStyleSource({ ...value, loadPackContent })).rejects.toThrow('Source unavailable')
    const style = value.plan.payload.resolution.selectedPacks.find(pack => pack.packType === 'STYLE')
    value.plan.payload.resolution.selectedPacks.push(style)
    await expect(loadOutcomeGovernedQualityChainStyleSource({ ...value, loadPackContent })).rejects.toThrow()
    expect(loadPackContent).toHaveBeenCalledTimes(1)
  })
  test('does not load new style content for legacy Executive Brief history', async () => {
    const value = makeGovernedFinalisationFixture(), loadPackContent = jest.fn()
    expect(await loadOutcomeGovernedQualityChainStyleSource({ ...value, loadPackContent })).toBeUndefined()
    expect(loadPackContent).not.toHaveBeenCalled()
  })
})
