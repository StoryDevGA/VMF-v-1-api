import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, jest, test } from '@jest/globals'
import JSZip from 'jszip'
import logger from '../config/logger.js'
import {
  PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE,
  renderProfessionalDocumentCandidate,
  validateProfessionalDocumentCandidatePackage,
} from '../services/professionalDocumentCandidateRenderer.js'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'

const metadata = {
  title: 'Executive Growth Decision',
  deliverableType: 'Executive Brief',
  versionNumber: 2,
  status: 'APPROVED',
}

const representativeMarkdown = `# Executive Growth Decision

> Decision required: approve the staged commercial programme subject to the stated controls.

## Executive Summary

The proposed programme creates a focused route to measurable growth while retaining clear review points.

- Establish accountable ownership.
- Validate the commercial baseline.
- Review delivery evidence before scale-up.

## Decision Profile

| Decision dimension | Current position | Required action |
|---|---|---|
| Strategic fit | Strong | Confirm sponsorship |
| Delivery confidence | Moderate | Complete pilot |
| Financial exposure | Bounded | Retain stage gates |

## Recommended Sequence

1. Confirm the baseline.
2. Mobilize the pilot.
3. Review measured results.

\`\`\`
Illustrative value = baseline x realization rate
\`\`\`
`

const expectCandidateFailure = async (markdown, reason) => {
  try {
    await renderProfessionalDocumentCandidate({ documentMetadata: metadata, markdown })
    throw new Error('Expected candidate renderer to fail.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
  }
}

const expectMetadataFailure = async (documentMetadata, reason) => {
  try {
    await renderProfessionalDocumentCandidate({ documentMetadata, markdown: representativeMarkdown })
    throw new Error('Expected candidate renderer to fail.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
  }
}

const makeStoredZip = (files) => {
  const localParts = []
  const centralParts = []
  let offset = 0
  const crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    return value >>> 0
  })
  const crc32 = (buffer) => {
    let value = 0xffffffff
    for (const byte of buffer) value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
  }

  files.forEach(({ name, content }) => {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.from(content || '<root/>')
    const checksum = crc32(contentBuffer)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(contentBuffer.length, 18)
    localHeader.writeUInt32LE(contentBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localParts.push(localHeader, nameBuffer, contentBuffer)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(contentBuffer.length, 20)
    centralHeader.writeUInt32LE(contentBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + contentBuffer.length
  })

  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, end])
}

const coreFiles = [
  { name: '[Content_Types].xml', content: '<Types/>' },
  { name: '_rels/.rels', content: '<Relationships/>' },
  { name: 'word/document.xml', content: '<w:document xmlns:w="urn:test"/>' },
  { name: 'word/styles.xml', content: '<w:styles xmlns:w="urn:test"/>' },
]

afterEach(() => jest.restoreAllMocks())

