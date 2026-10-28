import { buildPresentationExpressionSection, OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, presentSourceQualification } from '../utils/outcomePresentationExpressionProfile.js'
import { buildReadableExpressionSection } from '../utils/outcomeReadableExpressionProfile.js'
import { buildOutcomeShapedCandidateRevisionOutput } from '../services/outcomePostArlQualityChainService.js'
import { buildOutcomeQualityStageExecutionCandidate, hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import OutcomeQualityStageExecution from '../models/OutcomeQualityStageExecution.js'
import { OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'
import { makePlan, makeNarrativePlanSource, buildShapedCandidate, internalExecutionIdentity, executionIdentity, ids } from './fixtures/outcomeQualityStageFixtures.js'

const qualifier = 'Claim effective date, real-world currentness and measurement window are not established; capture/upload metadata is not an effective claim date.'
const context = 'Bounded conclusion: distinguish the described proposal from the recorded position on support and approval. The following source statements establish neither a completed trial nor an adopted execution decision.'
const catalogueContext = 'Source record: keep intake identity separate from document provenance. The document qualification catalogue below preserves the exact source qualifications, including historical wording; that wording is not a new current-review decision.'
const sections = () => [
  { order: 1, sectionKey: 'executive-conclusion', heading: 'Executive conclusion', keyMessages: [
    `${context} Document statement from Register: source.txt (document qualifications 1 in Source and lineage record): > Access review remains outstanding.`,
    'Document Register: Access review remains outstanding.',
  ], qualification: '', diagramIntent: '', truthReferences: ['customer-context'] },
  { order: 2, sectionKey: 'source-and-lineage-record', heading: 'Source and lineage record', keyMessages: [
    `${catalogueContext} Document qualifications 1 — Register: source.txt (verbatim; applies only to quotations marked with this entry): > ${qualifier}`,
  ], qualification: '', diagramIntent: '', truthReferences: ['customer-context'] },
]
const render = (all = sections(), index = 0) => buildPresentationExpressionSection(all[index], { sections: all })

describe(OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, () => {
  it('uses neutral headings, stable typed blocks and verbatim source quotations while recording exact original commentary', () => {
    const result = render()
    expect(result.heading).toBe('Proposal status')
    expect(result.typedBlocks.map(block => block.kind)).toEqual(['EXPLANATION', 'SOURCE_QUOTATION', 'SOURCE_QUALIFICATIONS'])
    expect(result.body).toContain('> Access review remains outstanding.')
    expect(result.body).not.toMatch(/Review context|Bounded conclusion:/)
    expect(result.qualification).toContain('Claim date and currentness are unknown.')
    expect(result.trace.originalContexts).toEqual([context])
    expect(result.trace.originalKeyMessages).toEqual(sections()[0].keyMessages)
    expect(result.trace.mappings).toEqual(expect.arrayContaining([expect.objectContaining({ original: qualifier })]))
  })
  it('preserves effective-date, capture, synthetic, verification, provenance and missing-locator qualifications in plain language', () => {
    for (const value of [qualifier,
      'Disposable synthetic test only; this is not a customer case or evidence of real-world operations.',
      'Legacy text-source location is supported only by the external frozen ledger text match; no native capture span receipt exists.',
      'SOURCE_PRESENTED exact statement only. Native ACCEPTED and extraction VALIDATED statuses do not establish authenticity, independent verification, corroboration or business truth.',
      'Current R2 contradiction candidate contradiction_abc123 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.',
      'R1 fictional scenario reused unchanged in R2; no R2 changed-support delta is admitted. Repeated documents share authored synthetic provenance and are not independent corroboration.',
    ]) {
      expect(presentSourceQualification(value)).not.toMatch(/contradiction_|UNREVIEWED|SOURCE_PRESENTED|ACCEPTED|VALIDATED/)
    }
    expect(presentSourceQualification(qualifier)).toMatch(/unknown/)
    expect(() => presentSourceQualification(`${qualifier} Approved.`)).toThrow('does not recognise')
  })
  it('refuses unknown sections, altered commentary, unknown qualifications or unaccounted supplementary statements', () => {
    for (const mutate of [
      all => { all[0].sectionKey = 'unknown-section' },
      all => { all[0].keyMessages[0] = all[0].keyMessages[0].replace('neither', 'both') },
      all => { all[1].keyMessages[0] += ' Additional unexplained condition.' },
      all => { all[0].keyMessages.push('Unaccounted new claim.') },
      all => { all[0].qualification = 'New unrelated qualification.' },
    ]) { const all = sections(); mutate(all); expect(() => render(all)).toThrow() }
  })
  it('refuses altered or internally identified quotations instead of silently paraphrasing them', () => {
    const all = sections()
    all[0].keyMessages[0] = all[0].keyMessages[0].replace('Access review remains outstanding.', 'Access review is approved.')
    expect(() => render(all)).toThrow()
    all[0].keyMessages = [`${context} Document statement from Register: source.txt (document qualifications 1 in Source and lineage record): > contradiction_abc123 remains outstanding.`, 'Document Register: contradiction_abc123 remains outstanding.']
    expect(() => render(all)).toThrow('reader-safe')
  })
  it('keeps historical qualifiers separate from a present decision and retains the original record in trace', () => {
    const all = sections()
    const historical = 'Current R2 contradiction candidate contradiction_abc123 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.'
    all[1].keyMessages[0] = all[1].keyMessages[0].replace(qualifier, historical)
    const result = render(all, 1)
    expect(result.body).toContain('At the time of this historical source note')
    expect(result.body).not.toContain('contradiction_abc123')
    expect(result.trace.originalKeyMessages[0]).toContain(historical)
    expect(result.qualification).toContain('do not decide the current review')
  })
  it('keeps meaningful local limits concise and renders the full historical catalogue once', () => {
    const all = sections()
    const historical = 'Current R2 contradiction candidate contradiction_abc123 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.'
    const provenance = 'R1 fictional scenario reused unchanged in R2; no R2 changed-support delta is admitted. Repeated documents share authored synthetic provenance and are not independent corroboration.'
    all[1].keyMessages[0] += ` > ${historical} > ${provenance}`
    const local = render(all), appendix = render(all, 1)
    expect(local.qualification).toContain('Claim date and currentness are unknown')
    expect(local.qualification).toContain('Full limits: §14')
    expect(local.qualification).not.toContain('measurement period')
    expect(appendix.body).toContain('measurement period are unknown')
    expect(local.qualification).not.toContain('- ')
    expect(local.qualification).not.toContain('At the time of this historical source note')
    expect(appendix.body).toContain('At the time of this historical source note')
    expect(appendix.body).toContain('no new supporting-evidence change admitted')
    expect(local.trace.mappings).toEqual(expect.arrayContaining([expect.objectContaining({
      original: historical, readerLocation: 'source-and-lineage-record', pointOfUseText: '',
    })]))
  })
  it('leaves legacy v2 output, source bytes and diagram meaning unchanged', () => {
    const all = sections(); all[0].diagramIntent = 'A question remains open.'
    const before = JSON.stringify(all)
    const v2 = JSON.stringify(buildReadableExpressionSection(all[0], { sections: all }))
    expect(render(all).diagram).toEqual({ present: true, description: 'A question remains open.', accessibleText: 'A question remains open.' })
    expect(JSON.stringify(all)).toBe(before)
    expect(JSON.stringify(buildReadableExpressionSection(all[0], { sections: all }))).toBe(v2)
  })
  it('passes the exact candidate normalizer/model for v3 and rejects changed wording, title, qualification or source references', async () => {
    const plan = makePlan(), narrative = makeNarrativePlanSource(plan)
    narrative.outputSnapshot.sections = sections().map(section => ({ ...section, purpose: 'Describe the recorded boundary.', truthReferences: narrative.outputSnapshot.truthReferences }))
    narrative.outputFingerprint = hashOutcomeQualityStageValue(narrative.outputSnapshot)
    const prior = { stageExecutionId: 'outcome_quality_stage_prior_presentation', ...buildShapedCandidate({ plan, sourceStageExecution: narrative }) }
    const failed = { stageExecutionId: 'outcome_quality_stage_failed_presentation', ...buildOutcomeQualityStageExecutionCandidate({
      plan, runtimeInstanceId: ids.runtime, expectedPlanFingerprint: plan.planFingerprint, stageKey: 'RENDERED_EXPRESSION_RL', expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: prior.stageExecutionId, predecessorAttemptFingerprint: prior.attemptFingerprint, sourceStageExecution: prior,
      status: 'FAILED', failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Presentation requires correction.', retryable: false },
      executionIdentity: executionIdentity({ providerConfigurationVersion: 'OUTCOME_RENDERED_EXPRESSION_RL_OPENAI_RESPONSES_V1', runtimeVersion: 'rendered-expression-rl.v1' }),
      startedAt: '2026-08-03T09:05:00.000Z', completedAt: '2026-08-03T09:05:00.100Z',
    }) }
    const artifact = { runtimeArtifactId: failed.executionIdentity.grrRuntimeArtifactId, executionId: failed.executionIdentity.grrExecutionId,
      status: 'GENERATED', outputTypeKey: 'RENDERED_EXPRESSION_RL', generatedOutput: { outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION, overallStatus: 'FAIL', findings: ['STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION'].map(dimension => ({ dimension, status: 'FAIL', requiredChange: true, finding: 'Requires correction.' })) } }
    const output = buildOutcomeShapedCandidateRevisionOutput({ failedRlStage: failed, narrativePlanStage: narrative, priorCandidateStage: prior, plan, rlArtifact: artifact, expressionProfileVersion: OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION })
    const args = { plan, runtimeInstanceId: ids.runtime, expectedPlanFingerprint: plan.planFingerprint, stageKey: 'OUTPUT_SHAPING', expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: prior.stageExecutionId, predecessorAttemptFingerprint: prior.attemptFingerprint, sourceStageExecution: narrative,
      status: 'SUCCEEDED', output, executionIdentity: internalExecutionIdentity(), startedAt: '2026-08-03T09:06:00.000Z', completedAt: '2026-08-03T09:06:00.100Z' }
    const candidate = buildOutcomeQualityStageExecutionCandidate(args)
    await expect(new OutcomeQualityStageExecution({ stageExecutionId: 'outcome_quality_stage_offline_presentation', ...candidate, createdBy: ids.actor }).validate()).resolves.toBeUndefined()
    for (const field of ['body', 'heading', 'qualification', 'truthReferences']) {
      const changed = structuredClone(output)
      changed.sections[0][field] = field === 'truthReferences' ? ['unrelated'] : 'Changed meaning.'
      expect(() => buildOutcomeQualityStageExecutionCandidate({ ...args, output: changed })).toThrow()
    }
    expect(() => buildOutcomeShapedCandidateRevisionOutput({ failedRlStage: failed, narrativePlanStage: narrative, priorCandidateStage: prior, plan, rlArtifact: artifact, expressionProfileVersion: OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, title: 'Changed title' })).toThrow('cannot change')
  })
})
