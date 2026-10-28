import { buildReadableExpressionSection } from './outcomeReadableExpressionProfile.js'

export const OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION = 'outcome-readable-expression.v3'

// These are the exact editorial scaffolds emitted by the descriptive Working
// Draft composer. This profile recognises that template; it is not a general
// summariser and must refuse unknown wording rather than invent its meaning.
const profiles = Object.freeze({
  'title-and-decision-context': {
    heading: 'Subject and setting',
    contexts: ['Reading boundary: source-presented statements retain their qualifications. Internal admissibility codes are not priority rankings or proof. Source register labels do not establish real customer provenance. Decision context: the following entries are separately supplied intake. They identify the requested subject and setting; they are not independent document evidence.'],
    explanation: 'The subject and setting are user-provided intake, not independent document evidence. Their inclusion or order does not establish evidence quality, real customer provenance or priority.',
  },
  'executive-conclusion': {
    heading: 'Proposal status',
    contexts: ['Bounded conclusion: distinguish the described proposal from the recorded position on support and approval. The following source statements establish neither a completed trial nor an adopted execution decision.'],
    explanation: 'The proposal and the recorded support position are separate. These statements establish neither a completed trial nor a decision to execute it.',
  },
  'decision-requested': {
    heading: 'Question under consideration',
    contexts: ['Decision question: retain the question exactly as recorded below, together with its condition and authority boundary. A question under consideration is not a decision already taken.'],
    explanation: 'The question remains under consideration, with its recorded condition and permission boundary. It is not a decision already taken.',
  },
  'current-reality-and-evidence-state': {
    heading: 'Evidence and outstanding conditions',
    contexts: ['Evidence state: read outstanding conditions, stated evidence limitations and provenance as separate parts of the record. Source availability and native acceptance do not independently verify their assertions.'],
    explanation: 'Outstanding conditions, evidence limits and source provenance are distinct. A source being available or accepted in the application does not independently verify what it says.',
  },
  'commercial-diagnosis': {
    heading: 'Offer and proposal',
    contexts: ['Commercial diagnosis: compare the separately supplied offer with the document description of the proposal. This comparison identifies the proposed activity; it does not demonstrate demand, commercial viability or a realised outcome.'],
    explanation: 'The supplied offer and the source description identify a proposed activity. Their comparison does not demonstrate demand, commercial viability or an achieved outcome.',
  },
  'decision-boundaries': {
    heading: 'Scope and permission boundaries',
    contexts: ['Boundary assessment: distinguish exclusions defining the proposal from statements about source authority. Neither a scope description nor a statement about authorisation establishes an adopted execution decision.'],
    explanation: 'Scope exclusions describe what the proposal leaves out. Statements about permission describe a different boundary. Neither establishes a decision to execute.',
  },
  'value-and-economic-pathways': {
    heading: 'Benefit and economic evidence',
    contexts: ['Value assessment: the source statement below defines the evidential boundary for benefits and economics. A proposed activity supplies no measured value by itself; this paper does not convert that possibility into a quantified case.'],
    explanation: 'The source statement limits what can be said about benefits and economics. A proposed activity alone supplies no measured value or quantified case.',
  },
  'target-context-and-stakeholders': {
    heading: 'Setting and participants',
    contexts: ['Stakeholder assessment: keep the intake setting, the recorded support position and the source description of roles separate. Naming a role does not establish that role’s agreement or authority.'],
    explanation: 'The intake setting, support position and described roles are separate records. Naming a role does not establish its agreement or authority.',
  },
  'recommended-course-and-progression': {
    heading: 'Conditions for further consideration',
    contexts: ['Progression assessment: compare the proposed offer with the exact consideration question below. The question is available for review; it is not an adopted course, an evidential priority ranking or permission to execute.'],
    explanation: 'The proposed offer can be compared with the recorded question. That question remains available for review; it is not an adopted course, a priority ranking or permission to execute.',
  },
  'risks-and-guardrails': {
    heading: 'Restrictions and unresolved conditions',
    contexts: ['Guardrail assessment: an outstanding prerequisite and a scope exclusion answer different questions. Reading them together preserves both; it does not establish that either has been satisfied.'],
    explanation: 'An outstanding prerequisite and a scope exclusion answer different questions. Neither is shown to be satisfied merely by reading them together.',
  },
  'decisions-to-approve-and-withhold': {
    heading: 'Recorded support and permission',
    contexts: ['Decision status: the recorded support position and the source authority boundary below are the available statements. Absence of recorded approval must not be rewritten as a new refusal, approval or delegation by this paper.'],
    explanation: 'Only the recorded support position and source permission boundary are available. Missing approval is not a new refusal, approval or delegation made by this paper.',
  },
  'confidence-and-evidence-requirements': {
    heading: 'Evidence limits',
    contexts: ['Confidence assessment: the recorded evidence limitations and provenance constrain interpretation. Repeating these sources cannot supply measurement, independent corroboration or a completed success.'],
    explanation: 'Evidence limits and provenance constrain interpretation. Repetition does not add measurement, independent corroboration or proof of completed success.',
  },
  'next-legal-downstream-action': {
    heading: 'Question and access-review context',
    contexts: [
      'The following separately attributed statements describe consideration, outstanding review and source non-authorisation. Their arrangement here does not prescribe an approval route. Question under consideration:',
      'Outstanding access review, from its own source:',
      'Source statement about permission:',
      'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.',
    ],
    explanation: 'The statements describe a question, an outstanding access review and a source permission boundary. They do not assign an execution approver, define an approval procedure, adopt a decision or grant permission after review.',
  },
  'source-and-lineage-record': {
    heading: 'Source qualifications',
    contexts: ['Source record: keep intake identity separate from document provenance. The document qualification catalogue below preserves the exact source qualifications, including historical wording; that wording is not a new current-review decision.'],
    explanation: 'Intake identity is separate from document provenance. These source qualifications preserve historical limits; they are not a new decision about the current review.',
  },
})

