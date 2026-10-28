import { jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { acquireWebsiteDiscoveryEvidence, buildWebsiteDiscoveryEvidenceFromDecodedHtml, normalizeDiscoveryEvidenceObjects,
  buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { assertSourceEvidenceMetadataPairs, buildEvidenceSupport, buildSourceCapture,
  validateSourceCapture } from '../services/sourceEvidenceContract.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
import { hashSectionInput } from '../services/runtimeSectionModelService.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
const manualPath = new URL('./fixtures/manualReferenceEvidence.json', import.meta.url)
const manualBefore = readFileSync(manualPath)
const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const clone = value => JSON.parse(JSON.stringify(value))
const response = (html = fixture.html, overrides = {}) => ({ ok: true, status: 200, url: fixture.url,
  headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(Buffer.byteLength(html)) : null },
  text: jest.fn(async () => html), ...overrides })
const acquire = (options = {}, body = fixture.html, overrides = {}) => {
  globalThis.fetch.mockResolvedValue(response(body, overrides))
  return acquireWebsiteDiscoveryEvidence({ websiteUrl: fixture.url, acquiredAt: fixture.capturedAt,
    acquisitionProfile: 'STANDARD', recordSourceCapture: true, ...options })
}
const canonical = product => {
  const evidenceObjects = normalizeDiscoveryEvidenceObjects({ sources: [product.source], evidenceObjects: product.evidenceObjects })
  const sourceRegistry = buildDiscoverySourceRegistry({ sources: [product.source], sourceRegistry: [product.sourceRegistryEntry], evidenceObjects })
  return { evidenceObjects, sourceRegistry }
}
const native = product => createRuntimeStateLegacySourceRowSet({
  legacyInput: { rawBsonBytes: 4096, sections: {}, evidencePack: canonical(product),
    intelligenceGraph: { graphVersion: 'offline-controlled-v1', nodes: [], edges: [] } },
  scope: { runtimeInstanceId: '64b7f7a4e1e5f8320c000001', runtimeInstanceKey: 'controlled-capture',
    customerId: '64b7f7a4e1e5f8320c000002', tenantId: '64b7f7a4e1e5f8320c000003' },
  stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
  migrationReceiptId: '64b7f7a4e1e5f8320c000004', migrationTimestamp: fixture.capturedAt,
})

beforeEach(() => {
  globalThis.fetch = jest.fn()
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns })

test('records actual complete decoded-response and full stripped-view hashes, preserving UTF16 coordinates and legacy identities', async () => {
  const result = await acquire(), capture = result.source.sourceCapture
  expect(fixture.fixtureKind).toBe('CONTROLLED_SYNTHETIC_WEBSITE_RESPONSE')
  expect(capture).toMatchObject({ originalContentHash: hash(Buffer.from(fixture.html, 'utf8')),
    captureTextHash: hash(fixture.captureText), textLength: fixture.captureText.length,
    adapter: 'website-html-fetch-v1', extractionMethod: 'DECODED_HTML_STRIPPED_TEXT', coordinateSystem: 'UTF16_CODE_UNIT',
    captureScope: 'NORMALIZED_EXTRACTED_TEXT_ONLY', capturedAt: fixture.capturedAt,
    captureReceipt: { operation: 'WEBSITE_DECODED_TEXT_CAPTURE', status: 'SUCCEEDED', runId: null, attemptId: null, inputIndex: 0 } })
  expect(capture.originalContentHash).not.toBe(result.source.valueHash)
  expect(result.source.valueHash).toBe(hash(JSON.stringify({ html: fixture.html })))
  expect(result.sourceRegistryEntry.sourceCapture).toEqual(capture)
  expect(result.sourceRegistryEntry.contentHash).toBe(capture.originalContentHash)
  expect(result.evidenceObjects.length).toBeGreaterThan(0)
  for (const row of result.evidenceObjects) {
    expect(row).toMatchObject({ reviewStatus: 'PENDING', sourceUrl: fixture.url, acceptedBy: '', acceptanceTimestamp: '', auditRef: '' })
    const support = row.evidenceSupport
    expect(support).toBeDefined()
    expect(fixture.captureText.slice(support.start, support.end)).toBe(support.exactExcerpt)
    expect(support.exactExcerpt).not.toBe(row.extractedFact)
    expect(support).toMatchObject({ originalContentHash: capture.originalContentHash, captureTextHash: capture.captureTextHash,
      epistemicType: 'SOURCE_ASSERTION', restrictions: ['EXTRACTED_TEXT_COORDINATES_ONLY', 'SOURCE_ASSERTION_NOT_INDEPENDENTLY_VERIFIED'] })
  }
  const supportedAfterEmoji = result.evidenceObjects.find(row => row.evidenceSupport.exactExcerpt.startsWith('The synthetic'))
  expect(supportedAfterEmoji.evidenceSupport.start).toBe(fixture.captureText.indexOf('The synthetic'))
  expect(supportedAfterEmoji.evidenceSupport.start).toBeGreaterThan(Array.from(fixture.captureText.slice(0, supportedAfterEmoji.evidenceSupport.start)).length)
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalled()
})

test.each([false, undefined])('default/false capture mode %s retains exact legacy result without optional metadata', async mode => {
  const recorded = await acquire(), legacy = await acquire({ recordSourceCapture: mode })
  const expected = clone(recorded)
  for (const source of [expected.source, expected.sourceRegistryEntry]) { delete source.sourceCapture; delete source.contentHash }
  expected.evidenceObjects.forEach(row => { delete row.evidenceSupport })
  expect(legacy).toEqual(expected)
})
test.each([null, 'true', 1, {}, []])('rejects nonboolean mode %j before DNS/fetch', async mode => {
  await expect(acquire({ recordSourceCapture: mode })).rejects.toThrow('Website source capture mode must be a boolean.')
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
})

test('roundtrips through actual canonical owners, mapper/native models, and section qualifier without review promotion', async () => {
  const product = await acquire(), before = JSON.stringify(product), normalized = canonical(product)
  const mapped = native(product)
  expect(mapped.rows.evidenceSources[0].sourceCapture).toEqual(product.source.sourceCapture)
  expect(new RuntimeEvidenceSource(mapped.rows.evidenceSources[0]).validateSync()).toBeUndefined()
  for (const row of mapped.rows.evidenceObjects) {
    expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
    expect(row.evidenceSupport).toEqual(product.evidenceObjects.find(evidence => evidence.evidenceObjectId === row.evidenceObjectId).evidenceSupport)
  }
  const input = { ...normalized, lineageSources: [product.source], admittedEvidenceIds: product.evidenceObjects.map(row => row.evidenceObjectId) }
  const qualified = buildRuntimeSectionEvidenceQualifications(input)
  expect(qualified.sources[0]).toMatchObject({ sourceReview: { status: 'NOT_RECORDED', authenticity: null }, recordedSourceType: 'WEBSITE', sourceCapture: product.source.sourceCapture })
  expect(qualified.evidence.every(row => row.evidenceSupport.epistemicType === 'SOURCE_ASSERTION')).toBe(true)
  const legacy = clone(input)
  legacy.evidenceObjects.forEach(row => { delete row.evidenceSupport }); delete legacy.sourceRegistry[0].sourceCapture
  expect(hashSectionInput(qualified)).not.toBe(hashSectionInput(buildRuntimeSectionEvidenceQualifications(legacy)))
  expect(JSON.stringify(product)).toBe(before)
})

test.each([
  ['missing owner capture', value => { delete value.sourceRegistryEntry.sourceCapture }],
  ['changed capture hash', value => { value.sourceRegistryEntry.sourceCapture.captureTextHash = hash('changed') }],
  ['changed original hash', value => { value.sourceRegistryEntry.contentHash = hash('changed') }],
  ['changed excerpt', value => { value.evidenceObjects[0].evidenceSupport.exactExcerpt += 'x' }],
  ['changed offset', value => { value.evidenceObjects[0].evidenceSupport.end++ }],
  ['foreign source', value => { value.evidenceObjects[0].evidenceSupport.sourceId = 'foreign' }],
])('rejects %s through the actual source-first pairing boundary', async (_label, mutate) => {
  const value = clone(await acquire()); mutate(value)
  expect(() => assertSourceEvidenceMetadataPairs({ sources: [value.sourceRegistryEntry], evidenceObjects: value.evidenceObjects })).toThrow()
  expect(() => native(value)).toThrow()
})

test('leaves repeated, whitespace-transformed and meta-only segments without invented exact support', async () => {
  const sentence = 'The synthetic business provides workflow reporting services to test customers'
  const repeated = await acquire({}, `<p>${sentence}.</p><p>${sentence}.</p>`)
  expect(repeated.evidenceObjects.length).toBeGreaterThan(0)
  expect(repeated.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  const transformed = await acquire({}, `<title>The synthetic  company provides reporting services</title><meta name="description" content="The fictional provider supports enterprise workflow monitoring"><p>${sentence}.</p>`)
  expect(transformed.evidenceObjects.find(row => row.extractedFact.startsWith('Website title:')).evidenceSupport).toBeUndefined()
  expect(transformed.evidenceObjects.find(row => row.extractedFact.startsWith('Website description:')).evidenceSupport).toBeUndefined()
  expect(buildEvidenceSupport({ captureText: fixture.captureText, exactSegment: 'absent statement', sourceCapture: (await acquire()).source.sourceCapture })).toBeUndefined()
})

test('accepts the complete 80000-unit view and rejects 80001 without clipping', async () => {
  const heading = 'The synthetic company provides reporting services'
  const base = `<h1>${heading}</h1>`
  const body = base + 'x'.repeat(80000 - heading.length - 2)
  expect((await acquire({}, body)).source.sourceCapture.textLength).toBe(80000)
  await expect(acquire({}, body + 'x')).rejects.toMatchObject({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' })
})
test.each(['', '   ', '<p>   </p>', '\ud800' + fixture.html])('rejects empty/unreviewable/malformed decoded response %j', async body => {
  await expect(acquire({}, body)).rejects.toThrow()
})
test('rejects a truncated acquired response while leaving the ordinary bounded website path unchanged', async () => {
  const html = fixture.html + ' '.repeat(320001)
  const headers = { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? '1' : null }
  await expect(acquire({}, html, { headers })).rejects.toThrow('complete valid decoded response')
  const legacy = await acquire({ recordSourceCapture: false }, html, { headers })
  expect(legacy.source.contentTruncated).toBe(true)
  expect(legacy.source.sourceCapture).toBeUndefined()
})
test.each([
  [206, null],
  [200, 'bytes 0-99/1000'],
  [206, 'bytes 0-99/1000'],
])('rejects explicit partial capture status %s range %s before consuming its body', async (status, contentRange) => {
  const partial = response(fixture.html, { status, headers: { get: key => key === 'content-range' ? contentRange
    : key === 'content-type' ? 'text/html' : String(Buffer.byteLength(fixture.html)) } })
  globalThis.fetch.mockResolvedValue(partial)
  await expect(acquireWebsiteDiscoveryEvidence({ websiteUrl: fixture.url, acquiredAt: fixture.capturedAt,
    acquisitionProfile: 'STANDARD', recordSourceCapture: true }))
    .rejects.toThrow('Website source capture requires a complete response; partial responses are not supported.')
  expect(partial.text).not.toHaveBeenCalled()
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
})

test.each([false, undefined])('partial responses retain exact default-off behavior for mode %s', async recordSourceCapture => {
  const complete = await acquire({ recordSourceCapture })
  const partial = await acquire({ recordSourceCapture }, fixture.html, { status: 206,
    headers: { get: key => key === 'content-range' ? 'bytes 0-99/1000'
      : key === 'content-type' ? 'text/html' : String(Buffer.byteLength(fixture.html)) } })
  expect(partial).toEqual(complete)
  expect(partial.source).not.toHaveProperty('sourceCapture')
  expect(partial.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
})

test('complete capture remains identical with an empty range header', async () => {
  const complete = await acquire()
  const emptyRange = await acquire({}, fixture.html, { headers: { get: key => key === 'content-range' ? ' \t '
    : key === 'content-type' ? 'text/html' : String(Buffer.byteLength(fixture.html)) } })
  expect(emptyRange).toEqual(complete)
})

test('unsuccessful partial-range response retains its HTTP failure before body consumption', async () => {
  const failed = response(fixture.html, { ok: false, status: 416,
    headers: { get: key => key === 'content-range' ? 'bytes */1000' : 'text/html' } })
  globalThis.fetch.mockResolvedValue(failed)
  await expect(acquireWebsiteDiscoveryEvidence({ websiteUrl: fixture.url, acquiredAt: fixture.capturedAt,
    acquisitionProfile: 'STANDARD', recordSourceCapture: true })).rejects.toThrow('Website acquisition failed with HTTP 416.')
  expect(failed.text).not.toHaveBeenCalled()
})

test.each([
  ['wrong adapter', value => { value.adapter = 'document-txt-text-extraction-v1' }],
  ['wrong extraction', value => { value.extractionMethod = 'TEXT_NATIVE' }],
  ['unknown operation', value => { value.captureReceipt.operation = 'SEARCH_CAPTURE' }],
  ['fabricated run', value => { value.captureReceipt.runId = 'pretend' }],
])('rejects %s in the explicit website receipt grammar', async (_label, mutate) => {
  const value = clone((await acquire()).source.sourceCapture); mutate(value)
  expect(() => validateSourceCapture(value)).toThrow()
})
test('preserves default document grammar and shared excerpt byte limit', () => {
  const captureText = 'x'.repeat(4097)
  const sourceCapture = buildSourceCapture({ sourceId: 'document', originalContentHash: hash(captureText), captureText,
    adapter: 'document-txt-text-extraction-v1', extractionMethod: 'TEXT_NATIVE', capturedAt: fixture.capturedAt, inputIndex: 0 })
  expect(sourceCapture.captureReceipt.operation).toBe('DOCUMENT_TEXT_CAPTURE')
  expect(() => buildEvidenceSupport({ sourceCapture, captureText, exactSegment: captureText })).toThrow()
})
test.each([
  ['unsupported content', { headers: { get: key => key === 'content-type' ? 'application/pdf' : key === 'content-length' ? '1' : null } }, 'only supports HTML or plain text'],
  ['outside domain', { url: 'https://outside.example/' }, 'outside the requested domain'],
])('retains the existing %s rejection', async (_label, overrides, message) => {
  await expect(acquire({}, fixture.html, overrides)).rejects.toThrow(message)
})
test('keeps the supplied manual reference a document benchmark without original web captures', () => {
  const manual = JSON.parse(manualBefore.toString('utf8'))
  expect(manual.fixtureKind).toBe('manual_reference_fixture')
  expect(manual.underlyingWebCapture).toBeNull()
  expect(manual.missingSpecificSourceUrlIds).toContain('E024')
  expect(readFileSync(manualPath)).toEqual(manualBefore)
  expect(manual).not.toHaveProperty('sourceCapture')
})

const decodedArgs = (options = {}) => ({ html: fixture.html, normalizedUrl: fixture.url, finalUrl: fixture.url,
  acquisitionProfile: 'STANDARD', acquiredAt: fixture.capturedAt, contentTruncated: false,
  charactersRead: fixture.html.length, characterLimit: 320000, ...options })

test.each([false, undefined, true])('decoded primitive matches fetched short material byte-for-byte for capture %s', async mode => {
  const fetched = await acquire({ recordSourceCapture: mode })
  const direct = buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ recordSourceCapture: mode }))
  expect(JSON.stringify(direct)).toBe(JSON.stringify(fetched))
})

test('decoded primitive is deterministic without acquisition I/O or generated time', () => {
  const timer = jest.spyOn(globalThis, 'setTimeout'), now = jest.spyOn(Date, 'now')
  try {
    const args = decodedArgs({ recordSourceCapture: true }), before = JSON.stringify(args)
    const first = buildWebsiteDiscoveryEvidenceFromDecodedHtml(args)
    expect(JSON.stringify(buildWebsiteDiscoveryEvidenceFromDecodedHtml(args))).toBe(JSON.stringify(first))
    expect(JSON.stringify(args)).toBe(before)
    expect(first.source.capturedAt).toBe(fixture.capturedAt)
    expect(first.source.sourceCapture.capturedAt).toBe(fixture.capturedAt)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
  } finally { timer.mockRestore(); now.mockRestore() }
})

test.each([null, 3, {}, []])('decoded primitive rejects nonstring HTML %j without coercion', html => {
  expect(() => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ html }))).toThrow('Website decoded HTML must be a string.')
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

test.each([null, 'true', 1])('decoded primitive rejects nonboolean capture %j', recordSourceCapture => {
  expect(() => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ recordSourceCapture })))
    .toThrow('Website source capture mode must be a boolean.')
})

test('decoded primitive preserves empty-text before completeness failure and complete-mode invalidity checks', () => {
  expect(() => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ html: '', recordSourceCapture: true, contentTruncated: true })))
    .toThrow('Website acquisition did not find extractable customer website text.')
  for (const options of [{ contentTruncated: true }, { html: fixture.html + String.fromCharCode(0xd800) }]) {
    expect(() => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ recordSourceCapture: true, ...options })))
      .toThrow('Website source capture requires complete valid decoded response text.')
  }
})
