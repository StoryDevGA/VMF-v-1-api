import crypto from 'node:crypto'
import mongoose from 'mongoose'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../models/RuntimePathRegistry.js'
import RuntimeInstance, {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import UIContract, { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import {
  DISCOVERY_ACQUISITION_PROFILE_ERROR_MESSAGE,
  DISCOVERY_ACQUISITION_PROFILES,
  ENABLED_DISCOVERY_ACQUISITION_PROFILES,
  RESERVED_DISCOVERY_ACQUISITION_PROFILES,
} from '../constants/discoveryAcquisitionProfiles.js'
import auditService from './auditService.js'
import {
  RUNTIME_INSTANCE_ERROR_REASONS,
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
  createRuntimeInstanceError,
  getFeatureForRuntimeType,
  normalizeToken,
  toIdString,
} from './runtimeInstanceService.js'
import {
  buildRuntimeSectionRevision,
  getRuntimeSectionAccepted,
  getRuntimeSectionGenerated,
  getRuntimeSectionInput,
  getRuntimeSectionRevisions,
  hashSectionInput,
  invalidateRuntimeSectionEvidence,
  isRuntimeSectionObject,
  normalizeRuntimeSectionObject,
  RUNTIME_SECTION_STATES,
} from './runtimeSectionModelService.js'
import { validateRuntimeMutation } from './runtimeValidation/runtimeMutationValidator.js'
import {
  isRuntimeLifecycleTruthImmutable,
  isRuntimeLocked,
  normalizeFrameworkStateForAction,
  normalizeRuntimeActionToken,
} from './runtimeActionPolicyService.js'
import {
  acceptPendingDiscoveryEvidenceObjects,
  acquireWebsiteDiscoveryEvidence,
  buildAcceptedDiscoveryScopedViews,
  applyDiscoveryEvidenceReview,
  buildDiscoveryAcquisitionEffectiveness,
  buildDiscoveryEvidenceObjectsFromSources,
  buildDiscoveryEvidenceReviewSummary,
  buildDiscoveryHealth,
  buildDiscoverySourceRegistry,
  DISCOVERY_EVIDENCE_REVIEW_STATUSES,
  ingestUploadedDocumentDiscoveryEvidence,
  normalizeDiscoveryWebsiteUrl,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import {
  buildRuntimeIntelligenceGraphAuditSummary,
  buildRuntimeIntelligenceGraphForFrameworkState,
  buildRuntimeIntelligenceGraphProjection,
  RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS,
} from './runtimeIntelligenceGraphService.js'

const SECTION_WRITE_SCOPE = 'framework_state.sections.*'
export const DISCOVERY_EVIDENCE_PACK_PATH = 'framework_state.evidence_pack'
export const RUNTIME_INTELLIGENCE_GRAPH_PATH = 'framework_state.intelligence_graph'
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const DISCOVERY_INPUT_KEYS = ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes']
const DISCOVERY_WEBSITE_SOURCE_INPUT_KEY = 'websiteSources'
const REQUIRED_DISCOVERY_INPUT_KEYS = ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer']
const DISCOVERY_RESET_REASON = 'USER_REQUESTED_DISCOVERY_RESET'
export { DISCOVERY_ACQUISITION_PROFILES }
const SUPPORTED_DISCOVERY_ACQUISITION_PROFILES = new Set(ENABLED_DISCOVERY_ACQUISITION_PROFILES)
const DISCOVERY_ACQUISITION_PROFILE_CONFIG = Object.freeze({
  [DISCOVERY_ACQUISITION_PROFILES.STANDARD]: {
    label: 'Standard Acquisition',
    purpose: 'PUBLISHABLE_FRAMEWORK',
    evidenceTarget: { min: 5, max: 20 },
    enabledSourceTypes: ['DISCOVERY_INPUTS', 'USER_PROVIDED_WEBSITE', 'UPLOADED_DOCUMENTS'],
    reservedSourceTypes: [],
  },
  [DISCOVERY_ACQUISITION_PROFILES.ENHANCED]: {
    label: 'Enhanced Acquisition',
    purpose: 'BROADER_SUPPORTING_EVIDENCE',
    evidenceTarget: { min: 20, max: 100 },
    enabledSourceTypes: ['DISCOVERY_INPUTS', 'WEBSITE', 'UPLOADED_DOCUMENTS'],
    reservedSourceTypes: ['ADDITIONAL_WEBSITE_PAGES'],
  },
  [DISCOVERY_ACQUISITION_PROFILES.STRATEGIC]: {
    label: 'Strategic Acquisition',
    purpose: 'STRATEGIC_INTELLIGENCE_BASE',
    evidenceTarget: { min: 100, max: 500 },
    enabledSourceTypes: [],
    reservedSourceTypes: ['PUBLIC_MARKET_CONTEXT', 'COMPETITOR_REFERENCES', 'INDUSTRY_THEMES'],
    disabled: true,
  },
})

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const stableStringify = (value) => {
  if (value === null || value === undefined) return ''
  if (!isPlainObject(value) && !Array.isArray(value)) return String(value)
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!isPlainObject(candidate)) return candidate
    return Object.keys(candidate)
      .sort()
      .reduce((acc, key) => ({
        ...acc,
        [key]: normalize(candidate[key]),
      }), {})
  }
  return JSON.stringify(normalize(value))
}

const hashDiscoveryValue = (value) =>
  `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`

const hashSectionTruthValue = (value) =>
  `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`

const normalizeRuntimePath = (value) => String(value || '').trim()
const normalizeSectionKey = (value) => String(value || '').trim()
const isStrictTrue = (value) => value === true

const getSectionKeyFromRuntimePath = (runtimePath) => {
  const pathParts = normalizeRuntimePath(runtimePath).split('.').filter(Boolean)
  return pathParts[0] === 'framework_state' && pathParts[1] === 'sections'
    ? normalizeSectionKey(pathParts[2])
    : ''
}

const getRuntimeSectionStateKey = ({ runtimePath, sectionKey }) => {
  const normalizedRuntimePath = normalizeRuntimePath(runtimePath)
  const sectionRootPrefix = 'framework_state.sections.'

  if (normalizedRuntimePath.startsWith(sectionRootPrefix)) {
    const statePath = normalizedRuntimePath.slice(sectionRootPrefix.length).trim()
    if (statePath && !statePath.includes('.')) return statePath
  }

  return normalizeSectionKey(sectionKey)
}

const buildMutationError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => createRuntimeInstanceError({
  status,
  code,
  message,
  reason,
  details,
})

const getEvidencePackStateFlag = (evidencePack, key) =>
  isStrictTrue(evidencePack?.[key]) || isStrictTrue(evidencePack?.state?.[key])

const getEvidencePackNeedsRefresh = (evidencePack) =>
  isStrictTrue(evidencePack?.needsRefresh) || isStrictTrue(evidencePack?.state?.needsRefresh)

const buildDiscoveryAcceptanceUnavailableError = (message) => buildMutationError({
  status: 409,
  code: 'CONFLICT',
  message,
  reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
  details: { runtimePath: DISCOVERY_EVIDENCE_PACK_PATH },
})

const normalizeDiscoveryAcquisitionProfile = ({
  acquisitionProfile,
  previousEvidencePack = {},
} = {}) => {
  const normalizedProfile = normalizeToken(
    acquisitionProfile
      ?? previousEvidencePack?.acquisition?.profile
      ?? previousEvidencePack?.acquisitionProfile
      ?? DISCOVERY_ACQUISITION_PROFILES.STANDARD,
  )

  if (SUPPORTED_DISCOVERY_ACQUISITION_PROFILES.has(normalizedProfile)) {
    return normalizedProfile
  }

  throw buildMutationError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: DISCOVERY_ACQUISITION_PROFILE_ERROR_MESSAGE,
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
    details: {
      acquisitionProfile: normalizedProfile,
      supportedAcquisitionProfiles: Array.from(SUPPORTED_DISCOVERY_ACQUISITION_PROFILES),
      disabledAcquisitionProfiles: RESERVED_DISCOVERY_ACQUISITION_PROFILES,
    },
  })
}

const buildDiscoveryCoverageSummary = ({
  accepted = false,
  evidenceObjectCount,
  evidenceReady,
  inputKeys,
  missingInputKeys,
  pendingReviewCount,
  rejectedEvidenceCount,
  sourceCount,
}) => {
  const requiredCompleteCount = REQUIRED_DISCOVERY_INPUT_KEYS.length - missingInputKeys.length
  const requiredCoverage = REQUIRED_DISCOVERY_INPUT_KEYS.length > 0
    ? Math.round((requiredCompleteCount / REQUIRED_DISCOVERY_INPUT_KEYS.length) * 100)
    : 0
  const normalizedEvidenceObjectCount = Number.isFinite(Number(evidenceObjectCount))
    ? Number(evidenceObjectCount)
    : (evidenceReady ? sourceCount : 0)
  const normalizedRejectedEvidenceCount = Number.isFinite(Number(rejectedEvidenceCount))
    ? Number(rejectedEvidenceCount)
    : 0
  const normalizedPendingReviewCount = Number.isFinite(Number(pendingReviewCount))
    ? Number(pendingReviewCount)
    : (evidenceReady && !accepted ? normalizedEvidenceObjectCount : 0)

  return {
    status: evidenceReady ? 'SUFFICIENT_FOR_FRAMEWORK' : 'INPUT_REQUIRED',
    requiredInputCount: REQUIRED_DISCOVERY_INPUT_KEYS.length,
    completedRequiredInputCount: requiredCompleteCount,
    inputCount: inputKeys.length,
    missingAreas: missingInputKeys,
    sourceCount,
    evidenceObjectCount: normalizedEvidenceObjectCount,
    acceptedEvidenceCount: accepted && evidenceReady
      ? Math.max(0, normalizedEvidenceObjectCount - normalizedRejectedEvidenceCount)
      : 0,
    pendingReviewCount: accepted ? 0 : normalizedPendingReviewCount,
    rejectedEvidenceCount: normalizedRejectedEvidenceCount,
    score: requiredCoverage,
  }
}

const buildAcceptedDiscoveryCoverage = (coverage = {}) => {
  const sourceCount = Number(coverage.sourceCount || 0)
  const evidenceObjectCount = Number(coverage.evidenceObjectCount || sourceCount)
  const rejectedEvidenceCount = Number(coverage.rejectedEvidenceCount || 0)

  return {
    ...coverage,
    evidenceObjectCount,
    acceptedEvidenceCount: Math.max(0, evidenceObjectCount - rejectedEvidenceCount),
    pendingReviewCount: 0,
    rejectedEvidenceCount,
  }
}

const buildDiscoveryConfidenceSummary = ({
  acquisitionProfile,
  coverage,
  evidenceReady,
  evidenceObjects = [],
}) => {
  if (!evidenceReady) {
    return {
      level: 'INSUFFICIENT',
      score: Math.min(coverage.score, 50),
      basis: ['REQUIRED_DISCOVERY_INPUTS_MISSING'],
    }
  }

  const websiteEvidenceCount = evidenceObjects.filter((evidenceObject) =>
    evidenceObject?.acquisitionMethod === 'WEBSITE_ACQUISITION',
  ).length
  const documentEvidenceCount = evidenceObjects.filter((evidenceObject) =>
    evidenceObject?.acquisitionMethod === 'DOCUMENT_INGESTION',
  ).length

  if (documentEvidenceCount > 0 || websiteEvidenceCount > 0) {
    const sourceBackedCount = documentEvidenceCount + websiteEvidenceCount
    return {
      level: 'SOURCE_BACKED',
      score: Math.min(82, Math.max(70, 62 + sourceBackedCount)),
      basis: [
        ...(websiteEvidenceCount > 0 ? ['CUSTOMER_WEBSITE_ACQUISITION'] : []),
        ...(documentEvidenceCount > 0 ? ['UPLOADED_DOCUMENT_INGESTION'] : []),
        'DETERMINISTIC_TEXT_EXTRACTION',
        'EVIDENCE_REVIEW_PENDING',
      ],
    }
  }

  if (acquisitionProfile === DISCOVERY_ACQUISITION_PROFILES.ENHANCED) {
    return {
      level: 'STANDARD',
      score: 65,
      basis: ['USER_PROVIDED_INPUTS', 'DETERMINISTIC_EVIDENCE_PACK'],
    }
  }

  return {
    level: 'STANDARD',
    score: 65,
    basis: ['USER_PROVIDED_INPUTS', 'DETERMINISTIC_EVIDENCE_PACK'],
  }
}

const hasRequiredDiscoveryInputs = (inputs) =>
  inputs
  && typeof inputs === 'object'
  && !Array.isArray(inputs)
  && REQUIRED_DISCOVERY_INPUT_KEYS.every((key) => String(inputs[key] ?? '').trim())

const hasDeterministicDiscoveryEvidence = (evidence, inputs) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  if (![
    'DISCOVERY_INPUTS',
    'DISCOVERY_INPUTS_AND_WEBSITE_ACQUISITION',
    'DISCOVERY_INPUTS_AND_DOCUMENT_INGESTION',
    'DISCOVERY_INPUTS_AND_WEBSITE_ACQUISITION_AND_DOCUMENT_INGESTION',
  ].includes(evidence.source)) return false
  if (!Array.isArray(evidence.inputKeys) || evidence.inputKeys.length === 0) return false
  if (!Array.isArray(evidence.requiredInputKeys)) return false
  if (!Array.isArray(evidence.missingInputKeys) || evidence.missingInputKeys.length > 0) return false
  if (!String(evidence.builtAt ?? '').trim()) return false

  const inputKeys = new Set(evidence.inputKeys.map((key) => String(key || '').trim()).filter(Boolean))
  const requiredKeys = new Set(evidence.requiredInputKeys.map((key) => String(key || '').trim()).filter(Boolean))

  return REQUIRED_DISCOVERY_INPUT_KEYS.every((key) =>
    inputKeys.has(key)
    && requiredKeys.has(key)
    && String(inputs?.[key] ?? '').trim())
}

const getCanonicalScopedViews = (evidencePack = {}) =>
  evidencePack.scoped_views || evidencePack.scopedViews || {}

const hasDiscoveryLineage = (evidencePack = {}) =>
  Array.isArray(evidencePack?.lineage?.sources)
  && evidencePack.lineage.sources.length > 0
  && isPlainObject(evidencePack?.lineage?.builder)
  && String(evidencePack.lineage.builder.mode || '').trim()

const hasReviewableDiscoveryEvidenceObjects = (evidencePack = {}) => {
  if (!Array.isArray(evidencePack.evidenceObjects) || evidencePack.evidenceObjects.length === 0) {
    return true
  }

  return evidencePack.evidenceObjects.some((evidenceObject) =>
    String(evidenceObject?.sourceId || '').trim()
    && String(evidenceObject?.lineageRef || '').trim()
    && String(evidenceObject?.extractedFact || '').trim()
    && evidenceObject.reviewStatus !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED,
  )
}

export const assertDiscoveryEvidenceAcceptable = (evidencePack) => {
  if (!evidencePack || Object.keys(evidencePack).length === 0) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence must be refreshed before it can be accepted.')
  }

  const inputComplete = getEvidencePackStateFlag(evidencePack, 'inputComplete')
  const evidenceReady = getEvidencePackStateFlag(evidencePack, 'evidenceReady')
  const needsRefresh = getEvidencePackNeedsRefresh(evidencePack)
  const accepted = !needsRefresh && getEvidencePackStateFlag(evidencePack, 'accepted')

  if (!inputComplete || !evidenceReady) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence is not ready for acceptance.')
  }

  if (needsRefresh) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence must be refreshed before acceptance.')
  }

  if (accepted) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence is already accepted.')
  }

  if (
    !hasRequiredDiscoveryInputs(evidencePack.inputs)
    || !hasDeterministicDiscoveryEvidence(evidencePack.evidence, evidencePack.inputs)
    || !hasDiscoveryLineage(evidencePack)
    || !hasReviewableDiscoveryEvidenceObjects(evidencePack)
  ) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence is incomplete and must be refreshed before acceptance.')
  }
}

const buildEvidenceSummaryProjection = (value = {}) => ({
  keys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [],
  count: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0,
})

const buildDiscoveryMutationResponse = ({ runtimeInstance, evidencePack, previousEvidencePack }) => ({
  runtimeInstance: {
    id: toIdString(runtimeInstance._id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    runtimeType: runtimeInstance.runtimeType,
    status: runtimeInstance.status,
    executionStatus: runtimeInstance.executionStatus,
    updatedAt: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
  },
  discovery: {
    state: evidencePack.state,
    inputComplete: evidencePack.inputComplete,
    evidenceReady: evidencePack.evidenceReady,
    accepted: evidencePack.accepted,
    needsRefresh: evidencePack.needsRefresh,
    refreshedAt: evidencePack.refreshedAt,
    acquisitionProfile: evidencePack.acquisition?.profile || evidencePack.acquisitionProfile || DISCOVERY_ACQUISITION_PROFILES.STANDARD,
    acquisition: cloneValue(evidencePack.acquisition || {}),
    ...(evidencePack.acceptedAt ? { acceptedAt: evidencePack.acceptedAt } : {}),
    ...(evidencePack.acceptedBy ? { acceptedBy: evidencePack.acceptedBy } : {}),
    inputSummary: {
      keys: Object.keys(evidencePack.inputs || {}),
      count: Object.keys(evidencePack.inputs || {}).length,
    },
    evidenceSummary: {
      keys: Object.keys(evidencePack.evidence || {}),
      count: Object.keys(evidencePack.evidence || {}).length,
    },
    summarySummary: {
      keys: Object.keys(evidencePack.summaries || {}),
      count: Object.keys(evidencePack.summaries || {}).length,
    },
    scopedViewSummary: {
      keys: Object.keys(getCanonicalScopedViews(evidencePack)),
      count: Object.keys(getCanonicalScopedViews(evidencePack)).length,
    },
    lineageSummary: {
      sourceCount: Array.isArray(evidencePack.lineage?.sources) ? evidencePack.lineage.sources.length : 0,
      builderMode: evidencePack.lineage?.builder?.mode || '',
    },
    sourceRegistrySummary: {
      count: Array.isArray(evidencePack.sourceRegistry) ? evidencePack.sourceRegistry.length : 0,
      sourceTypes: Array.isArray(evidencePack.sourceRegistry)
        ? Array.from(new Set(evidencePack.sourceRegistry.map((source) => source.sourceType).filter(Boolean)))
        : [],
    },
    evidenceObjectSummary: buildDiscoveryEvidenceReviewSummary(
      Array.isArray(evidencePack.evidenceObjects) ? evidencePack.evidenceObjects : [],
    ),
    discoveryHealth: cloneValue(evidencePack.discoveryHealth || evidencePack.acquisition?.discoveryHealth || {}),
    acquisitionEffectiveness: cloneValue(
      evidencePack.acquisitionEffectiveness || evidencePack.acquisition?.effectiveness || {},
    ),
    ...(evidencePack.resetSummary ? { resetSummary: cloneValue(evidencePack.resetSummary) } : {}),
  },
  mutation: {
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    previousValue: previousEvidencePack,
    value: cloneValue(evidencePack),
  },
})

const SECTION_EVIDENCE_SOURCE_TYPE = 'SECTION_UPLOADED_DOCUMENT'
const SECTION_EVIDENCE_ACQUISITION_METHOD = 'SECTION_DOCUMENT_INGESTION'
const SECTION_EVIDENCE_ASSET_TYPE = 'SECTION_SUPPORTING_FILE'
const SECTION_EVIDENCE_SNIPPET_MAX_LENGTH = 120

const hashSectionEvidenceValue = (value) =>
  crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)

