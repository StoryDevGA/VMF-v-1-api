import crypto from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import { DISCOVERY_ACQUISITION_PROFILES } from '../constants/discoveryAcquisitionProfiles.js'
import { buildSectionEvidenceProjection } from './sectionEvidenceProjectionService.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'

const moduleRequire = createRequire(import.meta.url)
const { createCanvas } = moduleRequire('@napi-rs/canvas')
const { createWorker: createOcrWorker, PSM: OCR_PAGE_SEGMENTATION_MODES } = moduleRequire('tesseract.js')
const inflateRaw = promisify(zlib.inflateRaw)

const DISCOVERY_EVIDENCE_CATEGORIES = Object.freeze({
  COMPANY: 'Company',
  PRODUCTS: 'Products',
  SERVICES: 'Services',
  INDUSTRIES: 'Industries',
  TECHNOLOGY: 'Technology',
  DIFFERENTIATORS: 'Differentiators',
  VALUE_DRIVERS: 'Value Drivers',
  PROOF: 'Proof',
  ECONOMICS: 'Economics',
  CONSTRAINTS: 'Constraints',
  RISKS: 'Risks',
})

export const DISCOVERY_EVIDENCE_REVIEW_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
})

const DISCOVERY_COVERAGE_AREAS = Object.freeze([
  'Company',
  'Products',
  'Services',
  'Markets',
  'Industries',
  'Proof',
  'Economics',
  'Differentiation',
  'Decision Context',
  'Constraints',
])

const DISCOVERY_GRAPH_DOMAIN_BY_COVERAGE_AREA = Object.freeze({
  Company: 'Company',
  Products: 'Products',
  Services: 'Services',
  Markets: 'Market',
  Industries: 'Market',
  Technology: 'Products',
  Proof: 'Proof',
  Economics: 'Economics',
  Differentiation: 'Differentiation',
  'Decision Context': 'Stakeholders',
  Constraints: 'Consequences',
  Risks: 'Consequences',
})

const DISCOVERY_TRUTH_DOMAIN_BY_GRAPH_DOMAIN = Object.freeze({
  Company: 'commercial',
  Products: 'commercial',
  Services: 'commercial',
  Market: 'commercial',
  Problems: 'operational',
  Consequences: 'operational',
  Proof: 'commercial',
  Economics: 'financial',
  Differentiation: 'commercial',
  Stakeholders: 'stakeholder',
})

const DISCOVERY_MATERIALITY_BY_GRAPH_DOMAIN = Object.freeze({
  Company: 'HIGH',
  Products: 'HIGH',
  Services: 'HIGH',
  Market: 'MEDIUM',
  Problems: 'HIGH',
  Consequences: 'HIGH',
  Proof: 'HIGH',
  Economics: 'CRITICAL',
  Differentiation: 'HIGH',
  Stakeholders: 'MEDIUM',
})

const DISCOVERY_MATERIALITY_SCORES = Object.freeze({
  UNKNOWN: null,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
})

const DISCOVERY_DECISION_IMPACT_BY_GRAPH_DOMAIN = Object.freeze({
  Company: 'TACTICAL',
  Products: 'STRATEGIC',
  Services: 'TACTICAL',
  Market: 'TACTICAL',
  Problems: 'STRATEGIC',
  Consequences: 'STRATEGIC',
  Proof: 'STRATEGIC',
  Economics: 'CRITICAL',
  Differentiation: 'STRATEGIC',
  Stakeholders: 'OPERATIONAL',
})

const DISCOVERY_DECISION_IMPACT_SCORES = Object.freeze({
  UNKNOWN: null,
  INFORMATIONAL: 0.2,
  OPERATIONAL: 0.4,
  TACTICAL: 0.6,
  STRATEGIC: 0.8,
  CRITICAL: 1,
})

const DISCOVERY_SIGNAL_STRENGTHS = Object.freeze({
  MISSING: 'MISSING',
  WEAK: 'WEAK',
  MODERATE: 'MODERATE',
  STRONG: 'STRONG',
})

const DISCOVERY_READINESS_STATES = Object.freeze({
  NOT_READY: 'NOT_READY',
  PARTIALLY_READY: 'PARTIALLY_READY',
  READY: 'READY',
})

const DISCOVERY_READINESS_CONTRIBUTIONS = Object.freeze({
  NONE: 'NONE',
  BLOCKER: 'BLOCKER',
  SUPPORTING: 'SUPPORTING',
  STRONG: 'STRONG',
})

const DISCOVERY_PROFILE_GUIDANCE = Object.freeze({
  [DISCOVERY_ACQUISITION_PROFILES.STANDARD]: {
    label: 'Standard Acquisition',
    summary: 'Good for quick discovery.',
    targetCoverageRange: { min: 40, max: 70 },
    targetEvidenceObjectRange: { min: 5, max: 20 },
    minimumRecommendedInputs: [
      'Website URL',
      'Company name',
      'Product / offer',
      'Notes or document',
    ],
    additionalUsefulInputs: [
      'Market / region',
      'Uploaded document',
    ],
  },
  [DISCOVERY_ACQUISITION_PROFILES.ENHANCED]: {
    label: 'Enhanced Acquisition',
    summary: 'Best for customer-ready VMF work.',
    targetCoverageRange: { min: 60, max: 85 },
    targetEvidenceObjectRange: { min: 20, max: 100 },
    minimumRecommendedInputs: [
      'Website URL',
      'Company name',
      'Product / offer',
      'Notes or document',
    ],
    additionalUsefulInputs: [
      'Product pages',
      'Sales deck',
      'Customer proof',
      'Case studies',
      'Discovery notes',
    ],
  },
  [DISCOVERY_ACQUISITION_PROFILES.STRATEGIC]: {
    label: 'Strategic Acquisition',
    summary: 'Best for board-level or strategic outputs.',
    targetCoverageRange: { min: 80, max: 95 },
    targetEvidenceObjectRange: { min: 100, max: 500 },
    minimumRecommendedInputs: [
      'Website URL',
      'Company name',
      'Product / offer',
      'Notes or document',
    ],
    additionalUsefulInputs: [
      'Market evidence',
      'Competitor information',
      'Economic or ROI evidence',
      'Investor material',
      'Customer proof',
      'Strategic notes',
    ],
  },
})

const ACTIVE_DISCOVERY_ACQUISITION_PROFILES = new Set([
  DISCOVERY_ACQUISITION_PROFILES.STANDARD,
  DISCOVERY_ACQUISITION_PROFILES.ENHANCED,
])

const INPUT_EVIDENCE_MAP = Object.freeze({
  companyWebsite: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
    coverageArea: 'Company',
    label: 'Company Website',
    sourceType: 'WEBSITE',
    factPrefix: 'Company website',
  },
  companyName: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
    coverageArea: 'Company',
    label: 'Company Name',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Company name',
  },
  marketRegion: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.INDUSTRIES,
    coverageArea: 'Markets',
    label: 'Market / Region',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Market or region',
  },
  targetOffer: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PRODUCTS,
    coverageArea: 'Products',
    label: 'Target Product or Offer',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Target offer',
  },
  notes: {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
    label: 'Intelligence Hub Notes',
    sourceType: 'DISCOVERY_NOTES',
    factPrefix: 'Intelligence Hub note',
  },
})

const WEBSITE_ACQUISITION_LIMITS = Object.freeze({
  timeoutMs: 6000,
  maxContentCharacters: 320000,
  maxEvidenceObjects: 20,
  maxCandidateSegments: 80,
  maxRedirects: 3,
})

const WEBSITE_ACQUISITION_PROFILE_LIMITS = Object.freeze({
  [DISCOVERY_ACQUISITION_PROFILES.STANDARD]: {
    maxCandidateSegments: 12,
    maxEvidenceObjects: 4,
  },
  [DISCOVERY_ACQUISITION_PROFILES.ENHANCED]: {
    maxCandidateSegments: WEBSITE_ACQUISITION_LIMITS.maxCandidateSegments,
    maxEvidenceObjects: WEBSITE_ACQUISITION_LIMITS.maxEvidenceObjects,
  },
  [DISCOVERY_ACQUISITION_PROFILES.STRATEGIC]: {
    maxCandidateSegments: WEBSITE_ACQUISITION_LIMITS.maxCandidateSegments,
    maxEvidenceObjects: WEBSITE_ACQUISITION_LIMITS.maxEvidenceObjects,
  },
})

const DOCUMENT_ACQUISITION_LIMITS = Object.freeze({
  maxDocuments: 5,
  maxFileBytes: 2_500_000,
  maxPptxFileBytes: 40_000_000,
  maxTextCharacters: 80000,
  maxEvidenceObjectsPerDocument: 30,
  maxCandidateSegments: 120,
  maxPdfTextPages: 10,
  pdfTextTimeoutMs: 15000,
  maxPdfOcrPages: 10,
  pdfOcrRenderScale: 2,
  pdfOcrTimeoutMs: 90000,
  maxPptxSlides: 60,
  pptxTimeoutMs: 15000,
  maxPptxZipEntries: 800,
  maxPptxXmlEntries: 240,
  maxPptxCompressedEntryBytes: 2_000_000,
  maxPptxUncompressedEntryBytes: 2_000_000,
  maxPptxUncompressedBytes: 12_000_000,
})
const PDF_CMAP_URL = `${path.dirname(moduleRequire.resolve('pdfjs-dist/cmaps/78-EUC-H.bcmap'))}${path.sep}`
const PDF_STANDARD_FONT_DATA_URL = `${path.dirname(moduleRequire.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))}${path.sep}`
const PDF_OCR_LANGUAGE_DATA_URL = path.dirname(moduleRequire.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'))
const PDF_OCR_WORKER_PATH = moduleRequire.resolve('tesseract.js/src/worker-script/node/index.js')
const PDF_OCR_CORE_PATH = path.dirname(moduleRequire.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'))
const PDF_NO_READABLE_TEXT_ERROR = 'PDF document did not contain readable extractable text.'
const PDF_TEXT_TIMEOUT_ERROR = 'PDF text extraction timed out before this PDF could be processed.'
const PDF_OCR_NO_READABLE_TEXT_ERROR = 'OCR could not extract reliable text from this PDF.'
const PDF_OCR_TIMEOUT_ERROR = 'OCR timed out before this PDF could be processed.'
const PPTX_NO_READABLE_TEXT_ERROR = 'PowerPoint document did not contain readable extractable slide text or speaker notes.'
const PPTX_EXTRACTION_TIMEOUT_ERROR = 'PowerPoint extraction timed out before this presentation could be processed.'
const PPTX_MALFORMED_ERROR = 'PowerPoint file is not a valid PPTX package.'
const PPTX_ZIP_LIMIT_ERROR = 'PowerPoint file exceeds extraction safety limits.'

const DOCUMENT_ASSET_TYPES = Object.freeze({
  CUSTOMER_DOCUMENT: 'CUSTOMER_DOCUMENT',
  CUSTOMER_NOTES: 'CUSTOMER_NOTES',
  PROPOSAL: 'PROPOSAL',
  ANNUAL_REPORT: 'ANNUAL_REPORT',
  STRATEGY_DECK: 'STRATEGY_DECK',
  COMPETITOR_ANALYSIS: 'COMPETITOR_ANALYSIS',
  PRODUCT_BROCHURE: 'PRODUCT_BROCHURE',
  IMPLEMENTATION_DOCUMENTATION: 'IMPLEMENTATION_DOCUMENTATION',
  REFERENCE_MATERIAL: 'REFERENCE_MATERIAL',
})

const DOCUMENT_TYPE_BY_MIME = Object.freeze({
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/csv': 'TXT',
  'text/markdown': 'TXT',
  'text/plain': 'TXT',
})

const DOCUMENT_TYPE_BY_EXTENSION = Object.freeze({
  '.csv': 'TXT',
  '.docx': 'DOCX',
  '.md': 'TXT',
  '.pdf': 'PDF',
  '.pptx': 'PPTX',
  '.txt': 'TXT',
})

const WEBSITE_EXTRACTION_RULES = Object.freeze([
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PRODUCTS,
    coverageArea: 'Products',
    pattern: /\b(product|products|platform|offer|solution|solutions|capability|capabilities|feature|features|software|tool|tools)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.SERVICES,
    coverageArea: 'Services',
    pattern: /\b(service|services|consulting|implementation|support|managed|delivery|advisory)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.INDUSTRIES,
    coverageArea: 'Industries',
    pattern: /\b(industry|industries|sector|sectors|market|markets|enterprise|retail|finance|healthcare|public sector)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.TECHNOLOGY,
    coverageArea: 'Technology',
    pattern: /\b(ai|artificial intelligence|automation|data|integration|api|cloud|security|workflow|technology|machine learning)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.PROOF,
    coverageArea: 'Proof',
    pattern: /\b(customer|customers|case study|testimonial|trusted|clients|used by|outcome|outcomes|results)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.ECONOMICS,
    coverageArea: 'Economics',
    pattern: /\b(revenue|cost|roi|saving|savings|efficiency|growth|productivity|margin|conversion)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.DIFFERENTIATORS,
    coverageArea: 'Differentiation',
    pattern: /\b(unique|different|differentiated|differentiator|native|governed|certified|trusted|leading)\b/i,
  },
  {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
    pattern: /\b(value|benefit|benefits|improve|reduce|accelerate|faster|risk|governance|control)\b/i,
  },
])

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const toIdString = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const hashValue = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value ?? '')).digest('hex').slice(0, 12)

const hashBuffer = (value) =>
  crypto.createHash('sha256').update(value).digest('hex')

const normalizeReviewStatus = (value) => {
  const normalized = String(value || '').trim().toUpperCase()
  return Object.values(DISCOVERY_EVIDENCE_REVIEW_STATUSES).includes(normalized)
    ? normalized
    : DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING
}

const normalizeGraphReadyConfidenceScore = (value) => {
  const score = Number(value)
  if (!Number.isFinite(score)) return null
  if (score > 1) return Math.max(0, Math.min(1, score / 100))
  return Math.max(0, Math.min(1, score))
}

const sanitizeFact = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

const uniqueStrings = (values = []) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))

const normalizeAcquisitionProfile = (value) => {
  const profile = String(value || '').trim().toUpperCase()
  return ACTIVE_DISCOVERY_ACQUISITION_PROFILES.has(profile)
    ? profile
    : DISCOVERY_ACQUISITION_PROFILES.STANDARD
}

