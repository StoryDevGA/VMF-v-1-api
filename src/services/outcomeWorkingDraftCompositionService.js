import { OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS as configs } from '../constants/outcomeGovernedQuality.js'
// Pure composition of an already validated projection. Claims remain immutable;
// these paragraphs explain their limits, rather than asserting new customer facts.
export const WORKING_DRAFT_COMPOSITION_VERSION = 'evidence-bound-composition.v1'
export const WORKING_DRAFT_READER_COMPOSITION_VERSION = 'evidence-bound-composition.v2'
export const WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION = 'evidence-bound-composition.v3'
export const WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION = 'evidence-bound-composition.v4'
export const WORKING_DRAFT_METADATA_COMPOSITION_VERSION = 'evidence-bound-composition.v5'
export const WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION = 'evidence-bound-composition.v6'
export const WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION = 'evidence-bound-composition.v7'
export const WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION = 'evidence-bound-composition.v8'
export const WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION = 'evidence-bound-composition.v9'
export const WORKING_DRAFT_COMPOSITION_VERSIONS = Object.freeze([WORKING_DRAFT_COMPOSITION_VERSION, WORKING_DRAFT_READER_COMPOSITION_VERSION, WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION, WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION, WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION])
export const workingDraftReaderHeading = (section, version) => version === WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION
  && section.targetSectionKey === 'next-legal-downstream-action' && section.heading === 'Next legal downstream action'
  ? 'Recorded question and review context' : [WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION, WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION].includes(version)
  && section.targetSectionKey === 'next-legal-downstream-action' && section.heading === 'Next legal downstream action'
  ? 'Decision gate and outstanding prerequisites' : section.heading
export const isWorkingDraftCompositionIdentity = ({ version, configurationVersion }) =>
  (version === WORKING_DRAFT_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V43_EVIDENCE_BOUND_COMPOSITION)
  || (version === WORKING_DRAFT_READER_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V44_READER_FACING_ATTRIBUTION)
  || (version === WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V45_DECISION_GATE_WORDING)
  || (version === WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V46_SEPARATE_INPUT_ATTRIBUTION)
  || (version === WORKING_DRAFT_METADATA_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V47_METADATA_PRESENTATION)
  || (version === WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V48_DOCUMENT_SCOPED_QUALIFICATIONS)
  || (version === WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V49_COMPLETE_EVIDENCE_REFERENCE)
  || (version === WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V50_HOLISTIC_COMPOSITION)
  || (version === WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION && configurationVersion === configs.OPENAI_RESPONSES_V51_DESCRIPTIVE_DECISION_CONTEXT)
