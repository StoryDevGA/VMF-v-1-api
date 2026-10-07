import { createHash } from 'node:crypto'
import { makeSs040Fixture } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract, hashEvidenceToMeaningValue } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectEvidenceToMeaningProviderContract } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { describe, expect, jest, test } from '@jest/globals'

import {
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFEGUARDS } from '../services/outcomeStudioProviderSafeContextService.js'
import { createOpenAiOutcomeWorkingDraftProviderAdapter } from '../services/openAiOutcomeWorkingDraftProviderAdapter.js'

const providerConfig = {
  apiKey: 'test-secret-not-real',
  completionTimeoutMs: 300000,
  maxOutputTokens: 8000,
  maxRetries: 0,
  model: 'gpt-5.2',
  pollIntervalMs: 1000,
  providerKey: 'openai',
  timeoutMs: 60000,
}

const guidance = {
  businessInstructions: ['Create one Working Draft from the supplied verified truth.'],
  reasoningGuidance: ['Translate analysis into draft business sections.'],
  outputSchema: ['Return Working Draft sections, claims, decision logic, assumptions and visible gaps.'],
  styleGuidance: ['Use concise executive business language.'],
  validationCriteria: ['Every accepted truth reference must remain represented.'],
  prohibitedOutputBoundaries: ['Meaning remains unapproved at Working Draft.'],
}

const makeContext = (overrides = {}) => ({
  contractVersion: OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  businessRequest: {
    outputTypeKey: 'WORKING_DRAFT',
    requestedOutputTypeKey: 'working-draft',
    requestedStyleKey: 'governed-working-draft',
    workspaceType: 'PLATFORM',
    instruction: 'Create one Parlon executive Working Draft.',
  },
  draftContext: { content: '' },
  truthSummaries: [
    { label: 'customer_context', summary: 'Parlon supports evidence-sensitive teams.' },
    { label: 'strategic_objectives', summary: 'Parlon needs faster executive decisions.' },
  ],
  guidance,
  safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
  targetStage: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
  sourceCandidate: {
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
    schemaVersion: 'fs-003-framework-guidance-analysis.v0.2',
    title: 'Parlon decision guidance',
    sections: [{
      order: 1,
      sectionKey: 'governed_position',
      title: 'Governed position',
      analysis: 'The accepted evidence supports a bounded executive decision.',
      implications: ['The decision should preserve qualifications.'],
      recommendations: ['Keep visible gaps in the draft.'],
      qualification: 'Delivery channel remains unspecified.',
      truthReferences: ['customer_context', 'strategic_objectives'],
      assumptions: [],
      gaps: ['Exact delivery file type is not specified.'],
    }],
    decisionUsefulness: {
      summary: 'Use accepted evidence to sequence the decision.',
      priorities: ['Preserve the evidence boundary.'],
      materialRisks: ['Unspecified delivery detail may change execution.'],
      recommendedNextStep: 'Create the unapproved Working Draft.',
    },
    assumptions: [],
    visibleGaps: ['Exact delivery file type is not specified.'],
  },
  ...overrides,
})

const providerOutput = (overrides = {}) => ({
  outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
  schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
  draftVersion: 1,
  title: 'Parlon Executive Brief Working Draft',
  sections: [{
    order: 1,
    sectionKey: 'executive_position',
    title: 'Executive position',
    content: 'The accepted evidence supports a bounded executive decision with explicit qualifications.',
    claims: [{
      claimKey: 'claim_evidence_boundary',
      statement: 'The supplied summary presents Parlon as claiming this outcome; independent verification is not established in the supplied summaries.',
      truthReferences: ['customer_context', 'strategic_objectives'],
      evidence: ['Accepted truth establishes the customer context and strategic objective.'],
      meaningClass: 'SOURCE_PRESENTED',
      proofDependencies: [],
      validationStatus: 'NOT_STATED',
      proofDisposition: 'NOT_ESTABLISHED',
      whatCanBeSaidNow: 'The supplied summary presents Parlon as claiming this outcome.',
      blockedStrongerClaim: 'An achieved outcome is not established in the supplied summaries.',
      evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline, method and measurement window.'],
    }],
    truthReferences: ['customer_context', 'strategic_objectives'],
    assumptions: [],
    gaps: ['Exact delivery file type is not specified.'],
  }],
  decisionLogic: [{
    decisionKey: 'preserve_evidence_boundary',
    rationale: 'Interpretive placeholder: Source-presented framing: the supplied summary presents Parlon as expressing the claim. Recognition gap: recognition is not established in the supplied summaries. Understanding gap: measurement meaning is not established in the supplied summaries. Bounded interpretation now: the supplied summary presents Parlon as claiming this outcome. Qualified Reality: an achieved outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Ordering is not established in the supplied evidence.',
    priority: 'NOT_ESTABLISHED',
    priorityBasis: 'NOT_ESTABLISHED',
    closureState: 'INCOMPLETE',
    actionAuthorization: 'NONE',
    truthReferences: ['customer_context', 'strategic_objectives'],
  }],
  assumptions: [],
  visibleGaps: ['Exact delivery file type is not specified.'],
  ...overrides,
})

const responseBody = (output = providerOutput(), overrides = {}) => ({
  id: 'resp_working_draft_qa',
  status: 'completed',
  created_at: 1785938400,
  output: [{
    type: 'message',
    content: [{ type: 'output_text', text: JSON.stringify(output) }],
  }],
  usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
  ...overrides,
})

const response = ({ body = responseBody(), ok = true, status = 200, requestId = 'req_working_draft_qa' } = {}) => ({
  ok,
  status,
  headers: { get: jest.fn((header) => (header === 'x-request-id' ? requestId : '')) },
  json: jest.fn(async () => body),
})