const getWebsiteAcquisitionProfileLimits = (acquisitionProfile) => {
  const profile = normalizeAcquisitionProfile(acquisitionProfile)
  return WEBSITE_ACQUISITION_PROFILE_LIMITS[profile]
    || WEBSITE_ACQUISITION_PROFILE_LIMITS[DISCOVERY_ACQUISITION_PROFILES.STANDARD]
}

const getDiscoveryGraphDomain = (coverageArea = '') => {
  const normalizedArea = String(coverageArea || '').trim()
  return DISCOVERY_GRAPH_DOMAIN_BY_COVERAGE_AREA[normalizedArea] || normalizedArea || 'Unknown'
}

const getEvidenceConfidenceInputs = (evidenceObject = {}) => {
  const confidence = isPlainObject(evidenceObject.confidence) ? evidenceObject.confidence : {}
  const basis = Array.isArray(confidence.basis)
    ? confidence.basis
    : Array.isArray(evidenceObject.confidenceFactors)
      ? evidenceObject.confidenceFactors
      : []
  return {
    level: String(confidence.level || evidenceObject.confidenceLevel || 'UNKNOWN').trim().toUpperCase(),
    score: normalizeGraphReadyConfidenceScore(confidence.score ?? evidenceObject.confidenceScore),
    factors: basis.map((item) => String(item || '').trim()).filter(Boolean),
    warnings: Array.isArray(confidence.warnings)
      ? confidence.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  }
}

const deriveGraphReadyEvidenceMetadata = (evidenceObject = {}) => {
  const reviewStatus = normalizeReviewStatus(evidenceObject.reviewStatus)
  const graphDomain = getDiscoveryGraphDomain(evidenceObject.coverageArea || evidenceObject.category)
  const confidence = getEvidenceConfidenceInputs(evidenceObject)
  const rejected = reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
  const pending = reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING
  const sourceBacked = [
    'WEBSITE_ACQUISITION',
    'DOCUMENT_INGESTION',
  ].includes(String(evidenceObject.acquisitionMethod || '').trim().toUpperCase())
  const materiality = rejected
    ? 'UNKNOWN'
    : DISCOVERY_MATERIALITY_BY_GRAPH_DOMAIN[graphDomain] || 'MEDIUM'
  const decisionImpact = rejected
    ? 'UNKNOWN'
    : DISCOVERY_DECISION_IMPACT_BY_GRAPH_DOMAIN[graphDomain] || 'OPERATIONAL'
  const signalStrength = rejected
    ? DISCOVERY_SIGNAL_STRENGTHS.MISSING
    : confidence.score !== null && confidence.score >= 0.75 && sourceBacked
      ? DISCOVERY_SIGNAL_STRENGTHS.STRONG
      : confidence.score !== null && confidence.score >= 0.65
        ? DISCOVERY_SIGNAL_STRENGTHS.MODERATE
        : DISCOVERY_SIGNAL_STRENGTHS.WEAK
  const readinessContribution = rejected
    ? DISCOVERY_READINESS_CONTRIBUTIONS.NONE
    : pending
      ? DISCOVERY_READINESS_CONTRIBUTIONS.SUPPORTING
      : signalStrength === DISCOVERY_SIGNAL_STRENGTHS.STRONG
        ? DISCOVERY_READINESS_CONTRIBUTIONS.STRONG
        : DISCOVERY_READINESS_CONTRIBUTIONS.SUPPORTING

  return {
    evidenceId: String(evidenceObject.evidenceObjectId || '').trim(),
    sourceId: String(evidenceObject.sourceId || '').trim(),
    domain: graphDomain,
    classification: String(evidenceObject.category || graphDomain).trim(),
    confidence: confidence.level,
    confidenceScore: confidence.score,
    confidenceFactors: confidence.factors,
    confidenceWarnings: [
      ...confidence.warnings,
      ...(pending ? ['EVIDENCE_REVIEW_PENDING'] : []),
      ...(rejected ? ['EVIDENCE_REJECTED'] : []),
    ],
    materiality,
    materialityScore: DISCOVERY_MATERIALITY_SCORES[materiality],
    decisionImpact,
    decisionImpactScore: DISCOVERY_DECISION_IMPACT_SCORES[decisionImpact],
    signalStrength,
    readinessContribution,
    readinessDomain: graphDomain,
    truthDomain: DISCOVERY_TRUTH_DOMAIN_BY_GRAPH_DOMAIN[graphDomain] || 'unknown',
    validationStatus: rejected
      ? 'REJECTED'
      : pending
        ? 'UNVALIDATED'
        : 'VALIDATED',
  }
}

const withGraphReadyEvidenceMetadata = (evidenceObject) => {
  const graphReadyMetadata = deriveGraphReadyEvidenceMetadata(evidenceObject)
  const { evidenceId, sourceId, confidence, ...mirroredMetadata } = graphReadyMetadata
  return { ...evidenceObject, ...mirroredMetadata, graphReadyMetadata }
}