export const isWorkingDraftCompositionRevision = ({ latest, remediation, revision }) => Boolean(
  latest?.stageKey === 'WORKING_DRAFT' && latest.status === 'SUCCEEDED'
  && remediation?.stageKey === 'ARL_MEANING_REVIEW' && remediation.status === 'FAILED'
  && remediation.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE'
  && remediation.inputSnapshot?.sourceStage?.stageExecutionId === latest.stageExecutionId
  && remediation.inputSnapshot.sourceStage.attemptFingerprint === latest.attemptFingerprint
  && remediation.inputSnapshot.sourceStage.outputFingerprint === latest.outputFingerprint
  && remediation.planFingerprint === latest.planFingerprint && remediation.qualityRunId === latest.qualityRunId
  && revision?.draftStageExecutionId === latest.stageExecutionId
  && revision.draftOutputFingerprint === latest.outputFingerprint
  && revision.arlStageExecutionId === remediation.stageExecutionId
  && revision.arlAttemptFingerprint === remediation.attemptFingerprint,
)
export const isFreshArlAfterCompositionRevision = ({ latest, source }) => Boolean(
  latest?.stageKey === 'ARL_MEANING_REVIEW' && latest.status === 'FAILED'
  && latest.failure?.failureCode === 'ARL_MEANING_REVIEW_REQUIRED_CHANGE'
  && source?.stageKey === 'WORKING_DRAFT' && source.status === 'SUCCEEDED'
  && WORKING_DRAFT_COMPOSITION_VERSIONS.includes(source.outputSnapshot?.compositionVersion)
  && source.outputSnapshot.compositionRevision?.arlStageExecutionId === latest.stageExecutionId
  && source.outputSnapshot.compositionRevision.arlAttemptFingerprint === latest.attemptFingerprint
  && source.outputSnapshot.compositionRevision.draftStageExecutionId === latest.inputSnapshot?.sourceStage?.stageExecutionId
  && source.outputSnapshot.compositionRevision.draftOutputFingerprint === latest.inputSnapshot?.sourceStage?.outputFingerprint
  && source.outputFingerprint !== latest.inputSnapshot?.sourceStage?.outputFingerprint
  && source.planFingerprint === latest.planFingerprint && source.qualityRunId === latest.qualityRunId,
)
const purposes = Object.freeze({
  'title-and-decision-context': 'Read the proposed decision as a question under consideration, not as approval to act.',
  'executive-conclusion': 'The conclusion is bounded by the attributed record below. Consideration and execution authority are different questions.',
  'decision-requested': 'A request for a decision does not establish that the decision has been made. Preserve every stated prerequisite and non-authorisation.',
  'current-reality-and-evidence-state': 'Separate a source assertion from independently established reality. Recorded acceptance does not resolve the source limitations.',
  'commercial-diagnosis': 'A described possibility is not an established commercial diagnosis or demonstrated outcome. Interpret only the attributed statements below.',
  'decision-boundaries': 'Read conditions together with their restrictions. A condition being discussed does not establish that it has been satisfied or grants execution authority.',
  'value-and-economic-pathways': 'A possible value pathway is not a demonstrated benefit, causal result or economic commitment. Retain the source-specific boundary below.',
  'target-context-and-stakeholders': 'Keep the described scope and participants attributed to their sources. A named participant does not establish consent, accountability or execution authority.',
  'recommended-course-and-progression': 'This section is a bounded interpretation, not an instruction to execute. Any progression remains subject to the recorded conditions; this paper grants no permission.',
  'risks-and-guardrails': 'The risk is reading an attributed possibility as an established or authorised action. The source-specific restrictions and unresolved qualifications remain controlling.',
  'decisions-to-approve-and-withhold': 'This paper approves nothing. What can be described now is the attributed record; stronger claims and actions remain subject to the exact restrictions below.',
  'confidence-and-evidence-requirements': 'Confidence cannot increase merely because a statement appears in several sections. Evidence requirements describe substantiation boundaries, not completed proof or an adopted work plan.',
  'next-legal-downstream-action': 'No legal or operational authorisation follows from this draft. A next-action heading does not resolve access review, approval or any other recorded condition.',
  'source-and-lineage-record': 'Source names and extraction prefixes are register labels, not proof of real customer provenance. Preserve the stated synthetic scope, source lineage and verification limits.',
})

