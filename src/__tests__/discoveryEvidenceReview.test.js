import {
  acceptPendingDiscoveryEvidenceObjects,
  applyDiscoveryEvidenceReview,
  normalizeDiscoveryEvidenceObjects,
} from '../services/discoveryIntelligenceService.js'

const makeEvidence = (reviewStatus = 'PENDING') => normalizeDiscoveryEvidenceObjects({
  evidenceObjects: [{
    evidenceObjectId: 'evidence-review-1',
    sourceId: 'document-review-1',
    extractedFact: 'The customer uses a governed decision process.',
    coverageArea: 'Decision Context',
    category: 'Value Drivers',
    acquisitionMethod: 'DOCUMENT_INGESTION',
    confidence: { level: 'HIGH', score: 0.9, basis: ['SOURCE_DOCUMENT'] },
    reviewStatus,
    acceptedBy: reviewStatus === 'ACCEPTED' ? 'prior-actor' : '',
    acceptanceTimestamp: reviewStatus === 'ACCEPTED' ? '2026-09-01T10:00:00Z' : '',
    rejectedBy: reviewStatus === 'REJECTED' ? 'prior-reviewer' : '',
    rejectionTimestamp: reviewStatus === 'REJECTED' ? '2026-09-01T11:00:00Z' : '',
  }],
})[0]

const assertMetadata = (evidence, validationStatus) => {
  expect(evidence.validationStatus).toBe(validationStatus)
  expect(evidence.graphReadyMetadata.validationStatus).toBe(validationStatus)
  for (const [key, value] of Object.entries(evidence.graphReadyMetadata)) {
    if (!['evidenceId', 'sourceId', 'confidence'].includes(key)) expect(evidence[key]).toEqual(value)
  }
}

describe('Discovery review derived metadata', () => {
  test.each([
    ['PENDING', 'ACCEPTED', 'VALIDATED'],
    ['PENDING', 'REJECTED', 'REJECTED'],
    ['REJECTED', 'ACCEPTED', 'VALIDATED'],
    ['ACCEPTED', 'REJECTED', 'REJECTED'],
  ])('refreshes metadata for %s to %s without mutating source facts', (before, after, validation) => {
    const input = makeEvidence(before)
    const snapshot = structuredClone(input)
    const untouched = { ...makeEvidence(), evidenceObjectId: 'other-evidence' }
    const result = applyDiscoveryEvidenceReview({
      evidenceObjects: [input, untouched], evidenceObjectId: input.evidenceObjectId,
      reviewStatus: after, actorUserId: 'reviewer', reviewedAt: '2026-09-02T16:00:00Z',
    })
    expect(result.found).toBe(true)
    const reviewed = result.evidenceObjects[0]
    assertMetadata(reviewed, validation)
    expect(reviewed).toEqual(expect.objectContaining({
      extractedFact: input.extractedFact, sourceId: input.sourceId,
      evidenceObjectId: input.evidenceObjectId, confidence: input.confidence,
    }))
    expect(reviewed.confidenceWarnings).not.toContain('EVIDENCE_REVIEW_PENDING')
    expect(reviewed.readinessContribution === 'NONE').toBe(after === 'REJECTED')
    expect(input).toEqual(snapshot)
    expect(result.evidenceObjects[1]).toBe(untouched)
  })

  test('bulk acceptance refreshes only pending evidence and preserves prior review provenance', () => {
    const inputs = [makeEvidence(), makeEvidence('ACCEPTED'), makeEvidence('REJECTED')]
    const snapshot = structuredClone(inputs)
    const result = acceptPendingDiscoveryEvidenceObjects({
      evidenceObjects: inputs, actorUserId: 'reviewer', acceptedAt: '2026-09-02T16:00:00Z',
    })
    assertMetadata(result[0], 'VALIDATED')
    expect(result[0].confidenceWarnings).not.toContain('EVIDENCE_REVIEW_PENDING')
    expect(result[0].acceptedBy).toBe('reviewer')
    expect(result[1]).toBe(inputs[1])
    expect(result[2]).toBe(inputs[2])
    expect(inputs).toEqual(snapshot)
  })

  test('missing review target leaves all evidence unchanged', () => {
    const inputs = [makeEvidence()]
    const result = applyDiscoveryEvidenceReview({ evidenceObjects: inputs, evidenceObjectId: 'missing', reviewStatus: 'ACCEPTED' })
    expect(result.found).toBe(false)
    expect(result.evidenceObjects[0]).toBe(inputs[0])
    assertMetadata(result.evidenceObjects[0], 'UNVALIDATED')
  })
})
