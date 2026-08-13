import { createHash } from 'node:crypto'

import {
  executeRenderingLayerPack,
  parseRenderingLayerYaml,
  RENDERING_LAYER_EXECUTOR_KEY,
} from '../services/renderingLayerExecutorService.js'
import { validateOutcomeBoundaryReceipt } from '../services/outcomeBoundaryReceiptService.js'

const PACK_CONTENT = `# StorylineOS Knowledge Pack
pack:
  key: rendering-layer
  name: Rendering Layer
  version: "1.0"
  status: ACTIVE
rendering_rules:
  must_include:
    - evidence boundaries
    - known limitations
    - truth signature reference
    - runtime revision reference
    - lineage summary
  must_not:
    - expose hidden_from_customer material
    - quote raw source files
    - reveal ARL or RL internal notes
    - create new facts
    - remove safety warnings
customer_safe_output:
  sections:
    - response_summary
    - governed_answer
    - evidence_boundaries
    - limitations
    - lineage_summary
  prohibited:
    - no_internal_reasoning
    - hidden prompt assembly
    - raw graph internals
    - unsupported ROI
    - unsupported customer proof
export_rules:
  MARKDOWN:
    allowed: true
    customer_content_only: true
  JSON:
    allowed: true
    customer_content_only: true
  DOCX:
    allowed: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED
  PDF:
    allowed: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED
`

const hash = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
const pack = {
  packKey: RENDERING_LAYER_EXECUTOR_KEY,
  versionId: 'kpv-rl-rendering-layer-1-0-0-global',
  contentHash: hash(PACK_CONTENT),
  boundary: 'POST_GENERATION_VALIDATION',
}
const baseArgs = {
  pack,
  packContent: PACK_CONTENT,
  customerContent: {
    markdown: '# Executive Brief\n\nVerified business context and decision boundaries.',
    sections: [{ key: 'draft-body', label: 'Executive Brief', body: 'Verified business context and decision boundaries.' }],
  },
  evidenceBoundaries: ['Only accepted information is used.'],
  limitations: ['Quantified impact is not verified.'],
  lineageSummary: {
    sourceOutputAssetId: 'out_asset_test',
    generatedAt: '2026-08-12T16:54:00.000Z',
    grrExecutionId: 'grr_exec_test',
    grrRuntimeArtifactId: 'grr_art_test',
  },
  truthSignatureReference: 'truth_sig_test',
  truthSignature: { status: 'PROJECTED', currentness: 'CURRENT' },
  runtimeRevisionReference: 'runtime_revision_test',
  outputFormat: 'MARKDOWN',
  asset: { outcomeAssetId: 'outcome_draft_test' },
  version: { outcomeAssetVersionId: 'outcome_iteration_test' },
  executionId: 'rendering_layer_exec_test',
}