export const composeEvidenceBoundWorkingDraftSections = (projection, version = WORKING_DRAFT_COMPOSITION_VERSION) => {
  if (!WORKING_DRAFT_COMPOSITION_VERSIONS.includes(version)) throw new TypeError('Working Draft composition version is invalid.')
  if ([WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION, WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION].includes(version)) return composeHolisticSections(projection, version)
  const completeReference = version === WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION
  const readerFacing = version !== WORKING_DRAFT_COMPOSITION_VERSION
  const sections = projection.sectionLedger.filter(row => row.status === 'SUPPORTED')
  const first = new Map(), seenLimits = new Set()
  const limits = [], limitSetByClaim = new Map()
  const scopedQualifications = [WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION].includes(version)
  const readableMetadata = version === WORKING_DRAFT_METADATA_COMPOSITION_VERSION
  const quote = value => {
    const verbatim = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    if (typeof verbatim !== 'string') throw new TypeError('Recorded qualification value is missing.')
    return `> ${verbatim.replace(/\n/g, '\n> ')}`
  }
  const field = (label, value) => `${label} (verbatim):\n\n${Array.isArray(value) ? (value.length ? value.map(quote).join('\n\n') : '(No items recorded.)') : quote(value)}`
  for (const claim of projection.customerClaims) {
    const metadata = claim.metadataRef ? projection.claimMetadataDictionary[claim.metadataRef] : claim
    const record = JSON.stringify({ scope: metadata.scope, time: metadata.time, qualification: metadata.qualification,
      blockedStrongerClaim: metadata.blockedStrongerClaim, evidenceRequiredToSubstantiate: claim.evidenceRequiredToSubstantiate })
    if (!seenLimits.has(record)) { seenLimits.add(record); limits.push(record) }
    limitSetByClaim.set(claim.claimKey, [...seenLimits].indexOf(record) + 1)
  }
  const limitationsSection = sections.find(row => row.targetSectionKey === 'source-and-lineage-record')?.targetSectionKey || sections[0]?.targetSectionKey
  return sections.map(section => {
    const passages = section.claimKeys.map(key => {
      const claim = projection.claimProjections.find(row => row.claimKey === key)
      if (first.has(key)) return completeReference
        ? 'This section repeats previously attributed evidence; repetition does not provide independent corroboration.'
        : readerFacing
        ? `See the unchanged attributed statement in ${first.get(key)}. This is the same evidence, not independent corroboration.`
        : `Evidence ${key}: see its unchanged attributed statement in ${first.get(key)}. This is the same evidence, not independent corroboration.`
      first.set(key, workingDraftReaderHeading(section, version))
      const recorded = projection.customerClaims.find(row => row.claimKey === key)
      const extractionPrefix = 'Document Customer Document: '
      const statement = readerFacing && recorded?.attribution?.sourceType === 'UPLOADED_DOCUMENT'
        && recorded.attribution.sourceLabel?.startsWith('Customer Document: ')
        && claim.statement.startsWith(extractionPrefix) ? claim.statement.slice(extractionPrefix.length) : claim.statement
      const inputLabels = { input_targetOffer: 'Target Product or Offer', input_companyName: 'Company Name', input_marketRegion: 'Market / Region' }
      const inputLabel = inputLabels[recorded?.sourceReference]
      const ownDocument = scopedQualifications && recorded?.attribution?.sourceType === 'UPLOADED_DOCUMENT'
        && recorded.claimKey === key && recorded.statement === claim.statement
        && typeof recorded.sourceReference === 'string' && recorded.sourceReference.length > 0
        && typeof recorded.evidenceReference === 'string' && recorded.evidenceReference.length > 0
        && Array.isArray(recorded.sectionKeys) && recorded.sectionKeys.includes(section.targetSectionKey)
        && typeof recorded.attribution.sourceLabel === 'string' && recorded.attribution.sourceLabel.length > 0
        && Array.isArray(claim.evidence) && claim.evidence.includes(recorded.attribution.sourceLabel)
      let documentQualifications = ''
      if (ownDocument) {
        const metadata = recorded.metadataRef ? projection.claimMetadataDictionary[recorded.metadataRef] : recorded
        if (!Array.isArray(metadata?.qualification) || metadata.qualification.some(value => typeof value !== 'string' || !value.trim())) {
          throw new TypeError('Recorded document qualification is invalid.')
        }
        if (metadata.qualification.length) documentQualifications = `\n\nQualifications recorded with this document-derived statement (verbatim):\n\n${metadata.qualification.map(quote).join('\n\n')}`
      }
      const setReference = readableMetadata ? `\n\nRecorded qualification set ${limitSetByClaim.get(key)} applies to this statement.` : ''
      if ([WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION].includes(version) && inputLabel
        && recorded.attribution?.sourceType === 'DISCOVERY_NOTES' && recorded.attribution.sourceLabel === inputLabel
        && recorded.statement === claim.statement) {
        return `${scopedQualifications ? 'User-provided intake' : 'Separately attributed input'} (${inputLabel}):\n\n> ${statement.replace(/\n/g, '\n> ')}${setReference}`
      }
      return readerFacing ? `Attributed statement: ${statement}${setReference}${documentQualifications}` : `Attributed statement ${key}: ${claim.statement}`
    })
    const context = section.targetSectionKey === sections[0].targetSectionKey
      ? 'Reading boundary: source-presented statements retain their recorded qualifications. Internal claim-permission codes describe admissibility, not priority or proof. No evidential ranking or execution permission is established by this document.' : ''
    const readableLimits = readableMetadata ? limits.map((record, index) => {
      const values = JSON.parse(record)
      return [`Recorded qualification set ${index + 1} (reference number only, not priority).`,
        field('Scope', values.scope), field('Time/currentness', values.time),
        field('Recorded qualifications', values.qualification), field('Prohibited stronger claims', values.blockedStrongerClaim),
        field('Hypothetical substantiation requirements', values.evidenceRequiredToSubstantiate)].join('\n\n')
    }).join('\n\n') : ''
    const limitations = section.targetSectionKey === limitationsSection
      ? scopedQualifications ? 'Document qualifications are quoted with their attributed statements. Historical source qualifications are recorded source text, not a current review decision.' : readableMetadata ? `Recorded provenance and qualification values follow verbatim, including historical revision labels. They are not a new current-review or execution decision.\n\n${readableLimits}` : `Exact recorded scope, dates, qualifications, prohibited stronger meanings and hypothetical substantiation requirements (not independent verification or instructions): ${limits.join(' ')}` : ''
    return { sectionKey: section.targetSectionKey, content: [context,
      ([WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION].includes(version) && section.targetSectionKey === 'next-legal-downstream-action'
        ? 'The decision under consideration remains subject to access review. Neither consideration nor this draft authorises execution; the recorded prerequisites and restrictions remain in force.'
        : purposes[section.targetSectionKey]) || 'Interpret the attributed record within its exact scope and qualifications; this section establishes no additional fact or permission.',
      ...passages, limitations].filter(Boolean).join([WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION].includes(version) ? '\n\n' : ' ') }
  })
}


