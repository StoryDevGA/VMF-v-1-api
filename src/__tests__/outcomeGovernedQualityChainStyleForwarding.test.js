import { describe, expect, test, jest } from '@jest/globals'

// Observe the actual canonical builder without replacing its validation. The
// fixture remains the real legacy six-stage chain; commercial source validity
// is covered separately by styleOverlayPolicy and preparation contract tests.
const actual = await import('../services/outcomeQualityStageExecutionService.js')
const { makeRequestScopedQualityChain } = await import('./fixtures/outcomeQualityStageFixtures.js')
const requestBinding = { requestId: '8abedafd-8555-4342-be49-76ab906a26f6',
  draftId: 'outcome_draft_8d91bfbd-6670-4cfe-807b-a6d41bd4181e',
  draftIterationId: 'outcome_draft_iteration_5eebbe35-cfba-47d0-883f-e0cb408c1905' }
// Cross the module-registry observation boundary using the same plain JSON
// representation that the canonical reader consumes, not old BSON prototypes.
const fixture = JSON.parse(JSON.stringify({ ...makeRequestScopedQualityChain(requestBinding), requestBinding }))
const builder = jest.fn(actual.buildOutcomeQualityStageExecutionCandidate)
jest.resetModules()
jest.unstable_mockModule('../services/outcomeQualityStageExecutionService.js', () => ({
  ...actual, buildOutcomeQualityStageExecutionCandidate: builder,
}))
const { validateOutcomeGovernedQualityChain } = await import('../services/outcomeGovernedQualityChainValidationService.js')

describe('trusted style source forwarding to the canonical builder', () => {
  test('passes the supplied source to each real stage rebuild without replacing validation', () => {
    const styleSource = Object.freeze({ available: true, content: 'Exact trusted source', versionId: 'frozen-style-version' })
    const before = JSON.stringify(fixture)
    expect(validateOutcomeGovernedQualityChain({ ...fixture, styleSource })).toEqual(fixture.stages)
    expect(builder).toHaveBeenCalledTimes(6)
    expect(builder.mock.calls.find(([args]) => args.stageKey === 'OUTPUT_SHAPING')[0].styleSource).toBe(styleSource)
    expect(JSON.stringify(fixture)).toBe(before)
  })
})