const markerPattern = /Document statement from ([^:]+): (.+?) \(document qualifications (\d+) in Source and lineage record\): > |User-provided intake \(([^)]+)\): > |Document qualifications (\d+) — ([^:]+): (.+?) \(verbatim; applies only to quotations marked with this entry\): > /g
const internalIdentity = /\b(?:contradiction|evidence_document|outcome_quality_stage|grr_exec|rsv2)_[a-z\d_-]+\b|\b[a-f\d]{24,64}\b/i
const internalStatus = /\b(?:SOURCE_PRESENTED|UNREVIEWED|ACCEPTED|VALIDATED)\b/

export const presentSourceQualification = (value) => {
  const fixed = {
    'Claim effective date, real-world currentness and measurement window are not established; capture/upload metadata is not an effective claim date.': 'The claim’s effective date, real-world currentness and measurement period are unknown. Capture or upload times do not establish when the claim was true.',
    'Disposable synthetic test only; this is not a customer case or evidence of real-world operations.': 'Synthetic test material only; not a real customer case or evidence of real-world operations.',
    'Legacy text-source location is supported only by the external frozen ledger text match; no native capture span receipt exists.': 'The legacy text location is supported only by an exact match in the external frozen ledger. The application has no capture-span receipt.',
    'SOURCE_PRESENTED exact statement only. Native ACCEPTED and extraction VALIDATED statuses do not establish authenticity, independent verification, corroboration or business truth.': 'Only the exact statement as presented by the source is supported. Acceptance and extraction validation in the application do not establish authenticity, independent verification, corroboration or business truth.',
  }
  if (Object.hasOwn(fixed, value)) return fixed[value]
  if (/^Current R\d+ contradiction candidate contradiction_[a-f\d]+ is UNREVIEWED\. These qualifications do not adjudicate it or inherit the exact R\d+ formal finding\.$/.test(value)) {
    return 'At the time of this historical source note, a contradiction was unreviewed. The note does not decide that contradiction or carry forward an earlier formal finding.'
  }
  if (/^R\d+ fictional scenario reused unchanged in R\d+; no R\d+ changed-support delta is admitted\. Repeated documents share authored synthetic provenance and are not independent corroboration\.$/.test(value)) {
    return 'The fictional scenario is repeated unchanged from the earlier revision, with no new supporting-evidence change admitted. The repeated documents share authored synthetic provenance and are not independent corroboration.'
  }
  throw new TypeError('Presentation profile does not recognise a source qualification.')
}

const pointOfUseQualification = (value) => {
  const full = presentSourceQualification(value)
  const compact = {
    'The claim’s effective date, real-world currentness and measurement period are unknown. Capture or upload times do not establish when the claim was true.': 'Claim date and currentness are unknown.',
    'Synthetic test material only; not a real customer case or evidence of real-world operations.': 'Synthetic test only.',
    'The legacy text location is supported only by an exact match in the external frozen ledger. The application has no capture-span receipt.': '',
    'Only the exact statement as presented by the source is supported. Acceptance and extraction validation in the application do not establish authenticity, independent verification, corroboration or business truth.': 'Source statements; application acceptance is not independent verification.',
    'At the time of this historical source note, a contradiction was unreviewed. The note does not decide that contradiction or carry forward an earlier formal finding.': '',
    'The fictional scenario is repeated unchanged from the earlier revision, with no new supporting-evidence change admitted. The repeated documents share authored synthetic provenance and are not independent corroboration.': '',
  }
  return compact[full]
}

