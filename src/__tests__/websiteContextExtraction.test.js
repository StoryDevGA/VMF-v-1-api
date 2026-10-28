import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { acquireWebsiteDiscoveryEvidence, buildWebsiteDiscoveryEvidenceFromDecodedHtml, normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { sourceEvidenceHash, assertSourceEvidenceMetadataPairs } from '../services/sourceEvidenceContract.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlledLongWebsitePage.json', import.meta.url), 'utf8'))
const short = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
beforeEach(() => { globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]); globalThis.fetch = jest.fn() })
afterEach(() => { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns })
const acquire = async (html = fixture.html, profile = 'STANDARD', mode = true, source = fixture) => {
  globalThis.fetch.mockResolvedValue({ ok: true, status: 200, url: source.url,
    headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(Buffer.byteLength(html)) : null }, text: async () => html })
  return acquireWebsiteDiscoveryEvidence({ websiteUrl: source.url, acquiredAt: source.capturedAt, acquisitionProfile: profile,
    ...(mode === 'OMITTED' ? {} : { recordSourceCapture: mode }) })
}
test('complete three golden contexts preserve decimals and every source qualification', async () => {
  const result = await acquire()
  expect(fixture.html.length).toBeGreaterThanOrEqual(8000)
  expect(fixture.html.length).toBeLessThanOrEqual(12000)
  expect(result.evidenceObjects.slice(0, 3).map(row => row.extractedFact)).toEqual(fixture.contexts.map(text => 'Website body: ' + text))
  expect(result.evidenceObjects.slice(0, 3).map(row => row.evidenceSupport.exactExcerpt)).toEqual(fixture.contexts)
  expect(result.source.sourceCapture.originalContentHash).toBe(sourceEvidenceHash(fixture.html))
  expect(result.source.url).toBe(fixture.url)
  expect(result.evidenceObjects.every(row => row.sourceUrl === fixture.url)).toBe(true)
  const evidenceObjects = normalizeDiscoveryEvidenceObjects({ sources: [result.source], evidenceObjects: result.evidenceObjects })
  const sourceRegistry = buildDiscoverySourceRegistry({ sources: [result.source], sourceRegistry: [result.sourceRegistryEntry], evidenceObjects })
  expect(() => assertSourceEvidenceMetadataPairs({ sources: sourceRegistry, evidenceObjects })).not.toThrow()
  const native = createRuntimeStateLegacySourceRowSet({ scope: { runtimeInstanceId: '64b7f7a4e1e5f8320c000001', runtimeInstanceKey: 'controlled-context',
    customerId: '64b7f7a4e1e5f8320c000002', tenantId: '64b7f7a4e1e5f8320c000003' }, stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
  migrationReceiptId: '64b7f7a4e1e5f8320c000004', migrationTimestamp: fixture.capturedAt,
  legacyInput: { rawBsonBytes: 12000, sections: {}, evidencePack: { sourceRegistry, evidenceObjects }, intelligenceGraph: { graphVersion: 'controlled-context', nodes: [], edges: [] } } })
  expect(new RuntimeEvidenceSource(native.rows.evidenceSources[0]).validateSync()).toBeUndefined()
  expect(native.rows.evidenceSources[0].sourceCapture).toEqual(result.source.sourceCapture)
  expect(native.rows.evidenceSources[0].contentHash).toBe(result.source.contentHash)
  for (const row of native.rows.evidenceObjects) {
    expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
    const original = result.evidenceObjects.find(item => item.evidenceObjectId === row.evidenceObjectId)
    expect(row.extractedFact).toBe(original.extractedFact)
    expect(row.evidenceSupport).toEqual(original.evidenceSupport)
  }
  const qualified = buildRuntimeSectionEvidenceQualifications({ evidenceObjects, sourceRegistry, lineageSources: [result.source],
    admittedEvidenceIds: evidenceObjects.map(row => row.evidenceObjectId) })
  expect(qualified.sources[0].sourceReview).toEqual({ status: 'NOT_RECORDED', authenticity: null })
  expect(qualified.evidence.every(row => row.reviewStatus === 'PENDING' && row.evidenceSupport.epistemicType === 'SOURCE_ASSERTION')).toBe(true)
  for (let index = 0; index < 3; index++) {
    const support = result.evidenceObjects[index].evidenceSupport
    expect(support.excerptHash).toBe(sourceEvidenceHash(fixture.contexts[index]))
    expect(support.end - support.start).toBe(fixture.contexts[index].length)
    expect(support.restrictions).toEqual(['EXTRACTED_TEXT_COORDINATES_ONLY', 'SOURCE_ASSERTION_NOT_INDEPENDENTLY_VERIFIED'])
    expect(result.evidenceObjects.slice(3).some(row => fixture.contexts[index].includes(row.extractedFact.replace(/^Website body: /, '')))).toBe(false)
  }
})

