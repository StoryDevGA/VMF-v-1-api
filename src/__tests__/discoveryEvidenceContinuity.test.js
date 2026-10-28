import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { createHash, randomUUID } from 'node:crypto'
import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { acceptanceContradictionReviewEpoch, acquisitionContradictionReviewEpoch, preserveDiscoveryEvidenceDecisions } from '../services/discoveryEvidenceContinuityService.js'
import { acquireWebsiteDiscoveryEvidence, ingestUploadedDocumentDiscoveryEvidence, normalizeDiscoveryEvidenceObjects } from '../services/discoveryIntelligenceService.js'
import { getDiscoveryContradictionReview, DISCOVERY_CONTRADICTION_REVIEW_CONTRACT } from '../services/discoveryContradictionReviewService.js'
import { assertSourceEvidenceMetadataPairs, buildSourceCapture, buildEvidenceSupport } from '../services/sourceEvidenceContract.js'

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

describe('shared capture material binds original human decisions', () => {
  const clone = value => JSON.parse(JSON.stringify(value))
  const produce = async (batchOutcomes = true, stamp = capturedAt) => normalize(await ingestUploadedDocumentDiscoveryEvidence({
    documentSources: [doc], acquisitionProfile: 'STANDARD', capturedAt: stamp, batchOutcomes,
  }))
  const expectFresh = (fresh, previous) => {
    const before = JSON.stringify({ fresh, previous }), next = reconcile(fresh, previous)
    next.forEach((row, index) => expect(row).toBe(fresh.evidenceObjects[index]))
    expect(next.every(row => row.reviewStatus === 'PENDING' && row.auditRef === '')).toBe(true)
    expect(JSON.stringify({ fresh, previous })).toBe(before)
  }
  test.each(['ACCEPTED', 'REJECTED'])('later actual document capture and correlation-only index derivative retain original %s review time', async status => {
    const previous = decided(await produce(), status)
    const fresh = await produce(true, '2026-10-19T11:00:00.000Z')
    // Contract-only correlation derivative, not a claim about changed producer batch identity.
    fresh.sources[0].sourceCapture.captureReceipt.inputIndex = 1
    const before = JSON.stringify({ fresh, previous })
    const next = reconcile(fresh, previous)
    const timeKey = status === 'ACCEPTED' ? 'acceptanceTimestamp' : 'rejectionTimestamp'
    expect(next[0]).toMatchObject({ reviewStatus: status, auditRef: 'recorded-human-decision',
      auditRefs: ['registration', 'recorded-human-decision'], [timeKey]: capturedAt })
    expect(next[0][timeKey]).not.toBe(fresh.sources[0].sourceCapture.capturedAt)
    expect(normalize({ ...fresh, evidenceObjects: next }).evidenceObjects[0].validationStatus)
      .toBe(status === 'ACCEPTED' ? 'VALIDATED' : 'REJECTED')
    expect(JSON.stringify({ fresh, previous })).toBe(before)
  })
  test.each(['ACCEPTED', 'REJECTED'])('actual legacy document extraction with absent metadata preserves %s behavior', async status => {
    const prior = await produce(false), fresh = await produce(false)
    expect(prior.sources[0]).not.toHaveProperty('sourceCapture')
    expect(prior.evidenceObjects[0]).not.toHaveProperty('evidenceSupport')
    expect(reconcile(fresh, decided(prior, status))[0].reviewStatus).toBe(status)
  })
  test.each([[false, true], [true, false]])('actual document batch capture transition %s -> %s requires normal review', async (oldMode, newMode) => {
    const prior = await produce(oldMode), fresh = await produce(newMode)
    expect(prior.evidenceObjects.map(row => row.evidenceObjectId)).toEqual(fresh.evidenceObjects.map(row => row.evidenceObjectId))
    expectFresh(fresh, decided(prior))
  })
  test('a real changed document batch identity remains ineligible despite identical content', async () => {
    const previous = decided(await produce())
    const fresh = normalize(await ingestUploadedDocumentDiscoveryEvidence({ batchOutcomes: true, acquisitionProfile: 'STANDARD',
      capturedAt, documentSources: [{ ...doc, fileName: 'other.txt' }, doc] }))
    const current = fresh.evidenceObjects.find(row => row.sourceFileName === doc.fileName)
    expect(current).toBeDefined()
    expect(current.sourceId).not.toBe(previous.evidenceObjects[0].sourceId)
    expect(fresh.sources.find(row => row.sourceId === current.sourceId).sourceCapture.captureReceipt.inputIndex).toBe(1)
    expectFresh(fresh, previous)
  })
  test('valid controlled extraction-view derivative cannot inherit with unchanged original bytes/prose', async () => {
    const previous = decided(await produce()), fresh = await produce()
    // Deliberate validator-contract derivative, not a newly acquired document version.
    const source = fresh.sources[0], captureText = doc.textContent + ' Additional controlled extraction view.'
    source.sourceCapture = buildSourceCapture({ sourceId: source.sourceId, originalContentHash: source.contentHash,
      captureText, adapter: source.adapter, extractionMethod: source.extractionMethod, capturedAt, inputIndex: 0 })
    previous.evidenceObjects.forEach(row => { delete row.evidenceSupport })
    fresh.evidenceObjects.forEach(row => { delete row.evidenceSupport })
    expect(() => assertSourceEvidenceMetadataPairs({ sources: fresh.sources, evidenceObjects: fresh.evidenceObjects })).not.toThrow()
    expect(fresh.sources[0].valueHash).toBe(previous.lineage.sources[0].valueHash)
    expect(fresh.evidenceObjects[0].extractedFact).toBe(previous.evidenceObjects[0].extractedFact)
    expectFresh(fresh, previous)
  })
  test('valid changed exact support and offsets cannot inherit while capture and prose stay unchanged', async () => {
    const previous = decided(await produce()), fresh = await produce()
    fresh.evidenceObjects[0].evidenceSupport = buildEvidenceSupport({ captureText: doc.textContent,
      exactSegment: 'workflow monitoring services', sourceCapture: fresh.sources[0].sourceCapture })
    expect(fresh.evidenceObjects[0].evidenceSupport.start).not.toBe(previous.evidenceObjects[0].evidenceSupport.start)
    expect(() => assertSourceEvidenceMetadataPairs({ sources: fresh.sources, evidenceObjects: fresh.evidenceObjects })).not.toThrow()
    expectFresh(fresh, previous)
  })
  test.each(['old', 'new'])('invalid %s source/support owner never carries a decision', async side => {
    for (const mutate of [
      value => { delete value.sources[0].sourceCapture },
      value => { delete value.sources[0].contentHash },
      value => { value.sources[0].sourceCapture.textLength = 'invalid' },
      value => { value.sources[0].sourceCapture.captureTextHash = 'sha256:' + 'f'.repeat(64) },
      value => { value.sources[0].sourceCapture.sourceId = 'foreign' },
      value => { value.evidenceObjects[0].evidenceSupport.sourceId = 'foreign' },
    ]) {
      const prior = await produce(), fresh = await produce()
      mutate(side === 'old' ? prior : fresh)
      expectFresh(fresh, decided(prior))
    }
  })
  test('equal but invalid support receipts do not pass solely through equality', async () => {
    const prior = await produce(), fresh = await produce()
    prior.evidenceObjects[0].evidenceSupport.excerptHash = 'sha256:' + 'f'.repeat(64)
    fresh.evidenceObjects[0].evidenceSupport = clone(prior.evidenceObjects[0].evidenceSupport)
    expectFresh(fresh, decided(prior))
  })
  test('an unexpected capture dependency failure propagates unchanged', async () => {
    const previous = decided(await produce()), fresh = await produce(), unexpected = new Error('Unexpected capture dependency failure')
    previous.lineage.sources[0].sourceCapture = new Proxy(previous.lineage.sources[0].sourceCapture, { ownKeys: () => { throw unexpected } })
    let actual
    try { reconcile(fresh, previous) } catch (error) { actual = error }
    expect(actual).toBe(unexpected)
  })
  test.each(['ACCEPTED', 'REJECTED'])('actual optional website capture preserves identical %s metadata with separate original hashes', async status => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
    const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, url: fixture.url,
      headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(Buffer.byteLength(fixture.html)) : null },
      text: async () => fixture.html }))
    const website = async stamp => {
      const result = await acquireWebsiteDiscoveryEvidence({ acquisitionProfile: 'STANDARD', acquiredAt: stamp,
        websiteUrl: fixture.url, recordSourceCapture: true })
      return normalize({ sources: [result.source], evidenceObjects: result.evidenceObjects })
    }
    try {
      const previous = decided(await website(capturedAt), status), fresh = await website('2026-10-19T11:00:00.000Z')
      expect(fresh.sources[0].contentHash).not.toBe(fresh.sources[0].valueHash)
      expect(fresh.sources[0].valueHash).toBe(previous.lineage.sources[0].valueHash)
      const next = reconcile(fresh, previous)
      expect(next.every(row => row.reviewStatus === status)).toBe(true)
      expect(next[0][status === 'ACCEPTED' ? 'acceptanceTimestamp' : 'rejectionTimestamp']).toBe(capturedAt)
      expect(fresh.evidenceObjects.every(row => row.reviewStatus === 'PENDING')).toBe(true)
    } finally { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns }
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

