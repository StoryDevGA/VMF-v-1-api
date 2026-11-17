import { jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acquireWebsiteDiscoveryEvidence, applyDiscoveryEvidenceReview, buildWebsiteDiscoveryEvidenceFromDecodedHtml, normalizeDiscoveryEvidenceObjects,
  buildDiscoverySourceRegistry, buildControlledReplayEvidenceFromDecodedHtml } from '../services/discoveryIntelligenceService.js'
import { assertSourceEvidenceMetadataPairs, buildEvidenceSupport, buildSourceCapture,
  validateSourceCapture } from '../services/sourceEvidenceContract.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
import { hashSectionInput } from '../services/runtimeSectionModelService.js'
import { buildDiscoveryEvidencePack } from '../services/runtimeStateMutationService.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { bindAcquisitionSourceProcessing, buildAcquisitionRunOutcomes } from '../services/acquisitionRunService.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'

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
const nativePack = evidencePack => createRuntimeStateLegacySourceRowSet({
  legacyInput: { rawBsonBytes: 4096, sections: {}, evidencePack,
    intelligenceGraph: { graphVersion: 'offline-controlled-v1', nodes: [], edges: [] } },
  scope: { runtimeInstanceId: '64b7f7a4e1e5f8320c000001', runtimeInstanceKey: 'controlled-capture',
    customerId: '64b7f7a4e1e5f8320c000002', tenantId: '64b7f7a4e1e5f8320c000003' },
  stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
  migrationReceiptId: '64b7f7a4e1e5f8320c000004', migrationTimestamp: fixture.capturedAt,
})
const native = product => nativePack(canonical(product))

beforeEach(() => {
  globalThis.fetch = jest.fn()
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns })

