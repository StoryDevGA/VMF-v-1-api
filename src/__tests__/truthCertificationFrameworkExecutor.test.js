import { createHash } from 'node:crypto'

import {
  OUTCOME_EVIDENCE_KINDS,
  TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS,
  executeTruthCertificationFramework,
  finalizeTruthCertificationFrameworkReceipt,
  parseTruthCertificationFrameworkMarkdown,
} from '../services/truthCertificationFrameworkExecutorService.js'
import { validateOutcomeBoundaryReceipt } from '../services/outcomeBoundaryReceiptService.js'
import { sanitizeOutcomeEvidenceKind } from '../services/outcomeEvidenceKindService.js'

const frameworkContent = `# Truth Certification Framework

## Governing Principle
Certification must preserve governed truth and lineage.

## Required Inputs
Use the selected validation receipts and generation-time lineage.

## Certification Process
Apply all blocking rules before assigning a certification level. Assign the highest certification level whose minimum requirements are met. Preserve warnings and known gaps. Preserve downstream lineage.

## Certification Outcome
Return an allow or block outcome with exact evidence.

## Decision Rules
Missing or failed evidence blocks certification.

## Dependencies
Truth Quality Dimensions; Certification Levels; Blocking Rules; Runtime Warning Rules; Prohibited Output Claims; Truth Preservation Rules; Lineage Preservation Rules.
`

const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const asset = { outcomeAssetId: 'draft-1' }
const version = { outcomeAssetVersionId: 'iteration-1' }
const makePack = (packKey) => ({
  packKey,
  versionId: `${packKey}-version-1`,
  contentHash: `sha256:${'a'.repeat(64)}`,
  boundary: 'POST_GENERATION_VALIDATION',
  receiptType: 'POST_VALIDATION',
})
const frameworkPack = {
  ...makePack('truth-certification-framework'),
  contentHash: hash(frameworkContent),
}
const expectedPacksByValidatorKey = Object.fromEntries(
  TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS.map((key) => [key, makePack(key)]),
)
const makeReceipt = (validatorKey) => ({
  contractVersion: 'outcome-studio.boundary-receipt.v1',
  versionId: expectedPacksByValidatorKey[validatorKey].versionId,
  contentHash: expectedPacksByValidatorKey[validatorKey].contentHash,
  boundary: 'POST_GENERATION_VALIDATION',
  receiptType: 'POST_VALIDATION',
  receiptKey: `${validatorKey}.post-validation.v1`,
  validatorKey,
  result: 'ALLOW',
  evidenceReference: `outcome:draft-1:iteration-1:${validatorKey}:execution-1`,
  status: 'PASSED',
  checks: [{ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }],
})
const dependencyReceipts = TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS.map(makeReceipt)
const receiptFor = (validatorKey) => dependencyReceipts.find((receipt) => receipt.validatorKey === validatorKey)
const certificationLevelsExecution = {
  status: 'PASSED',
  assignedLevel: 'CERTIFIED',
  receipt: receiptFor('certification-levels'),
}
const runtimeWarningExecution = {
  status: 'PASSED',
  warnings: [],
  receipt: receiptFor('runtime-warning-rules'),
}
const lineageEvidence = {
  truthSignatureId: 'truth-1',
  truthSignatureStatus: 'PROJECTED',
  truthSignatureCurrentness: 'CURRENT',
  runtimeRevision: 'revision-1',
  graphVersion: 'graph-1',
  publishSnapshotId: 'publish-1',
  lockSnapshotId: 'lock-1',
  replayAnchorId: 'replay-1',
  sourceOutputAssetId: 'source-1',
  grrExecutionId: 'grr-execution-1',
  grrRuntimeArtifactId: 'grr-artifact-1',
}
const postValidation = {
  status: 'PASSED',
  result: 'ALLOW',
  outcomeAssetId: asset.outcomeAssetId,
  outcomeAssetVersionId: version.outcomeAssetVersionId,
}
const execute = (overrides = {}) => executeTruthCertificationFramework({
  pack: frameworkPack,
  packContent: frameworkContent,
  expectedPacksByValidatorKey,
  dependencyReceipts,
  certificationLevelsExecution,
  runtimeWarningExecution,
  lineageEvidence,
  postValidation,
  asset,
  version,
  executionId: 'framework-execution-1',
  ...overrides,
})