const normalizeSectionEvidenceReviewStatus = (value) => {
  const normalized = normalizeToken(value)
  return Object.values(DISCOVERY_EVIDENCE_REVIEW_STATUSES).includes(normalized)
    ? normalized
    : DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING
}

const buildSectionEvidenceSnippet = (value) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const withoutSourcePrefix = normalized
    .replace(/^Document\s+[^:]{1,80}:\s*/i, '')
    .replace(/^Website\s+[^:]{1,80}:\s*/i, '')
    .trim()
  const snippet = withoutSourcePrefix || normalized
  return snippet.length > SECTION_EVIDENCE_SNIPPET_MAX_LENGTH
    ? `${snippet.slice(0, SECTION_EVIDENCE_SNIPPET_MAX_LENGTH - 3).trim()}...`
    : snippet
}

const buildSectionEvidenceReviewSummary = (evidenceObjects = []) => {
  const summary = buildDiscoveryEvidenceReviewSummary(Array.isArray(evidenceObjects) ? evidenceObjects : [])
  return {
    evidenceObjectCount: summary.evidenceObjectCount,
    acceptedEvidenceObjectCount: summary.acceptedEvidenceCount,
    pendingEvidenceObjectCount: summary.pendingReviewCount,
    rejectedEvidenceObjectCount: summary.rejectedEvidenceCount,
  }
}

const buildSectionEvidenceStatus = (summary) => {
  if (!summary || summary.evidenceObjectCount === 0) return 'EMPTY'
  if (summary.pendingEvidenceObjectCount > 0) return 'PENDING_REVIEW'
  if (summary.acceptedEvidenceObjectCount > 0) return 'ACCEPTED'
  if (summary.rejectedEvidenceObjectCount > 0) return 'REJECTED'
  return 'PENDING_REVIEW'
}

const buildDocumentExtractionMetadataProjection = (document = {}) => ({
  ...(Number.isFinite(Number(document?.ocrPageCount)) ? { ocrPageCount: Number(document.ocrPageCount) } : {}),
  ...(Number.isFinite(Number(document?.ocrPagesProcessed)) ? { ocrPagesProcessed: Number(document.ocrPagesProcessed) } : {}),
  ...(document?.ocrPageLimitReached ? { ocrPageLimitReached: true } : {}),
  ...(Number.isFinite(Number(document?.slideCount)) ? { slideCount: Number(document.slideCount) } : {}),
  ...(Number.isFinite(Number(document?.slidesProcessed)) ? { slidesProcessed: Number(document.slidesProcessed) } : {}),
  ...(document?.slideLimitReached ? { slideLimitReached: true } : {}),
  ...(Number.isFinite(Number(document?.slidesWithImages)) ? { slidesWithImages: Number(document.slidesWithImages) } : {}),
  ...(Number.isFinite(Number(document?.slidesWithCharts)) ? { slidesWithCharts: Number(document.slidesWithCharts) } : {}),
  ...(Number.isFinite(Number(document?.slidesPotentiallyMissingText))
    ? { slidesPotentiallyMissingText: Number(document.slidesPotentiallyMissingText) }
    : {}),
  ...(document?.speakerNotesIncluded ? { speakerNotesIncluded: true } : {}),
})

const buildSectionEvidenceProjection = ({
  additionalEvidence = {},
  evidenceObjects = [],
} = {}) => {
  const documents = Array.isArray(additionalEvidence.documents) ? additionalEvidence.documents : []
  const summary = buildSectionEvidenceReviewSummary(evidenceObjects)

  return {
    status: additionalEvidence.status || buildSectionEvidenceStatus(summary),
    updatedAt: additionalEvidence.updatedAt || '',
    updatedBy: additionalEvidence.updatedBy || '',
    documentCount: Number.isFinite(Number(additionalEvidence.documentCount))
      ? Number(additionalEvidence.documentCount)
      : documents.length,
    evidenceObjectCount: summary.evidenceObjectCount,
    acceptedEvidenceObjectCount: summary.acceptedEvidenceObjectCount,
    pendingEvidenceObjectCount: summary.pendingEvidenceObjectCount,
    rejectedEvidenceObjectCount: summary.rejectedEvidenceObjectCount,
    documents: documents.map((document) => ({
      sectionDocumentId: String(document?.sectionDocumentId || document?.sourceId || '').trim(),
      sourceId: String(document?.sourceId || document?.sectionDocumentId || '').trim(),
      fileName: String(document?.fileName || '').trim(),
      fileType: String(document?.fileType || document?.documentType || '').trim(),
      mimeType: String(document?.mimeType || '').trim(),
      sizeBytes: Number.isFinite(Number(document?.sizeBytes)) ? Number(document.sizeBytes) : 0,
      uploadedAt: String(document?.uploadedAt || '').trim(),
      uploadedBy: String(document?.uploadedBy || '').trim(),
      status: String(document?.status || document?.documentStatus || 'PROCESSED').trim().toUpperCase(),
      ingestionMode: String(document?.ingestionMode || '').trim().toUpperCase(),
      extractionMethod: String(document?.extractionMethod || '').trim(),
      adapter: String(document?.adapter || '').trim(),
      ...buildDocumentExtractionMetadataProjection(document),
      evidenceObjectsGenerated: Number.isFinite(Number(document?.evidenceObjectsGenerated))
        ? Number(document.evidenceObjectsGenerated)
        : 0,
    })).filter((document) => document.sectionDocumentId || document.fileName),
    evidenceObjects: (Array.isArray(evidenceObjects) ? evidenceObjects : []).map((evidenceObject) => ({
      evidenceObjectId: String(evidenceObject?.evidenceObjectId || '').trim(),
      sectionKey: String(evidenceObject?.sectionKey || '').trim(),
      runtimePath: String(evidenceObject?.runtimePath || '').trim(),
      sourceId: String(evidenceObject?.sourceId || '').trim(),
      sourceType: String(evidenceObject?.sourceType || SECTION_EVIDENCE_SOURCE_TYPE).trim(),
      category: String(evidenceObject?.category || 'Section Evidence').trim(),
      coverageArea: String(evidenceObject?.coverageArea || evidenceObject?.category || 'Section Evidence').trim(),
      reviewStatus: normalizeSectionEvidenceReviewStatus(evidenceObject?.reviewStatus),
      sourceFileName: String(evidenceObject?.sourceFileName || '').trim(),
      snippet: buildSectionEvidenceSnippet(evidenceObject?.extractedFact),
      createdAt: String(evidenceObject?.createdAt || '').trim(),
      acceptedBy: String(evidenceObject?.acceptedBy || '').trim(),
      acceptanceTimestamp: String(evidenceObject?.acceptanceTimestamp || '').trim(),
      rejectedBy: String(evidenceObject?.rejectedBy || '').trim(),
      rejectionTimestamp: String(evidenceObject?.rejectionTimestamp || '').trim(),
    })).filter((evidenceObject) => evidenceObject.evidenceObjectId),
  }
}

const buildSectionAdditionalEvidence = ({
  actorUserId,
  documents = [],
  evidenceObjects = [],
  updatedAt,
} = {}) => {
  const summary = buildSectionEvidenceReviewSummary(evidenceObjects)
  return {
    status: buildSectionEvidenceStatus(summary),
    updatedAt,
    updatedBy: toIdString(actorUserId),
    documentCount: documents.length,
    ...summary,
    documents,
  }
}

const buildSectionGsilContext = ({
  evidenceObjects = [],
  reviewedAt,
} = {}) => {
  const acceptedEvidenceObjects = (Array.isArray(evidenceObjects) ? evidenceObjects : [])
    .filter((evidenceObject) =>
      normalizeSectionEvidenceReviewStatus(evidenceObject?.reviewStatus) === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
    )
  const sourceRefs = acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject?.evidenceObjectId || evidenceObject?.lineageRef || evidenceObject?.sourceId || '').trim())
    .filter(Boolean)
  const sectionEvidenceSummary = acceptedEvidenceObjects
    .map((evidenceObject) => String(evidenceObject?.extractedFact || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ')

  return {
    sectionEvidenceSummary,
    acceptedEvidenceObjectIds: acceptedEvidenceObjects
      .map((evidenceObject) => String(evidenceObject?.evidenceObjectId || '').trim())
      .filter(Boolean),
    sourceRefs,
    evidenceHash: hashSectionInput({
      acceptedEvidenceObjectIds: sourceRefs,
      sectionEvidenceSummary,
    }),
    updatedAt: reviewedAt || '',
  }
}

const transformSectionDocumentAcquisition = ({
  acquisition,
  actorUserId,
  capturedAt,
  runtimePath,
  sectionKey,
  stateSectionKey,
} = {}) => {
  const sourceIdMap = new Map()
  const documents = (Array.isArray(acquisition?.sourceRegistry) ? acquisition.sourceRegistry : [])
    .map((source, index) => {
      const previousSourceId = String(source?.sourceId || '').trim()
      const sectionDocumentId = `section_document_${hashSectionEvidenceValue({
        capturedAt,
        fileName: source?.fileName,
        index,
        previousSourceId,
        runtimePath,
        sectionKey,
        stateSectionKey,
      })}`
      sourceIdMap.set(previousSourceId, sectionDocumentId)

      return {
        sectionDocumentId,
        sourceId: sectionDocumentId,
        fileName: String(source?.fileName || '').trim(),
        fileType: String(source?.documentType || '').trim(),
        mimeType: String(source?.mimeType || '').trim(),
        sizeBytes: Number.isFinite(Number(source?.sizeBytes)) ? Number(source.sizeBytes) : 0,
        uploadedAt: capturedAt,
        uploadedBy: toIdString(actorUserId),
        status: 'PROCESSED',
        ingestionMode: String(source?.ingestionMode || 'TEXT_NATIVE').trim().toUpperCase(),
        extractionMethod: String(source?.extractionMethod || '').trim(),
        adapter: String(source?.adapter || '').trim(),
        ...buildDocumentExtractionMetadataProjection(source),
        evidenceObjectsGenerated: Number.isFinite(Number(source?.evidenceObjectsGenerated))
          ? Number(source.evidenceObjectsGenerated)
          : 0,
      }
    })

  const evidenceObjects = (Array.isArray(acquisition?.evidenceObjects) ? acquisition.evidenceObjects : [])
    .map((evidenceObject, index) => {
      const previousEvidenceObjectId = String(evidenceObject?.evidenceObjectId || '').trim()
      const previousSourceId = String(evidenceObject?.sourceId || '').trim()
      const sourceId = sourceIdMap.get(previousSourceId) || previousSourceId
      const evidenceObjectId = `section_evidence_${hashSectionEvidenceValue({
        capturedAt,
        index,
        previousEvidenceObjectId,
        runtimePath,
        sectionKey,
        sourceId,
      })}`

      return {
        ...evidenceObject,
        evidenceObjectId,
        sectionKey,
        runtimePath,
        sourceId,
        sourceType: SECTION_EVIDENCE_SOURCE_TYPE,
        acquisitionMethod: SECTION_EVIDENCE_ACQUISITION_METHOD,
        reviewStatus: DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING,
        acceptedBy: '',
        acceptanceTimestamp: '',
        rejectedBy: '',
        rejectionTimestamp: '',
        auditRef: '',
        lineageRef: `lineage:${sourceId}:${evidenceObjectId}`,
        acquisitionProfile: '',
        documentAssetType: SECTION_EVIDENCE_ASSET_TYPE,
        sourceFileName: String(evidenceObject?.sourceFileName || '').trim(),
      }
    })

  return { documents, evidenceObjects }
}

const buildSectionEvidenceMutationResponse = ({
  runtimeInstance,
  target,
  previousSectionEvidence,
  sectionEvidence,
}) => ({
  runtimeInstance: {
    id: toIdString(runtimeInstance._id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    runtimeType: runtimeInstance.runtimeType,
    status: runtimeInstance.status,
    executionStatus: runtimeInstance.executionStatus,
    updatedAt: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
  },
  section: {
    sectionKey: target.sectionKey,
    stateSectionKey: target.stateSectionKey,
    runtimePath: target.runtimePath,
    sectionEvidence,
    previousSectionEvidence,
  },
  mutation: {
    runtimePath: target.runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    previousValue: previousSectionEvidence,
    value: sectionEvidence,
  },
})

const hasSectionGeneratedOrAcceptedTruth = (sectionObject) => Boolean(
  String(getRuntimeSectionGenerated(sectionObject)?.content ?? '').trim()
  || String(getRuntimeSectionAccepted(sectionObject)?.content ?? '').trim(),
)

const applyAcceptedSectionEvidenceInvalidation = ({
  actorUserId,
  invalidatedAt,
  nextSection,
  nextSectionEvidenceHash = '',
  previousSectionEvidenceHash = '',
  sectionObject,
} = {}) => {
  if (!hasSectionGeneratedOrAcceptedTruth(sectionObject)) return nextSection

  return {
    ...nextSection,
    review: {
      ...(nextSection.review || {}),
      invalidatedAt,
      invalidationReason: 'SECTION_EVIDENCE_CHANGED',
    },
    state: {
      ...(nextSection.state || {}),
      needsRegeneration: true,
      sectionEvidenceInvalidatedAt: invalidatedAt,
      sectionEvidenceInvalidatedBy: toIdString(actorUserId),
      acceptedInvalidatedAt: getRuntimeSectionAccepted(sectionObject) ? invalidatedAt : nextSection.state?.acceptedInvalidatedAt,
      acceptedInvalidationReason: getRuntimeSectionAccepted(sectionObject)
        ? 'SECTION_EVIDENCE_CHANGED'
        : nextSection.state?.acceptedInvalidationReason,
    },
    lineage: {
      ...(nextSection.lineage || {}),
      sectionEvidenceInvalidatedAt: invalidatedAt,
      sectionEvidenceInvalidatedBy: toIdString(actorUserId),
      sectionEvidenceInvalidationReason: 'SECTION_EVIDENCE_CHANGED',
    },
    intelligence: {
      ...(nextSection.intelligence || {}),
      invalidation: {
        reason: 'SECTION_EVIDENCE_CHANGED',
        invalidatedAt,
        invalidatedBy: toIdString(actorUserId),
        previousSectionEvidenceHash,
        nextSectionEvidenceHash,
      },
    },
  }
}

const getValueAtPath = (source, pathParts) => {
  let cursor = source
  for (const part of pathParts) {
    if (
      cursor === null
      || cursor === undefined
      || typeof cursor !== 'object'
      || !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return undefined
    }
    cursor = cursor[part]
  }
  return cursor
}

const assertSafeRuntimePathParts = (runtimePath) => {
  const pathParts = normalizeRuntimePath(runtimePath).split('.').filter(Boolean)

  if (
    pathParts.length < 3
    || pathParts[0] !== 'framework_state'
    || pathParts[1] !== 'sections'
  ) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime mutation path is outside the Sprint 1 writable section scope.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_FORBIDDEN_PATH,
      details: { runtimePath, allowedScope: SECTION_WRITE_SCOPE },
    })
  }

  const unsafeSegment = pathParts.find((part) => FORBIDDEN_PATH_SEGMENTS.has(part))
  if (unsafeSegment) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime mutation path contains an unsafe segment.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, unsafeSegment },
    })
  }

  return pathParts
}

const hasRuntimeSnapshotValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return true
}

const getSectionRootWriteTarget = ({ frameworkState, leafKey, runtimePath }) => {
  const sections = isPlainObject(frameworkState?.sections) ? frameworkState.sections : {}
  if (Object.prototype.hasOwnProperty.call(sections, leafKey)) {
    return {
      previousRawValue: sections[leafKey],
      previousStateKey: leafKey,
    }
  }

  const normalizedRuntimePath = normalizeRuntimePath(runtimePath)
  const legacyEntry = Object.entries(sections).find(([candidateKey, candidateValue]) => {
    if (candidateKey === leafKey || !isRuntimeSectionObject(candidateValue)) return false
    const candidateRuntimePath = normalizeRuntimePath(candidateValue?.lineage?.runtimePath)
    return candidateRuntimePath && candidateRuntimePath === normalizedRuntimePath
  })

  if (legacyEntry) {
    return {
      previousRawValue: legacyEntry[1],
      previousStateKey: legacyEntry[0],
    }
  }

  return {
    previousRawValue: undefined,
    previousStateKey: leafKey,
  }
}

