import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { describe, expect, test } from '@jest/globals'
import { recordSourceReview, resolveSourceRecordedReview, sourceMaterialFingerprint,
  sourceVerificationFactsSchema, preserveSourceRecordedReviews } from '../services/sourceVerificationContext.js'
import { buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'

const source = { sourceId: 'source-1', sourceType: 'WEBSITE', label: 'Original report',
  url: 'https://example.test/report', contentHash: `sha256:${'a'.repeat(64)}`, lineageRef: 'lineage:source-1' }
const facts = { authenticity: 'AUTHENTIC', sourceOrigin: 'Original publisher',
  organizationRelationship: 'External publisher', independenceGroup: 'publisher-1',
  supportingReference: 'review:fixture-proof', rationale: 'Synthetic recorded review.' }

describe('recorded source review boundaries', () => {
  test('binds server identity and material, not its own receipt or lifecycle fields', () => {
    const verificationContext = recordSourceReview({ source, facts, actorUserId: 'reviewer-1' })
    const reviewed = { ...source, verificationContext, updatedAt: 'later', stateVersion: 'later' }
    expect(sourceMaterialFingerprint(reviewed)).toBe(sourceMaterialFingerprint(source))
    expect(resolveSourceRecordedReview(reviewed)).toEqual(verificationContext)
    expect(verificationContext.status).toBe('RECORDED_REVIEW')
    for (const [key, value] of Object.entries({ sourceId: 'other', contentHash: `sha256:${'b'.repeat(64)}`,
      url: 'https://different.test', label: 'Different title', lineageRef: 'different', sourceType: 'DISCOVERY_NOTES' })) {
      expect(resolveSourceRecordedReview({ ...reviewed, [key]: value })).toBeNull()
    }
  })
  test('does not manufacture facts or accept caller-owned authority', () => {
    expect(resolveSourceRecordedReview(source)).toBeNull()
    for (const key of Object.keys(facts)) {
      const missing = { ...facts }; delete missing[key]
      expect(sourceVerificationFactsSchema.safeParse(missing).success).toBe(false)
    }
    expect(sourceVerificationFactsSchema.safeParse({ ...facts, reviewedBy: 'forged' }).success).toBe(false)
    expect(sourceVerificationFactsSchema.safeParse({ ...facts, authoritative: true }).success).toBe(false)
  })
  test('registry rebuild preserves the context and exact native material', () => {
    const verificationContext = recordSourceReview({ source, facts, actorUserId: 'reviewer-1' })
    const rebuilt = buildDiscoverySourceRegistry({ sourceRegistry: [{ ...source, verificationContext }] })[0]
    expect(resolveSourceRecordedReview(rebuilt)).toEqual(verificationContext)
    expect(sourceMaterialFingerprint({ ...source, title: source.label, sourceRef: source.url })).toBe(sourceMaterialFingerprint(source))
  })
  test('native schema rejects malformed reviews and keeps older rows optional', () => {
    const base = { sourceId: 'source-1', sourceType: 'WEBSITE' }
    expect(new RuntimeEvidenceSource(base).verificationContext).toBeUndefined()
    expect(new RuntimeEvidenceSource({ ...base, verificationContext: { status: 'VERIFIED' } }).validateSync().errors)
      .toHaveProperty('verificationContext')
  })
  test('native domain hashes never stand in for absent source content hashes', () => {
    const { contentHash, ...unhashed } = source
    const review = recordSourceReview({ source: unhashed, facts, actorUserId: 'reviewer-1' })
    expect(resolveSourceRecordedReview({ ...unhashed, sourceStateVersion: 'native', sourceHash: `sha256:${'b'.repeat(64)}`, verificationContext: review })).toEqual(review)
    expect(preserveSourceRecordedReviews([unhashed], [{ ...unhashed, verificationContext: review }])[0].verificationContext).toEqual(review)
    expect(preserveSourceRecordedReviews([{ ...unhashed, url: 'changed' }], [{ ...unhashed, verificationContext: review }])[0].verificationContext).toBeUndefined()
  })
  test('legacy content alias matches native content without using the native domain hash', () => {
    const { contentHash, ...legacy } = source
    legacy.sourceHash = contentHash
    const native = { ...source, sourceStateVersion: 'native', sourceHash: `sha256:${'b'.repeat(64)}` }
    expect(sourceMaterialFingerprint(legacy)).toBe(sourceMaterialFingerprint(native))
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

test('descriptor binds source review material while descriptor-absent fingerprint stays exact', () => {
  const plain = { sourceId: 'synthetic-source', sourceType: 'WEBSITE', title: 'Synthetic planning assertion',
    sourceRef: 'https://controlled-context.example/case-study', contentHash: `sha256:${'a'.repeat(64)}`, lineageRef: 'lineage:synthetic-source' }
  expect(sourceMaterialFingerprint(plain)).toBe('sha256:96c28e5af884ca02af591430de131ea47e2b6b6932ec94d6a6c85c903b05d3df')
  const descriptor = metadataDescriptor(), metadata = { ...plain, controlledReplayProvenance: descriptor }
  expect(sourceMaterialFingerprint(metadata)).not.toBe(sourceMaterialFingerprint(plain))
  const verificationContext = recordSourceReview({ source: metadata, facts, actorUserId: 'reviewer-1', reviewedAt: '2026-10-19T12:00:00.000Z' })
  expect(resolveSourceRecordedReview({ ...metadata, verificationContext })).toEqual(verificationContext)
  const changed = metadataDescriptor(); changed.binding.authorityRef = 'synthetic:changed'
  changed.provenance.bindingDigest = storedControlledReplayBindingDigest(changed.binding)
  expect(resolveSourceRecordedReview({ ...metadata, controlledReplayProvenance: changed, verificationContext })).toBeNull()
  expect(preserveSourceRecordedReviews([plain], [{ ...metadata, verificationContext }])[0].verificationContext).toBeUndefined()
  expect(preserveSourceRecordedReviews([metadata], [{ ...metadata, verificationContext }])[0].verificationContext).toEqual(verificationContext)
  let called = false
  const unsafe = Object.defineProperty({ ...plain }, 'controlledReplayProvenance', { enumerable: true,
    get() { called = true; return descriptor } })
  expect(() => sourceMaterialFingerprint(unsafe)).toThrow('Controlled replay metadata is invalid')
  expect(called).toBe(false)
})
