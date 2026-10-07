import { createHash, randomUUID } from 'node:crypto'
import { jest } from '@jest/globals'
import { acquisitionContradictionReviewEpoch, preserveDiscoveryEvidenceDecisions } from '../services/discoveryEvidenceContinuityService.js'
import { acquireWebsiteDiscoveryEvidence, ingestUploadedDocumentDiscoveryEvidence, normalizeDiscoveryEvidenceObjects } from '../services/discoveryIntelligenceService.js'
import { getDiscoveryContradictionReview, DISCOVERY_CONTRADICTION_REVIEW_CONTRACT } from '../services/discoveryContradictionReviewService.js'

const capturedAt = '2026-10-05T10:00:00.000Z'
const actor = '507f1f77bcf86cd799439012'
const doc = { fileName: 'synthetic.txt', mimeType: 'text/plain', textContent:
  'The synthetic business provides workflow monitoring services to test customers in the United Kingdom.' }
const normalize = result => ({ ...result, evidenceObjects: normalizeDiscoveryEvidenceObjects({
  evidenceObjects: result.evidenceObjects, sources: result.sources, acquisitionProfile: 'STANDARD', createdAt: capturedAt,
}) })
const document = async () => normalize(await ingestUploadedDocumentDiscoveryEvidence({
  documentSources: [doc], acquisitionProfile: 'STANDARD', capturedAt, batchOutcomes: true,
}))
const decided = (result, status = 'ACCEPTED') => ({ lineage: { sources: result.sources },
  evidenceObjects: result.evidenceObjects.map(item => ({ ...item, reviewStatus: status,
    acceptedBy: status === 'ACCEPTED' ? actor : '', acceptanceTimestamp: status === 'ACCEPTED' ? capturedAt : '',
    rejectedBy: status === 'REJECTED' ? actor : '', rejectionTimestamp: status === 'REJECTED' ? capturedAt : '',
    auditRef: 'recorded-human-decision', auditRefs: ['registration', 'recorded-human-decision'],
  })) })
const reconcile = (fresh, previous) => preserveDiscoveryEvidenceDecisions({ ...fresh, previousEvidencePack: previous })

test.each(['ACCEPTED', 'REJECTED'])('identical actual document extraction preserves recorded %s metadata', async status => {
  const previous = decided(await document(), status)
  const fresh = await document()
  const next = reconcile(fresh, previous)
  expect(next[0]).toMatchObject({ reviewStatus: status, auditRef: 'recorded-human-decision' })
  expect(next[0][status === 'ACCEPTED' ? 'acceptedBy' : 'rejectedBy']).toBe(actor)
  expect(fresh.evidenceObjects[0].reviewStatus).toBe('PENDING')
  expect(normalize({ sources: fresh.sources, evidenceObjects: next }).evidenceObjects[0].validationStatus)
    .toBe(status === 'ACCEPTED' ? 'VALIDATED' : 'REJECTED')
})

test.each([
  ['content hash', 'source', 'valueHash', `sha256:${'a'.repeat(64)}`],
  ['conflicting hash alias', 'source', 'documentHash', `sha256:${'b'.repeat(64)}`],
  ['profile', 'source', 'acquisitionProfile', 'ENHANCED'],
  ['adapter', 'source', 'adapter', 'new-extractor'],
  ['extraction', 'source', 'extractionMethod', 'PDF_OCR'],
  ['ingestion', 'source', 'ingestionMode', 'OCR'],
  ['file provenance', 'evidence', 'sourceFileName', 'other.txt'],
  ['fact', 'evidence', 'extractedFact', 'Changed statement'],
  ['lineage', 'evidence', 'lineageRef', 'different-lineage'],
  ['confidence', 'evidence', 'confidence', { level: 'UNKNOWN' }],
  ['classification', 'evidence', 'category', 'Other'],
  ['type', 'source', 'sourceType', 'OTHER'],
  ['missing provenance', 'source', 'fileName', undefined],
])('changed %s cannot inherit a decision', async (name, group, field, value) => {
  const previous = decided(await document())
  const fresh = await document()
  ;(group === 'source' ? fresh.sources[0] : fresh.evidenceObjects[0])[field] = value
  expect(reconcile(fresh, previous)[0].reviewStatus).toBe('PENDING')
})

test.each(['missing-hash', 'missing-source', 'duplicate-old-source', 'duplicate-new-source',
  'duplicate-old-evidence', 'duplicate-new-evidence', 'invalid-actor', 'invalid-time', 'missing-audit'])('%s linkage fails closed without fabricating a decision', async scenario => {
    const previous = decided(await document())
    const fresh = await document()
    if (scenario === 'missing-hash') { delete previous.lineage.sources[0].valueHash; delete previous.lineage.sources[0].documentHash }
    if (scenario === 'missing-source') previous.lineage.sources = []
    if (scenario === 'duplicate-old-source') previous.lineage.sources.push(previous.lineage.sources[0])
    if (scenario === 'duplicate-new-source') fresh.sources.push(fresh.sources[0])
    if (scenario === 'duplicate-old-evidence') previous.evidenceObjects.push(previous.evidenceObjects[0])
    if (scenario === 'duplicate-new-evidence') fresh.evidenceObjects.push(fresh.evidenceObjects[0])
    if (scenario === 'invalid-actor') previous.evidenceObjects[0].acceptedBy = { id: actor }
    if (scenario === 'invalid-time') previous.evidenceObjects[0].acceptanceTimestamp = 'unknown'
    if (scenario === 'missing-audit') previous.evidenceObjects[0].auditRef = ''
    expect(reconcile(fresh, previous)[0].reviewStatus).toBe('PENDING')
  })