const buildSectionRootWriteValue = ({
  previousRawValue,
  runtimePath,
  sectionKey,
  value,
}) => {
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawValue,
    sectionKey,
    runtimePath,
  })
  const nextInput = cloneValue(value)
  const previousInput = getRuntimeSectionInput(previousRawValue)
  const previousGenerated = getRuntimeSectionGenerated(sectionObject)
  const previousAccepted = getRuntimeSectionAccepted(sectionObject)
  const inputChanged = hashSectionInput(previousInput) !== hashSectionInput(nextInput)
  const hasGeneratedSnapshot = hasRuntimeSnapshotValue(previousGenerated)
  const hasAcceptedSnapshot = hasRuntimeSnapshotValue(previousAccepted)

  if (!inputChanged || (!hasGeneratedSnapshot && !hasAcceptedSnapshot)) {
    return {
      ...sectionObject,
      input: nextInput,
    }
  }

  const invalidatedAt = new Date().toISOString()
  const existingRevisions = getRuntimeSectionRevisions(sectionObject)
  const nextRevisions = [
    ...existingRevisions,
    buildRuntimeSectionRevision({
      ...(hasGeneratedSnapshot ? { generated: previousGenerated } : {}),
      ...(hasAcceptedSnapshot ? { accepted: previousAccepted } : {}),
      reason: 'SECTION_INPUT_CHANGED',
      revisionNumber: existingRevisions.length + 1,
      replacedAt: invalidatedAt,
    }),
  ]

  return {
    ...sectionObject,
    input: nextInput,
    generated: null,
    accepted: null,
    revisions: nextRevisions,
    review: {
      ...(sectionObject.review || {}),
      status: 'PENDING_REVIEW',
      invalidatedAt,
      invalidationReason: 'SECTION_INPUT_CHANGED',
    },
    state: {
      ...(sectionObject.state || {}),
      status: RUNTIME_SECTION_STATES.DRAFT,
      revisionCount: nextRevisions.length,
      inputHash: hashSectionInput(nextInput),
      invalidatedAt,
      invalidationReason: 'SECTION_INPUT_CHANGED',
      ...(hasGeneratedSnapshot ? { generatedInvalidatedAt: invalidatedAt } : {}),
      ...(hasAcceptedSnapshot ? { acceptedInvalidatedAt: invalidatedAt } : {}),
    },
    lineage: {
      ...(sectionObject.lineage || {}),
      sectionKey,
      runtimePath,
      inputHash: hashSectionInput(nextInput),
      invalidatedAt,
      invalidationReason: 'SECTION_INPUT_CHANGED',
    },
    intelligence: {
      ...(sectionObject.intelligence || {}),
      invalidation: {
        reason: 'SECTION_INPUT_CHANGED',
        invalidatedAt,
        archivedRevisionNumber: nextRevisions.length,
      },
    },
  }
}

const setValueAtPath = ({ frameworkState, runtimePath, value }) => {
  const pathParts = assertSafeRuntimePathParts(runtimePath)
  const mutableState = cloneValue(frameworkState || {})
  let cursor = mutableState

  pathParts.slice(1, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part]
  })

  const leafKey = pathParts[pathParts.length - 1]
  const isSectionRootWrite = pathParts.length === 3
  const sectionRootTarget = isSectionRootWrite
    ? getSectionRootWriteTarget({
        frameworkState: frameworkState || {},
        leafKey,
        runtimePath,
      })
    : null
  const previousRawValue = isSectionRootWrite
    ? sectionRootTarget.previousRawValue
    : getValueAtPath({ framework_state: frameworkState || {} }, pathParts)
  const nextValue = isSectionRootWrite
    ? buildSectionRootWriteValue({
        previousRawValue,
        runtimePath,
        sectionKey: leafKey,
        value,
      })
    : value

  if (isSectionRootWrite && sectionRootTarget.previousStateKey && sectionRootTarget.previousStateKey !== leafKey) {
    delete cursor[sectionRootTarget.previousStateKey]
  }
  cursor[leafKey] = nextValue

  return {
    nextFrameworkState: mutableState,
    previousValue: cloneValue(isSectionRootWrite ? getRuntimeSectionInput(previousRawValue) : previousRawValue),
  }
}

const invalidateSectionMutationEvidence = ({ nextFrameworkState, runtimePath }) =>
  invalidateRuntimeSectionEvidence({ frameworkState: nextFrameworkState, runtimePath })

const normalizeDiscoveryWebsiteSources = (values = []) => {
  const candidateValues = Array.isArray(values) ? values : []
  const seenWebsiteSources = new Set()

  return candidateValues.reduce((websiteSources, value) => {
    const rawValue = String(value ?? '').trim()
    if (!rawValue) return websiteSources

    let normalizedUrl
    try {
      normalizedUrl = normalizeDiscoveryWebsiteUrl(rawValue, {
        fieldLabel: 'Website source',
        requireHttps: true,
      })
    } catch (err) {
      throw buildMutationError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: err?.message || 'Website source must be a valid https URL.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.WEBSITE_ACQUISITION_FAILED,
        details: {
          websiteSource: rawValue,
          acquisitionStatus: 'FAILED_VALIDATION',
        },
      })
    }

    if (seenWebsiteSources.has(normalizedUrl)) return websiteSources
    seenWebsiteSources.add(normalizedUrl)
    return [...websiteSources, normalizedUrl]
  }, [])
}

const normalizeDiscoveryInputs = (inputs = {}) => {
  const normalizedInputs = DISCOVERY_INPUT_KEYS.reduce((normalized, key) => {
    const value = String(inputs?.[key] ?? '').trim()
    if (value) normalized[key] = value
    return normalized
  }, {})
  const explicitWebsiteSources = normalizeDiscoveryWebsiteSources(inputs?.[DISCOVERY_WEBSITE_SOURCE_INPUT_KEY])
  if (explicitWebsiteSources.length > 0) {
    normalizedInputs[DISCOVERY_WEBSITE_SOURCE_INPUT_KEY] = explicitWebsiteSources
    normalizedInputs.companyWebsite = explicitWebsiteSources[0]
  }

  return {
    explicitWebsiteSources,
    normalizedInputs,
  }
}

const buildFailedWebsiteSource = ({
  acquisitionProfile,
  capturedAt,
  error,
  websiteUrl,
} = {}) => {
  const normalizedUrl = String(websiteUrl || '').trim()
  const sourceId = `website_failed_${hashDiscoveryValue({ normalizedUrl }).replace(/^sha256:/, '').slice(0, 12)}`
  const failureReason = String(error?.message || 'Website acquisition failed.').trim()
  const source = {
    sourceId,
    type: 'WEBSITE_ACQUISITION',
    sourceType: 'WEBSITE',
    label: 'Website Source',
    url: normalizedUrl,
    status: 'FAILED',
    capturedAt,
    acquisitionStatus: 'FAILED',
    acquisitionProfile,
    evidenceProduced: 0,
    lineageRef: `lineage:${sourceId}`,
    adapter: 'website-html-fetch-v1',
    pageCount: 1,
    failureReason,
    failureReasonCode: 'WEBSITE_ACQUISITION_FAILED',
  }

  return {
    source,
    sourceRegistryEntry: {
      sourceId,
      sourceType: 'WEBSITE',
      label: 'Website Source',
      status: 'FAILED',
      dateAdded: capturedAt,
      acquisitionStatus: 'FAILED',
      evidenceProduced: 0,
      evidenceObjectsGenerated: 0,
      acceptedEvidenceObjects: 0,
      rejectedEvidenceObjects: 0,
      pendingEvidenceObjects: 0,
      lastAcquisitionAt: capturedAt,
      lineageRef: `lineage:${sourceId}`,
      acquisitionProfile,
      url: normalizedUrl,
      failureReason,
      failureReasonCode: 'WEBSITE_ACQUISITION_FAILED',
    },
    evidenceObjects: [],
  }
}

const acquireSubmittedWebsiteSources = async ({
  acquisitionProfile,
  capturedAt,
  websiteSources = [],
} = {}) => {
  const acquisitionResults = {
    sources: [],
    sourceRegistry: [],
    evidenceObjects: [],
    acquiredSourceCount: 0,
    failedSourceCount: 0,
  }

  for (const websiteUrl of websiteSources) {
    let result
    try {
      const acquiredWebsite = await acquireWebsiteDiscoveryEvidence({
        acquisitionProfile,
        acquiredAt: capturedAt,
        websiteUrl,
      })
      result = {
        source: acquiredWebsite.source,
        sourceRegistryEntry: acquiredWebsite.sourceRegistryEntry,
        evidenceObjects: acquiredWebsite.evidenceObjects,
      }
      acquisitionResults.acquiredSourceCount += 1
    } catch (err) {
      result = buildFailedWebsiteSource({
        acquisitionProfile,
        capturedAt,
        error: err,
        websiteUrl,
      })
      acquisitionResults.failedSourceCount += 1
    }

    if (result.source) acquisitionResults.sources.push(result.source)
    if (result.sourceRegistryEntry) acquisitionResults.sourceRegistry.push(result.sourceRegistryEntry)
    if (Array.isArray(result.evidenceObjects)) {
      acquisitionResults.evidenceObjects.push(...result.evidenceObjects)
    }
  }

  return acquisitionResults
}

const mergeDiscoveryEntriesByKey = (keyName, ...entryGroups) => {
  const entriesByKey = new Map()

  entryGroups.flat().forEach((entry) => {
    const entryKey = String(entry?.[keyName] || '').trim()
    if (!entryKey) return
    entriesByKey.set(entryKey, entry)
  })

  return Array.from(entriesByKey.values())
}

export const buildDiscoveryEvidencePack = async ({
  acquisitionProfile,
  actorUserId,
  documentSources,
  inputs,
  previousEvidencePack = {},
  reason = 'BUILD_EVIDENCE_PACK',
  runtimeInstance,
}) => {
  const {
    explicitWebsiteSources,
    normalizedInputs,
  } = normalizeDiscoveryInputs(inputs)
  const profile = normalizeDiscoveryAcquisitionProfile({ acquisitionProfile, previousEvidencePack })
  const profileConfig = DISCOVERY_ACQUISITION_PROFILE_CONFIG[profile]
  const inputEvidenceKeys = DISCOVERY_INPUT_KEYS.filter((key) => Boolean(normalizedInputs[key]))
  const inputKeys = [
    ...inputEvidenceKeys,
    ...(Array.isArray(normalizedInputs[DISCOVERY_WEBSITE_SOURCE_INPUT_KEY])
      && normalizedInputs[DISCOVERY_WEBSITE_SOURCE_INPUT_KEY].length > 0
      ? [DISCOVERY_WEBSITE_SOURCE_INPUT_KEY]
      : []),
  ]
  const missingInputKeys = REQUIRED_DISCOVERY_INPUT_KEYS.filter((key) => !normalizedInputs[key])
  const inputComplete = missingInputKeys.length === 0
  const refreshedAt = new Date().toISOString()
  const inputHash = hashDiscoveryValue(normalizedInputs)
  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const [uiContract, runtimePathRecords] = frameworkPackage
    ? await Promise.all([
        resolveUIContractForAdvance({ frameworkPackage }),
        resolveRuntimePathRecordsForAdvance({ frameworkPackage }),
      ])
    : [null, new Map()]
  const projectableSections = frameworkPackage
    ? buildProjectableSectionsForAdvance({ frameworkPackage, runtimePathRecords, uiContract })
    : []
  const inputSources = inputEvidenceKeys.map((key) => ({
    sourceId: `input_${key}`,
    type: key === 'companyWebsite' ? 'USER_PROVIDED_WEBSITE' : 'USER_PROVIDED_INPUT',
    fieldKey: key,
    ...(key === 'companyWebsite' ? { url: normalizedInputs[key] } : {}),
    valueHash: hashDiscoveryValue(normalizedInputs[key]),
    status: 'USER_PROVIDED',
    capturedAt: refreshedAt,
    acquisitionProfile: profile,
  }))
  const inputEvidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: profile,
    createdAt: refreshedAt,
    evidenceObjects: buildDiscoveryEvidenceObjectsFromSources({
      acquisitionProfile: profile,
      createdAt: refreshedAt,
      inputs: normalizedInputs,
      sources: inputSources,
    }),
  })
  let websiteAcquisition = null
  let submittedWebsiteAcquisition = {
    sources: [],
    sourceRegistry: [],
    evidenceObjects: [],
    acquiredSourceCount: 0,
    failedSourceCount: 0,
  }
  if (
    profile === DISCOVERY_ACQUISITION_PROFILES.STANDARD
    && inputComplete
    && explicitWebsiteSources.length > 0
  ) {
    submittedWebsiteAcquisition = await acquireSubmittedWebsiteSources({
      acquisitionProfile: profile,
      capturedAt: refreshedAt,
      websiteSources: explicitWebsiteSources,
    })
  }
  if (profile === DISCOVERY_ACQUISITION_PROFILES.ENHANCED && inputComplete) {
    try {
      websiteAcquisition = await acquireWebsiteDiscoveryEvidence({
        acquisitionProfile: profile,
        acquiredAt: refreshedAt,
        websiteUrl: normalizedInputs.companyWebsite,
      })
    } catch (err) {
      throw buildMutationError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Enhanced Acquisition could not acquire website evidence.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.WEBSITE_ACQUISITION_FAILED,
        details: {
          acquisitionProfile: profile,
          companyWebsite: normalizedInputs.companyWebsite || '',
          acquisitionStatus: 'FAILED',
          acquisitionError: err?.message || 'Website acquisition failed.',
        },
      })
    }
  }
  let documentAcquisition = {
    sources: [],
    sourceRegistry: [],
    evidenceObjects: [],
  }
  if (documentSources !== undefined) {
    try {
      documentAcquisition = await ingestUploadedDocumentDiscoveryEvidence({
        acquisitionProfile: profile,
        capturedAt: refreshedAt,
        documentSources,
      })
    } catch (err) {
      throw buildMutationError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Document ingestion could not produce governed evidence.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.DOCUMENT_INGESTION_FAILED,
        details: {
          acquisitionProfile: profile,
          acquisitionStatus: 'FAILED',
          acquisitionError: err?.message || 'Document ingestion failed.',
        },
      })
    }
  }
  const previousDocumentSources = Array.isArray(previousEvidencePack?.lineage?.sources)
    ? previousEvidencePack.lineage.sources.filter((source) =>
        source?.type === 'UPLOADED_DOCUMENT' || source?.sourceType === 'UPLOADED_DOCUMENT',
      )
    : []
  const previousDocumentEvidenceObjects = Array.isArray(previousEvidencePack?.evidenceObjects)
    ? previousEvidencePack.evidenceObjects.filter((evidenceObject) =>
        evidenceObject?.acquisitionMethod === 'DOCUMENT_INGESTION',
      )
    : []
  const previousDocumentRegistry = Array.isArray(previousEvidencePack?.sourceRegistry)
    ? previousEvidencePack.sourceRegistry.filter((source) => source?.sourceType === 'UPLOADED_DOCUMENT')
    : []
  const documentSourcesForPack = mergeDiscoveryEntriesByKey(
    'sourceId',
    previousDocumentSources,
    documentAcquisition.sources,
  )
  const documentEvidenceObjectsForPack = mergeDiscoveryEntriesByKey(
    'evidenceObjectId',
    previousDocumentEvidenceObjects,
    documentAcquisition.evidenceObjects,
  )
  const documentRegistryForPack = mergeDiscoveryEntriesByKey(
    'sourceId',
    previousDocumentRegistry,
    documentAcquisition.sourceRegistry,
  )
  const sources = [
    ...inputSources,
    ...(websiteAcquisition?.source ? [websiteAcquisition.source] : []),
    ...submittedWebsiteAcquisition.sources,
    ...documentSourcesForPack,
  ]
  const evidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: profile,
    createdAt: refreshedAt,
    evidenceObjects: [
      ...inputEvidenceObjects,
      ...(Array.isArray(websiteAcquisition?.evidenceObjects) ? websiteAcquisition.evidenceObjects : []),
      ...submittedWebsiteAcquisition.evidenceObjects,
      ...documentEvidenceObjectsForPack,
    ],
    inputs: normalizedInputs,
    sources,
  })
  const inputSourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: refreshedAt,
    evidenceObjects: inputEvidenceObjects,
    sources: inputSources,
  })
  const sourceRegistry = [
    ...inputSourceRegistry,
    ...(websiteAcquisition?.sourceRegistryEntry ? [websiteAcquisition.sourceRegistryEntry] : []),
    ...submittedWebsiteAcquisition.sourceRegistry,
    ...documentRegistryForPack,
  ]
  const evidenceReady = inputComplete
    && (
      profile !== DISCOVERY_ACQUISITION_PROFILES.ENHANCED
      || Boolean(websiteAcquisition?.evidenceObjects?.length)
    )
  const sourceRefs = sources.map((source) => source.sourceId).filter(Boolean)
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(evidenceObjects)
  const websiteAcquisitionEvidenceObjects = [
    ...(Array.isArray(websiteAcquisition?.evidenceObjects) ? websiteAcquisition.evidenceObjects : []),
    ...submittedWebsiteAcquisition.evidenceObjects,
  ]
  const hasWebsiteAcquisitionEvidence = websiteAcquisitionEvidenceObjects.length > 0
  const baseCoverage = buildDiscoveryCoverageSummary({
    evidenceObjectCount: reviewSummary.evidenceObjectCount,
    evidenceReady,
    inputKeys,
    missingInputKeys,
    pendingReviewCount: reviewSummary.pendingReviewCount,
    rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
    sourceCount: sources.length,
  })
  const baseDiscoveryHealth = buildDiscoveryHealth({
    acquisitionProfile: profile,
    coverage: baseCoverage,
    evidenceObjects,
    lastAcquisitionDate: refreshedAt,
    sourceRegistry,
  })
  const shouldUseEvidenceDomainCoverage = profile === DISCOVERY_ACQUISITION_PROFILES.ENHANCED
    || (
      profile === DISCOVERY_ACQUISITION_PROFILES.STANDARD
      && hasWebsiteAcquisitionEvidence
    )
  const coverage = shouldUseEvidenceDomainCoverage
    ? {
        ...baseCoverage,
        status: evidenceReady && hasWebsiteAcquisitionEvidence
          ? 'SOURCE_BACKED_EVIDENCE_READY'
          : baseCoverage.status,
        score: baseDiscoveryHealth.coveragePercent,
      }
    : baseCoverage
  const confidence = buildDiscoveryConfidenceSummary({
    acquisitionProfile: profile,
    coverage,
    evidenceObjects,
    evidenceReady,
  })
  const discoveryHealth = buildDiscoveryHealth({
    acquisitionProfile: profile,
    coverage: { ...coverage, confidence },
    evidenceObjects,
    lastAcquisitionDate: refreshedAt,
    sourceRegistry,
  })
  const acquisitionEffectiveness = buildDiscoveryAcquisitionEffectiveness({
    acquisitionProfile: profile,
    discoveryHealth,
    evidenceObjects,
    inputs: normalizedInputs,
    sourceRegistry,
  })
  const websiteAcquisitionSourceCount = Number(submittedWebsiteAcquisition.sources.length)
    + (websiteAcquisition?.source ? 1 : 0)
  const websiteAcquisitionFailureCount = Number(submittedWebsiteAcquisition.failedSourceCount || 0)
  const websiteAcquisitionAcquiredCount = Number(submittedWebsiteAcquisition.acquiredSourceCount || 0)
    + (websiteAcquisition?.source ? 1 : 0)
  const acquisition = {
    profile,
    label: profileConfig.label,
    purpose: profileConfig.purpose,
    status: evidenceReady ? 'EVIDENCE_READY' : 'INPUT_REQUIRED',
    evidenceTarget: profileConfig.evidenceTarget,
    enabledSourceTypes: profileConfig.enabledSourceTypes,
    reservedSourceTypes: profileConfig.reservedSourceTypes,
    disabledProfiles: RESERVED_DISCOVERY_ACQUISITION_PROFILES.map((reservedProfile) => ({
      profile: reservedProfile,
      reason: `${DISCOVERY_ACQUISITION_PROFILE_CONFIG[reservedProfile].label} is reserved for a later Intelligence Hub architecture sprint.`,
    })),
    sourceRegistry,
    coverage,
    confidence,
    discoveryHealth,
    effectiveness: acquisitionEffectiveness,
    requestedAt: refreshedAt,
    completedAt: evidenceReady ? refreshedAt : null,
    ...(websiteAcquisitionSourceCount > 0
      ? {
          websiteAcquisition: {
            status: websiteAcquisitionFailureCount > 0
              ? (websiteAcquisitionAcquiredCount > 0 ? 'PARTIAL' : 'FAILED')
              : 'ACQUIRED',
            sourceCount: websiteAcquisitionSourceCount,
            acquiredSourceCount: websiteAcquisitionAcquiredCount,
            failedSourceCount: websiteAcquisitionFailureCount,
            evidenceProduced: websiteAcquisitionEvidenceObjects.length,
            ...(websiteAcquisition?.source
              ? {
                  sourceId: websiteAcquisition.source.sourceId,
                  url: websiteAcquisition.source.url,
                  finalUrl: websiteAcquisition.source.finalUrl,
                }
              : {}),
          },
        }
      : {}),
    ...(documentEvidenceObjectsForPack.length > 0
      ? {
          documentAcquisition: {
            status: 'ACQUIRED',
            sourceCount: documentSourcesForPack.length,
            evidenceProduced: documentEvidenceObjectsForPack.length,
          },
        }
      : {}),
  }
  const compactSummary = {
    summary: `Customer-provided Intelligence Hub inputs captured for ${
      normalizedInputs.companyName || normalizedInputs.companyWebsite || 'this runtime'
    }${hasWebsiteAcquisitionEvidence ? ' with website acquisition evidence.' : '.'}`,
    confidence: hasWebsiteAcquisitionEvidence ? confidence.level : 'USER_PROVIDED',
    sourceRefs,
    inputHash,
    refreshedAt,
    acquisitionProfile: profile,
  }
  const scopedViews = evidenceReady
    ? projectableSections.reduce((views, section) => {
        const sectionKey = normalizeSectionKey(section?.sectionKey)
        if (!sectionKey) return views
        views[sectionKey] = {
          source: 'DISCOVERY_EVIDENCE_PACK',
          summary: 'Customer-provided Intelligence Hub inputs are available for this section.',
          inputKeys,
          evidenceKeys: ['summaries.compact', 'discovery.seedProfile'],
          sourceRefs,
          refreshedAt,
          acquisitionProfile: profile,
          evidenceHash: hashDiscoveryValue({
            sectionKey,
            inputHash,
            sourceRefs,
            acquisitionProfile: profile,
          }),
        }
        return views
      }, {})
    : {}
  const evidenceSources = [
    'DISCOVERY_INPUTS',
    hasWebsiteAcquisitionEvidence ? 'WEBSITE_ACQUISITION' : '',
    documentEvidenceObjectsForPack.length > 0 ? 'DOCUMENT_INGESTION' : '',
  ].filter(Boolean)
  const evidence = {
    source: evidenceSources.join('_AND_'),
    inputKeys,
    requiredInputKeys: REQUIRED_DISCOVERY_INPUT_KEYS,
    missingInputKeys,
    builtAt: refreshedAt,
    inputHash,
    sourceRefs,
    sourceCount: sources.length,
    acquisitionProfile: profile,
    coverage,
    confidence,
    reviewSummary,
  }
  const hasDocumentEvidence = documentEvidenceObjectsForPack.length > 0
  const evidenceHash = hashDiscoveryValue({
    acquisition,
    evidence,
    evidenceObjects,
    sourceRegistry,
    summaries: { compact: compactSummary },
    scopedViews,
  })
  const previousRevisions = Array.isArray(previousEvidencePack?.revisions)
    ? previousEvidencePack.revisions
    : []
  const revisions = [
    ...previousRevisions,
    {
      revisionId: `evidence-rev-${evidenceHash.replace(/^sha256:/, '').slice(0, 12)}`,
      createdAt: refreshedAt,
      createdBy: toIdString(actorUserId),
      reason,
      inputHash,
      evidenceHash,
      acquisitionProfile: profile,
    },
  ]

  return {
    acquisition,
    acquisitionProfile: profile,
    inputs: normalizedInputs,
    discovery: {
      seedProfile: {
        companyWebsite: normalizedInputs.companyWebsite || '',
        companyName: normalizedInputs.companyName || '',
        marketRegion: normalizedInputs.marketRegion || '',
        targetOffer: normalizedInputs.targetOffer || '',
        notes: normalizedInputs.notes || '',
        confidence: 'USER_PROVIDED',
        sourceRefs,
        acquisitionProfile: profile,
      },
    },
    summaries: {
      compact: compactSummary,
    },
    inputComplete,
    evidenceReady,
    accepted: false,
    needsRefresh: false,
    refreshedAt,
    state: {
      status: evidenceReady ? 'EVIDENCE_READY' : 'INPUT_REQUIRED',
      inputComplete,
      evidenceReady,
      accepted: false,
      needsRefresh: false,
      buildCompletedAt: refreshedAt,
      lastError: null,
      acquisitionProfile: profile,
    },
    evidence,
    sourceRegistry,
    evidenceObjects,
    discoveryHealth,
    acquisitionEffectiveness,
    scoped_views: scopedViews,
    lineage: {
      sources,
      builder: {
        mode: hasWebsiteAcquisitionEvidence && hasDocumentEvidence
          ? 'DETERMINISTIC_WEBSITE_AND_DOCUMENT_ACQUISITION'
          : hasWebsiteAcquisitionEvidence
            ? 'DETERMINISTIC_WEBSITE_ACQUISITION'
            : hasDocumentEvidence
              ? 'DETERMINISTIC_DOCUMENT_ACQUISITION'
              : 'DETERMINISTIC',
        version: 'discovery-evidence-pack-v1',
        adapter: [
          'customer-input',
          hasWebsiteAcquisitionEvidence ? 'website-html-fetch' : '',
          hasDocumentEvidence ? 'document-text-extraction' : '',
        ].filter(Boolean).join('+'),
        acquisitionProfile: profile,
      },
    },
    revisions,
  }
}