test.each(['STANDARD', 'ENHANCED'])('actual frozen old %s default/false outputs remain exact', async profile => {
  for (const mode of [false, 'OMITTED']) {
    const result = await acquire(fixture.html, profile, mode)
    expect(sourceEvidenceHash(JSON.stringify(result))).toBe(fixture.goldens[profile + (mode === false ? '_false' : '_omitted')])
    expect(result.source).not.toHaveProperty('sourceCapture')
  }
})
test('existing short opt-in output matches actual pre-edit golden bytes', async () => {
  const result = await acquire(short.html, 'STANDARD', true, short)
  expect(sourceEvidenceHash(JSON.stringify(result))).toBe(fixture.goldens.shortCaptured)
})
test.each([['STANDARD', 4], ['ENHANCED', 20]])('%s preserves its existing %i-object budget and source context order', async (profile, limit) => {
  const contexts = Array.from({ length: 25 }, (_, index) => fixture.contexts[0] + ` Controlled context ordinal ${index} has a separate scope.`)
  const result = await acquire(contexts.map(text => '<p>' + text + '</p>').join('\n'), profile)
  expect(result.evidenceObjects).toHaveLength(limit)
  expect(result.evidenceObjects.map(row => row.evidenceSupport.exactExcerpt)).toEqual(contexts.slice(0, limit))
})
test('unselected over-budget oversized or ambiguous contexts do not cause failure', async () => {
  const selected = Array.from({ length: 4 }, (_, index) => fixture.contexts[0] + ` Selected ordinal ${index}.`)
  const html = selected.map(text => '<p>' + text + '</p>').join('')
    + '<p>' + fixture.contexts[1] + 'x'.repeat(5000) + '</p><p>' + fixture.contexts[2] + '</p><p>' + fixture.contexts[2] + '</p>'
  expect((await acquire(html)).evidenceObjects.map(row => row.evidenceSupport.exactExcerpt)).toEqual(selected)
})
test('selected UTF8-overbound context fails through unchanged shared support validator without clipping', async () => {
  const paragraph = fixture.contexts[0] + ' ' + 'é'.repeat(2000)
  expect(paragraph.length).toBeLessThan(4096)
  expect(Buffer.byteLength(paragraph)).toBeGreaterThan(4096)
  await expect(acquire('<p>' + paragraph + '</p>')).rejects.toMatchObject({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' })
})
test('ambiguous selected complete paragraph fails explicitly without returning numeric fragments', async () => {
  await expect(acquire('<p>' + fixture.contexts[0] + '</p><p>' + fixture.contexts[0] + '</p>'))
    .rejects.toThrow('Website contextual extraction requires a unique exact capture paragraph.')
})
test('inline markup and whitespace keep exact raw support distinct from normalized fact', async () => {
  const inner = '\n ' + fixture.contexts[0].replace('12.5', '<em>12.5</em>') + '\n'
  const exact = '\n ' + fixture.contexts[0].replace('12.5', ' 12.5 ') + '\n'
  const html = '<h1>Source boundary 😀</h1><p>' + inner + '</p>'
  const expectedView = ' Source boundary 😀  ' + exact + ' '
  const result = await acquire(html), row = result.evidenceObjects[0], support = row.evidenceSupport
  expect(row.extractedFact).toBe('Website body: ' + fixture.contexts[0])
  expect(support.exactExcerpt).toBe(exact)
  expect(support.excerptHash).toBe(sourceEvidenceHash(exact))
  expect(result.source.sourceCapture).toMatchObject({ originalContentHash: sourceEvidenceHash(html),
    captureTextHash: sourceEvidenceHash(expectedView), textLength: expectedView.length })
  expect(row.sourceUrl).toBe(fixture.url)
  expect(support.start).toBe(expectedView.indexOf(exact))
  expect(expectedView.slice(support.start, support.end)).toBe(exact)
  expect(support.start).toBeGreaterThan(Array.from(expectedView.slice(0, support.start)).length)
})
test('script/style/noscript fake paragraphs cannot become selected long contexts', async () => {
  const hidden = ['script', 'style', 'noscript'].map(tag => '<' + tag + '><p>' + fixture.contexts[0] + '</p></' + tag + '>').join('')
  const result = await acquire(hidden + '<p>' + fixture.contexts[1] + '</p>')
  expect(result.evidenceObjects[0].evidenceSupport.exactExcerpt).toBe(fixture.contexts[1])
  expect(result.evidenceObjects.some(row => row.extractedFact.includes('12.5'))).toBe(false)
})
test.each(['p', 'div'])('unsupported selected nested %s structure fails instead of partial contextual output', async tag => {
  await expect(acquire('<p>' + fixture.contexts[0] + '<' + tag + '>' + fixture.contexts[1] + '</' + tag + '></p>'))
    .rejects.toThrow('Website contextual extraction cannot select nested paragraph structure.')
})

test.each(['STANDARD', 'ENHANCED'])('decoded primitive retains exact current long-page %s output and historical default hashes', async profile => {
  for (const mode of [false, 'OMITTED', true]) {
    const fetched = await acquire(fixture.html, profile, mode)
    const direct = buildWebsiteDiscoveryEvidenceFromDecodedHtml({ html: fixture.html, normalizedUrl: fixture.url,
      finalUrl: fixture.url, acquisitionProfile: profile, acquiredAt: fixture.capturedAt,
      ...(mode === 'OMITTED' ? {} : { recordSourceCapture: mode }),
      contentTruncated: false, charactersRead: fixture.html.length, characterLimit: 320000 })
    expect(JSON.stringify(direct)).toBe(JSON.stringify(fetched))
    if (mode !== true) expect(sourceEvidenceHash(JSON.stringify(direct)))
      .toBe(fixture.goldens[profile + (mode === false ? '_false' : '_omitted')])
    else expect(direct.evidenceObjects.slice(0, 3).map(row => row.evidenceSupport.exactExcerpt)).toEqual(fixture.contexts)
  }
})

test('decoded primitive retains the saved short capture golden hash', () => {
  const direct = buildWebsiteDiscoveryEvidenceFromDecodedHtml({ html: short.html, normalizedUrl: short.url, finalUrl: short.url,
    acquisitionProfile: 'STANDARD', acquiredAt: short.capturedAt, recordSourceCapture: true,
    contentTruncated: false, charactersRead: short.html.length, characterLimit: 320000 })
  expect(sourceEvidenceHash(JSON.stringify(direct))).toBe(fixture.goldens.shortCaptured)
})