const normalizeDocumentExtractionText = (value) => String(value ?? '')
  .slice(0, DOCUMENT_ACQUISITION_LIMITS.maxTextCharacters)
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/g, ' ')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const countReadableDocumentWords = (value) =>
  (String(value || '').match(/\b[A-Za-z][A-Za-z'-]{2,}\b/g) || []).length

const isReadableExtractedDocumentText = (value) => {
  const text = normalizeDocumentExtractionText(value)
  if (!text) return false
  const sample = text.slice(0, 4000)
  const nonWhitespaceLength = sample.replace(/\s/g, '').length
  if (nonWhitespaceLength < 18) return false

  const asciiLetterCount = (sample.match(/[A-Za-z]/g) || []).length
  const nonAsciiCount = (sample.match(/[^\x00-\x7F]/g) || []).length
  const supportedCharacterCount = (sample.match(/[\p{L}\p{N}\s.,;:!?'"()[\]{}\/%&+@#*=<>_|~-]/gu) || []).length
  const asciiLetterRatio = asciiLetterCount / nonWhitespaceLength
  const nonAsciiRatio = nonAsciiCount / sample.length
  const unsupportedRatio = Math.max(0, sample.length - supportedCharacterCount) / sample.length

  return countReadableDocumentWords(sample) >= 4
    && asciiLetterRatio >= 0.25
    && nonAsciiRatio <= 0.12
    && unsupportedRatio <= 0.18
}

const getReadableDocumentExtractionText = (value) => {
  const text = normalizeDocumentExtractionText(value)
  return isReadableExtractedDocumentText(text) ? text : ''
}

class PdfOcrCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height)
    return {
      canvas,
      context: canvas.getContext('2d'),
    }
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

const isPdfOcrEnabled = () =>
  String(process.env.STORYLINEOS_PDF_OCR_ENABLED || 'true').trim().toLowerCase() !== 'false'

const loadPdfDocument = (buffer, options = {}) => pdfjs.getDocument({
  data: new Uint8Array(buffer),
  cMapPacked: true,
  cMapUrl: PDF_CMAP_URL,
  disableFontFace: true,
  disableWorker: true,
  isEvalSupported: false,
  standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  useWorkerFetch: false,
  verbosity: pdfjs.VerbosityLevel.ERRORS,
  ...options,
}).promise

const withTimeout = async ({ promise, timeoutMs, timeoutMessage, onTimeout }) => {
  let timeoutId
  let timedOut = false

  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
    if (timedOut && typeof onTimeout === 'function') {
      await onTimeout()
    }
  }
}

const STYLE_OR_CODE_FRAGMENT_PATTERNS = Object.freeze([
  /stylablebutton/i,
  /\b(?:width|height|min-width|min-height|padding|margin|display|cursor|border|box-sizing|background-color|box-shadow|pointer-events|touch-action|transition|transform|animation|opacity|z-index|font-size|line-height|position|overflow)\s*:/i,
  /:[a-z-]+(?:\([^)]*\))?(?::[a-z-]+(?:\([^)]*\))?)*\{/i,
  /\bcubic-bezier\s*\(/i,
  /\bvar\(--/i,
  /--[a-z0-9-]+/i,
  /__[a-z0-9-]+/i,
  /[{}][^.!?]*;/,
])

const countNaturalLanguageTokens = (value) =>
  (String(value || '').match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || []).length

const countWhitespaceSeparatedWords = (value) =>
  String(value || '').split(/\s+/).filter((token) => /[A-Za-z]{2,}/.test(token)).length

const COMMON_SHORT_DOCUMENT_WORDS = new Set([
  'a',
  'ai',
  'am',
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'eu',
  'go',
  'he',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'on',
  'or',
  'os',
  'so',
  'to',
  'uk',
  'up',
  'us',
  'ux',
  'ui',
  'we',
])

const normalizeDocumentEvidenceSegment = (value) => sanitizeFact(value)
  .replace(/^[^\p{L}\p{N}]+/u, '')
  .replace(/^[A-Z][A-Z\s]{8,}\s+(?=[A-Z][a-z])/u, '')
  .trim()

const hasLikelyOcrSplitWordRun = (value) => {
  const tokens = String(value || '').match(/\b[A-Za-z][A-Za-z']*\b/g) || []
  let suspiciousRun = 0

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase().replace(/'/g, '')
    const isShortToken = normalizedToken.length <= 2
    const isCommonShortWord = COMMON_SHORT_DOCUMENT_WORDS.has(normalizedToken)
    const isUppercaseAcronym = token.length >= 2 && token === token.toUpperCase()

    if (isShortToken && !isCommonShortWord && !isUppercaseAcronym) {
      suspiciousRun += 1
      if (suspiciousRun >= 2) return true
    } else {
      suspiciousRun = 0
    }
  }

  return false
}

const stripPresentationSegmentPrefix = (value) => String(value || '')
  .replace(/^Slide\s+\d+(?:\s+speaker notes)?:\s*/i, '')
  .trim()

const isWeakPresentationEvidenceSegment = (value) => {
  const text = normalizeDocumentEvidenceSegment(value)
  const withoutSlidePrefix = stripPresentationSegmentPrefix(text)
  if (!withoutSlidePrefix) return true

  const readableWordCount = countReadableDocumentWords(withoutSlidePrefix)
  const normalized = withoutSlidePrefix.toLowerCase()

  if (/^(?:what|why|how|when|where|who|which)\b.*\?$/.test(normalized) && readableWordCount <= 9) {
    return true
  }

  if (/!$/.test(withoutSlidePrefix) && readableWordCount <= 7) {
    return true
  }

  if (/\bc\.$/i.test(withoutSlidePrefix)) {
    return true
  }

  return false
}

const getDocumentEvidenceSegmentQuality = (value) => {
  const originalText = sanitizeFact(value)
  const text = normalizeDocumentEvidenceSegment(originalText)
  if (!text || !isGovernedDiscoveryEvidenceFact(text)) {
    return { reviewable: false, score: 0, text }
  }

  const characters = Array.from(text)
  const characterCount = Math.max(characters.length, 1)
  const naturalLanguageTokens = countNaturalLanguageTokens(text)
  const readableWordCount = countReadableDocumentWords(text)
  if (text.length > 260) {
    return { reviewable: false, score: 0, text }
  }
  if (naturalLanguageTokens < 4 || readableWordCount < 4) {
    return { reviewable: false, score: 0, text }
  }
  if (/^(?:and|or|but|that|which|where|while|because|from|to|with|for|of|in|on|by|than)\b/.test(text)) {
    return { reviewable: false, score: 0, text }
  }
  if (hasLikelyOcrSplitWordRun(text)) {
    return { reviewable: false, score: 0, text }
  }

  const letters = text.match(/[A-Za-z]/g) || []
  const uppercaseLetters = text.match(/[A-Z]/g) || []
  const uppercaseRatio = letters.length > 0 ? uppercaseLetters.length / letters.length : 0
  const endsLikeSentence = /[.!?]$/.test(text)
  const hasSentencePunctuation = /[,;:]/.test(text)
  const looksLikeShortTitle = naturalLanguageTokens <= 7
    && uppercaseRatio >= 0.55
    && !endsLikeSentence
    && !hasSentencePunctuation
  if (looksLikeShortTitle) {
    return { reviewable: false, score: 0, text }
  }

  const hardNoiseCount = (text.match(/[<>\uFFFD\u25A1]/g) || []).length
  if (hardNoiseCount > 0 && hardNoiseCount / characterCount > 0.005) {
    return { reviewable: false, score: 0, text }
  }

  const unsupportedCharacterCount = characters.filter((character) =>
    !/[\p{L}\p{N}\s.,;:!?'"()/%&+@#-]/u.test(character)).length
  if (unsupportedCharacterCount >= 2 || unsupportedCharacterCount / characterCount > 0.03) {
    return { reviewable: false, score: 0, text }
  }

  const digitCount = (text.match(/[0-9]/g) || []).length
  if (digitCount > 0 && digitCount / characterCount > 0.25) {
    return { reviewable: false, score: 0, text }
  }

  const hasUnmatchedTrailingBracket = /[\])}]$/.test(text)
    && !(/[([{]/.test(text) && /[\])}]/.test(text))
  if (hasUnmatchedTrailingBracket) {
    return { reviewable: false, score: 0, text }
  }

  if (/(?:\/|\\)\s*\d+\s*$/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  if (/(^|\s)[\\/](\s|$)/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  const sentenceTerminatorCount = (text.match(/[.!?]/g) || []).length
  if (sentenceTerminatorCount > 3) {
    return { reviewable: false, score: 0, text }
  }

  const hasTrailingUppercaseHeading = /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\s*$/.test(text)
    && uppercaseRatio < 0.7
  if (hasTrailingUppercaseHeading) {
    return { reviewable: false, score: 0, text }
  }

  if (/\b(?:and|or)\s+[A-Z][a-z][.!?]?$/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  if (/\b[a-z]{2,}\s+,\s+[a-z]{2,}\b/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  if (/[,;:]?\s+[a-z]\s*$/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  if (/\b\d\)|\s[.,]\s|,\s[.,]\s/.test(text)) {
    return { reviewable: false, score: 0, text }
  }

  let score = readableWordCount * 4
  if (endsLikeSentence) score += 18
  if (hasSentencePunctuation) score += 4
  if (text.length >= 45 && text.length <= 220) score += 8
  if (originalText !== text) score -= 3
  score -= unsupportedCharacterCount * 10
  score -= hardNoiseCount * 20
  score -= Math.round(uppercaseRatio * 8)

  return {
    reviewable: score >= 24,
    score,
    text,
  }
}

const isUsefulDocumentEvidenceSegment = (value) =>
  getDocumentEvidenceSegmentQuality(value).reviewable

export const isGovernedDiscoveryEvidenceFact = (value) => {
  const fact = sanitizeFact(value)
  if (!fact) return false

  const text = fact
    .replace(/^(?:Website|Document)\s+(?:title|description|heading|body|Customer Document|Customer Notes|Proposal|Annual Report|Strategy Deck|Competitor Analysis|Product Brochure|Implementation Documentation|Reference Material):\s*/i, '')
    .trim()
  if (!text) return false

  if (STYLE_OR_CODE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(text))) return false

  const symbolCount = (text.match(/[{}[\];=<>]/g) || []).length
  if (symbolCount >= 3 && symbolCount / Math.max(text.length, 1) > 0.04) return false

  const naturalLanguageTokens = countNaturalLanguageTokens(text)
  const whitespaceWords = countWhitespaceSeparatedWords(text)
  return naturalLanguageTokens >= 3 && whitespaceWords >= 3
}

const normalizeDocumentAssetType = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return Object.values(DOCUMENT_ASSET_TYPES).includes(normalized)
    ? normalized
    : DOCUMENT_ASSET_TYPES.CUSTOMER_DOCUMENT
}

const formatDocumentAssetLabel = (value) => String(value || DOCUMENT_ASSET_TYPES.CUSTOMER_DOCUMENT)
  .trim()
  .toLowerCase()
  .split('_')
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(' ')

const normalizeDocumentFileName = (value) => {
  const trimmed = String(value || '').trim()
  const fileName = trimmed.split(/[\\/]+/).filter(Boolean).pop() || ''
  return fileName.slice(0, 255)
}

const getDocumentExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

const getDocumentType = ({ fileName, mimeType }) => {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase().split(';')[0]
  const extension = getDocumentExtension(fileName)
  return DOCUMENT_TYPE_BY_MIME[normalizedMimeType] || DOCUMENT_TYPE_BY_EXTENSION[extension] || ''
}

const getDocumentMaxFileBytes = (documentType) =>
  documentType === 'PPTX'
    ? DOCUMENT_ACQUISITION_LIMITS.maxPptxFileBytes
    : DOCUMENT_ACQUISITION_LIMITS.maxFileBytes

const getUnsupportedPowerPointMessage = (fileName = '') => {
  const extension = getDocumentExtension(fileName)
  if (extension === '.ppt') {
    return 'Older PowerPoint files are not supported. Save the presentation as PPTX and extract again.'
  }
  if (extension === '.pptm') {
    return 'Macro-enabled PowerPoint files are not supported. Save the presentation as a non-macro PPTX and extract again.'
  }
  if (extension === '.pps' || extension === '.ppsx') {
    return 'PowerPoint show files are not supported. Save the presentation as PPTX and extract again.'
  }
  return ''
}

const decodeDocumentBuffer = (documentSource = {}) => {
  const textContent = String(documentSource?.textContent || '').trim()
  if (textContent) {
    return Buffer.from(textContent, 'utf8')
  }

  const base64Content = String(documentSource?.contentBase64 || '').trim()
  if (!base64Content) return Buffer.alloc(0)

  const cleanedBase64 = base64Content.includes(',')
    ? base64Content.slice(base64Content.indexOf(',') + 1)
    : base64Content

  try {
    return Buffer.from(cleanedBase64, 'base64')
  } catch {
    return Buffer.alloc(0)
  }
}

const decodeHtmlEntities = (value) => String(value ?? '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')

const stripHtmlToText = (value) => decodeHtmlEntities(String(value ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))

const normalizeWebsiteHostname = (hostname) =>
  String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/^www\./, '')

const normalizeWebsiteHostForNetworkCheck = (hostname) =>
  String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')

const isBlockedIpv4 = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false

  const [a, b, c] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

const isBlockedIpv6 = (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  return normalizedHostname === '::'
    || normalizedHostname === '::1'
    || normalizedHostname.startsWith('::ffff:')
    || normalizedHostname.startsWith('64:ff9b:')
    || normalizedHostname.startsWith('100:')
    || normalizedHostname.startsWith('2001:db8:')
    || normalizedHostname.startsWith('2002:')
    || normalizedHostname.startsWith('fc')
    || normalizedHostname.startsWith('fd')
    || /^fe[89ab]/i.test(normalizedHostname)
    || normalizedHostname.startsWith('ff')
}

const isBlockedWebsiteHost = (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  if (!normalizedHostname) return true
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) return true

  const ipType = isIP(normalizedHostname)
  if (ipType === 4) return isBlockedIpv4(normalizedHostname)
  if (ipType === 6) return isBlockedIpv6(normalizedHostname)

  return false
}

const getWebsiteDnsLookup = () =>
  (typeof globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ === 'function'
    ? globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
    : lookup)

const assertWebsiteResolvesPublicly = async (hostname) => {
  const normalizedHostname = normalizeWebsiteHostForNetworkCheck(hostname)
  if (isBlockedWebsiteHost(normalizedHostname)) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
  if (isIP(normalizedHostname)) return

  let records
  try {
    records = await getWebsiteDnsLookup()(normalizedHostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Website acquisition could not verify public DNS resolution.')
  }

  const resolvedAddresses = Array.isArray(records) ? records.map((record) => record?.address).filter(Boolean) : []
  if (resolvedAddresses.length === 0) {
    throw new Error('Website acquisition could not verify public DNS resolution.')
  }
  if (resolvedAddresses.some((address) => isBlockedWebsiteHost(address))) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
}

export const normalizeDiscoveryWebsiteUrl = (
  value,
  { fieldLabel = 'Company website', requireHttps = false } = {},
) => {
  const rawUrl = String(value ?? '').trim()
  if (!rawUrl) {
    throw new Error(`${fieldLabel} is required for acquisition.`)
  }

  if (requireHttps && !/^https:\/\//i.test(rawUrl)) {
    throw new Error('Enter the full URL including https://')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error(`${fieldLabel} must be a valid ${requireHttps ? 'https' : 'http or https'} URL.`)
  }

  if (requireHttps && parsedUrl.protocol !== 'https:') {
    throw new Error('Enter the full URL including https://')
  }

  if (!requireHttps && !['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`${fieldLabel} must use http or https.`)
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error(`${fieldLabel} must not include credentials.`)
  }

  if (isBlockedWebsiteHost(parsedUrl.hostname)) {
    throw new Error(`${fieldLabel} must be a publicly accessible domain.`)
  }

  parsedUrl.hash = ''
  return parsedUrl.toString()
}

const assertWebsiteDomainBoundary = ({ requestedUrl, finalUrl }) => {
  const requested = new URL(requestedUrl)
  const final = new URL(finalUrl || requestedUrl)
  if (normalizeWebsiteHostname(requested.hostname) !== normalizeWebsiteHostname(final.hostname)) {
    throw new Error('Website acquisition redirected outside the requested domain.')
  }
  if (isBlockedWebsiteHost(final.hostname)) {
    throw new Error('Website acquisition target must remain a publicly accessible domain.')
  }
}

const readWebsiteResponseText = async (response, { signal } = {}) => {
  const maxCharacters = WEBSITE_ACQUISITION_LIMITS.maxContentCharacters
  if (!response?.body?.getReader) {
    const contentLength = Number(response?.headers?.get?.('content-length'))
    if (!Number.isFinite(contentLength) || contentLength > maxCharacters) {
      throw new Error('Website acquisition response exceeds the supported size limit.')
    }
    const text = String(await response.text())
    return {
      text: text.slice(0, maxCharacters),
      truncated: text.length > maxCharacters,
      characterLimit: maxCharacters,
      charactersRead: Math.min(text.length, maxCharacters),
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Website acquisition timed out.')
      }
      const { done, value } = await reader.read()
      if (done) break
      const decodedChunk = decoder.decode(value, { stream: true })
      const remainingCharacters = maxCharacters - text.length
      if (decodedChunk.length > remainingCharacters) {
        text += decodedChunk.slice(0, Math.max(0, remainingCharacters))
        truncated = true
        await reader.cancel?.()
        break
      }
      text += decodedChunk
      if (text.length >= maxCharacters) {
        truncated = true
        await reader.cancel?.()
        break
      }
    }
    if (!truncated) {
      const finalChunk = decoder.decode()
      const remainingCharacters = maxCharacters - text.length
      if (finalChunk.length > remainingCharacters) {
        text += finalChunk.slice(0, Math.max(0, remainingCharacters))
        truncated = true
      } else {
        text += finalChunk
      }
    }
    return {
      text,
      truncated,
      characterLimit: maxCharacters,
      charactersRead: text.length,
    }
  } finally {
    reader.releaseLock?.()
  }
}

const fetchWebsiteWithGovernedRedirects = async ({ normalizedUrl, signal }) => {
  let currentUrl = normalizedUrl

  for (let redirectCount = 0; redirectCount <= WEBSITE_ACQUISITION_LIMITS.maxRedirects; redirectCount += 1) {
    const currentParsedUrl = new URL(currentUrl)
    await assertWebsiteResolvesPublicly(currentParsedUrl.hostname)

    let response
    try {
      response = await globalThis.fetch(currentUrl, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'user-agent': 'StorylineOS-Discovery-Acquisition/1.0',
        },
      })
    } catch (err) {
      throw new Error(err?.name === 'AbortError'
        ? 'Website acquisition timed out.'
        : 'Website acquisition could not fetch the requested website.')
    }

    const status = Number(response?.status)
    if (status >= 300 && status < 400) {
      const location = response.headers?.get?.('location')
      if (!location) {
        throw new Error('Website acquisition redirect was missing a target location.')
      }
      const nextUrl = new URL(location, currentUrl).toString()
      assertWebsiteDomainBoundary({ requestedUrl: normalizedUrl, finalUrl: nextUrl })
      await assertWebsiteResolvesPublicly(new URL(nextUrl).hostname)
      currentUrl = nextUrl
      continue
    }

    return response
  }

  throw new Error('Website acquisition exceeded the supported redirect limit.')
}

const extractHtmlMatch = (html, pattern) => {
  const match = String(html || '').match(pattern)
  return sanitizeFact(stripHtmlToText(match?.[1] || ''))
}

const extractHtmlSegments = (html, { acquisitionProfile } = {}) => {
  const sourceHtml = String(html || '')
  const profileLimits = getWebsiteAcquisitionProfileLimits(acquisitionProfile)
  const title = extractHtmlMatch(sourceHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description = extractHtmlMatch(
    sourceHtml,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ) || extractHtmlMatch(
    sourceHtml,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
  )
  const headingMatches = Array.from(sourceHtml.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => sanitizeFact(stripHtmlToText(match[1])))
  const bodySegments = stripHtmlToText(sourceHtml)
    .split(/[.!?\n\r]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 24 && segment.length <= 260)
    .filter(isGovernedDiscoveryEvidenceFact)

  const segments = [
    title ? { kind: 'title', text: title } : null,
    description ? { kind: 'description', text: description } : null,
    ...headingMatches.map((text) => ({ kind: 'heading', text })),
    ...bodySegments.slice(0, profileLimits.maxCandidateSegments).map((text) => ({ kind: 'body', text })),
  ].filter(Boolean)
    .filter((segment) => isGovernedDiscoveryEvidenceFact(segment.text))

  const seen = new Set()
  return segments.filter((segment) => {
    const key = segment.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const classifyWebsiteSegment = (segment) => {
  if (segment.kind === 'title' || segment.kind === 'description') {
    return {
      category: DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
      coverageArea: 'Company',
    }
  }

  const matchedRule = WEBSITE_EXTRACTION_RULES.find((rule) => rule.pattern.test(segment.text))
  return matchedRule || {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
  }
}

const extractDocumentSegments = (text, { documentType = '', prioritizeQuality = false } = {}) => {
  const sourceText = normalizeDocumentExtractionText(text)
  if (!sourceText) return []
  const isPresentationText = String(documentType || '').trim().toUpperCase() === 'PPTX'

  const sentenceSegments = sourceText
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 18 && segment.length <= 320)

  const fallbackSegments = sourceText
    .split(/\s{2,}|[;|•]+/)
    .map(sanitizeFact)
    .filter((segment) => segment.length >= 18 && segment.length <= 320)

  const segments = [...sentenceSegments, ...fallbackSegments]
  const seen = new Set()

  const candidates = segments
    .filter((segment) => {
      const key = segment.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((segment, index) => ({
      index,
      quality: getDocumentEvidenceSegmentQuality(segment),
    }))
    .filter((segment) => segment.quality.reviewable)
    .filter((segment) => !isPresentationText || !isWeakPresentationEvidenceSegment(segment.quality.text))

  if (prioritizeQuality) {
    candidates.sort((a, b) => b.quality.score - a.quality.score || a.index - b.index)
  }

  return candidates
    .slice(0, DOCUMENT_ACQUISITION_LIMITS.maxCandidateSegments)
    .map((segment, index) => ({
      kind: index === 0 ? 'summary' : 'body',
      text: segment.quality.text,
    }))
}

const classifyDocumentSegment = (segment) => {
  const matchedRule = WEBSITE_EXTRACTION_RULES.find((rule) => rule.pattern.test(segment.text))
  return matchedRule || {
    category: DISCOVERY_EVIDENCE_CATEGORIES.VALUE_DRIVERS,
    coverageArea: 'Decision Context',
  }
}

const decodePdfLiteralString = (value) => String(value || '')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\r')
  .replace(/\\t/g, '\t')
  .replace(/\\b/g, '\b')
  .replace(/\\f/g, '\f')
  .replace(/\\([()\\])/g, '$1')
  .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)))

const decodePdfHexString = (value) => {
  const normalizedHex = String(value || '').replace(/[^0-9a-f]/gi, '')
  if (!normalizedHex) return ''
  const paddedHex = normalizedHex.length % 2 === 0 ? normalizedHex : `${normalizedHex}0`
  const bytes = []
  for (let index = 0; index < paddedHex.length; index += 2) {
    bytes.push(parseInt(paddedHex.slice(index, index + 2), 16))
  }
  const buffer = Buffer.from(bytes.filter((byte) => Number.isFinite(byte)))
  const utf16Text = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
    ? buffer.toString('utf16le')
    : ''
  return sanitizeFact(utf16Text || buffer.toString('utf8') || buffer.toString('latin1'))
}

const extractPdfOperatorText = (value) => {
  const source = String(value || '')
  const literals = Array.from(source.matchAll(/\((?:\\.|[^\\)]){2,}\)\s*(?:Tj|'|"|TJ)/g))
    .map((match) => decodePdfLiteralString(match[0].replace(/\)\s*(?:Tj|'|"|TJ).*$/s, '').replace(/^\(/, '')))
  const arrayLiterals = Array.from(source.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g))
    .flatMap((match) => Array.from(String(match[1] || '').matchAll(/\((?:\\.|[^\\)]){2,}\)|<([0-9a-fA-F\s]+)>/g))
      .map((tokenMatch) => {
        const token = tokenMatch[0]
        return token.startsWith('<')
          ? decodePdfHexString(token)
          : decodePdfLiteralString(token.slice(1, -1))
      }))
  const hexStrings = Array.from(source.matchAll(/<([0-9a-fA-F\s]{8,})>\s*Tj/g))
    .map((match) => decodePdfHexString(match[1]))

  return sanitizeFact([...literals, ...arrayLiterals, ...hexStrings].filter(Boolean).join(' '))
}

const extractPdfOperatorFallbackText = (buffer) => {
  const rawText = buffer.toString('latin1')
  const extractedParts = [extractPdfOperatorText(rawText)]
  const streamPattern = /(<<[\s\S]{0,1200}?>>)\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g

  for (const match of rawText.matchAll(streamPattern)) {
    const descriptor = match[1] || ''
    const streamBytes = Buffer.from(match[2] || '', 'binary')
    let streamText = ''

    if (/\/FlateDecode\b/i.test(descriptor)) {
      try {
        streamText = zlib.inflateSync(streamBytes).toString('latin1')
      } catch {
        try {
          streamText = zlib.inflateRawSync(streamBytes).toString('latin1')
        } catch {
          streamText = ''
        }
      }
    } else {
      streamText = streamBytes.toString('latin1')
    }

    if (streamText) extractedParts.push(extractPdfOperatorText(streamText))
  }

  return sanitizeFact(extractedParts.filter(Boolean).join(' '))
}

const extractPdfJsTextWithoutTimeout = async (buffer, documentRef = {}) => {
  const document = await loadPdfDocument(buffer)
  documentRef.current = document
  const pageTexts = []
  const pageCount = Number(document?.numPages || 0)
  const maxPages = Math.min(pageCount, DOCUMENT_ACQUISITION_LIMITS.maxPdfTextPages)

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent({
        disableCombineTextItems: false,
        normalizeWhitespace: true,
      })
      const lines = []
      let currentLine = ''
      let currentY = null

      for (const item of textContent.items || []) {
        const text = String(item?.str || '').trim()
        if (!text) continue

        const itemY = Array.isArray(item.transform)
          ? Math.round(Number(item.transform[5] || 0))
          : null
        const startsNewLine = currentY !== null
          && itemY !== null
          && Math.abs(itemY - currentY) > 2

        if (startsNewLine && currentLine) {
          lines.push(currentLine)
          currentLine = text
        } else {
          currentLine = currentLine ? `${currentLine} ${text}` : text
        }

        if (itemY !== null) currentY = itemY
      }

      if (currentLine) lines.push(currentLine)
      pageTexts.push(lines.join('\n'))
    }
  } finally {
    documentRef.current = null
    await document.destroy?.()
  }

  return normalizeDocumentExtractionText(pageTexts.filter(Boolean).join('\n'))
}

const extractPdfJsText = async (buffer) => {
  const documentRef = { current: null }
  return withTimeout({
    promise: extractPdfJsTextWithoutTimeout(buffer, documentRef),
    timeoutMs: DOCUMENT_ACQUISITION_LIMITS.pdfTextTimeoutMs,
    timeoutMessage: PDF_TEXT_TIMEOUT_ERROR,
    onTimeout: async () => {
      await documentRef.current?.destroy?.()
    },
  })
}

const renderPdfPageToPngBuffer = async (page) => {
  const viewport = page.getViewport({ scale: DOCUMENT_ACQUISITION_LIMITS.pdfOcrRenderScale })
  const width = Math.ceil(viewport.width)
  const height = Math.ceil(viewport.height)
  const canvas = createCanvas(width, height)
  const canvasContext = canvas.getContext('2d')

  canvasContext.fillStyle = '#ffffff'
  canvasContext.fillRect(0, 0, width, height)

  await page.render({
    canvasContext,
    viewport,
    background: '#ffffff',
  }).promise

  return canvas.toBuffer('image/png')
}

const createPdfOcrWorker = async () => {
  const worker = await createOcrWorker('eng', 1, {
    cacheMethod: 'none',
    corePath: PDF_OCR_CORE_PATH,
    langPath: PDF_OCR_LANGUAGE_DATA_URL,
    workerPath: PDF_OCR_WORKER_PATH,
  })

  await worker.setParameters({
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: OCR_PAGE_SEGMENTATION_MODES.AUTO,
    user_defined_dpi: '300',
  })

  return worker
}

const extractPdfOcrTextWithoutTimeout = async (buffer, workerRef = {}) => {
  const document = await loadPdfDocument(buffer, {
    canvasFactory: new PdfOcrCanvasFactory(),
  })
  const pageCount = Number(document?.numPages || 0)
  const maxPages = Math.min(pageCount, DOCUMENT_ACQUISITION_LIMITS.maxPdfOcrPages)
  const pageTexts = []
  const pageConfidences = []

  if (maxPages <= 0) {
    await document.destroy?.()
    throw new Error(PDF_OCR_NO_READABLE_TEXT_ERROR)
  }

  let worker
  try {
    worker = await createPdfOcrWorker()
    workerRef.current = worker

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const imageBuffer = await renderPdfPageToPngBuffer(page)
      const { data } = await worker.recognize(imageBuffer)
      const pageText = normalizeDocumentExtractionText(data?.text || '')

      if (pageText) pageTexts.push(pageText)
      if (Number.isFinite(Number(data?.confidence))) {
        pageConfidences.push(Number(data.confidence))
      }
    }
  } finally {
    workerRef.current = null
    await worker?.terminate?.()
    await document.destroy?.()
  }

  const text = getReadableDocumentExtractionText(pageTexts.join('\n'))
  if (!text) {
    throw new Error(PDF_OCR_NO_READABLE_TEXT_ERROR)
  }

  const averageConfidence = pageConfidences.length > 0
    ? Math.round(pageConfidences.reduce((sum, value) => sum + value, 0) / pageConfidences.length)
    : undefined

  return {
    adapter: 'document-pdf-ocr-tesseract-v1',
    confidenceScore: averageConfidence,
    extractionMethod: 'PDF_OCR',
    ingestionMode: 'OCR_FALLBACK',
    ocrPageCount: pageCount,
    ocrPageLimitReached: pageCount > maxPages,
    ocrPagesProcessed: maxPages,
    text,
  }
}

const extractPdfOcrText = async (buffer) => {
  if (!isPdfOcrEnabled()) {
    throw new Error(PDF_NO_READABLE_TEXT_ERROR)
  }

  const workerRef = { current: null }
  return withTimeout({
    promise: extractPdfOcrTextWithoutTimeout(buffer, workerRef),
    timeoutMs: DOCUMENT_ACQUISITION_LIMITS.pdfOcrTimeoutMs,
    timeoutMessage: PDF_OCR_TIMEOUT_ERROR,
    onTimeout: async () => {
      await workerRef.current?.terminate?.()
    },
  })
}

const extractPdfText = async (buffer) => {
  try {
    const parsedText = await extractPdfJsText(buffer)
    const readableText = getReadableDocumentExtractionText(parsedText)
    if (readableText) {
      return {
        adapter: 'document-pdf-text-extraction-v1',
        extractionMethod: 'PDF_TEXT_LAYER',
        ingestionMode: 'TEXT_NATIVE',
        text: readableText,
      }
    }
  } catch {
    // Fall back to the deterministic operator extractor for simple legacy PDFs.
  }

  const fallbackText = getReadableDocumentExtractionText(extractPdfOperatorFallbackText(buffer))
  if (fallbackText) {
    return {
      adapter: 'document-pdf-text-extraction-v1',
      extractionMethod: 'PDF_OPERATOR_TEXT',
      ingestionMode: 'TEXT_NATIVE',
      text: fallbackText,
    }
  }

  try {
    return await extractPdfOcrText(buffer)
  } catch (err) {
    if (err?.message === PDF_OCR_NO_READABLE_TEXT_ERROR || err?.message === PDF_OCR_TIMEOUT_ERROR) {
      throw err
    }
  }

  throw new Error(PDF_NO_READABLE_TEXT_ERROR)
}

const inflateZipEntryData = ({ compressedData, compressionMethod }) => {
  if (compressionMethod === 0) return compressedData
  if (compressionMethod === 8) {
    try {
      return zlib.inflateRawSync(compressedData)
    } catch {
      return Buffer.alloc(0)
    }
  }
  return Buffer.alloc(0)
}

const readZipEntriesFromCentralDirectory = (buffer) => {
  const entries = []
  let offset = 0

  while (offset + 46 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x02014b50) {
      offset += 1
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const nextOffset = fileNameEnd + extraLength + commentLength

    if (
      fileNameEnd > buffer.length
      || nextOffset > buffer.length
      || compressedSize === 0
      || localHeaderOffset + 30 > buffer.length
      || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      offset = Math.max(offset + 4, nextOffset)
      continue
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) {
      offset = Math.max(offset + 4, nextOffset)
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })
    entries.push({ fileName, data })
    offset = nextOffset
  }

  return entries
}

const readZipEntries = (buffer) => {
  const centralDirectoryEntries = readZipEntriesFromCentralDirectory(buffer)
  if (centralDirectoryEntries.length > 0) return centralDirectoryEntries

  const entries = []
  let offset = 0

  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x04034b50) {
      offset += 1
      continue
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const fileNameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const fileNameStart = offset + 30
    const fileNameEnd = fileNameStart + fileNameLength
    const dataStart = fileNameEnd + extraLength
    const dataEnd = dataStart + compressedSize
    if (fileNameEnd > buffer.length || dataEnd > buffer.length || compressedSize === 0) {
      offset += 4
      continue
    }

    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString('utf8')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const data = inflateZipEntryData({ compressedData, compressionMethod })

    entries.push({ fileName, data })
    offset = dataEnd
  }

  return entries
}

const normalizeZipEntryName = (fileName = '') =>
  String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '')

const isAllowedPptxXmlEntry = (fileName = '') => {
  const normalized = normalizeZipEntryName(fileName)
  return normalized === '[Content_Types].xml'
    || normalized === 'ppt/presentation.xml'
    || /^ppt\/slides\/slide\d+\.xml$/i.test(normalized)
    || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(normalized)
    || /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(normalized)
}

const readBoundedZipEntryDescriptorsFromCentralDirectory = (buffer, {
  allowEntry = () => true,
  maxEntries = 1000,
  maxCompressedEntryBytes = 2_000_000,
  maxUncompressedEntryBytes = 2_000_000,
} = {}) => {
  const descriptors = []
  let totalEntries = 0
  let offset = 0

  while (offset + 46 < buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x02014b50) {
      offset += 1
      continue
    }

    totalEntries += 1
    if (totalEntries > maxEntries) {
      throw new Error(PPTX_ZIP_LIMIT_ERROR)
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const nextOffset = fileNameEnd + extraLength + commentLength

    if (fileNameEnd > buffer.length || nextOffset > buffer.length) {
      throw new Error(PPTX_MALFORMED_ERROR)
    }

    const fileName = normalizeZipEntryName(buffer.slice(fileNameStart, fileNameEnd).toString('utf8'))
    if (!allowEntry(fileName)) {
      offset = nextOffset
      continue
    }

    if (
      compressedSize === 0
      || compressedSize > maxCompressedEntryBytes
      || uncompressedSize > maxUncompressedEntryBytes
      || ![0, 8].includes(compressionMethod)
      || localHeaderOffset + 30 > buffer.length
      || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error(PPTX_ZIP_LIMIT_ERROR)
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) {
      throw new Error(PPTX_MALFORMED_ERROR)
    }

    descriptors.push({
      fileName,
      compressedData: buffer.slice(dataStart, dataEnd),
      compressionMethod,
      uncompressedSize,
    })
    offset = nextOffset
  }

  return descriptors
}

const inflateZipEntryDataAsync = async ({ compressedData, compressionMethod, uncompressedSize }) => {
  if (compressionMethod === 0) return compressedData
  if (compressionMethod !== 8) throw new Error(PPTX_ZIP_LIMIT_ERROR)

  const data = await inflateRaw(compressedData, {
    maxOutputLength: Math.min(
      Number(uncompressedSize) || DOCUMENT_ACQUISITION_LIMITS.maxPptxUncompressedEntryBytes,
      DOCUMENT_ACQUISITION_LIMITS.maxPptxUncompressedEntryBytes,
    ),
  })
  if (data.length > DOCUMENT_ACQUISITION_LIMITS.maxPptxUncompressedEntryBytes) {
    throw new Error(PPTX_ZIP_LIMIT_ERROR)
  }
  return data
}

const readPptxXmlEntries = async (buffer) => {
  const descriptors = readBoundedZipEntryDescriptorsFromCentralDirectory(buffer, {
    allowEntry: isAllowedPptxXmlEntry,
    maxEntries: DOCUMENT_ACQUISITION_LIMITS.maxPptxZipEntries,
    maxCompressedEntryBytes: DOCUMENT_ACQUISITION_LIMITS.maxPptxCompressedEntryBytes,
    maxUncompressedEntryBytes: DOCUMENT_ACQUISITION_LIMITS.maxPptxUncompressedEntryBytes,
  })

  if (descriptors.length === 0) {
    throw new Error(PPTX_MALFORMED_ERROR)
  }
  if (descriptors.length > DOCUMENT_ACQUISITION_LIMITS.maxPptxXmlEntries) {
    throw new Error(PPTX_ZIP_LIMIT_ERROR)
  }

  const entries = []
  let totalUncompressedBytes = 0
  for (const descriptor of descriptors) {
    const data = await inflateZipEntryDataAsync(descriptor)
    totalUncompressedBytes += data.length
    if (totalUncompressedBytes > DOCUMENT_ACQUISITION_LIMITS.maxPptxUncompressedBytes) {
      throw new Error(PPTX_ZIP_LIMIT_ERROR)
    }
    entries.push({ fileName: descriptor.fileName, data })
  }

  return entries
}

const stripXmlToText = (xml) => decodeHtmlEntities(String(xml || '')
  .replace(/<w:tab\s*\/>/gi, ' ')
  .replace(/<\/w:p>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))

const getXmlAttribute = (value, attributeName) => {
  const match = String(value || '').match(new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match ? decodeHtmlEntities(match[2]) : ''
}

const getPresentationXmlTextLines = (xml) => {
  const xmlText = String(xml || '')
    .replace(/<a:br\s*\/>/gi, '\n')
    .replace(/<\/a:p>/gi, '</a:p>\n')
  const paragraphMatches = xmlText.match(/<a:p\b[\s\S]*?<\/a:p>/gi) || [xmlText]

  return paragraphMatches
    .map((paragraph) => {
      const textRuns = [...paragraph.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi)]
        .map((match) => decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      return sanitizeFact(textRuns.join(' '))
    })
    .filter(Boolean)
}

const getPresentationRelationshipTargets = ({ baseFileName, relationshipXml, targetType }) => {
  const baseDirectory = path.posix.dirname(baseFileName)
  return [...String(relationshipXml || '').matchAll(/<Relationship\b([^>]*?)\/?>/gi)]
    .filter((match) => getXmlAttribute(match[1], 'Type').toLowerCase().endsWith(`/${targetType.toLowerCase()}`))
    .map((match) => getXmlAttribute(match[1], 'Target'))
    .filter(Boolean)
    .map((target) => path.posix.normalize(path.posix.join(baseDirectory, target)).replace(/^\/+/, ''))
}

const countPresentationRelationshipTargets = ({ relationshipXml, targetType }) =>
  getPresentationRelationshipTargets({
    baseFileName: 'ppt/slides/slide.xml',
    relationshipXml,
    targetType,
  }).length

const extractDocxText = (buffer) => {
  const entries = readZipEntries(buffer)
  const documentEntry = entries.find((entry) => entry.fileName === 'word/document.xml')
  if (!documentEntry?.data?.length) return ''
  return normalizeDocumentExtractionText(stripXmlToText(documentEntry.data.toString('utf8')))
}

const getPptxSlideNumber = (fileName = '') => {
  const match = String(fileName || '').match(/\/slide(\d+)\.xml$/i)
  return match ? Number(match[1]) : 0
}

const extractPowerPointTextWithoutTimeout = async (buffer) => {
  const entries = await readPptxXmlEntries(buffer)
  const entryByName = new Map(entries.map((entry) => [entry.fileName, entry]))
  if (!entryByName.has('[Content_Types].xml') || !entryByName.has('ppt/presentation.xml')) {
    throw new Error(PPTX_MALFORMED_ERROR)
  }
  const slideEntries = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.fileName))
    .sort((a, b) => getPptxSlideNumber(a.fileName) - getPptxSlideNumber(b.fileName))
  const slideCount = slideEntries.length
  const maxSlides = Math.min(slideCount, DOCUMENT_ACQUISITION_LIMITS.maxPptxSlides)
  const processedSlideEntries = slideEntries.slice(0, maxSlides)
  const extractedParts = []
  let slidesWithImages = 0
  let slidesWithCharts = 0
  let slidesPotentiallyMissingText = 0
  let speakerNotesIncluded = false

  if (slideCount === 0) {
    throw new Error(PPTX_MALFORMED_ERROR)
  }

  for (const slideEntry of processedSlideEntries) {
    const slideNumber = getPptxSlideNumber(slideEntry.fileName)
    const slideXml = slideEntry.data.toString('utf8')
    const slideTextLines = getPresentationXmlTextLines(slideXml)
    const relationshipFileName = slideEntry.fileName.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relationshipXml = entryByName.get(relationshipFileName)?.data?.toString('utf8') || ''
    const imageCount = countPresentationRelationshipTargets({ relationshipXml, targetType: 'image' })
    const chartCount = countPresentationRelationshipTargets({ relationshipXml, targetType: 'chart' })
    const notesTargets = getPresentationRelationshipTargets({
      baseFileName: slideEntry.fileName,
      relationshipXml,
      targetType: 'notesSlide',
    })
    const notesTextLines = notesTargets
      .flatMap((target) => getPresentationXmlTextLines(entryByName.get(target)?.data?.toString('utf8') || ''))
      .filter(Boolean)

    if (imageCount > 0) slidesWithImages += 1
    if (chartCount > 0) slidesWithCharts += 1
    if (notesTextLines.length > 0) speakerNotesIncluded = true
    if (slideTextLines.length === 0 && notesTextLines.length === 0 && (imageCount > 0 || chartCount > 0)) {
      slidesPotentiallyMissingText += 1
    }

    extractedParts.push(...slideTextLines.map((line) => `Slide ${slideNumber}: ${line}`))
    extractedParts.push(...notesTextLines.map((line) => `Slide ${slideNumber} speaker notes: ${line}`))
  }

  const text = getReadableDocumentExtractionText(extractedParts.join('\n'))
  if (!text) {
    throw new Error(PPTX_NO_READABLE_TEXT_ERROR)
  }

  return {
    adapter: 'document-pptx-openxml-text-extraction-v1',
    extractionMethod: 'PPTX_OPENXML_TEXT',
    ingestionMode: 'PRESENTATION_NATIVE_TEXT',
    slideCount,
    slideLimitReached: slideCount > maxSlides,
    slidesProcessed: maxSlides,
    slidesPotentiallyMissingText,
    slidesWithCharts,
    slidesWithImages,
    speakerNotesIncluded,
    text,
  }
}

const extractPowerPointText = async (buffer) => withTimeout({
  promise: extractPowerPointTextWithoutTimeout(buffer),
  timeoutMs: DOCUMENT_ACQUISITION_LIMITS.pptxTimeoutMs,
  timeoutMessage: PPTX_EXTRACTION_TIMEOUT_ERROR,
})

const buildAdditionalExtractionMetadata = (extraction = {}) => ({
  ...(Number.isFinite(Number(extraction.ocrPageCount)) ? { ocrPageCount: Number(extraction.ocrPageCount) } : {}),
  ...(Number.isFinite(Number(extraction.ocrPagesProcessed)) ? { ocrPagesProcessed: Number(extraction.ocrPagesProcessed) } : {}),
  ...(extraction.ocrPageLimitReached ? { ocrPageLimitReached: true } : {}),
  ...(Number.isFinite(Number(extraction.slideCount)) ? { slideCount: Number(extraction.slideCount) } : {}),
  ...(Number.isFinite(Number(extraction.slidesProcessed)) ? { slidesProcessed: Number(extraction.slidesProcessed) } : {}),
  ...(extraction.slideLimitReached ? { slideLimitReached: true } : {}),
  ...(Number.isFinite(Number(extraction.slidesWithImages)) ? { slidesWithImages: Number(extraction.slidesWithImages) } : {}),
  ...(Number.isFinite(Number(extraction.slidesWithCharts)) ? { slidesWithCharts: Number(extraction.slidesWithCharts) } : {}),
  ...(Number.isFinite(Number(extraction.slidesPotentiallyMissingText))
    ? { slidesPotentiallyMissingText: Number(extraction.slidesPotentiallyMissingText) }
    : {}),
  ...(extraction.speakerNotesIncluded ? { speakerNotesIncluded: true } : {}),
})

const extractDocumentText = async ({ buffer, documentType }) => {
  if (documentType === 'TXT') {
    return {
      adapter: 'document-txt-text-extraction-v1',
      extractionMethod: 'TEXT_NATIVE',
      ingestionMode: 'TEXT_NATIVE',
      text: normalizeDocumentExtractionText(buffer.toString('utf8')),
    }
  }
  if (documentType === 'PDF') return extractPdfText(buffer)
  if (documentType === 'PPTX') return extractPowerPointText(buffer)
  if (documentType === 'DOCX') {
    return {
      adapter: 'document-docx-text-extraction-v1',
      extractionMethod: 'DOCX_XML_TEXT',
      ingestionMode: 'TEXT_NATIVE',
      text: extractDocxText(buffer),
    }
  }
  return {
    adapter: '',
    extractionMethod: 'UNSUPPORTED',
    ingestionMode: 'UNSUPPORTED',
    text: '',
  }
}

const buildDocumentEvidenceObjects = ({
  acquisitionProfile,
  assetType,
  capturedAt,
  extraction,
  fileName,
  segments,
  sourceId,
} = {}) => segments
  .map((segment) => ({
    ...segment,
    text: getDocumentEvidenceSegmentQuality(segment?.text).text,
  }))
  .filter((segment) => isUsefulDocumentEvidenceSegment(segment?.text))
  .slice(0, DOCUMENT_ACQUISITION_LIMITS.maxEvidenceObjectsPerDocument)
  .map((segment) => {
    const classification = classifyDocumentSegment(segment)
    const extractedFact = sanitizeFact(`Document ${formatDocumentAssetLabel(assetType)}: ${segment.text}`)
    const extractionMethod = String(extraction?.extractionMethod || 'TEXT_NATIVE').trim()
    const isOcrExtraction = extractionMethod === 'PDF_OCR'
    const evidenceHash = hashValue({
      sourceId,
      extractedFact,
      acquisitionProfile,
    })

    return {
      evidenceObjectId: `evidence_document_${evidenceHash}`,
      sourceId,
      category: classification.category,
      coverageArea: classification.coverageArea,
      extractedFact,
      confidence: {
        level: 'SOURCE_BACKED',
        score: Number.isFinite(Number(extraction?.confidenceScore))
          ? Math.max(50, Math.min(74, Number(extraction.confidenceScore)))
          : isOcrExtraction ? 68 : 74,
        basis: [
          'UPLOADED_DOCUMENT',
          isOcrExtraction ? 'PDF_OCR_TEXT_EXTRACTION' : 'DETERMINISTIC_TEXT_EXTRACTION',
        ],
      },
      createdAt: capturedAt,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
      acquisitionMethod: 'DOCUMENT_INGESTION',
      extractionTimestamp: capturedAt,
      acceptedBy: '',
      acceptanceTimestamp: '',
      rejectedBy: '',
      rejectionTimestamp: '',
      auditRef: '',
      lineageRef: `lineage:${sourceId}:${evidenceHash}`,
      acquisitionProfile,
      sourceFileName: fileName,
      documentAssetType: assetType,
      extractionMethod,
      ingestionMode: extraction?.ingestionMode || 'TEXT_NATIVE',
    }
  })

const buildWebsiteEvidenceObjects = ({
  acquisitionProfile,
  acquiredAt,
  finalUrl,
  sourceId,
  segments,
} = {}) => {
  const profileLimits = getWebsiteAcquisitionProfileLimits(acquisitionProfile)
  return segments
    .slice(0, profileLimits.maxEvidenceObjects)
    .map((segment) => {
      const classification = classifyWebsiteSegment(segment)
      const extractedFact = sanitizeFact(`Website ${segment.kind}: ${segment.text}`)
      const evidenceHash = hashValue({
        sourceId,
        extractedFact,
        acquisitionProfile,
      })

      return {
        evidenceObjectId: `evidence_website_${evidenceHash}`,
        sourceId,
        category: classification.category,
        coverageArea: classification.coverageArea,
        extractedFact,
        confidence: {
          level: 'SOURCE_BACKED',
          score: 72,
          basis: ['WEBSITE_PAGE_ACQUIRED', 'DETERMINISTIC_TEXT_EXTRACTION'],
        },
        createdAt: acquiredAt,
        reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
        acquisitionMethod: 'WEBSITE_ACQUISITION',
        extractionTimestamp: acquiredAt,
        acceptedBy: '',
        acceptanceTimestamp: '',
        rejectedBy: '',
        rejectionTimestamp: '',
        auditRef: '',
        lineageRef: `lineage:${sourceId}:${evidenceHash}`,
        acquisitionProfile,
        sourceUrl: finalUrl,
      }
    })
}

export const acquireWebsiteDiscoveryEvidence = async ({
  acquisitionProfile,
  acquiredAt,
  websiteUrl,
} = {}) => {
  const normalizedUrl = normalizeDiscoveryWebsiteUrl(websiteUrl)

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Website acquisition is not available in this runtime.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEBSITE_ACQUISITION_LIMITS.timeoutMs)

  let response
  try {
    response = await fetchWebsiteWithGovernedRedirects({
      normalizedUrl,
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error(err?.message || 'Website acquisition could not fetch the requested website.')
  } finally {
    clearTimeout(timeout)
  }

  const finalUrl = response?.url || normalizedUrl
  assertWebsiteDomainBoundary({ requestedUrl: normalizedUrl, finalUrl })

  if (!response?.ok) {
    throw new Error(`Website acquisition failed with HTTP ${response?.status || 'error'}.`)
  }

  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
  if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
    throw new Error('Website acquisition only supports HTML or plain text pages in this sprint.')
  }

  const {
    characterLimit,
    charactersRead,
    text: html,
    truncated: contentTruncated,
  } = await readWebsiteResponseText(response, { signal: controller.signal })
  const segments = extractHtmlSegments(html, { acquisitionProfile })
  if (segments.length === 0) {
    throw new Error('Website acquisition did not find extractable customer website text.')
  }

  const sourceId = `website_${hashValue({ normalizedUrl })}`
  const evidenceObjects = buildWebsiteEvidenceObjects({
    acquisitionProfile,
    acquiredAt,
    finalUrl,
    sourceId,
    segments,
  })

  if (evidenceObjects.length === 0) {
    throw new Error('Website acquisition did not produce reviewable evidence.')
  }

  const source = {
    sourceId,
    type: 'WEBSITE_ACQUISITION',
    sourceType: 'WEBSITE',
    label: 'Website Source',
    url: normalizedUrl,
    finalUrl,
    valueHash: `sha256:${hashValue({ html })}`,
    status: 'ACQUIRED',
    capturedAt: acquiredAt,
    acquisitionProfile,
    evidenceProduced: evidenceObjects.length,
    lineageRef: `lineage:${sourceId}`,
    adapter: 'website-html-fetch-v1',
    pageCount: 1,
    contentTruncated,
    contentCharactersRead: charactersRead,
    contentCharacterLimit: characterLimit,
  }

  const sourceRegistryEntry = {
    sourceId,
    sourceType: 'WEBSITE',
    label: 'Website Source',
    status: 'AVAILABLE',
    dateAdded: acquiredAt,
    acquisitionStatus: 'ACQUIRED',
    evidenceProduced: evidenceObjects.length,
    lastAcquisitionAt: acquiredAt,
    lineageRef: `lineage:${sourceId}`,
    acquisitionProfile,
    url: normalizedUrl,
    finalUrl,
    contentTruncated,
    contentCharactersRead: charactersRead,
    contentCharacterLimit: characterLimit,
  }

  return {
    source,
    sourceRegistryEntry,
    evidenceObjects,
  }
}

export const ingestUploadedDocumentDiscoveryEvidence = async ({
  acquisitionProfile,
  capturedAt,
  documentSources = [],
} = {}) => {
  const candidateDocuments = Array.isArray(documentSources)
    ? documentSources.slice(0, DOCUMENT_ACQUISITION_LIMITS.maxDocuments)
    : []

  if (candidateDocuments.length === 0) {
    return {
      sources: [],
      sourceRegistry: [],
      evidenceObjects: [],
    }
  }

  const result = {
    sources: [],
    sourceRegistry: [],
    evidenceObjects: [],
  }

  for (const [index, documentSource] of candidateDocuments.entries()) {
    const fileName = normalizeDocumentFileName(documentSource?.fileName)
    const mimeType = String(documentSource?.mimeType || '').trim().toLowerCase().split(';')[0]
    const assetType = normalizeDocumentAssetType(documentSource?.assetType)
    const documentType = getDocumentType({ fileName, mimeType })
    const buffer = decodeDocumentBuffer(documentSource)
    const reportedSizeBytes = Number(documentSource?.sizeBytes || buffer.length)

    if (!fileName) {
      throw new Error('Uploaded document fileName is required.')
    }

    const unsupportedPowerPointMessage = getUnsupportedPowerPointMessage(fileName)
    if (unsupportedPowerPointMessage) {
      throw new Error(unsupportedPowerPointMessage)
    }

    if (!documentType) {
      throw new Error('Uploaded document must be PDF, PPTX, DOCX, or TXT.')
    }

    if (!buffer.length) {
      throw new Error(`Uploaded document ${fileName} has no readable content.`)
    }

    const maxFileBytes = getDocumentMaxFileBytes(documentType)
    if (reportedSizeBytes > maxFileBytes || buffer.length > maxFileBytes) {
      throw new Error(`Uploaded document ${fileName} exceeds the supported file size.`)
    }

    const extraction = await extractDocumentText({ buffer, documentType })
    const segments = extractDocumentSegments(extraction.text, {
      documentType,
      prioritizeQuality: extraction.extractionMethod === 'PDF_OCR',
    })

    if (segments.length === 0) {
      throw new Error(`Uploaded document ${fileName} did not produce reviewable evidence.`)
    }

    const documentHash = `sha256:${hashBuffer(buffer)}`
    const sourceId = `document_${hashValue({
      fileName,
      documentHash,
      index,
    })}`
    const evidenceObjects = buildDocumentEvidenceObjects({
      acquisitionProfile,
      assetType,
      capturedAt,
      extraction,
      fileName,
      segments,
      sourceId,
    })

    if (evidenceObjects.length === 0) {
      throw new Error(`Uploaded document ${fileName} did not produce reviewable evidence.`)
    }

    const label = `${formatDocumentAssetLabel(assetType)}: ${fileName}`
    const source = {
      sourceId,
      documentId: sourceId,
      type: 'UPLOADED_DOCUMENT',
      sourceType: 'UPLOADED_DOCUMENT',
      label,
      fileName,
      mimeType,
      documentType,
      assetType,
      sizeBytes: buffer.length,
      valueHash: documentHash,
      documentHash,
      documentStatus: 'PROCESSED',
      ingestionMode: extraction.ingestionMode || 'TEXT_NATIVE',
      extractionMethod: extraction.extractionMethod || 'TEXT_NATIVE',
      uploadedAt: capturedAt,
      status: 'ACQUIRED',
      capturedAt,
      acquisitionStatus: 'ACQUIRED',
      acquisitionProfile,
      evidenceProduced: evidenceObjects.length,
      evidenceObjectsGenerated: evidenceObjects.length,
      acceptedEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      pendingEvidenceObjects: evidenceObjects.length,
      lineageRef: `lineage:${sourceId}`,
      adapter: extraction.adapter || `document-${documentType.toLowerCase()}-text-extraction-v1`,
      ...buildAdditionalExtractionMetadata(extraction),
    }
    const sourceRegistryEntry = {
      sourceId,
      documentId: sourceId,
      sourceType: 'UPLOADED_DOCUMENT',
      label,
      status: 'AVAILABLE',
      dateAdded: capturedAt,
      acquisitionStatus: 'ACQUIRED',
      evidenceProduced: evidenceObjects.length,
      evidenceObjectsGenerated: evidenceObjects.length,
      acceptedEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      pendingEvidenceObjects: evidenceObjects.length,
      lastAcquisitionAt: capturedAt,
      lineageRef: `lineage:${sourceId}`,
      acquisitionProfile,
      fileName,
      mimeType,
      documentType,
      assetType,
      sizeBytes: buffer.length,
      documentHash,
      documentStatus: 'PROCESSED',
      ingestionMode: extraction.ingestionMode || 'TEXT_NATIVE',
      extractionMethod: extraction.extractionMethod || 'TEXT_NATIVE',
      uploadedAt: capturedAt,
      adapter: extraction.adapter || `document-${documentType.toLowerCase()}-text-extraction-v1`,
      ...buildAdditionalExtractionMetadata(extraction),
    }

    result.sources.push(source)
    result.sourceRegistry.push(sourceRegistryEntry)
    result.evidenceObjects.push(...evidenceObjects)
  }

  return result
}

const buildSourceRegistryEntryFromLineage = ({
  evidenceObjects,
  capturedAt,
  source,
}) => {
  const sourceId = String(source?.sourceId || '').trim()
  if (!sourceId) return null

  const fieldKey = String(source?.fieldKey || '').trim()
  const inputConfig = INPUT_EVIDENCE_MAP[fieldKey] || {}
  const sourceEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    evidenceObject.sourceId === sourceId,
  )
  const firstEvidenceObject = sourceEvidenceObjects[0] || {}

  return {
    sourceId,
    sourceType: inputConfig.sourceType || source.sourceType || source.type || 'DISCOVERY_NOTES',
    label: inputConfig.label || source.label || fieldKey || sourceId,
    status: 'AVAILABLE',
    dateAdded: source.capturedAt || capturedAt || '',
    acquisitionStatus: source.acquisitionStatus || (source.status === 'USER_PROVIDED' ? 'CAPTURED' : 'ACQUIRED'),
    evidenceProduced: Number(source.evidenceProduced || sourceEvidenceObjects.length),
    lastAcquisitionAt: source.capturedAt || capturedAt || '',
    lineageRef: firstEvidenceObject.lineageRef || `lineage:${sourceId}`,
    acquisitionProfile: source.acquisitionProfile || '',
    ...(fieldKey ? { fieldKey } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.finalUrl ? { finalUrl: source.finalUrl } : {}),
    ...(source.fileName ? { fileName: source.fileName } : {}),
    ...(source.mimeType ? { mimeType: source.mimeType } : {}),
    ...(source.documentType ? { documentType: source.documentType } : {}),
    ...(source.assetType ? { assetType: source.assetType } : {}),
    ...(Number.isFinite(Number(source.sizeBytes)) ? { sizeBytes: Number(source.sizeBytes) } : {}),
    ...(source.documentHash ? { documentHash: source.documentHash } : {}),
    ...(source.documentId ? { documentId: source.documentId } : {}),
    ...(source.documentStatus ? { documentStatus: source.documentStatus } : {}),
    ...(source.ingestionMode ? { ingestionMode: source.ingestionMode } : {}),
    ...(source.uploadedAt ? { uploadedAt: source.uploadedAt } : {}),
    ...(source.uploadedBy ? { uploadedBy: source.uploadedBy } : {}),
    ...(source.failureReason ? { failureReason: source.failureReason } : {}),
    ...(source.failureReasonCode ? { failureReasonCode: source.failureReasonCode } : {}),
    ...(Number.isFinite(Number(source.evidenceObjectsGenerated))
      ? { evidenceObjectsGenerated: Number(source.evidenceObjectsGenerated) }
      : {}),
    ...(Number.isFinite(Number(source.acceptedEvidenceObjects))
      ? { acceptedEvidenceObjects: Number(source.acceptedEvidenceObjects) }
      : {}),
    ...(Number.isFinite(Number(source.rejectedEvidenceObjects))
      ? { rejectedEvidenceObjects: Number(source.rejectedEvidenceObjects) }
      : {}),
    ...(Number.isFinite(Number(source.pendingEvidenceObjects))
      ? { pendingEvidenceObjects: Number(source.pendingEvidenceObjects) }
      : {}),
  }
}

export const buildDiscoveryEvidenceObjectsFromSources = ({
  acquisitionProfile,
  createdAt,
  inputs = {},
  sources = [],
} = {}) => sources
  .map((source) => {
    const fieldKey = String(source?.fieldKey || '').trim()
    const inputConfig = INPUT_EVIDENCE_MAP[fieldKey]
    const factValue = sanitizeFact(inputs?.[fieldKey])
    const sourceId = String(source?.sourceId || '').trim()

    if (!inputConfig || !factValue || !sourceId) return null

    const lineageHash = hashValue({
      sourceId,
      fieldKey,
      factValue,
      acquisitionProfile,
    })

    return {
      evidenceObjectId: `evidence_${fieldKey}_${lineageHash}`,
      sourceId,
      category: inputConfig.category,
      coverageArea: inputConfig.coverageArea,
      extractedFact: `${inputConfig.factPrefix}: ${factValue}`,
      confidence: {
        level: 'USER_PROVIDED',
        score: 65,
        basis: ['DETERMINISTIC_DISCOVERY_INPUT'],
      },
      createdAt,
      reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
      acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
      extractionTimestamp: createdAt,
      acceptedBy: '',
      acceptanceTimestamp: '',
      rejectedBy: '',
      rejectionTimestamp: '',
      auditRef: '',
      lineageRef: `lineage:${sourceId}:${lineageHash}`,
      acquisitionProfile,
    }
  })
  .filter(Boolean)

export const normalizeDiscoveryEvidenceObjects = ({
  acquisitionProfile,
  createdAt,
  evidenceObjects,
  inputs,
  sources,
} = {}) => {
  const candidateObjects = Array.isArray(evidenceObjects) && evidenceObjects.length > 0
    ? evidenceObjects
    : buildDiscoveryEvidenceObjectsFromSources({
        acquisitionProfile,
        createdAt,
        inputs,
        sources,
      })

  return candidateObjects
    .map((evidenceObject) => {
      const evidenceObjectId = String(evidenceObject?.evidenceObjectId || '').trim()
      const sourceId = String(evidenceObject?.sourceId || '').trim()
      const extractedFact = sanitizeFact(evidenceObject?.extractedFact)
      if (!evidenceObjectId || !sourceId || !extractedFact) return null

      const reviewStatus = normalizeReviewStatus(evidenceObject.reviewStatus)
      const acquisitionMethod = evidenceObject.acquisitionMethod || 'CUSTOMER_PROVIDED_INPUT'
      if (
        acquisitionMethod === 'WEBSITE_ACQUISITION'
        && !isGovernedDiscoveryEvidenceFact(extractedFact)
      ) {
        return null
      }

      const normalizedEvidenceObject = {
        evidenceObjectId,
        sourceId,
        category: evidenceObject.category || DISCOVERY_EVIDENCE_CATEGORIES.COMPANY,
        coverageArea: evidenceObject.coverageArea || evidenceObject.category || 'Company',
        extractedFact,
        confidence: isPlainObject(evidenceObject.confidence)
          ? evidenceObject.confidence
          : {
              level: String(evidenceObject.confidence || 'USER_PROVIDED'),
              score: 65,
              basis: ['DETERMINISTIC_DISCOVERY_INPUT'],
            },
        createdAt: evidenceObject.createdAt || createdAt || '',
        reviewStatus,
        acquisitionMethod,
        extractionTimestamp: evidenceObject.extractionTimestamp || evidenceObject.createdAt || createdAt || '',
        acceptedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
          ? toIdString(evidenceObject.acceptedBy)
          : '',
        acceptanceTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
          ? String(evidenceObject.acceptanceTimestamp || '')
          : '',
        rejectedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
          ? toIdString(evidenceObject.rejectedBy)
          : '',
        rejectionTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
          ? String(evidenceObject.rejectionTimestamp || '')
          : '',
        auditRef: String(evidenceObject.auditRef || ''),
        lineageRef: String(evidenceObject.lineageRef || `lineage:${sourceId}`),
        acquisitionProfile: evidenceObject.acquisitionProfile || acquisitionProfile || '',
        ...(evidenceObject.sourceUrl ? { sourceUrl: String(evidenceObject.sourceUrl).trim() } : {}),
        ...(evidenceObject.sourceFileName ? { sourceFileName: String(evidenceObject.sourceFileName).trim() } : {}),
        ...(evidenceObject.documentAssetType ? { documentAssetType: String(evidenceObject.documentAssetType).trim() } : {}),
      }
      return withGraphReadyEvidenceMetadata(normalizedEvidenceObject)
    })
    .filter(Boolean)
}

export const buildDiscoveryEvidenceReviewSummary = (evidenceObjects = []) => {
  const summary = {
    evidenceObjectCount: evidenceObjects.length,
    acceptedEvidenceCount: 0,
    pendingReviewCount: 0,
    rejectedEvidenceCount: 0,
  }

  evidenceObjects.forEach((evidenceObject) => {
    const reviewStatus = normalizeReviewStatus(evidenceObject?.reviewStatus)
    if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) {
      summary.acceptedEvidenceCount += 1
      return
    }
    if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) {
      summary.rejectedEvidenceCount += 1
      return
    }
    summary.pendingReviewCount += 1
  })

  return summary
}

