// A rendering recipe, not a paraphraser: quoted statements and commentary are
// retained verbatim. Only separately repeated, exactly matched source text is
// omitted. The legacy expression recipe intentionally remains independent.
export const OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION = 'outcome-readable-expression.v2'

const headingLabels = Object.freeze({
  'executive-conclusion': 'Proposal and recorded position',
  'recommended-course-and-progression': 'Consideration and progression boundaries',
  'decisions-to-approve-and-withhold': 'Recorded support and permission boundaries',
})
const markerPattern = /Document statement from ([^:]+): (.+?) \(document qualifications (\d+) in Source and lineage record\): > |User-provided intake \(([^)]+)\): > |Document qualifications (\d+) — ([^:]+): (.+?) \(verbatim; applies only to quotations marked with this entry\): > /g
const trim = (value) => String(value ?? '').trim()
const paragraphs = (value) => trim(value).replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n')
const repeats = (section) => (section.keyMessages || []).slice(1).map((value) => ({
  original: trim(value),
  statement: trim(value).replace(/^Document [^:]+: /, ''),
  document: /^Document [^:]+: /.test(trim(value)),
  registerLabel: trim(value).match(/^Document ([^:]+): /)?.[1] || '',
}))

export const buildReadableExpressionSection = (section = {}, { sections = [] } = {}) => {
  if (!Array.isArray(section.keyMessages) || section.keyMessages.length < 1) {
    throw new TypeError('Readable expression requires the saved Narrative messages.')
  }
  const original = trim(section.keyMessages[0])
  const matches = [...original.matchAll(new RegExp(markerPattern.source, 'g'))]
  const remaining = repeats(section)
  const accounted = new Set()
  const usedSources = new Map()
  const mapping = []
  const blocks = []
  if (!matches.length) {
    // Unknown input remains visible in full; never infer a source or silently
    // discard commentary because it does not match this recipe's grammar.
    blocks.push(`Recorded narrative\n\n${paragraphs(original)}`)
  } else {
    const intro = original.slice(0, matches[0].index).trim()
    if (intro) blocks.push(`Review context\n\n${paragraphs(intro)}`)
    for (let index = 0; index < matches.length; index += 1) {
      const marker = matches[index]
      const tail = original.slice(marker.index + marker[0].length,
        index + 1 < matches.length ? matches[index + 1].index : original.length).trim()
      const isDocument = Boolean(marker[1])
      const isIntake = Boolean(marker[4])
      const match = remaining.filter((entry) => entry.document === isDocument
        && (!isDocument || entry.registerLabel === marker[1])
        && tail.startsWith(entry.statement)
        && (tail.length === entry.statement.length || /\s/.test(tail[entry.statement.length])))
        .sort((a, b) => b.statement.length - a.statement.length)[0]
      const statement = match ? match.statement : tail
      if (match) accounted.add(match.original)
      if (isDocument) {
        const source = trim(marker[2])
        const qualification = marker[3]
        const identity = JSON.stringify([source, qualification, marker[1]])
        usedSources.set(identity, { source, qualification, registerLabel: marker[1] })
        blocks.push(`Source quotation — ${source}\n\n> ${statement}`)
        mapping.push({ kind: 'SOURCE_QUOTATION', source, qualification, statement, exactRepeatedMessageRemoved: Boolean(match) })
      } else if (isIntake) {
        blocks.push(`User-provided intake — ${marker[4]}\n\n> ${statement}`)
        mapping.push({ kind: 'INTAKE', label: marker[4], statement, exactRepeatedMessageRemoved: Boolean(match) })
      } else {
        blocks.push(`Historical source qualifications — ${marker[7]}\n\nApplies only to quotations from this source. Verbatim historical wording; not a new current-review decision.\n\n${tail.split(' > ').map((item) => `- ${item}`).join('\n')}`)
        mapping.push({ kind: 'SOURCE_QUALIFICATIONS', source: marker[7], qualification: marker[5], statement: tail })
      }
      const commentary = match ? tail.slice(match.statement.length).trim() : ''
      if (commentary) blocks.push(`Review context\n\n${paragraphs(commentary)}`)
    }
  }
  for (const entry of remaining) {
    if (!accounted.has(entry.original)) blocks.push(`Additional recorded statement\n\n${paragraphs(entry.original)}`)
  }
  // Materialise the exact source qualifiers beside the rendered section. Shared
  // text can appear once only when every applicable source is named explicitly.
  // The full original historical catalogue also remains in its source section.
  const qualifierSources = new Map()
  for (const { source, qualification, registerLabel } of usedSources.values()) {
    const catalogues = sections.flatMap((item) => item.keyMessages || []).flatMap((message) => {
      const markers = [...String(message).matchAll(new RegExp(markerPattern.source, 'g'))]
      return markers.flatMap((marker, index) => marker[5] === qualification
        && marker[6] === registerLabel && marker[7] === source
        ? [String(message).slice(marker.index + marker[0].length, markers[index + 1]?.index ?? String(message).length).trim()]
        : [])
    })
    if (!catalogues.length || new Set(catalogues).size !== 1) {
      throw new TypeError(`Source qualification catalogue is unavailable or conflicting for ${source}.`)
    }
    for (const exactQualifier of catalogues[0].split(' > ')) {
      const sources = qualifierSources.get(exactQualifier) || []
      sources.push(`${source} (document qualifications ${qualification})`)
      qualifierSources.set(exactQualifier, sources)
    }
  }
  const grouped = new Map()
  for (const [qualifier, sources] of qualifierSources) {
    const key = sources.join('; ')
    grouped.set(key, [...(grouped.get(key) || []), qualifier])
  }
  const qualificationLines = [...grouped].map(([sources, qualifiers]) =>
    `${sources}:\n${qualifiers.map((value) => `- ${value}`).join('\n')}`)
  if (trim(section.qualification)) qualificationLines.push(trim(section.qualification))
  const qualification = qualificationLines.length
    ? `Historical source qualifications (verbatim; not current-review decisions). Applies only to the named source quotations, never user-provided intake.\n\n${qualificationLines.join('\n\n')}` : ''
  if (qualification.length > 2000) throw new TypeError('Readable source qualifications exceed the existing section limit.')
  return {
    heading: headingLabels[section.sectionKey] || trim(section.heading),
    body: blocks.join('\n\n'),
    qualification,
    diagram: { present: Boolean(trim(section.diagramIntent)), description: trim(section.diagramIntent), accessibleText: trim(section.diagramIntent) },
    mapping,
  }
}