const makeAdapter = (overrides = {}) => createOpenAiOutcomeWorkingDraftProviderAdapter({
  ...providerConfig,
  fetchImpl: jest.fn().mockResolvedValue(response()),
  now: () => 1000,
  sleep: jest.fn(async () => {}),
  ...overrides,
})

describe('createOpenAiOutcomeWorkingDraftProviderAdapter', () => {
  test('uses neutral evidence-bound claim fields and does not prescribe rejected status or no-action wording', async () => {
    const output = providerOutput()
    output.sections[0].claims[0] = {
      ...output.sections[0].claims[0],
      statement: 'The supplied summary presents Parlon as claiming this outcome; independent verification is not established in the supplied summaries.',
      validationStatus: 'NOT_STATED',
      proofDisposition: 'NOT_ESTABLISHED',
      whatCanBeSaidNow: 'The supplied summary presents Parlon as claiming this outcome.',
      blockedStrongerClaim: 'An achieved outcome is not established in the supplied summaries.',
      evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline, method and measurement window.'],
    }
    output.decisionLogic[0].rationale = 'Interpretive placeholder: Source-presented framing: the supplied summary presents Parlon as expressing the claim. Recognition gap: recognition is not established in the supplied summaries. Understanding gap: measurement meaning is not established in the supplied summaries. Bounded interpretation now: the supplied summary presents Parlon as claiming this outcome. Qualified Reality: an achieved outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Ordering is not established in the supplied evidence.'
    const capture = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))

    const result = await makeAdapter({ fetchImpl: capture })({ providerContext: makeContext() })
    const instructions = JSON.parse(capture.mock.calls[0][1].body).instructions

    expect(instructions).toContain('Ordering is not established in the supplied evidence')
    expect(instructions).not.toContain('no ordered action is required')
    expect(instructions).not.toContain('unvalidated in the supplied summaries')
    expect(result.output.sections[0].claims[0]).toMatchObject({
      meaningClass: 'SOURCE_PRESENTED',
      truthReferences: ['customer_context', 'strategic_objectives'],
      validationStatus: 'NOT_STATED',
      proofDisposition: 'NOT_ESTABLISHED',
      whatCanBeSaidNow: expect.any(String),
      blockedStrongerClaim: expect.any(String),
      evidenceRequiredToSubstantiate: expect.any(Array),
    })
  })

  test('preserves attributed SOURCE_PRESENTED meaning without inventing validation or dependencies', async () => {
    const output = providerOutput()
    output.sections[0].claims[0].statement = 'The supplied summary presents Parlon as claiming this outcome; independent verification is not established in the supplied summaries.'
    output.sections[0].claims[0].meaningClass = 'SOURCE_PRESENTED'
    output.sections[0].claims[0].proofDependencies = []
    const capture = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    const result = await makeAdapter({ fetchImpl: capture })({ providerContext: makeContext() })
    const instructions = JSON.parse(capture.mock.calls[0][1].body).instructions
    expect(instructions).toContain('Add no proofDependencies unless accepted customer truth identifies a specific unresolved item for that claim')
    expect(instructions).toContain('Classify an attributed assertion as SOURCE_PRESENTED')
    expect(instructions).toContain('an empty list does not establish validation, completeness, readiness, or an adopted proof requirement')
    expect(result.output.sections[0].claims[0]).toEqual(output.sections[0].claims[0])
    expect(result.metadata.meaningContractVersion).toBe('ss-033-working-draft-meaning-boundary.v15')
  })

  test.each([
    ['Parlon claims this outcome; independent verification is not established in the supplied summaries.', 'QUALIFIED_EMPTY_DEPENDENCY_ATTRIBUTION'],
    ['The supplied summary presents Parlon as claiming this outcome.', 'QUALIFIED_EMPTY_DEPENDENCY_VALIDATION_STATUS'],
  ])('reports the exact empty-dependency blocker for an unqualified response', async (statement, validationRule) => {
    const output = providerOutput()
    output.sections[0].claims[0].statement = statement
    output.sections[0].claims[0].meaningClass = 'QUALIFIED'
    output.sections[0].claims[0].proofDependencies = []
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationRule,
      }),
    })
  })

  test('the disclaimer required by the outgoing prompt passes the actual rationale validator unchanged', async () => {
    const capture = jest.fn().mockResolvedValue(response())
    await makeAdapter({ fetchImpl: capture })({ providerContext: makeContext() })
    const instructions = JSON.parse(capture.mock.calls[0][1].body).instructions
    const disclaimer = /In every decision rationale, include exactly: "([^"]+)"/.exec(instructions)?.[1]
      || /In every decision rationale, state exactly that they are (.*?)\. Never/.exec(instructions)?.[1]
    expect(disclaimer).toBeTruthy()
    const output = providerOutput()
    output.decisionLogic[0].rationale = output.decisionLogic[0].rationale.replace(
      'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements',
      disclaimer,
    )
    const result = await makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })),
    })({ providerContext: makeContext() })
    expect(result.output.decisionLogic[0].rationale).toBe(output.decisionLogic[0].rationale)
  })

  test('reports a missing proof-boundary disclaimer without leaking rejected rationale', async () => {
    const output = providerOutput()
    output.decisionLogic[0].rationale = output.decisionLogic[0].rationale.replace(
      'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements',
      'private rejected disclaimer',
    )
    const error = await makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })),
    })({ providerContext: makeContext() }).catch((failure) => failure)
    expect(error).toMatchObject({ details: {
      reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
      validationField: 'decisionLogic[0].rationale', validationRule: 'PROOF_PLACEHOLDER_BOUNDARY',
    } })
    expect(JSON.stringify(error)).not.toContain('private rejected disclaimer')
    expect(error.message).not.toContain('private rejected disclaimer')
    expect(error.stack).not.toContain('private rejected disclaimer')
  })

  test('the environmental example sent to the provider passes as SOURCE_PRESENTED with no invented dependency', async () => {
    const capture = jest.fn().mockResolvedValue(response())
    await makeAdapter({ fetchImpl: capture })({ providerContext: makeContext() })
    const instructions = JSON.parse(capture.mock.calls[0][1].body).instructions
    const example = /For example, write environmental wording as: "([^"]+)"/.exec(instructions)?.[1]
    expect(example).toBeTruthy()
    const output = providerOutput()
    output.sections[0].content = example
    output.sections[0].claims[0].statement = example
    output.sections[0].claims[0].meaningClass = 'SOURCE_PRESENTED'
    output.sections[0].claims[0].proofDependencies = []
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    const result = await adapter({ providerContext: makeContext() })
    expect(result.output.sections[0].claims[0]).toEqual(output.sections[0].claims[0])
  })

  test.each([
    'independent verification is not established in the supplied summaries.',
    'validation status is not stated in the supplied summaries.',
  ])('rejects a source-only unvalidated assertion mislabeled as QUALIFIED: %s', async (boundary) => {
    const output = providerOutput()
    output.sections[0].claims[0].meaningClass = 'QUALIFIED'
    output.sections[0].claims[0].statement = `The supplied summary presents Parlon as claiming this outcome; ${boundary}`
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationRule: 'SOURCE_ONLY_CLAIM_CLASSIFICATION',
      }),
    })
  })

  test('rejects the universal seven-item proof-dependency bundle', async () => {
    const output = providerOutput()
    output.sections[0].claims[0].meaningClass = 'QUALIFIED'
    output.sections[0].claims[0].proofDependencies = [
      'METRIC_DEFINITION', 'BASELINE', 'METHOD', 'SCOPE', 'MEASUREMENT_WINDOW', 'SOURCE_LINKAGE', 'ATTRIBUTION',
    ]
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationRule: 'DEFAULT_PROOF_DEPENDENCY_BUNDLE',
      }),
    })
  })

  test('reports missing SOURCE_PRESENTED attribution specifically without exposing the rejected statement', async () => {
    const output = providerOutput()
    const statement = 'Parlon offers a platform for evidence-sensitive teams.'
    output.sections[0].claims[0] = {
      ...output.sections[0].claims[0], statement, meaningClass: 'SOURCE_PRESENTED', proofDependencies: [],
    }
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    const error = await adapter({ providerContext: makeContext() }).catch((failure) => failure)
    expect(error).toMatchObject({
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField: 'sections[0].claims[0].statement',
        validationRule: 'SOURCE_ATTRIBUTION',
      },
    })
    expect(JSON.stringify(error)).not.toContain(statement)
    expect(error.message).not.toContain(statement)
    expect(error.stack).not.toContain(statement)
  })

  test('accepts explicit SOURCE_PRESENTED attribution without upgrading or rewriting the claim', async () => {
    const output = providerOutput()
    output.sections[0].claims[0] = {
      ...output.sections[0].claims[0],
      statement: 'The supplied summary presents Parlon as offering a platform for evidence-sensitive teams.',
      meaningClass: 'SOURCE_PRESENTED', proofDependencies: [],
    }
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })

    const result = await adapter({ providerContext: makeContext() })
    expect(result.output.sections[0].claims[0]).toEqual(output.sections[0].claims[0])
  })

  test('sends one exact background request and returns sanitized governed Working Draft output', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response())
    const adapter = makeAdapter({ fetchImpl })
    const context = makeContext()

    const result = await adapter({ providerContext: context })

    expect(adapter.configurationVersion).toBe(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer test-secret-not-real')
    const body = JSON.parse(options.body)
    expect(Object.keys(body)).toEqual(['model', 'background', 'store', 'max_output_tokens', 'instructions', 'input', 'text'])
    expect(body).toMatchObject({
      model: 'gpt-5.2',
      background: true,
      store: false,
      max_output_tokens: 8000,
    })
    expect(body.instructions).toContain('Working Draft only')
    expect(body.instructions).toContain('supports only the bounded wording')
    expect(body.instructions).toContain('Attribution is required for both SOURCE_PRESENTED and QUALIFIED claims')
    expect(body.instructions).toContain('do not describe it as missing, incomplete, or unpopulated Parlon customer evidence')
    expect(body.instructions).toContain('minimal provisional proof sequence')
    expect(body.instructions).toContain('Do not substitute a list of missing metadata for the bounded source-supported meaning')
    expect(body.instructions).toContain('Do not universalize a framework proof checklist')
    expect(body.instructions).toContain('Never copy causal or achieved outcome wording from a supplied summary without attribution')
    expect(body.instructions).toContain('Treat the requested output type as format only')
    expect(body.instructions).toContain('Use HYPOTHESIS only when accepted customer evidence expressly identifies an ordered proof dependency')
    expect(body.instructions).toContain('Use a Framework-derived sequence only when the persisted Framework Guidance source explicitly gives an ordered proof check')
    expect(body.text.format.schema.properties.decisionLogic.items.properties.rationale.description)
      .toContain('Use the optional final label "Hypothetical next proof step:" only when priorityBasis is HYPOTHESIS or FRAMEWORK_GUIDANCE')
    expect(body.text.format.schema.properties.decisionLogic.items.properties.rationale.description)
      .toContain('omit it when priorityBasis is NOT_ESTABLISHED')
    expect(body.instructions).toContain('not Parlon evidence, and not a commercial priority')
    expect(body.instructions).toContain('Do not expose internal uppercase enum names')
    expect(body.instructions).toContain('what the supplied summary supports describing about Parlon now')
    expect(body.instructions).toContain('interpretive Working Draft toward the requested output')
    expect(body.instructions).toContain('do not prescribe pre/post, comparator, control-group, experimental, or causal evaluation designs')
    expect(body.instructions).toContain('never imply an evidence-backed commercial priority order')
    expect(body.instructions).toContain('Source-presented framing:')
    expect(body.instructions).toContain('Do not use "cannot", "must", "required", or "prerequisite"')
    expect(body.instructions).toContain('distinct consecutive PROVISIONAL_SEQUENCE_n')
    expect(body.instructions).toContain('Classify an attributed assertion as SOURCE_PRESENTED')
    expect(body.instructions).toContain('Use QUALIFIED only when the draft asserts a constrained reality beyond attribution')
    expect(body.instructions).toContain('never add a default METHOD, SCOPE, SOURCE_LINKAGE, or ATTRIBUTION bundle')
    expect(body.instructions).toContain('never pair NOT_ESTABLISHED with PROVISIONAL_SEQUENCE_n')
    expect(body.instructions).toContain('Represent the full accepted customer context')
    expect(body.instructions).toContain('Every customer-facing section must contain at least one substantive non-Framework claim')
    expect(body.instructions).toContain('author-proposed structuring choice')
    expect(body.instructions).toContain('Recognition gap:')
    expect(body.instructions).toContain('Understanding gap:')
    expect(body.instructions).toContain('Do not infer an audience state')
    expect(body.instructions).toContain('never state that a summary explicitly does not provide')
    expect(body.instructions).toContain('Interpretive placeholder:')
    expect(body.instructions).toContain('priorityBasis NOT_ESTABLISHED, HYPOTHESIS, or FRAMEWORK_GUIDANCE')
    expect(body.instructions).toContain('FRAMEWORK_GUIDANCE is a proof-work sequence, not customer evidence or commercial priority')
    expect(body.instructions).toContain('Assumptions must restate an uncertainty explicitly present in accepted truth or remain empty')
    expect(body.instructions).toContain('proofDependencies are claim-specific evidence questions')
    expect(body.instructions).toContain('not evidence-backed customer facts or adopted governance requirements')
    expect(body.instructions).toContain('Proposed artefacts must be labelled as author-proposed')
    expect(body.instructions).toContain('If the statement only reports what the source says, its meaningClass is SOURCE_PRESENTED')
    expect(body.instructions).toContain('If pursued, this author-proposed proof step could')
    expect(body.instructions).toContain('author-added placeholders, not adopted Parlon requirements')
    expect(body.instructions).toContain('not adopted Parlon requirements')
    expect(body.instructions).toContain('Any proof questions not stated in accepted truth are author-added placeholders')
    expect(body.instructions).toContain('Attribution is required for both SOURCE_PRESENTED and QUALIFIED claims')
    expect(body.instructions).toContain('Never use the phrase source-presented in QUALIFIED claim prose')
    expect(body.instructions).toContain('Coverage counts, reviewed-item counts, source-count and source-type metadata are Framework/process metadata')
    expect(body.instructions).toContain('Any claim mentioning evidence coverage metadata, reviewed-item counts, supporting source(s), or source type(s) must use meaningClass FRAMEWORK_GUIDANCE')
    expect(body.instructions).toContain('same local qualification boundary')
    expect(body.instructions).toContain('must not imply that checking proof would enable external use')
    expect(body.instructions).toContain('When priorityBasis is NOT_ESTABLISHED, omit any next-step sequence and state "Ordering is not established in the supplied evidence."')
    expect(body.instructions).toContain('classify them as FRAMEWORK_GUIDANCE')
    expect(body.instructions).toContain('End a hypothetical proof step with a bounded reassessment condition, not permission to use or publish the claim')
    expect(body.instructions).toContain('When a source section is guidance-only, add a BOUNDED_INTERPRETATION evidence-gap claim')
    expect(body.instructions).toContain('A Parlon-specific outcome is not established in the supplied summaries for this section')
    expect(body.instructions).not.toContain('No Parlon-specific outcome is established in the supplied summaries for this section')
    expect(body.instructions).toContain('use exactly that bounded phrase in section content')
    expect(body.instructions).toContain('do not use QUALIFIED merely because validationStatus is NOT_STATED')
    expect(body.instructions).toContain('Classify this as SOURCE_PRESENTED with validationStatus NOT_STATED unless a summary explicitly states another status')
    expect(body.instructions).toContain('an empty list does not establish validation, completeness, readiness, or an adopted proof requirement')
    expect(body.instructions).toContain('Mention buyer segments, competitor categories, regulated or isolated buying contexts, or customer priorities only when expressly named in accepted customer truth')
    expect(body.instructions).toContain('Do not say messaging can be carried forward or positioned')
    expect(body.instructions).not.toContain('Set meaningClass QUALIFIED and list METHOD, SCOPE, SOURCE_LINKAGE, and ATTRIBUTION')
    expect(body.instructions).toContain('Never use the phrase source-presented in QUALIFIED claim prose')
    expect(body.instructions).toContain('non-authorising proof-work placeholders and must not imply')
    expect(body.instructions).toContain('Keep exact proof-dependency codes only in the structured proofDependencies field')
    expect(body.instructions).toContain('must appear in at least one claim truthReferences array')
    expect(body.instructions).toContain('Do not mention ARL, RL, internal quality stages')
    expect(body.instructions).not.toContain('ARL approval is still required downstream')
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'fs_003_working_draft_v0_3',
      strict: true,
    })
    expect(body.text.format.schema.additionalProperties).toBe(false)
    expect(body.text.format.schema.properties.outputType.const).toBe('WORKING_DRAFT')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.additionalProperties).toBe(false)
    expect(body.text.format.schema.properties.sections.items.properties.claims.description)
      .toContain('at least one substantive non-Framework customer-bound claim')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.properties.statement.description)
      .toContain('SOURCE_PRESENTED means an attributed source assertion')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.properties.statement.description)
      .toContain('Use QUALIFIED only when the draft asserts a constrained reality beyond source attribution')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.properties.statement.description)
      .toContain('QUALIFIED proofDependencies are unresolved metadata unless the prose expressly claims adoption')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.properties.statement.description)
      .toContain('Never include the phrase source-presented anywhere in a QUALIFIED statement')
    expect(body.text.format.schema.properties.sections.items.properties.claims.items.properties.proofDependencies.items.description)
      .toContain('Claim-specific evidence questions only when identified in accepted customer truth')
    expect(body.text.format.schema.properties.sections.items.properties.content.description)
      .toContain('not established in the supplied summaries')
    expect(body.text.format.schema.properties.sections.items.properties.content.description)
      .toContain('Do not use absolute omission wording')
    expect(body.text.format.schema.properties.sections.items.properties.content.description)
      .toContain('air-gapped')
    expect(body.text.format.schema.properties.sections.items.properties.content.description)
      .toContain('same sentence')
    expect(body.text.format.schema.properties.decisionLogic.items.properties.rationale.description)
      .toContain('For an ordered proof option, begin its final clause exactly')
    expect(body.text.format.schema.properties.decisionLogic.items.properties.rationale.description)
      .toContain('proofDependencies as claim-specific evidence questions, not adopted Parlon requirements or commercial gates')
    expect(body.text.format.schema.properties.sections.items.properties.assumptions.items.description)
      .toContain('not established in the supplied summaries')
    expect(body.text.format.schema.properties.sections.items.properties.gaps.items.description)
      .toContain('not established in the supplied summaries')
    expect(body.text.format.schema.properties.decisionLogic.items.properties.priorityBasis.enum)
      .toEqual(['NOT_ESTABLISHED', 'HYPOTHESIS', 'FRAMEWORK_GUIDANCE'])
    expect(body.input).toBe(JSON.stringify(context))
    expect(options.headers['Idempotency-Key'])
      .toBe(createHash('sha256').update(options.body).digest('hex'))
    expect(result).toMatchObject({
      provider: { providerKey: 'openai', model: 'gpt-5.2', providerMode: 'LIVE_TEST', liveProvider: true },
      output: { outputType: 'WORKING_DRAFT', schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION },
      limitations: ['Exact delivery file type is not specified.'],
      metadata: {
        configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
        httpRequestId: 'req_working_draft_qa',
        responseId: 'resp_working_draft_qa',
        terminalStatus: 'completed',
        storeRequested: false,
        temporaryProviderStorageForPolling: true,
        tokenUsage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      },
    })
    expect(JSON.stringify(result.metadata)).not.toContain('test-secret-not-real')
    expect(JSON.stringify(result.metadata)).not.toContain('Parlon supports evidence-sensitive teams')
    expect(result.output).not.toHaveProperty('compositionProvenance')
    expect(result.output).not.toHaveProperty('revisionHistory')
  })

  test('rejects malformed, unsafe or oversized context before transport', async () => {
    const fetchImpl = jest.fn()
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: { ...makeContext(), rawPrompt: 'not allowed' } })).rejects.toThrow()
    await expect(adapter({
      providerContext: makeContext({
        truthSummaries: [{ label: 'customer_context', summary: 'Read https://example.com.' }],
      }),
    })).rejects.toThrow()
    await expect(adapter({
      providerContext: makeContext({
        sourceCandidate: {
          ...makeContext().sourceCandidate,
          sections: [{
            ...makeContext().sourceCandidate.sections[0],
            analysis: 'x'.repeat(181000),
          }],
        },
      }),
    })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('polls a background response without issuing another create request', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockResolvedValueOnce(response())
    const sleep = jest.fn(async () => {})
    const adapter = makeAdapter({ fetchImpl, sleep })

    await adapter({ providerContext: makeContext() })

    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET'])
    expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  test('scopes provider idempotency to the governed stage attempt', async () => {
    const firstFetch = jest.fn().mockResolvedValue(response())
    const secondFetch = jest.fn().mockResolvedValue(response())
    const first = makeAdapter({ fetchImpl: firstFetch })
    const second = makeAdapter({ fetchImpl: secondFetch })

    await first({ providerContext: makeContext(), providerAttemptIdentity: '1'.repeat(64) })
    await second({ providerContext: makeContext(), providerAttemptIdentity: '2'.repeat(64) })

    const firstKey = firstFetch.mock.calls[0][1].headers['Idempotency-Key']
    const secondKey = secondFetch.mock.calls[0][1].headers['Idempotency-Key']
    expect(firstKey).toMatch(/^[a-f0-9]{64}$/)
    expect(secondKey).toMatch(/^[a-f0-9]{64}$/)
    expect(firstKey).not.toBe(secondKey)
  })

  test('maps lifecycle, transport and extraction failures to accepted Working Draft reasons only', async () => {
    const cases = [
      ['transient', jest.fn().mockResolvedValue(response({ ok: false, status: 503 })), 'WORKING_DRAFT_PROVIDER_TRANSIENT_FAILURE'],
      ['rejected', jest.fn().mockResolvedValue(response({ ok: false, status: 400 })), 'WORKING_DRAFT_PROVIDER_REJECTED'],
      ['network', jest.fn().mockRejectedValue(Object.assign(new Error('socket reset secret'), { code: 'ECONNRESET' })), 'WORKING_DRAFT_PROVIDER_NETWORK_FAILED'],
      ['response id', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { id: 'unsafe/id' }) })), 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID'],
      ['incomplete', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'incomplete', output: [] }) })), 'WORKING_DRAFT_PROVIDER_INCOMPLETE'],
      ['failed', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'failed', output: [] }) })), 'WORKING_DRAFT_PROVIDER_REQUEST_FAILED'],
      ['cancelled', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'cancelled', output: [] }) })), 'WORKING_DRAFT_PROVIDER_REQUEST_FAILED'],
      ['unknown status', jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { status: 'mystery', output: [] }) })), 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID'],
      ['refusal', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'refusal' }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_REFUSED'],
      ['zero outputs', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), { output: [] }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID', {
        validationField: 'response.output', validationRule: 'OUTPUT_TEXT_CARDINALITY',
      }],
      ['multiple outputs', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [
            { type: 'output_text', text: JSON.stringify(providerOutput()) },
            { type: 'output_text', text: JSON.stringify(providerOutput()) },
          ] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID', {
        validationField: 'response.output', validationRule: 'OUTPUT_TEXT_CARDINALITY',
      }],
      ['invalid json', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{not-json' }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID', {
        validationField: 'response.output_text', validationRule: 'OUTPUT_JSON_PARSE',
      }],
      ['oversized output', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(100001) }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_TOO_LARGE'],
      ['multibyte oversized output', jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'é'.repeat(50001) }] }],
        }),
      })), 'WORKING_DRAFT_PROVIDER_OUTPUT_TOO_LARGE'],
    ]

    for (const [_label, fetchImpl, reason, validationDetails = {}] of cases) {
      const adapter = makeAdapter({ fetchImpl })
      const caught = await adapter({ providerContext: makeContext() }).catch((error) => error)
      const expectedDetails = { reason, ...validationDetails }
      expect(caught).toMatchObject({
        code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED',
        details: expectedDetails,
      })
      expect(caught.details).toEqual(expectedDetails)
      expect(caught.message).not.toContain('socket reset secret')
    }
  })

  test('preserves the safe Responses API incomplete reason', async () => {
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({
        body: responseBody(providerOutput(), {
          status: 'incomplete',
          incomplete_details: { reason: 'max_tokens' },
          output: [],
        }),
      })),
    })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED',
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_INCOMPLETE',
        providerStatusReason: 'max_tokens',
      },
    })
  })

  test('cancels at most once after a timed-out background response', async () => {
    const abortError = Object.assign(new Error('poll timeout secret'), { name: 'AbortError' })
    const now = () => 1000
    const sleep = jest.fn(async () => {})
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(response({ body: { id: 'resp_working_draft_qa', status: 'cancelled' } }))
    const adapter = makeAdapter({ fetchImpl, now, sleep })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'WORKING_DRAFT_PROVIDER_TIMEOUT' },
    })
    expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['https://api.openai.com/v1/responses', 'POST'],
      ['https://api.openai.com/v1/responses/resp_working_draft_qa', 'GET'],
      ['https://api.openai.com/v1/responses/resp_working_draft_qa/cancel', 'POST'],
    ])
  })

  test('rejects a changed response id while polling', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { status: 'queued', output: [] }) }))
      .mockResolvedValueOnce(response({ body: responseBody(providerOutput(), { id: 'resp_other', status: 'completed' }) }))
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: { reason: 'WORKING_DRAFT_PROVIDER_RESPONSE_INVALID' },
    })
  })

  test('rejects schema, reference, gap and current approval drift while allowing pending approval wording', async () => {
    const invalidOutputs = [
      { ...providerOutput(), compositionProvenance: { hidden: true } },
      providerOutput({ visibleGaps: ['Changed gap.'] }),
      providerOutput({
        sections: [{ ...providerOutput().sections[0], truthReferences: ['customer_context'] }],
      }),
      providerOutput({
        sections: [{
          ...providerOutput().sections[0],
          claims: [{
            ...providerOutput().sections[0].claims[0],
            truthReferences: ['customer_context'],
          }],
        }],
      }),
      providerOutput({
        sections: [{ ...providerOutput().sections[0], claims: [
          { ...providerOutput().sections[0].claims[0] },
          { ...providerOutput().sections[0].claims[0] },
        ] }],
      }),
      providerOutput({ decisionLogic: [{ ...providerOutput().decisionLogic[0], decisionKey: 'preserve_evidence_boundary' }, { ...providerOutput().decisionLogic[0] }] }),
      providerOutput({ title: 'The Working Draft is approved.' }),
      providerOutput({ title: 'The Outcome Narrative Plan is ready.' }),
      providerOutput({ title: 'Output shaping is completed.' }),
      providerOutput({ title: 'The RL review has passed.' }),
      providerOutput({ title: 'The Executive Brief is final.' }),
      providerOutput({ title: 'Meaning\nis approved.' }),
    ]

    for (const output of invalidOutputs) {
      const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(output) })) })
      await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
        details: { reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID' },
      })
    }

    const allowed = providerOutput({
      sections: [{
        ...providerOutput().sections[0],
        content: 'This Working Draft keeps ARL approval as a required downstream step.',
      }],
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(allowed) })),
    })
    await expect(adapter({ providerContext: makeContext() })).resolves.toMatchObject({
      output: { sections: [expect.objectContaining({ content: expect.stringContaining('ARL approval') })] },
    })
  })

  test.each([
    ['changed visible gaps', () => providerOutput({ visibleGaps: ['provider private marker'] }), 'visibleGaps', 'VISIBLE_GAPS_MISMATCH'],
    ['section order', () => providerOutput({ sections: [{ ...providerOutput().sections[0], order: 2 }] }), 'sections[0].order', 'SECTION_ORDER'],
    ['duplicate section truth reference', () => {
      const output = providerOutput()
      output.sections[0].truthReferences = ['customer_context', 'customer_context']
      output.sections[0].claims[0].truthReferences = ['customer_context', 'customer_context']
      return output
    }, 'sections[0].truthReferences', 'DUPLICATE_TRUTH_REFERENCE'],
    ['unsupported section truth reference', () => {
      const output = providerOutput()
      output.sections[0].truthReferences = ['unsupported_context']
      output.sections[0].claims[0].truthReferences = ['unsupported_context']
      return output
    }, 'sections[0].truthReferences', 'UNSUPPORTED_TRUTH_REFERENCE'],
    ['duplicate claim truth reference', () => {
      const output = providerOutput()
      output.sections[0].claims[0].truthReferences = ['customer_context', 'customer_context']
      return output
    }, 'sections[0].claims[0].truthReferences', 'DUPLICATE_TRUTH_REFERENCE'],
    ['unsupported claim truth reference', () => {
      const output = providerOutput()
      output.sections[0].claims[0].truthReferences = ['unsupported_context']
      return output
    }, 'sections[0].claims[0].truthReferences', 'UNSUPPORTED_TRUTH_REFERENCE'],
    ['claim truth reference outside its section', () => {
      const output = providerOutput()
      output.sections[0].truthReferences = ['customer_context']
      output.sections[0].claims[0].truthReferences = ['strategic_objectives']
      return output
    }, 'sections[0].claims[0].truthReferences', 'TRUTH_REFERENCE_NOT_IN_SECTION'],
    ['section claim truth coverage', () => {
      const output = providerOutput()
      output.sections[0].claims[0].truthReferences = ['customer_context']
      return output
    }, 'sections[0].claims', 'SECTION_TRUTH_COVERAGE'],
    ['duplicate section key', () => {
      const output = providerOutput()
      output.sections.push({
        ...providerOutput().sections[0],
        order: 2,
        claims: [{ ...providerOutput().sections[0].claims[0], claimKey: 'second_claim' }],
      })
      return output
    }, 'sections[].sectionKey', 'DUPLICATE_SECTION_KEY'],
    ['duplicate claim key', () => {
      const output = providerOutput()
      output.sections[0].claims.push({ ...output.sections[0].claims[0] })
      return output
    }, 'sections[].claims[].claimKey', 'DUPLICATE_CLAIM_KEY'],
    ['unrepresented accepted truth reference', () => {
      const output = providerOutput()
      output.sections[0].truthReferences = ['customer_context']
      output.sections[0].claims[0].truthReferences = ['customer_context']
      return output
    }, 'sections[].truthReferences', 'TRUTH_REFERENCE_COVERAGE'],
    ['duplicate decision truth reference', () => {
      const output = providerOutput()
      output.decisionLogic[0].truthReferences = ['customer_context', 'customer_context']
      return output
    }, 'decisionLogic[0].truthReferences', 'DUPLICATE_TRUTH_REFERENCE'],
    ['unsupported decision truth reference', () => {
      const output = providerOutput()
      output.decisionLogic[0].truthReferences = ['unsupported_context']
      return output
    }, 'decisionLogic[0].truthReferences', 'UNSUPPORTED_TRUTH_REFERENCE'],
    ['duplicate decision key', () => {
      const output = providerOutput()
      output.decisionLogic.push({ ...output.decisionLogic[0] })
      return output
    }, 'decisionLogic[].decisionKey', 'DUPLICATE_DECISION_KEY'],
    ['prohibited stage claim', () => providerOutput({ title: 'The Working Draft is approved.' }), 'output', 'PROHIBITED_STAGE_CLAIM'],
  ])('reports safe diagnostics for %s without leaking provider content', async (_name, buildOutput, validationField, validationRule) => {
    const output = buildOutput()
    const sentinel = 'provider-private-diagnostic-sentinel'
    if (_name === 'prohibited stage claim') output.sections[0].content = sentinel
    else output.title = sentinel
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    const error = await makeAdapter({ fetchImpl })({ providerContext: makeContext() }).catch((failure) => failure)

    expect(error).toMatchObject({
      code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED',
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField,
        validationRule,
      },
    })
    expect(JSON.stringify(error)).not.toContain(sentinel)
    expect(error.message).not.toContain(sentinel)
    expect(error.stack).not.toContain(sentinel)
  })

  test.each([
    ['no output text', [], 'response.output', 'OUTPUT_TEXT_CARDINALITY'],
    ['multiple output texts', [{ type: 'message', content: [
      { type: 'output_text', text: 'provider private marker one' },
      { type: 'output_text', text: 'provider private marker two' },
    ] }], 'response.output', 'OUTPUT_TEXT_CARDINALITY'],
    ['malformed JSON', [{ type: 'message', content: [
      { type: 'output_text', text: 'provider private marker {not-json' },
    ] }], 'response.output_text', 'OUTPUT_JSON_PARSE'],
  ])('reports safe diagnostics for %s without leaking raw response text', async (_name, output, validationField, validationRule) => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: responseBody(providerOutput(), { output }) }))
    const error = await makeAdapter({ fetchImpl })({ providerContext: makeContext() }).catch((failure) => failure)

    expect(error).toMatchObject({
      code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED',
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField,
        validationRule,
      },
    })
    expect(JSON.stringify(error)).not.toContain('provider private marker')
    expect(error.message).not.toContain('provider private marker')
    expect(error.stack).not.toContain('provider private marker')
  })

  test('reports the safe meaning-boundary field for a rejected structured output', async () => {
    const invalid = providerOutput({
      decisionLogic: [{
        ...providerOutput().decisionLogic[0],
        rationale: 'Interpretive placeholder: the governed labels are incomplete.',
      }],
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(invalid) })),
    })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField: 'decisionLogic[0].rationale',
        validationRule: 'RATIONALE_STRUCTURE',
      },
    })
  })

  test('reports the safe schema field for malformed structured output', async () => {
    const invalid = providerOutput({
      sections: [{
        ...providerOutput().sections[0],
        content: '',
      }],
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(invalid) })),
    })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField: 'sections[0].content',
      },
    })
  })

  test('reports the specific claim-boundary rule for qualified attribution drift', async () => {
    const invalid = providerOutput({
      sections: [{
        ...providerOutput().sections[0],
        claims: [{
          ...providerOutput().sections[0].claims[0],
          statement: 'This source-presented framing remains qualified.',
          meaningClass: 'QUALIFIED',
          proofDependencies: ['METRIC_DEFINITION'],
        }],
      }],
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: responseBody(invalid) })),
    })

    await expect(adapter({ providerContext: makeContext() })).rejects.toMatchObject({
      details: {
        reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID',
        validationField: 'sections[0].claims[0].statement',
        validationRule: 'QUALIFIED_ATTRIBUTION',
      },
    })
  })

  test('sanitizes request-id and token metadata without exposing provider content', async () => {
    const body = responseBody(providerOutput(), {
      usage: { input_tokens: -1, output_tokens: 'not-a-number', total_tokens: 12.5 },
    })
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body, requestId: 'unsafe request id with spaces' })),
    })
    await expect(adapter({ providerContext: makeContext() })).resolves.toMatchObject({
      metadata: {
        httpRequestId: '',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    })
  })

  test('rejects non-Run87 provider settings before transport', () => {
    const fetchImpl = jest.fn()
    expect(() => makeAdapter({ fetchImpl, model: 'gpt-5.1' })).toThrow(TypeError)
    expect(() => makeAdapter({ fetchImpl, maxOutputTokens: 7999 })).toThrow(TypeError)
    expect(() => makeAdapter({ fetchImpl, maxRetries: 1 })).toThrow(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})


describe('SS-040 contract-bound Working Draft provider mode', () => {
  const ready = () => projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(makeSs040Fixture({ name: 'CodeKarma' })))
  const exactOutput = (projection) => ({
    outputType: 'WORKING_DRAFT', schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION, draftVersion: 1, title: 'Working Draft',
    sections: projection.sectionLedger.filter((section) => section.status === 'SUPPORTED').map((section, index) => ({
      order: index + 1, sectionKey: section.targetSectionKey, title: section.heading,
      content: projection.claimProjections.filter((claim) => section.claimKeys.includes(claim.claimKey)).map((claim) => claim.statement).join(' '),
      claims: projection.claimProjections.filter((claim) => section.claimKeys.includes(claim.claimKey)),
      truthReferences: section.sourceSectionKeys, assumptions: [], gaps: makeContext().sourceCandidate.visibleGaps,
    })), decisionLogic: projection.decisionProjections, assumptions: [], visibleGaps: makeContext().sourceCandidate.visibleGaps,
  })
  test('SS-041 preserves exact shared placements across sections while rejecting within-section duplicates', async () => {
    const input = await makeSs041Fixture({ required: ['Executive Summary', 'Evidence Boundary'] })
    input.composition.businessFactLedger.facts[0].sectionKeys = ['executive-summary', 'evidence-boundary']
    await freezeSs041Snapshot(input)
    const projection = projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(input))
    const output = exactOutput(projection)
    output.sections.forEach((section) => { section.truthReferences = [...new Set(section.claims.flatMap((claim) => claim.truthReferences))] })
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    const result = await makeAdapter({ fetchImpl })({ providerContext: makeContext(), evidenceToMeaning: projection })
    expect(result.output.sections[0].claims[0].claimKey).toBe(result.output.sections[1].claims[0].claimKey)
    output.sections[0].claims.push(output.sections[0].claims[0])
    const invalidFetch = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    await expect(makeAdapter({ fetchImpl: invalidFetch })({ providerContext: makeContext(), evidenceToMeaning: projection })).rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED' })
  })
  test('sends exact bounded evidence separately from guidance without a customer-specific phrase requirement', async () => {
    const projection = ready(), output = exactOutput(projection)
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    const result = await makeAdapter({ fetchImpl })({ providerContext: makeContext(), evidenceToMeaning: projection })
    expect(result.output.sections[0].claims).toEqual(projection.claimProjections)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body), input = JSON.parse(body.input)
    expect(input.evidenceToMeaning.contractHash).toBe(projection.contractHash)
    expect(input.evidenceToMeaning.customerClaims[0].attribution.stored).toBe('CodeKarma')
    expect(input).not.toHaveProperty('sourceSnapshot')
    expect(input).toHaveProperty('frameworkGuidanceSource')
    expect(body.instructions).not.toContain('Parlon')
  })
  test('rejects stronger generated statements with the original contract still intact', async () => {
    const projection = ready(), output = exactOutput(projection)
    output.sections[0].claims = structuredClone(output.sections[0].claims)
    output.sections[0].claims[0].statement = 'This proves financial returns.'
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: responseBody(output) }))
    await expect(makeAdapter({ fetchImpl })({ providerContext: makeContext(), evidenceToMeaning: projection })).rejects.toMatchObject({
      code: 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED', details: { reason: 'WORKING_DRAFT_PROVIDER_OUTPUT_INVALID' },
    })
  })
  test('rejects a corrupt contract projection before fetch', async () => {
    const projection = ready(), fetchImpl = jest.fn()
    projection.contractHash = 'changed'
    await expect(makeAdapter({ fetchImpl })({ providerContext: makeContext(), evidenceToMeaning: projection })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

test.each(['framework', 'lineage', 'source metadata'])('SS-040 rejects private %s even in a rehashed projection before fetch', async (field) => {
  const projection = projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(makeSs040Fixture()))
  if (field === 'framework') projection.frameworkGuidance.content = { guidance: [{ instructions: 'person@example.test' }] }
  if (field === 'lineage') projection.customerClaims[0].lineageRef = 'api_key=synthetic-review-secret'
  if (field === 'source metadata') projection.customerClaims[0].attribution.storedSourceHash = 'api_key=synthetic-review-secret'
  const { projectionHash, ...payload } = projection
  projection.projectionHash = hashEvidenceToMeaningValue(payload)
  const fetchImpl = jest.fn(), providerContext = makeContext()

  await expect(makeAdapter({ fetchImpl })({ providerContext, evidenceToMeaning: projection })).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled()
})