export const buildDiscoverySourceRegistry = ({
  capturedAt,
  evidenceObjects = [],
  sourceRegistry,
  sources = [],
} = {}) => {
  const existingRegistry = Array.isArray(sourceRegistry) ? sourceRegistry : []
  const registry = existingRegistry.length > 0
    ? existingRegistry
    : sources
        .map((source) => buildSourceRegistryEntryFromLineage({
          evidenceObjects,
          capturedAt,
          source,
        }))
        .filter(Boolean)

  return registry.map((source) => {
    const sourceId = String(source?.sourceId || '').trim()
    const sourceEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
      evidenceObject?.sourceId === sourceId,
    )
    const reviewSummary = buildDiscoveryEvidenceReviewSummary(sourceEvidenceObjects)
    const evidenceProduced = Number(source?.evidenceProduced || sourceEvidenceObjects.length || 0)

    return {
      sourceId,
      sourceType: String(source?.sourceType || source?.type || 'DISCOVERY_NOTES').trim(),
      label: String(source?.label || sourceId || '').trim(),
      status: String(source?.status || 'AVAILABLE').trim().toUpperCase(),
      dateAdded: String(source?.dateAdded || source?.capturedAt || capturedAt || '').trim(),
      acquisitionStatus: String(source?.acquisitionStatus || 'CAPTURED').trim().toUpperCase(),
      evidenceProduced,
      lastAcquisitionAt: String(source?.lastAcquisitionAt || source?.dateAdded || capturedAt || '').trim(),
      lineageRef: String(source?.lineageRef || `lineage:${sourceId}`).trim(),
      acquisitionProfile: String(source?.acquisitionProfile || '').trim(),
      ...(source?.fieldKey ? { fieldKey: String(source.fieldKey).trim() } : {}),
      ...(source?.url ? { url: String(source.url).trim() } : {}),
      ...(source?.finalUrl ? { finalUrl: String(source.finalUrl).trim() } : {}),
      ...(source?.fileName ? { fileName: String(source.fileName).trim() } : {}),
      ...(source?.mimeType ? { mimeType: String(source.mimeType).trim() } : {}),
      ...(source?.documentType ? { documentType: String(source.documentType).trim() } : {}),
      ...(source?.assetType ? { assetType: String(source.assetType).trim() } : {}),
      ...(Number.isFinite(Number(source?.sizeBytes)) ? { sizeBytes: Number(source.sizeBytes) } : {}),
      ...(source?.documentHash ? { documentHash: String(source.documentHash).trim() } : {}),
      ...(source?.documentId ? { documentId: String(source.documentId).trim() } : {}),
      ...(source?.documentStatus ? { documentStatus: String(source.documentStatus).trim().toUpperCase() } : {}),
      ...(source?.ingestionMode ? { ingestionMode: String(source.ingestionMode).trim().toUpperCase() } : {}),
      ...(source?.uploadedAt ? { uploadedAt: String(source.uploadedAt).trim() } : {}),
      ...(source?.uploadedBy ? { uploadedBy: String(source.uploadedBy).trim() } : {}),
      ...(source?.failureReason ? { failureReason: String(source.failureReason).trim() } : {}),
      ...(source?.failureReasonCode ? { failureReasonCode: String(source.failureReasonCode).trim() } : {}),
      ...(source?.contentTruncated !== undefined ? { contentTruncated: Boolean(source.contentTruncated) } : {}),
      ...(Number.isFinite(Number(source?.contentCharactersRead)) ? { contentCharactersRead: Number(source.contentCharactersRead) } : {}),
      ...(Number.isFinite(Number(source?.contentCharacterLimit)) ? { contentCharacterLimit: Number(source.contentCharacterLimit) } : {}),
      evidenceObjectsGenerated: Number(source?.evidenceObjectsGenerated || evidenceProduced || 0),
      acceptedEvidenceObjects: reviewSummary.acceptedEvidenceCount,
      rejectedEvidenceObjects: reviewSummary.rejectedEvidenceCount,
      pendingEvidenceObjects: reviewSummary.pendingReviewCount,
    }
  }).filter((source) => source.sourceId)
}

