import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, jest, test } from '@jest/globals'
import {
  PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE,
  __testables,
  normalizeChromiumPdfMetadata,
  renderProfessionalPresentationPdfCandidate,
  validateProfessionalPresentationPdfCandidate,
} from '../services/professionalPresentationPdfCandidateRenderer.js'
import { parseProfessionalPresentationCandidateInput } from '../services/professionalPresentationCandidateRenderer.js'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'
import { professionalPresentationCandidateFixture } from './fixtures/professionalPresentationCandidateFixture.js'

const executablePath = process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH || ''
const browserRuntime = Object.freeze({
  executablePath,
  revision: '1223',
  productVersion: '148.0.7778.96',
  executableSha256: '290fa7018fda22c52ada5eddb0113baf3ebc41fd0fde6085eddb19793606c635',
  installationFingerprint: '57f8172866f6ad4eff4c9592e0165b6f27c434b740c816ccf34d8597d53dcfdc',
})
const browserTest = executablePath ? test : test.skip
const cloneFixture = () => JSON.parse(JSON.stringify(professionalPresentationCandidateFixture))

const expectSourceFreeFailure = async (action, reason) => {
  try {
    await action()
    throw new Error('Expected presentation PDF candidate failure.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
    expect(error.details).toEqual(expect.objectContaining({ contentIncludedInError: false }))
    expect(error.details).not.toHaveProperty('path')
    expect(error.message).toBe('The professional presentation PDF engineering candidate could not complete this render.')
  }
}

const productionFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name)
  if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionFiles(target)
  return entry.isFile() && target.endsWith('.js') ? [target] : []
})

const injectBeforeStartXref = (buffer, value) => Buffer.from(
  buffer.toString('latin1').replace(/\nstartxref\s/, `\n${value}\nstartxref\n`),
  'latin1',
)

const minimalPdfBuffer = Buffer.from('%PDF-1.4\nxref\ntrailer <<>>\nstartxref\n0\n%%EOF', 'latin1')
const safeMetadata = () => ({
  info: {
    Creator: __testables.SAFE_PDF_PROPERTY_VALUE,
    Producer: __testables.SAFE_PDF_PROPERTY_VALUE,
    CreationDate: "D:20000101000000+00'00'",
    ModDate: "D:20000101000000+00'00'",
  },
})
const createParsedPdf = ({ documentOverrides = {}, pageOverrides = {} } = {}) => {
  const page = {
    view: [0, 0, 960, 540],
    getJSActions: async () => null,
    getXfa: async () => null,
    getAnnotations: async () => [],
    getTextContent: async () => ({ items: [{ str: `Decision ${__testables.DISCLOSURE}` }] }),
    getStructTree: async () => ({ role: 'Root', children: [{ role: 'Document' }] }),
    ...pageOverrides,
  }
  return {
    numPages: 1,
    getAttachments: async () => null,
    getJSActions: async () => null,
    getFieldObjects: async () => null,
    getCalculationOrderIds: async () => null,
    getOpenAction: async () => null,
    hasJSActions: async () => false,
    getOutline: async () => null,
    getMarkInfo: async () => ({ Marked: true }),
    getMetadata: async () => safeMetadata(),
    getPage: async () => page,
    destroy: async () => undefined,
    isPureXfa: false,
    allXfaHtml: null,
    ...documentOverrides,
  }
}
const validateWithParsedPdf = (overrides = {}) => __testables.validateProfessionalPresentationPdfCandidateInternal(
  minimalPdfBuffer,
  { expectedPageCount: 1, loadPdfDocument: async () => createParsedPdf(overrides) },
)

const validRuntime = () => ({
  executablePath: 'C:\\engineering\\chrome.exe',
  revision: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.chromiumRevision,
  productVersion: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion,
  executableSha256: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.executableSha256,
  installationFingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
})
const validExecutableStat = () => ({
  size: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.executableBytes,
  isSymbolicLink: () => false,
  isFile: () => true,
})
const validInstallation = () => ({
  fingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
  fileCount: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFileCount,
  totalBytes: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationBytes,
})

