import { createHash } from 'node:crypto'

import {
  buildRuntimeWarningProofEvidence,
  executeRuntimeWarningRulesPack,
  parseRuntimeWarningRulesMarkdown,
  RUNTIME_WARNING_RULES_EXECUTOR_KEY,
  RUNTIME_WARNING_PROOF_EVIDENCE_STATES,
} from '../services/runtimeWarningRulesExecutorService.js'

const PACK_CONTENT = `# Runtime Warning Rules

## Purpose

Defines governed warning behaviour.

## Low Coverage

Warn when coverage is below the governed threshold.

## Low Confidence

Warn when confidence is low or medium.

## Low Source Diversity

Warn when source diversity is low.

## Contradictions Present

Warn when contradictions are present.

## No Customer Proof

Warn when customer proof is absent.

## No Quantified Economics

Warn when quantified economics are absent.

## Warning Behaviour

Warnings remain visible and do not become blocking failures.

## Relationship to Blocking Rules

Blocking conditions remain governed by the blocking-rules pack.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-runtime-warning-rules-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  candidate: {
    coverageScore: 30,
    confidenceBand: 'HIGH',
    sourceDiversityBand: 'HIGH',
    contradictionCount: 0,
    contradictionRisk: 'LOW',
    limitations: [
      'No ROI, financial impact, performance improvement, customer proof, or market advantage claims are made or implied because the verified record does not support them.',
    ],
  },
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_draft_iteration_test' },
  executionId: 'runtime_warning_rules_exec_test',
}

describe('runtime-warning-rules executor', () => {
  const acceptedRuntime = (coverageAreas) => ({
    framework_state: {
      evidence_pack: {
        accepted: true,
        evidenceReady: true,
        needsRefresh: false,
        state: {
          status: 'ACCEPTED',
          accepted: true,
          evidenceReady: true,
          needsRefresh: false,
        },
        discoveryHealth: { coverageAreas },
      },
    },
  })
  const missingRow = (area) => ({
    area,
    state: 'MISSING',
    evidenceCount: 0,
    acceptedEvidenceCount: 0,
    pendingReviewCount: 0,
  })

  test('parses all source-defined warning and precedence sections', () => {
    const result = parseRuntimeWarningRulesMarkdown(PACK_CONTENT)

    expect(result.valid).toBe(true)
    expect(Object.keys(result.sections)).toEqual([
      'Low Coverage',
      'Low Confidence',
      'Low Source Diversity',
      'Contradictions Present',
      'No Customer Proof',
      'No Quantified Economics',
      'Warning Behaviour',
      'Relationship to Blocking Rules',
    ])
  })

  test('records a strict receipt and truthful warnings from governed evidence', () => {
    const result = executeRuntimeWarningRulesPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.warnings).toEqual(expect.arrayContaining([
      'LOW_COVERAGE',
      'NO_CUSTOMER_PROOF',
      'NO_QUANTIFIED_ECONOMICS',
    ]))
    expect(result.receipt).toEqual(expect.objectContaining({
      receiptKey: 'runtime-warning-rules.post-validation.v1',
      validatorKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
      status: 'PASSED',
    }))
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'WARNING_EVIDENCE_COMPLETE', status: 'PASSED' }),
      expect.objectContaining({ key: 'BLOCKING_RULES_PRESERVED', status: 'PASSED' }),
      expect.objectContaining({ key: 'WARNINGS_APPLIED', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
    ]))
  })

  test('recognizes equivalent governed absence language without treating a prohibition as proof', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        limitations: ['Do not introduce ROI, financial impact, or customer proof points; none are verified here.'],
      },
    })

    expect(result.status).toBe('PASSED')
    expect(result.warnings).toEqual(expect.arrayContaining(['NO_CUSTOMER_PROOF', 'NO_QUANTIFIED_ECONOMICS']))
  })

  test('fails closed when proof presence is not explicit or limitation-backed', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, limitations: [] },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('WARNING_EVIDENCE_INCOMPLETE')
  })

  test('projects exact canonical missing evidence as resolved false', () => {
    const result = buildRuntimeWarningProofEvidence({
      runtimeInstance: acceptedRuntime([missingRow('Proof'), missingRow('Economics')]),
    })

    expect(result).toEqual({
      customerProofEvidenceState: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED,
      customerProofPresent: false,
      economicProofEvidenceState: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED,
      economicProofPresent: false,
    })
  })

  test.each([
    ['duplicate rows', acceptedRuntime([missingRow('Proof'), missingRow('proof'), missingRow('Economics')]), 'INVALID', 'RESOLVED'],
    ['numeric strings', acceptedRuntime([{ ...missingRow('Proof'), evidenceCount: '0' }, missingRow('Economics')]), 'INVALID', 'INVALID'],
    ['stale pack', (() => {
      const runtime = acceptedRuntime([missingRow('Proof'), missingRow('Economics')])
      runtime.framework_state.evidence_pack.needsRefresh = true
      return runtime
    })(), 'INVALID', 'INVALID'],
    ['mixed pack key', { framework_state: { evidencePack: acceptedRuntime([]).framework_state.evidence_pack } }, 'INVALID', 'INVALID'],
    ['competing outer paths', {
      framework_state: acceptedRuntime([]).framework_state,
      frameworkState: { evidencePack: acceptedRuntime([]).framework_state.evidence_pack },
    }, 'INVALID', 'INVALID'],
    ['invalid coverage element', acceptedRuntime([missingRow('Proof'), null, missingRow('Economics')]), 'INVALID', 'INVALID'],
    ['empty object row', acceptedRuntime([missingRow('Proof'), {}, missingRow('Economics')]), 'INVALID', 'INVALID'],
    ['Date row', acceptedRuntime([missingRow('Proof'), new Date(0), missingRow('Economics')]), 'INVALID', 'INVALID'],
    ['Map row', acceptedRuntime([missingRow('Proof'), new Map(), missingRow('Economics')]), 'INVALID', 'INVALID'],
    ['malformed non-target row', acceptedRuntime([missingRow('Proof'), { area: 'Services', state: 'MISSING' }, missingRow('Economics')]), 'INVALID', 'INVALID'],
  ])('marks %s invalid without leaking invalid proof booleans', (_label, runtimeInstance, customerState, economicState) => {
    const result = buildRuntimeWarningProofEvidence({ runtimeInstance })

    expect(result.customerProofEvidenceState).toBe(customerState)
    expect(result.economicProofEvidenceState).toBe(economicState)
    if (customerState === 'INVALID') expect(result).not.toHaveProperty('customerProofPresent')
    if (economicState === 'INVALID') expect(result).not.toHaveProperty('economicProofPresent')
  })

  test.each([
    ['empty object', {}],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['malformed non-target record', { area: 'Services', state: 'MISSING' }],
  ])('malformed %s coverage entry cannot produce a receipt', (_label, malformedRow) => {
    const proofEvidence = buildRuntimeWarningProofEvidence({
      runtimeInstance: acceptedRuntime([missingRow('Proof'), malformedRow, missingRow('Economics')]),
    })
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        ...proofEvidence,
      },
    })

    expect(proofEvidence).not.toHaveProperty('customerProofPresent')
    expect(proofEvidence).not.toHaveProperty('economicProofPresent')
    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('WARNING_EVIDENCE_INCOMPLETE')
  })

  test('ignores non-authoritative projection copies', () => {
    const result = buildRuntimeWarningProofEvidence({
      runtimeInstance: {
        framework_state: {
          acquisition: {
            discoveryHealth: { coverageAreas: [missingRow('Proof'), missingRow('Economics')] },
          },
        },
      },
    })

    expect(result).toEqual({
      customerProofEvidenceState: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.UNKNOWN,
      economicProofEvidenceState: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.UNKNOWN,
    })
  })

  test.each([
    ['INVALID', undefined],
    ['RESOLVED', undefined],
    ['BROKEN', undefined],
    [null, undefined],
  ])('does not use limitation fallback for malformed or %s state', (state) => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        customerProofEvidenceState: state,
        economicProofEvidenceState: state,
      },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('WARNING_EVIDENCE_INCOMPLETE')
  })

  test('allows limitation fallback for explicit UNKNOWN state without proof booleans', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: {
        ...baseArgs.candidate,
        customerProofEvidenceState: 'UNKNOWN',
        economicProofEvidenceState: 'UNKNOWN',
      },
    })

    expect(result.status).toBe('PASSED')
    expect(result.warnings).toEqual(expect.arrayContaining(['NO_CUSTOMER_PROOF', 'NO_QUANTIFIED_ECONOMICS']))
  })

  test('fails closed when blocking contradiction risk is presented as a warning', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      candidate: { ...baseArgs.candidate, contradictionRisk: 'BLOCKING' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('BLOCKING_CONDITION_NOT_PRESERVED')
  })

  test('fails closed on a content hash mismatch', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      pack: { ...pack, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
  })

  test('fails closed when a governed warning section is missing', () => {
    const result = executeRuntimeWarningRulesPack({
      ...baseArgs,
      packContent: PACK_CONTENT.replace('## Warning Behaviour', '## Warning Behaviour Removed'),
      pack: { ...pack, contentHash: hash(PACK_CONTENT.replace('## Warning Behaviour', '## Warning Behaviour Removed')) },
    })

    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('WARNING_SECTION_WARNING_BEHAVIOUR_INVALID')
  })
})