export const applyDiscoveryEvidenceReview = ({
  actorUserId,
  evidenceObjectId,
  evidenceObjects = [],
  reviewStatus,
  reviewedAt,
} = {}) => {
  const normalizedEvidenceObjectId = String(evidenceObjectId || '').trim()
  const normalizedReviewStatus = normalizeReviewStatus(reviewStatus)
  let found = false

  const nextEvidenceObjects = evidenceObjects.map((evidenceObject) => {
    if (evidenceObject.evidenceObjectId !== normalizedEvidenceObjectId) return evidenceObject
    found = true

    return withGraphReadyEvidenceMetadata({
      ...evidenceObject,
      reviewStatus: normalizedReviewStatus,
      acceptedBy: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? toIdString(actorUserId)
        : '',
      acceptanceTimestamp: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? reviewedAt
        : '',
      rejectedBy: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? toIdString(actorUserId)
        : '',
      rejectionTimestamp: normalizedReviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? reviewedAt
        : '',
    })
  })

  return {
    found,
    evidenceObjects: nextEvidenceObjects,
  }
}

export const acceptPendingDiscoveryEvidenceObjects = ({
  acceptedAt,
  actorUserId,
  evidenceObjects = [],
} = {}) => evidenceObjects.map((evidenceObject) => {
  if (normalizeReviewStatus(evidenceObject?.reviewStatus) !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING) {
    return evidenceObject
  }

  return withGraphReadyEvidenceMetadata({
    ...evidenceObject,
    reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    acceptedBy: toIdString(actorUserId),
    acceptanceTimestamp: acceptedAt,
    rejectedBy: '',
    rejectionTimestamp: '',
  })
})

