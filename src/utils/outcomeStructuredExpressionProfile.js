import { buildPresentationExpressionSection, presentSourceQualification } from './outcomePresentationExpressionProfile.js'

export const OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION = 'outcome-readable-expression.v4'

const headings = Object.freeze({
  'title-and-decision-context': 'Subject and setting — supplied intake',
  'executive-conclusion': 'Proposal status — quoted source positions',
  'decision-requested': 'Decision question — quoted consideration boundary',
  'current-reality-and-evidence-state': 'Outstanding conditions — source evidence',
  'commercial-diagnosis': 'Offer and proposal — intake and source comparison',
  'decision-boundaries': 'Scope exclusions and execution permission — distinct boundaries',
  'value-and-economic-pathways': 'Benefits and economics — evidence limitations',
  'target-context-and-stakeholders': 'Participants — intake and quoted support positions',
  'recommended-course-and-progression': 'Progression — consideration without an adopted course',
  'risks-and-guardrails': 'Prerequisites and exclusions — separate restrictions',
  'decisions-to-approve-and-withhold': 'Support and approval — recorded positions only',
  'confidence-and-evidence-requirements': 'Confidence — measurement and provenance limits',
  'next-legal-downstream-action': 'Access-review context — not an approval process',
  'source-and-lineage-record': 'Source qualification catalogue — historical limits',
})
const groups = Object.freeze({
  'title-and-decision-context': 'Reading group: Subject and question — sections 1–3.',
  'current-reality-and-evidence-state': 'Reading group: Evidence and interpretation — sections 4–8.',
  'recommended-course-and-progression': 'Reading group: Decision boundaries — sections 9–13.',
  'source-and-lineage-record': 'Reading group: Source qualifications — section 14.',
})

// The known source grammar is inherited from v3. These shorter, source-scoped
// sentences retain every material restriction locally, without a page reference
// being required to discover a qualification. Full source notes remain below.
const localQualification = (original) => {
  const full = presentSourceQualification(original)
  const local = {
    'The claim’s effective date, real-world currentness and measurement period are unknown. Capture or upload times do not establish when the claim was true.': 'Dates, currentness and measurement are unknown; capture/upload time is not a claim date.',
    'Synthetic test material only; not a real customer case or evidence of real-world operations.': 'Synthetic only; not real-customer/operations evidence.',
    'The legacy text location is supported only by an exact match in the external frozen ledger. The application has no capture-span receipt.': 'Legacy text location: external frozen-ledger match only, with no application capture-span receipt.',
    'Only the exact statement as presented by the source is supported. Acceptance and extraction validation in the application do not establish authenticity, independent verification, corroboration or business truth.': 'Exact statements only; acceptance/extraction does not prove authenticity, independent verification or business truth.',
    'At the time of this historical source note, a contradiction was unreviewed. The note does not decide that contradiction or carry forward an earlier formal finding.': '',
    'The fictional scenario is repeated unchanged from the earlier revision, with no new supporting-evidence change admitted. The repeated documents share authored synthetic provenance and are not independent corroboration.': 'Unchanged authored copies add no new support or independent corroboration.',
  }
  return local[full]
}

export const buildStructuredExpressionSection = (section, { sections = [] } = {}) => {
  const prior = buildPresentationExpressionSection(section, { sections })
  const heading = headings[section.sectionKey]
  if (!heading) throw new TypeError('Structured expression does not recognise this section.')
  const expectedOrder = Object.keys(headings).indexOf(section.sectionKey) + 1
  if (section.order !== expectedOrder || sections.length !== 14
    || sections.some((item, index) => Object.keys(headings)[index] !== item.sectionKey || item.order !== index + 1)) {
    throw new TypeError('Structured expression requires the exact fourteen-section Narrative order.')
  }
  const commentary = prior.typedBlocks.find((block) => block.kind === 'EXPLANATION')
  const blocks = [
    ...(groups[section.sectionKey] ? [{ kind: 'GROUP', text: groups[section.sectionKey] }] : []),
    { kind: 'EXPLANATION', text: commentary.text },
  ]
  for (const block of prior.typedBlocks.filter((item) => ['SOURCE_QUOTATION', 'INTAKE'].includes(item.kind))) {
    blocks.push({ kind: 'LABEL', level: 3, text: block.kind === 'INTAKE' ? `User-provided intake — ${block.label}` : `Source quotation — ${block.source}` })
    blocks.push({ ...block })
  }
  if (section.order === 1) blocks.push({ kind: 'DIAGRAM_STATUS', text: sections.every((item) => !String(item.diagramIntent || '').trim())
    ? 'Diagram applicability: not applicable; no diagrams are specified for any of the fourteen sections.'
    : 'Diagram applicability: diagram information appears only where specified.' })
  if (prior.diagram.present) blocks.push({ kind: 'DIAGRAM_STATUS', text: `Specified diagram: ${prior.diagram.description}\n\nAccessible description: ${prior.diagram.accessibleText}` })
  const sourceNotes = new Map()
  for (const mapping of prior.trace.mappings.filter((item) => item.kind === 'QUALIFICATION_MAPPING')) {
    const notes = sourceNotes.get(mapping.source) || []
    const text = section.sectionKey === 'source-and-lineage-record'
      ? presentSourceQualification(mapping.original) : localQualification(mapping.original)
    if (!text) continue
    if (!notes.includes(text)) notes.push(text)
    sourceNotes.set(mapping.source, notes)
  }
  // Group only exactly shared qualifications, retaining their explicit set of
  // applicable source names. A locator limit unique to one source stays unique.
  const applicability = new Map()
  for (const [source, notes] of sourceNotes) {
    for (const note of notes) applicability.set(note, [...(applicability.get(note) || []), source])
  }
  const scoped = new Map()
  for (const [note, sources] of applicability) {
    const key = sources.join('; ')
    scoped.set(key, [...(scoped.get(key) || []), note])
  }
  const catalogue = section.sectionKey === 'source-and-lineage-record'
  const qualifierBlocks = [...scoped].flatMap(([source, notes]) => [
    { kind: 'LABEL', level: 4, text: `Quotations from ${source}` },
    { kind: 'SOURCE_LIMITS', source, text: catalogue ? notes.map((note) => `- ${note}`).join('\n') : notes.join(' ') },
  ])
  const qualificationParts = sourceNotes.size ? [
    { kind: 'LABEL', level: 3, text: catalogue ? 'Historical source notes' : 'Source limits at this point' },
    { kind: 'SCOPE', text: 'These limits apply only to quotations from the named source, not to user-provided intake.' },
    ...qualifierBlocks,
  ] : []
  const render = (block) => block.kind === 'LABEL'
    ? `${'#'.repeat(block.level)} ${block.text}`
    : ['SOURCE_QUOTATION', 'INTAKE'].includes(block.kind) ? `> ${block.text}` : block.text
  const body = blocks.map(render).join('\n\n')
  const qualification = qualificationParts.map(render).join('\n\n')
  if (body.length > 24000 || qualification.length > 2000) throw new TypeError('Structured expression exceeds existing section limits.')
  return {
    heading, body, qualification, diagram: prior.diagram,
    typedBlocks: { body: blocks, qualification: qualificationParts },
    trace: { ...prior.trace, profileVersion: OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION,
      sourceProfileVersion: prior.trace.profileVersion,
      localQualifications: [...sourceNotes].map(([source, notes]) => ({ source, notes })),
      presentationGroup: groups[section.sectionKey] || '',
    },
  }
}