describe('provider-free manual redirect capture boundary', () => {
  const redirect = location => response('<p>Redirect body is not original evidence.</p>', { ok: false, status: 302,
    headers: { get: key => key === 'location' ? location : null } })
  const capture = () => acquireWebsiteDiscoveryEvidence({ websiteUrl: fixture.url, acquiredAt: fixture.capturedAt,
    acquisitionProfile: 'STANDARD', recordSourceCapture: true })

  test('same-domain relative redirect captures only the final original body and its support', async () => {
    const moved = redirect('/final'), finalUrl = new URL('/final', fixture.url).toString(), final = response(fixture.html, { url: finalUrl })
    globalThis.fetch.mockResolvedValueOnce(moved).mockResolvedValueOnce(final)
    const product = await capture()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, fixture.url, expect.objectContaining({ redirect: 'manual' }))
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, finalUrl, expect.objectContaining({ redirect: 'manual' }))
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(3)
    expect(moved.text).not.toHaveBeenCalled()
    expect(final.text).toHaveBeenCalledTimes(1)
    expect(product.source.finalUrl).toBe(finalUrl)
    expect(product.source.sourceCapture.originalContentHash).toBe(hash(fixture.html))
    expect(product.source.sourceCapture.captureTextHash).toBe(hash(fixture.captureText))
    expect(() => assertSourceEvidenceMetadataPairs({ sources: [product.source], evidenceObjects: product.evidenceObjects })).not.toThrow()
    expect(product.evidenceObjects.some(row => row.evidenceSupport)).toBe(true)
    for (const row of product.evidenceObjects) {
      expect(row.reviewStatus).toBe('PENDING')
      expect(row.extractedFact).not.toContain('Redirect body')
      if (row.evidenceSupport) {
        expect(row.evidenceSupport.exactExcerpt).toBe(fixture.captureText.slice(row.evidenceSupport.start, row.evidenceSupport.end))
        expect(row.evidenceSupport.epistemicType).toBe('SOURCE_ASSERTION')
      }
    }
  })

  test.each(['https://foreign.example/private', 'http://127.0.0.1/private'])('redirect to %s stops before target DNS or fetch', async location => {
    const moved = redirect(location)
    globalThis.fetch.mockResolvedValueOnce(moved)
    await expect(capture()).rejects.toThrow('Website acquisition redirected outside the requested domain.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(1)
    expect(moved.text).not.toHaveBeenCalled()
  })

  test.each(['redirect target', 'next fetch'])('public DNS changing to private at %s stops before another fetch', async point => {
    const moved = redirect('/final'), publicAddress = [{ address: '93.184.216.34', family: 4 }]
    globalThis.fetch.mockResolvedValueOnce(moved)
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockReset().mockResolvedValueOnce(publicAddress)
    if (point === 'next fetch') globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockResolvedValueOnce(publicAddress)
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    await expect(capture()).rejects.toThrow('Website acquisition target must remain a publicly accessible domain.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(point === 'next fetch' ? 3 : 2)
    expect(moved.text).not.toHaveBeenCalled()
  })

  test.each([
    ['mixed public/private', [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], 'Website acquisition target must remain a publicly accessible domain.'],
    ['empty', [], 'Website acquisition could not verify public DNS resolution.'],
  ])('%s DNS refuses capture before any fetch', async (_name, records, message) => {
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockResolvedValueOnce(records)
    await expect(capture()).rejects.toThrow(message)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(1)
  })

  test('missing redirect location fails without reading its body or fetching again', async () => {
    const moved = redirect(null)
    globalThis.fetch.mockResolvedValueOnce(moved)
    await expect(capture()).rejects.toThrow('Website acquisition redirect was missing a target location.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(1)
    expect(moved.text).not.toHaveBeenCalled()
  })

  test('redirect budget stops after four fetches without a fifth fetch or consuming redirect bodies', async () => {
    const redirects = Array.from({ length: 4 }, (_, index) => redirect(`/hop-${index + 1}`))
    for (const moved of redirects) globalThis.fetch.mockResolvedValueOnce(moved)
    await expect(capture()).rejects.toThrow('Website acquisition exceeded the supported redirect limit.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(8)
    expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([fixture.url, ...[1, 2, 3].map(index => new URL(`/hop-${index}`, fixture.url).toString())])
    for (const [, options] of globalThis.fetch.mock.calls) expect(options.redirect).toBe('manual')
    for (const moved of redirects) expect(moved.text).not.toHaveBeenCalled()
  })
})

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

test('keeps repeated text unsupported while retaining exact whitespace and metadata text', async () => {
  const sentence = 'The synthetic business provides workflow reporting services to test customers'
  const repeated = await acquire({}, `<p>${sentence}.</p><p>${sentence}.</p>`)
  expect(repeated.evidenceObjects.length).toBeGreaterThan(0)
  expect(repeated.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  const transformed = await acquire({}, `<title>The synthetic  company provides reporting services</title><meta name="description" content="The fictional provider supports enterprise workflow monitoring"><p>${sentence}.</p>`)
  expect(transformed.evidenceObjects.find(row => row.extractedFact.startsWith('Website title:')).evidenceSupport.exactExcerpt)
    .toBe('The synthetic  company provides reporting services')
  expect(transformed.evidenceObjects.find(row => row.extractedFact.startsWith('Website description:')).evidenceSupport.exactExcerpt)
    .toBe('The fictional provider supports enterprise workflow monitoring')
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

describe('ordinary section context and single-pass entities (offline)', () => {
  const product = html => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ html, recordSourceCapture: true }))
  const paragraph = label => `The fictional ${label} team supplies carefully coordinated services for its customers. `
    + 'It describes practical delivery responsibilities and a consistent approach to planning each engagement.'
  const section = (label, index) => `<h3>${label}</h3><p>${paragraph(label)}</p>`
    + `<p>The fictional group ${index} guides teams through knowledge transfer, capability development and ongoing support. `
    + 'Its public statement describes the service without establishing independently verified customer outcomes.</p>'
  const sections = Array.from({ length: 5 }, (_, index) => section(`Service ${index}`, index))

  test('keeps four heading-led adjacent paragraph contexts within the existing Standard cap', () => {
    const value = product('<title>The fictional service company</title><h1>The fictional company slogan</h1>' + sections.join(''))
    expect(value.evidenceObjects).toHaveLength(4)
    value.evidenceObjects.forEach((row, index) => {
      expect(row.extractedFact).toContain(`Website body: Service ${index}`)
      expect(row.extractedFact).toContain(`fictional group ${index}`)
      expect(row.evidenceSupport.exactExcerpt).toContain(`Service ${index}`)
      expect(row.evidenceSupport.exactExcerpt).toContain('knowledge transfer')
      expect(row.reviewStatus).toBe('PENDING')
    })
    expect(() => native(value)).not.toThrow()
  })

  test.each([
    ['&#187;', '»'], ['&#x2019;', '’'], ['&#X1F600;', '😀'], ['&#128512;', '😀'],
    ['&#39;', "'"], ['&#00065;', 'A'], ['&amp;#8217;', '&#8217;'], ['&#38;lt;', '&lt;'],
    ['&amp;lt;', '&lt;'], ['&#0;', '&#0;'], ['&#31;', '&#31;'], ['&#127;', '&#127;'],
    ['&#xD800;', '&#xD800;'], ['&#1114112;', '&#1114112;'], ['&#x110000;', '&#x110000;'],
    ['&#xZZ;', '&#xZZ;'], ['&#8217', '&#8217'], ['&#-1;', '&#-1;'],
  ])('decodes valid scalar %s once and preserves malformed or unsafe references', (encoded, decoded) => {
    const title = `The fictional company ${encoded} provides reporting services`
    const value = product(`<title>${title}</title>`)
    const row = value.evidenceObjects.find(item => item.extractedFact.startsWith('Website title:'))
    const exact = `The fictional company ${decoded} provides reporting services`
    expect(row.extractedFact).toBe('Website title: ' + exact)
    expect(row.evidenceSupport.exactExcerpt).toBe(exact)
    expect(row.evidenceSupport.end - row.evidenceSupport.start).toBe(exact.length)
    expect(value.source.sourceCapture.captureTextHash).toBe(hash(' ' + exact + ' '))
    expect(() => native(value)).not.toThrow()
  })

  test('uses the same single-pass Unicode view in metadata, headings and long paragraph support', () => {
    const text = 'The fictional company&#8217;s regional team offers &#x1F600; reporting services'
    const value = product(`<meta name="description" content="${text}"><h2>${text} for delivery</h2>`
      + `<p>${text} for planning. ${paragraph('regional')} ${paragraph('support')}</p>`)
    expect(value.evidenceObjects.some(row => row.extractedFact.includes('company’s'))).toBe(true)
    for (const row of value.evidenceObjects) {
      expect(row.extractedFact).not.toMatch(/&#(?:8217|x1F600);/)
      if (row.evidenceSupport) expect(row.evidenceSupport.exactExcerpt).toContain('company’s')
    }
    expect(() => native(value)).not.toThrow()
  })

  test.each(['<section></section>', '<div></div>', '<p>Notice</p>'])('does not join paragraphs across a %s boundary', boundary => {
    const value = product(`<h3>Fictional delivery services</h3><p>${paragraph('first')}</p>${boundary}`
      + `<p>${paragraph('second')}</p>`)
    expect(value.evidenceObjects.some(row => row.evidenceSupport?.exactExcerpt.includes('first')
      && row.evidenceSupport.exactExcerpt.includes('second'))).toBe(false)
  })

  test('a new heading separates otherwise adjacent paragraph groups', () => {
    const value = product(`<h3>Fictional first service</h3><p>${paragraph('first')}</p>`
      + `<h3>Fictional second service</h3><p>${paragraph('second')}</p>`)
    expect(value.evidenceObjects.some(row => row.evidenceSupport?.exactExcerpt.includes('first')
      && row.evidenceSupport.exactExcerpt.includes('second'))).toBe(false)
  })

  test('does not attribute an adjacent paragraph group to a heading across sibling block wrappers', () => {
    const value = product('<div><h2>Unrelated fictional heading</h2></div><div>'
      + `<p>${paragraph('first')}</p><p>${paragraph('second')}</p></div>`)
    const context = value.evidenceObjects[0].evidenceSupport.exactExcerpt
    expect(context).toContain('fictional first team')
    expect(context).toContain('fictional second team')
    expect(context).not.toContain('Unrelated fictional heading')
  })

  test.each(['<h2>Mismatched heading</h3>', '</h2>', '<h4>A subordinate boundary</h4>'])(
    'does not join a section across malformed or subordinate heading %s', boundary => {
      const value = product(`<h3>Fictional first service</h3><p>${paragraph('first')}</p>${boundary}`
        + `<p>${paragraph('second')}</p>`)
      expect(value.evidenceObjects.some(row => row.evidenceSupport?.exactExcerpt.includes('first')
        && row.evidenceSupport.exactExcerpt.includes('second'))).toBe(false)
    })

  test('retains a standalone long paragraph beside a grouped section without duplicating covered paragraphs', () => {
    const long = paragraph('standalone') + ' ' + paragraph('independent')
    const value = product(sections[0] + `<h2>Independent context</h2><p>${long}</p>`)
    const supported = value.evidenceObjects.filter(row => row.evidenceSupport)
    expect(supported[0].evidenceSupport.exactExcerpt).toContain('Service 0')
    expect(supported[1].evidenceSupport.exactExcerpt).toBe(long)
    expect(supported.filter(row => row.evidenceSupport.exactExcerpt.includes('fictional group 0'))).toHaveLength(1)
  })

  test('preserves individually long paragraph contexts instead of merging an already-supported pair', () => {
    const first = paragraph('alpha') + ' ' + paragraph('first'), second = paragraph('beta') + ' ' + paragraph('second')
    const value = product(`<h3>Fictional long material</h3><p>${first}</p><p>${second}</p>`)
    expect(value.evidenceObjects.slice(0, 2).map(row => row.evidenceSupport.exactExcerpt)).toEqual([first, second])
  })

  test('refuses a selected contextual group beyond the existing evidence fact bound', () => {
    expect(() => product(`<h3>Fictional large material</h3><p>${paragraph('short')}</p>`
      + `<p>${paragraph('large')}${'x'.repeat(8000)}</p>`)).toThrow('supported fact size')
  })

  test('refuses ambiguous repeated contextual sections instead of inventing a locator', () => {
    expect(() => product(sections[0] + sections[0])).toThrow('unique exact capture paragraph')
  })

  test('refuses unsupported nested paragraph blocks in a selected section', () => {
    expect(() => product(`<h3>Fictional team support</h3><p>${paragraph('nested')}<div>Unsupported block</div></p>`
      + `<p>${paragraph('second')}</p>`)).toThrow('nested paragraph structure')
  })

  const retainedTest = process.env.VMF_RETAINED_WEBSITE_HTML ? test : test.skip
  retainedTest('retained homepage replay fixes section coverage and entities without altering the old capture receipt', () => {
    const file = process.env.VMF_RETAINED_WEBSITE_HTML
    const bytes = readFileSync(file)
    expect(hash(bytes)).toBe('sha256:23fa7b12a4f3270d21fc88cf42a499f2a982b583beb0df1a48c764b9a254e5f4')
    const oldFile = path.join(path.dirname(file), 'final-readback.json'), oldBytes = readFileSync(oldFile)
    const old = JSON.parse(oldBytes), value = buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({
      html: bytes.toString('utf8'), normalizedUrl: 'https://neve.studio/', finalUrl: 'https://neve.studio/', recordSourceCapture: true,
    }))
    expect(value.evidenceObjects).toHaveLength(4)
    const consultancy = value.evidenceObjects.find(row => row.extractedFact.includes('Your expertise shouldn’t'))
    expect(consultancy.evidenceSupport.exactExcerpt).toContain('generative AI')
    expect(consultancy.evidenceSupport.exactExcerpt).toContain('up-skill')
    expect(consultancy.evidenceSupport.exactExcerpt).toContain('expertise shouldn’t')
    expect(value.evidenceObjects.map(row => row.extractedFact).join('\n')).not.toMatch(/&#(?:187|8217);/)
    expect(value.source.sourceCapture.originalContentHash).toBe(old.source.sourceCapture.originalContentHash)
    expect(value.source.sourceCapture.captureTextHash).not.toBe(old.source.sourceCapture.captureTextHash)
    for (const row of value.evidenceObjects) expect(row.evidenceSupport.captureTextHash).toBe(value.source.sourceCapture.captureTextHash)
    expect(() => native(value)).not.toThrow()
    expect(readFileSync(file)).toEqual(bytes)
    expect(readFileSync(oldFile)).toEqual(oldBytes)
    expect(old.spans).toHaveLength(4)
    expect(validateSourceCapture(old.source.sourceCapture)).toEqual(old.source.sourceCapture)
    expect(old.source.sourceCapture.captureReceipt.runId).toBe('1053a846-4f05-449c-b352-48d40d1ded3e')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
  })
})

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

describe('ordinary website intake capture connection (offline)', () => {
  const websiteUrl = 'https://parlon.io/'
  const inputs = { companyName: 'Synthetic capture check', marketRegion: 'United Kingdom',
    targetOffer: 'Synthetic services', websiteSources: [websiteUrl] }
  const build = (options = {}) => buildDiscoveryEvidencePack({ inputs, acquisitionProfile: 'STANDARD', ...options })
  beforeEach(() => { jest.spyOn(FrameworkPackage, 'findById').mockResolvedValue(null) })
  afterEach(() => { jest.restoreAllMocks() })

  const runContext = () => ({ runId: '11111111-1111-4111-8111-111111111111', executionAttemptId: '22222222-2222-4222-8222-222222222222', row: {
    acquisitionProfile: 'STANDARD', inputs: [{ kind: 'BRIEF', inputIndex: 0 },
      { kind: 'WEBSITE', inputIndex: 0, contentHash: snapshotHash(websiteUrl) }],
  } })

  test('Run binding preserves the original HTML hash through direct canonical mapping', async () => {
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl }))
    const pack = await build(), context = runContext()
    const source = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION')
    const originalHash = hash(fixture.html), legacyHash = hash(JSON.stringify({ html: fixture.html }))
    expect(originalHash).not.toBe(legacyHash)
    const outcomes = buildAcquisitionRunOutcomes(context, pack)
    expect(outcomes.find(row => row.kind === 'WEBSITE').contentHash).toBe(legacyHash.slice(7))
    bindAcquisitionSourceProcessing(context, pack)
    // Use the bound registry directly. Rebuilding it would conceal an overwrite by the binder.
    const mapped = nativePack(pack)
    const stored = mapped.rows.evidenceSources.find(row => row.sourceId === source.sourceId)
    expect(stored.contentHash).toBe(originalHash)
    expect(stored.sourceCapture).toEqual(source.sourceCapture)
    expect(new RuntimeEvidenceSource(stored).validateSync()).toBeUndefined()
    for (const row of mapped.rows.evidenceObjects.filter(row => row.sourceId === source.sourceId)) {
      expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
      expect(row.evidenceSupport.originalContentHash).toBe(originalHash)
      expect(row.evidenceSupport.exactExcerpt).toBe(fixture.captureText.slice(row.evidenceSupport.start, row.evidenceSupport.end))
    }
    expect(buildAcquisitionRunOutcomes(context, pack)).toEqual(outcomes)
  })

  test.each(['missing content hash', 'mismatched content hash', 'mismatched source identity'])('Run binding refuses %s without repairing or changing captured material', async mode => {
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl }))
    const pack = await build(), sourceId = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION').sourceId
    const source = pack.sourceRegistry.find(row => row.sourceId === sourceId)
    if (mode === 'missing content hash') delete source.contentHash
    if (mode === 'mismatched content hash') source.contentHash = hash('different synthetic material')
    if (mode === 'mismatched source identity') source.sourceCapture.sourceId = 'foreign_source'
    const before = clone(pack)
    expect(() => bindAcquisitionSourceProcessing(runContext(), pack)).toThrow('Recorded source evidence metadata is invalid.')
    expect(pack).toEqual(before)
  })

  test.each([2, 6, 10])('Run binding links all %s ordinary website captures to their actual owner and index', async count => {
    globalThis.fetch.mockImplementation(async url => response(fixture.html, { url }))
    const urls = Array.from({ length: count }, (_, index) => index === 0 ? websiteUrl : `https://capture-${index}.example/`)
    const pack = await build({ inputs: { ...inputs, websiteSources: urls } }), context = runContext()
    context.row.inputs = [{ kind: 'BRIEF', inputIndex: 0 }, ...urls.map((url, inputIndex) =>
      ({ kind: 'WEBSITE', inputIndex, contentHash: snapshotHash(url) }))]
    const original = clone(pack), outcomes = buildAcquisitionRunOutcomes(context, pack)
    expect(outcomes.filter(item => item.kind === 'WEBSITE')).toHaveLength(count)
    bindAcquisitionSourceProcessing(context, pack)
    outcomes.filter(item => item.kind === 'WEBSITE').forEach(item => {
      const source = pack.lineage.sources.find(row => row.sourceId === item.sourceId)
      const registry = pack.sourceRegistry.find(row => row.sourceId === item.sourceId)
      expect(source.sourceCapture.captureReceipt).toMatchObject({ runId: context.runId,
        attemptId: context.executionAttemptId, inputIndex: item.inputIndex })
      expect(registry.sourceCapture).toEqual(source.sourceCapture)
      expect(source.sourceCapture.originalContentHash).toBe(hash(fixture.html))
      expect(original.sourceRegistry.find(row => row.sourceId === item.sourceId).sourceCapture.captureReceipt.runId).toBeNull()
    })
    const bound = clone(pack)
    bindAcquisitionSourceProcessing(context, pack)
    expect(pack).toEqual(bound)
    expect(buildAcquisitionRunOutcomes(context, pack)).toEqual(outcomes)
    const mapped = nativePack(pack)
    const websiteIds = new Set(outcomes.filter(item => item.kind === 'WEBSITE').map(item => item.sourceId))
    expect(websiteIds.size).toBe(count)
    const mappedWebsites = mapped.rows.evidenceSources.filter(row => websiteIds.has(row.sourceId))
    expect(mappedWebsites).toHaveLength(count)
    for (const row of mappedWebsites) expect(new RuntimeEvidenceSource(row).validateSync()).toBeUndefined()
  })

  test.each([
    ['WEBSITE_DECODED_TEXT_CAPTURE', 9, true], ['WEBSITE_DECODED_TEXT_CAPTURE', 10, false],
    ['DOCUMENT_TEXT_CAPTURE', 4, true], ['DOCUMENT_TEXT_CAPTURE', 5, false],
    ['CONTROLLED_HTML_REPLAY_CAPTURE', 0, true], ['CONTROLLED_HTML_REPLAY_CAPTURE', 1, false],
  ])('capture %s index%s has the existing operation-specific bound', (operation, inputIndex, allowed) => {
    const controlled = operation === 'CONTROLLED_HTML_REPLAY_CAPTURE', document = operation === 'DOCUMENT_TEXT_CAPTURE'
    const args = { sourceId: 'synthetic-source', originalContentHash: hash('original'), captureText: 'Synthetic original statement.',
      adapter: controlled ? 'controlled-html-replay-v1' : document ? 'document-txt-text-extraction-v1' : 'website-html-fetch-v1',
      extractionMethod: document ? 'TEXT_NATIVE' : 'DECODED_HTML_STRIPPED_TEXT', capturedAt: fixture.capturedAt,
      operation, inputIndex, runId: document ? null : runContext().runId, attemptId: document ? null : runContext().executionAttemptId }
    const before = clone(args)
    if (allowed) expect(buildSourceCapture(args).captureReceipt.inputIndex).toBe(inputIndex)
    else expect(() => buildSourceCapture(args)).toThrow('Recorded source evidence metadata is invalid.')
    expect(args).toEqual(before)
  })

  test('a later invalid website binding does not partially link earlier sources', async () => {
    globalThis.fetch.mockImplementation(async url => response(fixture.html, { url }))
    const urls = [websiteUrl, 'https://second-capture.example/']
    const pack = await build({ inputs: { ...inputs, websiteSources: urls } }), context = runContext()
    context.row.inputs = [{ kind: 'BRIEF', inputIndex: 0 }, ...urls.map((url, inputIndex) =>
      ({ kind: 'WEBSITE', inputIndex, contentHash: snapshotHash(url) }))]
    const last = pack.lineage.sources.filter(row => row.type === 'WEBSITE_ACQUISITION')[1]
    pack.sourceRegistry.find(row => row.sourceId === last.sourceId).sourceCapture.captureReceipt.attemptId = 'foreign'
    const before = clone(pack)
    expect(() => bindAcquisitionSourceProcessing(context, pack)).toThrow()
    expect(pack).toEqual(before)
  })

  test.each(['missing owner attempt', 'foreign run', 'foreign attempt', 'partial link', 'wrong bound index', 'divergent source copy'])(
    'Run binding refuses %s before any source update', async mode => {
      globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl }))
      const pack = await build(), context = runContext()
      const id = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION').sourceId
      const registry = pack.sourceRegistry.find(row => row.sourceId === id)
      const source = pack.lineage.sources.find(row => row.sourceId === id)
      if (mode === 'missing owner attempt') delete context.executionAttemptId
      else {
        const receipt = { ...registry.sourceCapture.captureReceipt, runId: context.runId, attemptId: context.executionAttemptId }
        if (mode === 'foreign run') receipt.runId = '33333333-3333-4333-8333-333333333333'
        if (mode === 'foreign attempt') receipt.attemptId = '33333333-3333-4333-8333-333333333333'
        if (mode === 'partial link') receipt.attemptId = null
        if (mode === 'wrong bound index') receipt.inputIndex = 1
        registry.sourceCapture.captureReceipt = receipt
        if (mode !== 'divergent source copy') source.sourceCapture.captureReceipt = clone(receipt)
      }
      const before = clone(pack)
      expect(() => bindAcquisitionSourceProcessing(context, pack)).toThrow()
      expect(pack).toEqual(before)
    })

  test('Run binding keeps the legacy website hash when capture metadata is absent', async () => {
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl }))
    const pack = await build(), source = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION')
    const registry = pack.sourceRegistry.find(row => row.sourceId === source.sourceId)
    for (const row of [source, registry]) { delete row.sourceCapture; delete row.contentHash }
    pack.evidenceObjects.filter(row => row.sourceId === source.sourceId).forEach(row => { delete row.evidenceSupport })
    bindAcquisitionSourceProcessing(runContext(), pack)
    expect(registry.contentHash).toBe(source.valueHash)
    expect(registry).not.toHaveProperty('sourceCapture')
    expect(nativePack(pack).rows.evidenceSources.find(row => row.sourceId === source.sourceId).contentHash).toBe(source.valueHash)
  })

  test.each([websiteUrl, 'https://www.trilogywebsolutions.co.uk/clients/'])('ordinary intake captures %s with exact support instead of a search receipt', async url => {
    // Neither nominated site is fetched. The existing synthetic HTML is the only response body.
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url }))
    const pack = await build({ inputs: { ...inputs, websiteSources: [url] } })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }))
    const source = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION')
    const registry = pack.sourceRegistry.find(row => row.sourceId === source.sourceId)
    const capture = validateSourceCapture(source.sourceCapture)
    expect(source).toMatchObject({ url, finalUrl: url, status: 'ACQUIRED', adapter: 'website-html-fetch-v1' })
    expect(registry.sourceCapture).toEqual(capture)
    expect(capture).toMatchObject({ originalContentHash: hash(fixture.html), captureTextHash: hash(fixture.captureText),
      coordinateSystem: 'UTF16_CODE_UNIT', captureReceipt: { operation: 'WEBSITE_DECODED_TEXT_CAPTURE',
        runId: null, attemptId: null } })
    const evidence = pack.evidenceObjects.filter(row => row.sourceId === source.sourceId)
    expect(evidence.length).toBeGreaterThan(0)
    for (const row of evidence) {
      expect(row.reviewStatus).toBe('PENDING')
      expect(row.evidenceSupport).toMatchObject({ originalContentHash: capture.originalContentHash,
        captureTextHash: capture.captureTextHash, epistemicType: 'SOURCE_ASSERTION' })
      const support = row.evidenceSupport
      expect(support.exactExcerpt).toBe(fixture.captureText.slice(support.start, support.end))
    }
    expect(() => assertSourceEvidenceMetadataPairs({ sources: [source], evidenceObjects: evidence })).not.toThrow()
  })

  test.each([
    ['partial HTTP response', fixture.html, { status: 206 }, 'complete response'],
    ['truncated body', fixture.html + ' '.repeat(320001), { headers: { get: key =>
      key === 'content-type' ? 'text/html' : key === 'content-length' ? '1' : null } }, 'complete valid decoded response text'],
    ['invalid decoded text', fixture.html + String.fromCharCode(0xd800), {}, 'complete valid decoded response text'],
    ['oversized capture text', `<h1>The synthetic company provides reporting services</h1>${'x'.repeat(80001)}`,
      {}, 'Recorded source evidence metadata is invalid.'],
  ])('ordinary intake reports %s without inventing capture metadata or website evidence', async (_label, html, overrides, message) => {
    globalThis.fetch.mockResolvedValue(response(html, { url: websiteUrl, ...overrides }))
    const pack = await build()
    const source = pack.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION')
    expect(source).toMatchObject({ url: websiteUrl, status: 'FAILED', evidenceProduced: 0,
      failureReasonCode: 'WEBSITE_ACQUISITION_FAILED' })
    expect(source.failureReason).toContain(message)
    expect(source).not.toHaveProperty('sourceCapture')
    expect(pack.evidenceObjects.filter(row => row.acquisitionMethod === 'WEBSITE_ACQUISITION')).toEqual([])
    expect(pack.acquisition.websiteAcquisition.latestAttempt.items).toEqual([
      expect.objectContaining({ status: 'FAILED', evidenceObjectCount: 0 })])
  })

  test('an incomplete brief does not fetch a nominated URL', async () => {
    const pack = await build({ inputs: { ...inputs, companyName: '' } })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
    expect(pack.lineage.sources.some(row => row.type === 'WEBSITE_ACQUISITION')).toBe(false)
  })

  test('a refused recapture retains the previous original support and human decision in the offline builder', async () => {
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl }))
    const previous = await build()
    const source = previous.lineage.sources.find(row => row.type === 'WEBSITE_ACQUISITION')
    for (const row of previous.evidenceObjects.filter(row => row.sourceId === source.sourceId)) {
      previous.evidenceObjects = applyDiscoveryEvidenceReview({ evidenceObjects: previous.evidenceObjects,
        evidenceObjectId: row.evidenceObjectId, reviewStatus: 'ACCEPTED', actorUserId: '64b7f7a4e1e5f8320c000005',
        reviewedAt: fixture.capturedAt }).evidenceObjects
    }
    const before = JSON.stringify(previous)
    globalThis.fetch.mockResolvedValue(response(fixture.html, { url: websiteUrl, status: 206 }))
    const pack = await build({ previousEvidencePack: previous })
    expect(JSON.stringify(previous)).toBe(before)
    expect(pack.lineage.sources.find(row => row.sourceId === source.sourceId)).toEqual(source)
    expect(pack.evidenceObjects.filter(row => row.sourceId === source.sourceId))
      .toEqual(previous.evidenceObjects.filter(row => row.sourceId === source.sourceId))
    expect(pack.acquisition.websiteAcquisition.latestAttempt.items).toEqual([
      expect.objectContaining({ status: 'FAILED', retainedPrior: true, evidenceObjectCount: 0 })])
  })
})