export const buildDiscoveryCoverageAreas = (evidenceObjects = []) => {
  const activeEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject.reviewStatus) !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
  )

  return DISCOVERY_COVERAGE_AREAS.map((area) => {
    const matchingObjects = activeEvidenceObjects.filter((evidenceObject) =>
      String(evidenceObject.coverageArea || '').trim() === area,
    )
    const acceptedCount = matchingObjects.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    ).length
    const pendingCount = matchingObjects.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
    ).length
    const evidenceCount = matchingObjects.length
    let state = 'MISSING'

    if (acceptedCount >= 2) {
      state = 'STRONG'
    } else if (acceptedCount >= 1) {
      state = 'ADEQUATE'
    } else if (evidenceCount >= 1 || pendingCount > 0) {
      state = 'WEAK'
    }

    return {
      area,
      state,
      evidenceCount,
      acceptedEvidenceCount: acceptedCount,
      pendingReviewCount: pendingCount,
    }
  })
}

const buildDiscoverySignalCandidates = ({
  evidenceObjects = [],
  sourceRegistry = [],
} = {}) => {
  const sourceTypeById = new Map(sourceRegistry.map((source) => [
    String(source?.sourceId || '').trim(),
    String(source?.sourceType || '').trim().toUpperCase(),
  ]))
  const activeEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject?.reviewStatus) !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
  )
  const groupedEvidence = activeEvidenceObjects.reduce((groups, evidenceObject) => {
    const domain = evidenceObject.graphReadyMetadata?.domain
      || getDiscoveryGraphDomain(evidenceObject.coverageArea || evidenceObject.category)
    if (!domain || domain === 'Unknown') return groups
    if (!groups.has(domain)) groups.set(domain, [])
    groups.get(domain).push(evidenceObject)
    return groups
  }, new Map())

  return Array.from(groupedEvidence.entries()).map(([domain, domainEvidence]) => {
    const acceptedCount = domainEvidence.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    ).length
    const pendingCount = domainEvidence.filter((evidenceObject) =>
      normalizeReviewStatus(evidenceObject.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
    ).length
    const sourceTypes = Array.from(new Set(domainEvidence
      .map((evidenceObject) => sourceTypeById.get(String(evidenceObject.sourceId || '').trim()) || '')
      .filter(Boolean)))
    const sourceDiversity = sourceTypes.length
    const signalStrength = acceptedCount >= 2 && sourceDiversity >= 2
      ? DISCOVERY_SIGNAL_STRENGTHS.STRONG
      : acceptedCount >= 1 || domainEvidence.length >= 2
        ? DISCOVERY_SIGNAL_STRENGTHS.MODERATE
        : DISCOVERY_SIGNAL_STRENGTHS.WEAK

    return {
      signalId: `signal_${hashValue({ domain, evidenceObjectIds: domainEvidence.map((item) => item.evidenceObjectId) })}`,
      domain,
      signalStrength,
      evidenceObjectCount: domainEvidence.length,
      acceptedEvidenceCount: acceptedCount,
      pendingReviewCount: pendingCount,
      sourceCount: new Set(domainEvidence.map((item) => item.sourceId).filter(Boolean)).size,
      sourceTypes,
      summary: `${domain} evidence is ${signalStrength.toLowerCase()} based on ${acceptedCount} accepted and ${pendingCount} pending evidence object${domainEvidence.length === 1 ? '' : 's'}.`,
      evidenceObjectIds: domainEvidence
        .slice(0, 8)
        .map((evidenceObject) => evidenceObject.evidenceObjectId)
        .filter(Boolean),
    }
  }).sort((left, right) =>
    right.acceptedEvidenceCount - left.acceptedEvidenceCount
    || right.evidenceObjectCount - left.evidenceObjectCount
    || left.domain.localeCompare(right.domain))
}

