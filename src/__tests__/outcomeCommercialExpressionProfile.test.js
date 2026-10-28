import { jest } from '@jest/globals'
import { presentSourceQualification } from '../utils/outcomePresentationExpressionProfile.js'

const originals = [
  'Claim effective date, real-world currentness and measurement window are not established; capture/upload metadata is not an effective claim date.',
  'Disposable synthetic test only; this is not a customer case or evidence of real-world operations.',
  'Legacy text-source location is supported only by the external frozen ledger text match; no native capture span receipt exists.',
  'SOURCE_PRESENTED exact statement only. Native ACCEPTED and extraction VALIDATED statuses do not establish authenticity, independent verification, corroboration or business truth.',
  'Current R2 contradiction candidate contradiction_abc123 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.',
  'R1 fictional scenario reused unchanged in R2; no R2 changed-support delta is admitted. Repeated documents share authored synthetic provenance and are not independent corroboration.',
]
// Isolate the new presentation/contract owner; inherited strict grammar and the
// actual saved fourteen-section model are verified in their existing suites and
// offline candidate evidence, respectively. No persistence proof is claimed.
const structured = jest.fn((section) => ({
  heading: 'Recorded positions', diagram: { present: false, description: '', accessibleText: '' },
  typedBlocks: { body: [
    { kind: 'GROUP', text: 'Reading group: old signal.' },
    { kind: 'EXPLANATION', text: 'The question remains open; this paper grants no permission.' },
    { kind: 'LABEL', level: 3, text: 'Source quotation — source.txt' },
    { kind: 'SOURCE_QUOTATION', source: 'source.txt', text: 'Exact source statement.' },
    { kind: 'LABEL', level: 3, text: 'User-provided intake — Offer' },
    { kind: 'INTAKE', label: 'Offer', text: 'Offer: internal review' },
    { kind: 'DIAGRAM_STATUS', text: 'Diagram applicability: old note.' },
  ], qualification: [{ kind: 'LABEL', level: 3, text: 'Historical source notes' },
    { kind: 'SOURCE_LIMITS', source: 'source.txt', text: originals.map(presentSourceQualification).join('\n') }] },
  trace: { profileVersion: 'outcome-readable-expression.v4', originalKeyMessages: section.keyMessages,
    mappings: originals.map(original => ({ kind: 'QUALIFICATION_MAPPING', source: 'source.txt', original })) },
}))
jest.unstable_mockModule('../utils/outcomeStructuredExpressionProfile.js', () => ({ buildStructuredExpressionSection: structured }))
const { buildCommercialOutputContract, assertCommercialOutputContract, buildCommercialExpressionSection,
  getCommercialDiagramApplicability, COMMERCIAL_OUTPUT_SECTION_KEYS, OUTCOME_COMMERCIAL_CANDIDATE_TYPE } = await import('../utils/outcomeCommercialExpressionProfile.js')
const { buildReadableCommercialExpressionSection, OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION } = await import('../utils/outcomeReadableCommercialExpressionProfile.js')
const { buildGovernedCommercialExpressionSection } = await import('../utils/outcomeGovernedCommercialExpressionProfile.js')
const { buildDecisionLedCommercialExpressionSection } = await import('../utils/outcomeDecisionLedCommercialExpressionProfile.js')
const roles = ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM']
const packKeys = ['commercial-strategy-and-decision-paper', 'commercial-strategy-and-decision-paper-schema', 'selected-style', 'selected-visual']
const plan = () => ({ requestedOutputTypeKey: packKeys[0], payload: {
  consumerIntent: { requestedOutputTypeKey: packKeys[0], compositionResolution: { request: { requestedStyleKey: packKeys[2], visualSystemKey: packKeys[3] } } },
  resolution: { selectedPacks: roles.map((packType, index) => ({ packType, packId: `kp-${packKeys[index]}`, packKey: packKeys[index], versionId: `kpv-${packKeys[index]}-1-0-0`, semanticVersion: '1.0.0', contentHash: `sha256:${String(index).repeat(64)}`, lifecycleStatus: 'ACTIVE' })) },
} })
const sections = () => COMMERCIAL_OUTPUT_SECTION_KEYS.map((sectionKey, index) => ({ sectionKey, order: index + 1, keyMessages: ['Original commentary.'], diagramIntent: '' }))

