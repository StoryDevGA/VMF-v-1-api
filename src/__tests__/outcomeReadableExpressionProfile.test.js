import { buildReadableExpressionSection, OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION } from '../utils/outcomeRenderedExpressionRevision.js'

const qualification = 'Capture time is not a claim effective date.'
const catalogue = { keyMessages: [`Document qualifications 7 — Register Label: source.txt (verbatim; applies only to quotations marked with this entry): > ${qualification}`] }
const sourceSection = (extra = {}) => ({
  sectionKey: 'executive-conclusion', heading: 'Executive conclusion',
  keyMessages: [
    'A possible trial is not permission. Document statement from Register Label: source.txt (document qualifications 7 in Source and lineage record): > Access review remains outstanding. User-provided intake (Offer): > Offer: limited trial',
    'Document Register Label: Access review remains outstanding.', 'Offer: limited trial',
  ],
  qualification: '', diagramIntent: '', ...extra,
})
const render = (section) => buildReadableExpressionSection(section, { sections: [section, catalogue] })

describe(OUTCOME_READABLE_EXPRESSION_PROFILE_VERSION, () => {
  it('separates intact commentary, exact source quotation and intake, without a prescriptive heading', () => {
    const result = render(sourceSection())
    expect(result.heading).toBe('Proposal and recorded position')
    expect(result.body).toContain('A possible trial is not permission.')
    expect(result.body).toContain('Source quotation — source.txt\n\n> Access review remains outstanding.')
    expect(result.body).toContain('User-provided intake — Offer\n\n> Offer: limited trial')
    expect(result.body.match(/Access review remains outstanding\./g)).toHaveLength(1)
    expect(result.qualification).toContain('only to the named source quotations, never user-provided intake.')
    expect(result.qualification).toContain(qualification)
    expect(result.body).not.toContain('Qualification: document qualifications')
  })
  it('retains unrecognised content and non-identical repeated claims instead of dropping or paraphrasing them', () => {
    const section = sourceSection({ keyMessages: ['A novel unknown format with governance and ARL.', 'Document Register Label: A different claim.'] })
    const result = render(section)
    expect(result.body).toContain('A novel unknown format with governance and ARL.')
    expect(result.body).toContain('Document Register Label: A different claim.')
    expect(result.mapping).toEqual([])
  })
  it('never removes a changed restriction or an unmatched intake statement', () => {
    const section = sourceSection()
    section.keyMessages.push('Document Register Label: Access review is complete.', 'Offer: production trial',
      'Document Other Label: Access review remains outstanding.')
    const result = render(section)
    expect(result.body).toContain('Access review is complete.')
    expect(result.body).toContain('Offer: production trial')
    expect(result.body).toContain('Document Other Label: Access review remains outstanding.')
  })
  it('preserves historical qualification text without reclassifying it as a current decision', () => {
    const section = { ...sourceSection(), keyMessages: catalogue.keyMessages }
    const result = render(section)
    expect(result.body).toContain(qualification)
    expect(result.body).toContain('Verbatim historical wording; not a new current-review decision.')
  })
  it('retains commentary after an exactly matched quote and rejects a missing qualification catalogue', () => {
    const section = sourceSection()
    section.keyMessages[0] += ' This is not adopted approval.'
    expect(render(section).body).toContain('This is not adopted approval.')
    expect(() => buildReadableExpressionSection(section)).toThrow('catalogue is unavailable')
    expect(() => buildReadableExpressionSection(section, { sections: [{ keyMessages: [
      'Document qualifications 7 — Register Label: unrelated.txt (verbatim; applies only to quotations marked with this entry): > Limits. Document qualifications 8 — Register Label: source.txt (verbatim; applies only to quotations marked with this entry): > Other limits.',
    ] }] })).toThrow('catalogue is unavailable')
  })
  it('keeps same-text quotations separately attributed when two sources contain them', () => {
    const section = sourceSection({ keyMessages: [
      'Document statement from Register Label: source.txt (document qualifications 7 in Source and lineage record): > Same statement. Document statement from Register Label: other.txt (document qualifications 8 in Source and lineage record): > Same statement.',
      'Document Register Label: Same statement.',
    ] })
    const second = { keyMessages: ['Document qualifications 8 — Register Label: other.txt (verbatim; applies only to quotations marked with this entry): > Other limitations.'] }
    const result = buildReadableExpressionSection(section, { sections: [catalogue, second] })
    expect(result.body.match(/> Same statement\./g)).toHaveLength(2)
    expect(result.body).toContain('Source quotation — other.txt')
  })
  it('does not mutate its source or diagram meaning', () => {
    const section = sourceSection({ diagramIntent: 'An unresolved question, not an approval.' })
    const before = JSON.stringify(section)
    expect(render(section).diagram).toEqual({ present: true, description: section.diagramIntent, accessibleText: section.diagramIntent })
    expect(JSON.stringify(section)).toBe(before)
  })
  it('fails closed if verbatim qualification material cannot fit or catalogues conflict', () => {
    const section = sourceSection()
    const huge = { keyMessages: [catalogue.keyMessages[0].replace(qualification, 'X'.repeat(2100))] }
    expect(() => buildReadableExpressionSection(section, { sections: [huge] })).toThrow('existing section limit')
    const conflict = { keyMessages: [catalogue.keyMessages[0].replace(qualification, 'Different restriction.')] }
    expect(() => buildReadableExpressionSection(section, { sections: [catalogue, conflict] })).toThrow('conflicting')
  })
})