// Section interpretation is editorial scaffolding, never a new evidence claim.
// Each quotation retains its own verified source and exact qualification group.
const holisticInterpretations = Object.freeze({
  'title-and-decision-context': 'Decision context: the following entries are separately supplied intake. They identify the requested subject and setting; they are not independent document evidence.',
  'executive-conclusion': 'Bounded conclusion: distinguish the described proposal from the recorded position on support and approval. The following source statements establish neither a completed trial nor an adopted execution decision.',
  'decision-requested': 'Decision question: retain the question exactly as recorded below, together with its condition and authority boundary. A question under consideration is not a decision already taken.',
  'current-reality-and-evidence-state': 'Evidence state: read outstanding conditions, stated evidence limitations and provenance as separate parts of the record. Source availability and native acceptance do not independently verify their assertions.',
  'commercial-diagnosis': 'Commercial diagnosis: compare the separately supplied offer with the document description of the proposal. This comparison identifies the proposed activity; it does not demonstrate demand, commercial viability or a realised outcome.',
  'decision-boundaries': 'Boundary assessment: distinguish exclusions defining the proposal from statements about source authority. Neither a scope description nor a statement about authorisation establishes an adopted execution decision.',
  'value-and-economic-pathways': 'Value assessment: the source statement below defines the evidential boundary for benefits and economics. A proposed activity supplies no measured value by itself; this paper does not convert that possibility into a quantified case.',
  'target-context-and-stakeholders': 'Stakeholder assessment: keep the intake setting, the recorded support position and the source description of roles separate. Naming a role does not establish that role’s agreement or authority.',
  'recommended-course-and-progression': 'Progression assessment: compare the proposed offer with the exact consideration question below. The question is available for review; it is not an adopted course, an evidential priority ranking or permission to execute.',
  'risks-and-guardrails': 'Guardrail assessment: an outstanding prerequisite and a scope exclusion answer different questions. Reading them together preserves both; it does not establish that either has been satisfied.',
  'decisions-to-approve-and-withhold': 'Decision status: the recorded support position and the source authority boundary below are the available statements. Absence of recorded approval must not be rewritten as a new refusal, approval or delegation by this paper.',
  'confidence-and-evidence-requirements': 'Confidence assessment: the recorded evidence limitations and provenance constrain interpretation. Repeating these sources cannot supply measurement, independent corroboration or a completed success.',
  'next-legal-downstream-action': 'Decision frame: the following source statements distinguish the question under consideration, its outstanding prerequisite and the source’s authority boundary. This frame grants no legal or operational permission.',
  'source-and-lineage-record': 'Source record: keep intake identity separate from document provenance. The document qualification catalogue below preserves the exact source qualifications, including historical wording; that wording is not a new current-review decision.',
})
const composeHolisticSections = (projection, version) => {
  const descriptive = version === WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION
  const sections = projection.sectionLedger.filter(row => row.status === 'SUPPORTED')
  const groups = [], rowsBySection = new Map()
  const quote = value => `> ${value.replace(/\n/g, '\n> ')}`
  const inputLabels = { input_targetOffer: 'Target Product or Offer', input_companyName: 'Company Name', input_marketRegion: 'Market / Region' }
  for (const section of sections) {
    const rows = section.claimKeys.map(key => {
      const claim = projection.claimProjections.find(row => row.claimKey === key)
      const recorded = projection.customerClaims.find(row => row.claimKey === key)
      if (!claim || !recorded || claim.statement !== recorded.statement || !recorded.sectionKeys?.includes(section.targetSectionKey)) throw new TypeError('Section claim binding is invalid.')
      const source = recorded.attribution
      const inputLabel = inputLabels[recorded.sourceReference]
      if (inputLabel && source?.sourceType === 'DISCOVERY_NOTES' && source.sourceLabel === inputLabel) return { key, statement: claim.statement, text: `User-provided intake (${inputLabel}):\n\n${quote(claim.statement)}` }
      if (source?.sourceType && source.sourceType !== 'UPLOADED_DOCUMENT') return { key, statement: claim.statement, text: `Attributed source statement (${source.sourceLabel || 'recorded source'}):\n\n${quote(claim.statement)}` }
      if (source?.sourceType !== 'UPLOADED_DOCUMENT' || !recorded.sourceReference || !recorded.evidenceReference || !source.sourceLabel || !claim.evidence?.includes(source.sourceLabel)) throw new TypeError('Document source ownership is unresolved.')
      const metadata = recorded.metadataRef ? projection.claimMetadataDictionary[recorded.metadataRef] : recorded
      if (!Array.isArray(metadata?.qualification) || metadata.qualification.some(value => typeof value !== 'string' || !value.trim())) throw new TypeError('Recorded document qualification is invalid.')
      const identity = JSON.stringify([recorded.sourceReference, metadata.qualification])
      let group = groups.find(row => row.identity === identity)
      if (!group) { group = { identity, label: source.sourceLabel, qualifications: metadata.qualification, number: groups.length + 1 }; groups.push(group) }
      if (group.label !== source.sourceLabel) throw new TypeError('Document source label is ambiguous.')
      const prefix = 'Document Customer Document: '
      const statement = source.sourceLabel.startsWith('Customer Document: ') && claim.statement.startsWith(prefix) ? claim.statement.slice(prefix.length) : claim.statement
      return { key, statement, sourceReference: recorded.sourceReference,
        text: `Document statement from ${source.sourceLabel} (document qualifications ${group.number} in Source and lineage record):\n\n${quote(statement)}` }
    })
    rowsBySection.set(section.targetSectionKey, rows)
  }
  // The catalogue is reader navigation, not a new claim placement or permission.
  const catalogue = groups.map(group => `Document qualifications ${group.number} — ${group.label} (verbatim; applies only to quotations marked with this entry):\n\n${group.qualifications.length ? group.qualifications.map(quote).join('\n\n') : '(No qualifications recorded.)'}`).join('\n\n')
  const catalogueSection = sections.find(row => row.targetSectionKey === 'source-and-lineage-record')
  if (groups.length && !catalogueSection) throw new TypeError('Document qualification catalogue section is missing.')
  return sections.map((section, index) => {
    const rows = rowsBySection.get(section.targetSectionKey)
    let interpretation = holisticInterpretations[section.targetSectionKey]
    let passages = rows.map(row => row.text)
    if (section.targetSectionKey === 'next-legal-downstream-action') {
      const unique = predicate => { const matches = rows.filter(predicate); return matches.length === 1 ? matches[0] : null }
      const question = unique(row => row.sourceReference && /^The decision is whether [^\n]+; this source does not authori[sz]e [^\n]+\.$/.test(row.statement))
      const prerequisite = unique(row => row.sourceReference && row !== question && /^Access review remains outstanding\.$/.test(row.statement))
      const boundary = unique(row => row.sourceReference && row !== question && row !== prerequisite && /^this source does not authori[sz]e [^\n]+\.$/.test(row.statement))
      if (question && prerequisite && boundary && new Set([question.key, prerequisite.key, boundary.key]).size === 3
        && /after access review;/.test(question.statement) && question.sourceReference === boundary.sourceReference) {
        if (descriptive) interpretation = 'The following separately attributed statements describe consideration, outstanding review and source non-authorisation. Their arrangement here does not prescribe an approval route.'
        passages = [`Question under consideration:\n\n${question.text}`, `${descriptive ? 'Outstanding access review, from its own source' : 'Separately recorded outstanding prerequisite'}:\n\n${prerequisite.text}`, `${descriptive ? 'Source statement about permission' : 'Source authority boundary'}:\n\n${boundary.text}`,
          ...rows.filter(row => ![question, prerequisite, boundary].includes(row)).map(row => row.text),
          descriptive ? 'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.'
            : 'What this record supports now: an open consideration question with an outstanding prerequisite. What these sources do not establish: permission to execute. Completing a prerequisite would not itself supply that permission. This frame does not adopt a decision.']
      } else {
        interpretation = 'Decision context: the mapped source statements below are retained without inferring an adopted action or prerequisite sequence.'
        passages.push('The mapped statements do not uniquely establish all three decision-frame roles. No prerequisite sequence, authority or adopted action is inferred.')
      }
    }
    return { sectionKey: section.targetSectionKey, content: [index === 0 ? 'Reading boundary: source-presented statements retain their qualifications. Internal admissibility codes are not priority rankings or proof. Source register labels do not establish real customer provenance.' : '',
      interpretation || 'Interpret the attributed record within its exact scope; no additional fact or permission is established.',
      ...passages, section === catalogueSection ? catalogue : ''].filter(Boolean).join('\n\n') }
  })
}
