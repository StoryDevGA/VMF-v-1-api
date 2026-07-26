import { createHash } from 'node:crypto'
import { describe, expect, jest, test } from '@jest/globals'
import {
  PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE,
  ProfessionalInfographicPdfCandidateError,
  __testables,
  renderProfessionalInfographicPdfCandidate,
} from '../services/professionalInfographicPdfCandidateRenderer.js'
import { renderProfessionalInfographicSvgCandidate } from '../services/professionalInfographicSvgCandidateRenderer.js'
import { professionalInfographicSvgCandidateFixture } from '../testFixtures/professionalInfographicSvgCandidateFixture.js'

const cloneFixture = () => JSON.parse(JSON.stringify(professionalInfographicSvgCandidateFixture))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const SOURCE = renderProfessionalInfographicSvgCandidate(professionalInfographicSvgCandidateFixture)
const MODELED = __testables.extractModeledSvgText(SOURCE.buffer)
const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\nxref\ntrailer <<>>\nstartxref\n0\n%%EOF', 'latin1')
const RAW_METADATA_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj << /CreationDate (D:20260723112233+00'00') /ModDate (D:20260723112233+00'00') /Creator (${__testables.EXPECTED_CHROMIUM_PDF_CREATOR}) /Producer (${__testables.EXPECTED_CHROMIUM_PDF_PRODUCER}) >> endobj
xref
trailer <<>>
startxref
0
%%EOF`,
  'latin1',
)

const validRuntime = () => ({
  executablePath: 'C:\\engineering\\chrome.exe',
  revision: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.chromiumRevision,
  productVersion: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion,
  executableSha256: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
  installationFingerprint: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
})
const validInstallation = () => ({
  fingerprint: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
  fileCount: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.installationFileCount,
  totalBytes: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.installationBytes,
})
const validExecutableStat = (overrides = {}) => ({
  size: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableBytes,
  isSymbolicLink: () => false,
  isFile: () => true,
  isDirectory: () => false,
  ...overrides,
})
const metadataInfo = (overrides = {}) => ({
  PDFFormatVersion: '1.4',
  Language: 'en',
  EncryptFilterName: null,
  IsLinearized: false,
  IsAcroFormPresent: false,
  IsXFAPresent: false,
  IsCollectionPresent: false,
  IsSignaturesPresent: false,
  CreationDate: __testables.FIXED_PDF_DATE,
  ModDate: __testables.FIXED_PDF_DATE,
  Creator: __testables.SAFE_PDF_PROPERTY_VALUE,
  Producer: __testables.SAFE_PDF_PROPERTY_VALUE,
  Title: MODELED.title,
  ...overrides,
})
const createParsedPdf = ({ document = {}, page = {} } = {}) => ({
  numPages: 1,
  getAttachments: async () => null,
  getJSActions: async () => null,
  hasJSActions: async () => false,
  getFieldObjects: async () => null,
  getCalculationOrderIds: async () => null,
  getOpenAction: async () => null,
  getMarkInfo: async () => ({ Marked: true }),
  getMetadata: async () => ({ info: metadataInfo() }),
  getOutline: async () => null,
  getPage: async () => ({
    view: [0, 0, 594.96, 841.92],
    getJSActions: async () => null,
    getXfa: async () => null,
    getAnnotations: async () => [],
    getTextContent: async () => ({ items: MODELED.texts.map((str) => ({ str })) }),
    getStructTree: async () => ({ role: 'Root', children: [{ role: 'Document' }] }),
    ...page,
  }),
  destroy: async () => undefined,
  isPureXfa: false,
  allXfaHtml: null,
  ...document,
})
const validationOptions = (document) => ({
  expectedTitle: MODELED.title,
  expectedText: MODELED.joinedText,
  modeledTextNodeCount: MODELED.nodeCount,
  modeledTextCharacters: MODELED.characters,
  loadPdfDocument: async () => document,
})
const validateParsed = (overrides) => __testables.validatePdfInternal(
  VALID_PDF,
  validationOptions(createParsedPdf(overrides)),
)
const expectedValidation = (modeled = MODELED) => Object.freeze({
  status: 'PASSED',
  pageCount: 1,
  widthPoints: 594.96,
  heightPoints: 841.92,
  structureTreePageCount: 1,
  modeledTextNodeCount: modeled.nodeCount,
  modeledTextCharacters: modeled.characters,
  annotationCount: 0,
  activeContentDetected: false,
  metadataKeyCount: 13,
  contentIncludedInValidation: false,
})

const createBrowserHarness = ({
  productVersion = PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.chromiumProductVersion,
  attemptedRequest = false,
  pageCount = 1,
  overflow = [],
  pdfError = null,
  closeError = null,
  setContent = null,
  closeLog = null,
} = {}) => {
  let routeHandler
  const page = {
    close: jest.fn(async () => {
      closeLog?.push('page')
      if (closeError === 'page') throw new Error('customer-secret-marker')
    }),
    setContent: jest.fn(setContent || (async () => {
      if (attemptedRequest) await routeHandler({ abort: jest.fn(async () => undefined) })
    })),
    locator: jest.fn((selector) => ({
      count: jest.fn(async () => (selector === '[data-pdf-page]' ? pageCount : 0)),
      evaluateAll: jest.fn(async () => (selector === '[data-bounded]' ? overflow : [])),
    })),
    pdf: jest.fn(async () => {
      if (pdfError) throw new Error('customer-secret-marker')
      return RAW_METADATA_PDF
    }),
  }
  const context = {
    close: jest.fn(async () => {
      closeLog?.push('context')
      if (closeError === 'context') throw new Error('customer-secret-marker')
    }),
    route: jest.fn(async (_pattern, handler) => { routeHandler = handler }),
    newPage: jest.fn(async () => page),
  }
  const browser = {
    close: jest.fn(async () => {
      closeLog?.push('browser')
      if (closeError === 'browser') throw new Error('customer-secret-marker')
    }),
    version: jest.fn(() => `HeadlessChrome/${productVersion}`),
    newContext: jest.fn(async () => context),
  }
  return {
    page,
    context,
    browser,
    chromiumApi: { launch: jest.fn(async () => browser) },
  }
}

const renderDependencies = (overrides = {}) => {
  const browserHarness = overrides.browserHarness || createBrowserHarness()
  return {
    ...browserHarness,
    readRuntime: () => validRuntime(),
    validateRuntime: async () => validInstallation(),
    normalizePdf: () => Object.freeze({ buffer: Buffer.from(VALID_PDF), replacementCount: 4 }),
    validatePdf: async (_buffer, options) => expectedValidation({
      nodeCount: options.modeledTextNodeCount,
      characters: options.modeledTextCharacters,
    }),
    ...overrides,
    browserHarness: undefined,
  }
}

const expectFailure = async (action, code, reason) => {
  try {
    await action()
    throw new Error('Expected PDF candidate failure.')
  } catch (error) {
    expect(error).toBeInstanceOf(ProfessionalInfographicPdfCandidateError)
    expect(error.name).toBe('ProfessionalInfographicPdfCandidateError')
    expect(error.message).toBe(__testables.GENERIC_MESSAGE)
    expect(error.code).toBe(code)
    expect(error.reason).toBe(reason)
    expect(error.details).toEqual({ reason, contentIncludedInError: false })
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
  }
}

describe('Professional infographic PDF engineering candidate', () => {
  test('rejects malformed source infographic', async () => {
    await expectFailure(
      () => __testables.renderWithDependencies({ customer: 'customer-secret-marker' }, renderDependencies({
        renderSvg: () => { throw new Error('customer-secret-marker') },
      })),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
  })

  test('rejects unsupported source blocks', async () => {
    const fixture = cloneFixture()
    fixture.unsupported = { secret: 'customer-secret-marker' }
    await expectFailure(
      () => __testables.renderWithDependencies(fixture, renderDependencies()),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
  })

  test('rejects extra public render arguments', async () => {
    await expectFailure(
      () => renderProfessionalInfographicPdfCandidate(professionalInfographicSvgCandidateFixture, {}),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects missing browser runtime', async () => {
    const original = process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH
    delete process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH
    try {
      await expectFailure(
        () => __testables.renderWithDependencies(professionalInfographicSvgCandidateFixture, renderDependencies({
          readRuntime: __testables.readServerBrowserRuntime,
        })),
        PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
        'BROWSER_RUNTIME_MISSING',
      )
    } finally {
      if (original === undefined) delete process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH
      else process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH = original
    }
  })

  test('rejects browser executable identity drift', async () => {
    await expectFailure(
      () => __testables.validateBrowserRuntime(validRuntime(), async () => validInstallation(), {
        lstatImpl: async () => validExecutableStat({ size: 1 }),
        sha256FileImpl: async () => PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('rejects browser installation identity drift', async () => {
    await expectFailure(
      () => __testables.validateBrowserRuntime(validRuntime(), async () => ({
        ...validInstallation(),
        fingerprint: '0'.repeat(64),
      }), {
        lstatImpl: async () => validExecutableStat(),
        sha256FileImpl: async () => PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('accepts exact browser executable and installation identity', async () => {
    await expect(__testables.validateBrowserRuntime(validRuntime(), async () => validInstallation(), {
      lstatImpl: async () => validExecutableStat(),
      sha256FileImpl: async () => PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
    })).resolves.toEqual(validInstallation())
  })

  test('rejects symbolic-link browser installation entry', async () => {
    await expectFailure(
      () => __testables.fingerprintChromiumInstallation('C:\\browser\\chrome.exe', {
        lstatImpl: async (target) => (target === 'C:\\browser'
          ? validExecutableStat({ isFile: () => false, isDirectory: () => true })
          : validExecutableStat({ isSymbolicLink: () => true })),
        readdirImpl: async () => [{ name: 'chrome.exe', isDirectory: () => false, isFile: () => true }],
        sha256FileImpl: async () => 'a'.repeat(64),
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('rejects non-file browser installation entry', async () => {
    await expectFailure(
      () => __testables.fingerprintChromiumInstallation('C:\\browser\\chrome.exe', {
        lstatImpl: async (target) => (target === 'C:\\browser'
          ? validExecutableStat({ isFile: () => false, isDirectory: () => true })
          : validExecutableStat({ isFile: () => false })),
        readdirImpl: async () => [{ name: 'device', isDirectory: () => false, isFile: () => false }],
        sha256FileImpl: async () => 'a'.repeat(64),
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('rejects browser installation file-count drift', async () => {
    await expectFailure(
      () => __testables.validateBrowserRuntime(validRuntime(), async () => ({
        ...validInstallation(),
        fileCount: 307,
      }), {
        lstatImpl: async () => validExecutableStat(),
        sha256FileImpl: async () => PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('rejects browser installation byte-count drift', async () => {
    await expectFailure(
      () => __testables.validateBrowserRuntime(validRuntime(), async () => ({
        ...validInstallation(),
        totalBytes: 1,
      }), {
        lstatImpl: async () => validExecutableStat(),
        sha256FileImpl: async () => PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.executableSha256,
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_RUNTIME_IDENTITY_MISMATCH',
    )
  })

  test('rejects browser installation enumeration overflow', async () => {
    await expectFailure(
      () => __testables.fingerprintChromiumInstallation('C:\\browser\\chrome.exe', {
        lstatImpl: async (target) => (target === 'C:\\browser'
          ? validExecutableStat({ isFile: () => false, isDirectory: () => true })
          : validExecutableStat()),
        readdirImpl: async () => [{ name: 'chrome.exe', isDirectory: () => false, isFile: () => true }],
        sha256FileImpl: async () => 'a'.repeat(64),
        maxFiles: 0,
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
      'BROWSER_INSTALLATION_LIMIT_EXCEEDED',
    )
  })

  test('rejects launched browser version drift', async () => {
    const browserHarness = createBrowserHarness({ productVersion: '0.0.0.0' })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RUNTIME_INVALID,
      'BROWSER_LAUNCHED_VERSION_MISMATCH',
    )
  })

  test('rejects attempted browser requests', async () => {
    const browserHarness = createBrowserHarness({ attemptedRequest: true })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      'BROWSER_REQUEST_NOT_ALLOWED',
    )
  })

  test('rejects DOM page count drift', async () => {
    const browserHarness = createBrowserHarness({ pageCount: 2 })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      'DOM_PAGE_COUNT_MISMATCH',
    )
  })

  test('rejects DOM overflow', async () => {
    const browserHarness = createBrowserHarness({
      overflow: [{ clientWidth: 1, scrollWidth: 2, clientHeight: 1, scrollHeight: 1 }],
    })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
      'DOM_OVERFLOW_DETECTED',
    )
  })

  test('rejects native PDF render failure', async () => {
    const browserHarness = createBrowserHarness({ pdfError: new Error('customer-secret-marker') })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      'PDF_CANDIDATE_RENDER_FAILED',
    )
  })

  test('rejects whole operation timeout', async () => {
    const browserHarness = createBrowserHarness({ setContent: async () => new Promise(() => {}) })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness, workDeadlineMs: 2, cleanupDeadlineMs: 2 }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.TIMEOUT,
      'PDF_CANDIDATE_RENDER_TIMEOUT',
    )
  })

  test('rejects PDF output limit overflow', async () => {
    const browserHarness = createBrowserHarness()
    browserHarness.page.pdf.mockResolvedValue(Buffer.alloc(
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.limits.maxOutputBytes + 1,
    ))
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
      'PDF_OUTPUT_LIMIT_EXCEEDED',
    )
  })

  test('rejects invalid PDF header', async () => {
    await expectFailure(
      () => __testables.validatePdfInternal(Buffer.from('not-pdf'), validationOptions(createParsedPdf())),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_HEADER_INVALID',
    )
  })

  test('rejects invalid PDF cross reference', async () => {
    await expectFailure(
      () => __testables.validatePdfInternal(
        Buffer.from('%PDF-1.4\n%%EOF'),
        validationOptions(createParsedPdf()),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_CROSS_REFERENCE_INVALID',
    )
  })

  test('rejects invalid PDF EOF or trailing bytes', async () => {
    await expectFailure(
      () => __testables.validatePdfInternal(
        Buffer.from(`${VALID_PDF.toString('latin1')}customer-secret-marker`, 'latin1'),
        validationOptions(createParsedPdf()),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_EOF_INVALID',
    )
  })

  test('rejects missing PDF source metadata', async () => {
    await expectFailure(
      () => __testables.normalizeChromiumPdfMetadataInternal(VALID_PDF),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_SOURCE_INVALID',
    )
  })

  test('rejects duplicate PDF source metadata', async () => {
    const duplicate = Buffer.from(
      RAW_METADATA_PDF.toString('latin1').replace('/Creator (', '/Creator (duplicate) /Creator ('),
      'latin1',
    )
    await expectFailure(
      () => __testables.normalizeChromiumPdfMetadataInternal(duplicate),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_SOURCE_INVALID',
    )
  })

  test('rejects malformed PDF source metadata', async () => {
    const malformed = Buffer.from(
      RAW_METADATA_PDF.toString('latin1').replace(__testables.EXPECTED_CHROMIUM_PDF_PRODUCER, 'unknown'),
      'latin1',
    )
    await expectFailure(
      () => __testables.normalizeChromiumPdfMetadataInternal(malformed),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_SOURCE_INVALID',
    )
  })

  test('rejects decoded PDF creator drift', async () => {
    await expectFailure(
      () => validateParsed({ document: { getMetadata: async () => ({ info: metadataInfo({ Creator: 'Chrome' }) }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_VALUES_INVALID',
    )
  })

  test('rejects decoded PDF language drift', async () => {
    await expectFailure(
      () => validateParsed({ document: { getMetadata: async () => ({ info: metadataInfo({ Language: 'fr' }) }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_VALUES_INVALID',
    )
  })

  test('accepts padded normalized PDF creator and producer', async () => {
    await expect(validateParsed({
      document: {
        getMetadata: async () => ({
          info: metadataInfo({ Creator: 'StoryLineOS   ', Producer: 'StoryLineOS    ' }),
        }),
      },
    })).resolves.toEqual(expectedValidation())
  })

  test('rejects unexpected PDF metadata key', async () => {
    await expectFailure(
      () => validateParsed({
        document: { getMetadata: async () => ({ info: metadataInfo({ Unexpected: 'value' }) }) },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_VALUES_INVALID',
    )
  })

  test('rejects PDF metadata normalization drift', async () => {
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ normalizePdf: () => { throw new Error('customer-secret-marker') } }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_NORMALIZATION_FAILED',
    )
  })

  test('rejects normalized PDF metadata drift', async () => {
    await expectFailure(
      () => validateParsed({
        document: { getMetadata: async () => ({ info: metadataInfo({ ModDate: 'wrong' }) }) },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_METADATA_VALUES_INVALID',
    )
  })

  test('rejects escaped active PDF names', async () => {
    const mutated = Buffer.from(
      VALID_PDF.toString('latin1').replace('\nstartxref', '\n/J#53 (blocked)\nstartxref'),
      'latin1',
    )
    await expectFailure(
      () => __testables.validatePdfInternal(mutated, validationOptions(createParsedPdf())),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ACTIVE_NAME_NOT_ALLOWED',
    )
  })

  test('rejects PDF parser failure', async () => {
    await expectFailure(
      () => __testables.validatePdfInternal(VALID_PDF, {
        ...validationOptions(createParsedPdf()),
        loadPdfDocument: async () => { throw new Error('customer-secret-marker') },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_PARSE_FAILED',
    )
  })

  test('rejects PDF page count mismatch', async () => {
    await expectFailure(
      () => validateParsed({ document: { numPages: 2 } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_PAGE_COUNT_MISMATCH',
    )
  })

  test('rejects PDF page geometry mismatch', async () => {
    await expectFailure(
      () => validateParsed({ page: { view: [0, 0, 600, 842] } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_PAGE_GEOMETRY_INVALID',
    )
  })

  test('rejects blank PDF page', async () => {
    await expectFailure(
      () => validateParsed({ page: { getTextContent: async () => ({ items: [] }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_BLANK_PAGE_NOT_ALLOWED',
    )
  })

  test('rejects missing modeled PDF text', async () => {
    await expectFailure(
      () => validateParsed({
        page: { getTextContent: async () => ({ items: MODELED.texts.slice(1).map((str) => ({ str })) }) },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_MODELED_TEXT_MISMATCH',
    )
  })

  test('rejects extra modeled PDF text', async () => {
    await expectFailure(
      () => validateParsed({
        page: { getTextContent: async () => ({ items: [...MODELED.texts, 'extra'].map((str) => ({ str })) }) },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_MODELED_TEXT_MISMATCH',
    )
  })

  test('rejects reordered modeled PDF text', async () => {
    const reordered = [...MODELED.texts]
    ;[reordered[0], reordered[1]] = [reordered[1], reordered[0]]
    await expectFailure(
      () => validateParsed({
        page: { getTextContent: async () => ({ items: reordered.map((str) => ({ str })) }) },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_MODELED_TEXT_MISMATCH',
    )
  })

  test('rejects unmarked PDF document', async () => {
    await expectFailure(
      () => validateParsed({ document: { getMarkInfo: async () => ({ Marked: false }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_MARKED_DOCUMENT_REQUIRED',
    )
  })

  test('rejects missing PDF structure tree', async () => {
    await expectFailure(
      () => validateParsed({ page: { getStructTree: async () => null } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_STRUCTURE_TREE_REQUIRED',
    )
  })

  test('rejects PDF encryption', async () => {
    const mutated = Buffer.from(
      VALID_PDF.toString('latin1').replace('\nstartxref', '\n/Encr#79pt 1 0 R\nstartxref'),
      'latin1',
    )
    await expectFailure(
      () => __testables.validatePdfInternal(mutated, validationOptions(createParsedPdf())),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ENCRYPTION_NOT_ALLOWED',
    )
  })

  test('rejects PDF attachments', async () => {
    const mutated = Buffer.from(
      VALID_PDF.toString('latin1').replace('\nstartxref', '\n/EmbeddedF#69le 1 0 R\nstartxref'),
      'latin1',
    )
    await expectFailure(
      () => __testables.validatePdfInternal(mutated, validationOptions(createParsedPdf())),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ATTACHMENTS_NOT_ALLOWED',
    )
  })

  test('rejects PDF JavaScript', async () => {
    await expectFailure(
      () => validateParsed({ document: { getJSActions: async () => ({ Open: ['blocked'] }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_JAVASCRIPT_NOT_ALLOWED',
    )
  })

  test('rejects PDF document open action', async () => {
    const mutated = Buffer.from(
      VALID_PDF.toString('latin1').replace('\nstartxref', '\n/OpenAction 1 0 R\nstartxref'),
      'latin1',
    )
    await expectFailure(
      () => __testables.validatePdfInternal(mutated, validationOptions(createParsedPdf({
        document: { getOpenAction: async () => ({ dest: 'blocked' }) },
      }))),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ACTION_NOT_ALLOWED',
    )
  })

  test('rejects PDF page action', async () => {
    await expectFailure(
      () => validateParsed({ page: { getJSActions: async () => ({ Open: ['blocked'] }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ACTION_NOT_ALLOWED',
    )
  })

  test('rejects PDF fields', async () => {
    const mutated = Buffer.from(
      VALID_PDF.toString('latin1').replace('\nstartxref', '\n/AcroForm 1 0 R\nstartxref'),
      'latin1',
    )
    await expectFailure(
      () => __testables.validatePdfInternal(mutated, validationOptions(createParsedPdf({
        document: { getFieldObjects: async () => ({ Field: [{}] }) },
      }))),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_FORM_NOT_ALLOWED',
    )
  })

  test('rejects PDF calculation order', async () => {
    await expectFailure(
      () => validateParsed({ document: { getCalculationOrderIds: async () => ['field'] } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_FORM_NOT_ALLOWED',
    )
  })

  test('rejects PDF document XFA', async () => {
    await expectFailure(
      () => validateParsed({ document: { isPureXfa: true } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_FORM_NOT_ALLOWED',
    )
  })

  test('rejects PDF page XFA', async () => {
    await expectFailure(
      () => validateParsed({ page: { getXfa: async () => ({ html: 'blocked' }) } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_FORM_NOT_ALLOWED',
    )
  })

  test('rejects PDF annotations', async () => {
    await expectFailure(
      () => validateParsed({ page: { getAnnotations: async () => [{ subtype: 'Link' }] } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_ANNOTATION_NOT_ALLOWED',
    )
  })

  test('rejects PDF outlines', async () => {
    await expectFailure(
      () => validateParsed({ document: { getOutline: async () => [{ title: 'blocked' }] } }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_OUTLINE_NOT_ALLOWED',
    )
  })

  test('preserves primary failure over parser destroy failure', async () => {
    await expectFailure(
      () => validateParsed({
        document: {
          numPages: 2,
          destroy: async () => { throw new Error('customer-secret-marker') },
        },
      }),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
      'PDF_PAGE_COUNT_MISMATCH',
    )
  })

  test('preserves primary failure over browser cleanup failure', async () => {
    const browserHarness = createBrowserHarness({
      pdfError: new Error('customer-secret-marker'),
      closeError: 'page',
    })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      'PDF_CANDIDATE_RENDER_FAILED',
    )
  })

  test('rejects successful render cleanup failure', async () => {
    const closeLog = []
    const browserHarness = createBrowserHarness({ closeError: 'page', closeLog })
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.RENDER_FAILED,
      'PDF_CANDIDATE_CLEANUP_FAILED',
    )
    expect(closeLog).toEqual(['page', 'context', 'browser'])
  })

  test('rejects timeout while bounded cleanup completes', async () => {
    const browserHarness = createBrowserHarness({ setContent: async () => new Promise(() => {}) })
    browserHarness.page.close.mockImplementation(async () => new Promise((resolve) => setTimeout(resolve, 2)))
    await expectFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({ browserHarness, workDeadlineMs: 1, cleanupDeadlineMs: 10 }),
      ),
      PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES.TIMEOUT,
      'PDF_CANDIDATE_RENDER_TIMEOUT',
    )
  })

  test('renders one deterministic A4 infographic PDF with exact success envelope', async () => {
    const dependencies = renderDependencies()
    const first = await __testables.renderWithDependencies(
      professionalInfographicSvgCandidateFixture,
      dependencies,
    )
    const second = await __testables.renderWithDependencies(
      professionalInfographicSvgCandidateFixture,
      renderDependencies(),
    )
    expect(Object.keys(first)).toEqual([
      'format', 'mimeType', 'extension', 'buffer', 'checksum', 'pageCount',
      'profile', 'sourceSvgChecksum', 'metrics', 'validation',
    ])
    expect(first).toEqual({
      format: 'PDF',
      mimeType: 'application/pdf',
      extension: 'pdf',
      buffer: VALID_PDF,
      checksum: sha256(VALID_PDF),
      pageCount: 1,
      profile: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE,
      sourceSvgChecksum: sha256(SOURCE.buffer),
      metrics: {
        outputBytes: VALID_PDF.length,
        pageCount: 1,
        modeledTextNodeCount: MODELED.nodeCount,
        modeledTextCharacters: MODELED.characters,
        attemptedRequestCount: 0,
        metadataReplacementCount: 4,
        browserRevision: '1223',
        browserProductVersion: '148.0.7778.96',
        browserInstallationFingerprint: PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE.engine.installationFingerprint,
        launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
        contentIncludedInMetrics: false,
      },
      validation: expectedValidation(),
    })
    expect(second.buffer.equals(first.buffer)).toBe(true)
    expect(second.checksum).toBe(first.checksum)
  })

  test('validates exact modeled selectable text and marked structure', async () => {
    const validation = await validateParsed()
    expect(validation).toEqual(expectedValidation())
    expect(Object.keys(validation)).toEqual([
      'status', 'pageCount', 'widthPoints', 'heightPoints', 'structureTreePageCount',
      'modeledTextNodeCount', 'modeledTextCharacters', 'annotationCount',
      'activeContentDetected', 'metadataKeyCount', 'contentIncludedInValidation',
    ])
    expect(Object.isFrozen(validation)).toBe(true)
  })

  test('returns frozen result objects and independent fresh buffers', async () => {
    const first = await __testables.renderWithDependencies(
      professionalInfographicSvgCandidateFixture,
      renderDependencies(),
    )
    const second = await __testables.renderWithDependencies(
      professionalInfographicSvgCandidateFixture,
      renderDependencies(),
    )
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.profile)).toBe(true)
    expect(Object.isFrozen(first.profile.engine)).toBe(true)
    expect(Object.isFrozen(first.profile.limits)).toBe(true)
    expect(Object.isFrozen(first.metrics)).toBe(true)
    expect(Object.isFrozen(first.validation)).toBe(true)
    expect(first.buffer).not.toBe(second.buffer)
    first.buffer[0] = 0
    expect(second.buffer.equals(VALID_PDF)).toBe(true)
    expect(second.checksum).toBe(sha256(VALID_PDF))
  })

  test('exports the exact candidate profile and error code contract', () => {
    expect(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_PROFILE).toEqual({
      profileKey: 'outcome-professional-infographic-pdf-engineering-candidate',
      profileVersion: '0.1.0',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      sourceModelVersion: 'governed-deliverable.v1',
      referenceCandidate: 'COR-007-v1.1-NOT-APPROVED',
      templateProfile: 'executive-decision-infographic-neutral.v0.1',
      engine: {
        key: 'PLAYWRIGHT_CORE_CHROMIUM_IN_PROCESS_ENGINEERING_CANDIDATE',
        version: 'playwright-core@1.61.1',
        chromiumRevision: '1223',
        chromiumProductVersion: '148.0.7778.96',
        executableBytes: 4_011_008,
        executableSha256: '290fa7018fda22c52ada5eddb0113baf3ebc41fd0fde6085eddb19793606c635',
        installationFingerprint: '57f8172866f6ad4eff4c9592e0165b6f27c434b740c816ccf34d8597d53dcfdc',
        installationFileCount: 308,
        installationBytes: 432_272_872,
        launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
        buildFingerprint: 'professional-infographic-pdf-candidate:playwright-core:chromium-1223:0.1.0',
      },
      limits: {
        maxOutputBytes: 25_165_824,
        maxPages: 1,
        maxInstallationFiles: 500,
        maxInstallationBytes: 629_145_600,
        browserLaunchTimeoutMs: 10_000,
        workDeadlineMs: 15_000,
        cleanupDeadlineMs: 5_000,
        pageWidthPoints: 594.96,
        pageHeightPoints: 841.92,
        geometryTolerancePoints: 0.10,
      },
    })
    expect(PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_ERROR_CODES).toEqual({
      INPUT_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_INPUT_INVALID',
      RUNTIME_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_RUNTIME_INVALID',
      LIMIT_EXCEEDED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_LIMIT_EXCEEDED',
      RENDER_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_RENDER_FAILED',
      VALIDATION_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_VALIDATION_FAILED',
      TIMEOUT: 'PROFESSIONAL_INFOGRAPHIC_PDF_CANDIDATE_TIMEOUT',
    })
    expect(Object.keys(__testables)).toEqual([
      'GENERIC_MESSAGE', 'FIXED_PDF_DATE', 'SAFE_PDF_PROPERTY_VALUE',
      'EXPECTED_CHROMIUM_PDF_CREATOR', 'EXPECTED_CHROMIUM_PDF_PRODUCER',
      'FORBIDDEN_PDF_NAMES', 'compileHtml', 'extractModeledSvgText',
      'fingerprintChromiumInstallation', 'inspectPdfNames',
      'normalizeChromiumPdfMetadataInternal', 'renderWithDependencies',
      'validateBrowserRuntime', 'validatePdfInternal', 'readServerBrowserRuntime',
    ])
  })

  test('reads the approved runtime only from the server-owned environment', () => {
    const original = process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH
    process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH = 'C:\\approved\\chrome.exe'
    try {
      expect(__testables.readServerBrowserRuntime()).toEqual({
        ...validRuntime(),
        executablePath: 'C:\\approved\\chrome.exe',
      })
      const html = __testables.compileHtml(SOURCE.buffer.toString('utf8'), MODELED.title)
      expect(html).toContain('<html lang="en">')
      expect(html).not.toContain('C:\\approved')
      expect(html).not.toMatch(/<script\b|@import|url\s*\(|\b(?:src|href)\s*=/i)
    } finally {
      if (original === undefined) delete process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH
      else process.env.STORYLINEOS_ENGINEERING_CHROMIUM_PATH = original
    }
  })

  test('renders a valid content variant with dynamically derived text metrics', async () => {
    const variant = cloneFixture()
    variant.metadata.title = 'A Different Governed Decision'
    variant.recommendation.heading = 'Approve a smaller controlled pilot'
    const variantSource = renderProfessionalInfographicSvgCandidate(variant)
    const variantModeled = __testables.extractModeledSvgText(variantSource.buffer)
    const result = await __testables.renderWithDependencies(variant, renderDependencies())
    expect(result.sourceSvgChecksum).toBe(sha256(variantSource.buffer))
    expect(result.metrics.modeledTextNodeCount).toBe(variantModeled.nodeCount)
    expect(result.metrics.modeledTextCharacters).toBe(variantModeled.characters)
    expect(result.validation.modeledTextNodeCount).toBe(variantModeled.nodeCount)
    expect(result.validation.modeledTextCharacters).toBe(variantModeled.characters)
    expect(result.metrics.modeledTextCharacters).not.toBe(MODELED.characters)
  })
})
