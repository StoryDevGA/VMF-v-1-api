import { describe, expect, jest, test } from '@jest/globals'
import JSZip from 'jszip'
import {
  __testables,
  describeOutputDerivative,
  OUTPUT_SERVICE_CONTRACT_VERSION,
  OUTPUT_SERVICE_ERROR_CODES,
  renderOutputDerivative,
} from '../services/outputService.js'

const baseInput = {
  capabilityBinding: {
    outputTypeKey: 'executive-brief',
    outputSchemaKey: 'executive-brief-schema',
    styleKey: 'executive-style',
  },
  documentMetadata: {
    title: 'Governed Executive Narrative',
    deliverableType: 'Executive Brief',
    outputTypeDisplayKey: 'EXECUTIVE_BRIEF',
    versionNumber: 1,
    status: 'GENERATED',
    warnings: ['Review the commercial assumptions.'],
    limitations: ['Use current approved information only.'],
  },
  governedContent: {
    markdown: '# Executive narrative\n\nCustomer-facing content only.',
    structuredContent: {
      markdown: '# Executive narrative\n\nCustomer-facing content only.',
      sections: [{ key: 'executive', label: 'Executive narrative', body: 'Customer-facing content only.' }],
    },
  },
  sourceBinding: {
    assetId: 'outcome_asset_fixture',
    assetVersionId: 'outcome_asset_version_fixture',
    versionNumber: 1,
  },
}

