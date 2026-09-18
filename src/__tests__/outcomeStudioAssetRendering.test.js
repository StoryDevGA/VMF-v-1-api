import { describe, expect, test } from '@jest/globals'
import JSZip from 'jszip'
import models from '../models/index.js'
import OutcomeRenderOutput from '../models/OutcomeRenderOutput.js'
import {
  OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES,
  OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION,
  buildOutcomeStudioRenderableAsset,
  buildOutcomeStudioRenderableAssetFromPersistedVersion,
  listOutcomeStudioAssetRenderers,
  renderOutcomeStudioAsset,
  resolveOutcomeStudioAssetRenderer,
  __testables,
} from '../services/outcomeStudioAssetRenderingService.js'

const ids = {
  tenantId: '507f1f77bcf86cd799439011',
  customerId: '507f1f77bcf86cd799439012',
  runtimeInstanceId: '507f1f77bcf86cd799439013',
}

const stylePackReceipt = {
  packKey: 'style-executive-neutral',
  versionId: 'style-version-1',
  version: '1.0.0',
  contentHash: 'sha256:style-pack',
  status: 'RESOLVED',
  tokens: { accentColor: '#2c7db9' },
}

const visualSystemPackReceipt = {
  packKey: 'visual-system-executive-neutral',
  versionId: 'visual-version-1',
  version: '1.0.0',
  contentHash: 'sha256:visual-pack',
  status: 'RESOLVED',
  allowedComponents: ['HEADING', 'PARAGRAPH', 'CALLOUT', 'METRIC'],
}

const assetVersion = {
  ...ids,
  outcomeAssetId: 'outcome_asset_ss027_fixture',
  outcomeAssetVersionId: 'outcome_asset_version_ss027_fixture',
  versionNumber: 1,
  status: 'CURRENT',
  runtimeRevision: { id: 'runtime-revision-27', number: 27 },
  title: 'Commercial Strategy Decision Paper',
  outputTypeKey: 'commercial-strategy-decision-paper',
  outputSchemaKey: 'commercial-strategy-decision-paper.v1',
  customerContent: {
    markdown: '# Commercial Strategy Decision Paper\n\n## Recommendation\n\nUse the governed evidence base to move from a coherent replacement proposition to a repeatable buying decision system.',
    sections: [{
      key: 'recommendation',
      label: 'Recommendation',
      blocks: [{
        type: 'PARAGRAPH',
        text: 'Use the governed evidence base to move from a coherent replacement proposition to a repeatable buying decision system.',
      }],
    }],
  },
  evidenceReferences: [{ sourceId: 'evidence-source-1', locator: 'framework_state.evidence_pack', status: 'ACCEPTED' }],
  governanceMarkers: {
    evidenceBoundary: 'Current accepted evidence from the bound revision only.',
    claimRestrictions: ['Do not invent quantified impact, ROI or named-customer proof.'],
    warnings: ['Review the recommendation against current evidence before circulation.'],
    limitations: ['This foundation proof is not Parlon parity or Product acceptance.'],
  },
  visualIntent: {
    layoutPattern: 'DECISION',
    components: [{ type: 'CALLOUT' }],
  },
}

const buildInput = (overrides = {}) => ({
  assetVersion: { ...assetVersion, ...overrides },
  stylePackReceipt: overrides.stylePackReceipt || stylePackReceipt,
  visualSystemPackReceipt: overrides.visualSystemPackReceipt || visualSystemPackReceipt,
  persistRenderOutput: async () => {},
  outputContract: {
    outputTypeKey: 'commercial-strategy-decision-paper',
    outputSchemaKey: 'commercial-strategy-decision-paper.v1',
    styleKey: 'style-executive-neutral',
    audience: 'Parlon leadership',
  },
})

