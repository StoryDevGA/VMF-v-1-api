import { createHash } from 'node:crypto'

import {
  BLOCKING_RULES_EXECUTOR_KEY,
  executeBlockingRulesPack,
  extractSection,
  extractSubsection,
  parseBlockingRulesMarkdown,
} from '../services/blockingRulesExecutorService.js'

const PACK_CONTENT = `# Blocking Rules

## Missing Accepted Truth

### Condition

Accepted truth count is lower than the required truth count for the assessed use.

### Outcome

Block certification and downstream use.

### Customer-Safe Message

Accepted truth is incomplete.

## Missing Lock Proof

### Condition

The lock snapshot identifier or replay anchor identifier is missing.

### Outcome

Block certification levels and publication paths.

### Customer-Safe Message

Locked truth proof is missing.

## Unresolved Blocking Contradictions

### Condition

Contradiction risk is classified as Blocking.

### Outcome

Block certification until contradictions are resolved.

### Customer-Safe Message

Contradictions require review before certification.

## Raw Graph Unsafe

### Condition

A risk exists that raw graph internals may be exposed.

### Outcome

Block rendering, publication, and export.

### Customer-Safe Message

The output cannot be safely rendered.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: BLOCKING_RULES_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-blocking-rules-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  candidate: {
    acceptedTruthCount: 4,
    requiredTruthCount: 4,
    lockSnapshotId: 'lock-snapshot-qa',
    replayAnchorId: 'replay-anchor-qa',
    contradictionRisk: 'LOW',
    rawGraphLeakageDetected: false,
  },
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_draft_iteration_test' },
  executionId: 'blocking_rules_exec_test',
}

describe('blocking-rules executor', () => {
  test('treats regex metacharacters in section headings as literal text', () => {
    const section = extractSection(
      '## Truth (production) [v1]\n\nLiteral section body.\n\n## Truth production v1\n\nWrong section body.',
      'Truth (production) [v1]',
    )

    expect(section).toContain('Literal section body.')
    expect(section).not.toContain('Wrong section body.')
    expect(extractSection('## Truth production v1\n\nWrong section body.', 'Truth (production) [v1]')).toBe('')
    expect(extractSubsection('### Customer-Safe (message) [v1]\n\nLiteral subsection.', 'Customer-Safe (message) [v1]')).toBe('Literal subsection.')
  })

  test('parses all four source-backed Markdown rule sections', () => {
    const result = parseBlockingRulesMarkdown(PACK_CONTENT)

    expect(result.valid).toBe(true)
    expect(result.rules.map((rule) => rule.key)).toEqual([
      'MISSING_ACCEPTED_TRUTH',
      'MISSING_LOCK_PROOF',
      'UNRESOLVED_BLOCKING_CONTRADICTIONS',
      'RAW_GRAPH_UNSAFE',
    ])
  })

  test('records a strict receipt when every blocking rule passes', () => {
    const result = executeBlockingRulesPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.receipt).toEqual(expect.objectContaining({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      receiptKey: 'blocking-rules.post-validation.v1',
      validatorKey: BLOCKING_RULES_EXECUTOR_KEY,
      result: 'ALLOW',
      status: 'PASSED',
    }))
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'RULE_MISSING_ACCEPTED_TRUTH', status: 'PASSED' }),
      expect.objectContaining({ key: 'RULE_MISSING_LOCK_PROOF', status: 'PASSED' }),
      expect.objectContaining({ key: 'RULE_UNRESOLVED_BLOCKING_CONTRADICTIONS', status: 'PASSED' }),
      expect.objectContaining({ key: 'RULE_RAW_GRAPH_UNSAFE', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
      expect.objectContaining({ key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED' }),
    ]))
  })

  test('blocks missing accepted truth and records no receipt', () => {
    const result = executeBlockingRulesPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, acceptedTruthCount: 3 },
    })

    expect(result.status).toBe('FAILED')
    expect(result.result).toBe('BLOCK')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('MISSING_ACCEPTED_TRUTH')
  })

  test('blocks missing lock proof and records no receipt', () => {
    const result = executeBlockingRulesPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, replayAnchorId: '' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('MISSING_LOCK_PROOF')
  })

  test('records every failed blocking rule instead of downgrading them to warnings', () => {
    const result = executeBlockingRulesPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        acceptedTruthCount: 1,
        lockSnapshotId: '',
        contradictionRisk: 'BLOCKING',
        rawGraphLeakageDetected: true,
      },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toEqual(expect.arrayContaining([
      'MISSING_ACCEPTED_TRUTH',
      'MISSING_LOCK_PROOF',
      'UNRESOLVED_BLOCKING_CONTRADICTIONS',
      'RAW_GRAPH_UNSAFE',
    ]))
  })

  test('fails closed when the exact content hash is wrong', () => {
    const result = executeBlockingRulesPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })

  test('fails closed when the Markdown rule sections are malformed', () => {
    const malformed = '# Blocking Rules\n\n## Missing Accepted Truth\n\nNo condition.'
    const result = executeBlockingRulesPack({
      ...baseArgs,
      packContent: malformed,
      pack: { ...pack, contentHash: hash(malformed) },
    })

    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('BLOCKING_RULES_INVALID')
  })
})