describe('Output Service compatibility foundation', () => {
  test('describes the deterministic registered filename without accepting caller MIME or extension', () => {
    expect(describeOutputDerivative({ ...baseInput, format: 'pdf' })).toEqual({
      filename: 'governed-executive-narrative-v1.pdf',
      format: 'PDF',
      mimeType: 'application/pdf',
    })
  })

  test.each([
    ['MARKDOWN', 'text/markdown', 'INLINE_TEXT'],
    ['JSON', 'application/json', 'INLINE_JSON'],
    ['DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'INLINE_BASE64'],
    ['PDF', 'application/pdf', 'INLINE_BASE64'],
  ])('renders and validates the existing %s delivery contract before ready evidence', async (
    format,
    mimeType,
    deliveryPolicy,
  ) => {
    const persistReadyEvidence = jest.fn(async (evidence) => {
      expect(evidence).toEqual(expect.objectContaining({
        contractVersion: OUTPUT_SERVICE_CONTRACT_VERSION,
        format,
        mimeType,
        byteLength: expect.any(Number),
        outputChecksum: expect.stringMatching(/^sha256:/),
        sourceContentChecksum: expect.stringMatching(/^sha256:/),
        derivativeFingerprint: expect.stringMatching(/^sha256:/),
        deliveryPolicy,
        contentIncludedInEvidence: false,
        validation: expect.objectContaining({ status: 'PASS' }),
      }))
      expect(JSON.stringify(evidence)).not.toContain('Customer-facing content only.')
    })

    const result = await renderOutputDerivative({
      ...baseInput,
      format,
      persistReadyEvidence,
    })

    expect(result.delivery).toEqual(expect.objectContaining({
      format,
      filename: `governed-executive-narrative-v1.${format.toLowerCase() === 'markdown' ? 'md' : format.toLowerCase()}`,
      mimeType,
      exportAvailable: true,
    }))
    expect(persistReadyEvidence).toHaveBeenCalledTimes(1)

    if (format === 'MARKDOWN') {
      expect(result.delivery.content).toContain('## Important Review Notes')
      expect(result.delivery.content).toContain('## Limitations')
    } else if (format === 'JSON') {
      expect(result.delivery.content).toEqual(expect.objectContaining({
        title: 'Governed Executive Narrative',
        deliverableType: 'Executive Brief',
        version: 1,
        status: 'GENERATED',
        content: baseInput.governedContent.structuredContent,
      }))
    } else if (format === 'DOCX') {
      expect(result.delivery).toEqual(expect.objectContaining({
        encoding: 'base64',
        contentBase64: expect.any(String),
      }))
      expect(result.evidence).toEqual(expect.objectContaining({
        capabilityKey: 'outcome-professional-document-dev-test',
        engine: expect.objectContaining({
          key: 'DOCX_JS_IN_PROCESS_DEVELOPMENT_TEST',
          version: 'docx@9.7.1',
        }),
        validation: expect.objectContaining({
          checks: expect.arrayContaining([
            'DOCX_CORE_ENTRIES_PRESENT',
            'DOCX_RELATIONSHIPS_INTERNAL_ONLY',
          ]),
        }),
      }))
      const archive = await JSZip.loadAsync(Buffer.from(result.delivery.contentBase64, 'base64'))
      const documentXml = await archive.file('word/document.xml').async('string')
      const stylesXml = await archive.file('word/styles.xml').async('string')
      const numberingXml = await archive.file('word/numbering.xml').async('string')
      expect(documentXml).toContain('Customer-facing content only.')
      expect(documentXml.match(/Use current approved information only\./g)).toHaveLength(1)
      expect(stylesXml).toContain('Heading 1')
      expect(numberingXml).toContain('decimal')
    } else {
      expect(result.delivery).toEqual(expect.objectContaining({
        encoding: 'base64',
        contentBase64: expect.any(String),
      }))
      const rendered = Buffer.from(result.delivery.contentBase64, 'base64').toString('utf8')
      expect(rendered).toContain('%PDF-1.4')
      expect(rendered).toContain('Customer-facing content only.')
    }
  })

  test('does not duplicate warnings or limitations already present in governed Markdown', async () => {
    const result = await renderOutputDerivative({
      ...baseInput,
      format: 'DOCX',
      governedContent: {
        ...baseInput.governedContent,
        markdown: [
          '# Governed Executive Narrative',
          '',
          '## Decision',
          '',
          'Proceed with the bounded test.',
          '',
          '## Important Review Notes',
          '',
          '- Review the commercial assumptions.',
          '',
          '## Limitations',
          '',
          '- Use current approved information only.',
        ].join('\n'),
      },
    })
    const archive = await JSZip.loadAsync(Buffer.from(result.delivery.contentBase64, 'base64'))
    const documentXml = await archive.file('word/document.xml').async('string')

    expect(documentXml.match(/Review the commercial assumptions\./g)).toHaveLength(1)
    expect(documentXml.match(/Use current approved information only\./g)).toHaveLength(1)
    expect(documentXml.match(/Governed Executive Narrative/g)).toHaveLength(1)
  })

  test('produces a stable derivative fingerprint for equivalent retries', async () => {
    const first = await renderOutputDerivative({ ...baseInput, format: 'PDF' })
    const second = await renderOutputDerivative({ ...baseInput, format: 'PDF' })

    expect(second.evidence.derivativeFingerprint).toBe(first.evidence.derivativeFingerprint)
    expect(second.evidence.outputChecksum).toBe(first.evidence.outputChecksum)
  })

  test('fails closed with a content-free error for an unsupported capability format', async () => {
    await expect(renderOutputDerivative({ ...baseInput, format: 'PPTX' })).rejects.toEqual(expect.objectContaining({
      code: OUTPUT_SERVICE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      details: expect.objectContaining({ contentIncludedInError: false }),
    }))
  })

  test('fails closed before evidence persistence when governed content is missing', async () => {
    const persistReadyEvidence = jest.fn()

    await expect(renderOutputDerivative({
      ...baseInput,
      format: 'PDF',
      governedContent: { structuredContent: {} },
      persistReadyEvidence,
    })).rejects.toEqual(expect.objectContaining({
      code: OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID,
      reason: 'OUTPUT_GOVERNED_CONTENT_MISSING',
    }))
    expect(persistReadyEvidence).not.toHaveBeenCalled()
  })

  test('rejects malformed renderer output through the stable validation boundary', () => {
    expect(() => __testables.assertRenderedOutput({
      buffer: Buffer.from('not a pdf'),
      format: 'PDF',
    })).toThrow(expect.objectContaining({
      code: OUTPUT_SERVICE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'OUTPUT_COMPATIBILITY_VALIDATION_FAILED',
    }))
  })

  test('suppresses delivery when ready evidence persistence fails', async () => {
    const auditFailure = new Error('audit unavailable')

    await expect(renderOutputDerivative({
      ...baseInput,
      format: 'DOCX',
      persistReadyEvidence: async () => { throw auditFailure },
    })).rejects.toEqual(expect.objectContaining({
      code: OUTPUT_SERVICE_ERROR_CODES.READY_EVIDENCE_FAILED,
      reason: 'OUTPUT_READY_EVIDENCE_PERSISTENCE_FAILED',
      cause: auditFailure,
      details: expect.objectContaining({ contentIncludedInError: false }),
    }))
  })
})