describe('SS-027 Outcome Studio asset rendering foundation', () => {
  test('builds one stable source model with a content checksum independent of target format', () => {
    const model = buildOutcomeStudioRenderableAsset(buildInput())

    expect(model).toEqual(expect.objectContaining({
      modelVersion: 'outcome-studio.asset-rendering.v1',
      assetId: assetVersion.outcomeAssetId,
      assetVersionId: assetVersion.outcomeAssetVersionId,
      versionNumber: 1,
      sourceContentChecksum: expect.stringMatching(/^sha256:/),
      llmRole: 'LAYOUT_AND_COMPONENT_INTENT_ONLY',
    }))
    expect(model.sections[0].blocks[0].type).toBe('PARAGRAPH')
    expect(model.packReceipts.style.packKey).toBe(stylePackReceipt.packKey)
    expect(model.packReceipts.visualSystem.allowedComponents).toContain('CALLOUT')
    expect(model.markdown).toContain('repeatable buying decision system')
  })

  test('treats structured sections as authoritative across Markdown and HTML', async () => {
    const input = buildInput({
      customerContent: {
        markdown: '# Wrong projection\n\n## Wrong section\n\nDO_NOT_PURCHASE',
        sections: [{
          key: 'recommendation',
          label: 'Recommendation',
          blocks: [{ type: 'PARAGRAPH', text: 'PROCEED_WITH_PURCHASE' }],
        }],
      },
    })
    const result = await renderOutcomeStudioAsset({ ...input, formats: ['MARKDOWN', 'HTML'] })
    const markdown = Buffer.from(result.renderOutputs[0].delivery.contentBase64, 'base64').toString('utf8')
    const html = Buffer.from(result.renderOutputs[1].delivery.contentBase64, 'base64').toString('utf8')
    expect(markdown).toContain('PROCEED_WITH_PURCHASE')
    expect(html).toContain('PROCEED_WITH_PURCHASE')
    expect(markdown).not.toContain('DO_NOT_PURCHASE')
    expect(html).not.toContain('DO_NOT_PURCHASE')
    expect(result.model.contentSource).toBe('STRUCTURED_SECTIONS')
  })

  test('passes the early Markdown and HTML checkpoint with separate receipts over one version', async () => {
    const result = await renderOutcomeStudioAsset({ ...buildInput(), formats: ['MARKDOWN', 'HTML'] })

    expect(result.renderOutputs).toHaveLength(2)
    expect(new Set(result.renderOutputs.map(({ record }) => record.outcomeAssetVersionId))).toEqual(new Set([assetVersion.outcomeAssetVersionId]))
    expect(new Set(result.renderOutputs.map(({ record }) => record.sourceContentChecksum))).toEqual(new Set([result.model.sourceContentChecksum]))
    expect(result.renderOutputs[0].delivery.contentBase64).toBeDefined()
    const markdown = Buffer.from(result.renderOutputs[0].delivery.contentBase64, 'base64').toString('utf8')
    const html = Buffer.from(result.renderOutputs[1].delivery.contentBase64, 'base64').toString('utf8')
    expect(markdown).toContain('Evidence boundary: Current accepted evidence')
    expect(html).toContain('data-style-pack="style-executive-neutral"')
    expect(html).toContain('Evidence boundary: Current accepted evidence')
    expect(result.renderOutputs.map(({ record }) => record.renderReceipt.renderer.registryVersion)).toEqual([
      OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION,
      OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION,
    ])
  })

  test('keeps the source version stable when presentation-only Style input changes', async () => {
    const baseline = await renderOutcomeStudioAsset({ ...buildInput(), formats: ['HTML'] })
    const restyled = await renderOutcomeStudioAsset({
      ...buildInput(),
      stylePackReceipt: { ...stylePackReceipt, tokens: { accentColor: '#9b4dca' } },
      formats: ['HTML'],
    })

    expect(restyled.model.sourceContentChecksum).toBe(baseline.model.sourceContentChecksum)
    expect(restyled.model.assetVersionId).toBe(baseline.model.assetVersionId)
    expect(restyled.renderOutputs[0].record.artifact.outputChecksum)
      .not.toBe(baseline.renderOutputs[0].record.artifact.outputChecksum)
  })

  test('applies allow-listed Style tokens to binary render adapters without changing the source checksum', async () => {
    const baseline = await renderOutcomeStudioAsset({ ...buildInput(), formats: ['DOCX', 'PDF', 'PPTX'] })
    const restyled = await renderOutcomeStudioAsset({
      ...buildInput(),
      stylePackReceipt: { ...stylePackReceipt, tokens: { accentColor: '#9b4dca' } },
      formats: ['DOCX', 'PDF', 'PPTX'],
    })

    expect(restyled.model.sourceContentChecksum).toBe(baseline.model.sourceContentChecksum)
    expect(restyled.renderOutputs.map(({ record }) => record.artifact.outputChecksum))
      .not.toEqual(baseline.renderOutputs.map(({ record }) => record.artifact.outputChecksum))
    expect(restyled.renderOutputs.every(({ record }) => (
      record.renderReceipt.appliedInputs.stylePack.appliedTo.length === 1
        && record.renderReceipt.appliedInputs.stylePack.tokenKeys.includes('accentColor')
    ))).toBe(true)
  })

  test('scopes OpenXML style replacement to color attributes and preserves governed text', async () => {
    const archive = new JSZip()
    archive.file('word/document.xml', '<w:document><w:t>F4F6F8</w:t><w:shd w:fill="F4F6F8"/></w:document>')
    const source = await archive.generateAsync({ type: 'nodebuffer' })
    const styled = await __testables.applyOpenXmlStyleTokens(source, { surfaceColor: '#ABCDEF' })
    const result = await JSZip.loadAsync(styled.buffer)
    const xml = await result.file('word/document.xml').async('string')

    expect(xml).toContain('<w:t>F4F6F8</w:t>')
    expect(xml).toContain('w:fill="ABCDEF"')
  })

  test('groups consecutive HTML list blocks and preserves governance wording', () => {
    const model = buildOutcomeStudioRenderableAsset(buildInput({
      customerContent: {
        sections: [{
          key: 'list',
          label: 'List',
          blocks: [
            { type: 'LIST', text: 'First item' },
            { type: 'LIST', text: 'Second item' },
          ],
        }],
      },
      governanceMarkers: {
        ...assetVersion.governanceMarkers,
        evidenceBoundary: 'Preserve runtime performance wording exactly.',
      },
    }))
    const html = __testables.renderHtml(model)
    const presentation = __testables.buildPresentationInput(model)

    expect(html).toContain('<ul><li>First item</li><li>Second item</li></ul>')
    expect(JSON.stringify(presentation)).toContain('runtime performance wording exactly')
  })

  test('honours explicit governed inputs on the plain-object render seam', async () => {
    const input = buildInput()
    const { stylePackReceipt: _style, visualSystemPackReceipt: _visual, ...assetInput } = input.assetVersion
    const result = await renderOutcomeStudioAsset({
      ...input,
      assetVersion: assetInput,
      evidenceReferences: assetVersion.evidenceReferences,
      governanceMarkers: assetVersion.governanceMarkers,
      visualIntent: assetVersion.visualIntent,
      stylePackReceipt,
      visualSystemPackReceipt,
      formats: ['MARKDOWN'],
    })

    expect(result.model.governanceMarkers.evidenceBoundary).toContain('Current accepted evidence')
    expect(result.model.packReceipts.visualSystem.packKey).toBe(visualSystemPackReceipt.packKey)
    expect(result.renderOutputs).toHaveLength(1)
  })

  test('renders all five formats from the same model and produces receipt-only child records', async () => {
    const result = await renderOutcomeStudioAsset({ ...buildInput() })
    const formats = result.renderOutputs.map(({ record }) => record.format)
    expect(formats).toEqual(['MARKDOWN', 'HTML', 'DOCX', 'PDF', 'PPTX'])
    expect(new Set(result.renderOutputs.map(({ record }) => record.sourceContentChecksum)).size).toBe(1)
    expect(result.renderOutputs.every(({ record }) => !Object.prototype.hasOwnProperty.call(record, 'markdown'))).toBe(true)
    expect(result.renderOutputs.every(({ record }) => record.renderReceipt.contentIncludedInReceipt === false)).toBe(true)

    const docx = result.renderOutputs.find(({ record }) => record.format === 'DOCX')
    const pptx = result.renderOutputs.find(({ record }) => record.format === 'PPTX')
    const pdf = result.renderOutputs.find(({ record }) => record.format === 'PDF')
    expect(Buffer.from(docx.delivery.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')
    expect(Buffer.from(pptx.delivery.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')
    expect(Buffer.from(pdf.delivery.contentBase64, 'base64').toString('utf8')).toContain('%PDF')
    expect(docx.record.renderReceipt.governanceMarkers.claimRestrictions[0]).toContain('Do not invent')
  })

  test('models Render Output as a child of the version without copying governed content', () => {
    const result = buildOutcomeStudioRenderableAsset(buildInput())
    const child = {
      renderOutputId: 'render-output-child-1',
      outcomeAssetId: result.assetId,
      outcomeAssetVersionId: result.assetVersionId,
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      runtimeInstanceId: ids.runtimeInstanceId,
      runtimeRevisionId: result.runtimeRevision.id,
      versionNumber: result.versionNumber,
      format: 'HTML',
      status: 'READY',
      sourceContentChecksum: result.sourceContentChecksum,
      outputContract: result.outputContract,
      renderer: { adapterKey: 'html', templateKey: 'html.v1', registryVersion: OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION },
      stylePackReceipt: result.packReceipts.style,
      visualSystemPackReceipt: result.packReceipts.visualSystem,
      visualResolution: { requested: [], accepted: [], downgraded: [], unsupported: [] },
      artifact: { filename: 'asset.html', mimeType: 'text/html', extension: 'html', byteLength: 10, outputChecksum: 'sha256:output' },
      renderReceipt: { exportStatus: 'READY', contentIncludedInReceipt: false },
    }
    const document = new OutcomeRenderOutput(child)
    expect(document.validateSync()).toBeUndefined()
    expect(document.schema.path('outcomeAssetVersionId')).toBeDefined()
    expect(document.toObject()).not.toHaveProperty('customerContent')
    expect(models.OutcomeRenderOutput).toBe(OutcomeRenderOutput)
    expect(OutcomeRenderOutput.schema.indexes().some(([fields]) => fields.outcomeAssetVersionId && fields.createdAt)).toBe(true)
  })

  test('adapts the persisted OutcomeAssetVersion shape without relying on unsaved fields', () => {
    const persistedVersion = new models.OutcomeAssetVersion({
      ...assetVersion,
      contextBindings: {
        outputContractResolution: {
          outputType: { key: 'commercial-strategy-decision-paper', version: '1.0.0' },
          outputSchema: { key: 'commercial-strategy-decision-paper.v1', version: '1.0.0' },
          style: { key: 'style-executive-neutral', version: '1.0.0' },
        },
      },
      truthSignature: {
        evidence: {
          references: [{ sourceId: 'evidence-source-1', locator: 'framework_state.evidence_pack', status: 'ACCEPTED' }],
        },
      },
      lineageSummary: { runtimeRevisionId: 'runtime-revision-27', runtimeRevisionNumber: 27 },
    })
    const model = buildOutcomeStudioRenderableAssetFromPersistedVersion({
      assetVersion: persistedVersion,
      stylePackReceipt,
      visualSystemPackReceipt,
      governanceMarkers: assetVersion.governanceMarkers,
      visualIntent: assetVersion.visualIntent,
    })
    expect(model.assetVersionStatus).toBe('CURRENT')
    expect(model.outputContract.outputSchemaKey).toBe('commercial-strategy-decision-paper.v1')
    expect(model.evidenceReferences[0].status).toBe('ACCEPTED')
    return renderOutcomeStudioAsset({
      assetVersion: persistedVersion,
      stylePackReceipt,
      visualSystemPackReceipt,
      governanceMarkers: assetVersion.governanceMarkers,
      visualIntent: assetVersion.visualIntent,
      formats: ['HTML'],
      persistRenderOutput: async () => {},
    }).then((result) => expect(result.renderOutputs[0].record.outcomeAssetVersionId).toBe(assetVersion.outcomeAssetVersionId))
  })

  test('projects every structured section and governance item into PPTX input', () => {
    const model = buildOutcomeStudioRenderableAsset(buildInput({
      customerContent: {
        sections: [
          assetVersion.customerContent.sections[0],
          { key: 'second', label: 'Second section', blocks: [{ type: 'PARAGRAPH', text: 'SECOND_SECTION_CONTENT' }] },
        ],
      },
      governanceMarkers: {
        ...assetVersion.governanceMarkers,
        claimRestrictions: ['Restriction one.', 'Restriction two with enough detail to remain visible.'],
      },
    }))
    const presentation = __testables.buildPresentationInput(model, { effective: ['CALLOUT'] })
    const serialized = JSON.stringify(presentation)
    expect(serialized).toContain('SECOND_SECTION_CONTENT')
    expect(serialized).toContain('Restriction two with enough detail')
    expect(presentation.metadata.status).toBe('APPROVED')
  })

  test('downgrades a component only when the declared fallback is allowed and records the downgrade', async () => {
    const baseline = await renderOutcomeStudioAsset({ ...buildInput({ visualIntent: { layoutPattern: 'DECISION', components: [] } }), formats: ['HTML'] })
    const result = await renderOutcomeStudioAsset({
      ...buildInput({ visualIntent: { layoutPattern: 'DECISION', components: [{ type: 'CHART', fallbackType: 'CALLOUT' }] } }),
      formats: ['HTML'],
    })
    expect(result.renderOutputs[0].record.visualResolution.downgraded).toEqual([
      { from: 'CHART', to: 'CALLOUT', reason: 'REQUESTED_COMPONENT_NOT_RENDERABLE' },
    ])
    expect(result.renderOutputs[0].record.renderReceipt.exportStatus).toBe('READY')
    const html = Buffer.from(result.renderOutputs[0].delivery.contentBase64, 'base64').toString('utf8')
    expect(html).toContain('data-visual-component="CALLOUT"')
    expect(result.renderOutputs[0].record.artifact.outputChecksum).not.toBe(baseline.renderOutputs[0].record.artifact.outputChecksum)
    expect(result.renderOutputs[0].record.visualResolution.effective).toEqual(['CALLOUT'])
  })

  test('fails closed for an unallowed visual without a governed fallback', async () => {
    await expect(renderOutcomeStudioAsset({
      ...buildInput({ visualIntent: { layoutPattern: 'DECISION', components: [{ type: 'CHART' }] } }),
      formats: ['HTML'],
    })).rejects.toEqual(expect.objectContaining({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.VISUAL_UNSUPPORTED,
      reason: 'VISUAL_COMPONENT_UNSUPPORTED',
      details: expect.objectContaining({ contentIncludedInError: false }),
    }))
  })

  test.each([
    ['rejected evidence', { evidenceReferences: [{ sourceId: 'source-1', locator: 'evidence', status: 'REJECTED' }] }, 'EVIDENCE_REFERENCE_STATUS_NOT_ACCEPTED'],
    ['disabled Style pack', { stylePackReceipt: { ...stylePackReceipt, status: 'DISABLED' } }, 'STYLE_PACK_RECEIPT_STATUS_NOT_RESOLVED'],
    ['superseded asset version', { status: 'SUPERSEDED' }, 'ASSET_VERSION_STATUS_NOT_RENDERABLE'],
  ])('fails closed for %s', (name, overrides, reason) => {
    expect(() => buildOutcomeStudioRenderableAsset(buildInput(overrides))).toThrow(expect.objectContaining({ reason }))
  })

  test.each([
    ['missing governed content', { customerContent: null }, 'GOVERNED_CUSTOMER_CONTENT_MISSING'],
    ['missing evidence boundary', { governanceMarkers: { claimRestrictions: ['Keep claims bounded.'] } }, 'EVIDENCE_BOUNDARY_MISSING'],
    ['missing asset version id', { outcomeAssetVersionId: '' }, 'ASSET_VERSION_IDENTITY_INVALID'],
  ])('fails closed for %s before rendering', (name, overrides, reason) => {
    expect(() => buildOutcomeStudioRenderableAsset(buildInput(overrides))).toThrow(expect.objectContaining({ reason }))
  })

  test('does not return delivery when receipt persistence fails', async () => {
    const cause = new Error('receipt store unavailable')
    await expect(renderOutcomeStudioAsset({
      ...buildInput(),
      formats: ['MARKDOWN'],
      persistRenderOutput: async () => { throw cause },
    })).rejects.toEqual(expect.objectContaining({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.RECEIPT_PERSISTENCE_FAILED,
      reason: 'RENDER_OUTPUT_RECEIPT_PERSISTENCE_FAILED',
      cause,
    }))
  })

  test('requires receipt persistence before any governed delivery', async () => {
    const input = { ...buildInput() }
    delete input.persistRenderOutput
    await expect(renderOutcomeStudioAsset(input)).rejects.toEqual(expect.objectContaining({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.RECEIPT_PERSISTENCE_REQUIRED,
      reason: 'RENDER_OUTPUT_RECEIPT_PERSISTENCE_REQUIRED',
    }))
  })

  test('blocks changed governed content from reusing an existing version', async () => {
    const baseline = await renderOutcomeStudioAsset({ ...buildInput(), formats: ['HTML'] })
    await expect(renderOutcomeStudioAsset({
      ...buildInput({
        customerContent: {
          ...assetVersion.customerContent,
          sections: [{
            ...assetVersion.customerContent.sections[0],
            blocks: [{ type: 'PARAGRAPH', text: 'Substance changed; create a new version.' }],
          }],
        },
      }),
      formats: ['HTML'],
      existingRenderOutputs: [baseline.renderOutputs[0].record],
    })).rejects.toEqual(expect.objectContaining({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.CONTENT_CHANGED_REQUIRES_NEW_VERSION,
      reason: 'ASSET_VERSION_CONTENT_CHANGED_REQUIRES_NEW_VERSION',
    }))
  })

  test('keeps registry selection explicit and bounded to governed adapters', () => {
    expect(listOutcomeStudioAssetRenderers().map(({ format }) => format)).toEqual(['MARKDOWN', 'HTML', 'DOCX', 'PDF', 'PPTX'])
    expect(resolveOutcomeStudioAssetRenderer({ format: 'pptx', outputContract: buildInput().outputContract })).toEqual(expect.objectContaining({
      format: 'PPTX',
      adapterKey: 'outcome-studio-governed-pptx-adapter',
      templateKey: 'executive-presentation-neutral.v0.1',
      selectionReason: 'FORMAT_REGISTERED_AND_OUTPUT_CONTRACT_BOUND',
    }))
    expect(() => resolveOutcomeStudioAssetRenderer({ format: 'SVG' })).toThrow(expect.objectContaining({ reason: 'RENDER_FORMAT_UNSUPPORTED' }))
  })
})