describe('Professional document DOCX engineering candidate', () => {
  test('retains inactive engineering evidence while the exact Development/Test Executive Brief route uses a separate active descriptor', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toHaveLength(7)
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES[0]).toEqual(expect.objectContaining({
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      review: expect.objectContaining({ productReference: 'CANDIDATE_NOT_APPROVED' }),
    }))
    expect(listOutcomeRendererCapabilities().capabilities).toHaveLength(1)
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-document-engineering-candidate',
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'executive-brief',
      outputSchemaKey: 'executive-brief-schema',
      styleKey: 'executive-style',
      format: 'DOCX',
      appEnvironment: 'test',
    }).capability.capabilityKey).toBe('outcome-professional-document-dev-test')
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'executive-brief',
      outputSchemaKey: 'executive-brief-schema',
      styleKey: 'executive-style',
      format: 'DOCX',
      appEnvironment: 'production',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
  })

  test('has only the scoped Output Service live import path and no route, startup, or discovery import', () => {
    const excludedLiveFiles = [
      'src/app.js',
      'src/services/outcomeStudioService.js',
      'src/services/outcomeStudioKnowledgeContextService.js',
      'src/services/outcomeStudioResolutionService.js',
      'src/routes/runtimeInstances.routes.js',
    ]
    excludedLiveFiles.forEach((path) => {
      expect(readFileSync(path, 'utf8')).not.toContain('professionalDocumentCandidateRenderer')
    })
    const outputServiceSource = readFileSync('src/services/outputService.js', 'utf8')
    expect(outputServiceSource.match(/professionalDocumentCandidateRenderer/g)).toHaveLength(1)
    expect(outputServiceSource).toContain("descriptor.capability.capabilityKey === 'outcome-professional-document-dev-test'")
  })

  test('renders semantic professional structure without duplicating the authoritative title', async () => {
    const result = await renderProfessionalDocumentCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })
    expect(result.profile).toBe(PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE)
    expect(result.metrics).toEqual(expect.objectContaining({
      blockCount: expect.any(Number),
      headingCount: 4,
      tableCount: 1,
      contentIncludedInMetrics: false,
    }))
    expect(result.validation).toEqual(expect.objectContaining({
      status: 'PASS',
      contentIncludedInValidation: false,
      checks: expect.arrayContaining([
        'DOCX_CORE_ENTRIES_PRESENT',
        'DOCX_XML_WELL_FORMED',
        'DOCX_RELATIONSHIPS_INTERNAL_ONLY',
      ]),
    }))

    const archive = await JSZip.loadAsync(result.buffer)
    const documentXml = await archive.file('word/document.xml').async('string')
    const stylesXml = await archive.file('word/styles.xml').async('string')
    const numberingXml = await archive.file('word/numbering.xml').async('string')
    const footerXml = await archive.file('word/footer1.xml').async('string')
    expect(documentXml.match(/Executive Growth Decision/g)).toHaveLength(1)
    expect(documentXml).toContain('Decision required: approve the staged commercial programme')
    expect(documentXml).toContain('Strategic fit')
    expect(documentXml).toContain('Illustrative value = baseline x realization rate')
    expect(stylesXml).toContain('Heading 1')
    expect(stylesXml).toContain('Candidate Title')
    expect(numberingXml).toContain('decimal')
    const orderedSectionXml = documentXml.match(
      /Recommended Sequence[\s\S]*?Illustrative value = baseline x realization rate/,
    )?.[0] || ''
    const numberedParagraphIds = [...orderedSectionXml.matchAll(
      /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"\/>[\s\S]*?<\/w:numPr>/g,
    )].map((match) => match[1])
    expect(numberedParagraphIds).toHaveLength(3)
    expect(new Set(numberedParagraphIds).size).toBe(1)
    const concreteNumbering = numberingXml.match(new RegExp(
      `<w:num w:numId="${numberedParagraphIds[0]}">[\\s\\S]*?<w:abstractNumId w:val="(\\d+)"\\/>`,
    ))
    expect(concreteNumbering).not.toBeNull()
    expect(numberingXml).toMatch(new RegExp(
      `<w:abstractNum w:abstractNumId="${concreteNumbering[1]}"[\\s\\S]*?<w:numFmt w:val="decimal"\\/>`,
    ))
    expect(footerXml).toContain('PAGE')
    expect(result.buffer.length).toBeLessThan(PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxOutputBytes)
  })

  test('returns a valid document and records content-free metrics when the soft render target is exceeded', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)

    const result = await renderProfessionalDocumentCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })

    expect(result.validation.status).toBe('PASS')
    expect(result.metrics.renderTimeMs).toBe(6000)
    expect(warn).toHaveBeenCalledWith({
      profileKey: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.profileKey,
      renderTimeMs: 6000,
      renderTargetMs: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.renderTargetMs,
    }, 'professional document render exceeded soft latency target')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Executive Growth Decision')
  })

  test.each([
    ['raw HTML', '<script>customer-secret-marker</script>', 'RAW_HTML_NOT_ALLOWED'],
    ['mixed-case URI', 'Visit HtTp://customer-secret-marker.example', 'URI_SCHEME_NOT_ALLOWED'],
    ['mail URI', 'Email mailto:customer-secret-marker@example.com', 'URI_SCHEME_NOT_ALLOWED'],
    ['encoded URI', 'Visit javascript%3Acustomer-secret-marker', 'URI_SCHEME_NOT_ALLOWED'],
    ['entity-encoded URI', 'Visit data&#x3A;customer-secret-marker', 'URI_SCHEME_NOT_ALLOWED'],
    ['Markdown image', '![customer-secret-marker](asset.png)', 'MARKDOWN_IMAGE_NOT_ALLOWED'],
    ['Markdown link', '[customer-secret-marker](relative/path)', 'MARKDOWN_LINK_NOT_ALLOWED'],
    ['UNC path', '\\\\server\\customer-secret-marker', 'FILE_PATH_NOT_ALLOWED'],
    ['file path', 'C:\\customer-secret-marker\\file.txt', 'FILE_PATH_NOT_ALLOWED'],
    ['forward-slash file path', 'C:/customer-secret-marker/file.txt', 'FILE_PATH_NOT_ALLOWED'],
  ])('rejects %s before rendering', async (_label, unsafe, reason) => {
    await expectCandidateFailure(`# Safe title\n\n${unsafe}`, reason)
  })

  test.each([
    ['raw HTML title', '<script>customer-secret-marker</script>', 'RAW_HTML_NOT_ALLOWED'],
    ['URL title', 'https://customer-secret-marker.example', 'URI_SCHEME_NOT_ALLOWED'],
    ['mail title', 'mailto:customer-secret-marker@example.com', 'URI_SCHEME_NOT_ALLOWED'],
    ['file-path title', 'C:/customer-secret-marker/file.txt', 'FILE_PATH_NOT_ALLOWED'],
  ])('rejects unsafe rendered metadata: %s', async (_label, title, reason) => {
    await expectMetadataFailure({ ...metadata, title }, reason)
  })

  test('allowlists and bounds every rendered metadata field', async () => {
    const limits = PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits
    await expectMetadataFailure({ ...metadata, title: 'x'.repeat(limits.maxTitleBytes + 1) }, 'METADATA_FIELD_LIMIT_EXCEEDED')
    await expectMetadataFailure({ ...metadata, deliverableType: 'x'.repeat(limits.maxDeliverableTypeBytes + 1) }, 'METADATA_FIELD_LIMIT_EXCEEDED')
    await expectMetadataFailure({ ...metadata, status: 'x'.repeat(limits.maxStatusBytes + 1) }, 'METADATA_FIELD_LIMIT_EXCEEDED')
    await expectMetadataFailure({ ...metadata, versionNumber: limits.maxVersionNumber + 1 }, 'DOCUMENT_METADATA_INVALID')
    await expectMetadataFailure({ ...metadata, unsupported: 'customer-secret-marker' }, 'DOCUMENT_METADATA_FIELD_UNSUPPORTED')
    await expectMetadataFailure([], 'DOCUMENT_METADATA_INVALID')
  })

  test('enforces source, heading, block, table, row, column, and cell limits', async () => {
    const limits = PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits
    await expectCandidateFailure('x'.repeat(limits.maxSourceBytes + 1), 'SOURCE_SIZE_LIMIT_EXCEEDED')
    await expectCandidateFailure(Array.from({ length: limits.maxHeadings + 1 }, (_, i) => `## Heading ${i}`).join('\n'), 'HEADING_LIMIT_EXCEEDED')
    await expectCandidateFailure(Array.from({ length: limits.maxBlocks + 1 }, (_, i) => `- Item ${i}`).join('\n'), 'BLOCK_LIMIT_EXCEEDED')

    const columns = Array.from({ length: limits.maxColumnsPerTable + 1 }, (_, i) => `C${i}`)
    await expectCandidateFailure(`| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n| ${columns.join(' | ')} |`, 'TABLE_COLUMN_LIMIT_EXCEEDED')

    const rows = Array.from({ length: limits.maxRowsPerTable + 1 }, (_, i) => `| ${i} | value |`).join('\n')
    await expectCandidateFailure(`| ID | Value |\n|---|---|\n${rows}`, 'TABLE_ROW_LIMIT_EXCEEDED')
    await expectCandidateFailure(`| ID | Value |\n|---|---|\n| 1 | ${'x'.repeat(limits.maxCellBytes + 1)} |`, 'TABLE_CELL_LIMIT_EXCEEDED')

    const tables = Array.from({ length: limits.maxTables + 1 }, (_, i) => `| ID | Value |\n|---|---|\n| ${i} | value |`).join('\n\n')
    await expectCandidateFailure(tables, 'TABLE_LIMIT_EXCEEDED')
  })

  test('rejects malformed table dimensions and unclosed code blocks', async () => {
    await expectCandidateFailure('| A | B |\n|---|---|\n| only one |', 'TABLE_STRUCTURE_INVALID')
    await expectCandidateFailure('```\ncustomer-secret-marker', 'CODE_BLOCK_UNCLOSED')
  })

  test('rejects traversal and duplicate central-directory entries before extraction', async () => {
    await expect(validateProfessionalDocumentCandidatePackage(makeStoredZip([
      ...coreFiles,
      { name: '../customer-secret-marker.xml', content: '<root/>' },
    ]))).rejects.toMatchObject({ reason: 'DOCX_ENTRY_PATH_UNSAFE' })
    await expect(validateProfessionalDocumentCandidatePackage(makeStoredZip([
      ...coreFiles,
      { name: 'word/document.xml', content: '<w:document xmlns:w="urn:test"/>' },
    ]))).rejects.toMatchObject({ reason: 'DOCX_DUPLICATE_ENTRY' })
  })

  test('rejects expansion, malformed XML, embedded content, and unsafe relationships', async () => {
    const expanded = new JSZip()
    coreFiles.forEach(({ name, content }) => expanded.file(name, content))
    expanded.file('word/large.xml', `<root>${'x'.repeat(PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxExpandedBytes)}</root>`)
    await expect(validateProfessionalDocumentCandidatePackage(await expanded.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    })))
      .rejects.toMatchObject({ reason: 'DOCX_EXPANSION_LIMIT_EXCEEDED' })

    const malformed = new JSZip()
    coreFiles.forEach(({ name, content }) => malformed.file(name, content))
    malformed.file('word/document.xml', '<w:document><w:p></w:document>')
    await expect(validateProfessionalDocumentCandidatePackage(await malformed.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ reason: 'DOCX_XML_MALFORMED' })

    const embedded = new JSZip()
    coreFiles.forEach(({ name, content }) => embedded.file(name, content))
    embedded.file('word/embeddings/customer-secret-marker.bin', 'payload')
    await expect(validateProfessionalDocumentCandidatePackage(await embedded.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ reason: 'DOCX_EMBEDDED_CONTENT_NOT_ALLOWED' })

    const external = new JSZip()
    coreFiles.forEach(({ name, content }) => external.file(name, content))
    external.file('_rels/.rels', '<Relationships><Relationship TargetMode="External" Target="https://customer-secret-marker.example"/></Relationships>')
    await expect(validateProfessionalDocumentCandidatePackage(await external.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ reason: 'DOCX_EXTERNAL_RELATIONSHIP_NOT_ALLOWED' })
  })

  test('rejects nested archives, macro-enabled content types, and decoded relationship traversal', async () => {
    const nested = new JSZip()
    coreFiles.forEach(({ name, content }) => nested.file(name, content))
    nested.file('word/archive.zip', 'customer-secret-marker')
    await expect(validateProfessionalDocumentCandidatePackage(await nested.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ reason: 'DOCX_NESTED_ARCHIVE_NOT_ALLOWED' })

    const macroEnabled = new JSZip()
    coreFiles.forEach(({ name, content }) => macroEnabled.file(name, content))
    macroEnabled.file('[Content_Types].xml', '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>')
    await expect(validateProfessionalDocumentCandidatePackage(await macroEnabled.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ reason: 'DOCX_MACRO_CONTENT_NOT_ALLOWED' })

    for (const target of ['%2e%2e%2fcustomer-secret-marker.xml', '&#x2e;&#x2e;&sol;customer-secret-marker.xml']) {
      const traversal = new JSZip()
      coreFiles.forEach(({ name, content }) => traversal.file(name, content))
      traversal.file('_rels/.rels', `<Relationships><Relationship Target="${target}"/></Relationships>`)
      await expect(validateProfessionalDocumentCandidatePackage(await traversal.generateAsync({ type: 'nodebuffer' })))
        .rejects.toMatchObject({ reason: 'DOCX_RELATIONSHIP_TARGET_UNSAFE' })
    }
  })

  test('rejects oversized output and reports no source content in errors', async () => {
    const oversized = Buffer.concat([
      Buffer.from('PK'),
      Buffer.alloc(PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits.maxOutputBytes, 0),
    ])
    await expect(validateProfessionalDocumentCandidatePackage(oversized)).rejects.toMatchObject({
      code: PROFESSIONAL_DOCUMENT_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'DOCX_OUTPUT_LIMIT_EXCEEDED',
      details: expect.objectContaining({ contentIncludedInError: false }),
    })
  })

  test('produces byte-identical output across separate process executions', () => {
    const script = `
      import { createHash } from 'node:crypto';
      import { renderProfessionalDocumentCandidate } from './src/services/professionalDocumentCandidateRenderer.js';
      const result = await renderProfessionalDocumentCandidate({
        documentMetadata: ${JSON.stringify(metadata)},
        markdown: ${JSON.stringify(representativeMarkdown)}
      });
      process.stdout.write(createHash('sha256').update(result.buffer).digest('hex'));
    `
    const run = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(run()).toBe(run())
  })
})
