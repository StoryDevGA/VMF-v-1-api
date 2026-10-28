import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { acquireWebsiteDiscoveryEvidence, normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { assertRetainedWebsiteMaterial, reconcileWebsiteMaterial } from '../services/discoveryWebsiteMaterialService.js'
import { validateSourceCapture } from '../services/sourceEvidenceContract.js'

const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
const capturedAt = '2026-10-05T10:00:00.000Z'
const fact = 'The synthetic business provides workflow monitoring services to test customers in the United Kingdom.'
const web = async (url = 'https://material.example/', text = fact) => {
  const html = `<html><p>${text}</p></html>`
  globalThis.fetch.mockResolvedValue({ ok: true, status: 200, url, headers: { get: key =>
    key === 'content-type' ? 'text/html' : key === 'content-length' ? String(html.length) : null }, text: async () => html })
  const result = await acquireWebsiteDiscoveryEvidence({ websiteUrl: url, acquisitionProfile: 'STANDARD', acquiredAt: capturedAt })
  return { sources: [result.source], sourceRegistry: [result.sourceRegistryEntry],
    evidenceObjects: normalizeDiscoveryEvidenceObjects({ sources: [result.source], evidenceObjects: result.evidenceObjects }) }
}
const combine = (...parts) => Object.fromEntries(['sources', 'sourceRegistry', 'evidenceObjects'].map(key => [key, parts.flatMap(part => part[key])]))
const pack = result => ({ lineage: { sources: result.sources }, sourceRegistry: result.sourceRegistry, evidenceObjects: result.evidenceObjects })
const failure = source => ({ sources: [{ ...source, sourceId: source.sourceId.replace('website_', 'website_failed_'), status: 'FAILED', evidenceProduced: 0 }],
  sourceRegistry: [{ sourceId: source.sourceId.replace('website_', 'website_failed_'), sourceType: 'WEBSITE', url: source.url,
    status: 'FAILED', acquisitionStatus: 'FAILED', evidenceProduced: 0 }], evidenceObjects: [] })
beforeEach(() => {
  globalThis.fetch = jest.fn()
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns })

test.each(['ACCEPTED', 'REJECTED'])('failed retry retains exact source and recorded %s evidence; counts are not fresh production', async reviewStatus => {
  const previous = await web()
  previous.evidenceObjects = previous.evidenceObjects.map(row => ({ ...row, reviewStatus, auditRef: 'prior-human-decision' }))
  const before = JSON.stringify(previous)
  const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(previous), fresh: failure(previous.sources[0]) })
  expect(result.sources).toEqual(previous.sources)
  expect(result.sourceRegistry).toEqual(previous.sourceRegistry)
  expect(result.evidenceObjects).toEqual(previous.evidenceObjects)
  expect(result.items).toEqual([{ inputIndex: 0, status: 'FAILED', sourceId: previous.sources[0].sourceId,
    retainedPrior: true, evidenceObjectCount: 0, retainedEvidenceObjectCount: previous.evidenceObjects.length, reason: 'WEBSITE_ACQUISITION_FAILED' }])
  expect(JSON.stringify(previous)).toBe(before)
})

test('failed and unattempted sources survive while a successful changed source replaces only its population', async () => {
  const first = await web(), second = await web('https://second.example/'), third = await web('https://third.example/')
  const changed = await web('https://second.example/', 'The changed synthetic company provides accounting services to other customers in the United Kingdom.')
  const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(combine(first, second, third)), fresh: combine(failure(first.sources[0]), changed) })
  expect(result.sources).toHaveLength(3)
  expect(result.evidenceObjects).toEqual([...first.evidenceObjects, ...third.evidenceObjects, ...changed.evidenceObjects])
  expect(result.items.map(item => [item.status, item.evidenceObjectCount])).toEqual([['FAILED', 0], ['SUCCEEDED', changed.evidenceObjects.length]])
  expect(result.sources.find(row => row.sourceId === second.sources[0].sourceId).valueHash).toBe(changed.sources[0].valueHash)
})

