import { jest } from '@jest/globals'
import { acquireWebsiteDiscoveryEvidence, normalizeDiscoveryEvidenceObjects } from '../services/discoveryIntelligenceService.js'
import { assertRetainedWebsiteMaterial, reconcileWebsiteMaterial } from '../services/discoveryWebsiteMaterialService.js'

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