describe('selected Commercial expression contract', () => {
  it('new recipe distinguishes quotation, intake and scoped warning roles without changing mappings or source text', () => {
    const all = sections(), before = JSON.stringify(all)
    const old = buildReadableCommercialExpressionSection(all[4], { sections: all })
    const result = buildGovernedCommercialExpressionSection(all[4], { sections: all })
    expect(result.body).toContain('> Exact source statement.')
    expect(result.body).toContain('- Offer: internal review')
    expect(result.body).not.toContain('> Offer: internal review')
    expect(result.body).toContain('> **Source note**\n> Applies to source.txt quotations:')
    expect(result.trace.mappings).toEqual(old.trace.mappings)
    expect(result.trace.originalKeyMessages).toEqual(old.trace.originalKeyMessages)
    expect(result.heading).toBe(old.heading)
    expect(result.qualification).toBe(old.qualification)
    expect(JSON.stringify(all)).toBe(before)
  })
  it('derives the fourteen-section contract and exact four selected pack descriptors without Executive Brief criteria', () => {
    const source = plan(), before = JSON.stringify(source), result = buildCommercialOutputContract({ plan: source })
    expect(result.sections).toEqual(COMMERCIAL_OUTPUT_SECTION_KEYS)
    expect(result.packs.map(pack => pack.packType)).toEqual(roles)
    expect(Object.keys(result)).toHaveLength(6)
    expect(result.packs.every(pack => Object.keys(pack).length === 6)).toBe(true)
    expect(OUTCOME_COMMERCIAL_CANDIDATE_TYPE).toBe('COMMERCIAL_STRATEGY_AND_DECISION_PAPER')
    expect(JSON.stringify(result)).not.toMatch(/executive.brief/i)
    expect(assertCommercialOutputContract(result, { plan: source })).toBe(result)
    expect(JSON.stringify(source)).toBe(before)
  })
  it.each([
    ['missing role', source => source.payload.resolution.selectedPacks.pop()],
    ['ambiguous role', source => source.payload.resolution.selectedPacks.push(source.payload.resolution.selectedPacks[0])],
    ['inactive role', source => { source.payload.resolution.selectedPacks[0].lifecycleStatus = 'DRAFT' }],
    ['other output type', source => { source.requestedOutputTypeKey = 'executive-brief' }],
    ['unbound style', source => { source.payload.consumerIntent.compositionResolution.request.requestedStyleKey = 'other-style' }],
    ['unbound visual', source => { source.payload.consumerIntent.compositionResolution.request.visualSystemKey = 'other-visual' }],
  ])('rejects %s', (_label, mutate) => { const source = plan(); mutate(source); expect(() => buildCommercialOutputContract({ plan: source })).toThrow('Commercial output contract') })
  it('rejects additional fields, stale pins, changed order and descriptor substitutions', () => {
    const source = plan(), original = buildCommercialOutputContract({ plan: source })
    for (const mutate of [
      value => { value.extra = true }, value => { value.packs[0].extra = true },
      value => { value.packs[0].contentHash = `sha256:${'f'.repeat(64)}` },
      value => { value.packs[0].packId = 'other-pack' },
      value => { value.packs[0].packId += String.fromCharCode(1) },
      value => { value.packs[0].semanticVersion = 'not-a-version' },
      value => { value.sections.reverse() }, value => { value.packs.reverse() },
    ]) { const value = structuredClone(original); mutate(value); expect(() => assertCommercialOutputContract(value, { plan: source })).toThrow() }
  })
  it('keeps one absent-diagram sentence in metadata and never in business prose', () => {
    const all = sections(), result = buildCommercialExpressionSection(all[0], { sections: all })
    expect(getCommercialDiagramApplicability(all)).toBe('No diagrams are used in this document.')
    expect(result.trace.diagramApplicability).toBe('No diagrams are used in this document.')
    expect(result.body).not.toMatch(/Diagram applicability|No diagrams|Reading group/)
    all[0].diagramIntent = 'A specified relationship.'
    expect(getCommercialDiagramApplicability(all)).toBe('Diagrams are described in the sections where they are specified.')
    expect(() => getCommercialDiagramApplicability([])).toThrow()
  })
  it('places the complete material source limit directly after its own exact quotation and keeps intake separate', () => {
    const all = sections(), result = buildCommercialExpressionSection(all[4], { sections: all })
    expect(result.body).toMatch(/> Exact source statement\.\n\nSource limit: Verbatim synthetic quotation/)
    expect(result.body).toContain('Authenticity and business truth are unverified')
    expect(result.body).toContain('Claim date/currentness/measurement are unknown')
    expect(result.body).toContain('capture/upload is not a claim date')
    expect(result.body).toContain('neither new support nor independent corroboration')
    expect(result.body).toContain('no application capture-span receipt')
    expect(result.body).toContain('### User-provided intake — Offer\n\n> Offer: internal review')
    expect(result.qualification).toBe('')
    expect(result.trace.mappings[4].original).toBe(originals[4])
    expect(result.body).not.toContain('contradiction_abc123')
  })
  it('retains full historical source notes in the catalogue, without changing source messages', () => {
    const all = sections(), before = JSON.stringify(all), result = buildCommercialExpressionSection(all[13], { sections: all })
    expect(result.qualification).toContain('At the time of this historical source note')
    expect(result.qualification).toContain('does not decide that contradiction')
    expect(JSON.stringify(all)).toBe(before)
    expect(result.trace.originalKeyMessages).toEqual(all[13].keyMessages)
  })
  it('fails closed when a new or unknown source qualification would be lost', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementationOnce(section => ({ ...base(section), trace: { mappings: [{ kind: 'QUALIFICATION_MAPPING', source: 'source.txt', original: 'Unknown qualification.' }] } }))
    const all = sections()
    expect(() => buildCommercialExpressionSection(all[0], { sections: all })).toThrow('does not recognise a source qualification')
  })
})