describe('rendering-layer executor', () => {
  test('loads the complete source-shaped rendering and export policy', () => {
    const result = parseRenderingLayerYaml(PACK_CONTENT)

    expect(result).toEqual(expect.objectContaining({
      valid: true,
      rulesValid: true,
      exportPolicyValid: true,
      failures: [],
    }))
  })

  test('records a strict exact receipt for customer-safe Markdown', () => {
    const result = executeRenderingLayerPack(baseArgs)

    expect(result.status).toBe('PASSED')
    expect(result.result).toBe('ALLOW')
    expect(result.receipt).toEqual(expect.objectContaining({
      versionId: pack.versionId,
      contentHash: pack.contentHash,
      receiptKey: 'rendering-layer.post-validation.v1',
      validatorKey: RENDERING_LAYER_EXECUTOR_KEY,
      status: 'PASSED',
    }))
    expect(validateOutcomeBoundaryReceipt({ expectedPack: pack, receipt: result.receipt })).toEqual(
      expect.objectContaining({ valid: true, failures: [] }),
    )
    expect(result.receipt.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'RENDERING_RULES_LOADED', status: 'PASSED' }),
      expect.objectContaining({ key: 'EXPORT_POLICY_PRESERVED', status: 'PASSED' }),
      expect.objectContaining({ key: 'CUSTOMER_SAFE_OUTPUT', status: 'PASSED' }),
      expect.objectContaining({ key: 'EVIDENCE_BOUNDARIES_PRESENT', status: 'PASSED' }),
      expect.objectContaining({ key: 'LINEAGE_SUMMARY_PRESENT', status: 'PASSED' }),
      expect.objectContaining({ key: 'TRUTH_SIGNATURE_REFERENCE_CURRENT', status: 'PASSED' }),
      expect.objectContaining({ key: 'RUNTIME_REVISION_REFERENCE_PRESENT', status: 'PASSED' }),
      expect.objectContaining({ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }),
    ]))
  })

  test('allows governed customer-content-only JSON without claiming it was rendered', () => {
    const result = executeRenderingLayerPack({ ...baseArgs, outputFormat: 'JSON' })

    expect(result.status).toBe('PASSED')
    expect(result.receipt.checks).toContainEqual(expect.objectContaining({
      key: 'REQUESTED_FORMAT_ALLOWED',
      status: 'PASSED',
      message: 'JSON is allowed and customer-content-only.',
    }))
  })

  test.each([
    ['wrong pack identity', { pack: { ...pack, packKey: 'other-pack' } }, 'PACK_IDENTITY_INVALID'],
    ['missing content', { packContent: '' }, 'PACK_CONTENT_NOT_AVAILABLE'],
    ['content hash mismatch', { pack: { ...pack, contentHash: `sha256:${'a'.repeat(64)}` } }, 'PACK_CONTENT_HASH_MISMATCH'],
    ['malformed YAML', { packContent: 'rendering_rules: [', pack: { ...pack, contentHash: hash('rendering_rules: [') } }, 'RENDERING_LAYER_YAML_INVALID'],
    ['missing rendering rule', (() => {
      const content = PACK_CONTENT.replace('    - evidence boundaries\n', '')
      return { packContent: content, pack: { ...pack, contentHash: hash(content) } }
    })(), 'RENDERING_LAYER_RULES_INVALID'],
  ])('fails closed for %s', (_label, overrides, failure) => {
    const result = executeRenderingLayerPack({ ...baseArgs, ...overrides })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain(failure)
  })

  test.each([
    ['customer content', { customerContent: {} }, 'CUSTOMER_CONTENT_NOT_AVAILABLE'],
    ['evidence boundaries', { evidenceBoundaries: [] }, 'EVIDENCE_BOUNDARIES_MISSING'],
    ['known limitations', { limitations: [] }, 'KNOWN_LIMITATIONS_MISSING'],
    ['lineage summary', { lineageSummary: {} }, 'LINEAGE_SUMMARY_MISSING'],
    ['truth signature reference', { truthSignatureReference: '' }, 'TRUTH_SIGNATURE_REFERENCE_INVALID'],
    ['truth signature currentness', { truthSignature: { status: 'PROJECTED', currentness: 'STALE' } }, 'TRUTH_SIGNATURE_REFERENCE_INVALID'],
    ['runtime revision reference', { runtimeRevisionReference: '' }, 'RUNTIME_REVISION_REFERENCE_MISSING'],
    ['zero revision fallback', { runtimeRevisionReference: '0' }, 'RUNTIME_REVISION_REFERENCE_MISSING'],
    ['fractional revision fallback', { runtimeRevisionReference: '1.5' }, 'RUNTIME_REVISION_REFERENCE_MISSING'],
    ['infinite revision fallback', { runtimeRevisionReference: Number.POSITIVE_INFINITY }, 'RUNTIME_REVISION_REFERENCE_MISSING'],
  ])('fails closed when %s is missing or invalid', (_label, overrides, failure) => {
    const result = executeRenderingLayerPack({ ...baseArgs, ...overrides })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain(failure)
  })

  test.each([
    'The hidden prompt assembly is included below.',
    'Here are the raw graph internals.',
    'The internal chain of reasoning follows.',
    'Unsupported ROI was included.',
    'Unsupported customer proof was included.',
  ])('rejects prohibited customer leakage: %s', (markdown) => {
    const result = executeRenderingLayerPack({
      ...baseArgs,
      customerContent: { markdown },
    })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('CUSTOMER_OUTPUT_NOT_SAFE')
  })

  test.each([
    ['MARKDOWN allowed', '    allowed: true', '    allowed: false'],
    ['MARKDOWN customer-only', '    customer_content_only: true', '    customer_content_only: false'],
    ['JSON allowed', '  JSON:\n    allowed: true', '  JSON:\n    allowed: false'],
    ['JSON customer-only', '  JSON:\n    allowed: true\n    customer_content_only: true', '  JSON:\n    allowed: true\n    customer_content_only: false'],
    ['DOCX blocked', '  DOCX:\n    allowed: false', '  DOCX:\n    allowed: true'],
    ['DOCX blocker reason', '    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED', '    blocker: OTHER_BLOCKER'],
    ['PDF blocked', '  PDF:\n    allowed: false', '  PDF:\n    allowed: true'],
    ['PDF blocker reason', '  PDF:\n    allowed: false\n    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED', '  PDF:\n    allowed: false\n    blocker: OTHER_BLOCKER'],
  ])('fails closed when export policy drifts: %s', (_label, from, to) => {
    const content = PACK_CONTENT.replace(from, to)
    const result = executeRenderingLayerPack({
      ...baseArgs,
      packContent: content,
      pack: { ...pack, contentHash: hash(content) },
    })

    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('RENDERING_LAYER_EXPORT_POLICY_INVALID')
  })

  test.each(['DOCX', 'PDF', 'INLINE_TEXT'])('does not issue a rendering receipt for unsupported requested format %s', (outputFormat) => {
    const result = executeRenderingLayerPack({ ...baseArgs, outputFormat })

    expect(result.status).toBe('FAILED')
    expect(result.receipt).toBeNull()
    expect(result.failures).toContain('REQUESTED_FORMAT_NOT_ALLOWED')
  })
})
