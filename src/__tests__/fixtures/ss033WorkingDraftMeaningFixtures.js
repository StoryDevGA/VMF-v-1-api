export const SS033_MEANING_EVIDENCE_FIXTURE = Object.freeze({
  acceptedTruthReferences: Object.freeze([
    'customer-context',
    'evidence-register',
    'current-state-assessment',
    'strategic-objectives',
    'stakeholder-register',
  ]),
  sourcePresentedClaims: Object.freeze([
    'claim-alert-noise-reduction',
    'claim-mttr-improvement',
    'claim-pre-failure-insight',
  ]),
  qualifiedClaims: Object.freeze([
    'claim-evidence-status-boundary',
  ]),
  frameworkGuidanceClaims: Object.freeze([
    'guidance-proof-dependencies',
  ]),
  unsupportedClaims: Object.freeze([
    'claim-incident-recurrence',
    'claim-gpu-signal-latency',
    'claim-roi-proxy',
    'claim-deduplication-rule',
  ]),
  proofDependencyVocabulary: Object.freeze([
    'METRIC_DEFINITION',
    'BASELINE',
    'METHOD',
    'SCOPE',
    'MEASUREMENT_WINDOW',
    'SOURCE_LINKAGE',
    'ATTRIBUTION',
  ]),
  orderedProofTruthReferences: Object.freeze([]),
})

const baseClaim = {
  claimKey: 'claim-alert-noise-reduction',
  statement: 'The supplied summary presents Parlon as claiming alert-noise reduction; independent verification is not established in the supplied summaries.',
  truthReferences: ['customer-context'],
  evidence: ['The supplied summary presents the claim; validation status is not stated in the supplied summaries.'],
  meaningClass: 'SOURCE_PRESENTED',
  proofDependencies: [],
  validationStatus: 'NOT_STATED',
  proofDisposition: 'NOT_ESTABLISHED',
  whatCanBeSaidNow: 'The supplied summary presents Parlon as claiming alert-noise reduction.',
  blockedStrongerClaim: 'An achieved alert-noise reduction is not established in the supplied summaries.',
  evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline, method and measurement window.'],
}

export const makeWorkingDraftMeaningFixture = (overrides = {}) => ({
  title: 'Bounded commercial interpretation',
  sections: [{
    order: 1,
    sectionKey: 'customer-context',
    title: 'Source-presented customer context',
    content: 'The supplied material contains source-presented capability and outcome claims. Their validation state remains qualified.',
    claims: [{
      ...baseClaim,
      truthReferences: [...baseClaim.truthReferences],
      evidence: [...baseClaim.evidence],
      proofDependencies: [...baseClaim.proofDependencies],
    }],
    truthReferences: ['customer-context'],
    assumptions: [],
    gaps: ['The supplied summaries do not establish the measurement basis for the quantified claims.'],
  }],
  decisionLogic: [{
    decisionKey: 'preserve-evidence-boundary',
    rationale: 'Interpretive placeholder: Source-presented framing: the supplied summary presents Parlon as expressing the claim. Recognition gap: recognition is not established in the supplied summaries. Understanding gap: measurement meaning is not established in the supplied summaries. Bounded interpretation now: the supplied summary presents Parlon as claiming alert-noise reduction. Qualified Reality: an achieved outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Ordering is not established in the supplied evidence.',
    priority: 'NOT_ESTABLISHED',
    priorityBasis: 'NOT_ESTABLISHED',
    closureState: 'INCOMPLETE',
    actionAuthorization: 'NONE',
    truthReferences: ['customer-context'],
  }],
  assumptions: [],
  visibleGaps: ['The supplied summaries do not establish the measurement basis for the quantified claims.'],
  ...overrides,
})

export const makePersistedArlFailureFixture = () => {
  const base = makeWorkingDraftMeaningFixture()
  return {
    ...base,
    sections: [{
      ...base.sections[0],
      title: 'Candidate KPI metric card',
      content: 'The supplied summary explicitly does not provide observed current-state facts. This candidate KPI is central to this requested paper.',
    }],
    decisionLogic: [{
      ...base.decisionLogic[0],
      rationale: 'Interpretive placeholder: the claim is visible, its validation basis is unresolved, and metric definition is the next step.',
      priority: 'PROVISIONAL_SEQUENCE_1',
      priorityBasis: 'HYPOTHESIS',
    }, {
      ...base.decisionLogic[0],
      decisionKey: 'preserve-second-evidence-boundary',
      rationale: 'Interpretive placeholder: another claim is visible, its validation basis is unresolved, and source linkage is the next step.',
      priority: 'PROVISIONAL_SEQUENCE_1',
      priorityBasis: 'HYPOTHESIS',
    }],
  }
}
