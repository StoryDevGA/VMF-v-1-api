import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'
import PDFDocument from 'pdfkit'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import {
  PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_PDF_CANDIDATE_PROFILE,
  renderProfessionalPdfCandidate,
  validateProfessionalPdfCandidate,
  __testables,
} from '../services/professionalPdfCandidateRenderer.js'
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

const collectPdf = (configure) => new Promise((resolve, reject) => {
  const chunks = []
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: { CreationDate: new Date('2000-01-01T00:00:00.000Z') },
  })
  doc.on('data', (chunk) => chunks.push(chunk))
  doc.on('error', reject)
  doc.on('end', () => resolve(Buffer.concat(chunks)))
  configure(doc)
  doc.end()
})

const injectBeforeStartXref = (buffer, value) => {
  const source = buffer.toString('latin1')
  return Buffer.from(source.replace(/\nstartxref\s/, `\n${value}\nstartxref\n`), 'latin1')
}

const expectSourceFreeFailure = async (action, reason) => {
  try {
    await action()
    throw new Error('Expected professional PDF candidate failure.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
    expect(error.details).toEqual(expect.objectContaining({ contentIncludedInError: false }))
  }
}

const extractPageTexts = async (buffer) => {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(buffer)),
    disableWorker: true,
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise
  try {
    const pages = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent()
      pages.push(textContent.items.map((item) => String(item?.str || '')).join(' '))
    }
    return pages
  } finally {
    await document.destroy()
  }
}

