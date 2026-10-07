import { ingestUploadedDocumentDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'

const stamp = '2026-10-05T10:00:00.000Z'
const text = (fileName, textContent) => ({ fileName, textContent, mimeType: 'text/plain' })
const valid = name => text(name, 'The synthetic business supplies workflow monitoring services to test customers in the United Kingdom.')
const acquire = (documentSources, batchOutcomes = true) => ingestUploadedDocumentDiscoveryEvidence({
  documentSources, batchOutcomes, acquisitionProfile: 'STANDARD', capturedAt: stamp,
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