test('failed-only URL becomes one actual canonical successful source, without a duplicate failed row', async () => {
  const fresh = await web()
  const prior = failure(fresh.sources[0])
  const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh })
  expect(result.sources).toEqual(fresh.sources)
  expect(result.sourceRegistry).toEqual(fresh.sourceRegistry)
  expect(result.evidenceObjects).toEqual(fresh.evidenceObjects)
})

test('legacy short hash is retained literally on failure, not upgraded or inferred', async () => {
  const prior = await web(); prior.sources[0].valueHash = prior.sources[0].valueHash.slice(0, 19)
  const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: failure(prior.sources[0]) })
  expect(result.sources[0].valueHash).toBe(prior.sources[0].valueHash)
})

test.each(['duplicate-url', 'duplicate-id', 'missing-registry', 'registry-url', 'dangling-evidence', 'duplicate-evidence', 'wrong-method', 'malformed-array', 'unexpected-success-id', 'failed-only-decision'])('%s ambiguity fails closed', async scenario => {
  const fresh = await web(), prior = structuredClone(fresh)
  if (scenario === 'duplicate-url') prior.sources.push({ ...prior.sources[0], sourceId: 'other' })
  if (scenario === 'duplicate-id') prior.sources.push({ ...prior.sources[0], url: 'https://second.example/' })
  if (scenario === 'missing-registry') prior.sourceRegistry = []
  if (scenario === 'registry-url') prior.sourceRegistry[0].url = 'https://different.example/'
  if (scenario === 'dangling-evidence') prior.evidenceObjects[0].sourceId = 'missing-source'
  if (scenario === 'duplicate-evidence') prior.evidenceObjects.push(prior.evidenceObjects[0])
  if (scenario === 'wrong-method') prior.evidenceObjects[0].acquisitionMethod = 'CUSTOMER_PROVIDED_INPUT'
  if (scenario === 'malformed-array') prior.sources = 'invalid'
  if (scenario === 'unexpected-success-id') prior.sources[0].sourceId = prior.sourceRegistry[0].sourceId = 'unsupported-identity'
  if (scenario === 'failed-only-decision') {
    const failed = failure(fresh.sources[0]); Object.assign(prior, failed)
    prior.sourceRegistry[0].acceptedEvidenceObjects = 1
  }
  expect(() => reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh })).toThrow(/continuity could not be verified/)
})

test('empty next attempt preserves source material; no synthetic latest attempt is inferred', async () => {
  const prior = await web()
  const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: { sources: [], sourceRegistry: [], evidenceObjects: [] } })
  expect(result.sources).toEqual(prior.sources)
  expect(result.evidenceObjects).toEqual(prior.evidenceObjects)
  expect(result.items).toEqual([])
})

test('normalization cannot silently alter retained audit history', async () => {
  const prior = await web()
  prior.evidenceObjects[0].auditRef = 'recorded-audit'
  prior.evidenceObjects[0].auditRefs = ['recorded-audit', 'recorded-audit']
  const normalized = normalizeDiscoveryEvidenceObjects({ evidenceObjects: prior.evidenceObjects, sources: prior.sources })
  expect(normalized[0].auditRefs).toEqual(['recorded-audit'])
  expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: prior.evidenceObjects, evidenceObjects: normalized })).toThrow(/continuity/)
})

test.each(['before', 'after'])('cross-method duplicate evidence identity %s fails prior and final cardinality guards', async order => {
  const prior = await web()
  const collision = { ...prior.evidenceObjects[0], acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT', sourceId: 'input_companyName' }
  const duplicate = order === 'before' ? [collision, ...prior.evidenceObjects] : [...prior.evidenceObjects, collision]
  expect(() => reconcileWebsiteMaterial({ previousEvidencePack: { ...pack(prior), evidenceObjects: duplicate }, fresh: failure(prior.sources[0]) })).toThrow(/continuity/)
  expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: prior.evidenceObjects, evidenceObjects: duplicate })).toThrow(/continuity/)
})

