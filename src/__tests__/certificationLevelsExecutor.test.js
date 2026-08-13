import { createHash } from 'node:crypto'

import {
  CERTIFICATION_LEVELS_EXECUTOR_KEY,
  executeCertificationLevelsPack,
  parseCertificationLevelsMarkdown,
} from '../services/certificationLevelsExecutorService.js'

const PACK_CONTENT = `# Certification Levels

## Purpose

Defines governed levels.

## Evidence Present

### Minimum Requirements

- coverage score is at least 20;
- accepted truth count is greater than zero;
- evidence count is greater than zero.

### Meaning

Basic evidence exists.

### Output Instruction

Preserve uncertainty.

## Evidence Supported

### Minimum Requirements

- coverage score is at least 40;
- confidence band is Medium or higher;
- unresolved contradiction risk is neither High nor Blocking.

### Meaning

Accepted truth has useful support.

### Output Instruction

Render cautiously.

## Certified Truth

### Minimum Requirements

- coverage score is at least 70;
- confidence band is High or higher;
- source-diversity band is Medium or higher;
- contradiction risk is Low or Medium;
- publish snapshot identifier is present;
- lock snapshot identifier is present;
- replay anchor identifier is present.

### Meaning

Truth is suitable for governed downstream outputs.

### Output Instruction

Render confidently within boundaries.

## Strategic Truth

### Minimum Requirements

- coverage score is at least 85;
- confidence band is High or Very High;
- source-diversity band is High or Very High;
- contradiction risk is Low;
- publish snapshot identifier is present;
- lock snapshot identifier is present;
- replay anchor identifier is present.

### Meaning

Truth is strong enough for strategic communication.

### Output Instruction

Use for executive communication within limitations.

## Assignment Rules

- Assign only the highest level for which every requirement is satisfied.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: CERTIFICATION_LEVELS_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-certification-levels-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  candidate: {
    acceptedTruthCount: 6,
    evidenceCount: 20,
    coverageScore: 30,
    confidenceBand: 'HIGH',
    sourceDiversityBand: 'HIGH',
    contradictionRisk: 'LOW',
    publishSnapshotId: 'publish-qa',
    lockSnapshotId: 'lock-qa',
    replayAnchorId: 'replay-qa',
  },
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_draft_iteration_test' },
  executionId: 'certification_levels_exec_test',
}

describe('certification-levels executor', () => {
  test('parses all four source-defined level sections and assignment rules', () => {
    const result = parseCertificationLevelsMarkdown(PACK_CONTENT)

    expect(result.valid).toBe(true)
    expect(result.levels.map((level) => level.key)).toEqual([
      'EVIDENCE_PRESENT',
      'EVIDENCE_SUPPORTED',
      'CERTIFIED_TRUTH',
      'STRATEGIC_TRUTH',
    ])
  })

  test('records a strict receipt for the highest eligible level', () => {
    const result = executeCertificationLevelsPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        coverageScore: 90,
      },
    })

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.assignedLevel).toBe('STRATEGIC_TRUTH')
    expect(result.receipt).toEqual(expect.objectContaining({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      receiptKey: 'certification-levels.post-validation.v1',
      validatorKey: CERTIFICATION_LEVELS_EXECUTOR_KEY,
      result: 'ALLOW',
      status: 'PASSED',
    }))
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'CERTIFICATION_LEVEL_ASSIGNED', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
      expect.objectContaining({ key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED' }),
    ]))
  })

  test('preserves a lower valid level instead of promoting it', () => {
    const result = executeCertificationLevelsPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.assignedLevel).toBe('EVIDENCE_PRESENT')
  })

  test('blocks incomplete evidence and records no receipt', () => {
    const result = executeCertificationLevelsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, confidenceBand: '' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('CERTIFICATION_EVIDENCE_INCOMPLETE')
  })

  test('blocks when no certification level is eligible', () => {
    const result = executeCertificationLevelsPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, coverageScore: 10 },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('NO_ELIGIBLE_CERTIFICATION_LEVEL')
  })

  test('fails closed when the exact content hash is wrong', () => {
    const result = executeCertificationLevelsPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })

  test('fails closed when source-defined sections are malformed', () => {
    const malformed = '# Certification Levels\n\n## Assignment Rules\n\n- Assign only the highest level.'
    const result = executeCertificationLevelsPack({
      ...baseArgs,
      packContent: malformed,
      pack: { ...pack, contentHash: hash(malformed) },
    })

    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('LEVEL_EVIDENCE_PRESENT_INVALID')
  })
})
