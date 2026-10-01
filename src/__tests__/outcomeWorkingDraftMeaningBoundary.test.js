import { describe, expect, test } from '@jest/globals'

import {
  SS033_MEANING_EVIDENCE_FIXTURE,
  makePersistedArlFailureFixture,
  makeWorkingDraftMeaningFixture,
} from './fixtures/ss033WorkingDraftMeaningFixtures.js'
import { assertOutcomeWorkingDraftMeaningBoundary } from '../services/outcomeWorkingDraftMeaningBoundaryService.js'

const frameworkProofSequence = 'Hypothetical next proof step: If pursued, this author-proposed proof step could follow the explicit Framework/process guidance as a hypothetical proof-work example. It is non-authorising, not Parlon evidence, and not a commercial priority.'
const customerEvidenceProofSequence = 'Hypothetical next proof step: If pursued, this author-proposed proof step could follow only the order expressly supported by accepted customer evidence for this claim.'
const withProofSequence = (rationale, proofSequence) => rationale.replace(
  'Ordering is not established in the supplied evidence.',
  proofSequence,
)

describe('SS-033 Working Draft meaning boundary', () => {
  test('accepts claim-scoped NOT_STATED status and evidence-bounded ordering without implying optionality or no action', () => {
    const output = makeWorkingDraftMeaningFixture()
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

    expect(assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toBe(output)
  })

  test('accepts a bounded no-order rationale without manufacturing a next-step sequence', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.decisionLogic[0].rationale = 'Interpretive placeholder: Source-presented framing: The supplied summary presents Parlon as positioning its platform for AI and hybrid environments; this records source positioning only, not a verified result. Recognition gap: Recognition by the intended audience is not established in the supplied summaries. Understanding gap: Whether the quantified claim has the intended measurement meaning is not established in the supplied summaries. Bounded interpretation now: Only the attributed source positioning is stated. Qualified Reality: An achieved or independently verified outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Ordering is not established in the supplied evidence.'

    expect(assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toBe(output)
  })

  test('rejects a NOT_ESTABLISHED rationale that still appends a hypothetical proof step', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.decisionLogic[0].rationale = `${output.decisionLogic[0].rationale} Hypothetical next proof step: If pursued, this author-proposed proof step could be considered.`

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts a framework-derived proof sequence when its source and non-authorising status are explicit', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].claims[0].proofDependencies = ['METRIC_DEFINITION', 'BASELINE']
    output.decisionLogic[0].priority = 'PROVISIONAL_SEQUENCE_1'
    output.decisionLogic[0].priorityBasis = 'FRAMEWORK_GUIDANCE'
    output.decisionLogic[0].rationale = 'Interpretive placeholder: Source-presented framing: The supplied summary presents Parlon as claiming an outcome; this is source attribution only. Recognition gap: Recognition by the intended audience is not established in the supplied summaries. Understanding gap: Whether the outcome measure has the intended meaning is not established in the supplied summaries. Bounded interpretation now: The claim can be described only as the supplied summary presents it, not as an achieved result. Qualified Reality: An achieved or independently verified outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Hypothetical next proof step: If pursued, this author-proposed proof step could follow the earlier Framework/process guidance analysis as a hypothetical proof-work sequence for this quantified claim: first clarify what the measure means, then consider the baseline and measurement approach. It is non-authorising, not Parlon evidence, and not a commercial priority.'

    expect(assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toBe(output)
  })

  test('rejects internal proof-dependency enum codes in customer-facing rationale prose', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.decisionLogic[0].rationale = output.decisionLogic[0].rationale.replace(
      'Understanding gap:',
      'Understanding gap: METRIC_DEFINITION / BASELINE / METHOD / SCOPE / MEASUREMENT_WINDOW / SOURCE_LINKAGE / ATTRIBUTION;',
    )

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ validationRule: 'INTERNAL_PROOF_SCHEMA_LANGUAGE' }),
    }))
  })

  test('rejects unqualified statements that Parlon lacks an objective or evidence item', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].content = 'Parlon has no defined objective, accountable owner, or measurement baseline.'

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ validationRule: 'UNBOUNDED_CUSTOMER_ABSENCE' }),
    }))
  })

  test('accepts an explicitly attributed SOURCE_PRESENTED claim with bounded validation status', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].claims[0].statement = 'The supplied summary presents Parlon as claiming this outcome; independent verification is not established in the supplied summaries.'
    output.sections[0].claims[0].meaningClass = 'SOURCE_PRESENTED'
    output.sections[0].claims[0].proofDependencies = []
    expect(assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE })).toBe(output)
  })

  test.each([
    ['attribution', 'Parlon claims this outcome; independent verification is not established in the supplied summaries.', 'QUALIFIED_EMPTY_DEPENDENCY_ATTRIBUTION'],
    ['bounded validation status', 'The supplied summary presents Parlon as claiming this outcome.', 'QUALIFIED_EMPTY_DEPENDENCY_VALIDATION_STATUS'],
  ])('rejects an empty dependency list without explicit %s', (_label, statement, validationRule) => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].claims[0].statement = statement
    output.sections[0].claims[0].meaningClass = 'QUALIFIED'
    output.sections[0].claims[0].proofDependencies = []
    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
      .toThrow(expect.objectContaining({
        code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
        details: expect.objectContaining({ validationRule }),
      }))
  })

  test('does not infer NOT_STATED when the claim uses an explicit validation verdict', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].claims[0].statement = 'The supplied summary presents Parlon as claiming this outcome; this claim is not validated.'
    output.sections[0].claims[0].meaningClass = 'QUALIFIED'
    output.sections[0].claims[0].proofDependencies = []
    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
      .toThrow(expect.objectContaining({
        details: expect.objectContaining({ field: 'sections[0].claims[0].validationStatus' }),
      }))
  })

  test.each([
    'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements',
    'ANY PROOF QUESTIONS NOT STATED IN ACCEPTED TRUTH ARE AUTHOR-ADDED PLACEHOLDERS,NOT ADOPTED PARLON REQUIREMENTS',
    'Any proof questions not stated in accepted truth are author-added placeholders,  not adopted Parlon requirements',
  ])('preserves the evidence-bound proof disclaimer: %s', (disclaimer) => {
    const output = makeWorkingDraftMeaningFixture()
    output.decisionLogic[0].rationale = output.decisionLogic[0].rationale.replace(
      'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements', disclaimer,
    )
    expect(assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE })).toBe(output)
  })

  test('accepts distinct SOURCE_PRESENTED and constrained-reality QUALIFIED claims', () => {
    const output = makeWorkingDraftMeaningFixture()
    output.sections[0].claims.push({
      ...output.sections[0].claims[0],
      claimKey: 'claim-evidence-status-boundary',
      statement: 'The accepted summaries characterize the alert-noise metric as company-asserted; an observed Parlon outcome is not established in the supplied summaries.',
      meaningClass: 'QUALIFIED',
      proofDependencies: ['METRIC_DEFINITION'],
    })
    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE })).not.toThrow()
  })

  test('rejects an unsupported metric claim instead of accepting a hypothesis as evidence', () => {
    const output = makeWorkingDraftMeaningFixture({
      sections: [{
        ...makeWorkingDraftMeaningFixture().sections[0],
        claims: [{
          ...makeWorkingDraftMeaningFixture().sections[0].claims[0],
          claimKey: 'claim-incident-recurrence',
          statement: 'Incident recurrence rate is the next Parlon KPI.',
          meaningClass: 'HYPOTHESIS',
          proofDependencies: ['METRIC_DEFINITION'],
        }],
      }],
    })

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects framework guidance presented as customer evidence', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          claimKey: 'guidance-proof-dependencies',
          statement: 'The customer has established the required proof dependencies.',
          meaningClass: 'QUALIFIED',
          proofDependencies: ['METRIC_DEFINITION'],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects decision logic that authorises action or closes the decision', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: 'Initiate a baseline workstream and treat it as a prerequisite for approval.',
        priority: 'HIGH',
        priorityBasis: 'EVIDENCE_BACKED',
        closureState: 'CLOSED',
        actionAuthorization: 'AUTHORIZE',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('adding framework guidance does not create a customer claim', () => {
    const base = makeWorkingDraftMeaningFixture()
    const withGuidance = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [...base.sections[0].claims, {
          claimKey: 'guidance-proof-dependencies',
          statement: 'Framework guidance lists proof dependencies for a future review.',
          validationStatus: 'NOT_STATED',
          proofDisposition: 'NOT_ESTABLISHED',
          whatCanBeSaidNow: 'Framework guidance describes a process, not a Parlon fact.',
          blockedStrongerClaim: 'No customer fact follows from guidance alone.',
          evidenceRequiredToSubstantiate: ['Accepted Parlon evidence would be needed to support any customer claim.'],
          truthReferences: ['customer-context'],
          evidence: ['The guidance is procedural and does not establish a customer fact.'],
          meaningClass: 'FRAMEWORK_GUIDANCE',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output: withGuidance,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).not.toThrow()
    expect(withGuidance.sections[0].claims
      .filter((claim) => claim.meaningClass !== 'FRAMEWORK_GUIDANCE')
      .map((claim) => claim.claimKey))
      .toEqual(['claim-alert-noise-reduction'])
  })

  test('rejects a provider-assigned framework-only section without substantive customer content', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [...base.sections, {
        order: 2,
        sectionKey: 'current-state-assessment',
        title: 'Framework guidance',
        content: 'Framework guidance describes proof fields; it is not customer evidence.',
        claims: [{
          claimKey: 'ai-generated-guidance-claim',
          statement: 'The supplied guidance lists proof dependencies for a future review.',
          validationStatus: 'NOT_STATED',
          proofDisposition: 'NOT_ESTABLISHED',
          whatCanBeSaidNow: 'Framework guidance describes a process, not a Parlon fact.',
          blockedStrongerClaim: 'No customer fact follows from guidance alone.',
          evidenceRequiredToSubstantiate: ['Accepted Parlon evidence would be needed to support any customer claim.'],
          truthReferences: ['current-state-assessment'],
          evidence: ['The guidance is procedural and does not establish a customer fact.'],
          meaningClass: 'FRAMEWORK_GUIDANCE',
          proofDependencies: [],
        }],
        truthReferences: ['current-state-assessment'],
        assumptions: [],
        gaps: [],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: { ...SS033_MEANING_EVIDENCE_FIXTURE, frameworkGuidanceClaims: [] },
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects a customer-facing section containing only Framework scaffolding', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        title: 'Framework proof scaffold',
        content: 'Framework guidance describes a possible proof structure.',
        claims: [{
          ...base.sections[0].claims[0],
          claimKey: 'guidance-proof-scaffold',
          statement: 'Framework guidance lists fields for a possible future review.',
          meaningClass: 'FRAMEWORK_GUIDANCE',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: { ...SS033_MEANING_EVIDENCE_FIXTURE, frameworkGuidanceClaims: [] },
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects absolute absence language when the accepted summary only fails to establish a fact', () => {
    const output = makePersistedArlFailureFixture()
    output.decisionLogic = [makeWorkingDraftMeaningFixture().decisionLogic[0]]

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects treating a summary omission as an affirmative negative finding', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        content: 'The supplied summary does not establish claim-to-source mapping.',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects decision rationales that omit the governed meaning labels', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: 'Interpretive placeholder: the claim is visible, its validation basis is unresolved, and metric definition is the next step.',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects duplicate provisional sequence priorities instead of claiming an ordered proof chain', () => {
    const output = makePersistedArlFailureFixture()
    output.sections = makeWorkingDraftMeaningFixture().sections
    output.decisionLogic = output.decisionLogic.map((decision) => ({
      ...decision,
      rationale: makeWorkingDraftMeaningFixture().decisionLogic[0].rationale,
    }))

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects a provisional proof sequence without claim-specific ordering support', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'HYPOTHESIS',
        rationale: withProofSequence(base.decisionLogic[0].rationale, customerEvidenceProofSequence),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts a provisional proof sequence only when every referenced truth item supports ordering', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'HYPOTHESIS',
        rationale: withProofSequence(base.decisionLogic[0].rationale, customerEvidenceProofSequence),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: {
        ...SS033_MEANING_EVIDENCE_FIXTURE,
        orderedProofTruthReferences: ['customer-context'],
      },
    })).not.toThrow()
  })

  test('accepts a Framework-guided proof sequence without treating it as customer evidence or commercial priority', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale, frameworkProofSequence),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: {
        ...SS033_MEANING_EVIDENCE_FIXTURE,
        frameworkGuidanceClaims: ['claim-evidence-coverage-metadata'],
      },
    })).not.toThrow()
  })

  test('rejects a Framework sequence without the explicit non-customer and non-priority boundary', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale,
          'Hypothetical next proof step: If pursued, this author-proposed proof step could follow Framework/process guidance as a hypothetical proof-work example.'),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({
      code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
      details: expect.objectContaining({ validationRule: 'FRAMEWORK_PROOF_SEQUENCE_BOUNDARY' }),
    }))
  })

  test('rejects a commercial priority label when the ordering basis is Framework guidance', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'HIGH',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects operational-practice wording that drops its source-presented attribution', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The platform actively validates critical paths using synthetic testing.',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects an active operational assertion kept SOURCE_PRESENTED without qualification', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents the platform as actively validating critical paths using synthetic testing.',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts attributed synthetic-testing positioning with bounded validation status', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents Parlon as claiming synthetic testing to validate critical paths; independent verification is not established in the supplied summaries.',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).not.toThrow()
  })

  test.each([
    'The messaging can be carried forward as a customer-facing differentiation narrative.',
    'The capability can be positioned as a proven customer outcome.',
  ])('rejects rationale that implies commercial permission: %s', (commercialConclusion) => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: base.decisionLogic[0].rationale.replace(
          'Bounded interpretation now: the supplied summary presents Parlon as claiming alert-noise reduction.',
          commercialConclusion,
        ),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects synthetic-testing validation wording when it remains SOURCE_PRESENTED', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents Parlon as asserting use of synthetic testing to validate critical paths.',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects evidence coverage metadata classified as SOURCE_PRESENTED customer evidence', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          claimKey: 'claim-evidence-coverage-metadata',
          statement: 'The supplied summary reports accepted evidence coverage metadata of 853 reviewed item(s) and 10 supporting source(s) across 2 source type(s).',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts evidence coverage metadata only as Framework/process metadata', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [base.sections[0].claims[0], {
          claimKey: 'claim-evidence-coverage-metadata',
          statement: 'Framework/process guidance records accepted evidence coverage metadata of 853 reviewed item(s) and 10 supporting source(s) across 2 source type(s); coverage is not proof of a customer outcome.',
          validationStatus: 'NOT_STATED',
          proofDisposition: 'NOT_ESTABLISHED',
          whatCanBeSaidNow: 'Framework/process guidance records coverage metadata only.',
          blockedStrongerClaim: 'Coverage metadata does not establish a customer outcome.',
          evidenceRequiredToSubstantiate: ['Accepted Parlon evidence would be needed to support any customer outcome claim.'],
          truthReferences: ['customer-context'],
          evidence: ['The supplied evidence-register summary reports coverage metadata.'],
          meaningClass: 'FRAMEWORK_GUIDANCE',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: {
        ...SS033_MEANING_EVIDENCE_FIXTURE,
        frameworkGuidanceClaims: ['claim-evidence-coverage-metadata'],
      },
    })).not.toThrow()
  })

  test('rejects an environmental support assertion without a same-boundary qualification', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        content: 'The supplied summary presents Parlon as asserting support for fully air-gapped and HIPAA-compliant settings.',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts an environmental support assertion when its local prose remains qualified', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        content: 'The supplied summary presents Parlon as asserting support for fully air-gapped and HIPAA-compliant settings; independent verification is not established in the supplied summaries.',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).not.toThrow()
  })

  test('rejects a directive hypothetical proof step even when action authorisation is NONE', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale,
          'Hypothetical next proof step: Build a metric definition as a selected action.'),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects a hypothetical proof step that implies enablement of external use', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale,
          'Hypothetical next proof step: If pursued, this author-proposed proof step could be checked; this does not authorise use of the claim.'),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('accepts qualified proof dependencies as structured unresolved metadata without requiring magic wording', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied material presents an alert-noise reduction claim pending metric definition and baseline.',
          meaningClass: 'QUALIFIED',
          proofDependencies: ['METRIC_DEFINITION', 'BASELINE'],
        }],
      }],
    }
    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).not.toThrow()
  })

  test('rejects proof dependencies presented as adopted customer governance', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'Parlon governance requires metric definition and baseline as adopted approval gates.',
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects a source-only assertion misclassified as QUALIFIED', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents Parlon as claiming synthetic testing to validate critical paths; independent verification is not established in the supplied summaries.',
          meaningClass: 'QUALIFIED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({
      code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
      details: expect.objectContaining({ validationRule: 'SOURCE_ONLY_CLAIM_CLASSIFICATION' }),
    }))
  })

  test.each([
    'independent verification is not established in the supplied summaries.',
    'validation status is not stated in the supplied summaries.',
  ])('rejects source attribution and status wording alone as QUALIFIED: %s', (boundary) => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: `The supplied summary presents Parlon as claiming synthetic testing to validate critical paths; ${boundary}`,
          meaningClass: 'QUALIFIED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
      .toThrow(expect.objectContaining({
        code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
        details: expect.objectContaining({ validationRule: 'SOURCE_ONLY_CLAIM_CLASSIFICATION' }),
      }))
  })

  test.each(['presents', 'describes', 'states', 'frames', 'characterises'])('rejects source-only QUALIFIED claims regardless of the source attribution verb: %s', (attributionVerb) => {
      const base = makeWorkingDraftMeaningFixture()
      const output = {
        ...base,
        sections: [{
          ...base.sections[0],
          claims: [{
            ...base.sections[0].claims[0],
            statement: `The supplied summary ${attributionVerb} Parlon as claiming synthetic testing to validate critical paths; independent verification is not established in the supplied summaries.`,
            meaningClass: 'QUALIFIED',
            proofDependencies: [],
          }],
        }],
      }

      expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
        .toThrow(expect.objectContaining({
          code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
          details: expect.objectContaining({ validationRule: 'SOURCE_ONLY_CLAIM_CLASSIFICATION' }),
        }))
    })

  test('does not let unrelated trailing text turn source-only attribution into QUALIFIED reality', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents Parlon as claiming synthetic testing to validate critical paths; independent verification is not established in the supplied summaries. Further details are not recorded.',
          meaningClass: 'QUALIFIED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
      .toThrow(expect.objectContaining({
        code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
        details: expect.objectContaining({ validationRule: 'SOURCE_ONLY_CLAIM_CLASSIFICATION' }),
      }))
  })

  test('accepts QUALIFIED when a bounded reality statement extends beyond source attribution', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          statement: 'The supplied summary presents Parlon as claiming synthetic testing to validate critical paths; independent verification is not established in the supplied summaries, and operational use is not established in the supplied summaries.',
          meaningClass: 'QUALIFIED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).not.toThrow()
  })

  test('rejects the universal seven-item proof-dependency bundle as an invented default', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          meaningClass: 'QUALIFIED',
          proofDependencies: [...SS033_MEANING_EVIDENCE_FIXTURE.proofDependencyVocabulary],
        }],
      }],
    }
    output.decisionLogic[0].rationale = output.decisionLogic[0].rationale.replace(
      'Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements',
      'Unresolved proof dependencies: METRIC_DEFINITION, BASELINE, METHOD, SCOPE, MEASUREMENT_WINDOW, SOURCE_LINKAGE, ATTRIBUTION remain author-added placeholders, not adopted Parlon requirements',
    )

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({ output, evidence: SS033_MEANING_EVIDENCE_FIXTURE }))
      .toThrow(expect.objectContaining({
        code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID',
        details: expect.objectContaining({ validationRule: 'DEFAULT_PROOF_DEPENDENCY_BUNDLE' }),
      }))
  })

  test('rejects directive proof-work wording in a hypothetical placeholder', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale,
          'Hypothetical next proof step: If pursued, this author-proposed proof step could attach the metric definition and then reassess whether the claim can be stated without qualification.'),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects a qualified reality clause that relabels the same claim as source-presented', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: base.decisionLogic[0].rationale.replace(
          'Qualified Reality: an achieved outcome is not established in the supplied summaries.',
          'Qualified Reality: the outcome is source-presented in the supplied summaries.',
        ),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('keeps structured proof dependencies without exposing internal codes in rationale prose', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
        ...base.sections[0].claims[0],
        statement: 'The supplied summary presents Parlon as claiming alert-noise reduction; its metric definition and baseline are not established in the supplied summaries.',
        meaningClass: 'QUALIFIED',
          proofDependencies: ['METRIC_DEFINITION'],
        }],
      }],
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'FRAMEWORK_GUIDANCE',
        rationale: withProofSequence(base.decisionLogic[0].rationale, frameworkProofSequence),
      }],
    }

    expect(assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toBe(output)
  })

  test('rejects a provisional sequence labelled as NOT_ESTABLISHED', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        priority: 'PROVISIONAL_SEQUENCE_1',
        priorityBasis: 'NOT_ESTABLISHED',
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('rejects an ambiguous Expressed Reality label in decision rationale', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: base.decisionLogic[0].rationale.replace(
          'Interpretive placeholder: Source-presented framing:',
          'Interpretive placeholder: Expressed Reality:',
        ),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('requires SOURCE_PRESENTED customer claims to attribute the expression to Parlon', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      sections: [{
        ...base.sections[0],
        claims: [{
          ...base.sections[0].claims[0],
          claimKey: 'claim-source-presented-value-themes',
          statement: 'The supplied summaries present value themes of reducing alert noise and enabling cross-layer correlation.',
          meaningClass: 'SOURCE_PRESENTED',
          proofDependencies: [],
        }],
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })

  test('requires decision rationale to distinguish author-added proof placeholders from adopted requirements', () => {
    const base = makeWorkingDraftMeaningFixture()
    const output = {
      ...base,
      decisionLogic: [{
        ...base.decisionLogic[0],
        rationale: base.decisionLogic[0].rationale.replace(
          'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements',
          'remain unresolved',
        ),
      }],
    }

    expect(() => assertOutcomeWorkingDraftMeaningBoundary({
      output,
      evidence: SS033_MEANING_EVIDENCE_FIXTURE,
    })).toThrow(expect.objectContaining({ code: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID' }))
  })
})
