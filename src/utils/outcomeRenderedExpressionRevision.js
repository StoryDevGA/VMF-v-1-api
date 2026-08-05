const INTERNAL_EXPRESSION_PATTERN = /\b(?:accepted truth|downstream governance|adaptive reasoning layer|arl|approved meaning|output shaping|governance|lineage|publication|presentation generation|infographic|generated acceptance asset)\b/i

const EXECUTIVE_HEADINGS = Object.freeze({
  'customer-context': 'Executive context',
  'stakeholder-register': 'Decision ownership',
  'output-requirements': 'Delivery requirements',
  'strategic-objectives': 'Strategic direction',
  'current-state-assessment': 'Current-state readiness',
  'evidence-register': 'Evidence readiness',
})

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const unique = (values) => {
  const seen = new Set()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const isInternalRenderedExpressionText = (value) => INTERNAL_EXPRESSION_PATTERN.test(text(value))

const customerFacingText = (value) => text(value)
  .replace(/â€™/g, "'")
  .replace(/â€˜/g, "'")
  .replace(/\baccepted truth\b/gi, 'validated source evidence')
  .replace(/\bvalidated source evidence\b/gi, 'supplied information')
  .replace(/\bdownstream governance(?: note)?\b/gi, 'internal review note')
  .replace(/\badaptive reasoning layer\b/gi, 'analytical review')
  .replace(/\bARL\b/g, 'analytical review')
  .replace(/\bapproved meaning\b/gi, 'agreed decision basis')
  .replace(/\boutput shaping\b/gi, 'brief preparation')
  .replace(/\bgovernance\b/gi, 'decision oversight')
  .replace(/\blineage\b/gi, 'source traceability')
  .replace(/\bpresentation generation\b/gi, 'slide-deck production')
  .replace(/\binfographic\b/gi, 'visual summary')
  .replace(/\bpublication\b/gi, 'distribution')
  .replace(/\bgenerated acceptance asset\b/gi, 'Executive Brief')
  .replace(/\bbounded by evidence\b/gi, 'within the available evidence')
  .replace(/\bdownstream packaging\b/gi, 'final delivery')
  .replace(/\bDeliverable is constrained to\b/gi, 'The deliverable is')
  .replace(/\bare not specified and must remain visible gaps\b/gi, 'are not specified and remain visible gaps')
  .replace(/\bare not evidenced and must remain an explicit gap\b/gi, 'are not evidenced and remain an explicit gap')
  .replace(/\bThe executive brief must treat objectives as to-be-defined and should avoid implying\b/gi, 'The objectives remain to be defined, and the evidence does not support')
  .replace(/\bexecutive-facing claims must avoid certainty around results\/ROI\/comparisons and treat them as to-be-evidenced\b/gi, 'results, ROI and comparisons remain unsupported until itemized evidence is available')
  .replace(/\bmust be framed as conditional\b/gi, 'is conditional')
  .replace(/\bmust avoid certainty around\b/gi, 'cannot support certainty about')
  .replace(/\bwill need to be elicited and evidenced\b/gi, 'require confirmation and evidence')
  .replace(/\bwhat should be verified\b/gi, 'what requires verification')
  .replace(/\bInterim work at this stage should focus on\b/gi, 'Near-term work focuses on')
  .replace(/\bThe brief must retain\b/gi, 'The brief retains')
  .replace(/\bThe brief must avoid asserting\b/gi, 'The available evidence does not support')
  .replace(/\bmust not be treated as\b/gi, 'is unavailable as')
  .replace(/\bmust remain\b/gi, 'remains')
  .replace(/\bmust have\b/gi, 'includes')
  .replace(/\bshould avoid implying\b/gi, 'does not support')
  .replace(/\bwill need to be elicited\b/gi, 'requires confirmation')
  .replace(/\(e\.g\.,\s*([^)]+)\)/gi, 'such as $1')
  .replace(/\(frequency\/scale\/cost\)/gi, 'across frequency, scale and cost')
  .replace(/\(file type\/channel\)/gi, 'for file type and channel')
  .replace(/2 source type\(s\)/gi, 'two source types')
  .replace(
    /\bApproval routing is simplified \(sponsor and approver are the same named role\), but decision criteria for approval are not evidenced\.?/gi,
    'The supplied stakeholder information identifies the same named sponsor and approver, while approval criteria are not established in the supplied information.',
  )
  .replace(
    /\bDelivery logistics for file type and channel are a blocking dependency for final delivery but are not yet evidenced\.?/gi,
    'If final delivery is required, the missing file type and channel remain unresolved constraints.',
  )
  .replace(
    /\bCounts do not establish proof for outcomes, comparisons, or quantified claims\.?/gi,
    'Source counts alone do not support outcomes, comparisons, or quantified claims.',
  )
  .replace(
    /\bThe executive brief will likely require outcome or comparative statements; those require traceable, item-level support that is not yet present\.?/gi,
    'If the brief includes outcome or comparative statements, traceable item-level support is not yet available.',
  )
  .replace(
    /\bA decision-ready executive brief may require cross-functional inputs depending on decision scope; such stakeholders are not yet evidenced\.?/gi,
    'If the decision scope includes cross-functional review, the relevant stakeholders are not yet evidenced.',
  )
  .replace(
    /\bElement-level source traceability will be implemented as traceable mappings from each substantive statement to (?:validated source evidence|supplied information) reference keys and specific evidence items once itemization exists\.?/gi,
    'The stated element-level source-traceability requirement depends on itemized evidence references, which are not yet available.',
  )
  .replace(
    /\bSearchable\/accessible text implies a non-image-based deliverable format, but the exact file type is not yet specified\.?/gi,
    'Searchable and accessible text is a stated delivery requirement; the exact file type is not yet specified.',
  )
  .replace(/\bThe brief retains searchable and accessible text\.?/gi, 'Searchable and accessible text is a stated delivery requirement.')
  .replace(/\bThe brief retains editable structure where supported\.?/gi, 'Editable structure, where supported, is a stated delivery requirement.')
  .replace(
    /\bAn executive sponsor brief requires buying situation context such as evaluation vs\. expansion to be decision-relevant; this is not yet evidenced\.?/gi,
    'If the brief supports an executive sponsor decision, the relevant buying situation is not yet evidenced.',
  )
  .replace(
    /\bThe executive sponsor decision requires explicit objectives and measures to evaluate options; these require confirmation and evidence\.?/gi,
    'If the executive sponsor is to evaluate options, explicit objectives and measures are not yet evidenced.',
  )
  .replace(/\bnot yet evidenced\b/gi, 'not yet established in the supplied information')
  .replace(/\bnot evidenced\b/gi, 'not established in the supplied information')
  .replace(/\buntil evidenced\b/gi, 'until supported by the supplied information')
  .replace(/\bNo evidenced ([^.]+)\.?/gi, 'The supplied information contains no $1.')
  .replace(/\bNo ([^.]+) evidenced\.?/gi, 'The supplied information does not identify $1.')
  .replace(
    /\bThe supplied information contains no performance baseline, observed friction profile across frequency, scale and cost, or constraints are available to support quantified comparisons or prioritization\.?/gi,
    'The supplied information provides no performance baseline, observed friction profile across frequency, scale and cost, or constraints to support quantified comparisons or prioritization.',
  )
  .replace(
    /\bThe supplied information does not identify additional stakeholders\. beyond Quinn and Riley\.?/gi,
    'The supplied information identifies no additional stakeholders beyond Quinn and Riley.',
  )
  .replace(/\bNo clarity on what the ['‘]?two source types['’]? are\.?/gi, 'The two source types are not identified.')
  .trim()

