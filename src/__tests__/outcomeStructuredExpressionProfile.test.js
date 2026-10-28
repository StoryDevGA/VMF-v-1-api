import { jest } from '@jest/globals'

// These tests isolate v4 presentation structure. The real v3 grammar, actual
// fourteen-section source and real candidate/model are separately verified.
const actual = await import('../utils/outcomePresentationExpressionProfile.js')
const originals = [
  'Claim effective date, real-world currentness and measurement window are not established; capture/upload metadata is not an effective claim date.',
  'Disposable synthetic test only; this is not a customer case or evidence of real-world operations.',
  'Legacy text-source location is supported only by the external frozen ledger text match; no native capture span receipt exists.',
  'SOURCE_PRESENTED exact statement only. Native ACCEPTED and extraction VALIDATED statuses do not establish authenticity, independent verification, corroboration or business truth.',
  'Current R2 contradiction candidate contradiction_abc123 is UNREVIEWED. These qualifications do not adjudicate it or inherit the exact R1 formal finding.',
  'R1 fictional scenario reused unchanged in R2; no R2 changed-support delta is admitted. Repeated documents share authored synthetic provenance and are not independent corroboration.',
]
const prior = jest.fn((section) => ({
  diagram: { present: Boolean(section.diagramIntent), description: section.diagramIntent, accessibleText: section.diagramIntent },
  typedBlocks: [
    { kind: 'EXPLANATION', text: 'The proposal remains under consideration; no permission is granted.' },
    { kind: 'SOURCE_QUOTATION', source: 'text.txt', text: 'Exact source observation.' },
    { kind: 'SOURCE_QUOTATION', source: 'document.docx', text: 'Other exact source observation.' },
    { kind: 'INTAKE', label: 'Offer', text: 'Offer: internal review' },
  ],
  trace: { profileVersion: actual.OUTCOME_PRESENTATION_EXPRESSION_PROFILE_VERSION,
    originalKeyMessages: section.keyMessages,
    mappings: originals.flatMap(original => [
      { kind: 'QUALIFICATION_MAPPING', source: 'text.txt', original },
      ...(original.includes('Legacy text-source') ? [] : [{ kind: 'QUALIFICATION_MAPPING', source: 'document.docx', original }]),
    ]),
  },
}))
jest.unstable_mockModule('../utils/outcomePresentationExpressionProfile.js', () => ({ ...actual, buildPresentationExpressionSection: prior }))
const { buildStructuredExpressionSection, OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION } = await import('../utils/outcomeStructuredExpressionProfile.js')
const keys = ['title-and-decision-context', 'executive-conclusion', 'decision-requested', 'current-reality-and-evidence-state', 'commercial-diagnosis', 'decision-boundaries', 'value-and-economic-pathways', 'target-context-and-stakeholders', 'recommended-course-and-progression', 'risks-and-guardrails', 'decisions-to-approve-and-withhold', 'confidence-and-evidence-requirements', 'next-legal-downstream-action', 'source-and-lineage-record']
const source = () => keys.map((sectionKey, index) => ({ order: index + 1, sectionKey, keyMessages: ['Exact original message.'], diagramIntent: '' }))
const render = (sections = source()) => sections.map(section => buildStructuredExpressionSection(section, { sections }))

describe(OUTCOME_STRUCTURED_EXPRESSION_PROFILE_VERSION, () => {
  it('carries actual Markdown roles in the canonical body and keeps exact quotations/intake distinct', () => {
    const section = render()[1]
    expect(section.body).toContain('### Source quotation — text.txt\n\n> Exact source observation.')
    expect(section.body).toContain('### User-provided intake — Offer\n\n> Offer: internal review')
    expect(section.qualification).toContain('### Source limits at this point')
    expect(section.qualification).toContain('#### Quotations from text.txt; document.docx')
    expect(section.body).not.toContain('### Interpretation')
    expect(section.body).not.toContain('Review context')
  })
  it('uses fourteen distinct role-specific headings and four literal reading-group scopes, without false parent markup', () => {
    const result = render()
    expect(new Set(result.map(section => section.heading)).size).toBe(14)
    expect(result.filter(section => section.body.includes('Reading group:'))).toHaveLength(4)
    expect(result.every(section => !section.body.includes('### Reading group:'))).toBe(true)
  })
  it('gives one explicit no-diagrams statement and leaves every diagram field false and empty', () => {
    const result = render()
    expect(result.filter(section => section.body.includes('Diagram applicability:'))).toHaveLength(1)
    expect(result[0].body).toContain('no diagrams are specified for any of the fourteen sections')
    expect(result.every(section => section.diagram.present === false && section.diagram.description === '')).toBe(true)
  })
  it('does not declare diagrams absent if the source specifies one, and preserves its description', () => {
    const sections = source(); sections[3].diagramIntent = 'An open consideration question.'
    const result = render(sections)
    expect(result[0].body).not.toContain('no diagrams are specified')
    expect(result[3].body).toContain('Specified diagram: An open consideration question.')
    expect(result[3].diagram.accessibleText).toBe('An open consideration question.')
  })
  it('keeps material source limits locally self-contained and the text locator scoped only to its own source', () => {
    const result = render()[4]
    expect(result.qualification).not.toContain('§14')
    expect(result.qualification).toContain('Dates, currentness and measurement are unknown; capture/upload time is not a claim date.')
    expect(result.qualification).toContain('Synthetic only; not real-customer/operations evidence.')
    expect(result.qualification).toContain('authenticity, independent verification or business truth')
    expect(result.qualification).toContain('no new support or independent corroboration')
    expect(result.qualification).toContain('#### Quotations from text.txt\n\nLegacy text location:')
    expect(result.qualification).not.toMatch(/Quotations from text.txt; document.docx\n\nLegacy text location/)
    expect(result.qualification).toContain('not to user-provided intake')
  })
  it('preserves full historical qualification meaning and exact originals without implying a fresh current decision', () => {
    const result = render()
    expect(result[13].qualification).toContain('At the time of this historical source note')
    expect(result[13].qualification).toContain('does not decide that contradiction or carry forward an earlier formal finding')
    expect(result.every(section => !section.body.includes('contradiction_abc123') && !section.qualification.includes('UNREVIEWED'))).toBe(true)
    expect(result[13].trace.mappings).toEqual(expect.arrayContaining([expect.objectContaining({ original: originals[4] })]))
  })
  it('rejects reordered, incomplete or unknown templates without changing the input', () => {
    const sections = source(), before = JSON.stringify(sections)
    render(sections)
    expect(JSON.stringify(sections)).toBe(before)
    expect(() => render(sections.slice(1))).toThrow('exact fourteen-section')
    const reordered = source(); [reordered[0], reordered[1]] = [reordered[1], reordered[0]]
    expect(() => render(reordered)).toThrow('exact fourteen-section')
    expect(() => buildStructuredExpressionSection({ sectionKey: 'unknown' }, { sections })).toThrow('does not recognise')
  })
  it('fails closed on unknown qualification grammar and existing size overflow', () => {
    prior.mockImplementationOnce(section => ({
      ...prior.getMockImplementation()(section),
      trace: { mappings: [{ kind: 'QUALIFICATION_MAPPING', source: 'text.txt', original: 'Unknown qualification.' }] },
    }))
    expect(() => render()).toThrow('does not recognise a source qualification')
    const base = prior.getMockImplementation()
    prior.mockImplementationOnce(section => ({ ...base(section), typedBlocks: [{ kind: 'EXPLANATION', text: 'X'.repeat(24001) }] }))
    expect(() => render()).toThrow('existing section limits')
  })
})
