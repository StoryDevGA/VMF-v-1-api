import { createHash } from 'node:crypto'
import { docxVisualReviewFixture, resealVisualReviewFixture } from './fixtures/docxVisualReviewFixture.js'
import { assertDocxVisualReviewTransport } from '../services/outcomeDocxVisualReviewContextService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

describe('exact DOCX visual review context; declared verified-owner seams', () => {
  test('keeps complete text, two-section profile, full method and five selected documents without a global fourteen-section rule', async () => {
    const f = docxVisualReviewFixture(), result = await f.transport()
    expect(result.context.candidate).toEqual(f.verified.document)
    expect(result.context.sourceExpression.sections).toHaveLength(2)
    expect(result.context.sourceExpression.sections[0].qualification).toBe('Access review is outstanding.')
    expect(result.context.methodDocument.chunks.map(chunk => chunk.text).join('')).toBe(f.methodContent)
    expect(result.context.selectedDocuments.map(item => item.content)).toEqual(Object.values(f.contents))
    expect(result.pages[0].equals(f.rendered.pages[0].buffer)).toBe(true)
    expect(JSON.stringify(result.context)).not.toContain(f.actorUserId)
    expect(result.contextFingerprint).toBe(membershipHash(result.context))
  })
  test.each([
    ['extra context key', t => { t.context.extra = 'unsupported' }],
    ['text substitution', t => { t.context.candidate = { ...t.context.candidate, markdown: 'Changed' } }],
    ['qualification loss', t => { t.context.sourceExpression.sections[0].qualification = '' }],
    ['method truncation', t => { t.context.methodDocument.chunks[0].text = 'Changed' }],
    ['profile truncation', t => { t.context.selectedDocuments[0].content = 'Changed' }],
    ['profile ordering', t => { t.context.selectedDocuments.reverse() }],
    ['page substitution', t => { t.pages[0] = Buffer.from('not saved PNG') }],
    ['page count', t => { t.pages.push(t.pages[0]) }],
    ['page number', t => { t.subject.preview.pages[0].number = 2 }],
    ['source mutation', t => { t.sourceEnvelope.source.content.approvedMeaning.state = 'REJECTED' }],
  ])('rejects %s', async (_label, mutate) => {
    const t = await docxVisualReviewFixture().transport(); mutate(t)
    expect(() => assertDocxVisualReviewTransport(t)).toThrow()
  })
  test('rejects unsafe exact customer text rather than silently redacting it', async () => {
    const f = docxVisualReviewFixture(); f.verified.document.markdown = 'Contact person@example.com to approve.'
    f.verified.candidateInput.markdown = f.verified.document.markdown; resealVisualReviewFixture(f)
    await expect(f.transport()).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
    expect(f.verified.document.markdown).toBe('Contact person@example.com to approve.')
  })
  test('rejects full unsafe selected guidance and method content', async () => {
    const f = docxVisualReviewFixture(), receipt = f.verified.candidate.selectedPacks.STYLE
    f.contents[receipt.packId] = '# Style\n\nContact person@example.com.'
    receipt.contentHash = `sha256:${createHash('sha256').update(f.contents[receipt.packId]).digest('hex')}`
    resealVisualReviewFixture(f)
    await expect(f.transport()).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
  })
  test('rejects stale live page receipt before constructing a provider request', async () => {
    const f = docxVisualReviewFixture(); f.preview.conversionFingerprint = 'f'.repeat(64)
    // Admission owner observes the same stale value, but UI expectation remains exact.
    await expect(f.transport()).rejects.toThrow()
  })
  test('resealing context after changing aliased document text cannot change the admitted stored input', async () => {
    const t = await docxVisualReviewFixture().transport()
    t.document.title = 'Altered paper'; t.document.markdown = 'Altered claim without qualifications.'
    t.contextFingerprint = membershipHash(t.context)
    expect(() => assertDocxVisualReviewTransport(t)).toThrow()
    t.candidateInput.model.title = t.document.title; t.candidateInput.markdown = t.document.markdown
    t.contextFingerprint = membershipHash(t.context)
    expect(() => assertDocxVisualReviewTransport(t)).toThrow()
  })
})