const normalizeDiscoveryResetReason = (reason) =>
  String(reason || DISCOVERY_RESET_REASON).trim() || DISCOVERY_RESET_REASON

const buildResetDiscoveryEvidencePack = ({
  actorUserId,
  clearedSectionTruthCount = 0,
  previousEvidencePack = {},
  previousEvidenceSummary = {},
  resetAt,
  resetReason,
} = {}) => {
  const profile = previousEvidencePack?.acquisition?.profile
    || previousEvidencePack?.acquisitionProfile
    || DISCOVERY_ACQUISITION_PROFILES.STANDARD
  const profileConfig = DISCOVERY_ACQUISITION_PROFILE_CONFIG[profile]
    || DISCOVERY_ACQUISITION_PROFILE_CONFIG[DISCOVERY_ACQUISITION_PROFILES.STANDARD]
  const previousRevisions = Array.isArray(previousEvidencePack?.revisions)
    ? previousEvidencePack.revisions
    : []
  const resetBy = toIdString(actorUserId)

  return {
    acquisitionProfile: profile,
    inputs: {},
    discovery: {
      seedProfile: {
        companyWebsite: '',
        companyName: '',
        marketRegion: '',
        targetOffer: '',
        notes: '',
        confidence: '',
        sourceRefs: [],
        acquisitionProfile: profile,
      },
    },
    summaries: {},
    inputComplete: false,
    evidenceReady: false,
    accepted: false,
    needsRefresh: false,
    resetAt,
    resetBy,
    resetReason,
    resetSummary: {
      resetAt,
      resetBy,
      resetReason,
      previousEvidenceSummary,
      clearedSectionTruthCount: Number.isFinite(Number(clearedSectionTruthCount))
        ? Number(clearedSectionTruthCount)
        : 0,
    },
    state: {
      status: 'RESET',
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      lastResetAt: resetAt,
      resetBy,
      resetReason,
      acquisitionProfile: profile,
    },
    evidence: {},
    acquisition: {
      profile,
      label: profileConfig.label,
      purpose: profileConfig.purpose,
      status: 'INPUT_REQUIRED',
      evidenceTarget: profileConfig.evidenceTarget,
      enabledSourceTypes: profileConfig.enabledSourceTypes,
      reservedSourceTypes: profileConfig.reservedSourceTypes,
      sourceRegistry: [],
      coverage: {
        status: 'INPUT_REQUIRED',
        requiredInputCount: REQUIRED_DISCOVERY_INPUT_KEYS.length,
        completedRequiredInputCount: 0,
        inputCount: 0,
        missingInputKeys: [...REQUIRED_DISCOVERY_INPUT_KEYS],
        missingAreas: [],
        sourceCount: 0,
        evidenceObjectCount: 0,
        acceptedEvidenceCount: 0,
        pendingReviewCount: 0,
        rejectedEvidenceCount: 0,
        score: 0,
      },
      confidence: {
        level: 'UNKNOWN',
        score: 0,
        basis: ['DISCOVERY_RESET'],
      },
      resetAt,
      resetBy,
    },
    sourceRegistry: [],
    evidenceObjects: [],
    discoveryHealth: {
      coveragePercent: 0,
      confidence: 'UNKNOWN',
      evidenceObjectCount: 0,
      acceptedEvidenceCount: 0,
      pendingReviewCount: 0,
      rejectedEvidenceCount: 0,
      sourceCount: 0,
      missingAreas: [],
      acquisitionProfile: profile,
      lastAcquisitionDate: '',
      resetAt,
    },
    scopedViews: {},
    scoped_views: {},
    lineage: {
      sources: [],
      builder: {
        mode: 'DISCOVERY_RESET',
        version: 'discovery-reset-v1',
        adapter: 'manual-reset',
        resetAt,
        resetBy,
      },
    },
    revisions: [
      ...previousRevisions,
      {
        revisionId: `evidence-reset-${crypto.randomUUID()}`,
        createdAt: resetAt,
        createdBy: resetBy,
        reason: resetReason,
        acquisitionProfile: profile,
      },
    ],
  }
}

const resetDiscoveryDependentSections = ({
  actorUserId,
  frameworkState,
  resetAt,
  resetReason,
} = {}) => {
  const previousSections = isPlainObject(frameworkState?.sections) ? frameworkState.sections : {}
  const nextSections = {}
  const clearedSections = []

  Object.entries(previousSections).forEach(([stateSectionKey, previousRawSection]) => {
    if (!isRuntimeSectionObject(previousRawSection)) {
      nextSections[stateSectionKey] = previousRawSection
      return
    }

    const sectionKey = normalizeSectionKey(previousRawSection?.lineage?.sectionKey || stateSectionKey)
    const runtimePath = normalizeRuntimePath(
      previousRawSection?.lineage?.runtimePath || `framework_state.sections.${stateSectionKey}`,
    )
    const sectionObject = normalizeRuntimeSectionObject({
      value: previousRawSection,
      sectionKey,
      runtimePath,
      initializedAt: resetAt,
    })
    const generated = getRuntimeSectionGenerated(sectionObject)
    const accepted = getRuntimeSectionAccepted(sectionObject)
    const hasGeneratedSnapshot = hasRuntimeSnapshotValue(generated)
    const hasAcceptedSnapshot = hasRuntimeSnapshotValue(accepted)

    if (!hasGeneratedSnapshot && !hasAcceptedSnapshot) {
      nextSections[stateSectionKey] = previousRawSection
      return
    }

    const existingRevisions = getRuntimeSectionRevisions(sectionObject)
    const nextRevisions = [
      ...existingRevisions,
      buildRuntimeSectionRevision({
        ...(hasGeneratedSnapshot ? { generated } : {}),
        ...(hasAcceptedSnapshot ? { accepted } : {}),
        reason: 'DISCOVERY_RESET',
        revisionNumber: existingRevisions.length + 1,
        replacedAt: resetAt,
      }),
    ]

    nextSections[stateSectionKey] = {
      ...sectionObject,
      generated: null,
      accepted: null,
      revisions: nextRevisions,
      review: {
        ...(sectionObject.review || {}),
        status: 'PENDING_REVIEW',
        invalidatedAt: resetAt,
        invalidationReason: 'DISCOVERY_RESET',
        invalidatedBy: toIdString(actorUserId),
      },
      state: {
        ...(sectionObject.state || {}),
        status: RUNTIME_SECTION_STATES.DRAFT,
        revisionCount: nextRevisions.length,
        inputHash: hashSectionInput(sectionObject.input),
        invalidatedAt: resetAt,
        invalidationReason: 'DISCOVERY_RESET',
        needsRegeneration: false,
        ...(hasGeneratedSnapshot ? { generatedInvalidatedAt: resetAt } : {}),
        ...(hasAcceptedSnapshot ? { acceptedInvalidatedAt: resetAt } : {}),
      },
      lineage: {
        ...(sectionObject.lineage || {}),
        sectionKey,
        stateSectionKey,
        runtimePath,
        inputHash: hashSectionInput(sectionObject.input),
        invalidatedAt: resetAt,
        invalidationReason: 'DISCOVERY_RESET',
      },
      dependencies: {
        ...(sectionObject.dependencies || {}),
        state: 'DISCOVERY_CONTEXT_RESET',
        reason: 'Intelligence Hub evidence was cleared. Regenerate this section before publish or lock.',
        invalidatedAt: resetAt,
        invalidatedByRuntimePath: DISCOVERY_EVIDENCE_PACK_PATH,
      },
      validation: {},
      confidence: {},
      intelligence: {
        ...(sectionObject.intelligence || {}),
        invalidation: {
          reason: 'DISCOVERY_RESET',
          resetReason,
          invalidatedAt: resetAt,
          archivedRevisionNumber: nextRevisions.length,
        },
        acceptedTruth: null,
      },
      metrics: {
        ...(sectionObject.metrics || {}),
        lastDiscoveryResetAt: resetAt,
        discoveryResetReason: resetReason,
        archivedTruthRevisionCount: nextRevisions.length,
      },
    }

    clearedSections.push({
      sectionKey,
      stateSectionKey,
      runtimePath,
      hadGenerated: hasGeneratedSnapshot,
      hadAccepted: hasAcceptedSnapshot,
      archivedRevisionNumber: nextRevisions.length,
    })
  })

  return {
    clearedSections,
    sections: nextSections,
  }
}

const assertRuntimeEditable = (runtimeInstance) => {
  const runtimeStatus = normalizeToken(runtimeInstance?.status)
  const executionStatus = normalizeToken(runtimeInstance?.executionStatus)
  const frameworkState = normalizeFrameworkStateForAction(runtimeInstance?.framework_state)
  const lifecycleStage = normalizeRuntimeActionToken(frameworkState.lifecycle?.stage)

  if (isRuntimeLocked({ runtimeInstance })) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is locked and cannot be mutated.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        runtimeStatus,
        lockedAt: runtimeInstance?.lockedAt || runtimeInstance?.framework_state?.lock?.lockedAt || null,
      },
    })
  }

  if (isRuntimeLifecycleTruthImmutable(frameworkState)) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime lifecycle truth is approved or published and cannot be directly mutated.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        lifecycleStage,
        immutableLifecycleStages: ['APPROVED', 'PUBLISHED', 'LOCKED'],
      },
    })
  }

  if (runtimeStatus !== RUNTIME_INSTANCE_STATUSES.ACTIVE) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is not editable in its current status.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        runtimeStatus,
        editableStatuses: [RUNTIME_INSTANCE_STATUSES.ACTIVE],
      },
    })
  }

  const blockedExecutionStatuses = [
    RUNTIME_EXECUTION_STATUSES.RUNNING,
    RUNTIME_EXECUTION_STATUSES.VALIDATING,
    RUNTIME_EXECUTION_STATUSES.COMPLETE,
    RUNTIME_EXECUTION_STATUSES.ERROR,
  ]

  if (blockedExecutionStatuses.includes(executionStatus)) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is not editable while execution is in progress or terminal.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        executionStatus,
        blockedExecutionStatuses,
      },
    })
  }
}

const buildStaleMutationError = ({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt }) =>
  buildMutationError({
    status: 409,
    code: 'CONFLICT',
    message: 'Runtime instance has changed since the renderer projection was loaded.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_STALE,
    details: {
      expectedUpdatedAt,
      currentUpdatedAt: currentUpdatedAt ?? (
        runtimeInstance?.updatedAt instanceof Date
          ? runtimeInstance.updatedAt.toISOString()
          : runtimeInstance?.updatedAt
      ),
    },
  })

const assertExpectedUpdatedAt = ({ runtimeInstance, expectedUpdatedAt }) => {
  const expectedTime = new Date(expectedUpdatedAt).getTime()
  const currentTime = new Date(runtimeInstance.updatedAt).getTime()

  if (!Number.isFinite(expectedTime) || !Number.isFinite(currentTime) || expectedTime !== currentTime) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt })
  }
}

const assertSupportedMutationRuntimeType = (runtimeType) => {
  const normalizedRuntimeType = normalizeToken(runtimeType)
  if (normalizedRuntimeType === RUNTIME_TYPES.VALUE_NARRATIVE) return

  throw buildMutationError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime state mutation is only available for Value Narrative runtimes in Sprint 1.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE,
    details: {
      runtimeType: normalizedRuntimeType,
      supportedRuntimeTypes: [RUNTIME_TYPES.VALUE_NARRATIVE],
    },
  })
}

const buildRuntimePathValueIssue = (message, runtimePath) => ({
  code: 'RUNTIME_PATH_VALUE_INVALID',
  severity: 'BLOCKING',
  message,
  path: 'value',
  runtimePath,
  source: 'runtime-state-mutation-service',
})

