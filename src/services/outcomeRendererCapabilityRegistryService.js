import { OUTCOME_STUDIO_EXPORT_FORMATS } from '../constants/runtimeOutcomeStudio.js'
import env from '../config/env.js'
import { PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE } from './professionalDocumentCandidateRenderer.js'

export const OUTCOME_RENDERER_CAPABILITY_REGISTRY_VERSION = 'oes-004-renderer-capabilities.compatibility-v1'

export const OUTCOME_RENDERER_ENGINEERING_CANDIDATES = Object.freeze([
  Object.freeze({
    capabilityKey: 'outcome-professional-document-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'PROFESSIONAL_DOCUMENT',
    sourceModelVersions: Object.freeze(['outcome-customer-content.v1']),
    supportedBlockTypes: Object.freeze(['MARKDOWN', 'HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT']),
    engine: Object.freeze({
      key: 'DOCX_JS_IN_PROCESS_ENGINEERING_CANDIDATE',
      version: 'docx@9.7.1',
      buildFingerprint: 'professional-document-candidate:docx-js:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['professional-document-candidate.v0.1']),
      styles: Object.freeze(['executive-document-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-system-candidate-not-packaged']),
      validation: Object.freeze(['professional-document-candidate-package.v0.1']),
      productReferences: Object.freeze(['COR-005-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: OUTCOME_STUDIO_EXPORT_FORMATS.DOCX,
      label: 'DOCX engineering candidate',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-pdf-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'PROFESSIONAL_DOCUMENT',
    sourceModelVersions: Object.freeze(['outcome-customer-content.v1']),
    supportedBlockTypes: Object.freeze(['MARKDOWN', 'HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT']),
    engine: Object.freeze({
      key: 'PDFKIT_IN_PROCESS_ENGINEERING_CANDIDATE',
      version: 'pdfkit@0.19.1',
      buildFingerprint: 'professional-pdf-candidate:pdfkit:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['professional-pdf-candidate.v0.1']),
      styles: Object.freeze(['executive-document-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['PDF-base-fonts-candidate']),
      validation: Object.freeze(['professional-pdf-candidate-package.v0.1']),
      productReferences: Object.freeze(['COR-005-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: OUTCOME_STUDIO_EXPORT_FORMATS.PDF,
      label: 'PDF engineering candidate',
      mimeType: 'application/pdf',
      extension: 'pdf',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-presentation-pptx-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'PRESENTATION',
    sourceModelVersions: Object.freeze(['governed-deliverable.v1']),
    supportedBlockTypes: Object.freeze([
      'PRESENTATION_SLIDE',
      'METRIC',
      'CHART',
      'PROCESS',
      'RISK_MATRIX',
      'SCORECARD',
      'SPEAKER_NOTES',
    ]),
    engine: Object.freeze({
      key: 'PPTXGENJS_IN_PROCESS_ENGINEERING_CANDIDATE',
      version: 'pptxgenjs@4.0.1',
      buildFingerprint: 'professional-presentation-candidate:pptxgenjs:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['executive-presentation-neutral.v0.1']),
      styles: Object.freeze(['executive-presentation-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-system-candidate-not-packaged']),
      validation: Object.freeze(['professional-presentation-candidate-package.v0.1']),
      productReferences: Object.freeze(['COR-006-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: 'PPTX',
      label: 'PPTX engineering candidate',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-presentation-pdf-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'PRESENTATION',
    sourceModelVersions: Object.freeze(['governed-deliverable.v1']),
    supportedBlockTypes: Object.freeze([
      'PRESENTATION_SLIDE',
      'METRIC',
      'CHART',
      'PROCESS',
      'RISK_MATRIX',
      'SCORECARD',
      'SPEAKER_NOTES',
    ]),
    engine: Object.freeze({
      key: 'PLAYWRIGHT_CORE_CHROMIUM_IN_PROCESS_ENGINEERING_CANDIDATE',
      version: 'playwright-core@1.61.1',
      chromiumRevision: '1223',
      chromiumProductVersion: '148.0.7778.96',
      executableBytes: 4_011_008,
      installationFingerprint: '57f8172866f6ad4eff4c9592e0165b6f27c434b740c816ccf34d8597d53dcfdc',
      launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
      buildFingerprint: 'professional-presentation-pdf-candidate:playwright-core:chromium-1223:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['executive-presentation-neutral.v0.1']),
      styles: Object.freeze(['executive-presentation-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-system-candidate-not-packaged']),
      validation: Object.freeze(['professional-presentation-pdf-candidate-package.v0.1']),
      productReferences: Object.freeze(['COR-006-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: OUTCOME_STUDIO_EXPORT_FORMATS.PDF,
      label: 'Presentation PDF engineering candidate',
      mimeType: 'application/pdf',
      extension: 'pdf',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-infographic-svg-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'INFOGRAPHIC',
    sourceModelVersions: Object.freeze(['governed-deliverable.v1']),
    supportedBlockTypes: Object.freeze([
      'INFOGRAPHIC_SECTION',
      'METRIC',
      'PROCESS',
      'OUTCOME_TABLE',
      'ROADMAP',
      'RISK_REGISTER',
      'DECISION_CONDITIONS',
    ]),
    engine: Object.freeze({
      key: 'INTERNAL_DETERMINISTIC_SVG_COMPILER_ENGINEERING_CANDIDATE',
      version: '0.1.0',
      xmlParser: 'saxes@6.0.0',
      buildFingerprint: 'professional-infographic-svg-candidate:internal-svg:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['executive-decision-infographic-neutral.v0.1']),
      styles: Object.freeze(['executive-infographic-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-system-candidate-not-packaged']),
      validation: Object.freeze(['professional-infographic-svg-candidate.v0.1']),
      productReferences: Object.freeze(['COR-007-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      accessibility: 'MANUAL_CERTIFICATION_OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: 'SVG',
      label: 'SVG engineering candidate',
      mimeType: 'image/svg+xml',
      extension: 'svg',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-infographic-png-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'INFOGRAPHIC',
    sourceModelVersions: Object.freeze(['governed-deliverable.v1']),
    supportedBlockTypes: Object.freeze([
      'INFOGRAPHIC_SECTION',
      'METRIC',
      'PROCESS',
      'OUTCOME_TABLE',
      'ROADMAP',
      'RISK_REGISTER',
      'DECISION_CONDITIONS',
    ]),
    engine: Object.freeze({
      key: 'NAPI_RS_CANVAS_SVG_RASTER_ENGINEERING_CANDIDATE',
      version: '@napi-rs/canvas@1.0.0',
      canvasPackageIntegrity: 'sha512-Jqxcy1XOIqj+lH9sl1GT+il6GR3uQv13vI2mrwubP3uT8Olak2ClDrK2RnxlQKjwv8BRr4b3ug0YR7c6hBX8wg==',
      platform: 'win32',
      architecture: 'x64',
      nativePackage: '@napi-rs/canvas-win32-x64-msvc',
      nativePackageVersion: '1.0.0',
      nativePackageIntegrity: 'sha512-qwdhh9N6Gge/hC4pL9S1tQp0iKwhSl/dYjg7+RGp9k26iRGRi5MqqUyKGOXIWli0zOcuy5Y2wIH/jk2ry6i/jA==',
      nativeBinaryName: 'skia.win32-x64-msvc.node',
      nativeBinaryBytes: 27_246_592,
      nativeBinarySha256: 'f65bfb4c598dec157414a1435f74a71fbaba8f3406b0446f20f2df8a4fe618e4',
      buildFingerprint: 'professional-infographic-png-candidate:napi-rs-canvas-win32-x64-msvc:1.0.0:0.1.0',
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['executive-decision-infographic-neutral.v0.1']),
      styles: Object.freeze(['executive-infographic-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-system-candidate-not-packaged']),
      validation: Object.freeze(['professional-infographic-png-candidate.v0.1']),
      productReferences: Object.freeze(['COR-007-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      accessibility: 'RASTER_ALT_TEXT_REQUIRED',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: 'PNG',
      label: 'Infographic PNG engineering candidate',
      mimeType: 'image/png',
      extension: 'png',
    })]),
  }),
  Object.freeze({
    capabilityKey: 'outcome-professional-infographic-pdf-engineering-candidate',
    capabilityVersion: '0.1.0',
    lifecycleStatus: 'ENGINEERING_CANDIDATE',
    rolloutScopes: Object.freeze([]),
    deliverableFamily: 'INFOGRAPHIC',
    sourceModelVersions: Object.freeze(['governed-deliverable.v1']),
    supportedBlockTypes: Object.freeze([
      'INFOGRAPHIC_SECTION',
      'METRIC',
      'PROCESS',
      'OUTCOME_TABLE',
      'ROADMAP',
      'RISK_REGISTER',
      'DECISION_CONDITIONS',
    ]),
    engine: Object.freeze({
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
    }),
    profileReferences: Object.freeze({
      templates: Object.freeze(['executive-decision-infographic-neutral.v0.1']),
      styles: Object.freeze(['executive-infographic-neutral.v0.1']),
      brands: Object.freeze([]),
      fonts: Object.freeze(['Arial-chromium-candidate-not-packaged']),
      validation: Object.freeze(['professional-infographic-pdf-candidate.v0.1']),
      productReferences: Object.freeze(['COR-007-v1.1-NOT-APPROVED']),
    }),
    review: Object.freeze({
      security: 'ENGINEERING_REVIEW_ONLY',
      licensing: 'OPEN',
      accessibility: 'MARKED_CONTAINER_ONLY_ACCESSIBILITY_OPEN',
      architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
      productReference: 'CANDIDATE_NOT_APPROVED',
    }),
    fallbackRule: 'FAIL_CLOSED',
    formats: Object.freeze([Object.freeze({
      format: OUTCOME_STUDIO_EXPORT_FORMATS.PDF,
      label: 'Infographic PDF engineering candidate',
      mimeType: 'application/pdf',
      extension: 'pdf',
    })]),
  }),
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()

const FORMAT_DEFINITIONS = Object.freeze([
  Object.freeze({
    format: OUTCOME_STUDIO_EXPORT_FORMATS.MARKDOWN,
    label: 'Markdown',
    mimeType: 'text/markdown',
    extension: 'md',
  }),
  Object.freeze({
    format: OUTCOME_STUDIO_EXPORT_FORMATS.JSON,
    label: 'JSON',
    mimeType: 'application/json',
    extension: 'json',
  }),
  Object.freeze({
    format: OUTCOME_STUDIO_EXPORT_FORMATS.DOCX,
    label: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  }),
  Object.freeze({
    format: OUTCOME_STUDIO_EXPORT_FORMATS.PDF,
    label: 'PDF',
    mimeType: 'application/pdf',
    extension: 'pdf',
  }),
])

const COMPATIBILITY_CAPABILITY = Object.freeze({
  capabilityKey: 'outcome-studio-current-document-export',
  capabilityVersion: '1.0.0',
  lifecycleStatus: 'ACTIVE',
  rolloutScopes: Object.freeze(['OUTCOME']),
  deliverableFamily: 'GOVERNED_BUSINESS_DOCUMENT',
  sourceModelVersions: Object.freeze(['outcome-customer-content.v1']),
  supportedBlockTypes: Object.freeze(['MARKDOWN', 'SECTION']),
  engine: Object.freeze({
    key: 'OUTPUT_SERVICE_IN_PROCESS_COMPATIBILITY',
    version: '1',
    buildFingerprint: 'output-service:markdown-json-docx-pdf:compatibility-v1',
  }),
  profileReferences: Object.freeze({
    templates: Object.freeze([]),
    styles: Object.freeze([]),
    brands: Object.freeze([]),
    fonts: Object.freeze([]),
    validation: Object.freeze(['outcome-post-validation.v1']),
  }),
  limits: Object.freeze({
    maxSourceBytes: null,
    maxOutputBytes: null,
    maxPages: null,
    maxSlides: null,
    maxWidth: null,
    maxHeight: null,
    maxRenderTimeMs: null,
    maxMemoryBytes: null,
    retries: 0,
  }),
  review: Object.freeze({
    security: 'EXISTING_BASELINE_ONLY',
    licensing: 'NO_NEW_DEPENDENCY',
    architecture: 'OPEN_FOR_FINAL_SCHEMA_AND_NEW_RENDERERS',
    productReference: 'NOT_ASSESSED',
  }),
  fallbackRule: 'FAIL_CLOSED',
  formats: FORMAT_DEFINITIONS,
})

const PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY = Object.freeze({
  capabilityKey: 'outcome-professional-document-dev-test',
  capabilityVersion: '1.0.0-test',
  lifecycleStatus: 'ACTIVE_DEVELOPMENT_TEST',
  rolloutScopes: Object.freeze(['OUTCOME', 'EXECUTIVE_BRIEF']),
  deliverableFamily: 'PROFESSIONAL_DOCUMENT',
  sourceModelVersions: Object.freeze(['outcome-customer-content.v1']),
  supportedBlockTypes: Object.freeze(['MARKDOWN', 'HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT']),
  engine: Object.freeze({
    key: 'DOCX_JS_IN_PROCESS_DEVELOPMENT_TEST',
    version: 'docx@9.7.1',
    buildFingerprint: 'professional-document:docx-js:development-test:1.0.0',
  }),
  profileReferences: Object.freeze({
    templates: Object.freeze(['professional-document-candidate.v0.1']),
    styles: Object.freeze(['executive-document-neutral.v0.1']),
    brands: Object.freeze([]),
    fonts: Object.freeze(['Arial-system-development-test']),
    validation: Object.freeze(['professional-document-candidate-package.v0.1']),
    productReferences: Object.freeze(['COR-005-v1.1-APPROVED-TEST-REFERENCE']),
  }),
  limits: PROFESSIONAL_DOCUMENT_CANDIDATE_PROFILE.limits,
  review: Object.freeze({
    security: 'DEVELOPMENT_TEST_ADOPTION',
    licensing: 'OPEN',
    architecture: 'DEVELOPMENT_TEST_IN_PROCESS_ADOPTION',
    productReference: 'PRODUCT_APPROVED_TEST_REFERENCE',
  }),
  fallbackRule: 'FAIL_CLOSED',
  formats: Object.freeze([Object.freeze({
    format: OUTCOME_STUDIO_EXPORT_FORMATS.DOCX,
    label: 'Professional DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  })]),
})

const cloneFormat = (format) => ({ ...format })

const projectCapability = () => ({
  ...COMPATIBILITY_CAPABILITY,
  rolloutScopes: [...COMPATIBILITY_CAPABILITY.rolloutScopes],
  sourceModelVersions: [...COMPATIBILITY_CAPABILITY.sourceModelVersions],
  supportedBlockTypes: [...COMPATIBILITY_CAPABILITY.supportedBlockTypes],
  engine: { ...COMPATIBILITY_CAPABILITY.engine },
  profileReferences: {
    templates: [...COMPATIBILITY_CAPABILITY.profileReferences.templates],
    styles: [...COMPATIBILITY_CAPABILITY.profileReferences.styles],
    brands: [...COMPATIBILITY_CAPABILITY.profileReferences.brands],
    fonts: [...COMPATIBILITY_CAPABILITY.profileReferences.fonts],
    validation: [...COMPATIBILITY_CAPABILITY.profileReferences.validation],
  },
  limits: { ...COMPATIBILITY_CAPABILITY.limits },
  review: { ...COMPATIBILITY_CAPABILITY.review },
  formats: COMPATIBILITY_CAPABILITY.formats.map(cloneFormat),
})

const projectProfessionalDocumentDevelopmentTestCapability = () => ({
  ...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY,
  rolloutScopes: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.rolloutScopes],
  sourceModelVersions: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.sourceModelVersions],
  supportedBlockTypes: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.supportedBlockTypes],
  engine: { ...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.engine },
  profileReferences: {
    templates: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.templates],
    styles: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.styles],
    brands: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.brands],
    fonts: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.fonts],
    validation: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.validation],
    productReferences: [...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.profileReferences.productReferences],
  },
  limits: { ...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.limits },
  review: { ...PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.review },
  formats: PROFESSIONAL_DOCUMENT_DEVELOPMENT_TEST_CAPABILITY.formats.map(cloneFormat),
})

export const listOutcomeRendererCapabilities = () => ({
  registryVersion: OUTCOME_RENDERER_CAPABILITY_REGISTRY_VERSION,
  capabilities: [projectCapability()],
})

export const resolveOutcomeRendererCapability = ({
  appEnvironment = env.appEnv,
  format = '',
  outputSchemaKey = '',
  outputTypeKey = '',
  styleKey = '',
} = {}) => {
  const normalizedFormat = normalizeToken(format)
  const normalizedAppEnvironment = normalizeText(appEnvironment).toLowerCase()
  const normalizedOutputTypeKey = normalizeText(outputTypeKey).toLowerCase()
  const requiredBindingsPresent = Boolean(
    normalizedOutputTypeKey
    && normalizeText(outputSchemaKey)
    && normalizeText(styleKey),
  )
  if (!requiredBindingsPresent) {
    return {
      status: 'UNSUPPORTED',
      reason: 'REQUIRED_DELIVERABLE_BINDING_MISSING',
      capability: null,
    }
  }

  if (
    normalizedFormat === OUTCOME_STUDIO_EXPORT_FORMATS.DOCX
    && normalizedOutputTypeKey === 'executive-brief'
    && ['development', 'test'].includes(normalizedAppEnvironment)
  ) {
    return {
      status: 'SUPPORTED',
      reason: '',
      capability: projectProfessionalDocumentDevelopmentTestCapability(),
    }
  }

  const capability = projectCapability()
  if (capability.lifecycleStatus !== 'ACTIVE') {
    return {
      status: 'UNSUPPORTED',
      reason: 'RENDERER_CAPABILITY_INACTIVE',
      capability: null,
    }
  }

  if (normalizedFormat && !capability.formats.some((entry) => entry.format === normalizedFormat)) {
    return {
      status: 'UNSUPPORTED',
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      capability: null,
    }
  }

  return {
    status: 'SUPPORTED',
    reason: '',
    capability,
  }
}
