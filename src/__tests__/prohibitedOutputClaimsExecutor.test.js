import { createHash } from 'node:crypto'

import {
  executeProhibitedOutputClaimsPack,
  parseProhibitedOutputClaimsMarkdown,
  PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
} from '../services/prohibitedOutputClaimsExecutorService.js'

const PACK_CONTENT = `# Prohibited Output Claims

## Prohibited Claims

Do not generate or imply:

- proven ROI;
- guaranteed outcomes;
- market-leading status;
- named customer proof unless present in accepted truth;

## Additional Prohibitions

Do not:

- convert assumptions into facts;
- introduce unsupported metrics absent from accepted truth;
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-prohibited-output-claims-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  customerContent: {
    markdown: 'The buyer loses time reconciling commercial inputs. Preserve the known limitation.',
  },
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_draft_iteration_test' },
  executionId: 'prohibited_output_claims_exec_test',
}

describe('prohibited-output-claims executor', () => {
  test('parses both canonical Markdown rule sections', () => {
    const result = parseProhibitedOutputClaimsMarkdown(PACK_CONTENT)

    expect(result.valid).toBe(true)
    expect(result.rules).toEqual(expect.arrayContaining([
      'proven ROI',
      'guaranteed outcomes',
      'convert assumptions into facts',
    ]))
  })

  test('records a strict receipt when customer content is clear', () => {
    const result = executeProhibitedOutputClaimsPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.receipt).toEqual(expect.objectContaining({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      receiptKey: 'prohibited-output-claims.post-validation.v1',
      validatorKey: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
      result: 'ALLOW',
      status: 'PASSED',
    }))
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
      expect.objectContaining({ key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED' }),
    ]))
  })

  test('blocks a prohibited claim and records no receipt', () => {
    const result = executeProhibitedOutputClaimsPack({
      ...baseArgs,
      customerContent: { markdown: 'This is proven ROI for the customer.' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.result).toBe('BLOCK')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PROHIBITED_OUTPUT_CLAIM')
  })

  test('allows an explicitly negated safety limitation containing a prohibited phrase', () => {
    const result = executeProhibitedOutputClaimsPack({
      ...baseArgs,
      customerContent: { markdown: 'Do not add guaranteed outcomes beyond what is verified.' },
    })

    expect(result.status).toBe('PASSED')
    expect(result.receipt).not.toBeNull()
  })

  test('fails closed when the exact content hash is wrong', () => {
    const result = executeProhibitedOutputClaimsPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })

  test('fails closed when the Markdown rule sections are malformed', () => {
    const malformed = '# Prohibited Output Claims\n\nNo rules here.'
    const result = executeProhibitedOutputClaimsPack({
      ...baseArgs,
      packContent: malformed,
      pack: { ...pack, contentHash: hash(malformed) },
    })

    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PROHIBITED_CLAIMS_RULES_INVALID')
  })
})
