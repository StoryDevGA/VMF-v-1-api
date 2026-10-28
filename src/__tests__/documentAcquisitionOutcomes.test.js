import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ingestUploadedDocumentDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'
import { normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { buildEvidenceSupport, sourceEvidenceHash, validateSourceCapture, validateEvidenceSupport,
  assertSourceEvidenceMetadataPairs } from '../services/sourceEvidenceContract.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'

const stamp = '2026-10-05T10:00:00.000Z'
const text = (fileName, textContent) => ({ fileName, textContent, mimeType: 'text/plain' })
const valid = name => text(name, 'The synthetic business supplies workflow monitoring services to test customers in the United Kingdom.')
const acquire = (documentSources, batchOutcomes = true) => ingestUploadedDocumentDiscoveryEvidence({
  documentSources, batchOutcomes, acquisitionProfile: 'STANDARD', capturedAt: stamp,
})

const manualReference = JSON.parse(readFileSync(new URL('./fixtures/manualReferenceEvidence.json', import.meta.url), 'utf8'))
const manualParagraph = manualReference.text.split('\n').find(line => line.startsWith('E019 | ')).split(' | ')[4]
// A reconstructed test container, not the original customer's DOCX or a web capture.
const docxInput = async (fileName, paragraphs) => {
  const escaped = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphs.map(value => `<w:p><w:r><w:t>${escaped(value)}</w:t></w:r></w:p>`).join('')
    + '</w:body></w:document>')
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { buffer, input: { fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    contentBase64: buffer.toString('base64') } }
}