const validateRuntimePathValue = ({ runtimePathRecord, runtimePath, value }) => {
  const dataType = normalizeToken(runtimePathRecord?.dataType)
  const issues = []

  if (value === null) {
    if (runtimePathRecord?.isNullable === false) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" does not allow null values.`, runtimePath))
    }
    return issues
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM) {
    if (typeof value !== 'string') {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a string value.`, runtimePath))
      return issues
    }

    const minLength = Number(runtimePathRecord?.minLength)
    const maxLength = Number(runtimePathRecord?.maxLength)
    if (Number.isFinite(minLength) && value.length < minLength) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires at least ${minLength} characters.`, runtimePath))
    }
    if (Number.isFinite(maxLength) && value.length > maxLength) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" must be ${maxLength} characters or fewer.`, runtimePath))
    }

    const allowedValues = Array.isArray(runtimePathRecord?.allowedValues)
      ? runtimePathRecord.allowedValues
      : []
    if (allowedValues.length > 0 && !allowedValues.includes(value)) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires one of its configured allowed values.`, runtimePath))
    }

    const regexPattern = String(runtimePathRecord?.regexPattern || '').trim()
    if (regexPattern) {
      try {
        if (!new RegExp(regexPattern).test(value)) {
          issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" value does not match its configured pattern.`, runtimePath))
        }
      } catch {
        issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" has an invalid configured value pattern.`, runtimePath))
      }
    }
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a numeric value.`, runtimePath))
      return issues
    }

    const minValue = Number(runtimePathRecord?.minValue)
    const maxValue = Number(runtimePathRecord?.maxValue)
    if (Number.isFinite(minValue) && value < minValue) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a value greater than or equal to ${minValue}.`, runtimePath))
    }
    if (Number.isFinite(maxValue) && value > maxValue) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a value less than or equal to ${maxValue}.`, runtimePath))
    }
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN && typeof value !== 'boolean') {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a boolean value.`, runtimePath))
  }

  if (
    dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.OBJECT
    && (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
    )
  ) {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires an object value.`, runtimePath))
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ARRAY && !Array.isArray(value)) {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires an array value.`, runtimePath))
  }

  return issues
}

const resolveRuntimePathRecord = async (runtimePath) => {
  const query = RuntimePathRegistry.findOne({ pathKey: runtimePath })
  return typeof query.lean === 'function' ? query.lean() : query
}

const assertRuntimePathWritable = async ({
  frameworkKey,
  runtimePath,
  value,
  allowedWriteScopes = [SECTION_WRITE_SCOPE],
}) => {
  const issues = await validateRuntimeMutation({
    runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    frameworkKey,
    allowedWriteScopes,
  })

  if (issues.length > 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation path is not writable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, issues },
    })
  }

  const runtimePathRecord = await resolveRuntimePathRecord(runtimePath)
  const valueIssues = validateRuntimePathValue({ runtimePathRecord, runtimePath, value })

  if (valueIssues.length > 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation value is invalid.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, issues: valueIssues },
    })
  }

  return runtimePathRecord
}

export const assertRuntimeEvidencePackWritable = async ({
  frameworkKey,
  value,
}) => assertRuntimePathWritable({
  frameworkKey,
  runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
  value,
  allowedWriteScopes: [DISCOVERY_EVIDENCE_PACK_PATH],
})

const assertRuntimeSectionPathWritable = async ({
  frameworkKey,
  runtimePath,
}) => {
  const issues = await validateRuntimeMutation({
    runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    frameworkKey,
    allowedWriteScopes: [SECTION_WRITE_SCOPE],
  })

  if (issues.length > 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime section acceptance path is not writable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, issues },
    })
  }
}

const resolveSectionAcceptanceTarget = ({ frameworkPackage, payload }) => {
  const sectionKey = normalizeSectionKey(payload?.sectionKey)
  const runtimePath = normalizeRuntimePath(payload?.runtimePath)
  const sections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const sectionByKey = sectionKey
    ? sections.find((candidate) => normalizeSectionKey(candidate?.sectionKey || candidate?.key) === sectionKey)
    : null
  const sectionByPath = runtimePath
    ? sections.find((candidate) => normalizeRuntimePath(candidate?.runtimePath) === runtimePath)
    : null

  if (sectionKey && runtimePath && sectionByKey !== sectionByPath) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime section acceptance sectionKey and runtimePath must target the same package section.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_TARGET_MISMATCH,
      details: { sectionKey, runtimePath },
    })
  }

  const section = sectionByKey || sectionByPath
  if (!section) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime section acceptance requires a package-bound section target.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: { sectionKey, runtimePath },
    })
  }

  const resolvedRuntimePath = normalizeRuntimePath(section.runtimePath)
  const resolvedSectionKey = normalizeSectionKey(section.sectionKey || section.key)

  return {
    section,
    sectionKey: resolvedSectionKey,
    runtimePath: resolvedRuntimePath,
    stateSectionKey: getRuntimeSectionStateKey({
      runtimePath: resolvedRuntimePath,
      sectionKey: resolvedSectionKey,
    }),
  }
}

const resolveSectionEvidenceTarget = ({ frameworkPackage, payload }) => {
  const sectionKey = normalizeSectionKey(payload?.sectionKey)
  const runtimePath = normalizeRuntimePath(payload?.runtimePath)
  const sections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const sectionByKey = sectionKey
    ? sections.find((candidate) => normalizeSectionKey(candidate?.sectionKey || candidate?.key) === sectionKey)
    : null
  const sectionByPath = runtimePath
    ? sections.find((candidate) => normalizeRuntimePath(candidate?.runtimePath) === runtimePath)
    : null

  if (sectionKey && runtimePath && sectionByKey !== sectionByPath) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section evidence upload sectionKey and runtimePath must target the same package section.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_TARGET_MISMATCH,
      details: { sectionKey, runtimePath },
    })
  }

  const section = sectionByKey || sectionByPath
  if (!section) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section evidence upload requires a package-bound section target.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: { sectionKey, runtimePath },
    })
  }

  const resolvedRuntimePath = normalizeRuntimePath(section.runtimePath)
  const resolvedSectionKey = normalizeSectionKey(section.sectionKey || section.key)

  return {
    section,
    sectionKey: resolvedSectionKey,
    runtimePath: resolvedRuntimePath,
    stateSectionKey: getRuntimeSectionStateKey({
      runtimePath: resolvedRuntimePath,
      sectionKey: resolvedSectionKey,
    }),
  }
}

const assertSectionEvidenceTargetProjectable = async ({ frameworkPackage, target }) => {
  const [uiContract, runtimePathRecords] = await Promise.all([
    resolveUIContractForAdvance({ frameworkPackage }),
    resolveRuntimePathRecordsForAdvance({ frameworkPackage }),
  ])
  const projectableSections = buildProjectableSectionsForAdvance({
    frameworkPackage,
    runtimePathRecords,
    uiContract,
  })
  const isProjectable = projectableSections.some((section) =>
    normalizeRuntimePath(section.runtimePath) === target.runtimePath
      && normalizeSectionKey(section.sectionKey) === target.sectionKey,
  )

  if (!isProjectable) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section evidence upload requires a projected runtime section target.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }
}

const buildSectionAcceptanceUnavailableError = ({ message, runtimePath, sectionKey }) => buildMutationError({
  status: 409,
  code: 'CONFLICT',
  message,
  reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
  details: { runtimePath, sectionKey },
})

const getSectionAcceptanceRegenerationRequiredReason = (sectionObject = {}) => {
  const sectionState = sectionObject.state || {}
  const dependencyState = normalizeToken(sectionObject.dependencies?.state)

  if (sectionState.needsRegeneration === true) {
    const invalidationReason = normalizeToken(sectionState.acceptedInvalidationReason)
      || normalizeToken(sectionState.sectionEvidenceInvalidationReason)
      || normalizeToken(sectionObject.lineage?.sectionEvidenceInvalidationReason)
      || normalizeToken(sectionObject.intelligence?.invalidation?.reason)
    return invalidationReason === 'SECTION_EVIDENCE_CHANGED'
      ? 'Accepted section evidence changed. Regenerate this section before accepting truth.'
      : 'Section content is stale. Regenerate this section before accepting truth.'
  }

  if (dependencyState === 'DEPENDENCY_CONTEXT_INVALIDATED') {
    return 'Accepted upstream section truth changed. Regenerate this section before accepting truth.'
  }

  return ''
}

const normalizeComparableSectionContent = (value) => {
  if (value === null || value === undefined) return ''
  const candidate = value?.content ?? value
  if (typeof candidate === 'string') return candidate.trim()
  return JSON.stringify(cloneValue(candidate))
}

const isCurrentGeneratedAlreadyAccepted = ({ accepted, generated }) => {
  if (!accepted || !generated) return false

  const acceptedGeneratedAt = normalizeRuntimePath(accepted.sourceGeneratedAt)
  const generatedAt = normalizeRuntimePath(generated.generatedAt)
  const acceptedInputHash = normalizeRuntimePath(accepted.inputHash)
  const generatedInputHash = normalizeRuntimePath(generated.inputHash)

  if (acceptedGeneratedAt && generatedAt && acceptedGeneratedAt !== generatedAt) return false
  if (acceptedInputHash && generatedInputHash && acceptedInputHash !== generatedInputHash) return false

  if (acceptedGeneratedAt && generatedAt && acceptedInputHash && generatedInputHash) {
    return true
  }

  return normalizeComparableSectionContent(accepted) === normalizeComparableSectionContent(generated)
}

const buildAcceptedSectionTruth = ({
  actorUserId,
  acceptedAt,
  generated,
  previousAccepted,
  sectionKey,
  runtimePath,
}) => {
  const content = cloneValue(generated.content ?? generated)
  const truthHash = hashSectionTruthValue({
    content,
    evidenceHash: generated.evidenceHash || '',
    inputHash: generated.inputHash || '',
    runtimePath,
    sectionKey,
    sectionEvidenceHash: generated.sectionEvidenceHash || '',
    sourceGeneratedAt: generated.generatedAt || '',
  })
  const previousRevisions = Array.isArray(previousAccepted?.revisions)
    ? previousAccepted.revisions
    : []
  const acceptedRevisions = previousAccepted
    ? [
        ...previousRevisions,
        {
          revisionNumber: previousRevisions.length + 1,
          accepted: (() => {
            const snapshot = cloneValue(previousAccepted)
            if (snapshot && typeof snapshot === 'object') delete snapshot.revisions
            return snapshot
          })(),
          replacedAt: acceptedAt,
          reason: 'ACCEPTED_TRUTH_REPLACED',
        },
      ].slice(-10)
    : []

  return {
    format: generated.format || 'TEXT',
    content,
    summary: generated.summary || '',
    ...(Array.isArray(generated.sections) ? { sections: cloneValue(generated.sections) } : {}),
    ...(Array.isArray(generated.supportingEvidenceRefs)
      ? { supportingEvidenceRefs: cloneValue(generated.supportingEvidenceRefs) }
      : {}),
    ...(Array.isArray(generated.generationBoundaries)
      ? { generationBoundaries: cloneValue(generated.generationBoundaries) }
      : {}),
    truthHash,
    acceptedAt,
    acceptedBy: toIdString(actorUserId),
    sourceActionKey: generated.actionKey || '',
    sourceGeneratedAt: generated.generatedAt || '',
    inputHash: generated.inputHash || '',
    evidenceHash: generated.evidenceHash || '',
    sectionEvidenceHash: generated.sectionEvidenceHash || '',
    sectionKey,
    runtimePath,
    revisions: acceptedRevisions,
  }
}

const getDependencySectionKeys = (section = {}) => {
  const candidates = [
    section.dependsOnSectionKeys,
    section.dependencySectionKeys,
    section.dependsOn,
  ]

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map((candidate) => {
      if (candidate && typeof candidate === 'object') {
        return normalizeSectionKey(candidate.sectionKey || candidate.key)
      }
      return normalizeSectionKey(candidate)
    })
    .filter(Boolean)
}

const appendUnique = (values, nextValue) => {
  const normalizedNextValue = normalizeSectionKey(nextValue)
  return [
    ...new Set([
      ...(Array.isArray(values) ? values.map(normalizeSectionKey) : []),
      normalizedNextValue,
    ].filter(Boolean)),
  ]
}

const hasGeneratedOrAcceptedSectionTruth = (sectionObject) => {
  const generated = getRuntimeSectionGenerated(sectionObject)
  const accepted = getRuntimeSectionAccepted(sectionObject)
  return Boolean(
    String(generated?.content ?? '').trim()
    || String(accepted?.content ?? '').trim(),
  )
}

const applyAcceptedTruthDependencyInvalidations = ({
  acceptedAt,
  actorUserId,
  frameworkPackage,
  frameworkState,
  upstreamRuntimePath,
  upstreamSectionKey,
} = {}) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const stateSections = frameworkState?.sections
  if (!stateSections || typeof stateSections !== 'object' || Array.isArray(stateSections)) return []

  const invalidationRecords = []
  packageSections.forEach((packageSection) => {
    const downstreamSectionKey = normalizeSectionKey(packageSection?.sectionKey || packageSection?.key)
    const downstreamRuntimePath = normalizeRuntimePath(packageSection?.runtimePath)
    if (!downstreamSectionKey || !downstreamRuntimePath) return
    if (downstreamSectionKey === upstreamSectionKey) return
    if (!getDependencySectionKeys(packageSection).includes(upstreamSectionKey)) return

    const stateSectionKey = getRuntimeSectionStateKey({
      runtimePath: downstreamRuntimePath,
      sectionKey: downstreamSectionKey,
    })
    const previousRawSection = stateSections[stateSectionKey]
    if (previousRawSection === undefined) return

    const downstreamSection = normalizeRuntimeSectionObject({
      value: previousRawSection,
      sectionKey: downstreamSectionKey,
      runtimePath: downstreamRuntimePath,
    })
    if (!isRuntimeSectionObject(downstreamSection) || !hasGeneratedOrAcceptedSectionTruth(downstreamSection)) return

    const previousDependencies = downstreamSection.dependencies || {}
    const invalidationRecord = {
      sectionKey: downstreamSectionKey,
      runtimePath: downstreamRuntimePath,
      invalidatedBySectionKey: upstreamSectionKey,
      invalidatedByRuntimePath: upstreamRuntimePath,
      upstreamAcceptedAt: acceptedAt,
      invalidatedAt: acceptedAt,
      invalidatedBy: toIdString(actorUserId),
      reason: 'UPSTREAM_ACCEPTED_TRUTH_CHANGED',
    }
    const previousInvalidations = Array.isArray(previousDependencies.invalidations)
      ? previousDependencies.invalidations
      : []

    stateSections[stateSectionKey] = {
      ...downstreamSection,
      dependencies: {
        ...previousDependencies,
        state: 'DEPENDENCY_CONTEXT_INVALIDATED',
        reason: 'Accepted upstream section truth changed. Regenerate this section before publish or lock.',
        invalidatedAt: acceptedAt,
        invalidatedBySectionKey: upstreamSectionKey,
        invalidatedByRuntimePath: upstreamRuntimePath,
        invalidatedSectionKeys: appendUnique(previousDependencies.invalidatedSectionKeys, upstreamSectionKey),
        invalidations: [
          ...previousInvalidations,
          invalidationRecord,
        ].slice(-10),
      },
      state: {
        ...(downstreamSection.state || {}),
        dependencyStatus: 'DEPENDENCY_CONTEXT_INVALIDATED',
        dependencyInvalidatedAt: acceptedAt,
        needsRegeneration: true,
      },
      lineage: {
        ...(downstreamSection.lineage || {}),
        dependencyInvalidatedAt: acceptedAt,
        dependencyInvalidatedBySectionKey: upstreamSectionKey,
        dependencyInvalidatedByRuntimePath: upstreamRuntimePath,
      },
    }
    invalidationRecords.push(invalidationRecord)
  })

  return invalidationRecords
}

const buildDependencyInvalidationAuditDiff = (dependencyInvalidations = []) => {
  if (!Array.isArray(dependencyInvalidations) || dependencyInvalidations.length === 0) return {}

  return {
    dependencyInvalidations: dependencyInvalidations.map((invalidation) => ({
      sectionKey: normalizeSectionKey(invalidation?.sectionKey),
      runtimePath: normalizeRuntimePath(invalidation?.runtimePath),
      invalidatedBySectionKey: normalizeSectionKey(invalidation?.invalidatedBySectionKey),
      invalidatedByRuntimePath: normalizeRuntimePath(invalidation?.invalidatedByRuntimePath),
      invalidatedAt: invalidation?.invalidatedAt || '',
      upstreamAcceptedAt: invalidation?.upstreamAcceptedAt || '',
      reason: normalizeToken(invalidation?.reason),
    })),
  }
}

const resolveRuntimeInstanceForMutation = async ({ actorUserId, runtimeInstanceId, scopes }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  assertSupportedMutationRuntimeType(runtimeType)

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId,
    tenantId,
    permission: 'VMF_UPDATE',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeType),
  })

  return runtimeInstance
}

const resolveRuntimeInstanceForEvidenceRead = async ({ actorUserId, runtimeInstanceId, scopes }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  assertSupportedMutationRuntimeType(runtimeType)

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId,
    tenantId,
    permission: 'VMF_VIEW',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeType),
  })

  let canViewRawEvidence = false
  try {
    await assertRuntimePermission({
      actorUserId,
      scopes,
      customerId,
      tenantId,
      permission: 'VMF_UPDATE',
    })
    canViewRawEvidence = true
  } catch {
    canViewRawEvidence = false
  }

  return { runtimeInstance, canViewRawEvidence }
}

const resolveRuntimeInstanceForGraphRebuild = async ({ actorUserId, runtimeInstanceId, scopes }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  assertSupportedMutationRuntimeType(runtimeType)

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId,
    tenantId,
    permission: 'VMF_UPDATE',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeType),
  })

  return runtimeInstance
}

