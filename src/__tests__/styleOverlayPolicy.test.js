import { describe, expect, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import { normalizeStyleOverlayConstraints, readStyleOverlayConstraints,
  evaluateStyleOverlayEligibility, assertStyleOverlaySourceEligibility } from '../services/styleOverlayPolicy.js'
import { buildCommercialOutputContract, COMMERCIAL_OUTPUT_SECTION_KEYS } from '../utils/outcomeCommercialExpressionProfile.js'
import { buildCommercialStyleValidationReceipt } from '../services/commercialOutputReviewContract.js'

const outputType = { packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'commercial-paper', knowledgeAssetId: 'OT-023' }
const schema = { packType: 'OUTPUT_SCHEMA', packKey: 'commercial-paper-schema' }
const style = { packType: 'STYLE', packId: 'style-id', versionId: 'style-version', packKey: 'strategic-advisory',
  semanticVersion: '1.0.0', status: 'ACTIVE', contentHash: '' }
const constraints = () => ({ contractVersion: 'style-overlay.constraints.v1', incompatibleOutputTypes: [],
  incompatibleAudienceKeys: [], requiredRendererCapabilities: [] })
const source = content => ({ ...style, contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}` })
const eligible = overrides => evaluateStyleOverlayEligibility({ style, outputType, schema, format: 'MARKDOWN', ...overrides })

describe('exception-only style policy', () => {
  test('does not require positive pairings and never claims content or RL approval', () => {
    const result = eligible({ style: { ...style, compatibleOutputTypes: ['unrelated-output'] } })
    expect(result).toMatchObject({ status: 'ELIGIBLE_PENDING_CONTENT_AND_RL_VALIDATION', contentValidated: false, rlApproved: false,
      renderer: { format: 'MARKDOWN', adapterKey: 'outcome-studio-governed-markdown-adapter' } })
    expect(result.outputType.packKey).toBe('commercial-paper')
    expect(result.style.versionId).toBe('style-version')
  })
  test.each(['commercial-paper', 'OT-023'])('blocks an explicit output exclusion %s', key => {
    expect(() => eligible({ constraints: { ...constraints(), incompatibleOutputTypes: [key] } })).toThrow()
  })
  test('blocks an excluded audience and unsupported capability from the actual renderer registry', () => {
    expect(() => eligible({ audienceKeys: ['leadership'], constraints: { ...constraints(), incompatibleAudienceKeys: ['LEADERSHIP'] } })).toThrow()
    expect(() => eligible({ constraints: { ...constraints(), requiredRendererCapabilities: ['INVENTED_CAPABILITY'] } })).toThrow()
    expect(eligible({ constraints: { ...constraints(), requiredRendererCapabilities: ['CALLOUT', 'HEADING'] } }).renderer.supportedComponents).toContain('CALLOUT')
  })
  test.each([null, {}, { ...constraints(), extra: true }, { ...constraints(), contractVersion: 'v99' },
    { ...constraints(), incompatibleOutputTypes: ['x', 'X'] }, { ...constraints(), requiredRendererCapabilities: 'HEADING' }])('rejects malformed declared constraints %#', value => {
    expect(() => normalizeStyleOverlayConstraints(value)).toThrow()
  })
  test.each(['DRAFT', 'INACTIVE', 'ARCHIVED'])('rejects inactive style %s', status => {
    expect(() => eligible({ style: { ...style, status } })).toThrow()
  })
  test('reads optional constraints only from hash-bound source bytes without treating old positive lists as exclusions', () => {
    const content = '---\ncompatibleOutputTypes: [OT-001]\n---\n# Style'
    const pinned = source(content)
    const before = JSON.stringify(pinned)
    expect(readStyleOverlayConstraints({ source: pinned, content, contentFormat: 'MARKDOWN' })).toEqual(constraints())
    expect(() => readStyleOverlayConstraints({ source: pinned, content: content + 'changed', contentFormat: 'MARKDOWN' })).toThrow()
    expect(JSON.stringify(pinned)).toBe(before)
  })
  test('requires active exact version readback and rejects stale/hash-mismatched source', () => {
    const content = JSON.stringify({ styleConstraints: { ...constraints(), incompatibleOutputTypes: ['OT-023'] } })
    const pinned = source(content), loaded = { ...pinned, content, contentFormat: 'JSON', available: true }
    expect(() => assertStyleOverlaySourceEligibility({ style: pinned, outputType, schema, loaded })).toThrow()
    for (const changed of [{ ...loaded, versionId: 'other' }, { ...loaded, status: 'DRAFT' }, { ...loaded, available: false }]) {
      expect(() => assertStyleOverlaySourceEligibility({ style: pinned, outputType, schema, loaded: changed })).toThrow()
    }
  })
  test('rejects invalid YAML instead of interpreting it as absent exceptions', () => {
    const content = '---\nstyleConstraints: [\n---\nBody'
    expect(() => readStyleOverlayConstraints({ source: source(content), content, contentFormat: 'MARKDOWN' })).toThrow()
  })
  test('Commercial receipt checks the trusted output asset ID as well as its key and records all selected versions', () => {
    const make = excluded => {
      const content = JSON.stringify({ styleConstraints: { ...constraints(), incompatibleOutputTypes: excluded } })
      const packs = ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM'].map((packType, index) => ({
        packType, packId: `pack-${index}`, versionId: `version-${index}`, semanticVersion: '1.0.1', lifecycleStatus: 'ACTIVE',
        contentHash: index === 2 ? source(content).contentHash : `sha256:${String(index).repeat(64)}`,
        packKey: ['commercial-strategy-and-decision-paper', 'commercial-strategy-and-decision-paper-schema', 'strategic-style', 'executive-visual'][index],
      }))
      const plan = { requestedOutputTypeKey: packs[0].packKey, payload: {
        consumerIntent: { requestedOutputTypeKey: packs[0].packKey, compositionResolution: { request: { requestedStyleKey: packs[2].packKey, visualSystemKey: packs[3].packKey } } },
        resolution: { selectedPacks: packs } } }
      return { contract: buildCommercialOutputContract({ plan }), outputAssetId: 'OT-023', title: 'Paper',
        sections: COMMERCIAL_OUTPUT_SECTION_KEYS.map(sectionKey => ({ sectionKey })),
        styleSource: { ...packs[2], status: 'ACTIVE', content, contentFormat: 'JSON', available: true } }
    }
    expect(() => buildCommercialStyleValidationReceipt(make(['OT-023']))).toThrow()
    const receipt = buildCommercialStyleValidationReceipt(make([]))
    expect(receipt.outputAssetId).toBe('OT-023')
    expect(receipt.selectedPacks).toHaveLength(4)
    expect(receipt.validation.accessibilityAndVisualQuality).toBe('REQUIRES_RL')
    expect(receipt.rlApproved).toBe(false)
  })
})