test.each(['lineage', 'registry'])('cross-type %s source identity collision fails closed', async target => {
  const prior = await web()
  const duplicate = { sourceId: prior.sources[0].sourceId, type: 'USER_PROVIDED_INPUT', sourceType: 'DISCOVERY_INPUT', fieldKey: 'companyName' }
  prior[target === 'lineage' ? 'sources' : 'sourceRegistry'].push(duplicate)
  expect(() => reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: failure(prior.sources[0]) })).toThrow(/continuity/)
})

describe('recorded capture/support retry continuity', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
  const clone = value => JSON.parse(JSON.stringify(value))
  const empty = () => ({ sources: [], sourceRegistry: [], evidenceObjects: [] })
  const captured = async (html = fixture.html, stamp = fixture.capturedAt, recordSourceCapture = true) => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, url: fixture.url,
      headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(Buffer.byteLength(html)) : null },
      text: async () => html })
    const product = await acquireWebsiteDiscoveryEvidence({ websiteUrl: fixture.url, acquisitionProfile: 'STANDARD',
      acquiredAt: stamp, recordSourceCapture })
    return { sources: [product.source], sourceRegistry: [product.sourceRegistryEntry],
      evidenceObjects: normalizeDiscoveryEvidenceObjects({ sources: [product.source], evidenceObjects: product.evidenceObjects }) }
  }
  const failed = source => {
    const result = failure(source)
    // A failed new acquisition has no new capture, rather than a copied prior receipt.
    delete result.sources[0].sourceCapture; delete result.sources[0].contentHash
    return result
  }
  const expectConflict = operation => {
    let error
    try { operation() } catch (caught) { error = caught }
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'ACQUISITION_CONTINUITY_BLOCKED' } })
  }

  test.each([
    ['failed', 'ACCEPTED'], ['failed', 'REJECTED'], ['unattempted', 'ACCEPTED'], ['unattempted', 'REJECTED'],
  ])('%s retry preserves literal capture/support and %s history', async (attempt, reviewStatus) => {
    const prior = await captured()
    prior.evidenceObjects.forEach(row => { row.reviewStatus = reviewStatus; row.auditRef = 'recorded-human-decision' })
    prior.evidenceObjects = normalizeDiscoveryEvidenceObjects({ sources: prior.sources, evidenceObjects: prior.evidenceObjects })
    const before = JSON.stringify(prior)
    const next = attempt === 'failed' ? failed(prior.sources[0]) : empty()
    const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: next })
    expect(result.sources).toEqual(prior.sources)
    expect(result.sourceRegistry).toEqual(prior.sourceRegistry)
    expect(result.evidenceObjects).toEqual(prior.evidenceObjects)
    expect(result.evidenceObjects.every(row => row.evidenceSupport)).toBe(true)
    expect(result.sources[0].capturedAt).toBe(fixture.capturedAt)
    const normalized = normalizeDiscoveryEvidenceObjects({ sources: result.sources, evidenceObjects: result.evidenceObjects })
    expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: result.retainedEvidence, evidenceObjects: normalized })).not.toThrow()
    expect(JSON.stringify(prior)).toBe(before)
    if (attempt === 'failed') expect(result.items[0]).toMatchObject({ retainedPrior: true, evidenceObjectCount: 0 })
    else expect(result.items).toEqual([])
  })
  test('permits a real changed successful capture and fresh PENDING population without inheriting decisions', async () => {
    const prior = await captured()
    prior.evidenceObjects.forEach(row => { row.reviewStatus = 'ACCEPTED'; row.auditRef = 'old-decision' })
    const fresh = await captured(fixture.html.replace('reporting services', 'accounting services'), '2026-10-19T10:01:00.000Z')
    const before = JSON.stringify({ prior, fresh })
    const result = reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh })
    expect(result.sources).toEqual(fresh.sources)
    expect(result.sourceRegistry).toEqual(fresh.sourceRegistry)
    expect(result.evidenceObjects).toEqual(fresh.evidenceObjects)
    expect(result.sources[0].sourceCapture).not.toEqual(prior.sources[0].sourceCapture)
    expect(result.evidenceObjects.every(row => row.reviewStatus === 'PENDING' && row.auditRef === '')).toBe(true)
    expect(result.retainedEvidence).toEqual([])
    expect(JSON.stringify({ prior, fresh })).toBe(before)
  })
  test.each(['drop', 'change', 'add'])('rejects retained support %s without upgrading legacy material', async change => {
    const recorded = await captured()
    const prior = change === 'add' ? await captured(fixture.html, fixture.capturedAt, false) : recorded
    const next = clone(prior.evidenceObjects)
    if (change === 'drop') delete next[0].evidenceSupport
    if (change === 'change') next[0].evidenceSupport.start++
    if (change === 'add') next[0].evidenceSupport = clone(recorded.evidenceObjects[0].evidenceSupport)
    expectConflict(() => assertRetainedWebsiteMaterial({ retainedEvidence: prior.evidenceObjects, evidenceObjects: next }))
  })
  const mutations = [
    ['missing lineage capture', value => { delete value.sources[0].sourceCapture }],
    ['missing registry capture', value => { delete value.sourceRegistry[0].sourceCapture }],
    ['missing lineage content hash', value => { delete value.sources[0].contentHash }],
    ['foreign capture source', value => { value.sourceRegistry[0].sourceCapture.sourceId = 'foreign-source' }],
    ['tampered support hash', value => { value.evidenceObjects[0].evidenceSupport.excerptHash = 'sha256:' + 'f'.repeat(64) }],
    ['different individually valid capture without supported evidence', value => {
      value.evidenceObjects.forEach(row => { delete row.evidenceSupport })
      value.sourceRegistry[0].sourceCapture.captureTextHash = 'sha256:' + 'f'.repeat(64)
    }],
    ['different individually valid original hash without supported evidence', value => {
      value.evidenceObjects.forEach(row => { delete row.evidenceSupport })
      value.sourceRegistry[0].sourceCapture.originalContentHash = value.sourceRegistry[0].contentHash = 'sha256:' + 'f'.repeat(64)
    }],
  ]
  test.each(['previous', 'fresh'])('rejects asymmetric, tampered and divergent %s attempt owners before assembly', async side => {
    const original = await captured()
    for (const [label, mutate] of mutations) {
      const changed = clone(original); mutate(changed)
      if (label.startsWith('different individually valid')) {
        for (const source of [changed.sources[0], changed.sourceRegistry[0]]) {
          expect(() => validateSourceCapture(source.sourceCapture, { sourceId: source.sourceId, contentHash: source.contentHash })).not.toThrow()
        }
      }
      const previousEvidencePack = pack(side === 'previous' ? changed : original)
      const fresh = side === 'fresh' ? changed : empty()
      const before = JSON.stringify({ previousEvidencePack, fresh })
      expectConflict(() => reconcileWebsiteMaterial({ previousEvidencePack, fresh }))
      expect(JSON.stringify({ previousEvidencePack, fresh })).toBe(before)
    }
  })
  test('rejects unsupported capture absence even when only a support envelope remains', async () => {
    const prior = await captured()
    delete prior.sources[0].sourceCapture; delete prior.sourceRegistry[0].sourceCapture
    expectConflict(() => reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: empty() }))
  })
  test('propagates an unexpected dependency failure rather than rewriting it as a known contract conflict', async () => {
    const prior = await captured(), unexpected = new Error('Unexpected metadata dependency failure')
    prior.sources[0].sourceCapture = new Proxy(prior.sources[0].sourceCapture, { ownKeys: () => { throw unexpected } })
    let actual
    try { reconcileWebsiteMaterial({ previousEvidencePack: pack(prior), fresh: empty() }) } catch (error) { actual = error }
    expect(actual).toBe(unexpected)
  })
})