export const buildPresentationExpressionSection = (section, { sections = [] } = {}) => {
  const profile = profiles[section?.sectionKey]
  if (!profile) throw new TypeError('Presentation profile does not recognise this Narrative section.')
  const parsed = buildReadableExpressionSection(section, { sections })
  const primary = section.keyMessages[0].trim()
  const markers = [...primary.matchAll(new RegExp(markerPattern.source, 'g'))]
  const contexts = [primary.slice(0, markers[0]?.index ?? primary.length).trim()].filter(Boolean)
  const typedBlocks = []
  const trace = []
  markers.forEach((marker, index) => {
    const entry = parsed.mapping[index]
    if (!entry) throw new TypeError('Presentation source mapping is incomplete.')
    const tail = primary.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? primary.length).trim()
    if (entry.kind === 'SOURCE_QUALIFICATIONS') {
      const qualifiers = entry.statement.split(' > ').map((original) => ({ original, readerText: presentSourceQualification(original) }))
      trace.push({ ...entry, qualifiers })
      return
    }
    if (!entry.exactRepeatedMessageRemoved || !tail.startsWith(entry.statement) || internalIdentity.test(entry.statement) || internalStatus.test(entry.statement)) {
      throw new TypeError('Presentation quotation is not an exact, reader-safe mapped statement.')
    }
    const context = tail.slice(entry.statement.length).trim()
    if (context) contexts.push(context)
    typedBlocks.push(entry.kind === 'INTAKE'
      ? { kind: 'INTAKE', label: entry.label, text: entry.statement }
      : { kind: 'SOURCE_QUOTATION', source: entry.source, qualification: entry.qualification, text: entry.statement })
    trace.push(entry)
  })
  if (JSON.stringify(contexts) !== JSON.stringify(profile.contexts)
    || section.qualification || parsed.body.includes('Additional recorded statement')) {
    throw new TypeError('Presentation profile does not recognise the exact Narrative commentary or supplementary statements.')
  }
  const qualifierRecords = sections.flatMap((item) => {
    const record = buildReadableExpressionSection(item, { sections })
    return record.mapping.filter((entry) => entry.kind === 'SOURCE_QUALIFICATIONS')
  })
  const sourceBlocks = typedBlocks.filter((block) => block.kind === 'SOURCE_QUOTATION')
  const applicable = section.sectionKey === 'source-and-lineage-record' ? qualifierRecords
    : qualifierRecords.filter((record) => sourceBlocks.some((block) => block.source === record.source && block.qualification === record.qualification))
  const qualifierGroups = new Map()
  const catalogueSection = section.sectionKey === 'source-and-lineage-record'
  for (const record of applicable) {
    for (const original of record.statement.split(' > ')) {
      const fullReaderText = presentSourceQualification(original)
      const readerText = catalogueSection ? fullReaderText : pointOfUseQualification(original)
      trace.push({ kind: 'QUALIFICATION_MAPPING', source: record.source, qualification: record.qualification, original,
        readerText: fullReaderText, readerLocation: 'source-and-lineage-record', pointOfUseText: readerText })
      if (!readerText) continue
      const sources = qualifierGroups.get(readerText) || new Set()
      sources.add(record.source)
      qualifierGroups.set(readerText, sources)
    }
  }
  const scoped = new Map()
  for (const [qualifier, sources] of qualifierGroups) {
    const key = [...sources].join('; ')
    scoped.set(key, [...(scoped.get(key) || []), qualifier])
  }
  const qualificationBlocks = [...scoped].map(([source, qualifiers]) => ({ kind: 'SOURCE_QUALIFICATIONS', source,
    text: catalogueSection ? qualifiers.map((value) => `- ${value}`).join('\n') : qualifiers.join(' ') }))
  const ordered = [{ kind: 'EXPLANATION', text: profile.explanation }, ...sourceBlocks, ...typedBlocks.filter((block) => block.kind === 'INTAKE')]
  const renderBlock = (block) => block.kind === 'EXPLANATION' ? block.text
    : `${block.kind === 'INTAKE' ? `User-provided intake — ${block.label}` : `Source quotation — ${block.source}`}\n\n> ${block.text}`
  const qualifications = qualificationBlocks.map((block) => `${block.source}\n${block.text}`).join('\n\n')
  const body = ordered.map(renderBlock).join('\n\n') + (catalogueSection && qualifications
    ? `\n\nSource qualifications — apply only to quotations from the named source, not intake\n\n${qualifications}` : '')
  const qualification = qualifications ? catalogueSection
    ? 'The source qualifications above apply only to quotations from the named source, not to user-provided intake. Historical review notes do not decide the current review.'
    : `Source quotations only; not intake. Full limits: §14.\n\n${qualifications}` : ''
  if (qualification.length > 2000 || body.length > 24000 || internalIdentity.test(body) || internalIdentity.test(qualification)
    || internalStatus.test(body) || internalStatus.test(qualification)) {
    throw new TypeError('Presentation profile exceeds its existing limits or exposes an internal identifier.')
  }
  return {
    heading: profile.heading, body, qualification, diagram: parsed.diagram,
    typedBlocks: [...ordered, ...qualificationBlocks],
    trace: { profileVersion: OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION, originalKeyMessages: [...section.keyMessages], originalQualification: section.qualification, originalContexts: contexts, renderedExplanation: profile.explanation, mappings: trace },
  }
}
