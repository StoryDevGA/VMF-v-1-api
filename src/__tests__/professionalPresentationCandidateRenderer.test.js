import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'
import JSZip from 'jszip'
import {
  PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE,
  parseProfessionalPresentationCandidateInput,
  renderProfessionalPresentationCandidate,
  validateProfessionalPresentationCandidatePackage,
} from '../services/professionalPresentationCandidateRenderer.js'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'
import { professionalPresentationCandidateFixture } from './fixtures/professionalPresentationCandidateFixture.js'

const cloneFixture = () => JSON.parse(JSON.stringify(professionalPresentationCandidateFixture))

const expectSourceFreeFailure = async (action, reason) => {
  try {
    await action()
    throw new Error('Expected professional presentation candidate failure.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
    expect(error.details).toEqual(expect.objectContaining({ contentIncludedInError: false }))
  }
}

const mutateArchive = async (buffer, mutate) => {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true })
  await mutate(archive)
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const mutateFirstEmbeddedWorkbook = async (buffer, mutate) => mutateArchive(buffer, async (archive) => {
  const workbookName = Object.keys(archive.files)
    .find((name) => /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(name))
  const workbook = await JSZip.loadAsync(await archive.file(workbookName).async('nodebuffer'))
  await mutate(workbook)
  archive.file(workbookName, await workbook.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
})

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
  files.forEach(({ name, content = '<root/>' }) => {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.from(content)
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

describe('Professional presentation PPTX engineering candidate', () => {
  test('is inactive, non-resolvable, and excluded from active format discovery', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toHaveLength(7)
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.profileKey,
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'PRESENTATION',
      formats: [expect.objectContaining({ format: 'PPTX' })],
      review: expect.objectContaining({
        architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
        productReference: 'CANDIDATE_NOT_APPROVED',
      }),
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.profileKey,
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'board-presentation',
      outputSchemaKey: 'board-presentation-schema',
      styleKey: 'executive-style',
      format: 'PPTX',
    })).toEqual({
      status: 'UNSUPPORTED',
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      capability: null,
    })
  })

  test('has no import path from live services, routes, startup, or customer discovery', () => {
    const liveFiles = [
      'src/app.js',
      'src/services/outputService.js',
      'src/services/outcomeStudioService.js',
      'src/services/outcomeStudioKnowledgeContextService.js',
      'src/services/outcomeStudioResolutionService.js',
      'src/routes/runtimeInstances.routes.js',
    ]
    liveFiles.forEach((path) => {
      expect(readFileSync(path, 'utf8')).not.toContain('professionalPresentationCandidateRenderer')
    })
  })

  test('renders an editable 12-slide deck with native charts, a native table, and substantive notes', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    expect(result.profile).toBe(PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE)
    expect(result.buffer.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(result.metrics).toEqual(expect.objectContaining({
      slideCount: 12,
      notesCount: 12,
      chartCount: 3,
      generatedWorkbookCount: 3,
      entryCount: expect.any(Number),
      renderTimeMs: expect.any(Number),
      outputBytes: result.buffer.length,
      contentIncludedInMetrics: false,
    }))
    expect(result.validation).toEqual(expect.objectContaining({
      status: 'PASS',
      slideCount: 12,
      notesCount: 12,
      chartCount: 3,
      generatedWorkbookCount: 3,
      contentIncludedInValidation: false,
    }))
    expect(result.buffer.length).toBeLessThan(PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxOutputBytes)

    const archive = await JSZip.loadAsync(result.buffer, { checkCRC32: true })
    const names = Object.keys(archive.files)
    expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))).toHaveLength(12)
    expect(names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))).toHaveLength(12)
    expect(names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name))).toHaveLength(3)
    expect(names.filter((name) => /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(name))).toHaveLength(3)
    expect(names).toHaveLength(92)
    expect(await archive.file('ppt/slides/slide1.xml').async('string')).toContain('Enterprise Knowledge Operating Model Modernisation')
    expect(await archive.file('ppt/slides/slide12.xml').async('string')).toContain('Fund mobilisation and validation')
    expect(await archive.file('ppt/notesSlides/notesSlide1.xml').async('string')).toContain('controlled fictional engineering example')
    const scorecardXml = await archive.file('ppt/slides/slide10.xml').async('string')
    expect(scorecardXml.match(/<a:tbl>/g)).toHaveLength(1)
    expect(scorecardXml).toContain('Avoidable effort')
    expect(scorecardXml).toContain('EVIDENCE OWNER')
    const tableCellAnchors = [...scorecardXml.matchAll(/<a:tcPr\b[^>]*\banchor="([^"]+)"/g)]
      .map((match) => match[1])
    expect(tableCellAnchors).toHaveLength(24)
    expect(tableCellAnchors.every((anchor) => anchor === 'ctr')).toBe(true)
    expect(tableCellAnchors).not.toContain('mid')
  })

  test('enforces the exact governed deliverable subset and layout payloads', () => {
    const unsupportedRoot = cloneFixture()
    unsupportedRoot.customerContent = 'customer-secret-marker'
    expect(() => parseProfessionalPresentationCandidateInput(unsupportedRoot)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_FIELD_UNSUPPORTED',
    }))

    const wrongSchema = cloneFixture()
    wrongSchema.schemaVersion = 'executive-presentation.v0.1'
    expect(() => parseProfessionalPresentationCandidateInput(wrongSchema)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_SCHEMA_VERSION_UNSUPPORTED',
    }))

    const wrongLayout = cloneFixture()
    wrongLayout.slides[1].layout = 'DASHBOARD'
    expect(() => parseProfessionalPresentationCandidateInput(wrongLayout)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_LAYOUT_UNSUPPORTED',
    }))

    const wrongPayload = cloneFixture()
    delete wrongPayload.slides[1].content.statement
    expect(() => parseProfessionalPresentationCandidateInput(wrongPayload)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_FIELD_REQUIRED',
    }))
  })

  test('rejects unsafe content, internal language, short notes, bad chart dimensions, and invalid risk scores', async () => {
    const unsafeUri = cloneFixture()
    unsafeUri.slides[0].content.subtitle = 'javascript%3Acustomer-secret-marker'
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationCandidate(unsafeUri),
      'URI_SCHEME_NOT_ALLOWED',
    )

    const internalTerm = cloneFixture()
    internalTerm.slides[0].content.subtitle = 'The provider context contains customer-secret-marker.'
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationCandidate(internalTerm),
      'CUSTOMER_LANGUAGE_CONTRACT_FAILED',
    )

    const shortNotes = cloneFixture()
    shortNotes.slides[0].notes = 'Too short customer-secret-marker.'
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationCandidate(shortNotes),
      'PRESENTATION_NOTES_WORD_LIMIT_EXCEEDED',
    )

    const badChart = cloneFixture()
    badChart.slides[3].content.series[0].values.pop()
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationCandidate(badChart),
      'PRESENTATION_ARRAY_LIMIT_EXCEEDED',
    )

    const badRisk = cloneFixture()
    badRisk.slides[7].content.risks[0].score = 14
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationCandidate(badRisk),
      'PRESENTATION_RISK_SCORE_INVALID',
    )
  })

  test('rejects circular, oversized, and over-slide-limit input before rendering', () => {
    const circular = cloneFixture()
    circular.circular = circular
    expect(() => parseProfessionalPresentationCandidateInput(circular)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_SERIALIZATION_INVALID',
    }))

    const oversized = cloneFixture()
    oversized.metadata.title = 'x'.repeat(PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSourceBytes)
    expect(() => parseProfessionalPresentationCandidateInput(oversized)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_SOURCE_LIMIT_EXCEEDED',
    }))

    const tooManySlides = cloneFixture()
    while (tooManySlides.slides.length <= PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxSlides) {
      tooManySlides.slides.push(JSON.parse(JSON.stringify(tooManySlides.slides[0])))
    }
    expect(() => parseProfessionalPresentationCandidateInput(tooManySlides)).toThrow(expect.objectContaining({
      reason: 'PRESENTATION_ARRAY_LIMIT_EXCEEDED',
    }))
  })

  test('rejects outer traversal and duplicate central-directory entries', async () => {
    const coreFiles = [
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: '_rels/.rels', content: '<Relationships/>' },
      { name: 'ppt/presentation.xml', content: '<p:presentation xmlns:p="urn:test"/>' },
    ]
    await expect(validateProfessionalPresentationCandidatePackage(makeStoredZip([
      ...coreFiles,
      { name: '../customer-secret-marker.xml' },
    ]))).rejects.toMatchObject({ reason: 'PPTX_ENTRY_PATH_UNSAFE' })
    await expect(validateProfessionalPresentationCandidatePackage(makeStoredZip([
      ...coreFiles,
      { name: 'ppt/presentation.xml', content: '<p:presentation xmlns:p="urn:test"/>' },
    ]))).rejects.toMatchObject({ reason: 'PPTX_DUPLICATE_ENTRY' })
  })

  test('rejects arbitrary embeddings, macros, external relationships, malformed XML, and missing notes', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const arbitraryEmbedding = await mutateArchive(result.buffer, (archive) => {
      archive.file('ppt/embeddings/customer-secret-marker.bin', 'payload')
    })
    await expect(validateProfessionalPresentationCandidatePackage(arbitraryEmbedding))
      .rejects.toMatchObject({ reason: 'PPTX_EXECUTABLE_OR_ARCHIVE_ENTRY_NOT_ALLOWED' })

    const macro = await mutateArchive(result.buffer, (archive) => {
      archive.file('ppt/vbaProject.bin', 'payload')
    })
    await expect(validateProfessionalPresentationCandidatePackage(macro))
      .rejects.toMatchObject({ reason: 'PPTX_EXECUTABLE_OR_ARCHIVE_ENTRY_NOT_ALLOWED' })

    const external = await mutateArchive(result.buffer, async (archive) => {
      const rels = await archive.file('_rels/.rels').async('string')
      archive.file('_rels/.rels', rels.replace(
        '</Relationships>',
        '<Relationship Id="unsafe" Type="unsafe" TargetMode="External" Target="https://customer-secret-marker.example"/></Relationships>',
      ))
    })
    await expect(validateProfessionalPresentationCandidatePackage(external))
      .rejects.toMatchObject({ reason: 'PPTX_EXTERNAL_RELATIONSHIP_NOT_ALLOWED' })

    const malformed = await mutateArchive(result.buffer, (archive) => {
      archive.file('ppt/slides/slide1.xml', '<p:sld><p:cSld></p:sld>')
    })
    await expect(validateProfessionalPresentationCandidatePackage(malformed))
      .rejects.toMatchObject({ reason: 'PPTX_XML_MALFORMED' })

    const missingNotes = await mutateArchive(result.buffer, (archive) => {
      archive.remove('ppt/notesSlides/notesSlide12.xml')
    })
    await expect(validateProfessionalPresentationCandidatePackage(missingNotes))
      .rejects.toMatchObject({ reason: 'PPTX_NOTES_COUNT_MISMATCH' })
  })

  test('rejects malformed outer and embedded-workbook XML that preserves tag nesting', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const malformedXmlCases = [
      '<root>customer-secret-marker & unsafe</root>',
      '<root value="customer-secret-marker & unsafe"/>',
      '',
      '<root/><second/>',
      '<unbound:root/>',
      '<root><!-- customer-secret-marker -- unsafe --></root>',
      '<root value="1" value="2"/>',
      '<root xmlns:a="urn:duplicate" xmlns:b="urn:duplicate" a:value="1" b:value="2"/>',
      '<root>customer-secret-marker \u0001 unsafe</root>',
    ]

    for (const malformedXml of malformedXmlCases) {
      const outerPackage = await mutateArchive(result.buffer, (archive) => {
        archive.file('ppt/slides/slide1.xml', malformedXml)
      })
      await expectSourceFreeFailure(
        () => validateProfessionalPresentationCandidatePackage(outerPackage),
        'PPTX_XML_MALFORMED',
      )

      const embeddedWorkbook = await mutateFirstEmbeddedWorkbook(result.buffer, (workbook) => {
        workbook.file('xl/worksheets/sheet1.xml', malformedXml)
      })
      await expectSourceFreeFailure(
        () => validateProfessionalPresentationCandidatePackage(embeddedWorkbook),
        'PPTX_CHART_WORKBOOK_XML_MALFORMED',
      )
    }
  })

  test('rejects unknown outer parts and non-contiguous generated chart parts', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    for (const [name, content, reason] of [
      ['ppt/customer-secret-marker.dat', 'payload', 'PPTX_ENTRY_SET_INVALID'],
      ['ppt/customer-secret-marker.xml', '<safe/>', 'PPTX_ENTRY_SET_INVALID'],
      ['ppt/embeddings/customer-secret-marker.xlsx', 'payload', 'PPTX_EMBEDDED_OR_ACTIVE_CONTENT_NOT_ALLOWED'],
    ]) {
      const candidate = await mutateArchive(result.buffer, (archive) => archive.file(name, content))
      await expectSourceFreeFailure(
        () => validateProfessionalPresentationCandidatePackage(candidate),
        reason,
      )
    }

    const nonContiguous = await mutateArchive(result.buffer, async (archive) => {
      const chart = await archive.file('ppt/charts/chart3.xml').async('nodebuffer')
      const relationships = await archive.file('ppt/charts/_rels/chart3.xml.rels').async('string')
      const workbook = await archive.file('ppt/embeddings/Microsoft_Excel_Worksheet3.xlsx').async('nodebuffer')
      const slideRelationships = await archive.file('ppt/slides/_rels/slide7.xml.rels').async('string')
      const contentTypes = await archive.file('[Content_Types].xml').async('string')
      archive.remove('ppt/charts/chart3.xml')
      archive.remove('ppt/charts/_rels/chart3.xml.rels')
      archive.remove('ppt/embeddings/Microsoft_Excel_Worksheet3.xlsx')
      archive.file('ppt/charts/chart4.xml', chart)
      archive.file('ppt/charts/_rels/chart4.xml.rels', relationships.replaceAll('Worksheet3.xlsx', 'Worksheet4.xlsx'))
      archive.file('ppt/embeddings/Microsoft_Excel_Worksheet4.xlsx', workbook)
      archive.file('ppt/slides/_rels/slide7.xml.rels', slideRelationships.replaceAll('chart3.xml', 'chart4.xml'))
      archive.file('[Content_Types].xml', contentTypes.replaceAll('chart3.xml', 'chart4.xml'))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(nonContiguous),
      'PPTX_CHART_IDS_INVALID',
    )
  })

  test('rejects missing, crossed, duplicated, and orphaned notes relationships while part counts remain equal', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const notesRelationshipPattern = /<Relationship\b(?=[^>]*Type=["'][^"']*\/notesSlide["'])[^>]*\/>/i
    const slideRelationshipPattern = /<Relationship\b(?=[^>]*Type=["'][^"']*\/slide["'])[^>]*\/>/i

    const missing = await mutateArchive(result.buffer, async (archive) => {
      const name = 'ppt/slides/_rels/slide4.xml.rels'
      archive.file(name, (await archive.file(name).async('string')).replace(notesRelationshipPattern, ''))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(missing),
      'PPTX_NOTES_TOPOLOGY_INVALID',
    )

    const crossed = await mutateArchive(result.buffer, async (archive) => {
      const name = 'ppt/slides/_rels/slide4.xml.rels'
      archive.file(name, (await archive.file(name).async('string')).replace('notesSlide4.xml', 'notesSlide5.xml'))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(crossed),
      'PPTX_NOTES_TOPOLOGY_INVALID',
    )

    const duplicated = await mutateArchive(result.buffer, async (archive) => {
      const name = 'ppt/slides/_rels/slide4.xml.rels'
      const xml = await archive.file(name).async('string')
      const relationship = xml.match(notesRelationshipPattern)[0].replace('rId3', 'duplicateNotes')
      archive.file(name, xml.replace('</Relationships>', `${relationship}</Relationships>`))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(duplicated),
      'PPTX_NOTES_TOPOLOGY_INVALID',
    )

    const orphaned = await mutateArchive(result.buffer, async (archive) => {
      const name = 'ppt/notesSlides/_rels/notesSlide4.xml.rels'
      archive.file(name, (await archive.file(name).async('string')).replace(slideRelationshipPattern, ''))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(orphaned),
      'PPTX_NOTES_TOPOLOGY_INVALID',
    )
  })

  test('rejects duplicate chart references, orphan chart parts, and crossed chart-to-workbook targets', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const duplicateReference = await mutateArchive(result.buffer, async (archive) => {
      const slideName = 'ppt/slides/slide5.xml'
      const relationshipsName = 'ppt/slides/_rels/slide5.xml.rels'
      archive.file(slideName, (await archive.file(slideName).async('string'))
        .replace('</p:cSld>', '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="duplicateChart"/></p:cSld>'))
      archive.file(relationshipsName, (await archive.file(relationshipsName).async('string'))
        .replace('</Relationships>', `<Relationship Id="duplicateChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/ppt/charts/chart1.xml"/></Relationships>`))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(duplicateReference),
      'PPTX_CHART_REFERENCE_TOPOLOGY_INVALID',
    )

    const orphanParts = await mutateArchive(result.buffer, async (archive) => {
      archive.file('ppt/charts/chart4.xml', await archive.file('ppt/charts/chart3.xml').async('nodebuffer'))
      archive.file('ppt/charts/_rels/chart4.xml.rels', (await archive.file('ppt/charts/_rels/chart3.xml.rels').async('string'))
        .replaceAll('Worksheet3.xlsx', 'Worksheet4.xlsx'))
      archive.file('ppt/embeddings/Microsoft_Excel_Worksheet4.xlsx', await archive.file('ppt/embeddings/Microsoft_Excel_Worksheet3.xlsx').async('nodebuffer'))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(orphanParts),
      'PPTX_ENTRY_SET_INVALID',
    )

    const crossedWorkbook = await mutateArchive(result.buffer, async (archive) => {
      const name = 'ppt/charts/_rels/chart1.xml.rels'
      archive.file(name, (await archive.file(name).async('string'))
        .replace('Microsoft_Excel_Worksheet1.xlsx', 'Microsoft_Excel_Worksheet2.xlsx'))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(crossedWorkbook),
      'PPTX_CHART_WORKBOOK_TOPOLOGY_INVALID',
    )
  })

  test('recursively rejects active content inside an otherwise allowlisted chart workbook', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const candidate = await mutateArchive(result.buffer, async (archive) => {
      const workbookName = Object.keys(archive.files)
        .find((name) => /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(name))
      const workbook = await JSZip.loadAsync(await archive.file(workbookName).async('nodebuffer'))
      workbook.file('xl/vbaProject.bin', 'customer-secret-marker')
      archive.file(workbookName, await workbook.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    })
    await expectSourceFreeFailure(
      () => validateProfessionalPresentationCandidatePackage(candidate),
      'PPTX_CHART_WORKBOOK_CONTENT_NOT_ALLOWED',
    )
  })

  test('recursively rejects unknown, comment, nested archive, external, and incomplete workbook parts', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const cases = [
      {
        reason: 'PPTX_CHART_WORKBOOK_ENTRY_SET_INVALID',
        mutate: (workbook) => workbook.file('xl/customer-secret-marker.dat', 'payload'),
      },
      {
        reason: 'PPTX_CHART_WORKBOOK_CONTENT_NOT_ALLOWED',
        mutate: (workbook) => workbook.file('xl/comments1.xml', '<comments/>'),
      },
      {
        reason: 'PPTX_CHART_WORKBOOK_ENTRY_SET_INVALID',
        mutate: (workbook) => workbook.file('xl/customer-secret-marker.xlsx', 'payload'),
      },
      {
        reason: 'PPTX_CHART_WORKBOOK_CORE_ENTRY_MISSING',
        mutate: (workbook) => workbook.remove('xl/workbook.xml'),
      },
      {
        reason: 'PPTX_CHART_WORKBOOK_EXTERNAL_RELATIONSHIP_NOT_ALLOWED',
        mutate: async (workbook) => {
          const name = 'xl/_rels/workbook.xml.rels'
          workbook.file(name, (await workbook.file(name).async('string')).replace(
            '</Relationships>',
            '<Relationship Id="unsafe" Type="unsafe" TargetMode="External" Target="https://customer-secret-marker.example"/></Relationships>',
          ))
        },
      },
    ]
    for (const { reason, mutate } of cases) {
      const candidate = await mutateFirstEmbeddedWorkbook(result.buffer, mutate)
      await expectSourceFreeFailure(
        () => validateProfessionalPresentationCandidatePackage(candidate),
        reason,
      )
    }
  })

  test('rejects invalid slide geometry and oversized output', async () => {
    const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const wrongGeometry = await mutateArchive(result.buffer, async (archive) => {
      const presentationXml = await archive.file('ppt/presentation.xml').async('string')
      archive.file('ppt/presentation.xml', presentationXml.replace('cx="12192000"', 'cx="10000000"'))
    })
    await expect(validateProfessionalPresentationCandidatePackage(wrongGeometry))
      .rejects.toMatchObject({ reason: 'PPTX_SLIDE_GEOMETRY_INVALID' })

    const oversized = Buffer.concat([
      Buffer.from('PK'),
      Buffer.alloc(PROFESSIONAL_PRESENTATION_CANDIDATE_PROFILE.limits.maxOutputBytes, 0),
    ])
    await expect(validateProfessionalPresentationCandidatePackage(oversized))
      .rejects.toMatchObject({ reason: 'PPTX_OUTPUT_LIMIT_EXCEEDED' })
  })

  test('produces byte-identical output across separate process executions', () => {
    const script = `
      import { createHash } from 'node:crypto';
      import { renderProfessionalPresentationCandidate } from './src/services/professionalPresentationCandidateRenderer.js';
      import { professionalPresentationCandidateFixture } from './src/__tests__/fixtures/professionalPresentationCandidateFixture.js';
      const result = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture);
      process.stdout.write(createHash('sha256').update(result.buffer).digest('hex'));
    `
    const first = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()
    const second = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
  })

  test('returns the same hash when rendered repeatedly in-process', async () => {
    const first = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    const second = await renderProfessionalPresentationCandidate(professionalPresentationCandidateFixture)
    expect(createHash('sha256').update(first.buffer).digest('hex'))
      .toBe(createHash('sha256').update(second.buffer).digest('hex'))
  })

  test('uses stable source-free public error codes', () => {
    expect(PROFESSIONAL_PRESENTATION_CANDIDATE_ERROR_CODES).toEqual({
      INPUT_INVALID: 'PROFESSIONAL_PRESENTATION_CANDIDATE_INPUT_INVALID',
      INPUT_UNSAFE: 'PROFESSIONAL_PRESENTATION_CANDIDATE_INPUT_UNSAFE',
      LIMIT_EXCEEDED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_LIMIT_EXCEEDED',
      RENDER_FAILED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_RENDER_FAILED',
      VALIDATION_FAILED: 'PROFESSIONAL_PRESENTATION_CANDIDATE_VALIDATION_FAILED',
    })
  })
})
