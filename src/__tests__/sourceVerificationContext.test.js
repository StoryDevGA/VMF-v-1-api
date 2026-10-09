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