// Explicitly authored metadata witness, not a capture or native authorization receipt.
const metadataDescriptor = (native = { customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24), runtimeInstanceKey: 'runtime-one' }) => {
  const fixture = { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
    fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
    htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: 'https://controlled-context.example/case-study' }
  const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-metadata-only', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
    scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, String(native[key])])),
    revisionId: native.runtimeInstanceKey, basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
    actorUserId: '4'.repeat(24), authorityRef: 'synthetic:authority', isolationRef: 'synthetic:isolation', fixture }
  return { binding, provenance: { contractVersion: 'controlled-replay-provenance.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: 1, bindingDigest: storedControlledReplayBindingDigest(binding), ...fixture } }
}

test('retained descriptor cannot silently change/drop/add, and actual fetched producer cannot be relabelled', async () => {
  const descriptor = metadataDescriptor(), prior = { evidenceObjectId: 'synthetic-evidence', sourceId: 'synthetic-source',
    extractedFact: 'The synthetic trial has not started.', controlledReplayProvenance: descriptor }
  expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: [prior], evidenceObjects: [JSON.parse(JSON.stringify(prior))] })).not.toThrow()
  for (const next of [{ ...prior, controlledReplayProvenance: undefined },
    { ...prior, controlledReplayProvenance: { ...descriptor, extra: true } }]) {
    expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: [prior], evidenceObjects: [next] }))
      .toThrow('Website source continuity could not be verified')
  }
  const { controlledReplayProvenance: ignored, ...plain } = prior
  expect(ignored).toEqual(descriptor)
  expect(() => assertRetainedWebsiteMaterial({ retainedEvidence: [plain], evidenceObjects: [prior] }))
    .toThrow('Website source continuity could not be verified')
  const actual = await web('https://controlled-context.example/case-study')
  expect(actual.sources[0].sourceCapture).toBeUndefined()
  // A metadata-only registry/evidence view must not hide this actual default-fetch lineage.
  const controlledRegistry = [{ sourceId: actual.sources[0].sourceId, sourceType: 'WEBSITE', acquisitionStatus: 'NOT_ATTEMPTED',
    url: descriptor.binding.fixture.sourceUrl, controlledReplayProvenance: descriptor }]
  const controlledEvidence = [{ evidenceObjectId: 'synthetic-metadata-evidence', sourceId: actual.sources[0].sourceId,
    extractedFact: 'The synthetic trial has not started.', acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT', controlledReplayProvenance: descriptor }]
  const changedDescriptor = metadataDescriptor(); changedDescriptor.binding.authorityRef = 'synthetic:changed'
  changedDescriptor.provenance.bindingDigest = storedControlledReplayBindingDigest(changedDescriptor.binding)
  for (const lineage of [actual.sources,
    [{ ...controlledRegistry[0], controlledReplayProvenance: undefined }],
    [{ ...controlledRegistry[0], controlledReplayProvenance: changedDescriptor }]]) {
    expect(() => normalizeDiscoveryEvidenceObjects({ sources: lineage, sourceRegistry: controlledRegistry,
      evidenceObjects: controlledEvidence })).toThrow('Controlled replay metadata is invalid')
    expect(() => buildDiscoverySourceRegistry({ sources: lineage, sourceRegistry: controlledRegistry,
      evidenceObjects: controlledEvidence })).toThrow('Controlled replay metadata is invalid')
  }
  for (const row of [...actual.sources, ...actual.sourceRegistry, ...actual.evidenceObjects]) row.controlledReplayProvenance = descriptor
  expect(() => reconcileWebsiteMaterial({ fresh: actual })).toThrow('Website source continuity could not be verified')
  expect(() => normalizeDiscoveryEvidenceObjects({ sources: actual.sources, evidenceObjects: actual.evidenceObjects }))
    .toThrow('Controlled replay metadata is invalid')
})