const hasNegatingEvidenceLanguage = (value) =>
  /\b(no|not|never|without|lacks?|missing|limited|unable|cannot|can't|does not|do not|isn't|aren't)\b/i
    .test(String(value || ''))

const buildDiscoveryContradictionCandidates = (evidenceObjects = []) => {
  const activeEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject?.reviewStatus) !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
  )
  const groupedEvidence = activeEvidenceObjects.reduce((groups, evidenceObject) => {
    const domain = evidenceObject.graphReadyMetadata?.domain
      || getDiscoveryGraphDomain(evidenceObject.coverageArea || evidenceObject.category)
    if (!domain || domain === 'Unknown') return groups
    if (!groups.has(domain)) groups.set(domain, [])
    groups.get(domain).push(evidenceObject)
    return groups
  }, new Map())
  const candidates = []

  groupedEvidence.forEach((domainEvidence, domain) => {
    const negatingEvidence = domainEvidence.filter((item) => hasNegatingEvidenceLanguage(item.extractedFact))
    if (negatingEvidence.length === 0) return
    const positiveEvidence = domainEvidence.filter((item) => !hasNegatingEvidenceLanguage(item.extractedFact))
    if (positiveEvidence.length === 0) return

    candidates.push({
      contradictionId: `contradiction_${hashValue({
        domain,
        negative: negatingEvidence[0].evidenceObjectId,
        positive: positiveEvidence[0].evidenceObjectId,
      })}`,
      domain,
      severity: negatingEvidence.length > 1 ? 'MEDIUM' : 'LOW',
      claimA: sanitizeFact(positiveEvidence[0].extractedFact).slice(0, 280),
      claimB: sanitizeFact(negatingEvidence[0].extractedFact).slice(0, 280),
      sourceRefs: Array.from(new Set([
        positiveEvidence[0].sourceId,
        negatingEvidence[0].sourceId,
      ].filter(Boolean))),
      evidenceObjectIds: [
        positiveEvidence[0].evidenceObjectId,
        negatingEvidence[0].evidenceObjectId,
      ].filter(Boolean),
      basis: 'Deterministic negation-language check across evidence in the same readiness domain.',
    })
  })

  return candidates.slice(0, 8)
}

const buildDiscoveryReadinessAssessment = ({
  contradictionCandidates = [],
  coverageAreas = [],
  evidenceObjects = [],
  evidenceReady = false,
  sourceRegistry = [],
} = {}) => {
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(evidenceObjects)
  const coveredAreaCount = coverageAreas.filter((area) => area.state !== 'MISSING').length
  const coveragePercent = coverageAreas.length > 0
    ? Math.round((coveredAreaCount / coverageAreas.length) * 100)
    : 0
  const sourceCount = sourceRegistry.length
  const blockerReasons = []

  if (!evidenceReady) blockerReasons.push('DISCOVERY_EVIDENCE_NOT_READY')
  if (reviewSummary.acceptedEvidenceCount === 0) blockerReasons.push('NO_ACCEPTED_EVIDENCE')
  if (coveragePercent < 40) blockerReasons.push('COVERAGE_BELOW_READINESS_THRESHOLD')
  if (contradictionCandidates.some((candidate) => candidate.reviewStatus !== 'NOT_CONTRADICTORY')) {
    blockerReasons.push('CONTRADICTIONS_REQUIRE_REVIEW')
  }

  const warningReasons = []
  if (reviewSummary.pendingReviewCount > 0) warningReasons.push('EVIDENCE_REVIEW_PENDING')
  if (sourceCount < 2) warningReasons.push('LIMITED_SOURCE_DIVERSITY')
  if (coverageAreas.some((area) => area.state === 'MISSING')) warningReasons.push('MISSING_COVERAGE_AREAS')

  const state = blockerReasons.length > 0
    ? DISCOVERY_READINESS_STATES.NOT_READY
    : warningReasons.length > 0 || coveragePercent < 70
      ? DISCOVERY_READINESS_STATES.PARTIALLY_READY
      : DISCOVERY_READINESS_STATES.READY

  return {
    state,
    coveragePercent,
    sourceCount,
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
    pendingReviewCount: reviewSummary.pendingReviewCount,
    rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
    contradictionCount: contradictionCandidates.length,
    unresolvedContradictionCount: contradictionCandidates.filter((candidate) => candidate.reviewStatus !== 'NOT_CONTRADICTORY').length,
    blockerReasons,
    warningReasons,
    assessedAt: '',
  }
}

