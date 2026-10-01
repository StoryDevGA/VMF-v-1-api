import {
  OUTCOME_WORKING_DRAFT_PROOF_DISPOSITIONS,
  OUTCOME_WORKING_DRAFT_VALIDATION_STATUSES,
} from '../constants/outcomeGovernedQuality.js'

const MEANING_CLASSES = new Set([
  'SOURCE_PRESENTED',
  'QUALIFIED',
  'FRAMEWORK_GUIDANCE',
  'BOUNDED_INTERPRETATION',
])

const PROOF_DEPENDENCIES = new Set([
  'METRIC_DEFINITION',
  'BASELINE',
  'METHOD',
  'SCOPE',
  'MEASUREMENT_WINDOW',
  'SOURCE_LINKAGE',
  'ATTRIBUTION',
])

const PRIORITY_BASES = new Set([
  'NOT_ESTABLISHED',
  'HYPOTHESIS',
  'FRAMEWORK_GUIDANCE',
])

const text = (value) => typeof value === 'string' ? value.trim() : ''
const ABSOLUTE_SUMMARY_ABSENCE = /\b(?:(?:explicitly\s+)?does\s+not\s+(?:provide|enumerate)|(?:supplied\s+summar(?:y|ies)|it)\s+(?:itself\s+)?does\s+not\s+establish)\b/i
const UNBOUNDED_CUSTOMER_ABSENCE = /\bParlon\s+(?:has\s+no|lacks?|does\s+not\s+have|has\s+not)\b/i
const INTERNAL_PROOF_SCHEMA_LANGUAGE = /\b(?:METRIC_DEFINITION|BASELINE|METHOD|SCOPE|MEASUREMENT_WINDOW|SOURCE_LINKAGE|ATTRIBUTION)\b/
const OPERATIONAL_PRACTICE_WORDING = /\b(?:actively\s+)?(?:validat(?:e|es|ed|ing)|operat(?:e|es|ed|ing)|us(?:e|es|ed|ing)|deploy(?:s|ed|ing)?|monitor(?:s|ed|ing)?|support(?:s|ed|ing)?\s+operations?)\b/i
const ACTIVE_OPERATIONAL_SOURCE_ASSERTION = /\bactively\s+(?:validat(?:e|es|ed|ing)|operat(?:e|es|ed|ing)|us(?:e|es|ed|ing)|deploy(?:s|ed|ing)?|monitor(?:s|ed|ing)?)\b/i
const SYNTHETIC_TESTING_VALIDATION_ASSERTION = /\bsynthetic\s+testing\b[\s\S]{0,160}\bvalidat(?:e|es|ed|ing)\b/i
const SOURCE_ATTRIBUTION = /\b(?:supplied|accepted)\s+(?:summary|summaries|material|source)\s+(?:presents?|describes?|states?|frames?|characterises?|characterizes?|includes?|records?)\b/i
const SOURCE_PRESENTED_PARLON_ATTRIBUTION = /\b(?:supplied|accepted)\s+(?:summary|summaries|material|source)\s+(?:presents?|describes?|states?|frames?|characterises?|characterizes?)\s+Parlon\b/i
const ADOPTED_PROOF_GOVERNANCE = /\b(?:Parlon\s+(?:governance\s+)?(?:requires?|has\s+adopted|adopts?)|adopted\s+approval\s+gates?|established\s+approval\s+gates?)\b/i
const FRAMEWORK_COVERAGE_METADATA = /\b(?:evidence\s+coverage\s+metadata|\d+\s+reviewed\s+item\(s\)|\d+\s+supporting\s+source\(s\)\s+across\s+\d+\s+source\s+type\(s\))\b/i
const ENVIRONMENTAL_SUPPORT_ASSERTION = /\b(?:air[- ]gapped|HIPAA[- ]compliant)\b/i
const QUALIFICATION_BOUNDARY = /\b(?:source-presented|not\s+stated\s+in\s+(?:the\s+)?supplied\s+summaries|not\s+established\s+in\s+(?:the\s+)?supplied\s+summaries|remains\s+qualified)\b/i
const BOUNDED_VALIDATION_STATUS = /\b(?:independent\s+verification|validation\s+status|independent\s+validation)\s+is\s+not\s+established\s+in\s+(?:the\s+)?supplied\s+summaries\b|\bnot\s+stated\s+in\s+(?:the\s+)?supplied\s+summaries\b/i
const SOURCE_VALIDATION_VERDICT = /\b(?:unvalidated|not\s+(?:independently\s+)?validated|requires?\s+further\s+validation)\b/i
const QUALIFIED_REALITY_BOUNDARY = /\b(?:achieved|observed|actual|operational|real[- ]world|customer|current|existing|measured)\b[\w\s,'-]{0,100}\bnot established in (?:the )?supplied summaries\b/i
const ENABLEMENT_LANGUAGE = /\b(?:so\s+(?:they|it|this|these|those|the(?:se)?\s+claims?)\s+may\s+be\s+used|(?:enable|permit|allow)(?:s|ed|ing)?\s+(?:external|commercial|customer|public)\s+(?:use|usage|publication|publishing)|(?:publish|operationali[sz]e|commerciali[sz]e)(?:s|d|ing)?)\b/i
const COMMERCIAL_PERMISSION_LANGUAGE = /\b(?:messaging\s+(?:can|could|may)\s+be\s+carried\s+forward|(?:can|could|may)\s+be\s+positioned)\b/i
const SOURCE_PRESENTED_PROSE = /\bsource[- _]presented\b/i
const DIRECTIVE_PROOF_WORK = /\bHypothetical next proof step:\s*(?:Build|Convert|Define|Create|Use|Map|Assign)\b|\band\s+then\s+reassess\b/i
export const OUTCOME_WORKING_DRAFT_PROOF_STEP_PREFIX = 'Hypothetical next proof step: If pursued, this author-proposed proof step could'
export const OUTCOME_WORKING_DRAFT_PROOF_DISCLAIMER = 'Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements'
const CONDITIONAL_PROOF_STEP = new RegExp(`${OUTCOME_WORKING_DRAFT_PROOF_STEP_PREFIX.replace(': ', ':\\s*')}\\b`)
const NO_ORDER_STATEMENT = /ordering\s+is\s+not\s+established\s+in\s+(?:the\s+)?supplied\s+evidence\b/i
const PROOF_PLACEHOLDER_BOUNDARY = /any\s+proof\s+questions\s+not\s+stated\s+in\s+accepted\s+truth\s+are\s+author-added\s+placeholders,\s*not\s+adopted\s+Parlon\s+requirements/i
export const OUTCOME_WORKING_DRAFT_RATIONALE_LABELS = Object.freeze([
  'Interpretive placeholder: Source-presented framing:',
  'Recognition gap:',
  'Understanding gap:',
  'Bounded interpretation now:',
  'Qualified Reality:',
  'Hypothetical next proof step:',
])
const REQUIRED_RATIONALE_LABELS = OUTCOME_WORKING_DRAFT_RATIONALE_LABELS.slice(0, 5)
const fail = (field, reason, validationRule) => {
  const error = new Error('Working Draft meaning boundary is invalid.')
  error.status = 422
  error.code = 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID'
  error.details = {
    reason: 'OUTCOME_WORKING_DRAFT_MEANING_BOUNDARY_INVALID', field, message: reason,
    ...(validationRule ? { validationRule } : {}),
  }
  throw error
}

const exactStringArray = (value, field) => {
  if (!Array.isArray(value) || value.some((item) => !text(item))) fail(field, 'Expected a non-empty string array.')
  return value
}

const assertNoAbsoluteSummaryAbsence = (value, field) => {
  if (ABSOLUTE_SUMMARY_ABSENCE.test(text(value))) {
    fail(field, 'Summary omission must be expressed as not established, not as an absolute absence.')
  }
}

const assertNoUnboundedCustomerAbsence = (value, field) => {
  if (UNBOUNDED_CUSTOMER_ABSENCE.test(text(value))) {
    fail(field, 'Do not turn a summary gap into an absolute claim about Parlon; state only what is not established in the supplied summaries.', 'UNBOUNDED_CUSTOMER_ABSENCE')
  }
}

const assertNoInternalProofSchemaLanguage = (value, field) => {
  if (INTERNAL_PROOF_SCHEMA_LANGUAGE.test(text(value))) {
    fail(field, 'Internal proof-dependency codes belong in structured metadata, not customer-facing prose.', 'INTERNAL_PROOF_SCHEMA_LANGUAGE')
  }
}

const assertRationaleStructure = (rationale, field, priorityBasis) => {
  let previousIndex = -1
  for (const label of REQUIRED_RATIONALE_LABELS) {
    const index = rationale.indexOf(label)
    if (index <= previousIndex) fail(field, 'Decision rationale must preserve the governed meaning-label order.')
    previousIndex = index
  }
  const proofStepIndex = rationale.indexOf(OUTCOME_WORKING_DRAFT_RATIONALE_LABELS[5])
  if (priorityBasis === 'NOT_ESTABLISHED') {
    if (proofStepIndex >= 0 || CONDITIONAL_PROOF_STEP.test(rationale)) {
      fail(field, 'When proof order is not established, do not manufacture or imply a next-step sequence.')
    }
    if (!NO_ORDER_STATEMENT.test(rationale)) {
      fail(field, 'When proof order is not established, state that ordering is not established in the supplied evidence.')
    }
  } else if (proofStepIndex <= previousIndex || !CONDITIONAL_PROOF_STEP.test(rationale)) {
    fail(field, 'An ordered proof option must remain conditional, author-proposed and non-directive.')
  }
  if (!PROOF_PLACEHOLDER_BOUNDARY.test(rationale)) {
    fail(field, 'Distinguish author-added proof questions from adopted Parlon requirements.', 'PROOF_PLACEHOLDER_BOUNDARY')
  }
  if (DIRECTIVE_PROOF_WORK.test(rationale)) {
    fail(field, 'Hypothetical proof steps must remain non-directive dependency placeholders, not selected workplan actions.')
  }
  if (ENABLEMENT_LANGUAGE.test(rationale)) {
    fail(field, 'Hypothetical proof steps must not imply external use, publication, commercialization or authorization.')
  }
  if (COMMERCIAL_PERMISSION_LANGUAGE.test(rationale)) {
    fail(field, 'A source-attributed claim must not be framed as commercially positioned or ready for customer use.')
  }
  if (priorityBasis === 'FRAMEWORK_GUIDANCE') {
    const proofStep = rationale.slice(proofStepIndex)
    const requiredFrameworkBoundaries = [
      /framework\s*\/\s*process\s+guidance/i,
      /hypothetical/i,
      /non[- ]authori[sz]ing/i,
      /not Parlon evidence/i,
      /not a commercial priority/i,
    ]
    if (requiredFrameworkBoundaries.some((pattern) => !pattern.test(proofStep))) {
      fail(field, 'A Framework-derived proof sequence must be explicitly hypothetical, non-authorising, not Parlon evidence, and not a commercial priority.', 'FRAMEWORK_PROOF_SEQUENCE_BOUNDARY')
    }
  }
  assertNoInternalProofSchemaLanguage(rationale, field)
  const qualifiedReality = /Qualified Reality:\s*(.*?)(?=\s+Hypothetical next proof step:|$)/is.exec(rationale)?.[1] || ''
  if (SOURCE_PRESENTED_PROSE.test(qualifiedReality)) {
    fail(field, 'Qualified Reality prose must not relabel a qualified claim as source-presented.')
  }
}

const assertEnvironmentalSupportBoundary = (value, field) => {
  const sentences = text(value).split(/(?<=[.!?])\s+/)
  sentences.forEach((sentence) => {
    if (!ENVIRONMENTAL_SUPPORT_ASSERTION.test(sentence)) return
    if (!SOURCE_ATTRIBUTION.test(sentence) || !QUALIFICATION_BOUNDARY.test(sentence)) {
      fail(field, 'Environmental support and compliance assertions must retain attribution and a local qualification boundary.')
    }
  })
}

const assertClaim = ({ claim, section, evidence, field }) => {
  if (!claim || typeof claim !== 'object') fail(field, 'Claim must be an object.')
  if (!OUTCOME_WORKING_DRAFT_VALIDATION_STATUSES.includes(claim.validationStatus)) {
    fail(`${field}.validationStatus`, 'Claim validation status must be source-bounded.')
  }
  if (!OUTCOME_WORKING_DRAFT_PROOF_DISPOSITIONS.includes(claim.proofDisposition)) {
    fail(`${field}.proofDisposition`, 'Proof disposition must distinguish unstated, source-specified, and author-proposed meaning.')
  }
  if (!text(claim.whatCanBeSaidNow) || !text(claim.blockedStrongerClaim)
    || !Array.isArray(claim.evidenceRequiredToSubstantiate)
    || claim.evidenceRequiredToSubstantiate.length < 1
    || claim.evidenceRequiredToSubstantiate.length > 10
    || claim.evidenceRequiredToSubstantiate.some((item) => !text(item) || item.length > 2000)) {
    fail(field, 'Claim-specific meaning and substantiation boundaries are required.')
  }
  if (claim.validationStatus === 'NOT_STATED' && SOURCE_VALIDATION_VERDICT.test(text(claim.statement))) {
    fail(`${field}.validationStatus`, 'NOT_STATED cannot be paired with an inferred validation verdict.')
  }
  assertNoAbsoluteSummaryAbsence(claim.statement, `${field}.statement`)
  assertNoUnboundedCustomerAbsence(claim.statement, `${field}.statement`)
  assertNoInternalProofSchemaLanguage(claim.statement, `${field}.statement`)
  assertEnvironmentalSupportBoundary(claim.statement, `${field}.statement`)
  ;(claim.evidence || []).forEach((value, index) => {
    assertNoAbsoluteSummaryAbsence(value, `${field}.evidence[${index}]`)
    assertNoUnboundedCustomerAbsence(value, `${field}.evidence[${index}]`)
    assertNoInternalProofSchemaLanguage(value, `${field}.evidence[${index}]`)
  })
  if (!MEANING_CLASSES.has(claim.meaningClass)) fail(`${field}.meaningClass`, 'Claim classification is not allowed.')
  if (FRAMEWORK_COVERAGE_METADATA.test(text(claim.statement))
    && claim.meaningClass !== 'FRAMEWORK_GUIDANCE') {
    fail(`${field}.meaningClass`, 'Evidence coverage counts and source-type metadata are Framework/process metadata, not customer evidence.')
  }
  exactStringArray(claim.proofDependencies, `${field}.proofDependencies`)
  const proofDependencyVocabulary = new Set(evidence.proofDependencyVocabulary || [])
  if (claim.proofDependencies.some((dependency) => !PROOF_DEPENDENCIES.has(dependency)
    || !proofDependencyVocabulary.has(dependency))) {
    fail(`${field}.proofDependencies`, 'Claim contains an unsupported proof dependency.')
  }
  if (claim.proofDependencies.length === PROOF_DEPENDENCIES.size
    && new Set(claim.proofDependencies).size === PROOF_DEPENDENCIES.size
    && claim.proofDependencies.every((dependency) => PROOF_DEPENDENCIES.has(dependency))) {
    fail(`${field}.proofDependencies`, 'A universal proof-dependency checklist is not a claim-specific qualification.', 'DEFAULT_PROOF_DEPENDENCY_BUNDLE')
  }
  const claimTruth = exactStringArray(claim.truthReferences, `${field}.truthReferences`)
  const sectionTruth = new Set(section.truthReferences || [])
  if (claimTruth.some((reference) => !sectionTruth.has(reference))) {
    fail(`${field}.truthReferences`, 'Claim truth references must be covered by the section.')
  }
  if (evidence.unsupportedClaims?.includes(claim.claimKey)) {
    fail(`${field}.claimKey`, 'Unsupported customer claims cannot be emitted as hypotheses.')
  }
  const frameworkGuidanceClaims = Array.isArray(evidence.frameworkGuidanceClaims)
    ? evidence.frameworkGuidanceClaims
    : []
  const hasAuthoritativeGuidanceClaimRegistry = frameworkGuidanceClaims.length > 0
  if (claim.meaningClass === 'FRAMEWORK_GUIDANCE') {
    if (hasAuthoritativeGuidanceClaimRegistry && !frameworkGuidanceClaims.includes(claim.claimKey)) {
      fail(`${field}.claimKey`, 'Framework guidance claim is not declared as guidance.')
    }
    if (claim.proofDependencies.length > 0) {
      fail(`${field}.proofDependencies`, 'Framework guidance must not become a customer proof claim.')
    }
  } else if (hasAuthoritativeGuidanceClaimRegistry && frameworkGuidanceClaims.includes(claim.claimKey)) {
    fail(`${field}.meaningClass`, 'Framework guidance cannot be relabelled as customer evidence.')
  }
  if (claim.meaningClass === 'QUALIFIED'
    && SOURCE_PRESENTED_PARLON_ATTRIBUTION.test(text(claim.statement))
    && BOUNDED_VALIDATION_STATUS.test(text(claim.statement))
    && !QUALIFIED_REALITY_BOUNDARY.test(text(claim.statement))) {
    fail(`${field}.meaningClass`, 'An attributed source assertion followed only by a bounded validation status remains SOURCE_PRESENTED, not QUALIFIED.', 'SOURCE_ONLY_CLAIM_CLASSIFICATION')
  }
  if (claim.meaningClass === 'QUALIFIED' && claim.proofDependencies.length === 0) {
    if (!SOURCE_PRESENTED_PARLON_ATTRIBUTION.test(text(claim.statement))) {
      fail(`${field}.statement`, 'A QUALIFIED claim without a named proof dependency must retain explicit Parlon attribution to a supplied or accepted summary.', 'QUALIFIED_EMPTY_DEPENDENCY_ATTRIBUTION')
    }
    if (!BOUNDED_VALIDATION_STATUS.test(text(claim.statement))) {
      fail(`${field}.statement`, 'A QUALIFIED claim without a named proof dependency must state only the bounded validation status supported by the summaries.', 'QUALIFIED_EMPTY_DEPENDENCY_VALIDATION_STATUS')
    }
  }
  if (claim.meaningClass === 'QUALIFIED'
    && ADOPTED_PROOF_GOVERNANCE.test(text(claim.statement))) {
    fail(`${field}.statement`, 'Qualified proof dependencies cannot be presented as adopted customer governance.')
  }
  if (claim.meaningClass === 'QUALIFIED'
    && SOURCE_PRESENTED_PROSE.test(text(claim.statement))) {
    fail(`${field}.statement`, 'Qualified claims must not label their prose SOURCE_PRESENTED; retain attribution and qualification instead.')
  }
  if (claim.meaningClass === 'SOURCE_PRESENTED'
    && (ACTIVE_OPERATIONAL_SOURCE_ASSERTION.test(text(claim.statement))
      || SYNTHETIC_TESTING_VALIDATION_ASSERTION.test(text(claim.statement)))
    && !BOUNDED_VALIDATION_STATUS.test(text(claim.statement))) {
    fail(`${field}.meaningClass`, 'Source-attributed operational or synthetic-testing wording must preserve a bounded validation status; attribution alone is not observed practice.')
  }
  if (claim.meaningClass === 'SOURCE_PRESENTED'
    && !SOURCE_PRESENTED_PARLON_ATTRIBUTION.test(text(claim.statement))) {
    fail(`${field}.statement`, 'SOURCE_PRESENTED customer claims must explicitly attribute the expression to Parlon.')
  }
  if (['SOURCE_PRESENTED', 'QUALIFIED'].includes(claim.meaningClass)
    && OPERATIONAL_PRACTICE_WORDING.test(text(claim.statement))
    && !SOURCE_ATTRIBUTION.test(text(claim.statement))) {
    fail(`${field}.statement`, 'Operational wording must retain explicit source attribution.')
  }
}

export const assertOutcomeWorkingDraftMeaningBoundary = ({ output, evidence } = {}) => {
  if (!output || typeof output !== 'object' || !evidence || typeof evidence !== 'object') {
    fail('root', 'Output and evidence are required.')
  }
  exactStringArray(evidence.acceptedTruthReferences, 'evidence.acceptedTruthReferences')
  exactStringArray(evidence.proofDependencyVocabulary, 'evidence.proofDependencyVocabulary')
  const acceptedTruth = new Set(evidence.acceptedTruthReferences)
  ;(output.assumptions || [])
    .forEach((value, index) => {
      assertNoAbsoluteSummaryAbsence(value, `assumptions[${index}]`)
      assertNoUnboundedCustomerAbsence(value, `assumptions[${index}]`)
      assertNoInternalProofSchemaLanguage(value, `assumptions[${index}]`)
    })
  const sections = Array.isArray(output.sections) ? output.sections : []
  if (sections.length === 0) fail('sections', 'At least one section is required.')
  sections.forEach((section, sectionIndex) => {
    const field = `sections[${sectionIndex}]`
    const sectionTruth = exactStringArray(section.truthReferences, `${field}.truthReferences`)
    if (sectionTruth.some((reference) => !acceptedTruth.has(reference))) {
      fail(`${field}.truthReferences`, 'Section references must be accepted truth references.')
    }
    if (!Array.isArray(section.claims) || section.claims.length === 0) fail(`${field}.claims`, 'At least one claim is required.')
    assertNoAbsoluteSummaryAbsence(section.title, `${field}.title`)
    assertNoAbsoluteSummaryAbsence(section.content, `${field}.content`)
    assertNoUnboundedCustomerAbsence(section.title, `${field}.title`)
    assertNoUnboundedCustomerAbsence(section.content, `${field}.content`)
    assertNoInternalProofSchemaLanguage(section.title, `${field}.title`)
    assertNoInternalProofSchemaLanguage(section.content, `${field}.content`)
    assertEnvironmentalSupportBoundary(section.content, `${field}.content`)
    ;[...(section.assumptions || []), ...(section.gaps || [])]
      .forEach((value, index) => {
        assertNoAbsoluteSummaryAbsence(value, `${field}.supportingText[${index}]`)
        assertNoUnboundedCustomerAbsence(value, `${field}.supportingText[${index}]`)
        assertNoInternalProofSchemaLanguage(value, `${field}.supportingText[${index}]`)
      })
    section.claims.forEach((claim, claimIndex) => assertClaim({
      claim,
      section,
      evidence,
      field: `${field}.claims[${claimIndex}]`,
    }))
    if (section.claims.every((claim) => claim.meaningClass === 'FRAMEWORK_GUIDANCE')) {
      fail(`${field}.claims`, 'Customer-facing sections require substantive customer content in addition to Framework guidance.')
    }
  })
  const decisions = Array.isArray(output.decisionLogic) ? output.decisionLogic : []
  if (decisions.length === 0) fail('decisionLogic', 'At least one decision boundary is required.')
  decisions.forEach((decision, index) => {
    const field = `decisionLogic[${index}]`
    if (decision.closureState !== 'INCOMPLETE'
      || decision.actionAuthorization !== 'NONE'
      || !PRIORITY_BASES.has(decision.priorityBasis)) {
      fail(field, 'Decision logic must remain incomplete, non-authorising and unranked or hypothetical.')
    }
    const truthReferences = exactStringArray(decision.truthReferences, `${field}.truthReferences`)
    if (truthReferences.some((reference) => !acceptedTruth.has(reference))) {
      fail(`${field}.truthReferences`, 'Decision references must be accepted truth references.')
    }
    assertRationaleStructure(text(decision.rationale), `${field}.rationale`, decision.priorityBasis)
    assertNoUnboundedCustomerAbsence(decision.rationale, `${field}.rationale`)
    if (decision.priorityBasis === 'HYPOTHESIS') {
      const orderedProofTruthReferences = new Set(evidence.orderedProofTruthReferences || [])
      if (truthReferences.some((reference) => !orderedProofTruthReferences.has(reference))) {
        fail(`${field}.priorityBasis`, 'Provisional proof ordering requires claim-specific support from every referenced truth item.')
      }
    }
    if (decision.priorityBasis === 'FRAMEWORK_GUIDANCE'
      && !/^PROVISIONAL_SEQUENCE_\d+$/.test(text(decision.priority))) {
      fail(`${field}.priority`, 'Framework-guided proof work must use a provisional sequence, not a commercial priority.')
    }
    if (decision.priorityBasis === 'NOT_ESTABLISHED'
      && text(decision.priority) !== 'NOT_ESTABLISHED') {
      fail(`${field}.priorityBasis`, 'An unestablished ordering basis must use NOT_ESTABLISHED, not a provisional sequence.')
    }
  })
  const provisionalSequences = decisions
    .filter((decision) => ['HYPOTHESIS', 'FRAMEWORK_GUIDANCE'].includes(decision.priorityBasis))
    .map((decision) => /^PROVISIONAL_SEQUENCE_(\d+)$/.exec(text(decision.priority))?.[1])
  if (provisionalSequences.some((value, index) => Number(value) !== index + 1)) {
    fail('decisionLogic.priority', 'Hypothetical proof dependencies must use distinct consecutive provisional sequence priorities.')
  }
  return output
}

export const OUTCOME_WORKING_DRAFT_MEANING_CLASSES = Object.freeze([...MEANING_CLASSES])
export const OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES = Object.freeze([...PROOF_DEPENDENCIES])
export const OUTCOME_WORKING_DRAFT_PRIORITY_BASES = Object.freeze([...PRIORITY_BASES])
