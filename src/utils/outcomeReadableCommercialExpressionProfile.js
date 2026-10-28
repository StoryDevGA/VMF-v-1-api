import { buildCommercialExpressionSection } from './outcomeCommercialExpressionProfile.js'
import { presentSourceQualification } from './outcomePresentationExpressionProfile.js'

export const OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION = 'outcome-commercial-expression.v2'

// These are presentation equivalents of the recognised source qualifications,
// not a classifier for arbitrary evidence. The full original notes stay in the
// inherited trace and historical catalogue.
const localRules = [
  [value => value.startsWith('Disposable synthetic test only;'), 'Synthetic only; not real-customer or operations evidence.'],
  [value => value.startsWith('SOURCE_PRESENTED exact statement only.'), 'Exact source statements only; authenticity, independent verification and business truth unverified.'],
  [value => value.startsWith('Claim effective date,'), 'Claim date/currentness/measurement unknown; capture/upload time is not a claim date.'],
  [value => /^R\d+ fictional scenario reused unchanged/.test(value), 'Unchanged authored copies add no new support or independent corroboration.'],
  [value => value.startsWith('Legacy text-source location'), 'Location: external frozen-ledger match only; no application capture-span receipt.'],
]
const render = block => block.kind === 'LABEL' ? `**${block.text}**`
  : ['SOURCE_QUOTATION', 'INTAKE'].includes(block.kind) ? `> ${block.text}` : block.text
const fail = () => { throw new TypeError('Readable Commercial expression cannot bind the source quotation qualifications.') }
const label = block => ({ ...block, text: block.text
  .replace(/^Source quotation — /, 'Source: ')
  .replace(/^User-provided intake — /, 'Intake: '), level: undefined })

export const buildReadableCommercialExpressionSection = (section, { sections = [] } = {}) => {
  const prior = buildCommercialExpressionSection(section, { sections })
  const originalNotes = new Map()
  for (const mapping of prior.trace.mappings.filter(item => item.kind === 'QUALIFICATION_MAPPING')) {
    presentSourceQualification(mapping.original)
    originalNotes.set(mapping.source, [...new Set([...(originalNotes.get(mapping.source) || []), mapping.original])])
  }
  const body = [], runs = []
  let sourceRun = []
  const flush = () => {
    if (!sourceRun.length) return
    const sources = [...new Set(sourceRun.map(block => block.source))]
    if (sources.some(source => !originalNotes.has(source))) fail()
    const grouped = new Map()
    for (const [matches, note] of localRules) {
      const applicable = sources.filter(source => originalNotes.get(source).some(matches))
      if (!applicable.length) continue
      const key = JSON.stringify(applicable)
      const entry = grouped.get(key) || { sources: applicable, notes: [] }
      entry.notes.push(note)
      grouped.set(key, entry)
    }
    if (!grouped.size) fail()
    const notes = [...grouped.values()]
    const text = notes.map(entry => `For ${entry.sources.join(' and ')} quotations only: ${entry.notes.join(' ')}`).join('\n\n')
    body.push({ kind: 'SOURCE_LIMIT', sources, text })
    runs.push({ sources, notes, quotationCount: sourceRun.length })
    sourceRun = []
  }
  for (let index = 0; index < prior.typedBlocks.body.length; index += 1) {
    const block = prior.typedBlocks.body[index]
    if (block.kind === 'SOURCE_LIMIT') continue
    if (block.kind === 'LABEL' && prior.typedBlocks.body[index + 1]?.kind === 'SOURCE_QUOTATION') {
      body.push(label(block))
    } else if (block.kind === 'SOURCE_QUOTATION') {
      body.push({ ...block })
      sourceRun.push(block)
    } else {
      flush()
      body.push(block.kind === 'LABEL' ? label(block) : { ...block })
    }
  }
  flush()
  const qualifications = prior.typedBlocks.qualification.map(block => block.kind === 'LABEL' ? label(block) : { ...block })
  const renderedBody = body.map(render).join('\n\n')
  const qualification = qualifications.map(render).join('\n\n')
  if (renderedBody.length > 24000 || qualification.length > 2000) {
    throw new TypeError('Readable Commercial expression exceeds existing section limits.')
  }
  return {
    heading: prior.heading.replace(' — ', ': '), body: renderedBody, qualification, diagram: prior.diagram,
    typedBlocks: { body, qualification: qualifications },
    trace: { ...prior.trace, profileVersion: OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION,
      sourceProfileVersion: prior.trace.profileVersion, quotationRuns: runs },
  }
}