describe('ordinary capture support and owner lineage (offline)', () => {
  const title = 'Synthetic company provides regional reporting services'
  const description = "The synthetic provider's reporting services support secure & regional operations"
  const heading = 'The synthetic platform provides\n  hybrid 😀 reporting services'
  const html = '<title>' + title + '</title><meta content="' + description.replace('&', '&amp;')
    + '" name="description"><h1>' + heading + '</h1>'
  const captureText = ' ' + title + '  ' + description + '  ' + heading + ' '
  const runId = '11111111-1111-4111-8111-111111111111'
  const attemptId = '22222222-2222-4222-8222-222222222222'
  const product = (body = html, options = {}) => buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ html: body,
    recordSourceCapture: true, ...options }))

  test('records a metadata-only description and whitespace heading as exact source text, not generated labels', () => {
    const value = product()
    expect(value.source.sourceCapture).toMatchObject({ originalContentHash: hash(html), captureTextHash: hash(captureText),
      textLength: captureText.length })
    expect(value.evidenceObjects.slice(0, 3).map(row => row.extractedFact)).toEqual([
      'Website title: ' + title, 'Website description: ' + description, 'Website heading: ' + heading.replace(/\s+/g, ' '),
    ])
    for (const row of value.evidenceObjects.slice(0, 3)) {
      const support = row.evidenceSupport
      expect(support.exactExcerpt).toBe(captureText.slice(support.start, support.end))
      expect(support.excerptHash).toBe(hash(support.exactExcerpt))
      expect(support.epistemicType).toBe('SOURCE_ASSERTION')
    }
    expect(value.evidenceObjects[2].evidenceSupport.exactExcerpt).toBe(heading)
    expect(() => native(value)).not.toThrow()
  })

  test.each([
    '<meta name="description" content="' + description.replace('&', '&amp;') + '">',
    "<meta content='The fictional company provides secure reporting services' name='description'>",
  ])('supports either metadata attribute order and quote style', meta => {
    const value = product(meta + '<h1>' + title + '</h1>')
    const row = value.evidenceObjects.find(item => item.extractedFact.startsWith('Website description:'))
    expect(row.evidenceSupport.exactExcerpt).toBe(row.extractedFact.slice('Website description: '.length))
  })

  test('decodes metadata entities once without interpreting decoded text as HTML', () => {
    const body = '<meta name="description" content="The fictional company provides &lt;regional&gt; reporting &amp;amp; monitoring services"><h1>' + title + '</h1>'
    const value = product(body)
    const exact = 'The fictional company provides <regional> reporting &amp; monitoring services'
    const row = value.evidenceObjects.find(item => item.extractedFact.startsWith('Website description:'))
    expect(row.extractedFact).toBe('Website description: ' + exact)
    expect(row.evidenceSupport.exactExcerpt).toBe(exact)
    expect(value.source.sourceCapture.captureTextHash).toBe(hash(' ' + exact + '  ' + title + ' '))
  })

  test('keeps repeated optional metadata and headings unsupported rather than guessing a location', () => {
    const value = product(html + '<p>' + description + '</p><h2>' + heading + '</h2>')
    for (const kind of ['description', 'heading']) {
      expect(value.evidenceObjects.find(row => row.extractedFact.startsWith('Website ' + kind + ':')).evidenceSupport).toBeUndefined()
    }
  })

  test('retains nested inline heading whitespace and Unicode in extracted-text coordinates', () => {
    const value = product('<title>' + title + '</title><h1>The synthetic platform provides\n  <span>hybrid 😀</span> reporting services</h1>')
    const row = value.evidenceObjects.find(item => item.extractedFact.startsWith('Website heading:'))
    expect(row.evidenceSupport.exactExcerpt).toBe('The synthetic platform provides\n   hybrid 😀  reporting services')
    expect(row.evidenceSupport.end - row.evidenceSupport.start).toBe(row.evidenceSupport.exactExcerpt.length)
  })

  test('metadata capture does not introduce metadata into existing body candidates', () => {
    const captured = product().evidenceObjects.filter(row => row.extractedFact.startsWith('Website body:'))
    const legacy = product(html, { recordSourceCapture: false }).evidenceObjects.filter(row => row.extractedFact.startsWith('Website body:'))
    expect(captured.map(row => row.extractedFact)).toEqual(legacy.map(row => row.extractedFact))
    expect(captured.every(row => !row.extractedFact.includes(description))).toBe(true)
  })

  test('controlled producer keeps its frozen legacy capture hash and qualified paragraphs', () => {
    const controlled = JSON.parse(readFileSync(new URL('./fixtures/controlledLongWebsitePage.json', import.meta.url), 'utf8'))
    const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-capture.1', bindingVersion: 1,
      classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
      scope: { customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24) },
      revisionId: 'synthetic-capture-r1', basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
      actorUserId: '4'.repeat(24), authorityRef: 'synthetic:authority', isolationRef: 'synthetic:isolation',
      fixture: { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
        fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
        htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: controlled.url } }
    const descriptor = { binding, provenance: { contractVersion: 'controlled-replay-provenance.v1',
      classification: 'CONTROLLED_SYNTHETIC_REPLAY', operation: 'CONTROLLED_HTML_REPLAY_CAPTURE',
      adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId, bindingVersion: binding.bindingVersion,
      bindingDigest: storedControlledReplayBindingDigest(binding), ...binding.fixture } }
    const value = buildControlledReplayEvidenceFromDecodedHtml({ html: controlled.html, descriptor,
      acquisitionProfile: 'STANDARD', runId, attemptId, capturedAt: controlled.capturedAt })
    expect(value.source.sourceCapture).toMatchObject({ textLength: 3623,
      captureTextHash: 'sha256:f242dd6378a58a934eada9e4ee2434ca5c44b17b649c7a34c3238402ac26a1fe',
      captureReceipt: { operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', runId, attemptId, inputIndex: 0 } })
    expect(value.evidenceObjects.slice(0, controlled.contexts.length).map(row => row.evidenceSupport.exactExcerpt)).toEqual(controlled.contexts)
  })

  test('capture-off/default output stays byte-identical and never acquires span or receipt metadata', () => {
    const defaults = buildWebsiteDiscoveryEvidenceFromDecodedHtml(decodedArgs({ html }))
    const disabled = product(html, { recordSourceCapture: false })
    expect(defaults).toEqual(disabled)
    expect(defaults.source).not.toHaveProperty('sourceCapture')
    expect(defaults.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
  })

  test.each([
    [runId, attemptId], [null, null],
  ])('website receipt accepts complete owner pair %s/%s and legacy nulls', (run, attempt) => {
    const capture = clone(product().source.sourceCapture)
    Object.assign(capture.captureReceipt, { runId: run, attemptId: attempt })
    expect(validateSourceCapture(capture)).toEqual(capture)
    expect(new RuntimeEvidenceSource({ ...native(product()).rows.evidenceSources[0], sourceCapture: capture }).validateSync()).toBeUndefined()
  })

  test.each([[runId, null], [null, attemptId], ['pretend', attemptId], [runId, 'pretend']])(
    'rejects partial or invalid website owner pair %s/%s', (run, attempt) => {
      const capture = clone(product().source.sourceCapture)
      Object.assign(capture.captureReceipt, { runId: run, attemptId: attempt })
      expect(() => validateSourceCapture(capture)).toThrow('Recorded source evidence metadata is invalid.')
    })

  test('does not extend document receipt grammar to website owner linkage', () => {
    const capture = buildSourceCapture({ sourceId: 'document', originalContentHash: hash('document text'), captureText: 'document text',
      adapter: 'document-txt-text-extraction-v1', extractionMethod: 'TEXT_NATIVE', capturedAt: fixture.capturedAt, inputIndex: 0 })
    Object.assign(capture.captureReceipt, { runId, attemptId })
    expect(() => validateSourceCapture(capture)).toThrow()
  })
})