const buildMutationAuditPayload = ({
  actorUserId,
  additionalDiff = {},
  runtimeInstance,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
}) => ({
  action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
  resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
  resourceId: runtimeInstance._id,
  actorUserId,
  scope: {
    customerId: toIdString(runtimeInstance.customerId),
    tenantId: toIdString(runtimeInstance.tenantId),
    runtimeInstanceId: toIdString(runtimeInstance._id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
  },
  diff: {
    runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    previousValue,
    nextValue,
    expectedUpdatedAt,
    updatedAtBefore,
    updatedAtAfter: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
    runtimeType: runtimeInstance.runtimeType,
    frameworkKey: runtimeInstance.frameworkKey,
    packageKey: runtimeInstance.packageKey,
    packageVersion: runtimeInstance.packageVersion,
    ...additionalDiff,
  },
})

const logRuntimeStateMutated = async ({
  actorUserId,
  additionalDiff = {},
  auditRequest,
  runtimeInstance,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
  session = null,
}) => {
  const auditPayload = buildMutationAuditPayload({
    actorUserId,
    additionalDiff,
    runtimeInstance,
    runtimePath,
    previousValue,
    nextValue,
    expectedUpdatedAt,
    updatedAtBefore,
  })
  const auditOptions = {
    throwOnError: true,
    ...(session ? { session } : {}),
  }

  try {
    if (auditRequest) {
      await auditService.logFromRequest(auditRequest, auditPayload, auditOptions)
      return
    }

    await auditService.log(auditPayload, auditOptions)
  } catch (err) {
    throw buildMutationError({
      status: 500,
      code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED',
      message: 'Runtime state mutation audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED,
      details: {
        auditError: serializeErrorDetails(err),
      },
    })
  }
}

const normalizeUpdatedAtDate = (updatedAt) => {
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  return Number.isFinite(updatedAtDate.getTime()) ? updatedAtDate : null
}

const serializeErrorDetails = (err) => ({
  name: err?.name || 'Error',
  message: err?.message || 'Unknown error',
  ...(err?.code ? { code: err.code } : {}),
})

const logRuntimeStateRollbackFailure = async ({
  auditError,
  rollbackError = null,
  runtimeInstance,
  runtimePath,
  updatedRuntimeInstance,
}) => auditService.log({
  action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
  resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
  resourceId: runtimeInstance?._id,
  actorType: 'SYSTEM',
  systemActor: 'runtime-state-rollback',
  isSystemEvent: true,
  systemEventType: 'RUNTIME_STATE_ROLLBACK_FAILED',
  eventCategory: 'RUNTIME',
  eventSeverity: 'CRITICAL',
  scope: {
    customerId: toIdString(runtimeInstance?.customerId),
    tenantId: toIdString(runtimeInstance?.tenantId),
    runtimeInstanceId: toIdString(runtimeInstance?._id),
    runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey,
  },
  diff: {
    runtimePath,
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED,
    auditError: serializeErrorDetails(auditError),
    ...(rollbackError ? { rollbackError: serializeErrorDetails(rollbackError) } : {}),
    attemptedRollbackUpdatedAt: updatedRuntimeInstance?.updatedAt instanceof Date
      ? updatedRuntimeInstance.updatedAt.toISOString()
      : updatedRuntimeInstance?.updatedAt,
  },
})

const atomicPersistRuntimeState = async ({
  actorUserId,
  expectedUpdatedAt,
  nextFrameworkState,
  runtimeInstance,
  session = null,
}) => {
  const expectedUpdatedAtDate = normalizeUpdatedAtDate(expectedUpdatedAt)
  if (!expectedUpdatedAtDate) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt })
  }

  const updatedRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: expectedUpdatedAtDate,
    },
    {
      $set: {
        framework_state: nextFrameworkState,
        updatedBy: actorUserId || runtimeInstance.updatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
      ...(session ? { session } : {}),
    },
  )

  if (!updatedRuntimeInstance) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt: null })
  }

  return updatedRuntimeInstance
}

const rollbackRuntimeStateMutation = async ({
  previousFrameworkState,
  previousUpdatedBy,
  runtimeInstance,
  updatedRuntimeInstance,
}) => {
  const rollbackUpdatedAt = normalizeUpdatedAtDate(updatedRuntimeInstance?.updatedAt)
  if (!rollbackUpdatedAt) return false

  const rolledBackRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: rollbackUpdatedAt,
    },
    {
      $set: {
        framework_state: previousFrameworkState,
        updatedBy: previousUpdatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  )

  return Boolean(rolledBackRuntimeInstance)
}

const persistMutationWithAudit = async ({
  actorUserId,
  additionalDiff = {},
  auditRequest,
  runtimeInstance,
  nextFrameworkState,
  previousFrameworkState,
  previousUpdatedBy,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
}) => {
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let updatedRuntimeInstance = null
    try {
      await session.withTransaction(async () => {
        updatedRuntimeInstance = await atomicPersistRuntimeState({
          actorUserId,
          expectedUpdatedAt,
          nextFrameworkState,
          runtimeInstance,
          session,
        })
        await logRuntimeStateMutated({
          actorUserId,
          additionalDiff,
          auditRequest,
          runtimeInstance: updatedRuntimeInstance,
          runtimePath,
          previousValue,
          nextValue,
          expectedUpdatedAt,
          updatedAtBefore,
          session,
        })
      })
    } finally {
      await session.endSession()
    }
    return updatedRuntimeInstance
  }

  const updatedRuntimeInstance = await atomicPersistRuntimeState({
    actorUserId,
    expectedUpdatedAt,
    nextFrameworkState,
    runtimeInstance,
  })

  try {
    await logRuntimeStateMutated({
      actorUserId,
      additionalDiff,
      auditRequest,
      runtimeInstance: updatedRuntimeInstance,
      runtimePath,
      previousValue,
      nextValue,
      expectedUpdatedAt,
      updatedAtBefore,
    })
  } catch (err) {
    try {
      const rollbackSucceeded = await rollbackRuntimeStateMutation({
        previousFrameworkState,
        previousUpdatedBy,
        runtimeInstance,
        updatedRuntimeInstance,
      })
      if (!rollbackSucceeded) {
        err.details = {
          ...(err.details || {}),
          rollbackFailed: true,
        }
        await logRuntimeStateRollbackFailure({
          auditError: err,
          runtimeInstance,
          runtimePath,
          updatedRuntimeInstance,
        })
      }
    } catch (rollbackErr) {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
        rollbackError: serializeErrorDetails(rollbackErr),
      }
      await logRuntimeStateRollbackFailure({
        auditError: err,
        rollbackError: rollbackErr,
        runtimeInstance,
        runtimePath,
        updatedRuntimeInstance,
      })
    }
    throw err
  }

  return updatedRuntimeInstance
}

const resolvePackageForAdvance = async (packageId) => {
  const packageRecord = await FrameworkPackage.findById(packageId)
  if (packageRecord && typeof packageRecord.toObject === 'function') {
    return packageRecord.toObject()
  }
  return packageRecord
}

const resolveUIContractForAdvance = async ({ frameworkPackage }) => {
  const uiContractKey = normalizeSectionKey(frameworkPackage?.uiContractBinding?.key || frameworkPackage?.uiContractKey)
  if (!uiContractKey) return null

  return UIContract.findOne({
    uiContractKey,
    status: UI_CONTRACT_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage?.frameworkKey),
  }).lean()
}

const resolveRuntimePathRecordsForAdvance = async ({ frameworkPackage }) => {
  const runtimePaths = (Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : [])
    .map((section) => normalizeRuntimePath(section?.runtimePath))
    .filter(Boolean)

  if (runtimePaths.length === 0) return new Map()

  const rows = await RuntimePathRegistry.find({
    pathKey: { $in: [...new Set(runtimePaths)] },
    status: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage?.frameworkKey),
  }).lean()

  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [normalizeRuntimePath(row?.pathKey), row]),
  )
}

const buildUISectionIndexForAdvance = (uiContract) => {
  const sections = Array.isArray(uiContract?.sections) ? uiContract.sections : []
  return new Map(
    sections
      .map((section) => {
        const sectionKey = normalizeSectionKey(section?.sectionKey)
        const runtimePath = normalizeRuntimePath(section?.runtimePath)
        return sectionKey && runtimePath ? [`${sectionKey}::${runtimePath}`, section] : null
      })
      .filter(Boolean),
  )
}

const buildProjectableSectionsForAdvance = ({ frameworkPackage, runtimePathRecords, uiContract }) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const uiSectionsByExactKey = buildUISectionIndexForAdvance(uiContract)

  return packageSections
    .map((packageSection, packageIndex) => {
      const sectionKey = normalizeSectionKey(packageSection?.sectionKey || packageSection?.key)
      const runtimePath = normalizeRuntimePath(packageSection?.runtimePath)
      if (!sectionKey || !runtimePath) return null

      const runtimePathRecord = runtimePathRecords.get(runtimePath)
      const allowedOperations = Array.isArray(runtimePathRecord?.allowedOperations)
        ? runtimePathRecord.allowedOperations.map(normalizeToken)
        : []
      if (!runtimePathRecord || !allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.READ)) {
        return null
      }

      const uiSection = uiSectionsByExactKey.get(`${sectionKey}::${runtimePath}`) || null
      if (uiSection?.isVisible === false) return null

      return {
        sectionKey,
        runtimePath,
        displayOrder: Number.isFinite(Number(uiSection?.displayOrder))
          ? Number(uiSection.displayOrder)
          : Number.isFinite(Number(runtimePathRecord.displayOrder))
            ? Number(runtimePathRecord.displayOrder)
            : (packageIndex + 1) * 10,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.sectionKey.localeCompare(right.sectionKey))
}

const buildSaveAndNextAdvance = async ({ runtimeInstance, runtimePath, requested }) => {
  if (!requested) return undefined

  const currentRuntimePath = normalizeRuntimePath(runtimePath)
  const fallbackCurrentSectionKey = getSectionKeyFromRuntimePath(currentRuntimePath)
  const unavailableAdvance = {
    requested: true,
    hasNext: false,
    currentRuntimePath,
    currentSectionKey: fallbackCurrentSectionKey,
    nextRuntimePath: '',
    nextSectionKey: '',
    reason: 'END_OF_GUIDED_SECTIONS',
  }

  let projectableSections = []
  let packageHasCurrentSection = false
  try {
    const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
    const [uiContract, runtimePathRecords] = await Promise.all([
      resolveUIContractForAdvance({ frameworkPackage }),
      resolveRuntimePathRecordsForAdvance({ frameworkPackage }),
    ])
    const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
    packageHasCurrentSection = packageSections.some((section) =>
      normalizeRuntimePath(section?.runtimePath) === currentRuntimePath,
    )
    projectableSections = buildProjectableSectionsForAdvance({
      frameworkPackage,
      runtimePathRecords,
      uiContract,
    })
  } catch {
    return {
      ...unavailableAdvance,
      reason: 'ADVANCE_RESOLUTION_FAILED',
    }
  }

  if (projectableSections.length === 0) {
    return {
      ...unavailableAdvance,
      reason: packageHasCurrentSection
        ? 'CURRENT_SECTION_NOT_PROJECTABLE'
        : 'PACKAGE_SECTIONS_NOT_PROJECTED',
    }
  }

  const currentIndex = projectableSections.findIndex((section) =>
    section.runtimePath === currentRuntimePath,
  )

  if (currentIndex < 0) {
    return {
      ...unavailableAdvance,
      reason: 'CURRENT_SECTION_NOT_PROJECTABLE',
    }
  }

  const currentSection = projectableSections[currentIndex]
  const currentSectionKey = normalizeSectionKey(currentSection?.sectionKey)
    || fallbackCurrentSectionKey
  const nextSection = projectableSections[currentIndex + 1]

  if (!nextSection) {
    return {
      ...unavailableAdvance,
      currentSectionKey,
    }
  }

  const nextRuntimePath = normalizeRuntimePath(nextSection.runtimePath)
  return {
    requested: true,
    hasNext: true,
    currentRuntimePath,
    currentSectionKey,
    nextRuntimePath,
    nextSectionKey: normalizeSectionKey(nextSection.sectionKey)
      || getSectionKeyFromRuntimePath(nextRuntimePath),
    reason: '',
  }
}

export const mutateRuntimeState = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const runtimePath = normalizeRuntimePath(payload?.runtimePath)
  const operation = normalizeToken(payload?.operation)
  const value = payload?.value
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const saveAndNextRequested = payload?.saveAndNext === true

  if (operation !== RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation only supports WRITE in Sprint 1.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { operation, supportedOperations: [RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE] },
    })
  }

  assertSafeRuntimePathParts(runtimePath)

  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })
  await assertRuntimePathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath,
    value,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const { nextFrameworkState: frameworkStateAfterWrite, previousValue } = setValueAtPath({
    frameworkState: runtimeInstance.framework_state || {},
    runtimePath,
    value,
  })
  const nextFrameworkState = invalidateSectionMutationEvidence({
    nextFrameworkState: frameworkStateAfterWrite,
    runtimePath,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath,
    previousValue,
    nextValue: cloneValue(value),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  const response = {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    mutation: {
      runtimePath,
      operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
      previousValue,
      value: cloneValue(value),
    },
  }

  const advance = await buildSaveAndNextAdvance({
    runtimeInstance: updatedRuntimeInstance,
    runtimePath,
    requested: saveAndNextRequested,
  })

  if (advance) {
    response.advance = advance
  }

  return response
}

export const updateRuntimeDiscoveryInputs = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousEvidencePack = cloneValue(previousFrameworkState.evidence_pack || {})
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const nextEvidencePack = await buildDiscoveryEvidencePack({
    acquisitionProfile: payload?.acquisitionProfile,
    actorUserId,
    documentSources: payload?.documentSources,
    inputs: payload?.inputs || {},
    previousEvidencePack,
    reason: 'SAVE_DISCOVERY_INPUTS',
    runtimeInstance,
  })
  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })
  const nextFrameworkState = {
    ...previousFrameworkState,
    evidence_pack: nextEvidencePack,
  }
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EVIDENCE_UPDATED,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: graphRebuild.auditDiff,
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    previousValue: previousEvidencePack,
    nextValue: cloneValue(nextEvidencePack),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildDiscoveryMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    evidencePack: nextEvidencePack,
    previousEvidencePack,
  })
}

export const acceptRuntimeDiscovery = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousEvidencePack = cloneValue(previousFrameworkState.evidence_pack || {})
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt

  assertDiscoveryEvidenceAcceptable(previousEvidencePack)

  const acceptedAt = new Date().toISOString()
  const acceptedEvidenceObjects = acceptPendingDiscoveryEvidenceObjects({
    acceptedAt,
    actorUserId,
    evidenceObjects: normalizeDiscoveryEvidenceObjects({
      acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
      createdAt: previousEvidencePack.refreshedAt || acceptedAt,
      evidenceObjects: previousEvidencePack.evidenceObjects,
      inputs: previousEvidencePack.inputs,
      sources: previousEvidencePack.lineage?.sources || [],
    }),
  })
  const sourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: previousEvidencePack.refreshedAt || acceptedAt,
    evidenceObjects: acceptedEvidenceObjects,
    sourceRegistry: previousEvidencePack.sourceRegistry,
    sources: previousEvidencePack.lineage?.sources || [],
  })
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(acceptedEvidenceObjects)
  const acceptedScopedViews = buildAcceptedDiscoveryScopedViews({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    evidenceObjects: acceptedEvidenceObjects,
    inputHash: previousEvidencePack.evidence?.inputHash || '',
    previousScopedViews: previousEvidencePack.scoped_views || previousEvidencePack.scopedViews || {},
    refreshedAt: previousEvidencePack.refreshedAt || acceptedAt,
  })
  const previousCoverage = previousEvidencePack.acquisition?.coverage || previousEvidencePack.evidence?.coverage || {}
  const hasCoverageSummary = isPlainObject(previousCoverage) && Object.keys(previousCoverage).length > 0
  const acceptedCoverage = hasCoverageSummary
    ? buildAcceptedDiscoveryCoverage({
        ...previousCoverage,
        sourceCount: sourceRegistry.length || previousCoverage.sourceCount,
        evidenceObjectCount: reviewSummary.evidenceObjectCount,
        rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
      })
    : null
  const discoveryHealth = buildDiscoveryHealth({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    coverage: {
      ...(acceptedCoverage || {}),
      confidence: previousEvidencePack.acquisition?.confidence || previousEvidencePack.evidence?.confidence,
    },
    evidenceObjects: acceptedEvidenceObjects,
    lastAcquisitionDate: previousEvidencePack.refreshedAt || acceptedAt,
    sourceRegistry,
  })
  const acquisitionEffectiveness = buildDiscoveryAcquisitionEffectiveness({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    discoveryHealth,
    evidenceObjects: acceptedEvidenceObjects,
    inputs: previousEvidencePack.inputs || {},
    sourceRegistry,
  })
  const nextEvidencePack = {
    ...previousEvidencePack,
    inputComplete: true,
    evidenceReady: true,
    accepted: true,
    needsRefresh: false,
    acceptedAt,
    acceptedBy: toIdString(actorUserId),
    sourceRegistry,
    evidenceObjects: acceptedEvidenceObjects,
    discoveryHealth,
    acquisitionEffectiveness,
    scopedViews: acceptedScopedViews,
    scoped_views: acceptedScopedViews,
    ...(acceptedCoverage && isPlainObject(previousEvidencePack.acquisition)
      ? {
          acquisition: {
            ...previousEvidencePack.acquisition,
            sourceRegistry,
            coverage: acceptedCoverage,
            discoveryHealth,
            effectiveness: acquisitionEffectiveness,
          },
        }
      : {}),
    evidence: isPlainObject(previousEvidencePack.evidence) && acceptedCoverage
      ? {
          ...previousEvidencePack.evidence,
          coverage: acceptedCoverage,
          reviewSummary,
        }
      : previousEvidencePack.evidence,
    state: {
      ...(previousEvidencePack.state || {}),
      status: 'ACCEPTED',
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
    },
  }

  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })

  const nextFrameworkState = {
    ...previousFrameworkState,
    evidence_pack: nextEvidencePack,
  }
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EVIDENCE_ACCEPTED,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: graphRebuild.auditDiff,
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    previousValue: previousEvidencePack,
    nextValue: cloneValue(nextEvidencePack),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildDiscoveryMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    evidencePack: nextEvidencePack,
    previousEvidencePack,
  })
}