test('actual website producer preserves identical provenance but changed final redirect invalidates it', async () => {
  const originalFetch = globalThis.fetch
  const originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
  let html = '<html><title>Synthetic business</title><p>The synthetic business provides workflow monitoring services to test customers in the United Kingdom.</p></html>'
  let finalUrl = 'https://continuity.example/original'
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
  globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, url: finalUrl,
    headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(html.length) : null },
    text: async () => html }))
  const website = async () => {
    const result = await acquireWebsiteDiscoveryEvidence({ acquisitionProfile: 'STANDARD', acquiredAt: capturedAt, websiteUrl: 'https://continuity.example/' })
    return normalize({ sources: [result.source], evidenceObjects: result.evidenceObjects })
  }
  try {
    const previous = decided(await website())
    expect(previous.lineage.sources[0].valueHash).toBe(`sha256:${createHash('sha256').update(JSON.stringify({ html })).digest('hex')}`)
    expect(reconcile(await website(), previous).every(item => item.reviewStatus === 'ACCEPTED')).toBe(true)
    const legacy = structuredClone(previous)
    legacy.lineage.sources[0].valueHash = legacy.lineage.sources[0].valueHash.slice(0, 19)
    expect(reconcile(await website(), legacy).every(item => item.reviewStatus === 'PENDING')).toBe(true)
    finalUrl = 'https://continuity.example/changed'
    const fresh = await website()
    expect(fresh.sources[0].sourceId).toBe(previous.lineage.sources[0].sourceId)
    expect(fresh.evidenceObjects.map(item => item.evidenceObjectId)).toEqual(previous.evidenceObjects.map(item => item.evidenceObjectId))
    expect(fresh.sources[0].valueHash).toBe(previous.lineage.sources[0].valueHash)
    expect(reconcile(fresh, previous).every(item => item.reviewStatus === 'PENDING')).toBe(true)
    finalUrl = 'https://continuity.example/original'
    html = '<html><p>The changed synthetic business provides accounting services to other test customers in the United Kingdom.</p></html>'
    const changedContent = await website()
    expect(changedContent.sources[0].sourceId).toBe(previous.lineage.sources[0].sourceId)
    expect(changedContent.sources[0].valueHash).not.toBe(previous.lineage.sources[0].valueHash)
    expect(reconcile(changedContent, previous).every(item => item.reviewStatus === 'PENDING')).toBe(true)
  } finally { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns }
})

test('unchanged pair remains current after unrelated acquisition; changed pair remains stale', () => {
  const epoch = randomUUID()
  const evidence = [0, 1].map(i => ({ evidenceObjectId: `evidence-${i}`, sourceId: `source-${i}`,
    extractedFact: `Synthetic statement ${i}`, lineageRef: `lineage-${i}`, reviewStatus: 'ACCEPTED', validationStatus: 'VALIDATED' }))
  const candidate = { contradictionId: 'candidate', domain: 'Proof', severity: 'MEDIUM', basis: 'Actual detector basis',
    evidenceObjectIds: evidence.map(item => item.evidenceObjectId) }
  const hash = getDiscoveryContradictionReview(candidate, evidence, [], actor, epoch).evidencePairHash
  const review = { contradictionId: candidate.contradictionId, contractVersion: DISCOVERY_CONTRADICTION_REVIEW_CONTRACT,
    runtimeInstanceId: actor, reviewEpoch: epoch, evidencePairHash: hash, reviewId: randomUUID(), reviewedBy: actor,
    reviewedAt: capturedAt, rationale: 'The synthetic statements describe different subjects.', disposition: 'NOT_CONTRADICTORY' }
  const currentEpoch = acquisitionContradictionReviewEpoch(epoch)
  const expanded = [...evidence, { evidenceObjectId: 'unrelated', sourceId: 'unrelated', extractedFact: 'New unrelated input' }]
  expect(getDiscoveryContradictionReview(candidate, expanded, [review], actor, currentEpoch).reviewStatus).toBe('NOT_CONTRADICTORY')
  expanded[0] = { ...expanded[0], extractedFact: 'Changed synthetic statement' }
  expect(getDiscoveryContradictionReview(candidate, expanded, [review], actor, currentEpoch).reviewStatus).toBe('STALE')
  expect(getDiscoveryContradictionReview({ ...candidate, basis: 'Changed detector' }, evidence, [review], actor, currentEpoch).reviewStatus).toBe('STALE')
})

test('legacy absent epoch stays empty and malformed epoch cannot revive old history', () => {
  expect(acquisitionContradictionReviewEpoch(undefined)).toBe('')
  expect(acquisitionContradictionReviewEpoch('')).toBe('')
  expect(acquisitionContradictionReviewEpoch('bad')).toMatch(/^[a-f0-9-]{36}$/)
})