export const buildDiscoveryHealth = ({
  acquisitionProfile,
  contradictionReviews = [],
  contradictionReviewEpoch = '',
  runtimeInstanceId = '',
  coverage,
  evidenceReady,
  evidenceObjects = [],
  lastAcquisitionDate,
  needsRefresh = false,
  sourceRegistry = [],
} = {}) => {
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(evidenceObjects)
  const coverageAreas = buildDiscoveryCoverageAreas(evidenceObjects)
  const coveredAreaCount = coverageAreas.filter((area) => area.state !== 'MISSING').length
  const coveragePercent = coverageAreas.length > 0
    ? Math.round((coveredAreaCount / coverageAreas.length) * 100)
    : 0
  const missingAreas = coverageAreas
    .filter((area) => area.state === 'MISSING')
    .map((area) => area.area)
  const signalCandidates = buildDiscoverySignalCandidates({ evidenceObjects, sourceRegistry })
  const contradictionCandidates = buildDiscoveryContradictionCandidates(evidenceObjects).map((candidate) => ({
    ...candidate,
    reviewStatus: getDiscoveryContradictionReview(candidate, evidenceObjects, contradictionReviews, runtimeInstanceId, contradictionReviewEpoch).reviewStatus,
  }))
  const normalizedNeedsRefresh = needsRefresh === true
  const normalizedEvidenceReady = normalizedNeedsRefresh
    ? false
    : typeof evidenceReady === 'boolean'
      ? evidenceReady
      : coverage?.status !== 'INPUT_REQUIRED'
  const readiness = buildDiscoveryReadinessAssessment({
    contradictionCandidates,
    coverageAreas,
    evidenceObjects,
    evidenceReady: normalizedEvidenceReady,
    sourceRegistry,
  })

  return {
    coveragePercent,
    confidence: coverage?.confidence?.level || coverage?.confidenceLevel || 'USER_PROVIDED',
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
    pendingReviewCount: reviewSummary.pendingReviewCount,
    rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
    sourceCount: sourceRegistry.length,
    missingAreas,
    acquisitionProfile: normalizeAcquisitionProfile(acquisitionProfile),
    lastAcquisitionDate: lastAcquisitionDate || '',
    coverageAreas,
    signalCandidates,
    contradictionCandidates,
    readiness: {
      ...readiness,
      assessedAt: lastAcquisitionDate || '',
    },
  }
}

const hasSourceType = (sourceRegistry = [], sourceType) =>
  sourceRegistry.some((source) =>
    String(source?.sourceType || '').trim().toUpperCase() === sourceType)

const hasEvidenceDomain = (coverageAreas = [], domain) =>
  coverageAreas.some((area) =>
    String(area?.area || '').trim().toLowerCase() === String(domain || '').trim().toLowerCase()
    && String(area?.state || '').trim().toUpperCase() !== 'MISSING')

const buildMissingRecommendedInputs = ({
  coverageAreas = [],
  inputs = {},
  profile,
  sourceRegistry = [],
} = {}) => {
  const missingInputs = []
  const hasWebsite = Boolean(String(inputs.companyWebsite || '').trim()) || hasSourceType(sourceRegistry, 'WEBSITE')
  const hasCompanyName = Boolean(String(inputs.companyName || '').trim())
  const hasProductOffer = Boolean(String(inputs.targetOffer || '').trim()) || hasEvidenceDomain(coverageAreas, 'Products')
  const hasNotesOrDocument = Boolean(String(inputs.notes || '').trim()) || hasSourceType(sourceRegistry, 'UPLOADED_DOCUMENT')

  if (!hasWebsite) missingInputs.push('Website URL')
  if (!hasCompanyName) missingInputs.push('Company name')
  if (!hasProductOffer) missingInputs.push('Product / offer')
  if (!hasNotesOrDocument) missingInputs.push('Notes or document')

  if (profile === DISCOVERY_ACQUISITION_PROFILES.ENHANCED) {
    if (!hasEvidenceDomain(coverageAreas, 'Proof')) missingInputs.push('Customer proof')
    if (!hasSourceType(sourceRegistry, 'UPLOADED_DOCUMENT')) missingInputs.push('Sales deck or product material')
  }

  if (profile === DISCOVERY_ACQUISITION_PROFILES.STRATEGIC) {
    if (!hasEvidenceDomain(coverageAreas, 'Market') && !hasEvidenceDomain(coverageAreas, 'Markets')) {
      missingInputs.push('Market evidence')
    }
    if (!hasEvidenceDomain(coverageAreas, 'Differentiation')) missingInputs.push('Competitor evidence')
    if (!hasEvidenceDomain(coverageAreas, 'Economics')) missingInputs.push('Economic or ROI evidence')
    if (!hasEvidenceDomain(coverageAreas, 'Proof')) missingInputs.push('Customer proof')
  }

  return uniqueStrings(missingInputs)
}

const getAcquisitionQualityLabel = ({
  blockerReasons = [],
  confidenceLevel,
  coveragePercent,
  evidenceObjectCount,
  readinessState,
} = {}) => {
  const normalizedReadiness = String(readinessState || '').trim().toUpperCase()
  const normalizedConfidence = String(confidenceLevel || '').trim().toUpperCase()
  if (evidenceObjectCount <= 0) return 'Not Started'
  if (
    normalizedReadiness === DISCOVERY_READINESS_STATES.NOT_READY
    && Array.isArray(blockerReasons)
    && blockerReasons.includes('DISCOVERY_EVIDENCE_NOT_READY')
  ) {
    return 'Needs Refresh'
  }
  if (normalizedReadiness === DISCOVERY_READINESS_STATES.READY && coveragePercent >= 80) return 'Strong'
  if (coveragePercent >= 60 && ['SOURCE_BACKED', 'HIGH', 'MEDIUM_HIGH'].includes(normalizedConfidence)) return 'Good'
  if (coveragePercent >= 40) return 'Developing'
  return 'Limited'
}

const getRecommendedNextInput = ({
  missingRecommendedInputs = [],
  missingAreas = [],
} = {}) => {
  const nextInput = missingRecommendedInputs[0] || missingAreas[0] || ''
  return nextInput ? `Add ${nextInput}.` : 'No immediate input gap is projected.'
}

export const buildDiscoveryAcquisitionEffectiveness = ({
  acquisitionProfile,
  discoveryHealth = {},
  evidenceObjects = [],
  inputs = {},
  sourceRegistry = [],
} = {}) => {
  const profile = normalizeAcquisitionProfile(acquisitionProfile)
  const guidance = DISCOVERY_PROFILE_GUIDANCE[profile] || DISCOVERY_PROFILE_GUIDANCE[DISCOVERY_ACQUISITION_PROFILES.STANDARD]
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(evidenceObjects)
  const coverageAreas = Array.isArray(discoveryHealth.coverageAreas)
    ? discoveryHealth.coverageAreas
    : buildDiscoveryCoverageAreas(evidenceObjects)
  const coveragePercent = Number.isFinite(Number(discoveryHealth.coveragePercent))
    ? Number(discoveryHealth.coveragePercent)
    : 0
  const readiness = discoveryHealth.readiness && typeof discoveryHealth.readiness === 'object' && !Array.isArray(discoveryHealth.readiness)
    ? discoveryHealth.readiness
    : {}
  const signalCandidates = Array.isArray(discoveryHealth.signalCandidates)
    ? discoveryHealth.signalCandidates
    : []
  const contradictionCandidates = Array.isArray(discoveryHealth.contradictionCandidates)
    ? discoveryHealth.contradictionCandidates
    : []
  const missingDomains = Array.isArray(discoveryHealth.missingAreas)
    ? discoveryHealth.missingAreas.map((area) => String(area || '').trim()).filter(Boolean)
    : coverageAreas
        .filter((area) => String(area?.state || '').trim().toUpperCase() === 'MISSING')
        .map((area) => String(area?.area || '').trim())
        .filter(Boolean)
  const missingRecommendedInputs = buildMissingRecommendedInputs({
    coverageAreas,
    inputs,
    profile,
    sourceRegistry,
  })
  const confidenceLevel = String(discoveryHealth.confidence || 'UNKNOWN').trim().toUpperCase()
  const sourceTypes = uniqueStrings(sourceRegistry.map((source) => source?.sourceType))
  const readinessState = String(readiness.state || '').trim().toUpperCase()
  const qualityLabel = getAcquisitionQualityLabel({
    blockerReasons: readiness.blockerReasons,
    confidenceLevel,
    coveragePercent,
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    readinessState,
  })

  return {
    profile,
    label: guidance.label,
    summary: guidance.summary,
    qualityLabel,
    recommendedInputs: uniqueStrings([
      ...guidance.minimumRecommendedInputs,
      ...guidance.additionalUsefulInputs,
    ]),
    minimumRecommendedInputs: [...guidance.minimumRecommendedInputs],
    additionalUsefulInputs: [...guidance.additionalUsefulInputs],
    missingRecommendedInputs,
    recommendedNextInput: getRecommendedNextInput({
      missingAreas: missingDomains,
      missingRecommendedInputs,
    }),
    targetCoverageRange: { ...guidance.targetCoverageRange },
    targetEvidenceObjectRange: { ...guidance.targetEvidenceObjectRange },
    metrics: {
      sourceCount: sourceRegistry.length,
      sourceTypes,
      sourceDiversity: sourceTypes.length,
      evidenceObjectCount: reviewSummary.evidenceObjectCount,
      acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
      pendingReviewCount: reviewSummary.pendingReviewCount,
      rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
      coveragePercent,
      confidence: confidenceLevel,
      readinessState,
      missingDomainCount: missingDomains.length,
      signalCount: signalCandidates.length,
      strongSignalCount: signalCandidates.filter((signal) =>
        String(signal?.signalStrength || '').trim().toUpperCase() === DISCOVERY_SIGNAL_STRENGTHS.STRONG).length,
      contradictionCount: contradictionCandidates.length,
    },
    missingDomains,
  }
}

export const buildAcceptedDiscoveryScopedViews = ({
  acquisitionProfile,
  evidenceObjects = [],
  inputHash = '',
  previousScopedViews = {},
  refreshedAt = '',
} = {}) => {
  const acceptedEvidenceObjects = evidenceObjects.filter((evidenceObject) =>
    normalizeReviewStatus(evidenceObject?.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
  )
  const sourceRefs = Array.from(new Set(acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject.sourceId || '').trim())
    .filter(Boolean)))
  const evidenceObjectIds = acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject.evidenceObjectId || '').trim())
    .filter(Boolean)
  const evidenceFacts = acceptedEvidenceObjects.map((evidenceObject) => ({
    evidenceObjectId: String(evidenceObject.evidenceObjectId || '').trim(),
    sourceId: String(evidenceObject.sourceId || '').trim(),
    category: String(evidenceObject.category || '').trim(),
    coverageArea: String(evidenceObject.coverageArea || '').trim(),
    extractedFact: sanitizeFact(evidenceObject.extractedFact),
  })).filter((fact) => fact.evidenceObjectId && fact.extractedFact)
  const summaryFacts = evidenceFacts.slice(0, 6).map((fact) => fact.extractedFact)
  const summary = summaryFacts.length > 0
    ? summaryFacts.join(' ')
    : 'Accepted Intelligence Hub evidence is available for this section.'
  const scopedViews = isPlainObject(previousScopedViews) ? previousScopedViews : {}

  return Object.keys(scopedViews).reduce((views, sectionKey) => {
    const previousScopedView = scopedViews[sectionKey]
    const projection = buildSectionEvidenceProjection({
      evidenceObjects: acceptedEvidenceObjects,
      maxItems: null,
      sectionKey,
    })
    const {
      selectedEvidenceObjects,
      ...projectionReceipt
    } = projection
    const scopedEvidenceObjects = projection.knownSection
      ? selectedEvidenceObjects
      : acceptedEvidenceObjects
    views[sectionKey] = {
      ...(isPlainObject(previousScopedView) ? previousScopedView : {}),
      source: 'DISCOVERY_EVIDENCE_OBJECTS',
      summary: scopedEvidenceObjects.length > 0
        ? scopedEvidenceObjects
          .slice(0, 6)
          .map((evidenceObject) => sanitizeFact(evidenceObject.extractedFact))
          .filter(Boolean)
          .join(' ')
        : projection.knownSection ? '' : summary,
      reviewStatus: 'ACCEPTED_ONLY',
      evidenceKeys: ['evidenceObjects.accepted'],
      sourceRefs: Array.from(new Set(scopedEvidenceObjects
        .map((evidenceObject) => String(evidenceObject.sourceId || '').trim())
        .filter(Boolean))),
      evidenceObjectIds: scopedEvidenceObjects
        .map((evidenceObject) => String(evidenceObject.evidenceObjectId || '').trim())
        .filter(Boolean),
      evidenceFacts: scopedEvidenceObjects.map((evidenceObject) => ({
        evidenceObjectId: String(evidenceObject.evidenceObjectId || '').trim(),
        sourceId: String(evidenceObject.sourceId || '').trim(),
        category: String(evidenceObject.category || '').trim(),
        coverageArea: String(evidenceObject.coverageArea || '').trim(),
        extractedFact: sanitizeFact(evidenceObject.extractedFact),
      })).filter((fact) => fact.evidenceObjectId && fact.extractedFact),
      refreshedAt,
      acquisitionProfile,
      evidenceHash: `sha256:${hashValue({
        sectionKey,
        inputHash,
        sourceRefs: scopedEvidenceObjects.map((evidenceObject) => evidenceObject.sourceId),
        evidenceObjectIds: scopedEvidenceObjects.map((evidenceObject) => evidenceObject.evidenceObjectId),
        acquisitionProfile,
      })}`,
      evidenceProjection: projectionReceipt,
    }
    return views
  }, {})
}

export const summarizeDiscoveryIntelligence = ({
  acquisitionProfile,
  coverage,
  evidenceObjects,
  lastAcquisitionDate,
  sourceRegistry,
} = {}) => ({
  reviewSummary: buildDiscoveryEvidenceReviewSummary(evidenceObjects),
  discoveryHealth: buildDiscoveryHealth({
    acquisitionProfile,
    coverage,
    evidenceObjects,
    lastAcquisitionDate,
    sourceRegistry,
  }),
})