export const reviewRuntimeDiscoveryEvidence = async ({
  actorUserId,
  auditRequest,
  evidenceObjectId,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const reviewStatus = normalizeToken(payload?.reviewStatus)
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousEvidencePack = cloneValue(previousFrameworkState.evidence_pack || {})
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt

  if (!getEvidencePackStateFlag(previousEvidencePack, 'evidenceReady') || getEvidencePackNeedsRefresh(previousEvidencePack)) {
    throw buildDiscoveryAcceptanceUnavailableError('Intelligence Hub evidence must be refreshed before evidence review.')
  }

  const reviewedAt = new Date().toISOString()
  const previousEvidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    createdAt: previousEvidencePack.refreshedAt || reviewedAt,
    evidenceObjects: previousEvidencePack.evidenceObjects,
    inputs: previousEvidencePack.inputs,
    sources: previousEvidencePack.lineage?.sources || [],
  })
  const reviewResult = applyDiscoveryEvidenceReview({
    actorUserId,
    evidenceObjectId,
    evidenceObjects: previousEvidenceObjects,
    reviewStatus,
    reviewedAt,
  })

  if (!reviewResult.found) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Intelligence Hub evidence object was not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        evidenceObjectId,
        runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
      },
    })
  }

  const sourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: previousEvidencePack.refreshedAt || reviewedAt,
    evidenceObjects: reviewResult.evidenceObjects,
    sourceRegistry: previousEvidencePack.sourceRegistry,
    sources: previousEvidencePack.lineage?.sources || [],
  })
  const reviewSummary = buildDiscoveryEvidenceReviewSummary(reviewResult.evidenceObjects)
  const previousCoverage = previousEvidencePack.acquisition?.coverage || previousEvidencePack.evidence?.coverage || {}
  const nextCoverage = isPlainObject(previousCoverage)
    ? {
        ...previousCoverage,
        sourceCount: sourceRegistry.length || previousCoverage.sourceCount,
        evidenceObjectCount: reviewSummary.evidenceObjectCount,
        acceptedEvidenceCount: reviewSummary.acceptedEvidenceCount,
        pendingReviewCount: reviewSummary.pendingReviewCount,
        rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
      }
    : previousCoverage
  const discoveryHealth = buildDiscoveryHealth({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    coverage: {
      ...nextCoverage,
      confidence: previousEvidencePack.acquisition?.confidence || previousEvidencePack.evidence?.confidence,
    },
    evidenceObjects: reviewResult.evidenceObjects,
    lastAcquisitionDate: previousEvidencePack.refreshedAt || reviewedAt,
    sourceRegistry,
  })
  const acquisitionEffectiveness = buildDiscoveryAcquisitionEffectiveness({
    acquisitionProfile: previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile,
    discoveryHealth,
    evidenceObjects: reviewResult.evidenceObjects,
    inputs: previousEvidencePack.inputs || {},
    sourceRegistry,
  })
  const nextEvidencePack = {
    ...previousEvidencePack,
    accepted: false,
    needsRefresh: false,
    sourceRegistry,
    evidenceObjects: reviewResult.evidenceObjects,
    discoveryHealth,
    acquisitionEffectiveness,
    acquisition: isPlainObject(previousEvidencePack.acquisition)
      ? {
          ...previousEvidencePack.acquisition,
          sourceRegistry,
          coverage: nextCoverage,
          discoveryHealth,
          effectiveness: acquisitionEffectiveness,
        }
      : previousEvidencePack.acquisition,
    evidence: isPlainObject(previousEvidencePack.evidence)
      ? {
          ...previousEvidencePack.evidence,
          coverage: nextCoverage,
          reviewSummary,
        }
      : previousEvidencePack.evidence,
    state: {
      ...(previousEvidencePack.state || {}),
      status: 'EVIDENCE_READY',
      accepted: false,
      needsRefresh: false,
      lastReviewedAt: reviewedAt,
      lastReviewedEvidenceObjectId: String(evidenceObjectId || '').trim(),
      lastReviewStatus: reviewStatus,
    },
  }

  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })

  const nextFrameworkState = {
    ...previousFrameworkState,
    evidence_pack: nextEvidencePack,
  }
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EVIDENCE_REVIEWED,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: graphRebuild.auditDiff,
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    previousValue: previousEvidencePack,
    nextValue: cloneValue(nextEvidencePack),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildDiscoveryMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    evidencePack: nextEvidencePack,
    previousEvidencePack,
  })
}

const buildDiscoveryResetAuditSummary = (evidencePack = {}) => {
  const scopedViews = getCanonicalScopedViews(evidencePack)
  return {
    accepted: getEvidencePackStateFlag(evidencePack, 'accepted'),
    stateStatus: evidencePack?.state?.status || '',
    inputCount: Object.keys(evidencePack?.inputs || {}).length,
    sourceCount: Array.isArray(evidencePack?.lineage?.sources) ? evidencePack.lineage.sources.length : 0,
    sourceRegistryCount: Array.isArray(evidencePack?.sourceRegistry) ? evidencePack.sourceRegistry.length : 0,
    evidenceObjectCount: Array.isArray(evidencePack?.evidenceObjects) ? evidencePack.evidenceObjects.length : 0,
    scopedViewCount: Object.keys(scopedViews).length,
    acceptedAt: evidencePack?.acceptedAt || '',
    acquisitionProfile: evidencePack?.acquisition?.profile || evidencePack?.acquisitionProfile || '',
  }
}

export const resetRuntimeDiscovery = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  if (payload?.confirmReset !== true) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Intelligence Hub reset requires explicit confirmation.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        confirmReset: 'confirmReset must be true.',
        runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
      },
    })
  }

  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousEvidencePack = cloneValue(previousFrameworkState.evidence_pack || {})
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const resetAt = new Date().toISOString()
  const resetReason = normalizeDiscoveryResetReason(payload?.reason)
  const previousEvidenceSummary = buildDiscoveryResetAuditSummary(previousEvidencePack)
  const { clearedSections, sections } = resetDiscoveryDependentSections({
    actorUserId,
    frameworkState: previousFrameworkState,
    resetAt,
    resetReason,
  })
  const nextEvidencePack = buildResetDiscoveryEvidencePack({
    actorUserId,
    clearedSectionTruthCount: clearedSections.length,
    previousEvidencePack,
    previousEvidenceSummary,
    resetAt,
    resetReason,
  })
  const nextEvidenceSummary = buildDiscoveryResetAuditSummary(nextEvidencePack)

  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })
  await Promise.all(clearedSections.map((section) =>
    assertRuntimeSectionPathWritable({
      frameworkKey: runtimeInstance.frameworkKey,
      runtimePath: section.runtimePath,
    })))

  const nextFrameworkState = {
    ...previousFrameworkState,
    lifecycle: {
      ...(previousFrameworkState.lifecycle || {}),
      stage: 'DRAFT',
      updatedAt: resetAt,
      updatedBy: toIdString(actorUserId),
      invalidatedAt: resetAt,
      invalidationReason: 'DISCOVERY_RESET',
    },
    evidence_pack: nextEvidencePack,
    sections,
    validation: {},
    readiness: {
      state: 'DRAFT',
      ready: false,
      submittedForReview: false,
      validationState: 'UNKNOWN',
      invalidatedByRuntimePath: DISCOVERY_EVIDENCE_PACK_PATH,
      invalidatedAt: resetAt,
      reason: 'Intelligence Hub evidence and section truth were reset.',
      sectionTruth: {
        state: 'DISCOVERY_RESET',
        publishEligible: false,
        lockEligible: false,
        requiredSectionCount: 0,
        readySectionCount: 0,
        blockingSectionCount: clearedSections.length,
        readySectionKeys: [],
        blockers: clearedSections.map((section) => ({
          sectionKey: section.sectionKey,
          runtimePath: section.runtimePath,
          state: 'DISCOVERY_RESET',
          reason: 'Intelligence Hub reset cleared generated or accepted truth.',
        })),
        reason: 'Intelligence Hub reset cleared generated or accepted truth. Rebuild Intelligence Hub and regenerate sections.',
      },
    },
  }
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.DISCOVERY_RESET,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      reason: 'DISCOVERY_RESET',
      resetReason,
      resetAt,
      resetBy: toIdString(actorUserId),
      previousEvidenceSummary,
      nextEvidenceSummary,
      clearedSectionTruthCount: clearedSections.length,
      clearedSectionTruths: clearedSections,
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    previousValue: previousEvidencePack,
    nextValue: cloneValue(nextEvidencePack),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return {
    ...buildDiscoveryMutationResponse({
      runtimeInstance: updatedRuntimeInstance,
      evidencePack: nextEvidencePack,
      previousEvidencePack,
    }),
    reset: {
      resetAt,
      resetBy: toIdString(actorUserId),
      resetReason,
      clearedSectionTruthCount: clearedSections.length,
      clearedSectionTruths: clearedSections,
    },
  }
}

const resolveFrameworkPackageForGraph = async (runtimeInstance) => {
  if (!runtimeInstance?.packageId) return null
  const query = FrameworkPackage.findById(runtimeInstance.packageId)
  return typeof query?.lean === 'function' ? query.lean() : query
}

const normalizeRuntimeIntelligenceGraphTrigger = (trigger) => {
  const normalizedTrigger = normalizeToken(trigger)
  if (Object.values(RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS).includes(normalizedTrigger)) {
    return normalizedTrigger
  }
  return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD
}

const rebuildRuntimeIntelligenceGraphForMutation = async ({
  actorUserId,
  autoRebuilt = true,
  buildTrigger,
  frameworkPackage = null,
  nextFrameworkState,
  previousFrameworkState,
  runtimeInstance,
} = {}) => {
  const normalizedBuildTrigger = normalizeRuntimeIntelligenceGraphTrigger(buildTrigger)
  const resolvedFrameworkPackage = frameworkPackage || await resolveFrameworkPackageForGraph(runtimeInstance)
  const previousGraph = cloneValue(previousFrameworkState?.intelligence_graph || {})
  const nextGraph = buildRuntimeIntelligenceGraphForFrameworkState({
    actorUserId,
    buildTrigger: normalizedBuildTrigger,
    frameworkPackage: resolvedFrameworkPackage,
    frameworkState: nextFrameworkState,
    runtimeInstance,
  })

  if (nextGraph.validation?.status !== 'VALID') {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime intelligence graph validation failed.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INTELLIGENCE_GRAPH_INVALID,
      details: {
        validationIssues: nextGraph.validation?.issues || [],
      },
    })
  }

  return {
    auditDiff: buildRuntimeIntelligenceGraphAuditSummary({
      autoRebuilt,
      buildTrigger: normalizedBuildTrigger,
      nextGraph,
      previousGraph,
    }),
    buildTrigger: normalizedBuildTrigger,
    graph: nextGraph,
    nextFrameworkState: {
      ...nextFrameworkState,
      intelligence_graph: nextGraph,
    },
  }
}

export const rebuildRuntimeIntelligenceGraph = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForGraphRebuild({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolveFrameworkPackageForGraph(runtimeInstance)
  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousGraph = cloneValue(previousFrameworkState.intelligence_graph || {})
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    autoRebuilt: false,
    buildTrigger: payload?.trigger,
    frameworkPackage,
    runtimeInstance,
    nextFrameworkState: previousFrameworkState,
    previousFrameworkState,
  })
  const { buildTrigger, graph: nextGraph, nextFrameworkState } = graphRebuild

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: graphRebuild.auditDiff,
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: RUNTIME_INTELLIGENCE_GRAPH_PATH,
    previousValue: buildRuntimeIntelligenceGraphProjection(previousGraph),
    nextValue: buildRuntimeIntelligenceGraphProjection(nextGraph),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    intelligenceGraph: buildRuntimeIntelligenceGraphProjection(nextGraph, { includeGraphElements: true }),
  }
}

export const updateRuntimeSectionEvidence = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const target = resolveSectionEvidenceTarget({ frameworkPackage, payload })

  await assertSectionEvidenceTargetProjectable({ frameworkPackage, target })
  await assertRuntimeSectionPathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath: target.runtimePath,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const previousRawSection = previousFrameworkState.sections?.[target.stateSectionKey]
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const previousSectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: sectionObject.additionalEvidence,
    evidenceObjects: sectionObject.evidenceObjects,
  })
  const capturedAt = new Date().toISOString()

  let acquisition
  try {
    acquisition = await ingestUploadedDocumentDiscoveryEvidence({
      acquisitionProfile: DISCOVERY_ACQUISITION_PROFILES.STANDARD,
      capturedAt,
      documentSources: payload?.documentSources || [],
    })
  } catch (err) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section supporting file ingestion failed.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        runtimePath: target.runtimePath,
        sectionKey: target.sectionKey,
        ingestionError: serializeErrorDetails(err),
      },
    })
  }

  if (!Array.isArray(acquisition?.evidenceObjects) || acquisition.evidenceObjects.length === 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section supporting files did not produce reviewable evidence.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        runtimePath: target.runtimePath,
        sectionKey: target.sectionKey,
      },
    })
  }

  const transformed = transformSectionDocumentAcquisition({
    acquisition,
    actorUserId,
    capturedAt,
    runtimePath: target.runtimePath,
    sectionKey: target.sectionKey,
    stateSectionKey: target.stateSectionKey,
  })
  const documents = [
    ...(Array.isArray(sectionObject.additionalEvidence?.documents)
      ? cloneValue(sectionObject.additionalEvidence.documents)
      : []),
    ...transformed.documents,
  ]
  const evidenceObjects = [
    ...(Array.isArray(sectionObject.evidenceObjects) ? cloneValue(sectionObject.evidenceObjects) : []),
    ...transformed.evidenceObjects,
  ]
  const nextSection = {
    ...sectionObject,
    additionalEvidence: buildSectionAdditionalEvidence({
      actorUserId,
      documents,
      evidenceObjects,
      updatedAt: capturedAt,
    }),
    evidenceObjects,
    gsilContext: buildSectionGsilContext({
      evidenceObjects,
      reviewedAt: sectionObject.gsilContext?.updatedAt || '',
    }),
  }
  const sectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: nextSection.additionalEvidence,
    evidenceObjects: nextSection.evidenceObjects,
  })
  const nextFrameworkState = cloneValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}
  nextFrameworkState.sections[target.stateSectionKey] = nextSection
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_EVIDENCE_UPDATED,
    frameworkPackage,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      reason: 'SECTION_EVIDENCE_UPLOAD',
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      previousDocumentCount: previousSectionEvidence.documentCount,
      nextDocumentCount: sectionEvidence.documentCount,
      previousEvidenceObjectCount: previousSectionEvidence.evidenceObjectCount,
      nextEvidenceObjectCount: sectionEvidence.evidenceObjectCount,
      uploadedSectionDocumentIds: transformed.documents
        .map((document) => document.sectionDocumentId)
        .filter(Boolean),
      uploadedSectionEvidenceObjectIds: transformed.evidenceObjects
        .map((evidenceObject) => evidenceObject.evidenceObjectId)
        .filter(Boolean),
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: target.runtimePath,
    previousValue: previousSectionEvidence,
    nextValue: sectionEvidence,
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildSectionEvidenceMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    target,
    previousSectionEvidence,
    sectionEvidence,
  })
}

export const reviewRuntimeSectionEvidence = async ({
  actorUserId,
  auditRequest,
  evidenceObjectId,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const reviewStatus = normalizeSectionEvidenceReviewStatus(payload?.reviewStatus)
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const target = resolveSectionEvidenceTarget({ frameworkPackage, payload })

  await assertSectionEvidenceTargetProjectable({ frameworkPackage, target })
  await assertRuntimeSectionPathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath: target.runtimePath,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const previousRawSection = previousFrameworkState.sections?.[target.stateSectionKey]
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const previousSectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: sectionObject.additionalEvidence,
    evidenceObjects: sectionObject.evidenceObjects,
  })
  const previousEvidenceObjects = Array.isArray(sectionObject.evidenceObjects)
    ? cloneValue(sectionObject.evidenceObjects)
    : []
  const previousGsilContext = buildSectionGsilContext({
    evidenceObjects: previousEvidenceObjects,
    reviewedAt: sectionObject.gsilContext?.updatedAt || '',
  })
  const reviewedAt = new Date().toISOString()
  let found = false
  const evidenceObjects = previousEvidenceObjects.map((evidenceObject) => {
    if (String(evidenceObject?.evidenceObjectId || '').trim() !== String(evidenceObjectId || '').trim()) {
      return evidenceObject
    }

    found = true
    return {
      ...evidenceObject,
      reviewStatus,
      acceptedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? toIdString(actorUserId)
        : '',
      acceptanceTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
        ? reviewedAt
        : '',
      rejectedBy: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? toIdString(actorUserId)
        : '',
      rejectionTimestamp: reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
        ? reviewedAt
        : '',
      lastReviewedAt: reviewedAt,
      lastReviewedBy: toIdString(actorUserId),
    }
  })

  if (!found) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Section evidence object was not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        evidenceObjectId,
        runtimePath: target.runtimePath,
        sectionKey: target.sectionKey,
      },
    })
  }

  const documents = Array.isArray(sectionObject.additionalEvidence?.documents)
    ? cloneValue(sectionObject.additionalEvidence.documents)
    : []
  const nextGsilContext = buildSectionGsilContext({
    evidenceObjects,
    reviewedAt,
  })
  const acceptedEvidenceChanged = previousGsilContext.evidenceHash !== nextGsilContext.evidenceHash
  let nextSection = {
    ...sectionObject,
    additionalEvidence: buildSectionAdditionalEvidence({
      actorUserId,
      documents,
      evidenceObjects,
      updatedAt: reviewedAt,
    }),
    evidenceObjects,
    gsilContext: nextGsilContext,
  }

  if (acceptedEvidenceChanged) {
    nextSection = applyAcceptedSectionEvidenceInvalidation({
      actorUserId,
      invalidatedAt: reviewedAt,
      nextSection,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      sectionObject,
    })
  }

  const sectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: nextSection.additionalEvidence,
    evidenceObjects: nextSection.evidenceObjects,
  })
  const nextFrameworkState = cloneValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}
  nextFrameworkState.sections[target.stateSectionKey] = nextSection
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_EVIDENCE_REVIEWED,
    frameworkPackage,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      reason: 'SECTION_EVIDENCE_REVIEW',
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      evidenceObjectId: String(evidenceObjectId || '').trim(),
      reviewStatus,
      acceptedEvidenceChanged,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: target.runtimePath,
    previousValue: previousSectionEvidence,
    nextValue: sectionEvidence,
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildSectionEvidenceMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    target,
    previousSectionEvidence,
    sectionEvidence,
  })
}