test('intrinsic descriptor continuity preserves exact human decision only for unchanged material, not changed/drop/add', () => {
  const descriptor = metadataDescriptor(), sources = [{ sourceId: 'synthetic-source', sourceType: 'WEBSITE',
    valueHash: `sha256:${'a'.repeat(64)}`, controlledReplayProvenance: descriptor }]
  const evidenceObjects = [{ evidenceObjectId: 'synthetic-evidence', sourceId: 'synthetic-source',
    extractedFact: 'The synthetic trial has not started.', acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
    lineageRef: 'lineage:synthetic-source', reviewStatus: 'PENDING', controlledReplayProvenance: descriptor }]
  const fresh = { sources, evidenceObjects }, previous = decided(fresh)
  expect(reconcile(fresh, previous)[0]).toMatchObject({ reviewStatus: 'ACCEPTED', acceptanceTimestamp: capturedAt, auditRef: 'recorded-human-decision' })
  for (const mode of ['drop', 'change', 'invalid', 'add']) {
    const next = JSON.parse(JSON.stringify(fresh)), prior = JSON.parse(JSON.stringify(previous))
    if (mode === 'drop') { delete next.sources[0].controlledReplayProvenance; delete next.evidenceObjects[0].controlledReplayProvenance }
    if (mode === 'add') { delete prior.lineage.sources[0].controlledReplayProvenance; delete prior.evidenceObjects[0].controlledReplayProvenance }
    if (mode === 'change') {
      const changed = metadataDescriptor(); changed.binding.authorityRef = 'synthetic:changed'
      changed.provenance.bindingDigest = storedControlledReplayBindingDigest(changed.binding)
      next.sources[0].controlledReplayProvenance = changed; next.evidenceObjects[0].controlledReplayProvenance = changed
    }
    if (mode === 'invalid') {
      next.sources[0].controlledReplayProvenance.provenance.bindingDigest = 'sha256:' + 'f'.repeat(64)
      next.evidenceObjects[0].controlledReplayProvenance = next.sources[0].controlledReplayProvenance
    }
    expect(reconcile(next, prior)[0]).toBe(next.evidenceObjects[0])
    expect(reconcile(next, prior)[0].reviewStatus).toBe('PENDING')
  }
})


