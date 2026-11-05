import { test, expect } from '@jest/globals'
import JSZip from 'jszip'
import { governedDocxFixture } from './fixtures/governedDocxCandidateFixture.js'
import { buildGovernedPrivateDocxInput, compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { assertDocxSourceQualificationPresentation } from '../services/docxSourceQualificationPresentation.js'
import { renderProfessionalDocumentCandidate, parseProfessionalDocumentCandidateInput } from '../services/professionalDocumentCandidateRenderer.js'

test('qualification roles cover exact source-owned paragraphs without treating identical body prose as a constraint', async () => {
  const f = governedDocxFixture()
  f.shaping.sections[0].body = f.shaping.sections[0].qualification
  f.seal()
  const before = JSON.stringify(f), rendered = await compileGovernedPrivateDocxInput(f)
  expect(JSON.stringify(f)).toBe(before)
  const input = rendered.input, indices = assertDocxSourceQualificationPresentation(input)
  const blocks = parseProfessionalDocumentCandidateInput({ documentMetadata: input.documentMetadata, markdown: input.markdown }).parsed.blocks
  expect(indices).toHaveLength(14)
  expect(indices).not.toContain(1)
  input.model.sections.forEach((section, index) => {
    expect(section.qualificationMarkdown).toBe(f.shaping.sections[index].qualification)
    expect(section.bodyMarkdown).toBe(f.shaping.sections[index].body)
    expect(section.heading).toBe(f.shaping.sections[index].heading)
    expect(blocks[indices[index]].text).toBe(f.shaping.sections[index].qualification)
  })
  const zip = await JSZip.loadAsync(rendered.buffer), xml = await zip.file('word/document.xml').async('string')
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
  const boxed = paragraphs.filter(paragraph => paragraph.includes('<w:top ') && paragraph.includes('<w:bottom '))
  expect(boxed).toHaveLength(14)
  const repeated = paragraphs.filter(paragraph => paragraph.includes('Qualification 1: broader evidence is missing.'))
  expect(repeated).toHaveLength(2)
  expect(repeated[0]).not.toContain('<w:top ')
  expect(repeated[1]).toContain('<w:top ')
  expect(boxed.every(paragraph => paragraph.includes('Qualification '))).toBe(true)
  expect(input.markdown).toBe([`# ${input.model.title}`, ...f.shaping.sections.flatMap(section =>
    [`## ${section.heading}`, section.body, section.qualification])].join('\n\n'))
})

test('multiple qualification paragraphs retain complete ordered coverage and source paths', () => {
  const f = governedDocxFixture()
  f.shaping.sections[0].qualification += '\n\nA second material limit remains visible.'
  f.seal()
  const input = buildGovernedPrivateDocxInput(f)
  expect(assertDocxSourceQualificationPresentation(input)).toHaveLength(15)
  expect(input.presentation.qualificationCallouts.blocks.slice(0, 2).map(block => block.sourcePath))
    .toEqual(['shaping.sections[0].qualification', 'shaping.sections[0].qualification'])
})

test.each([
  ['missing receipt', input => { delete input.presentation.qualificationCallouts }],
  ['missing block', input => { input.presentation.qualificationCallouts.blocks.pop() }],
  ['duplicate block', input => { input.presentation.qualificationCallouts.blocks.push(input.presentation.qualificationCallouts.blocks[0]) }],
  ['shifted index', input => { input.presentation.qualificationCallouts.blocks[0].blockIndex-- }],
  ['string index', input => { input.presentation.qualificationCallouts.blocks[0].blockIndex = '4' }],
  ['array index', input => { input.presentation.qualificationCallouts.blocks[0].blockIndex = [4] }],
  ['foreign path', input => { input.presentation.qualificationCallouts.blocks[0].sourcePath = 'shaping.sections[0].body' }],
  ['wrong source hash', input => { input.presentation.qualificationCallouts.blocks[0].sourceFieldChecksum = 'sha256:' + 'a'.repeat(64) }],
  ['wrong block hash', input => { input.presentation.qualificationCallouts.blocks[0].blockFingerprint = 'sha256:' + 'a'.repeat(64) }],
  ['unknown block field', input => { input.presentation.qualificationCallouts.blocks[0].createdAt = 'ignored metadata' }],
  ['unknown receipt field', input => { input.presentation.qualificationCallouts.createdAt = 'ignored metadata' }],
  ['wrong role', input => { input.presentation.qualificationCallouts.role = 'QUOTATION' }],
  ['wrong visual', input => { input.presentation.qualificationCallouts.visualSystem.versionId = 'another-version' }],
  ['changed model qualification', input => { input.model.sections[0].qualificationMarkdown += ' Altered.' }],
  ['changed model body', input => { input.model.sections[0].bodyMarkdown += ' Altered.' }],
  ['changed Markdown', input => { input.markdown += '\n\nUnbound text.' }],
  ['wrong policy', input => { input.renderer.qualificationPolicy = 'UNSUPPORTED' }],
])('rejects %s rather than trusting a supplied role receipt', (_name, mutate) => {
  const input = buildGovernedPrivateDocxInput(governedDocxFixture())
  mutate(input)
  expect(() => assertDocxSourceQualificationPresentation(input)).toThrow()
})

test.each(['1. A numbered qualification.', '> A quoted qualification.', '## A heading qualification.', '| A | B |\n| --- | --- |\n| C | D |', '```\nCode\n```'])('unsupported qualification structure rejects without silently leaving it untreated', qualification => {
  const f = governedDocxFixture(); f.shaping.sections[0].qualification = qualification; f.seal()
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow()
})

test('the exact archived final qualification preserves its paragraph and bullet roles in callouts', async () => {
  const qualification = '**Historical source notes**\n\nThese limits apply only to quotations from the named source, not to user-provided intake.\n\n**Quotations from ss044-synthetic-pilot-r1.txt; controlled-synthetic-source-capture.docx**\n\n- The claim’s effective date, real-world currentness and measurement period are unknown. Capture or upload times do not establish when the claim was true.\n- At the time of this historical source note, a contradiction was unreviewed. The note does not decide that contradiction or carry forward an earlier formal finding.\n- Synthetic test material only; not a real customer case or evidence of real-world operations.\n- The fictional scenario is repeated unchanged from the earlier revision, with no new supporting-evidence change admitted. The repeated documents share authored synthetic provenance and are not independent corroboration.\n- Only the exact statement as presented by the source is supported. Acceptance and extraction validation in the application do not establish authenticity, independent verification, corroboration or business truth.\n\n**Quotations from ss044-synthetic-pilot-r1.txt**\n\n- The legacy text location is supported only by an exact match in the external frozen ledger. The application has no capture-span receipt.'
  const f = governedDocxFixture(); f.shaping.sections[13].qualification = qualification; f.seal()
  const rendered = await compileGovernedPrivateDocxInput(f), input = rendered.input
  const blocks = parseProfessionalDocumentCandidateInput({ documentMetadata: input.documentMetadata, markdown: input.markdown }).parsed.blocks
  const indices = assertDocxSourceQualificationPresentation(input)
  const last = indices.filter(index => input.presentation.qualificationCallouts.blocks.find(binding => binding.blockIndex === index).sourcePath === 'shaping.sections[13].qualification')
  expect(last.map(index => blocks[index].type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'bullet', 'bullet', 'bullet', 'bullet', 'bullet', 'paragraph', 'bullet'])
  expect(input.model.sections[13].qualificationMarkdown).toBe(qualification)
  const zip = await JSZip.loadAsync(rendered.buffer), xml = await zip.file('word/document.xml').async('string')
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
  const boxed = paragraphs.filter(paragraph => paragraph.includes('<w:top ') && paragraph.includes('<w:bottom '))
  expect(boxed).toHaveLength(23)
  const bullets = boxed.filter(paragraph => paragraph.includes('<w:numPr>'))
  expect(bullets).toHaveLength(6)
  expect(bullets.every(paragraph => paragraph.includes('w:hanging="180"') && paragraph.includes('w:left="540"'))).toBe(true)
  expect(boxed.some(paragraph => paragraph.includes('<w:b/>') && paragraph.includes('Historical source notes'))).toBe(true)
})

test.each([[-1], [0], [1, 1], [2, 1], ['1'], [[1]], [999], [NaN], Array(1)].map(indices => ({ indices })))('engine rejects invalid qualification indices %j', async ({ indices }) => {
  await expect(renderProfessionalDocumentCandidate({ documentMetadata: { title: 'Test', deliverableType: 'Document', versionNumber: 1, status: 'DRAFT' },
    markdown: '# Test\n\n## Heading\n\nBody.\n\n> Quote.', qualificationCalloutIndices: indices })).rejects.toThrow()
})