describe('Professional PDF engineering candidate', () => {
  test('is inactive, non-resolvable, and excluded from customer capability discovery', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PDF_CANDIDATE_PROFILE.profileKey,
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      formats: [expect.objectContaining({ format: 'PDF' })],
      review: expect.objectContaining({ productReference: 'CANDIDATE_NOT_APPROVED' }),
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PDF_CANDIDATE_PROFILE.profileKey,
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'executive-brief',
      outputSchemaKey: 'executive-brief-schema',
      styleKey: 'executive-style',
      format: 'PDF',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
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
      expect(readFileSync(path, 'utf8')).not.toContain('professionalPdfCandidateRenderer')
    })
  })

  test('renders and independently validates a bounded consultancy-style PDF', async () => {
    const result = await renderProfessionalPdfCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })
    expect(result.profile).toBe(PROFESSIONAL_PDF_CANDIDATE_PROFILE)
    expect(result.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(result.metrics).toEqual(expect.objectContaining({
      pageCount: expect.any(Number),
      blockCount: expect.any(Number),
      headingCount: 4,
      tableCount: 1,
      contentIncludedInMetrics: false,
    }))
    expect(result.metrics.pageCount).toBeGreaterThanOrEqual(2)
    expect(result.metrics.pageCount).toBeLessThanOrEqual(3)
    expect(result.validation).toEqual(expect.objectContaining({
      status: 'PASSED',
      pageCount: result.metrics.pageCount,
      textPageCount: result.metrics.pageCount,
      annotationCount: 0,
      activeContentDetected: false,
      contentIncludedInValidation: false,
    }))
  })

  test('reuses the hardened metadata and Markdown safety boundary', async () => {
    await expectSourceFreeFailure(
      () => renderProfessionalPdfCandidate({
        documentMetadata: { ...metadata, title: 'https://customer-secret-marker.example' },
        markdown: representativeMarkdown,
      }),
      'URI_SCHEME_NOT_ALLOWED',
    )
    await expectSourceFreeFailure(
      () => renderProfessionalPdfCandidate({
        documentMetadata: metadata,
        markdown: 'Customer-safe text. javascript&#x3a;//customer-secret-marker.example',
      }),
      'URI_SCHEME_NOT_ALLOWED',
    )
  })

  test('fails closed when a table row cannot fit within a bounded page', async () => {
    const oversizedCell = 'bounded '.repeat(500)
    const headers = Array.from({ length: 12 }, (_, index) => `Column ${index + 1}`)
    const separator = headers.map(() => '---')
    const row = headers.map(() => oversizedCell)
    await expectSourceFreeFailure(
      () => renderProfessionalPdfCandidate({
        documentMetadata: metadata,
        markdown: `# Executive Growth Decision\n\n| ${headers.join(' | ')} |\n| ${separator.join(' | ')} |\n| ${row.join(' | ')} |`,
      }),
      'PDF_TABLE_ROW_HEIGHT_LIMIT_EXCEEDED',
    )
  })

  test('keeps a heading with the following table instead of orphaning it at a page foot', async () => {
    const paragraph = 'This bounded paragraph provides enough executive context to exercise page flow while preserving readable customer-facing business language. '.repeat(2)
    const markdown = `# Pagination Test\n\n## Analysis\n\n${Array.from({ length: 11 }, () => paragraph).join('\n\n')}\n\n### Sensitivity\n\n| Case | Value |\n|---|---|\n| Base | Bounded |`
    const result = await renderProfessionalPdfCandidate({
      documentMetadata: { ...metadata, title: 'Pagination Test' },
      markdown,
    })
    const pageTexts = await extractPageTexts(result.buffer)
    const sensitivityPage = pageTexts.find((pageText) => pageText.includes('Sensitivity'))

    expect(sensitivityPage).toBeDefined()
    expect(sensitivityPage).toContain('Case')
    expect(sensitivityPage).toContain('Base')
  })

  test.each([
    ['/J#61vaScript', 'JAVASCRIPT'],
    ['/OpenAction', 'OPENACTION'],
    ['/A#41', 'AA'],
    ['/AcroForm', 'ACROFORM'],
    ['/X#46A', 'XFA'],
    ['/EmbeddedFile', 'EMBEDDEDFILE'],
    ['/FileSpec', 'FILESPEC'],
    ['/RichMedia', 'RICHMEDIA'],
    ['/U#52I', 'URI'],
    ['/GoToR', 'GOTOR'],
    ['/Launch', 'LAUNCH'],
    ['/SubmitForm', 'SUBMITFORM'],
    ['/ImportData', 'IMPORTDATA'],
    ['/Encrypt', 'ENCRYPT'],
  ])('rejects canonical or escaped forbidden PDF name %s', async (pdfName, canonicalName) => {
    const safe = await renderProfessionalPdfCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })
    const candidate = injectBeforeStartXref(safe.buffer, `99 0 obj << ${pdfName} true >> endobj`)
    await expect(validateProfessionalPdfCandidate(candidate)).rejects.toMatchObject({
      code: PROFESSIONAL_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED',
      details: expect.objectContaining({ forbiddenName: canonicalName, contentIncludedInError: false }),
    })
  })

  test('rejects an indirect JavaScript action dictionary before parsing', async () => {
    const safe = await renderProfessionalPdfCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })
    const candidate = injectBeforeStartXref(
      safe.buffer,
      '98 0 obj << /S /JavaScript /JS (customer-secret-marker) >> endobj\n99 0 obj << /A 98 0 R >> endobj',
    )
    await expectSourceFreeFailure(
      () => validateProfessionalPdfCandidate(candidate),
      'PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED',
    )
  })

  test('uses parsed page inspection to reject a non-external annotation', async () => {
    const annotated = await collectPdf((doc) => {
      doc.addPage({ size: 'LETTER' })
      doc.text('ENGINEERING CANDIDATE - NOT CUSTOMER APPROVED', { destination: 'target' })
      doc.text('Internal destination annotation', { goTo: 'target' })
    })
    await expect(validateProfessionalPdfCandidate(annotated)).rejects.toMatchObject({
      reason: 'PDF_ANNOTATION_NOT_ALLOWED',
    })
  })

  test('rejects malformed, truncated, oversized, and over-page-limit PDFs', async () => {
    await expect(validateProfessionalPdfCandidate(Buffer.from('%PDF-1.7\ntruncated')))
      .rejects.toMatchObject({ reason: 'PDF_EOF_INVALID' })

    const safe = await renderProfessionalPdfCandidate({
      documentMetadata: metadata,
      markdown: representativeMarkdown,
    })
    await expect(validateProfessionalPdfCandidate(safe.buffer.subarray(0, safe.buffer.length - 20)))
      .rejects.toMatchObject({ reason: 'PDF_EOF_INVALID' })

    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes, 0),
    ])
    await expect(validateProfessionalPdfCandidate(oversized))
      .rejects.toMatchObject({ reason: 'PDF_OUTPUT_LIMIT_EXCEEDED' })

    const tooManyPages = await collectPdf((doc) => {
      for (let index = 0; index <= PROFESSIONAL_PDF_CANDIDATE_PROFILE.limits.maxPages; index += 1) {
        doc.addPage({ size: 'LETTER' })
        doc.text(`ENGINEERING CANDIDATE - NOT CUSTOMER APPROVED ${index + 1}`)
      }
    })
    await expect(validateProfessionalPdfCandidate(tooManyPages))
      .rejects.toMatchObject({ reason: 'PDF_PAGE_LIMIT_EXCEEDED' })
  })

  test('produces byte-identical output across separate process executions', () => {
    const script = `
      import { createHash } from 'node:crypto';
      import { renderProfessionalPdfCandidate } from './src/services/professionalPdfCandidateRenderer.js';
      const result = await renderProfessionalPdfCandidate({
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

  test('canonicalizes PDF name escapes without including source content', () => {
    expect(__testables.decodePdfName('J#61vaScript')).toBe('JAVASCRIPT')
    expect(__testables.decodePdfName('U#52I')).toBe('URI')
  })
})
