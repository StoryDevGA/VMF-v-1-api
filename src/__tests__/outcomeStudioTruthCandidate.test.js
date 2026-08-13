import { createHash } from 'node:crypto'

import {
  buildOutcomeStudioTruthCertificationCandidate,
  buildTruthCertificationCandidate,
} from '../services/outcomeStudioService.js'
import {
  executeRuntimeWarningRulesPack,
  RUNTIME_WARNING_RULES_EXECUTOR_KEY,
} from '../services/runtimeWarningRulesExecutorService.js'

const missingRow = (area) => ({
  area,
  state: 'MISSING',
  evidenceCount: 0,
  acceptedEvidenceCount: 0,
  pendingReviewCount: 0,
})

const runtime = () => ({
  framework_state: {
    evidence_pack: {
      accepted: true,
      evidenceReady: true,
      needsRefresh: false,
      state: { status: 'ACCEPTED', accepted: true, evidenceReady: true, needsRefresh: false },
      discoveryHealth: { coverageAreas: [missingRow('Proof'), missingRow('Economics')] },
    },
  },
})

const PACK_CONTENT = `# Runtime Warning Rules

## Low Coverage
Warn for low coverage.
## Low Confidence
Warn for low confidence.
## Low Source Diversity
Warn for low diversity.
## Contradictions Present
Warn for contradictions.
## No Customer Proof
Warn when customer proof is absent.
## No Quantified Economics
Warn when economics are absent.
## Warning Behaviour
Warnings remain warnings.
## Relationship to Blocking Rules
Blocking rules remain blocking.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-runtime-warning-rules-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}

describe('Outcome Studio truth certification candidate', () => {
  test('uses the persisted numeric confidence rule while preserving qualitative source diversity', () => {
    const candidate = buildOutcomeStudioTruthCertificationCandidate({
      baseCandidate: {
        confidenceScore: 100,
        confidenceBand: 'HIGH',
        sourceDiversityScore: 100,
        sourceDiversityBand: 'HIGH',
      },
      runtimeQuality: {
        confidence: { score: 100, band: 'HIGH' },
        sourceDiversity: { score: 100, band: 'HIGH' },
      },
    })

    expect(candidate.confidenceBand).toBe('VERY_HIGH')
    expect(candidate.sourceDiversityBand).toBe('HIGH')
  })

  test('does not infer a source-diversity band from a score when the governed band is absent', () => {
    const candidate = buildOutcomeStudioTruthCertificationCandidate({
      baseCandidate: { sourceDiversityScore: 100 },
      runtimeQuality: { sourceDiversity: { score: 100 } },
    })

    expect(candidate.sourceDiversityBand).toBe('')
  })

  test('composes canonical runtime absence and unanimous explicit false across all sources', () => {
    const candidate = buildTruthCertificationCandidate({
      runtimeInstance: runtime(),
      grrExecution: {
        artifact: { truthEvidence: { customerProofPresent: false, economicProofPresent: false } },
        certifiedTruth: { customerProofPresent: false, economicProofPresent: false },
      },
      truthSignature: { evidence: { customerProofPresent: false, economicProofPresent: false } },
    })

    expect(candidate).toEqual(expect.objectContaining({
      customerProofEvidenceState: 'RESOLVED',
      customerProofPresent: false,
      economicProofEvidenceState: 'RESOLVED',
      economicProofPresent: false,
    }))
  })

  test('explicit true against canonical absence is invalid and cannot leak through object spreads', () => {
    const candidate = buildTruthCertificationCandidate({
      runtimeInstance: runtime(),
      grrExecution: {
        artifact: {
          truthEvidence: {
            customerProofPresent: true,
            economicProofPresent: true,
            coverageScore: 30,
            confidenceBand: 'HIGH',
            sourceDiversityBand: 'HIGH',
            contradictionCount: 0,
            contradictionRisk: 'LOW',
          },
        },
        limitations: ['No customer proof or quantified economic proof is present.'],
      },
    })

    expect(candidate.customerProofEvidenceState).toBe('INVALID')
    expect(candidate.economicProofEvidenceState).toBe('INVALID')
    expect(candidate).not.toHaveProperty('customerProofPresent')
    expect(candidate).not.toHaveProperty('economicProofPresent')

    const execution = executeRuntimeWarningRulesPack({
      pack,
      packContent: PACK_CONTENT,
      candidate,
      asset: { outcomeAssetId: 'outcome_draft_test' },
      version: { outcomeAssetVersionId: 'outcome_iteration_test' },
      executionId: 'runtime_warning_candidate_conflict_test',
    })
    expect(execution.status).toBe('FAILED')
    expect(execution.receipt).toBeNull()
    expect(execution.failures).toContain('WARNING_EVIDENCE_INCOMPLETE')
  })

  test('conflicting explicit sources are invalid independently for each field', () => {
    const candidate = buildTruthCertificationCandidate({
      runtimeInstance: {},
      grrExecution: {
        artifact: { truthEvidence: { customerProofPresent: true, economicProofPresent: false } },
        certifiedTruth: { customerProofPresent: false, economicProofPresent: false },
      },
      truthSignature: { evidence: { economicProofPresent: false } },
    })

    expect(candidate.customerProofEvidenceState).toBe('INVALID')
    expect(candidate).not.toHaveProperty('customerProofPresent')
    expect(candidate.economicProofEvidenceState).toBe('RESOLVED')
    expect(candidate.economicProofPresent).toBe(false)
  })

  test.each([
    ['mixed path', { framework_state: { evidencePack: runtime().framework_state.evidence_pack } }],
    ['competing paths', { ...runtime(), frameworkState: { evidencePack: runtime().framework_state.evidence_pack } }],
    ['stale canonical state', (() => {
      const value = runtime()
      value.framework_state.evidence_pack.needsRefresh = true
      return value
    })()],
  ])('%s is invalid and omits both proof booleans', (_label, runtimeInstance) => {
    const candidate = buildTruthCertificationCandidate({ runtimeInstance })

    expect(candidate.customerProofEvidenceState).toBe('INVALID')
    expect(candidate.economicProofEvidenceState).toBe('INVALID')
    expect(candidate).not.toHaveProperty('customerProofPresent')
    expect(candidate).not.toHaveProperty('economicProofPresent')
  })
})