export const reviewAllRuntimeSectionEvidence = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const reviewStatus = normalizeSectionEvidenceReviewStatus(payload?.reviewStatus)
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const target = resolveSectionEvidenceTarget({ frameworkPackage, payload })

  await assertSectionEvidenceTargetProjectable({ frameworkPackage, target })
  await assertRuntimeSectionPathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath: target.runtimePath,
  })

  if (reviewStatus !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section evidence bulk review only supports accepting pending evidence.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        reviewStatus,
      },
    })
  }

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const previousRawSection = previousFrameworkState.sections?.[target.stateSectionKey]
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const previousSectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: sectionObject.additionalEvidence,
    evidenceObjects: sectionObject.evidenceObjects,
  })
  const previousEvidenceObjects = Array.isArray(sectionObject.evidenceObjects)
    ? cloneValue(sectionObject.evidenceObjects)
    : []
  const previousGsilContext = buildSectionGsilContext({
    evidenceObjects: previousEvidenceObjects,
    reviewedAt: sectionObject.gsilContext?.updatedAt || '',
  })
  const reviewedAt = new Date().toISOString()
  const acceptedEvidenceObjectIds = []
  const evidenceObjects = previousEvidenceObjects.map((evidenceObject) => {
    const currentReviewStatus = normalizeSectionEvidenceReviewStatus(evidenceObject?.reviewStatus)
    if (currentReviewStatus !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING) {
      return evidenceObject
    }

    const evidenceObjectId = String(evidenceObject?.evidenceObjectId || '').trim()
    if (evidenceObjectId) acceptedEvidenceObjectIds.push(evidenceObjectId)
    return {
      ...evidenceObject,
      reviewStatus,
      acceptedBy: toIdString(actorUserId),
      acceptanceTimestamp: reviewedAt,
      rejectedBy: '',
      rejectionTimestamp: '',
      lastReviewedAt: reviewedAt,
      lastReviewedBy: toIdString(actorUserId),
    }
  })

  if (acceptedEvidenceObjectIds.length === 0) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'No pending section evidence is available to accept.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        runtimePath: target.runtimePath,
        sectionKey: target.sectionKey,
      },
    })
  }

  const documents = Array.isArray(sectionObject.additionalEvidence?.documents)
    ? cloneValue(sectionObject.additionalEvidence.documents)
    : []
  const nextGsilContext = buildSectionGsilContext({
    evidenceObjects,
    reviewedAt,
  })
  const acceptedEvidenceChanged = previousGsilContext.evidenceHash !== nextGsilContext.evidenceHash
  let nextSection = {
    ...sectionObject,
    additionalEvidence: buildSectionAdditionalEvidence({
      actorUserId,
      documents,
      evidenceObjects,
      updatedAt: reviewedAt,
    }),
    evidenceObjects,
    gsilContext: nextGsilContext,
  }

  if (acceptedEvidenceChanged) {
    nextSection = applyAcceptedSectionEvidenceInvalidation({
      actorUserId,
      invalidatedAt: reviewedAt,
      nextSection,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      sectionObject,
    })
  }

  const sectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: nextSection.additionalEvidence,
    evidenceObjects: nextSection.evidenceObjects,
  })
  const nextFrameworkState = cloneValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}
  nextFrameworkState.sections[target.stateSectionKey] = nextSection
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_EVIDENCE_REVIEWED,
    frameworkPackage,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      reason: 'SECTION_EVIDENCE_REVIEW_ALL',
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      reviewStatus,
      acceptedEvidenceObjectIds,
      acceptedEvidenceObjectCount: acceptedEvidenceObjectIds.length,
      acceptedEvidenceChanged,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: target.runtimePath,
    previousValue: previousSectionEvidence,
    nextValue: sectionEvidence,
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildSectionEvidenceMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    target,
    previousSectionEvidence,
    sectionEvidence,
  })
}

export const clearRuntimeSectionEvidence = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  if (payload?.confirmClear !== true) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Section evidence clear requires confirmation.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        confirmClear: 'confirmClear must be true',
      },
    })
  }

  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const target = resolveSectionEvidenceTarget({ frameworkPackage, payload })

  await assertSectionEvidenceTargetProjectable({ frameworkPackage, target })
  await assertRuntimeSectionPathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath: target.runtimePath,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const previousRawSection = previousFrameworkState.sections?.[target.stateSectionKey]
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const previousEvidenceObjects = Array.isArray(sectionObject.evidenceObjects)
    ? cloneValue(sectionObject.evidenceObjects)
    : []
  const previousDocuments = Array.isArray(sectionObject.additionalEvidence?.documents)
    ? cloneValue(sectionObject.additionalEvidence.documents)
    : []
  const previousSectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: sectionObject.additionalEvidence,
    evidenceObjects: previousEvidenceObjects,
  })

  if (previousDocuments.length === 0 && previousEvidenceObjects.length === 0) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'There is no section evidence to clear.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        runtimePath: target.runtimePath,
        sectionKey: target.sectionKey,
      },
    })
  }

  const clearedAt = new Date().toISOString()
  const previousGsilContext = buildSectionGsilContext({
    evidenceObjects: previousEvidenceObjects,
    reviewedAt: sectionObject.gsilContext?.updatedAt || '',
  })
  const nextGsilContext = buildSectionGsilContext({
    evidenceObjects: [],
    reviewedAt: clearedAt,
  })
  const acceptedEvidenceChanged = previousGsilContext.evidenceHash !== nextGsilContext.evidenceHash
  let nextSection = {
    ...sectionObject,
    additionalEvidence: buildSectionAdditionalEvidence({
      actorUserId,
      documents: [],
      evidenceObjects: [],
      updatedAt: clearedAt,
    }),
    evidenceObjects: [],
    gsilContext: nextGsilContext,
  }

  if (acceptedEvidenceChanged) {
    nextSection = applyAcceptedSectionEvidenceInvalidation({
      actorUserId,
      invalidatedAt: clearedAt,
      nextSection,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      sectionObject,
    })
  }

  const sectionEvidence = buildSectionEvidenceProjection({
    additionalEvidence: nextSection.additionalEvidence,
    evidenceObjects: nextSection.evidenceObjects,
  })
  const nextFrameworkState = cloneValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}
  nextFrameworkState.sections[target.stateSectionKey] = nextSection
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_EVIDENCE_UPDATED,
    frameworkPackage,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      reason: 'SECTION_EVIDENCE_CLEAR',
      clearReason: payload?.reason || 'USER_REQUESTED_SECTION_EVIDENCE_CLEAR',
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      previousDocumentCount: previousSectionEvidence.documentCount,
      nextDocumentCount: sectionEvidence.documentCount,
      previousEvidenceObjectCount: previousSectionEvidence.evidenceObjectCount,
      nextEvidenceObjectCount: sectionEvidence.evidenceObjectCount,
      acceptedEvidenceChanged,
      previousSectionEvidenceHash: previousGsilContext.evidenceHash,
      nextSectionEvidenceHash: nextGsilContext.evidenceHash,
      clearedSectionDocumentIds: previousDocuments
        .map((document) => document.sectionDocumentId || document.sourceId)
        .filter(Boolean),
      clearedSectionEvidenceObjectIds: previousEvidenceObjects
        .map((evidenceObject) => evidenceObject.evidenceObjectId)
        .filter(Boolean),
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: target.runtimePath,
    previousValue: previousSectionEvidence,
    nextValue: sectionEvidence,
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return buildSectionEvidenceMutationResponse({
    runtimeInstance: updatedRuntimeInstance,
    target,
    previousSectionEvidence,
    sectionEvidence,
  })
}

export const getRuntimeDiscoveryEvidence = async ({
  actorUserId,
  scopes,
  runtimeInstanceId,
} = {}) => {
  const { runtimeInstance, canViewRawEvidence } = await resolveRuntimeInstanceForEvidenceRead({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })
  const frameworkState = runtimeInstance.framework_state || {}
  const evidencePack = cloneValue(frameworkState.evidence_pack || frameworkState.evidencePack || {})
  const summaries = evidencePack.summaries || {}
  const scopedViews = getCanonicalScopedViews(evidencePack)
  const lineage = evidencePack.lineage || { sources: [], builder: {} }
  const accepted = !getEvidencePackNeedsRefresh(evidencePack) && getEvidencePackStateFlag(evidencePack, 'accepted')
  const acquisition = cloneValue(evidencePack.acquisition || {})
  const evidence = cloneValue(evidencePack.evidence || {})
  const projectionCoverage = acquisition.coverage || evidence.coverage || {}
  const normalizedEvidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: acquisition.profile || evidencePack.acquisitionProfile,
    createdAt: evidencePack.refreshedAt,
    evidenceObjects: evidencePack.evidenceObjects,
    inputs: evidencePack.inputs,
    sources: evidencePack.lineage?.sources || [],
  })
  const evidenceObjects = accepted
    ? acceptPendingDiscoveryEvidenceObjects({
        acceptedAt: evidencePack.acceptedAt || evidencePack.refreshedAt || '',
        actorUserId: evidencePack.acceptedBy || '',
        evidenceObjects: normalizedEvidenceObjects,
      })
    : normalizedEvidenceObjects
  const sourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: evidencePack.refreshedAt,
    evidenceObjects,
    sourceRegistry: evidencePack.sourceRegistry || acquisition.sourceRegistry,
    sources: evidencePack.lineage?.sources || [],
  })
  const discoveryHealth = buildDiscoveryHealth({
    acquisitionProfile: acquisition.profile || evidencePack.acquisitionProfile || DISCOVERY_ACQUISITION_PROFILES.STANDARD,
    coverage: {
      ...projectionCoverage,
      confidence: acquisition.confidence || evidence.confidence,
    },
    evidenceObjects,
    lastAcquisitionDate: evidencePack.refreshedAt || acquisition.completedAt,
    sourceRegistry,
  })
  const acquisitionEffectiveness = buildDiscoveryAcquisitionEffectiveness({
    acquisitionProfile: acquisition.profile || evidencePack.acquisitionProfile || DISCOVERY_ACQUISITION_PROFILES.STANDARD,
    discoveryHealth,
    evidenceObjects,
    inputs: evidencePack.inputs || {},
    sourceRegistry,
  })

  if (accepted && isPlainObject(projectionCoverage) && Object.keys(projectionCoverage).length > 0) {
    const acceptedCoverage = buildAcceptedDiscoveryCoverage(projectionCoverage)
    if (isPlainObject(acquisition)) acquisition.coverage = acceptedCoverage
    if (isPlainObject(evidence)) evidence.coverage = acceptedCoverage
  }

  return {
    runtimeInstance: {
      id: toIdString(runtimeInstance._id),
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
      runtimeType: runtimeInstance.runtimeType,
      status: runtimeInstance.status,
      executionStatus: runtimeInstance.executionStatus,
      updatedAt: runtimeInstance.updatedAt instanceof Date
        ? runtimeInstance.updatedAt.toISOString()
        : runtimeInstance.updatedAt,
    },
    discovery: {
      state: evidencePack.state || { status: 'EVIDENCE_NOT_READY' },
      inputComplete: getEvidencePackStateFlag(evidencePack, 'inputComplete'),
      evidenceReady: getEvidencePackStateFlag(evidencePack, 'evidenceReady'),
      accepted,
      needsRefresh: getEvidencePackNeedsRefresh(evidencePack),
      acquisitionProfile: evidencePack.acquisition?.profile || evidencePack.acquisitionProfile || DISCOVERY_ACQUISITION_PROFILES.STANDARD,
      acquisition: {
        profile: acquisition.profile,
        label: acquisition.label,
        purpose: acquisition.purpose,
        status: acquisition.status,
        evidenceTarget: acquisition.evidenceTarget,
        coverage: acquisition.coverage,
        confidence: acquisition.confidence,
        documentAcquisition: acquisition.documentAcquisition
          ? {
              status: acquisition.documentAcquisition.status,
              sourceCount: acquisition.documentAcquisition.sourceCount,
              evidenceProduced: acquisition.documentAcquisition.evidenceProduced,
            }
          : undefined,
        websiteAcquisition: acquisition.websiteAcquisition
          ? {
              status: acquisition.websiteAcquisition.status,
              evidenceProduced: acquisition.websiteAcquisition.evidenceProduced,
            }
          : undefined,
      },
      evidenceObjectSummary: buildDiscoveryEvidenceReviewSummary(evidenceObjects),
      acquisitionEffectiveness,
      sourceRegistrySummary: {
        count: sourceRegistry.length,
        sourceTypes: Array.from(new Set(sourceRegistry.map((source) => source.sourceType).filter(Boolean))),
      },
      lineageSummary: {
        sourceCount: Array.isArray(lineage.sources) ? lineage.sources.length : 0,
        builderMode: lineage.builder?.mode || '',
      },
      inputSummary: buildEvidenceSummaryProjection(evidencePack.inputs),
      evidenceSummary: buildEvidenceSummaryProjection(evidencePack.evidence),
      summarySummary: buildEvidenceSummaryProjection(summaries),
      scopedViewSummary: buildEvidenceSummaryProjection(scopedViews),
      canViewRawEvidence,
      ...(canViewRawEvidence ? {
        inputs: evidencePack.inputs || {},
        discovery: evidencePack.discovery || {},
        summaries,
        evidence,
        sourceRegistry,
        evidenceObjects,
        discoveryHealth,
        acquisitionEffectiveness,
        lineage,
        scoped_views: scopedViews,
        revisions: Array.isArray(evidencePack.revisions) ? evidencePack.revisions : [],
      } : {}),
      ...(evidencePack.acceptedAt ? { acceptedAt: evidencePack.acceptedAt } : {}),
      ...(evidencePack.acceptedBy ? { acceptedBy: evidencePack.acceptedBy } : {}),
      ...(evidencePack.refreshedAt ? { refreshedAt: evidencePack.refreshedAt } : {}),
    },
  }
}

export const acceptRuntimeSection = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const frameworkPackage = await resolvePackageForAdvance(runtimeInstance?.packageId)
  const target = resolveSectionAcceptanceTarget({ frameworkPackage, payload })

  await assertRuntimeSectionPathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath: target.runtimePath,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const previousRawSection = previousFrameworkState.sections?.[target.stateSectionKey]
  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const generated = getRuntimeSectionGenerated(sectionObject)
  const previousAccepted = getRuntimeSectionAccepted(sectionObject)

  if (!generated || !String(generated.content ?? '').trim()) {
    throw buildSectionAcceptanceUnavailableError({
      message: 'Runtime section cannot be accepted before generated content exists.',
      runtimePath: target.runtimePath,
      sectionKey: target.sectionKey,
    })
  }

  const truthEligibility = generated.truthEligibility || sectionObject.intelligence?.truthEligibility || null
  if (truthEligibility && truthEligibility.eligible === false) {
    throw buildSectionAcceptanceUnavailableError({
      message: 'Runtime section cannot be accepted until generated content is truth eligible.',
      runtimePath: target.runtimePath,
      sectionKey: target.sectionKey,
    })
  }

  const regenerationRequiredReason = getSectionAcceptanceRegenerationRequiredReason(sectionObject)
  if (regenerationRequiredReason) {
    throw buildSectionAcceptanceUnavailableError({
      message: regenerationRequiredReason,
      runtimePath: target.runtimePath,
      sectionKey: target.sectionKey,
    })
  }

  if (isCurrentGeneratedAlreadyAccepted({ accepted: previousAccepted, generated })) {
    throw buildSectionAcceptanceUnavailableError({
      message: 'Runtime section generated content is already accepted.',
      runtimePath: target.runtimePath,
      sectionKey: target.sectionKey,
    })
  }

  const acceptedAt = new Date().toISOString()
  const accepted = buildAcceptedSectionTruth({
    actorUserId,
    acceptedAt,
    generated,
    previousAccepted,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
  })
  const nextFrameworkState = cloneValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}
  nextFrameworkState.sections[target.stateSectionKey] = {
    ...sectionObject,
    accepted,
    review: {
      ...(sectionObject.review || {}),
      status: 'ACCEPTED',
      acceptedAt,
      acceptedBy: toIdString(actorUserId),
      acceptedTruthHash: accepted.truthHash,
    },
    state: {
      ...(sectionObject.state || {}),
      status: RUNTIME_SECTION_STATES.ACCEPTED,
      acceptedAt,
      acceptedBy: toIdString(actorUserId),
      acceptedSourceGeneratedAt: generated.generatedAt || '',
      acceptedTruthHash: accepted.truthHash,
      acceptedRevisionCount: accepted.revisions.length,
      inputHash: generated.inputHash || '',
    },
    lineage: {
      ...(sectionObject.lineage || {}),
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      runtimePath: target.runtimePath,
      acceptedAt,
      acceptedBy: toIdString(actorUserId),
      sourceGeneratedAt: generated.generatedAt || '',
      acceptedTruthHash: accepted.truthHash,
      inputHash: generated.inputHash || '',
    },
    intelligence: {
      ...(sectionObject.intelligence || {}),
      acceptedTruth: {
        state: 'CURRENT',
        truthHash: accepted.truthHash,
        acceptedAt,
        sourceGeneratedAt: generated.generatedAt || '',
        sourceActionKey: generated.actionKey || '',
      },
    },
    metrics: {
      ...(sectionObject.metrics || {}),
      acceptedTruthRevisionCount: accepted.revisions.length,
      acceptedTruthHash: accepted.truthHash,
      lastAcceptedAt: acceptedAt,
    },
  }
  const dependencyInvalidations = applyAcceptedTruthDependencyInvalidations({
    acceptedAt,
    actorUserId,
    frameworkPackage,
    frameworkState: nextFrameworkState,
    upstreamRuntimePath: target.runtimePath,
    upstreamSectionKey: target.sectionKey,
  })
  const graphRebuild = await rebuildRuntimeIntelligenceGraphForMutation({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_TRUTH_ACCEPTED,
    frameworkPackage,
    nextFrameworkState,
    previousFrameworkState,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: {
      ...graphRebuild.auditDiff,
      ...buildDependencyInvalidationAuditDiff(dependencyInvalidations),
    },
    auditRequest,
    runtimeInstance,
    nextFrameworkState: graphRebuild.nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath: target.runtimePath,
    previousValue: previousAccepted,
    nextValue: cloneValue(accepted),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    section: {
      sectionKey: target.sectionKey,
      runtimePath: target.runtimePath,
      accepted,
      previousAccepted,
    },
    mutation: {
      runtimePath: target.runtimePath,
      operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
      previousValue: previousAccepted,
      value: cloneValue(accepted),
    },
    dependencyInvalidations,
  }
}

const runtimeStateMutationService = {
  acceptRuntimeSection,
  acceptRuntimeDiscovery,
  getRuntimeDiscoveryEvidence,
  mutateRuntimeState,
  rebuildRuntimeIntelligenceGraph,
  reviewAllRuntimeSectionEvidence,
  reviewRuntimeSectionEvidence,
  resetRuntimeDiscovery,
  updateRuntimeSectionEvidence,
  updateRuntimeDiscoveryInputs,
}

export default runtimeStateMutationService