describe('readable Commercial expression v2', () => {
  it('uses bold labels, preserves exact statements and mappings, and leaves v1 output identical', () => {
    const all = sections(), before = JSON.stringify(all)
    const previous = buildCommercialExpressionSection(all[4], { sections: all })
    const result = buildReadableCommercialExpressionSection(all[4], { sections: all })
    expect(result.trace.profileVersion).toBe(OUTCOME_COMMERCIAL_READABLE_EXPRESSION_PROFILE_VERSION)
    expect(result.body).toContain('**Source: source.txt**\n\n> Exact source statement.')
    expect(result.body).toContain('**Intake: Offer**\n\n> Offer: internal review')
    expect(result.body).not.toMatch(/^#{3,}/m)
    expect(result.trace.mappings).toEqual(previous.trace.mappings)
    expect(result.trace.originalKeyMessages).toEqual(previous.trace.originalKeyMessages)
    expect(buildCommercialExpressionSection(all[4], { sections: all })).toEqual(previous)
    expect(JSON.stringify(all)).toBe(before)
  })
  it('consolidates only shared limits in an uninterrupted source run, scoping the unique locator to its source', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementationOnce(section => {
      const result = base(section)
      result.typedBlocks.body.splice(4, 0,
        { kind: 'LABEL', level: 3, text: 'Source quotation — source.docx' },
        { kind: 'SOURCE_QUOTATION', source: 'source.docx', text: 'Second exact statement.' })
      result.trace.mappings.push(...originals.filter(value => !value.startsWith('Legacy text-source location'))
        .map(original => ({ kind: 'QUALIFICATION_MAPPING', source: 'source.docx', original })))
      return result
    })
    const all = sections(), result = buildReadableCommercialExpressionSection(all[4], { sections: all })
    expect(result.typedBlocks.body.filter(block => block.kind === 'SOURCE_LIMIT')).toHaveLength(1)
    expect(result.body).toContain('For source.txt and source.docx quotations only:')
    expect(result.body).toContain('For source.txt quotations only: Location: external frozen-ledger match only; no application capture-span receipt.')
    expect(result.body).not.toContain('For source.docx quotations only: Location:')
    expect(result.body.indexOf('no application capture-span receipt.')).toBeLessThan(result.body.indexOf('**Intake: Offer**'))
    expect(result.body).toContain('> Second exact statement.')
    expect(result.trace.quotationRuns[0].quotationCount).toBe(2)
  })
  it('flushes notes before intake and commentary rather than applying source limits across either boundary', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementationOnce(section => {
      const result = base(section)
      result.typedBlocks.body.push(
        { kind: 'LABEL', level: 3, text: 'Source quotation — source.txt' },
        { kind: 'SOURCE_QUOTATION', source: 'source.txt', text: 'Third exact statement.' },
        { kind: 'EXPLANATION', text: 'Unchanged commentary.' })
      return result
    })
    const all = sections(), result = buildReadableCommercialExpressionSection(all[4], { sections: all })
    expect(result.trace.quotationRuns.map(run => run.quotationCount)).toEqual([1, 1])
    const body = result.typedBlocks.body
    expect(body[body.findIndex(block => block.kind === 'INTAKE') - 1].text).toBe('Intake: Offer')
    expect(body[body.findIndex(block => block.text === 'Unchanged commentary.') - 1].kind).toBe('SOURCE_LIMIT')
    expect(result.body).toContain('> Third exact statement.')
  })
  it('keeps the full historical catalogue, separates its labels from heading hierarchy and preserves its exact trace', () => {
    const all = sections(), previous = buildCommercialExpressionSection(all[13], { sections: all })
    const result = buildReadableCommercialExpressionSection(all[13], { sections: all })
    expect(result.qualification).toContain('**Historical source notes**')
    expect(result.qualification).toContain('At the time of this historical source note')
    expect(result.trace.mappings).toEqual(previous.trace.mappings)
    expect(result.diagram).toEqual(previous.diagram)
    expect(result.qualification.replace('**Historical source notes**', '### Historical source notes')).toBe(previous.qualification)
  })
  it('fails closed on unknown qualifications or a quotation without its source qualifications', () => {
    const base = structured.getMockImplementation(), all = sections()
    structured.mockImplementationOnce(section => ({ ...base(section), trace: { mappings: [{ kind: 'QUALIFICATION_MAPPING', source: 'source.txt', original: 'Unknown qualification.' }] } }))
    expect(() => buildReadableCommercialExpressionSection(all[0], { sections: all })).toThrow()
    structured.mockImplementationOnce(section => ({ ...base(section), trace: { mappings: [] } }))
    expect(() => buildReadableCommercialExpressionSection(all[0], { sections: all })).toThrow()
  })
})