describe('existing DOCX input source capture', () => {
  test('binds actual DOCX bytes and exact Neve reference text without website or authenticity promotion', async () => {
    const document = await docxInput('manual-reference.docx', [manualParagraph])
    const result = await acquire([document.input])
    const source = result.sourceRegistry[0], capture = source.sourceCapture
    expect(capture.originalContentHash).toBe(sourceEvidenceHash(document.buffer))
    expect(capture.originalContentHash).not.toBe(`sha256:${manualReference.originalDocxSha256}`)
    expect(capture.captureTextHash).toBe(sourceEvidenceHash(manualParagraph))
    expect(capture.extractionMethod).toBe('DOCX_XML_TEXT')
    expect(capture.adapter).toBe('document-docx-text-extraction-v1')
    expect(source.sourceType).toBe('UPLOADED_DOCUMENT')
    expect(result.itemOutcomes[0]).toMatchObject({ status: 'SUCCEEDED', inputIndex: 0, documentHash: capture.originalContentHash })
    const supported = result.evidenceObjects.filter(row => row.evidenceSupport)
    expect(supported.length).toBeGreaterThan(0)
    for (const row of supported) {
      const support = row.evidenceSupport
      expect(manualParagraph.slice(support.start, support.end)).toBe(support.exactExcerpt)
      expect(support.originalContentHash).toBe(capture.originalContentHash)
      expect(support.epistemicType).toBe('SOURCE_ASSERTION')
      expect(support.restrictions).toEqual(['EXTRACTED_TEXT_COORDINATES_ONLY', 'SOURCE_ASSERTION_NOT_INDEPENDENTLY_VERIFIED'])
    }
    const normalized = normalizeDiscoveryEvidenceObjects({ evidenceObjects: result.evidenceObjects, sources: result.sources })
    const registry = buildDiscoverySourceRegistry({ sourceRegistry: result.sourceRegistry, evidenceObjects: normalized })
    expect(registry[0].sourceCapture).toEqual(capture)
    expect(normalized.filter(row => row.evidenceSupport).map(row => row.evidenceSupport)).toEqual(supported.map(row => row.evidenceSupport))
    expect(() => assertSourceEvidenceMetadataPairs({ sources: registry, evidenceObjects: normalized })).not.toThrow()
    const qualified = buildRuntimeSectionEvidenceQualifications({ evidenceObjects: normalized,
      sourceRegistry: registry, lineageSources: result.sources,
      admittedEvidenceIds: supported.map(row => row.evidenceObjectId) })
    expect(qualified.sources[0].sourceReview).toEqual({ status: 'NOT_RECORDED', authenticity: null })
    expect(qualified.sources[0].recordedSourceType).toBe('UPLOADED_DOCUMENT')
  })

  test('does not assign an exact locator to repeated DOCX passages', async () => {
    const sentence = manualParagraph.split('. ')[0] + '.'
    const document = await docxInput('repeated.docx', [sentence, sentence])
    const result = await acquire([document.input])
    expect(result.sourceRegistry[0].sourceCapture).toBeDefined()
    expect(result.evidenceObjects.length).toBeGreaterThan(0)
    expect(result.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  })

  test('retains the legacy nonbatch DOCX metadata boundary', async () => {
    const document = await docxInput('legacy.docx', [manualParagraph])
    const result = await acquire([document.input], false)
    expect(result.evidenceObjects.length).toBeGreaterThan(0)
    expect(result.sourceRegistry.every(row => !Object.hasOwn(row, 'sourceCapture'))).toBe(true)
    expect(result.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  })

  test('records a nonempty zero-fact DOCX capture without inventing evidence', async () => {
    const document = await docxInput('short.docx', ['abc'])
    const result = await acquire([document.input])
    expect(result.sourceRegistry[0].sourceCapture.textLength).toBe(3)
    expect(result.sourceRegistry[0].sourceCapture.originalContentHash).toBe(sourceEvidenceHash(document.buffer))
    expect(result.evidenceObjects).toEqual([])
    expect(result.itemOutcomes[0]).toMatchObject({ status: 'SUCCEEDED', evidenceObjectCount: 0, evidenceObjectIds: [] })
  })

  test('keeps valid-invalid-valid DOCX input positions and excludes the failed capture', async () => {
    const first = await docxInput('first.docx', [manualParagraph])
    const third = await docxInput('third.docx', [manualParagraph])
    const invalid = { ...first.input, fileName: 'invalid.docx', contentBase64: Buffer.from('not a DOCX archive').toString('base64') }
    const result = await acquire([first.input, invalid, third.input])
    expect(result.itemOutcomes.map(item => [item.inputIndex, item.status])).toEqual([[0, 'SUCCEEDED'], [1, 'FAILED'], [2, 'SUCCEEDED']])
    expect(result.sourceRegistry).toHaveLength(2)
    expect(result.sourceRegistry.map(row => row.sourceCapture.captureReceipt.inputIndex)).toEqual([0, 2])
    expect(result.sourceRegistry.map(row => row.contentHash)).toEqual([sourceEvidenceHash(first.buffer), sourceEvidenceHash(third.buffer)])
    expect(result.evidenceObjects.every(row => result.sourceRegistry.some(source => source.sourceId === row.sourceId))).toBe(true)
    expect(result.itemOutcomes[1]).not.toHaveProperty('sourceCapture')
  })

  test('fails blank DOCX extraction without a source, capture or evidence record', async () => {
    const document = await docxInput('blank.docx', ['   '])
    const result = await acquire([document.input])
    expect(result.itemOutcomes[0].status).toBe('FAILED')
    expect(result.sources).toEqual([])
    expect(result.sourceRegistry).toEqual([])
    expect(result.evidenceObjects).toEqual([])
  })
})

describe('Source-neutral exact TXT capture through the actual document producer', () => {
  test('keeps original bytes, normalized text and exact quotation separate from displayed normalization', async () => {
    const input = 'MARKET POSITION  The fictional business supplies workflow monitoring to a bounded pilot in Ireland.\r\nThe pilot reviewer has not approved the trial.'
    const result = await acquire([text('qualified.txt', input)])
    const source = result.sourceRegistry[0], capture = source.sourceCapture
    const captured = input.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim()
    expect(capture.originalContentHash).toBe(sourceEvidenceHash(Buffer.from(input)))
    expect(capture.captureTextHash).toBe(sourceEvidenceHash(captured))
    expect(capture.captureTextHash).not.toBe(capture.originalContentHash)
    expect(capture.captureReceipt).toEqual({ contractVersion: 'source-capture-receipt.v1', operation: 'DOCUMENT_TEXT_CAPTURE',
      status: 'SUCCEEDED', runId: null, attemptId: null, inputIndex: 0 })
    const evidence = result.evidenceObjects.find(row => row.evidenceSupport)
    expect(evidence).toBeDefined()
    const support = evidence.evidenceSupport
    expect(captured.slice(support.start, support.end)).toBe(support.exactExcerpt)
    expect(support.exactExcerpt).not.toBe(evidence.extractedFact)
    const normalized = normalizeDiscoveryEvidenceObjects({ evidenceObjects: result.evidenceObjects, sources: result.sources })
    const registry = buildDiscoverySourceRegistry({ sourceRegistry: result.sourceRegistry, evidenceObjects: normalized })
    expect(normalized.find(row => row.evidenceObjectId === evidence.evidenceObjectId).evidenceSupport).toEqual(support)
    expect(registry[0].sourceCapture).toEqual(capture)
    const fallback = buildDiscoverySourceRegistry({ sources: result.sources, evidenceObjects: normalized })
    expect(fallback[0].sourceCapture).toEqual(capture)
    expect(fallback[0].contentHash).toBe(capture.originalContentHash)
    expect(() => assertSourceEvidenceMetadataPairs({ sources: registry, evidenceObjects: normalized })).not.toThrow()
    expect(JSON.stringify(capture)).not.toMatch(/textContent|contentBase64|MARKET POSITION/)
  })
  test('does not guess one location for repeated exact text, and nonbatch helper metadata stays absent', async () => {
    const sentence = 'The fictional business supplies workflow monitoring to a bounded pilot in Ireland.'
    const result = await acquire([text('repeat.txt', sentence + '\n' + sentence)])
    expect(result.evidenceObjects.length).toBeGreaterThan(0)
    expect(result.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
    const legacy = await acquire([text('single.txt', sentence)], false)
    expect(legacy.sources.every(row => !Object.hasOwn(row, 'sourceCapture'))).toBe(true)
    expect(legacy.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  })
  test('ignores forged input envelopes and records a genuine zero-fact capture', async () => {
    const result = await acquire([{ ...text('tiny.txt', 'abc'), sourceCapture: { runId: 'forged' }, evidenceSupport: 'forged' }])
    expect(result.evidenceObjects).toEqual([])
    expect(result.sourceRegistry[0].sourceCapture.textLength).toBe(3)
    expect(result.sourceRegistry[0].sourceCapture.captureReceipt.runId).toBeNull()
  })
  test('rejects malformed hash, offset, private keys, getters and hostile restriction arrays without invoking them', async () => {
    const result = await acquire([valid('exact.txt')]), source = result.sourceRegistry[0]
    const support = result.evidenceObjects.find(row => row.evidenceSupport).evidenceSupport
    const getter = jest.fn()
    for (const mutate of [value => { value.end++ }, value => { value.excerptHash = 'sha256:' + '0'.repeat(64) },
      value => { value.privateToken = 'secret' }, value => { Object.defineProperty(value, 'exactExcerpt', { enumerable: true, get: getter }) },
      value => { Object.setPrototypeOf(value.restrictions, { toJSON: getter }) },
      value => { Object.defineProperty(value.restrictions, '01', { value: 'alias' }) },
      value => { Object.defineProperty(value.restrictions, '0', { value: value.restrictions[0], enumerable: false }) },
      value => { value.restrictions[0] = 'VERIFIED' }, value => { value.start = '0' }, value => { value.exactExcerpt = 'x'.repeat(4097) }]) {
      const changed = JSON.parse(JSON.stringify(support)); mutate(changed)
      expect(() => validateEvidenceSupport(changed)).toThrow(expect.objectContaining({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' }))
    }
    expect(getter).not.toHaveBeenCalled()
    expect(() => validateSourceCapture(null)).toThrow()
    expect(() => validateSourceCapture({ ...source.sourceCapture, textLength: '55' })).toThrow()
    expect(() => buildEvidenceSupport({ sourceCapture: source.sourceCapture, captureText: 'tampered', exactSegment: 'tampered' })).toThrow()
    const wrong = JSON.parse(JSON.stringify(source)); wrong.sourceCapture.captureTextHash = 'sha256:' + 'f'.repeat(64)
    expect(() => assertSourceEvidenceMetadataPairs({ sources: [wrong], evidenceObjects: result.evidenceObjects })).toThrow()
  })
})

describe('Existing document engine batch outcomes', () => {
  test('retains valid-failed-valid outputs and original-position identities', async () => {
    const inputs = [valid('first.txt'), { fileName: 'invalid.exe', textContent: 'SECRET INVALID DOCUMENT' }, valid('third.txt')]
    const result = await acquire(inputs)
    const control = await acquire([inputs[0], valid('middle.txt'), inputs[2]], false)
    expect(result.itemOutcomes.map(item => [item.inputIndex, item.status])).toEqual([[0, 'SUCCEEDED'], [1, 'FAILED'], [2, 'SUCCEEDED']])
    expect(result.sources.map(item => item.sourceId)).toEqual([control.sources[0].sourceId, control.sources[2].sourceId])
    expect(result.evidenceObjects.length).toBeGreaterThan(0)
    expect(result.evidenceObjects.map(item => item.sourceId)).toEqual(expect.arrayContaining(result.sources.map(item => item.sourceId)))
    expect(JSON.stringify(result.itemOutcomes)).not.toMatch(/SECRET INVALID|textContent|contentBase64|stack|supplies workflow/)
  })
  test('default section/helper path continues to throw on a bad input', async () => {
    await expect(acquire([valid('first.txt'), { fileName: 'invalid.exe', textContent: 'Invalid' }], false))
      .rejects.toThrow('Uploaded document must be PDF, PPTX, DOCX, or TXT.')
  })
  test('nonempty successfully extracted text with zero eligible facts is not failure', async () => {
    const result = await acquire([text('short.txt', 'abc')])
    expect(result.evidenceObjects).toEqual([])
    expect(result.sources).toHaveLength(1)
    expect(result.sourceRegistry[0]).toMatchObject({ documentStatus: 'PROCESSED', evidenceProduced: 0 })
    expect(result.itemOutcomes[0]).toMatchObject({ status: 'SUCCEEDED', evidenceObjectCount: 0, evidenceObjectIds: [], documentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
    await expect(acquire([text('short.txt', 'abc')], false)).rejects.toThrow('did not produce reviewable evidence')
  })
  test('blank extraction remains failed and does not create a processed source', async () => {
    const result = await acquire([{ fileName: 'blank.txt', mimeType: 'text/plain', contentBase64: Buffer.from('   \n\t').toString('base64') }])
    expect(result.sources).toEqual([])
    expect(result.itemOutcomes).toEqual([{ inputIndex: 0, status: 'FAILED', reason: 'DOCUMENT_EXTRACTION_FAILED', message: 'Document extraction failed. Choose a supported readable file and retry.' }])
  })
  test('all failed inputs have safe exact outcomes with no fabricated source or evidence', async () => {
    const result = await acquire([{ fileName: 'a.exe', textContent: 'Private text' }, { fileName: 'b.exe', textContent: 'Other private text' }])
    expect(result.sources).toEqual([])
    expect(result.evidenceObjects).toEqual([])
    expect(result.itemOutcomes.map(item => item.inputIndex)).toEqual([0, 1])
    expect(result.itemOutcomes.every(item => item.status === 'FAILED')).toBe(true)
    expect(JSON.stringify(result.itemOutcomes)).not.toContain('private text')
  })
  test('opt-in does not silently drop intended inputs beyond the five-document limit', async () => {
    await expect(acquire(Array.from({ length: 6 }, (_, i) => valid(`${i}.txt`)))).rejects.toThrow('at most five inputs')
  })
})
