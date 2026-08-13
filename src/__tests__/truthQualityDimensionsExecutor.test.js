import { createHash } from 'node:crypto'

import {
  executeTruthQualityDimensionsPack,
  parseTruthQualityDimensionsMarkdown,
  TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
} from '../services/truthQualityDimensionsExecutorService.js'

const PACK_CONTENT = `# Truth Quality Dimensions

## Purpose

Defines quality dimensions.

## Coverage

### Bands

- Low: 0–39.
- Medium: 40–69.
- High: 70–89.
- Very High: 90–100.

## Confidence

### Bands

- Low: 0–39.
- Medium: 40–69.
- High: 70–89.
- Very High: 90–100.

## Source Diversity

### Bands

- Low.
- Medium.
- High.
- Very High.

## Contradiction Risk

### Values

- Low.
- Medium.
- High.
- Blocking.

## Combined Interpretation

No dimension should be interpreted in isolation.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-truth-quality-dimensions-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  candidate: {
    coverageScore: 80,
    confidenceScore: 90,
    sourceDiversityScore: 90,
    coverageBand: 'HIGH',
    confidenceBand: 'VERY_HIGH',
    sourceDiversityBand: 'VERY_HIGH',
    contradictionCount: 1,
    contradictionRisk: 'MEDIUM',
  },
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_draft_iteration_test' },
  executionId: 'truth_quality_dimensions_exec_test',
}

describe('truth-quality-dimensions executor', () => {
  test('parses all source-defined dimension sections', () => {
    const result = parseTruthQualityDimensionsMarkdown(PACK_CONTENT)

    expect(result.valid).toBe(true)
    expect(Object.keys(result.sections)).toEqual(['Coverage', 'Confidence', 'Source Diversity', 'Contradiction Risk'])
  })

  test('records a strict receipt after independently evaluating all dimensions', () => {
    const result = executeTruthQualityDimensionsPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.receipt).toEqual(expect.objectContaining({
      receiptKey: 'truth-quality-dimensions.post-validation.v1',
      validatorKey: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
      status: 'PASSED',
    }))
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'DIMENSION_COVERAGE_EVALUATED', status: 'PASSED' }),
      expect.objectContaining({ key: 'DIMENSION_CONFIDENCE_EVALUATED', status: 'PASSED' }),
      expect.objectContaining({ key: 'DIMENSION_SOURCE_DIVERSITY_EVALUATED', status: 'PASSED' }),
      expect.objectContaining({ key: 'DIMENSION_CONTRADICTION_RISK_EVALUATED', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
    ]))
  })

  test('derives a missing coverage band from the governed score', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, coverageBand: undefined },
    })

    expect(result.status).toBe('PASSED')
  })

  test('accepts a governed qualitative source-diversity band when its supporting score is 100', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        sourceDiversityScore: 100,
        sourceDiversityBand: 'HIGH',
      },
    })

    expect(result.status).toBe('PASSED')
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'DIMENSION_SOURCE_DIVERSITY_EVALUATED', status: 'PASSED' }),
    ]))
  })

  test('fails closed when source-diversity evidence has no governed band', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, sourceDiversityBand: '' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('TRUTH_QUALITY_EVIDENCE_INCOMPLETE')
  })

  test('fails closed on score and band mismatch', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, confidenceBand: 'LOW' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('CONFIDENCE_BAND_MISMATCH')
  })

  test('fails closed on an unsupported contradiction risk', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, contradictionRisk: 'UNKNOWN' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('TRUTH_QUALITY_EVIDENCE_INCOMPLETE')
  })

  test('fails closed when the exact content hash is wrong', () => {
    const result = executeTruthQualityDimensionsPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })
})