describe('decision-led Commercial expression v4', () => {
  const build = (section, all) => buildDecisionLedCommercialExpressionSection(section, { sections: all })
  it('relocates the exact supported opening sentence, preserves quotation/intake and leaves v3 unchanged', () => {
    const all = sections(), before = JSON.stringify(all), old = buildGovernedCommercialExpressionSection(all[4], { sections: all })
    const result = build(all[4], all)
    expect(result.heading).toBe('The question remains open; this paper grants no permission.')
    expect(result.body).not.toContain(result.heading)
    expect(result.body).toContain('> Exact source statement.')
    expect(result.body).toContain('- Offer: internal review')
    expect(result.body).not.toContain('> **Source note**')
    expect(result.body).not.toContain('Authenticity and business truth')
    expect(result.qualification).toContain('Quotation limits apply only to: source.txt.')
    expect(result.qualification).toContain('final section’s historical source notes')
    expect(result.qualification).toContain('User-provided intake remains separate')
    expect(result.trace.mappings).toEqual(old.trace.mappings)
    expect(result.trace.originalKeyMessages).toEqual(old.trace.originalKeyMessages)
    expect(result.trace.headingPlacement.originalExplanation).toBe(result.heading)
    expect(result.trace.profileVersion).toBe('outcome-commercial-expression.v4')
    expect(result.trace.sourceProfileVersion).toBe('outcome-commercial-expression.v3')
    expect(buildGovernedCommercialExpressionSection(all[4], { sections: all })).toEqual(old)
    expect(JSON.stringify(all)).toBe(before)
  })
  it('keeps every remaining explanation word and the full final source catalogue visible', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementation(section => {
      const value = base(section)
      value.typedBlocks.body.find(block => block.kind === 'EXPLANATION').text = 'The proposal remains conditional. It grants no permission, demonstrates no benefit and does not waive access review.'
      return value
    })
    try {
      const all = sections(), catalogue = buildGovernedCommercialExpressionSection(all[13], { sections: all })
      const current = build(all[4], all), final = build(all[13], all)
      expect(current.heading).toBe('The proposal remains conditional.')
      expect(current.body).toContain('It grants no permission, demonstrates no benefit and does not waive access review.')
      expect(final.qualification).toBe(catalogue.qualification)
      expect(final.qualification).toContain('At the time of this historical source note')
      expect(final.qualification).toContain('does not decide that contradiction')
      expect(final.trace.mappings).toEqual(catalogue.trace.mappings)
    } finally { structured.mockImplementation(base) }
  })
  it('retains all 109 qualification links rather than replacing evidence mappings with presentation summaries', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementation(section => {
      const value = base(section), original = value.trace.mappings
      value.trace.mappings = Array.from({ length: 109 }, (_, index) => ({ ...original[index % original.length] }))
      return value
    })
    try {
      const all = sections(), result = build(all[4], all)
      expect(result.trace.mappings).toHaveLength(109)
      expect(result.trace.mappings.every(row => originals.includes(row.original) && row.source === 'source.txt')).toBe(true)
      expect(result.qualification).not.toContain('contradiction_abc123')
    } finally { structured.mockImplementation(base) }
  })
  it('rejects consolidation when the final catalogue omits a source qualification', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementation(section => {
      const value = base(section)
      if (section.sectionKey === 'source-and-lineage-record') value.trace.mappings = value.trace.mappings.slice(1)
      return value
    })
    try { const all = sections(); expect(() => build(all[4], all)).toThrow('preserve the source qualification catalogue') }
    finally { structured.mockImplementation(base) }
  })
  it.each(['No sentence boundary', `${'Long '.repeat(60)}sentence.`])('rejects a heading that would need invention or truncation: %s', explanation => {
    const base = structured.getMockImplementation()
    structured.mockImplementation(section => {
      const value = base(section); value.typedBlocks.body.find(block => block.kind === 'EXPLANATION').text = explanation; return value
    })
    try { const all = sections(); expect(() => build(all[4], all)).toThrow('preserve the source qualification catalogue') }
    finally { structured.mockImplementation(base) }
  })
  it('preserves an applicable diagram instead of imposing a global no-diagrams policy', () => {
    const base = structured.getMockImplementation()
    structured.mockImplementation(section => ({ ...base(section), diagram: { present: true, description: 'Recorded dependency relationship.', accessibleText: 'Access review is a recorded condition, not approval.' } }))
    try {
      const all = sections(), result = build(all[4], all)
      expect(result.diagram).toEqual({ present: true, description: 'Recorded dependency relationship.', accessibleText: 'Access review is a recorded condition, not approval.' })
    } finally { structured.mockImplementation(base) }
  })
})
