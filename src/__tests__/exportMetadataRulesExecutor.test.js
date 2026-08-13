import { createHash } from 'node:crypto'

import {
  buildExportMetadataSnapshot,
  executeExportMetadataRulesPack,
  EXPORT_METADATA_RULES_EXECUTOR_KEY,
  EXPORT_METADATA_VALIDATION_MEANING,
  hashOutcomeCustomerContent,
  parseExportMetadataRulesMarkdown,
} from '../services/exportMetadataRulesExecutorService.js'
import { validateOutcomeBoundaryReceipt } from '../services/outcomeBoundaryReceiptService.js'

const PACK_CONTENT = `# Export Metadata Rules

## Purpose
Defines the truth-quality and lineage information that must accompany governed exports.

## Required Export Metadata
Where the export format supports metadata, include:
- certification level;
- coverage score;
- confidence score;
- source-diversity score;
- contradiction risk;
- truth-signature identifier;
- runtime revision;
- graph version;
- known gaps.
Where relevant, also preserve:
- active warnings;
- limitations count;
- warning count;
- generated timestamp;
- content hash;
- source output identity;
- lineage summary.

## Preservation Rules
- Metadata must describe the exact truth state used to generate the exported content.
- Truth-signature and runtime-revision references must not be replaced with newer values after generation.
- Warning severity and certification level must be preserved unchanged.
- Known gaps and limitations must not be omitted to make the export appear stronger.
- Metadata must remain linked to the corresponding content version.

## Customer-Safe Boundary
Export metadata may expose governed identifiers and quality measures, but must not expose:
- chain of reasoning;
- prompt assembly;
- raw graph internals;
- raw uploaded files;
- hidden pack content;
- storage references;
- internal safety-gate notes.

## Format Behaviour
- Structured formats should include metadata in dedicated fields.
- Human-readable formats should include a concise lineage or certification summary where required by the output schema.
- Formats incapable of preserving required governance information must not be treated as safely exportable.

## Validation Requirements
Before export, confirm that:
- the truth signature is current for the generated asset version;
- the runtime revision matches the generation event;
- required metadata fields are present;
- warnings and known gaps are preserved;
- no hidden runtime information is included;
- the export content hash can be associated with the exported version.
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packId: 'kp-truth-certification-export-metadata-rules',
  packKey: EXPORT_METADATA_RULES_EXECUTOR_KEY,
  versionId: 'kpv-truth-certification-export-metadata-rules-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const customerContent = {
  markdown: '# Executive Brief\n\nVerified business context with limitations kept visible.',
  sections: [{ key: 'draft-body', label: 'Executive Brief', body: 'Verified business context.' }],
}
const independentEvidence = {
  certificationLevel: 'EVIDENCE_PRESENT',
  truthQuality: {
    coverageScore: 30,
    confidenceScore: 100,
    sourceDiversityScore: 100,
    contradictionRisk: 'LOW',
  },
  truthSignatureId: 'truth_signature_test',
  truthSignature: { status: 'PROJECTED', currentness: 'CURRENT' },
  runtimeRevision: '1',
  graphVersion: '2.2',
  knownGaps: ['Coverage remains below the decision-ready threshold.'],
  activeWarnings: ['LOW_COVERAGE', 'NO_CUSTOMER_PROOF'],
  limitations: ['Quantified impact is not verified.'],
  generatedAt: '2026-08-12T17:00:00.000Z',
  sourceOutputAssetId: 'out_asset_test',
  lineage: {
    grrExecutionId: 'execution_test',
    grrRuntimeArtifactId: 'artifact_test',
  },
}
const draft = {
  draftId: 'outcome_draft_test',
  draftIterationId: 'outcome_draft_iteration_test',
  draftIterationNumber: 8,
}
const metadataSnapshot = buildExportMetadataSnapshot({
  pack,
  draft,
  customerContent,
  ...independentEvidence,
})
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  metadataSnapshot,
  customerContent,
  expected: independentEvidence,
  asset: { outcomeAssetId: draft.draftId },
  version: { outcomeAssetVersionId: draft.draftIterationId },
  executionId: 'export_metadata_rules_exec_test',
}

describe('export-metadata-rules executor', () => {
  test('loads the complete active Markdown rule contract', () => {
    expect(parseExportMetadataRulesMarkdown(PACK_CONTENT)).toEqual(expect.objectContaining({
      valid: true,
      failures: [],
    }))
  })

  test('records a strict exact receipt for an independently verified draft metadata snapshot', () => {
    const result = executeExportMetadataRulesPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.metadataSnapshot).toEqual(metadataSnapshot)
    expect(result.metadataSnapshot).not.toBe(metadataSnapshot)
    expect(result.metadataSnapshot.validationMeaning).toBe(EXPORT_METADATA_VALIDATION_MEANING)
    expect(result.receipt).toEqual(expect.objectContaining({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      receiptKey: 'export-metadata-rules.post-validation.v1',
      validatorKey: EXPORT_METADATA_RULES_EXECUTOR_KEY,
      status: 'PASSED',
    }))
    expect(validateOutcomeBoundaryReceipt({ expectedPack: pack, receipt: result.receipt })).toEqual(
      expect.objectContaining({ valid: true, failures: [] }),
    )
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'EXPORT_METADATA_RULES_LOADED', status: 'PASSED' }),
      expect.objectContaining({ key: 'DRAFT_VERSION_METADATA_BOUND', status: 'PASSED' }),
      expect.objectContaining({ key: 'TRUTH_QUALITY_METADATA_PRESERVED', status: 'PASSED' }),
      expect.objectContaining({ key: 'GAPS_WARNINGS_AND_LIMITATIONS_PRESERVED', status: 'PASSED' }),
      expect.objectContaining({ key: 'CUSTOMER_CONTENT_METADATA_SEPARATED', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED', message: expect.stringContaining('no export or rendition was created') }),
    ]))
  })

  test('recomputes the customer-content hash from a stable complete object projection', () => {
    expect(hashOutcomeCustomerContent({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashOutcomeCustomerContent({ a: { c: 3, d: 4 }, b: 2 }),
    )
    expect(metadataSnapshot.customerContentHash).toBe(hashOutcomeCustomerContent(customerContent))
  })

  test('returns a detached snapshot and does not share mutable evidence arrays', () => {
    const result = executeExportMetadataRulesPack(baseArgs)
    result.metadataSnapshot.knownGaps.push('mutated')
    result.metadataSnapshot.lineage.grrExecutionId = 'mutated'

    expect(metadataSnapshot.knownGaps).toEqual(['Coverage remains below the decision-ready threshold.'])
    expect(independentEvidence.knownGaps).toEqual(['Coverage remains below the decision-ready threshold.'])
    expect(metadataSnapshot.lineage.grrExecutionId).toBe('execution_test')
  })

  test('does not represent or create export, format, rendition, download, publication, delivery, or exportability state', () => {
    const result = executeExportMetadataRulesPack(baseArgs)
    const serialized = JSON.stringify({ snapshot: result.metadataSnapshot, receipt: result.receipt })

    expect(Object.keys(result.metadataSnapshot)).not.toEqual(expect.arrayContaining([
      'format', 'exportable', 'exported', 'download', 'rendition', 'publication', 'delivery',
    ]))
    expect(serialized).not.toMatch(/"(?:format|exportable|exported|download|rendition|publication|delivery)"\s*:/i)
    expect(result).not.toHaveProperty('export')
    expect(result).not.toHaveProperty('assetVersion')
  })

  test.each([
    ['wrong pack', { pack: { ...pack, packKey: 'other-pack' } }, 'PACK_IDENTITY_INVALID'],
    ['missing content', { packContent: '' }, 'PACK_CONTENT_NOT_AVAILABLE'],
    ['content hash drift', { pack: { ...pack, contentHash: `sha256:${'a'.repeat(64)}` } }, 'PACK_CONTENT_HASH_MISMATCH'],
    ['incomplete source contract', (() => {
      const content = PACK_CONTENT.replace('- known gaps.\n', '')
      return { packContent: content, pack: { ...pack, contentHash: hash(content) } }
    })(), 'REQUIRED_EXPORT_METADATA_INVALID'],
  ])('fails closed for %s', (_label, overrides, failure) => {
    const result = executeExportMetadataRulesPack({ ...baseArgs, ...overrides })

    expect(result.receipt).toBeNull()
    expect(result.metadataSnapshot).toBeNull()
    expect(result.failures).toContain(failure)
  })

  test.each([
    ['customer content hash', { customerContentHash: `sha256:${'b'.repeat(64)}` }, 'DRAFT_VERSION_METADATA_BINDING_INVALID'],
    ['certification level', { certificationLevel: 'CERTIFIED_TRUTH' }, 'TRUTH_QUALITY_METADATA_INVALID'],
    ['truth signature', { truthSignatureId: 'truth_signature_other' }, 'TRUTH_OR_RUNTIME_REFERENCE_INVALID'],
    ['runtime revision', { runtimeRevision: '2' }, 'TRUTH_OR_RUNTIME_REFERENCE_INVALID'],
    ['graph version', { graphVersion: '2.3' }, 'TRUTH_OR_RUNTIME_REFERENCE_INVALID'],
    ['known gaps', { knownGaps: [] }, 'CONSTRAINT_METADATA_NOT_PRESERVED'],
    ['active warnings', { activeWarnings: ['LOW_COVERAGE'] }, 'CONSTRAINT_METADATA_NOT_PRESERVED'],
    ['warning count', { warningCount: 1 }, 'CONSTRAINT_METADATA_NOT_PRESERVED'],
    ['generated timestamp', { generatedAt: '2026-08-12T17:01:00.000Z' }, 'GENERATION_LINEAGE_INVALID'],
    ['validation meaning', { validationMeaning: 'EXPORT_COMPLETED' }, 'GENERATION_LINEAGE_INVALID'],
  ])('fails closed when snapshot %s differs from independent evidence', (_label, snapshotOverride, failure) => {
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      metadataSnapshot: { ...metadataSnapshot, ...snapshotOverride },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain(failure)
  })

  test.each([
    ['missing', undefined],
    ['null', null],
    ['empty text', ''],
    ['whitespace text', '   '],
    ['boolean', false],
    ['array', []],
    ['object', {}],
    ['not a number', Number.NaN],
    ['negative', -1],
    ['over 100', 101],
  ])('rejects a %s independently supplied quality score', (_label, coverageScore) => {
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      expected: {
        ...independentEvidence,
        truthQuality: { ...independentEvidence.truthQuality, coverageScore },
      },
      metadataSnapshot: { ...metadataSnapshot, coverageScore },
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('TRUTH_QUALITY_METADATA_INVALID')
  })

  test.each([
    { lineage: { ...metadataSnapshot.lineage, exported: true } },
    { lineage: { ...metadataSnapshot.lineage, unexpectedReference: 'internal' } },
  ])('rejects nested export claims and non-contract lineage fields', (snapshotOverride) => {
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      metadataSnapshot: { ...metadataSnapshot, ...snapshotOverride },
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('METADATA_SNAPSHOT_SHAPE_INVALID')
  })

  test.each([
    { certification: { level: 'EVIDENCE_PRESENT' } },
    { truthSignature: { id: 'internal' } },
    { governedLineage: { execution: 'internal' } },
    { packId: 'internal-pack' },
    { packHash: 'internal-hash' },
  ])('rejects structured governance aliases in customer content', (unsafeContent) => {
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      customerContent: unsafeContent,
      metadataSnapshot: buildExportMetadataSnapshot({
        pack,
        draft,
        customerContent: unsafeContent,
        ...independentEvidence,
      }),
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('CUSTOMER_CONTENT_METADATA_LEAK')
  })

  test.each([
    '2026-08-12',
    '2026-08-12T17:00:00Z',
    'August 12, 2026 17:00 UTC',
  ])('rejects non-canonical generated timestamp %s', (generatedAt) => {
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      expected: { ...independentEvidence, generatedAt },
      metadataSnapshot: { ...metadataSnapshot, generatedAt },
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('GENERATION_LINEAGE_INVALID')
  })

  test.each([
    { truthSignatureId: 'truth_sig_internal' },
    { markdown: 'Internal reference grr_exec_123 must not be shown.' },
    { sections: [{ body: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] },
  ])('rejects structured governance metadata or internal identifiers in customer content', (unsafeContent) => {
    const unsafeSnapshot = buildExportMetadataSnapshot({
      pack,
      draft,
      customerContent: unsafeContent,
      ...independentEvidence,
    })
    const result = executeExportMetadataRulesPack({
      ...baseArgs,
      customerContent: unsafeContent,
      metadataSnapshot: unsafeSnapshot,
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('CUSTOMER_CONTENT_METADATA_LEAK')
  })
})