describe('metadata-only discovery acceptance review continuity', () => {
  const fixture = (disposition = 'NOT_CONTRADICTORY') => {
    const epoch = randomUUID()
    const evidenceObjects = [0, 1].map(i => ({ evidenceObjectId: 'acceptance-evidence-' + i,
      sourceId: 'acceptance-source-' + i, extractedFact: 'Synthetic statement ' + i,
      lineageRef: 'acceptance-lineage-' + i, reviewStatus: 'ACCEPTED', validationStatus: 'VALIDATED',
      qualifications: { certainty: 'SYNTHETIC_ONLY' } }))
    const sourceRegistry = evidenceObjects.map(x => ({ sourceId: x.sourceId, contentHash: 'unchanged' }))
    const candidate = { contradictionId: 'acceptance-candidate', domain: 'Proof', severity: 'MEDIUM',
      basis: 'Deterministic review basis', evidenceObjectIds: evidenceObjects.map(x => x.evidenceObjectId) }
    const pair = getDiscoveryContradictionReview(candidate, evidenceObjects, [], actor, epoch).evidencePairHash
    const reviews = disposition === 'UNREVIEWED' ? [] : [{ contradictionId: candidate.contradictionId,
      contractVersion: DISCOVERY_CONTRADICTION_REVIEW_CONTRACT, runtimeInstanceId: actor, reviewEpoch: epoch,
      evidencePairHash: disposition === 'STALE' ? 'sha256:' + '0'.repeat(64) : pair,
      reviewId: randomUUID(), reviewedBy: actor, reviewedAt: capturedAt, rationale: 'Recorded synthetic assessment.',
      disposition: disposition === 'STALE' ? 'NOT_CONTRADICTORY' : disposition }]
    candidate.reviewStatus = getDiscoveryContradictionReview(candidate, evidenceObjects, reviews, actor, epoch).reviewStatus
    const previousEvidencePack = { evidenceObjects, sourceRegistry, contradictionReviewEpoch: epoch,
      contradictionReviews: reviews, discoveryHealth: { contradictionCandidates: [candidate] } }
    return { previousEvidencePack, evidenceObjects: JSON.parse(JSON.stringify(evidenceObjects)),
      sourceRegistry: JSON.parse(JSON.stringify(sourceRegistry)), candidates: JSON.parse(JSON.stringify([candidate])), runtimeInstanceId: actor }
  }
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED', 'STALE', 'UNREVIEWED'])(
    'unchanged acceptance preserves %s without rewriting history or decisions', disposition => {
      const f = fixture(disposition), frozen = JSON.stringify(f)
      const epoch = acceptanceContradictionReviewEpoch(f)
      expect(epoch).toBe(f.previousEvidencePack.contradictionReviewEpoch)
      expect(getDiscoveryContradictionReview(f.candidates[0], f.evidenceObjects,
        f.previousEvidencePack.contradictionReviews, actor, epoch).reviewStatus).toBe(disposition)
      expect(JSON.stringify(f)).toBe(frozen)
    })
  test.each([
    ['statement', f => { f.evidenceObjects[0].extractedFact += ' changed' }],
    ['qualification', f => { f.evidenceObjects[0].qualifications.certainty = 'CHANGED' }],
    ['source', f => { f.sourceRegistry[0].contentHash = 'changed' }],
    ['pending admission', f => { f.previousEvidencePack.evidenceObjects[0].reviewStatus = 'PENDING' }],
    ['accepted status', f => { f.evidenceObjects[0].reviewStatus = 'REJECTED' }],
    ['candidate basis', f => { f.candidates[0].basis = 'changed' }],
    ['candidate status', f => { f.candidates[0].reviewStatus = 'CONFIRMED' }],
    ['candidate removal', f => { f.candidates = [] }],
    ['evidence removal', f => { f.evidenceObjects.pop() }],
    ['duplicate evidence', f => { f.previousEvidencePack.evidenceObjects[1].evidenceObjectId = f.previousEvidencePack.evidenceObjects[0].evidenceObjectId }],
    ['invalid history', f => { f.previousEvidencePack.contradictionReviews = [null] }],
    ['missing epoch', f => { delete f.previousEvidencePack.contradictionReviewEpoch }],
    ['invalid epoch', f => { f.previousEvidencePack.contradictionReviewEpoch = 'invalid' }],
    ['wrong runtime identity', f => { f.runtimeInstanceId = '' }],
  ])('changed or unverifiable %s retains epoch reset', (_label, change) => {
    const f = fixture(), previous = f.previousEvidencePack.contradictionReviewEpoch
    change(f)
    const epoch = acceptanceContradictionReviewEpoch(f)
    expect(epoch).toMatch(/^[a-f0-9-]{36}$/)
    expect(epoch).not.toBe(previous)
  })
})