const createBrowserHarness = ({
  productVersion = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion,
  attemptedRequest = false,
  slideCount = professionalPresentationCandidateFixture.slides.length,
  overflow = [],
} = {}) => {
  let routeHandler
  const page = {
    close: jest.fn(async () => undefined),
    setContent: jest.fn(async () => {
      if (attemptedRequest) await routeHandler({ abort: jest.fn(async () => undefined) })
    }),
    locator: jest.fn((selector) => ({
      evaluateAll: jest.fn(async () => (selector === '[data-bounded]' ? overflow : [])),
      count: jest.fn(async () => (selector === '[data-slide-index]' ? slideCount : 0)),
    })),
    pdf: jest.fn(async () => Buffer.from('%PDF-1.4')),
  }
  const context = {
    close: jest.fn(async () => undefined),
    route: jest.fn(async (_pattern, handler) => { routeHandler = handler }),
    newPage: jest.fn(async () => page),
  }
  const browser = {
    close: jest.fn(async () => undefined),
    version: jest.fn(() => `HeadlessChrome/${productVersion}`),
    newContext: jest.fn(async () => context),
  }
  return {
    browser,
    context,
    page,
    chromiumApi: { launch: jest.fn(async () => browser) },
  }
}

describe('Professional presentation PDF engineering candidate', () => {
  test('is inactive, non-resolvable, and leaves active PDF compatibility resolution unchanged', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toHaveLength(7)
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.profileKey,
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'PRESENTATION',
      engine: expect.objectContaining({
        version: 'playwright-core@1.61.1',
        chromiumRevision: '1223',
        chromiumProductVersion: '148.0.7778.96',
        installationFingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
        launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
      }),
      formats: [expect.objectContaining({ format: 'PDF' })],
      review: expect.objectContaining({
        architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
        productReference: 'CANDIDATE_NOT_APPROVED',
      }),
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.profileKey,
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'board-presentation',
      outputSchemaKey: 'board-presentation-schema',
      styleKey: 'executive-style',
      format: 'PDF',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
  })

  test('has no import path from the complete production source surface', () => {
    const productionSurface = productionFiles('src')
      .filter((file) => !file.endsWith('professionalPresentationPdfCandidateRenderer.js'))
    const importers = productionSurface.filter((file) => (
      readFileSync(file, 'utf8').includes('professionalPresentationPdfCandidateRenderer')
    ))
    expect(importers).toEqual([])
  })

  test('compiles only escaped, static, resource-free HTML from the closed presentation parser', () => {
    const fixture = cloneFixture()
    fixture.metadata.title = 'Decision & delivery "case"'
    fixture.slides[0].title = "Leader's decision & delivery"
    const { presentation } = parseProfessionalPresentationCandidateInput(fixture)
    const html = __testables.compileProfessionalPresentationPdfCandidateHtml(presentation)

    expect(html.match(/data-slide-index=/g)).toHaveLength(12)
    expect(html).toContain('Decision &amp; delivery &quot;case&quot;')
    expect(html).toContain('Leader&#39;s decision &amp; delivery')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/\b(?:src|href)\s*=/i)
    expect(html).not.toMatch(/@import|url\s*\(/i)
    expect(html).toContain(`<span>${__testables.DISCLOSURE}</span>`)
  })

  test('rejects browser fields in presentation input through the existing closed parser', async () => {
    const fixture = cloneFixture()
    fixture.browserExecutablePath = 'customer-secret-marker'
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationPdfCandidate(fixture, { browserRuntime }),
      'PRESENTATION_FIELD_UNSUPPORTED',
    )
    try {
      await renderProfessionalPresentationPdfCandidate(fixture, { browserRuntime })
    } catch (error) {
      expect(error.name).toBe('ProfessionalPresentationPdfCandidateError')
      expect(error.code).toBe(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID)
      expect(JSON.stringify(error)).not.toMatch(/presentation\.|browserExecutablePath|ProfessionalPresentationCandidateError/)
    }
  })

  test.each([null, [], 'options', 42])('rejects non-object public render options without a native error', async (options) => {
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, options),
      'BROWSER_OPTIONS_INVALID',
    )
  })

  test('rejects unknown or missing public render option fields', async () => {
    await expect(renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, {}))
      .rejects.toMatchObject({ reason: 'BROWSER_OPTIONS_INVALID' })
    await expect(renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, {
      browserRuntime,
      customerOverride: 'customer-secret-marker',
    })).rejects.toMatchObject({ reason: 'BROWSER_OPTIONS_INVALID' })
  })

  test('fails source-free before launch for missing or mismatched server-owned browser identity', async () => {
    await expectSourceFreeFailure(
      () => renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, {
        browserRuntime: { ...browserRuntime, executablePath: 'customer-secret-marker', revision: 'wrong' },
      }),
      'BROWSER_EXECUTABLE_INVALID',
    )
    if (executablePath) {
      await expectSourceFreeFailure(
        () => renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, {
          browserRuntime: { ...browserRuntime, installationFingerprint: '0'.repeat(64) },
        }),
        'BROWSER_IDENTITY_DECLARATION_MISMATCH',
      )
    }
  })

  test('covers every server-owned runtime identity rejection branch', async () => {
    const verify = (runtime, {
      stat = validExecutableStat(),
      sha256 = PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.executableSha256,
      installation = validInstallation(),
    } = {}) => __testables.validateBrowserRuntime(
      runtime,
      async () => installation,
      { lstatImpl: async () => stat, sha256FileImpl: async () => sha256 },
    )

    await expect(verify(null)).rejects.toMatchObject({ reason: 'BROWSER_RUNTIME_REQUIRED' })
    await expect(verify({ ...validRuntime(), extra: true })).rejects.toMatchObject({ reason: 'BROWSER_RUNTIME_FIELDS_INVALID' })
    await expect(verify({ ...validRuntime(), executablePath: 'relative/chrome.exe' })).rejects.toMatchObject({ reason: 'BROWSER_EXECUTABLE_INVALID' })
    await expect(verify({ ...validRuntime(), revision: 'wrong' })).rejects.toMatchObject({ reason: 'BROWSER_IDENTITY_DECLARATION_MISMATCH' })
    await expect(verify(validRuntime(), { stat: { ...validExecutableStat(), isSymbolicLink: () => true } }))
      .rejects.toMatchObject({ reason: 'BROWSER_EXECUTABLE_INVALID' })
    await expect(verify(validRuntime(), { stat: { ...validExecutableStat(), isFile: () => false } }))
      .rejects.toMatchObject({ reason: 'BROWSER_EXECUTABLE_INVALID' })
    await expect(verify(validRuntime(), { stat: { ...validExecutableStat(), size: 1 } }))
      .rejects.toMatchObject({ reason: 'BROWSER_EXECUTABLE_SIZE_MISMATCH' })
    await expect(verify(validRuntime(), { sha256: '0'.repeat(64) }))
      .rejects.toMatchObject({ reason: 'BROWSER_EXECUTABLE_FINGERPRINT_MISMATCH' })
    await expect(verify(validRuntime(), { installation: { ...validInstallation(), fileCount: 1 } }))
      .rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_FINGERPRINT_MISMATCH' })
  })

  test('covers installation symlink, entry, and bound failures through the bytewise fingerprint seam', async () => {
    const executable = 'C:\\engineering\\chrome.exe'
    const directoryStat = { size: 0, isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }
    const fileStat = { size: 8, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }
    const fileEntry = { name: 'chrome.exe', isDirectory: () => false, isFile: () => true }
    const run = (overrides = {}) => __testables.fingerprintChromiumInstallation(executable, {
      lstatImpl: async (target) => (target.endsWith('chrome.exe') ? fileStat : directoryStat),
      readdirImpl: async () => [fileEntry],
      sha256FileImpl: async () => 'a'.repeat(64),
      ...overrides,
    })

    await expect(run({ lstatImpl: async () => ({ ...directoryStat, isSymbolicLink: () => true }) }))
      .rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_INVALID' })
    await expect(run({ lstatImpl: async (target) => (target.endsWith('chrome.exe') ? { ...fileStat, isSymbolicLink: () => true } : directoryStat) }))
      .rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_SYMLINK_NOT_ALLOWED' })
    await expect(run({ readdirImpl: async () => [{ ...fileEntry, isFile: () => false }] }))
      .rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_ENTRY_INVALID' })
    await expect(run({ maxFiles: 0 })).rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_LIMIT_EXCEEDED' })
    await expect(run({ maxBytes: 1 })).rejects.toMatchObject({ reason: 'BROWSER_INSTALLATION_LIMIT_EXCEEDED' })
    await expect(run()).resolves.toEqual(expect.objectContaining({ fileCount: 1, totalBytes: 8 }))
  })

  test('normalizes only two equal-length Chromium metadata dates and fails closed on drift', () => {
    const source = Buffer.from("%PDF-1.7\n/CreationDate (D:20260722112233+00'00')\n/ModDate (D:20260722112233+00'00')\n/Creator (Mozilla/5.0 \\(Windows NT 10.0; Win64; x64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/148.0.0.0 Safari/537.36)\n/Producer (Skia/PDF m148)\n%%EOF", 'latin1')
    const normalized = normalizeChromiumPdfMetadata(source)
    expect(normalized.replacementCount).toBe(4)
    expect(normalized.dateReplacementCount).toBe(2)
    expect(normalized.identityReplacementCount).toBe(2)
    expect(normalized.buffer).toHaveLength(source.length)
    expect(normalized.buffer.toString('latin1').match(/D:20000101000000\+00'00'/g)).toHaveLength(2)
    expect(normalized.buffer.toString('latin1')).not.toMatch(/Mozilla|HeadlessChrome|Skia\/PDF/i)
    expect(normalized.buffer.toString('latin1').match(/StoryLineOS/g)).toHaveLength(2)
    expect(() => normalizeChromiumPdfMetadata(Buffer.from("%PDF-1.7\n/CreationDate (D:20260722112233+00'00')\n/Creator (Mozilla)\n/Producer (Skia\/PDF m148)\n%%EOF", 'latin1')))
      .toThrow(expect.objectContaining({ reason: 'PDF_METADATA_SHAPE_INVALID' }))
  })

  test('fails closed on duplicate, malformed, and too-short PDF metadata literals', () => {
    const base = "%PDF-1.7\n/CreationDate (D:20260722112233+00'00')\n/ModDate (D:20260722112233+00'00')\n/Creator (Mozilla/5.0 \\(Windows NT 10.0; Win64; x64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/148.0.0.0 Safari/537.36)\n/Producer (Skia/PDF m148)\n%%EOF"
    expect(() => normalizeChromiumPdfMetadata(Buffer.from(`${base}\n/Creator (duplicate)`, 'latin1')))
      .toThrow(expect.objectContaining({ reason: 'PDF_METADATA_SHAPE_INVALID' }))
    expect(() => normalizeChromiumPdfMetadata(Buffer.from(base.replace('/Producer (Skia/PDF m148)', '/Producer (unterminated'), 'latin1')))
      .toThrow(expect.objectContaining({ reason: 'PDF_METADATA_LITERAL_INVALID' }))
    expect(() => normalizeChromiumPdfMetadata(Buffer.from(base.replace('/Producer (Skia/PDF m148)', '/Producer (short)'), 'latin1')))
      .toThrow(expect.objectContaining({ reason: 'PDF_METADATA_LENGTH_INVALID' }))
    expect(() => normalizeChromiumPdfMetadata(Buffer.from(base.replace("D:20260722112233+00'00'", 'invalid-date'), 'latin1')))
      .toThrow(expect.objectContaining({ reason: 'PDF_METADATA_LITERAL_INVALID' }))
  })

  test.each([
    ['Creator', 'UnexpectedRendererTool'],
    ['Producer', 'UnexpectedPDFTool'],
  ])('rejects an unexpected printable %s metadata identity before normalization', (propertyName, unexpectedValue) => {
    const source = "%PDF-1.7\n/CreationDate (D:20260722112233+00'00')\n/ModDate (D:20260722112233+00'00')\n/Creator (Mozilla/5.0 \\(Windows NT 10.0; Win64; x64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/148.0.0.0 Safari/537.36)\n/Producer (Skia/PDF m148)\n%%EOF"
    const drifted = source.replace(new RegExp(`/${propertyName} \\([^\\n]+\\)`), `/${propertyName} (${unexpectedValue})`)
    expect(() => normalizeChromiumPdfMetadata(Buffer.from(drifted, 'latin1')))
      .toThrow(expect.objectContaining({
        reason: 'PDF_METADATA_LITERAL_INVALID',
        details: expect.objectContaining({ propertyKey: propertyName.toUpperCase() }),
      }))
  })

  test.each([
    ['BROWSER_LAUNCHED_VERSION_MISMATCH', { productVersion: '0.0.0.0' }],
    ['BROWSER_REQUEST_NOT_ALLOWED', { attemptedRequest: true }],
    ['DOM_SLIDE_COUNT_MISMATCH', { slideCount: 11 }],
    ['DOM_OVERFLOW_DETECTED', { overflow: [{ index: 0, clientWidth: 1, scrollWidth: 2, clientHeight: 1, scrollHeight: 2 }] }],
  ])('fails closed on real-render policy branch %s using test-only browser observations', async (reason, browserOptions) => {
    const harness = createBrowserHarness(browserOptions)
    await expectSourceFreeFailure(
      () => __testables.renderWithDependencies(professionalPresentationCandidateFixture, {}, {
        chromiumApi: harness.chromiumApi,
        validateRuntime: async () => validInstallation(),
      }),
      reason,
    )
    expect(harness.browser.close).toHaveBeenCalled()
  })

  test('collapses raw browser and filesystem failures into source-free candidate errors', async () => {
    await expectSourceFreeFailure(
      () => __testables.renderWithDependencies(professionalPresentationCandidateFixture, {}, {
        validateRuntime: async () => { throw new Error('customer-secret-marker C:\\private\\chrome.exe') },
      }),
      'PDF_CANDIDATE_RENDER_FAILED',
    )
    await expectSourceFreeFailure(
      () => __testables.renderWithDependencies(professionalPresentationCandidateFixture, {}, null),
      'CANDIDATE_DEPENDENCIES_INVALID',
    )
  })

  test('bounds the whole operation and closes a browser that appears after timeout', async () => {
    let closed = false
    const browser = {
      close: jest.fn(async () => { closed = true }),
      version: jest.fn(() => `HeadlessChrome/${PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion}`),
    }
    const delayedChromium = {
      launch: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
        return browser
      }),
    }
    const validation = Object.freeze({
      fingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
      fileCount: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFileCount,
      totalBytes: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationBytes,
    })
    await expectSourceFreeFailure(
      () => __testables.renderWithDependencies(professionalPresentationCandidateFixture, {}, {
        chromiumApi: delayedChromium,
        validateRuntime: async () => validation,
        workDeadlineMs: 5,
        cleanupDeadlineMs: 50,
      }),
      'PDF_CANDIDATE_RENDER_TIMEOUT',
    )
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(delayedChromium.launch).toHaveBeenCalledWith({
      executablePath: undefined,
      headless: true,
      chromiumSandbox: true,
      timeout: 10_000,
    })
    expect(browser.close).toHaveBeenCalled()
    expect(closed).toBe(true)
  })

  test('covers public PDF option, size, header, EOF, xref, trailer, and expected-page failures', async () => {
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.alloc(0), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_OUTPUT_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(
      Buffer.alloc(PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes + 1),
      { expectedPageCount: 1 },
    )).rejects.toMatchObject({ reason: 'PDF_OUTPUT_LIMIT_EXCEEDED' })
    await expect(validateProfessionalPresentationPdfCandidate(minimalPdfBuffer, null))
      .rejects.toMatchObject({ reason: 'PDF_VALIDATION_OPTIONS_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(minimalPdfBuffer, { expectedPageCount: 1, extra: true }))
      .rejects.toMatchObject({ reason: 'PDF_VALIDATION_OPTIONS_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(minimalPdfBuffer, { expectedPageCount: 0 }))
      .rejects.toMatchObject({ reason: 'PDF_EXPECTED_PAGE_COUNT_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('NOT-PDF\nxref\ntrailer <<>>\nstartxref\n0\n%%EOF'), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_HEADER_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('%PDF-1.4\nxref\ntrailer <<>>\nstartxref\n0'), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_EOF_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('%PDF-1.4\nxref\ntrailer <<>>\n%%EOF'), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_STARTXREF_MISSING' })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('%PDF-1.4\ntrailer <<>>\nstartxref\n0\n%%EOF'), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_XREF_MISSING' })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('%PDF-1.4\nxref\nstartxref\n0\n%%EOF'), { expectedPageCount: 1 }))
      .rejects.toMatchObject({ reason: 'PDF_TRAILER_MISSING' })
  })

  test.each([
    '/J#61vaScript', '/OpenAction', '/A#41', '/AcroForm', '/X#46A', '/EmbeddedFile', '/FileSpec',
    '/RichMedia', '/U#52I', '/GoToR', '/Launch', '/SubmitForm', '/ImportData', '/Encrypt',
  ])('rejects canonical and escaped forbidden PDF name %s before parsing', async (pdfName) => {
    await expect(validateProfessionalPresentationPdfCandidate(
      injectBeforeStartXref(minimalPdfBuffer, `99 0 obj << ${pdfName} true >> endobj`),
      { expectedPageCount: 1 },
    )).rejects.toMatchObject({ reason: 'PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED' })
  })

  test.each([
    ['PDF_PAGE_COUNT_MISMATCH', { documentOverrides: { numPages: 2 } }],
    ['PDF_ATTACHMENTS_NOT_ALLOWED', { documentOverrides: { getAttachments: async () => ({ file: {} }) } }],
    ['PDF_JAVASCRIPT_NOT_ALLOWED', { documentOverrides: { getJSActions: async () => ({ OpenAction: ['code'] }) } }],
    ['PDF_FORM_NOT_ALLOWED', { documentOverrides: { getFieldObjects: async () => ({ field: [] }) } }],
    ['PDF_FORM_NOT_ALLOWED', { documentOverrides: { getCalculationOrderIds: async () => ['field'] } }],
    ['PDF_OPEN_ACTION_NOT_ALLOWED', { documentOverrides: { getOpenAction: async () => ({ action: 'Print' }) } }],
    ['PDF_XFA_NOT_ALLOWED', { documentOverrides: { isPureXfa: true } }],
    ['PDF_MARKED_DOCUMENT_REQUIRED', { documentOverrides: { getMarkInfo: async () => ({ Marked: false }) } }],
    ['PDF_METADATA_DIAGNOSTIC_NOT_ALLOWED', { documentOverrides: { getMetadata: async () => ({ info: { ...safeMetadata().info, Producer: 'Skia/PDF m148' } }) } }],
    ['PDF_METADATA_VALUES_INVALID', { documentOverrides: { getMetadata: async () => ({ info: { ...safeMetadata().info, Creator: 'Wrong' } }) } }],
    ['PDF_EXTERNAL_OUTLINE_NOT_ALLOWED', { documentOverrides: { getOutline: async () => [{ url: 'https://customer-secret-marker.example' }] } }],
    ['PDF_PAGE_ACTION_NOT_ALLOWED', { pageOverrides: { getJSActions: async () => ({ action: ['code'] }) } }],
    ['PDF_PAGE_XFA_NOT_ALLOWED', { pageOverrides: { getXfa: async () => ({ html: true }) } }],
    ['PDF_ANNOTATION_NOT_ALLOWED', { pageOverrides: { getAnnotations: async () => [{ subtype: 'Link' }] } }],
    ['PDF_BLANK_PAGE_NOT_ALLOWED', { pageOverrides: { getTextContent: async () => ({ items: [] }) } }],
    ['PDF_DISCLOSURE_MISSING', { pageOverrides: { getTextContent: async () => ({ items: [{ str: 'Business decision' }] }) } }],
    ['PDF_PAGE_GEOMETRY_INVALID', { pageOverrides: { view: [0, 0, 612, 792] } }],
    ['PDF_STRUCTURE_TREE_REQUIRED', { pageOverrides: { getStructTree: async () => ({ role: 'Root', children: [] }) } }],
  ])('directly rejects parsed PDF branch %s', async (reason, overrides) => {
    await expect(validateWithParsedPdf(overrides)).rejects.toMatchObject({ reason })
  })

  test('collapses parser exceptions from the PDF loader into the stable parse failure', async () => {
    await expect(__testables.validateProfessionalPresentationPdfCandidateInternal(minimalPdfBuffer, {
      expectedPageCount: 1,
      loadPdfDocument: async () => { throw new Error('customer-secret-marker parser detail') },
    })).rejects.toMatchObject({ reason: 'PDF_PARSE_FAILED' })
  })

  browserTest('recomputes the exact immutable browser installation identity', async () => {
    expect(statSync(executablePath).isFile()).toBe(true)
    await expect(__testables.fingerprintChromiumInstallation(executablePath)).resolves.toEqual({
      fingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
      fileCount: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFileCount,
      totalBytes: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationBytes,
    })
  })

  browserTest('renders, validates, and deterministically reproduces a tagged 12-page presentation PDF', async () => {
    const first = await renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, { browserRuntime })
    const second = await renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, { browserRuntime })
    expect(first.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(first.buffer.equals(second.buffer)).toBe(true)
    expect(createHash('sha256').update(first.buffer).digest('hex'))
      .toBe(createHash('sha256').update(second.buffer).digest('hex'))
    expect(first.metrics).toEqual(expect.objectContaining({
      pageCount: 12,
      chartCount: 3,
      attemptedRequestCount: 0,
      metadataReplacementCount: 4,
      metadataDateReplacementCount: 2,
      metadataIdentityReplacementCount: 2,
      browserRevision: '1223',
      browserProductVersion: '148.0.7778.96',
      browserInstallationFingerprint: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
      launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
      contentIncludedInMetrics: false,
    }))
    expect(first.validation).toEqual(expect.objectContaining({
      status: 'PASSED',
      pageCount: 12,
      structureTreePageCount: 12,
      annotationCount: 0,
      activeContentDetected: false,
      contentIncludedInValidation: false,
    }))
  })

  browserTest('rejects malformed, truncated, mismatched, and active-content PDF mutations', async () => {
    const result = await renderProfessionalPresentationPdfCandidate(professionalPresentationCandidateFixture, { browserRuntime })
    await expect(validateProfessionalPresentationPdfCandidate(Buffer.from('%PDF-1.7\ntruncated'), { expectedPageCount: 12 }))
      .rejects.toMatchObject({ reason: 'PDF_EOF_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(result.buffer.subarray(0, result.buffer.length - 20), { expectedPageCount: 12 }))
      .rejects.toMatchObject({ reason: 'PDF_EOF_INVALID' })
    await expect(validateProfessionalPresentationPdfCandidate(result.buffer, { expectedPageCount: 11 }))
      .rejects.toMatchObject({ reason: 'PDF_PAGE_COUNT_MISMATCH' })
    await expect(validateProfessionalPresentationPdfCandidate(
      injectBeforeStartXref(result.buffer, '99 0 obj << /J#61vaScript true >> endobj'),
      { expectedPageCount: 12 },
    )).rejects.toMatchObject({
      code: PROFESSIONAL_PRESENTATION_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      reason: 'PDF_ACTIVE_CONTENT_NAME_NOT_ALLOWED',
    })
  })
})
