import { describe, expect, test, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { buildOutcomeMethodDocument, loadOutcomeMethodDocument, assertOutcomeMethodDocument, readOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt, buildOutcomeMethodDocumentBoundaryReceipt, assertOutcomeMethodContextBudget } from '../services/outcomeMethodDocumentService.js'
import { assertNoMethodDocumentContentInEvidence } from '../services/governedReasoningRuntimeService.js'

const fixture = (role = 'ARL', suffix = 'first') => {
  const content = `---\r\npackType: ${role}\r\ncapabilityKey: ${role.toLowerCase()}\r\nversion: 9.7\r\nstatus: DRAFT\r\nboundary: FRAMEWORK_RUNTIME_REASONING\r\n---\r\n# Meaning ${suffix}\r\n\r\n| Condition | Restriction |\r\n| --- | --- |\r\n| Unknown | Do not claim proof |\r\n\r\n${'Preserve uncertainty. 😀\r\n'.repeat(800)}Final exception: never manufacture authority.\r\n`
  const selection = { packId: `pack-${suffix}`, packKey: `arbitrary-name-${suffix}`, versionId: `version-${suffix}`, semanticVersion: '2.0.0', contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`, contentFormat: 'MARKDOWN', status: 'ACTIVE', activationId: 'active-selection', packType: role, capabilityKey: role.toLowerCase(), executionMode: 'PROVIDER_CONTEXT' }
  return { role, selection, loaded: { ...selection, available: true, content } }
}

describe('lossless Library method documents', () => {
  test.each(['packType: RL', 'runtimeRole: RL', 'sourceFormat: JSON', 'scopeType: TENANT'])('rejects contradictory BOM-prefixed metadata: %s', (declaration) => {
    const input = fixture()
    input.loaded.content = `\uFEFF---\r\n${declaration}\r\n---\r\n# Source\r\nComplete guidance.\r\n`
    input.selection.contentHash = input.loaded.contentHash = `sha256:${createHash('sha256').update(input.loaded.content).digest('hex')}`
    expect(() => buildOutcomeMethodDocument(input)).toThrow()
  })
  test('preserves a valid BOM and historical document status without treating it as lifecycle authority', () => {
    const input = fixture()
    input.loaded.content = '\uFEFF' + input.loaded.content
    input.selection.contentHash = input.loaded.contentHash = `sha256:${createHash('sha256').update(input.loaded.content).digest('hex')}`
    expect(readOutcomeMethodDocument(buildOutcomeMethodDocument(input))).toBe(input.loaded.content)
  })
  test.each(['ARL', 'RL'])('preserves every %s source character including metadata, tables, CRLF and unicode', (role) => {
    const input = fixture(role)
    const document = buildOutcomeMethodDocument(input)
    expect(readOutcomeMethodDocument(document)).toBe(input.loaded.content)
    expect(document.chunks.length).toBeGreaterThan(1)
    expect(document.source).toEqual(expect.objectContaining({ packId: input.selection.packId, versionId: input.selection.versionId, contentHash: input.selection.contentHash }))
    expect(document.boundary).toBe(role === 'ARL' ? 'GENERATION_CONTEXT' : 'POST_GENERATION_VALIDATION')
    expect(assertOutcomeMethodDocument(document)).toBe(document)
  })
  test('new names, versions and content are consumed without a source profile or code change', async () => {
    const first = fixture()
    const next = fixture('ARL', 'next-week')
    next.selection.semanticVersion = next.loaded.semanticVersion = '3.0.0'
    const loader = jest.fn().mockResolvedValue(next.loaded)
    const document = await loadOutcomeMethodDocument({ ...next, loadPackContent: loader })
    expect(loader).toHaveBeenCalledWith({ packId: next.selection.packId, versionId: next.selection.versionId })
    expect(readOutcomeMethodDocument(document)).toBe(next.loaded.content)
    expect(document.source.contentHash).not.toBe(first.selection.contentHash)
  })
  test.each([
    ['altered content', (input) => { input.loaded.content += ' changed' }],
    ['inactive source', (input) => { input.loaded.status = 'DEPRECATED' }],
    ['wrong selected version', (input) => { input.selection.versionId = 'other' }],
    ['wrong boundary', (input) => { input.selection.boundary = 'POST_GENERATION_VALIDATION' }],
    ['wrong role', (input) => { input.selection.packType = 'RL' }],
    ['wrong capability', (input) => { input.selection.capabilityKey = 'other' }],
    ['oversized source', (input) => { input.loaded.content = 'x'.repeat(200001) }],
    ['malformed unicode', (input) => { input.loaded.content += '\ud800' }],
    ['credentials', (input) => { input.loaded.content += ' api_key: sk-abcdefghijklmnopqrstuvwxyz' }],
  ])('rejects %s before consumption', (_name, alter) => {
    const input = fixture(); alter(input)
    expect(() => buildOutcomeMethodDocument(input)).toThrow()
  })
  test.each([
    ['missing chunk', (doc) => { doc.chunks.pop() }],
    ['reordered chunks', (doc) => { doc.chunks.reverse() }],
    ['changed text', (doc) => { doc.chunks[0].text = doc.chunks[0].text.replace('Meaning', 'Failing') }],
    ['extra field', (doc) => { doc.chunks[0].untrusted = true }],
    ['gap', (doc) => { doc.chunks[1].start += 1 }],
  ])('rejects %s in the transmitted envelope', (_name, alter) => {
    const document = buildOutcomeMethodDocument(fixture()); alter(document)
    expect(() => assertOutcomeMethodDocument(document)).toThrow()
  })
  test('receipt records full coverage without copying content or claiming successful execution', () => {
    const document = buildOutcomeMethodDocument(fixture())
    const receipt = projectOutcomeMethodDocumentReceipt(document)
    expect(receipt.characterCount).toBe(readOutcomeMethodDocument(document).length)
    expect(receipt.chunkCount).toBe(document.chunks.length)
    expect(JSON.stringify(receipt)).not.toMatch(/Final exception|chunks|PASSED/)
    expect(() => assertNoMethodDocumentContentInEvidence({ methodDocumentReceipts: [receipt] })).not.toThrow()
    expect(() => assertNoMethodDocumentContentInEvidence({ nested: { methodGuidance: [{ document }] } })).toThrow()
  })
  test('builds a governed post-validation receipt from the complete document receipt', () => {
    const document = buildOutcomeMethodDocument(fixture('RL'))
    const receipt = buildOutcomeMethodDocumentBoundaryReceipt(
      projectOutcomeMethodDocumentReceipt(document),
      { evidenceReference: 'outcome:test:rl-method-document' },
    )
    expect(receipt).toMatchObject({
      packId: document.source.packId,
      versionId: document.source.versionId,
      contentHash: document.source.contentHash,
      boundary: 'POST_GENERATION_VALIDATION',
      receiptType: 'POST_VALIDATION',
      status: 'PASSED',
      result: 'PASS',
    })
    expect(receipt.checks).toEqual(expect.arrayContaining([
      { key: 'POST_VALIDATION_PASSED', status: 'PASSED', message: expect.any(String) },
      { key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED', message: expect.any(String) },
    ]))
    expect(JSON.stringify(receipt)).not.toContain('Final exception')
  })
  test('enforces the complete context budget without truncation', () => {
    expect(() => assertOutcomeMethodContextBudget({ otherContext: 'x'.repeat(192 * 1024) })).toThrow()
  })
})
