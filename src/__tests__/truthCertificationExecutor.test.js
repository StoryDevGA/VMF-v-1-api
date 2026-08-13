import { createHash } from 'node:crypto'

import { describe, expect, test } from '@jest/globals'

import { KNOWLEDGE_PACK_BOUNDARIES } from '../constants/knowledgeRuntime.js'
import {
  executeTruthCertificationPack,
  TRUTH_CERTIFICATION_EXECUTOR_KEY,
} from '../services/truthCertificationExecutorService.js'

const packContent = `
pack:
  key: truth-certification-pack
inputs:
  required:
    - accepted_truth_count
    - required_truth_count
    - evidence_count
    - source_count
    - coverage_score
    - confidence_score
    - source_diversity_score
    - contradiction_count
    - unresolved_contradiction_count
    - graph_version
    - runtime_revision
    - publish_snapshot_id
    - lock_snapshot_id
    - replay_anchor_id
quality_dimensions:
  coverage:
    bands:
      LOW: "0-39"
blocking_rules:
  - key: MISSING_ACCEPTED_TRUTH
  - key: MISSING_LOCK_PROOF
  - key: UNRESOLVED_BLOCKING_CONTRADICTIONS
  - key: RAW_GRAPH_UNSAFE
warnings:
  LOW_COVERAGE:
    condition: "coverage_score < 70"
prohibited_output_claims:
  - Proven ROI
  - Guaranteed outcomes
`

const contentHash = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const pack = {
  packKey: TRUTH_CERTIFICATION_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-pack-1',
  contentHash: contentHash(packContent),
  boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
}

const candidate = {
  accepted_truth_count: 8,
  required_truth_count: 8,
  evidence_count: 12,
  source_count: 4,
  coverage_score: 82,
  confidence_score: 78,
  source_diversity_score: 74,
  contradiction_count: 0,
  unresolved_contradiction_count: 0,
  graph_version: 'graph-1',
  runtime_revision: 'runtime-1',
  publish_snapshot_id: 'publish-1',
  lock_snapshot_id: 'lock-1',
  replay_anchor_id: 'replay-1',
  contradiction_risk: 'LOW',
  raw_graph_leakage_detected: false,
}

const baseArgs = {
  pack,
  packContent,
  candidate,
  customerContent: { markdown: '# Executive Brief\nEvidence-led summary.' },
  asset: { outcomeAssetId: 'asset-1' },
  version: { outcomeAssetVersionId: 'asset-version-1' },
  executionId: 'truth-exec-1',
}

describe('truth-certification pack executor', () => {
  test('returns a strict exact post-validation receipt for executable content', () => {
    const result = executeTruthCertificationPack(baseArgs)

    expect(result).toMatchObject({ status: 'PASSED', result: 'ALLOW', failures: [] })
    expect(result.receipt).toMatchObject({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      boundary: 'POST_GENERATION_VALIDATION',
      receiptType: 'POST_VALIDATION',
      receiptKey: 'truth-certification-pack.post-validation.v1',
      validatorKey: 'truth-certification-pack',
      status: 'PASSED',
      result: 'ALLOW',
    })
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
      expect.objectContaining({ key: 'BOUNDARY_RECEIPT_RECORDED', status: 'PASSED' }),
    ]))
  })

  test('fails closed when the loaded version content hash is wrong', () => {
    const result = executeTruthCertificationPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:wrong' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })

  test('does not treat the descriptive Markdown umbrella as executable rules', () => {
    const result = executeTruthCertificationPack({
      ...baseArgs,
      packContent: '# Truth Certification Pack\n\nDo not include this pack in provider context.',
      pack: {
        ...pack,
        contentHash: contentHash('# Truth Certification Pack\n\nDo not include this pack in provider context.'),
      },
    })

    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('EXECUTABLE_RULES_INVALID')
  })

  test('rejects missing lock proof and prohibited customer claims', () => {
    const result = executeTruthCertificationPack({
      ...baseArgs,
      candidate: {
        ...candidate,
        lock_snapshot_id: '',
      },
      customerContent: { markdown: 'This delivers Proven ROI.' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toEqual(expect.arrayContaining([
      'MISSING_LOCK_PROOF',
      'PROHIBITED_OUTPUT_CLAIM',
    ]))
  })

  test('allows explicitly negated safety language containing a prohibited phrase', () => {
    const result = executeTruthCertificationPack({
      ...baseArgs,
      customerContent: {
        markdown: 'Do not add guaranteed outcomes beyond what is verified.',
      },
    })

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.receipt).not.toBeNull()
  })

  test('requires an explicit raw-graph leakage result', () => {
    const result = executeTruthCertificationPack({
      ...baseArgs,
      candidate: {
        ...candidate,
        raw_graph_leakage_detected: undefined,
      },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('TRUTH_EVIDENCE_INCOMPLETE')
  })
})