describe('Truth Certification Framework executor', () => {
  it('loads the source-defined process and all declared dependencies', () => {
    expect(parseTruthCertificationFrameworkMarkdown(frameworkContent)).toEqual(
      expect.objectContaining({ valid: true, failures: [] }),
    )
  })

  it.each([
    ['PACK_EXECUTION', 'VERSION_CONTENT_LOADED', 'PACK_EXECUTION'],
    ['PACK_RECEIPT', 'VERSION_CONTENT_LOADED', 'NOT_RECORDED'],
    ['PACK_RECEIPT', 'DEPENDENCY_RECEIPT_SET_BOUND', 'PACK_RECEIPT'],
    ['PACK_EXECUTION', 'DEPENDENCY_RECEIPT_SET_BOUND', 'NOT_RECORDED'],
    ['FRAMEWORK_CONTROL', 'TRUTH_PRESERVATION_CONTROL', 'FRAMEWORK_CONTROL'],
    ['PACK_RECEIPT', 'TRUTH_PRESERVATION_CONTROL', 'NOT_RECORDED'],
    ['FRAMEWORK_CONTROL', 'SAFE_GUIDANCE_PROJECTED', 'NOT_RECORDED'],
    ['PACK_EXECUTION', 'UNKNOWN_FRAMEWORK_CHECK', 'NOT_RECORDED'],
    ['UNKNOWN_KIND', 'DEPENDENCY_RECEIPT_SET_BOUND', 'NOT_RECORDED'],
  ])('maps framework evidence kind %s on %s to %s', (kind, key, expected) => {
    expect(sanitizeOutcomeEvidenceKind(kind, key, {
      validatorKey: 'truth-certification-framework',
    })).toBe(expected)
  })

  it.each([
    ['PACK_EXECUTION', 'PROVIDER_COMPLETED'],
    ['PACK_RECEIPT', 'POST_VALIDATION_PASSED'],
  ])('preserves unrelated %s evidence for %s', (kind, key) => {
    expect(sanitizeOutcomeEvidenceKind(kind, key, {
      validatorKey: 'another-validator',
    })).toBe(kind)
  })

  it('rejects framework-control evidence outside the framework owner', () => {
    expect(sanitizeOutcomeEvidenceKind('FRAMEWORK_CONTROL', 'TRUTH_PRESERVATION_CONTROL', {
      validatorKey: 'another-validator',
    })).toBe('NOT_RECORDED')
  })

  it('records a strict receipt only when sibling receipts and equivalent controls pass', () => {
    const result = execute()

    expect(result.status).toBe('PASSED')
    expect(result.receipt).toEqual(expect.objectContaining({
      validatorKey: 'truth-certification-framework',
      result: 'ALLOW',
      status: 'PASSED',
    }))
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'TRUTH_PRESERVATION_CONTROL', status: 'PASSED', evidenceKind: OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL }),
      expect.objectContaining({ key: 'LINEAGE_PRESERVATION_CONTROL', status: 'PASSED', evidenceKind: OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL }),
      expect.objectContaining({ key: 'DEPENDENCY_TRUTH_CERTIFICATION_PACK_RECEIPT', status: 'PASSED', evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT }),
    ]))
    expect(validateOutcomeBoundaryReceipt({ expectedPack: frameworkPack, receipt: result.receipt }).valid).toBe(true)
  })

  it.each([
    ['missing receipt', { dependencyReceipts: dependencyReceipts.slice(1) }, 'DEPENDENCY_RECEIPT_SET_INVALID'],
    ['duplicate receipt', { dependencyReceipts: [...dependencyReceipts, dependencyReceipts[0]] }, 'DEPENDENCY_RECEIPT_SET_INVALID'],
    ['wrong receipt version', { dependencyReceipts: dependencyReceipts.map((receipt, index) => index ? receipt : { ...receipt, versionId: 'wrong-version' }) }, 'DEPENDENCY_TRUTH_QUALITY_DIMENSIONS_INVALID'],
    ['wrong draft reference', { dependencyReceipts: dependencyReceipts.map((receipt, index) => index ? receipt : { ...receipt, evidenceReference: 'outcome:another-draft:iteration-1:truth-quality-dimensions:execution-1' }) }, 'DEPENDENCY_TRUTH_QUALITY_DIMENSIONS_INVALID'],
    ['unbound certification result', { certificationLevelsExecution: { ...certificationLevelsExecution, assignedLevel: '' } }, 'CERTIFICATION_OUTCOME_NOT_BOUND'],
    ['detached certification execution', { certificationLevelsExecution: { ...certificationLevelsExecution, receipt: { ...certificationLevelsExecution.receipt } } }, 'CERTIFICATION_OUTCOME_NOT_BOUND'],
    ['unbound warning result', { runtimeWarningExecution: { ...runtimeWarningExecution, receipt: null } }, 'WARNING_RESULT_NOT_BOUND'],
    ['detached warning execution', { runtimeWarningExecution: { ...runtimeWarningExecution, receipt: { ...runtimeWarningExecution.receipt } } }, 'WARNING_RESULT_NOT_BOUND'],
    ['blocked asset validation', { postValidation: { ...postValidation, result: 'BLOCK' } }, 'TRUTH_PRESERVATION_CONTROL_FAILED'],
    ['stale truth signature', { lineageEvidence: { ...lineageEvidence, truthSignatureCurrentness: 'STALE' } }, 'LINEAGE_PRESERVATION_CONTROL_FAILED'],
    ['missing replay anchor', { lineageEvidence: { ...lineageEvidence, replayAnchorId: '' } }, 'LINEAGE_PRESERVATION_CONTROL_FAILED'],
  ])('fails closed with diagnostics for %s', (_label, overrides, expectedFailure) => {
    const result = execute(overrides)

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain(expectedFailure)
    expect(result.diagnosticEvidence).toEqual(expect.objectContaining({
      diagnosticOnly: true,
      result: 'BLOCK',
      status: 'FAILED',
    }))
  })

  it.each([
    ['truthSignatureId'],
    ['runtimeRevision'],
    ['graphVersion'],
    ['publishSnapshotId'],
    ['lockSnapshotId'],
    ['replayAnchorId'],
    ['sourceOutputAssetId'],
    ['grrExecutionId'],
    ['grrRuntimeArtifactId'],
  ])('requires the generation-time lineage field %s', (field) => {
    const result = execute({ lineageEvidence: { ...lineageEvidence, [field]: '' } })
    expect(result.failures).toContain('LINEAGE_PRESERVATION_CONTROL_FAILED')
    expect(result.receipt).toBeNull()
  })

  it('uses NOT_RECORDED when the selected framework source cannot be verified', () => {
    const result = execute({ packContent: '', pack: { ...frameworkPack, contentHash: `sha256:${'b'.repeat(64)}` } })
    expect(result.status).toBe('NOT_RECORDED')
    expect(result.receipt).toBeNull()
  })

  it('fails without a receipt when loaded content does not match its selected hash', () => {
    const result = execute({ pack: { ...frameworkPack, contentHash: `sha256:${'b'.repeat(64)}` } })
    expect(result.status).toBe('FAILED')
    expect(result.failures).toContain('PACK_CONTENT_HASH_MISMATCH')
    expect(result.receipt).toBeNull()
  })

  it('fails closed when a generated framework receipt does not satisfy the strict receipt contract', () => {
    const validExecution = execute()
    const result = finalizeTruthCertificationFrameworkReceipt({
      pack: frameworkPack,
      receipt: { ...validExecution.receipt, status: 'FAILED' },
      checks: validExecution.checks,
      executionId: 'invalid-receipt-execution',
      assetId: asset.outcomeAssetId,
      assetVersionId: version.outcomeAssetVersionId,
      assignedLevel: 'CERTIFIED',
      warnings: [],
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('BOUNDARY_RECEIPT_CONTRACT_INVALID')
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'BOUNDARY_RECEIPT_CONTRACT_VALID',
        status: 'FAILED',
        evidenceKind: 'PACK_EXECUTION',
      }),
    ]))
  })

  it.each([
    ['pack-execution check mapped as pack receipt', 'POST_VALIDATION_PASSED', 'PACK_RECEIPT'],
    ['pack-receipt check mapped as pack execution', 'DEPENDENCY_RECEIPT_SET_BOUND', 'PACK_EXECUTION'],
    ['framework-control check mapped as pack receipt', 'TRUTH_PRESERVATION_CONTROL', 'PACK_RECEIPT'],
    ['unknown framework check key', 'UNKNOWN_FRAMEWORK_CHECK', 'PACK_EXECUTION'],
    ['missing framework check kind', 'BOUNDARY_RECEIPT_RECORDED', ''],
  ])('rejects a malformed generated receipt when %s', (_label, key, evidenceKind) => {
    const validExecution = execute()
    const malformedChecks = validExecution.receipt.checks.map((candidate) => (
      candidate.key === key
        ? { ...candidate, ...(evidenceKind ? { evidenceKind } : { evidenceKind: undefined }) }
        : candidate
    ))
    const checks = key === 'UNKNOWN_FRAMEWORK_CHECK'
      ? [...malformedChecks, { key, status: 'PASSED', evidenceKind }]
      : malformedChecks
    const result = finalizeTruthCertificationFrameworkReceipt({
      pack: frameworkPack,
      receipt: { ...validExecution.receipt, checks },
      checks: validExecution.checks,
      executionId: 'invalid-check-kind-execution',
      assetId: asset.outcomeAssetId,
      assetVersionId: version.outcomeAssetVersionId,
      assignedLevel: 'CERTIFIED',
      warnings: [],
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('BOUNDARY_RECEIPT_CHECK_KIND_INVALID')
  })

  it.each([
    ['wrong framework key', { packKey: 'another-framework' }],
    ['wrong framework boundary', { boundary: 'GENERATION_CONTEXT', receiptType: 'PROVIDER_EXECUTION' }],
  ])('does not record execution for %s', (_label, packOverride) => {
    const result = execute({ pack: { ...frameworkPack, ...packOverride } })
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('PACK_IDENTITY_INVALID')
  })

  it('uses NOT_RECORDED for incomplete framework Markdown', () => {
    const incomplete = '# Truth Certification Framework\n\n## Governing Principle\nIncomplete.'
    const result = execute({
      packContent: incomplete,
      pack: { ...frameworkPack, contentHash: hash(incomplete) },
    })
    expect(result.status).toBe('NOT_RECORDED')
    expect(result.failures).toContain('SECTION_REQUIRED_INPUTS_MISSING')
    expect(result.receipt).toBeNull()
  })

  it('rejects an unselected sibling receipt even when the receipt count remains six', () => {
    const result = execute({
      dependencyReceipts: [
        ...dependencyReceipts.slice(0, -1),
        { ...dependencyReceipts.at(-1), validatorKey: 'unselected-validator' },
      ],
    })
    expect(result.failures).toContain('DEPENDENCY_RECEIPT_SET_INVALID')
    expect(result.receipt).toBeNull()
  })

  it.each([
    ['truthSignatureStatus', ''],
    ['truthSignatureCurrentness', ''],
  ])('requires current truth lineage field %s', (field, value) => {
    const result = execute({ lineageEvidence: { ...lineageEvidence, [field]: value } })
    expect(result.failures).toContain('LINEAGE_PRESERVATION_CONTROL_FAILED')
    expect(result.receipt).toBeNull()
  })
})