const splitItems = (value) => customerFacingText(value)
  .split(/(?:^|\s+)-\s+|(?<=[.!?])\s+(?=[A-Z])/)
  .map(text)
  .filter((item) => item
    && !/^(?:evidence|decision implications|practical implications):?$/i.test(item)
    && !/\banalytical review\b/i.test(item)
    && !/\binternal review note\b/i.test(item)
    && !isInternalRenderedExpressionText(item))

const extractBetween = (value, start, end) => {
  const match = customerFacingText(value).match(new RegExp(`${start}\\s*:?\\s*([\\s\\S]*?)(?=${end}|$)`, 'i'))
  return match ? match[1] : ''
}

const parsePrimaryMessage = (value) => {
  const known = extractBetween(
    value,
    'known\\s*\\((?:validated source evidence|supplied information)\\)',
    '(?:decision-relevance|practical) implications|internal review note',
  )
  const implications = extractBetween(
    value,
    '(?:decision-relevance|practical) implications\\s*\\(within the available evidence\\)',
    'internal review note',
  )
  return {
    facts: splitItems(known),
    implications: splitItems(implications),
  }
}

const executiveHeading = (section = {}) => EXECUTIVE_HEADINGS[text(section.sectionKey).toLowerCase()]
  || customerFacingText(section.heading).replace(/\s*\([^)]*\)\s*$/, '').trim()

const testDataNote = (items) => {
  const retained = []
  let note = ''
  for (const item of items) {
    if (/\b(?:qa fixture|user-authorized fictitious)\b/i.test(item)) {
      note = 'Quinn Fixture QA and Riley Fixture QA are test-only placeholder identities.'
    } else retained.push(item)
  }
  return { note, retained }
}

export const buildExpressionOnlyRevisionSection = (section = {}) => {
  const sourceMessages = Array.isArray(section.keyMessages) ? section.keyMessages : []
  const primary = parsePrimaryMessage(sourceMessages[0])
  const fallback = splitItems(sourceMessages[0])
  const factsWithNote = testDataNote(primary.facts.length > 0 ? primary.facts : fallback)
  const facts = unique(factsWithNote.retained)
  const implications = unique(primary.implications)
  const takeaway = implications[0] || facts[0]
  if (!takeaway || facts.length < 1) {
    throw new TypeError(`Expression-only revision has no customer-visible executive evidence for ${text(section.sectionKey) || 'unknown-section'}.`)
  }

  const bodyParts = [`Executive takeaway: ${takeaway}`]
  bodyParts.push(`Evidence\n${facts.map((item) => `- ${item}`).join('\n')}`)
  if (implications.length > 1) {
    bodyParts.push(`Decision implications\n${implications.slice(1).map((item) => `- ${item}`).join('\n')}`)
  }

  const unknowns = unique([
    ...(factsWithNote.note ? [factsWithNote.note] : []),
    ...splitItems(section.qualification),
  ])
  return {
    heading: executiveHeading(section),
    body: bodyParts.join('\n\n'),
    qualification: unknowns.length > 0
      ? `What remains unknown\n${unknowns.map((item) => `- ${item}`).join('\n')}`
      : '',
    diagram: {
      present: Boolean(text(section.diagramIntent)),
      description: customerFacingText(section.diagramIntent),
      accessibleText: customerFacingText(section.diagramIntent),
    },
  }
}

export default { buildExpressionOnlyRevisionSection, isInternalRenderedExpressionText }
